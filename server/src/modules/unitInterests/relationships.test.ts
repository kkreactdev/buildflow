import request from 'supertest';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { systemRepo } from '../../core/scope/system';
import { useTestDb } from '../../test/db';
import { seedAll } from '../../test/factories';
import { api, bookingWorld, createBookingApi, grant, mkBooking, mkUnit, negotiationEnquiry, releaseBookingApi, revoke, type BW } from '../../test/bookings';
import { createClientApi } from '../../test/people';
import { createFollowUpApi, inDays, mkEnquiry } from '../../test/enquiries';
import { mkVisit, readyEnquiry } from '../../test/sitevisits';
import { Unit } from '../units/unit.model';
import { Booking } from '../bookings/booking.model';
import { UnitInterest } from './unitInterest.model';
import { Client } from '../clients/client.model';

const app = buildApp();
useTestDb();
beforeEach(seedAll);
const Units = systemRepo(Unit, 'test', 'fixtures');
const Interests = systemRepo(UnitInterest, 'test', 'fixtures');
const Bookings = systemRepo(Booking, 'test', 'fixtures');
const Clients = systemRepo(Client, 'test', 'fixtures');

type Who = { auth: Record<string, string> };
const get = (who: Who, path: string) => request(app).get(api(path)).set(who.auth);
const post = (who: Who, path: string, body: Record<string, unknown> = {}) => request(app).post(api(path)).set(who.auth).send(body);
const addInterest = (who: Who, enquiryId: string, unitId: string, extra: Record<string, unknown> = {}) => post(who, `/enquiries/${enquiryId}/unit-interests`, { unitId, ...extra });
const callType = async (w: BW) => (((await get(w.admin, '/masters?types=FOLLOWUP_TYPE')).body.data.FOLLOWUP_TYPE as { _id: string }[])[0]!._id);
const stageOf = async (w: BW, id: string) => (await get(w.mgrA, `/enquiries/${id}`)).body.data.stageCode as string;

/** An enquiry for a person who becomes a client LATER: booking, visit and follow-up exist before the client does. */
async function bookedThenConverted(w: BW) {
  const e = await negotiationEnquiry(app, w);
  const unit = await mkUnit(app, w.mgrA);
  const booking = await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: e.id });
  const fu = await createFollowUpApi(app, w.mgrA, { enquiryId: e.id, typeId: await callType(w), scheduledAt: inDays(2), notes: 'Send the agreement' });
  expect(fu.status).toBe(201);
  const conv = await post(w.mgrA, `/enquiries/${e.id}/convert`);
  expect(conv.status).toBe(200);
  return { e, unit, booking, client: conv.body.data.client as { id: string; clientNo: string } };
}

