import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { PERMISSION_CATALOG } from '../../core/permissions/catalog';
import { systemRepo } from '../../core/scope/system';
import { useTestDb } from '../../test/db';
import { Activities, AuditLogs, makeUser, seedAll } from '../../test/factories';
import { api, createClientApi, createReferralApi, freshPhone, fromClientApi, fromUserApi, getReferralApi, grant, linkApi, mkClient, mkEnquiry, mkExternal, referralWorld, revoke, setUserPhone } from '../../test/referrals';
import { Client } from '../clients/client.model';
import { Enquiry } from '../enquiries/enquiry.model';
import { Master } from '../masters/master.model';
import { isMasterReferenced } from '../masters/references';
import { Person } from '../persons/person.model';
import { Referral, ReferralAssignment } from './referral.model';

const app = buildApp();
const Referrals = systemRepo(Referral, 'test', 'fixtures');
const Assignments = systemRepo(ReferralAssignment, 'test', 'fixtures');
const People = systemRepo(Person, 'test', 'fixtures');
const Clients = systemRepo(Client, 'test', 'fixtures');
const Enquiries = systemRepo(Enquiry, 'test', 'fixtures');
const Masters = systemRepo(Master, 'test', 'fixtures');

useTestDb();
beforeEach(seedAll);

const uid = (a: { user: { _id: Types.ObjectId } }) => a.user._id.toHexString();
const nos = (res: request.Response) => (res.body.data as { referralNo: string }[]).map((r) => r.referralNo);
const list = (who: { auth: Record<string, string> }, q = '') => request(app).get(api(`/referrals${q}`)).set(who.auth);
const typeId = async (code: string) => String((await Masters.findOne({ type: 'REFERRAL_TYPE', code }).lean())!._id);

