/**
 * REDACTION — what a served run may print or upload, and the scan that refuses
 * to upload anything else.
 *
 * Both repositories are public, so an Actions log is public and an artifact is
 * downloadable by anyone who can read the run. A served run handles four kinds
 * of credential, and each has a recognisable SHAPE:
 *
 *   * the operator's access and refresh tokens — JWTs, `eyJ…​.…​.…`;
 *   * a table's QR credential and a diner table session — Django-signed values,
 *     `.<payload>:<timestamp>:<signature>` (measured on the backend, 2026-10);
 *   * the same credentials in transit — `Bearer …`, `X-Diner-Credential: …`,
 *     `X-Diner-Session: …`, `?c=…` or `#c=…` on a diner URL, and any of them
 *     percent-encoded once or twice inside another URL (a `returnUrl`);
 *   * the owner's username, which is a canonical MSISDN (`256XXXXXXXXX`), and
 *     the same number as people write it (`0700 …`, `256 700 …`).
 *
 * `redactText` replaces every match (and every exact value `lib.mask` was told
 * about) and is applied to everything the orchestrator echoes. `redactValue`
 * does the same to every key and string INSIDE a JSON value, so the evidence
 * written from it is valid JSON by construction.
 *
 * THE SCAN IS INDEPENDENT OF REDACTION. Running the redaction patterns over
 * text the same patterns already cleaned can never find anything, so the scan
 * that decides whether the evidence is uploaded also takes the run's file of
 * SHA-256 hashes (`secretHashes`): one per secret value the run knew (the
 * credentials, every token, QR credential and table session, and the encoded
 * forms of each), with its length and never the value. Every window of the
 * evidence of one of those lengths is hashed and compared, in the file as
 * written, in each JSON string unescaped, and in each of those percent-decoded
 * once and twice. Windows, not pattern matches: a candidate set chosen by shape
 * would be a pattern list again, which is exactly what made the old scan blind.
 * The patterns still run as a second layer, for a token the run never learned.
 *
 *   node e2e/served/redact.mjs scan <file> --hashes <file>
 *       exit 0 clean, 1 a finding or evidence that is not JSON, 2 either file unreadable or malformed
 *   node e2e/served/redact.mjs --self-test     plants one value of each class and requires each found
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { knownSecrets } from './lib.mjs';

/** A separator as written, or percent-encoded once (`%3A`) or twice (`%253A`). */
const COLON = '(?::|%3[Aa]|%253[Aa])';

/**
 * Named patterns: `[name, regex, replacement?]`. Each regex is global; none can
 * match a UUID, a SHA, an ISO time or a URL path. A replacement keeps the JSON
 * around a value (`"token": "…"` stays a key and a string), so redacting
 * JSON-shaped text never makes it unparseable.
 */
