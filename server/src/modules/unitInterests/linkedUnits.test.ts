import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { useTestDb } from '../../test/db';
import { seedAll } from '../../test/factories';
import { mkBooking, negotiationEnquiry } from '../../test/bookings';
import { advance, createClientApi, mkEnquiry, person } from '../../test/enquiries';
import { createVisitApi, inDays } from '../../test/sitevisits';
import { api, grant, mkUnit, revoke, unitWorld, type UW } from '../../test/units';

const app = buildApp();
useTestDb();
beforeEach(seedAll);

type Who = { auth: Record<string, string> };
const get = (who: Who, path: string) => request(app).get(api(path)).set(who.auth);
const post = (who: Who, path: string, body: Record<string, unknown> = {}) => request(app).post(api(path)).set(who.auth).send(body);

type Linked = { id: string; unitCode: string; name?: string; statusKey?: string; statusLabel?: string; statusColor?: string; state: string; via: { id: string; enquiryNo: string }[] };

/**
 * The picker endpoint's answer. `null` (may not view units) and `[]` (nothing is linked) are
 * DIFFERENT answers and the endpoint has to keep them apart — the UI says something else for each.
 */
const linkedForEnquiry = async (who: Who, enquiryId: string) => {
  const res = await get(who, `/enquiries/${enquiryId}/units`);
  if (res.status !== 200) throw new Error(`linked-units failed ${res.status} ${JSON.stringify(res.body)}`);
  return (res.body.data as { units: Linked[] | null }).units;
};
const linkedForClient = async (who: Who, clientId: string) => {
  const res = await get(who, `/clients/${clientId}/units`);
  if (res.status !== 200) throw new Error(`client linked-units failed ${res.status} ${JSON.stringify(res.body)}`);
  return (res.body.data as { units: Linked[] | null }).units;
};

const addInterest = (who: Who, enquiryId: string, unitId: string) => post(who, `/enquiries/${enquiryId}/unit-interests`, { unitId, status: 'INTERESTED' });
const ids = (rows: Linked[] | null) => (rows ?? []).map((r) => r.id).sort();
/** Same call, narrowed: for the tests that go on to read rows (the null/[] distinction is asserted above). */
const rowsFor = async (fetch: () => Promise<Linked[] | null>) => (await fetch()) ?? [];

/** An enquiry in branch A already moved to the stage that precedes "site visit scheduled". */
async function readyEnquiry(app_: Express, w: UW) {
  const e = await mkEnquiry(app_, w.mgrA);
  await advance(app_, w.mgrA, e.id, 'CONTACTED', 'INTERESTED');
  return e;
}

/**
 * An enquiry in the stage conversion is offered from. That stage (Booked) is entered only by a real
 * booking, so this books a unit of its own — a test that links its OWN units on top must account for it.
 */
async function bookedEnquiry(app_: Express, w: UW, extra: Record<string, unknown> = {}) {
  const e = await negotiationEnquiry(app_, w, extra);
  const unit = await mkUnit(app_, w.mgrA);
  await mkBooking(app_, w.mgrA, { unitId: unit.id, enquiryId: e.id });
  return { enquiry: e, bookedUnitId: unit.id };
}

const convert = (w: UW, id: string) => post(w.mgrA, `/enquiries/${id}/convert`);

