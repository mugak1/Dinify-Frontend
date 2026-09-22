/**
 * Canonical serialisation and digests for the release contract.
 *
 * THE ONE RULE THIS FILE EXISTS FOR: two independently-written producers must be
 * able to compute the SAME digest for the same facts. The D01 ceiling contract is
 * exported by Python in Dinify-Backend and by this module in Dinify-Frontend, and
 * the cross-repository gate compares the two digests — so "canonical" has to mean
 * something both sides can implement identically, not "whatever JSON.stringify
 * happened to emit".
 *
 * Canonical form: keys sorted by code unit, no insignificant whitespace, integers
 * only where the contract says integers. That is expressible in Python's
 * `json.dumps(obj, sort_keys=True, separators=(',', ':'))` byte for byte, which is
 * the test the backend side carries.
 *
 * Pure: no clock, no filesystem, no network. Everything the callers need to vary is
 * an argument.
 */

import { createHash } from 'node:crypto';

/** Canonical JSON text for a plain data value. Objects sort their keys. */
export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key]);
  return out;
}

/** `sha256:<hex>` over UTF-8 bytes. The prefix is part of the value, deliberately:
 *  a bare hex string says nothing about which algorithm produced it, and a future
 *  algorithm change must be visible in every record that already exists. */
export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function digestOf(bytes) {
  return `sha256:${sha256Hex(bytes)}`;
}

/** Digest of a data value through its canonical form. */
export function digestOfValue(value) {
  return digestOf(Buffer.from(canonicalJson(value), 'utf8'));
}

/**
 * The digest of a FILE TREE, which is what an artifact actually is.
 *
 * `entries` is [{path, sha256}] — the caller hashes the bytes, this composes them.
 * The composition is order-independent by construction (the paths are sorted here,
 * not by the caller) and NUL-delimited so no path can spell another entry.
 *
 * WHY A TREE DIGEST AND NOT A DIGEST OF THE ARCHIVE: a tar or zip of the same files
 * differs by timestamp, ordering and compression level, so an archive digest would
 * change without the release changing and would make the gate noise rather than a
 * control. This digest changes when, and only when, a file's path or content does.
 *
 * It deliberately INCLUDES `release.json`: that file carries the release's identity
 * and must be covered, which is possible only because it does not contain this
 * digest. The digest lives outside the payload — see `release/README.md`.
 */
export function treeDigest(entries) {
  const seen = new Set();
  const lines = [];
  for (const entry of [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (typeof entry.path !== 'string' || entry.path.length === 0) {
      throw new TypeError('tree entry has no path');
    }
    if (!/^[0-9a-f]{64}$/.test(entry.sha256 ?? '')) {
      throw new TypeError(`tree entry ${entry.path} has no sha256`);
    }
    if (seen.has(entry.path)) throw new TypeError(`duplicate tree entry ${entry.path}`);
    seen.add(entry.path);
    // LENGTH-PREFIXED, so the encoding is injective whatever a path contains. A NUL
    // delimiter alone is not enough on its own terms: a path holding a NUL and a
    // newline can spell a second entry, and a digest whose input is ambiguous is not
    // a digest of the tree. `walkTree` refuses such a name long before this, which
    // makes the prefix defence in depth rather than the only barrier — but the claim
    // this function makes should be true of the function, not of its usual caller.
    lines.push(`${Buffer.byteLength(entry.path, 'utf8')}:${entry.path}\0${entry.sha256}\n`);
  }
  return digestOf(Buffer.from(lines.join(''), 'utf8'));
}

/**
 * The D01 ceiling contract digest.
 *
 * Computed over the VALUES, never over the file bytes: the two repositories format
 * and annotate their copies differently on purpose (the frontend copy carries `_source`
 * and `_note` for a human reader), and a byte digest would report that difference as a
 * contract drift. Keys beginning `_` are provenance notes and are excluded.
 */
export function contractDigest(contract) {
  const values = {};
  for (const [key, value] of Object.entries(contract ?? {})) {
    if (key.startsWith('_')) continue;
    if (!Number.isInteger(value)) {
      throw new TypeError(`D01 contract key ${key} is not an integer`);
    }
    values[key] = value;
  }
  if (Object.keys(values).length === 0) throw new TypeError('D01 contract is empty');
  return digestOfValue(values);
}
