import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { systemRepo } from '../../core/scope/system';
import { recordActivity } from '../../core/activity/activity.service';
import { Role } from '../roles/role.model';
import { actor, Activities, AuditLogs, login, makeUser, seedAll, Users } from '../../test/factories';
import { api, createClientApi, createPersonApi, freshPhone, grant, lookup, peopleWorld, revoke } from '../../test/people';
import { useTestDb } from '../../test/db';
import { Master } from '../masters/master.model';
import { Person } from '../persons/person.model';
import { Client } from './client.model';

const app = buildApp();
const Clients = systemRepo(Client, 'test', 'fixtures');
const People = systemRepo(Person, 'test', 'fixtures');
const Masters = systemRepo(Master, 'test', 'fixtures');

useTestDb();
beforeEach(seedAll);

type W = Awaited<ReturnType<typeof peopleWorld>>;
const person = (name: string, phone = freshPhone()) => ({ name, phone });
const mk = async (who: { auth: Record<string, string> }, name: string, extra: Record<string, unknown> = {}, phone = freshPhone()) => {
  const res = await createClientApi(app, who, { person: person(name, phone), ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; clientNo: string; personId: string; branchId: string };
};
const category = async (w: W, label: string) => (await request(app).post(api('/masters/CLIENT_CATEGORY')).set(w.admin.auth).send({ label })).body.data._id as string;
const names = (res: request.Response) => (res.body.data as { name: string }[]).map((c) => c.name);

describe('creating a client', () => {
  it('creates identity + client together, with a generated client number, in the actor\'s branch', async () => {
    const w = await peopleWorld(app);
    const res = await createClientApi(app, w.mgrA, { person: { name: 'Raj Kumar', phone: '98765 43210', email: 'raj@x.com', address: '1 Main Rd' }, notes: 'Prefers calls after 6pm' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ clientNo: 'CL-000001', name: 'Raj Kumar', phone: '+91 98765 43210', phoneE164: '+919876543210', branchId: w.A, branch: { code: 'A' }, notes: 'Prefers calls after 6pm', isArchived: false });
    expect(res.body.data.id).not.toBe(res.body.data.clientNo); // human id is not the ObjectId
    expect(await People.countDocuments()).toBe(1);
    expect((await People.findOne({}).lean())!.branchIds!.map(String)).toEqual([w.A]);
  });

  it('records audit and a timeline activity referencing BOTH the client and the person', async () => {
    const w = await peopleWorld(app);
    const c = await mk(w.mgrA, 'Raj Kumar');
    const audit = await AuditLogs.findOne({ entityType: 'client', action: 'create' }).lean();
    expect(String(audit!.entityId)).toBe(c.id);
    expect(String(audit!.branchId)).toBe(w.A);
    const act = await Activities.findOne({ type: 'CLIENT_CREATED' }).lean();
    expect(act!.refs.map((r) => `${r.type}:${r.id}`).sort()).toEqual([`client:${c.id}`, `person:${c.personId}`].sort());
    expect(String(act!.branchId)).toBe(w.A);
  });

  it('validates input strictly (phone, shape, unknown/immutable fields)', async () => {
    const w = await peopleWorld(app);
    const bad: Record<string, unknown>[] = [
      {}, { person: { name: 'Raj', phone: 'abc' } }, { person: { name: 'R', phone: '9876543210' } },
      { personId: new Types.ObjectId().toHexString(), person: person('Raj') }, // both
      { personId: 'not-an-id' }, { person: person('Raj'), clientNo: 'CL-9' }, { person: person('Raj'), branchIds: [] },
      { person: person('Raj'), categoryId: 'x' }, { person: person('Raj'), notes: 'x'.repeat(2001) }, { person: person('Raj'), isArchived: true },
    ];
    for (const b of bad) expect((await createClientApi(app, w.mgrA, b)).status, JSON.stringify(b)).toBe(400);
    expect(await Clients.countDocuments()).toBe(0);
    expect(await People.countDocuments()).toBe(0);
  });

  it('refuses a duplicate phone: shows the existing person (409 PERSON_EXISTS), creates nothing, merges nothing', async () => {
    const w = await peopleWorld(app);
    const first = await mk(w.mgrA, 'Raj Kumar', {}, '9876543210');
    const res = await createClientApi(app, w.mgrA, { person: { name: 'Different Name', phone: '+91 98765-43210' } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PERSON_EXISTS');
    expect(res.body.error.details).toMatchObject({ status: 'VISIBLE_MATCH', person: { name: 'Raj Kumar' }, clients: [{ id: first.id, clientNo: first.clientNo }] });
    expect(await People.countDocuments()).toBe(1);
    expect(await Clients.countDocuments()).toBe(1);
    expect((await People.findOne({}).lean())!.name).toBe('Raj Kumar');
  });

  it('"use this person" (personId) is the explicit confirmation; a second client for the same person+branch is refused', async () => {
    const w = await peopleWorld(app);
    const p = (await createPersonApi(app, w.mgrA, person('Raj Kumar'))).body.data;
    const ok = await createClientApi(app, w.salesA, { personId: p.id });
    expect(ok.status).toBe(201);
    expect(ok.body.data.personId).toBe(p.id);
    const again = await createClientApi(app, w.mgrA, { personId: p.id });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CLIENT_EXISTS');
    expect(again.body.error.details).toMatchObject({ clientNo: ok.body.data.clientNo });
    expect(await People.countDocuments()).toBe(1);
  });

  it('a person the caller cannot see cannot be used by id, and the answer matches a non-existent id (no oracle)', async () => {
    const w = await peopleWorld(app);
    const p = (await createPersonApi(app, w.mgrA, person('Raj Kumar'))).body.data;
    const foreign = await createClientApi(app, w.mgrB, { personId: p.id });
    const missing = await createClientApi(app, w.mgrB, { personId: new Types.ObjectId().toHexString() });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error).toEqual(missing.body.error);
    expect(await Clients.countDocuments()).toBe(0);
  });

  it('a phone held only by another branch: 409 existence-only; after an authorized link both branches share ONE person with separate client records', async () => {
    const w = await peopleWorld(app);
    const a = await mk(w.mgrA, 'Secret Sam', { notes: 'A-only note' }, '9876543210');
    const blocked = await createClientApi(app, w.mgrB, { person: person('Sam', '9876543210') });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details).toEqual({ status: 'HIDDEN_MATCH', phoneE164: '+919876543210', canLink: true });
    expect(JSON.stringify(blocked.body)).not.toMatch(/Secret|A-only/);

    await request(app).post(api('/persons/link')).set(w.mgrB.auth).send({ phone: '9876543210', reason: 'Sam relocated' });
    const lookupB = (await lookup(app, w.mgrB, '9876543210')).body.data;
    expect(lookupB.status).toBe('VISIBLE_MATCH');
    expect(lookupB.clients).toEqual([]); // B can see the person, but NOT A's client relationship
    const b = await createClientApi(app, w.mgrB, { personId: lookupB.person.id, notes: 'B-only note' });
    expect(b.status).toBe(201);

    expect(await People.countDocuments()).toBe(1); // one identity
    expect(await Clients.countDocuments()).toBe(2); // two branch relationships
    expect(new Set([a.clientNo, b.body.data.clientNo]).size).toBe(2);
    expect((await People.findOne({}).lean())!.branchIds!.map(String).sort()).toEqual([w.A, w.B].sort());

    // each branch sees only its own relationship, and none of the other branch's notes
    const listB = await request(app).get(api('/clients')).set(w.mgrB.auth);
    expect(listB.body.data).toHaveLength(1);
    expect(JSON.stringify(listB.body)).not.toMatch(/A-only/);
    const detailB = await request(app).get(api(`/clients/${b.body.data.id}`)).set(w.mgrB.auth);
    expect(detailB.body.data.relationships).toEqual([]);
    expect(JSON.stringify(detailB.body)).not.toMatch(/A-only/); // B sees the (linked) person, never A's relationship data
    // ALL scope sees how the person is related across branches
    const detailAll = await request(app).get(api(`/clients/${b.body.data.id}`)).set(w.admin.auth);
    expect(detailAll.body.data.relationships.map((r: { clientNo: string }) => r.clientNo)).toEqual([a.clientNo]);
  });

  it('OWN-scope creators own what they create; ALL scope must choose a branch; nobody can create outside their branches', async () => {
    const w = await peopleWorld(app);
    const c = await createClientApi(app, w.salesA, { person: person('Mine') });
    expect(c.body.data).toMatchObject({ assignedTo: w.salesA.user._id.toHexString(), assignedToName: 'SALES_EXECUTIVE' });
    expect((await createClientApi(app, w.admin, { person: person('No Branch') })).status).toBe(400);
    expect((await createClientApi(app, w.admin, { person: person('Admin Made'), branchId: w.B })).status).toBe(201);
    expect((await createClientApi(app, w.mgrA, { person: person('Wrong Branch'), branchId: w.B })).status).toBe(403);
  });

  it('needs clients.create', async () => {
    const w = await peopleWorld(app);
    await revoke('SALES_EXECUTIVE', 'clients.create');
    expect((await createClientApi(app, w.salesA, { person: person('Nope') })).status).toBe(403);
    expect((await request(app).post(api('/clients')).send({})).status).toBe(401);
  });
});

describe('client numbers', () => {
  it('are sequential, human-readable and unique', async () => {
    const w = await peopleWorld(app);
    const nos = [(await mk(w.mgrA, 'One A')).clientNo, (await mk(w.mgrB, 'Two B')).clientNo, (await mk(w.mgrA, 'Three C')).clientNo];
    expect(nos).toEqual(['CL-000001', 'CL-000002', 'CL-000003']);
  });

  it('are unique and contiguous under concurrent creation (20 parallel creators, two branches)', async () => {
    const w = await peopleWorld(app);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => createClientApi(app, i % 2 ? w.mgrA : w.mgrB, { person: person(`Parallel ${i}`) })));
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(201));
    const nos = results.map((r) => r.body.data.clientNo as string).sort();
    expect(new Set(nos).size).toBe(20);
    expect(nos).toEqual(Array.from({ length: 20 }, (_, i) => `CL-${String(i + 1).padStart(6, '0')}`));
    expect(await Clients.countDocuments()).toBe(20);
  });

  it('concurrent creation for the SAME phone yields one person and one client; the rest are clean 409s', async () => {
    const w = await peopleWorld(app);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => createClientApi(app, i % 2 ? w.mgrA : w.salesA, { person: person(`Racer ${i}`, ['9876543210', '+919876543210', '09876543210'][i % 3]) })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of results.filter((r) => r.status !== 201)) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('PERSON_EXISTS');
    }
    expect(await People.countDocuments()).toBe(1);
    expect(await Clients.countDocuments()).toBe(1);
    expect(await Activities.countDocuments({ type: 'CLIENT_CREATED' })).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'client', action: 'create' })).toBe(1);
  });

  it('concurrent "use this person" for the same person and branch creates exactly one client', async () => {
    const w = await peopleWorld(app);
    const p = (await createPersonApi(app, w.mgrA, person('Raj Kumar'))).body.data;
    const results = await Promise.all(Array.from({ length: 8 }, () => createClientApi(app, w.mgrA, { personId: p.id })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'CLIENT_EXISTS')).toBe(true);
    expect(await Clients.countDocuments()).toBe(1);
  });

  it('cannot be set or changed by clients, and the database enforces uniqueness', async () => {
    const w = await peopleWorld(app);
    const c = await mk(w.mgrA, 'Raj Kumar');
    expect((await request(app).patch(api(`/clients/${c.id}`)).set(w.mgrA.auth).send({ clientNo: 'CL-999999' })).status).toBe(400);
    await Clients.updateOne({ _id: c.id }, { clientNo: 'CL-999999' }); // immutable at the schema level
    expect((await Clients.findOne({ _id: c.id }).lean())!.clientNo).toBe('CL-000001');
    await expect(Clients.create({ clientNo: 'CL-000001', personId: new Types.ObjectId(), branchId: new Types.ObjectId(), personName: 'x', phoneE164: '+919876543210' })).rejects.toMatchObject({ code: 11000 });
  });
});