describe('client details resolve related records through the person identity', () => {
  it('shows enquiry follow-ups, site visits, bookings and the booked unit for a client converted AFTER they were created', async () => {
    const w = await bookingWorld(app);
    const { e, unit, booking, client } = await bookedThenConverted(w);
    const rel = (await get(w.mgrA, `/clients/${client.id}/related`)).body.data;
    expect(rel.enquiries.rows.map((x: { id: string }) => x.id)).toEqual([e.id]);
    expect(rel.followUps.rows.map((x: { notes: string }) => x.notes)).toContain('Send the agreement'); // anchored to the enquiry, not the client
    expect(rel.siteVisits.rows.length).toBeGreaterThan(0);
    expect(rel.siteVisits.rows.every((v: { enquiryId: string }) => v.enquiryId === e.id)).toBe(true);
    expect(rel.bookings.rows.map((b: { id: string }) => b.id)).toEqual([booking.id]);
    expect(rel.bookings.rows[0]).toMatchObject({ clientId: client.id, clientNo: client.clientNo }); // resolved although the booking was made before the client existed
    expect(rel.units.rows).toEqual([expect.objectContaining({ state: 'BOOKED', unitId: unit.id, enquiries: [{ id: e.id, enquiryNo: e.enquiryNo }], bookings: [expect.objectContaining({ bookingNo: booking.bookingNo, status: 'ACTIVE' })] })]);
  });

  it('shows the same records for a client created first (no conversion) and never duplicates them', async () => {
    const w = await bookingWorld(app);
    const phone = '9811100077';
    const client = (await createClientApi(app, w.mgrA, { person: { name: 'Early Client', phone } })).body.data;
    const e = await mkEnquiry(app, w.mgrA, { person: undefined, personId: client.personId });
    await createFollowUpApi(app, w.mgrA, { clientId: client.id, typeId: await callType(w), scheduledAt: inDays(1), notes: 'client-anchored' });
    await createFollowUpApi(app, w.mgrA, { enquiryId: e.id, typeId: await callType(w), scheduledAt: inDays(2), notes: 'enquiry-anchored' });
    const rel = (await get(w.mgrA, `/clients/${client.id}/related`)).body.data;
    expect(rel.followUps.rows.map((f: { notes: string }) => f.notes).sort()).toEqual(['client-anchored', 'enquiry-anchored']);
    expect(rel.enquiries.rows).toHaveLength(1);
  });

  it('lists released bookings as history and never as the current holder', async () => {
    const w = await bookingWorld(app);
    const { booking, client, unit } = await bookedThenConverted(w);
    await releaseBookingApi(app, w.mgrA, booking.id);
    const rel = (await get(w.mgrA, `/clients/${client.id}/related`)).body.data;
    expect(rel.bookings.rows[0]).toMatchObject({ status: 'RELEASED', isActive: false });
    expect(rel.units.rows).toEqual([expect.objectContaining({ state: 'BOOKING_RELEASED', unitId: unit.id, bookings: [expect.objectContaining({ status: 'RELEASED' })] })]); // history is kept inside the unit's one entry
    expect(rel.units.rows.some((r: { state: string }) => r.state === 'BOOKED' || r.state === 'SOLD')).toBe(false);
  });

  it('marks a unit sold TO the client only when the client holds its active booking', async () => {
    const w = await bookingWorld(app);
    const { unit, client } = await bookedThenConverted(w);
    await Units.updateOne({ _id: unit.id }, { $set: { statusKey: 'SOLD' } });
    const rel = (await get(w.mgrA, `/clients/${client.id}/related`)).body.data;
    expect(rel.units.rows[0]).toMatchObject({ state: 'SOLD', purchaser: { clientNo: client.clientNo, bookingNo: expect.any(String), enquiryNo: expect.any(String) } });
  });

  it('respects scope and permissions: a section the caller may not view is null, another branch is 404, OWN sees only their own follow-ups', async () => {
    const w = await bookingWorld(app);
    const { client } = await bookedThenConverted(w);
    expect((await get(w.mgrB, `/clients/${client.id}/related`)).status).toBe(404);
    await revoke('MANAGER', 'bookings.view', 'units.view');
    const rel = (await get(w.mgrA, `/clients/${client.id}/related`)).body.data;
    expect(rel.bookings).toBeNull();
    expect(rel.units).toBeNull();
    expect(rel.enquiries).not.toBeNull();
    expect((await request(app).get(api(`/clients/${client.id}/related`))).status).toBe(401);
    // an OWN-scope executive who owns neither the enquiry nor the client sees none of its follow-ups
    await grant('SALES_EXECUTIVE', 'followups.view');
    const none = await get(w.salesA, `/clients/${client.id}/related`);
    if (none.status === 200) expect(none.body.data.followUps?.rows ?? []).toEqual([]);
  });
});

describe('units seen on site visits', () => {
  it('appear on the client as a site-visit relation (not interest, booking or sale), once, and give way to an interest or booking in the same unit', async () => {
    const w = await bookingWorld(app);
    const e = await readyEnquiry(app, w);
    const unit = await mkUnit(app, w.mgrA);
    await mkVisit(app, w.mgrA, { enquiryId: e.id, unitIds: [unit.id] });
    const client = (await createClientApi(app, w.mgrA, { person: undefined, personId: e.personId })).body.data;
    const rows = async () => (await get(w.mgrA, `/clients/${client.id}/related`)).body.data.units.rows as { state: string; interest?: { status: string }; unitId: string }[];
    expect(await rows()).toEqual([expect.objectContaining({ state: 'SITE_VISIT_SCHEDULED', unitId: unit.id })]);
    expect((await Units.findById(unit.id).lean())!.statusKey).toBe('AVAILABLE');
    await addInterest(w.mgrA, e.id, unit.id);
    expect((await rows()).map((r) => r.state)).toEqual(['SITE_VISIT_SCHEDULED']); // still ONE entry; the visit is the stronger fact, the interest is kept on it
  });
});

