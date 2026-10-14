import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { resetEnvCache } from '../config/env';
import { Notification } from '../core/notify/notification.model';
import { systemRepo } from '../core/scope/system';
import { Role } from '../modules/roles/role.model';
import { FollowUp } from '../modules/followups/followup.model';
import { Master } from '../modules/masters/master.model';
import { useTestDb } from '../test/db';
import { api, followUpWorld, inDays, mkEnquiry, mkFollowUp } from '../test/enquiries';
import { Activities, AuditLogs, makeUser, seedAll } from '../test/factories';
import { flagMissedFollowUps, missedFollowupsJob } from './missedFollowups';
import { jobs, registerJobs } from './registry';
import { remindUpcomingFollowUps, upcomingFollowupsJob } from './upcomingFollowups';

const app = buildApp();
const FollowUps = systemRepo(FollowUp, 'test', 'fixtures');
const Notifications = systemRepo(Notification, 'test', 'fixtures');
const Masters = systemRepo(Master, 'test', 'fixtures');

useTestDb();
beforeEach(seedAll);

const asId = (u: { user: { _id: Types.ObjectId } }) => u.user._id.toHexString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

async function world() {
  const w = await followUpWorld(app);
  const e = await mkEnquiry(app, w.mgrA, { assignedTo: asId(w.salesA) });
  const make = async (over: Record<string, unknown> = {}, scheduledAt: Date = minutesAgo(120)) => {
    const f = await mkFollowUp(app, w.mgrA, { enquiryId: e.id, typeId: w.ft.call, scheduledAt: inDays(1), ...over });
    await FollowUps.updateOne({ _id: f.id }, { $set: { scheduledAt } }); // fixtures only: creation refuses the past
    return f;
  };
  return { w, e, make };
}
const status = async (id: string) => (await FollowUps.findOne({ _id: id }).lean())!.statusKey;
const missedNotes = () => Notifications.find({ eventCode: 'FOLLOWUP_MISSED' }).lean();

