import type { ClientSession, Types } from 'mongoose';
import type { z } from 'zod';
import { recordActivity } from '../../core/activity/activity.service';
import { recordAudit } from '../../core/audit/audit.service';
import { formatSequence, nextSequence } from '../../core/counters/counter.service';
import { hasPermission, type Principal } from '../../core/permissions/principal';
import { resolveWriteBranch, scopedRepo } from '../../core/scope';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import { escapeRegex, parseSort, toMeta, toWindow } from '../../lib/listQuery';
import { formatPhone, normalizePhone, phoneSearchDigits } from '../../lib/phone';
import { withTransaction } from '../../lib/transaction';
import { Branch } from '../branches/branch.model';
import { Client } from '../clients/client.model';
import { Enquiry } from '../enquiries/enquiry.model';
import { masterLabels } from '../masters/master.service';
import { Person } from '../persons/person.model';
import { findMatch, isDuplicateKey, materializePerson, personExists, personView, preparePerson, type PreparedPerson } from '../persons/person.service';
import { validateAssignee } from '../users/assignable';
import { User } from '../users/user.model';
import { listStages } from '../workflow/workflow.service';
import { getReferralType } from './referral.masters';
import { Referral, ReferralAssignment } from './referral.model';
import './referral.references';
import type { assignBody, createReferralBody, fromClientBody, fromUserBody, listReferralQuery, ReferralFilters, updateReferralBody } from './referral.schema';
import { REFERRAL_TYPE_KEYS, type ReferralTypeKey } from './referral.types';

const REFERRAL_NO = { prefix: 'REF-', width: 6 } as const;
export const nextReferralNo = async (): Promise<string> => formatSequence(await nextSequence('referral'), REFERRAL_NO);

type Id = Types.ObjectId;
export type ReferralLean = {
  _id: Id; referralNo: string; branchId: Id; personId: Id; personName: string; phoneE164: string; typeId: Id;
  sourceClientId?: Id | null; sourceClientNo?: string | null; sourceUserId?: Id | null; reason?: string | null; notes?: string | null;
  assignedTo?: Id | null; assignedAt?: Date | null; enquiryIds?: Id[]; isArchived?: boolean; createdAt?: Date; updatedAt?: Date;
};

const repo = (p: Principal, requestedBranchId?: string, includeArchived = false) => scopedRepo(Referral, p, { requestedBranchId, includeArchived });
const oid = (v?: string | null) => (v ? toObjectId(v) : undefined);

// ---- views ------------------------------------------------------------------

async function lookups(principal: Principal, rows: ReferralLean[]) {
  const masterIds = [...new Set(rows.map((r) => r.typeId.toHexString()))];
  const userIds = [...new Set(rows.map((r) => r.assignedTo?.toHexString()).filter(Boolean) as string[])];
  const branchIds = [...new Set(rows.map((r) => r.branchId.toHexString()))];
  const [masters, users, branches] = await Promise.all([
    masterIds.length ? masterLabels(principal, masterIds) : new Map(), // includes inactive values: history keeps its meaning
    userIds.length ? scopedRepo(User, principal).find({ _id: { $in: userIds.map((i) => toObjectId(i)) } }).select('name').lean<{ _id: Id; name: string }[]>() : [],
    scopedRepo(Branch, principal).find({ _id: { $in: branchIds.map((i) => toObjectId(i)) } }).select('name code').lean<{ _id: Id; name: string; code: string }[]>(),
  ]);
  return {
    masters,
    users: new Map(users.map((u) => [u._id.toHexString(), u.name])),
    branches: new Map(branches.map((b) => [b._id.toHexString(), { name: b.name, code: b.code }])),
  };
}
type Lookups = Awaited<ReturnType<typeof lookups>>;

