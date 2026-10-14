import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '../../config/env';
import { buildApp } from '../../app';
import { systemRepo } from '../../core/scope/system';
import { recordActivity } from '../../core/activity/activity.service';
import { Activities, AuditLogs, principalWith, seedAll } from '../../test/factories';
import { stageCounts } from './enquiry.service';
import { advance, api, assign, createEnquiryApi, enquiryWorld, grant, inDays, mkEnquiry, person, revoke, transition, type EW } from '../../test/enquiries';
import { useTestDb } from '../../test/db';
import { Enquiry, EnquiryStageHistory } from './enquiry.model';
import { WorkflowStage } from '../workflow/workflow.model';

const app = buildApp();
const Enquiries = systemRepo(Enquiry, 'test', 'fixtures');
const History = systemRepo(EnquiryStageHistory, 'test', 'fixtures');

useTestDb();
beforeEach(seedAll);

const stageOf = async (id: string) => (await Enquiries.findOne({ _id: id }).lean())!.stageCode;
const nos = (res: request.Response) => (res.body.data as { enquiryNo: string }[]).map((e) => e.enquiryNo);
const asId = (u: { user: { _id: Types.ObjectId } }) => u.user._id.toHexString();

describe('stage transitions: forward', () => {
  it('moves to the next configured stage, recording history, audit and activity', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const res = await transition(app, w.mgrA, e.id, { to: 'CONTACTED', from: 'NEW' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ stageCode: 'CONTACTED', stage: { label: 'Contacted' } });
    expect(await History.find({ enquiryId: e.id }).sort({ at: 1 }).lean()).toMatchObject([{ toStage: 'NEW', direction: 'CREATE' }, { fromStage: 'NEW', toStage: 'CONTACTED', direction: 'FORWARD' }]);
    const audit = await AuditLogs.findOne({ entityType: 'enquiry', action: 'transition' }).lean();
    expect(audit!.changes).toMatchObject({ stageCode: { from: 'NEW', to: 'CONTACTED' } });
    expect(String(audit!.userId)).toBe(asId(w.mgrA));
    const act = await Activities.findOne({ type: 'ENQUIRY_STAGE_CHANGED' }).lean();
    expect(act!.description).toBe(`Enquiry ${e.enquiryNo} moved from New to Contacted`);
  });

  it('a Sales Executive moves their own enquiry forward (enquiries.edit)', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.salesA);
    expect((await transition(app, w.salesA, e.id, { to: 'CONTACTED' })).status).toBe(200);
    expect((await transition(app, w.salesA, e.id, { to: 'INTERESTED' })).status).toBe(200);
  });

  it('rejects skipping stages — every non-adjacent jump from NEW', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    for (const to of ['INTERESTED', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_COMPLETED', 'NEGOTIATION', 'BOOKED', 'CONVERTED']) {
      const res = await transition(app, w.mgrA, e.id, { to });
      expect(res.status, to).toBe(409);
      expect(res.body.error.code, to).toBe('STAGE_SKIP');
      expect(res.body.error.details).toEqual({ next: 'CONTACTED' });
    }
    expect(await stageOf(e.id)).toBe('NEW');
    expect(await History.countDocuments({ enquiryId: e.id })).toBe(1);
  });

  it('a malicious direct "status" cannot bypass the workflow on ANY endpoint', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    for (const body of [{ status: 'INTERESTED' }, { stageCode: 'INTERESTED' }, { stage: 'INTERESTED' }, { to: 'INTERESTED', status: 'INTERESTED' }]) {
      expect((await transition(app, w.mgrA, e.id, body)).status, JSON.stringify(body)).toBe(400);
      expect((await request(app).patch(api(`/enquiries/${e.id}`)).set(w.mgrA.auth).send(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await transition(app, w.mgrA, e.id, { to: 'INTERESTED' })).body.error.code).toBe('STAGE_SKIP');
    expect(await stageOf(e.id)).toBe('NEW');
  });

  it('refuses a no-op, an unknown stage, and an enquiry that is not visible or archived', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    expect((await transition(app, w.mgrA, e.id, { to: 'NEW' })).body.error.code).toBe('NO_CHANGE');
    expect((await transition(app, w.mgrA, e.id, { to: 'NOPE' })).body.error.code).toBe('UNKNOWN_STAGE');
    expect((await transition(app, w.mgrA, e.id, {})).status).toBe(400);
    expect((await transition(app, w.mgrB, e.id, { to: 'CONTACTED' })).status).toBe(404);
    await request(app).delete(api(`/enquiries/${e.id}`)).set(w.mgrA.auth);
    expect((await transition(app, w.mgrA, e.id, { to: 'CONTACTED' })).status).toBe(404);
  });

  it('forward movement needs enquiries.edit', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    await revoke('MANAGER', 'enquiries.edit');
    expect((await transition(app, w.mgrA, e.id, { to: 'CONTACTED' })).status).toBe(403);
    expect((await request(app).post(api(`/enquiries/${e.id}/transition`)).send({ to: 'CONTACTED' })).status).toBe(401);
    expect(await stageOf(e.id)).toBe('NEW');
  });

  it('a stale screen is told so (409 STAGE_CHANGED) instead of overwriting someone else\'s move', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    await transition(app, w.mgrA, e.id, { to: 'CONTACTED' });
    const stale = await transition(app, w.mgrA, e.id, { to: 'CONTACTED', from: 'NEW' });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'STAGE_CHANGED', details: { current: 'CONTACTED' } });
  });
});

