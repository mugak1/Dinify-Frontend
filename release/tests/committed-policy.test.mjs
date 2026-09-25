/**
 * THE COMMITTED POLICY, AS THE FIRST REAL RUN WILL MEET IT.
 *
 * Every other suite starts from `allowedPolicy()` — the committed file with three stated
 * differences — because a policy that refuses everything cannot demonstrate an allowed
 * case. This suite does the opposite: it runs the REAL `decide` command, which reads
 * release/policy.json from this checkout and nothing else, against an otherwise perfect
 * candidate, and pins the EXACT set of refusals the committed file produces. That set
 * is the list of what enabling this path still requires, and it must be the gate's own
 * output rather than a recollection.
 *
 * WHAT EACH INPUT IS, stated because they are not all the same kind of evidence:
 *
 *   policy        the committed file, read by the CLI itself                 REAL
 *   receipts      release/peers/*.json, read exactly as `peer-facts` reads   REAL
 *   hosting       the committed firebase.json + .firebaserc, resolved by
 *                 effectiveHosting() over the candidate's file list          REAL
 *   served        the committed firebase.json's `**` rewrite answering
 *                 /release.json for a build that carries none (deploy-prod.yml
 *                 does not stamp), read by the real `serve-state` adapter    DERIVED
 *   admin         receipt for 1993a08 (the Admin #29 merge) verified
 *                 2026-09-25 against a fresh clone, an independent Python
 *                 re-derivation and GitHub's contents API (tree 2efbbc9…,
 *                 deploy.yml blob 0e210bf…). SERVING 1993a08 is what the
 *                 frontend readiness run 36146235129 (job 108107989904)
 *                 logged on 3a16e84 — read from that job's log, NOT observed
 *                 from this environment. Superseded records: 3521ebd (tree
 *                 8a84439…, logged serving by run 36018365996 on c32f383)
 *                 and 38df037 (tree b75c951…, blob c1a5e7c…, served no-store
 *                 2026-09-22)                                                RECORDED
 *   legacy        whether deploy-prod.yml exists in THIS checkout            OBSERVED
 *   candidate     the fixture baseline's certification, artifact and source  FIXTURE
 *   dependencies  the fixture baseline's certification evidence, a PASSING
 *                 fresh assessment of it and the prepared toolchain (D08
 *                 B2.2) — held passing so that the refusal set is the OWNER
 *                 and PEER facts alone; a failing assessment is never a wait
 *                 and is proved so in readiness.test.mjs and the simulation  FIXTURE
 *
 * The frontend's live /release.json was NOT observed from the environment this suite
 * was written in — its egress policy refuses dinify-prod.web.app — which is why that
 * input is derived, and why the second test shows the refusal set is the same in kind
 * if the origin answers something unreadable instead.
 */

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { decide } from '../lib/decide.mjs';
import { effectiveHosting } from '../lib/hosting.mjs';
import { receiptDigest } from '../lib/peers.mjs';
import { contractDigest, digestOfValue } from '../lib/canonical.mjs';
import { AWAITING, classifyReadiness } from '../lib/readiness.mjs';
import { POLICY, baseline, clone } from './fixtures.mjs';
import { ROOT, cli, startOrigin, tempDir, writeDependencyInputs } from './harness.mjs';

const ADMIN = POLICY.compatibleSet.peers.admin.approved[0].commit;
const BACKEND = POLICY.compatibleSet.peers.backend.approved[0].commit;

// The backend revision this policy approved BEFORE the capability export existed
// (the #330 merge). Its receipt is retained under release/peers/ as history and is
// no longer approved; the negative controls below select it deliberately.
const HISTORICAL_BACKEND = '9448f55ed28c040b96bf747e27c9dd2c86884c5a';
const HISTORICAL_RECEIPT_PATH = `release/peers/backend-${HISTORICAL_BACKEND}.json`;

// The pair the PREVIOUS compatible set (2026-09-23-pilot-3) approved. Both receipts
// are retained under release/peers/ as history and are no longer approved; the
// before/after comparisons below select them deliberately, with every other fact
// held fixed, to show exactly what the 2026-09-24 refresh changes.
const PREVIOUS_SET_ID = '2026-09-23-pilot-3';
const PREVIOUS_BACKEND = '366b7e457cfffa700663fc10983b0420e8882313';
const PREVIOUS_ADMIN = '38df0373e235c3e2952ae1985333731327400b93';

// What the frontend readiness run 36018365996 (job 107696628651, on c32f383) logged
// about Admin: it served 3521ebd, and the previous set did not approve it. A RECORDED
// fact from that job's log, used as the serving input the replay below holds fixed.
const CI_OBSERVED_ADMIN = '3521ebd05e5623878d262152bde11734b9cbd4fc';
const CI_REFUSAL_36018365996 = [
  'peers.admin_serving_unapproved',
  'peers.backend_serving_unverified',
  'prerequisite.legacy_publisher_active',
  'prerequisite.legacy_publisher_present',
  'prerequisite.retention_unverified',
  'prerequisite.source_protection_unrecorded',
  'served.bootstrap_unauthorized',
];

// The set the 2026-09-24 refresh committed (2026-09-24-pilot-4): Admin 3521ebd beside
// backend a6b25a6. Its Admin approval was superseded on 2026-09-25; its backend is
// still the approved one. The 3521ebd receipt is retained under release/peers/ as
// history, and the replays below select it deliberately.
const SET_0924_ID = '2026-09-24-pilot-4';

