import { Types, type ClientSession } from 'mongoose';
import type { z } from 'zod';
import { getEnv } from '../../config/env';
import { recordActivity } from '../../core/activity/activity.service';
import { recordAudit } from '../../core/audit/audit.service';
import { formatSequence, nextSequence } from '../../core/counters/counter.service';
import { notify } from '../../core/notify/notification.service';
import { hasPermission, type Principal } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import { escapeRegex, parseSort, toMeta, toWindow } from '../../lib/listQuery';
import { formatPhone, phoneSearchDigits } from '../../lib/phone';
import { formatLocal, nextLocalDayAt, zonedDayRange } from '../../lib/time';
import { withTransaction } from '../../lib/transaction';
import { Branch } from '../branches/branch.model';
import { Client } from '../clients/client.model';
import { Enquiry } from '../enquiries/enquiry.model';
import { persistTransition, prepareTransition, type EnquiryLean, type PreparedTransition } from '../enquiries/enquiry.service';
import { FollowUp } from '../followups/followup.model';
import { insertFollowUp, type FollowUpLean } from '../followups/followup.service';
import { masterLabels } from '../masters/master.service';
import { Unit } from '../units/unit.model';
import { validateAssignee } from '../users/assignable';
import { User } from '../users/user.model';
import { loadWorkflow } from '../workflow/workflow.service';
import { DOMAIN_OPERATIONS } from '../workflow/workflowDefaults';
import { getPostVisitFollowUpType, getVisitStatus } from './sitevisit.masters';
import { SiteVisit, SiteVisitAssignment } from './sitevisit.model';
import './sitevisit.references';
import type { assignBody, cancelBody, completeBody, createVisitBody, listVisitQuery, updateVisitBody, VisitFilters } from './sitevisit.schema';
import { canMove, isOpen, VISIT_STATUS } from './sitevisit.status';

const VISIT_NO = { prefix: 'SV-', width: 6 } as const;
export const nextVisitNo = async (): Promise<string> => formatSequence(await nextSequence('sitevisit'), VISIT_NO);

type Id = Types.ObjectId;
export type VisitLean = {
  _id: Id; visitNo: string; branchId: Id; enquiryId: Id; enquiryNo: string; personId: Id; personName: string; phoneE164: string; clientId?: Id | null; clientNo?: string | null;
  assignedTo: Id; assignedAt?: Date | null; scheduledAt: Date; units?: { unitId: Id; unitCode: string }[]; notes?: string | null; latitude?: number | null; longitude?: number | null;
  statusId: Id; statusKey: string; statusChangedAt: Date; completedAt?: Date | null; completedBy?: Id | null; feedback?: string | null; completionNotes?: string | null; followUpId?: Id | null;
  cancelledAt?: Date | null; cancelReason?: string | null; rescheduleCount?: number; isArchived?: boolean; createdAt?: Date; updatedAt?: Date;
};

const repo = (p: Principal, requestedBranchId?: string, includeArchived = false) => scopedRepo(SiteVisit, p, { requestedBranchId, includeArchived });
const when = (d: Date) => formatLocal(d, getEnv().APP_TIMEZONE);
const CLOCK_TOLERANCE_MS = 5 * 60_000;

function assertFuture(at: Date) {
  if (at.getTime() < Date.now() - CLOCK_TOLERANCE_MS) throw AppError.validation('The visit must be scheduled for a future time', [{ path: 'scheduledAt', message: 'Choose a time in the future' }]);
}
const closed = (v: Pick<VisitLean, 'statusKey'>) =>
  v.statusKey === VISIT_STATUS.completed ? new AppError('ALREADY_COMPLETED', 409, 'This site visit has already been completed') : AppError.conflict('VISIT_CLOSED', 'This site visit is already closed');
const changedElsewhere = () => AppError.conflict('VISIT_CHANGED', 'The site visit was changed by someone else. Refresh and try again.');

// ---- views ------------------------------------------------------------------

