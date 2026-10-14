import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { ALL_PERMISSION_KEYS } from '../core/permissions/catalog';
import { Role } from '../modules/roles/role.model';
import { useTestDb } from '../test/db';
import { actor, AuditLogs, makeBranch, seedAll } from '../test/factories';
import { api } from '../test/people';
import { migratePermissionRenames, PERMISSION_RENAMES } from './permissionRenames';

const app = buildApp();
const perms = async (key: string) => (await Role.findOne({ key }).lean())!.permissions;

useTestDb();
beforeEach(seedAll);

/** Puts a role back into its pre-rename shape: old key instead of the new one. */
async function makeLegacy(key: string, from = 'enquiries.delete', to = 'enquiries.archive') {
  await Role.updateOne({ key }, { $pull: { permissions: to } });
  await Role.updateOne({ key }, { $addToSet: { permissions: from } });
}

describe('permission rename migration', () => {
  it('declares the renames and the new keys are real catalog permissions', () => {
    expect(PERMISSION_RENAMES).toContainEqual({ from: 'enquiries.delete', to: 'enquiries.archive' });
    for (const r of PERMISSION_RENAMES) {
      expect(ALL_PERMISSION_KEYS as readonly string[]).toContain(r.to);
      expect(ALL_PERMISSION_KEYS as readonly string[]).not.toContain(r.from);
    }
  });

  it('gives every role that held enquiries.delete the new enquiries.archive, and removes the dead key', async () => {
    await makeLegacy('MANAGER');
    await makeLegacy('ADMIN');
    expect(await perms('MANAGER')).toContain('enquiries.delete');
    const changed = await migratePermissionRenames();
    expect(changed.filter((c) => c.to === 'enquiries.archive').map((c) => c.roleKey).sort()).toEqual(['ADMIN', 'MANAGER']);
    for (const key of ['MANAGER', 'ADMIN']) {
      const p = await perms(key);
      expect(p).toContain('enquiries.archive');
      expect(p).not.toContain('enquiries.delete');
    }
  });

  it('never overwrites custom permissions: everything else the role had is preserved exactly', async () => {
    await Role.create({ name: 'Telecaller', key: 'TELECALLER', dataScope: 'BRANCH', isSystem: false, permissions: ['enquiries.view', 'enquiries.delete', 'followups.view', 'clients.view'] });
    const before = (await perms('TELECALLER')).filter((p) => p !== 'enquiries.delete');
    await migratePermissionRenames();
    const after = await perms('TELECALLER');
    expect([...after].sort()).toEqual([...before, 'enquiries.archive'].sort());
    expect(after).not.toContain('enquiries.delete');
    // scope and identity of the role are untouched
    expect(await Role.findOne({ key: 'TELECALLER' }).lean()).toMatchObject({ name: 'Telecaller', dataScope: 'BRANCH', isSystem: false, isActive: true });
  });

  it('does not touch roles that never held the old key (no grants are invented)', async () => {
    const sales = await Role.findOne({ key: 'SALES_EXECUTIVE' }).lean();
    expect(sales!.permissions).not.toContain('enquiries.archive');
    await Role.create({ name: 'Viewer', key: 'VIEWER', dataScope: 'OWN', permissions: ['enquiries.view'] });
    const viewer = await Role.findOne({ key: 'VIEWER' }).lean();
    await migratePermissionRenames();
    const afterSales = await Role.findOne({ key: 'SALES_EXECUTIVE' }).lean();
    const afterViewer = await Role.findOne({ key: 'VIEWER' }).lean();
    expect(afterSales!.permissions).toEqual(sales!.permissions);
    expect(afterSales!.updatedAt).toEqual(sales!.updatedAt); // not even rewritten
    expect(afterViewer!.permissions).toEqual(viewer!.permissions);
    expect(afterViewer!.updatedAt).toEqual(viewer!.updatedAt);
  });

  it('never duplicates: a role that already has the new key just loses the old one', async () => {
    await Role.updateOne({ key: 'MANAGER' }, { $addToSet: { permissions: 'enquiries.delete' } }); // has BOTH
    expect((await perms('MANAGER')).filter((p) => p === 'enquiries.archive')).toHaveLength(1);
    await migratePermissionRenames();
    const p = await perms('MANAGER');
    expect(p.filter((x) => x === 'enquiries.archive')).toHaveLength(1);
    expect(p).not.toContain('enquiries.delete');
    expect(new Set(p).size).toBe(p.length);
  });

  it('leaves the Super Admin wildcard role completely alone (and any role holding "*")', async () => {
    const root = await Role.findOne({ key: 'SUPER_ADMIN' }).lean();
    await Role.create({ name: 'Wild', key: 'WILD', dataScope: 'ALL', permissions: ['*', 'enquiries.delete'] }); // pathological, but must be skipped
    await migratePermissionRenames();
    const after = await Role.findOne({ key: 'SUPER_ADMIN' }).lean();
    expect(after!.permissions).toEqual(['*']);
    expect(after!.updatedAt).toEqual(root!.updatedAt);
    expect((await perms('WILD')).sort()).toEqual(['*', 'enquiries.delete']);
  });

  it('is idempotent: running it again changes nothing and writes nothing', async () => {
    await makeLegacy('MANAGER');
    const first = await migratePermissionRenames();
    expect(first.length).toBeGreaterThan(0);
    const snapshot = JSON.stringify(await Role.find().sort({ key: 1 }).lean());
    const auditsAfterFirst = await AuditLogs.countDocuments({ action: 'permissions_migrated' });
    for (let i = 0; i < 3; i++) expect(await migratePermissionRenames()).toEqual([]);
    expect(JSON.stringify(await Role.find().sort({ key: 1 }).lean())).toBe(snapshot);
    expect(await AuditLogs.countDocuments({ action: 'permissions_migrated' })).toBe(auditsAfterFirst);
  });

  it('can resume after an interruption between adding the new key and removing the old one', async () => {
    await Role.updateOne({ key: 'MANAGER' }, { $addToSet: { permissions: { $each: ['enquiries.archive', 'enquiries.delete'] } } }); // add done, pull not yet
    await migratePermissionRenames();
    const p = await perms('MANAGER');
    expect(p).toContain('enquiries.archive');
    expect(p).not.toContain('enquiries.delete');
  });

  it('also carries over clients.delete -> clients.archive (the same rename made in Phase 4)', async () => {
    await makeLegacy('MANAGER', 'clients.delete', 'clients.archive');
    await migratePermissionRenames();
    const p = await perms('MANAGER');
    expect(p).toContain('clients.archive');
    expect(p).not.toContain('clients.delete');
  });

  it('also carries over followups.delete -> followups.archive (Phase 6)', async () => {
    await makeLegacy('MANAGER', 'followups.delete', 'followups.archive');
    await migratePermissionRenames();
    const p = await perms('MANAGER');
    expect(p).toContain('followups.archive');
    expect(p).not.toContain('followups.delete');
  });

  it('also carries over units.delete -> units.archive (Phase 7)', async () => {
    await makeLegacy('MANAGER', 'units.delete', 'units.archive');
    await migratePermissionRenames();
    const p = await perms('MANAGER');
    expect(p).toContain('units.archive');
    expect(p).not.toContain('units.delete');
  });

  it('also carries over sitevisits.delete -> sitevisits.archive (Phase 8)', async () => {
    await makeLegacy('MANAGER', 'sitevisits.delete', 'sitevisits.archive');
    await migratePermissionRenames();
    const p = await perms('MANAGER');
    expect(p).toContain('sitevisits.archive');
    expect(p).not.toContain('sitevisits.delete');
  });

  it('also carries over referrals.delete -> referrals.archive (Phase 10)', async () => {
    await makeLegacy('MANAGER', 'referrals.delete', 'referrals.archive');
    await migratePermissionRenames();
    const p = await perms('MANAGER');
    expect(p).toContain('referrals.archive');
    expect(p).not.toContain('referrals.delete');
  });

  it('also carries over documents.delete -> documents.archive (Phase 11)', async () => {
    await makeLegacy('MANAGER', 'documents.delete', 'documents.archive');
    await migratePermissionRenames();
    const p = await perms('MANAGER');
    expect(p).toContain('documents.archive');
    expect(p).not.toContain('documents.delete');
  });

  it('is audited per role with before/after and the reason, and never records anything sensitive', async () => {
    await makeLegacy('MANAGER');
    await migratePermissionRenames();
    const row = await AuditLogs.findOne({ entityType: 'role', action: 'permissions_migrated' }).lean();
    expect(row).toMatchObject({ reason: 'Permission renamed: enquiries.delete -> enquiries.archive' });
    expect((row!.changes as { permissions: { from: string[]; to: string[] } }).permissions.from).toContain('enquiries.delete');
    expect((row!.changes as { permissions: { to: string[] } }).permissions.to).toContain('enquiries.archive');
    expect(row!.userId).toBeUndefined(); // a system migration, not a user
  });

  it('end to end: a legacy Manager cannot archive an enquiry until the migration runs, then can', async () => {
    const b = (await makeBranch('A'))._id.toHexString();
    await makeLegacy('MANAGER');
    const mgr = await actor(app, 'MANAGER', [b]);
    const created = await request(app).post(api('/enquiries')).set(mgr.auth).send({ person: { name: 'Raj Kumar', phone: '9876543210' }, sourceId: await sourceId() });
    expect(created.status).toBe(201);
    expect((await request(app).delete(api(`/enquiries/${created.body.data.id}`)).set(mgr.auth)).status).toBe(403); // the old key is dead
    await migratePermissionRenames();
    expect((await request(app).delete(api(`/enquiries/${created.body.data.id}`)).set(mgr.auth)).status).toBe(204); // permissions are read per request
  });

  it('a migrated role stays editable in the Roles API (no unknown keys left behind)', async () => {
    await makeLegacy('ADMIN');
    await migratePermissionRenames();
    const root = await actor(app, 'SUPER_ADMIN');
    const admin = await Role.findOne({ key: 'ADMIN' });
    const res = await request(app).patch(api(`/roles/${admin!._id}`)).set(root.auth).send({ permissions: (await perms('ADMIN')).filter((p) => p !== 'dashboard.view') });
    expect(res.status).toBe(200);
  });
});

async function sourceId() {
  const root = await actor(app, 'ADMIN');
  return (await request(app).post(api('/masters/ENQUIRY_SOURCE')).set(root.auth).send({ label: 'Website' })).body.data._id as string;
}
