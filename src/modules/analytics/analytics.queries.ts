/**
 * Stage 10 Part 4 — aggregate queries.
 *
 * All of these push the work into PostgreSQL: GROUP BY, COUNT DISTINCT and
 * FILTER, never a loop over rows in Node. The brief forbids fetching rows and
 * counting them in the application, and with a page-view table that grows with
 * every visit that is also the only thing that stays fast.
 *
 * Bucketing happens with `to_char("createdAt" AT TIME ZONE 'Asia/Tehran', …)`
 * so the grouping matches the Tehran calendar used by `analytics.time.ts`.
 * Counts are cast to ::int because PostgreSQL returns bigint, which Prisma maps
 * to BigInt and JSON cannot serialise.
 */
import { Prisma, type PrismaClient, type TrafficSource } from '@prisma/client';
import type { BucketUnit, Period } from './analytics.time.js';

const TIME_ZONE = 'Asia/Tehran';

/** Must stay in sync with `bucketKey()` in analytics.time.ts. */
const BUCKET_FORMAT: Record<BucketUnit, string> = {
  hour: 'YYYY-MM-DD"T"HH24:00',
  day: 'YYYY-MM-DD',
  month: 'YYYY-MM',
};

/** Raw is safe here: the format comes from the fixed map above, not from input. */
function bucketExpression(unit: BucketUnit): Prisma.Sql {
  return Prisma.raw(`to_char("createdAt" AT TIME ZONE '${TIME_ZONE}', '${BUCKET_FORMAT[unit]}')`);
}

function newsScope(newsId?: string): Prisma.Sql {
  return newsId === undefined ? Prisma.empty : Prisma.sql`AND "newsId" = ${newsId}`;
}

export type BucketRow = { bucket: string; views: number; visitors: number };

export function viewBuckets(
  prisma: PrismaClient,
  period: Period,
  unit: BucketUnit,
  newsId?: string,
): Promise<BucketRow[]> {
  return prisma.$queryRaw<BucketRow[]>(Prisma.sql`
    SELECT ${bucketExpression(unit)} AS bucket,
           COUNT(*)::int AS views,
           COUNT(DISTINCT "visitorId")::int AS visitors
    FROM "page_views"
    WHERE "createdAt" >= ${period.from} AND "createdAt" < ${period.to}
    ${newsScope(newsId)}
    GROUP BY 1
    ORDER BY 1
  `);
}

export async function uniqueVisitorCount(
  prisma: PrismaClient,
  period: Period,
  newsId?: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ visitors: number }>>(Prisma.sql`
    SELECT COUNT(DISTINCT "visitorId")::int AS visitors
    FROM "page_views"
    WHERE "createdAt" >= ${period.from} AND "createdAt" < ${period.to}
    ${newsScope(newsId)}
  `);
  return rows[0]?.visitors ?? 0;
}

export type TopNewsRow = { newsId: string; views: number };

export function topNewsRows(
  prisma: PrismaClient,
  period: Period,
  limit: number,
  offset = 0,
): Promise<TopNewsRow[]> {
  return prisma.$queryRaw<TopNewsRow[]>(Prisma.sql`
    SELECT "newsId", COUNT(*)::int AS views
    FROM "page_views"
    WHERE "newsId" IS NOT NULL
      AND "createdAt" >= ${period.from} AND "createdAt" < ${period.to}
    GROUP BY "newsId"
    ORDER BY views DESC, "newsId" ASC
    LIMIT ${limit} OFFSET ${offset}
  `);
}

