import Fastify from 'fastify';
import fp from 'fastify-plugin';
import { createHmac } from 'node:crypto';
import type { PrismaClient, User } from '@prisma/client';
import corsPlugin from '../src/plugins/cors.plugin.js';
import authPlugin from '../src/plugins/auth.plugin.js';
import authRoutes from '../src/modules/auth/index.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/auth.cookie.js';
import { configureErrorHandlers } from '../src/utils/error-handlers.js';
import { env } from '../src/config/env.js';

export const testPassword = 'Correct-test-password-123!';
let storedHash: Promise<string> | undefined;
export async function makeUser(overrides: Partial<User> = {}): Promise<User> {
  storedHash ??= hashPassword(testPassword);
  return {
    id: 'test-admin-id', email: 'admin@example.com', passwordHash: await storedHash,
    displayName: 'مدیر آزمایشی', role: 'SUPER_ADMIN', isActive: true,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}
export function cookieFrom(headers: { 'set-cookie'?: string | string[] | undefined }): string {
  const value = headers['set-cookie'];
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) throw new Error('Expected session cookie');
  return first.split(';')[0] ?? '';
}
/** Only for negative test vectors; never used in production code. */
export function signedTestCookie(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', env.JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${AUTH_COOKIE_NAME}=${header}.${payload}.${signature}`;
}
export async function harness(initialUsers: User[] = []) {
  const state = { users: initialUsers, failQueries: false, calls: 0 };
  const prisma = {
    user: {
      findUnique: async ({ where, select }: {
        where: { id?: string; email?: string }; select: Record<string, boolean>;
      }) => {
        state.calls++;
        if (state.failQueries) throw new Error('PRIVATE database connection detail');
        const user = state.users.find((candidate) =>
          where.id !== undefined ? candidate.id === where.id : candidate.email === where.email,
        );
        if (!user) return null;
        return Object.fromEntries(Object.entries(select).filter(([, enabled]) => enabled)
          .map(([key]) => [key, user[key as keyof User]]));
      },
    },
  } as unknown as PrismaClient;
  const app = Fastify({ logger: false, trustProxy: false });
  configureErrorHandlers(app);
  app.register(corsPlugin);
  app.register(fp(async (scope) => { scope.decorate('prisma', prisma); }, { name: 'prisma' }));
  app.register(authPlugin);
  app.register(authRoutes, { prefix: '/auth' });
  app.register(async (scope) => {
    scope.get('/test/admin', { preHandler: [scope.authenticate, scope.requireRole('SUPER_ADMIN')] },
      async () => ({ ok: true }));
    scope.get('/test/rbac-only', { preHandler: scope.requireRole('SUPER_ADMIN') }, async () => ({ ok: true }));
  });
  await app.ready();
  const login = (password = testPassword, email = 'admin@example.com', ip = '127.0.0.1') =>
    app.inject({ method: 'POST', url: '/auth/login', payload: { email, password }, remoteAddress: ip });
  const session = (user: User, options: { expiresIn?: number } = {}) => {
    if (options.expiresIn !== undefined) {
      const iat = Math.floor(Date.now() / 1000) - 10;
      return signedTestCookie({ userId: user.id, role: user.role, iat, exp: iat + options.expiresIn });
    }
    return `${AUTH_COOKIE_NAME}=${app.jwt.sign({ userId: user.id, role: user.role })}`;
  };
  return { app, state, login, session };
}
