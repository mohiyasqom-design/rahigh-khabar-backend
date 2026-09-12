import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import fp from 'fastify-plugin';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { Media, PrismaClient } from '@prisma/client';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import authPlugin from '../src/plugins/auth.plugin.js';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/auth.cookie.js';
import { configureErrorHandlers } from '../src/utils/error-handlers.js';
import { mediaRoutes } from '../src/modules/media/media.routes.js';
import { LocalMediaStorage, storedFilenamePattern } from '../src/modules/media/storage.js';
import { makeUser } from './helpers.js';
import { multipartBody, png } from './media-fixtures.js';
async function harness(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'rk-media-http-'));
  const storage = new LocalMediaStorage(root, 'http://localhost:3000'); await storage.initialize();
  const user = await makeUser({ role: 'ADMIN' });
  const state = { user, rows: [] as Media[], failCreate: false, failDelete: false };
  const prisma = {
    user: { findUnique: async () => state.user },
    media: {
      create: async ({ data }: { data: Omit<Media, 'id' | 'createdAt'> }) => {
        if (state.failCreate) throw new Error('PRIVATE_DB_FAILURE');
        const row = { ...data, id: `media${state.rows.length + 1}`, createdAt: new Date() }; state.rows.push(row); return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = state.rows.find((item) => item.id === where.id); return row ? { ...row, _count: { news: 2 } } : null;
      },
      findMany: async ({ skip, take }: { skip: number; take: number }) => state.rows.slice(skip, skip + take),
      count: async () => state.rows.length,
      delete: async ({ where }: { where: { id: string } }) => {
        if (state.failDelete) throw new Error('PRIVATE_DELETE_FAILURE');
        state.rows = state.rows.filter((item) => item.id !== where.id);
      },
    },
    $transaction: async (operations: unknown) => Array.isArray(operations) ? Promise.all(operations) :
      (operations as (tx: unknown) => Promise<unknown>)(prisma),
  };
  const app = Fastify({ logger: false }); configureErrorHandlers(app);
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  app.register(fp(async (scope) => { scope.decorate('prisma', prisma as unknown as PrismaClient); }, { name: 'prisma' }));
  app.register(authPlugin);
  app.register(multipart, { limits: { files: 1, fileSize: 1024, fields: 1, parts: 2 } });
  app.register(fastifyStatic, { root, prefix: '/uploads/', index: false, dotfiles: 'deny',
    allowedPath: (pathName) => storedFilenamePattern.test(pathName.replace(/^\//, '')) });
  app.register(mediaRoutes, { prefix: '/admin/media', storage, maxUploadSize: 1024 });
  await app.ready();
  const headers = { cookie: `${AUTH_COOKIE_NAME}=${app.jwt.sign({ userId: user.id, role: user.role })}` };
  const upload = (parts = [{ name: 'file', value: png, filename: '../../attack.html', mime: 'image/png' }] as Parameters<typeof multipartBody>[0]) => {
    const body = multipartBody(parts);
    return app.inject({ method: 'POST', url: '/admin/media', payload: body.payload, headers: { ...body.headers, ...headers } });
  };
  return { app, headers, state, root, upload };
}
test('all media endpoints require auth; live role controls deletion', async (t) => {
  const { app, headers, upload, state } = await harness(t);
  for (const [method, url] of [['POST', '/admin/media'], ['GET', '/admin/media'], ['DELETE', '/admin/media/m']] as const) {
    assert.equal((await app.inject({ method, url })).statusCode, 401);
  }
  const created = await upload(); assert.equal(created.statusCode, 201, created.body);
  const url = `/admin/media/${created.json().id}`;
  assert.equal((await app.inject({ method: 'DELETE', url, headers })).statusCode, 403);
  state.user.role = 'SUPER_ADMIN';
  assert.equal((await app.inject({ method: 'DELETE', url, headers })).statusCode, 204);
  assert.equal((await app.inject({ method: 'DELETE', url, headers })).statusCode, 404);
});
test('upload supports alt text after file, returns dimensions and publicly readable URL', async (t) => {
  const { app, headers, upload } = await harness(t);
  const response = await upload([{ name: 'file', value: png, filename: '../danger.php', mime: 'image/png' },
    { name: 'altText', value: '  تصویر خبر  ' }]);
  assert.equal(response.statusCode, 201, response.body);
  const media = response.json();
  assert.equal(media.width, 3); assert.equal(media.height, 2); assert.equal(media.sizeBytes, png.length);
  assert.equal(media.altText, 'تصویر خبر'); assert.equal(media.mimeType, 'image/png');
  assert.doesNotMatch(response.body, /danger|password|root|pending-delete/);
  const file = await app.inject(new URL(media.url).pathname);
  assert.equal(file.statusCode, 200); assert.deepEqual(file.rawPayload, png);
  const list = await app.inject({ url: '/admin/media?page=1&pageSize=1', headers });
  assert.equal(list.statusCode, 200); assert.equal(list.json().pagination.total, 1);
  assert.equal((await app.inject({ url: '/admin/media?pageSize=101', headers })).statusCode, 400);
});
test('reject oversize, forged MIME, empty form, extra files and unknown fields without persistence', async (t) => {
  const { upload, state } = await harness(t);
  const file = { name: 'file', value: png, filename: 'a.jpg', mime: 'image/png' };
  assert.equal((await upload([])).statusCode, 400);
  assert.equal((await upload([{ ...file, value: Buffer.alloc(1025) }])).statusCode, 413);
  assert.equal((await upload([{ ...file, value: Buffer.from('<script/>') }])).statusCode, 415);
  assert.equal((await upload([{ ...file, mime: 'image/jpeg' }])).statusCode, 415);
  assert.equal((await upload([file, file])).statusCode, 413);
  assert.equal((await upload([file, { name: 'unexpected', value: 'x' }])).statusCode, 400);
  assert.equal((await upload([file, { name: 'altText', value: 'x'.repeat(501) }])).statusCode, 400);
  assert.equal(state.rows.length, 0);
});
test('failed DB create cleans disk; failed delete preserves file; successful delete removes it', async (t) => {
  const { upload, state, root, app, headers } = await harness(t);
  state.failCreate = true;
  const failed = await upload(); assert.equal(failed.statusCode, 500); assert.doesNotMatch(failed.body, /PRIVATE/);
  assert.deepEqual(await readdir(root), ['.pending-delete']);
  state.failCreate = false;
  const response = await upload(); const media = response.json(); state.user.role = 'SUPER_ADMIN';
  state.failDelete = true;
  assert.equal((await app.inject({ method: 'DELETE', url: `/admin/media/${media.id}`, headers })).statusCode, 500);
  assert.equal((await app.inject(new URL(media.url).pathname)).statusCode, 200);
  state.failDelete = false;
  assert.equal((await app.inject({ method: 'DELETE', url: `/admin/media/${media.id}`, headers })).statusCode, 204);
  assert.equal((await app.inject(new URL(media.url).pathname)).statusCode, 404);
});
test('static routes never expose traversal, project files, hidden markers or arbitrary files', async (t) => {
  const { app, root } = await harness(t);
  await writeFile(join(root, 'secret.txt'), 'PRIVATE_STATIC');
  for (const url of ['/uploads/../../../etc/passwd', '/uploads/%2e%2e/%2e%2e/etc/passwd',
    '/uploads/%2e%2e%2f.env', '/uploads/.pending-delete/x', '/uploads/secret.txt', '/uploads/']) {
    const response = await app.inject(url);
    assert.ok([400, 403, 404].includes(response.statusCode), `${url}: ${response.statusCode}`);
    assert.doesNotMatch(response.body, /PRIVATE_STATIC|root:x:/);
  }
});
