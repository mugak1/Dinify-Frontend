/**
 * CONSUMER EVIDENCE BINDER PROOFS (D16 / D08 B4, consumer slice). Discovered by `test:release`.
 *
 * EVERY FIXTURE HERE IS SYNTHETIC, and every descriptor is GENUINE: each case drives the real
 * journey-peers.selectPeerCandidate over a synthetic observation set (the shape
 * journey-peers.test.mjs uses) to obtain a bytes-level descriptor and its canonical digest, then
 * binds a synthetic admission / reconstruction / custody set to it against an INDEPENDENT
 * expectation. The binder is pure; the proofs assert it never accepts, never claims provenance,
 * refuses each single inconsistency by name, and never passes an incomplete expectation vacuously.
 *
 * Both peers are exercised so a binder that refused everything could not pass this suite either.
 *
 * The bounded consumer-binder correction adds three families, each asserted to reach EXACTLY its
 * intended reason (no unrelated refusal riding along) against a genuinely consistent baseline:
 *   C1  the Admin candidate's Backend unpacker is OBSERVED (custody materialisation + the adapter's
 *       measurement of the closure it loaded) and bound to the plan's repository, revision and
 *       required closure — a different valid revision in the plan alone no longer binds;
 *   C2  Stage 2 corroborates only through a custody record that truthfully captured it, with every
 *       identity agreeing (descriptor, admission document, admitted manifest, the consumer's
 *       repository/commit/root tree/closure, the report's own digest); problem-bearing or
 *       contradictory custody refuses, and a Stage-1-only binding stays deferred;
 *   C3  the plan must pin the COMPLETE pinned Stage-1 invocation contract (each peer's mandatory
 *       subtrees and executed helpers), so a coordinated omission refuses instead of agreeing.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { contractDigest, digestOf, digestOfValue, treeDigest } from '../lib/canonical.mjs';
import { receiptDigest } from '../lib/peers.mjs';
import { PEER_FORMATS, SELECTION_SCHEMA, backendListingDigest, peerDescriptorDigest, selectPeerCandidate } from '../lib/journey-peers.mjs';
import { BINDING_SCHEMA, bindConsumerEvidence } from '../lib/journey-consumer.mjs';

const NOW = '2026-10-01T00:00:00Z';
const clone = (v) => JSON.parse(JSON.stringify(v));
const sha1ish = (c) => c.repeat(40);
const hex = (label) => digestOf(Buffer.from(`SYNTHETIC ${label}`)).slice('sha256:'.length);
const dg = (label) => `sha256:${hex(label)}`;
const bytesOf = (v) => Buffer.from(JSON.stringify(v), 'utf8');
const codes = (r) => r.problems.map((p) => p.code);

const ADMISSION_SCHEMA = { backend: 'dinify.journey.backend-admission/2', admin: 'dinify.journey.admin-admission/1' };

const WORLD = {
  backend: { peer: 'backend', repository: 'mugak1/Dinify-Backend', repoId: 910002, workflowId: 920002, commit: sha1ish('c'), tree: sha1ish('d'), runId: '930002', attempt: '1', jobs: ['suite (3.12.3)', 'reconstruct', 'test'] },
  admin: { peer: 'admin', repository: 'mugak1/Dinify-Admin', repoId: 910001, workflowId: 920001, commit: sha1ish('a'), tree: sha1ish('b'), runId: '930001', attempt: '1', jobs: ['validate'] },
};

// The trusted peer-consumer closure (synthetic): the Backend-side subtrees use '_' (its own
// package names); the Admin side uses the 'dependency-audit' spelling its tree carries.
const CONSUMER = {
  backend: { repository: 'mugak1/Dinify-Backend', commit: sha1ish('9'), tree: sha1ish('8'), subtrees: { release: sha1ish('1'), dependency_audit: sha1ish('2') } },
  admin: { repository: 'mugak1/Dinify-Admin', commit: sha1ish('9'), tree: sha1ish('8'), subtrees: { release: sha1ish('1'), 'dependency-audit': sha1ish('2') } },
};
const ADAPTERS = {
  backend: { 'backend_admit.py': dg('admit'), 'trusted_closure.py': dg('closure'), 'peer_unpack.py': dg('unpack'), 'backend_reconstruct.py': dg('recon') },
  admin: { 'admin_admit.mjs': dg('aadmit'), 'trusted_closure.py': dg('closure'), 'peer_unpack.py': dg('unpack') },
};
// The Backend closure that supplies the Admin unpacker (synthetic world). Three parties state it
// independently: the PLAN pins it (UNPACKER, the expectation), the custody boundary states what it
// MATERIALISED from verified git objects (custodyFor), and the admission states what its unpack
// step MEASURED of the closure it loaded (admissionFor). Neither observation is built from the plan.
const UNPACKER_WORLD = { repository: 'mugak1/Dinify-Backend', commit: sha1ish('7'), tree: sha1ish('6'), subtrees: { release: sha1ish('3'), dependency_audit: sha1ish('4') }, manifestDigest: dg('unpacker-closure-manifest') };
const UNPACKER = { repository: 'mugak1/Dinify-Backend', commit: sha1ish('7'), tree: sha1ish('6'), subtrees: { release: sha1ish('3'), dependency_audit: sha1ish('4') }, adapter: 'peer_unpack.py' };
// The caller's independent measurement of the admission document's emitted bytes (synthetic).
const ADMISSION_DIGEST = dg('admission-bytes');

function receiptFor(peer) {
  const w = WORLD[peer];
  if (peer === 'admin') {
    return {
      schema: 'dinify.release.peer-receipt/1', peer, repository: w.repository, commit: w.commit, tree: w.tree,
      sources: [{ name: 'deployWorkflow', path: '.github/workflows/deploy.yml', blob: sha1ish('e') }],
      contracts: {}, publishes: null, unavailable: [], producer: { tool: 'release/cli.mjs peer-receipt', revision: 1 },
    };
  }
  const values = { SYNTHETIC_LIMIT: 1 };
  return {
    schema: 'dinify.release.peer-receipt/1', peer, repository: w.repository, commit: w.commit, tree: w.tree,
    sources: [
      { name: 'd01CheckoutLimits', path: 'orders_app/contracts/checkout_limits.contract.json', blob: sha1ish('f') },
      { name: 'publishedCapabilities', path: 'orders_app/contracts/published_capabilities.contract.json', blob: sha1ish('9') },
    ],
    contracts: { d01CheckoutLimits: { values, digest: contractDigest(values) } },
    publishes: { checkout_protocol: 3, quote_protocol: 2, kitchen_protocol: 1, quote_policy_version: 1 },
    unavailable: [], producer: { tool: 'release/cli.mjs peer-receipt', revision: 1 },
  };
}

function adminRecord() {
  const w = WORLD.admin;
  const entries = [
    { path: 'index.html', sha256: hex('index'), bytes: 100 },
    { path: 'main-SYNTH.js', sha256: hex('main'), bytes: 200 },
    { path: 'release.txt', sha256: hex('release'), bytes: 41 },
  ];
  const evidence = [{ path: 'evidence/audit/result.json', sha256: hex('result'), bytes: 50 }];
  return {
    schema: 'dinify.admin.certification/1', repository: w.repository, commit: w.commit, tree: w.tree,
    workflow: { path: '.github/workflows/ci.yml', ref: 'SYNTHETIC', job: 'validate', event: 'push', gitRef: 'refs/heads/main', runId: w.runId, runAttempt: w.attempt },
    build: { configuration: 'production', command: 'npm run build:prod', environment: { node: 'v20.0.0-synthetic' } },
    source: { digest: dg('source') },
    payload: {
      treeDigest: treeDigest(entries), entryCount: entries.length, bytes: 341, indexSha256: hex('index'),
      release: { path: 'release.txt', commit: w.commit }, entries,
      archive: { path: 'payload.tar.gz', sha256: hex('payload-archive'), bytes: 999 },
    },
    evidence: { treeDigest: treeDigest(evidence), files: evidence },
    audit: { outcome: 'within_policy', exitCode: 0 },
  };
}

function backendRecord() {
  const w = WORLD.backend;
  const wheels = [
    { filename: 'synthetic_pkg-1.0.0-py3-none-any.whl', name: 'synthetic-pkg', version: '1.0.0', role: 'application', sha256: hex('wheel-1'), size: 10 },
    { filename: 'pip-25.2-py3-none-any.whl', name: 'pip', version: '25.2', role: 'bootstrap', sha256: hex('wheel-2'), size: 20 },
  ];
  return {
    schema: 'dinify.backend.candidate/1', repository: w.repository, commit: w.commit, tree: w.tree, createdAt: NOW,
    eligibility: { promotable: true, reason: 'SYNTHETIC' },
    artifact: { name: `backend-candidate-${w.runId}-${w.attempt}`, note: 'SYNTHETIC' },
    ci: { workflowRef: `${w.repository}/.github/workflows/ci.yml@refs/heads/main`, event: 'push', ref: 'refs/heads/main', sha: w.commit, repository: w.repository, runId: w.runId, runAttempt: w.attempt },
    target: { python: '3.12.3', implementation: 'CPython', platform: 'linux', machine: 'x86_64', libc: 'glibc 2.39' },
    inputs: { requirements: { path: 'requirements.txt', sha256: hex('reqs') }, lock: { path: 'release/python-lock.json', sha256: hex('lock') } },
    source: { archive: { path: 'source.tar', sha256: hex('source-tar'), size: 1234 }, tree: w.tree, files: 7, contentSha256: hex('content') },
    wheelhouse: { files: wheels, digest: backendListingDigest(wheels) },
    environment: { packages: [{ name: 'SYNTHETIC — never returned' }], digest: hex('environment') },
    audit: { outcome: 'within_policy' },
  };
}

function artifactEntry(peer, name, archive, id) {
  const w = WORLD[peer];
  return {
    id, node_id: 'SYNTHETIC', name, size_in_bytes: archive.length, url: 'https://api.example.invalid/SYNTHETIC',
    archive_download_url: 'https://api.example.invalid/SYNTHETIC/zip', expired: false,
    created_at: '2026-09-27T19:38:20Z', updated_at: '2026-09-27T19:38:20Z', expires_at: '2026-10-27T19:38:19Z',
    digest: digestOf(archive),
    workflow_run: { id: Number(w.runId), repository_id: w.repoId, head_repository_id: w.repoId, head_branch: 'main', head_sha: w.commit },
  };
}

/** A genuine bytes-level descriptor and its canonical digest, for `peer`. */
function descriptorFor(peer) {
  const w = WORLD[peer];
  const rec = receiptFor(peer);
  const record = peer === 'admin' ? adminRecord() : backendRecord();
  const candidateArchive = Buffer.from(`SYNTHETIC ${peer} candidate archive bytes`);
  const listed = [artifactEntry(peer, `${peer}-candidate-${w.runId}-${w.attempt}`, candidateArchive, 940101)];
  if (peer === 'backend') listed.push(artifactEntry(peer, `backend-reconstruction-${w.runId}-${w.attempt}`, Buffer.from('SYNTHETIC backend-reconstruction'), 940102));
  const runObj = {
    id: Number(w.runId), workflow_id: w.workflowId, path: '.github/workflows/ci.yml', run_attempt: Number(w.attempt), event: 'push',
    status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: w.commit,
    repository: { id: w.repoId, full_name: w.repository }, head_repository: { id: w.repoId, full_name: w.repository },
  };
  const expected = {
    schema: SELECTION_SCHEMA, peer, repository: w.repository, source: { commit: w.commit, tree: w.tree },
    receipt: { commit: w.commit, digest: receiptDigest(rec) },
    producer: { workflowPath: '.github/workflows/ci.yml', event: 'push', ref: 'refs/heads/main' },
    run: { id: w.runId, attempt: w.attempt }, requiredJobs: [...w.jobs],
  };
  const observations = {
    workflow: { id: w.workflowId, path: '.github/workflows/ci.yml', name: 'CI' }, run: runObj, latestRun: clone(runObj),
    jobs: { total_count: w.jobs.length, jobs: w.jobs.map((name, n) => ({ id: 950100 + n, run_id: Number(w.runId), run_attempt: Number(w.attempt), name, status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: w.commit })) },
    artifacts: { total_count: listed.length, artifacts: listed }, commit: { sha: w.commit, tree: { sha: w.tree } }, receipt: rec,
    archive: candidateArchive, record: bytesOf(record),
  };
  const sel = selectPeerCandidate({ expected, observations, now: NOW, require: 'bytes' });
  assert.equal(sel.ok, true, `${peer}: ${JSON.stringify(sel.reasons)}`);
  return { descriptor: sel.descriptor, descriptorDigest: peerDescriptorDigest(sel.descriptor) };
}

