import { Injectable } from '@angular/core';

/**
 * Centralised preload queue for diner-menu card images.
 *
 * The diner menu fires `request(url)` once per item image when the menu
 * payload arrives, so all URLs enter a single FIFO queue throttled to a
 * fixed concurrency (matching the browser's per-origin HTTP limit). When a
 * category pill is tapped, the menu component calls `prioritize(urls)` to
 * promote that section's first images to the front of the queue, so they
 * paint from cache by the time the smooth-scroll lands.
 *
 * Deduplicated by URL: repeated `request()` calls for the same URL share a
 * single Promise, and once completed the URL short-circuits to a resolved
 * promise on every subsequent call. URLs already in flight cannot have
 * their browser priority changed; `prioritize()` only reorders pending
 * entries.
 */
@Injectable({ providedIn: 'root' })
export class MenuImagePreloadService {
  private readonly MAX_CONCURRENT = 6;

  private readonly completed = new Set<string>();
  private readonly inflight = new Set<string>();
  private readonly promises = new Map<string, Promise<void>>();
  private readonly resolvers = new Map<string, () => void>();
  private queue: string[] = [];

  /**
   * Queues `url` for preload. Returns a promise that resolves once the
   * image has finished loading (success or error). Idempotent: repeated
   * calls for the same URL return the same promise; calls for an
   * already-completed URL resolve immediately.
   */
  request(url: string): Promise<void> {
    if (!url) return Promise.resolve();
    if (this.completed.has(url)) return Promise.resolve();
    const existing = this.promises.get(url);
    if (existing) return existing;
    const promise = this.createPromise(url);
    this.queue.push(url);
    this.pump();
    return promise;
  }

  /**
   * Promotes `urls` to the front of the pending queue, preserving the
   * given order (urls[0] ends up first). URLs not previously requested
   * are queued at the front; URLs already in flight or completed are
   * skipped — their priority can't be changed retroactively, so the menu
   * falls back to the per-image skeleton/fade for any that aren't ready
   * by the time the section is visible.
   */
  prioritize(urls: string[]): void {
    if (!urls?.length) return;
    for (let i = urls.length - 1; i >= 0; i--) {
      const url = urls[i];
      if (!url) continue;
      if (this.completed.has(url) || this.inflight.has(url)) continue;
      if (!this.promises.has(url)) {
        this.createPromise(url);
      } else {
        const idx = this.queue.indexOf(url);
        if (idx >= 0) this.queue.splice(idx, 1);
      }
      this.queue.unshift(url);
    }
    this.pump();
  }

  private createPromise(url: string): Promise<void> {
    const promise = new Promise<void>(resolve => {
      this.resolvers.set(url, resolve);
    });
    this.promises.set(url, promise);
    return promise;
  }

  private pump(): void {
    while (this.inflight.size < this.MAX_CONCURRENT && this.queue.length > 0) {
      const url = this.queue.shift()!;
      if (this.completed.has(url) || this.inflight.has(url)) continue;
      this.inflight.add(url);
      this.startLoad(url);
    }
  }

  private startLoad(url: string): void {
    const done = () => {
      this.inflight.delete(url);
      this.completed.add(url);
      const resolve = this.resolvers.get(url);
      this.resolvers.delete(url);
      this.promises.delete(url);
      resolve?.();
      this.pump();
    };
    const img = new Image();
    img.onload = done;
    img.onerror = done;
    img.src = url;
  }
}
