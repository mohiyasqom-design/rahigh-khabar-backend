import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../../utils/api-error.js';

export type LikeState = { liked: boolean; likesCount: number };

const missingNews = () => new ApiError(404, 'NEWS_NOT_FOUND', 'خبر پیدا نشد.');

// Drafts, archived and rejected items must behave exactly like a missing page,
// otherwise likes would leak the existence of unpublished content.
export async function assertPublishedNews(prisma: PrismaClient, newsId: string): Promise<void> {
  const news = await prisma.news.findFirst({
    where: { id: newsId, status: 'PUBLISHED' }, select: { id: true },
  });
  if (!news) throw missingNews();
}

/**
 * Toggle is write-first: try to insert, and treat the unique-constraint failure
 * as "already liked, so unlike". Two rapid taps therefore cannot create a
 * duplicate row or lose the delete, which a read-then-write check allowed.
 */
export async function toggleLike(prisma: PrismaClient, newsId: string, userId: string): Promise<LikeState> {
  await assertPublishedNews(prisma, newsId);
  let liked: boolean;
  try {
    await prisma.like.create({ data: { newsId, userId } });
    liked = true;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
    if (error.code === 'P2003') throw missingNews();
    if (error.code !== 'P2002') throw error;
    try {
      await prisma.like.delete({ where: { userId_newsId: { userId, newsId } } });
    } catch (deleteError) {
      // P2025: another request already removed it. The end state is identical.
      if (!(deleteError instanceof Prisma.PrismaClientKnownRequestError && deleteError.code === 'P2025')) {
        throw deleteError;
      }
    }
    liked = false;
  }
  // Always read the count after the write so the client never has to guess it.
  const likesCount = await prisma.like.count({ where: { newsId } });
  return { liked, likesCount };
}

export async function getLikeState(
  prisma: PrismaClient,
  newsId: string,
  viewerId: string | null,
): Promise<LikeState> {
  await assertPublishedNews(prisma, newsId);
  const [likesCount, existing] = await Promise.all([
    prisma.like.count({ where: { newsId } }),
    viewerId === null
      ? Promise.resolve(null)
      : prisma.like.findUnique({
          where: { userId_newsId: { userId: viewerId, newsId } }, select: { id: true },
        }),
  ]);
  return { liked: existing !== null, likesCount };
}
