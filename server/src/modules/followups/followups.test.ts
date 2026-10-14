import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { getEnv } from '../../config/env';
import { systemRepo } from '../../core/scope/system';
import { zonedDayRange } from '../../lib/time';
import { Notification } from '../../core/notify/notification.model';
import { Activities, AuditLogs, makeUser, seedAll } from '../../test/factories';
import { api, createFollowUpApi, followUpWorld, grant, inDays, inMinutes, mkEnquiry, mkFollowUp, revoke, type FW } from '../../test/enquiries';
import { createClientApi } from '../../test/people';
import { useTestDb } from '../../test/db';
import { Master } from '../masters/master.model';
import { Person } from '../persons/person.model';
import { FollowUp } from './followup.model';

const app = buildApp();
const FollowUps = systemRepo(FollowUp, 'test', 'fixtures');
const Notifications = systemRepo(Notification, 'test', 'fixtures');
const People = systemRepo(Person, 'test', 'fixtures');
const Masters = systemRepo(Master, 'test', 'fixtures');

useTestDb();
beforeEach(seedAll);

const asId = (u: { user: { _id: Types.ObjectId } }) => u.user._id.toHexString();
const day = () => zonedDayRange(new Date(), getEnv().APP_TIMEZONE);
/** Sets a follow-up's schedule directly (creation refuses the past) — fixture only. */
const setTime = (id: string, at: Date) => FollowUps.updateOne({ _id: id }, { $set: { scheduledAt: at } });
const todayAt = (h: number) => new Date(day().start.getTime() + h * 3_600_000);
const tomorrowAt = (h: number) => new Date(day().end.getTime() + h * 3_600_000);
const list = (who: { auth: Record<string, string> }, qs = '') => request(app).get(api(`/followups${qs}`)).set(who.auth);
const ids = (res: request.Response) => (res.body.data as { id: string }[]).map((f) => f.id);
const post = (who: { auth: Record<string, string> }, path: string, body: object = {}) => request(app).post(api(path)).set(who.auth).send(body);

async function setup(w: FW) {
  const e = await mkEnquiry(app, w.mgrA, { assignedTo: asId(w.salesA) });
  return { e };
}