describe('stage transitions: domain-owned stages', () => {
  it('a domain operation may skip stages, so a walk-in can be scheduled without inventing progress', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.salesA); // still at NEW
    // Scheduling a visit is a real activity, not a claim that "Contacted" and "Interested" happened.
    const visit = await request(app).post(api('/sitevisits')).set(w.salesA.auth)
      .send({ enquiryId: e.id, scheduledAt: inDays(1), unitIds: [] });
    expect(visit.status).toBe(201);
    expect(await stageOf(e.id)).toBe('SITE_VISIT_SCHEDULED');
    // The jump is still fully recorded, so the history shows what really happened rather than the
    // intermediate stages that did not.
    const history = await History.find({ enquiryId: e.id }).sort({ at: 1 }).lean();
    expect(history.map((h) => h.toStage)).toEqual(['NEW', 'SITE_VISIT_SCHEDULED']);
    expect(history.at(-1)!.reason).toBe('Site visit scheduled');
    // And it is audited like any other move.
    expect(await AuditLogs.findOne({ entityType: 'enquiry', action: 'transition' }).lean()).toMatchObject({ changes: { stageCode: { from: 'NEW', to: 'SITE_VISIT_SCHEDULED' } } });
  });

  it('a manual move still may not skip stages, even when the target is reachable by an action', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.salesA);
    // The walk-in exemption belongs to the action, not to the stage: doing it by hand is still a skip.
    expect((await transition(app, w.salesA, e.id, { to: 'SITE_VISIT_COMPLETED' })).body.error.code).toBe('STAGE_SKIP');
    expect(await stageOf(e.id)).toBe('NEW');
  });

  it('cannot be entered through the generic transition, with a clear domain-rule error', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    await advance(app, w.mgrA, e.id, 'CONTACTED', 'INTERESTED');
    const res = await transition(app, w.mgrA, e.id, { to: 'SITE_VISIT_SCHEDULED' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'DOMAIN_ONLY', details: { domainOperation: 'sitevisit.schedule' } });
    expect(res.body.error.message).toMatch(/can only be entered through its own action/);
    expect(await stageOf(e.id)).toBe('INTERESTED');
  });

  it.each([['SITE_VISIT_COMPLETED', 'SITE_VISIT_SCHEDULED', 'sitevisit.complete'], ['BOOKED', 'NEGOTIATION', 'booking.create'], ['CONVERTED', 'BOOKED', 'enquiry.convert']])('%s is domain-only (even with every permission)', async (to, from, op) => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    await Enquiries.updateOne({ _id: e.id }, { stageCode: from }); // set up the preceding stage directly (a later phase's operations will do this)
    const res = await transition(app, w.admin, e.id, { to });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'DOMAIN_ONLY', details: { domainOperation: op } });
    expect(await stageOf(e.id)).toBe(from);
  });

  it('the transition metadata flags them so the UI opens the right dialog instead of moving the card', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    await advance(app, w.mgrA, e.id, 'CONTACTED', 'INTERESTED');
    const t = (await request(app).get(api('/workflow/transitions?from=INTERESTED')).set(w.mgrA.auth)).body.data;
    expect(t.find((x: { to: string }) => x.to === 'SITE_VISIT_SCHEDULED')).toMatchObject({ direction: 'FORWARD', domainOperation: 'sitevisit.schedule' });
  });
});

describe('stage transitions: backward', () => {
  it('needs enquiries.revert AND a reason; both are recorded', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.salesA);
    await advance(app, w.salesA, e.id, 'CONTACTED', 'INTERESTED');
    expect((await transition(app, w.salesA, e.id, { to: 'CONTACTED', reason: 'oops' })).status).toBe(403); // Sales has no revert
    // a manager's view of the same enquiry
    const mine = await mkEnquiry(app, w.mgrA);
    await advance(app, w.mgrA, mine.id, 'CONTACTED', 'INTERESTED');
    for (const reason of [undefined, '', '   ']) {
      const res = await transition(app, w.mgrA, mine.id, { to: 'CONTACTED', reason });
      expect(res.status).toBe(400);
      expect(res.body.error.details[0].path).toBe('reason');
    }
    expect((await transition(app, w.mgrA, mine.id, { to: 'CONTACTED', reason: 'x'.repeat(501) })).status).toBe(400);
    const ok = await transition(app, w.mgrA, mine.id, { to: 'NEW', reason: '  Wrong customer record  ' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.stageCode).toBe('NEW');
    expect(await History.findOne({ enquiryId: mine.id, direction: 'BACKWARD' }).lean()).toMatchObject({ fromStage: 'INTERESTED', toStage: 'NEW', reason: 'Wrong customer record' });
    const audit = await AuditLogs.findOne({ entityType: 'enquiry', action: 'revert' }).lean();
    expect(audit).toMatchObject({ reason: 'Wrong customer record' });
    expect(audit!.changes).toMatchObject({ stageCode: { from: 'INTERESTED', to: 'NEW' } });
    expect(await Activities.countDocuments({ type: 'ENQUIRY_STAGE_CHANGED' })).toBe(5); // 2 + 2 forward moves and the revert
    expect(await stageOf(e.id)).toBe('INTERESTED'); // the failed attempts changed nothing
  });
});

