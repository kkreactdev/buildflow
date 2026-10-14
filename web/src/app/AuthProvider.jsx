import { useCallback, useEffect, useMemo, useState } from 'react';
import { authToken, setRefreshHandler, setUnauthorizedHandler } from '../api/http';
import { authApi, refreshSession } from '../api/auth';
import { AuthContext } from './authContext';

function toSession(data) {
  return {
    user: data.user,
    permissions: data.permissions ?? [],
    dataScope: data.dataScope ?? null,
    branchIds: data.branchIds ?? [],
  };
}

/**
 * Session state. The access token lives only in memory (see api/http.js); the
 * refresh token is an httpOnly cookie this code never sees. On load we try to
 * renew the session from that cookie, so a page refresh keeps you signed in
 * without any token in localStorage/sessionStorage.
 *
 * Status is 'loading' | 'authenticated' | 'unauthenticated' and everything
 * that is not 'authenticated' grants nothing (fail closed). Permissions here
 * only shape the UI; the API authorizes every request on its own.
 *
 * `initialSession`: undefined = bootstrap from the cookie (the app); null or an
 * object = start in that state without any request (tests).
 */
export function AuthProvider({ children, initialSession }) {
  const [state, setState] = useState(() =>
    initialSession === undefined
      ? { status: 'loading', session: null }
      : initialSession
        ? { status: 'authenticated', session: toSession(initialSession) }
        : { status: 'unauthenticated', session: null },
  );

  const apply = useCallback((data) => {
    authToken.set(data.accessToken);
    setState({ status: 'authenticated', session: toSession(data) });
  }, []);

  const clear = useCallback(() => {
    authToken.set(null);
    setState({ status: 'unauthenticated', session: null });
  }, []);

  const signIn = useCallback(async (email, password) => apply(await authApi.login(email, password)), [apply]);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Even if the server is unreachable, drop local state; the cookie expires on its own.
    }
    clear();
  }, [clear]);

  // Restore the session on first load.
  useEffect(() => {
    if (initialSession !== undefined) return undefined;
    let live = true;
    refreshSession()
      .then((data) => live && apply(data))
      .catch(() => live && clear());
    return () => {
      live = false;
    };
  }, [initialSession, apply, clear]);

  // API layer hooks: silent renewal on an expired access token, forced logout when that fails.
  useEffect(() => {
    setRefreshHandler(async () => {
      try {
        apply(await refreshSession());
        return true;
      } catch {
        return false;
      }
    });
    setUnauthorizedHandler(clear);
    return () => {
      setRefreshHandler(null);
      setUnauthorizedHandler(null);
    };
  }, [apply, clear]);

  const value = useMemo(
    () => ({
      status: state.status,
      user: state.session?.user ?? null,
      permissions: new Set(state.session?.permissions ?? []),
      dataScope: state.session?.dataScope ?? null,
      branchIds: state.session?.branchIds ?? [],
      signIn,
      signOut,
    }),
    [state, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