const DESC = { backend: descriptorFor('backend'), admin: descriptorFor('admin') };

function admissionFor(peer) {
  const w = WORLD[peer];
  const { descriptor, descriptorDigest } = DESC[peer];
  const art = descriptor.artifacts.candidate;
  const ids = PEER_FORMATS[peer].deferred.map((d) => d.split(':')[0]);
  const checks = {};
  for (const id of ids) checks[id] = (peer === 'backend' && id === 'environment-reconstruction') ? { status: 'deferred', reason: 'needs the contained reconstruction stage' } : { status: 'checked', by: 'consumer.verify' };
  const a = {
    schema: ADMISSION_SCHEMA[peer], decision: 'admitted', peer,
    inputs: { descriptorDigest, expect: { repository: w.repository, commit: w.commit, tree: w.tree, runId: w.runId, runAttempt: w.attempt } },
    consumer: clone(CONSUMER[peer]),
    candidate: { id: art.id, name: art.name, listedDigest: art.listedDigest, size: art.size, measuredDigest: descriptor.bytes.archive.measuredDigest, record: { file: descriptor.bytes.record.file, sha256: descriptor.bytes.record.measuredDigest } },
    admitted: { manifestDigest: dg(`${peer} manifest`), files: 14 },
    checks, problems: [], residuals: ['historical audit verified; fresh assessment not performed; no release admission'],
  };
  if (peer === 'backend') {
    const rc = descriptor.artifacts.reconstruction;
    a.reconstructionCompanion = { name: rc.name, id: rc.id, listedDigest: rc.listedDigest, measuredDigest: rc.listedDigest, size: rc.size, boundToRecord: true };
    // The candidate's own recorded facts, taken from the producer's descriptor claims so a
    // consistent handoff agrees with them (the real adapter re-derives these from the record bytes).
    const cl = descriptor.claims;
    a.candidate.facts = { tree: descriptor.source.tree, sourceArchiveSha256: cl.sourceArchiveSha256, wheelhouseDigest: cl.wheelhouseDigest, environmentDigest: cl.environmentDigest, auditOutcome: cl.auditOutcome, target: { ...cl.target } };
    // The consumer closure's manifest digest, matching the custody record's closure.manifestDigest.
    a.consumer.closureManifestDigest = dg('closure-manifest');
    // The consumer verifier's echoed account of what it processed (verifyExpect), consistent with
    // the descriptor and selection so a well-formed backend handoff binds.
    a.verifyExpect = { repository: w.repository, commit: w.commit, tree: w.tree, workflowPath: '.github/workflows/ci.yml', event: 'push', ref: 'refs/heads/main', runId: w.runId, runAttempt: w.attempt, artifact: art.name, local: false };
  }
  if (peer === 'admin') {
    // What the unpack step MEASURED when it loaded the Backend closure: the shape peer_unpack.py
    // reports ({function, closure: {subtrees, manifestDigest}}), recomputed from the bytes it imported.
    a.unpacker = { function: 'release/preflight.py unpack', closure: { subtrees: clone(UNPACKER_WORLD.subtrees), manifestDigest: UNPACKER_WORLD.manifestDigest } };
  }
  return a;
}

function custodyFor(peer, admission) {
  const { descriptorDigest } = DESC[peer];
  const c = {
    schema: 'dinify.journey.custody/1', descriptorDigest,
    admission: { descriptorDigest, decision: 'admitted', sha256: ADMISSION_DIGEST },
    admitted: { manifestDigest: admission.admitted.manifestDigest, recordSha256: admission.candidate.record.sha256 },
    closure: { commit: CONSUMER[peer].commit, tree: CONSUMER[peer].tree, manifestDigest: dg('closure-manifest'), subtrees: clone(CONSUMER[peer].subtrees) },
    adapters: clone(ADAPTERS[peer]), reconstruction: { ran: false }, problems: [],
  };
  // What the custody boundary MATERIALISED for the Admin path's Backend unpacker dependency.
  if (peer === 'admin') c.unpacker = clone(UNPACKER_WORLD);
  return c;
}

function expectedFor(peer) {
  const w = WORLD[peer];
  const e = {
    selection: {
      peer, repository: w.repository, source: { commit: w.commit, tree: w.tree },
      receipt: { commit: w.commit, digest: receiptDigest(receiptFor(peer)) },
      producer: { workflowPath: '.github/workflows/ci.yml', event: 'push', ref: 'refs/heads/main' },
      run: { id: w.runId, attempt: w.attempt }, requiredJobs: [...w.jobs],
    },
    consumer: clone(CONSUMER[peer]),
    adapters: clone(ADAPTERS[peer]),
  };
  if (peer === 'backend') {
    const rc = DESC.backend.descriptor.artifacts.reconstruction;
    e.companion = { name: rc.name, id: rc.id, listedDigest: rc.listedDigest, size: rc.size };
  }
  if (peer === 'admin') e.unpacker = clone(UNPACKER);
  return e;
}

/** A complete, consistent handoff for `peer`; every part a fresh clone the caller may mutate. */
function handoff(peer) {
  const { descriptor, descriptorDigest } = DESC[peer];
  const admission = admissionFor(peer);
  return { descriptor, descriptorDigest, admission, admissionDigest: ADMISSION_DIGEST, custody: custodyFor(peer, admission), expected: expectedFor(peer) };
}

/** A complete, consistent Stage-2 report: it names this descriptor, this admission document, the
 *  admitted manifest and the consumer's COMPLETE identity (repository, commit, root tree, subtrees,
 *  closure manifest). */
function reconstructionFor(over = {}) {
  const { descriptorDigest } = DESC.backend;
  const a = admissionFor('backend');
  return {
    schema: 'dinify.journey.backend-reconstruction/1', outcome: 'success', problems: [],
    startup: { kind: 'pinned-consumer-startup' },
    inputs: { admissionDescriptorDigest: descriptorDigest, admissionSha256: ADMISSION_DIGEST },
    admitted: { manifestDigest: a.admitted.manifestDigest },
    consumer: { ...clone(CONSUMER.backend), closureManifestDigest: a.consumer.closureManifestDigest },
    ...over,
  };
}

/** The synthetic Stage-2 adapter's emitted bytes, measured the SAME way by the custody boundary and
 *  by the caller (the binder compares the two claims; it never hashes the report). */
const emittedDigest = (doc) => digestOf(Buffer.from(`${JSON.stringify(doc)}\n`, 'utf8'));

/**
 * Put a TRUTHFUL Stage 2 into handoff `h`: the report (optionally mutated, as a real adapter would
 * have emitted it), its measured digest, and the custody record the boundary would have written for
 * it — requested, `ran` as given (exit 0 iff the report succeeded), the report's digest, both
 * unchanged assertions re-verified true, and the startup kind read from that same report. A single
 * fault is then applied by the caller AFTER this, so it is the only thing that disagrees.
 */
