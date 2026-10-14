import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../app/App';
import { renderWithApp, session } from '../../test/render';
import { UnitsRoutes } from './UnitsRoutes';

const ok = (data, meta) => ({ ok: true, status: 200, json: async () => ({ data, ...(meta ? { meta } : {}) }) });
const noContent = { ok: true, status: 204, json: async () => ({}) };
const fail = (status, code, message, details) => ({ ok: false, status, json: async () => ({ error: { code, message, details } }) });
const ALL = { edit: true, assign: true, changeStatus: true, archive: true, manageMedia: true };
const NONE = { edit: false, assign: false, changeStatus: false, archive: false, manageMedia: false };
const status = (key, label, color) => ({ id: `s-${key}`, label, color, isActive: true });

const unit = (id, code, name, over = {}) => ({
  id, unitCode: code, name, branchId: 'b1', branch: { name: 'Chennai', code: 'CHN' },
  propertyType: { label: 'Villa', isActive: true }, buildingType: { label: 'Independent', isActive: true }, location: { label: 'Anna Nagar', isActive: false },
  propertyTypeId: 'pt1', buildingTypeId: 'bt1', locationId: 'l1', address: '12 Lake Road', city: 'Chennai', latitude: 13.08, longitude: 80.27,
  plotArea: 2400, builtUpArea: 1800, expectedPrice: 12500000, bedrooms: 3, bathrooms: 2, description: 'Corner villa',
  statusId: 'sa', statusKey: 'AVAILABLE', status: status('A', 'Available', '#047857'), assignedTo: 'u1', assignedToName: 'Asha',
  mediaCount: 0, isArchived: false, createdAt: '2026-01-05T10:00:00Z', allowed: ALL, ...over,
});
const U1 = unit('x1', 'UNT-000001', 'Lake View Villa', { coverUrl: 'https://media.test/cover.jpg', mediaCount: 1 });
const U2 = unit('x2', 'UNT-000002', 'City Flat', { assignedTo: undefined, assignedToName: undefined, statusKey: 'SOLD', status: status('S', 'Sold'), expectedPrice: 4500000, allowed: { ...NONE, archive: true } });
const MEDIA = [
  { id: 'm1', typeId: 'mt1', type: { label: 'Front image', isActive: true }, url: 'https://media.test/front.jpg', format: 'jpg', isImage: true, bytes: 2048, caption: 'Front elevation' },
  { id: 'm2', typeId: 'mt2', type: { label: 'Brochure', isActive: false }, url: 'https://media.test/b.pdf', format: 'pdf', isImage: false, bytes: 3 * 1024 * 1024 },
];
const DETAIL = { ...U1, media: MEDIA, mediaCount: 2, assignments: [
  { id: 'a1', to: 'u9', toName: 'Vikram', by: 'u0', byName: 'Mgr', at: '2026-01-06T10:00:00Z' },
  { id: 'a2', from: 'u9', fromName: 'Vikram', to: 'u1', toName: 'Asha', by: 'u0', byName: 'Mgr', reason: 'On leave', at: '2026-01-09T10:00:00Z' },
] };

function bodyOf(init) {
  if (!init.body) return undefined;
  if (init.body instanceof FormData) return Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, v instanceof File ? { file: v.name, type: v.type, size: v.size } : v]));
  return JSON.parse(init.body);
}
const MASTERS = {
  UNIT_STATUS: [{ _id: 'sa', code: 'AVAILABLE', systemKey: 'AVAILABLE', label: 'Available', isActive: true }, { _id: 'sb', code: 'BOOKED', systemKey: 'BOOKED', label: 'Booked', isActive: true }, { _id: 'ss', code: 'SOLD', systemKey: 'SOLD', label: 'Sold', isActive: true }, { _id: 'sh', code: 'HOLD', label: 'On hold', isActive: true }],
  PROPERTY_TYPE: [{ _id: 'pt1', code: 'VILLA', label: 'Villa', isActive: true }, { _id: 'pt2', code: 'FLAT', label: 'Flat', isActive: true }],
  BUILDING_TYPE: [{ _id: 'bt1', code: 'IND', label: 'Independent', isActive: true }],
  LOCATION: [{ _id: 'l1', code: 'AN', label: 'Anna Nagar', isActive: true }, { _id: 'l2', code: 'AD', label: 'Adyar', isActive: true }],
  MEDIA_TYPE: [{ _id: 'mt1', code: 'FRONT', label: 'Front image', isActive: true }, { _id: 'mt3', code: 'FLOOR', label: 'Floor plan', isActive: true }],
};

