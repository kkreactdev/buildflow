import type { ClientSession, Types } from 'mongoose';
import type { z } from 'zod';
import { getEnv } from '../../config/env';
import { recordActivity } from '../../core/activity/activity.service';
import { recordAudit } from '../../core/audit/audit.service';
import { notify } from '../../core/notify/notification.service';
import { hasPermission, type Principal } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import { escapeRegex, parseSort, toMeta, toWindow } from '../../lib/listQuery';
import { phoneSearchDigits, formatPhone } from '../../lib/phone';
import { formatLocal, zonedDayRange } from '../../lib/time';
import { withTransaction } from '../../lib/transaction';
import { Client } from '../clients/client.model';
import { Enquiry } from '../enquiries/enquiry.model';
import { Seller, SellerProperty } from '../sellers/seller.model';
import { assertActiveMaster, masterLabels } from '../masters/master.service';
import { validateAssignee } from '../users/assignable';
import { User } from '../users/user.model';
import { FollowUp } from './followup.model';
import { getStatusMaster } from './followup.masters';
import './followup.references';
import type { completeBody, createFollowUpBody, FollowUpFilters, listFollowUpQuery, rescheduleBody, updateFollowUpBody } from './followup.schema';
import { FOLLOWUP_STATUS, OPEN_KEYS, SCHEDULED_KEYS } from './followup.status';

type Id = Types.ObjectId;
export type FollowUpLean = {
  _id: Id; branchId: Id; personId: Id; personName: string; phoneE164: string; enquiryId?: Id | null; enquiryNo?: string | null; clientId?: Id | null; clientNo?: string | null; siteVisitId?: Id | null;
  sellerId?: Id | null; sellerNo?: string | null; sellerPropertyId?: Id | null; sellerPropertyNo?: string | null;
  assignedTo: Id; typeId: Id; statusId: Id; statusKey: string; scheduledAt: Date; notes?: string | null; rescheduleCount?: number;
  missedAt?: Date | null; completedAt?: Date | null; completedBy?: Id | null; outcome?: string | null; cancelledAt?: Date | null; cancelReason?: string | null;
  isArchived?: boolean; createdAt?: Date; updatedAt?: Date;
};

const repo = (p: Principal, requestedBranchId?: string, includeArchived = false) => scopedRepo(FollowUp, p, { requestedBranchId, includeArchived });
const when = (d: Date) => formatLocal(d, getEnv().APP_TIMEZONE);
const isOpen = (f: Pick<FollowUpLean, 'statusKey'>) => (OPEN_KEYS as readonly string[]).includes(f.statusKey);
/** Time-of-day tolerance for "now" so a follow-up scheduled for this minute is not rejected as past. */
const CLOCK_TOLERANCE_MS = 5 * 60_000;

function assertFuture(at: Date, path = 'scheduledAt') {
  if (at.getTime() < Date.now() - CLOCK_TOLERANCE_MS) throw AppError.validation('The follow-up must be scheduled for a future time', [{ path, message: 'Choose a time in the future' }]);
}

// ---- views ------------------------------------------------------------------

async function lookups(principal: Principal, rows: FollowUpLean[]) {
  const masterIds = [...new Set(rows.flatMap((r) => [r.typeId, r.statusId]).map((i) => i.toHexString()))];
  const userIds = [...new Set(rows.map((r) => r.assignedTo.toHexString()))];
  const [masters, users] = await Promise.all([
    masterIds.length ? masterLabels(principal, masterIds) : new Map(),
    userIds.length ? scopedRepo(User, principal).find({ _id: { $in: userIds.map((i) => toObjectId(i)) } }).select('name').lean<{ _id: Id; name: string }[]>() : [],
  ]);
  return { masters, users: new Map(users.map((u) => [u._id.toHexString(), u.name])) };
}
type Lookups = Awaited<ReturnType<typeof lookups>>;

