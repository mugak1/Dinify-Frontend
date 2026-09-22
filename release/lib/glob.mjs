/**
 * The one glob dialect the release contract needs: Firebase Hosting `ignore`
 * patterns, applied to the certified file list to prove no certified file is
 * silently dropped from an upload.
 *
 * DELIBERATELY SMALL, AND IT REFUSES WHAT IT DOES NOT IMPLEMENT. Supported: `**` as
 * a whole segment (zero or more segments), `*` (any run of characters within one
 * segment), `?` (one character within a segment) and literal characters. Brace
 * expansion, character classes and extglobs are refused rather than approximated:
 * an ignore pattern this matcher misread would report a filtered asset as uploaded,
 * which is the one mistake it exists to prevent. The policy validator refuses an
 * unsupported pattern before it can reach here.
 *
 * Semantics follow the upload tool's (`glob` with `dot: true`, ignore patterns
 * always in dot mode): a leading `.` needs no special pattern. This is pinned
 * against firebase-tools' own `listFiles` by `release/tests/hosting-oracle.test.mjs`
 * rather than asserted from reading documentation.
 */

const UNSUPPORTED = /[[\]{}()!+@\\]/;

export function supportedIgnorePattern(pattern) {
  return typeof pattern === 'string'
    && pattern.length > 0
    && !UNSUPPORTED.test(pattern)
    && !pattern.startsWith('/')
    && !pattern.includes('//');
}

export function globToRegExp(pattern) {
  if (!supportedIgnorePattern(pattern)) {
    throw new TypeError(`unsupported ignore pattern ${JSON.stringify(pattern)}`);
  }
  const segments = pattern.split('/');
  let source = '^';
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '**') {
      source += last ? '.*' : '(?:[^/]+/)*';
      return;
    }
    source += segment
      .replace(/[.^$|+]/g, (c) => `\\${c}`)
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]');
    if (!last) source += '/';
  });
  return new RegExp(`${source}$`);
}

/** Split posix paths into those an upload with these ignores would keep and drop. */
export function partitionByIgnore(paths, patterns) {
  const matchers = patterns.map((p) => ({ pattern: p, re: globToRegExp(p) }));
  const kept = [];
  const dropped = [];
  for (const path of paths) {
    const hit = matchers.find((m) => m.re.test(path));
    if (hit) dropped.push({ path, pattern: hit.pattern });
    else kept.push(path);
  }
  return { kept, dropped };
}
