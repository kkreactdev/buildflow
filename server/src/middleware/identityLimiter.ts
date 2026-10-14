import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { getEnv } from '../config/env';
import { ErrorCode } from '../lib/appError';
import { logger } from '../lib/logger';
import { markGuard } from '../core/permissions/principal';

/**
 * Throttles the endpoints through which someone holding a full phone number can learn that it is
 * already registered elsewhere (lookup, person create/edit/link, client and enquiry create). It is
 * keyed by authenticated USER plus IP (so a shared office IP does not throttle everyone, and a
 * single user cannot dodge it by changing address), runs after authentication, and answers with a
 * generic 429 that says nothing about why. The phone number is never logged. Limits are
 * configurable (IDENTITY_RATE_LIMIT_MAX per IDENTITY_RATE_LIMIT_WINDOW_SECONDS); the default of
 * 30/minute is far above normal data entry.
 *
 * In-memory per API instance, like the login limiter: behind several instances use a shared store.
 */
let cached: { key: string; handler: RequestHandler } | undefined;

function build(): RequestHandler {
  const env = getEnv();
  return rateLimit({
    windowMs: env.IDENTITY_RATE_LIMIT_WINDOW_SECONDS * 1000,
    limit: env.IDENTITY_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req: Request) => `${req.principal?.userId ?? 'anonymous'}|${ipKeyGenerator(req.ip ?? '')}`,
    handler: (req: Request, res: Response) => {
      logger.warn({ userId: req.principal?.userId, route: req.route?.path }, 'identity lookup rate limit hit'); // no phone, no body
      res.status(429).json({ error: { code: ErrorCode.RATE_LIMITED, message: 'Too many requests. Please slow down and try again shortly.' }, requestId: req.requestId });
    },
  });
}

/** Rebuilds only when the configured limits change (which is what lets tests lower them). */
export const identityLimiter: RequestHandler = markGuard((req: Request, res: Response, next: NextFunction) => {
  const env = getEnv();
  const key = `${env.IDENTITY_RATE_LIMIT_MAX}:${env.IDENTITY_RATE_LIMIT_WINDOW_SECONDS}`;
  if (cached?.key !== key) cached = { key, handler: build() };
  cached.handler(req, res, next);
});
