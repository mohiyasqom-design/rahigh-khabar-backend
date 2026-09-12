import Fastify from 'fastify';
import type { FastifyBaseLogger } from 'fastify';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import helmet from '@fastify/helmet';
import prismaPlugin from './plugins/prisma.plugin.js';
import corsPlugin from './plugins/cors.plugin.js';
import authPlugin from './plugins/auth.plugin.js';
import authRoutes from './modules/auth/index.js';
import healthRoutes from './modules/health/health.route.js';
import { categoriesAdminRoutes, categoriesPublicRoutes } from './modules/categories/index.js';
import { newsAdminRoutes, newsPublicRoutes } from './modules/news/index.js';
import mediaModule from './modules/media/index.js';
import seoRoutes from './modules/seo/seo.routes.js';
import { createLogger } from './utils/logger.js';
import { configureErrorHandlers } from './utils/error-handlers.js';
import { env } from './config/env.js';

export function buildApp() {
  // A.2: avoid inferring Pino's narrower Logger<never, boolean>. Helpers and
  // plugins use FastifyBaseLogger; childLoggerFactory makes these invariant.
  // Set the factory's logger contract explicitly, without casts or relaxed TS.
  // The supplied app.ts line 18 was configureErrorHandlers, not helmet.
  // See docs/MARHALE-4.md for the compatibility investigation.
  const app = Fastify<Server, IncomingMessage, ServerResponse, FastifyBaseLogger>({
    loggerInstance: createLogger(), disableRequestLogging: true,
    requestTimeout: 30_000, bodyLimit: 1_048_576,
    trustProxy: env.TRUST_PROXY.length ? env.TRUST_PROXY : false,
  });
  configureErrorHandlers(app);
  app.register(helmet);
  app.register(corsPlugin);
  app.register(prismaPlugin);
  app.register(authPlugin);
  app.register(authRoutes, { prefix: '/auth' });
  app.register(healthRoutes);
  app.register(categoriesAdminRoutes, { prefix: '/admin/categories' });
  app.register(categoriesPublicRoutes, { prefix: '/categories' });
  app.register(newsAdminRoutes, { prefix: '/admin/news' });
  app.register(newsPublicRoutes, { prefix: '/news' });
  app.register(mediaModule);
  app.register(seoRoutes);
  return app;
}
// No listen here. Production DB failure remains intentionally fail-fast.
export const app = buildApp();
export default app;