export function toView(f: FollowUpLean, l: Lookups, p: Principal) {
  const open = isOpen(f) && !f.isArchived;
  const can = (k: Parameters<typeof hasPermission>[1]) => hasPermission(p, k);
  return {
    id: f._id.toHexString(),
    branchId: f.branchId.toHexString(),
    personId: f.personId.toHexString(),
    name: f.personName,
    phone: formatPhone(f.phoneE164),
    phoneE164: f.phoneE164,
    enquiryId: f.enquiryId?.toHexString(), enquiryNo: f.enquiryNo ?? undefined,
    clientId: f.clientId?.toHexString(), clientNo: f.clientNo ?? undefined, siteVisitId: f.siteVisitId?.toHexString(),
    sellerId: f.sellerId?.toHexString(), sellerNo: f.sellerNo ?? undefined, sellerPropertyId: f.sellerPropertyId?.toHexString(), sellerPropertyNo: f.sellerPropertyNo ?? undefined,
    assignedTo: f.assignedTo.toHexString(), assignedToName: l.users.get(f.assignedTo.toHexString()),
    typeId: f.typeId.toHexString(), type: l.masters.get(f.typeId.toHexString()),
    statusId: f.statusId.toHexString(), statusKey: f.statusKey, status: l.masters.get(f.statusId.toHexString()),
    scheduledAt: f.scheduledAt, notes: f.notes ?? undefined, rescheduleCount: f.rescheduleCount ?? 0,
    missedAt: f.missedAt ?? undefined, completedAt: f.completedAt ?? undefined, outcome: f.outcome ?? undefined,
    cancelledAt: f.cancelledAt ?? undefined, cancelReason: f.cancelReason ?? undefined,
    isArchived: Boolean(f.isArchived), createdAt: f.createdAt, updatedAt: f.updatedAt,
    /** What this caller may do right now (the UI shows exactly these; the API enforces them again). */
    allowed: { edit: open && can('followups.edit'), complete: open && can('followups.edit'), reschedule: open && can('followups.edit'), cancel: open && can('followups.edit'), archive: !f.isArchived && can('followups.archive') },
  };
}

export async function viewsOf(p: Principal, rows: FollowUpLean[]) {
  const l = await lookups(p, rows);
  return rows.map((r) => toView(r, l, p));
}

// ---- filters ------------------------------------------------------------------

export function buildFilter(q: FollowUpFilters & { search?: string }, now = new Date()): Record<string, unknown> {
  const and: Record<string, unknown>[] = [{ isArchived: q.isArchived === 'true' }];
  const day = zonedDayRange(now, getEnv().APP_TIMEZONE);
  if (q.view === 'today') and.push({ statusKey: { $in: SCHEDULED_KEYS }, scheduledAt: { $gte: day.start, $lt: day.end } });
  if (q.view === 'missed') and.push({ statusKey: FOLLOWUP_STATUS.missed });
  if (q.view === 'upcoming') and.push({ statusKey: { $in: SCHEDULED_KEYS }, scheduledAt: { $gte: day.end } });
  if (q.view === 'open') and.push({ statusKey: { $in: OPEN_KEYS } });
  if (q.status) and.push({ statusKey: { $in: q.status } });
  for (const f of ['typeId', 'assignedTo', 'enquiryId', 'clientId', 'sellerId', 'sellerPropertyId', 'personId'] as const) if (q[f]) and.push({ [f]: toObjectId(q[f]!) });
  if (q.from || q.to) and.push({ scheduledAt: { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) } });
  const term = q.search?.trim();
  if (term) {
    const ors: Record<string, unknown>[] = [{ personName: new RegExp(escapeRegex(term), 'i') }, ...(['enquiryNo', 'clientNo', 'sellerNo', 'sellerPropertyNo'] as const).map((f) => ({ [f]: new RegExp(`^${escapeRegex(term)}`, 'i') }))];
    const digits = phoneSearchDigits(term);
    if (digits) ors.push({ phoneE164: new RegExp(escapeRegex(digits)) });
    and.push({ $or: ors });
  }
  return { $and: and };
}

// ---- reads -----------------------------------------------------------------------

export async function listFollowUps(principal: Principal, q: z.infer<typeof listFollowUpQuery>) {
  const filter = buildFilter(q);
  const r = repo(principal, q.branchId, true);
  const { skip, limit } = toWindow(q);
  const sort = parseSort(q.sort, ['scheduledAt', 'createdAt', 'personName'], { scheduledAt: 1 });
  const [rows, total] = await Promise.all([
    r.find(filter).sort({ ...sort, _id: 1 }).collation({ locale: 'en', strength: 2 }).skip(skip).limit(limit).lean<FollowUpLean[]>(),
    r.countDocuments(filter),
  ]);
  return { rows: await viewsOf(principal, rows), meta: toMeta(q, total) };
}