describe('creating a follow-up', () => {
  it('on an enquiry: branch/person come from the enquiry, status is the PENDING master, owner defaults to the enquiry\'s assignee', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const res = await createFollowUpApi(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1), notes: 'Discuss budget' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      branchId: w.A, personId: e.personId, enquiryId: e.id, enquiryNo: e.enquiryNo, statusKey: 'PENDING', status: { label: 'Pending' }, type: { label: 'Call' },
      assignedTo: asId(w.salesA), assignedToName: 'SALES_EXECUTIVE', notes: 'Discuss budget', rescheduleCount: 0, isArchived: false,
    });
    expect(res.body.data.clientId).toBeUndefined();
    expect(res.body.data.allowed).toEqual({ edit: true, complete: true, reschedule: true, cancel: true, archive: true });
  });

  it('on a client; exactly one anchor is required', async () => {
    const w = await followUpWorld(app);
    const c = (await createClientApi(app, w.mgrA, { person: { name: 'Raj Kumar', phone: '9876543210' } })).body.data;
    const res = await createFollowUpApi(app, w.mgrA, { clientId: c.id, typeId: w.ft.meeting, scheduledAt: inDays(1) });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ clientId: c.id, clientNo: c.clientNo, personId: c.personId, assignedTo: asId(w.mgrA) }); // a client with no owner: the creator
    const { e } = await setup(w);
    for (const body of [{}, { enquiryId: e.id, clientId: c.id }]) expect((await createFollowUpApi(app, w.mgrA, { ...body, typeId: w.ft.call, scheduledAt: inDays(1) })).status, JSON.stringify(body)).toBe(400);
  });

  it('records audit, a timeline activity on the follow-up, the enquiry and the person, and notifies the assignee (not the creator)', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    expect((await AuditLogs.findOne({ entityType: 'followup', action: 'create' }).lean())!.entityId.toString()).toBe(f.id);
    const act = await Activities.findOne({ type: 'FOLLOWUP_SCHEDULED' }).lean();
    expect(act!.refs.map((r) => r.type).sort()).toEqual(['enquiry', 'followup', 'person']);
    const n = await Notifications.find({ eventCode: 'FOLLOWUP_ASSIGNED' }).lean();
    expect(n).toHaveLength(1);
    expect(String(n[0]!.userId)).toBe(asId(w.salesA));
    expect(n[0]!.title).toContain(e.name);
    // creating one for yourself notifies nobody
    await mkFollowUp(app, w.salesA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(2) });
    expect(await Notifications.countDocuments({ eventCode: 'FOLLOWUP_ASSIGNED' })).toBe(1);
  });

  it('is atomic: a rejected request leaves nothing behind', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    expect((await createFollowUpApi(app, w.mgrA, { enquiryId: e.id, typeId: new Types.ObjectId().toHexString(), scheduledAt: inDays(1) })).status).toBe(400);
    expect(await FollowUps.countDocuments()).toBe(0);
    expect(await Notifications.countDocuments()).toBe(0);
  });

  it('validates time, type and shape strictly', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const base = { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) };
    const bad: [string, Record<string, unknown>][] = [
      ['past time', { scheduledAt: inDays(-1) }], ['not a date', { scheduledAt: 'tomorrow-ish' }], ['missing time', { scheduledAt: undefined }], ['missing type', { typeId: undefined }],
      ['unknown field: status', { statusKey: 'COMPLETED' }], ['unknown field: statusId', { statusId: w.ft.call }], ['unknown field: branch', { branchId: w.B }], ['unknown field: person', { personId: e.personId }],
      ['notes too long', { notes: 'x'.repeat(2001) }], ['malformed id', { enquiryId: 'x' }],
    ];
    for (const [label, over] of bad) expect((await createFollowUpApi(app, w.mgrA, { ...base, ...over })).status, label).toBe(400);
    expect(await FollowUps.countDocuments()).toBe(0);
    expect((await createFollowUpApi(app, w.mgrA, { ...base, scheduledAt: inMinutes(-2) })).status).toBe(201); // a couple of minutes of clock tolerance
  });

  it('the type must be an ACTIVE FOLLOWUP_TYPE master', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    await request(app).patch(api(`/masters/FOLLOWUP_TYPE/${w.ft.whatsapp}`)).set(w.admin.auth).send({ isActive: false });
    for (const typeId of [w.ft.whatsapp, w.m.source, w.m.lost]) {
      const res = await createFollowUpApi(app, w.mgrA, { enquiryId: e.id, typeId, scheduledAt: inDays(1) });
      expect(res.status, typeId).toBe(400);
      expect(res.body.error.details[0].path).toBe('typeId');
    }
  });

  it('assignee rules: active user of the branch; OWN-scope users only themselves; ALL scope may choose', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const inactive = await makeUser({ roleKey: 'SALES_EXECUTIVE', branches: [w.A], isActive: false });
    const make = (who: { auth: Record<string, string> }, assignedTo: string) => createFollowUpApi(app, who, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1), assignedTo });
    expect((await make(w.mgrA, asId(w.salesA2))).status).toBe(201);
    for (const to of [asId(w.salesB), inactive.user._id.toHexString(), new Types.ObjectId().toHexString()]) expect((await make(w.mgrA, to)).status, to).toBe(400);
    expect((await make(w.salesA, asId(w.salesA2))).status).toBe(403);
    expect((await make(w.salesA, asId(w.salesA))).status).toBe(201);
    expect((await make(w.admin, asId(w.salesA))).status).toBe(201);
    expect((await createFollowUpApi(app, w.admin, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) })).status).toBe(201); // falls back to the enquiry's assignee
  });

  it('needs followups.create and a visible enquiry/client — others get the same 404 as a made-up id', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const mine = await mkEnquiry(app, w.salesA2);
    const body = (enquiryId: string) => ({ enquiryId, typeId: w.ft.call, scheduledAt: inDays(1) });
    expect((await request(app).post(api('/followups')).send(body(e.id))).status).toBe(401);
    const ghost = await createFollowUpApi(app, w.mgrB, body(new Types.ObjectId().toHexString()));
    for (const [who, id] of [[w.mgrB, e.id], [w.salesB, e.id], [w.salesA2, e.id], [w.salesA, mine.id]] as const) {
      const res = await createFollowUpApi(app, who, body(id));
      expect(res.status).toBe(404);
      expect(res.body.error).toEqual(ghost.body.error);
    }
    await revoke('MANAGER', 'followups.create');
    expect((await createFollowUpApi(app, w.mgrA, body(e.id))).status).toBe(403);
    expect(await FollowUps.countDocuments()).toBe(0);
  });
});

