import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Role } from '@prisma/client';
import { env } from '../config/env.js';
import { findCurrentUser, findSiteUser, toPublicUser } from '../modules/users/index.js';
import type { PublicUser, SiteUser } from '../modules/users/index.js';
import { AUTH_COOKIE_NAME, USER_COOKIE_NAME } from '../modules/auth/auth.cookie.js';
import { getDummyHash } from '../modules/auth/password.js';

// Two disjoint session kinds share one secret but never one guard:
//  - admin/staff tokens carry `role` and live in AUTH_COOKIE_NAME
//  - site visitor tokens carry `kind: 'site'` and live in USER_COOKIE_NAME
// A visitor token therefore cannot satisfy `authenticate`, and an admin token
// cannot satisfy `authenticateSiteUser`.
type AuthClaims = { userId: string; role?: Role; kind?: 'site' };
declare module '@fastify/jwt' {
  interface FastifyJWT { payload: AuthClaims; user: AuthClaims; }
}
declare module 'fastify' {
  interface FastifyRequest { authUser: PublicUser | null; siteUser: SiteUser | null; }
  interface FastifyInstance {
    authenticate: preHandlerAsyncHookHandler;
    requireRole: (...roles: Role[]) => preHandlerAsyncHookHandler;
    authenticateSiteUser: preHandlerAsyncHookHandler;
    optionalSiteUser: preHandlerAsyncHookHandler;
  }
}
function unauthorized(reply: FastifyReply, expired = false) {
  return reply.code(401).send({
    code: expired ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED',
    message: expired ? 'نشست شما منقضی شده است؛ دوباره وارد شوید.' : 'احراز هویت لازم است.',
  });
}

// @fastify/jwt raises FST_JWT_* from the request decorators and fast-jwt raises
// FAST_JWT_* from the bare verifier; accept both so the UI can tell "expired"
// apart from "invalid" no matter which path produced the error.
function isExpiredTokenError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED' || code === 'FAST_JWT_EXPIRED';
}

async function loadSiteUser(
  fastify: FastifyInstance,
  request: FastifyRequest,
): Promise<{ user: SiteUser | null; expired: boolean }> {
  const token = request.cookies[USER_COOKIE_NAME];
  if (typeof token !== 'string' || token.length === 0) return { user: null, expired: false };
  let claims: AuthClaims;
  try {
    claims = fastify.jwt.verify<AuthClaims>(token);
  } catch (error) {
    return { user: null, expired: isExpiredTokenError(error) };
  }
  if (typeof claims.userId !== 'string' || claims.userId.length === 0 || claims.kind !== 'site') {
    return { user: null, expired: false };
  }
  // Read-through on every request so a deleted account stops working at once.
  const user = await findSiteUser(fastify.prisma, claims.userId);
  return { user, expired: false };
}

export default fp(async (fastify) => {
  await fastify.register(cookie);
  await fastify.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: AUTH_COOKIE_NAME, signed: false },
    sign: { algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN },
    verify: { algorithms: ['HS256'] },
  });
  await fastify.register(rateLimit, {
    global: false, hook: 'onRequest',
    errorResponseBuilder: () => ({
      statusCode: 429, code: 'TOO_MANY_REQUESTS',
      message: 'تلاش‌های ورود بیش از حد مجاز است؛ بعداً دوباره تلاش کنید.',
    }),
  });
  await getDummyHash();
  fastify.decorateRequest('authUser', null);
  fastify.decorateRequest('siteUser', null);

  // CORS alone is not CSRF protection. Also covers future unsafe routes.
  fastify.addHook('onRequest', async (request, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    reply.header('Cache-Control', 'no-store');
    const origin = request.headers.origin;
    if ((origin !== undefined && origin !== env.CORS_ORIGIN) || request.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).send({ code: 'ORIGIN_NOT_ALLOWED', message: 'مبدأ درخواست مجاز نیست.' });
    }
    // Origin-less CLI clients are allowed. SameSite=Lax excludes cross-site POST
    // cookies; login only accepts JSON, preventing HTML form login CSRF.
  });

  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    request.authUser = null;
    try { await request.jwtVerify({ onlyCookie: true }); }
    catch (error) {
      return unauthorized(reply, isExpiredTokenError(error));
    }
    const claims = request.user;
    if (!claims || typeof claims.userId !== 'string' || !claims.userId ||
        claims.role === undefined || !['ADMIN', 'SUPER_ADMIN'].includes(claims.role)) return unauthorized(reply);
    // Query current status/role: deactivation and demotion work before expiry.
    // DB failures propagate to sanitized 500, rather than masquerading as 401.
    const user = await findCurrentUser(fastify.prisma, claims.userId);
    if (!user?.isActive) return unauthorized(reply);
    request.authUser = toPublicUser(user);
    request.user = { userId: user.id, role: user.role };
  });
  fastify.decorate('requireRole', (...roles: Role[]): preHandlerAsyncHookHandler =>
    async (request, reply) => {
      if (!request.authUser) return unauthorized(reply);
      if (!roles.includes(request.authUser.role)) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'اجازهٔ دسترسی ندارید.' });
      }
    },
  );

  // Stage 10 Part 2 - visitor guards. Mandatory variant for writes.
  fastify.decorate('authenticateSiteUser', async function (request: FastifyRequest, reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    request.siteUser = null;
    const { user, expired } = await loadSiteUser(fastify, request);
    if (!user) return unauthorized(reply, expired);
    request.siteUser = user;
  });
  // Optional variant for public reads that are personalised when signed in
  // (for example "did I already like this?"). Never rejects the request.
  fastify.decorate('optionalSiteUser', async function (request: FastifyRequest, reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    const { user } = await loadSiteUser(fastify, request);
    request.siteUser = user;
  });
}, { name: 'auth', fastify: '5.x', dependencies: ['prisma'] });
