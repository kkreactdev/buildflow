import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { GUARD_MARK } from '../core/permissions/principal';
import { Role } from './roles/role.model';
import { Branch } from './branches/branch.model';
import { scopedRepo } from '../core/scope';
import { actor, login, makeBranch, makeUser, seedSystemRoles, Users, Branches , AuditLogs } from '../test/factories';
import { useTestDb } from '../test/db';

const app = buildApp();
const api = (path: string) => `/api/v1${path}`;

interface Layer {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
  handle?: { stack?: Layer[] };
}
function collectRoutes(layers: Layer[], out: { method: string; path: string; guarded: boolean }[] = []) {
  for (const l of layers) {
    if (l.route) {
      const method = Object.keys(l.route.methods)[0]!.toUpperCase();
      const guarded = l.route.stack.some((s) => (s.handle as unknown as Record<string, boolean>)[GUARD_MARK] === true);
      out.push({ method, path: l.route.path, guarded });
    } else if (l.handle?.stack) collectRoutes(l.handle.stack, out);
  }
  return out;
}

describe('every route declares its access rule', () => {
  it('has no route without authorize()/authenticatedOnly/publicRoute', () => {
    const routes = collectRoutes((app as unknown as { router: { stack: Layer[] } }).router.stack);
    expect(routes.length).toBeGreaterThan(15);
    expect(routes.filter((r) => !r.guarded)).toEqual([]);
  });
});