function withStage2(h, { ran = true, mutate } = {}) {
  const report = ran ? reconstructionFor() : reconstructionFor({ outcome: 'failed', problems: ['SYNTHETIC rebuild problem'] });
  if (mutate) mutate(report);
  h.reconstruction = report;
  h.reconstructionDigest = emittedDigest(report);
  h.custody.reconstruction = {
    sha256: h.reconstructionDigest, ran, closureUnchanged: true, admittedUnchanged: true,
    startupKind: report.startup?.kind ?? null,
  };
  return h;
}

// ── the always-true invariants and the positive controls ─────────────────────────

describe('SYNTHETIC: a consistent handoff binds, and never asserts a verdict', () => {
  for (const peer of ['backend', 'admin']) {
    test(`CONTROL (${peer}): a consistent set is consistent, never accepted, never provenance`, () => {
      const h = handoff(peer);
      const r = bindConsumerEvidence(h);
      assert.deepEqual(r.problems, []);
      assert.equal(r.consistent, true);
      assert.equal(r.accepted, false);
      assert.equal(r.provenance, 'unestablished');
      assert.equal(r.schema, BINDING_SCHEMA);
      assert.equal(r.descriptorDigest, h.descriptorDigest);
      // Every reviewed discharge is accounted for; the Backend keeps exactly one deferred check.
      const want = PEER_FORMATS[peer].deferred.map((d) => d.split(':')[0]);
      assert.deepEqual(Object.keys(r.checks).sort(), [...want].sort());
      assert.deepEqual(r.deferred, peer === 'backend' ? ['environment-reconstruction: the offline rebuild by the trusted consumer checkout on the target (CPython 3.12.3, Linux x86_64, glibc 2.39 minimum)'] : []);
      if (peer === 'backend') assert.equal(r.checks['environment-reconstruction'].status, 'deferred');
    });
  }

  test('CONTROL (backend): a successful, custody-bound, agreeing reconstruction corroborates — still deferred, still not accepted', () => {
    const h = withStage2(handoff('backend'));
    // The positive no longer inherits a custody record of a stage that never ran: the boundary
    // captured THIS report (its digest), recorded completion and both unchanged assertions.
    assert.equal(h.custody.reconstruction.ran, true);
    assert.equal(h.custody.reconstruction.sha256, h.reconstructionDigest);
    const r = bindConsumerEvidence(h);
    assert.deepEqual(r.problems, []);
    assert.equal(r.consistent, true);
    assert.equal(r.accepted, false);
    assert.equal(r.provenance, 'unestablished');
    assert.equal(r.checks['environment-reconstruction'].status, 'corroborated');
    // Corroboration is NOT a discharge: the check still appears in the deferred list.
    assert.deepEqual(r.deferred, ['environment-reconstruction: the offline rebuild by the trusted consumer checkout on the target (CPython 3.12.3, Linux x86_64, glibc 2.39 minimum)']);
  });

  test('CONTROL (backend): a requested-but-failed, otherwise consistent reconstruction withholds corroboration, no refusal', () => {
    const h = withStage2(handoff('backend'), { ran: false });
    assert.equal(h.custody.reconstruction.ran, false);
    const r = bindConsumerEvidence(h);
    assert.deepEqual(r.problems, []);
    assert.equal(r.consistent, true);
    assert.equal(r.accepted, false);
    assert.equal(r.checks['environment-reconstruction'].status, 'deferred');
  });

  test("CONTROL (backend): a Stage-1-only handoff carrying the supervisor's own deferral sentence binds, deferred", () => {
    // The custody boundary's actual not-requested shape (supervise.py): ran false, no captured report.
    const h = handoff('backend');
    h.custody.reconstruction = { ran: false, deferred: 'the contained reconstruction runs only in the identified disposable lab (--contain --root)' };
    const r = bindConsumerEvidence(h);
    assert.deepEqual(r.problems, []);
    assert.equal(r.consistent, true);
    assert.equal(r.checks['environment-reconstruction'].status, 'deferred');
  });

  test('CONTROL (backend): a Stage-1-only plan pinning EXACTLY the three Stage-1 helpers binds — the Stage-2 helper is never forced', () => {
    const h = handoff('backend');
    delete h.expected.adapters['backend_reconstruct.py'];
    delete h.custody.adapters['backend_reconstruct.py'];
    assert.deepEqual(Object.keys(h.expected.adapters).sort(), ['backend_admit.py', 'peer_unpack.py', 'trusted_closure.py']);
    const r = bindConsumerEvidence(h);
    assert.deepEqual(r.problems, []);
    assert.equal(r.consistent, true);
    assert.equal(r.checks['environment-reconstruction'].status, 'deferred');
  });

  test('CONTROL (admin): the observed unpacker binds — the measured closure and the custody materialisation agree with the plan', () => {
    const h = handoff('admin');
    // Three independent statements of one dependency; none is the plan object.
    assert.notEqual(h.custody.unpacker, h.expected.unpacker);
    assert.notEqual(h.admission.unpacker.closure.subtrees, h.expected.unpacker.subtrees);
    const r = bindConsumerEvidence(h);
    assert.deepEqual(r.problems, []);
    assert.equal(r.consistent, true);
    assert.equal(r.accepted, false);
    assert.equal(r.provenance, 'unestablished');
  });

  test('CONTROL (admin): a custody record that omits the Stage-2 record binds — the Admin path has no Stage 2', () => {
    const h = handoff('admin');
    delete h.custody.reconstruction;
    const r = bindConsumerEvidence(h);
    assert.deepEqual(r.problems, []);
    assert.equal(r.consistent, true);
    assert.equal(r.accepted, false);
  });

  test('CONTROL (admin): a revision the plan pins AND the custody boundary materialised binds — the rule compares, it does not hardcode', () => {
    // The plan is the independent authority on which Backend revision supplies the unpacker; when the
    // custody record materialised exactly that revision, the binding holds. (The plan ALONE moving is
    // the refused case below.)
    const h = handoff('admin');
    h.expected.unpacker.commit = sha1ish('0');
    h.custody.unpacker.commit = sha1ish('0');
    const r = bindConsumerEvidence(h);
    assert.deepEqual(r.problems, []);
    assert.equal(r.consistent, true);
  });

  test('INVARIANT: accepted:false / provenance:unestablished on a FABRICATED-but-consistent set and on every refusal', () => {
    // A fabricated set demonstrates CONSISTENCY ONLY — it is still never accepted.
    assert.equal(bindConsumerEvidence(handoff('backend')).accepted, false);
    // And a wholly broken input refuses without ever flipping the invariant.
    const bad = bindConsumerEvidence({});
    assert.equal(bad.consistent, false);
    assert.equal(bad.accepted, false);
    assert.equal(bad.provenance, 'unestablished');
    // A refusal exposes no apparently-successful comparisons as a usable decision.
    assert.deepEqual(bad.checks, {});
    assert.deepEqual(bad.deferred, []);
  });

  test('the binder reaches no verdict key', () => {
    // Structural: the binder imports only journey-peers.mjs (and, through it, that module's own imports).
    // Here we only pin that the result object exposes no verdict and stays unestablished.
    const r = bindConsumerEvidence(handoff('admin'));
    assert.ok(!('released' in r) && !('admittedForRelease' in r));
    assert.equal(r.provenance, 'unestablished');
  });
});

// ── single-fault refusals: each flips ONE fact, everything else stays valid ───────

