import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { systemRepo } from '../../core/scope/system';
import { Activities, AuditLogs, makeUser, seedAll } from '../../test/factories';
import { api, assign, createEnquiryApi, enquiryWorld, grant, mkEnquiry, person, revoke, transition, type EW } from '../../test/enquiries';
import { createClientApi } from '../../test/people';
import { useTestDb } from '../../test/db';
import { Master } from '../masters/master.model';
import { Person } from '../persons/person.model';
import { Enquiry, EnquiryAssignment, EnquiryStageHistory } from './enquiry.model';

const app = buildApp();
const Enquiries = systemRepo(Enquiry, 'test', 'fixtures');
const History = systemRepo(EnquiryStageHistory, 'test', 'fixtures');
const Assignments = systemRepo(EnquiryAssignment, 'test', 'fixtures');
const People = systemRepo(Person, 'test', 'fixtures');
const Masters = systemRepo(Master, 'test', 'fixtures');

useTestDb();
beforeEach(seedAll);

const noList = (res: request.Response) => (res.body.data as { enquiryNo: string }[]).map((e) => e.enquiryNo);
const full = (w: EW) => ({ sourceId: w.m.source, typeId: w.m.type, propertyTypeId: w.m.property, buildingTypeId: w.m.building, locationId: w.m.locA });

