import { createContext, useContext } from 'react';

export const BranchScopeContext = createContext(null);

export function useBranchScope() {
  const ctx = useContext(BranchScopeContext);
  if (!ctx) throw new Error('useBranchScope must be used within BranchScopeProvider');
  return ctx;
}
