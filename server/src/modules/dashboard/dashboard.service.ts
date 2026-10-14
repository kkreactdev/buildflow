import type { Types } from 'mongoose';
import { Activity } from '../../core/activity/activity.model';
import { hasPermission, type Principal } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { toObjectId } from '../../lib/ids';
import { AppError } from '../../lib/appError';
import { Booking } from '../bookings/booking.model';
import { Client } from '../clients/client.model';
import { Enquiry, EnquiryStageHistory } from '../enquiries/enquiry.model';
import { FollowUp } from '../followups/followup.model';
import { buildFilter as followUpFilter } from '../followups/followup.service';
import { FOLLOWUP_STATUS } from '../followups/followup.status';
import { masterLabels } from '../masters/master.service';
import { Referral } from '../referrals/referral.model';
import { SiteVisit } from '../sitevisits/sitevisit.model';
import { buildFilter as visitFilter } from '../sitevisits/sitevisit.service';
import { VISIT_STATUS } from '../sitevisits/sitevisit.status';
import { Unit } from '../units/unit.model';
import { User } from '../users/user.model';
import { loadWorkflow } from '../workflow/workflow.service';
import { DOMAIN_OPERATIONS } from '../workflow/workflowDefaults';
import type { WorkflowDefinition } from '../workflow/workflow.definition';
import type { DashboardQuery, Range } from './dashboard.range';
import { resolveRange } from './dashboard.range';

type Id = Types.ObjectId;
type Filter = Record<string, unknown>;

/** A number with the same measure for the previous period, so the UI can show the change. */
export interface Compared {
  value: number;
  previous: number;
}

/**
 * EVERY query below goes through `scopedRepo`, so the caller's branch / assignment scope is the first `$match` of every count and
 * aggregation (see core/scope): a total, chart, tooltip, drill-down or recent-activity row can never include a record the user
 * could not open. A section is computed only if the user also holds that resource's `.view` permission; otherwise it is simply
 * absent (and the UI says so). The client's `branchId` / `assignedTo` can only NARROW.
 */
export function makeContext(principal: Principal, q: DashboardQuery, now = new Date()) {
  const range = resolveRange(q, now);
  const repo = <M extends Parameters<typeof scopedRepo>[0]>(model: M, includeArchived = false) => scopedRepo(model, principal, { requestedBranchId: q.branchId, includeArchived });
  const can = (k: Parameters<typeof hasPermission>[1]) => hasPermission(principal, k);
  const oid = (v?: string) => (v ? toObjectId(v) : undefined);
  return { principal, q, range, now, repo, can, oid };
}
type Ctx = ReturnType<typeof makeContext>;

const between = (field: string, a: Date, b: Date): Filter => ({ [field]: { $gte: a, $lt: b } });
const compared = async (value: (a: Date, b: Date) => Promise<number>, r: Range): Promise<Compared> => {
  const [v, p] = await Promise.all([value(r.start, r.end), value(r.prevStart, r.prevEnd)]);
  return { value: v, previous: p };
};

/** Enquiry-level narrowing filters (source, property / building type, salesperson). They apply to the enquiry metrics only. */
function enquiryNarrowing(c: Ctx): Filter {
  const f: Filter = {};
  if (c.q.assignedTo) f.assignedTo = c.oid(c.q.assignedTo);
  if (c.q.sourceId) f.sourceId = c.oid(c.q.sourceId);
  if (c.q.propertyTypeId) f.propertyTypeId = c.oid(c.q.propertyTypeId);
  if (c.q.buildingTypeId) f.buildingTypeId = c.oid(c.q.buildingTypeId);
  return f;
}