export function toView(r: ReferralLean, l: Lookups, p: Principal) {
  const live = !r.isArchived;
  const can = (k: Parameters<typeof hasPermission>[1]) => hasPermission(p, k);
  return {
    id: r._id.toHexString(), referralNo: r.referralNo, branchId: r.branchId.toHexString(), branch: l.branches.get(r.branchId.toHexString()),
    personId: r.personId.toHexString(), name: r.personName, phone: formatPhone(r.phoneE164), phoneE164: r.phoneE164,
    typeId: r.typeId.toHexString(), type: l.masters.get(r.typeId.toHexString()),
    sourceClientId: r.sourceClientId?.toHexString(), sourceClientNo: r.sourceClientNo ?? undefined, sourceUserId: r.sourceUserId?.toHexString(),
    reason: r.reason ?? undefined, notes: r.notes ?? undefined,
    assignedTo: r.assignedTo?.toHexString(), assignedToName: r.assignedTo ? l.users.get(r.assignedTo.toHexString()) : undefined, assignedAt: r.assignedAt ?? undefined,
    enquiryCount: (r.enquiryIds ?? []).length,
    isArchived: Boolean(r.isArchived), createdAt: r.createdAt, updatedAt: r.updatedAt,
    /** What this user may do right now; the UI shows exactly these controls (the API enforces them again). */
    allowed: { edit: live && can('referrals.edit'), assign: live && can('referrals.assign'), link: live && can('referrals.edit'), archive: live && can('referrals.archive') },
  };
}

export async function viewsOf(principal: Principal, rows: ReferralLean[]) {
  const l = await lookups(principal, rows);
  return rows.map((r) => toView(r, l, principal));
}

// ---- reads --------------------------------------------------------------------

export function buildFilter(q: ReferralFilters & { search?: string }): Record<string, unknown> {
  const and: Record<string, unknown>[] = [{ isArchived: q.isArchived === 'true' }];
  if (q.typeId) and.push({ typeId: toObjectId(q.typeId) });
  if (q.assignedTo === 'unassigned') and.push({ assignedTo: null });
  else if (q.assignedTo) and.push({ assignedTo: toObjectId(q.assignedTo) });
  if (q.enquiryId) and.push({ enquiryIds: toObjectId(q.enquiryId) });
  if (q.from || q.to) and.push({ createdAt: { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) } });
  const term = q.search?.trim();
  if (term) {
    const ors: Record<string, unknown>[] = [{ personName: new RegExp(escapeRegex(term), 'i') }, { referralNo: new RegExp(`^${escapeRegex(term)}`, 'i') }];
    const digits = phoneSearchDigits(term);
    if (digits) ors.push({ phoneE164: new RegExp(escapeRegex(digits)) });
    if (/^\d{1,9}$/.test(term)) ors.push({ referralNo: new RegExp(`^REF-0*${term.replace(/^0+/, '') || '0'}$`) });
    and.push({ $or: ors });
  }
  return { $and: and };
}

export async function listReferrals(principal: Principal, q: z.infer<typeof listReferralQuery>) {
  const filter = buildFilter(q);
  const r = repo(principal, q.branchId, true);
  const { skip, limit } = toWindow(q);
  const sort = parseSort(q.sort, ['createdAt', 'referralNo', 'personName'], { createdAt: -1 });
  const [rows, total] = await Promise.all([
    r.find(filter).sort({ ...sort, _id: -1 }).collation({ locale: 'en', strength: 2 }).skip(skip).limit(limit).lean<ReferralLean[]>(),
    r.countDocuments(filter),
  ]);
  return { rows: await viewsOf(principal, rows), meta: toMeta(q, total) };
}

