import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { systemRepo } from '../../core/scope/system';
import { useTestDb } from '../../test/db';
import { seedAll } from '../../test/factories';
import { api, bookingWorld, grant, mkBooking, mkUnit, negotiationEnquiry, releaseBookingApi, revoke } from '../../test/bookings';
import { createClientApi } from '../../test/people';
import { mkEnquiry } from '../../test/enquiries';
import { mkVisit, readyEnquiry } from '../../test/sitevisits';
import { setStatus } from '../../test/units';
import { Unit } from '../units/unit.model';
import { UnitInterest } from './unitInterest.model';

const app = buildApp();
useTestDb();
beforeEach(seedAll);
const Units = systemRepo(Unit, 'test', 'fixtures');
const Interests = systemRepo(UnitInterest, 'test', 'fixtures');

type Who = { auth: Record<string, string> };
const get = (who: Who, path: string) => request(app).get(api(path)).set(who.auth);
const post = (who: Who, path: string, body: Record<string, unknown> = {}) => request(app).post(api(path)).set(who.auth).send(body);
const rel = (who: Who, enquiryId: string, unitId: string, extra: Record<string, unknown> = {}) => post(who, `/enquiries/${enquiryId}/unit-interests`, { unitId, ...extra });
const unitsOf = async (who: Who, enquiryId: string) => (await get(who, `/enquiries/${enquiryId}`)).body.data.units as { unitId: string; state: string; bookings: unknown[]; visits: unknown[]; enquiries: { id: string }[]; interest?: { status: string }; unit?: { statusKey: string } }[];

describe('one entry per unit, with a clearly separate relationship state', () => {
  it('merges interest, a site visit and a booking of the same unit into ONE entry whose state is the strongest fact, keeping the booking history', async () => {
    const w = await bookingWorld(app);
    const e = await readyEnquiry(app, w);
    const unit = await mkUnit(app, w.mgrA);
    await rel(w.mgrA, e.id, unit.id);
    expect((await unitsOf(w.mgrA, e.id)).map((r) => r.state)).toEqual(['INTERESTED']);
    const visit = await mkVisit(app, w.mgrA, { enquiryId: e.id, unitIds: [unit.id] });
    expect((await unitsOf(w.mgrA, e.id))).toEqual([expect.objectContaining({ state: 'SITE_VISIT_SCHEDULED' })]);
    await post(w.mgrA, `/sitevisits/${visit.id}/complete`, { feedback: 'Liked it' });
    expect((await unitsOf(w.mgrA, e.id))[0]!.state).toBe('SITE_VISIT_COMPLETED');
    await post(w.mgrA, `/enquiries/${e.id}/transition`, { to: 'NEGOTIATION' });
    const booking = await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: e.id });
    const booked = await unitsOf(w.mgrA, e.id);
    expect(booked).toHaveLength(1); // not three lines
    expect(booked[0]).toMatchObject({ state: 'BOOKED', interest: { status: 'INTERESTED' } });
    expect(booked[0]!.visits).toHaveLength(1);
    await releaseBookingApi(app, w.mgrA, booking.id);
    const after = await unitsOf(w.mgrA, e.id);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ state: 'SITE_VISIT_COMPLETED' }); // released: back to what the visit and interest say; the booking stays in `bookings`
    expect(after[0]!.bookings).toEqual([expect.objectContaining({ id: booking.id, status: 'RELEASED' })]);
  }, 90_000);

  it('a client with several enquiries sees each unit once, with every enquiry that references it', async () => {
    const w = await bookingWorld(app);
    const e1 = await mkEnquiry(app, w.mgrA);
    const client = (await createClientApi(app, w.mgrA, { person: undefined, personId: e1.personId })).body.data;
    const e2 = await mkEnquiry(app, w.mgrA, { person: undefined, personId: e1.personId });
    const [shared, only2] = [await mkUnit(app, w.mgrA), await mkUnit(app, w.mgrA)];
    await rel(w.mgrA, e1.id, shared.id);
    await rel(w.mgrA, e2.id, shared.id);
    await rel(w.mgrA, e2.id, only2.id);
    const rows = (await get(w.mgrA, `/clients/${client.id}/related`)).body.data.units.rows as { unitId: string; enquiries: { id: string }[] }[];
    expect(rows.map((r) => r.unitId).sort()).toEqual([shared.id, only2.id].sort());
    expect(rows.find((r) => r.unitId === shared.id)!.enquiries.map((x) => x.id).sort()).toEqual([e1.id, e2.id].sort());
    // the enquiry list and the client list show the same units in their one Units column
    const enquiryRow = (await get(w.mgrA, '/enquiries?limit=50')).body.data.find((r: { id: string }) => r.id === e2.id);
    expect(enquiryRow.units.map((u: { unitId: string }) => u.unitId).sort()).toEqual([shared.id, only2.id].sort());
    const clientRow = (await get(w.mgrA, '/clients?limit=50')).body.data.find((r: { id: string }) => r.id === client.id);
    expect(clientRow.units.map((u: { unitId: string }) => u.unitId).sort()).toEqual([shared.id, only2.id].sort());
  });
});