/** Counts for the dashboard widgets, over the caller's scope (optionally narrowed to a branch or person). */
export async function summary(principal: Principal, q: { branchId?: string; assignedTo?: string }) {
  const r = repo(principal, q.branchId);
  const count = (view: 'today' | 'missed' | 'upcoming' | 'open') => r.countDocuments(buildFilter({ view, assignedTo: q.assignedTo, isArchived: 'false' }));
  const [today, missed, upcoming, open] = await Promise.all([count('today'), count('missed'), count('upcoming'), count('open')]);
  return { today, missed, upcoming, open };
}

export async function getFollowUp(principal: Principal, id: string) {
  const f = await repo(principal, undefined, true).findById(id).lean<FollowUpLean>();
  if (!f) throw AppError.notFound('Follow-up not found');
  return (await viewsOf(principal, [f]))[0]!;
}

// ---- shared effects -------------------------------------------------------------------

const refsOf = (f: FollowUpLean) => [
  { type: 'followup' as const, id: f._id },
  ...(f.enquiryId ? [{ type: 'enquiry' as const, id: f.enquiryId }] : []),
  ...(f.clientId ? [{ type: 'client' as const, id: f.clientId }] : []),
  ...(f.sellerId ? [{ type: 'seller' as const, id: f.sellerId }] : []),
  ...(f.sellerPropertyId ? [{ type: 'sellerProperty' as const, id: f.sellerPropertyId }] : []),
  { type: 'person' as const, id: f.personId },
];
const anchorLabel = (f: FollowUpLean) => f.enquiryNo ?? f.clientNo ?? f.sellerPropertyNo ?? f.sellerNo ?? '';
const auditView = (f: FollowUpLean) => ({ statusKey: f.statusKey, scheduledAt: f.scheduledAt, assignedTo: f.assignedTo, typeId: f.typeId, notes: f.notes, outcome: f.outcome, cancelReason: f.cancelReason });

async function typeLabel(p: Principal, id: Id): Promise<string> {
  return (await masterLabels(p, [id])).get(id.toHexString())?.label ?? 'Follow-up';
}

// ---- create ---------------------------------------------------------------------------

export interface NewFollowUp {
  anchor: { enquiryId: Id; enquiryNo: string } | { clientId: Id; clientNo: string } | { sellerId: Id; sellerNo: string; sellerPropertyId?: Id; sellerPropertyNo?: string };
  person: { personId: Id; personName: string; phoneE164: string; branchId: Id };
  typeId: string;
  assignedTo: string;
  scheduledAt: Date;
  notes?: string;
  /** Display label of the type, for the activity and notification text. */
  label: string;
  /** Set when a site visit creates this follow-up; unique per visit, so the write itself rejects a second one. */
  siteVisitId?: Id;
}

/**
 * The one place a follow-up is written, with its audit entry, timeline activity and assignment notification.
 * Runs inside the caller's transaction, so manual creation and the automatic post-site-visit follow-up
 * commit (or roll back) together with whatever else the caller does. Uses the caller's scope for the write.
 */
export async function insertFollowUp(principal: Principal, n: NewFollowUp, session: ClientSession): Promise<FollowUpLean> {
  const pending = await getStatusMaster(FOLLOWUP_STATUS.pending);
  const branchId = n.person.branchId.toHexString();
  const doc = await repo(principal).create(
    {
      branchId: n.person.branchId, personId: n.person.personId, personName: n.person.personName, phoneE164: n.person.phoneE164, ...n.anchor,
      ...(n.siteVisitId ? { siteVisitId: n.siteVisitId } : {}),
      assignedTo: toObjectId(n.assignedTo), typeId: toObjectId(n.typeId), statusId: pending._id, statusKey: FOLLOWUP_STATUS.pending,
      scheduledAt: n.scheduledAt, notes: n.notes, createdBy: toObjectId(principal.userId),
    },
    { session },
  );
  const f = doc.toObject() as unknown as FollowUpLean;
  await recordAudit({ entityType: 'followup', entityId: f._id, action: 'create', after: { ...auditView(f), ...(n.siteVisitId ? { siteVisitId: n.siteVisitId } : {}) }, userId: principal.userId, branchId }, { session });
  await recordActivity({ type: 'FOLLOWUP_SCHEDULED', description: `${n.label} follow-up scheduled with ${f.personName} for ${when(f.scheduledAt)}`, branchId, userId: principal.userId, refs: refsOf(f) }, { session });
  await notify({
    event: 'FOLLOWUP_ASSIGNED', branchId, payload: { person: f.personName, type: n.label, when: when(f.scheduledAt) }, subjects: { assignee: n.assignedTo },
    refs: refsOf(f), dedupeKey: `followup-assigned:${f._id}:${n.assignedTo}:create`, excludeUserId: principal.userId, session,
  });
  return f;
}

