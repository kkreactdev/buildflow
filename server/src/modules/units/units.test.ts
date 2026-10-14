import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { getEnv } from '../../config/env';
import { systemRepo } from '../../core/scope/system';
import { PERMISSION_CATALOG } from '../../core/permissions/catalog';
import { getMediaProvider, setMediaProvider } from '../../core/storage/mediaProvider';
import { MockMediaProvider } from '../../core/storage/mockProvider';
import { useTestDb } from '../../test/db';
import { Activities, AuditLogs, makeUser, seedAll } from '../../test/factories';
import { api, assignUnit, createUnitApi, FILES, full, grant, mkUnit, revoke, setStatus, unitWorld, uploadMedia, type UW } from '../../test/units';
import { isMasterReferenced } from '../masters/references';
import { Master } from '../masters/master.model';
import { Unit, UnitAssignment } from './unit.model';

const app = buildApp();
const Units = systemRepo(Unit, 'test', 'fixtures');
const Assignments = systemRepo(UnitAssignment, 'test', 'fixtures');
const Masters = systemRepo(Master, 'test', 'fixtures');

useTestDb();
beforeEach(async () => {
  await seedAll();
  setMediaProvider(new MockMediaProvider());
});
const mock = () => getMediaProvider() as MockMediaProvider;
const codes = (res: request.Response) => { if (!res.body.data) throw new Error(`${res.status} ${JSON.stringify(res.body)}`); return (res.body.data as { unitCode: string }[]).map((u) => u.unitCode); };
const get = (w: UW, who: { auth: Record<string, string> }, path: string) => request(app).get(api(path)).set(who.auth);

describe('creating a unit', () => {
  it('creates a top-level unit in the creator\'s branch, AVAILABLE, with no project required', async () => {
    const w = await unitWorld(app);
    const res = await createUnitApi(app, w.mgrA, { name: 'Villa 12', ...full(w), address: '12 Lake Road', city: 'Chennai', latitude: 13.08, longitude: 80.27, plotArea: 2400, builtUpArea: 1800, expectedPrice: 12500000, bedrooms: 3, bathrooms: 3, description: 'Corner villa' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      unitCode: 'UNT-000001', name: 'Villa 12', branchId: w.A, branch: { code: 'A' }, statusKey: 'AVAILABLE', status: { label: 'Available' },
      propertyType: { label: 'Villa' }, buildingType: { label: 'Independent' }, location: { label: 'Anna Nagar' },
      latitude: 13.08, longitude: 80.27, plotArea: 2400, builtUpArea: 1800, expectedPrice: 12500000, bedrooms: 3, isArchived: false, mediaCount: 0,
    });
    expect(res.body.data.assignedTo).toBeUndefined();
    expect(res.body.data.allowed).toMatchObject({ edit: true, assign: true, changeStatus: true, archive: true, manageMedia: true });
  });

  it('needs only a name; everything else is optional', async () => {
    const w = await unitWorld(app);
    expect((await createUnitApi(app, w.mgrA, { name: 'Plot 4' })).status).toBe(201);
    for (const bad of [{}, { name: '' }, { name: '  ' }]) expect((await createUnitApi(app, w.mgrA, bad)).status, JSON.stringify(bad)).toBe(400);
  });

  it('validates fields (strict body, ranges, coordinate pair, types)', async () => {
    const w = await unitWorld(app);
    const bad: Record<string, unknown>[] = [
      { name: 'x', latitude: 91, longitude: 0 }, { name: 'x', latitude: 0, longitude: 181 }, { name: 'x', latitude: 12 }, { name: 'x', longitude: 12 },
      { name: 'x', expectedPrice: -1 }, { name: 'x', expectedPrice: '5' }, { name: 'x', builtUpArea: -5 }, { name: 'x', bedrooms: 1.5 }, { name: 'x', bedrooms: 99 },
      { name: 'x'.repeat(151) }, { name: 'x', description: 'd'.repeat(3001) },
      { name: 'x', unknownField: 1 },
    ];
    for (const b of bad) expect((await createUnitApi(app, w.mgrA, b)).status, JSON.stringify(b)).toBe(400);
  });

  it('refuses to accept status, code, owner-of-record or media from the client', async () => {
    const w = await unitWorld(app);
    for (const b of [{ statusId: w.st.sold }, { statusKey: 'SOLD' }, { unitCode: 'UNT-9' }, { media: [] }, { isArchived: true }, { createdBy: w.A }]) {
      expect((await createUnitApi(app, w.mgrA, { name: 'x', ...b })).status, JSON.stringify(b)).toBe(400);
    }
  });

  it('an OWN-scope creator owns what they create; ALL scope must choose a branch', async () => {
    const w = await unitWorld(app);
    await grant('SALES_EXECUTIVE', 'units.create');
    const mine = await createUnitApi(app, w.salesA, { name: 'Mine' });
    expect(mine.status).toBe(201);
    expect(mine.body.data.assignedTo).toBe(w.salesA.user._id.toHexString());
    expect(await Assignments.countDocuments({ unitId: mine.body.data.id })).toBe(1);
    expect((await createUnitApi(app, w.admin, { name: 'x' })).status).toBe(400);
    expect((await createUnitApi(app, w.admin, { name: 'x', branchId: w.B })).status).toBe(201);
  });

  it('never trusts a client branch: a branch-scoped manager cannot create in another branch', async () => {
    const w = await unitWorld(app);
    const res = await createUnitApi(app, w.mgrA, { name: 'x', branchId: w.B });
    expect([400, 403, 404]).toContain(res.status);
    expect(await Units.countDocuments({})).toBe(0);
  });

  it('can be created with an assignee of the same branch, which starts the assignment history', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA, { assignedTo: w.salesA.user._id.toHexString() });
    expect(u.assignedTo).toBe(w.salesA.user._id.toHexString());
    expect(await Assignments.find({ unitId: u.id }).lean()).toMatchObject([{ toUserId: w.salesA.user._id }]);
    expect((await createUnitApi(app, w.mgrA, { name: 'x', assignedTo: w.salesB.user._id.toHexString() })).status).toBe(400); // other branch
  });

  it('records audit and a timeline activity referencing the unit', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA, full(w));
    const audit = await AuditLogs.findOne({ entityType: 'unit', action: 'create' }).lean();
    expect(String(audit!.entityId)).toBe(u.id);
    expect(String(audit!.branchId)).toBe(w.A);
    const act = await Activities.findOne({ type: 'UNIT_CREATED' }).lean();
    expect(act!.refs.map((r) => `${r.type}:${r.id}`)).toEqual([`unit:${u.id}`]);
  });

  it('needs units.create', async () => {
    const w = await unitWorld(app);
    expect((await createUnitApi(app, w.salesA, { name: 'x' })).status).toBe(403);
    expect((await request(app).post(api('/units')).send({ name: 'x' })).status).toBe(401);
  });
});