async function lookups(principal: Principal, rows: VisitLean[], detail = false) {
  const userIds = [...new Set(rows.map((r) => r.assignedTo.toHexString()))];
  const statusIds = [...new Set(rows.map((r) => r.statusId.toHexString()))];
  const branchIds = [...new Set(rows.map((r) => r.branchId.toHexString()))];
  const unitIds = detail ? [...new Set(rows.flatMap((r) => (r.units ?? []).map((u) => u.unitId.toHexString())))] : [];
  const [masters, users, branches, units] = await Promise.all([
    masterLabels(principal, statusIds),
    userIds.length ? scopedRepo(User, principal).find({ _id: { $in: userIds.map((i) => toObjectId(i)) } }).select('name').lean<{ _id: Id; name: string }[]>() : [],
    scopedRepo(Branch, principal).find({ _id: { $in: branchIds.map((i) => toObjectId(i)) } }).select('name code').lean<{ _id: Id; name: string; code: string }[]>(),
    // Names come from the units the VIEWER can see (archived included: history keeps its meaning); others show their code only.
    unitIds.length ? scopedRepo(Unit, principal, { includeArchived: true }).find({ _id: { $in: unitIds.map((i) => toObjectId(i)) } }).select('name isArchived').lean<{ _id: Id; name: string; isArchived?: boolean }[]>() : [],
  ]);
  return {
    masters,
    users: new Map(users.map((u) => [u._id.toHexString(), u.name])),
    branches: new Map(branches.map((b) => [b._id.toHexString(), { name: b.name, code: b.code }])),
    units: new Map(units.map((u) => [u._id.toHexString(), u])),
  };
}
type Lookups = Awaited<ReturnType<typeof lookups>>;

export function toView(v: VisitLean, l: Lookups, p: Principal) {
  const open = isOpen(v.statusKey) && !v.isArchived;
  const can = (k: Parameters<typeof hasPermission>[1]) => hasPermission(p, k);
  return {
    id: v._id.toHexString(),
    visitNo: v.visitNo,
    branchId: v.branchId.toHexString(),
    branch: l.branches.get(v.branchId.toHexString()),
    enquiryId: v.enquiryId.toHexString(), enquiryNo: v.enquiryNo,
    clientId: v.clientId?.toHexString(), clientNo: v.clientNo ?? undefined,
    personId: v.personId.toHexString(), name: v.personName, phone: formatPhone(v.phoneE164), phoneE164: v.phoneE164,
    assignedTo: v.assignedTo.toHexString(), assignedToName: l.users.get(v.assignedTo.toHexString()), assignedAt: v.assignedAt ?? undefined,
    scheduledAt: v.scheduledAt, rescheduleCount: v.rescheduleCount ?? 0,
    units: (v.units ?? []).map((u) => {
      const known = l.units.get(u.unitId.toHexString());
      return { id: u.unitId.toHexString(), unitCode: u.unitCode, name: known?.name, isArchived: known ? Boolean(known.isArchived) : undefined };
    }),
    unitCount: (v.units ?? []).length,
    notes: v.notes ?? undefined, latitude: v.latitude ?? undefined, longitude: v.longitude ?? undefined,
    statusId: v.statusId.toHexString(), statusKey: v.statusKey, status: l.masters.get(v.statusId.toHexString()), statusChangedAt: v.statusChangedAt,
    completedAt: v.completedAt ?? undefined, feedback: v.feedback ?? undefined, completionNotes: v.completionNotes ?? undefined, followUpId: v.followUpId?.toHexString(),
    cancelledAt: v.cancelledAt ?? undefined, cancelReason: v.cancelReason ?? undefined,
    isArchived: Boolean(v.isArchived), createdAt: v.createdAt, updatedAt: v.updatedAt,
    /** What this user may do with this visit right now; the UI shows exactly these controls (the API enforces them again). */
    allowed: {
      edit: open && can('sitevisits.edit'),
      assign: open && can('sitevisits.assign'),
      complete: open && can('sitevisits.complete'),
      cancel: open && can('sitevisits.cancel'),
      archive: !v.isArchived && !isOpen(v.statusKey) && can('sitevisits.archive'),
    },
  };
}

export async function viewsOf(principal: Principal, rows: VisitLean[], detail = false) {
  const l = await lookups(principal, rows, detail);
  return rows.map((r) => toView(r, l, principal));
}

// ---- filters ----------------------------------------------------------------

