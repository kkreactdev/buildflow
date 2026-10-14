import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './App';
import { MODULES } from './modules';
import { renderWithApp, session } from '../test/render';

describe('app routing + permission-aware navigation', () => {
  // The dashboard loads data on mount; these tests are about routing, so its requests simply never finish.
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))));
  afterEach(() => vi.unstubAllGlobals());

  it('redirects unauthenticated users to /login', () => {
    renderWithApp(<AppRoutes />, { route: '/enquiries' });
    expect(screen.getByText('Sign in to BuildFlow')).toBeTruthy();
    // The page brands itself with the supplied FULL logo (hexagon + company name), not a generic
    // glyph and not the mark-only image, and exposes it under a real accessible name (the dark twin
    // is decorative, so the pair announces once).
    expect(screen.getByAltText('BuildFlow').getAttribute('src')).toBe('/brand/buildflow-logo.png');
  });

  it('the top header names the product, not the page, so the page heading appears once', () => {
    renderWithApp(<AppRoutes />, { session: session(['dashboard.view', 'enquiries.view']), route: '/enquiries' });
    const header = screen.getByRole('banner');
    expect(header.textContent).toContain('BuildFlow');
    // The header used to repeat the page's own label, printing "Enquiries" twice on screen.
    expect(header.textContent).not.toContain('Enquiries');
    // The rest of the header chrome is untouched by that change.
    expect(within(header).getByRole('combobox', { name: 'Search records' })).toBeTruthy(); // global search
    expect(within(header).getByRole('button', { name: /theme/i })).toBeTruthy();
  });

  it('sidebar lists only modules the user may view', () => {
    renderWithApp(<AppRoutes />, { session: session(['dashboard.view', 'enquiries.view']), route: '/dashboard' });
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByText('Dashboard')).toBeTruthy();
    expect(within(nav).getByText('Enquiries')).toBeTruthy();
    expect(within(nav).queryByText('Reports')).toBeNull();
    expect(within(nav).queryByText('Users')).toBeNull();
    expect(within(nav).queryByText('Setup')).toBeNull(); // empty group hidden
  });

  it('shows the Setup group when an admin permission is held', () => {
    renderWithApp(<AppRoutes />, { session: session(['dashboard.view', 'users.view']), route: '/dashboard' });
    expect(screen.getByText('Setup')).toBeTruthy();
    expect(screen.getByText('Users')).toBeTruthy();
  });

  it('typing a URL for a forbidden module renders the 403 page, not the module', () => {
    renderWithApp(<AppRoutes />, { session: session(['dashboard.view']), route: '/admin/roles' });
    expect(screen.getByText(/don't have access/i)).toBeTruthy();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  it('permitted module renders its page', () => {
    renderWithApp(<AppRoutes />, { session: session(['activities.view']), route: '/activities' });
    expect(screen.getByText(/Activities is coming soon/i)).toBeTruthy();
  });

  it('unknown paths show not-found inside the shell', () => {
    renderWithApp(<AppRoutes />, { session: session(['dashboard.view']), route: '/zzz' });
    expect(screen.getByText('Page not found')).toBeTruthy();
  });

  it('module registry has unique keys/paths and a permission for each module', () => {
    expect(new Set(MODULES.map((m) => m.key)).size).toBe(MODULES.length);
    expect(new Set(MODULES.map((m) => m.path)).size).toBe(MODULES.length);
    for (const m of MODULES) expect(m.permission).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  it('mounts routes element-free outside the registry only for login', () => {
    // Guard against accidentally exposing a module route outside ProtectedRoute.
    renderWithApp(
      <Routes>
        <Route path="*" element={<AppRoutes />} />
      </Routes>,
      { route: '/reports' },
    );
    expect(screen.getByText('Sign in to BuildFlow')).toBeTruthy();
  });
});
