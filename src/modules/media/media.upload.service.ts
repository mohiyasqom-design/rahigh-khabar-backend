import type { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { ApiError } from '../../utils/api-error.js';
import { inspectImage } from './media.image.js';
import type { MediaStorage } from './storage.js';

// Wider than this adds bytes no layout on the site can use.
const MAX_WIDTH = 1600;
const WEBP_QUALITY = 82;

export interface UploadedFile {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

export interface Uploader {
  staffId?: string | null;
  siteUserId?: string | null;
}

/**
 * Device upload pipeline: magic-byte validation -> orientation fix -> resize ->
 * WebP. The file extension and the browser-declared MIME type are never
 * trusted on their own.
 */
export async function uploadMediaFile(
  prisma: PrismaClient,
  storage: MediaStorage,
  file: UploadedFile,
  altText: string | null,
  uploader: Uploader,
) {
  // Throws 415 for anything that is not a real JPEG/PNG/WebP.
  inspectImage(file.buffer, file.mimetype);

  let optimised: Buffer;
  let width: number | null = null;
  let height: number | null = null;
  try {
    const result = await sharp(file.buffer, { failOn: 'error' })
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    optimised = result.data;
    width = result.info.width;
    height = result.info.height;
  } catch {
    throw new ApiError(415, 'IMAGE_PROCESSING_FAILED',
      'پردازش تصویر ناموفق بود. فایل دیگری را امتحان کنید.');
  }

  const url = await storage.save(optimised, 'webp');
  try {
    return await prisma.$transaction(async (tx) => {
      const media = await tx.media.create({
        data: {
          url, altText, width, height,
          sizeBytes: optimised.byteLength, mimeType: 'image/webp',
        },
        select: {
          id: true, url: true, altText: true, width: true, height: true,
          sizeBytes: true, mimeType: true, createdAt: true,
        },
      });
      await tx.mediaAsset.create({
        data: {
          mediaId: media.id,
          filename: file.filename.slice(0, 200),
          url,
          sizeBytes: optimised.byteLength,
          uploadedById: uploader.staffId ?? null,
          uploadedBySiteUserId: uploader.siteUserId ?? null,
        },
      });
      return { ...media, createdAt: media.createdAt.toISOString() };
    });
  } catch (error) {
    // Never leave an orphan file on disk when the database write fails.
    await storage.remove(url).catch(() => undefined);
    throw error;
  }
}
