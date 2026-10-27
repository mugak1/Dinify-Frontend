/**
 * THE COMMITTED POLICY, AS THE FIRST REAL RUN WILL MEET IT — AND EVERY COMPATIBLE SET BEFORE IT.
 *
 * Every other suite starts from `allowedPolicy()` — the committed file with three stated
 * differences — because a policy that refuses everything cannot demonstrate an allowed
 * case. This suite does the opposite: it runs the REAL `decide` command, which reads
 * release/policy.json from this checkout and nothing else, against an otherwise perfect
 * candidate, and pins the EXACT set of refusals the committed file produces. That set
 * is the list of what enabling this path still requires, and it must be the gate's own
 * output rather than a recollection.
 *
 * THE HISTORY IS DATA. release/peers/history.json carries one row per compatible set: what
 * it approved, the facts of each receipt it approved first, the backend serving note and
 * owner-prerequisite state its decisions printed, what its refresh moved and removed, the
 * revisions reviewed with it but never approved, and every decision pinned under it (or,
 * as `refused`, under the set before it), each with its digest and what kind of evidence it
 * is. The generic tests below replay every row through the pure decision rule; the last
 * row must equal the committed policy. A refresh adds a receipt, edits the policy, adds ONE
 * row, and leaves this file alone.
 *
 * WHAT EACH INPUT IS, stated because they are not all the same kind of evidence:
 *
 *   policy        the committed file, read by the CLI itself                 REAL
 *   receipts      release/peers/*.json, read exactly as `peer-facts` reads   REAL
 *   history       release/peers/history.json: which set approved what, and
 *                 every decision digest a readiness run bound (`recorded`) or
 *                 the rule computed (`constructed`, `synthetic`)            RECORDED
 *   hosting       the committed firebase.json + .firebaserc, resolved by
 *                 effectiveHosting() over the candidate's file list          REAL
 *   served        the committed firebase.json's `**` rewrite answering
 *                 /release.json for a build that carries none (deploy-prod.yml
 *                 does not stamp), read by the real `serve-state` adapter    DERIVED
 *   admin serving the DEFAULT serving input is the last history row's
 *                 `adminServingObserved`, with how it was observed beside it  RECORDED (CI)
 *   backend serving  unavailable, as the policy declares it: no verified
 *                 loaded-runtime identity; nothing here observes which backend
 *                 revision is live                                  POLICY
 *   legacy        whether deploy-prod.yml exists in THIS checkout            OBSERVED
 *   candidate     the fixture baseline's certification, artifact and source  FIXTURE
 *   dependencies  the fixture baseline's certification evidence, a PASSING
 *                 fresh assessment of it and the prepared toolchain (D08
 *                 B2.2) — held passing so that the refusal set is the OWNER
 *                 and PEER facts alone, except where a history row names a
 *                 recorded assessment; a failing assessment is never a wait
 *                 and is proved so in readiness.test.mjs and the simulation  FIXTURE
 *
 * The frontend's live /release.json was NOT observed from the environment this suite
 * was written in — its egress policy refuses dinify-prod.web.app — which is why that
 * input is derived, and why the second test shows the refusal set is the same in kind
 * if the origin answers something unreadable instead.
 */

import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { decide } from '../lib/decide.mjs';
import { effectiveHosting } from '../lib/hosting.mjs';
import { RECEIPT_SCHEMA, receiptDigest } from '../lib/peers.mjs';
import { contractDigest, digestOfValue } from '../lib/canonical.mjs';
import { AWAITING, classifyReadiness } from '../lib/readiness.mjs';
import { validatePolicy } from '../lib/policy.mjs';
import { POLICY, assessmentFor, baseline, clone, dependenciesFor } from './fixtures.mjs';
import { ROOT, cli, startOrigin, tempDir, writeDependencyInputs } from './harness.mjs';

const HISTORY_PATH = 'release/peers/history.json';
const HISTORY = JSON.parse(readFileSync(join(ROOT, HISTORY_PATH), 'utf8'));
const SETS = HISTORY.sets;
// The 2026-10-27 source-protection record: the owner state history.json names after R-1, and
// the one wait it resolved.
const SP = 'source-protection-recorded';
const SP_RESOLVES = 'prerequisite.source_protection_unrecorded';
// The two response digests the SP-1 observation recorded on 2026-10-15. The 2026-10-27
// re-read replaced the date and both digests together, and both came back byte-identical.
const SP1_RESPONSE_DIGESTS_2026_10_15 = Object.freeze({
  'GET /repos/mugak1/Dinify-Frontend/rulesets/15107355': 'sha256:5c9fbd7188ecb0021ef94d7df69817f77b1f16894c377d909725e3286fb4d250',
  'GET /repos/mugak1/Dinify-Frontend/rules/branches/main': 'sha256:56cdcfdb7dead41b71bb442563ebbea41be6e0533d8832464dde3399eb566dff',
});
const CURRENT = SETS.at(-1);
const PEERS = ['admin', 'backend'];
const EVIDENCE = ['recorded', 'constructed', 'synthetic'];
const PRODUCER = { tool: 'release/cli.mjs peer-receipt', revision: 1 };

const ADMIN = POLICY.compatibleSet.peers.admin.approved[0].commit;
const BACKEND = POLICY.compatibleSet.peers.backend.approved[0].commit;
const short = (commit) => String(commit ?? 'none').slice(0, 7);

const previousRow = (row) => SETS[SETS.indexOf(row) - 1];
const awaitingOf = (state) => HISTORY.ownerStates[state].overrides['publication.readiness.awaiting'];
const servingReasonOf = (row) => HISTORY.backendServingReasons[row.backendServingReason];
const receiptFacts = (commit) => SETS.flatMap((r) => r.receipts).find((r) => r.commit === commit);
/** The decision a row's approved Admin revision receives under one of its owner states, with
 *  a passing assessment: that set's wait (or, for a set whose backend cannot be compatible,
 *  its standing refusal). Every row records one per owner state. */
const standing = (row, state) => row.decisions.find((d) => d.adminServes === row.approved.admin && d.ownerState === state && !d.assessment);
/** The most recent revision a peer had approved before the current one — what a rollback
 *  to the last-known-good revision would name, and what a half-applied edit leaves behind. */
function previousApproval(peer) {
  const current = CURRENT.approved[peer];
  return [...SETS].reverse().map((r) => r.approved[peer]).find((c) => c !== current);
}
const SUPERSEDED_ADMIN = previousApproval('admin');
const PREVIOUS_BACKEND = previousApproval('backend');

// The first backend revision ever approved (the #330 merge, in the first history row). It
// predates the capability export; its receipt is retained under release/peers/ as history and
// is no longer approved, and the negative controls below select it deliberately.
const HISTORICAL_BACKEND = SETS[0].approved.backend;
const HISTORICAL_RECEIPT_PATH = `release/peers/backend-${HISTORICAL_BACKEND}.json`;

// The default Admin serving input: what the last history row records as observed serving —
// what the next real run is expected to meet.
const LIVE_ADMIN_OBSERVED = CURRENT.adminServingObserved?.commit;

/** Every Admin revision the history names: each approval, each revision reviewed with a set
 *  and never approved, and each one a recorded decision saw serving. */
const KNOWN_ADMIN_REVISIONS = [...new Set(SETS.flatMap((r) => [
  r.approved.admin,
  ...r.notApproved.map((n) => n.commit),
  ...[...(r.refused ?? []), ...r.decisions].map((d) => d.adminServes),
]))];

const PRE_R1 = 'before-R-1';
const R1 = 'R-1';
// The pre-R-1 awaiting list, and what R-1 leaves: the same list without the retention entry.
const PRE_RETENTION_AWAITING = Object.freeze([...awaitingOf(PRE_R1)]);
const R1_REMAINING_WAIT = Object.freeze(PRE_RETENTION_AWAITING.filter((c) => c !== 'prerequisite.retention_unverified'));
// The row whose id spans R-1: committed before it, and still the set when R-1 landed.
const R1_ROW = SETS.find((r) => r.ownerStates.includes(PRE_R1) && r.ownerStates.includes(R1));
/** The digest of the most recent wait recorded under an owner state (the decision names no
 *  Admin commit or set, so it is the same for every approved serving revision). */
const latestWaitDigest = (state) => [...SETS].reverse().map((r) => standing(r, state)).find(Boolean).decisionDigest;

function setPath(object, path, value) {
  const keys = path.split('.');
  let at = object;
  for (const key of keys.slice(0, -1)) at = at[key];
  at[keys.at(-1)] = clone(value);
}
function applyOwnerState(policy, state) {
  for (const [path, value] of Object.entries(HISTORY.ownerStates[state].overrides)) setPath(policy, path, value);
  return policy;
}
/** A copy of `policy` (default: the committed one) with the pre-R-1 owner state restored,
 *  as history.json records it: retention unverified, and (being before the source-protection
 *  record too) source protection unrecorded. Nothing else is touched. */
const preRetentionPolicy = (policy = POLICY) => applyOwnerState(clone(policy), PRE_R1);
/** A copy of `policy` (default: the committed one) in the R-1 owner state, the one the
 *  source-protection record was made from: retention verified, source protection
 *  unrecorded, the five-entry list. Nothing else is touched. */
const r1Policy = (policy = POLICY) => applyOwnerState(clone(policy), R1);

const receiptPath = (peer, commit) => `release/peers/${peer}-${commit}.json`;
const receiptFiles = new Map();
function committedReceiptEntry(peer, commit) {
  const path = receiptPath(peer, commit);
  if (!receiptFiles.has(path)) receiptFiles.set(path, JSON.parse(readFileSync(join(ROOT, path), 'utf8')));
  const receipt = clone(receiptFiles.get(path));
  return { commit, path, present: true, readable: true, receipt, digest: receiptDigest(receipt) };
}

/**
 * THE SET A HISTORY ROW DESCRIBES, as a policy: the committed policy with that row's set id,
 * its approvals (pinned by the digests the row records), the backend serving note its
 * decisions printed and the named owner-prerequisite state. `approved` and `servingReason`
 * vary one fact while holding the rest; the last row, under its last state, is the committed
 * policy itself.
 */
function snapshot(row, state, { approved = row.approved, servingReason = servingReasonOf(row) } = {}) {
  const policy = applyOwnerState(clone(POLICY), state);
  policy.compatibleSet.id = row.id;
  policy.compatibleSet.peers.backend.serving.reason = servingReason;
  for (const peer of PEERS) {
    const commit = approved[peer];
    policy.compatibleSet.peers[peer].approved = [{ commit, receipt: receiptPath(peer, commit), receiptDigest: receiptFacts(commit).receiptDigest }];
  }
  return policy;
}

