import type { ClientSession, Types } from 'mongoose';
import type { z } from 'zod';
import { recordActivity } from '../../core/activity/activity.service';
import { recordAudit } from '../../core/audit/audit.service';
import { formatSequence, nextSequence } from '../../core/counters/counter.service';
import { assertPermission, type Principal } from '../../core/permissions/principal';
import { resolveWriteBranch, scopedRepo } from '../../core/scope';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import { getEnv } from '../../config/env';
import { escapeRegex, parseSort, toMeta, toWindow } from '../../lib/listQuery';
import { formatPhone, phoneSearchDigits } from '../../lib/phone';
import { withTransaction } from '../../lib/transaction';
import { Branch } from '../branches/branch.model';
import { Client } from '../clients/client.model';
import { listForEnquiry as listUnitInterests } from '../unitInterests/unitInterest.service';
import { compact, unitRelations } from '../unitInterests/unitRelations';
import { nextClientNo } from '../clients/client.service';
import { assertActiveMaster, masterLabels } from '../masters/master.service';
import { referralSummaryFor } from '../referrals/referral.service';
import { Person } from '../persons/person.model';
import { findMatch, isDuplicateKey, materializePerson, personExists, personView, preparePerson } from '../persons/person.service';
import { validateAssignee } from '../users/assignable';
import { User } from '../users/user.model';
import type { TransitionPlan, WorkflowDefinition } from '../workflow/workflow.definition';
import { DOMAIN_OPERATIONS, type DomainOperation } from '../workflow/workflowDefaults';
import { listStages, loadWorkflow } from '../workflow/workflow.service';
import { Enquiry, EnquiryAssignment, EnquiryStageHistory } from './enquiry.model';
import './enquiry.references';
import type { assignBody, convertBody, createEnquiryBody, EnquiryFilters, listEnquiryQuery, updateEnquiryBody } from './enquiry.schema';

const ENQUIRY_NO = { prefix: 'ENQ-', width: 6 } as const;
export const nextEnquiryNo = async (): Promise<string> => formatSequence(await nextSequence('enquiry'), ENQUIRY_NO);

type Id = Types.ObjectId;
export type EnquiryLean = {
  _id: Id; enquiryNo: string; personId: Id; branchId: Id; personName: string; phoneE164: string;
  sourceId?: Id | null; typeId?: Id | null; propertyTypeId?: Id | null; buildingTypeId?: Id | null; locationId?: Id | null;
  stageCode: string; stageChangedAt: Date; lostReasonId?: Id | null; assignedTo?: Id | null; assignedAt?: Date | null; referralId?: Id | null;
  notes?: string | null; isArchived?: boolean; createdAt?: Date; updatedAt?: Date;
};

/** The master fields, the master type each must belong to, and the label used in error messages. */
const MASTER_FIELDS = [
  ['sourceId', 'ENQUIRY_SOURCE'],
  ['typeId', 'ENQUIRY_TYPE'],
  ['propertyTypeId', 'PROPERTY_TYPE'],
  ['buildingTypeId', 'BUILDING_TYPE'],
  ['locationId', 'LOCATION'],
] as const;

const repo = (principal: Principal, requestedBranchId?: string, includeArchived = false) => scopedRepo(Enquiry, principal, { requestedBranchId, includeArchived });

// ---- validation -------------------------------------------------------------

/**
 * Every master a NEW or CHANGED value points at must exist, be of the right type, be ACTIVE and be
 * visible to the actor. A LOCATION additionally has to belong to the enquiry's own branch.
 */
async function validateMasters(principal: Principal, branchId: string, ids: Partial<Record<(typeof MASTER_FIELDS)[number][0], string | null | undefined>>) {
  for (const [field, type] of MASTER_FIELDS) {
    const id = ids[field];
    if (!id) continue;
    const m = await assertActiveMaster(principal, type, id, field);
    if (type === 'LOCATION' && m.branchId?.toHexString() !== branchId) {
      throw AppError.validation('Invalid location', [{ path: field, message: 'Choose a location of this enquiry\'s branch' }]);
    }
  }
}

// ---- views --------------------------------------------------------------------

async function lookups(principal: Principal, rows: EnquiryLean[]) {
  const masterIds = new Set<string>();
  const userIds = new Set<string>();
  const branchIds = new Set<string>();
  for (const r of rows) {
    for (const f of ['sourceId', 'typeId', 'propertyTypeId', 'buildingTypeId', 'locationId', 'lostReasonId'] as const) if (r[f]) masterIds.add(r[f]!.toHexString());
    if (r.assignedTo) userIds.add(r.assignedTo.toHexString());
    branchIds.add(r.branchId.toHexString());
  }
  const [masters, users, branches, stages] = await Promise.all([
    masterIds.size ? masterLabels(principal, [...masterIds]) : new Map(),
    userIds.size ? scopedRepo(User, principal).find({ _id: { $in: [...userIds].map((i) => toObjectId(i)) } }).select('name').lean<{ _id: Id; name: string }[]>() : [],
    scopedRepo(Branch, principal).find({ _id: { $in: [...branchIds].map((i) => toObjectId(i)) } }).select('name code').lean<{ _id: Id; name: string; code: string }[]>(),
    listStages(true),
  ]);
  return {
    masters,
    users: new Map(users.map((u) => [u._id.toHexString(), u.name])),
    branches: new Map(branches.map((b) => [b._id.toHexString(), { name: b.name, code: b.code }])),
    stages: new Map(stages.map((s) => [s.systemKey, { systemKey: s.systemKey, label: s.label, color: s.color ?? undefined, kind: s.kind, isActive: s.isActive }])),
  };
}
type Lookups = Awaited<ReturnType<typeof lookups>>;

