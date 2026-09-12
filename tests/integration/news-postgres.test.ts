import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/modules/auth/password.js';
import { AUTH_COOKIE_NAME } from '../../src/modules/auth/auth.cookie.js';
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must point to a disposable migrated PostgreSQL database.');

test('PostgreSQL: complete Category/News CRUD, RBAC, publication and atomic relations', async (t) => {
  const { buildApp } = await import('../../src/app.js');
  const app = buildApp();
  const prisma = new PrismaClient({ log: [] });
  const prefix = `m4-${randomUUID()}`;
  const userIds: string[] = [];
  const categoryIds: string[] = [];
  let mediaId: string | undefined;
  t.after(async () => {
    try { await app.close(); }
    finally {
      try {
        await prisma.news.deleteMany({ where: { slug: { startsWith: prefix } } });
        await prisma.category.deleteMany({ where: { slug: { startsWith: prefix } } });
        if (mediaId) await prisma.media.deleteMany({ where: { id: mediaId } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      } finally { await prisma.$disconnect(); }
    }
  });
  await app.ready();
  const passwordHash = await hashPassword('integration-only-secret-123');
  async function user(role: 'ADMIN' | 'SUPER_ADMIN', suffix: string) {
    const row = await prisma.user.create({ data: { email: `${prefix}-${suffix}@example.invalid`, displayName: suffix, passwordHash, role } });
    userIds.push(row.id);
    return { row, headers: { cookie: `${AUTH_COOKIE_NAME}=${app.jwt.sign({ userId: row.id, role })}` } };
  }
  const root = await user('SUPER_ADMIN', 'root');
  const owner = await user('ADMIN', 'owner');
  const other = await user('ADMIN', 'other');
  const cat = await app.inject({ method: 'POST', url: '/admin/categories', headers: owner.headers,
    payload: { name: 'ایران', slug: `${prefix}-iran` } });
  assert.equal(cat.statusCode, 201, cat.body);
  const catId: string = cat.json().id; categoryIds.push(catId);
  const second = await app.inject({ method: 'POST', url: '/admin/categories', headers: root.headers,
    payload: { name: 'سیاست', slug: `${prefix}-politics`, description: 'test' } });
  assert.equal(second.statusCode, 201, second.body);
  const secondId: string = second.json().id; categoryIds.push(secondId);
  assert.equal((await app.inject({ method: 'POST', url: '/admin/categories', headers: root.headers,
    payload: { name: 'duplicate', slug: `${prefix}-iran` } })).statusCode, 409);
  assert.equal((await app.inject('/categories')).statusCode, 200);
  assert.equal((await app.inject({ url: '/admin/categories', headers: owner.headers })).statusCode, 200);
  assert.equal((await app.inject({ method: 'PATCH', url: `/admin/categories/${catId}`, headers: owner.headers,
    payload: { description: 'ویرایش' } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'DELETE', url: `/admin/categories/${catId}`, headers: owner.headers })).statusCode, 403);
  const media = await prisma.media.create({ data: { url: 'https://example.invalid/cover.jpg', mimeType: 'image/jpeg' } });
  mediaId = media.id;
  const payload = { title: 'خبر', slug: `${prefix}-story`, lead: 'لید', body: 'متن', categoryIds: [catId],
    coverImageId: media.id, seoTitle: 'سئو', metaDescription: 'متا' };
  for (const extra of [{ authorId: root.row.id }, { status: 'PUBLISHED' }]) {
    assert.equal((await app.inject({ method: 'POST', url: '/admin/news', headers: owner.headers, payload: { ...payload, ...extra } })).statusCode, 400);
  }
  for (const extra of [{ categoryIds: ['missing'] }, { categoryIds: [] }, { coverImageId: 'missing' }]) {
    assert.equal((await app.inject({ method: 'POST', url: '/admin/news', headers: owner.headers, payload: { ...payload, ...extra } })).statusCode, 400);
  }
  const created = await app.inject({ method: 'POST', url: '/admin/news', headers: owner.headers, payload });
  assert.equal(created.statusCode, 201, created.body);
  const id: string = created.json().id;
  const url = `/admin/news/${id}`;
  assert.equal(created.json().authorId, owner.row.id); assert.equal(created.json().status, 'DRAFT'); assert.equal(created.json().publishedAt, null);
  assert.equal((await app.inject({ method: 'POST', url: '/admin/news', headers: owner.headers, payload })).statusCode, 409);
  const absent = await app.inject(`/news/${prefix}-absent`);
  const draft = await app.inject(`/news/${payload.slug}`);
  assert.equal(draft.statusCode, 404); assert.equal(draft.body, absent.body);
  const adminList = await app.inject({ url: `/admin/news?categoryId=${catId}`, headers: owner.headers });
  assert.equal(adminList.json().pagination.total, 1);
  const othersList = await app.inject({ url: `/admin/news?categoryId=${catId}`, headers: other.headers });
  assert.equal(othersList.json().pagination.total, 0);
  assert.equal((await app.inject({ url, headers: other.headers })).statusCode, 403);
  assert.equal((await app.inject({ method: 'PATCH', url, headers: other.headers, payload: { title: 'forbidden' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'PATCH', url, headers: owner.headers, payload: { status: 'PUBLISHED' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PATCH', url, headers: owner.headers,
    payload: { categoryIds: [secondId], summary: 'خلاصه', coverImageId: null } })).statusCode, 200);
  assert.equal((await prisma.newsCategory.count({ where: { newsId: id, categoryId: catId } })), 0);
  assert.equal((await prisma.newsCategory.count({ where: { newsId: id, categoryId: secondId } })), 1);
  assert.equal((await app.inject({ method: 'PATCH', url, headers: owner.headers, payload: { categoryIds: ['missing'] } })).statusCode, 400);
  assert.equal((await prisma.newsCategory.count({ where: { newsId: id, categoryId: secondId } })), 1);
  const transition = (status: string) => app.inject({ method: 'POST', url: `${url}/status`, headers: root.headers, payload: { status } });
  assert.equal((await app.inject({ method: 'POST', url: `${url}/status`, headers: owner.headers, payload: { status: 'PUBLISHED' } })).statusCode, 403);
  assert.equal((await transition('IN_REVIEW')).statusCode, 200);
  assert.equal((await app.inject(`/news/${payload.slug}`)).statusCode, 404);
  assert.equal((await transition('REJECTED')).statusCode, 200);
  assert.equal((await app.inject(`/news/${payload.slug}`)).statusCode, 404);
  assert.equal((await transition('PUBLISHED')).statusCode, 400);
  assert.equal((await transition('DRAFT')).statusCode, 200);
  const concurrent = await Promise.all([transition('PUBLISHED'), transition('PUBLISHED')]);
  assert.deepEqual(concurrent.map((r) => r.statusCode).sort(), [200, 400]);
  const published = await prisma.news.findUniqueOrThrow({ where: { id } });
  assert.ok(published.publishedAt);
  const originalTime = published.publishedAt.getTime();
  assert.equal((await transition('DRAFT')).statusCode, 400);
  assert.equal((await app.inject({ method: 'PATCH', url, headers: owner.headers, payload: { title: 'forbidden' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'PATCH', url, headers: root.headers, payload: { title: 'منتشرشده' } })).statusCode, 200);
  const publicDetail = await app.inject(`/news/${payload.slug}`);
  assert.equal(publicDetail.statusCode, 200, publicDetail.body);
  assert.equal(publicDetail.json().seoTitle, 'سئو'); assert.equal(publicDetail.json().metaDescription, 'متا');
  assert.deepEqual(publicDetail.json().author, { displayName: 'owner' });
  assert.doesNotMatch(publicDetail.body, /passwordHash|authorId|"status"|@example.invalid/);
  const publicList = await app.inject(`/news?categorySlug=${prefix}-politics&page=1&pageSize=1`);
  assert.equal(publicList.json().pagination.total, 1); assert.equal(publicList.json().items.length, 1);
  assert.equal((await app.inject(`/news?categorySlug=${prefix}-iran`)).json().pagination.total, 0);
  assert.equal((await transition('ARCHIVED')).statusCode, 200);
  assert.equal((await app.inject(`/news/${payload.slug}`)).body, absent.body);
  assert.equal((await app.inject(`/news?categorySlug=${prefix}-politics`)).json().pagination.total, 0);
  assert.equal((await app.inject({ method: 'PATCH', url, headers: owner.headers, payload: { title: 'forbidden' } })).statusCode, 403);
  assert.equal((await transition('PUBLISHED')).statusCode, 200);
  assert.equal((await prisma.news.findUniqueOrThrow({ where: { id } })).publishedAt?.getTime(), originalTime);
  assert.equal((await app.inject({ method: 'DELETE', url: `/admin/categories/${secondId}`, headers: root.headers })).statusCode, 204);
  assert.equal((await app.inject(`/news/${payload.slug}`)).json().categories.length, 0);
  assert.equal((await app.inject({ method: 'DELETE', url, headers: owner.headers })).statusCode, 403);
  assert.equal((await app.inject({ method: 'DELETE', url, headers: root.headers })).statusCode, 204);
  assert.equal(await prisma.news.findUnique({ where: { id } }), null);
  assert.equal(await prisma.newsCategory.count({ where: { newsId: id } }), 0);
  assert.equal((await app.inject({ method: 'DELETE', url, headers: root.headers })).statusCode, 404);
  assert.equal((await app.inject({ method: 'PATCH', url: '/admin/categories/missing', headers: root.headers, payload: { name: 'x' } })).statusCode, 404);
});
