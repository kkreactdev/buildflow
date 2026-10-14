import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    DB_REQUIRE_REPLICA_SET: bool.default('true'),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters (use a long random value)'),
    ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    // A token rotated this recently is treated as a multi-tab race, not theft (no family revocation).
    REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(60).default(10),
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
    // Throttle for endpoints that can reveal whether a phone number is already registered (see identityLimiter).
    IDENTITY_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(30),
    IDENTITY_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(60),
    // Largest CSV export allowed in one request (larger results must be narrowed with filters).
    EXPORT_MAX_ROWS: z.coerce.number().int().min(1).max(200_000).default(20_000),
    // A follow-up counts as missed once it is this many minutes past its scheduled time and still not done.
    FOLLOWUP_MISSED_GRACE_MINUTES: z.coerce.number().int().min(0).max(1440).default(30),
    // Assignees get an "upcoming" reminder this many minutes before a follow-up is due.
    FOLLOWUP_REMINDER_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
    // Assignees of a scheduled site visit get a reminder this many minutes before it.
    SITEVISIT_REMINDER_MINUTES: z.coerce.number().int().min(1).max(2880).default(60),
    // The FOLLOWUP_TYPE master value (by code) used for the automatic follow-up created when a site visit is completed.
    POST_VISIT_FOLLOWUP_TYPE_CODE: z.string().trim().toUpperCase().min(1).default('CALL'),
    // Local hour (APP_TIMEZONE) at which that follow-up, due the next calendar day, is scheduled.
    POST_VISIT_FOLLOWUP_HOUR: z.coerce.number().int().min(0).max(23).default(10),
    // Unit media (Cloudinary, uploaded by the server; the browser never sees these credentials).
    CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
    CLOUDINARY_API_KEY: z.string().min(1).optional(),
    CLOUDINARY_API_SECRET: z.string().min(1).optional(),
    CLOUDINARY_FOLDER: z.string().min(1).default('buildflow'),
    MEDIA_MAX_BYTES: z.coerce.number().int().min(1024).max(50 * 1024 * 1024).default(10 * 1024 * 1024),
    // Business documents (private; delivered only through short-lived, permission-checked links).
    DOCUMENT_MAX_BYTES: z.coerce.number().int().min(1024).max(50 * 1024 * 1024).default(15 * 1024 * 1024),
    DOCUMENT_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    UNIT_MEDIA_MAX_COUNT: z.coerce.number().int().min(1).max(200).default(30),
    MAX_FAILED_LOGINS: z.coerce.number().int().min(3).max(20).default(5),
    LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    // Bootstrap/dev seed only. Never committed; the password is never logged.
    SEED_ADMIN_EMAIL: z.string().email().optional(),
    SEED_ADMIN_PASSWORD: z.string().min(10, 'must be at least 10 characters').optional(),
    SEED_ADMIN_NAME: z.string().min(1).default('Super Admin'),
    APP_TIMEZONE: z.string().min(1).default('Asia/Kolkata'),
    DEFAULT_COUNTRY_CALLING_CODE: z.string().regex(/^\d{1,3}$/, 'digits only, e.g. 91').default('91'),
  })
  .superRefine((cfg, ctx) => {
    const cloud = [cfg.CLOUDINARY_CLOUD_NAME, cfg.CLOUDINARY_API_KEY, cfg.CLOUDINARY_API_SECRET];
    if (cloud.some(Boolean) && !cloud.every(Boolean)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CLOUDINARY_CLOUD_NAME'], message: 'CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must be set together' });
    }
    if (cfg.NODE_ENV === 'production' && !cloud.every(Boolean)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CLOUDINARY_CLOUD_NAME'], message: 'Cloudinary credentials are required in production (unit media)' });
    }
    if (cfg.NODE_ENV === 'production' && !cfg.DB_REQUIRE_REPLICA_SET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DB_REQUIRE_REPLICA_SET'],
        message: 'must be true in production (booking relies on transactions)',
      });
    }
  });

export type Env = z.infer<typeof schema>;

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

/**
 * Validates and normalises environment variables. Fails fast with the list of
 * problems. Only variable names and rule messages are reported — never values,
 * so a misconfigured secret cannot leak through the error output.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvError(result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  }
  return result.data;
}

let cached: Env | undefined;
/** Lazily-loaded process-wide config. */
export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}
/** Test helper. */
export function resetEnvCache(): void {
  cached = undefined;
}
