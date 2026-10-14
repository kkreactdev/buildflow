import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../app/App';
import { renderWithApp, session } from '../../test/render';
import { DocumentsPanel } from './DocumentsPanel';
import { DocumentsRoutes } from './DocumentsRoutes';

const ok = (data, meta) => ({ ok: true, status: 200, json: async () => ({ data, ...(meta ? { meta } : {}) }) });
const noContent = { ok: true, status: 204, json: async () => ({}) };
const fail = (status, code, message, details) => ({ ok: false, status, json: async () => ({ error: { code, message, details } }) });
const ALLOWED = { download: true, edit: true, replace: true, archive: true };
const READONLY = { download: true, edit: false, replace: false, archive: false };
const WHEN = '2026-01-05T10:00:00Z';

const doc = (id, no, over = {}) => ({
  id, documentNo: no, branchId: 'b1', branch: { name: 'Chennai', code: 'CHN' }, entityType: 'client', entityTypeLabel: 'Client', entityId: 'c1', entityNo: 'CL-000001',
  documentTypeId: 't1', type: { label: 'ID proof', isActive: true }, name: 'Aadhaar front', notes: 'Original seen', versionCount: 1,
  file: { version: 1, originalName: 'aadhaar.pdf', mime: 'application/pdf', bytes: 2048, format: 'pdf', uploadedAt: WHEN, uploadedByName: 'Asha' },
  isArchived: false, createdAt: WHEN, allowed: ALLOWED, ...over,
});
const D1 = doc('d1', 'DOC-000001');
const D2 = doc('d2', 'DOC-000002', { name: 'Old agreement', type: { label: 'Agreement', isActive: false }, versionCount: 2, file: { version: 2, originalName: 'agreement-v2.pdf', mime: 'application/pdf', bytes: 3 * 1024 * 1024, format: 'pdf', uploadedAt: WHEN, uploadedByName: 'Vikram' }, allowed: READONLY });
const DETAIL = { ...D2, previousFiles: [{ version: 1, originalName: 'agreement-v1.pdf', mime: 'application/pdf', bytes: 1024, format: 'pdf', uploadedAt: WHEN, uploadedByName: 'Vikram', replacedAt: WHEN }] };

function bodyOf(init) {
  if (!init.body) return undefined;
  if (init.body instanceof FormData) return Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, v instanceof File ? { file: v.name, type: v.type, size: v.size } : v]));
  return JSON.parse(init.body);
}
const MASTERS = { DOCUMENT_TYPE: [{ _id: 't1', code: 'ID_PROOF', label: 'ID proof', isActive: true }, { _id: 't2', code: 'AGREEMENT', label: 'Agreement', isActive: true }] };

function mockApi(routes = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace('/api/v1', '');
    const key = `${method} ${path.split('?')[0]}`;
    calls.push({ method, path, key, body: bodyOf(init) });
    if (routes[key]) return typeof routes[key] === 'function' ? routes[key](path, init) : routes[key];
    if (key === 'GET /documents') return ok([D1, D2], { page: 1, limit: 25, total: 2 });
    if (key === 'GET /documents/d2') return ok(DETAIL);
    if (key === 'GET /documents/d1/url') return ok({ url: 'https://files.test/signed/d1.pdf?sig=abc', expiresAt: WHEN, fileName: 'aadhaar.pdf', mime: 'application/pdf', version: 1 });
    if (key === 'GET /documents/d2/url') return ok({ url: 'https://files.test/signed/d2.pdf?sig=def', expiresAt: WHEN, fileName: 'agreement-v1.pdf', mime: 'application/pdf', version: 1 });
    if (key === 'GET /documents/entity-types') return ok([{ type: 'client', label: 'Client' }, { type: 'enquiry', label: 'Enquiry' }, { type: 'unit', label: 'Unit' }]);
    if (key === 'GET /masters') return ok(MASTERS);
    if (key === 'GET /branches') return ok([{ _id: 'b1', name: 'Chennai', isActive: true }, { _id: 'b2', name: 'Madurai', isActive: true }], { page: 1, limit: 100, total: 2 });
    if (key === 'GET /activities') return ok([{ _id: 'a1', type: 'DOCUMENT_UPLOADED', description: 'Document DOC-000002 (Old agreement) added to client CL-000001', at: WHEN }], { page: 1, limit: 50, total: 1 });
    if (key === 'GET /audit') return ok([{ id: 'au1', action: 'upload', at: WHEN }], { page: 1, limit: 50, total: 1 });
    throw new Error(`unmocked ${key}`);
  }));
  return calls;
}
const wrap = (ui) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const app = (route, s) => renderWithApp(wrap(<Routes><Route path="/documents/*" element={<DocumentsRoutes />} /></Routes>), { session: s, route });
const panel = (s, props = {}) => renderWithApp(wrap(<Routes><Route path="*" element={<DocumentsPanel entityType="client" entityId="c1" {...props} />} /></Routes>), { session: s, route: '/x' });
const manager = session(['documents.view', 'documents.upload', 'documents.edit', 'documents.archive', 'activities.view', 'audit.view'], { dataScope: 'BRANCH', branchIds: ['b1'] });
const viewer = session(['documents.view'], { dataScope: 'OWN', branchIds: ['b1'] });
const multi = session(['documents.view'], { dataScope: 'ALL', branchIds: [] });
const writes = (calls) => calls.filter((c) => c.method !== 'GET');
const file = (name = 'scan.pdf', type = 'application/pdf', size = 20) => new File([new Uint8Array(size)], name, { type });
afterEach(() => vi.unstubAllGlobals());

