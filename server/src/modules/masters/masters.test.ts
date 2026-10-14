import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { AuditLogs, actor, login, makeBranch, makeUser, principalWith, seedAll } from '../../test/factories';
import { useTestDb } from '../../test/db';
import { Role } from '../roles/role.model';
import { Master } from './master.model';
import { assertActiveMaster, masterLabels } from './master.service';
import { MASTER_TYPES } from './masterTypes';
import { clearMasterReferences, registerMasterReference } from './references';
import { systemRepo } from '../../core/scope/system';

const app = buildApp();
const api = (p: string) => `/api/v1${p}`;
const Masters = systemRepo(Master, 'test', 'fixtures');

useTestDb();
beforeEach(async () => {
  clearMasterReferences();
  await seedAll();
});

async function admin() {
  return actor(app, 'ADMIN');
}
async function create(a: { auth: Record<string, string> }, type: string, body: Record<string, unknown>) {
  return request(app).post(api(`/masters/${type}`)).set(a.auth).send(body);
}

describe('master type registry', () => {
  it('lists the canonical types with their rules; enquiry statuses are workflow stages, not a master', async () => {
    const a = await admin();
    const res = await request(app).get(api('/masters/types')).set(a.auth);
    expect(res.status).toBe(200);
    const keys = res.body.data.map((t: { key: string }) => t.key);
    expect(keys).toEqual(expect.arrayContaining(['ENQUIRY_SOURCE', 'LOCATION', 'FOLLOWUP_STATUS', 'UNIT_STATUS', 'ACTIVITY_TYPE', 'WA_CATEGORY', 'WA_EVENT', 'MEDIA_TYPE']));
    expect(keys).not.toContain('ENQUIRY_STATUS');
    expect(new Set(keys).size).toBe(MASTER_TYPES.length);
    expect(res.body.data.find((t: { key: string }) => t.key === 'LOCATION')).toMatchObject({ scope: 'BRANCH' });
    expect(res.body.data.find((t: { key: string }) => t.key === 'ENQUIRY_SOURCE')).toMatchObject({ scope: 'GLOBAL', reorderable: true });
  });

  it('rejects unknown/invented types everywhere', async () => {
    const a = await admin();
    expect((await request(app).get(api('/masters/NOT_A_TYPE')).set(a.auth)).status).toBe(400);
    expect((await create(a, 'NOT_A_TYPE', { label: 'x' })).status).toBe(400);
    expect((await request(app).get(api('/masters?types=NOPE')).set(a.auth)).status).toBe(400);
    expect((await request(app).post(api('/masters/not_a_type')).set(a.auth).send({ label: 'x' })).status).toBe(400);
  });
});

