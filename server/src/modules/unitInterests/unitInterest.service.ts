import type { Types } from 'mongoose';
import { z } from 'zod';
import { recordActivity } from '../../core/activity/activity.service';
import { recordAudit } from '../../core/audit/audit.service';
import { hasPermission, type Principal } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { AppError } from '../../lib/appError';
import { objectIdSchema, toObjectId } from '../../lib/ids';
import { escapeRegex, toMeta, toWindow } from '../../lib/listQuery';
import { withTransaction } from '../../lib/transaction';
import { BOOKING_STATUS } from '../bookings/booking.status';
import { Booking } from '../bookings/booking.model';
import { Enquiry } from '../enquiries/enquiry.model';
import { SiteVisit } from '../sitevisits/sitevisit.model';
import { isUnitWithheldFromBuyers, withheldSellerUnitIds } from '../sellers/seller.eligibility';
import { Unit } from '../units/unit.model';
import { UNIT_STATUS_KEYS } from '../units/unit.status';
import { viewsOf as unitViewsOf, type UnitLean } from '../units/unit.service';
import { UnitInterest } from './unitInterest.model';
import { linkedUnits } from './unitRelations';

type Id = Types.ObjectId;
/** `status` is the relationship the person has with the unit: only these two are recorded by hand. Site visit, Booked and Sold follow from real visits, bookings and sales; Hold is not supported (it needs reservation rules). */
export const addInterestBody = z.object({ unitId: objectIdSchema, note: z.string().trim().max(500).optional(), status: z.enum(['INTERESTED', 'NOT_INTERESTED']).default('INTERESTED') }).strict();
export const withdrawInterestBody = z.object({ reason: z.string().trim().max(300).optional() }).strict();

/** Filter shape accepted by `listEligibleUnitsForEnquiry`. Mirrors the units list filter but only the bits the picker needs. */
export const eligibleUnitsQuery = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

interface InterestLean { _id: Id; branchId: Id; unitId: Id; unitCode: string; enquiryId: Id; enquiryNo: string; personId: Id; status: 'INTERESTED' | 'WITHDRAWN'; note?: string; withdrawnAt?: Date; withdrawReason?: string; createdAt?: Date }
interface EnquiryRef { _id: Id; enquiryNo: string; personName: string; stageCode: string; branchId: Id; personId: Id; isArchived?: boolean }

const repo = (p: Principal) => scopedRepo(UnitInterest, p);
const visible = (p: Principal, ...keys: Parameters<typeof hasPermission>[1][]) => keys.every((k) => hasPermission(p, k));
/**
 * The set of status keys that mean "this is the standard lifecycle, not an admin hold". UNDER_DEVELOPMENT is
 * owned by Seller Management, so it never behaves like a hold that lapses with `heldUntil`: the unit only
 * becomes eligible when its property is released (which moves it to AVAILABLE).
 */
const STANDARD_STATUS_KEYS: ReadonlySet<string> = new Set([UNIT_STATUS_KEYS.AVAILABLE, UNIT_STATUS_KEYS.BOOKED, UNIT_STATUS_KEYS.SOLD, UNIT_STATUS_KEYS.UNDER_DEVELOPMENT]);

/**
 * Why a unit is NOT eligible for a new interest relationship right now. Used in the API response
 * so the modal can show a useful message instead of just "no".
 */
export type IneligibleReason = 'SOLD' | 'BOOKED' | 'ON_HOLD' | 'EXPIRED' | 'ARCHIVED' | 'OTHER_BRANCH' | 'NOT_FOUND' | 'SELLER_NOT_RELEASED';

/**
 * Single source of truth for "can this unit be linked to a new interest?".
 * A unit is eligible when ALL of:
 *  - it exists, is not archived, and is in the same branch as the enquiry
 *  - statusKey is AVAILABLE, OR statusKey is a non-standard (admin) status whose `heldUntil`
 *    is in the past (the hold has expired, even if a background job has not run)
 *  - it has no ACTIVE booking (the unique partial index on Booking.unitId already enforces
 *    this; the check here is a defence-in-depth re-validation at the right moment)
 */