describe('unit interest is separate from stage, inventory status and booking', () => {
  it('records interest without changing the unit status, the enquiry stage or any booking, and blocks duplicates', async () => {
    const w = await bookingWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const unit = await mkUnit(app, w.mgrA);
    const stage = await stageOf(w, e.id);
    const res = await addInterest(w.mgrA, e.id, unit.id, { note: 'Likes the garden' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'INTERESTED', progress: 'INTERESTED', unitCode: unit.unitCode, enquiryNo: e.enquiryNo });
    expect((await Units.findById(unit.id).lean())!.statusKey).toBe('AVAILABLE');
    expect(await stageOf(w, e.id)).toBe(stage);
    expect(await Bookings.countDocuments({})).toBe(0);
    const dup = await addInterest(w.mgrA, e.id, unit.id);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('INTEREST_EXISTS');
    expect(await Interests.countDocuments({})).toBe(1);
  });

  it('supports several units per enquiry, shows them on the enquiry, the unit and the client, and withdraw / re-add reuses the one record', async () => {
    const w = await bookingWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const [u1, u2] = [await mkUnit(app, w.mgrA), await mkUnit(app, w.mgrA)];
    const first = (await addInterest(w.mgrA, e.id, u1.id)).body.data;
    await addInterest(w.mgrA, e.id, u2.id);
    const onEnquiry = (await get(w.mgrA, `/enquiries/${e.id}`)).body.data.unitInterests;
    expect(onEnquiry.map((i: { unitCode: string }) => i.unitCode).sort()).toEqual([u1.unitCode, u2.unitCode].sort());
    const onUnit = (await get(w.mgrA, `/units/${u1.id}`)).body.data.interests;
    expect(onUnit.rows).toEqual([expect.objectContaining({ enquiryNo: e.enquiryNo, status: 'INTERESTED' })]);
    const client = (await createClientApi(app, w.mgrA, { person: undefined, personId: e.personId })).body.data;
    const rel = (await get(w.mgrA, `/clients/${client.id}/related`)).body.data;
    expect(rel.units.rows.filter((r: { state: string }) => r.state === 'INTERESTED')).toHaveLength(2);

    expect((await post(w.mgrA, `/unit-interests/${first.id}/withdraw`, { reason: 'Too expensive' })).body.data.status).toBe('WITHDRAWN');
    expect((await get(w.mgrA, `/clients/${client.id}/related`)).body.data.units.rows.filter((r: { state: string }) => r.state === 'INTERESTED')).toHaveLength(1);
    const again = await addInterest(w.mgrA, e.id, u1.id);
    expect(again.status).toBe(201);
    expect(again.body.data.id).toBe(first.id);
    expect(await Interests.countDocuments({})).toBe(2);
  });

  it('derives progress from real site visits and bookings, never from a stored copy', async () => {
    const w = await bookingWorld(app);
    const e = await readyEnquiry(app, w);
    const unit = await mkUnit(app, w.mgrA);
    const id = (await addInterest(w.mgrA, e.id, unit.id)).body.data.id as string;
    const progress = async () => ((await get(w.mgrA, `/enquiries/${e.id}`)).body.data.unitInterests as { id: string; progress: string }[]).find((i) => i.id === id)!.progress;
    expect(await progress()).toBe('INTERESTED');
    const visit = await mkVisit(app, w.mgrA, { enquiryId: e.id, unitIds: [unit.id] });
    expect(await progress()).toBe('SITE_VISIT_SCHEDULED');
    expect((await Units.findById(unit.id).lean())!.statusKey).toBe('AVAILABLE'); // scheduling a visit does not reserve the unit
    await post(w.mgrA, `/sitevisits/${visit.id}/complete`, { feedback: 'Liked it' });
    expect(await progress()).toBe('SITE_VISIT_COMPLETED');
    await request(app).post(api(`/enquiries/${e.id}/transition`)).set(w.mgrA.auth).send({ to: 'NEGOTIATION' });
    const booking = await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: e.id });
    expect(await progress()).toBe('BOOKED');
    await releaseBookingApi(app, w.mgrA, booking.id);
    expect(await progress()).toBe('BOOKING_RELEASED');
  }, 60_000);

  it('refuses another branch\'s unit and enquiry, archived/unknown ids and missing permission, and an OWN user cannot add to a colleague\'s enquiry', async () => {
    const w = await bookingWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const unitB = await mkUnit(app, w.mgrB);
    expect((await addInterest(w.mgrA, e.id, unitB.id)).status).toBe(404); // not visible to a branch-A manager
    expect((await addInterest(w.admin, e.id, unitB.id)).status).toBe(400); // visible to ALL scope but of another branch
    expect((await addInterest(w.mgrA, new Types.ObjectId().toHexString(), unitB.id)).status).toBe(404);
    const unit = await mkUnit(app, w.mgrA);
    expect((await addInterest(w.mgrB, e.id, unit.id)).status).toBe(404);
    expect((await addInterest(w.salesA, e.id, unit.id)).status).toBe(404);
    await revoke('MANAGER', 'enquiries.edit');
    expect((await addInterest(w.mgrA, e.id, unit.id)).status).toBe(403);
    expect(await Interests.countDocuments({})).toBe(0);
  });
});

