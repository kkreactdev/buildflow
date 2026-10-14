import mongoose, { Schema } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { getCapabilities } from '../config/db';
import { useTestDb } from '../test/db';
import { AppError, ErrorCode } from './appError';
import { withTransaction } from './transaction';

const Thing = mongoose.model('Thing', new Schema({ name: String }));

describe('withTransaction on a replica set', () => {
  useTestDb('replset');

  it('detects transaction support', () => {
    expect(getCapabilities()).toEqual({ topology: 'replicaset', supportsTransactions: true });
  });

  it('commits all writes together', async () => {
    await Thing.createCollection();
    await withTransaction(async (session) => {
      await Thing.create([{ name: 'a' }], { session });
      await Thing.create([{ name: 'b' }], { session });
    });
    expect(await Thing.countDocuments()).toBe(2);
  });

  it('rolls everything back when the callback throws', async () => {
    await Thing.createCollection();
    await expect(
      withTransaction(async (session) => {
        await Thing.create([{ name: 'a' }], { session });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await Thing.countDocuments()).toBe(0);
  });
});

describe('withTransaction on a standalone server (no unsafe fallback)', () => {
  useTestDb('standalone');

  it('is detected as unsupported', () => {
    expect(getCapabilities()).toEqual({ topology: 'standalone', supportsTransactions: false });
  });

  it('refuses with a clear configuration error and runs NOTHING', async () => {
    let ran = false;
    const err = await withTransaction(async () => {
      ran = true;
    }).catch((e: unknown) => e);
    expect(ran).toBe(false);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(ErrorCode.TRANSACTIONS_UNSUPPORTED);
    expect((err as AppError).message).toMatch(/replica set/i);
  });
});