describe('external referrals', () => {
  it('creates the person and the referral together, in the creator\'s branch, as an EXTERNAL referrer', async () => {
    const w = await referralWorld(app);
    const phone = freshPhone();
    const res = await createReferralApi(app, w.mgrA, { person: { name: 'Ravi Referrer', phone, email: 'ravi@x.com' }, notes: 'Met at the expo', reason: 'Friend of the family' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ referralNo: 'REF-000001', name: 'Ravi Referrer', branchId: w.A, branch: { code: 'A' }, type: { label: 'External' }, notes: 'Met at the expo', reason: 'Friend of the family', enquiryCount: 0, isArchived: false });
    expect(res.body.data.typeId).toBe(await typeId('EXTERNAL'));
    expect(await People.countDocuments({})).toBe(1);
    const person = (await People.findOne({}).lean())!;
    expect(person).toMatchObject({ name: 'Ravi Referrer' });
    expect(person.branchIds!.map(String)).toEqual([w.A]);
    expect(String((await Referrals.findOne({}).lean())!.personId)).toBe(String(person._id));
    expect(await Enquiries.countDocuments({})).toBe(0); // a referral never creates an enquiry
    expect(await AuditLogs.findOne({ entityType: 'referral', action: 'create_external' }).lean()).toMatchObject({ reason: 'Friend of the family' });
    const act = await Activities.findOne({ type: 'REFERRAL_CREATED' }).lean();
    expect(act!.refs.map((r) => r.type).sort()).toEqual(['person', 'referral']);
  });

  it('has no commission, payout or status of any kind', async () => {
    const w = await referralWorld(app);
    const r = await mkExternal(app, w.mgrA);
    const detail = (await getReferralApi(app, w.mgrA, r.id)).body.data;
    expect(Object.keys(detail).filter((k) => /commission|percent|payout|payment|incentive|settle|status/i.test(k))).toEqual([]);
    for (const extra of [{ commission: 5 }, { commissionPercent: 2 }, { payout: 100 }, { status: 'CONVERTED' }, { incentive: 1 }]) {
      expect((await createReferralApi(app, w.mgrA, { person: { name: 'X Y', phone: freshPhone() }, ...extra })).status, JSON.stringify(extra)).toBe(400);
    }
  });

  it('the type is decided by the flow: a client-supplied type is refused', async () => {
    const w = await referralWorld(app);
    for (const extra of [{ typeId: await typeId('CLIENT') }, { type: 'EMPLOYEE' }, { branchId: w.B }]) {
      expect((await createReferralApi(app, w.mgrA, { person: { name: 'X Y', phone: freshPhone() }, ...extra })).status, JSON.stringify(extra)).not.toBe(201);
    }
    expect(await Referrals.countDocuments({})).toBe(0);
  });

  it('reuses an existing VISIBLE person by id without creating or changing it, and a second referral for them is refused', async () => {
    const w = await referralWorld(app);
    const c = await mkClient(app, w.mgrA, 'Existing Person');
    const before = (await People.findOne({ _id: c.personId }).lean())!;
    const res = await createReferralApi(app, w.mgrA, { personId: c.personId });
    expect(res.status).toBe(201);
    expect(res.body.data.personId).toBe(c.personId);
    expect(await People.countDocuments({})).toBe(1);
    const after = (await People.findOne({ _id: c.personId }).lean())!;
    expect({ name: after.name, phoneE164: after.phoneE164, email: after.email, address: after.address }).toEqual({ name: before.name, phoneE164: before.phoneE164, email: before.email, address: before.address });
    expect(after.updatedAt).toEqual(before.updatedAt);
    const again = await createReferralApi(app, w.mgrA, { personId: c.personId });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'REFERRAL_EXISTS', details: { referralNo: 'REF-000001' } });
    expect(await Referrals.countDocuments({})).toBe(1);
  });

  it('a phone that already belongs to a visible person is reported, never duplicated or merged', async () => {
    const w = await referralWorld(app);
    const phone = freshPhone();
    await createClientApi(app, w.mgrA, { person: { name: 'Known Person', phone } });
    const res = await createReferralApi(app, w.mgrA, { person: { name: 'Different Name', phone } });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'PERSON_EXISTS', details: { status: 'VISIBLE_MATCH', person: { name: 'Known Person' } } });
    expect(await People.countDocuments({})).toBe(1);
    expect(await Referrals.countDocuments({})).toBe(0);
    expect((await People.findOne({}).lean())!.name).toBe('Known Person');
  });

  it('a phone that exists only in another branch reveals existence only: no name, branch or detail, and nothing is created', async () => {
    const w = await referralWorld(app);
    const phone = freshPhone();
    await createClientApi(app, w.mgrB, { person: { name: 'Secret Name Elsewhere', phone, email: 'secret@x.com' } });
    const res = await createReferralApi(app, w.mgrA, { person: { name: 'Someone', phone } });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toMatchObject({ status: 'HIDDEN_MATCH' });
    const text = JSON.stringify(res.body);
    for (const leak of ['Secret Name Elsewhere', 'secret@x.com', w.B]) expect(text, leak).not.toContain(leak); // the number is the caller's own input, echoed as in every other identity answer
    expect(await People.countDocuments({})).toBe(1);
    expect(await Referrals.countDocuments({})).toBe(0);
  });

  it('a person id the caller cannot see is a 404, identical to a made-up id', async () => {
    const w = await referralWorld(app);
    const other = await mkClient(app, w.mgrB, 'B Person');
    const real = await createReferralApi(app, w.mgrA, { personId: other.personId });
    const fake = await createReferralApi(app, w.mgrA, { personId: new Types.ObjectId().toHexString() });
    expect([real.status, fake.status]).toEqual([404, 404]);
    expect(real.body.error.code).toBe(fake.body.error.code);
    expect(await Referrals.countDocuments({})).toBe(0);
  });

  it('validates the body: exactly one of personId / person, a valid phone, strict fields', async () => {
    const w = await referralWorld(app);
    const c = await mkClient(app, w.mgrA);
    for (const bad of [{}, { personId: c.personId, person: { name: 'X Y', phone: freshPhone() } }, { person: { name: 'X Y', phone: 'abc' } }, { person: { name: '', phone: freshPhone() } }, { personId: 'nope' }, { person: { name: 'X Y', phone: freshPhone() }, notes: 'n'.repeat(2001) }]) {
      expect((await createReferralApi(app, w.mgrA, bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('needs referrals.create', async () => {
    const w = await referralWorld(app);
    expect((await request(app).post(api('/referrals')).send({})).status).toBe(401);
    await revoke('SALES_EXECUTIVE', 'referrals.create');
    expect((await createReferralApi(app, w.salesA, { person: { name: 'X Y', phone: freshPhone() } })).status).toBe(403);
  });

  it('simultaneous creation with the SAME new phone: one referral, one person, the rest told the person exists', async () => {
    const w = await referralWorld(app);
    const phone = freshPhone();
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => createReferralApi(app, i % 2 ? w.mgrA : w.admin, { person: { name: 'Racing Person', phone }, ...(i % 2 ? {} : { branchId: w.A }) })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409).map((r) => r.body.error.code).every((c: string) => ['PERSON_EXISTS', 'REFERRAL_EXISTS'].includes(c))).toBe(true);
    expect(await People.countDocuments({})).toBe(1);
    expect(await Referrals.countDocuments({})).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'referral', action: 'create_external' })).toBe(1);
  }, 60_000);
});

describe('referral numbers', () => {
  it('are sequential, immutable, unique under concurrency and never reused', async () => {
    const w = await referralWorld(app);
    const first = await mkExternal(app, w.mgrA);
    expect(first.referralNo).toBe('REF-000001');
    expect((await request(app).patch(api(`/referrals/${first.id}`)).set(w.mgrA.auth).send({ referralNo: 'REF-9' })).status).toBe(400);
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => createReferralApi(app, i % 2 ? w.mgrA : w.admin, { person: { name: `Person ${i}`, phone: freshPhone() }, ...(i % 2 ? {} : { branchId: w.A }) })));
    expect(rs.map((r) => r.status)).toEqual(Array(12).fill(201));
    const got = rs.map((r) => r.body.data.referralNo as string);
    expect(new Set(got).size).toBe(12);
    await request(app).delete(api(`/referrals/${first.id}`)).set(w.mgrA.auth);
    const next = await mkExternal(app, w.mgrA);
    expect(got).not.toContain(next.referralNo);
    expect(next.referralNo).not.toBe('REF-000001'); // an archived referral's number is not recycled
  }, 90_000);

  it('the database refuses a duplicate number and a second ACTIVE referral of one person in a branch', async () => {
    const w = await referralWorld(app);
    const r = await mkExternal(app, w.mgrA);
    await Referral.init();
    const idx = (await Referral.collection.indexes()).find((i) => i.name === 'one_active_referral_per_person_per_branch');
    expect(idx).toMatchObject({ unique: true, key: { branchId: 1, personId: 1 }, partialFilterExpression: { isArchived: false } });
    const doc = (no: string, over: Record<string, unknown> = {}) => ({ referralNo: no, branchId: new Types.ObjectId(w.A), personId: new Types.ObjectId(r.personId), personName: 'x', phoneE164: '+919000000000', typeId: new Types.ObjectId(r.typeId), ...over });
    await expect(Referrals.create(doc('REF-000001', { personId: new Types.ObjectId() }))).rejects.toMatchObject({ code: 11000 });
    await expect(Referral.collection.insertOne({ ...doc('REF-900001'), isArchived: false })).rejects.toMatchObject({ code: 11000 });
    await Referrals.create(doc('REF-900002', { branchId: new Types.ObjectId(w.B) })); // another branch's record of the same person is allowed
    await Referrals.create(doc('REF-900003', { isArchived: true })); // archived history never blocks
  });
});