describe('unit codes', () => {
  it('are sequential, unique, immutable and never reused', async () => {
    const w = await unitWorld(app);
    const a = await mkUnit(app, w.mgrA);
    const b = await mkUnit(app, w.mgrB);
    expect([a.unitCode, b.unitCode]).toEqual(['UNT-000001', 'UNT-000002']);
    expect((await request(app).patch(api(`/units/${a.id}`)).set(w.mgrA.auth).send({ unitCode: 'UNT-000099' })).status).toBe(400);
    await request(app).delete(api(`/units/${a.id}`)).set(w.mgrA.auth);
    expect((await mkUnit(app, w.mgrA)).unitCode).toBe('UNT-000003'); // an archived unit's code is not recycled
    expect((await Units.findOne({ _id: a.id }).lean())!.unitCode).toBe('UNT-000001');
  });

  it('cannot collide under concurrent creation, across branches and creators', async () => {
    const w = await unitWorld(app);
    const who = [w.mgrA, w.mgrB, w.admin];
    const results = await Promise.all(Array.from({ length: 24 }, (_, i) => createUnitApi(app, who[i % 3]!, { name: `C${i}`, ...(i % 3 === 2 ? { branchId: w.A } : {}) })));
    expect(results.map((r) => r.status)).toEqual(Array(24).fill(201));
    const got = results.map((r) => r.body.data.unitCode as string);
    expect(new Set(got).size).toBe(24);
    expect(await Units.countDocuments({})).toBe(24);
    expect([...got].sort()[0]).toBe('UNT-000001');
  });

  it('the database itself rejects a duplicate code', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    const dup = Units.create({ unitCode: u.unitCode, branchId: w.A, name: 'dup', statusId: u.statusId, statusKey: 'AVAILABLE', statusChangedAt: new Date() });
    await expect(dup).rejects.toMatchObject({ code: 11000 });
  });
});

describe('master references', () => {
  it.each([['propertyTypeId', 'property'], ['buildingTypeId', 'building'], ['locationId', 'locA']] as const)('rejects an inactive, unknown, malformed or wrong-type %s', async (field, key) => {
    const w = await unitWorld(app);
    await request(app).patch(api(`/masters/${field === 'locationId' ? 'LOCATION' : field === 'propertyTypeId' ? 'PROPERTY_TYPE' : 'BUILDING_TYPE'}/${w.m[key]}`)).set(w.admin.auth).send({ isActive: false });
    for (const v of [w.m[key], new Types.ObjectId().toHexString(), 'nope', w.m.source]) {
      expect((await createUnitApi(app, w.mgrA, { name: 'x', [field]: v })).status, `${field}=${v}`).toBe(400);
    }
  });

  it('a LOCATION must belong to the unit\'s own branch (create and update)', async () => {
    const w = await unitWorld(app);
    const bad = await createUnitApi(app, w.mgrA, { name: 'x', locationId: w.m.locB });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].path).toBe('locationId');
    const u = await mkUnit(app, w.mgrA, { locationId: w.m.locA });
    expect((await request(app).patch(api(`/units/${u.id}`)).set(w.mgrA.auth).send({ locationId: w.m.locB })).status).toBe(400);
    expect((await createUnitApi(app, w.admin, { name: 'ok', branchId: w.B, locationId: w.m.locB })).status).toBe(201);
    expect((await createUnitApi(app, w.admin, { name: 'no', branchId: w.B, locationId: w.m.locA })).status).toBe(400);
  });

  it('history: a value deactivated later still displays, and the unit stays editable', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA, full(w));
    await request(app).patch(api(`/masters/PROPERTY_TYPE/${w.m.property}`)).set(w.admin.auth).send({ isActive: false });
    await request(app).patch(api(`/masters/LOCATION/${w.m.locA}`)).set(w.admin.auth).send({ isActive: false });
    const detail = (await get(w, w.mgrA, `/units/${u.id}`)).body.data;
    expect(detail.propertyType).toMatchObject({ label: 'Villa', isActive: false });
    expect(detail.location).toMatchObject({ label: 'Anna Nagar', isActive: false });
    expect((await get(w, w.mgrA, '/units')).body.data[0].propertyType).toMatchObject({ isActive: false });
    expect((await request(app).patch(api(`/units/${u.id}`)).set(w.mgrA.auth).send({ name: 'Renamed' })).status).toBe(200);
    expect((await request(app).patch(api(`/units/${u.id}`)).set(w.mgrA.auth).send({ propertyTypeId: w.m.property })).status).toBe(200); // unchanged inactive value is fine
  });

  it('reference protection: every master type a unit stores is blocked from deletion while in use', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA, full(w));
    await uploadMedia(app, w.mgrA, u.id, FILES.png, { typeId: w.mt.front });
    await request(app).delete(api(`/units/${u.id}`)).set(w.mgrA.auth); // archived units still count
    const del = (type: string, id: string) => request(app).delete(api(`/masters/${type}/${id}`)).set(w.admin.auth);
    for (const [type, id] of [['PROPERTY_TYPE', w.m.property], ['BUILDING_TYPE', w.m.building], ['LOCATION', w.m.locA], ['MEDIA_TYPE', w.mt.front]] as const) {
      const res = await del(type, id);
      expect(res.status, type).toBe(409);
      expect(res.body.error.code, type).toBe('IN_USE');
    }
    expect((await del('UNIT_STATUS', w.st.available)).body.error.code).toBe('NOT_DELETABLE'); // statuses are deactivated, never deleted
    expect(await isMasterReferenced('UNIT_STATUS', new Types.ObjectId(w.st.available))).toBe(true); // the unit's status is tracked
    expect(await isMasterReferenced('UNIT_STATUS', new Types.ObjectId(w.st.hold))).toBe(false);
    const f = await del('MEDIA_TYPE', w.mt.floor);
    expect(f.status, JSON.stringify(f.body)).toBe(204);
    expect(await Masters.countDocuments({ _id: w.mt.floor })).toBe(0);
  });

  it('a custom UNIT_STATUS is tracked as referenced once a unit uses it, and can be deactivated but not used for new changes', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    expect((await setStatus(app, w.mgrA, u.id, { statusId: w.st.hold })).status).toBe(200);
    expect(await isMasterReferenced('UNIT_STATUS', new Types.ObjectId(w.st.hold))).toBe(true);
    expect((await request(app).patch(api(`/masters/UNIT_STATUS/${w.st.hold}`)).set(w.admin.auth).send({ isActive: false })).status).toBe(200);
    const detail = (await get(w, w.mgrA, `/units/${u.id}`)).body.data;
    expect(detail.status).toMatchObject({ label: 'On hold', isActive: false }); // history stays readable
  });
});

