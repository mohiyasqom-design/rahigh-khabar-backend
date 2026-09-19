/**
 * Stage 10 Part 4 — per-article analytics, including the performance score.
 *
 * The score follows the brief exactly: five components, each normalised
 * against the average of up to 20 similar articles (same category, published
 * in the last 30 days), combined with the weights from
 * `src/config/analytics.config.ts`.
 *
 * Where a number cannot be computed honestly it is null with a reason:
 *  - no views at all → no score (NO_VIEWS)
 *  - no similar article to compare with → no score (NO_COMPARISON_DATA)
 *  - no reading session recorded → no average time, scroll depth or bounce rate
 * The dashboard shows «داده کافی نیست» in those cases instead of a zero.
 */
import type { PrismaClient, TrafficSource } from '@prisma/client';
import {
  analyticsConfig,
  performanceScoreConfig,
  performanceScoreWeights,
  type PerformanceScoreComponent,
} from '../../config/analytics.config.js';
import {
  launchCheckpointViews,
  trafficSourceRows,
  uniqueVisitorCount,
  viewBuckets,
} from './analytics.queries.js';
import {
  addDays,
  bucketKeys,
  resolveNewsRange,
  startOfDay,
  type BucketUnit,
  type NewsRangeKey,
  type Period,
} from './analytics.time.js';

/** Fixed display order for the traffic-source chart. */
export const TRAFFIC_SOURCES: readonly TrafficSource[] = [
  'DIRECT',
  'SEARCH_ENGINE',
  'SOCIAL',
  'INTERNAL_NEWS',
  'INTERNAL_HOME',
  'INTERNAL_OTHER',
  'EXTERNAL_LINK',
];

export const TRAFFIC_SOURCE_LABELS: Record<TrafficSource, string> = {
  DIRECT: 'مستقیم',
  SEARCH_ENGINE: 'موتور جستجو',
  SOCIAL: 'شبکهٔ اجتماعی',
  INTERNAL_NEWS: 'سایر اخبار سایت',
  INTERNAL_HOME: 'صفحه اصلی سایت',
  INTERNAL_OTHER: 'سایر صفحات سایت',
  EXTERNAL_LINK: 'لینک مستقیم / خارجی',
};

/** Push notifications do not exist in this project, so the share is always 0. */
export const NOTIFICATION_NOTE =
  'اعلان (Push Notification) در این پروژه پیاده‌سازی نشده است؛ این سهم همیشه صفر است.';
export const NOT_ENOUGH_DATA = 'داده کافی نیست';
const VISITOR_NOTE =
  'شناسهٔ بازدیدکننده هر روز تغییر می‌کند؛ بازدیدکننده‌ای که در دو روز مختلف برگردد، دو بار شمرده می‌شود (سقف بالا).';
const BOUNCE_NOTE =
  'نرخ پرش = نشست‌های کوتاه‌تر از ۵ ثانیه تقسیم بر کل بازدیدها. برای بازدیدهایی که مرورگر نشست را ارسال نکرده، نشستی ثبت نشده است؛ پس این عدد کمینه است.';
const NOT_PUBLISHED_NOTE =
  'این خبر هنوز منتشر نشده است، پس لحطهٔ انتشار قابل محاسبه نیست.';

export type ScoreBand = 'good' | 'average' | 'weak';

const BAND_MESSAGE: Record<ScoreBand, string> = {
  good: 'عملکرد بسیار خوب',
  average: 'عملکرد متوسط',
  weak: 'عملکرد ضعیف‌تر از میانگین',
};

const ATTENTION_MESSAGE =
  'بازدید اولیه خوب بوده اما تعامل کاربران پایین‌تر از میانگین است';

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** null when there are no views: dividing by zero is not a 0% engagement rate. */
export function engagementRate(
  likes: number,
  comments: number,
  shares: number,
  views: number,
): number | null {
  if (views <= 0) return null;
  return round1(((likes + comments + shares) / views) * 100);
}