export function ineligibleReason(unit: { _id: Id; statusKey: string; isArchived?: boolean; heldUntil?: Date | null }, opts: { hasActiveBooking: boolean; now?: Date; sameBranch?: boolean; withheldBySeller?: boolean }): IneligibleReason | null {
  if (unit.isArchived) return 'ARCHIVED';
  if (opts.sameBranch === false) return 'OTHER_BRANCH';
  if (unit.statusKey === UNIT_STATUS_KEYS.SOLD) return 'SOLD';
  if (opts.hasActiveBooking || unit.statusKey === UNIT_STATUS_KEYS.BOOKED) return 'BOOKED';
  // Checked on the write path as well as in the picker: a unit bought through Seller Management stays
  // unavailable until its property is released, and "hidden from the list" alone would still allow a
  // direct API call with its id to link a buyer to un-refurbished stock.
  if (opts.withheldBySeller || unit.statusKey === UNIT_STATUS_KEYS.UNDER_DEVELOPMENT) return 'SELLER_NOT_RELEASED';
  if (!STANDARD_STATUS_KEYS.has(unit.statusKey)) {
    const expired = unit.heldUntil != null && unit.heldUntil.getTime() <= (opts.now ?? new Date()).getTime();
    if (!expired) return 'ON_HOLD';
  }
  return null;
}

/** Human-friendly message for a given reason. */
export function ineligibleMessage(reason: IneligibleReason, unitCode?: string): string {
  const u = unitCode ? `${unitCode} ` : 'This unit ';
  switch (reason) {
    case 'SOLD': return `${u}is sold and cannot take a new interest.`;
    case 'BOOKED': return `${u}is already booked by someone else.`;
    case 'ON_HOLD': return `${u}is on hold and is not available for a new interest right now.`;
    case 'EXPIRED': return `${u}is no longer available.`;
    case 'ARCHIVED': return `${u}is archived and cannot take a new interest.`;
    case 'OTHER_BRANCH': return `${u}belongs to another branch.`;
    case 'SELLER_NOT_RELEASED': return `${u}was acquired from a seller and is still being prepared. It is not available to buyers until it is released.`;
    case 'NOT_FOUND': return 'The unit is no longer available.';
  }
}

/** What each interest has actually reached, from the real records (never stored a second time). */
export type Progress = 'INTERESTED' | 'SITE_VISIT_SCHEDULED' | 'SITE_VISIT_COMPLETED' | 'BOOKED' | 'BOOKING_RELEASED' | 'WITHDRAWN';

export async function progressOf(principal: Principal, rows: InterestLean[]): Promise<Map<string, Progress>> {
  const out = new Map<string, Progress>();
  if (rows.length === 0) return out;
  const enquiryIds = [...new Set(rows.map((r) => r.enquiryId.toHexString()))].map((i) => toObjectId(i));
  const unitIds = [...new Set(rows.map((r) => r.unitId.toHexString()))].map((i) => toObjectId(i));
  const [visits, bookings] = await Promise.all([
    hasPermission(principal, 'sitevisits.view') ? scopedRepo(SiteVisit, principal).find({ enquiryId: { $in: enquiryIds }, 'units.unitId': { $in: unitIds } }).select('enquiryId units statusKey').lean<{ enquiryId: Id; units: { unitId: Id }[]; statusKey: string }[]>() : [],
    hasPermission(principal, 'bookings.view') ? scopedRepo(Booking, principal).find({ enquiryId: { $in: enquiryIds }, unitId: { $in: unitIds } }).select('enquiryId unitId status').lean<{ enquiryId: Id; unitId: Id; status: string }[]>() : [],
  ]);
  for (const r of rows) {
    const key = `${r.enquiryId.toHexString()}:${r.unitId.toHexString()}`;
    const bs = bookings.filter((b) => `${b.enquiryId.toHexString()}:${b.unitId.toHexString()}` === key);
    const vs = visits.filter((v) => v.enquiryId.equals(r.enquiryId) && v.units.some((u) => u.unitId.equals(r.unitId)));
    let p: Progress = 'INTERESTED';
    if (r.status === 'WITHDRAWN') p = 'WITHDRAWN';
    else if (bs.some((b) => b.status === 'ACTIVE')) p = 'BOOKED';
    else if (bs.length) p = 'BOOKING_RELEASED';
    else if (vs.some((v) => v.statusKey === 'COMPLETED')) p = 'SITE_VISIT_COMPLETED';
    else if (vs.some((v) => v.statusKey === 'SCHEDULED')) p = 'SITE_VISIT_SCHEDULED';
    out.set(r._id.toHexString(), p);
  }
  return out;
}

