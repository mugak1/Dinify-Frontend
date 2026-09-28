/**
 * JOURNEY RECORD (D16 / D08 B4, component B1): the evidence record, the reviewed B4
 * minimum contract, and the rules separating a TRUTHFUL record from a CERTIFIED gate run.
 *
 * EVERY RECORD HERE IS A SYNTHETIC MODEL of the proposed schema. No journey ran to
 * produce any of them, and a record passing certified acceptance below is the rules
 * accepting a made-up model, not a journey passing. Every id, SHA, digest and time is
 * invented.
 *
 * Expected outcomes are literal refusal codes per case, not derived from the
 * implementation.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { digestOf } from '../lib/canonical.mjs';
import {
  B4_MINIMUM_CONTRACT, B4_MINIMUM_CONTRACT_DIGEST, CONTRACT_SCHEMA, RECORD_SCHEMA, assessJourneyRecord, contractGaps,
  journeyContractDigest, validateContract, validateJourneyRecord,
} from '../lib/journey-record.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const clone = (v) => JSON.parse(JSON.stringify(v));
const d = (label) => digestOf(Buffer.from(`SYNTHETIC ${label}`));
const sha = (c) => c.repeat(40);
const at = (seconds) => new Date(Date.UTC(2026, 9, 1, 12, 0, 0) + seconds * 1000).toISOString().replace('.000Z', 'Z');
const RUN = { runId: '960001', runAttempt: '1' };

function candidate(repository, commit, tree, name, id) {
  return {
    kind: 'downloaded-candidate', repository, commit, tree, descriptorDigest: d(`${name} descriptor`),
    artifact: { id, name, listedDigest: d(`${name} zip`), measuredDigest: d(`${name} zip`) }, execution: 'executed',
  };
}

const evidenceFor = (requirement) => {
  if (requirement === 'environment') return [{ kind: 'ci', ref: 'synthetic:environment-check' }];
  const base = [{ kind: 'candidate-execution', ref: 'synthetic:ui-and-api' }, { kind: 'ci', ref: 'synthetic:ci-log' }];
  return requirement === 'synthetic-allowed' ? [...base, { kind: 'synthetic', ref: 'synthetic:unreadable-terms-response' }] : base;
};

/** A complete SYNTHETIC model of a certified gate run against the B4 minimum. */
function certifiedModel() {
  const outcomes = B4_MINIMUM_CONTRACT.outcomes.map((x, n) => ({
    id: x.id, kind: x.kind, result: 'passed', startedAt: at(10 + n * 10), finishedAt: at(15 + n * 10),
    producerRun: { ...RUN }, evidence: evidenceFor(x.evidence),
  }));
  const last = 15 + (B4_MINIMUM_CONTRACT.outcomes.length - 1) * 10;
  return {
    schema: RECORD_SCHEMA,
    contract: { id: B4_MINIMUM_CONTRACT.id, revision: B4_MINIMUM_CONTRACT.revision, digest: B4_MINIMUM_CONTRACT_DIGEST },
    producer: {
      kind: 'ci', repository: 'mugak1/Dinify-Frontend', workflowPath: '.github/workflows/certify.yml', ...RUN,
      event: 'push', ref: 'refs/heads/main', checkout: { kind: 'push-commit', commit: sha('1'), tree: sha('2') },
    },
    inputs: {
      frontend: {
        kind: 'downloaded-candidate', repository: 'mugak1/Dinify-Frontend', commit: sha('1'), tree: sha('2'),
        artifact: { id: 970001, name: 'frontend-release-960001-1', listedDigest: d('fe zip'), measuredDigest: d('fe zip') },
        payloadTreeDigest: d('fe tree'), execution: 'executed',
      },
      peers: {
        admin: candidate('mugak1/Dinify-Admin', sha('3'), sha('4'), 'admin-candidate-980001-1', 970002),
        backend: candidate('mugak1/Dinify-Backend', sha('5'), sha('6'), 'backend-candidate-980002-1', 970003),
      },
      harness: { repository: 'mugak1/Dinify-Frontend', commit: sha('1'), tree: sha('2') },
      toolchain: { lockDigest: d('toolchain lock'), node: 'v24.21.0', browser: { name: 'chromium', version: '141.0.0', archiveDigest: d('browser') } },
      testHost: { kind: 'ci-runner', profileDigest: d('host profile') },
    },
    startedAt: at(0), finishedAt: at(last + 30),
    outcomes,
    cleanup: { result: 'completed', finishedAt: at(last + 20) },
    overall: 'passed',
  };
}

