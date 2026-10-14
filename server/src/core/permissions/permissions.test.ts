import { describe, expect, it } from 'vitest';
import { AppError } from '../../lib/appError';
import { ALL_PERMISSION_KEYS, isGrantable, isPermissionKey, WILDCARD } from './catalog';
import { assertPermission, hasPermission, type Principal } from './principal';

const principal = (perms: string[]): Principal => ({
  userId: '64b000000000000000000001',
  permissions: new Set(perms),
  dataScope: 'BRANCH',
  branchIds: [],
});

describe('permission catalog', () => {
  it('contains the keys the architecture requires and no duplicates', () => {
    for (const k of ['enquiries.revert', 'bookings.resolve_conflict', 'units.assign', 'masters.manage', 'users.view', 'users.create', 'users.edit', 'roles.view', 'roles.manage', 'branches.view', 'branches.manage']) {
      expect(isPermissionKey(k)).toBe(true);
    }
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length);
  });
  it('validates grantable values', () => {
    expect(isGrantable(WILDCARD)).toBe(true);
    expect(isGrantable('enquiries.view')).toBe(true);
    expect(isGrantable('enquiries.fly')).toBe(false);
  });
});

describe('hasPermission / assertPermission', () => {
  it('is false without a principal (fail closed)', () => {
    expect(hasPermission(undefined, 'enquiries.view')).toBe(false);
  });
  it('checks keys, never names', () => {
    expect(hasPermission(principal(['enquiries.view']), 'enquiries.view')).toBe(true);
    expect(hasPermission(principal(['enquiries.view']), 'enquiries.edit')).toBe(false);
  });
  it('wildcard grants everything', () => {
    expect(hasPermission(principal([WILDCARD]), 'roles.manage')).toBe(true);
  });
  it('throws 401 without a principal and 403 without the key', () => {
    expect(() => assertPermission(undefined, 'enquiries.view')).toThrow(AppError);
    try {
      assertPermission(principal([]), 'enquiries.view');
    } catch (e) {
      expect((e as AppError).httpStatus).toBe(403);
    }
  });
});
