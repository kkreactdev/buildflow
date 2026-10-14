import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError } from '../../lib/appError';

/**
 * A ScopeGrant is the ONLY thing that lets an operation reach a scoped model.
 * It carries the filter the Mongoose plugin ANDs into every query, so scope
 * can never come from the caller's own filter. Grants are created exclusively
 * by `scopedRepo()` (from an authenticated principal) and `systemRepo()` (an
 * approved, logged system reason). The constructor is guarded so application
 * code cannot fabricate one, and a test pins which files may import this file.
 */
const MINT = Symbol('bf.scope.mint');

export type GrantKind = 'scoped' | 'system';

export class ScopeGrant {
  constructor(
    mint: symbol,
    readonly kind: GrantKind,
    /** Filter merged (via $and) into every query on the model. `{}` = unrestricted within the model. */
    readonly filter: Record<string, unknown>,
    /** Filter for write operations (update/replace/delete). Equals `filter` unless the model is "shared". */
    readonly writeFilter: Record<string, unknown>,
    /** Branches writes may reference. `null` = any (ALL scope / system). */
    readonly allowedBranches: ReadonlySet<string> | null,
    /** Who/why, for logs and error messages. */
    readonly label: string,
  ) {
    if (mint !== MINT) throw new Error('ScopeGrant can only be created by the scope layer');
  }

  static scoped(filter: Record<string, unknown>, writeFilter: Record<string, unknown>, allowedBranches: ReadonlySet<string> | null, label: string): ScopeGrant {
    return new ScopeGrant(MINT, 'scoped', filter, writeFilter, allowedBranches, label);
  }

  static system(reason: string): ScopeGrant {
    return new ScopeGrant(MINT, 'system', {}, {}, null, `system:${reason}`);
  }

  get isSystem(): boolean {
    return this.kind === 'system';
  }
}

/** Raised when an operation reaches a scoped model without a grant: a programming error, so it fails closed. */
export class ScopeRequiredError extends AppError {
  constructor(model: string, op: string) {
    super(
      'SCOPE_REQUIRED',
      500,
      `Refused ${op} on scoped model "${model}" without a scope. Use scopedRepo(Model, principal) (or an approved systemRepo) instead of the bare model.`,
    );
    this.name = 'ScopeRequiredError';
  }
}

/** Query/Aggregate instances carry their grant under this symbol (never in driver options). */
export const GRANT = Symbol('bf.scope.grant');

export function attachGrant<T extends object>(target: T, grant: ScopeGrant): T {
  (target as Record<symbol, unknown>)[GRANT] = grant;
  return target;
}

export function grantOf(target: object): ScopeGrant | undefined {
  const g = (target as Record<symbol, unknown>)[GRANT];
  return g instanceof ScopeGrant ? g : undefined;
}

/**
 * save / insertMany / bulkWrite execute immediately, so their grant travels in
 * async context for the duration of the repo call instead of on an instance.
 */
const store = new AsyncLocalStorage<ScopeGrant>();
export const runWithGrant = <T>(grant: ScopeGrant, fn: () => Promise<T>): Promise<T> => store.run(grant, fn);
export const currentGrant = (): ScopeGrant | undefined => store.getStore();
