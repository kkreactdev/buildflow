import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MasterBadge } from '../../components/data/MasterBadge';
import { MasterSelect } from '../../components/data/MasterSelect';
import { renderWithApp, session } from '../../test/render';
import { MastersPage } from './MastersPage';
import { WorkflowPage } from '../workflow/WorkflowPage';

const TYPES = [
  { key: 'ENQUIRY_SOURCE', label: 'Enquiry Sources', group: 'Enquiries', description: 'Where from', scope: 'GLOBAL', reorderable: true, disableable: true, deletable: true, managePermission: 'masters.manage', hasColor: false },
  { key: 'FOLLOWUP_STATUS', label: 'Follow-up Statuses', group: 'Follow-ups & Visits', description: 'State', scope: 'GLOBAL', reorderable: true, disableable: true, deletable: false, managePermission: 'masters.manage', hasColor: true },
  { key: 'LOCATION', label: 'Locations', group: 'Properties', description: 'Areas', scope: 'BRANCH', reorderable: true, disableable: true, deletable: true, managePermission: 'masters.manage', hasColor: false },
];
const SOURCES = [
  { _id: 's1', type: 'ENQUIRY_SOURCE', code: 'WEB', label: 'Website', sortOrder: 1, isActive: true },
  { _id: 's2', type: 'ENQUIRY_SOURCE', code: 'AD', label: 'Newspaper', sortOrder: 2, isActive: false },
  { _id: 's3', type: 'ENQUIRY_SOURCE', code: 'WALK', label: 'Walk-in', sortOrder: 3, isActive: true },
];
const STATUS = [{ _id: 'f1', type: 'FOLLOWUP_STATUS', code: 'PENDING', systemKey: 'PENDING', label: 'Pending', sortOrder: 1, isActive: true, color: '#3f6690' }];

const ok = (data, meta) => ({ ok: true, status: 200, json: async () => ({ data, ...(meta ? { meta } : {}) }) });
function mockApi(extra = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, body: init.body ? JSON.parse(init.body) : undefined });
    const key = `${method} ${url.replace('/api/v1', '').split('?')[0]}`;
    if (extra[key]) return typeof extra[key] === 'function' ? extra[key](url, init) : extra[key];
    if (key === 'GET /masters/types') return ok(TYPES);
    if (key === 'GET /masters/ENQUIRY_SOURCE') return ok(SOURCES, { page: 1, limit: 100, total: 3 });
    if (key === 'GET /masters/FOLLOWUP_STATUS') return ok(STATUS, { page: 1, limit: 100, total: 1 });
    if (key === 'GET /masters/LOCATION') return ok([], { page: 1, limit: 100, total: 0 });
    if (key === 'GET /branches') return ok([{ _id: 'b1', name: 'Chennai', code: 'CHN', isActive: true }], { page: 1, limit: 100, total: 1 });
    if (key.startsWith('PATCH') || key.startsWith('POST')) return ok({ changed: 1 });
    throw new Error(`unmocked ${key}`);
  }));
  return calls;
}
const wrap = (ui) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const admin = session(['masters.view', 'masters.manage'], { dataScope: 'ALL' });
afterEach(() => vi.unstubAllGlobals());

