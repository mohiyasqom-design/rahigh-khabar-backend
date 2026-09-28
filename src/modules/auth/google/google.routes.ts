import type { FastifyPluginAsync } from 'fastify';
import { env, isGoogleOAuthConfigured } from '../../../config/env.js';
import { ApiError } from '../../../utils/api-error.js';
import {
  OAUTH_STATE_COOKIE_NAME, oauthStateCookieOptions,
  USER_COOKIE_NAME, userCookieOptions,
} from '../auth.cookie.js';
import { completeGoogleAuth, isValidState, startGoogleAuth } from './google.service.js';

function failureCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    const name = (error as { name?: unknown }).name;
    if (typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code)) return code;
    if (typeof name === 'string') return name.slice(0, 60);
  }
  return 'UNKNOWN';
}

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
    // Single-use state: drop it before doing anything else. Cleared with the
    // same attributes it was set with, so the browser really replaces it.
    reply.clearCookie(OAUTH_STATE_COOKIE_NAME, {
      path: '/auth', httpOnly: true, sameSite: 'lax', secure: oauthStateCookieOptions.secure === true,
    });

    if (code.length === 0 || !isValidState(state, expected)) {
      // Group 3: this branch used to be silent, which made "Google said yes but
      // I am still logged out" impossible to diagnose from the Railway log.
      // Only booleans are logged: never the code or the state values.
      request.log.warn({
        hasCode: code.length > 0,
        hasStateParam: state.length > 0,
        hasStateCookie: expected.length > 0,
        providerError: typeof query.error === 'string' ? query.error.slice(0, 64) : undefined,
      }, 'google oauth callback rejected before token exchange');
      return reply.redirect(siteUrl('/?auth=failed'), 302);
    }

    try {
      const user = await completeGoogleAuth(app.prisma, code);
      // app.jwt is the real decorated instance; the previous (global as any).app
      // lookup was undefined at runtime and threw on every callback.
      const token = app.jwt.sign({ userId: user.id, kind: 'site' });
      // env.JWT_EXPIRES_IN is already normalised to seconds by config/env.ts.
      reply.setCookie(USER_COOKIE_NAME, token, { ...userCookieOptions, maxAge: env.JWT_EXPIRES_IN });
      request.log.info({
        userId: user.id,
        isNewUser: user.username === null,
        cookieDomain: userCookieOptions.domain ?? 'host-only',
      }, 'google oauth sign-in completed');
      // A brand new account has no username yet and must finish onboarding.
      return reply.redirect(siteUrl(user.username === null ? '/onboarding' : '/'), 302);
    } catch (error) {
      // Never leak provider errors into the query string of a user-facing page.
      // The global logger drops every error detail (see utils/logger.ts), so
      // the stage that failed is logged as a bare code: an ApiError code such
      // as GOOGLE_TOKEN_EXCHANGE_FAILED, a Prisma code such as P2002, or the
      // error class name. No message, token or profile data is ever logged.
      request.log.error({ err: error, failure: failureCode(error) }, 'google oauth callback failed');
      return reply.redirect(siteUrl('/?auth=failed'), 302);
    }
  });
};

export default googleAuthRoutes;
