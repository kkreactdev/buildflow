import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../../lib/appError';
import { WILDCARD, type PermissionKey } from './catalog';

export type DataScope = 'ALL' | 'BRANCH' | 'OWN';

/**
 * The authenticated actor, built server-side per request from the database
 * (never from client-supplied fields). Populated by the auth middleware in
 * Phase 1.
 */
export interface Principal {
  userId: string;
  permissions: ReadonlySet<string>;
  dataScope: DataScope;
  /** Branches the user belongs to. Ignored for ALL scope. */
  branchIds: readonly string[];
}

declare module 'express-serve-static-core' {
  interface Request {
    principal?: Principal;
  }
}

/** Fail-closed: no principal, or a key not granted, is `false`. */
export function hasPermission(principal: Principal | undefined, key: PermissionKey): boolean {
  if (!principal) return false;
  return principal.permissions.has(WILDCARD) || principal.permissions.has(key);
}

export function assertPermission(principal: Principal | undefined, key: PermissionKey): asserts principal is Principal {
  if (!principal) throw AppError.unauthenticated();
  if (!hasPermission(principal, key)) throw AppError.forbidden(`Missing permission: ${key}`);
}

/**
 * Route guard. Every non-public route must use it (a test will enforce this
 * once routes exist). Without an authenticated principal it answers 401, so a
 * route accidentally mounted before `authenticate` fails closed.
 */
export function authorize(key: PermissionKey): RequestHandler {
  const handler: RequestHandler = (req: Request, _res: Response, next: NextFunction): void => {
    try {
      assertPermission(req.principal, key);
      next();
    } catch (err) {
      next(err);
    }
  };
  return markGuard(handler);
}

/** Marker so a test can prove every route declares its access rule. */
export const GUARD_MARK = '__bfGuard' as const;
export function markGuard<T extends RequestHandler>(handler: T): T {
  (handler as unknown as Record<string, boolean>)[GUARD_MARK] = true;
  return handler;
}

/** Handlers that need no permission must say so explicitly. */
export const publicRoute: RequestHandler = markGuard((_req, _res, next) => next());

/** Any authenticated principal (no specific permission), e.g. `GET /auth/me`. */
export const authenticatedOnly: RequestHandler = markGuard((req, _res, next) => {
  if (!req.principal) return next(AppError.unauthenticated());
  next();
});
