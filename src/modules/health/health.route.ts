import type { FastifyPluginAsync } from 'fastify';

type HealthResponse = {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
};

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'database'],
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded'] },
    database: { type: 'string', enum: ['up', 'down'] },
  },
} as const;

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Reply: HealthResponse }>(
    '/health',
    { schema: { response: { 200: responseSchema, 503: responseSchema } } },
    async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        await fastify.prisma.$queryRaw`SELECT 1`;
        return reply.code(200).send({ status: 'ok', database: 'up' });
      } catch {
        // Stay alive; subsequent health requests retry the database.
        return reply.code(503).send({ status: 'degraded', database: 'down' });
      }
    },
  );
};

export default healthRoutes;
