import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp, session } from '../../test/render';
import { UnitBookingCard } from '../bookings/UnitBookingCard';
import { ClientsRoutes } from '../clients/ClientsRoutes';
import { EnquiriesRoutes } from '../enquiries/EnquiriesRoutes';
import { UnitInterestedEnquiries } from './UnitInterestsCard';
import { UnitsCell } from './UnitsCell';

const ok = (data, meta) => ({ ok: true, status: 200, json: async () => ({ data, ...(meta ? { meta } : {}) }) });
const fail = (status, code, message) => ({ ok: false, status, json: async () => ({ error: { code, message } }) });
const WHEN = '2026-03-10T09:00:00Z';

const CLIENT = { id: 'c1', clientNo: 'CL-000001', name: 'Meena Iyer', phone: '+91 98765 43210', phoneE164: '+919876543210', personId: 'p1', branchId: 'b1', branch: { name: 'Chennai' }, isArchived: false, createdAt: WHEN, relationships: [], person: { name: 'Meena Iyer', phone: '+91 98765 43210' } };
const ENQ_ROW = { id: 'e1', enquiryNo: 'ENQ-000021', stage: { label: 'Converted', systemKey: 'CONVERTED', kind: 'FLOW' }, name: 'Meena Iyer', branchId: 'b1', isArchived: false };
const row = (state, unitId, unitCode, extra = {}) => ({ unitId, unitCode, state, unit: { id: unitId, name: `Unit ${unitCode}`, statusKey: 'AVAILABLE' }, enquiries: [{ id: 'e1', enquiryNo: 'ENQ-000021' }], bookings: [], visits: [], ...extra });
const RELATED = {
  clientId: 'c1',
  enquiries: { rows: [ENQ_ROW] },
  followUps: { rows: [{ id: 'f1', type: { label: 'Call' }, scheduledAt: WHEN, statusKey: 'MISSED', status: { label: 'Missed' }, assignedToName: 'Asha', enquiryId: 'e1', enquiryNo: 'ENQ-000021', notes: 'Send the agreement' }] },
  siteVisits: { rows: [{ id: 'v1', visitNo: 'SV-000003', scheduledAt: WHEN, statusKey: 'COMPLETED', status: { label: 'Completed' }, assignedToName: 'Asha', units: [{ unitCode: 'UNT-000009' }], enquiryId: 'e1', enquiryNo: 'ENQ-000021', allowed: {} }] },
  bookings: { rows: [] },
  units: { rows: [
    row('SOLD', 'u3', 'UNT-000003', { unit: { id: 'u3', name: 'Lakeview Villa A3', statusKey: 'SOLD' }, purchaser: { name: 'Meena Iyer', clientId: 'c1', clientNo: 'CL-000001', enquiryId: 'e1', enquiryNo: 'ENQ-000021', bookingId: 'b3', bookingNo: 'BK-000003' }, bookings: [{ id: 'b3', bookingNo: 'BK-000003', status: 'ACTIVE', bookingDate: WHEN, enquiryId: 'e1', enquiryNo: 'ENQ-000021' }] }),
    row('BOOKED', 'u10', 'UNT-000010', { unit: { id: 'u10', name: 'Hillcrest Villa 2', statusKey: 'BOOKED' }, bookings: [{ id: 'b6', bookingNo: 'BK-000006', status: 'ACTIVE', bookingDate: WHEN, enquiryId: 'e1', enquiryNo: 'ENQ-000021' }, { id: 'b5', bookingNo: 'BK-000005', status: 'RELEASED', bookingDate: WHEN, enquiryId: 'e1', enquiryNo: 'ENQ-000021', releasedAt: WHEN, releaseReason: 'Changed mind' }] }),
    row('SITE_VISIT_COMPLETED', 'u9', 'UNT-000009', { interest: { id: 'i9', status: 'INTERESTED', enquiryId: 'e1', enquiryNo: 'ENQ-000021' }, visits: [{ id: 'v1', visitNo: 'SV-000003', statusKey: 'COMPLETED', scheduledAt: WHEN, enquiryId: 'e1' }] }),
    row('NOT_INTERESTED', 'u11', 'UNT-000011', { interest: { id: 'i11', status: 'NOT_INTERESTED', enquiryId: 'e1', enquiryNo: 'ENQ-000021' } }),
  ] },
};
const UNIT_ROWS = [{ id: 'u9', unitCode: 'UNT-000009', name: 'Marina 9A', statusKey: 'AVAILABLE', city: 'Chennai', expectedPrice: 10400000 }, { id: 'u7', unitCode: 'UNT-000007', name: 'Plot 14', statusKey: 'AVAILABLE', city: 'Chennai', expectedPrice: 5200000 }];

