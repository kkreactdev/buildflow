import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp, session } from '../../test/render';
import { SellersRoutes } from './SellersRoutes';

const NONE = { edit: false, verify: false, negotiate: false, approve: false, purchase: false, startWork: false, updateWork: false, completeWork: false, release: false, reject: false, withdraw: false, scheduleFollowUp: false };

const SELLER = {
  id: 's1', sellerNo: 'SEL-000001', branchId: 'b1', branch: { name: 'Chennai', code: 'CHN' },
  personId: 'p1', personName: 'Ravi Menon', phoneE164: '+919812345678',
  statusKey: 'VERIFIED', status: { label: 'Verified', color: '#047857' }, statusChangedAt: '2026-02-05T11:00:00Z', createdAt: '2026-02-01T09:00:00Z',
  assignedTo: 'u7', assignedToName: 'Asha', propertyCount: 2, openPropertyCount: 1, isArchived: false, notes: 'Met at the expo',
  allowed: { edit: true, assign: true, changeStatus: true, statusTargets: ['REJECTED', 'INACTIVE'], addProperty: true, archive: false, scheduleFollowUp: true },
};
const PROPERTY = {
  id: 'pp1', sellerPropertyNo: 'SPP-000001', branchId: 'b1', sellerId: 's1', sellerNo: 'SEL-000001', sellerName: 'Ravi Menon',
  name: '12 acres on Poonamallee Road', city: 'Chennai', askingPrice: 4_500_000, assignedToName: 'Asha',
  statusKey: 'REFURBISHMENT', status: { label: 'Refurbishment / development', color: '#b45309' }, statusChangedAt: '2026-02-22T10:00:00Z',
  unitId: 'u1', unitCode: 'UNT-000042', unitCreatedAt: '2026-02-20T10:00:00Z', eligibleForBuyers: false, isArchived: false,
};
const SELLER_DETAIL = {
  ...SELLER,
  properties: [PROPERTY],
  history: [
    { id: 'h1', entityType: 'seller', toStatus: 'REGISTERED', to: { label: 'Registered' }, action: 'registered', byName: 'Asha', at: '2026-02-01T09:00:00Z' },
    { id: 'h2', entityType: 'seller', fromStatus: 'REGISTERED', from: { label: 'Registered' }, toStatus: 'VERIFIED', to: { label: 'Verified' }, action: 'status', reason: 'ID and ownership checked', byName: 'Mohan', at: '2026-02-05T11:00:00Z' },
  ],
};
const PROPERTY_DETAIL = {
  ...PROPERTY,
  purchasePrice: 4_200_000, purchaseDate: '2026-02-20T00:00:00Z', purchaseReference: 'Reg. 1234/2026',
  description: 'Clear title, north facing', plotArea: 50000, builtUpArea: 1200, bedrooms: 3, bathrooms: 2, pincode: '600056',
  workStartedAt: '2026-02-22T00:00:00Z', estimatedCost: 300000, actualCost: 280000, workAssignedToName: 'Kumar',
  seller: { id: 's1', sellerNo: 'SEL-000001', personName: 'Ravi Menon', statusKey: 'VERIFIED', status: { label: 'Verified' } },
  verification: {
    outcome: 'PASSED', complete: true, verifiedAt: '2026-02-10T10:00:00Z', verifiedByName: 'Mohan',
    checklist: { titleDeed: 'PASSED', encumbrance: 'PASSED', taxRecords: 'PASSED', siteInspection: 'PASSED', measurements: 'PASSED' },
  },
  negotiations: [{ id: 'n1', askingPrice: 4_500_000, offeredPrice: 4_200_000, counterPrice: 4_350_000, outcome: 'AGREED', byName: 'Asha', discussedOn: '2026-02-15T00:00:00Z', at: '2026-02-15T09:00:00Z' }],
  work: [{ id: 'w1', kind: 'START', notes: 'Paint and flooring', estimatedCost: 300000, byName: 'Kumar', at: '2026-02-22T10:00:00Z' }],
  history: [
    { id: 'ph1', entityType: 'sellerProperty', toStatus: 'PROPOSED', to: { label: 'Proposed' }, action: 'registered', at: '2026-02-01T09:00:00Z' },
    { id: 'ph2', entityType: 'sellerProperty', fromStatus: 'PROPOSED', from: { label: 'Proposed' }, toStatus: 'VERIFIED', to: { label: 'Verified' }, action: 'verified', reason: 'All documents in order', at: '2026-02-10T10:00:00Z' },
    { id: 'ph3', entityType: 'sellerProperty', fromStatus: 'VERIFIED', from: { label: 'Verified' }, toStatus: 'APPROVED', to: { label: 'Approved' }, action: 'approved', reason: 'Price within budget', byName: 'Mohan', at: '2026-02-18T10:00:00Z' },
    { id: 'ph4', entityType: 'sellerProperty', fromStatus: 'APPROVED', from: { label: 'Approved' }, toStatus: 'PURCHASED', to: { label: 'Purchased' }, action: 'purchased', at: '2026-02-20T10:00:00Z', refs: [{ type: 'seller', id: 's1' }, { type: 'unit', id: 'u1' }] },
    { id: 'ph5', entityType: 'sellerProperty', fromStatus: 'PURCHASED', from: { label: 'Purchased' }, toStatus: 'REFURBISHMENT', to: { label: 'Refurbishment / development' }, action: 'workStarted', at: '2026-02-22T10:00:00Z' },
  ],
  blockers: { approve: [], purchase: [], release: ['Refurbishment / development has not been completed'] },
  allowed: { ...NONE, updateWork: true, completeWork: true, scheduleFollowUp: true },
};

