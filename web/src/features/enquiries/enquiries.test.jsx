import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp, session } from '../../test/render';
import { EnquiriesRoutes } from './EnquiriesRoutes';

const STAGE = (systemKey, label, order, extra = {}) => ({ systemKey, label, order, color: '#336699', kind: 'FLOW', isActive: true, ...extra });
const STAGES = [STAGE('NEW', 'Fresh', 1), STAGE('CONTACTED', 'Reached out', 2), STAGE('INTERESTED', 'Warm', 3), STAGE('SITE_VISIT_SCHEDULED', 'Visit booked', 4), STAGE('LOST', 'Lost', 1000, { kind: 'LOST' })];
const stageObj = (k) => STAGES.find((s) => s.systemKey === k);

const enq = (id, no, name, stageCode, extra = {}) => ({
  id, enquiryNo: no, name, phone: '+91 98765 43210', phoneE164: '+919876543210', personId: `p-${id}`, branchId: 'b1', branch: { name: 'Chennai', code: 'CHN' },
  stageCode, stage: stageObj(stageCode), stageChangedAt: new Date().toISOString(), isArchived: false, createdAt: '2026-01-05T10:00:00Z',
  source: { label: 'Website', isActive: true }, location: { label: 'Anna Nagar', isActive: false }, assignedTo: 'u1', assignedToName: 'Asha', ...extra,
});
const E1 = enq('e1', 'ENQ-000001', 'Raj Kumar', 'NEW');
const E2 = enq('e2', 'ENQ-000002', 'Bhavna Rao', 'INTERESTED');

const boardOf = (cards) => ({ stages: STAGES.map((s) => { const c = cards.filter((x) => x.stageCode === s.systemKey); return { ...s, count: c.length, cards: c }; }), total: cards.length });
const TRANSITIONS = {
  NEW: [{ to: 'CONTACTED', direction: 'FORWARD', requiresReason: false }, { to: 'LOST', direction: 'LOST', requiresReason: true }],
  INTERESTED: [{ to: 'SITE_VISIT_SCHEDULED', direction: 'FORWARD', requiresReason: false, domainOperation: 'sitevisit.schedule' }, { to: 'CONTACTED', direction: 'BACKWARD', requiresReason: true }, { to: 'NEW', direction: 'BACKWARD', requiresReason: true }, { to: 'LOST', direction: 'LOST', requiresReason: true }],
  LOST: [{ to: 'NEW', direction: 'REOPEN', requiresReason: true }],
};

const ok = (data, meta) => ({ ok: true, status: 200, json: async () => ({ data, ...(meta ? { meta } : {}) }) });
const fail = (status, code, message) => ({ ok: false, status, json: async () => ({ error: { code, message } }) });

