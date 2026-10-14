import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../app/AppProviders';
import { SiteVisitCalendar } from './SiteVisitCalendar';

const calls = [];

function mockApi({ rows = [], error = null, status = 200 } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const key = `${method} ${url.replace('/api/v1', '').split('?')[0]}`;
    calls.push({ key, url });
    if (error) return { ok: false, status, json: async () => ({ error }) };
    return { ok: true, status, json: async () => ({ data: rows, meta: { page: 1, limit: 500, total: rows.length } }) };
  }));
}

// AppProviders brings in the QueryClient, ToastProvider, and the auth/permission provider.
// We pass a session that grants the permissions the calendar actions need; without them the
// "Add visit" button is hidden, which would also disable the "open modal" path this tests.
const wrap = (ui, { permissions = ['sitevisits.view', 'sitevisits.create', 'enquiries.view', 'units.view'] } = {}) => {
  // We layer a no-retry QueryClient on top of the providers so error tests don't sit through
  // the default 3 retries before asserting on `query.isError`.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <AppProviders initialSession={{ user: { name: 'Test User' }, permissions, dataScope: 'BRANCH', branchIds: ['b1'] }}>
        <MemoryRouter initialEntries={['/site-visits']}>{ui}</MemoryRouter>
      </AppProviders>
    </QueryClientProvider>
  );
};