describe('client category (master-driven)', () => {
  it('accepts an active category on create and update; shows its label and colour state', async () => {
    const w = await peopleWorld(app);
    const gold = await category(w, 'Gold');
    const c = await mk(w.mgrA, 'Raj Kumar', { categoryId: gold });
    const detail = await request(app).get(api(`/clients/${c.id}`)).set(w.mgrA.auth);
    expect(detail.body.data.category).toMatchObject({ label: 'Gold', isActive: true });
    const silver = await category(w, 'Silver');
    const upd = await request(app).patch(api(`/clients/${c.id}`)).set(w.mgrA.auth).send({ categoryId: silver });
    expect(upd.body.data.category.label).toBe('Silver');
    expect((await request(app).patch(api(`/clients/${c.id}`)).set(w.mgrA.auth).send({ categoryId: null })).body.data.categoryId).toBeUndefined();
  });

  it('rejects inactive, unknown, malformed and wrong-type categories for NEW records and changes', async () => {
    const w = await peopleWorld(app);
    const old = await category(w, 'Retired');
    await request(app).patch(api(`/masters/CLIENT_CATEGORY/${old}`)).set(w.admin.auth).send({ isActive: false });
    const source = (await request(app).post(api('/masters/ENQUIRY_SOURCE')).set(w.admin.auth).send({ label: 'Web' })).body.data._id;
    const c = await mk(w.mgrA, 'Raj Kumar');
    for (const categoryId of [old, new Types.ObjectId().toHexString(), source]) {
      const res = await createClientApi(app, w.mgrA, { person: person('Someone'), categoryId });
      expect(res.status, categoryId).toBe(400);
      expect(res.body.error.details[0].path).toBe('categoryId');
      expect((await request(app).patch(api(`/clients/${c.id}`)).set(w.mgrA.auth).send({ categoryId })).status).toBe(400);
    }
    expect((await request(app).patch(api(`/clients/${c.id}`)).set(w.mgrA.auth).send({ categoryId: 'garbage' })).status).toBe(400);
    expect(await Clients.countDocuments()).toBe(1);
  });

  it('HISTORY: a category deactivated later still displays on existing clients, and an untouched client can still be edited', async () => {
    const w = await peopleWorld(app);
    const gold = await category(w, 'Gold');
    const c = await mk(w.mgrA, 'Raj Kumar', { categoryId: gold });
    await request(app).patch(api(`/masters/CLIENT_CATEGORY/${gold}`)).set(w.admin.auth).send({ isActive: false });

    const detail = await request(app).get(api(`/clients/${c.id}`)).set(w.mgrA.auth);
    expect(detail.body.data.category).toMatchObject({ label: 'Gold', isActive: false });
    const list = await request(app).get(api('/clients')).set(w.mgrA.auth);
    expect(list.body.data[0].category).toMatchObject({ label: 'Gold', isActive: false });
    // editing other fields, or re-saving the same category, is fine; only CHOOSING an inactive one is not
    expect((await request(app).patch(api(`/clients/${c.id}`)).set(w.mgrA.auth).send({ notes: 'still fine' })).status).toBe(200);
    expect((await request(app).patch(api(`/clients/${c.id}`)).set(w.mgrA.auth).send({ categoryId: gold })).status).toBe(200);
    expect((await createClientApi(app, w.mgrA, { person: person('New'), categoryId: gold })).status).toBe(400);
  });

  it('master reference protection: a category in use cannot be deleted (any branch, even archived clients); an unused one can', async () => {
    const w = await peopleWorld(app);
    const used = await category(w, 'Used');
    const unused = await category(w, 'Unused');
    const c = await mk(w.mgrB, 'Raj Kumar', { categoryId: used });
    const del = (id: string) => request(app).delete(api(`/masters/CLIENT_CATEGORY/${id}`)).set(w.admin.auth);
    const blocked = await del(used);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('IN_USE');
    await request(app).delete(api(`/clients/${c.id}`)).set(w.mgrB.auth); // archive the only user
    expect((await del(used)).body.error.code).toBe('IN_USE'); // archived history still counts
    expect((await del(unused)).status).toBe(204); // a checker is registered, so provably-unused values CAN go
    expect(await Masters.countDocuments({ _id: unused })).toBe(0);
    // once the client no longer references it, deleting is allowed
    await request(app).patch(api(`/clients/${c.id}`)).set(w.admin.auth).send({ categoryId: null });
  });

  it('records a category change in audit (as category_changed) and on the timeline', async () => {
    const w = await peopleWorld(app);
    const gold = await category(w, 'Gold');
    const silver = await category(w, 'Silver');
    const c = await mk(w.mgrA, 'Raj Kumar', { categoryId: gold });
    await request(app).patch(api(`/clients/${c.id}`)).set(w.mgrA.auth).send({ categoryId: silver });
    const row = await AuditLogs.findOne({ entityType: 'client', action: 'category_changed' }).lean();
    expect(row!.changes).toMatchObject({ categoryId: { from: gold, to: silver } });
    expect(await Activities.countDocuments({ type: 'CLIENT_UPDATED' })).toBe(1);
  });
});

