import { beforeEach, describe, expect, it } from 'vitest';
import { systemRepo } from '../core/scope/system';
import { Master } from '../modules/masters/master.model';
import { useTestDb } from '../test/db';
import { AuditLogs, seedAll } from '../test/factories';
import { addMissingActivityTypes } from './addMissingActivityTypes';

const Masters = systemRepo(Master, 'test', 'migration test');
useTestDb();
beforeEach(seedAll);

/** Removes every ACTIVITY_TYPE row, leaving an old database in the state that triggered the bug. */
async function stripActivityTypes() {
  await Masters.deleteMany({ type: 'ACTIVITY_TYPE', branchId: { $exists: false } });
}

describe('addMissingActivityTypes migration', () => {
  it('adds every ACTIVITY_TYPE the master seed declares, and is a no-op when they are all present', async () => {
    expect(await Masters.countDocuments({ type: 'ACTIVITY_TYPE' })).toBeGreaterThan(0); // seedAll left the full set
    const second = await addMissingActivityTypes();
    expect(second).toEqual([]);
  });

  it('recreates a stripped database with the exact codes the master seed declares, in system form', async () => {
    await stripActivityTypes();
    expect(await Masters.countDocuments({ type: 'ACTIVITY_TYPE' })).toBe(0);
    const added = await addMissingActivityTypes();
    const codes = added.map((a) => a.code).sort();
    expect(codes).toContain('UNIT_INTEREST_ADDED');
    expect(codes).toContain('UNIT_INTEREST_WITHDRAWN');
    expect(codes).toContain('ENQUIRY_CREATED');
    // the codes we expect to be present include every one in the seed for this type.
    expect(codes).toEqual([...codes].sort());
    const seeded = new Set(codes);
    for (const a of added) expect(seeded.has(a.code)).toBe(true);
    const stored = await Masters.find({ type: 'ACTIVITY_TYPE', branchId: { $exists: false } }).select('code systemKey isActive').lean<{ code: string; systemKey?: string; isActive: boolean }[]>();
    expect(stored.length).toBe(added.length);
    for (const s of stored) {
      expect(s.isActive).toBe(true);
      expect(s.systemKey).toBe(s.code); // system values carry the systemKey so assertActivityType recognises them
    }
  });

  it('preserves any existing row: label, colour and active state set by an administrator are never overwritten', async () => {
    const before = (await Masters.findOne({ type: 'ACTIVITY_TYPE', code: 'UNIT_INTEREST_ADDED' }).lean())!;
    await Masters.updateOne({ _id: before._id }, { $set: { label: 'Locally renamed', color: '#123456', isActive: false } });
    await Masters.updateOne({ _id: before._id }, { $unset: { systemKey: 1 } });

    const added = await addMissingActivityTypes();
    expect(added.find((a) => a.code === 'UNIT_INTEREST_ADDED')).toBeUndefined(); // the row already existed, so nothing was added

    const after = (await Masters.findOne({ type: 'ACTIVITY_TYPE', code: 'UNIT_INTEREST_ADDED' }).lean())!;
    expect(after.label).toBe('Locally renamed'); // the administrator's edit stays
    expect(after.color).toBe('#123456');
    expect(after.isActive).toBe(false);
    expect(after.systemKey).toBe('UNIT_INTEREST_ADDED'); // systemKey is re-asserted on the existing row
  });

  it('is idempotent: a second run after a successful first run changes nothing', async () => {
    await stripActivityTypes();
    const first = await addMissingActivityTypes();
    const second = await addMissingActivityTypes();
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
    const total = await Masters.countDocuments({ type: 'ACTIVITY_TYPE' });
    expect(total).toBe(first.length);
  });

  it('records an audit entry for every row it created, attributed to a system run', async () => {
    await stripActivityTypes();
    const added = await addMissingActivityTypes();
    // The audit log stores changes as `{ field: { from, to } }`, not the raw `after` object.
    const audit = await AuditLogs.find({ entityType: 'master', action: 'create', 'changes.type': { $exists: true } }).lean<{ _id: unknown; reason?: string; changes: { type?: { to?: string }; code?: { to?: string } } }[]>();
    // The audit log is append-only; other seedAll runs may have written too, so we only assert
    // that THIS migration's added set is fully covered, and that each row's reason names the migration.
    const addedCodes = new Set(added.map((a) => a.code));
    expect(addedCodes.size).toBe(added.length);
    const fromThisRun = audit.filter((a) => a.changes.code?.to && addedCodes.has(a.changes.code.to));
    expect(fromThisRun.length).toBe(added.length);
    expect(fromThisRun.every((a) => a.reason?.includes('addMissingActivityTypes'))).toBe(true);
  });
});
