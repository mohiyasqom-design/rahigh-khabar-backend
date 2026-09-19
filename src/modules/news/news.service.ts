import { Prisma } from '@prisma/client';
import type { NewsStatus, PrismaClient } from '@prisma/client';
import { ApiError } from '../../utils/api-error.js';
import { writeTransaction } from '../../utils/database.js';
import { pageResult } from '../../utils/validation.js';
import { sanitizeNewsBody } from '../../utils/sanitizer.js';
import { categorySelect } from '../categories/categories.service.js';
import { assertTransition, newsPolicy } from './news.policy.js';
import { afterEdited, afterPublished } from './news.hooks.js';
import type { NewsActor } from './news.policy.js';
import type { AdminNewsQuery, CreateNewsInput, PublicNewsQuery, UpdateNewsInput } from './news.schema.js';

const publicRelations = {
  author: { select: { displayName: true } },
  coverImage: { select: { url: true, altText: true, width: true, height: true } },
  categories: { select: { category: { select: categorySelect } }, orderBy: { categoryId: 'asc' } },
} satisfies Prisma.NewsInclude;
const adminInclude = publicRelations;
// Whitelist at the DB boundary, not merely when serializing a full User record.
const publicListSelect = {
  title: true, slug: true, summary: true, lead: true, publishedAt: true, ...publicRelations,
} satisfies Prisma.NewsSelect;
const publicDetailSelect = {
  // `id` is part of the public detail payload: likes and comments are addressed
  // by id, while the article URL only carries the slug.
  ...publicListSelect, id: true, body: true, seoTitle: true, metaDescription: true, updatedAt: true,
} satisfies Prisma.NewsSelect;
function flattenCategories<T extends { categories: { category: unknown }[] }>(news: T) {
  return { ...news, categories: news.categories.map((link) => link.category) };
}
const missingNews = () => new ApiError(404, 'NEWS_NOT_FOUND', 'خبر پیدا نشد.');

