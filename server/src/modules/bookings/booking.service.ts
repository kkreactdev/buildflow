import type { ClientSession, Types } from 'mongoose';
import type { z } from 'zod';
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
import { withTransaction } from '../../lib/transaction';
import { Branch } from '../branches/branch.model';
import { Client } from '../clients/client.model';
import { Enquiry } from '../enquiries/enquiry.model';
import { persistTransition, prepareTransition, type EnquiryLean, type PreparedTransition } from '../enquiries/enquiry.service';
import { Unit } from '../units/unit.model';
import { getUnitStatusByKey } from '../units/unit.masters';
import type { UnitLean } from '../units/unit.service';
import { UNIT_STATUS_KEYS } from '../units/unit.status';
import { validateAssignee } from '../users/assignable';
import { User } from '../users/user.model';
import { isUnitWithheldFromBuyers } from '../sellers/seller.eligibility';
import { loadWorkflow } from '../workflow/workflow.service';
import { DOMAIN_OPERATIONS } from '../workflow/workflowDefaults';
import { Booking, BookingConflict, BookingEvent } from './booking.model';
import type { BookingFilters, createBookingBody, listBookingQuery, listConflictQuery, releaseBody, resolveConflictBody, updateBookingBody } from './booking.schema';
import { BOOKING_STATUS, CONFLICT_RESOLUTION, CONFLICT_STATUS } from './booking.status';

const BOOKING_NO = { prefix: 'BK-', width: 6 } as const;
export const nextBookingNo = async (): Promise<string> => formatSequence(await nextSequence('booking'), BOOKING_NO);

type Id = Types.ObjectId;
export type BookingLean = {
  _id: Id; bookingNo: string; branchId: Id; unitId: Id; unitCode: string; enquiryId: Id; enquiryNo: string; personId: Id; personName: string; phoneE164: string;
  clientId?: Id | null; clientNo?: string | null; salespersonId: Id; bookedBy: Id; bookingDate: Date; notes?: string | null; status: string;
  releasedAt?: Date | null; releasedBy?: Id | null; releaseReason?: string | null; createdAt?: Date; updatedAt?: Date;
};
type ConflictLean = {
  _id: Id; branchId: Id; unitId: Id; unitCode: string; existingBookingId?: Id | null; existingBookingNo?: string | null; attemptedBy: Id; attemptedEnquiryId: Id; attemptedEnquiryNo: string;
  attemptedPersonName: string; attemptedSalespersonId: Id; attemptedBookingDate: Date; attemptedNotes?: string | null; status: string; resolution?: string | null;
  resolvedBy?: Id | null; resolvedAt?: Date | null; resolutionNote?: string | null; resolvedBookingId?: Id | null; createdAt?: Date;
};

const repo = (p: Principal, requestedBranchId?: string) => scopedRepo(Booking, p, { requestedBranchId });
const CLOCK_TOLERANCE_MS = 5 * 60_000;
const MAX_BACKDATE_MS = 366 * 86_400_000;

/**
 * Releasing or replacing a booking is the MANAGER's authority over the unit and booking of THEIR branch, even if their
 * data scope were narrower. The permission still decides who may do it; this only sets the data the step may touch.
 */
function domainScope(principal: Principal, branchId: string): Principal {
  return principal.dataScope === 'OWN' ? { ...principal, dataScope: 'BRANCH', branchIds: [branchId] } : principal;
}

/** An attempt that lost the unit: either it was no longer AVAILABLE inside the transaction, or the database refused a second ACTIVE booking. */
class RaceLost extends Error {
  constructor(readonly why: 'UNIT_NOT_AVAILABLE' | 'DUPLICATE_ACTIVE') {
    super(why);
  }
}
/** Only a clash on the ONE-ACTIVE-BOOKING-PER-UNIT index means "someone else holds the unit"; any other duplicate (for example the booking number) is a real error. */
const isDuplicateKey = (e: unknown) => {
  const err = e as { code?: number; keyPattern?: Record<string, unknown>; message?: string } | undefined;
  return err?.code === 11000 && (Boolean(err.keyPattern && 'unitId' in err.keyPattern) || Boolean(err.message?.includes('one_active_booking_per_unit')));
};

function assertBookingDate(at: Date) {
  const now = Date.now();
  if (at.getTime() > now + CLOCK_TOLERANCE_MS) throw AppError.validation('The booking date cannot be in the future', [{ path: 'bookingDate', message: 'Choose a time that has passed' }]);
  if (at.getTime() < now - MAX_BACKDATE_MS) throw AppError.validation('The booking date is too far in the past', [{ path: 'bookingDate', message: 'Choose a date within the last year' }]);
}

// ---- views ------------------------------------------------------------------

