import pino from 'pino';
import { env } from '../config/env.js';

export function createLogger() {
  return pino({
    level: env.NODE_ENV === 'test' ? 'silent' : 'info',
    base: { service: 'rahigh-khabar-backend' },
    redact: {
      paths: [
        'DATABASE_URL', 'databaseUrl', 'password', 'passwordHash', 'token', 'secret',
        'JWT_SECRET', 'jwt', 'accessToken', 'refreshToken',
        'authorization', 'cookie', 'headers.authorization', 'headers.cookie',
        'req.headers.authorization', 'req.headers.cookie',
        'res.headers["set-cookie"]', 'headers["set-cookie"]',
        '*.DATABASE_URL', '*.password', '*.passwordHash', '*.token', '*.secret',
        '*.JWT_SECRET', '*.jwt', 'body.password', 'body.passwordHash',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      // Never serialize headers, bodies, query strings or raw error messages.
      req(request: { id?: string; method?: string }) {
        return { id: request.id, method: request.method };
      },
      res(reply: { statusCode?: number }) { return { statusCode: reply.statusCode }; },
      err() { return { message: 'Error details omitted to protect sensitive information' }; },
    },
  });
}
