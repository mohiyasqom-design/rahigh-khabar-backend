import type { CookieSerializeOptions } from '@fastify/cookie';
import { env, userCookieDomain } from '../../config/env.js';

export const AUTH_COOKIE_NAME = env.NODE_ENV === 'production' ? '__Host-rk_auth' : 'rk_auth';
export const authCookieOptions: CookieSerializeOptions = {
  httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/',
  // Host-only: no Domain. __Host- prevents production subdomain cookie injection.
};

// Stage 10 Part 2: site visitors (Google sign-in) get their own cookie so an
// admin session and a visitor session can never be confused for one another.
// The name is NOT __Host- prefixed because deployments may need a Domain to
// share the cookie between api.<domain> and <domain>.
//
// Group 3 decision: HOST-ONLY by default (Domain omitted) on api.rahighkhabar.ir.
// www.rahighkhabar.ir and api.rahighkhabar.ir share the registrable domain, so
// the browser treats www -> api fetches as SAME-SITE: a SameSite=Lax host-only
// cookie is sent with every `credentials: 'include'` call. Widening it to
// `.rahighkhabar.ir` would only expose the token to the Next.js server and any
// future subdomain without fixing anything. USER_COOKIE_DOMAIN still exists for
// an operator who needs it, but it is only honoured when it domain-matches both
// hosts (see userCookieDomain() in config/env.ts), because a mismatching Domain
// makes the browser drop the cookie silently.
export const USER_COOKIE_NAME = 'rk_user';
const visitorCookieDomain = userCookieDomain();
export const userCookieOptions: CookieSerializeOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  ...(visitorCookieDomain === undefined ? {} : { domain: visitorCookieDomain }),
};

/**
 * Every variant a visitor cookie may exist under (host-only and, when
 * configured, the shared domain). Logout clears all of them so a stale copy
 * from an earlier configuration can never shadow or outlive the session.
 */
export const userCookieClearVariants: CookieSerializeOptions[] = [
  { path: '/', secure: env.NODE_ENV === 'production', sameSite: 'lax', httpOnly: true },
  ...(visitorCookieDomain === undefined ? [] : [{ ...userCookieOptions }]),
];

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
