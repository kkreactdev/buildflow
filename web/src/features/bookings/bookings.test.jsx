import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../app/App';
import { renderWithApp, session } from '../../test/render';
import { useStageMover } from '../enquiries/useStageMover';
import { UnitsRoutes } from '../units/UnitsRoutes';
import { BookingsRoutes } from './BookingsRoutes';
import { BookingsSection } from './BookingsSection';

const ok = (data, meta) => ({ ok: true, status: 200, json: async () => ({ data, ...(meta ? { meta } : {}) }) });
const fail = (status, code, message, details) => ({ ok: false, status, json: async () => ({ error: { code, message, details } }) });
const ALLOWED = { edit: true, release: true };
const NONE = { edit: false, release: false };
const PAST = new Date(Date.now() - 86_400_000).toISOString();

const booking = (id, no, over = {}) => ({
  id, bookingNo: no, branchId: 'b1', branch: { name: 'Chennai', code: 'CHN' }, unitId: 'un1', unitCode: 'UNT-000001', unitName: 'Lake View Villa', enquiryId: 'e1', enquiryNo: 'ENQ-000001', personId: 'p1',
  name: 'Raj Kumar', phone: '+91 98765 43210', phoneE164: '+919876543210', salespersonId: 'u1', salespersonName: 'Asha', bookedBy: 'u0', bookedByName: 'Mgr', bookingDate: PAST,
  notes: 'Token paid', status: 'ACTIVE', isActive: true, allowed: ALLOWED, ...over,
});
const B1 = booking('b1', 'BK-000001');
const B2 = booking('b2', 'BK-000002', { name: 'Esha Rao', status: 'RELEASED', isActive: false, releasedAt: PAST, releasedByName: 'Mgr', releaseReason: 'Customer withdrew', allowed: NONE });
const DETAIL = { ...B1, history: [{ id: 'h1', type: 'CREATED', byName: 'Mgr', at: PAST }] };
const RELEASED_DETAIL = { ...B2, history: [{ id: 'h1', type: 'CREATED', byName: 'Mgr', at: PAST }, { id: 'h2', type: 'RELEASED', byName: 'Mgr', reason: 'Customer withdrew', at: PAST }] };
const CONFLICT = { id: 'c1', unitId: 'un1', unitCode: 'UNT-000001', existingBookingId: 'b1', existingBookingNo: 'BK-000001', attemptedByName: 'Vikram', attemptedEnquiryId: 'e2', attemptedEnquiryNo: 'ENQ-000002', attemptedPersonName: 'Esha Rao', status: 'OPEN', createdAt: PAST, allowed: { resolve: true } };

const UNIT = {
  id: 'un1', unitCode: 'UNT-000001', name: 'Lake View Villa', branchId: 'b1', branch: { name: 'Chennai' }, statusId: 'sa', statusKey: 'AVAILABLE', status: { label: 'Available', isActive: true },
  isArchived: false, media: [], assignments: [], allowed: { edit: true, assign: true, changeStatus: true, archive: true, manageMedia: true },
  booking: { visible: true, active: undefined, history: [], allowed: { book: true, release: false } },
};
const UNIT_BOOKED = { ...UNIT, statusKey: 'BOOKED', status: { label: 'Booked' }, booking: { visible: true, active: B1, history: [B2], allowed: { book: false, release: true } } };

function bodyOf(init) {
  return init.body ? JSON.parse(init.body) : undefined;
}
const MASTERS = { UNIT_STATUS: [{ _id: 'sa', code: 'AVAILABLE', systemKey: 'AVAILABLE', label: 'Available', isActive: true }, { _id: 'sb', code: 'BOOKED', systemKey: 'BOOKED', label: 'Booked', isActive: true }] };