/** Stage keys by role, taken from the configured workflow (never hard-coded names or positions). */
export function stageRoles(wf: WorkflowDefinition) {
  const flow = wf.stages.filter((s) => s.kind === 'FLOW');
  const terminal = wf.stages.find((s) => s.domainOperation === DOMAIN_OPERATIONS.convertEnquiry);
  const booked = wf.stages.find((s) => s.domainOperation === DOMAIN_OPERATIONS.createBooking);
  return {
    /** Open pipeline: every FLOW stage except the final "converted" one. */
    activeKeys: flow.filter((s) => s.systemKey !== terminal?.systemKey).map((s) => s.systemKey),
    convertKey: terminal?.systemKey,
    /** The booking stage and everything after it. */
    bookedOrBeyondKeys: booked ? flow.filter((s) => s.order >= booked.order).map((s) => s.systemKey) : [],
  };
}

// ---- stage entries (historical) ---------------------------------------------------------------

/**
 * Distinct enquiries that ENTERED any of `stageKeys` during [start, end), from the append-only stage history. The history has no
 * owner field, so for OWN scope (and whenever enquiry-level filters are used) it is restricted to the ids of enquiries the caller
 * may see; otherwise the branch scope on the history itself is enough. Archived enquiries' history is included in both paths.
 */
const ID_CAP = 50_000;
async function stageEntries(c: Ctx, stageKeys: string[], start: Date, end: Date): Promise<number> {
  if (stageKeys.length === 0) return 0;
  const narrowing = enquiryNarrowing(c);
  const match: Filter = { toStage: { $in: stageKeys }, at: { $gte: start, $lt: end } };
  if (c.principal.dataScope === 'OWN' || Object.keys(narrowing).length > 0) {
    const ids = await c.repo(Enquiry, true).find(narrowing).select('_id').limit(ID_CAP + 1).lean<{ _id: Id }[]>();
    if (ids.length > ID_CAP) throw AppError.validation('Too many enquiries match these filters to count history; narrow the filters or the branch');
    match.enquiryId = { $in: ids.map((i) => i._id) };
  }
  const rows = await c.repo(EnquiryStageHistory).aggregate<{ n: number }>([{ $match: match }, { $group: { _id: '$enquiryId' } }, { $count: 'n' }]);
  return rows[0]?.n ?? 0;
}

// ---- sections -----------------------------------------------------------------------------------

async function enquiriesSection(c: Ctx, wf: WorkflowDefinition) {
  const roles = stageRoles(wf);
  const base: Filter = { isArchived: false, ...enquiryNarrowing(c) };
  const r = c.repo(Enquiry);
  const [created, active, converted] = await Promise.all([
    compared((a, b) => r.countDocuments({ ...base, ...between('createdAt', a, b) }), c.range),
    r.countDocuments({ ...base, stageCode: { $in: roles.activeKeys } }),
    roles.convertKey
      ? Promise.all([stageEntries(c, [roles.convertKey], c.range.start, c.range.end), stageEntries(c, [roles.convertKey], c.range.prevStart, c.range.prevEnd), r.countDocuments({ ...base, stageCode: roles.convertKey })])
      : Promise.resolve([0, 0, 0]),
  ]);
  return { new: created, active, converted: { value: converted[0]!, previous: converted[1]!, current: converted[2]! } };
}

async function followUpsSection(c: Ctx) {
  const r = c.repo(FollowUp);
  const f = (view: 'today' | 'missed' | 'upcoming' | 'open') => followUpFilter({ view, assignedTo: c.q.assignedTo, isArchived: 'false' }, c.now);
  const [today, missed, upcoming, open, completed] = await Promise.all([
    r.countDocuments(f('today')), r.countDocuments(f('missed')), r.countDocuments(f('upcoming')), r.countDocuments(f('open')),
    compared((a, b) => r.countDocuments({ isArchived: false, statusKey: FOLLOWUP_STATUS.completed, ...(c.q.assignedTo ? { assignedTo: c.oid(c.q.assignedTo) } : {}), ...between('completedAt', a, b) }), c.range),
  ]);
  return { today, missed, upcoming, open, completed };
}

