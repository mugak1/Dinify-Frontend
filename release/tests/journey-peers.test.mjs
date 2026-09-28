/**
 * JOURNEY PEERS (D16 / D08 B4, component B1): peer-selection and observation validation.
 *
 * EVERY FIXTURE HERE IS SYNTHETIC. The run, job and artifact documents mirror the SHAPE the
 * GitHub API returns for the peers' certifying runs (checked read-only against
 * Dinify-Backend run 36344217994 and Dinify-Admin run 36359784403), but every id, SHA,
 * digest, file name and byte below is made up. No peer source, wheel, inventory or
 * evidence is copied. Passing these tests shows the rules behave as written; it is not
 * a journey, a download or a verification of any real candidate.
 *
 * Expected outcomes are written out as literal refusal codes per case, not derived from
 * the implementation.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { contractDigest, digestOf, treeDigest } from '../lib/canonical.mjs';
import { receiptDigest } from '../lib/peers.mjs';
import {
  DESCRIPTOR_SCHEMA, PEER_FORMATS, SELECTION_SCHEMA, adminPathProblem, backendListingDigest, checkSelection, selectPeerCandidate,
} from '../lib/journey-peers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const NOW = '2026-10-01T00:00:00Z';
const clone = (v) => JSON.parse(JSON.stringify(v));
const hex = (label) => digestOf(Buffer.from(`SYNTHETIC ${label}`)).slice('sha256:'.length);
const sha1ish = (c) => c.repeat(40);
const bytes = (value) => Buffer.from(JSON.stringify(value), 'utf8');

// ── a synthetic world per peer ──────────────────────────────────────────────────

const WORLD = {
  admin: {
    repository: 'mugak1/Dinify-Admin', repoId: 910001, workflowId: 920001,
    commit: sha1ish('a'), tree: sha1ish('b'), runId: '930001', attempt: '1',
    jobs: ['validate'], candidate: 'admin-candidate', companions: [],
    unrelated: ['dependency-audit-930001-1'],
  },
  backend: {
    repository: 'mugak1/Dinify-Backend', repoId: 910002, workflowId: 920002,
    commit: sha1ish('c'), tree: sha1ish('d'), runId: '930002', attempt: '1',
    jobs: ['suite (3.12.3)', 'reconstruct', 'test'], candidate: 'backend-candidate', companions: ['backend-reconstruction'],
    unrelated: ['dependency-audit-3.12.3-930002-1'],
  },
};

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
    source: { digest: `sha256:${hex('source')}` },
    payload: {
      treeDigest: treeDigest(entries), entryCount: entries.length, bytes: 341, indexSha256: hex('index'),
      release: { path: 'release.txt', commit: w.commit }, entries,
      archive: { path: 'payload.tar.gz', sha256: hex('payload-archive'), bytes: 999 },
    },
    evidence: { treeDigest: treeDigest(evidence), files: evidence },
    audit: { outcome: 'within_policy', exitCode: 0 },
    // A field the selection never reads is left alone, and never echoed.
    inventory: { note: 'SYNTHETIC — ignored by the selection' },
  };
}

function backendRecord() {
  const w = WORLD.backend;
  const wheels = [
    { filename: 'synthetic_pkg-1.0.0-py3-none-any.whl', sha256: hex('wheel-1'), size: 10 },
    { filename: 'other_synthetic-2.0.0-cp312-cp312-manylinux_2_17_x86_64.whl', sha256: hex('wheel-2'), size: 20 },
  ];
  return {
    schema: 'dinify.backend.candidate/1', repository: w.repository, commit: w.commit, tree: w.tree, createdAt: NOW,
    eligibility: { promotable: true, reason: 'SYNTHETIC' },
    artifact: { name: `backend-candidate-${w.runId}-${w.attempt}`, note: 'SYNTHETIC' },
    ci: {
      workflowRef: `${w.repository}/.github/workflows/ci.yml@refs/heads/main`, event: 'push', ref: 'refs/heads/main',
      sha: w.commit, repository: w.repository, runId: w.runId, runAttempt: w.attempt,
    },
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

/** A complete, valid set of observations and the matching selection for `peer`. */
function world(peer) {
  const w = WORLD[peer];
  const archive = Buffer.from(`SYNTHETIC ${peer} candidate archive bytes`);
  const record = peer === 'admin' ? adminRecord() : backendRecord();
  const receipt = receiptFor(peer);
  let nextId = 940000 + (peer === 'admin' ? 0 : 100);
  const listed = [artifactEntry(peer, `${w.candidate}-${w.runId}-${w.attempt}`, archive, nextId += 1)];
  for (const prefix of w.companions) listed.push(artifactEntry(peer, `${prefix}-${w.runId}-${w.attempt}`, Buffer.from(`SYNTHETIC ${prefix}`), nextId += 1));
  for (const name of w.unrelated) listed.push(artifactEntry(peer, name, Buffer.from(`SYNTHETIC ${name}`), nextId += 1));
  const run = {
    id: Number(w.runId), name: 'SYNTHETIC CI', workflow_id: w.workflowId, path: '.github/workflows/ci.yml',
    run_attempt: Number(w.attempt), event: 'push', status: 'completed', conclusion: 'success',
    head_branch: 'main', head_sha: w.commit, run_started_at: '2026-09-27T19:24:16Z',
    repository: { id: w.repoId, full_name: w.repository }, head_repository: { id: w.repoId, full_name: w.repository },
  };
  return {
    expected: {
      schema: SELECTION_SCHEMA, peer, repository: w.repository,
      source: { commit: w.commit, tree: w.tree },
      receipt: { commit: w.commit, digest: receiptDigest(receipt) },
      producer: { workflowPath: '.github/workflows/ci.yml', event: 'push', ref: 'refs/heads/main' },
      run: { id: w.runId, attempt: w.attempt },
      requiredJobs: [...w.jobs],
    },
    observations: {
      workflow: { id: w.workflowId, path: '.github/workflows/ci.yml', name: 'SYNTHETIC CI' },
      run,
      latestRun: clone(run),
      jobs: {
        total_count: w.jobs.length,
        jobs: w.jobs.map((name, n) => ({
          id: 950000 + n + (peer === 'admin' ? 0 : 100), run_id: Number(w.runId), run_attempt: Number(w.attempt), name,
          status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: w.commit,
        })),
      },
      artifacts: { total_count: listed.length, artifacts: listed },
      commit: { sha: w.commit, tree: { sha: w.tree } },
      receipt,
      archive,
      record: bytes(record),
    },
  };
}

