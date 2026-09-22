/**
 * ONE CERTIFIED UNIT, FROM THE GATE TO THE SERVED ORIGIN (R3).
 *
 * What was wrong (reproduced on 3386724, see release/README.md "Baseline"): the gate
 * emitted `allow, decision, sha, run_id, artifact_name`; the publisher downloaded BY
 * NAME, checked out its verifier at whatever `main` was by then, re-verified only that
 * the bytes it held were SELF-consistent (a different self-consistent candidate passed,
 * R3.h), and declared success when the served identity named the right COMMIT (a
 * different build of that SHA passed, R3.k).
 *
 * Now the gate emits an ADMITTED RECORD binding every identity the publisher needs; the
 * publisher's critical section re-establishes each against what it holds and what the
 * world says now; and the outcome is one word from a closed set, where a served marker
 * alone is never taken as proof of every hosted byte.
 *
 * On wording: nothing here claims a GitHub artifact was, or can be, replaced after
 * upload. Artifacts are immutable. The record is what makes "the same unit" CHECKABLE
 * across a re-run, an expiry, a policy change, or any fault between the record and
 * the bytes — rather than assumed.
 */

import { strict as assert } from 'node:assert';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { decide, selectCertifiedArtifact } from '../lib/decide.mjs';
import { RECORD_SCHEMA, buildRecord, decodeRecord, encodeRecord, recordDigest } from '../lib/record.mjs';
import { preflightReasons } from '../lib/preflight.mjs';
import { FAILING_OUTCOMES, OUTCOMES, classifyVerification, summarizeOutcome } from '../lib/outcome.mjs';
import { digestOfValue } from '../lib/canonical.mjs';
import { buildCandidate, cli, fixtureFrontend, startOrigin, tempDir } from './harness.mjs';
import { ARTIFACT_ID, HOSTING_DIGEST, NOW, POLICY, TREE_DIGEST, ZIP_DIGEST, baseline, clone, codes } from './fixtures.mjs';

const POLICY_FACTS = { revision: '9'.repeat(40), digest: `sha256:${'8'.repeat(64)}`, verifierTree: '7'.repeat(40) };

/** The record the gate emits for an input, exactly as `decide` builds it. */
function recordFor(input = baseline()) {
  const decision = decide(input);
  const listed = selectCertifiedArtifact(input.certification.artifacts, {
    runId: input.certification.runId, runAttempt: input.certification.runAttempt,
  }).artifact;
  return buildRecord({
    decision, request: input.request, policyFacts: POLICY_FACTS, certification: input.certification,
    listedArtifact: listed, artifact: input.artifact, hosting: input.hosting, served: input.served,
    peers: input.peers, policy: input.policy, now: input.now,
  });
}

/** What the publisher observes when NOTHING has changed since the gate. */
function unchangedFacts(record) {
  return {
    trusted: { verifierTree: record.policy.verifierTree, policyDigest: record.policy.digest },
    current: { state: 'known', verifierTree: record.policy.verifierTree },
    run: { present: true, conclusion: 'success', headSha: record.target.commit, runAttempt: record.certification.runAttempt },
    artifacts: [{ id: record.artifact.id, name: record.artifact.name, expired: false, digest: record.artifact.digest, workflowRunId: Number(record.certification.runId) }],
    candidate: { present: true, valid: true, treeDigest: record.artifact.treeDigest, manifestDigest: record.artifact.manifestDigest, unsafe: [] },
    compare: { status: 'ahead' },
    served: { state: record.served.state, servedCommit: record.served.commit, manifestDigest: record.served.manifestDigest },
    adminServed: { state: 'known', commit: record.peers.adminServed },
    hosting: { problems: [], digest: record.hosting.configDigest },
    certifiedCheckout: { head: record.target.commit },
  };
}

const preflight = (record, mutate, { now = '2026-09-22T12:05:00Z', policy = POLICY } = {}) => {
  const facts = unchangedFacts(record);
  if (mutate) mutate(facts);
  return preflightReasons({ record, policy, facts, now }).map((r) => r.code);
};

