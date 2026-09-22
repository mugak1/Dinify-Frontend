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
 *   admin         verified 2026-09-22 against the Admin clone and GitHub's
 *                 API (tree b75c951…, deploy.yml blob c1a5e7c…); served
 *                 38df037 with Cache-Control: no-store at 20:05:16Z          RECORDED
 *   legacy        whether deploy-prod.yml exists in THIS checkout            OBSERVED
 *   candidate     the fixture baseline's certification, artifact and source  FIXTURE
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
import { POLICY, baseline, clone } from './fixtures.mjs';
import { ROOT, cli, startOrigin, tempDir } from './harness.mjs';

const ADMIN = POLICY.compatibleSet.peers.admin.approved[0].commit;
const BACKEND = POLICY.compatibleSet.peers.backend.approved[0].commit;

// The backend revision this policy approved BEFORE the capability export existed
// (the #330 merge). Its receipt is retained under release/peers/ as history and is
// no longer approved; the negative controls below select it deliberately.
const HISTORICAL_BACKEND = '9448f55ed28c040b96bf747e27c9dd2c86884c5a';
const HISTORICAL_RECEIPT_PATH = `release/peers/backend-${HISTORICAL_BACKEND}.json`;

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
    trusted: { legacyPublisherPresent: existsSync(join(ROOT, POLICY.prerequisites.singlePublisher.legacyWorkflow)) },
    policy: { revision: 'f'.repeat(40), digest: digestOfValue(POLICY), verifierTree: 'e'.repeat(40) },
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
  const args = ['decide', '--now', input.now, '--record-out', join(dir, 'record.json'), '--summary', join(dir, 'summary.md')];
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
    eligibility: facts.eligibility, peers, trusted: facts.trusted, now: input.now,
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
      // SELECTION IS NOT SERVING. The approved backend (366b7e4, the #331 merge) now
      // publishes its capability export, so peers.capabilities_unpublished is gone —
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
    assert.match(reasons[0].detail, /not in compatible set 2026-09-23-pilot-3/);
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

describe('the approved backend receipt (366b7e4, the #331 merge) — what approving it changes, and what it does not', () => {
  test('CONTRACT: the approved receipt is the source-derived one — export present, D01 unchanged, levels as the backend publishes them', () => {
    assert.equal(BACKEND, '366b7e457cfffa700663fc10983b0420e8882313');
    const approved = POLICY.compatibleSet.peers.backend.approved;
    assert.equal(approved.length, 1, 'the export-less revision is REPLACED, not kept beside it — every approved backend is checked');
    const receipt = JSON.parse(readFileSync(join(ROOT, approved[0].receipt), 'utf8'));
    assert.equal(receiptDigest(receipt), 'sha256:ee8d855f1e738ff00b99d2c9ea9b1120feb1d0faad70d3510bf89da95e9f7d63');
    assert.equal(receipt.tree, 'f129fe74fa9dc023fc92f23196a6f888b753081f');
    assert.deepEqual(receipt.unavailable, []);
    assert.deepEqual(receipt.publishes, { checkout_protocol: 3, quote_protocol: 2, kitchen_protocol: 1, quote_policy_version: 1 });
    const historical = JSON.parse(readFileSync(join(ROOT, HISTORICAL_RECEIPT_PATH), 'utf8'));
    assert.deepEqual(receipt.contracts.d01CheckoutLimits, historical.contracts.d01CheckoutLimits, 'the D01 contract did not move between the two revisions');
    assert.equal(receipt.sources[0].blob, historical.sources[0].blob, 'nor did the D01 export file');
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