const codes = (result) => result.reasons.map((r) => r.code);
const run = (w, extra = {}) => selectPeerCandidate({ expected: w.expected, observations: w.observations, now: NOW, ...extra });

// ── the reviewed formats, pinned independently of the implementation ───────────

describe('SYNTHETIC: the peer formats are the peers\' own', () => {
  test('CONTRACT: Admin is ci.yml/validate on push to main, admin-candidate, certification.json', () => {
    const f = PEER_FORMATS.admin;
    assert.equal(f.repository, 'mugak1/Dinify-Admin');
    assert.equal(f.workflowPath, '.github/workflows/ci.yml');
    assert.deepEqual([...f.requiredJobs], ['validate']);
    assert.equal(f.candidatePrefix, 'admin-candidate');
    assert.equal(f.recordFile, 'certification.json');
    assert.deepEqual([...f.recordSchemas], ['dinify.admin.certification/1']);
    assert.deepEqual([...f.companions], []);
  });
  test('CONTRACT: Backend requires suite (3.12.3), reconstruct and test, and a reconstruction artifact', () => {
    const f = PEER_FORMATS.backend;
    assert.equal(f.repository, 'mugak1/Dinify-Backend');
    assert.deepEqual([...f.requiredJobs], ['suite (3.12.3)', 'reconstruct', 'test']);
    assert.equal(f.candidatePrefix, 'backend-candidate');
    assert.deepEqual(f.companions.map((c) => c.prefix), ['backend-reconstruction']);
    assert.deepEqual([...f.contradictoryPrefixes], ['backend-candidate-nonpromotable']);
    assert.equal(f.recordFile, 'record.json');
  });
  test('CONTRACT: every format names the checks a trusted consumer still owes', () => {
    for (const f of Object.values(PEER_FORMATS)) {
      assert.ok(f.deferred.some((d) => d.startsWith('archive-members')));
      assert.ok(f.deferred.some((d) => d.startsWith('record-membership')));
    }
    assert.ok(PEER_FORMATS.backend.deferred.some((d) => d.startsWith('environment-reconstruction')));
  });
  test('CONTRACT: the Backend listing digest composes filename\\0sha256\\0size lines, sorted', () => {
    const files = [{ filename: 'b.whl', sha256: '1'.repeat(64), size: 2 }, { filename: 'a.whl', sha256: '0'.repeat(64), size: 1 }];
    // Independently spelled out: sha256 of the two lines in filename order.
    const expected = digestOf(Buffer.from(`a.whl\0${'0'.repeat(64)}\0${1}\nb.whl\0${'1'.repeat(64)}\0${2}\n`)).slice(7);
    assert.equal(backendListingDigest(files), expected);
  });
  test('CONTRACT: Admin payload paths follow its own alphabet and refuse traversal', () => {
    for (const ok of ['index.html', 'assets/a~b@c+d-e_f.js', 'evidence/audit/result.json']) assert.equal(adminPathProblem(ok), null, ok);
    for (const badPath of ['', '../x', 'a/../b', '/abs', 'a//b', './a', 'a\\b', 'a b', 'a\0b', `${'x'.repeat(241)}`]) {
      assert.notEqual(adminPathProblem(badPath), null, JSON.stringify(badPath));
    }
  });
});