export async function getReferral(principal: Principal, id: string) {
  const r = await repo(principal, undefined, true).findById(id).lean<ReferralLean>();
  if (!r) throw AppError.notFound('Referral not found');
  const enquiryIds = r.enquiryIds ?? [];
  const [person, client, employee, enquiries, assignments, stages] = await Promise.all([
    scopedRepo(Person, principal).findById(r.personId.toHexString()).lean(),
    r.sourceClientId ? scopedRepo(Client, principal, { includeArchived: true }).findById(r.sourceClientId.toHexString()).select('clientNo').lean<{ _id: Id; clientNo: string }>() : null,
    r.sourceUserId ? scopedRepo(User, principal).findById(r.sourceUserId.toHexString()).select('name').lean<{ _id: Id; name: string }>() : null,
    // Only enquiries the viewer may see; the rest are simply not listed (no counts or names leak).
    enquiryIds.length ? scopedRepo(Enquiry, principal, { includeArchived: true }).find({ _id: { $in: enquiryIds } }).select('enquiryNo personName stageCode isArchived').lean<{ _id: Id; enquiryNo: string; personName: string; stageCode: string; isArchived?: boolean }[]>() : [],
    scopedRepo(ReferralAssignment, principal).find({ referralId: r._id }).sort({ at: 1, _id: 1 }).lean<{ _id: Id; fromUserId?: Id | null; toUserId: Id; byUserId?: Id; reason?: string; at: Date }[]>(),
    listStages(true),
  ]);
  const l = await lookups(principal, [r]);
  const peopleIds = [...new Set(assignments.flatMap((a) => [a.fromUserId, a.toUserId, a.byUserId]).filter(Boolean).map((i) => i!.toHexString()))];
  const names = new Map((peopleIds.length ? await scopedRepo(User, principal).find({ _id: { $in: peopleIds.map((i) => toObjectId(i)) } }).select('name').lean<{ _id: Id; name: string }[]>() : []).map((u) => [u._id.toHexString(), u.name]));
  const name = (i?: Id | null) => (i ? names.get(i.toHexString()) : undefined);
  const stageLabel = new Map(stages.map((s) => [s.systemKey, s.label]));
  return {
    ...toView(r, l, principal),
    person: person ? personView(person as never, principal) : undefined,
    sourceClient: client ? { id: client._id.toHexString(), clientNo: client.clientNo } : undefined,
    sourceEmployee: employee ? { id: employee._id.toHexString(), name: employee.name } : undefined,
    enquiries: enquiries.map((e) => ({ id: e._id.toHexString(), enquiryNo: e.enquiryNo, name: e.personName, stageCode: e.stageCode, stageLabel: stageLabel.get(e.stageCode) ?? e.stageCode, isArchived: Boolean(e.isArchived) })),
    assignments: assignments.map((a) => ({
      id: a._id.toHexString(), from: a.fromUserId?.toHexString(), fromName: name(a.fromUserId), to: a.toUserId.toHexString(), toName: name(a.toUserId),
      by: a.byUserId?.toHexString(), byName: name(a.byUserId), reason: a.reason, at: a.at,
    })),
  };
}

// ---- creation (three flows, one writer) ------------------------------------------------

type Flow = 'client' | 'employee' | 'external';
const FLOW_AUDIT: Record<Flow, string> = { client: 'convert_client', employee: 'convert_employee', external: 'create_external' };
interface PersonRef { _id: Id; name: string; phoneE164: string }

interface NewReferral {
  flow: Flow;
  branchId: string;
  typeKey: ReferralTypeKey;
  source?: { clientId?: Id; clientNo?: string; userId?: Id };
  assignedTo?: string;
  notes?: string;
  reason?: string;
}

/**
 * The one place a referral is written, inside the caller's transaction: the person (reused or created, by the flow), the
 * record, its first assignment, audit and timeline. The partial unique index (branch + person, not archived) is what
 * stops a repeated or concurrent conversion from creating a second record; the clash is reported as REFERRAL_EXISTS.
 * Any failure rolls the person, the record and the history back together.
 */
async function createInTx(principal: Principal, n: NewReferral, ids: { referralNo: string; typeId: Id }, person: (session: ClientSession) => Promise<PersonRef>, session: ClientSession): Promise<ReferralLean> {
  const now = new Date();
  const uid = toObjectId(principal.userId);
  const p = await person(session);
  const doc = await repo(principal).create(
    {
      referralNo: ids.referralNo, branchId: toObjectId(n.branchId), personId: p._id, personName: p.name, phoneE164: p.phoneE164, typeId: ids.typeId,
      ...(n.source?.clientId ? { sourceClientId: n.source.clientId, sourceClientNo: n.source.clientNo } : {}), ...(n.source?.userId ? { sourceUserId: n.source.userId } : {}),
      reason: n.reason, notes: n.notes, assignedTo: oid(n.assignedTo), assignedAt: n.assignedTo ? now : undefined, createdBy: uid,
    },
    { session },
  );
  const r = doc.toObject() as unknown as ReferralLean;
  if (n.assignedTo) await scopedRepo(ReferralAssignment, principal).create({ referralId: r._id, branchId: r.branchId, toUserId: toObjectId(n.assignedTo), byUserId: uid, at: now }, { session });
  await recordAudit({ entityType: 'referral', entityId: r._id, action: FLOW_AUDIT[n.flow], after: { referralNo: r.referralNo, personId: r.personId, type: n.typeKey, sourceClientId: r.sourceClientId, sourceUserId: r.sourceUserId, assignedTo: r.assignedTo, reason: r.reason }, reason: n.reason, userId: principal.userId, branchId: n.branchId }, { session });
  const refs = [{ type: 'referral' as const, id: r._id }, { type: 'person' as const, id: r.personId }, ...(r.sourceClientId ? [{ type: 'client' as const, id: r.sourceClientId }] : [])];
  const how = n.flow === 'client' ? `from client ${r.sourceClientNo}` : n.flow === 'employee' ? 'from an employee' : 'as an external referrer';
  await recordActivity({ type: 'REFERRAL_CREATED', description: `${r.personName} added as referral ${r.referralNo} ${how}`, branchId: n.branchId, userId: principal.userId, at: now, refs, metadata: { flow: n.flow } }, { session });
  return r;
}

