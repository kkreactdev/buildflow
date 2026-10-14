import mongoose from 'mongoose';
import { logger } from '../lib/logger';

export type Topology = 'replicaset' | 'sharded' | 'standalone';

export interface DbCapabilities {
  topology: Topology;
  supportsTransactions: boolean;
}

export class DbConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbConfigError';
  }
}

export const TRANSACTIONS_UNSUPPORTED_MESSAGE =
  'MongoDB transactions are not available on this deployment. BuildFlow requires a replica set ' +
  '(MongoDB Atlas, or mongod started with --replSet and initiated). A standalone mongod cannot ' +
  'run bookings or other multi-document operations safely, so the operation was refused.';

let capabilities: DbCapabilities | undefined;

/** Inspects the server's `hello` response to see whether transactions can work. */
export async function detectCapabilities(
  conn: mongoose.Connection = mongoose.connection,
): Promise<DbCapabilities> {
  if (!conn.db) throw new DbConfigError('Database is not connected');
  const hello = (await conn.db.admin().command({ hello: 1 })) as { setName?: string; msg?: string };
  const topology: Topology = hello.setName ? 'replicaset' : hello.msg === 'isdbgrid' ? 'sharded' : 'standalone';
  capabilities = { topology, supportsTransactions: topology !== 'standalone' };
  return capabilities;
}

/** Last detected capabilities, or undefined if not yet connected/detected. */
export function getCapabilities(): DbCapabilities | undefined {
  return capabilities;
}

export interface ConnectOptions {
  uri: string;
  requireReplicaSet: boolean;
}

export async function connectDb({ uri, requireReplicaSet }: ConnectOptions): Promise<DbCapabilities> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  const caps = await detectCapabilities();
  if (!caps.supportsTransactions) {
    if (requireReplicaSet) {
      await mongoose.disconnect();
      throw new DbConfigError(`${TRANSACTIONS_UNSUPPORTED_MESSAGE} (detected topology: ${caps.topology}). Fix MONGODB_URI.`);
    }
    logger.warn(
      { topology: caps.topology },
      'Running WITHOUT transaction support (DB_REQUIRE_REPLICA_SET=false). Booking and other transactional operations will be refused.',
    );
  }
  logger.info({ topology: caps.topology }, 'MongoDB connected');
  return caps;
}

export async function disconnectDb(): Promise<void> {
  capabilities = undefined;
  await mongoose.disconnect();
}