// ── valid synthetic evidence ────────────────────────────────────────────────────

describe('SYNTHETIC: sufficient evidence yields a descriptor, never a verification', () => {
  for (const peer of ['admin', 'backend']) {
    test(`CONTROL: a complete ${peer} observation set with measured bytes`, () => {
      const r = run(world(peer));
      assert.deepEqual(r.reasons, []);
      assert.equal(r.ok, true);
      assert.equal(r.level, 'bytes');
      const d = r.descriptor;
      assert.equal(d.schema, DESCRIPTOR_SCHEMA);
      assert.equal(d.peer, peer);
      assert.equal(d.status, 'bytes-correspond-consumer-checks-deferred');
      assert.equal(d.bytes.archive.state, 'measured-match');
      assert.equal(d.bytes.archive.measuredDigest, d.bytes.archive.listedDigest);
      assert.equal(d.bytes.record.state, 'consistent');
      assert.equal(d.claims.kind, 'producer-claims');
      assert.equal(d.artifacts.candidate.name, `${WORLD[peer].candidate}-${WORLD[peer].runId}-1`);
      assert.deepEqual(d.jobs.map((j) => j.name), WORLD[peer].jobs);
      assert.deepEqual(d.deferred, [...PEER_FORMATS[peer].deferred]);
      // Nothing in the descriptor claims more than was established.
      const text = JSON.stringify(d);
      for (const word of ['"verified"', '"admitted"', 'reconstructed', 'production_ready', 'SYNTHETIC — never returned', 'SYNTHETIC — ignored']) {
        assert.ok(!text.includes(word), word);
      }
    });
  }
  test('CONTROL: Backend claims carry the target facts a later runner check needs, and no inventory', () => {
    const d = run(world('backend')).descriptor;
    assert.deepEqual(d.claims.target, { python: '3.12.3', implementation: 'CPython', platform: 'linux', machine: 'x86_64', libc: 'glibc 2.39' });
    assert.equal(d.claims.wheelCount, 2);
    assert.ok(!('packages' in d.claims));
  });
  test('CONTROL: an unrelated artifact and another attempt\'s candidate are not a second candidate', () => {
    const w = world('backend');
    const other = artifactEntry('backend', `backend-candidate-${WORLD.backend.runId}-2`, Buffer.from('SYNTHETIC later attempt'), 949999);
    w.observations.artifacts.artifacts.push(other);
    w.observations.artifacts.total_count += 1;
    assert.deepEqual(codes(run(w)), []);
  });
  test('CONTROL: listings split across complete pages are joined', () => {
    const w = world('backend');
    const all = w.observations.artifacts.artifacts;
    w.observations.artifacts = [
      { total_count: all.length, artifacts: all.slice(0, 2) },
      { total_count: all.length, artifacts: all.slice(2) },
    ];
    assert.deepEqual(codes(run(w)), []);
  });
  test('metadata-only evidence is a weaker, named level — and only when asked for by name', () => {
    const w = world('admin');
    delete w.observations.archive;
    delete w.observations.record;
    const weak = run(w, { require: 'metadata' });
    assert.equal(weak.ok, true);
    assert.equal(weak.level, 'metadata');
    assert.equal(weak.descriptor.status, 'metadata-consistent-bytes-not-established');
    assert.equal(weak.descriptor.bytes.archive.state, 'not-observed');
    assert.equal(weak.descriptor.bytes.archive.measuredDigest, null);
    assert.equal(weak.descriptor.claims, null);
    // REGRESSION: the default refuses byte-verified admission from metadata alone.
    const strict = run(w);
    assert.deepEqual(codes(strict), ['journey.peers.bytes_not_observed', 'journey.peers.bytes_not_observed']);
    assert.equal(strict.descriptor, null);
  });
});

