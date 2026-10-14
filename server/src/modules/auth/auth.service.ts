import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { getEnv } from '../../config/env';
import { recordAudit } from '../../core/audit/audit.service';
import { systemRepo } from '../../core/scope/system';
import { AppError } from '../../lib/appError';
import { Role } from '../roles/role.model';
import { User } from '../users/user.model';
import { toSessionView, type SessionView } from './principal.service';
import { RefreshToken } from './refreshToken.model';
import { hashToken, newFamilyId, newRefreshToken, signAccessToken } from './tokens';

export interface ClientContext {
  ip?: string;
  userAgent?: string;
}

export interface IssuedSession {
  session: SessionView;
  accessToken: string;
  expiresInSeconds: number;
  refresh: { raw: string; expiresAt: Date };
}

/** Authentication runs before any principal exists, so its user access is an approved system operation. */
const authUsers = (detail: string) => systemRepo(User, 'auth', detail);

const INVALID = () => new AppError('INVALID_CREDENTIALS', 401, 'Invalid email or password');

let dummyHash: string | undefined;
/** Used so unknown emails cost the same as known ones (no user enumeration by timing). */
function getDummyHash(): string {
  dummyHash ??= bcrypt.hashSync('not-a-real-password', getEnv().BCRYPT_COST);
  return dummyHash;
}

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, getEnv().BCRYPT_COST);

export const PASSWORD_MIN_LENGTH = 10;

async function issueRefresh(userId: Types.ObjectId, familyId: string, ctx: ClientContext) {
  const { raw, hash } = newRefreshToken();
  const expiresAt = new Date(Date.now() + getEnv().REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await RefreshToken.create({
    userId,
    familyId,
    tokenHash: hash,
    expiresAt,
    userAgent: ctx.userAgent?.slice(0, 300),
    ip: ctx.ip,
  });
  return { raw, hash, expiresAt };
}

async function loadSessionParts(userId: Types.ObjectId | string) {
  const user = await authUsers('session load').findById(String(userId)).select('+tokenVersion').lean();
  if (!user) return null;
  const role = await Role.findById(user.roleId).lean();
  if (!role) return null;
  return { user, role };
}

export async function login(emailRaw: string, password: string, ctx: ClientContext): Promise<IssuedSession> {
  const env = getEnv();
  const email = emailRaw.trim().toLowerCase();
  const user = await authUsers('login lookup').findOne({ email }).select('+passwordHash +failedLoginCount +lockedUntil +tokenVersion');

  if (!user) {
    await bcrypt.compare(password, getDummyHash());
    throw INVALID();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError('ACCOUNT_LOCKED', 429, 'Too many failed attempts. Try again later.');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const failed = (user.failedLoginCount ?? 0) + 1;
    const lock = failed >= env.MAX_FAILED_LOGINS;
    await authUsers('failed-login bookkeeping').updateOne(
      { _id: user._id },
      lock ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + env.LOCKOUT_MINUTES * 60_000) } : { failedLoginCount: failed },
    );
    await recordAudit({ entityType: 'user', entityId: user._id, action: lock ? 'login_locked' : 'login_failed', userId: user._id }, { bestEffort: true });
    throw INVALID();
  }

  // Only after the password is proven do we reveal the account state.
  if (!user.isActive) throw new AppError('ACCOUNT_DISABLED', 403, 'This account is disabled. Contact an administrator.');
  const role = await Role.findById(user.roleId).lean();
  if (!role || !role.isActive) throw new AppError('ACCOUNT_DISABLED', 403, 'This account has no active role. Contact an administrator.');

  await authUsers('login bookkeeping').updateOne({ _id: user._id }, { failedLoginCount: 0, $unset: { lockedUntil: 1 }, lastLoginAt: new Date() });

  const access = signAccessToken(user._id.toHexString(), user.tokenVersion ?? 0);
  const refresh = await issueRefresh(user._id, newFamilyId(), ctx);
  await recordAudit({ entityType: 'user', entityId: user._id, action: 'login', userId: user._id }, { bestEffort: true });

  return {
    session: toSessionView(user, role),
    accessToken: access.token,
    expiresInSeconds: access.expiresInSeconds,
    refresh: { raw: refresh.raw, expiresAt: refresh.expiresAt },
  };
}