const CASES = [
  // the descriptor itself
  ['backend', 'a B2 observation-result summary, not a descriptor', (h) => { h.descriptor = { schema: 'dinify.journey.peer-observation-result/1', peer: 'backend' }; }, 'descriptor_is_observation_summary'],
  ['backend', 'a metadata-only descriptor has no bytes to bind', (h) => { h.descriptor = { ...clone(h.descriptor), status: 'metadata-consistent-bytes-not-established' }; }, 'descriptor_not_bytes_level'],
  ['backend', 'a descriptorDigest that is not this descriptor', (h) => { h.descriptorDigest = `sha256:${'0'.repeat(64)}`; }, 'descriptor_digest_mismatch'],
  // the admission shape
  ['backend', 'an admission for the other peer', (h) => { h.admission.schema = ADMISSION_SCHEMA.admin; }, 'admission_invalid'],
  ['backend', 'an admission that is not admitted', (h) => { h.admission.decision = 'refused'; }, 'admission_not_admitted'],
  ['backend', 'an admission asserting a verdict key', (h) => { h.admission.accepted = true; }, 'admission_asserts_verdict'],
  ['admin', 'an admission asserting provenance', (h) => { h.admission.provenance = 'established'; }, 'admission_asserts_verdict'],
  ['backend', 'an admission produced for another descriptor', (h) => { h.admission.inputs.descriptorDigest = dg('other'); }, 'admission_foreign'],
  ['backend', 'an admitted admission that also reports problems', (h) => { h.admission.problems = ['SYNTHETIC verification failure']; }, 'admission_reports_problems'],
  // the deferred-check id set
  ['backend', 'an admission that clears environment-reconstruction', (h) => { h.admission.checks['environment-reconstruction'] = { status: 'checked', by: 'forged' }; }, 'check_overcleared'],
  ['backend', 'an admission with a foreign (Admin) discharge id', (h) => { h.admission.checks['payload-tree'] = { status: 'checked' }; }, 'check_unknown'],
  ['backend', 'an admission missing a reviewed discharge', (h) => { delete h.admission.checks['source-archive']; }, 'check_missing'],
  ['admin', 'an admission that left a check un-discharged', (h) => { h.admission.checks['payload-archive'] = { status: 'pending' }; }, 'check_not_discharged'],
  // the independent expectation — incompleteness refuses, never passes vacuously
  ['backend', 'no independent expectation at all', (h) => { h.expected = undefined; }, 'expected_missing'],
  ['backend', 'an expectation with no selection', (h) => { delete h.expected.selection; }, 'expected_incomplete'],
  ['backend', 'an expectation with an empty consumer subtree set', (h) => { h.expected.consumer.subtrees = {}; }, 'expected_incomplete'],
  ['backend', 'an expectation that pins no adapter', (h) => { h.expected.adapters = {}; }, 'expected_incomplete'],
  ['backend', 'a backend expectation with no companion', (h) => { delete h.expected.companion; }, 'expected_incomplete'],
  ['admin', 'an admin expectation with no pinned unpacker', (h) => { delete h.expected.unpacker; }, 'expected_incomplete'],
  // the descriptor against the independent selection
  ['backend', 'the selection names a different source commit than the descriptor', (h) => { const c = sha1ish('7'); h.expected.selection.source.commit = c; h.expected.selection.receipt.commit = c; }, 'source_commit_mismatch'],
  ['backend', 'the expected receipt digest differs', (h) => { h.expected.selection.receipt.digest = dg('other-receipt'); }, 'receipt_digest_mismatch'],
  // §5 producer binds are now exercised DESCRIPTOR-side: a selection-side producer change trips the
  // §3 format anchor below first, so the descriptor must disagree with the (anchored) selection here
  ['admin', 'the descriptor producer event differs from the anchored selection', (h) => { const d = clone(h.descriptor); d.producer.event = 'pull_request'; h.descriptorDigest = peerDescriptorDigest(d); h.descriptor = d; h.admission.inputs.descriptorDigest = h.descriptorDigest; h.custody.descriptorDigest = h.descriptorDigest; h.custody.admission.descriptorDigest = h.descriptorDigest; }, 'producer_event_mismatch'],
  ['backend', 'the expected run attempt differs', (h) => { h.expected.selection.run.attempt = '2'; }, 'attempt_mismatch'],
  // the selection must be ANCHORED to the fixed peer format, not merely agree with the other documents
  // (a whole set naming evil/Other, descriptor digest recomputed, would otherwise bind consistently)
  ['backend', 'a selection naming a foreign repository', (h) => { h.expected.selection.repository = 'evil/Other'; }, 'selection_repository_unanchored'],
  ['admin', 'a selection whose producer is not the peer format', (h) => { h.expected.selection.producer.event = 'pull_request'; }, 'selection_producer_unanchored'],
  ['backend', 'a selection whose source commit is not a sha', (h) => { h.expected.selection.source.commit = 'bad'; }, 'selection_unpinned'],
  // a receipt for ANOTHER revision — both receipt commits moved together so §5 receipt_commit_mismatch
  // still agrees; only the §3 receipt.commit === source.commit invariant catches it
  ['backend', 'a receipt naming a different commit than the source (both sides, digest recomputed)', (h) => { const c = sha1ish('7'); const d = clone(h.descriptor); d.receipt.commit = c; h.descriptorDigest = peerDescriptorDigest(d); h.descriptor = d; h.admission.inputs.descriptorDigest = h.descriptorDigest; h.custody.descriptorDigest = h.descriptorDigest; h.custody.admission.descriptorDigest = h.descriptorDigest; h.expected.selection.receipt.commit = c; }, 'selection_unpinned'],
  // the expected plan's pinned identities must be well-formed shas/digests, not merely present
  ['backend', 'an expected consumer commit that is not a sha', (h) => { h.expected.consumer.commit = 'bad'; }, 'expected_unpinned'],
  ['backend', 'an expected adapter hash that is not a digest', (h) => { h.expected.adapters['trusted_closure.py'] = 'bad'; }, 'expected_unpinned'],
  ['backend', 'a companion pin whose listed digest is malformed', (h) => { h.expected.companion.listedDigest = 'bad'; }, 'expected_unpinned'],
  // the selection's required-job set must be present and every job must appear in the descriptor run
  ['backend', 'an expected selection with an empty required-job set', (h) => { h.expected.selection.requiredJobs = []; }, 'expected_incomplete'],
  ['backend', 'the selection requires a job the descriptor run lacks', (h) => { h.expected.selection.requiredJobs = [...h.expected.selection.requiredJobs, 'security-scan']; }, 'required_job_missing'],
  // a NARROWED selection drops BELOW the peer's mandatory job set: every listed job is still in the
  // descriptor (so the step-5 expected ⊆ descriptor loop cannot see it), but a mandatory job is gone
  ['backend', 'a narrowed selection dropping the backend-mandatory suite/reconstruct jobs', (h) => { h.expected.selection.requiredJobs = ['test']; }, 'expected_jobs_narrowed'],
  ['admin', 'a narrowed selection dropping the admin-mandatory validate job', (h) => { h.expected.selection.requiredJobs = ['build']; }, 'expected_jobs_narrowed'],
  // the admission's self-report against the descriptor
  ['backend', 'the admitted candidate name disagrees', (h) => { h.admission.candidate.name = 'backend-candidate-1-1'; }, 'artifact_name_mismatch'],
  ['backend', 'the admitted record sha disagrees with the descriptor', (h) => { h.admission.candidate.record.sha256 = dg('wrong-record'); }, 'record_digest_mismatch'],
  ['admin', 'the admitted record filename disagrees', (h) => { h.admission.candidate.record.file = 'record.json'; }, 'record_file_mismatch'],
  ['backend', 'the admitted archive digest disagrees', (h) => { h.admission.candidate.measuredDigest = dg('wrong-archive'); }, 'archive_digest_mismatch'],
  // the candidate's LISTED digest moved on BOTH sides while the measured bytes stayed: listed-to-listed
  // and measured-to-measured still agree, but the archive's downloaded bytes no longer match what the
  // provider listed. Moving the descriptor's listed digest re-derives the descriptor digest, so the
  // admission/custody digest references are re-pinned too (mirroring the absent-run-id case below).
  ['backend', 'the candidate listed digest moved on both sides while measured stayed', (h) => {
    const d = clone(h.descriptor);
    const X = dg('relisted-archive');
    d.artifacts.candidate.listedDigest = X;
    h.descriptorDigest = peerDescriptorDigest(d);
    h.descriptor = d;
    h.admission.inputs.descriptorDigest = h.descriptorDigest;
    h.admission.candidate.listedDigest = X;
    h.custody.descriptorDigest = h.descriptorDigest;
    h.custody.admission.descriptorDigest = h.descriptorDigest;
  }, 'candidate_measured_mismatch'],
  // the candidate artifact identity must be WELL FORMED, not merely agree between admission and
  // descriptor — malformed values moved together (digest recomputed) would otherwise masquerade as a
  // selected artifact. Same precedent as the companion pin.
  ['backend', 'a candidate artifact id that is not a positive id (both sides)', (h) => { const d = clone(h.descriptor); d.artifacts.candidate.id = 'bad'; h.descriptorDigest = peerDescriptorDigest(d); h.descriptor = d; h.admission.inputs.descriptorDigest = h.descriptorDigest; h.admission.candidate.id = 'bad'; h.custody.descriptorDigest = h.descriptorDigest; h.custody.admission.descriptorDigest = h.descriptorDigest; }, 'artifact_unpinned'],
  ['admin', 'a candidate artifact name that is not the deterministic name (both sides)', (h) => { const d = clone(h.descriptor); d.artifacts.candidate.name = 'totally-arbitrary'; h.descriptorDigest = peerDescriptorDigest(d); h.descriptor = d; h.admission.inputs.descriptorDigest = h.descriptorDigest; h.admission.candidate.name = 'totally-arbitrary'; h.custody.descriptorDigest = h.descriptorDigest; h.custody.admission.descriptorDigest = h.descriptorDigest; }, 'artifact_unpinned'],
  ['backend', 'the admission processed another commit', (h) => { h.admission.inputs.expect.commit = sha1ish('7'); }, 'admission_commit_mismatch'],
  ['backend', 'the admission processed another repository', (h) => { h.admission.inputs.expect.repository = 'mugak1/Dinify-Admin'; }, 'admission_repository_mismatch'],
  // the consumer verifier's echoed expectation (verifyExpect) bound to the descriptor/selection
  ['backend', 'the verifier echo names another repository', (h) => { h.admission.verifyExpect.repository = 'mugak1/Dinify-Admin'; }, 'verify_expect_repository_mismatch'],
  ['backend', 'the verifier echo names another artifact', (h) => { h.admission.verifyExpect.artifact = 'backend-candidate-9999-9'; }, 'verify_expect_artifact_mismatch'],
  ['backend', 'a backend admission with no verifier echo', (h) => { delete h.admission.verifyExpect; }, 'verify_expect_missing'],
  // the consumer closure against the independent plan
  ['backend', 'the expected consumer commit differs', (h) => { h.expected.consumer.commit = sha1ish('e'); }, 'consumer_commit_mismatch'],
  ['backend', 'a consumer subtree disagrees', (h) => { h.expected.consumer.subtrees.release = sha1ish('f'); }, 'consumer_subtree_mismatch'],
  ['backend', 'an extra consumer subtree the plan does not expect', (h) => { h.admission.consumer.subtrees.extra = sha1ish('5'); }, 'consumer_subtree_mismatch'],
  // the admin unpacker dependency
  ['admin', 'the pinned unpacker is not Dinify-Backend', (h) => { h.expected.unpacker.repository = 'mugak1/Dinify-Admin'; }, 'unpacker_repository_mismatch'],
  ['admin', 'the pinned unpacker adapter is not among the bound adapters', (h) => { h.expected.unpacker.adapter = 'ghost_unpack.py'; }, 'unpacker_unbound'],
  ['admin', 'an unpacker adapter inherited from Object.prototype (in vs hasOwn)', (h) => { h.expected.unpacker.adapter = 'toString'; }, 'unpacker_unbound'],
  // the backend companion, full identity
  ['backend', 'the companion listed digest disagrees', (h) => { h.expected.companion.listedDigest = dg('wrong-companion'); }, 'companion_listed_mismatch'],
  ['backend', 'the admission companion is not bound to the record', (h) => { h.admission.reconstructionCompanion.boundToRecord = false; }, 'companion_unbound'],
  ['backend', 'the admission companion measured digest disagrees with the listed', (h) => { h.admission.reconstructionCompanion.measuredDigest = dg('wrong-companion-bytes'); }, 'companion_measured_mismatch'],
  // the reconstruction report — each fault rides on a TRUTHFUL custody record of the stage
  // (withStage2), so it reaches its own reason rather than an unrelated custody contradiction
  ['backend', 'a stub reconstruction offered as production', (h) => { withStage2(h, { mutate: (r) => { r.startup.kind = 'synthetic-stub'; } }); }, 'reconstruction_stub'],
  ['backend', 'a reconstruction bound to another descriptor', (h) => { withStage2(h, { mutate: (r) => { r.inputs.admissionDescriptorDigest = dg('other'); } }); }, 'reconstruction_foreign'],
  ['backend', 'a reconstruction contradicting the admitted manifest', (h) => { withStage2(h, { mutate: (r) => { r.admitted.manifestDigest = dg('wrong-manifest'); } }); }, 'reconstruction_contradictory'],
  ['admin', 'a reconstruction offered for an admin binding', (h) => { h.reconstruction = { schema: 'dinify.journey.backend-reconstruction/1', startup: { kind: 'pinned-consumer-startup' } }; }, 'reconstruction_peer_inappropriate'],
  // the custody record — mandatory, bound, and non-vacuous
  ['backend', 'no supervisor custody record', (h) => { h.custody = undefined; }, 'custody_missing'],
  ['backend', 'a custody record with the wrong schema', (h) => { h.custody.schema = 'dinify.journey.custody/2'; }, 'custody_invalid'],
  ['backend', 'a custody record omitting its descriptor identity', (h) => { delete h.custody.descriptorDigest; }, 'custody_foreign'],
  ['backend', 'a custody record for another descriptor', (h) => { h.custody.descriptorDigest = dg('other'); }, 'custody_foreign'],
  ['backend', "a custody record naming another admission's digest", (h) => { h.custody.admission.sha256 = dg('other-admission'); }, 'custody_admission_sha_mismatch'],
  ['backend', 'a custody admitted-manifest that disagrees', (h) => { h.custody.admitted.manifestDigest = dg('wrong-manifest'); }, 'custody_manifest_mismatch'],
  ['backend', 'a custody closure commit that disagrees', (h) => { h.custody.closure.commit = sha1ish('e'); }, 'custody_closure_commit_mismatch'],
  ['backend', 'a tampered custody adapter hash', (h) => { h.custody.adapters['trusted_closure.py'] = dg('tampered'); }, 'adapter_hash_mismatch'],
  ['backend', 'a custody adapter set that drops an adapter', (h) => { delete h.custody.adapters['trusted_closure.py']; }, 'adapter_set_mismatch'],
  // the candidate's OWN recorded facts against the producer's descriptor claims (step 6b, backend)
  ['backend', 'the candidate wheelhouse digest disagrees with the producer claim', (h) => { h.admission.candidate.facts.wheelhouseDigest = hex('wrong-wheelhouse'); }, 'facts_wheelhouse_mismatch'],
  ['backend', 'the candidate environment digest disagrees with the producer claim', (h) => { h.admission.candidate.facts.environmentDigest = hex('wrong-environment'); }, 'facts_environment_mismatch'],
  ['backend', 'the candidate source-archive digest disagrees with the producer claim', (h) => { h.admission.candidate.facts.sourceArchiveSha256 = dg('wrong-source'); }, 'facts_source_archive_mismatch'],
  ['backend', 'the candidate audit outcome disagrees with the producer claim', (h) => { h.admission.candidate.facts.auditOutcome = 'blocking'; }, 'facts_audit_mismatch'],
  ['backend', 'the candidate record tree disagrees with the descriptor', (h) => { h.admission.candidate.facts.tree = sha1ish('7'); }, 'facts_tree_mismatch'],
  ['backend', 'the candidate target python disagrees with the producer claim', (h) => { h.admission.candidate.facts.target.python = '3.13.0'; }, 'facts_target_mismatch'],
  // the ADMISSION companion's full identity, not just its name (step 8, backend)
  ['backend', 'the admission companion id disagrees with the plan', (h) => { h.admission.reconstructionCompanion.id = 999999; }, 'companion_admission_id_mismatch'],
  ['backend', 'the admission companion listed digest disagrees with the plan', (h) => { h.admission.reconstructionCompanion.listedDigest = dg('wrong-companion'); }, 'companion_admission_listed_mismatch'],
  ['backend', 'the admission companion size disagrees with the plan', (h) => { h.admission.reconstructionCompanion.size = 2; }, 'companion_admission_size_mismatch'],
  // the custody closure's full identity against the admission's consumer closure (step 10)
  ['backend', 'a custody closure manifest digest that disagrees with the admission', (h) => { h.custody.closure.manifestDigest = dg('wrong-closure'); }, 'custody_closure_manifest_mismatch'],
  ['backend', 'a custody closure subtree that disagrees with the admission', (h) => { h.custody.closure.subtrees.release = sha1ish('f'); }, 'custody_closure_subtree_mismatch'],
  ['admin', 'a custody closure subtree set that drops a subtree (admin)', (h) => { delete h.custody.closure.subtrees.release; }, 'custody_closure_subtree_mismatch'],
  // an id absent on BOTH sides must refuse, never collapse to 'undefined' === 'undefined' (bindId).
  // Uses the candidate artifact id: §3 now format-checks sel.run.id, so the run id can no longer be
  // made absent on the selection to exercise this — the artifact id is cross-checked (§6) and not §3-guarded.
  ['backend', 'an id absent on both the descriptor and the admission', (h) => { const d = clone(h.descriptor); delete d.artifacts.candidate.id; h.descriptorDigest = peerDescriptorDigest(d); h.descriptor = d; h.admission.inputs.descriptorDigest = h.descriptorDigest; delete h.admission.candidate.id; h.custody.descriptorDigest = h.descriptorDigest; h.custody.admission.descriptorDigest = h.descriptorDigest; }, 'artifact_id_mismatch'],
];