describe('LOST', () => {
  const lose = (who: { auth: Record<string, string> }, id: string, body: Record<string, unknown>) => request(app).post(api(`/enquiries/${id}/lose`)).set(who.auth).send(body);

  it('needs enquiries.lose and an ACTIVE Lost Reason; records the reason everywhere', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.salesA);
    expect((await lose(w.salesA, e.id, {})).status).toBe(400);
    const res = await lose(w.salesA, e.id, { lostReasonId: w.m.lost, note: 'Bought elsewhere' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ stageCode: 'LOST', lostReason: { label: 'Budget too low' } });
    expect(await History.findOne({ enquiryId: e.id, direction: 'LOST' }).lean()).toMatchObject({ fromStage: 'NEW', toStage: 'LOST', reason: 'Bought elsewhere' });
    expect((await AuditLogs.findOne({ entityType: 'enquiry', action: 'lost' }).lean())!.reason).toBe('Bought elsewhere');
    expect((await Activities.findOne({ type: 'ENQUIRY_LOST' }).lean())!.description).toContain('Budget too low');
  });

  it('without a note the chosen lost reason is the reason', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    await lose(w.mgrA, e.id, { lostReasonId: w.m.lost });
    expect((await History.findOne({ enquiryId: e.id, direction: 'LOST' }).lean())!.reason).toBe('Budget too low');
  });

  it('rejects inactive, unknown and wrong-type lost reasons; the permission is checked first', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    await request(app).patch(api(`/masters/LOST_REASON/${w.m.lost}`)).set(w.admin.auth).send({ isActive: false });
    for (const lostReasonId of [w.m.lost, new Types.ObjectId().toHexString(), w.m.source]) expect((await lose(w.mgrA, e.id, { lostReasonId })).status, lostReasonId).toBe(400);
    await revoke('MANAGER', 'enquiries.lose');
    expect((await lose(w.mgrA, e.id, { lostReasonId: w.m.lost })).status).toBe(403);
    expect(await stageOf(e.id)).toBe('NEW');
  });

  it('works through the generic endpoint too (same rules), and a lost reason is refused for any other move', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    expect((await transition(app, w.mgrA, e.id, { to: 'LOST' })).status).toBe(400);
    expect((await transition(app, w.mgrA, e.id, { to: 'CONTACTED', lostReasonId: w.m.lost })).status).toBe(400);
    expect((await transition(app, w.mgrA, e.id, { to: 'LOST', lostReasonId: w.m.lost })).body.data.stageCode).toBe('LOST');
  });

  it('a lost enquiry cannot be lost again, and a converted one cannot be lost at all', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    await lose(w.mgrA, e.id, { lostReasonId: w.m.lost });
    expect((await lose(w.mgrA, e.id, { lostReasonId: w.m.lost })).body.error.code).toBe('NO_CHANGE');
    const c = await mkEnquiry(app, w.mgrA);
    await Enquiries.updateOne({ _id: c.id }, { stageCode: 'CONVERTED' });
    expect((await lose(w.mgrA, c.id, { lostReasonId: w.m.lost })).body.error.code).toBe('TERMINAL_STAGE');
  });
});