/** Interests for the given filter, restricted to enquiries / units the caller can actually see (OWN scope included). */
async function viewsOf(principal: Principal, rows: InterestLean[]) {
  const [units, enquiries, progress] = await Promise.all([
    visible(principal, 'units.view') ? scopedRepo(Unit, principal, { includeArchived: true }).find({ _id: { $in: rows.map((r) => r.unitId) } }).select('unitCode name statusKey expectedPrice city').lean<{ _id: Id; unitCode: string; name: string; statusKey: string; expectedPrice?: number; city?: string }[]>() : [],
    visible(principal, 'enquiries.view') ? scopedRepo(Enquiry, principal, { includeArchived: true }).find({ _id: { $in: rows.map((r) => r.enquiryId) } }).select('enquiryNo personName stageCode').lean<EnquiryRef[]>() : [],
    progressOf(principal, rows),
  ]);
  const u = new Map(units.map((x) => [x._id.toHexString(), x]));
  const e = new Map(enquiries.map((x) => [x._id.toHexString(), x]));
  return rows.map((r) => {
    const unit = u.get(r.unitId.toHexString());
    const enq = e.get(r.enquiryId.toHexString());
    return {
      id: r._id.toHexString(), status: r.status, progress: progress.get(r._id.toHexString()) ?? 'INTERESTED', note: r.note, createdAt: r.createdAt, withdrawnAt: r.withdrawnAt, withdrawReason: r.withdrawReason,
      unitId: r.unitId.toHexString(), unitCode: r.unitCode, unit: unit ? { id: unit._id.toHexString(), name: unit.name, statusKey: unit.statusKey, expectedPrice: unit.expectedPrice, city: unit.city } : undefined,
      enquiryId: r.enquiryId.toHexString(), enquiryNo: r.enquiryNo, enquiry: enq ? { id: enq._id.toHexString(), name: enq.personName, stageCode: enq.stageCode } : undefined,
      personId: r.personId.toHexString(),
    };
  });
}

/** The interests of one enquiry. */
export async function listForEnquiry(principal: Principal, enquiryId: string) {
  const e = await scopedRepo(Enquiry, principal, { includeArchived: true }).findById(enquiryId).select('_id').lean<{ _id: Id }>();
  if (!e) throw AppError.notFound('Enquiry not found');
  const rows = await repo(principal).find({ enquiryId: e._id }).sort({ createdAt: -1 }).limit(100).lean<InterestLean[]>();
  return viewsOf(principal, rows);
}

/** The interests in one unit, limited to the enquiries the caller may see. */
export async function listForUnit(principal: Principal, unitId: string) {
  if (!hasPermission(principal, 'enquiries.view')) return { visible: false as const, rows: [] };
  const u = await scopedRepo(Unit, principal, { includeArchived: true }).findById(unitId).select('_id').lean<{ _id: Id }>();
  if (!u) throw AppError.notFound('Unit not found');
  const rows = await repo(principal).find({ unitId: u._id }).sort({ createdAt: -1 }).limit(100).lean<InterestLean[]>();
  const seen = new Set((await scopedRepo(Enquiry, principal, { includeArchived: true }).find({ _id: { $in: rows.map((r) => r.enquiryId) } }).select('_id').lean<{ _id: Id }[]>()).map((x) => x._id.toHexString()));
  return { visible: true as const, rows: await viewsOf(principal, rows.filter((r) => seen.has(r.enquiryId.toHexString()))) };
}