async function lookups(principal: Principal, rows: BookingLean[], detail = false) {
  const userIds = [...new Set(rows.flatMap((r) => [r.salespersonId, r.bookedBy, r.releasedBy]).filter(Boolean).map((i) => i!.toHexString()))];
  const branchIds = [...new Set(rows.map((r) => r.branchId.toHexString()))];
  const unitIds = detail ? [...new Set(rows.map((r) => r.unitId.toHexString()))] : [];
  const personIds = [...new Set(rows.filter((r) => !r.clientId).map((r) => r.personId.toHexString()))];
  const [users, branches, units, clients] = await Promise.all([
    userIds.length ? scopedRepo(User, principal).find({ _id: { $in: userIds.map((i) => toObjectId(i)) } }).select('name').lean<{ _id: Id; name: string }[]>() : [],
    scopedRepo(Branch, principal).find({ _id: { $in: branchIds.map((i) => toObjectId(i)) } }).select('name code').lean<{ _id: Id; name: string; code: string }[]>(),
    unitIds.length ? scopedRepo(Unit, principal, { includeArchived: true }).find({ _id: { $in: unitIds.map((i) => toObjectId(i)) } }).select('name statusKey').lean<{ _id: Id; name: string; statusKey: string }[]>() : [],
    // A booking made before the person became a client carries no client id: the client is the person in the booking's branch.
    personIds.length ? scopedRepo(Client, principal).find({ personId: { $in: personIds.map((i) => toObjectId(i)) }, branchId: { $in: branchIds.map((i) => toObjectId(i)) } }).select('personId branchId clientNo').lean<{ _id: Id; personId: Id; branchId: Id; clientNo: string }[]>() : [],
  ]);
  return {
    users: new Map(users.map((u) => [u._id.toHexString(), u.name])),
    branches: new Map(branches.map((b) => [b._id.toHexString(), { name: b.name, code: b.code }])),
    units: new Map(units.map((u) => [u._id.toHexString(), u])),
    clients: new Map(clients.map((c) => [`${c.personId.toHexString()}:${c.branchId.toHexString()}`, { id: c._id.toHexString(), clientNo: c.clientNo }])),
  };
}
type Lookups = Awaited<ReturnType<typeof lookups>>;

export function toView(b: BookingLean, l: Lookups, p: Principal) {
  const active = b.status === BOOKING_STATUS.active;
  const can = (k: Parameters<typeof hasPermission>[1]) => hasPermission(p, k);
  const name = (i?: Id | null) => (i ? l.users.get(i.toHexString()) : undefined);
  const unit = l.units.get(b.unitId.toHexString());
  const resolved = l.clients.get(`${b.personId.toHexString()}:${b.branchId.toHexString()}`);
  return {
    id: b._id.toHexString(), bookingNo: b.bookingNo, branchId: b.branchId.toHexString(), branch: l.branches.get(b.branchId.toHexString()),
    unitId: b.unitId.toHexString(), unitCode: b.unitCode, unitName: unit?.name,
    enquiryId: b.enquiryId.toHexString(), enquiryNo: b.enquiryNo, clientId: b.clientId?.toHexString() ?? resolved?.id, clientNo: b.clientNo ?? resolved?.clientNo,
    personId: b.personId.toHexString(), name: b.personName, phone: formatPhone(b.phoneE164), phoneE164: b.phoneE164,
    salespersonId: b.salespersonId.toHexString(), salespersonName: name(b.salespersonId), bookedBy: b.bookedBy.toHexString(), bookedByName: name(b.bookedBy),
    bookingDate: b.bookingDate, notes: b.notes ?? undefined, status: b.status, isActive: active,
    releasedAt: b.releasedAt ?? undefined, releasedBy: b.releasedBy?.toHexString(), releasedByName: name(b.releasedBy), releaseReason: b.releaseReason ?? undefined,
    createdAt: b.createdAt, updatedAt: b.updatedAt,
    /** What this user may do right now; the UI shows exactly these controls (the API enforces them again). */
    allowed: { edit: active && can('bookings.edit'), release: active && can('bookings.release') },
  };
}

export async function viewsOf(principal: Principal, rows: BookingLean[], detail = false) {
  const l = await lookups(principal, rows, detail);
  return rows.map((r) => toView(r, l, principal));
}

// ---- reads --------------------------------------------------------------------

export function buildFilter(q: BookingFilters & { search?: string }): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];
  if (q.status) and.push({ status: { $in: q.status } });
  for (const f of ['unitId', 'enquiryId', 'personId', 'salespersonId'] as const) if (q[f]) and.push({ [f]: toObjectId(q[f]!) });
  if (q.from || q.to) and.push({ bookingDate: { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) } });
  const term = q.search?.trim();
  if (term) {
    const ors: Record<string, unknown>[] = [
      { personName: new RegExp(escapeRegex(term), 'i') }, { bookingNo: new RegExp(`^${escapeRegex(term)}`, 'i') },
      { unitCode: new RegExp(`^${escapeRegex(term)}`, 'i') }, { enquiryNo: new RegExp(`^${escapeRegex(term)}`, 'i') },
    ];
    const digits = phoneSearchDigits(term);
    if (digits) ors.push({ phoneE164: new RegExp(escapeRegex(digits)) });
    if (/^\d{1,9}$/.test(term)) ors.push({ bookingNo: new RegExp(`^BK-0*${term.replace(/^0+/, '') || '0'}$`) });
    and.push({ $or: ors });
  }
  return and.length ? { $and: and } : {};
}