const assess = (record, { contract = B4_MINIMUM_CONTRACT, expectedInputs = clone(certifiedModel().inputs) } = {}) =>
  assessJourneyRecord({ record, contract, expectedInputs });
const codes = (r) => r.reasons.map((x) => x.code);
const outcome = (record, id) => record.outcomes.find((x) => x.id === id);
const uniq = (list) => [...new Set(list)].sort();

// ── the reviewed minimum ────────────────────────────────────────────────────────

describe('the reviewed B4 minimum contract', () => {
  test('CONTRACT: its digest is pinned, so changing it is a visible reviewed change', () => {
    assert.equal(B4_MINIMUM_CONTRACT_DIGEST, 'sha256:001bb05a6e3c20a6b9c2ba7db2e63583ba4f9b70f097209e4cabc887b2913405');
    assert.equal(journeyContractDigest(B4_MINIMUM_CONTRACT), B4_MINIMUM_CONTRACT_DIGEST);
    assert.equal(B4_MINIMUM_CONTRACT.schema, CONTRACT_SCHEMA);
  });
  test('CONTRACT: it covers J0 to J4, the defined negative control, positive controls and cleanup', () => {
    assert.deepEqual([...B4_MINIMUM_CONTRACT.journeys], ['J0', 'J1', 'J2', 'J3', 'J4']);
    for (const j of ['J0', 'J1', 'J2', 'J3', 'J4']) assert.ok(B4_MINIMUM_CONTRACT.outcomes.some((x) => x.journey === j), j);
    assert.equal(B4_MINIMUM_CONTRACT.negativeControl, 'J1.negative.cors-excluded-detected');
    assert.equal(B4_MINIMUM_CONTRACT.outcomes.filter((x) => x.kind === 'negative-control').length, 1);
    assert.ok(B4_MINIMUM_CONTRACT.outcomes.filter((x) => x.kind === 'positive-control').length >= 3);
    assert.equal(B4_MINIMUM_CONTRACT.cleanup, 'required');
    assert.deepEqual(validateContract(B4_MINIMUM_CONTRACT), []);
  });
  test('CONTRACT: exactly one scenario may carry synthetic evidence, and it is unreadable terms', () => {
    assert.deepEqual(B4_MINIMUM_CONTRACT.outcomes.filter((x) => x.evidence === 'synthetic-allowed').map((x) => x.id), ['J3.billing.unreadable-terms']);
    assert.ok(!B4_MINIMUM_CONTRACT.allowedEvidence.includes('live'));
    assert.ok(!B4_MINIMUM_CONTRACT.allowedEvidence.includes('local-build'));
  });
  test('CONTRACT: the amendments are named obligations, not implied ones', () => {
    const ids = B4_MINIMUM_CONTRACT.outcomes.map((x) => x.id);
    for (const id of [
      'J1.kitchen.ui-consumes-order', // the optimized kitchen UI, not a Node writer
      'J2.accept.lost-response-recovered-without-resend', // recovery finishes without another PUT
      'J2.accept.draft-command-resent-immutably',
      'J4.admin.rotated-session-request-refused-without-mutation',
      'J4.admin.boundary-discards-predecessor-state',
      'J0.egress.redirect-hop-denied',
      'J0.egress.ipv4-ipv6-and-proxy-denied',
      'J0.egress.workers-and-service-workers-denied',
      'J3.dashboard.preview-kpis-and-real-reviews',
    ]) assert.ok(ids.includes(id), id);
    assert.deepEqual(B4_MINIMUM_CONTRACT.notInJourneys.map((x) => x.id), ['J2.confirm.unknown-estimate-comparison', 'J1.concurrency.multi-connection-races']);
  });
});