describe('converting an existing client', () => {
  it('uses the client\'s own person: nothing is retyped and no person is created', async () => {
    const w = await referralWorld(app);
    const c = await mkClient(app, w.mgrA, 'Client Becomes Referrer');
    const res = await fromClientApi(app, w.mgrA, c.id, { reason: 'Loved the service', notes: 'Knows many builders' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ referralNo: 'REF-000001', personId: c.personId, name: 'Client Becomes Referrer', branchId: w.A, type: { label: 'Client' }, sourceClientId: c.id, sourceClientNo: c.clientNo, reason: 'Loved the service' });
    expect(await People.countDocuments({})).toBe(1);
    expect(await Clients.countDocuments({})).toBe(1); // the client itself is untouched
    expect(await AuditLogs.findOne({ entityType: 'referral', action: 'convert_client' }).lean()).toMatchObject({ reason: 'Loved the service' });
    const act = await Activities.findOne({ type: 'REFERRAL_CREATED' }).lean();
    expect(act!.refs.map((r) => r.type).sort()).toEqual(['client', 'person', 'referral']);
    const detail = (await getReferralApi(app, w.mgrA, res.body.data.id)).body.data;
    expect(detail.sourceClient).toMatchObject({ id: c.id, clientNo: c.clientNo });
    expect(detail.person).toMatchObject({ id: c.personId, name: 'Client Becomes Referrer' });
  });

  it('is found through normal scope: another branch\'s, an unknown, a malformed or an archived client is refused', async () => {
    const w = await referralWorld(app);
    const b = await mkClient(app, w.mgrB);
    const archived = await mkClient(app, w.mgrA);
    await request(app).delete(api(`/clients/${archived.id}`)).set(w.mgrA.auth);
    for (const id of [b.id, new Types.ObjectId().toHexString(), archived.id]) expect((await fromClientApi(app, w.mgrA, id)).status, id).toBe(404);
    expect((await fromClientApi(app, w.mgrA, 'nope')).status).toBe(400);
    expect(await Referrals.countDocuments({})).toBe(0);
  });

  it('an OWN executive can convert only a client assigned to them', async () => {
    const w = await referralWorld(app);
    const mine = await mkClient(app, w.mgrA, 'Mine', { assignedTo: uid(w.salesA) });
    const theirs = await mkClient(app, w.mgrA, 'Theirs');
    expect((await fromClientApi(app, w.salesA, theirs.id)).status).toBe(404);
    const ok = await fromClientApi(app, w.salesA, mine.id);
    expect(ok.status).toBe(201);
    expect(ok.body.data.assignedTo).toBe(uid(w.salesA)); // an OWN creator owns what they create
  });

  it('converting twice (or retrying) is refused with the existing record; many at once create one', async () => {
    const w = await referralWorld(app);
    const c = await mkClient(app, w.mgrA);
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => fromClientApi(app, i % 2 ? w.mgrA : w.admin, c.id)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409).map((r) => r.body.error.code)).toEqual(Array(5).fill('REFERRAL_EXISTS'));
    expect(await Referrals.countDocuments({})).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'referral', action: 'convert_client' })).toBe(1);
    const winner = rs.find((r) => r.status === 201)!.body.data;
    const again = await fromClientApi(app, w.mgrA, c.id);
    expect(again.body.error).toMatchObject({ code: 'REFERRAL_EXISTS', details: { referralNo: winner.referralNo, referralId: winner.id } }); // numbers can have gaps: attempts that lose consume one
  }, 60_000);

  it('after the referral is archived the client can be converted again (a new number)', async () => {
    const w = await referralWorld(app);
    const c = await mkClient(app, w.mgrA);
    const first = (await fromClientApi(app, w.mgrA, c.id)).body.data;
    await request(app).delete(api(`/referrals/${first.id}`)).set(w.mgrA.auth);
    const second = await fromClientApi(app, w.mgrA, c.id);
    expect(second.status).toBe(201);
    expect(second.body.data.referralNo).not.toBe(first.referralNo);
    expect(await Referrals.countDocuments({ personId: c.personId })).toBe(2);
  });

  it('needs referrals.create and validates the optional fields', async () => {
    const w = await referralWorld(app);
    const c = await mkClient(app, w.mgrA);
    expect((await fromClientApi(app, w.mgrA, c.id, { type: 'EMPLOYEE' })).status).toBe(400);
    expect((await fromClientApi(app, w.mgrA, c.id, { assignedTo: uid(w.salesB) })).status).toBe(400); // an assignee of another branch
    await revoke('MANAGER', 'referrals.create');
    expect((await fromClientApi(app, w.mgrA, c.id)).status).toBe(403);
  });
});

