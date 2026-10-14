import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp, session } from '../../test/render';
import { DashboardPage } from './DashboardPage';
import { deltaText } from './delta';

const ok = (data, meta) => ({ ok: true, status: 200, json: async () => ({ data, ...(meta ? { meta } : {}) }) });
const fail = (status, code, message) => ({ ok: false, status, json: async () => ({ error: { code, message } }) });
const AT = new Date('2026-03-10T09:00:00Z').toISOString();

const RANGE = { from: '2026-03-04', to: '2026-03-10', days: 7, previousFrom: '2026-02-25', previousTo: '2026-03-03', timeZone: 'Asia/Kolkata' };
const ALL_ALLOWED = { enquiries: true, followUps: true, siteVisits: true, units: true, bookings: true, clients: true, referrals: true, activities: true };
const SUMMARY = {
  range: RANGE,
  allowed: ALL_ALLOWED,
  enquiries: { new: { value: 12, previous: 9 }, active: 30, converted: { value: 0, previous: 0, current: 0 } },
  followUps: { today: 4, missed: 2, upcoming: 6, open: 12, completed: { value: 5, previous: 3 } },
  siteVisits: { today: 1, upcoming: 3, overdue: 0, completed: { value: 2, previous: 1 } },
  units: { total: 10, available: 6, booked: 3, sold: 1, byStatus: [{ statusId: 's-av', statusKey: 'AVAILABLE', count: 6 }, { statusId: 's-bk', statusKey: 'BOOKED', count: 3 }, { statusId: 's-sd', statusKey: 'SOLD', count: 1 }] },
  bookings: { active: 3, made: { value: 4, previous: 2 }, released: { value: 1, previous: 0 } },
  clients: { new: { value: 2, previous: 2 } },
  referrals: { total: 8, new: { value: 3, previous: 1 } },
  activities: [{ id: 'a1', type: 'BOOKING_CREATED', description: 'Unit UNT-000001 booked for Raj Kumar', at: AT, byName: 'Asha', refs: [{ type: 'booking', id: 'b1' }] }],
  definitions: { newEnquiries: 'Enquiries created in the selected days.', activeEnquiries: 'Enquiries in any stage before converted.', activeBookings: 'Active bookings only; released ones are never counted.' },
};
const FUNNEL = {
  range: RANGE,
  stages: [{ systemKey: 'NEW', label: 'New', kind: 'FLOW', order: 1, isActive: true, current: 5, entered: 12 }, { systemKey: 'BOOKED', label: 'Booked', kind: 'FLOW', order: 2, isActive: true, current: 3, entered: 4 }],
  totals: { current: 8 },
  definitions: { current: 'How many enquiries are in each stage right now.', entered: 'How many entered each stage in the period; these are counts, not the share of enquiries that moved on.' },
};
const SOURCES = { range: RANGE, rows: [{ sourceId: 'so1', source: { label: 'Website' }, created: 7, bookedOrBeyond: 2 }], definition: 'Enquiries created in the period by source.' };
const PERFORMANCE = { range: RANGE, columns: { newEnquiries: true, bookingsMade: true, visitsCompleted: false, missedFollowUps: true }, rows: [{ userId: 'u1', name: 'Asha', newEnquiries: 6, bookingsMade: 2, visitsCompleted: 0, missedFollowUps: 1 }], definition: 'Per employee.' };

