import type { Prisma, PrismaClient } from '@prisma/client';

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