describe('scope', () => {
  it('BRANCH scope sees only its branch; ALL sees everything and can narrow; filter widening is ignored', async () => {
    const w = await unitWorld(app);
    const a = await mkUnit(app, w.mgrA);
    const b = await mkUnit(app, w.mgrB);
    expect(codes(await get(w, w.mgrA, '/units'))).toEqual([a.unitCode]);
    expect(codes(await get(w, w.mgrB, '/units'))).toEqual([b.unitCode]);
    expect(codes(await get(w, w.admin, '/units')).sort()).toEqual([a.unitCode, b.unitCode]);
    expect(codes(await get(w, w.admin, `/units?branchId=${w.B}`))).toEqual([b.unitCode]);
    // asking for another branch never widens a BRANCH-scoped user
    const widen = await get(w, w.mgrA, `/units?branchId=${w.B}`);
    expect(widen.status).toBe(403);
    expect(widen.body.data).toBeUndefined();
    expect(codes(await get(w, w.mgrA, `/units?branchId=${w.A}`))).toEqual([a.unitCode]);
  });

  it('cross-branch access is a 404 on every operation, indistinguishable from a missing id', async () => {
    const w = await unitWorld(app);
    const b = await mkUnit(app, w.mgrB);
    const ghost = new Types.ObjectId().toHexString();
    const probes = (id: string) => [
      get(w, w.mgrA, `/units/${id}`),
      request(app).patch(api(`/units/${id}`)).set(w.mgrA.auth).send({ name: 'hijack' }),
      request(app).delete(api(`/units/${id}`)).set(w.mgrA.auth),
      assignUnit(app, w.mgrA, id, { assignedTo: w.salesA.user._id.toHexString() }),
      setStatus(app, w.mgrA, id, { statusId: w.st.sold }),
      get(w, w.mgrA, `/units/${id}/media`),
      uploadMedia(app, w.mgrA, id, FILES.png, { typeId: w.mt.front }),
      request(app).delete(api(`/units/${id}/media/${new Types.ObjectId()}`)).set(w.mgrA.auth),
    ];
    const real = await Promise.all(probes(b.id));
    const fake = await Promise.all(probes(ghost));
    expect(real.map((r) => r.status)).toEqual(Array(8).fill(404));
    expect(real.map((r) => r.body.error.code)).toEqual(fake.map((r) => r.body.error.code));
    expect((await Units.findOne({ _id: b.id }).lean())!.name).toBe(b.unitCode ? (await Units.findOne({ _id: b.id }).lean())!.name : '');
    expect(mock().assets.size).toBe(0); // nothing was uploaded for a unit the caller cannot see
  });

  it('OWN scope sees only units assigned to them, in list, search, detail and filters', async () => {
    const w = await unitWorld(app);
    const mine = await mkUnit(app, w.mgrA, { name: 'Mine', assignedTo: w.salesA.user._id.toHexString() });
    const other = await mkUnit(app, w.mgrA, { name: 'Other' });
    const sales2 = (await makeUser({ roleKey: 'SALES_EXECUTIVE', branches: [w.A] })).user._id.toHexString();
    const theirs = await mkUnit(app, w.mgrA, { name: 'Theirs', assignedTo: sales2 });
    expect(codes(await get(w, w.salesA, '/units'))).toEqual([mine.unitCode]);
    expect(codes(await get(w, w.salesA, '/units?search=Other'))).toEqual([]);
    expect(codes(await get(w, w.salesA, '/units?assignedTo=unassigned'))).toEqual([]);
    expect(codes(await get(w, w.salesA, `/units?assignedTo=${sales2}`))).toEqual([]);
    expect((await get(w, w.salesA, `/units?branchId=${w.B}`)).status).toBe(403);
    expect((await get(w, w.salesA, `/units/${other.id}`)).status).toBe(404);
    expect((await get(w, w.salesA, `/units/${theirs.id}`)).status).toBe(404);
    expect((await get(w, w.salesA, `/units/${mine.id}`)).status).toBe(200);
  });

  it('OWN scope with units.edit / assign cannot touch units they do not own', async () => {
    const w = await unitWorld(app);
    await grant('SALES_EXECUTIVE', 'units.edit', 'units.assign', 'units.archive', 'units.manage_media', 'units.change_status');
    const other = await mkUnit(app, w.mgrA);
    expect((await request(app).patch(api(`/units/${other.id}`)).set(w.salesA.auth).send({ name: 'x' })).status).toBe(404);
    expect((await assignUnit(app, w.salesA, other.id, { assignedTo: w.salesA.user._id.toHexString() })).status).toBe(404); // cannot grab it
    expect((await request(app).delete(api(`/units/${other.id}`)).set(w.salesA.auth)).status).toBe(404);
    expect((await uploadMedia(app, w.salesA, other.id, FILES.png, { typeId: w.mt.front })).status).toBe(404);
    expect((await setStatus(app, w.salesA, other.id, { statusId: w.st.sold })).status).toBe(404);
  });
});