describe('REOPEN', () => {
  const reopen = (who: { auth: Record<string, string> }, id: string, body: Record<string, unknown>) => request(app).post(api(`/enquiries/${id}/reopen`)).set(who.auth).send(body);
  async function lostEnquiry(w: EW) {
    const e = await mkEnquiry(app, w.salesA);
    await request(app).post(api(`/enquiries/${e.id}/lose`)).set(w.salesA.auth).send({ lostReasonId: w.m.lost });
    return e;
  }

  it('needs enquiries.reopen and a reason, returns to a stage a person may enter, and clears the lost reason', async () => {
    const w = await enquiryWorld(app);
    const e = await lostEnquiry(w);
    expect((await reopen(w.salesA, e.id, { to: 'NEW', reason: 'back' })).status).toBe(403); // Sales has no reopen
    await grant('MANAGER', 'enquiries.view');
    for (const reason of ['', '  ']) expect((await reopen(w.mgrA, e.id, { to: 'NEW', reason })).status).toBe(400);
    expect((await reopen(w.mgrA, e.id, { to: 'NEW' })).status).toBe(400);
    const ok = await reopen(w.mgrA, e.id, { to: 'CONTACTED', reason: 'Customer called back' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ stageCode: 'CONTACTED' });
    expect(ok.body.data.lostReason).toBeUndefined();
    expect((await Enquiries.findOne({ _id: e.id }).lean())!.lostReasonId).toBeUndefined();
    expect(await History.findOne({ enquiryId: e.id, direction: 'REOPEN' }).lean()).toMatchObject({ fromStage: 'LOST', toStage: 'CONTACTED', reason: 'Customer called back' });
    expect(await AuditLogs.countDocuments({ entityType: 'enquiry', action: 'reopen' })).toBe(1);
    expect(await Activities.countDocuments({ type: 'ENQUIRY_REOPENED' })).toBe(1);
    // the lost reason survives in history
    const detail = (await request(app).get(api(`/enquiries/${e.id}`)).set(w.mgrA.auth)).body.data;
    expect(detail.stageHistory.find((h: { direction: string }) => h.direction === 'LOST').lostReason.label).toBe('Budget too low');
  });

  it('cannot reopen into an invalid stage (domain-owned or unknown), or reopen something that is not lost', async () => {
    const w = await enquiryWorld(app);
    const e = await lostEnquiry(w);
    for (const to of ['BOOKED', 'CONVERTED', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_COMPLETED']) {
      const res = await reopen(w.mgrA, e.id, { to, reason: 'trying' });
      expect(res.status, to).toBe(409);
      expect(res.body.error.code, to).toBe('REOPEN_TARGET');
    }
    expect((await reopen(w.mgrA, e.id, { to: 'NOPE', reason: 'x' })).body.error.code).toBe('UNKNOWN_STAGE');
    expect((await reopen(w.mgrA, e.id, { to: 'LOST', reason: 'x' })).body.error.code).toBe('REOPEN_TARGET');
    expect(await stageOf(e.id)).toBe('LOST');
    const open = await mkEnquiry(app, w.mgrA);
    expect((await reopen(w.mgrA, open.id, { to: 'CONTACTED', reason: 'x' })).body.error.code).toBe('WRONG_OPERATION');
  });
});

describe('configurable workflow is honoured', () => {
  it('a custom stage inserted by an admin becomes a required step; deactivating it removes it', async () => {
    const w = await enquiryWorld(app);
    const created = await request(app).post(api('/workflow/stages')).set(w.admin.auth).send({ label: 'Qualified', afterSystemKey: 'NEW' });
    const e = await mkEnquiry(app, w.mgrA);
    expect((await transition(app, w.mgrA, e.id, { to: 'CONTACTED' })).body.error).toMatchObject({ code: 'STAGE_SKIP', details: { next: 'CUSTOM_QUALIFIED' } });
    expect((await transition(app, w.mgrA, e.id, { to: 'CUSTOM_QUALIFIED' })).body.data.stage.label).toBe('Qualified');
    await request(app).patch(api(`/workflow/stages/${created.body.data._id}`)).set(w.admin.auth).send({ isActive: false });
    expect((await transition(app, w.mgrA, e.id, { to: 'CONTACTED' })).status).toBe(200); // an enquiry sitting in a deactivated stage can move on
  });

  it('renaming a stage changes what people see, never what the code does', async () => {
    const w = await enquiryWorld(app);
    const stage = await WorkflowStage.findOne({ systemKey: 'CONTACTED' }).lean();
    await request(app).patch(api(`/workflow/stages/${stage!._id}`)).set(w.admin.auth).send({ label: 'Reached out' });
    const e = await mkEnquiry(app, w.mgrA);
    const res = await transition(app, w.mgrA, e.id, { to: 'CONTACTED' });
    expect(res.body.data).toMatchObject({ stageCode: 'CONTACTED', stage: { label: 'Reached out' } });
  });
});

describe('concurrency: simultaneous changes cannot bypass the rules', () => {
  it('six identical forward moves: exactly one succeeds, the rest are clean conflicts', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const results = await Promise.all(Array.from({ length: 6 }, () => transition(app, w.mgrA, e.id, { to: 'CONTACTED' })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 200).every((r) => r.status === 409 && ['STAGE_CHANGED', 'NO_CHANGE'].includes(r.body.error.code))).toBe(true);
    expect(await History.countDocuments({ enquiryId: e.id })).toBe(2);
    expect(await AuditLogs.countDocuments({ entityType: 'enquiry', action: 'transition' })).toBe(1);
  });

  it('racing a valid move against skipping moves can never skip', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const results = await Promise.all([
      transition(app, w.mgrA, e.id, { to: 'CONTACTED' }),
      transition(app, w.mgrA, e.id, { to: 'INTERESTED' }),
      transition(app, w.mgrA, e.id, { to: 'NEGOTIATION' }),
      transition(app, w.mgrA, e.id, { to: 'INTERESTED' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
    expect(await stageOf(e.id)).toBe('CONTACTED');
  });

  it('a lost-marking racing a forward move: one wins, history stays consistent', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const [a, b] = await Promise.all([transition(app, w.mgrA, e.id, { to: 'CONTACTED' }), transition(app, w.mgrA, e.id, { to: 'LOST', lostReasonId: w.m.lost })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const rows = await History.find({ enquiryId: e.id }).sort({ at: 1 }).lean();
    expect(rows).toHaveLength(2);
    expect(rows[1]!.toStage).toBe(await stageOf(e.id));
  });
});

describe('transition metadata for the UI', () => {
  it('the detail view carries what the caller may do next, from the same rules the API enforces', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.salesA);
    await advance(app, w.salesA, e.id, 'CONTACTED');
    const sales = (await request(app).get(api(`/enquiries/${e.id}`)).set(w.salesA.auth)).body.data.transitions;
    expect(sales.map((t: { direction: string; to: string }) => `${t.direction}:${t.to}`)).toEqual(['FORWARD:INTERESTED', 'LOST:LOST']);
    const mgr = (await request(app).get(api(`/enquiries/${e.id}`)).set(w.mgrA.auth)).body.data;
    expect(mgr).toBeTruthy();
    expect(await request(app).get(api(`/workflow/transitions?from=CONTACTED`)).set(w.mgrA.auth).then((r) => r.body.data.map((t: { direction: string }) => t.direction))).toEqual(['FORWARD', 'BACKWARD', 'LOST']);
  });
});

describe('listing, search and filters (server-side)', () => {
  async function seed(w: EW) {
    const a = await mkEnquiry(app, w.mgrA, { sourceId: w.m.source, propertyTypeId: w.m.property, locationId: w.m.locA, assignedTo: asId(w.salesA) }, { name: 'Anand Kumar', phone: '9811111111' });
    const b = await mkEnquiry(app, w.mgrA, { sourceId: w.m.source2, typeId: w.m.type, buildingTypeId: w.m.building }, { name: 'Bhavna Rao', phone: '9822222222' });
    const c = await mkEnquiry(app, w.mgrA, { sourceId: w.m.source2, assignedTo: asId(w.salesA2) }, { name: 'anand Raj', phone: '9833333333' });
    await advance(app, w.mgrA, c.id, 'CONTACTED', 'INTERESTED');
    const other = await mkEnquiry(app, w.mgrB, {}, { name: 'Anand In B', phone: '9844444444' });
    return { a, b, c, other };
  }

  it('paginates with totals, caps the page size, and sorts', async () => {
    const w = await enquiryWorld(app);
    await seed(w);
    const p1 = await request(app).get(api('/enquiries?limit=2&page=1&sort=personName')).set(w.mgrA.auth);
    expect(p1.body.data.map((e: { name: string }) => e.name)).toEqual(['Anand Kumar', 'anand Raj']);
    expect(p1.body.meta).toEqual({ page: 1, limit: 2, total: 3 });
    expect((await request(app).get(api('/enquiries?limit=2&page=2&sort=personName')).set(w.mgrA.auth)).body.data).toHaveLength(1);
    expect(nos(await request(app).get(api('/enquiries?sort=enquiryNo')).set(w.mgrA.auth))).toEqual(['ENQ-000001', 'ENQ-000002', 'ENQ-000003']);
    expect(nos(await request(app).get(api('/enquiries')).set(w.mgrA.auth))).toEqual(['ENQ-000003', 'ENQ-000002', 'ENQ-000001']); // newest first by default
    for (const bad of ['limit=101', 'page=0', 'sort=-passwordHash']) expect([200, 400]).toContain((await request(app).get(api(`/enquiries?${bad}`)).set(w.mgrA.auth)).status);
    expect((await request(app).get(api('/enquiries?limit=101')).set(w.mgrA.auth)).status).toBe(400);
  });

  it('searches by enquiry ID (full, partial number), person name, and phone in any notation', async () => {
    const w = await enquiryWorld(app);
    const s = await seed(w);
    const q = async (search: string) => nos(await request(app).get(api(`/enquiries?search=${encodeURIComponent(search)}&sort=enquiryNo`)).set(w.mgrA.auth));
    expect(await q('ENQ-000002')).toEqual([s.b.enquiryNo]);
    expect(await q('enq-00000')).toEqual(['ENQ-000001', 'ENQ-000002', 'ENQ-000003']);
    expect(await q('2')).toEqual([s.b.enquiryNo]);
    expect(await q('000003')).toEqual([s.c.enquiryNo]);
    expect(await q('ANAND')).toEqual([s.a.enquiryNo, s.c.enquiryNo]);
    expect(await q('rao')).toEqual([s.b.enquiryNo]);
    for (const phone of ['9822222222', '98222 22222', '+91 98222 22222', '098222-22222', '82222']) expect(await q(phone), phone).toEqual([s.b.enquiryNo]);
    expect(await q('nobody')).toEqual([]);
  });

  it('treats search text literally (regex characters cannot break or widen the query)', async () => {
    const w = await enquiryWorld(app);
    await seed(w);
    for (const t of ['.*', '(', '[a-z]+', '\\', 'a|b', '^', '$']) {
      const res = await request(app).get(api(`/enquiries?search=${encodeURIComponent(t)}`)).set(w.mgrA.auth);
      expect(res.status, t).toBe(200);
      expect(res.body.data, t).toEqual([]);
    }
  });

  it('filters by stage (one or several), each master, assignee (incl. unassigned), person and date range', async () => {
    const w = await enquiryWorld(app);
    const s = await seed(w);
    const q = async (qs: string) => nos(await request(app).get(api(`/enquiries?${qs}&sort=enquiryNo`)).set(w.mgrA.auth));
    expect(await q('stage=NEW')).toEqual([s.a.enquiryNo, s.b.enquiryNo]);
    expect(await q('stage=INTERESTED,CONTACTED')).toEqual([s.c.enquiryNo]);
    expect(await q(`sourceId=${w.m.source}`)).toEqual([s.a.enquiryNo]);
    expect(await q(`typeId=${w.m.type}`)).toEqual([s.b.enquiryNo]);
    expect(await q(`propertyTypeId=${w.m.property}`)).toEqual([s.a.enquiryNo]);
    expect(await q(`buildingTypeId=${w.m.building}`)).toEqual([s.b.enquiryNo]);
    expect(await q(`locationId=${w.m.locA}`)).toEqual([s.a.enquiryNo]);
    expect(await q(`assignedTo=${asId(w.salesA)}`)).toEqual([s.a.enquiryNo]);
    expect(await q('assignedTo=unassigned')).toEqual([s.b.enquiryNo]);
    expect(await q(`personId=${s.c.personId}`)).toEqual([s.c.enquiryNo]);
    expect(await q('from=2999-01-01')).toEqual([]);
    expect(await q('to=2999-01-01')).toHaveLength(3);
    expect(await q('stage=NOPE')).toEqual([]);
    for (const bad of ['sourceId=x', 'from=notadate', 'stage=', 'assignedTo=someone']) expect((await request(app).get(api(`/enquiries?${bad}`)).set(w.mgrA.auth)).status, bad).toBe(400);
  });

  it('renders the columns the list screen needs', async () => {
    const w = await enquiryWorld(app);
    await seed(w);
    const row = (await request(app).get(api('/enquiries?search=ENQ-000001')).set(w.mgrA.auth)).body.data[0];
    expect(row).toMatchObject({ enquiryNo: 'ENQ-000001', name: 'Anand Kumar', phone: '+91 98111 11111', source: { label: 'Website' }, propertyType: { label: 'Villa' }, location: { label: 'Anna Nagar' }, assignedToName: 'SALES_EXECUTIVE', stage: { label: 'New' } });
    expect(row.createdAt).toBeTruthy();
  });
});

describe('kanban board', () => {
  it('returns one column per configured stage with counts and a page of cards, ordered by the workflow', async () => {
    const w = await enquiryWorld(app);
    const a = await mkEnquiry(app, w.mgrA);
    const b = await mkEnquiry(app, w.mgrA);
    await mkEnquiry(app, w.mgrA);
    await advance(app, w.mgrA, b.id, 'CONTACTED');
    await request(app).post(api(`/enquiries/${a.id}/lose`)).set(w.mgrA.auth).send({ lostReasonId: w.m.lost });
    const res = await request(app).get(api('/enquiries/board')).set(w.mgrA.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.stages.map((s: { systemKey: string }) => s.systemKey)).toEqual(['NEW', 'CONTACTED', 'INTERESTED', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_COMPLETED', 'NEGOTIATION', 'BOOKED', 'CONVERTED', 'LOST']);
    const by = Object.fromEntries(res.body.data.stages.map((s: { systemKey: string; count: number }) => [s.systemKey, s.count]));
    expect(by).toMatchObject({ NEW: 1, CONTACTED: 1, LOST: 1, INTERESTED: 0 });
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.stages[0]).toMatchObject({ label: 'New', kind: 'FLOW' });
    expect(res.body.data.stages[0].cards[0]).toMatchObject({ stageCode: 'NEW' });
  });

  it('limits cards per stage but reports the true count, and honours filters', async () => {
    const w = await enquiryWorld(app);
    for (let i = 0; i < 5; i++) await mkEnquiry(app, w.mgrA, { sourceId: i < 2 ? w.m.source : w.m.source2 });
    const res = await request(app).get(api('/enquiries/board?perStage=2')).set(w.mgrA.auth);
    const col = res.body.data.stages[0];
    expect(col.count).toBe(5);
    expect(col.cards).toHaveLength(2);
    const filtered = await request(app).get(api(`/enquiries/board?sourceId=${w.m.source}`)).set(w.mgrA.auth);
    expect(filtered.body.data.stages[0].count).toBe(2);
    expect((await request(app).get(api('/enquiries/board?perStage=51')).set(w.mgrA.auth)).status).toBe(400);
  });

  it('is scoped: branch managers see their branch, Sales Executives only their own, ALL scope everything', async () => {
    const w = await enquiryWorld(app);
    await mkEnquiry(app, w.mgrA);
    await mkEnquiry(app, w.salesA);
    await mkEnquiry(app, w.mgrB);
    const total = async (who: { auth: Record<string, string> }, qs = '') => (await request(app).get(api(`/enquiries/board${qs}`)).set(who.auth)).body.data.total;
    expect(await total(w.mgrA)).toBe(2);
    expect(await total(w.salesA)).toBe(1);
    expect(await total(w.admin)).toBe(3);
    expect(await total(w.admin, `?branchId=${w.B}`)).toBe(1);
    expect((await request(app).get(api(`/enquiries/board?branchId=${w.B}`)).set(w.mgrA.auth)).status).toBe(403);
  });

  it('shows columns for custom stages, and keeps a deactivated stage visible while it still holds enquiries', async () => {
    const w = await enquiryWorld(app);
    const created = await request(app).post(api('/workflow/stages')).set(w.admin.auth).send({ label: 'Qualified', afterSystemKey: 'NEW' });
    const e = await mkEnquiry(app, w.mgrA);
    await advance(app, w.mgrA, e.id, 'CUSTOM_QUALIFIED');
    let keys = (await request(app).get(api('/enquiries/board')).set(w.mgrA.auth)).body.data.stages.map((s: { systemKey: string }) => s.systemKey);
    expect(keys.slice(0, 3)).toEqual(['NEW', 'CUSTOM_QUALIFIED', 'CONTACTED']);
    await request(app).patch(api(`/workflow/stages/${created.body.data._id}`)).set(w.admin.auth).send({ isActive: false });
    keys = (await request(app).get(api('/enquiries/board')).set(w.mgrA.auth)).body.data.stages.map((s: { systemKey: string }) => s.systemKey);
    expect(keys).toContain('CUSTOM_QUALIFIED'); // holds one enquiry
    await advance(app, w.mgrA, e.id, 'CONTACTED');
    keys = (await request(app).get(api('/enquiries/board')).set(w.mgrA.auth)).body.data.stages.map((s: { systemKey: string }) => s.systemKey);
    expect(keys).not.toContain('CUSTOM_QUALIFIED');
  });
});

describe('security: scope cannot be widened', () => {
  it('OWN scope sees only its own enquiries — list, detail, board, transition, assign, timeline', async () => {
    const w = await enquiryWorld(app);
    const mine = await mkEnquiry(app, w.salesA);
    const theirs = await mkEnquiry(app, w.salesA2);
    const unassigned = await mkEnquiry(app, w.mgrA);
    expect(nos(await request(app).get(api('/enquiries')).set(w.salesA.auth))).toEqual([mine.enquiryNo]);
    for (const id of [theirs.id, unassigned.id]) {
      expect((await request(app).get(api(`/enquiries/${id}`)).set(w.salesA.auth)).status).toBe(404);
      expect((await transition(app, w.salesA, id, { to: 'CONTACTED' })).status).toBe(404);
      expect((await request(app).patch(api(`/enquiries/${id}`)).set(w.salesA.auth).send({ notes: 'HACKED' })).status).toBe(404);
      expect((await request(app).get(api(`/activities?refType=enquiry&refId=${id}`)).set(w.salesA.auth)).status).toBe(404);
    }
    await grant('SALES_EXECUTIVE', 'enquiries.assign');
    expect((await assign(app, w.salesA, theirs.id, { assignedTo: asId(w.salesA), reason: 'take it' })).status).toBe(404);
    expect((await Enquiries.findOne({ _id: theirs.id }).lean())).toMatchObject({ stageCode: 'NEW' });
    expect((await Enquiries.findOne({ _id: theirs.id }).lean())!.notes).toBeUndefined();
  });

  it('filters cannot widen: another branch, other people\'s assignment, other branches\' persons and ids', async () => {
    const w = await enquiryWorld(app);
    const a = await mkEnquiry(app, w.salesA);
    const b = await mkEnquiry(app, w.mgrB);
    await mkEnquiry(app, w.salesA2);
    expect((await request(app).get(api(`/enquiries?branchId=${w.B}`)).set(w.mgrA.auth)).status).toBe(403);
    expect((await request(app).get(api(`/enquiries?branchId=${w.B}`)).set(w.salesA.auth)).status).toBe(403);
    expect(nos(await request(app).get(api(`/enquiries?assignedTo=${asId(w.salesA2)}`)).set(w.salesA.auth))).toEqual([]); // OWN: AND-ed with the scope
    expect(nos(await request(app).get(api(`/enquiries?assignedTo=${asId(w.salesB)}`)).set(w.mgrA.auth))).toEqual([]);
    expect(nos(await request(app).get(api(`/enquiries?personId=${b.personId}`)).set(w.mgrA.auth))).toEqual([]);
    expect(nos(await request(app).get(api(`/enquiries?search=${encodeURIComponent(b.enquiryNo)}`)).set(w.mgrA.auth))).toEqual([]);
    expect(nos(await request(app).get(api(`/enquiries?stage=NEW,CONTACTED&isArchived=false`)).set(w.salesA.auth))).toEqual([a.enquiryNo]);
    // query-string operator injection is never a query: it is rejected or ignored, and the scope still applies
    for (const qs of ['search[$ne]=x', 'assignedTo[$ne]=x', 'stage[$ne]=NEW', 'branchId[$ne]=x', 'sourceId[$gt]=', 'search=%7B%22%24ne%22%3A1%7D']) {
      const res = await request(app).get(api(`/enquiries?${qs}`)).set(w.mgrA.auth);
      expect([200, 400], qs).toContain(res.status);
      if (res.status === 200) expect(nos(res), qs).not.toContain(b.enquiryNo);
    }
  });

  it('another branch gets the same 404 as a made-up id for read, update, assign, transition, archive and timeline', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const ghost = new Types.ObjectId().toHexString();
    await grant('MANAGER', 'enquiries.assign');
    const attempts = [
      (id: string) => request(app).get(api(`/enquiries/${id}`)).set(w.mgrB.auth),
      (id: string) => request(app).patch(api(`/enquiries/${id}`)).set(w.mgrB.auth).send({ notes: 'x' }),
      (id: string) => assign(app, w.mgrB, id, { assignedTo: asId(w.salesB) }),
      (id: string) => transition(app, w.mgrB, id, { to: 'CONTACTED' }),
      (id: string) => request(app).delete(api(`/enquiries/${id}`)).set(w.mgrB.auth),
      (id: string) => request(app).get(api(`/activities?refType=enquiry&refId=${id}`)).set(w.mgrB.auth),
    ];
    for (const attempt of attempts) {
      const real = await attempt(e.id);
      const fake = await attempt(ghost);
      expect(real.status).toBe(404);
      expect(real.body.error).toEqual(fake.body.error);
    }
    expect(await Enquiries.findOne({ _id: e.id }).lean()).toMatchObject({ stageCode: 'NEW', isArchived: false });
  });

  it('a person link does not leak the other branch\'s enquiries', async () => {
    const w = await enquiryWorld(app);
    const a = await mkEnquiry(app, w.mgrA, { notes: 'A-only' }, { name: 'Raj', phone: '9876543210' });
    await request(app).post(api('/persons/link')).set(w.mgrB.auth).send({ phone: '9876543210', reason: 'Relocated' });
    const b = await createEnquiryApi(app, w.mgrB, { personId: a.personId });
    expect(b.status).toBe(201);
    const list = await request(app).get(api(`/enquiries?personId=${a.personId}`)).set(w.mgrB.auth);
    expect(nos(list)).toEqual([b.body.data.enquiryNo]);
    expect(JSON.stringify(list.body)).not.toMatch(/A-only/);
  });
});

describe('timeline', () => {
  const timeline = (who: { auth: Record<string, string> }, id: string) => request(app).get(api(`/activities?refType=enquiry&refId=${id}`)).set(who.auth);

  it('shows the enquiry\'s events to anyone who can see the enquiry', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    await advance(app, w.mgrA, e.id, 'CONTACTED');
    await assign(app, w.mgrA, e.id, { assignedTo: asId(w.salesA) });
    await request(app).patch(api(`/enquiries/${e.id}`)).set(w.mgrA.auth).send({ notes: 'n' });
    await request(app).post(api(`/enquiries/${e.id}/lose`)).set(w.mgrA.auth).send({ lostReasonId: w.m.lost });
    await request(app).post(api(`/enquiries/${e.id}/reopen`)).set(w.mgrA.auth).send({ to: 'NEW', reason: 'again' });
    const types = (await timeline(w.mgrA, e.id)).body.data.map((a: { type: string }) => a.type).sort();
    expect(types).toEqual(['ENQUIRY_ASSIGNED', 'ENQUIRY_CREATED', 'ENQUIRY_LOST', 'ENQUIRY_REOPENED', 'ENQUIRY_STAGE_CHANGED', 'ENQUIRY_UPDATED']);
    expect((await timeline(w.salesA, e.id)).status).toBe(200); // assigned to them now
    expect((await timeline(w.admin, e.id)).body.data).toHaveLength(6);
  });

  it('is denied (same 404) to other branches and to OWN users it is not assigned to; needs activities.view', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    const ghost = await timeline(w.mgrB, new Types.ObjectId().toHexString());
    for (const who of [w.mgrB, w.salesB, w.salesA]) {
      const res = await timeline(who, e.id);
      expect(res.status).toBe(404);
      expect(res.body.error).toEqual(ghost.body.error);
    }
    await revoke('MANAGER', 'activities.view');
    expect((await timeline(w.mgrA, e.id)).status).toBe(403);
  });

  it('events recorded in another branch never show on this timeline', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    await recordActivity({ type: 'ENQUIRY_UPDATED', description: 'event in branch B', branchId: w.B, refs: [{ type: 'enquiry', id: e.id }] });
    expect((await timeline(w.mgrA, e.id)).body.data.map((a: { description: string }) => a.description)).not.toContain('event in branch B');
  });
});

