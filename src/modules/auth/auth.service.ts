import type { PrismaClient } from '@prisma/client';
import { findUserForLogin, toPublicUser } from '../users/index.js';
import type { PublicUser } from '../users/index.js';
import type { LoginInput } from './auth.schema.js';
import { getDummyHash, verifyPassword } from './password.js';

export async function validateCredentials(prisma: PrismaClient, input: LoginInput): Promise<PublicUser | null> {
  const user = await findUserForLogin(prisma, input.email);
  // Unknown/inactive accounts still pay for one password verification.
  const hash = user?.isActive ? user.passwordHash : await getDummyHash();
  const matches = await verifyPassword(hash, input.password);
  if (!user || !user.isActive || !matches) return null;
  return toPublicUser(user);
}