/** The unit statuses that, on their own, make a unit eligible (without considering bookings/holds). */
const ELIGIBLE_STATUS_BRANCHES: Record<string, unknown>[] = [
  { statusKey: UNIT_STATUS_KEYS.AVAILABLE },
  // A non-standard status is eligible ONLY when its `heldUntil` is in the past. The check
  // happens here, not in a background job, so the picker reflects reality even if the
  // sweeper has not run. `heldUntil == null` is treated as indefinite, so those stay held.
  { statusKey: { $nin: [...STANDARD_STATUS_KEYS] }, heldUntil: { $lte: new Date() } },
];

/**
 * Lists units the caller can offer as a NEW interest for the given enquiry. The list is the
 * caller's own scope, narrowed to the enquiry's branch, and only ever shows units that are
 * genuinely eligible right now (Available, or an expired hold) AND have no ACTIVE booking.
 * Existing interests do not exclude a unit: a unit can be of interest to several enquiries.
 */
export async function listEligibleUnitsForEnquiry(principal: Principal, enquiryId: string, q: z.infer<typeof eligibleUnitsQuery>) {
  const enquiry = await scopedRepo(Enquiry, principal).findById(enquiryId).select('branchId isArchived').lean<{ _id: Id; branchId: Id; isArchived?: boolean }>();
  if (!enquiry) throw AppError.notFound('Enquiry not found');
  const branch = enquiry.branchId;

  // 1) Candidate units: same branch, not archived, AVAILABLE or expired-hold.
  const candidateFilter: Record<string, unknown> = {
    isArchived: { $ne: true },
    branchId: branch,
    $or: ELIGIBLE_STATUS_BRANCHES,
  };
  const term = q.search?.trim();
  if (term) {
    const rx = new RegExp(escapeRegex(term), 'i');
    candidateFilter.$and = [{ $or: [{ name: rx }, { address: rx }, { city: rx }, { unitCode: new RegExp(`^${escapeRegex(term)}`, 'i') }] }];
    if (/^\d{1,9}$/.test(term)) {
      (candidateFilter.$and as Record<string, unknown>[]).push({ unitCode: new RegExp(`^UNT-0*${term.replace(/^0+/, '') || '0'}$`, 'i') });
    }
  }

  // 2) Subtract units that have an ACTIVE booking — the partial unique index on
  //    Booking.unitId (status=ACTIVE) is the truth, but the enquiry/interest
  //    surface does not own that view, so we query through scopedRepo.
  const bookingRepo = scopedRepo(Booking, principal);
  const active = await bookingRepo.find({ status: BOOKING_STATUS.active, unitId: { $exists: true } }).select('unitId').lean<{ unitId: Id }[]>();
  const bookedIds = [...new Set(active.map((b) => b.unitId.toHexString()))];

  // 2b) Subtract seller-originated units that have not been released to buyers. A unit bought
  //     through Seller Management stays invisible to buyers until its property is marked
  //     Ready to Sell, so refurbishment/development never leaks half-finished stock into a
  //     picker. Units that did not come through Seller Management are untouched by this rule.
  const withheldIds = await withheldSellerUnitIds(branch);

  // 3) Apply the negative and the candidate filter; the same query is used for total + page.
  const exclusions = [
    ...(bookedIds.length ? [{ _id: { $nin: bookedIds.map((s) => toObjectId(s)) } }] : []),
    ...(withheldIds.length ? [{ _id: { $nin: withheldIds.map((s) => toObjectId(s)) } }] : []),
  ];
  const filter: Record<string, unknown> = exclusions.length ? { $and: [candidateFilter, ...exclusions] } : candidateFilter;
  const unitRepo = scopedRepo(Unit, principal, { includeArchived: false });
  const { skip, limit } = toWindow({ page: q.page, limit: q.limit });
  const [rows, total] = await Promise.all([
    unitRepo.find(filter).sort({ unitCode: 1, _id: -1 }).collation({ locale: 'en', strength: 2 }).skip(skip).limit(limit).lean<UnitLean[]>(),
    unitRepo.countDocuments(filter),
  ]);
  const views = await unitViewsOf(principal, rows, false);
  return { rows: views, meta: toMeta({ page: q.page, limit: q.limit }, total) };
}

