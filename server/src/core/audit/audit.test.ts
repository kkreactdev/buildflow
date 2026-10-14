import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { withTransaction } from '../../lib/transaction';
import { useTestDb } from '../../test/db';
import { AuditLog } from './audit.model';
import { AuditLogs } from '../../test/factories';
import { computeChanges, REDACTED, recordAudit } from './audit.service';

describe('computeChanges', () => {
  it('reports previous and new values only for changed fields', () => {
    expect(computeChanges({ name: 'A', city: 'X', n: 1 }, { name: 'B', city: 'X', n: 1 })).toEqual({
      name: { from: 'A', to: 'B' },
    });
  });
  it('treats creation as all-new', () => {
    expect(computeChanges(undefined, { name: 'A' })).toEqual({ name: { from: undefined, to: 'A' } });
  });
  it('ignores bookkeeping fields and compares ids/dates by value', () => {
    const id = new Types.ObjectId();
    const d = new Date('2026-01-01');
    expect(
      computeChanges(
        { _id: 1, updatedAt: 1, ref: id, at: d },
        { _id: 2, updatedAt: 2, ref: new Types.ObjectId(id.toHexString()), at: new Date(d) },
      ),
    ).toEqual({});
  });
  it('redacts sensitive values but still records that they changed', () => {
    const c = computeChanges({ passwordHash: 'old' }, { passwordHash: 'new' });
    expect(c.passwordHash).toEqual({ from: REDACTED, to: REDACTED });
    expect(JSON.stringify(c)).not.toMatch(/old|new/);
  });
});

describe('audit service', () => {
  useTestDb();
  const entityId = new Types.ObjectId();
  const userId = new Types.ObjectId();

  it('stores who/what/previous/new/when/why', async () => {
    await recordAudit({
      entityType: 'enquiry',
      entityId,
      action: 'transition',
      before: { stageCode: 'INTERESTED' },
      after: { stageCode: 'CONTACTED' },
      userId,
      reason: 'Customer asked to postpone',
    });
    const row = await AuditLogs.findOne({ entityId }).lean();
    expect(row).toMatchObject({
      entityType: 'enquiry',
      action: 'transition',
      reason: 'Customer asked to postpone',
      changes: { stageCode: { from: 'INTERESTED', to: 'CONTACTED' } },
    });
    expect(String(row?.userId)).toBe(userId.toHexString());
    expect(row?.at).toBeInstanceOf(Date);
  });

  it('is append-only: no update, delete, replace or bulk mutation for anyone', async () => {
    await recordAudit({ entityType: 'unit', entityId, action: 'create', after: { a: 1 } });
    await expect(AuditLogs.updateOne({}, { action: 'x' })).rejects.toMatchObject({ code: 'IMMUTABLE_RECORD' });
    await expect(AuditLogs.updateMany({}, { action: 'x' })).rejects.toMatchObject({ code: 'IMMUTABLE_RECORD' });
    await expect(AuditLogs.deleteOne({})).rejects.toMatchObject({ code: 'IMMUTABLE_RECORD' });
    await expect(AuditLogs.deleteMany({})).rejects.toMatchObject({ code: 'IMMUTABLE_RECORD' });
    await expect(AuditLogs.findOneAndUpdate({}, { action: 'x' })).rejects.toMatchObject({ code: 'IMMUTABLE_RECORD' });
    await expect(AuditLogs.findOneAndDelete({})).rejects.toMatchObject({ code: 'IMMUTABLE_RECORD' });
    await expect(AuditLogs.bulkWrite([{ deleteMany: { filter: {} } }])).rejects.toMatchObject({ code: 'IMMUTABLE_RECORD' });
    const row = await AuditLogs.findOne({});
    row!.action = 'tampered';
    await expect(AuditLogs.save(row!)).rejects.toMatchObject({ code: 'IMMUTABLE_RECORD' });
    await expect(row!.deleteOne()).rejects.toBeTruthy();
    expect(await AuditLogs.countDocuments({ action: 'create' })).toBe(1);
  });

  it('rolls back with the surrounding transaction', async () => {
    await AuditLog.createCollection();
    await expect(
      withTransaction(async (session) => {
        await recordAudit({ entityType: 'unit', entityId, action: 'create', after: { a: 1 } }, { session });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await AuditLogs.countDocuments()).toBe(0);
  });
});
