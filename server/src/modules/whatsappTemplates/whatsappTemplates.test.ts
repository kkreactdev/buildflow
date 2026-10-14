import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { PERMISSION_CATALOG } from '../../core/permissions/catalog';
import { TEMPLATE_VARIABLES, analyzeTemplate } from '../../lib/templateVariables';
import { useTestDb } from '../../test/db';
import { AuditLogs, seedAll } from '../../test/factories';
import { api, grant, peopleWorld, revoke } from '../../test/people';
import { isMasterReferenced } from '../masters/references';
import { WhatsAppTemplate } from './whatsappTemplate.model';

const app = buildApp();
useTestDb();
beforeEach(seedAll);

async function world() {
  const w = await peopleWorld(app);
  // No categories or events are seeded (administrators define their own), so the tests create the ones they need.
  const make = async (type: string, labels: Record<string, string>) => {
    const out: Record<string, string> = {};
    for (const [code, label] of Object.entries(labels)) out[code] = (await request(app).post(api(`/masters/${type}`)).set(w.admin.auth).send({ label })).body.data._id as string;
    return out;
  };
  const cat = await make('WA_CATEGORY', { SITE_VISIT: 'Site visit', GENERAL: 'General' });
  const ev = await make('WA_EVENT', { SITE_VISIT_REMINDER: 'Site visit reminder', SITE_VISIT_SCHEDULED: 'Site visit scheduled', BOOKING_CONFIRMED: 'Booking confirmed', BOOKING_RELEASED: 'Booking released' });
  return { w, cat, ev };
}
const create = (who: { auth: Record<string, string> }, body: Record<string, unknown>) => request(app).post(api('/whatsapp-templates')).set(who.auth).send(body);
const patch = (who: { auth: Record<string, string> }, id: string, body: Record<string, unknown>) => request(app).patch(api(`/whatsapp-templates/${id}`)).set(who.auth).send(body);
const list = (who: { auth: Record<string, string> }, q = '') => request(app).get(api(`/whatsapp-templates${q}`)).set(who.auth);
const names = (res: request.Response) => (res.body.data as { name: string }[]).map((t) => t.name);
const good = (cat: Record<string, string>, ev: Record<string, string>, over: Record<string, unknown> = {}) => ({ name: 'Visit reminder', categoryId: cat.SITE_VISIT, eventId: ev.SITE_VISIT_REMINDER, body: 'Hi {{client_name}}, your visit to {{unit_name}} is on {{visit_datetime}}.', ...over });

describe('placeholder rules (pure)', () => {
  it('accepts supported placeholders once each and reports every problem together', () => {
    expect(analyzeTemplate('Hi {{client_name}}, {{client_name}} see {{unit_location_url}}').variables).toEqual(['client_name', 'unit_location_url']);
    expect(analyzeTemplate('No placeholders at all').issues).toEqual([]);
    const bad = analyzeTemplate('{{foo}} {{ client_name }} {{client_name} {{}} {{Client_Name}} {{a-b}} }');
    expect(bad.issues.length).toBeGreaterThanOrEqual(5);
    expect(bad.issues.map((i) => i.message).join('\n')).toMatch(/Unsupported placeholder \{\{foo\}\}/);
    expect(bad.issues.map((i) => i.message).join('\n')).toMatch(/Malformed/);
    expect(analyzeTemplate('{{{{client_name}}}}').issues.length).toBeGreaterThan(0); // nesting
    expect(analyzeTemplate('a { b').issues.length).toBe(1); // a stray brace
    expect(TEMPLATE_VARIABLES.map((v) => v.key)).toContain('unit_location_url');
  });
});

