import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { getEnv, resetEnvCache } from '../../config/env';
import { PERMISSION_CATALOG } from '../../core/permissions/catalog';
import { Notification } from '../../core/notify/notification.model';
import { systemRepo } from '../../core/scope/system';
import { remindUpcomingVisits } from '../../jobs/siteVisitReminders';
import { nextLocalDayAt } from '../../lib/time';
import { useTestDb } from '../../test/db';
import { Activities, AuditLogs, makeUser, seedAll } from '../../test/factories';
import { api, assignVisitApi, cancelVisitApi, completeVisitApi, createVisitApi, getVisitApi, grant, inDays, mkEnquiry, mkUnit, mkVisit, readyEnquiry, revoke, visitWorld, type VW } from '../../test/sitevisits';
import { Enquiry, EnquiryStageHistory } from '../enquiries/enquiry.model';
import { FollowUp } from '../followups/followup.model';
import { isMasterReferenced } from '../masters/references';
import { Master } from '../masters/master.model';
import { Person } from '../persons/person.model';
import { Unit } from '../units/unit.model';
import { SiteVisit, SiteVisitAssignment } from './sitevisit.model';

const app = buildApp();
const Visits = systemRepo(SiteVisit, 'test', 'fixtures');
const Assignments = systemRepo(SiteVisitAssignment, 'test', 'fixtures');
const Enquiries = systemRepo(Enquiry, 'test', 'fixtures');
const History = systemRepo(EnquiryStageHistory, 'test', 'fixtures');
const FollowUps = systemRepo(FollowUp, 'test', 'fixtures');
const Units = systemRepo(Unit, 'test', 'fixtures');
const Notifications = systemRepo(Notification, 'test', 'fixtures');
const Masters = systemRepo(Master, 'test', 'fixtures');
const People = systemRepo(Person, 'test', 'fixtures');

useTestDb();
beforeEach(seedAll);

const uid = (a: { user: { _id: Types.ObjectId } }) => a.user._id.toHexString();
const stageOf = async (id: string) => (await Enquiries.findOne({ _id: id }).lean())!.stageCode;
const codes = (res: request.Response) => (res.body.data as { visitNo: string }[]).map((v) => v.visitNo);
const list = (w: VW, who: { auth: Record<string, string> }, q = '') => request(app).get(api(`/sitevisits${q}`)).set(who.auth);

/** A ready enquiry, a unit and a scheduled visit (assigned to salesA by default). */
async function scheduled(w: VW, extra: { enquiry?: Record<string, unknown>; visit?: Record<string, unknown>; units?: number } = {}) {
  const enquiry = await readyEnquiry(app, w, { assignedTo: uid(w.salesA), ...extra.enquiry });
  const units = [];
  for (let i = 0; i < (extra.units ?? 1); i++) units.push(await mkUnit(app, w.mgrA));
  const visit = await mkVisit(app, w.mgrA, { enquiryId: enquiry.id, unitIds: units.map((u) => u.id), assignedTo: uid(w.salesA), ...extra.visit });
  return { enquiry, units, visit };
}

