import { api } from './http';

// These endpoints are the auth system itself: `auth: false` stops the client from
// trying to refresh/logout on their 401s.
const NO_AUTH = { auth: false };

export const authApi = {
  login: (email, password) => api.post('auth/login', { email, password }, NO_AUTH),
  logout: () => api.post('auth/logout', {}, NO_AUTH),
  me: () => api.get('auth/me'),
  permissionsCatalog: () => api.get('auth/permissions-catalog'),
};

let inflight = null;
/**
 * Single-flight session renewal. Concurrent callers (StrictMode double-mount, several
 * requests expiring together) share ONE request, because refresh tokens rotate and a
 * second use of the same token would look like theft. A server "REFRESH_RACE" (another
 * tab won) is retried once after a beat so this tab picks up the fresh cookie.
 */
export function refreshSession() {
  inflight ??= (async () => {
    try {
      return await api.post('auth/refresh', {}, NO_AUTH);
    } catch (err) {
      if (err?.code === 'REFRESH_RACE') {
        await new Promise((r) => setTimeout(r, 400));
        return api.post('auth/refresh', {}, NO_AUTH);
      }
      throw err;
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