export function toView(e: EnquiryLean, l: Lookups) {
  const m = (id?: Id | null) => (id ? l.masters.get(id.toHexString()) : undefined); // includes inactive values: history keeps its meaning
  return {
    id: e._id.toHexString(),
    enquiryNo: e.enquiryNo,
    personId: e.personId.toHexString(),
    name: e.personName,
    phone: formatPhone(e.phoneE164),
    phoneE164: e.phoneE164,
    branchId: e.branchId.toHexString(),
    branch: l.branches.get(e.branchId.toHexString()),
    source: m(e.sourceId), type: m(e.typeId), propertyType: m(e.propertyTypeId), buildingType: m(e.buildingTypeId), location: m(e.locationId),
    sourceId: e.sourceId?.toHexString(), typeId: e.typeId?.toHexString(), propertyTypeId: e.propertyTypeId?.toHexString(), buildingTypeId: e.buildingTypeId?.toHexString(), locationId: e.locationId?.toHexString(),
    stageCode: e.stageCode,
    stage: l.stages.get(e.stageCode) ?? { systemKey: e.stageCode, label: e.stageCode },
    stageChangedAt: e.stageChangedAt,
    lostReason: m(e.lostReasonId),
    assignedTo: e.assignedTo?.toHexString(),
    assignedToName: e.assignedTo ? l.users.get(e.assignedTo.toHexString()) : undefined,
    assignedAt: e.assignedAt ?? undefined,
    referralId: e.referralId?.toHexString(),
    notes: e.notes ?? undefined,
    isArchived: Boolean(e.isArchived),
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

export async function viewsOf(principal: Principal, rows: EnquiryLean[]) {
  const l = await lookups(principal, rows);
  return rows.map((r) => toView(r, l));
}

// ---- filters (list, board and export share one definition) --------------------

/** Turns validated filters into a Mongo filter. SCOPE is not added here: the scoped repository adds it. */
export function buildFilter(q: EnquiryFilters): Record<string, unknown> {
  const and: Record<string, unknown>[] = [{ isArchived: q.isArchived === 'true' }];
  if (q.stage) and.push({ stageCode: { $in: q.stage } });
  for (const f of ['sourceId', 'typeId', 'propertyTypeId', 'buildingTypeId', 'locationId', 'personId'] as const) if (q[f]) and.push({ [f]: toObjectId(q[f]!) });
  if (q.assignedTo === 'unassigned') and.push({ assignedTo: null });
  else if (q.assignedTo) and.push({ assignedTo: toObjectId(q.assignedTo) });
  if (q.from || q.to) and.push({ createdAt: { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) } });

  const term = q.search?.trim();
  if (term) {
    const ors: Record<string, unknown>[] = [{ personName: new RegExp(escapeRegex(term), 'i') }, { enquiryNo: new RegExp(`^${escapeRegex(term)}`, 'i') }];
    const digits = phoneSearchDigits(term);
    if (digits) ors.push({ phoneE164: new RegExp(escapeRegex(digits)) });
    if (/^\d{1,9}$/.test(term)) ors.push({ enquiryNo: new RegExp(`^ENQ-0*${term.replace(/^0+/, '') || '0'}$`) }); // "42" finds ENQ-000042
    and.push({ $or: ors });
  }
  return { $and: and };
}

// ---- reads ------------------------------------------------------------------------

export async function listEnquiries(principal: Principal, q: z.infer<typeof listEnquiryQuery>) {
  const filter = buildFilter(q);
  const r = repo(principal, q.branchId, true);
  const { skip, limit } = toWindow(q);
  const sort = parseSort(q.sort, ['createdAt', 'enquiryNo', 'personName', 'stageChangedAt'], { createdAt: -1 });
  const [rows, total] = await Promise.all([
    r.find(filter).sort({ ...sort, _id: -1 }).collation({ locale: 'en', strength: 2 }).skip(skip).limit(limit).lean<EnquiryLean[]>(),
    r.countDocuments(filter),
  ]);
  const views = await viewsOf(principal, rows);
  // One Units column: the same relationship engine as the detail page (omitted when the caller may not view units).
  const relations = await unitRelations(principal, rows.map((r) => ({ key: r._id.toHexString(), enquiryIds: [r._id] })));
  return { rows: relations ? views.map((v) => ({ ...v, units: compact(relations.get(v.id) ?? []) })) : views, meta: toMeta(q, total) };
}

/**
 * Per-stage counts for the same filters. Kept as one scoped aggregate so the dashboard funnel can reuse
 * it later; it respects the caller's scope and the archive default like every other read.
 */
export async function stageCounts(principal: Principal, q: EnquiryFilters): Promise<Map<string, number>> {
  const rows = (await repo(principal, q.branchId, q.isArchived === 'true').aggregate([{ $match: buildFilter(q) }, { $group: { _id: '$stageCode', n: { $sum: 1 } } }])) as { _id: string; n: number }[];
  return new Map(rows.map((r) => [r._id, r.n]));
}

/** Kanban data: one column per configured stage, with a page of cards each. Columns come from the workflow, not from code. */
export async function board(principal: Principal, q: EnquiryFilters & { perStage: number }) {
  const [stages, counts] = await Promise.all([listStages(true), stageCounts(principal, q)]);
  const columns = stages.filter((s) => s.isActive || (counts.get(s.systemKey) ?? 0) > 0); // a deactivated stage still shows while it holds enquiries
  const filter = buildFilter(q);
  const r = repo(principal, q.branchId, q.isArchived === 'true');
  const out = [];
  for (const s of columns) {
    const count = counts.get(s.systemKey) ?? 0;
    const rows = count
      ? await r.find({ $and: [filter, { stageCode: s.systemKey }] }).sort({ stageChangedAt: -1, _id: -1 }).limit(q.perStage).lean<EnquiryLean[]>()
      : [];
    out.push({ systemKey: s.systemKey, label: s.label, color: s.color ?? undefined, kind: s.kind, isActive: s.isActive, order: s.order, count, cards: await viewsOf(principal, rows) });
  }
  return { stages: out, total: [...counts.values()].reduce((a, b) => a + b, 0) };
}

export async function getEnquiry(principal: Principal, id: string) {
  const e = await repo(principal, undefined, true).findById(id).lean<EnquiryLean>();
  if (!e) throw AppError.notFound('Enquiry not found');
  const [wf, person, stageHistory, assignments] = await Promise.all([
    loadWorkflow(),
    scopedRepo(Person, principal).findById(e.personId.toHexString()).lean(),
    scopedRepo(EnquiryStageHistory, principal).find({ enquiryId: e._id }).sort({ at: 1, _id: 1 }).lean<{ _id: Id; fromStage?: string | null; toStage: string; direction: string; reason?: string; lostReasonId?: Id | null; userId?: Id; at: Date }[]>(),
    scopedRepo(EnquiryAssignment, principal).find({ enquiryId: e._id }).sort({ at: 1, _id: 1 }).lean<{ _id: Id; fromUserId?: Id | null; toUserId: Id; byUserId?: Id; reason?: string; at: Date }[]>(),
  ]);
  const l = await lookups(principal, [e]);
  const peopleIds = [...new Set([...assignments.flatMap((a) => [a.fromUserId, a.toUserId, a.byUserId]), ...stageHistory.map((h) => h.userId)].filter(Boolean).map((i) => i!.toHexString()))];
  const names = new Map(
    (peopleIds.length ? await scopedRepo(User, principal).find({ _id: { $in: peopleIds.map((i) => toObjectId(i)) } }).select('name').lean<{ _id: Id; name: string }[]>() : []).map((u) => [u._id.toHexString(), u.name]),
  );
  const lostIds = stageHistory.map((h) => h.lostReasonId).filter(Boolean) as Id[];
  const lostLabels = lostIds.length ? await masterLabels(principal, lostIds) : new Map();
  const stageLabel = (k?: string | null) => (k ? l.stages.get(k)?.label ?? k : undefined);
  const name = (i?: Id | null) => (i ? names.get(i.toHexString()) : undefined);

  const referral = await referralSummaryFor(principal, e.referralId);
  const conversion = await conversionState(principal, e, wf);
  return {
    ...toView(e, l),
    referral,
    /** Whether this enquiry can be converted by the caller right now, and the client it is (or would be) linked to. */
    conversion,
    /** Units this enquiry's person is considering (separate from the unit's status, the enquiry's stage and any booking). */
    unitInterests: await listUnitInterests(principal, e._id.toHexString()),
    /** The unified Units section: one entry per unit with its relationship, bookings and visits (null = the caller may not view units). */
    units: (await unitRelations(principal, [{ key: 'e', enquiryIds: [e._id] }]))?.get('e') ?? null,
    person: person ? personView(person as never, principal) : undefined,
    /** What the caller may do next from this stage (same rules the transition endpoint enforces). */
    transitions: e.isArchived ? [] : wf.availableTransitions(e.stageCode, principal),
    stageHistory: stageHistory.map((h) => ({
      id: h._id.toHexString(), from: h.fromStage ?? undefined, fromLabel: stageLabel(h.fromStage), to: h.toStage, toLabel: stageLabel(h.toStage), direction: h.direction,
      reason: h.reason, lostReason: h.lostReasonId ? lostLabels.get(h.lostReasonId.toHexString()) : undefined, by: h.userId?.toHexString(), byName: name(h.userId), at: h.at,
    })),
    assignments: assignments.map((a) => ({
      id: a._id.toHexString(), from: a.fromUserId?.toHexString(), fromName: name(a.fromUserId), to: a.toUserId.toHexString(), toName: name(a.toUserId),
      by: a.byUserId?.toHexString(), byName: name(a.byUserId), reason: a.reason, at: a.at,
    })),
  };
}

// ---- create -----------------------------------------------------------------------

export async function createEnquiry(principal: Principal, input: z.infer<typeof createEnquiryBody>) {
  const branchId = resolveWriteBranch(principal, input.branchId);
  await validateMasters(principal, branchId, input);
  const assignedTo = input.assignedTo ?? (principal.dataScope === 'OWN' ? principal.userId : undefined);
  if (assignedTo) await validateAssignee(principal, assignedTo, branchId);

  const wf = await loadWorkflow();
  const first = wf.chain[0];
  if (!first) throw new AppError('WORKFLOW_NOT_CONFIGURED', 500, 'The enquiry workflow has no active stages. Run the seed.');

  // Identity first (no ids spent, nothing written): an existing phone is reported, never merged or duplicated.
  const prepared = await preparePerson(principal, input);
  const enquiryNo = await nextEnquiryNo(); // unique and atomic; a failed create below only leaves a gap
  const now = new Date();
  const uid = toObjectId(principal.userId);

  try {
    const created = await withTransaction(async (session) => {
      const person = await materializePerson(principal, prepared, branchId, session);
      const doc = await repo(principal).create(
        {
          enquiryNo, personId: person._id, branchId: toObjectId(branchId), personName: person.name, phoneE164: person.phoneE164,
          sourceId: oid(input.sourceId), typeId: oid(input.typeId), propertyTypeId: oid(input.propertyTypeId), buildingTypeId: oid(input.buildingTypeId), locationId: oid(input.locationId),
          stageCode: first.systemKey, stageChangedAt: now,
          assignedTo: oid(assignedTo), assignedAt: assignedTo ? now : undefined,
          notes: input.notes, createdBy: uid,
        },
        { session },
      );
      const e = doc.toObject() as unknown as EnquiryLean;
      await scopedRepo(EnquiryStageHistory, principal).create({ enquiryId: e._id, branchId: e.branchId, toStage: first.systemKey, direction: 'CREATE', userId: uid, at: now }, { session });
      if (assignedTo) await scopedRepo(EnquiryAssignment, principal).create({ enquiryId: e._id, branchId: e.branchId, toUserId: toObjectId(assignedTo), byUserId: uid, at: now }, { session });
      await recordAudit({ entityType: 'enquiry', entityId: e._id, action: 'create', after: auditView(e), userId: principal.userId, branchId }, { session });
      await recordActivity({ type: 'ENQUIRY_CREATED', description: `Enquiry ${enquiryNo} created for ${person.name}`, branchId, userId: principal.userId, at: now, refs: [{ type: 'enquiry', id: e._id }, { type: 'person', id: person._id }] }, { session });
      return e;
    });
    return (await viewsOf(principal, [created]))[0]!;
  } catch (err) {
    if (isDuplicateKey(err) && input.person) throw personExists(await findMatch(principal, input.person.phone));
    throw err;
  }
}

const oid = (v?: string | null) => (v ? toObjectId(v) : undefined);
const auditView = (e: EnquiryLean) => ({ sourceId: e.sourceId, typeId: e.typeId, propertyTypeId: e.propertyTypeId, buildingTypeId: e.buildingTypeId, locationId: e.locationId, notes: e.notes, assignedTo: e.assignedTo, stageCode: e.stageCode });

// ---- update (descriptive fields only) ---------------------------------------------

export async function updateEnquiry(principal: Principal, id: string, patch: z.infer<typeof updateEnquiryBody>) {
  const r = repo(principal);
  const before = await r.findById(id).lean<EnquiryLean>();
  if (!before) throw AppError.notFound('Enquiry not found');
  const branchId = before.branchId.toHexString();

  // Only a value being CHANGED must be active; an unchanged (possibly since-deactivated) one stays valid.
  const changed: Record<string, string> = {};
  for (const [field] of MASTER_FIELDS) {
    const next = patch[field];
    if (next && next !== before[field]?.toHexString()) changed[field] = next;
  }
  await validateMasters(principal, branchId, changed);

  const set: Record<string, unknown> = { updatedBy: toObjectId(principal.userId) };
  const unset: Record<string, 1> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) unset[k] = 1;
    else set[k] = k === 'notes' ? v : toObjectId(v as string);
  }
  const after = await withTransaction(async (session) => {
    const updated = await r.findOneAndUpdate({ _id: before._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { new: true, session }).lean<EnquiryLean>();
    if (!updated) throw AppError.notFound('Enquiry not found');
    await recordAudit({ entityType: 'enquiry', entityId: before._id, action: 'update', before: auditView(before), after: auditView(updated), userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'ENQUIRY_UPDATED', description: `Enquiry ${before.enquiryNo} updated`, branchId, userId: principal.userId, refs: [{ type: 'enquiry', id: before._id }, { type: 'person', id: before.personId }] }, { session });
    return updated;
  });
  return (await viewsOf(principal, [after]))[0]!;
}

