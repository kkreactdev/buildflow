import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../app/AppProviders';
import { renderWithApp, session } from '../../test/render';
import { NotificationBell } from '../notifications/NotificationBell';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { FollowUpsPage } from './FollowUpsPage';
import { FollowUpsSection } from './FollowUpsSection';

const ok = (data, meta) => ({ ok: true, status: 200, json: async () => ({ data, ...(meta ? { meta } : {}) }) });
const noContent = { ok: true, status: 204, json: async () => ({}) };
const fail = (status, code, message) => ({ ok: false, status, json: async () => ({ error: { code, message } }) });
const ALL = { edit: true, complete: true, reschedule: true, cancel: true, archive: true };
const NONE = { edit: false, complete: false, reschedule: false, cancel: false, archive: false };
const fu = (id, over = {}) => ({
  id, branchId: 'b1', personId: 'p1', name: 'Raj Kumar', phone: '+91 98765 43210', enquiryId: 'e1', enquiryNo: 'ENQ-000001', assignedTo: 'u1', assignedToName: 'Asha',
  typeId: 't1', type: { label: 'Call', isActive: true }, statusId: 's1', statusKey: 'PENDING', status: { label: 'Pending', color: '#3f6690', isActive: true },
  scheduledAt: '2026-10-09T10:00:00Z', notes: 'Discuss budget', isArchived: false, allowed: ALL, ...over,
});
const OPEN = fu('f1');
const MISSED = fu('f2', { name: 'Esha Rao', statusKey: 'MISSED', status: { label: 'Missed', isActive: true }, scheduledAt: '2026-10-01T10:00:00Z', notes: undefined });
const DONE = fu('f3', { statusKey: 'COMPLETED', status: { label: 'Completed', isActive: true }, outcome: 'Wants a visit', allowed: { ...NONE, archive: true } });
const pageMeta = (n, limit = 25) => ({ page: 1, limit, total: n });

