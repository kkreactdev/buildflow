import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../app/App';
import { renderWithApp, session } from '../../test/render';

const ok = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });
const created = (data) => ({ ok: true, status: 201, json: async () => ({ data }) });
const fail = (status, code, message) => ({ ok: false, status, json: async () => ({ error: { code, message } }) });

const PNG = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'logo.png', { type: 'image/png' });

const BRANDING = { displayName: 'Northwind Realty', logo: 'https://cdn/logo.png', logoDark: 'https://cdn/logo-dark.png', mark: 'https://cdn/mark.png', markDark: null };
const EMPTY_BRANDING = { displayName: '', logo: null, logoDark: null, mark: null, markDark: null };
const PROFILE = { displayName: 'Northwind Realty', legalName: '', phone: '', email: '', address: '', website: '', gstin: '', logo: { url: 'https://cdn/logo.png', format: 'png', bytes: 2048 }, logoDark: null, mark: { url: 'https://cdn/mark.png', format: 'png', bytes: 512 }, markDark: null };

const calls = [];
const state = { branding: BRANDING, profile: PROFILE, uploadStatus: 201 };

function mockApi() {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace('/api/v1', '');
    calls.push(`${method} ${path}`);
    if (path === '/company/branding') return ok(state.branding);
    if (path === '/company' && method === 'GET') return ok(state.profile);
    if (path === '/company' && method === 'PATCH') {
      const body = JSON.parse(init.body);
      state.profile = { ...state.profile, ...body };
      // The real server serves the saved name back on the next branding read; mirror that, so the
      // test proves the invalidation actually re-fetches rather than just calling something.
      state.branding = { ...state.branding, displayName: body.displayName };
      return ok(state.profile);
    }
    if (method === 'POST' && path.startsWith('/company/logo/')) return created(state.profile);
    if (method === 'DELETE' && path.startsWith('/company/logo/')) return ok({ ...state.profile, logo: null, mark: null });
    return ok([]);
  }));
}

const admin = session(['company.view', 'company.manage'], { dataScope: 'ALL' });
const viewer = session(['company.view'], { dataScope: 'ALL' });
/**
 * renderWithApp provides the providers and the router — including the app's single QueryClient.
 *
 * Deliberately NOT wrapped in a second client: the branding query and the settings mutations must live
 * on the SAME client for an invalidation to reach both, and that is exactly what production does. A
 * test-only client would hide the wiring this feature depends on.
 */
const show = (s, route = '/admin/company') => renderWithApp(<AppRoutes />, { session: s, route });