// ---- assignment -------------------------------------------------------------------

export async function assignEnquiry(principal: Principal, id: string, input: z.infer<typeof assignBody>) {
  const r = repo(principal);
  const e = await r.findById(id).lean<EnquiryLean>();
  if (!e) throw AppError.notFound('Enquiry not found');
  const branchId = e.branchId.toHexString();
  await validateAssignee(principal, input.assignedTo, branchId); // OWN scope: self only; otherwise an active user of THIS branch the actor can see

  const prev = e.assignedTo ?? null;
  if (prev?.toHexString() === input.assignedTo) throw new AppError('NO_CHANGE', 409, 'The enquiry is already assigned to that person');
  if (prev && !input.reason) throw AppError.validation('A reason is required to reassign an enquiry', [{ path: 'reason', message: 'Required' }]);

  const now = new Date();
  const uid = toObjectId(principal.userId);
  const to = toObjectId(input.assignedTo);
  const updated = await withTransaction(async (session) => {
    // Conditional on the previous owner: two simultaneous assignments cannot both "win" silently.
    const u = await r.findOneAndUpdate({ _id: e._id, assignedTo: prev }, { $set: { assignedTo: to, assignedAt: now, updatedBy: uid } }, { new: true, session }).lean<EnquiryLean>();
    if (!u) throw AppError.conflict('ASSIGNMENT_CHANGED', 'The enquiry was reassigned by someone else. Refresh and try again.');
    await scopedRepo(EnquiryAssignment, principal).create({ enquiryId: e._id, branchId: e.branchId, fromUserId: prev ?? undefined, toUserId: to, byUserId: uid, reason: input.reason, at: now }, { session });
    await recordAudit({ entityType: 'enquiry', entityId: e._id, action: 'assign', before: { assignedTo: prev }, after: { assignedTo: to }, reason: input.reason, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'ENQUIRY_ASSIGNED', description: prev ? `Enquiry ${e.enquiryNo} reassigned` : `Enquiry ${e.enquiryNo} assigned`, branchId, userId: principal.userId, at: now, refs: [{ type: 'enquiry', id: e._id }, { type: 'person', id: e.personId }], metadata: { from: prev?.toHexString(), to: input.assignedTo } }, { session });
    return u;
  });
  return (await viewsOf(principal, [updated]))[0]!;
}

