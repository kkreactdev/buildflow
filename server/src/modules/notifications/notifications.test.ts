import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { Notification } from '../../core/notify/notification.model';
import { notify } from '../../core/notify/notification.service';
import { systemRepo } from '../../core/scope/system';
import { useTestDb } from '../../test/db';
import { api, followUpWorld, revoke } from '../../test/enquiries';
import { makeUser, seedAll } from '../../test/factories';
import { Role } from '../roles/role.model';

const app = buildApp();
const Notifications = systemRepo(Notification, 'test', 'fixtures');

useTestDb();
beforeEach(seedAll);

const asId = (u: { user: { _id: Types.ObjectId } }) => u.user._id.toHexString();
const give = (userId: string, branchId: string, n = 1, extra: Record<string, unknown> = {}) =>
  Notifications.insertMany(Array.from({ length: n }, (_, i) => ({ userId: new Types.ObjectId(userId), branchId: new Types.ObjectId(branchId), eventCode: 'FOLLOWUP_MISSED', title: `Missed ${i}`, refs: [{ type: 'followup', id: new Types.ObjectId() }], ...extra })));

describe('notification inbox', () => {
  it('lists your own notifications newest first, with read state and an unread count', async () => {
    const w = await followUpWorld(app);
    await give(asId(w.salesA), w.A, 3);
    const res = await request(app).get(api('/notifications')).set(w.salesA.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data.map((n: { title: string }) => n.title)).toEqual(['Missed 2', 'Missed 1', 'Missed 0']);
    expect(res.body.data[0]).toMatchObject({ eventCode: 'FOLLOWUP_MISSED', read: false });
    expect(res.body.data[0].refs[0].type).toBe('followup');
    expect(res.body.meta).toMatchObject({ total: 3, unread: 3 });
    expect((await request(app).get(api('/notifications/unread-count')).set(w.salesA.auth)).body.data).toEqual({ unread: 3 });
  });

  it('marks one read (idempotently), filters unread/read, and marks all read', async () => {
    const w = await followUpWorld(app);
    await give(asId(w.salesA), w.A, 4);
    const all = (await request(app).get(api('/notifications')).set(w.salesA.auth)).body.data as { id: string }[];
    expect((await request(app).post(api(`/notifications/${all[0]!.id}/read`)).set(w.salesA.auth)).status).toBe(204);
    expect((await request(app).post(api(`/notifications/${all[0]!.id}/read`)).set(w.salesA.auth)).status).toBe(204);
    const unread = await request(app).get(api('/notifications?unread=true')).set(w.salesA.auth);
    expect(unread.body.data).toHaveLength(3);
    expect(unread.body.meta.unread).toBe(3);
    const read = await request(app).get(api('/notifications?unread=false')).set(w.salesA.auth);
    expect(read.body.data).toHaveLength(1);
    expect(read.body.data[0]).toMatchObject({ read: true });
    expect(read.body.data[0].readAt).toBeTruthy();
    const firstReadAt = read.body.data[0].readAt;
    await request(app).post(api(`/notifications/${all[0]!.id}/read`)).set(w.salesA.auth);
    expect((await request(app).get(api('/notifications?unread=false')).set(w.salesA.auth)).body.data[0].readAt).toBe(firstReadAt); // not rewritten
    expect((await request(app).post(api('/notifications/read-all')).set(w.salesA.auth)).body.data).toEqual({ updated: 3 });
    expect((await request(app).get(api('/notifications/unread-count')).set(w.salesA.auth)).body.data).toEqual({ unread: 0 });
    expect((await request(app).post(api('/notifications/read-all')).set(w.salesA.auth)).body.data).toEqual({ updated: 0 });
  });

  it('paginates', async () => {
    const w = await followUpWorld(app);
    await give(asId(w.salesA), w.A, 5);
    const p = await request(app).get(api('/notifications?limit=2&page=3')).set(w.salesA.auth);
    expect(p.body.data).toHaveLength(1);
    expect(p.body.meta).toMatchObject({ page: 3, limit: 2, total: 5 });
    expect((await request(app).get(api('/notifications?limit=101')).set(w.salesA.auth)).status).toBe(400);
  });

  it('is strictly personal: a colleague, a manager of the branch and an ALL-scope admin cannot read, count or mark yours', async () => {
    const w = await followUpWorld(app);
    await give(asId(w.salesA), w.A, 2);
    const [mine] = (await request(app).get(api('/notifications')).set(w.salesA.auth)).body.data as { id: string }[];
    for (const who of [w.salesA2, w.mgrA, w.admin, w.mgrB]) {
      expect((await request(app).get(api('/notifications')).set(who.auth)).body.data).toEqual([]);
      expect((await request(app).get(api('/notifications/unread-count')).set(who.auth)).body.data).toEqual({ unread: 0 });
      expect((await request(app).post(api(`/notifications/${mine!.id}/read`)).set(who.auth)).status).toBe(404);
      expect((await request(app).post(api('/notifications/read-all')).set(who.auth)).body.data).toEqual({ updated: 0 });
    }
    expect((await request(app).get(api('/notifications?unread=true')).set(w.salesA.auth)).body.data).toHaveLength(2); // untouched
    // a made-up id looks exactly the same as someone else's
    const a = await request(app).post(api(`/notifications/${mine!.id}/read`)).set(w.mgrA.auth);
    const b = await request(app).post(api(`/notifications/${new Types.ObjectId()}/read`)).set(w.mgrA.auth);
    expect(a.body.error).toEqual(b.body.error);
  });

  it('requires authentication and notifications.view; has no create or delete endpoints', async () => {
    const w = await followUpWorld(app);
    await give(asId(w.salesA), w.A, 1);
    const [n] = (await request(app).get(api('/notifications')).set(w.salesA.auth)).body.data as { id: string }[];
    for (const [m, p] of [['get', '/notifications'], ['get', '/notifications/unread-count'], ['post', '/notifications/read-all'], ['post', `/notifications/${n!.id}/read`]] as const) {
      expect((await (request(app) as never as Record<string, (u: string) => request.Test>)[m]!(api(p)).send({})).status, p).toBe(401);
    }
    for (const [m, p] of [['post', '/notifications'], ['delete', `/notifications/${n!.id}`], ['patch', `/notifications/${n!.id}`], ['put', `/notifications/${n!.id}`]] as const) {
      expect((await (request(app) as never as Record<string, (u: string) => request.Test>)[m]!(api(p)).set(w.admin.auth).send({})).status, p).toBe(404);
    }
    await revoke('SALES_EXECUTIVE', 'notifications.view');
    expect((await request(app).get(api('/notifications')).set(w.salesA.auth)).status).toBe(403);
    expect((await request(app).get(api('/notifications/unread-count')).set(w.salesA.auth)).status).toBe(403);
  });
});

