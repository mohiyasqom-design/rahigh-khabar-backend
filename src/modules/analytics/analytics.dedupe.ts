/**
 * Group 3 — view de-duplication.
 *
 * One reader refreshing an article, or bouncing back and forth between two
 * articles, must count once per window, not once per page load. This is a
 * deliberately small in-process guard (the brief rules out a queue/Redis for
 * the current traffic):
 *
 *  - key = reader identity (signed-in user id, otherwise the daily visitor
 *    hash, which is never an IP) + the article id (or the path for non-article
 *    pages);
 *  - a key seen within `windowMs` is not counted again;
 *  - memory is HARD-BOUNDED: at most `maxEntries` keys. The Map keeps insertion
 *    order, so the oldest key is evicted first. A flood of fake identities can
 *    therefore only push out old keys (at worst causing a few extra counts),
 *    never grow the process heap. Expired keys are also swept lazily.
 *
 * Limits: the state is per process, so with N backend replicas a reader may be
 * counted up to N times per window, and a restart forgets the window. Both are
 * acceptable for a view counter and documented rather than hidden.
 */
export class ViewDeduper {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly windowMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when this key should be counted now (and records it). */
  shouldCount(key: string): boolean {
    const now = this.now();
    const last = this.seen.get(key);
    if (last !== undefined && now - last < this.windowMs) return false;

    // Re-insert so the Map order stays "oldest first".
    if (last !== undefined) this.seen.delete(key);
    this.seen.set(key, now);
    this.evict(now);
    return true;
  }

  get size(): number {
    return this.seen.size;
  }

  private evict(now: number): void {
    for (const [key, at] of this.seen) {
      const expired = now - at >= this.windowMs;
      if (!expired && this.seen.size <= this.maxEntries) break;
      this.seen.delete(key);
    }
  }
}