beforeEach(() => {
  state.branding = BRANDING;
  state.profile = PROFILE;
  state.uploadStatus = 201;
  // The theme toggle test flips the theme, and ThemeProvider persists it. Without clearing, every
  // later test would silently start in dark mode and assert against the wrong asset.
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => vi.unstubAllGlobals());

describe('company branding across the app', () => {
  it('the sidebar, header and login page all show the saved company name and logo', async () => {
    mockApi();
    show(admin);
    // Header.
    await waitFor(() => expect(screen.getByText('Northwind Realty', { selector: '.topbar-title' })).toBeTruthy());
    // Sidebar: the lockup, from the saved profile rather than the bundled fallback.
    const lockup = document.querySelector('.sidebar-logo');
    await waitFor(() => expect(lockup.getAttribute('src')).toBe('https://cdn/logo.png'));
    expect(lockup.getAttribute('alt')).toBe('Northwind Realty');
    // …and the mark, which the collapsed rail uses.
    expect(document.querySelector('.sidebar-mark').getAttribute('src')).toBe('https://cdn/mark.png');
  });

  it('falls back to the bundled BuildFlow artwork when no profile is configured', async () => {
    state.branding = EMPTY_BRANDING;
    mockApi();
    show(admin);
    await waitFor(() => expect(document.querySelector('.sidebar-logo').getAttribute('src')).toBe('/brand/buildflow-logo.png'));
    expect(screen.getByText('BuildFlow', { selector: '.topbar-title' })).toBeTruthy();
  });

  it('uses the dark asset when the dark theme is selected', async () => {
    mockApi();
    show(admin);
    await waitFor(() => expect(document.querySelector('.sidebar-logo').getAttribute('src')).toBe('https://cdn/logo.png'));
    fireEvent.click(screen.getByRole('button', { name: /switch to dark theme/i }));
    await waitFor(() => expect(document.querySelector('.sidebar-logo').getAttribute('src')).toBe('https://cdn/logo-dark.png'));
  });

  it('falls back from a missing dark mark to the light one', async () => {
    state.branding = { ...BRANDING, markDark: null };
    mockApi();
    show(admin);
    await waitFor(() => expect(document.querySelector('.sidebar-mark').getAttribute('src')).toBe('https://cdn/mark.png'));
    fireEvent.click(screen.getByRole('button', { name: /switch to dark theme/i }));
    // markDark is null, so the branding provider falls back rather than rendering a broken image.
    await waitFor(() => expect(document.querySelector('.sidebar-mark').getAttribute('src')).toBe('https://cdn/mark.png'));
  });

  it('brands the login page before anyone has signed in', async () => {
    state.branding = BRANDING;
    mockApi();
    show(null, '/login');
    expect(await screen.findByRole('heading', { name: 'Sign in to Northwind Realty' })).toBeTruthy();
    await waitFor(() => expect(document.querySelector('.login-logo').getAttribute('src')).toBe('https://cdn/logo.png'));
  });

  it('never shows the lockup and the mark at the same time', async () => {
    mockApi();
    show(admin);
    await waitFor(() => expect(document.querySelector('.sidebar-logo')).toBeTruthy());
    // One <img> per variant: the pair is never duplicated, so CSS alone decides which shows.
    expect(document.querySelectorAll('.sidebar-logo')).toHaveLength(1);
    expect(document.querySelectorAll('.sidebar-mark')).toHaveLength(1);
  });
});

describe('company settings screen', () => {
  it('shows the current details and previews each uploaded logo', async () => {
    mockApi();
    show(admin);
    expect(await screen.findByLabelText(/^Company name/)).toBeTruthy();
    expect(screen.getByLabelText(/^Company name/).value).toBe('Northwind Realty');
    // Prefixes show the saved artwork for the slots that have one.
    expect(within(screen.getByLabelText('Upload Full logo').closest('.logo-field')).getByAltText('Full logo preview').getAttribute('src')).toBe('https://cdn/logo.png');
    // …and say so plainly for the slots that do not (both dark variants are empty here).
    expect(screen.getAllByText('Not set')).toHaveLength(2);
  });

  it('saves the company name and refreshes the branding everywhere without a reload', async () => {
    mockApi();
    show(admin);
    const name = await screen.findByLabelText(/^Company name/);
    fireEvent.change(name, { target: { value: 'Northwind Realty Pvt Ltd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));

    await waitFor(() => expect(calls).toContain('PATCH /company'));
    // The save invalidates branding, so the header picks the new name up in place.
    await waitFor(() => expect(screen.getByText('Northwind Realty Pvt Ltd', { selector: '.topbar-title' })).toBeTruthy());
  });

  it('validates before calling the API', async () => {
    mockApi();
    show(admin);
    const name = await screen.findByLabelText(/^Company name/);
    fireEvent.change(name, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(await screen.findByText('Enter the company name')).toBeTruthy();
    expect(calls).not.toContain('PATCH /company');
  });

  it('surfaces the server error when a save is refused', async () => {
    mockApi();
    show(admin);
    const name = await screen.findByLabelText(/^Company name/);
    fireEvent.change(name, { target: { value: 'X' } });
    const post = vi.stubGlobal;
    post('fetch', vi.fn(async (url, init = {}) => {
      const path = url.replace('/api/v1', '');
      calls.push(`${init.method ?? 'GET'} ${path}`);
      if (path === '/company/branding') return ok(state.branding);
      if (path === '/company' && (init.method ?? 'GET') === 'GET') return ok(state.profile);
      if (init.method === 'PATCH') return fail(409, 'CONFLICT', 'The company profile is locked');
      return ok([]);
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The company profile is locked');
  });

  it('uploads a replacement logo and shows the server error when the file is refused', async () => {
    mockApi();
    show(admin);
    const input = await screen.findByLabelText('Upload Icon / mark');
    await waitFor(() => expect(input).toBeTruthy());

    // Refused first, so the failure path is what the UI has to show.
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      const path = url.replace('/api/v1', '');
      calls.push(`${init.method ?? 'GET'} ${path}`);
      if (path === '/company/branding') return ok(state.branding);
      if (path === '/company' && (init.method ?? 'GET') === 'GET') return ok(state.profile);
      if (init.method === 'POST') return fail(415, 'UNSUPPORTED_FILE_TYPE', 'A logo must be a JPEG, PNG or WebP image');
      return ok([]);
    }));
    fireEvent.change(input, { target: { files: [PNG] } });
    expect(await screen.findByText('A logo must be a JPEG, PNG or WebP image')).toBeTruthy();
  });

  it('shows an error state and a retry when the profile cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const path = url.replace('/api/v1', '');
      if (path === '/company/branding') return ok(state.branding);
      if (path === '/company') return fail(500, 'INTERNAL', 'The profile could not be loaded');
      return ok([]);
    }));
    show(admin);
    // The app's client retries a failed query three times with backoff before surfacing the error,
    // which is correct in production; the test waits it out rather than disabling it.
    expect(await screen.findByText('The profile could not be loaded', {}, { timeout: 15000 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    // Generous timeout: three retries with backoff have to elapse before the error can surface.
  }, 20000);

  it('is hidden from navigation without the permission, and read-only with view only', async () => {
    mockApi();
    const neither = session(['branches.view'], { dataScope: 'ALL' });
    show(neither, '/admin/branches');
    expect(screen.queryByRole('link', { name: 'Company Settings' })).toBeNull();
    vi.unstubAllGlobals();
    mockApi();
    show(viewer);
    expect(await screen.findByLabelText(/^Company name/)).toBeTruthy();
    // Read-only: no file inputs and no save button, but the details are visible.
    expect(screen.queryByLabelText('Upload Full logo')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save details' })).toBeNull();
    expect(screen.getByText('You can view these details but not change them.')).toBeTruthy();
  });
});