describe('SYNTHETIC: each single inconsistency is refused by name, and never accepts', () => {
  for (const [peer, name, fault, expectedCode] of CASES) {
    test(`REFUSAL (${peer}): ${name}`, () => {
      const h = handoff(peer);
      fault(h);
      const r = bindConsumerEvidence(h);
      assert.equal(r.consistent, false, `expected a refusal; problems=${JSON.stringify(r.problems)}`);
      assert.equal(r.accepted, false);
      assert.equal(r.provenance, 'unestablished');
      const c = codes(r);
      assert.ok(c.includes(`journey.consumer.${expectedCode}`), `expected journey.consumer.${expectedCode}, got ${JSON.stringify(c)}`);
      // The refusal must not be an unrelated custody-missing (unless that IS the fault).
      if (expectedCode !== 'custody_missing') assert.ok(!c.includes('journey.consumer.custody_missing'), `unrelated custody_missing leaked: ${JSON.stringify(c)}`);
      // A refusal withholds every apparently-successful comparison.
      assert.deepEqual(r.checks, {});
      assert.deepEqual(r.deferred, []);
    });
  }
});

// ── the bounded consumer-binder correction: each fault reaches EXACTLY its intended reason ──────
//
// Every entry starts from a genuinely consistent handoff (the controls above prove it binds) and
// flips ONE fact. The assertion is the exact SET of refusal codes, so a fault that is refused only
// by an unrelated omitted field — or that drags a second, unrelated reason along — fails here.
const SUBTREE_DROP = (name) => (h) => { delete h.expected.consumer.subtrees[name]; delete h.admission.consumer.subtrees[name]; delete h.custody.closure.subtrees[name]; };
const HELPER_DROP = (name) => (h) => { delete h.expected.adapters[name]; delete h.custody.adapters[name]; };

