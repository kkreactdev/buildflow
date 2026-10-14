import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp, session } from '../../test/render';
import { ClientsRoutes } from './ClientsRoutes';

const CLIENT = {
  id: 'c1', clientNo: 'CL-000001', personId: 'p1', name: 'Raj Kumar', phone: '+91 98765 43210', phoneE164: '+919876543210', branchId: 'b1', branch: { name: 'Chennai', code: 'CHN' },
  categoryId: 'cat1', category: { id: 'cat1', label: 'Gold', isActive: false, color: '#b45309' }, assignedToName: 'Asha', notes: 'Prefers evenings', isArchived: false, createdAt: '2026-01-05T10:00:00Z',
};
const DETAIL = { ...CLIENT, person: { id: 'p1', name: 'Raj Kumar', phone: '+91 98765 43210', phoneE164: '+919876543210', email: 'raj@x.com', address: '1 Main Rd', branchIds: ['b1'] }, relationships: [{ id: 'c2', clientNo: 'CL-000009', branchId: 'b2', branch: { name: 'Madurai' } }] };

const ok = (data, meta) => ({ ok: true, status: 200, json: async () => ({ data, ...(meta ? { meta } : {}) }) });
const fail = (status, code, message, details) => ({ ok: false, status, json: async () => ({ error: { code, message, details } }) });

function mockApi(routes = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace('/api/v1', '');
    const key = `${method} ${path.split('?')[0]}`;
    calls.push({ method, path, key, body: init.body ? JSON.parse(init.body) : undefined });
    if (routes[key]) return typeof routes[key] === 'function' ? routes[key](path, init) : routes[key];
    if (key === 'GET /clients') return ok([CLIENT], { page: 1, limit: 25, total: 1 });
    if (key === 'GET /clients/c1') return ok(DETAIL);
    if (key === 'GET /clients/c1/related') return ok({ clientId: 'c1', enquiries: { rows: [] }, followUps: { rows: [] }, siteVisits: { rows: [] }, bookings: { rows: [] }, units: { rows: [] } });
    if (key === 'GET /masters') return ok({ CLIENT_CATEGORY: [{ _id: 'cat2', code: 'SILVER', label: 'Silver', isActive: true }], ACTIVITY_TYPE: [{ _id: 'a1', code: 'CLIENT_CREATED', label: 'Client created', isActive: true }] });
    if (key === 'GET /activities') return ok([{ _id: 'x1', type: 'CLIENT_CREATED', description: 'Client Raj Kumar (CL-000001) created', at: '2026-01-05T10:00:00Z' }], { page: 1, limit: 50, total: 1 });
    if (key === 'GET /branches') return ok([{ _id: 'b1', name: 'Chennai', isActive: true }, { _id: 'b2', name: 'Madurai', isActive: true }], { page: 1, limit: 100, total: 2 });
    throw new Error(`unmocked ${key}`);
  }));
  return calls;
}
const wrap = (ui) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const app = (route, s) => renderWithApp(wrap(<Routes><Route path="/clients/*" element={<ClientsRoutes />} /></Routes>), { session: s, route });
const manager = session(['clients.view', 'clients.create', 'clients.edit', 'clients.archive', 'persons.lookup', 'persons.link', 'persons.edit', 'activities.view'], { dataScope: 'BRANCH', branchIds: ['b1'] });
const viewer = session(['clients.view'], { dataScope: 'BRANCH', branchIds: ['b1'] });
afterEach(() => vi.unstubAllGlobals());