// ---- workflow transitions ----------------------------------------------------------

export interface TransitionInput {
  to: string;
  from?: string;
  reason?: string;
  lostReasonId?: string;
}

/**
 * The ONLY way an enquiry's stage changes. Rules come from the Phase 3 state machine
 * (no skipping, permissions, reasons, domain-only stages); this function adds persistence:
 * the move is conditional on the stage the rules were evaluated against, and its history row,
 * audit entry and activity commit with it.
 */
export async function transitionEnquiry(principal: Principal, id: string, input: TransitionInput, expect?: { direction: 'LOST' | 'REOPEN' }) {
  const e = await repo(principal).findById(id).lean<EnquiryLean>();
  if (!e) throw AppError.notFound('Enquiry not found');
  const prepared = await prepareTransition(principal, e, input, expect);
  const updated = await withTransaction((session) => persistTransition(principal, e, prepared, session));
  return (await viewsOf(principal, [updated]))[0]!;
}

export interface PreparedTransition {
  plan: TransitionPlan;
  lost?: { _id: Id; label: string };
}

/**
 * Validates a move against the workflow rules (no writes). `via` is set ONLY by a server-side domain
 * service (scheduling or completing a site visit) acting under its own authorization; it is what allows
 * entering a domain-owned stage, and it is never taken from a request.
 */