async function create(principal: Principal, n: NewReferral, person: (session: ClientSession) => Promise<PersonRef>, clash: { personId?: Id; phone?: string } = {}) {
  const type = await getReferralType(n.typeKey);
  const referralNo = await nextReferralNo(); // atomic; a failed create below only leaves a gap
  try {
    const r = await withTransaction((session) => createInTx(principal, n, { referralNo, typeId: type._id }, person, session));
    return (await viewsOf(principal, [r]))[0]!;
  } catch (err) {
    const keys = (err as { keyPattern?: Record<string, unknown> }).keyPattern;
    if (isDuplicateKey(err) && keys) {
      // Lost a race: another request created the same person (phone is unique) or the same referral (one per person and branch).
      if ('phoneE164' in keys && clash.phone) throw personExists(await findMatch(principal, clash.phone));
      if ('personId' in keys && clash.personId) throw await existsError(principal, n.branchId, clash.personId);
    }
    throw err;
  }
}

async function existsError(principal: Principal, branchId: string, personId: Id): Promise<AppError> {
  const existing = await scopedRepo(Referral, principal).findOne({ branchId: toObjectId(branchId), personId }).select('referralNo').lean<{ _id: Id; referralNo: string }>();
  return AppError.conflict('REFERRAL_EXISTS', existing ? `This person is already a referral of this branch (${existing.referralNo})` : 'This person is already a referral of this branch', existing ? { referralId: existing._id.toHexString(), referralNo: existing.referralNo } : undefined);
}

/** Cheap pre-check (the index is the real guard) so ordinary repeats do not spend a number. */
async function assertNotReferral(principal: Principal, branchId: string, personId: Id) {
  if (await scopedRepo(Referral, principal).exists({ branchId: toObjectId(branchId), personId })) throw await existsError(principal, branchId, personId);
}

async function defaultAssignee(principal: Principal, branchId: string, requested?: string): Promise<string | undefined> {
  const assignedTo = requested ?? (principal.dataScope === 'OWN' ? principal.userId : undefined);
  if (assignedTo) await validateAssignee(principal, assignedTo, branchId);
  return assignedTo;
}

/** EXTERNAL: a person who is neither a client nor an employee. Uses the Phase 4 identity resolution unchanged. */
export async function createExternal(principal: Principal, input: z.infer<typeof createReferralBody>) {
  const branchId = resolveWriteBranch(principal, input.branchId);
  const assignedTo = await defaultAssignee(principal, branchId, input.assignedTo);
  const prepared = await preparePerson(principal, input); // 404 for a person the caller cannot see; 409 PERSON_EXISTS for a phone that exists (visible or hidden)
  const existingId = 'existing' in prepared ? prepared.existing._id : undefined;
  if (existingId) await assertNotReferral(principal, branchId, existingId);
  return create(principal, { flow: 'external', branchId, typeKey: REFERRAL_TYPE_KEYS.external, assignedTo, notes: input.notes, reason: input.reason }, (session) => materialize(principal, prepared, branchId, session), { personId: existingId, phone: input.person?.phone });
}

async function materialize(principal: Principal, prepared: PreparedPerson, branchId: string, session: ClientSession): Promise<PersonRef> {
  const p = await materializePerson(principal, prepared, branchId, session); // creates the person, or only adds this branch to an existing one: nothing else about it changes
  return { _id: p._id, name: p.name, phoneE164: p.phoneE164 };
}