/** Peer facts for a policy's approved revisions, read from the committed receipt files, with
 *  the approved Admin publicly re-derived and Admin serving `adminServes`, no-store. */
function peersFor(policy, adminServes) {
  const receipts = {};
  for (const peer of PEERS) receipts[peer] = policy.compatibleSet.peers[peer].approved.map((a) => committedReceiptEntry(peer, a.commit));
  const admin = policy.compatibleSet.peers.admin.approved[0].commit;
  return {
    receipts,
    verification: { admin: { [admin]: { state: 'verified', detail: '' } } },
    serving: { admin: { state: 'known', commit: adminServes, noStore: true, cacheControl: 'no-store' } },
  };
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

/** Peer facts as the committed receipts state them. Serving defaults to the Admin revision
 *  the last history row records as observed serving. */
function recordedPeers({ adminServes = LIVE_ADMIN_OBSERVED } = {}) {
  return {
    receipts: committedReceipts(),
    verification: { admin: { [ADMIN]: { state: 'verified', detail: '' } } },
    serving: { admin: { state: 'known', commit: adminServes, noStore: true, cacheControl: 'no-store' } },
  };
}

/** Admin serving whichever revision the policy approves. Tests that must stay independent
 *  of the observation use it. */
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

// The owner prerequisites the COMMITTED policy still refuses. Since R-1 retention is
// verified, and since the 2026-10-27 source-protection record source protection is
// recorded, so that is two: both name the legacy writer, which the cutover retires. A replay
// of an earlier set reads its owner state instead.
const PREREQUISITES = [
  'prerequisite.legacy_publisher_active',
  'prerequisite.legacy_publisher_present',
];

/**
 * The PURE decision over exactly the inputs `decideCommitted` hands the CLI, with the
 * policy as an argument — so a single fact (which receipt is approved) can be varied while
 * every other fact is held fixed. The CLI cannot do that by design: it reads only the
 * committed file. The first comparison test proves this function and the CLI agree on the
 * committed policy, so the comparison is not against a different rule.
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

/** A fresh assessment a history row names (e.g. the BLOCKING one readiness run 40128009591
 *  completed), with its headline — which `decide` prints verbatim as the reason's detail —
 *  from the record. The rest of the assessment is the fixture's, as in every other replay. */
function recordedDependencies(name) {
  const { outcome, headline } = HISTORY.assessments[name];
  const input = baseline();
  const assessment = assessmentFor({
    manifest: input.artifact.manifest, evidence: input.artifact.dependencyEvidence, tooling: input.dependencies.tooling, outcome,
  });
  assessment.doc.headline = headline;
  assessment.digest = digestOfValue(assessment.doc);
  return dependenciesFor({ manifest: input.artifact.manifest, evidence: input.artifact.dependencyEvidence, tooling: input.dependencies.tooling, assessment });
}

/** Replays one pinned decision under the set `row` describes. */
function replay(row, d, options = {}) {
  const policy = snapshot(row, d.ownerState, options);
  const peers = peersFor(policy, d.adminServes);
  const decision = decidePure({ policy, peers, dependencies: d.assessment ? recordedDependencies(d.assessment) : undefined });
  return { policy, peers, decision };
}

/** The committed policy and peer facts with ONE change: the approved backend is the
 *  retained historical receipt, read from its committed file. */
function withHistoricalBackend(base = POLICY) {
  const receipt = JSON.parse(readFileSync(join(ROOT, HISTORICAL_RECEIPT_PATH), 'utf8'));
  const policy = clone(base);
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

  test(`CONTRACT: as observed (Admin serving ${short(LIVE_ADMIN_OBSERVED)}, approved in ${CURRENT.id}), an otherwise perfect candidate is refused for the four outstanding facts alone — and that IS the recorded, non-publishing wait`, async () => {
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
      // SELECTION IS NOT SERVING. The approved backend publishes its capability export,
      // so peers.capabilities_unpublished stays gone — but which backend revision is LIVE
      // is still unobservable until B3, and a successful deployment log is not accepted in
      // place of a serving identity.
      'peers.backend_serving_unverified',
      ...PREREQUISITES,
      'served.bootstrap_unauthorized',
    ].sort());
    const detail = (code) => decision.reasons.find((r) => r.code === code).detail;
    assert.match(detail('peers.backend_serving_unverified'), /^no verified loaded-runtime identity of the backend is available \(B3\)/);
    assert.doesNotMatch(detail('peers.backend_serving_unverified'), /publishes no served-revision identity/,
      'pilot-12 corrected the note: an identity endpoint exists in the source, a verified loaded-runtime identity does not');
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
    assert.equal(POLICY.compatibleSet.id, CURRENT.id);
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

describe('the history file itself — one row per compatible set, the last row the committed set', () => {
  test('CONTRACT: the committed policy IS the last history row, under its last owner state — set id, both approvals with their receipt paths and digests, the backend serving note and the owner state', () => {
    assert.equal(CURRENT.id, POLICY.compatibleSet.id);
    assert.deepEqual(snapshot(CURRENT, CURRENT.ownerStates.at(-1)), POLICY);
    for (const peer of PEERS) {
      assert.equal(POLICY.compatibleSet.peers[peer].approved.length, 1, `exactly one approved ${peer} revision: an approval is REPLACED, never joined`);
      assert.equal(POLICY.compatibleSet.peers[peer].approved[0].commit, CURRENT.approved[peer]);
    }
    assert.equal(ADMIN, CURRENT.approved.admin);
    assert.equal(BACKEND, CURRENT.approved.backend);
    assert.ok(/^[0-9a-f]{40}$/.test(LIVE_ADMIN_OBSERVED ?? ''), 'the last row records which Admin revision was observed serving');
  });

  test('STRUCTURE: the rows are every set from the first that approved a revision (pilot-2; pilot-1 approved none), consecutive and in date order, each well-formed', () => {
    const ids = SETS.map((r) => /^(\d{4}-\d{2}-\d{2})-pilot-(\d+)$/.exec(r.id));
    assert.ok(ids.every(Boolean), JSON.stringify(SETS.map((r) => r.id)));
    assert.deepEqual(ids.map((m) => Number(m[2])), SETS.map((_, i) => i + 2), 'no set is missing and none is repeated');
    assert.deepEqual(ids.map((m) => m[1]), ids.map((m) => m[1]).sort(), 'dates never go backwards');
    assert.equal(HISTORY.schema, 'dinify.release.compatible-set-history/1');
    for (const row of SETS) {
      const at = row.id;
      assert.deepEqual(Object.keys(row.approved).sort(), [...PEERS].sort(), at);
      for (const peer of PEERS) assert.match(row.approved[peer], /^[0-9a-f]{40}$/, at);
      assert.ok(Object.hasOwn(HISTORY.backendServingReasons, row.backendServingReason), at);
      assert.ok(row.ownerStates.length > 0 && row.ownerStates.every((s) => Object.hasOwn(HISTORY.ownerStates, s)), at);
      for (const state of row.ownerStates) assert.ok(standing(row, state), `${at}: no decision for its approved Admin under ${state}`);
      const previous = previousRow(row);
      for (const [list, states] of [[row.decisions, row.ownerStates], [row.refused ?? [], previous?.ownerStates ?? []]]) {
        for (const d of list) {
          assert.ok(states.includes(d.ownerState), `${at}: ${d.adminServes} under ${d.ownerState}`);
          assert.ok(EVIDENCE.includes(d.evidence), `${at}: evidence ${d.evidence}`);
          assert.equal(Boolean(d.runs?.length), d.evidence === 'recorded', `${at}: runs are named exactly for recorded decisions`);
          if (d.decisionDigest === null) assert.equal(d.evidence, 'recorded', `${at}: only a recorded decision may leave its digest unpinned`);
          else assert.match(d.decisionDigest, /^sha256:[0-9a-f]{64}$/, at);
          assert.deepEqual(d.unexpected, [...new Set(d.unexpected)].sort(), `${at}: unexpected is sorted and unique`);
          if (d.assessment) assert.ok(Object.hasOwn(HISTORY.assessments, d.assessment), at);
        }
      }
      if (!previous) {
        assert.ok(!row.refused && !row.moved && !row.removes, `${at}: the first set had no predecessor`);
        continue;
      }
      const moved = PEERS.filter((p) => row.approved[p] !== previous.approved[p]);
      assert.deepEqual(row.moved, moved, `${at}: moved is exactly the peers whose approval changed`);
      assert.ok(Array.isArray(row.removes), at);
      if (moved.length > 1) assert.deepEqual(Object.keys(row.attribution ?? {}).sort(), [...moved].sort(), `${at}: a refresh that moved several peers attributes its effect peer by peer`);
      else assert.equal(row.attribution, undefined, at);
      if (moved.includes('admin')) assert.ok((row.refused ?? []).some((d) => d.adminServes === row.approved.admin), `${at}: the refusal the new Admin revision met under ${previous.id} is recorded`);
    }
  });

  test('STRUCTURE: every receipt is declared once, in the row that first approved it, and never-approved revisions are approved nowhere', () => {
    const declared = SETS.flatMap((r) => r.receipts.map((x) => ({ row: r, ...x })));
    assert.equal(new Set(declared.map((x) => x.commit)).size, declared.length, 'no receipt is declared twice');
    for (const row of SETS) {
      for (const peer of PEERS) {
        const facts = receiptFacts(row.approved[peer]);
        assert.ok(facts, `${row.id}: ${peer} ${row.approved[peer]} has no receipt facts`);
        assert.equal(facts.peer, peer);
        const first = SETS.find((r) => r.approved[peer] === row.approved[peer]);
        assert.ok(first.receipts.includes(facts), `${row.id}: ${short(row.approved[peer])} is declared where it was first approved (${first.id})`);
      }
      for (const x of row.receipts) assert.equal(row.approved[x.peer], x.commit, `${row.id} declares a receipt it does not approve`);
      for (const n of row.notApproved) {
        assert.ok(!SETS.some((r) => PEERS.some((p) => r.approved[p] === n.commit)), `${n.commit} is never approved`);
        assert.notEqual(n.commit, row.approved.admin);
        if (n.tree !== undefined) assert.match(n.tree, /^[0-9a-f]{40}$/);
      }
    }
  });
});

describe('the receipts the history approves — release/peers/, byte for byte', () => {
  test('CONTRACT: every receipt under release/peers/ is one the history declares, and the history file is the only other file there — a retained receipt is never deleted', () => {
    const files = readdirSync(join(ROOT, 'release/peers')).sort();
    const declared = SETS.flatMap((r) => r.receipts).map((x) => `${x.peer}-${x.commit}.json`);
    assert.deepEqual(files.filter((f) => f !== 'history.json'), [...declared].sort());
    assert.ok(files.includes('history.json'));
  });

  for (const row of SETS) {
    for (const facts of row.receipts) {
      test(`CONTRACT: ${facts.peer} ${short(facts.commit)} (approved first in ${row.id}) is the receipt peer-receipt produced — digest, revision, tree and source blobs as recorded`, () => {
        const { receipt, digest } = committedReceiptEntry(facts.peer, facts.commit);
        assert.equal(digest, facts.receiptDigest);
        assert.equal(receipt.schema, RECEIPT_SCHEMA);
        assert.equal(receipt.peer, facts.peer);
        assert.equal(receipt.repository, POLICY.compatibleSet.peers[facts.peer].repository);
        assert.equal(receipt.commit, facts.commit, 'the approval is the MERGE commit it names');
        assert.equal(receipt.tree, facts.tree);
        assert.deepEqual(receipt.sources, facts.sources);
        assert.deepEqual(receipt.producer, PRODUCER, 'produced by the existing command, not hand-authored');
        if (facts.peer === 'admin') {
          assert.deepEqual(receipt.contracts, {}, 'Admin is identity-only: no protocol is assumed');
          assert.equal(receipt.publishes, null);
          assert.deepEqual(receipt.unavailable, []);
        } else {
          assert.deepEqual(receipt.publishes, facts.publishes);
          assert.deepEqual(receipt.unavailable, facts.publishes === null ? ['publishedCapabilities'] : []);
          const d01 = receipt.contracts.d01CheckoutLimits;
          assert.equal(d01.digest, contractDigest(d01.values), 'the D01 digest is the one its own values compose');
        }
        for (const n of row.notApproved) {
          assert.notEqual(receipt.commit, n.commit, 'not a PR head or an intermediate merge it was reviewed with');
          assert.ok(!existsSync(join(ROOT, receiptPath(facts.peer, n.commit))), `${n.commit} has no receipt: it was never approved`);
          if (n.tree === facts.tree) assert.notEqual(n.commit, facts.commit, 'the same tree, a different commit');
          else if (n.tree !== undefined) assert.notEqual(n.tree, facts.tree);
        }
      });
    }
  }

  test('CONTRACT: each peer\'s successive approvals are different revisions, not relabels — and an unchanged export or deploy file states exactly what it stated before', () => {
    for (const peer of PEERS) {
      const approvals = SETS.map((r) => r.approved[peer]).filter((c, i, all) => i === 0 || c !== all[i - 1]);
      for (let i = 1; i < approvals.length; i++) {
        const [prev, next] = [committedReceiptEntry(peer, approvals[i - 1]), committedReceiptEntry(peer, approvals[i])];
        const at = `${peer} ${short(prev.commit)} -> ${short(next.commit)}`;
        assert.notEqual(next.receipt.tree, prev.receipt.tree, `${at}: the source changed — a different revision, not a relabel`);
        assert.notEqual(next.digest, prev.digest, at);
        assert.deepEqual(next.receipt.sources.map((s) => [s.name, s.path]), prev.receipt.sources.map((s) => [s.name, s.path]), `${at}: the same files are what the receipt binds`);
        for (const [k, source] of next.receipt.sources.entries()) {
          if (source.blob === null || source.blob !== prev.receipt.sources[k].blob) continue;
          // An unchanged export file states the same contract (D01 since 9448f55; both
          // exports through #332-#338 and #339-#350).
          if (source.name === 'd01CheckoutLimits') assert.deepEqual(next.receipt.contracts.d01CheckoutLimits, prev.receipt.contracts.d01CheckoutLimits, at);
          if (source.name === 'publishedCapabilities') assert.deepEqual(next.receipt.publishes, prev.receipt.publishes, at);
        }
      }
    }
  });
});

describe('the compatible-set history, replayed set by set', () => {
  for (const row of SETS) {
    const previous = previousRow(row);
    describe(row.id, () => {
      const pinned = [...(row.refused ?? []).map((d) => ({ under: previous, d })), ...row.decisions.map((d) => ({ under: row, d }))];
      for (const { under, d } of pinned) {
        const label = `${d.evidence.toUpperCase()}${d.runs ? ` (run ${d.runs.join(', ')})` : ''}`;
        const facts = `Admin serving ${short(d.adminServes)}, ${d.ownerState}${d.assessment ? `, assessment ${d.assessment}` : ''}`;
        const verdict = d.unexpected.length ? `refused for ${d.unexpected.join(' + ')}, not a wait` : 'the non-publishing wait';
        test(`${label}: under ${under.id}, ${facts} — ${verdict}`, () => {
          const { policy, peers, decision } = replay(under, d);
          assert.equal(decision.decision, 'REFUSE');
          assert.equal(decision.allow, false);
          assert.deepEqual(codesOf(decision), [...new Set([...awaitingOf(d.ownerState), ...d.unexpected])].sort());
          const detail = (code) => decision.reasons.find((r) => r.code === code)?.detail;
          assert.equal(detail('peers.backend_serving_unverified'), servingReasonOf(under), 'a source receipt is not serving evidence — B3 still stands');
          assert.equal(d.adminServes === under.approved.admin, !d.unexpected.includes('peers.admin_serving_unapproved'));
          if (d.unexpected.includes('peers.admin_serving_unapproved')) {
            assert.equal(detail('peers.admin_serving_unapproved'), `admin serves ${d.adminServes}, which is not in compatible set ${under.id}`, 'byte for byte the detail a CI log prints');
          }
          if (d.assessment) assert.equal(detail(`dependency.assessment_${HISTORY.assessments[d.assessment].outcome}`), HISTORY.assessments[d.assessment].headline);
          if (d.unexpected.includes('peers.capabilities_unpublished')) assert.match(detail('peers.capabilities_unpublished'), new RegExp(under.approved.backend));
          if (d.decisionDigest !== null) {
            assert.equal(digestOfValue(decision), d.decisionDigest, 'the whole decision — reason order and every detail — is the one recorded');
          }
          const enablements = d.unexpected.length ? [''] : ['', 'false'];
          for (const enablement of enablements) {
            const r = classifyWith({ policy, peers, decision, enablement });
            assert.equal(r.evaluationCompleted, true);
            assert.equal(r.decision, 'REFUSE');
            assert.equal(r.allow, false);
            assert.equal(r.published, false);
            assert.equal(r.decisionDigest, digestOfValue(decision));
            if (d.unexpected.length === 0) {
              assert.equal(r.kind, AWAITING, JSON.stringify(r.problems));
              assert.deepEqual(r.problems, []);
              assert.deepEqual(r.awaiting.map((a) => a.code).sort(), [...awaitingOf(d.ownerState)].sort());
            } else {
              assert.notEqual(r.kind, AWAITING);
              assert.deepEqual(r.problems.map((p) => p.code), d.unexpected.map(() => 'readiness.unexpected_reason'), 'each unexpected reason, and nothing else, is the problem');
              assert.deepEqual(r.problems.map((p) => p.detail).sort(), d.unexpected.map((c) => `${c}: ${detail(c)}`).sort());
            }
          }
          if (d.unexpected.length === 0) {
            assert.deepEqual(classifyWith({ policy, peers, decision, enablement: 'true' }).problems.map((p) => p.code),
              ['readiness.publication_enabled'], 'enabling publication is not part of this wait');
          }
        });
      }

      if (previous) {
        test(`CONTRACT: with every other fact held fixed, the refresh from ${previous.id} moved ${row.moved.join(' and ')} and removed ${row.removes.length ? row.removes.join(', ') : 'no reason'} — and nothing else`, () => {
          // The refused decision the new Admin revision met under the previous set, or (when
          // only the backend moved) the previous set's own decision for the unchanged Admin.
          const befores = [
            ...(row.refused ?? []).filter((d) => d.adminServes === row.approved.admin),
            ...(row.moved.includes('admin') ? [] : previous.decisions.filter((d) => d.adminServes === row.approved.admin)),
          ];
          assert.ok(befores.length > 0);
          for (const b of befores) {
            const a = row.decisions.find((d) => d.adminServes === b.adminServes && d.ownerState === b.ownerState && d.assessment === b.assessment);
            assert.ok(a, `${row.id} records no decision for Admin ${short(b.adminServes)} under ${b.ownerState} to compare against`);
            const before = replay(previous, b).decision;
            const after = replay(row, a).decision;
            const [bc, ac] = [codesOf(before), codesOf(after)];
            assert.deepEqual(bc.filter((c) => !ac.includes(c)), row.removes);
            assert.deepEqual(ac.filter((c) => !bc.includes(c)), [], 'the refresh introduced no new compatibility problem');
            // The approvals alone change no other byte: every remaining reason is identical,
            // detail included.
            const approvalsOnly = replay(row, a, { servingReason: servingReasonOf(previous) }).decision;
            assert.deepEqual(approvalsOnly, { ...before, reasons: before.reasons.filter((r) => !row.removes.includes(r.code)) }, 'every other reason is byte-identical, detail included');
            if (row.removes.length === 0) assert.equal(digestOfValue(approvalsOnly), digestOfValue(before), 'the approvals alone change no byte');
            // A corrected serving note changes that one detail, and no code.
            const changed = after.reasons
              .map((r, i) => ({ code: r.code, was: approvalsOnly.reasons[i].detail, now: r.detail, sameCode: approvalsOnly.reasons[i].code === r.code }))
              .filter((c) => !c.sameCode || c.was !== c.now);
            const noteMoved = row.backendServingReason !== previous.backendServingReason;
            assert.deepEqual(changed, noteMoved
              ? [{ code: 'peers.backend_serving_unverified', was: servingReasonOf(previous), now: servingReasonOf(row), sameCode: true }]
              : []);
            if (!noteMoved) assert.deepEqual(after, approvalsOnly);
            // Peer by peer, when a refresh moved more than one.
            for (const [peer, adds] of Object.entries(row.attribution ?? {})) {
              const reverted = replay(row, a, { approved: { ...row.approved, [peer]: previous.approved[peer] } }).decision;
              assert.deepEqual(codesOf(reverted), [...new Set([...ac, ...adds])].sort(), `reverting only the ${peer} approval`);
            }
          }
        });

        test(`CONTROL: the refresh to ${row.id} moved nothing but the set id, ${row.moved.map((p) => `the ${p} approval`).join(', ')}${row.backendServingReason !== previous.backendServingReason ? ', the backend serving note' : ''}${row.ownerStates[0] !== previous.ownerStates.at(-1) ? ', the owner state' : ''}`, () => {
          const was = snapshot(previous, previous.ownerStates.at(-1));
          const now = snapshot(row, row.ownerStates[0]);
          const expected = ['compatibleSet.id', ...row.moved.map((p) => `compatibleSet.peers.${p}.approved`)];
          if (row.backendServingReason !== previous.backendServingReason) expected.push('compatibleSet.peers.backend.serving.reason');
          if (row.ownerStates[0] !== previous.ownerStates.at(-1)) expected.push(...Object.keys(HISTORY.ownerStates[row.ownerStates[0]].overrides));
          const diff = [];
          const walk = (x, y, path) => {
            if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x) && !Array.isArray(y)) {
              for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], path ? `${path}.${k}` : k);
            } else if (JSON.stringify(x) !== JSON.stringify(y)) diff.push(path);
          };
          walk(was, now, '');
          assert.deepEqual(diff.sort(), [...new Set(expected)].sort());
        });
      }

      test(`REGRESSION: an Admin revision ${row.id} does not approve is refused under its id and is NOT a wait — every other approval, every revision reviewed and never approved, every one seen serving, or any later one`, () => {
        for (const state of row.ownerStates) {
          const own = standing(row, state).unexpected;
          for (const serves of [...KNOWN_ADMIN_REVISIONS.filter((c) => c !== row.approved.admin), 'a'.repeat(40)]) {
            const { policy, peers, decision } = replay(row, { adminServes: serves, ownerState: state });
            const reason = decision.reasons.find((r) => r.code === 'peers.admin_serving_unapproved');
            assert.equal(reason?.detail, `admin serves ${serves}, which is not in compatible set ${row.id}`, `${state} ${serves}`);
            assert.equal(decision.allow, false, serves);
            const r = classifyWith({ policy, peers, decision });
            assert.notEqual(r.kind, AWAITING, serves);
            assert.deepEqual(r.problems.map((p) => p.code), [...own, 'peers.admin_serving_unapproved'].map(() => 'readiness.unexpected_reason'), serves);
          }
        }
      });

      if (row.ownerStates.length > 1) {
        test(`CONTRACT: within ${row.id}, the owner-state change (${row.ownerStates.join(' -> ')}) removed exactly the waits it resolved and nothing else`, () => {
          for (let i = 1; i < row.ownerStates.length; i++) {
            const [s0, s1] = [row.ownerStates[i - 1], row.ownerStates[i]];
            const before = replay(row, standing(row, s0)).decision;
            const after = replay(row, standing(row, s1)).decision;
            const resolved = awaitingOf(s0).filter((c) => !awaitingOf(s1).includes(c));
            assert.deepEqual(codesOf(before).filter((c) => !codesOf(after).includes(c)), [...resolved].sort());
            assert.deepEqual(after.reasons, before.reasons.filter((r) => !resolved.includes(r.code)), 'every other reason is byte-identical, detail included');
          }
        });
      }
    });
  }

  test(`REGRESSION: through the real decide command, every superseded Admin approval and every revision reviewed with ${CURRENT.id} but not approved is refused under ${CURRENT.id} and is NOT a wait`, async () => {
    const serving = [
      ...new Set(SETS.map((r) => r.approved.admin)),
      ...CURRENT.notApproved.map((n) => n.commit),
    ].filter((c) => c !== ADMIN);
    const results = await Promise.all(serving.map(async (serves) => ({ serves, peers: recordedPeers({ adminServes: serves }), ...(await decideCommitted({ peers: recordedPeers({ adminServes: serves }) })) })));
    for (const { serves, peers, decision } of results) {
      assert.equal(decision.reasons.find((r) => r.code === 'peers.admin_serving_unapproved')?.detail,
        `admin serves ${serves}, which is not in compatible set ${CURRENT.id}`, serves);
      assert.equal(decision.allow, false, serves);
      assert.deepEqual(classifyWith({ peers, decision }).problems.map((p) => p.code), ['readiness.unexpected_reason'], serves);
    }
  });

  test(`CONTRACT: through the real decide command, ${CURRENT.id}'s own decisions under the committed owner state reproduce their pinned digests — the CLI and the history agree`, async () => {
    const state = CURRENT.ownerStates.at(-1);
    const own = CURRENT.decisions.filter((d) => d.ownerState === state && !d.assessment);
    assert.ok(own.length > 0);
    for (const d of own) {
      const { decision } = await decideCommitted({ peers: recordedPeers({ adminServes: d.adminServes }) });
      assert.equal(digestOfValue(decision), d.decisionDigest, d.adminServes);
    }
  });
});