describe('creating an enquiry', () => {
  it('creates it with a new person, in the creator\'s branch, in the first workflow stage', async () => {
    const w = await enquiryWorld(app);
    const res = await createEnquiryApi(app, w.mgrA, { person: { name: 'Raj Kumar', phone: '98765 43210', email: 'raj@x.com' }, ...full(w), notes: 'Wants a 3BHK' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      enquiryNo: 'ENQ-000001', name: 'Raj Kumar', phone: '+91 98765 43210', branchId: w.A, branch: { code: 'A' }, stageCode: 'NEW', stage: { systemKey: 'NEW', label: 'New' },
      source: { label: 'Website', isActive: true }, type: { label: 'Purchase' }, propertyType: { label: 'Villa' }, buildingType: { label: 'Independent' }, location: { label: 'Anna Nagar' }, notes: 'Wants a 3BHK', isArchived: false,
    });
    expect(res.body.data.id).not.toBe(res.body.data.enquiryNo);
    expect(res.body.data.assignedTo).toBeUndefined();
    const person_ = await People.findOne({}).lean();
    expect(person_).toMatchObject({ name: 'Raj Kumar', phoneE164: '+919876543210' });
    expect(person_!.branchIds!.map(String)).toEqual([w.A]);
  });

  it('records the initial stage history, audit, and a timeline activity that references the enquiry AND the person', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    expect(await History.find({ enquiryId: e.id }).lean()).toMatchObject([{ toStage: 'NEW', direction: 'CREATE' }]);
    const audit = await AuditLogs.findOne({ entityType: 'enquiry', action: 'create' }).lean();
    expect(String(audit!.entityId)).toBe(e.id);
    expect(String(audit!.branchId)).toBe(w.A);
    const act = await Activities.findOne({ type: 'ENQUIRY_CREATED' }).lean();
    expect(act!.refs.map((r) => `${r.type}:${r.id}`).sort()).toEqual([`enquiry:${e.id}`, `person:${e.personId}`].sort());
  });

  it('an OWN-scope creator owns what they create; ALL scope must choose a branch', async () => {
    const w = await enquiryWorld(app);
    const mine = await createEnquiryApi(app, w.salesA, { person: person() });
    expect(mine.body.data).toMatchObject({ assignedTo: w.salesA.user._id.toHexString() });
    expect(await Assignments.countDocuments({ enquiryId: mine.body.data.id })).toBe(1);
    expect((await createEnquiryApi(app, w.admin, { person: person() })).status).toBe(400);
    expect((await createEnquiryApi(app, w.admin, { person: person(), branchId: w.B })).status).toBe(201);
    expect((await createEnquiryApi(app, w.mgrA, { person: person(), branchId: w.B })).status).toBe(403);
  });

  it('may be assigned at creation, to an active user of the branch', async () => {
    const w = await enquiryWorld(app);
    const res = await createEnquiryApi(app, w.mgrA, { person: person(), assignedTo: w.salesA.user._id.toHexString() });
    expect(res.body.data).toMatchObject({ assignedToName: 'SALES_EXECUTIVE' });
    const rows = await Assignments.find({ enquiryId: res.body.data.id }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBeUndefined();
    expect((await createEnquiryApi(app, w.mgrA, { person: person(), assignedTo: w.salesB.user._id.toHexString() })).status).toBe(400);
    expect((await createEnquiryApi(app, w.salesA, { person: person(), assignedTo: w.salesA2.user._id.toHexString() })).status).toBe(403);
  });

  it('never creates a second person: an existing phone is reported (visible match) and nothing is written', async () => {
    const w = await enquiryWorld(app);
    const first = await mkEnquiry(app, w.mgrA, {}, { name: 'Raj Kumar', phone: '9876543210' });
    const res = await createEnquiryApi(app, w.mgrA, { person: { name: 'Other Name', phone: '+91-98765-43210' } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PERSON_EXISTS');
    expect(res.body.error.details).toMatchObject({ status: 'VISIBLE_MATCH', person: { id: first.personId, name: 'Raj Kumar' } });
    expect(await People.countDocuments()).toBe(1);
    expect(await Enquiries.countDocuments()).toBe(1);
  });

  it('a number that exists only in another branch is reported as existence-only, and creates nothing', async () => {
    const w = await enquiryWorld(app);
    await mkEnquiry(app, w.mgrA, {}, { name: 'Secret Sam', phone: '9876543210' });
    const res = await createEnquiryApi(app, w.mgrB, { person: { name: 'Sam', phone: '9876543210' } });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ status: 'HIDDEN_MATCH', phoneE164: '+919876543210', canLink: true });
    expect(JSON.stringify(res.body)).not.toMatch(/Secret/);
    expect(await Enquiries.countDocuments()).toBe(1);
  });

  it('"use this person" gives a second enquiry for the same person; a linked cross-branch person gets its own enquiry in the new branch', async () => {
    const w = await enquiryWorld(app);
    const a1 = await mkEnquiry(app, w.mgrA, {}, { name: 'Raj Kumar', phone: '9876543210' });
    const a2 = await createEnquiryApi(app, w.salesA, { personId: a1.personId });
    expect(a2.status).toBe(201);
    expect(a2.body.data).toMatchObject({ personId: a1.personId, enquiryNo: 'ENQ-000002', name: 'Raj Kumar' });
    // another branch cannot use the person by id until it is linked (same answer as a missing id)
    expect((await createEnquiryApi(app, w.mgrB, { personId: a1.personId })).status).toBe(404);
    expect((await createEnquiryApi(app, w.mgrB, { personId: new Types.ObjectId().toHexString() })).status).toBe(404);
    await request(app).post(api('/persons/link')).set(w.mgrB.auth).send({ phone: '9876543210', reason: 'Relocated' });
    const b = await createEnquiryApi(app, w.mgrB, { personId: a1.personId });
    expect(b.status).toBe(201);
    expect(b.body.data.branchId).toBe(w.B);
    expect(await People.countDocuments()).toBe(1);
  });

  it('is atomic: a rejected request leaves no person, no enquiry and no burnt data', async () => {
    const w = await enquiryWorld(app);
    const res = await createEnquiryApi(app, w.mgrA, { person: person(), sourceId: new Types.ObjectId().toHexString() });
    expect(res.status).toBe(400);
    expect(await People.countDocuments()).toBe(0);
    expect(await Enquiries.countDocuments()).toBe(0);
    expect(await Activities.countDocuments()).toBe(0);
  });

  it('validates strictly: shape, phone, and every field a client must not set', async () => {
    const w = await enquiryWorld(app);
    const bad: Record<string, unknown>[] = [
      {}, { person: { name: 'Raj', phone: 'abc' } }, { person: { name: 'R', phone: '9876543210' } }, { personId: 'x' },
      { personId: new Types.ObjectId().toHexString(), person: person() },
      { person: person(), status: 'INTERESTED' }, { person: person(), stageCode: 'INTERESTED' }, { person: person(), enquiryNo: 'ENQ-9' },
      { person: person(), lostReasonId: w.m.lost }, { person: person(), isArchived: true }, { person: person(), notes: 'x'.repeat(2001) },
      { person: person(), sourceId: 'garbage' },
    ];
    for (const b of bad) expect((await createEnquiryApi(app, w.mgrA, b)).status, JSON.stringify(b)).toBe(400);
    expect(await Enquiries.countDocuments()).toBe(0);
  });

  it('needs enquiries.create (401/403)', async () => {
    const w = await enquiryWorld(app);
    expect((await request(app).post(api('/enquiries')).send({})).status).toBe(401);
    await revoke('SALES_EXECUTIVE', 'enquiries.create');
    expect((await createEnquiryApi(app, w.salesA, { person: person() })).status).toBe(403);
  });
});

