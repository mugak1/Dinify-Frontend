/**
 * The image-compression worker loads its library from THIS origin.
 *
 * These specs use the real library, the real file the builder emits and a real
 * worker. The library falls back to the main thread whenever its worker cannot load
 * the script, and says nothing, so a broken asset still compresses: the only way to
 * tell the two apart is to watch where the work happened. The CONTROL points the
 * worker at a missing file and shows the same observations come out the other way,
 * so the positive case cannot pass by accident.
 *
 * NOTHING HERE MAY LOAD A SCRIPT FROM ANOTHER ORIGIN. A failed `expect` does not stop
 * the next line from running, so it cannot guard a load. Every URL a real worker or
 * the real library is about to load goes through `sameOriginOnly` first, which
 * THROWS; and every worker created in this file is wrapped so that the URL the
 * library actually sends in `postMessage` is checked again before the worker can
 * import it. The refusal spec uses an `.invalid` host (RFC 6761), which cannot
 * resolve, so even a broken guard could not reach anything.
 */
import imageCompression from 'browser-image-compression';
import { imageCompressionLibUrl } from './image-compression-lib-url';

const LOAD_TIMEOUT_MS = 10_000;
const COMPRESS_TIMEOUT_MS = 20_000;
const SPEC_TIMEOUT_MS = 30_000;

/** An off-origin URL that cannot resolve, for the refusal spec. */
const OFF_ORIGIN = 'https://cdn.example.invalid/npm/browser-image-compression@2.0.2/dist/browser-image-compression.js';

/** The options both consumers pass, with the URL under test. */
const options = (libURL: string) => ({
  maxSizeMB: 0.5,
  maxWidthOrHeight: 1280,
  useWebWorker: true,
  libURL,
  initialQuality: 0.85,
  fileType: 'image/jpeg',
});

/** Throws unless `url` is an absolute URL on this test page's origin. */
function sameOriginOnly(url: unknown): string {
  let parsed: URL;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new Error(`refusing to load a non-absolute URL: ${String(url)}`);
  }
  if (parsed.origin !== location.origin) {
    throw new Error(`refusing to load ${parsed.href}: not on this page's origin (${location.origin})`);
  }
  return parsed.href;
}

/** Rejects if `work` has not settled within `ms`. */
function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

/** Everything a spec started, so `afterEach` can stop it even when the spec failed. */
const live = {
  workers: new Set<Worker>(),
  objectUrls: new Set<string>(),
  undo: [] as Array<() => void>,
};

/** Workers created in this file and the replies they sent. */
const workerLog = { created: 0, replies: [] as string[] };

/**
 * Wraps `window.Worker` for the duration of a spec. Each worker's script URL and
 * every URL it is told to import must be on this origin, checked before the worker
 * exists and before the message is posted; and each worker is tracked for cleanup.
 */
function guardWorkers(): void {
  const Original = window.Worker;
  const Guarded = function (scriptUrl: string | URL, opts?: WorkerOptions) {
    const worker = new Original(sameOriginOnly(String(scriptUrl)), opts);
    workerLog.created++;
    live.workers.add(worker);
    const post = worker.postMessage.bind(worker) as (message: unknown, ...rest: unknown[]) => void;
    (worker as unknown as { postMessage: (message: unknown, ...rest: unknown[]) => void }).postMessage =
      (message, ...rest) => {
        // The library sends `{ imageCompressionLibUrl, file, options }`; the smoke
        // worker below is sent the URL itself. Either way the URL is checked here.
        if (typeof message === 'string') sameOriginOnly(message);
        else if (message && typeof message === 'object' && 'imageCompressionLibUrl' in message) {
          sameOriginOnly((message as { imageCompressionLibUrl: unknown }).imageCompressionLibUrl);
        }
        post(message, ...rest);
      };
    worker.addEventListener('message', (e: MessageEvent) =>
      workerLog.replies.push(e.data?.file ? 'file' : e.data?.error ? 'error' : 'other'),
    );
    return worker;
  } as unknown as typeof Worker;
  window.Worker = Guarded;
  live.undo.push(() => (window.Worker = Original));
}

/** Counts image work on the main thread from now on; the library's fallback ends here. */
function watchMainThread(): () => number {
  const calls = [
    spyOn(HTMLCanvasElement.prototype, 'toDataURL').and.callThrough(),
    spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callThrough(),
    spyOn(OffscreenCanvas.prototype, 'convertToBlob').and.callThrough(),
    spyOn(window, 'createImageBitmap').and.callThrough(),
  ];
  return () => calls.reduce((n, s) => n + s.calls.count(), 0);
}

/** A worker built the way the library builds one imports `url` and reports what it defines. */
async function importInWorker(url: string): Promise<string> {
  const target = sameOriginOnly(url);
  const source = 'self.onmessage=(e)=>{try{importScripts(e.data);' +
    "postMessage(typeof self.imageCompression+' '+self.imageCompression.version)}" +
    "catch(x){postMessage('failed: '+x.message)}}";
  const scriptUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  live.objectUrls.add(scriptUrl);
  let worker: Worker | undefined;
  try {
    worker = new Worker(scriptUrl);
    const started = worker;
    return await withTimeout(
      new Promise<string>((resolve, reject) => {
        started.onmessage = (e) => resolve(String(e.data));
        started.onerror = (e) => reject(new Error(`worker error: ${e.message}`));
        started.postMessage(target);
      }),
      LOAD_TIMEOUT_MS,
      `importing ${target} in a worker`,
    );
  } finally {
    if (worker) {
      worker.terminate();
      live.workers.delete(worker);
    }
    URL.revokeObjectURL(scriptUrl);
    live.objectUrls.delete(scriptUrl);
  }
}

