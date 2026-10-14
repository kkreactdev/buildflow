import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getEnv } from '../../config/env';
import { AppError } from '../../lib/appError';

export interface AccessClaims {
  sub: string;
  tv: number;
}

export function signAccessToken(userId: string, tokenVersion: number): { token: string; expiresInSeconds: number } {
  const env = getEnv();
  const expiresInSeconds = env.ACCESS_TOKEN_TTL_MINUTES * 60;
  const token = jwt.sign({ tv: tokenVersion }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: expiresInSeconds,
  });
  return { token, expiresInSeconds };
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    const payload = jwt.verify(token, getEnv().JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || typeof payload.sub !== 'string' || typeof payload.tv !== 'number') {
      throw new Error('bad claims');
    }
    return { sub: payload.sub, tv: payload.tv as number };
  } catch {
    throw AppError.unauthenticated('Invalid or expired access token');
  }
}

export function newRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(48).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export const newFamilyId = (): string => randomUUID();
