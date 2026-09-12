import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { ApiError } from './api-error.js';

export function configureErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    if (error instanceof ZodError) {
      // Do not echo input values, unrecognized keys, or raw validation details.
      return reply.code(400).send({ code: 'INVALID_INPUT', message: 'ورودی نامعتبر است؛ قرارداد API را بررسی کنید.' });
    }
    const statusCode = typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500
      ? error.statusCode : 500;
    if (statusCode === 500) request.log.error('Request failed; sensitive error details omitted');
    if (statusCode === 429) {
      reply.header('Cache-Control', 'no-store');
      return reply.code(429).send({
        code: 'TOO_MANY_REQUESTS', message: 'تلاش‌های ورود بیش از حد مجاز است؛ بعداً دوباره تلاش کنید.',
      });
    }
    return reply.code(statusCode).send({ error: statusCode === 500 ? 'Internal Server Error' : 'Bad Request' });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not Found' }));
}