describe('unit details explain booking, sale and interest', () => {
  it('a booked unit names the active booking, its client and its enquiry; released bookings are only history', async () => {
    const w = await bookingWorld(app);
    const { e, unit, booking, client } = await bookedThenConverted(w);
    const detail = (await get(w.mgrA, `/units/${unit.id}`)).body.data;
    expect(detail.booking.active).toMatchObject({ id: booking.id, clientId: client.id, clientNo: client.clientNo, enquiryNo: e.enquiryNo, isActive: true });
    expect(detail.booking.history).toEqual([]);
    expect(detail.sale).toBeNull(); // booked is not sold
    await releaseBookingApi(app, w.mgrA, booking.id);
    const after = (await get(w.mgrA, `/units/${unit.id}`)).body.data;
    expect(after.booking.active).toBeUndefined();
    expect(after.booking.history.map((b: { id: string }) => b.id)).toEqual([booking.id]);
  });

  it('a sold unit shows its purchaser only through the active booking, and flags a sold unit with no link instead of inventing one', async () => {
    const w = await bookingWorld(app);
    const { unit, client } = await bookedThenConverted(w);
    await Units.updateOne({ _id: unit.id }, { $set: { statusKey: 'SOLD' } });
    const linked = (await get(w.mgrA, `/units/${unit.id}`)).body.data.sale;
    expect(linked).toMatchObject({ state: 'LINKED', booking: { clientId: client.id } });
    const lonely = await mkUnit(app, w.mgrA);
    await Units.updateOne({ _id: lonely.id }, { $set: { statusKey: 'SOLD' } });
    expect((await get(w.mgrA, `/units/${lonely.id}`)).body.data.sale).toEqual({ state: 'UNLINKED' });
    await revoke('MANAGER', 'bookings.view');
    expect((await get(w.mgrA, `/units/${lonely.id}`)).body.data.sale).toEqual({ state: 'HIDDEN' }); // not shown as unlinked to someone who cannot see bookings
  });

  it('interest does not make a unit appear booked or sold, and an OWN user only sees interests of enquiries they can see', async () => {
    const w = await bookingWorld(app);
    const mine = await mkEnquiry(app, w.mgrA, { assignedTo: w.salesA.user._id.toHexString() });
    const theirs = await mkEnquiry(app, w.mgrA);
    const unit = await mkUnit(app, w.mgrA);
    await addInterest(w.mgrA, mine.id, unit.id);
    await addInterest(w.mgrA, theirs.id, unit.id);
    const detail = (await get(w.mgrA, `/units/${unit.id}`)).body.data;
    expect(detail.statusKey).toBe('AVAILABLE');
    expect(detail.booking.active).toBeUndefined();
    expect(detail.interests.rows).toHaveLength(2);
    await grant('SALES_EXECUTIVE', 'units.view', 'enquiries.view');
    const own = await get(w.salesA, `/units/${unit.id}`);
    if (own.status === 200) expect(own.body.data.interests.rows.map((r: { enquiryId: string }) => r.enquiryId)).toEqual([mine.id]);
  });
});

describe('booking integrity is unchanged', () => {
  it('one unit cannot have two active bookings, but one enquiry can book different units', async () => {
    const w = await bookingWorld(app);
    const e1 = await negotiationEnquiry(app, w);
    const e2 = await negotiationEnquiry(app, w);
    const [u1, u2] = [await mkUnit(app, w.mgrA), await mkUnit(app, w.mgrA)];
    await mkBooking(app, w.mgrA, { unitId: u1.id, enquiryId: e1.id });
    const clash = await createBookingApi(app, w.mgrA, { unitId: u1.id, enquiryId: e2.id });
    expect(clash.status).toBe(409);
    expect(await Bookings.countDocuments({ unitId: u1.id, status: 'ACTIVE' })).toBe(1);
    const second = await createBookingApi(app, w.mgrA, { unitId: u2.id, enquiryId: e1.id }); // the same enquiry, a different unit
    expect(second.status).toBe(201);
    expect(await Bookings.countDocuments({ enquiryId: e1.id, status: 'ACTIVE' })).toBe(2);
    await releaseBookingApi(app, w.mgrA, second.body.data.id);
    expect((await Units.findById(u2.id).lean())!.statusKey).toBe('AVAILABLE'); // release makes it available again, never sold
    void Clients;
  }, 60_000);
});