export function buildFilter(q: VisitFilters & { search?: string }, now = new Date()): Record<string, unknown> {
  const and: Record<string, unknown>[] = [{ isArchived: q.isArchived === 'true' }];
  const day = zonedDayRange(now, getEnv().APP_TIMEZONE);
  if (q.view === 'today') and.push({ scheduledAt: { $gte: day.start, $lt: day.end } });
  if (q.view === 'upcoming') and.push({ statusKey: VISIT_STATUS.scheduled, scheduledAt: { $gte: day.end } });
  if (q.view === 'overdue') and.push({ statusKey: VISIT_STATUS.scheduled, scheduledAt: { $lt: now } });
  if (q.status) and.push({ statusKey: { $in: q.status } });
  for (const f of ['assignedTo', 'enquiryId', 'personId'] as const) if (q[f]) and.push({ [f]: toObjectId(q[f]!) });
  if (q.unitId) and.push({ 'units.unitId': toObjectId(q.unitId) });
  if (q.from || q.to) and.push({ scheduledAt: { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) } });
  const term = q.search?.trim();
  if (term) {
    const ors: Record<string, unknown>[] = [
      { personName: new RegExp(escapeRegex(term), 'i') }, { visitNo: new RegExp(`^${escapeRegex(term)}`, 'i') },
      { enquiryNo: new RegExp(`^${escapeRegex(term)}`, 'i') }, { 'units.unitCode': new RegExp(`^${escapeRegex(term)}`, 'i') },
    ];
    const digits = phoneSearchDigits(term);
    if (digits) ors.push({ phoneE164: new RegExp(escapeRegex(digits)) });
    if (/^\d{1,9}$/.test(term)) ors.push({ visitNo: new RegExp(`^SV-0*${term.replace(/^0+/, '') || '0'}$`) });
    and.push({ $or: ors });
  }
  return { $and: and };
}

// ---- reads --------------------------------------------------------------------

export async function listVisits(principal: Principal, q: z.infer<typeof listVisitQuery>) {
  const filter = buildFilter(q);
  const r = repo(principal, q.branchId, true);
  const { skip, limit } = toWindow(q);
  const sort = parseSort(q.sort, ['scheduledAt', 'createdAt', 'visitNo', 'personName'], { scheduledAt: -1 });
  const [rows, total] = await Promise.all([
    r.find(filter).sort({ ...sort, _id: -1 }).collation({ locale: 'en', strength: 2 }).skip(skip).limit(limit).lean<VisitLean[]>(),
    r.countDocuments(filter),
  ]);
  return { rows: await viewsOf(principal, rows), meta: toMeta(q, total) };
}

export async function getVisit(principal: Principal, id: string) {
  const v = await repo(principal, undefined, true).findById(id).lean<VisitLean>();
  if (!v) throw AppError.notFound('Site visit not found');
  const [assignments, followUp] = await Promise.all([
    scopedRepo(SiteVisitAssignment, principal).find({ siteVisitId: v._id }).sort({ at: 1, _id: 1 }).lean<{ _id: Id; fromUserId?: Id | null; toUserId: Id; byUserId?: Id; reason?: string; at: Date }[]>(),
    v.followUpId ? scopedRepo(FollowUp, principal, { includeArchived: true }).findById(v.followUpId.toHexString()).select('scheduledAt statusKey assignedTo').lean<Pick<FollowUpLean, '_id' | 'scheduledAt' | 'statusKey'>>() : null,
  ]);
  const l = await lookups(principal, [v], true);
  const peopleIds = [...new Set(assignments.flatMap((a) => [a.fromUserId, a.toUserId, a.byUserId]).filter(Boolean).map((i) => i!.toHexString()))];
  const names = new Map(
    (peopleIds.length ? await scopedRepo(User, principal).find({ _id: { $in: peopleIds.map((i) => toObjectId(i)) } }).select('name').lean<{ _id: Id; name: string }[]>() : []).map((x) => [x._id.toHexString(), x.name]),
  );
  const name = (i?: Id | null) => (i ? names.get(i.toHexString()) : undefined);
  return {
    ...toView(v, l, principal),
    followUp: followUp ? { id: followUp._id.toHexString(), scheduledAt: followUp.scheduledAt, statusKey: followUp.statusKey } : undefined,
    assignments: assignments.map((a) => ({
      id: a._id.toHexString(), from: a.fromUserId?.toHexString(), fromName: name(a.fromUserId), to: a.toUserId.toHexString(), toName: name(a.toUserId),
      by: a.byUserId?.toHexString(), byName: name(a.byUserId), reason: a.reason, at: a.at,
    })),
  };
}

