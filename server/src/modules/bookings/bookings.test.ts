import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { Notification } from '../../core/notify/notification.model';
import { PERMISSION_CATALOG } from '../../core/permissions/catalog';
import { systemRepo } from '../../core/scope/system';
import { useTestDb } from '../../test/db';
import { Activities, AuditLogs, makeUser, seedAll } from '../../test/factories';
import { api, bookingWorld, createBookingApi, getBookingApi, grant, justNow, mkBooking, mkEnquiry, mkUnit, negotiationEnquiry, releaseBookingApi, resolveConflictApi, revoke, type BW } from '../../test/bookings';
import { setStatus } from '../../test/units';
import { Enquiry, EnquiryStageHistory } from '../enquiries/enquiry.model';
import { Person } from '../persons/person.model';
import { Unit } from '../units/unit.model';
import { Booking, BookingConflict, BookingEvent } from './booking.model';

const app = buildApp();
const Bookings = systemRepo(Booking, 'test', 'fixtures');
const Events = systemRepo(BookingEvent, 'test', 'fixtures');
const Conflicts = systemRepo(BookingConflict, 'test', 'fixtures');
const Enquiries = systemRepo(Enquiry, 'test', 'fixtures');
const History = systemRepo(EnquiryStageHistory, 'test', 'fixtures');
const Units = systemRepo(Unit, 'test', 'fixtures');
const Notifications = systemRepo(Notification, 'test', 'fixtures');
const People = systemRepo(Person, 'test', 'fixtures');

useTestDb();
beforeEach(seedAll);

const uid = (a: { user: { _id: Types.ObjectId } }) => a.user._id.toHexString();
const stageOf = async (id: string) => (await Enquiries.findOne({ _id: id }).lean())!.stageCode;
const unitStatus = async (id: string) => (await Units.findOne({ _id: id }).lean())!.statusKey;
const nos = (res: request.Response) => (res.body.data as { bookingNo: string }[]).map((b) => b.bookingNo);
const list = (who: { auth: Record<string, string> }, q = '') => request(app).get(api(`/bookings${q}`)).set(who.auth);

/** A unit and an enquiry ready to book (enquiry owned by salesA, unit unassigned). */
async function ready(w: BW, enquiryExtra: Record<string, unknown> = {}, unitExtra: Record<string, unknown> = {}) {
  return { enquiry: await negotiationEnquiry(app, w, { assignedTo: uid(w.salesA), ...enquiryExtra }), unit: await mkUnit(app, w.mgrA, unitExtra) };
}

describe('booking a unit', () => {
  it('creates an ACTIVE booking, flips the unit to BOOKED and moves the enquiry to BOOKED, all together', async () => {
    const w = await bookingWorld(app);
    const { enquiry, unit } = await ready(w);
    const res = await createBookingApi(app, w.mgrA, { unitId: unit.id, enquiryId: enquiry.id, notes: 'Token paid' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      bookingNo: 'BK-000001', status: 'ACTIVE', isActive: true, unitId: unit.id, unitCode: unit.unitCode, enquiryId: enquiry.id, enquiryNo: enquiry.enquiryNo, branchId: w.A, branch: { code: 'A' },
      salespersonId: uid(w.salesA), bookedBy: uid(w.mgrA), notes: 'Token paid', name: enquiry.name,
    });
    expect(res.body.data.allowed).toMatchObject({ edit: true, release: true });
    expect(await unitStatus(unit.id)).toBe('BOOKED');
    expect((await request(app).get(api(`/units/${unit.id}`)).set(w.mgrA.auth)).body.data.status.label).toBe('Booked');
    expect(await stageOf(enquiry.id)).toBe('BOOKED');
    expect(await History.find({ enquiryId: enquiry.id, toStage: 'BOOKED' }).lean()).toMatchObject([{ fromStage: 'NEGOTIATION', direction: 'FORWARD' }]);
  });

  it('writes history, audit (booking and unit), the timeline on every related record and a manager notification', async () => {
    const w = await bookingWorld(app);
    const { enquiry, unit } = await ready(w);
    const b = await mkBooking(app, w.salesA, { unitId: unit.id, enquiryId: enquiry.id }).catch(() => undefined);
    expect(b).toBeUndefined(); // an OWN executive cannot see this unit: nothing happened
    const booked = await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: enquiry.id });
    expect(await Events.find({ bookingId: booked.id }).lean()).toMatchObject([{ type: 'CREATED', bookingNo: 'BK-000001' }]);
    expect(await AuditLogs.findOne({ entityType: 'booking', action: 'create' }).lean()).toBeTruthy();
    expect(await AuditLogs.findOne({ entityType: 'unit', action: 'status', reason: 'Booked: BK-000001' }).lean()).toMatchObject({ entityType: 'unit' });
    const act = await Activities.findOne({ type: 'BOOKING_CREATED' }).lean();
    expect(act!.refs.map((r) => r.type).sort()).toEqual(['booking', 'enquiry', 'person', 'unit']);
    const tl = (type: string, id: string) => request(app).get(api(`/activities?refType=${type}&refId=${id}`)).set(w.mgrA.auth);
    for (const [type, id] of [['unit', unit.id], ['enquiry', enquiry.id], ['booking', booked.id]] as const) expect((await tl(type, id)).body.data.map((a: { type: string }) => a.type)).toContain('BOOKING_CREATED');
    // the manager who booked is not told about their own action
    expect(await Notifications.countDocuments({ eventCode: 'BOOKING_CREATED' })).toBe(0);
  });

  it('tells the branch managers when someone else books', async () => {
    const w = await bookingWorld(app);
    const enquiry = await negotiationEnquiry(app, w, { assignedTo: uid(w.salesA) });
    const unit = await mkUnit(app, w.mgrA, { assignedTo: uid(w.salesA) });
    await mkBooking(app, w.salesA, { unitId: unit.id, enquiryId: enquiry.id });
    const n = await Notifications.find({ eventCode: 'BOOKING_CREATED' }).lean();
    expect(n.map((x) => String(x.userId))).toContain(uid(w.mgrA));
    expect(n.map((x) => String(x.userId))).not.toContain(uid(w.salesA));
    expect(n.map((x) => String(x.userId))).not.toContain(uid(w.mgrB)); // another branch's manager hears nothing
  });

  it('the booking date is required, must carry its time zone, and must be plausible; offsets are stored as the same instant', async () => {
    const w = await bookingWorld(app);
    const { enquiry, unit } = await ready(w);
    const post = (bookingDate?: string) => request(app).post(api('/bookings')).set(w.mgrA.auth).send({ unitId: unit.id, enquiryId: enquiry.id, ...(bookingDate === undefined ? {} : { bookingDate }) });
    for (const bad of [undefined, '', 'yesterday', '2026-10-08', '2026-10-08T10:00', '2026-13-45T10:00:00Z', new Date(Date.now() + 86_400_000).toISOString(), new Date(Date.now() - 400 * 86_400_000).toISOString()]) {
      expect((await post(bad)).status, String(bad)).toBe(400);
    }
    expect(await unitStatus(unit.id)).toBe('AVAILABLE');
    const instant = new Date(Date.now() - 3_600_000);
    const withOffset = instant.toISOString().replace('Z', '+00:00');
    const ok = await post(withOffset);
    expect(ok.status).toBe(201);
    expect(new Date(ok.body.data.bookingDate).getTime()).toBe(instant.getTime());
  });

  it('rejects unknown fields (status, number, branch, release data) in the body', async () => {
    const w = await bookingWorld(app);
    const { enquiry, unit } = await ready(w);
    for (const extra of [{ status: 'ACTIVE' }, { bookingNo: 'BK-9' }, { branchId: w.A }, { releasedAt: justNow() }, { bookedBy: uid(w.salesA) }, { unitCode: 'X' }]) {
      expect((await createBookingApi(app, w.mgrA, { unitId: unit.id, enquiryId: enquiry.id, ...extra })).status, JSON.stringify(extra)).toBe(400);
    }
    expect(await Bookings.countDocuments({})).toBe(0);
  });

  it('needs bookings.create, and a valid, active salesperson of the branch', async () => {
    const w = await bookingWorld(app);
    const { enquiry, unit } = await ready(w);
    expect((await request(app).post(api('/bookings')).send({})).status).toBe(401);
    await revoke('MANAGER', 'bookings.create');
    expect((await createBookingApi(app, w.mgrA, { unitId: unit.id, enquiryId: enquiry.id })).status).toBe(403);
    await grant('MANAGER', 'bookings.create');
    const inactive = await makeUser({ roleKey: 'SALES_EXECUTIVE', branches: [w.A], isActive: false });
    for (const salespersonId of [uid(w.salesB), inactive.user._id.toHexString(), new Types.ObjectId().toHexString(), 'nope']) {
      expect((await createBookingApi(app, w.mgrA, { unitId: unit.id, enquiryId: enquiry.id, salespersonId })).status, salespersonId).toBe(400);
    }
    expect(await unitStatus(unit.id)).toBe('AVAILABLE');
    const ok = await createBookingApi(app, w.mgrA, { unitId: unit.id, enquiryId: enquiry.id, salespersonId: uid(w.salesA2) });
    expect(ok.body.data.salespersonId).toBe(uid(w.salesA2));
  });

  it('defaults the salesperson to the enquiry owner, else the person booking', async () => {
    const w = await bookingWorld(app);
    const { enquiry, unit } = await ready(w);
    expect((await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: enquiry.id })).salespersonId).toBe(uid(w.salesA));
    const unowned = await negotiationEnquiry(app, w);
    const u2 = await mkUnit(app, w.mgrA);
    expect((await mkBooking(app, w.mgrA, { unitId: u2.id, enquiryId: unowned.id })).salespersonId).toBe(uid(w.mgrA));
  });
});

