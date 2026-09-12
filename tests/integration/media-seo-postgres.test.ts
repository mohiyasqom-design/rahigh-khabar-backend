import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/modules/auth/password.js';
import { png, multipartBody } from '../media-fixtures.js';
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must point to a disposable migrated PostgreSQL database.');
test('PostgreSQL: upload, published-only SEO and media deletion clears every cover reference', async (t) => {
  // No env/app imports until this test has selected its own private upload root.
  const root = await mkdtemp(join(tmpdir(), 'rk-media-pg-'));
  process.env.UPLOAD_DIR = root;
  const { buildApp } = await import('../../src/app.js');
  const { AUTH_COOKIE_NAME } = await import('../../src/modules/auth/auth.cookie.js');
  const app = buildApp(); const prisma = new PrismaClient({ log: [] });
  const prefix = `m5-${randomUUID()}`;
  const userIds: string[] = []; let mediaId: string | undefined;
  t.after(async () => {
    try { await app.close(); }
    finally {
      try {
        await prisma.news.deleteMany({ where: { slug: { startsWith: prefix } } });
        await prisma.category.deleteMany({ where: { slug: { startsWith: prefix } } });
        if (mediaId) await prisma.media.deleteMany({ where: { id: mediaId } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      } finally { await prisma.$disconnect(); await rm(root, { recursive: true, force: true }); }
    }
  });
  await app.ready();
  const passwordHash = await hashPassword('test-only-integration-password');
  async function user(role: 'ADMIN' | 'SUPER_ADMIN') {
    const row = await prisma.user.create({ data: { email: `${prefix}-${role}@example.invalid`, displayName: role, role, passwordHash } });
    userIds.push(row.id);
    return { row, headers: { cookie: `${AUTH_COOKIE_NAME}=${app.jwt.sign({ userId: row.id, role })}` } };
  }
  const admin = await user('ADMIN'); const superAdmin = await user('SUPER_ADMIN');
  const category = await prisma.category.create({ data: { name: 'ایران', slug: `${prefix}-iran` } });
  const form = multipartBody([{ name: 'altText', value: 'تصویر آزمایشی خبر' },
    { name: 'file', filename: '../../fake.php', mime: 'image/png', value: png }]);
  const uploaded = await app.inject({ method: 'POST', url: '/admin/media', payload: form.payload,
    headers: { ...admin.headers, ...form.headers } });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  mediaId = uploaded.json().id as string;
  const stored = await prisma.media.findUniqueOrThrow({ where: { id: mediaId } });
  assert.equal(stored.width, 3); assert.equal(stored.height, 2); assert.equal(stored.sizeBytes, png.length);
  assert.equal(stored.mimeType, 'image/png'); assert.equal(stored.altText, 'تصویر آزمایشی خبر');
  const imagePath = new URL(stored.url).pathname;
  assert.deepEqual((await app.inject(imagePath)).rawPayload, png);
  const statuses = ['PUBLISHED', 'DRAFT', 'IN_REVIEW', 'ARCHIVED', 'REJECTED'] as const;
  for (const status of statuses) {
    await prisma.news.create({ data: {
      title: `خبر ${status}`, slug: `${prefix}-${status.toLowerCase().replaceAll('_', '-')}`,
      lead: 'لید', body: 'متن', summary: 'خلاصه', seoTitle: '   ', metaDescription: '',
      authorId: admin.row.id, coverImageId: mediaId, status,
      publishedAt: status === 'PUBLISHED' ? new Date() : null,
      categories: { create: { categoryId: category.id } },
    } });
  }
  const sitemap = await app.inject('/sitemap.xml'); assert.equal(sitemap.statusCode, 200, sitemap.body);
  assert.ok(sitemap.body.includes(`/news/${prefix}-published`));
  assert.ok(sitemap.body.includes(`/categories/${prefix}-iran`));
  for (const status of ['draft', 'in-review', 'archived', 'rejected']) {
    assert.ok(!sitemap.body.includes(`/news/${prefix}-${status}`));
    const hidden = await app.inject(`/news/${prefix}-${status}/structured-data`);
    assert.equal(hidden.statusCode, 404); assert.equal(hidden.body, (await app.inject('/news/missing/structured-data')).body);
  }
  const ld = await app.inject(`/news/${prefix}-published/structured-data`);
  assert.equal(ld.statusCode, 200, ld.body); assert.equal(ld.json()['@type'], 'NewsArticle');
  assert.deepEqual(ld.json().image, [stored.url]); assert.equal(ld.json().description, 'خلاصه');
  const detail = await app.inject(`/news/${prefix}-published`);
  assert.equal(detail.json().seoTitle, null); assert.equal(detail.json().metaDescription, null);
  assert.equal((await app.inject('/robots.txt')).statusCode, 200);
  const url = `/admin/media/${mediaId}`;
  assert.equal((await app.inject({ method: 'DELETE', url, headers: admin.headers })).statusCode, 403);
  assert.equal(await prisma.news.count({ where: { coverImageId: mediaId } }), 5);
  const deleted = await app.inject({ method: 'DELETE', url, headers: superAdmin.headers });
  assert.equal(deleted.statusCode, 204, deleted.body);
  assert.equal(await prisma.media.findUnique({ where: { id: mediaId } }), null);
  assert.equal(await prisma.news.count({ where: { coverImageId: mediaId } }), 0);
  assert.equal(await prisma.news.count({ where: { slug: { startsWith: prefix }, coverImageId: null } }), 5);
  assert.equal((await app.inject(imagePath)).statusCode, 404);
  assert.ok(!('image' in (await app.inject(`/news/${prefix}-published/structured-data`)).json()));
});