// ── the refusal table ───────────────────────────────────────────────────────────

const job = (w, name) => w.observations.jobs.jobs.find((j) => j.name === name);
const art = (w, prefix) => w.observations.artifacts.artifacts.find((a) => a.name.startsWith(`${prefix}-`));
const setRecord = (w, peer, edit) => { const r = peer === 'admin' ? adminRecord() : backendRecord(); edit(r); w.observations.record = bytes(r); };

const CASES = [
  // listings
  ['backend', 'jobs listing states more jobs than it carries', (w) => { w.observations.jobs.total_count = 4; }, ['journey.peers.jobs_listing_incomplete']],
  ['backend', 'a second artifact page is missing', (w) => {
    const all = w.observations.artifacts.artifacts;
    w.observations.artifacts = [{ total_count: all.length + 1, artifacts: all }];
  }, ['journey.peers.artifact_listing_incomplete', 'journey.peers.archive_unbound']],
  ['backend', 'pages disagree about the total', (w) => {
    const all = w.observations.artifacts.artifacts;
    w.observations.artifacts = [{ total_count: all.length, artifacts: all.slice(0, 1) }, { total_count: all.length + 1, artifacts: all.slice(1) }];
  }, ['journey.peers.artifact_listing_incomplete', 'journey.peers.archive_unbound']],
  ['backend', 'an artifact id repeats across pages', (w) => {
    const all = w.observations.artifacts.artifacts;
    w.observations.artifacts = [{ total_count: all.length + 1, artifacts: all }, { total_count: all.length + 1, artifacts: [all[0]] }];
  }, ['journey.peers.artifact_listing_incomplete', 'journey.peers.archive_unbound']],
  // repository, workflow, event, ref, source, tree
  ['admin', 'the run belongs to a fork', (w) => { w.observations.run.head_repository.full_name = 'someone/Dinify-Admin'; }, ['journey.peers.run_wrong_repository']],
  ['admin', 'the run is of another repository', (w) => { w.observations.run.repository.full_name = 'mugak1/Dinify-Other'; }, ['journey.peers.run_wrong_repository']],
  ['admin', 'the run is of another workflow file', (w) => { w.observations.run.path = '.github/workflows/other.yml'; }, ['journey.peers.run_wrong_workflow']],
  ['admin', 'the run belongs to another workflow id', (w) => { w.observations.run.workflow_id = 1; }, ['journey.peers.run_wrong_workflow']],
  ['admin', 'the workflow observation is another workflow', (w) => { w.observations.workflow.path = '.github/workflows/deploy.yml'; }, ['journey.peers.workflow_mismatch']],
  ['admin', 'the run was a pull request', (w) => { w.observations.run.event = 'pull_request'; }, ['journey.peers.run_wrong_event']],
  ['admin', 'the run was on another branch', (w) => { w.observations.run.head_branch = 'feature'; }, ['journey.peers.run_wrong_event']],
  ['backend', 'the run is of another commit', (w) => { w.observations.run.head_sha = sha1ish('7'); w.observations.latestRun.head_sha = sha1ish('7'); }, ['journey.peers.run_wrong_source']],
  ['backend', 'the commit has another tree', (w) => { w.observations.commit.tree.sha = sha1ish('8'); }, ['journey.peers.source_tree_mismatch']],
  ['backend', 'the receipt is not the approved one', (w) => { w.observations.receipt.producer.revision = 2; }, ['journey.peers.receipt_mismatch']],
  ['backend', 'the receipt is about another commit', (w) => { w.observations.receipt.commit = sha1ish('7'); }, ['journey.peers.receipt_invalid']],
  // jobs and attempts
  ['backend', 'a required job failed', (w) => { job(w, 'reconstruct').conclusion = 'failure'; }, ['journey.peers.job_not_successful']],
  ['backend', 'a required job is missing', (w) => {
    w.observations.jobs.jobs = w.observations.jobs.jobs.filter((j) => j.name !== 'reconstruct');
    w.observations.jobs.total_count -= 1;
  }, ['journey.peers.required_job_missing']],
  ['backend', 'a required job is listed twice', (w) => {
    w.observations.jobs.jobs.push({ ...clone(job(w, 'test')), id: 959999 });
    w.observations.jobs.total_count += 1;
  }, ['journey.peers.required_job_duplicate']],
  ['backend', 'a job is carried from an earlier attempt (partial re-run)', (w) => { job(w, 'suite (3.12.3)').run_attempt = 2; }, ['journey.peers.mixed_attempt']],
  ['backend', 'a job belongs to another run', (w) => { job(w, 'test').run_id = 111; }, ['journey.peers.mixed_attempt']],
  ['admin', 'the run was re-run since the selection', (w) => { w.observations.latestRun.run_attempt = 2; }, ['journey.peers.attempt_superseded']],
  ['admin', 'the attempt read is not the selected one', (w) => { w.observations.run.run_attempt = 2; }, ['journey.peers.attempt_mismatch']],
  ['admin', 'the attempt did not succeed', (w) => { w.observations.run.conclusion = 'failure'; }, ['journey.peers.run_not_successful']],
  // artifacts
  ['admin', 'two eligible candidates of the same name', (w) => {
    w.observations.artifacts.artifacts.push({ ...clone(art(w, 'admin-candidate')), id: 949998 });
    w.observations.artifacts.total_count += 1;
  }, ['journey.peers.candidate_ambiguous', 'journey.peers.archive_unbound']],
  ['admin', 'no candidate for the attempt', (w) => {
    w.observations.artifacts.artifacts = w.observations.artifacts.artifacts.filter((a) => !a.name.startsWith('admin-candidate-'));
    w.observations.artifacts.total_count -= 1;
  }, ['journey.peers.candidate_missing', 'journey.peers.archive_unbound']],
  ['admin', 'only a later attempt\'s candidate is listed', (w) => {
    // A re-run's candidate is a DIFFERENT certification of the same commit; it never
    // answers for the attempt the selection names.
    art(w, 'admin-candidate').name = `admin-candidate-${WORLD.admin.runId}-2`;
  }, ['journey.peers.candidate_missing', 'journey.peers.archive_unbound']],
  ['backend', 'only a later attempt\'s reconstruction is listed', (w) => {
    art(w, 'backend-reconstruction').name = `backend-reconstruction-${WORLD.backend.runId}-2`;
  }, ['journey.peers.reconstruction_missing']],
  ['backend', 'no reconstruction for the attempt', (w) => {
    w.observations.artifacts.artifacts = w.observations.artifacts.artifacts.filter((a) => !a.name.startsWith('backend-reconstruction-'));
    w.observations.artifacts.total_count -= 1;
  }, ['journey.peers.reconstruction_missing']],
  ['backend', 'the same attempt also lists a non-promotable candidate', (w) => {
    w.observations.artifacts.artifacts.push(artifactEntry('backend', `backend-candidate-nonpromotable-${WORLD.backend.runId}-1`, Buffer.from('SYNTHETIC np'), 949997));
    w.observations.artifacts.total_count += 1;
  }, ['journey.peers.candidate_contradictory']],
  ['admin', 'the candidate is marked expired', (w) => { art(w, 'admin-candidate').expired = true; }, ['journey.peers.artifact_expired', 'journey.peers.archive_unbound']],
  ['admin', 'the candidate expired before now', (w) => { art(w, 'admin-candidate').expires_at = '2026-09-30T23:59:59Z'; }, ['journey.peers.artifact_expired', 'journey.peers.archive_unbound']],
  ['admin', 'the candidate states no expiry', (w) => { delete art(w, 'admin-candidate').expires_at; }, ['journey.peers.artifact_expired', 'journey.peers.archive_unbound']],
  ['admin', 'the candidate is listed for another run', (w) => { art(w, 'admin-candidate').workflow_run.id = 1; }, ['journey.peers.artifact_wrong_run', 'journey.peers.archive_unbound']],
  ['admin', 'the candidate was produced in another repository', (w) => { art(w, 'admin-candidate').workflow_run.head_repository_id = 1; }, ['journey.peers.artifact_wrong_repository', 'journey.peers.archive_unbound']],
  // bytes
  ['admin', 'altered archive bytes', (w) => { w.observations.archive = Buffer.from('SYNTHETIC tampered archive'); }, ['journey.peers.archive_digest_mismatch']],
  ['backend', 'a caller-supplied digest in place of bytes', (w) => { w.observations.archive = art(w, 'backend-candidate').digest; }, ['journey.peers.archive_bytes_invalid']],
  ['admin', 'record bytes for another commit', (w) => setRecord(w, 'admin', (r) => { r.commit = sha1ish('7'); }), ['journey.peers.record_mismatch']],
  ['admin', 'record certified by another attempt', (w) => setRecord(w, 'admin', (r) => { r.workflow.runAttempt = '2'; }), ['journey.peers.record_mismatch']],
  ['admin', 'altered payload entry without its digest', (w) => setRecord(w, 'admin', (r) => { r.payload.entries[1].sha256 = hex('changed'); }), ['journey.peers.record_inconsistent']],
  ['admin', 'a payload path that traverses', (w) => setRecord(w, 'admin', (r) => { r.payload.entries[1].path = '../escape.js'; }), ['journey.peers.record_entry_invalid']],
  ['admin', 'a payload path listed twice', (w) => setRecord(w, 'admin', (r) => { r.payload.entries.push(clone(r.payload.entries[0])); }), ['journey.peers.record_entry_invalid']],
  ['admin', 'a payload file that is also a directory', (w) => setRecord(w, 'admin', (r) => { r.payload.entries.push({ path: 'index.html/x', sha256: hex('x'), bytes: 1 }); }), ['journey.peers.record_entry_invalid']],
  ['admin', 'a payload entry claiming a link mode', (w) => setRecord(w, 'admin', (r) => { r.payload.entries[0].mode = 'symlink'; }), ['journey.peers.record_entry_invalid']],
  ['admin', 'an unsupported record version', (w) => setRecord(w, 'admin', (r) => { r.schema = 'dinify.admin.certification/2'; }), ['journey.peers.record_unsupported']],
  ['backend', 'a non-promotable record', (w) => setRecord(w, 'backend', (r) => { r.eligibility.promotable = false; }), ['journey.peers.record_not_promotable']],
  ['backend', 'a record naming another artifact', (w) => setRecord(w, 'backend', (r) => { r.artifact.name = 'backend-candidate-1-1'; }), ['journey.peers.record_mismatch']],
  ['backend', 'a pull-request record', (w) => setRecord(w, 'backend', (r) => { r.ci.event = 'pull_request'; }), ['journey.peers.record_mismatch']],
  ['backend', 'a wheel entry that is a path', (w) => setRecord(w, 'backend', (r) => { r.wheelhouse.files[0].filename = 'dir/evil.whl'; }), ['journey.peers.record_entry_invalid']],
  ['backend', 'a wheel listed twice', (w) => setRecord(w, 'backend', (r) => { r.wheelhouse.files.push(clone(r.wheelhouse.files[0])); }), ['journey.peers.record_entry_invalid']],
  ['backend', 'a wheelhouse digest that its files do not compose', (w) => setRecord(w, 'backend', (r) => { r.wheelhouse.files[0].size += 1; }), ['journey.peers.record_inconsistent']],
  ['admin', 'a record claiming an incomplete audit', (w) => setRecord(w, 'admin', (r) => { r.audit.outcome = 'incomplete'; }), ['journey.peers.record_audit_not_passing']],
  ['admin', 'a record with no audit claim', (w) => setRecord(w, 'admin', (r) => { delete r.audit; }), ['journey.peers.record_audit_not_passing']],
  ['backend', 'a record claiming a blocking audit', (w) => setRecord(w, 'backend', (r) => { r.audit.outcome = 'blocking'; }), ['journey.peers.record_audit_not_passing']],
  ['backend', 'record bytes that are not JSON', (w) => { w.observations.record = Buffer.from('SYNTHETIC not json'); }, ['journey.peers.record_unreadable']],
  ['backend', 'a record given as a string, not bytes', (w) => { w.observations.record = JSON.stringify(backendRecord()); }, ['journey.peers.record_unreadable']],
  ['backend', 'record bytes that are not UTF-8', (w) => { w.observations.record = Buffer.from([0x7b, 0xff, 0x7d]); }, ['journey.peers.record_unreadable']],
  // the request and the observations themselves
  ['admin', 'a caller\'s verified:true', (w) => { w.observations.verified = true; }, ['journey.peers.observation_unknown']],
  ['admin', 'a missing observation', (w) => { delete w.observations.latestRun; }, ['journey.peers.observation_missing']],
];

