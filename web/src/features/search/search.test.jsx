import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp, session } from '../../test/render';
import { GlobalSearch } from './GlobalSearch';

const ok = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });
const fail = (status, code, message) => ({ ok: false, status, json: async () => ({ error: { code, message } }) });
const RESULTS = {
  query: 'raj',
  results: [
    { type: 'client', label: 'Clients', hasMore: false, items: [{ type: 'client', id: 'c1', title: 'Raj Kumar', subtitle: 'CL-000001 · +91 98765 43210' }] },
    { type: 'document', label: 'Documents', hasMore: true, items: [{ type: 'document', id: 'd1', title: 'Raj agreement', subtitle: 'DOC-000001 · Client CL-000001' }] },
    { type: 'sitevisit', label: 'Site visits', hasMore: false, items: [{ type: 'sitevisit', id: 'v1', title: 'Raj Kumar', subtitle: 'SV-000001 · ENQ-000001' }] },
  ],
};

/** Only the search endpoint: the app also fetches public branding on mount, which is not the subject here. */
const searchCalls = (calls) => calls.filter((c) => String(c).startsWith('/search'));

function mockApi(handler) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = url.replace('/api/v1', '');
    calls.push(path);
    if (path.startsWith('/search')) return handler ? handler(path) : ok(RESULTS);
    throw new Error(`unmocked ${path}`);
  }));
  return calls;
}
const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
const wrap = (ui) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const show = (s) => renderWithApp(wrap(<><GlobalSearch /><Routes><Route path="*" element={<Where />} /></Routes></>), { session: s });
const ALL = session(['clients.view', 'enquiries.view', 'units.view', 'bookings.view', 'referrals.view', 'sitevisits.view', 'documents.view']);
const box = () => screen.getByRole('combobox', { name: 'Search records' });
const type = (text) => fireEvent.change(box(), { target: { value: text } });
const debounce = () => act(() => vi.advanceTimersByTimeAsync(350));

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('global search', () => {
  it('is not rendered at all for a user who can view none of the searchable records', () => {
    mockApi();
    show(session(['dashboard.view']));
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('asks for at least two characters and sends nothing for fewer', async () => {
    const calls = mockApi();
    show(ALL);
    fireEvent.focus(box());
    type('r');
    await debounce();
    expect(screen.getByText('Type at least 2 characters.')).toBeTruthy();
    expect(searchCalls(calls)).toEqual([]); // no SEARCH request yet (app bootstrap aside)
  });

  it('debounces typing into a single request and shows the grouped results with labels', async () => {
    const calls = mockApi();
    show(ALL);
    fireEvent.focus(box());
    for (const t of ['ra', 'raj', 'raj ']) type(t);
    expect(searchCalls(calls)).toEqual([]); // still one keystroke's worth of debouncing
    await debounce();
    expect(await screen.findAllByText('Raj Kumar', { selector: 'strong' })).toHaveLength(2); // a client and a site visit
    expect(searchCalls(calls)).toHaveLength(1);
    expect(searchCalls(calls)[0]).toBe('/search?q=raj&limit=5');
    expect(screen.getByRole('group', { name: 'Clients' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Documents/ }).textContent).toContain('showing first 1');
    expect(screen.getByText('CL-000001 · +91 98765 43210')).toBeTruthy();
  });

  it('offers a type filter built from what the user may view, and sends the chosen type', async () => {
    const calls = mockApi();
    show(session(['clients.view', 'documents.view']));
    fireEvent.focus(box());
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Clients', 'Documents']);
    fireEvent.click(screen.getByRole('button', { name: 'Documents' }));
    type('raj');
    await debounce();
    await waitFor(() => expect(calls.some((c) => c.includes('types=document'))).toBe(true));
  });

  it('opens a result on its own detail route by click, and by keyboard', async () => {
    mockApi();
    show(ALL);
    fireEvent.focus(box());
    type('raj');
    await debounce();
    fireEvent.click(await screen.findByText('Raj agreement'));
    expect(screen.getByTestId('where').textContent).toBe('/documents/d1');
    expect(box().value).toBe('');

    fireEvent.focus(box());
    type('raj');
    await debounce();
    await screen.findByText('Raj agreement');
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(screen.getByTestId('where').textContent).toBe('/site-visits/v1');
  });

  it('shows no-match and error messages, and a permission message for a refused type', async () => {
    mockApi(() => ok({ query: 'zzz', results: [] }));
    show(ALL);
    fireEvent.focus(box());
    type('zzz');
    await debounce();
    expect(await screen.findByText(/No matches for/)).toBeTruthy();

    vi.unstubAllGlobals();
    mockApi(() => fail(500, 'INTERNAL', 'boom'));
    type('yyy');
    await debounce();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Search failed');

    vi.unstubAllGlobals();
    mockApi(() => fail(403, 'FORBIDDEN', 'no'));
    type('xxx');
    await debounce();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('cannot search'));
  });

  it('closes on Escape', () => {
    mockApi();
    show(ALL);
    fireEvent.focus(box());
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
