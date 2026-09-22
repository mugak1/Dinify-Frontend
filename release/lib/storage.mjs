/**
 * STORAGE COMPATIBILITY — what a build writes into a diner's browser, what it can
 * still read, and whether one build may replace another without stranding a checkout.
 *
 * WHY THIS IS A DECLARATION AND NOT A NUMBER (R2). The previous barrier compared
 * `(checkoutRecordVersion, semanticsRevision)` lexicographically, and only on the
 * explicit `rollback` path. Two things were wrong with that, both reproduced:
 *
 *  - A NUMBER IS NOT A CAPABILITY. "A numerically larger version" says nothing about
 *    whether that build can still read what the older one wrote — and in particular
 *    nothing about whether it preserves an OUTSTANDING ISSUED COMMAND, which is the
 *    one thing the checkout record exists to keep (same-key recovery). A larger
 *    number that dropped the old reader would have passed.
 *  - ONE PATH IS NOT EVERY PATH. An ordinary automatic deploy of a descendant commit —
 *    a revert, say — can lower what the served build writes just as surely as an
 *    explicit rollback can, and it went through unchecked.
 *
 * So a build DECLARES, in reviewed source, the exact `(version, semantics)` pairs it
 * writes and reads, and the gate requires — on every path that promotes anything —
 *
 *     baseline.reads ∪ {baseline.writes}  ⊆  candidate.reads
 *
 * as SET CONTAINMENT over declared pairs. Never numeric. A diner can hold any record
 * the served build wrote or would still accept; the incoming build must be able to
 * read all of them, or the promotion is refused.
 *
 * The declaration is NOT a theorem about the code. It is a reviewed claim, and two
 * things keep it honest: a digest TRIPWIRE over the source files that implement the
 * reader (stamp refuses a candidate whose declaration was not re-affirmed after they
 * changed), and a Karma spec that drives the real coordinator with a record of every
 * declared read pair and asserts it is recovered under the SAME key.
 *
 * AND WHERE THE BYTES ARE IS PART OF WHAT IS COMPATIBLE (Codex P2 on #687, reproduced).
 * A record a served build left is a STRING in the diner's browser, under a PHYSICAL key
 * (`[<root prefix>]<logical key>`), in the encoding the storage service wrote it in —
 * not the record object the pairs describe. Change the prefix, the key format or the
 * envelope and every stored record becomes invisible while the pairs are unchanged: the
 * reader sees nothing, and mints a FRESH idempotency key for a purchase whose command is
 * still outstanding. So the declaration states `physicalKey` and `encoding`, the
 * tripwire covers the serialization layer, the Karma spec seeds RAW bytes at that key
 * through the application's real root configuration, and the gate refuses a candidate
 * whose physical location differs from the served build's.
 *
 * Pure: no clock, no filesystem, no network.
 */

import { digestOfValue } from './canonical.mjs';

export const STORAGE_SCHEMA = 'dinify.storage.compatibility/1';

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_PATH_RE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._\/-]+$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPair = (p) => isObject(p)
  && Number.isInteger(p.version) && p.version >= 1
  && Number.isInteger(p.semantics) && p.semantics >= 1;
const pairKey = (p) => `${p.version}.${p.semantics}`;

function problem(problems, code, detail) {
  problems.push({ code, detail });
}

/** The declaration with provenance notes removed — what the digest is taken over. */
export function semanticDeclaration(declaration) {
  const out = {};
  for (const [key, value] of Object.entries(declaration ?? {})) {
    if (!key.startsWith('_')) out[key] = value;
  }
  return out;
}

/** `sha256:` over the canonical form of the declaration, notes excluded. */
export function declarationDigest(declaration) {
  return digestOfValue(semanticDeclaration(declaration));
}

/**
 * Validate a declaration's SHAPE. Returns `{ok, problems}` and never throws.
 *
 * A build must read what it writes — otherwise its own reload would strand the
 * diner's checkout — so `writes` must be one of `reads`.
 */
