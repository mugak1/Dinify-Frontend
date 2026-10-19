/**
 * WHERE THE IMAGE-COMPRESSION WORKER LOADS ITS LIBRARY FROM: THIS ORIGIN.
 *
 * browser-image-compression runs in a `blob:` worker that `importScripts` its own
 * UMD build from `options.libURL`, and with no `libURL` it fetches that build from
 * cdn.jsdelivr.net. When the fetch fails (offline, blocked, a script policy that
 * does not list the CDN) it falls back to compressing on the main thread and says
 * nothing, so the upload still works and the page stalls while it does.
 *
 * The `file` loader makes the application builder emit the lock-installed
 * `dist/browser-image-compression.js` VERBATIM as a content-hashed file under
 * `media/`, and makes this import its path. The hash follows the bytes, so a lock
 * bump changes the URL and the year-long immutable cache firebase.json gives every
 * `.js` cannot serve a stale copy.
 *
 * TypeScript resolves the specifier to the library's own declaration file and so
 * types the import as the compression function. The loader makes it a string: a
 * path relative to the chunk that contains this import.
 */
import libraryFile from 'browser-image-compression/dist/browser-image-compression.js' with { loader: 'file' };

const LIBRARY_PATH = libraryFile as unknown as string;

/**
 * The library's absolute URL on this origin. It has to be absolute: the worker is
 * created from a `blob:` URL, which cannot be a base for a relative one.
 *
 * It is resolved against the document's base, not `import.meta.url`. The builder
 * emits every chunk at the output root that `<base href>` names, so the two agree
 * in the shipped app; the Karma runner serves chunks under `/base/` and `media/` at
 * the root, so only the document's base is right in both.
 */
export function imageCompressionLibUrl(baseUri: string = document.baseURI): string {
  return new URL(LIBRARY_PATH, baseUri).href;
}