describe('creating and reading templates', () => {
  it('creates a template; the variables are derived from the body and the masters resolve to labels', async () => {
    const { w, cat, ev } = await world();
    const res = await create(w.admin, good(cat, ev));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Visit reminder', category: { label: 'Site visit', isActive: true }, event: { label: 'Site visit reminder' }, variables: ['client_name', 'unit_name', 'visit_datetime'], isActive: true, isArchived: false, allowed: { edit: true, archive: true } });
    const stored = (await WhatsAppTemplate.findOne({}).lean())!;
    expect(stored.variables).toEqual(['client_name', 'unit_name', 'visit_datetime']);
    expect(await AuditLogs.findOne({ entityType: 'whatsappTemplate', action: 'create' }).lean()).toBeTruthy();
    expect((await request(app).get(api(`/whatsapp-templates/${res.body.data.id}`)).set(w.admin.auth)).body.data.name).toBe('Visit reminder');
  });

  it('a client-supplied variable list (or any unknown field) is refused: variables come only from the body', async () => {
    const { w, cat, ev } = await world();
    for (const extra of [{ variables: ['client_name'] }, { status: 'APPROVED' }, { provider: 'meta' }, { phone: '1' }]) expect((await create(w.admin, good(cat, ev, extra))).status, JSON.stringify(extra)).toBe(400);
    expect(await WhatsAppTemplate.countDocuments({})).toBe(0);
  });

  it('rejects unsupported and malformed placeholders and reports them on the body field', async () => {
    const { w, cat, ev } = await world();
    const res = await create(w.admin, good(cat, ev, { body: 'Hello {{customer}} {{ client_name }} and {{unit_name}' }));
    expect(res.status).toBe(400);
    const msgs = (res.body.error.details as { path: string; message: string }[]).filter((d) => d.path === 'body').map((d) => d.message);
    expect(msgs.length).toBeGreaterThanOrEqual(3);
    expect(msgs.join(' ')).toContain('{{customer}}');
    for (const body of ['{{client_name}', '{{}}', '{{Client_Name}}', '{{{{client_name}}}}', 'x }', '', '   ', 'a'.repeat(1025)]) expect((await create(w.admin, good(cat, ev, { body }))).status, body.slice(0, 20)).toBe(400);
    expect(await WhatsAppTemplate.countDocuments({})).toBe(0);
  });

  it('category and event are masters: required, existing, of the right type and ACTIVE', async () => {
    const { w, cat, ev } = await world();
    for (const bad of [{ categoryId: undefined }, { categoryId: 'nope' }, { categoryId: new Types.ObjectId().toHexString() }, { categoryId: ev.SITE_VISIT_REMINDER }, { eventId: cat.SITE_VISIT }, { eventId: undefined }]) {
      expect((await create(w.admin, good(cat, ev, bad))).status, JSON.stringify(bad)).toBe(400);
    }
    await request(app).patch(api(`/masters/WA_CATEGORY/${cat.GENERAL}`)).set(w.admin.auth).send({ isActive: false });
    expect((await create(w.admin, good(cat, ev, { categoryId: cat.GENERAL }))).status).toBe(400);
  });

  it('a name is unique per event (race-safe); archiving frees it', async () => {
    const { w, cat, ev } = await world();
    const rs = await Promise.all(Array.from({ length: 5 }, () => create(w.admin, good(cat, ev))));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409).map((r) => r.body.error.code)).toEqual(Array(4).fill('TEMPLATE_NAME_TAKEN'));
    expect(await WhatsAppTemplate.countDocuments({})).toBe(1);
    expect((await create(w.admin, good(cat, ev, { name: '  VISIT REMINDER ' }))).status).toBe(409); // case and spaces do not make a new name
    expect((await create(w.admin, good(cat, ev, { eventId: ev.SITE_VISIT_SCHEDULED }))).status).toBe(201); // same name, other event
    const id = rs.find((r) => r.status === 201)!.body.data.id;
    expect((await request(app).delete(api(`/whatsapp-templates/${id}`)).set(w.admin.auth)).status).toBe(204);
    expect((await create(w.admin, good(cat, ev))).status).toBe(201);
  }, 60_000);
});