describe('Source is required (and stays master-driven)', () => {
  it('rejects a new enquiry without a source, with a field-level error, and writes nothing', async () => {
    const w = await enquiryWorld(app);
    for (const body of [{ sourceId: undefined }, { sourceId: null }, { sourceId: '' }]) {
      const res = await createEnquiryApi(app, w.mgrA, { person: person(), ...body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.some((d: { path: string }) => d.path === 'sourceId')).toBe(true);
    }
    expect(await Enquiries.countDocuments()).toBe(0);
    expect(await People.countDocuments()).toBe(0);
  });

  it('still validates the source against the master: unknown, malformed, wrong-type and inactive values are refused', async () => {
    const w = await enquiryWorld(app);
    await request(app).patch(api(`/masters/ENQUIRY_SOURCE/${w.m.source2}`)).set(w.admin.auth).send({ isActive: false });
    for (const sourceId of [new Types.ObjectId().toHexString(), 'garbage', w.m.type, w.m.lost, w.m.source2]) {
      const res = await createEnquiryApi(app, w.mgrA, { person: person(), sourceId });
      expect(res.status, sourceId).toBe(400);
      expect(res.body.error.details[0].path).toBe('sourceId');
    }
    expect((await createEnquiryApi(app, w.mgrA, { person: person(), sourceId: w.m.source })).status).toBe(201);
  });

  it('no other master is mandatory: a source alone is enough', async () => {
    const w = await enquiryWorld(app);
    const res = await createEnquiryApi(app, w.mgrA, { person: person(), sourceId: w.m.source });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ source: { label: 'Website' } });
    for (const f of ['type', 'propertyType', 'buildingType', 'location']) expect(res.body.data[f]).toBeUndefined();
  });

  it('applies to the "use this person" path too, and a missing source does not reveal or change person state', async () => {
    const w = await enquiryWorld(app);
    const first = await mkEnquiry(app, w.mgrA, {}, { name: 'Raj Kumar', phone: '9876543210' });
    const res = await createEnquiryApi(app, w.mgrA, { personId: first.personId, sourceId: undefined });
    expect(res.status).toBe(400);
    expect(await Enquiries.countDocuments()).toBe(1);
    expect((await createEnquiryApi(app, w.mgrA, { personId: first.personId })).status).toBe(201);
  });

  it('can be changed on an existing enquiry but never cleared', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const patch = (b: object) => request(app).patch(api(`/enquiries/${e.id}`)).set(w.mgrA.auth).send(b);
    expect((await patch({ sourceId: null })).status).toBe(400);
    expect((await patch({ sourceId: '' })).status).toBe(400);
    expect((await patch({ sourceId: w.m.source2 })).body.data.source.label).toBe('Walk-in');
    expect((await Enquiries.findOne({ _id: e.id }).lean())!.sourceId).toBeTruthy();
  });

  it('an older enquiry that has no source can still be edited, assigned and moved (the rule applies to new enquiries)', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    await Enquiries.updateOne({ _id: e.id }, { $unset: { sourceId: 1 } });
    expect((await request(app).patch(api(`/enquiries/${e.id}`)).set(w.mgrA.auth).send({ notes: 'legacy' })).status).toBe(200);
    expect((await assign(app, w.mgrA, e.id, { assignedTo: w.salesA.user._id.toHexString() })).status).toBe(200);
    expect((await transition(app, w.mgrA, e.id, { to: 'CONTACTED' })).status).toBe(200);
    expect((await request(app).get(api(`/enquiries/${e.id}`)).set(w.mgrA.auth)).body.data.source).toBeUndefined();
  });
});

