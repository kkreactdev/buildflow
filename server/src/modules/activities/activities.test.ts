import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { recordActivity } from '../../core/activity/activity.service';
import { resetActivityTypeCache } from '../../core/activity/activityTypes';
import { actor, makeBranch, makeUser, seedAll } from '../../test/factories';
import { useTestDb } from '../../test/db';
import { Role } from '../roles/role.model';
import { registerRefAuthorizer, unregisterRefAuthorizer } from './refAuthorizers';

const app = buildApp();
const api = (p: string) => `/api/v1${p}`;

useTestDb();
beforeEach(async () => {
  resetActivityTypeCache();
  await seedAll();
});

async function world() {
  const a = await makeBranch('A');
  const b = await makeBranch('B');
  const A = a._id.toHexString();
  const B = b._id.toHexString();
  const mgrA = await actor(app, 'MANAGER', [A]);
  const salesA = await actor(app, 'SALES_EXECUTIVE', [A]);
  const root = await actor(app, 'ADMIN');
  const unitInA = new Types.ObjectId();
  const unitInB = new Types.ObjectId();
  const rec = (type: string, branch: string, refs: { type: 'unit' | 'user' | 'enquiry' | 'client'; id: Types.ObjectId | string }[], userId?: string, description = type, at?: Date) =>
    recordActivity({ type, description, branchId: branch, userId, refs, at });
  await rec('UNIT_ASSIGNED', A, [{ type: 'unit', id: unitInA }], mgrA.user._id.toHexString(), 'assigned in A');
  await rec('UNIT_ASSIGNED', B, [{ type: 'unit', id: unitInB }], root.user._id.toHexString(), 'assigned in B');
  await rec('SITE_VISIT_COMPLETED', A, [{ type: 'unit', id: unitInA }, { type: 'user', id: salesA.user._id }], salesA.user._id.toHexString(), 'Raj visited Villa 03');
  return { A, B, mgrA, salesA, root, unitInA, unitInB, rec };
}
const descs = (res: request.Response) => (res.body.data as { description: string }[]).map((r) => r.description).sort();