const EXACT_CASES = [
  // ── C1: the Admin candidate's Backend unpacker is observed, not only planned ──
  ['admin', 'C1: ONE DIFFERENT VALID REVISION — only the plan pins another full commit sha (the reviewed gap)', (h) => { h.expected.unpacker.commit = sha1ish('0'); }, ['unpacker_revision_mismatch']],
  ['admin', 'C1: only the plan pins another valid root tree', (h) => { h.expected.unpacker.tree = sha1ish('0'); }, ['unpacker_revision_mismatch']],
  ['admin', 'C1: the custody boundary materialised another valid revision than the plan pins', (h) => { h.custody.unpacker.commit = sha1ish('0'); }, ['unpacker_revision_mismatch']],
  ['admin', 'C1: the admission carries no observation of the unpacker closure it loaded', (h) => { delete h.admission.unpacker; }, ['unpacker_observation_missing']],
  ['admin', 'C1: the observation names another function than the pinned preflight.unpack', (h) => { h.admission.unpacker.function = 'release/other.py unpack'; }, ['unpacker_observation_invalid']],
  ['admin', 'C1: the observation states no measured closure manifest', (h) => { delete h.admission.unpacker.closure.manifestDigest; }, ['unpacker_observation_invalid']],
  ['admin', 'C1: the custody record does not state the unpacker closure it materialised', (h) => { delete h.custody.unpacker; }, ['custody_unpacker_missing']],
  ['admin', 'C1: the custody unpacker record carries a malformed revision', (h) => { h.custody.unpacker.commit = 'bad'; }, ['custody_unpacker_invalid']],
  ['admin', 'C1: the custody boundary materialised the unpacker from a FOREIGN repository', (h) => { h.custody.unpacker.repository = 'mugak1/Dinify-Admin'; }, ['unpacker_repository_mismatch']],
  ['admin', 'C1: the measured closure is a FOREIGN one (another subtree sha)', (h) => { h.admission.unpacker.closure.subtrees.release = sha1ish('0'); }, ['unpacker_closure_mismatch']],
  ['admin', "C1: the measured closure is the Admin subtree set, not the Backend one", (h) => { const s = h.admission.unpacker.closure.subtrees; s['dependency-audit'] = s.dependency_audit; delete s.dependency_audit; }, ['unpacker_closure_mismatch']],
  ['admin', 'C1: the materialised closure is a FOREIGN one (another subtree sha)', (h) => { h.custody.unpacker.subtrees.dependency_audit = sha1ish('0'); }, ['unpacker_closure_mismatch']],
  ['admin', 'C1: the measured closure carries an extra subtree beyond the pinned set', (h) => { h.admission.unpacker.closure.subtrees.orders_app = sha1ish('5'); }, ['unpacker_closure_mismatch']],
  ['admin', 'C1: the materialised closure carries an extra subtree beyond the pinned set', (h) => { h.custody.unpacker.subtrees.orders_app = sha1ish('5'); }, ['unpacker_closure_mismatch']],
  ['admin', 'C1: the measured and the materialised closure manifests disagree', (h) => { h.admission.unpacker.closure.manifestDigest = dg('another-closure'); }, ['unpacker_manifest_mismatch']],
  ['admin', 'C1: a COORDINATED omission of dependency_audit from the pinned, materialised and measured closure', (h) => { delete h.expected.unpacker.subtrees.dependency_audit; delete h.custody.unpacker.subtrees.dependency_audit; delete h.admission.unpacker.closure.subtrees.dependency_audit; }, ['unpacker_closure_incomplete']],
  ['admin', 'C1: the plan names the trusted-closure helper as the unpacker', (h) => { h.expected.unpacker.adapter = 'trusted_closure.py'; }, ['unpacker_unbound']],
  ['admin', 'C1: a malformed pinned unpacker root tree', (h) => { h.expected.unpacker.tree = 'bad'; }, ['unpacker_commit_invalid']],
  ['admin', 'C1: a pinned unpacker subtree that is not a sha', (h) => { h.expected.unpacker.subtrees.release = 'bad'; }, ['unpacker_closure_incomplete']],
  // Each observation is VALIDATED before it is compared: a malformed one refuses as malformed, never
  // as a coincidental disagreement with the plan.
  ['admin', 'C1: the observation states no measured closure at all', (h) => { delete h.admission.unpacker.closure; }, ['unpacker_observation_invalid']],
  ['admin', 'C1: the observation states an EMPTY measured closure', (h) => { h.admission.unpacker.closure.subtrees = {}; }, ['unpacker_observation_invalid']],
  ['admin', 'C1: an observed closure subtree that is not a sha', (h) => { h.admission.unpacker.closure.subtrees.release = 'bad'; }, ['unpacker_observation_invalid']],
  ['admin', 'C1: the custody unpacker repository is not a statement', (h) => { h.custody.unpacker.repository = 42; }, ['custody_unpacker_invalid']],
  ['admin', 'C1: the custody unpacker root tree is not a sha', (h) => { h.custody.unpacker.tree = 'bad'; }, ['custody_unpacker_invalid']],
  ['admin', 'C1: the custody unpacker states an EMPTY materialised closure', (h) => { h.custody.unpacker.subtrees = {}; }, ['custody_unpacker_invalid']],
  ['admin', 'C1: a materialised closure subtree that is not a sha', (h) => { h.custody.unpacker.subtrees.release = 'bad'; }, ['custody_unpacker_invalid']],
  ['admin', 'C1: the custody unpacker closure manifest is not a digest', (h) => { h.custody.unpacker.manifestDigest = 'bad'; }, ['custody_unpacker_invalid']],
  // ── C2: Stage 2 is custody-bound corroboration ──
  ['backend', 'C2: a successful report the custody record never captured (custody: not run)', (h) => { withStage2(h); h.custody.reconstruction = { ran: false }; }, ['reconstruction_uncustodied']],
  ['backend', 'C2: a reconstruction digest offered with no report and no custody record of the stage', (h) => { h.reconstructionDigest = dg('a-reconstruction'); }, ['reconstruction_uncustodied']],
  ['backend', 'C2: the custody record captured a report the handoff omits', (h) => { withStage2(h); delete h.reconstruction; }, ['reconstruction_missing']],
  ['backend', 'C2: the custody record captured a report whose measured digest is not supplied', (h) => { withStage2(h); delete h.reconstructionDigest; }, ['reconstruction_missing']],
  ['backend', 'C2: custody records a FAILED stage while the report claims success', (h) => { withStage2(h); h.custody.reconstruction.ran = false; }, ['reconstruction_outcome_contradictory']],
  ['backend', 'C2: custody records a COMPLETED stage while the report failed', (h) => { withStage2(h, { mutate: (r) => { r.outcome = 'failed'; r.problems = ['SYNTHETIC rebuild problem']; } }); }, ['reconstruction_outcome_contradictory']],
  ['backend', 'C2: the report claims success while listing problems', (h) => { withStage2(h, { mutate: (r) => { r.problems = ['SYNTHETIC rebuild problem']; } }); }, ['reconstruction_outcome_contradictory']],
  ['backend', 'C2: the custody boundary did not re-verify the trusted closure unchanged', (h) => { withStage2(h); h.custody.reconstruction.closureUnchanged = false; }, ['custody_reconstruction_changed']],
  ['backend', 'C2: the custody boundary did not re-verify the admitted directory unchanged', (h) => { withStage2(h); h.custody.reconstruction.admittedUnchanged = false; }, ['custody_reconstruction_changed']],
  ['backend', 'C2: a FAILED stage whose closure changed is refused, not merely deferred', (h) => { withStage2(h, { ran: false }); h.custody.reconstruction.closureUnchanged = false; }, ['custody_reconstruction_changed']],
  ['backend', 'C2: a custody record that reports problems (Stage-1-only)', (h) => { h.custody.problems = [{ code: 'admission_refused', detail: 'SYNTHETIC custody stop' }]; }, ['custody_reports_problems']],
  ['backend', 'C2: a custody record that reports problems (with a corroborating Stage 2)', (h) => { withStage2(h); h.custody.problems = [{ code: 'SYNTHETIC', detail: 'SYNTHETIC custody stop' }]; }, ['custody_reports_problems']],
  ['backend', 'C2: a custody record with no problems list', (h) => { delete h.custody.problems; }, ['custody_invalid']],
  ['backend', 'C2: a custody record with no reconstruction stage record', (h) => { delete h.custody.reconstruction; }, ['custody_reconstruction_invalid']],
  ['backend', 'C2: a custody stage record whose ran is not a boolean', (h) => { h.custody.reconstruction = { ran: 'no' }; }, ['custody_reconstruction_invalid']],
  ['backend', 'C2: a custody record claiming a completed stage it captured no report of', (h) => { h.custody.reconstruction = { ran: true }; }, ['custody_reconstruction_invalid']],
  ['backend', 'C2: a not-requested custody record asserting a Stage-2 fact', (h) => { h.custody.reconstruction = { ran: false, closureUnchanged: true }; }, ['custody_reconstruction_invalid']],
  ['backend', 'C2: a not-requested custody record whose deferral is not a statement', (h) => { h.custody.reconstruction = { ran: false, deferred: 42 }; }, ['custody_reconstruction_invalid']],
  ['backend', 'C2: a requested-stage custody record whose startup kind is not a statement', (h) => { withStage2(h); h.custody.reconstruction.startupKind = 42; }, ['custody_reconstruction_invalid']],
  // A custody boundary that could not read the startup kind of the very bytes it captured (null)
  // has not established the pinned startup; the report saying so on its own is not enough.
  ['backend', 'C2: the custody boundary could not read the startup kind of the report it captured', (h) => { withStage2(h); h.custody.reconstruction.startupKind = null; }, ['reconstruction_stub']],
  ['backend', 'C2: a requested-stage custody record with a malformed report digest', (h) => { withStage2(h); h.custody.reconstruction.sha256 = 'bad'; }, ['custody_reconstruction_invalid']],
  ['backend', 'C2: a requested-stage custody record missing an unchanged assertion', (h) => { withStage2(h); delete h.custody.reconstruction.admittedUnchanged; }, ['custody_reconstruction_invalid']],
  ['backend', 'C2: the measured digest is not the report the custody boundary captured', (h) => { withStage2(h); h.reconstructionDigest = dg('another-report'); }, ['reconstruction_digest_mismatch']],
  ['backend', 'C2: a malformed measured reconstruction digest', (h) => { withStage2(h); h.reconstructionDigest = 'bad'; }, ['reconstruction_digest_invalid']],
  ['backend', 'C2: a FOREIGN consumer repository with the same commit (the reviewed gap)', (h) => { withStage2(h, { mutate: (r) => { r.consumer.repository = 'evil/Other'; } }); }, ['reconstruction_consumer_mismatch']],
  ['backend', 'C2: a FOREIGN consumer root tree with the same commit (the reviewed gap)', (h) => { withStage2(h, { mutate: (r) => { r.consumer.tree = sha1ish('0'); } }); }, ['reconstruction_consumer_mismatch']],
  ['backend', 'C2: a consumer commit that differs (same repository, same root tree)', (h) => { withStage2(h, { mutate: (r) => { r.consumer.commit = sha1ish('0'); } }); }, ['reconstruction_consumer_mismatch']],
  ['backend', 'C2: a consumer subtree that differs', (h) => { withStage2(h, { mutate: (r) => { r.consumer.subtrees.release = sha1ish('0'); } }); }, ['reconstruction_consumer_mismatch']],
  ['backend', 'C2: a consumer subtree set missing a subtree', (h) => { withStage2(h, { mutate: (r) => { delete r.consumer.subtrees.dependency_audit; } }); }, ['reconstruction_consumer_mismatch']],
  ['backend', 'C2: a consumer closure manifest that differs', (h) => { withStage2(h, { mutate: (r) => { r.consumer.closureManifestDigest = dg('another-closure'); } }); }, ['reconstruction_consumer_mismatch']],
  ['backend', 'C2: the report names another admission document (admission identity)', (h) => { withStage2(h, { mutate: (r) => { r.inputs.admissionSha256 = dg('another-admission'); } }); }, ['reconstruction_admission_mismatch']],
  ['backend', 'C2: the custody boundary read a stub startup from the report it captured', (h) => { withStage2(h); h.custody.reconstruction.startupKind = 'synthetic-stub'; }, ['reconstruction_stub']],
  // The report itself says stub while the custody record says pinned (digests re-measured over the
  // stub report, so the startup disagreement is the only fault): either statement alone refuses.
  ['backend', 'C2: the report states a stub startup that the custody boundary recorded as pinned', (h) => { withStage2(h); h.reconstruction.startup.kind = 'synthetic-stub'; h.reconstructionDigest = emittedDigest(h.reconstruction); h.custody.reconstruction.sha256 = h.reconstructionDigest; }, ['reconstruction_stub']],
  ['backend', 'C2: malformed — the report states no outcome', (h) => { withStage2(h, { mutate: (r) => { delete r.outcome; } }); }, ['reconstruction_invalid']],
  ['backend', 'C2: malformed — the report problems are not a list', (h) => { withStage2(h, { mutate: (r) => { r.problems = 'none'; } }); }, ['reconstruction_invalid']],
  ['backend', 'C2: malformed — the report states no consumer identity', (h) => { withStage2(h, { mutate: (r) => { delete r.consumer; } }); }, ['reconstruction_invalid']],
  ['backend', 'C2: malformed — the report names a malformed admission digest', (h) => { withStage2(h, { mutate: (r) => { r.inputs.admissionSha256 = 'bad'; } }); }, ['reconstruction_invalid']],
  ['backend', 'C2: malformed — the report names no admitted manifest', (h) => { withStage2(h, { mutate: (r) => { delete r.admitted; } }); }, ['reconstruction_invalid']],
  ['backend', 'C2: malformed — not a reconstruction document', (h) => { withStage2(h, { mutate: (r) => { r.schema = 'dinify.journey.backend-reconstruction-stub/1'; } }); }, ['reconstruction_invalid']],
  // Every field the report is compared on is validated first: each of these would otherwise reach a
  // comparison (stub, foreign, contradictory, consumer or outcome) and refuse for a coincidental reason.
  ['backend', 'C2: malformed — the report states no startup', (h) => { withStage2(h, { mutate: (r) => { delete r.startup; } }); }, ['reconstruction_invalid']],
  ['backend', 'C2: malformed — the report startup kind is not a statement (the boundary could not read one)', (h) => { withStage2(h, { mutate: (r) => { r.startup.kind = 42; } }); h.custody.reconstruction.startupKind = null; }, ['reconstruction_invalid']],
  ['backend', 'C2: malformed — the report outcome is empty', (h) => { withStage2(h, { mutate: (r) => { r.outcome = ''; } }); }, ['reconstruction_invalid']],
  ['backend', 'C2: malformed — the report names a malformed descriptor digest', (h) => { withStage2(h, { mutate: (r) => { r.inputs.admissionDescriptorDigest = 'bad'; } }); }, ['reconstruction_invalid']],
  ['backend', 'C2: malformed — the report names a malformed admitted manifest', (h) => { withStage2(h, { mutate: (r) => { r.admitted.manifestDigest = 'bad'; } }); }, ['reconstruction_invalid']],
  ['backend', 'C2: malformed — the report consumer repository is not a statement', (h) => { withStage2(h, { mutate: (r) => { r.consumer.repository = 42; } }); }, ['reconstruction_invalid']],
  ['backend', 'C2: malformed — the report consumer commit is not a sha', (h) => { withStage2(h, { mutate: (r) => { r.consumer.commit = 'bad'; } }); }, ['reconstruction_invalid']],
  ['backend', 'C2: malformed — the report consumer root tree is not a sha', (h) => { withStage2(h, { mutate: (r) => { r.consumer.tree = 'bad'; } }); }, ['reconstruction_invalid']],
  ['backend', 'C2: malformed — a report consumer subtree is not a sha', (h) => { withStage2(h, { mutate: (r) => { r.consumer.subtrees.release = 'bad'; } }); }, ['reconstruction_invalid']],
  ['backend', 'C2: malformed — the report consumer closure manifest is not a digest', (h) => { withStage2(h, { mutate: (r) => { r.consumer.closureManifestDigest = 'bad'; } }); }, ['reconstruction_invalid']],
  ['admin', 'C2: a reconstruction digest offered for an admin binding', (h) => { h.reconstructionDigest = dg('a-reconstruction'); }, ['reconstruction_peer_inappropriate']],
  ['admin', 'C2: an admin custody record of a requested Stage 2', (h) => { h.custody.reconstruction = { sha256: dg('a-reconstruction'), ran: true, closureUnchanged: true, admittedUnchanged: true, startupKind: 'pinned-consumer-startup' }; }, ['reconstruction_peer_inappropriate']],
  // A requested-stage record states no deferral: the boundary either captured the stage or did not.
  ['backend', 'C2: a requested-stage custody record that ALSO states a deferral', (h) => { withStage2(h); h.custody.reconstruction.deferred = 'SYNTHETIC: the contained reconstruction was not run'; }, ['custody_reconstruction_invalid']],
  // The binder cannot see which bytes a claimant hashed, only whether the claims agree; what it can
  // see is that different documents cannot share a digest. Each case keeps the claims in agreement,
  // so the only fault is the collision.
  ['backend', 'C2: the measured admission digest IS the descriptor digest (the custody record agrees)', (h) => { h.admissionDigest = h.descriptorDigest; h.custody.admission.sha256 = h.descriptorDigest; }, ['admission_digest_invalid']],
  ['backend', 'C2: the measured reconstruction digest IS the admission digest (the custody record agrees)', (h) => { withStage2(h); h.reconstructionDigest = h.admissionDigest; h.custody.reconstruction.sha256 = h.admissionDigest; }, ['reconstruction_digest_invalid']],
  ['backend', 'C2: the measured reconstruction digest IS the descriptor digest (the custody record agrees)', (h) => { withStage2(h); h.reconstructionDigest = h.descriptorDigest; h.custody.reconstruction.sha256 = h.descriptorDigest; }, ['reconstruction_digest_invalid']],
  // Only a CUSTODY record of the stage puts Stage 2 in play: a stray report on a Stage-1-only plan is
  // refused as uncustodied — the plan, which correctly pins no Stage-2 helper, is not the fault.
  ['backend', 'C2: a stray report on a Stage-1-only plan without the Stage-2 helper is uncustodied, not a plan fault', (h) => { withStage2(h); h.custody.reconstruction = { ran: false }; HELPER_DROP('backend_reconstruct.py')(h); }, ['reconstruction_uncustodied']],
  // ── C3: the complete pinned Stage-1 invocation contract ──
  ['backend', 'C3: dependency_audit dropped from the plan, the admission and the custody TOGETHER (the reviewed gap)', SUBTREE_DROP('dependency_audit'), ['expected_subtree_missing']],
  ['backend', 'C3: release dropped from the plan, the admission and the custody together', SUBTREE_DROP('release'), ['expected_subtree_missing']],
  ['admin', 'C3: dependency-audit dropped from the plan, the admission and the custody together', SUBTREE_DROP('dependency-audit'), ['expected_subtree_missing']],
  ['admin', 'C3: release dropped from the plan, the admission and the custody together (admin)', SUBTREE_DROP('release'), ['expected_subtree_missing']],
  ['backend', 'C3: an extra subtree the Stage-1 adapter never loads, in the plan, admission and custody together', (h) => { for (const m of [h.expected.consumer.subtrees, h.admission.consumer.subtrees, h.custody.closure.subtrees]) m.orders_app = sha1ish('5'); }, ['expected_subtree_unexpected']],
  ['backend', 'C3: trusted_closure.py dropped from the plan and the custody TOGETHER (the reviewed gap)', HELPER_DROP('trusted_closure.py'), ['expected_helper_missing']],
  ['backend', 'C3: backend_admit.py dropped from the plan and the custody together', HELPER_DROP('backend_admit.py'), ['expected_helper_missing']],
  ['backend', 'C3: peer_unpack.py dropped from the plan and the custody together', HELPER_DROP('peer_unpack.py'), ['expected_helper_missing']],
  ['admin', 'C3: trusted_closure.py dropped from the plan and the custody together (admin)', HELPER_DROP('trusted_closure.py'), ['expected_helper_missing']],
  ['admin', 'C3: peer_unpack.py dropped from the plan and the custody together (admin)', HELPER_DROP('peer_unpack.py'), ['expected_helper_missing']],
  ['admin', 'C3: admin_admit.mjs dropped from the plan and the custody together', HELPER_DROP('admin_admit.mjs'), ['expected_helper_missing']],
  ['backend', 'C3: Stage 2 in play while the plan and the custody omit its helper', (h) => { withStage2(h); HELPER_DROP('backend_reconstruct.py')(h); }, ['expected_helper_missing']],
  ['backend', 'C3: the custody record alone puts Stage 2 in play (no report offered) while the plan and the custody omit its helper', (h) => { withStage2(h); delete h.reconstruction; delete h.reconstructionDigest; HELPER_DROP('backend_reconstruct.py')(h); }, ['expected_helper_missing']],
  ['backend', 'C3: a helper no backend stage executes, pinned in the plan and the custody', (h) => { h.expected.adapters['ghost.py'] = dg('ghost'); h.custody.adapters['ghost.py'] = dg('ghost'); }, ['expected_helper_unknown']],
  ['admin', 'C3: the backend-only Stage-2 helper pinned on an admin plan and custody', (h) => { h.expected.adapters['backend_reconstruct.py'] = dg('recon'); h.custody.adapters['backend_reconstruct.py'] = dg('recon'); }, ['expected_helper_unknown']],
  ['backend', 'C3: a COORDINATED foreign consumer repository (plan and admission together)', (h) => { h.expected.consumer.repository = 'evil/Other'; h.admission.consumer.repository = 'evil/Other'; }, ['expected_consumer_unanchored']],
];