export async function listBookings(principal: Principal, q: z.infer<typeof listBookingQuery>) {
  const filter = buildFilter(q);
  const r = repo(principal, q.branchId);
  const { skip, limit } = toWindow(q);
  const sort = parseSort(q.sort, ['bookingDate', 'createdAt', 'bookingNo', 'personName', 'unitCode'], { bookingDate: -1 });
  const [rows, total] = await Promise.all([
    r.find(filter).sort({ ...sort, _id: -1 }).collation({ locale: 'en', strength: 2 }).skip(skip).limit(limit).lean<BookingLean[]>(),
    r.countDocuments(filter),
  ]);
  return { rows: await viewsOf(principal, rows), meta: toMeta(q, total) };
}

export async function getBooking(principal: Principal, id: string) {
  const b = await repo(principal).findById(id).lean<BookingLean>();
  if (!b) throw AppError.notFound('Booking not found');
  const events = await scopedRepo(BookingEvent, principal).find({ bookingId: b._id }).sort({ at: 1, _id: 1 }).lean<{ _id: Id; type: string; byUserId?: Id; reason?: string; at: Date }[]>();
  const l = await lookups(principal, [b], true);
  const ids = [...new Set(events.map((e) => e.byUserId?.toHexString()).filter(Boolean) as string[])];
  const names = new Map((ids.length ? await scopedRepo(User, principal).find({ _id: { $in: ids.map((i) => toObjectId(i)) } }).select('name').lean<{ _id: Id; name: string }[]>() : []).map((u) => [u._id.toHexString(), u.name]));
  return {
    ...toView(b, l, principal),
    history: events.map((e) => ({ id: e._id.toHexString(), type: e.type, by: e.byUserId?.toHexString(), byName: e.byUserId ? names.get(e.byUserId.toHexString()) : undefined, reason: e.reason, at: e.at })),
  };
}

/**
 * What the unit detail page shows about booking: the active booking and past ones, only to users who may view
 * bookings, and only those within their scope. `allowed` is what the user may do with the unit's booking now.
 */
export async function unitBookingPanel(principal: Principal, unit: Pick<UnitLean, '_id' | 'statusKey' | 'isArchived'>) {
  const live = !unit.isArchived;
  // Not offered for a seller-acquired unit that has not been released: the action would be refused anyway.
  const book = live && unit.statusKey === UNIT_STATUS_KEYS.AVAILABLE && hasPermission(principal, 'bookings.create') && !(await isUnitWithheldFromBuyers(unit._id));
  if (!hasPermission(principal, 'bookings.view')) return { visible: false as const, active: undefined, history: [], allowed: { book, release: false } };
  const rows = await repo(principal).find({ unitId: unit._id }).sort({ bookingDate: -1, _id: -1 }).limit(30).lean<BookingLean[]>();
  const views = await viewsOf(principal, rows);
  const active = views.find((v) => v.isActive);
  return { visible: true as const, active, history: views.filter((v) => !v.isActive), allowed: { book, release: Boolean(active?.allowed.release) } };
}

// ---- the booking transaction -------------------------------------------------------

interface Attempt {
  unit: UnitLean;
  enquiry: EnquiryLean;
  salespersonId: string;
  bookedBy: string;
  bookingDate: Date;
  notes?: string;
  move?: PreparedTransition;
  client?: { _id: Id; clientNo: string };
  bookingNo: string;
  bookedStatus: { _id: Id };
  /** Display names for notifications. */
  actorName?: string;
}

const refsOf = (b: Pick<BookingLean, '_id' | 'unitId' | 'enquiryId' | 'personId' | 'clientId'>) => [
  { type: 'booking' as const, id: b._id },
  { type: 'unit' as const, id: b.unitId },
  { type: 'enquiry' as const, id: b.enquiryId },
  { type: 'person' as const, id: b.personId },
  ...(b.clientId ? [{ type: 'client' as const, id: b.clientId }] : []),
];

/**
 * THE atomic step. Inside the caller's transaction:
 *   1. flip the unit AVAILABLE -> BOOKED with a compare-and-set (matches nothing if someone else got there first),
 *   2. create the booking (the partial unique index independently refuses a second ACTIVE booking of the unit),
 *   3. move the enquiry through the workflow, write history, audit, timeline and notification.
 * Any failure aborts everything; losing the race throws RaceLost and leaves no trace.
 */