// ---- shared helpers ---------------------------------------------------------------

const auditView = (v: VisitLean) => ({ scheduledAt: v.scheduledAt, units: (v.units ?? []).map((u) => u.unitCode), notes: v.notes, latitude: v.latitude, longitude: v.longitude, statusKey: v.statusKey, assignedTo: v.assignedTo });

/** Everything the visit is about, so it appears on the enquiry's, person's, client's and every unit's timeline. */
const refsOf = (v: VisitLean) => [
  { type: 'sitevisit' as const, id: v._id },
  { type: 'enquiry' as const, id: v.enquiryId },
  { type: 'person' as const, id: v.personId },
  ...(v.clientId ? [{ type: 'client' as const, id: v.clientId }] : []),
  ...(v.units ?? []).map((u) => ({ type: 'unit' as const, id: u.unitId })),
];
const notifyRefs = (v: VisitLean) => [{ type: 'sitevisit', id: v._id }, { type: 'enquiry', id: v.enquiryId }];

/** Units must exist, be visible to the actor and belong to the visit's branch. Returns the references to store. */
async function resolveUnits(principal: Principal, branchId: Id, ids: string[]): Promise<{ unitId: Id; unitCode: string }[]> {
  if (ids.length === 0) return [];
  const found = await scopedRepo(Unit, principal).find({ _id: { $in: ids.map((i) => toObjectId(i)) } }).select('unitCode branchId').lean<{ _id: Id; unitCode: string; branchId: Id }[]>();
  const byId = new Map(found.map((u) => [u._id.toHexString(), u]));
  const details: { path: string; message: string }[] = [];
  const out = ids.map((id, i) => {
    const u = byId.get(id);
    if (!u) details.push({ path: `unitIds.${i}`, message: 'Choose a unit you have access to' });
    else if (!u.branchId.equals(branchId)) details.push({ path: `unitIds.${i}`, message: `${u.unitCode} belongs to another branch` });
    return u && { unitId: u._id, unitCode: u.unitCode };
  });
  if (details.length) throw AppError.validation('Invalid units', details);
  return out as { unitId: Id; unitCode: string }[];
}

/** The workflow stage whose entry is owned by a domain operation. Found by the operation, not by a hard-coded stage name. */
async function ownedStage(operation: string) {
  const wf = await loadWorkflow();
  const stage = wf.stages.find((s) => s.entryPolicy === 'DOMAIN' && s.domainOperation === operation && s.isActive);
  return { wf, stage };
}

// ---- schedule ------------------------------------------------------------------------