async function siteVisitsSection(c: Ctx) {
  const r = c.repo(SiteVisit);
  const f = (view: 'today' | 'upcoming' | 'overdue') => visitFilter({ view, assignedTo: c.q.assignedTo, isArchived: 'false' }, c.now);
  const [today, upcoming, overdue, completed] = await Promise.all([
    r.countDocuments(f('today')), r.countDocuments(f('upcoming')), r.countDocuments(f('overdue')),
    compared((a, b) => r.countDocuments({ isArchived: false, statusKey: VISIT_STATUS.completed, ...(c.q.assignedTo ? { assignedTo: c.oid(c.q.assignedTo) } : {}), ...between('completedAt', a, b) }), c.range),
  ]);
  return { today, upcoming, overdue, completed };
}

async function unitsSection(c: Ctx) {
  const match: Filter = { isArchived: false, ...(c.q.assignedTo ? { assignedTo: c.oid(c.q.assignedTo) } : {}) };
  const rows = await c.repo(Unit).aggregate<{ _id: { statusId: Id; statusKey: string }; n: number }>([{ $match: match }, { $group: { _id: { statusId: '$statusId', statusKey: '$statusKey' }, n: { $sum: 1 } } }]);
  const labels = rows.length ? await masterLabels(c.principal, rows.map((x) => x._id.statusId)) : new Map();
  const byStatus = rows
    .map((x) => ({ statusId: x._id.statusId.toHexString(), statusKey: x._id.statusKey, status: labels.get(x._id.statusId.toHexString()), count: x.n }))
    .sort((a, b) => b.count - a.count);
  const count = (key: string) => byStatus.filter((s) => s.statusKey === key).reduce((n, s) => n + s.count, 0);
  return { total: byStatus.reduce((n, s) => n + s.count, 0), available: count('AVAILABLE'), booked: count('BOOKED'), sold: count('SOLD'), byStatus };
}

async function bookingsSection(c: Ctx) {
  const r = c.repo(Booking);
  const mine: Filter = c.q.assignedTo ? { salespersonId: c.oid(c.q.assignedTo) } : {};
  const [active, made, released] = await Promise.all([
    r.countDocuments({ ...mine, status: 'ACTIVE' }),
    compared((a, b) => r.countDocuments({ ...mine, ...between('bookingDate', a, b) }), c.range),
    compared((a, b) => r.countDocuments({ ...mine, status: 'RELEASED', ...between('releasedAt', a, b) }), c.range),
  ]);
  return { active, made, released };
}

async function clientsSection(c: Ctx) {
  const r = c.repo(Client);
  return { new: await compared((a, b) => r.countDocuments({ isArchived: false, ...(c.q.assignedTo ? { assignedTo: c.oid(c.q.assignedTo) } : {}), ...between('createdAt', a, b) }), c.range) };
}

async function referralsSection(c: Ctx) {
  const r = c.repo(Referral);
  const mine: Filter = c.q.assignedTo ? { assignedTo: c.oid(c.q.assignedTo) } : {};
  const [total, created] = await Promise.all([r.countDocuments({ isArchived: false, ...mine }), compared((a, b) => r.countDocuments({ isArchived: false, ...mine, ...between('createdAt', a, b) }), c.range)]);
  return { total, new: created };
}

/** Which resource's `.view` permission each kind of activity reference needs; an activity is shown only if ALL its references are allowed. */
const REF_PERMISSION: Record<string, Parameters<typeof hasPermission>[1]> = {
  enquiry: 'enquiries.view', client: 'clients.view', unit: 'units.view', sitevisit: 'sitevisits.view', followup: 'followups.view', booking: 'bookings.view',
  referral: 'referrals.view', document: 'documents.view', user: 'users.view',
};

