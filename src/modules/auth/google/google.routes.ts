import type { FastifyPluginAsync } from 'fastify';
import { env, isGoogleOAuthConfigured } from '../../../config/env.js';
import {
  OAUTH_STATE_COOKIE_NAME, oauthStateCookieOptions,
  USER_COOKIE_NAME, userCookieOptions,
} from '../auth.cookie.js';
import { completeGoogleAuth, isValidState, startGoogleAuth } from './google.service.js';

function siteUrl(path: string): string {
  return new URL(path, env.PUBLIC_SITE_URL).toString();
}

export const googleAuthRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });

  app.get('/google', { config: { rateLimit: { max: 20, timeWindow: 60_000 } } }, async (_request, reply) => {
    // Feature flag, not a crash: the site still works without Google keys.
    if (!isGoogleOAuthConfigured()) {
      return reply.code(503).send({
        code: 'GOOGLE_OAUTH_DISABLED', message: 'ورود با گوگل در این سرور فعال نیست.',
      });
    }
    const { redirectUrl, state } = startGoogleAuth();
    reply.setCookie(OAUTH_STATE_COOKIE_NAME, state, oauthStateCookieOptions);
    return reply.redirect(redirectUrl, 302);
  });

  app.get('/google/callback', { config: { rateLimit: { max: 30, timeWindow: 60_000 } } }, async (request, reply) => {
    if (!isGoogleOAuthConfigured()) {
      return reply.code(503).send({
        code: 'GOOGLE_OAUTH_DISABLED', message: 'ورود با گوگل در این سرور فعال نیست.',
      });
    }
    const query = (typeof request.query === 'object' && request.query !== null
      ? request.query : {}) as Record<string, unknown>;
    const code = typeof query.code === 'string' ? query.code : '';
    const state = typeof query.state === 'string' ? query.state : '';
    const expected = request.cookies[OAUTH_STATE_COOKIE_NAME] ?? '';
    // Single-use state: drop it before doing anything else.
    reply.clearCookie(OAUTH_STATE_COOKIE_NAME, { path: '/auth' });

    if (code.length === 0 || !isValidState(state, expected)) {
      return reply.redirect(siteUrl('/?auth=failed'), 302);
    }

    try {
      const user = await completeGoogleAuth(app.prisma, code);
      // app.jwt is the real decorated instance; the previous (global as any).app
      // lookup was undefined at runtime and threw on every callback.
      const token = app.jwt.sign({ userId: user.id, kind: 'site' });
      // env.JWT_EXPIRES_IN is already normalised to seconds by config/env.ts.
      reply.setCookie(USER_COOKIE_NAME, token, { ...userCookieOptions, maxAge: env.JWT_EXPIRES_IN });
      // A brand new account has no username yet and must finish onboarding.
      return reply.redirect(siteUrl(user.username === null ? '/onboarding' : '/'), 302);
    } catch (error) {
      // Never leak provider errors into the query string of a user-facing page.
      request.log.error({ err: error }, 'google oauth callback failed');
      return reply.redirect(siteUrl('/?auth=failed'), 302);
    }
  });
};

export default googleAuthRoutes;