describe('missed follow-up job', () => {
  it('flags overdue scheduled follow-ups as MISSED with the MISSED master, audit and activity', async () => {
    const { make } = await world();
    const f = await make();
    const res = await flagMissedFollowUps();
    expect(res.flagged).toBe(1);
    const row = await FollowUps.findOne({ _id: f.id }).lean();
    const missed = await Masters.findOne({ type: 'FOLLOWUP_STATUS', systemKey: 'MISSED' }).lean();
    expect(row).toMatchObject({ statusKey: 'MISSED' });
    expect(String(row!.statusId)).toBe(String(missed!._id));
    expect(row!.missedAt).toBeInstanceOf(Date);
    const audit = await AuditLogs.findOne({ entityType: 'followup', action: 'missed' }).lean();
    expect(audit).toMatchObject({ reason: 'Overdue and not completed' });
    expect(audit!.userId).toBeUndefined(); // done by the system, not a person
    expect(await Activities.countDocuments({ type: 'FOLLOWUP_MISSED' })).toBe(1);
  });

  it('respects the grace period and leaves future, completed, cancelled, archived and already-missed follow-ups alone', async () => {
    const { w, make } = await world();
    const within = await make({}, minutesAgo(10)); // inside the 30-minute grace
    const future = await make({}, new Date(Date.now() + 3_600_000));
    const done = await make();
    const cancelled = await make();
    const archived = await make();
    await request(app).post(api(`/followups/${done.id}/complete`)).set(w.salesA.auth).send({});
    await request(app).post(api(`/followups/${cancelled.id}/cancel`)).set(w.salesA.auth).send({ reason: 'not needed' });
    await FollowUps.updateOne({ _id: done.id }, { $set: { scheduledAt: minutesAgo(120) } });
    await FollowUps.updateOne({ _id: cancelled.id }, { $set: { scheduledAt: minutesAgo(120) } });
    await FollowUps.updateOne({ _id: archived.id }, { $set: { isArchived: true } });
    const target = await make();
    expect((await flagMissedFollowUps()).flagged).toBe(1);
    expect(await status(target.id)).toBe('MISSED');
    for (const f of [within, future]) expect(await status(f.id)).toBe('PENDING');
    expect(await status(done.id)).toBe('COMPLETED');
    expect(await status(cancelled.id)).toBe('CANCELLED');
    expect(await status(archived.id)).toBe('PENDING');
  });

  it('also flags RESCHEDULED follow-ups whose new time has passed', async () => {
    const { w, make } = await world();
    const f = await make({}, new Date(Date.now() + 86_400_000));
    await request(app).post(api(`/followups/${f.id}/reschedule`)).set(w.salesA.auth).send({ scheduledAt: inDays(2) });
    await FollowUps.updateOne({ _id: f.id }, { $set: { scheduledAt: minutesAgo(90) } });
    expect(await status(f.id)).toBe('RESCHEDULED');
    await flagMissedFollowUps();
    expect(await status(f.id)).toBe('MISSED');
  });

  it('is idempotent: running again creates no further status changes, notifications, audit or activity', async () => {
    const { make } = await world();
    await make();
    await make();
    expect((await flagMissedFollowUps()).flagged).toBe(2);
    const counts = async () => [await Notifications.countDocuments(), await AuditLogs.countDocuments({ action: 'missed' }), await Activities.countDocuments({ type: 'FOLLOWUP_MISSED' })];
    const before = await counts();
    for (let i = 0; i < 3; i++) expect((await flagMissedFollowUps()).flagged).toBe(0);
    expect(await counts()).toEqual(before);
  });

  it('concurrent runs flag each follow-up exactly once and notify exactly once', async () => {
    const { make } = await world();
    for (let i = 0; i < 6; i++) await make();
    const results = await Promise.all(Array.from({ length: 4 }, () => flagMissedFollowUps()));
    expect(results.reduce((n, r) => n + r.flagged, 0)).toBe(6);
    expect(await FollowUps.countDocuments({ statusKey: 'MISSED' })).toBe(6);
    expect(await AuditLogs.countDocuments({ action: 'missed' })).toBe(6);
    expect(await Activities.countDocuments({ type: 'FOLLOWUP_MISSED' })).toBe(6);
    const notes = await missedNotes();
    const keys = notes.map((n) => n.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length); // never two notifications for the same follow-up and person
    const perFollowUp = new Map<string, number>();
    for (const n of notes) perFollowUp.set(String(n.refs[0]!.id), (perFollowUp.get(String(n.refs[0]!.id)) ?? 0) + 1);
    expect(new Set(perFollowUp.values()).size).toBe(1); // every follow-up produced the same number of notifications
  });

  it('a completion that lands first wins: the job never flags (or notifies for) a completed follow-up', async () => {
    const { w, make } = await world();
    const f = await make();
    await request(app).post(api(`/followups/${f.id}/complete`)).set(w.salesA.auth).send({});
    await FollowUps.updateOne({ _id: f.id }, { $set: { scheduledAt: minutesAgo(120) } });
    expect((await flagMissedFollowUps()).flagged).toBe(0);
    expect(await status(f.id)).toBe('COMPLETED');
    expect(await Notifications.countDocuments({ eventCode: 'FOLLOWUP_MISSED' })).toBe(0);
  });

  it('racing the job against a completion leaves a consistent result either way', async () => {
    const { w, make } = await world();
    const f = await make();
    const [done] = await Promise.all([request(app).post(api(`/followups/${f.id}/complete`)).set(w.salesA.auth).send({}), flagMissedFollowUps()]);
    expect(done.status).toBe(200); // MISSED is still open, so completing always works
    expect(await status(f.id)).toBe('COMPLETED');
    expect(await AuditLogs.countDocuments({ entityType: 'followup', action: 'complete' })).toBe(1);
  });

  it('a reschedule re-arms it: the moved follow-up can be flagged (and notified) again for its new time', async () => {
    const { w, make } = await world();
    const f = await make();
    await flagMissedFollowUps();
    const first = (await missedNotes()).length;
    expect(first).toBeGreaterThan(0);
    await request(app).post(api(`/followups/${f.id}/reschedule`)).set(w.salesA.auth).send({ scheduledAt: inDays(1), reason: 'Called back' });
    expect(await status(f.id)).toBe('RESCHEDULED');
    expect((await FollowUps.findOne({ _id: f.id }).lean())!.missedAt).toBeUndefined();
    await FollowUps.updateOne({ _id: f.id }, { $set: { scheduledAt: minutesAgo(60) } });
    await flagMissedFollowUps();
    expect(await status(f.id)).toBe('MISSED');
    expect((await missedNotes()).length).toBe(first * 2);
  });

  it('uses the configured grace period', async () => {
    const { make } = await world();
    const f = await make({}, minutesAgo(10));
    expect((await flagMissedFollowUps()).flagged).toBe(0);
    process.env.FOLLOWUP_MISSED_GRACE_MINUTES = '5';
    resetEnvCache();
    try {
      expect((await flagMissedFollowUps()).flagged).toBe(1);
      expect(await status(f.id)).toBe('MISSED');
    } finally {
      delete process.env.FOLLOWUP_MISSED_GRACE_MINUTES;
      resetEnvCache();
    }
  });

  it('is atomic per follow-up: if notifying fails, the status change is rolled back and a later run retries it', async () => {
    const { make } = await world();
    const f = await make();
    const roles = Role;
    const original = roles.find.bind(roles);
    (roles as unknown as { find: unknown }).find = () => {
      throw new Error('recipient lookup failed');
    };
    try {
      await expect(flagMissedFollowUps()).rejects.toThrow('recipient lookup failed');
    } finally {
      (roles as unknown as { find: unknown }).find = original;
    }
    expect(await status(f.id)).toBe('PENDING'); // nothing half-done
    expect(await AuditLogs.countDocuments({ action: 'missed' })).toBe(0);
    expect((await flagMissedFollowUps()).flagged).toBe(1);
  });
});