// ── a complete synthetic model ──────────────────────────────────────────────────

describe('SYNTHETIC: a complete model of the proposed schema', () => {
  test('CONTROL: the rules accept a complete certified model (this is not journey execution)', () => {
    const r = assess(certifiedModel());
    assert.deepEqual(r.reasons, []);
    assert.equal(r.structurallyValid, true);
    assert.equal(r.truthful, true);
    assert.equal(r.certifiedGateAcceptance, true);
    assert.deepEqual(r.coverage, { required: 39, passed: 39, missing: [], notPassed: [], unexpected: [] });
  });
  test('CONTROL: the one approved synthetic scenario may carry its synthetic response', () => {
    const rec = certifiedModel();
    assert.ok(outcome(rec, 'J3.billing.unreadable-terms').evidence.some((e) => e.kind === 'synthetic'));
    assert.equal(assess(rec).certifiedGateAcceptance, true);
  });
});

// ── truthful, and still not certified ──────────────────────────────────────────

function localModel() {
  const rec = certifiedModel();
  rec.producer = { kind: 'local', repository: 'mugak1/Dinify-Frontend', workflowPath: null, runId: null, runAttempt: null, event: null, ref: null, checkout: { kind: 'local-worktree', commit: sha('1'), tree: sha('2') } };
  rec.inputs.frontend = { ...rec.inputs.frontend, kind: 'local-build', artifact: null, execution: 'executed' };
  for (const name of ['admin', 'backend']) rec.inputs.peers[name] = { ...rec.inputs.peers[name], kind: 'local-build', artifact: null, descriptorDigest: null };
  rec.inputs.testHost = { kind: 'local', profileDigest: d('laptop profile') };
  for (const x of rec.outcomes) {
    x.producerRun = { runId: null, runAttempt: null };
    x.evidence = x.evidence.filter((e) => e.kind === 'synthetic').concat([{ kind: 'local-build', ref: 'synthetic:local-run' }]);
  }
  return rec;
}

describe('SYNTHETIC: a truthful local or partial record is never a certified run', () => {
  test('REGRESSION: a LOCAL build run is truthful and inadmissible', () => {
    const r = assess(localModel());
    assert.equal(r.structurallyValid, true);
    assert.equal(r.truthful, true);
    assert.equal(r.certifiedGateAcceptance, false);
    assert.deepEqual(uniq(codes(r)), [
      'journey.record.candidate_execution_missing', // scenarios: no downloaded candidate was executed
      'journey.record.evidence_kind_not_allowed', // local-build evidence is not admissible
      'journey.record.execution_evidence_missing', // J0: no CI execution of the checks themselves
      'journey.record.input_mismatch', // not the inputs the caller expected
      'journey.record.input_not_candidate_execution',
      'journey.record.not_certified_producer',
    ]);
  });
  test('REGRESSION: a local build does not inherit the candidate\'s identity at the same commit', () => {
    const rec = localModel();
    rec.inputs.frontend.artifact = clone(certifiedModel().inputs.frontend.artifact);
    const r = assess(rec);
    assert.equal(r.truthful, false);
    assert.deepEqual(uniq(codes(r)), [
      'journey.record.candidate_execution_missing', 'journey.record.evidence_kind_not_allowed', 'journey.record.execution_evidence_missing',
      'journey.record.input_mismatch', 'journey.record.input_not_candidate_execution', 'journey.record.local_build_claims_candidate',
      'journey.record.not_certified_producer',
    ]);
  });
  test('REGRESSION: a partial CI run covering J0 and J1 is truthful and inadmissible', () => {
    const rec = certifiedModel();
    rec.outcomes = rec.outcomes.filter((x) => x.id.startsWith('J0.') || x.id.startsWith('J1.'));
    const r = assess(rec);
    assert.equal(r.truthful, true);
    assert.equal(r.certifiedGateAcceptance, false);
    assert.deepEqual(uniq(codes(r)), ['journey.record.outcome_missing']);
    assert.equal(r.coverage.missing.length, 39 - 19);
    assert.ok(r.coverage.missing.every((id) => /^J[234]\./.test(id)));
  });
  test('REGRESSION: downloaded certified bytes are not executed certified bytes', () => {
    const rec = certifiedModel();
    rec.inputs.peers.backend.execution = 'downloaded-not-executed';
    const r = assess(rec, { expectedInputs: clone(rec.inputs) });
    assert.deepEqual(uniq(codes(r)), ['journey.record.input_not_candidate_execution']);
  });
  test('REGRESSION: candidate execution claimed when no candidate was executed is untruthful', () => {
    const rec = certifiedModel();
    for (const input of [rec.inputs.frontend, rec.inputs.peers.admin, rec.inputs.peers.backend]) input.execution = 'downloaded-not-executed';
    const r = assess(rec, { expectedInputs: clone(rec.inputs) });
    assert.equal(r.truthful, false);
    assert.deepEqual(uniq(codes(r)), ['journey.record.evidence_kind_inconsistent', 'journey.record.input_not_candidate_execution']);
  });
});