function mockApi(routes = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = url.replace('/api/v1', '');
    const key = path.split('?')[0];
    calls.push(path);
    if (routes[key]) return typeof routes[key] === 'function' ? routes[key](path) : routes[key];
    if (key === '/dashboard/summary') return ok(SUMMARY);
    if (key === '/dashboard/funnel') return ok(FUNNEL);
    if (key === '/dashboard/sources') return ok(SOURCES);
    if (key === '/dashboard/performance') return ok(PERFORMANCE);
    if (key === '/branches') return ok([{ _id: 'b1', name: 'Chennai', isActive: true }, { _id: 'b2', name: 'Madurai', isActive: true }], { page: 1, limit: 100, total: 2 });
    if (key === '/users') return ok([{ id: 'u1', name: 'Asha' }], { page: 1, limit: 100, total: 1 });
    throw new Error(`unmocked ${key}`);
  }));
  return calls;
}
const wrap = (ui) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const show = (s, route = '/dashboard') => renderWithApp(wrap(<Routes><Route path="/dashboard" element={<DashboardPage />} /></Routes>), { session: s, route });
const ALL_VIEW = ['dashboard.view', 'enquiries.view', 'followups.view', 'sitevisits.view', 'units.view', 'bookings.view', 'clients.view', 'referrals.view', 'activities.view', 'users.view'];
const manager = session(ALL_VIEW, { dataScope: 'BRANCH', branchIds: ['b1'] });
const admin = session(ALL_VIEW, { dataScope: 'ALL' });
const executive = session(ALL_VIEW.filter((p) => p !== 'users.view'), { dataScope: 'OWN', branchIds: ['b1'] });
const kpi = (label) => screen.getByTestId(`kpi-${label}`);

afterEach(() => vi.unstubAllGlobals());

describe('delta text', () => {
  it('describes the change in plain numbers, never a rate', () => {
    expect(deltaText(12, 9, 'the previous 7 days')).toBe('+3 vs 9 in the previous 7 days');
    expect(deltaText(2, 5, 'the previous 7 days')).toBe('−3 vs 5 in the previous 7 days');
    expect(deltaText(0, 0, 'the previous 7 days')).toBe('No change vs 0 in the previous 7 days');
    expect(deltaText(4, undefined, 'x')).toBeNull();
  });
});