describe('the admitted record', () => {
  test('REGRESSION (R3.c): a PROCEED is admitted and binds every identity the publisher checks — not a SHA and a name', () => {
    const record = recordFor();
    assert.equal(record.schema, RECORD_SCHEMA);
    assert.equal(record.admitted, true);
    assert.deepEqual(record.artifact, {
      id: ARTIFACT_ID, name: 'frontend-release-4242-1', digest: ZIP_DIGEST, treeDigest: TREE_DIGEST,
      manifestDigest: digestOfValue(baseline().artifact.manifest), entryCount: 3,
    });
    assert.deepEqual(record.certification, { workflowPath: '.github/workflows/certify.yml', runId: '4242', runAttempt: '1', runStartedAt: '2026-09-22T11:30:00Z' });
    assert.deepEqual(record.policy, POLICY_FACTS);
    assert.equal(record.hosting.configDigest, HOSTING_DIGEST);
    assert.equal(record.hosting.toolsVersion, POLICY.hosting.firebaseToolsVersion);
    assert.equal(record.expiresAt, '2026-09-23T11:30:00Z', 'certification start + the policy window');
  });

  test('CONTRACT: the record names the artifact THE RUN LISTS, not whatever was downloaded', () => {
    const input = baseline();
    input.certification.artifacts.push({ id: 999, name: 'frontend-release-4242-2', expired: false, digest: `sha256:${'9'.repeat(64)}`, workflowRunId: 4242 });
    assert.equal(recordFor(input).artifact.id, ARTIFACT_ID);
  });

  test('CONTRACT: a refusal is recorded too, and is not admitted', () => {
    const input = baseline();
    input.certification.conclusion = 'failure';
    const record = recordFor(input);
    assert.equal(record.decision, 'REFUSE');
    assert.equal(record.admitted, false);
  });

  test('CONTRACT: the record travels as base64 of its canonical form, verified against its digest', () => {
    const record = recordFor();
    const decoded = decodeRecord(encodeRecord(record), recordDigest(record));
    assert.equal(decoded.ok, true, JSON.stringify(decoded.problems));
    assert.deepEqual(decoded.record, record);
  });

  test('CONTRACT: a record that does not reproduce its digest is not the admitted record', () => {
    const record = recordFor();
    const digest = recordDigest(record);
    const altered = { ...record, artifact: { ...record.artifact, id: 12345 } };
    const decoded = decodeRecord(encodeRecord(altered), digest);
    assert.equal(decoded.ok, false);
    assert.ok(decoded.problems.some((p) => p.code === 'preflight.record_invalid'));
  });

  test('CONTRACT: a refused decision\'s record cannot be carried into the publisher', () => {
    const input = baseline();
    input.certification.conclusion = 'failure';
    const record = recordFor(input);
    const decoded = decodeRecord(encodeRecord(record), recordDigest(record));
    assert.ok(decoded.problems.some((p) => p.code === 'preflight.not_admitted'));
  });

  test('CONTRACT: an undecodable record is refused, never thrown', () => {
    assert.equal(decodeRecord('%%%not base64 json%%%', `sha256:${'0'.repeat(64)}`).ok, false);
    assert.equal(decodeRecord(undefined, undefined).ok, false);
  });
});