describe('scheduling a site visit', () => {
  it('creates a scheduled visit for an enquiry, in its branch, with its person, units and assignee', async () => {
    const w = await visitWorld(app);
    const enquiry = await readyEnquiry(app, w, { assignedTo: uid(w.salesA) });
    const [u1, u2] = [await mkUnit(app, w.mgrA, { name: 'Villa 1' }), await mkUnit(app, w.mgrA, { name: 'Villa 2' })];
    const res = await createVisitApi(app, w.mgrA, { enquiryId: enquiry.id, scheduledAt: inDays(1), unitIds: [u1.id, u2.id], assignedTo: uid(w.salesA), notes: 'Bring brochure', latitude: 13.08, longitude: 80.27 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      visitNo: 'SV-000001', branchId: w.A, branch: { code: 'A' }, enquiryId: enquiry.id, enquiryNo: enquiry.enquiryNo, name: enquiry.name, statusKey: 'SCHEDULED', status: { label: 'Scheduled' },
      assignedTo: uid(w.salesA), unitCount: 2, notes: 'Bring brochure', latitude: 13.08, longitude: 80.27, isArchived: false,
    });
    expect(res.body.data.units.map((u: { unitCode: string; name: string }) => [u.unitCode, u.name])).toEqual([[u1.unitCode, 'Villa 1'], [u2.unitCode, 'Villa 2']]);
    expect(res.body.data.allowed).toMatchObject({ edit: true, assign: true, complete: true, cancel: true, archive: false });
    expect(await Assignments.find({ siteVisitId: res.body.data.id }).lean()).toMatchObject([{ toUserId: w.salesA.user._id }]);
  });

  it('does NOT create a follow-up, and does not touch the units', async () => {
    const w = await visitWorld(app);
    const { units } = await scheduled(w);
    expect(await FollowUps.countDocuments({})).toBe(0);
    const unit = await Units.findOne({ _id: units[0]!.id }).lean();
    expect(unit).toMatchObject({ statusKey: 'AVAILABLE' });
    expect(unit!.assignedTo).toBeUndefined();
  });

  it('moves the enquiry to SITE_VISIT_SCHEDULED through the visit, with history, audit and activity', async () => {
    const w = await visitWorld(app);
    const { enquiry, units, visit } = await scheduled(w);
    expect(await stageOf(enquiry.id)).toBe('SITE_VISIT_SCHEDULED');
    expect(await History.find({ enquiryId: enquiry.id, toStage: 'SITE_VISIT_SCHEDULED' }).lean()).toMatchObject([{ fromStage: 'INTERESTED', direction: 'FORWARD' }]);
    const audit = await AuditLogs.findOne({ entityType: 'sitevisit', action: 'create' }).lean();
    expect(String(audit!.entityId)).toBe(visit.id);
    expect(String(audit!.branchId)).toBe(w.A);
    const act = await Activities.findOne({ type: 'SITE_VISIT_CREATED' }).lean();
    expect(act!.refs.map((r) => r.type).sort()).toEqual(['enquiry', 'person', 'sitevisit', 'unit']);
    expect(act!.refs.find((r) => r.type === 'unit')!.id.toString()).toBe(units[0]!.id);
  });

  it('a second visit for an enquiry that is already at or past that stage does not move it', async () => {
    const w = await visitWorld(app);
    const { enquiry, visit } = await scheduled(w);
    await mkVisit(app, w.mgrA, { enquiryId: enquiry.id, assignedTo: uid(w.salesA) });
    expect(await stageOf(enquiry.id)).toBe('SITE_VISIT_SCHEDULED');
    expect(await History.countDocuments({ enquiryId: enquiry.id, toStage: 'SITE_VISIT_SCHEDULED' })).toBe(1);
    expect((await completeVisitApi(app, w.mgrA, visit.id)).status).toBe(200);
    expect(await stageOf(enquiry.id)).toBe('SITE_VISIT_COMPLETED');
    await mkVisit(app, w.mgrA, { enquiryId: enquiry.id, assignedTo: uid(w.salesA) }); // a visit after completion: stage stays
    expect(await stageOf(enquiry.id)).toBe('SITE_VISIT_COMPLETED');
  });

  it('numbers visits sequentially and never reuses them', async () => {
    const w = await visitWorld(app);
    const { enquiry } = await scheduled(w);
    const b = await mkVisit(app, w.mgrA, { enquiryId: enquiry.id });
    expect(b.visitNo).toBe('SV-000002');
  });

  it('needs a real, visible enquiry (unknown, malformed, other branch, missing)', async () => {
    const w = await visitWorld(app);
    const other = await mkEnquiry(app, w.mgrB);
    await Promise.all([]);
    for (const enquiryId of [new Types.ObjectId().toHexString(), other.id]) expect((await createVisitApi(app, w.mgrA, { enquiryId, scheduledAt: inDays(1) })).status, enquiryId).toBe(404);
    expect((await createVisitApi(app, w.mgrA, { enquiryId: 'nope', scheduledAt: inDays(1) })).status).toBe(400);
    expect((await createVisitApi(app, w.mgrA, { scheduledAt: inDays(1) })).status).toBe(400);
    expect(await Visits.countDocuments({})).toBe(0);
  });

  it('refuses a lost enquiry, but accepts a walk-in straight from New', async () => {
    const w = await visitWorld(app);
    const fresh = await mkEnquiry(app, w.mgrA); // NEW
    // Scheduling is a real activity, so it is allowed to skip the stages a walk-in never passed
    // through. The stage moves to "Site Visit Scheduled" and the jump is recorded, not invented.
    const walkIn = await createVisitApi(app, w.mgrA, { enquiryId: fresh.id, scheduledAt: inDays(1) });
    expect(walkIn.status).toBe(201);
    expect(await stageOf(fresh.id)).toBe('SITE_VISIT_SCHEDULED');
    expect(await Visits.countDocuments({})).toBe(1);
    const lost = await readyEnquiry(app, w);
    await request(app).post(api(`/enquiries/${lost.id}/lose`)).set(w.mgrA.auth).send({ lostReasonId: w.m.lost });
    const res = await createVisitApi(app, w.mgrA, { enquiryId: lost.id, scheduledAt: inDays(1) });
    expect(res.body.error.code).toBe('ENQUIRY_LOST');
  });

  it('validates the time and the rest of the body (strict)', async () => {
    const w = await visitWorld(app);
    const e = await readyEnquiry(app, w);
    const bad: Record<string, unknown>[] = [
      { scheduledAt: '2020-01-01T10:00:00Z' }, { scheduledAt: 'not a date' }, { scheduledAt: undefined },
      { latitude: 95, longitude: 0 }, { latitude: 10 }, { longitude: 10 }, { unitIds: 'x' }, { unitIds: ['nope'] }, { notes: 'x'.repeat(2001) },
      { statusKey: 'COMPLETED' }, { statusId: w.st.sold }, { branchId: w.B }, { personId: w.A }, { visitNo: 'SV-9' }, { followUpId: w.A },
    ];
    for (const b of bad) expect((await createVisitApi(app, w.mgrA, { enquiryId: e.id, scheduledAt: inDays(1), ...b })).status, JSON.stringify(b)).toBe(400);
    expect(await Visits.countDocuments({})).toBe(0);
  });

  it('visits can have zero units, but never the same unit twice and never more than 20', async () => {
    const w = await visitWorld(app);
    const e = await readyEnquiry(app, w);
    const u = await mkUnit(app, w.mgrA);
    expect((await createVisitApi(app, w.mgrA, { enquiryId: e.id, scheduledAt: inDays(1), unitIds: [u.id, u.id] })).status).toBe(400);
    expect((await createVisitApi(app, w.mgrA, { enquiryId: e.id, scheduledAt: inDays(1), unitIds: Array.from({ length: 21 }, () => new Types.ObjectId().toHexString()) })).status).toBe(400);
    expect((await createVisitApi(app, w.mgrA, { enquiryId: e.id, scheduledAt: inDays(1) })).status).toBe(201);
  });

  it('needs sitevisits.create; an OWN user needs no enquiries.edit because the visit owns the stage move', async () => {
    const w = await visitWorld(app);
    const e = await readyEnquiry(app, w, { assignedTo: uid(w.salesA) });
    expect((await request(app).post(api('/sitevisits')).send({})).status).toBe(401);
    await revoke('SALES_EXECUTIVE', 'sitevisits.create');
    expect((await createVisitApi(app, w.salesA, { enquiryId: e.id, scheduledAt: inDays(1) })).status).toBe(403);
    await grant('SALES_EXECUTIVE', 'sitevisits.create');
    await revoke('SALES_EXECUTIVE', 'enquiries.edit');
    const ok = await createVisitApi(app, w.salesA, { enquiryId: e.id, scheduledAt: inDays(1) });
    expect(ok.status).toBe(201);
    expect(ok.body.data.assignedTo).toBe(uid(w.salesA));
    expect(await stageOf(e.id)).toBe('SITE_VISIT_SCHEDULED');
  });

  it('notifies the assignee (not the person who scheduled), once', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    const n = await Notifications.find({ eventCode: 'SITE_VISIT_ASSIGNED' }).lean();
    expect(n).toHaveLength(1);
    expect(String(n[0]!.userId)).toBe(uid(w.salesA));
    expect(n[0]!.refs.map((r) => r.type)).toEqual(['sitevisit', 'enquiry']);
    expect(String(n[0]!.refs[0]!.id)).toBe(visit.id);
    // scheduling for yourself tells nobody
    const e = await readyEnquiry(app, w, { assignedTo: uid(w.mgrA) });
    await mkVisit(app, w.mgrA, { enquiryId: e.id, assignedTo: uid(w.mgrA) });
    expect(await Notifications.countDocuments({ eventCode: 'SITE_VISIT_ASSIGNED' })).toBe(1);
  });

  it('defaults the assignee to the enquiry owner, else the person scheduling', async () => {
    const w = await visitWorld(app);
    const owned = await readyEnquiry(app, w, { assignedTo: uid(w.salesA2) });
    expect((await mkVisit(app, w.mgrA, { enquiryId: owned.id })).assignedTo).toBe(uid(w.salesA2));
    const nobody = await readyEnquiry(app, w);
    expect((await mkVisit(app, w.mgrA, { enquiryId: nobody.id })).assignedTo).toBe(uid(w.mgrA));
  });
});