describe('prerequisites', () => {
  it('the unit must exist and be visible; archived units and units of another branch are refused', async () => {
    const w = await bookingWorld(app);
    const enquiry = await negotiationEnquiry(app, w);
    const foreign = await mkUnit(app, w.mgrB);
    const archived = await mkUnit(app, w.mgrA);
    await request(app).delete(api(`/units/${archived.id}`)).set(w.mgrA.auth);
    for (const unitId of [new Types.ObjectId().toHexString(), foreign.id, archived.id]) expect((await createBookingApi(app, w.mgrA, { unitId, enquiryId: enquiry.id })).status, unitId).toBe(404);
    expect((await createBookingApi(app, w.mgrA, { unitId: 'nope', enquiryId: enquiry.id })).status).toBe(400);
    expect(await Bookings.countDocuments({})).toBe(0);
  });

  it('the enquiry must exist and be visible; cross-branch pairs are refused even for an ALL-scope user', async () => {
    const w = await bookingWorld(app);
    const { enquiry, unit } = await ready(w);
    const other = await mkEnquiry(app, w.mgrB);
    const unitB = await mkUnit(app, w.mgrB);
    for (const enquiryId of [new Types.ObjectId().toHexString(), other.id]) expect((await createBookingApi(app, w.mgrA, { unitId: unit.id, enquiryId })).status, enquiryId).toBe(404);
    const cross = await createBookingApi(app, w.admin, { unitId: unitB.id, enquiryId: enquiry.id });
    expect(cross.status).toBe(400);
    expect(cross.body.error.details[0].path).toBe('unitId');
    expect(await Bookings.countDocuments({})).toBe(0);
    expect(await unitStatus(unitB.id)).toBe('AVAILABLE');
    expect(await stageOf(enquiry.id)).toBe('NEGOTIATION');
  });

  it('a lost enquiry cannot book', async () => {
    const w = await bookingWorld(app);
    const { enquiry, unit } = await ready(w);
    await request(app).post(api(`/enquiries/${enquiry.id}/lose`)).set(w.mgrA.auth).send({ lostReasonId: w.m.lost });
    const res = await createBookingApi(app, w.mgrA, { unitId: unit.id, enquiryId: enquiry.id });
    expect(res.body.error.code).toBe('ENQUIRY_LOST');
    expect(await unitStatus(unit.id)).toBe('AVAILABLE');
  });

  it('the unit must be AVAILABLE: other statuses are refused without creating a conflict', async () => {
    const w = await bookingWorld(app);
    const { enquiry, unit } = await ready(w);
    for (const statusId of [w.st.sold, w.st.hold]) {
      await setStatus(app, w.mgrA, unit.id, { statusId });
      const res = await createBookingApi(app, w.mgrA, { unitId: unit.id, enquiryId: enquiry.id });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('UNIT_NOT_AVAILABLE');
      await Units.updateOne({ _id: unit.id }, { $set: { statusId: w.st.available, statusKey: 'AVAILABLE' } });
    }
    expect(await Conflicts.countDocuments({})).toBe(0);
    expect(await Bookings.countDocuments({})).toBe(0);
  });

  it('the workflow decides whether the enquiry may be booked: booking is allowed from New, but a refusal still changes nothing', async () => {
    const w = await bookingWorld(app);
    const unit = await mkUnit(app, w.mgrA);
    const fresh = await mkEnquiry(app, w.mgrA); // NEW
    // Booking is a real activity like scheduling a visit, so it may skip stages rather than force
    // the seller through "Contacted" and "Interested" first.
    const direct = await createBookingApi(app, w.mgrA, { unitId: unit.id, enquiryId: fresh.id });
    expect(direct.status).toBe(201);
    expect(await stageOf(fresh.id)).toBe('BOOKED');
  });

  it('a refused booking leaves the unit and the stage untouched', async () => {
    const w = await bookingWorld(app);
    const unit = await mkUnit(app, w.mgrA);
    const fresh = await mkEnquiry(app, w.mgrA);
    // The unit is not linked to this enquiry, so the booking is refused — and nothing moves.
    const refused = await createBookingApi(app, w.mgrA, { unitId: unit.id, enquiryId: fresh.id, force: true });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(await unitStatus(unit.id)).toBe('AVAILABLE');
    expect(await Bookings.countDocuments({})).toBe(0);
    expect(await stageOf(fresh.id)).toBe('NEW');
  });

  it('an enquiry already booked can book another unit without moving, and a generic move into BOOKED is refused', async () => {
    const w = await bookingWorld(app);
    const { enquiry, unit } = await ready(w);
    const second = await mkUnit(app, w.mgrA);
    await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: enquiry.id });
    await mkBooking(app, w.mgrA, { unitId: second.id, enquiryId: enquiry.id });
    expect(await History.countDocuments({ enquiryId: enquiry.id, toStage: 'BOOKED' })).toBe(1);
    const other = await negotiationEnquiry(app, w);
    const into = await request(app).post(api(`/enquiries/${other.id}/transition`)).set(w.admin.auth).send({ to: 'BOOKED' });
    expect(into.status).toBe(409);
    expect(into.body.error).toMatchObject({ code: 'DOMAIN_ONLY', details: { domainOperation: 'booking.create' } });
    expect(await stageOf(other.id)).toBe('NEGOTIATION');
  });
});

