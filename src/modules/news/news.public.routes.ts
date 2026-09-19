import type { FastifyPluginAsync } from 'fastify';
import { errorResponses } from '../../utils/http-schemas.js';
import { emptyQuerySchema } from '../../utils/validation.js';
import { newsSlugParamsSchema, paginatedResponseSchema, publicNewsDetailSchema, publicNewsItemSchema, publicNewsQuerySchema } from './news.schema.js';
import { getPublicNews, listPublicNews } from './news.service.js';
const newsPublicRoutes: FastifyPluginAsync = async (app) => {
  // Do not cache public content here: archive must stop public reads immediately.
  app.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });
  app.get('/', { schema: { response: { 200: paginatedResponseSchema(publicNewsItemSchema), ...errorResponses } } },
    async (request) => listPublicNews(app.prisma, publicNewsQuerySchema.parse(request.query)));
  app.get('/:slug', {
    // Optional visitor session so a signed-in reader gets likedByCurrentUser.
    // Anonymous requests are unaffected and still answer for everyone.
    preHandler: [app.optionalSiteUser],
    schema: { response: { 200: publicNewsDetailSchema, ...errorResponses } },
  }, async (request) => {
    emptyQuerySchema.parse(request.query);
    const { slug } = newsSlugParamsSchema.parse(request.params);
    return getPublicNews(app.prisma, slug, request.siteUser?.id ?? null);
  });
};
export default newsPublicRoutes;
