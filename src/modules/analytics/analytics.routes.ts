/**
 * Stage 10 Part 4 — analytics routes.
 *
 * Two plugins with very different exposure:
 *  - `analyticsIngestRoutes` is public (a reader is not signed in) and therefore
 *    rate-limited per route, validated strictly, and always answers 204 so a
 *    `sendBeacon` never sees an error.
 *  - `analyticsAdminRoutes` requires a signed-in admin.
 *
 * Note on roles: the brief mentions ADMIN / SUPER_ADMIN / WRITER, but this
 * codebase's Role enum only has ADMIN and SUPER_ADMIN (there is no WRITER).
 * The routes are restricted to the roles that actually exist; adding WRITER
 * later means adding it to the enum and to the `requireRole` list below.
 *
 * The admin routes intentionally declare no 200 response schema: Fastify's
 * serializer strips undeclared properties, and these payloads are deeply
 * nested with deliberate nulls that must reach the dashboard intact.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { ApiError } from '../../utils/api-error.js';
import { errorResponses } from '../../utils/http-schemas.js';
import { idParamsSchema } from '../../utils/validation.js';
import {
  recordPageView,
  recordReadingSession,
  recordShare,
  type IngestContext,
} from './analytics.ingest.service.js';
import { getNewsAnalytics } from './analytics.news.service.js';
import {
  acceptedResponseSchema,
  newsAnalyticsQuerySchema,
  overviewQuerySchema,
  readingSessionEventSchema,
  seriesQuerySchema,
  shareEventSchema,
  topNewsQuerySchema,
  viewEventSchema,
} from './analytics.schema.js';
import { getSiteOverview, getTopNewsPage, getViewsSeries } from './analytics.site.service.js';
import { getSystemStatus } from './analytics.system.service.js';

function ingestContext(request: FastifyRequest): IngestContext {
  const userAgent = request.headers['user-agent'];
  const referer = request.headers['referer'];
  return {
    ip: request.ip,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
    referrerHeader: typeof referer === 'string' ? referer : null,
    userId: request.siteUser?.id ?? null,
  };
}

export const analyticsIngestRoutes: FastifyPluginAsync = async (app) => {
  // `navigator.sendBeacon` cannot always set a JSON content type, so accept
  // text/plain bodies and parse them as JSON. Scoped to this plugin only.
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_request, body, done) => {
    const raw = typeof body === 'string' ? body.trim() : '';
    if (raw.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(raw) as unknown);
    } catch {
      done(new ApiError(400, 'INVALID_JSON_BODY', 'Body must be valid JSON'), undefined);
    }
  });

  app.post(
    '/analytics/view',
    {
      // Signed-in visitors are attributed; anonymous ones still count.
      preHandler: [app.optionalSiteUser],
      config: { rateLimit: { max: 120, timeWindow: 60_000 } },
      schema: { response: { 204: acceptedResponseSchema, ...errorResponses } },
    },
    async (request, reply) => {
      const input = viewEventSchema.parse(request.body ?? {});
      await recordPageView(app.prisma, input, ingestContext(request));
      return reply.code(204).send();
    },
  );

  app.post(
    '/analytics/reading-session',
    {
      preHandler: [app.optionalSiteUser],
      config: { rateLimit: { max: 120, timeWindow: 60_000 } },
      schema: { response: { 204: acceptedResponseSchema, ...errorResponses } },
    },
    async (request, reply) => {
      const input = readingSessionEventSchema.parse(request.body ?? {});
      await recordReadingSession(app.prisma, input, ingestContext(request));
      return reply.code(204).send();
    },
  );

  app.post(
    '/analytics/share',
    {
      preHandler: [app.optionalSiteUser],
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
      schema: { response: { 204: acceptedResponseSchema, ...errorResponses } },
    },
    async (request, reply) => {
      const input = shareEventSchema.parse(request.body ?? {});
      await recordShare(app.prisma, input, ingestContext(request));
      return reply.code(204).send();
    },
  );
};

export const analyticsAdminRoutes: FastifyPluginAsync = async (app) => {
  const admins = [app.authenticate, app.requireRole('ADMIN', 'SUPER_ADMIN')];
  const limits = { rateLimit: { max: 120, timeWindow: 60_000 } };
  const schema = { response: { ...errorResponses } };

  app.get('/overview', { preHandler: admins, config: limits, schema }, async (request) => {
    const { range } = overviewQuerySchema.parse(request.query ?? {});
    return getSiteOverview(app.prisma, range);
  });

  app.get('/views-timeseries', { preHandler: admins, config: limits, schema }, async (request) => {
    const { range } = seriesQuerySchema.parse(request.query ?? {});
    return getViewsSeries(app.prisma, range);
  });

  app.get('/top-news', { preHandler: admins, config: limits, schema }, async (request) => {
    const { range, page, pageSize } = topNewsQuerySchema.parse(request.query ?? {});
    return getTopNewsPage(app.prisma, range, page, pageSize);
  });

  app.get('/system', { preHandler: admins, config: limits, schema }, async () =>
    getSystemStatus(app.prisma),
  );

  app.get('/news/:id', { preHandler: admins, config: limits, schema }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const { range } = newsAnalyticsQuerySchema.parse(request.query ?? {});
    const analytics = await getNewsAnalytics(app.prisma, id, range);
    if (analytics === null) {
      throw new ApiError(404, 'NEWS_NOT_FOUND', 'News not found');
    }
    return analytics;
  });
};

export default analyticsAdminRoutes;