describe('updating a follow-up', () => {
  it('changes type, notes and owner; audits before/after; notifies a new owner', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    const res = await request(app).patch(api(`/followups/${f.id}`)).set(w.mgrA.auth).send({ typeId: w.ft.meeting, notes: 'Bring brochure', assignedTo: asId(w.salesA2) });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ type: { label: 'Meeting' }, notes: 'Bring brochure', assignedTo: asId(w.salesA2) });
    const audit = await AuditLogs.findOne({ entityType: 'followup', action: 'reassign' }).lean();
    expect(audit!.changes).toMatchObject({ assignedTo: { from: asId(w.salesA), to: asId(w.salesA2) } });
    expect(await Notifications.countDocuments({ userId: w.salesA2.user._id, eventCode: 'FOLLOWUP_ASSIGNED' })).toBe(1);
    expect(await Activities.countDocuments({ type: 'FOLLOWUP_UPDATED' })).toBe(1);
  });

  it('cannot change status, time, anchor, person or branch (each has its own controlled operation)', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    for (const bad of [{}, { statusKey: 'COMPLETED' }, { statusId: w.ft.call }, { scheduledAt: inDays(3) }, { enquiryId: e.id }, { personId: e.personId }, { branchId: w.B }, { isArchived: true }, { outcome: 'x' }]) {
      expect((await request(app).patch(api(`/followups/${f.id}`)).set(w.mgrA.auth).send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(await FollowUps.findOne({ _id: f.id }).lean()).toMatchObject({ statusKey: 'PENDING' });
  });

  it('validates a changed type and owner, allows an unchanged inactive type, refuses closed follow-ups', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    await request(app).patch(api(`/masters/FOLLOWUP_TYPE/${w.ft.call}`)).set(w.admin.auth).send({ isActive: false });
    const patch = (b: object) => request(app).patch(api(`/followups/${f.id}`)).set(w.mgrA.auth).send(b);
    expect((await patch({ notes: 'still editable', typeId: w.ft.call })).status).toBe(200); // unchanged
    expect((await patch({ typeId: w.ft.call, assignedTo: asId(w.salesB) })).status).toBe(400);
    await request(app).patch(api(`/masters/FOLLOWUP_TYPE/${w.ft.meeting}`)).set(w.admin.auth).send({ isActive: false });
    expect((await patch({ typeId: w.ft.meeting })).status).toBe(400);
    await post(w.mgrA, `/followups/${f.id}/cancel`, { reason: 'not needed' });
    expect((await patch({ notes: 'x' })).body.error.code).toBe('FOLLOWUP_CLOSED');
  });

  it('needs followups.edit; an OWN-scope user may only reassign to themselves', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    expect((await request(app).patch(api(`/followups/${f.id}`)).set(w.salesA.auth).send({ assignedTo: asId(w.salesA2) })).status).toBe(403);
    await revoke('SALES_EXECUTIVE', 'followups.edit');
    expect((await request(app).patch(api(`/followups/${f.id}`)).set(w.salesA.auth).send({ notes: 'x' })).status).toBe(403);
  });
});

