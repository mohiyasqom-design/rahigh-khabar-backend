import type { Prisma, PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { MediaStorage, PendingRemoval } from './storage.js';

/**
 * Group 1 — the relationship between an article and the files it owns.
 *
 * An article "owns" two kinds of upload:
 *   1. its cover image (`News.coverImageId -> Media`), and
 *   2. every image uploaded from inside the rich-text editor and embedded in
 *      its body (`MediaAsset.newsId`, linked by `linkInlineMedia` whenever the
 *      article is saved).
 *
 * Legacy articles saved before `MediaAsset.newsId` existed are still covered:
 * `collectNewsMedia` ALSO parses the stored body for our own `/uploads/` URLs.
 *
 * SHARED FILES ARE NEVER DELETED. A cover can be reused by several articles and
 * an image URL can be pasted into more than one body, so every candidate is
 * checked against the OTHER articles before it is removed.
 */

// Same shape as `storedFilenamePattern` in storage.ts (UUID v4 + extension),
// but unanchored so it can be found inside an HTML attribute value.
const uploadUrlPattern =
  /\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp))/g;

// A body is capped at 500k characters; this bounds the number of OR clauses.
const MAX_LINKED_FILES = 200;

/** Every distinct stored filename referenced by `/uploads/<uuid>.<ext>` in the HTML. */
export function extractUploadFilenames(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(uploadUrlPattern)) {
    if (match[1]) found.add(match[1]);
    if (found.size >= MAX_LINKED_FILES) break;
  }
  return [...found];
}

function urlEndsWithAny(filenames: string[]): Prisma.MediaWhereInput[] {
  return filenames.map((name) => ({ url: { endsWith: `/uploads/${name}` } }));
}

/**
 * Links the uploads embedded in `body` to the article. Called inside the same
 * transaction that writes the article, with the ALREADY SANITISED body.
 *
 * Only unclaimed assets (newsId = null) or assets already linked to this
 * article are touched, so saving article B with an image copied from article A
 * never steals A's ownership.
 */
export async function linkInlineMedia(tx: Prisma.TransactionClient, newsId: string, body: string): Promise<void> {
  const filenames = extractUploadFilenames(body);
  if (filenames.length === 0) return;
  await tx.mediaAsset.updateMany({
    where: {
      newsId: null,
      OR: filenames.map((name) => ({ url: { endsWith: `/uploads/${name}` } })),
    },
    data: { newsId },
  });
}

export interface OwnedMedia { id: string; url: string; }

/**
 * The media rows that belong ONLY to this article and can be removed with it.
 */
export async function collectNewsMedia(
  prisma: PrismaClient | Prisma.TransactionClient,
  news: { id: string; coverImageId: string | null; body: string },
): Promise<OwnedMedia[]> {
  const filenames = extractUploadFilenames(news.body);
  const orClauses: Prisma.MediaWhereInput[] = [{ asset: { newsId: news.id } }];
  if (news.coverImageId) orClauses.push({ id: news.coverImageId });
  if (filenames.length > 0) orClauses.push(...urlEndsWithAny(filenames));

  const candidates = await prisma.media.findMany({
    where: { OR: orClauses }, select: { id: true, url: true },
  });

  const owned: OwnedMedia[] = [];
  for (const media of candidates) {
    const name = media.url.slice(media.url.lastIndexOf('/') + 1);
    // Still the cover of, or embedded in, ANOTHER article -> keep it.
    const sharedCount = await prisma.news.count({
      where: {
        id: { not: news.id },
        OR: [{ coverImageId: media.id }, ...(name ? [{ body: { contains: `/uploads/${name}` } }] : [])],
      },
    });
    if (sharedCount === 0) owned.push(media);
  }
  return owned;
}

export interface PreparedRemoval { media: OwnedMedia; pending: PendingRemoval; }

/**
 * Reserves the files for deletion (durable intent marker, same mechanism as
 * `deleteMedia`). A file that cannot be reserved — unmanaged URL, already busy —
 * is logged and skipped; it must not block deleting the article itself.
 */
export async function prepareNewsMediaRemoval(
  storage: MediaStorage | null, media: OwnedMedia[], log: FastifyBaseLogger,
): Promise<PreparedRemoval[]> {
  if (!storage) return [];
  const prepared: PreparedRemoval[] = [];
  for (const item of media) {
    try {
      prepared.push({ media: item, pending: await storage.prepareRemoval(item.id, item.url) });
    } catch (error) {
      log.warn({ err: error, mediaId: item.id }, 'news delete: media file could not be reserved for removal; skipped');
    }
  }
  return prepared;
}

/**
 * Finalises removal after the database commit. A file that is already gone
 * from disk is not an error (`unlinkIfPresent` ignores ENOENT); any other disk
 * failure is logged — the article is already deleted and the startup recovery
 * pass will retry the marker.
 */
export async function commitNewsMediaRemoval(prepared: PreparedRemoval[], log: FastifyBaseLogger): Promise<void> {
  for (const { media, pending } of prepared) {
    try { await pending.commit(); } catch (error) {
      log.error({ err: error, mediaId: media.id }, 'news delete: media file removal failed after commit');
    }
  }
}

export async function rollbackNewsMediaRemoval(prepared: PreparedRemoval[], log: FastifyBaseLogger): Promise<void> {
  for (const { media, pending } of prepared) {
    try { await pending.rollback(); } catch (error) {
      log.error({ err: error, mediaId: media.id }, 'news delete: media removal rollback failed');
    }
  }
}
