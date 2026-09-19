import type { Prisma, PrismaClient, UserRole } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../../utils/api-error.js';

export const publicUserSelect = {
  id: true, email: true, displayName: true, role: true,
} satisfies Prisma.UserSelect;
export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

export function toPublicUser(user: PublicUser): PublicUser {
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}
export function findUserForLogin(prisma: PrismaClient, email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: { ...publicUserSelect, passwordHash: true, isActive: true },
  });
}
export function findCurrentUser(prisma: PrismaClient, id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: { ...publicUserSelect, isActive: true },
  });
}

// ---------------------------------------------------------------------------
// Stage 10 Part 2: site visitors (RegularUser), authenticated with Google.
// Kept in this file so there is exactly one place that decides which columns of
// an account may ever leave the server.
// ---------------------------------------------------------------------------

export const siteUserSelect = {
  id: true, email: true, username: true, displayName: true,
  avatarUrl: true, role: true, usernameSetAt: true,
} satisfies Prisma.RegularUserSelect;
export type SiteUser = Prisma.RegularUserGetPayload<{ select: typeof siteUserSelect }>;

// Dates are serialized explicitly: the JSON response schema declares strings,
// and relying on Fastify's implicit Date coercion would silently drift.
export type PublicSiteUser = {
  id: string;
  email: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
  usernameSetAt: string | null;
};

export function toPublicSiteUser(user: SiteUser): PublicSiteUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    usernameSetAt: user.usernameSetAt === null ? null : user.usernameSetAt.toISOString(),
  };
}

export function findSiteUser(prisma: PrismaClient, id: string) {
  return prisma.regularUser.findUnique({ where: { id }, select: siteUserSelect });
}

// Narrowing helper for handlers that already ran `authenticateSiteUser`.
// It throws rather than returning null so a forgotten preHandler can never turn
// into an anonymous write.
export function requireSiteUser(request: FastifyRequest): SiteUser {
  const user = request.siteUser;
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'احراز هویت لازم است.');
  return user;
}
