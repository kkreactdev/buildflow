import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../app/App';
import { renderWithApp, session } from '../../test/render';
import { checkBody } from './templateCheck';
import { WhatsAppTemplatesPage } from './WhatsAppTemplatesPage';

const ok = (data, meta) => ({ ok: true, status: 200, json: async () => ({ data, ...(meta ? { meta } : {}) }) });
const noContent = { ok: true, status: 204, json: async () => ({}) };
const fail = (status, code, message, details) => ({ ok: false, status, json: async () => ({ error: { code, message, details } }) });
const EDITABLE = { edit: true, archive: true };
const LOCKED = { edit: false, archive: false };

const tpl = (id, name, over = {}) => ({
  id, name, categoryId: 'c1', category: { label: 'Site visit', isActive: true }, eventId: 'e1', event: { label: 'Site visit reminder', isActive: true },
  body: 'Hi {{client_name}}, see you at {{unit_name}}.', variables: ['client_name', 'unit_name'], isActive: true, isArchived: false, allowed: EDITABLE, ...over,
});
const T1 = tpl('t1', 'Visit reminder');
const T2 = tpl('t2', 'Booking thanks', { category: { label: 'Booking', isActive: false }, event: { label: 'Booking confirmed', isActive: true }, body: 'Booked {{booking_no}}', variables: ['booking_no'], isActive: false });
const VARS = [
  { key: 'client_name', label: 'Customer name', description: "The person's name", token: '{{client_name}}' },
  { key: 'unit_name', label: 'Unit name', description: 'The unit', token: '{{unit_name}}' },
  { key: 'booking_no', label: 'Booking number', description: 'BK-…', token: '{{booking_no}}' },
];
const MASTERS = {
  WA_CATEGORY: [{ _id: 'c1', code: 'SITE_VISIT', label: 'Site visit', isActive: true }, { _id: 'c2', code: 'BOOKING', label: 'Booking', isActive: true }],
  WA_EVENT: [{ _id: 'e1', code: 'SITE_VISIT_REMINDER', label: 'Site visit reminder', isActive: true }, { _id: 'e2', code: 'BOOKING_CONFIRMED', label: 'Booking confirmed', isActive: true }],
};

function mockApi(routes = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace('/api/v1', '');
    const key = `${method} ${path.split('?')[0]}`;
    calls.push({ method, path, key, body: init.body ? JSON.parse(init.body) : undefined });
    if (routes[key]) return typeof routes[key] === 'function' ? routes[key](path, init) : routes[key];
    if (key === 'GET /whatsapp-templates') return ok([T1, T2], { page: 1, limit: 25, total: 2 });
    if (key === 'GET /whatsapp-templates/variables') return ok(VARS);
    if (key === 'GET /masters') return ok(MASTERS);
    throw new Error(`unmocked ${key}`);
  }));
  return calls;
}
const wrap = (ui) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const page = (s, route = '/whatsapp-templates') => renderWithApp(wrap(<WhatsAppTemplatesPage />), { session: s, route });
const admin = session(['whatsapp_masters.view', 'whatsapp_masters.manage'], { dataScope: 'ALL', branchIds: [] });
const branchManager = session(['whatsapp_masters.view', 'whatsapp_masters.manage'], { dataScope: 'BRANCH', branchIds: ['b1'] });
const reader = session(['whatsapp_masters.view'], { dataScope: 'BRANCH', branchIds: ['b1'] });
const writes = (calls) => calls.filter((c) => c.method !== 'GET');
afterEach(() => vi.unstubAllGlobals());

describe('placeholder check (instant feedback; the server decides)', () => {
  it('mirrors the server rules', () => {
    const keys = VARS.map((v) => v.key);
    expect(checkBody('Hi {{client_name}} {{unit_name}}', keys)).toEqual([]);
    expect(checkBody('{{nope}}', keys)[0]).toMatch(/Unsupported placeholder \{\{nope\}\}/);
    expect(checkBody('{{ client_name }}', keys)[0]).toMatch(/Malformed/);
    expect(checkBody('{{}}', keys)[0]).toMatch(/Malformed/);
    expect(checkBody('{{client_name}', keys)[0]).toMatch(/Malformed/);
    expect(checkBody('plain text', keys)).toEqual([]);
  });
});