export async function createVisit(principal: Principal, input: z.infer<typeof createVisitBody>) {
  assertFuture(input.scheduledAt);
  const enquiry = await scopedRepo(Enquiry, principal).findById(input.enquiryId).lean<EnquiryLean>();
  if (!enquiry) throw AppError.notFound('Enquiry not found');
  const { wf, stage: scheduledStage } = await ownedStage(DOMAIN_OPERATIONS.scheduleVisit);
  if (wf.get(enquiry.stageCode).kind === 'LOST') throw new AppError('ENQUIRY_LOST', 409, 'A lost enquiry cannot have a site visit. Reopen it first.');
  const branchId = enquiry.branchId;
  const branch = branchId.toHexString();

  const units = await resolveUnits(principal, branchId, input.unitIds);

  let assignedTo = input.assignedTo;
  if (assignedTo) await validateAssignee(principal, assignedTo, branch);
  else {
    for (const candidate of [principal.dataScope === 'OWN' ? principal.userId : enquiry.assignedTo?.toHexString(), principal.userId]) {
      if (!candidate) continue;
      try {
        await validateAssignee(principal, candidate, branch);
        assignedTo = candidate;
        break;
      } catch {
        /* try the next candidate */
      }
    }
    if (!assignedTo) throw AppError.validation('Choose who will do this visit', [{ path: 'assignedTo', message: 'Required' }]);
  }

  // The enquiry enters "site visit scheduled" through this domain operation only, from the stage just before it.
  // A visit for an enquiry that is already at or past that stage (a second visit) does not move it.
  let move: PreparedTransition | undefined;
  if (scheduledStage && wf.get(enquiry.stageCode).order < scheduledStage.order) {
    move = await prepareTransition(principal, enquiry, { to: scheduledStage.systemKey, reason: 'Site visit scheduled' }, undefined, DOMAIN_OPERATIONS.scheduleVisit);
  }

  const status = await getVisitStatus(VISIT_STATUS.scheduled);
  const client = await scopedRepo(Client, principal).findOne({ personId: enquiry.personId, branchId }).select('clientNo').lean<{ _id: Id; clientNo: string }>();
  const visitNo = await nextVisitNo(); // unique and atomic; a failed create below only leaves a gap
  const now = new Date();
  const uid = toObjectId(principal.userId);

  const created = await withTransaction(async (session) => {
    const doc = await repo(principal).create(
      {
        visitNo, branchId, enquiryId: enquiry._id, enquiryNo: enquiry.enquiryNo, personId: enquiry.personId, personName: enquiry.personName, phoneE164: enquiry.phoneE164,
        ...(client ? { clientId: client._id, clientNo: client.clientNo } : {}),
        assignedTo: toObjectId(assignedTo!), assignedAt: now, scheduledAt: input.scheduledAt, units, notes: input.notes, latitude: input.latitude, longitude: input.longitude,
        statusId: status._id, statusKey: VISIT_STATUS.scheduled, statusChangedAt: now, createdBy: uid,
      },
      { session },
    );
    const v = doc.toObject() as unknown as VisitLean;
    await scopedRepo(SiteVisitAssignment, principal).create({ siteVisitId: v._id, branchId, toUserId: toObjectId(assignedTo!), byUserId: uid, at: now }, { session });
    if (move) await persistTransition(principal, enquiry, move, session);
    await recordAudit({ entityType: 'sitevisit', entityId: v._id, action: 'create', after: { ...auditView(v), enquiryNo: v.enquiryNo }, userId: principal.userId, branchId: branch }, { session });
    await recordActivity({ type: 'SITE_VISIT_CREATED', description: `Site visit ${visitNo} scheduled with ${v.personName} for ${when(v.scheduledAt)}`, branchId: branch, userId: principal.userId, at: now, refs: refsOf(v) }, { session });
    await notify({
      event: 'SITE_VISIT_ASSIGNED', branchId: branch, payload: { person: v.personName, visit: visitNo, when: when(v.scheduledAt) }, subjects: { assignee: assignedTo },
      refs: notifyRefs(v), dedupeKey: `sitevisit-assigned:${v._id}:${assignedTo}:create`, excludeUserId: principal.userId, session,
    });
    return v;
  });
  return (await viewsOf(principal, [created], true))[0]!;
}

// ---- update (descriptive fields of a scheduled visit) -------------------------------------

async function loadOpen(principal: Principal, id: string): Promise<VisitLean> {
  const v = await repo(principal).findById(id).lean<VisitLean>();
  if (!v) throw AppError.notFound('Site visit not found');
  if (!isOpen(v.statusKey)) throw closed(v);
  return v;
}

