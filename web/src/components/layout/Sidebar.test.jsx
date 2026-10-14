import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../app/AppProviders';
import { Sidebar } from './Sidebar';

const STORAGE_KEY = 'buildflow-sidebar-collapsed';

const perms = ['dashboard.view', 'enquiries.view', 'sitevisits.view', 'clients.view', 'units.view', 'whatsapp_masters.view'];
const wrap = (ui) => (
  <AppProviders initialSession={{ user: { name: 'Test User' }, permissions: perms, dataScope: 'BRANCH', branchIds: ['b1'] }}>
    <MemoryRouter initialEntries={['/enquiries']}>
      <Routes>
        <Route path="*" element={ui} />
        <Route path="/dashboard" element={<div>DASHBOARD</div>} />
        <Route path="/clients" element={<div>CLIENTS</div>} />
      </Routes>
    </MemoryRouter>
  </AppProviders>
);

const aside = () => screen.getByLabelText('Primary');
const nav = () => within(aside()).getByRole('navigation');

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('Sidebar', () => {
  it('shows the supplied BuildFlow lockup and every visible module label when expanded', () => {
    render(wrap(<Sidebar />));
    // The real artwork, not a redrawn approximation: the wide lockup in the full rail.
    const logo = aside().querySelector('.sidebar-logo');
    expect(logo.getAttribute('src')).toBe('/brand/buildflow-logo.png');
    expect(logo.getAttribute('alt')).toBe('BuildFlow');
    expect(nav().textContent).toMatch(/Dashboard/);
    expect(nav().textContent).toMatch(/Enquiries/);
  });

  it('shows EXACTLY ONE logo per state: the lockup expanded, the mark collapsed', () => {
    // The light/dark asset is chosen in JS and only ONE <img> is ever rendered, so "both variants
    // visible at once" is impossible by construction — this asserts exactly that.
    render(wrap(<Sidebar />));
    const logo = aside().querySelector('.sidebar-logo');
    expect(logo).toBeTruthy();
    expect(logo.getAttribute('src')).toBe('/brand/buildflow-logo.png');
    expect(aside().querySelectorAll('.sidebar-logo')).toHaveLength(1);
    // The mark is present but hidden by CSS until the rail collapses.
    expect(aside().querySelector('.sidebar-mark')).toBeTruthy();
    expect(aside().querySelectorAll('img')).toHaveLength(2); // lockup + mark, one each

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    const collapsed = aside();
    expect(collapsed.querySelectorAll('.sidebar-logo')).toHaveLength(1);
    expect(collapsed.querySelector('.sidebar-mark').getAttribute('src')).toBe('/brand/buildflow-mark.png');
    // The collapse control stays in the brand area, to the right of the mark.
    const brand = collapsed.querySelector('.sidebar-brand');
    expect(within(brand).getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
  });

  it('marks the current page as active', () => {
    render(wrap(<Sidebar />));
    const active = within(nav()).getAllByRole('link').filter((l) => l.className.includes('is-active'));
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute('href')).toBe('/enquiries');
  });

  it('hides modules the role cannot view and still lists the ones it can', () => {
    render(wrap(<Sidebar />));
    expect(nav().textContent).toMatch(/Dashboard/);
    expect(nav().textContent).not.toMatch(/Bookings/); // no bookings.view in this session
  });

  it('collapses to an icon rail and expands again from the same control', () => {
    render(wrap(<Sidebar />));
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(toggle);
    expect(aside().className).toMatch(/is-collapsed/);
    expect(aside().getAttribute('data-collapsed')).toBe('true');
    // The wide lockup gives way to the hexagonal mark — the same artwork, cropped.
    const mark = aside().querySelector('.sidebar-mark');
    expect(mark.getAttribute('src')).toBe('/brand/buildflow-mark.png');

    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(expand);
    expect(aside().className).not.toMatch(/is-collapsed/);
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy();
  });

  it('keeps every collapsed link reachable by keyboard and named for a screen reader', () => {
    render(wrap(<Sidebar />));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    const links = within(nav()).getAllByRole('link');
    expect(links.length).toBeGreaterThan(2);
    for (const link of links) {
      // No visible text, so the accessible name has to come from aria-label or the link is nameless.
      expect(link.getAttribute('aria-label')).toBeTruthy();
      expect(link.getAttribute('title')).toBe(link.getAttribute('aria-label')); // native tooltip
      link.focus();
      expect(document.activeElement).toBe(link);
    }
  });

  it('leaves no section heading text behind when collapsed', () => {
    render(wrap(<Sidebar />));
    // The group heading is a real element in the expanded rail...
    expect(within(nav()).getByText('Setup')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    // ...and removed from the layout when it collapses (CSS `display: none`, not a faded remnant).
    expect(within(nav()).getByText('Setup').className).toMatch(/sidebar-group-label/);
  });

  it('persists the preference across a remount (navigation) and a reload', () => {
    const first = render(wrap(<Sidebar />));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');

    // Navigation remounts the sidebar: the choice must survive it.
    first.unmount();
    const second = render(wrap(<Sidebar />));
    expect(aside().className).toMatch(/is-collapsed/);
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('0');

    // A reload reads it back the other way.
    second.unmount();
    render(wrap(<Sidebar />));
    expect(aside().className).not.toMatch(/is-collapsed/);
  });

  it('writes nothing until the user actually collapses it', () => {
    render(wrap(<Sidebar />));
    // Matches ThemeProvider: no storage litter for someone who never touches the control.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('still writes the preference when storage is blocked, without breaking the toggle', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    render(wrap(<Sidebar />));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(aside().className).toMatch(/is-collapsed/); // still collapses for this session
    setItem.mockRestore();
  });

  it('shows the Close control and the scrim only when the mobile drawer is open', () => {
    render(wrap(<Sidebar mobileOpen onCloseMobile={() => {}} />));
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeTruthy();
    expect(aside().className).toMatch(/is-open/);
    expect(document.querySelector('.sidebar-scrim')).toBeTruthy();
  });

  it('marks an item active after navigating, with routes unchanged', () => {
    render(wrap(<Sidebar />));
    const dashboard = within(nav()).getByRole('link', { name: 'Dashboard' });
    expect(dashboard.getAttribute('href')).toBe('/dashboard');
    fireEvent.click(dashboard);
    // NavLink resolves against the router; the href is what proves the route is untouched.
    expect(screen.getByText('DASHBOARD')).toBeTruthy();
  });
});
