import type { FastifyPluginAsync } from 'fastify';
import searchRoutesInner from './search.routes.js';

// The module owns its prefix so app.ts can register it without repeating it.
export const searchRoutes: FastifyPluginAsync = async (app) => {
  await app.register(searchRoutesInner, { prefix: '/search' });
};

export {
  buildEmbeddingSource, createEmbedding, deleteNewsEmbedding,
  isEmbeddingEnabled, storeNewsEmbedding, syncNewsEmbedding,
} from './embedding.service.js';
export { searchNews, suggestNews } from './search.service.js';
export default searchRoutes;
