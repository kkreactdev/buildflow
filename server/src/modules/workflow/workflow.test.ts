import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { actor, AuditLogs, makeBranch, principalWith, seedAll } from '../../test/factories';
import { useTestDb } from '../../test/db';
import { Role } from '../roles/role.model';
import { clearTransitionGuards, registerTransitionGuard, WorkflowDefinition, type StageView } from './workflow.definition';
import { WorkflowStage } from './workflow.model';
import { loadWorkflow } from './workflow.service';
import { CANONICAL_FLOW_KEYS, CANONICAL_STAGES, DOMAIN_OPERATIONS } from './workflowDefaults';

const app = buildApp();
const api = (p: string) => `/api/v1${p}`;

/** An in-memory pipeline (no database) for the pure rules. */
function stages(overrides: Record<string, Partial<StageView>> = {}, extra: StageView[] = []): StageView[] {
  let order = 0;
  const base = CANONICAL_STAGES.map((c): StageView => ({
    id: c.systemKey, systemKey: c.systemKey, label: c.label, order: c.kind === 'FLOW' ? ++order : 1000, kind: c.kind,
    entryPolicy: c.entryPolicy, domainOperation: c.domainOperation, isActive: true, isSystem: true, ...overrides[c.systemKey],
  }));
  return [...base, ...extra];
}
const wf = (o?: Record<string, Partial<StageView>>, extra?: StageView[]) => new WorkflowDefinition(stages(o, extra));
const custom = (key: string, order: number, over: Partial<StageView> = {}): StageView => ({ id: key, systemKey: key, label: key, order, kind: 'FLOW', entryPolicy: 'MANUAL', isActive: true, isSystem: false, ...over });

const editor = principalWith('BRANCH', ['enquiries.edit']);
const manager = principalWith('BRANCH', ['enquiries.edit', 'enquiries.revert', 'enquiries.lose', 'enquiries.reopen']);
const nobody = principalWith('BRANCH', []);

describe('workflow state machine: forward movement', () => {
  it('allows moving to the next configured stage', async () => {
    const p = await wf().plan({ from: 'NEW', to: 'CONTACTED', principal: editor });
    expect(p).toMatchObject({ direction: 'FORWARD' });
    expect(p.from.systemKey).toBe('NEW');
    expect((await wf().plan({ from: 'CONTACTED', to: 'INTERESTED', principal: editor })).to.systemKey).toBe('INTERESTED');
    expect((await wf().plan({ from: 'NEGOTIATION', to: 'BOOKED', principal: editor, via: DOMAIN_OPERATIONS.createBooking })).direction).toBe('FORWARD');
  });

  it('rejects skipping stages (every non-adjacent forward jump)', async () => {
    const keys = CANONICAL_FLOW_KEYS;
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 2; j < keys.length; j++) {
        await expect(wf().plan({ from: keys[i]!, to: keys[j]!, principal: manager })).rejects.toMatchObject({ code: 'STAGE_SKIP', httpStatus: 409 });
      }
    }
  });

  it('a domain operation may skip stages, but only to the stage it owns', async () => {
    // Booking is a real activity, so it does not have to pass through every intermediate stage first
    // (a walk-in can be booked the same way it can be scheduled a visit).
    await expect(wf().plan({ from: 'INTERESTED', to: 'BOOKED', principal: manager, via: DOMAIN_OPERATIONS.createBooking })).resolves.toMatchObject({ direction: 'FORWARD' });
    // …and it still cannot reach a stage belonging to a different operation.
    await expect(wf().plan({ from: 'NEW', to: 'BOOKED', principal: manager, via: DOMAIN_OPERATIONS.completeVisit })).rejects.toMatchObject({ code: 'DOMAIN_ONLY' });
    await expect(wf().plan({ from: 'NEW', to: 'SITE_VISIT_COMPLETED', principal: manager, via: DOMAIN_OPERATIONS.createBooking })).rejects.toMatchObject({ code: 'DOMAIN_ONLY' });
    // A manual stage is still reachable by an operation, because an operation is allowed to record
    // real progress — but a manual move can still never skip.
    await expect(wf().plan({ from: 'NEW', to: 'NEGOTIATION', principal: manager })).rejects.toMatchObject({ code: 'STAGE_SKIP' });
  });

  it('forward movement needs enquiries.edit', async () => {
    await expect(wf().plan({ from: 'NEW', to: 'CONTACTED', principal: nobody })).rejects.toMatchObject({ httpStatus: 403 });
  });

  it('refuses a no-op and unknown stages', async () => {
    await expect(wf().plan({ from: 'NEW', to: 'NEW', principal: editor })).rejects.toMatchObject({ code: 'NO_CHANGE' });
    await expect(wf().plan({ from: 'NEW', to: 'NOPE', principal: editor })).rejects.toMatchObject({ code: 'UNKNOWN_STAGE' });
    await expect(wf().plan({ from: 'NOPE', to: 'NEW', principal: editor })).rejects.toMatchObject({ code: 'UNKNOWN_STAGE' });
  });
});

