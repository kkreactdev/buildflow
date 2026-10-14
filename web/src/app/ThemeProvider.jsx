import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeContext } from './themeContext';
const STORAGE_KEY = 'buildflow-theme';
function getSystemTheme() {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function readStoredMode() {
  if (typeof window === 'undefined') return 'system';
  let stored = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // storage blocked (private mode) — fall back to system theme
  }
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}
export function ThemeProvider({
  children
}) {
  const [mode, setModeState] = useState(readStoredMode);
  const [systemTheme, setSystemTheme] = useState(getSystemTheme);
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemTheme(mql.matches ? 'dark' : 'light');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  const resolvedTheme = mode === 'system' ? systemTheme : mode;
  useEffect(() => {
    const root = document.documentElement;
    if (mode === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', mode);
    }
  }, [mode]);
  const setMode = useCallback(next => {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore: preference just won't persist
    }
  }, []);
  const toggleTheme = useCallback(() => {
    setMode(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setMode]);
  const value = useMemo(() => ({
    mode,
    resolvedTheme,
    setMode,
    toggleTheme
  }), [mode, resolvedTheme, setMode, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}