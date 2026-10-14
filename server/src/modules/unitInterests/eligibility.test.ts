import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { systemRepo } from '../../core/scope/system';
import { useTestDb } from '../../test/db';
import { seedAll } from '../../test/factories';
import { api, bookingWorld, grant, mkBooking, mkUnit, negotiationEnquiry, releaseBookingApi, revoke } from '../../test/bookings';
import { mkEnquiry } from '../../test/enquiries';
import { setStatus } from '../../test/units';
import { Activity } from '../../core/activity/activity.model';
import { Booking } from '../bookings/booking.model';
import { Enquiry } from '../enquiries/enquiry.model';
import { Unit } from '../units/unit.model';
import { UnitInterest } from './unitInterest.model';

const app = buildApp();
useTestDb();
beforeEach(seedAll);

const Units = systemRepo(Unit, 'test', 'eligibility test');
const Interests = systemRepo(UnitInterest, 'test', 'eligibility test');
const Bookings = systemRepo(Booking, 'test', 'eligibility test');
const Enquiries = systemRepo(Enquiry, 'test', 'eligibility test');
const Activities = systemRepo(Activity, 'test', 'eligibility test');

type Who = { auth: Record<string, string> };
const get = (who: Who, path: string) => request(app).get(api(path)).set(who.auth);
const post = (who: Who, path: string, body: Record<string, unknown> = {}) => request(app).post(api(path)).set(who.auth).send(body);
const addInterest = (who: Who, enquiryId: string, unitId: string, extra: Record<string, unknown> = {}) => post(who, `/enquiries/${enquiryId}/unit-interests`, { unitId, ...extra });
const listEligible = (who: Who, enquiryId: string, q: Record<string, unknown> = {}) => get(who, `/enquiries/${enquiryId}/eligible-units?${new URLSearchParams(q as Record<string, string>).toString()}`);

