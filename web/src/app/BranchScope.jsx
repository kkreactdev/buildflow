import { useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { BranchScopeContext } from './branchScopeContext';

/**
 * The branch the user is currently *narrowing to* in the UI (null = all of
 * their allowed branches). It is only ever sent as an optional `branchId`
 * filter. The backend derives the real scope from the authenticated user and
 * rejects branches outside it, so this value can never widen access.
 */
export function BranchScopeProvider({ children }) {
  const { branchIds } = useAuth();
  const [selected, setSelected] = useState(null);

  const value = useMemo(
    () => ({
      branchId: selected && (branchIds.length === 0 || branchIds.includes(selected)) ? selected : null,
      setBranchId: setSelected,
      availableBranchIds: branchIds,
    }),
    [selected, branchIds],
  );
  return <BranchScopeContext.Provider value={value}>{children}</BranchScopeContext.Provider>;
}
