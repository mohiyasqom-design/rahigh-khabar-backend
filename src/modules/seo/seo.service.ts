import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { getPublicNews } from '../news/news.service.js';
import { renderSitemap, renderSitemapIndex, toStructuredData } from './seo.format.js';
export { escapeXml, getRobots } from './seo.format.js';
const sitemapPageSize = 10_000;
// Normal urlset for MVP; bounded child maps above 10k rather than truncation.
export async function getSitemap(prisma: PrismaClient, origin: string): Promise<string> {
  const [news, categories] = await prisma.$transaction([
    prisma.news.count({ where: { status: 'PUBLISHED' } }), prisma.category.count(),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  if (news + categories + 1 <= sitemapPageSize) return getSitemapPage(prisma, origin, 1);
  return renderSitemapIndex(origin, Math.ceil((news + categories + 1) / sitemapPageSize));
}
export async function getSitemapPage(prisma: PrismaClient, origin: string, page: number): Promise<string> {
  const rows = await prisma.$transaction(async (tx) => {
    const categoryCount = await tx.category.count();
    const start = (page - 1) * sitemapPageSize;
    const end = start + sitemapPageSize;
    const categoryStart = Math.max(0, start - 1);
    const categoryTake = Math.max(0, Math.min(categoryCount, end - 1) - categoryStart);
    const newsStart = Math.max(0, start - 1 - categoryCount);
    const newsTake = Math.max(0, end - Math.max(start, 1 + categoryCount));
    const categories = categoryTake ? await tx.category.findMany({
      select: { slug: true, updatedAt: true }, orderBy: { id: 'asc' }, skip: categoryStart, take: categoryTake,
    }) : [];
    const news = newsTake ? await tx.news.findMany({
      where: { status: 'PUBLISHED' }, select: { slug: true, updatedAt: true },
      orderBy: { id: 'asc' }, skip: newsStart, take: newsTake,
    }) : [];
    return { categories, news };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  return renderSitemap(origin, page, rows.categories, rows.news);
}
export async function getStructuredData(prisma: PrismaClient, origin: string, apiOrigin: string, slug: string) {
  // Same PUBLISHED whitelist and indistinguishable 404 as the public news route.
  return toStructuredData(await getPublicNews(prisma, slug), origin, apiOrigin);
}
