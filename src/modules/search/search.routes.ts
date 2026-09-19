import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import { errorResponses } from '../../utils/http-schemas.js';
import {
  searchQuerySchema, searchResponseSchema, suggestQuerySchema, suggestResponseSchema,
} from './search.schema.js';
import { searchNews, suggestNews } from './search.service.js';

/**
 * Public search. Rate limited per route because a full-text + embedding query
 * is far more expensive than a normal read, and answered with `no-store` +
 * `noindex` so result pages never enter a cache or a search engine.
 */
export const searchRoutesInner: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, { global: false });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.get('/', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: { response: { 200: searchResponseSchema, ...errorResponses } },
  }, async (request) => {
    const query = searchQuerySchema.parse(request.query);
    return searchNews(app.prisma, query);
  });

  app.get('/suggest', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    schema: { response: { 200: suggestResponseSchema, ...errorResponses } },
  }, async (request) => {
    const { q } = suggestQuerySchema.parse(request.query);
    return { items: await suggestNews(app.prisma, q) };
  });
};

export default searchRoutesInner;
