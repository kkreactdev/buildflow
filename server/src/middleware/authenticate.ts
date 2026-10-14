import type { NextFunction, Request, Response } from 'express';
import { systemRepo } from '../core/scope/system';
import { AppError } from '../lib/appError';
import { verifyAccessToken } from '../modules/auth/tokens';
import { buildPrincipal } from '../modules/auth/principal.service';
import { Role } from '../modules/roles/role.model';
import { User } from '../modules/users/user.model';

/**
 * Verifies the bearer access token, then rebuilds the principal from the
 * database on EVERY request, so role/permission changes, deactivation and token
 * version bumps take effect immediately. Without a valid token it does nothing
 * (req.principal stays unset) and `authorize()` fails closed with 401.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header) return next();
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw AppError.unauthenticated('Malformed Authorization header');

    const claims = verifyAccessToken(token);
    // No principal exists yet (this is how we build it), so this lookup is a system operation.
    const user = await systemRepo(User, 'auth', 'access-token user lookup').findById(claims.sub).select('+tokenVersion').lean();
    if (!user || !user.isActive || (user.tokenVersion ?? 0) !== claims.tv) throw AppError.unauthenticated('Session is no longer valid');
    const role = await Role.findById(user.roleId).lean();
    if (!role || !role.isActive) throw AppError.unauthenticated('Session is no longer valid');

    req.principal = buildPrincipal(user, role);
    next();
  } catch (err) {
    next(err);
  }
}