describe('converting an existing employee', () => {
  it('creates the person from the employee\'s name and phone, in one transaction, and keeps the source employee', async () => {
    const w = await referralWorld(app);
    const phone = freshPhone();
    await setUserPhone(w.salesA.user._id, phone);
    const res = await fromUserApi(app, w.mgrA, uid(w.salesA), { reason: 'Colleague with a network' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ referralNo: 'REF-000001', type: { label: 'Employee' }, sourceUserId: uid(w.salesA), branchId: w.A, name: w.salesA.user.name });
    expect(await People.countDocuments({})).toBe(1);
    expect((await People.findOne({}).lean())!.phoneE164).toBe(`+91${phone}`);
    expect(await AuditLogs.findOne({ entityType: 'referral', action: 'convert_employee' }).lean()).toBeTruthy();
    const detail = (await getReferralApi(app, w.mgrA, res.body.data.id)).body.data;
    expect(detail.sourceEmployee).toMatchObject({ id: uid(w.salesA), name: w.salesA.user.name });
  });

  it('reuses an existing visible person with the employee\'s phone instead of creating another', async () => {
    const w = await referralWorld(app);
    const phone = freshPhone();
    const c = await createClientApi(app, w.mgrA, { person: { name: 'Same Human', phone } });
    await setUserPhone(w.salesA.user._id, phone);
    const res = await fromUserApi(app, w.mgrA, uid(w.salesA));
    expect(res.status).toBe(201);
    expect(res.body.data.personId).toBe(c.body.data.personId);
    expect(res.body.data.name).toBe('Same Human'); // the existing identity is not rewritten
    expect(await People.countDocuments({})).toBe(1);
  });

  it('a person that exists only in another branch is never attached or revealed', async () => {
    const w = await referralWorld(app);
    const phone = freshPhone();
    await createClientApi(app, w.mgrB, { person: { name: 'Hidden Customer', phone } });
    await setUserPhone(w.salesA.user._id, phone);
    const res = await fromUserApi(app, w.mgrA, uid(w.salesA));
    expect(res.status).toBe(409);
    expect(res.body.error.details).toMatchObject({ status: 'HIDDEN_MATCH' });
    expect(JSON.stringify(res.body)).not.toContain('Hidden Customer');
    expect(await Referrals.countDocuments({})).toBe(0);
    expect(await People.countDocuments({})).toBe(1);
  });

  it('refuses inactive employees, employees without a usable phone, invisible employees and a branch the employee is not in', async () => {
    const w = await referralWorld(app);
    const inactive = await makeUser({ roleKey: 'SALES_EXECUTIVE', branches: [w.A], isActive: false });
    await setUserPhone(inactive.user._id, freshPhone());
    expect((await fromUserApi(app, w.mgrA, inactive.user._id.toHexString())).status).toBe(400);
    expect((await fromUserApi(app, w.mgrA, uid(w.salesA))).body.error.details[0].message).toMatch(/Phone number missing/); // no phone yet
    await setUserPhone(w.salesA.user._id, '12ab');
    expect((await fromUserApi(app, w.mgrA, uid(w.salesA))).status).toBe(400);
    await setUserPhone(w.salesB.user._id, freshPhone());
    expect((await fromUserApi(app, w.mgrA, uid(w.salesB))).status).toBe(404); // an employee of another branch is invisible
    await setUserPhone(w.salesA.user._id, freshPhone());
    expect((await fromUserApi(app, w.admin, uid(w.salesA), { branchId: w.B })).status).toBe(400); // not the employee's branch
    expect(await Referrals.countDocuments({})).toBe(0); // every refusal above left nothing behind
    const ok = await fromUserApi(app, w.admin, uid(w.salesA)); // an employee of exactly one branch needs no branch to be chosen, even by an ALL-scope user
    expect(ok.status).toBe(201);
    expect(ok.body.data.branchId).toBe(w.A);
  });

  it('converting the same employee twice or at once creates one referral', async () => {
    const w = await referralWorld(app);
    await setUserPhone(w.salesA.user._id, freshPhone());
    const rs = await Promise.all(Array.from({ length: 5 }, () => fromUserApi(app, w.mgrA, uid(w.salesA))));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await Referrals.countDocuments({})).toBe(1);
    expect(await People.countDocuments({})).toBe(1);
  }, 60_000);

  it('an OWN executive can convert only themself', async () => {
    const w = await referralWorld(app);
    await setUserPhone(w.salesA.user._id, freshPhone());
    await setUserPhone(w.salesA2.user._id, freshPhone());
    expect((await fromUserApi(app, w.salesA, uid(w.salesA2))).status).toBe(404);
    expect((await fromUserApi(app, w.salesA, uid(w.salesA))).status).toBe(201);
  });
});

