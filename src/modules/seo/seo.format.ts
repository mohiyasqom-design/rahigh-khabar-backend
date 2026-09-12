export interface ArticleData {
  slug: string; title: string; summary: string | null; metaDescription: string | null;
  publishedAt: Date | null; updatedAt: Date; author: { displayName: string };
  coverImage: { url: string } | null;
}
export interface SitemapRow { slug: string; updatedAt: Date; }
const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>\n';
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;'; case '<': return '&lt;'; case '>': return '&gt;';
      case '"': return '&quot;'; default: return '&apos;';
    }
  });
}
export function siteUrl(origin: string, path: string): string { return new URL(path, `${origin}/`).href; }
function entry(url: string, lastmod?: Date): string {
  return `<url><loc>${escapeXml(url)}</loc>${lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : ''}</url>`;
}
export function renderSitemap(origin: string, page: number, categories: SitemapRow[], news: SitemapRow[]): string {
  return `${xmlHeader}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    (page === 1 ? entry(siteUrl(origin, '/')) : '') +
    categories.map((row) => entry(siteUrl(origin, `/categories/${encodeURIComponent(row.slug)}`), row.updatedAt)).join('') +
    news.map((row) => entry(siteUrl(origin, `/news/${encodeURIComponent(row.slug)}`), row.updatedAt)).join('') + '</urlset>';
}
export function renderSitemapIndex(origin: string, pages: number): string {
  return `${xmlHeader}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    Array.from({ length: pages }, (_, i) =>
      `<sitemap><loc>${escapeXml(siteUrl(origin, `/sitemaps/${i + 1}.xml`))}</loc></sitemap>`).join('') + '</sitemapindex>';
}
export function getRobots(origin: string): string {
  return `User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${siteUrl(origin, '/sitemap.xml')}\n`;
}
export function toStructuredData(news: ArticleData, origin: string, apiOrigin: string) {
  const url = siteUrl(origin, `/news/${encodeURIComponent(news.slug)}`);
  let image: string | undefined;
  if (news.coverImage) {
    try {
      const candidate = new URL(news.coverImage.url, `${apiOrigin}/`);
      if (['https:', 'http:'].includes(candidate.protocol) && !candidate.username && !candidate.password) image = candidate.href;
    } catch { /* Invalid legacy image URLs are omitted. */ }
  }
  return {
    '@context': 'https://schema.org', '@type': 'NewsArticle', headline: news.title,
    datePublished: news.publishedAt?.toISOString() ?? null, dateModified: news.updatedAt.toISOString(),
    author: { '@type': 'Person', name: news.author.displayName },
    ...(image ? { image: [image] } : {}), description: news.metaDescription?.trim() || news.summary || '',
    url, mainEntityOfPage: { '@type': 'WebPage', '@id': url }, inLanguage: 'fa-IR',
  };
}