function mockApi(routes = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace('/api/v1', '');
    const key = `${method} ${path.split('?')[0]}`;
    calls.push({ method, key, path, body: init.body ? JSON.parse(init.body) : undefined });
    if (routes[key]) return typeof routes[key] === 'function' ? routes[key](path) : routes[key];
    if (key === 'GET /clients/c1') return ok(CLIENT);
    if (key === 'GET /clients/c1/related') return ok(RELATED);
    if (key === 'GET /units') return ok(UNIT_ROWS, { page: 1, limit: 8, total: 2 });
    if (key === 'GET /enquiries/e1/eligible-units') return ok(UNIT_ROWS, { page: 1, limit: 6, total: 2 });
    if (key === 'GET /masters') return ok({ CLIENT_CATEGORY: [], ACTIVITY_TYPE: [], UNIT_STATUS: [] });
    if (key === 'GET /branches') return ok([], { page: 1, limit: 100, total: 0 });
    if (key === 'GET /workflow/stages') return ok([]);
    throw new Error(`unmocked ${key}`);
  }));
  return calls;
}
const wrap = (ui) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const clientApp = (s) => renderWithApp(wrap(<Routes><Route path="/clients/*" element={<ClientsRoutes />} /></Routes>), { session: s, route: '/clients/c1' });
const PERMS = ['clients.view', 'enquiries.view', 'enquiries.edit', 'followups.view', 'sitevisits.view', 'bookings.view', 'units.view'];
const manager = session(PERMS, { dataScope: 'BRANCH', branchIds: ['b1'] });
afterEach(() => vi.unstubAllGlobals());