async function activitiesSection(c: Ctx, limit = 10) {
  const forbidden = Object.entries(REF_PERMISSION).filter(([, perm]) => !c.can(perm)).map(([type]) => type);
  const filter: Filter = { ...(forbidden.length ? { 'refs.type': { $nin: forbidden } } : {}), at: { $lte: c.now } };
  if (c.principal.dataScope === 'OWN') filter.userId = toObjectId(c.principal.userId); // a feed without a record: people with OWN scope only see their own actions
  if (c.q.assignedTo && c.principal.dataScope !== 'OWN') filter.userId = c.oid(c.q.assignedTo);
  const rows = await c.repo(Activity).find(filter).sort({ at: -1, _id: -1 }).limit(limit).lean<{ _id: Id; type: string; description: string; at: Date; userId?: Id; refs: { type: string; id: Id }[] }[]>();
  const userIds = [...new Set(rows.map((x) => x.userId?.toHexString()).filter(Boolean) as string[])];
  const users = userIds.length ? await scopedRepo(User, c.principal).find({ _id: { $in: userIds.map((i) => toObjectId(i)) } }).select('name').lean<{ _id: Id; name: string }[]>() : [];
  const names = new Map(users.map((u) => [u._id.toHexString(), u.name]));
  return rows.map((x) => ({ id: x._id.toHexString(), type: x.type, description: x.description, at: x.at, byName: x.userId ? names.get(x.userId.toHexString()) : undefined, refs: x.refs.map((r) => ({ type: r.type, id: r.id.toHexString() })) }));
}

/** What each number means, shown beside it. Kept next to the code that computes it. */
export const DEFINITIONS = {
  newEnquiries: 'Enquiries created in the selected days (archived ones excluded).',
  activeEnquiries: 'Enquiries right now in any pipeline stage before the final "converted" stage (archived and lost ones excluded). Not limited to the selected days.',
  convertedEnquiries: 'Enquiries that ENTERED the final "converted" stage in the selected days (from stage history); "current" is how many are in that stage now. Conversion to a client is not yet an operation of its own, so this stays at zero until it is.',
  followUpsToday: "Open follow-ups scheduled for today (business time zone) that are not yet overdue.",
  followUpsMissed: 'Open follow-ups that were not done in time and are flagged missed.',
  siteVisitsToday: 'Site visits scheduled for today, whatever their state.',
  siteVisitsUpcoming: 'Scheduled site visits from tomorrow on.',
  siteVisitsOverdue: 'Scheduled site visits whose time has passed without being completed or cancelled.',
  units: 'Non-archived units by their current status.',
  activeBookings: 'Bookings that are active right now. Released bookings are never counted here.',
  bookingsMade: 'Bookings whose booking date falls in the selected days, even if released since.',
  bookingsReleased: 'Bookings released in the selected days.',
  newClients: 'Clients created in the selected days (archived ones excluded).',
  newReferrals: 'Referrals created in the selected days (archived ones excluded).',
  previous: 'The same number of days immediately before the selected range.',
} as const;

export async function summary(principal: Principal, q: DashboardQuery, now = new Date()) {
  const c = makeContext(principal, q, now);
  const wf = await loadWorkflow();
  const allowed = {
    enquiries: c.can('enquiries.view'), followUps: c.can('followups.view'), siteVisits: c.can('sitevisits.view'), units: c.can('units.view'),
    bookings: c.can('bookings.view'), clients: c.can('clients.view'), referrals: c.can('referrals.view'), activities: c.can('activities.view'),
  };
  const [enquiries, followUps, siteVisits, units, bookings, clients, referrals, activities] = await Promise.all([
    allowed.enquiries ? enquiriesSection(c, wf) : undefined,
    allowed.followUps ? followUpsSection(c) : undefined,
    allowed.siteVisits ? siteVisitsSection(c) : undefined,
    allowed.units ? unitsSection(c) : undefined,
    allowed.bookings ? bookingsSection(c) : undefined,
    allowed.clients ? clientsSection(c) : undefined,
    allowed.referrals ? referralsSection(c) : undefined,
    allowed.activities ? activitiesSection(c) : undefined,
  ]);
  return {
    range: { from: c.range.from, to: c.range.to, days: c.range.days, previousFrom: c.range.prevFrom, previousTo: c.range.prevTo, timeZone: c.range.timeZone },
    allowed, enquiries, followUps, siteVisits, units, bookings, clients, referrals, activities, definitions: DEFINITIONS,
  };
}