export async function updateVisit(principal: Principal, id: string, patch: z.infer<typeof updateVisitBody>) {
  const before = await loadOpen(principal, id);
  const branch = before.branchId.toHexString();
  const timeChanged = patch.scheduledAt !== undefined && patch.scheduledAt.getTime() !== before.scheduledAt.getTime();
  if (timeChanged) assertFuture(patch.scheduledAt!);

  const set: Record<string, unknown> = { updatedBy: toObjectId(principal.userId) };
  const unset: Record<string, 1> = {};
  if (timeChanged) set.scheduledAt = patch.scheduledAt;
  if (patch.notes === null) unset.notes = 1;
  else if (patch.notes !== undefined) set.notes = patch.notes;
  for (const f of ['latitude', 'longitude'] as const) {
    if (patch[f] === null) unset[f] = 1;
    else if (patch[f] !== undefined) set[f] = patch[f];
  }
  if (patch.unitIds) {
    // Units already on the visit stay valid as they are (they may have been archived or reassigned since); only NEW ones are checked.
    const have = new Map((before.units ?? []).map((u) => [u.unitId.toHexString(), u]));
    const fresh = patch.unitIds.filter((u) => !have.has(u));
    const added = await resolveUnits(principal, before.branchId, fresh);
    const addedBy = new Map(added.map((u) => [u.unitId.toHexString(), u]));
    set.units = patch.unitIds.map((u) => have.get(u) ?? addedBy.get(u)!);
  }

  const after = await withTransaction(async (session) => {
    const u = await repo(principal)
      .findOneAndUpdate(
        { _id: before._id, statusKey: VISIT_STATUS.scheduled },
        { $set: set, ...(Object.keys(unset).length || timeChanged ? { $unset: { ...unset, ...(timeChanged ? { upcomingNotifiedAt: 1 } : {}) } } : {}), ...(timeChanged ? { $inc: { rescheduleCount: 1 } } : {}) },
        { new: true, session },
      )
      .lean<VisitLean>();
    if (!u) throw changedElsewhere();
    await recordAudit({ entityType: 'sitevisit', entityId: before._id, action: 'update', before: auditView(before), after: auditView(u), userId: principal.userId, branchId: branch }, { session });
    await recordActivity({ type: 'SITE_VISIT_UPDATED', description: timeChanged ? `Site visit ${before.visitNo} rescheduled to ${when(u.scheduledAt)}` : `Site visit ${before.visitNo} updated`, branchId: branch, userId: principal.userId, refs: refsOf(u) }, { session });
    return u;
  });
  return (await viewsOf(principal, [after], true))[0]!;
}

// ---- assignment ------------------------------------------------------------------------

export async function assignVisit(principal: Principal, id: string, input: z.infer<typeof assignBody>) {
  const v = await loadOpen(principal, id);
  const branch = v.branchId.toHexString();
  await validateAssignee(principal, input.assignedTo, branch); // OWN scope: self only; otherwise an active user of THIS branch the actor can see
  const prev = v.assignedTo;
  if (prev.toHexString() === input.assignedTo) throw new AppError('NO_CHANGE', 409, 'The visit is already assigned to that person');
  if (!input.reason) throw AppError.validation('A reason is required to reassign a visit', [{ path: 'reason', message: 'Required' }]);

  const now = new Date();
  const uid = toObjectId(principal.userId);
  const to = toObjectId(input.assignedTo);
  const updated = await withTransaction(async (session) => {
    // Conditional on the previous assignee AND the visit still being open: simultaneous changes cannot both win.
    const x = await repo(principal)
      .findOneAndUpdate({ _id: v._id, assignedTo: prev, statusKey: VISIT_STATUS.scheduled }, { $set: { assignedTo: to, assignedAt: now, updatedBy: uid }, $unset: { upcomingNotifiedAt: 1 } }, { new: true, session })
      .lean<VisitLean>();
    if (!x) throw AppError.conflict('ASSIGNMENT_CHANGED', 'The visit was reassigned or closed by someone else. Refresh and try again.');
    await scopedRepo(SiteVisitAssignment, principal).create({ siteVisitId: v._id, branchId: v.branchId, fromUserId: prev, toUserId: to, byUserId: uid, reason: input.reason, at: now }, { session });
    await recordAudit({ entityType: 'sitevisit', entityId: v._id, action: 'assign', before: { assignedTo: prev }, after: { assignedTo: to }, reason: input.reason, userId: principal.userId, branchId: branch }, { session });
    await recordActivity({ type: 'SITE_VISIT_ASSIGNED', description: `Site visit ${v.visitNo} reassigned`, branchId: branch, userId: principal.userId, at: now, refs: refsOf(x), metadata: { from: prev.toHexString(), to: input.assignedTo } }, { session });
    await notify({
      event: 'SITE_VISIT_ASSIGNED', branchId: branch, payload: { person: v.personName, visit: v.visitNo, when: when(v.scheduledAt) }, subjects: { assignee: input.assignedTo },
      refs: notifyRefs(v), dedupeKey: `sitevisit-assigned:${v._id}:${input.assignedTo}:${now.getTime()}`, excludeUserId: principal.userId, session,
    });
    return x;
  });
  return (await viewsOf(principal, [updated], true))[0]!;
}

// ---- complete ----------------------------------------------------------------------------