describe('the unit status endpoint cannot bypass booking', () => {
  it('cannot enter BOOKED, cannot leave BOOKED, cannot archive a booked unit; PATCH cannot touch status', async () => {
    const w = await bookingWorld(app);
    const { enquiry, unit } = await ready(w);
    const enter = await setStatus(app, w.mgrA, unit.id, { statusId: w.st.booked });
    expect(enter.body.error.code).toBe('BOOKING_OWNED');
    expect(await unitStatus(unit.id)).toBe('AVAILABLE');
    await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: enquiry.id });
    expect((await setStatus(app, w.mgrA, unit.id, { statusId: w.st.available })).body.error.code).toBe('BOOKING_OWNED');
    expect((await setStatus(app, w.mgrA, unit.id, { statusId: w.st.sold })).body.error.code).toBe('BOOKING_OWNED');
    expect((await request(app).delete(api(`/units/${unit.id}`)).set(w.mgrA.auth)).body.error.code).toBe('UNIT_BOOKED');
    expect((await request(app).patch(api(`/units/${unit.id}`)).set(w.mgrA.auth).send({ statusKey: 'AVAILABLE' })).status).toBe(400);
    expect(await unitStatus(unit.id)).toBe('BOOKED');
  });
});

describe('ONE active booking per unit', () => {
  it('a second booking of a booked unit is a 409 conflict: nothing changes and a conflict is recorded for managers', async () => {
    const w = await bookingWorld(app);
    const first = await negotiationEnquiry(app, w, { assignedTo: uid(w.salesA) });
    const second = await negotiationEnquiry(app, w, { assignedTo: uid(w.salesA2) });
    const unit = await mkUnit(app, w.mgrA);
    const b1 = await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: first.id });
    const res = await createBookingApi(app, w.mgrA, { unitId: unit.id, enquiryId: second.id });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'BOOKING_CONFLICT', details: { unitCode: unit.unitCode, existingBookingNo: b1.bookingNo } });
    expect(await Bookings.countDocuments({})).toBe(1);
    expect(await Bookings.countDocuments({ status: 'ACTIVE' })).toBe(1);
    expect(await unitStatus(unit.id)).toBe('BOOKED');
    expect(await stageOf(second.id)).toBe('NEGOTIATION'); // the loser's enquiry did not move
    expect(await Events.countDocuments({ enquiryId: second.id })).toBe(0);
    const conflicts = await Conflicts.find({}).lean();
    expect(conflicts).toMatchObject([{ status: 'OPEN', unitCode: unit.unitCode, attemptedEnquiryNo: second.enquiryNo, existingBookingNo: b1.bookingNo }]);
    // audit and timeline say a conflict happened, never that the second booking succeeded
    expect(await AuditLogs.countDocuments({ entityType: 'booking', action: 'create' })).toBe(1);
    expect(await Activities.countDocuments({ type: 'BOOKING_CREATED' })).toBe(1);
    expect(await Activities.countDocuments({ type: 'BOOKING_CONFLICT' })).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'bookingConflict', action: 'conflict' })).toBe(1);
    expect(await Notifications.countDocuments({ eventCode: 'BOOKING_CONFLICT', userId: w.mgrA.user._id })).toBe(0); // the manager who tried is not told about their own attempt
  });

  it('the database itself prevents two ACTIVE bookings, however the write is made', async () => {
    const w = await bookingWorld(app);
    const { enquiry, unit } = await ready(w);
    await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: enquiry.id });
    await Booking.init();
    const indexes = await Booking.collection.indexes();
    const idx = indexes.find((i) => i.name === 'one_active_booking_per_unit');
    expect(idx).toMatchObject({ unique: true, key: { unitId: 1 }, partialFilterExpression: { status: 'ACTIVE' } });
    const doc = (status: string, no: string) => ({ bookingNo: no, branchId: new Types.ObjectId(w.A), unitId: new Types.ObjectId(unit.id), unitCode: unit.unitCode, enquiryId: new Types.ObjectId(enquiry.id), enquiryNo: enquiry.enquiryNo, personId: new Types.ObjectId(), personName: 'x', phoneE164: '+919000000000', salespersonId: w.mgrA.user._id, bookedBy: w.mgrA.user._id, bookingDate: new Date(), status });
    await expect(Bookings.create(doc('ACTIVE', 'BK-900001'))).rejects.toMatchObject({ code: 11000 }); // bypassing the service
    await expect(Booking.collection.insertOne(doc('ACTIVE', 'BK-900002'))).rejects.toMatchObject({ code: 11000 }); // bypassing Mongoose too
    await Bookings.create(doc('RELEASED', 'BK-900003')); // released history never blocks
    await Bookings.create(doc('RELEASED', 'BK-900004'));
    expect(await Bookings.countDocuments({ unitId: unit.id })).toBe(3);
    expect(await Bookings.countDocuments({ unitId: unit.id, status: 'ACTIVE' })).toBe(1);
  });

  it('concurrent bookings of one unit: exactly one wins, every other attempt gets a conflict and leaves no trace', async () => {
    const w = await bookingWorld(app);
    const N = 5;
    const enquiries = [];
    for (let i = 0; i < N; i++) enquiries.push(await negotiationEnquiry(app, w, { assignedTo: uid(i % 2 ? w.salesA : w.salesA2) }));
    const unit = await mkUnit(app, w.mgrA);
    const rs = await Promise.all(enquiries.map((e, i) => createBookingApi(app, i % 2 ? w.mgrA : w.admin, { unitId: unit.id, enquiryId: e.id })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409).map((r) => r.body.error.code)).toEqual(Array(N - 1).fill('BOOKING_CONFLICT'));
    expect(await Bookings.countDocuments({ unitId: unit.id })).toBe(1);
    expect(await Bookings.countDocuments({ unitId: unit.id, status: 'ACTIVE' })).toBe(1);
    expect(await unitStatus(unit.id)).toBe('BOOKED');
    expect(await Conflicts.countDocuments({ unitId: unit.id })).toBe(N - 1);
    expect(await Events.countDocuments({ type: 'CREATED' })).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'booking', action: 'create' })).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'unit', action: 'status', reason: /^Booked:/ })).toBe(1);
    expect(await Activities.countDocuments({ type: 'BOOKING_CREATED' })).toBe(1);
    expect(await Activities.countDocuments({ type: 'BOOKING_CONFLICT' })).toBe(N - 1);
    const winner = rs.find((r) => r.status === 201)!.body.data;
    const stages = await Promise.all(enquiries.map((e) => stageOf(e.id)));
    expect(stages.filter((s) => s === 'BOOKED')).toHaveLength(1);
    expect(stages.filter((s) => s === 'NEGOTIATION')).toHaveLength(N - 1);
    expect(stages[enquiries.findIndex((e) => e.id === winner.enquiryId)]).toBe('BOOKED');
  }, 120_000);

  it('a failure after the unit was flipped rolls EVERYTHING back (unit, booking, enquiry, audit, timeline)', async () => {
    const w = await bookingWorld(app);
    const { enquiry, unit } = await ready(w);
    // Poison the next booking number so the booking insert fails after the unit compare-and-set succeeded.
    await Bookings.create({ bookingNo: 'BK-000001', branchId: new Types.ObjectId(w.A), unitId: new Types.ObjectId(), unitCode: 'X', enquiryId: new Types.ObjectId(), enquiryNo: 'X', personId: new Types.ObjectId(), personName: 'x', phoneE164: '+919000000000', salespersonId: w.mgrA.user._id, bookedBy: w.mgrA.user._id, bookingDate: new Date(), status: 'RELEASED' });
    const res = await createBookingApi(app, w.mgrA, { unitId: unit.id, enquiryId: enquiry.id });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'CONFLICT', details: { fields: ['bookingNo'] } }); // a number clash, not a booking conflict
    expect(await unitStatus(unit.id)).toBe('AVAILABLE');
    expect(await stageOf(enquiry.id)).toBe('NEGOTIATION');
    expect(await Bookings.countDocuments({ status: 'ACTIVE' })).toBe(0);
    expect(await Events.countDocuments({})).toBe(0);
    expect(await AuditLogs.countDocuments({ entityType: 'booking' })).toBe(0);
    expect(await Activities.countDocuments({ type: 'BOOKING_CREATED' })).toBe(0);
    expect(await Conflicts.countDocuments({})).toBe(0); // a real error is not a conflict
    expect((await createBookingApi(app, w.mgrA, { unitId: unit.id, enquiryId: enquiry.id })).status).toBe(201); // the next number is free again
  });
});