describe('notify(): recipients, dedupe and exclusion', () => {
  const base = (w: Awaited<ReturnType<typeof followUpWorld>>, over: Record<string, unknown> = {}) => ({
    event: 'FOLLOWUP_MISSED' as const, branchId: w.A, payload: { person: 'Raj', type: 'Call', when: 'today' }, refs: [{ type: 'followup', id: new Types.ObjectId() }],
    dedupeKey: `test:${new Types.ObjectId()}`, ...over,
  });

  it('resolves recipients from the event rules: the named subject plus branch members holding the permission', async () => {
    const w = await followUpWorld(app);
    const n = await notify(base(w, { subjects: { assignee: asId(w.salesA) } }));
    const to = new Set((await Notifications.find({}).lean()).map((x) => String(x.userId)));
    expect(n).toBe(2);
    expect(to).toEqual(new Set([asId(w.salesA), asId(w.mgrA)]));
  });

  it('never notifies the same person twice for one occurrence, but does for a new occurrence', async () => {
    const w = await followUpWorld(app);
    const input = base(w, { subjects: { assignee: asId(w.salesA) } });
    expect(await notify(input)).toBe(2);
    expect(await notify(input)).toBe(0);
    expect(await Notifications.countDocuments()).toBe(2);
    expect(await notify({ ...input, dedupeKey: `${input.dedupeKey}:next` })).toBe(2);
    // a new recipient joining later still receives the same occurrence once
    const mgr2 = await makeUser({ roleKey: 'MANAGER', branches: [w.A] });
    expect(await notify(input)).toBe(1);
    expect(await Notifications.countDocuments({ userId: mgr2.user._id })).toBe(1);
  });

  it('can exclude the person who caused the event, and skips inactive or unknown subjects', async () => {
    const w = await followUpWorld(app);
    const inactive = await makeUser({ roleKey: 'SALES_EXECUTIVE', branches: [w.A], isActive: false });
    expect(await notify(base(w, { event: 'FOLLOWUP_ASSIGNED', subjects: { assignee: asId(w.salesA) }, excludeUserId: asId(w.salesA) }))).toBe(0);
    expect(await notify(base(w, { event: 'FOLLOWUP_ASSIGNED', subjects: { assignee: inactive.user._id.toHexString() } }))).toBe(0);
    expect(await notify(base(w, { event: 'FOLLOWUP_ASSIGNED', subjects: { assignee: new Types.ObjectId().toHexString() } }))).toBe(0);
    expect(await notify(base(w, { event: 'FOLLOWUP_ASSIGNED', subjects: {} }))).toBe(0);
  });

  it('"manager" is a permission, not a name: revoking it stops the alerts, a custom role with it receives them', async () => {
    const w = await followUpWorld(app);
    await Role.updateOne({ key: 'MANAGER' }, { $pull: { permissions: 'notifications.team_alerts' } });
    expect(await notify(base(w, { subjects: { assignee: asId(w.salesA) } }))).toBe(1); // only the assignee
    await Role.create({ name: 'Supervisor', key: 'SUPERVISOR', dataScope: 'BRANCH', permissions: ['notifications.team_alerts'] });
    await makeUser({ roleKey: 'SUPERVISOR', branches: [w.A] });
    expect(await notify(base(w, { subjects: { assignee: asId(w.salesA) } }))).toBe(2);
  });

  it('only notifies members of the event\'s branch', async () => {
    const w = await followUpWorld(app);
    await notify(base(w));
    const to = (await Notifications.find({}).lean()).map((x) => String(x.userId));
    expect(to).toEqual([asId(w.mgrA)]);
    expect(to).not.toContain(asId(w.mgrB));
  });
});
