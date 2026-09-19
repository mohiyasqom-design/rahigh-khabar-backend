/**
 * Stage 10 Part 4 — time helpers.
 *
 * Every dashboard range is expressed in Tehran local time, because "today" on
 * an admin dashboard means the editor's today, not UTC's. Iran abolished DST in
 * 2022, so a fixed +03:30 offset is correct and far cheaper than running every
 * boundary through Intl. The one place a calendar library is genuinely needed
 * is the start of the Persian month, which uses ICU.
 *
 * Bucket keys are produced here in exactly the same format as the SQL
 * `to_char(...)` expressions in `analytics.queries.ts`, so gaps can be filled
 * in JavaScript without a second round-trip to the database.
 */
import { analyticsConfig } from '../../config/analytics.config.js';

export const ANALYTICS_TIME_ZONE = 'Asia/Tehran';
export const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const OFFSET_MS = 3.5 * HOUR_MS;
/** Safety valve so a hand-made range can never generate a huge array. */
export const MAX_BUCKETS = 800;

export type BucketUnit = 'hour' | 'day' | 'month';
export type Period = { from: Date; to: Date };
export type ResolvedRange = Period & { unit: BucketUnit };

export type OverviewRangeKey = 'today' | 'yesterday' | 'week' | 'month';
export type SeriesRangeKey = '7d' | '30d' | '3m' | '1y';
export type NewsRangeKey = '24h' | '7d' | '30d' | 'all';

/** Shifts an instant so UTC getters read as Tehran wall-clock values. */
function toLocal(date: Date): Date {
  return new Date(date.getTime() + OFFSET_MS);
}

function fromLocal(local: Date): Date {
  return new Date(local.getTime() - OFFSET_MS);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function startOfHour(date: Date): Date {
  const local = toLocal(date);
  local.setUTCMinutes(0, 0, 0);
  return fromLocal(local);
}

export function startOfDay(date: Date): Date {
  const local = toLocal(date);
  local.setUTCHours(0, 0, 0, 0);
  return fromLocal(local);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function startOfNextDay(date: Date): Date {
  return addDays(startOfDay(date), 1);
}

/** The Persian week starts on Saturday. */
export function startOfWeek(date: Date): Date {
  const local = toLocal(date);
  const offset = (local.getUTCDay() + 1) % 7;
  return addDays(startOfDay(date), -offset);
}

export function addMonths(date: Date, months: number): Date {
  const local = toLocal(date);
  local.setUTCMonth(local.getUTCMonth() + months);
  return fromLocal(local);
}

/** Gregorian month start, used only for month-sized chart buckets. */
export function startOfGregorianMonth(date: Date): Date {
  const local = toLocal(date);
  local.setUTCDate(1);
  local.setUTCHours(0, 0, 0, 0);
  return fromLocal(local);
}

function persianDayOfMonth(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
    timeZone: ANALYTICS_TIME_ZONE,
    day: 'numeric',
  }).formatToParts(date);
  const dayPart = parts.find((part) => part.type === 'day');
  const day = dayPart === undefined ? 1 : Number.parseInt(dayPart.value, 10);
  return Number.isFinite(day) && day > 0 ? day : 1;
}

/**
 * Start of the current Persian month. «این ماه» on a Persian dashboard means
 * the Jalali month, not the Gregorian one.
 */
export function startOfPersianMonth(date: Date): Date {
  return addDays(startOfDay(date), -(persianDayOfMonth(date) - 1));
}

/** Must match the `to_char` formats used by the SQL aggregates. */
export function bucketKey(date: Date, unit: BucketUnit): string {
  const local = toLocal(date);
  const year = local.getUTCFullYear();
  const month = pad(local.getUTCMonth() + 1);
  const day = pad(local.getUTCDate());
  if (unit === 'month') return `${year}-${month}`;
  if (unit === 'day') return `${year}-${month}-${day}`;
  return `${year}-${month}-${day}T${pad(local.getUTCHours())}:00`;
}

/** Every bucket in the range, including the empty ones a chart must show. */
export function bucketKeys(range: Period, unit: BucketUnit): string[] {
  const keys: string[] = [];
  let cursor =
    unit === 'hour'
      ? startOfHour(range.from)
      : unit === 'day'
        ? startOfDay(range.from)
        : startOfGregorianMonth(range.from);

  for (let guard = 0; cursor.getTime() < range.to.getTime() && guard < MAX_BUCKETS; guard += 1) {
    keys.push(bucketKey(cursor, unit));
    cursor =
      unit === 'hour'
        ? new Date(cursor.getTime() + HOUR_MS)
        : unit === 'day'
          ? addDays(cursor, 1)
          : addMonths(cursor, 1);
  }

  return keys;
}

/** The equally long period immediately before this one, for "vs previous". */
export function previousPeriod(range: Period): Period {
  const length = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - length), to: range.from };
}

export function resolveOverviewRange(key: OverviewRangeKey, now: Date): ResolvedRange {
  switch (key) {
    case 'today':
      return { from: startOfDay(now), to: startOfNextDay(now), unit: 'hour' };
    case 'yesterday':
      return { from: addDays(startOfDay(now), -1), to: startOfDay(now), unit: 'hour' };
    case 'week':
      return { from: startOfWeek(now), to: startOfNextDay(now), unit: 'day' };
    case 'month':
      return { from: startOfPersianMonth(now), to: startOfNextDay(now), unit: 'day' };
  }
}

export const SERIES_DAYS: Record<Exclude<SeriesRangeKey, '1y'>, number> = {
  '7d': 7,
  '30d': 30,
  '3m': 90,
};

export function resolveSeriesRange(key: SeriesRangeKey, now: Date): ResolvedRange {
  if (key === '1y') {
    // Twelve month-sized buckets read far better than 365 daily points.
    return {
      from: startOfGregorianMonth(addMonths(startOfDay(now), -11)),
      to: startOfNextDay(now),
      unit: 'month',
    };
  }
  const days = SERIES_DAYS[key];
  return {
    from: addDays(startOfDay(now), -(days - 1)),
    to: startOfNextDay(now),
    unit: 'day',
  };
}

/**
 * Ranges for one article. `all` starts at publication (or creation, for an
 * unpublished draft) and switches to monthly buckets for very old articles.
 */
export function resolveNewsRange(key: NewsRangeKey, anchor: Date, now: Date): ResolvedRange {
  switch (key) {
    case '24h':
      return { from: startOfHour(new Date(now.getTime() - 23 * HOUR_MS)), to: new Date(now.getTime() + HOUR_MS), unit: 'hour' };
    case '7d':
      return { from: addDays(startOfDay(now), -6), to: startOfNextDay(now), unit: 'day' };
    case '30d':
      return { from: addDays(startOfDay(now), -29), to: startOfNextDay(now), unit: 'day' };
    case 'all': {
      const from = startOfDay(anchor);
      const to = startOfNextDay(now);
      const spanDays = Math.ceil((to.getTime() - from.getTime()) / DAY_MS);
      return { from, to, unit: spanDays > analyticsConfig.dailyBucketMaxDays ? 'month' : 'day' };
    }
  }
}

/**
 * Growth against the previous period. null when the previous period is zero:
 * "+∞%" is not a number a dashboard should print, and the UI shows «—» instead.
 */
export function changePercent(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Daily salt component for the visitor hash, in Tehran time. */
export function saltDayKey(date: Date = new Date()): string {
  return bucketKey(date, 'day');
}