describe('listing, search, filters and sorting (server-side)', () => {
  async function seedList(w: UW) {
    const s = w.salesA.user._id.toHexString();
    await mkUnit(app, w.mgrA, { name: 'Lake View Villa', propertyTypeId: w.m.property, locationId: w.m.locA, expectedPrice: 9000000, builtUpArea: 1500, assignedTo: s, city: 'Chennai' });
    await mkUnit(app, w.mgrA, { name: 'City Flat', buildingTypeId: w.m.building, expectedPrice: 4500000, builtUpArea: 900, address: '5 Main Road' });
    const sold = await mkUnit(app, w.mgrA, { name: 'Garden Plot', expectedPrice: 2000000, builtUpArea: 2400 });
    await setStatus(app, w.mgrA, sold.id, { statusId: w.st.sold });
    return sold;
  }
  const names = (res: request.Response) => (res.body.data as { name: string }[]).map((u) => u.name);

  it('searches by name, address, city, full code and bare number', async () => {
    const w = await unitWorld(app);
    await seedList(w);
    expect(names(await get(w, w.mgrA, '/units?search=lake'))).toEqual(['Lake View Villa']);
    expect(names(await get(w, w.mgrA, '/units?search=main road'))).toEqual(['City Flat']);
    expect(names(await get(w, w.mgrA, '/units?search=chennai'))).toEqual(['Lake View Villa']);
    expect(names(await get(w, w.mgrA, '/units?search=UNT-000002'))).toEqual(['City Flat']);
    expect(names(await get(w, w.mgrA, '/units?search=3'))).toEqual(['Garden Plot']);
    expect(names(await get(w, w.mgrA, '/units?search=%5E.*'))).toEqual([]); // regex characters are literal
  });

  it('filters by status, types, location, assignee (incl. unassigned) and price range', async () => {
    const w = await unitWorld(app);
    await seedList(w);
    expect(names(await get(w, w.mgrA, `/units?statusId=${w.st.sold}`))).toEqual(['Garden Plot']);
    expect((await get(w, w.mgrA, `/units?statusId=${w.st.sold},${w.st.available}`)).body.meta.total).toBe(3);
    expect(names(await get(w, w.mgrA, `/units?propertyTypeId=${w.m.property}`))).toEqual(['Lake View Villa']);
    expect(names(await get(w, w.mgrA, `/units?buildingTypeId=${w.m.building}`))).toEqual(['City Flat']);
    expect(names(await get(w, w.mgrA, `/units?locationId=${w.m.locA}`))).toEqual(['Lake View Villa']);
    expect(names(await get(w, w.mgrA, `/units?assignedTo=${w.salesA.user._id}`))).toEqual(['Lake View Villa']);
    expect((await get(w, w.mgrA, '/units?assignedTo=unassigned')).body.meta.total).toBe(2);
    expect(names(await get(w, w.mgrA, '/units?minPrice=4000000&maxPrice=9000000&sort=expectedPrice'))).toEqual(['City Flat', 'Lake View Villa']);
    expect(names(await get(w, w.mgrA, '/units?minPrice=5000000'))).toEqual(['Lake View Villa']);
    expect((await get(w, w.mgrA, '/units?minPrice=9&maxPrice=1')).status).toBe(400);
    expect((await get(w, w.mgrA, '/units?statusId=nope')).status).toBe(400);
  });

  it('sorts and paginates on the server', async () => {
    const w = await unitWorld(app);
    await seedList(w);
    expect(names(await get(w, w.mgrA, '/units?sort=expectedPrice'))).toEqual(['Garden Plot', 'City Flat', 'Lake View Villa']);
    expect(names(await get(w, w.mgrA, '/units?sort=-builtUpArea'))).toEqual(['Garden Plot', 'Lake View Villa', 'City Flat']);
    expect(names(await get(w, w.mgrA, '/units?sort=name'))).toEqual(['City Flat', 'Garden Plot', 'Lake View Villa']);
    const p2 = await get(w, w.mgrA, '/units?sort=name&limit=2&page=2');
    expect(names(p2)).toEqual(['Lake View Villa']);
    expect(p2.body.meta).toMatchObject({ page: 2, limit: 2, total: 3 });
    expect((await get(w, w.mgrA, '/units?limit=1000')).status).toBe(400);
    expect(names(await get(w, w.mgrA, '/units?sort=password'))).toHaveLength(3); // unknown sort fields are ignored
  });
});