export async function prepareTransition(principal: Principal, e: EnquiryLean, input: TransitionInput, expect?: { direction: 'LOST' | 'REOPEN' }, via?: DomainOperation): Promise<PreparedTransition> {
  if (input.from && input.from !== e.stageCode) throw new AppError('STAGE_CHANGED', 409, 'The enquiry was moved by someone else. Refresh and try again.', { current: e.stageCode });

  const wf: WorkflowDefinition = await loadWorkflow();
  const target = wf.get(input.to);
  const isLost = target.kind === 'LOST';
  if (isLost && expect?.direction === 'REOPEN') throw new AppError('REOPEN_TARGET', 409, `An enquiry cannot be reopened into "${target.label}"`);
  if (isLost && !input.lostReasonId) throw AppError.validation('A lost reason is required', [{ path: 'lostReasonId', message: 'Choose why the enquiry was lost' }]);
  if (!isLost && input.lostReasonId) throw AppError.validation('A lost reason only applies when marking an enquiry lost', [{ path: 'lostReasonId', message: 'Not applicable' }]);

  let lost: { _id: Id; label: string } | undefined;
  if (isLost) lost = await assertActiveMaster(principal, 'LOST_REASON', input.lostReasonId!, 'lostReasonId');

  // Marking lost: the workflow's required "reason" is the note if given, else the chosen lost reason.
  const reason = isLost ? input.reason?.trim() || lost!.label : input.reason;
  const plan = await wf.plan({ from: e.stageCode, to: input.to, principal, reason, via });
  if (expect && plan.direction !== expect.direction) throw new AppError('WRONG_OPERATION', 409, `This enquiry cannot be ${expect.direction === 'LOST' ? 'marked lost' : 'reopened'} from "${plan.from.label}"`);
  return { plan, lost };
}