// ── the contract comes from the caller ─────────────────────────────────────────

function narrowedContract() {
  const c = clone(B4_MINIMUM_CONTRACT);
  c.id = 'self-narrowed';
  c.journeys = ['J0', 'J1', 'J3'];
  c.outcomes = c.outcomes.filter((x) => !/^J[24]\./.test(x.id));
  return c;
}

describe('SYNTHETIC: a record cannot narrow the contract it is judged against', () => {
  test('REGRESSION: omitting J2 and J4 from its own contract and outcomes is missing coverage', () => {
    const rec = certifiedModel();
    const narrow = narrowedContract();
    rec.contract = { id: narrow.id, revision: narrow.revision, digest: journeyContractDigest(narrow) };
    rec.outcomes = rec.outcomes.filter((x) => !/^J[24]\./.test(x.id));
    const r = assess(rec);
    assert.equal(r.certifiedGateAcceptance, false);
    assert.deepEqual(uniq(codes(r)), ['journey.record.contract_mismatch', 'journey.record.outcome_missing']);
    const missing = r.reasons.filter((x) => x.code === 'journey.record.outcome_missing').map((x) => x.detail);
    assert.deepEqual(missing, B4_MINIMUM_CONTRACT.outcomes.map((x) => x.id).filter((id) => /^J[24]\./.test(id)));
    assert.equal(missing.length, 13);
  });
  test('REGRESSION: supplying that narrowed contract as the expected one is below the minimum', () => {
    const rec = certifiedModel();
    const narrow = narrowedContract();
    rec.contract = { id: narrow.id, revision: narrow.revision, digest: journeyContractDigest(narrow) };
    rec.outcomes = rec.outcomes.filter((x) => !/^J[24]\./.test(x.id));
    const r = assess(rec, { contract: narrow });
    assert.equal(r.certifiedGateAcceptance, false);
    assert.deepEqual(uniq(codes(r)), ['journey.record.contract_below_minimum']);
  });
  const CONTRACT_CASES = [
    ['missing', undefined, 'journey.record.contract_missing'],
    ['null', null, 'journey.record.contract_missing'],
    ['empty', {}, 'journey.record.contract_invalid'],
    ['of an unknown schema', { ...clone(B4_MINIMUM_CONTRACT), schema: 'dinify.journey.contract/9' }, 'journey.record.contract_invalid'],
    ['with no outcomes', { ...clone(B4_MINIMUM_CONTRACT), outcomes: [] }, 'journey.record.contract_invalid'],
    ['allowing live evidence', { ...clone(B4_MINIMUM_CONTRACT), allowedEvidence: ['candidate-execution', 'ci', 'live'] }, 'journey.record.contract_invalid'],
    ['naming a negative control that is not one', { ...clone(B4_MINIMUM_CONTRACT), negativeControl: 'J1.diner.scan-menu-configure' }, 'journey.record.contract_invalid'],
  ];
  for (const [name, contract, code] of CONTRACT_CASES) {
    test(`REGRESSION: an expected contract ${name} is refused`, () => {
      const r = assessJourneyRecord({ record: certifiedModel(), contract, expectedInputs: clone(certifiedModel().inputs) });
      assert.equal(r.certifiedGateAcceptance, false);
      assert.deepEqual(uniq(codes(r)), [code]);
    });
  }
  test('REGRESSION: a contract loosening a server scenario to synthetic is below the minimum', () => {
    const c = clone(B4_MINIMUM_CONTRACT);
    c.outcomes.find((x) => x.id === 'J1.diner.server-price-exact').evidence = 'synthetic-allowed';
    assert.deepEqual(contractGaps(c), ['J1.diner.server-price-exact requires server evidence, not synthetic-allowed']);
  });
  test('REGRESSION: a contract moving an egress check onto server evidence is below the minimum', () => {
    const c = clone(B4_MINIMUM_CONTRACT);
    c.outcomes.find((x) => x.id === 'J0.egress.node-client-denied').evidence = 'server';
    assert.deepEqual(contractGaps(c), ['J0.egress.node-client-denied requires environment evidence, not server']);
  });
  test('REGRESSION: a contract adding a scenario that allows synthetic evidence is below the minimum', () => {
    const c = clone(B4_MINIMUM_CONTRACT);
    c.outcomes.push({ id: 'J3.billing.extra-synthetic', journey: 'J3', kind: 'scenario', evidence: 'synthetic-allowed' });
    assert.deepEqual(validateContract(c), []);
    assert.deepEqual(contractGaps(c), ['J3.billing.extra-synthetic allows synthetic evidence the minimum does not']);
  });
  test('REGRESSION: a contract naming another negative control is below the minimum', () => {
    const c = clone(B4_MINIMUM_CONTRACT);
    c.outcomes.push({ id: 'J1.negative.other-fault', journey: 'J1', kind: 'negative-control', evidence: 'server' });
    c.negativeControl = 'J1.negative.other-fault';
    assert.deepEqual(validateContract(c), []);
    assert.deepEqual(contractGaps(c), ['the negative control is not the defined one']);
  });
  test('CONTROL: withdrawing the synthetic allowance from the approved scenario is stricter, not a gap', () => {
    const c = clone(B4_MINIMUM_CONTRACT);
    c.outcomes.find((x) => x.id === 'J3.billing.unreadable-terms').evidence = 'server';
    assert.deepEqual(contractGaps(c), []);
  });
  test('CONTROL: the reviewed minimum has no gaps against itself', () => {
    assert.deepEqual(validateContract(B4_MINIMUM_CONTRACT), []);
    assert.deepEqual(contractGaps(B4_MINIMUM_CONTRACT), []);
  });
  test('CONTROL: a stricter contract with an extra scenario is accepted when the record covers it', () => {
    const c = clone(B4_MINIMUM_CONTRACT);
    c.id = 'stricter';
    c.outcomes.push({ id: 'J1.diner.extra-check', journey: 'J1', kind: 'scenario', evidence: 'server' });
    const rec = certifiedModel();
    rec.contract = { id: c.id, revision: c.revision, digest: journeyContractDigest(c) };
    rec.outcomes.push({ ...clone(rec.outcomes[8]), id: 'J1.diner.extra-check' });
    const r = assess(rec, { contract: c });
    assert.deepEqual(r.reasons, []);
  });
});