describe('Clients list', () => {
  it('shows server-driven rows, and the category of a client even if that category is now inactive', async () => {
    mockApi();
    app('/clients', manager);
    expect(await screen.findByText('Raj Kumar')).toBeTruthy();
    expect(screen.getByText('CL-000001')).toBeTruthy();
    expect(screen.getByText('+91 98765 43210')).toBeTruthy();
    expect(screen.getByText('Gold (inactive)')).toBeTruthy(); // history keeps its meaning
  });

  it('sends search, filters and paging to the server (no client-side filtering)', async () => {
    const calls = mockApi();
    app('/clients?page=2&search=raj&categoryId=cat2', manager);
    await screen.findByText('Raj Kumar');
    const req = calls.find((c) => c.key === 'GET /clients');
    expect(req.path).toContain('page=2');
    expect(req.path).toContain('search=raj');
    expect(req.path).toContain('categoryId=cat2');
    expect(screen.getByRole('searchbox').value).toBe('raj');
  });

  it('the category filter comes from the CLIENT_CATEGORY master, not from code', async () => {
    mockApi();
    app('/clients', manager);
    await screen.findByText('Raj Kumar');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Silver' })).toBeTruthy());
  });

  it('read-only users cannot create or archive; managers can', async () => {
    mockApi();
    const { unmount } = app('/clients', viewer);
    await screen.findByText('Raj Kumar');
    expect(screen.queryByRole('button', { name: 'New client' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.queryByText('Archive')).toBeNull();
    unmount();
    app('/clients', manager);
    await screen.findByText('Raj Kumar');
    expect(screen.getByRole('button', { name: 'New client' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getByText('Archive')).toBeTruthy();
  });

  it('archiving asks for confirmation, then calls the API', async () => {
    const calls = mockApi({ 'DELETE /clients/c1': { ok: true, status: 204, json: async () => ({}) } });
    app('/clients', manager);
    await screen.findByText('Raj Kumar');
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByText('Archive'));
    expect(await screen.findByText(/history is kept/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'DELETE /clients/c1')).toBe(true));
  });

  it('empty and error states', async () => {
    mockApi({ 'GET /clients': ok([], { page: 1, limit: 25, total: 0 }) });
    const { unmount } = app('/clients', manager);
    expect(await screen.findByText('No clients yet')).toBeTruthy();
    unmount();
    mockApi({ 'GET /clients': fail(500, 'INTERNAL_ERROR', 'boom') });
    app('/clients', manager);
    expect(await screen.findByText('Could not load data')).toBeTruthy();
  });
});

describe('New client: duplicate detection flow', () => {
  async function open(routes) {
    const calls = mockApi(routes);
    app('/clients', manager);
    await screen.findByText('Raj Kumar');
    fireEvent.click(screen.getByRole('button', { name: 'New client' }));
    await screen.findByLabelText(/^Phone/);
    return calls;
  }
  const typePhone = (v) => {
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: v } });
    fireEvent.blur(screen.getByLabelText(/^Phone/));
  };

  it('no existing person: creates the person with the client', async () => {
    const calls = await open({ 'POST /persons/lookup': ok({ status: 'NONE', phoneE164: '+919876543210' }), 'POST /clients': ok({ ...CLIENT, id: 'c9', clientNo: 'CL-000009' }), 'GET /clients/c9': ok({ ...DETAIL, id: 'c9' }) });
    typePhone('98765 43210');
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Raj Kumar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create client' }));
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /clients')?.body).toEqual({ person: { name: 'Raj Kumar', phone: '98765 43210' } }));
  });

  it('invalid phone is stopped on the client with a message, and never sent', async () => {
    const calls = await open();
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Raj Kumar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create client' }));
    expect(await screen.findByText('Enter a valid phone number')).toBeTruthy();
    expect(calls.some((c) => c.key === 'POST /clients')).toBe(false);
    expect(calls.some((c) => c.key === 'POST /persons/lookup')).toBe(false);
  });

  it('visible match: shows the existing record and requires an explicit "Use this person"; the request then carries personId only', async () => {
    const person = { id: 'p7', name: 'Existing Esha', phone: '+91 98765 43210', phoneE164: '+919876543210' };
    const calls = await open({ 'POST /persons/lookup': ok({ status: 'VISIBLE_MATCH', phoneE164: '+919876543210', person, clients: [{ id: 'c5', clientNo: 'CL-000005', branchId: 'b1' }] }), 'POST /clients': ok({ ...CLIENT, id: 'c9', clientNo: 'CL-000009' }), 'GET /clients/c9': ok({ ...DETAIL, id: 'c9' }) });
    typePhone('9876543210');
    expect(await screen.findByText('This person already exists')).toBeTruthy();
    expect(screen.getByText(/Existing Esha/)).toBeTruthy();
    expect(screen.getByText(/CL-000005/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use this person' }));
    expect(await screen.findByText('Using existing person')).toBeTruthy();
    expect(screen.queryByLabelText(/^Name/)).toBeNull(); // identity fields are not re-entered
    fireEvent.click(screen.getByRole('button', { name: 'Create client' }));
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /clients')?.body).toEqual({ personId: 'p7' }));
  });

  it('match in another branch: existence only; a manager can link with a reason, then proceeds with that person', async () => {
    const linked = { id: 'p8', name: 'Linked Lena', phone: '+91 98765 43210', phoneE164: '+919876543210' };
    const calls = await open({
      'POST /persons/lookup': ok({ status: 'HIDDEN_MATCH', phoneE164: '+919876543210', canLink: true }),
      'POST /persons/link': ok({ linked: true, person: linked }),
      'POST /clients': ok({ ...CLIENT, id: 'c9', clientNo: 'CL-000009' }),
      'GET /clients/c9': ok({ ...DETAIL, id: 'c9' }),
    });
    typePhone('9876543210');
    expect(await screen.findByText('This number is already registered with another branch')).toBeTruthy();
    const link = screen.getByRole('button', { name: 'Link to my branch' });
    expect(link.disabled).toBe(true); // a reason is required
    fireEvent.change(screen.getByLabelText('Reason for linking'), { target: { value: 'Relocated' } });
    fireEvent.click(link);
    await screen.findByText('Using existing person');
    expect(calls.find((c) => c.key === 'POST /persons/link').body).toEqual({ phone: '9876543210', reason: 'Relocated' });
    fireEvent.click(screen.getByRole('button', { name: 'Create client' }));
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /clients')?.body).toEqual({ personId: 'p8' }));
  });

  it('a user who may not link is simply told to ask a manager (and sees nothing about the person)', async () => {
    mockApi({ 'POST /persons/lookup': ok({ status: 'HIDDEN_MATCH', phoneE164: '+919876543210', canLink: false }) });
    app('/clients', session(['clients.view', 'clients.create', 'persons.lookup'], { dataScope: 'OWN', branchIds: ['b1'] }));
    await screen.findByText('Raj Kumar');
    fireEvent.click(screen.getByRole('button', { name: 'New client' }));
    typePhone('9876543210');
    expect(await screen.findByText(/Ask a manager to link/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Link to my branch' })).toBeNull();
  });

  it('a duplicate caught by the server (race) is shown as a match, not a crash', async () => {
    const person = { id: 'p7', name: 'Just Created', phone: '+91 98765 43210' };
    await open({ 'POST /persons/lookup': ok({ status: 'NONE', phoneE164: '+919876543210' }), 'POST /clients': fail(409, 'PERSON_EXISTS', 'exists', { status: 'VISIBLE_MATCH', person, clients: [] }) });
    typePhone('9876543210');
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Raj Kumar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create client' }));
    expect(await screen.findByText('This person already exists')).toBeTruthy();
    expect(screen.getByText(/Just Created/)).toBeTruthy();
  });

  it('without persons.lookup the form still works; the server remains the guard', async () => {
    const calls = mockApi({ 'POST /clients': ok({ ...CLIENT, id: 'c9' }), 'GET /clients/c9': ok({ ...DETAIL, id: 'c9' }) });
    app('/clients', session(['clients.view', 'clients.create'], { dataScope: 'OWN', branchIds: ['b1'] }));
    await screen.findByText('Raj Kumar');
    fireEvent.click(screen.getByRole('button', { name: 'New client' }));
    typePhone('9876543210');
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Raj Kumar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create client' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /clients')).toBe(true));
    expect(calls.some((c) => c.key === 'POST /persons/lookup')).toBe(false);
  });

  it('ALL scope must pick a branch', async () => {
    const calls = mockApi();
    app('/clients', session(['clients.view', 'clients.create'], { dataScope: 'ALL' }));
    await screen.findByText('Raj Kumar');
    fireEvent.click(screen.getByRole('button', { name: 'New client' }));
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: '9876543210' } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Raj Kumar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create client' }));
    expect(await screen.findByText('Choose a branch')).toBeTruthy();
    expect(calls.some((c) => c.key === 'POST /clients')).toBe(false);
  });
});

