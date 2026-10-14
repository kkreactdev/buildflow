import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp, session } from '../../test/render';
import { EnquiriesRoutes } from './EnquiriesRoutes';

const ok = (data, meta) => ({ ok: true, status: 200, json: async () => ({ data, ...(meta ? { meta } : {}) }) });
const fail = (status, code, message) => ({ ok: false, status, json: async () => ({ error: { code, message } }) });
const STAGES = [{ systemKey: 'BOOKED', label: 'Booked', order: 7, kind: 'FLOW', isActive: true }, { systemKey: 'CONVERTED', label: 'Converted', order: 8, kind: 'FLOW', isActive: true }];

const base = (stageCode, conversion, extra = {}) => ({
  id: 'e1', enquiryNo: 'ENQ-000007', name: 'Meena Iyer', phone: '+91 98765 43210', phoneE164: '+919876543210', personId: 'p1', branchId: 'b1', branch: { name: 'Chennai' },
  stageCode, stage: STAGES.find((s) => s.systemKey === stageCode), stageChangedAt: '2026-01-05T10:00:00Z', isArchived: false, createdAt: '2026-01-05T10:00:00Z',
  assignedToName: 'Asha', person: { name: 'Meena Iyer', phone: '+91 98765 43210' }, transitions: [], assignments: [], stageHistory: [], conversion, ...extra,
});
const BOOKED = base('BOOKED', { eligible: true, alreadyConverted: false, stageKey: 'CONVERTED', stageLabel: 'Converted' });
const CONVERTED = base('CONVERTED', { eligible: false, alreadyConverted: true, stageKey: 'CONVERTED', client: { id: 'c9', clientNo: 'CL-000009', name: 'Meena Iyer' } });

function mockApi(routes = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace('/api/v1', '');
    const key = `${method} ${path.split('?')[0]}`;
    calls.push({ method, key, body: init.body ? JSON.parse(init.body) : undefined });
    if (routes[key]) return typeof routes[key] === 'function' ? routes[key]() : routes[key];
    if (key === 'GET /workflow/stages') return ok(STAGES);
    if (key === 'GET /workflow/transitions') return ok([]);
    if (key === 'GET /masters') return ok({});
    throw new Error(`unmocked ${key}`);
  }));
  return calls;
}
const wrap = (ui) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const app = (s) => renderWithApp(wrap(<Routes><Route path="/enquiries/*" element={<EnquiriesRoutes />} /></Routes>), { session: s, route: '/enquiries/e1' });
const PERMS = ['enquiries.view', 'enquiries.convert', 'clients.create'];
const manager = session(PERMS, { dataScope: 'BRANCH', branchIds: ['b1'] });
afterEach(() => vi.unstubAllGlobals());

describe('Convert to Client', () => {
  it('is a visible primary action on a booked enquiry for someone who may convert', async () => {
    mockApi({ 'GET /enquiries/e1': ok(BOOKED) });
    app(manager);
    const button = await screen.findByRole('button', { name: 'Convert to Client' });
    expect(button.disabled).toBe(false);
  });

  it('asks for confirmation, sends one conversion request, and shows the result after the refresh', async () => {
    let converted = false;
    const calls = mockApi({
      'GET /enquiries/e1': () => ok(converted ? CONVERTED : BOOKED),
      'POST /enquiries/e1/convert': () => { converted = true; return ok({ alreadyConverted: false, createdClient: true, client: { id: 'c9', clientNo: 'CL-000009', name: 'Meena Iyer' }, enquiry: CONVERTED }); },
    });
    app(manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Convert to Client' }));
    const dialog = await screen.findByRole('dialog', { name: /Convert ENQ-000007 to a client/ });
    expect(within(dialog).getByText(/no duplicate is created/i)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false); // nothing is sent before confirming
    const confirm = within(dialog).getByRole('button', { name: 'Convert to client' });
    fireEvent.click(confirm);
    fireEvent.click(confirm); // a second click while working must not send a second request
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.filter((c) => c.key === 'POST /enquiries/e1/convert')).toHaveLength(1);
    expect(await screen.findByText('Converted: client CL-000009 created')).toBeTruthy();
    // the refreshed page links to the client and no longer offers the action
    const card = await screen.findByLabelText('Client');
    expect(within(card).getByRole('link', { name: /CL-000009/ }).getAttribute('href')).toBe('/clients/c9');
    expect(screen.getByRole('link', { name: 'View client CL-000009' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Convert to Client' })).toBeNull();
  });

  it('says when an existing client was linked', async () => {
    mockApi({ 'GET /enquiries/e1': ok(BOOKED), 'POST /enquiries/e1/convert': ok({ alreadyConverted: false, createdClient: false, client: { id: 'c4', clientNo: 'CL-000004', name: 'Meena Iyer' }, enquiry: CONVERTED }) });
    app(manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Convert to Client' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Convert to client' }));
    expect(await screen.findByText('Converted: linked to existing client CL-000004')).toBeTruthy();
  });

  it('keeps the dialog open with the server\'s message when the conversion is refused', async () => {
    mockApi({ 'GET /enquiries/e1': ok(BOOKED), 'POST /enquiries/e1/convert': fail(409, 'NOT_CONVERTIBLE', 'Only an enquiry in "Booked" can be converted') });
    app(manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Convert to Client' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Convert to client' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Only an enquiry in "Booked"');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Convert to client' }).disabled).toBe(false); // can be retried or cancelled
  });

  it('is shown disabled, with the reason, before the enquiry is booked', async () => {
    mockApi({ 'GET /enquiries/e1': ok(base('BOOKED', { eligible: false, alreadyConverted: false, stageKey: 'CONVERTED' })) });
    app(manager);
    const button = await screen.findByRole('button', { name: 'Convert to Client' });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toMatch(/booked/i);
  });

  it('is not offered without both permissions, or once converted', async () => {
    mockApi({ 'GET /enquiries/e1': ok(BOOKED) });
    const { unmount } = app(session(['enquiries.view', 'clients.create'], { dataScope: 'BRANCH', branchIds: ['b1'] }));
    await screen.findByRole('heading', { name: /Meena Iyer/ });
    expect(screen.queryByRole('button', { name: 'Convert to Client' })).toBeNull();
    unmount();
    vi.unstubAllGlobals();
    mockApi({ 'GET /enquiries/e1': ok(BOOKED) });
    const second = app(session(['enquiries.view', 'enquiries.convert'], { dataScope: 'BRANCH', branchIds: ['b1'] }));
    await screen.findByRole('heading', { name: /Meena Iyer/ });
    expect(screen.queryByRole('button', { name: 'Convert to Client' })).toBeNull();
    second.unmount();
    vi.unstubAllGlobals();
    mockApi({ 'GET /enquiries/e1': ok(CONVERTED) });
    app(manager);
    await screen.findByRole('heading', { name: /Meena Iyer/ });
    expect(screen.queryByRole('button', { name: 'Convert to Client' })).toBeNull();
  });

  it('tells a converted enquiry\'s viewer when the client record is outside their access', async () => {
    mockApi({ 'GET /enquiries/e1': ok(base('CONVERTED', { eligible: false, alreadyConverted: true, stageKey: 'CONVERTED' })) });
    app(manager);
    expect(await screen.findByText(/client record is not available to you/i)).toBeTruthy();
  });
});