describe('audit', () => {
  it('records the whole lifecycle with who, what, previous/new values and reasons — and is readable per enquiry by authorized admins', async () => {
    const w = await enquiryWorld(app);
    const e = await mkEnquiry(app, w.mgrA);
    await advance(app, w.mgrA, e.id, 'CONTACTED', 'INTERESTED');
    await transition(app, w.mgrA, e.id, { to: 'CONTACTED', reason: 'Went back to shortlisting' });
    await assign(app, w.mgrA, e.id, { assignedTo: asId(w.salesA) });
    await request(app).post(api(`/enquiries/${e.id}/lose`)).set(w.mgrA.auth).send({ lostReasonId: w.m.lost, note: 'No budget' });
    await request(app).post(api(`/enquiries/${e.id}/reopen`)).set(w.mgrA.auth).send({ to: 'NEW', reason: 'Back again' });
    await request(app).delete(api(`/enquiries/${e.id}`)).set(w.mgrA.auth);
    const res = await request(app).get(api(`/audit?entityType=enquiry&entityId=${e.id}&limit=50`)).set(w.admin.auth);
    expect(res.body.data.map((a: { action: string }) => a.action).reverse()).toEqual(['create', 'transition', 'transition', 'revert', 'assign', 'lost', 'reopen', 'archive']);
    const revert = res.body.data.find((a: { action: string }) => a.action === 'revert');
    expect(revert).toMatchObject({ reason: 'Went back to shortlisting', userId: asId(w.mgrA), branchId: w.A });
    expect(revert.changes.stageCode).toEqual({ from: 'INTERESTED', to: 'CONTACTED' });
    // managers do not have audit.view by default; another branch's admin-level reader would not see A's entries
    expect((await request(app).get(api(`/audit?entityType=enquiry&entityId=${e.id}`)).set(w.mgrA.auth)).status).toBe(403);
  });
});