type AnchorRow = { _id: Id; personId: Id; personName: string; phoneE164: string; branchId: Id; assignedTo?: Id | null };

/**
 * Resolves the record a new follow-up hangs off, through the caller's own scope. A seller anchor also needs
 * `sellers.view`: holding `followups.create` must not open a door into Seller Management. A proposed
 * property implies its seller, and a seller that is given alongside must be that property's seller.
 */
async function resolveAnchor(principal: Principal, input: z.infer<typeof createFollowUpBody>): Promise<{ anchor: AnchorRow; ref: NewFollowUp['anchor'] }> {
  if (input.enquiryId) {
    const e = await scopedRepo(Enquiry, principal).findById(input.enquiryId).lean<AnchorRow & { enquiryNo: string }>();
    if (!e) throw AppError.notFound('Enquiry not found');
    return { anchor: e, ref: { enquiryId: e._id, enquiryNo: e.enquiryNo } };
  }
  if (input.clientId) {
    const c = await scopedRepo(Client, principal).findById(input.clientId).lean<AnchorRow & { clientNo: string }>();
    if (!c) throw AppError.notFound('Client not found');
    return { anchor: c, ref: { clientId: c._id, clientNo: c.clientNo } };
  }
  if (!hasPermission(principal, 'sellers.view')) throw AppError.notFound('Seller not found');
  let sellerId = input.sellerId;
  let property: { _id: Id; sellerPropertyNo: string; sellerId: Id; statusKey: string } | null = null;
  if (input.sellerPropertyId) {
    property = await scopedRepo(SellerProperty, principal).findById(input.sellerPropertyId).select('sellerPropertyNo sellerId statusKey').lean<{ _id: Id; sellerPropertyNo: string; sellerId: Id; statusKey: string }>();
    if (!property) throw AppError.notFound('Proposed property not found');
    if (sellerId && sellerId !== property.sellerId.toHexString()) throw AppError.validation('The property does not belong to that seller', [{ path: 'sellerPropertyId', message: 'Choose a property of this seller' }]);
    sellerId = property.sellerId.toHexString();
  }
  const s = await scopedRepo(Seller, principal).findById(sellerId!).lean<AnchorRow & { sellerNo: string }>();
  if (!s) throw AppError.notFound('Seller not found');
  return { anchor: s, ref: { sellerId: s._id, sellerNo: s.sellerNo, ...(property ? { sellerPropertyId: property._id, sellerPropertyNo: property.sellerPropertyNo } : {}) } };
}

export async function createFollowUp(principal: Principal, input: z.infer<typeof createFollowUpBody>) {
  assertFuture(input.scheduledAt);

  // The anchor must be visible to the caller; its branch, person and numbers become the follow-up's.
  const resolved = await resolveAnchor(principal, input);
  const { anchor } = resolved;
  const branchId = anchor.branchId.toHexString();

  await assertActiveMaster(principal, 'FOLLOWUP_TYPE', input.typeId, 'typeId');

  // Default owner: the person already handling the enquiry/client, else the creator. An explicit choice must be valid.
  let assignedTo = input.assignedTo;
  if (assignedTo) await validateAssignee(principal, assignedTo, branchId);
  else {
    for (const candidate of [principal.dataScope === 'OWN' ? principal.userId : anchor.assignedTo?.toHexString(), principal.userId]) {
      if (!candidate) continue;
      try {
        await validateAssignee(principal, candidate, branchId);
        assignedTo = candidate;
        break;
      } catch {
        /* try the next candidate */
      }
    }
    if (!assignedTo) throw AppError.validation('Choose who this follow-up is for', [{ path: 'assignedTo', message: 'Required' }]);
  }

  const label = await typeLabel(principal, toObjectId(input.typeId));

  const created = await withTransaction((session) =>
    insertFollowUp(principal, { anchor: resolved.ref, person: anchor, typeId: input.typeId, assignedTo: assignedTo!, scheduledAt: input.scheduledAt, notes: input.notes, label }, session),
  );
  return (await viewsOf(principal, [created]))[0]!;
}

