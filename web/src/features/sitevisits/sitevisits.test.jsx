import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../app/App';
import { renderWithApp, session } from '../../test/render';
import { useStageMover } from '../enquiries/useStageMover';
import { SiteVisitsRoutes } from './SiteVisitsRoutes';
import { SiteVisitsSection } from './SiteVisitsSection';
import { ClientRelatedSections } from '../clients/ClientRelatedSections';

const ok = (data, meta) => ({ ok: true, status: 200, json: async () => ({ data, ...(meta ? { meta } : {}) }) });
const noContent = { ok: true, status: 204, json: async () => ({}) };
const fail = (status, code, message, details) => ({ ok: false, status, json: async () => ({ error: { code, message, details } }) });
const ALL = { edit: true, assign: true, complete: true, cancel: true, archive: false };
const NONE = { edit: false, assign: false, complete: false, cancel: false, archive: false };
const sched = { id: 'ss', label: 'Scheduled', color: '#3f6690', isActive: true };
const FUTURE = new Date(Date.now() + 2 * 86_400_000).toISOString();

const visit = (id, no, over = {}) => ({
  id, visitNo: no, branchId: 'b1', branch: { name: 'Chennai', code: 'CHN' }, enquiryId: 'e1', enquiryNo: 'ENQ-000001', personId: 'p1', name: 'Raj Kumar', phone: '+91 98765 43210', phoneE164: '+919876543210',
  assignedTo: 'u1', assignedToName: 'Asha', scheduledAt: FUTURE, units: [{ id: 'un1', unitCode: 'UNT-000001', name: 'Lake View Villa', isArchived: false }, { id: 'un2', unitCode: 'UNT-000002' }], unitCount: 2,
  notes: 'Bring brochure', latitude: 13.08, longitude: 80.27, statusId: 'ss', statusKey: 'SCHEDULED', status: sched, rescheduleCount: 0, isArchived: false, allowed: ALL, ...over,
});
const V1 = visit('v1', 'SV-000001');
const V2 = visit('v2', 'SV-000002', { name: 'Esha Rao', statusKey: 'COMPLETED', status: { id: 'sc', label: 'Completed', isActive: true }, units: [], unitCount: 0, allowed: { ...NONE, archive: true } });
const DETAIL = { ...V1, assignments: [{ id: 'a1', to: 'u1', toName: 'Asha', by: 'u0', byName: 'Mgr', at: '2026-01-06T10:00:00Z' }, { id: 'a2', from: 'u1', fromName: 'Asha', to: 'u2', toName: 'Vikram', by: 'u0', byName: 'Mgr', reason: 'On leave', at: '2026-01-07T10:00:00Z' }] };
const DONE = { ...DETAIL, statusKey: 'COMPLETED', status: { id: 'sc', label: 'Completed' }, completedAt: '2026-01-08T10:00:00Z', feedback: 'Loved the plot', completionNotes: 'Wants lower floor', followUp: { id: 'f1', scheduledAt: '2026-01-09T04:30:00Z', statusKey: 'PENDING' }, allowed: { ...NONE, archive: true } };
const ENQ = { id: 'e1', enquiryNo: 'ENQ-000001', name: 'Raj Kumar', branchId: 'b1' };

/** What the server resolves as LINKED to the enquiry (interests + bookings + visits merged, one row per unit). */
const linkedUnit = (id, code, name, over = {}) => ({
  id, unitCode: code, name, city: 'Chennai', statusKey: 'AVAILABLE', statusLabel: 'Available', statusColor: '#16a34a',
  state: 'INTERESTED', via: [{ id: 'e1', enquiryNo: 'ENQ-000001' }], ...over,
});
const LINKED = { units: [linkedUnit('un1', 'UNT-000001', 'Lake View Villa'), linkedUnit('un3', 'UNT-000003', 'City Flat', { state: 'SITE_VISIT_SCHEDULED' })] };
const CLIENT_LINKED = { units: [linkedUnit('un1', 'UNT-000001', 'Lake View Villa', { via: [{ id: 'e1', enquiryNo: 'ENQ-000001' }, { id: 'e2', enquiryNo: 'ENQ-000002' }] }), linkedUnit('un9', 'UNT-000009', 'Hill Villa')] };

const MASTERS = { SITEVISIT_STATUS: [{ _id: 'ss', code: 'SCHEDULED', label: 'Scheduled', isActive: true }, { _id: 'sc', code: 'COMPLETED', label: 'Completed', isActive: true }, { _id: 'sx', code: 'CANCELLED', label: 'Cancelled', isActive: true }] };