describe('releasing a booking', () => {
  async function booked(w: BW) {
    const { enquiry, unit } = await ready(w);
    const b = await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: enquiry.id });
    return { enquiry, unit, b };
  }

  it('needs bookings.release and a reason', async () => {
    const w = await bookingWorld(app);
    const { b, unit } = await booked(w);
    expect((await releaseBookingApi(app, w.salesA, b.id)).status).toBe(403);
    for (const body of [{}, { reason: '' }, { reason: 'ab' }, { reason: 'x'.repeat(501) }, { reason: 'ok reason', status: 'RELEASED' }]) expect((await releaseBookingApi(app, w.mgrA, b.id, body)).status, JSON.stringify(body)).toBe(400);
    await revoke('MANAGER', 'bookings.release');
    expect((await releaseBookingApi(app, w.mgrA, b.id)).status).toBe(403);
    expect(await unitStatus(unit.id)).toBe('BOOKED');
    expect((await Bookings.findOne({ _id: b.id }).lean())!.status).toBe('ACTIVE');
  });

  it('releases atomically: booking RELEASED with who/when/why, unit AVAILABLE, history kept, audit, timeline, notification', async () => {
    const w = await bookingWorld(app);
    const { b, unit, enquiry } = await booked(w);
    const res = await releaseBookingApi(app, w.mgrA, b.id, { reason: 'Customer withdrew' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'RELEASED', isActive: false, releaseReason: 'Customer withdrew', releasedBy: uid(w.mgrA), releasedByName: w.mgrA.user.name });
    expect(res.body.data.releasedAt).toBeTruthy();
    expect(res.body.data.allowed).toMatchObject({ edit: false, release: false });
    expect(await unitStatus(unit.id)).toBe('AVAILABLE');
    expect(await Bookings.countDocuments({ _id: b.id })).toBe(1); // never deleted
    const detail = (await getBookingApi(app, w.mgrA, b.id)).body.data;
    expect(detail.history.map((h: { type: string }) => h.type)).toEqual(['CREATED', 'RELEASED']);
    expect(detail.history[1]).toMatchObject({ reason: 'Customer withdrew', by: uid(w.mgrA) });
    expect(await AuditLogs.findOne({ entityType: 'booking', action: 'release' }).lean()).toMatchObject({ reason: 'Customer withdrew' });
    expect(await AuditLogs.findOne({ entityType: 'unit', action: 'status', reason: `Released: ${b.bookingNo}` }).lean()).toBeTruthy();
    const act = await Activities.findOne({ type: 'BOOKING_RELEASED' }).lean();
    expect(act!.refs.map((r) => r.type).sort()).toEqual(['booking', 'enquiry', 'person', 'unit']);
    expect(await stageOf(enquiry.id)).toBe('BOOKED'); // the stage is not guessed; a manager can revert it
    const n = await Notifications.find({ eventCode: 'BOOKING_RELEASED' }).lean();
    expect(n.map((x) => String(x.userId))).toContain(uid(w.salesA)); // the booking's salesperson
    expect(n.map((x) => String(x.userId))).not.toContain(uid(w.mgrA)); // not the releasing manager
  });

  it('a released booking is history: it never blocks, and the unit can be booked again', async () => {
    const w = await bookingWorld(app);
    const { b, unit } = await booked(w);
    await releaseBookingApi(app, w.mgrA, b.id);
    const again = await negotiationEnquiry(app, w);
    const b2 = await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: again.id });
    expect(b2.bookingNo).toBe('BK-000002');
    expect(await Bookings.countDocuments({ unitId: unit.id })).toBe(2);
    expect(nos(await list(w.mgrA, `?unitId=${unit.id}&sort=bookingNo`))).toEqual(['BK-000001', 'BK-000002']);
    expect(nos(await list(w.mgrA, '?status=RELEASED'))).toEqual(['BK-000001']);
    expect(nos(await list(w.mgrA, '?status=ACTIVE'))).toEqual(['BK-000002']);
  });

  it('releasing twice is refused', async () => {
    const w = await bookingWorld(app);
    const { b } = await booked(w);
    expect((await releaseBookingApi(app, w.mgrA, b.id)).status).toBe(200);
    const again = await releaseBookingApi(app, w.mgrA, b.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_RELEASED');
  });

  it('concurrent releases: exactly one succeeds and nothing is recorded twice', async () => {
    const w = await bookingWorld(app);
    const { b, unit } = await booked(w);
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => releaseBookingApi(app, i % 2 ? w.mgrA : w.admin, b.id, { reason: `attempt ${i}` })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409).map((r) => r.body.error.code)).toEqual(Array(5).fill('ALREADY_RELEASED'));
    expect(await unitStatus(unit.id)).toBe('AVAILABLE');
    expect(await AuditLogs.countDocuments({ entityType: 'booking', action: 'release' })).toBe(1);
    expect(await Events.countDocuments({ type: 'RELEASED' })).toBe(1);
    expect(await Activities.countDocuments({ type: 'BOOKING_RELEASED' })).toBe(1);
  });

  it('release and a new booking racing: the unit is never double booked', async () => {
    const w = await bookingWorld(app);
    const { b, unit } = await booked(w);
    const next = await negotiationEnquiry(app, w);
    const [rel, bk] = await Promise.all([releaseBookingApi(app, w.mgrA, b.id), createBookingApi(app, w.mgrA, { unitId: unit.id, enquiryId: next.id })]);
    expect(rel.status).toBe(200);
    expect([201, 409]).toContain(bk.status);
    expect(await Bookings.countDocuments({ unitId: unit.id, status: 'ACTIVE' })).toBe(bk.status === 201 ? 1 : 0);
    expect(await unitStatus(unit.id)).toBe(bk.status === 201 ? 'BOOKED' : 'AVAILABLE');
  });

  it('if the unit is not in the booked state the release is refused and rolled back', async () => {
    const w = await bookingWorld(app);
    const { b, unit } = await booked(w);
    await Units.updateOne({ _id: unit.id }, { $set: { statusKey: 'AVAILABLE' } });
    const res = await releaseBookingApi(app, w.mgrA, b.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('UNIT_STATE_MISMATCH');
    expect((await Bookings.findOne({ _id: b.id }).lean())!.status).toBe('ACTIVE');
    expect(await AuditLogs.countDocuments({ entityType: 'booking', action: 'release' })).toBe(0);
  });
});

