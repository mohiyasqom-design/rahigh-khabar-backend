import type { FastifyPluginAsync } from 'fastify';
import { checkDatabase, checkStorage } from '../../utils/system-checks.js';

/**
 * Stage 10 Part 4 extends /health so the dashboard's system panel has a real
 * source of truth. The original `status` and `database` fields are unchanged,
 * so existing consumers keep working.
 */
type ServiceState = 'up' | 'down';

type HealthResponse = {
  status: 'ok' | 'degraded';
  database: ServiceState;
  storage: ServiceState;
  api: ServiceState;
  uptimeSeconds: number;
};

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'database', 'storage', 'api', 'uptimeSeconds'],
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded'] },
    database: { type: 'string', enum: ['up', 'down'] },
    storage: { type: 'string', enum: ['up', 'down'] },
    api: { type: 'string', enum: ['up', 'down'] },
    uptimeSeconds: { type: 'integer' },
  },
} as const;

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Reply: HealthResponse }>(
    '/health',
    { schema: { response: { 200: responseSchema, 503: responseSchema } } },
    async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');

      const [database, storage] = await Promise.all([
        checkDatabase(fastify.prisma),
        checkStorage(),
      ]);

      const body: HealthResponse = {
        status: database.status === 'up' && storage.status === 'up' ? 'ok' : 'degraded',
        database: database.status,
        storage: storage.status,
        // Answering at all proves the API layer is alive.
        api: 'up',
        uptimeSeconds: Math.floor(process.uptime()),
      };

      // Only a dead database makes the service unavailable: unwritable storage
      // breaks uploads, but the site can still be read. Stay alive either way
      // so the next request retries the check.
      return reply.code(database.status === 'up' ? 200 : 503).send(body);
    },
  );
};

export default healthRoutes;