async function insertBooking(ctx: Principal, a: Attempt, session: ClientSession): Promise<BookingLean> {
  const now = new Date();
  const branch = a.unit.branchId.toHexString();
  const uid = toObjectId(a.bookedBy);

  const u = await scopedRepo(Unit, ctx)
    .findOneAndUpdate({ _id: a.unit._id, statusKey: UNIT_STATUS_KEYS.AVAILABLE }, { $set: { statusId: a.bookedStatus._id, statusKey: UNIT_STATUS_KEYS.BOOKED, statusChangedAt: now, updatedBy: uid } }, { new: true, session })
    .lean<UnitLean>();
  if (!u) throw new RaceLost('UNIT_NOT_AVAILABLE');

  let b: BookingLean;
  try {
    const doc = await repo(ctx).create(
      {
        bookingNo: a.bookingNo, branchId: a.unit.branchId, unitId: a.unit._id, unitCode: a.unit.unitCode, enquiryId: a.enquiry._id, enquiryNo: a.enquiry.enquiryNo,
        personId: a.enquiry.personId, personName: a.enquiry.personName, phoneE164: a.enquiry.phoneE164, ...(a.client ? { clientId: a.client._id, clientNo: a.client.clientNo } : {}),
        salespersonId: toObjectId(a.salespersonId), bookedBy: uid, bookingDate: a.bookingDate, notes: a.notes, status: BOOKING_STATUS.active,
      },
      { session },
    );
    b = doc.toObject() as unknown as BookingLean;
  } catch (err) {
    if (isDuplicateKey(err)) throw new RaceLost('DUPLICATE_ACTIVE');
    throw err;
  }

  await scopedRepo(BookingEvent, ctx).create({ bookingId: b._id, bookingNo: b.bookingNo, branchId: b.branchId, unitId: b.unitId, enquiryId: b.enquiryId, salespersonId: b.salespersonId, type: 'CREATED', byUserId: uid, at: now }, { session });
  if (a.move) await persistTransition(ctx, a.enquiry, a.move, session);
  await recordAudit({ entityType: 'booking', entityId: b._id, action: 'create', after: { bookingNo: b.bookingNo, unitCode: b.unitCode, enquiryNo: b.enquiryNo, salespersonId: b.salespersonId, bookingDate: b.bookingDate, status: b.status }, userId: ctx.userId, branchId: branch }, { session });
  await recordAudit({ entityType: 'unit', entityId: a.unit._id, action: 'status', before: { statusKey: UNIT_STATUS_KEYS.AVAILABLE }, after: { statusKey: UNIT_STATUS_KEYS.BOOKED }, reason: `Booked: ${b.bookingNo}`, userId: ctx.userId, branchId: branch }, { session });
  await recordActivity({ type: 'BOOKING_CREATED', description: `Unit ${b.unitCode} booked for ${b.personName} (${b.bookingNo})`, branchId: branch, userId: ctx.userId, at: now, refs: refsOf(b), metadata: { bookingNo: b.bookingNo } }, { session });
  await notify({
    event: 'BOOKING_CREATED', branchId: branch, payload: { unit: b.unitCode, booking: b.bookingNo, person: b.personName, ...(a.actorName ? { by: a.actorName } : {}) },
    refs: refsOf(b), dedupeKey: `booking-created:${b._id}`, excludeUserId: ctx.userId, session,
  });
  return b;
}

/** Everything a booking attempt needs that can be checked BEFORE the transaction, so ordinary refusals never touch the data. */
async function prepareAttempt(principal: Principal, input: { unitId: string; enquiryId: string; bookingDate: Date; salespersonId?: string; notes?: string }) {
  assertBookingDate(input.bookingDate);
  const unit = await scopedRepo(Unit, principal).findById(input.unitId).lean<UnitLean>();
  if (!unit) throw AppError.notFound('Unit not found');
  const enquiry = await scopedRepo(Enquiry, principal).findById(input.enquiryId).lean<EnquiryLean>();
  if (!enquiry) throw AppError.notFound('Enquiry not found');
  if (!unit.branchId.equals(enquiry.branchId)) throw AppError.validation('The unit and the enquiry belong to different branches', [{ path: 'unitId', message: "Choose a unit of the enquiry's branch" }]);
  const branch = unit.branchId.toHexString();

  const wf = await loadWorkflow();
  if (wf.get(enquiry.stageCode).kind === 'LOST') throw new AppError('ENQUIRY_LOST', 409, 'A lost enquiry cannot be booked. Reopen it first.');

  let salespersonId = input.salespersonId;
  if (salespersonId) await validateAssignee(principal, salespersonId, branch);
  else {
    for (const candidate of [principal.dataScope === 'OWN' ? principal.userId : enquiry.assignedTo?.toHexString(), principal.userId]) {
      if (!candidate) continue;
      try {
        await validateAssignee(principal, candidate, branch);
        salespersonId = candidate;
        break;
      } catch {
        /* try the next candidate */
      }
    }
    if (!salespersonId) throw AppError.validation('Choose the salesperson for this booking', [{ path: 'salespersonId', message: 'Required' }]);
  }

  // The enquiry enters BOOKED through this operation only, from the stage just before it; an enquiry already at or past it stays.
  const bookedStage = wf.stages.find((s) => s.entryPolicy === 'DOMAIN' && s.domainOperation === DOMAIN_OPERATIONS.createBooking && s.isActive);
  let move: PreparedTransition | undefined;
  if (bookedStage && wf.get(enquiry.stageCode).order < bookedStage.order) {
    move = await prepareTransition(principal, enquiry, { to: bookedStage.systemKey, reason: 'Unit booked' }, undefined, DOMAIN_OPERATIONS.createBooking);
  }
  const client = await scopedRepo(Client, principal).findOne({ personId: enquiry.personId, branchId: unit.branchId }).select('clientNo').lean<{ _id: Id; clientNo: string }>();
  const actor = await scopedRepo(User, principal).findById(principal.userId).select('name').lean<{ name: string }>();
  return { unit, enquiry, salespersonId: salespersonId!, move, client: client ?? undefined, actorName: actor?.name };
}