describe('the publisher\'s critical section — the gate and the publisher agree on ONE unit', () => {
  test('CONTROL: nothing changed — the gate\'s record passes the publisher\'s recheck', () => {
    assert.deepEqual(preflight(recordFor()), []);
  });

  const cases = [
    ['REGRESSION (R3.d): a verifier other than the admitting revision', 'preflight.policy_mismatch', (f) => { f.trusted.verifierTree = '0'.repeat(40); }],
    ['CONTRACT: a policy digest other than the admitted one', 'preflight.policy_mismatch', (f) => { f.trusted.policyDigest = `sha256:${'0'.repeat(64)}`; }],
    ['CONTRACT: release/ advanced on the default branch since the gate — an explicit restart', 'preflight.policy_advanced', (f) => { f.current.verifierTree = '0'.repeat(40); }],
    ['CONTRACT: the default branch could not be read', 'preflight.policy_unverifiable', (f) => { f.current = { state: 'unreadable' }; }],
    ['CONTRACT: the certifying run no longer reads success', 'preflight.certification_changed', (f) => { f.run.conclusion = 'failure'; }],
    ['CONTRACT: the certifying run now names a different head', 'preflight.certification_changed', (f) => { f.run.headSha = 'b'.repeat(40); }],
    ['CONTRACT: the certifying run was re-run since the gate', 'preflight.attempt_changed', (f) => { f.run.runAttempt = '2'; }],
    ['CONTRACT: the admitted artifact has expired', 'preflight.artifact_unavailable', (f) => { f.artifacts[0].expired = true; }],
    ['CONTRACT: the run\'s artifacts could not be listed', 'preflight.artifact_unavailable', (f) => { f.artifacts = null; }],
    ['CONTRACT: the listed artifact belongs to another run', 'preflight.artifact_unavailable', (f) => { f.artifacts[0].workflowRunId = 5555; }],
    ['CONTRACT: the run now lists a different artifact id under the admitted name', 'preflight.artifact_replaced', (f) => { f.artifacts[0].id = 888; }],
    ['CONTRACT: the listed digest is not the admitted one', 'preflight.artifact_replaced', (f) => { f.artifacts[0].digest = `sha256:${'0'.repeat(64)}`; }],
    ['REGRESSION (R3.h): a DIFFERENT, internally consistent candidate in the publisher\'s hands', 'preflight.candidate_mismatch', (f) => {
      f.candidate.treeDigest = `sha256:${'a'.repeat(64)}`; f.candidate.manifestDigest = `sha256:${'b'.repeat(64)}`;
    }],
    ['CONTRACT: a candidate of the same SHA from a different certification', 'preflight.candidate_mismatch', (f) => { f.candidate.manifestDigest = `sha256:${'c'.repeat(64)}`; }],
    ['CONTRACT: a candidate whose own provenance does not check out', 'preflight.candidate_mismatch', (f) => { f.candidate.valid = false; }],
    ['CONTRACT: a candidate carrying an unsafe entry', 'preflight.candidate_mismatch', (f) => { f.candidate.unsafe = ['symbolic link: dist/x']; }],
    ['CONTRACT: the target is no longer on the default branch', 'preflight.target_not_on_main', (f) => { f.compare.status = 'diverged'; }],
    ['CONTRACT: the compare could not be read', 'preflight.target_not_on_main', (f) => { f.compare.status = 'unreadable (HTTP 502)'; }],
    ['CONTRACT: the regenerated hosting configuration differs from the admitted one', 'preflight.hosting_mismatch', (f) => { f.hosting.digest = `sha256:${'0'.repeat(64)}`; }],
    ['CONTRACT: the certified hosting configuration now has a problem', 'preflight.hosting_mismatch', (f) => { f.hosting.problems = [{ code: 'hosting.hook_present', detail: 'x' }]; }],
    ['CONTRACT: an identical configuration read at a DIFFERENT commit is not the admitted one', 'preflight.hosting_mismatch', (f) => { f.certifiedCheckout.head = 'b'.repeat(40); }],
    ['CONTRACT: the served release changed since the gate', 'preflight.served_changed', (f) => { f.served.servedCommit = 'c'.repeat(40); }],
    ['CONTRACT: the SAME commit is served with a different manifest now', 'preflight.served_changed', (f) => { f.served.manifestDigest = `sha256:${'d'.repeat(64)}`; }],
    ['CONTRACT: the served identity became unreadable', 'preflight.served_changed', (f) => { f.served = { state: 'unreadable' }; }],
  ];
  for (const [name, code, mutate] of cases) {
    test(name, () => { assert.deepEqual(preflight(recordFor(), mutate), [code]); });
  }

  test('CONTRACT: a certification past its window is refused at the promotion boundary', () => {
    assert.deepEqual(preflight(recordFor(), null, { now: '2026-09-23T11:30:01Z' }), ['preflight.certification_stale']);
  });

  test('CONTROL: the last moment inside the window is still inside it', () => {
    assert.deepEqual(preflight(recordFor(), null, { now: '2026-09-23T11:30:00Z' }), []);
  });

  test('CONTRACT: every change is reported, not the first', () => {
    const got = preflight(recordFor(), (f) => { f.run.runAttempt = '2'; f.current.verifierTree = '0'.repeat(40); f.hosting.digest = null; });
    assert.deepEqual(got.sort(), ['preflight.attempt_changed', 'preflight.hosting_mismatch', 'preflight.policy_advanced']);
  });

  test('CONTRACT: an invalid record short-circuits — nothing else is judged against it', () => {
    const record = { ...recordFor(), schema: 'x' };
    assert.deepEqual(preflight(record), ['preflight.record_invalid']);
  });
});

