/**
 * PEERS — which backend and admin revisions this frontend may be released beside,
 * what each of them actually publishes, and what is known about what is SERVING.
 *
 * WHAT WAS WRONG (R1, reproduced on 3386724). The compatible set was a set of
 * LITERALS typed into release/policy.json: a backend commit nothing read, capability
 * integers nobody derived, and a D01 digest the gate compared against itself. Deleting
 * the backend commit, replacing it with "not-a-sha", or naming a foreign repository all
 * PROCEEDED. A mismatch could be produced only by editing the literal — which checks
 * the literal, not the backend.
 *
 * WHAT REPLACES IT. Two kinds of evidence, kept apart because they answer different
 * questions and fail differently:
 *
 *   SELECTION  "is revision X of that peer one this candidate is compatible with?"
 *              Answered by a PEER RECEIPT: a JSON record PRODUCED FROM GIT at the exact
 *              revision (this module's `produceReceipt`), committed under release/peers/,
 *              and pinned by digest in the policy's approved set. The contract values
 *              and capability levels in it are READ FROM THE PEER'S OWN EXPORT FILES at
 *              that revision — never typed.
 *   SERVING    "which revision of that peer is live right now?"
 *              Answered, where a peer publishes one, by a public identity read at
 *              decision time and re-read at the promotion boundary. Where a peer
 *              publishes none — the backend, until B3 — the answer is UNVERIFIED and the
 *              gate refuses by that name. Nothing here manufactures it.
 *
 * THE LIMIT, STATED. A receipt proves what a revision's SOURCE says. It does not prove
 * that revision is deployed, and the frontend gate is the only path that consults it:
 * the backend's own deploy and the legacy deploy-prod.yml make no compatibility
 * decision at all. Cross-repository changes therefore remain an ORDERED, MANUAL
 * sequence; this makes an uncertified pairing machine-refusable on this path, and
 * nothing more.
 *
 * Pure except where marked: `produceReceipt` takes an injected `git` function.
 */

import { contractDigest, digestOfValue } from './canonical.mjs';

export const RECEIPT_SCHEMA = 'dinify.release.peer-receipt/1';
export const PEER_NAMES = Object.freeze(['backend', 'admin']);

const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * THE SOURCES A RECEIPT READS, per peer. Paths are the peer's own committed exports.
 * The backend's two files are produced from the constants the backend enforces and
 * the wire emits (`manage.py export_checkout_limits_contract` /
 * `export_published_capabilities`), and each is asserted against those constants
 * unconditionally in the backend's own suite. The admin receipt binds identity only —
 * the frontend holds no protocol contract with the Admin portal, and inventing one
 * here would be an Admin protocol framework nobody asked for.
 */
export const PEER_SOURCES = Object.freeze({
  backend: Object.freeze({
    d01CheckoutLimits: 'orders_app/contracts/checkout_limits.contract.json',
    publishedCapabilities: 'orders_app/contracts/published_capabilities.contract.json',
  }),
  admin: Object.freeze({
    // The file that defines how Admin publishes its served identity (release.txt).
    // Bound by blob so the serving observation's mechanism is tied to the revision.
    deployWorkflow: '.github/workflows/deploy.yml',
  }),
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const withoutNotes = (v) => Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('_')));

function problem(problems, code, detail) {
  problems.push({ code, detail });
}

// ── producing a receipt ─────────────────────────────────────────────────────────

/**
 * Build a receipt from git objects at EXACTLY `commit`. `git(args)` runs git in the
 * peer's clone and returns stdout (throwing on failure). Deterministic: no clock, no
 * host, no path of the clone — the same revision always yields the same bytes, which
 * is what lets a reviewer re-derive a committed receipt and compare digests.
 */
