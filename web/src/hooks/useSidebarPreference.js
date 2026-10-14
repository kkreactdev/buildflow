import { useCallback, useState } from 'react';

const STORAGE_KEY = 'buildflow-sidebar-collapsed';

/**
 * Whether the sidebar is collapsed. Persisted in localStorage so the choice survives a reload and a
 * navigation (the sidebar is remounted per route, so without storage it would snap back open).
 *
 * Nothing is written until the user actually toggles — matching ThemeProvider, which also only writes
 * on a deliberate change. It keeps the "no credentials in storage" test honest and avoids littering
 * storage for people who never collapse the rail.
 *
 * Reads are guarded because Safari private mode throws on access, and a blocked write costs only
 * persistence, never the current session.
 */
function readStored() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function useSidebarPreference() {
  const [collapsed, setCollapsedState] = useState(readStored);

  const setCollapsed = useCallback((next) => {
    setCollapsedState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // storage blocked: the rail still collapses for this session, it just will not be remembered
    }
  }, []);

  const toggle = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);

  return { collapsed, setCollapsed, toggle };
}
