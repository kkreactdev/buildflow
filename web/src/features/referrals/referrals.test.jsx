import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../app/App';
import { renderWithApp, session } from '../../test/render';
import { EnquiryReferralCard } from './EnquiryReferralCard';
import { MakeReferrerButton } from './MakeReferrerButton';
import { ReferralsRoutes } from './ReferralsRoutes';

const ok = (data, meta) => ({ ok: true, status: 200, json: async () => ({ data, ...(meta ? { meta } : {}) }) });
const noContent = { ok: true, status: 204, json: async () => ({}) };
const fail = (status, code, message, details) => ({ ok: false, status, json: async () => ({ error: { code, message, details } }) });
const ALLOWED = { edit: true, assign: true, link: true, archive: true };
const NONE = { edit: false, assign: false, link: false, archive: false };

const ref = (id, no, over = {}) => ({
  id, referralNo: no, branchId: 'b1', branch: { name: 'Chennai', code: 'CHN' }, personId: 'p1', name: 'Ravi Referrer', phone: '+91 98765 43210', phoneE164: '+919876543210',
  typeId: 't3', type: { label: 'External', isActive: true }, assignedTo: 'u1', assignedToName: 'Asha', enquiryCount: 1, reason: 'Friend of the family', notes: 'Met at the expo',
  isArchived: false, createdAt: '2026-01-05T10:00:00Z', allowed: ALLOWED, ...over,
});
const R1 = ref('r1', 'REF-000001');
const R2 = ref('r2', 'REF-000002', { name: 'Chitra Client', type: { label: 'Client', isActive: true }, assignedTo: undefined, assignedToName: undefined, enquiryCount: 0, allowed: { ...NONE, archive: true } });
const DETAIL = {
  ...R1, person: { id: 'p1', name: 'Ravi Referrer', phone: '+91 98765 43210', email: 'ravi@x.com', address: '5 Main Road' },
  sourceClient: { id: 'c1', clientNo: 'CL-000001' }, sourceEmployee: undefined,
  enquiries: [{ id: 'e1', enquiryNo: 'ENQ-000001', name: 'Esha Rao', stageCode: 'NEW', stageLabel: 'New', isArchived: false }],
  assignments: [{ id: 'a1', to: 'u1', toName: 'Asha', by: 'u0', byName: 'Mgr', at: '2026-01-06T10:00:00Z' }, { id: 'a2', from: 'u1', fromName: 'Asha', to: 'u2', toName: 'Vikram', by: 'u0', byName: 'Mgr', reason: 'Workload', at: '2026-01-07T10:00:00Z' }],
};