describe('scope', () => {
  it('BRANCH sees its branch; ALL sees everything and can narrow; a foreign branch filter is refused', async () => {
    const w = await referralWorld(app);
    const a = await mkExternal(app, w.mgrA);
    const b = await mkExternal(app, w.mgrB);
    expect(nos(await list(w.mgrA))).toEqual([a.referralNo]);
    expect(nos(await list(w.mgrB))).toEqual([b.referralNo]);
    expect(nos(await list(w.admin)).sort()).toEqual([a.referralNo, b.referralNo].sort());
    expect(nos(await list(w.admin, `?branchId=${w.B}`))).toEqual([b.referralNo]);
    const widen = await list(w.mgrA, `?branchId=${w.B}`);
    expect(widen.status).toBe(403);
    expect(widen.body.data).toBeUndefined();
  });

  it('cross-branch access is a 404 on every operation, identical to a missing id', async () => {
    const w = await referralWorld(app);
    const b = await mkExternal(app, w.mgrB);
    const e = await mkEnquiry(app, w.mgrA);
    const ghost = new Types.ObjectId().toHexString();
    const probes = (id: string) => [
      getReferralApi(app, w.mgrA, id),
      request(app).patch(api(`/referrals/${id}`)).set(w.mgrA.auth).send({ notes: 'x' }),
      request(app).delete(api(`/referrals/${id}`)).set(w.mgrA.auth),
      request(app).post(api(`/referrals/${id}/assign`)).set(w.mgrA.auth).send({ assignedTo: uid(w.salesA) }),
      linkApi(app, w.mgrA, id, e.id),
      request(app).post(api(`/referrals/${id}/enquiries/${e.id}/unlink`)).set(w.mgrA.auth).send({ reason: 'mistake' }),
    ];
    const real = await Promise.all(probes(b.id));
    const fake = await Promise.all(probes(ghost));
    expect(real.map((r) => r.status)).toEqual(Array(6).fill(404));
    expect(real.map((r) => r.body.error.code)).toEqual(fake.map((r) => r.body.error.code));
    expect((await Referrals.findOne({ _id: b.id }).lean())!.isArchived).toBe(false);
  });

  it('OWN sees only referrals assigned to them, whatever the filters say', async () => {
    const w = await referralWorld(app);
    const mine = await mkExternal(app, w.mgrA, 'Mine', { assignedTo: uid(w.salesA) });
    const other = await mkExternal(app, w.mgrA, 'Other');
    const theirs = await mkExternal(app, w.mgrA, 'Theirs', { assignedTo: uid(w.salesA2) });
    expect(nos(await list(w.salesA))).toEqual([mine.referralNo]);
    expect(nos(await list(w.salesA, `?assignedTo=${uid(w.salesA2)}`))).toEqual([]);
    expect(nos(await list(w.salesA, '?assignedTo=unassigned'))).toEqual([]);
    expect(nos(await list(w.salesA, `?search=${other.referralNo}`))).toEqual([]);
    expect((await getReferralApi(app, w.salesA, other.id)).status).toBe(404);
    expect((await getReferralApi(app, w.salesA, theirs.id)).status).toBe(404);
    expect((await getReferralApi(app, w.salesA, mine.id)).status).toBe(200);
    expect((await list(w.salesA, `?branchId=${w.B}`)).status).toBe(403);
  });

  it('every route is guarded', async () => {
    const w = await referralWorld(app);
    const r = await mkExternal(app, w.mgrA);
    const none = { Authorization: 'Bearer nope' };
    for (const [m, p] of [['get', '/referrals'], ['post', '/referrals'], ['post', `/referrals/from-client/${r.id}`], ['post', `/referrals/from-user/${r.id}`], ['get', `/referrals/${r.id}`], ['patch', `/referrals/${r.id}`], ['delete', `/referrals/${r.id}`], ['post', `/referrals/${r.id}/assign`], ['post', `/referrals/${r.id}/enquiries`]] as const) {
      expect((await request(app)[m](api(p)).set(none)).status, `${m} ${p}`).toBe(401);
    }
    expect(PERMISSION_CATALOG.referrals).toEqual(['view', 'create', 'edit', 'archive', 'assign', 'export']);
  });
});

describe('listing, search and filters (server-side)', () => {
  it('searches by number, bare number, name and phone; filters by type, assignee and dates; sorts and paginates', async () => {
    const w = await referralWorld(app);
    const phone = freshPhone();
    const a = (await createReferralApi(app, w.mgrA, { person: { name: 'Anita Verma', phone }, assignedTo: uid(w.salesA) })).body.data;
    const c = await mkClient(app, w.mgrA, 'Bala Krishnan');
    const b = (await fromClientApi(app, w.mgrA, c.id)).body.data;
    expect(nos(await list(w.mgrA, `?search=${a.referralNo}`))).toEqual([a.referralNo]);
    expect(nos(await list(w.mgrA, '?search=2'))).toEqual([b.referralNo]);
    expect(nos(await list(w.mgrA, '?search=anita'))).toEqual([a.referralNo]);
    expect(nos(await list(w.mgrA, `?search=${phone}`))).toEqual([a.referralNo]);
    expect(nos(await list(w.mgrA, `?search=${encodeURIComponent('+91 ' + phone.slice(0, 5) + ' ' + phone.slice(5))}`))).toEqual([a.referralNo]);
    expect(nos(await list(w.mgrA, '?search=%5E.*'))).toEqual([]);
    expect(nos(await list(w.mgrA, `?typeId=${b.typeId}`))).toEqual([b.referralNo]);
    expect(nos(await list(w.mgrA, `?assignedTo=${uid(w.salesA)}`))).toEqual([a.referralNo]);
    expect(nos(await list(w.mgrA, '?assignedTo=unassigned'))).toEqual([b.referralNo]);
    expect(nos(await list(w.mgrA, `?from=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`))).toEqual([]);
    expect(nos(await list(w.mgrA, `?to=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}&sort=referralNo`))).toEqual([a.referralNo, b.referralNo]);
    expect(nos(await list(w.mgrA, '?sort=-personName'))).toEqual([b.referralNo, a.referralNo]);
    const p = await list(w.mgrA, '?sort=referralNo&limit=1&page=2');
    expect(nos(p)).toEqual([b.referralNo]);
    expect(p.body.meta).toMatchObject({ page: 2, limit: 1, total: 2 });
    for (const bad of ['?limit=1000', '?typeId=nope', '?assignedTo=nope', '?from=garbage']) expect((await list(w.mgrA, bad)).status, bad).toBe(400);
  });

  it('a person rename updates the referral projection', async () => {
    const w = await referralWorld(app);
    const r = await mkExternal(app, w.mgrA);
    await request(app).patch(api(`/persons/${r.personId}`)).set(w.mgrA.auth).send({ name: 'Renamed Referrer' });
    expect(nos(await list(w.mgrA, '?search=Renamed'))).toEqual([r.referralNo]);
  });
});