// ── outcomes that do not add up ─────────────────────────────────────────────────

const OUTCOME_CASES = [
  ['a skipped negative control', (rec) => { outcome(rec, 'J1.negative.cors-excluded-detected').result = 'skipped'; },
    ['journey.record.failure_hidden', 'journey.record.negative_control_not_passed', 'journey.record.outcome_not_passed']],
  ['a failure hidden by an overall pass', (rec) => { outcome(rec, 'J2.quote.closed-quote-successor-review').result = 'failed'; },
    ['journey.record.failure_hidden', 'journey.record.outcome_not_passed']],
  ['an honest overall failure', (rec) => { outcome(rec, 'J2.quote.closed-quote-successor-review').result = 'failed'; rec.overall = 'failed'; },
    ['journey.record.outcome_not_passed', 'journey.record.overall_not_passed']],
  ['cleanup that never ran', (rec) => { rec.cleanup = { result: 'not-run', finishedAt: null }; },
    ['journey.record.cleanup_incomplete', 'journey.record.failure_hidden']],
  ['cleanup reported before the last outcome finished', (rec) => { rec.cleanup.finishedAt = rec.outcomes[0].finishedAt; },
    ['journey.record.time_inconsistent']],
  ['a contradictory duplicate outcome', (rec) => { rec.outcomes.push({ ...clone(outcome(rec, 'J4.admin.scoped-read')), result: 'failed' }); },
    ['journey.record.duplicate_outcome', 'journey.record.failure_hidden']],
  ['an outcome spliced from another run', (rec) => { outcome(rec, 'J4.admin.guarded-write-confirmed-by-server').producerRun = { runId: '960002', runAttempt: '1' }; },
    ['journey.record.outcome_from_other_run']],
  ['an outcome from another attempt', (rec) => { outcome(rec, 'J1.diner.server-price-exact').producerRun.runAttempt = '2'; },
    ['journey.record.outcome_from_other_run']],
  ['an outcome outside the record window', (rec) => { outcome(rec, 'J0.egress.node-client-denied').finishedAt = at(99999); },
    ['journey.record.time_inconsistent']],
  ['an outcome the contract does not name', (rec) => { rec.outcomes.push({ ...clone(rec.outcomes[8]), id: 'J1.diner.invented-check' }); },
    ['journey.record.outcome_unexpected']],
  ['an outcome reported as the wrong kind', (rec) => { outcome(rec, 'J4.positive.owner-read-carries-qr').kind = 'scenario'; },
    ['journey.record.outcome_kind_mismatch']],
  ['synthetic evidence on a server scenario', (rec) => { outcome(rec, 'J1.diner.server-price-exact').evidence.push({ kind: 'synthetic', ref: 'synthetic:made-up' }); },
    ['journey.record.synthetic_not_allowed']],
  ['a synthetic response standing in for the server', (rec) => { outcome(rec, 'J3.billing.canonical-terms').evidence = [{ kind: 'synthetic', ref: 'synthetic:made-up' }, { kind: 'ci', ref: 'synthetic:ci' }]; },
    ['journey.record.candidate_execution_missing', 'journey.record.synthetic_not_allowed']],
  ['live evidence', (rec) => { outcome(rec, 'J4.admin.scoped-read').evidence.push({ kind: 'live', ref: 'synthetic:live' }); },
    ['journey.record.evidence_kind_not_allowed']],
  ['an egress check with no execution evidence of its own', (rec) => { outcome(rec, 'J0.egress.redirect-hop-denied').evidence = [{ kind: 'source', ref: 'synthetic:reasoning' }]; },
    ['journey.record.execution_evidence_missing']],
];

