import { Prisma } from '@prisma/client';
import type { NewsStatus, PrismaClient } from '@prisma/client';
import { ApiError } from '../../utils/api-error.js';
import { writeTransaction } from '../../utils/database.js';
import { pageResult } from '../../utils/validation.js';
import { categorySelect } from '../categories/categories.service.js';
import { assertTransition, newsPolicy } from './news.policy.js';
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
  ...publicListSelect, body: true, seoTitle: true, metaDescription: true, updatedAt: true,
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
        lead: input.lead, body: input.body, status: 'DRAFT', publishedAt: null,
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
export function updateNews(prisma: PrismaClient, actor: NewsActor, id: string, input: UpdateNewsInput) {
  return writeTransaction(prisma, async (tx) => {
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
    if (input.body !== undefined) data.body = input.body;
    if (input.seoTitle !== undefined) data.seoTitle = input.seoTitle;
    if (input.metaDescription !== undefined) data.metaDescription = input.metaDescription;
    if (input.coverImageId !== undefined) {
      data.coverImage = input.coverImageId === null ? { disconnect: true } : { connect: { id: input.coverImageId } };
    }
    if (input.categoryIds !== undefined) {
      data.categories = { deleteMany: {}, create: input.categoryIds.map((categoryId) => ({ category: { connect: { id: categoryId } } })) };
    }
    const news = await tx.news.update({ where: { id }, data, include: adminInclude });
    return flattenCategories(news);
  });
}
export async function deleteNews(prisma: PrismaClient, actor: NewsActor, id: string): Promise<void> {
  await writeTransaction(prisma, async (tx) => {
    const current = await tx.news.findUnique({ where: { id }, select: { authorId: true, status: true } });
    if (!current) throw missingNews();
    newsPolicy.assert(actor, current, 'delete');
    await tx.news.delete({ where: { id } });
  });
}
export function changeNewsStatus(prisma: PrismaClient, actor: NewsActor, id: string, status: NewsStatus) {
  return writeTransaction(prisma, async (tx) => {
    const current = await tx.news.findUnique({ where: { id }, select: { authorId: true, status: true, publishedAt: true } });
    if (!current) throw missingNews();
    newsPolicy.assert(actor, current, 'status');
    assertTransition(current.status, status);
    // Preserve FIRST publication time across archive/re-publication. Never
    // clear it on other transitions. Concurrent first publication is serialized.
    const publishedAt = status === 'PUBLISHED' && current.publishedAt === null ? new Date() : current.publishedAt;
    const news = await tx.news.update({ where: { id }, data: { status, publishedAt }, include: adminInclude });
    return flattenCategories(news);
  });
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
export async function getPublicNews(prisma: PrismaClient, slug: string) {
  const news = await prisma.news.findFirst({ where: { slug, status: 'PUBLISHED' }, select: publicDetailSelect });
  // Exactly the same 404 for absent and nonpublic records, including ARCHIVED.
  if (!news) throw missingNews();
  // Normalize legacy blank metadata only at the public read boundary.
  return { ...flattenCategories(news),
    seoTitle: news.seoTitle?.trim() || null,
    metaDescription: news.metaDescription?.trim() || null };

}