export async function createBooking(principal: Principal, input: z.infer<typeof createBookingBody>) {
  const p = await prepareAttempt(principal, input);
  const bookedStatus = await getUnitStatusByKey(UNIT_STATUS_KEYS.BOOKED);

  // A unit bought through Seller Management is unfinished stock until its property is released (it sits
  // UNDER_DEVELOPMENT, which the status check below refuses too). Checked first and on the property itself,
  // so a buyer can never be sold a property the company is still refurbishing, whatever the unit's status says.
  if (await isUnitWithheldFromBuyers(p.unit._id)) {
    throw new AppError('UNIT_NOT_AVAILABLE', 409, `${p.unit.unitCode} was acquired from a seller and is still being prepared. It cannot be booked until it is released.`);
  }

  // Not available: BOOKED means someone holds it (a conflict a manager should see); any other status is simply refused.
  if (p.unit.statusKey !== UNIT_STATUS_KEYS.AVAILABLE) {
    if (p.unit.statusKey === UNIT_STATUS_KEYS.BOOKED) throw await recordConflict(principal, p, input);
    throw new AppError('UNIT_NOT_AVAILABLE', 409, 'This unit is not available for booking');
  }

  const bookingNo = await nextBookingNo(); // atomic; attempts that lose only leave a gap
  try {
    const b = await withTransaction((session) =>
      insertBooking(principal, { ...p, salespersonId: p.salespersonId, bookedBy: principal.userId, bookingDate: input.bookingDate, notes: input.notes, bookingNo, bookedStatus }, session),
    );
    return (await viewsOf(principal, [b], true))[0]!;
  } catch (err) {
    // Lost the race: the transaction has been rolled back completely. Record the conflict separately and answer 409.
    if (err instanceof RaceLost || isDuplicateKey(err)) throw await recordConflict(principal, p, input);
    throw err;
  }
}

// ---- conflicts ----------------------------------------------------------------------------

/**
 * Records a lost attempt for managers (its own transaction, after the booking one was rolled back) and returns the
 * 409 to send. The response only names the holding booking when this user could see it anyway.
 */
async function recordConflict(principal: Principal, p: Awaited<ReturnType<typeof prepareAttempt>>, input: { bookingDate: Date; notes?: string }): Promise<AppError> {
  const branch = p.unit.branchId.toHexString();
  const ds = domainScope(principal, branch);
  const existing = await scopedRepo(Booking, ds).findOne({ unitId: p.unit._id, status: BOOKING_STATUS.active }).select('bookingNo').lean<{ _id: Id; bookingNo: string }>();
  const now = new Date();
  const conflict = await withTransaction(async (session) => {
    const doc = await scopedRepo(BookingConflict, principal).create(
      {
        branchId: p.unit.branchId, unitId: p.unit._id, unitCode: p.unit.unitCode, existingBookingId: existing?._id, existingBookingNo: existing?.bookingNo,
        attemptedBy: toObjectId(principal.userId), attemptedEnquiryId: p.enquiry._id, attemptedEnquiryNo: p.enquiry.enquiryNo, attemptedPersonName: p.enquiry.personName,
        attemptedSalespersonId: toObjectId(p.salespersonId), attemptedBookingDate: input.bookingDate, attemptedNotes: input.notes, status: CONFLICT_STATUS.open,
      },
      { session },
    );
    const c = doc.toObject() as unknown as ConflictLean;
    const refs = [{ type: 'unit' as const, id: p.unit._id }, { type: 'enquiry' as const, id: p.enquiry._id }, ...(existing ? [{ type: 'booking' as const, id: existing._id }] : [])];
    await recordAudit({ entityType: 'bookingConflict', entityId: c._id, action: 'conflict', after: { unitCode: c.unitCode, existingBookingNo: c.existingBookingNo, attemptedEnquiryNo: c.attemptedEnquiryNo, attemptedBy: c.attemptedBy }, userId: principal.userId, branchId: branch }, { session });
    await recordActivity({ type: 'BOOKING_CONFLICT', description: `Booking of ${c.unitCode} for ${c.attemptedPersonName} was refused: the unit is already booked`, branchId: branch, userId: principal.userId, at: now, refs, metadata: { conflictId: c._id.toHexString() } }, { session });
    await notify({
      event: 'BOOKING_CONFLICT', branchId: branch, payload: { unit: c.unitCode, person: c.attemptedPersonName, ...(p.actorName ? { by: p.actorName } : {}) },
      refs: [...refs, { type: 'bookingConflict', id: c._id }], dedupeKey: `booking-conflict:${c._id}`, excludeUserId: principal.userId, session,
    });
    return c;
  });
  const visible = existing ? await scopedRepo(Booking, principal).exists({ _id: existing._id }) : null;
  return AppError.conflict('BOOKING_CONFLICT', 'This unit was just booked by someone else, so your booking was not made. A manager has been told.', {
    conflictId: conflict._id.toHexString(), unitId: p.unit._id.toHexString(), unitCode: p.unit.unitCode, ...(visible && existing ? { existingBookingNo: existing.bookingNo } : {}),
  });
}

