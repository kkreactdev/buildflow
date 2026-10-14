import mongoose from 'mongoose';
import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { detectCapabilities, disconnectDb } from '../config/db';

type Kind = 'replset' | 'standalone';

/**
 * Registers hooks that boot an in-memory MongoDB for the current test file.
 * `replset` (default) supports transactions; `standalone` does not and is used
 * to prove the unsafe-fallback guard.
 */
export function useTestDb(kind: Kind = 'replset'): void {
  let server: MongoMemoryReplSet | MongoMemoryServer;

  beforeAll(async () => {
    server =
      kind === 'replset'
        ? await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
        : await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), { serverSelectionTimeoutMS: 10_000 });
    await detectCapabilities();
  });

  beforeEach(async () => {
    const cols = await mongoose.connection.db!.collections();
    await Promise.all(cols.map((c) => c.deleteMany({})));
  });

  afterAll(async () => {
    await disconnectDb();
    await server.stop();
  });
}
