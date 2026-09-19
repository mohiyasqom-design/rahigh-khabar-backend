/**
 * Stage 10 Part 4 — the site-wide dashboard.
 *
 * Two deliberate honesty decisions are encoded in the response shape:
 *  - `contentStatus.deleted` is null: this project deletes articles for real
 *    (hard delete), so there is no trash to count. Reporting 0 would be a lie.
 *  - `cards.visitors.total` is null: the visitor hash rotates daily for privacy,
 *    so the same person on two days is two hashes. Unique visitors are exact
 *    inside a period and comparable between periods, but an all-time "unique
 *    visitors" figure would be meaningless, so it is not offered.
 */
import type { PrismaClient } from '@prisma/client';
import { analyticsConfig } from '../../config/analytics.config.js';
import {
  activeUserCount,
  categoryViewRows,
  topContributor,
  topNewsRows,
  uniqueVisitorCount,
  viewBuckets,
  viewedNewsCount,
  type TopNewsRow,
} from './analytics.queries.js';
import {
  addDays,
  bucketKeys,
  changePercent,
  previousPeriod,
  resolveOverviewRange,
  resolveSeriesRange,
  startOfDay,
  startOfNextDay,
  startOfWeek,
  type BucketUnit,
  type OverviewRangeKey,
  type Period,
  type SeriesRangeKey,
} from './analytics.time.js';

export type Metric = { value: number; previous: number; changePercent: number | null };

export type VisitorMetric = Metric & {
  /** Intentionally unavailable: the visitor hash rotates every day. */
  total: null;
  totalReason: 'NOT_COMPARABLE_DAILY_HASH';
  note: string;
};

export type CountCard = {
  total: number;
  inRange: number;
  previousRange: number;
  changePercent: number | null;
};

export type TopNewsItem = {
  rank: number;
  id: string;
  title: string;
  slug: string;
  status: string;
  publishedAt: string | null;
  views: number;
  likes: number;
  comments: number;
};

export type CategoryPerformance = {
  categoryId: string;
  name: string;
  views: number;
  sharePercent: number;
  /** Shares are of categorised views; a multi-category article counts in each. */
  basis: 'CATEGORIZED_VIEWS';
};

export type ViewsSeriesPoint = { bucket: string; views: number; visitors: number };

export type ViewsSeries = {
  range: { key: SeriesRangeKey; from: string; to: string; unit: BucketUnit };
  totalViews: number;
  points: ViewsSeriesPoint[];
};

export type SiteOverview = {
  range: { key: OverviewRangeKey; from: string; to: string; unit: BucketUnit };
  generatedAt: string;
  cards: {
    views: Metric;
    visitors: VisitorMetric;
    news: CountCard;
    published: CountCard;
    drafts: { total: number };
    users: CountCard;
    comments: CountCard;
    likes: CountCard;
  };
  topNews: TopNewsItem[];
  categories: { totalCategorizedViews: number; items: CategoryPerformance[] };
  contentStatus: {
    publishedInRange: number;
    publishedPreviousRange: number;
    publishedChangePercent: number | null;
    pendingReview: number;
    drafts: number;
    scheduled: number;
    /** Hard delete: nothing is kept, so this cannot be counted. */
    deleted: null;
    deletedReason: 'HARD_DELETE_NOT_TRACKED';
  };
  userActivity: {
    newUsersToday: number;
    newUsersThisWeek: number;
    newUsersInRange: number;
    newUsersPreviousRange: number;
    growthPercent: number | null;
    activeUsers: number;
    activeUsersWindowDays: number;
    newComments: number;
    topContributor: {
      userId: string;
      displayName: string;
      likes: number;
      comments: number;
      total: number;
    } | null;
  };
};

const VISITOR_NOTE =
  'بازدیدکنندگان یکتا در هر بازه دقیق محاسبه می‌شوند، اما شناسهٔ بازدیدکننده روزانه تغییر می‌کند (حفظ حریم خصوصی)؛ به این دلیل عدد کلّ دوران قابل محاسبه نیست.';

function createdIn(period: Period) {
  return { createdAt: { gte: period.from, lt: period.to } };
}

function publishedIn(period: Period) {
  return { status: 'PUBLISHED' as const, publishedAt: { gte: period.from, lt: period.to } };
}

