import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { recordAudit } from '../../core/audit/audit.service';
import { Types } from 'mongoose';
import { actor, AuditLogs, makeBranch, seedAll } from '../../test/factories';
import { useTestDb } from '../../test/db';
import { Role } from '../roles/role.model';

const app = buildApp();
const api = (p: string) => `/api/v1${p}`;

useTestDb();
beforeEach(seedAll);

describe('audit read API', () => {
  it('needs authentication and audit.view: Manager and Sales Executive are refused by default', async () => {
    const b = (await makeBranch('A'))._id.toHexString();
    const mgr = await actor(app, 'MANAGER', [b]);
    const sales = await actor(app, 'SALES_EXECUTIVE', [b]);
    const admin = await actor(app, 'ADMIN');
    expect((await request(app).get(api('/audit'))).status).toBe(401);
    expect((await request(app).get(api('/audit')).set(mgr.auth)).status).toBe(403);
    expect((await request(app).get(api('/audit')).set(sales.auth)).status).toBe(403);
    expect((await request(app).get(api('/audit')).set(admin.auth)).status).toBe(200);
  });

  it('is strictly read-only: no create/update/delete over the API', async () => {
    const admin = await actor(app, 'SUPER_ADMIN');
    await recordAudit({ entityType: 'unit', entityId: new Types.ObjectId(), action: 'create', after: { a: 1 } });
    const row = await AuditLogs.findOne({}).lean();
    for (const [m, p] of [['post', '/audit'], ['put', `/audit/${row!._id}`], ['patch', `/audit/${row!._id}`], ['delete', `/audit/${row!._id}`], ['delete', '/audit']] as const) {
      expect((await (request(app) as never as Record<string, (u: string) => request.Test>)[m]!(api(p)).set(admin.auth).send({})).status).toBe(404);
    }
    expect(await AuditLogs.countDocuments({ action: 'create', entityType: 'unit' })).toBe(1);
  });

  it('shows who/what/previous/new/when/why and filters by entity, action, user and date', async () => {
    const admin = await actor(app, 'ADMIN');
    const entityId = new Types.ObjectId();
    await recordAudit({ entityType: 'enquiry', entityId, action: 'transition', before: { stage: 'INTERESTED' }, after: { stage: 'CONTACTED' }, userId: admin.user._id, reason: 'Customer asked to wait' });
    await recordAudit({ entityType: 'unit', entityId: new Types.ObjectId(), action: 'create', after: { name: 'Villa 03' } });
    const byEntity = await request(app).get(api(`/audit?entityType=enquiry&entityId=${entityId}`)).set(admin.auth);
    expect(byEntity.body.data).toHaveLength(1);
    expect(byEntity.body.data[0]).toMatchObject({ action: 'transition', reason: 'Customer asked to wait', changes: { stage: { from: 'INTERESTED', to: 'CONTACTED' } }, userId: admin.user._id.toHexString() });
    expect(byEntity.body.data[0].at).toBeTruthy();
    expect((await request(app).get(api('/audit?action=create&entityType=unit')).set(admin.auth)).body.data).toHaveLength(1);
    expect((await request(app).get(api(`/audit?userId=${admin.user._id}&entityType=enquiry`)).set(admin.auth)).body.data).toHaveLength(1);
    expect((await request(app).get(api('/audit?from=2999-01-01')).set(admin.auth)).body.data).toHaveLength(0);
    expect((await request(app).get(api('/audit?limit=1')).set(admin.auth)).body.meta).toMatchObject({ limit: 1 });
    expect((await request(app).get(api('/audit?entityId=nope')).set(admin.auth)).status).toBe(400);
  });

  it('GET /audit/:id returns one entry, 404 for unknown ids', async () => {
    const admin = await actor(app, 'ADMIN');
    await recordAudit({ entityType: 'unit', entityId: new Types.ObjectId(), action: 'create', after: { a: 1 } });
    const id = (await AuditLogs.findOne({ entityType: 'unit' }).lean())!._id;
    expect((await request(app).get(api(`/audit/${id}`)).set(admin.auth)).body.data.action).toBe('create');
    expect((await request(app).get(api(`/audit/${new Types.ObjectId()}`)).set(admin.auth)).status).toBe(404);
  });
});