describe('outcomes — what happened, stated as what it is', () => {
  const record = recordFor();
  const identity = { state: 'known', commit: record.target.commit, manifestDigest: record.artifact.manifestDigest };
  const allFiles = { checked: record.artifact.entryCount, mismatched: [], unreachable: [] };

  test('CONTRACT: the closed set, and which of it turns a run red', () => {
    assert.deepEqual([...OUTCOMES].sort(), ['PREFLIGHT_REFUSED', 'PUBLICATION_FAILED', 'PUBLISHED_DEGRADED', 'PUBLISHED_VERIFIED', 'REFUSED', 'SKIPPED_IDENTICAL', 'SKIPPED_STALE', 'WOULD_PUBLISH']);
    assert.deepEqual([...FAILING_OUTCOMES].sort(), ['PREFLIGHT_REFUSED', 'PUBLICATION_FAILED', 'PUBLISHED_DEGRADED', 'REFUSED']);
    assert.equal(OUTCOMES.includes('RESTORED_AFTER_FAILURE'), false, 'nothing restores automatically, so nothing may claim it did');
  });

  const cases = [
    ['a refused gate', { decision: 'REFUSE' }, 'REFUSED'],
    ['an identical skip', { decision: 'SKIP_IDENTICAL' }, 'SKIPPED_IDENTICAL'],
    ['a stale skip', { decision: 'SKIP_STALE' }, 'SKIPPED_STALE'],
    ['admitted, then refused inside the critical section', { decision: 'PROCEED', preflightOk: false }, 'PREFLIGHT_REFUSED'],
    ['admitted, preflight never ran', { decision: 'PROCEED', preflightOk: null }, 'PREFLIGHT_REFUSED'],
    ['admitted and re-checked, publication not enabled', { decision: 'PROCEED', preflightOk: true, enabled: false }, 'WOULD_PUBLISH'],
    ['the tool failed and the origin does not serve the candidate', { decision: 'PROCEED', preflightOk: true, enabled: true, publishStep: 'failure', verification: { servesCandidate: false } }, 'PUBLICATION_FAILED'],
    ['the tool failed but the origin serves the candidate', { decision: 'PROCEED', preflightOk: true, enabled: true, publishStep: 'failure', verification: { servesCandidate: true } }, 'PUBLISHED_DEGRADED'],
    ['the tool succeeded and every file fetched back matches', { decision: 'PROCEED', preflightOk: true, enabled: true, publishStep: 'success', verification: { verified: true } }, 'PUBLISHED_VERIFIED'],
    ['the tool succeeded and verification did not establish the candidate', { decision: 'PROCEED', preflightOk: true, enabled: true, publishStep: 'success', verification: { verified: false } }, 'PUBLISHED_DEGRADED'],
    ['the tool succeeded and verification never ran', { decision: 'PROCEED', preflightOk: true, enabled: true, publishStep: 'success', verification: null }, 'PUBLISHED_DEGRADED'],
  ];
  for (const [name, input, outcome] of cases) test(`CONTRACT: ${name} → ${outcome}`, () => assert.equal(summarizeOutcome(input), outcome));

  test('CONTROL: the admitted identity and every certified file → verified', () => {
    assert.deepEqual(classifyVerification(record, { identity, files: allFiles }), { servesCandidate: true, filesMatch: true, verified: true });
  });

  test('REGRESSION (R3.f/k): the right SHA with a different manifest is NOT this candidate — success is not the served commit', () => {
    const r = classifyVerification(record, { identity: { ...identity, manifestDigest: `sha256:${'e'.repeat(64)}` }, files: allFiles });
    assert.equal(r.servesCandidate, false);
    assert.equal(r.verified, false);
  });

  test('CONTRACT: the identity alone proves nothing about the other files', () => {
    assert.equal(classifyVerification(record, { identity, files: { ...allFiles, mismatched: ['main-abc.js'] } }).verified, false);
    assert.equal(classifyVerification(record, { identity, files: { ...allFiles, unreachable: ['x: status 500'] } }).verified, false);
    assert.equal(classifyVerification(record, { identity, files: { ...allFiles, checked: allFiles.checked - 1 } }).verified, false);
  });
});