function card(total: number, inRange: number, previousRange: number): CountCard {
  return { total, inRange, previousRange, changePercent: changePercent(inRange, previousRange) };
}

/** Fills gaps so a chart shows quiet days as zero instead of skipping them. */
function fillBuckets(
  keys: string[],
  rows: Array<{ bucket: string; views: number; visitors: number }>,
): ViewsSeriesPoint[] {
  const byBucket = new Map(rows.map((row) => [row.bucket, row]));
  return keys.map((bucket) => {
    const row = byBucket.get(bucket);
    return { bucket, views: row?.views ?? 0, visitors: row?.visitors ?? 0 };
  });
}

async function buildTopNews(
  prisma: PrismaClient,
  range: Period,
  rows: TopNewsRow[],
  rankOffset = 0,
): Promise<TopNewsItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.newsId);

  const [articles, likeGroups, commentGroups] = await Promise.all([
    prisma.news.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, slug: true, status: true, publishedAt: true },
    }),
    prisma.like.groupBy({
      by: ['newsId'],
      where: { newsId: { in: ids }, ...createdIn(range) },
      _count: { _all: true },
    }),
    prisma.comment.groupBy({
      by: ['newsId'],
      where: { newsId: { in: ids }, isDeleted: false, ...createdIn(range) },
      _count: { _all: true },
    }),
  ]);

  const byId = new Map(articles.map((article) => [article.id, article]));
  const likes = new Map(likeGroups.map((group) => [group.newsId, group._count._all]));
  const comments = new Map(commentGroups.map((group) => [group.newsId, group._count._all]));

  return rows.flatMap((row, index) => {
    const article = byId.get(row.newsId);
    // Skip articles deleted after their views were recorded.
    if (article === undefined) return [];
    return [
      {
        rank: rankOffset + index + 1,
        id: article.id,
        title: article.title,
        slug: article.slug,
        status: article.status,
        publishedAt: article.publishedAt === null ? null : article.publishedAt.toISOString(),
        views: row.views,
        likes: likes.get(row.newsId) ?? 0,
        comments: comments.get(row.newsId) ?? 0,
      },
    ];
  });
}

