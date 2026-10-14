import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, authToken, setRefreshHandler, setUnauthorizedHandler } from '../api/http';
import { hasPermission } from '../lib/permissions';
import { AppRoutes } from './App';
import { AppProviders } from './AppProviders';

const SESSION = {
  user: { id: 'u1', name: 'Asha Rao', email: 'asha@example.com', roleName: 'Manager' },
  permissions: ['dashboard.view', 'enquiries.view', 'activities.view'],
  dataScope: 'BRANCH',
  branchIds: ['b1'],
  accessToken: 'access-1',
};

const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const err = (status, code, message = code) => jsonRes(status, { error: { code, message } });

/** Routes fetch calls by `METHOD path`; unmatched calls fail loudly. */
function mockApi(routes) {
  const calls = [];
  const fn = vi.fn(async (url, init = {}) => {
    const key = `${init.method ?? 'GET'} ${url.replace('/api/v1', '')}`;
    calls.push({ key, init });
    const handler = routes[key];
    if (!handler) throw new Error(`unmocked ${key}`);
    return typeof handler === 'function' ? handler(init) : handler;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

/** `/activities` is a module whose page has not shipped, so it renders the "coming soon" placeholder these tests look for. */
function renderApp(route = '/activities') {
  return render(
    <AppProviders>
      <MemoryRouter initialEntries={[route]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  authToken.set(null);
  setRefreshHandler(null);
  setUnauthorizedHandler(null);
});

describe('hasPermission', () => {
  it('fails closed and honours the wildcard', () => {
    expect(hasPermission(undefined, 'a.b')).toBe(false);
    expect(hasPermission(new Set(['a.b']), '')).toBe(false);
    expect(hasPermission(new Set(['a.b']), 'a.b')).toBe(true);
    expect(hasPermission(['a.b'], 'a.c')).toBe(false);
    expect(hasPermission(new Set(['*']), 'x.y')).toBe(true);
  });
});

describe('session restore (page load)', () => {
  it('restores the session from the refresh cookie and shows the app; token only in memory', async () => {
    const calls = mockApi({ 'POST /auth/refresh': jsonRes(200, { data: SESSION }) });
    renderApp();
    await screen.findByText(/coming soon/i);
    expect(calls[0].init.credentials).toBe('include'); // cookie sent, never read by JS
    expect(authToken.get()).toBe('access-1');
    // nothing persisted where JavaScript could later read it
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(JSON.stringify(localStorage) + JSON.stringify(sessionStorage)).not.toContain('access-1');
  });

  it('shows nothing protected while loading, then the login page when there is no session', async () => {
    let release;
    mockApi({ 'POST /auth/refresh': () => new Promise((r) => (release = () => r(err(401, 'UNAUTHENTICATED')))) });
    renderApp('/enquiries');
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.queryByText('Sign in to BuildFlow')).toBeNull();
    await act(async () => release());
    await screen.findByText('Sign in to BuildFlow');
    expect(authToken.get()).toBeNull();
  });

  it('a failed/unreachable restore fails closed to login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    renderApp('/dashboard');
    await screen.findByText('Sign in to BuildFlow');
  });

  it('StrictMode-style double bootstrap sends ONE refresh (token rotation safe)', async () => {
    const calls = mockApi({ 'POST /auth/refresh': jsonRes(200, { data: SESSION }) });
    render(
      <AppProviders>
        <AppProviders>
          <MemoryRouter>
            <AppRoutes />
          </MemoryRouter>
        </AppProviders>
      </AppProviders>,
    );
    // The topbar names the product, not the page, so the page is identified by its own content.
    await screen.findByRole('region', { name: 'Welcome' });
    expect(calls.filter((c) => c.key === 'POST /auth/refresh')).toHaveLength(1);
  });
});

describe('login flow', () => {
  it('validates before calling the API', async () => {
    const calls = mockApi({ 'POST /auth/refresh': err(401, 'UNAUTHENTICATED') });
    renderApp('/login');
    await screen.findByText('Sign in to BuildFlow');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email')).toBeTruthy();
    expect(calls.some((c) => c.key === 'POST /auth/login')).toBe(false);
  });

  it('signs in, keeps the token in memory only, and lands on the app', async () => {
    mockApi({ 'POST /auth/refresh': err(401, 'UNAUTHENTICATED'), 'POST /auth/login': jsonRes(200, { data: SESSION }) });
    renderApp('/login');
    await screen.findByText('Sign in to BuildFlow');
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'asha@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'secret-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    // The topbar names the product, not the page, so the page is identified by its own content.
    await screen.findByRole('region', { name: 'Welcome' });
    expect(authToken.get()).toBe('access-1');
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it('shows the server error for bad credentials and stays on the form (no refresh/logout loop)', async () => {
    const calls = mockApi({
      'POST /auth/refresh': err(401, 'UNAUTHENTICATED'),
      'POST /auth/login': err(401, 'INVALID_CREDENTIALS', 'Invalid email or password'),
    });
    renderApp('/login');
    await screen.findByText('Sign in to BuildFlow');
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'asha@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Invalid email or password')).toBeTruthy();
    expect(calls.filter((c) => c.key === 'POST /auth/refresh')).toHaveLength(1); // only the initial restore
  });
});

describe('permission-aware navigation + logout', () => {
  it('shows only permitted modules, guards direct URLs, and logs out', async () => {
    const calls = mockApi({ 'POST /auth/refresh': jsonRes(200, { data: SESSION }), 'POST /auth/logout': jsonRes(204, null) });
    renderApp('/activities');
    await screen.findByText(/Activities is coming soon/i);
    const nav = screen.getByRole('navigation');
    expect(nav.textContent).toContain('Enquiries');
    expect(nav.textContent).not.toContain('Users');

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    fireEvent.click(screen.getByText('Sign out'));
    await screen.findByText('Sign in to BuildFlow');
    expect(calls.some((c) => c.key === 'POST /auth/logout')).toBe(true);
    expect(authToken.get()).toBeNull();
  });

  it('logs out locally even if the logout request fails', async () => {
    mockApi({ 'POST /auth/refresh': jsonRes(200, { data: SESSION }), 'POST /auth/logout': () => Promise.reject(new TypeError('offline')) });
    renderApp('/activities');
    await screen.findByText(/coming soon/i);
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    fireEvent.click(screen.getByText('Sign out'));
    await screen.findByText('Sign in to BuildFlow');
  });

  it('a user without the permission gets 403 UI for a typed URL', async () => {
    mockApi({ 'POST /auth/refresh': jsonRes(200, { data: SESSION }) });
    renderApp('/admin/roles');
    await screen.findByText(/don't have access/i);
  });
});

describe('401 handling in the API client', () => {
  it('renews the session once on an expired access token and replays the request', async () => {
    const refresh = vi.fn(async () => {
      authToken.set('access-2');
      return true;
    });
    setRefreshHandler(refresh);
    const seen = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        seen.push(init.headers.Authorization);
        return seen.length === 1 ? err(401, 'UNAUTHENTICATED') : jsonRes(200, { data: { ok: true } });
      }),
    );
    authToken.set('access-1');
    expect(await api.get('enquiries')).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledOnce();
    expect(seen).toEqual(['Bearer access-1', 'Bearer access-2']);
  });

  it('logs out when renewal fails, and does not loop', async () => {
    const unauthorized = vi.fn();
    setRefreshHandler(async () => false);
    setUnauthorizedHandler(unauthorized);
    const fetchMock = vi.fn(async () => err(401, 'UNAUTHENTICATED'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.get('enquiries')).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after one replay (no infinite refresh loop)', async () => {
    const unauthorized = vi.fn();
    setRefreshHandler(async () => true);
    setUnauthorizedHandler(unauthorized);
    const fetchMock = vi.fn(async () => err(401, 'UNAUTHENTICATED'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.get('enquiries')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(unauthorized).toHaveBeenCalledOnce();
  });

  it('403 neither refreshes nor logs out', async () => {
    const refresh = vi.fn();
    const unauthorized = vi.fn();
    setRefreshHandler(refresh);
    setUnauthorizedHandler(unauthorized);
    vi.stubGlobal('fetch', vi.fn(async () => err(403, 'FORBIDDEN')));
    await expect(api.get('users')).rejects.toMatchObject({ status: 403 });
    expect(refresh).not.toHaveBeenCalled();
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('auth:false requests never trigger refresh/logout', async () => {
    const refresh = vi.fn();
    setRefreshHandler(refresh);
    vi.stubGlobal('fetch', vi.fn(async () => err(401, 'INVALID_CREDENTIALS')));
    await expect(api.post('auth/login', {}, { auth: false })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('REFRESH_RACE retry', () => {
  it('retries once after a multi-tab race and succeeds', async () => {
    vi.useFakeTimers();
    try {
      const { refreshSession } = await import('../api/auth');
      const fetchMock = vi.fn().mockResolvedValueOnce(err(401, 'REFRESH_RACE')).mockResolvedValueOnce(jsonRes(200, { data: SESSION }));
      vi.stubGlobal('fetch', fetchMock);
      const p = refreshSession();
      await vi.advanceTimersByTimeAsync(500);
      expect(await p).toMatchObject({ accessToken: 'access-1' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