// What the frontend readiness run 36146235129 (job 108107989904, on 3a16e84) logged:
// Admin served 1993a08 (the #29 merge), and the 2026-09-24 set did not approve it. A
// RECORDED fact from that job's log. The decision it printed digests to exactly the
// `decisionDigest` its readiness record carries, so the whole decision is pinned below,
// not only its reason codes.
const CI_OBSERVED_ADMIN_0925 = '1993a087b2f2a37cbce8cf97c5c55c55b804e8ca';
const CI_REFUSAL_36146235129 = [
  'peers.admin_serving_unapproved',
  'peers.backend_serving_unverified',
  'prerequisite.legacy_publisher_active',
  'prerequisite.legacy_publisher_present',
  'prerequisite.retention_unverified',
  'prerequisite.source_protection_unrecorded',
  'served.bootstrap_unauthorized',
];
const CI_DECISION_DIGEST_36146235129 = 'sha256:03c510552f611b767c18fd509149ed2205ee910d576c7282ee79a275c284aca3';

// The #28 merge. Admin deployed it at 11:40Z on 2026-09-25 and replaced it with 1993a08
// at 14:15Z. No frontend readiness run read the identity in that window, and it was
// never approved: an Admin rollback to it is refused like any other unapproved revision.
const DEPLOYED_NEVER_APPROVED_ADMIN = 'ad4a7f8f033076039c9c2712664105c78ce0baef';

const receiptPath = (peer, commit) => `release/peers/${peer}-${commit}.json`;
function committedReceiptEntry(peer, commit) {
  const path = receiptPath(peer, commit);
  const receipt = JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
  return { commit, path, present: true, readable: true, receipt, digest: receiptDigest(receipt) };
}

/** The committed policy and peer facts with the approved revision of each named peer
 *  replaced by a committed historical receipt. Serving and verification are held to
 *  what `recordedPeers` states unless overridden. */
function withApproved({ backend, admin, setId, adminServes } = {}) {
  const policy = clone(POLICY);
  const peers = recordedPeers(adminServes ? { adminServes } : {});
  if (setId) policy.compatibleSet.id = setId;
  for (const [name, commit] of Object.entries({ backend, admin })) {
    if (!commit) continue;
    const entry = committedReceiptEntry(name, commit);
    policy.compatibleSet.peers[name].approved = [{ commit, receipt: entry.path, receiptDigest: entry.digest }];
    peers.receipts[name] = [entry];
    if (name === 'admin') peers.verification.admin = { [commit]: { state: 'verified', detail: '' } };
  }
  return { policy, peers };
}

/** Receipts exactly as `peer-facts` assembles them from the committed files. */
function committedReceipts() {
  const out = {};
  for (const [name, declared] of Object.entries(POLICY.compatibleSet.peers)) {
    out[name] = declared.approved.map((a) => {
      const path = join(ROOT, a.receipt);
      if (!existsSync(path)) return { commit: a.commit, path: a.receipt, present: false };
      const receipt = JSON.parse(readFileSync(path, 'utf8'));
      return { commit: a.commit, path: a.receipt, present: true, readable: true, receipt, digest: receiptDigest(receipt) };
    });
  }
  return out;
}

function recordedPeers({ adminServes = ADMIN } = {}) {
  return {
    receipts: committedReceipts(),
    verification: { admin: { [ADMIN]: { state: 'verified', detail: '' } } },
    serving: { admin: { state: 'known', commit: adminServes, noStore: true, cacheControl: 'no-store' } },
  };
}

let origin;
let derivedServed;

before(async () => {
  // A published build as deploy-prod.yml produces it — no release.json — behind the
  // COMMITTED firebase.json, whose `**` rewrite answers every unknown path with the SPA.
  const site = tempDir('committed-site');
  writeFileSync(join(site, 'index.html'), '<!doctype html><html><body><app-root></app-root></body></html>\n');
  origin = await startOrigin({ name: 'site' });
  origin.serveSite(site, JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8')));
  const r = await cli(['serve-state', '--origin', origin.origin]);
  assert.equal(r.status, 0, r.stderr);
  derivedServed = JSON.parse(r.stdout);
});

after(async () => { await origin?.close(); });

/** The facts `git-facts` would report for the committed policy over the fixture candidate. */
function committedFacts(input) {
  return {
    source: input.source,
    hosting: effectiveHosting({
      firebaseJson: JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8')),
      firebaserc: JSON.parse(readFileSync(join(ROOT, '.firebaserc'), 'utf8')),
      policy: POLICY,
      files: input.artifact.files,
    }),
    // What git-facts reports for the committed bootstrap (servedBaseline null) and
    // eligibility (minimumSafeTarget null), and what it OBSERVES about the legacy file.
    baseline: { state: 'none' },
    eligibility: { relationToMinimum: 'not-applicable' },
    trusted: { ...input.trusted, legacyPublisherPresent: existsSync(join(ROOT, POLICY.prerequisites.singlePublisher.legacyWorkflow)) },
    policy: { revision: 'f'.repeat(40), digest: digestOfValue(POLICY), verifierTree: { release: 'e'.repeat(40), dependencyAudit: 'd'.repeat(40) } },
  };
}

async function decideCommitted({ served = derivedServed, peers = recordedPeers() } = {}) {
  const input = baseline();
  const dir = tempDir('committed-decide');
  const facts = committedFacts(input);
  const files = {
    request: input.request, certification: input.certification, observation: input.artifact,
    facts, served, peers,
  };
  for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(value));
  const args = ['decide', '--now', input.now, '--record-out', join(dir, 'record.json'), '--summary', join(dir, 'summary.md'), ...writeDependencyInputs(dir, input)];
  for (const name of Object.keys(files)) args.push(`--${name}`, join(dir, `${name}.json`));
  const r = await cli(args);
  return {
    status: r.status,
    decision: JSON.parse(r.stdout),
    summary: readFileSync(join(dir, 'summary.md'), 'utf8'),
    hostingProblems: facts.hosting.problems,
  };
}

