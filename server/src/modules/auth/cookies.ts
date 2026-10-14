import type { CookieOptions, Request, Response } from 'express';
import { getEnv } from '../../config/env';
import { AppError } from '../../lib/appError';

export const REFRESH_COOKIE = 'bf_rt';
/** Scoped so the browser only sends the refresh cookie to the auth endpoints. */
const COOKIE_PATH = '/api/v1/auth';

function options(): CookieOptions {
  const env = getEnv();
  return {
    httpOnly: true, // never readable from JavaScript
    secure: env.NODE_ENV === 'production',
    sameSite: env.COOKIE_SAMESITE,
    path: COOKIE_PATH,
  };
}

export function setRefreshCookie(res: Response, raw: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, raw, { ...options(), expires: expiresAt });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, options());
}

/** Minimal cookie reader (avoids a dependency for a single cookie). */
export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === REFRESH_COOKIE) {
      const value = decodeURIComponent(part.slice(idx + 1).trim());
      return value || undefined;
    }
  }
  return undefined;
}

/**
 * CSRF defence for cookie-authenticated endpoints (refresh/logout), on top of
 * SameSite: if the browser sent an Origin, it must be an allowed one.
 */
export function assertTrustedOrigin(req: Request): void {
  const origin = req.headers.origin;
  if (origin && !getEnv().CORS_ORIGINS.includes(origin)) {
    throw AppError.forbidden('Untrusted origin');
  }
}
