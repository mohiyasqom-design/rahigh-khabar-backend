import type { FastifyPluginAsync } from 'fastify';
import { errorResponses } from '../../utils/http-schemas.js';
import { emptyQuerySchema, idParamsSchema } from '../../utils/validation.js';
import { categoriesResponseSchema, categoryResponseSchema, createCategorySchema, updateCategorySchema } from './categories.schema.js';
import { createCategory, deleteCategory, listCategories, updateCategory } from './categories.service.js';

export const categoriesAdminRoutes: FastifyPluginAsync = async (app) => {
  const editors = [app.authenticate, app.requireRole('ADMIN', 'SUPER_ADMIN')];
  app.post('/', { preHandler: editors, schema: { response: { 201: categoryResponseSchema, ...errorResponses } } },
    async (request, reply) => {
      emptyQuerySchema.parse(request.query);
      const item = await createCategory(app.prisma, createCategorySchema.parse(request.body));
      return reply.code(201).send(item);
    });
  app.get('/', { preHandler: editors, schema: { response: { 200: categoriesResponseSchema, ...errorResponses } } },
    async (request) => {
      emptyQuerySchema.parse(request.query);
      return listCategories(app.prisma);
    });
  app.patch('/:id', { preHandler: editors, schema: { response: { 200: categoryResponseSchema, ...errorResponses } } },
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const { id } = idParamsSchema.parse(request.params);
      return updateCategory(app.prisma, id, updateCategorySchema.parse(request.body));
    });
  app.delete('/:id', {
    preHandler: [app.authenticate, app.requireRole('SUPER_ADMIN')],
    schema: { response: { 204: { type: 'null' }, ...errorResponses } },
  }, async (request, reply) => {
    emptyQuerySchema.parse(request.query);
    const { id } = idParamsSchema.parse(request.params);
    await deleteCategory(app.prisma, id);
    return reply.code(204).send();
  });
};
export const categoriesPublicRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { schema: { response: { 200: categoriesResponseSchema, ...errorResponses } } }, async (request) => {
    emptyQuerySchema.parse(request.query);
    return listCategories(app.prisma);
  });
};