describe('units on a visit', () => {
  it('rejects units of another branch (even when visible to an ALL-scope user), unknown ones and archived ones', async () => {
    const w = await visitWorld(app);
    const e = await readyEnquiry(app, w);
    const foreign = await mkUnit(app, w.mgrB);
    const archived = await mkUnit(app, w.mgrA);
    await request(app).delete(api(`/units/${archived.id}`)).set(w.mgrA.auth);
    const mine = await mkUnit(app, w.mgrA);
    const tryIt = (ids: string[], who = w.admin) => createVisitApi(app, who, { enquiryId: e.id, scheduledAt: inDays(1), unitIds: ids, assignedTo: uid(w.mgrA) });
    const cross = await tryIt([mine.id, foreign.id]); // admin sees both branches; the unit still may not cross branches
    expect(cross.status).toBe(400);
    expect(cross.body.error.details[0]).toMatchObject({ path: 'unitIds.1' });
    expect((await tryIt([new Types.ObjectId().toHexString()])).status).toBe(400);
    expect((await tryIt([archived.id])).status).toBe(400);
    expect((await createVisitApi(app, w.mgrA, { enquiryId: e.id, scheduledAt: inDays(1), unitIds: [foreign.id] })).status).toBe(400); // invisible to a branch manager: same answer
    expect(await Visits.countDocuments({})).toBe(0);
    expect(await stageOf(e.id)).toBe('INTERESTED'); // nothing half-done
    expect((await tryIt([mine.id])).status).toBe(201);
  });

  it('an OWN-scope executive can only add units assigned to them', async () => {
    const w = await visitWorld(app);
    const e = await readyEnquiry(app, w, { assignedTo: uid(w.salesA) });
    const theirs = await mkUnit(app, w.mgrA, { assignedTo: uid(w.salesA) });
    const others = await mkUnit(app, w.mgrA);
    expect((await createVisitApi(app, w.salesA, { enquiryId: e.id, scheduledAt: inDays(1), unitIds: [others.id] })).status).toBe(400);
    expect((await createVisitApi(app, w.salesA, { enquiryId: e.id, scheduledAt: inDays(1), unitIds: [theirs.id] })).status).toBe(201);
  });

  it('an archived unit stays on the visit and is still readable there; editing keeps it', async () => {
    const w = await visitWorld(app);
    const { units, visit } = await scheduled(w, { units: 2 });
    await request(app).delete(api(`/units/${units[0]!.id}`)).set(w.mgrA.auth);
    const detail = (await getVisitApi(app, w.mgrA, visit.id)).body.data;
    expect(detail.units.map((u: { unitCode: string; isArchived: boolean }) => [u.unitCode, u.isArchived])).toEqual([[units[0]!.unitCode, true], [units[1]!.unitCode, false]]);
    const edit = await request(app).patch(api(`/sitevisits/${visit.id}`)).set(w.mgrA.auth).send({ unitIds: units.map((u) => u.id), notes: 'still fine' });
    expect(edit.status).toBe(200); // the archived unit already on the visit is not re-validated
    expect(edit.body.data.unitCount).toBe(2);
  });

  it('a viewer who cannot see a unit still sees its code', async () => {
    const w = await visitWorld(app);
    const { visit, units } = await scheduled(w); // the unit is unassigned, so invisible to the OWN executive
    const seen = (await getVisitApi(app, w.salesA, visit.id)).body.data;
    expect(seen.units).toMatchObject([{ unitCode: units[0]!.unitCode }]);
    expect(seen.units[0].name).toBeUndefined();
  });

  it('can be filtered by unit', async () => {
    const w = await visitWorld(app);
    const a = await scheduled(w);
    await scheduled(w);
    expect(codes(await list(w, w.mgrA, `?unitId=${a.units[0]!.id}`))).toEqual([a.visit.visitNo]);
    expect(codes(await list(w, w.mgrA, `?search=${a.units[0]!.unitCode}`))).toEqual([a.visit.visitNo]);
  });
});

describe('workflow ownership', () => {
  it('a generic enquiry transition can neither enter SITE_VISIT_SCHEDULED nor SITE_VISIT_COMPLETED', async () => {
    const w = await visitWorld(app);
    const e = await readyEnquiry(app, w);
    const into = (to: string) => request(app).post(api(`/enquiries/${e.id}/transition`)).set(w.admin.auth).send({ to });
    const sched = await into('SITE_VISIT_SCHEDULED');
    expect(sched.status).toBe(409);
    expect(sched.body.error).toMatchObject({ code: 'DOMAIN_ONLY', details: { domainOperation: 'sitevisit.schedule' } });
    expect(await stageOf(e.id)).toBe('INTERESTED');
    await mkVisit(app, w.mgrA, { enquiryId: e.id });
    const done = await into('SITE_VISIT_COMPLETED');
    expect(done.body.error).toMatchObject({ code: 'DOMAIN_ONLY', details: { domainOperation: 'sitevisit.complete' } });
    expect(await stageOf(e.id)).toBe('SITE_VISIT_SCHEDULED');
  });

  it('completing the visit moves the enquiry to SITE_VISIT_COMPLETED with history', async () => {
    const w = await visitWorld(app);
    const { enquiry, visit } = await scheduled(w);
    expect((await completeVisitApi(app, w.mgrA, visit.id)).status).toBe(200);
    expect(await stageOf(enquiry.id)).toBe('SITE_VISIT_COMPLETED');
    expect(await History.find({ enquiryId: enquiry.id, toStage: 'SITE_VISIT_COMPLETED' }).lean()).toMatchObject([{ fromStage: 'SITE_VISIT_SCHEDULED', direction: 'FORWARD' }]);
    expect(await AuditLogs.countDocuments({ entityType: 'enquiry', entityId: new Types.ObjectId(enquiry.id), action: 'transition' })).toBeGreaterThanOrEqual(3); // contacted, interested, scheduled, completed
  });

  it('cancelling does not move the enquiry', async () => {
    const w = await visitWorld(app);
    const { enquiry, visit } = await scheduled(w);
    expect((await cancelVisitApi(app, w.mgrA, visit.id)).status).toBe(200);
    expect(await stageOf(enquiry.id)).toBe('SITE_VISIT_SCHEDULED');
  });

  it('if the enquiry was moved elsewhere meanwhile, completing the visit leaves it where it is', async () => {
    const w = await visitWorld(app);
    const { enquiry, visit } = await scheduled(w);
    await request(app).post(api(`/enquiries/${enquiry.id}/transition`)).set(w.mgrA.auth).send({ to: 'INTERESTED', reason: 'plans changed' });
    expect((await completeVisitApi(app, w.mgrA, visit.id)).status).toBe(200);
    expect(await stageOf(enquiry.id)).toBe('INTERESTED');
  });

  it('a simultaneous generic move makes the visit fail cleanly, rolling everything back', async () => {
    const w = await visitWorld(app);
    const e = await readyEnquiry(app, w);
    const [a, b] = await Promise.all([
      createVisitApi(app, w.mgrA, { enquiryId: e.id, scheduledAt: inDays(1) }),
      createVisitApi(app, w.mgrA, { enquiryId: e.id, scheduledAt: inDays(2) }),
    ]);
    // Both prepared the move from INTERESTED; only one can win the stage compare-and-set, the loser rolls back entirely.
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await Visits.countDocuments({})).toBe(1);
    expect(await History.countDocuments({ enquiryId: e.id, toStage: 'SITE_VISIT_SCHEDULED' })).toBe(1);
  });
});