describe('recording a relationship by hand', () => {
  it('records Interested or Not interested, blocks duplicates of the same state, and switches between them on the one record', async () => {
    const w = await bookingWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const unit = await mkUnit(app, w.mgrA);
    const added = await rel(w.mgrA, e.id, unit.id, { status: 'NOT_INTERESTED', note: 'Too small' });
    expect(added.status).toBe(201);
    expect((await unitsOf(w.mgrA, e.id))[0]).toMatchObject({ state: 'NOT_INTERESTED', interest: { status: 'NOT_INTERESTED' } });
    expect((await rel(w.mgrA, e.id, unit.id, { status: 'NOT_INTERESTED' })).body.error.code).toBe('INTEREST_EXISTS');
    const back = await rel(w.mgrA, e.id, unit.id, { status: 'INTERESTED' });
    expect(back.status).toBe(201);
    expect((await rel(w.mgrA, e.id, unit.id)).status).toBe(409);
    expect((await unitsOf(w.mgrA, e.id))[0]!.state).toBe('INTERESTED');
    expect((await rel(w.mgrA, e.id, unit.id, { status: 'NOT_INTERESTED' })).status).toBe(201); // interested -> not interested
    expect(await Interests.countDocuments({})).toBe(1); // always the same single record
    expect((await Units.findById(unit.id).lean())!.statusKey).toBe('AVAILABLE'); // a relationship never changes inventory
  });

  it('only Interested and Not interested can be recorded by hand: Hold, Booked, Sold and Site visit are refused', async () => {
    const w = await bookingWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const unit = await mkUnit(app, w.mgrA);
    for (const status of ['HOLD', 'BOOKED', 'SOLD', 'SITE_VISIT']) expect((await rel(w.mgrA, e.id, unit.id, { status })).status, status).toBe(400);
    expect(await Interests.countDocuments({})).toBe(0);
    expect((await Units.findById(unit.id).lean())!.statusKey).toBe('AVAILABLE');
  });

  it('an active booking outranks "not interested"; an inventory hold on the unit is just the unit\'s own status', async () => {
    const w = await bookingWorld(app);
    const e = await negotiationEnquiry(app, w);
    const unit = await mkUnit(app, w.mgrA);
    await rel(w.mgrA, e.id, unit.id, { status: 'NOT_INTERESTED' });
    await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: e.id });
    expect((await unitsOf(w.mgrA, e.id))[0]!.state).toBe('BOOKED');
    const e2 = await mkEnquiry(app, w.mgrA);
    const held = await mkUnit(app, w.mgrA);
    await rel(w.mgrA, e2.id, held.id);
    expect((await setStatus(app, w.mgrA, held.id, { statusId: w.st.hold })).status).toBe(200);
    const row = (await unitsOf(w.mgrA, e2.id))[0]!;
    expect(row.state).toBe('INTERESTED');
    expect(row.unit!.statusKey).not.toBe('AVAILABLE'); // the hold lives on the unit, separate from the relationship
  }, 60_000);
});

describe('list columns and permissions', () => {
  it('the Enquiries and Clients lists carry the Units column only for someone who may view units, and only from records they may see', async () => {
    const w = await bookingWorld(app);
    const mine = await mkEnquiry(app, w.mgrA, { assignedTo: w.salesA.user._id.toHexString() });
    const theirs = await mkEnquiry(app, w.mgrA);
    const unit = await mkUnit(app, w.mgrA);
    await rel(w.mgrA, mine.id, unit.id);
    await rel(w.mgrA, theirs.id, unit.id);
    const rows = (await get(w.mgrA, '/enquiries?limit=50')).body.data as { id: string; units?: { state: string }[] }[];
    expect(rows.find((r) => r.id === mine.id)!.units).toEqual([expect.objectContaining({ state: 'INTERESTED', unitCode: unit.unitCode })]);
    await revoke('MANAGER', 'units.view');
    const hidden = (await get(w.mgrA, '/enquiries?limit=50')).body.data as { units?: unknown }[];
    expect(hidden.every((r) => r.units === undefined)).toBe(true);
    expect((await get(w.mgrA, `/enquiries/${mine.id}`)).body.data.units).toBeNull();
    await grant('MANAGER', 'units.view');
    // another branch never sees these relationships
    expect((await get(w.mgrB, '/enquiries?limit=50')).body.data).toEqual([]);
    // an OWN-scope executive sees only their own enquiry's units
    await grant('SALES_EXECUTIVE', 'units.view');
    const own = await get(w.salesA, '/enquiries?limit=50');
    expect((own.body.data as { id: string }[]).map((r) => r.id)).toEqual([mine.id]);
    expect(own.body.data[0].units).toEqual([expect.objectContaining({ unitId: unit.id })]);
  });
});
