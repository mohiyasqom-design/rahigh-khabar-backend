import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../../utils/api-error.js';
import { writeTransaction } from '../../utils/database.js';
import { pageResult } from '../../utils/validation.js';
import { inspectImage } from './media.image.js';
import type { MediaQuery } from './media.schema.js';
import type { MediaStorage } from './storage.js';
const mediaSelect = {
  id: true, url: true, altText: true, width: true, height: true,
  sizeBytes: true, mimeType: true, createdAt: true,
} satisfies Prisma.MediaSelect;
const missing = () => new ApiError(404, 'MEDIA_NOT_FOUND', 'رسانه پیدا نشد.');
export async function createMedia(prisma: PrismaClient, storage: MediaStorage,
  data: Buffer, reportedMime: string, altText: string | null) {
  const { extension, ...metadata } = inspectImage(data, reportedMime);
  const url = await storage.save(data, extension);
  try {
    return await prisma.media.create({ data: { url, altText, ...metadata }, select: mediaSelect });
  } catch (error) {
    await storage.remove(url);
    throw error;
  }
}
export async function listMedia(prisma: PrismaClient, query: MediaQuery) {
  const [items, total] = await prisma.$transaction([
    prisma.media.findMany({ select: mediaSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    prisma.media.count(),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  return pageResult(items, total, query.page, query.pageSize);
}
export async function deleteMedia(prisma: PrismaClient, storage: MediaStorage, id: string): Promise<void> {
  const current = await prisma.media.findUnique({ where: { id }, select: { url: true } });
  if (!current) throw missing();
  const pending = await storage.prepareRemoval(id, current.url);
  try {
    await writeTransaction(prisma, async (tx) => {
      const media = await tx.media.findUnique({
        where: { id }, select: { url: true, _count: { select: { news: true } } },
      });
      if (!media) throw missing();
      if (media.url !== current.url) throw new ApiError(409, 'MEDIA_CHANGED', 'رسانه هم‌زمان تغییر کرده است.');
      // Checked relation count intentionally does not block deletion. The existing
      // FK sets ALL cover references null, even when _count.news > 0.
      // No filesystem mutation inside this retryable transaction.
      await tx.media.delete({ where: { id } });
    });
  } catch (error) {
    // A connection error can leave commit outcome uncertain. Confirm database
    // state before discarding the durable intent. If lookup also fails, leave
    // the marker/lock in place for safe startup recovery rather than guessing.
    const remaining = await prisma.media.findUnique({ where: { id }, select: { id: true } });
    if (remaining) await pending.rollback(); else await pending.commit();
    throw error;
  }
  // A disk failure returns 500, never false success; startup recovers the marker.
  await pending.commit();
}