export async function getSiteOverview(
  prisma: PrismaClient,
  rangeKey: OverviewRangeKey,
  now = new Date(),
): Promise<SiteOverview> {
  const range = resolveOverviewRange(rangeKey, now);
  const previous = previousPeriod(range);
  const activeWindow: Period = {
    from: addDays(startOfDay(now), -(analyticsConfig.activeUsersWindowDays - 1)),
    to: startOfNextDay(now),
  };

  const [
    views,
    previousViews,
    visitors,
    previousVisitors,
    newsTotal,
    newsInRange,
    newsPrevious,
    publishedTotal,
    publishedInRange,
    publishedPrevious,
    draftsTotal,
    pendingTotal,
    scheduledTotal,
    usersTotal,
    usersInRange,
    usersPrevious,
    commentsTotal,
    commentsInRange,
    commentsPrevious,
    likesTotal,
    likesInRange,
    likesPrevious,
    newUsersToday,
    newUsersThisWeek,
    activeUsers,
    contributor,
    categoryRows,
  ] = await Promise.all([
    prisma.pageView.count({ where: createdIn(range) }),
    prisma.pageView.count({ where: createdIn(previous) }),
    uniqueVisitorCount(prisma, range),
    uniqueVisitorCount(prisma, previous),
    prisma.news.count(),
    prisma.news.count({ where: createdIn(range) }),
    prisma.news.count({ where: createdIn(previous) }),
    prisma.news.count({ where: { status: 'PUBLISHED' } }),
    prisma.news.count({ where: publishedIn(range) }),
    prisma.news.count({ where: publishedIn(previous) }),
    prisma.news.count({ where: { status: 'DRAFT' } }),
    prisma.news.count({ where: { status: 'IN_REVIEW' } }),
    prisma.news.count({ where: { scheduledFor: { gte: now }, status: { not: 'PUBLISHED' } } }),
    prisma.regularUser.count(),
    prisma.regularUser.count({ where: createdIn(range) }),
    prisma.regularUser.count({ where: createdIn(previous) }),
    prisma.comment.count({ where: { isDeleted: false } }),
    prisma.comment.count({ where: { isDeleted: false, ...createdIn(range) } }),
    prisma.comment.count({ where: { isDeleted: false, ...createdIn(previous) } }),
    prisma.like.count(),
    prisma.like.count({ where: createdIn(range) }),
    prisma.like.count({ where: createdIn(previous) }),
    prisma.regularUser.count({
      where: { createdAt: { gte: startOfDay(now), lt: startOfNextDay(now) } },
    }),
    prisma.regularUser.count({
      where: { createdAt: { gte: startOfWeek(now), lt: startOfNextDay(now) } },
    }),
    activeUserCount(prisma, activeWindow),
    topContributor(prisma, range),
    categoryViewRows(prisma, range),
  ]);

  const topNews = await buildTopNews(
    prisma,
    range,
    await topNewsRows(prisma, range, analyticsConfig.topNewsLimit),
  );

  const totalCategorizedViews = categoryRows.reduce((sum, row) => sum + row.views, 0);

  return {
    range: {
      key: rangeKey,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      unit: range.unit,
    },
    generatedAt: now.toISOString(),
    cards: {
      views: {
        value: views,
        previous: previousViews,
        changePercent: changePercent(views, previousViews),
      },
      visitors: {
        value: visitors,
        previous: previousVisitors,
        changePercent: changePercent(visitors, previousVisitors),
        total: null,
        totalReason: 'NOT_COMPARABLE_DAILY_HASH',
        note: VISITOR_NOTE,
      },
      news: card(newsTotal, newsInRange, newsPrevious),
      published: card(publishedTotal, publishedInRange, publishedPrevious),
      drafts: { total: draftsTotal },
      users: card(usersTotal, usersInRange, usersPrevious),
      comments: card(commentsTotal, commentsInRange, commentsPrevious),
      likes: card(likesTotal, likesInRange, likesPrevious),
    },
    topNews,
    categories: {
      totalCategorizedViews,
      items: categoryRows.map((row) => ({
        categoryId: row.categoryId,
        name: row.name,
        views: row.views,
        sharePercent:
          totalCategorizedViews === 0
            ? 0
            : Math.round((row.views / totalCategorizedViews) * 1000) / 10,
        basis: 'CATEGORIZED_VIEWS',
      })),
    },
    contentStatus: {
      publishedInRange,
      publishedPreviousRange: publishedPrevious,
      publishedChangePercent: changePercent(publishedInRange, publishedPrevious),
      pendingReview: pendingTotal,
      drafts: draftsTotal,
      scheduled: scheduledTotal,
      deleted: null,
      deletedReason: 'HARD_DELETE_NOT_TRACKED',
    },
    userActivity: {
      newUsersToday,
      newUsersThisWeek,
      newUsersInRange: usersInRange,
      newUsersPreviousRange: usersPrevious,
      growthPercent: changePercent(usersInRange, usersPrevious),
      activeUsers,
      activeUsersWindowDays: analyticsConfig.activeUsersWindowDays,
      newComments: commentsInRange,
      topContributor: contributor,
    },
  };
}

export async function getViewsSeries(
  prisma: PrismaClient,
  rangeKey: SeriesRangeKey,
  now = new Date(),
): Promise<ViewsSeries> {
  const range = resolveSeriesRange(rangeKey, now);
  const rows = await viewBuckets(prisma, range, range.unit);
  const points = fillBuckets(bucketKeys(range, range.unit), rows);

  return {
    range: {
      key: rangeKey,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      unit: range.unit,
    },
    totalViews: points.reduce((sum, point) => sum + point.views, 0),
    points,
  };
}

/** Paginated "see all" table behind the dashboard's top-news card. */
export async function getTopNewsPage(
  prisma: PrismaClient,
  rangeKey: OverviewRangeKey,
  page: number,
  pageSize: number,
  now = new Date(),
): Promise<{
  range: { key: OverviewRangeKey; from: string; to: string };
  items: TopNewsItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const range = resolveOverviewRange(rangeKey, now);
  const offset = (page - 1) * pageSize;

  const [rows, total] = await Promise.all([
    topNewsRows(prisma, range, pageSize, offset),
    viewedNewsCount(prisma, range),
  ]);

  const items = await buildTopNews(prisma, range, rows, offset);

  return {
    range: { key: rangeKey, from: range.from.toISOString(), to: range.to.toISOString() },
    items,
    total,
    page,
    pageSize,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}