describe('completing a visit', () => {
  it('records completion, feedback, notes and a location snapshot; units are untouched', async () => {
    const w = await visitWorld(app);
    const { visit, units } = await scheduled(w, { visit: { latitude: 13, longitude: 80 } });
    const before = await Units.findOne({ _id: units[0]!.id }).lean();
    const when = new Date(Date.now() - 60_000).toISOString();
    const res = await completeVisitApi(app, w.mgrA, visit.id, { feedback: 'Liked the corner plot', notes: 'Wants a lower floor', completedAt: when, latitude: 13.0827, longitude: 80.2707 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ statusKey: 'COMPLETED', status: { label: 'Completed' }, feedback: 'Liked the corner plot', completionNotes: 'Wants a lower floor', latitude: 13.0827, longitude: 80.2707 });
    expect(new Date(res.body.data.completedAt).toISOString()).toBe(when);
    expect(res.body.data.allowed).toMatchObject({ edit: false, assign: false, complete: false, cancel: false, archive: true });
    const after = await Units.findOne({ _id: units[0]!.id }).lean();
    expect(after).toMatchObject({ statusKey: before!.statusKey, name: before!.name });
    expect(after!.latitude).toBe(before!.latitude); // the visit's snapshot never writes to the unit
    expect(after!.updatedAt).toEqual(before!.updatedAt);
    expect(await AuditLogs.findOne({ entityType: 'sitevisit', action: 'complete' }).lean()).toBeTruthy();
    const act = await Activities.findOne({ type: 'SITE_VISIT_COMPLETED' }).lean();
    expect(act!.refs.map((r) => r.type).sort()).toEqual(['enquiry', 'person', 'sitevisit', 'unit']);
  });

  it('validates input: feedback required, no future time, coordinates paired, strict', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    for (const b of [{}, { feedback: '  ' }, { feedback: 'x', completedAt: new Date(Date.now() + 3_600_000).toISOString() }, { feedback: 'x', latitude: 5 }, { feedback: 'x', latitude: 99, longitude: 0 }, { feedback: 'x', statusKey: 'CANCELLED' }, { feedback: 'x', followUpId: w.A }]) {
      expect((await completeVisitApi(app, w.mgrA, visit.id, b)).status, JSON.stringify(b)).toBe(400);
    }
    expect((await Visits.findOne({ _id: visit.id }).lean())!.statusKey).toBe('SCHEDULED');
  });

  it('creates EXACTLY ONE follow-up for the next calendar day in the app time zone, of the configured type, PENDING', async () => {
    const w = await visitWorld(app);
    const { enquiry, visit } = await scheduled(w);
    const res = await completeVisitApi(app, w.mgrA, visit.id);
    expect(res.status).toBe(200);
    const fus = await FollowUps.find({}).lean();
    expect(fus).toHaveLength(1);
    const f = fus[0]!;
    const env = getEnv();
    expect(Math.abs(f.scheduledAt.getTime() - nextLocalDayAt(new Date(), env.APP_TIMEZONE, env.POST_VISIT_FOLLOWUP_HOUR).getTime())).toBeLessThanOrEqual(86_400_000); // computed around "now"; exact below
    expect(f).toMatchObject({ statusKey: 'PENDING', enquiryNo: enquiry.enquiryNo });
    expect(String(f.enquiryId)).toBe(enquiry.id);
    expect(String(f.siteVisitId)).toBe(visit.id);
    expect(String(f.assignedTo)).toBe(uid(w.salesA)); // the enquiry owner
    const type = await Masters.findOne({ _id: f.typeId }).lean();
    expect(type).toMatchObject({ type: 'FOLLOWUP_TYPE', code: env.POST_VISIT_FOLLOWUP_TYPE_CODE });
    expect(res.body.data.followUpId).toBe(String(f._id));
    const tomorrow = nextLocalDayAt(new Date(), env.APP_TIMEZONE, env.POST_VISIT_FOLLOWUP_HOUR);
    expect(f.scheduledAt.toISOString()).toBe(tomorrow.toISOString());
    const detail = (await getVisitApi(app, w.mgrA, visit.id)).body.data;
    expect(detail.followUp).toMatchObject({ id: String(f._id), statusKey: 'PENDING' });
  });

  it('audits and notifies the follow-up like any other, and shows it on the enquiry', async () => {
    const w = await visitWorld(app);
    const { enquiry, visit } = await scheduled(w);
    await completeVisitApi(app, w.mgrA, visit.id);
    const fu = (await FollowUps.findOne({}).lean())!;
    expect(await AuditLogs.findOne({ entityType: 'followup', entityId: fu._id, action: 'create' }).lean()).toMatchObject({ entityType: 'followup' });
    const act = await Activities.findOne({ type: 'FOLLOWUP_SCHEDULED' }).lean();
    expect(act!.refs.map((r) => `${r.type}`)).toContain('enquiry');
    const n = await Notifications.find({ eventCode: 'FOLLOWUP_ASSIGNED' }).lean();
    expect(n).toHaveLength(1);
    expect(String(n[0]!.userId)).toBe(uid(w.salesA));
    const onEnquiry = await request(app).get(api(`/followups?enquiryId=${enquiry.id}`)).set(w.mgrA.auth);
    expect(onEnquiry.body.data).toHaveLength(1);
  });

  it('assigns the follow-up to the enquiry owner, else the visit assignee, else the person completing', async () => {
    const w = await visitWorld(app);
    const noOwner = await readyEnquiry(app, w);
    const v1 = await mkVisit(app, w.mgrA, { enquiryId: noOwner.id, assignedTo: uid(w.salesA2) });
    await completeVisitApi(app, w.mgrA, v1.id);
    expect(String((await FollowUps.findOne({ siteVisitId: v1.id }).lean())!.assignedTo)).toBe(uid(w.salesA2));
    const owned = await readyEnquiry(app, w, { assignedTo: uid(w.salesA) });
    const v2 = await mkVisit(app, w.mgrA, { enquiryId: owned.id, assignedTo: uid(w.salesA2) });
    await completeVisitApi(app, w.mgrA, v2.id);
    expect(String((await FollowUps.findOne({ siteVisitId: v2.id }).lean())!.assignedTo)).toBe(uid(w.salesA)); // the enquiry owner wins
  });

  it('is idempotent: completing again is refused and creates nothing', async () => {
    const w = await visitWorld(app);
    const { visit, enquiry } = await scheduled(w);
    expect((await completeVisitApi(app, w.mgrA, visit.id)).status).toBe(200);
    const again = await completeVisitApi(app, w.mgrA, visit.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_COMPLETED');
    expect(await FollowUps.countDocuments({})).toBe(1);
    expect(await History.countDocuments({ enquiryId: enquiry.id, toStage: 'SITE_VISIT_COMPLETED' })).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'sitevisit', action: 'complete' })).toBe(1);
    expect(await Activities.countDocuments({ type: 'SITE_VISIT_COMPLETED' })).toBe(1);
  });

  it('simultaneous completions: exactly one wins, one follow-up, one transition, one audit entry', async () => {
    const w = await visitWorld(app);
    const { visit, enquiry } = await scheduled(w);
    const rs = await Promise.all(Array.from({ length: 6 }, () => completeVisitApi(app, w.mgrA, visit.id)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await FollowUps.countDocuments({})).toBe(1);
    expect(await History.countDocuments({ enquiryId: enquiry.id, toStage: 'SITE_VISIT_COMPLETED' })).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'sitevisit', action: 'complete' })).toBe(1);
    expect(await Notifications.countDocuments({ eventCode: 'FOLLOWUP_ASSIGNED' })).toBe(1);
  });

  it('the database itself refuses a second follow-up for the same visit', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    await completeVisitApi(app, w.mgrA, visit.id);
    const f = (await FollowUps.findOne({}).lean())!;
    const dup = FollowUps.create({ branchId: f.branchId, personId: f.personId, personName: f.personName, phoneE164: f.phoneE164, enquiryId: f.enquiryId, enquiryNo: f.enquiryNo, siteVisitId: f.siteVisitId, assignedTo: f.assignedTo, typeId: f.typeId, statusId: f.statusId, statusKey: 'PENDING', scheduledAt: new Date() });
    await expect(dup).rejects.toMatchObject({ code: 11000 });
  });

  it('a configuration problem (follow-up type missing or inactive) is reported BEFORE anything is written', async () => {
    const w = await visitWorld(app);
    const { visit, enquiry } = await scheduled(w);
    await Masters.updateOne({ type: 'FOLLOWUP_TYPE', code: 'CALL' }, { $set: { isActive: false } });
    const res = await completeVisitApi(app, w.mgrA, visit.id);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('POST_VISIT_FOLLOWUP_NOT_CONFIGURED');
    expect((await Visits.findOne({ _id: visit.id }).lean())!.statusKey).toBe('SCHEDULED');
    expect(await stageOf(enquiry.id)).toBe('SITE_VISIT_SCHEDULED');
    expect(await FollowUps.countDocuments({})).toBe(0);
    await Masters.updateOne({ type: 'FOLLOWUP_TYPE', code: 'CALL' }, { $set: { isActive: true } });
    expect((await completeVisitApi(app, w.mgrA, visit.id)).status).toBe(200); // fixed config: it works
  });

  it('the follow-up type is configuration, not code: another master code is used when configured', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    process.env.POST_VISIT_FOLLOWUP_TYPE_CODE = 'meeting';
    resetEnvCache();
    try {
      await completeVisitApi(app, w.mgrA, visit.id);
      const f = (await FollowUps.findOne({}).lean())!;
      expect((await Masters.findOne({ _id: f.typeId }).lean())!.code).toBe('MEETING');
    } finally {
      delete process.env.POST_VISIT_FOLLOWUP_TYPE_CODE;
      resetEnvCache();
    }
  });

  it('a failure after the claim rolls everything back (visit stays scheduled, no follow-up, stage unchanged)', async () => {
    const w = await visitWorld(app);
    const { visit, enquiry } = await scheduled(w);
    // Make the transaction fail late: another completion already created a follow-up for this visit id.
    const first = await FollowUps.create({ branchId: new Types.ObjectId(w.A), personId: new Types.ObjectId(), personName: 'x', phoneE164: '+919000000000', enquiryId: new Types.ObjectId(enquiry.id), enquiryNo: enquiry.enquiryNo, siteVisitId: new Types.ObjectId(visit.id), assignedTo: w.mgrA.user._id, typeId: new Types.ObjectId(), statusId: new Types.ObjectId(), statusKey: 'PENDING', scheduledAt: new Date() });
    expect(first).toBeTruthy();
    const res = await completeVisitApi(app, w.mgrA, visit.id);
    expect(res.status).toBe(409);
    const v = await Visits.findOne({ _id: visit.id }).lean();
    expect(v!.statusKey).toBe('SCHEDULED');
    expect(v!.feedback).toBeUndefined();
    expect(await stageOf(enquiry.id)).toBe('SITE_VISIT_SCHEDULED');
    expect(await FollowUps.countDocuments({})).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'sitevisit', action: 'complete' })).toBe(0);
  });

  it('the assigned OWN-scope executive can complete a visit on an enquiry they cannot see', async () => {
    const w = await visitWorld(app);
    const e = await readyEnquiry(app, w); // unassigned: invisible to an OWN executive
    const visit = await mkVisit(app, w.mgrA, { enquiryId: e.id, assignedTo: uid(w.salesA) });
    expect((await request(app).get(api(`/enquiries/${e.id}`)).set(w.salesA.auth)).status).toBe(404);
    const res = await completeVisitApi(app, w.salesA, visit.id, { feedback: 'Done' });
    expect(res.status).toBe(200);
    expect(await stageOf(e.id)).toBe('SITE_VISIT_COMPLETED');
    const f = (await FollowUps.findOne({}).lean())!;
    expect(String(f.assignedTo)).toBe(uid(w.salesA));
    expect((await request(app).get(api(`/enquiries/${e.id}`)).set(w.salesA.auth)).status).toBe(404); // and gained no lasting access
  });

  it('needs sitevisits.complete', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    await revoke('SALES_EXECUTIVE', 'sitevisits.complete');
    expect((await completeVisitApi(app, w.salesA, visit.id)).status).toBe(403);
    expect((await Visits.findOne({ _id: visit.id }).lean())!.statusKey).toBe('SCHEDULED');
  });
});

