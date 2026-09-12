import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { ApiError } from './api-error.js';

export function prismaCode(error: unknown): string | undefined {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
}
export function rethrowDatabaseError(error: unknown): never {
  switch (prismaCode(error)) {
    case 'P2002': throw new ApiError(409, 'SLUG_CONFLICT', 'این نامک قبلاً استفاده شده است.');
    case 'P2003': throw new ApiError(400, 'INVALID_REFERENCE', 'دسته‌بندی، تصویر یا نویسنده دیگر موجود نیست.');
    case 'P2025': throw new ApiError(404, 'NOT_FOUND', 'رکورد پیدا نشد.');
    case 'P2034': throw new ApiError(409, 'CONCURRENT_MODIFICATION', 'داده هم‌زمان تغییر کرده است؛ دوباره تلاش کنید.');
    default: throw error;
  }
}
// Keep permission checks, relation validation, and writes in one serializable
// transaction. Retry serialization conflicts; never retry validation failures.
export async function writeTransaction<T>(prisma: PrismaClient, action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(action, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (prismaCode(error) === 'P2034' && attempt < 2) continue;
      rethrowDatabaseError(error);
    }
  }
  throw new ApiError(409, 'CONCURRENT_MODIFICATION', 'دوباره تلاش کنید.');
}