describe('audit scope', () => {
  async function setup() {
    const A = (await makeBranch('A'))._id.toHexString();
    const B = (await makeBranch('B'))._id.toHexString();
    await Role.updateOne({ key: 'MANAGER' }, { $addToSet: { permissions: 'audit.view' } });
    const mgrA = await actor(app, 'MANAGER', [A]);
    const root = await actor(app, 'ADMIN');
    const e = () => new Types.ObjectId();
    await recordAudit({ entityType: 'enquiry', entityId: e(), action: 'create', after: { n: 'in-A' }, branchId: A });
    await recordAudit({ entityType: 'enquiry', entityId: e(), action: 'create', after: { n: 'in-B' }, branchId: B });
    await recordAudit({ entityType: 'role', entityId: e(), action: 'update', after: { n: 'company-wide' } }); // no branch
    return { A, B, mgrA, root };
  }
  const names = (res: request.Response) => (res.body.data as { changes: { n?: { to: string } } }[]).map((r) => r.changes.n?.to).filter(Boolean).sort();

  it('ALL sees everything incl. company-wide entries; a BRANCH reader sees only its branch', async () => {
    const { mgrA, root } = await setup();
    expect(names(await request(app).get(api('/audit')).set(root.auth))).toEqual(['company-wide', 'in-A', 'in-B']);
    expect(names(await request(app).get(api('/audit')).set(mgrA.auth))).toEqual(['in-A']);
  });

  it('a branch reader cannot widen with ?branchId, nor open another branch\'s entry by id', async () => {
    const { B, mgrA, root } = await setup();
    expect((await request(app).get(api(`/audit?branchId=${B}`)).set(mgrA.auth)).status).toBe(403);
    const other = (await request(app).get(api(`/audit?branchId=${B}`)).set(root.auth)).body.data[0];
    expect((await request(app).get(api(`/audit/${other.id}`)).set(mgrA.auth)).status).toBe(404);
    const companyWide = (await request(app).get(api('/audit?entityType=role')).set(root.auth)).body.data[0];
    expect((await request(app).get(api(`/audit/${companyWide.id}`)).set(mgrA.auth)).status).toBe(404);
  });
});

describe('sensitive data never leaves the audit API', () => {
  it('user create/update audits carry no passwords, hashes or tokens', async () => {
    const admin = await actor(app, 'SUPER_ADMIN');
    const A = (await makeBranch('A'))._id.toHexString();
    const roleId = (await Role.findOne({ key: 'SALES_EXECUTIVE' }))!._id.toHexString();
    const created = await request(app).post(api('/users')).set(admin.auth).send({ name: 'Secret Person', email: 'sp@example.com', password: 'Sup3r-Secret-Pass', roleId, branchIds: [A] });
    await request(app).patch(api(`/users/${created.body.data.id}`)).set(admin.auth).send({ password: 'Another-Secret-1' });
    const res = await request(app).get(api('/audit?entityType=user&limit=100')).set(admin.auth);
    const dump = JSON.stringify(res.body);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(dump).not.toContain('Sup3r-Secret-Pass');
    expect(dump).not.toContain('Another-Secret-1');
    expect(dump).not.toMatch(/\$2[aby]\$/);
    expect(dump).not.toMatch(/passwordHash"\s*:\s*\{"from":"[^[]/);
  });

  it('nested secrets are scrubbed on READ even if one was written (defence in depth)', async () => {
    const admin = await actor(app, 'SUPER_ADMIN');
    await recordAudit({
      entityType: 'integration', entityId: new Types.ObjectId(), action: 'update',
      after: { settings: { apiKey: 'sk-live-123', accessToken: 'tok_abc', refreshToken: 'rt_xyz', password: 'pw', nested: { clientSecret: 's3', ok: 'visible' } }, note: 'fine' },
    });
    const res = await request(app).get(api('/audit?entityType=integration')).set(admin.auth);
    const row = res.body.data[0];
    expect(JSON.stringify(row)).not.toMatch(/sk-live-123|tok_abc|rt_xyz|"pw"|"s3"/);
    expect(row.changes.settings.to).toMatchObject({ apiKey: '[redacted]', accessToken: '[redacted]', refreshToken: '[redacted]', password: '[redacted]', nested: { clientSecret: '[redacted]', ok: 'visible' } });
    expect(row.changes.note.to).toBe('fine');
  });

  it('the response never exposes raw storage internals', async () => {
    const admin = await actor(app, 'SUPER_ADMIN');
    await recordAudit({ entityType: 'unit', entityId: new Types.ObjectId(), action: 'create', after: { a: 1 } });
    const row = (await request(app).get(api('/audit?entityType=unit')).set(admin.auth)).body.data[0];
    expect(Object.keys(row).sort()).toEqual(['action', 'at', 'changes', 'entityId', 'entityType', 'id', 'requestId', 'userId', 'branchId', 'reason'].filter((k) => k in row || ['id'].includes(k)).sort());
    expect(row).not.toHaveProperty('__v');
  });
});