const ok = (data, meta) => ({ ok: true, status: 200, json: async () => ({ data, ...(meta ? { meta } : {}) }) });
const created = (data) => ({ ok: true, status: 201, json: async () => ({ data }) });
const page = (rows) => ok(rows, { page: 1, limit: 25, total: rows.length });

function mockApi(routes = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace('/api/v1', '');
    const key = `${method} ${path.split('?')[0]}`;
    calls.push({ method, path, key, body: init.body ? JSON.parse(init.body) : undefined });
    if (routes[key]) return typeof routes[key] === 'function' ? routes[key](path, init) : routes[key];
    if (key === 'GET /sellers') return page([SELLER]);
    if (key === 'GET /sellers/properties') return page([PROPERTY]);
    if (key === 'GET /sellers/s1') return ok(SELLER_DETAIL);
    if (key === 'GET /seller-properties/pp1') return ok(PROPERTY_DETAIL);
    if (key === 'GET /masters') return ok({
      SELLER_STATUS: [{ _id: 'm1', systemKey: 'REGISTERED', label: 'Registered', isActive: true }, { _id: 'm2', systemKey: 'VERIFIED', label: 'Verified', isActive: true }, { _id: 'm3', systemKey: 'REJECTED', label: 'Rejected', isActive: true }, { _id: 'm4', systemKey: 'INACTIVE', label: 'Inactive', isActive: true }],
      PROPERTY_STATUS: [{ _id: 'p10', systemKey: 'PROPOSED', label: 'Proposed', isActive: true }],
      PROPERTY_TYPE: [], BUILDING_TYPE: [], LOCATION: [], FOLLOWUP_TYPE: [{ _id: 'f1', code: 'SITE_VISIT', label: 'Site Visit', isActive: true }],
    });
    if (key === 'GET /activities') return page([{ _id: 'x1', type: 'SELLER_CREATED', description: 'Seller Ravi Menon registered', at: '2026-02-01T09:00:00Z' }]);
    if (key === 'GET /documents') return page([]);
    if (key === 'GET /followups') return page([]);
    if (key === 'GET /users') return page([{ id: 'u7', name: 'Asha' }, { id: 'u8', name: 'Kumar' }]);
    if (key === 'GET /branches') return page([]);
    if (key === 'POST /persons/lookup') return ok({ status: 'NONE' });
    throw new Error(`unmocked ${key}`);
  }));
  return calls;
}

const wrap = (ui) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const app = (route, s) => renderWithApp(wrap(<Routes><Route path="/sellers/*" element={<SellersRoutes />} /></Routes>), { session: s, route });
const dialog = () => within(screen.getByRole('dialog'));

