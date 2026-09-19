import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../../utils/api-error.js';
import { pageResult } from '../../utils/validation.js';

async function requireCategory(prisma: PrismaClient, categoryId: string) {
  const category = await prisma.category.findUnique({
    where: { id: categoryId }, select: { id: true, name: true, slug: true },
  });
  if (!category) throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'دسته‌بندی پیدا نشد.');
  return category;
}

/** Idempotent toggle: the same request twice yields the same visible state. */
export async function toggleFollow(
  prisma: PrismaClient, userId: string, categoryId: string, follow: boolean,
) {
  await requireCategory(prisma, categoryId);
  if (follow) {
    await prisma.categoryFollow.upsert({
      where: { userId_categoryId: { userId, categoryId } },
      create: { userId, categoryId },
      update: {},
    });
  } else {
    await prisma.categoryFollow.deleteMany({ where: { userId, categoryId } });
  }
  return { following: follow };
}

export async function isFollowing(
  prisma: PrismaClient, userId: string, categoryId: string,
): Promise<boolean> {
  const row = await prisma.categoryFollow.findUnique({
    where: { userId_categoryId: { userId, categoryId } }, select: { id: true },
  });
  return row !== null;
}

export async function listFollows(prisma: PrismaClient, userId: string) {
  const rows = await prisma.categoryFollow.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { category: { select: { id: true, name: true, slug: true } } },
  });
  return rows.map((row) => row.category);
}

/**
 * Personal feed: published articles from the categories the visitor follows.
 * Returns an empty page (not an error) when nothing is followed yet, so the UI
 * can show its own empty state.
 */
export async function listFeed(
  prisma: PrismaClient, userId: string, page: number, pageSize: number,
) {
  const follows = await prisma.categoryFollow.findMany({
    where: { userId }, select: { categoryId: true },
  });
  const categoryIds = follows.map((row) => row.categoryId);
  if (categoryIds.length === 0) return pageResult([], 0, page, pageSize);

  const where = {
    status: 'PUBLISHED' as const,
    publishedAt: { not: null, lte: new Date() },
    categories: { some: { categoryId: { in: categoryIds } } },
  };
  const [rows, total] = await Promise.all([
    prisma.news.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, title: true, slug: true, lead: true, publishedAt: true,
        coverImage: { select: { url: true } },
        categories: { select: { category: { select: { id: true, name: true, slug: true } } } },
      },
    }),
    prisma.news.count({ where }),
  ]);
  const items = rows.map((row) => ({
    id: row.id, title: row.title, slug: row.slug, lead: row.lead,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    coverImageUrl: row.coverImage?.url ?? null,
    categories: row.categories.map((link) => link.category),
  }));
  return pageResult(items, total, page, pageSize);
}