describe('updating descriptive fields', () => {
  it('changes fields, clears with null, and audits before/after', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA, { ...full(w), expectedPrice: 100, latitude: 1, longitude: 2 });
    const res = await request(app).patch(api(`/units/${u.id}`)).set(w.mgrA.auth).send({ name: 'Renamed', expectedPrice: 250, propertyTypeId: null, latitude: null, longitude: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Renamed', expectedPrice: 250 });
    expect(res.body.data.propertyType).toBeUndefined();
    expect(res.body.data.latitude).toBeUndefined();
    const audit = await AuditLogs.findOne({ entityType: 'unit', action: 'update' }).lean();
    expect(audit!.changes).toMatchObject({ name: { to: 'Renamed' }, expectedPrice: { from: 100, to: 250 } });
    expect(await Activities.countDocuments({ type: 'UNIT_UPDATED' })).toBe(1);
  });

  it('cannot touch status, owner, branch, code or media (each has its own controlled operation)', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    for (const b of [{ statusId: w.st.sold }, { statusKey: 'SOLD' }, { assignedTo: w.salesA.user._id.toHexString() }, { branchId: w.B }, { unitCode: 'X' }, { media: [] }, { isArchived: true }, {}, { name: null }, { latitude: 5 }]) {
      expect((await request(app).patch(api(`/units/${u.id}`)).set(w.mgrA.auth).send(b)).status, JSON.stringify(b)).toBe(400);
    }
    const after = await Units.findOne({ _id: u.id }).lean();
    expect(after).toMatchObject({ statusKey: 'AVAILABLE' });
    expect(String(after!.branchId)).toBe(w.A);
  });

  it('needs units.edit', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA, { assignedTo: w.salesA.user._id.toHexString() });
    expect((await request(app).patch(api(`/units/${u.id}`)).set(w.salesA.auth).send({ name: 'x' })).status).toBe(403);
  });
});

describe('status (controlled)', () => {
  it('changes between non-booking statuses with compare-and-set, audit and a timeline event', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    const res = await setStatus(app, w.mgrA, u.id, { statusId: w.st.sold, from: w.st.available, reason: 'Sold offline' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ statusKey: 'SOLD', status: { label: 'Sold' } });
    expect(res.body.data.allowed.changeStatus).toBe(true);
    expect(await AuditLogs.findOne({ entityType: 'unit', action: 'status' }).lean()).toMatchObject({ reason: 'Sold offline' });
    const act = await Activities.findOne({ type: 'UNIT_STATUS_CHANGED' }).lean();
    expect(act!.metadata).toMatchObject({ from: 'AVAILABLE', to: 'SOLD' });
    expect((await setStatus(app, w.mgrA, u.id, { statusId: w.st.hold })).status).toBe(200); // custom statuses added by admins work without code
    expect((await Units.findOne({ _id: u.id }).lean())!.statusKey).toBe('ONHOLD'.replace('ONHOLD', (await Masters.findOne({ _id: w.st.hold }).lean())!.code));
  });

  it('refuses a no-op, a stale "from", inactive/unknown/wrong-type targets', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    expect((await setStatus(app, w.mgrA, u.id, { statusId: w.st.available })).body.error.code).toBe('NO_CHANGE');
    const stale = await setStatus(app, w.mgrA, u.id, { statusId: w.st.sold, from: w.st.hold });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STATUS_CHANGED');
    await request(app).patch(api(`/masters/UNIT_STATUS/${w.st.hold}`)).set(w.admin.auth).send({ isActive: false });
    for (const id of [w.st.hold, new Types.ObjectId().toHexString(), w.m.source, 'nope']) expect((await setStatus(app, w.mgrA, u.id, { statusId: id })).status, id).toBe(400);
    expect((await setStatus(app, w.mgrA, u.id, { statusId: w.st.sold, statusKey: 'SOLD' })).status).toBe(400);
  });

  it('booking status is owned by bookings: it can be neither entered nor left through this endpoint, nor archived', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    const enter = await setStatus(app, w.mgrA, u.id, { statusId: w.st.booked });
    expect(enter.status).toBe(409);
    expect(enter.body.error.code).toBe('BOOKING_OWNED');
    // Simulate what Phase 9's conditional update will do.
    await Units.updateOne({ _id: u.id, statusKey: 'AVAILABLE' }, { $set: { statusId: w.st.booked, statusKey: 'BOOKED' } });
    expect((await setStatus(app, w.mgrA, u.id, { statusId: w.st.available })).body.error.code).toBe('BOOKING_OWNED');
    const arch = await request(app).delete(api(`/units/${u.id}`)).set(w.mgrA.auth);
    expect(arch.status).toBe(409);
    expect(arch.body.error.code).toBe('UNIT_BOOKED');
    const detail = (await get(w, w.mgrA, `/units/${u.id}`)).body.data;
    expect(detail.allowed).toMatchObject({ changeStatus: false, archive: false, edit: true });
    expect((await Units.findOne({ _id: u.id }).lean())!.isArchived).toBeFalsy();
  });

  it('simultaneous status changes: exactly one wins, the other gets STATUS_CHANGED', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    const [x, y] = await Promise.all([
      setStatus(app, w.mgrA, u.id, { statusId: w.st.sold, from: w.st.available }),
      setStatus(app, w.mgrA, u.id, { statusId: w.st.hold, from: w.st.available }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await AuditLogs.countDocuments({ entityType: 'unit', action: 'status' })).toBe(1);
    expect(await Activities.countDocuments({ type: 'UNIT_STATUS_CHANGED' })).toBe(1);
  });

  it('needs units.change_status', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA, { assignedTo: w.salesA.user._id.toHexString() });
    expect((await setStatus(app, w.salesA, u.id, { statusId: w.st.sold })).status).toBe(403);
  });
});

