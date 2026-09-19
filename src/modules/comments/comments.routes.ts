import type { FastifyPluginAsync } from 'fastify';
import { errorResponses } from '../../utils/http-schemas.js';
import { emptyQuerySchema } from '../../utils/validation.js';
import { requireSiteUser } from '../users/index.js';
import {
  commentListQuerySchema, commentPageSchema, commentSchema,
  createCommentSchema, idParamsSchema,
} from './comments.schema.js';
import { createComment, deleteComment, listComments } from './comments.service.js';

import { z as adminCommentsZod } from 'zod';
import {
  pageResult as adminCommentsPage, paginationShape as adminCommentsPagination,
} from '../../utils/validation.js';

// Stage 10 Part 5 - moderation list. Only DELETE existed before, so comments
// could not actually be reviewed from the admin panel.
const adminCommentsQuerySchema = adminCommentsZod.object({
  ...adminCommentsPagination,
  includeDeleted: adminCommentsZod.enum(['true', 'false']).default('false')
    .transform((value) => value === 'true'),
}).strict();


export const commentsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });

  app.post('/news/:id/comments', {
    preHandler: [app.authenticateSiteUser],
    config: { rateLimit: { max: 10, timeWindow: 60_000 } },
    schema: { response: { 201: commentSchema, ...errorResponses } },
  }, async (request, reply) => {
    emptyQuerySchema.parse(request.query);
    const { id } = idParamsSchema.parse(request.params);
    const input = createCommentSchema.parse(request.body);
    const user = requireSiteUser(request);
    const comment = await createComment(app.prisma, id, { id: user.id, isAdmin: user.role !== 'USER' }, input);
    return reply.code(201).send(comment);
  });

  app.get('/news/:id/comments', {
    config: { rateLimit: { max: 120, timeWindow: 60_000 } },
    schema: { response: { 200: commentPageSchema, ...errorResponses } },
  }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const query = commentListQuerySchema.parse(request.query);
    return listComments(app.prisma, id, query);
  });

  // Author self-service deletion.
  app.delete('/comments/:id', {
    preHandler: [app.authenticateSiteUser],
    config: { rateLimit: { max: 30, timeWindow: 60_000 } },
    schema: { response: { 204: { type: 'null' }, ...errorResponses } },
  }, async (request, reply) => {
    emptyQuerySchema.parse(request.query);
    const { id } = idParamsSchema.parse(request.params);
    const user = requireSiteUser(request);
    await deleteComment(app.prisma, id, { id: user.id, isAdmin: user.role !== 'USER' });
    return reply.code(204).send();
  });

  // Staff moderation. Uses the admin session, which is a different cookie and a
  // different account table, so it was impossible through the route above.
  app.get('/admin/comments', {
    onRequest: [app.authenticate, app.requireRole('ADMIN', 'SUPER_ADMIN')],
    schema: {
      response: {
        200: {
          type: 'object', additionalProperties: false, required: ['items', 'pagination'],
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false,
                required: ['id', 'body', 'createdAt', 'isDeleted', 'authorName', 'newsTitle', 'newsSlug'],
                properties: {
                  id: { type: 'string' }, body: { type: 'string' },
                  createdAt: { type: 'string' }, isDeleted: { type: 'boolean' },
                  authorName: { type: 'string' }, newsTitle: { type: 'string' },
                  newsSlug: { type: 'string' },
                },
              },
            },
            pagination: {
              type: 'object', additionalProperties: false,
              required: ['page', 'pageSize', 'total', 'totalPages'],
              properties: {
                page: { type: 'integer' }, pageSize: { type: 'integer' },
                total: { type: 'integer' }, totalPages: { type: 'integer' },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (request) => {
    const query = adminCommentsQuerySchema.parse(request.query);
    const where = query.includeDeleted ? {} : { isDeleted: false };
    const [items, total] = await Promise.all([
      app.prisma.comment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true, body: true, createdAt: true, isDeleted: true,
          author: { select: { displayName: true, username: true } },
          news: { select: { title: true, slug: true } },
        },
      }),
      app.prisma.comment.count({ where }),
    ]);
    return adminCommentsPage(items.map((item) => ({
      id: item.id,
      // Deleted comments are listed for context but their text stays hidden.
      body: item.isDeleted ? '' : item.body,
      createdAt: item.createdAt.toISOString(),
      isDeleted: item.isDeleted,
      authorName: item.author?.displayName ?? item.author?.username ?? 'کاربر حذف‌شده',
      newsTitle: item.news?.title ?? '',
      newsSlug: item.news?.slug ?? '',
    })), total, query.page, query.pageSize);
  });

  app.delete('/admin/comments/:id', {
    preHandler: [app.authenticate, app.requireRole('ADMIN', 'SUPER_ADMIN')],
    schema: { response: { 204: { type: 'null' }, ...errorResponses } },
  }, async (request, reply) => {
    emptyQuerySchema.parse(request.query);
    const { id } = idParamsSchema.parse(request.params);
    await deleteComment(app.prisma, id, { id: request.authUser?.id ?? '', isAdmin: true });
    return reply.code(204).send();
  });
};

export default commentsRoutes;
