import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { env, isSemanticSearchConfigured } from '../../config/env.js';

const EMBEDDING_ENDPOINT = 'https://api.openai.com/v1/embeddings';
// Search must stay responsive: a slow provider is treated as "unavailable"
// rather than blocking the request until the Fastify timeout.
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_INPUT_CHARS = 6000;
export const EMBEDDING_DIMENSIONS = 1536;

export function isEmbeddingEnabled(): boolean {
  return isSemanticSearchConfigured();
}

/** pgvector literal form: `[0.1,0.2,...]`. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

export function buildEmbeddingSource(news: {
  title: string; lead: string; summary?: string | null; body?: string | null;
}): string {
  const body = (news.body ?? '').replace(/<[^>]*>/g, ' ');
  return [news.title, news.lead, news.summary ?? '', body]
    .join('\n').replace(/\s+/g, ' ').trim().slice(0, MAX_INPUT_CHARS);
}

/**
 * Returns null (never throws) when embeddings are disabled or the provider
 * fails, so search and publishing keep working without semantic ranking.
 */
export async function createEmbedding(input: string): Promise<number[] | null> {
  if (!isEmbeddingEnabled() || input.length === 0) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(EMBEDDING_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY ?? ''}`,
      },
      body: JSON.stringify({ model: env.OPENAI_EMBEDDING_MODEL, input }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
    const vector = payload.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) return null;
    return vector;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// `news_embeddings` is created by raw SQL in the Part 5 migration (pgvector is
// optional), so it is not part of the Prisma schema and is written with
// $executeRaw. Any failure is swallowed by the callers above.
export async function storeNewsEmbedding(
  prisma: PrismaClient, newsId: string, vector: number[],
): Promise<void> {
  const literal = toVectorLiteral(vector);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "news_embeddings" ("newsId", "embedding", "model", "updatedAt")
    VALUES (${newsId}, ${literal}::vector, ${env.OPENAI_EMBEDDING_MODEL}, now())
    ON CONFLICT ("newsId") DO UPDATE
      SET "embedding" = EXCLUDED."embedding",
          "model" = EXCLUDED."model",
          "updatedAt" = now()
  `);
}

export async function deleteNewsEmbedding(prisma: PrismaClient, newsId: string): Promise<void> {
  try {
    await prisma.$executeRaw(Prisma.sql`DELETE FROM "news_embeddings" WHERE "newsId" = ${newsId}`);
  } catch {
    // Table missing (pgvector unavailable): nothing to clean up.
  }
}

/** Recomputes and stores the embedding of one article. Never throws. */
export async function syncNewsEmbedding(prisma: PrismaClient, newsId: string): Promise<boolean> {
  if (!isEmbeddingEnabled()) return false;
  try {
    const news = await prisma.news.findUnique({
      where: { id: newsId },
      select: { title: true, lead: true, summary: true, body: true },
    });
    if (!news) return false;
    const vector = await createEmbedding(buildEmbeddingSource(news));
    if (!vector) return false;
    await storeNewsEmbedding(prisma, newsId, vector);
    return true;
  } catch {
    return false;
  }
}