describe('visibility and permissions (company-wide, like the global masters)', () => {
  it('reading needs whatsapp_masters.view, changing needs manage AND access to all branches; everyone who may read sees the same list', async () => {
    const { w, cat, ev } = await world();
    const t = (await create(w.admin, good(cat, ev))).body.data;
    expect((await request(app).get(api('/whatsapp-templates')).send()).status).toBe(401);
    expect((await list(w.mgrA)).status).toBe(403); // the manager role holds neither permission
    await grant('MANAGER', 'whatsapp_masters.view');
    expect(names(await list(w.mgrA))).toEqual(['Visit reminder']); // a branch-scoped user reads the company-wide list...
    expect(names(await list(w.mgrB))).toEqual(['Visit reminder']); // ...and so does every other branch
    expect((await list(w.mgrA)).body.data[0].allowed).toEqual({ edit: false, archive: false });
    expect((await create(w.mgrA, good(cat, ev, { name: 'Mine' }))).status).toBe(403);
    await grant('MANAGER', 'whatsapp_masters.manage');
    const branchWrite = await create(w.mgrA, good(cat, ev, { name: 'Mine' }));
    expect(branchWrite.status).toBe(403); // manage permission alone is not enough for a branch-scoped user
    expect(branchWrite.body.error.message).toMatch(/company-wide/);
    expect((await patch(w.mgrA, t.id, { isActive: false })).status).toBe(403);
    expect((await request(app).delete(api(`/whatsapp-templates/${t.id}`)).set(w.mgrA.auth)).status).toBe(403);
    expect(await WhatsAppTemplate.countDocuments({})).toBe(1);
    await revoke('ADMIN', 'whatsapp_masters.manage');
    expect((await create(w.admin, good(cat, ev, { name: 'Another' }))).status).toBe(403);
  });

  it('the catalog and the variable list are exposed; there is no send or test-send route', async () => {
    const { w, cat, ev } = await world();
    expect(PERMISSION_CATALOG.whatsapp_masters).toEqual(['view', 'manage']);
    const vars = (await request(app).get(api('/whatsapp-templates/variables')).set(w.admin.auth)).body.data as { key: string; token: string }[];
    expect(vars.map((v) => v.key)).toEqual(TEMPLATE_VARIABLES.map((v) => v.key));
    expect(vars.find((v) => v.key === 'client_name')!.token).toBe('{{client_name}}');
    const t = (await create(w.admin, good(cat, ev))).body.data;
    for (const p of [`/whatsapp-templates/${t.id}/send`, `/whatsapp-templates/${t.id}/test`, '/whatsapp/send', '/whatsapp-templates/send']) {
      expect([404, 405], p).toContain((await request(app).post(api(p)).set(w.admin.auth).send({})).status);
    }
  });
});

describe('editing and archiving', () => {
  it('edits fields; a new body re-derives the variables; audit records before and after', async () => {
    const { w, cat, ev } = await world();
    const t = (await create(w.admin, good(cat, ev))).body.data;
    const res = await patch(w.admin, t.id, { name: 'Visit reminder v2', body: 'See {{unit_location_url}}', isActive: false, categoryId: cat.GENERAL, eventId: ev.SITE_VISIT_SCHEDULED });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Visit reminder v2', variables: ['unit_location_url'], isActive: false, category: { label: 'General' }, event: { label: 'Site visit scheduled' } });
    expect(await AuditLogs.findOne({ entityType: 'whatsappTemplate', action: 'update' }).lean()).toMatchObject({ changes: { name: { from: 'Visit reminder', to: 'Visit reminder v2' }, isActive: { from: true, to: false } } });
    expect((await patch(w.admin, t.id, { body: 'Bad {{nope}}' })).status).toBe(400);
    for (const bad of [{}, { variables: [] }, { nameKey: 'x' }, { isArchived: true }, { categoryId: ev.SITE_VISIT_REMINDER }]) expect((await patch(w.admin, t.id, bad)).status, JSON.stringify(bad)).toBe(400);
    expect((await patch(w.admin, new Types.ObjectId().toHexString(), { isActive: true })).status).toBe(404);
    expect((await WhatsAppTemplate.findOne({ _id: t.id }).lean())!.variables).toEqual(['unit_location_url']);
  });

  it('renaming into a taken name is a clash', async () => {
    const { w, cat, ev } = await world();
    await create(w.admin, good(cat, ev, { name: 'First' }));
    const b = (await create(w.admin, good(cat, ev, { name: 'Second' }))).body.data;
    expect((await patch(w.admin, b.id, { name: 'first' })).body.error.code).toBe('TEMPLATE_NAME_TAKEN');
  });

  it('archiving hides the template from normal lists, keeps it for history, and cannot be repeated or edited', async () => {
    const { w, cat, ev } = await world();
    const t = (await create(w.admin, good(cat, ev))).body.data;
    expect((await request(app).delete(api(`/whatsapp-templates/${t.id}`)).set(w.admin.auth)).status).toBe(204);
    expect((await list(w.admin)).body.meta.total).toBe(0);
    expect(names(await list(w.admin, '?isArchived=true'))).toEqual(['Visit reminder']);
    const detail = (await request(app).get(api(`/whatsapp-templates/${t.id}`)).set(w.admin.auth)).body.data;
    expect(detail).toMatchObject({ isArchived: true, isActive: false, allowed: { edit: false, archive: false } });
    expect((await request(app).delete(api(`/whatsapp-templates/${t.id}`)).set(w.admin.auth)).status).toBe(404);
    expect((await patch(w.admin, t.id, { name: 'New name' })).status).toBe(404);
    expect(await AuditLogs.countDocuments({ entityType: 'whatsappTemplate', action: 'archive' })).toBe(1);
    expect((await WhatsAppTemplate.countDocuments({ _id: t.id }))).toBe(1); // never physically deleted
  });
});

