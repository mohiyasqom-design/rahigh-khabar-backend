import type { Prisma, PrismaClient } from '@prisma/client';
import webpush from 'web-push';
import { env, isPushConfigured, vapidSubject } from '../../config/env.js';

// Sending in batches keeps memory flat and avoids opening hundreds of sockets
// at once when the subscriber list grows.
const BATCH_SIZE = 25;

let configured = false;
function ensureConfigured(): boolean {
  if (!isPushConfigured()) return false;
  if (!configured) {
    webpush.setVapidDetails(vapidSubject(), env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
    configured = true;
  }
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export interface DeliveryReport {
  sent: number;
  failed: number;
  removed: number;
}

export async function subscribe(
  prisma: PrismaClient,
  input: { endpoint: string; keys: { p256dh: string; auth: string } },
  userId: string | null,
  userAgent: string | null,
) {
  // The browser reuses one endpoint per subscription, so upsert instead of
  // creating duplicates that would each receive the same notification.
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: userAgent?.slice(0, 200) ?? null,
      userId,
    },
    update: {
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: userAgent?.slice(0, 200) ?? null,
      userId,
      lastSeenAt: new Date(),
    },
  });
}

export async function unsubscribe(prisma: PrismaClient, endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

export function countSubscribers(prisma: PrismaClient): Promise<number> {
  return prisma.pushSubscription.count();
}

interface Target {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Sends one payload to the given endpoints. Gone endpoints (404/410) are
 * deleted: they can never work again, and keeping them would slowly turn every
 * broadcast into a list of failures.
 */
async function deliver(
  prisma: PrismaClient, targets: Target[], payload: PushPayload,
): Promise<DeliveryReport> {
  const report: DeliveryReport = { sent: 0, failed: 0, removed: 0 };
  if (!ensureConfigured() || targets.length === 0) return report;
  const body = JSON.stringify(payload);
  const stale: string[] = [];

  for (let index = 0; index < targets.length; index += BATCH_SIZE) {
    const batch = targets.slice(index, index + BATCH_SIZE);
    const outcomes = await Promise.allSettled(batch.map((target) => webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      body,
      { TTL: 3600 },
    )));
    outcomes.forEach((outcome, position) => {
      if (outcome.status === 'fulfilled') {
        report.sent += 1;
        return;
      }
      report.failed += 1;
      const status = (outcome.reason as { statusCode?: number } | undefined)?.statusCode;
      if (status === 404 || status === 410) stale.push(batch[position]!.id);
    });
  }

  if (stale.length > 0) {
    const result = await prisma.pushSubscription.deleteMany({ where: { id: { in: stale } } });
    report.removed = result.count;
  }
  return report;
}

/** Broadcast from the admin panel, optionally limited to one category's followers. */
export async function broadcast(
  prisma: PrismaClient,
  payload: PushPayload,
  categoryId?: string,
): Promise<DeliveryReport> {
  const targets = await prisma.pushSubscription.findMany({
    where: categoryId
      ? { user: { follows: { some: { categoryId } } } }
      : {},
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  return deliver(prisma, targets, payload);
}

/**
 * Called after an article is published (manually or by the scheduler). Only
 * followers of one of its categories are notified; anonymous subscribers
 * receive nothing so the feature cannot turn into spam.
 */
export async function announcePublishedNews(
  prisma: PrismaClient,
  news: { title: string; slug: string; lead?: string | null },
  categoryIds: string[],
): Promise<DeliveryReport> {
  if (!isPushConfigured()) {
    return { sent: 0, failed: 0, removed: 0 };
  }
  // Two audiences, not one: subscribers who follow one of the article's
  // categories, plus anonymous device subscriptions that belong to no account
  // and therefore cannot follow anything. Limiting delivery to followers only
  // meant a visitor who allowed notifications without signing in never
  // received a single one, which is not what the permission prompt promised.
  const audience: Prisma.PushSubscriptionWhereInput[] = [{ userId: null }];
  if (categoryIds.length > 0) {
    audience.push({ user: { follows: { some: { categoryId: { in: categoryIds } } } } });
  }
  const targets = await prisma.pushSubscription.findMany({
    where: { OR: audience },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  return deliver(prisma, targets, {
    title: news.title.slice(0, 100),
    body: (news.lead ?? '').slice(0, 200),
    url: `${env.PUBLIC_SITE_URL}/news/${news.slug}`,
  });
}
