import type { Model } from 'mongoose';
import { logger } from '../../lib/logger';
import { requestContext } from '../../lib/requestContext';
import { ScopeGrant } from './grant';
import { ScopedRepo, type RepoOptions } from './scopedRepo';

/**
 * Approved reasons an operation may run WITHOUT a data scope. This is the only
 * way to bypass the scope layer; there is deliberately no boolean "skip scope"
 * flag. Each use is logged, and `core/scope/system.test.ts` pins exactly which
 * source files may call `systemRepo`, so adding a new bypass requires a
 * reviewed change to that allow-list.
 */
export const SYSTEM_REASONS = {
  /** Pre-authentication lookups and session bookkeeping (no principal exists yet). */
  auth: 'authentication and session handling',
  /** Idempotent bootstrap seeds. */
  seed: 'bootstrap seed',
  /** One-off data migrations. */
  migration: 'data migration',
  /** Scheduled jobs that act on behalf of the system across branches. */
  job: 'scheduled job',
  /** Global integrity checks (unique email, role still in use) that must see every branch; they reveal existence only. */
  integrity: 'global integrity or uniqueness check',
  /**
   * Cross-branch IDENTITY operations on Person records, which span branches by design: existence-only phone
   * lookups, explicit audited linking of a person to a branch, and keeping client search projections in sync.
   * Only person.service may use it.
   */
  identity: 'cross-branch person identity operation',
  /** Resolving who should receive a notification (ids of users in a branch holding a permission) and the display names put in its text. */
  notify: 'notification recipient resolution',
  /** Append-only business/audit records written by core services; the caller supplies the branch from an already-scoped entity. */
  event: 'activity and audit recording',
  /** Test fixtures; refused outside NODE_ENV=test. */
  test: 'test fixture',
} as const;
export type SystemReason = keyof typeof SYSTEM_REASONS;

export interface SystemScopeEvent {
  reason: SystemReason;
  detail: string;
  model: string;
  requestId?: string;
}

type Listener = (e: SystemScopeEvent) => void;
// High-frequency, low-risk reasons log at debug; privileged bulk reasons at info.
const QUIET: ReadonlySet<SystemReason> = new Set(['auth', 'integrity', 'event', 'notify', 'test']);
const listeners = new Set<Listener>([(e) => logger[QUIET.has(e.reason) ? 'debug' : 'info']({ ...e }, 'system scope used')]);

/** Hook for an audit sink (and for tests). Returns an unsubscribe function. */
export function onSystemScope(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Unrestricted data access for an approved system reason. `detail` says what
 * and where (it appears in the log), e.g. `systemRepo(User, 'auth', 'login lookup')`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function systemRepo<M extends Model<any>>(model: M, reason: SystemReason, detail: string, opts: Omit<RepoOptions, 'requestedBranchId'> = {}): ScopedRepo<M> {
  if (reason === 'test' && process.env.NODE_ENV !== 'test') throw new Error('The "test" system scope is only available in NODE_ENV=test');
  const event: SystemScopeEvent = { reason, detail, model: model.modelName, requestId: requestContext.get()?.requestId };
  for (const l of listeners) l(event);
  return new ScopedRepo(model, ScopeGrant.system(reason), { includeArchived: true, ...opts });
}
