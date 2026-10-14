import { beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '../config/env';
import { ALL_PERMISSION_KEYS } from '../core/permissions/catalog';
import { Role } from '../modules/roles/role.model';
import { Users } from '../test/factories';
import { useTestDb } from '../test/db';
import { seedAdmin } from './seedAdmin';
import { seedRoles } from './seedRoles';
import { SYSTEM_ROLES } from './systemRoles';

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  return async () => {
    const prev = { ...process.env };
    Object.assign(process.env, vars);
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
    resetEnvCache();
    try {
      await fn();
    } finally {
      process.env = prev;
      resetEnvCache();
    }
  };
}

describe('system role definitions', () => {
  it('only reference real catalog permissions (or the wildcard)', () => {
    for (const r of SYSTEM_ROLES) for (const p of r.permissions) expect(p === '*' || (ALL_PERMISSION_KEYS as readonly string[]).includes(p)).toBe(true);
  });
  it('Super Admin is the only wildcard holder; Sales Executive is OWN and Manager is BRANCH', () => {
    expect(SYSTEM_ROLES.filter((r) => r.permissions.includes('*')).map((r) => r.key)).toEqual(['SUPER_ADMIN']);
    expect(SYSTEM_ROLES.find((r) => r.key === 'SALES_EXECUTIVE')!.dataScope).toBe('OWN');
    expect(SYSTEM_ROLES.find((r) => r.key === 'MANAGER')!.dataScope).toBe('BRANCH');
    const sales = SYSTEM_ROLES.find((r) => r.key === 'SALES_EXECUTIVE')!.permissions;
    expect(sales).not.toContain('enquiries.revert');
    expect(sales).not.toContain('bookings.release');
    expect(SYSTEM_ROLES.find((r) => r.key === 'MANAGER')!.permissions).toEqual(expect.arrayContaining(['enquiries.revert', 'bookings.release', 'bookings.resolve_conflict']));
  });
});

describe('seeding is idempotent', () => {
  useTestDb();
  beforeEach(() => undefined);

  it('seeds the four roles once, with no duplicates after repeated runs', async () => {
    const first = await seedRoles();
    expect(first.created).toHaveLength(4);
    for (let i = 0; i < 3; i++) expect((await seedRoles()).created).toEqual([]);
    expect(await Role.countDocuments()).toBe(4);
    expect((await Role.find().lean()).map((r) => r.key).sort()).toEqual(['ADMIN', 'MANAGER', 'SALES_EXECUTIVE', 'SUPER_ADMIN']);
  });

  it('does not overwrite admin customisations, except it re-asserts Super Admin', async () => {
    await seedRoles();
    await Role.updateOne({ key: 'MANAGER' }, { permissions: ['dashboard.view'] });
    await Role.updateOne({ key: 'SUPER_ADMIN' }, { permissions: ['dashboard.view'], dataScope: 'OWN' });
    await seedRoles();
    expect((await Role.findOne({ key: 'MANAGER' }))!.permissions).toEqual(['dashboard.view']);
    const sa = await Role.findOne({ key: 'SUPER_ADMIN' });
    expect(sa!.permissions).toEqual(['*']);
    expect(sa!.dataScope).toBe('ALL');
  });

  it('creates exactly one admin from env, never changes it, and skips without credentials', async () => {
    await seedRoles();
    await withEnv({ SEED_ADMIN_EMAIL: undefined, SEED_ADMIN_PASSWORD: undefined }, async () => {
      expect(await seedAdmin()).toBe('skipped-no-credentials');
    })();
    expect(await Users.countDocuments()).toBe(0);

    await withEnv({ SEED_ADMIN_EMAIL: 'Root@Example.com', SEED_ADMIN_PASSWORD: 'Dev-Only-Passw0rd!' }, async () => {
      expect(await seedAdmin()).toBe('created');
      const before = await Users.findOne().select('+passwordHash').lean();
      expect(before!.email).toBe('root@example.com');
      expect(before!.passwordHash).not.toContain('Dev-Only');
      expect(await seedAdmin()).toBe('exists');
      expect(await seedAdmin()).toBe('exists');
      expect(await Users.countDocuments()).toBe(1);
      const after = await Users.findOne().select('+passwordHash').lean();
      expect(after!.passwordHash).toBe(before!.passwordHash); // password not reset
    })();
  });

  it('refuses to seed an admin if the role is missing', async () => {
    await withEnv({ SEED_ADMIN_EMAIL: 'a@example.com', SEED_ADMIN_PASSWORD: 'Dev-Only-Passw0rd!' }, async () => {
      expect(await seedAdmin()).toBe('skipped-no-role');
    })();
  });
});
