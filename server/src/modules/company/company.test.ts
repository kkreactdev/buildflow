import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { ALL_PERMISSION_KEYS } from '../../core/permissions/catalog';
import { setMediaProvider } from '../../core/storage/mediaProvider';
import { MockMediaProvider } from '../../core/storage/mockProvider';
import { useTestDb } from '../../test/db';
import { AuditLogs, seedAll } from '../../test/factories';
import { api, grant, peopleWorld, revoke } from '../../test/people';
import { FILES } from '../../test/units';

const app = buildApp();
useTestDb();
beforeEach(seedAll);

type Who = { auth: Record<string, string> };
const get = (who: Who | null, path: string) => (who ? request(app).get(api(path)).set(who.auth) : request(app).get(api(path)));
const patch = (who: Who | null, body: Record<string, unknown>) => {
  const req = request(app).patch(api('/company'));
  return who ? req.set(who.auth).send(body) : req.send(body);
};
const upload = (who: Who | null, slot: string, file?: Buffer, filename = 'logo.png') => {
  const req = who ? request(app).post(api(`/company/logo/${slot}`)).set(who.auth) : request(app).post(api(`/company/logo/${slot}`));
  return file ? req.attach('file', file, filename) : req;
};
const remove = (who: Who, slot: string) => request(app).delete(api(`/company/logo/${slot}`)).set(who.auth);

async function world() {
  const w = await peopleWorld(app);
  // The media provider is a stub in tests; make it explicit so the tests never touch a real service.
  setMediaProvider(new MockMediaProvider());
  return w;
}

describe('company profile — permissions', () => {
  it('publishes company.view and company.manage, and grants them to Admin but not to a Manager', async () => {
    expect(ALL_PERMISSION_KEYS).toContain('company.view');
    expect(ALL_PERMISSION_KEYS).toContain('company.manage');
    const w = await world();
    // ADMIN derives its permissions from the catalog, so both keys arrive without any seeding.
    expect((await get(w.admin, '/company')).status).toBe(200);
    // MANAGER's list is hand-written and does not include them.
    expect((await get(w.mgrA, '/company')).status).toBe(403);
  });

  it('needs authentication for everything except the branding the login page shows', async () => {
    await world();
    // Public: name + image URLs only, because the login page renders it before anyone signs in.
    expect((await get(null, '/company/branding')).status).toBe(200);
    // Everything else is closed.
    expect((await get(null, '/company')).status).toBe(401);
    expect((await patch(null, { displayName: 'X' })).status).toBe(401);
    expect((await upload(null, 'logo', FILES.png)).status).toBe(401);
  });

  it('refuses a role whose permission was revoked, and a branch-scoped manager', async () => {
    const w = await world();
    await revoke('ADMIN', 'company.manage');
    expect((await patch(w.admin, { displayName: 'Nope' })).status).toBe(403);
    expect((await upload(w.admin, 'logo', FILES.png)).status).toBe(403);
    await grant('ADMIN', 'company.manage');
    expect((await patch(w.admin, { displayName: 'Back' })).status).toBe(200);

    // Even holding the permission, a BRANCH-scoped user may not edit a company-wide profile.
    expect((await patch(w.mgrA, { displayName: 'Nope' })).status).toBe(403);
  });
});

describe('company profile — editing and persistence', () => {
  it('stores the name and optional details, and returns them to a later read', async () => {
    const w = await world();
    expect((await patch(w.admin, {
      displayName: 'Northwind Realty',
      legalName: 'Northwind Realty Private Limited',
      phone: '+91 44 1234 5678',
      email: 'hello@northwind.example',
      address: '12 Anna Nagar, Chennai 600040',
      website: 'https://northwind.example',
      gstin: '33AABCN1234M1Z5',
    })).status).toBe(200);

    const saved = (await get(w.admin, '/company')).body.data;
    expect(saved).toMatchObject({
      displayName: 'Northwind Realty',
      legalName: 'Northwind Realty Private Limited',
      phone: '+91 44 1234 5678',
      email: 'hello@northwind.example',
      gstin: '33AABCN1234M1Z5',
    });
  });

  it('is a singleton: updating twice keeps one profile and the latest values', async () => {
    const w = await world();
    await patch(w.admin, { displayName: 'First' });
    await patch(w.admin, { displayName: 'Second' });
    const branding = (await get(null, '/company/branding')).body.data;
    expect(branding.displayName).toBe('Second');
  });

  it('requires a display name and rejects malformed optional fields', async () => {
    const w = await world();
    expect((await patch(w.admin, { displayName: '   ' })).status).toBe(400);
    expect((await patch(w.admin, { displayName: 'X', email: 'not-an-email' })).status).toBe(400);
    expect((await patch(w.admin, { displayName: 'X', website: 'northwind.example' })).status).toBe(400);
    expect((await patch(w.admin, { displayName: 'X', gstin: 'TOO-SHORT' })).status).toBe(400);
    expect((await patch(w.admin, {})).status).toBe(400);
  });

  it('never exposes the legal details on the public branding endpoint', async () => {
    const w = await world();
    await patch(w.admin, { displayName: 'Northwind', gstin: '33AABCN1234M1Z5', email: 'hello@northwind.example', address: '12 Anna Nagar' });
    const branding = (await get(null, '/company/branding')).body.data;
    expect(Object.keys(branding).sort()).toEqual(['displayName', 'logo', 'logoDark', 'mark', 'markDark']);
    expect(JSON.stringify(branding)).not.toContain('33AABCN1234M1Z5');
    expect(JSON.stringify(branding)).not.toContain('hello@northwind.example');
  });

  it('writes an audit entry with no branch, because the profile is company-wide', async () => {
    const w = await world();
    await patch(w.admin, { displayName: 'Audited' });
    const entry = await AuditLogs.findOne({ entityType: 'company', action: 'update' }).lean();
    expect(entry).toBeTruthy();
    expect(entry!.branchId ?? null).toBeNull();
  });
});