function mockApi(routes = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace('/api/v1', '');
    const key = `${method} ${path.split('?')[0]}`;
    calls.push({ method, path, key, body: init.body ? JSON.parse(init.body) : undefined });
    if (routes[key]) return typeof routes[key] === 'function' ? routes[key](path, init) : routes[key];
    if (key === 'GET /enquiries/board') return ok(boardOf([E1, E2]));
    if (key === 'GET /enquiries') return ok([E1, E2], { page: 1, limit: 25, total: 2 });
    if (key === 'GET /workflow/stages') return ok(STAGES);
    if (key === 'GET /workflow/transitions') return ok(TRANSITIONS[new URL(`http://x${path}`).searchParams.get('from')] ?? []);
    if (key === 'GET /masters') return ok({ ENQUIRY_SOURCE: [{ _id: 's1', code: 'WEB', label: 'Website', isActive: true }], ENQUIRY_TYPE: [], PROPERTY_TYPE: [], BUILDING_TYPE: [], LOCATION: [{ _id: 'l1', code: 'AN', label: 'Anna Nagar', isActive: true }], LOST_REASON: [{ _id: 'lr1', code: 'BUDGET', label: 'Budget too low', isActive: true }], ACTIVITY_TYPE: [{ _id: 'a1', code: 'ENQUIRY_CREATED', label: 'Enquiry created', isActive: true }] });
    if (key === 'GET /users') return ok([{ id: 'u1', name: 'Asha' }, { id: 'u2', name: 'Vikram' }], { page: 1, limit: 100, total: 2 });
    if (key === 'GET /branches') return ok([{ _id: 'b1', name: 'Chennai', isActive: true }], { page: 1, limit: 100, total: 1 });
    if (key === 'GET /activities') return ok([{ _id: 'x1', type: 'ENQUIRY_CREATED', description: 'Enquiry ENQ-000001 created for Raj Kumar', at: '2026-01-05T10:00:00Z' }], { page: 1, limit: 50, total: 1 });
    if (key === 'GET /audit') return ok([{ id: 'au1', action: 'create', at: '2026-01-05T10:00:00Z', changes: { stageCode: { to: 'NEW' } } }], { page: 1, limit: 50, total: 1 });
    throw new Error(`unmocked ${key}`);
  }));
  return calls;
}
const wrap = (ui) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const app = (route, s) => renderWithApp(wrap(<Routes><Route path="/enquiries/*" element={<EnquiriesRoutes />} /></Routes>), { session: s, route });
const manager = session(['enquiries.view', 'enquiries.create', 'enquiries.edit', 'enquiries.assign', 'enquiries.archive', 'enquiries.revert', 'enquiries.lose', 'enquiries.reopen', 'enquiries.export', 'users.view', 'persons.lookup', 'activities.view', 'audit.view'], { dataScope: 'BRANCH', branchIds: ['b1'] });
const viewer = session(['enquiries.view'], { dataScope: 'OWN', branchIds: ['b1'] });
afterEach(() => vi.unstubAllGlobals());

const dt = () => ({ setData: () => {}, getData: () => '', effectAllowed: '' });
async function startDrag(cardNo) {
  const card = await screen.findByTestId(`card-${cardNo}`);
  fireEvent.dragStart(card, { dataTransfer: dt() });
  return card;
}
const drop = (key) => {
  const col = screen.getByTestId(`col-${key}`);
  fireEvent.dragOver(col, { dataTransfer: dt() });
  fireEvent.drop(col, { dataTransfer: dt() });
};
const posts = (calls) => calls.filter((c) => c.method === 'POST');