export function produceReceipt({ peer, repository, commit, git }) {
  if (!PEER_NAMES.includes(peer)) throw new Error(`unknown peer ${JSON.stringify(peer)}`);
  if (!REPO_RE.test(String(repository))) throw new Error(`repository must be owner/name, got ${JSON.stringify(repository)}`);
  if (!SHA_RE.test(String(commit))) throw new Error('commit must be a full 40-character lowercase SHA');
  let resolved = '';
  try {
    resolved = git(['rev-parse', '--verify', '--quiet', `${commit}^{commit}`]).trim();
  } catch {
    // `--verify --quiet` exits non-zero for an unknown revision; that is this answer.
  }
  if (resolved !== commit) throw new Error(`the clone does not hold commit ${commit}`);
  const tree = git(['rev-parse', `${commit}^{tree}`]).trim();

  const blobOf = (path) => {
    const line = git(['ls-tree', commit, '--', path]).trim();
    if (!line) return null;
    const [meta] = line.split('\t');
    const [, type, blob] = meta.split(' ');
    if (type !== 'blob') throw new Error(`${path} at ${commit} is a ${type}, not a file`);
    return blob;
  };
  const readJson = (blob, path) => {
    try {
      return JSON.parse(git(['cat-file', 'blob', blob]));
    } catch (error) {
      throw new Error(`${path} at ${commit} is not readable JSON: ${error.message}`);
    }
  };

  const sources = [];
  const receipt = {
    schema: RECEIPT_SCHEMA,
    peer,
    repository,
    commit,
    tree,
    sources,
    contracts: {},
    publishes: null,
    unavailable: [],
    producer: { tool: 'release/cli.mjs peer-receipt', revision: 1 },
  };

  for (const [name, path] of Object.entries(PEER_SOURCES[peer])) {
    const blob = blobOf(path);
    sources.push({ name, path, blob });
    if (blob === null) {
      receipt.unavailable.push(name);
      continue;
    }
    if (peer !== 'backend') continue;
    const data = readJson(blob, path);
    if (!isObject(data)) throw new Error(`${path} at ${commit} is not a JSON object`);
    const values = withoutNotes(data);
    if (name === 'd01CheckoutLimits') {
      receipt.contracts.d01CheckoutLimits = { values, digest: contractDigest(values) };
    } else if (name === 'publishedCapabilities') {
      for (const [key, level] of Object.entries(values)) {
        if (!Number.isInteger(level) || level < 0) throw new Error(`${path} at ${commit}: ${key} is not a non-negative integer`);
      }
      receipt.publishes = values;
    }
  }
  receipt.unavailable.sort();
  return receipt;
}

/** The digest the policy pins. Over the whole receipt, canonically. */
export function receiptDigest(receipt) {
  return digestOfValue(receipt);
}

// ── validating a receipt ────────────────────────────────────────────────────────

/**
 * Is this receipt readable, about the expected peer, repository and revision, and
 * internally consistent? Every failure is named; nothing throws.
 */
