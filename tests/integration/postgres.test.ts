import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/modules/auth/password.js';
import { cookieFrom } from '../helpers.js';

// Explicit opt-in only. Use a disposable database with migrations already applied.
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is required for integration tests. Use a disposable migrated PostgreSQL database.');
}

test('real PostgreSQL: login, me, role change, deactivate, logout, duplicate email', async (t) => {
  const { buildApp } = await import('../../src/app.js');
  const app = buildApp();
  const prisma = new PrismaClient({ log: [] });
  const email = `auth-test-${randomUUID()}@example.invalid`;
  t.after(async () => {
    try { await app.close(); }
    finally {
      try { await prisma.user.deleteMany({ where: { email } }); }
      finally { await prisma.$disconnect(); }
    }
  });
  await app.ready();
  const password = 'integration-only-password-123';
  const data = { email, displayName: 'Integration Test', passwordHash: await hashPassword(password), role: 'SUPER_ADMIN' as const };
  const user = await prisma.user.create({ data });
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  assert.equal(login.statusCode, 200); assert.equal(login.json().role, 'SUPER_ADMIN');
  assert.ok(!login.body.includes(data.passwordHash));
  const headers = { cookie: cookieFrom(login.headers) };
  assert.equal((await app.inject({ url: '/auth/me', headers })).statusCode, 200);
  await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
  assert.equal((await app.inject({ url: '/auth/me', headers })).json().role, 'ADMIN');
  await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
  assert.equal((await app.inject({ url: '/auth/me', headers })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/auth/logout', headers })).statusCode, 204);
  await assert.rejects(prisma.user.create({ data }), (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002');
});
