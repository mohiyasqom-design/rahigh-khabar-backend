import type { FastifyPluginAsync } from 'fastify';
import { errorResponses } from '../../utils/http-schemas.js';
import { emptyQuerySchema, idParamsSchema } from '../../utils/validation.js';
import { requireSiteUser } from '../users/index.js';
import { getLikeState, toggleLike } from './likes.service.js';

export const likeStateSchema = {
  type: 'object', additionalProperties: false, required: ['liked', 'likesCount'],
  properties: { liked: { type: 'boolean' }, likesCount: { type: 'integer' } },
} as const;

export const likesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });

  app.post('/news/:id/like', {
    preHandler: [app.authenticateSiteUser],
    config: { rateLimit: { max: 30, timeWindow: 60_000 } },
    schema: { response: { 200: likeStateSchema, ...errorResponses } },
  }, async (request) => {
    emptyQuerySchema.parse(request.query);
    const { id } = idParamsSchema.parse(request.params);
    const user = requireSiteUser(request);
    return toggleLike(app.prisma, id, user.id);
  });

  // Public, but personalised when a visitor cookie is present. This is the only
  // source of `liked` for the UI: the ISR-cached article payload must never
  // carry per-visitor state.
  app.get('/news/:id/likes', {
    preHandler: [app.optionalSiteUser],
    config: { rateLimit: { max: 120, timeWindow: 60_000 } },
    schema: { response: { 200: likeStateSchema, ...errorResponses } },
  }, async (request) => {
    emptyQuerySchema.parse(request.query);
    const { id } = idParamsSchema.parse(request.params);
    return getLikeState(app.prisma, id, request.siteUser?.id ?? null);
  });
};

export default likesRoutes;
