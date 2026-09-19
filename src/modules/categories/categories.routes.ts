import type { FastifyPluginAsync } from 'fastify';
import { errorResponses } from '../../utils/http-schemas.js';
import { emptyQuerySchema, idParamsSchema } from '../../utils/validation.js';
import { categoriesResponseSchema, categoryResponseSchema, createCategorySchema, updateCategorySchema } from './categories.schema.js';
import { createCategory, deleteCategory, listCategories, updateCategory } from './categories.service.js';

export const categoriesAdminRoutes: FastifyPluginAsync = async (app) => {
  // Least privilege, stage 10: ADMIN and WRITER-level accounts may READ the
  // list (they must pick a category when writing news) but may not reshape the
  // site's navigation. Every write is SUPER_ADMIN only.
  const readers = [app.authenticate, app.requireRole('ADMIN', 'SUPER_ADMIN')];
  const owners = [app.authenticate, app.requireRole('SUPER_ADMIN')];
  app.post('/', { preHandler: owners, schema: { response: { 201: categoryResponseSchema, ...errorResponses } } },
    async (request, reply) => {
      emptyQuerySchema.parse(request.query);
      const item = await createCategory(app.prisma, createCategorySchema.parse(request.body));
      return reply.code(201).send(item);
    });
  app.get('/', { preHandler: readers, schema: { response: { 200: categoriesResponseSchema, ...errorResponses } } },
    async (request) => {
      emptyQuerySchema.parse(request.query);
      return listCategories(app.prisma);
    });
  app.patch('/:id', { preHandler: owners, schema: { response: { 200: categoryResponseSchema, ...errorResponses } } },
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const { id } = idParamsSchema.parse(request.params);
      return updateCategory(app.prisma, id, updateCategorySchema.parse(request.body));
    });
  app.delete('/:id', {
    preHandler: owners,
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
