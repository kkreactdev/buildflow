import { screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp, session } from '../../test/render';
import { UsersPage } from './UsersPage';
import { RolesPage } from './RolesPage';

const ok = (data, meta) => ({ ok: true, status: 200, json: async () => ({ data, ...(meta ? { meta } : {}) }) });

function mock() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      if (url.includes('/users')) return ok([{ id: 'u1', name: 'Asha', email: 'a@x.com', roleName: 'Manager', branchIds: [], isActive: true }], { page: 1, limit: 25, total: 1 });
      if (url.includes('/roles')) return ok([{ _id: 'r1', name: 'Manager', permissions: ['a.b'], dataScope: 'BRANCH', isSystem: true, isActive: true }], { page: 1, limit: 100, total: 1 });
      return ok([], { page: 1, limit: 100, total: 0 });
    }),
  );
}
const wrap = (ui) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;

afterEach(() => vi.unstubAllGlobals());

describe('admin pages are permission-aware (UX only; the API enforces too)', () => {
  it('Users: "New user" and "Edit" appear only with users.create / users.edit', async () => {
    mock();
    const { unmount } = renderWithApp(wrap(<UsersPage />), { session: session(['users.view']) });
    await screen.findByText('Asha');
    expect(screen.queryByRole('button', { name: 'New user' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull(); // no visible actions -> no menu
    unmount();

    renderWithApp(wrap(<UsersPage />), { session: session(['users.view', 'users.create', 'users.edit']) });
    await screen.findByText('Asha');
    expect(screen.getByRole('button', { name: 'New user' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Actions' })).toBeTruthy();
  });

  it('Roles: management controls require roles.manage', async () => {
    mock();
    const { unmount } = renderWithApp(wrap(<RolesPage />), { session: session(['roles.view']) });
    await screen.findAllByText('Manager');
    expect(screen.queryByRole('button', { name: 'New role' })).toBeNull();
    unmount();
    renderWithApp(wrap(<RolesPage />), { session: session(['roles.view', 'roles.manage']) });
    await screen.findAllByText('Manager');
    expect(screen.getByRole('button', { name: 'New role' })).toBeTruthy();
  });
});