describe('completing', () => {
  it('records the outcome, closes the follow-up, audits it — and does NOT create another follow-up', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    const res = await post(w.salesA, `/followups/${f.id}/complete`, { outcome: 'Wants a site visit next week' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ statusKey: 'COMPLETED', status: { label: 'Completed' }, outcome: 'Wants a site visit next week' });
    expect(res.body.data.completedAt).toBeTruthy();
    expect(res.body.data.allowed).toMatchObject({ edit: false, complete: false, reschedule: false, cancel: false });
    expect(await FollowUps.countDocuments()).toBe(1); // nothing automatic: the next follow-up is scheduled by a person
    expect((await AuditLogs.findOne({ entityType: 'followup', action: 'complete' }).lean())!.changes).toMatchObject({ statusKey: { from: 'PENDING', to: 'COMPLETED' } });
    expect(await Activities.countDocuments({ type: 'FOLLOWUP_COMPLETED' })).toBe(1);
  });

  it('works without an outcome and for a MISSED follow-up (late completion)', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    const missed = await Masters.findOne({ type: 'FOLLOWUP_STATUS', systemKey: 'MISSED' }).lean();
    await FollowUps.updateOne({ _id: f.id }, { $set: { statusKey: 'MISSED', statusId: missed!._id } });
    expect((await post(w.salesA, `/followups/${f.id}/complete`)).body.data.statusKey).toBe('COMPLETED');
  });

  it('cannot be completed twice; simultaneous completions: exactly one succeeds', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    const results = await Promise.all(Array.from({ length: 5 }, () => post(w.salesA, `/followups/${f.id}/complete`, { outcome: 'x' })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 200).every((r) => r.status === 409 && ['FOLLOWUP_CLOSED', 'FOLLOWUP_CHANGED'].includes(r.body.error.code))).toBe(true);
    expect(await AuditLogs.countDocuments({ entityType: 'followup', action: 'complete' })).toBe(1);
    expect((await post(w.salesA, `/followups/${f.id}/complete`)).body.error.code).toBe('FOLLOWUP_CLOSED');
  });

  it('needs followups.edit and visibility', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    expect((await post(w.salesA2, `/followups/${f.id}/complete`)).status).toBe(404); // someone else's (OWN)
    expect((await post(w.mgrB, `/followups/${f.id}/complete`)).status).toBe(404);
    await revoke('SALES_EXECUTIVE', 'followups.edit');
    expect((await post(w.salesA, `/followups/${f.id}/complete`)).status).toBe(403);
    expect((await request(app).post(api(`/followups/${f.id}/complete`)).send({})).status).toBe(401);
  });
});

describe('rescheduling and cancelling', () => {
  it('reschedule sets the new time and RESCHEDULED status, counts it, audits with the reason', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    const to = inDays(3);
    const res = await post(w.salesA, `/followups/${f.id}/reschedule`, { scheduledAt: to, reason: 'Customer travelling' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ statusKey: 'RESCHEDULED', status: { label: 'Rescheduled' }, rescheduleCount: 1 });
    expect(new Date(res.body.data.scheduledAt).toISOString()).toBe(new Date(to).toISOString());
    expect(await AuditLogs.findOne({ entityType: 'followup', action: 'reschedule' }).lean()).toMatchObject({ reason: 'Customer travelling' });
    expect(await Activities.countDocuments({ type: 'FOLLOWUP_RESCHEDULED' })).toBe(1);
    expect((await post(w.salesA, `/followups/${f.id}/reschedule`, { scheduledAt: inDays(5) })).body.data.rescheduleCount).toBe(2);
  });

  it('refuses the past, the same time, bad input and closed follow-ups', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const at = inDays(1);
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: at });
    const re = (b: object) => post(w.salesA, `/followups/${f.id}/reschedule`, b);
    expect((await re({ scheduledAt: inDays(-1) })).status).toBe(400);
    expect((await re({ scheduledAt: 'soon' })).status).toBe(400);
    expect((await re({})).status).toBe(400);
    expect((await re({ scheduledAt: inDays(2), status: 'COMPLETED' })).status).toBe(400);
    expect((await re({ scheduledAt: at })).body.error.code).toBe('NO_CHANGE');
    await post(w.salesA, `/followups/${f.id}/complete`);
    expect((await re({ scheduledAt: inDays(2) })).body.error.code).toBe('FOLLOWUP_CLOSED');
  });

  it('rescheduling a MISSED follow-up reopens it as RESCHEDULED', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    const missed = await Masters.findOne({ type: 'FOLLOWUP_STATUS', systemKey: 'MISSED' }).lean();
    await FollowUps.updateOne({ _id: f.id }, { $set: { statusKey: 'MISSED', statusId: missed!._id, missedAt: new Date(), scheduledAt: new Date(Date.now() - 86_400_000) } });
    const res = await post(w.salesA, `/followups/${f.id}/reschedule`, { scheduledAt: inDays(1), reason: 'Called back' });
    expect(res.body.data).toMatchObject({ statusKey: 'RESCHEDULED' });
    expect(res.body.data.missedAt).toBeUndefined();
  });

  it('cancel needs a reason, closes it, and is audited', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    for (const reason of [undefined, '', '  ', 'x']) expect((await post(w.salesA, `/followups/${f.id}/cancel`, { reason })).status).toBe(400);
    const res = await post(w.salesA, `/followups/${f.id}/cancel`, { reason: 'Customer not interested' });
    expect(res.body.data).toMatchObject({ statusKey: 'CANCELLED', status: { label: 'Cancelled' }, cancelReason: 'Customer not interested' });
    expect(res.body.data.allowed.cancel).toBe(false);
    expect(await AuditLogs.findOne({ entityType: 'followup', action: 'cancel' }).lean()).toMatchObject({ reason: 'Customer not interested' });
    expect(await Activities.countDocuments({ type: 'FOLLOWUP_CANCELLED' })).toBe(1);
    expect((await post(w.salesA, `/followups/${f.id}/cancel`, { reason: 'again' })).body.error.code).toBe('FOLLOWUP_CLOSED');
  });
});