describe('enquiry numbers', () => {
  it('are sequential and human-readable', async () => {
    const w = await enquiryWorld(app);
    expect([(await mkEnquiry(app, w.mgrA)).enquiryNo, (await mkEnquiry(app, w.mgrB)).enquiryNo, (await mkEnquiry(app, w.mgrA)).enquiryNo]).toEqual(['ENQ-000001', 'ENQ-000002', 'ENQ-000003']);
  });

  it('are unique and contiguous under concurrent creation (20 parallel creators, two branches)', async () => {
    const w = await enquiryWorld(app);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => createEnquiryApi(app, i % 2 ? w.mgrA : w.mgrB, { person: person() })));
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(201));
    const nos = results.map((r) => r.body.data.enquiryNo as string).sort();
    expect(nos).toEqual(Array.from({ length: 20 }, (_, i) => `ENQ-${String(i + 1).padStart(6, '0')}`));
  });

  it('are never reused (archiving keeps the number) and cannot be changed', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    await request(app).delete(api(`/enquiries/${e.id}`)).set(w.mgrA.auth);
    expect((await mkEnquiry(app, w.mgrA)).enquiryNo).toBe('ENQ-000002');
    await Enquiries.updateOne({ _id: e.id }, { enquiryNo: 'ENQ-999999' });
    expect((await Enquiries.findOne({ _id: e.id }).lean())!.enquiryNo).toBe('ENQ-000001');
    await expect(Enquiries.create({ enquiryNo: 'ENQ-000001', personId: new Types.ObjectId(), branchId: new Types.ObjectId(), personName: 'x', phoneE164: '+919876543210', stageCode: 'NEW', stageChangedAt: new Date() })).rejects.toMatchObject({ code: 11000 });
  });

  it('concurrent creation for the same new phone yields exactly one person and one enquiry', async () => {
    const w = await enquiryWorld(app);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => createEnquiryApi(app, i % 2 ? w.mgrA : w.salesA, { person: { name: `Racer ${i}`, phone: ['9876543210', '+919876543210'][i % 2] } })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 201).every((r) => r.status === 409 && r.body.error.code === 'PERSON_EXISTS')).toBe(true);
    expect(await People.countDocuments()).toBe(1);
    expect(await Enquiries.countDocuments()).toBe(1);
  });
});