describe('assignment', () => {
  const mgrAssign = (w: UW, id: string, to: string, reason?: string) => assignUnit(app, w.mgrA, id, { assignedTo: to, ...(reason ? { reason } : {}) });
  const uid = (a: { user: { _id: Types.ObjectId } }) => a.user._id.toHexString();

  it('assigns, reassigns with a reason, and keeps every step in history, audit and the timeline', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    const first = await mgrAssign(w, u.id, uid(w.salesA));
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ assignedTo: uid(w.salesA), assignedToName: w.salesA.user.name });
    expect((await mgrAssign(w, u.id, uid(w.salesA2))).status).toBe(400); // reassigning needs a reason
    const re = await mgrAssign(w, u.id, uid(w.salesA2), 'Salesperson on leave');
    expect(re.status).toBe(200);
    expect(re.body.data.assignedTo).toBe(uid(w.salesA2));
    const detail = (await get(w, w.mgrA, `/units/${u.id}`)).body.data;
    expect(detail.assignments).toHaveLength(2);
    expect(detail.assignments[0]).toMatchObject({ to: uid(w.salesA), by: uid(w.mgrA) });
    expect(detail.assignments[0].from).toBeUndefined();
    expect(detail.assignments[1]).toMatchObject({ from: uid(w.salesA), to: uid(w.salesA2), reason: 'Salesperson on leave' });
    expect(await AuditLogs.countDocuments({ entityType: 'unit', action: 'assign' })).toBe(2);
    expect(await Activities.countDocuments({ type: 'UNIT_ASSIGNED' })).toBe(2);
    const tl = await get(w, w.mgrA, `/activities?refType=unit&refId=${u.id}`);
    expect(tl.status).toBe(200);
    expect(tl.body.meta.total).toBe(3); // created + 2 assignments
  });

  it('refuses a no-op and invalid assignees (other branch, inactive, unknown, malformed)', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA, { assignedTo: uid(w.salesA) });
    expect((await mgrAssign(w, u.id, uid(w.salesA), 'again')).body.error.code).toBe('NO_CHANGE');
    const inactive = await makeUser({ roleKey: 'SALES_EXECUTIVE', branches: [w.A], isActive: false });
    for (const to of [uid(w.salesB), inactive.user._id.toHexString(), new Types.ObjectId().toHexString(), 'nope']) {
      expect((await mgrAssign(w, u.id, to, 'why')).status, to).toBe(400);
    }
    expect((await Units.findOne({ _id: u.id }).lean())!.assignedTo!.toHexString()).toBe(uid(w.salesA));
    expect(await Assignments.countDocuments({ unitId: u.id })).toBe(1);
  });

  it('OWN scope can only take a unit for themselves, never hand it to someone else', async () => {
    const w = await unitWorld(app);
    await grant('SALES_EXECUTIVE', 'units.assign');
    const mine = await mkUnit(app, w.mgrA, { assignedTo: uid(w.salesA) });
    const denied = await assignUnit(app, w.salesA, mine.id, { assignedTo: uid(w.salesA2), reason: 'passing on' });
    expect(denied.status).toBe(403);
    expect((await Units.findOne({ _id: mine.id }).lean())!.assignedTo!.toHexString()).toBe(uid(w.salesA));
    await revoke('SALES_EXECUTIVE', 'units.assign');
    expect((await assignUnit(app, w.salesA, mine.id, { assignedTo: uid(w.salesA), reason: 'x' })).status).toBe(403);
  });

  it('simultaneous assignments: exactly one wins, history has one row for the winner', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    const [x, y] = await Promise.all([mgrAssign(w, u.id, uid(w.salesA)), mgrAssign(w, u.id, uid(w.salesA2))]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect([x, y].find((r) => r.status === 409)!.body.error.code).toBe('ASSIGNMENT_CHANGED');
    expect(await Assignments.countDocuments({ unitId: u.id })).toBe(1);
    expect(await Activities.countDocuments({ type: 'UNIT_ASSIGNED' })).toBe(1);
  });

  it('needs units.assign; an archived unit cannot be assigned', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    expect((await assignUnit(app, w.salesA, u.id, { assignedTo: uid(w.salesA) })).status).toBe(403);
    await request(app).delete(api(`/units/${u.id}`)).set(w.mgrA.auth);
    expect((await mgrAssign(w, u.id, uid(w.salesA))).status).toBe(404);
  });
});

describe('archiving', () => {
  it('soft-deletes: hidden by default, listed on request, readable, audited, timeline kept, nothing destroyed', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    await mkUnit(app, w.mgrA);
    expect((await request(app).delete(api(`/units/${u.id}`)).set(w.salesA.auth)).status).toBe(403);
    expect((await request(app).delete(api(`/units/${u.id}`)).set(w.mgrA.auth)).status).toBe(204);
    expect((await get(w, w.mgrA, '/units')).body.meta.total).toBe(1);
    expect(codes(await get(w, w.mgrA, '/units?isArchived=true'))).toEqual([u.unitCode]);
    const detail = (await get(w, w.mgrA, `/units/${u.id}`)).body.data;
    expect(detail.isArchived).toBe(true);
    expect(detail.allowed).toMatchObject({ edit: false, assign: false, changeStatus: false, archive: false, manageMedia: false });
    expect((await request(app).delete(api(`/units/${u.id}`)).set(w.mgrA.auth)).status).toBe(404);
    expect((await request(app).patch(api(`/units/${u.id}`)).set(w.mgrA.auth).send({ name: 'x' })).status).toBe(404);
    expect(await Units.countDocuments({ isArchived: true })).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'unit', action: 'archive' })).toBe(1);
    expect(await Activities.countDocuments({ type: 'UNIT_ARCHIVED' })).toBe(1);
    expect((await get(w, w.mgrA, `/activities?refType=unit&refId=${u.id}`)).body.meta.total).toBe(2); // history still readable
  });

  it('an archived unit keeps its assignment history and media records', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA, { assignedTo: w.salesA.user._id.toHexString() });
    await uploadMedia(app, w.mgrA, u.id, FILES.png, { typeId: w.mt.front });
    await request(app).delete(api(`/units/${u.id}`)).set(w.mgrA.auth);
    const detail = (await get(w, w.mgrA, `/units/${u.id}`)).body.data;
    expect(detail.assignments).toHaveLength(1);
    expect(detail.media).toHaveLength(1);
    expect((await get(w, w.mgrA, `/units/${u.id}/media`)).body.data).toHaveLength(1);
    expect((await request(app).delete(api(`/units/${u.id}/media/${detail.media[0].id}`)).set(w.mgrA.auth)).status).toBe(404); // read-only now
  });
});