/** Adds (or re-activates) an interest. Does not touch the enquiry's stage, the unit's status or any booking. */
export async function addInterest(principal: Principal, enquiryId: string, input: z.infer<typeof addInterestBody>) {
  const enquiry = await scopedRepo(Enquiry, principal).findById(enquiryId).select('enquiryNo personId personName branchId stageCode').lean<EnquiryRef>();
  if (!enquiry) throw AppError.notFound('Enquiry not found'); // archived enquiries are not offered by the default scoped read
  const unit = await scopedRepo(Unit, principal).findById(input.unitId).select('unitCode name branchId statusKey heldUntil isArchived').lean<{ _id: Id; unitCode: string; name: string; branchId: Id; statusKey: string; heldUntil?: Date | null; isArchived?: boolean }>();
  if (!unit) throw AppError.notFound('Unit not found');
  // Branch mismatch is checked first; the eligibility rules below assume the unit is in the
  // enquiry's branch, and a cross-branch unit must never be reported with an interest-friendly reason.
  if (!unit.branchId.equals(enquiry.branchId)) throw AppError.validation('The unit belongs to another branch than this enquiry', [{ path: 'unitId', message: 'Choose a unit of this enquiry\'s branch' }]);
  // Re-validate eligibility at the moment of the write. The picker has just shown this unit as
  // available, but another tab/user may have changed it. We re-check against authoritative data
  // (booking + status + hold expiry) and refuse with a clear code so the modal can refresh.
  const now = new Date();
  const hasActiveBooking = Boolean(await scopedRepo(Booking, principal).exists({ unitId: unit._id, status: BOOKING_STATUS.active }));
  const withheldBySeller = await isUnitWithheldFromBuyers(unit._id);
  const reason = ineligibleReason(unit, { hasActiveBooking, now, sameBranch: true, withheldBySeller });
  if (reason) {
    throw AppError.conflict('UNIT_NOT_ELIGIBLE', ineligibleMessage(reason, unit.unitCode), { path: 'unitId', reason, unitCode: unit.unitCode });
  }
  const uid = toObjectId(principal.userId);
  const branchId = enquiry.branchId.toHexString();
  const existing = await repo(principal).findOne({ enquiryId: enquiry._id, unitId: unit._id }).lean<InterestLean>();
  const wantsInterest = input.status === 'INTERESTED';
  const current = existing?.status;
  if ((wantsInterest && current === 'INTERESTED') || (!wantsInterest && current === 'WITHDRAWN')) {
    throw AppError.conflict('INTEREST_EXISTS', wantsInterest ? `${unit.unitCode} is already an interested unit of ${enquiry.enquiryNo}` : `${unit.unitCode} is already marked not interested for ${enquiry.enquiryNo}`);
  }
  const dupe = () => AppError.conflict('INTEREST_EXISTS', `${unit.unitCode} already has a relationship with ${enquiry.enquiryNo}`);

  const saved = await withTransaction(async (session) => {
    let row: InterestLean;
    const now = new Date();
    if (existing) {
      const change = wantsInterest
        ? { $set: { status: 'INTERESTED', note: input.note, updatedBy: uid }, $unset: { withdrawnAt: 1, withdrawnBy: 1, withdrawReason: 1 } }
        : { $set: { status: 'WITHDRAWN', withdrawnAt: now, withdrawnBy: uid, withdrawReason: input.note, updatedBy: uid } };
      row = (await repo(principal).findOneAndUpdate({ _id: existing._id, status: existing.status }, change, { new: true, session }).lean<InterestLean>())!;
      if (!row) throw dupe();
    } else {
      row = (await repo(principal).create({ branchId: enquiry.branchId, unitId: unit._id, unitCode: unit.unitCode, enquiryId: enquiry._id, enquiryNo: enquiry.enquiryNo, personId: enquiry.personId, note: input.note, createdBy: uid, ...(wantsInterest ? {} : { status: 'WITHDRAWN', withdrawnAt: now, withdrawnBy: uid, withdrawReason: input.note }) }, { session })).toObject() as unknown as InterestLean;
    }
    await recordAudit({ entityType: 'unitInterest', entityId: row._id, action: existing ? (wantsInterest ? 'reactivate' : 'withdraw') : 'create', after: { unit: unit.unitCode, enquiry: enquiry.enquiryNo, status: row.status }, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: wantsInterest ? 'UNIT_INTEREST_ADDED' : 'UNIT_INTEREST_WITHDRAWN', description: wantsInterest ? `${unit.unitCode} added as an interested unit of enquiry ${enquiry.enquiryNo} (${enquiry.personName})` : `${unit.unitCode} marked not interested for enquiry ${enquiry.enquiryNo} (${enquiry.personName})`, branchId, userId: principal.userId, refs: [{ type: 'enquiry', id: enquiry._id }, { type: 'unit', id: unit._id }, { type: 'person', id: enquiry.personId }] }, { session });
    return row;
  }).catch((err) => {
    if ((err as { code?: number }).code === 11000) throw dupe();
    throw err;
  });
  return (await viewsOf(principal, [saved]))[0]!;
}

