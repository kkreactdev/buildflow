import { isValidObjectId, Types } from 'mongoose';
import { AppError } from '../../lib/appError';
import type { Principal } from '../permissions/principal';

/**
 * How a model relates to branches and people. Declared once per model (see
 * `scopePlugin`); nothing here is read from a request.
 */
export interface ScopeSpec {
  /** Field holding the owning branch (`branchId`), an array of branches (`branchIds`), or `_id` for the Branch collection itself. */
  branchField: string;
  /**
   * Field holding the assigned/owning employee (e.g. `assignedTo`). Under OWN
   * scope the actor only sees records where it equals their user id. The name
   * differs per module, so it is declared per model, never assumed.
   */
  ownerField?: string;
  /**
   * Records that ARE the actor (the User collection's `_id`) stay visible to
   * them. Under OWN this is the only condition; under BRANCH it is OR-ed in.
   */
  selfField?: string;
  /**
   * "Shared" collections (e.g. masters) mix global records (no branch) with
   * branch-owned ones. Global records are READABLE by everyone in scope but only
   * WRITABLE by ALL scope; branch-owned records follow the normal rules.
   */
  shared?: boolean;
}

export interface ScopeOptions {
  /** Optional narrowing requested by the client (`?branchId=`). Validated, can only narrow. */
  requestedBranchId?: string;
}

function oid(value: string, what: string): Types.ObjectId {
  if (!isValidObjectId(value)) throw AppError.validation(`Invalid ${what}`);
  return new Types.ObjectId(value);
}

/** Branch ids the actor may touch; `null` means every branch (ALL scope). */
export function allowedBranchSet(principal: Principal): ReadonlySet<string> | null {
  return principal.dataScope === 'ALL' ? null : new Set(principal.branchIds);
}

function build(principal: Principal, spec: Partial<ScopeSpec> & ScopeOptions, forWrite: boolean): Record<string, unknown> {
  const { branchField = 'branchId', ownerField, selfField, shared, requestedBranchId } = spec;
  const requested = requestedBranchId ? oid(requestedBranchId, 'branchId') : undefined;
  const withGlobal = (cond: Record<string, unknown>) => (shared && !forWrite ? { $or: [cond, { [branchField]: null }] } : cond);

  if (principal.dataScope === 'ALL') return requested ? withGlobal({ [branchField]: requested }) : {};

  const allowed = principal.branchIds.map((b) => oid(b, 'branch id on principal'));
  if (requested && !allowed.some((a) => a.equals(requested))) {
    throw AppError.forbidden('You do not have access to that branch');
  }
  const branchCond: Record<string, unknown> = { [branchField]: requested ?? { $in: allowed } }; // empty list matches nothing
  const self = selfField ? { [selfField]: oid(principal.userId, 'user id on principal') } : undefined;

  if (principal.dataScope === 'OWN') {
    if (self) return requested ? { ...self, ...branchCond } : self;
    return withGlobal(ownerField ? { ...branchCond, [ownerField]: oid(principal.userId, 'user id on principal') } : branchCond);
  }
  // BRANCH
  if (self && !requested) return { $or: [branchCond, self] };
  return withGlobal(branchCond);
}

/**
 * Builds the Mongo filter restricting a READ to what `principal` may see. The
 * principal comes from the database (never the request); the client can only
 * narrow within its allowed branches and is refused (403) otherwise.
 */
export function resolveScope(principal: Principal, spec: Partial<ScopeSpec> & ScopeOptions = {}): Record<string, unknown> {
  return build(principal, spec, false);
}

/** Filter restricting WRITES. Identical to reads except shared/global records are excluded for non-ALL actors. */
export function resolveWriteScope(principal: Principal, spec: Partial<ScopeSpec> & ScopeOptions = {}): Record<string, unknown> {
  return build(principal, spec, true);
}

/** Guards writes: the target branch must be inside the actor's scope. */
export function assertBranchWritable(principal: Principal, branchId: string): void {
  if (principal.dataScope === 'ALL') return;
  if (!principal.branchIds.includes(branchId)) {
    throw AppError.forbidden('You do not have access to that branch');
  }
}

/**
 * Picks the branch for a NEW branch-owned record. The client may suggest one,
 * but it is validated against the principal; when omitted it is derived from
 * the principal's single branch. Ambiguity is an error, never a guess.
 */
export function resolveWriteBranch(principal: Principal, requested?: string): string {
  if (requested) {
    if (!isValidObjectId(requested)) throw AppError.validation('Invalid branchId');
    assertBranchWritable(principal, requested);
    return requested;
  }
  if (principal.dataScope !== 'ALL' && principal.branchIds.length === 1) return principal.branchIds[0]!;
  throw AppError.validation('branchId is required', [{ path: 'branchId', message: 'Choose a branch' }]);
}