export const PATTERNS = Object.freeze([
  // A JWT, or its header and payload alone (no signature, or one cut off).
  ['jwt', /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?/g],
  // `payload:timestamp:signature` with raw or percent-encoded separators and a
  // signature of ANY length (a detail cut at 300 characters can end inside it),
  // and a compressed signed payload (`.eJ…`) even with no separator at all.
  ['django-signed', new RegExp(
    `\\.?[A-Za-z0-9_-]{20,}${COLON}[A-Za-z0-9_-]{4,}${COLON}[A-Za-z0-9_-]*|\\.eJ[A-Za-z0-9_-]{16,}`, 'g')],
  ['bearer', /Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi],
  ['diner-header', /(X-Diner-(?:Credential|Session)["']?\s*[:=,]\s*["']?)[A-Za-z0-9._:%-]{10,}/gi,
    '$1[redacted:diner-header]'],
  // `?c=`, `&c=` and `#c=`, raw or encoded once or twice (a `returnUrl`).
  ['credential-param',
    /(?:[?&#]|%3[Ff]|%26|%23|%253[Ff]|%2526|%2523)c(?:=|%3[Dd]|%253[Dd])[^&\s"'<>]{10,}/g],
  ['secret-field',
    /("(?:token|refresh|access|password|session_token|qr_credential|credential|otp)"\s*:\s*")(?!\[redacted:[a-z-]+\]")(?:[^"\\]|\\.){4,}(")/gi,
    '$1[redacted:secret-field]$2'],
  ['msisdn', /(?<![0-9])256[0-9]{9}(?![0-9])/g],
  // A Ugandan mobile number as people write it: `0700…`, `0 700 …`, `0700 000
  // 901`, `256 700 …`, `+256 700 …`. Bounded by non-alphanumerics, so a run of
  // digits inside a hex SHA is never taken for one.
  ['ug-phone', /(?<![0-9A-Za-z])(?:\+?256[ -]?|0[ -]?)7(?:[ -]?[0-9]){8}(?![0-9A-Za-z])/g],
]);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replace every token-shaped string and every exact masked value. */
export function redactText(text, extra = []) {
  let out = String(text);
  for (const value of [...knownSecrets(), ...extra].sort((a, b) => b.length - a.length)) {
    if (value) out = out.replace(new RegExp(escape(value), 'g'), '***');
  }
  for (const [name, re, replacement] of PATTERNS) out = out.replace(re, replacement ?? `[redacted:${name}]`);
  return out;
}

/** The keys whose string value is a secret whatever it looks like: `secret-field`
 *  and `diner-header` above, applied by KEY once the text is parsed, because a
 *  value on its own has lost the `"key": "…"` context those patterns read. */
const SECRET_KEY = /^(?:token|refresh|access|password|session_token|qr_credential|credential|otp)$/i;
const DINER_HEADER_KEY = /^X-Diner-(?:Credential|Session)$/i;
const MARKER = /^\[redacted:[a-z-]+\]$/;

/**
 * `redactText` applied to every key and every string of a JSON value, and to
 * every number whose digits redact (a numeric MSISDN becomes the redaction
 * string), plus the two key-shaped rules. The result serialises to valid JSON
 * whatever was redacted.
 */
export function redactValue(value, extra = []) {
  if (typeof value === 'string') return redactText(value, extra);
  if (typeof value === 'number') {
    const s = String(value);
    const r = redactText(s, extra);
    return r === s ? value : r;
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, extra));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => {
      if (typeof v === 'string' && !MARKER.test(v)) {
        if (SECRET_KEY.test(k) && v.length >= 4) return [k, '[redacted:secret-field]'];
        if (DINER_HEADER_KEY.test(k) && v.length >= 10) return [k, '[redacted:diner-header]'];
      }
      return [redactText(k, extra), redactValue(v, extra)];
    }));
  }
  return value;
}

// ── the independent scan ─────────────────────────────────────────────────────

export const HASHES_SCHEMA = 'dinify.frontend.served-journeys.secret-hashes/1';
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/** The hash file's content: the SHA-256 and length of each value — never the value. */
export function secretHashes(values) {
  const byHash = new Map();
  for (const v of values) if (typeof v === 'string' && v.length >= 4) byHash.set(sha256(v), v.length);
  return {
    schema: HASHES_SCHEMA,
    hashes: [...byHash].map(([hash, length]) => ({ length, sha256: hash }))
      .sort((a, b) => a.length - b.length || a.sha256.localeCompare(b.sha256)),
  };
}

/** Parse a hash file into `Map<length, Set<sha256>>`, or throw: a malformed file is not "no secrets". */
export function readHashes(text) {
  const doc = JSON.parse(text);
  if (doc?.schema !== HASHES_SCHEMA || !Array.isArray(doc.hashes)) throw new Error('not a secret-hash file');
  const table = new Map();
  for (const h of doc.hashes) {
    if (!Number.isInteger(h?.length) || h.length < 4 || !/^[0-9a-f]{64}$/.test(h?.sha256 ?? '')) {
      throw new Error('a malformed hash entry');
    }
    if (!table.has(h.length)) table.set(h.length, new Set());
    table.get(h.length).add(h.sha256);
  }
  return table;
}

const percentDecode = (s) => s.replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

function stringsOf(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsOf(v, out);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.push(k); stringsOf(v, out); }
  }
  return out;
}