describe('master references', () => {
  it('accepts active values of the right type and returns their labels', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA, full(w));
    const detail = (await request(app).get(api(`/enquiries/${e.id}`)).set(w.mgrA.auth)).body.data;
    expect([detail.source.label, detail.type.label, detail.propertyType.label, detail.buildingType.label, detail.location.label]).toEqual(['Website', 'Purchase', 'Villa', 'Independent', 'Anna Nagar']);
  });

  it.each([['sourceId', 'source'], ['typeId', 'type'], ['propertyTypeId', 'property'], ['buildingTypeId', 'building'], ['locationId', 'locA']] as const)('rejects an inactive, unknown, malformed or wrong-type %s for new enquiries', async (field, key) => {
    const w = await enquiryWorld(app);
    await request(app).patch(api(`/masters/${key === 'locA' ? 'LOCATION' : { source: 'ENQUIRY_SOURCE', type: 'ENQUIRY_TYPE', property: 'PROPERTY_TYPE', building: 'BUILDING_TYPE' }[key]}/${w.m[key]}`)).set(w.admin.auth).send({ isActive: false });
    for (const value of [w.m[key], new Types.ObjectId().toHexString(), w.m.lost]) {
      const res = await createEnquiryApi(app, w.mgrA, { person: person(), [field]: value });
      expect(res.status, `${field}=${value}`).toBe(400);
      expect(res.body.error.details[0].path).toBe(field);
    }
    expect(await Enquiries.countDocuments()).toBe(0);
  });

  it('LOCATION is branch-scoped: a location of another branch is rejected for managers AND for ALL-scope admins', async () => {
    const w = await enquiryWorld(app);
    const asMgr = await createEnquiryApi(app, w.mgrA, { person: person(), locationId: w.m.locB });
    expect(asMgr.status).toBe(400);
    expect(asMgr.body.error.details[0].path).toBe('locationId');
    const asAdmin = await createEnquiryApi(app, w.admin, { person: person(), branchId: w.A, locationId: w.m.locB });
    expect(asAdmin.status).toBe(400);
    expect(asAdmin.body.error.details[0].path).toBe('locationId');
    expect((await createEnquiryApi(app, w.admin, { person: person(), branchId: w.B, locationId: w.m.locB })).status).toBe(201);
    const e = await mkEnquiry(app, w.mgrA);
    expect((await request(app).patch(api(`/enquiries/${e.id}`)).set(w.mgrA.auth).send({ locationId: w.m.locB })).status).toBe(400);
  });

  it('history: a value deactivated later still displays on existing enquiries, which stay editable', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA, full(w));
    await request(app).patch(api(`/masters/ENQUIRY_SOURCE/${w.m.source}`)).set(w.admin.auth).send({ isActive: false });
    await request(app).patch(api(`/masters/LOCATION/${w.m.locA}`)).set(w.admin.auth).send({ isActive: false });
    const detail = (await request(app).get(api(`/enquiries/${e.id}`)).set(w.mgrA.auth)).body.data;
    expect(detail.source).toMatchObject({ label: 'Website', isActive: false });
    expect(detail.location).toMatchObject({ label: 'Anna Nagar', isActive: false });
    const list = (await request(app).get(api('/enquiries')).set(w.mgrA.auth)).body.data[0];
    expect(list.source).toMatchObject({ label: 'Website', isActive: false });
    // editing other fields, or re-sending the unchanged inactive value, is fine; CHOOSING an inactive one is not
    expect((await request(app).patch(api(`/enquiries/${e.id}`)).set(w.mgrA.auth).send({ notes: 'still editable' })).status).toBe(200);
    expect((await request(app).patch(api(`/enquiries/${e.id}`)).set(w.mgrA.auth).send({ sourceId: w.m.source })).status).toBe(200);
    expect((await request(app).patch(api(`/enquiries/${e.id}`)).set(w.mgrA.auth).send({ sourceId: w.m.source2 })).status).toBe(200);
    expect((await request(app).patch(api(`/enquiries/${e.id}`)).set(w.mgrA.auth).send({ sourceId: w.m.source })).status).toBe(400); // now a change back to an inactive one
  });

  it('reference protection: every master type an enquiry stores is blocked from deletion while in use (any branch, archived or not)', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA, full(w));
    await request(app).post(api(`/enquiries/${e.id}/lose`)).set(w.mgrA.auth).send({ lostReasonId: w.m.lost });
    await request(app).post(api(`/enquiries/${e.id}/reopen`)).set(w.mgrA.auth).send({ to: 'NEW', reason: 'came back' }); // lostReasonId now cleared, history keeps it
    await request(app).delete(api(`/enquiries/${e.id}`)).set(w.mgrA.auth); // archived enquiries still count
    const del = (type: string, id: string) => request(app).delete(api(`/masters/${type}/${id}`)).set(w.admin.auth);
    for (const [type, id] of [['ENQUIRY_SOURCE', w.m.source], ['ENQUIRY_TYPE', w.m.type], ['PROPERTY_TYPE', w.m.property], ['BUILDING_TYPE', w.m.building], ['LOCATION', w.m.locA], ['LOST_REASON', w.m.lost]] as const) {
      const res = await del(type, id);
      expect(res.status, type).toBe(409);
      expect(res.body.error.code, type).toBe('IN_USE');
    }
    // unused values of the same types CAN be deleted (checkers are registered, so they are provably unused)
    for (const [type, id] of [['ENQUIRY_SOURCE', w.m.source2], ['LOCATION', w.m.locB]] as const) expect((await del(type, id)).status, type).toBe(204);
    expect(await Masters.countDocuments({ _id: { $in: [w.m.source2, w.m.locB] } })).toBe(0);
  });
});

