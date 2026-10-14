import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { PERMISSION_CATALOG } from '../../core/permissions/catalog';
import { authenticatedOnly, authorize, publicRoute } from '../../core/permissions/principal';
import { getEnv } from '../../config/env';
import { AppError } from '../../lib/appError';
import { ok } from '../../lib/respond';
import { validate, validated } from '../../middleware/validate';
import * as auth from './auth.service';
import { assertTrustedOrigin, clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './cookies';
import { loginBody } from './auth.schema';

export const authRoutes = Router();

const ctxOf = (req: Request): auth.ClientContext => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

/** The refresh token travels only in the httpOnly cookie; it is never part of a JSON body. */
function respondSession(res: Response, issued: auth.IssuedSession, status = 200): void {
  setRefreshCookie(res, issued.refresh.raw, issued.refresh.expiresAt);
  ok(res, { ...issued.session, accessToken: issued.accessToken, expiresInSeconds: issued.expiresInSeconds }, status);
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => getEnv().NODE_ENV === 'test',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } },
});

authRoutes.post('/auth/login', publicRoute, loginLimiter, validate({ body: loginBody }), async (req, res) => {
  const { email, password } = validated<typeof loginBody>(req).body;
  respondSession(res, await auth.login(email, password, ctxOf(req)));
});

authRoutes.post('/auth/refresh', publicRoute, async (req, res) => {
  assertTrustedOrigin(req);
  try {
    respondSession(res, await auth.refresh(readRefreshCookie(req), ctxOf(req)));
  } catch (err) {
    // On a race the other tab's fresh cookie must survive, so do not clear it.
    if (!(err instanceof AppError && err.code === 'REFRESH_RACE')) clearRefreshCookie(res);
    throw err;
  }
});

authRoutes.post('/auth/logout', publicRoute, async (req, res) => {
  assertTrustedOrigin(req);
  await auth.logout(readRefreshCookie(req));
  clearRefreshCookie(res);
  res.status(204).end();
});

authRoutes.get('/auth/me', authenticatedOnly, async (req: Request, res: Response) => {
  ok(res, await auth.getSession(req.principal!.userId));
});

/** Feeds the role editor so the UI never hard-codes the permission list. */
authRoutes.get('/auth/permissions-catalog', authorize('roles.view'), (_req, res) => {
  ok(res, PERMISSION_CATALOG);
});
