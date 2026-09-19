import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync } from 'fastify';
import { env } from '../../config/env.js';
import { mediaRoutes } from './media.routes.js';
import { mediaUploadRoutes } from './media.upload.routes.js';
import { LocalMediaStorage, storedFilenamePattern } from './storage.js';
const mediaModule: FastifyPluginAsync = async (app) => {
  const storage = new LocalMediaStorage(env.UPLOAD_DIR, env.PUBLIC_API_URL);
  await storage.initialize();
  await storage.recover(async (id) => Boolean(await app.prisma.media.findUnique({ where: { id }, select: { id: true } })));
  if (env.NODE_ENV === 'production') {
    app.log.warn('Local media storage requires a persistent volume and backups. Ephemeral Railway storage loses uploads on redeploy.');
  }
  await app.register(multipart, {
    limits: { files: 1, fields: 1, parts: 2, fileSize: env.MAX_UPLOAD_SIZE_BYTES, fieldSize: 2048, fieldNameSize: 100 },
    throwFileSizeLimit: true,
  });
  await app.register(fastifyStatic, {
    root: storage.root, prefix: '/uploads/', index: false, dotfiles: 'deny',
    allowedPath: (pathName) => storedFilenamePattern.test(pathName.replace(/^\//, '')),
    setHeaders: (response) => {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      response.setHeader('Cache-Control', 'public, max-age=3600');
    },
  });
  await app.register(mediaRoutes, { prefix: '/admin/media', storage, maxUploadSize: env.MAX_UPLOAD_SIZE_BYTES });
  // Stage 10 Part 5 device uploads: registered inside this module so they
  // share its multipart and static-file setup.
  await app.register(mediaUploadRoutes, { storage, maxUploadSize: env.MAX_UPLOAD_SIZE_BYTES });
};
export default mediaModule;