const manager = session(
  ['sellers.view', 'sellers.create', 'sellers.edit', 'sellers.archive', 'sellers.assign', 'sellers.verify', 'sellers.approve', 'sellers.purchase', 'sellers.refurbish', 'sellers.release', 'persons.lookup', 'activities.view', 'masters.view', 'documents.view', 'followups.view', 'followups.create', 'users.view'],
  { dataScope: 'BRANCH', branchIds: ['b1'] },
);
const viewer = session(['sellers.view'], { dataScope: 'BRANCH', branchIds: ['b1'] });
afterEach(() => vi.unstubAllGlobals());

describe('Sellers list', () => {
  it('shows sellers with their status, property counts and handler', async () => {
    mockApi();
    app('/sellers', manager);
    expect(await screen.findByText('Ravi Menon')).toBeTruthy();
    expect(screen.getByText('SEL-000001')).toBeTruthy();
    expect(screen.getAllByText('Verified').length).toBeGreaterThan(0);
    expect(screen.getByText('2 (1 open)')).toBeTruthy();
    expect(screen.getByText('Asha')).toBeTruthy();
  });

  it('switches to the property pipeline, a separate server-paged list, with the server’s buyer flag', async () => {
    const calls = mockApi();
    app('/sellers', manager);
    await screen.findByText('Ravi Menon');
    fireEvent.click(screen.getByRole('tab', { name: 'Proposed properties' }));
    expect(await screen.findByText('12 acres on Poonamallee Road')).toBeTruthy();
    expect(calls.some((c) => c.key === 'GET /sellers/properties')).toBe(true);
    expect(screen.getByText('Withheld from buyers')).toBeTruthy();
  });

  it('read-only users cannot register a seller', async () => {
    mockApi();
    app('/sellers', viewer);
    await screen.findByText('Ravi Menon');
    expect(screen.queryByRole('button', { name: 'Register seller' })).toBeNull();
  });

  it('empty and error states', async () => {
    mockApi({ 'GET /sellers': page([]) });
    const { unmount } = app('/sellers', manager);
    expect(await screen.findByText('No sellers yet')).toBeTruthy();
    unmount();
    mockApi({ 'GET /sellers': { ok: false, status: 500, json: async () => ({ error: { code: 'SERVER_ERROR', message: 'boom' } }) } });
    app('/sellers', manager);
    expect(await screen.findByText('Could not load data')).toBeTruthy();
  });
});

