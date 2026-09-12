import type { CookieSerializeOptions } from '@fastify/cookie';
import { env } from '../../config/env.js';

export const AUTH_COOKIE_NAME = env.NODE_ENV === 'production' ? '__Host-rk_auth' : 'rk_auth';
export const authCookieOptions: CookieSerializeOptions = {
  httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/',
  // Host-only: no Domain. __Host- prevents production subdomain cookie injection.
};