describe('updating and archiving', () => {
  it('updates relationship fields; identity, branch, person and number are not accepted', async () => {
    const w = await peopleWorld(app);
    const c = await mk(w.mgrA, 'Raj Kumar');
    const ok = await request(app).patch(api(`/clients/${c.id}`)).set(w.mgrA.auth).send({ notes: 'VIP' });
    expect(ok.body.data.notes).toBe('VIP');
    expect((await request(app).patch(api(`/clients/${c.id}`)).set(w.mgrA.auth).send({ notes: null })).body.data.notes).toBeUndefined();
    for (const bad of [{}, { name: 'Hacked' }, { branchId: w.B }, { personId: new Types.ObjectId().toHexString() }, { phoneE164: '+1' }, { isArchived: true }]) {
      expect((await request(app).patch(api(`/clients/${c.id}`)).set(w.mgrA.auth).send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    const audits = await AuditLogs.find({ entityType: 'client', action: 'update' }).sort({ at: 1, _id: 1 }).lean();
    expect(audits.map((a) => a.changes)).toMatchObject([{ notes: { to: 'VIP' } }, { notes: { from: 'VIP' } }]);
  });

  it('assignee must be an active user of the client\'s branch; OWN users can only pick themselves', async () => {
    const w = await peopleWorld(app);
    const c = await mk(w.mgrA, 'Raj Kumar');
    await grant('MANAGER', 'users.view');
    const inactive = await makeUser({ roleKey: 'SALES_EXECUTIVE', branches: [w.A], isActive: false });
    const other = await makeUser({ roleKey: 'SALES_EXECUTIVE', branches: [w.A] });
    const patch = (who: { auth: Record<string, string> }, assignedTo: string | null) => request(app).patch(api(`/clients/${c.id}`)).set(who.auth).send({ assignedTo });
    expect((await patch(w.mgrA, w.salesA.user._id.toHexString())).body.data.assignedToName).toBe('SALES_EXECUTIVE');
    expect((await patch(w.mgrA, other.user._id.toHexString())).status).toBe(200);
    expect((await patch(w.mgrA, inactive.user._id.toHexString())).status).toBe(400);
    expect((await patch(w.mgrA, w.salesB.user._id.toHexString())).status).toBe(400); // other branch
    expect((await patch(w.mgrA, new Types.ObjectId().toHexString())).status).toBe(400);
    // an OWN-scope user may not hand a client to someone else
    await request(app).patch(api(`/clients/${c.id}`)).set(w.mgrA.auth).send({ assignedTo: w.salesA.user._id.toHexString() });
    expect((await patch(w.salesA, other.user._id.toHexString())).status).toBe(403);
  });

  it('archive is a soft delete: hidden by default, listed on request, readable, re-creatable, audited', async () => {
    const w = await peopleWorld(app);
    const c = await mk(w.mgrA, 'Raj Kumar', {}, '9876543210');
    expect((await request(app).delete(api(`/clients/${c.id}`)).set(w.salesA.auth)).status).toBe(403); // no clients.archive
    expect((await request(app).delete(api(`/clients/${c.id}`)).set(w.mgrA.auth)).status).toBe(204);
    expect((await request(app).get(api('/clients')).set(w.mgrA.auth)).body.data).toHaveLength(0);
    expect((await request(app).get(api('/clients?isArchived=true')).set(w.mgrA.auth)).body.data).toHaveLength(1);
    const detail = await request(app).get(api(`/clients/${c.id}`)).set(w.mgrA.auth);
    expect(detail.body.data.isArchived).toBe(true);
    expect(await Clients.countDocuments({ isArchived: true })).toBe(1); // nothing was destroyed
    expect((await request(app).delete(api(`/clients/${c.id}`)).set(w.mgrA.auth)).status).toBe(404); // already archived
    expect((await request(app).patch(api(`/clients/${c.id}`)).set(w.mgrA.auth).send({ notes: 'x' })).status).toBe(404); // archived clients are read-only
    expect(await AuditLogs.countDocuments({ entityType: 'client', action: 'archive' })).toBe(1);
    expect(await Activities.countDocuments({ type: 'CLIENT_ARCHIVED' })).toBe(1);

    // the same person can become a client of the same branch again (a new relationship, new number)
    const again = await createClientApi(app, w.mgrA, { personId: c.personId });
    expect(again.status).toBe(201);
    expect(again.body.data.clientNo).not.toBe(c.clientNo);
  });
});

describe('listing and search (server-side, scoped)', () => {
  async function seedList(w: W) {
    for (const [n, p] of [['Anand Kumar', '9811111111'], ['Bhavna Rao', '9822222222'], ['Chitra Iyer', '9833333333'], ['anand Raj', '9844444444'], ['Deepak Shah', '9855555555']] as const) await mk(w.mgrA, n, {}, p);
    await mk(w.mgrB, 'Anand In B', {}, '9866666666');
  }

  it('paginates on the server with totals, and caps page size', async () => {
    const w = await peopleWorld(app);
    await seedList(w);
    const p1 = await request(app).get(api('/clients?limit=2&page=1&sort=personName')).set(w.mgrA.auth);
    expect(names(p1)).toEqual(['Anand Kumar', 'anand Raj']);
    expect(p1.body.meta).toEqual({ page: 1, limit: 2, total: 5 });
    expect(names(await request(app).get(api('/clients?limit=2&page=3&sort=personName')).set(w.mgrA.auth))).toEqual(['Deepak Shah']);
    expect((await request(app).get(api('/clients?limit=101')).set(w.mgrA.auth)).status).toBe(400);
    expect((await request(app).get(api('/clients?page=0')).set(w.mgrA.auth)).status).toBe(400);
  });

  it('sorts by name (case-insensitively), number and date; ignores unknown sort fields', async () => {
    const w = await peopleWorld(app);
    await seedList(w);
    expect(names(await request(app).get(api('/clients?sort=personName')).set(w.mgrA.auth))).toEqual(['Anand Kumar', 'anand Raj', 'Bhavna Rao', 'Chitra Iyer', 'Deepak Shah'].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase())));
    expect(names(await request(app).get(api('/clients?sort=-clientNo')).set(w.mgrA.auth))[0]).toBe('Deepak Shah');
    expect((await request(app).get(api('/clients?sort=passwordHash')).set(w.mgrA.auth)).status).toBe(200);
  });

  it('searches by name (partial, any case)', async () => {
    const w = await peopleWorld(app);
    await seedList(w);
    expect(names(await request(app).get(api('/clients?search=ANAND&sort=personName')).set(w.mgrA.auth))).toEqual(['Anand Kumar', 'anand Raj']);
    expect(names(await request(app).get(api('/clients?search=rao')).set(w.mgrA.auth))).toEqual(['Bhavna Rao']);
    expect((await request(app).get(api('/clients?search=zzz')).set(w.mgrA.auth)).body.data).toEqual([]);
  });

  it('searches by phone in any notation, including partial digits', async () => {
    const w = await peopleWorld(app);
    await seedList(w);
    for (const q of ['9822222222', '98222 22222', '+91 98222 22222', '82222', '2222222']) {
      expect(names(await request(app).get(api(`/clients?search=${encodeURIComponent(q)}`)).set(w.mgrA.auth)), q).toEqual(['Bhavna Rao']);
    }
  });

  it('searches by client number', async () => {
    const w = await peopleWorld(app);
    await seedList(w);
    expect(names(await request(app).get(api('/clients?search=CL-000003')).set(w.mgrA.auth))).toEqual(['Chitra Iyer']);
    expect(names(await request(app).get(api('/clients?search=cl-00000')).set(w.mgrA.auth)).length).toBe(5); // prefix, scoped to A (B's is CL-000006)
  });

  it('treats search text literally (regex characters cannot break or widen the query)', async () => {
    const w = await peopleWorld(app);
    await seedList(w);
    for (const q of ['.*', '(', '[a-z]+', '\\', 'a|b', '^', '$']) {
      const res = await request(app).get(api(`/clients?search=${encodeURIComponent(q)}`)).set(w.mgrA.auth);
      expect(res.status, q).toBe(200);
      expect(res.body.data, q).toEqual([]);
    }
  });

  it('filters by category and assignee', async () => {
    const w = await peopleWorld(app);
    const gold = await category(w, 'Gold');
    await mk(w.mgrA, 'Goldie One', { categoryId: gold });
    await mk(w.mgrA, 'Plain Two');
    const mine = await mk(w.salesA, 'Owned By Sales');
    expect(names(await request(app).get(api(`/clients?categoryId=${gold}`)).set(w.mgrA.auth))).toEqual(['Goldie One']);
    expect(names(await request(app).get(api(`/clients?assignedTo=${w.salesA.user._id}`)).set(w.mgrA.auth))).toEqual(['Owned By Sales']);
    void mine;
  });

  it('search and counts never leak other branches; narrowing cannot widen; ALL scope sees all', async () => {
    const w = await peopleWorld(app);
    await seedList(w);
    expect(names(await request(app).get(api('/clients?search=Anand&sort=personName')).set(w.mgrA.auth))).not.toContain('Anand In B');
    expect(names(await request(app).get(api('/clients?search=9866666666')).set(w.mgrA.auth))).toEqual([]);
    expect(names(await request(app).get(api('/clients?search=CL-000006')).set(w.mgrA.auth))).toEqual([]);
    expect((await request(app).get(api('/clients')).set(w.mgrA.auth)).body.meta.total).toBe(5);
    expect((await request(app).get(api(`/clients?branchId=${w.B}`)).set(w.mgrA.auth)).status).toBe(403);
    expect((await request(app).get(api('/clients')).set(w.admin.auth)).body.meta.total).toBe(6);
    expect(names(await request(app).get(api(`/clients?branchId=${w.B}`)).set(w.admin.auth))).toEqual(['Anand In B']);
  });
});

describe('data scope and branch isolation', () => {
  it('OWN scope sees only clients assigned to them', async () => {
    const w = await peopleWorld(app);
    await mk(w.salesA, 'Mine');
    await mk(w.mgrA, 'Branch Colleague Client'); // unassigned
    const otherSales = await actor(app, 'SALES_EXECUTIVE', [w.A]);
    await mk(otherSales, 'Someone Elses');
    expect(names(await request(app).get(api('/clients')).set(w.salesA.auth))).toEqual(['Mine']);
    expect((await request(app).get(api('/clients')).set(w.mgrA.auth)).body.meta.total).toBe(3);
  });

  it('another branch (or another employee under OWN) gets 404 for read, update and archive by id, and nothing changes', async () => {
    const w = await peopleWorld(app);
    const c = await mk(w.mgrA, 'Raj Kumar');
    for (const who of [w.mgrB, w.salesB, w.salesA]) {
      expect((await request(app).get(api(`/clients/${c.id}`)).set(who.auth)).status).toBe(404);
      expect((await request(app).patch(api(`/clients/${c.id}`)).set(who.auth).send({ notes: 'HACKED' })).status).toBe(404);
    }
    await grant('SALES_EXECUTIVE', 'clients.archive');
    expect((await request(app).delete(api(`/clients/${c.id}`)).set(w.salesB.auth)).status).toBe(404);
    expect((await request(app).delete(api(`/clients/${c.id}`)).set(w.mgrB.auth)).status).toBe(404);
    const row = await Clients.findOne({ _id: c.id }).lean();
    expect(row).toMatchObject({ isArchived: false });
    expect(row!.notes).toBeUndefined();
    // a made-up id is indistinguishable
    const ghost = await request(app).get(api(`/clients/${new Types.ObjectId()}`)).set(w.mgrB.auth);
    expect((await request(app).get(api(`/clients/${c.id}`)).set(w.mgrB.auth)).body.error).toEqual(ghost.body.error);
  });

  it('a client cannot be moved to another branch (branch is immutable), even by direct database-layer attempts', async () => {
    const w = await peopleWorld(app);
    const c = await mk(w.mgrA, 'Raj Kumar');
    await Clients.updateOne({ _id: c.id }, { branchId: new Types.ObjectId(w.B) });
    expect(String((await Clients.findOne({ _id: c.id }).lean())!.branchId)).toBe(w.A);
  });

  it('a list never exposes ids or details of other branches\' people in relationships', async () => {
    const w = await peopleWorld(app);
    await mk(w.mgrA, 'Raj Kumar', {}, '9876543210');
    await request(app).post(api('/persons/link')).set(w.mgrB.auth).send({ phone: '9876543210', reason: 'relocated' });
    const p = (await lookup(app, w.mgrB, '9876543210')).body.data.person;
    const b = (await createClientApi(app, w.mgrB, { personId: p.id })).body.data;
    const detail = await request(app).get(api(`/clients/${b.id}`)).set(w.mgrB.auth);
    expect(detail.body.data.person.branchIds).toEqual([w.B]); // never the other branch's id
    expect(JSON.stringify(detail.body)).not.toContain(w.A);
  });
});

describe('client timeline (activity authorizer)', () => {
  const timeline = (who: { auth: Record<string, string> }, id: string) => request(app).get(api(`/activities?refType=client&refId=${id}`)).set(who.auth);

  it('is readable by those who can see the client, and shows its events', async () => {
    const w = await peopleWorld(app);
    const c = await mk(w.mgrA, 'Raj Kumar');
    await request(app).patch(api(`/clients/${c.id}`)).set(w.mgrA.auth).send({ assignedTo: w.salesA.user._id.toHexString() });
    const res = await timeline(w.mgrA, c.id);
    expect(res.status).toBe(200);
    expect(res.body.data.map((a: { type: string }) => a.type).sort()).toEqual(['CLIENT_CREATED', 'CLIENT_UPDATED']);
    expect((await timeline(w.salesA, c.id)).status).toBe(200); // now assigned to them
    expect((await timeline(w.admin, c.id)).body.data).toHaveLength(2);
  });

  it('cannot be opened by guessing the id: another branch, an unassigned OWN user and a made-up id all get the same 404', async () => {
    const w = await peopleWorld(app);
    const c = await mk(w.mgrA, 'Raj Kumar');
    const ghost = await timeline(w.mgrB, new Types.ObjectId().toHexString());
    for (const who of [w.mgrB, w.salesB, w.salesA]) {
      const res = await timeline(who, c.id);
      expect(res.status).toBe(404);
      expect(res.body.error).toEqual(ghost.body.error);
    }
  });

  it('even a viewer of the client only sees events recorded in branches they can access', async () => {
    const w = await peopleWorld(app);
    const c = await mk(w.mgrA, 'Raj Kumar');
    await recordActivity({ type: 'CLIENT_UPDATED', description: 'event in branch B', branchId: w.B, refs: [{ type: 'client', id: c.id }] });
    expect((await timeline(w.mgrA, c.id)).body.data.map((a: { description: string }) => a.description)).not.toContain('event in branch B');
    expect((await timeline(w.admin, c.id)).body.data.map((a: { description: string }) => a.description)).toContain('event in branch B');
  });

  it('requires activities.view as well', async () => {
    const w = await peopleWorld(app);
    const c = await mk(w.mgrA, 'Raj Kumar');
    await revoke('MANAGER', 'activities.view');
    expect((await timeline(w.mgrA, c.id)).status).toBe(403);
  });
});

describe('RBAC on client endpoints', () => {
  it('401 without a token; 403 without the specific permission', async () => {
    const w = await peopleWorld(app);
    const c = await mk(w.mgrA, 'Raj Kumar');
    for (const [m, p] of [['get', '/clients'], ['get', `/clients/${c.id}`], ['post', '/clients'], ['patch', `/clients/${c.id}`], ['delete', `/clients/${c.id}`]] as const) {
      expect((await (request(app) as never as Record<string, (u: string) => request.Test>)[m]!(api(p)).send({})).status).toBe(401);
    }
    await revoke('MANAGER', 'clients.view');
    expect((await request(app).get(api('/clients')).set(w.mgrA.auth)).status).toBe(403);
    expect((await request(app).get(api(`/clients/${c.id}`)).set(w.mgrA.auth)).status).toBe(403);
    await revoke('MANAGER', 'clients.edit');
    expect((await request(app).patch(api(`/clients/${c.id}`)).set(w.mgrA.auth).send({ notes: 'x' })).status).toBe(403);
    await revoke('MANAGER', 'clients.archive');
    expect((await request(app).delete(api(`/clients/${c.id}`)).set(w.mgrA.auth)).status).toBe(403);
  });

  it('is permission-based, not role-name-based: a custom role with only clients.view can read but nothing else', async () => {
    const w = await peopleWorld(app);
    const c = await mk(w.mgrA, 'Raj Kumar');
    await request(app).post(api('/roles')).set((await actor(app, 'SUPER_ADMIN')).auth).send({ name: 'Viewer Only', permissions: ['clients.view'], dataScope: 'BRANCH' });
    await Role.updateOne({ name: 'Viewer Only' }, { key: 'VIEWER_ONLY' });
    const u = await makeUser({ roleKey: 'VIEWER_ONLY', branches: [w.A] });
    const l = await login(app, u.email);
    expect((await request(app).get(api(`/clients/${c.id}`)).set(l.auth)).status).toBe(200);
    expect((await createClientApi(app, l, { person: person('X Person') })).status).toBe(403);
    expect((await request(app).post(api('/persons/lookup')).set(l.auth).send({ phone: '9876543210' })).status).toBe(403);
    void Users;
  });
});
