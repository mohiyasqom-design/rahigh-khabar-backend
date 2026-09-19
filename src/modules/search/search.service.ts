import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { pageResult } from '../../utils/validation.js';
import {
  createEmbedding, isEmbeddingEnabled, toVectorLiteral,
} from './embedding.service.js';
import type { SearchQuery } from './search.schema.js';

// Only published, already-due articles may ever appear in search results.
const PUBLISHED_FILTER = Prisma.sql`
  n."status" = 'PUBLISHED' AND n."publishedAt" IS NOT NULL AND n."publishedAt" <= now()
`;

export interface SearchResultItem {
  id: string;
  title: string;
  slug: string;
  lead: string;
  publishedAt: string | null;
  coverImageUrl: string | null;
  categories: Array<{ id: string; name: string; slug: string }>;
}

interface RawRow {
  id: string;
  title: string;
  slug: string;
  lead: string;
  publishedAt: Date | null;
  total: bigint | number;
}

async function decorate(prisma: PrismaClient, ids: string[]): Promise<Map<string, {
  coverImageUrl: string | null;
  categories: Array<{ id: string; name: string; slug: string }>;
}>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.news.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      coverImage: { select: { url: true } },
      categories: { select: { category: { select: { id: true, name: true, slug: true } } } },
    },
  });
  return new Map(rows.map((row) => [row.id, {
    coverImageUrl: row.coverImage?.url ?? null,
    categories: row.categories.map((link) => link.category),
  }]));
}

/**
 * Hybrid ranking: PostgreSQL full-text score plus, when an embedding is
 * available, cosine similarity from pgvector. The keyword score dominates so a
 * literal title match always wins; the vector term only reorders near-ties and
 * surfaces synonyms.
 */
async function runHybridSearch(
  prisma: PrismaClient, query: SearchQuery, vector: number[] | null,
): Promise<{ rows: RawRow[]; total: number }> {
  const offset = (query.page - 1) * query.pageSize;
  const categoryFilter = query.categoryId
    ? Prisma.sql`AND EXISTS (SELECT 1 FROM "news_categories" nc WHERE nc."newsId" = n."id" AND nc."categoryId" = ${query.categoryId})`
    : Prisma.empty;
  const semantic = vector
    ? Prisma.sql`COALESCE(1 - (e."embedding" <=> ${toVectorLiteral(vector)}::vector), 0) * 0.6`
    : Prisma.sql`0`;
  const join = vector
    ? Prisma.sql`LEFT JOIN "news_embeddings" e ON e."newsId" = n."id"`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT n."id", n."title", n."slug", n."lead", n."publishedAt",
           count(*) OVER() AS total
    FROM "news" n
    ${join}
    WHERE ${PUBLISHED_FILTER}
      ${categoryFilter}
      AND (
        n."searchVector" @@ websearch_to_tsquery('simple', ${query.q})
        ${vector ? Prisma.sql`OR e."embedding" IS NOT NULL` : Prisma.empty}
      )
    ORDER BY (
      ts_rank(n."searchVector", websearch_to_tsquery('simple', ${query.q})) * 1.0
      + ${semantic}
    ) DESC, n."publishedAt" DESC NULLS LAST
    LIMIT ${query.pageSize} OFFSET ${offset}
  `);
  const total = rows.length > 0 ? Number(rows[0]!.total) : 0;
  return { rows, total };
}

/**
 * Last-resort search used when the tsvector column or the query parser is
 * unavailable (for example before the Part 5 migration ran). Slower, but it
 * keeps the site's search box functional instead of returning a 500.
 */
async function runFallbackSearch(prisma: PrismaClient, query: SearchQuery) {
  const where: Prisma.NewsWhereInput = {
    status: 'PUBLISHED',
    publishedAt: { not: null, lte: new Date() },
    ...(query.categoryId ? { categories: { some: { categoryId: query.categoryId } } } : {}),
    OR: [
      { title: { contains: query.q, mode: 'insensitive' } },
      { lead: { contains: query.q, mode: 'insensitive' } },
      { summary: { contains: query.q, mode: 'insensitive' } },
      { body: { contains: query.q, mode: 'insensitive' } },
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.news.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true, title: true, slug: true, lead: true, publishedAt: true,
        coverImage: { select: { url: true } },
        categories: { select: { category: { select: { id: true, name: true, slug: true } } } },
      },
    }),
    prisma.news.count({ where }),
  ]);
  const items: SearchResultItem[] = rows.map((row) => ({
    id: row.id, title: row.title, slug: row.slug, lead: row.lead,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    coverImageUrl: row.coverImage?.url ?? null,
    categories: row.categories.map((link) => link.category),
  }));
  return { items, total };
}

export async function searchNews(prisma: PrismaClient, query: SearchQuery) {
  const wantsSemantic = query.mode !== 'keyword' && isEmbeddingEnabled();
  const vector = wantsSemantic ? await createEmbedding(query.q) : null;
  // "semantic" was explicitly requested but could not be provided.
  const degraded = query.mode === 'semantic' && vector === null;

  try {
    const { rows, total } = await runHybridSearch(prisma, query, vector);
    const extra = await decorate(prisma, rows.map((row) => row.id));
    const items: SearchResultItem[] = rows.map((row) => ({
      id: row.id, title: row.title, slug: row.slug, lead: row.lead,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      coverImageUrl: extra.get(row.id)?.coverImageUrl ?? null,
      categories: extra.get(row.id)?.categories ?? [],
    }));
    return {
      ...pageResult(items, total, query.page, query.pageSize),
      mode: vector ? 'hybrid' : 'keyword',
      degraded,
    };
  } catch {
    const { items, total } = await runFallbackSearch(prisma, query);
    return {
      ...pageResult(items, total, query.page, query.pageSize),
      mode: 'fallback',
      degraded: true,
    };
  }
}

/** Lightweight title suggestions for the header search box. */
export async function suggestNews(prisma: PrismaClient, term: string) {
  const rows = await prisma.news.findMany({
    where: {
      status: 'PUBLISHED',
      publishedAt: { not: null, lte: new Date() },
      title: { contains: term, mode: 'insensitive' },
    },
    orderBy: { publishedAt: 'desc' },
    take: 6,
    select: { title: true, slug: true },
  });
  return rows;
}
