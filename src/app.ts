import Fastify from 'fastify';
import type { FastifyBaseLogger } from 'fastify';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import helmet from '@fastify/helmet';
import prismaPlugin from './plugins/prisma.plugin.js';
import corsPlugin from './plugins/cors.plugin.js';
import authPlugin from './plugins/auth.plugin.js';
import authRoutes from './modules/auth/index.js';
import { googleAuthRoutes } from './modules/auth/google/google.routes.js';
import healthRoutes from './modules/health/health.route.js';
import { categoriesAdminRoutes, categoriesPublicRoutes } from './modules/categories/index.js';
import { newsAdminRoutes, newsPublicRoutes } from './modules/news/index.js';
import mediaModule from './modules/media/index.js';
import seoRoutes from './modules/seo/seo.routes.js';
import { likesRoutes } from './modules/likes/likes.routes.js';
import { commentsRoutes } from './modules/comments/comments.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { adminUsersRoutes } from './modules/users/users.admin.routes.js';
import { searchRoutes } from './modules/search/index.js';
import { pushRoutes } from './modules/push/index.js';
import { categoryFollowsRoutes } from './modules/categoryFollows/index.js';
import schedulerPlugin from './modules/scheduler/index.js';
import {
  analyticsAdminRoutes,
  analyticsIngestRoutes,
} from './modules/analytics/index.js';
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
  app.register(googleAuthRoutes, { prefix: '/auth' });
  app.register(categoriesAdminRoutes, { prefix: '/admin/categories' });
  app.register(categoriesPublicRoutes, { prefix: '/categories' });
  app.register(newsAdminRoutes, { prefix: '/admin/news' });
  app.register(newsPublicRoutes, { prefix: '/news' });
  app.register(likesRoutes);
  app.register(commentsRoutes);
  app.register(usersRoutes);
  app.register(mediaModule);
  app.register(adminUsersRoutes);
  // Stage 10 Part 5: search, web push, category follows and the in-process
  // publication scheduler. Each module carries its own prefix.
  app.register(searchRoutes);
  app.register(pushRoutes);
  app.register(categoryFollowsRoutes);
  app.register(schedulerPlugin);
  app.register(seoRoutes);
  app.register(analyticsIngestRoutes);
  app.register(analyticsAdminRoutes, { prefix: '/admin/analytics' });
  return app;
}
// No listen here. Production DB failure remains intentionally fail-fast.
export const app = buildApp();
export default app;