describe('export', () => {
  const csv = (who: { auth: Record<string, string> }, qs = '') => request(app).get(api(`/enquiries/export.csv${qs}`)).set(who.auth).buffer(true).parse((res, cb) => { let d = ''; res.setEncoding('utf8'); res.on('data', (c) => (d += c)); res.on('end', () => cb(null, d)); });

  it('needs enquiries.export (Manager yes, Sales Executive no)', async () => {
    const w = await enquiryWorld(app);
    await mkEnquiry(app, w.mgrA);
    expect((await request(app).get(api('/enquiries/export.csv'))).status).toBe(401);
    expect((await csv(w.salesA)).status).toBe(403);
    const ok = await csv(w.mgrA);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toMatch(/text\/csv/);
    expect(ok.headers['content-disposition']).toMatch(/attachment/);
  });

  it('exports exactly the caller\'s filtered, scoped view with labels, never other branches', async () => {
    const w = await enquiryWorld(app);
    await mkEnquiry(app, w.mgrA, { sourceId: w.m.source, locationId: w.m.locA, assignedTo: asId(w.salesA) }, { name: 'Anand Kumar', phone: '9811111111' });
    await mkEnquiry(app, w.mgrA, {}, { name: 'Bhavna Rao', phone: '9822222222' });
    await mkEnquiry(app, w.mgrB, {}, { name: 'Secret In B', phone: '9833333333' });
    const all = (await csv(w.mgrA)).body as string;
    const lines = all.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Enquiry ID,Name,Phone (with country code),Stage,Source,Type,Property type,Building type,Location,Assigned to,Branch,Created');
    expect(lines).toHaveLength(3);
    expect(all).toContain('Anand Kumar,91 98111 11111,New,Website,,,,Anna Nagar,SALES_EXECUTIVE,Branch A');
    expect(all).not.toMatch(/Secret In B|9833333333/);
    const filtered = (await csv(w.mgrA, '?search=bhavna')).body as string;
    expect(filtered).toContain('Bhavna Rao');
    expect(filtered).not.toContain('Anand Kumar');
    expect((await csv(w.mgrA, `?branchId=${w.B}`)).status).toBe(403);
    expect(((await csv(w.admin)).body as string).split('\r\n').filter(Boolean)).toHaveLength(4);
  });

  it('OWN scope exports only its own rows (even when granted export)', async () => {
    const w = await enquiryWorld(app);
    await grant('SALES_EXECUTIVE', 'enquiries.export');
    await mkEnquiry(app, w.salesA, {}, { name: 'Mine One', phone: '9811111111' });
    await mkEnquiry(app, w.salesA2, {}, { name: 'Not Mine', phone: '9822222222' });
    const body = (await csv(w.salesA)).body as string;
    expect(body).toContain('Mine One');
    expect(body).not.toContain('Not Mine');
  });

  it('neutralises spreadsheet formulas and escapes quotes/commas', async () => {
    const w = await enquiryWorld(app);
    await mkEnquiry(app, w.mgrA, {}, { name: '=HYPERLINK("http://evil","x")', phone: '9811111111' });
    await mkEnquiry(app, w.mgrA, {}, { name: 'Smith, John "JJ"', phone: '9822222222' });
    const body = (await csv(w.mgrA)).body as string;
    expect(body).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(body).toContain('"Smith, John ""JJ"""');
    expect(body).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it('refuses over-large exports with a normal JSON error before any data, and audits real exports', async () => {
    const w = await enquiryWorld(app);
    for (let i = 0; i < 3; i++) await mkEnquiry(app, w.mgrA);
    process.env.EXPORT_MAX_ROWS = '2';
    resetEnvCache();
    try {
      const res = await request(app).get(api('/enquiries/export.csv')).set(w.mgrA.auth);
      expect(res.status).toBe(413);
      expect(res.headers['content-type']).toMatch(/json/);
      expect(res.headers['content-disposition']).toBeUndefined();
      expect(res.body.error.code).toBe('EXPORT_TOO_LARGE');
    } finally {
      delete process.env.EXPORT_MAX_ROWS;
      resetEnvCache();
    }
    await csv(w.mgrA);
    const audit = await AuditLogs.findOne({ entityType: 'export', action: 'enquiries' }).lean();
    expect(audit!.changes).toMatchObject({ rows: { to: 3 } });
    expect(String(audit!.userId)).toBe(asId(w.mgrA));
  });
});

describe('dashboard preparation', () => {
  it('stage counts are one scoped aggregate over the same filters (the funnel will reuse it)', async () => {
    const w = await enquiryWorld(app);
    await mkEnquiry(app, w.mgrA);
    await mkEnquiry(app, w.mgrB);
    const e = await mkEnquiry(app, w.mgrA);
    await advance(app, w.mgrA, e.id, 'CONTACTED');
    const counts = await stageCounts(principalWith('BRANCH', [], [w.A]), { isArchived: 'false' } as never);
    expect(Object.fromEntries(counts)).toEqual({ NEW: 1, CONTACTED: 1 });
    const all = await stageCounts(principalWith('ALL', []), { isArchived: 'false' } as never);
    expect(Object.fromEntries(all)).toEqual({ NEW: 2, CONTACTED: 1 });
    expect(person).toBeTypeOf('function');
  });
});