describe('the backend receipts the history approved — what approving a backend receipt changes, and what it does not', () => {
  test('CONTROL: the pure decision and the real CLI agree on the committed policy, so the comparisons here measure the same rule', async () => {
    const viaCli = await decideCommitted();
    assert.deepEqual(codesOf(decidePure()), codesOf(viaCli.decision));
  });

  test('CONTRACT: with every other fact held fixed, the approved backend receipt (against the export-less first one) removes peers.capabilities_unpublished and nothing else', () => {
    // Bound to the pre-R-1 snapshot: the counts below are what that approval changed then.
    const before = codesOf(decidePure(withHistoricalBackend(preRetentionPolicy())));
    const after = codesOf(decidePure({ policy: preRetentionPolicy(), peers: servingApproved() }));
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

  test(`CONTRACT: the approved backend ${short(BACKEND)} agrees with the frontend's compiled D01 copy, and is still an operator-reviewed receipt`, () => {
    const d01 = committedReceiptEntry('backend', BACKEND).receipt.contracts.d01CheckoutLimits;
    const frontendD01 = JSON.parse(readFileSync(join(ROOT, 'src/app/_shared/order/checkout-limits.contract.json'), 'utf8'));
    assert.equal(contractDigest(frontendD01), d01.digest, 'the frontend\'s compiled D01 copy agrees with the selected backend\'s export');
    assert.equal(POLICY.compatibleSet.peers.backend.receiptVerification, 'operator', 'still an operator-reviewed receipt: repository visibility metadata changes nothing here');
  });

  test('CONTRACT: the serving note says what is true now — an identity endpoint and a staged installer exist in the source, a verified loaded-runtime identity does not — and serving stays unavailable', () => {
    const serving = POLICY.compatibleSet.peers.backend.serving;
    assert.deepEqual(Object.keys(serving).sort(), ['observation', 'reason']);
    assert.equal(serving.observation, 'unavailable');
    assert.match(serving.reason, /^no verified loaded-runtime identity of the backend is available \(B3\)/);
    assert.match(serving.reason, /release-identity endpoint and a staged installer/);
    assert.match(serving.reason, /the installer is not active, the legacy deploy-uat\.yml still serves/);
    assert.match(serving.reason, /an operator statement is not accepted as serving evidence$/);
    assert.doesNotMatch(serving.reason, /publishes no served-revision identity/, 'the stale claim equated an absent endpoint with absent serving evidence');
    const historical = HISTORY.backendServingReasons['no-identity-published'];
    assert.match(historical, /publishes no served-revision identity/, 'the note every decision through pilot-11 printed');
    assert.notEqual(serving.reason, historical);
    const decision = decidePure({ peers: servingApproved() });
    assert.equal(decision.reasons.find((r) => r.code === 'peers.backend_serving_unverified').detail, serving.reason, 'the corrected note is what an operator reads in the refusal');
  });

  test(`REGRESSION: the approved backend evidence, broken one fact at a time, is refused and is never a wait — a new reason still fails readiness`, () => {
    const previous = committedReceiptEntry('backend', PREVIOUS_BACKEND);
    const edit = (change) => (p) => { const r = clone(p.receipts.backend[0].receipt); change(r); p.receipts.backend[0] = { ...p.receipts.backend[0], receipt: r, digest: receiptDigest(r) }; };
    const cases = {
      [`receipt tree set to ${short(PREVIOUS_BACKEND)}'s`]: ['peers.receipt_mismatch', edit((r) => { r.tree = previous.receipt.tree; })],
      'capability export blob edited': ['peers.receipt_mismatch', edit((r) => { r.sources[1].blob = 'f'.repeat(40); })],
      'a capability level edited': ['peers.receipt_mismatch', edit((r) => { r.publishes.quote_protocol = 1; })],
      'a D01 value edited, digest recomputed': ['peers.receipt_mismatch', edit((r) => {
        r.contracts.d01CheckoutLimits.values.MAX_QUANTITY_PER_LINE = 100;
        r.contracts.d01CheckoutLimits.digest = contractDigest(r.contracts.d01CheckoutLimits.values);
      })],
      'a D01 value edited, digest left': ['peers.receipt_inconsistent', edit((r) => { r.contracts.d01CheckoutLimits.values.MAX_QUANTITY_PER_LINE = 100; })],
      [`receipt about the replaced ${short(PREVIOUS_BACKEND)}`]: ['peers.receipt_wrong_revision', edit((r) => { r.commit = PREVIOUS_BACKEND; })],
      [`the retained ${short(PREVIOUS_BACKEND)} receipt relabelled as ${short(BACKEND)} (SAME export blobs)`]: ['peers.receipt_mismatch', (p) => {
        const r = clone(previous.receipt);
        r.commit = BACKEND;
        p.receipts.backend[0] = { ...p.receipts.backend[0], receipt: r, digest: receiptDigest(r) };
      }],
      'receipt file missing': ['peers.receipt_missing', (p) => { p.receipts.backend[0] = { commit: BACKEND, path: receiptPath('backend', BACKEND), present: false }; }],
      'receipt file unreadable': ['peers.receipt_unreadable', (p) => { p.receipts.backend[0] = { commit: BACKEND, path: receiptPath('backend', BACKEND), present: true, readable: false, detail: 'Unexpected token' }; }],
    };
    for (const [label, [code, breakIt]] of Object.entries(cases)) {
      const peers = servingApproved();
      breakIt(peers);
      const decision = decidePure({ peers });
      assert.ok(codesOf(decision).includes(code), `${label}: ${JSON.stringify(codesOf(decision))}`);
      assert.ok(codesOf(decision).includes('peers.backend_serving_unverified'), `${label}: the missing serving identity still stands`);
      assert.equal(decision.allow, false, label);
      const r = classifyWith({ peers, decision });
      assert.notEqual(r.kind, AWAITING, label);
      assert.ok(r.problems.some((p) => p.code === 'readiness.unexpected_reason'), `${label}: ${JSON.stringify(r.problems)}`);
    }
    // An intact file whose digest the POLICY does not pin — including the replaced pin left
    // behind by a half-applied edit.
    for (const wrong of [`sha256:${'0'.repeat(64)}`, previous.digest]) {
      const policy = clone(POLICY);
      policy.compatibleSet.peers.backend.approved[0].receiptDigest = wrong;
      const decision = decidePure({ policy, peers: servingApproved() });
      assert.ok(codesOf(decision).includes('peers.receipt_mismatch'), `${wrong}: ${JSON.stringify(codesOf(decision))}`);
      assert.notEqual(classifyWith({ policy, peers: servingApproved(), decision }).kind, AWAITING);
    }
  });

  test('REGRESSION: an operator statement of which backend is serving is not accepted — the refusal stands and the evaluation is no longer a wait', () => {
    const peers = servingApproved();
    peers.serving.backend = { state: 'known', commit: BACKEND, noStore: true, cacheControl: 'no-store' };
    const decision = decidePure({ peers });
    assert.ok(codesOf(decision).includes('peers.backend_serving_unverified'));
    assert.equal(decision.allow, false);
    const r = classifyWith({ peers, decision });
    assert.notEqual(r.kind, AWAITING);
    assert.deepEqual(r.problems.map((p) => p.code), ['readiness.context_mismatch']);
  });
});

describe('the approved Admin evidence and the dependency assessment, against the committed policy', () => {
  test('REGRESSION: the approved Admin evidence, broken one fact at a time, is refused and is never a wait', () => {
    const previous = committedReceiptEntry('admin', SUPERSEDED_ADMIN);
    const approved = committedReceiptEntry('admin', ADMIN);
    // A deploy.yml blob the approved receipt does not carry: the latest earlier approval's
    // that differs.
    const otherBlob = [...SETS].reverse().map((r) => committedReceiptEntry('admin', r.approved.admin).receipt.sources[0].blob)
      .find((b) => b !== approved.receipt.sources[0].blob);
    // The PR head the current row records with the merge's tree, when there is one: the same
    // tree under another commit must still be refused as a different revision.
    const sameTreeHead = CURRENT.notApproved.find((n) => n.tree === approved.receipt.tree)?.commit;
    const relabel = (commit) => (p) => {
      const r = clone(committedReceiptEntry('admin', commit).receipt);
      r.commit = ADMIN;
      p.receipts.admin[0] = { ...p.receipts.admin[0], receipt: r, digest: receiptDigest(r) };
    };
    const edit = (change) => (p) => { const r = clone(p.receipts.admin[0].receipt); change(r); p.receipts.admin[0] = { ...p.receipts.admin[0], receipt: r, digest: receiptDigest(r) }; };
    const cases = {
      'receipt tree edited': ['peers.receipt_mismatch', edit((r) => { r.tree = 'f'.repeat(40); })],
      [`receipt tree set to ${short(SUPERSEDED_ADMIN)}'s`]: ['peers.receipt_mismatch', edit((r) => { r.tree = previous.receipt.tree; })],
      [`deploy.yml blob set to an earlier blob (${short(otherBlob)})`]: ['peers.receipt_mismatch', edit((r) => { r.sources[0].blob = otherBlob; })],
      ...(sameTreeHead ? { [`receipt about another revision (the PR head ${short(sameTreeHead)}, same tree)`]: ['peers.receipt_wrong_revision', edit((r) => { r.commit = sameTreeHead; })] } : {}),
      [`receipt about another revision (${short(SUPERSEDED_ADMIN)})`]: ['peers.receipt_wrong_revision', edit((r) => { r.commit = SUPERSEDED_ADMIN; })],
      [`the just-superseded ${short(SUPERSEDED_ADMIN)} receipt, relabelled as the approved one`]: ['peers.receipt_mismatch', relabel(SUPERSEDED_ADMIN)],
      'receipt file missing': ['peers.receipt_missing', (p) => { p.receipts.admin[0] = { commit: ADMIN, path: receiptPath('admin', ADMIN), present: false }; }],
      'receipt file unreadable': ['peers.receipt_unreadable', (p) => { p.receipts.admin[0] = { commit: ADMIN, path: receiptPath('admin', ADMIN), present: true, readable: false, detail: 'Unexpected token' }; }],
      'public re-derivation disagrees (tree)': ['peers.admin_receipt_unverified', (p) => { p.verification.admin[ADMIN] = { state: 'mismatch', detail: `tree ${previous.receipt.tree} != ${approved.receipt.tree}` }; }],
      'public re-derivation unavailable': ['peers.admin_receipt_unverified', (p) => { p.verification.admin[ADMIN] = { state: 'unavailable', detail: 'HTTP 502' }; }],
      'served identity unreadable': ['peers.admin_serving_unreadable', (p) => { p.serving.admin = { state: 'unreadable', detail: 'CONNECT refused' }; }],
      'served identity cacheable (failed no-store verification)': ['peers.admin_serving_cacheable', (p) => { p.serving.admin = { ...p.serving.admin, noStore: false, cacheControl: 'public, max-age=300' }; }],
      'served identity with no Cache-Control at all': ['peers.admin_serving_cacheable', (p) => { p.serving.admin = { ...p.serving.admin, noStore: false, cacheControl: null }; }],
    };
    for (const [label, [code, breakIt]] of Object.entries(cases)) {
      const peers = servingApproved();
      breakIt(peers);
      const decision = decidePure({ peers });
      assert.ok(codesOf(decision).includes(code), `${label}: ${JSON.stringify(codesOf(decision))}`);
      assert.equal(decision.allow, false, label);
      assert.notEqual(classifyWith({ peers, decision }).kind, AWAITING, label);
    }
    // An intact file whose digest the POLICY does not pin — including the previous pin left
    // behind by a half-applied edit.
    for (const wrong of [`sha256:${'0'.repeat(64)}`, previous.digest]) {
      const policy = clone(POLICY);
      policy.compatibleSet.peers.admin.approved[0].receiptDigest = wrong;
      const decision = decidePure({ policy, peers: servingApproved() });
      assert.ok(codesOf(decision).includes('peers.receipt_mismatch'), `${wrong}: ${JSON.stringify(codesOf(decision))}`);
      assert.ok(!codesOf(decision).includes('peers.admin_serving_unapproved'), 'isolated: not refused for serving');
      assert.equal(decision.allow, false);
      assert.notEqual(classifyWith({ policy, peers: servingApproved(), decision }).kind, AWAITING);
    }
  });

  test('CONTROL: a malformed approval in the policy is refused as an invalid policy, not as a wait', () => {
    const policy = clone(POLICY);
    policy.compatibleSet.peers.admin.approved[0].receiptDigest = 'sha256:not-a-digest';
    const decision = decidePure({ policy });
    assert.deepEqual(codesOf(decision), ['policy.invalid']);
    assert.equal(decision.allow, false);
  });

  test('REGRESSION: a blocking or incomplete dependency assessment stays red beside the approved receipts — a source approval bypasses nothing, and an earlier passing assessment is not admission authority', () => {
    for (const [outcome, code] of [['blocking', 'dependency.assessment_blocking'], ['incomplete', 'dependency.assessment_incomplete']]) {
      const input = baseline();
      const dependencies = dependenciesFor({
        manifest: input.artifact.manifest,
        evidence: input.artifact.dependencyEvidence,
        assessment: assessmentFor({ manifest: input.artifact.manifest, evidence: input.artifact.dependencyEvidence, tooling: input.dependencies.tooling, outcome }),
      });
      const peers = servingApproved();
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
    assert.ok(!POLICY.publication.readiness.awaiting.some((c) => c.startsWith('dependency.')), 'no dependency.* reason is ever a wait');
  });

  test('CONTROL: the refreshes moved no owner setting, no enablement, no serving contract and no waiting entry — the committed values every compatible-set change leaves alone', () => {
    // As committed before R-1 (which, later and separately, moved retention to verified).
    const preR1 = preRetentionPolicy();
    assert.equal(preR1.prerequisites.retention.status, 'unverified');
    assert.deepEqual([...preR1.publication.readiness.awaiting].sort(), [...PRE_RETENTION_AWAITING].sort());
    for (const listed of [POLICY.publication.readiness.awaiting, preR1.publication.readiness.awaiting]) {
      assert.ok(!listed.some((c) => c.startsWith('peers.admin')), 'no peers.admin_* entry: a peer deployment is answered by a receipt, never by a wait');
      assert.ok(!listed.some((c) => c.startsWith('dependency.')), 'no dependency.* entry');
      assert.ok(!listed.some((c) => c.includes('*')), 'no wildcard');
    }
    assert.equal(POLICY.bootstrap.authorized, false);
    assert.equal(POLICY.bootstrap.servedBaseline, null);
    // Source protection moved later and separately (the 2026-10-27 record, under an unchanged
    // set id), never by a refresh: every state a set was committed under before the record
    // replays it unrecorded, and the record's own state replays it recorded.
    assert.equal(POLICY.prerequisites.sourceProtection.status, 'recorded');
    for (const state of Object.keys(HISTORY.ownerStates).filter((s) => s !== SP)) {
      assert.equal(applyOwnerState(clone(POLICY), state).prerequisites.sourceProtection.status, 'unrecorded', state);
    }
    assert.equal(applyOwnerState(clone(POLICY), SP).prerequisites.sourceProtection.status, 'recorded');
    assert.equal(POLICY.prerequisites.singlePublisher.status, 'legacy-writer-active');
    assert.equal(POLICY.prerequisites.singlePublisher.legacyWorkflow, '.github/workflows/deploy-prod.yml');
    assert.ok(existsSync(join(ROOT, '.github/workflows/deploy-prod.yml')), 'the legacy writer is untouched');
    assert.equal(POLICY.publication.enablementVariable, 'FRONTEND_PUBLISH_ENABLED');
    assert.equal(POLICY.compatibleSet.peers.backend.serving.observation, 'unavailable', 'no backend runtime identity is established');
    assert.equal(POLICY.compatibleSet.peers.backend.receiptVerification, 'operator');
    assert.deepEqual(POLICY.compatibleSet.peers.admin.serving, {
      observation: 'public-identity', origin: 'https://admin.dinifyapp.com', path: '/release.txt',
    }, 'the identity this gate reads: the exact commit at /release.txt, no-store');
    assert.equal(POLICY.compatibleSet.peers.admin.receiptVerification, 'public-repository');
    assert.equal(POLICY.compatibleSet.peers.admin.assumptions.length, 3);
    assert.deepEqual(POLICY.compatibleSet.frontendRequires, { buildConfiguration: 'uat' });
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

  test(`CONTRACT: the recorded wait is EXACTLY the committed refusal as observed (Admin serving the approved ${short(ADMIN)}) — and an unapproved Admin revision, such as the just-superseded ${short(SUPERSEDED_ADMIN)}, adds only an unapproved-peer reason, which is not a wait`, async () => {
    const { decision } = await decideCommitted();
    assert.deepEqual([...POLICY.publication.readiness.awaiting].sort(), codesOf(decision));
    const superseded = await decideCommitted({ peers: recordedPeers({ adminServes: SUPERSEDED_ADMIN }) });
    assert.deepEqual(codesOf(superseded.decision), [...POLICY.publication.readiness.awaiting, 'peers.admin_serving_unapproved'].sort());
    assert.notEqual(classify(superseded.decision, { peers: recordedPeers({ adminServes: SUPERSEDED_ADMIN }) }).kind, AWAITING);
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

  test(`CONTRACT: the historical backend (${short(HISTORICAL_BACKEND)}) refuses capabilities_unpublished, and that is NOT a wait`, () => {
    const { policy, peers } = withHistoricalBackend();
    const decision = decidePure({ policy, peers });
    assert.ok(codesOf(decision).includes('peers.capabilities_unpublished'));
    const r = classify(decision, { peers });
    assert.notEqual(r.kind, AWAITING);
    assert.deepEqual(r.problems.map((p) => p.code), ['readiness.unexpected_reason']);
    assert.match(r.problems[0].detail, /peers\.capabilities_unpublished/);
  });
});

describe('the source-protection observation (SP-1) — recorded evidence that moves no decision', () => {
  // WHAT THIS IS. prerequisites.sourceProtection.observation records how `main` was
  // protected when read (first on 2026-10-15, re-read on 2026-10-27: a repository ruleset —
  // no force-push, no deletion, `validate` required and strict, a pull request with no
  // required approval) together with what that reading cannot establish. Through R-1 the
  // status stayed `unrecorded` beside it; the owner's 2026-10-27 decision moved it to
  // `recorded` (its own block below). Either way the observation is evidence, not the
  // decision: `decide` reads `status` alone.
  //
  // WHAT THE INVARIANT BELOW IS, AND IS NOT. It is SYNTHETIC: the fixture candidate, the
  // committed receipts and identical peer facts, decided with and without the observation.
  // It shows the observation is inert to the decision rule. It says nothing about what a
  // real readiness run will meet — that depends on a fresh assessment, live peer reads
  // and the served identity, none of which this replay observes.
  const withoutObservation = (base = POLICY) => {
    const policy = clone(base);
    delete policy.prerequisites.sourceProtection.observation;
    return policy;
  };

  test('CONTRACT: in the R-1 state the record was made from, the observation sat beside an unrecorded status, the refusal stood and the wait was five — the observation itself added no entry', () => {
    const r1 = r1Policy();
    const sp = r1.prerequisites.sourceProtection;
    assert.equal(sp.status, 'unrecorded');
    assert.equal(sp.observation.branch, POLICY.certification.branch);
    assert.ok(r1.publication.readiness.awaiting.includes(SP_RESOLVES));
    assert.deepEqual([...r1.publication.readiness.awaiting].sort(), [
      'peers.backend_serving_unverified',
      ...PREREQUISITES,
      SP_RESOLVES,
      'served.bootstrap_unauthorized',
    ].sort(), 'SP-1 added no entry (R-1, separately, removed only the retention one)');
    const decision = decidePure({ policy: r1, peers: servingApproved() });
    assert.equal(decision.reasons.find((r) => r.code === SP_RESOLVES)?.detail,
      'branch protection on the certified branch has not been recorded or disclosed as a limitation');
    assert.equal(decision.allow, false);
  });

  test('CONTRACT (SYNTHETIC): under identical peer facts the decision is byte-identical with and without the observation — and so is its readiness classification, in the R-1 state and in the committed one', () => {
    for (const base of [r1Policy(), POLICY]) {
      for (const peers of [servingApproved, () => recordedPeers({ adminServes: SUPERSEDED_ADMIN })]) {
        const withIt = decidePure({ policy: base, peers: peers() });
        const without = decidePure({ policy: withoutObservation(base), peers: peers() });
        assert.equal(digestOfValue(withIt), digestOfValue(without));
        assert.deepEqual(withIt, without);
        const a = classifyWith({ policy: base, peers: peers(), decision: withIt });
        const b = classifyWith({ policy: withoutObservation(base), peers: peers(), decision: without });
        assert.equal(a.kind, b.kind);
        assert.equal(a.decisionDigest, b.decisionDigest);
        assert.deepEqual(a.problems, b.problems);
      }
    }
    assert.equal(digestOfValue(decidePure({ policy: preRetentionPolicy(), peers: servingApproved() })), latestWaitDigest(PRE_R1),
      'before R-1, still the six-reason wait the earlier sets recorded');
    assert.equal(digestOfValue(decidePure({ policy: r1Policy(), peers: servingApproved() })), latestWaitDigest(R1),
      'since R-1 and until the source-protection record, the five-reason wait');
    assert.equal(digestOfValue(decidePure({ peers: servingApproved() })), latestWaitDigest(SP),
      'since the source-protection record, the four-reason wait');
  });

  test('CONTROL: only `status` moves the decision — the same observation beside `unrecorded` adds exactly the source-protection refusal back', () => {
    const unrecorded = clone(POLICY);
    unrecorded.prerequisites.sourceProtection.status = 'unrecorded';
    const before = codesOf(decidePure({ policy: unrecorded, peers: servingApproved() }));
    const after = codesOf(decidePure({ peers: servingApproved() }));
    assert.deepEqual(before.filter((c) => !after.includes(c)), [SP_RESOLVES]);
    assert.deepEqual(after.filter((c) => !before.includes(c)), []);
    assert.equal(POLICY.prerequisites.sourceProtection.status, 'recorded', 'and the committed status is the recorded one');
  });

  test('CONTROL: a malformed observation in the committed shape is refused as an invalid policy, never as a wait', () => {
    const policy = clone(POLICY);
    policy.prerequisites.sourceProtection.observation.observedOn = '2026-00-01';
    const decision = decidePure({ policy, peers: servingApproved() });
    assert.deepEqual(codesOf(decision), ['policy.invalid']);
    assert.match(decision.reasons[0].detail, /policy\.bad_source_protection_observation/);
    assert.notEqual(classifyWith({ policy, peers: servingApproved(), decision }).kind, AWAITING);
  });
});

describe('the R-1 retention observation (2026-10-15) — the Firebase-retention prerequisite, and nothing else, resolved', () => {
  // WHAT THIS IS. The owner-reported, read-only observation of the `live` channel of site
  // `dinify-prod` (project `dinify-dev`) was accepted as sufficient for the narrow R-1
  // requirement, so prerequisites.retention.status moved to `verified` and
  // prerequisite.retention_unverified left publication.readiness.awaiting in the same
  // change. release/README.md -> "Firebase retention (R-1)" carries the sanitized evidence
  // and its limits: the returned retainedReleaseCount 2147483647 is preserved as observed and
  // NOT read as unlimited, and nothing here proves a recovery would succeed.
  //
  // WHAT THE DIGEST IS. The five-reason wait (history.json, `synthetic`) is computed over the
  // fixture candidate, the committed receipts and the recorded Admin observation. No readiness
  // run had recorded a five-reason decision when R-1 was written.
  //
  // WHICH STATE IS "AFTER R-1". Until 2026-10-27 the committed policy WAS the R-1 state. The
  // source-protection record has since moved the committed policy on, under the same set id,
  // so the R-1 side of every comparison here is the R-1 snapshot, r1Policy(). The real decide
  // command reads only the committed file, so it is asked about the committed state in the
  // source-protection block below.
  const preR1 = () => preRetentionPolicy();
  const R1_WAIT = standing(R1_ROW, R1).decisionDigest;
  const PRE_R1_WAIT = standing(R1_ROW, PRE_R1).decisionDigest;

  test('CONTRACT: the R-1 state records retention verified, lists exactly the five remaining waits, and validates — and R-1 moved nothing else', () => {
    const r1 = r1Policy();
    assert.equal(r1.prerequisites.retention.status, 'verified');
    assert.equal(POLICY.prerequisites.retention.status, 'verified', 'and the committed policy still records it verified');
    assert.deepEqual([...r1.publication.readiness.awaiting].sort(), [...R1_REMAINING_WAIT].sort());
    assert.equal(r1.publication.readiness.awaiting.includes('prerequisite.retention_unverified'), false);
    assert.equal(POLICY.publication.readiness.awaiting.includes('prerequisite.retention_unverified'), false);
    assert.equal(validatePolicy(r1).ok, true, JSON.stringify(validatePolicy(r1).problems));
    assert.equal(validatePolicy(POLICY).ok, true, JSON.stringify(validatePolicy(POLICY).problems));
    // Everything the R-1 change was NOT allowed to touch. R-1 left the compatible set at the
    // id it already had; later refreshes moved only what their history rows record.
    assert.equal(R1_ROW.ownerStates.at(-1), R1, 'R-1 changed the owner state under an unchanged set id');
    assert.equal(POLICY.compatibleSet.id, CURRENT.id);
    assert.equal(ADMIN, CURRENT.approved.admin);
    assert.equal(BACKEND, CURRENT.approved.backend);
    assert.equal(r1.prerequisites.sourceProtection.status, 'unrecorded', 'R-1 did not move source protection; the 2026-10-27 record did, later');
    // The SP-1 observation R-1 sat beside was re-read on 2026-10-27, and both responses it
    // digests came back byte-identical to the 2026-10-15 ones.
    assert.deepEqual(POLICY.prerequisites.sourceProtection.observation.responseSha256, SP1_RESPONSE_DIGESTS_2026_10_15,
      'the SP-1 evidence R-1 sat beside is unchanged in substance');
    assert.equal(POLICY.prerequisites.singlePublisher.status, 'legacy-writer-active');
    assert.equal(POLICY.prerequisites.singlePublisher.legacyWorkflow, '.github/workflows/deploy-prod.yml');
    assert.equal(POLICY.compatibleSet.peers.backend.serving.observation, 'unavailable');
    assert.equal(POLICY.bootstrap.authorized, false);
    assert.equal(POLICY.bootstrap.servedBaseline, null);
    assert.equal(POLICY.publication.enablementVariable, 'FRONTEND_PUBLISH_ENABLED');
    assert.ok(existsSync(join(ROOT, '.github/workflows/deploy-prod.yml')), 'the legacy writer is preserved');
    // The pre-retention snapshot differs from the R-1 state in exactly those two places.
    const pre = preR1();
    const r1Copy = r1Policy();
    r1Copy.prerequisites.retention = clone(pre.prerequisites.retention);
    r1Copy.publication.readiness.awaiting = [...pre.publication.readiness.awaiting];
    assert.deepEqual(r1Copy, pre, 'the snapshot restores retention and the list, and nothing else');
  });

  test('CONTRACT: with identical candidate, peer and fresh-assessment inputs, R-1 removes prerequisite.retention_unverified and nothing else', () => {
    for (const peers of [servingApproved, () => recordedPeers({ adminServes: SUPERSEDED_ADMIN })]) {
      const before = decidePure({ policy: preR1(), peers: peers() });
      const after = decidePure({ policy: r1Policy(), peers: peers() });
      assert.deepEqual(codesOf(before).filter((c) => !codesOf(after).includes(c)), ['prerequisite.retention_unverified']);
      assert.deepEqual(codesOf(after).filter((c) => !codesOf(before).includes(c)), [], 'R-1 introduced no new reason');
      assert.deepEqual(after.reasons, before.reasons.filter((r) => r.code !== 'prerequisite.retention_unverified'),
        'every other reason is byte-identical, detail included');
      assert.equal(before.allow, false);
      assert.equal(after.allow, false);
    }
    assert.equal(digestOfValue(decidePure({ policy: preR1(), peers: servingApproved() })), PRE_R1_WAIT,
      'before R-1, the replay is the six-reason wait');
    // The set R-1 landed under keeps its id across it, so each side of R-1 is asked for
    // explicitly.
    const before = snapshot(R1_ROW, PRE_R1);
    const after = snapshot(R1_ROW, R1);
    assert.equal(before.compatibleSet.id, after.compatibleSet.id);
    assert.equal(digestOfValue(decidePure({ policy: before, peers: peersFor(before, R1_ROW.approved.admin) })), PRE_R1_WAIT);
    assert.equal(digestOfValue(decidePure({ policy: after, peers: peersFor(after, R1_ROW.approved.admin) })), R1_WAIT, 'after R-1, the same id is the five-reason wait');
  });

  test('CONTRACT: the R-1 state refuses exactly the five remaining reasons — REFUSE, allow:false — and that is the five-reason wait history.json pins', () => {
    const decision = decidePure({ policy: r1Policy() });
    assert.equal(decision.decision, 'REFUSE');
    assert.equal(decision.allow, false);
    assert.deepEqual(codesOf(decision), [...R1_REMAINING_WAIT].sort());
    assert.equal(codesOf(decision).length, 5);
    assert.equal(digestOfValue(decision), R1_WAIT, 'SYNTHETIC when R-1 was written; history.json records what has bound it since');
    assert.notEqual(R1_WAIT, PRE_R1_WAIT);
  });

  test('CONTRACT: automatic, publication unset or `false`, that refusal is the recorded non-publishing wait — REFUSE, allow:false, published:false', () => {
    const policy = r1Policy();
    const decision = decidePure({ policy });
    for (const enablement of ['', 'false']) {
      const r = classifyWith({ policy, decision, enablement });
      assert.equal(r.kind, AWAITING, JSON.stringify(r.problems));
      assert.equal(r.evaluationCompleted, true);
      assert.equal(r.decision, 'REFUSE');
      assert.equal(r.allow, false);
      assert.equal(r.published, false);
      assert.deepEqual(r.awaiting.map((a) => a.code).sort(), [...R1_REMAINING_WAIT].sort());
      assert.equal(r.decisionDigest, R1_WAIT);
    }
    assert.deepEqual(classifyWith({ policy, decision, enablement: 'true' }).problems.map((p) => p.code), ['readiness.publication_enabled'],
      'enabling publication is still a failed release, not a wait');
  });

  test('CONTROL: unverified retention is still refused by the generic rule — the decision rule did not change, only the committed status', () => {
    const unverified = clone(POLICY);
    unverified.prerequisites.retention.status = 'unverified';
    const decision = decidePure({ policy: unverified, peers: servingApproved() });
    assert.equal(decision.reasons.find((r) => r.code === 'prerequisite.retention_unverified')?.detail,
      'what Firebase Hosting retains for this site has not been established');
    assert.equal(decision.allow, false);
  });

  test('CONTROL: verified retention with its old awaiting entry reinserted is a STALE model — red, never a wait', () => {
    const stale = clone(POLICY);
    stale.publication.readiness.awaiting = [...stale.publication.readiness.awaiting, 'prerequisite.retention_unverified'];
    assert.equal(validatePolicy(stale).ok, true, 'the vocabulary is valid; the classifier is what refuses it');
    const decision = decidePure({ policy: stale, peers: servingApproved() });
    assert.equal(codesOf(decision).includes('prerequisite.retention_unverified'), false);
    const r = classifyWith({ policy: stale, decision });
    assert.notEqual(r.kind, AWAITING);
    assert.deepEqual(r.problems.map((p) => p.code), ['readiness.expectation_stale']);
    assert.match(r.problems[0].detail, /prerequisite\.retention_unverified/);
  });

  test('CONTROL: unresolved retention omitted from the awaiting list is not silently accepted — red, never a wait', () => {
    const omitted = clone(POLICY);
    omitted.prerequisites.retention.status = 'unverified';
    const decision = decidePure({ policy: omitted, peers: servingApproved() });
    assert.ok(codesOf(decision).includes('prerequisite.retention_unverified'));
    const r = classifyWith({ policy: omitted, decision });
    assert.notEqual(r.kind, AWAITING);
    assert.deepEqual(r.problems.map((p) => p.code), ['readiness.unexpected_reason']);
    assert.match(r.problems[0].detail, /prerequisite\.retention_unverified/);
  });

  test('CONTROL: what R-1 does not resolve still refuses, and an unexpected reason beside the five is still red', () => {
    const policy = r1Policy();
    const decision = decidePure({ policy, peers: recordedPeers({ adminServes: SUPERSEDED_ADMIN }) });
    assert.ok(codesOf(decision).includes('peers.admin_serving_unapproved'));
    assert.deepEqual(classifyWith({ policy, peers: recordedPeers({ adminServes: SUPERSEDED_ADMIN }), decision }).problems.map((p) => p.code),
      ['readiness.unexpected_reason']);
    for (const code of ['peers.backend_serving_unverified', 'prerequisite.source_protection_unrecorded',
      'prerequisite.legacy_publisher_active', 'prerequisite.legacy_publisher_present', 'served.bootstrap_unauthorized']) {
      assert.ok(codesOf(decidePure({ policy, peers: servingApproved() })).includes(code), code);
    }
  });
});

describe('the 2026-10-27 source-protection record — prerequisite.source_protection_unrecorded, and nothing else, resolved', () => {
  // WHAT THIS IS. The owner's decision to move prerequisites.sourceProtection.status from
  // `unrecorded` to `recorded`, on the SP-1 observation re-read that day. RECORDED means the
  // ruleset on `main` is CONFIGURED as GitHub reported it — not that its enforcement was
  // demonstrated; every limitation the observation states still applies, and the gate never
  // re-reads it. release/README.md -> "The 2026-10-27 source-protection record".
  //
  // WHAT THE DIGEST IS. The four-reason wait is RECORDED: readiness run 40510386279 (on
  // 532f68e, the record's own merge) bound it, and it is the digest the rule computes over
  // the fixture candidate, the committed receipts and the recorded Admin observation.
  // history.json carries the record as an owner state of its own, after R-1 in the row it
  // landed in, so the R-1 -> source-protection transition is pinned here and by the generic
  // per-row tests over that row.
  const SP_ROW = SETS.find((r) => r.ownerStates.includes(SP));
  const SP_WAIT = standing(SP_ROW, SP).decisionDigest;
  const R1_WAIT = standing(SP_ROW, R1).decisionDigest;
  const FOUR = Object.freeze([
    'peers.backend_serving_unverified',
    'prerequisite.legacy_publisher_active',
    'prerequisite.legacy_publisher_present',
    'served.bootstrap_unauthorized',
  ]);

  test('CONTRACT: the committed policy records source protection, lists exactly the four remaining waits, and validates — nothing else moved', () => {
    assert.equal(POLICY.prerequisites.sourceProtection.status, 'recorded');
    assert.deepEqual([...POLICY.publication.readiness.awaiting].sort(), [...FOUR]);
    assert.deepEqual([...POLICY.publication.readiness.awaiting], [...awaitingOf(SP)], 'the list in its committed order');
    assert.equal(POLICY.publication.readiness.awaiting.includes(SP_RESOLVES), false);
    assert.equal(validatePolicy(POLICY).ok, true, JSON.stringify(validatePolicy(POLICY).problems));
    // Everything this change was NOT allowed to touch: the set, its id and approvals,
    // retention, the single-publisher state, the bootstrap, enablement and backend serving.
    assert.equal(POLICY.compatibleSet.id, CURRENT.id);
    assert.deepEqual(SP_ROW.ownerStates.slice(-2), [R1, SP], 'the record landed under the unchanged set id, straight after R-1');
    assert.equal(ADMIN, CURRENT.approved.admin);
    assert.equal(BACKEND, CURRENT.approved.backend);
    assert.equal(POLICY.prerequisites.retention.status, 'verified');
    assert.equal(POLICY.prerequisites.singlePublisher.status, 'legacy-writer-active');
    assert.equal(POLICY.prerequisites.singlePublisher.legacyWorkflow, '.github/workflows/deploy-prod.yml');
    assert.ok(existsSync(join(ROOT, '.github/workflows/deploy-prod.yml')), 'the legacy writer is preserved');
    assert.equal(POLICY.bootstrap.authorized, false);
    assert.equal(POLICY.bootstrap.servedBaseline, null);
    assert.equal(POLICY.publication.enablementVariable, 'FRONTEND_PUBLISH_ENABLED');
    assert.equal(POLICY.compatibleSet.peers.backend.serving.observation, 'unavailable');
    assert.equal(POLICY.compatibleSet.peers.backend.receiptVerification, 'operator', 'the backend note was corrected; its verification mode was not');
    // The R-1 snapshot differs from the committed policy in exactly the status and the list.
    const r1 = r1Policy();
    const today = clone(POLICY);
    today.prerequisites.sourceProtection.status = r1.prerequisites.sourceProtection.status;
    today.publication.readiness.awaiting = [...r1.publication.readiness.awaiting];
    assert.deepEqual(today, r1, 'the R-1 snapshot restores the status and the list, and nothing else');
  });

  test('CONTRACT: history.json carries the record — an owner state of its own (R-1 with the status recorded and its one wait removed), after R-1 in the row it landed in, with both waits a readiness run recorded', () => {
    const r1 = HISTORY.ownerStates[R1].overrides;
    assert.deepEqual(HISTORY.ownerStates[SP].overrides, {
      ...r1,
      'prerequisites.sourceProtection.status': 'recorded',
      'publication.readiness.awaiting': r1['publication.readiness.awaiting'].filter((c) => c !== SP_RESOLVES),
    });
    for (const [name, state] of Object.entries(HISTORY.ownerStates)) {
      if (name === SP) continue;
      assert.equal(state.overrides['prerequisites.sourceProtection.status'], 'unrecorded', `${name} predates the record, and history.json says so itself`);
      assert.ok(state.overrides['publication.readiness.awaiting'].includes(SP_RESOLVES), `${name} predates the record`);
    }
    // Overrides apply over the committed policy, so every state names the same prerequisite
    // statuses: none can inherit a later owner decision by omission.
    const keysOf = (name) => Object.keys(HISTORY.ownerStates[name].overrides).sort();
    for (const name of Object.keys(HISTORY.ownerStates)) assert.deepEqual(keysOf(name), keysOf(SP), name);
    assert.deepEqual(SP_ROW.ownerStates, [R1, SP], 'the record follows R-1 under the unchanged set id');
    assert.deepEqual(SETS.filter((r) => r.ownerStates.includes(R1) && r.ownerStates.includes(SP)), [SP_ROW], 'and in that row alone');
    for (const [state, run] of [[R1, 40497635180], [SP, 40510386279]]) {
      const d = standing(SP_ROW, state);
      assert.equal(d.evidence, 'recorded', state);
      assert.deepEqual(d.runs, [run], state);
    }
  });

  test('CONTRACT: with identical candidate, peer and fresh-assessment inputs, the record removes prerequisite.source_protection_unrecorded and nothing else', () => {
    for (const peers of [servingApproved, () => recordedPeers({ adminServes: SUPERSEDED_ADMIN })]) {
      const before = decidePure({ policy: r1Policy(), peers: peers() });
      const after = decidePure({ peers: peers() });
      assert.deepEqual(codesOf(before).filter((c) => !codesOf(after).includes(c)), [SP_RESOLVES]);
      assert.deepEqual(codesOf(after).filter((c) => !codesOf(before).includes(c)), [], 'the record introduced no new reason');
      assert.deepEqual(after.reasons, before.reasons.filter((r) => r.code !== SP_RESOLVES),
        'every other reason is byte-identical, detail included');
      assert.equal(before.allow, false);
      assert.equal(after.allow, false);
    }
    assert.equal(digestOfValue(decidePure({ policy: r1Policy(), peers: servingApproved() })), R1_WAIT,
      'before the record, the five-reason wait');
  });

  test('CONTRACT: through the real decide command the committed policy refuses exactly the four remaining reasons — REFUSE, allow:false — and the CLI and the pure decision agree byte for byte', async () => {
    const { status, decision } = await decideCommitted();
    assert.equal(status, 1, 'the decision still refuses and exits non-zero');
    assert.equal(decision.decision, 'REFUSE');
    assert.equal(decision.allow, false);
    assert.deepEqual(codesOf(decision), [...FOUR]);
    assert.equal(codesOf(decision).length, 4);
    assert.equal(digestOfValue(decision), digestOfValue(decidePure()));
    assert.equal(digestOfValue(decision), SP_WAIT, 'the wait readiness run 40510386279 recorded');
    assert.notEqual(SP_WAIT, R1_WAIT);
  });

  test('CONTRACT: automatic, publication unset or `false`, that refusal is the recorded non-publishing wait — REFUSE, allow:false, published:false', async () => {
    const { decision } = await decideCommitted();
    for (const enablement of ['', 'false']) {
      const r = classifyWith({ decision, enablement });
      assert.equal(r.kind, AWAITING, JSON.stringify(r.problems));
      assert.equal(r.evaluationCompleted, true);
      assert.equal(r.decision, 'REFUSE');
      assert.equal(r.allow, false);
      assert.equal(r.published, false);
      assert.deepEqual(r.awaiting.map((a) => a.code).sort(), [...FOUR]);
      assert.equal(r.decisionDigest, SP_WAIT);
    }
    assert.deepEqual(classifyWith({ decision, enablement: 'true' }).problems.map((p) => p.code), ['readiness.publication_enabled'],
      'enabling publication is still a failed release, not a wait');
  });

  test('CONTROL: an unrecorded status is still refused by the generic rule — the decision rule did not change, only the committed status', () => {
    const unrecorded = clone(POLICY);
    unrecorded.prerequisites.sourceProtection.status = 'unrecorded';
    const decision = decidePure({ policy: unrecorded, peers: servingApproved() });
    assert.equal(decision.reasons.find((r) => r.code === SP_RESOLVES)?.detail,
      'branch protection on the certified branch has not been recorded or disclosed as a limitation');
    assert.equal(decision.allow, false);
  });

  test('CONTROL: recorded source protection with its old awaiting entry reinserted is a STALE model — red, never a wait', () => {
    const stale = clone(POLICY);
    stale.publication.readiness.awaiting = [...stale.publication.readiness.awaiting, SP_RESOLVES];
    assert.equal(validatePolicy(stale).ok, true, 'the vocabulary is valid; the classifier is what refuses it');
    const decision = decidePure({ policy: stale, peers: servingApproved() });
    assert.equal(codesOf(decision).includes(SP_RESOLVES), false);
    const r = classifyWith({ policy: stale, decision });
    assert.notEqual(r.kind, AWAITING);
    assert.deepEqual(r.problems.map((p) => p.code), ['readiness.expectation_stale']);
    assert.match(r.problems[0].detail, /prerequisite\.source_protection_unrecorded/);
  });

  test('CONTROL: unrecorded source protection omitted from the awaiting list is not silently accepted — red, never a wait', () => {
    const omitted = clone(POLICY);
    omitted.prerequisites.sourceProtection.status = 'unrecorded';
    const decision = decidePure({ policy: omitted, peers: servingApproved() });
    assert.ok(codesOf(decision).includes(SP_RESOLVES));
    const r = classifyWith({ policy: omitted, decision });
    assert.notEqual(r.kind, AWAITING);
    assert.deepEqual(r.problems.map((p) => p.code), ['readiness.unexpected_reason']);
    assert.match(r.problems[0].detail, /prerequisite\.source_protection_unrecorded/);
  });

  test('CONTROL: what the record does not resolve still refuses, and an unexpected reason beside the four is still red', () => {
    const decision = decidePure({ peers: recordedPeers({ adminServes: SUPERSEDED_ADMIN }) });
    assert.ok(codesOf(decision).includes('peers.admin_serving_unapproved'));
    assert.deepEqual(classifyWith({ peers: recordedPeers({ adminServes: SUPERSEDED_ADMIN }), decision }).problems.map((p) => p.code),
      ['readiness.unexpected_reason']);
    for (const code of FOUR) assert.ok(codesOf(decidePure({ peers: servingApproved() })).includes(code), code);
  });

  test('CONTRACT: the record is the re-read observation — dated 2026-10-27, the same ruleset and the same two response digests as 2026-10-15, the newly transcribed pull-request parameters, and every limitation kept', () => {
    const o = POLICY.prerequisites.sourceProtection.observation;
    assert.equal(o.observedOn, '2026-10-27');
    assert.equal(o.branch, 'main');
    assert.match(o.method, /^Read-only GitHub REST GETs on 2026-10-27/);
    assert.match(o.method, /not an anonymous read/);
    assert.match(o.method, /No write, push, force-push, merge or enforcement probe was attempted\.$/);
    assert.deepEqual(o.ruleset, {
      id: 15107355, name: 'main protection', target: 'branch', sourceType: 'Repository', enforcement: 'active',
      include: ['refs/heads/main'], exclude: [], bypassActorsAsReported: [], updatedAt: '2026-06-08T18:38:14.709+01:00',
    });
    assert.deepEqual(o.rules, {
      nonFastForward: true,
      deletion: true,
      requiredStatusChecks: { strict: true, doNotEnforceOnCreate: false, checks: [{ context: 'validate', integrationId: 15368 }] },
      pullRequest: {
        requiredApprovingReviewCount: 0,
        dismissStaleReviewsOnPush: false,
        requiredReviewers: [],
        requireCodeOwnerReview: false,
        requireLastPushApproval: false,
        requiredReviewThreadResolution: false,
        requireExtraApprovalForUnattributedChanges: true,
        allowedMergeMethods: ['merge', 'squash', 'rebase'],
      },
      copilotCodeReview: { reviewOnPush: true, reviewDraftPullRequests: false },
    });
    assert.deepEqual(o.responseSha256, SP1_RESPONSE_DIGESTS_2026_10_15, 'a re-read replaces the digests together; these bodies were byte-identical');
    assert.match(o.classicBranchProtection, /^not enabled: /);
    // Every limitation the 2026-10-15 record stated is still stated, and the new one is added.
    const has = (re) => o.limitations.some((l) => re.test(l));
    for (const re of [
      /^A single read on 2026-10-27, after one on 2026-10-15 /,
      /^Configured, not demonstrated: no push, force-push, deletion or failed-merge probe was attempted/,
      /bypass_actors was reported as an empty list to a non-admin integration identity.*the absence of bypass actors is not established/,
      /required status check is `validate` .*certify\.yml and the readiness evaluation run after a merge and are not merge preconditions/,
      /no approving review is \(required_approving_review_count 0.*can merge their own pull request.*Copilot review is advisory/,
      /require_extra_approval_for_unattributed_changes is reported true and is newly recorded here.*were not established or demonstrated/,
      /^The rules target refs\/heads\/main only\. Other branches carry none of them; only main is certified\.$/,
      /^Classic branch protection is not enabled: .*the ruleset is the only protection observed\.$/,
    ]) assert.ok(has(re), String(re));
    assert.equal(o.limitations.length, 8);
  });

  test('CONTRACT: the backend receipt note now says the repository is public, and that receipts are still verified by the operator procedure', () => {
    const backend = POLICY.compatibleSet.peers.backend;
    assert.equal(backend.receiptVerification, 'operator');
    assert.match(backend._receiptVerification, /^The backend repository is public \(the owner confirmed on 2026-10-27 that this was deliberate\)\./);
    assert.match(backend._receiptVerification, /still verified by the operator procedure/);
    assert.match(backend._receiptVerification, /not made here, and receiptVerification stays operator\.$/);
    assert.doesNotMatch(backend._receiptVerification, /is private/);
  });
});