describe('master references', () => {
  it('REFERRAL_TYPE is tracked as referenced by any referral; a type deactivated later still displays', async () => {
    const w = await referralWorld(app);
    const r = await mkExternal(app, w.mgrA);
    expect(await isMasterReferenced('REFERRAL_TYPE', new Types.ObjectId(r.typeId))).toBe(true);
    expect(await isMasterReferenced('REFERRAL_TYPE', new Types.ObjectId(await typeId('CLIENT')))).toBe(false);
    const del = await request(app).delete(api(`/masters/REFERRAL_TYPE/${r.typeId}`)).set(w.admin.auth);
    expect(del.status).toBe(409);
    await Masters.updateOne({ _id: r.typeId }, { $set: { isActive: false } }); // an administrator-retired value (fixture: system values cannot be retired through the API)
    const detail = (await getReferralApi(app, w.mgrA, r.id)).body.data;
    expect(detail.type).toMatchObject({ label: 'External', isActive: false });
    expect((await list(w.mgrA)).body.data[0].type).toMatchObject({ isActive: false });
    expect((await request(app).patch(api(`/referrals/${r.id}`)).set(w.mgrA.auth).send({ notes: 'still editable' })).status).toBe(200);
    expect((await mkExternal(app, w.mgrA, 'Another')).typeId).toBe(r.typeId); // creation does not depend on the master being active (flow-owned system value)
  });
});

