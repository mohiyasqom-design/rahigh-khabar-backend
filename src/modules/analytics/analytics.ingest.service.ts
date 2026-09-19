/**
 * Stage 10 Part 4 — writing events.
 *
 * Three public endpoints feed this service. Everything defensive happens here,
 * once, instead of being repeated in the routes:
 *  - robots are dropped before anything is written;
 *  - a view for an unknown newsId is dropped (nothing is created for a deleted
 *    article, and the foreign key can never fail);
 *  - client-supplied strings are trimmed to bounded lengths;
 *  - the traffic source is resolved at write time, so dashboards only GROUP BY;
 *  - the visitor is a daily-rotating hash, never an IP address.
 *
 * A dropped event is not an error: the caller answers 204 either way, because a
 * `sendBeacon` cannot react to a failure and view tracking must never break the
 * reading experience.
 */
import type { PrismaClient } from '@prisma/client';
import { analyticsConfig } from '../../config/analytics.config.js';
import { env } from '../../config/env.js';
import { clampStored, isNonHumanClient, visitorIdFor } from './analytics.privacy.js';
import { classifyReferrer } from './analytics.referrer.js';
import {
  SHARE_PLATFORM_BY_INPUT,
  type ReadingSessionEventInput,
  type ShareEventInput,
  type ViewEventInput,
} from './analytics.schema.js';
import { saltDayKey } from './analytics.time.js';

const MAX_REFERRER = 1024;
const MAX_PATH = 512;
const MAX_USER_AGENT = 512;

export type IngestContext = {
  ip: string;
  userAgent: string | null;
  /** The `Referer` header, trusted over a body-supplied referrer. */
  referrerHeader: string | null;
  /** Set when the visitor is signed in, so "active users" can be counted. */
  userId: string | null;
};

export type IngestOutcome = 'recorded' | 'ignored';

async function newsExists(prisma: PrismaClient, newsId: string): Promise<boolean> {
  const found = await prisma.news.findUnique({ where: { id: newsId }, select: { id: true } });
  return found !== null;
}

export async function recordPageView(
  prisma: PrismaClient,
  input: ViewEventInput,
  context: IngestContext,
): Promise<IngestOutcome> {
  if (isNonHumanClient(context.userAgent)) return 'ignored';

  const newsId = input.newsId ?? null;
  if (newsId !== null && !(await newsExists(prisma, newsId))) return 'ignored';

  const referrer = clampStored(context.referrerHeader ?? input.referrer ?? null, MAX_REFERRER);

  await prisma.pageView.create({
    data: {
      newsId,
      userId: context.userId,
      visitorId: visitorIdFor(context.ip, context.userAgent, saltDayKey()),
      path: clampStored(input.path ?? null, MAX_PATH),
      referrer,
      referrerSource: classifyReferrer(referrer, env.PUBLIC_SITE_URL),
      userAgent: clampStored(context.userAgent, MAX_USER_AGENT),
    },
  });

  return 'recorded';
}

export async function recordReadingSession(
  prisma: PrismaClient,
  input: ReadingSessionEventInput,
  context: IngestContext,
): Promise<IngestOutcome> {
  if (isNonHumanClient(context.userAgent)) return 'ignored';
  if (!(await newsExists(prisma, input.newsId))) return 'ignored';

  // A tab left open overnight must not drag the average reading time upwards.
  const durationSeconds = Math.min(
    Math.max(Math.round(input.durationSeconds), 0),
    analyticsConfig.maxReadingSessionSeconds,
  );
  const scrollDepthPercent = Math.min(Math.max(Math.round(input.scrollDepthPercent), 0), 100);

  await prisma.readingSession.create({
    data: {
      newsId: input.newsId,
      visitorId: visitorIdFor(context.ip, context.userAgent, saltDayKey()),
      durationSeconds,
      scrollDepthPercent,
    },
  });

  return 'recorded';
}

export async function recordShare(
  prisma: PrismaClient,
  input: ShareEventInput,
  context: IngestContext,
): Promise<IngestOutcome> {
  if (isNonHumanClient(context.userAgent)) return 'ignored';
  if (!(await newsExists(prisma, input.newsId))) return 'ignored';

  await prisma.shareEvent.create({
    data: { newsId: input.newsId, platform: SHARE_PLATFORM_BY_INPUT[input.platform] },
  });

  return 'recorded';
}
