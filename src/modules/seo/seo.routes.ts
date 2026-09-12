import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { errorResponses } from '../../utils/http-schemas.js';
import { emptyQuerySchema } from '../../utils/validation.js';
import { newsSlugParamsSchema } from '../news/news.schema.js';
import { structuredDataSchema } from './seo.schema.js';
import { getRobots, getSitemap, getSitemapPage, getStructuredData } from './seo.service.js';
const pageParams = z.object({ page: z.string().regex(/^[1-9][0-9]{0,5}$/).transform(Number) }).strict();
const textResponse = { 200: { type: 'string' }, ...errorResponses };
const seoRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });
  app.get('/sitemap.xml', { schema: { response: textResponse } }, async (request, reply) => {
    emptyQuerySchema.parse(request.query);
    const xml = await getSitemap(app.prisma, env.PUBLIC_SITE_URL);
    return reply.type('application/xml; charset=utf-8').send(xml);
  });
  app.get('/sitemaps/:page.xml', { schema: { response: textResponse } }, async (request, reply) => {
    emptyQuerySchema.parse(request.query);
    const { page } = pageParams.parse(request.params);
    const xml = await getSitemapPage(app.prisma, env.PUBLIC_SITE_URL, page);
    return reply.type('application/xml; charset=utf-8').send(xml);
  });
  app.get('/robots.txt', { schema: { response: textResponse } }, async (request, reply) => {
    emptyQuerySchema.parse(request.query);
    return reply.type('text/plain; charset=utf-8').send(getRobots(env.PUBLIC_SITE_URL));
  });
  app.get('/news/:slug/structured-data', { schema: { response: { 200: structuredDataSchema, ...errorResponses } } },
    async (request) => {
      emptyQuerySchema.parse(request.query);
      const { slug } = newsSlugParamsSchema.parse(request.params);
      return getStructuredData(app.prisma, env.PUBLIC_SITE_URL, env.PUBLIC_API_URL, slug);
    });
};
export default seoRoutes;
