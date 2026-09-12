import type { FastifyPluginAsync } from 'fastify';
import { env } from '../../config/env.js';
import { authCookieOptions, AUTH_COOKIE_NAME } from './auth.cookie.js';
import { loginSchema, publicUserResponseSchema } from './auth.schema.js';
import { validateCredentials } from './auth.service.js';
import { errorResponses } from '../../utils/http-schemas.js';

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });
  fastify.post('/login', {
    bodyLimit: 8192,
    config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: env.AUTH_RATE_LIMIT_WINDOW_MS } },
    schema: { response: { 200: publicUserResponseSchema, ...errorResponses } },
  }, async (request, reply) => {
    const mediaType = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') {
      return reply.code(415).send({ code: 'JSON_REQUIRED', message: 'بدنه باید JSON باشد.' });
    }
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'INVALID_INPUT', message: 'ورودی نامعتبر است.' });
    }
    const user = await validateCredentials(fastify.prisma, parsed.data);
    if (!user) {
      return reply.code(401).send({ code: 'INVALID_CREDENTIALS', message: 'ایمیل یا رمز عبور نادرست است' });
    }
    const token = await reply.jwtSign({ userId: user.id, role: user.role });
    reply.setCookie(AUTH_COOKIE_NAME, token, { ...authCookieOptions, maxAge: env.JWT_EXPIRES_IN });
    return reply.code(200).send(user);
  });
  // Idempotent, including absent or expired cookies. JWT revocation is not implied.
  fastify.post('/logout', async (_request, reply) => {
    reply.clearCookie(AUTH_COOKIE_NAME, authCookieOptions);
    return reply.code(204).send();
  });
  fastify.get('/me', {
    preHandler: fastify.authenticate,
    schema: { response: { 200: publicUserResponseSchema, ...errorResponses } },
  }, async (request, reply) => reply.send(request.authUser));
};
export default authRoutes;
