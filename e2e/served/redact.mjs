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
 *     `X-Diner-Session: …`, `?c=…` on a diner URL;
 *   * the owner's username, which is a canonical MSISDN (`256XXXXXXXXX`).
 *
 * `redactText` replaces every match (and every exact value `lib.mask` was told
 * about) and is applied to everything the orchestrator echoes. `scanText` finds
 * matches WITHOUT returning their values, and the CLI fails closed on any: the
 * evidence file is uploaded only after `scan` exits 0.
 *
 *   node e2e/served/redact.mjs scan <file>     exit 0 clean, 1 token-shaped content, 2 unreadable
 *   node e2e/served/redact.mjs --self-test     plants one value of each class and requires each found
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { knownSecrets } from './lib.mjs';

/** Named patterns. Each is global; none can match a UUID, a SHA, an ISO time or a URL path. */
export const PATTERNS = Object.freeze([
  ['jwt', /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ['django-signed', /\.?[A-Za-z0-9_-]{20,}:[A-Za-z0-9_-]{4,}:[A-Za-z0-9_-]{20,}/g],
  ['bearer', /Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi],
  ['diner-header', /X-Diner-(?:Credential|Session)["']?\s*[:=,]\s*["']?[A-Za-z0-9._:-]{10,}/gi],
  ['credential-param', /[?&]c=[^&\s"'<>]{10,}/g],
  ['secret-field', /"(?:token|refresh|access|password|session_token|qr_credential|credential|otp)"\s*:\s*"[^"]{4,}"/gi],
  ['msisdn', /(?<![0-9])256[0-9]{9}(?![0-9])/g],
]);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replace every token-shaped string and every exact masked value. */
export function redactText(text, extra = []) {
  let out = String(text);
  for (const value of [...knownSecrets(), ...extra].sort((a, b) => b.length - a.length)) {
    if (value) out = out.replace(new RegExp(escape(value), 'g'), '***');
  }
  for (const [name, re] of PATTERNS) out = out.replace(re, `[redacted:${name}]`);
  return out;
}

/** Findings as `{pattern, offset}` — never the matched value itself. */
export function scanText(text, extra = []) {
  const findings = [];
  const s = String(text);
  for (const value of [...knownSecrets(), ...extra]) {
    if (!value) continue;
    let at = s.indexOf(value);
    while (at !== -1) { findings.push({ pattern: 'known-secret', offset: at }); at = s.indexOf(value, at + 1); }
  }
  for (const [name, re] of PATTERNS) {
    for (const m of s.matchAll(re)) findings.push({ pattern: name, offset: m.index });
  }
  return findings;
}

/** Plant one value of each class in otherwise clean text; every one must be found. */
export function selfTest() {
  const clean = JSON.stringify({
    restaurant: '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
    sha: '7cf5b459bef25c0c3ee5c6ff354c494b8db592a7',
    at: '2026-10-27T12:32:13.713550+00:00',
    url: 'https://dinify-prod.web.app/diner/basket/order-complete',
    check: 'the accepted order stores the amount the diner agreed to',
  });
  const problems = [];
  if (scanText(clean).length) problems.push('a clean sample was flagged');
  const planted = {
    jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ',
    'django-signed': '.eJwNzDEOgDAIBdCrdK4mKFi5ilc6SoPv_7vq6xYjZ-kbq6Nmj8_EUUs:1vDpFU:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ',
    bearer: 'Authorization: Bearer abcdefghij0123456789',
    'diner-header': '"X-Diner-Session": "abcdefghij0123456789"',
    'credential-param': 'https://dinify-prod.web.app/diner/h/x?c=abcdefghij0123456789',
    'secret-field': '{"refresh": "abcd1234"}',
    msisdn: 'owner 256700000901 signed in',
  };
  for (const [name, value] of Object.entries(planted)) {
    const found = scanText(`${clean}\n${value}\n`).map((f) => f.pattern);
    if (!found.includes(name)) problems.push(`a planted ${name} was not found`);
    if (scanText(redactText(`${clean}\n${value}\n`)).length) problems.push(`redacting a planted ${name} left it findable`);
  }
  const known = scanText(`${clean} s3cr3t-value-x`, ['s3cr3t-value-x']).map((f) => f.pattern);
  if (!known.includes('known-secret')) problems.push('an exact masked value was not found');
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [cmd, file] = process.argv.slice(2);
  if (cmd === '--self-test') {
    const problems = selfTest();
    for (const p of problems) console.error(`SELF-TEST FAILED: ${p}`);
    console.log(problems.length ? 'redaction self-test FAILED' : `redaction self-test passed (${PATTERNS.length} patterns + exact values)`);
    process.exit(problems.length ? 3 : 0);
  }
  if (cmd !== 'scan' || !file) { console.error('usage: redact.mjs scan <file> | --self-test'); process.exit(2); }
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { console.error(`UNREADABLE: ${e.code}`); process.exit(2); }
  const extra = (process.env.REDACT_EXTRA_VALUES || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const findings = scanText(text, extra);
  for (const f of findings) console.log(`FOUND ${f.pattern} at offset ${f.offset}`);
  console.log(findings.length
    ? `REFUSED: ${findings.length} token-shaped value(s) in ${file}; it must not be uploaded`
    : `clean: no token-shaped value in ${file}`);
  process.exit(findings.length ? 1 : 0);
}