/** Revokes every token in a family (used on reuse detection and logout). */
async function revokeFamily(familyId: string): Promise<number> {
  const res = await RefreshToken.updateMany({ familyId, revokedAt: { $exists: false } }, { revokedAt: new Date() });
  return res.modifiedCount;
}

export async function revokeAllForUser(userId: Types.ObjectId | string): Promise<void> {
  await RefreshToken.updateMany({ userId, revokedAt: { $exists: false } }, { revokedAt: new Date() });
}

/**
 * Rotation: the presented token is atomically consumed (so two concurrent
 * refreshes cannot both succeed) and replaced. Presenting an already-consumed
 * token means it leaked or was replayed, so the whole family is revoked.
 */
export async function refresh(rawToken: string | undefined, ctx: ClientContext): Promise<IssuedSession> {
  if (!rawToken) throw AppError.unauthenticated('No refresh token');
  const hash = hashToken(rawToken);
  const now = new Date();

  const consumed = await RefreshToken.findOneAndUpdate(
    { tokenHash: hash, revokedAt: { $exists: false }, expiresAt: { $gt: now } },
    { revokedAt: now },
  );

  if (!consumed) {
    const existing = await RefreshToken.findOne({ tokenHash: hash }).lean();
    if (existing?.revokedAt) {
      const sinceMs = now.getTime() - existing.revokedAt.getTime();
      if (sinceMs < getEnv().REFRESH_REUSE_GRACE_SECONDS * 1000) {
        // Almost certainly two tabs refreshing together; the winner already set a fresh cookie.
        throw new AppError('REFRESH_RACE', 401, 'Session refresh in progress. Retry.');
      }
      // Audit once, when live tokens were actually killed (repeat replays of a dead family are noise).
      if ((await revokeFamily(existing.familyId)) > 0) await recordAudit({ entityType: 'user', entityId: existing.userId, action: 'refresh_reuse_detected', userId: existing.userId }, { bestEffort: true });
    }
    throw AppError.unauthenticated('Session expired. Please sign in again.');
  }

  const parts = await loadSessionParts(consumed.userId);
  if (!parts || !parts.user.isActive || !parts.role.isActive) {
    await revokeFamily(consumed.familyId);
    throw AppError.unauthenticated('Session expired. Please sign in again.');
  }

  const next = await issueRefresh(consumed.userId, consumed.familyId, ctx);
  await RefreshToken.updateOne({ _id: consumed._id }, { replacedByHash: next.hash });
  const access = signAccessToken(parts.user._id.toHexString(), parts.user.tokenVersion ?? 0);

  return {
    session: toSessionView(parts.user, parts.role),
    accessToken: access.token,
    expiresInSeconds: access.expiresInSeconds,
    refresh: { raw: next.raw, expiresAt: next.expiresAt },
  };
}

/** Idempotent: unknown/expired tokens are fine. Returns the user id when known (for audit). */
export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const token = await RefreshToken.findOne({ tokenHash: hashToken(rawToken) }).lean();
  if (!token) return;
  if ((await revokeFamily(token.familyId)) > 0) {
    await recordAudit({ entityType: 'user', entityId: token.userId, action: 'logout', userId: token.userId }, { bestEffort: true });
  }
}

/** Current session for an already-authenticated principal. */
export async function getSession(userId: string): Promise<SessionView> {
  const parts = await loadSessionParts(userId);
  if (!parts) throw AppError.unauthenticated();
  return toSessionView(parts.user, parts.role);
}