describe('editing a booking', () => {
  it('changes notes and date of an ACTIVE booking only, with audit; released bookings are history', async () => {
    const w = await bookingWorld(app);
    const { enquiry, unit } = await ready(w);
    const b = await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: enquiry.id, notes: 'first' });
    const date = new Date(Date.now() - 7_200_000).toISOString();
    const res = await request(app).patch(api(`/bookings/${b.id}`)).set(w.mgrA.auth).send({ notes: null, bookingDate: date });
    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBeUndefined();
    expect(new Date(res.body.data.bookingDate).toISOString()).toBe(date);
    expect(await AuditLogs.findOne({ entityType: 'booking', action: 'update' }).lean()).toBeTruthy();
    expect(await Activities.countDocuments({ type: 'BOOKING_UPDATED' })).toBe(1);
    for (const bad of [{}, { status: 'RELEASED' }, { unitId: unit.id }, { salespersonId: uid(w.salesA2) }, { bookingDate: '2026-01-01' }, { bookingDate: new Date(Date.now() + 86_400_000).toISOString() }]) {
      expect((await request(app).patch(api(`/bookings/${b.id}`)).set(w.mgrA.auth).send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await request(app).patch(api(`/bookings/${b.id}`)).set(w.salesA.auth).send({ notes: 'x' })).status).toBe(403);
    await releaseBookingApi(app, w.mgrA, b.id);
    expect((await request(app).patch(api(`/bookings/${b.id}`)).set(w.mgrA.auth).send({ notes: 'late' })).body.error.code).toBe('BOOKING_CLOSED');
  });
});