describe('archiving', () => {
  it('needs followups.archive; hides the follow-up by default, keeps it, audits it', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    expect((await request(app).delete(api(`/followups/${f.id}`)).set(w.salesA.auth)).status).toBe(403);
    expect((await request(app).delete(api(`/followups/${f.id}`)).set(w.mgrA.auth)).status).toBe(204);
    expect(ids(await list(w.mgrA))).toEqual([]);
    expect(ids(await list(w.mgrA, '?isArchived=true'))).toEqual([f.id]);
    expect((await request(app).get(api(`/followups/${f.id}`)).set(w.mgrA.auth)).body.data.allowed).toMatchObject({ archive: false, edit: false });
    expect((await request(app).delete(api(`/followups/${f.id}`)).set(w.mgrA.auth)).status).toBe(404);
    expect((await post(w.mgrA, `/followups/${f.id}/complete`)).status).toBe(404);
    expect(await FollowUps.countDocuments({ isArchived: true })).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'followup', action: 'archive' })).toBe(1);
  });
});

describe('listing: today, missed, upcoming', () => {
  async function fixtures(w: FW) {
    const e1 = await mkEnquiry(app, w.mgrA, { assignedTo: asId(w.salesA) }, { name: 'Anand Kumar', phone: '9811111111' });
    const e2 = await mkEnquiry(app, w.mgrA, { assignedTo: asId(w.salesA2) }, { name: 'Bhavna Rao', phone: '9822222222' });
    const mk = (e: { id: string }, type: string) => mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: type, scheduledAt: inDays(1) });
    const today1 = await mk(e1, w.ft.call);
    const today2 = await mk(e2, w.ft.meeting);
    const later = await mk(e1, w.ft.call);
    const overdue = await mk(e2, w.ft.call);
    const done = await mk(e1, w.ft.call);
    await setTime(today1.id, todayAt(23.5));
    await setTime(today2.id, todayAt(0.5));
    await setTime(later.id, tomorrowAt(3));
    await setTime(overdue.id, new Date(Date.now() - 3 * 86_400_000));
    await post(w.salesA, `/followups/${done.id}/complete`);
    const missed = await Masters.findOne({ type: 'FOLLOWUP_STATUS', systemKey: 'MISSED' }).lean();
    await FollowUps.updateOne({ _id: overdue.id }, { $set: { statusKey: 'MISSED', statusId: missed!._id, missedAt: new Date() } });
    return { e1, e2, today1, today2, later, overdue, done };
  }

  it('Today = scheduled for today (business time zone), still open; Missed = flagged missed; Upcoming = after today', async () => {
    const w = await followUpWorld(app);
    const f = await fixtures(w);
    expect(ids(await list(w.mgrA, '?view=today')).sort()).toEqual([f.today1.id, f.today2.id].sort());
    expect(ids(await list(w.mgrA, '?view=missed'))).toEqual([f.overdue.id]);
    expect(ids(await list(w.mgrA, '?view=upcoming'))).toEqual([f.later.id]);
    expect(ids(await list(w.mgrA, '?view=open')).sort()).toEqual([f.today1.id, f.today2.id, f.later.id, f.overdue.id].sort());
    expect(ids(await list(w.mgrA))).toHaveLength(5);
  });

  it('orders by time, filters by status, type, owner, anchor, person and date range', async () => {
    const w = await followUpWorld(app);
    const f = await fixtures(w);
    expect(ids(await list(w.mgrA, '?view=today'))).toEqual([f.today2.id, f.today1.id]); // 00:30 before 23:30
    expect(ids(await list(w.mgrA, '?status=COMPLETED'))).toEqual([f.done.id]);
    expect(ids(await list(w.mgrA, '?status=missed,completed')).sort()).toEqual([f.overdue.id, f.done.id].sort());
    expect(ids(await list(w.mgrA, `?typeId=${w.ft.meeting}`))).toEqual([f.today2.id]);
    expect(ids(await list(w.mgrA, `?assignedTo=${asId(w.salesA2)}`)).sort()).toEqual([f.today2.id, f.overdue.id].sort());
    expect(ids(await list(w.mgrA, `?enquiryId=${f.e1.id}`))).toHaveLength(3);
    expect(ids(await list(w.mgrA, `?personId=${f.e2.personId}`)).sort()).toEqual([f.today2.id, f.overdue.id].sort());
    expect(ids(await list(w.mgrA, `?from=${tomorrowAt(0).toISOString()}`)).sort()).toEqual([f.later.id, f.done.id].sort()); // done was also scheduled for tomorrow
    expect(ids(await list(w.mgrA, `?from=${tomorrowAt(0).toISOString()}&status=PENDING,RESCHEDULED`))).toEqual([f.later.id]);
    expect((await list(w.mgrA, '?view=nope')).status).toBe(400);
    expect((await list(w.mgrA, '?typeId=x')).status).toBe(400);
  });

  it('searches by person name, phone in any notation, and enquiry number; paginates; sorts', async () => {
    const w = await followUpWorld(app);
    const f = await fixtures(w);
    expect(ids(await list(w.mgrA, '?search=anand'))).toHaveLength(3);
    expect(ids(await list(w.mgrA, '?search=98222%2022222'))).toHaveLength(2);
    expect(ids(await list(w.mgrA, `?search=${f.e2.enquiryNo}`))).toHaveLength(2);
    expect(ids(await list(w.mgrA, '?search=.*'))).toEqual([]);
    const p = await list(w.mgrA, '?limit=2&page=2&sort=scheduledAt');
    expect(p.body.data).toHaveLength(2);
    expect(p.body.meta).toMatchObject({ page: 2, limit: 2, total: 5 });
    expect((await list(w.mgrA, '?limit=101')).status).toBe(400);
  });

  it('each row carries the labels the screen needs', async () => {
    const w = await followUpWorld(app);
    await fixtures(w);
    const row = (await list(w.mgrA, '?view=missed')).body.data[0];
    expect(row).toMatchObject({ name: 'Bhavna Rao', phone: '+91 98222 22222', type: { label: 'Call' }, status: { label: 'Missed' }, statusKey: 'MISSED', assignedToName: 'SALES_EXECUTIVE' });
    expect(row.enquiryNo).toMatch(/^ENQ-/);
  });

  it('summary gives the dashboard counts for the caller\'s scope', async () => {
    const w = await followUpWorld(app);
    await fixtures(w);
    const sum = (who: { auth: Record<string, string> }, qs = '') => request(app).get(api(`/followups/summary${qs}`)).set(who.auth).then((r) => r.body.data);
    expect(await sum(w.mgrA)).toEqual({ today: 2, missed: 1, upcoming: 1, open: 4 });
    expect(await sum(w.salesA)).toEqual({ today: 1, missed: 0, upcoming: 1, open: 2 });
    expect(await sum(w.mgrB)).toEqual({ today: 0, missed: 0, upcoming: 0, open: 0 });
    expect(await sum(w.admin)).toEqual({ today: 2, missed: 1, upcoming: 1, open: 4 });
    expect(await sum(w.mgrA, `?assignedTo=${asId(w.salesA2)}`)).toEqual({ today: 1, missed: 1, upcoming: 0, open: 2 });
    expect((await request(app).get(api(`/followups/summary?branchId=${w.B}`)).set(w.mgrA.auth)).status).toBe(403);
    expect((await request(app).get(api('/followups/summary'))).status).toBe(401);
  });
});

