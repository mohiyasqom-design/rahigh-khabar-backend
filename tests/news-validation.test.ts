import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewsSchema, updateNewsSchema, adminNewsQuerySchema, publicNewsQuerySchema, changeStatusSchema } from '../src/modules/news/news.schema.js';
import { createCategorySchema, updateCategorySchema } from '../src/modules/categories/categories.schema.js';
const validNews = { title: 'خبر آزمایشی', slug: 'test-news', lead: 'لید', body: 'متن', categoryIds: ['category-1'] };
test('news creation validates required fields and rejects mass assignment', () => {
  assert.equal(createNewsSchema.safeParse(validNews).success, true);
  for (const extra of [{ status: 'PUBLISHED' }, { authorId: 'other' }, { publishedAt: '2026-01-01' }, { unknown: true }]) {
    assert.equal(createNewsSchema.safeParse({ ...validNews, ...extra }).success, false);
    assert.equal(updateNewsSchema.safeParse(extra).success, false);
  }
  for (const overrides of [{ title: ' ' }, { slug: 'Bad_Slug' }, { slug: 'bad--slug' }, { categoryIds: [] },
    { categoryIds: ['a', 'a'] }, { categoryIds: [''] }, { body: '' }, { lead: '' }, { coverImageId: '' }]) {
    assert.equal(createNewsSchema.safeParse({ ...validNews, ...overrides }).success, false);
  }
});
test('PATCH is partial, nonempty, strict and supports clearing nullable fields', () => {
  assert.equal(updateNewsSchema.safeParse({}).success, false);
  assert.equal(updateNewsSchema.safeParse({ categoryIds: [] }).success, false);
  assert.equal(updateNewsSchema.safeParse({ title: 'جدید' }).success, true);
  assert.equal(updateNewsSchema.safeParse({ summary: null, coverImageId: null, seoTitle: null, metaDescription: null }).success, true);
  assert.equal(updateNewsSchema.safeParse({ title: null }).success, false);
});
test('pagination has safe defaults and rejects malformed/oversized parameters', () => {
  assert.deepEqual(publicNewsQuerySchema.parse({}), { page: 1, pageSize: 20 });
  for (const query of [{ page: '0' }, { page: '-1' }, { page: '1.5' }, { page: '1e3' }, { page: '100001' },
    { pageSize: '101' }, { pageSize: '' }, { page: ['1', '2'] }, { status: 'DRAFT' }, { authorId: 'other' }]) {
    assert.equal(publicNewsQuerySchema.safeParse(query).success, false);
  }
  assert.deepEqual(adminNewsQuerySchema.parse({ status: 'ARCHIVED', categoryId: 'a', pageSize: '100' }),
    { page: 1, pageSize: 100, status: 'ARCHIVED', categoryId: 'a' });
  assert.equal(adminNewsQuerySchema.safeParse({ status: 'BOGUS' }).success, false);
  assert.equal(publicNewsQuerySchema.safeParse({ categorySlug: 'iran-news' }).success, true);
});
test('category schemas enforce slugs, nullable description and nonempty patches', () => {
  assert.equal(createCategorySchema.safeParse({ name: 'ایران', slug: 'iran' }).success, true);
  for (const slug of ['', 'ایران', 'Iran', '-iran', 'iran-', 'iran--news', 'iran_news', 'iran news']) {
    assert.equal(createCategorySchema.safeParse({ name: 'ایران', slug }).success, false);
  }
  assert.equal(updateCategorySchema.safeParse({}).success, false);
  assert.equal(updateCategorySchema.safeParse({ description: null }).success, true);
});
test('status input is explicit, required and rejects additional fields', () => {
  assert.equal(changeStatusSchema.safeParse({ status: 'PUBLISHED' }).success, true);
  assert.equal(changeStatusSchema.safeParse({ status: 'PUBLISHED', publishedAt: 'yesterday' }).success, false);
  assert.equal(changeStatusSchema.safeParse({ status: 'published' }).success, false);
  assert.equal(changeStatusSchema.safeParse({}).success, false);
});
