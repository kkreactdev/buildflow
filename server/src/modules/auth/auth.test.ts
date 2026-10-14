import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { resetEnvCache } from '../../config/env';
import { login, makeBranch, makeUser, PASSWORD, seedSystemRoles, Users , AuditLogs } from '../../test/factories';
import { useTestDb } from '../../test/db';
import { RefreshToken } from './refreshToken.model';
import { signAccessToken } from './tokens';

const app = buildApp();
const cookieHeader = (res: request.Response) => ((res.headers['set-cookie'] as unknown as string[]) ?? []).find((c) => c.startsWith('bf_rt='));

describe('authentication', () => {
  useTestDb();
  beforeEach(seedSystemRoles);

  it('logs in with valid credentials: access token in JSON, refresh token ONLY in an httpOnly cookie', async () => {
    const { email } = await makeUser({ roleKey: 'ADMIN' });
    const res = await request(app).post('/api/v1/auth/login').send({ email: email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.permissions.length).toBeGreaterThan(5);
    expect(res.body.data.dataScope).toBe('ALL');

    const cookie = cookieHeader(res)!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/i); // test env is not production

    const raw = cookie.split(';')[0]!.split('=')[1]!;
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(raw); // refresh token never in JSON
    expect(body).not.toMatch(/passwordHash|refreshToken|\$2[aby]\$/);
  });

  it('marks the refresh cookie Secure in production', async () => {
    const { email } = await makeUser({ roleKey: 'ADMIN' });
    process.env.NODE_ENV = 'production';
    Object.assign(process.env, { CLOUDINARY_CLOUD_NAME: 'c', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' }); // production requires media credentials
    resetEnvCache();
    try {
      const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
      expect(cookieHeader(res)).toMatch(/Secure/);
    } finally {
      process.env.NODE_ENV = 'test';
      for (const k of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) delete process.env[k];
      resetEnvCache();
    }
  });

  it('rejects wrong password and unknown email with the same generic error', async () => {
    const { email } = await makeUser({ roleKey: 'ADMIN' });
    const a = await request(app).post('/api/v1/auth/login').send({ email, password: 'nope-nope-nope' });
    const b = await request(app).post('/api/v1/auth/login').send({ email: 'ghost@example.com', password: 'nope-nope-nope' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toEqual(b.body.error);
    expect(cookieHeader(a)).toBeUndefined();
  });

  it('validates the login payload', async () => {
    expect((await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email', password: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/login').send({})).status).toBe(400);
  });

  it('blocks inactive users (403) but only reveals it after the correct password', async () => {
    const { email } = await makeUser({ roleKey: 'ADMIN', isActive: false });
    const wrong = await request(app).post('/api/v1/auth/login').send({ email, password: 'wrong-wrong-1' });
    expect(wrong.status).toBe(401);
    const right = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(right.status).toBe(403);
    expect(right.body.error.code).toBe('ACCOUNT_DISABLED');
    expect(cookieHeader(right)).toBeUndefined();
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    const { email } = await makeUser({ roleKey: 'ADMIN' });
    for (let i = 0; i < 5; i++) await request(app).post('/api/v1/auth/login').send({ email, password: 'wrong-wrong-1' });
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('GET /auth/me returns the session; bad/expired/tampered tokens are 401', async () => {
    const { email } = await makeUser({ roleKey: 'MANAGER', branches: [(await makeBranch('B1'))._id.toHexString()] });
    const { auth, token } = await login(app, email);
    const me = await request(app).get('/api/v1/auth/me').set(auth);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(email);
    expect(me.body.data.dataScope).toBe('BRANCH');
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|tokenVersion/);

    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token.slice(0, -3)}abc`)).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Basic ${token}`)).status).toBe(401);
  });

  it('never trusts identity headers', async () => {
    const { user } = await makeUser({ roleKey: 'ADMIN' });
    const res = await request(app).get('/api/v1/auth/me').set('x-user-id', user._id.toHexString());
    expect(res.status).toBe(401);
  });

  it('refreshes and ROTATES the refresh token', async () => {
    const { email } = await makeUser({ roleKey: 'ADMIN' });
    const first = await login(app, email);
    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', first.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    const second = cookieHeader(res)!.split(';')[0]!;
    expect(second).not.toBe(first.cookie);
    expect(await RefreshToken.countDocuments()).toBe(2);
    expect(await RefreshToken.countDocuments({ revokedAt: { $exists: true } })).toBe(1);

    const again = await request(app).post('/api/v1/auth/refresh').set('Cookie', second);
    expect(again.status).toBe(200);
  });

  it('stores only a hash of the refresh token', async () => {
    const { email } = await makeUser({ roleKey: 'ADMIN' });
    const { cookie } = await login(app, email);
    const raw = cookie.split('=')[1]!;
    const stored = await RefreshToken.findOne().lean();
    expect(stored!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(raw);
  });

  it('detects reuse of a rotated token and revokes the whole family', async () => {
    const { email } = await makeUser({ roleKey: 'ADMIN' });
    const first = await login(app, email);
    const rotated = await request(app).post('/api/v1/auth/refresh').set('Cookie', first.cookie);
    const newest = cookieHeader(rotated)!.split(';')[0]!;

    const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', first.cookie); // attacker replays old token
    expect(replay.status).toBe(401);
    // the legitimate newest token is now dead too
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', newest)).status).toBe(401);
    expect(await RefreshToken.countDocuments({ revokedAt: { $exists: false } })).toBe(0);
    expect(await AuditLogs.countDocuments({ action: 'refresh_reuse_detected' })).toBe(1);
  });

  it('treats a refresh within the grace window as a race: 401, no family revocation, cookie kept', async () => {
    const { email } = await makeUser({ roleKey: 'ADMIN' });
    const first = await login(app, email);
    process.env.REFRESH_REUSE_GRACE_SECONDS = '30';
    resetEnvCache();
    try {
      const rotated = await request(app).post('/api/v1/auth/refresh').set('Cookie', first.cookie);
      const newest = cookieHeader(rotated)!.split(';')[0]!;
      const race = await request(app).post('/api/v1/auth/refresh').set('Cookie', first.cookie);
      expect(race.status).toBe(401);
      expect(race.body.error.code).toBe('REFRESH_RACE');
      expect(cookieHeader(race)).toBeUndefined(); // must not wipe the winner's cookie
      expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', newest)).status).toBe(200); // family intact
    } finally {
      process.env.REFRESH_REUSE_GRACE_SECONDS = '0';
      resetEnvCache();
    }
  });

  it('only one of two concurrent refreshes with the same token succeeds', async () => {
    const { email } = await makeUser({ roleKey: 'ADMIN' });
    const { cookie } = await login(app, email);
    const [a, b] = await Promise.all([request(app).post('/api/v1/auth/refresh').set('Cookie', cookie), request(app).post('/api/v1/auth/refresh').set('Cookie', cookie)]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
  });

  it('rejects refresh with no/garbage/expired token and clears the cookie', async () => {
    expect((await request(app).post('/api/v1/auth/refresh')).status).toBe(401);
    const g = await request(app).post('/api/v1/auth/refresh').set('Cookie', 'bf_rt=garbage');
    expect(g.status).toBe(401);
    expect(cookieHeader(g)).toMatch(/bf_rt=;/);

    const { email } = await makeUser({ roleKey: 'ADMIN' });
    const { cookie } = await login(app, email);
    await RefreshToken.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });

  it('rejects refresh from an untrusted Origin (CSRF defence) but allows the configured one', async () => {
    const { email } = await makeUser({ roleKey: 'ADMIN' });
    const { cookie } = await login(app, email);
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie).set('Origin', 'http://evil.test')).status).toBe(403);
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie).set('Origin', 'http://localhost:5173')).status).toBe(200);
  });

  it('logout revokes the refresh token, clears the cookie, and is idempotent', async () => {
    const { email } = await makeUser({ roleKey: 'ADMIN' });
    const { cookie } = await login(app, email);
    const out = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(204);
    expect(cookieHeader(out)).toMatch(/bf_rt=;/);
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie)).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/logout').set('Cookie', cookie)).status).toBe(204);
    expect((await request(app).post('/api/v1/auth/logout')).status).toBe(204);
    expect(await AuditLogs.countDocuments({ action: 'logout' })).toBe(1);
  });

  it('refresh fails once the user is deactivated', async () => {
    const { email, user } = await makeUser({ roleKey: 'ADMIN' });
    const { cookie } = await login(app, email);
    await Users.updateOne({ _id: user._id }, { isActive: false });
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });

  it('invalidates outstanding access tokens when the token version changes or the user is disabled', async () => {
    const { email, user } = await makeUser({ roleKey: 'ADMIN' });
    const { auth } = await login(app, email);
    expect((await request(app).get('/api/v1/auth/me').set(auth)).status).toBe(200);
    await Users.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
    expect((await request(app).get('/api/v1/auth/me').set(auth)).status).toBe(401);

    const stale = signAccessToken(user._id.toHexString(), 1);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${stale.token}`)).status).toBe(200);
    await Users.updateOne({ _id: user._id }, { isActive: false });
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${stale.token}`)).status).toBe(401);
  });

  it('audits login, failed login and never records credentials or tokens', async () => {
    const { email } = await makeUser({ roleKey: 'ADMIN' });
    await request(app).post('/api/v1/auth/login').send({ email, password: 'wrong-wrong-1' });
    const { cookie } = await login(app, email);
    const rows = await AuditLogs.find().lean();
    expect(rows.map((r) => r.action).sort()).toEqual(['login', 'login_failed']);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain('wrong-wrong-1');
    expect(dump).not.toContain(cookie.split('=')[1]);
  });
});