function conflictView(c: ConflictLean, names: Map<string, string>, p: Principal) {
  const name = (i?: Id | null) => (i ? names.get(i.toHexString()) : undefined);
  return {
    id: c._id.toHexString(), branchId: c.branchId.toHexString(), unitId: c.unitId.toHexString(), unitCode: c.unitCode,
    existingBookingId: c.existingBookingId?.toHexString(), existingBookingNo: c.existingBookingNo ?? undefined,
    attemptedBy: c.attemptedBy.toHexString(), attemptedByName: name(c.attemptedBy), attemptedEnquiryId: c.attemptedEnquiryId.toHexString(), attemptedEnquiryNo: c.attemptedEnquiryNo,
    attemptedPersonName: c.attemptedPersonName, attemptedSalespersonId: c.attemptedSalespersonId.toHexString(), attemptedSalespersonName: name(c.attemptedSalespersonId),
    attemptedBookingDate: c.attemptedBookingDate, attemptedNotes: c.attemptedNotes ?? undefined, status: c.status, resolution: c.resolution ?? undefined,
    resolvedBy: c.resolvedBy?.toHexString(), resolvedByName: name(c.resolvedBy), resolvedAt: c.resolvedAt ?? undefined, resolutionNote: c.resolutionNote ?? undefined,
    resolvedBookingId: c.resolvedBookingId?.toHexString(), createdAt: c.createdAt,
    allowed: { resolve: c.status === CONFLICT_STATUS.open && hasPermission(p, 'bookings.resolve_conflict') },
  };
}

async function conflictNames(principal: Principal, rows: ConflictLean[]) {
  const ids = [...new Set(rows.flatMap((c) => [c.attemptedBy, c.attemptedSalespersonId, c.resolvedBy]).filter(Boolean).map((i) => i!.toHexString()))];
  const users = ids.length ? await scopedRepo(User, principal).find({ _id: { $in: ids.map((i) => toObjectId(i)) } }).select('name').lean<{ _id: Id; name: string }[]>() : [];
  return new Map(users.map((u) => [u._id.toHexString(), u.name]));
}

export async function listConflicts(principal: Principal, q: z.infer<typeof listConflictQuery>) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.unitId) filter.unitId = toObjectId(q.unitId);
  const r = scopedRepo(BookingConflict, principal, { requestedBranchId: q.branchId });
  const { skip, limit } = toWindow(q);
  const sort = parseSort(q.sort, ['createdAt'], { createdAt: -1 });
  const [rows, total] = await Promise.all([r.find(filter).sort({ ...sort, _id: -1 }).skip(skip).limit(limit).lean<ConflictLean[]>(), r.countDocuments(filter)]);
  const names = await conflictNames(principal, rows);
  return { rows: rows.map((c) => conflictView(c, names, principal)), meta: toMeta(q, total) };
}