async function validateReferences(tx: Prisma.TransactionClient, categoryIds: string[] | undefined, coverImageId: string | null | undefined) {
  if (categoryIds !== undefined) {
    if (categoryIds.length === 0 || new Set(categoryIds).size !== categoryIds.length) {
      throw new ApiError(400, 'INVALID_CATEGORIES', 'حداقل یک دسته‌بندی لازم است و شناسه‌ها نباید تکراری باشند.');
    }
    const count = await tx.category.count({ where: { id: { in: categoryIds } } });
    if (count !== categoryIds.length) throw new ApiError(400, 'INVALID_CATEGORY_IDS', 'یک یا چند دسته‌بندی وجود ندارند.');
  }
  if (coverImageId !== undefined && coverImageId !== null) {
    const media = await tx.media.findUnique({ where: { id: coverImageId }, select: { id: true } });
    if (!media) throw new ApiError(400, 'INVALID_COVER_IMAGE', 'تصویر انتخاب‌شده وجود ندارد.');
  }
}
export function createNews(prisma: PrismaClient, actor: NewsActor, input: CreateNewsInput) {
  return writeTransaction(prisma, async (tx) => {
    await validateReferences(tx, input.categoryIds, input.coverImageId);
    const news = await tx.news.create({
      data: {
        title: input.title, slug: input.slug, summary: input.summary ?? null,
        lead: input.lead, body: sanitizeNewsBody(input.body),
        // Stage 10 Part 5: a schedule supplied on creation means SCHEDULED,
        // otherwise the scheduler would never pick the article up.
        status: input.scheduledFor ? 'SCHEDULED' : 'DRAFT', publishedAt: null,
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
        // Only authenticated identity, never any authorId/status from the payload.
        author: { connect: { id: actor.id } },
        ...(input.coverImageId ? { coverImage: { connect: { id: input.coverImageId } } } : {}),
        seoTitle: input.seoTitle ?? null, metaDescription: input.metaDescription ?? null,
        categories: { create: input.categoryIds.map((id) => ({ category: { connect: { id } } })) },
      }, include: adminInclude,
    });
    return flattenCategories(news);
  });
}
export async function listAdminNews(prisma: PrismaClient, actor: NewsActor, query: AdminNewsQuery) {
  const where: Prisma.NewsWhereInput = { ...newsPolicy.scope(actor) };
  if (query.status !== undefined) where.status = query.status;
  if (query.categoryId !== undefined) where.categories = { some: { categoryId: query.categoryId } };
  const [items, total] = await prisma.$transaction([
    prisma.news.findMany({ where, include: adminInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    prisma.news.count({ where }),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  return pageResult(items.map(flattenCategories), total, query.page, query.pageSize);
}
export async function getAdminNews(prisma: PrismaClient, actor: NewsActor, id: string) {
  const news = await prisma.news.findUnique({ where: { id }, include: adminInclude });
  if (!news) throw missingNews();
  newsPolicy.assert(actor, news, 'read');
  return flattenCategories(news);
}
export async function updateNews(prisma: PrismaClient, actor: NewsActor, id: string, input: UpdateNewsInput) {
  const result = await writeTransaction(prisma, async (tx) => {
    const current = await tx.news.findUnique({ where: { id }, select: { authorId: true, status: true } });
    if (!current) throw missingNews();
    newsPolicy.assert(actor, current, 'edit');
    await validateReferences(tx, input.categoryIds, input.coverImageId);
    // Enumerate fields to prevent mass assignment and explicit undefined values
    // under exactOptionalPropertyTypes. null clears an optional nullable field.
    const data: Prisma.NewsUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.slug !== undefined) data.slug = input.slug;
    if (input.summary !== undefined) data.summary = input.summary;
    if (input.lead !== undefined) data.lead = input.lead;
    if (input.body !== undefined) data.body = sanitizeNewsBody(input.body);
    if (input.seoTitle !== undefined) data.seoTitle = input.seoTitle;
    if (input.metaDescription !== undefined) data.metaDescription = input.metaDescription;
    if (input.scheduledFor !== undefined) {
      data.scheduledFor =
        input.scheduledFor === null ? null : new Date(input.scheduledFor);
      // The schedule and the status must stay consistent: clearing the date
      // must not leave the article queued, and setting one on an unpublished
      // article must queue it.
      if (input.scheduledFor === null) {
        if (current.status === 'SCHEDULED') data.status = 'DRAFT';
      } else if (['DRAFT', 'REJECTED', 'IN_REVIEW', 'SCHEDULED'].includes(current.status)) {
        data.status = 'SCHEDULED';
      }
    }
    if (input.coverImageId !== undefined) {
      data.coverImage = input.coverImageId === null ? { disconnect: true } : { connect: { id: input.coverImageId } };
    }
    if (input.categoryIds !== undefined) {
      data.categories = { deleteMany: {}, create: input.categoryIds.map((categoryId) => ({ category: { connect: { id: categoryId } } })) };
    }
    const news = await tx.news.update({ where: { id }, data, include: adminInclude });
    return flattenCategories(news);
  });
  // Editing a live article changes the text that semantic search indexed, so
  // the embedding is refreshed outside the transaction. No notification: an
  // edit is not a publication.
  if (result.status === 'PUBLISHED') await afterEdited(prisma, result.id);
  return result;
}
export async function deleteNews(prisma: PrismaClient, actor: NewsActor, id: string): Promise<void> {
  await writeTransaction(prisma, async (tx) => {
    const current = await tx.news.findUnique({ where: { id }, select: { authorId: true, status: true } });
    if (!current) throw missingNews();
    newsPolicy.assert(actor, current, 'delete');
    await tx.news.delete({ where: { id } });
  });
}
export async function changeNewsStatus(prisma: PrismaClient, actor: NewsActor, id: string, status: NewsStatus) {
  const result = await writeTransaction(prisma, async (tx) => {
    const current = await tx.news.findUnique({ where: { id }, select: { authorId: true, status: true, publishedAt: true } });
    if (!current) throw missingNews();
    newsPolicy.assert(actor, current, 'status');
    assertTransition(current.status, status);
    // Preserve FIRST publication time across archive/re-publication. Never
    // clear it on other transitions. Concurrent first publication is serialized.
    const publishedAt = status === 'PUBLISHED' && current.publishedAt === null ? new Date() : current.publishedAt;
    const data: Prisma.NewsUpdateInput = { status, publishedAt };
    // Publishing now (or pulling the article back to a draft) retires the queue
    // entry, so the scheduler cannot publish the same article a second time.
    if (status === 'PUBLISHED' || status === 'DRAFT') data.scheduledFor = null;
    const news = await tx.news.update({ where: { id }, data, include: adminInclude });
    return flattenCategories(news);
  });
  // Outside the transaction on purpose: notifications and embeddings are
  // network calls and must never extend a database transaction.
  if (status === 'PUBLISHED') await afterPublished(prisma, result.id);
  return result;
}
export async function listPublicNews(prisma: PrismaClient, query: PublicNewsQuery) {
  const where: Prisma.NewsWhereInput = { status: 'PUBLISHED' };
  if (query.categorySlug !== undefined) where.categories = { some: { category: { slug: query.categorySlug } } };
  const [items, total] = await prisma.$transaction([
    prisma.news.findMany({ where, select: publicListSelect,
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    prisma.news.count({ where }),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  return pageResult(items.map(flattenCategories), total, query.page, query.pageSize);
}
export async function getPublicNews(prisma: PrismaClient, slug: string, viewerId: string | null = null) {
  const news = await prisma.news.findFirst({ where: { slug, status: 'PUBLISHED' }, select: publicDetailSelect });
  // Exactly the same 404 for absent and nonpublic records, including ARCHIVED.
  if (!news) throw missingNews();
  // Engagement totals ship with the article so the page renders real numbers on
  // first paint. `likedByCurrentUser` is per-visitor, so an anonymous (and
  // therefore cacheable) read always reports false and the browser refreshes it
  // from GET /news/:id/likes.
  const [likesCount, commentsCount, likedByCurrentUser] = await Promise.all([
    prisma.like.count({ where: { newsId: news.id } }),
    prisma.comment.count({ where: { newsId: news.id, isDeleted: false } }),
    viewerId === null
      ? Promise.resolve(false)
      : prisma.like.findUnique({
        where: { userId_newsId: { userId: viewerId, newsId: news.id } }, select: { id: true },
      }).then((like) => like !== null),
  ]);
  // Normalize legacy blank metadata only at the public read boundary.
  return { ...flattenCategories(news),
    seoTitle: news.seoTitle?.trim() || null,
    metaDescription: news.metaDescription?.trim() || null,
    likesCount, commentsCount, likedByCurrentUser };
}