/** Withdraws an interest. The unit, the enquiry and any booking are left exactly as they are. */
export async function withdrawInterest(principal: Principal, id: string, input: z.infer<typeof withdrawInterestBody>) {
  const row = await repo(principal).findById(id).lean<InterestLean>();
  if (!row) throw AppError.notFound('Interest not found');
  // the caller must be able to see the enquiry it belongs to (OWN scope)
  if (!(await scopedRepo(Enquiry, principal, { includeArchived: true }).exists({ _id: row.enquiryId }))) throw AppError.notFound('Interest not found');
  if (row.status === 'WITHDRAWN') return (await viewsOf(principal, [row]))[0]!;
  const uid = toObjectId(principal.userId);
  const branchId = row.branchId.toHexString();
  const updated = await withTransaction(async (session) => {
    const u = await repo(principal).findOneAndUpdate({ _id: row._id, status: 'INTERESTED' }, { $set: { status: 'WITHDRAWN', withdrawnAt: new Date(), withdrawnBy: uid, withdrawReason: input.reason, updatedBy: uid } }, { new: true, session }).lean<InterestLean>();
    if (!u) return row;
    await recordAudit({ entityType: 'unitInterest', entityId: row._id, action: 'withdraw', before: { status: 'INTERESTED' }, after: { status: 'WITHDRAWN' }, reason: input.reason, userId: principal.userId, branchId }, { session });
    await recordActivity({ type: 'UNIT_INTEREST_WITHDRAWN', description: `${row.unitCode} withdrawn from the interested units of enquiry ${row.enquiryNo}`, branchId, userId: principal.userId, refs: [{ type: 'enquiry', id: row.enquiryId }, { type: 'unit', id: row.unitId }, { type: 'person', id: row.personId }] }, { session });
    return u;
  });
  return (await viewsOf(principal, [updated]))[0]!;
}

// ---- linked units (pickers) ------------------------------------------------------------

/**
 * The units already LINKED to one enquiry, resolved by the server from the single canonical
 * relationship model (interests + bookings + visits merged, one entry per unit). Returns
 * `{ units: null }` when the caller may not view units — which the client renders as "no permission",
 * NOT as "this enquiry has none" — and `{ units: [] }` when there genuinely is no link yet.
 *
 * Nothing here filters by inventory status: a linked unit stays listed whatever became of it, so the
 * operator can still schedule a visit on a unit that was since booked. Availability for a NEW link is
 * a different question, answered by `listEligibleUnitsForEnquiry`.
 */
export async function linkedUnitsForEnquiry(principal: Principal, enquiryId: string) {
  // Scoped lookup first: an enquiry the caller may not see is a 404, not an empty list, and it also
  // pins the relationship query to an id the caller is allowed to resolve.
  const enquiry = await scopedRepo(Enquiry, principal).findById(enquiryId).select('_id').lean<{ _id: Id }>();
  if (!enquiry) throw AppError.notFound('Enquiry not found');
  return { units: await linkedUnits(principal, [enquiry._id]) };
}