// ---- update (descriptive fields) --------------------------------------------------------

async function loadOpen(principal: Principal, id: string): Promise<FollowUpLean> {
  const f = await repo(principal).findById(id).lean<FollowUpLean>();
  if (!f) throw AppError.notFound('Follow-up not found');
  if (!isOpen(f)) throw AppError.conflict('FOLLOWUP_CLOSED', 'This follow-up is already closed');
  return f;
}
const changedElsewhere = () => AppError.conflict('FOLLOWUP_CHANGED', 'The follow-up was changed by someone else. Refresh and try again.');

export async function updateFollowUp(principal: Principal, id: string, patch: z.infer<typeof updateFollowUpBody>) {
  const before = await loadOpen(principal, id);
  const branchId = before.branchId.toHexString();
  if (patch.typeId && patch.typeId !== before.typeId.toHexString()) await assertActiveMaster(principal, 'FOLLOWUP_TYPE', patch.typeId, 'typeId');
  const reassigned = patch.assignedTo !== undefined && patch.assignedTo !== before.assignedTo.toHexString();
  if (reassigned) await validateAssignee(principal, patch.assignedTo!, branchId);

  const set: Record<string, unknown> = { updatedBy: toObjectId(principal.userId) };
  const unset: Record<string, 1> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) unset[k] = 1;
    else set[k] = k === 'notes' ? v : toObjectId(v as string);
  }
  const label = await typeLabel(principal, toObjectId(patch.typeId ?? before.typeId.toHexString()));

  const after = await withTransaction(async (session) => {
    const u = await repo(principal).findOneAndUpdate({ _id: before._id, statusKey: { $in: OPEN_KEYS } }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { new: true, session }).lean<FollowUpLean>();
    if (!u) throw changedElsewhere();
    await recordAudit({ entityType: 'followup', entityId: before._id, action: reassigned ? 'reassign' : 'update', before: auditView(before), after: auditView(u), userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'FOLLOWUP_UPDATED', description: `Follow-up with ${before.personName} ${reassigned ? 'reassigned' : 'updated'}`, branchId, userId: principal.userId, refs: refsOf(before) }, { session });
    if (reassigned) {
      await notify({
        event: 'FOLLOWUP_ASSIGNED', branchId, payload: { person: before.personName, type: label, when: when(u.scheduledAt) }, subjects: { assignee: patch.assignedTo },
        refs: refsOf(before), dedupeKey: `followup-assigned:${before._id}:${patch.assignedTo}:${u.updatedAt?.getTime()}`, excludeUserId: principal.userId, session,
      });
    }
    return u;
  });
  return (await viewsOf(principal, [after]))[0]!;
}

// ---- lifecycle: complete / reschedule / cancel ---------------------------------------------

/** Completing NEVER schedules another follow-up: the next one is created explicitly by a person. */
export async function completeFollowUp(principal: Principal, id: string, input: z.infer<typeof completeBody>) {
  const before = await loadOpen(principal, id);
  const done = await getStatusMaster(FOLLOWUP_STATUS.completed);
  const now = new Date();
  const branchId = before.branchId.toHexString();
  const after = await withTransaction(async (session) => {
    // Conditional on still being open: racing the missed-follow-up job or a second completion is safe.
    const u = await repo(principal).findOneAndUpdate({ _id: before._id, statusKey: { $in: OPEN_KEYS } }, { $set: { statusKey: FOLLOWUP_STATUS.completed, statusId: done._id, completedAt: now, completedBy: toObjectId(principal.userId), outcome: input.outcome, updatedBy: toObjectId(principal.userId) } }, { new: true, session }).lean<FollowUpLean>();
    if (!u) throw changedElsewhere();
    await recordAudit({ entityType: 'followup', entityId: before._id, action: 'complete', before: auditView(before), after: auditView(u), userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'FOLLOWUP_COMPLETED', description: `Follow-up with ${before.personName} completed${input.outcome ? `: ${input.outcome}` : ''}`, branchId, userId: principal.userId, at: now, refs: refsOf(before) }, { session });
    return u;
  });
  return (await viewsOf(principal, [after]))[0]!;
}