describe('workflow state machine: domain-controlled stages (booking/conversion later)', () => {
  it('stages with a domain entry cannot be entered by a plain move', async () => {
    await expect(wf().plan({ from: 'INTERESTED', to: 'SITE_VISIT_SCHEDULED', principal: manager })).rejects.toMatchObject({ code: 'DOMAIN_ONLY', details: { domainOperation: 'sitevisit.schedule' } });
    await expect(wf().plan({ from: 'SITE_VISIT_SCHEDULED', to: 'SITE_VISIT_COMPLETED', principal: manager })).rejects.toMatchObject({ code: 'DOMAIN_ONLY' });
    await expect(wf().plan({ from: 'NEGOTIATION', to: 'BOOKED', principal: manager })).rejects.toMatchObject({ code: 'DOMAIN_ONLY' });
    await expect(wf().plan({ from: 'BOOKED', to: 'CONVERTED', principal: manager })).rejects.toMatchObject({ code: 'DOMAIN_ONLY' });
  });

  it('only the matching domain operation may enter, and it carries its own authorization', async () => {
    const plan = await wf().plan({ from: 'INTERESTED', to: 'SITE_VISIT_SCHEDULED', principal: nobody, via: DOMAIN_OPERATIONS.scheduleVisit });
    expect(plan.direction).toBe('FORWARD'); // no enquiries.edit needed: the visit operation authorized itself
    await expect(wf().plan({ from: 'INTERESTED', to: 'SITE_VISIT_SCHEDULED', principal: manager, via: DOMAIN_OPERATIONS.createBooking })).rejects.toMatchObject({ code: 'DOMAIN_ONLY' });
    await expect(wf().plan({ from: 'BOOKED', to: 'CONVERTED', principal: manager, via: DOMAIN_OPERATIONS.createBooking })).rejects.toMatchObject({ code: 'DOMAIN_ONLY' });
    expect((await wf().plan({ from: 'BOOKED', to: 'CONVERTED', principal: nobody, via: DOMAIN_OPERATIONS.convertEnquiry })).to.systemKey).toBe('CONVERTED');
  });

  it('available transitions flag domain targets so the UI opens the right dialog', () => {
    const t = wf().availableTransitions('INTERESTED', editor);
    expect(t).toEqual([{ to: 'SITE_VISIT_SCHEDULED', direction: 'FORWARD', requiresReason: false, domainOperation: 'sitevisit.schedule' }]);
  });

  it('later modules can add rules through guards (e.g. no leaving BOOKED with an active booking)', async () => {
    registerTransitionGuard((plan) => {
      if (plan.from.systemKey === 'BOOKED' && plan.direction === 'BACKWARD') throw Object.assign(new Error('active booking'), { code: 'ACTIVE_BOOKING' });
    });
    try {
      await expect(wf().plan({ from: 'BOOKED', to: 'NEGOTIATION', principal: manager, reason: 'client changed mind' })).rejects.toMatchObject({ code: 'ACTIVE_BOOKING' });
      expect((await wf().plan({ from: 'NEW', to: 'CONTACTED', principal: editor })).direction).toBe('FORWARD'); // unrelated moves unaffected
    } finally {
      clearTransitionGuards();
    }
  });
});