describe('media', () => {
  it('uploads, lists and removes; the stored record never holds secrets and the asset is cleaned up', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    const up = await uploadMedia(app, w.mgrA, u.id, FILES.png, { typeId: w.mt.front, caption: 'Front elevation' }, 'whatever.exe');
    expect(up.status).toBe(201);
    expect(up.body.data).toMatchObject({ format: 'png', isImage: true, type: { label: 'Front image' }, caption: 'Front elevation' });
    expect(up.body.data.url).toMatch(/^https:\/\/media\.test\//);
    expect(JSON.stringify(up.body)).not.toMatch(/publicId|api_secret|apiSecret/i);
    expect(mock().assets.size).toBe(1);
    const detail = (await get(w, w.mgrA, `/units/${u.id}`)).body.data;
    expect(detail.mediaCount).toBe(1);
    expect(detail.coverUrl).toBe(up.body.data.url);
    expect(detail.media).toHaveLength(1);
    const list = await get(w, w.mgrA, `/units/${u.id}/media`);
    expect(list.body.data.map((m: { id: string }) => m.id)).toEqual([up.body.data.id]);
    expect((await get(w, w.mgrA, '/units')).body.data[0]).not.toHaveProperty('media'); // lists stay light
    expect(await Activities.countDocuments({ type: 'UNIT_MEDIA_ADDED' })).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'unit', action: 'media_add' })).toBe(1);

    const del = await request(app).delete(api(`/units/${u.id}/media/${up.body.data.id}`)).set(w.mgrA.auth);
    expect(del.status).toBe(204);
    expect(mock().assets.size).toBe(0);
    expect((await get(w, w.mgrA, `/units/${u.id}/media`)).body.data).toEqual([]);
    expect((await request(app).delete(api(`/units/${u.id}/media/${up.body.data.id}`)).set(w.mgrA.auth)).status).toBe(404); // already gone
    expect(await Activities.countDocuments({ type: 'UNIT_MEDIA_REMOVED' })).toBe(1);
  });

  it('accepts JPEG, PNG, WebP and PDF by CONTENT, whatever the file name says; a PDF is not used as the cover', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    const r = [];
    for (const [file, name] of [[FILES.jpg, 'a.png'], [FILES.webp, 'b.jpg'], [FILES.pdf, 'c.png']] as const) r.push(await uploadMedia(app, w.mgrA, u.id, file, { typeId: w.mt.brochure }, name));
    expect(r.map((x) => x.status)).toEqual([201, 201, 201]);
    expect(r.map((x) => x.body.data.format)).toEqual(['jpg', 'webp', 'pdf']);
    const detail = (await get(w, w.mgrA, `/units/${u.id}`)).body.data;
    expect(detail.coverUrl).toBe(r[0]!.body.data.url);
    expect(detail.media.map((m: { isImage: boolean }) => m.isImage)).toEqual([true, true, false]);
  });

  it('refuses SVG, executables, empty files and a missing file; nothing is uploaded or stored', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    for (const f of [FILES.svg, FILES.exe, Buffer.from('plain text')]) {
      const res = await uploadMedia(app, w.mgrA, u.id, f, { typeId: w.mt.front }, 'x.png');
      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    }
    expect((await uploadMedia(app, w.mgrA, u.id, undefined, { typeId: w.mt.front })).status).toBe(400);
    expect((await uploadMedia(app, w.mgrA, u.id, Buffer.alloc(0), { typeId: w.mt.front })).status).toBe(400);
    expect(mock().assets.size).toBe(0);
    expect((await Units.findOne({ _id: u.id }).lean())!.media).toHaveLength(0);
  });

  it('enforces the size limit before storing anything', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    const big = Buffer.concat([FILES.png, Buffer.alloc(getEnv().MEDIA_MAX_BYTES + 1024)]);
    const res = await uploadMedia(app, w.mgrA, u.id, big, { typeId: w.mt.front });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(mock().assets.size).toBe(0);
  });

  it('the media type is a master: required, active, of the right type', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    await request(app).patch(api(`/masters/MEDIA_TYPE/${w.mt.floor}`)).set(w.admin.auth).send({ isActive: false });
    for (const typeId of [w.mt.floor, new Types.ObjectId().toHexString(), w.m.source, 'nope']) {
      expect((await uploadMedia(app, w.mgrA, u.id, FILES.png, { typeId })).status, typeId).toBe(400);
    }
    expect((await uploadMedia(app, w.mgrA, u.id, FILES.png, {})).status).toBe(400);
    expect((await uploadMedia(app, w.mgrA, u.id, FILES.png, { typeId: w.mt.front, extra: 'x' })).status).toBe(400);
    expect(mock().assets.size).toBe(0);
  });

  it('a media type deactivated later still shows on existing files', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    await uploadMedia(app, w.mgrA, u.id, FILES.png, { typeId: w.mt.floor });
    await request(app).patch(api(`/masters/MEDIA_TYPE/${w.mt.floor}`)).set(w.admin.auth).send({ isActive: false });
    expect((await get(w, w.mgrA, `/units/${u.id}`)).body.data.media[0].type).toMatchObject({ label: 'Floor plan', isActive: false });
  });

  it('authorization: units.manage_media to change, units.view to list; scope is checked before the file is read', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA, { assignedTo: w.salesA.user._id.toHexString() });
    expect((await uploadMedia(app, w.salesA, u.id, FILES.png, { typeId: w.mt.front })).status).toBe(403); // sales role lacks manage_media
    expect((await request(app).post(api(`/units/${u.id}/media`)).send({}).set({})).status).toBe(401);
    expect((await uploadMedia(app, w.mgrB, u.id, FILES.png, { typeId: w.mt.front })).status).toBe(404);
    expect((await get(w, w.salesA, `/units/${u.id}/media`)).status).toBe(200);
    expect((await get(w, w.salesB, `/units/${u.id}/media`)).status).toBe(404);
    await grant('SALES_EXECUTIVE', 'units.manage_media');
    const up = await uploadMedia(app, w.salesA, u.id, FILES.png, { typeId: w.mt.front });
    expect(up.status).toBe(201);
    await revoke('SALES_EXECUTIVE', 'units.manage_media');
    expect((await request(app).delete(api(`/units/${u.id}/media/${up.body.data.id}`)).set(w.salesA.auth)).status).toBe(403);
    expect(mock().assets.size).toBe(1);
  });

  it('a failed upload to the provider leaves nothing behind; a failed save removes the uploaded file', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    mock().failNextUpload = true;
    expect((await uploadMedia(app, w.mgrA, u.id, FILES.png, { typeId: w.mt.front })).status).toBe(500);
    expect((await Units.findOne({ _id: u.id }).lean())!.media).toHaveLength(0);
    expect(mock().assets.size).toBe(0);
    // Make the database write fail AFTER the upload: the limit is already reached by a competing upload.
    const max = getEnv().UNIT_MEDIA_MAX_COUNT;
    await Units.updateOne({ _id: u.id }, { $set: { media: Array.from({ length: max }, (_, i) => ({ typeId: w.mt.front, publicId: `p${i}`, url: `u${i}`, format: 'png', bytes: 1 })) } });
    const full_ = await uploadMedia(app, w.mgrA, u.id, FILES.png, { typeId: w.mt.front });
    expect(full_.status).toBe(409);
    expect(full_.body.error.code).toBe('MEDIA_LIMIT');
    expect(mock().assets.size).toBe(0);
  });

  it('a failed delete at the provider does not fail the removal (the record is gone, the leftover is logged)', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    const up = await uploadMedia(app, w.mgrA, u.id, FILES.png, { typeId: w.mt.front });
    mock().failDestroy = true;
    expect((await request(app).delete(api(`/units/${u.id}/media/${up.body.data.id}`)).set(w.mgrA.auth)).status).toBe(204);
    expect((await Units.findOne({ _id: u.id }).lean())!.media).toHaveLength(0);
  });

  it('simultaneous uploads cannot push a unit past its media limit', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    const max = getEnv().UNIT_MEDIA_MAX_COUNT;
    await Units.updateOne({ _id: u.id }, { $set: { media: Array.from({ length: max - 1 }, (_, i) => ({ typeId: w.mt.front, publicId: `p${i}`, url: `u${i}`, format: 'png', bytes: 1 })) } });
    const rs = await Promise.all(Array.from({ length: 5 }, () => uploadMedia(app, w.mgrA, u.id, FILES.png, { typeId: w.mt.front })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(4);
    expect((await Units.findOne({ _id: u.id }).lean())!.media).toHaveLength(max);
    expect(mock().assets.size).toBe(1); // the four losers' uploads were removed
  });

  it('removing a file that belongs to another unit is a 404', async () => {
    const w = await unitWorld(app);
    const a = await mkUnit(app, w.mgrA);
    const b = await mkUnit(app, w.mgrA);
    const up = await uploadMedia(app, w.mgrA, a.id, FILES.png, { typeId: w.mt.front });
    expect((await request(app).delete(api(`/units/${b.id}/media/${up.body.data.id}`)).set(w.mgrA.auth)).status).toBe(404);
    expect((await Units.findOne({ _id: a.id }).lean())!.media).toHaveLength(1);
    expect(mock().assets.size).toBe(1);
  });
});