describe('SYNTHETIC: outcomes that do not add up are refused by name', () => {
  for (const [name, edit, expected] of OUTCOME_CASES) {
    test(`REGRESSION: ${name}`, () => {
      const rec = certifiedModel();
      edit(rec);
      const r = assess(rec);
      assert.equal(r.certifiedGateAcceptance, false);
      assert.deepEqual(uniq(codes(r)), expected);
    });
  }
});

// ── inputs and the producer ─────────────────────────────────────────────────────

const INPUT_CASES = [
  ['another Admin candidate', (x) => { x.peers.admin.artifact.id = 970099; }, 'inputs.peers.admin'],
  ['another Backend revision', (x) => { x.peers.backend.commit = sha('7'); }, 'inputs.peers.backend'],
  ['another harness revision', (x) => { x.harness.commit = sha('8'); }, 'inputs.harness'],
  ['another toolchain lock', (x) => { x.toolchain.lockDigest = d('other lock'); }, 'inputs.toolchain'],
  ['another browser build', (x) => { x.toolchain.browser.version = '142.0.0'; }, 'inputs.toolchain'],
  ['another host profile', (x) => { x.testHost.profileDigest = d('other host'); }, 'inputs.testHost'],
  ['another Frontend candidate', (x) => { x.frontend.artifact.id = 970098; }, 'inputs.frontend'],
];