describe('verify-served — the identity AND every certified file, fetched back over TLS (R3.k)', () => {
  const world = {};
  before(async () => {
    world.site = await startOrigin();
    const policy = clone(POLICY);
    policy.hosting.identityOrigin = world.site.origin;
    world.fixture = fixtureFrontend({ policy });
    world.candidate = await buildCandidate({ repo: world.fixture.dir, commit: world.fixture.commit, runId: 5100, startedAt: '2026-09-22T11:30:00Z' });
    world.twin = await buildCandidate({ repo: world.fixture.dir, commit: world.fixture.commit, runId: 5101, startedAt: '2026-09-22T11:40:00Z' });
    const obs = JSON.parse((await cli(['observe', '--root', world.candidate.dir])).stdout);
    world.record = {
      target: { commit: world.fixture.commit },
      artifact: { manifestDigest: obs.manifestDigest, entryCount: obs.entryCount, treeDigest: obs.observedTreeDigest },
    };
    world.recordPath = join(tempDir('record'), 'record.json');
    writeFileSync(world.recordPath, JSON.stringify(world.record));
    world.config = JSON.parse(readFileSync(join(world.fixture.dir, 'firebase.json'), 'utf8'));
  });
  after(() => world.site.close());

  const verify = async (servedDir) => {
    world.site.serveSite(servedDir, world.config);
    const r = await cli(['verify-served', '--record', world.recordPath, '--payload', join(world.candidate.dir, 'dist'), '--attempts', '1', '--interval-ms', '10'], { root: world.fixture.dir });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const published = (candidate, mutate) => {
    const dir = tempDir('published');
    cpSync(join(candidate.dir, 'dist'), dir, { recursive: true });
    if (mutate) mutate(dir);
    return dir;
  };

  test('CONTROL: the admitted candidate served exactly → verified, every file checked', async () => {
    const r = await verify(published(world.candidate));
    assert.equal(r.verified, true, JSON.stringify(r));
    assert.equal(r.files.checked, world.record.artifact.entryCount);
    assert.match(r.note, /one vantage point/);
  });

  test('REGRESSION (R3.k): a different build of the SAME SHA served → not verified, whatever the commit says', async () => {
    assert.equal(world.twin.commit, world.candidate.commit);
    const r = await verify(published(world.twin));
    assert.equal(r.identity.commit, world.candidate.commit, 'the served marker names the admitted commit');
    assert.equal(r.servesCandidate, false);
    assert.equal(r.verified, false);
    assert.equal(summarizeOutcome({ decision: 'PROCEED', preflightOk: true, enabled: true, publishStep: 'success', verification: r }), 'PUBLISHED_DEGRADED');
  });

  test('CONTRACT: the right identity beside one altered file → not verified, and the file is named', async () => {
    const r = await verify(published(world.candidate, (dir) => { writeFileSync(join(dir, 'styles-fixture.css'), 'body{margin:1px}'); }));
    assert.equal(r.servesCandidate, true);
    assert.deepEqual(r.files.mismatched, ['styles-fixture.css']);
    assert.equal(r.verified, false);
  });

  test('CONTRACT: a certified file missing from the origin is caught, even behind the SPA rewrite', async () => {
    // The `**` rewrite answers a missing path with index.html and a 200, so the status
    // alone would say "present". The bytes are what catch it.
    const r = await verify(published(world.candidate, (dir) => { rmSync(join(dir, 'assets/icon.svg')); }));
    assert.equal(r.servesCandidate, true);
    assert.equal(r.verified, false);
    assert.ok(r.files.mismatched.includes('assets/icon.svg'), JSON.stringify(r.files));
  });
});
