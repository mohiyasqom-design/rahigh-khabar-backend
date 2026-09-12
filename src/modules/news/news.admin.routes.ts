import type { FastifyPluginAsync } from 'fastify';
import { errorResponses } from '../../utils/http-schemas.js';
import { emptyQuerySchema, idParamsSchema } from '../../utils/validation.js';
import { requireActor } from './news.policy.js';
import { adminNewsQuerySchema, adminNewsResponseSchema, changeStatusSchema, createNewsSchema, paginatedResponseSchema, updateNewsSchema } from './news.schema.js';
import { changeNewsStatus, createNews, deleteNews, getAdminNews, listAdminNews, updateNews } from './news.service.js';
const newsAdminRoutes: FastifyPluginAsync = async (app) => {
  const editors = [app.authenticate, app.requireRole('ADMIN', 'SUPER_ADMIN')];
  const superAdmin = [app.authenticate, app.requireRole('SUPER_ADMIN')];
  app.post('/', { preHandler: editors, schema: { response: { 201: adminNewsResponseSchema, ...errorResponses } } },
    async (request, reply) => {
      emptyQuerySchema.parse(request.query);
      const news = await createNews(app.prisma, requireActor(request.authUser), createNewsSchema.parse(request.body));
      return reply.code(201).send(news);
    });
  app.get('/', { preHandler: editors, schema: { response: { 200: paginatedResponseSchema(adminNewsResponseSchema), ...errorResponses } } },
    async (request) => listAdminNews(app.prisma, requireActor(request.authUser), adminNewsQuerySchema.parse(request.query)));
  app.get('/:id', { preHandler: editors, schema: { response: { 200: adminNewsResponseSchema, ...errorResponses } } },
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const { id } = idParamsSchema.parse(request.params);
      return getAdminNews(app.prisma, requireActor(request.authUser), id);
    });
  app.patch('/:id', { preHandler: editors, schema: { response: { 200: adminNewsResponseSchema, ...errorResponses } } },
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const { id } = idParamsSchema.parse(request.params);
      return updateNews(app.prisma, requireActor(request.authUser), id, updateNewsSchema.parse(request.body));
    });
  app.delete('/:id', { preHandler: superAdmin, schema: { response: { 204: { type: 'null' }, ...errorResponses } } },
    async (request, reply) => {
      emptyQuerySchema.parse(request.query);
      const { id } = idParamsSchema.parse(request.params);
      await deleteNews(app.prisma, requireActor(request.authUser), id);
      return reply.code(204).send();
    });
  app.post('/:id/status', { preHandler: superAdmin, schema: { response: { 200: adminNewsResponseSchema, ...errorResponses } } },
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const { id } = idParamsSchema.parse(request.params);
      const { status } = changeStatusSchema.parse(request.body);
      return changeNewsStatus(app.prisma, requireActor(request.authUser), id, status);
    });
};
export default newsAdminRoutes;