describe('workflow state machine: backward movement', () => {
  it('requires the revert permission', async () => {
    await expect(wf().plan({ from: 'NEGOTIATION', to: 'INTERESTED', principal: editor, reason: 'x' })).rejects.toMatchObject({ httpStatus: 403 });
    await expect(wf().plan({ from: 'NEGOTIATION', to: 'INTERESTED', principal: nobody, reason: 'x' })).rejects.toMatchObject({ httpStatus: 403 });
  });

  it('requires a reason (blank/whitespace/too long are refused)', async () => {
    for (const reason of [undefined, '', '   ']) {
      await expect(wf().plan({ from: 'NEGOTIATION', to: 'INTERESTED', principal: manager, reason })).rejects.toMatchObject({ httpStatus: 400, details: [{ path: 'reason' }] });
    }
    await expect(wf().plan({ from: 'NEGOTIATION', to: 'INTERESTED', principal: manager, reason: 'x'.repeat(501) })).rejects.toMatchObject({ httpStatus: 400 });
  });

  it('succeeds with permission + reason, and returns the trimmed reason for logging', async () => {
    const plan = await wf().plan({ from: 'NEGOTIATION', to: 'CONTACTED', principal: manager, reason: '  Customer went back to shortlisting  ' });
    expect(plan).toMatchObject({ direction: 'BACKWARD', reason: 'Customer went back to shortlisting' });
    expect(plan.to.systemKey).toBe('CONTACTED');
  });

  it('permission is checked before the reason (no information leak to unprivileged callers)', async () => {
    await expect(wf().plan({ from: 'NEGOTIATION', to: 'INTERESTED', principal: editor })).rejects.toMatchObject({ httpStatus: 403 });
  });
});

describe('workflow state machine: LOST and reopen', () => {
  it('marking lost needs enquiries.lose and a reason; allowed from any open stage', async () => {
    for (const from of CANONICAL_FLOW_KEYS.filter((k) => k !== 'CONVERTED')) {
      expect((await wf().plan({ from, to: 'LOST', principal: manager, reason: 'No budget' })).direction).toBe('LOST');
    }
    await expect(wf().plan({ from: 'NEW', to: 'LOST', principal: editor, reason: 'x' })).rejects.toMatchObject({ httpStatus: 403 });
    await expect(wf().plan({ from: 'NEW', to: 'LOST', principal: manager })).rejects.toMatchObject({ httpStatus: 400 });
  });

  it('a converted enquiry can no longer be marked lost', async () => {
    await expect(wf().plan({ from: 'CONVERTED', to: 'LOST', principal: manager, reason: 'x' })).rejects.toMatchObject({ code: 'TERMINAL_STAGE', httpStatus: 409 });
  });

  it('reopen needs enquiries.reopen + reason and may only return to a stage a person can enter', async () => {
    expect((await wf().plan({ from: 'LOST', to: 'NEW', principal: manager, reason: 'Customer called back' })).direction).toBe('REOPEN');
    await expect(wf().plan({ from: 'LOST', to: 'NEW', principal: editor, reason: 'x' })).rejects.toMatchObject({ httpStatus: 403 });
    await expect(wf().plan({ from: 'LOST', to: 'NEW', principal: manager })).rejects.toMatchObject({ httpStatus: 400 });
    await expect(wf().plan({ from: 'LOST', to: 'BOOKED', principal: manager, reason: 'x', via: DOMAIN_OPERATIONS.createBooking })).rejects.toMatchObject({ code: 'REOPEN_TARGET' });
    await expect(wf().plan({ from: 'LOST', to: 'SITE_VISIT_SCHEDULED', principal: manager, reason: 'x' })).rejects.toMatchObject({ code: 'REOPEN_TARGET' });
  });
});