export function validateReceipt(receipt, { peer, repository, commit }) {
  const problems = [];
  const r = receipt;
  if (!isObject(r) || r.schema !== RECEIPT_SCHEMA) {
    problem(problems, 'peers.receipt_unreadable', isObject(r) ? `schema ${String(r.schema)}` : typeof r);
    return { ok: false, problems };
  }
  if (r.peer !== peer || r.repository !== repository) {
    problem(problems, 'peers.receipt_foreign', `${String(r.peer)}@${String(r.repository)} is not ${peer}@${repository}`);
  }
  if (r.commit !== commit) {
    problem(problems, 'peers.receipt_wrong_revision', `${String(r.commit)} != ${commit}`);
  }
  if (!SHA_RE.test(String(r.tree))) problem(problems, 'peers.receipt_unreadable', `tree ${String(r.tree)}`);
  if (!Array.isArray(r.sources) || !Array.isArray(r.unavailable) || !isObject(r.contracts)) {
    problem(problems, 'peers.receipt_unreadable', 'sources / unavailable / contracts malformed');
    return { ok: problems.length === 0, problems };
  }
  const expectedSources = PEER_SOURCES[peer] ?? {};
  for (const [name, path] of Object.entries(expectedSources)) {
    const entry = r.sources.find((s) => s?.name === name);
    if (!entry || entry.path !== path || !(entry.blob === null || SHA_RE.test(String(entry.blob)))) {
      problem(problems, 'peers.receipt_unreadable', `source ${name} missing or malformed`);
    } else if ((entry.blob === null) !== r.unavailable.includes(name)) {
      problem(problems, 'peers.receipt_inconsistent', `source ${name} availability disagrees with unavailable[]`);
    }
  }
  if (peer === 'backend') {
    const d01 = r.contracts.d01CheckoutLimits;
    if (d01 !== undefined) {
      let recomputed = null;
      try { recomputed = contractDigest(d01.values); } catch { /* reported below */ }
      if (!DIGEST_RE.test(String(d01?.digest)) || recomputed !== d01.digest) {
        problem(problems, 'peers.receipt_inconsistent', `d01CheckoutLimits digest ${String(d01?.digest)} is not its values' digest ${String(recomputed)}`);
      }
    } else if (!r.unavailable.includes('d01CheckoutLimits')) {
      problem(problems, 'peers.receipt_inconsistent', 'd01CheckoutLimits neither present nor declared unavailable');
    }
    if (r.publishes !== null) {
      if (!isObject(r.publishes) || !Object.values(r.publishes).every((v) => Number.isInteger(v) && v >= 0)) {
        problem(problems, 'peers.receipt_inconsistent', 'publishes is not a map of non-negative integers');
      }
    } else if (!r.unavailable.includes('publishedCapabilities')) {
      problem(problems, 'peers.receipt_inconsistent', 'publishes is null but publishedCapabilities is not declared unavailable');
    }
  }
  return { ok: problems.length === 0, problems };
}

// ── the decision's peer half ────────────────────────────────────────────────────

/**
 * Every reason the peers give to refuse this candidate. Empty means the peer half
 * has no objection.
 *
 * @param {object} input
 * @param {object} input.policy      the trusted, validated policy
 * @param {object} input.manifest    the candidate's inner manifest (validated)
 * @param {object} input.peers       adapter output:
 *   receipts:     {backend: [{commit, path, present, readable, receipt, digest}], admin: [...]}
 *   verification: {admin: {<commit>: {state: 'verified'|'mismatch'|'unavailable', detail}}}
 *   serving:      {backend: {...}, admin: {state: 'known'|'unreadable', commit, noStore, detail}}
 */
