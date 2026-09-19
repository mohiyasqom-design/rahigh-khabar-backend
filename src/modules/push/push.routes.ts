import type { FastifyPluginAsync } from 'fastify';
import { env, isPushConfigured } from '../../config/env.js';
import { ApiError } from '../../utils/api-error.js';
import { errorResponses } from '../../utils/http-schemas.js';
import {
  broadcastSchema, deliverySchema, okSchema, publicKeySchema, statusSchema,
  subscribeSchema, unsubscribeSchema,
} from './push.schema.js';
import { broadcast, countSubscribers, subscribe, unsubscribe } from './push.service.js';

function assertConfigured(): void {
  if (!isPushConfigured()) {
    throw new ApiError(503, 'PUSH_NOT_CONFIGURED',
      'اعلان‌ها فعلاً فعال نیستند.');
  }
}

export const pushRoutesInner: FastifyPluginAsync = async (app) => {
  // The client needs the public key before it can call subscribe(); `enabled`
  // lets the UI hide the banner entirely when push is not configured.
  app.get('/public-key', {
    schema: { response: { 200: publicKeySchema, ...errorResponses } },
  }, async () => ({
    publicKey: isPushConfigured() ? env.VAPID_PUBLIC_KEY ?? null : null,
    enabled: isPushConfigured(),
  }));

  app.post('/subscribe', {
    onRequest: [app.optionalSiteUser],
    schema: { response: { 201: okSchema, ...errorResponses } },
  }, async (request, reply) => {
    assertConfigured();
    const input = subscribeSchema.parse(request.body);
    await subscribe(
      app.prisma, input,
      request.siteUser?.id ?? null,
      request.headers['user-agent'] ?? null,
    );
    reply.code(201);
    return { ok: true };
  });

  app.post('/unsubscribe', {
    schema: { response: { 200: okSchema, ...errorResponses } },
  }, async (request) => {
    const { endpoint } = unsubscribeSchema.parse(request.body);
    await unsubscribe(app.prisma, endpoint);
    return { ok: true };
  });

  app.get('/status', {
    onRequest: [app.authenticate, app.requireRole('ADMIN', 'SUPER_ADMIN')],
    schema: { response: { 200: statusSchema, ...errorResponses } },
  }, async () => ({
    enabled: isPushConfigured(),
    subscribers: await countSubscribers(app.prisma),
  }));

  app.post('/broadcast', {
    onRequest: [app.authenticate, app.requireRole('ADMIN', 'SUPER_ADMIN')],
    schema: { response: { 200: deliverySchema, ...errorResponses } },
  }, async (request) => {
    assertConfigured();
    const input = broadcastSchema.parse(request.body);
    return broadcast(app.prisma, {
      title: input.title,
      body: input.body,
      ...(input.url ? { url: input.url } : {}),
    }, input.categoryId);
  });
};

export default pushRoutesInner;
