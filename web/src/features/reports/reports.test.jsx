import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp, session } from '../../test/render';
import { ReportsPage } from './ReportsPage';

const ok = (data, meta) => ({ ok: true, status: 200, json: async () => ({ data, ...(meta ? { meta } : {}) }) });
const fail = (status, code, message) => ({ ok: false, status, json: async () => ({ error: { code, message } }) });

const CATALOG = [
  { key: 'enquiries', label: 'Enquiries', description: 'Every enquiry.', canExport: true },
  { key: 'bookings', label: 'Bookings', description: 'Bookings with their unit.', canExport: true, note: 'Only ACTIVE bookings count as current bookings.' },
  { key: 'funnel', label: 'Conversion funnel', description: 'Stage counts.', canExport: true },
];
const LIST = {
  key: 'enquiries', label: 'Enquiries', kind: 'list', columns: ['Enquiry ID', 'Name', 'Stage'],
  rows: [{ id: 'e1' }, { id: 'e2' }], cells: [['ENQ-000001', 'Raj Kumar', 'New'], ['ENQ-000002', '=SUM(A1)', 'Contacted']],
  summary: { total: 60, groups: [{ key: 'NEW', label: 'New', count: 40 }, { key: 'CONTACTED', label: 'Contacted', count: 20 }] },
  meta: { page: 1, limit: 25, total: 60 },
};
const FUNNEL = {
  key: 'funnel', label: 'Conversion funnel', kind: 'funnel',
  funnel: { range: { from: '2026-03-01', to: '2026-03-10' }, stages: [{ systemKey: 'NEW', label: 'New', current: 5, entered: 9 }], definitions: { current: 'Right now by stage.', entered: 'Entered in the period; not the share that moved on.' } },
  rows: [{ systemKey: 'NEW', label: 'New', current: 5, entered: 9 }], meta: { page: 1, limit: 1, total: 1 },
};
const download = vi.fn();