export function validateStorageDeclaration(declaration) {
  const problems = [];
  const d = declaration;
  if (!isObject(d)) {
    problem(problems, 'storage.declaration_not_an_object', typeof d);
    return { ok: false, problems };
  }
  if (d.schema !== STORAGE_SCHEMA) problem(problems, 'storage.declaration_wrong_schema', String(d.schema));
  if (typeof d.store !== 'string' || d.store.length === 0) problem(problems, 'storage.declaration_no_store', String(d.store));
  if (typeof d.key !== 'string' || d.key.length === 0) problem(problems, 'storage.declaration_no_key', String(d.key));
  if (typeof d.physicalKey !== 'string' || d.physicalKey.length === 0) {
    problem(problems, 'storage.declaration_no_physical_key', String(d.physicalKey));
  } else if (typeof d.key === 'string' && d.key.length > 0 && !d.physicalKey.includes(d.key)) {
    // The physical key is the logical one under the storage layer's prefix; one that
    // does not even name it means the two fields were edited apart.
    problem(problems, 'storage.declaration_physical_key_mismatch', `${d.physicalKey} does not name ${d.key}`);
  }
  if (typeof d.encoding !== 'string' || d.encoding.length === 0) problem(problems, 'storage.declaration_no_encoding', String(d.encoding));
  if (!isPair(d.writes)) problem(problems, 'storage.declaration_bad_writes', JSON.stringify(d.writes));
  if (!Array.isArray(d.reads) || d.reads.length === 0 || !d.reads.every(isPair)) {
    problem(problems, 'storage.declaration_bad_reads', JSON.stringify(d.reads));
  } else {
    const keys = d.reads.map(pairKey);
    if (new Set(keys).size !== keys.length) problem(problems, 'storage.declaration_duplicate_read', keys.join(','));
    if (isPair(d.writes) && !keys.includes(pairKey(d.writes))) {
      problem(problems, 'storage.declaration_writes_unread', `writes ${pairKey(d.writes)} is not among reads ${keys.join(',')}`);
    }
  }
  const sources = d.reviewedSources;
  if (!isObject(sources) || Object.keys(sources).length === 0) {
    problem(problems, 'storage.declaration_no_reviewed_sources', String(sources));
  } else {
    for (const [path, digest] of Object.entries(sources)) {
      if (!SAFE_PATH_RE.test(path)) problem(problems, 'storage.declaration_bad_source_path', path);
      if (!DIGEST_RE.test(String(digest))) problem(problems, 'storage.declaration_bad_source_digest', `${path}=${String(digest)}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * THE TRIPWIRE. `actual` maps each reviewed source path to the digest of its bytes
 * now. Any disagreement — a changed file, a missing file, a file the declaration no
 * longer names — means the declaration was not re-affirmed against the code that
 * implements it, and a stamp is refused rather than certifying a stale claim.
 */
export function staleReviewedSources(declaration, actual) {
  const stale = [];
  const declared = declaration?.reviewedSources ?? {};
  for (const [path, digest] of Object.entries(declared)) {
    if (actual[path] === undefined) stale.push(`${path}: missing`);
    else if (actual[path] !== digest) stale.push(`${path}: changed`);
  }
  return stale;
}

/**
 * The compatibility rule, as set containment. `candidate` and `baseline` are
 * declarations (or the `{writes, reads}` projection a manifest carries). Returns the
 * pairs the candidate cannot read; empty means compatible.
 */
export function unreadableByCandidate({ candidate, baseline }) {
  const readable = new Set((candidate?.reads ?? []).filter(isPair).map(pairKey));
  const required = new Map();
  for (const pair of [...(baseline?.reads ?? []), baseline?.writes]) {
    if (isPair(pair)) required.set(pairKey(pair), pair);
  }
  return [...required.keys()].filter((key) => !readable.has(key)).sort();
}

/** Where a side keeps its record: the fields that must agree for a candidate to find the served build's bytes. */
export const LOCATION_FIELDS = Object.freeze(['store', 'key', 'physicalKey', 'encoding']);

/**
 * The location fields on which `candidate` and `baseline` differ. A field one side does
 * not state at all counts as a difference: an unstated location cannot be shown to be
 * the same one.
 */
export function locationChanges({ candidate, baseline }) {
  return LOCATION_FIELDS.filter((field) => typeof candidate?.[field] !== 'string'
    || typeof baseline?.[field] !== 'string'
    || candidate[field] !== baseline[field]);
}

/** True when both sides carry something this rule can read at all. */
export function comparable(side) {
  return isObject(side) && isPair(side.writes) && Array.isArray(side.reads) && side.reads.length > 0 && side.reads.every(isPair);
}

/** The projection of a declaration a release manifest embeds. */
export function manifestStorage(declaration) {
  return {
    store: declaration.store,
    key: declaration.key,
    physicalKey: declaration.physicalKey,
    encoding: declaration.encoding,
    writes: { version: declaration.writes.version, semantics: declaration.writes.semantics },
    reads: declaration.reads.map((p) => ({ version: p.version, semantics: p.semantics })),
    declarationDigest: declarationDigest(declaration),
  };
}