describe('updating descriptive fields', () => {
  it('changes masters and notes, clears with null, and audits before/after', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA, full(w));
    const res = await request(app).patch(api(`/enquiries/${e.id}`)).set(w.mgrA.auth).send({ sourceId: w.m.source2, notes: 'Updated', typeId: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ source: { label: 'Walk-in' }, notes: 'Updated' });
    expect(res.body.data.type).toBeUndefined();
    const audit = await AuditLogs.findOne({ entityType: 'enquiry', action: 'update' }).lean();
    expect(audit!.changes).toMatchObject({ sourceId: { from: w.m.source, to: w.m.source2 }, notes: { to: 'Updated' } });
    expect(await Activities.countDocuments({ type: 'ENQUIRY_UPDATED' })).toBe(1);
  });

  it('cannot touch stage, status, owner, branch, person, number or lost reason (each has its own controlled operation)', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    for (const bad of [{}, { stageCode: 'INTERESTED' }, { status: 'INTERESTED' }, { stage: 'INTERESTED' }, { assignedTo: w.salesA.user._id.toHexString() }, { branchId: w.B }, { personId: new Types.ObjectId().toHexString() }, { enquiryNo: 'ENQ-9' }, { lostReasonId: w.m.lost }, { isArchived: true }, { name: 'x' }]) {
      expect((await request(app).patch(api(`/enquiries/${e.id}`)).set(w.mgrA.auth).send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(await Enquiries.findOne({ _id: e.id }).lean()).toMatchObject({ stageCode: 'NEW' });
  });

  it('needs enquiries.edit; archived enquiries are read-only', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    await revoke('MANAGER', 'enquiries.edit');
    expect((await request(app).patch(api(`/enquiries/${e.id}`)).set(w.mgrA.auth).send({ notes: 'x' })).status).toBe(403);
    await grant('MANAGER', 'enquiries.edit');
    await request(app).delete(api(`/enquiries/${e.id}`)).set(w.mgrA.auth);
    expect((await request(app).patch(api(`/enquiries/${e.id}`)).set(w.mgrA.auth).send({ notes: 'x' })).status).toBe(404);
  });
});

describe('archiving', () => {
  it('soft-deletes: hidden by default, listed on request, readable, audited, timeline kept', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const sales = await mkEnquiry(app, w.salesA);
    expect((await request(app).delete(api(`/enquiries/${sales.id}`)).set(w.salesA.auth)).status).toBe(403); // no enquiries.archive
    await grant('SALES_EXECUTIVE', 'enquiries.archive');
    expect((await request(app).delete(api(`/enquiries/${e.id}`)).set(w.salesA.auth)).status).toBe(404); // with the permission, someone else's enquiry is still invisible (OWN)
    await revoke('SALES_EXECUTIVE', 'enquiries.archive');
    expect((await request(app).delete(api(`/enquiries/${e.id}`)).set(w.mgrA.auth)).status).toBe(204);
    expect((await request(app).get(api('/enquiries')).set(w.mgrA.auth)).body.meta.total).toBe(1);
    expect(noList(await request(app).get(api('/enquiries?isArchived=true')).set(w.mgrA.auth))).toEqual([e.enquiryNo]);
    expect((await request(app).get(api(`/enquiries/${e.id}`)).set(w.mgrA.auth)).body.data.isArchived).toBe(true);
    expect((await request(app).delete(api(`/enquiries/${e.id}`)).set(w.mgrA.auth)).status).toBe(404);
    expect(await Enquiries.countDocuments({ isArchived: true })).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'enquiry', action: 'archive' })).toBe(1);
    expect(await Activities.countDocuments({ type: 'ENQUIRY_ARCHIVED' })).toBe(1);
  });
});