describe('SYNTHETIC: the bounded consumer-binder correction — each fault reaches exactly its intended reason', () => {
  for (const [peer, name, fault, expectedCodes] of EXACT_CASES) {
    test(`REFUSAL (${peer}): ${name}`, () => {
      const h = handoff(peer);
      fault(h);
      const r = bindConsumerEvidence(h);
      assert.equal(r.consistent, false, `expected a refusal; problems=${JSON.stringify(r.problems)}`);
      assert.equal(r.accepted, false);
      assert.equal(r.provenance, 'unestablished');
      assert.deepEqual([...new Set(codes(r))].sort(), expectedCodes.map((c) => `journey.consumer.${c}`).sort());
      assert.deepEqual(r.checks, {});
      assert.deepEqual(r.deferred, []);
      assert.deepEqual(r.residuals, []);
    });
  }

  test('one-sided omissions still refuse by their existing names (the coordinated rule adds, never replaces)', () => {
    // Backend: the admission alone drops a mandatory subtree → the plan↔admission bind refuses.
    const a = handoff('backend'); delete a.admission.consumer.subtrees.dependency_audit;
    assert.ok(codes(bindConsumerEvidence(a)).includes('journey.consumer.consumer_subtree_mismatch'));
    // Backend: the custody alone drops a mandatory helper → the custody adapter-set bind refuses.
    const b = handoff('backend'); delete b.custody.adapters['trusted_closure.py'];
    assert.ok(codes(bindConsumerEvidence(b)).includes('journey.consumer.adapter_set_mismatch'));
    // Admin: the custody closure alone drops a mandatory subtree → the custody closure bind refuses.
    const c = handoff('admin'); delete c.custody.closure.subtrees['dependency-audit'];
    assert.ok(codes(bindConsumerEvidence(c)).includes('journey.consumer.custody_closure_subtree_mismatch'));
  });
});