export async function rescheduleFollowUp(principal: Principal, id: string, input: z.infer<typeof rescheduleBody>) {
  assertFuture(input.scheduledAt);
  const before = await loadOpen(principal, id);
  if (before.scheduledAt.getTime() === input.scheduledAt.getTime()) throw new AppError('NO_CHANGE', 409, 'The follow-up is already scheduled for that time');
  const status = await getStatusMaster(FOLLOWUP_STATUS.rescheduled);
  const branchId = before.branchId.toHexString();
  const after = await withTransaction(async (session) => {
    // Clears the "missed"/"reminded" markers so the new time is tracked afresh (and may be flagged again).
    const u = await repo(principal).findOneAndUpdate(
      { _id: before._id, statusKey: { $in: OPEN_KEYS }, scheduledAt: before.scheduledAt },
      { $set: { scheduledAt: input.scheduledAt, statusKey: FOLLOWUP_STATUS.rescheduled, statusId: status._id, updatedBy: toObjectId(principal.userId) }, $inc: { rescheduleCount: 1 }, $unset: { missedAt: 1, upcomingNotifiedAt: 1 } },
      { new: true, session },
    ).lean<FollowUpLean>();
    if (!u) throw changedElsewhere();
    await recordAudit({ entityType: 'followup', entityId: before._id, action: 'reschedule', before: auditView(before), after: auditView(u), reason: input.reason, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'FOLLOWUP_RESCHEDULED', description: `Follow-up with ${before.personName} moved from ${when(before.scheduledAt)} to ${when(input.scheduledAt)}`, branchId, userId: principal.userId, refs: refsOf(before), metadata: { reason: input.reason } }, { session });
    return u;
  });
  return (await viewsOf(principal, [after]))[0]!;
}

export async function cancelFollowUp(principal: Principal, id: string, input: { reason: string }) {
  const before = await loadOpen(principal, id);
  const status = await getStatusMaster(FOLLOWUP_STATUS.cancelled);
  const now = new Date();
  const branchId = before.branchId.toHexString();
  const after = await withTransaction(async (session) => {
    const u = await repo(principal).findOneAndUpdate({ _id: before._id, statusKey: { $in: OPEN_KEYS } }, { $set: { statusKey: FOLLOWUP_STATUS.cancelled, statusId: status._id, cancelledAt: now, cancelledBy: toObjectId(principal.userId), cancelReason: input.reason, updatedBy: toObjectId(principal.userId) } }, { new: true, session }).lean<FollowUpLean>();
    if (!u) throw changedElsewhere();
    await recordAudit({ entityType: 'followup', entityId: before._id, action: 'cancel', before: auditView(before), after: auditView(u), reason: input.reason, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'FOLLOWUP_CANCELLED', description: `Follow-up with ${before.personName} cancelled: ${input.reason}`, branchId, userId: principal.userId, at: now, refs: refsOf(before) }, { session });
    return u;
  });
  return (await viewsOf(principal, [after]))[0]!;
}

export async function archiveFollowUp(principal: Principal, id: string) {
  const r = repo(principal);
  const f = await r.findById(id).lean<FollowUpLean>();
  if (!f) throw AppError.notFound('Follow-up not found');
  const branchId = f.branchId.toHexString();
  await withTransaction(async (session) => {
    if (!(await r.archiveOne({ _id: f._id }, principal.userId, { session }))) throw AppError.notFound('Follow-up not found');
    await recordAudit({ entityType: 'followup', entityId: f._id, action: 'archive', before: { isArchived: false }, after: { isArchived: true }, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'FOLLOWUP_ARCHIVED', description: `Follow-up with ${f.personName} archived`, branchId, userId: principal.userId, refs: refsOf(f) }, { session });
  });
}

export { anchorLabel, auditView, refsOf, when, typeLabel };