export function peerReasons({ policy, manifest, peers }) {
  const reasons = [];
  const refuse = (code, detail) => reasons.push({ code, detail });
  const set = policy.compatibleSet;
  const observed = peers ?? {};

  if (manifest.buildConfiguration !== set.frontendRequires.buildConfiguration) {
    refuse('peers.configuration_not_in_set', `${String(manifest.buildConfiguration)} != ${set.frontendRequires.buildConfiguration}`);
  }

  for (const name of PEER_NAMES) {
    const declared = set.peers[name];
    const entries = observed.receipts?.[name] ?? [];

    for (const approved of declared.approved) {
      const seen = entries.find((e) => e?.commit === approved.commit);
      if (!seen || seen.present !== true) {
        refuse('peers.receipt_missing', `${name} ${approved.commit}: no receipt at ${approved.receipt}`);
        continue;
      }
      if (seen.readable !== true) {
        refuse('peers.receipt_unreadable', `${name} ${approved.commit}: ${String(seen.detail ?? 'unreadable')}`);
        continue;
      }
      const check = validateReceipt(seen.receipt, { peer: name, repository: declared.repository, commit: approved.commit });
      for (const p of check.problems) refuse(p.code, `${name} ${approved.commit}: ${p.detail}`);
      if (!check.ok) continue;
      // The policy pins the receipt BY DIGEST, so an approval is an approval of THIS
      // evidence. A receipt edited without re-approving it is a different receipt.
      if (receiptDigest(seen.receipt) !== approved.receiptDigest) {
        refuse('peers.receipt_mismatch', `${name} ${approved.commit}: receipt digest ${receiptDigest(seen.receipt)} != approved ${approved.receiptDigest}`);
        continue;
      }
      // A public peer's receipt is re-derived from the peer's own public repository at
      // decision time; a private one cannot be, and says so in the policy.
      if (declared.receiptVerification === 'public-repository') {
        const v = observed.verification?.[name]?.[approved.commit];
        if (v?.state !== 'verified') {
          refuse(`peers.${name}_receipt_unverified`, `${approved.commit}: ${String(v?.state ?? 'not checked')} ${String(v?.detail ?? '')}`.trim());
        }
      }
      if (name === 'backend') reasons.push(...backendCompatibility(manifest, seen.receipt));
    }

    // SERVING — a separate question from selection, answered separately.
    const serving = declared.serving;
    if (serving.observation === 'unavailable') {
      refuse(`peers.${name}_serving_unverified`, serving.reason);
    } else if (serving.observation === 'public-identity') {
      const s = observed.serving?.[name];
      if (!s || s.state !== 'known') {
        refuse(`peers.${name}_serving_unreadable`, String(s?.detail ?? s?.state ?? 'not observed'));
      } else if (s.noStore !== true) {
        refuse(`peers.${name}_serving_cacheable`, String(s.cacheControl ?? 'no Cache-Control'));
      } else if (!declared.approved.some((a) => a.commit === s.commit)) {
        refuse(`peers.${name}_serving_unapproved`, `${name} serves ${String(s.commit)}, which is not in compatible set ${set.id}`);
      }
    }
  }
  return reasons;
}

/** The candidate against ONE approved backend receipt. Every approved backend must
 *  be compatible: while serving is unverifiable, any of them may be the live one. */
function backendCompatibility(manifest, receipt) {
  const reasons = [];
  const refuse = (code, detail) => reasons.push({ code, detail });
  const at = receipt.commit;
  const ours = manifest.compatibility?.contracts?.d01CheckoutLimits;
  const theirs = receipt.contracts?.d01CheckoutLimits?.digest;
  if (theirs === undefined) {
    refuse('peers.contract_unpublished', `backend ${at} publishes no D01 contract export`);
  } else if (ours !== theirs) {
    refuse('peers.contract_mismatch', `d01CheckoutLimits ${String(ours)} != backend ${at} ${theirs}`);
  }
  if (receipt.publishes === null) {
    // THE HONEST STATE for a backend revision that predates the capability export.
    // Its levels exist in its source, but nothing publishes them as a contract, and
    // reading Python constants out of a peer's source here would be a second opinion.
    refuse('peers.capabilities_unpublished', `backend ${at} has no published-capabilities export`);
    return reasons;
  }
  for (const [capability, needed] of Object.entries(manifest.compatibility?.clientExpects ?? {})) {
    const published = receipt.publishes[capability];
    if (!Number.isInteger(published)) {
      refuse('peers.capability_unknown', `${capability} not published by backend ${at}`);
    } else if (published < needed) {
      refuse('peers.capability_below_requirement', `${capability} ${published} < ${needed} at backend ${at}`);
    }
  }
  const policyVersion = receipt.publishes.quote_policy_version;
  const supported = manifest.compatibility?.clientSupports?.quote_policy_version;
  if (!Number.isInteger(policyVersion)) {
    refuse('peers.capability_unknown', `quote_policy_version not published by backend ${at}`);
  } else if (!Array.isArray(supported) || !supported.includes(policyVersion)) {
    refuse('peers.policy_version_unsupported', `backend ${at} publishes quote policy ${policyVersion}; client supports ${JSON.stringify(supported)}`);
  }
  return reasons;
}