function mockApi(routes = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace('/api/v1', '');
    const key = `${method} ${path.split('?')[0]}`;
    calls.push({ method, path, key, body: init.body ? JSON.parse(init.body) : undefined });
    if (routes[key]) return typeof routes[key] === 'function' ? routes[key](path, init) : routes[key];
    if (key === 'GET /referrals') return ok([R1, R2], { page: 1, limit: 25, total: 2 });
    if (key === 'GET /referrals/r1') return ok(DETAIL);
    if (key === 'GET /masters') return ok({ REFERRAL_TYPE: [{ _id: 't1', code: 'CLIENT', label: 'Client', isActive: true }, { _id: 't2', code: 'EMPLOYEE', label: 'Employee', isActive: true }, { _id: 't3', code: 'EXTERNAL', label: 'External', isActive: true }] });
    if (key === 'GET /users') return ok([{ id: 'u1', name: 'Asha', email: 'asha@x.com' }, { id: 'u2', name: 'Vikram', email: 'v@x.com' }], { page: 1, limit: 100, total: 2 });
    if (key === 'GET /branches') return ok([{ _id: 'b1', name: 'Chennai', isActive: true }, { _id: 'b2', name: 'Madurai', isActive: true }], { page: 1, limit: 100, total: 2 });
    if (key === 'GET /clients') return ok([{ id: 'c1', clientNo: 'CL-000001', name: 'Chitra Client', phone: '+91 91234 56789' }], { page: 1, limit: 8, total: 1 });
    if (key === 'GET /enquiries') return ok([{ id: 'e1', enquiryNo: 'ENQ-000001', name: 'Esha Rao', branchId: 'b1', stage: { label: 'New' } }], { page: 1, limit: 8, total: 1 });
    if (key === 'POST /persons/lookup') return ok({ status: 'NONE', phoneE164: '+919000000000' });
    if (key === 'GET /activities') return ok([{ _id: 'ac1', type: 'REFERRAL_CREATED', description: 'Ravi Referrer added as referral REF-000001 as an external referrer', at: '2026-01-05T10:00:00Z' }], { page: 1, limit: 50, total: 1 });
    if (key === 'GET /audit') return ok([{ id: 'au1', action: 'create_external', at: '2026-01-05T10:00:00Z' }], { page: 1, limit: 50, total: 1 });
    throw new Error(`unmocked ${key}`);
  }));
  return calls;
}
const wrap = (ui) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const app = (route, s) => renderWithApp(wrap(<Routes><Route path="/referrals/*" element={<ReferralsRoutes />} /><Route path="/enquiries/:id" element={<div>ENQUIRY PAGE</div>} /></Routes>), { session: s, route });
const manager = session(['referrals.view', 'referrals.create', 'referrals.edit', 'referrals.assign', 'referrals.archive', 'persons.lookup', 'users.view', 'enquiries.view', 'activities.view', 'audit.view'], { dataScope: 'BRANCH', branchIds: ['b1'] });
const executive = session(['referrals.view', 'referrals.create', 'persons.lookup'], { dataScope: 'OWN', branchIds: ['b1'] });
const multi = session(['referrals.view', 'referrals.create', 'users.view', 'persons.lookup'], { dataScope: 'ALL', branchIds: [] });
const writes = (calls) => calls.filter((c) => c.method !== 'GET' && c.key !== 'POST /persons/lookup');
afterEach(() => vi.unstubAllGlobals());

describe('Referrals list', () => {
  it('shows referrals with master type labels, assignee and enquiry count', async () => {
    mockApi();
    app('/referrals', manager);
    expect(await screen.findByText('REF-000001')).toBeTruthy();
    expect(screen.getByText('External', { selector: '.pill' })).toBeTruthy();
    expect(screen.getByText('Client', { selector: '.pill' })).toBeTruthy();
    expect(screen.getAllByText('Unassigned').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Referrals' })).toBeTruthy();
  });

  it('search, type, assignee, dates, sort and paging go to the server; type options come from the master; Branch only for multi-branch', async () => {
    const calls = mockApi();
    const { unmount } = app('/referrals?search=ravi&typeId=t2&assignedTo=u2&from=2026-01-01&to=2026-02-01&sort=referralNo&page=2', manager);
    await screen.findByText('REF-000001');
    const req = calls.find((c) => c.key === 'GET /referrals');
    for (const part of ['search=ravi', 'typeId=t2', 'assignedTo=u2', 'from=2026-01-01', 'to=2026-02-01', 'sort=referralNo', 'page=2']) expect(req.path).toContain(part);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Employee' })).toBeTruthy());
    expect(screen.queryByLabelText('Branch')).toBeNull();
    unmount();
    app('/referrals', multi);
    await screen.findByText('REF-000001');
    expect(screen.getByLabelText('Branch')).toBeTruthy();
  });

  it('row actions follow the server flags; New referral needs referrals.create; archiving asks first', async () => {
    const calls = mockApi({ 'DELETE /referrals/r1': noContent });
    const { unmount } = app('/referrals', manager);
    await screen.findByText('REF-000001');
    const menus = screen.getAllByRole('button', { name: 'Actions' });
    fireEvent.click(menus[0]);
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open', 'Reassign', 'Archive']);
    fireEvent.click(menus[0]);
    fireEvent.click(menus[1]);
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open', 'Archive']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog');
    expect(writes(calls)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(writes(calls)[0]?.key).toBe('DELETE /referrals/r2'));
    unmount();
    mockApi({ 'GET /referrals': ok([R1], { page: 1, limit: 25, total: 1 }) });
    app('/referrals', session(['referrals.view'], { dataScope: 'OWN', branchIds: ['b1'] }));
    await screen.findByText('REF-000001');
    expect(screen.queryByRole('button', { name: 'New referral' })).toBeNull();
  });

  it('empty and error states are explicit', async () => {
    mockApi({ 'GET /referrals': ok([], { page: 1, limit: 25, total: 0 }) });
    const { unmount } = app('/referrals', manager);
    expect(await screen.findByText('No referrals yet')).toBeTruthy();
    unmount();
    mockApi({ 'GET /referrals': fail(500, 'INTERNAL_ERROR', 'boom') });
    app('/referrals', manager);
    expect((await screen.findAllByText(/boom|Could not load/)).length).toBeGreaterThan(0);
  });
});