function mockApi(routes = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace('/api/v1', '');
    const key = `${method} ${path.split('?')[0]}`;
    calls.push({ method, path, key, body: init.body ? JSON.parse(init.body) : undefined });
    if (routes[key]) return typeof routes[key] === 'function' ? routes[key](path, init) : routes[key];
    if (key === 'GET /followups/summary') return ok({ today: 3, missed: 2, upcoming: 5, open: 10 });
    if (key === 'GET /followups') return ok([OPEN, MISSED], pageMeta(2));
    if (key === 'GET /masters') return ok({ FOLLOWUP_TYPE: [{ _id: 't1', code: 'CALL', label: 'Call', isActive: true }, { _id: 't2', code: 'MEETING', label: 'Meeting', isActive: true }], FOLLOWUP_STATUS: [{ _id: 's1', code: 'PENDING', label: 'Pending', isActive: true }, { _id: 's2', code: 'MISSED', label: 'Missed', isActive: true }] });
    if (key === 'GET /users') return ok([{ id: 'u1', name: 'Asha' }, { id: 'u2', name: 'Vikram' }], pageMeta(2, 100));
    if (key === 'GET /branches') return ok([{ _id: 'b1', name: 'Chennai', isActive: true }], pageMeta(1, 100));
    if (key === 'GET /notifications/unread-count') return ok({ unread: 2 });
    throw new Error(`unmocked ${key}`);
  }));
  return calls;
}
const wrap = (ui) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const page = (ui, s, route = '/x') => renderWithApp(wrap(<Routes><Route path="*" element={ui} /></Routes>), { session: s, route });
const manager = session(['followups.view', 'followups.create', 'followups.edit', 'followups.archive', 'users.view', 'notifications.view'], { dataScope: 'BRANCH', branchIds: ['b1'] });
const viewer = session(['followups.view'], { dataScope: 'OWN', branchIds: ['b1'] });
const writes = (calls) => calls.filter((c) => c.method !== 'GET');
const pad = (n) => String(n).padStart(2, '0');
const localIn = (days, hhmm) => { const d = new Date(Date.now() + days * 86_400_000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${hhmm}`; };
afterEach(() => vi.unstubAllGlobals());

describe('Follow-ups page', () => {
  it('opens on Today with live counts from the server', async () => {
    const calls = mockApi();
    page(<FollowUpsPage />, manager);
    expect(await screen.findByRole('tab', { name: 'Today (3)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Missed (2)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Upcoming (5)' })).toBeTruthy();
    await screen.findByText('Raj Kumar');
    expect(calls.find((c) => c.key === 'GET /followups').path).toContain('view=today');
  });

  it('switching tabs asks the server for that view', async () => {
    const calls = mockApi();
    page(<FollowUpsPage />, manager);
    await screen.findByText('Raj Kumar');
    fireEvent.click(screen.getByRole('tab', { name: 'Missed (2)' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /followups' && c.path.includes('view=missed'))).toBe(true));
    fireEvent.click(screen.getByRole('tab', { name: 'Upcoming (5)' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /followups' && c.path.includes('view=upcoming'))).toBe(true));
  });

  it('shows master labels, flags missed, links to the enquiry, and builds filters from masters', async () => {
    mockApi();
    page(<FollowUpsPage />, manager);
    await screen.findByText('Raj Kumar');
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    expect(document.querySelector('.fu-missed')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'ENQ-000001' }).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Meeting' })).toBeTruthy());
  });

  it('sends search, filters and paging from the URL to the server', async () => {
    const calls = mockApi();
    page(<FollowUpsPage />, manager, '/x?view=upcoming&search=raj&typeId=t1&status=MISSED&page=2');
    await screen.findByText('Raj Kumar');
    const req = calls.find((c) => c.key === 'GET /followups');
    for (const part of ['view=upcoming', 'search=raj', 'typeId=t1', 'status=MISSED', 'page=2']) expect(req.path).toContain(part);
  });

  it('offers exactly the actions the server allows, and no menu when none', async () => {
    mockApi({ 'GET /followups': ok([OPEN, DONE], pageMeta(2)) });
    const { unmount } = page(<FollowUpsPage />, manager);
    await screen.findAllByText('Raj Kumar');
    const menus = screen.getAllByRole('button', { name: 'Actions' });
    fireEvent.click(menus[0]);
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Complete', 'Reschedule', 'Edit', 'Cancel follow-up', 'Archive']);
    fireEvent.click(menus[0]);
    fireEvent.click(menus[1]);
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Archive']);
    unmount();
    mockApi({ 'GET /followups': ok([fu('f9', { allowed: NONE })], pageMeta(1)) });
    page(<FollowUpsPage />, viewer);
    await screen.findAllByText('Raj Kumar');
    expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull();
  });

  it('empty and error states are explicit', async () => {
    mockApi({ 'GET /followups': ok([], pageMeta(0)) });
    const { unmount } = page(<FollowUpsPage />, manager);
    expect(await screen.findByText('Nothing due today')).toBeTruthy();
    unmount();
    mockApi({ 'GET /followups': fail(500, 'INTERNAL_ERROR', 'boom') });
    page(<FollowUpsPage />, manager);
    expect((await screen.findAllByText(/boom|Could not load/)).length).toBeGreaterThan(0);
  });
});

describe('follow-up actions', () => {
  async function open(label) {
    await screen.findByText('Raj Kumar');
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: label }));
    return screen.findByRole('dialog');
  }

  it('completing sends the outcome and nothing else (no auto follow-up)', async () => {
    const calls = mockApi({ 'POST /followups/f1/complete': ok(OPEN) });
    page(<FollowUpsPage />, manager);
    const dialog = await open('Complete');
    expect(within(dialog).getByText(/schedule a new follow-up afterwards/i)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Outcome/), { target: { value: 'Wants a site visit' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark complete' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'POST /followups/f1/complete', body: { outcome: 'Wants a site visit' } });
  });

  it('rescheduling needs a future time', async () => {
    const calls = mockApi({ 'POST /followups/f1/reschedule': ok(OPEN) });
    page(<FollowUpsPage />, manager);
    const dialog = await open('Reschedule');
    fireEvent.change(within(dialog).getByLabelText(/New time/), { target: { value: '2020-01-01T10:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reschedule' }));
    await waitFor(() => expect(dialog.querySelector('[role="alert"], .field-error, .form-error')).toBeTruthy());
    expect(writes(calls)).toHaveLength(0);
    const local = localIn(2, '10:00');
    fireEvent.change(within(dialog).getByLabelText(/New time/), { target: { value: local } });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Customer travelling' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reschedule' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0].body).toEqual({ scheduledAt: new Date(local).toISOString(), reason: 'Customer travelling' });
  });

  it('cancelling requires a reason', async () => {
    const calls = mockApi({ 'POST /followups/f1/cancel': ok(OPEN) });
    page(<FollowUpsPage />, manager);
    const dialog = await open('Cancel follow-up');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel follow-up' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(writes(calls)).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Not interested' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel follow-up' }));
    await waitFor(() => expect(writes(calls)[0]?.body).toEqual({ reason: 'Not interested' }));
  });

  it("shows the server's refusal inside the dialog", async () => {
    mockApi({ 'POST /followups/f1/complete': fail(409, 'FOLLOWUP_CHANGED', 'The follow-up was changed by someone else.') });
    page(<FollowUpsPage />, manager);
    const dialog = await open('Complete');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark complete' }));
    expect(await within(dialog).findByText(/changed by someone else/)).toBeTruthy();
  });

  it('archiving asks for confirmation first', async () => {
    const calls = mockApi({ 'DELETE /followups/f1': noContent });
    page(<FollowUpsPage />, manager);
    await screen.findByText('Raj Kumar');
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog');
    expect(writes(calls)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(writes(calls)[0]?.key).toBe('DELETE /followups/f1'));
  });
});

describe('scheduling from an enquiry or client', () => {
  it("lists that record's follow-ups and schedules a new one anchored to it", async () => {
    const calls = mockApi({ 'GET /followups': ok([OPEN, DONE], pageMeta(2, 20)), 'POST /followups': ok(OPEN) });
    page(<FollowUpsSection anchor={{ enquiryId: 'e1' }} branchId="b1" />, manager);
    expect((await screen.findAllByText(/Discuss budget/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Outcome: Wants a visit/)).toBeTruthy();
    expect(calls.find((c) => c.key === 'GET /followups').path).toContain('enquiryId=e1');
    fireEvent.click(screen.getByRole('button', { name: 'Schedule follow-up' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Meeting' })).toBeTruthy());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(writes(calls)).toHaveLength(0); // type and time are required
    const local = localIn(1, '15:30');
    fireEvent.change(within(dialog).getByLabelText(/Type/), { target: { value: 't2' } });
    fireEvent.change(within(dialog).getByLabelText(/When/), { target: { value: local } });
    fireEvent.change(within(dialog).getByLabelText('Notes'), { target: { value: 'Bring brochure' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0].body).toMatchObject({ enquiryId: 'e1', typeId: 't2', scheduledAt: new Date(local).toISOString(), notes: 'Bring brochure' });
  });

  it('client anchor sends clientId; no create right = no button; no view right = no section and no request', async () => {
    const calls = mockApi({ 'GET /followups': ok([], pageMeta(0, 20)) });
    const { unmount } = page(<FollowUpsSection anchor={{ clientId: 'c1' }} branchId="b1" />, viewer);
    expect(await screen.findByText('No follow-ups yet')).toBeTruthy();
    expect(calls.find((c) => c.key === 'GET /followups').path).toContain('clientId=c1');
    expect(screen.queryByRole('button', { name: 'Schedule follow-up' })).toBeNull();
    unmount();
    const none = mockApi();
    page(<FollowUpsSection anchor={{ enquiryId: 'e1' }} branchId="b1" />, session([], { dataScope: 'OWN' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Follow-ups')).toBeNull();
    expect(none.some((c) => c.key === 'GET /followups')).toBe(false);
  });
});

describe('notifications UI', () => {
  const NOTES = [
    { id: 'n1', eventCode: 'FOLLOWUP_MISSED', title: 'Missed follow-up: Raj Kumar', body: 'Call was due', refs: [{ type: 'followup', id: 'f2' }, { type: 'enquiry', id: 'e1' }], read: false, createdAt: new Date().toISOString() },
    { id: 'n2', eventCode: 'FOLLOWUP_UPCOMING', title: 'Due soon: Esha', refs: [{ type: 'client', id: 'c9' }], read: true, createdAt: new Date().toISOString() },
  ];
  const bell = (s) => render(wrap(
    <AppProviders initialSession={s}>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<NotificationBell />} />
          <Route path="/enquiries/:id" element={<div>ENQUIRY PAGE</div>} />
          <Route path="/clients/:id" element={<div>CLIENT PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  ));

  it('shows the server unread count, and nothing without notifications.view', async () => {
    const calls = mockApi();
    const { unmount } = bell(manager);
    expect(await screen.findByRole('button', { name: 'Notifications, 2 unread' })).toBeTruthy();
    unmount();
    calls.length = 0;
    bell(viewer);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: /Notifications/ })).toBeNull();
    expect(calls.some((c) => c.key.includes('notifications'))).toBe(false);
  });

  it('clicking an unread item marks it read and opens the related record', async () => {
    const calls = mockApi({ 'GET /notifications': ok(NOTES, { page: 1, limit: 8, total: 2, unread: 1 }), 'POST /notifications/n1/read': noContent });
    bell(manager);
    fireEvent.click(await screen.findByRole('button', { name: /Notifications, 2 unread/ }));
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    fireEvent.click(await within(panel).findByText('Missed follow-up: Raj Kumar'));
    expect(await screen.findByText('ENQUIRY PAGE')).toBeTruthy();
    expect(calls.some((c) => c.key === 'POST /notifications/n1/read')).toBe(true);
  });

  it('a read item is not re-marked; client refs open the client', async () => {
    const calls = mockApi({ 'GET /notifications': ok(NOTES, { page: 1, limit: 8, total: 2, unread: 1 }) });
    bell(manager);
    fireEvent.click(await screen.findByRole('button', { name: /Notifications, 2 unread/ }));
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    fireEvent.click(await within(panel).findByText('Due soon: Esha'));
    expect(await screen.findByText('CLIENT PAGE')).toBeTruthy();
    expect(calls.some((c) => c.key === 'POST /notifications/n2/read')).toBe(false);
  });

  it('mark all read calls the server; empty state is friendly', async () => {
    const calls = mockApi({ 'GET /notifications': ok([], { page: 1, limit: 8, total: 0, unread: 0 }), 'POST /notifications/read-all': ok({ updated: 2 }) });
    bell(manager);
    fireEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    expect(await screen.findByText("You're all caught up.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /notifications/read-all')).toBe(true));
  });

  it('the Notifications page lists, filters unread and navigates', async () => {
    const calls = mockApi({ 'GET /notifications': ok(NOTES, { page: 1, limit: 25, total: 2, unread: 1 }), 'POST /notifications/n1/read': noContent });
    renderWithApp(wrap(<Routes><Route path="/notifications" element={<NotificationsPage />} /><Route path="/enquiries/:id" element={<div>ENQUIRY PAGE</div>} /></Routes>), { session: manager, route: '/notifications' });
    expect(await screen.findByText('Missed follow-up: Raj Kumar')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Unread (1)' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /notifications' && c.path.includes('unread=true'))).toBe(true));
    fireEvent.click(screen.getByText('Missed follow-up: Raj Kumar'));
    expect(await screen.findByText('ENQUIRY PAGE')).toBeTruthy();
  });
});