describe('scope', () => {
  it('BRANCH sees its branch; ALL sees everything and can narrow; a foreign branch filter is refused', async () => {
    const w = await bookingWorld(app);
    const a = await ready(w);
    const ba = await mkBooking(app, w.mgrA, { unitId: a.unit.id, enquiryId: a.enquiry.id });
    const eb = await mkEnquiry(app, w.mgrB);
    for (const to of ['CONTACTED', 'INTERESTED']) await request(app).post(api(`/enquiries/${eb.id}/transition`)).set(w.admin.auth).send({ to });
    // branch B has no site visit flow here: place the enquiry at NEGOTIATION through the visit path as an admin
    const ub = await mkUnit(app, w.mgrB);
    const visit = await request(app).post(api('/sitevisits')).set(w.admin.auth).send({ enquiryId: eb.id, scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), assignedTo: uid(w.mgrB) });
    await request(app).post(api(`/sitevisits/${visit.body.data.id}/complete`)).set(w.admin.auth).send({ feedback: 'ok' });
    await request(app).post(api(`/enquiries/${eb.id}/transition`)).set(w.admin.auth).send({ to: 'NEGOTIATION' });
    const bb = await mkBooking(app, w.mgrB, { unitId: ub.id, enquiryId: eb.id });
    expect(nos(await list(w.mgrA))).toEqual([ba.bookingNo]);
    expect(nos(await list(w.mgrB))).toEqual([bb.bookingNo]);
    expect(nos(await list(w.admin)).sort()).toEqual([ba.bookingNo, bb.bookingNo].sort());
    expect(nos(await list(w.admin, `?branchId=${w.B}`))).toEqual([bb.bookingNo]);
    const widen = await list(w.mgrA, `?branchId=${w.B}`);
    expect(widen.status).toBe(403);
    expect(widen.body.data).toBeUndefined();
    // cross-branch access to one booking is a 404 on every operation, identical to a missing id
    const ghost = new Types.ObjectId().toHexString();
    const probes = (id: string) => [getBookingApi(app, w.mgrA, id), request(app).patch(api(`/bookings/${id}`)).set(w.mgrA.auth).send({ notes: 'x' }), releaseBookingApi(app, w.mgrA, id)];
    const real = await Promise.all(probes(bb.id));
    const fake = await Promise.all(probes(ghost));
    expect(real.map((r) => r.status)).toEqual([404, 404, 404]);
    expect(real.map((r) => r.body.error.code)).toEqual(fake.map((r) => r.body.error.code));
    expect((await Bookings.findOne({ _id: bb.id }).lean())!.status).toBe('ACTIVE');
    // and the timeline of a foreign booking is hidden
    expect((await request(app).get(api(`/activities?refType=booking&refId=${bb.id}`)).set(w.mgrA.auth)).status).toBe(404);
    expect((await request(app).get(api(`/activities?refType=booking&refId=${ba.id}`)).set(w.mgrA.auth)).status).toBe(200);
  }, 60_000);

  it('OWN: an executive books only with a unit and an enquiry they own, and sees only their own bookings', async () => {
    const w = await bookingWorld(app);
    const mine = await negotiationEnquiry(app, w, { assignedTo: uid(w.salesA) });
    const theirs = await negotiationEnquiry(app, w, { assignedTo: uid(w.salesA2) });
    const myUnit = await mkUnit(app, w.mgrA, { assignedTo: uid(w.salesA) });
    const otherUnit = await mkUnit(app, w.mgrA);
    expect((await createBookingApi(app, w.salesA, { unitId: otherUnit.id, enquiryId: mine.id })).status).toBe(404); // not their unit
    expect((await createBookingApi(app, w.salesA, { unitId: myUnit.id, enquiryId: theirs.id })).status).toBe(404); // not their enquiry
    expect((await createBookingApi(app, w.salesA, { unitId: myUnit.id, enquiryId: mine.id, salespersonId: uid(w.salesA2) })).status).toBe(403); // cannot book on someone else's behalf
    expect(await Bookings.countDocuments({})).toBe(0);
    const b = await mkBooking(app, w.salesA, { unitId: myUnit.id, enquiryId: mine.id });
    expect(b.salespersonId).toBe(uid(w.salesA));
    const t = await mkUnit(app, w.mgrA, { assignedTo: uid(w.salesA2) });
    const other = await mkBooking(app, w.mgrA, { unitId: t.id, enquiryId: theirs.id });
    expect(nos(await list(w.salesA))).toEqual([b.bookingNo]);
    expect(nos(await list(w.salesA, `?salespersonId=${uid(w.salesA2)}`))).toEqual([]);
    expect(nos(await list(w.salesA, `?search=${other.bookingNo}`))).toEqual([]);
    expect((await getBookingApi(app, w.salesA, other.id)).status).toBe(404);
    expect((await getBookingApi(app, w.salesA, b.id)).status).toBe(200);
    expect((await list(w.salesA, `?branchId=${w.B}`)).status).toBe(403);
    expect(nos(await list(w.mgrA)).sort()).toEqual([b.bookingNo, other.bookingNo].sort());
  }, 60_000);

  it('an OWN executive cannot release (no permission) even their own booking', async () => {
    const w = await bookingWorld(app);
    const mine = await negotiationEnquiry(app, w, { assignedTo: uid(w.salesA) });
    const unit = await mkUnit(app, w.mgrA, { assignedTo: uid(w.salesA) });
    const b = await mkBooking(app, w.salesA, { unitId: unit.id, enquiryId: mine.id });
    expect((await releaseBookingApi(app, w.salesA, b.id)).status).toBe(403);
    expect(await unitStatus(unit.id)).toBe('BOOKED');
  });
});