describe('SYNTHETIC: each broken fact is refused by name', () => {
  for (const [peer, name, edit, expected] of CASES) {
    test(`REGRESSION (${peer}): ${name}`, () => {
      const w = world(peer);
      edit(w);
      const r = run(w);
      assert.deepEqual(codes(r), expected);
      assert.equal(r.ok, false);
      assert.equal(r.level, null);
      assert.equal(r.descriptor, null);
    });
  }
});

describe('SYNTHETIC: the selection is the caller\'s, checked, and never completed or corrected', () => {
  const SELECTION_CASES = [
    ['a pull-request producer', (s) => { s.producer.event = 'pull_request'; }],
    ['another ref', (s) => { s.producer.ref = 'refs/heads/develop'; }],
    ['another repository', (s) => { s.repository = 'mugak1/Dinify-Admin'; }],
    ['a narrowed required-job list', (s) => { s.requiredJobs = ['suite (3.12.3)', 'test']; }],
    ['a receipt naming another commit', (s) => { s.receipt.commit = sha1ish('7'); }],
    ['an abbreviated commit', (s) => { s.source.commit = 'c'.repeat(7); }],
    ['a numeric run id', (s) => { s.run.id = 930002; }],
    ['an unknown key', (s) => { s.latest = true; }],
    ['an unknown schema', (s) => { s.schema = 'dinify.journey.peer-selection/2'; }],
    ['an inherited peer name', (s) => { s.peer = '__proto__'; }],
  ];
  for (const [name, edit] of SELECTION_CASES) {
    test(`REGRESSION: ${name} is a selection_invalid refusal`, () => {
      const w = world('backend');
      edit(w.expected);
      const r = run(w);
      assert.ok(codes(r).length > 0);
      assert.ok(codes(r).every((c) => c === 'journey.peers.selection_invalid'), JSON.stringify(codes(r)));
    });
  }
  test('CONTROL: a stricter selection that requires an extra job is accepted when that job succeeded', () => {
    const w = world('admin');
    w.expected.requiredJobs.push('extra-check');
    w.observations.jobs.jobs.push({ id: 958888, run_id: Number(WORLD.admin.runId), run_attempt: 1, name: 'extra-check', status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: WORLD.admin.commit });
    w.observations.jobs.total_count += 1;
    assert.deepEqual(codes(run(w)), []);
    assert.deepEqual(checkSelection(w.expected).problems, []);
  });
  test('REGRESSION: an explicit clock and a known level are required', () => {
    const w = world('admin');
    assert.deepEqual(codes(selectPeerCandidate({ expected: w.expected, observations: w.observations })), ['journey.peers.clock_missing']);
    assert.deepEqual(codes(run(w, { require: 'trusted' })), ['journey.peers.request_invalid']);
  });
});

