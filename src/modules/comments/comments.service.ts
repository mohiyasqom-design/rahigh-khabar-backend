import type { Prisma, PrismaClient } from '@prisma/client';
import { ApiError } from '../../utils/api-error.js';
import { pageResult } from '../../utils/validation.js';
import { sanitizeCommentContent } from '../../utils/sanitizer.js';
import type { CommentListQuery, CreateCommentInput } from './comments.schema.js';

// Who is acting. `isAdmin` is resolved by the route from the authenticated
// identity; the service never reads roles out of the request itself.
export type CommentActor = { id: string; isAdmin: boolean };

export const commentSelect = {
  id: true, content: true, createdAt: true,
  user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
} satisfies Prisma.CommentSelect;

type CommentRow = Prisma.CommentGetPayload<{ select: typeof commentSelect }>;

export type PublicComment = {
  id: string;
  content: string;
  createdAt: string;
  user: { id: string; username: string | null; displayName: string; avatarUrl: string | null };
};

export function toPublicComment(row: CommentRow): PublicComment {
  return {
    id: row.id,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    user: {
      id: row.user.id,
      username: row.user.username,
      displayName: row.user.displayName,
      avatarUrl: row.user.avatarUrl,
    },
  };
}

const missingNews = () => new ApiError(404, 'NEWS_NOT_FOUND', 'خبر پیدا نشد.');

export async function assertPublishedNews(prisma: PrismaClient, newsId: string): Promise<void> {
  const news = await prisma.news.findFirst({
    where: { id: newsId, status: 'PUBLISHED' }, select: { id: true },
  });
  if (!news) throw missingNews();
}

export async function createComment(
  prisma: PrismaClient,
  newsId: string,
  actor: CommentActor,
  input: CreateCommentInput,
): Promise<PublicComment> {
  await assertPublishedNews(prisma, newsId);
  // Comments are plain text. Strip markup first, then re-check: "<b></b>"
  // passed the length check but is empty once sanitised.
  const content = sanitizeCommentContent(input.content);
  if (content.length === 0) {
    throw new ApiError(400, 'EMPTY_COMMENT', 'متن نظر نمی‌تواند خالی باشد.');
  }
  const created = await prisma.comment.create({
    data: { newsId, userId: actor.id, content }, select: commentSelect,
  });
  return toPublicComment(created);
}

export async function listComments(prisma: PrismaClient, newsId: string, query: CommentListQuery) {
  await assertPublishedNews(prisma, newsId);
  const where: Prisma.CommentWhereInput = { newsId, isDeleted: false };
  const [items, total] = await prisma.$transaction([
    prisma.comment.findMany({
      where, select: commentSelect,
      // id is the stable tiebreaker so pagination cannot repeat or skip a row
      // when several comments share the same createdAt.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize, take: query.pageSize,
    }),
    prisma.comment.count({ where }),
  ]);
  return pageResult(items.map(toPublicComment), total, query.page, query.pageSize);
}

/** Soft delete: the row survives for moderation history, the API stops showing it. */
export async function deleteComment(prisma: PrismaClient, id: string, actor: CommentActor): Promise<void> {
  const comment = await prisma.comment.findUnique({
    where: { id }, select: { id: true, userId: true, isDeleted: true },
  });
  // Already-deleted behaves like missing so repeated clicks are idempotent-ish
  // and never reveal that the comment once existed.
  if (!comment || comment.isDeleted) {
    throw new ApiError(404, 'COMMENT_NOT_FOUND', 'نظر پیدا نشد.');
  }
  if (!actor.isAdmin && comment.userId !== actor.id) {
    throw new ApiError(403, 'FORBIDDEN', 'اجازهٔ حذف این نظر را ندارید.');
  }
  await prisma.comment.update({ where: { id }, data: { isDeleted: true } });
}
