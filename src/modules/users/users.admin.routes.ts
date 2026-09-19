import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { errorResponses } from '../../utils/http-schemas.js';
import { pageResult, paginationShape } from '../../utils/validation.js';

const usersQuerySchema = z.object({
  ...paginationShape,
  kind: z.enum(['staff', 'site']).default('site'),
}).strict();

const listSchema = {
  type: 'object', additionalProperties: false, required: ['items', 'pagination'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'displayName', 'email', 'role', 'createdAt', 'kind', 'username'],
        properties: {
          id: { type: 'string' }, displayName: { type: 'string' },
          email: { type: ['string', 'null'] }, role: { type: 'string' },
          createdAt: { type: 'string' }, kind: { type: 'string' },
          username: { type: ['string', 'null'] },
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
} as const;

/**
 * Stage 10 Part 5 - read-only user management for the admin panel. Staff and
 * site visitors live in two different tables, so `kind` selects which one is
 * listed instead of merging them into one ambiguous list. No password hash or
 * Google id is ever selected.
 */
export const adminUsersRoutes: FastifyPluginAsync = async (app) => {
  app.get('/admin/users', {
    onRequest: [app.authenticate, app.requireRole('SUPER_ADMIN')],
    schema: { response: { 200: listSchema, ...errorResponses } },
  }, async (request) => {
    const query = usersQuerySchema.parse(request.query);
    const skip = (query.page - 1) * query.pageSize;
    if (query.kind === 'staff') {
      const [rows, total] = await Promise.all([
        app.prisma.user.findMany({
          orderBy: { createdAt: 'desc' }, skip, take: query.pageSize,
          select: { id: true, displayName: true, email: true, role: true, createdAt: true },
        }),
        app.prisma.user.count(),
      ]);
      return pageResult(rows.map((row) => ({
        id: row.id, displayName: row.displayName, email: row.email,
        role: row.role as string, createdAt: row.createdAt.toISOString(),
        kind: 'staff', username: null,
      })), total, query.page, query.pageSize);
    }
    const [rows, total] = await Promise.all([
      app.prisma.regularUser.findMany({
        orderBy: { createdAt: 'desc' }, skip, take: query.pageSize,
        select: {
          id: true, displayName: true, email: true, role: true,
          createdAt: true, username: true,
        },
      }),
      app.prisma.regularUser.count(),
    ]);
    return pageResult(rows.map((row) => ({
      id: row.id, displayName: row.displayName, email: row.email,
      role: row.role as string, createdAt: row.createdAt.toISOString(),
      kind: 'site', username: row.username,
    })), total, query.page, query.pageSize);
  });
};

export default adminUsersRoutes;
