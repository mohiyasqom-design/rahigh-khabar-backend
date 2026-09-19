/**
 * Stage 10 Part 4 — request validation.
 *
 * The ingest endpoints are public, so every field is bounded and unknown keys
 * are rejected (`.strict()`). Numbers are coerced because a beacon body may
 * send them as strings.
 */
import type { SharePlatform } from '@prisma/client';
import { z } from 'zod';
import { paginationShape } from '../../utils/validation.js';

const eventNewsId = z.string().trim().min(1).max(128);

export const viewEventSchema = z
  .object({
    /** Absent on the homepage. */
    newsId: eventNewsId.optional(),
    path: z.string().trim().max(512).optional(),
    /** Fallback only: the `Referer` header wins when present. */
    referrer: z.string().trim().max(2048).optional(),
  })
  .strict();

export const readingSessionEventSchema = z
  .object({
    newsId: eventNewsId,
    // Upper bounds are generous here and clamped again in the service against
    // analyticsConfig.maxReadingSessionSeconds.
    durationSeconds: z.coerce.number().int().min(0).max(604_800),
    scrollDepthPercent: z.coerce.number().int().min(0).max(1000),
  })
  .strict();

export const sharePlatformSchema = z.enum([
  'telegram',
  'twitter',
  'whatsapp',
  'copy-link',
  'other',
]);

export const shareEventSchema = z
  .object({ newsId: eventNewsId, platform: sharePlatformSchema })
  .strict();

/** Kebab-case wire values → Prisma enum members. */
export const SHARE_PLATFORM_BY_INPUT = {
  telegram: 'TELEGRAM',
  twitter: 'TWITTER',
  whatsapp: 'WHATSAPP',
  'copy-link': 'COPY_LINK',
  other: 'OTHER',
} as const satisfies Record<z.infer<typeof sharePlatformSchema>, SharePlatform>;

export const overviewRangeSchema = z.enum(['today', 'yesterday', 'week', 'month']);
export const seriesRangeSchema = z.enum(['7d', '30d', '3m', '1y']);
export const newsRangeSchema = z.enum(['24h', '7d', '30d', 'all']);

export const overviewQuerySchema = z
  .object({ range: overviewRangeSchema.default('today') })
  .strict();

export const seriesQuerySchema = z.object({ range: seriesRangeSchema.default('30d') }).strict();

export const topNewsQuerySchema = z
  .object({ ...paginationShape, range: overviewRangeSchema.default('today') })
  .strict();

export const newsAnalyticsQuerySchema = z
  .object({ range: newsRangeSchema.default('all') })
  .strict();

/** 204 has no body; declaring it keeps the route schema explicit. */
export const acceptedResponseSchema = { type: 'null' } as const;

export type ViewEventInput = z.infer<typeof viewEventSchema>;
export type ReadingSessionEventInput = z.infer<typeof readingSessionEventSchema>;
export type ShareEventInput = z.infer<typeof shareEventSchema>;
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;
export type SeriesQuery = z.infer<typeof seriesQuerySchema>;
export type TopNewsQuery = z.infer<typeof topNewsQuerySchema>;
export type NewsAnalyticsQuery = z.infer<typeof newsAnalyticsQuerySchema>;
