// REST client for the BuildFlow API. The backend envelope is `{ data, meta? }`
// on success and `{ error: { code, message, details? }, requestId }` on failure.

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'UNKNOWN', details, requestId } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** Maps server validation details `[{path, message}]` to `{ field: message }` for forms. */
  get fieldErrors() {
    if (this.code !== 'VALIDATION_ERROR' || !Array.isArray(this.details)) return {};
    const out = {};
    for (const d of this.details) if (d?.path && !(d.path in out)) out[d.path] = d.message;
    return out;
  }
}

// The access token lives in memory only (never localStorage). Phase 1 wires
// login/refresh to these hooks.
let accessToken = null;
let unauthorizedHandler = null;
let refreshHandler = null;

export const authToken = {
  get: () => accessToken,
  set: (token) => {
    accessToken = token ?? null;
  },
};

export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

/** `fn()` silently renews the session; resolves true on success. Set by AuthProvider. */
export function setRefreshHandler(fn) {
  refreshHandler = fn;
}

export function buildQuery(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function buildUrl(path, query) {
  const base = API_BASE_URL.replace(/\/+$/, '');
  return `${base}/${path.replace(/^\/+/, '')}${buildQuery(query)}`;
}

async function toApiError(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON error body
  }
  const e = body?.error;
  return new ApiError(e?.message ?? `Request failed (${res.status})`, {
    status: res.status,
    code: e?.code ?? 'HTTP_ERROR',
    details: e?.details,
    requestId: body?.requestId,
  });
}

async function send(method, path, { query, body, signal, form, auth = true, retried = false } = {}) {
  const headers = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let payload;
  if (form) {
    payload = form; // browser sets the multipart boundary
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(buildUrl(path, query), { method, headers, body: payload, signal, credentials: 'include' });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the server. Check your connection and try again.', { code: 'NETWORK_ERROR' });
  }

  if (!res.ok) {
    // `auth: false` marks the login/refresh/logout endpoints themselves: a 401 there is an
    // answer, not an expired session, so it must not trigger refresh or logout.
    if (res.status === 401 && auth) {
      // Access token expired: renew once (single-flight, in the handler) and replay the request.
      if (!retried && refreshHandler && (await refreshHandler())) {
        return send(method, path, { query, body, signal, form, auth, retried: true });
      }
      unauthorizedHandler?.();
    }
    throw await toApiError(res);
  }
  return res;
}

async function json(res) {
  if (res.status === 204) return { data: null };
  return res.json();
}

export const api = {
  /** Returns `data` only. */
  async get(path, opts) {
    return (await json(await send('GET', path, opts))).data;
  },
  /** For paginated endpoints: `{ rows, meta }`. */
  async list(path, opts) {
    const body = await json(await send('GET', path, opts));
    return { rows: body.data ?? [], meta: body.meta ?? { page: 1, limit: body.data?.length ?? 0, total: body.data?.length ?? 0 } };
  },
  async post(path, body, opts) {
    return (await json(await send('POST', path, { ...opts, body: body ?? {} }))).data;
  },
  async patch(path, body, opts) {
    return (await json(await send('PATCH', path, { ...opts, body: body ?? {} }))).data;
  },
  async delete(path, opts) {
    return (await json(await send('DELETE', path, opts))).data;
  },
  async upload(path, formData, opts) {
    return (await json(await send('POST', path, { ...opts, form: formData }))).data;
  },
  /** Fetches a file (e.g. CSV export) and triggers a browser download. */
  async download(path, { query, filename = 'export.csv', signal } = {}) {
    const res = await send('GET', path, { query, signal });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
