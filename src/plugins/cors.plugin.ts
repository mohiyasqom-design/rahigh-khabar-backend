import cors from '@fastify/cors';
import fp from 'fastify-plugin';
import { env } from '../config/env.js';

export default fp(async (fastify) => {
  await fastify.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    strictPreflight: true,
  });
}, { name: 'cors', fastify: '5.x' });
