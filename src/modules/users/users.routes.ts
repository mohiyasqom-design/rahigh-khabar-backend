import type { FastifyPluginAsync } from 'fastify';
import { errorResponses } from '../../utils/http-schemas.js';
import { emptyQuerySchema } from '../../utils/validation.js';
import { USER_COOKIE_NAME, userCookieOptions } from '../auth/auth.cookie.js';
import { requireSiteUser } from './index.js';
import {
  siteUserResponseSchema, updateProfileSchema,
  usernameAvailabilityResponseSchema, usernameQuerySchema,
} from './users.schema.js';
import { getProfile, isUsernameAvailable, updateProfile } from './users.service.js';

export const usersRoutes: FastifyPluginAsync = async (app) => {
  // Account data is never cacheable, not even by a shared proxy.
  app.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });

  app.get('/users/me', {
    preHandler: [app.authenticateSiteUser],
    schema: { response: { 200: siteUserResponseSchema, ...errorResponses } },
  }, async (request) => {
    emptyQuerySchema.parse(request.query);
    return getProfile(requireSiteUser(request));
  });

  app.patch('/users/me', {
    preHandler: [app.authenticateSiteUser],
    config: { rateLimit: { max: 20, timeWindow: 60_000 } },
    schema: { response: { 200: siteUserResponseSchema, ...errorResponses } },
  }, async (request) => {
    emptyQuerySchema.parse(request.query);
    const input = updateProfileSchema.parse(request.body);
    return updateProfile(app.prisma, requireSiteUser(request), input);
  });

  // Public on purpose: the onboarding form needs live feedback before a session
  // exists in the browser tab. Rate limited so it cannot be used to enumerate.
  app.get('/users/check-username', {
    config: { rateLimit: { max: 60, timeWindow: 60_000 } },
    schema: { response: { 200: usernameAvailabilityResponseSchema, ...errorResponses } },
  }, async (request) => {
    const { username } = usernameQuerySchema.parse(request.query);
    return { username, available: await isUsernameAvailable(app.prisma, username) };
  });

  app.post('/users/logout', {
    config: { rateLimit: { max: 30, timeWindow: 60_000 } },
    schema: { response: { 204: { type: 'null' }, ...errorResponses } },
  }, async (request, reply) => {
    emptyQuerySchema.parse(request.query);
    // Clearing is unconditional: an already-anonymous caller still gets 204,
    // so وابستگی to a valid session cannot strand a stale cookie.
    reply.clearCookie(USER_COOKIE_NAME, userCookieOptions);
    return reply.code(204).send();
  });
};

export default usersRoutes;