// ---- funnel -----------------------------------------------------------------------------------------

/**
 * Two DIFFERENT measures, both driven by the configured workflow (rename, reorder or add a stage and this follows):
 *  - `current`: how many enquiries are in each stage RIGHT NOW (a snapshot; it ignores the date range and is not a conversion rate);
 *  - `entered`: how many distinct enquiries ENTERED each stage during the selected days (historical transitions from stage history;
 *    not a cohort: the enquiries that entered a later stage need not be the ones that entered an earlier one in the same days).
 */
export async function funnel(principal: Principal, q: DashboardQuery, now = new Date()) {
  if (!hasPermission(principal, 'enquiries.view')) throw AppError.forbidden('You do not have permission to view enquiry metrics');
  const c = makeContext(principal, q, now);
  const wf = await loadWorkflow();
  const stages = [...wf.stages].sort((a, b) => (a.kind === b.kind ? a.order - b.order : a.kind === 'FLOW' ? -1 : 1));
  const rows = await c.repo(Enquiry).aggregate<{ _id: string; n: number }>([{ $match: { isArchived: false, ...enquiryNarrowing(c) } }, { $group: { _id: '$stageCode', n: { $sum: 1 } } }]);
  const current = new Map(rows.map((x) => [x._id, x.n]));
  const entered = new Map<string, number>();
  for (const s of stages) entered.set(s.systemKey, await stageEntries(c, [s.systemKey], c.range.start, c.range.end));
  const out = stages
    .filter((s) => s.isActive || (current.get(s.systemKey) ?? 0) > 0 || (entered.get(s.systemKey) ?? 0) > 0) // a deactivated stage still shows while it holds or received enquiries
    .map((s) => ({ systemKey: s.systemKey, label: s.label, kind: s.kind, order: s.order, isActive: s.isActive, current: current.get(s.systemKey) ?? 0, entered: entered.get(s.systemKey) ?? 0 }));
  return {
    range: { from: c.range.from, to: c.range.to, days: c.range.days, timeZone: c.range.timeZone },
    stages: out,
    totals: { current: out.reduce((n, s) => n + s.current, 0) },
    definitions: {
      current: 'Enquiries in each stage right now. A snapshot of the pipeline; it does not depend on the selected days and is not a conversion rate.',
      entered: 'Distinct enquiries that entered each stage during the selected days, from the stage history. Counts of events in the period, not the share of one stage that reached the next.',
    },
  };
}

// ---- sources and performance ----------------------------------------------------------------------------

export async function sources(principal: Principal, q: DashboardQuery, now = new Date()) {
  if (!hasPermission(principal, 'enquiries.view')) throw AppError.forbidden('You do not have permission to view enquiry metrics');
  const c = makeContext(principal, q, now);
  const wf = await loadWorkflow();
  const roles = stageRoles(wf);
  const rows = await c.repo(Enquiry).aggregate<{ _id: Id | null; created: number; bookedOrBeyond: number }>([
    { $match: { isArchived: false, ...enquiryNarrowing(c), ...between('createdAt', c.range.start, c.range.end) } },
    { $group: { _id: '$sourceId', created: { $sum: 1 }, bookedOrBeyond: { $sum: { $cond: [{ $in: ['$stageCode', roles.bookedOrBeyondKeys] }, 1, 0] } } } },
    { $sort: { created: -1 } },
    { $limit: 50 },
  ]);
  const labels = rows.length ? await masterLabels(c.principal, rows.filter((x) => x._id).map((x) => x._id!)) : new Map();
  return {
    range: { from: c.range.from, to: c.range.to, days: c.range.days, timeZone: c.range.timeZone },
    rows: rows.map((x) => ({ sourceId: x._id?.toHexString(), source: x._id ? labels.get(x._id.toHexString()) : undefined, created: x.created, bookedOrBeyond: x.bookedOrBeyond })),
    definition: 'Enquiries created in the selected days, by source. "Booked or beyond" counts those that are in the booking stage or any later stage right now.',
  };
}