/** CLIENT: the client's own person is used as is. The client is found through the normal branch / ownership scope. */
export async function createFromClient(principal: Principal, clientId: string, input: z.infer<typeof fromClientBody>) {
  const client = await scopedRepo(Client, principal).findById(clientId).lean<{ _id: Id; clientNo: string; personId: Id; branchId: Id; personName: string; phoneE164: string }>();
  if (!client) throw AppError.notFound('Client not found');
  const branchId = client.branchId.toHexString();
  const assignedTo = await defaultAssignee(principal, branchId, input.assignedTo);
  await assertNotReferral(principal, branchId, client.personId);
  return create(
    principal,
    { flow: 'client', branchId, typeKey: REFERRAL_TYPE_KEYS.client, source: { clientId: client._id, clientNo: client.clientNo }, assignedTo, notes: input.notes, reason: input.reason },
    async () => ({ _id: client.personId, name: client.personName, phoneE164: client.phoneE164 }), // the existing identity: nothing is copied or created
    { personId: client.personId },
  );
}

/**
 * EMPLOYEE: the employee must be visible, active and belong to the branch. Their identity is their phone: an existing
 * person with that number that the caller can see is reused; a person that exists only in other branches is reported
 * (never disclosed or attached); otherwise a person is created from the employee's name and phone, in the same transaction.
 */
export async function createFromUser(principal: Principal, userId: string, input: z.infer<typeof fromUserBody>) {
  const user = await scopedRepo(User, principal).findById(userId).select('name phone isActive branchIds').lean<{ _id: Id; name: string; phone?: string | null; isActive: boolean; branchIds: Id[] }>();
  if (!user) throw AppError.notFound('Employee not found');
  if (!user.isActive) throw AppError.validation('This employee is not active', [{ path: 'userId', message: 'Choose an active employee' }]);
  const branchId = resolveWriteBranch(principal, input.branchId ?? (user.branchIds.length === 1 ? user.branchIds[0]!.toHexString() : undefined));
  if (!user.branchIds.some((b) => b.toHexString() === branchId)) throw AppError.validation('The employee does not belong to that branch', [{ path: 'branchId', message: "Choose one of the employee's branches" }]);
  const phone = normalizePhone(user.phone);
  if (!phone) throw AppError.validation("The employee has no valid phone number, so cannot be a referral yet. Add it to the employee's profile.", [{ path: 'userId', message: 'Phone number missing' }]);
  const assignedTo = await defaultAssignee(principal, branchId, input.assignedTo);

  const match = await findMatch(principal, phone);
  if (match.status === 'HIDDEN_MATCH') throw personExists(match); // never attach or reveal a person of another branch
  const prepared: PreparedPerson = match.status === 'VISIBLE_MATCH' ? await preparePerson(principal, { personId: match.person!.id }) : { fresh: { name: user.name, phone } };
  const existingId = 'existing' in prepared ? prepared.existing._id : undefined;
  if (existingId) await assertNotReferral(principal, branchId, existingId);
  return create(principal, { flow: 'employee', branchId, typeKey: REFERRAL_TYPE_KEYS.employee, source: { userId: user._id }, assignedTo, notes: input.notes, reason: input.reason }, (session) => materialize(principal, prepared, branchId, session), { personId: existingId, phone });
}

// ---- update (notes only) ---------------------------------------------------------------------

const auditView = (r: ReferralLean) => ({ notes: r.notes, assignedTo: r.assignedTo, enquiryIds: r.enquiryIds });

export async function updateReferral(principal: Principal, id: string, patch: z.infer<typeof updateReferralBody>) {
  const r = repo(principal);
  const before = await r.findById(id).lean<ReferralLean>();
  if (!before) throw AppError.notFound('Referral not found');
  const branchId = before.branchId.toHexString();
  const after = await withTransaction(async (session) => {
    const u = await r
      .findOneAndUpdate({ _id: before._id }, patch.notes === null ? { $unset: { notes: 1 }, $set: { updatedBy: toObjectId(principal.userId) } } : { $set: { notes: patch.notes, updatedBy: toObjectId(principal.userId) } }, { new: true, session })
      .lean<ReferralLean>();
    if (!u) throw AppError.notFound('Referral not found');
    await recordAudit({ entityType: 'referral', entityId: before._id, action: 'update', before: auditView(before), after: auditView(u), userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'REFERRAL_UPDATED', description: `Referral ${before.referralNo} updated`, branchId, userId: principal.userId, refs: [{ type: 'referral', id: before._id }, { type: 'person', id: before.personId }] }, { session });
    return u;
  });
  return (await viewsOf(principal, [after]))[0]!;
}