describe('Client details show every connected record', () => {
  it('lists enquiries, follow-ups and site visits with links, statuses and the originating enquiry', async () => {
    mockApi();
    clientApp(manager);
    await screen.findByText(/Send the agreement/);
    const followUps = screen.getAllByLabelText('Follow-ups')[0];
    expect(within(followUps).getByRole('link', { name: 'ENQ-000021' }).getAttribute('href')).toBe('/enquiries/e1'); // raised on the enquiry, shown on the client
    expect(within(followUps).getByText('Missed')).toBeTruthy();
    const visits = screen.getAllByLabelText('Site visits')[0];
    expect(within(visits).getByRole('link', { name: 'SV-000003' }).getAttribute('href')).toBe('/site-visits/v1');
    expect(within(screen.getAllByLabelText('Enquiries')[0]).getByRole('link', { name: 'ENQ-000021' }).getAttribute('href')).toBe('/enquiries/e1');
    expect(screen.queryByLabelText('Bookings')).toBeNull(); // bookings now live inside their unit's entry
  });

  it('shows ONE Units section with one entry per unit: relationship badge, inventory status and booking history kept apart', async () => {
    mockApi();
    clientApp(manager);
    await screen.findByText('Sold');
    const units = screen.getAllByLabelText('Units')[0];
    const entry = (code) => within(units).getByRole('link', { name: code }).closest('.visit-row');
    expect(within(entry('UNT-000003')).getByText('Sold')).toBeTruthy();
    expect(within(entry('UNT-000003')).getByText(/Purchaser:/).textContent).toMatch(/Meena Iyer \(CL-000001\).*ENQ-000021.*BK-000003/);
    expect(within(entry('UNT-000010')).getByText('Booked', { selector: '.pill' })).toBeTruthy();
    const history = within(entry('UNT-000010')).getByLabelText('Bookings of UNT-000010');
    expect(within(history).getAllByRole('listitem')).toHaveLength(2); // the active booking and the released one stay visible
    expect(within(history).getByText(/Changed mind/)).toBeTruthy();
    expect(within(entry('UNT-000009')).getByText('Site visit completed')).toBeTruthy();
    expect(within(entry('UNT-000009')).queryByText(/Booked|Sold/)).toBeNull(); // interest and a visit never read as booked or sold
    expect(within(entry('UNT-000011')).getByText('Not interested')).toBeTruthy();
    expect(within(units).getAllByRole('link', { name: /UNT-0000(03|10|09|11)/ })).toHaveLength(4); // each unit exactly once
  });

  it('says units are restricted (not empty) when the server withheld them', async () => {
    mockApi({ 'GET /clients/c1/related': ok({ ...RELATED, units: null }) });
    clientApp(manager);
    await screen.findByText(/permission to view units/);
    expect(screen.queryByText('No units yet')).toBeNull();
  });

  it('shows genuinely empty sections only when the server returned nothing', async () => {
    mockApi({ 'GET /clients/c1/related': ok({ clientId: 'c1', enquiries: { rows: [] }, followUps: { rows: [] }, siteVisits: { rows: [] }, bookings: { rows: [] }, units: { rows: [] } }) });
    clientApp(manager);
    for (const t of ['No enquiries', 'No follow-ups', 'No site visits', 'No units yet']) expect(await screen.findByText(t)).toBeTruthy();
  });

  it('Add unit: pick a unit, choose the relationship, add notes; it is recorded for the chosen enquiry without touching bookings or unit status', async () => {
    const calls = mockApi({ 'POST /enquiries/e1/unit-interests': ok({ id: 'i1', status: 'INTERESTED', unitId: 'u7', unitCode: 'UNT-000007' }) });
    clientApp(manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Add unit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add unit' });
    expect(within(dialog).getByText(/does not reserve or book/i)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Add unit' }).disabled).toBe(true); // no unit chosen yet
    const list = await within(dialog).findByRole('list', { name: 'Units' });
    expect(within(list).getAllByRole('button', { name: 'Already added' })).toHaveLength(1); // UNT-000009 already has an interest
    fireEvent.click(within(list).getByRole('button', { name: 'Select' }));
    const status = within(dialog).getByLabelText('Relationship');
    const options = [...status.options].map((o) => [o.value, o.disabled]);
    expect(options).toEqual([['INTERESTED', false], ['NOT_INTERESTED', false], ['SITE_VISIT', true], ['HOLD', true], ['BOOKED', true], ['SOLD', true]]); // Hold and the derived states cannot be set by hand
    fireEvent.change(status, { target: { value: 'NOT_INTERESTED' } });
    fireEvent.change(within(dialog).getByLabelText('Notes'), { target: { value: 'Too small' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add unit' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.filter((c) => c.key === 'POST /enquiries/e1/unit-interests')).toEqual([expect.objectContaining({ body: { unitId: 'u7', status: 'NOT_INTERESTED', note: 'Too small' } })]);
    expect(calls.some((c) => c.key.startsWith('PATCH') || c.key.includes('/bookings'))).toBe(false);
  });

  it('shows the server\'s refusal (duplicate) inside the form and keeps it open', async () => {
    mockApi({ 'POST /enquiries/e1/unit-interests': fail(409, 'INTEREST_EXISTS', 'UNT-000007 is already an interested unit of ENQ-000021') });
    clientApp(manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Add unit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Select' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add unit' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/already an interested unit/);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('offers Add unit only with enquiries.edit and units.view', async () => {
    mockApi();
    clientApp(session(['clients.view', 'enquiries.view', 'units.view'], { dataScope: 'BRANCH', branchIds: ['b1'] }));
    await screen.findByText('Sold');
    expect(screen.queryByRole('button', { name: 'Add unit' })).toBeNull();
  });

  it('row actions change only the relationship (Mark not interested / interested) and never offer them for booked or sold units', async () => {
    const calls = mockApi({ 'POST /enquiries/e1/unit-interests': ok({ id: 'i9', status: 'WITHDRAWN' }) });
    clientApp(manager);
    await screen.findByText('Sold');
    const units = screen.getAllByLabelText('Units')[0];
    const menu = (code) => within(units.querySelector(`a[href="/units/${code}"]`).closest('.visit-row')).queryByRole('button', { name: 'Actions' });
    expect(menu('u3')).toBeNull(); // sold: nothing to change by hand
    expect(menu('u10')).toBeNull(); // booked
    fireEvent.click(menu('u9'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark not interested' }));
    await waitFor(() => expect(calls.filter((c) => c.key === 'POST /enquiries/e1/unit-interests')).toHaveLength(1));
    expect(calls.find((c) => c.key === 'POST /enquiries/e1/unit-interests').body).toEqual({ unitId: 'u9', status: 'NOT_INTERESTED' });
    fireEvent.click(menu('u11'));
    expect(screen.getByRole('menuitem', { name: 'Mark interested' })).toBeTruthy();
  });
});

describe('Enquiry details show the same unified Units section', () => {
  const ENQ = {
    id: 'e1', enquiryNo: 'ENQ-000021', name: 'Meena Iyer', phone: '+91 98765 43210', phoneE164: '+919876543210', personId: 'p1', branchId: 'b1', branch: { name: 'Chennai' }, stageCode: 'NEGOTIATION', stage: { systemKey: 'NEGOTIATION', label: 'Negotiation', kind: 'FLOW' },
    stageChangedAt: WHEN, isArchived: false, createdAt: WHEN, transitions: [], assignments: [], stageHistory: [], person: { name: 'Meena Iyer' },
    units: [
      row('INTERESTED', 'u9', 'UNT-000009', { interest: { id: 'i2', status: 'INTERESTED', enquiryId: 'e1', enquiryNo: 'ENQ-000021' } }),
      row('BOOKED', 'u10', 'UNT-000010', { unit: { id: 'u10', name: 'Hillcrest Villa 2', statusKey: 'BOOKED' }, bookings: [{ id: 'b6', bookingNo: 'BK-000006', status: 'ACTIVE', bookingDate: WHEN, enquiryId: 'e1', enquiryNo: 'ENQ-000021' }] }),
    ],
  };
  const enquiryApp = (s) => renderWithApp(wrap(<Routes><Route path="/enquiries/*" element={<EnquiriesRoutes />} /></Routes>), { session: s, route: '/enquiries/e1' });
  const editor = session(['enquiries.view', 'enquiries.edit', 'units.view', 'bookings.create'], { dataScope: 'BRANCH', branchIds: ['b1'] });

  it('lists each unit once with its relationship and keeps the booking inside it (no separate bookings card)', async () => {
    mockApi({ 'GET /enquiries/e1': ok(ENQ) });
    enquiryApp(editor);
    const card = (await screen.findAllByLabelText('Units'))[0];
    expect(within(card).getByRole('link', { name: 'UNT-000010' }).getAttribute('href')).toBe('/units/u10');
    expect(within(card).getByText('Interested', { selector: '.pill' })).toBeTruthy();
    expect(within(card).getByText('Booked', { selector: '.pill' })).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'BK-000006' }).getAttribute('href')).toBe('/bookings/b6');
    expect(screen.queryByRole('heading', { name: 'Bookings' })).toBeNull();
  });

  it('marks a unit not interested from its row menu, and offers Book unit only for an available, unbooked unit', async () => {
    const calls = mockApi({ 'GET /enquiries/e1': ok(ENQ), 'POST /enquiries/e1/unit-interests': ok({ id: 'i2', status: 'WITHDRAWN' }) });
    enquiryApp(editor);
    const card = (await screen.findAllByLabelText('Units'))[0];
    const interested = within(card).getByRole('link', { name: 'UNT-000009' }).closest('.visit-row');
    fireEvent.click(within(interested).getByRole('button', { name: 'Actions' }));
    expect(screen.getByRole('menuitem', { name: 'Book unit…' })).toBeTruthy(); // the unit is Available
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark not interested' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST').map((c) => c.key)).toEqual(['POST /enquiries/e1/unit-interests']));
    expect(within(within(card).getByRole('link', { name: 'UNT-000010' }).closest('.visit-row')).queryByRole('button', { name: 'Actions' })).toBeNull(); // booked: no actions
  });
});

describe('Unit details name the purchaser and the interested enquiries', () => {
  const inRouter = (ui) => render(<MemoryRouter>{wrap(ui)}</MemoryRouter>);
  const ACTIVE = { id: 'b3', bookingNo: 'BK-000003', clientId: 'c1', clientNo: 'CL-000001', name: 'Meena Iyer', enquiryId: 'e1', enquiryNo: 'ENQ-000021', bookingDate: WHEN, salespersonName: 'Asha', isActive: true, status: 'ACTIVE' };

  it('a sold unit shows its purchaser (client, source enquiry); a booked one shows who holds it', () => {
    inRouter(<UnitBookingCard unit={{ id: 'u3', unitCode: 'UNT-000003', name: 'A3', branchId: 'b1', statusKey: 'SOLD', booking: { visible: true, active: ACTIVE, history: [], allowed: {} }, sale: { state: 'LINKED', booking: ACTIVE } }} />);
    expect(screen.getByText('Purchaser')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Meena Iyer' }).getAttribute('href')).toBe('/clients/c1');
    expect(screen.getByText('CL-000001')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ENQ-000021' }).getAttribute('href')).toBe('/enquiries/e1');
  });

  it('flags a sold unit with no booking instead of inventing a purchaser, and keeps released bookings as history', () => {
    inRouter(<UnitBookingCard unit={{ id: 'u6', unitCode: 'UNT-000006', name: 'x', branchId: 'b1', statusKey: 'SOLD', booking: { visible: true, active: undefined, history: [{ ...ACTIVE, id: 'b1', bookingNo: 'BK-000001', isActive: false, releaseReason: 'Withdrew' }], allowed: {} }, sale: { state: 'UNLINKED' } }} />);
    expect(screen.getByRole('note').textContent).toMatch(/no active booking links a purchaser/);
    expect(screen.queryByText('Purchaser')).toBeNull(); // history is never the purchaser
    expect(screen.getByLabelText('Past bookings')).toBeTruthy();
  });

  it('lists the enquiries considering the unit, apart from its booking', () => {
    inRouter(<UnitInterestedEnquiries unit={{ interests: { visible: true, rows: [{ id: 'i1', status: 'INTERESTED', progress: 'SITE_VISIT_SCHEDULED', enquiryId: 'e1', enquiryNo: 'ENQ-000021', enquiry: { name: 'Meena Iyer' } }] } }} />);
    expect(screen.getByRole('link', { name: 'ENQ-000021' }).getAttribute('href')).toBe('/enquiries/e1');
    expect(screen.getByText('Site visit planned')).toBeTruthy();
  });

  it('renders nothing for someone who may not see enquiries', () => {
    const { container } = inRouter(<UnitInterestedEnquiries unit={{ interests: { visible: false, rows: [] } }} />);
    expect(container.textContent).toBe('');
  });
});

describe('the Units column in the Enquiries and Clients tables', () => {
  const inRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);
  const U = (id, code, state) => ({ unitId: id, unitCode: code, name: `Name ${code}`, state });

  it('shows each unit once as a link with its relationship badge, and summarises the rest', () => {
    inRouter(<UnitsCell units={[U('u1', 'UNT-000001', 'BOOKED'), U('u2', 'UNT-000002', 'INTERESTED'), U('u3', 'UNT-000003', 'SITE_VISIT_SCHEDULED'), U('u4', 'UNT-000004', 'NOT_INTERESTED'), U('u5', 'UNT-000005', 'SOLD')]} />);
    expect(screen.getAllByRole('link')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'UNT-000001' }).getAttribute('href')).toBe('/units/u1');
    expect(screen.getByText('Booked')).toBeTruthy();
    expect(screen.getByText('Site visit planned')).toBeTruthy();
    expect(screen.getByText('+2 more').getAttribute('title')).toBe('UNT-000004, UNT-000005');
  });

  it('shows a dash when there are no units', () => {
    inRouter(<UnitsCell units={[]} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('the Clients table has the Units column only when the server sent units', async () => {
    const CLIENT_ROW = { id: 'c1', clientNo: 'CL-000001', name: 'Meena Iyer', phone: '+91 98765 43210', phoneE164: '+919876543210', branchId: 'b1', branch: { name: 'Chennai' }, createdAt: WHEN };
    mockApi({ 'GET /clients': ok([{ ...CLIENT_ROW, units: [U('u9', 'UNT-000009', 'SOLD')] }], { page: 1, limit: 25, total: 1 }) });
    renderWithApp(wrap(<Routes><Route path="/clients/*" element={<ClientsRoutes />} /></Routes>), { session: manager, route: '/clients' });
    expect(await screen.findByRole('columnheader', { name: 'Units' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'UNT-000009' }).getAttribute('href')).toBe('/units/u9');
    expect(screen.getByText('Sold')).toBeTruthy();
    vi.unstubAllGlobals();
    mockApi({ 'GET /clients': ok([CLIENT_ROW], { page: 1, limit: 25, total: 1 }) });
    renderWithApp(wrap(<Routes><Route path="/clients/*" element={<ClientsRoutes />} /></Routes>), { session: manager, route: '/clients' });
    await waitFor(() => expect(screen.getAllByText('Meena Iyer').length).toBeGreaterThan(0));
    expect(screen.getAllByRole('columnheader', { name: 'Units' })).toHaveLength(1); // only the first render's table
  });
});

