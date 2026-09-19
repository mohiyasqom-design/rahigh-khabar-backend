import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../../../utils/api-error.js';
import { env, googleCallbackUrl, isGoogleOAuthConfigured } from '../../../config/env.js';
import { siteUserSelect } from '../../users/index.js';
import type { SiteUser } from '../../users/index.js';

const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const REQUEST_TIMEOUT_MS = 10_000;

type GoogleProfile = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
};

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (clientId === undefined || clientSecret === undefined) {
    throw new ApiError(503, 'GOOGLE_OAUTH_DISABLED', 'ورود با گوگل در این سرور فعال نیست.');
  }
  return { clientId, clientSecret };
}

/** Builds the authorize URL and the CSRF state the caller must store in a cookie. */
export function startGoogleAuth(): { redirectUrl: string; state: string } {
  const { clientId } = credentials();
  const state = randomBytes(32).toString('base64url');
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', googleCallbackUrl());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  return { redirectUrl: url.toString(), state };
}

/** Constant-time comparison so the state cookie cannot be brute forced. */
export function isValidState(received: string, expected: string): boolean {
  if (received.length === 0 || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

async function requestJson(url: string, init: RequestInit, failureCode: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new ApiError(502, failureCode, 'ارتباط با گوگل ناموفق بود؛ دوباره تلاش کنید.');
    }
    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, failureCode, 'ارتباط با گوگل ناموفق بود؛ دوباره تلاش کنید.');
  } finally {
    clearTimeout(timer);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}
function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function exchangeCodeForAccessToken(code: string): Promise<string> {
  const { clientId, clientSecret } = credentials();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: googleCallbackUrl(),
    grant_type: 'authorization_code',
  });
  const payload = asRecord(await requestJson(
    TOKEN_ENDPOINT,
    { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() },
    'GOOGLE_TOKEN_EXCHANGE_FAILED',
  ));
  const accessToken = asString(payload.access_token);
  if (accessToken === null) {
    throw new ApiError(502, 'GOOGLE_TOKEN_EXCHANGE_FAILED', 'پاسخ گوگل نامعتبر بود.');
  }
  return accessToken;
}

async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const payload = asRecord(await requestJson(
    USERINFO_ENDPOINT,
    { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } },
    'GOOGLE_PROFILE_FAILED',
  ));
  const sub = asString(payload.sub);
  const email = asString(payload.email);
  if (sub === null || email === null) {
    throw new ApiError(502, 'GOOGLE_PROFILE_FAILED', 'پروفایل گوگل ناقص بود.');
  }
  return {
    sub,
    email: email.toLowerCase(),
    emailVerified: payload.email_verified === true,
    name: asString(payload.name),
    picture: asString(payload.picture),
  };
}

function defaultDisplayName(profile: GoogleProfile): string {
  const fromName = profile.name?.trim() ?? '';
  if (fromName.length > 0) return fromName.slice(0, 50);
  const localPart = profile.email.split('@')[0] ?? '';
  return (localPart.length > 0 ? localPart : 'کاربر').slice(0, 50);
}

async function upsertGoogleUser(prisma: PrismaClient, profile: GoogleProfile): Promise<SiteUser> {
  const existing = await prisma.regularUser.findUnique({
    where: { googleId: profile.sub }, select: siteUserSelect,
  });
  if (existing) {
    // Refresh only Google-owned fields. displayName and username belong to the
    // user once onboarding has happened, so they are never overwritten here.
    const data: Prisma.RegularUserUpdateInput = {};
    if (existing.email !== profile.email) data.email = profile.email;
    if (profile.picture !== null && existing.avatarUrl !== profile.picture) data.avatarUrl = profile.picture;
    if (Object.keys(data).length === 0) return existing;
    return prisma.regularUser.update({ where: { id: existing.id }, data, select: siteUserSelect });
  }
  try {
    return await prisma.regularUser.create({
      data: {
        googleId: profile.sub,
        email: profile.email,
        // Deliberately null: the visitor picks a username during onboarding.
        // Writing '' here collided on the unique index for the second signup.
        username: null,
        displayName: defaultDisplayName(profile),
        avatarUrl: profile.picture,
      },
      select: siteUserSelect,
    });
  } catch (error) {
    // Two parallel callbacks for a brand new account: the loser re-reads.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await prisma.regularUser.findUnique({
        where: { googleId: profile.sub }, select: siteUserSelect,
      });
      if (raced) return raced;
    }
    throw error;
  }
}

export async function completeGoogleAuth(prisma: PrismaClient, code: string): Promise<SiteUser> {
  if (!isGoogleOAuthConfigured()) {
    throw new ApiError(503, 'GOOGLE_OAUTH_DISABLED', 'ورود با گوگل در این سرور فعال نیست.');
  }
  const accessToken = await exchangeCodeForAccessToken(code);
  const profile = await fetchGoogleProfile(accessToken);
  if (!profile.emailVerified) {
    throw new ApiError(403, 'GOOGLE_EMAIL_UNVERIFIED', 'ایمیل حساب گوگل شما تأیید نشده است.');
  }
  return upsertGoogleUser(prisma, profile);
}