// ---- assignment ---------------------------------------------------------------------------------

export async function assignReferral(principal: Principal, id: string, input: z.infer<typeof assignBody>) {
  const r = repo(principal);
  const ref = await r.findById(id).lean<ReferralLean>();
  if (!ref) throw AppError.notFound('Referral not found');
  const branchId = ref.branchId.toHexString();
  await validateAssignee(principal, input.assignedTo, branchId); // OWN scope: self only; otherwise an active user of THIS branch the actor can see
  const prev = ref.assignedTo ?? null;
  if (prev?.toHexString() === input.assignedTo) throw new AppError('NO_CHANGE', 409, 'The referral is already assigned to that person');
  if (prev && !input.reason) throw AppError.validation('A reason is required to reassign a referral', [{ path: 'reason', message: 'Required' }]);

  const now = new Date();
  const uid = toObjectId(principal.userId);
  const to = toObjectId(input.assignedTo);
  const updated = await withTransaction(async (session) => {
    // Conditional on the previous assignee: two simultaneous assignments cannot both "win" silently.
    const u = await r.findOneAndUpdate({ _id: ref._id, assignedTo: prev }, { $set: { assignedTo: to, assignedAt: now, updatedBy: uid } }, { new: true, session }).lean<ReferralLean>();
    if (!u) throw AppError.conflict('ASSIGNMENT_CHANGED', 'The referral was reassigned by someone else. Refresh and try again.');
    await scopedRepo(ReferralAssignment, principal).create({ referralId: ref._id, branchId: ref.branchId, fromUserId: prev ?? undefined, toUserId: to, byUserId: uid, reason: input.reason, at: now }, { session });
    await recordAudit({ entityType: 'referral', entityId: ref._id, action: 'assign', before: { assignedTo: prev }, after: { assignedTo: to }, reason: input.reason, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'REFERRAL_ASSIGNED', description: prev ? `Referral ${ref.referralNo} reassigned` : `Referral ${ref.referralNo} assigned`, branchId, userId: principal.userId, at: now, refs: [{ type: 'referral', id: ref._id }, { type: 'person', id: ref.personId }], metadata: { from: prev?.toHexString(), to: input.assignedTo } }, { session });
    return u;
  });
  return (await viewsOf(principal, [updated]))[0]!;
}

// ---- linking to enquiries ---------------------------------------------------------------------------

type EnquiryRef = { _id: Id; enquiryNo: string; branchId: Id; personId: Id; personName: string; referralId?: Id | null };

/**
 * Records that an enquiry came through this referral. It never creates an enquiry. An enquiry has at most one referral
 * (set only while empty, in the same transaction as the referral's list), so a retry is a no-op and a competing link is a 409.
 */
export async function linkEnquiry(principal: Principal, id: string, enquiryId: string) {
  const r = repo(principal);
  const ref = await r.findById(id).lean<ReferralLean>();
  if (!ref) throw AppError.notFound('Referral not found');
  const enquiry = await scopedRepo(Enquiry, principal).findById(enquiryId).lean<EnquiryRef>();
  if (!enquiry) throw AppError.notFound('Enquiry not found');
  if (!enquiry.branchId.equals(ref.branchId)) throw AppError.validation('The enquiry belongs to a different branch', [{ path: 'enquiryId', message: "Choose an enquiry of the referral's branch" }]);
  if (enquiry.personId.equals(ref.personId)) throw AppError.validation('A person cannot be referred by themselves', [{ path: 'enquiryId', message: 'Choose an enquiry of someone else' }]);
  if (enquiry.referralId?.equals(ref._id)) return (await viewsOf(principal, [ref]))[0]!; // already linked: idempotent
  if (enquiry.referralId) throw AppError.conflict('ENQUIRY_ALREADY_REFERRED', 'This enquiry is already linked to another referral');

  const branchId = ref.branchId.toHexString();
  const uid = toObjectId(principal.userId);
  const updated = await withTransaction(async (session) => {
    const e = await scopedRepo(Enquiry, principal).findOneAndUpdate({ _id: enquiry._id, referralId: null }, { $set: { referralId: ref._id, updatedBy: uid } }, { new: true, session }).lean<EnquiryRef>();
    if (!e) throw AppError.conflict('ENQUIRY_ALREADY_REFERRED', 'This enquiry is already linked to a referral');
    const u = await r.findOneAndUpdate({ _id: ref._id }, { $addToSet: { enquiryIds: enquiry._id }, $set: { updatedBy: uid } }, { new: true, session }).lean<ReferralLean>();
    if (!u) throw AppError.notFound('Referral not found');
    await recordAudit({ entityType: 'referral', entityId: ref._id, action: 'link', after: { enquiryId: enquiry._id, enquiryNo: enquiry.enquiryNo }, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'REFERRAL_LINKED', description: `Enquiry ${enquiry.enquiryNo} (${enquiry.personName}) linked to referral ${ref.referralNo}`, branchId, userId: principal.userId, refs: [{ type: 'referral', id: ref._id }, { type: 'enquiry', id: enquiry._id }, { type: 'person', id: ref.personId }, { type: 'person', id: enquiry.personId }] }, { session });
    return u;
  });
  return (await viewsOf(principal, [updated]))[0]!;
}