describe('cancelling a visit', () => {
  it('cancels with a reason: no follow-up, no stage change, audit and timeline', async () => {
    const w = await visitWorld(app);
    const { visit, enquiry } = await scheduled(w);
    expect((await cancelVisitApi(app, w.mgrA, visit.id, {})).status).toBe(400);
    expect((await cancelVisitApi(app, w.mgrA, visit.id, { reason: 'ab' })).status).toBe(400);
    const res = await cancelVisitApi(app, w.mgrA, visit.id, { reason: 'Customer travelling' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ statusKey: 'CANCELLED', status: { label: 'Cancelled' }, cancelReason: 'Customer travelling' });
    expect(res.body.data.allowed).toMatchObject({ edit: false, complete: false, cancel: false, archive: true });
    expect(await FollowUps.countDocuments({})).toBe(0);
    expect(await stageOf(enquiry.id)).toBe('SITE_VISIT_SCHEDULED');
    expect(await AuditLogs.findOne({ entityType: 'sitevisit', action: 'cancel' }).lean()).toMatchObject({ reason: 'Customer travelling' });
    expect(await Activities.countDocuments({ type: 'SITE_VISIT_CANCELLED' })).toBe(1);
  });

  it('a closed visit cannot be completed, cancelled, edited or reassigned', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    await cancelVisitApi(app, w.mgrA, visit.id);
    expect((await completeVisitApi(app, w.mgrA, visit.id)).body.error.code).toBe('VISIT_CLOSED');
    expect((await cancelVisitApi(app, w.mgrA, visit.id)).status).toBe(409);
    expect((await request(app).patch(api(`/sitevisits/${visit.id}`)).set(w.mgrA.auth).send({ notes: 'x' })).status).toBe(409);
    expect((await assignVisitApi(app, w.mgrA, visit.id, { assignedTo: uid(w.salesA2), reason: 'x' })).status).toBe(409);
    expect(await FollowUps.countDocuments({})).toBe(0);
    const done = (await scheduled(w)).visit;
    await completeVisitApi(app, w.mgrA, done.id);
    expect((await cancelVisitApi(app, w.mgrA, done.id)).status).toBe(409);
  });

  it('completing and cancelling at the same time: exactly one wins', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    const [c, x] = await Promise.all([completeVisitApi(app, w.mgrA, visit.id), cancelVisitApi(app, w.mgrA, visit.id)]);
    expect([c.status, x.status].sort()).toEqual([200, 409]);
    const final = (await Visits.findOne({ _id: visit.id }).lean())!.statusKey;
    expect(await FollowUps.countDocuments({})).toBe(final === 'COMPLETED' ? 1 : 0);
  });

  it('needs sitevisits.cancel', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    await revoke('SALES_EXECUTIVE', 'sitevisits.cancel');
    expect((await cancelVisitApi(app, w.salesA, visit.id)).status).toBe(403);
  });
});

describe('status cannot be mutated outside the lifecycle', () => {
  it('generic PATCH rejects every status-ish or ownership field, and there is no status route', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    const patch = (b: Record<string, unknown>) => request(app).patch(api(`/sitevisits/${visit.id}`)).set(w.admin.auth).send(b);
    for (const b of [{ statusKey: 'COMPLETED' }, { statusId: w.st.sold }, { status: 'COMPLETED' }, { assignedTo: uid(w.salesA2) }, { enquiryId: w.A }, { branchId: w.B }, { completedAt: new Date().toISOString() }, { feedback: 'x' }, { followUpId: w.A }, { isArchived: true }, { visitNo: 'SV-9' }, {}]) {
      expect((await patch(b)).status, JSON.stringify(b)).toBe(400);
    }
    for (const [m, p] of [['post', `/sitevisits/${visit.id}/status`], ['put', `/sitevisits/${visit.id}/status`], ['patch', `/sitevisits/${visit.id}/status`]] as const) {
      expect([404, 405]).toContain((await request(app)[m](api(p)).set(w.admin.auth).send({ statusKey: 'COMPLETED' })).status);
    }
    expect(await Visits.findOne({ _id: visit.id }).lean()).toMatchObject({ statusKey: 'SCHEDULED' });
  });
});