function mockApi(routes = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace('/api/v1', '');
    const key = `${method} ${path.split('?')[0]}`;
    calls.push({ method, path, key, body: bodyOf(init) });
    if (routes[key]) return typeof routes[key] === 'function' ? routes[key](path, init) : routes[key];
    if (key === 'GET /units') return ok([U1, U2], { page: 1, limit: 25, total: 2 });
    if (key === 'GET /units/x1') return ok(DETAIL);
    if (key === 'GET /masters') return ok(MASTERS);
    if (key === 'GET /users') return ok([{ id: 'u1', name: 'Asha' }, { id: 'u2', name: 'Vikram' }], { page: 1, limit: 100, total: 2 });
    if (key === 'GET /branches') return ok([{ _id: 'b1', name: 'Chennai', isActive: true }, { _id: 'b2', name: 'Madurai', isActive: true }], { page: 1, limit: 100, total: 2 });
    if (key === 'GET /activities') return ok([{ _id: 'ac1', type: 'UNIT_CREATED', description: 'Unit UNT-000001 (Lake View Villa) created', at: '2026-01-05T10:00:00Z' }], { page: 1, limit: 50, total: 1 });
    if (key === 'GET /audit') return ok([{ id: 'au1', action: 'create', at: '2026-01-05T10:00:00Z', changes: { statusKey: { to: 'AVAILABLE' } } }], { page: 1, limit: 50, total: 1 });
    throw new Error(`unmocked ${key}`);
  }));
  return calls;
}
const wrap = (ui) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const app = (route, s) => renderWithApp(wrap(<Routes><Route path="/units/*" element={<UnitsRoutes />} /></Routes>), { session: s, route });
const manager = session(['units.view', 'units.create', 'units.edit', 'units.archive', 'units.assign', 'units.manage_media', 'units.change_status', 'users.view', 'activities.view', 'audit.view'], { dataScope: 'BRANCH', branchIds: ['b1'] });
const multi = session(['units.view', 'units.create', 'users.view'], { dataScope: 'ALL', branchIds: [] });
const viewer = session(['units.view'], { dataScope: 'OWN', branchIds: ['b1'], user: { id: 'u1', name: 'Asha' } });
const writes = (calls) => calls.filter((c) => c.method !== 'GET');
afterEach(() => vi.unstubAllGlobals());

