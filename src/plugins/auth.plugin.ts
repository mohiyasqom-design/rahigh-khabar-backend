import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Role } from '@prisma/client';
import { env } from '../config/env.js';
import { findCurrentUser, toPublicUser } from '../modules/users/index.js';
import type { PublicUser } from '../modules/users/index.js';
import { AUTH_COOKIE_NAME } from '../modules/auth/auth.cookie.js';
import { getDummyHash } from '../modules/auth/password.js';

type AuthClaims = { userId: string; role: Role };
declare module '@fastify/jwt' {
  interface FastifyJWT { payload: AuthClaims; user: AuthClaims; }
}
declare module 'fastify' {
  interface FastifyRequest { authUser: PublicUser | null; }
  interface FastifyInstance {
    authenticate: preHandlerAsyncHookHandler;
    requireRole: (...roles: Role[]) => preHandlerAsyncHookHandler;
  }
}
function unauthorized(reply: FastifyReply, expired = false) {
  return reply.code(401).send({
    code: expired ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED',
    message: expired ? 'نشست شما منقضی شده است؛ دوباره وارد شوید.' : 'احراز هویت لازم است.',
  });
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

  // CORS alone is not CSRF protection. Also covers future unsafe routes.
  //
  // TEMPORARY (remove after rahighkhabar.ir custom domain is live on both
  // frontend and backend): *.up.railway.app is on the Public Suffix List, so
  // the frontend and backend subdomains are cross-site to the browser even
  // though CORS_ORIGIN matches exactly. That makes sec-fetch-site always
  // "cross-site" between them and blocks every real login. This narrow,
  // explicit allowlist exists only to unblock testing during that window —
  // it does not weaken CSRF protection for any other origin. DELETE
  // TEMP_CROSS_SITE_ORIGIN_ALLOWLIST and this comment once both services are
  // on rahighkhabar.ir subdomains and sec-fetch-site will correctly read
  // "same-site" on its own.
  const TEMP_CROSS_SITE_ORIGIN_ALLOWLIST = new Set([env.CORS_ORIGIN]);
  fastify.addHook('onRequest', async (request, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    reply.header('Cache-Control', 'no-store');
    const origin = request.headers.origin;
    const isTempAllowedCrossSite =
      origin !== undefined &&
      origin === env.CORS_ORIGIN &&
      request.headers['sec-fetch-site'] === 'cross-site' &&
      TEMP_CROSS_SITE_ORIGIN_ALLOWLIST.has(origin);
    if (
      !isTempAllowedCrossSite &&
      ((origin !== undefined && origin !== env.CORS_ORIGIN) || request.headers['sec-fetch-site'] === 'cross-site')
    ) {
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
      const expired = typeof error === 'object' && error !== null && 'code' in error &&
        error.code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED';
      return unauthorized(reply, expired);
    }
    const claims = request.user;
    if (!claims || typeof claims.userId !== 'string' || !claims.userId ||
        !['ADMIN', 'SUPER_ADMIN'].includes(claims.role)) return unauthorized(reply);
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
}, { name: 'auth', fastify: '5.x', dependencies: ['prisma'] });