describe('who is notified about a missed follow-up (by permission, never by role name)', () => {
  it('the assignee and the branch\'s team-alert holders — and nobody else', async () => {
    const { w, make } = await world();
    const mgrA2 = await makeUser({ roleKey: 'MANAGER', branches: [w.A] });
    const inactiveMgr = await makeUser({ roleKey: 'MANAGER', branches: [w.A], isActive: false });
    const superInA = await makeUser({ roleKey: 'SUPER_ADMIN', branches: [w.A] }); // wildcard holds the permission
    const noPerm = await makeUser({ roleKey: 'SALES_EXECUTIVE', branches: [w.A] });
    await Role.create({ name: 'Branch Manager', key: 'FAKE_MANAGER', dataScope: 'BRANCH', permissions: ['followups.view'] }); // named like a manager, but lacks the permission
    const fake = await makeUser({ roleKey: 'FAKE_MANAGER', branches: [w.A] });
    await Role.create({ name: 'Team Lead', key: 'TEAM_LEAD', dataScope: 'BRANCH', permissions: ['notifications.view', 'notifications.team_alerts'] });
    const lead = await makeUser({ roleKey: 'TEAM_LEAD', branches: [w.A] });
    await make();
    await flagMissedFollowUps();
    const recipients = new Set((await missedNotes()).map((n) => String(n.userId)));
    expect(recipients).toEqual(new Set([asId(w.salesA), asId(w.mgrA), mgrA2.user._id.toHexString(), superInA.user._id.toHexString(), lead.user._id.toHexString()]));
    for (const u of [inactiveMgr, noPerm, fake]) expect(recipients.has(u.user._id.toHexString())).toBe(false);
    expect(recipients.has(asId(w.mgrB))).toBe(false); // another branch's manager
    expect(recipients.has(asId(w.admin))).toBe(false); // ALL-scope admin: not a member of the branch
  });

  it('carries a useful message and references to open the right record', async () => {
    const { w, e, make } = await world();
    const f = await make();
    await flagMissedFollowUps();
    const note = (await missedNotes()).find((n) => String(n.userId) === asId(w.mgrA))!;
    expect(note.title).toBe(`Missed follow-up: ${e.name}`);
    expect(note.body).toContain('Call was due');
    expect(note.body).toContain('assigned to SALES_EXECUTIVE');
    expect(note.refs.map((r) => r.type).sort()).toEqual(['enquiry', 'followup', 'person']);
    expect(note.refs.find((r) => r.type === 'followup')!.id.toString()).toBe(f.id);
    expect(note.refs.find((r) => r.type === 'enquiry')!.id.toString()).toBe(e.id);
    expect(String(note.branchId)).toBe(w.A);
    expect(note.readAt).toBeUndefined();
    expect(note.channel).toBe('IN_APP');
  });

  it('end to end: a manager sees the alert in their own inbox, and nobody else\'s', async () => {
    const { w, make } = await world();
    await make();
    await flagMissedFollowUps();
    const mine = await request(app).get(api('/notifications?unread=true')).set(w.mgrA.auth);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({ eventCode: 'FOLLOWUP_MISSED', read: false });
    expect(mine.body.meta.unread).toBe(1);
    expect((await request(app).get(api('/notifications')).set(w.mgrB.auth)).body.data).toEqual([]);
    expect((await request(app).get(api('/notifications')).set(w.admin.auth)).body.data).toEqual([]);
  });
});