describe('workflow state machine: configuration (inactive and custom stages)', () => {
  it('an inactive stage is skipped by the chain and cannot be a target', async () => {
    const d = wf({}, [custom('CUSTOM_CALLBACK', 1.5, { isActive: false })]);
    expect(d.next('NEW')!.systemKey).toBe('CONTACTED'); // inactive custom stage is not "next"
    await expect(d.plan({ from: 'NEW', to: 'CUSTOM_CALLBACK', principal: editor })).rejects.toMatchObject({ code: 'STAGE_INACTIVE' });
  });

  it('an active custom stage becomes a mandatory step: no skipping over it', async () => {
    const d = wf({}, [custom('CUSTOM_QUALIFIED', 2.5)]); // between CONTACTED(2) and INTERESTED(3)
    expect(d.next('CONTACTED')!.systemKey).toBe('CUSTOM_QUALIFIED');
    await expect(d.plan({ from: 'CONTACTED', to: 'INTERESTED', principal: editor })).rejects.toMatchObject({ code: 'STAGE_SKIP', details: { next: 'CUSTOM_QUALIFIED' } });
    expect((await d.plan({ from: 'CONTACTED', to: 'CUSTOM_QUALIFIED', principal: editor })).direction).toBe('FORWARD');
    expect((await d.plan({ from: 'CUSTOM_QUALIFIED', to: 'INTERESTED', principal: editor })).direction).toBe('FORWARD');
  });

  it('an enquiry sitting in a stage that was later deactivated can still move on and back', async () => {
    const d = wf({}, [custom('CUSTOM_OLD', 2.5, { isActive: false })]);
    expect((await d.plan({ from: 'CUSTOM_OLD', to: 'INTERESTED', principal: editor })).direction).toBe('FORWARD');
    expect((await d.plan({ from: 'CUSTOM_OLD', to: 'CONTACTED', principal: manager, reason: 'back' })).direction).toBe('BACKWARD');
  });

  it('exposes next/previous for the Kanban and funnel', () => {
    const d = wf();
    expect(d.chain.map((s) => s.systemKey)).toEqual(CANONICAL_FLOW_KEYS);
    expect(d.next('CONVERTED')).toBeUndefined();
    expect(d.next('LOST')).toBeUndefined();
    expect(d.previous('INTERESTED').map((s) => s.systemKey)).toEqual(['CONTACTED', 'NEW']);
  });

  it('available transitions honour permissions', () => {
    const d = wf();
    expect(d.availableTransitions('CONTACTED', nobody)).toEqual([]);
    expect(d.availableTransitions('CONTACTED', editor).map((t) => [t.to, t.direction])).toEqual([['INTERESTED', 'FORWARD']]);
    expect(d.availableTransitions('CONTACTED', manager).map((t) => [t.to, t.direction])).toEqual([['INTERESTED', 'FORWARD'], ['NEW', 'BACKWARD'], ['LOST', 'LOST']]);
    expect(d.availableTransitions('LOST', manager).map((t) => t.direction)).toEqual(['REOPEN', 'REOPEN', 'REOPEN', 'REOPEN']);
    expect(d.availableTransitions('LOST', editor)).toEqual([]);
  });
});