describe('assignment', () => {
  const mgrAssign = (w: EW, id: string, to: string, reason?: string) => assign(app, w.mgrA, id, { assignedTo: to, ...(reason ? { reason } : {}) });

  it('a manager assigns within the branch; history, audit and activity are recorded', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const res = await mgrAssign(w, e.id, w.salesA.user._id.toHexString());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ assignedTo: w.salesA.user._id.toHexString(), assignedToName: 'SALES_EXECUTIVE' });
    const rows = await Assignments.find({ enquiryId: e.id }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ toUserId: w.salesA.user._id });
    expect(rows[0]!.fromUserId).toBeUndefined();
    expect(String(rows[0]!.byUserId)).toBe(w.mgrA.user._id.toHexString());
    expect(String(rows[0]!.branchId)).toBe(w.A);
    expect((await AuditLogs.findOne({ entityType: 'enquiry', action: 'assign' }).lean())!.changes).toMatchObject({ assignedTo: { to: w.salesA.user._id.toHexString() } });
    expect(await Activities.countDocuments({ type: 'ENQUIRY_ASSIGNED' })).toBe(1);
  });

  it('reassignment needs a reason and PRESERVES the history (nothing is overwritten)', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    await mgrAssign(w, e.id, w.salesA.user._id.toHexString());
    const noReason = await mgrAssign(w, e.id, w.salesA2.user._id.toHexString());
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.details[0].path).toBe('reason');
    expect((await mgrAssign(w, e.id, w.salesA2.user._id.toHexString(), 'Salesperson on leave')).status).toBe(200);

    const detail = (await request(app).get(api(`/enquiries/${e.id}`)).set(w.mgrA.auth)).body.data;
    expect(detail.assignments).toHaveLength(2);
    expect(detail.assignments[0]).toMatchObject({ toName: 'SALES_EXECUTIVE', byName: 'MANAGER' });
    expect(detail.assignments[1]).toMatchObject({ from: w.salesA.user._id.toHexString(), to: w.salesA2.user._id.toHexString(), reason: 'Salesperson on leave' });
    expect(await Assignments.countDocuments({ enquiryId: e.id })).toBe(2);
    expect((await AuditLogs.find({ action: 'assign' }).sort({ at: 1 }).lean())[1]!.reason).toBe('Salesperson on leave');
  });

  it('refuses a no-op and invalid assignees (other branch, inactive, unknown, malformed)', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    await mgrAssign(w, e.id, w.salesA.user._id.toHexString());
    expect((await mgrAssign(w, e.id, w.salesA.user._id.toHexString(), 'same')).body.error.code).toBe('NO_CHANGE');
    const inactive = await makeUser({ roleKey: 'SALES_EXECUTIVE', branches: [w.A], isActive: false });
    for (const to of [w.salesB.user._id.toHexString(), inactive.user._id.toHexString(), new Types.ObjectId().toHexString()]) {
      expect((await mgrAssign(w, e.id, to, 'because')).status, to).toBe(400);
    }
    expect((await assign(app, w.mgrA, e.id, { assignedTo: 'nope' })).status).toBe(400);
    expect((await assign(app, w.mgrA, e.id, { assignedTo: w.salesA2.user._id.toHexString(), reason: 'x', stageCode: 'LOST' })).status).toBe(400);
    expect(await Assignments.countDocuments({ enquiryId: e.id })).toBe(1);
  });

  it('is permission-based: Sales Executives (no enquiries.assign) cannot; OWN-scope holders can only take things for themselves', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.salesA);
    expect((await assign(app, w.salesA, e.id, { assignedTo: w.salesA2.user._id.toHexString(), reason: 'pass it on' })).status).toBe(403);
    await grant('SALES_EXECUTIVE', 'enquiries.assign');
    expect((await assign(app, w.salesA, e.id, { assignedTo: w.salesA2.user._id.toHexString(), reason: 'pass it on' })).status).toBe(403); // OWN: self only
    expect((await assign(app, w.salesA, e.id, { assignedTo: w.salesA.user._id.toHexString(), reason: 'x' })).body.error.code).toBe('NO_CHANGE');
    expect((await request(app).post(api(`/enquiries/${e.id}/assign`)).send({})).status).toBe(401);
    expect(await Assignments.countDocuments({ enquiryId: e.id })).toBe(1); // only the creation-time assignment
  });

  it('an enquiry of another branch cannot be assigned (404), even with a valid local assignee', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrB);
    expect((await mgrAssign(w, e.id, w.salesA.user._id.toHexString())).status).toBe(404);
    expect((await Enquiries.findOne({ _id: e.id }).lean())!.assignedTo).toBeUndefined();
  });

  it('ALL scope can assign in any branch, but the assignee must belong to the enquiry\'s branch', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrB);
    expect((await assign(app, w.admin, e.id, { assignedTo: w.salesB.user._id.toHexString() })).status).toBe(200);
    expect((await assign(app, w.admin, e.id, { assignedTo: w.salesA.user._id.toHexString(), reason: 'wrong branch' })).status).toBe(400);
  });

  it('simultaneous assignments cannot both silently win', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const results = await Promise.all([
      mgrAssign(w, e.id, w.salesA.user._id.toHexString(), 'one'),
      mgrAssign(w, e.id, w.salesA2.user._id.toHexString(), 'two'),
      mgrAssign(w, e.id, w.salesA.user._id.toHexString(), 'three'),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).map((r) => r.body.error.code).every((c) => ['ASSIGNMENT_CHANGED', 'NO_CHANGE'].includes(c))).toBe(true);
    expect(await Assignments.countDocuments({ enquiryId: e.id })).toBe(1);
  });

  it('the other branch never sees this enquiry\'s assignment history', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    await mgrAssign(w, e.id, w.salesA.user._id.toHexString());
    expect((await request(app).get(api(`/enquiries/${e.id}`)).set(w.mgrB.auth)).status).toBe(404);
    const asAdmin = (await request(app).get(api(`/enquiries/${e.id}`)).set(w.admin.auth)).body.data;
    expect(asAdmin.assignments).toHaveLength(1);
  });
});

