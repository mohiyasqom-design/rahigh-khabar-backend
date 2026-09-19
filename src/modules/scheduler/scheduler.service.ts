import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { env } from '../../config/env.js';
import { announcePublishedNews } from '../push/push.service.js';
import { syncNewsEmbedding } from '../search/embedding.service.js';

// A backlog is drained across ticks instead of inside one long transaction
// that would hold locks on the news table.
const BATCH_SIZE = 20;

/**
 * Publishes every article whose `scheduledFor` has passed.
 *
 * The conditional `updateMany` (status must still be SCHEDULED) is the
 * concurrency guard: if two instances tick simultaneously, only one of them
 * updates a given row, so the notification is sent exactly once.
 */
export async function publishDueNews(app: FastifyInstance): Promise<number> {
  const due = await app.prisma.news.findMany({
    where: { status: 'SCHEDULED', scheduledFor: { not: null, lte: new Date() } },
    select: {
      id: true, title: true, slug: true, lead: true, publishedAt: true,
      categories: { select: { categoryId: true } },
    },
    orderBy: { scheduledFor: 'asc' },
    take: BATCH_SIZE,
  });
  let published = 0;
  for (const item of due) {
    const result = await app.prisma.news.updateMany({
      where: { id: item.id, status: 'SCHEDULED' },
      data: {
        status: 'PUBLISHED',
        publishedAt: item.publishedAt ?? new Date(),
        scheduledFor: null,
      },
    });
    if (result.count === 0) continue;
    published += 1;
    const outcomes = await Promise.allSettled([
      announcePublishedNews(app.prisma, item, item.categories.map((link) => link.categoryId)),
      syncNewsEmbedding(app.prisma, item.id),
    ]);
    outcomes.forEach((outcome) => {
      if (outcome.status === 'rejected') {
        app.log.warn({ newsId: item.id }, 'scheduled publish side-effect failed');
      }
    });
    app.log.info({ newsId: item.id, slug: item.slug }, 'scheduled news published');
  }
  return published;
}

export interface Scheduler {
  start(): void;
  stop(): void;
  tick(): Promise<number>;
}

/**
 * In-process interval scheduler. Deliberately not a separate cron service:
 * the specification keeps that as a future scaling option only.
 */
export function createScheduler(app: FastifyInstance, intervalMs: number): Scheduler {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  const tick = async (): Promise<number> => {
    // Overlap guard: a slow tick must not start a second pass.
    if (running) return 0;
    running = true;
    try {
      return await publishDueNews(app);
    } catch (error) {
      app.log.error({ err: error }, 'scheduler tick failed');
      return 0;
    } finally {
      running = false;
    }
  };
  return {
    tick,
    start() {
      if (timer) return;
      timer = setInterval(() => { void tick(); }, intervalMs);
      // Never keep the Node process alive just for the scheduler.
      timer.unref();
      void tick();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
}

const schedulerPlugin: FastifyPluginAsync = fp(async (app) => {
  const scheduler = createScheduler(app, env.SCHEDULER_INTERVAL_MS);
  app.decorate('scheduler', scheduler);
  app.addHook('onReady', async () => {
    if (!env.SCHEDULER_ENABLED) {
      app.log.warn('publication scheduler disabled by configuration');
      return;
    }
    scheduler.start();
    app.log.info({ intervalMs: env.SCHEDULER_INTERVAL_MS }, 'publication scheduler started');
  });
  app.addHook('onClose', async () => { scheduler.stop(); });
}, { name: 'scheduler-plugin' });

declare module 'fastify' {
  interface FastifyInstance {
    scheduler: Scheduler;
  }
}

export default schedulerPlugin;