describe('Masters administration', () => {
  it('builds category navigation from the API (nothing hard-coded) and loads values', async () => {
    mockApi();
    renderWithApp(wrap(<MastersPage />), { session: admin, route: '/masters' });
    const nav = await screen.findByRole('navigation', { name: 'Master categories' });
    expect(within(nav).getByText('Enquiry Sources')).toBeTruthy();
    expect(within(nav).getByText('Locations')).toBeTruthy();
    expect(within(nav).getByText(/Enquiry Statuses/)).toBeTruthy(); // links to the workflow page
    await screen.findByText('Website');
    expect(screen.getByText('Newspaper')).toBeTruthy(); // inactive values are listed for admins
    expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0);
  });

  it('read-only users see values but no management controls', async () => {
    mockApi();
    renderWithApp(wrap(<MastersPage />), { session: session(['masters.view'], { dataScope: 'BRANCH', branchIds: ['b1'] }), route: '/masters' });
    await screen.findByText('Website');
    expect(screen.queryByRole('button', { name: 'New value' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull();
  });

  it('global lists are not manageable for branch-scoped users even with masters.manage (server refuses too)', async () => {
    mockApi();
    renderWithApp(wrap(<MastersPage />), { session: session(['masters.view', 'masters.manage'], { dataScope: 'BRANCH', branchIds: ['b1'] }), route: '/masters/ENQUIRY_SOURCE' });
    await screen.findByText('Website');
    expect(screen.queryByRole('button', { name: 'New value' })).toBeNull();
  });

  it('creates a value through the API', async () => {
    const calls = mockApi();
    renderWithApp(wrap(<MastersPage />), { session: admin, route: '/masters' });
    await screen.findByText('Website');
    fireEvent.click(screen.getByRole('button', { name: 'New value' }));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Hoarding' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/masters/ENQUIRY_SOURCE'))).toBe(true));
    expect(calls.find((c) => c.method === 'POST').body).toEqual({ label: 'Hoarding' });
  });

  it('deactivating asks for confirmation first and explains the effect', async () => {
    const calls = mockApi();
    renderWithApp(wrap(<MastersPage />), { session: admin, route: '/masters' });
    await screen.findByText('Website');
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    fireEvent.click(screen.getByText('Deactivate'));
    expect(await screen.findByText(/Existing records keep showing it/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false); // nothing sent yet
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ isActive: false }));
  });

  it('system values: no deactivate/delete offered, key shown as fixed', async () => {
    mockApi();
    renderWithApp(wrap(<MastersPage />), { session: admin, route: '/masters/FOLLOWUP_STATUS' });
    await screen.findByText('Pending');
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.queryByText('Deactivate')).toBeNull();
    expect(screen.queryByText('Delete')).toBeNull();
    fireEvent.click(screen.getByText('Edit'));
    expect(await screen.findByText('System key (fixed)')).toBeTruthy();
  });

  it('moving a value sends the COMPLETE new order to the server', async () => {
    const calls = mockApi();
    renderWithApp(wrap(<MastersPage />), { session: admin, route: '/masters' });
    await screen.findByText('Website');
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    fireEvent.click(screen.getByText('Move down'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/reorder'))?.body).toEqual({ ids: ['s2', 's1', 's3'] }));
  });

  it('shows server errors from a refused action instead of failing silently', async () => {
    mockApi({ 'PATCH /masters/ENQUIRY_SOURCE/s1': { ok: false, status: 409, json: async () => ({ error: { code: 'SYSTEM_VALUE', message: 'required by the system' } }) } });
    renderWithApp(wrap(<MastersPage />), { session: admin, route: '/masters' });
    await screen.findByText('Website');
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('required by the system')).toBeTruthy();
  });
});

describe('MasterSelect / MasterBadge', () => {
  const groups = { 'GET /masters': () => ok({ ENQUIRY_SOURCE: SOURCES }) };

  it('offers only active values from the API, keeps the record\'s own inactive value visible', async () => {
    mockApi(groups);
    const { unmount } = renderWithApp(wrap(<MasterSelect type="ENQUIRY_SOURCE" value="s1" onChange={() => {}} aria-label="source" />));
    const select = await screen.findByLabelText('source');
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(1));
    expect([...select.options].map((o) => o.textContent)).toEqual(['Select…', 'Website', 'Walk-in']);
    unmount();

    renderWithApp(wrap(<MasterSelect type="ENQUIRY_SOURCE" value="s2" onChange={() => {}} aria-label="source" />));
    const s2 = await screen.findByLabelText('source');
    await waitFor(() => expect(s2.querySelectorAll('option').length).toBeGreaterThan(1));
    expect([...s2.options].map((o) => o.textContent)).toEqual(['Select…', 'Website', 'Newspaper (inactive)', 'Walk-in']);
    expect(s2.value).toBe('s2');
  });

  it('reports the chosen id', async () => {
    mockApi(groups);
    const onChange = vi.fn();
    renderWithApp(wrap(<MasterSelect type="ENQUIRY_SOURCE" value="" onChange={onChange} aria-label="source" />));
    const select = await screen.findByLabelText('source');
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(1));
    fireEvent.change(select, { target: { value: 's3' } });
    expect(onChange).toHaveBeenCalledWith('s3');
  });

  it('the badge still shows an inactive value\'s label (history)', async () => {
    mockApi(groups);
    renderWithApp(wrap(<MasterBadge type="ENQUIRY_SOURCE" value="s2" />));
    expect(await screen.findByText('Newspaper')).toBeTruthy();
  });
});