describe('company profile — logo uploads', () => {
  it('accepts an image, stores a reference (never the bytes) and exposes the URL', async () => {
    const w = await world();
    const res = await upload(w.admin, 'logo', FILES.png);
    expect(res.status).toBe(201);
    expect(res.body.data.logo.url).toBeTruthy();

    const saved = (await get(w.admin, '/company')).body.data;
    expect(saved.logo).toMatchObject({ format: 'png', bytes: FILES.png.length });
    // The provider holds the file; the document holds a URL and a publicId, not image bytes.
    expect(JSON.stringify(saved)).not.toContain('data:image');
    expect(saved.logo.url).toMatch(/^https?:\/\//);
  });

  it('refuses anything that is not really an image, whatever the file claims to be', async () => {
    const w = await world();
    // A PDF passes the shared magic-byte check but is not a logo.
    expect((await upload(w.admin, 'logo', FILES.pdf)).status).toBe(415);
    // SVG and executables are not in the allowlist at all.
    expect((await upload(w.admin, 'logo', FILES.svg, 'logo.svg')).status).toBe(415);
    expect((await upload(w.admin, 'logo', FILES.exe, 'logo.png')).status).toBe(415);
    // A PNG renamed to .exe is still detected as a PNG by its bytes — the browser's claim is ignored.
    expect((await upload(w.admin, 'logo', FILES.png, 'whatever.exe')).status).toBe(201);
  });

  it('refuses a missing or empty file', async () => {
    const w = await world();
    expect((await upload(w.admin, 'logo', undefined)).status).toBe(400);
    expect((await upload(w.admin, 'logo', Buffer.alloc(0))).status).toBe(400);
  });

  it('only accepts the four known slots', async () => {
    const w = await world();
    expect((await upload(w.admin, 'displayName', FILES.png)).status).toBe(400);
    expect((await upload(w.admin, 'logo', FILES.png)).status).toBe(201);
  });

  it('replaces an existing image in a slot rather than accumulating them', async () => {
    const w = await world();
    await upload(w.admin, 'logo', FILES.png);
    const second = await upload(w.admin, 'logo', FILES.jpg);
    expect(second.status).toBe(201);
    const saved = (await get(w.admin, '/company')).body.data;
    expect(saved.logo.format).toBe('jpg'); // replaced, not appended
  });

  it('removes an image, clears the URL and keeps the rest of the profile', async () => {
    const w = await world();
    await patch(w.admin, { displayName: 'Keep me' });
    await upload(w.admin, 'logo', FILES.png);
    expect((await remove(w.admin, 'logo')).status).toBe(200);
    const saved = (await get(w.admin, '/company')).body.data;
    expect(saved.logo).toBeNull();
    expect(saved.displayName).toBe('Keep me');
  });

  it('falls back: a dark variant with no upload uses the light one, and a missing mark stays null', async () => {
    const w = await world();
    await upload(w.admin, 'logo', FILES.png);
    const branding = (await get(null, '/company/branding')).body.data;
    expect(branding.logo).toBeTruthy();
    // No dark logo was uploaded, so the dark theme falls back to the light asset rather than nothing.
    expect(branding.logoDark).toBe(branding.logo);
    // No mark was uploaded: the collapsed rail falls back to the bundled default, not to the full logo.
    expect(branding.mark).toBeNull();
  });

  it('is empty, not broken, before anyone has configured anything', async () => {
    const w = await world();
    const branding = (await get(null, '/company/branding')).body.data;
    expect(branding).toEqual({ displayName: '', logo: null, logoDark: null, mark: null, markDark: null });
    // The settings screen opens cleanly rather than erroring on a missing profile.
    expect((await get(w.admin, '/company')).body.data).toMatchObject({ displayName: '', logo: null });
  });
});