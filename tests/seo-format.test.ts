import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeXml, renderSitemap, renderSitemapIndex, getRobots, toStructuredData } from '../src/modules/seo/seo.format.js';
import type { ArticleData } from '../src/modules/seo/seo.format.js';
const site = 'https://rahigh.example'; const api = 'https://api.rahigh.example';
const date = new Date('2026-09-08T00:00:00Z');
const article: ArticleData = { slug: 'iran-news', title: 'خبر ایران', summary: 'خلاصه', metaDescription: null,
  publishedAt: date, updatedAt: date, author: { displayName: 'خبرنگار' }, coverImage: null };
test('sitemap XML escapes all reserved characters and encodes slugs', () => {
  assert.equal(escapeXml('&<>"\''), '&amp;&lt;&gt;&quot;&apos;');
  const xml = renderSitemap(site, 1, [{ slug: 'iran', updatedAt: date }], [{ slug: 'a&b', updatedAt: date }]);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.ok(xml.includes('<loc>https://rahigh.example/</loc>'));
  assert.ok(xml.includes('/news/a%26b')); assert.ok(xml.includes('/categories/iran'));
  assert.equal((xml.match(/<url>/g) ?? []).length, 3);
  assert.equal((xml.match(/<lastmod>/g) ?? []).length, 2);
});
test('empty sitemap and child/index maps have correct entry counts', () => {
  assert.equal((renderSitemap(site, 1, [], []).match(/<url>/g) ?? []).length, 1);
  assert.equal((renderSitemap(site, 2, [], []).match(/<url>/g) ?? []).length, 0);
  const index = renderSitemapIndex(site, 3);
  assert.equal((index.match(/<sitemap>/g) ?? []).length, 3);
  assert.ok(index.includes('/sitemaps/3.xml'));
});
test('robots advertises frontend canonical sitemap and excludes admin', () => {
  assert.equal(getRobots(site), 'User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: https://rahigh.example/sitemap.xml\n');
});
test('JSON-LD uses editorial title, dates, author, canonical URL and description fallback', () => {
  const data = toStructuredData(article, site, api);
  assert.equal(data['@context'], 'https://schema.org'); assert.equal(data['@type'], 'NewsArticle');
  assert.equal(data.headline, article.title); assert.equal(data.description, article.summary);
  assert.equal(data.datePublished, date.toISOString()); assert.equal(data.dateModified, date.toISOString());
  assert.deepEqual(data.author, { '@type': 'Person', name: article.author.displayName });
  assert.equal(data.mainEntityOfPage['@id'], 'https://rahigh.example/news/iran-news');
  assert.ok(!('image' in data));
  assert.equal(toStructuredData({ ...article, metaDescription: '  متا  ' }, site, api).description, 'متا');
});
test('JSON-LD media uses backend origin, ignores unsafe legacy URLs and never invents publish dates', () => {
  assert.deepEqual(toStructuredData({ ...article, coverImage: { url: '/uploads/x.png' } }, site, api).image,
    ['https://api.rahigh.example/uploads/x.png']);
  for (const url of ['javascript:alert(1)', 'data:image/png;base64,abc', 'https://user:pass@example.com/x', 'http://[invalid']) {
    assert.ok(!('image' in toStructuredData({ ...article, coverImage: { url } }, site, api)));
  }
  assert.equal(toStructuredData({ ...article, publishedAt: null }, site, api).datePublished, null);
});
