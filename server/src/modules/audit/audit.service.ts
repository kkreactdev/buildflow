import type { z } from 'zod';
import { AuditLog } from '../../core/audit/audit.model';
import type { Principal } from '../../core/permissions/principal';
import { scopedRepo } from '../../core/scope';
import { AppError } from '../../lib/appError';
import { toObjectId } from '../../lib/ids';
import { toMeta, toWindow } from '../../lib/listQuery';
import type { listAuditQuery } from './audit.schema';

const SENSITIVE_KEY = /password|passwd|secret|token|hash|authorization|cookie|credential|api[-_]?key/i;
export const REDACTED = '[redacted]';

/**
 * Defence in depth: the write path already redacts sensitive field values, and
 * this pass scrubs again on the way out in case something slipped in (e.g. a
 * nested object or a future field). Keys are matched, values are replaced.
 */
export function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object' && !(value instanceof Date) && !('toHexString' in value)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? REDACTED : sanitize(v)]));
  }
  return value;
}

type Row = { _id: unknown; entityType: string; entityId: unknown; action: string; changes?: unknown; userId?: unknown; branchId?: unknown; reason?: string; requestId?: string; at: Date };
const view = (r: Row) => ({ id: r._id, entityType: r.entityType, entityId: r.entityId, action: r.action, changes: sanitize(r.changes ?? {}), userId: r.userId, branchId: r.branchId, reason: r.reason, requestId: r.requestId, at: r.at });

/** Reads are branch-scoped; entries without a branch (users, roles, masters, workflow) are visible to ALL scope only. */
export async function listAudit(principal: Principal, q: z.infer<typeof listAuditQuery>) {
  const filter: Record<string, unknown> = {};
  if (q.entityType) filter.entityType = q.entityType;
  if (q.entityId) filter.entityId = toObjectId(q.entityId);
  if (q.userId) filter.userId = toObjectId(q.userId);
  if (q.action) filter.action = q.action;
  if (q.from || q.to) filter.at = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  const repo = scopedRepo(AuditLog, principal, { requestedBranchId: q.branchId });
  const { skip, limit } = toWindow(q);
  const [rows, total] = await Promise.all([
    repo.find(filter).sort({ at: -1, _id: -1 }).skip(skip).limit(limit).lean<Row[]>(),
    repo.countDocuments(filter),
  ]);
  return { rows: rows.map(view), meta: toMeta(q, total) };
}

export async function getAudit(principal: Principal, id: string) {
  const row = await scopedRepo(AuditLog, principal).findById(id).lean<Row>();
  if (!row) throw AppError.notFound('Audit entry not found');
  return view(row);
}
