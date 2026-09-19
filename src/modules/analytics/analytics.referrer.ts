/**
 * Stage 10 Part 4 — traffic-source classification.
 *
 * The referrer is categorised once, when the view is written, and stored as an
 * enum. Dashboards then only GROUP BY, instead of re-parsing millions of URL
 * strings on every request.
 *
 * Categories follow the brief:
 *   empty                      → مستقیم
 *   google/bing/yahoo/…        → موتور جستجو
 *   t.me/twitter/x/instagram/… → شبکهٔ اجتماعی
 *   own domain + /news/…       → سایر اخبار سایت
 *   own domain + /             → صفحه اصلی سایت
 *   own domain, other path     → سایر صفحات سایت
 *   anything else              → لینک مستقیم / خارجی
 *
 * The site's own domain comes from PUBLIC_SITE_URL, so staging and production
 * classify their own traffic correctly without a hard-coded hostname.
 */
import type { TrafficSource } from '@prisma/client';

const NEWS_PATH_PREFIX = '/news/';

const SEARCH_HOST_PATTERN =
  /(^|\.)(google\.|bing\.|yahoo\.|duckduckgo\.|yandex\.|baidu\.|ask\.com|ecosia\.|startpage\.|brave\.com|neeva\.|qwant\.)/i;

const SOCIAL_HOSTS = new Set([
  't.me',
  'telegram.me',
  'telegram.org',
  'twitter.com',
  'x.com',
  'instagram.com',
  'facebook.com',
  'fb.com',
  'fb.me',
  'whatsapp.com',
  'linkedin.com',
  'lnkd.in',
  'pinterest.com',
  'reddit.com',
  'threads.net',
  'youtube.com',
  'youtu.be',
  'aparat.com',
  'rubika.ir',
  'eitaa.com',
  'bale.ai',
  'soroush.ir',
]);

/** Lower-cases and drops a leading `www.`; enough for grouping purposes. */
export function registrableDomain(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function matchesHost(host: string, candidate: string): boolean {
  return host === candidate || host.endsWith(`.${candidate}`);
}

export function isSocial(host: string): boolean {
  if (SOCIAL_HOSTS.has(host)) return true;
  for (const social of SOCIAL_HOSTS) {
    if (matchesHost(host, social)) return true;
  }
  // Covers api./web./chat. WhatsApp hosts without listing each one.
  return host.includes('whatsapp');
}

export function classifyReferrer(referrer: string | null, siteUrl: string): TrafficSource {
  if (referrer === null || referrer.trim().length === 0) return 'DIRECT';

  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    // A referrer that is not a URL cannot be attributed to a known source.
    return 'EXTERNAL_LINK';
  }

  const host = registrableDomain(url.hostname);

  let siteHost = '';
  try {
    siteHost = registrableDomain(new URL(siteUrl).hostname);
  } catch {
    siteHost = '';
  }

  if (siteHost.length > 0 && matchesHost(host, siteHost)) {
    const path = url.pathname;
    if (path.startsWith(NEWS_PATH_PREFIX)) return 'INTERNAL_NEWS';
    if (path === '/' || path.length === 0) return 'INTERNAL_HOME';
    return 'INTERNAL_OTHER';
  }

  if (SEARCH_HOST_PATTERN.test(host)) return 'SEARCH_ENGINE';
  if (isSocial(host)) return 'SOCIAL';
  return 'EXTERNAL_LINK';
}
