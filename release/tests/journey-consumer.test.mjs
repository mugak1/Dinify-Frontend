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
const UNPACKER = { repository: 'mugak1/Dinify-Backend', commit: sha1ish('7'), adapter: 'peer_unpack.py' };

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
    a.reconstructionCompanion = { name: rc.name, id: rc.id, listedDigest: rc.listedDigest, size: rc.size, boundToRecord: true };
    // The candidate's own recorded facts, taken from the producer's descriptor claims so a
    // consistent handoff agrees with them (the real adapter re-derives these from the record bytes).
    const cl = descriptor.claims;
    a.candidate.facts = { tree: descriptor.source.tree, sourceArchiveSha256: cl.sourceArchiveSha256, wheelhouseDigest: cl.wheelhouseDigest, environmentDigest: cl.environmentDigest, auditOutcome: cl.auditOutcome, target: { ...cl.target } };
    // The consumer closure's manifest digest, matching the custody record's closure.manifestDigest.
    a.consumer.closureManifestDigest = dg('closure-manifest');
  }
  return a;
}

function custodyFor(peer, admission) {
  const { descriptorDigest } = DESC[peer];
  return {
    schema: 'dinify.journey.custody/1', descriptorDigest,
    admission: { descriptorDigest, decision: 'admitted', sha256: dg('admission-bytes') },
    admitted: { manifestDigest: admission.admitted.manifestDigest, recordSha256: admission.candidate.record.sha256 },
    closure: { commit: CONSUMER[peer].commit, tree: CONSUMER[peer].tree, manifestDigest: dg('closure-manifest'), subtrees: clone(CONSUMER[peer].subtrees) },
    adapters: clone(ADAPTERS[peer]), reconstruction: { ran: false }, problems: [],
  };
}

