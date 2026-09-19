import type { CookieSerializeOptions } from '@fastify/cookie';
import { env } from '../../config/env.js';

export const AUTH_COOKIE_NAME = env.NODE_ENV === 'production' ? '__Host-rk_auth' : 'rk_auth';
export const authCookieOptions: CookieSerializeOptions = {
  httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/',
  // Host-only: no Domain. __Host- prevents production subdomain cookie injection.
};

// Stage 10 Part 2: site visitors (Google sign-in) get their own cookie so an
// admin session and a visitor session can never be confused for one another.
// The name is NOT __Host- prefixed because deployments may need a Domain to
// share the cookie between api.<domain> and <domain>.
export const USER_COOKIE_NAME = 'rk_user';
export const userCookieOptions: CookieSerializeOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  // Only sent when an operator configured it; host-only otherwise.
  ...(env.USER_COOKIE_DOMAIN === undefined ? {} : { domain: env.USER_COOKIE_DOMAIN }),
};

// Short-lived CSRF state for the OAuth round trip. Scoped to /auth so it is not
// attached to every API request, and expires on its own if the user abandons.
export const OAUTH_STATE_COOKIE_NAME = 'rk_oauth_state';
export const oauthStateCookieOptions: CookieSerializeOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/auth',
  maxAge: 600,
};