/** Corrects a wrong link (reason required); the enquiry itself is untouched apart from losing its referral pointer. */
export async function unlinkEnquiry(principal: Principal, id: string, enquiryId: string, reason: string) {
  const r = repo(principal);
  const ref = await r.findById(id).lean<ReferralLean>();
  if (!ref) throw AppError.notFound('Referral not found');
  const enquiry = await scopedRepo(Enquiry, principal).findById(enquiryId).lean<EnquiryRef>();
  if (!enquiry) throw AppError.notFound('Enquiry not found');
  const branchId = ref.branchId.toHexString();
  const uid = toObjectId(principal.userId);
  const updated = await withTransaction(async (session) => {
    const e = await scopedRepo(Enquiry, principal).findOneAndUpdate({ _id: enquiry._id, referralId: ref._id }, { $unset: { referralId: 1 }, $set: { updatedBy: uid } }, { new: true, session }).lean<EnquiryRef>();
    if (!e) throw AppError.conflict('NOT_LINKED', 'This enquiry is not linked to this referral');
    const u = await r.findOneAndUpdate({ _id: ref._id }, { $pull: { enquiryIds: enquiry._id }, $set: { updatedBy: uid } }, { new: true, session }).lean<ReferralLean>();
    if (!u) throw AppError.notFound('Referral not found');
    await recordAudit({ entityType: 'referral', entityId: ref._id, action: 'unlink', before: { enquiryNo: enquiry.enquiryNo }, reason, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'REFERRAL_UNLINKED', description: `Enquiry ${enquiry.enquiryNo} unlinked from referral ${ref.referralNo}`, branchId, userId: principal.userId, refs: [{ type: 'referral', id: ref._id }, { type: 'enquiry', id: enquiry._id }], metadata: { reason } }, { session });
    return u;
  });
  return (await viewsOf(principal, [updated]))[0]!;
}

/** The referrer of an enquiry, for the enquiry detail page (only if the viewer may see that referral). */
export async function referralSummaryFor(principal: Principal, referralId: Id | null | undefined) {
  if (!referralId || !hasPermission(principal, 'referrals.view')) return undefined;
  const r = await scopedRepo(Referral, principal, { includeArchived: true }).findById(referralId.toHexString()).select('referralNo personName').lean<{ _id: Id; referralNo: string; personName: string }>();
  return r ? { id: r._id.toHexString(), referralNo: r.referralNo, name: r.personName } : undefined;
}

// ---- archive ---------------------------------------------------------------------------------------------

export async function archiveReferral(principal: Principal, id: string) {
  const r = repo(principal);
  const ref = await r.findById(id).lean<ReferralLean>();
  if (!ref) throw AppError.notFound('Referral not found');
  const branchId = ref.branchId.toHexString();
  await withTransaction(async (session) => {
    if (!(await r.archiveOne({ _id: ref._id }, principal.userId, { session }))) throw AppError.notFound('Referral not found');
    await recordAudit({ entityType: 'referral', entityId: ref._id, action: 'archive', before: { isArchived: false }, after: { isArchived: true }, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'REFERRAL_ARCHIVED', description: `Referral ${ref.referralNo} archived`, branchId, userId: principal.userId, refs: [{ type: 'referral', id: ref._id }, { type: 'person', id: ref.personId }] }, { session });
  });
}