/**
 * Maps a raw value onto 0..100 where the peer average sits at 50 and twice the
 * average reaches the ceiling.
 */
export function normalise(value: number, average: number): number {
  const { averageScore, maxScore } = performanceScoreConfig.normalisation;
  if (average <= 0) return value > 0 ? maxScore : 0;
  return Math.max(0, Math.min(maxScore, (value / average) * averageScore));
}

function diffPercent(value: number, average: number): number | null {
  if (average <= 0) return null;
  return round1(((value - average) / average) * 100);
}

export type ScoreComponent = {
  component: PerformanceScoreComponent;
  weight: number;
  value: number;
  average: number | null;
  normalised: number;
  weighted: number;
};

export type NewsAnalytics = {
  news: {
    id: string;
    title: string;
    slug: string;
    status: string;
    publishedAt: string | null;
    createdAt: string;
    categories: Array<{ id: string; name: string }>;
  };
  range: { key: NewsRangeKey; from: string; to: string; unit: BucketUnit };
  generatedAt: string;
  cards: {
    views: number;
    uniqueVisitors: { value: number; basis: 'DAILY_ROTATING_HASH'; note: string };
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    averageReadingSeconds: number | null;
    engagementRatePercent: number | null;
  };
  series: {
    totalViews: number;
    points: Array<{ bucket: string; views: number; visitors: number }>;
  };
  launch: {
    publishedAt: string | null;
    note: string | null;
    checkpoints: Array<{ hours: number; views: number | null; elapsed: boolean }>;
  };
  trafficSources: {
    totalViews: number;
    items: Array<{ source: TrafficSource; label: string; views: number; sharePercent: number }>;
    notification: { implemented: false; views: 0; note: string };
  };
  behavior: {
    readingSessions: number;
    averageReadingSeconds: number | null;
    averageScrollDepthPercent: number | null;
    bounceRatePercent: number | null;
    bounce: {
      basis: 'READING_SESSIONS_OVER_VIEWS';
      shortSessions: number;
      views: number;
      maxSeconds: number;
      note: string;
    };
  };
  comparison: {
    sampleSize: number;
    requestedSampleSize: number;
    windowDays: number;
    note: string | null;
    averages: {
      views: number;
      engagementRatePercent: number;
      readingSeconds: number;
      shares: number;
    } | null;
    diff: {
      viewsPercent: number | null;
      engagementPercent: number | null;
      readingTimePercent: number | null;
    } | null;
    rank: number | null;
    rankOutOf: number;
  };
  performance: {
    score: number | null;
    band: ScoreBand | null;
    message: string;
    reason: 'NO_VIEWS' | 'NO_COMPARISON_DATA' | null;
    components: ScoreComponent[];
    weights: Record<PerformanceScoreComponent, number>;
  };
};

function component(
  name: PerformanceScoreComponent,
  value: number,
  average: number,
): ScoreComponent {
  const weight = performanceScoreWeights[name];
  const normalised = normalise(value, average);
  return {
    component: name,
    weight,
    value: round1(value),
    average: round1(average),
    normalised: round1(normalised),
    weighted: round1(normalised * weight),
  };
}

function averageOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function getNewsAnalytics(
  prisma: PrismaClient,
  newsId: string,
  rangeKey: NewsRangeKey,
  now = new Date(),
): Promise<NewsAnalytics | null> {
  const article = await prisma.news.findUnique({
    where: { id: newsId },
    select: { id: true, title: true, slug: true, status: true, publishedAt: true, createdAt: true },
  });
  if (article === null) return null;

  const links = await prisma.newsCategory.findMany({
    where: { newsId },
    select: { categoryId: true },
  });
  const categoryIds = links.map((link) => link.categoryId);
  const categories =
    categoryIds.length === 0
      ? []
      : await prisma.category.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, name: true },
          orderBy: { order: 'asc' },
        });

  const anchor = article.publishedAt ?? article.createdAt;
  const range = resolveNewsRange(rangeKey, anchor, now);
  const allTime: Period = { from: new Date(0), to: new Date(now.getTime() + 1) };
  const { sampleSize, windowDays } = performanceScoreConfig.comparison;
  const comparisonFrom = addDays(startOfDay(now), -windowDays);

  const [
    views,
    uniqueVisitors,
    likes,
    comments,
    shares,
    saves,
    readingAggregate,
    shortSessions,
    bucketRows,
    sourceRows,
    peers,
  ] = await Promise.all([
    prisma.pageView.count({ where: { newsId } }),
    uniqueVisitorCount(prisma, allTime, newsId),
    prisma.like.count({ where: { newsId } }),
    prisma.comment.count({ where: { newsId, isDeleted: false } }),
    prisma.shareEvent.count({ where: { newsId } }),
    prisma.savedNews.count({ where: { newsId } }),
    prisma.readingSession.aggregate({
      where: { newsId },
      _avg: { durationSeconds: true, scrollDepthPercent: true },
      _count: { _all: true },
    }),
    prisma.readingSession.count({
      where: { newsId, durationSeconds: { lt: analyticsConfig.bounceMaxSeconds } },
    }),
    viewBuckets(prisma, range, range.unit, newsId),
    trafficSourceRows(prisma, allTime, newsId),
    categoryIds.length === 0
      ? Promise.resolve([] as Array<{ id: string }>)
      : prisma.news.findMany({
          where: {
            id: { not: newsId },
            status: 'PUBLISHED',
            publishedAt: { gte: comparisonFrom, lte: now },
            categories: { some: { categoryId: { in: categoryIds } } },
          },
          orderBy: [{ publishedAt: 'desc' }],
          take: sampleSize,
          select: { id: true },
        }),
  ]);

  const peerIds = peers.map((peer) => peer.id);
  const [peerViews, peerLikes, peerComments, peerShares, peerReading] = await Promise.all([
    peerIds.length === 0
      ? []
      : prisma.pageView.groupBy({
          by: ['newsId'],
          where: { newsId: { in: peerIds } },
          _count: { _all: true },
        }),
    peerIds.length === 0
      ? []
      : prisma.like.groupBy({
          by: ['newsId'],
          where: { newsId: { in: peerIds } },
          _count: { _all: true },
        }),
    peerIds.length === 0
      ? []
      : prisma.comment.groupBy({
          by: ['newsId'],
          where: { newsId: { in: peerIds }, isDeleted: false },
          _count: { _all: true },
        }),
    peerIds.length === 0
      ? []
      : prisma.shareEvent.groupBy({
          by: ['newsId'],
          where: { newsId: { in: peerIds } },
          _count: { _all: true },
        }),
    peerIds.length === 0
      ? []
      : prisma.readingSession.groupBy({
          by: ['newsId'],
          where: { newsId: { in: peerIds } },
          _avg: { durationSeconds: true },
        }),
  ]);

  const viewsById = new Map(peerViews.map((row) => [row.newsId, row._count._all]));
  const likesById = new Map(peerLikes.map((row) => [row.newsId, row._count._all]));
  const commentsById = new Map(peerComments.map((row) => [row.newsId, row._count._all]));
  const sharesById = new Map(peerShares.map((row) => [row.newsId, row._count._all]));
  const readingById = new Map(peerReading.map((row) => [row.newsId, row._avg.durationSeconds ?? 0]));

  const peerMetrics = peerIds.map((id) => {
    const peerViewCount = viewsById.get(id) ?? 0;
    const peerLikeCount = likesById.get(id) ?? 0;
    const peerCommentCount = commentsById.get(id) ?? 0;
    const peerShareCount = sharesById.get(id) ?? 0;
    return {
      id,
      views: peerViewCount,
      shares: peerShareCount,
      readingSeconds: readingById.get(id) ?? 0,
      engagement:
        engagementRate(peerLikeCount, peerCommentCount, peerShareCount, peerViewCount) ?? 0,
    };
  });

  const readingSessions = readingAggregate._count._all;
  const averageReadingSeconds =
    readingSessions === 0 ? null : round1(readingAggregate._avg.durationSeconds ?? 0);
  const averageScrollDepthPercent =
    readingSessions === 0 ? null : round1(readingAggregate._avg.scrollDepthPercent ?? 0);
  const engagement = engagementRate(likes, comments, shares, views);
  const bounceRatePercent = views === 0 ? null : round1((shortSessions / views) * 100);

  const sourceByKey = new Map(sourceRows.map((row) => [row.source, row.views]));
  const trafficTotal = sourceRows.reduce((sum, row) => sum + row.views, 0);

  const checkpointHours = analyticsConfig.launchCheckpointHours;
  const checkpointViews =
    article.publishedAt === null
      ? null
      : await launchCheckpointViews(prisma, newsId, article.publishedAt, checkpointHours);

  const hasComparison = peerMetrics.length > 0;
  const averages = hasComparison
    ? {
        views: averageOf(peerMetrics.map((peer) => peer.views)),
        engagement: averageOf(peerMetrics.map((peer) => peer.engagement)),
        readingSeconds: averageOf(peerMetrics.map((peer) => peer.readingSeconds)),
        shares: averageOf(peerMetrics.map((peer) => peer.shares)),
      }
    : null;

  // Rank of this article among itself + its peers, by views.
  const rankedViews = [views, ...peerMetrics.map((peer) => peer.views)].sort((a, b) => b - a);
  const rankOutOf = rankedViews.length;
  const rank = hasComparison ? rankedViews.indexOf(views) + 1 : null;

  let score: number | null = null;
  let band: ScoreBand | null = null;
  let message = NOT_ENOUGH_DATA;
  let reason: 'NO_VIEWS' | 'NO_COMPARISON_DATA' | null = null;
  const components: ScoreComponent[] = [];

  if (views === 0) {
    reason = 'NO_VIEWS';
  } else if (averages === null || rank === null) {
    reason = 'NO_COMPARISON_DATA';
  } else {
    const rankScore = ((rankOutOf - rank + 1) / rankOutOf) * 100;
    components.push(
      component('views', views, averages.views),
      component('engagement', engagement ?? 0, averages.engagement),
      component('readingTime', averageReadingSeconds ?? 0, averages.readingSeconds),
      component('shares', shares, averages.shares),
      // Already a 0..100 value, so it has no peer average of its own.
      {
        component: 'relativeRank',
        weight: performanceScoreWeights.relativeRank,
        value: rank,
        average: null,
        normalised: round1(rankScore),
        weighted: round1(rankScore * performanceScoreWeights.relativeRank),
      },
    );

    score =
      Math.round(components.reduce((sum, item) => sum + item.normalised * item.weight, 0) * 10) / 10;

    band =
      score > performanceScoreConfig.bands.good
        ? 'good'
        : score >= performanceScoreConfig.bands.average
          ? 'average'
          : 'weak';
    message = BAND_MESSAGE[band];

    // Special case from the brief: plenty of views, little interaction.
    const { highViewsRatio, lowEngagementRatio } = performanceScoreConfig.attentionRules;
    const highViews = averages.views > 0 && views >= averages.views * highViewsRatio;
    const lowEngagement =
      averages.engagement > 0 && (engagement ?? 0) <= averages.engagement * lowEngagementRatio;
    if (highViews && lowEngagement) message = ATTENTION_MESSAGE;
  }

  const comparisonNote =
    peerMetrics.length === 0
      ? categoryIds.length === 0
        ? 'این خبر دسته‌بندی ندارد، پس خبر مشابهی برای مقایسه پیدا نشد.'
        : 'در ۳۰ روز گذشته خبر مشابهی (همان دسته‌بندی) برای مقایسه منتشر نشده است.'
      : peerMetrics.length < sampleSize
        ? `مقایسه بر پایهٔ ${peerMetrics.length} خبر واقعی انجام شده است (کمتر از ${sampleSize} خبر مشابه در دسترس بود).`
        : null;

  const points = ((): Array<{ bucket: string; views: number; visitors: number }> => {
    const byBucket = new Map(bucketRows.map((row) => [row.bucket, row]));
    return bucketKeys(range, range.unit).map((bucket) => {
      const row = byBucket.get(bucket);
      return { bucket, views: row?.views ?? 0, visitors: row?.visitors ?? 0 };
    });
  })();

  return {
    news: {
      id: article.id,
      title: article.title,
      slug: article.slug,
      status: article.status,
      publishedAt: article.publishedAt === null ? null : article.publishedAt.toISOString(),
      createdAt: article.createdAt.toISOString(),
      categories: categories.map((category) => ({ id: category.id, name: category.name })),
    },
    range: {
      key: rangeKey,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      unit: range.unit,
    },
    generatedAt: now.toISOString(),
    cards: {
      views,
      uniqueVisitors: { value: uniqueVisitors, basis: 'DAILY_ROTATING_HASH', note: VISITOR_NOTE },
      likes,
      comments,
      shares,
      saves,
      averageReadingSeconds,
      engagementRatePercent: engagement,
    },
    series: { totalViews: points.reduce((sum, point) => sum + point.views, 0), points },
    launch: {
      publishedAt: article.publishedAt === null ? null : article.publishedAt.toISOString(),
      note: article.publishedAt === null ? NOT_PUBLISHED_NOTE : null,
      checkpoints: checkpointHours.map((hours, index) => {
        const elapsed =
          article.publishedAt !== null &&
          now.getTime() >= article.publishedAt.getTime() + hours * 3_600_000;
        return {
          hours,
          views: checkpointViews === null ? null : (checkpointViews[index] ?? 0),
          elapsed,
        };
      }),
    },
    trafficSources: {
      totalViews: trafficTotal,
      items: TRAFFIC_SOURCES.map((source) => {
        const sourceViews = sourceByKey.get(source) ?? 0;
        return {
          source,
          label: TRAFFIC_SOURCE_LABELS[source],
          views: sourceViews,
          sharePercent: trafficTotal === 0 ? 0 : round1((sourceViews / trafficTotal) * 100),
        };
      }),
      notification: { implemented: false, views: 0, note: NOTIFICATION_NOTE },
    },
    behavior: {
      readingSessions,
      averageReadingSeconds,
      averageScrollDepthPercent,
      bounceRatePercent,
      bounce: {
        basis: 'READING_SESSIONS_OVER_VIEWS',
        shortSessions,
        views,
        maxSeconds: analyticsConfig.bounceMaxSeconds,
        note: BOUNCE_NOTE,
      },
    },
    comparison: {
      sampleSize: peerMetrics.length,
      requestedSampleSize: sampleSize,
      windowDays,
      note: comparisonNote,
      averages:
        averages === null
          ? null
          : {
              views: round1(averages.views),
              engagementRatePercent: round1(averages.engagement),
              readingSeconds: round1(averages.readingSeconds),
              shares: round1(averages.shares),
            },
      diff:
        averages === null
          ? null
          : {
              viewsPercent: diffPercent(views, averages.views),
              engagementPercent: diffPercent(engagement ?? 0, averages.engagement),
              readingTimePercent: diffPercent(averageReadingSeconds ?? 0, averages.readingSeconds),
            },
      rank,
      rankOutOf: hasComparison ? rankOutOf : 0,
    },
    performance: { score, band, message, reason, components, weights: performanceScoreWeights },
  };
}