describe('Kanban board', () => {
  it('builds its columns from the configured workflow (names, colours, counts) — nothing is hard-coded', async () => {
    mockApi();
    app('/enquiries?view=board', manager);
    await screen.findByTestId('card-ENQ-000001');
    const board = screen.getByRole('list', { name: 'Enquiry pipeline' });
    expect(within(board).getAllByRole('listitem').map((c) => c.getAttribute('aria-label'))).toEqual(['Fresh', 'Reached out', 'Warm', 'Visit booked', 'Lost']);
    expect(within(screen.getByTestId('col-NEW')).getByText('1')).toBeTruthy();
    expect(within(screen.getByTestId('col-NEW')).getByText('Raj Kumar')).toBeTruthy();
    expect(within(screen.getByTestId('col-INTERESTED')).getByText('Bhavna Rao')).toBeTruthy();
  });

  it('while dragging, only the targets the BACKEND offers are droppable; domain-owned stages are flagged', async () => {
    const calls = mockApi();
    app('/enquiries?view=board', manager);
    await startDrag('ENQ-000002'); // INTERESTED
    await waitFor(() => expect(screen.getByTestId('col-CONTACTED').className).toContain('is-droppable'));
    expect(calls.some((c) => c.key === 'GET /workflow/transitions' && c.path.includes('from=INTERESTED'))).toBe(true);
    expect(screen.getByTestId('col-NEW').className).toContain('is-droppable'); // backward is offered to a manager
    expect(screen.getByTestId('col-SITE_VISIT_SCHEDULED').className).toContain('is-domain');
    expect(screen.getByTestId('col-LOST').className).toContain('is-droppable');
  });

  it('a valid forward drop sends the move (with the stage the screen believes) and refreshes the board from the server', async () => {
    let moved = false;
    const calls = mockApi({
      'POST /enquiries/e1/transition': () => { moved = true; return ok({ ...E1, stageCode: 'CONTACTED' }); },
      'GET /enquiries/board': () => ok(boardOf(moved ? [{ ...E1, stageCode: 'CONTACTED', stage: stageObj('CONTACTED') }, E2] : [E1, E2])),
    });
    app('/enquiries?view=board', manager);
    await startDrag('ENQ-000001');
    await waitFor(() => expect(screen.getByTestId('col-CONTACTED').className).toContain('is-droppable'));
    drop('CONTACTED');
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].body).toEqual({ from: 'NEW', to: 'CONTACTED' });
    await waitFor(() => expect(within(screen.getByTestId('col-CONTACTED')).getByText('Raj Kumar')).toBeTruthy());
    expect(within(screen.getByTestId('col-NEW')).queryByText('Raj Kumar')).toBeNull();
  });

  it('an invalid drop never reaches the server and explains why', async () => {
    const calls = mockApi();
    app('/enquiries?view=board', manager);
    await startDrag('ENQ-000001'); // NEW: only CONTACTED / LOST are valid
    await waitFor(() => expect(screen.getByTestId('col-CONTACTED').className).toContain('is-droppable'));
    expect(screen.getByTestId('col-INTERESTED').className).toContain('is-blocked');
    drop('INTERESTED');
    expect(await screen.findByText(/cannot be moved from Fresh to Warm/)).toBeTruthy();
    expect(posts(calls)).toHaveLength(0);
    expect(within(screen.getByTestId('col-NEW')).getByText('Raj Kumar')).toBeTruthy();
  });

  it('dropping on a domain-owned stage explains which action owns it and sends nothing', async () => {
    const calls = mockApi();
    app('/enquiries?view=board', manager);
    await startDrag('ENQ-000002');
    await waitFor(() => expect(screen.getByTestId('col-SITE_VISIT_SCHEDULED').className).toContain('is-domain'));
    drop('SITE_VISIT_SCHEDULED');
    expect(await screen.findByText(/set by scheduling a site visit/)).toBeTruthy();
    expect(posts(calls)).toHaveLength(0);
  });

  it('a backward move opens a reason dialog; it cannot be sent without a reason, and the reason is submitted', async () => {
    const calls = mockApi({ 'POST /enquiries/e2/transition': ok({ ...E2, stageCode: 'CONTACTED' }) });
    app('/enquiries?view=board', manager);
    await startDrag('ENQ-000002');
    await waitFor(() => expect(screen.getByTestId('col-CONTACTED').className).toContain('is-droppable'));
    drop('CONTACTED');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Move ENQ-000002 back to Reached out')).toBeTruthy();
    const send = within(dialog).getByRole('button', { name: 'Move back' });
    expect(send.disabled).toBe(true);
    expect(posts(calls)).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: 'Customer re-shortlisting' } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].body).toEqual({ from: 'INTERESTED', to: 'CONTACTED', reason: 'Customer re-shortlisting' });
  });

  it('marking lost requires a Lost Reason from the master list, then calls the lose operation', async () => {
    const calls = mockApi({ 'POST /enquiries/e1/lose': ok({ ...E1, stageCode: 'LOST' }) });
    app('/enquiries?view=board', manager);
    await startDrag('ENQ-000001');
    await waitFor(() => expect(screen.getByTestId('col-LOST').className).toContain('is-droppable'));
    drop('LOST');
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Mark lost' });
    expect(submit.disabled).toBe(true);
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Budget too low' })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText(/Why was it lost/), { target: { value: 'lr1' } });
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: 'Bought elsewhere' } });
    fireEvent.click(submit);
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]).toMatchObject({ key: 'POST /enquiries/e1/lose', body: { from: 'NEW', lostReasonId: 'lr1', note: 'Bought elsewhere' } });
  });

  it('a server refusal leaves the card where it was, shows the server\'s message, and nothing is moved optimistically', async () => {
    let release;
    const calls = mockApi({ 'POST /enquiries/e1/transition': () => new Promise((r) => { release = () => r(fail(409, 'STAGE_CHANGED', 'The enquiry was moved by someone else. Refresh and try again.')); }) });
    app('/enquiries?view=board', manager);
    await startDrag('ENQ-000001');
    await waitFor(() => expect(screen.getByTestId('col-CONTACTED').className).toContain('is-droppable'));
    drop('CONTACTED');
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    // while the request is in flight the card is merely marked busy — it has not moved
    expect(screen.getByTestId('card-ENQ-000001').getAttribute('aria-busy')).toBe('true');
    expect(within(screen.getByTestId('col-NEW')).getByText('Raj Kumar')).toBeTruthy();
    expect(within(screen.getByTestId('col-CONTACTED')).queryByText('Raj Kumar')).toBeNull();
    release();
    expect(await screen.findByText(/moved by someone else/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('card-ENQ-000001').getAttribute('aria-busy')).toBe('false'));
    expect(within(screen.getByTestId('col-NEW')).getByText('Raj Kumar')).toBeTruthy();
    expect(within(screen.getByTestId('col-CONTACTED')).queryByText('Raj Kumar')).toBeNull();
  });

  it('a reason dialog stays open with the server error when the server refuses', async () => {
    mockApi({ 'POST /enquiries/e2/transition': fail(403, 'FORBIDDEN', 'Missing permission to move an enquiry backward: enquiries.revert') });
    app('/enquiries?view=board', manager);
    await startDrag('ENQ-000002');
    await waitFor(() => expect(screen.getByTestId('col-NEW').className).toContain('is-droppable'));
    drop('NEW');
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: 'because' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move back' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).getByRole('alert').textContent).toMatch(/enquiries\.revert/);
  });

  it('the card menu is a keyboard/touch alternative built from the same backend metadata', async () => {
    const calls = mockApi({ 'POST /enquiries/e2/transition': ok(E2) });
    app('/enquiries?view=board', manager);
    await screen.findByTestId('card-ENQ-000002');
    fireEvent.click(within(screen.getByTestId('card-ENQ-000002')).getByRole('button', { name: 'Actions for ENQ-000002' }));
    fireEvent.click(screen.getByText('Move to…'));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('Reached out')).toBeTruthy());
    const visit = within(dialog).getByText('Visit booked').closest('button');
    expect(visit.disabled).toBe(true); // owned by its own action
    expect(within(dialog).getByText('Set by its own action')).toBeTruthy();
    fireEvent.click(within(dialog).getByText('Reached out').closest('button'));
    expect(await screen.findByText('Move ENQ-000002 back to Reached out')).toBeTruthy(); // backward -> reason first
    expect(posts(calls)).toHaveLength(0);
  });

  it('a user with no valid moves can still open cards but every drop is refused client-side', async () => {
    const calls = mockApi({ 'GET /workflow/transitions': ok([]) });
    app('/enquiries?view=board', viewer);
    await startDrag('ENQ-000001');
    await waitFor(() => expect(screen.getByTestId('col-CONTACTED').className).toContain('is-blocked'));
    drop('CONTACTED');
    expect(await screen.findByText(/cannot be moved/)).toBeTruthy();
    expect(posts(calls)).toHaveLength(0);
  });

  it('shows how many more cards a column has beyond the page it loaded', async () => {
    const data = boardOf([E1]);
    data.stages[0].count = 31;
    mockApi({ 'GET /enquiries/board': ok(data) });
    app('/enquiries?view=board', manager);
    expect(await screen.findByText('30 more — view in list')).toBeTruthy();
  });
});