function mockApi(routes = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace('/api/v1', '');
    const key = `${method} ${path.split('?')[0]}`;
    calls.push({ method, path, key, body: init.body ? JSON.parse(init.body) : undefined });
    if (routes[key]) return typeof routes[key] === 'function' ? routes[key](path, init) : routes[key];
    if (key === 'GET /sitevisits') return ok([V1, V2], { page: 1, limit: 25, total: 2 });
    if (key === 'GET /sitevisits/v1') return ok(DETAIL);
    if (key === 'GET /masters') return ok(MASTERS);
    if (key === 'GET /users') return ok([{ id: 'u1', name: 'Asha' }, { id: 'u2', name: 'Vikram' }], { page: 1, limit: 100, total: 2 });
    if (key === 'GET /branches') return ok([{ _id: 'b1', name: 'Chennai', isActive: true }, { _id: 'b2', name: 'Madurai', isActive: true }], { page: 1, limit: 100, total: 2 });
    if (key === 'GET /units') return ok([{ id: 'un1', unitCode: 'UNT-000001', name: 'Lake View Villa', status: { label: 'Available' } }, { id: 'un3', unitCode: 'UNT-000003', name: 'City Flat', status: { label: 'Available' } }], { page: 1, limit: 8, total: 2 });
    // The two relationship endpoints the unit picker reads. Overridable per test through `routes`.
    if (key === 'GET /enquiries/e1/units') return ok(LINKED);
    if (key === 'GET /clients/c1/units') return ok(CLIENT_LINKED);
    if (key === 'GET /enquiries') return ok([{ id: 'e1', enquiryNo: 'ENQ-000001', name: 'Raj Kumar', branchId: 'b1', stage: { label: 'Interested' } }], { page: 1, limit: 8, total: 1 });
    if (key === 'GET /activities') return ok([{ _id: 'ac1', type: 'SITE_VISIT_CREATED', description: 'Site visit SV-000001 scheduled with Raj Kumar', at: '2026-01-05T10:00:00Z' }], { page: 1, limit: 50, total: 1 });
    if (key === 'GET /audit') return ok([{ id: 'au1', action: 'create', at: '2026-01-05T10:00:00Z', changes: { statusKey: { to: 'SCHEDULED' } } }], { page: 1, limit: 50, total: 1 });
    throw new Error(`unmocked ${key}`);
  }));
  return calls;
}
const wrap = (ui) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const app = (route, s) => renderWithApp(wrap(<Routes><Route path="/site-visits/*" element={<SiteVisitsRoutes />} /><Route path="/enquiries/:id" element={<div>ENQUIRY PAGE</div>} /></Routes>), { session: s, route });
const section = (s, props = {}) => renderWithApp(wrap(<Routes><Route path="*" element={<SiteVisitsSection enquiry={ENQ} {...props} />} /></Routes>), { session: s, route: '/x' });
const manager = session(['sitevisits.view', 'sitevisits.create', 'sitevisits.edit', 'sitevisits.assign', 'sitevisits.complete', 'sitevisits.cancel', 'sitevisits.archive', 'enquiries.view', 'units.view', 'users.view', 'activities.view', 'audit.view'], { dataScope: 'BRANCH', branchIds: ['b1'] });
/** Recording a unit link needs enquiries.edit, so the "add a unit" escape hatch is only offered to one. */
const editor = session([...manager.permissions, 'enquiries.edit'], { dataScope: 'BRANCH', branchIds: ['b1'] });
const multi = session(['sitevisits.view', 'users.view'], { dataScope: 'ALL', branchIds: [] });
const viewer = session(['sitevisits.view'], { dataScope: 'OWN', branchIds: ['b1'] });
const writes = (calls) => calls.filter((c) => c.method !== 'GET');
const pad = (n) => String(n).padStart(2, '0');
const localIn = (days, hhmm) => { const d = new Date(Date.now() + days * 86_400_000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${hhmm}`; };
afterEach(() => vi.unstubAllGlobals());

describe('Site visits list', () => {
  it('opens on Today and shows visits with master status, units, enquiry link and assignee', async () => {
    const calls = mockApi();
    app('/site-visits', manager);
    expect(await screen.findByText('SV-000001')).toBeTruthy();
    expect(calls.find((c) => c.key === 'GET /sitevisits').path).toContain('view=today');
    expect(screen.getByText('Scheduled', { selector: '.pill' })).toBeTruthy();
    expect(screen.getByText('Completed', { selector: '.pill' })).toBeTruthy();
    expect(screen.getByText('UNT-000001, UNT-000002')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'ENQ-000001' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Asha').length).toBeGreaterThan(0);
  });

  it('tabs, search, filters, dates, sort and paging go to the server', async () => {
    const calls = mockApi();
    app('/site-visits?view=upcoming&search=raj&status=COMPLETED&assignedTo=u2&from=2026-01-01&to=2026-02-01&sort=-visitNo&page=2', manager);
    await screen.findByText('SV-000001');
    const req = calls.find((c) => c.key === 'GET /sitevisits');
    for (const part of ['view=upcoming', 'search=raj', 'status=COMPLETED', 'assignedTo=u2', 'from=2026-01-01', 'to=2026-02-01', 'sort=-visitNo', 'page=2']) expect(req.path).toContain(part);
    fireEvent.click(screen.getByRole('tab', { name: 'Needs update' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /sitevisits' && c.path.includes('view=overdue'))).toBe(true));
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    await waitFor(() => expect(calls.filter((c) => c.key === 'GET /sitevisits').some((c) => !c.path.includes('view='))).toBe(true));
  });

  it('status options come from the master; the Branch filter appears only for multi-branch users', async () => {
    mockApi();
    const { unmount } = app('/site-visits', manager);
    await screen.findByText('SV-000001');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Cancelled' })).toBeTruthy());
    expect(screen.queryByLabelText('Branch')).toBeNull();
    unmount();
    app('/site-visits', multi);
    await screen.findByText('SV-000001');
    expect(screen.getByLabelText('Branch')).toBeTruthy();
  });

  it('row actions are exactly what the server allows; none for a read-only user', async () => {
    mockApi();
    const { unmount } = app('/site-visits', manager);
    await screen.findByText('SV-000001');
    const menus = screen.getAllByRole('button', { name: 'Actions' });
    fireEvent.click(menus[0]);
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open', 'Complete…', 'Edit', 'Reassign', 'Cancel visit']);
    fireEvent.click(menus[0]);
    fireEvent.click(menus[1]);
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open', 'Archive']);
    unmount();
    mockApi({ 'GET /sitevisits': ok([visit('v9', 'SV-000009', { allowed: NONE })], { page: 1, limit: 25, total: 1 }) });
    app('/site-visits', viewer);
    await screen.findByText('SV-000009');
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open']);
  });

  it('"Schedule visit" is offered only with sitevisits.create and enquiries.view', async () => {
    mockApi();
    const { unmount } = app('/site-visits', manager);
    expect(await screen.findByRole('button', { name: 'Schedule visit' })).toBeTruthy();
    unmount();
    app('/site-visits', viewer);
    await screen.findByText('SV-000001');
    expect(screen.queryByRole('button', { name: 'Schedule visit' })).toBeNull();
  });

  it('empty and error states are explicit', async () => {
    mockApi({ 'GET /sitevisits': ok([], { page: 1, limit: 25, total: 0 }) });
    const { unmount } = app('/site-visits', manager);
    expect(await screen.findByText('No visits today')).toBeTruthy();
    unmount();
    mockApi({ 'GET /sitevisits': fail(500, 'INTERNAL_ERROR', 'boom') });
    app('/site-visits', manager);
    expect((await screen.findAllByText(/boom|Could not load/)).length).toBeGreaterThan(0);
  });
});

describe('scheduling', () => {
  async function openFromEnquiry(s = manager, extra = {}) {
    const calls = mockApi({ 'GET /sitevisits': ok([], { page: 1, limit: 20, total: 0 }), 'POST /sitevisits': ok(V1), ...extra });
    section(s);
    fireEvent.click(await screen.findByRole('button', { name: 'Schedule site visit' }));
    return { calls, dialog: await screen.findByRole('dialog') };
  }

  it('needs a time in the future', async () => {
    const { calls, dialog } = await openFromEnquiry();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect(await within(dialog).findByText('Choose when')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/^When/), { target: { value: '2020-01-01T10:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect(await within(dialog).findByText('Choose a time in the future')).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
  });

  it('selects SEVERAL of the enquiry\'s LINKED units, removable, and posts them with the enquiry', async () => {
    const { calls, dialog } = await openFromEnquiry();
    await waitFor(() => expect(within(dialog).getByRole('checkbox', { name: /UNT-000003/ })).toBeTruthy());
    // The list comes from the relationship endpoint, not from the branch-wide unit search.
    expect(calls.some((c) => c.key === 'GET /enquiries/e1/units')).toBe(true);
    expect(calls.some((c) => c.key === 'GET /units')).toBe(false);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /UNT-000001/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /UNT-000003/ }));
    const chips = within(within(dialog).getByLabelText('Selected units'));
    expect(chips.getAllByText(/UNT-00000/)).toHaveLength(2);
    fireEvent.click(chips.getByRole('button', { name: 'Remove UNT-000001' }));
    expect(chips.queryByText(/UNT-000001/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /UNT-000001/ })); // pick it again
    // Filtering narrows the already-resolved list; it does not ask the server for a different one.
    fireEvent.change(within(dialog).getByPlaceholderText(/Filter the linked units/), { target: { value: 'city' } });
    await waitFor(() => expect(within(dialog).queryByRole('checkbox', { name: /UNT-000001/ })).toBeNull());
    expect(within(dialog).getByRole('checkbox', { name: /UNT-000003/ })).toBeTruthy();
    fireEvent.change(within(dialog).getByPlaceholderText(/Filter the linked units/), { target: { value: '' } });
    const local = localIn(2, '11:30');
    fireEvent.change(within(dialog).getByLabelText(/^When/), { target: { value: local } });
    fireEvent.change(within(dialog).getByLabelText('Notes'), { target: { value: 'Bring brochure' } });
    fireEvent.change(within(dialog).getByLabelText('Latitude'), { target: { value: '13.08' } });
    fireEvent.change(within(dialog).getByLabelText('Longitude'), { target: { value: '80.27' } });
    fireEvent.change(await within(dialog).findByLabelText('Visit by'), { target: { value: 'u2' } }).valueOf();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'POST /sitevisits', body: { enquiryId: 'e1', scheduledAt: new Date(local).toISOString(), unitIds: ['un3', 'un1'], notes: 'Bring brochure', latitude: 13.08, longitude: 80.27 } });
    expect(Object.keys(writes(calls)[0].body)).not.toContain('statusKey'); // status is never chosen by the client
  });

  it('offers ONLY the units linked to the enquiry — never the whole branch', async () => {
    // The branch-wide search would also return UNT-000003's neighbours; the relationship answer is the
    // only list that may appear here.
    const { dialog } = await openFromEnquiry();
    const list = await within(dialog).findByLabelText('Linked units');
    await within(list).findAllByRole('checkbox');
    expect(within(list).getAllByRole('checkbox')).toHaveLength(2);
    expect(list.textContent).toMatch(/UNT-000001/);
    expect(list.textContent).toMatch(/UNT-000003/);
  });

  it('shows each linked unit with its id, name and BOTH statuses (what the party has, and the unit\'s own)', async () => {
    const { dialog } = await openFromEnquiry();
    const row = (await within(dialog).findByText('UNT-000003')).closest('label');
    expect(row.textContent).toMatch(/City Flat/);            // name
    expect(row.textContent).toMatch(/Site visit planned/);   // the derived relationship
    expect(row.textContent).toMatch(/Available/);            // the unit's own inventory status
  });

  it('with nothing linked, says so and offers the existing Add-unit workflow instead of every branch unit', async () => {
    const { dialog } = await openFromEnquiry(editor, { 'GET /enquiries/e1/units': ok({ units: [] }) });
    expect(await within(dialog).findByText(/No units are linked to this enquiry yet/)).toBeTruthy();
    // Critically: no silent fallback to the branch-wide list.
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add a unit' }));
    // The EXISTING workflow opens (its own modal, on its eligible-units endpoint) — nothing was invented.
    // Two dialogs: the visit being scheduled and the EXISTING add-unit workflow on top of it.
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2));
    // The second dialog is the add-unit modal, subtitled with the enquiry it will link the unit to.
    expect(within(screen.getAllByRole('dialog')[1]).getByText('ENQ-000001 · Raj Kumar')).toBeTruthy();
  });

  it('says "no permission" rather than "no units" when the server cannot share units', async () => {
    const { dialog } = await openFromEnquiry(manager, { 'GET /enquiries/e1/units': ok({ units: null }) });
    expect(await within(dialog).findByText(/don't have permission to view units/)).toBeTruthy();
    expect(within(dialog).queryByText(/No units are linked/)).toBeNull();
  });

  it('from a client page, offers that client\'s units once each, across all of their enquiries', async () => {
    const calls = mockApi({ 'POST /sitevisits': ok(V1) });
    const related = {
      isPending: false,
      isError: false,
      data: {
        clientId: 'c1',
        enquiries: { rows: [{ id: 'e1', enquiryNo: 'ENQ-000001', name: 'Raj Kumar', branchId: 'b1', stage: { kind: 'OPEN', label: 'Negotiation' } }], truncated: false },
        followUps: { rows: [], truncated: false },
        bookings: { rows: [], truncated: false },
        siteVisits: { rows: [], truncated: false },
        units: { rows: [] },
      },
    };
    renderWithApp(wrap(<Routes><Route path="*" element={<ClientRelatedSections related={related} />} /></Routes>), { session: manager, route: '/x' });

    // A client with no visits yet can still schedule one — the action lives in the section header.
    fireEvent.click(await screen.findByRole('button', { name: 'Schedule site visit' }));
    const dialog = await screen.findByRole('dialog');
    // The enquiry comes from THIS client's list, not a search across every enquiry the caller can see.
    const select = within(dialog).getByLabelText(/^Enquiry/);
    expect(within(select).getByText(/ENQ-000001/)).toBeTruthy();
    fireEvent.change(select, { target: { value: 'e1' } });

    const list = await within(dialog).findByLabelText("This client's linked units");
    await within(list).findAllByRole('checkbox');
    expect(within(list).getAllByRole('checkbox')).toHaveLength(2);
    // un1 is touched by BOTH of the client's enquiries and is still listed once, naming both.
    expect(within(list).getAllByRole('checkbox', { name: /UNT-000001/ })).toHaveLength(1);
    expect(within(list).getByText(/via ENQ-000001, ENQ-000002/)).toBeTruthy();
    expect(calls.some((c) => c.key === 'GET /clients/c1/units')).toBe(true);

    fireEvent.change(within(dialog).getByLabelText(/^When/), { target: { value: localIn(2, '09:00') } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /UNT-000009/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0].body).toMatchObject({ enquiryId: 'e1', unitIds: ['un9'] });
  });

  it('standalone scheduling (no enquiry chosen yet) shows no unit list at all until there is a party', async () => {
    const calls = mockApi({ 'POST /sitevisits': ok(V1), 'GET /sitevisits/v1': ok(DETAIL) });
    app('/site-visits', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Schedule visit' }));
    const dialog = await screen.findByRole('dialog');
    // Nothing to relate a unit to, so the Units field is not offered — and the branch search is not
    // fired on the caller's behalf either.
    expect(within(dialog).queryByLabelText(/^Units/)).toBeNull();
    expect(calls.some((c) => c.key === 'GET /units')).toBe(false);
    expect(calls.some((c) => c.key === 'GET /enquiries/e1/units')).toBe(false);

    fireEvent.change(within(dialog).getByPlaceholderText(/Search enquiry/), { target: { value: 'raj' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /ENQ-000001 Raj Kumar/ }));
    expect(calls.some((c) => c.key === 'GET /enquiries' && c.path.includes('search=raj'))).toBe(true);
    expect(await within(dialog).findAllByRole('checkbox', { name: /UNT-000003/ })).toHaveLength(1);
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(2);
  });

  it('standalone + an enquiry with nothing linked offers the add-unit action, targeted at THAT enquiry', async () => {
    // Regression: the empty state used to say "link one first" while offering no way to do it, because
    // the add-unit workflow had no target in standalone mode.
    mockApi({ 'POST /sitevisits': ok(V1), 'GET /sitevisits/v1': ok(DETAIL), 'GET /enquiries/e1/units': ok({ units: [] }) });
    app('/site-visits', editor);
    fireEvent.click(await screen.findByRole('button', { name: 'Schedule visit' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByPlaceholderText(/Search enquiry/), { target: { value: 'raj' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /ENQ-000001 Raj Kumar/ }));

    expect(await within(dialog).findByText(/No units are linked to this enquiry yet/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add a unit' }));
    // The add-unit modal opens on the enquiry just picked, so the link lands on the right enquiry.
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2));
    expect(within(screen.getAllByRole('dialog')[1]).getByText('ENQ-000001 · Raj Kumar')).toBeTruthy();
  });

  it('hides the add-unit action for a LOST enquiry, which can take neither a link nor a visit', async () => {
    mockApi({
      'POST /sitevisits': ok(V1), 'GET /sitevisits/v1': ok(DETAIL), 'GET /enquiries/e1/units': ok({ units: [] }),
      'GET /enquiries': ok([{ id: 'e1', enquiryNo: 'ENQ-000001', name: 'Raj Kumar', branchId: 'b1', stage: { label: 'Lost', kind: 'LOST' } }], { page: 1, limit: 8, total: 1 }),
    });
    app('/site-visits', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Schedule visit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText(/Search enquiry/), { target: { value: 'raj' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /ENQ-000001 Raj Kumar/ }));

    expect(await within(dialog).findByText(/No units are linked to this enquiry yet/)).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Add a unit' })).toBeNull();
  });

  it('coordinates must be a valid pair', async () => {
    const { calls, dialog } = await openFromEnquiry();
    fireEvent.change(within(dialog).getByLabelText(/^When/), { target: { value: localIn(2, '11:30') } });
    fireEvent.change(within(dialog).getByLabelText('Latitude'), { target: { value: '95' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect(await within(dialog).findByText('Latitude must be between -90 and 90')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Latitude'), { target: { value: '12' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect(await within(dialog).findByText('Enter the longitude too')).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
  });

  it("shows the server's refusal (stage rule, wrong-branch unit) instead of failing silently", async () => {
    const { calls, dialog } = await openFromEnquiry(manager, { 'POST /sitevisits': fail(409, 'STAGE_SKIP', 'Cannot move from "New" to "Site Visit Scheduled": stages cannot be skipped (next is "Contacted")') });
    fireEvent.change(within(dialog).getByLabelText(/^When/), { target: { value: localIn(2, '11:30') } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/stages cannot be skipped/);
    expect(writes(calls)).toHaveLength(1);
  });

  it('from the list: pick an enquiry by server search, then schedule', async () => {
    const calls = mockApi({ 'POST /sitevisits': ok(V1), 'GET /sitevisits/v1': ok(DETAIL) });
    app('/site-visits', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Schedule visit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect(await within(dialog).findByText('Choose when')).toBeTruthy();
    fireEvent.change(within(dialog).getByPlaceholderText(/Search enquiry/), { target: { value: 'raj' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /ENQ-000001 Raj Kumar/ }));
    expect(calls.some((c) => c.key === 'GET /enquiries' && c.path.includes('search=raj'))).toBe(true);
    await waitFor(() => expect(within(dialog).getByLabelText('Linked units')).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText(/^When/), { target: { value: localIn(2, '09:00') } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0].body).toMatchObject({ enquiryId: 'e1', unitIds: [] });
    expect(await screen.findByRole('heading', { name: /Raj Kumar/ })).toBeTruthy(); // opened the new visit
  });

  it('dragging an enquiry onto the guarded stage opens the schedule dialog (the visit moves the enquiry, not the card)', async () => {
    mockApi({ 'GET /sitevisits': ok([], { page: 1, limit: 20, total: 0 }) });
    function Harness() {
      const mover = useStageMover();
      return (
        <>
          <button type="button" onClick={() => mover.requestMove({ ...ENQ, stageCode: 'INTERESTED' }, { to: 'SITE_VISIT_SCHEDULED', label: 'Site Visit Scheduled', domainOperation: 'sitevisit.schedule' })}>drop</button>
          {mover.dialog}
        </>
      );
    }
    renderWithApp(wrap(<Harness />), { session: manager });
    fireEvent.click(screen.getByText('drop'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Schedule site visit')).toBeTruthy();
    expect(within(dialog).getByText(/ENQ-000001 · Raj Kumar/)).toBeTruthy();
  });

  it('the enquiry section lists its visits with allowed actions and hides scheduling when the enquiry is closed or the user cannot create', async () => {
    mockApi({ 'GET /sitevisits': ok([V1, V2], { page: 1, limit: 20, total: 2 }) });
    const { unmount } = section(manager, { canSchedule: false });
    await screen.findByText('SV-000002');
    const list = within(screen.getByLabelText('Site visits'));
    expect(list.getAllByRole('link')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Schedule site visit' })).toBeNull();
    fireEvent.click(list.getAllByRole('button', { name: 'Actions' })[0]);
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toContain('Complete…');
    unmount();
    const calls = mockApi();
    section(session([], { dataScope: 'OWN' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Site visits')).toBeNull();
    expect(calls.some((c) => c.key === 'GET /sitevisits')).toBe(false);
  });
});

describe('visit detail', () => {
  it('shows the visit, units (linked only when visible), assignment history, timeline and audit', async () => {
    mockApi();
    app('/site-visits/v1', manager);
    expect(await screen.findByRole('heading', { name: /Raj Kumar/ })).toBeTruthy();
    expect(screen.getAllByText('SV-000001').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'ENQ-000001' }).getAttribute('href')).toBe('/enquiries/e1');
    const units = within(screen.getByLabelText('Units'));
    expect(units.getByRole('link', { name: 'UNT-000001' }).getAttribute('href')).toBe('/units/un1');
    expect(units.getByText('UNT-000002')).toBeTruthy();
    expect(units.queryByRole('link', { name: 'UNT-000002' })).toBeNull(); // not visible to this viewer: code only
    expect(screen.getByRole('link', { name: '13.08, 80.27' }).getAttribute('href')).toContain('13.08,80.27');
    const history = within(screen.getByLabelText('Assignment history'));
    expect(history.getAllByRole('listitem')).toHaveLength(2);
    expect(history.getByText(/On leave/)).toBeTruthy();
    expect(await screen.findByText('Site visit SV-000001 scheduled with Raj Kumar')).toBeTruthy();
    expect(await screen.findByText('create')).toBeTruthy();
  });

  it('a completed visit shows its outcome and the follow-up it created', async () => {
    mockApi({ 'GET /sitevisits/v1': ok(DONE) });
    app('/site-visits/v1', manager);
    expect(await screen.findByText('Loved the plot')).toBeTruthy();
    expect(screen.getByText('Wants lower floor')).toBeTruthy();
    expect(screen.getByText('view on enquiry')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Complete…' })).toBeNull();
  });

  it('a cancelled visit shows the reason', async () => {
    mockApi({ 'GET /sitevisits/v1': ok({ ...DETAIL, statusKey: 'CANCELLED', status: { label: 'Cancelled' }, cancelReason: 'Customer travelling', cancelledAt: '2026-01-08T10:00:00Z', allowed: NONE }) });
    app('/site-visits/v1', manager);
    expect(await screen.findByText('Customer travelling')).toBeTruthy();
  });

  it('without activities.view / audit.view they are not even requested; controls follow allowed flags', async () => {
    const calls = mockApi({ 'GET /sitevisits/v1': ok({ ...DETAIL, allowed: NONE }) });
    app('/site-visits/v1', viewer);
    await screen.findByRole('heading', { name: /Raj Kumar/ });
    expect(calls.some((c) => c.key === 'GET /activities' || c.key === 'GET /audit')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Complete…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull();
  });

  it('a missing or foreign visit shows not found', async () => {
    mockApi({ 'GET /sitevisits/v1': fail(404, 'NOT_FOUND', 'Site visit not found') });
    app('/site-visits/v1', manager);
    expect((await screen.findAllByText(/not found|Could not load/i)).length).toBeGreaterThan(0);
  });
});

describe('lifecycle actions', () => {
  const openComplete = async (routes = {}) => {
    const calls = mockApi({ 'POST /sitevisits/v1/complete': ok(DONE), ...routes });
    app('/site-visits/v1', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Complete…' }));
    return { calls, dialog: await screen.findByRole('dialog') };
  };

  it('completing needs feedback, explains the follow-up, and posts the outcome', async () => {
    const { calls, dialog } = await openComplete();
    expect(within(dialog).getByText(/schedules one follow-up for the next day/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark complete' }));
    expect(await within(dialog).findByText('Record the visit feedback')).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Feedback/), { target: { value: '  Loved the plot ' } });
    fireEvent.change(within(dialog).getByLabelText('Notes'), { target: { value: 'Wants lower floor' } });
    fireEvent.change(within(dialog).getByLabelText('Visit latitude'), { target: { value: '13.0827' } });
    fireEvent.change(within(dialog).getByLabelText('Visit longitude'), { target: { value: '80.2707' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark complete' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'POST /sitevisits/v1/complete', body: { feedback: 'Loved the plot', notes: 'Wants lower floor', latitude: 13.0827, longitude: 80.2707 } });
    expect(Object.keys(writes(calls)[0].body)).not.toContain('followUp'); // the server creates the follow-up
  });

  it('validates the completion time and coordinates before sending', async () => {
    const { calls, dialog } = await openComplete();
    fireEvent.change(within(dialog).getByLabelText(/Feedback/), { target: { value: 'ok' } });
    fireEvent.change(within(dialog).getByLabelText('Completed at'), { target: { value: localIn(3, '10:00') } });
    fireEvent.change(within(dialog).getByLabelText('Visit latitude'), { target: { value: '12' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark complete' }));
    expect(await within(dialog).findByText('Choose a time that has passed')).toBeTruthy();
    expect(within(dialog).getByText('Enter the longitude too')).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
  });

  it("shows the server's refusal (already completed) inside the dialog", async () => {
    const { dialog } = await openComplete({ 'POST /sitevisits/v1/complete': fail(409, 'ALREADY_COMPLETED', 'This site visit has already been completed') });
    fireEvent.change(within(dialog).getByLabelText(/Feedback/), { target: { value: 'ok' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark complete' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/already been completed/);
  });

  it('cancelling needs a reason', async () => {
    const calls = mockApi({ 'POST /sitevisits/v1/cancel': ok(DETAIL) });
    app('/site-visits/v1', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel visit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel visit' }));
    expect(await within(dialog).findByText('Give a reason')).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Customer travelling' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel visit' }));
    await waitFor(() => expect(writes(calls)[0]?.body).toEqual({ reason: 'Customer travelling' }));
  });

  it('reassigning needs a person and a reason, excludes the current assignee, and posts both', async () => {
    const calls = mockApi({ 'POST /sitevisits/v1/assign': ok(DETAIL) });
    app('/site-visits/v1', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reassign' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Vikram' })).toBeTruthy());
    expect(within(dialog).queryByRole('option', { name: 'Asha' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Choose who will do the visit')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Visit by/), { target: { value: 'u2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Give a reason for reassigning')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'On leave' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'POST /sitevisits/v1/assign', body: { assignedTo: 'u2', reason: 'On leave' } });
  });

  it('a conflicting reassignment is reported by the server message', async () => {
    mockApi({ 'POST /sitevisits/v1/assign': fail(409, 'ASSIGNMENT_CHANGED', 'The visit was reassigned or closed by someone else. Refresh and try again.') });
    app('/site-visits/v1', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reassign' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Vikram' })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText(/Visit by/), { target: { value: 'u2' } });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/reassigned or closed by someone else/)).toBeTruthy();
  });

  it('editing sends only what changed', async () => {
    const calls = mockApi({ 'PATCH /sitevisits/v1': ok(DETAIL) });
    app('/site-visits/v1', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes(calls)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const d2 = await screen.findByRole('dialog');
    fireEvent.change(within(d2).getByLabelText('Notes'), { target: { value: '' } });
    fireEvent.click(within(d2).getByRole('checkbox', { name: /UNT-000001/ }).closest('label') ? within(d2).getByRole('button', { name: 'Remove UNT-000002' }) : within(d2).getByRole('button', { name: 'Remove UNT-000002' }));
    fireEvent.click(within(d2).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'PATCH /sitevisits/v1', body: { notes: null, unitIds: ['un1'] } });
    expect(Object.keys(writes(calls)[0].body).sort()).toEqual(['notes', 'unitIds']);
  });

  it('archiving asks first, then returns to the list', async () => {
    const calls = mockApi({ 'GET /sitevisits/v1': ok(DONE), 'DELETE /sitevisits/v1': noContent });
    app('/site-visits/v1', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog');
    expect(writes(calls)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(writes(calls)[0]?.key).toBe('DELETE /sitevisits/v1'));
    expect((await screen.findAllByRole('heading', { name: 'Site Visits' })).length).toBeGreaterThan(0);
  });
});

describe('navigation', () => {
  it('Site Visits is a real page for sitevisits.view holders, and refused by URL otherwise', async () => {
    mockApi();
    const { unmount } = renderWithApp(wrap(<AppRoutes />), { session: manager, route: '/site-visits' });
    expect((await screen.findAllByRole('heading', { name: 'Site Visits' })).length).toBeGreaterThan(0);
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    unmount();
    renderWithApp(wrap(<AppRoutes />), { session: session(['dashboard.view']), route: '/site-visits' });
    expect(await screen.findByText(/don't have access/i)).toBeTruthy();
  });
});