/**
 * Whoever is assigned a visit may complete it even when they cannot see the enquiry itself (a field executive
 * on a manager's enquiry). Completing is the visit's own authority over THAT enquiry and the follow-up it
 * creates, so those two steps run with the visit's branch as scope. The caller's permissions are unchanged.
 */
function domainScope(principal: Principal, branchId: string): Principal {
  return principal.dataScope === 'OWN' ? { ...principal, dataScope: 'BRANCH', branchIds: [branchId] } : principal;
}

export async function completeVisit(principal: Principal, id: string, input: z.infer<typeof completeBody>) {
  const v = await loadOpen(principal, id);
  const branch = v.branchId.toHexString();
  const now = new Date();
  const completedAt = input.completedAt ?? now;
  if (completedAt.getTime() > now.getTime() + CLOCK_TOLERANCE_MS) throw AppError.validation('The completion time cannot be in the future', [{ path: 'completedAt', message: 'Choose a time that has passed' }]);

  const ds = domainScope(principal, branch);
  const env = getEnv();
  const enquiry = await scopedRepo(Enquiry, ds, { includeArchived: true }).findById(v.enquiryId.toHexString()).lean<EnquiryLean>();
  if (!enquiry) throw new AppError('ENQUIRY_UNAVAILABLE', 409, 'The enquiry of this visit is no longer available');

  // Configuration problems are reported BEFORE anything is written, so a completion never half-succeeds.
  const followUpType = await getPostVisitFollowUpType(env.POST_VISIT_FOLLOWUP_TYPE_CODE);
  const done = await getVisitStatus(VISIT_STATUS.completed);

  // The follow-up goes to whoever handles the enquiry, else the visit's assignee, else the person completing.
  let followUpAssignee: string | undefined;
  for (const candidate of [enquiry.assignedTo?.toHexString(), v.assignedTo.toHexString(), principal.userId]) {
    if (!candidate) continue;
    try {
      await validateAssignee(ds, candidate, branch);
      followUpAssignee = candidate;
      break;
    } catch {
      /* try the next candidate */
    }
  }
  if (!followUpAssignee) throw AppError.validation('No active employee is available for the follow-up', [{ path: 'assignedTo', message: 'Required' }]);

  // The enquiry enters "site visit completed" through this domain operation only, from "site visit scheduled".
  const { wf, stage: scheduledStage } = await ownedStage(DOMAIN_OPERATIONS.scheduleVisit);
  const { stage: completedStage } = await ownedStage(DOMAIN_OPERATIONS.completeVisit);
  let move: PreparedTransition | undefined;
  if (scheduledStage && completedStage && enquiry.stageCode === scheduledStage.systemKey && !enquiry.isArchived) {
    move = await prepareTransition(ds, enquiry, { to: completedStage.systemKey, reason: `Site visit ${v.visitNo} completed` }, undefined, DOMAIN_OPERATIONS.completeVisit);
  }
  void wf;

  const nextDay = nextLocalDayAt(now, env.APP_TIMEZONE, env.POST_VISIT_FOLLOWUP_HOUR);
  const uid = toObjectId(principal.userId);

  try {
    const result = await withTransaction(async (session: ClientSession) => {
      // 1. Claim: only one completion can move a SCHEDULED visit. A retry or a race finds nothing here and stops.
      const u = await repo(principal)
        .findOneAndUpdate(
          { _id: v._id, statusKey: VISIT_STATUS.scheduled },
          { $set: { statusId: done._id, statusKey: VISIT_STATUS.completed, statusChangedAt: now, completedAt, completedBy: uid, feedback: input.feedback, completionNotes: input.notes, updatedBy: uid, ...(input.latitude !== undefined ? { latitude: input.latitude, longitude: input.longitude } : {}) } },
          { new: true, session },
        )
        .lean<VisitLean>();
      if (!u) throw changedElsewhere();

      // 2. Exactly one next-day follow-up, unique per visit at the database level.
      const f = await insertFollowUp(
        ds,
        {
          anchor: { enquiryId: enquiry._id, enquiryNo: enquiry.enquiryNo }, person: { personId: enquiry.personId, personName: enquiry.personName, phoneE164: enquiry.phoneE164, branchId: enquiry.branchId },
          typeId: followUpType._id.toHexString(), assignedTo: followUpAssignee!, scheduledAt: nextDay, label: followUpType.label, siteVisitId: v._id,
          notes: `Follow up after site visit ${v.visitNo}`,
        },
        session,
      );
      const withFollowUp = await repo(principal).findOneAndUpdate({ _id: v._id }, { $set: { followUpId: f._id } }, { new: true, session }).lean<VisitLean>();

      // 3. The enquiry moves to "site visit completed" under the same transaction.
      if (move) await persistTransition(ds, enquiry, move, session);

      await recordAudit({ entityType: 'sitevisit', entityId: v._id, action: 'complete', before: { statusKey: v.statusKey }, after: { statusKey: VISIT_STATUS.completed, completedAt, followUpId: f._id }, userId: principal.userId, branchId: branch }, { session });
      await recordActivity({ type: 'SITE_VISIT_COMPLETED', description: `Site visit ${v.visitNo} with ${v.personName} completed`, branchId: branch, userId: principal.userId, at: now, refs: refsOf(v), metadata: { followUpId: f._id.toHexString() } }, { session });
      return withFollowUp ?? u;
    });
    return (await viewsOf(principal, [result], true))[0]!;
  } catch (err) {
    // A concurrent completion that got past the claim can only lose on the unique follow-up index: same outcome as a retry.
    if ((err as { code?: number }).code === 11000) throw changedElsewhere();
    throw err;
  }
}