// ── CI replay: the committed synthetic admission fixture (the REAL descriptor digest) ─────────
//
// `journey-consumer-admission.fixture.json` is produced OUT OF BAND, retained, and replayed HERE
// against committed code. Its descriptor and descriptorDigest are the output of the REAL committed
// journey-peers (selectPeerCandidate, require 'bytes'; peerDescriptorDigest) over a synthetic
// Dinify-Backend candidate whose record.json carries the canonical SIX-KEY wheelhouse the producer
// writes — the exact shape Section 1 taught journey-peers.backendRecord to accept. Its admission is
// the output of the REAL private Backend Stage-1 adapter (backend_admit.py) over its verified
// trusted-consumer closure and the candidate bytes; the custody and the independent expectation are
// schema-faithful supervisor artifacts. This block re-derives the digest and re-runs the binder,
// and is the regression anchor that the six-key-wheelhouse descriptor path stays wired end to end
// to a consistent, never-accepted binding — carrying the REAL digest the handoff was once blocked
// (by that same six-key refusal) from ever emitting, where a placeholder stood before.
describe('CI replay: the committed synthetic admission fixture binds with the real descriptor digest', () => {
  const fixture = JSON.parse(readFileSync(new URL('./journey-consumer-admission.fixture.json', import.meta.url), 'utf8'));
  const PLACEHOLDER = `sha256:${'ab'.repeat(32)}`;

  test('the fixture is a well-formed, synthetic, revisioned consumer-admission fixture', () => {
    assert.equal(fixture.schema, 'dinify.journey.consumer-admission-fixture/1');
    assert.equal(typeof fixture.revision, 'number');
    assert.equal(fixture.provenance.synthetic, true);
    // Provenance RECORDS the code that produced the fixture; it is a statement, never a pin — the
    // replay below asserts behaviour (digest re-derivation and binding), not that the committed lib
    // still hashes to these values.
    assert.match(fixture.provenance.generatedWith.committed['release/lib/journey-consumer.mjs'], /^sha256:[0-9a-f]{64}$/);
    assert.match(fixture.provenance.generatedWith.committed['release/lib/journey-peers.mjs'], /^sha256:[0-9a-f]{64}$/);
    assert.match(fixture.provenance.generatedWith.privateAdapters['backend_admit.py'], /^sha256:[0-9a-f]{64}$/);
    // The trusted consumer is the approved pilot-12 Backend peer, recorded as provenance.
    assert.equal(fixture.provenance.trustedConsumer.repository, 'mugak1/Dinify-Backend');
  });

  test('the committed journey-peers re-derives the fixture descriptor digest', () => {
    const { descriptor, descriptorDigest } = fixture.binding;
    assert.equal(peerDescriptorDigest(descriptor), descriptorDigest);
  });

  test('the REAL descriptor digest threads the descriptor, the admission and the custody — the placeholder is gone', () => {
    const { descriptor, descriptorDigest, admission, custody } = fixture.binding;
    // The handoff was once blocked at B1 (the six-key wheelhouse was refused), so no descriptor
    // existed and the admission carried the opaque placeholder. Section 1 unblocked it; every
    // document now names the one real canonical digest.
    assert.notEqual(descriptorDigest, PLACEHOLDER);
    assert.equal(peerDescriptorDigest(descriptor), descriptorDigest);
    assert.equal(admission.inputs.descriptorDigest, descriptorDigest);
    assert.equal(custody.descriptorDigest, descriptorDigest);
    assert.equal(custody.admission.descriptorDigest, descriptorDigest);
    // The record.json that drove the descriptor is the canonical six-key-wheelhouse shape.
    assert.equal(descriptor.bytes.record.file, 'record.json');
    assert.equal(descriptor.claims.wheelCount, 3);
  });

  test('the recorded admission digest is over the STATED representation: keys sorted, two-space indent, one final LF', () => {
    // The binder never hashes the admission; it compares the caller's measurement with the custody
    // record's, both over the bytes the Stage-1 adapter emitted. This pins WHICH bytes the fixture's
    // recorded value is over, so the boundary is explicit rather than inferred: the decoded admission,
    // keys sorted at every depth, two-space indentation and one final LF (backend_admit.py's
    // json.dumps(doc, sort_keys=True, indent=2) + "\n"), hashes to exactly the recorded digest.
    const { admission, admissionDigest, custody } = fixture.binding;
    const sortDeep = (v) => (Array.isArray(v) ? v.map(sortDeep)
      : (v !== null && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])])) : v);
    // Key order is part of the representation, so it is ESTABLISHED by sorting rather than inherited
    // from however the fixture happens to store the document: every object's keys are reversed first.
    const reverseDeep = (v) => (Array.isArray(v) ? v.map(reverseDeep)
      : (v !== null && typeof v === 'object') ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reverseDeep(v[k])])) : v);
    const text = `${JSON.stringify(sortDeep(reverseDeep(admission)), null, 2)}\n`;
    // The two conditions under which this JavaScript serialisation is byte-for-byte the Python one:
    // the text is pure ASCII (no ensure_ascii escaping can differ) and every number is an integer
    // (no float formatting can differ). Asserted, not assumed.
    assert.ok(/^[\x00-\x7f]*$/.test(text), 'the fixture admission serialises to pure ASCII');
    const integersOnly = (v) => (Array.isArray(v) ? v.every(integersOnly)
      : (v !== null && typeof v === 'object') ? Object.values(v).every(integersOnly) : (typeof v !== 'number' || Number.isSafeInteger(v)));
    assert.ok(integersOnly(admission), 'the fixture admission carries integers only');
    assert.equal(digestOf(Buffer.from(text, 'utf8')), admissionDigest);
    // Control: the same document left unsorted serialises to other bytes, which do not hash to it.
    assert.notEqual(digestOf(Buffer.from(`${JSON.stringify(reverseDeep(admission), null, 2)}\n`, 'utf8')), admissionDigest);
    assert.equal(custody.admission.sha256, admissionDigest);
    // The fixture is a Stage-1-only handoff: the custody boundary captured no Stage-2 report.
    assert.deepEqual(custody.reconstruction, { ran: false });
    assert.deepEqual(custody.problems, []);
  });

  test('the committed binder reproduces the recorded verdict: consistent, never accepted, no provenance', () => {
    const { descriptor, descriptorDigest, admission, admissionDigest, custody, expected } = fixture.binding;
    const r = bindConsumerEvidence({ descriptor, descriptorDigest, admission, admissionDigest, custody, expected });
    assert.deepEqual(r, fixture.verdict);
    assert.equal(r.schema, BINDING_SCHEMA);
    assert.equal(r.consistent, true);
    assert.equal(r.accepted, false);
    assert.equal(r.provenance, 'unestablished');
    assert.deepEqual(r.problems, []);
    // Every reviewed Backend check is accounted for, and environment-reconstruction stays deferred
    // (no Pass C was run): the fixture never corroborates it.
    assert.equal(r.checks['environment-reconstruction'].status, 'deferred');
    assert.deepEqual(r.deferred, ['environment-reconstruction: the offline rebuild by the trusted consumer checkout on the target (CPython 3.12.3, Linux x86_64, glibc 2.39 minimum)']);
  });
});