describe('documents on a record', () => {
  it('lists that record\'s documents from the server with type (inactive marked), file, size, version and uploader', async () => {
    const calls = mockApi();
    panel(manager);
    const list = within(await screen.findByLabelText('Documents'));
    expect(list.getByText('Aadhaar front')).toBeTruthy();
    expect(list.getByText(/ID proof · aadhaar.pdf · 2 KB/)).toBeTruthy();
    expect(list.getByText(/Agreement \(inactive\) · agreement-v2.pdf · 3.0 MB · version 2/)).toBeTruthy();
    expect(list.getAllByText(/Asha|Vikram/).length).toBeGreaterThan(0);
    const req = calls.find((c) => c.key === 'GET /documents');
    expect(req.path).toContain('entityType=client');
    expect(req.path).toContain('entityId=c1');
  });

  it('shows loading, empty, error and permission states', async () => {
    mockApi({ 'GET /documents': ok([], { page: 1, limit: 50, total: 0 }) });
    const { unmount } = panel(manager);
    expect(screen.getByText('Loading documents…')).toBeTruthy();
    expect(await screen.findByText('No documents yet')).toBeTruthy();
    unmount();
    mockApi({ 'GET /documents': fail(500, 'INTERNAL_ERROR', 'boom') });
    const { unmount: u2 } = panel(manager);
    expect(await screen.findByText('Could not load documents')).toBeTruthy();
    u2();
    mockApi({ 'GET /documents': fail(404, 'NOT_FOUND', 'Client not found') });
    const { unmount: u3 } = panel(manager);
    expect(await screen.findByText('Documents are not available to you')).toBeTruthy();
    u3();
    const calls = mockApi();
    panel(session([], { dataScope: 'OWN' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Documents')).toBeNull();
    expect(calls.some((c) => c.key === 'GET /documents')).toBe(false);
  });

  it('"Add document" needs documents.upload and an open record', async () => {
    mockApi();
    const { unmount } = panel(manager);
    expect(await screen.findByRole('button', { name: 'Add document' })).toBeTruthy();
    unmount();
    const { unmount: u2 } = panel(manager, { canAdd: false });
    await screen.findByLabelText('Documents');
    expect(screen.queryByRole('button', { name: 'Add document' })).toBeNull();
    u2();
    panel(viewer);
    await screen.findByLabelText('Documents');
    expect(screen.queryByRole('button', { name: 'Add document' })).toBeNull();
  });

  it('upload needs a file and a type, then sends multipart to the record with the chosen fields', async () => {
    const calls = mockApi({ 'POST /documents': { ok: true, status: 201, json: async () => ({ data: D1 }) } });
    panel(manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Add document' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(await within(dialog).findByText('Choose the document type')).toBeTruthy();
    expect(within(dialog).getByText('Choose a file')).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/^File/), { target: { files: [file('aadhaar front.pdf')] } });
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Agreement' })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText(/^Document type/), { target: { value: 't2' } });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Signed copy' } });
    fireEvent.change(within(dialog).getByLabelText('Notes'), { target: { value: 'Page 1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    const w = writes(calls)[0];
    expect(w.key).toBe('POST /documents');
    expect(w.path).toContain('entityType=client');
    expect(w.path).toContain('entityId=c1');
    expect(w.body).toMatchObject({ documentTypeId: 't2', name: 'Signed copy', notes: 'Page 1', file: { file: 'aadhaar front.pdf', type: 'application/pdf', size: 20 } });
    expect(Object.keys(w.body)).not.toContain('branchId'); // the branch comes from the record, never the browser
  });

  it.each([
    [415, 'UNSUPPORTED_FILE_TYPE', 'Only PDF, JPEG, PNG and WebP files are accepted'],
    [413, 'FILE_TOO_LARGE', 'The file is larger than the 15 MB limit'],
    [409, 'DUPLICATE_DOCUMENT', 'This file is already attached here (DOC-000001)'],
    [409, 'ENTITY_ARCHIVED', 'This client is archived, so documents cannot be added to it'],
    [404, 'NOT_FOUND', 'Client not found'],
  ])("shows the server's refusal inside the dialog (%s %s)", async (status, code, message) => {
    mockApi({ 'POST /documents': fail(status, code, message) });
    panel(manager);
    fireEvent.click(await screen.findByRole('button', { name: 'Add document' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^File/), { target: { files: [file()] } });
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Agreement' })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText(/^Document type/), { target: { value: 't1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(message);
  });
});

describe('opening, replacing, editing and archiving', () => {
  it('Open asks the server for a fresh signed link at that moment and opens it; a refusal is reported, nothing is cached', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({});
    const calls = mockApi();
    panel(manager);
    const list = within(await screen.findByLabelText('Documents'));
    fireEvent.click(list.getAllByRole('button', { name: 'Actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://files.test/signed/d1.pdf?sig=abc', '_blank', 'noopener,noreferrer'));
    expect(calls.filter((c) => c.key === 'GET /documents/d1/url')).toHaveLength(1);
    fireEvent.click(list.getAllByRole('button', { name: 'Actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
    await waitFor(() => expect(calls.filter((c) => c.key === 'GET /documents/d1/url')).toHaveLength(2)); // asked again: links are not reused
    open.mockRestore();
  });

  it('a refused link (no access any more) shows the server message and opens nothing', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({});
    mockApi({ 'GET /documents/d1/url': fail(404, 'NOT_FOUND', 'Document not found') });
    panel(manager);
    const list = within(await screen.findByLabelText('Documents'));
    fireEvent.click(list.getAllByRole('button', { name: 'Actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
    expect(await screen.findByText('Document not found')).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('the menu is exactly what the server allows for each document', async () => {
    mockApi();
    panel(manager);
    const list = within(await screen.findByLabelText('Documents'));
    const menus = list.getAllByRole('button', { name: 'Actions' });
    fireEvent.click(menus[0]);
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open', 'Edit', 'Replace file', 'Archive']);
    fireEvent.click(menus[0]);
    fireEvent.click(menus[1]);
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open']);
  });

  it('replace sends the new file to the document; the server refusal (same file) is shown', async () => {
    const calls = mockApi({ 'POST /documents/d1/file': fail(409, 'SAME_FILE', 'This is the same file that is already attached') });
    panel(manager);
    const list = within(await screen.findByLabelText('Documents'));
    fireEvent.click(list.getAllByRole('button', { name: 'Actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Replace file' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/stays available as version 1/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replace file' }));
    expect(await within(dialog).findByText('Choose a file')).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/^New file/), { target: { files: [file('v2.pdf')] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replace file' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/same file/);
    expect(writes(calls)[0]).toMatchObject({ key: 'POST /documents/d1/file', body: { file: { file: 'v2.pdf' } } });
  });

  it('edit sends only what changed; archive asks first', async () => {
    const calls = mockApi({ 'PATCH /documents/d1': ok(D1), 'DELETE /documents/d1': noContent });
    panel(manager);
    const list = within(await screen.findByLabelText('Documents'));
    fireEvent.click(list.getAllByRole('button', { name: 'Actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const d1 = await screen.findByRole('dialog');
    fireEvent.click(within(d1).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes(calls)).toHaveLength(0);
    fireEvent.click(list.getAllByRole('button', { name: 'Actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const d2 = await screen.findByRole('dialog');
    fireEvent.change(within(d2).getByLabelText(/^Title/), { target: { value: 'Aadhaar (front)' } });
    fireEvent.click(within(d2).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ key: 'PATCH /documents/d1', body: { name: 'Aadhaar (front)' } });
    expect(Object.keys(writes(calls)[0].body)).toEqual(['name']);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(list.getAllByRole('button', { name: 'Actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    const d3 = await screen.findByRole('dialog');
    expect(writes(calls)).toHaveLength(1);
    fireEvent.click(within(d3).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(writes(calls)[1]?.key).toBe('DELETE /documents/d1'));
  });
});

describe('documents list and detail', () => {
  it('lists with filters from the masters and the server\'s record types; everything goes to the server', async () => {
    const calls = mockApi();
    app('/documents?search=aadhaar&documentTypeId=t1&entityType=client&from=2026-01-01&to=2026-02-01&sort=-documentNo&page=2', multi);
    expect(await screen.findByText('DOC-000001')).toBeTruthy();
    const req = calls.find((c) => c.key === 'GET /documents');
    for (const part of ['search=aadhaar', 'documentTypeId=t1', 'entityType=client', 'from=2026-01-01', 'to=2026-02-01', 'sort=-documentNo', 'page=2']) expect(req.path).toContain(part);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Unit' })).toBeTruthy()); // record types come from the server
    expect(screen.getByRole('option', { name: 'Agreement' })).toBeTruthy();
    expect(screen.getByLabelText('Branch')).toBeTruthy(); // multi-branch users only
    expect(screen.getAllByRole('link', { name: 'Client CL-000001' })[0].getAttribute('href')).toBe('/clients/c1');
    expect(screen.getByRole('heading', { name: 'Documents' })).toBeTruthy();
  });

  it('empty and error states', async () => {
    mockApi({ 'GET /documents': ok([], { page: 1, limit: 25, total: 0 }) });
    const { unmount } = app('/documents', manager);
    expect(await screen.findByText('No documents yet')).toBeTruthy();
    unmount();
    mockApi({ 'GET /documents': fail(500, 'INTERNAL_ERROR', 'boom') });
    app('/documents', manager);
    expect((await screen.findAllByText(/boom|Could not load/)).length).toBeGreaterThan(0);
  });

  it('detail shows the record link, current and earlier versions (each openable), timeline and audit', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({});
    const calls = mockApi();
    app('/documents/d2', manager);
    expect(await screen.findByRole('heading', { name: /Old agreement/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Client CL-000001' }).getAttribute('href')).toBe('/clients/c1');
    const versions = within(screen.getByLabelText('Versions'));
    expect(versions.getByText(/Version 2 \(current\)/)).toBeTruthy();
    fireEvent.click(versions.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /documents/d2/url' && c.path.includes('version=1'))).toBe(true));
    expect(await screen.findByText(/added to client CL-000001/)).toBeTruthy();
    expect(await screen.findByText('upload')).toBeTruthy();
    open.mockRestore();
  });

  it('detail without activity / audit permission requests neither; a missing document shows not found', async () => {
    const calls = mockApi();
    const { unmount } = app('/documents/d2', viewer);
    await screen.findByRole('heading', { name: /Old agreement/ });
    expect(calls.some((c) => c.key === 'GET /activities' || c.key === 'GET /audit')).toBe(false);
    unmount();
    mockApi({ 'GET /documents/d2': fail(404, 'NOT_FOUND', 'Document not found') });
    app('/documents/d2', manager);
    expect((await screen.findAllByText(/not found|Could not load/i)).length).toBeGreaterThan(0);
  });
});

describe('navigation', () => {
  it('Documents is a real page for documents.view holders and refused by URL otherwise', async () => {
    mockApi();
    const { unmount } = renderWithApp(wrap(<AppRoutes />), { session: manager, route: '/documents' });
    expect((await screen.findAllByRole('heading', { name: 'Documents' })).length).toBeGreaterThan(0);
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    unmount();
    renderWithApp(wrap(<AppRoutes />), { session: session(['dashboard.view']), route: '/documents' });
    expect(await screen.findByText(/don't have access/i)).toBeTruthy();
  });
});