describe('WhatsApp templates list', () => {
  it('shows templates with category and event labels (inactive marked), placeholders and state', async () => {
    mockApi();
    page(admin);
    expect(await screen.findByText('Visit reminder')).toBeTruthy();
    expect(screen.getByText('Booking (inactive)')).toBeTruthy(); // a retired category still reads
    expect(screen.getByText('client_name, unit_name')).toBeTruthy();
    expect(screen.getByText('Enabled', { selector: '.pill' })).toBeTruthy();
    expect(screen.getByText('Disabled', { selector: '.pill' })).toBeTruthy();
    expect(screen.getByText(/Messages are not sent from BuildFlow yet/)).toBeTruthy();
  });

  it('search, master filters, state and paging go to the server', async () => {
    const calls = mockApi();
    page(admin, '/whatsapp-templates?search=visit&categoryId=c1&eventId=e1&isActive=false&sort=-name&page=2');
    await screen.findByText('Visit reminder');
    const req = calls.find((c) => c.key === 'GET /whatsapp-templates');
    for (const part of ['search=visit', 'categoryId=c1', 'eventId=e1', 'isActive=false', 'sort=-name', 'page=2']) expect(req.path).toContain(part);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Booking confirmed' })).toBeTruthy()); // options come from the masters
  });

  it('only an all-branches administrator with manage rights can change templates; others read', async () => {
    mockApi();
    const { unmount } = page(branchManager);
    await screen.findByText('Visit reminder');
    expect(screen.queryByRole('button', { name: 'New template' })).toBeNull(); // company-wide: manage alone is not enough
    unmount();
    mockApi({ 'GET /whatsapp-templates': ok([tpl('t1', 'Visit reminder', { allowed: LOCKED })], { page: 1, limit: 25, total: 1 }) });
    const { unmount: u2 } = page(reader);
    await screen.findByText('Visit reminder');
    expect(screen.queryByRole('button', { name: 'New template' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull();
    u2();
    mockApi();
    page(admin);
    expect(await screen.findByRole('button', { name: 'New template' })).toBeTruthy();
  });

  it('enable / disable posts only the flag; archiving asks first', async () => {
    const calls = mockApi({ 'PATCH /whatsapp-templates/t1': ok(T1), 'DELETE /whatsapp-templates/t1': noContent });
    page(admin);
    await screen.findByText('Visit reminder');
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disable' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'PATCH /whatsapp-templates/t1', body: { isActive: false } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog');
    expect(writes(calls)).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(writes(calls)[1]?.key).toBe('DELETE /whatsapp-templates/t1'));
  });

  it('empty and error states', async () => {
    mockApi({ 'GET /whatsapp-templates': ok([], { page: 1, limit: 25, total: 0 }) });
    const { unmount } = page(admin);
    expect(await screen.findByText('No templates yet')).toBeTruthy();
    unmount();
    mockApi({ 'GET /whatsapp-templates': fail(500, 'INTERNAL_ERROR', 'boom') });
    page(admin);
    expect((await screen.findAllByText(/boom|Could not load/)).length).toBeGreaterThan(0);
  });
});

describe('template editor', () => {
  async function open() {
    const calls = mockApi({ 'POST /whatsapp-templates': { ok: true, status: 201, json: async () => ({ data: T1 }) } });
    page(admin);
    fireEvent.click(await screen.findByRole('button', { name: 'New template' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Booking' })).toBeTruthy());
    return { calls, dialog };
  }

  it('needs a name, category, event and message', async () => {
    const { calls, dialog } = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create template' }));
    expect(await within(dialog).findByText('Give the template a name')).toBeTruthy();
    for (const m of ['Choose a category', 'Choose an event', 'Write the message']) expect(within(dialog).getByText(m)).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
  });

  it('inserts placeholders from the server list at the cursor and posts the message without any variable list', async () => {
    const { calls, dialog } = await open();
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Visit reminder' } });
    fireEvent.change(within(dialog).getByLabelText(/^Category/), { target: { value: 'c1' } });
    fireEvent.change(within(dialog).getByLabelText(/^Event/), { target: { value: 'e1' } });
    const body = within(dialog).getByLabelText(/^Message/);
    fireEvent.change(body, { target: { value: 'Hi , welcome' } });
    body.setSelectionRange(3, 3);
    await waitFor(() => expect(within(within(dialog).getByRole('group', { name: 'Placeholders' })).getByRole('button', { name: 'Customer name' })).toBeTruthy());
    fireEvent.click(within(within(dialog).getByRole('group', { name: 'Placeholders' })).getByRole('button', { name: 'Customer name' }));
    await waitFor(() => expect(body.value).toBe('Hi {{client_name}}, welcome'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create template' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'POST /whatsapp-templates', body: { name: 'Visit reminder', categoryId: 'c1', eventId: 'e1', body: 'Hi {{client_name}}, welcome', isActive: true } });
    expect(Object.keys(writes(calls)[0].body)).not.toContain('variables');
  });

  it('flags unsupported and malformed placeholders while typing and blocks sending them to the server', async () => {
    const { calls, dialog } = await open();
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Bad one' } });
    fireEvent.change(within(dialog).getByLabelText(/^Category/), { target: { value: 'c1' } });
    fireEvent.change(within(dialog).getByLabelText(/^Event/), { target: { value: 'e1' } });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Customer name' })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText(/^Message/), { target: { value: 'Hello {{customer}} and {{ unit_name }}' } });
    const issues = within(within(dialog).getByLabelText('Message problems'));
    expect(issues.getByText(/Unsupported placeholder \{\{customer\}\}/)).toBeTruthy();
    expect(issues.getByText(/Malformed placeholder/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create template' }));
    await new Promise((r) => setTimeout(r, 30));
    expect(writes(calls)).toHaveLength(0);
  });

  it("shows the server's refusal (name taken / body rejected) in the dialog", async () => {
    const { dialog } = await (async () => {
      mockApi({ 'POST /whatsapp-templates': fail(409, 'TEMPLATE_NAME_TAKEN', 'A template with this name already exists for that event') });
      page(admin);
      fireEvent.click(await screen.findByRole('button', { name: 'New template' }));
      const d = await screen.findByRole('dialog');
      await waitFor(() => expect(within(d).getByRole('option', { name: 'Booking' })).toBeTruthy());
      return { dialog: d };
    })();
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Visit reminder' } });
    fireEvent.change(within(dialog).getByLabelText(/^Category/), { target: { value: 'c1' } });
    fireEvent.change(within(dialog).getByLabelText(/^Event/), { target: { value: 'e1' } });
    fireEvent.change(within(dialog).getByLabelText(/^Message/), { target: { value: 'Hello' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create template' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/already exists for that event/);
  });

  it('editing sends only the changed fields', async () => {
    const calls = mockApi({ 'PATCH /whatsapp-templates/t1': ok(T1) });
    page(admin);
    await screen.findByText('Visit reminder');
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Booking' })).toBeTruthy());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes(calls)).toHaveLength(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const d2 = await screen.findByRole('dialog');
    fireEvent.change(within(d2).getByLabelText(/^Name/), { target: { value: 'Visit reminder v2' } });
    fireEvent.click(within(d2).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'PATCH /whatsapp-templates/t1', body: { name: 'Visit reminder v2' } });
    expect(Object.keys(writes(calls)[0].body)).toEqual(['name']);
  });
});

describe('navigation', () => {
  it('is a real page in Setup for whatsapp_masters.view holders and refused by URL otherwise', async () => {
    mockApi();
    const { unmount } = renderWithApp(wrap(<AppRoutes />), { session: admin, route: '/whatsapp-templates' });
    expect((await screen.findAllByRole('heading', { name: 'WhatsApp templates' })).length).toBeGreaterThan(0);
    expect(within(screen.getByRole('navigation')).getByText('WhatsApp Templates')).toBeTruthy();
    unmount();
    renderWithApp(wrap(<AppRoutes />), { session: session(['dashboard.view']), route: '/whatsapp-templates' });
    expect(await screen.findByText(/don't have access/i)).toBeTruthy();
  });
});