/**
 * Every text a secret could appear in: the file as written, its JSON strings
 * unescaped (a quote or a backslash in a value is written escaped), and each of
 * those percent-decoded once and twice.
 */
export function scanViews(text) {
  const base = [['file', String(text)]];
  try { base.push(['strings', stringsOf(JSON.parse(text)).join('\n')]); } catch { /* not JSON: the file view only */ }
  const views = [...base];
  for (const [name, s] of base) {
    const once = percentDecode(s);
    if (once !== s) views.push([`${name}, decoded once`, once]);
    const twice = percentDecode(once);
    if (twice !== once) views.push([`${name}, decoded twice`, twice]);
  }
  return views;
}

/** Every window of a known length whose hash is in the table, as `{pattern, view, offset}`. */
export function hashFindings(text, table) {
  const findings = [];
  for (const [view, s] of scanViews(text)) {
    for (const [length, hashes] of table) {
      for (let i = 0; i + length <= s.length; i += 1) {
        if (hashes.has(sha256(s.slice(i, i + length)))) findings.push({ pattern: 'known-secret-hash', view, offset: i });
      }
    }
  }
  return findings;
}

/**
 * Findings as `{pattern, offset}` — never the matched value itself. `table` is
 * a `readHashes` result; exact `extra` values are looked for in every view.
 */
export function scanText(text, extra = [], table = new Map()) {
  const findings = [];
  const s = String(text);
  const exact = [...knownSecrets(), ...extra].filter(Boolean);
  for (const [view, v] of scanViews(s)) {
    for (const value of exact) {
      let at = v.indexOf(value);
      while (at !== -1) { findings.push({ pattern: 'known-secret', view, offset: at }); at = v.indexOf(value, at + 1); }
    }
  }
  for (const [name, re] of PATTERNS) {
    for (const m of s.matchAll(re)) findings.push({ pattern: name, offset: m.index });
  }
  findings.push(...hashFindings(s, table));
  return findings;
}