// ---- cancel ------------------------------------------------------------------------------

/** Cancelling never moves the enquiry and never creates a follow-up. */
export async function cancelVisit(principal: Principal, id: string, input: z.infer<typeof cancelBody>) {
  const v = await loadOpen(principal, id);
  if (!canMove(v.statusKey, VISIT_STATUS.cancelled)) throw closed(v);
  const status = await getVisitStatus(VISIT_STATUS.cancelled);
  const branch = v.branchId.toHexString();
  const now = new Date();
  const uid = toObjectId(principal.userId);
  const updated = await withTransaction(async (session) => {
    const x = await repo(principal)
      .findOneAndUpdate({ _id: v._id, statusKey: VISIT_STATUS.scheduled }, { $set: { statusId: status._id, statusKey: VISIT_STATUS.cancelled, statusChangedAt: now, cancelledAt: now, cancelledBy: uid, cancelReason: input.reason, updatedBy: uid } }, { new: true, session })
      .lean<VisitLean>();
    if (!x) throw changedElsewhere();
    await recordAudit({ entityType: 'sitevisit', entityId: v._id, action: 'cancel', before: { statusKey: v.statusKey }, after: { statusKey: VISIT_STATUS.cancelled }, reason: input.reason, userId: principal.userId, branchId: branch }, { session });
    await recordActivity({ type: 'SITE_VISIT_CANCELLED', description: `Site visit ${v.visitNo} with ${v.personName} cancelled`, branchId: branch, userId: principal.userId, at: now, refs: refsOf(v), metadata: { reason: input.reason } }, { session });
    return x;
  });
  return (await viewsOf(principal, [updated], true))[0]!;
}

// ---- archive -------------------------------------------------------------------------------

export async function archiveVisit(principal: Principal, id: string) {
  const r = repo(principal);
  const v = await r.findById(id).lean<VisitLean>();
  if (!v) throw AppError.notFound('Site visit not found');
  const branch = v.branchId.toHexString();
  await withTransaction(async (session) => {
    // Only a closed visit can be archived; the condition is part of the write, so a visit is never hidden while still scheduled.
    const done = await r.archiveOne({ _id: v._id, statusKey: { $ne: VISIT_STATUS.scheduled } }, principal.userId, { session });
    if (!done) {
      const now = await r.findById(id).select('statusKey').lean<{ statusKey: string }>();
      if (now && isOpen(now.statusKey)) throw new AppError('VISIT_OPEN', 409, 'A scheduled visit cannot be archived. Complete or cancel it first.');
      throw AppError.notFound('Site visit not found');
    }
    await recordAudit({ entityType: 'sitevisit', entityId: v._id, action: 'archive', before: { isArchived: false }, after: { isArchived: true }, userId: principal.userId, branchId: branch }, { session });
    await recordActivity({ type: 'SITE_VISIT_ARCHIVED', description: `Site visit ${v.visitNo} archived`, branchId: branch, userId: principal.userId, refs: refsOf(v) }, { session });
  });
}