export async function resolveConflict(principal: Principal, id: string, input: z.infer<typeof resolveConflictBody>) {
  const c = await scopedRepo(BookingConflict, principal).findById(id).lean<ConflictLean>();
  if (!c) throw AppError.notFound('Booking conflict not found');
  if (c.status !== CONFLICT_STATUS.open) throw AppError.conflict('CONFLICT_RESOLVED', 'This conflict has already been resolved');
  const branch = c.branchId.toHexString();
  const now = new Date();
  const uid = toObjectId(principal.userId);

  const finish = async (session: ClientSession, resolution: string, resolvedBookingId?: Id) => {
    const x = await scopedRepo(BookingConflict, principal)
      .findOneAndUpdate({ _id: c._id, status: CONFLICT_STATUS.open }, { $set: { status: CONFLICT_STATUS.resolved, resolution, resolvedBy: uid, resolvedAt: now, resolutionNote: input.reason, ...(resolvedBookingId ? { resolvedBookingId } : {}) } }, { new: true, session })
      .lean<ConflictLean>();
    if (!x) throw AppError.conflict('CONFLICT_RESOLVED', 'This conflict has already been resolved');
    await recordAudit({ entityType: 'bookingConflict', entityId: c._id, action: 'resolve', before: { status: CONFLICT_STATUS.open }, after: { status: CONFLICT_STATUS.resolved, resolution, resolvedBookingId }, reason: input.reason, userId: principal.userId, branchId: branch }, { session });
    await recordActivity({ type: 'BOOKING_CONFLICT_RESOLVED', description: resolution === CONFLICT_RESOLUTION.replace ? `Conflict on ${c.unitCode} resolved: booking replaced for ${c.attemptedPersonName}` : `Conflict on ${c.unitCode} resolved: existing booking kept`, branchId: branch, userId: principal.userId, at: now, refs: [{ type: 'unit', id: c.unitId }, { type: 'enquiry', id: c.attemptedEnquiryId }, ...(c.existingBookingId ? [{ type: 'booking' as const, id: c.existingBookingId }] : [])], metadata: { conflictId: c._id.toHexString(), resolution } }, { session });
    return x;
  };

  if (input.resolution === CONFLICT_RESOLUTION.keepExisting) {
    const x = await withTransaction((session) => finish(session, CONFLICT_RESOLUTION.keepExisting));
    return conflictView(x, await conflictNames(principal, [x]), principal);
  }

  // REPLACE: release the holder and book the unit for the challenger, all or nothing.
  const p = await prepareAttempt(principal, { unitId: c.unitId.toHexString(), enquiryId: c.attemptedEnquiryId.toHexString(), bookingDate: new Date(Math.min(c.attemptedBookingDate.getTime(), Date.now())), salespersonId: c.attemptedSalespersonId.toHexString(), notes: c.attemptedNotes ?? undefined });
  const ds = domainScope(principal, branch);
  const holder = await scopedRepo(Booking, ds).findOne({ unitId: c.unitId, status: BOOKING_STATUS.active }).lean<BookingLean>();
  if (!holder && p.unit.statusKey !== UNIT_STATUS_KEYS.AVAILABLE) throw new AppError('UNIT_NOT_AVAILABLE', 409, 'The unit is not available for booking');
  if (!holder && (await isUnitWithheldFromBuyers(p.unit._id))) throw new AppError('UNIT_NOT_AVAILABLE', 409, `${p.unit.unitCode} was acquired from a seller and is still being prepared. It cannot be booked until it is released.`);
  const bookedStatus = await getUnitStatusByKey(UNIT_STATUS_KEYS.BOOKED);
  const availableStatus = await getUnitStatusByKey(UNIT_STATUS_KEYS.AVAILABLE);
  const bookingNo = await nextBookingNo();
  try {
    const nb = await withTransaction(async (session) => {
      if (holder) await releaseInTx(ds, principal, holder, `Replaced after conflict: ${input.reason}`, availableStatus._id, session, p.actorName);
      const created = await insertBooking(principal, { ...p, bookedBy: c.attemptedBy.toHexString(), bookingDate: c.attemptedBookingDate, notes: c.attemptedNotes ?? undefined, bookingNo, bookedStatus }, session);
      await finish(session, CONFLICT_RESOLUTION.replace, created._id);
      return created;
    });
    const x = await scopedRepo(BookingConflict, principal).findById(id).lean<ConflictLean>();
    return { ...conflictView(x!, await conflictNames(principal, [x!]), principal), booking: (await viewsOf(principal, [nb]))[0] };
  } catch (err) {
    if (err instanceof RaceLost || isDuplicateKey(err)) throw AppError.conflict('BOOKING_CONFLICT', 'The unit changed while resolving. Refresh and try again.');
    throw err;
  }
}

// ---- release -----------------------------------------------------------------------------------

/**
 * Inside the caller's transaction: ACTIVE -> RELEASED (compare-and-set, so a second release matches nothing) and the
 * unit BOOKED -> AVAILABLE, with history, audit, timeline and notification. The booking record is kept for ever.
 */
