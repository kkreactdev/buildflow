import pino from 'pino';

// Reads process.env directly (with safe defaults) so logging works even when full env validation fails.
const LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
const level = LEVELS.includes(process.env.LOG_LEVEL ?? '') ? process.env.LOG_LEVEL : 'info';
const isDev = (process.env.NODE_ENV ?? 'development') === 'development';

/** Structured logging everywhere — no `console.*` (enforced by eslint). */
export const logger = pino({
  level,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.refreshToken',
    ],
    censor: '[redacted]',
  },
  transport:
    isDev
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});
