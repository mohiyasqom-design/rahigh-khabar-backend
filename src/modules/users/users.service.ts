import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../../utils/api-error.js';
import { siteUserSelect, toPublicSiteUser } from './index.js';
import type { PublicSiteUser, SiteUser } from './index.js';
import type { UpdateProfileInput } from './users.schema.js';

export function getProfile(user: SiteUser): PublicSiteUser {
  return toPublicSiteUser(user);
}

export async function updateProfile(
  prisma: PrismaClient,
  user: SiteUser,
  input: UpdateProfileInput,
): Promise<PublicSiteUser> {
  // Enumerated assignment: never spread request input into a Prisma update.
  const data: Prisma.RegularUserUpdateInput = {};
  if (input.displayName !== undefined) data.displayName = input.displayName;
  if (input.username !== undefined) {
    // Write-once. The username is public attribution on every comment, so
    // allowing changes would silently rewrite history and enable impersonation.
    if (user.username !== null) {
      throw new ApiError(409, 'USERNAME_ALREADY_SET', 'نام کاربری قبلاً تنظیم شده و قابل تغییر نیست.');
    }
    data.username = input.username;
    // Only stamped together with the first username, never on a display-name edit.
    data.usernameSetAt = new Date();
  }
  if (Object.keys(data).length === 0) return toPublicSiteUser(user);

  try {
    const updated = await prisma.regularUser.update({
      where: { id: user.id }, data, select: siteUserSelect,
    });
    return toPublicSiteUser(updated);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // The availability check is advisory; the unique index is the real gate,
      // so a race between two onboarding tabs ends as a clean 409.
      if (error.code === 'P2002') {
        throw new ApiError(409, 'USERNAME_TAKEN', 'این نام کاربری قبلاً انتخاب شده است.');
      }
      if (error.code === 'P2025') {
        throw new ApiError(404, 'USER_NOT_FOUND', 'حساب کاربری پیدا نشد.');
      }
    }
    throw error;
  }
}

export async function isUsernameAvailable(prisma: PrismaClient, username: string): Promise<boolean> {
  const existing = await prisma.regularUser.findFirst({ where: { username }, select: { id: true } });
  return existing === null;
}