describe('dashboard', () => {
  it('names the page with a real heading, alongside its existing greeting', async () => {
    // The topbar now says "BuildFlow" for every route, so the page itself must say which page it is.
    mockApi();
    show(manager);
    await screen.findByText('New enquiries');
    expect(screen.getByRole('heading', { level: 2, name: 'Dashboard' })).toBeTruthy();
    // The greeting is untouched and still reads as its own heading.
    const hero = screen.getByRole('region', { name: 'Welcome' });
    expect(within(hero).getByRole('heading', { level: 2 })).toBeTruthy();
  });

  it('keeps that heading before the data arrives, so the page is never left unnamed', () => {
    mockApi({ '/dashboard/summary': () => new Promise(() => {}) });
    show(manager);
    expect(screen.getByRole('heading', { level: 2, name: 'Dashboard' })).toBeTruthy();
  });

  it('keeps that heading when the page reports an error', async () => {
    mockApi({ '/dashboard/summary': fail(500, 'INTERNAL', 'Something broke') });
    show(manager);
    await screen.findByText('Could not load the dashboard');
    expect(screen.getByRole('heading', { level: 2, name: 'Dashboard' })).toBeTruthy();
  });

  it('shows the metrics the server returned, the range, previous-period comparison and recent activity', async () => {
    mockApi();
    show(manager);
    expect(screen.getByRole('status', { name: /loading dashboard/i })).toBeTruthy();
    await screen.findByText('New enquiries');
    expect(screen.getByTestId('dash-range').textContent).toContain('2026-03-04 to 2026-03-10');
    expect(screen.getByTestId('dash-range').textContent).toContain('previous 7 days');
    expect(within(kpi('New enquiries')).getByText('12')).toBeTruthy();
    expect(within(kpi('New enquiries')).getByText(/\+3 vs 9 in the previous 7 days/)).toBeTruthy();
    expect(within(kpi('Active enquiries')).getByText('30')).toBeTruthy();
    expect(within(kpi('Missed follow-ups')).getByText('2')).toBeTruthy();
    const inventory = screen.getByLabelText('Unit inventory');
    expect(within(inventory).getByText('10')).toBeTruthy(); // total units in the donut centre
    expect(within(inventory).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['AVAILABLE660%', 'BOOKED330%', 'SOLD110%']);
    expect(screen.queryByTestId('kpi-Available units')).toBeNull(); // replaced by the inventory chart
    expect(screen.getByLabelText('Booking overview')).toBeTruthy();
    expect(screen.getByRole('note', { name: /About Booking overview: Active bookings only; released ones are never counted/ })).toBeTruthy();
    const feed = screen.getByRole('link', { name: 'Unit UNT-000001 booked for Raj Kumar' });
    expect(feed.getAttribute('href')).toBe('/bookings/b1');
  });

  it('cards open the matching list page with the filters, and never invent a filter the list does not know', async () => {
    mockApi();
    show(admin, '/dashboard?branchId=b2&assignedTo=u1');
    await screen.findByText('New enquiries');
    const href = (label) => within(kpi(label)).getByRole('link').getAttribute('href');
    expect(href('New enquiries')).toBe('/enquiries?branchId=b2&assignedTo=u1&from=2026-03-04&to=2026-03-10');
    expect(href('Missed follow-ups')).toBe('/follow-ups?branchId=b2&assignedTo=u1&view=missed');
    expect(href('Overdue site visits')).toBe('/site-visits?branchId=b2&assignedTo=u1&view=overdue');
    expect(within(screen.getByLabelText('Unit inventory')).getByRole('link', { name: 'BOOKED' }).getAttribute('href')).toBe('/units?branchId=b2&assignedTo=u1&statusId=s-bk');
  });

  it('sends the chosen filters to every dashboard request and offers them to the right people only', async () => {
    const calls = mockApi();
    show(admin);
    await screen.findByText('New enquiries');
    fireEvent.change(await screen.findByLabelText('Branch'), { target: { value: 'b2' } });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-03-01' } });
    await waitFor(() => expect(calls.some((c) => c.startsWith('/dashboard/summary') && c.includes('branchId=b2') && c.includes('from=2026-03-01'))).toBe(true));
    expect(calls.some((c) => c.startsWith('/dashboard/funnel') && c.includes('branchId=b2'))).toBe(true);
    expect(calls.some((c) => c.startsWith('/dashboard/performance') && c.includes('branchId=b2'))).toBe(true);
  });

  it('a one-branch manager gets no branch picker but can narrow to a salesperson, and sees only the team columns the server allows', async () => {
    mockApi();
    show(manager);
    await screen.findByText('New enquiries');
    expect(screen.queryByLabelText('Branch')).toBeNull();
    expect(await screen.findByLabelText('Salesperson')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Team performance' })).toBeTruthy();
    expect(screen.queryByText('Visits completed')).toBeNull(); // the server said this column is not for this user
    expect(screen.getAllByText('Missed follow-ups now').length).toBeGreaterThan(0);
  });

  it('an executive (own records) gets no salesperson picker, no team table and makes no users or performance request', async () => {
    const calls = mockApi();
    show(executive);
    await screen.findByText('New enquiries');
    expect(screen.queryByLabelText('Salesperson')).toBeNull();
    expect(screen.queryByText('Team performance')).toBeNull();
    expect(calls.some((c) => c.startsWith('/dashboard/performance') || c.startsWith('/users'))).toBe(false);
  });

  it('labels the two funnel measures separately and explains they are counts, not conversion rates', async () => {
    mockApi();
    show(manager);
    const table = (await screen.findAllByRole('columnheader', { name: 'In stage now' }))[0].closest('table');
    expect(within(table).getByText('Entered during the period')).toBeTruthy();
    expect(within(table).getByText('Booked').closest('tr').textContent).toContain('34');
    expect(screen.getByText(/not the share of enquiries that moved on/)).toBeTruthy();
    expect(table.closest('[aria-label="Enquiry funnel"]').textContent).not.toMatch(/%/); // no percentages in the pipeline panel
  });

  it('replaces a section the user may not view with a notice, not with zeros', async () => {
    mockApi({ '/dashboard/summary': ok({ ...SUMMARY, allowed: { ...ALL_ALLOWED, bookings: false, referrals: false, activities: false }, bookings: undefined, referrals: undefined, activities: undefined }) });
    show(manager);
    await screen.findByText('New enquiries');
    expect(screen.getByText(/don't have permission to view bookings/i)).toBeTruthy();
    expect(screen.getByText(/don't have permission to view referrals/i)).toBeTruthy();
    expect(screen.getByText(/don't have permission to view activity/i)).toBeTruthy();
    expect(screen.queryByText('Active bookings')).toBeNull();
  });

  it('shows the empty state when nothing is viewable, and an empty feed message when there is no activity', async () => {
    mockApi({ '/dashboard/summary': ok({ ...SUMMARY, allowed: {}, enquiries: undefined, followUps: undefined, siteVisits: undefined, units: undefined, bookings: undefined, clients: undefined, referrals: undefined, activities: undefined }) });
    show(manager);
    expect(await screen.findByText('Nothing to show yet')).toBeTruthy();
  });

  it('shows no-activity text for an empty feed', async () => {
    mockApi({ '/dashboard/summary': ok({ ...SUMMARY, activities: [] }) });
    show(manager);
    expect(await screen.findByText('No recent activity.')).toBeTruthy();
  });

  it('shows the access-denied state for 403 and an error with retry otherwise', async () => {
    mockApi({ '/dashboard/summary': fail(403, 'FORBIDDEN', 'Missing permission: dashboard.view') });
    show(manager);
    expect(await screen.findByText(/don't have access to the dashboard/i)).toBeTruthy();
    expect(screen.queryByText('New enquiries')).toBeNull();

    vi.unstubAllGlobals();
    let attempts = 0;
    mockApi({ '/dashboard/summary': () => (++attempts === 1 ? fail(500, 'INTERNAL', 'Something broke') : ok(SUMMARY)) });
    show(manager);
    expect(await screen.findByText('Could not load the dashboard')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('New enquiries')).toBeTruthy();
  });

  it('a failing panel does not take the dashboard down', async () => {
    mockApi({ '/dashboard/funnel': fail(500, 'INTERNAL', 'boom') });
    show(manager);
    await screen.findByText('New enquiries');
    expect((await screen.findAllByText('Could not load this section.')).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Enquiry sources' })).toBeTruthy();
  });

  it('greets the signed-in user and offers quick actions only for what they may do', async () => {
    mockApi();
    show(session([...ALL_VIEW, 'enquiries.create'], { user: { name: 'Asha Rao' }, dataScope: 'BRANCH', branchIds: ['b1'] }));
    expect(await screen.findByRole('heading', { name: /Good (morning|afternoon|evening), Asha/ })).toBeTruthy();
    const nav = await screen.findByRole('navigation', { name: 'Quick actions' });
    expect(within(nav).getByRole('link', { name: 'New enquiry' }).getAttribute('href')).toBe('/enquiries?create=1');
    expect(within(nav).getByRole('link', { name: 'Follow-ups' }).getAttribute('href')).toBe('/follow-ups');
  });

  it('does not offer New enquiry without the create permission', async () => {
    mockApi();
    show(manager);
    await screen.findByText('New enquiries');
    expect(screen.queryByRole('link', { name: 'New enquiry' })).toBeNull();
  });

  it('range presets set a whole-day range ending today (business time zone)', async () => {
    const calls = mockApi();
    show(manager);
    await screen.findByText('New enquiries');
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    await waitFor(() => expect(calls.some((c) => c.startsWith('/dashboard/summary') && /from=\d{4}-\d\d-\d\d/.test(c) && /to=\d{4}-\d\d-\d\d/.test(c))).toBe(true));
    const last = calls.filter((c) => c.startsWith('/dashboard/summary')).pop();
    const [from, to] = [/from=([\d-]+)/.exec(last)[1], /to=([\d-]+)/.exec(last)[1]];
    expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBe(6);
  });

  it('lists the next follow-ups and visits from the scoped list APIs, each limited and narrowed by the filters', async () => {
    const calls = mockApi({
      '/followups': ok([{ id: 'f1', name: 'Meera Nair', type: { label: 'Call' }, scheduledAt: AT }], { page: 1, limit: 5, total: 1 }),
      '/sitevisits': ok([{ id: 'v1', name: 'Karan Shah', enquiryNo: 'ENQ-000009', units: [{ unitCode: 'UNT-000004' }], scheduledAt: AT }], { page: 1, limit: 5, total: 1 }),
    });
    show(manager, '/dashboard?assignedTo=u1');
    expect((await screen.findAllByText('Meera Nair')).length).toBe(2); // upcoming and missed lists share the mock
    expect(screen.getByText('Karan Shah')).toBeTruthy();
    expect(screen.getByText('UNT-000004')).toBeTruthy();
    expect(calls.some((c) => c.startsWith('/followups') && c.includes('view=upcoming') && c.includes('limit=5') && c.includes('assignedTo=u1'))).toBe(true);
    expect(calls.some((c) => c.startsWith('/sitevisits') && c.includes('view=upcoming'))).toBe(true);
  });

  it('does not request follow-up or visit lists the user may not view', async () => {
    const calls = mockApi({ '/dashboard/summary': ok({ ...SUMMARY, allowed: { ...ALL_ALLOWED, followUps: false, siteVisits: false }, followUps: undefined, siteVisits: undefined }) });
    show(manager);
    await screen.findByText('New enquiries');
    expect(calls.some((c) => c.startsWith('/followups') || c.startsWith('/sitevisits'))).toBe(false);
  });

  it('draws the funnel from the configured stages, switches between the two measures, and links stages to the filtered enquiry list', async () => {
    mockApi();
    show(manager, '/dashboard?branchId=b1&assignedTo=u1');
    const funnel = await screen.findByRole('list', { name: 'Enquiries per workflow stage' });
    expect([...funnel.querySelectorAll('.funnel-name')].map((n) => n.textContent)).toEqual(['New', 'Booked']);
    expect([...funnel.querySelectorAll('.funnel-count')].map((n) => n.textContent)).toEqual(['5', '3']);
    expect(within(funnel).getByRole('link', { name: /Booked/ }).getAttribute('href')).toBe('/enquiries?stage=BOOKED&branchId=b1&assignedTo=u1');
    fireEvent.click(screen.getByRole('tab', { name: 'Entered in period' }));
    expect([...funnel.querySelectorAll('.funnel-count')].map((n) => n.textContent)).toEqual(['12', '4']);
    expect(within(funnel).queryByRole('link')).toBeNull(); // entries have no list equivalent, so no misleading link
  });

  it('keeps the lost stage out of the funnel and shows it beside it', async () => {
    mockApi({ '/dashboard/funnel': ok({ ...FUNNEL, stages: [...FUNNEL.stages, { systemKey: 'LOST', label: 'Lost', kind: 'LOST', order: 99, isActive: true, current: 7, entered: 9 }] }) });
    show(manager);
    const funnel = await screen.findByRole('list', { name: 'Enquiries per workflow stage' });
    expect(within(funnel).queryByText('Lost')).toBeNull();
    expect(screen.getByText(/Lost: 7/)).toBeTruthy();
  });

  it('does not show a comparison when both periods are empty', async () => {
    mockApi();
    show(manager);
    await screen.findByText('New enquiries');
    expect(within(kpi('Converted enquiries')).queryByText(/No change/)).toBeNull();
  });

  it('Unit inventory shows only unit statuses (never booking metrics) as a current snapshot with an empty state for no units', async () => {
    mockApi();
    show(manager);
    const inventory = await screen.findByLabelText('Unit inventory');
    expect(within(inventory).queryByText(/booking/i)).toBeNull();
    expect(within(inventory).getByText(/the date range does not apply/i)).toBeTruthy();
    expect(inventory.querySelectorAll('path[fill]').length).toBe(3);
    expect(within(inventory).getByText('AVAILABLE').closest('li').textContent).toContain('6');
  });

  it('shows a compact empty state when there are no units', async () => {
    mockApi({ '/dashboard/summary': ok({ ...SUMMARY, units: { total: 0, available: 0, booked: 0, sold: 0, byStatus: [] } }) });
    show(manager);
    const inventory = await screen.findByLabelText('Unit inventory');
    expect(within(inventory).getByText('No units yet')).toBeTruthy();
    expect(inventory.querySelector('.donut-chart-container, .donut-chart-empty')).toBeNull();
  });

  it('puts the funnel and the unit inventory side by side and keeps the booking overview', async () => {
    mockApi();
    show(manager);
    const funnel = await screen.findByLabelText('Enquiry funnel');
    expect(funnel.closest('.dash-main')).toBe(screen.getByLabelText('Unit inventory').closest('.dash-main'));
    expect(screen.getByText(/Previous period \(the previous 7 days\): 2 made, 0 released/)).toBeTruthy();
  });
});