describe('Units list', () => {
  it('shows units with master labels, status from the master, price, cover and salesperson', async () => {
    mockApi();
    app('/units', manager);
    expect(await screen.findByText('Lake View Villa')).toBeTruthy();
    expect(screen.getByText('UNT-000001')).toBeTruthy();
    expect(screen.getAllByText('Available').length).toBeGreaterThan(0);
    expect(screen.getByText('Sold', { selector: '.pill' })).toBeTruthy();
    expect(screen.getByText('₹1,25,00,000')).toBeTruthy();
    expect(screen.getAllByText('Unassigned').length).toBeGreaterThan(0);
    expect(document.querySelector('img.unit-thumb')?.getAttribute('src')).toBe('https://media.test/cover.jpg');
    expect(screen.getByRole('heading', { name: 'Units / Properties' })).toBeTruthy();
  });

  it('sends search, filters, price range, sort and paging to the server (nothing is filtered in the browser)', async () => {
    const calls = mockApi();
    app('/units?search=lake&statusId=sa&propertyTypeId=pt1&buildingTypeId=bt1&locationId=l1&assignedTo=u1&minPrice=100&maxPrice=999&sort=-expectedPrice&page=2', manager);
    await screen.findByText('Lake View Villa');
    const req = calls.find((c) => c.key === 'GET /units');
    for (const part of ['search=lake', 'statusId=sa', 'propertyTypeId=pt1', 'buildingTypeId=bt1', 'locationId=l1', 'assignedTo=u1', 'minPrice=100', 'maxPrice=999', 'sort=-expectedPrice', 'page=2']) expect(req.path).toContain(part);
  });

  it('filter options come from the masters; price bounds apply on blur', async () => {
    const calls = mockApi();
    app('/units', manager);
    await screen.findByText('Lake View Villa');
    await waitFor(() => expect(screen.getByRole('option', { name: 'On hold' })).toBeTruthy()); // a status admins added: no code change
    expect(screen.getByRole('option', { name: 'Adyar' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Minimum price'), { target: { value: '2500000' } });
    fireEvent.blur(screen.getByLabelText('Minimum price'));
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /units' && c.path.includes('minPrice=2500000'))).toBe(true));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'ss' } });
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /units' && c.path.includes('statusId=ss'))).toBe(true));
  });

  it('shows a Branch filter only to users who span branches', async () => {
    mockApi();
    const { unmount } = app('/units', multi);
    await screen.findByText('Lake View Villa');
    expect(screen.getByLabelText('Branch')).toBeTruthy();
    unmount();
    app('/units', manager);
    await screen.findByText('Lake View Villa');
    expect(screen.queryByLabelText('Branch')).toBeNull();
  });

  it('the action menu offers exactly what the server allows for each row', async () => {
    mockApi();
    app('/units', manager);
    await screen.findByText('Lake View Villa');
    const menus = screen.getAllByRole('button', { name: 'Actions' });
    fireEvent.click(menus[0]);
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open', 'Reassign', 'Change status…', 'Archive']);
    fireEvent.click(menus[0]);
    fireEvent.click(menus[1]);
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open', 'Archive']); // sold unit: no assign / status
  });

  it('New unit is offered only with units.create', async () => {
    mockApi();
    const { unmount } = app('/units', manager);
    expect(await screen.findByRole('button', { name: 'New unit' })).toBeTruthy();
    unmount();
    app('/units', viewer);
    await screen.findByText('Lake View Villa');
    expect(screen.queryByRole('button', { name: 'New unit' })).toBeNull();
  });

  it('archiving asks first, then calls the API', async () => {
    const calls = mockApi({ 'DELETE /units/x1': noContent });
    app('/units', manager);
    await screen.findByText('Lake View Villa');
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog');
    expect(writes(calls)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(writes(calls)[0]?.key).toBe('DELETE /units/x1'));
  });

  it('empty and error states are explicit', async () => {
    mockApi({ 'GET /units': ok([], { page: 1, limit: 25, total: 0 }) });
    const { unmount } = app('/units', manager);
    expect(await screen.findByText('No units yet')).toBeTruthy();
    unmount();
    mockApi({ 'GET /units': fail(500, 'INTERNAL_ERROR', 'boom') });
    app('/units', manager);
    expect((await screen.findAllByText(/boom|Could not load/)).length).toBeGreaterThan(0);
  });
});

describe('creating and editing', () => {
  const open = async (s = manager) => {
    const calls = mockApi({ 'POST /units': ok({ ...U1, id: 'new1', unitCode: 'UNT-000009' }), 'GET /units/new1': ok({ ...DETAIL, id: 'new1' }) });
    app('/units', s);
    await screen.findByText('Lake View Villa');
    fireEvent.click(screen.getByRole('button', { name: 'New unit' }));
    return { calls, dialog: await screen.findByRole('dialog') };
  };

  it('needs a name; coordinates must come as a pair and within range; numbers are validated', async () => {
    const { calls, dialog } = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create unit' }));
    expect(await within(dialog).findByText('Enter a name')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Plot 4' } });
    fireEvent.change(within(dialog).getByLabelText('Latitude'), { target: { value: '95' } });
    fireEvent.change(within(dialog).getByLabelText('Bedrooms'), { target: { value: '2.5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create unit' }));
    expect(await within(dialog).findByText('Latitude must be between -90 and 90')).toBeTruthy();
    expect(within(dialog).getByText('Enter a whole number')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Latitude'), { target: { value: '13' } });
    fireEvent.change(within(dialog).getByLabelText('Bedrooms'), { target: { value: '2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create unit' }));
    expect(await within(dialog).findByText('Enter the longitude too')).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
  });

  it('sends only what was filled in, with numbers as numbers, then opens the new unit', async () => {
    const { calls, dialog } = await open();
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Adyar' })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: '  Villa 12 ' } });
    fireEvent.change(within(dialog).getByLabelText('Property type'), { target: { value: 'pt1' } });
    fireEvent.change(within(dialog).getByLabelText('Location'), { target: { value: 'l2' } });
    fireEvent.change(within(dialog).getByLabelText('City'), { target: { value: 'Chennai' } });
    fireEvent.change(within(dialog).getByLabelText('Latitude'), { target: { value: '13.08' } });
    fireEvent.change(within(dialog).getByLabelText('Longitude'), { target: { value: '80.27' } });
    fireEvent.change(within(dialog).getByLabelText('Expected price (₹)'), { target: { value: '9500000' } });
    fireEvent.change(within(dialog).getByLabelText('Salesperson'), { target: { value: 'u2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create unit' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'POST /units', body: { name: 'Villa 12', propertyTypeId: 'pt1', locationId: 'l2', city: 'Chennai', latitude: 13.08, longitude: 80.27, expectedPrice: 9500000, assignedTo: 'u2' } });
    expect(Object.keys(writes(calls)[0].body)).not.toContain('statusId'); // status is never chosen by the client
    expect(await screen.findByRole('heading', { name: 'Lake View Villa' })).toBeTruthy(); // navigated to the unit
  });

  it('a multi-branch user must choose a branch, and the location list follows it', async () => {
    const { calls, dialog } = await open(multi);
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'X' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create unit' }));
    expect(await within(dialog).findByText('Choose a branch')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/^Branch/), { target: { value: 'b2' } });
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /masters' && c.path.includes('branchId=b2') && c.path.includes('LOCATION'))).toBe(true));
  });

  it("shows the server's refusal on the field", async () => {
    const calls = mockApi({ 'POST /units': fail(400, 'VALIDATION_ERROR', 'Invalid location', [{ path: 'locationId', message: "Choose a location of this unit's branch" }]) });
    app('/units', manager);
    await screen.findByText('Lake View Villa');
    fireEvent.click(screen.getByRole('button', { name: 'New unit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'X' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create unit' }));
    expect(await within(dialog).findByText("Choose a location of this unit's branch")).toBeTruthy();
    expect(writes(calls)).toHaveLength(1);
  });

  it('editing sends only changed fields and clears with null', async () => {
    const calls = mockApi({ 'PATCH /units/x1': ok(DETAIL) });
    app('/units/x1', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes(calls)).toHaveLength(0); // nothing changed, nothing sent
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const d2 = await screen.findByRole('dialog');
    fireEvent.change(within(d2).getByLabelText(/^Name/), { target: { value: 'Lake View Villa II' } });
    fireEvent.change(within(d2).getByLabelText('Expected price (₹)'), { target: { value: '' } });
    fireEvent.change(within(d2).getByLabelText('Latitude'), { target: { value: '' } });
    fireEvent.change(within(d2).getByLabelText('Longitude'), { target: { value: '' } });
    fireEvent.click(within(d2).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'PATCH /units/x1', body: { name: 'Lake View Villa II', expectedPrice: null, latitude: null, longitude: null } });
    expect(Object.keys(writes(calls)[0].body).sort()).toEqual(['expectedPrice', 'latitude', 'longitude', 'name']);
  });
});

describe('assignment and status', () => {
  it('reassigning needs a reason and shows who holds it now', async () => {
    const calls = mockApi({ 'POST /units/x1/assign': ok(DETAIL) });
    app('/units/x1', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Reassign' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Currently assigned to Asha/)).toBeTruthy();
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Vikram' })).toBeTruthy());
    expect(within(dialog).queryByRole('option', { name: 'Asha' })).toBeNull(); // the current holder is not offered
    fireEvent.change(within(dialog).getByLabelText(/Salesperson/), { target: { value: 'u2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Give a reason for reassigning')).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Asha on leave' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'POST /units/x1/assign', body: { assignedTo: 'u2', reason: 'Asha on leave' } });
  });

  it('first assignment needs no reason; server conflicts show inside the dialog', async () => {
    const calls = mockApi({
      'GET /units/x1': ok({ ...DETAIL, assignedTo: undefined, assignedToName: undefined, assignments: [] }),
      'POST /units/x1/assign': fail(409, 'ASSIGNMENT_CHANGED', 'The unit was reassigned by someone else. Refresh and try again.'),
    });
    app('/units/x1', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Assign' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Vikram' })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText(/Salesperson/), { target: { value: 'u2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/reassigned by someone else/)).toBeTruthy();
    expect(writes(calls)[0].body).toEqual({ assignedTo: 'u2' });
  });

  it('status options come from the master, exclude the current and the booking-owned status, and send the status the screen saw', async () => {
    const calls = mockApi({ 'POST /units/x1/status': ok(DETAIL) });
    app('/units/x1', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Change status…' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'On hold' })).toBeTruthy());
    const labels = within(dialog).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual(['Select a status…', 'Sold', 'On hold']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Choose the new status')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/New status/), { target: { value: 'ss' } });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Sold offline' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'POST /units/x1/status', body: { statusId: 'ss', from: 'sa', reason: 'Sold offline' } });
  });

  it("the server's refusal of a status change is shown, not swallowed", async () => {
    mockApi({ 'POST /units/x1/status': fail(409, 'STATUS_CHANGED', 'The unit status was changed by someone else. Refresh and try again.') });
    app('/units/x1', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Change status…' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Sold' })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText(/New status/), { target: { value: 'ss' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/changed by someone else/)).toBeTruthy();
  });
});

describe('unit detail', () => {
  it('shows the property, status, salesperson with history, media, booking placeholder, timeline and audit', async () => {
    mockApi();
    app('/units/x1', manager);
    expect(await screen.findByRole('heading', { name: 'Lake View Villa' })).toBeTruthy();
    expect(screen.getAllByText('UNT-000001').length).toBeGreaterThan(0);
    expect(screen.getByText('Anna Nagar (inactive)')).toBeTruthy(); // history keeps its meaning
    expect(screen.getByText('₹1,25,00,000')).toBeTruthy();
    expect(screen.getByText('1,800 sq ft')).toBeTruthy();
    expect(screen.getByRole('link', { name: '13.08, 80.27' }).getAttribute('href')).toContain('13.08,80.27');
    const history = within(screen.getByLabelText('Assignment history'));
    expect(history.getAllByRole('listitem')).toHaveLength(2);
    expect(history.getByText(/On leave/)).toBeTruthy();
    expect(screen.getByText('Booking details are restricted')).toBeTruthy(); // this payload carries no booking panel
    expect(await screen.findByText('Unit UNT-000001 (Lake View Villa) created')).toBeTruthy();
    expect(await screen.findByText('create')).toBeTruthy(); // audit entry
  });

  it('without activities.view / audit.view the timeline and audit are not requested at all', async () => {
    const calls = mockApi();
    app('/units/x1', viewer);
    await screen.findByRole('heading', { name: 'Lake View Villa' });
    expect(calls.some((c) => c.key === 'GET /activities' || c.key === 'GET /audit')).toBe(false);
    expect(screen.queryByText('Audit history')).toBeNull();
  });

  it('controls follow the server allowed flags (an archived or sold unit offers none of them)', async () => {
    mockApi({ 'GET /units/x1': ok({ ...DETAIL, isArchived: true, allowed: NONE }) });
    app('/units/x1', manager);
    await screen.findByRole('heading', { name: /Lake View Villa/ });
    expect(screen.getByText('Archived')).toBeTruthy();
    for (const name of ['Edit', 'Reassign', 'Assign', 'Change status…', 'Upload', 'Actions']) expect(screen.queryByRole('button', { name }), name).toBeNull();
    expect(screen.queryByRole('form', { name: 'Upload media' })).toBeNull();
  });

  it('a unit bought from a seller links back to the seller and property, and says it is withheld until released', async () => {
    const acquisition = { sellerPropertyId: 'pp1', sellerPropertyNo: 'SPP-000001', sellerId: 's1', sellerNo: 'SEL-000001', sellerName: 'Ravi Menon', statusKey: 'REFURBISHMENT', status: { label: 'Refurbishment / development' }, purchaseDate: '2026-02-20T00:00:00Z', purchasePrice: 4200000, releasedToBuyers: false };
    mockApi({ 'GET /units/x1': ok({ ...DETAIL, statusKey: 'UNDER_DEVELOPMENT', status: { label: 'Under development' }, acquisition }) });
    app('/units/x1', manager);
    await screen.findByRole('heading', { name: 'Lake View Villa' });
    expect(screen.getByRole('heading', { name: 'Acquired from a seller' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ravi Menon' }).getAttribute('href')).toBe('/sellers/s1');
    expect(screen.getByRole('link', { name: 'SPP-000001' }).getAttribute('href')).toBe('/sellers/properties/pp1');
    expect(screen.getByText(/Withheld until the property is marked ready to sell/)).toBeTruthy();
  });

  it('an ordinary unit shows no seller card', async () => {
    mockApi();
    app('/units/x1', manager);
    await screen.findByRole('heading', { name: 'Lake View Villa' });
    expect(screen.queryByRole('heading', { name: 'Acquired from a seller' })).toBeNull();
  });

  it('archiving from the detail asks first, then returns to the list', async () => {
    const calls = mockApi({ 'DELETE /units/x1': noContent });
    app('/units/x1', manager);
    await screen.findByRole('heading', { name: 'Lake View Villa' });
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog');
    expect(writes(calls)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(writes(calls)[0]?.key).toBe('DELETE /units/x1'));
    expect((await screen.findAllByRole('heading', { name: 'Units / Properties' })).length).toBeGreaterThan(0);
  });

  it('a missing or foreign unit shows not found', async () => {
    mockApi({ 'GET /units/x1': fail(404, 'NOT_FOUND', 'Unit not found') });
    app('/units/x1', manager);
    expect((await screen.findAllByText(/not found|Could not load/i)).length).toBeGreaterThan(0);
  });
});

describe('media', () => {
  it('lists images and files with type labels (inactive types kept), size and caption', async () => {
    mockApi();
    app('/units/x1', manager);
    const grid = within(await screen.findByLabelText('Media'));
    expect(grid.getAllByRole('listitem')).toHaveLength(2);
    expect(grid.getByAltText('Front elevation').getAttribute('src')).toBe('https://media.test/front.jpg');
    expect(grid.getByText('Brochure (inactive)')).toBeTruthy();
    expect(grid.getByText('3.0 MB')).toBeTruthy();
    expect(grid.getByRole('link', { name: 'PDF' }).getAttribute('href')).toBe('https://media.test/b.pdf');
  });

  it('upload needs a file and a type, then posts multipart with the type and caption', async () => {
    const calls = mockApi({ 'POST /units/x1/media': { ok: true, status: 201, json: async () => ({ data: MEDIA[0] }) } });
    app('/units/x1', manager);
    const form = await screen.findByRole('form', { name: 'Upload media' });
    fireEvent.click(within(form).getByRole('button', { name: 'Upload' }));
    expect(await within(form).findByText('Choose a file')).toBeTruthy();
    expect(within(form).getByText('Choose what this file shows')).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
    const file = new File([new Uint8Array(20)], 'front.png', { type: 'image/png' });
    fireEvent.change(within(form).getByLabelText(/^File/), { target: { files: [file] } });
    await waitFor(() => expect(within(form).getByRole('option', { name: 'Floor plan' })).toBeTruthy());
    fireEvent.change(within(form).getByLabelText(/^Type/), { target: { value: 'mt3' } });
    fireEvent.change(within(form).getByLabelText('Caption'), { target: { value: 'Ground floor' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'POST /units/x1/media', body: { typeId: 'mt3', caption: 'Ground floor', file: { file: 'front.png', type: 'image/png', size: 20 } } });
  });

  it("an upload the server refuses shows the server's message", async () => {
    mockApi({ 'POST /units/x1/media': fail(415, 'UNSUPPORTED_FILE_TYPE', 'Only JPEG, PNG, WebP images and PDF files are accepted') });
    app('/units/x1', manager);
    const form = await screen.findByRole('form', { name: 'Upload media' });
    fireEvent.change(within(form).getByLabelText(/^File/), { target: { files: [new File(['x'], 'a.svg', { type: 'image/svg+xml' })] } });
    await waitFor(() => expect(within(form).getByRole('option', { name: 'Floor plan' })).toBeTruthy());
    fireEvent.change(within(form).getByLabelText(/^Type/), { target: { value: 'mt1' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Upload' }));
    expect((await within(form).findByRole('alert')).textContent).toMatch(/Only JPEG, PNG, WebP/);
  });

  it('removing asks first, then calls the API for that file', async () => {
    const calls = mockApi({ 'DELETE /units/x1/media/m1': noContent });
    app('/units/x1', manager);
    const grid = within(await screen.findByLabelText('Media'));
    fireEvent.click(grid.getAllByRole('button', { name: 'Remove' })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(writes(calls)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(writes(calls)[0]?.key).toBe('DELETE /units/x1/media/m1'));
  });

  it('without manage-media rights the gallery is read-only', async () => {
    mockApi({ 'GET /units/x1': ok({ ...DETAIL, allowed: { ...ALL, manageMedia: false } }) });
    app('/units/x1', manager);
    const grid = within(await screen.findByLabelText('Media'));
    expect(grid.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Upload media' })).toBeNull();
  });
});

describe('navigation and permissions', () => {
  it('Units is a real page in the app for units.view holders, and refused by URL otherwise', async () => {
    mockApi();
    const { unmount } = renderWithApp(wrap(<AppRoutes />), { session: manager, route: '/units' });
    expect((await screen.findAllByRole('heading', { name: 'Units / Properties' })).length).toBeGreaterThan(0);
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    unmount();
    renderWithApp(wrap(<AppRoutes />), { session: session(['dashboard.view']), route: '/units' });
    expect(await screen.findByText(/don't have access/i)).toBeTruthy();
  });
});
