import { AppError } from '../../lib/appError';
import { WILDCARD } from './catalog';
import type { DataScope, Principal } from './principal';

const SCOPE_RANK: Record<DataScope, number> = { OWN: 0, BRANCH: 1, ALL: 2 };

/**
 * Anti-escalation: an actor can only hand out what they hold. Without this, a
 * user with `roles.manage` or `users.edit` could grant themselves (or a friend)
 * every permission. Wildcard holders (Super Admin) may grant anything.
 */
export function assertCanGrant(actor: Principal, permissions: readonly string[], dataScope: DataScope): void {
  if (!actor.permissions.has(WILDCARD)) {
    const missing = permissions.filter((p) => p === WILDCARD || !actor.permissions.has(p));
    if (missing.length) {
      throw AppError.forbidden(`You cannot grant permissions you do not hold: ${missing.join(', ')}`);
    }
  }
  if (SCOPE_RANK[dataScope] > SCOPE_RANK[actor.dataScope]) {
    throw AppError.forbidden('You cannot grant a broader data scope than your own');
  }
}
