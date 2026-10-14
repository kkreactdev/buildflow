import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { Activities, AuditLogs, seedAll } from '../../test/factories';
import { useTestDb } from '../../test/db';
import { api, bookingWorld, createBookingApi, grant, mkBooking, mkUnit, negotiationEnquiry, revoke, type BW } from '../../test/bookings';
import { createClientApi } from '../../test/people';
import { transition } from '../../test/enquiries';
import { Client } from '../clients/client.model';
import { summary } from '../dashboard/dashboard.service';
import { systemRepo } from '../../core/scope/system';

const app = buildApp();
useTestDb();
beforeEach(seedAll);

type Who = { auth: Record<string, string> };
const convert = (who: Who, id: string, body: Record<string, unknown> = {}) => request(app).post(api(`/enquiries/${id}/convert`)).set(who.auth).send(body);
const detail = (who: Who, id: string) => request(app).get(api(`/enquiries/${id}`)).set(who.auth);
const Clients = systemRepo(Client, 'test', 'fixtures');
let n = 0;
const phone = () => `98${String(70000000 + ++n * 13)}`;

/** An enquiry that has been booked (the stage just before Converted). */
async function booked(w: BW, extra: Record<string, unknown> = {}) {
  const e = await negotiationEnquiry(app, w, extra);
  const unit = await mkUnit(app, w.mgrA);
  await mkBooking(app, w.mgrA, { unitId: unit.id, enquiryId: e.id });
  return e;
}

describe('converting an enquiry to a client', () => {
  it('creates one client from the enquiry, moves it to Converted and links them (new person)', async () => {
    const w = await bookingWorld(app);
    const e = await booked(w, { person: { name: 'Meena Iyer', phone: phone() } });
    expect((await detail(w.mgrA, e.id)).body.data.conversion).toMatchObject({ eligible: true, alreadyConverted: false, stageKey: 'CONVERTED' });

    const res = await convert(w.mgrA, e.id, { notes: 'Converted after booking' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ alreadyConverted: false, createdClient: true, enquiry: { id: e.id, stageCode: 'CONVERTED' }, client: { name: 'Meena Iyer' } });
    expect(res.body.data.client.clientNo).toMatch(/^CL-\d{6}$/);
    expect(await Clients.countDocuments({})).toBe(1);

    const after = (await detail(w.mgrA, e.id)).body.data;
    expect(after.stageCode).toBe('CONVERTED');
    expect(after.conversion).toMatchObject({ eligible: false, alreadyConverted: true, client: { id: res.body.data.client.id } });
    expect(after.stageHistory.at(-1)).toMatchObject({ from: 'BOOKED', to: 'CONVERTED', direction: 'FORWARD' });
    // the client is a normal client: it opens, branch and person match the enquiry
    const client = (await request(app).get(api(`/clients/${res.body.data.client.id}`)).set(w.mgrA.auth)).body.data;
    expect(client).toMatchObject({ branchId: e.branchId, personId: e.personId });
  });

  it('links the existing client of the same phone identity instead of creating a duplicate', async () => {
    const w = await bookingWorld(app);
    const ph = phone();
    const existing = (await createClientApi(app, w.mgrA, { person: { name: 'Meena Iyer', phone: ph } })).body.data;
    expect(existing.id).toBeTruthy();
    // the enquiry is raised for the person who is already a client (explicit personId, as the identity rules require)
    const e = await booked(w, { person: undefined, personId: existing.personId });
    const res = await convert(w.mgrA, e.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ createdClient: false, client: { id: existing.id, clientNo: existing.clientNo } });
    expect(await Clients.countDocuments({})).toBe(1);
    expect((await detail(w.mgrA, e.id)).body.data.conversion.client.id).toBe(existing.id);
  });

  it('is idempotent: converting again changes nothing and writes no second activity or audit entry', async () => {
    const w = await bookingWorld(app);
    const e = await booked(w);
    const first = await convert(w.mgrA, e.id);
    const audits = await AuditLogs.countDocuments({ entityType: 'enquiry', action: 'convert' });
    const activities = await Activities.countDocuments({ type: 'CLIENT_CONVERTED' });
    const again = await convert(w.mgrA, e.id);
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ alreadyConverted: true, createdClient: false, client: { id: first.body.data.client.id } });
    expect(await Clients.countDocuments({})).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'enquiry', action: 'convert' })).toBe(audits);
    expect(await Activities.countDocuments({ type: 'CLIENT_CONVERTED' })).toBe(activities);
  });

  it('two simultaneous conversions create exactly one client and both succeed', async () => {
    const w = await bookingWorld(app);
    const e = await booked(w);
    const [a, b] = await Promise.all([convert(w.mgrA, e.id), convert(w.mgrA, e.id)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await Clients.countDocuments({})).toBe(1);
    expect(a.body.data.client.id).toBe(b.body.data.client.id);
  });

  it('records the audit trail and the activity with references to the enquiry and the client', async () => {
    const w = await bookingWorld(app);
    const e = await booked(w);
    const res = await convert(w.mgrA, e.id);
    const audit = await AuditLogs.findOne({ entityType: 'enquiry', action: 'convert' }).lean();
    expect(audit!.changes).toMatchObject({ stageCode: { from: 'BOOKED', to: 'CONVERTED' } });
    const act = await Activities.findOne({ type: 'CLIENT_CONVERTED' }).lean();
    expect(act!.refs.map((r: { type: string; id: unknown }) => `${r.type}:${String(r.id)}`)).toEqual(expect.arrayContaining([`enquiry:${e.id}`, `client:${res.body.data.client.id}`]));
    expect(await AuditLogs.findOne({ entityType: 'client', action: 'create' }).lean()).toBeTruthy();
  });
});

