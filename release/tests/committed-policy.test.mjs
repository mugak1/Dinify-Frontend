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
 *   admin         receipt for 9ec02fe (the Admin #34 merge: #33/#34 added the
 *                 Claude Code workflows and a vendored review plugin, and
 *                 narrowed a COMMENT in deploy.yml's header) produced and
 *                 verified 2026-09-26 against two fresh clones, an independent
 *                 Python re-derivation and GitHub's public API through the real
 *                 peer-facts path (tree 7f27fdd…, deploy.yml blob 2618d1e…,
 *                 changed from #32's 3644dcd… by that comment). Superseded
 *                 records: abdacda (tree f063b6d…, blob 3644dcd…; no readiness
 *                 run observed it before its approval, and runs 36270515216 on
 *                 9a11385 and 36272139246 on 349e97b logged it serving, approved,
 *                 after), a7ef20c (tree a9f9846…, blob 3644dcd…, logged
 *                 serving by run 36247543634 on 485e9e9), eb54c92 (tree
 *                 f022909…, blob 0e210bf…; NO frontend
 *                 readiness run observed it serving, so every serving input
 *                 naming it is CONSTRUCTED and labelled so), 1993a08 (tree
 *                 2efbbc9…, logged serving by run 36146235129 on 3a16e84),
 *                 3521ebd (tree 8a84439…, logged serving by run 36018365996 on
 *                 c32f383) and 38df037 (tree b75c951…, blob c1a5e7c…, served
 *                 no-store 2026-09-22)                                       RECORDED
 *   admin serving the DEFAULT serving input is 9ec02fe, the approved revision.
 *                 Deploy Admin run 36273633936 finished promoting it at
 *                 21:40:17Z on 2026-09-26 (a deployment record); the frontend
 *                 readiness run 36273728448 (on 44c4fc3) then READ it and refused
 *                 it as unapproved under pilot-8, and public reads of
 *                 admin.dinifyapp.com/release.txt from the environment that
 *                 wrote this revision of the suite returned it, no-store, at
 *                 23:58:21Z and 23:59:14Z (the second through the real
 *                 peer-facts command). It is what the next real run is expected
 *                 to meet, so the headline committed-state tests use it      OBSERVED
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
import { POLICY, assessmentFor, baseline, clone, dependenciesFor } from './fixtures.mjs';
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

// The set the 2026-09-25 refresh committed (2026-09-25-pilot-5): Admin 1993a08 beside
// backend a6b25a6. Its Admin approval was superseded on 2026-09-26; its backend is
// still the approved one. The 1993a08 receipt is retained under release/peers/ as
// history, and the replays below select it deliberately.
const SET_0925_ID = '2026-09-25-pilot-5';

// The Admin #30 merge (D08 B2.3), approved on 2026-09-26 in 2026-09-26-pilot-6 and
// superseded the same day by a7ef20c (below). Deploy Admin run 36196825836 finished
// promoting it at 22:29:00Z on 2026-09-25, and NO frontend readiness run read the
// identity while it served: every serving input naming it is CONSTRUCTED. Its receipt
// is retained under release/peers/ as history, and the replays below select it.
const B23_ADMIN = 'eb54c92c6706093f09847315d83b344e46180770';
const SET_0926_ID = '2026-09-26-pilot-6';

// The Admin #31 merge (D08 B2.4), approved on 2026-09-26 in 2026-09-26-pilot-7 after
// review and superseded the same day by abdacda (below). Deploy Admin run 36245215836 finished promoting it at 13:28:29Z (a deployment
// record, not an origin read). The frontend readiness run 36247543634 (job
// 108419421080, on 485e9e9, the #703 merge) then read the identity and logged it
// serving; pilot-6 did not approve it, so that run refused
// peers.admin_serving_unapproved, was classified not-a-waiting-state, and the publisher
// was skipped. The decision it printed digests to exactly the `decisionDigest` its
// readiness record carries, so the whole decision is pinned below. Public reads of
// https://admin.dinifyapp.com/release.txt from the environment that wrote this suite
// returned it, no-store, at 14:13:12Z and 14:20:29Z.
const B24_ADMIN = 'a7ef20c452062e95f24ecec2a506d27882db587b';
const SET_0926B_ID = '2026-09-26-pilot-7';
const CI_REFUSAL_36247543634 = [
  'peers.admin_serving_unapproved',
  'peers.backend_serving_unverified',
  'prerequisite.legacy_publisher_active',
  'prerequisite.legacy_publisher_present',
  'prerequisite.retention_unverified',
  'prerequisite.source_protection_unrecorded',
  'served.bootstrap_unauthorized',
];
const CI_DECISION_DIGEST_36247543634 = 'sha256:6aecf7484c20255bf1ae6f16a6704f889d012334ec69e04e8d1fe8bf8cde6643';

// The Admin #32 merge, approved on 2026-09-26 in 2026-09-26-pilot-8 after review and
// superseded the same day by 9ec02fe (below). #32 changed CLAUDE.md and
// release/README.md only (it records #31's first live certified forward promotion); the
// receipt-bearing deploy.yml blob is unchanged (3644dcd). Deploy Admin run 36264601950
// finished promoting it at 19:02:54Z. NO frontend readiness run read the identity
// BEFORE that approval — the last, 36249940983, finished at 14:52:29Z, before #32
// merged — so every pilot-7 refusal naming it below is CONSTRUCTED from the rule, not a
// replay of a run. AFTER the approval, runs 36270515216 and 36272139246 did read it
// under pilot-8 (CI_WAIT_DIGEST_PILOT8, below). A public read of
// https://admin.dinifyapp.com/release.txt from the environment that wrote the pilot-8
// revision returned it, no-store, at 20:20:27Z.
const DOCS32_ADMIN = 'abdacda44d8a8f4694880e1e3435743615a27a20';
const SET_0926C_ID = '2026-09-26-pilot-8';
// What two frontend readiness runs recorded while pilot-8 was committed and Admin served
// abdacda: run 36270515216 (job 108483450654, on 9a11385, the merge of the pilot-8
// refresh) and run 36272139246 (job 108487990269, on 349e97b, the #706 merge). The
// peers.json each retained (artifacts 10915326891 and 10916375815, whose downloaded
// bytes hash to the listed digests) states Admin serving abdacda, verified and no-store;
// each decided the six recorded conditions, classified awaiting-prerequisites,
// published: false, and bound this decisionDigest. The six-reason decision names no
// Admin commit, so the digest is identical for ANY approved serving revision — the
// served commit is the retained peers.json's, not the digest's.
const CI_WAIT_DIGEST_PILOT8 = 'sha256:604dcb5ec4304bdf522b2dfdec6b58d113e2bea50a9a4f672ed047a89b3eed15';

// The Admin #34 merge, approved on 2026-09-26 in 2026-09-26-pilot-9 after review. #33
// and #34 added two Claude Code workflows (claude.yml, claude-code-review.yml — neither
// holds id-token), a vendored review plugin under .claude/, and narrowed a COMMENT in
// deploy.yml's header, which is why the receipt-bearing blob moved 3644dcd -> 2618d1e.
// Deploy Admin run 36273633936 finished promoting it at 21:40:17Z. The frontend
// readiness run 36273728448 (job 108492367222, on 44c4fc3, the #707 merge) then read the
// identity and logged it serving; pilot-8 did not approve it, so that run refused
// peers.admin_serving_unapproved, was classified not-a-waiting-state, and the publisher
// was skipped. The decision it printed digests to exactly the `decisionDigest` its
// readiness record carries, so the whole decision is pinned below. Public reads of
// https://admin.dinifyapp.com/release.txt from the environment that wrote this revision
// returned it, no-store, at 23:58:21Z and 23:59:14Z.
const CLAUDE34_ADMIN = '9ec02fed9b6ab061879d838511214e907b7269ed';
const SET_0926D_ID = '2026-09-26-pilot-9';
const CI_REFUSAL_36273728448 = [
  'peers.admin_serving_unapproved',
  'peers.backend_serving_unverified',
  'prerequisite.legacy_publisher_active',
  'prerequisite.legacy_publisher_present',
  'prerequisite.retention_unverified',
  'prerequisite.source_protection_unrecorded',
  'served.bootstrap_unauthorized',
];
const CI_DECISION_DIGEST_36273728448 = 'sha256:f945b541562b9e652cd77f34edee1dfee54e076b0686a30eb4c54e3383436a51';
const LIVE_ADMIN_OBSERVED = CLAUDE34_ADMIN;

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

/** Peer facts as the committed receipts state them. Serving defaults to the Admin
 *  revision OBSERVED live (9ec02fe, approved in pilot-9) — what the next real run meets. */
function recordedPeers({ adminServes = LIVE_ADMIN_OBSERVED } = {}) {
  return {
    receipts: committedReceipts(),
    verification: { admin: { [ADMIN]: { state: 'verified', detail: '' } } },
    serving: { admin: { state: 'known', commit: adminServes, noStore: true, cacheControl: 'no-store' } },
  };
}

/** Admin serving whichever revision the policy approves. Since pilot-9 that is also the
 *  observed 9ec02fe, so this equals the default today; tests that must stay independent
 *  of the observation use it, and tests that must discriminate against a different
 *  policy name the served revision literally instead (servingClaude34, below). */
const servingApproved = () => recordedPeers({ adminServes: ADMIN });

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
function decidePure({ policy = POLICY, peers = recordedPeers(), served = derivedServed, dependencies } = {}) {
  const input = baseline();
  const facts = committedFacts(input);
  return decide({
    policy, request: input.request, certification: input.certification, artifact: input.artifact,
    source: facts.source, hosting: facts.hosting, served, baseline: facts.baseline,
    eligibility: facts.eligibility, peers, trusted: facts.trusted, dependencies: dependencies ?? input.dependencies, evaluation: input.evaluation,
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
  const peers = servingApproved();
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

  test('CONTRACT: as observed (Admin serving 9ec02fe, approved in pilot-9), an otherwise perfect candidate is refused for the six outstanding facts alone — and that IS the recorded, non-publishing wait', async () => {
    const { status, decision } = await decideCommitted();
    assert.equal(status, 1);
    assert.equal(decision.decision, 'REFUSE');
    assert.equal(decision.allow, false);
    assert.deepEqual(codesOf(decision), [
      'peers.backend_serving_unverified',
      ...PREREQUISITES,
      'served.bootstrap_unauthorized',
    ].sort());
    assert.ok(!codesOf(decision).some((c) => c.startsWith('peers.admin')), 'the observed Admin revision is the approved one');
    const r = classifyWith({ decision });
    assert.equal(r.kind, AWAITING, JSON.stringify(r.problems));
    assert.equal(r.published, false);
    assert.deepEqual(r.problems, []);
  });

  test('CONTRACT: an otherwise perfect candidate is refused EXACTLY for the outstanding owner and peer facts, and the summary says which are owner prerequisites', async () => {
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
    assert.equal(POLICY.compatibleSet.id, '2026-09-26-pilot-9');
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
    const after = codesOf(decidePure({ peers: servingApproved() }));
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
      facts: committedFacts(input), served: servedAtIdentity(), peers: servingApproved(), ...over,
    });
  };

  test('CONTRACT: the recorded wait is EXACTLY the committed refusal as observed (Admin serving the approved 9ec02fe) — and an unapproved Admin revision, such as the just-superseded abdacda, adds only an unapproved-peer reason, which is not a wait', async () => {
    const { decision } = await decideCommitted();
    assert.deepEqual([...POLICY.publication.readiness.awaiting].sort(), codesOf(decision));
    const superseded = await decideCommitted({ peers: recordedPeers({ adminServes: DOCS32_ADMIN }) });
    assert.deepEqual(codesOf(superseded.decision), [...POLICY.publication.readiness.awaiting, 'peers.admin_serving_unapproved'].sort());
    assert.notEqual(classify(superseded.decision, { peers: recordedPeers({ adminServes: DOCS32_ADMIN }) }).kind, AWAITING);
  });

  test('CONTRACT: as observed, that refusal, automatic with publication unset or `false`, is the recorded wait — and still REFUSE', async () => {
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
    const { decision } = await decideCommitted({ peers: servingApproved() });
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
  // HISTORY. Admin #28 and #29 merged and were deployed; the 1993a08 deploy (Deploy
  // Admin run 36146112119) completed at 14:15:22Z, and the frontend readiness run
  // 36146235129 read the identity three seconds later. The 2026-09-24 set did not
  // approve 1993a08, so that run refused peers.admin_serving_unapproved and was
  // classified not-a-waiting-state, and the publisher was skipped. The set this refresh
  // committed (2026-09-25-pilot-5) is no longer the committed one: its Admin approval
  // was superseded on 2026-09-26 (below). Every test here therefore selects that set
  // explicitly from its retained receipts, so it keeps proving what the 2026-09-25
  // change did rather than claiming the past approved today's revision.
  const before0925 = () => withApproved({ admin: CI_OBSERVED_ADMIN, setId: SET_0924_ID, adminServes: CI_OBSERVED_ADMIN_0925 });
  const refreshed0925 = () => withApproved({ admin: CI_OBSERVED_ADMIN_0925, setId: SET_0925_ID, adminServes: CI_OBSERVED_ADMIN_0925 });

  test('CONTRACT: the pin it approved is the receipt produced and independently re-derived on 2026-09-25, retained as history', () => {
    const admin = committedReceiptEntry('admin', CI_OBSERVED_ADMIN_0925);
    assert.equal(admin.digest, 'sha256:96df2207aa3cf5fd94b3c10946a543d950f18dd1db9a844669ca97ebc81e5538');
    assert.equal(admin.receipt.tree, '2efbbc92522deb1fcfa583d23ac6d6f79091ac21');
    assert.deepEqual(admin.receipt.contracts, {}, 'Admin is identity-only: no protocol is assumed');
    assert.equal(admin.receipt.publishes, null);
    assert.deepEqual(admin.receipt.unavailable, []);
    const previous = committedReceiptEntry('admin', CI_OBSERVED_ADMIN);
    assert.deepEqual(admin.receipt.sources, previous.receipt.sources,
      '#28 and #29 did not touch deploy.yml: the receipt-bearing blob is byte-identical (0e210bf)');
    assert.notEqual(admin.receipt.tree, previous.receipt.tree, 'the source did change elsewhere — this is a different revision, not a relabel');
    assert.notEqual(admin.digest, previous.digest);
    assert.notEqual(ADMIN, CI_OBSERVED_ADMIN_0925, 'superseded on 2026-09-26 — no longer the approved Admin revision');
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

  test('CONTRACT: with every other fact held fixed, the refresh removed peers.admin_serving_unapproved and nothing else', () => {
    const before = codesOf(decidePure(before0925()));
    const after = codesOf(decidePure(refreshed0925()));
    assert.deepEqual(before.filter((c) => !after.includes(c)), ['peers.admin_serving_unapproved']);
    assert.deepEqual(after.filter((c) => !before.includes(c)), [], 'the refresh introduced no new compatibility problem');
    assert.ok(after.includes('peers.backend_serving_unverified'), 'a source receipt is not serving evidence — B3 still stands');
    assert.equal(before.length, 7);
    assert.equal(after.length, 6);
  });

  test('CONTRACT: once it was committed, the six commissioning conditions were a completed, non-publishing wait — REFUSE, allow:false, published:false', () => {
    const { policy, peers } = refreshed0925();
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

describe('the 2026-09-26 receipt refresh (Admin eb54c92, D08 B2.3) — a reviewed source approval, not a serving observation', () => {
  // HISTORY. Admin #30 (the B2.3 mock-isolation qualification) merged and was deployed
  // at 22:29:00Z on 2026-09-25, and NO frontend readiness run read the Admin identity
  // while it served: the replays below hold serving at eb54c92 as a CONSTRUCTED input,
  // to measure exactly what approving its receipt changed with every other fact fixed.
  // They are not a record of any run. The set this refresh committed
  // (2026-09-26-pilot-6) is no longer the committed one: its Admin approval was
  // superseded the same day by a7ef20c (below). Every test here therefore selects that
  // set explicitly from its retained receipts, so it keeps proving what the pilot-6
  // change did rather than claiming the past approved today's revision.
  const beforeRefresh = () => withApproved({ admin: CI_OBSERVED_ADMIN_0925, setId: SET_0925_ID, adminServes: B23_ADMIN });
  // CONSTRUCTED: Admin serving eb54c92 under the set that approved it.
  const refreshed0926 = () => withApproved({ admin: B23_ADMIN, setId: SET_0926_ID, adminServes: B23_ADMIN });

  test('CONTRACT: the pin it approved is the receipt produced by peer-receipt at eb54c92 and independently re-derived on 2026-09-26, retained as history', () => {
    const admin = committedReceiptEntry('admin', B23_ADMIN);
    assert.equal(admin.digest, 'sha256:ced2198497e23ac4aaa13d7947aae127973abfaded5b18a122ead014a5dc07f6');
    assert.equal(admin.receipt.tree, 'f0229090404d7857a73a272e70f4823d5796b77c');
    assert.deepEqual(admin.receipt.contracts, {}, 'Admin is identity-only: no protocol is assumed');
    assert.equal(admin.receipt.publishes, null);
    assert.deepEqual(admin.receipt.unavailable, []);
    const previous = committedReceiptEntry('admin', CI_OBSERVED_ADMIN_0925);
    assert.deepEqual(admin.receipt.sources, previous.receipt.sources,
      '#30 did not touch deploy.yml: the receipt-bearing blob is byte-identical (0e210bf)');
    assert.notEqual(admin.receipt.tree, previous.receipt.tree, 'the source did change elsewhere — this is a different revision, not a relabel');
    assert.notEqual(admin.digest, previous.digest);
    assert.notEqual(ADMIN, B23_ADMIN, 'superseded on 2026-09-26 by a7ef20c — no longer the approved Admin revision');
    assert.equal(BACKEND, 'a6b25a619d572c8de68964ab9ca4b4c2ae9ebe0b', 'this refresh did not move the backend approval');
  });

  test('CONTRACT (constructed serving): under the 2026-09-25 set an observed eb54c92 was refused as unapproved — seven reasons, and not a wait', () => {
    const { policy, peers } = beforeRefresh();
    const decision = decidePure({ policy, peers });
    assert.equal(decision.decision, 'REFUSE');
    assert.equal(decision.allow, false);
    assert.deepEqual(codesOf(decision), [...CI_REFUSAL_36146235129].sort(),
      'the same seven reasons the last two Admin promotions produced: an Admin promotion, and nothing else, moved');
    const admin = decision.reasons.find((r) => r.code === 'peers.admin_serving_unapproved');
    assert.equal(admin.detail, `admin serves ${B23_ADMIN}, which is not in compatible set ${SET_0925_ID}`);
    const r = classifyWith({ policy, peers, decision });
    assert.notEqual(r.kind, AWAITING);
    assert.equal(r.published, false);
    assert.deepEqual(r.problems.map((p) => p.code), ['readiness.unexpected_reason']);
  });

  test('CONTRACT: with every other fact held fixed, the refresh removed peers.admin_serving_unapproved and nothing else', () => {
    const before = codesOf(decidePure(beforeRefresh()));
    const after = codesOf(decidePure(refreshed0926()));
    assert.deepEqual(before.filter((c) => !after.includes(c)), ['peers.admin_serving_unapproved']);
    assert.deepEqual(after.filter((c) => !before.includes(c)), [], 'the refresh introduced no new compatibility problem');
    assert.ok(after.includes('peers.backend_serving_unverified'), 'a source receipt is not serving evidence — B3 still stands');
    assert.equal(before.length, 7);
    assert.equal(after.length, 6);
    assert.deepEqual(after, [...POLICY.publication.readiness.awaiting].sort(), 'what remained was exactly the recorded wait, nothing hidden');
  });

  test('CONTRACT: once it was committed, the six commissioning conditions were a completed, non-publishing wait — REFUSE, allow:false, published:false', () => {
    const { policy, peers } = refreshed0926();
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

describe('the 2026-09-26 receipt refresh (Admin a7ef20c, D08 B2.4) — replayed against what CI observed', () => {
  // HISTORY. Admin #31 (D08 B2.4, certified promotion) merged and was deployed; Deploy
  // Admin run 36245215836 finished at 13:28:29Z. The frontend readiness run 36247543634
  // read the identity at 14:10:16Z and logged a7ef20c serving. pilot-6 did not approve
  // it, so that run refused peers.admin_serving_unapproved, was classified
  // not-a-waiting-state, and the publisher was skipped. The remedy was a reviewed
  // receipt, never a new entry in publication.readiness.awaiting. The set that refresh
  // committed (2026-09-26-pilot-7) is no longer the committed one: its Admin approval
  // was superseded the same day by abdacda (below). Every test here therefore selects
  // pilot-7 explicitly from its retained receipt, so it keeps proving what that change
  // did rather than claiming the past approved today's revision.
  const before0926b = () => withApproved({ admin: B23_ADMIN, setId: SET_0926_ID, adminServes: B24_ADMIN });
  // Admin serving a7ef20c under the set that approved it. Run 36249940983 (on 9d30ccb,
  // under pilot-7) concluded green with the publisher skipped, which under that set is
  // only possible with the approved a7ef20c serving — an inference from its conclusion,
  // not a replay of its log.
  const refreshed0926b = () => withApproved({ admin: B24_ADMIN, setId: SET_0926B_ID, adminServes: B24_ADMIN });

  test('CONTRACT: the pin it approved is the receipt produced by peer-receipt at a7ef20c and independently re-derived on 2026-09-26, retained as history', () => {
    const admin = committedReceiptEntry('admin', B24_ADMIN);
    assert.equal(admin.digest, 'sha256:c21ad7c5142e05dcd7020545a3f71ee3e92e612f7a4499d7002c25abb16381e2');
    assert.equal(admin.receipt.tree, 'a9f98461bcf608305c9c93339f4e9d79dc4f9a2b');
    assert.deepEqual(admin.receipt.sources, [
      { name: 'deployWorkflow', path: '.github/workflows/deploy.yml', blob: '3644dcdb864d788997446946afc75d092dce3f33' },
    ]);
    assert.deepEqual(admin.receipt.contracts, {}, 'Admin is identity-only: no protocol is assumed');
    assert.equal(admin.receipt.publishes, null);
    assert.deepEqual(admin.receipt.unavailable, []);
    const previous = committedReceiptEntry('admin', B23_ADMIN);
    assert.notEqual(admin.receipt.sources[0].blob, previous.receipt.sources[0].blob,
      'the receipt-bearing deploy.yml blob DID change (#31 rewrote it for certified promotion, 0e210bf -> 3644dcd): the interval was not copy-only');
    assert.equal(admin.receipt.sources[0].path, previous.receipt.sources[0].path, 'the same file is what the receipt binds');
    assert.notEqual(admin.receipt.tree, previous.receipt.tree);
    assert.notEqual(admin.digest, previous.digest);
    assert.notEqual(ADMIN, B24_ADMIN, 'superseded on 2026-09-26 by abdacda — no longer the approved Admin revision');
    assert.equal(BACKEND, 'a6b25a619d572c8de68964ab9ca4b4c2ae9ebe0b', 'this refresh did not move the backend approval');
  });

  test('CONTRACT: the 2026-09-26 pilot-6 set, replayed with CI\'s observation, reproduces run 36247543634\'s decision byte for byte — and it was not a wait', () => {
    const { policy, peers } = before0926b();
    const decision = decidePure({ policy, peers });
    assert.deepEqual(codesOf(decision), [...CI_REFUSAL_36247543634].sort());
    assert.deepEqual([...CI_REFUSAL_36247543634].sort(), [...CI_REFUSAL_36146235129].sort(),
      'the same seven reasons as the 2026-09-25 refusal: an Admin promotion, and nothing else, moved');
    const admin = decision.reasons.find((r) => r.code === 'peers.admin_serving_unapproved');
    assert.equal(admin.detail, `admin serves ${B24_ADMIN}, which is not in compatible set ${SET_0926_ID}`, 'byte for byte the detail the CI log printed');
    assert.equal(digestOfValue(decision), CI_DECISION_DIGEST_36247543634,
      'the whole decision — reason order and every detail — is the one the CI readiness record bound');
    const r = classifyWith({ policy, peers, decision });
    assert.notEqual(r.kind, AWAITING);
    assert.equal(r.published, false);
    assert.equal(r.decisionDigest, CI_DECISION_DIGEST_36247543634);
    assert.deepEqual(r.problems.map((p) => p.code), ['readiness.unexpected_reason']);
    assert.equal(r.problems[0].detail, `peers.admin_serving_unapproved: ${admin.detail}`);
  });

  test('CONTRACT: with every other fact held fixed, the refresh removed peers.admin_serving_unapproved and nothing else', () => {
    const before = codesOf(decidePure(before0926b()));
    const after = codesOf(decidePure(refreshed0926b()));
    assert.deepEqual(before.filter((c) => !after.includes(c)), ['peers.admin_serving_unapproved']);
    assert.deepEqual(after.filter((c) => !before.includes(c)), [], 'the refresh introduced no new compatibility problem');
    assert.ok(after.includes('peers.backend_serving_unverified'), 'a source receipt is not serving evidence — B3 still stands');
    assert.equal(before.length, 7);
    assert.equal(after.length, 6);
    assert.deepEqual(after, [...POLICY.publication.readiness.awaiting].sort(), 'what remained was exactly the recorded wait, nothing hidden');
  });

  test('CONTRACT: once it was committed, the six commissioning conditions were a completed, non-publishing wait — REFUSE, allow:false, published:false', () => {
    const { policy, peers } = refreshed0926b();
    const decision = decidePure({ policy, peers });
    assert.equal(decision.decision, 'REFUSE');
    assert.equal(decision.allow, false);
    for (const enablement of ['', 'false']) {
      const r = classifyWith({ policy, peers, decision, enablement });
      assert.equal(r.kind, AWAITING, JSON.stringify(r.problems));
      assert.equal(r.evaluationCompleted, true);
      assert.equal(r.decision, 'REFUSE');
      assert.equal(r.allow, false);
      assert.equal(r.published, false);
    }
  });
});

describe('the 2026-09-26 receipt refresh (Admin abdacda, the documentation-only #32) — approved before any readiness run observed it; two observed it approved afterwards', () => {
  // HISTORY. Admin #32 changed CLAUDE.md and release/README.md only. It merged at
  // 18:59:38Z and Deploy Admin run 36264601950 promoted it by 19:02:54Z. The last
  // frontend readiness run before this approval (36249940983) finished at 14:52:29Z,
  // BEFORE that, and was green under pilot-7 because it observed a7ef20c — it says
  // nothing about abdacda. So the pilot-7 refusal below is CONSTRUCTED from the rule
  // with every other fact held fixed, and is labelled so. AFTER the approval merged, two
  // readiness runs (36270515216 and 36272139246, see CI_WAIT_DIGEST_PILOT8) did read
  // abdacda serving under pilot-8 and recorded the six-reason wait: that half is
  // OBSERVED, and the last test below replays it. The set this refresh committed
  // (2026-09-26-pilot-8) is no longer the committed one: its Admin approval was
  // superseded the same day by 9ec02fe (below). Every test here therefore selects
  // pilot-8 explicitly from its retained receipt, as the older blocks do for theirs.
  const beforeDocs32 = () => withApproved({ admin: B24_ADMIN, setId: SET_0926B_ID, adminServes: DOCS32_ADMIN });
  // OBSERVED (runs 36270515216 and 36272139246): Admin serving abdacda under the set
  // that approved it.
  const refreshedDocs32 = () => withApproved({ admin: DOCS32_ADMIN, setId: SET_0926C_ID, adminServes: DOCS32_ADMIN });

  test('CONTRACT: the pin it approved is the receipt produced by peer-receipt at abdacda and independently re-derived on 2026-09-26, retained as history', () => {
    const admin = committedReceiptEntry('admin', DOCS32_ADMIN);
    assert.equal(admin.digest, 'sha256:18b256ce34bf5adef1143fd84450221187920de682f1ba1a7cd1ed8a3fb1e142');
    assert.equal(admin.receipt.tree, 'f063b6da8c9c280187d99a750ac3d353ca854dc6');
    assert.deepEqual(admin.receipt.contracts, {}, 'Admin is identity-only: no protocol is assumed');
    assert.equal(admin.receipt.publishes, null);
    assert.deepEqual(admin.receipt.unavailable, []);
    const previous = committedReceiptEntry('admin', B24_ADMIN);
    assert.deepEqual(admin.receipt.sources, previous.receipt.sources,
      '#32 did not touch deploy.yml: the receipt-bearing blob is byte-identical (3644dcd)');
    assert.notEqual(admin.receipt.tree, previous.receipt.tree, 'the source did change elsewhere (two documentation files) — a different revision, not a relabel');
    assert.notEqual(admin.digest, previous.digest);
    assert.notEqual(ADMIN, DOCS32_ADMIN, 'superseded on 2026-09-26 by 9ec02fe — no longer the approved Admin revision');
    assert.equal(BACKEND, 'a6b25a619d572c8de68964ab9ca4b4c2ae9ebe0b', 'this refresh did not move the backend approval');
  });

  test('CONTRACT (constructed serving): under pilot-7 an observed abdacda was refused as unapproved — seven reasons, and not a wait', () => {
    const { policy, peers } = beforeDocs32();
    const decision = decidePure({ policy, peers });
    assert.equal(decision.decision, 'REFUSE');
    assert.equal(decision.allow, false);
    assert.deepEqual(codesOf(decision), [...CI_REFUSAL_36247543634].sort(),
      'the same seven reasons the previous Admin promotion produced: an Admin promotion, and nothing else, moved');
    const admin = decision.reasons.find((r) => r.code === 'peers.admin_serving_unapproved');
    assert.equal(admin.detail, `admin serves ${DOCS32_ADMIN}, which is not in compatible set ${SET_0926B_ID}`);
    const r = classifyWith({ policy, peers, decision });
    assert.notEqual(r.kind, AWAITING);
    assert.equal(r.published, false);
    assert.deepEqual(r.problems.map((p) => p.code), ['readiness.unexpected_reason']);
  });

  test('CONTRACT: with every other fact held fixed, the refresh removed peers.admin_serving_unapproved and nothing else', () => {
    const before = codesOf(decidePure(beforeDocs32()));
    const after = codesOf(decidePure(refreshedDocs32()));
    assert.deepEqual(before.filter((c) => !after.includes(c)), ['peers.admin_serving_unapproved']);
    assert.deepEqual(after.filter((c) => !before.includes(c)), [], 'the refresh introduced no new compatibility problem');
    assert.ok(after.includes('peers.backend_serving_unverified'), 'a source receipt is not serving evidence — B3 still stands');
    assert.equal(before.length, 7);
    assert.equal(after.length, 6);
    assert.deepEqual(after, [...POLICY.publication.readiness.awaiting].sort(), 'what remained was exactly the recorded wait, nothing hidden');
  });

  test('CONTRACT: once it was committed, the six commissioning conditions were a completed, non-publishing wait — REFUSE, allow:false, published:false — and runs 36270515216 and 36272139246 recorded exactly that decision', () => {
    const { policy, peers } = refreshedDocs32();
    const decision = decidePure({ policy, peers });
    assert.equal(decision.decision, 'REFUSE');
    assert.equal(decision.allow, false);
    assert.equal(digestOfValue(decision), CI_WAIT_DIGEST_PILOT8,
      'the whole decision — reason order and every detail — is the one both CI readiness records bound');
    for (const enablement of ['', 'false']) {
      const r = classifyWith({ policy, peers, decision, enablement });
      assert.equal(r.kind, AWAITING, JSON.stringify(r.problems));
      assert.equal(r.evaluationCompleted, true);
      assert.equal(r.decision, 'REFUSE');
      assert.equal(r.allow, false);
      assert.equal(r.published, false);
      assert.equal(r.decisionDigest, CI_WAIT_DIGEST_PILOT8);
    }
  });
});

describe('the 2026-09-26 receipt refresh (Admin 9ec02fe, the #33/#34 Claude workflows) — replayed against what CI observed', () => {
  // Admin #33 and #34 (the two Claude Code workflows, a vendored review plugin, and a
  // narrowed COMMENT in deploy.yml's header) merged as 9ec02fe; Deploy Admin run
  // 36273633936 finished promoting it at 21:40:17Z (a deployment record). The frontend
  // readiness run 36273728448 (job 108492367222, on 44c4fc3) then read the identity,
  // logged 9ec02fe serving, and refused peers.admin_serving_unapproved under pilot-8 —
  // not-a-waiting-state, publisher skipped. This is an OBSERVED refusal, replayed below as
  // a whole value; the remedy is this reviewed receipt, never a waiting entry.
  const beforeClaude34 = () => withApproved({ admin: DOCS32_ADMIN, setId: SET_0926C_ID, adminServes: CLAUDE34_ADMIN });
  // OBSERVED: Admin serving 9ec02fe — the literal commit, NOT servingApproved(), so this
  // block cannot pass by reading whatever a different policy approves.
  const servingClaude34 = () => recordedPeers({ adminServes: CLAUDE34_ADMIN });

  test('CONTRACT: the committed pin is the receipt produced by peer-receipt at 9ec02fe and independently re-derived on 2026-09-26', () => {
    assert.equal(ADMIN, CLAUDE34_ADMIN);
    assert.equal(POLICY.compatibleSet.id, SET_0926D_ID);
    const approved = POLICY.compatibleSet.peers.admin.approved;
    assert.equal(approved.length, 1, 'the previous Admin revision is replaced, not kept approved beside it');
    const admin = committedReceiptEntry('admin', ADMIN);
    assert.equal(admin.digest, 'sha256:f396dc77139cc1a6dc2247f8ed40c4ec07fd86532e881c50b0575c33bf37cce7');
    assert.equal(approved[0].receiptDigest, admin.digest);
    assert.equal(admin.receipt.tree, '7f27fdd31dbcd2b57e1a370a6b7db2c87015393f');
    assert.deepEqual(admin.receipt.sources, [
      { name: 'deployWorkflow', path: '.github/workflows/deploy.yml', blob: '2618d1ee627008c2534f006d5528106f249a3243' },
    ]);
    assert.deepEqual(admin.receipt.contracts, {}, 'Admin is identity-only: no protocol is assumed');
    assert.equal(admin.receipt.publishes, null);
    assert.deepEqual(admin.receipt.unavailable, []);
    const previous = committedReceiptEntry('admin', DOCS32_ADMIN);
    assert.notEqual(admin.receipt.sources[0].blob, previous.receipt.sources[0].blob,
      'the receipt-bearing deploy.yml blob DID change (#33 narrowed a header comment, 3644dcd -> 2618d1e): the receipt is re-derived, never copied from #32');
    assert.equal(admin.receipt.sources[0].path, previous.receipt.sources[0].path, 'the same file is what the receipt binds');
    assert.notEqual(admin.receipt.tree, previous.receipt.tree);
    assert.notEqual(admin.digest, previous.digest);
    assert.equal(BACKEND, 'a6b25a619d572c8de68964ab9ca4b4c2ae9ebe0b', 'this refresh does not move the backend approval');
  });

  test('CONTRACT: the pilot-8 set, replayed with CI\'s observation, reproduces run 36273728448\'s decision byte for byte — and it was not a wait', () => {
    const { policy, peers } = beforeClaude34();
    const decision = decidePure({ policy, peers });
    assert.equal(decision.decision, 'REFUSE');
    assert.equal(decision.allow, false);
    assert.deepEqual(codesOf(decision), [...CI_REFUSAL_36273728448].sort());
    assert.deepEqual([...CI_REFUSAL_36273728448].sort(), [...CI_REFUSAL_36247543634].sort(),
      'the same seven reasons as the previous observed refusal: an Admin promotion, and nothing else, moved');
    const admin = decision.reasons.find((r) => r.code === 'peers.admin_serving_unapproved');
    assert.equal(admin.detail, `admin serves ${CLAUDE34_ADMIN}, which is not in compatible set ${SET_0926C_ID}`, 'byte for byte the detail the CI log printed');
    assert.equal(digestOfValue(decision), CI_DECISION_DIGEST_36273728448,
      'the whole decision — reason order and every detail — is the one the CI readiness record bound');
    const r = classifyWith({ policy, peers, decision });
    assert.notEqual(r.kind, AWAITING);
    assert.equal(r.published, false);
    assert.equal(r.decisionDigest, CI_DECISION_DIGEST_36273728448);
    assert.deepEqual(r.problems.map((p) => p.code), ['readiness.unexpected_reason'], 'the unapproved Admin is its ONE unexpected reason');
    assert.equal(r.problems[0].detail, `peers.admin_serving_unapproved: ${admin.detail}`);
  });

  test('CONTRACT: with every other fact held fixed, the refresh removes peers.admin_serving_unapproved and nothing else', () => {
    const before = codesOf(decidePure(beforeClaude34()));
    const after = codesOf(decidePure({ peers: servingClaude34() }));
    assert.deepEqual(before.filter((c) => !after.includes(c)), ['peers.admin_serving_unapproved']);
    assert.deepEqual(after.filter((c) => !before.includes(c)), [], 'the refresh introduced no new compatibility problem');
    assert.ok(after.includes('peers.backend_serving_unverified'), 'a source receipt is not serving evidence — B3 still stands');
    assert.equal(before.length, 7);
    assert.equal(after.length, 6);
    assert.deepEqual(after, [...POLICY.publication.readiness.awaiting].sort(), 'what remains is exactly the recorded wait, nothing hidden');
  });

  test('CONTRACT: through the real decide command, the six commissioning conditions are a completed, non-publishing wait — REFUSE, allow:false, published:false', async () => {
    const { status, decision } = await decideCommitted({ peers: servingClaude34() });
    assert.equal(status, 1, 'the decision itself still refuses and exits non-zero');
    assert.equal(decision.decision, 'REFUSE');
    assert.equal(decision.allow, false);
    assert.equal(digestOfValue(decidePure({ peers: servingClaude34() })), CI_WAIT_DIGEST_PILOT8,
      'the refresh returns the gate to the very decision CI last recorded as the wait (runs 36270515216 and 36272139246) — not a new or wider one');
    for (const enablement of ['', 'false']) {
      const r = classifyWith({ peers: servingClaude34(), decision, enablement });
      assert.equal(r.kind, AWAITING, JSON.stringify(r.problems));
      assert.equal(r.evaluationCompleted, true);
      assert.equal(r.decision, 'REFUSE');
      assert.equal(r.allow, false);
      assert.equal(r.published, false);
    }
  });

  test('REGRESSION: an Admin revision the set does not approve is refused and is NOT a wait — the just-superseded abdacda, the retired a7ef20c, eb54c92, 1993a08, 3521ebd and 38df037, the deployed-but-never-approved ad4a7f8, or any later one', () => {
    for (const serves of [DOCS32_ADMIN, B24_ADMIN, B23_ADMIN, CI_OBSERVED_ADMIN_0925, CI_OBSERVED_ADMIN, PREVIOUS_ADMIN, DEPLOYED_NEVER_APPROVED_ADMIN, 'a'.repeat(40)]) {
      const peers = recordedPeers({ adminServes: serves });
      const decision = decidePure({ peers });
      const reason = decision.reasons.find((r) => r.code === 'peers.admin_serving_unapproved');
      assert.ok(reason, `${serves}: ${JSON.stringify(codesOf(decision))}`);
      assert.equal(reason.detail, `admin serves ${serves}, which is not in compatible set ${SET_0926D_ID}`);
      const r = classifyWith({ peers, decision });
      assert.notEqual(r.kind, AWAITING, serves);
      assert.deepEqual(r.problems.map((p) => p.code), ['readiness.unexpected_reason'], serves);
    }
  });

  test('REGRESSION: the approved Admin evidence, broken one fact at a time, is refused and is never a wait', () => {
    const relabel = (commit) => (p) => {
      const r = clone(committedReceiptEntry('admin', commit).receipt);
      r.commit = ADMIN;
      p.receipts.admin[0] = { ...p.receipts.admin[0], receipt: r, digest: receiptDigest(r) };
    };
    const edit = (change) => (p) => { const r = clone(p.receipts.admin[0].receipt); change(r); p.receipts.admin[0] = { ...p.receipts.admin[0], receipt: r, digest: receiptDigest(r) }; };
    const cases = {
      'receipt tree edited': ['peers.receipt_mismatch', edit((r) => { r.tree = 'f'.repeat(40); })],
      'deploy.yml blob edited (wrong source blob)': ['peers.receipt_mismatch', edit((r) => { r.sources[0].blob = 'c1a5e7c9080cd96eda820cd9dcdf6e31664417c4'; })],
      'deploy.yml blob edited back to the pre-#33 one (3644dcd)': ['peers.receipt_mismatch', edit((r) => { r.sources[0].blob = '3644dcdb864d788997446946afc75d092dce3f33'; })],
      'receipt about another revision': ['peers.receipt_wrong_revision', edit((r) => { r.commit = DOCS32_ADMIN; })],
      'the just-superseded abdacda receipt, relabelled as the approved one (tree f063b6d, blob 3644dcd)': ['peers.receipt_mismatch', relabel(DOCS32_ADMIN)],
      'the older a7ef20c receipt, relabelled as the approved one (tree a9f9846)': ['peers.receipt_mismatch', relabel(B24_ADMIN)],
      'receipt file missing': ['peers.receipt_missing', (p) => { p.receipts.admin[0] = { commit: ADMIN, path: receiptPath('admin', ADMIN), present: false }; }],
      'receipt file unreadable': ['peers.receipt_unreadable', (p) => { p.receipts.admin[0] = { commit: ADMIN, path: receiptPath('admin', ADMIN), present: true, readable: false, detail: 'Unexpected token' }; }],
      'public re-derivation disagrees (deploy.yml blob)': ['peers.admin_receipt_unverified', (p) => { p.verification.admin[ADMIN] = { state: 'mismatch', detail: '.github/workflows/deploy.yml: 3644dcdb864d788997446946afc75d092dce3f33 != 2618d1ee627008c2534f006d5528106f249a3243' }; }],
      'public re-derivation unavailable': ['peers.admin_receipt_unverified', (p) => { p.verification.admin[ADMIN] = { state: 'unavailable', detail: 'HTTP 502' }; }],
      'served identity unreadable': ['peers.admin_serving_unreadable', (p) => { p.serving.admin = { state: 'unreadable', detail: 'CONNECT refused' }; }],
      'served identity cacheable': ['peers.admin_serving_cacheable', (p) => { p.serving.admin = { ...p.serving.admin, noStore: false, cacheControl: 'public, max-age=300' }; }],
    };
    for (const [label, [code, breakIt]] of Object.entries(cases)) {
      const peers = servingClaude34();
      breakIt(peers);
      const decision = decidePure({ peers });
      assert.ok(codesOf(decision).includes(code), `${label}: ${JSON.stringify(codesOf(decision))}`);
      assert.equal(decision.allow, false, label);
      assert.notEqual(classifyWith({ peers, decision }).kind, AWAITING, label);
    }
    // And the other direction: an intact file whose digest the POLICY does not pin.
    const policy = clone(POLICY);
    policy.compatibleSet.peers.admin.approved[0].receiptDigest = `sha256:${'0'.repeat(64)}`;
    const decision = decidePure({ policy, peers: servingClaude34() });
    assert.ok(codesOf(decision).includes('peers.receipt_mismatch'), JSON.stringify(codesOf(decision)));
    assert.ok(!codesOf(decision).includes('peers.admin_serving_unapproved'), 'isolated: not refused for serving');
    assert.equal(decision.allow, false);
    assert.notEqual(classifyWith({ policy, peers: servingClaude34(), decision }).kind, AWAITING);
  });

  test('REGRESSION: a blocking or incomplete dependency assessment stays red beside the refreshed receipt — the source approval bypasses nothing', () => {
    for (const [outcome, code] of [['blocking', 'dependency.assessment_blocking'], ['incomplete', 'dependency.assessment_incomplete']]) {
      const input = baseline();
      const dependencies = dependenciesFor({
        manifest: input.artifact.manifest,
        evidence: input.artifact.dependencyEvidence,
        assessment: assessmentFor({ manifest: input.artifact.manifest, evidence: input.artifact.dependencyEvidence, tooling: input.dependencies.tooling, outcome }),
      });
      const peers = servingClaude34();
      const decision = decidePure({ peers, dependencies });
      const codes = codesOf(decision);
      assert.ok(codes.includes(code), `${outcome}: ${JSON.stringify(codes)}`);
      assert.ok(!codes.includes('peers.admin_serving_unapproved'), 'the Admin approval itself is not what refuses here');
      assert.equal(decision.decision, 'REFUSE');
      assert.equal(decision.allow, false);
      const r = classifyWith({ peers, decision });
      assert.notEqual(r.kind, AWAITING, outcome);
      assert.equal(r.published, false);
      assert.deepEqual(r.problems.map((p) => p.code), ['readiness.unexpected_reason'], outcome);
    }
  });

  test('REGRESSION: the approved backend receipt, edited without re-approval, is refused — and the missing serving identity still stands', () => {
    const peers = servingClaude34();
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

  test('CONTROL: the refresh moved no owner setting, no enablement, no backend, no Admin serving contract and no waiting entry — only the Admin approval and the set id', () => {
    assert.equal(POLICY.compatibleSet.id, SET_0926D_ID);
    assert.deepEqual([...POLICY.publication.readiness.awaiting].sort(), [
      'peers.backend_serving_unverified',
      ...PREREQUISITES,
      'served.bootstrap_unauthorized',
    ].sort(), 'no peers.admin_* entry, no wildcard, no new waiting reason');
    assert.ok(!POLICY.publication.readiness.awaiting.some((c) => c.startsWith('peers.admin')));
    assert.ok(!POLICY.publication.readiness.awaiting.some((c) => c.startsWith('dependency.')));
    assert.equal(POLICY.bootstrap.authorized, false);
    assert.equal(POLICY.bootstrap.servedBaseline, null);
    assert.deepEqual(POLICY.compatibleSet.peers.backend.approved.map((a) => a.commit), ['a6b25a619d572c8de68964ab9ca4b4c2ae9ebe0b']);
    assert.equal(POLICY.compatibleSet.peers.backend.serving.observation, 'unavailable');
    assert.deepEqual(POLICY.compatibleSet.peers.admin.serving, {
      observation: 'public-identity', origin: 'https://admin.dinifyapp.com', path: '/release.txt',
    }, '#33/#34 kept the identity this gate reads: the exact commit at /release.txt, no-store');
    assert.equal(POLICY.compatibleSet.peers.admin.receiptVerification, 'public-repository');
    assert.equal(POLICY.publication.enablementVariable, 'FRONTEND_PUBLISH_ENABLED');
  });
});
