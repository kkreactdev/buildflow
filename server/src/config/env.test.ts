import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from './env';

const base = { MONGODB_URI: 'mongodb://example/db', JWT_ACCESS_SECRET: 'x'.repeat(40) };

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv({ ...base });
    expect(env.PORT).toBe(8080);
    expect(env.DB_REQUIRE_REPLICA_SET).toBe(true);
    expect(env.APP_TIMEZONE).toBe('Asia/Kolkata');
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('parses the CORS allow-list', () => {
    expect(loadEnv({ ...base, CORS_ORIGINS: ' http://a.test , http://b.test ,' }).CORS_ORIGINS).toEqual([
      'http://a.test',
      'http://b.test',
    ]);
  });

  it('fails fast listing every problem', () => {
    try {
      loadEnv({ PORT: 'abc' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const issues = (e as EnvError).issues.join('\n');
      expect(issues).toContain('MONGODB_URI');
      expect(issues).toContain('PORT');
    }
  });

  it('never echoes values in error output', () => {
    try {
      loadEnv({ MONGODB_URI: 'mongodb://user:supersecret@h/db', PORT: 'supersecret' });
    } catch (e) {
      expect((e as Error).message).not.toContain('supersecret');
    }
  });

  it('rejects a short JWT secret without echoing it', () => {
    try {
      loadEnv({ ...base, JWT_ACCESS_SECRET: 'tooshort' });
      expect.unreachable();
    } catch (e) {
      expect((e as EnvError).issues.join()).toContain('JWT_ACCESS_SECRET');
      expect((e as Error).message).not.toContain('tooshort');
    }
  });

  it('refuses DB_REQUIRE_REPLICA_SET=false in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', DB_REQUIRE_REPLICA_SET: 'false' })).toThrow(/replica|transactions/i);
    expect(loadEnv({ ...base, NODE_ENV: 'development', DB_REQUIRE_REPLICA_SET: 'false' }).DB_REQUIRE_REPLICA_SET).toBe(false);
  });

  it('requires Cloudinary credentials together, and in production', () => {
    const cloud = { CLOUDINARY_CLOUD_NAME: 'c', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' };
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/cloudinary/i);
    expect(loadEnv({ ...base, NODE_ENV: 'production', ...cloud }).CLOUDINARY_CLOUD_NAME).toBe('c');
    expect(() => loadEnv({ ...base, CLOUDINARY_CLOUD_NAME: 'c' })).toThrow(/together/i);
    expect(loadEnv({ ...base }).UNIT_MEDIA_MAX_COUNT).toBe(30); // optional outside production
  });
});