describe('workflow configuration API', () => {
  useTestDb();
  beforeEach(seedAll);

  const admin = () => actor(app, 'ADMIN');
  const stagesOf = async (a: { auth: Record<string, string> }) => (await request(app).get(api('/workflow/stages')).set(a.auth)).body.data as { _id: string; systemKey: string; label: string; order: number; isActive: boolean; isSystem: boolean; entryPolicy: string }[];

  it('seeds the canonical pipeline with domain-controlled stages marked', async () => {
    const a = await admin();
    const s = await stagesOf(a);
    expect(s.map((x) => x.systemKey)).toEqual([...CANONICAL_FLOW_KEYS, 'LOST']);
    expect(s.map((x) => x.order).slice(0, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(s.filter((x) => x.entryPolicy === 'DOMAIN').map((x) => x.systemKey)).toEqual(['SITE_VISIT_SCHEDULED', 'SITE_VISIT_COMPLETED', 'BOOKED', 'CONVERTED']);
    expect(s.every((x) => x.isSystem)).toBe(true);
  });

  it('everyone with masters.view reads stages; only masters.manage + ALL scope changes them', async () => {
    const b = (await makeBranch('A'))._id.toHexString();
    const sales = await actor(app, 'SALES_EXECUTIVE', [b]);
    expect((await stagesOf(sales)).length).toBe(9);
    await Role.updateOne({ key: 'MANAGER' }, { $addToSet: { permissions: 'masters.manage' } });
    const mgr = await actor(app, 'MANAGER', [b]);
    const s = await stagesOf(sales);
    const id = s[1]!._id;
    for (const who of [sales, mgr]) {
      expect((await request(app).patch(api(`/workflow/stages/${id}`)).set(who.auth).send({ label: 'Hacked' })).status).toBe(403);
      expect((await request(app).post(api('/workflow/stages')).set(who.auth).send({ label: 'X', afterSystemKey: 'NEW' })).status).toBe(403);
      expect((await request(app).post(api('/workflow/stages/reorder')).set(who.auth).send({ ids: s.slice(0, 8).map((x) => x._id) })).status).toBe(403);
    }
    expect((await WorkflowStage.findById(id).lean())!.label).toBe('Contacted');
    expect((await request(app).patch(api('/workflow/stages/x')).send({})).status).toBe(401);
  });

  it('edits display properties; systemKey, order, kind and entry rules cannot be edited', async () => {
    const a = await admin();
    const s = (await stagesOf(a)).find((x) => x.systemKey === 'SITE_VISIT_COMPLETED')!;
    const ok = await request(app).patch(api(`/workflow/stages/${s._id}`)).set(a.auth).send({ label: 'Visited', description: 'Done visiting', color: '#123456' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ label: 'Visited', systemKey: 'SITE_VISIT_COMPLETED', color: '#123456', entryPolicy: 'DOMAIN' });
    for (const bad of [{ systemKey: 'X' }, { order: 1 }, { kind: 'LOST' }, { entryPolicy: 'MANUAL' }, { domainOperation: 'x' }, { isSystem: false }, {}]) {
      expect((await request(app).patch(api(`/workflow/stages/${s._id}`)).set(a.auth).send(bad)).status).toBe(400);
    }
    expect(await WorkflowStage.findById(s._id).lean()).toMatchObject({ systemKey: 'SITE_VISIT_COMPLETED', order: 5, entryPolicy: 'DOMAIN' });
    // the db layer also refuses to change the key even if something tries
    await WorkflowStage.updateOne({ _id: s._id }, { systemKey: 'HACKED' });
    expect((await WorkflowStage.findById(s._id).lean())!.systemKey).toBe('SITE_VISIT_COMPLETED');
  });

  it('refuses duplicate display names', async () => {
    const a = await admin();
    const s = await stagesOf(a);
    const res = await request(app).patch(api(`/workflow/stages/${s[0]!._id}`)).set(a.auth).send({ label: 'contacted' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STAGE_LABEL_TAKEN');
  });

  it('core stages cannot be deactivated; custom stages can, and reactivate', async () => {
    const a = await admin();
    const core = (await stagesOf(a)).find((x) => x.systemKey === 'NEGOTIATION')!;
    const res = await request(app).patch(api(`/workflow/stages/${core._id}`)).set(a.auth).send({ isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SYSTEM_STAGE');

    const created = await request(app).post(api('/workflow/stages')).set(a.auth).send({ label: 'Documents Collected', afterSystemKey: 'INTERESTED', color: '#336699' });
    expect(created.status).toBe(201);
    const id = created.body.data._id;
    const off = await request(app).patch(api(`/workflow/stages/${id}`)).set(a.auth).send({ isActive: false });
    expect(off.body.data.isActive).toBe(false);
    expect((await request(app).patch(api(`/workflow/stages/${id}`)).set(a.auth).send({ isActive: true })).body.data.isActive).toBe(true);
    expect(await AuditLogs.countDocuments({ entityType: 'workflowStage', action: 'deactivate' })).toBe(1);
    expect(await AuditLogs.countDocuments({ entityType: 'workflowStage', action: 'activate' })).toBe(1);
  });

  it('adds an intermediate stage after a chosen stage with a generated immutable key; orders stay gap-free', async () => {
    const a = await admin();
    const created = await request(app).post(api('/workflow/stages')).set(a.auth).send({ label: 'Docs Collected', afterSystemKey: 'interested' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ systemKey: 'CUSTOM_DOCS_COLLECTED', kind: 'FLOW', entryPolicy: 'MANUAL', isSystem: false, isActive: true });
    const s = await stagesOf(a);
    expect(s.map((x) => x.systemKey)).toEqual(['NEW', 'CONTACTED', 'INTERESTED', 'CUSTOM_DOCS_COLLECTED', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_COMPLETED', 'NEGOTIATION', 'BOOKED', 'CONVERTED', 'LOST']);
    expect(s.slice(0, 9).map((x) => x.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // the same display name (any case) is refused
    expect((await request(app).post(api('/workflow/stages')).set(a.auth).send({ label: 'docs collected', afterSystemKey: 'NEW' })).status).toBe(409);
    // a different name that slugs to the same key still gets a unique, immutable key
    const second = await request(app).post(api('/workflow/stages')).set(a.auth).send({ label: 'Docs-Collected!', afterSystemKey: 'NEW' });
    expect(second.status).toBe(201);
    expect(second.body.data.systemKey).toBe('CUSTOM_DOCS_COLLECTED_2');
  });

  it('validates insertion points', async () => {
    const a = await admin();
    const post = (b: object) => request(app).post(api('/workflow/stages')).set(a.auth).send(b);
    expect((await post({ label: 'X', afterSystemKey: 'NOPE' })).status).toBe(400);
    expect((await post({ label: 'X', afterSystemKey: 'CONVERTED' })).status).toBe(400); // nothing after the final stage
    expect((await post({ label: 'X', afterSystemKey: 'LOST' })).status).toBe(400); // LOST is outside the chain
    expect((await post({ label: '', afterSystemKey: 'NEW' })).status).toBe(400);
    expect((await post({ label: 'X', afterSystemKey: 'NEW', systemKey: 'FORCED' })).status).toBe(400);
  });

  it('the state machine sees a newly added stage immediately (no skipping it)', async () => {
    const a = await admin();
    await request(app).post(api('/workflow/stages')).set(a.auth).send({ label: 'Qualified', afterSystemKey: 'CONTACTED' });
    const live = await loadWorkflow();
    expect(live.next('CONTACTED')!.systemKey).toBe('CUSTOM_QUALIFIED');
    await expect(live.plan({ from: 'CONTACTED', to: 'INTERESTED', principal: editor })).rejects.toMatchObject({ code: 'STAGE_SKIP' });
    const t = await request(app).get(api('/workflow/transitions?from=CONTACTED')).set((await actor(app, 'SUPER_ADMIN')).auth);
    expect(t.body.data.map((x: { to: string }) => x.to)).toContain('CUSTOM_QUALIFIED');
  });

  it('reorders custom stages among the canonical ones, and audits each moved stage', async () => {
    const a = await admin();
    await request(app).post(api('/workflow/stages')).set(a.auth).send({ label: 'Custom A', afterSystemKey: 'NEW' });
    const before = await stagesOf(a);
    const flow = before.filter((x) => x.systemKey !== 'LOST');
    const custom = flow.find((x) => x.systemKey === 'CUSTOM_CUSTOM_A')!;
    const ids = flow.filter((x) => x !== custom).map((x) => x._id);
    ids.splice(5, 0, custom._id); // move it to just before SITE_VISIT_COMPLETED... after position 5
    const res = await request(app).post(api('/workflow/stages/reorder')).set(a.auth).send({ ids });
    expect(res.status).toBe(200);
    const after = await stagesOf(a);
    expect(after.filter((x) => x.systemKey !== 'LOST').map((x) => x.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(after.indexOf(after.find((x) => x.systemKey === 'CUSTOM_CUSTOM_A')!)).toBe(5);
    expect((await AuditLogs.find({ entityType: 'workflowStage', action: 'reorder' }).lean()).length).toBeGreaterThan(0);
  });

  it('refuses reorders that break the core pipeline order, first/last stage, or use stale ids', async () => {
    const a = await admin();
    const flow = (await stagesOf(a)).filter((x) => x.systemKey !== 'LOST');
    const ids = flow.map((x) => x._id);
    const post = (list: string[]) => request(app).post(api('/workflow/stages/reorder')).set(a.auth).send({ ids: list });
    const swapped = [...ids];
    [swapped[1], swapped[2]] = [swapped[2]!, swapped[1]!]; // CONTACTED <-> INTERESTED
    expect((await post(swapped)).body.error.code).toBe('INVALID_ORDER');
    expect((await post([...ids].reverse())).body.error.code).toBe('INVALID_ORDER');
    expect((await post(ids.slice(1))).body.error.code).toBe('REORDER_MISMATCH');
    expect((await post([...ids.slice(0, 7), new Types.ObjectId().toHexString()])).body.error.code).toBe('REORDER_MISMATCH');
    expect((await stagesOf(a)).map((x) => x.systemKey).slice(0, 8)).toEqual(CANONICAL_FLOW_KEYS);
  });

  it('records stage changes in the audit log (renamed, reordered, activated/deactivated, created)', async () => {
    const a = await admin();
    const s = (await stagesOf(a)).find((x) => x.systemKey === 'NEW')!;
    await request(app).patch(api(`/workflow/stages/${s._id}`)).set(a.auth).send({ label: 'Fresh Lead' });
    const row = await AuditLogs.findOne({ entityType: 'workflowStage', action: 'update' }).lean();
    expect(row!.changes).toMatchObject({ label: { from: 'New', to: 'Fresh Lead' } });
    expect(String(row!.userId)).toBe(a.user._id.toHexString());
  });

  it('GET /workflow/transitions mirrors the rules for the caller', async () => {
    const b = (await makeBranch('A'))._id.toHexString();
    const mgr = await actor(app, 'MANAGER', [b]);
    const sales = await actor(app, 'SALES_EXECUTIVE', [b]);
    const m = await request(app).get(api('/workflow/transitions?from=NEGOTIATION')).set(mgr.auth);
    expect(m.body.data.map((x: { to: string; direction: string }) => `${x.direction}:${x.to}`)).toEqual([
      'FORWARD:BOOKED', 'BACKWARD:SITE_VISIT_COMPLETED', 'BACKWARD:SITE_VISIT_SCHEDULED', 'BACKWARD:INTERESTED', 'BACKWARD:CONTACTED', 'BACKWARD:NEW', 'LOST:LOST',
    ]);
    const sx = await request(app).get(api('/workflow/transitions?from=NEGOTIATION')).set(sales.auth);
    expect(sx.body.data.map((x: { direction: string }) => x.direction)).toEqual(['FORWARD', 'LOST']);
    expect(sx.body.data[0]).toMatchObject({ to: 'BOOKED', domainOperation: 'booking.create' });
    expect((await request(app).get(api('/workflow/transitions?from=NOPE')).set(sales.auth)).status).toBe(409);
  });
});