describe('Workflow administration', () => {
  const STAGES = [
    { _id: 'w1', systemKey: 'NEW', label: 'New', order: 1, kind: 'FLOW', entryPolicy: 'MANUAL', isSystem: true, isActive: true, color: '#3f6690' },
    { _id: 'w2', systemKey: 'CONTACTED', label: 'Contacted', order: 2, kind: 'FLOW', entryPolicy: 'MANUAL', isSystem: true, isActive: true },
    { _id: 'w3', systemKey: 'CUSTOM_DOCS', label: 'Docs Collected', order: 3, kind: 'FLOW', entryPolicy: 'MANUAL', isSystem: false, isActive: true },
    { _id: 'w4', systemKey: 'BOOKED', label: 'Booked', order: 4, kind: 'FLOW', entryPolicy: 'DOMAIN', domainOperation: 'booking.create', isSystem: true, isActive: true },
    { _id: 'w5', systemKey: 'CONVERTED', label: 'Converted', order: 5, kind: 'FLOW', entryPolicy: 'DOMAIN', domainOperation: 'enquiry.convert', isSystem: true, isActive: true },
    { _id: 'w6', systemKey: 'LOST', label: 'Lost', order: 1000, kind: 'LOST', entryPolicy: 'MANUAL', isSystem: true, isActive: true },
  ];
  const api = { 'GET /workflow/stages': ok(STAGES) };

  it('separates the fixed system key from the editable display name', async () => {
    mockApi(api);
    renderWithApp(wrap(<WorkflowPage />), { session: admin });
    await screen.findByText('Contacted');
    expect(screen.getByText('CONTACTED')).toBeTruthy();
    expect(screen.getByText('Booking a unit')).toBeTruthy(); // domain-controlled stage explained

    fireEvent.click(screen.getAllByRole('button', { name: 'Actions' })[1]);
    fireEvent.click(screen.getByText('Edit'));
    const key = await screen.findByTestId('system-key');
    expect(key.textContent).toBe('CONTACTED');
    expect(key.querySelector('input')).toBeNull(); // not an editable control
    expect(screen.getByLabelText(/Display name/)).toBeTruthy();
    expect(screen.getByText(/Core pipeline stages cannot be deactivated/)).toBeTruthy();
  });

  it('read-only users cannot change anything', async () => {
    mockApi(api);
    renderWithApp(wrap(<WorkflowPage />), { session: session(['masters.view'], { dataScope: 'ALL' }) });
    await screen.findByText('Contacted');
    expect(screen.queryByRole('button', { name: 'Add stage' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull();
  });

  it('branch-scoped users cannot configure the company-wide workflow', async () => {
    mockApi(api);
    renderWithApp(wrap(<WorkflowPage />), { session: session(['masters.view', 'masters.manage'], { dataScope: 'BRANCH', branchIds: ['b1'] }) });
    await screen.findByText('Contacted');
    expect(screen.queryByRole('button', { name: 'Add stage' })).toBeNull();
  });

  it('only offers moves the rules allow: core stages cannot swap, NEW stays first, CONVERTED last', async () => {
    mockApi(api);
    renderWithApp(wrap(<WorkflowPage />), { session: admin });
    await screen.findByText('Contacted');
    const rowsActions = screen.getAllByRole('button', { name: 'Actions' });
    const disabledFor = (i) => {
      fireEvent.click(rowsActions[i]);
      const up = screen.getByText('Move up').closest('button').disabled;
      const down = screen.getByText('Move down').closest('button').disabled;
      fireEvent.keyDown(document, { key: 'Escape' });
      return [up, down];
    };
    expect(disabledFor(0)).toEqual([true, true]); // NEW: first, and its neighbour is a core stage
    expect(disabledFor(1)).toEqual([true, false]); // CONTACTED: cannot pass NEW; may step over the custom stage
    expect(disabledFor(2)).toEqual([false, false]); // custom stage: free to move between core stages
    expect(disabledFor(3)).toEqual([false, true]); // BOOKED: may swap with the custom stage, never with CONVERTED
  });

  it('adding a stage posts the insertion point; reorder posts the full id list', async () => {
    const calls = mockApi(api);
    renderWithApp(wrap(<WorkflowPage />), { session: admin });
    await screen.findByText('Contacted');
    fireEvent.click(screen.getByRole('button', { name: 'Add stage' }));
    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: 'Qualified' } });
    fireEvent.change(screen.getByLabelText(/Insert after/), { target: { value: 'NEW' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/workflow/stages'))?.body).toMatchObject({ label: 'Qualified', afterSystemKey: 'NEW' }));
  });
});
