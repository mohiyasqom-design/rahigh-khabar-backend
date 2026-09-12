import { config } from 'dotenv';
import { z } from 'zod';
import { isIP } from 'node:net';
import { parseTokenLifetime } from './token-lifetime.js';

const dotenvResult = config();
if (dotenvResult.error && (dotenvResult.error as NodeJS.ErrnoException).code !== 'ENOENT') {
  process.stderr.write('Configuration error: unable to read .env. Check file permissions.\n');
  process.exit(1);
}

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname.length > 0 &&
      url.pathname.length > 1 && url.hash === '';
  } catch { return false; }
}

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value && !url.username && !url.password;
  } catch { return false; }
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1).refine(isPostgresUrl),
  CORS_ORIGIN: z.string().min(1).refine(isOrigin),
  PUBLIC_SITE_URL: z.string().min(1).refine(isOrigin),
  PUBLIC_API_URL: z.string().min(1).refine(isOrigin),
  MAX_UPLOAD_SIZE_BYTES: z.coerce.number().int().min(1).max(52_428_800).default(5_242_880),
  UPLOAD_DIR: z.string().trim().min(1).refine((value) => !value.includes('\0')).default('uploads'),
  JWT_SECRET: z.string().min(32).max(1024).refine((value) => value.trim().length >= 32),
  JWT_EXPIRES_IN: z.string().default('1h').transform((value, ctx) => {
    const seconds = parseTokenLifetime(value);
    if (seconds === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid token lifetime' });
      return z.NEVER;
    }
    return seconds;
  }),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100).default(5),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(86_400_000).default(900_000),
  // Never trust forwarded headers unless an operator explicitly defines proxy IPs.
  TRUST_PROXY: z.string().default('').transform((value) =>
    value.split(',').map((item) => item.trim()).filter(Boolean),
  ).refine((items) => items.every((item) => {
    const [address, prefix, extra] = item.split('/');
    const family = isIP(address ?? '');
    return family !== 0 && extra === undefined && (
      prefix === undefined || (/^\d+$/.test(prefix) && Number(prefix) > 0 && Number(prefix) <= (family === 4 ? 32 : 128))
    );
  })),
});

const result = schema.safeParse(process.env);
if (!result.success) {
  // Never print Zod issues or their input values: they can contain secrets.
  const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
  process.stderr.write(
    `Configuration error: missing or invalid ${fields.join(', ')}. ` +
    'Copy .env.example to .env and configure it, or supply environment variables. ' +
    'DATABASE_URL must be a PostgreSQL URL; CORS_ORIGIN, PUBLIC_SITE_URL and PUBLIC_API_URL must be exact HTTP(S) origins without trailing slashes. ' +
    'JWT_SECRET needs at least 32 characters; JWT_EXPIRES_IN accepts 60s through 7d.\n',
  );
  process.exit(1);
}
export const env = Object.freeze(result.data);