/** The real library, with the consumers' options, after the URL is checked. */
async function compressInBrowser(input: File, libURL: string): Promise<Blob> {
  const target = sameOriginOnly(libURL);
  return withTimeout(imageCompression(input, options(target)), COMPRESS_TIMEOUT_MS, `compressing with ${target}`);
}

/** A 2400x1800 JPEG with a deterministic noise field, well above the 200 KiB skip. */
async function photo(): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 2400;
  canvas.height = 1800;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(canvas.width, canvas.height);
  let seed = 7;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const x = (i / 4) % canvas.width;
    img.data[i] = (x * 255) / canvas.width;
    img.data[i + 1] = seed & 0xff;
    img.data[i + 2] = (seed >> 8) & 0xff;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const blob = await withTimeout(
    new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the fixture did not encode'))), 'image/jpeg', 0.95),
    ),
    LOAD_TIMEOUT_MS,
    'encoding the fixture',
  );
  return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
}

async function longestSide(blob: Blob): Promise<number> {
  const bitmap = await createImageBitmap(blob);
  const side = Math.max(bitmap.width, bitmap.height);
  bitmap.close();
  return side;
}

describe('imageCompressionLibUrl — the worker library comes from this origin', () => {
  beforeEach(() => {
    workerLog.created = 0;
    workerLog.replies = [];
    guardWorkers();
  });

  afterEach(() => {
    // Every step runs even if an earlier one throws, and even when the spec failed.
    const errors: unknown[] = [];
    const attempt = (step: () => void) => {
      try {
        step();
      } catch (e) {
        errors.push(e);
      }
    };
    for (const worker of live.workers) attempt(() => worker.terminate());
    live.workers.clear();
    for (const url of live.objectUrls) attempt(() => URL.revokeObjectURL(url));
    live.objectUrls.clear();
    for (const undo of live.undo.splice(0).reverse()) attempt(undo);
    if (errors.length) throw errors[0];
  });

  it('CONTRACT: an absolute URL on this document\'s origin, under media/, never the CDN', () => {
    const url = new URL(imageCompressionLibUrl());
    expect(url.origin).toBe(location.origin);
    expect(url.pathname).toMatch(/\/media\/browser-image-compression(-[A-Z0-9]+)?\.js$/);
    expect(url.href).not.toContain('jsdelivr');
  });

  it('CONTRACT: a base that is given is the base it resolves against', () => {
    expect(imageCompressionLibUrl('https://portal.example.test/x/chunk.js'))
      .toMatch(/^https:\/\/portal\.example\.test\/x\/media\/browser-image-compression(-[A-Z0-9]+)?\.js$/);
  });

  it('GUARD: an off-origin URL is refused before any worker, message, import or compression', async () => {
    const input = await photo();
    const mainThreadCalls = watchMainThread();

    expect(() => sameOriginOnly(OFF_ORIGIN)).toThrowError(/not on this page's origin/);
    expect(() => sameOriginOnly('media/browser-image-compression.js')).toThrowError(/non-absolute/);
    await expectAsync(importInWorker(OFF_ORIGIN)).toBeRejectedWithError(/not on this page's origin/);
    await expectAsync(compressInBrowser(input, OFF_ORIGIN)).toBeRejectedWithError(/not on this page's origin/);
    expect(workerLog.created).withContext('no worker was created').toBe(0);
    expect(mainThreadCalls()).withContext('no compression started').toBe(0);

    // A worker refuses, at postMessage, a library message naming another origin.
    const scriptUrl = URL.createObjectURL(new Blob(['self.onmessage=()=>{}'], { type: 'text/javascript' }));
    live.objectUrls.add(scriptUrl);
    const worker = new Worker(scriptUrl);
    expect(() => worker.postMessage({ imageCompressionLibUrl: OFF_ORIGIN, file: input, options: {} }))
      .toThrowError(/not on this page's origin/);
    expect(() => worker.postMessage(OFF_ORIGIN)).toThrowError(/not on this page's origin/);
  }, SPEC_TIMEOUT_MS);

  it('REGRESSION: the emitted file is the library, and loads as a classic worker script', async () => {
    expect(await importInWorker(imageCompressionLibUrl())).toBe('function 2.0.2');
    expect(live.workers.size).withContext('the worker was terminated').toBe(0);
    expect(live.objectUrls.size).withContext('the object URL was revoked').toBe(0);
  }, SPEC_TIMEOUT_MS);

  it('REGRESSION: a real compression with the consumers\' options runs in the worker', async () => {
    const input = await photo();
    const mainThreadCalls = watchMainThread();

    const out = await compressInBrowser(input, imageCompressionLibUrl());

    expect(workerLog.replies).withContext('the worker returned the file').toContain('file');
    expect(workerLog.replies).not.toContain('error');
    expect(mainThreadCalls()).withContext('no image work on the main thread').toBe(0);
    expect(out.type).toBe('image/jpeg');
    expect(out.size).toBeLessThan(input.size);
    expect(await longestSide(out)).toBeLessThanOrEqual(1280);
  }, SPEC_TIMEOUT_MS);

  it('CONTROL: a library the worker cannot load is compressed on the main thread instead', async () => {
    const input = await photo();
    const mainThreadCalls = watchMainThread();
    const missing = new URL('browser-image-compression-ABSENT00.js', imageCompressionLibUrl()).href;

    const out = await compressInBrowser(input, missing);

    expect(workerLog.replies).toContain('error');
    expect(workerLog.replies).not.toContain('file');
    expect(mainThreadCalls()).toBeGreaterThan(0);
    expect(out.type).toBe('image/jpeg');
    expect(await longestSide(out)).toBeLessThanOrEqual(1280);
  }, SPEC_TIMEOUT_MS);
});