describe('master CRUD', () => {
  it('creates (code derived from label), gets, lists, searches and filters', async () => {
    const a = await admin();
    const c = await create(a, 'ENQUIRY_SOURCE', { label: 'Walk-in', description: 'Visited the office' });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ type: 'ENQUIRY_SOURCE', code: 'WALK_IN', label: 'Walk-in', isActive: true, sortOrder: 1 });
    expect(c.body.data.branchId).toBeUndefined();
    await create(a, 'ENQUIRY_SOURCE', { label: 'Website' });
    const list = await request(app).get(api('/masters/ENQUIRY_SOURCE?sort=sortOrder')).set(a.auth);
    expect(list.body.data.map((m: { code: string }) => m.code)).toEqual(['WALK_IN', 'WEBSITE']);
    expect(list.body.meta).toMatchObject({ total: 2 });
    expect((await request(app).get(api('/masters/ENQUIRY_SOURCE?search=walk')).set(a.auth)).body.data).toHaveLength(1);
    expect((await request(app).get(api(`/masters/ENQUIRY_SOURCE/${c.body.data._id}`)).set(a.auth)).body.data.label).toBe('Walk-in');
    // wrong type for the id is not found
    expect((await request(app).get(api(`/masters/ENQUIRY_TYPE/${c.body.data._id}`)).set(a.auth)).status).toBe(404);
  });

  it('prevents duplicate codes within a type but allows the same code in another type', async () => {
    const a = await admin();
    expect((await create(a, 'ENQUIRY_SOURCE', { label: 'Other', code: 'OTHER' })).status).toBe(201);
    const dup = await create(a, 'ENQUIRY_SOURCE', { label: 'Other again', code: 'other' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('MASTER_CODE_TAKEN');
    expect((await create(a, 'ENQUIRY_TYPE', { label: 'Other', code: 'OTHER' })).status).toBe(201);
    // a seeded system code cannot be re-created
    expect((await create(a, 'FOLLOWUP_STATUS', { label: 'Pending 2', code: 'PENDING' })).status).toBe(409);
  });

  it('validates input (strict: unknown, immutable and privileged fields are rejected)', async () => {
    const a = await admin();
    expect((await create(a, 'ENQUIRY_SOURCE', {})).status).toBe(400);
    expect((await create(a, 'ENQUIRY_SOURCE', { label: 'x', code: '1bad' })).status).toBe(400);
    expect((await create(a, 'ENQUIRY_SOURCE', { label: 'x', systemKey: 'HACK' })).status).toBe(400);
    expect((await create(a, 'ENQUIRY_SOURCE', { label: 'x', type: 'LOCATION' })).status).toBe(400);
    expect((await create(a, 'UNIT_STATUS', { label: 'Blue', color: 'blue' })).status).toBe(400);
    expect((await create(a, 'ENQUIRY_SOURCE', { label: 'x'.repeat(200) })).status).toBe(400);
    expect((await create(a, 'ENQUIRY_SOURCE', { label: 'x', meta: { big: 'y'.repeat(3000) } })).status).toBe(400);
    const c = (await create(a, 'ENQUIRY_SOURCE', { label: 'Valid' })).body.data;
    for (const bad of [{ code: 'NEWCODE' }, { systemKey: 'X' }, { type: 'LOCATION' }, { branchId: new Types.ObjectId().toHexString() }, {}]) {
      expect((await request(app).patch(api(`/masters/ENQUIRY_SOURCE/${c._id}`)).set(a.auth).send(bad)).status).toBe(400);
    }
  });

  it('updates label/description/colour/meta; code and systemKey never change', async () => {
    const a = await admin();
    const c = (await create(a, 'UNIT_STATUS', { label: 'Reserved', color: '#112233' })).body.data;
    const u = await request(app).patch(api(`/masters/UNIT_STATUS/${c._id}`)).set(a.auth).send({ label: 'On hold', color: '#445566', description: 'd', meta: { x: 1 } });
    expect(u.status).toBe(200);
    expect(u.body.data).toMatchObject({ label: 'On hold', color: '#445566', code: 'RESERVED', description: 'd', meta: { x: 1 } });
    const cleared = await request(app).patch(api(`/masters/UNIT_STATUS/${c._id}`)).set(a.auth).send({ description: null, meta: null });
    expect(cleared.body.data.description).toBeUndefined();
    // colour is only meaningful for status-like types
    const src = (await create(a, 'ENQUIRY_SOURCE', { label: 'Source', color: '#112233' })).body.data;
    expect(src.color).toBeUndefined();
  });

  it('activate / deactivate; system values can never be deactivated or deleted', async () => {
    const a = await admin();
    const c = (await create(a, 'ENQUIRY_SOURCE', { label: 'Flyer' })).body.data;
    const off = await request(app).patch(api(`/masters/ENQUIRY_SOURCE/${c._id}`)).set(a.auth).send({ isActive: false });
    expect(off.body.data.isActive).toBe(false);
    expect((await request(app).get(api('/masters/ENQUIRY_SOURCE?isActive=false')).set(a.auth)).body.data).toHaveLength(1);
    expect((await request(app).patch(api(`/masters/ENQUIRY_SOURCE/${c._id}`)).set(a.auth).send({ isActive: true })).body.data.isActive).toBe(true);

    const sys = await Masters.findOne({ type: 'FOLLOWUP_STATUS', code: 'COMPLETED' }).lean();
    expect(sys!.systemKey).toBe('COMPLETED');
    const res = await request(app).patch(api(`/masters/FOLLOWUP_STATUS/${sys!._id}`)).set(a.auth).send({ isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SYSTEM_VALUE');
    // but it can be relabelled and recoloured
    const re = await request(app).patch(api(`/masters/FOLLOWUP_STATUS/${sys!._id}`)).set(a.auth).send({ label: 'Done', color: '#00aa00' });
    expect(re.body.data).toMatchObject({ label: 'Done', systemKey: 'COMPLETED', code: 'COMPLETED' });
    expect((await request(app).delete(api(`/masters/FOLLOWUP_STATUS/${sys!._id}`)).set(a.auth)).status).toBe(409);
  });

  it('delete is conservative: needs a deletable type, a non-system value, a registered checker and zero uses', async () => {
    const a = await admin();
    const src = (await create(a, 'ENQUIRY_SOURCE', { label: 'Temp' })).body.data;
    // no checker registered yet -> cannot prove it is unused
    const first = await request(app).delete(api(`/masters/ENQUIRY_SOURCE/${src._id}`)).set(a.auth);
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe('DELETE_UNSUPPORTED');
    expect(first.body.error.message).toMatch(/Deactivate it instead/);

    const used = new Set<string>();
    registerMasterReference('ENQUIRY_SOURCE', async (id) => used.has(id.toHexString()));
    used.add(src._id);
    const inUse = await request(app).delete(api(`/masters/ENQUIRY_SOURCE/${src._id}`)).set(a.auth);
    expect(inUse.body.error.code).toBe('IN_USE');
    expect(await Masters.countDocuments({ _id: src._id })).toBe(1);

    used.clear();
    expect((await request(app).delete(api(`/masters/ENQUIRY_SOURCE/${src._id}`)).set(a.auth)).status).toBe(204);
    expect(await Masters.countDocuments({ _id: src._id })).toBe(0);

    // a type that is not deletable at all
    const ref = await Masters.findOne({ type: 'REFERRAL_TYPE' }).lean();
    registerMasterReference('REFERRAL_TYPE', async () => false);
    expect((await request(app).delete(api(`/masters/REFERRAL_TYPE/${ref!._id}`)).set(a.auth)).body.error.code).toBe('NOT_DELETABLE');
  });
});

describe('reordering', () => {
  async function makeThree(a: Awaited<ReturnType<typeof admin>>) {
    const ids: string[] = [];
    for (const label of ['One', 'Two', 'Three']) ids.push((await create(a, 'ENQUIRY_SOURCE', { label })).body.data._id);
    return ids as [string, string, string];
  }
  const codes = async (a: Awaited<ReturnType<typeof admin>>) =>
    (await request(app).get(api('/masters/ENQUIRY_SOURCE?sort=sortOrder')).set(a.auth)).body.data.map((m: { code: string }) => m.code);

  it('reorders the complete list and audits each moved value', async () => {
    const a = await admin();
    const [one, two, three] = await makeThree(a);
    const res = await request(app).post(api('/masters/ENQUIRY_SOURCE/reorder')).set(a.auth).send({ ids: [three, one, two] });
    expect(res.status).toBe(200);
    expect(res.body.data.changed).toBe(3);
    expect(await codes(a)).toEqual(['THREE', 'ONE', 'TWO']);
    const audits = await AuditLogs.find({ entityType: 'master', action: 'reorder' }).lean();
    expect(audits).toHaveLength(3);
    expect(audits.find((x) => String(x.entityId) === three)!.changes).toMatchObject({ sortOrder: { from: 3, to: 1 } });
    // no-op reorder changes nothing
    expect((await request(app).post(api('/masters/ENQUIRY_SOURCE/reorder')).set(a.auth).send({ ids: [three, one, two] })).body.data.changed).toBe(0);
  });

  it('rejects stale, partial, duplicate or foreign id lists (409/400) without changing anything', async () => {
    const a = await admin();
    const [one, two, three] = await makeThree(a);
    const post = (ids: string[]) => request(app).post(api('/masters/ENQUIRY_SOURCE/reorder')).set(a.auth).send({ ids });
    expect((await post([one, two])).body.error.code).toBe('REORDER_MISMATCH');
    expect((await post([one, two, three, new Types.ObjectId().toHexString()])).body.error.code).toBe('REORDER_MISMATCH');
    expect((await post([one, one, two])).status).toBe(400);
    const other = (await create(a, 'ENQUIRY_TYPE', { label: 'Other type' })).body.data._id;
    expect((await post([one, two, other])).status).toBe(409);
    expect(await codes(a)).toEqual(['ONE', 'TWO', 'THREE']);
  });

  it('refuses types that are not reorderable', async () => {
    const a = await admin();
    const ids = (await Masters.find({ type: 'ACTIVITY_TYPE' }).lean()).map((m) => String(m._id));
    const res = await request(app).post(api('/masters/ACTIVITY_TYPE/reorder')).set(a.auth).send({ ids });
    expect(res.body.error.code).toBe('NOT_REORDERABLE');
  });
});

describe('authorization (permission-based, enforced server-side)', () => {
  it('401 without a token', async () => {
    for (const [m, p] of [['get', '/masters/types'], ['get', '/masters?types=LOCATION'], ['get', '/masters/ENQUIRY_SOURCE'], ['post', '/masters/ENQUIRY_SOURCE'], ['post', '/masters/ENQUIRY_SOURCE/reorder'], ['patch', `/masters/ENQUIRY_SOURCE/${new Types.ObjectId()}`], ['delete', `/masters/ENQUIRY_SOURCE/${new Types.ObjectId()}`]] as const) {
      expect((await (request(app) as never as Record<string, (u: string) => request.Test>)[m]!(api(p)).send({})).status).toBe(401);
    }
  });

  it('view-only roles (Manager, Sales Executive) can read but not manage — even when calling the API directly', async () => {
    const b = (await makeBranch('A'))._id.toHexString();
    const mgr = await actor(app, 'MANAGER', [b]);
    const sales = await actor(app, 'SALES_EXECUTIVE', [b]);
    const a = await admin();
    const src = (await create(a, 'ENQUIRY_SOURCE', { label: 'Web' })).body.data;
    for (const who of [mgr, sales]) {
      expect((await request(app).get(api('/masters/ENQUIRY_SOURCE')).set(who.auth)).status).toBe(200);
      expect((await create(who, 'ENQUIRY_SOURCE', { label: 'Hack' })).status).toBe(403);
      expect((await request(app).patch(api(`/masters/ENQUIRY_SOURCE/${src._id}`)).set(who.auth).send({ label: 'Hacked' })).status).toBe(403);
      expect((await request(app).post(api('/masters/ENQUIRY_SOURCE/reorder')).set(who.auth).send({ ids: [src._id] })).status).toBe(403);
      expect((await request(app).delete(api(`/masters/ENQUIRY_SOURCE/${src._id}`)).set(who.auth)).status).toBe(403);
    }
    expect((await Masters.findOne({ _id: src._id }).lean())!.label).toBe('Web');
  });

  it('a user without masters.view cannot read masters at all', async () => {
    const b = (await makeBranch('A'))._id.toHexString();
    await Role.updateOne({ key: 'SALES_EXECUTIVE' }, { $pull: { permissions: 'masters.view' } });
    const sales = await actor(app, 'SALES_EXECUTIVE', [b]);
    expect((await request(app).get(api('/masters/types')).set(sales.auth)).status).toBe(403);
    expect((await request(app).get(api('/masters?types=LOCATION')).set(sales.auth)).status).toBe(403);
  });

  it('WhatsApp masters need their own permission, not just masters.manage', async () => {
    await Role.updateOne({ key: 'ADMIN' }, { $pull: { permissions: 'whatsapp_masters.manage' } });
    const a = await admin();
    expect((await create(a, 'ENQUIRY_SOURCE', { label: 'Ok' })).status).toBe(201);
    expect((await create(a, 'WA_CATEGORY', { label: 'Marketing' })).status).toBe(403);
    await Role.updateOne({ key: 'ADMIN' }, { $addToSet: { permissions: 'whatsapp_masters.manage' } });
    expect((await create(a, 'WA_CATEGORY', { label: 'Marketing' })).status).toBe(201);
  });

  it('follows permissions, not role names: a custom role with masters.manage + ALL scope can manage', async () => {
    const root = await actor(app, 'SUPER_ADMIN');
    await request(app).post(api('/roles')).set(root.auth).send({ name: 'Config Keeper', permissions: ['masters.view', 'masters.manage'], dataScope: 'ALL' });
    const role = await Role.findOne({ name: 'Config Keeper' });
    await Role.updateOne({ _id: role!._id }, { key: 'KEEPER' });
    const u = await makeUser({ roleKey: 'KEEPER' });
    const l = await login(app, u.email);
    expect((await create({ auth: l.auth }, 'ENQUIRY_SOURCE', { label: 'Via custom role' })).status).toBe(201);
  });

  it('global master lists need ALL scope even for a role that holds masters.manage', async () => {
    const b = (await makeBranch('A'))._id.toHexString();
    await Role.updateOne({ key: 'MANAGER' }, { $addToSet: { permissions: 'masters.manage' } });
    const mgr = await actor(app, 'MANAGER', [b]);
    const res = await create(mgr, 'ENQUIRY_SOURCE', { label: 'Branch manager source' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/company-wide/);
    expect(await Masters.countDocuments({ type: 'ENQUIRY_SOURCE' })).toBe(0);
  });
});

describe('scope: GLOBAL vs BRANCH-scoped masters', () => {
  async function world() {
    const a = (await makeBranch('A'))._id.toHexString();
    const bb = (await makeBranch('B'))._id.toHexString();
    const root = await admin();
    await Role.updateOne({ key: 'MANAGER' }, { $addToSet: { permissions: 'masters.manage' } });
    const mgrA = await actor(app, 'MANAGER', [a]);
    return { a, b: bb, root, mgrA };
  }

  it('branch-scoped values need a branch; global values refuse one', async () => {
    const { a, root } = await world();
    expect((await create(root, 'LOCATION', { label: 'Anna Nagar' })).status).toBe(400); // ALL actor must choose
    const ok = await create(root, 'LOCATION', { label: 'Anna Nagar', branchId: a });
    expect(ok.status).toBe(201);
    expect(ok.body.data.branchId).toBe(a);
    const bad = await create(root, 'ENQUIRY_SOURCE', { label: 'X', branchId: a });
    expect(bad.status).toBe(400);
  });

  it('a branch manager manages ONLY their branch\'s values; other branches\' ids are invisible (404)', async () => {
    const { a, b, root, mgrA } = await world();
    const inB = (await create(root, 'LOCATION', { label: 'Adyar', branchId: b })).body.data;
    const own = await create(mgrA, 'LOCATION', { label: 'T Nagar' }); // branch derived from the manager's single branch
    expect(own.status).toBe(201);
    expect(own.body.data.branchId).toBe(a);

    expect((await create(mgrA, 'LOCATION', { label: 'Sneaky', branchId: b })).status).toBe(403);
    expect((await request(app).get(api(`/masters/LOCATION/${inB._id}`)).set(mgrA.auth)).status).toBe(404);
    expect((await request(app).patch(api(`/masters/LOCATION/${inB._id}`)).set(mgrA.auth).send({ label: 'HACKED' })).status).toBe(404);
    expect((await request(app).delete(api(`/masters/LOCATION/${inB._id}`)).set(mgrA.auth)).status).toBe(404);
    expect((await Masters.findOne({ _id: inB._id }).lean())!.label).toBe('Adyar');

    const list = await request(app).get(api('/masters/LOCATION')).set(mgrA.auth);
    expect(list.body.data.map((m: { label: string }) => m.label)).toEqual(['T Nagar']);
    // the client cannot widen with ?branchId either
    expect((await request(app).get(api(`/masters/LOCATION?branchId=${b}`)).set(mgrA.auth)).status).toBe(403);
    // ...but ALL scope sees everything and may narrow
    expect((await request(app).get(api('/masters/LOCATION')).set(root.auth)).body.data).toHaveLength(2);
    expect((await request(app).get(api(`/masters/LOCATION?branchId=${b}`)).set(root.auth)).body.data.map((m: { label: string }) => m.label)).toEqual(['Adyar']);
  });

  it('global values are readable by branch users (dropdowns) but never writable by them', async () => {
    const { root, mgrA } = await world();
    const g = (await create(root, 'ENQUIRY_SOURCE', { label: 'Website' })).body.data;
    const read = await request(app).get(api('/masters?types=ENQUIRY_SOURCE,FOLLOWUP_STATUS')).set(mgrA.auth);
    expect(read.body.data.ENQUIRY_SOURCE.map((m: { label: string }) => m.label)).toEqual(['Website']);
    expect(read.body.data.FOLLOWUP_STATUS.length).toBe(5);
    expect((await request(app).patch(api(`/masters/ENQUIRY_SOURCE/${g._id}`)).set(mgrA.auth).send({ label: 'x' })).status).toBe(403);
  });

  it('the grouped loader merges global + the branch\'s own values, sorted, active only by default', async () => {
    const { a, b, root, mgrA } = await world();
    await create(root, 'LOCATION', { label: 'Zed', branchId: a });
    const alpha = (await create(root, 'LOCATION', { label: 'Alpha', branchId: a })).body.data;
    await create(root, 'LOCATION', { label: 'Other branch', branchId: b });
    await request(app).patch(api(`/masters/LOCATION/${alpha._id}`)).set(root.auth).send({ isActive: false });
    const res = await request(app).get(api('/masters?types=LOCATION')).set(mgrA.auth);
    expect(res.body.data.LOCATION.map((m: { label: string }) => m.label)).toEqual(['Zed']);
    const all = await request(app).get(api('/masters?types=LOCATION&activeOnly=false')).set(mgrA.auth);
    expect(all.body.data.LOCATION.map((m: { label: string }) => m.label).sort()).toEqual(['Alpha', 'Zed']);
  });

  it('the same code can exist in different branches, but not twice in one branch', async () => {
    const { a, b, root } = await world();
    expect((await create(root, 'LOCATION', { label: 'Center', code: 'CENTER', branchId: a })).status).toBe(201);
    expect((await create(root, 'LOCATION', { label: 'Center', code: 'CENTER', branchId: b })).status).toBe(201);
    expect((await create(root, 'LOCATION', { label: 'Center', code: 'CENTER', branchId: a })).status).toBe(409);
  });

  it('reorders per branch without touching other branches', async () => {
    const { a, b, root } = await world();
    const x1 = (await create(root, 'LOCATION', { label: 'X1', branchId: a })).body.data._id;
    const x2 = (await create(root, 'LOCATION', { label: 'X2', branchId: a })).body.data._id;
    await create(root, 'LOCATION', { label: 'Y1', branchId: b });
    expect((await request(app).post(api('/masters/LOCATION/reorder')).set(root.auth).send({ branchId: a, ids: [x2, x1] })).body.data.changed).toBe(2);
    const inA = await request(app).get(api(`/masters/LOCATION?branchId=${a}&sort=sortOrder`)).set(root.auth);
    expect(inA.body.data.map((m: { label: string }) => m.label).filter((l: string) => l.startsWith('X'))).toEqual(['X2', 'X1']);
    expect((await request(app).post(api('/masters/LOCATION/reorder')).set(root.auth).send({ ids: [x2, x1] })).status).toBe(400); // branch required
  });
});

describe('inactive values and historical meaning', () => {
  it('inactive values cannot be chosen for new records but still resolve for existing ones', async () => {
    const a = await admin();
    const user = principalWith('ALL', ['masters.view']);
    const src = (await create(a, 'ENQUIRY_SOURCE', { label: 'Newspaper' })).body.data;
    expect((await assertActiveMaster(user, 'ENQUIRY_SOURCE', src._id)).label).toBe('Newspaper');

    await request(app).patch(api(`/masters/ENQUIRY_SOURCE/${src._id}`)).set(a.auth).send({ isActive: false });
    await expect(assertActiveMaster(user, 'ENQUIRY_SOURCE', src._id, 'sourceId')).rejects.toMatchObject({ httpStatus: 400, details: [{ path: 'sourceId' }] });

    // history: a record that already holds this id still shows its meaning, with its state
    const labels = await masterLabels(user, [src._id]);
    expect(labels.get(src._id)).toMatchObject({ label: 'Newspaper', isActive: false });
    // a deactivated value is also hidden from dropdown loaders by default but available on request
    expect((await request(app).get(api('/masters?types=ENQUIRY_SOURCE')).set(a.auth)).body.data.ENQUIRY_SOURCE).toHaveLength(0);
    expect((await request(app).get(api('/masters?types=ENQUIRY_SOURCE&activeOnly=false')).set(a.auth)).body.data.ENQUIRY_SOURCE).toHaveLength(1);
  });

  it('assertActiveMaster refuses wrong types, malformed/unknown ids, and other branches\' values', async () => {
    const a = await admin();
    const b1 = (await makeBranch('A'))._id.toHexString();
    const b2 = (await makeBranch('B'))._id.toHexString();
    const loc = (await create(a, 'LOCATION', { label: 'Elsewhere', branchId: b2 })).body.data;
    const src = (await create(a, 'ENQUIRY_SOURCE', { label: 'Src' })).body.data;
    const branchUser = principalWith('BRANCH', ['masters.view'], [b1]);
    await expect(assertActiveMaster(branchUser, 'LOCATION', loc._id)).rejects.toMatchObject({ httpStatus: 400 });
    await expect(assertActiveMaster(branchUser, 'ENQUIRY_TYPE', src._id)).rejects.toMatchObject({ httpStatus: 400 }); // wrong type
    await expect(assertActiveMaster(branchUser, 'ENQUIRY_SOURCE', 'garbage')).rejects.toMatchObject({ httpStatus: 400 });
    await expect(assertActiveMaster(branchUser, 'ENQUIRY_SOURCE', new Types.ObjectId())).rejects.toMatchObject({ httpStatus: 400 });
    expect(await assertActiveMaster(branchUser, 'ENQUIRY_SOURCE', src._id)).toBeTruthy(); // global is selectable
  });
});

describe('audit of master changes', () => {
  it('records create, update, deactivate, activate with who/what/previous/new', async () => {
    const a = await admin();
    const c = (await create(a, 'UNIT_STATUS', { label: 'Hold', color: '#112233' })).body.data;
    await request(app).patch(api(`/masters/UNIT_STATUS/${c._id}`)).set(a.auth).send({ label: 'On Hold' });
    await request(app).patch(api(`/masters/UNIT_STATUS/${c._id}`)).set(a.auth).send({ isActive: false });
    await request(app).patch(api(`/masters/UNIT_STATUS/${c._id}`)).set(a.auth).send({ isActive: true });
    const rows = await AuditLogs.find({ entityType: 'master', entityId: c._id }).sort({ at: 1 }).lean();
    expect(rows.map((r) => r.action)).toEqual(['create', 'update', 'deactivate', 'activate']);
    expect(rows[1]!.changes).toMatchObject({ label: { from: 'Hold', to: 'On Hold' } });
    expect(rows[2]!.changes).toMatchObject({ isActive: { from: true, to: false } });
    expect(String(rows[1]!.userId)).toBe(a.user._id.toHexString());
  });
});