const codesOf = (decision) => decision.reasons.map((r) => r.code).sort();

const PREREQUISITES = [
  'prerequisite.legacy_publisher_active',
  'prerequisite.legacy_publisher_present',
  'prerequisite.retention_unverified',
  'prerequisite.source_protection_unrecorded',
];

/**
 * The PURE decision over exactly the inputs `decideCommitted` hands the CLI, with the
 * policy as an argument — so a single fact (which backend receipt is approved) can be
 * varied while every other fact is held fixed. The CLI cannot do that by design: it
 * reads only the committed file. The first comparison test proves this function and
 * the CLI agree on the committed policy, so the comparison is not against a different
 * rule.
 */
function decidePure({ policy = POLICY, peers = recordedPeers(), served = derivedServed } = {}) {
  const input = baseline();
  const facts = committedFacts(input);
  return decide({
    policy, request: input.request, certification: input.certification, artifact: input.artifact,
    source: facts.source, hosting: facts.hosting, served, baseline: facts.baseline,
    eligibility: facts.eligibility, peers, trusted: facts.trusted, dependencies: input.dependencies, evaluation: input.evaluation,
    now: input.now,
  });
}

// The readiness classifier binds the bootstrap context to the policy's own identity
// URL; the derived served state came from a local stand-in, so its address is replaced
// by the one it stands in for (the same step the readiness block below takes).
const servedAtIdentity = () => ({ ...derivedServed, url: `${POLICY.hosting.identityOrigin}${POLICY.hosting.identityPath}` });
function classifyWith({ policy = POLICY, peers = recordedPeers(), decision, enablement = '' }) {
  const input = baseline();
  return classifyReadiness({
    policy, request: input.request, enablement, decision,
    facts: committedFacts(input), served: servedAtIdentity(), peers,
  });
}

/** The committed policy and peer facts with ONE change: the approved backend is the
 *  retained historical receipt, read from its committed file. */
function withHistoricalBackend() {
  const receipt = JSON.parse(readFileSync(join(ROOT, HISTORICAL_RECEIPT_PATH), 'utf8'));
  const policy = clone(POLICY);
  policy.compatibleSet.peers.backend.approved = [
    { commit: HISTORICAL_BACKEND, receipt: HISTORICAL_RECEIPT_PATH, receiptDigest: receiptDigest(receipt) },
  ];
  const peers = recordedPeers();
  peers.receipts.backend = [
    { commit: HISTORICAL_BACKEND, path: HISTORICAL_RECEIPT_PATH, present: true, readable: true, receipt, digest: receiptDigest(receipt) },
  ];
  return { policy, peers, receipt };
}

