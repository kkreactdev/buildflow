import { Types } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import { withTransaction } from '../../lib/transaction';
import { useTestDb } from '../../test/db';
import { Activities, seedAll } from '../../test/factories';
import { Activity } from './activity.model';
import { resetActivityTypeCache } from './activityTypes';
import { recordActivity } from './activity.service';

describe('activity recording', () => {
  useTestDb();
  beforeEach(async () => {
    resetActivityTypeCache();
    await seedAll();
  });
  const raj = new Types.ObjectId();
  const villa = new Types.ObjectId();
  const enquiry = new Types.ObjectId();
  const branch = new Types.ObjectId();

  it('ONE activity references several entities and is stored once', async () => {
    await recordActivity({
      type: 'SITE_VISIT_COMPLETED',
      description: 'Raj Kumar visited Villa 03',
      branchId: branch,
      refs: [{ type: 'client', id: raj }, { type: 'unit', id: villa }, { type: 'enquiry', id: enquiry }],
    });
    expect(await Activities.countDocuments()).toBe(1);
    for (const [type, id] of [['client', raj], ['unit', villa], ['enquiry', enquiry]] as const) {
      expect(await Activities.countDocuments({ refs: { $elemMatch: { type, id } } })).toBe(1);
    }
    expect(await Activities.countDocuments({ refs: { $elemMatch: { type: 'unit', id: new Types.ObjectId() } } })).toBe(0);
  });

  it('requires at least one reference and a branch', async () => {
    await expect(recordActivity({ type: 'ENQUIRY_CREATED', description: 'y', branchId: branch, refs: [] })).rejects.toThrow();
    await expect(recordActivity({ type: 'ENQUIRY_CREATED', description: 'y', branchId: undefined as never, refs: [{ type: 'unit', id: villa }] })).rejects.toThrow();
  });

  it('refuses a type that is not a configured ACTIVITY_TYPE master', async () => {
    await expect(recordActivity({ type: 'MADE_UP', description: 'x', branchId: branch, refs: [{ type: 'unit', id: villa }] })).rejects.toMatchObject({ code: 'UNKNOWN_ACTIVITY_TYPE' });
    expect(await Activities.countDocuments()).toBe(0);
  });

  it('rolls back with the surrounding transaction', async () => {
    await Activity.createCollection();
    await expect(
      withTransaction(async (session) => {
        await recordActivity({ type: 'UNIT_ASSIGNED', description: 'd', branchId: branch, refs: [{ type: 'unit', id: villa }] }, { session });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await Activities.countDocuments()).toBe(0);
  });

  it('bestEffort swallows failures; default throws', async () => {
    const bad = { type: 'UNIT_ASSIGNED', description: '', branchId: branch, refs: [{ type: 'unit' as const, id: villa }] };
    await expect(recordActivity(bad, { bestEffort: true })).resolves.toBeUndefined();
    await expect(recordActivity(bad)).rejects.toThrow();
  });

  it('is append-only for every caller, including system scope', async () => {
    await recordActivity({ type: 'UNIT_ASSIGNED', description: 'd', branchId: branch, refs: [{ type: 'unit', id: villa }] });
    await expect(Activities.updateOne({}, { description: 'edited' })).rejects.toMatchObject({ code: 'IMMUTABLE_RECORD' });
    await expect(Activities.deleteMany({})).rejects.toMatchObject({ code: 'IMMUTABLE_RECORD' });
    const doc = await Activities.findOne({});
    doc!.description = 'edited';
    await expect(Activities.save(doc!)).rejects.toMatchObject({ code: 'IMMUTABLE_RECORD' });
    expect(await Activities.countDocuments({ description: 'd' })).toBe(1);
  });
});