describe('updating a scheduled visit', () => {
  it('reschedules, changes notes, location and units, with audit before/after and a reminder reset', async () => {
    const w = await visitWorld(app);
    const { visit, units } = await scheduled(w, { visit: { notes: 'first' } });
    await Visits.updateOne({ _id: visit.id }, { $set: { upcomingNotifiedAt: new Date() } });
    const extra = await mkUnit(app, w.mgrA);
    const to = inDays(3);
    const res = await request(app).patch(api(`/sitevisits/${visit.id}`)).set(w.mgrA.auth).send({ scheduledAt: to, notes: null, latitude: 12.9, longitude: 77.6, unitIds: [units[0]!.id, extra.id] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ unitCount: 2, latitude: 12.9, longitude: 77.6, rescheduleCount: 1 });
    expect(res.body.data.notes).toBeUndefined();
    expect(new Date(res.body.data.scheduledAt).toISOString()).toBe(new Date(to).toISOString());
    const row = await Visits.findOne({ _id: visit.id }).lean();
    expect(row!.upcomingNotifiedAt).toBeUndefined();
    const audit = await AuditLogs.findOne({ entityType: 'sitevisit', action: 'update' }).lean();
    expect(audit!.changes).toMatchObject({ notes: { from: 'first' }, latitude: { to: 12.9 } });
    expect(await Activities.countDocuments({ type: 'SITE_VISIT_UPDATED' })).toBe(1);
    expect((await request(app).patch(api(`/sitevisits/${visit.id}`)).set(w.mgrA.auth).send({ unitIds: [] })).body.data.unitCount).toBe(0);
  });

  it('validates the new time and coordinates', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    const patch = (b: Record<string, unknown>) => request(app).patch(api(`/sitevisits/${visit.id}`)).set(w.mgrA.auth).send(b);
    expect((await patch({ scheduledAt: '2020-01-01T00:00:00Z' })).status).toBe(400);
    expect((await patch({ latitude: 10 })).status).toBe(400);
    expect((await patch({ latitude: null, longitude: 4 })).status).toBe(400);
    expect((await patch({ unitIds: [new Types.ObjectId().toHexString()] })).status).toBe(400);
  });

  it('needs sitevisits.edit', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    await revoke('SALES_EXECUTIVE', 'sitevisits.edit');
    expect((await request(app).patch(api(`/sitevisits/${visit.id}`)).set(w.salesA.auth).send({ notes: 'x' })).status).toBe(403);
  });
});

describe('assignment', () => {
  it('reassigns with a reason; history, audit, timeline and a notification for the new assignee', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    expect((await assignVisitApi(app, w.mgrA, visit.id, { assignedTo: uid(w.salesA2) })).status).toBe(400); // reason required
    const res = await assignVisitApi(app, w.mgrA, visit.id, { assignedTo: uid(w.salesA2), reason: 'First assignee is ill' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ assignedTo: uid(w.salesA2) });
    const detail = (await getVisitApi(app, w.mgrA, visit.id)).body.data;
    expect(detail.assignments).toHaveLength(2);
    expect(detail.assignments[1]).toMatchObject({ from: uid(w.salesA), to: uid(w.salesA2), by: uid(w.mgrA), reason: 'First assignee is ill' });
    expect(await AuditLogs.countDocuments({ entityType: 'sitevisit', action: 'assign' })).toBe(1);
    expect(await Activities.countDocuments({ type: 'SITE_VISIT_ASSIGNED' })).toBe(1);
    expect(await Notifications.countDocuments({ eventCode: 'SITE_VISIT_ASSIGNED', userId: w.salesA2.user._id })).toBe(1);
  });

  it('refuses a no-op and invalid assignees (other branch, inactive, unknown, malformed)', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    expect((await assignVisitApi(app, w.mgrA, visit.id, { assignedTo: uid(w.salesA), reason: 'same' })).body.error.code).toBe('NO_CHANGE');
    const inactive = await makeUser({ roleKey: 'SALES_EXECUTIVE', branches: [w.A], isActive: false });
    for (const to of [uid(w.salesB), inactive.user._id.toHexString(), new Types.ObjectId().toHexString(), 'nope']) expect((await assignVisitApi(app, w.mgrA, visit.id, { assignedTo: to, reason: 'why' })).status, to).toBe(400);
    expect(await Assignments.countDocuments({ siteVisitId: visit.id })).toBe(1);
  });

  it('scheduling for someone invalid is refused too', async () => {
    const w = await visitWorld(app);
    const e = await readyEnquiry(app, w);
    const inactive = await makeUser({ roleKey: 'SALES_EXECUTIVE', branches: [w.A], isActive: false });
    for (const to of [uid(w.salesB), inactive.user._id.toHexString(), new Types.ObjectId().toHexString()]) expect((await createVisitApi(app, w.mgrA, { enquiryId: e.id, scheduledAt: inDays(1), assignedTo: to })).status, to).toBe(400);
    expect(await Visits.countDocuments({})).toBe(0);
  });

  it('OWN scope can only take a visit for themselves', async () => {
    const w = await visitWorld(app);
    await grant('SALES_EXECUTIVE', 'sitevisits.assign');
    const { visit } = await scheduled(w);
    expect((await assignVisitApi(app, w.salesA, visit.id, { assignedTo: uid(w.salesA2), reason: 'pass it on' })).status).toBe(403);
    expect((await Visits.findOne({ _id: visit.id }).lean())!.assignedTo.toHexString()).toBe(uid(w.salesA));
  });

  it('simultaneous assignments: exactly one wins and history has one new row', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    const [x, y] = await Promise.all([
      assignVisitApi(app, w.mgrA, visit.id, { assignedTo: uid(w.salesA2), reason: 'a' }),
      assignVisitApi(app, w.mgrA, visit.id, { assignedTo: uid(w.mgrA), reason: 'b' }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect([x, y].find((r) => r.status === 409)!.body.error.code).toBe('ASSIGNMENT_CHANGED');
    expect(await Assignments.countDocuments({ siteVisitId: visit.id })).toBe(2);
  });

  it('needs sitevisits.assign', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    expect((await assignVisitApi(app, w.salesA, visit.id, { assignedTo: uid(w.salesA), reason: 'x' })).status).toBe(403);
  });
});

describe('scope', () => {
  it('BRANCH sees its branch; ALL sees everything and can narrow; a foreign branch filter is refused', async () => {
    const w = await visitWorld(app);
    const a = await scheduled(w);
    const eb = await mkEnquiry(app, w.mgrB);
    await advance2(w, eb.id);
    const b = await mkVisit(app, w.mgrB, { enquiryId: eb.id });
    expect(codes(await list(w, w.mgrA))).toEqual([a.visit.visitNo]);
    expect(codes(await list(w, w.mgrB))).toEqual([b.visitNo]);
    expect(codes(await list(w, w.admin)).sort()).toEqual([a.visit.visitNo, b.visitNo].sort());
    expect(codes(await list(w, w.admin, `?branchId=${w.B}`))).toEqual([b.visitNo]);
    const widen = await list(w, w.mgrA, `?branchId=${w.B}`);
    expect(widen.status).toBe(403);
    expect(widen.body.data).toBeUndefined();
  });

  it('OWN sees only visits assigned to them, whatever the filters say', async () => {
    const w = await visitWorld(app);
    const mine = await scheduled(w);
    const theirs = await scheduled(w, { visit: { assignedTo: uid(w.salesA2) } });
    expect(codes(await list(w, w.salesA))).toEqual([mine.visit.visitNo]);
    expect(codes(await list(w, w.salesA, `?assignedTo=${uid(w.salesA2)}`))).toEqual([]);
    expect(codes(await list(w, w.salesA, `?search=${theirs.visit.visitNo}`))).toEqual([]);
    expect((await getVisitApi(app, w.salesA, theirs.visit.id)).status).toBe(404);
    expect((await getVisitApi(app, w.salesA, mine.visit.id)).status).toBe(200);
    expect((await list(w, w.salesA, `?branchId=${w.B}`)).status).toBe(403);
  });

  it('cross-branch access is a 404 on every operation, identical to a missing id', async () => {
    const w = await visitWorld(app);
    const eb = await mkEnquiry(app, w.mgrB);
    await advance2(w, eb.id);
    const b = await mkVisit(app, w.mgrB, { enquiryId: eb.id });
    const ghost = new Types.ObjectId().toHexString();
    const probes = (id: string) => [
      getVisitApi(app, w.mgrA, id),
      request(app).patch(api(`/sitevisits/${id}`)).set(w.mgrA.auth).send({ notes: 'x' }),
      request(app).delete(api(`/sitevisits/${id}`)).set(w.mgrA.auth),
      assignVisitApi(app, w.mgrA, id, { assignedTo: uid(w.salesA), reason: 'x' }),
      completeVisitApi(app, w.mgrA, id),
      cancelVisitApi(app, w.mgrA, id),
    ];
    const real = await Promise.all(probes(b.id));
    const fake = await Promise.all(probes(ghost));
    expect(real.map((r) => r.status)).toEqual(Array(6).fill(404));
    expect(real.map((r) => r.body.error.code)).toEqual(fake.map((r) => r.body.error.code));
    expect((await Visits.findOne({ _id: b.id }).lean())!.statusKey).toBe('SCHEDULED');
  });

  it('an OWN executive cannot schedule a visit on an enquiry that is not theirs, and an enquiry of another branch is a 404', async () => {
    const w = await visitWorld(app);
    const notMine = await readyEnquiry(app, w);
    expect((await createVisitApi(app, w.salesA, { enquiryId: notMine.id, scheduledAt: inDays(1) })).status).toBe(404);
    const eb = await mkEnquiry(app, w.mgrB);
    expect((await createVisitApi(app, w.mgrA, { enquiryId: eb.id, scheduledAt: inDays(1) })).status).toBe(404);
    expect(await Visits.countDocuments({})).toBe(0);
  });
});

