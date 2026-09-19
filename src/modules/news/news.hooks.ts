import type { PrismaClient } from '@prisma/client';
import { announcePublishedNews } from '../push/push.service.js';
import { syncNewsEmbedding } from '../search/embedding.service.js';

/**
 * Side-effects of publication: notify followers of the article's categories and
 * refresh its search embedding.
 *
 * Both are best-effort - `allSettled` guarantees that a failing push service or
 * embedding provider can never turn a successful publish into an error. Living
 * in its own file keeps news.service free of an import cycle with push/search.
 */
export async function afterPublished(prisma: PrismaClient, newsId: string): Promise<void> {
  const news = await prisma.news.findUnique({
    where: { id: newsId },
    select: {
      title: true, slug: true, lead: true, status: true,
      categories: { select: { categoryId: true } },
    },
  });
  if (!news || news.status !== 'PUBLISHED') return;
  await Promise.allSettled([
    announcePublishedNews(prisma, news, news.categories.map((link) => link.categoryId)),
    syncNewsEmbedding(prisma, newsId),
  ]);
}

/**
 * Side-effect of EDITING an already published article: the stored embedding
 * still describes the previous title/lead/body, so semantic search would keep
 * matching text that no longer exists on the page. Only the embedding is
 * refreshed - no notification is sent, because an edit is not a publication
 * and subscribers must not be pinged twice for the same article.
 */
export async function afterEdited(prisma: PrismaClient, newsId: string): Promise<void> {
  await Promise.allSettled([syncNewsEmbedding(prisma, newsId)]);
}