const VISIT = (over) => ({
  id: over.id ?? 'v1',
  visitNo: over.visitNo ?? 'SV-000001',
  enquiryId: 'e1',
  enquiryNo: 'ENQ-000001',
  name: over.name ?? 'Meena Iyer',
  scheduledAt: over.scheduledAt ?? '2026-03-04T09:00:00Z',
  statusKey: over.statusKey ?? 'SCHEDULED',
  status: { label: over.statusLabel ?? 'Scheduled' },
  units: over.units ?? [],
  allowed: {},
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('Site visits calendar', () => {
  beforeEach(() => calls.length = 0);

  /**
   * Regression: the calendar used to request `limit: 500`, but the shared list endpoint caps `limit`
   * at MAX_PAGE_SIZE (100) and rejects anything larger with a validation error — so the calendar
   * rendered "Validation failed" instead of the month. The rest of this file mocks the API, so
   * nothing else here would notice an out-of-contract request.
   */
  it('requests a page size the list endpoint accepts', async () => {
    mockApi({ rows: [] });
    render(wrap(<SiteVisitCalendar filters={{}} canCreate={true} initialDate={new Date('2026-03-15T10:00:00Z')} />));
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /sitevisits')).toBe(true));
    const url = calls.find((c) => c.key === 'GET /sitevisits').url;
    // Mirrors MAX_PAGE_SIZE in server/src/lib/listQuery.ts.
    expect(Number(new URL(url, 'http://x').searchParams.get('limit'))).toBeLessThanOrEqual(100);
  });

  it('groups visits by day and sorts them by time', async () => {
    mockApi({
      rows: [
        VISIT({ id: 'a', visitNo: 'SV-000010', scheduledAt: '2026-03-10T09:00:00Z', name: 'Morning' }),
        VISIT({ id: 'b', visitNo: 'SV-000011', scheduledAt: '2026-03-10T14:00:00Z', name: 'Afternoon' }),
      ],
    });
    render(wrap(<SiteVisitCalendar filters={{}} canCreate={true} initialDate={new Date('2026-03-15T10:00:00Z')} />));
    await waitFor(() => expect(screen.getByText('Morning')).toBeTruthy());
    const eventButtons = screen.getAllByRole('button', { name: /Morning|Afternoon/ });
    expect(eventButtons[0].textContent).toMatch(/Morning/);
    expect(eventButtons[1].textContent).toMatch(/Afternoon/);
  });

  it('shows multiple visits on the same day and the +N more indicator when overflowing', async () => {
    // Use mid-day UTC times so the visits land on the same local day in any reasonable timezone
    // (the test environment is currently UTC, but the assertion is about cell grouping, not times).
    const rows = Array.from({ length: 5 }, (_, i) => VISIT({ id: `x${i}`, visitNo: `SV-0000${30 + i}`, scheduledAt: `2026-06-10T12:0${i}:00Z`, name: `Visit ${i}` }));
    mockApi({ rows });
    render(wrap(<SiteVisitCalendar filters={{}} canCreate={true} initialDate={new Date('2026-06-10T12:00:00Z')} />));
    await waitFor(() => {
      const el = document.querySelector('.sv-calendar-overflow');
      expect(el?.textContent).toMatch(/\+2 more/);
    });
    // Only the first MAX_VISITS_PER_CELL are rendered as events in the cell; the rest live behind "+N more".
    expect(document.querySelectorAll('.sv-calendar-grid .sv-calendar-event')).toHaveLength(3);
  });

  it('opens the full day list from "+N more", showing every visit that the cell truncated', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => VISIT({ id: `x${i}`, visitNo: `SV-0000${30 + i}`, scheduledAt: `2026-06-10T12:0${i}:00Z`, name: `Visit ${i}` }));
    mockApi({ rows });
    render(wrap(<SiteVisitCalendar filters={{}} canCreate={true} initialDate={new Date('2026-06-10T12:00:00Z')} />));

    const more = await screen.findByRole('button', { name: /Show all 5 visits on/ });
    fireEvent.click(more);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toMatch(/^Visits on /);
    // All five are listed here, including the two the cell could not show.
    for (let i = 0; i < 5; i++) expect(within(dialog).getByText(`Visit ${i}`)).toBeTruthy();
    expect(dialog.textContent).toMatch(/5 visits/);
  });

  it('renders SCHEDULED, COMPLETED, and CANCELLED with distinguishable classes', async () => {
    mockApi({
      rows: [
        VISIT({ id: 's', visitNo: 'SV-000040', scheduledAt: '2026-07-08T09:00:00Z', name: 'Upcoming visit', statusKey: 'SCHEDULED', statusLabel: 'Scheduled' }),
        VISIT({ id: 'c', visitNo: 'SV-000041', scheduledAt: '2026-07-08T10:00:00Z', name: 'Done visit', statusKey: 'COMPLETED', statusLabel: 'Completed' }),
        VISIT({ id: 'x', visitNo: 'SV-000042', scheduledAt: '2026-07-08T11:00:00Z', name: 'Cancelled visit', statusKey: 'CANCELLED', statusLabel: 'Cancelled' }),
      ],
    });
    render(wrap(<SiteVisitCalendar filters={{}} canCreate={true} initialDate={new Date('2026-07-08T10:00:00Z')} />));
    await waitFor(() => expect(screen.getByText('Upcoming visit')).toBeTruthy());
    const event = (name) => screen.getByText(name).closest('.sv-calendar-event');
    expect(event('Upcoming visit').className).toMatch(/is-scheduled/);
    expect(event('Done visit').className).toMatch(/is-completed/);
    expect(event('Cancelled visit').className).toMatch(/is-cancelled/);
  });

  it('navigates with Prev / Today / Next and updates the visible month', async () => {
    mockApi({ rows: [] });
    render(wrap(<SiteVisitCalendar filters={{}} canCreate={true} initialDate={new Date('2026-03-15T10:00:00Z')} />));
    await waitFor(() => expect(screen.getByText('March 2026')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('April 2026')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByText('March 2026')).toBeTruthy();
  });

  it('week view shows exactly 7 day cells and switches to a 7-day grid', async () => {
    mockApi({ rows: [] });
    render(wrap(<SiteVisitCalendar filters={{}} canCreate={true} initialDate={new Date('2026-09-09T10:00:00Z')} />));
    await waitFor(() => expect(screen.getByRole('grid')).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'Week' }));
    await waitFor(() => expect(screen.getByRole('grid').className).toMatch(/sv-calendar-grid--week/));
    expect(document.querySelectorAll('.sv-calendar-cell--day')).toHaveLength(7);
  });

  it('opens the schedule modal when a day cell receives Enter (with permission), prefilled with that day', async () => {
    mockApi({ rows: [] });
    render(wrap(
      <Routes>
        <Route path="/site-visits/*" element={<SiteVisitCalendar filters={{}} canCreate={true} initialDate={new Date('2026-08-12T10:00:00Z')} />} />
        <Route path="/site-visits/:id" element={<div>detail</div>} />
      </Routes>,
    ));
    await waitFor(() => expect(document.querySelector('.sv-calendar-cell--day')).toBeTruthy());
    // The FIRST cell of the August 2026 grid is the Sunday on/ before 1 Aug: 2026-07-26.
    const dayCell = document.querySelector('.sv-calendar-cell--day');
    const chosenDay = dayCell.getAttribute('data-cal-day');
    fireEvent.keyDown(dayCell, { key: 'Enter' });

    expect(await screen.findByText('Schedule site visit')).toBeTruthy();
    // The date the cell proposed is carried into the form, so the user schedules on THAT day.
    // The label carries a required marker, hence the regex rather than an exact match.
    const when = await screen.findByLabelText(/^When/);
    expect(when.value.slice(0, 10)).toBe(chosenDay);
  });

  it('disables the + button when the user cannot create visits', async () => {
    mockApi({ rows: [] });
    render(wrap(<SiteVisitCalendar filters={{}} canCreate={false} initialDate={new Date('2026-08-12T10:00:00Z')} />));
    await waitFor(() => expect(document.querySelector('.sv-calendar-cell--day')).toBeTruthy());
    const addButtons = document.querySelectorAll('.sv-calendar-add');
    expect(addButtons.length).toBeGreaterThan(0);
    addButtons.forEach((b) => expect(b.disabled).toBe(true));
  });

  it('navigates to the visit detail page when a visit is clicked', async () => {
    mockApi({
      rows: [
        VISIT({ id: 'v-click', visitNo: 'SV-000099', scheduledAt: '2026-10-05T10:00:00Z', name: 'Clickable' }),
      ],
    });
    render(wrap(
      <Routes>
        <Route path="/site-visits" element={<SiteVisitCalendar filters={{}} canCreate={true} initialDate={new Date('2026-10-05T10:00:00Z')} />} />
        <Route path="/site-visits/:id" element={<div data-testid="detail" />} />
      </Routes>,
    ));
    const btn = await screen.findByRole('button', { name: /Clickable/ });
    fireEvent.click(btn);
    expect(await screen.findByTestId('detail')).toBeTruthy();
  });

  it('shows the empty state when the range has no visits', async () => {
    mockApi({ rows: [] });
    render(wrap(<SiteVisitCalendar filters={{}} canCreate={true} initialDate={new Date('2026-12-15T10:00:00Z')} />));
    await waitFor(() => expect(screen.getByText('No visits in this range')).toBeTruthy());
  });

  it('renders the error state when the request fails', async () => {
    mockApi({ error: { code: 'INTERNAL_ERROR', message: 'Cannot reach the server' }, status: 500 });
    render(wrap(<SiteVisitCalendar filters={{}} canCreate={true} initialDate={new Date('2026-08-12T10:00:00Z')} />));
    // The app QueryClient retries failed queries 3 times by default (with backoff). That is
    // the right behaviour in production; the test waits long enough for those retries to
    // exhaust so the error UI finally renders.
    await waitFor(() => {
      const el = document.querySelector('.sv-calendar-error');
      expect(el?.textContent).toMatch(/Cannot reach the server/);
    }, { timeout: 15000 });
  }, 20000);

  it('passes filters (status, assignedTo, branchId) through to the API', async () => {
    mockApi({ rows: [] });
    render(wrap(<SiteVisitCalendar filters={{ status: 'COMPLETED', assignedTo: 'u-1', branchId: 'b-1', isArchived: 'false' }} canCreate={true} initialDate={new Date('2026-11-15T10:00:00Z')} />));
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    const url = calls[0].url;
    expect(url).toMatch(/status=COMPLETED/);
    expect(url).toMatch(/assignedTo=u-1/);
    expect(url).toMatch(/branchId=b-1/);
    expect(url).toMatch(/isArchived=false/);
    expect(url).toMatch(/from=/);
    expect(url).toMatch(/to=/);
  });

  it('handles visits that span month boundaries', async () => {
    mockApi({
      rows: [
        VISIT({ id: 'm', visitNo: 'SV-000020', scheduledAt: '2026-03-31T23:30:00Z', name: 'Late March' }),
        VISIT({ id: 'n', visitNo: 'SV-000021', scheduledAt: '2026-05-01T00:30:00Z', name: 'Early May' }),
      ],
    });
    render(wrap(<SiteVisitCalendar filters={{}} canCreate={true} initialDate={new Date('2026-04-15T10:00:00Z')} />));
    await waitFor(() => expect(screen.getByText('Late March')).toBeTruthy());
    expect(screen.getByText('Early May')).toBeTruthy();
  });
});