/**
 * Persists a prepared move inside the caller's transaction: compare-and-set on the stage the plan was
 * computed from, then history, audit and activity. A concurrent move makes the compare-and-set match
 * nothing, which aborts the caller's whole transaction.
 */
export async function persistTransition(principal: Principal, e: EnquiryLean, { plan, lost }: PreparedTransition, session: ClientSession): Promise<EnquiryLean> {
  const now = new Date();
  const uid = toObjectId(principal.userId);
  const branchId = e.branchId.toHexString();
  const set: Record<string, unknown> = { stageCode: plan.to.systemKey, stageChangedAt: now, updatedBy: uid };
  const unset: Record<string, 1> = {};
  if (plan.direction === 'LOST') set.lostReasonId = lost!._id;
  if (plan.direction === 'REOPEN') unset.lostReasonId = 1;

  const u = await repo(principal).findOneAndUpdate({ _id: e._id, stageCode: e.stageCode }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { new: true, session }).lean<EnquiryLean>();
  if (!u) throw new AppError('STAGE_CHANGED', 409, 'The enquiry was moved by someone else. Refresh and try again.');
  await scopedRepo(EnquiryStageHistory, principal).create({ enquiryId: e._id, branchId: e.branchId, fromStage: plan.from.systemKey, toStage: plan.to.systemKey, direction: plan.direction, reason: plan.reason, lostReasonId: lost?._id, userId: uid, at: now }, { session });
  const action = { FORWARD: 'transition', BACKWARD: 'revert', LOST: 'lost', REOPEN: 'reopen' }[plan.direction];
  await recordAudit({ entityType: 'enquiry', entityId: e._id, action, before: { stageCode: plan.from.systemKey, lostReasonId: e.lostReasonId }, after: { stageCode: plan.to.systemKey, lostReasonId: u.lostReasonId }, reason: plan.reason, userId: principal.userId, branchId }, { session });
  const type = { FORWARD: 'ENQUIRY_STAGE_CHANGED', BACKWARD: 'ENQUIRY_STAGE_CHANGED', LOST: 'ENQUIRY_LOST', REOPEN: 'ENQUIRY_REOPENED' }[plan.direction];
  const text = plan.direction === 'LOST' ? `Enquiry ${e.enquiryNo} marked lost (${lost!.label})` : plan.direction === 'REOPEN' ? `Enquiry ${e.enquiryNo} reopened as ${plan.to.label}` : `Enquiry ${e.enquiryNo} moved from ${plan.from.label} to ${plan.to.label}`;
  await recordActivity({ type, description: text, branchId, userId: principal.userId, at: now, refs: [{ type: 'enquiry', id: e._id }, { type: 'person', id: e.personId }], metadata: { from: plan.from.systemKey, to: plan.to.systemKey, direction: plan.direction, reason: plan.reason } }, { session });
  return u;
}

// ---- archive ------------------------------------------------------------------------

export async function archiveEnquiry(principal: Principal, id: string) {
  const r = repo(principal);
  const e = await r.findById(id).lean<EnquiryLean>();
  if (!e) throw AppError.notFound('Enquiry not found');
  const branchId = e.branchId.toHexString();
  await withTransaction(async (session) => {
    if (!(await r.archiveOne({ _id: e._id }, principal.userId, { session }))) throw AppError.notFound('Enquiry not found');
    await recordAudit({ entityType: 'enquiry', entityId: e._id, action: 'archive', before: { isArchived: false }, after: { isArchived: true }, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'ENQUIRY_ARCHIVED', description: `Enquiry ${e.enquiryNo} archived`, branchId, userId: principal.userId, refs: [{ type: 'enquiry', id: e._id }, { type: 'person', id: e.personId }] }, { session });
  });
}

// ---- export --------------------------------------------------------------------------

const BATCH = 500;