describe('listing, search and filters (server-side)', () => {
  it('searches and filters by booking number, unit, enquiry, salesperson, status and date; sorts and paginates', async () => {
    const w = await bookingWorld(app);
    const out = [];
    for (let i = 0; i < 3; i++) {
      const { enquiry, unit } = await ready(w, { assignedTo: uid(i === 1 ? w.salesA2 : w.salesA) });
      out.push({ enquiry, unit, b: await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: enquiry.id, bookingDate: new Date(Date.now() - (3 - i) * 86_400_000).toISOString() }) });
    }
    await releaseBookingApi(app, w.mgrA, out[0]!.b.id);
    expect(nos(await list(w.mgrA, `?search=${out[1]!.b.bookingNo}`))).toEqual([out[1]!.b.bookingNo]);
    expect(nos(await list(w.mgrA, '?search=BK-000003'))).toEqual([out[2]!.b.bookingNo]);
    expect(nos(await list(w.mgrA, `?search=${out[2]!.unit.unitCode}`))).toEqual([out[2]!.b.bookingNo]);
    expect(nos(await list(w.mgrA, `?search=${out[0]!.enquiry.enquiryNo}`))).toEqual([out[0]!.b.bookingNo]);
    expect(nos(await list(w.mgrA, `?unitId=${out[1]!.unit.id}`))).toEqual([out[1]!.b.bookingNo]);
    expect(nos(await list(w.mgrA, `?enquiryId=${out[2]!.enquiry.id}`))).toEqual([out[2]!.b.bookingNo]);
    expect(nos(await list(w.mgrA, `?salespersonId=${uid(w.salesA2)}`))).toEqual([out[1]!.b.bookingNo]);
    expect(nos(await list(w.mgrA, '?status=RELEASED'))).toEqual([out[0]!.b.bookingNo]);
    expect((await list(w.mgrA, '?status=ACTIVE,RELEASED')).body.meta.total).toBe(3);
    const from = encodeURIComponent(new Date(Date.now() - 2.5 * 86_400_000).toISOString());
    expect(nos(await list(w.mgrA, `?from=${from}&sort=bookingDate`))).toEqual([out[1]!.b.bookingNo, out[2]!.b.bookingNo]);
    expect(nos(await list(w.mgrA, '?sort=-bookingNo'))).toEqual(out.map((o) => o.b.bookingNo).reverse());
    const p = await list(w.mgrA, '?sort=bookingNo&limit=2&page=2');
    expect(nos(p)).toEqual([out[2]!.b.bookingNo]);
    expect(p.body.meta).toMatchObject({ page: 2, limit: 2, total: 3 });
    for (const bad of ['?limit=1000', '?status=PENDING', '?unitId=nope', '?from=garbage']) expect((await list(w.mgrA, bad)).status, bad).toBe(400);
    expect(nos(await list(w.mgrA, '?search=%5E.*'))).toEqual([]);
  }, 90_000);

  it('a person rename updates the booking projection', async () => {
    const w = await bookingWorld(app);
    const { enquiry, unit } = await ready(w);
    const b = await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: enquiry.id });
    const personId = (await Enquiries.findOne({ _id: enquiry.id }).lean())!.personId;
    await request(app).patch(api(`/persons/${personId}`)).set(w.mgrA.auth).send({ name: 'Renamed Buyer' });
    expect((await People.findOne({ _id: personId }).lean())!.name).toBe('Renamed Buyer');
    expect(nos(await list(w.mgrA, '?search=Renamed'))).toEqual([b.bookingNo]);
  });
});

describe('unit detail integration', () => {
  it('shows the current booking, history and the actions allowed now, only to users who may view bookings', async () => {
    const w = await bookingWorld(app);
    const { enquiry, unit } = await ready(w);
    const panel = async (who: { auth: Record<string, string> }) => (await request(app).get(api(`/units/${unit.id}`)).set(who.auth)).body.data.booking;
    const empty = await panel(w.mgrA);
    expect(empty).toMatchObject({ visible: true, history: [], allowed: { book: true, release: false } });
    expect(empty.active).toBeUndefined();
    const b = await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: enquiry.id });
    const during = await panel(w.mgrA);
    expect(during).toMatchObject({ visible: true, active: { bookingNo: b.bookingNo, status: 'ACTIVE' }, allowed: { book: false, release: true } });
    await releaseBookingApi(app, w.mgrA, b.id);
    const after = await panel(w.mgrA);
    expect(after.active).toBeUndefined();
    expect(after.history.map((h: { bookingNo: string }) => h.bookingNo)).toEqual([b.bookingNo]);
    expect(after.allowed.book).toBe(true);
    await revoke('MANAGER', 'bookings.view');
    const hidden = await panel(w.mgrA);
    expect(hidden).toMatchObject({ visible: false, history: [] });
    expect(hidden.active).toBeUndefined();
  });

  it('an executive sees an active booking of their unit only if it is theirs; others see nothing of it', async () => {
    const w = await bookingWorld(app);
    const e = await negotiationEnquiry(app, w, { assignedTo: uid(w.salesA2) });
    const unit = await mkUnit(app, w.mgrA, { assignedTo: uid(w.salesA) });
    await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: e.id }); // booked for salesA2, unit is salesA's
    const seen = (await request(app).get(api(`/units/${unit.id}`)).set(w.salesA.auth)).body.data.booking;
    expect(seen.active).toBeUndefined();
    expect(seen.history).toEqual([]);
    expect(seen.allowed).toMatchObject({ book: false, release: false });
  });
});