describe('authorization (401 / 403 / allowed)', () => {
  useTestDb();
  beforeEach(seedSystemRoles);

  const protectedCalls: [string, string][] = [
    ['get', '/users'], ['post', '/users'], ['patch', '/users/64b000000000000000000001'],
    ['get', '/roles'], ['post', '/roles'], ['delete', '/roles/64b000000000000000000001'],
    ['get', '/branches'], ['post', '/branches'], ['get', '/auth/permissions-catalog'], ['get', '/auth/me'],
  ];

  it.each(protectedCalls)('%s %s without a token → 401', async (method, path) => {
    const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method]!(api(path)).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('authenticated without the permission → 403; with it → allowed', async () => {
    const branch = await makeBranch('A');
    const sales = await actor(app, 'SALES_EXECUTIVE', [branch._id.toHexString()]);
    const manager = await actor(app, 'MANAGER', [branch._id.toHexString()]);
    const admin = await actor(app, 'ADMIN');

    // Sales Executive holds neither users.view nor branches.view
    expect((await request(app).get(api('/users')).set(sales.auth)).status).toBe(403);
    expect((await request(app).get(api('/branches')).set(sales.auth)).status).toBe(403);
    // Manager: users.view + branches.view yes; roles.view no; users.create no
    expect((await request(app).get(api('/users')).set(manager.auth)).status).toBe(200);
    expect((await request(app).get(api('/branches')).set(manager.auth)).status).toBe(200);
    expect((await request(app).get(api('/roles')).set(manager.auth)).status).toBe(403);
    expect((await request(app).post(api('/users')).set(manager.auth).send({})).status).toBe(403);
    // Admin: roles.view yes, roles.manage no
    expect((await request(app).get(api('/roles')).set(admin.auth)).status).toBe(200);
    expect((await request(app).post(api('/roles')).set(admin.auth).send({ name: 'X', permissions: [], dataScope: 'OWN' })).status).toBe(403);
  });

  it('authorization follows permissions, not role names', async () => {
    const admin = await actor(app, 'SUPER_ADMIN');
    // A custom role literally named "Super Admin Clone" with no permissions gets nothing.
    const created = await request(app).post(api('/roles')).set(admin.auth).send({ name: 'Super Admin Clone', permissions: ['dashboard.view'], dataScope: 'OWN' });
    expect(created.status).toBe(201);
    await Role.updateOne({ _id: created.body.data._id }, { key: 'CLONE' });
    const u = await makeUser({ roleKey: 'CLONE', branches: [(await makeBranch('Z'))._id.toHexString()] });
    const l = await login(app, u.email);
    expect((await request(app).get(api('/users')).set(l.auth)).status).toBe(403);
    expect((await request(app).get(api('/roles')).set(l.auth)).status).toBe(403);
  });

  it('permission changes apply on the very next request (no stale token privileges)', async () => {
    const admin = await actor(app, 'SUPER_ADMIN');
    const branch = await makeBranch('A');
    const role = await request(app).post(api('/roles')).set(admin.auth).send({ name: 'Viewer', permissions: ['users.view'], dataScope: 'ALL' });
    const u = await makeUser({ roleKey: 'MANAGER', branches: [branch._id.toHexString()] });
    await Users.updateOne({ _id: u.user._id }, { roleId: role.body.data._id });
    const l = await login(app, u.email);
    expect((await request(app).get(api('/users')).set(l.auth)).status).toBe(200);
    await Role.updateOne({ _id: role.body.data._id }, { permissions: [] });
    expect((await request(app).get(api('/users')).set(l.auth)).status).toBe(403);
  });
});

describe('data scope (ALL / BRANCH / OWN) on user listing', () => {
  useTestDb();
  beforeEach(seedSystemRoles);

  async function world() {
    const a = (await makeBranch('A'))._id.toHexString();
    const b = (await makeBranch('B'))._id.toHexString();
    const mgrA = await actor(app, 'MANAGER', [a]);
    await makeUser({ roleKey: 'SALES_EXECUTIVE', branches: [a], email: 'sales-a@example.com' });
    await makeUser({ roleKey: 'SALES_EXECUTIVE', branches: [b], email: 'sales-b@example.com' });
    return { a, b, mgrA };
  }
  const emails = (res: request.Response) => (res.body.data as { email: string }[]).map((u) => u.email);

  it('ALL sees every branch and may narrow with ?branchId', async () => {
    const { a } = await world();
    const admin = await actor(app, 'ADMIN');
    const all = await request(app).get(api('/users')).set(admin.auth);
    expect(emails(all)).toEqual(expect.arrayContaining(['sales-a@example.com', 'sales-b@example.com']));
    const onlyA = await request(app).get(api(`/users?branchId=${a}`)).set(admin.auth);
    expect(emails(onlyA)).toContain('sales-a@example.com');
    expect(emails(onlyA)).not.toContain('sales-b@example.com');
  });

  it('BRANCH sees only users sharing its branch; cannot widen via ?branchId or by id', async () => {
    const { a, b, mgrA } = await world();
    const list = await request(app).get(api('/users')).set(mgrA.auth);
    expect(emails(list)).toContain('sales-a@example.com');
    expect(emails(list)).not.toContain('sales-b@example.com');

    const widened = await request(app).get(api(`/users?branchId=${b}`)).set(mgrA.auth);
    expect(widened.status).toBe(403);
    expect((await request(app).get(api(`/users?branchId=${a}`)).set(mgrA.auth)).status).toBe(200);
    const other = await Users.findOne({ email: 'sales-b@example.com' });
    expect((await request(app).get(api(`/users/${other!._id}`)).set(mgrA.auth)).status).toBe(404);
  });

  it('OWN sees only itself', async () => {
    const { a } = await world();
    await Role.updateOne({ key: 'SALES_EXECUTIVE' }, { $addToSet: { permissions: 'users.view' } });
    const sales = await actor(app, 'SALES_EXECUTIVE', [a]);
    const list = await request(app).get(api('/users')).set(sales.auth);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].email).toBe(sales.email);
  });
});