describe('update and assignment', () => {
  it('edits notes only, with audit before/after; identity is edited on the person', async () => {
    const w = await referralWorld(app);
    const r = await mkExternal(app, w.mgrA, 'Ravi', { notes: 'first' });
    const res = await request(app).patch(api(`/referrals/${r.id}`)).set(w.mgrA.auth).send({ notes: 'second' });
    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('second');
    expect(await AuditLogs.findOne({ entityType: 'referral', action: 'update' }).lean()).toMatchObject({ changes: { notes: { from: 'first', to: 'second' } } });
    expect(await Activities.countDocuments({ type: 'REFERRAL_UPDATED' })).toBe(1);
    expect((await request(app).patch(api(`/referrals/${r.id}`)).set(w.mgrA.auth).send({ notes: null })).body.data.notes).toBeUndefined();
    for (const bad of [{}, { name: 'Hacked' }, { phone: freshPhone() }, { typeId: r.typeId }, { branchId: w.B }, { personId: r.personId }, { assignedTo: uid(w.salesA) }, { enquiryIds: [] }]) {
      expect((await request(app).patch(api(`/referrals/${r.id}`)).set(w.mgrA.auth).send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    await revoke('MANAGER', 'referrals.edit');
    expect((await request(app).patch(api(`/referrals/${r.id}`)).set(w.mgrA.auth).send({ notes: 'x' })).status).toBe(403);
  });

  it('assigns and reassigns with a reason, keeping the history, audit and timeline', async () => {
    const w = await referralWorld(app);
    const r = await mkExternal(app, w.mgrA);
    const assign = (to: string, reason?: string) => request(app).post(api(`/referrals/${r.id}/assign`)).set(w.mgrA.auth).send({ assignedTo: to, ...(reason ? { reason } : {}) });
    expect((await assign(uid(w.salesA))).status).toBe(200);
    expect((await assign(uid(w.salesA2))).status).toBe(400); // reason required to reassign
    const re = await assign(uid(w.salesA2), 'Balancing workload');
    expect(re.body.data).toMatchObject({ assignedTo: uid(w.salesA2) });
    const detail = (await getReferralApi(app, w.mgrA, r.id)).body.data;
    expect(detail.assignments).toHaveLength(2);
    expect(detail.assignments[1]).toMatchObject({ from: uid(w.salesA), to: uid(w.salesA2), by: uid(w.mgrA), reason: 'Balancing workload' });
    expect(await AuditLogs.countDocuments({ entityType: 'referral', action: 'assign' })).toBe(2);
    expect(await Activities.countDocuments({ type: 'REFERRAL_ASSIGNED' })).toBe(2);
    expect((await assign(uid(w.salesA2), 'again')).body.error.code).toBe('NO_CHANGE');
  });

  it('refuses invalid assignees, OWN users handing work to others, and a missing permission; simultaneous assignments: one wins', async () => {
    const w = await referralWorld(app);
    const r = await mkExternal(app, w.mgrA);
    const inactive = await makeUser({ roleKey: 'SALES_EXECUTIVE', branches: [w.A], isActive: false });
    for (const to of [uid(w.salesB), inactive.user._id.toHexString(), new Types.ObjectId().toHexString(), 'nope']) {
      expect((await request(app).post(api(`/referrals/${r.id}/assign`)).set(w.mgrA.auth).send({ assignedTo: to })).status, to).toBe(400);
    }
    expect(await Assignments.countDocuments({ referralId: r.id })).toBe(0);
    await grant('SALES_EXECUTIVE', 'referrals.assign');
    const mine = await mkExternal(app, w.mgrA, 'Mine', { assignedTo: uid(w.salesA) });
    expect((await request(app).post(api(`/referrals/${mine.id}/assign`)).set(w.salesA.auth).send({ assignedTo: uid(w.salesA2), reason: 'pass on' })).status).toBe(403);
    await revoke('SALES_EXECUTIVE', 'referrals.assign');
    expect((await request(app).post(api(`/referrals/${mine.id}/assign`)).set(w.salesA.auth).send({ assignedTo: uid(w.salesA), reason: 'x' })).status).toBe(403);
    const [x, y] = await Promise.all([
      request(app).post(api(`/referrals/${r.id}/assign`)).set(w.mgrA.auth).send({ assignedTo: uid(w.salesA) }),
      request(app).post(api(`/referrals/${r.id}/assign`)).set(w.mgrA.auth).send({ assignedTo: uid(w.salesA2) }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await Assignments.countDocuments({ referralId: r.id })).toBe(1);
  });
});

describe('archiving', () => {
  it('soft-deletes: hidden by default, listed on request, readable, audited, timeline kept, person untouched', async () => {
    const w = await referralWorld(app);
    const r = await mkExternal(app, w.mgrA);
    expect((await request(app).delete(api(`/referrals/${r.id}`)).set(w.salesA.auth)).status).toBe(403);
    expect((await request(app).delete(api(`/referrals/${r.id}`)).set(w.mgrA.auth)).status).toBe(204);
    expect((await list(w.mgrA)).body.meta.total).toBe(0);
    expect(nos(await list(w.mgrA, '?isArchived=true'))).toEqual([r.referralNo]);
    const detail = (await getReferralApi(app, w.mgrA, r.id)).body.data;
    expect(detail.isArchived).toBe(true);
    expect(detail.allowed).toMatchObject({ edit: false, assign: false, link: false, archive: false });
    expect((await request(app).delete(api(`/referrals/${r.id}`)).set(w.mgrA.auth)).status).toBe(404);
    expect((await request(app).patch(api(`/referrals/${r.id}`)).set(w.mgrA.auth).send({ notes: 'x' })).status).toBe(404);
    expect(await People.countDocuments({ _id: r.personId })).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'referral', action: 'archive' })).toBe(1);
    expect(await Activities.countDocuments({ type: 'REFERRAL_ARCHIVED' })).toBe(1);
    expect((await request(app).get(api(`/activities?refType=referral&refId=${r.id}`)).set(w.mgrA.auth)).body.meta.total).toBe(2);
  });
});

describe('linking to enquiries', () => {
  it('links an enquiry without creating one; both sides show the relationship', async () => {
    const w = await referralWorld(app);
    const r = await mkExternal(app, w.mgrA, 'Referrer One');
    const e = await mkEnquiry(app, w.mgrA);
    const before = await Enquiries.countDocuments({});
    const res = await linkApi(app, w.mgrA, r.id, e.id);
    expect(res.status).toBe(200);
    expect(res.body.data.enquiryCount).toBe(1);
    expect(await Enquiries.countDocuments({})).toBe(before);
    const detail = (await getReferralApi(app, w.mgrA, r.id)).body.data;
    expect(detail.enquiries).toMatchObject([{ id: e.id, enquiryNo: e.enquiryNo, stageLabel: 'New' }]);
    const enquiry = (await request(app).get(api(`/enquiries/${e.id}`)).set(w.mgrA.auth)).body.data;
    expect(enquiry.referral).toMatchObject({ id: r.id, referralNo: r.referralNo, name: 'Referrer One' });
    expect(nos(await list(w.mgrA, `?enquiryId=${e.id}`))).toEqual([r.referralNo]);
    expect(await AuditLogs.findOne({ entityType: 'referral', action: 'link' }).lean()).toBeTruthy();
    const act = await Activities.findOne({ type: 'REFERRAL_LINKED' }).lean();
    expect(act!.refs.map((x) => x.type).sort()).toEqual(['enquiry', 'person', 'person', 'referral']);
    const tl = await request(app).get(api(`/activities?refType=enquiry&refId=${e.id}`)).set(w.mgrA.auth);
    expect(tl.body.data.map((a: { type: string }) => a.type)).toContain('REFERRAL_LINKED');
  });

  it('is idempotent for the same pair; another referral cannot take a linked enquiry; simultaneous links: one wins', async () => {
    const w = await referralWorld(app);
    const r1 = await mkExternal(app, w.mgrA, 'R One');
    const r2 = await mkExternal(app, w.mgrA, 'R Two');
    const e = await mkEnquiry(app, w.mgrA);
    expect((await linkApi(app, w.mgrA, r1.id, e.id)).status).toBe(200);
    expect((await linkApi(app, w.mgrA, r1.id, e.id)).status).toBe(200);
    expect((await Referrals.findOne({ _id: r1.id }).lean())!.enquiryIds).toHaveLength(1);
    expect(await AuditLogs.countDocuments({ entityType: 'referral', action: 'link' })).toBe(1);
    expect((await linkApi(app, w.mgrA, r2.id, e.id)).body.error.code).toBe('ENQUIRY_ALREADY_REFERRED');
    const e2 = await mkEnquiry(app, w.mgrA);
    const [x, y] = await Promise.all([linkApi(app, w.mgrA, r1.id, e2.id), linkApi(app, w.mgrA, r2.id, e2.id)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const total = (await Referrals.find({}).lean()).reduce((n, r) => n + (r.enquiryIds?.length ?? 0), 0);
    expect(total).toBe(2); // e (r1) and e2 (the winner), never twice
    expect(String((await Enquiries.findOne({ _id: e2.id }).lean())!.referralId)).toBe(String((await Referrals.findOne({ enquiryIds: new Types.ObjectId(e2.id) }).lean())!._id));
  });

  it('refuses another branch\'s enquiry (404 / 400 for ALL scope) and a person referring themselves', async () => {
    const w = await referralWorld(app);
    const r = await mkExternal(app, w.mgrA);
    const other = await mkEnquiry(app, w.mgrB);
    expect((await linkApi(app, w.mgrA, r.id, other.id)).status).toBe(404);
    expect((await linkApi(app, w.admin, r.id, other.id)).status).toBe(400);
    const own = await mkEnquiry(app, w.mgrA, {}, { name: 'Self Referrer', phone: freshPhone() });
    const selfRef = (await createReferralApi(app, w.mgrA, { personId: (await Enquiries.findOne({ _id: own.id }).lean())!.personId.toString() })).body.data;
    expect((await linkApi(app, w.mgrA, selfRef.id, own.id)).body.error.details[0].path).toBe('enquiryId');
    expect((await linkApi(app, w.mgrA, r.id, new Types.ObjectId().toHexString())).status).toBe(404);
    expect((await linkApi(app, w.mgrA, r.id, 'nope')).status).toBe(400);
  });

  it('an OWN executive can link only enquiries they can see, and the detail lists only visible enquiries', async () => {
    const w = await referralWorld(app);
    const r = await mkExternal(app, w.mgrA, 'Shared Referrer', { assignedTo: uid(w.salesA) });
    const mine = await mkEnquiry(app, w.mgrA, { assignedTo: uid(w.salesA) });
    const theirs = await mkEnquiry(app, w.mgrA, { assignedTo: uid(w.salesA2) });
    expect((await linkApi(app, w.salesA, r.id, mine.id)).status).toBe(403); // sales executives do not hold referrals.edit by default
    await grant('SALES_EXECUTIVE', 'referrals.edit');
    expect((await linkApi(app, w.salesA, r.id, theirs.id)).status).toBe(404);
    expect((await linkApi(app, w.salesA, r.id, mine.id)).status).toBe(200);
    expect((await linkApi(app, w.mgrA, r.id, theirs.id)).status).toBe(200);
    const asSales = (await getReferralApi(app, w.salesA, r.id)).body.data;
    expect(asSales.enquiryCount).toBe(2); // the count is the referral's own fact
    expect(asSales.enquiries.map((e: { id: string }) => e.id)).toEqual([mine.id]); // but only the enquiry they can see is listed
  });

  it('unlinking needs a reason and clears both sides', async () => {
    const w = await referralWorld(app);
    const r = await mkExternal(app, w.mgrA);
    const e = await mkEnquiry(app, w.mgrA);
    await linkApi(app, w.mgrA, r.id, e.id);
    const unlink = (body: Record<string, unknown>) => request(app).post(api(`/referrals/${r.id}/enquiries/${e.id}/unlink`)).set(w.mgrA.auth).send(body);
    expect((await unlink({})).status).toBe(400);
    expect((await unlink({ reason: 'Linked by mistake' })).status).toBe(200);
    expect((await Referrals.findOne({ _id: r.id }).lean())!.enquiryIds).toHaveLength(0);
    expect((await Enquiries.findOne({ _id: e.id }).lean())!.referralId).toBeUndefined();
    expect((await unlink({ reason: 'Again' })).body.error.code).toBe('NOT_LINKED');
    expect(await AuditLogs.findOne({ entityType: 'referral', action: 'unlink' }).lean()).toMatchObject({ reason: 'Linked by mistake' });
    expect(await Activities.countDocuments({ type: 'REFERRAL_UNLINKED' })).toBe(1);
  });
});

describe('timeline and audit access', () => {
  it('timeline is authorised by referral visibility; audit by audit.view', async () => {
    const w = await referralWorld(app);
    const r = await mkExternal(app, w.mgrA, 'Tl', { assignedTo: uid(w.salesA) });
    const tl = (who: { auth: Record<string, string> }) => request(app).get(api(`/activities?refType=referral&refId=${r.id}`)).set(who.auth);
    expect((await tl(w.mgrA)).status).toBe(200);
    expect((await tl(w.salesA)).status).toBe(200); // assigned to them
    expect((await tl(w.salesA2)).status).toBe(404); // OWN: not theirs
    expect((await tl(w.mgrB)).status).toBe(404);
    expect((await tl(w.admin)).status).toBe(200);
    const audit = await request(app).get(api(`/audit?entityType=referral&entityId=${r.id}`)).set(w.admin.auth);
    expect(audit.status).toBe(200);
    expect(audit.body.data.map((a: { action: string }) => a.action)).toContain('create_external');
    expect((await request(app).get(api(`/audit?entityType=referral&entityId=${r.id}`)).set(w.mgrA.auth)).status).toBe(403);
  });
});
