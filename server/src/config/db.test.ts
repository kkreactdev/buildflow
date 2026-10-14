import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { connectDb, DbConfigError, disconnectDb, getCapabilities } from './db';

afterEach(async () => {
  await disconnectDb();
});

describe('connectDb', () => {
  it('connects to a replica set and /ready reports transaction support', async () => {
    const rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    try {
      const caps = await connectDb({ uri: rs.getUri(), requireReplicaSet: true });
      expect(caps).toEqual({ topology: 'replicaset', supportsTransactions: true });

      const res = await request(buildApp()).get('/ready');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ status: 'ready', db: { topology: 'replicaset', supportsTransactions: true } });
    } finally {
      await disconnectDb();
      await rs.stop();
    }
  });

  it('refuses to start on a standalone server when a replica set is required', async () => {
    const srv = await MongoMemoryServer.create();
    try {
      const err = await connectDb({ uri: srv.getUri(), requireReplicaSet: true }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DbConfigError);
      expect((err as Error).message).toMatch(/replica set/i);
      expect((err as Error).message).toMatch(/MONGODB_URI/);
    } finally {
      await srv.stop();
    }
  });

  it('can start on standalone only when explicitly allowed, and reports no transaction support', async () => {
    const srv = await MongoMemoryServer.create();
    try {
      await connectDb({ uri: srv.getUri(), requireReplicaSet: false });
      expect(getCapabilities()).toEqual({ topology: 'standalone', supportsTransactions: false });
      const res = await request(buildApp()).get('/ready');
      expect(res.body.data.db.supportsTransactions).toBe(false);
    } finally {
      await disconnectDb();
      await srv.stop();
    }
  });
});
