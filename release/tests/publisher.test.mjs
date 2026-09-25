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

import { RECORD_SCHEMA, decodeRecord, encodeRecord, recordDigest } from '../lib/record.mjs';
import { preflightReasons } from '../lib/preflight.mjs';
import { FAILING_OUTCOMES, OUTCOMES, classifyVerification, summarizeOutcome } from '../lib/outcome.mjs';
import { digestOfValue } from '../lib/canonical.mjs';
import { EVIDENCE_SCHEMA, TOOLING_SCHEMA } from '../lib/dependency-evidence.mjs';
import { buildCandidate, cli, fixtureFrontend, startOrigin, tempDir } from './harness.mjs';
import {
  ARTIFACT_ID, HOSTING_DIGEST, NOW, POLICY, POLICY_FACTS, TREE_DIGEST, ZIP_DIGEST, admittedRecordFor, baseline, clone, codes,
  unchangedPreflightFacts,
} from './fixtures.mjs';

const recordFor = (input) => admittedRecordFor(input, { policyFacts: POLICY_FACTS });
const unchangedFacts = unchangedPreflightFacts;

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
    assert.equal(record.hosting.toolsVersion, POLICY.publisher.version);
    assert.equal(record.expiresAt, '2026-09-23T11:30:00Z', 'certification start + the policy window, the earlier of the two windows');
  });

  test('CONTRACT (B2.2): the record binds the certification evidence, the fresh assessment and the exact toolchain — never an `auditPassed`', () => {
    const input = baseline();
    const record = recordFor(input);
    const ev = input.artifact.dependencyEvidence;
    const as = input.dependencies.assessment;
    const t = input.dependencies.tooling;
    assert.deepEqual(record.dependencies.evidence, {
      schema: EVIDENCE_SCHEMA, recordDigest: ev.recordDigest, treeDigest: ev.treeDigest, entryCount: ev.entryCount,
      lockDigest: ev.inputs.lockDigest, manifestSha256: ev.inputs.manifestSha256,
      installedTreeSha256: ev.record.inventory.installedTreeSha256, environment: ev.record.environment,
      certificationRun: { runId: '4242', runAttempt: '1' },
    });
    const a = record.dependencies.assessment;
    assert.equal(a.digest, as.digest);
    assert.deepEqual([a.runId, a.runAttempt, a.startedAt, a.finishedAt, a.decidedAt], [as.doc.assessor.runId, as.doc.assessor.runAttempt, as.doc.startedAt, as.doc.finishedAt, as.doc.decidedAt]);
    assert.deepEqual(a.artifact, { id: input.dependencies.uploads.assessment.id, name: input.dependencies.uploads.assessment.name, digest: input.dependencies.uploads.assessment.digest });
    assert.equal(a.outcome, 'within_policy');
    assert.equal(a.policySha256, as.doc.policy.sha256);
    assert.deepEqual(Object.keys(a.graphs), ['application', 'scanner', 'publisher']);
    assert.deepEqual(record.publisher, {
      schema: TOOLING_SCHEMA, package: t.package, version: t.version, node: t.node, deployAgent: POLICY.publisher.deployAgent,
      entrypoint: t.entrypoint, treeDigest: t.treeDigest, entryCount: t.entryCount, lockfileSha256: t.lock.lockfileSha256,
      installedTreeSha256: t.installedTreeSha256,
      artifact: { id: input.dependencies.uploads.tooling.id, name: input.dependencies.uploads.tooling.name, digest: input.dependencies.uploads.tooling.digest },
    });
    assert.equal(JSON.stringify(record).includes('auditPassed'), false);
  });

  test('CONTRACT (B2.2): the record expires at the EARLIER of the certification window, the assessment window and an applied exception\'s lapse', () => {
    const input = baseline();
    input.policy.freshness.assessmentWindowHours = 2;
    assert.equal(recordFor(input).expiresAt, '2026-09-22T13:50:00Z', 'assessment start + its window');
    const withRecord = baseline();
    withRecord.dependencies.assessment.doc.recordsApplied = [{ id: 'fixture-exception', expires: '2026-09-23' }];
    assert.equal(recordFor(withRecord).expiresAt, '2026-09-23T00:00:00Z', 'the exception lapses at 00:00 UTC on its date');
  });

  test('CONTRACT (B2.2): two certifications, two assessments or two toolchains of ONE SHA are distinguishable in the record', () => {
    const one = recordFor();
    const otherRun = baseline();
    otherRun.certification.runId = '4243';
    otherRun.certification.artifacts = [{ ...otherRun.certification.artifacts[0], id: 778, name: 'frontend-release-4243-1', workflowRunId: 4243 }];
    const otherTooling = baseline();
    otherTooling.dependencies.tooling.treeDigest = `sha256:${'0'.repeat(64)}`;
    const otherAssessment = baseline();
    otherAssessment.dependencies.assessment.digest = `sha256:${'0'.repeat(64)}`;
    for (const other of [otherRun, otherTooling, otherAssessment]) assert.notEqual(recordDigest(recordFor(other)), recordDigest(one));
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
    ['REGRESSION (R3.d): a verifier other than the admitting revision', 'preflight.policy_mismatch', (f) => { f.trusted.verifierTree = { ...f.trusted.verifierTree, release: '0'.repeat(40) }; }],
    ['CONTRACT (B2.2): an audit verifier other than the admitting revision', 'preflight.policy_mismatch', (f) => { f.trusted.verifierTree = { ...f.trusted.verifierTree, dependencyAudit: '0'.repeat(40) }; }],
    ['CONTRACT: a policy digest other than the admitted one', 'preflight.policy_mismatch', (f) => { f.trusted.policyDigest = `sha256:${'0'.repeat(64)}`; }],
    ['CONTRACT: release/ advanced on the default branch since the gate — an explicit restart', 'preflight.policy_advanced', (f) => { f.current.verifierTree = { ...f.current.verifierTree, release: '0'.repeat(40) }; }],
    ['CONTRACT (B2.2): dependency-audit/ (the audit policy, the scanner lock) advanced since the gate — an explicit restart', 'preflight.policy_advanced', (f) => { f.current.verifierTree = { ...f.current.verifierTree, dependencyAudit: '0'.repeat(40) }; }],
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
    // THE FRESH HALF, re-established from THIS job's own downloads.
    ['CONTRACT (B2.2): a re-run of the publish job alone carries an assessment from an earlier attempt — a repeat re-assesses', 'preflight.assessment_not_current', (f) => { f.evaluation.runAttempt = '2'; }],
    ['CONTRACT (B2.2): an assessment made by ANOTHER run', 'preflight.assessment_not_current', (f) => { f.evaluation.runId = '9999'; }],
    ['CONTRACT (B2.2): the admitted assessment upload is no longer listed as admitted', 'preflight.assessment_replaced', (f) => { f.evaluationArtifacts[0].digest = `sha256:${'0'.repeat(64)}`; }],
    ['CONTRACT (B2.2): the admitted assessment upload expired', 'preflight.assessment_replaced', (f) => { f.evaluationArtifacts[0].expired = true; }],
    ['CONTRACT (B2.2): the admitted toolchain upload is no longer listed as admitted', 'preflight.tooling_replaced', (f) => { f.evaluationArtifacts[1].name = 'publisher-tooling-other'; }],
    ['CONTRACT (B2.2): the downloaded toolchain is not the admitted tree', 'preflight.tooling_mismatch', (f) => { f.tooling.treeDigest = `sha256:${'0'.repeat(64)}`; }],
    ['CONTRACT (B2.2): the downloaded toolchain has a different entrypoint', 'preflight.tooling_mismatch', (f) => { f.tooling.entrypointSha256 = '0'.repeat(64); }],
    ['CONTRACT (B2.2): the downloaded toolchain carries a link or an unexpected entry', 'preflight.tooling_mismatch', (f) => { f.tooling.unsafe = ['symbolic link: node_modules/.bin/firebase']; }],
    ['CONTRACT (B2.2): the downloaded toolchain has one more file', 'preflight.tooling_mismatch', (f) => { f.tooling.entryCount += 1; }],
    ['CONTRACT (B2.2): this job runs another Node than the one the toolchain was admitted under', 'preflight.runtime_mismatch', (f) => { f.tooling.runtime = 'v24.0.0'; }],
    ['CONTRACT (B2.2): the downloaded assessment is not the admitted document', 'preflight.assessment_mismatch', (f) => { f.assessment.digest = `sha256:${'0'.repeat(64)}`; }],
    ['CONTRACT (B2.2): the downloaded assessment is incomplete (a raw output missing)', 'preflight.assessment_mismatch', (f) => { f.assessment.problems = [{ code: 'assessment.raw_missing', detail: 'publisher' }]; }],
    ['CONTRACT (B2.2): nothing was downloaded where the assessment should be', 'preflight.assessment_mismatch', (f) => { f.assessment = { state: 'absent', problems: [] }; }],
  ];
  for (const [name, code, mutate] of cases) {
    test(name, () => { assert.deepEqual(preflight(recordFor(), mutate), [code]); });
  }

  test('CONTRACT (B2.2): a run whose artifacts cannot be listed proves neither upload — both refused', () => {
    assert.deepEqual(preflight(recordFor(), (f) => { f.evaluationArtifacts = null; }).sort(), ['preflight.assessment_replaced', 'preflight.tooling_replaced']);
  });

  test('CONTRACT: a certification past its window is refused at the promotion boundary', () => {
    assert.deepEqual(preflight(recordFor(), null, { now: '2026-09-23T11:30:01Z' }), ['preflight.certification_stale']);
  });

  test('CONTROL: the last moment inside the window is still inside it', () => {
    assert.deepEqual(preflight(recordFor(), null, { now: '2026-09-23T11:30:00Z' }), []);
  });

  test('CONTRACT (B2.2): an assessment that aged out while the run waited is refused at the promotion boundary, by its own name', () => {
    const policy = clone(POLICY);
    policy.freshness.assessmentWindowHours = 1;
    const input = baseline();
    input.policy.freshness.assessmentWindowHours = 1;
    // Admitted at 12:00 (collected 11:50); the publisher reaches the boundary at 12:51.
    assert.deepEqual(preflight(recordFor(input), null, { now: '2026-09-22T12:51:00Z', policy }), ['preflight.assessment_stale']);
    assert.deepEqual(preflight(recordFor(input), null, { now: '2026-09-22T12:50:00Z', policy }), [], 'CONTROL: the last moment inside it');
  });

  test('CONTRACT (B2.2): an exception that lapsed while the run waited is refused at the promotion boundary', () => {
    const input = baseline();
    input.dependencies.assessment.doc.recordsApplied = [{ id: 'fixture-exception', expires: '2026-09-23' }];
    const record = recordFor(input);
    assert.equal(record.admitted, true, 'admitted while the exception stood');
    const at = (now) => preflight(record, (f) => { f.assessment = clone(input.dependencies.assessment); }, { now });
    assert.deepEqual(at('2026-09-22T23:59:59Z'), []);
    assert.deepEqual(at('2026-09-23T00:00:00Z'), ['preflight.exception_expired']);
  });

  test('CONTRACT: every change is reported, not the first', () => {
    const got = preflight(recordFor(), (f) => { f.run.runAttempt = '2'; f.current.verifierTree = { release: '0'.repeat(40), dependencyAudit: '0'.repeat(40) }; f.hosting.digest = null; });
    assert.deepEqual(got.sort(), ['preflight.attempt_changed', 'preflight.hosting_mismatch', 'preflight.policy_advanced']);
  });

  test('CONTRACT: an invalid record short-circuits — nothing else is judged against it', () => {
    const record = { ...recordFor(), schema: 'x' };
    assert.deepEqual(preflight(record), ['preflight.record_invalid']);
  });
});

