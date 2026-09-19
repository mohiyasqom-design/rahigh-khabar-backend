/**
 * Stage 10 Part 4 — privacy and bot filtering.
 *
 * The brief is explicit: a raw IP address must never be stored. Instead each
 * view carries sha256(secret + Tehran day + IP + User-Agent), truncated to 32
 * hex characters.
 *
 * Because the day is part of the input, the hash rotates every midnight. That
 * is a deliberate trade-off: unique visitors are exact within a day and
 * comparable between periods, but the same person returning tomorrow is a new
 * hash. The dashboards state this instead of pretending otherwise — and there
 * is no way back from the hash to a person.
 */
import { createHash } from 'node:crypto';
import { analyticsHashSecret } from '../../config/env.js';

/**
 * Crawlers, previewers and scripted clients. Checked before anything is
 * written, so bot traffic never reaches the dashboards.
 */
const NON_HUMAN_PATTERN =
  /bot|crawler|crawling|spider|slurp|bingpreview|yandex|baidu|duckduck|facebookexternalhit|embedly|quora|pinterest|vkshare|whatsapp|telegram|twitterbot|discord|applebot|ia_archiver|semrush|ahrefs|mj12|dotbot|petalbot|serpstat|screaming|lighthouse|pagespeed|headless|phantomjs|puppeteer|playwright|selenium|python-requests|python-urllib|curl\/|wget|okhttp|apache-httpclient|axios\/|go-http-client|libwww|scrapy|feedfetcher|monitoring|uptime/i;

/**
 * A missing or empty User-Agent is treated as non-human: every real browser
 * sends one, and an empty value is the cheapest way to fake a view.
 */
export function isNonHumanClient(userAgent: string | null): boolean {
  if (userAgent === null) return true;
  const trimmed = userAgent.trim();
  if (trimmed.length === 0) return true;
  return NON_HUMAN_PATTERN.test(trimmed);
}

export function visitorIdFor(ip: string, userAgent: string | null, dayKey: string): string {
  const agent = userAgent ?? '';
  return createHash('sha256')
    .update(`${analyticsHashSecret()}|${dayKey}|${ip}|${agent}`)
    .digest('hex')
    .slice(0, 32);
}

/** Trims client-supplied text and enforces a hard length limit. */
export function clampStored(value: string | null | undefined, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length <= maxLength ? trimmed : trimmed.slice(0, maxLength);
}
