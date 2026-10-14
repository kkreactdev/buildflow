import type { Principal } from '../../core/permissions/principal';

/**
 * A timeline is requested BY ENTITY (`refType` + `refId`). Knowing an id must
 * never be enough to read its timeline, so each entity type registers a check
 * that the principal may see that entity (through the entity's own scoped
 * repository). Types without a registered authorizer cannot be queried at all
 * (fail closed). Business modules register theirs when they ship.
 */
export type RefAuthorizer = (principal: Principal, id: string) => Promise<boolean>;

const authorizers = new Map<string, RefAuthorizer>();

export function registerRefAuthorizer(refType: string, fn: RefAuthorizer): void {
  authorizers.set(refType, fn);
}
export const getRefAuthorizer = (refType: string): RefAuthorizer | undefined => authorizers.get(refType);
/** Test helper: remove one registration (the built-in `user` one must survive between tests). */
export const unregisterRefAuthorizer = (refType: string): void => void authorizers.delete(refType);