describe('outcomes — what happened, stated as what it is', () => {
  const record = recordFor();
  // What verify-served observes about the identity: the manifest it names AND the cache
  // header it was served with, which is the first thing the NEXT decision reads.
  const identity = {
    state: 'known', commit: record.target.commit, manifestDigest: record.artifact.manifestDigest,
    cacheControl: 'no-store', cacheControlNoStore: true,
  };
  const allFiles = { checked: record.artifact.entryCount, mismatched: [], unreachable: [] };

  test('CONTRACT: the closed set, and which of it turns a run red', () => {
    assert.deepEqual([...OUTCOMES].sort(), ['PENDING_PREREQUISITES', 'PREFLIGHT_REFUSED', 'PUBLICATION_FAILED', 'PUBLISHED_DEGRADED', 'PUBLISHED_VERIFIED', 'REFUSED', 'SKIPPED_IDENTICAL', 'SKIPPED_STALE', 'WOULD_PUBLISH']);
    // UNCHANGED by the readiness word: a recorded wait is not red, and nothing that was
    // red before became green.
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
    ['the publish command refused at its last boundary and ran no tool', { decision: 'PROCEED', preflightOk: true, enabled: true, publishStep: 'failure', boundaryRefused: true, verification: { servesCandidate: false } }, 'PREFLIGHT_REFUSED'],
    ['a last-boundary refusal beside an origin that serves the candidate anyway', { decision: 'PROCEED', preflightOk: true, enabled: true, publishStep: 'failure', boundaryRefused: true, verification: { servesCandidate: true } }, 'PUBLISHED_DEGRADED'],
    ['a truthy non-boolean is not a boundary refusal', { decision: 'PROCEED', preflightOk: true, enabled: true, publishStep: 'failure', boundaryRefused: 'true', verification: { servesCandidate: false } }, 'PUBLICATION_FAILED'],
    ['the tool succeeded and every file fetched back matches', { decision: 'PROCEED', preflightOk: true, enabled: true, publishStep: 'success', verification: { verified: true } }, 'PUBLISHED_VERIFIED'],
    ['the tool succeeded and verification did not establish the candidate', { decision: 'PROCEED', preflightOk: true, enabled: true, publishStep: 'success', verification: { verified: false } }, 'PUBLISHED_DEGRADED'],
    ['the tool succeeded and verification never ran', { decision: 'PROCEED', preflightOk: true, enabled: true, publishStep: 'success', verification: null }, 'PUBLISHED_DEGRADED'],
  ];
  for (const [name, input, outcome] of cases) test(`CONTRACT: ${name} → ${outcome}`, () => assert.equal(summarizeOutcome(input), outcome));

  // A RECORDED WAIT IS A REFUSAL WITH A SEPARATE WORD — and only a refusal can be one.
  // The flag is set by the CLI from readinessCovers (a digest-bound classification),
  // and here it is read STRICTLY: nothing but `true` on a REFUSE changes the word.
  const waiting = [
    ['CONTRACT: a refusal classified as the recorded waiting state', { decision: 'REFUSE', awaiting: true }, 'PENDING_PREREQUISITES'],
    ['CONTROL: a refusal with no classification stays REFUSED', { decision: 'REFUSE' }, 'REFUSED'],
    ['CONTROL: a truthy non-boolean is not a classification', { decision: 'REFUSE', awaiting: 'true' }, 'REFUSED'],
    ['CONTROL: an admitted candidate is never re-labelled a wait', { decision: 'PROCEED', awaiting: true, preflightOk: true, enabled: false }, 'WOULD_PUBLISH'],
    ['CONTROL: an admitted, refused-in-preflight candidate is never re-labelled a wait', { decision: 'PROCEED', awaiting: true, preflightOk: false }, 'PREFLIGHT_REFUSED'],
    ['CONTROL: a published candidate is never re-labelled a wait', { decision: 'PROCEED', awaiting: true, preflightOk: true, enabled: true, publishStep: 'success', verification: { verified: true } }, 'PUBLISHED_VERIFIED'],
    ['CONTROL: a skip is never re-labelled a wait', { decision: 'SKIP_STALE', awaiting: true }, 'SKIPPED_STALE'],
    ['CONTROL: no decision at all is never a wait', { decision: '', awaiting: true }, 'REFUSED'],
  ];
  for (const [name, input, outcome] of waiting) test(`${name} → ${outcome}`, () => assert.equal(summarizeOutcome(input), outcome));
  test('CONTRACT: the recorded wait is not a failing outcome, and is none of the words that claim a publication', () => {
    assert.equal(FAILING_OUTCOMES.has('PENDING_PREREQUISITES'), false);
    assert.notEqual('PENDING_PREREQUISITES', 'WOULD_PUBLISH');
    for (const claim of ['WOULD_PUBLISH', 'PUBLISHED_VERIFIED', 'PUBLISHED_DEGRADED']) {
      assert.notEqual(summarizeOutcome({ decision: 'REFUSE', awaiting: true, preflightOk: true, enabled: true, publishStep: 'success', verification: { verified: true } }), claim);
    }
  });

  test('CONTROL: the admitted identity, served no-store, and every certified file → verified', () => {
    assert.deepEqual(classifyVerification(record, { identity, files: allFiles }), { servesCandidate: true, identityNoStore: true, filesMatch: true, verified: true });
  });

  test('REGRESSION (Codex P2 on #687): the admitted identity served CACHEABLE is not verified — the next gate could not read it', () => {
    const r = classifyVerification(record, { identity: { ...identity, cacheControl: 'public, max-age=300', cacheControlNoStore: false }, files: allFiles });
    assert.deepEqual(r, { servesCandidate: true, identityNoStore: false, filesMatch: true, verified: false });
    assert.equal(summarizeOutcome({ decision: 'PROCEED', preflightOk: true, enabled: true, publishStep: 'success', verification: r }), 'PUBLISHED_DEGRADED');
  });

  test('CONTRACT: a cache header that was never observed is not no-store — absence verifies nothing', () => {
    const { cacheControl, cacheControlNoStore, ...unobserved } = identity;
    assert.equal(classifyVerification(record, { identity: unobserved, files: allFiles }).verified, false);
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
    assert.equal(r.identity.cacheControlNoStore, true);
    assert.equal(r.identity.cacheControl, 'no-store');
    assert.match(r.note, /one vantage point/);
  });

  test('REGRESSION (Codex P2 on #687): the right candidate served with a CACHEABLE identity → not verified, and the header is recorded', async () => {
    const config = world.config;
    world.config = clone(config);
    world.config.hosting[0].headers = world.config.hosting[0].headers.map((rule) => (rule.source === '/release.json'
      ? { ...rule, headers: [{ key: 'Cache-Control', value: 'public, max-age=300' }] } : rule));
    try {
      const r = await verify(published(world.candidate));
      assert.equal(r.servesCandidate, true, 'the bytes and the identity are right');
      assert.equal(r.identity.cacheControl, 'public, max-age=300');
      assert.equal(r.identity.cacheControlNoStore, false);
      assert.equal(r.verified, false);
      assert.equal(summarizeOutcome({ decision: 'PROCEED', preflightOk: true, enabled: true, publishStep: 'success', verification: r }), 'PUBLISHED_DEGRADED');
    } finally {
      world.config = config;
    }
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