describe('SYNTHETIC: the currently approved Backend receipt names a revision with no candidate', () => {
  // The equivalent of Dinify-Backend a6b25a6 (receipt approved in release/policy.json):
  // its CI run predates candidate production, so it has no `reconstruct` job and
  // retained NO artifacts (read-only: run 36008420992 lists total_count 0). A later
  // revision that does have a candidate must never be substituted for it.
  const OLD = { commit: sha1ish('5'), tree: sha1ish('6'), runId: '930099' };
  function oldWorld() {
    const w = world('backend');
    const receipt = { ...receiptFor('backend'), commit: OLD.commit, tree: OLD.tree };
    w.expected.source = { commit: OLD.commit, tree: OLD.tree };
    w.expected.receipt = { commit: OLD.commit, digest: receiptDigest(receipt) };
    w.expected.run = { id: OLD.runId, attempt: '1' };
    w.observations.receipt = receipt;
    w.observations.commit = { sha: OLD.commit, tree: { sha: OLD.tree } };
    for (const r of [w.observations.run, w.observations.latestRun]) { r.id = Number(OLD.runId); r.head_sha = OLD.commit; }
    w.observations.jobs = {
      total_count: 2,
      jobs: ['suite (3.12.3)', 'test'].map((name, n) => ({ id: 957000 + n, run_id: Number(OLD.runId), run_attempt: 1, name, status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: OLD.commit })),
    };
    w.observations.artifacts = { total_count: 0, artifacts: [] };
    delete w.observations.archive;
    delete w.observations.record;
    return w;
  }
  test('REGRESSION: it is refused as missing evidence, even at the metadata level', () => {
    const r = run(oldWorld(), { require: 'metadata' });
    assert.deepEqual(codes(r), [
      'journey.peers.required_job_missing',
      'journey.peers.candidate_missing',
      'journey.peers.reconstruction_missing',
    ]);
    assert.equal(r.descriptor, null);
  });
  test('REGRESSION: a later revision\'s run and candidate are refused, not substituted', () => {
    const w = oldWorld();
    const later = world('backend');
    for (const key of ['run', 'latestRun', 'jobs', 'artifacts', 'archive', 'record']) w.observations[key] = later.observations[key];
    const r = run(w);
    assert.deepEqual([...new Set(codes(r))].sort(), [
      'journey.peers.archive_unbound', // the later archive is bound to no candidate of the selected run
      'journey.peers.candidate_missing', // no candidate named for the selected run and attempt
      'journey.peers.mixed_attempt', // the later run's jobs belong to another run
      'journey.peers.reconstruction_missing',
      'journey.peers.record_mismatch', // the later record names another run and source
      'journey.peers.run_mismatch',
      'journey.peers.run_wrong_source',
    ]);
    assert.equal(r.descriptor, null);
  });
});

