import mongoose, { type ClientSession } from 'mongoose';
import { detectCapabilities, getCapabilities, TRANSACTIONS_UNSUPPORTED_MESSAGE } from '../config/db';
import { AppError, ErrorCode } from './appError';

function unsupported(): AppError {
  return new AppError(ErrorCode.TRANSACTIONS_UNSUPPORTED, 500, TRANSACTIONS_UNSUPPORTED_MESSAGE);
}

/** Driver error 20 / "Transaction numbers are only allowed on a replica set member or mongos". */
function isTransactionUnsupportedError(err: unknown): boolean {
  const e = err as { code?: number; message?: string } | undefined;
  return (
    e?.code === 20 ||
    (typeof e?.message === 'string' && e.message.includes('Transaction numbers are only allowed'))
  );
}

/**
 * Runs `fn` inside a MongoDB transaction (retried on transient errors by the
 * driver). There is deliberately NO fallback: on a deployment without
 * transaction support this throws a clear configuration error instead of
 * running the work non-atomically.
 *
 * Every read/write inside `fn` must pass the supplied `session`.
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const caps = getCapabilities() ?? (await detectCapabilities());
  if (!caps.supportsTransactions) throw unsupported();

  try {
    return await mongoose.connection.transaction(fn, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    });
  } catch (err) {
    if (isTransactionUnsupportedError(err)) throw unsupported();
    throw err;
  }
}