describe('activity read API', () => {
  it('requires authentication and the activities.view permission', async () => {
    const { A } = await world();
    expect((await request(app).get(api('/activities'))).status).toBe(401);
    await Role.updateOne({ key: 'SALES_EXECUTIVE' }, { $pull: { permissions: 'activities.view' } });
    const sales = await actor(app, 'SALES_EXECUTIVE', [A]);
    expect((await request(app).get(api('/activities')).set(sales.auth)).status).toBe(403);
  });

  it('there is no way to create, edit or delete an activity over the API', async () => {
    const { root, unitInA } = await world();
    for (const [m, p] of [['post', '/activities'], ['patch', `/activities/${unitInA}`], ['put', `/activities/${unitInA}`], ['delete', `/activities/${unitInA}`]] as const) {
      expect((await (request(app) as never as Record<string, (u: string) => request.Test>)[m]!(api(p)).set(root.auth).send({})).status).toBe(404);
    }
  });

  it('ALL scope sees every branch; BRANCH scope only its own; narrowing cannot widen', async () => {
    const { B, root, mgrA } = await world();
    expect(descs(await request(app).get(api('/activities')).set(root.auth))).toEqual(['Raj visited Villa 03', 'assigned in A', 'assigned in B']);
    expect(descs(await request(app).get(api('/activities')).set(mgrA.auth))).toEqual(['Raj visited Villa 03', 'assigned in A']);
    expect((await request(app).get(api(`/activities?branchId=${B}`)).set(mgrA.auth)).status).toBe(403);
    expect(descs(await request(app).get(api(`/activities?branchId=${B}`)).set(root.auth))).toEqual(['assigned in B']);
  });

  it('OWN scope: a feed shows only what the user did themselves', async () => {
    const { salesA } = await world();
    expect(descs(await request(app).get(api('/activities')).set(salesA.auth))).toEqual(['Raj visited Villa 03']);
  });

  it('one activity appears on every referenced entity\'s timeline (no duplicate records)', async () => {
    const { salesA, unitInA, mgrA } = await world();
    registerRefAuthorizer('unit', async () => true);
    const onUnit = await request(app).get(api(`/activities?refType=unit&refId=${unitInA}`)).set(mgrA.auth);
    const onUser = await request(app).get(api(`/activities?refType=user&refId=${salesA.user._id}`)).set(mgrA.auth);
    expect(descs(onUnit)).toEqual(['Raj visited Villa 03', 'assigned in A']);
    expect(descs(onUser)).toEqual(['Raj visited Villa 03']);
    expect(onUnit.body.data.find((a: { description: string }) => a.description === 'Raj visited Villa 03').refs).toHaveLength(2);
    expect(onUnit.body.meta).toMatchObject({ total: 2 });
    unregisterRefAuthorizer('unit');
  });

  it('a timeline cannot be opened by id alone: the actor must be allowed to see the ENTITY', async () => {
    const { B, mgrA } = await world();
    const userInB = await makeUser({ roleKey: 'SALES_EXECUTIVE', branches: [B] });
    await recordActivity({ type: 'UNIT_ASSIGNED', description: 'about user in B', branchId: B, refs: [{ type: 'user', id: userInB.user._id }] });
    expect((await request(app).get(api(`/activities?refType=user&refId=${userInB.user._id}`)).set(mgrA.auth)).status).toBe(404);
    // a made-up id behaves exactly the same (no oracle for existence)
    expect((await request(app).get(api(`/activities?refType=user&refId=${new Types.ObjectId()}`)).set(mgrA.auth)).status).toBe(404);
  });

  it('even for an entity the actor can see, events recorded in another branch stay hidden', async () => {
    const { A, B, mgrA, unitInA, rec } = await world();
    registerRefAuthorizer('unit', async () => true); // actor may see this (shared) unit...
    await rec('BOOKING_CREATED', B, [{ type: 'unit', id: unitInA }], undefined, 'booked while in branch B');
    const res = await request(app).get(api(`/activities?refType=unit&refId=${unitInA}`)).set(mgrA.auth);
    expect(descs(res)).toEqual(['Raj visited Villa 03', 'assigned in A']); // ...but branch B's event is not shown
    void A;
    unregisterRefAuthorizer('unit');
  });

  it('timelines for entity types with no authorizer (and half-specified refs) are refused', async () => {
    const { mgrA, unitInA } = await world();
    unregisterRefAuthorizer('unit');
    const none = await request(app).get(api(`/activities?refType=unit&refId=${unitInA}`)).set(mgrA.auth);
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe('TIMELINE_UNAVAILABLE');
    expect((await request(app).get(api('/activities?refType=unit')).set(mgrA.auth)).status).toBe(400);
    expect((await request(app).get(api(`/activities?refId=${unitInA}`)).set(mgrA.auth)).status).toBe(400);
    expect((await request(app).get(api('/activities?refType=bogus&refId=x')).set(mgrA.auth)).status).toBe(400);
  });

  it('filters by type, user and date; paginates newest first', async () => {
    const { A, root, mgrA, rec } = await world();
    await rec('FOLLOWUP_COMPLETED', A, [{ type: 'unit', id: new Types.ObjectId() }], mgrA.user._id.toHexString(), 'old one', new Date('2020-01-01'));
    const byType = await request(app).get(api('/activities?type=followup_completed')).set(root.auth);
    expect(descs(byType)).toEqual(['old one']);
    expect(descs(await request(app).get(api(`/activities?userId=${mgrA.user._id}`)).set(root.auth))).toEqual(['assigned in A', 'old one']);
    expect(descs(await request(app).get(api('/activities?from=2021-01-01')).set(root.auth))).not.toContain('old one');
    const page = await request(app).get(api('/activities?limit=2&page=1')).set(root.auth);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta).toMatchObject({ total: 4, limit: 2 });
    expect(page.body.data[0].description).not.toBe('old one'); // newest first
    expect((await request(app).get(api('/activities?limit=1000')).set(root.auth)).status).toBe(400);
  });

  it('returns branch and user ids but never leaks anything beyond the activity fields', async () => {
    const { root } = await world();
    const row = (await request(app).get(api('/activities?limit=1')).set(root.auth)).body.data[0];
    expect(Object.keys(row).sort()).toEqual(['__v', '_id', 'at', 'branchId', 'createdAt', 'description', 'refs', 'type', 'userId'].filter((k) => k in row).sort());
    expect(JSON.stringify(row)).not.toMatch(/passwordHash|token/i);
  });
});