describe('master dependencies and history', () => {
  it('a category or event used by a template cannot be deleted; a retired one still displays and the template stays editable', async () => {
    const { w, cat, ev } = await world();
    const t = (await create(w.admin, good(cat, ev))).body.data;
    expect(await isMasterReferenced('WA_CATEGORY', new Types.ObjectId(cat.SITE_VISIT))).toBe(true);
    expect(await isMasterReferenced('WA_EVENT', new Types.ObjectId(ev.SITE_VISIT_REMINDER))).toBe(true);
    expect(await isMasterReferenced('WA_EVENT', new Types.ObjectId(ev.BOOKING_RELEASED))).toBe(false);
    expect((await request(app).delete(api(`/masters/WA_CATEGORY/${cat.SITE_VISIT}`)).set(w.admin.auth)).body.error.code).toBe('IN_USE');
    expect((await request(app).delete(api(`/masters/WA_EVENT/${ev.SITE_VISIT_REMINDER}`)).set(w.admin.auth)).body.error.code).toBe('IN_USE');
    expect((await request(app).delete(api(`/masters/WA_EVENT/${ev.BOOKING_RELEASED}`)).set(w.admin.auth)).status).toBe(204);
    await request(app).patch(api(`/masters/WA_CATEGORY/${cat.SITE_VISIT}`)).set(w.admin.auth).send({ isActive: false });
    await request(app).patch(api(`/masters/WA_EVENT/${ev.SITE_VISIT_REMINDER}`)).set(w.admin.auth).send({ isActive: false });
    const detail = (await request(app).get(api(`/whatsapp-templates/${t.id}`)).set(w.admin.auth)).body.data;
    expect(detail.category).toMatchObject({ label: 'Site visit', isActive: false });
    expect(detail.event).toMatchObject({ label: 'Site visit reminder', isActive: false });
    expect((await list(w.admin)).body.data[0].category.isActive).toBe(false);
    expect((await patch(w.admin, t.id, { body: 'Updated {{client_name}}' })).status).toBe(200); // unchanged retired masters do not block edits
    expect((await patch(w.admin, t.id, { categoryId: cat.SITE_VISIT })).status).toBe(200);
    expect((await patch(w.admin, t.id, { categoryId: cat.GENERAL })).status).toBe(200);
    expect((await patch(w.admin, t.id, { categoryId: cat.SITE_VISIT })).status).toBe(400); // but a retired one cannot be CHOSEN again
  });
});

describe('listing', () => {
  it('searches and filters on the server, sorts and paginates', async () => {
    const { w, cat, ev } = await world();
    await create(w.admin, good(cat, ev, { name: 'Alpha', body: 'Alpha {{client_name}}' }));
    await create(w.admin, good(cat, ev, { name: 'Beta', categoryId: cat.GENERAL, eventId: ev.BOOKING_CONFIRMED, body: 'Booked {{booking_no}}', isActive: false }));
    expect(names(await list(w.admin))).toEqual(['Alpha', 'Beta']);
    expect(names(await list(w.admin, '?search=booked'))).toEqual(['Beta']);
    expect(names(await list(w.admin, '?search=alpha'))).toEqual(['Alpha']);
    expect(names(await list(w.admin, '?search=%5E.*'))).toEqual([]);
    expect(names(await list(w.admin, `?categoryId=${cat.GENERAL}`))).toEqual(['Beta']);
    expect(names(await list(w.admin, `?eventId=${ev.SITE_VISIT_REMINDER}`))).toEqual(['Alpha']);
    expect(names(await list(w.admin, '?isActive=false'))).toEqual(['Beta']);
    expect(names(await list(w.admin, '?sort=-name'))).toEqual(['Beta', 'Alpha']);
    const p = await list(w.admin, '?limit=1&page=2');
    expect(names(p)).toEqual(['Beta']);
    expect(p.body.meta).toMatchObject({ page: 2, limit: 1, total: 2 });
    for (const bad of ['?limit=1000', '?categoryId=nope', '?isActive=maybe']) expect((await list(w.admin, bad)).status, bad).toBe(400);
  });
});
