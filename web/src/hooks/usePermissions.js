import { useMemo } from 'react';
import { hasPermission } from '../lib/permissions';
import { useAuth } from './useAuth';

/**
 * Permission checks against permission KEYS (never role names), e.g.
 * `can('enquiries.assign')`. Fail-closed: unauthenticated, or an empty/absent
 * key, is always false. Cosmetic only — the API enforces permissions itself.
 */
export function usePermissions() {
  const { status, permissions, dataScope, branchIds, user } = useAuth();

  return useMemo(() => {
    const authed = status === 'authenticated';
    const can = (key) => authed && hasPermission(permissions, key);
    return {
      can,
      canAny: (keys) => keys.some(can),
      canAll: (keys) => keys.length > 0 && keys.every(can),
      dataScope,
      branchIds,
      userId: user?.id ?? null,
    };
  }, [status, permissions, dataScope, branchIds, user]);
}