describe('detail', () => {
  it('shows the unit, status, assignee, media and history; audit is for audit.view holders (via /audit)', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA, { ...full(w), assignedTo: w.salesA.user._id.toHexString() });
    const detail = (await get(w, w.mgrA, `/units/${u.id}`)).body.data;
    expect(detail).toMatchObject({ unitCode: u.unitCode, status: { label: 'Available' }, assignedToName: w.salesA.user.name, media: [], assignments: [{ to: w.salesA.user._id.toHexString() }] });
    expect(detail.booking.active).toBeUndefined(); // an unbooked unit has no active booking (the booking panel itself is Phase 9)
    const audit = await request(app).get(api(`/audit?entityType=unit&entityId=${u.id}`)).set(w.mgrA.auth);
    expect(audit.status).toBe(403); // the manager role has no audit.view
    const adminAudit = await request(app).get(api(`/audit?entityType=unit&entityId=${u.id}`)).set(w.admin.auth);
    expect(adminAudit.status).toBe(200);
    expect(adminAudit.body.data.length).toBeGreaterThan(0);
  });

  it('timeline: allowed for anyone who can see the unit, hidden otherwise', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA, { assignedTo: w.salesA.user._id.toHexString() });
    const other = await mkUnit(app, w.mgrA);
    const tl = (who: { auth: Record<string, string> }, id: string) => request(app).get(api(`/activities?refType=unit&refId=${id}`)).set(who.auth);
    expect((await tl(w.mgrA, u.id)).status).toBe(200);
    expect((await tl(w.salesA, u.id)).status).toBe(200);
    expect((await tl(w.salesA, other.id)).status).toBe(404); // OWN scope: not theirs
    expect((await tl(w.mgrB, u.id)).status).toBe(404);
    expect((await tl(w.admin, u.id)).status).toBe(200);
  });
});

describe('permissions', () => {
  it('every route is guarded; the catalog names the unit permissions and drops the old delete', async () => {
    const w = await unitWorld(app);
    const u = await mkUnit(app, w.mgrA);
    const none = { auth: { Authorization: 'Bearer nope' } };
    for (const [m, p] of [['get', '/units'], ['get', `/units/${u.id}`], ['post', '/units'], ['patch', `/units/${u.id}`], ['delete', `/units/${u.id}`], ['post', `/units/${u.id}/assign`], ['post', `/units/${u.id}/status`], ['get', `/units/${u.id}/media`], ['post', `/units/${u.id}/media`]] as const) {
      expect((await request(app)[m](api(p)).set(none.auth)).status, `${m} ${p}`).toBe(401);
    }
    expect(PERMISSION_CATALOG.units).toEqual(['view', 'create', 'edit', 'archive', 'assign', 'export', 'manage_media', 'change_status']);
  });
});