describe('scope and security', () => {
  it('OWN scope sees only follow-ups assigned to it — list, detail, summary, and every action', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const mine = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    const theirs = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1), assignedTo: asId(w.salesA2) });
    expect(ids(await list(w.salesA))).toEqual([mine.id]);
    await grant('SALES_EXECUTIVE', 'followups.archive');
    for (const attempt of [
      () => request(app).get(api(`/followups/${theirs.id}`)).set(w.salesA.auth),
      () => request(app).patch(api(`/followups/${theirs.id}`)).set(w.salesA.auth).send({ notes: 'HACKED' }),
      () => post(w.salesA, `/followups/${theirs.id}/complete`),
      () => post(w.salesA, `/followups/${theirs.id}/reschedule`, { scheduledAt: inDays(2) }),
      () => post(w.salesA, `/followups/${theirs.id}/cancel`, { reason: 'because' }),
      () => request(app).delete(api(`/followups/${theirs.id}`)).set(w.salesA.auth),
      () => request(app).get(api(`/activities?refType=followup&refId=${theirs.id}`)).set(w.salesA.auth),
    ]) expect((await attempt()).status).toBe(404);
    expect(await FollowUps.findOne({ _id: theirs.id }).lean()).toMatchObject({ statusKey: 'PENDING', isArchived: false });
  });

  it('a Manager sees the whole branch and nothing of other branches; ALL scope sees everything', async () => {
    const w = await followUpWorld(app);
    const a = await mkEnquiry(app, w.mgrA);
    const b = await mkEnquiry(app, w.mgrB);
    const fa = await mkFollowUp(app, w.mgrA, { enquiryId: a.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    const fb = await mkFollowUp(app, w.mgrB, { enquiryId: b.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    expect(ids(await list(w.mgrA))).toEqual([fa.id]);
    expect(ids(await list(w.mgrB))).toEqual([fb.id]);
    expect(ids(await list(w.admin)).sort()).toEqual([fa.id, fb.id].sort());
    expect(ids(await list(w.admin, `?branchId=${w.B}`))).toEqual([fb.id]);
  });

  it('filters cannot widen the scope; operator injection is never a query', async () => {
    const w = await followUpWorld(app);
    const a = await mkEnquiry(app, w.mgrA, { assignedTo: asId(w.salesA) });
    const b = await mkEnquiry(app, w.mgrB);
    await mkFollowUp(app, w.mgrA, { enquiryId: a.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    const fb = await mkFollowUp(app, w.mgrB, { enquiryId: b.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    expect((await list(w.mgrA, `?branchId=${w.B}`)).status).toBe(403);
    expect((await list(w.salesA, `?branchId=${w.B}`)).status).toBe(403);
    expect(ids(await list(w.mgrA, `?enquiryId=${b.id}`))).toEqual([]);
    expect(ids(await list(w.mgrA, `?assignedTo=${asId(w.salesB)}`))).toEqual([]);
    expect(ids(await list(w.mgrA, `?personId=${b.personId}`))).toEqual([]);
    expect(ids(await list(w.salesA, `?assignedTo=${asId(w.mgrA)}`))).toEqual([]);
    expect(ids(await list(w.mgrA, `?search=${encodeURIComponent(b.enquiryNo)}`))).toEqual([]);
    for (const qs of ['search[$ne]=x', 'status[$ne]=PENDING', 'assignedTo[$ne]=x', 'branchId[$ne]=x']) {
      const res = await list(w.mgrA, `?${qs}`);
      expect([200, 400], qs).toContain(res.status);
      if (res.status === 200) expect(ids(res), qs).not.toContain(fb.id);
    }
  });

  it('another branch gets the same 404 as a made-up id on every verb', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    await grant('MANAGER', 'followups.archive');
    const ghost = new Types.ObjectId().toHexString();
    const attempts = [
      (id: string) => request(app).get(api(`/followups/${id}`)).set(w.mgrB.auth),
      (id: string) => request(app).patch(api(`/followups/${id}`)).set(w.mgrB.auth).send({ notes: 'x' }),
      (id: string) => post(w.mgrB, `/followups/${id}/complete`),
      (id: string) => post(w.mgrB, `/followups/${id}/reschedule`, { scheduledAt: inDays(2) }),
      (id: string) => post(w.mgrB, `/followups/${id}/cancel`, { reason: 'because' }),
      (id: string) => request(app).delete(api(`/followups/${id}`)).set(w.mgrB.auth),
      (id: string) => request(app).get(api(`/activities?refType=followup&refId=${id}`)).set(w.mgrB.auth),
    ];
    for (const attempt of attempts) {
      const real = await attempt(f.id);
      expect(real.status).toBe(404);
      expect(real.body.error).toEqual((await attempt(ghost)).body.error);
    }
  });

  it('401 without a token, 403 without the specific permission', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    for (const [m, p] of [['get', '/followups'], ['get', '/followups/summary'], ['get', `/followups/${f.id}`], ['post', '/followups'], ['patch', `/followups/${f.id}`], ['post', `/followups/${f.id}/complete`], ['post', `/followups/${f.id}/reschedule`], ['post', `/followups/${f.id}/cancel`], ['delete', `/followups/${f.id}`]] as const) {
      expect((await (request(app) as never as Record<string, (u: string) => request.Test>)[m]!(api(p)).send({})).status, `${m} ${p}`).toBe(401);
    }
    await revoke('MANAGER', 'followups.view');
    expect((await list(w.mgrA)).status).toBe(403);
    expect((await request(app).get(api('/followups/summary')).set(w.mgrA.auth)).status).toBe(403);
    expect((await request(app).get(api(`/followups/${f.id}`)).set(w.mgrA.auth)).status).toBe(403);
  });

  it('the `allowed` flags follow permissions, so the UI never offers what the API would refuse', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    await revoke('SALES_EXECUTIVE', 'followups.edit');
    expect((await request(app).get(api(`/followups/${f.id}`)).set(w.salesA.auth)).body.data.allowed).toEqual({ edit: false, complete: false, reschedule: false, cancel: false, archive: false });
  });
});

describe('timeline', () => {
  it('follow-up events appear on the enquiry, client and follow-up timelines according to the same entity rules', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    await post(w.salesA, `/followups/${f.id}/reschedule`, { scheduledAt: inDays(2) });
    await post(w.salesA, `/followups/${f.id}/complete`);
    const types = async (refType: string, id: string, who = w.mgrA) => (await request(app).get(api(`/activities?refType=${refType}&refId=${id}`)).set(who.auth)).body.data.map((a: { type: string }) => a.type).sort();
    expect(await types('followup', f.id)).toEqual(['FOLLOWUP_COMPLETED', 'FOLLOWUP_RESCHEDULED', 'FOLLOWUP_SCHEDULED']);
    expect(await types('enquiry', e.id)).toEqual(expect.arrayContaining(['ENQUIRY_CREATED', 'FOLLOWUP_COMPLETED', 'FOLLOWUP_SCHEDULED']));
    expect((await types('enquiry', e.id, w.salesA)).length).toBeGreaterThan(0);
    const c = (await createClientApi(app, w.mgrA, { person: { name: 'Raj', phone: '9876543210' } })).body.data;
    const cf = await mkFollowUp(app, w.mgrA, { clientId: c.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    expect(await types('client', c.id)).toEqual(expect.arrayContaining(['CLIENT_CREATED', 'FOLLOWUP_SCHEDULED']));
    expect(cf.clientId).toBe(c.id);
  });

  it('is denied (same 404) to other branches and to OWN users it is not assigned to', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    const ghost = await request(app).get(api(`/activities?refType=followup&refId=${new Types.ObjectId()}`)).set(w.mgrB.auth);
    for (const who of [w.mgrB, w.salesB, w.salesA2]) {
      const res = await request(app).get(api(`/activities?refType=followup&refId=${f.id}`)).set(who.auth);
      expect(res.status).toBe(404);
      expect(res.body.error).toEqual(ghost.body.error);
    }
  });
});

describe('masters and the identity projection', () => {
  it('follow-up types and statuses in use cannot be deleted; unused ones can; deactivation keeps history', async () => {
    const w = await followUpWorld(app);
    const { e } = await setup(w);
    await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    const del = (type: string, id: string) => request(app).delete(api(`/masters/${type}/${id}`)).set(w.admin.auth);
    expect((await del('FOLLOWUP_TYPE', w.ft.call)).body.error.code).toBe('IN_USE');
    expect((await del('FOLLOWUP_TYPE', w.ft.whatsapp)).status).toBe(204);
    await request(app).patch(api(`/masters/FOLLOWUP_TYPE/${w.ft.call}`)).set(w.admin.auth).send({ isActive: false });
    const row = (await list(w.mgrA)).body.data[0];
    expect(row.type).toMatchObject({ label: 'Call', isActive: false }); // history still reads
  });

  it('an identity change updates the person\'s follow-ups in every branch', async () => {
    const w = await followUpWorld(app);
    const e = await mkEnquiry(app, w.mgrA, {}, { name: 'Raj Kumar', phone: '9876543210' });
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1) });
    await request(app).patch(api(`/persons/${e.personId}`)).set(w.mgrA.auth).send({ name: 'Rajkumar S', phone: '9000000001' });
    expect(await FollowUps.findOne({ _id: f.id }).lean()).toMatchObject({ personName: 'Rajkumar S', phoneE164: '+919000000001' });
    expect(ids(await list(w.mgrA, '?search=90000000'))).toEqual([f.id]);
    expect(await People.countDocuments()).toBe(1);
  });
});
