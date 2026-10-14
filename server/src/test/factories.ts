import type { Express } from 'express';
import request from 'supertest';
import { Activity } from '../core/activity/activity.model';
import { AuditLog } from '../core/audit/audit.model';
import type { Principal } from '../core/permissions/principal';
import { systemRepo } from '../core/scope/system';
import { hashPassword } from '../modules/auth/auth.service';
import { Branch } from '../modules/branches/branch.model';
import { Role } from '../modules/roles/role.model';
import { User } from '../modules/users/user.model';
import { seedMasters } from '../seeds/seedMasters';
import { seedRoles } from '../seeds/seedRoles';
import { seedWorkflow } from '../seeds/seedWorkflow';

export const PASSWORD = 'Correct-Horse-9';

/** Unscoped fixture access for tests (the 'test' system reason only exists under NODE_ENV=test). */
export const Users = systemRepo(User, 'test', 'test fixtures');
export const Branches = systemRepo(Branch, 'test', 'test fixtures');
export const AuditLogs = systemRepo(AuditLog, 'test', 'test fixtures');
export const Activities = systemRepo(Activity, 'test', 'test fixtures');

export async function seedSystemRoles(): Promise<void> {
  await seedRoles();
}

/** Roles + masters + workflow stages: the configuration a fresh install has after `npm run seed`. */
export async function seedAll(): Promise<void> {
  await seedRoles();
  await seedMasters();
  await seedWorkflow();
}

/** A principal for service-level tests (no HTTP). */
export function principalWith(dataScope: Principal['dataScope'], permissions: string[], branchIds: string[] = [], userId = '64b0000000000000000000a1'): Principal {
  return { userId, permissions: new Set(permissions), dataScope, branchIds };
}

export async function makeBranch(code: string, extra: Record<string, unknown> = {}) {
  return Branches.create({ name: `Branch ${code}`, code, ...extra });
}

export async function makeUser(opts: { roleKey: string; email?: string; branches?: string[]; password?: string; isActive?: boolean; name?: string }) {
  const role = await Role.findOne({ key: opts.roleKey });
  if (!role) throw new Error(`role ${opts.roleKey} not seeded`);
  const email = opts.email ?? `${opts.roleKey.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const user = await Users.create({
    name: opts.name ?? opts.roleKey,
    email,
    passwordHash: await hashPassword(opts.password ?? PASSWORD),
    roleId: role._id,
    branchIds: opts.branches ?? [],
    primaryBranchId: opts.branches?.[0],
    isActive: opts.isActive ?? true,
  });
  return { user, email, password: opts.password ?? PASSWORD };
}

export interface LoggedIn {
  token: string;
  cookie: string;
  auth: { Authorization: string };
}

export async function login(app: Express, email: string, password = PASSWORD): Promise<LoggedIn> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const setCookie = (res.headers['set-cookie'] as unknown as string[]) ?? [];
  const cookie = setCookie.find((c) => c.startsWith('bf_rt='))?.split(';')[0] ?? '';
  return { token: res.body.data.accessToken as string, cookie, auth: { Authorization: `Bearer ${res.body.data.accessToken}` } };
}

/** Seeds roles, creates a user for `roleKey`, logs in. */
export async function actor(app: Express, roleKey: string, branches: string[] = []) {
  const made = await makeUser({ roleKey, branches });
  return { ...made, ...(await login(app, made.email)) };
}
