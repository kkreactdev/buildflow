import { screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '../app/AppProviders';
import { PermissionGate as Can } from '../components/auth/PermissionGate';
import { renderWithApp, session } from '../test/render';
import { usePermissions } from './usePermissions';

const wrap = (s) => ({ children }) => <AppProviders initialSession={s}>{children}</AppProviders>;

describe('usePermissions', () => {
  it('fails closed when unauthenticated, even for wildcard-looking input', () => {
    const { result } = renderHook(() => usePermissions(), { wrapper: wrap(null) });
    expect(result.current.can('enquiries.view')).toBe(false);
    expect(result.current.can(undefined)).toBe(false);
    expect(result.current.canAny(['a.b'])).toBe(false);
  });

  it('checks permission keys', () => {
    const { result } = renderHook(() => usePermissions(), { wrapper: wrap(session(['enquiries.view'])) });
    expect(result.current.can('enquiries.view')).toBe(true);
    expect(result.current.can('enquiries.edit')).toBe(false);
    expect(result.current.canAny(['enquiries.edit', 'enquiries.view'])).toBe(true);
    expect(result.current.canAll(['enquiries.edit', 'enquiries.view'])).toBe(false);
    expect(result.current.canAll([])).toBe(false);
  });

  it('wildcard grants everything', () => {
    const { result } = renderHook(() => usePermissions(), { wrapper: wrap(session(['*'])) });
    expect(result.current.can('roles.manage')).toBe(true);
  });

  it('does not grant by role name', () => {
    const { result } = renderHook(() => usePermissions(), { wrapper: wrap({ ...session([]), user: { name: 'Admin', role: 'Super Admin' } }) });
    expect(result.current.can('roles.manage')).toBe(false);
  });
});

describe('<PermissionGate>', () => {
  it('renders children only when permitted, else fallback', () => {
    renderWithApp(
      <>
        <Can perm="enquiries.edit">edit-button</Can>
        <Can perm="enquiries.view" fallback={<span>nope</span>}>view-button</Can>
        <Can perm="units.view" fallback={<span>no-units</span>}>units</Can>
      </>,
      { session: session(['enquiries.view']) },
    );
    expect(screen.queryByText('edit-button')).toBeNull();
    expect(screen.getByText('view-button')).toBeTruthy();
    expect(screen.getByText('no-units')).toBeTruthy();
  });
});
