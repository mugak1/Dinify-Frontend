import { ImagePreloader } from './image-preloader';

/**
 * Patches the global `Image` constructor so each constructed instance fires
 * `onload` (or `onerror`) after a configurable delay once `src` is assigned.
 * Returns a teardown hook plus accessors for tracking which URLs were
 * requested and how many lived in-flight at the peak.
 */
function installFakeImage(opts: {
  delayMs?: number;
  failUrls?: Set<string>;
} = {}) {
  const original = (globalThis as any).Image;
  const delayMs = opts.delayMs ?? 0;
  const failUrls = opts.failUrls ?? new Set<string>();

  const requested: string[] = [];
  let inFlight = 0;
  let peakInFlight = 0;

  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private _src = '';
    set src(value: string) {
      this._src = value;
      requested.push(value);
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      setTimeout(() => {
        inFlight--;
        if (failUrls.has(value)) this.onerror?.();
        else this.onload?.();
      }, delayMs);
    }
    get src(): string {
      return this._src;
    }
  }
  (globalThis as any).Image = FakeImage;

  return {
    requested,
    getPeakInFlight: () => peakInFlight,
    restore: () => {
      (globalThis as any).Image = original;
    },
  };
}

describe('ImagePreloader', () => {
  it('preloads every supplied URL exactly once', async () => {
    const fake = installFakeImage({ delayMs: 0 });
    try {
      const preloader = new ImagePreloader();
      await preloader.preload(['a', 'b', 'c'], { concurrency: 2 });
      expect(fake.requested.sort()).toEqual(['a', 'b', 'c']);
      ['a', 'b', 'c'].forEach(url => expect(preloader.isPreloaded(url)).toBe(true));
    } finally {
      fake.restore();
    }
  });

  it('respects the concurrency cap', async () => {
    const fake = installFakeImage({ delayMs: 5 });
    try {
      const preloader = new ImagePreloader();
      await preloader.preload(['a', 'b', 'c', 'd', 'e', 'f'], { concurrency: 2 });
      expect(fake.getPeakInFlight()).toBeLessThanOrEqual(2);
    } finally {
      fake.restore();
    }
  });

  it('dedupes URLs across calls so the same image is fetched once', async () => {
    const fake = installFakeImage({ delayMs: 0 });
    try {
      const preloader = new ImagePreloader();
      await preloader.preload(['a', 'b'], { concurrency: 2 });
      await preloader.preload(['a', 'b', 'c'], { concurrency: 2 });
      expect(fake.requested.sort()).toEqual(['a', 'b', 'c']);
    } finally {
      fake.restore();
    }
  });

  it('dedupes duplicates within a single call', async () => {
    const fake = installFakeImage({ delayMs: 0 });
    try {
      const preloader = new ImagePreloader();
      await preloader.preload(['a', 'a', 'a'], { concurrency: 2 });
      expect(fake.requested).toEqual(['a']);
    } finally {
      fake.restore();
    }
  });

  it('resolves on the timeout when loads are slow, without cancelling them', async () => {
    const fake = installFakeImage({ delayMs: 50 });
    try {
      const preloader = new ImagePreloader();
      const start = Date.now();
      await preloader.preload(['a', 'b'], { concurrency: 2, timeoutMs: 5 });
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(40);
      expect(fake.requested.sort()).toEqual(['a', 'b']);
    } finally {
      fake.restore();
    }
  });

  it('treats image errors as completion so a broken URL never blocks', async () => {
    const fake = installFakeImage({ delayMs: 0, failUrls: new Set(['bad']) });
    try {
      const preloader = new ImagePreloader();
      await preloader.preload(['good', 'bad'], { concurrency: 2 });
      expect(preloader.isPreloaded('good')).toBe(true);
      expect(preloader.isPreloaded('bad')).toBe(true);
    } finally {
      fake.restore();
    }
  });

  it('preloadBackground returns immediately and still loads the URLs', async () => {
    const fake = installFakeImage({ delayMs: 10 });
    try {
      const preloader = new ImagePreloader();
      preloader.preloadBackground(['a', 'b'], 2);
      // Returned synchronously — but the loads happen on the microtask/timer queue
      await new Promise(r => setTimeout(r, 30));
      expect(fake.requested.sort()).toEqual(['a', 'b']);
    } finally {
      fake.restore();
    }
  });

  it('skips empty/falsy URLs', async () => {
    const fake = installFakeImage({ delayMs: 0 });
    try {
      const preloader = new ImagePreloader();
      await preloader.preload(['', 'a', null as any, undefined as any], { concurrency: 2 });
      expect(fake.requested).toEqual(['a']);
    } finally {
      fake.restore();
    }
  });

  it('prioritize() loads URLs with no background pass running', async () => {
    const fake = installFakeImage({ delayMs: 0 });
    try {
      const preloader = new ImagePreloader();
      preloader.prioritize(['x', 'y']);
      await new Promise(r => setTimeout(r, 20));
      expect(fake.requested.sort()).toEqual(['x', 'y']);
      expect(preloader.isPreloaded('x')).toBe(true);
      expect(preloader.isPreloaded('y')).toBe(true);
    } finally {
      fake.restore();
    }
  });

  it('prioritize() does not re-request URLs already in flight from preloadBackground', async () => {
    const fake = installFakeImage({ delayMs: 30 });
    try {
      const preloader = new ImagePreloader();
      preloader.preloadBackground(['a', 'b', 'c'], 3);
      // Let the background lanes start their loads.
      await new Promise(r => setTimeout(r, 0));
      preloader.prioritize(['a', 'd']);
      await new Promise(r => setTimeout(r, 60));
      const counts = fake.requested.reduce<Record<string, number>>((acc, u) => {
        acc[u] = (acc[u] ?? 0) + 1;
        return acc;
      }, {});
      expect(counts['a']).toBe(1);
      expect(counts['d']).toBe(1);
    } finally {
      fake.restore();
    }
  });

  it('prioritize() runs alongside a saturated background pass', async () => {
    const fake = installFakeImage({ delayMs: 30 });
    try {
      const preloader = new ImagePreloader();
      // Concurrency 1 → 'a' starts loading, 'b' sits in the background queue.
      preloader.preloadBackground(['a', 'b'], 1);
      await new Promise(r => setTimeout(r, 0));
      preloader.prioritize(['p']);
      // The priority lane is dedicated, so 'p' starts immediately rather
      // than waiting for 'a' to finish — verify it is requested before
      // 'a' has had time to complete.
      await new Promise(r => setTimeout(r, 5));
      expect(fake.requested).toContain('p');
      expect(fake.requested).not.toContain('b');
    } finally {
      fake.restore();
    }
  });

  it('prioritize() dedupes repeated calls', async () => {
    const fake = installFakeImage({ delayMs: 5 });
    try {
      const preloader = new ImagePreloader();
      preloader.prioritize(['a', 'b']);
      preloader.prioritize(['a', 'b']);
      await new Promise(r => setTimeout(r, 30));
      expect(fake.requested.sort()).toEqual(['a', 'b']);
    } finally {
      fake.restore();
    }
  });

  it('prioritize() respects its lane cap', async () => {
    const fake = installFakeImage({ delayMs: 20 });
    try {
      const preloader = new ImagePreloader();
      preloader.prioritize(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
      await new Promise(r => setTimeout(r, 5));
      expect(fake.getPeakInFlight()).toBeLessThanOrEqual(4);
      await new Promise(r => setTimeout(r, 60));
      expect(fake.requested.sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    } finally {
      fake.restore();
    }
  });

  it('prioritize() skips already-preloaded URLs', async () => {
    const fake = installFakeImage({ delayMs: 0 });
    try {
      const preloader = new ImagePreloader();
      await preloader.preload(['a'], { concurrency: 1 });
      const before = fake.requested.length;
      preloader.prioritize(['a', 'b']);
      await new Promise(r => setTimeout(r, 20));
      expect(fake.requested.slice(before).sort()).toEqual(['b']);
    } finally {
      fake.restore();
    }
  });
});