describe('SYNTHETIC: untrusted text stays out of diagnostics', () => {
  const evil = 'https://evil.example/?token=SYNTHETIC-SECRET';
  const clean = (r) => {
    const text = JSON.stringify(r.reasons);
    assert.ok(r.reasons.length > 0);
    assert.ok(!text.includes('evil.example') && !text.includes('SYNTHETIC-SECRET'), text);
  };
  test('REGRESSION: an injected run SHA, attempt and carried job name are not echoed', () => {
    const w = world('admin');
    w.observations.run.head_sha = evil;
    w.observations.latestRun.run_attempt = evil;
    job(w, 'validate').run_attempt = 2;
    job(w, 'validate').name = evil;
    const r = run(w);
    assert.deepEqual(codes(r), [
      'journey.peers.run_wrong_source',
      'journey.peers.attempt_superseded',
      'journey.peers.mixed_attempt',
      'journey.peers.required_job_missing', // the renamed job no longer answers for `validate`
    ]);
    clean(r);
  });
  test('REGRESSION: an injected observation key is not echoed', () => {
    const w = world('admin');
    w.observations[evil] = 1;
    const r = run(w);
    assert.deepEqual(codes(r), ['journey.peers.observation_unknown']);
    clean(r);
  });
  test('REGRESSION: an injected record schema is not echoed', () => {
    const w = world('admin');
    setRecord(w, 'admin', (rec) => { rec.schema = evil; });
    const r = run(w);
    assert.deepEqual(codes(r), ['journey.peers.record_unsupported']);
    clean(r);
  });
  test('CONTROL: a descriptor carries no URL from the listing', () => {
    const text = JSON.stringify(run(world('backend')).descriptor);
    assert.ok(!text.includes('api.example.invalid'));
  });
});

describe('the module stays pure', () => {
  test('CONTRACT: it imports no network, filesystem, subprocess or environment facility', () => {
    const source = readFileSync(join(HERE, '../lib/journey-peers.mjs'), 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]).sort();
    assert.deepEqual(imports, ['./canonical.mjs', './peers.mjs', 'node:crypto']);
    for (const word of ['process.env', 'Date.now', 'fetch(', 'spawn', 'readFileSync']) assert.ok(!source.includes(word), word);
  });
});