function expectedFor(peer) {
  const w = WORLD[peer];
  const e = {
    selection: {
      peer, repository: w.repository, source: { commit: w.commit, tree: w.tree },
      receipt: { commit: w.commit, digest: receiptDigest(receiptFor(peer)) },
      producer: { workflowPath: '.github/workflows/ci.yml', event: 'push', ref: 'refs/heads/main' },
      run: { id: w.runId, attempt: w.attempt },
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
  return { descriptor, descriptorDigest, admission, custody: custodyFor(peer, admission), expected: expectedFor(peer) };
}

function reconstructionFor(over = {}) {
  const { descriptorDigest } = DESC.backend;
  const a = admissionFor('backend');
  return {
    schema: 'dinify.journey.backend-reconstruction/1', outcome: 'success', problems: [],
    startup: { kind: 'pinned-consumer-startup' },
    inputs: { admissionDescriptorDigest: descriptorDigest },
    admitted: { manifestDigest: a.admitted.manifestDigest }, consumer: { commit: CONSUMER.backend.commit },
    ...over,
  };
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

  test('CONTROL (backend): a successful, agreeing reconstruction corroborates — still deferred, still not accepted', () => {
    const h = handoff('backend');
    const r = bindConsumerEvidence({ ...h, reconstruction: reconstructionFor() });
    assert.deepEqual(r.problems, []);
    assert.equal(r.consistent, true);
    assert.equal(r.accepted, false);
    assert.equal(r.provenance, 'unestablished');
    assert.equal(r.checks['environment-reconstruction'].status, 'corroborated');
    // Corroboration is NOT a discharge: the check still appears in the deferred list.
    assert.deepEqual(r.deferred, ['environment-reconstruction: the offline rebuild by the trusted consumer checkout on the target (CPython 3.12.3, Linux x86_64, glibc 2.39 minimum)']);
  });

  test('CONTROL (backend): a present-but-unsuccessful reconstruction withholds corroboration, no refusal', () => {
    const h = handoff('backend');
    const r = bindConsumerEvidence({ ...h, reconstruction: reconstructionFor({ outcome: 'failed', problems: ['SYNTHETIC rebuild problem'] }) });
    assert.deepEqual(r.problems, []);
    assert.equal(r.consistent, true);
    assert.equal(r.checks['environment-reconstruction'].status, 'deferred');
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
    // Structural: the binder imports only journey-peers.mjs (and, transitively, canonical.mjs).
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
  ['backend', 'the expected source commit differs', (h) => { h.expected.selection.source.commit = sha1ish('7'); }, 'source_commit_mismatch'],
  ['backend', 'the expected receipt digest differs', (h) => { h.expected.selection.receipt.digest = dg('other-receipt'); }, 'receipt_digest_mismatch'],
  ['admin', 'the expected producer event differs', (h) => { h.expected.selection.producer.event = 'pull_request'; }, 'producer_event_mismatch'],
  ['backend', 'the expected run attempt differs', (h) => { h.expected.selection.run.attempt = '2'; }, 'attempt_mismatch'],
  // the admission's self-report against the descriptor
  ['backend', 'the admitted candidate name disagrees', (h) => { h.admission.candidate.name = 'backend-candidate-1-1'; }, 'artifact_name_mismatch'],
  ['backend', 'the admitted record sha disagrees with the descriptor', (h) => { h.admission.candidate.record.sha256 = dg('wrong-record'); }, 'record_digest_mismatch'],
  ['admin', 'the admitted record filename disagrees', (h) => { h.admission.candidate.record.file = 'record.json'; }, 'record_file_mismatch'],
  ['backend', 'the admitted archive digest disagrees', (h) => { h.admission.candidate.measuredDigest = dg('wrong-archive'); }, 'archive_digest_mismatch'],
  ['backend', 'the admission processed another commit', (h) => { h.admission.inputs.expect.commit = sha1ish('7'); }, 'admission_commit_mismatch'],
  ['backend', 'the admission processed another repository', (h) => { h.admission.inputs.expect.repository = 'mugak1/Dinify-Admin'; }, 'admission_repository_mismatch'],
  // the consumer closure against the independent plan
  ['backend', 'the expected consumer commit differs', (h) => { h.expected.consumer.commit = sha1ish('e'); }, 'consumer_commit_mismatch'],
  ['backend', 'a consumer subtree disagrees', (h) => { h.expected.consumer.subtrees.release = sha1ish('f'); }, 'consumer_subtree_mismatch'],
  ['backend', 'an extra consumer subtree the plan does not expect', (h) => { h.admission.consumer.subtrees.extra = sha1ish('5'); }, 'consumer_subtree_mismatch'],
  // the admin unpacker dependency
  ['admin', 'the pinned unpacker is not Dinify-Backend', (h) => { h.expected.unpacker.repository = 'mugak1/Dinify-Admin'; }, 'unpacker_repository_mismatch'],
  ['admin', 'the pinned unpacker adapter is not among the bound adapters', (h) => { h.expected.unpacker.adapter = 'ghost_unpack.py'; }, 'unpacker_unbound'],
  // the backend companion, full identity
  ['backend', 'the companion listed digest disagrees', (h) => { h.expected.companion.listedDigest = dg('wrong-companion'); }, 'companion_listed_mismatch'],
  ['backend', 'the admission companion is not bound to the record', (h) => { h.admission.reconstructionCompanion.boundToRecord = false; }, 'companion_unbound'],
  // the reconstruction report
  ['backend', 'a stub reconstruction offered as production', (h) => { h.reconstruction = reconstructionFor({ startup: { kind: 'synthetic-stub' } }); }, 'reconstruction_stub'],
  ['backend', 'a reconstruction bound to another descriptor', (h) => { h.reconstruction = reconstructionFor({ inputs: { admissionDescriptorDigest: dg('other') } }); }, 'reconstruction_foreign'],
  ['backend', 'a reconstruction contradicting the admitted manifest', (h) => { h.reconstruction = reconstructionFor({ admitted: { manifestDigest: dg('wrong-manifest') } }); }, 'reconstruction_contradictory'],
  ['admin', 'a reconstruction offered for an admin binding', (h) => { h.reconstruction = { schema: 'dinify.journey.backend-reconstruction/1', startup: { kind: 'pinned-consumer-startup' } }; }, 'reconstruction_peer_inappropriate'],
  // the custody record — mandatory, bound, and non-vacuous
  ['backend', 'no supervisor custody record', (h) => { h.custody = undefined; }, 'custody_missing'],
  ['backend', 'a custody record with the wrong schema', (h) => { h.custody.schema = 'dinify.journey.custody/2'; }, 'custody_invalid'],
  ['backend', 'a custody record omitting its descriptor identity', (h) => { delete h.custody.descriptorDigest; }, 'custody_foreign'],
  ['backend', 'a custody record for another descriptor', (h) => { h.custody.descriptorDigest = dg('other'); }, 'custody_foreign'],
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
  // an id absent on BOTH sides must refuse, never collapse to 'undefined' === 'undefined' (bindId)
  ['backend', 'a run id absent on both the descriptor and the expectation', (h) => { const d = { ...clone(h.descriptor), run: {} }; h.descriptorDigest = peerDescriptorDigest(d); h.descriptor = d; h.admission.inputs.descriptorDigest = h.descriptorDigest; h.custody.descriptorDigest = h.descriptorDigest; h.custody.admission.descriptorDigest = h.descriptorDigest; h.expected.selection.run = {}; }, 'run_mismatch'],
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

  test('the committed binder reproduces the recorded verdict: consistent, never accepted, no provenance', () => {
    const { descriptor, descriptorDigest, admission, custody, expected } = fixture.binding;
    const r = bindConsumerEvidence({ descriptor, descriptorDigest, admission, custody, expected });
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