/** CSV cell: quoted when needed, and neutralised against spreadsheet formula injection. */
export function csvCell(v: unknown): string {
  let s = v === undefined || v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Streams the caller's own, filtered view as CSV rows. It uses the same scoped repository as the list
 * (so scope, filters and the archive default all apply) and refuses outright when the result is too
 * large rather than silently truncating.
 */
export async function exportEnquiries(principal: Principal, q: EnquiryFilters, write: (chunk: string) => void): Promise<number> {
  const filter = buildFilter(q);
  const r = repo(principal, q.branchId, q.isArchived === 'true');
  const total = await r.countDocuments(filter);
  const max = getEnv().EXPORT_MAX_ROWS;
  if (total > max) throw new AppError('EXPORT_TOO_LARGE', 413, `This export has ${total} rows (limit ${max}). Narrow the filters and try again.`);

  const header = ['Enquiry ID', 'Name', 'Phone (with country code)', 'Stage', 'Source', 'Type', 'Property type', 'Building type', 'Location', 'Assigned to', 'Branch', 'Created'];
  write(`\uFEFF${header.join(',')}\r\n`);
  let written = 0;
  let lastId: Id | undefined;
  for (;;) {
    const page = await r.find(lastId ? { $and: [filter, { _id: { $lt: lastId } }] } : filter).sort({ _id: -1 }).limit(BATCH).lean<EnquiryLean[]>();
    if (page.length === 0) break;
    for (const v of await viewsOf(principal, page)) {
      write(`${[v.enquiryNo, v.name, v.phone.replace(/^\+/, ''), v.stage.label, v.source?.label, v.type?.label, v.propertyType?.label, v.buildingType?.label, v.location?.label, v.assignedToName, v.branch?.name, v.createdAt?.toISOString()].map(csvCell).join(',')}\r\n`);
      written++;
    }
    lastId = page[page.length - 1]!._id;
  }
  await recordAudit({ entityType: 'export', entityId: principal.userId, action: 'enquiries', after: { rows: written, filters: JSON.stringify({ ...q, search: q.search ? '[set]' : undefined }) }, userId: principal.userId, branchId: q.branchId ?? principal.branchIds[0] }, { bestEffort: true });
  return written;
}


// ---- conversion to a client ---------------------------------------------------------------

/** A conversion touches the client records of the enquiry's own branch, even for an OWN-scope user (the permission decides who may convert). */
const domainScope = (principal: Principal, branchId: string): Principal => (principal.dataScope === 'OWN' ? { ...principal, dataScope: 'BRANCH', branchIds: [branchId] } : principal);

type ClientLean = { _id: Id; clientNo: string; personName: string; isArchived?: boolean };
const clientSummary = (c: ClientLean | null | undefined) => (c ? { id: c._id.toHexString(), clientNo: c.clientNo, name: c.personName } : undefined);

/** The active client of this enquiry's person in the enquiry's branch (the identity a client is unique by), if the caller may see it. */
async function clientOf(principal: Principal, e: EnquiryLean): Promise<ClientLean | null> {
  return scopedRepo(Client, principal).findOne({ personId: e.personId, branchId: e.branchId }).select('clientNo personName').lean<ClientLean>();
}

/** The stage that is entered by conversion, found from the workflow (never by name). */
function convertStageOf(wf: WorkflowDefinition) {
  return wf.stages.find((s) => s.entryPolicy === 'DOMAIN' && s.domainOperation === DOMAIN_OPERATIONS.convertEnquiry && s.isActive);
}

/** Eligible only from the stage just before the conversion stage (stages cannot be skipped), for an open, non-archived enquiry. */
async function conversionState(principal: Principal, e: EnquiryLean, wf: WorkflowDefinition) {
  const target = convertStageOf(wf);
  const already = Boolean(target && e.stageCode === target.systemKey);
  const next = wf.chain.find((s, i) => wf.chain[i - 1]?.systemKey === e.stageCode);
  const stageOk = Boolean(target && next && next.systemKey === target.systemKey);
  const permitted = hasConvertPermission(principal);
  const client = clientSummary(await clientOf(principal, e)); // the person's client in this branch, if any (explicit link from the enquiry)
  return { eligible: permitted && stageOk && !e.isArchived, alreadyConverted: already, stageKey: target?.systemKey, stageLabel: target?.label, client };
}
const hasConvertPermission = (p: Principal) => p.permissions.has('*') || (p.permissions.has('enquiries.convert') && p.permissions.has('clients.create'));

/**
 * Converts an enquiry to a client, once. The enquiry enters the conversion stage through this operation only (a plain move
 * is refused), and in ONE transaction: the client is created, or the person's existing client in this branch is linked (a
 * person is a client of a branch at most once, enforced by a unique index), the stage history, audit and activity are written.
 * Converting an enquiry that is already converted changes nothing and returns the same result.
 */
export async function convertEnquiry(principal: Principal, id: string, input: z.infer<typeof convertBody>) {
  assertPermission(principal, 'enquiries.convert');
  assertPermission(principal, 'clients.create'); // a conversion may create a client, so it needs the right to
  const e = await repo(principal, undefined, true).findById(id).lean<EnquiryLean>();
  if (!e) throw AppError.notFound('Enquiry not found');
  const branchId = e.branchId.toHexString();
  const ds = domainScope(principal, branchId);
  const wf = await loadWorkflow();
  const target = convertStageOf(wf);
  if (!target) throw new AppError('CONVERSION_UNAVAILABLE', 409, 'This workflow has no conversion stage');

  if (e.stageCode === target.systemKey) {
    const client = clientSummary(await clientOf(ds, e));
    return { alreadyConverted: true, createdClient: false, client, enquiry: (await viewsOf(principal, [e]))[0]! };
  }
  if (e.isArchived) throw new AppError('ENQUIRY_ARCHIVED', 409, 'An archived enquiry cannot be converted');
  if (wf.get(e.stageCode).kind === 'LOST') throw new AppError('ENQUIRY_LOST', 409, 'A lost enquiry cannot be converted; reopen it first');

  // Conversion is a terminal, irreversible step: only an enquiry that actually reached the stage
  // before "converted" may take it. This used to fall out of the adjacency check inside
  // prepareTransition, but that check no longer runs for domain operations (so a walk-in can be
  // booked or scheduled a visit without passing through every stage), so it is stated explicitly
  // here. Conversion deliberately keeps the strict rule even though its sibling operations do not.
  const previous = wf.chain.find((s, i) => wf.chain[i + 1]?.systemKey === target.systemKey);
  if (!previous || e.stageCode !== previous.systemKey) {
    throw new AppError('NOT_CONVERTIBLE', 409, `Only an enquiry in "${previous?.label ?? 'the previous stage'}" can be converted; this one is in "${wf.get(e.stageCode).label}"`);
  }
  if (input.categoryId) await assertActiveMaster(principal, 'CLIENT_CATEGORY', input.categoryId, 'categoryId');

  // Eligibility was checked above, so this can no longer fail on stage order; anything it does throw
  // (permissions, compare-and-set) is a genuine error and must surface as-is.
  const move = await prepareTransition(ds, e, { to: target.systemKey, reason: 'Converted to client' }, undefined, DOMAIN_OPERATIONS.convertEnquiry);

  const uid = toObjectId(principal.userId);
  let assignedTo = e.assignedTo?.toHexString();
  if (assignedTo) {
    try {
      await validateAssignee(ds, assignedTo, branchId);
    } catch {
      assignedTo = undefined; // an inactive or moved owner is not carried over to the client
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await clientOf(ds, e);
    const clientNo = existing ? undefined : await nextClientNo();
    try {
      const done = await withTransaction(async (session) => {
        let client: ClientLean = existing as ClientLean;
        if (!existing) {
          const doc = await scopedRepo(Client, ds).create(
            { clientNo, personId: e.personId, branchId: e.branchId, personName: e.personName, phoneE164: e.phoneE164, categoryId: input.categoryId ? toObjectId(input.categoryId) : undefined, assignedTo: assignedTo ? toObjectId(assignedTo) : undefined, notes: input.notes, createdBy: uid },
            { session },
          );
          client = doc.toObject() as unknown as ClientLean;
          await recordAudit({ entityType: 'client', entityId: doc._id, action: 'create', after: { clientNo, personId: e.personId, fromEnquiry: e.enquiryNo }, userId: principal.userId, branchId }, { session });
          await recordActivity({ type: 'CLIENT_CREATED', description: `Client ${e.personName} (${clientNo}) created from enquiry ${e.enquiryNo}`, branchId, userId: principal.userId, refs: [{ type: 'client', id: doc._id }, { type: 'person', id: e.personId }] }, { session });
        }
        const moved = await persistTransition(ds, e, move!, session);
        await recordAudit({ entityType: 'enquiry', entityId: e._id, action: 'convert', before: { stageCode: e.stageCode }, after: { stageCode: moved.stageCode, clientNo: client.clientNo, linkedExisting: Boolean(existing) }, userId: principal.userId, branchId }, { session });
        await recordActivity({ type: 'CLIENT_CONVERTED', description: `Enquiry ${e.enquiryNo} converted to client ${client.clientNo}${existing ? ' (existing client)' : ''}`, branchId, userId: principal.userId, refs: [{ type: 'enquiry', id: e._id }, { type: 'client', id: client._id }, { type: 'person', id: e.personId }], metadata: { linkedExisting: Boolean(existing) } }, { session });
        return { moved, client };
      });
      return { alreadyConverted: false, createdClient: !existing, client: clientSummary(done.client), enquiry: (await viewsOf(principal, [done.moved]))[0]! };
    } catch (err) {
      // A concurrent conversion created this person's client first: link it on the next pass instead of failing or duplicating.
      if (isDuplicateKey(err) && attempt === 0) continue;
      // A concurrent conversion of the same enquiry won: report the same result as converting an already-converted enquiry.
      if (err instanceof AppError && err.code === 'STAGE_CHANGED') {
        const now = await repo(principal, undefined, true).findById(id).lean<EnquiryLean>();
        if (now && now.stageCode === target.systemKey) return { alreadyConverted: true, createdClient: false, client: clientSummary(await clientOf(ds, now)), enquiry: (await viewsOf(principal, [now]))[0]! };
      }
      throw err;
    }
  }
  throw new AppError('CONVERSION_CONFLICT', 409, 'The enquiry was converted by someone else. Refresh and check the client.');
}
