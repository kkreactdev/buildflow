import type { ClientSession, Types } from 'mongoose';
import { logger } from '../../lib/logger';
import { requestContext } from '../../lib/requestContext';
import { systemRepo } from '../scope/system';
import { AuditLog } from './audit.model';

const SENSITIVE = /password|secret|token|hash/i;
const IGNORED = new Set(['_id', '__v', 'createdAt', 'updatedAt']);
export const REDACTED = '[redacted]';

type Plain = Record<string, unknown>;

function normalise(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object' && 'toHexString' in v) return String((v as Types.ObjectId).toHexString());
  return v;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

/**
 * Field-level diff of two plain objects: `{ field: { from, to } }`. Pass
 * `undefined` as `before` for creations. Sensitive fields are recorded as
 * changed but their values are redacted.
 */
export function computeChanges(before: Plain | undefined, after: Plain | undefined): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    if (IGNORED.has(key)) continue;
    const from = before?.[key];
    const to = after?.[key];
    if (same(from, to)) continue;
    out[key] = SENSITIVE.test(key)
      ? { from: from === undefined ? undefined : REDACTED, to: to === undefined ? undefined : REDACTED }
      : { from: normalise(from), to: normalise(to) };
  }
  return out;
}

export interface RecordAuditInput {
  entityType: string;
  entityId: string | Types.ObjectId;
  action: string;
  before?: Plain;
  after?: Plain;
  userId?: string | Types.ObjectId;
  branchId?: string | Types.ObjectId;
  reason?: string;
}

export interface AuditOptions {
  session?: ClientSession;
  bestEffort?: boolean;
}

/** Writes an immutable who/what/before/after/when/why record. */
export async function recordAudit(input: RecordAuditInput, opts: AuditOptions = {}): Promise<void> {
  const { before, after, ...rest } = input;
  const doc = {
    ...rest,
    changes: computeChanges(before, after),
    requestId: requestContext.get()?.requestId,
  };
  try {
    await systemRepo(AuditLog, 'event', 'audit append').create(doc, { session: opts.session });
  } catch (err) {
    if (!opts.bestEffort) throw err;
    logger.error({ err, entityType: input.entityType, action: input.action }, 'Failed to record audit (best effort)');
  }
}
