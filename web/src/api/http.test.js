import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, authToken, buildQuery, buildUrl, setUnauthorizedHandler } from './http';
import { createKeys, queryKeys } from './queryKeys';

function mockFetch(status, body) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  authToken.set(null);
  setUnauthorizedHandler(null);
});

describe('url building', () => {
  it('skips empty values and joins arrays', () => {
    expect(buildQuery({ a: 1, b: '', c: null, d: undefined, e: ['x', 'y'], f: [] })).toBe('?a=1&e=x%2Cy');
    expect(buildQuery({})).toBe('');
  });
  it('joins base and path without double slashes', () => {
    expect(buildUrl('/enquiries', { page: 2 })).toBe('/api/v1/enquiries?page=2');
  });
});

describe('api client', () => {
  it('unwraps `data` and sends the bearer token', async () => {
    authToken.set('tok');
    const fetchMock = mockFetch(200, { data: { id: 1 } });
    expect(await api.get('x')).toEqual({ id: 1 });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('returns rows + meta for lists', async () => {
    mockFetch(200, { data: [{ id: 1 }], meta: { page: 1, limit: 25, total: 1 } });
    expect(await api.list('x')).toEqual({ rows: [{ id: 1 }], meta: { page: 1, limit: 25, total: 1 } });
  });

  it('sends JSON bodies for POST/PATCH', async () => {
    const fetchMock = mockFetch(200, { data: {} });
    await api.post('x', { a: 1 });
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('maps the error envelope to ApiError with field errors', async () => {
    mockFetch(400, { error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: [{ path: 'name', message: 'Too short' }] }, requestId: 'r1' });
    const err = await api.post('x', {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', requestId: 'r1' });
    expect(err.fieldErrors).toEqual({ name: 'Too short' });
  });

  it('calls the unauthorized handler on 401', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockFetch(401, { error: { code: 'UNAUTHENTICATED', message: 'no' } });
    await expect(api.get('x')).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not treat 403 as logout', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockFetch(403, { error: { code: 'FORBIDDEN', message: 'no' } });
    await expect(api.get('x')).rejects.toMatchObject({ status: 403 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('reports network failure clearly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fail')));
    await expect(api.get('x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('handles 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }));
    expect(await api.delete('x')).toBeNull();
  });
});

describe('query keys', () => {
  it('builds hierarchical keys', () => {
    const k = createKeys('enquiries');
    expect(k.list({ page: 1 })).toEqual(['enquiries', 'list', { page: 1 }]);
    expect(k.detail('a')).toEqual(['enquiries', 'detail', 'a']);
    expect(k.list().slice(0, 1)).toEqual(k.all);
    expect(queryKeys.masters(['b', 'a'])).toEqual(['masters', ['a', 'b']]);
  });
});