describe('Add Unit picker only lists units the server would accept', () => {
  it('excludes SOLD units and units with an active booking, but returns the rest of the same branch', async () => {
    const w = await bookingWorld(app);
    const e = await negotiationEnquiry(app, w);
    const uAvail = await mkUnit(app, w.mgrA);
    const uHold = await mkUnit(app, w.mgrA);
    const uBooked = await mkUnit(app, w.mgrA);
    const uSold = await mkUnit(app, w.mgrA);
    await setStatus(app, w.mgrA, uHold.id, { statusId: w.st.hold });
    await setStatus(app, w.mgrA, uSold.id, { statusId: w.st.sold });
    await mkBooking(app, w.mgrA, { unitId: uBooked.id, enquiryId: e.id });

    const rows = (await listEligible(w.mgrA, e.id)).body.data as { id: string; unitCode: string }[];
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(uAvail.id);
    expect(ids).not.toContain(uHold.id); // on hold
    expect(ids).not.toContain(uBooked.id); // actively booked
    expect(ids).not.toContain(uSold.id); // sold
  });

  it('a unit with a RELEASED booking reappears; releasing returns it to the picker', async () => {
    const w = await bookingWorld(app);
    const e = await negotiationEnquiry(app, w);
    const u = await mkUnit(app, w.mgrA);
    const booking = await mkBooking(app, w.mgrA, { unitId: u.id, enquiryId: e.id });
    expect(((await listEligible(w.mgrA, e.id)).body.data as { id: string }[]).map((r) => r.id)).not.toContain(u.id);
    await releaseBookingApi(app, w.mgrA, booking.id);
    const ids = ((await listEligible(w.mgrA, e.id)).body.data as { id: string }[]).map((r) => r.id);
    expect(ids).toContain(u.id);
  });

  it('an expired hold (heldUntil in the past) is treated as available even when statusKey is a hold', async () => {
    const w = await bookingWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const u = await mkUnit(app, w.mgrA);
    await setStatus(app, w.mgrA, u.id, { statusId: w.st.hold });
    // No background job has run; heldUntil is the only signal. Setting it to the past must lift the hold.
    await Units.updateOne({ _id: new Types.ObjectId(u.id) }, { $set: { heldUntil: new Date(Date.now() - 60_000) } });
    const ids = ((await listEligible(w.mgrA, e.id)).body.data as { id: string }[]).map((r) => r.id);
    expect(ids).toContain(u.id); // expired hold => eligible
  });

  it('a hold with NO heldUntil is indefinite and stays held until the status is changed', async () => {
    const w = await bookingWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const u = await mkUnit(app, w.mgrA);
    await setStatus(app, w.mgrA, u.id, { statusId: w.st.hold });
    // heldUntil is null; the unit must NOT appear.
    const ids = ((await listEligible(w.mgrA, e.id)).body.data as { id: string }[]).map((r) => r.id);
    expect(ids).not.toContain(u.id);
  });

  it('a future heldUntil keeps the unit held', async () => {
    const w = await bookingWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const u = await mkUnit(app, w.mgrA);
    await setStatus(app, w.mgrA, u.id, { statusId: w.st.hold });
    await Units.updateOne({ _id: new Types.ObjectId(u.id) }, { $set: { heldUntil: new Date(Date.now() + 60_000 * 60) } });
    const ids = ((await listEligible(w.mgrA, e.id)).body.data as { id: string }[]).map((r) => r.id);
    expect(ids).not.toContain(u.id);
  });

  it('archived units never appear, even when their other eligibility conditions are met', async () => {
    const w = await bookingWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const u = await mkUnit(app, w.mgrA);
    await Units.updateOne({ _id: new Types.ObjectId(u.id) }, { $set: { isArchived: true } });
    const ids = ((await listEligible(w.mgrA, e.id)).body.data as { id: string }[]).map((r) => r.id);
    expect(ids).not.toContain(u.id);
  });

  it('existing interests do not exclude a unit — multiple enquiries can be interested in the same available unit', async () => {
    const w = await bookingWorld(app);
    const e1 = await mkEnquiry(app, w.mgrA);
    const e2 = await mkEnquiry(app, w.mgrA);
    const u = await mkUnit(app, w.mgrA);
    await addInterest(w.mgrA, e1.id, u.id);
    // e2 should still see u in the picker; the relationship is per-pair, not exclusive.
    const ids = ((await listEligible(w.mgrA, e2.id)).body.data as { id: string }[]).map((r) => r.id);
    expect(ids).toContain(u.id);
  });

  it('respects branch scope and refuses an enquiry from another branch', async () => {
    const w = await bookingWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const uB = await mkUnit(app, w.mgrB);
    // The mgrA picker should not see a branch-B unit even if AVAILABLE.
    const ids = ((await listEligible(w.mgrA, e.id)).body.data as { id: string; branchId: string }[]).map((r) => r.id);
    expect(ids).not.toContain(uB.id);
    // Same call from a manager who actually owns branch B sees it in their picker's branch.
    const eB = await mkEnquiry(app, w.mgrB);
    const idsB = ((await listEligible(w.mgrB, eB.id)).body.data as { id: string }[]).map((r) => r.id);
    expect(idsB).toContain(uB.id);
  });

  it('an OWN-scope executive only sees units through their own enquiries', async () => {
    const w = await bookingWorld(app);
    // An OWN-scope user only sees units assigned to them. Assign the unit so the picker can show it.
    const u = await mkUnit(app, w.mgrA, { assignedTo: w.salesA.user._id.toHexString() });
    const mine = await mkEnquiry(app, w.mgrA, { assignedTo: w.salesA.user._id.toHexString() });
    const other = await mkEnquiry(app, w.mgrA);
    await grant('SALES_EXECUTIVE', 'units.view');
    const mineRows = (await listEligible(w.salesA, mine.id)).body.data as { id: string }[];
    expect(mineRows.map((r) => r.id)).toContain(u.id);
    // The sales exec does not own `other`, so the server-side scope should 404 the other enquiry.
    const otherRes = await listEligible(w.salesA, other.id);
    expect([403, 404]).toContain(otherRes.status);
  });
});