describe('linked units of an enquiry — what the site-visit scheduler offers', () => {
  it('returns ONLY the units linked to that enquiry, never the rest of the branch', async () => {
    const w = await unitWorld(app);
    const e = await readyEnquiry(app, w);
    const a = await mkUnit(app, w.mgrA);
    const b = await mkUnit(app, w.mgrA);
    const untouched = await mkUnit(app, w.mgrA);
    await addInterest(w.mgrA, e.id, a.id);
    await addInterest(w.mgrA, e.id, b.id);

    // A unit linked to a DIFFERENT enquiry of the same branch must not leak into this one's picker.
    const other = await mkEnquiry(app, w.mgrA);
    const elsewhere = await mkUnit(app, w.mgrA);
    await addInterest(w.mgrA, other.id, elsewhere.id);

    expect(ids(await linkedForEnquiry(w.mgrA, e.id))).toEqual([a.id, b.id].sort());
    expect(ids(await linkedForEnquiry(w.mgrA, e.id))).not.toContain(untouched.id);
    expect(ids(await linkedForEnquiry(w.mgrA, e.id))).not.toContain(elsewhere.id);
  });

  it('returns an EMPTY list, not a fallback of every branch unit, when nothing is linked yet', async () => {
    const w = await unitWorld(app);
    const e = await readyEnquiry(app, w);
    await mkUnit(app, w.mgrA); // same branch, never linked
    expect(await linkedForEnquiry(w.mgrA, e.id)).toEqual([]);
  });

  it('carries the unit id, its name and a real status label from the UNIT_STATUS master', async () => {
    const w = await unitWorld(app);
    const e = await readyEnquiry(app, w);
    const u = await mkUnit(app, w.mgrA, { name: 'Sea facing 3BHK' });
    await addInterest(w.mgrA, e.id, u.id);

    const rows = await rowsFor(() => linkedForEnquiry(w.mgrA, e.id));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.id).toBe(u.id);
    expect(row.unitCode).toBe(u.unitCode);
    expect(row.name).toBe('Sea facing 3BHK');
    expect(row.statusKey).toBe('AVAILABLE');
    // A raw status KEY is not something a person can read: the label must come from the master.
    expect(row.statusLabel).toBeTruthy();
    expect(row.statusLabel).not.toBe(row.statusKey);
    expect(row.state).toBe('INTERESTED');
  });

  it('merges all three linking sources into one row per unit, with the derived state', async () => {
    const w = await unitWorld(app);
    const e = await readyEnquiry(app, w);
    const interested = await mkUnit(app, w.mgrA);
    const booked = await mkUnit(app, w.mgrA);
    const visited = await mkUnit(app, w.mgrA);
    await addInterest(w.mgrA, e.id, interested.id);
    await addInterest(w.mgrA, e.id, booked.id);
    const created = await createVisitApi(app, w.mgrA, { enquiryId: e.id, scheduledAt: inDays(1), unitIds: [visited.id] });
    expect(created.status).toBe(201);

    const rows = await rowsFor(() => linkedForEnquiry(w.mgrA, e.id));
    expect(ids(rows)).toEqual([booked.id, interested.id, visited.id].sort());
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(interested.id)?.state).toBe('INTERESTED');
    expect(byId.get(visited.id)?.state).toBe('SITE_VISIT_SCHEDULED');
    // A linked unit stays listed whatever became of it: this picker is a RELATIONSHIP list, not an
    // availability filter, so an operator can still schedule a visit on a unit that was since booked.
    expect(ids(rows)).toContain(booked.id);
  });

  it('deduplicates a unit that several of the party\'s enquiries touch, keeping every via', async () => {
    const w = await unitWorld(app);
    const one = await bookedEnquiry(app, w);
    // A client is (person, branch): a SECOND booked enquiry of the same person in the same branch is the
    // same client, which is exactly the case where a shared unit would otherwise be listed twice.
    const two = await bookedEnquiry(app, w, { person: undefined, personId: one.enquiry.personId });
    const shared = await mkUnit(app, w.mgrA);
    await addInterest(w.mgrA, one.enquiry.id, shared.id);
    await addInterest(w.mgrA, two.enquiry.id, shared.id);

    const rows = await linkedForEnquiry(w.mgrA, one.enquiry.id);
    expect(ids(rows)).toEqual([one.bookedUnitId, shared.id].sort());

    // Across the client (BOTH of its enquiries) the shared unit is STILL one row carrying both references.
    const converted = await convert(w, one.enquiry.id);
    expect(converted.status).toBe(200);
    const clientRows = await rowsFor(() => linkedForClient(w.mgrA, converted.body.data.client.id));
    expect(ids(clientRows)).toEqual([one.bookedUnitId, two.bookedUnitId, shared.id].sort());
    const sharedRow = clientRows.find((r) => r.id === shared.id);
    expect(sharedRow?.via.map((v) => v.id).sort()).toEqual([one.enquiry.id, two.enquiry.id].sort());
  });

  it('a CONVERTED enquiry still resolves its linked units, and so does its client', async () => {
    const w = await unitWorld(app);
    const { enquiry, bookedUnitId } = await bookedEnquiry(app, w);
    const converted = await convert(w, enquiry.id);
    expect(converted.status).toBe(200);

    expect(ids(await linkedForEnquiry(w.mgrA, enquiry.id))).toEqual([bookedUnitId]);
    expect(ids(await linkedForClient(w.mgrA, converted.body.data.client.id))).toEqual([bookedUnitId]);
  });

  it('a booking made through the enquiry links the unit, so the client keeps it after conversion', async () => {
    const w = await unitWorld(app);
    const e = await negotiationEnquiry(app, w);
    const u = await mkUnit(app, w.mgrA);
    const booking = await mkBooking(app, w.mgrA, { unitId: u.id, enquiryId: e.id }); // throws unless 201
    expect(booking.id).toBeTruthy();

    const rows = await rowsFor(() => linkedForEnquiry(w.mgrA, e.id));
    expect(ids(rows)).toEqual([u.id]);
    expect(rows[0]?.state).toBe('BOOKED');
    // A booking carries no client id when made before the person became a client — the (person, branch)
    // identity is what finds it again.
    expect(ids(await linkedForClient(w.mgrA, (await convert(w, e.id)).body.data.client.id))).toEqual([u.id]);
  });

  it('preserves branch isolation: another branch\'s unit is never linked, and an unseen enquiry is a 404', async () => {
    const w = await unitWorld(app);
    const e = await readyEnquiry(app, w);
    const foreign = await mkUnit(app, w.mgrB);
    // Even an ALL-scope admin only ever sees what THIS enquiry actually links.
    expect(ids(await linkedForEnquiry(w.admin, e.id))).not.toContain(foreign.id);
    expect(ids(await linkedForEnquiry(w.mgrA, e.id))).toEqual([]);

    // A branch manager cannot read another branch's enquiry at all — 404, never an empty list.
    const theirs = await mkEnquiry(app, w.mgrB);
    expect((await get(w.mgrA, `/enquiries/${theirs.id}/units`)).status).toBe(404);
    expect((await get(w.mgrB, `/enquiries/${theirs.id}/units`)).status).toBe(200);
  });

  it('says "no permission" (null) rather than "no units" ([]) when the caller may not view units', async () => {
    const w = await unitWorld(app);
    const e = await readyEnquiry(app, w);
    const u = await mkUnit(app, w.mgrA);
    await addInterest(w.mgrA, e.id, u.id);

    await revoke('MANAGER', 'units.view');
    expect(await linkedForEnquiry(w.mgrA, e.id)).toBeNull();
    await grant('MANAGER', 'units.view');
    expect(ids(await linkedForEnquiry(w.mgrA, e.id))).toEqual([u.id]);
  });

  it('needs enquiries.view to resolve linked units, and clients.view for the client path', async () => {
    const w = await unitWorld(app);
    const e = await readyEnquiry(app, w);
    await revoke('MANAGER', 'enquiries.view');
    expect((await get(w.mgrA, `/enquiries/${e.id}/units`)).status).toBe(403);
    await grant('MANAGER', 'enquiries.view');
    expect((await get(w.mgrA, `/enquiries/${e.id}/units`)).status).toBe(200);

    const client = (await createClientApi(app, w.mgrA, { person: person('Fresh Person') })).body.data as { id: string };
    await revoke('MANAGER', 'clients.view');
    expect((await get(w.mgrA, `/clients/${client.id}/units`)).status).toBe(403);
    await grant('MANAGER', 'clients.view');
    expect((await get(w.mgrA, `/clients/${client.id}/units`)).status).toBe(200);
  });

  it('a client with no enquiries resolves to an empty list, not every branch unit', async () => {
    const w = await unitWorld(app);
    const client = (await createClientApi(app, w.mgrA, { person: person('No Enquiries Yet') })).body.data as { id: string };
    await mkUnit(app, w.mgrA); // same branch, linked to nobody
    expect(await linkedForClient(w.mgrA, client.id)).toEqual([]);
  });

  it('a client of another branch is a 404 for this manager, and its units never leak', async () => {
    const w = await unitWorld(app);
    const client = (await createClientApi(app, w.mgrB, { person: person('Other Branch') })).body.data as { id: string };
    expect((await get(w.mgrA, `/clients/${client.id}/units`)).status).toBe(404);
  });
});
