import { PrismaClient } from '@prisma/client';
import fp from 'fastify-plugin';
import { env } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export class DatabaseStartupError extends Error {
  constructor() {
    super('Database connection failed. Check DATABASE_URL, credentials and PostgreSQL availability.');
    this.name = 'DatabaseStartupError';
  }
}

export default fp(
  async (fastify) => {
    const databaseUrl = new URL(env.DATABASE_URL);
    // Bound connection/pool/query waits, including after a database outage.
    databaseUrl.searchParams.set('connect_timeout', '5');
    databaseUrl.searchParams.set('pool_timeout', '5');
    databaseUrl.searchParams.set('socket_timeout', '5');
    const prisma = new PrismaClient({
      datasourceUrl: databaseUrl.toString(),
      log: [],
    });

    fastify.decorate('prisma', prisma);
    fastify.addHook('onClose', async () => {
      await prisma.$disconnect();
    });

    // Startup DB failure intentionally terminates the process (fail-fast).
    // /health reports only post-startup outages with HTTP 503, without crashing.
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      await prisma.$disconnect().catch(() => undefined);
      // Do not propagate raw Prisma errors or their connection details.
      throw new DatabaseStartupError();
    }
  },
  { name: 'prisma', fastify: '5.x' },
);
