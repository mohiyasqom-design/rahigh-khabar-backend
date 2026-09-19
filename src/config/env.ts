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

// A full URL (path allowed), unlike isOrigin which forbids any path.
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname.length > 0 &&
      !url.username && !url.password;
  } catch { return false; }
}

// A blank value in .env means "not configured". Without this, an empty
// GOOGLE_CLIENT_ID would pass as a valid string and OAuth would fail at runtime
// with an opaque Google error instead of a clear "feature disabled" response.
const optionalText = z.string().trim().optional()
  .transform((value) => (value === undefined || value.length === 0 ? undefined : value));
const optionalHttpUrl = optionalText.refine(
  (value) => value === undefined || isHttpUrl(value),
  'Must be an absolute http(s) URL',
);

// Stage 10 Part 4: the last-backup timestamp is configured by hand.
const optionalIsoDateTime = optionalText.refine(
  (value) => value === undefined || !Number.isNaN(Date.parse(value)),
  'Must be an ISO-8601 date-time',
);
const optionalCookieDomain = optionalText.refine(
  (value) => value === undefined || /^\.?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(value),
  'Must be a bare domain such as example.com or .example.com',
);

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
  ANALYTICS_HASH_SECRET: optionalText,
  DB_BACKUP_LAST_AT: optionalIsoDateTime,
  // Stage 10 Part 5 - semantic search. Optional: without a key the search
  // endpoint answers from PostgreSQL full-text only and reports `degraded`.
  OPENAI_API_KEY: optionalText,
  OPENAI_EMBEDDING_MODEL: z.string().trim().min(1).max(100).default('text-embedding-3-small'),
  // Web Push (VAPID). Optional: push endpoints answer 503 when unset.
  VAPID_PUBLIC_KEY: optionalText,
  VAPID_PRIVATE_KEY: optionalText,
  VAPID_SUBJECT: optionalText.refine(
    (value) => value === undefined || value.startsWith('mailto:') || isHttpUrl(value),
    'Must be a mailto: address or an http(s) URL',
  ),
  // In-process publication scheduler.
  SCHEDULER_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(60_000),
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
  // Stage 10 Part 2 - Google OAuth. Optional on purpose: the rest of the API,
  // including the admin panel, must boot and run without Google credentials.
  GOOGLE_CLIENT_ID: optionalText,
  GOOGLE_CLIENT_SECRET: optionalText,
  // Defaults to PUBLIC_API_URL + /auth/google/callback when left empty.
  GOOGLE_CALLBACK_URL: optionalHttpUrl,
  // Only set when the API and the site live on different subdomains of one
  // registrable domain. Empty keeps the visitor cookie host-only, which is safer.
  USER_COOKIE_DOMAIN: optionalCookieDomain,
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

/**
 * Stage 10 Part 4: salt for the daily visitor hash. Falls back to JWT_SECRET
 * so analytics ingest keeps working before a dedicated secret is set.
 */
export function analyticsHashSecret(): string {
  return env.ANALYTICS_HASH_SECRET ?? env.JWT_SECRET;
}

/** Last known database backup time, or null when it was never configured. */
export function lastBackupAt(): Date | null {
  const raw = env.DB_BACKUP_LAST_AT;
  if (raw === undefined) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Google sign-in is an optional feature. Routes check this and answer 503 with
// a machine-readable code instead of crashing on undefined credentials.
export function isGoogleOAuthConfigured(): boolean {
  return env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined;
}

// Single source of truth: the authorize request, the token exchange and the
// Google console entry must all use the exact same redirect URI string.
export function googleCallbackUrl(): string {
  return env.GOOGLE_CALLBACK_URL ?? new URL('/auth/google/callback', env.PUBLIC_API_URL).toString();
}

// Stage 10 Part 5 feature switches. Routes read these and answer a clear 503
// (or degrade gracefully) instead of crashing on undefined credentials.
export function isSemanticSearchConfigured(): boolean {
  return env.OPENAI_API_KEY !== undefined;
}

export function isPushConfigured(): boolean {
  return env.VAPID_PUBLIC_KEY !== undefined && env.VAPID_PRIVATE_KEY !== undefined;
}

/** Contact address sent with every push message, as required by the VAPID spec. */
export function vapidSubject(): string {
  return env.VAPID_SUBJECT ?? `mailto:admin@${new URL(env.PUBLIC_SITE_URL).hostname}`;
}