describe('Client detail', () => {
  it('shows identity, relationship, genuinely empty related sections, and the timeline', async () => {
    mockApi();
    app('/clients/c1', manager);
    expect(await screen.findByRole('heading', { name: /Raj Kumar/ })).toBeTruthy();
    expect(screen.getByText('raj@x.com')).toBeTruthy();
    expect(screen.getByText('1 Main Rd')).toBeTruthy();
    expect(screen.getByText('Chennai')).toBeTruthy();
    expect(screen.getByText('Prefers evenings')).toBeTruthy();
    expect(screen.getByText('Gold (inactive)')).toBeTruthy();
    for (const t of ['No enquiries', 'No follow-ups', 'No site visits', 'No units yet']) expect(await screen.findByText(t)).toBeTruthy(); // empty only because the server returned nothing
    expect(screen.getByText('Other branch relationships you can see')).toBeTruthy();
    expect(screen.getByText('CL-000009')).toBeTruthy();
    expect(await screen.findByText('Client Raj Kumar (CL-000001) created')).toBeTruthy();
    expect(screen.getByText(/Client created ·/)).toBeTruthy(); // label from the ACTIVITY_TYPE master
  });

  it('hides the timeline without activities.view, and edit/archive without their permissions', async () => {
    const calls = mockApi();
    app('/clients/c1', viewer);
    await screen.findByRole('heading', { name: /Raj Kumar/ });
    expect(screen.queryByText('Activity')).toBeNull();
    expect(calls.some((c) => c.key === 'GET /activities')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
  });

  it('a timeline the server refuses is shown as unavailable, not as an empty/forged list', async () => {
    mockApi({ 'GET /activities': fail(404, 'NOT_FOUND', 'Not found') });
    app('/clients/c1', manager);
    expect(await screen.findByText('Timeline unavailable')).toBeTruthy();
  });

  it('a client the server cannot find (or the caller may not see) is just "not found"', async () => {
    mockApi({ 'GET /clients/c1': fail(404, 'NOT_FOUND', 'Client not found') });
    app('/clients/c1', manager);
    expect(await screen.findByText('Could not load data')).toBeTruthy();
    expect(screen.getByText('Client not found')).toBeTruthy();
  });

  it('editing sends relationship changes to the client and identity changes to the person (only with persons.edit)', async () => {
    const calls = mockApi({ 'PATCH /clients/c1': ok(CLIENT), 'PATCH /persons/p1': ok({}) });
    app('/clients/c1', manager);
    await screen.findByRole('heading', { name: /Raj Kumar/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: 'Rajkumar S' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Updated note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /persons/p1')).toBe(true));
    expect(calls.find((c) => c.key === 'PATCH /clients/c1').body).toEqual({ categoryId: 'cat1', notes: 'Updated note' });
    expect(calls.find((c) => c.key === 'PATCH /persons/p1').body).toEqual({ name: 'Rajkumar S' });
  });

  it('without persons.edit the identity fields are not even offered', async () => {
    mockApi();
    app('/clients/c1', session(['clients.view', 'clients.edit'], { dataScope: 'BRANCH', branchIds: ['b1'] }));
    await screen.findByRole('heading', { name: /Raj Kumar/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByLabelText('Notes');
    expect(screen.queryByLabelText(/^Name/)).toBeNull();
    expect(screen.getByText(/is inactive; it stays until you choose another/)).toBeTruthy();
  });
});