async function advance2(w: VW, enquiryId: string) {
  for (const to of ['CONTACTED', 'INTERESTED']) await request(app).post(api(`/enquiries/${enquiryId}/transition`)).set(w.admin.auth).send({ to });
}

describe('listing, search and filters (server-side)', () => {
  /**
   * Regression: the calendar view asked for `limit: 500` and the list endpoint rejected it with a
   * 400 VALIDATION_ERROR, so the calendar rendered "Validation failed" instead of the month. The
   * date range it sends is fine — `from`/`to` are ordinary `z.coerce.date()` values — so this
   * pins the page-size contract the calendar depends on.
   */
  it('accepts the calendar\'s date range and page size, and still rejects an over-cap limit', async () => {
    const w = await visitWorld(app);
    const from = '2026-10-03T18:30:00.000Z';
    const to = '2026-11-07T18:29:59.999Z';
    const okRes = await request(app).get(api(`/sitevisits?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=100&sort=scheduledAt`)).set(w.mgrA.auth);
    expect(okRes.status).toBe(200);
    const overCap = await request(app).get(api(`/sitevisits?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=500`)).set(w.mgrA.auth);
    expect(overCap.status).toBe(400);
    expect(overCap.body.error.code).toBe('VALIDATION_ERROR');
    expect(overCap.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'limit' })]));
  });
  it('searches by visit number, bare number, enquiry number, name and phone', async () => {
    const w = await visitWorld(app);
    const a = await scheduled(w, { enquiry: {} });
    await scheduled(w);
    const phone = (await Enquiries.findOne({ _id: a.enquiry.id }).lean())!.phoneE164.replace('+91', '');
    expect(codes(await list(w, w.mgrA, `?search=${a.visit.visitNo}`))).toEqual([a.visit.visitNo]);
    expect(codes(await list(w, w.mgrA, '?search=2')).length).toBe(1);
    expect(codes(await list(w, w.mgrA, `?search=${a.enquiry.enquiryNo}`))).toEqual([a.visit.visitNo]);
    expect(codes(await list(w, w.mgrA, `?search=${encodeURIComponent(a.enquiry.name)}`))).toContain(a.visit.visitNo);
    expect(codes(await list(w, w.mgrA, `?search=${phone}`))).toEqual([a.visit.visitNo]);
    expect(codes(await list(w, w.mgrA, '?search=%5E.*'))).toEqual([]);
  });

  it('filters by status, assignee, dates and the today / upcoming / overdue views, sorts and paginates', async () => {
    const w = await visitWorld(app);
    const a = await scheduled(w, { visit: { scheduledAt: inDays(2) } });
    const b = await scheduled(w, { visit: { scheduledAt: inDays(5), assignedTo: uid(w.salesA2) } });
    await cancelVisitApi(app, w.mgrA, b.visit.id);
    const c = await scheduled(w, { visit: { scheduledAt: new Date(Date.now() + 120_000).toISOString() } });
    await Visits.updateOne({ _id: c.visit.id }, { $set: { scheduledAt: new Date(Date.now() - 3_600_000) } }); // time passed, never closed
    expect(codes(await list(w, w.mgrA, '?status=CANCELLED'))).toEqual([b.visit.visitNo]);
    expect(codes(await list(w, w.mgrA, '?status=SCHEDULED&sort=scheduledAt'))).toEqual([c.visit.visitNo, a.visit.visitNo]);
    expect(codes(await list(w, w.mgrA, '?view=overdue'))).toEqual([c.visit.visitNo]);
    expect(codes(await list(w, w.mgrA, '?view=upcoming&sort=scheduledAt'))).toEqual([a.visit.visitNo]); // cancelled and overdue excluded
    expect(codes(await list(w, w.mgrA, `?assignedTo=${uid(w.salesA2)}`))).toEqual([b.visit.visitNo]);
    expect(codes(await list(w, w.mgrA, `?from=${encodeURIComponent(inDays(1))}&to=${encodeURIComponent(inDays(3))}`))).toEqual([a.visit.visitNo]);
    const p = await list(w, w.mgrA, '?sort=visitNo&limit=2&page=2');
    expect(codes(p)).toEqual([c.visit.visitNo]);
    expect(p.body.meta).toMatchObject({ page: 2, limit: 2, total: 3 });
    expect((await list(w, w.mgrA, '?limit=1000')).status).toBe(400);
    expect((await list(w, w.mgrA, '?view=whenever')).status).toBe(400);
  });

  it('shows status labels from the master (a rename needs no code change)', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    await request(app).patch(api(`/masters/SITEVISIT_STATUS/${(await Masters.findOne({ type: 'SITEVISIT_STATUS', code: 'SCHEDULED' }).lean())!._id}`)).set(w.admin.auth).send({ label: 'Booked in' });
    expect((await getVisitApi(app, w.mgrA, visit.id)).body.data.status.label).toBe('Booked in');
  });
});

describe('archiving', () => {
  it('only closed visits: hidden by default, listed on request, readable, read-only, audited, history kept', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    const del = () => request(app).delete(api(`/sitevisits/${visit.id}`)).set(w.mgrA.auth);
    const open = await del();
    expect(open.status).toBe(409);
    expect(open.body.error.code).toBe('VISIT_OPEN');
    await cancelVisitApi(app, w.mgrA, visit.id);
    await revoke('MANAGER', 'sitevisits.archive');
    expect((await del()).status).toBe(403);
    await grant('MANAGER', 'sitevisits.archive');
    expect((await del()).status).toBe(204);
    expect((await list(w, w.mgrA)).body.meta.total).toBe(0);
    expect(codes(await list(w, w.mgrA, '?isArchived=true'))).toEqual([visit.visitNo]);
    const detail = (await getVisitApi(app, w.mgrA, visit.id)).body.data;
    expect(detail.isArchived).toBe(true);
    expect(detail.allowed).toMatchObject({ edit: false, assign: false, complete: false, cancel: false, archive: false });
    expect((await del()).status).toBe(404);
    expect((await request(app).patch(api(`/sitevisits/${visit.id}`)).set(w.mgrA.auth).send({ notes: 'x' })).status).toBe(404);
    expect(await Visits.countDocuments({ isArchived: true })).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'sitevisit', action: 'archive' })).toBe(1);
    expect(await Activities.countDocuments({ type: 'SITE_VISIT_ARCHIVED' })).toBe(1);
    expect((await request(app).get(api(`/activities?refType=sitevisit&refId=${visit.id}`)).set(w.mgrA.auth)).body.meta.total).toBeGreaterThanOrEqual(3);
  });

  it('a completed visit archives and keeps its follow-up link', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    await completeVisitApi(app, w.mgrA, visit.id);
    expect((await request(app).delete(api(`/sitevisits/${visit.id}`)).set(w.mgrA.auth)).status).toBe(204);
    expect((await getVisitApi(app, w.mgrA, visit.id)).body.data.followUp).toBeTruthy();
    expect(await FollowUps.countDocuments({})).toBe(1);
  });
});