describe('Seller registration', () => {
  it('validates, then sends the seller and first property together with numbers as numbers and text as text', async () => {
    const calls = mockApi({ 'POST /sellers': created({ seller: { id: 's1', sellerNo: 'SEL-000001' }, property: { id: 'pp1', sellerPropertyNo: 'SPP-000001' } }) });
    app('/sellers', manager);
    await screen.findByText('Ravi Menon');
    fireEvent.click(screen.getByRole('button', { name: 'Register seller' }));

    fireEvent.click(dialog().getByRole('button', { name: 'Register seller' }));
    expect(await screen.findByText('Enter a name')).toBeTruthy();
    expect(screen.getByText('Describe the property the seller is offering')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.key !== 'POST /persons/lookup')).toBe(false);

    fireEvent.change(dialog().getByLabelText(/^Phone/), { target: { value: '9812345678' } });
    fireEvent.change(dialog().getByLabelText(/^Name/), { target: { value: 'Ravi Menon' } });
    fireEvent.change(dialog().getByLabelText(/^Property name/), { target: { value: '12 acres' } });
    fireEvent.change(dialog().getByLabelText(/^Asking price/), { target: { value: '4500000' } });
    fireEvent.change(dialog().getByLabelText(/^Pincode/), { target: { value: '600056' } });
    fireEvent.change(dialog().getByLabelText(/^Handled by/), { target: { value: 'u8' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Register seller' }));

    await waitFor(() => expect(calls.some((c) => c.key === 'POST /sellers')).toBe(true));
    const body = calls.find((c) => c.key === 'POST /sellers').body;
    expect(body.person).toMatchObject({ name: 'Ravi Menon', phone: '9812345678' });
    expect(body.property).toEqual({ name: '12 acres', askingPrice: 4_500_000, pincode: '600056' });
    expect(body.assignedTo).toBe('u8');
    expect(body.branchId).toBeUndefined(); // a single-branch user's branch is derived by the server
  });

  it('uses an existing person instead of creating a duplicate when the phone is already known', async () => {
    const calls = mockApi({
      'POST /persons/lookup': ok({ status: 'VISIBLE_MATCH', person: { id: 'p9', name: 'Ravi Menon', phone: '98123 45678' } }),
      'POST /sellers': created({ seller: { id: 's1', sellerNo: 'SEL-000001' }, property: { id: 'pp1', sellerPropertyNo: 'SPP-000001' } }),
    });
    app('/sellers', manager);
    await screen.findByText('Ravi Menon');
    fireEvent.click(screen.getByRole('button', { name: 'Register seller' }));
    fireEvent.change(dialog().getByLabelText(/^Phone/), { target: { value: '9812345678' } });
    fireEvent.blur(dialog().getByLabelText(/^Phone/));
    fireEvent.click(await dialog().findByRole('button', { name: 'Use this person' }));
    fireEvent.change(dialog().getByLabelText(/^Property name/), { target: { value: '12 acres' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Register seller' }));

    await waitFor(() => expect(calls.some((c) => c.key === 'POST /sellers')).toBe(true));
    const body = calls.find((c) => c.key === 'POST /sellers').body;
    expect(body.personId).toBe('p9');
    expect(body.person).toBeUndefined();
  });
});

describe('Seller detail', () => {
  it('lists the seller’s properties with their inventory and eligibility state', async () => {
    mockApi();
    app('/sellers/s1', manager);
    expect((await screen.findAllByText('Ravi Menon')).length).toBeGreaterThan(0);
    expect(screen.getByText('12 acres on Poonamallee Road')).toBeTruthy();
    expect(screen.getByText('UNT-000042')).toBeTruthy();
    expect(screen.getAllByText('Withheld from buyers').length).toBeGreaterThan(0);
  });

  it('shows the status history oldest first, with the move, the reason and who made it', async () => {
    mockApi();
    const { container } = app('/sellers/s1', manager);
    expect((await screen.findAllByText('Ravi Menon')).length).toBeGreaterThan(0);
    expect(screen.getByText('ID and ownership checked')).toBeTruthy();
    const rows = [...container.querySelectorAll('ol[aria-label="Status history"] .timeline-title')].map((n) => n.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Registered');
    expect(rows[1]).toMatch(/Status changed.*Registered.*→.*Verified/);
    expect(container.querySelector('ol[aria-label="Status history"]').textContent).toContain('Mohan');
  });

  it('offers only the status moves the server allows, and archive stays disabled while proposals are open', async () => {
    const calls = mockApi({ 'POST /sellers/s1/status': ok(SELLER_DETAIL) });
    app('/sellers/s1', manager);
    await screen.findAllByText('Ravi Menon');
    expect(screen.getByRole('button', { name: 'Archive' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Change status' }));
    const options = [...dialog().getByLabelText(/^New status/).querySelectorAll('option')].map((o) => o.value).filter(Boolean);
    expect(options).toEqual(['REJECTED', 'INACTIVE']);
    fireEvent.change(dialog().getByLabelText(/^New status/), { target: { value: 'INACTIVE' } });
    fireEvent.change(dialog().getByLabelText(/^Reason/), { target: { value: 'Stopped responding' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Update status' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /sellers/s1/status')).toBe(true));
    expect(calls.find((c) => c.key === 'POST /sellers/s1/status').body).toEqual({ to: 'INACTIVE', reason: 'Stopped responding' });
  });

  it('shows the seller’s follow-ups, filtered by the seller', async () => {
    const calls = mockApi();
    app('/sellers/s1', manager);
    await screen.findAllByText('Ravi Menon');
    expect(await screen.findByRole('button', { name: 'Schedule follow-up' })).toBeTruthy();
    expect(calls.some((c) => c.key === 'GET /followups' && c.path.includes('sellerId=s1'))).toBe(true);
  });
});

describe('Proposed property detail', () => {
  it('shows where the property is in the pipeline, what is still needed, verification, negotiation and the work log', async () => {
    mockApi();
    app('/sellers/properties/pp1', manager);
    expect(await screen.findByText('12 acres on Poonamallee Road')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Purchase pipeline' }).querySelector('[aria-current="step"]').textContent).toBe('Refurbishment / development');
    expect(screen.getByText('Before release to buyers')).toBeTruthy();
    expect(screen.getByText('Refurbishment / development has not been completed')).toBeTruthy();
    expect(screen.getByText('Reg. 1234/2026')).toBeTruthy();
    expect(screen.getByText(/Seller asked ₹45,00,000/)).toBeTruthy();
    expect(screen.getByText(/recorded by Asha/)).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Work log' }).textContent).toContain('Paint and flooring');
    expect(screen.getByText(/held under development/)).toBeTruthy();
  });

  it('offers exactly the actions the server allows for this property and user', async () => {
    mockApi();
    app('/sellers/properties/pp1', manager);
    await screen.findByText('12 acres on Poonamallee Road');
    expect(screen.getByRole('button', { name: 'Complete development' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record progress' })).toBeTruthy();
    for (const name of ['Mark ready to sell', 'Complete purchase', 'Approve for purchase', 'Verify', 'Record negotiation', 'Edit', 'Reject', 'Seller withdrew']) {
      expect(screen.queryByRole('button', { name }), name).toBeNull();
    }
  });

  it('completing development sends the date, notes and costs', async () => {
    const calls = mockApi({ 'POST /seller-properties/pp1/refurbish': ok(PROPERTY_DETAIL) });
    app('/sellers/properties/pp1', manager);
    await screen.findByText('12 acres on Poonamallee Road');
    fireEvent.click(screen.getByRole('button', { name: 'Complete development' }));
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Describe the work')).toBeTruthy();
    fireEvent.change(dialog().getByLabelText(/^Work notes/), { target: { value: 'Painting and flooring finished' } });
    fireEvent.change(dialog().getByLabelText(/^Actual cost/), { target: { value: '295000' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /seller-properties/pp1/refurbish')).toBe(true));
    const body = calls.find((c) => c.key === 'POST /seller-properties/pp1/refurbish').body;
    expect(body).toMatchObject({ action: 'complete', workNotes: 'Painting and flooring finished', actualCost: 295000 });
    expect(body.completedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('releasing to buyers is its own confirmed action with an optional listing price', async () => {
    const ready = { ...PROPERTY_DETAIL, workCompletedAt: '2026-03-01T00:00:00Z', blockers: { approve: [], purchase: [], release: [] }, allowed: { ...NONE, release: true } };
    const calls = mockApi({ 'GET /seller-properties/pp1': ok(ready), 'POST /seller-properties/pp1/ready-to-sell': ok({ ...ready, statusKey: 'READY_TO_SELL', eligibleForBuyers: true }) });
    app('/sellers/properties/pp1', manager);
    await screen.findByText('12 acres on Poonamallee Road');
    expect(screen.getByText('Ready to release to buyers')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark ready to sell' }));
    expect(await screen.findByText(/becomes Available/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.change(dialog().getByLabelText(/^Listing price/), { target: { value: '5200000' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Mark ready to sell' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /seller-properties/pp1/ready-to-sell')).toBe(true));
    expect(calls.find((c) => c.key === 'POST /seller-properties/pp1/ready-to-sell').body).toEqual({ expectedPrice: 5_200_000 });
  });

  it('verification opens on the recorded checklist and refuses to pass with a check outstanding', async () => {
    const evaluating = {
      ...PROPERTY_DETAIL, statusKey: 'NEGOTIATION', unitId: undefined, unitCode: undefined, purchasePrice: undefined,
      verification: { outcome: 'PENDING', verifiedAt: '2026-02-10T10:00:00Z', checklist: { titleDeed: 'PASSED', encumbrance: 'PASSED', taxRecords: 'PASSED', siteInspection: 'PASSED', measurements: 'PENDING' } },
      blockers: { approve: ['Verification has not passed on every check'], purchase: [], release: [] },
      allowed: { ...NONE, verify: true, negotiate: true, edit: true, reject: true, withdraw: true },
    };
    const calls = mockApi({ 'GET /seller-properties/pp1': ok(evaluating), 'POST /seller-properties/pp1/verify': ok(evaluating) });
    app('/sellers/properties/pp1', manager);
    await screen.findByText('12 acres on Poonamallee Road');
    expect(screen.getByText('Verification has not passed on every check')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Update verification' }));
    expect(dialog().getByLabelText(/^Title deed/).value).toBe('PASSED');
    expect(dialog().getByLabelText(/^Measurements/).value).toBe('PENDING');

    fireEvent.change(dialog().getByLabelText(/^Overall outcome/), { target: { value: 'PASSED' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Record verification' }));
    expect(await screen.findByText('Verification can only pass when every check has passed')).toBeTruthy();
    expect(calls.some((c) => c.key === 'POST /seller-properties/pp1/verify')).toBe(false);

    fireEvent.change(dialog().getByLabelText(/^Measurements/), { target: { value: 'PASSED' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Record verification' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /seller-properties/pp1/verify')).toBe(true));
    expect(calls.find((c) => c.key === 'POST /seller-properties/pp1/verify').body).toEqual({ outcome: 'PASSED', checklist: { titleDeed: 'PASSED', encumbrance: 'PASSED', taxRecords: 'PASSED', siteInspection: 'PASSED', measurements: 'PASSED' } });
  });

  it('completing a purchase requires price, date and reference, then reports the unit created', async () => {
    const approved = { ...PROPERTY_DETAIL, statusKey: 'APPROVED', unitId: undefined, unitCode: undefined, purchasePrice: undefined, purchaseReference: undefined, work: [], allowed: { ...NONE, purchase: true, reject: true, withdraw: true } };
    const calls = mockApi({ 'GET /seller-properties/pp1': ok(approved), 'POST /seller-properties/pp1/purchase': ok({ ...PROPERTY_DETAIL, unitCreated: true }) });
    app('/sellers/properties/pp1', manager);
    await screen.findByText('12 acres on Poonamallee Road');
    expect(screen.getByText(/Created when the purchase is completed/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Complete purchase' }));
    expect(dialog().getByLabelText(/^Final price/).value).toBe('4200000'); // the agreed offer
    fireEvent.click(dialog().getByRole('button', { name: 'Complete purchase' }));
    expect(await screen.findByText('Record the agreement or document reference')).toBeTruthy();
    fireEvent.change(dialog().getByLabelText(/^Agreement/), { target: { value: 'Sale deed 1234/2026' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Complete purchase' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /seller-properties/pp1/purchase')).toBe(true));
    expect(calls.find((c) => c.key === 'POST /seller-properties/pp1/purchase').body).toMatchObject({ finalPrice: 4_200_000, purchaseReference: 'Sale deed 1234/2026' });
    expect(await screen.findByText(/unit UNT-000042 created/)).toBeTruthy();
  });

  it('a withdrawn property is closed: no workflow actions, history kept', async () => {
    const closed = { ...PROPERTY_DETAIL, statusKey: 'WITHDRAWN', status: { label: 'Withdrawn' }, blockers: { approve: [], purchase: [], release: [] }, allowed: NONE };
    mockApi({ 'GET /seller-properties/pp1': ok(closed) });
    app('/sellers/properties/pp1', manager);
    await screen.findByText('12 acres on Poonamallee Road');
    expect(screen.getByText(/and closed/)).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Purchase pipeline' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Status history' })).toBeTruthy();
  });

  it('the history links the unit created at purchase and names the approver', async () => {
    mockApi();
    app('/sellers/properties/pp1', manager);
    await screen.findByText('12 acres on Poonamallee Road');
    const history = within(screen.getByRole('list', { name: 'Status history' }));
    expect(history.getByText(/Purchase completed/)).toBeTruthy();
    expect(history.getByRole('link', { name: 'Unit' }).getAttribute('href')).toBe('/units/u1');
    expect(history.getAllByText(/Mohan/).length).toBeGreaterThan(0);
  });
});
