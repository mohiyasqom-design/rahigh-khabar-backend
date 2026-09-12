import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import fp from 'fastify-plugin';
import type { PrismaClient } from '@prisma/client';
import seoRoutes from '../src/modules/seo/seo.routes.js';
import newsPublicRoutes from '../src/modules/news/news.public.routes.js';
import { configureErrorHandlers } from '../src/utils/error-handlers.js';
import { escapeXml } from '../src/modules/seo/seo.service.js';
async function harness(t: { after(fn: () => Promise<void>): void }) {
  const date = new Date('2026-09-08T00:00:00Z');
  const published = { slug: 'published-news', title: 'خبر', summary: 'خلاصه', lead: 'لید', body: 'متن',
    publishedAt: date, updatedAt: date, seoTitle: '   ', metaDescription: '',
    author: { displayName: 'نویسنده', email: 'PRIVATE_EMAIL' },
    coverImage: { url: '/uploads/image.png', width: 3, height: 2, altText: null }, categories: [] };
  const state = { count: 1, categoryCount: 1, calls: [] as { where?: { status: string }; select?: unknown }[] };
  const prisma = {
    category: { count: async () => state.categoryCount, findMany: async () => state.categoryCount ? [{ slug: 'iran', updatedAt: date }] : [] },
    news: {
      count: async (args: { where: { status: string } }) => { state.calls.push(args); return state.count; },
      findMany: async (args: { where: { status: string }; select: unknown }) => {
        state.calls.push(args); return state.count ? [{ slug: published.slug, updatedAt: date }] : [];
      },
      findFirst: async (args: { where: { slug: string; status: string }; select: unknown }) => {
        state.calls.push(args); return args.where.slug === published.slug ? published : null;
      },
    },
    $transaction: async (ops: unknown) => Array.isArray(ops) ? Promise.all(ops) :
      (ops as (tx: unknown) => Promise<unknown>)(prisma),
  };
  const app = Fastify({ logger: false }); t.after(() => app.close()); configureErrorHandlers(app);
  app.register(fp(async (scope) => { scope.decorate('prisma', prisma as unknown as PrismaClient); }));
  app.register(seoRoutes); app.register(newsPublicRoutes, { prefix: '/news' }); await app.ready();
  return { app, state, published };
}
test('sitemap contains frontend home/categories/published URLs, XML content type and limited selects', async (t) => {
  const { app, state } = await harness(t);
  const res = await app.inject('/sitemap.xml'); assert.equal(res.statusCode, 200, res.body);
  assert.match(String(res.headers['content-type']), /application\/xml/);
  assert.match(res.body, /<loc>http:\/\/localhost:3001\/<\/loc>/);
  assert.ok(res.body.includes('/categories/iran')); assert.ok(res.body.includes('/news/published-news'));
  assert.ok(res.body.includes('<lastmod>2026-09-08T00:00:00.000Z</lastmod>'));
  assert.doesNotMatch(res.body, /localhost:3000|PRIVATE|DRAFT|body/);
  for (const call of state.calls) { assert.equal(call.where?.status, 'PUBLISHED');
    if (call.select) assert.deepEqual(call.select, { slug: true, updatedAt: true }); }
  assert.equal(escapeXml('&<>"\''), '&amp;&lt;&gt;&quot;&apos;');
});
test('empty database produces home-only XML and large maps produce child maps', async (t) => {
  const { app, state } = await harness(t); state.count = 0; state.categoryCount = 0;
  const empty = await app.inject('/sitemap.xml'); assert.equal(empty.statusCode, 200);
  assert.equal((empty.body.match(/<url>/g) ?? []).length, 1);
  state.count = 20_001;
  const index = await app.inject('/sitemap.xml'); assert.match(index.body, /<sitemapindex/);
  assert.equal((index.body.match(/<sitemap>/g) ?? []).length, 3);
  assert.ok(index.body.includes('/sitemaps/3.xml'));
  assert.equal((await app.inject('/sitemaps/2.xml')).statusCode, 200);
  assert.equal((await app.inject('/sitemaps/0.xml')).statusCode, 400);
});
test('robots is public and points to frontend sitemap', async (t) => {
  const { app } = await harness(t); const res = await app.inject('/robots.txt');
  assert.equal(res.statusCode, 200); assert.match(String(res.headers['content-type']), /text\/plain/);
  assert.ok(res.body.includes('Disallow: /admin')); assert.ok(res.body.includes('Sitemap: http://localhost:3001/sitemap.xml'));
});
test('JSON-LD uses shared public lookup, description fallback, absolute image and no private data', async (t) => {
  const { app, published } = await harness(t);
  const res = await app.inject('/news/published-news/structured-data'); assert.equal(res.statusCode, 200, res.body);
  const data = res.json(); assert.equal(data['@type'], 'NewsArticle'); assert.equal(data.description, 'خلاصه');
  assert.equal(data.dateModified, published.updatedAt.toISOString()); assert.equal(data.headline, published.title);
  assert.deepEqual(data.author, { '@type': 'Person', name: 'نویسنده' });
  assert.deepEqual(data.image, ['http://localhost:3000/uploads/image.png']);
  assert.doesNotMatch(res.body, /PRIVATE|authorId|passwordHash|seoTitle/);
  const detail = await app.inject('/news/published-news');
  assert.equal(detail.json().seoTitle, null); assert.equal(detail.json().metaDescription, null);
  const missing = await app.inject('/news/missing/structured-data');
  for (const slug of ['draft', 'archived', 'rejected', 'in-review']) {
    const hidden = await app.inject(`/news/${slug}/structured-data`);
    assert.equal(hidden.statusCode, 404); assert.equal(hidden.body, missing.body);
  }
  assert.equal(missing.body, (await app.inject('/news/missing')).body);
});