describe('SYNTHETIC: the inputs are the ones the caller independently expected', () => {
  for (const [name, edit, section] of INPUT_CASES) {
    test(`REGRESSION: ${name} is an input mismatch`, () => {
      const expectedInputs = clone(certifiedModel().inputs);
      edit(expectedInputs);
      const r = assess(certifiedModel(), { expectedInputs });
      assert.deepEqual(r.reasons, [{ code: 'journey.record.input_mismatch', detail: `${section} is not the expected one` }]);
    });
  }
  test('REGRESSION: no expected inputs at all', () => {
    const r = assessJourneyRecord({ record: certifiedModel(), contract: B4_MINIMUM_CONTRACT });
    assert.deepEqual(codes(r), ['journey.record.inputs_missing']);
  });
  test('REGRESSION: a measured digest that is not the listed one', () => {
    const rec = certifiedModel();
    rec.inputs.peers.admin.artifact.measuredDigest = d('something else');
    const r = assess(rec, { expectedInputs: clone(rec.inputs) });
    assert.deepEqual(uniq(codes(r)), ['journey.record.input_not_candidate_execution']);
  });
  test('REGRESSION: an unmeasured candidate', () => {
    const rec = certifiedModel();
    rec.inputs.frontend.artifact.measuredDigest = null;
    const r = assess(rec, { expectedInputs: clone(rec.inputs) });
    assert.deepEqual(uniq(codes(r)), ['journey.record.input_not_candidate_execution']);
  });
  test('REGRESSION: an unidentified browser', () => {
    const rec = certifiedModel();
    rec.inputs.toolchain.browser.archiveDigest = null;
    const r = assess(rec, { expectedInputs: clone(rec.inputs) });
    assert.deepEqual(codes(r), ['journey.record.toolchain_unidentified']);
  });
  test('REGRESSION: a pull-request run tested a synthetic merge, not the pushed commit', () => {
    const rec = certifiedModel();
    rec.producer.event = 'pull_request';
    rec.producer.ref = 'refs/pull/1/merge';
    rec.producer.checkout.kind = 'synthetic-merge';
    const r = assess(rec);
    assert.equal(r.truthful, true);
    assert.deepEqual(uniq(codes(r)), ['journey.record.not_certified_producer']);
  });
  test('REGRESSION: a push-commit checkout claimed by a pull-request run is untruthful', () => {
    const rec = certifiedModel();
    rec.producer.event = 'pull_request';
    const r = assess(rec);
    assert.equal(r.truthful, false);
    assert.deepEqual(uniq(codes(r)), ['journey.record.checkout_inconsistent', 'journey.record.not_certified_producer']);
  });
  test('REGRESSION: the tested checkout is not the Frontend candidate commit', () => {
    const rec = certifiedModel();
    rec.producer.checkout.commit = sha('9');
    const r = assess(rec);
    assert.deepEqual(uniq(codes(r)), ['journey.record.not_certified_producer']);
  });
});

// ── what a record may carry at all ──────────────────────────────────────────────