describe('the committed release/policy.json, run through the real decide command', () => {
  test('CONTRACT: the derived served state is what the committed rewrite produces — the SPA document, read as absent', () => {
    assert.equal(derivedServed.state, 'absent');
    assert.equal(derivedServed.status, 200, 'the rewrite answers 200 with HTML, not 404');
  });

  test('CONTRACT: an otherwise perfect candidate is refused, and EXACTLY for the outstanding owner and peer facts', async () => {
    const { status, decision, summary, hostingProblems } = await decideCommitted();
    assert.equal(status, 1, 'a refusal exits non-zero — the gate step goes red');
    assert.equal(decision.decision, 'REFUSE');
    assert.deepEqual(hostingProblems, [], 'the committed hosting pair raises nothing against a real file list');
    assert.deepEqual(codesOf(decision), [
      // SELECTION IS NOT SERVING. The approved backend (a6b25a6, the #338 merge)
      // publishes its capability export, so peers.capabilities_unpublished stays gone —
      // but which backend revision is LIVE is still unobservable until B3, and a
      // successful deployment log is not accepted in place of a serving identity.
      'peers.backend_serving_unverified',
      ...PREREQUISITES,
      'served.bootstrap_unauthorized',
    ].sort());
    const detail = (code) => decision.reasons.find((r) => r.code === code).detail;
    assert.match(detail('peers.backend_serving_unverified'), /no served-revision identity \(B3\)/);
    assert.match(detail('prerequisite.legacy_publisher_present'), /deploy-prod\.yml exists on the default branch/);

    // The operator reads the summary, not the JSON: the prerequisites are grouped under
    // a heading that says they are expected, and the legacy path is named as live.
    assert.match(summary, /### Publication decision: REFUSE/);
    assert.match(summary, /\*\*Owner prerequisites outstanding\. Until each is resolved in a reviewed change, this path refuses EVERY candidate/);
    assert.match(summary, /`\.github\/workflows\/deploy-prod\.yml`\s*\nstill builds and publishes every merge to `main` on its own/);
    assert.match(summary, /`FRONTEND_PUBLISH_ENABLED` alone would not make this one the only writer/);
  });

  test('CONTROL: if the origin answers something unreadable instead, only the served reason changes', async () => {
    const { decision } = await decideCommitted({ served: { state: 'unreadable', detail: 'CONNECT refused' } });
    assert.deepEqual(codesOf(decision), [
      'peers.backend_serving_unverified',
      ...PREREQUISITES,
      'served.unreadable',
    ].sort());
  });

  test('CONTRACT: the next Admin promotion adds a refusal until a receipt for it is approved — coordination stays manual and ordered', async () => {
    const { decision } = await decideCommitted({ peers: recordedPeers({ adminServes: '0'.repeat(40) }) });
    const reasons = decision.reasons.filter((r) => r.code.startsWith('peers.admin'));
    assert.deepEqual(reasons.map((r) => r.code), ['peers.admin_serving_unapproved']);
    assert.match(reasons[0].detail, new RegExp(`not in compatible set ${POLICY.compatibleSet.id}$`));
    assert.equal(POLICY.compatibleSet.id, '2026-09-25-pilot-5');
  });

  test('CONTROL: the committed receipts are the approved ones, byte for byte', () => {
    for (const [name, declared] of Object.entries(POLICY.compatibleSet.peers)) {
      for (const approved of declared.approved) {
        const receipt = JSON.parse(readFileSync(join(ROOT, approved.receipt), 'utf8'));
        assert.equal(receiptDigest(receipt), approved.receiptDigest, `${name} ${approved.commit}`);
        assert.equal(receipt.commit, approved.commit);
        assert.equal(receipt.repository, declared.repository);
      }
    }
    assert.equal(clone(POLICY).bootstrap.authorized, false, 'bootstrap stays an owner decision');
  });
});

describe('the approved backend receipt (a6b25a6, the #338 merge) — what approving it changes, and what it does not', () => {
  test('CONTRACT: the approved receipt is the source-derived one — export present, D01 unchanged, levels as the backend publishes them', () => {
    assert.equal(BACKEND, 'a6b25a619d572c8de68964ab9ca4b4c2ae9ebe0b');
    const approved = POLICY.compatibleSet.peers.backend.approved;
    assert.equal(approved.length, 1, 'the previous revision is REPLACED, not kept beside it — every approved backend is checked');
    const receipt = JSON.parse(readFileSync(join(ROOT, approved[0].receipt), 'utf8'));
    assert.equal(receiptDigest(receipt), 'sha256:c1355f5059f24506e9637ad29c24e4782a71275bfa5a0b18a80ed07cc5d3b920');
    assert.equal(receipt.tree, 'd6d1f838e931f89d68e5bcafec43a84fd1b6f538');
    assert.deepEqual(receipt.unavailable, []);
    assert.deepEqual(receipt.publishes, { checkout_protocol: 3, quote_protocol: 2, kitchen_protocol: 1, quote_policy_version: 1 });
    const historical = JSON.parse(readFileSync(join(ROOT, HISTORICAL_RECEIPT_PATH), 'utf8'));
    assert.deepEqual(receipt.contracts.d01CheckoutLimits, historical.contracts.d01CheckoutLimits, 'the D01 contract did not move since 9448f55');
    assert.equal(receipt.sources[0].blob, historical.sources[0].blob, 'nor did the D01 export file');
  });

  test('CONTRACT: #332-#338 moved neither export — the refreshed receipt states exactly what 366b7e4 stated, read from its own files', () => {
    const previous = committedReceiptEntry('backend', PREVIOUS_BACKEND).receipt;
    const current = committedReceiptEntry('backend', BACKEND).receipt;
    assert.equal(receiptDigest(previous), 'sha256:ee8d855f1e738ff00b99d2c9ea9b1120feb1d0faad70d3510bf89da95e9f7d63', 'the retained history is the receipt approved on 2026-09-23');
    assert.deepEqual(current.sources, previous.sources, 'both export blobs are byte-identical between the two merges');
    assert.deepEqual(current.contracts, previous.contracts);
    assert.deepEqual(current.publishes, previous.publishes);
    assert.notEqual(current.tree, previous.tree, 'the source did change elsewhere — this is a different revision, not a relabel');
    assert.notEqual(receiptDigest(current), receiptDigest(previous));
  });

  test('CONTROL: the pure decision and the real CLI agree on the committed policy, so the comparison below measures the same rule', async () => {
    const viaCli = await decideCommitted();
    assert.deepEqual(codesOf(decidePure()), codesOf(viaCli.decision));
  });

  test('CONTRACT: with every other fact held fixed, the new receipt removes peers.capabilities_unpublished and nothing else', () => {
    const before = codesOf(decidePure(withHistoricalBackend()));
    const after = codesOf(decidePure());
    assert.deepEqual(before.filter((c) => !after.includes(c)), ['peers.capabilities_unpublished']);
    assert.deepEqual(after.filter((c) => !before.includes(c)), [], 'approving the receipt introduced no new reason');
    assert.equal(before.length, 7);
    assert.equal(after.length, 6);
  });

  test('REGRESSION: the historical revision, deliberately selected, is still refused for its missing export', () => {
    const { policy, peers, receipt } = withHistoricalBackend();
    assert.equal(receipt.publishes, null);
    assert.deepEqual(receipt.unavailable, ['publishedCapabilities']);
    const decision = decidePure({ policy, peers });
    const reason = decision.reasons.find((r) => r.code === 'peers.capabilities_unpublished');
    assert.ok(reason, JSON.stringify(codesOf(decision)));
    assert.match(reason.detail, new RegExp(HISTORICAL_BACKEND));
  });

  test('REGRESSION: the approved receipt, edited without re-approval, is refused — a capability level, a D01 value, or its source binding', () => {
    const edits = {
      'a capability level': (r) => { r.publishes.checkout_protocol = 4; },
      'a D01 value, with its digest recomputed to match': (r) => {
        r.contracts.d01CheckoutLimits.values.MAX_QUANTITY_PER_LINE = 100;
        r.contracts.d01CheckoutLimits.digest = contractDigest(r.contracts.d01CheckoutLimits.values);
      },
      'its source binding (the export file blob)': (r) => { r.sources[1].blob = 'f'.repeat(40); },
      'the revision it is about': (r) => { r.commit = HISTORICAL_BACKEND; },
    };
    for (const [label, edit] of Object.entries(edits)) {
      const peers = recordedPeers();
      const receipt = clone(peers.receipts.backend[0].receipt);
      edit(receipt);
      peers.receipts.backend[0] = { ...peers.receipts.backend[0], receipt, digest: receiptDigest(receipt) };
      const codes = codesOf(decidePure({ peers }));
      assert.ok(codes.some((c) => ['peers.receipt_mismatch', 'peers.receipt_wrong_revision'].includes(c)), `${label}: ${JSON.stringify(codes)}`);
    }
    // An edited D01 value WITHOUT its digest recomputed is inconsistent on its own terms.
    const peers = recordedPeers();
    const receipt = clone(peers.receipts.backend[0].receipt);
    receipt.contracts.d01CheckoutLimits.values.MAX_QUANTITY_PER_LINE = 100;
    peers.receipts.backend[0] = { ...peers.receipts.backend[0], receipt, digest: receiptDigest(receipt) };
    assert.ok(codesOf(decidePure({ peers })).includes('peers.receipt_inconsistent'));
  });

  test('CONTROL: approving the receipt changed no owner setting — bootstrap, source protection, retention, legacy publisher, enablement, backend serving', () => {
    assert.deepEqual(POLICY.bootstrap.authorized, false);
    assert.equal(POLICY.bootstrap.servedBaseline, null);
    assert.equal(POLICY.prerequisites.sourceProtection.status, 'unrecorded');
    assert.equal(POLICY.prerequisites.retention.status, 'unverified');
    assert.equal(POLICY.prerequisites.singlePublisher.status, 'legacy-writer-active');
    assert.equal(POLICY.prerequisites.singlePublisher.legacyWorkflow, '.github/workflows/deploy-prod.yml');
    assert.equal(POLICY.publication.enablementVariable, 'FRONTEND_PUBLISH_ENABLED');
    assert.equal(POLICY.compatibleSet.peers.backend.serving.observation, 'unavailable');
    assert.ok(existsSync(join(ROOT, '.github/workflows/deploy-prod.yml')), 'the legacy writer is untouched');
  });
});

describe('the committed readiness list, against what the committed policy actually refuses', () => {
  // The derived served state came from a LOCAL origin standing in for the committed
  // identity origin; readiness binds the bootstrap context to the policy's own URL, so
  // the stand-in's address is replaced by the one it stands in for — and a CONTROL
  // below shows that binding is real.
  const classify = (decision, over = {}) => {
    const input = baseline();
    return classifyReadiness({
      policy: POLICY, request: input.request, enablement: '', decision,
      facts: committedFacts(input), served: servedAtIdentity(), peers: recordedPeers(), ...over,
    });
  };

  test('CONTRACT: the recorded wait is EXACTLY the committed refusal — no entry more, none fewer', async () => {
    const { decision } = await decideCommitted();
    assert.deepEqual([...POLICY.publication.readiness.awaiting].sort(), codesOf(decision));
  });

  test('CONTRACT: that refusal, automatic with publication unset or `false`, is the recorded wait — and still REFUSE', async () => {
    const { status, decision } = await decideCommitted();
    assert.equal(status, 1, 'decide itself still exits non-zero; only the workflow wrapper asks the further question');
    for (const enablement of ['', 'false']) {
      const r = classify(decision, { enablement });
      assert.equal(r.kind, AWAITING, JSON.stringify(r.problems));
      assert.equal(r.decision, 'REFUSE');
      assert.equal(r.allow, false);
      assert.equal(r.published, false);
    }
  });

  test('CONTROL: the same refusal enabled, invalid, manual, or read at another origin is not a wait', async () => {
    const { decision } = await decideCommitted();
    assert.deepEqual(classify(decision, { enablement: 'true' }).problems.map((p) => p.code), ['readiness.publication_enabled']);
    assert.deepEqual(classify(decision, { enablement: 'on' }).problems.map((p) => p.code), ['readiness.enablement_invalid']);
    const manual = { ...decision, trigger: 'manual' };
    assert.ok(classify(manual, { request: { ...baseline().request, trigger: 'manual' } }).problems.some((p) => p.code === 'readiness.deliberate_attempt'));
    const elsewhere = classify(decision, { served: derivedServed });
    assert.deepEqual(elsewhere.problems.map((p) => p.code), ['readiness.context_mismatch']);
  });

  test('CONTRACT: the historical backend (9448f55) refuses capabilities_unpublished, and that is NOT a wait', () => {
    const { policy, peers } = withHistoricalBackend();
    const decision = decidePure({ policy, peers });
    assert.ok(codesOf(decision).includes('peers.capabilities_unpublished'));
    const r = classify(decision, { peers });
    assert.notEqual(r.kind, AWAITING);
    assert.deepEqual(r.problems.map((p) => p.code), ['readiness.unexpected_reason']);
    assert.match(r.problems[0].detail, /peers\.capabilities_unpublished/);
  });
});

describe('the 2026-09-24 receipt refresh (Admin 3521ebd, backend a6b25a6) — replayed against what CI observed', () => {
  // HISTORY. The set this refresh committed is no longer the committed one: its Admin
  // approval was superseded on 2026-09-25 (below). Every test here therefore selects
  // that set explicitly from its retained receipts, rather than reading whatever the
  // policy approves now, so it keeps proving what the 2026-09-24 change did.
  const beforeRefresh = () => withApproved({
    backend: PREVIOUS_BACKEND, admin: PREVIOUS_ADMIN, setId: PREVIOUS_SET_ID, adminServes: CI_OBSERVED_ADMIN,
  });
  const refreshed = () => withApproved({ admin: CI_OBSERVED_ADMIN, setId: SET_0924_ID, adminServes: CI_OBSERVED_ADMIN });

  test('CONTRACT: the pins it approved are the receipts produced and independently re-derived on 2026-09-24, retained as history', () => {
    const admin = committedReceiptEntry('admin', CI_OBSERVED_ADMIN);
    assert.equal(admin.digest, 'sha256:e58f7ff5fdd0deb0b21d3b78f8b7fd55f2b56781210f8027a2f640b343debfb1');
    assert.equal(admin.receipt.tree, '8a84439cd87c36501881cce64b7f293a59695621');
    assert.deepEqual(admin.receipt.sources, [
      { name: 'deployWorkflow', path: '.github/workflows/deploy.yml', blob: '0e210bf938beb29d43115eb96ad2ebf11576bb90' },
    ]);
    assert.deepEqual(admin.receipt.contracts, {}, 'Admin is identity-only: no protocol is assumed');
    assert.equal(admin.receipt.publishes, null);
    const previous = committedReceiptEntry('admin', PREVIOUS_ADMIN);
    assert.equal(previous.digest, 'sha256:d58c5647ff5f6764dda5396063852226b14d58b64d3aab99be51e42e0129f59b', 'the retained history is the receipt approved before');
    assert.notEqual(admin.receipt.sources[0].blob, previous.receipt.sources[0].blob,
      'the receipt-bearing deploy.yml blob DID change (#26, configure-aws-credentials v6.2.4 -> v6.3.0): the interval is not copy-only');
    assert.notEqual(ADMIN, CI_OBSERVED_ADMIN, 'superseded on 2026-09-25 — no longer the approved Admin revision');
  });

  test('CONTRACT: the previous set, replayed with CI\'s observation, refuses EXACTLY what run 36018365996 logged — and it was not a wait', () => {
    const { policy, peers } = beforeRefresh();
    const decision = decidePure({ policy, peers });
    assert.equal(decision.decision, 'REFUSE');
    assert.equal(decision.allow, false);
    assert.deepEqual(codesOf(decision), [...CI_REFUSAL_36018365996].sort());
    const admin = decision.reasons.find((r) => r.code === 'peers.admin_serving_unapproved');
    assert.equal(admin.detail, `admin serves ${CI_OBSERVED_ADMIN}, which is not in compatible set ${PREVIOUS_SET_ID}`, 'byte for byte the detail the CI log printed');
    const r = classifyWith({ policy, peers, decision });
    assert.notEqual(r.kind, AWAITING);
    assert.deepEqual(r.problems.map((p) => p.code), ['readiness.unexpected_reason']);
    assert.equal(r.problems[0].detail, `peers.admin_serving_unapproved: ${admin.detail}`);
  });

  test('CONTRACT: with every other fact held fixed, the refresh removed peers.admin_serving_unapproved and nothing else', () => {
    const before = codesOf(decidePure(beforeRefresh()));
    const after = codesOf(decidePure(refreshed()));
    assert.deepEqual(before.filter((c) => !after.includes(c)), ['peers.admin_serving_unapproved']);
    assert.deepEqual(after.filter((c) => !before.includes(c)), [], 'the refresh introduced no new compatibility problem');
    assert.ok(after.includes('peers.backend_serving_unverified'), 'a source receipt is not serving evidence — B3 still stands');
    assert.equal(before.length, 7);
    assert.equal(after.length, 6);
  });

  test('CONTRACT: attributed peer by peer — the Admin approval removed the refusal; the backend refresh changed no reason at all', () => {
    const after = codesOf(decidePure(refreshed()));
    const onlyBackendReverted = withApproved({
      backend: PREVIOUS_BACKEND, admin: CI_OBSERVED_ADMIN, setId: SET_0924_ID, adminServes: CI_OBSERVED_ADMIN,
    });
    assert.deepEqual(codesOf(decidePure(onlyBackendReverted)), after, '366b7e4 and a6b25a6 are equally compatible with this candidate');
    const onlyAdminReverted = withApproved({ admin: PREVIOUS_ADMIN, setId: SET_0924_ID, adminServes: CI_OBSERVED_ADMIN });
    assert.deepEqual(codesOf(decidePure(onlyAdminReverted)), [...after, 'peers.admin_serving_unapproved'].sort());
  });

  test('CONTRACT: once it was committed, the six commissioning conditions were a completed, non-publishing wait — REFUSE, allow:false, published:false', () => {
    const { policy, peers } = refreshed();
    const decision = decidePure({ policy, peers });
    assert.equal(decision.decision, 'REFUSE');
    assert.equal(decision.allow, false);
    for (const enablement of ['', 'false']) {
      const r = classifyWith({ policy, peers, decision, enablement });
      assert.equal(r.kind, AWAITING, JSON.stringify(r.problems));
      assert.equal(r.evaluationCompleted, true);
      assert.equal(r.published, false);
    }
  });
});

describe('the 2026-09-25 receipt refresh (Admin 1993a08) — replayed against what CI observed', () => {
  // Admin #28 and #29 merged and were deployed; the 1993a08 deploy (Deploy Admin run
  // 36146112119) completed at 14:15:22Z, and the frontend readiness run 36146235129 read
  // the identity three seconds later. The 2026-09-24 set did not approve 1993a08, so
  // that run refused peers.admin_serving_unapproved and was classified
  // not-a-waiting-state, and the publisher was skipped. The remedy is this reviewed
  // receipt, never a new entry in publication.readiness.awaiting.
  const before0925 = () => withApproved({ admin: CI_OBSERVED_ADMIN, setId: SET_0924_ID, adminServes: CI_OBSERVED_ADMIN_0925 });

  test('CONTRACT: the committed pin is the receipt produced and independently re-derived on 2026-09-25', () => {
    assert.equal(ADMIN, CI_OBSERVED_ADMIN_0925);
    const approved = POLICY.compatibleSet.peers.admin.approved;
    assert.equal(approved.length, 1, 'the previous Admin revision is replaced, not kept approved beside it');
    const admin = committedReceiptEntry('admin', ADMIN);
    assert.equal(admin.digest, 'sha256:96df2207aa3cf5fd94b3c10946a543d950f18dd1db9a844669ca97ebc81e5538');
    assert.equal(approved[0].receiptDigest, admin.digest);
    assert.equal(admin.receipt.tree, '2efbbc92522deb1fcfa583d23ac6d6f79091ac21');
    assert.deepEqual(admin.receipt.contracts, {}, 'Admin is identity-only: no protocol is assumed');
    assert.equal(admin.receipt.publishes, null);
    assert.deepEqual(admin.receipt.unavailable, []);
    const previous = committedReceiptEntry('admin', CI_OBSERVED_ADMIN);
    assert.deepEqual(admin.receipt.sources, previous.receipt.sources,
      '#28 and #29 did not touch deploy.yml: the receipt-bearing blob is byte-identical (0e210bf)');
    assert.notEqual(admin.receipt.tree, previous.receipt.tree, 'the source did change elsewhere — this is a different revision, not a relabel');
    assert.notEqual(admin.digest, previous.digest);
    assert.equal(BACKEND, 'a6b25a619d572c8de68964ab9ca4b4c2ae9ebe0b', 'this refresh does not move the backend approval');
  });

  test('CONTRACT: the 2026-09-24 set, replayed with CI\'s observation, reproduces run 36146235129\'s decision byte for byte — and it was not a wait', () => {
    const { policy, peers } = before0925();
    const decision = decidePure({ policy, peers });
    assert.deepEqual(codesOf(decision), [...CI_REFUSAL_36146235129].sort());
    assert.deepEqual([...CI_REFUSAL_36146235129].sort(), [...CI_REFUSAL_36018365996].sort(),
      'the same seven reasons as the 2026-09-24 refusal: an Admin promotion, and nothing else, moved');
    const admin = decision.reasons.find((r) => r.code === 'peers.admin_serving_unapproved');
    assert.equal(admin.detail, `admin serves ${CI_OBSERVED_ADMIN_0925}, which is not in compatible set ${SET_0924_ID}`);
    assert.equal(digestOfValue(decision), CI_DECISION_DIGEST_36146235129,
      'the whole decision — reason order and every detail — is the one the CI readiness record bound');
    const r = classifyWith({ policy, peers, decision });
    assert.notEqual(r.kind, AWAITING);
    assert.equal(r.published, false);
    assert.equal(r.decisionDigest, CI_DECISION_DIGEST_36146235129);
    assert.deepEqual(r.problems.map((p) => p.code), ['readiness.unexpected_reason']);
    assert.equal(r.problems[0].detail, `peers.admin_serving_unapproved: ${admin.detail}`);
  });

  test('CONTRACT: with every other fact held fixed, the refresh removes peers.admin_serving_unapproved and nothing else', () => {
    const before = codesOf(decidePure(before0925()));
    const after = codesOf(decidePure({ peers: recordedPeers({ adminServes: CI_OBSERVED_ADMIN_0925 }) }));
    assert.deepEqual(before.filter((c) => !after.includes(c)), ['peers.admin_serving_unapproved']);
    assert.deepEqual(after.filter((c) => !before.includes(c)), [], 'the refresh introduced no new compatibility problem');
    assert.ok(after.includes('peers.backend_serving_unverified'), 'a source receipt is not serving evidence — B3 still stands');
    assert.equal(before.length, 7);
    assert.equal(after.length, 6);
  });

  test('CONTRACT: after the refresh, the six commissioning conditions are a completed, non-publishing wait — REFUSE, allow:false, published:false', async () => {
    const { status, decision } = await decideCommitted();
    assert.equal(status, 1, 'the decision itself still refuses and exits non-zero');
    assert.equal(decision.decision, 'REFUSE');
    assert.equal(decision.allow, false);
    for (const enablement of ['', 'false']) {
      const r = classifyWith({ decision, enablement });
      assert.equal(r.kind, AWAITING, JSON.stringify(r.problems));
      assert.equal(r.evaluationCompleted, true);
      assert.equal(r.decision, 'REFUSE');
      assert.equal(r.allow, false);
      assert.equal(r.published, false);
    }
  });

  test('REGRESSION: an Admin revision the set does not approve is refused and is NOT a wait — the retired 3521ebd and 38df037, the deployed-but-never-approved ad4a7f8, or any later one', () => {
    for (const serves of [CI_OBSERVED_ADMIN, PREVIOUS_ADMIN, DEPLOYED_NEVER_APPROVED_ADMIN, 'a'.repeat(40)]) {
      const peers = recordedPeers({ adminServes: serves });
      const decision = decidePure({ peers });
      const reason = decision.reasons.find((r) => r.code === 'peers.admin_serving_unapproved');
      assert.ok(reason, `${serves}: ${JSON.stringify(codesOf(decision))}`);
      assert.equal(reason.detail, `admin serves ${serves}, which is not in compatible set 2026-09-25-pilot-5`);
      const r = classifyWith({ peers, decision });
      assert.notEqual(r.kind, AWAITING, serves);
      assert.deepEqual(r.problems.map((p) => p.code), ['readiness.unexpected_reason'], serves);
    }
  });

  test('REGRESSION: the approved Admin evidence, broken one fact at a time, is refused and is never a wait', () => {
    const cases = {
      'receipt tree edited': (p) => { const r = clone(p.receipts.admin[0].receipt); r.tree = 'f'.repeat(40); p.receipts.admin[0] = { ...p.receipts.admin[0], receipt: r, digest: receiptDigest(r) }; },
      'deploy.yml blob edited (wrong source blob)': (p) => { const r = clone(p.receipts.admin[0].receipt); r.sources[0].blob = 'c1a5e7c9080cd96eda820cd9dcdf6e31664417c4'; p.receipts.admin[0] = { ...p.receipts.admin[0], receipt: r, digest: receiptDigest(r) }; },
      'receipt about another revision': (p) => { const r = clone(p.receipts.admin[0].receipt); r.commit = CI_OBSERVED_ADMIN; p.receipts.admin[0] = { ...p.receipts.admin[0], receipt: r, digest: receiptDigest(r) }; },
      'the superseded receipt, relabelled as the approved one (tree 8a84439)': (p) => { const r = clone(committedReceiptEntry('admin', CI_OBSERVED_ADMIN).receipt); r.commit = ADMIN; p.receipts.admin[0] = { ...p.receipts.admin[0], receipt: r, digest: receiptDigest(r) }; },
      'receipt file missing': (p) => { p.receipts.admin[0] = { commit: ADMIN, path: receiptPath('admin', ADMIN), present: false }; },
      'receipt file unreadable': (p) => { p.receipts.admin[0] = { commit: ADMIN, path: receiptPath('admin', ADMIN), present: true, readable: false, detail: 'Unexpected token' }; },
      'public re-derivation disagrees (wrong source blob)': (p) => { p.verification.admin[ADMIN] = { state: 'mismatch', detail: '.github/workflows/deploy.yml: c1a5e7c != 0e210bf' }; },
      'public re-derivation unavailable': (p) => { p.verification.admin[ADMIN] = { state: 'unavailable', detail: 'HTTP 502' }; },
      'served identity unreadable': (p) => { p.serving.admin = { state: 'unreadable', detail: 'CONNECT refused' }; },
      'served identity cacheable': (p) => { p.serving.admin = { ...p.serving.admin, noStore: false, cacheControl: 'public, max-age=300' }; },
    };
    const expected = {
      'receipt tree edited': 'peers.receipt_mismatch',
      'deploy.yml blob edited (wrong source blob)': 'peers.receipt_mismatch',
      'receipt about another revision': 'peers.receipt_wrong_revision',
      'the superseded receipt, relabelled as the approved one (tree 8a84439)': 'peers.receipt_mismatch',
      'receipt file missing': 'peers.receipt_missing',
      'receipt file unreadable': 'peers.receipt_unreadable',
      'public re-derivation disagrees (wrong source blob)': 'peers.admin_receipt_unverified',
      'public re-derivation unavailable': 'peers.admin_receipt_unverified',
      'served identity unreadable': 'peers.admin_serving_unreadable',
      'served identity cacheable': 'peers.admin_serving_cacheable',
    };
    for (const [label, breakIt] of Object.entries(cases)) {
      const peers = recordedPeers();
      breakIt(peers);
      const decision = decidePure({ peers });
      assert.ok(codesOf(decision).includes(expected[label]), `${label}: ${JSON.stringify(codesOf(decision))}`);
      assert.equal(decision.allow, false, label);
      assert.notEqual(classifyWith({ peers, decision }).kind, AWAITING, label);
    }
  });

  test('REGRESSION: the approved backend receipt, edited without re-approval, is refused — and the missing serving identity still stands', () => {
    const peers = recordedPeers();
    const receipt = clone(peers.receipts.backend[0].receipt);
    receipt.publishes.quote_protocol = 1;
    peers.receipts.backend[0] = { ...peers.receipts.backend[0], receipt, digest: receiptDigest(receipt) };
    const codes = codesOf(decidePure({ peers }));
    assert.ok(codes.includes('peers.receipt_mismatch'), JSON.stringify(codes));
    assert.ok(codes.includes('peers.backend_serving_unverified'));
  });

  test('CONTROL: a malformed approval in the policy is refused as an invalid policy, not as a wait', () => {
    const policy = clone(POLICY);
    policy.compatibleSet.peers.admin.approved[0].receiptDigest = 'sha256:not-a-digest';
    const decision = decidePure({ policy });
    assert.deepEqual(codesOf(decision), ['policy.invalid']);
    assert.equal(decision.allow, false);
  });

  test('CONTROL: the refresh moved no owner setting and no enablement — only the compatible set', () => {
    assert.equal(POLICY.compatibleSet.id, '2026-09-25-pilot-5');
    assert.deepEqual([...POLICY.publication.readiness.awaiting].sort(), [
      'peers.backend_serving_unverified',
      ...PREREQUISITES,
      'served.bootstrap_unauthorized',
    ].sort(), 'no peers.admin_* entry, no wildcard, no new waiting reason');
    assert.ok(!POLICY.publication.readiness.awaiting.some((c) => c.startsWith('peers.admin')));
    assert.equal(POLICY.bootstrap.authorized, false);
    assert.equal(POLICY.bootstrap.servedBaseline, null);
    assert.equal(POLICY.compatibleSet.peers.backend.serving.observation, 'unavailable');
    assert.equal(POLICY.compatibleSet.peers.admin.serving.observation, 'public-identity');
    assert.equal(POLICY.publication.enablementVariable, 'FRONTEND_PUBLISH_ENABLED');
  });
});