function mockApi(routes = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = url.replace('/api/v1', '');
    const key = path.split('?')[0];
    calls.push(path);
    if (routes[key]) return typeof routes[key] === 'function' ? routes[key](path) : routes[key];
    if (key === '/reports') return ok(CATALOG);
    if (key === '/reports/enquiries') return ok(LIST);
    if (key === '/reports/funnel') return ok(FUNNEL);
    if (key === '/reports/bookings') return ok({ ...LIST, key: 'bookings', columns: ['Booking ID'], cells: [['BK-000001']], rows: [{ id: 'b1' }], summary: { total: 1, groups: [] }, meta: { page: 1, limit: 25, total: 1 } });
    if (key === '/reports/enquiries/export.csv') return { ok: true, status: 200, blob: async () => new Blob(['x']) };
    if (key === '/branches') return ok([{ _id: 'b1', name: 'Chennai' }, { _id: 'b2', name: 'Madurai' }], { page: 1, limit: 100, total: 2 });
    if (key === '/users') return ok([{ id: 'u1', name: 'Asha' }], { page: 1, limit: 100, total: 1 });
    if (key === '/workflow/stages') return ok([{ systemKey: 'NEW', label: 'New' }, { systemKey: 'CONTACTED', label: 'Contacted' }]);
    throw new Error(`unmocked ${key}`);
  }));
  return calls;
}
const wrap = (ui) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const show = (s, route = '/reports') => renderWithApp(wrap(<Routes><Route path="/reports" element={<ReportsPage />} /></Routes>), { session: s, route });
const manager = session(['reports.view', 'reports.export', 'enquiries.view', 'bookings.view', 'users.view', 'masters.view'], { dataScope: 'BRANCH', branchIds: ['b1'] });
const admin = session(['reports.view', 'reports.export', 'enquiries.view', 'bookings.view', 'users.view', 'masters.view'], { dataScope: 'ALL' });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('reports page', () => {
  it('names the page with exactly one real heading', async () => {
    // Reports renders its heading through the shared PageHeader, so it is already accessible; this
    // guards that the topbar change did not leave the page unnamed or duplicate the heading.
    mockApi();
    show(manager);
    await screen.findByText('ENQ-000001');
    expect(screen.getAllByRole('heading', { level: 2, name: 'Reports' })).toHaveLength(1);
  });

  it('lists only the reports the server offers and shows the first, with server totals and a summary', async () => {
    mockApi();
    show(manager);
    expect(await screen.findByText('ENQ-000001')).toBeTruthy();
    const tabs = screen.getByRole('tablist', { name: 'Report' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Enquiries', 'Bookings', 'Conversion funnel']);
    const summary = screen.getByRole('list', { name: 'Summary' });
    expect(summary.textContent).toContain('60 records');
    expect(summary.textContent).toContain('40 New');
    expect(screen.getByText('1–25 of 60')).toBeTruthy();
  });

  it('renders cell values as plain text (a formula-looking value is shown, not evaluated)', async () => {
    mockApi();
    show(manager);
    expect((await screen.findByText('=SUM(A1)')).tagName).toBe('TD');
  });

  it('sends filters and the page to the API, and resets the page when a filter changes', async () => {
    const calls = mockApi();
    show(admin, '/reports?page=2');
    await screen.findByText('ENQ-000001');
    expect(calls.some((c) => c.startsWith('/reports/enquiries') && c.includes('page=2'))).toBe(true);
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-03-01' } });
    fireEvent.change(await screen.findByLabelText('Branch'), { target: { value: 'b2' } });
    await waitFor(() => expect(calls.some((c) => c.startsWith('/reports/enquiries') && c.includes('from=2026-03-01') && c.includes('branchId=b2') && !c.includes('page=2'))).toBe(true));
  });

  it('switching reports drops the previous report\'s filters', async () => {
    const calls = mockApi();
    show(admin, '/reports?from=2026-03-01');
    await screen.findByText('ENQ-000001');
    fireEvent.click(screen.getByRole('tab', { name: 'Bookings' }));
    await screen.findByText('BK-000001');
    expect(calls.filter((c) => c.startsWith('/reports/bookings')).every((c) => !c.includes('from='))).toBe(true);
    expect(screen.getByText(/Only ACTIVE bookings count as current bookings/)).toBeTruthy();
  });

  it('exports the filtered set (without paging) and tells the user when the export is refused', async () => {
    const calls = mockApi();
    show(admin, '/reports?from=2026-03-01&page=2');
    await screen.findByText('ENQ-000001');
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(calls.some((c) => c.startsWith('/reports/enquiries/export.csv'))).toBe(true));
    const exported = calls.find((c) => c.startsWith('/reports/enquiries/export.csv'));
    expect(exported).toContain('from=2026-03-01');
    expect(exported).not.toContain('page=');
    expect(exported).not.toContain('limit=');
    void download;
  });

  it('shows the server\'s refusal for a too-large export', async () => {
    mockApi({ '/reports/enquiries/export.csv': fail(413, 'EXPORT_TOO_LARGE', 'This export has 90000 rows (limit 20000). Narrow the filters and try again.') });
    show(admin);
    await screen.findByText('ENQ-000001');
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText(/This export has 90000 rows/)).toBeTruthy();
  });

  it('hides Export when the user cannot export', async () => {
    mockApi({ '/reports': ok(CATALOG.map((r) => ({ ...r, canExport: false }))) });
    show(manager);
    await screen.findByText('ENQ-000001');
    expect(screen.queryByRole('button', { name: /export csv/i })).toBeNull();
  });

  it('explains that the funnel has two different measures', async () => {
    mockApi();
    show(manager, '/reports?report=funnel');
    expect(await screen.findByText('Two different measures.')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('not the share that moved on');
    expect(screen.getAllByText('In stage now').length).toBeGreaterThan(0);
    expect(screen.getByText(/Entered during the period \(2026-03-01 to 2026-03-10\)/)).toBeTruthy();
  });

  it('shows empty, no-reports and error states', async () => {
    mockApi({ '/reports/enquiries': ok({ ...LIST, rows: [], cells: [], summary: { total: 0, groups: [] }, meta: { page: 1, limit: 25, total: 0 } }) });
    show(manager);
    expect(await screen.findByText('No records match')).toBeTruthy();

    vi.unstubAllGlobals();
    mockApi({ '/reports': ok([]) });
    show(manager);
    expect(await screen.findByText('No reports available')).toBeTruthy();
  });

  it('shows an error with retry when the catalogue cannot load', async () => {
    let n = 0;
    mockApi({ '/reports': () => (++n === 1 ? fail(500, 'INTERNAL', 'Boom') : ok(CATALOG)) });
    show(manager);
    expect(await screen.findByText('Could not load reports')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('ENQ-000001')).toBeTruthy();
  });

  it('draws the grouped summary as a breakdown chart and shows record states as coloured pills', async () => {
    mockApi({ '/reports/bookings': ok({ ...LIST, key: 'bookings', columns: ['Booking ID', 'Status'], cells: [['BK-000001', 'Active'], ['BK-000002', 'Released']], rows: [{ id: 'b1' }, { id: 'b2' }], summary: { total: 2, groups: [{ key: 'ACTIVE', label: 'ACTIVE', count: 1 }, { key: 'RELEASED', label: 'RELEASED', count: 1 }] }, meta: { page: 1, limit: 25, total: 2 } }) });
    show(manager, '/reports?report=bookings');
    expect(await screen.findByText('BK-000002')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Breakdown' })).toBeTruthy();
    const table = screen.getByText('BK-000001').closest('table');
    expect(within(table).getByText('Released').className).toContain('pill');
    expect(within(table).getByText('Active').className).toContain('pill');
    expect(within(table).getByText('BK-000001').className).not.toContain('pill'); // only known states are pills
  });
});