export async function performance(principal: Principal, q: DashboardQuery, now = new Date()) {
  const c = makeContext(principal, q, now);
  const canEnq = c.can('enquiries.view');
  const canBook = c.can('bookings.view');
  const canVisit = c.can('sitevisits.view');
  const canFollow = c.can('followups.view');
  if (!canEnq && !canBook && !canVisit && !canFollow) throw AppError.forbidden('You do not have permission to view performance metrics');
  const group = async (model: Parameters<typeof scopedRepo>[0], field: string, match: Filter) => {
    const rows = await c.repo(model).aggregate<{ _id: Id | null; n: number }>([{ $match: match }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]);
    return new Map(rows.map((x) => [x._id?.toHexString() ?? '', x.n]));
  };
  const narrow = (field: string): Filter => (c.q.assignedTo ? { [field]: c.oid(c.q.assignedTo) } : {});
  const [enquiries, bookings, visits, missed] = await Promise.all([
    canEnq ? group(Enquiry, 'assignedTo', { isArchived: false, ...enquiryNarrowing(c), ...between('createdAt', c.range.start, c.range.end) }) : new Map<string, number>(),
    canBook ? group(Booking, 'salespersonId', { ...narrow('salespersonId'), ...between('bookingDate', c.range.start, c.range.end) }) : new Map<string, number>(),
    canVisit ? group(SiteVisit, 'assignedTo', { isArchived: false, statusKey: VISIT_STATUS.completed, ...narrow('assignedTo'), ...between('completedAt', c.range.start, c.range.end) }) : new Map<string, number>(),
    canFollow ? group(FollowUp, 'assignedTo', { isArchived: false, statusKey: FOLLOWUP_STATUS.missed, ...narrow('assignedTo') }) : new Map<string, number>(),
  ]);
  const ids = [...new Set([...enquiries.keys(), ...bookings.keys(), ...visits.keys(), ...missed.keys()].filter(Boolean))];
  const users = ids.length ? await scopedRepo(User, c.principal).find({ _id: { $in: ids.map((i) => toObjectId(i)) } }).select('name').lean<{ _id: Id; name: string }[]>() : [];
  const names = new Map(users.map((u) => [u._id.toHexString(), u.name]));
  const rows = [...new Set([...enquiries.keys(), ...bookings.keys(), ...visits.keys(), ...missed.keys()])]
    .map((id) => ({ userId: id || undefined, name: id ? names.get(id) ?? 'Another user' : 'Unassigned', newEnquiries: enquiries.get(id) ?? 0, bookingsMade: bookings.get(id) ?? 0, visitsCompleted: visits.get(id) ?? 0, missedFollowUps: missed.get(id) ?? 0 }))
    .sort((a, b) => b.newEnquiries + b.bookingsMade - (a.newEnquiries + a.bookingsMade) || a.name.localeCompare(b.name))
    .slice(0, 50);
  return {
    range: { from: c.range.from, to: c.range.to, days: c.range.days, timeZone: c.range.timeZone },
    columns: { newEnquiries: canEnq, bookingsMade: canBook, visitsCompleted: canVisit, missedFollowUps: canFollow },
    rows,
    definition: 'Per employee, over the selected days: enquiries created and assigned to them, bookings made, site visits they completed, and follow-ups of theirs that are missed right now. Only the people and records you can see are included.',
  };
}