describe('Enquiry list', () => {
  it('shows the required columns from server data, with historical inactive values', async () => {
    mockApi();
    app('/enquiries', manager);
    expect(await screen.findByText('Raj Kumar')).toBeTruthy();
    for (const h of ['Enquiry ID', 'Person', 'Phone', 'Source', 'Type', 'Property type', 'Location', 'Assigned to', 'Status', 'Next follow-up', 'Created']) expect(screen.getByRole('columnheader', { name: new RegExp(h) })).toBeTruthy();
    expect(screen.getByText('ENQ-000001')).toBeTruthy();
    expect(screen.getAllByText('Fresh').length).toBeGreaterThan(0); // stage label comes from the workflow config
    expect(screen.getAllByText('Anna Nagar').length).toBeGreaterThan(0);
  });

  it('sends search, filters, sort and paging to the server; filter options come from masters and the workflow', async () => {
    const calls = mockApi();
    app('/enquiries?page=2&search=raj&stage=NEW&sourceId=s1&from=2026-01-01', manager);
    await screen.findByText('Raj Kumar');
    const req = calls.find((c) => c.key === 'GET /enquiries');
    for (const part of ['page=2', 'search=raj', 'stage=NEW', 'sourceId=s1', 'from=2026-01-01']) expect(req.path).toContain(part);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Warm' })).toBeTruthy()); // a workflow stage as a filter option
    expect(screen.getByRole('option', { name: 'Website' })).toBeTruthy(); // a master as a filter option
  });

  it('toggling to the board is a URL change and uses the board endpoint with the same filters', async () => {
    const calls = mockApi();
    app('/enquiries?sourceId=s1', manager);
    await screen.findByText('Raj Kumar');
    fireEvent.click(screen.getByRole('tab', { name: 'Board' }));
    await screen.findByTestId('card-ENQ-000001');
    expect(calls.find((c) => c.key === 'GET /enquiries/board').path).toContain('sourceId=s1');
    expect(calls.find((c) => c.key === 'GET /enquiries/board').path).not.toContain('view=');
  });

  it('actions respect permissions: viewers get no create/export/assign/archive', async () => {
    mockApi();
    const { unmount } = app('/enquiries', viewer);
    await screen.findByText('Raj Kumar');
    expect(screen.queryByRole('button', { name: 'New enquiry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    expect(screen.queryByText('Assign')).toBeNull();
    expect(screen.queryByText('Reassign')).toBeNull();
    expect(screen.queryByText('Archive')).toBeNull();
    unmount();
    app('/enquiries', manager);
    await screen.findByText('Raj Kumar');
    expect(screen.getByRole('button', { name: 'New enquiry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
  });

  it('archiving asks for confirmation first', async () => {
    const calls = mockApi({ 'DELETE /enquiries/e1': { ok: true, status: 204, json: async () => ({}) } });
    app('/enquiries', manager);
    await screen.findByText('Raj Kumar');
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    fireEvent.click(screen.getByText('Archive'));
    expect(await screen.findByText(/history is kept/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'DELETE /enquiries/e1')).toBe(true));
  });

  it('empty and error states', async () => {
    mockApi({ 'GET /enquiries': ok([], { page: 1, limit: 25, total: 0 }) });
    const { unmount } = app('/enquiries', manager);
    expect(await screen.findByText('No enquiries yet')).toBeTruthy();
    unmount();
    mockApi({ 'GET /enquiries': fail(500, 'INTERNAL_ERROR', 'boom') });
    app('/enquiries', manager);
    expect(await screen.findByText('Could not load data')).toBeTruthy();
  });
});

describe('New enquiry', () => {
  it('creates an enquiry for a new person with master picks, posting only ids and the person details', async () => {
    const calls = mockApi({ 'POST /enquiries': ok({ ...E1, id: 'e9' }), 'GET /enquiries/e9': ok({ ...E1, id: 'e9', person: null, assignments: [], stageHistory: [], transitions: [] }), 'POST /persons/lookup': ok({ status: 'NONE', phoneE164: '+919876543210' }) });
    app('/enquiries', manager);
    await screen.findByText('Raj Kumar');
    fireEvent.click(screen.getByRole('button', { name: 'New enquiry' }));
    fireEvent.change(await screen.findByLabelText(/^Phone/), { target: { value: '98765 43210' } });
    fireEvent.blur(screen.getByLabelText(/^Phone/));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Raj Kumar' } });
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getAllByRole('option', { name: 'Website' }).length).toBeGreaterThan(0));
    fireEvent.change(within(dialog).getByLabelText(/^Source/), { target: { value: 's1' } });
    fireEvent.change(within(dialog).getByLabelText('Preferred location'), { target: { value: 'l1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create enquiry' }));
    await waitFor(() => expect(posts(calls).some((c) => c.key === 'POST /enquiries')).toBe(true));
    expect(calls.find((c) => c.key === 'POST /enquiries').body).toEqual({ person: { name: 'Raj Kumar', phone: '98765 43210' }, sourceId: 's1', locationId: 'l1' });
  });

  it('Source is required: the form refuses to submit without one (nothing is sent), other masters stay optional', async () => {
    const calls = mockApi({ 'POST /persons/lookup': ok({ status: 'NONE', phoneE164: '+919876543210' }) });
    app('/enquiries', manager);
    await screen.findByText('Raj Kumar');
    fireEvent.click(screen.getByRole('button', { name: 'New enquiry' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(await within(dialog).findByLabelText(/^Phone/), { target: { value: '9876543210' } });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Raj Kumar' } });
    expect(within(dialog).getByText('Source').parentElement.textContent).toContain('*'); // marked required
    for (const optional of ['Enquiry type', 'Property type', 'Building type']) expect(within(dialog).getByText(optional).parentElement.textContent).not.toContain('*');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create enquiry' }));
    expect(await within(dialog).findByText('Choose a source')).toBeTruthy();
    expect(posts(calls)).toHaveLength(0);
  });

  it('the server\'s Source error is shown on the Source field', async () => {
    mockApi({ 'POST /persons/lookup': ok({ status: 'NONE', phoneE164: '+919876543210' }), 'POST /enquiries': { ok: false, status: 400, json: async () => ({ error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: [{ path: 'sourceId', message: 'Choose an available option' }] } }) } });
    app('/enquiries', manager);
    await screen.findByText('Raj Kumar');
    fireEvent.click(screen.getByRole('button', { name: 'New enquiry' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(await within(dialog).findByLabelText(/^Phone/), { target: { value: '9876543210' } });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Raj Kumar' } });
    await waitFor(() => expect(within(dialog).getAllByRole('option', { name: 'Website' }).length).toBeGreaterThan(0));
    fireEvent.change(within(dialog).getByLabelText(/^Source/), { target: { value: 's1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create enquiry' }));
    expect(await within(dialog).findByText('Choose an available option')).toBeTruthy();
  });

  it('uses the same duplicate-aware person flow as clients: an existing person is shown and must be chosen explicitly', async () => {
    const person = { id: 'p7', name: 'Existing Esha', phone: '+91 98765 43210' };
    const calls = mockApi({ 'POST /persons/lookup': ok({ status: 'VISIBLE_MATCH', phoneE164: '+919876543210', person, clients: [] }), 'POST /enquiries': ok({ ...E1, id: 'e9' }), 'GET /enquiries/e9': ok({ ...E1, id: 'e9', assignments: [], stageHistory: [], transitions: [] }) });
    app('/enquiries', manager);
    await screen.findByText('Raj Kumar');
    fireEvent.click(screen.getByRole('button', { name: 'New enquiry' }));
    fireEvent.change(await screen.findByLabelText(/^Phone/), { target: { value: '9876543210' } });
    fireEvent.blur(screen.getByLabelText(/^Phone/));
    expect(await screen.findByText('This person already exists')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use this person' }));
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getAllByRole('option', { name: 'Website' }).length).toBeGreaterThan(0));
    fireEvent.change(within(dialog).getByLabelText(/^Source/), { target: { value: 's1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create enquiry' }));
    await waitFor(() => expect(calls.find((c) => c.key === 'POST /enquiries')?.body).toEqual({ personId: 'p7', sourceId: 's1' }));
  });

  it('OWN-scope users do not get an owner picker (the server assigns them)', async () => {
    mockApi();
    app('/enquiries', session(['enquiries.view', 'enquiries.create'], { dataScope: 'OWN', branchIds: ['b1'] }));
    await screen.findByText('Raj Kumar');
    fireEvent.click(screen.getByRole('button', { name: 'New enquiry' }));
    await screen.findByLabelText(/^Phone/);
    expect(screen.queryByLabelText('Assigned to')).toBeNull();
  });
});

describe('Enquiry detail', () => {
  const DETAIL = {
    ...E2, notes: 'Wants a 3BHK', sourceId: 's1', propertyType: { label: 'Villa', isActive: true }, buildingType: { label: 'Independent', isActive: false },
    unitInterests: [], person: { id: 'p-e2', name: 'Bhavna Rao', phone: '+91 98765 43210', email: 'b@x.com', address: '1 Main Rd' }, transitions: TRANSITIONS.INTERESTED,
    assignments: [{ id: 'as1', toName: 'Asha', byName: 'Meera', reason: undefined, at: '2026-01-05T10:00:00Z' }, { id: 'as2', fromName: 'Asha', toName: 'Vikram', byName: 'Meera', reason: 'Asha on leave', at: '2026-01-06T10:00:00Z' }],
    stageHistory: [{ id: 'h1', toLabel: 'Fresh', direction: 'CREATE', at: '2026-01-05T10:00:00Z', byName: 'Meera' }, { id: 'h2', fromLabel: 'Fresh', toLabel: 'Reached out', direction: 'FORWARD', at: '2026-01-06T10:00:00Z', byName: 'Meera' }, { id: 'h3', fromLabel: 'Reached out', toLabel: 'Warm', direction: 'BACKWARD', reason: 'Customer asked to wait', at: '2026-01-07T10:00:00Z', byName: 'Meera' }],
  };

  it('shows enquiry, person, assignment history, stage history, interested units, timeline and audit', async () => {
    mockApi({ 'GET /enquiries/e2': ok(DETAIL) });
    app('/enquiries/e2', manager);
    expect(await screen.findByRole('heading', { name: /Bhavna Rao/ })).toBeTruthy();
    expect(screen.getAllByText('Warm').length).toBeGreaterThan(0);
    expect(screen.getByText('Wants a 3BHK')).toBeTruthy();
    expect(screen.getByText('b@x.com')).toBeTruthy();
    // Property type / building type are deliberately not asserted here: the Interested property card
    // was removed from this page (a UI-only change — the fields are still returned by the API and are
    // still shown in the enquiry form and list).
    // Person moved into the Enquiry card as a subheading rather than a card of its own, so it is
    // asserted by heading here and by its presence inside that card.
    expect(screen.getByRole('heading', { name: 'Person', level: 4 })).toBeTruthy();
    expect(within(screen.getByRole('heading', { name: 'Enquiry', level: 3 }).closest('.detail-card')).getByText('b@x.com')).toBeTruthy();
    const assignments = within(screen.getByLabelText('Assignment history'));
    expect(assignments.getByText(/Asha on leave/)).toBeTruthy();
    expect(assignments.getAllByRole('listitem')).toHaveLength(2);
    const history = within(screen.getByLabelText('Stage history'));
    expect(history.getByText(/Customer asked to wait/)).toBeTruthy();
    expect(history.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('No units yet')).toBeTruthy(); // the unified Units section, empty only because the server returned none
    expect(await screen.findByText('Enquiry ENQ-000001 created for Raj Kumar')).toBeTruthy();
    expect(await screen.findByText('create')).toBeTruthy(); // audit entry for authorised readers
  });

  it('hides actions the user cannot use and the timeline/audit without their permissions', async () => {
    const calls = mockApi({ 'GET /enquiries/e2': ok({ ...DETAIL, transitions: [] }) });
    app('/enquiries/e2', viewer);
    await screen.findByRole('heading', { name: /Bhavna Rao/ });
    for (const b of ['Change status…', 'Assign', 'Reassign', 'Edit']) expect(screen.queryByRole('button', { name: b })).toBeNull();
    expect(screen.queryByText('Activity')).toBeNull();
    expect(screen.queryByText('Audit history')).toBeNull();
    expect(calls.some((c) => c.key === 'GET /activities' || c.key === 'GET /audit')).toBe(false);
  });

  it('"Change status…" offers exactly the backend\'s moves; "Reopen…" is shown for a lost enquiry', async () => {
    mockApi({ 'GET /enquiries/e2': ok(DETAIL) });
    const { unmount } = app('/enquiries/e2', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Change status…' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('Reached out')).toBeTruthy());
    expect(within(dialog).getAllByRole('button').filter((b) => b.className.includes('move-item'))).toHaveLength(4);
    unmount();
    mockApi({ 'GET /enquiries/e2': ok({ ...DETAIL, stageCode: 'LOST', stage: stageObj('LOST'), lostReason: { label: 'Budget too low', isActive: true }, transitions: TRANSITIONS.LOST }) });
    app('/enquiries/e2', manager);
    expect(await screen.findByRole('button', { name: 'Reopen…' })).toBeTruthy();
    expect(screen.getByText('Budget too low')).toBeTruthy();
  });

  it('reassigning requires a reason and posts the new owner', async () => {
    const calls = mockApi({ 'GET /enquiries/e2': ok(DETAIL), 'POST /enquiries/e2/assign': ok(DETAIL) });
    app('/enquiries/e2', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Reassign' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Vikram' })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText(/^Assign to/), { target: { value: 'u2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Give a reason for reassigning')).toBeTruthy();
    expect(posts(calls)).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: 'Rebalancing' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(posts(calls)[0]?.body).toEqual({ assignedTo: 'u2', reason: 'Rebalancing' }));
  });

  it('an existing enquiry\'s source can be changed but not cleared', async () => {
    const calls = mockApi({ 'GET /enquiries/e2': ok({ ...DETAIL, sourceId: 's1' }), 'PATCH /enquiries/e2': ok(DETAIL) });
    app('/enquiries/e2', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getAllByRole('option', { name: 'Website' }).length).toBeGreaterThan(0));
    fireEvent.change(within(dialog).getByLabelText(/^Source/), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('An enquiry must keep a source')).toBeTruthy();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('a server error while editing is shown, not swallowed', async () => {
    mockApi({ 'GET /enquiries/e2': ok(DETAIL), 'PATCH /enquiries/e2': fail(400, 'VALIDATION_ERROR', 'Invalid location') });
    app('/enquiries/e2', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByLabelText('Notes'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Invalid location')).toBeTruthy();
  });

  it('an enquiry the server will not show (other branch / not yours) is just not found', async () => {
    mockApi({ 'GET /enquiries/e2': fail(404, 'NOT_FOUND', 'Enquiry not found') });
    app('/enquiries/e2', manager);
    expect(await screen.findByText('Enquiry not found')).toBeTruthy();
  });
});
