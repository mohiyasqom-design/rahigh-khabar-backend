import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { errorResponses } from '../../utils/http-schemas.js';
import { idParamsSchema, paginationShape } from '../../utils/validation.js';
import { requireSiteUser } from '../users/index.js';
import { isFollowing, listFeed, listFollows, toggleFollow } from './follows.service.js';

const followBodySchema = z.object({ follow: z.boolean() }).strict();
const feedQuerySchema = z.object({ ...paginationShape }).strict();

const followingSchema = {
  type: 'object', additionalProperties: false, required: ['following'],
  properties: { following: { type: 'boolean' } },
} as const;

const categorySchema = {
  type: 'object', additionalProperties: false, required: ['id', 'name', 'slug'],
  properties: { id: { type: 'string' }, name: { type: 'string' }, slug: { type: 'string' } },
} as const;

const followsSchema = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: { items: { type: 'array', items: categorySchema } },
} as const;

const feedItemSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'title', 'slug', 'lead', 'publishedAt', 'coverImageUrl', 'categories'],
  properties: {
    id: { type: 'string' }, title: { type: 'string' }, slug: { type: 'string' },
    lead: { type: 'string' }, publishedAt: { type: ['string', 'null'] },
    coverImageUrl: { type: ['string', 'null'] },
    categories: { type: 'array', items: categorySchema },
  },
} as const;

const feedSchema = {
  type: 'object', additionalProperties: false, required: ['items', 'pagination'],
  properties: {
    items: { type: 'array', items: feedItemSchema },
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
 * Stage 10 Part 5 - following categories. Personal data, so every response is
 * `no-store`: a shared CDN cache must never serve one visitor's feed to another.
 */
export const categoryFollowsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/me/') || request.url.includes('/follow')) {
      reply.header('Cache-Control', 'no-store');
    }
    return payload;
  });

  app.post('/categories/:id/follow', {
    onRequest: [app.authenticateSiteUser],
    schema: { response: { 200: followingSchema, ...errorResponses } },
  }, async (request) => {
    const user = requireSiteUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const { follow } = followBodySchema.parse(request.body);
    return toggleFollow(app.prisma, user.id, id, follow);
  });

  app.get('/categories/:id/follow', {
    onRequest: [app.authenticateSiteUser],
    schema: { response: { 200: followingSchema, ...errorResponses } },
  }, async (request) => {
    const user = requireSiteUser(request);
    const { id } = idParamsSchema.parse(request.params);
    return { following: await isFollowing(app.prisma, user.id, id) };
  });

  app.get('/me/follows', {
    onRequest: [app.authenticateSiteUser],
    schema: { response: { 200: followsSchema, ...errorResponses } },
  }, async (request) => {
    const user = requireSiteUser(request);
    return { items: await listFollows(app.prisma, user.id) };
  });

  app.get('/me/feed', {
    onRequest: [app.authenticateSiteUser],
    schema: { response: { 200: feedSchema, ...errorResponses } },
  }, async (request) => {
    const user = requireSiteUser(request);
    const query = feedQuerySchema.parse(request.query);
    return listFeed(app.prisma, user.id, query.page, query.pageSize);
  });
};

export default categoryFollowsRoutes;