describe('users', () => {
  useTestDb();
  beforeEach(seedSystemRoles);

  async function setup() {
    const a = (await makeBranch('A'))._id.toHexString();
    const b = (await makeBranch('B'))._id.toHexString();
    const admin = await actor(app, 'SUPER_ADMIN');
    const roles = Object.fromEntries((await Role.find().lean()).map((r) => [r.key, r._id.toHexString()]));
    return { a, b, admin, roles };
  }
  const newUser = (roleId: string, branchIds: string[], extra: Record<string, unknown> = {}) => ({ name: 'New Person', email: `n${Math.random().toString(36).slice(2, 7)}@example.com`, password: 'Sup3r-Secret-Pass', roleId, branchIds, ...extra });

  it('creates a user, assigns role + branch, and never returns hashes or tokens', async () => {
    const { a, admin, roles } = await setup();
    const res = await request(app).post(api('/users')).set(admin.auth).send(newUser(roles.SALES_EXECUTIVE!, [a]));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ roleName: 'Sales Executive', branchIds: [a], primaryBranchId: a, isActive: true });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password|\$2[aby]\$|tokenVersion|failedLogin/);
    const row = await Users.findById(res.body.data.id).select('+passwordHash').lean();
    expect(row!.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(row!.passwordHash).not.toContain('Sup3r');

    const got = await request(app).get(api(`/users/${res.body.data.id}`)).set(admin.auth);
    const list = await request(app).get(api('/users')).set(admin.auth);
    for (const body of [got.body, list.body]) expect(JSON.stringify(body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it('the new user can sign in with the chosen password', async () => {
    const { a, admin, roles } = await setup();
    const body = newUser(roles.SALES_EXECUTIVE!, [a]);
    await request(app).post(api('/users')).set(admin.auth).send(body);
    expect((await login(app, body.email as string, body.password as string)).token).toBeTruthy();
  });

  it('rejects weak passwords, bad roles/branches, duplicates', async () => {
    const { a, admin, roles } = await setup();
    const post = (b: object) => request(app).post(api('/users')).set(admin.auth).send(b);
    expect((await post(newUser(roles.SALES_EXECUTIVE!, [a], { password: 'short' }))).status).toBe(400);
    expect((await post(newUser('64b0000000000000000000ff', [a]))).status).toBe(400); // unknown role
    expect((await post(newUser('not-an-id', [a]))).status).toBe(400);
    expect((await post(newUser(roles.SALES_EXECUTIVE!, ['64b0000000000000000000ff']))).status).toBe(400); // unknown branch
    expect((await post(newUser(roles.SALES_EXECUTIVE!, []))).status).toBe(400); // OWN role needs a branch
    const ok = newUser(roles.SALES_EXECUTIVE!, [a]);
    expect((await post(ok)).status).toBe(201);
    expect((await post({ ...ok, email: (ok.email as string).toUpperCase() })).status).toBe(409);
  });

  it('ALL-scope roles may have no branch; inactive roles are not assignable', async () => {
    const { admin, roles } = await setup();
    expect((await request(app).post(api('/users')).set(admin.auth).send(newUser(roles.ADMIN!, []))).status).toBe(201);
    await request(app).patch(api(`/roles/${roles.MANAGER}`)).set(admin.auth).send({ isActive: false });
    const br = await Branches.findOne();
    expect((await request(app).post(api('/users')).set(admin.auth).send(newUser(roles.MANAGER!, [br!._id.toHexString()]))).status).toBe(400);
  });

  it('a Manager cannot widen branches: cannot assign a branch they do not belong to', async () => {
    const { a, b, roles } = await setup();
    const mgr = await actor(app, 'MANAGER', [a]);
    const res = await request(app).post(api('/users')).set(mgr.auth).send(newUser(roles.SALES_EXECUTIVE!, [b]));
    expect(res.status).toBe(403);
    await Role.updateOne({ key: 'MANAGER' }, { $addToSet: { permissions: { $each: ['users.create', 'users.edit'] } } });
    expect((await request(app).post(api('/users')).set(mgr.auth).send(newUser(roles.SALES_EXECUTIVE!, [b]))).status).toBe(403);
    expect((await request(app).post(api('/users')).set(mgr.auth).send(newUser(roles.SALES_EXECUTIVE!, [a]))).status).toBe(201);
  });

  it('prevents privilege escalation through role assignment or editing a more powerful user', async () => {
    const { a, roles, admin } = await setup();
    await Role.updateOne({ key: 'MANAGER' }, { $addToSet: { permissions: { $each: ['users.create', 'users.edit'] } } });
    const mgr = await actor(app, 'MANAGER', [a]);
    // cannot hand out Admin (holds permissions the manager lacks, broader scope)
    expect((await request(app).post(api('/users')).set(mgr.auth).send(newUser(roles.ADMIN!, [a]))).status).toBe(403);
    // cannot edit/deactivate an Admin in their branch
    const adm = await makeUser({ roleKey: 'ADMIN', branches: [a] });
    expect((await request(app).patch(api(`/users/${adm.user._id}`)).set(mgr.auth).send({ isActive: false })).status).toBe(403);
    // cannot promote self
    expect((await request(app).patch(api(`/users/${mgr.user._id}`)).set(mgr.auth).send({ roleId: roles.ADMIN })).status).toBe(403);
    void admin;
  });

  it('updates profile + role, bumps sessions on role change, and audits with redaction', async () => {
    const { a, admin, roles } = await setup();
    const created = (await request(app).post(api('/users')).set(admin.auth).send(newUser(roles.SALES_EXECUTIVE!, [a]))).body.data;
    const victim = await login(app, created.email, 'Sup3r-Secret-Pass');
    const res = await request(app).patch(api(`/users/${created.id}`)).set(admin.auth).send({ roleId: roles.MANAGER, name: 'Renamed', phone: '+919999999999' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ roleName: 'Manager', name: 'Renamed', phone: '+919999999999' });
    // old access token + refresh token die on a role change
    expect((await request(app).get(api('/auth/me')).set(victim.auth)).status).toBe(401);
    expect((await request(app).post(api('/auth/refresh')).set('Cookie', victim.cookie)).status).toBe(401);
    const row = await AuditLogs.findOne({ entityType: 'user', action: 'role_changed' }).lean();
    expect(row!.changes).toHaveProperty('roleId');
    expect(String(row!.userId)).toBe(admin.user._id.toHexString());
  });

  it('deactivation blocks login, kills sessions and is audited; reactivation restores', async () => {
    const { a, admin, roles } = await setup();
    const created = (await request(app).post(api('/users')).set(admin.auth).send(newUser(roles.SALES_EXECUTIVE!, [a]))).body.data;
    const s = await login(app, created.email, 'Sup3r-Secret-Pass');
    expect((await request(app).patch(api(`/users/${created.id}`)).set(admin.auth).send({ isActive: false })).status).toBe(200);
    expect((await request(app).get(api('/auth/me')).set(s.auth)).status).toBe(401);
    expect((await request(app).post(api('/auth/login')).send({ email: created.email, password: 'Sup3r-Secret-Pass' })).status).toBe(403);
    await request(app).patch(api(`/users/${created.id}`)).set(admin.auth).send({ isActive: true });
    expect((await request(app).post(api('/auth/login')).send({ email: created.email, password: 'Sup3r-Secret-Pass' })).status).toBe(200);
    expect(await AuditLogs.countDocuments({ action: 'deactivate' })).toBe(1);
    expect(await AuditLogs.countDocuments({ action: 'activate' })).toBe(1);
  });

  it('password reset revokes sessions and never audits the password', async () => {
    const { a, admin, roles } = await setup();
    const created = (await request(app).post(api('/users')).set(admin.auth).send(newUser(roles.SALES_EXECUTIVE!, [a]))).body.data;
    const s = await login(app, created.email, 'Sup3r-Secret-Pass');
    await request(app).patch(api(`/users/${created.id}`)).set(admin.auth).send({ password: 'Brand-New-Passw0rd' });
    expect((await request(app).post(api('/auth/refresh')).set('Cookie', s.cookie)).status).toBe(401);
    expect((await request(app).post(api('/auth/login')).send({ email: created.email, password: 'Sup3r-Secret-Pass' })).status).toBe(401);
    expect((await request(app).post(api('/auth/login')).send({ email: created.email, password: 'Brand-New-Passw0rd' })).status).toBe(200);
    const dump = JSON.stringify(await AuditLogs.find().lean());
    expect(dump).not.toContain('Brand-New-Passw0rd');
    expect(dump).not.toContain('Sup3r-Secret-Pass');
    expect(dump).not.toMatch(/\$2[aby]\$/);
  });

  it('a user cannot deactivate themselves or change their own role/branches', async () => {
    const { admin } = await setup();
    expect((await request(app).patch(api(`/users/${admin.user._id}`)).set(admin.auth).send({ isActive: false })).status).toBe(403);
    expect((await request(app).patch(api(`/users/${admin.user._id}`)).set(admin.auth).send({ branchIds: [] })).status).toBe(403);
  });

  it('ignores/rejects mass-assignment of privileged fields', async () => {
    const { a, admin, roles } = await setup();
    const res = await request(app).post(api('/users')).set(admin.auth).send({ ...newUser(roles.SALES_EXECUTIVE!, [a]), permissions: ['*'], dataScope: 'ALL', tokenVersion: 99, passwordHash: 'x' });
    expect(res.status).toBe(201);
    const row = await Users.findById(res.body.data.id).select('+passwordHash +tokenVersion').lean();
    expect(row!.tokenVersion).toBe(0);
    expect(row!.passwordHash).not.toBe('x');
    expect(row).not.toHaveProperty('permissions');
  });
});

describe('roles', () => {
  useTestDb();
  beforeEach(seedSystemRoles);

  it('creates a custom role with valid permissions; dedupes and sorts', async () => {
    const admin = await actor(app, 'SUPER_ADMIN');
    const res = await request(app).post(api('/roles')).set(admin.auth).send({ name: 'Telecaller', permissions: ['enquiries.view', 'enquiries.view', 'followups.view'], dataScope: 'BRANCH' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ key: 'TELECALLER', isSystem: false, permissions: ['enquiries.view', 'followups.view'], dataScope: 'BRANCH' });
    expect((await request(app).post(api('/roles')).set(admin.auth).send({ name: 'telecaller', permissions: [], dataScope: 'OWN' })).status).toBe(409);
  });

  it('rejects unknown permissions, the wildcard, and bad scopes', async () => {
    const admin = await actor(app, 'SUPER_ADMIN');
    const post = (b: object) => request(app).post(api('/roles')).set(admin.auth).send(b);
    const bad = await post({ name: 'Bad', permissions: ['enquiries.fly'], dataScope: 'OWN' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body.error.details)).toContain('Unknown permission');
    expect((await post({ name: 'Wild', permissions: ['*'], dataScope: 'OWN' })).status).toBe(400);
    expect((await post({ name: 'Scope', permissions: [], dataScope: 'EVERYTHING' })).status).toBe(400);
  });

  it('changing permissions is audited with before/after', async () => {
    const admin = await actor(app, 'SUPER_ADMIN');
    const r = (await request(app).post(api('/roles')).set(admin.auth).send({ name: 'Temp', permissions: ['enquiries.view'], dataScope: 'OWN' })).body.data;
    const upd = await request(app).patch(api(`/roles/${r._id}`)).set(admin.auth).send({ permissions: ['enquiries.view', 'enquiries.edit'] });
    expect(upd.status).toBe(200);
    const row = await AuditLogs.findOne({ entityType: 'role', action: 'permissions_changed' }).lean();
    expect(row!.changes).toMatchObject({ permissions: { from: ['enquiries.view'], to: ['enquiries.edit', 'enquiries.view'] } });
  });

  it('protects the Super Admin role and system roles', async () => {
    const admin = await actor(app, 'SUPER_ADMIN');
    const sa = await Role.findOne({ key: 'SUPER_ADMIN' });
    expect((await request(app).patch(api(`/roles/${sa!._id}`)).set(admin.auth).send({ permissions: ['dashboard.view'] })).status).toBe(403);
    expect((await request(app).patch(api(`/roles/${sa!._id}`)).set(admin.auth).send({ dataScope: 'OWN' })).status).toBe(403);
    expect((await request(app).patch(api(`/roles/${sa!._id}`)).set(admin.auth).send({ isActive: false })).status).toBe(403);
    expect((await request(app).delete(api(`/roles/${sa!._id}`)).set(admin.auth)).status).toBe(403);
    const mgr = await Role.findOne({ key: 'MANAGER' });
    expect((await request(app).delete(api(`/roles/${mgr!._id}`)).set(admin.auth)).status).toBe(403);
  });

  it('cannot delete or deactivate a role still assigned to users', async () => {
    const admin = await actor(app, 'SUPER_ADMIN');
    const r = (await request(app).post(api('/roles')).set(admin.auth).send({ name: 'Temp', permissions: ['dashboard.view'], dataScope: 'ALL' })).body.data;
    await Role.updateOne({ _id: r._id }, { key: 'TEMP' });
    await makeUser({ roleKey: 'TEMP' });
    expect((await request(app).delete(api(`/roles/${r._id}`)).set(admin.auth)).status).toBe(409);
    expect((await request(app).patch(api(`/roles/${r._id}`)).set(admin.auth).send({ isActive: false })).status).toBe(409);
  });

  it('role managers cannot grant permissions or scope they do not hold', async () => {
    await Role.updateOne({ key: 'MANAGER' }, { $addToSet: { permissions: 'roles.manage' } });
    const b = (await makeBranch('A'))._id.toHexString();
    const mgr = await actor(app, 'MANAGER', [b]);
    const grantBeyond = await request(app).post(api('/roles')).set(mgr.auth).send({ name: 'Sneaky', permissions: ['users.create'], dataScope: 'BRANCH' });
    expect(grantBeyond.status).toBe(403);
    const widerScope = await request(app).post(api('/roles')).set(mgr.auth).send({ name: 'Wide', permissions: ['enquiries.view'], dataScope: 'ALL' });
    expect(widerScope.status).toBe(403);
    expect((await request(app).post(api('/roles')).set(mgr.auth).send({ name: 'Fine', permissions: ['enquiries.view'], dataScope: 'OWN' })).status).toBe(201);
    // and cannot rewrite the Admin role
    const adminRole = await Role.findOne({ key: 'ADMIN' });
    expect((await request(app).patch(api(`/roles/${adminRole!._id}`)).set(mgr.auth).send({ permissions: ['dashboard.view'] })).status).toBe(403);
  });

  it('serves the permission catalog to role viewers', async () => {
    const admin = await actor(app, 'ADMIN');
    const res = await request(app).get(api('/auth/permissions-catalog')).set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.enquiries).toContain('revert');
  });
});

describe('regression: foreign-id access on branches and users (Phase 1 bug: scope key clobbered the id filter)', () => {
  useTestDb();
  beforeEach(seedSystemRoles);

  it('a BRANCH actor can neither read nor modify another branch by id; nothing changes', async () => {
    const a = await makeBranch('A');
    const b = await makeBranch('B');
    const mgr = await actor(app, 'MANAGER', [a._id.toHexString()]);
    const admin = await actor(app, 'ADMIN');
    expect((await request(app).get(api(`/branches/${b._id}`)).set(mgr.auth)).status).toBe(404);
    // Even with branches.manage the scope layer still hides branch B.
    await Role.updateOne({ key: 'MANAGER' }, { $addToSet: { permissions: 'branches.manage' } });
    expect((await request(app).patch(api(`/branches/${b._id}`)).set(mgr.auth).send({ name: 'HACKED', isActive: false })).status).toBe(404);
    const row = await Branches.findOne({ code: 'B' }).lean();
    expect(row).toMatchObject({ name: 'Branch B', isActive: true });
    // Its own branch is editable, and the response is for the branch it asked about.
    const own = await request(app).patch(api(`/branches/${a._id}`)).set(mgr.auth).send({ name: 'Renamed A' });
    expect(own.status).toBe(200);
    expect(own.body.data.code).toBe('A');
    expect((await request(app).get(api(`/branches/${b._id}`)).set(admin.auth)).body.data.name).toBe('Branch B');
  });

  it('repo-level: a filter on the scope key (_id) cannot reach a branch outside the actor scope', async () => {
    const a = await makeBranch('A');
    const b = await makeBranch('B');
    const repo = scopedRepo(Branch, { userId: '64b0000000000000000000a1', permissions: new Set(), dataScope: 'BRANCH', branchIds: [a._id.toHexString()] });
    expect(await repo.findOne({ _id: b._id }).lean()).toBeNull();
    expect(await repo.findById(b._id.toHexString()).lean()).toBeNull();
    expect((await repo.updateOne({ _id: b._id }, { $set: { name: 'x' } })).matchedCount).toBe(0);
    expect(await repo.countDocuments({ _id: { $in: [a._id, b._id] } })).toBe(1);
  });

  it('a BRANCH manager cannot read or edit a user in another branch by id', async () => {
    const a = (await makeBranch('A'))._id.toHexString();
    const b = (await makeBranch('B'))._id.toHexString();
    const { Role: R } = { Role };
    await R.updateOne({ key: 'MANAGER' }, { $addToSet: { permissions: 'users.edit' } });
    const mgr = await actor(app, 'MANAGER', [a]);
    const other = await makeUser({ roleKey: 'SALES_EXECUTIVE', branches: [b] });
    expect((await request(app).get(api(`/users/${other.user._id}`)).set(mgr.auth)).status).toBe(404);
    expect((await request(app).patch(api(`/users/${other.user._id}`)).set(mgr.auth).send({ name: 'HACKED' })).status).toBe(404);
    expect((await Users.findById(other.user._id.toHexString()).lean())!.name).not.toBe('HACKED');
  });

  it('branch memberships outside a manager\'s reach survive their edits (add/remove only touch their own branches)', async () => {
    const a = (await makeBranch('A'))._id.toHexString();
    const b = (await makeBranch('B'))._id.toHexString();
    const c = (await makeBranch('C'))._id.toHexString();
    await Role.updateOne({ key: 'MANAGER' }, { $addToSet: { permissions: 'users.edit' } });
    const mgr = await actor(app, 'MANAGER', [a, b]);
    const target = await makeUser({ roleKey: 'SALES_EXECUTIVE', branches: [a, c] });
    // manager moves the user from A to B; C (not the manager's branch) must remain
    const res = await request(app).patch(api(`/users/${target.user._id}`)).set(mgr.auth).send({ branchIds: [b] });
    expect(res.status).toBe(200);
    expect([...res.body.data.branchIds].sort()).toEqual([b, c].sort());
    expect([...(await Users.findById(target.user._id.toHexString()).lean())!.branchIds!.map(String)].sort()).toEqual([b, c].sort());
  });
});

describe('branches', () => {
  useTestDb();
  beforeEach(seedSystemRoles);

  it('CRUD with unique codes, uppercase normalisation and audit', async () => {
    const admin = await actor(app, 'ADMIN');
    const c = await request(app).post(api('/branches')).set(admin.auth).send({ name: 'Chennai', code: 'chn' });
    expect(c.status).toBe(201);
    expect(c.body.data.code).toBe('CHN');
    expect((await request(app).post(api('/branches')).set(admin.auth).send({ name: 'Dup', code: 'CHN' })).status).toBe(409);
    const u = await request(app).patch(api(`/branches/${c.body.data._id}`)).set(admin.auth).send({ name: 'Chennai HQ', isActive: false });
    expect(u.body.data).toMatchObject({ name: 'Chennai HQ', isActive: false });
    expect(await AuditLogs.countDocuments({ entityType: 'branch' })).toBe(2);
  });

  it('BRANCH-scope users only see their own branches', async () => {
    const a = await makeBranch('A');
    await makeBranch('B');
    const mgr = await actor(app, 'MANAGER', [a._id.toHexString()]);
    const list = await request(app).get(api('/branches')).set(mgr.auth);
    expect((list.body.data as { code: string }[]).map((b) => b.code)).toEqual(['A']);
    const other = await Branches.findOne({ code: 'B' });
    expect((await request(app).get(api(`/branches/${other!._id}`)).set(mgr.auth)).status).toBe(404);
    expect((await request(app).post(api('/branches')).set(mgr.auth).send({ name: 'New', code: 'NEW' })).status).toBe(403);
  });
});