describe('timeline and audit', () => {
  it('visit events appear on the visit, enquiry and unit timelines, each authorised by entity visibility', async () => {
    const w = await visitWorld(app);
    const { visit, enquiry, units } = await scheduled(w);
    await completeVisitApi(app, w.mgrA, visit.id);
    const tl = (who: { auth: Record<string, string> }, type: string, id: string) => request(app).get(api(`/activities?refType=${type}&refId=${id}`)).set(who.auth);
    const onVisit = await tl(w.mgrA, 'sitevisit', visit.id);
    expect(onVisit.body.data.map((a: { type: string }) => a.type).sort()).toEqual(['SITE_VISIT_COMPLETED', 'SITE_VISIT_CREATED']);
    expect((await tl(w.mgrA, 'enquiry', enquiry.id)).body.data.map((a: { type: string }) => a.type)).toEqual(expect.arrayContaining(['SITE_VISIT_CREATED', 'SITE_VISIT_COMPLETED']));
    expect((await tl(w.mgrA, 'unit', units[0]!.id)).body.data.map((a: { type: string }) => a.type)).toEqual(expect.arrayContaining(['SITE_VISIT_CREATED', 'SITE_VISIT_COMPLETED']));
    expect((await tl(w.salesA, 'sitevisit', visit.id)).status).toBe(200); // assigned to them
    expect((await tl(w.salesA2, 'sitevisit', visit.id)).status).toBe(404); // OWN: not theirs
    expect((await tl(w.mgrB, 'sitevisit', visit.id)).status).toBe(404);
    expect((await tl(w.admin, 'sitevisit', visit.id)).status).toBe(200);
  });

  it('audit is readable for audit.view holders and contains the lifecycle', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    await completeVisitApi(app, w.mgrA, visit.id);
    const audit = await request(app).get(api(`/audit?entityType=sitevisit&entityId=${visit.id}`)).set(w.admin.auth);
    expect(audit.status).toBe(200);
    expect(audit.body.data.map((a: { action: string }) => a.action).sort()).toEqual(['complete', 'create']);
    expect((await request(app).get(api(`/audit?entityType=sitevisit&entityId=${visit.id}`)).set(w.mgrA.auth)).status).toBe(403);
  });
});

describe('reminders', () => {
  it('reminds the assignee once when the visit is within the reminder window, however often the job runs', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w, { visit: { scheduledAt: inDays(1) } });
    const soon = new Date(Date.now() + 30 * 60_000);
    await Visits.updateOne({ _id: visit.id }, { $set: { scheduledAt: soon } });
    expect(await remindUpcomingVisits()).toEqual({ reminded: 1 });
    expect(await remindUpcomingVisits()).toEqual({ reminded: 0 });
    const n = await Notifications.find({ eventCode: 'SITE_VISIT_UPCOMING' }).lean();
    expect(n).toHaveLength(1);
    expect(String(n[0]!.userId)).toBe(uid(w.salesA));
    expect(n[0]!.title).toContain('Site visit soon');
  });

  it('concurrent job runs still notify once', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    await Visits.updateOne({ _id: visit.id }, { $set: { scheduledAt: new Date(Date.now() + 20 * 60_000) } });
    const runs = await Promise.all([remindUpcomingVisits(), remindUpcomingVisits(), remindUpcomingVisits()]);
    expect(runs.reduce((a, r) => a + r.reminded, 0)).toBe(1);
    expect(await Notifications.countDocuments({ eventCode: 'SITE_VISIT_UPCOMING' })).toBe(1);
  });

  it('ignores visits outside the window, closed, or archived', async () => {
    const w = await visitWorld(app);
    await scheduled(w); // tomorrow: outside the 60-minute window
    const cancelled = await scheduled(w);
    await cancelVisitApi(app, w.mgrA, cancelled.visit.id);
    await Visits.updateOne({ _id: cancelled.visit.id }, { $set: { scheduledAt: new Date(Date.now() + 10 * 60_000) } });
    const past = await scheduled(w);
    await Visits.updateOne({ _id: past.visit.id }, { $set: { scheduledAt: new Date(Date.now() - 10 * 60_000) } });
    expect(await remindUpcomingVisits()).toEqual({ reminded: 0 });
    expect(await Notifications.countDocuments({ eventCode: 'SITE_VISIT_UPCOMING' })).toBe(0);
  });

  it('rescheduling or reassigning makes the new time / new assignee be reminded', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    await Visits.updateOne({ _id: visit.id }, { $set: { scheduledAt: new Date(Date.now() + 20 * 60_000) } });
    expect((await remindUpcomingVisits()).reminded).toBe(1);
    await assignVisitApi(app, w.mgrA, visit.id, { assignedTo: uid(w.salesA2), reason: 'swap' });
    expect((await remindUpcomingVisits()).reminded).toBe(1); // the new assignee
    expect(await Notifications.countDocuments({ eventCode: 'SITE_VISIT_UPCOMING', userId: w.salesA2.user._id })).toBe(1);
    expect((await remindUpcomingVisits()).reminded).toBe(0);
  });
});

describe('masters, projections and permissions', () => {
  it('SITEVISIT_STATUS is tracked as referenced and (like every status master) never deletable', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    const row = (await Visits.findOne({ _id: visit.id }).lean())!;
    expect(await isMasterReferenced('SITEVISIT_STATUS', row.statusId)).toBe(true);
    const res = await request(app).delete(api(`/masters/SITEVISIT_STATUS/${row.statusId}`)).set(w.admin.auth);
    expect(res.status).toBe(409);
  });

  it('a person rename updates the visit projection (search by the new name)', async () => {
    const w = await visitWorld(app);
    const { visit, enquiry } = await scheduled(w);
    const personId = (await Enquiries.findOne({ _id: enquiry.id }).lean())!.personId;
    await request(app).patch(api(`/persons/${personId}`)).set(w.mgrA.auth).send({ name: 'Renamed Person' });
    expect((await People.findOne({ _id: personId }).lean())!.name).toBe('Renamed Person');
    expect(codes(await list(w, w.mgrA, '?search=Renamed'))).toEqual([visit.visitNo]);
  });

  it('every route is guarded', async () => {
    const w = await visitWorld(app);
    const { visit } = await scheduled(w);
    const none = { Authorization: 'Bearer nope' };
    for (const [m, p] of [['get', '/sitevisits'], ['post', '/sitevisits'], ['get', `/sitevisits/${visit.id}`], ['patch', `/sitevisits/${visit.id}`], ['delete', `/sitevisits/${visit.id}`], ['post', `/sitevisits/${visit.id}/assign`], ['post', `/sitevisits/${visit.id}/complete`], ['post', `/sitevisits/${visit.id}/cancel`]] as const) {
      expect((await request(app)[m](api(p)).set(none)).status, `${m} ${p}`).toBe(401);
    }
    expect(PERMISSION_CATALOG.sitevisits).toEqual(['view', 'create', 'edit', 'archive', 'assign', 'complete', 'cancel', 'export']);
  });
});