describe('upcoming follow-up reminders', () => {
  it('reminds the assignee once when a follow-up is due within the reminder window', async () => {
    const { w, make } = await world();
    const soon = await make({}, new Date(Date.now() + 10 * 60_000));
    const later = await make({}, new Date(Date.now() + 3 * 3_600_000));
    const past = await make({}, minutesAgo(5));
    expect((await remindUpcomingFollowUps()).reminded).toBe(1);
    const notes = await Notifications.find({ eventCode: 'FOLLOWUP_UPCOMING' }).lean();
    expect(notes).toHaveLength(1);
    expect(String(notes[0]!.userId)).toBe(asId(w.salesA));
    expect(String(notes[0]!.refs[0]!.id)).toBe(soon.id);
    expect((await FollowUps.findOne({ _id: soon.id }).lean())!.upcomingNotifiedAt).toBeInstanceOf(Date);
    for (const f of [later, past]) expect((await FollowUps.findOne({ _id: f.id }).lean())!.upcomingNotifiedAt).toBeUndefined();
  });

  it('is idempotent and safe to run concurrently', async () => {
    const { make } = await world();
    for (let i = 0; i < 4; i++) await make({}, new Date(Date.now() + 10 * 60_000));
    const results = await Promise.all(Array.from({ length: 4 }, () => remindUpcomingFollowUps()));
    expect(results.reduce((n, r) => n + r.reminded, 0)).toBe(4);
    for (let i = 0; i < 2; i++) expect((await remindUpcomingFollowUps()).reminded).toBe(0);
    expect(await Notifications.countDocuments({ eventCode: 'FOLLOWUP_UPCOMING' })).toBe(4);
  });

  it('skips completed, cancelled and archived follow-ups, and re-reminds after a reschedule', async () => {
    const { w, make } = await world();
    const done = await make({}, new Date(Date.now() + 10 * 60_000));
    const f = await make({}, new Date(Date.now() + 10 * 60_000));
    await request(app).post(api(`/followups/${done.id}/complete`)).set(w.salesA.auth).send({});
    expect((await remindUpcomingFollowUps()).reminded).toBe(1);
    await request(app).post(api(`/followups/${f.id}/reschedule`)).set(w.salesA.auth).send({ scheduledAt: inDays(1) });
    await FollowUps.updateOne({ _id: f.id }, { $set: { scheduledAt: new Date(Date.now() + 15 * 60_000) } });
    expect((await remindUpcomingFollowUps()).reminded).toBe(1);
    expect(await Notifications.countDocuments({ eventCode: 'FOLLOWUP_UPCOMING' })).toBe(2);
  });
});

describe('job registration', () => {
  it('both jobs are registered with valid schedules and run without the web app', async () => {
    expect(jobs.map((j) => j.name).sort()).toEqual(['followups.missed', 'followups.upcoming', 'sitevisits.upcoming']);
    const tasks = registerJobs([missedFollowupsJob, upcomingFollowupsJob], 'Asia/Kolkata');
    expect(tasks).toHaveLength(2);
    await Promise.all(tasks.map((t) => t.destroy()));
    const { make } = await world();
    const f = await make();
    await missedFollowupsJob.run(); // exactly what the worker calls
    expect(await status(f.id)).toBe('MISSED');
  });
});