describe('booking conflicts (manager queue)', () => {
  async function conflicted(w: BW) {
    const e1 = await negotiationEnquiry(app, w, { assignedTo: uid(w.salesA) });
    const e2 = await negotiationEnquiry(app, w, { assignedTo: uid(w.salesA2) });
    const unit = await mkUnit(app, w.mgrA);
    const first = await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: e1.id });
    const lost = await createBookingApi(app, w.mgrA, { unitId: unit.id, enquiryId: e2.id, notes: 'Wants this one' });
    const conflict = (await Conflicts.findOne({}).lean())!;
    return { e1, e2, unit, first, conflictId: String(conflict._id), lost };
  }
  const listConflicts = (who: { auth: Record<string, string> }, q = '') => request(app).get(api(`/booking-conflicts${q}`)).set(who.auth);

  it('managers see open conflicts with who tried, for which enquiry and what held the unit', async () => {
    const w = await bookingWorld(app);
    const c = await conflicted(w);
    const res = await listConflicts(w.mgrA);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject([{ id: c.conflictId, status: 'OPEN', unitCode: c.unit.unitCode, existingBookingNo: c.first.bookingNo, attemptedEnquiryNo: c.e2.enquiryNo, attemptedByName: w.mgrA.user.name, attemptedNotes: 'Wants this one', allowed: { resolve: true } }]);
    expect((await listConflicts(w.mgrA, '?status=RESOLVED')).body.data).toEqual([]);
    expect((await listConflicts(w.mgrA, `?unitId=${c.unit.id}`)).body.meta.total).toBe(1);
  });

  it('is branch-scoped: another branch sees nothing, a foreign filter is refused; an executive sees only their own attempts and cannot resolve', async () => {
    const w = await bookingWorld(app);
    const c = await conflicted(w);
    expect((await listConflicts(w.mgrB)).body.data).toEqual([]);
    expect((await listConflicts(w.mgrA, `?branchId=${w.B}`)).status).toBe(403);
    expect((await listConflicts(w.salesA)).body.data).toEqual([]); // the attempt was the manager's
    expect((await resolveConflictApi(app, w.salesA, c.conflictId, { resolution: 'KEEP_EXISTING' })).status).toBe(403);
    expect((await resolveConflictApi(app, w.mgrB, c.conflictId, { resolution: 'KEEP_EXISTING' })).status).toBe(404);
    expect((await listConflicts(w.admin)).body.data).toHaveLength(1);
  });

  it('KEEP_EXISTING closes it and changes nothing else; it cannot be resolved twice', async () => {
    const w = await bookingWorld(app);
    const c = await conflicted(w);
    const res = await resolveConflictApi(app, w.mgrA, c.conflictId, { resolution: 'KEEP_EXISTING', reason: 'First come first served' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'RESOLVED', resolution: 'KEEP_EXISTING', resolvedBy: uid(w.mgrA), resolutionNote: 'First come first served' });
    expect(await unitStatus(c.unit.id)).toBe('BOOKED');
    expect((await Bookings.findOne({ _id: c.first.id }).lean())!.status).toBe('ACTIVE');
    expect((await resolveConflictApi(app, w.mgrA, c.conflictId, { resolution: 'KEEP_EXISTING' })).body.error.code).toBe('CONFLICT_RESOLVED');
    expect(await AuditLogs.countDocuments({ entityType: 'bookingConflict', action: 'resolve' })).toBe(1);
    expect(await Activities.countDocuments({ type: 'BOOKING_CONFLICT_RESOLVED' })).toBe(1);
  });

  it('REPLACE needs a reason, releases the holder and books the unit for the challenger, all or nothing', async () => {
    const w = await bookingWorld(app);
    const c = await conflicted(w);
    expect((await resolveConflictApi(app, w.mgrA, c.conflictId, { resolution: 'REPLACE' })).status).toBe(400);
    expect((await resolveConflictApi(app, w.mgrA, c.conflictId, { resolution: 'WHATEVER' })).status).toBe(400);
    const res = await resolveConflictApi(app, w.mgrA, c.conflictId, { resolution: 'REPLACE', reason: 'Second customer paid first' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'RESOLVED', resolution: 'REPLACE', booking: { status: 'ACTIVE', enquiryId: c.e2.id, unitId: c.unit.id, salespersonId: uid(w.salesA2), notes: 'Wants this one' } });
    expect((await Bookings.findOne({ _id: c.first.id }).lean())).toMatchObject({ status: 'RELEASED', releaseReason: 'Replaced after conflict: Second customer paid first' });
    expect(await Bookings.countDocuments({ unitId: c.unit.id, status: 'ACTIVE' })).toBe(1);
    expect(await unitStatus(c.unit.id)).toBe('BOOKED');
    expect(await stageOf(c.e2.id)).toBe('BOOKED');
    expect(await Bookings.countDocuments({ unitId: c.unit.id })).toBe(2); // history kept
  });

  it('REPLACE rolls back completely if the challenger can no longer book (lost enquiry)', async () => {
    const w = await bookingWorld(app);
    const c = await conflicted(w);
    await request(app).post(api(`/enquiries/${c.e2.id}/lose`)).set(w.mgrA.auth).send({ lostReasonId: w.m.lost });
    const res = await resolveConflictApi(app, w.mgrA, c.conflictId, { resolution: 'REPLACE', reason: 'try' });
    expect(res.status).toBe(409);
    expect((await Bookings.findOne({ _id: c.first.id }).lean())!.status).toBe('ACTIVE');
    expect(await unitStatus(c.unit.id)).toBe('BOOKED');
    expect((await Conflicts.findOne({}).lean())!.status).toBe('OPEN');
  });

  it('two managers resolving at once: exactly one wins', async () => {
    const w = await bookingWorld(app);
    const c = await conflicted(w);
    const rs = await Promise.all([
      resolveConflictApi(app, w.mgrA, c.conflictId, { resolution: 'REPLACE', reason: 'replace' }),
      resolveConflictApi(app, w.admin, c.conflictId, { resolution: 'KEEP_EXISTING' }),
      resolveConflictApi(app, w.mgrA, c.conflictId, { resolution: 'REPLACE', reason: 'replace again' }),
    ]);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await Bookings.countDocuments({ unitId: c.unit.id, status: 'ACTIVE' })).toBe(1);
    expect(await Conflicts.countDocuments({ status: 'RESOLVED' })).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'bookingConflict', action: 'resolve' })).toBe(1);
  }, 60_000);

  it('needs bookings.resolve_conflict', async () => {
    const w = await bookingWorld(app);
    const c = await conflicted(w);
    await revoke('MANAGER', 'bookings.resolve_conflict');
    expect((await resolveConflictApi(app, w.mgrA, c.conflictId, { resolution: 'KEEP_EXISTING' })).status).toBe(403);
  });
});

describe('permissions and routes', () => {
  it('every route is guarded; the catalog names the booking permissions', async () => {
    const w = await bookingWorld(app);
    const none = { Authorization: 'Bearer nope' };
    const id = new Types.ObjectId().toHexString();
    for (const [m, p] of [['get', '/bookings'], ['post', '/bookings'], ['get', `/bookings/${id}`], ['patch', `/bookings/${id}`], ['post', `/bookings/${id}/release`], ['get', '/booking-conflicts'], ['post', `/booking-conflicts/${id}/resolve`]] as const) {
      expect((await request(app)[m](api(p)).set(none)).status, `${m} ${p}`).toBe(401);
    }
    for (const [m, p] of [['delete', `/bookings/${id}`], ['put', `/bookings/${id}`], ['post', `/bookings/${id}/status`], ['post', `/bookings/${id}/cancel`]] as const) {
      expect([404, 405], `${m} ${p}`).toContain((await request(app)[m](api(p)).set(w.admin.auth).send({})).status); // a booking is never deleted or set directly
    }
    expect(PERMISSION_CATALOG.bookings).toEqual(['view', 'create', 'edit', 'release', 'resolve_conflict', 'export']);
  });
});