describe('addInterest revalidates eligibility at the moment of the write', () => {
  it('refuses a SOLD unit with UNIT_NOT_ELIGIBLE and a clear, refreshable message', async () => {
    const w = await bookingWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const u = await mkUnit(app, w.mgrA);
    await setStatus(app, w.mgrA, u.id, { statusId: w.st.sold });
    const res = await addInterest(w.mgrA, e.id, u.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('UNIT_NOT_ELIGIBLE');
    expect(res.body.error.message).toMatch(/sold/i);
    // The relationship must not have been created and the unit's status must not have changed.
    expect(await Interests.countDocuments({})).toBe(0);
    expect((await Units.findById(new Types.ObjectId(u.id)).lean())!.statusKey).toBe('SOLD');
  });

  it('refuses a unit whose booking was created between picker and submit', async () => {
    const w = await bookingWorld(app);
    const e = await negotiationEnquiry(app, w);
    const u = await mkUnit(app, w.mgrA);
    // The picker would show u; a competing booking lands before the user clicks "Add unit".
    const otherEnq = await negotiationEnquiry(app, w);
    await mkBooking(app, w.mgrA, { unitId: u.id, enquiryId: otherEnq.id });
    const res = await addInterest(w.mgrA, e.id, u.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('UNIT_NOT_ELIGIBLE');
    expect(res.body.error.message).toMatch(/booked/i);
    // Exactly one ACTIVE booking; the failed interest must not have created a second.
    expect(await Bookings.countDocuments({ unitId: new Types.ObjectId(u.id), status: 'ACTIVE' })).toBe(1);
    expect(await Interests.countDocuments({})).toBe(0);
  });

  it('refuses a unit that is on hold', async () => {
    const w = await bookingWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const u = await mkUnit(app, w.mgrA);
    await setStatus(app, w.mgrA, u.id, { statusId: w.st.hold });
    const res = await addInterest(w.mgrA, e.id, u.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('UNIT_NOT_ELIGIBLE');
    expect(res.body.error.message).toMatch(/hold/i);
  });

  it('accepts an AVAILABLE unit and the activity type is UNIT_INTEREST_ADDED; nothing else changes', async () => {
    const w = await bookingWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const u = await mkUnit(app, w.mgrA);
    const enquiryBefore = (await Enquiries.findById(new Types.ObjectId(e.id)).lean())!.stageCode;
    const res = await addInterest(w.mgrA, e.id, u.id, { note: 'Likes the layout' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'INTERESTED' });
    expect((await Units.findById(new Types.ObjectId(u.id)).lean())!.statusKey).toBe('AVAILABLE'); // never touches inventory
    expect((await Enquiries.findById(new Types.ObjectId(e.id)).lean())!.stageCode).toBe(enquiryBefore); // never moves stage
    // Activity recorded with the correct type.
    const acts = await Activities.find({ 'refs.id': new Types.ObjectId(u.id), type: 'UNIT_INTEREST_ADDED' }).lean<{ type: string }[]>();
    expect(acts.length).toBeGreaterThan(0);
  });

  it('accepts an expired-hold unit', async () => {
    const w = await bookingWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const u = await mkUnit(app, w.mgrA);
    await setStatus(app, w.mgrA, u.id, { statusId: w.st.hold });
    await Units.updateOne({ _id: new Types.ObjectId(u.id) }, { $set: { heldUntil: new Date(Date.now() - 60_000) } });
    const res = await addInterest(w.mgrA, e.id, u.id);
    expect(res.status).toBe(201);
  });

  it('duplicate interests are still refused with INTEREST_EXISTS (the new eligibility check does not change duplicate semantics)', async () => {
    const w = await bookingWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const u = await mkUnit(app, w.mgrA);
    await addInterest(w.mgrA, e.id, u.id);
    const dup = await addInterest(w.mgrA, e.id, u.id);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('INTEREST_EXISTS');
  });

  it('permission is still required: a caller without enquiries.edit is refused with 403 even for an eligible unit', async () => {
    const w = await bookingWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const u = await mkUnit(app, w.mgrA);
    await revoke('MANAGER', 'enquiries.edit');
    const res = await addInterest(w.mgrA, e.id, u.id);
    expect(res.status).toBe(403);
    expect(await Interests.countDocuments({})).toBe(0);
  });
});
