import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import fp from 'fastify-plugin';
import type { PrismaClient } from '@prisma/client';
import authPlugin from '../src/plugins/auth.plugin.js';
import corsPlugin from '../src/plugins/cors.plugin.js';
import { categoriesAdminRoutes, categoriesPublicRoutes } from '../src/modules/categories/index.js';
import { newsAdminRoutes, newsPublicRoutes } from '../src/modules/news/index.js';
import { configureErrorHandlers } from '../src/utils/error-handlers.js';
import { makeUser } from './helpers.js';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/auth.cookie.js';

async function newsHarness() {
  const admin = await makeUser({ id: 'admin', role: 'ADMIN' });
  const whereChecks: unknown[] = [];
  const fixture = {
    id: 'internal-news-id', title: 'خبر', slug: 'public-news', summary: null, lead: 'لید', body: 'متن',
    status: 'PUBLISHED', authorId: 'internal-author', publishedAt: new Date('2026-01-01T00:00:00Z'),
    seoTitle: 'سئو', metaDescription: 'متا', coverImage: null,
    author: { displayName: 'نویسنده', email: 'private@example.invalid', passwordHash: 'PRIVATE_HASH' },
    categories: [{ category: { id: 'cat', name: 'ایران', slug: 'iran', description: null, order: 1, internal: 'PRIVATE_FIELD' } }],
  };
  const prisma = {
    user: { findUnique: async () => admin },
    category: { findMany: async () => [] },
    news: {
      findUnique: async () => ({ ...fixture, authorId: 'other', status: 'DRAFT' }),
      findMany: async ({ where }: { where: unknown }) => { whereChecks.push(where); return [fixture]; },
      count: async ({ where }: { where: unknown }) => { whereChecks.push(where); return 1; },
      findFirst: async ({ where }: { where: { slug: string; status: string } }) => {
        whereChecks.push(where); return where.slug === 'public-news' ? fixture : null;
      },
    },
    $transaction: async (operations: unknown) => Array.isArray(operations) ? Promise.all(operations) :
      (operations as (client: unknown) => Promise<unknown>)(prisma),
  };
  const app = Fastify({ logger: false });
  configureErrorHandlers(app);
  app.register(corsPlugin);
  app.register(fp(async (scope) => { scope.decorate('prisma', prisma as unknown as PrismaClient); }, { name: 'prisma' }));
  app.register(authPlugin);
  app.register(categoriesAdminRoutes, { prefix: '/admin/categories' });
  app.register(categoriesPublicRoutes, { prefix: '/categories' });
  app.register(newsAdminRoutes, { prefix: '/admin/news' });
  app.register(newsPublicRoutes, { prefix: '/news' });
  await app.ready();
  const headers = { cookie: `${AUTH_COOKIE_NAME}=${app.jwt.sign({ userId: admin.id, role: admin.role })}` };
  return { app, headers, whereChecks };
}
test('all ten admin routes reject missing sessions', async (t) => {
  const { app } = await newsHarness(); t.after(() => app.close());
  const routes = [
    ['POST', '/admin/categories'], ['GET', '/admin/categories'], ['PATCH', '/admin/categories/cat'], ['DELETE', '/admin/categories/cat'],
    ['POST', '/admin/news'], ['GET', '/admin/news'], ['GET', '/admin/news/n'], ['PATCH', '/admin/news/n'],
    ['DELETE', '/admin/news/n'], ['POST', '/admin/news/n/status'],
  ] as const;
  for (const [method, url] of routes) {
    const response = await app.inject({ method, url });
    assert.equal(response.statusCode, 401, `${method} ${url}: ${response.body}`);
  }
});
test('Admin cannot write categories, delete either entity or change status, and cannot read/edit another author', async (t) => {
  const { app, headers } = await newsHarness(); t.after(() => app.close());
  for (const [method, url, payload] of [
    // Stage 10: category writes are SUPER_ADMIN only; reading stays open to ADMIN.
    ['POST', '/admin/categories', { name: 'ایران', slug: 'iran' }],
    ['PATCH', '/admin/categories/cat', { name: 'ایران' }],
    ['DELETE', '/admin/categories/cat', undefined],
    ['DELETE', '/admin/news/n', undefined], ['POST', '/admin/news/n/status', undefined],
    ['GET', '/admin/news/n', undefined], ['PATCH', '/admin/news/n', { title: 'new' }],
  ] as const) {
    const response = await app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
    assert.equal(response.statusCode, 403, `${method} ${url}: ${response.body}`);
  }
  assert.equal((await app.inject({ url: '/admin/categories', headers })).statusCode, 200);
});
test('public serialization strips internal fields and queries/counts require PUBLISHED', async (t) => {
  const { app, whereChecks } = await newsHarness(); t.after(() => app.close());
  const list = await app.inject('/news?categorySlug=iran');
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().items[0].body, undefined);
  const detail = await app.inject('/news/public-news');
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().seoTitle, 'سئو');
  assert.equal(detail.json().metaDescription, 'متا');
  assert.equal(detail.json().publishedAt, '2026-01-01T00:00:00.000Z');
  for (const response of [list, detail]) {
    assert.doesNotMatch(response.body, /authorId|internal-news-id|passwordHash|private@example|PRIVATE_|"status"/);
    assert.deepEqual((response === list ? response.json().items[0] : response.json()).author, { displayName: 'نویسنده' });
  }
  assert.equal(whereChecks.length, 3);
  for (const where of whereChecks) assert.equal((where as { status: string }).status, 'PUBLISHED');
  assert.deepEqual(whereChecks[0], { status: 'PUBLISHED', categories: { some: { category: { slug: 'iran' } } } });
  assert.deepEqual(whereChecks[1], whereChecks[0]);
  assert.equal((await app.inject('/categories')).statusCode, 200);
});
test('public missing/nonpublic slugs get the identical 404; invalid query and forged fields get 400', async (t) => {
  const { app, headers } = await newsHarness(); t.after(() => app.close());
  const missing = await app.inject('/news/missing');
  const draft = await app.inject('/news/draft');
  assert.equal(missing.statusCode, 404); assert.equal(draft.statusCode, 404); assert.equal(missing.body, draft.body);
  assert.equal((await app.inject('/news?status=DRAFT')).statusCode, 400);
  assert.equal((await app.inject('/news?pageSize=101')).statusCode, 400);
  assert.equal((await app.inject({ method: 'PATCH', url: '/admin/news/n', headers, payload: { status: 'PUBLISHED' } })).statusCode, 400);
});
test('CORS preflight permits new write methods only for the configured origin', async (t) => {
  const { app } = await newsHarness(); t.after(() => app.close());
  for (const method of ['PATCH', 'DELETE', 'PUT']) {
    const response = await app.inject({ method: 'OPTIONS', url: '/admin/news/n', headers: {
      origin: 'http://localhost:3001', 'access-control-request-method': method, 'access-control-request-headers': 'content-type',
    } });
    assert.equal(response.statusCode, 204);
    assert.ok(String(response.headers['access-control-allow-methods']).includes(method));
    assert.equal(response.headers['access-control-allow-credentials'], 'true');
  }
});