describe('who and what can be converted', () => {
  it('refuses an enquiry that has not been booked, with a clear 409, and never creates a client', async () => {
    const w = await bookingWorld(app);
    const e = await negotiationEnquiry(app, w); // negotiation, not booked
    const res = await convert(w.mgrA, e.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_CONVERTIBLE');
    expect(res.body.error.message).toMatch(/Booked/);
    expect((await detail(w.mgrA, e.id)).body.data.conversion.eligible).toBe(false);
    expect(await Clients.countDocuments({})).toBe(0);
  });

  it('refuses a lost or archived enquiry', async () => {
    const w = await bookingWorld(app);
    const lost = await negotiationEnquiry(app, w);
    await request(app).post(api(`/enquiries/${lost.id}/lose`)).set(w.mgrA.auth).send({ lostReasonId: w.m.lost });
    expect((await convert(w.mgrA, lost.id)).body.error.code).toBe('ENQUIRY_LOST');
    const archived = await booked(w);
    await request(app).delete(api(`/enquiries/${archived.id}`)).set(w.mgrA.auth);
    expect((await convert(w.mgrA, archived.id)).body.error.code).toBe('ENQUIRY_ARCHIVED');
  });

  it('is not a plain stage move: the Converted stage cannot be entered through the transition endpoint', async () => {
    const w = await bookingWorld(app);
    const e = await booked(w);
    const res = await transition(app, w.mgrA, e.id, { to: 'CONVERTED' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DOMAIN_ONLY');
    expect(await Clients.countDocuments({})).toBe(0);
  });

  it('needs enquiries.convert and clients.create (403 otherwise, and no client is created)', async () => {
    const w = await bookingWorld(app);
    const e = await booked(w);
    await revoke('MANAGER', 'enquiries.convert');
    expect((await convert(w.mgrA, e.id)).status).toBe(403);
    expect((await detail(w.mgrA, e.id)).body.data.conversion.eligible).toBe(false);
    await grant('MANAGER', 'enquiries.convert');
    await revoke('MANAGER', 'clients.create');
    expect((await convert(w.mgrA, e.id)).status).toBe(403);
    expect((await detail(w.mgrA, e.id)).body.data.conversion.eligible).toBe(false);
    expect(await Clients.countDocuments({})).toBe(0);
    expect((await request(app).post(api(`/enquiries/${e.id}/convert`)).send({})).status).toBe(401);
  });

  it('respects branch and ownership scope: another branch and a record owned by someone else are 404', async () => {
    const w = await bookingWorld(app);
    const e = await booked(w);
    expect((await convert(w.mgrB, e.id)).status).toBe(404);
    expect((await convert(w.salesA, e.id)).status).toBe(404); // an OWN-scope executive cannot convert a colleague's enquiry
    expect(await Clients.countDocuments({})).toBe(0);
  });

  it('lets an OWN-scope executive convert their own booked enquiry (the client is created in their branch)', async () => {
    const w = await bookingWorld(app);
    const e = await booked(w, { assignedTo: w.salesA.user._id.toHexString() });
    const res = await convert(w.salesA, e.id);
    expect(res.status).toBe(200);
    expect(res.body.data.createdClient).toBe(true);
    expect((await detail(w.salesA, e.id)).body.data.conversion.client.id).toBe(res.body.data.client.id);
  });

  it('validates the optional body: unknown fields and a non-category master are refused', async () => {
    const w = await bookingWorld(app);
    const e = await booked(w);
    expect((await convert(w.mgrA, e.id, { stage: 'CONVERTED' })).status).toBe(400);
    expect((await convert(w.mgrA, e.id, { categoryId: 'not-an-id' })).status).toBe(400);
    expect((await convert(w.mgrA, e.id, { categoryId: w.m.source })).status).toBe(400); // a source is not a client category
    expect(await Clients.countDocuments({})).toBe(0);
  });

  it('feeds the dashboard: the converted count follows the conversion', async () => {
    const w = await bookingWorld(app);
    const e = await booked(w);
    await convert(w.mgrA, e.id);
    const principal = { userId: w.admin.user._id.toHexString(), permissions: new Set(['*']), dataScope: 'ALL', branchIds: [] } as never;
    const d = await summary(principal, {} as never);
    expect(d.enquiries!.converted).toMatchObject({ value: 1, current: 1 });
  });
});

void createBookingApi;