describe('creating a referral: three clearly different ways', () => {
  async function open(s = manager, routes = {}) {
    const calls = mockApi({ 'POST /referrals': ok(R1), 'POST /referrals/from-client/c1': ok(R2), 'POST /referrals/from-user/u2': ok(R1), 'GET /referrals/r1': ok(DETAIL), 'GET /referrals/r2': ok(DETAIL), ...routes });
    app('/referrals', s);
    fireEvent.click(await screen.findByRole('button', { name: 'New referral' }));
    return { calls, dialog: await screen.findByRole('dialog') };
  }

  it('offers the three ways as separate choices, External by default', async () => {
    const { dialog } = await open();
    const group = within(within(dialog).getByRole('group', { name: /Where does the referrer come from/ }));
    expect(group.getAllByRole('button').map((b) => b.textContent)).toEqual(['From an existing clientNothing to retype', 'From an existing employeeUses their name and phone', 'External personSomeone new to us']);
    expect(group.getByRole('button', { name: /External person/ }).getAttribute('aria-pressed')).toBe('true');
    expect(within(dialog).getByLabelText(/Phone/)).toBeTruthy(); // the external form asks for the person
    fireEvent.click(group.getByRole('button', { name: /From an existing client/ }));
    expect(within(dialog).queryByLabelText(/Phone/)).toBeNull(); // nothing to retype for a client
  });

  it('external: a new person is sent as details (one entry, with the duplicate check), never a type', async () => {
    const { calls, dialog } = await open();
    fireEvent.change(within(dialog).getByLabelText(/Phone/), { target: { value: '9000000000' } });
    fireEvent.blur(within(dialog).getByLabelText(/Phone/));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /persons/lookup')).toBe(true));
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Ravi Referrer' } });
    fireEvent.change(within(dialog).getByLabelText(/Relationship/), { target: { value: 'Friend of the family' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create referral' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'POST /referrals', body: { person: { name: 'Ravi Referrer', phone: '9000000000' }, reason: 'Friend of the family' } });
    expect(Object.keys(writes(calls)[0].body)).not.toContain('typeId');
    expect(await screen.findByRole('heading', { name: /Ravi Referrer/ })).toBeTruthy(); // opened the new referral
  });

  it('external: an existing visible person is shown and must be chosen explicitly; a hidden match reveals existence only', async () => {
    const visible = { status: 'VISIBLE_MATCH', phoneE164: '+919000000000', person: { id: 'p9', name: 'Known Person', phone: '+91 90000 00000' }, clients: [{ id: 'c9', clientNo: 'CL-000009', branchId: 'b1' }] };
    const { calls, dialog } = await open(manager, { 'POST /persons/lookup': ok(visible) });
    fireEvent.change(within(dialog).getByLabelText(/Phone/), { target: { value: '9000000000' } });
    fireEvent.blur(within(dialog).getByLabelText(/Phone/));
    expect(await within(dialog).findByText('This person already exists')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use this person' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create referral' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0].body).toMatchObject({ personId: 'p9' });
    expect(Object.keys(writes(calls)[0].body)).not.toContain('person');
  });

  it('external: a phone that exists only elsewhere shows no details of that person', async () => {
    const { dialog } = await open(manager, { 'POST /persons/lookup': ok({ status: 'HIDDEN_MATCH', phoneE164: '+919000000000', canLink: false }) });
    fireEvent.change(within(dialog).getByLabelText(/Phone/), { target: { value: '9000000000' } });
    fireEvent.blur(within(dialog).getByLabelText(/Phone/));
    expect(await within(dialog).findByText(/registered with another branch/i)).toBeTruthy();
    expect(within(dialog).queryByText(/Known Person|Secret/)).toBeNull();
  });

  it('external: the server\'s duplicate answer (a race) is shown as a match, not a crash', async () => {
    const match = { status: 'VISIBLE_MATCH', phoneE164: '+919000000000', person: { id: 'p9', name: 'Racing Person', phone: '+91 90000 00000' } };
    const { dialog } = await open(manager, { 'POST /referrals': fail(409, 'PERSON_EXISTS', 'A person with this phone number already exists. Use the existing record.', match) });
    fireEvent.change(within(dialog).getByLabelText(/Phone/), { target: { value: '9000000000' } });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Racing Person' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create referral' }));
    expect(await within(dialog).findByText('This person already exists')).toBeTruthy();
  });

  it('client: picked by server search, nothing retyped, posts only the optional reason / notes', async () => {
    const { calls, dialog } = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: /From an existing client/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create referral' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/Choose the client/);
    expect(writes(calls)).toHaveLength(0);
    fireEvent.change(within(dialog).getByPlaceholderText(/Search client/), { target: { value: 'chitra' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /CL-000001 Chitra Client/ }));
    expect(calls.some((c) => c.key === 'GET /clients' && c.path.includes('search=chitra'))).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Notes'), { target: { value: 'Knows many builders' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create referral' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'POST /referrals/from-client/c1', body: { notes: 'Knows many builders' } });
    expect(Object.keys(writes(calls)[0].body).sort()).toEqual(['notes']);
  });

  it('client: the server\'s "already a referral" answer is shown in the dialog', async () => {
    const { dialog } = await open(manager, { 'POST /referrals/from-client/c1': fail(409, 'REFERRAL_EXISTS', 'This person is already a referral of this branch (REF-000007)', { referralNo: 'REF-000007' }) });
    fireEvent.click(within(dialog).getByRole('button', { name: /From an existing client/ }));
    fireEvent.change(within(dialog).getByPlaceholderText(/Search client/), { target: { value: 'chitra' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /CL-000001 Chitra Client/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create referral' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/already a referral of this branch \(REF-000007\)/);
  });

  it('employee: picked from the user list (needs users.view), posts to the employee endpoint', async () => {
    const { calls, dialog } = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: /From an existing employee/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create referral' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/Choose the employee/);
    fireEvent.change(within(dialog).getByPlaceholderText(/Search employee/), { target: { value: 'vik' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /Vikram/ }));
    expect(calls.some((c) => c.key === 'GET /users' && c.path.includes('search=vik'))).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create referral' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0].key).toBe('POST /referrals/from-user/u2');
  });

  it('employee: without permission to list employees the choice is explained, not offered', async () => {
    mockApi();
    app('/referrals', session(['referrals.view', 'referrals.create'], { dataScope: 'OWN', branchIds: ['b1'] }));
    fireEvent.click(await screen.findByRole('button', { name: 'New referral' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /From an existing employee/ }));
    expect(within(dialog).getByText(/need permission to view employees/)).toBeTruthy();
    expect(within(dialog).queryByPlaceholderText(/Search employee/)).toBeNull();
  });

  it('a multi-branch user must choose a branch for external and employee referrals, not for a client', async () => {
    const { calls, dialog } = await open(multi);
    fireEvent.change(within(dialog).getByLabelText(/Phone/), { target: { value: '9000000000' } });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Ravi Referrer' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create referral' }));
    expect(await within(dialog).findByText('Choose a branch')).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: /From an existing client/ }));
    expect(within(dialog).queryByLabelText(/^Branch/)).toBeNull(); // the client's own branch is used
  });

  it('"Make referrer" on a client opens the dialog already on that client', async () => {
    const calls = mockApi({ 'POST /referrals/from-client/c1': ok(R2), 'GET /referrals/r2': ok(DETAIL) });
    renderWithApp(wrap(<Routes><Route path="/referrals/:id" element={<div>REFERRAL PAGE</div>} /><Route path="*" element={<MakeReferrerButton client={{ id: 'c1', clientNo: 'CL-000001', name: 'Chitra Client' }} />} /></Routes>), { session: manager, route: '/x' });
    fireEvent.click(await screen.findByRole('button', { name: 'Make referrer' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/CL-000001 · Chitra Client/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create referral' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0].key).toBe('POST /referrals/from-client/c1');
    expect(await screen.findByText('REFERRAL PAGE')).toBeTruthy();
  });

  it('"Make referrer" is absent without referrals.create', async () => {
    mockApi();
    renderWithApp(wrap(<MakeReferrerButton client={{ id: 'c1', clientNo: 'CL-000001', name: 'X' }} />), { session: session(['referrals.view'], { dataScope: 'BRANCH', branchIds: ['b1'] }) });
    expect(screen.queryByRole('button', { name: 'Make referrer' })).toBeNull();
  });
});

describe('referral detail', () => {
  it('shows identity, type, source (linked), branch, assignee, enquiries, assignment history, timeline and audit', async () => {
    mockApi();
    app('/referrals/r1', manager);
    expect(await screen.findByRole('heading', { name: /Ravi Referrer/ })).toBeTruthy();
    expect(screen.getByText('ravi@x.com')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'CL-000001' }).getAttribute('href')).toBe('/clients/c1');
    expect(within(screen.getByLabelText('Referred enquiries')).getByRole('link', { name: 'ENQ-000001' }).getAttribute('href')).toBe('/enquiries/e1');
    expect(within(screen.getByLabelText('Assignment history')).getAllByRole('listitem')).toHaveLength(2);
    expect(await screen.findByText(/added as referral REF-000001/)).toBeTruthy();
    expect(await screen.findByText('create_external')).toBeTruthy();
  });

  it('without activity / audit permission they are not requested; archived or read-only referrals offer no actions', async () => {
    const calls = mockApi({ 'GET /referrals/r1': ok({ ...DETAIL, isArchived: true, allowed: NONE }) });
    app('/referrals/r1', executive);
    await screen.findByRole('heading', { name: /Ravi Referrer/ });
    expect(calls.some((c) => c.key === 'GET /activities' || c.key === 'GET /audit')).toBe(false);
    for (const name of ['Edit', 'Assign', 'Reassign', 'Link enquiry', 'Actions']) expect(screen.queryByRole('button', { name }), name).toBeNull();
  });

  it('reassigning needs a person and a reason and posts both', async () => {
    const calls = mockApi({ 'POST /referrals/r1/assign': ok(R1) });
    app('/referrals/r1', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Reassign' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Vikram' })).toBeTruthy());
    expect(within(dialog).queryByRole('option', { name: 'Asha' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Choose who looks after this referral')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Assign to/), { target: { value: 'u2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Give a reason for reassigning')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Workload' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'POST /referrals/r1/assign', body: { assignedTo: 'u2', reason: 'Workload' } });
  });

  it('linking an enquiry: picked by server search; the server\'s refusal is shown', async () => {
    const calls = mockApi({ 'POST /referrals/r1/enquiries': fail(409, 'ENQUIRY_ALREADY_REFERRED', 'This enquiry is already linked to another referral') });
    app('/referrals/r1', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Link enquiry' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Link enquiry' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/Choose the enquiry/);
    fireEvent.change(within(dialog).getByPlaceholderText(/Search enquiry/), { target: { value: 'esha' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /ENQ-000001 Esha Rao/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Link enquiry' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/already linked to another referral/);
    expect(writes(calls)[0]).toMatchObject({ key: 'POST /referrals/r1/enquiries', body: { enquiryId: 'e1' } });
  });

  it('unlinking needs a reason', async () => {
    const calls = mockApi({ 'POST /referrals/r1/enquiries/e1/unlink': ok(R1) });
    app('/referrals/r1', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unlink' }));
    expect(await within(dialog).findByText('Give a reason')).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Linked by mistake' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(writes(calls)[0]?.body).toEqual({ reason: 'Linked by mistake' }));
  });

  it('editing sends only the notes; archiving asks first and returns to the list', async () => {
    const calls = mockApi({ 'PATCH /referrals/r1': ok(R1), 'DELETE /referrals/r1': noContent });
    app('/referrals/r1', manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const d1 = await screen.findByRole('dialog');
    fireEvent.change(within(d1).getByLabelText('Notes'), { target: { value: 'Updated note' } });
    fireEvent.click(within(d1).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes(calls)[0]).toMatchObject({ key: 'PATCH /referrals/r1', body: { notes: 'Updated note' } }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    const d2 = await screen.findByRole('dialog');
    expect(writes(calls)).toHaveLength(1);
    fireEvent.click(within(d2).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(writes(calls)[1]?.key).toBe('DELETE /referrals/r1'));
    expect((await screen.findAllByRole('heading', { name: 'Referrals' })).length).toBeGreaterThan(0);
  });

  it('a missing or foreign referral shows not found', async () => {
    mockApi({ 'GET /referrals/r1': fail(404, 'NOT_FOUND', 'Referral not found') });
    app('/referrals/r1', manager);
    expect((await screen.findAllByText(/not found|Could not load/i)).length).toBeGreaterThan(0);
  });
});

describe('enquiry referral card', () => {
  const enq = { id: 'e1', enquiryNo: 'ENQ-000001', name: 'Esha Rao' };
  const card = (e, s, props = {}) => renderWithApp(wrap(<Routes><Route path="*" element={<EnquiryReferralCard enquiry={e} canLink {...props} />} /></Routes>), { session: s, route: '/x' });

  it('shows who referred the enquiry, linking to the referral', async () => {
    mockApi();
    card({ ...enq, referral: { id: 'r1', referralNo: 'REF-000001', name: 'Ravi Referrer' } }, manager);
    expect(screen.getByRole('link', { name: 'Ravi Referrer' }).getAttribute('href')).toBe('/referrals/r1');
    expect(screen.queryByRole('button', { name: 'Link referral' })).toBeNull();
  });

  it('offers Link referral (with referrals.edit), picks by server search and posts the link', async () => {
    const calls = mockApi({ 'POST /referrals/r1/enquiries': ok(R1) });
    card(enq, manager);
    expect(screen.getByText('Not referred')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Link referral' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText(/Search referral/), { target: { value: 'ravi' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /REF-000001 Ravi Referrer/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Link referral' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'POST /referrals/r1/enquiries', body: { enquiryId: 'e1' } });
  });

  it('is hidden for users who cannot view referrals (unless a referrer is recorded), and read-only without referrals.edit', async () => {
    mockApi();
    const { unmount } = card(enq, session([], { dataScope: 'OWN' }));
    expect(screen.queryByText('Referral')).toBeNull();
    unmount();
    card(enq, executive);
    expect(screen.getByText('Not referred')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Link referral' })).toBeNull();
  });
});

describe('navigation', () => {
  it('Referrals is a real page for referrals.view holders, and refused by URL otherwise', async () => {
    mockApi();
    const { unmount } = renderWithApp(wrap(<AppRoutes />), { session: manager, route: '/referrals' });
    expect((await screen.findAllByRole('heading', { name: 'Referrals' })).length).toBeGreaterThan(0);
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    unmount();
    renderWithApp(wrap(<AppRoutes />), { session: session(['dashboard.view']), route: '/referrals' });
    expect(await screen.findByText(/don't have access/i)).toBeTruthy();
  });
});
