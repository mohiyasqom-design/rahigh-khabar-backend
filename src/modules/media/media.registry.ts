import type { MediaStorage } from './storage.js';

/**
 * Group 1 — a single shared handle to the media storage adapter.
 *
 * WHY: the storage adapter is built inside the (encapsulated) media plugin,
 * while deleting an article lives in the news module, which is registered as a
 * sibling plugin and therefore cannot see media-plugin decorations. Rather than
 * build a SECOND `LocalMediaStorage` (two instances would not share the
 * in-process removal lock), the media plugin publishes the instance it created
 * here and the news module reads it at request time.
 *
 * When nothing has been registered (unit tests that never boot the media
 * plugin), `getMediaStorage()` returns null and callers skip disk cleanup.
 */
let current: MediaStorage | null = null;

export function registerMediaStorage(storage: MediaStorage): void {
  current = storage;
}

export function getMediaStorage(): MediaStorage | null {
  return current;
}