/** Plant one value of each class in otherwise clean text; every one must be found. */
export function selfTest() {
  const clean = JSON.stringify({
    restaurant: '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
    sha: '7cf5b459bef25c0c3ee5c6ff354c494b8db592a7',
    // Digits inside a SHA that read like a phone number, and a date, a run id and a price.
    sha_with_digits: 'ab0700000901cd2567000009010000000000aaaa',
    at: '2026-10-27T12:32:13.713550+00:00',
    run_id: 39847908896,
    price: '35011.30',
    url: 'https://dinify-prod.web.app/diner/basket/order-complete',
    check: 'the accepted order stores the amount the diner agreed to',
  });
  const problems = [];
  if (scanText(clean).length) problems.push('a clean sample was flagged');
  if (redactText(clean) !== clean) problems.push('redacting a clean sample changed it');
  const SIGNED = '.eJwNzDEOgDAIBdCrdK4mKFi5ilc6SoPv_7vq6xYjZ-kbq6Nmj8_EUUs';
  const planted = [
    ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ'],
    ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIn0'],
    ['django-signed', `${SIGNED}:1vDpFU:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ`],
    ['django-signed', `${SIGNED}%3A1vDpFU%3Aabcdefghijklmnop`],
    ['django-signed', `${SIGNED}%253A1vDpFU%253Aabcdefghijklmnop`],
    ['django-signed', `${SIGNED}:1vDpFU:abc`],
    ['bearer', 'Authorization: Bearer abcdefghij0123456789'],
    ['diner-header', '"X-Diner-Session": "abcdefghij0123456789"'],
    ['credential-param', 'https://dinify-prod.web.app/diner/h/x?c=abcdefghij0123456789'],
    ['credential-param', 'https://dinify-prod.web.app/diner/h/x#c=abcdefghij0123456789'],
    ['credential-param', '/login?returnUrl=%2Fdiner%2Fh%2Fx%3Fc%3Dabcdefghij0123456789'],
    ['credential-param', '/login?next=%252Fdiner%253Fc%253Dabcdefghij0123456789'],
    ['secret-field', '{"refresh": "abcd1234"}'],
    ['msisdn', 'owner 256700000901 signed in'],
    ['ug-phone', 'call 0700000901 now'],
    ['ug-phone', 'call 0 700 000 901 now'],
    ['ug-phone', 'call 256 700 000 901 now'],
  ];
  for (const [name, value] of planted) {
    const found = scanText(`${clean}\n${value}\n`).map((f) => f.pattern);
    if (!found.includes(name)) problems.push(`a planted ${name} was not found: ${name === 'msisdn' || name === 'ug-phone' ? 'a phone number' : value.slice(0, 24)}`);
    if (scanText(redactText(`${clean}\n${value}\n`)).length) problems.push(`redacting a planted ${name} left it findable`);
  }
  const known = scanText(`${clean} s3cr3t-value-x`, ['s3cr3t-value-x']).map((f) => f.pattern);
  if (!known.includes('known-secret')) problems.push('an exact masked value was not found');
  // The independent scan: a secret with no token shape at all, found only by its hash.
  const secret = 'correct "horse" battery/staple';
  const table = readHashes(JSON.stringify(secretHashes([secret])));
  if (hashFindings(clean, table).length) problems.push('the hash scan flagged a clean sample');
  for (const [label, text] of [
    ['as written', `x ${secret} y`],
    ['inside a JSON string', JSON.stringify({ detail: `x ${secret} y` })],
    ['percent-encoded once', `?next=${encodeURIComponent(secret)}`],
    ['percent-encoded twice', `?next=${encodeURIComponent(encodeURIComponent(secret))}`],
  ]) {
    if (!hashFindings(text, table).length) problems.push(`the hash scan missed a known secret ${label}`);
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [cmd, file, flag, hashesFile] = process.argv.slice(2);
  if (cmd === '--self-test') {
    const problems = selfTest();
    for (const p of problems) console.error(`SELF-TEST FAILED: ${p}`);
    console.log(problems.length ? 'redaction self-test FAILED'
      : `redaction self-test passed (${PATTERNS.length} patterns, exact values and the hash scan)`);
    process.exit(problems.length ? 3 : 0);
  }
  if (cmd !== 'scan' || !file || flag !== '--hashes' || !hashesFile) {
    console.error('usage: redact.mjs scan <file> --hashes <file> | --self-test');
    process.exit(2);
  }
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { console.error(`UNREADABLE: ${e.code}`); process.exit(2); }
  let table;
  try { table = readHashes(readFileSync(hashesFile, 'utf8')); } catch (e) {
    console.error(`UNREADABLE HASH FILE: ${e.code || e.message}`);
    process.exit(2);
  }
  let json = true;
  try { JSON.parse(text); } catch { json = false; }
  const extra = (process.env.REDACT_EXTRA_VALUES || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const findings = scanText(text, extra, table);
  for (const f of findings) console.log(`FOUND ${f.pattern}${f.view ? ` in ${f.view}` : ''} at offset ${f.offset}`);
  if (!json) console.log(`REFUSED: ${file} is not valid JSON; redaction must leave it parseable`);
  console.log(findings.length
    ? `REFUSED: ${findings.length} finding(s) in ${file}; it must not be uploaded`
    : `clean: no token-shaped value and none of ${[...table.values()].reduce((n, s) => n + s.size, 0)} known secret hash(es) in ${file}`);
  process.exit(findings.length || !json ? 1 : 0);
}