describe('client projection stays in sync', () => {
  it('an identity change updates the name and phone on the person\'s enquiries in every branch, and search follows', async () => {
    const w = await enquiryWorld(app);
    const a = await mkEnquiry(app, w.mgrA, {}, { name: 'Raj Kumar', phone: '9876543210' });
    await request(app).post(api('/persons/link')).set(w.mgrB.auth).send({ phone: '9876543210', reason: 'Relocated' });
    await createEnquiryApi(app, w.mgrB, { personId: a.personId });
    const res = await request(app).patch(api(`/persons/${a.personId}`)).set(w.mgrA.auth).send({ name: 'Rajkumar S', phone: '9000000001' });
    expect(res.status).toBe(200);
    expect((await Enquiries.find({}).lean()).map((e) => [e.personName, e.phoneE164])).toEqual([['Rajkumar S', '+919000000001'], ['Rajkumar S', '+919000000001']]);
    expect(noList(await request(app).get(api('/enquiries?search=90000000')).set(w.mgrA.auth))).toEqual([a.enquiryNo]);
  });
});

describe('a person can already be a client (conversion is a later, controlled operation)', () => {
  it('creating an enquiry for an existing client person neither creates nor changes a client', async () => {
    const w = await enquiryWorld(app);
    const c = await createClientApi(app, w.mgrA, { person: { name: 'Raj Kumar', phone: '9876543210' } });
    const e = await createEnquiryApi(app, w.mgrA, { personId: c.body.data.personId });
    expect(e.status).toBe(201);
    expect(e.body.data.personId).toBe(c.body.data.personId);
    expect(e.body.data.stageCode).toBe('NEW');
    const clients = await request(app).get(api('/clients')).set(w.mgrA.auth);
    expect(clients.body.meta.total).toBe(1);
    expect(transition).toBeTypeOf('function');
  });
});
