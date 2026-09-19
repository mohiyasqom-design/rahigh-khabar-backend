import type { FastifyPluginAsync } from 'fastify';
import pushRoutesInner from './push.routes.js';

export const pushRoutes: FastifyPluginAsync = async (app) => {
  await app.register(pushRoutesInner, { prefix: '/push' });
};

export {
  announcePublishedNews, broadcast, countSubscribers, subscribe, unsubscribe,
} from './push.service.js';
export default pushRoutes;