const STRUCTURE_CASES = [
  ['a session cookie', (rec) => { rec.inputs.testHost.sessionCookie = 'SYNTHETIC'; }, 'journey.record.sensitive_field'],
  ['an OTP', (rec) => { rec.otp = '1234'; }, 'journey.record.sensitive_field'],
  ['a QR credential', (rec) => { rec.outcomes[0].qrCredential = 'SYNTHETIC'; }, 'journey.record.sensitive_field'],
  ['a claim code', (rec) => { rec.claimCode = 'SYNTHETIC'; }, 'journey.record.sensitive_field'],
  ['a private key', (rec) => { rec.inputs.harness.privateKey = 'SYNTHETIC'; }, 'journey.record.sensitive_field'],
  ['a CSRF token', (rec) => { rec.producer.csrf = 'SYNTHETIC'; }, 'journey.record.sensitive_field'],
  ['a JWT in an ordinary field', (rec) => { rec.inputs.toolchain.browser.version = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJTWU5USEVUSUMifQ.c2ln'; }, 'journey.record.sensitive_value'],
  ['PEM key material', (rec) => { rec.outcomes[0].evidence[0].ref = '-----BEGIN PRIVATE KEY-----'; }, 'journey.record.sensitive_value'],
  ['an admin cookie pair', (rec) => { rec.outcomes[0].evidence[0].ref = '__Host-dinify_admin_session=SYNTHETIC'; }, 'journey.record.sensitive_value'],
  ['a Backend inventory', (rec) => { rec.inputs.peers.backend.packages = [{ name: 'SYNTHETIC' }]; }, 'journey.record.structure_invalid'],
  ['a broad readiness claim', (rec) => { rec.production_ready = true; }, 'journey.record.structure_invalid'],
  ['an all-findings-closed claim', (rec) => { rec.all_original_findings_closed = true; }, 'journey.record.structure_invalid'],
  ['an unknown schema version', (rec) => { rec.schema = 'dinify.journey.record/2'; }, 'journey.record.structure_invalid'],
  ['an unknown evidence kind', (rec) => { rec.outcomes[0].evidence[0].kind = 'trust-me'; }, 'journey.record.structure_invalid'],
  ['a URL with query data as an evidence reference', (rec) => { rec.outcomes[0].evidence[0].ref = 'https://example.invalid/?q=1'; }, 'journey.record.structure_invalid'],
  ['a foreign peer repository', (rec) => { rec.inputs.peers.admin.repository = 'someone/Dinify-Admin'; }, 'journey.record.structure_invalid'],
  ['a local producer naming a CI run', (rec) => { rec.producer.kind = 'local'; }, 'journey.record.structure_invalid'],
  ['an unbounded outcome list', (rec) => { rec.outcomes = Array.from({ length: 201 }, () => clone(rec.outcomes[0])); }, 'journey.record.structure_invalid'],
];

describe('SYNTHETIC: a record carries identities, never secrets, inventories or broad claims', () => {
  for (const [name, edit, code] of STRUCTURE_CASES) {
    test(`REGRESSION: ${name} is refused`, () => {
      const rec = certifiedModel();
      edit(rec);
      const problems = validateJourneyRecord(rec);
      assert.ok(problems.length > 0);
      assert.ok(problems.every((p) => p.code === code), JSON.stringify(problems));
      const r = assess(rec);
      assert.equal(r.structurallyValid, false);
      assert.equal(r.certifiedGateAcceptance, false);
    });
  }
  test('CONTROL: a refusal names where a secret was, never the secret', () => {
    const rec = certifiedModel();
    rec.inputs.toolchain.browser.version = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJTWU5USEVUSUMifQ.c2ln';
    assert.ok(!JSON.stringify(validateJourneyRecord(rec)).includes('eyJ'));
  });
});

describe('the module stays pure', () => {
  test('CONTRACT: it imports only the canonical serialiser', () => {
    const source = readFileSync(join(HERE, '../lib/journey-record.mjs'), 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    assert.deepEqual(imports, ['./canonical.mjs']);
    for (const word of ['process.env', 'Date.now', 'fetch(', 'spawn', 'readFileSync', 'decide(']) assert.ok(!source.includes(word), word);
  });
});