async function releaseInTx(ctx: Principal, actor: Principal, b: BookingLean, reason: string, availableStatusId: Id, session: ClientSession, actorName?: string): Promise<BookingLean> {
  const now = new Date();
  const uid = toObjectId(actor.userId);
  const branch = b.branchId.toHexString();
  const released = await repo(ctx)
    .findOneAndUpdate({ _id: b._id, status: BOOKING_STATUS.active }, { $set: { status: BOOKING_STATUS.released, releasedAt: now, releasedBy: uid, releaseReason: reason, updatedBy: uid } }, { new: true, session })
    .lean<BookingLean>();
  if (!released) throw AppError.conflict('ALREADY_RELEASED', 'This booking has already been released');
  const unit = await scopedRepo(Unit, ctx)
    .findOneAndUpdate({ _id: b.unitId, statusKey: UNIT_STATUS_KEYS.BOOKED }, { $set: { statusId: availableStatusId, statusKey: UNIT_STATUS_KEYS.AVAILABLE, statusChangedAt: now, updatedBy: uid } }, { new: true, session })
    .lean<UnitLean>();
  if (!unit) throw new AppError('UNIT_STATE_MISMATCH', 409, 'The unit is not in the booked state, so the booking cannot be released. Contact an administrator.');
  await scopedRepo(BookingEvent, ctx).create({ bookingId: b._id, bookingNo: b.bookingNo, branchId: b.branchId, unitId: b.unitId, enquiryId: b.enquiryId, salespersonId: b.salespersonId, type: 'RELEASED', byUserId: uid, reason, at: now }, { session });
  await recordAudit({ entityType: 'booking', entityId: b._id, action: 'release', before: { status: BOOKING_STATUS.active }, after: { status: BOOKING_STATUS.released, releasedAt: now }, reason, userId: actor.userId, branchId: branch }, { session });
  await recordAudit({ entityType: 'unit', entityId: b.unitId, action: 'status', before: { statusKey: UNIT_STATUS_KEYS.BOOKED }, after: { statusKey: UNIT_STATUS_KEYS.AVAILABLE }, reason: `Released: ${b.bookingNo}`, userId: actor.userId, branchId: branch }, { session });
  await recordActivity({ type: 'BOOKING_RELEASED', description: `Booking ${b.bookingNo} of ${b.unitCode} for ${b.personName} released`, branchId: branch, userId: actor.userId, at: now, refs: refsOf(b), metadata: { reason } }, { session });
  await notify({
    event: 'BOOKING_RELEASED', branchId: branch, payload: { unit: b.unitCode, booking: b.bookingNo, person: b.personName, reason, ...(actorName ? { by: actorName } : {}) },
    subjects: { salesperson: b.salespersonId.toHexString() }, refs: refsOf(b), dedupeKey: `booking-released:${b._id}`, excludeUserId: actor.userId, session,
  });
  return released;
}

export async function releaseBooking(principal: Principal, id: string, input: z.infer<typeof releaseBody>) {
  const b = await repo(principal).findById(id).lean<BookingLean>();
  if (!b) throw AppError.notFound('Booking not found');
  if (b.status !== BOOKING_STATUS.active) throw AppError.conflict('ALREADY_RELEASED', 'This booking has already been released');
  const ds = domainScope(principal, b.branchId.toHexString());
  const available = await getUnitStatusByKey(UNIT_STATUS_KEYS.AVAILABLE);
  const actor = await scopedRepo(User, principal).findById(principal.userId).select('name').lean<{ name: string }>();
  const out = await withTransaction((session) => releaseInTx(ds, principal, b, input.reason, available._id, session, actor?.name));
  return (await viewsOf(principal, [out], true))[0]!;
}

// ---- update (descriptive fields of an active booking) ---------------------------------------------------

export async function updateBooking(principal: Principal, id: string, patch: z.infer<typeof updateBookingBody>) {
  const before = await repo(principal).findById(id).lean<BookingLean>();
  if (!before) throw AppError.notFound('Booking not found');
  if (before.status !== BOOKING_STATUS.active) throw AppError.conflict('BOOKING_CLOSED', 'A released booking is history and cannot be edited');
  if (patch.bookingDate) assertBookingDate(patch.bookingDate);
  const set: Record<string, unknown> = { updatedBy: toObjectId(principal.userId) };
  const unset: Record<string, 1> = {};
  if (patch.bookingDate) set.bookingDate = patch.bookingDate;
  if (patch.notes === null) unset.notes = 1;
  else if (patch.notes !== undefined) set.notes = patch.notes;
  const branch = before.branchId.toHexString();
  const after = await withTransaction(async (session) => {
    const u = await repo(principal).findOneAndUpdate({ _id: before._id, status: BOOKING_STATUS.active }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { new: true, session }).lean<BookingLean>();
    if (!u) throw AppError.conflict('BOOKING_CLOSED', 'The booking was released meanwhile');
    await scopedRepo(BookingEvent, principal).create({ bookingId: before._id, bookingNo: before.bookingNo, branchId: before.branchId, unitId: before.unitId, enquiryId: before.enquiryId, salespersonId: before.salespersonId, type: 'UPDATED', byUserId: toObjectId(principal.userId), at: new Date() }, { session });
    await recordAudit({ entityType: 'booking', entityId: before._id, action: 'update', before: { bookingDate: before.bookingDate, notes: before.notes }, after: { bookingDate: u.bookingDate, notes: u.notes }, userId: principal.userId, branchId: branch }, { session });
    await recordActivity({ type: 'BOOKING_UPDATED', description: `Booking ${before.bookingNo} updated`, branchId: branch, userId: principal.userId, refs: refsOf(before) }, { session });
    return u;
  });
  return (await viewsOf(principal, [after], true))[0]!;
}