function mockApi(routes = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace('/api/v1', '');
    const key = `${method} ${path.split('?')[0]}`;
    calls.push({ method, path, key, body: bodyOf(init) });
    if (routes[key]) return typeof routes[key] === 'function' ? routes[key](path, init) : routes[key];
    if (key === 'GET /bookings') return ok([B1, B2], { page: 1, limit: 25, total: 2 });
    if (key === 'GET /bookings/b1') return ok(DETAIL);
    if (key === 'GET /booking-conflicts') return ok([CONFLICT], { page: 1, limit: 25, total: 1 });
    if (key === 'GET /units/un1') return ok(UNIT);
    if (key === 'GET /units') return ok([{ id: 'un1', unitCode: 'UNT-000001', name: 'Lake View Villa', status: { label: 'Available' } }], { page: 1, limit: 8, total: 1 });
    if (key === 'GET /enquiries') return ok([{ id: 'e1', enquiryNo: 'ENQ-000001', name: 'Raj Kumar', branchId: 'b1', stage: { label: 'Negotiation' } }], { page: 1, limit: 8, total: 1 });
    if (key === 'GET /masters') return ok(MASTERS);
    if (key === 'GET /users') return ok([{ id: 'u1', name: 'Asha' }, { id: 'u2', name: 'Vikram' }], { page: 1, limit: 100, total: 2 });
    if (key === 'GET /branches') return ok([{ _id: 'b1', name: 'Chennai', isActive: true }, { _id: 'b2', name: 'Madurai', isActive: true }], { page: 1, limit: 100, total: 2 });
    if (key === 'GET /activities') return ok([{ _id: 'a1', type: 'BOOKING_CREATED', description: 'Unit UNT-000001 booked for Raj Kumar (BK-000001)', at: PAST }], { page: 1, limit: 50, total: 1 });
    if (key === 'GET /audit') return ok([{ id: 'au1', action: 'create', at: PAST }], { page: 1, limit: 50, total: 1 });
    throw new Error(`unmocked ${key}`);
  }));
  return calls;
}
const wrap = (ui) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const app = (route, s) => renderWithApp(wrap(<Routes><Route path="/bookings/*" element={<BookingsRoutes />} /><Route path="/units/*" element={<UnitsRoutes />} /></Routes>), { session: s, route });
const manager = session(['bookings.view', 'bookings.create', 'bookings.edit', 'bookings.release', 'bookings.resolve_conflict', 'units.view', 'enquiries.view', 'users.view', 'activities.view', 'audit.view'], { dataScope: 'BRANCH', branchIds: ['b1'] });
const executive = session(['bookings.view', 'bookings.create', 'units.view', 'enquiries.view'], { dataScope: 'OWN', branchIds: ['b1'] });
const multi = session(['bookings.view', 'users.view'], { dataScope: 'ALL', branchIds: [] });
const writes = (calls) => calls.filter((c) => c.method !== 'GET');
const pad = (n) => String(n).padStart(2, '0');
const localAgo = (mins) => { const d = new Date(Date.now() - mins * 60_000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
afterEach(() => vi.unstubAllGlobals());

describe('Bookings list', () => {
  it('shows bookings with unit, person, enquiry, salesperson, date and active/released status', async () => {
    const calls = mockApi();
    app('/bookings', manager);
    expect(await screen.findByText('BK-000001')).toBeTruthy();
    expect(screen.getByText('Active', { selector: '.pill' })).toBeTruthy();
    expect(screen.getByText('Released', { selector: '.pill' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'UNT-000001' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Conflicts' }).getAttribute('href')).toBe('/bookings/conflicts');
    expect(calls.find((c) => c.key === 'GET /bookings').path).toContain('sort=-bookingDate');
  });

  it('search, filters, dates, sort and paging go to the server; Branch filter only for multi-branch users', async () => {
    const calls = mockApi();
    const { unmount } = app('/bookings?search=raj&status=ACTIVE&salespersonId=u2&unitId=un1&enquiryId=e1&from=2026-01-01&to=2026-02-01&sort=bookingNo&page=2', manager);
    await screen.findByText('BK-000001');
    const req = calls.find((c) => c.key === 'GET /bookings');
    for (const part of ['search=raj', 'status=ACTIVE', 'salespersonId=u2', 'unitId=un1', 'enquiryId=e1', 'from=2026-01-01', 'to=2026-02-01', 'sort=bookingNo', 'page=2']) expect(req.path).toContain(part);
    expect(screen.queryByLabelText('Branch')).toBeNull();
    unmount();
    app('/bookings', multi);
    await screen.findByText('BK-000001');
    expect(screen.getByLabelText('Branch')).toBeTruthy();
  });

  it('Release is offered only where the server allows it, and asks for a reason', async () => {
    const calls = mockApi({ 'POST /bookings/b1/release': ok({ ...B1, status: 'RELEASED' }) });
    app('/bookings', manager);
    await screen.findByText('BK-000001');
    const menus = screen.getAllByRole('button', { name: 'Actions' });
    fireEvent.click(menus[1]);
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open']); // the released one
    fireEvent.click(menus[1]);
    fireEvent.click(menus[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Release…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Release booking' }));
    expect(await within(dialog).findByText('Give a reason')).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Customer withdrew' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Release booking' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'POST /bookings/b1/release', body: { reason: 'Customer withdrew' } });
  });

  it('empty and error states are explicit', async () => {
    mockApi({ 'GET /bookings': ok([], { page: 1, limit: 25, total: 0 }) });
    const { unmount } = app('/bookings', manager);
    expect(await screen.findByText('No bookings yet')).toBeTruthy();
    unmount();
    mockApi({ 'GET /bookings': fail(500, 'INTERNAL_ERROR', 'boom') });
    app('/bookings', manager);
    expect((await screen.findAllByText(/boom|Could not load/)).length).toBeGreaterThan(0);
  });
});

describe('booking a unit', () => {
  async function openFromUnit(routes = {}, s = manager) {
    const calls = mockApi({ 'POST /bookings': ok(B1), ...routes });
    app('/units/un1', s);
    fireEvent.click(await screen.findByRole('button', { name: 'Book unit' }));
    return { calls, dialog: await screen.findByRole('dialog') };
  }

  it('from a unit: the unit is fixed, the enquiry is picked by server search, the date is required and not in the future', async () => {
    const { calls, dialog } = await openFromUnit();
    expect(within(dialog).getByText(/UNT-000001 · Lake View Villa/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Booking date/), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Book unit' }));
    expect(await within(dialog).findByText('Choose the booking date')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Booking date/), { target: { value: '2999-01-01T10:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Book unit' }));
    expect(await within(dialog).findByText('Choose a time that has passed')).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Booking date/), { target: { value: localAgo(30) } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Book unit' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/Choose the enquiry/); // no enquiry chosen
    expect(writes(calls)).toHaveLength(0);
    fireEvent.change(within(dialog).getByPlaceholderText(/Search enquiry/), { target: { value: 'raj' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /ENQ-000001 Raj Kumar/ }));
    fireEvent.change(within(dialog).getByLabelText('Notes'), { target: { value: 'Token paid' } });
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Vikram' })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText('Salesperson'), { target: { value: 'u2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Book unit' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    const w = writes(calls)[0];
    expect(w).toMatchObject({ key: 'POST /bookings', body: { unitId: 'un1', enquiryId: 'e1', salespersonId: 'u2', notes: 'Token paid' } });
    expect(new Date(w.body.bookingDate).getTime()).toBeLessThan(Date.now()); // an unambiguous instant
    expect(w.body.bookingDate).toMatch(/Z$/);
    expect(Object.keys(w.body)).not.toContain('status');
  });

  it('from an enquiry: the enquiry is fixed and only AVAILABLE units are offered (searched on the server for its branch)', async () => {
    const calls = mockApi({ 'GET /bookings': ok([], { page: 1, limit: 20, total: 0 }), 'POST /bookings': ok(B1) });
    renderWithApp(wrap(<Routes><Route path="*" element={<BookingsSection enquiry={{ id: 'e1', enquiryNo: 'ENQ-000001', name: 'Raj Kumar', branchId: 'b1' }} />} /></Routes>), { session: manager, route: '/x' });
    fireEvent.click(await screen.findByRole('button', { name: 'Book a unit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/ENQ-000001 · Raj Kumar/)).toBeTruthy();
    fireEvent.click(await within(dialog).findByRole('button', { name: /UNT-000001 Lake View Villa/ }));
    const unitsReq = calls.find((c) => c.key === 'GET /units');
    expect(unitsReq.path).toContain('branchId=b1');
    expect(unitsReq.path).toContain('statusId=sa'); // the AVAILABLE status, resolved from the master
    fireEvent.click(within(dialog).getByRole('button', { name: 'Book unit' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0].body).toMatchObject({ unitId: 'un1', enquiryId: 'e1' });
  });

  it('a conflict (someone booked it first) is shown clearly, nothing is marked booked, and the unit is refreshed', async () => {
    const calls = mockApi({ 'POST /bookings': fail(409, 'BOOKING_CONFLICT', 'This unit was just booked by someone else, so your booking was not made. A manager has been told.', { conflictId: 'c9', unitCode: 'UNT-000001' }) });
    app('/units/un1', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Book unit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText(/Search enquiry/), { target: { value: 'raj' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /ENQ-000001 Raj Kumar/ }));
    const before = calls.filter((c) => c.key === 'GET /units/un1').length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Book unit' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/just booked by someone else/);
    await waitFor(() => expect(calls.filter((c) => c.key === 'GET /units/un1').length).toBeGreaterThan(before)); // stale state refreshed
    expect(screen.queryByText(/Booking BK-/)).toBeNull(); // no success claimed
    expect(screen.queryByText('Booked', { selector: '.pill' })).toBeNull(); // not optimistically marked booked
    expect(within(dialog).getByRole('button', { name: 'Book unit' })).toBeTruthy(); // the dialog stays so the user can read it
  });

  it('after a refused booking, the refreshed unit shows its real (booked) state with no Book button', async () => {
    let booked = false;
    mockApi({
      'GET /units/un1': () => ok(booked ? UNIT_BOOKED : UNIT),
      'POST /bookings': () => { booked = true; return fail(409, 'BOOKING_CONFLICT', 'This unit was just booked by someone else.'); },
    });
    app('/units/un1', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Book unit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText(/Search enquiry/), { target: { value: 'raj' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /ENQ-000001 Raj Kumar/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Book unit' }));
    await within(dialog).findByRole('alert');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('link', { name: 'BK-000001' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Book unit' })).toBeNull();
  });

  it('the workflow refusal is shown as the server words it', async () => {
    const { dialog } = await openFromUnit({ 'POST /bookings': fail(409, 'STAGE_SKIP', 'Cannot move from "Interested" to "Booked": stages cannot be skipped (next is "Site Visit Scheduled")') });
    fireEvent.change(within(dialog).getByPlaceholderText(/Search enquiry/), { target: { value: 'raj' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /ENQ-000001 Raj Kumar/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Book unit' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/stages cannot be skipped/);
  });

  it('dropping an enquiry onto the guarded Booked stage opens the booking dialog instead of moving the card', async () => {
    mockApi();
    function Harness() {
      const mover = useStageMover();
      return (
        <>
          <button type="button" onClick={() => mover.requestMove({ id: 'e1', enquiryNo: 'ENQ-000001', name: 'Raj Kumar', branchId: 'b1', stageCode: 'NEGOTIATION' }, { to: 'BOOKED', label: 'Booked', domainOperation: 'booking.create' })}>drop</button>
          {mover.dialog}
        </>
      );
    }
    renderWithApp(wrap(<Harness />), { session: manager });
    fireEvent.click(screen.getByText('drop'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Book a unit')).toBeTruthy();
    expect(within(dialog).getByText(/ENQ-000001 · Raj Kumar/)).toBeTruthy();
  });
});

describe('unit detail booking card', () => {
  it('not booked: offers Book (server flag) and shows no release', async () => {
    mockApi();
    app('/units/un1', manager);
    expect(await screen.findByText('Not booked')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Book unit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Release…' })).toBeNull();
  });

  it('booked: shows the active booking and history, offers Release but not Book', async () => {
    const calls = mockApi({ 'GET /units/un1': ok(UNIT_BOOKED), 'POST /bookings/b1/release': ok({ ...B1, status: 'RELEASED' }) });
    app('/units/un1', manager);
    const link = await screen.findByRole('link', { name: 'BK-000001' });
    expect(link.getAttribute('href')).toBe('/bookings/b1');
    expect(screen.getByText(/Raj Kumar/)).toBeTruthy();
    const past = within(screen.getByLabelText('Past bookings'));
    expect(past.getByText(/Customer withdrew/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Book unit' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Release…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Customer withdrew' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Release booking' }));
    await waitFor(() => expect(writes(calls)[0]?.key).toBe('POST /bookings/b1/release'));
  });

  it('a user without booking visibility sees only that booking details are restricted, and no buttons', async () => {
    mockApi({ 'GET /units/un1': ok({ ...UNIT_BOOKED, booking: { visible: false, history: [], allowed: { book: false, release: false } } }) });
    app('/units/un1', executive);
    expect(await screen.findByText('Booking details are restricted')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Book unit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Release…' })).toBeNull();
  });

  it('a release refused because someone already released it shows the server message', async () => {
    mockApi({ 'GET /units/un1': ok(UNIT_BOOKED), 'POST /bookings/b1/release': fail(409, 'ALREADY_RELEASED', 'This booking has already been released') });
    app('/units/un1', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Release…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'because' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Release booking' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/already been released/);
  });
});

describe('booking detail', () => {
  it('shows the booking, its history, timeline and audit; actions follow the allowed flags', async () => {
    mockApi();
    app('/bookings/b1', manager);
    expect(await screen.findByRole('heading', { name: 'Raj Kumar' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'UNT-000001' }).getAttribute('href')).toBe('/units/un1');
    expect(screen.getByRole('link', { name: 'ENQ-000001' }).getAttribute('href')).toBe('/enquiries/e1');
    expect(within(screen.getByLabelText('Booking history')).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Release…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(await screen.findByText('Unit UNT-000001 booked for Raj Kumar (BK-000001)')).toBeTruthy();
    expect(await screen.findByText('create')).toBeTruthy();
  });

  it('a released booking is history: reason and who released it are shown, no actions', async () => {
    mockApi({ 'GET /bookings/b1': ok(RELEASED_DETAIL) });
    app('/bookings/b1', manager);
    expect(await screen.findByText('Customer withdrew', { selector: 'dd' })).toBeTruthy();
    expect(within(screen.getByLabelText('Booking history')).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Release…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('editing sends only what changed', async () => {
    const calls = mockApi({ 'PATCH /bookings/b1': ok(DETAIL) });
    app('/bookings/b1', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes(calls)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const d2 = await screen.findByRole('dialog');
    fireEvent.change(within(d2).getByLabelText('Notes'), { target: { value: '' } });
    fireEvent.click(within(d2).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'PATCH /bookings/b1', body: { notes: null } });
  });

  it('a missing or foreign booking shows not found; a viewer without edit rights gets no actions or telemetry', async () => {
    mockApi({ 'GET /bookings/b1': fail(404, 'NOT_FOUND', 'Booking not found') });
    const { unmount } = app('/bookings/b1', manager);
    expect((await screen.findAllByText(/not found|Could not load/i)).length).toBeGreaterThan(0);
    unmount();
    const calls = mockApi({ 'GET /bookings/b1': ok({ ...DETAIL, allowed: NONE }) });
    app('/bookings/b1', executive);
    await screen.findByRole('heading', { name: 'Raj Kumar' });
    expect(screen.queryByRole('button', { name: 'Release…' })).toBeNull();
    expect(calls.some((c) => c.key === 'GET /activities' || c.key === 'GET /audit')).toBe(false);
  });
});

describe('conflict queue', () => {
  it('lists open conflicts with who tried, for whom and what held the unit; open by default', async () => {
    const calls = mockApi();
    app('/bookings/conflicts', manager);
    expect(await screen.findByText('Esha Rao')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'BK-000001' }).getAttribute('href')).toBe('/bookings/b1');
    expect(screen.getByText('Vikram')).toBeTruthy();
    expect(screen.getByText('Open', { selector: '.pill' })).toBeTruthy();
    expect(calls.find((c) => c.key === 'GET /booking-conflicts').path).toContain('status=OPEN');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'RESOLVED' } });
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /booking-conflicts' && c.path.includes('status=RESOLVED'))).toBe(true));
  });

  it('keeping the existing booking is the default decision', async () => {
    const calls = mockApi({ 'POST /booking-conflicts/c1/resolve': ok({ ...CONFLICT, status: 'RESOLVED' }) });
    app('/bookings/conflicts', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'POST /booking-conflicts/c1/resolve', body: { resolution: 'KEEP_EXISTING' } });
  });

  it('replacing needs a reason and sends it with the decision', async () => {
    const calls = mockApi({ 'POST /booking-conflicts/c1/resolve': ok({ ...CONFLICT, status: 'RESOLVED' }) });
    app('/bookings/conflicts', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: /Replace it with this booking/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve' }));
    expect(await within(dialog).findByText('Give a reason for replacing the booking')).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Second customer paid first' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0].body).toEqual({ resolution: 'REPLACE', reason: 'Second customer paid first' });
  });

  it("shows the server's refusal and hides Resolve from users who may not", async () => {
    mockApi({ 'POST /booking-conflicts/c1/resolve': fail(409, 'CONFLICT_RESOLVED', 'This conflict has already been resolved') });
    const { unmount } = app('/bookings/conflicts', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/already been resolved/);
    unmount();
    mockApi({ 'GET /booking-conflicts': ok([{ ...CONFLICT, allowed: { resolve: false } }], { page: 1, limit: 25, total: 1 }) });
    app('/bookings/conflicts', executive);
    await screen.findByText('Esha Rao');
    expect(screen.queryByRole('button', { name: 'Resolve…' })).toBeNull();
  });

  it('empty state', async () => {
    mockApi({ 'GET /booking-conflicts': ok([], { page: 1, limit: 25, total: 0 }) });
    app('/bookings/conflicts', manager);
    expect(await screen.findByText('No open conflicts')).toBeTruthy();
  });
});

describe('navigation', () => {
  it('Bookings is a real page for bookings.view holders, and refused by URL otherwise', async () => {
    mockApi();
    const { unmount } = renderWithApp(wrap(<AppRoutes />), { session: manager, route: '/bookings' });
    expect((await screen.findAllByRole('heading', { name: 'Bookings' })).length).toBeGreaterThan(0);
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    unmount();
    renderWithApp(wrap(<AppRoutes />), { session: session(['dashboard.view']), route: '/bookings' });
    expect(await screen.findByText(/don't have access/i)).toBeTruthy();
  });
});
