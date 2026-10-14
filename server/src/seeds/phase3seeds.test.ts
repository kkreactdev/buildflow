import { beforeEach, describe, expect, it } from 'vitest';
import { systemRepo } from '../core/scope/system';
import { Master } from '../modules/masters/master.model';
import { getMasterType } from '../modules/masters/masterTypes';
import { WorkflowStage } from '../modules/workflow/workflow.model';
import { CANONICAL_STAGES } from '../modules/workflow/workflowDefaults';
import { useTestDb } from '../test/db';
import { MASTER_SEEDS } from './masterSeed';
import { seedMasters } from './seedMasters';
import { seedWorkflow } from './seedWorkflow';

const Masters = systemRepo(Master, 'test', 'fixtures');

describe('master seed definitions', () => {
  it('only seed known GLOBAL types, with unique (type, code) pairs and valid codes', () => {
    const seen = new Set<string>();
    for (const s of MASTER_SEEDS) {
      expect(getMasterType(s.type)?.scope, s.type).toBe('GLOBAL');
      expect(s.code).toMatch(/^[A-Z][A-Z0-9_]+$/);
      const k = `${s.type}:${s.code}`;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
  });

  it('seed what the requirements name: follow-up statuses (incl. MISSED), enquiry-independent unit/visit/referral values, activity events', () => {
    const codes = (type: string) => MASTER_SEEDS.filter((s) => s.type === type).map((s) => s.code);
    expect(codes('FOLLOWUP_STATUS')).toEqual(['PENDING', 'COMPLETED', 'RESCHEDULED', 'CANCELLED', 'MISSED']);
    // NEGOTIATION: Seller Management schedules price discussions with sellers as follow-ups.
    expect(codes('FOLLOWUP_TYPE')).toEqual(['CALL', 'WHATSAPP', 'MEETING', 'SITE_VISIT', 'OFFICE_VISIT', 'EMAIL', 'OTHER', 'NEGOTIATION']);
    expect(codes('REFERRAL_TYPE')).toEqual(['CLIENT', 'EMPLOYEE', 'EXTERNAL']);
    // UNDER_DEVELOPMENT: owned by Seller Management (a purchased unit is held there until it is released to buyers).
    expect(codes('UNIT_STATUS')).toEqual(['AVAILABLE', 'BOOKED', 'SOLD', 'UNDER_DEVELOPMENT']);
    expect(codes('SELLER_STATUS')).toEqual(['REGISTERED', 'VERIFIED', 'REJECTED', 'INACTIVE']);
    expect(codes('PROPERTY_STATUS')).toEqual(['PROPOSED', 'UNDER_VERIFICATION', 'VERIFIED', 'NEGOTIATION', 'APPROVED', 'PURCHASED', 'REFURBISHMENT', 'READY_TO_SELL', 'REJECTED', 'WITHDRAWN']);
    expect(codes('ACTIVITY_TYPE')).toEqual(expect.arrayContaining(['ENQUIRY_CREATED', 'FOLLOWUP_COMPLETED', 'SITE_VISIT_COMPLETED', 'UNIT_ASSIGNED', 'BOOKING_CREATED', 'CLIENT_CONVERTED']));
  });

  it('do NOT invent values the requirements do not give (sources, types, locations, lost reasons, …)', () => {
    const seeded = new Set(MASTER_SEEDS.map((s) => s.type));
    for (const t of ['ENQUIRY_SOURCE', 'ENQUIRY_TYPE', 'PROPERTY_TYPE', 'BUILDING_TYPE', 'LOCATION', 'CLIENT_CATEGORY', 'DOCUMENT_TYPE', 'LOST_REASON', 'WA_CATEGORY', 'WA_EVENT']) expect(seeded.has(t), t).toBe(false);
  });
});

describe('seedMasters is idempotent', () => {
  useTestDb();

  it('creates every value once; re-runs create nothing and never duplicate', async () => {
    const first = await seedMasters();
    expect(first).toEqual({ created: MASTER_SEEDS.length, existing: 0 });
    for (let i = 0; i < 3; i++) expect(await seedMasters()).toEqual({ created: 0, existing: MASTER_SEEDS.length });
    expect(await Masters.countDocuments()).toBe(MASTER_SEEDS.length);
    // unique per (type, code)
    const agg = (await Masters.aggregate([{ $group: { _id: { t: '$type', c: '$code' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])) as unknown[];
    expect(agg).toEqual([]);
  });

  it('assigns system keys and initial order; global values have no branch', async () => {
    await seedMasters();
    const completed = await Masters.findOne({ type: 'FOLLOWUP_STATUS', code: 'COMPLETED' }).lean();
    expect(completed).toMatchObject({ systemKey: 'COMPLETED', sortOrder: 2, isActive: true });
    expect(completed).not.toHaveProperty('branchId');
    expect((await Masters.findOne({ type: 'MEDIA_TYPE', code: 'FRONT' }).lean())).not.toHaveProperty('systemKey');
    expect((await Masters.find({ type: 'FOLLOWUP_STATUS' }).sort({ sortOrder: 1 }).lean()).map((m) => m.code)).toEqual(['PENDING', 'COMPLETED', 'RESCHEDULED', 'CANCELLED', 'MISSED']);
  });

  it('safe re-run: administrator edits survive; a missing system key is restored', async () => {
    await seedMasters();
    await Masters.updateOne({ type: 'FOLLOWUP_TYPE', code: 'CALL' }, { $set: { label: 'Phone call', isActive: false, sortOrder: 99, color: undefined } });
    await Masters.updateOne({ type: 'FOLLOWUP_STATUS', code: 'PENDING' }, { $set: { label: 'To do', color: '#000000' }, $unset: { systemKey: 1 } });
    await Masters.deleteOne({ type: 'MEDIA_TYPE', code: 'OTHER' });
    const res = await seedMasters();
    expect(res.created).toBe(1);
    expect(await Masters.findOne({ type: 'FOLLOWUP_TYPE', code: 'CALL' }).lean()).toMatchObject({ label: 'Phone call', isActive: false, sortOrder: 99 });
    expect(await Masters.findOne({ type: 'FOLLOWUP_STATUS', code: 'PENDING' }).lean()).toMatchObject({ label: 'To do', color: '#000000', systemKey: 'PENDING' });
    expect(await Masters.countDocuments()).toBe(MASTER_SEEDS.length);
  });
});

describe('seedWorkflow is idempotent', () => {
  useTestDb();
  beforeEach(() => undefined);

  it('creates the canonical stages once, with fixed keys and contiguous order', async () => {
    const first = await seedWorkflow();
    expect(first.created).toEqual(CANONICAL_STAGES.map((s) => s.systemKey));
    for (let i = 0; i < 3; i++) expect((await seedWorkflow()).created).toEqual([]);
    expect(await WorkflowStage.countDocuments()).toBe(CANONICAL_STAGES.length);
    const rows = await WorkflowStage.find({ kind: 'FLOW' }).sort({ order: 1 }).lean();
    expect(rows.map((r) => r.systemKey)).toEqual(['NEW', 'CONTACTED', 'INTERESTED', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_COMPLETED', 'NEGOTIATION', 'BOOKED', 'CONVERTED']);
    expect(rows.map((r) => r.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect((await WorkflowStage.findOne({ systemKey: 'LOST' }).lean())).toMatchObject({ kind: 'LOST', isSystem: true });
  });

  it('re-runs keep administrator edits and custom stages, but re-assert system-managed rules', async () => {
    await seedWorkflow();
    await WorkflowStage.updateOne({ systemKey: 'NEW' }, { label: 'Fresh Lead', color: '#abcdef', description: 'edited' });
    await WorkflowStage.updateOne({ systemKey: 'BOOKED' }, { entryPolicy: 'MANUAL', domainOperation: null, isActive: false });
    await WorkflowStage.create({ systemKey: 'CUSTOM_MINE', label: 'Mine', order: 1.5, kind: 'FLOW', isSystem: false });
    await seedWorkflow();
    expect(await WorkflowStage.findOne({ systemKey: 'NEW' }).lean()).toMatchObject({ label: 'Fresh Lead', color: '#abcdef', description: 'edited', order: 1 });
    expect(await WorkflowStage.findOne({ systemKey: 'BOOKED' }).lean()).toMatchObject({ entryPolicy: 'DOMAIN', domainOperation: 'booking.create', isActive: true });
    expect(await WorkflowStage.findOne({ systemKey: 'CUSTOM_MINE' }).lean()).toMatchObject({ label: 'Mine', order: 1.5 });
    expect(await WorkflowStage.countDocuments()).toBe(CANONICAL_STAGES.length + 1);
  });
});