/** Total number of distinct articles with at least one view, for pagination. */
export async function viewedNewsCount(prisma: PrismaClient, period: Period): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
    SELECT COUNT(DISTINCT "newsId")::int AS total
    FROM "page_views"
    WHERE "newsId" IS NOT NULL
      AND "createdAt" >= ${period.from} AND "createdAt" < ${period.to}
  `);
  return rows[0]?.total ?? 0;
}

export type CategoryViewRow = { categoryId: string; name: string; views: number };

/**
 * Views per category. An article in two categories counts once in each, so the
 * shares are percentages of categorised views — the dashboard says so.
 */
export function categoryViewRows(prisma: PrismaClient, period: Period): Promise<CategoryViewRow[]> {
  return prisma.$queryRaw<CategoryViewRow[]>(Prisma.sql`
    SELECT c."id" AS "categoryId", c."name" AS "name", COUNT(*)::int AS views
    FROM "page_views" pv
    JOIN "news_categories" nc ON nc."newsId" = pv."newsId"
    JOIN "categories" c ON c."id" = nc."categoryId"
    WHERE pv."newsId" IS NOT NULL
      AND pv."createdAt" >= ${period.from} AND pv."createdAt" < ${period.to}
    GROUP BY c."id", c."name"
    ORDER BY views DESC, c."name" ASC
  `);
}

/** Signed-in readers with at least one view, like or comment in the window. */
export async function activeUserCount(prisma: PrismaClient, period: Period): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS total FROM (
      SELECT "userId" FROM "page_views"
       WHERE "userId" IS NOT NULL
         AND "createdAt" >= ${period.from} AND "createdAt" < ${period.to}
      UNION
      SELECT "userId" FROM "likes"
       WHERE "createdAt" >= ${period.from} AND "createdAt" < ${period.to}
      UNION
      SELECT "userId" FROM "comments"
       WHERE "isDeleted" = false
         AND "createdAt" >= ${period.from} AND "createdAt" < ${period.to}
    ) AS active
  `);
  return rows[0]?.total ?? 0;
}

export type TopContributorRow = {
  userId: string;
  displayName: string;
  likes: number;
  comments: number;
  total: number;
};

/** Most active reader in the period, by likes + comments. */
export async function topContributor(
  prisma: PrismaClient,
  period: Period,
): Promise<TopContributorRow | null> {
  const rows = await prisma.$queryRaw<TopContributorRow[]>(Prisma.sql`
    WITH activity AS (
      SELECT "userId", COUNT(*)::int AS likes, 0 AS comments
      FROM "likes"
      WHERE "createdAt" >= ${period.from} AND "createdAt" < ${period.to}
      GROUP BY "userId"
      UNION ALL
      SELECT "userId", 0 AS likes, COUNT(*)::int AS comments
      FROM "comments"
      WHERE "isDeleted" = false
        AND "createdAt" >= ${period.from} AND "createdAt" < ${period.to}
      GROUP BY "userId"
    )
    SELECT a."userId" AS "userId",
           u."displayName" AS "displayName",
           SUM(a.likes)::int AS likes,
           SUM(a.comments)::int AS comments,
           (SUM(a.likes) + SUM(a.comments))::int AS total
    FROM activity a
    JOIN "regular_users" u ON u."id" = a."userId"
    GROUP BY a."userId", u."displayName"
    ORDER BY total DESC, u."displayName" ASC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

/**
 * Cumulative views at each checkpoint after publication (1h, 6h, 24h, 7d).
 * One pass over the article's views with FILTER, instead of four queries.
 */
export async function launchCheckpointViews(
  prisma: PrismaClient,
  newsId: string,
  publishedAt: Date,
  hours: readonly number[],
): Promise<number[]> {
  if (hours.length === 0) return [];

  const columns = Prisma.join(
    hours.map(
      (hour, index) =>
        Prisma.sql`COUNT(*) FILTER (WHERE "createdAt" < ${new Date(
          publishedAt.getTime() + hour * 3_600_000,
        )})::int AS ${Prisma.raw(`"h${index}"`)}`,
    ),
    ', ',
  );

  const rows = await prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`
    SELECT ${columns}
    FROM "page_views"
    WHERE "newsId" = ${newsId} AND "createdAt" >= ${publishedAt}
  `);

  const row = rows[0];
  return hours.map((_hour, index) => Number(row?.[`h${index}`] ?? 0));
}

export type TrafficSourceRow = { source: TrafficSource; views: number };

/** Grouped on the stored enum, so no referrer string is parsed at read time. */
export async function trafficSourceRows(
  prisma: PrismaClient,
  period: Period,
  newsId?: string,
): Promise<TrafficSourceRow[]> {
  const groups = await prisma.pageView.groupBy({
    by: ['referrerSource'],
    where: {
      createdAt: { gte: period.from, lt: period.to },
      ...(newsId === undefined ? {} : { newsId }),
    },
    _count: { _all: true },
  });

  return groups.map((group) => ({ source: group.referrerSource, views: group._count._all }));
}
