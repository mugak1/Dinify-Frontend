/**
 * Limited-concurrency image preloader with cross-call deduplication.
 *
 * Used by the diner menu to preload card thumbnails in two stages:
 *   1. A short, race-against-timeout `preload()` for the above-the-fold cards
 *      (featured carousel + first section). Resolves either when those loads
 *      finish or when the timeout fires — whichever comes first — so a slow
 *      CDN never blocks the menu reveal for the full timeout duration when
 *      the critical set is already cached.
 *   2. A fire-and-forget `preloadBackground()` for the remaining cards, kicked
 *      off after the menu reveals.
 *
 * Both stages share `done` / `inFlight` sets so the background pass never
 * re-requests an image the critical pass already started, and re-entry into
 * `preload()` (e.g. for a re-loaded menu) is cheap.
 */
export interface ImagePreloadOptions {
  /** Maximum images fetched in parallel. Clamped to >= 1. */
  concurrency: number;
  /**
   * If set, the returned promise resolves after this many ms even if some
   * images are still loading. Loads continue in the background and are
   * tracked, so a follow-up call will not re-request them.
   */
  timeoutMs?: number;
}

export class ImagePreloader {
  private readonly done = new Set<string>();
  private readonly inFlight = new Set<string>();

  /**
   * Preloads the supplied URLs with limited concurrency, resolving when all
   * loads complete (load or error) or when the timeout elapses. Skips URLs
   * already preloaded or in flight.
   */
  preload(urls: string[], opts: ImagePreloadOptions): Promise<void> {
    const queue = this.dedupe(urls);
    if (queue.length === 0) return Promise.resolve();
    const work = this.runWithConcurrency(queue, opts.concurrency);
    if (!opts.timeoutMs) return work;
    return Promise.race([
      work,
      new Promise<void>(resolve => setTimeout(resolve, opts.timeoutMs)),
    ]);
  }

  /**
   * Fire-and-forget background preload. Returns immediately; loads continue
   * with the given concurrency until the queue drains.
   */
  preloadBackground(urls: string[], concurrency: number): void {
    const queue = this.dedupe(urls);
    if (queue.length === 0) return;
    void this.runWithConcurrency(queue, concurrency);
  }

  /** Visible for tests. */
  isPreloaded(url: string): boolean {
    return this.done.has(url);
  }

  private dedupe(urls: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const url of urls) {
      if (!url || seen.has(url)) continue;
      if (this.done.has(url) || this.inFlight.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
    return out;
  }

  private runWithConcurrency(queue: string[], concurrency: number): Promise<void> {
    const lanes = Math.max(1, Math.min(concurrency, queue.length));
    const workers: Promise<void>[] = [];
    for (let i = 0; i < lanes; i++) {
      workers.push(this.worker(queue));
    }
    return Promise.all(workers).then(() => {});
  }

  private worker(queue: string[]): Promise<void> {
    return new Promise<void>(resolve => {
      const pump = (): void => {
        const url = queue.shift();
        if (!url) {
          resolve();
          return;
        }
        // Re-check inside the lane to handle concurrent preload() calls
        // that may have raced this URL into flight after we deduped.
        if (this.done.has(url) || this.inFlight.has(url)) {
          pump();
          return;
        }
        this.inFlight.add(url);
        const img = new Image();
        const finish = (): void => {
          this.inFlight.delete(url);
          this.done.add(url);
          pump();
        };
        img.onload = finish;
        img.onerror = finish;
        img.src = url;
      };
      pump();
    });
  }
}
