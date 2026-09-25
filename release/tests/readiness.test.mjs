/**
 * READINESS — a deliberately non-publishing evaluation that completed is not a failed
 * release, and nothing else may be reported as one (release/lib/readiness.mjs).
 *
 * Three facts, kept apart by every test here:
 *   evaluation completed      readiness's own question
 *   release decision          REFUSE, allow:false — decide.mjs's, never altered
 *   publication performed     no — nothing here can admit or publish
 *
 * The first half drives the pure classifier with the committed policy and hand-built
 * evidence shaped exactly as the gate's steps write it. The second half drives the
 * REAL `readiness` and `outcome` commands through files, as the Decide and Report
 * steps do. workflow-simulation.test.mjs then executes the same thing inside the
 * workflow.
 *
 * Labels: CONTRACT — a rule this change introduces; CONTROL — something that must
 * NOT change or must stay refused.
 */

import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { digestOfValue } from '../lib/canonical.mjs';
import { validatePolicy } from '../lib/policy.mjs';
import {
  AWAITING, NOT_WAITING, READINESS_SCHEMA, WAITING_CODES, WAITING_CONDITIONS,
  classifyReadiness, readEnablement, readinessCovers,
} from '../lib/readiness.mjs';
import { POLICY, clone } from './fixtures.mjs';
import { cli, tempDir } from './harness.mjs';

const TARGET = 'a'.repeat(40);
const IDENTITY_URL = `${POLICY.hosting.identityOrigin}${POLICY.hosting.identityPath}`;

// The committed policy's six, read FROM the committed policy — never retyped here, so
// this suite cannot agree with a stale copy of itself.
const COMMITTED_AWAITING = POLICY.publication.readiness.awaiting;

const DETAILS = {
  'peers.backend_serving_unverified': 'the backend publishes no served-revision identity (B3)',
  'prerequisite.legacy_publisher_active': '.github/workflows/deploy-prod.yml still publishes independently',
  'prerequisite.legacy_publisher_present': '.github/workflows/deploy-prod.yml exists on the default branch',
  'prerequisite.retention_unverified': 'what Firebase Hosting retains for this site has not been established',
  'prerequisite.source_protection_unrecorded': 'branch protection has not been recorded',
  'served.bootstrap_unauthorized': 'no served identity, and bootstrap is not authorized',
};

/** A decision exactly as decide.mjs shapes it — the same five keys, in its order. */
function refusal(codes = COMMITTED_AWAITING, { mode = 'deploy', trigger = 'automatic' } = {}) {
  return {
    decision: 'REFUSE',
    allow: false,
    mode,
    trigger,
    reasons: codes.map((code) => ({ code, detail: DETAILS[code] ?? `${code} detail` })),
  };
}

/** The evidence the gate gathered for the COMMITTED state: the SPA rewrite answering
 *  the identity path, the legacy workflow present, no backend serving observation. */
function evidence(over = {}) {
  return {
    policy: POLICY,
    request: { mode: 'deploy', trigger: 'automatic', target: TARGET },
    enablement: '',
    decision: refusal(),
    facts: { trusted: { legacyPublisherPresent: true } },
    served: { state: 'absent', url: IDENTITY_URL, status: 200, cacheControl: null, cacheControlNoStore: false },
    peers: { receipts: {}, verification: {}, serving: { admin: { state: 'known', commit: 'b'.repeat(40), noStore: true } } },
    ...over,
  };
}

const problemCodes = (r) => r.problems.map((p) => p.code).sort();

describe('readiness — the classifier over the committed policy', () => {
  test('CONTRACT: the committed policy lists exactly the six still-pending conditions, and validates', () => {
    assert.deepEqual([...COMMITTED_AWAITING].sort(), [
      'peers.backend_serving_unverified',
      'prerequisite.legacy_publisher_active',
      'prerequisite.legacy_publisher_present',
      'prerequisite.retention_unverified',
      'prerequisite.source_protection_unrecorded',
      'served.bootstrap_unauthorized',
    ]);
    // peers.capabilities_unpublished was resolved by approving 366b7e4. It is NOT a
    // wait: not in the policy's list and not in the registry.
    assert.equal(COMMITTED_AWAITING.includes('peers.capabilities_unpublished'), false);
    assert.equal(Object.hasOwn(WAITING_CONDITIONS, 'peers.capabilities_unpublished'), false);
    assert.equal(validatePolicy(POLICY).ok, true);
    for (const code of COMMITTED_AWAITING) assert.equal(WAITING_CONDITIONS[code].pending(POLICY), true, code);
  });

  test('CONTRACT: exactly the six, automatic, publication unset → awaiting; the decision is untouched', () => {
    const input = evidence();
    const before = JSON.stringify(input.decision);
    const r = classifyReadiness(input);
    assert.equal(r.kind, AWAITING, JSON.stringify(r.problems));
    assert.equal(r.schema, READINESS_SCHEMA);
    assert.equal(r.evaluationCompleted, true);
    // THE THREE FACTS, SEPARATELY.
    assert.equal(r.decision, 'REFUSE');
    assert.equal(r.allow, false);
    assert.equal(r.published, false);
    assert.equal(r.enablement, 'disabled-unset');
    assert.deepEqual(r.awaiting.map((a) => a.code).sort(), [...COMMITTED_AWAITING].sort());
    for (const a of r.awaiting) assert.equal(a.means, WAITING_CONDITIONS[a.code].means);
    assert.equal(r.decisionDigest, digestOfValue(input.decision));
    assert.equal(JSON.stringify(input.decision), before, 'the classifier altered the decision');
    assert.deepEqual(r.problems, []);
    // Nothing in the record reads as an admission or a publication.
    for (const key of ['admitted', 'record', 'outcome', 'proceed']) assert.equal(Object.hasOwn(r, key), false, key);
  });

  test('CONTROL: an explicit `false` is as disabled as an unset variable', () => {
    assert.equal(classifyReadiness(evidence({ enablement: 'false' })).kind, AWAITING);
  });

  test('CONTROL: the identity answering 404 (not the SPA) is also the bootstrap context', () => {
    const r = classifyReadiness(evidence({ served: { state: 'absent', url: IDENTITY_URL, status: 404 } }));
    assert.equal(r.kind, AWAITING);
  });

  test('CONTROL: a served identity that is KNOWN legitimately drops the bootstrap reason — five, still a wait', () => {
    const codes = COMMITTED_AWAITING.filter((c) => c !== 'served.bootstrap_unauthorized');
    const r = classifyReadiness(evidence({
      decision: refusal(codes),
      served: { state: 'known', url: IDENTITY_URL, status: 200, cacheControlNoStore: true },
    }));
    assert.equal(r.kind, AWAITING, JSON.stringify(r.problems));
    assert.equal(r.awaiting.length, 5);
  });

  describe('publication enablement is read strictly', () => {
    const cases = [
      ['true', 'enabled', 'readiness.publication_enabled'],
      ['TRUE', 'invalid', 'readiness.enablement_invalid'],
      ['True', 'invalid', 'readiness.enablement_invalid'],
      ['1', 'invalid', 'readiness.enablement_invalid'],
      ['yes', 'invalid', 'readiness.enablement_invalid'],
      [' false', 'invalid', 'readiness.enablement_invalid'],
      ['false ', 'invalid', 'readiness.enablement_invalid'],
      ['no', 'invalid', 'readiness.enablement_invalid'],
      [true, 'invalid', 'readiness.enablement_invalid'],
      [undefined, 'unread', 'readiness.enablement_unread'],
      [null, 'unread', 'readiness.enablement_unread'],
    ];
    for (const [value, state, code] of cases) {
      test(`CONTROL: ${JSON.stringify(value)} is ${state} and never a wait`, () => {
        assert.equal(readEnablement(value), state);
        const r = classifyReadiness(evidence({ enablement: value }));
        assert.equal(r.kind, NOT_WAITING);
        assert.deepEqual(problemCodes(r), [code]);
        assert.equal(r.evaluationCompleted, true, 'the evaluation still completed; it is the REPORT that must stay red');
        assert.deepEqual(r.awaiting, []);
      });
    }
  });

  test('CONTROL: a manual deploy, a manual rollback and a (refused) automatic rollback are deliberate attempts', () => {
    for (const [mode, trigger] of [['deploy', 'manual'], ['rollback', 'manual'], ['rollback', 'automatic']]) {
      const r = classifyReadiness(evidence({
        request: { mode, trigger, target: TARGET },
        decision: refusal(COMMITTED_AWAITING, { mode, trigger }),
      }));
      assert.equal(r.kind, NOT_WAITING, `${trigger} ${mode}`);
      assert.ok(problemCodes(r).includes('readiness.deliberate_attempt'), `${trigger} ${mode}: ${problemCodes(r)}`);
    }
  });

  test('CONTROL: a decision about a different request is not classified — mode is never inferred', () => {
    const r = classifyReadiness(evidence({ decision: refusal(COMMITTED_AWAITING, { mode: 'rollback', trigger: 'manual' }) }));
    assert.deepEqual(problemCodes(r), ['readiness.request_mismatch']);
    assert.equal(r.evaluationCompleted, false);
    const missing = classifyReadiness(evidence({ request: null }));
    assert.deepEqual(problemCodes(missing), ['readiness.request_mismatch']);
  });

  describe('a decision that was not fully produced is never a wait', () => {
    const d = refusal();
    const cases = [
      ['nothing at all', undefined],
      ['null', null],
      ['a string', 'REFUSE'],
      ['an array', [d]],
      ['a missing key', (() => { const { trigger, ...rest } = d; return rest; })()],
      ['an extra key', { ...d, admitted: false }],
      ['allow as a string', { ...d, allow: 'false' }],
      ['reasons not a list', { ...d, reasons: 'prerequisite.retention_unverified' }],
      ['a reason with no code', { ...d, reasons: [...d.reasons, { detail: 'x' }] }],
      ['a reason with an empty code', { ...d, reasons: [...d.reasons, { code: '' }] }],
      ['a null reason', { ...d, reasons: [...d.reasons, null] }],
    ];
    for (const [name, decision] of cases) {
      test(`CONTROL: ${name} → decision_unreadable`, () => {
        const r = classifyReadiness(evidence({ decision }));
        assert.deepEqual(problemCodes(r), ['readiness.decision_unreadable']);
        assert.equal(r.evaluationCompleted, false);
        assert.equal(r.decisionDigest, null);
      });
    }
  });

  test('CONTROL: only a refusal can be a wait — PROCEED, a skip, a refusal with allow:true or no reasons are not', () => {
    const cases = [
      { ...refusal(), decision: 'PROCEED', allow: true, reasons: [] },
      { ...refusal(), decision: 'SKIP_IDENTICAL', allow: false, reasons: [] },
      { ...refusal(), decision: 'SKIP_STALE', allow: false, reasons: [] },
      { ...refusal(), allow: true },
      { ...refusal(), reasons: [] },
    ];
    for (const decision of cases) {
      assert.deepEqual(problemCodes(classifyReadiness(evidence({ decision }))), ['readiness.not_a_refusal'], JSON.stringify(decision));
    }
  });

  test('CONTROL: ANY reason outside the recorded wait — an integrity failure beside the six — stays red', () => {
    for (const extra of ['artifact.digest_mismatch', 'certification.failed', 'served.unreadable', 'peers.capabilities_unpublished',
      'peers.receipt_mismatch', 'storage.incompatible', 'eligibility.revoked', 'hosting.identity_cacheable']) {
      const r = classifyReadiness(evidence({ decision: refusal([...COMMITTED_AWAITING, extra]) }));
      assert.equal(r.kind, NOT_WAITING, extra);
      assert.deepEqual(problemCodes(r), ['readiness.unexpected_reason'], extra);
      assert.match(r.problems[0].detail, new RegExp(extra.replace(/\./g, '\\.')));
      assert.deepEqual(r.awaiting, [], 'a partial list of waits is never reported beside a failure');
    }
  });

  test('CONTRACT (D08 B2.2): NO dependency reason is ever a wait — every code the dependency half can emit, beside the six, stays red', () => {
    // Enumerated FROM THE SOURCE, so a code added later is covered without editing this
    // test: the certification evidence, the fresh assessment and the toolchain are
    // integrity facts about THIS candidate, never an owner prerequisite still pending.
    const source = readFileSync(join(import.meta.dirname, '../lib/dependency-evidence.mjs'), 'utf8');
    const codes = [...new Set([...source.matchAll(/'(dependency\.[a-z_]+)'/g)].map((m) => m[1]))].sort();
    assert.ok(codes.length >= 25, `the enumeration found ${codes.length} codes`);
    for (const code of ['dependency.assessment_blocking', 'dependency.assessment_incomplete', 'dependency.assessment_missing',
      'dependency.evidence_unsupported', 'dependency.tooling_unreviewed']) assert.ok(codes.includes(code), code);
    for (const code of codes) {
      assert.equal(WAITING_CODES.includes(code), false, `${code} is registered as a waiting condition`);
      const r = classifyReadiness(evidence({ decision: refusal([...COMMITTED_AWAITING, code]) }));
      assert.equal(r.kind, NOT_WAITING, code);
      assert.deepEqual(problemCodes(r), ['readiness.unexpected_reason'], code);
      // And no policy may list one: the list is validated against the closed registry.
      const policy = clone(POLICY);
      policy.publication.readiness.awaiting = [...COMMITTED_AWAITING, code];
      assert.equal(validatePolicy(policy).ok, false, `a policy listing ${code} validates`);
    }
    for (const wildcard of ['dependency.*', 'dependency.assessment_*']) {
      const policy = clone(POLICY);
      policy.publication.readiness.awaiting = [...COMMITTED_AWAITING, wildcard];
      assert.equal(validatePolicy(policy).ok, false, wildcard);
    }
  });

  test('CONTRACT: capabilities_unpublished is not a wait after the receipt approval, even if a policy listed it', () => {
    const policy = clone(POLICY);
    policy.publication.readiness.awaiting = [...COMMITTED_AWAITING, 'peers.capabilities_unpublished'];
    assert.equal(validatePolicy(policy).ok, false, 'the policy validator refuses it');
    const r = classifyReadiness(evidence({ policy, decision: refusal([...COMMITTED_AWAITING, 'peers.capabilities_unpublished']) }));
    assert.equal(r.kind, NOT_WAITING);
    assert.deepEqual(problemCodes(r), ['readiness.unexpected_reason', 'readiness.unknown_expectation']);
  });

  test('CONTROL: no wildcard — `peers.*` / `prerequisite.*` accept nothing, and a policy carrying one does not validate', () => {
    for (const wildcard of ['peers.*', 'prerequisite.*', '*', 'served.*']) {
      const policy = clone(POLICY);
      policy.publication.readiness.awaiting = [wildcard];
      assert.equal(validatePolicy(policy).ok, false, wildcard);
      assert.ok(validatePolicy(policy).problems.some((p) => p.code === 'policy.bad_readiness'), wildcard);
      const r = classifyReadiness(evidence({ policy }));
      assert.equal(r.kind, NOT_WAITING, wildcard);
      assert.ok(problemCodes(r).includes('readiness.unexpected_reason'), wildcard);
    }
  });

  test('CONTROL: the list is never learned from the result — a refusal whose codes are all unknown is not excused', () => {
    const codes = ['peers.backend_down', 'prerequisite.something_new'];
    const policy = clone(POLICY);
    policy.publication.readiness.awaiting = codes; // as though the list were copied from the run
    const r = classifyReadiness(evidence({ policy, decision: refusal(codes) }));
    assert.equal(r.kind, NOT_WAITING);
    assert.deepEqual(problemCodes(r), ['readiness.unexpected_reason', 'readiness.unexpected_reason',
      'readiness.unknown_expectation', 'readiness.unknown_expectation']);
  });

  test('CONTROL: a policy with no reviewed expectation classifies nothing as a wait', () => {
    const policy = clone(POLICY);
    delete policy.publication.readiness;
    const r = classifyReadiness(evidence({ policy }));
    assert.deepEqual(problemCodes(r), ['readiness.no_reviewed_expectation']);
    assert.equal(validatePolicy(policy).ok, false);
  });

  describe('each code counts only in its own context', () => {
    const mismatch = (over, code) => {
      const r = classifyReadiness(evidence(over));
      assert.equal(r.kind, NOT_WAITING);
      assert.ok(r.problems.some((p) => p.code === 'readiness.context_mismatch' && p.detail.startsWith(code)),
        JSON.stringify(r.problems));
    };
    test('CONTROL: bootstrap refused while the identity answered at ANOTHER origin', () => {
      mismatch({ served: { state: 'absent', url: 'https://elsewhere.example/release.json', status: 200 } }, 'served.bootstrap_unauthorized');
    });
    test('CONTROL: bootstrap refused beside an unexpected status', () => {
      mismatch({ served: { state: 'absent', url: IDENTITY_URL, status: 503 } }, 'served.bootstrap_unauthorized');
    });
    test('CONTROL: bootstrap refused while the served state was unreadable (a network or parser failure)', () => {
      mismatch({ served: { state: 'unreadable', url: IDENTITY_URL, detail: 'ECONNRESET' } }, 'served.bootstrap_unauthorized');
    });
    test('CONTROL: bootstrap refused while the policy says bootstrap is AUTHORIZED — a contradiction, and a stale list', () => {
      const policy = clone(POLICY);
      policy.bootstrap.authorized = true;
      const r = classifyReadiness(evidence({ policy }));
      assert.equal(r.kind, NOT_WAITING);
      assert.deepEqual(problemCodes(r), ['readiness.context_mismatch', 'readiness.expectation_stale']);
    });
    test('CONTROL: a legacy reason whose file the trusted checkout did not show present', () => {
      mismatch({ facts: { trusted: { legacyPublisherPresent: false } } }, 'prerequisite.legacy_publisher_active');
      mismatch({ facts: { trusted: {} } }, 'prerequisite.legacy_publisher_present');
      mismatch({ facts: {} }, 'prerequisite.legacy_publisher_present');
    });
    test('CONTROL: backend serving refused although an observation WAS made — that is a different failure', () => {
      mismatch({ peers: { serving: { backend: { state: 'unreadable', detail: 'timeout' } } } }, 'peers.backend_serving_unverified');
    });
  });

  test('CONTROL: a listed condition that stands but was NOT refused — a required check that disappeared — is a defect', () => {
    const codes = COMMITTED_AWAITING.filter((c) => c !== 'prerequisite.retention_unverified');
    const r = classifyReadiness(evidence({ decision: refusal(codes) }));
    assert.equal(r.kind, NOT_WAITING);
    assert.deepEqual(problemCodes(r), ['readiness.expected_reason_missing']);
    assert.match(r.problems[0].detail, /prerequisite\.retention_unverified/);
  });

  test('CONTRACT: a prerequisite resolved in the policy must leave the list in the same change — else it is stale', () => {
    const policy = clone(POLICY);
    policy.prerequisites.retention.status = 'verified';
    const codes = COMMITTED_AWAITING.filter((c) => c !== 'prerequisite.retention_unverified');
    const stale = classifyReadiness(evidence({ policy, decision: refusal(codes) }));
    assert.deepEqual(problemCodes(stale), ['readiness.expectation_stale']);
    // ...and the same change, having removed the entry, is a wait again.
    policy.publication.readiness.awaiting = codes;
    assert.equal(validatePolicy(policy).ok, true);
    assert.equal(classifyReadiness(evidence({ policy, decision: refusal(codes) })).kind, AWAITING);
  });

  test('CONTRACT: when every prerequisite clears, the list is empty and nothing is a wait — a refusal is a failure again', () => {
    const policy = clone(POLICY);
    policy.publication.readiness.awaiting = [];
    assert.equal(validatePolicy(policy).ok, true);
    for (const codes of [COMMITTED_AWAITING, ['served.bootstrap_unauthorized']]) {
      const r = classifyReadiness(evidence({ policy, decision: refusal(codes) }));
      assert.equal(r.kind, NOT_WAITING);
      assert.ok(problemCodes(r).every((c) => c === 'readiness.unexpected_reason'));
    }
  });

  test('CONTROL: the registry and the committed list are the same set — no listed code without a context', () => {
    assert.deepEqual([...WAITING_CODES].sort(), [...COMMITTED_AWAITING].sort());
  });
});

describe('readinessCovers — the report counts a wait only for EXACTLY the decision it classified', () => {
  const input = evidence();
  const record = classifyReadiness(input);

  test('CONTRACT: the classification of this decision covers this decision', () => {
    assert.equal(readinessCovers(record, input.decision), true);
  });

  test('CONTROL: an edited decision, a flipped allow or a dropped reason is not covered', () => {
    assert.equal(readinessCovers(record, { ...input.decision, allow: true }), false);
    assert.equal(readinessCovers(record, { ...input.decision, reasons: input.decision.reasons.slice(1) }), false);
    assert.equal(readinessCovers(record, refusal([...COMMITTED_AWAITING, 'artifact.digest_mismatch'])), false);
    assert.equal(readinessCovers(record, { ...input.decision, decision: 'PROCEED' }), false);
    assert.equal(readinessCovers(record, null), false);
  });

  test('CONTROL: a record that is not the waiting kind, or claims a publication, covers nothing', () => {
    const d = input.decision;
    assert.equal(readinessCovers(null, d), false);
    assert.equal(readinessCovers({ ...record, kind: NOT_WAITING }, d), false);
    assert.equal(readinessCovers({ ...record, schema: 'other/1' }, d), false);
    assert.equal(readinessCovers({ ...record, published: true }, d), false);
    assert.equal(readinessCovers({ ...record, evaluationCompleted: false }, d), false);
    assert.equal(readinessCovers({ ...record, decisionDigest: digestOfValue(refusal(['served.bootstrap_unauthorized'])) }, d), false);
    const unclassified = classifyReadiness(evidence({ enablement: 'true' }));
    assert.equal(readinessCovers(unclassified, d), false);
  });
});

// ── the real commands, through files, as the workflow steps call them ─────────────

function writeEvidence(dir, over = {}) {
  const e = evidence(over);
  const files = { decision: e.decision, request: e.request, facts: e.facts, served: e.served, peers: e.peers };
  for (const [name, value] of Object.entries(files)) {
    if (value === undefined) continue;
    writeFileSync(join(dir, `${name}.json`), typeof value === 'string' ? value : JSON.stringify(value));
  }
  return e;
}

async function readiness(dir, { enablement = '', omitEnablement = false, extra = [] } = {}) {
  const args = ['readiness'];
  for (const name of ['decision', 'request', 'facts', 'served', 'peers']) args.push(`--${name}`, join(dir, `${name}.json`));
  if (!omitEnablement) args.push('--enablement', enablement);
  args.push('--out', join(dir, 'readiness.json'), '--outputs', join(dir, 'outputs'), '--summary', join(dir, 'summary.md'), ...extra);
  const r = await cli(args);
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null);
  return { ...r, record: JSON.parse(read('readiness.json') ?? 'null'), outputs: read('outputs') ?? '', summary: read('summary.md') ?? '' };
}

async function outcome(dir, extra = []) {
  const r = await cli(['outcome', '--decision', join(dir, 'decision.json'), '--decision-word', 'REFUSE',
    '--readiness', join(dir, 'readiness.json'), '--summary', join(dir, 'outcome.md'), ...extra]);
  return { ...r, word: JSON.parse(r.stdout).outcome, summary: readFileSync(join(dir, 'outcome.md'), 'utf8') };
}

describe('the readiness and outcome commands, through files', () => {
  test('CONTRACT: the recorded wait exits 0, writes the record, and says what did NOT happen', async () => {
    const dir = tempDir('readiness-cli');
    writeEvidence(dir);
    const r = await readiness(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '', 'stdout belongs to the decision in the Decide step; the classification goes to stderr');
    assert.equal(JSON.parse(r.stderr).kind, AWAITING);
    assert.equal(r.record.kind, AWAITING);
    assert.equal(r.outputs.trim(), `readiness=${AWAITING}`);
    assert.doesNotMatch(r.outputs, /decision=|allow=|record=/, 'readiness writes no output the publish job reads');
    // The suggested wording, fact by fact.
    assert.match(r.summary, /### Readiness evaluation completed/);
    assert.match(r.summary, /New-path publication: NOT PERMITTED\*\* — pending recorded prerequisites/);
    assert.match(r.summary, /Release decision:\*\* `REFUSE`; allow: `false`/);
    assert.match(r.summary, /Published by this run:\*\* no/);
    assert.match(r.summary, /Legacy deployment:\*\* remains separately configured/);
    assert.match(r.summary, /neither observes nor vouches for it/, 'no claim that the legacy deployment is healthy');
    assert.doesNotMatch(r.summary, /healthy|succeeded|deployed successfully|WOULD_PUBLISH|PROCEED|PUBLISHED/);
    for (const code of COMMITTED_AWAITING) assert.match(r.summary, new RegExp(`\`${code.replace(/\./g, '\\.')}\``));

    const o = await outcome(dir);
    assert.equal(o.status, 0, o.stderr);
    assert.equal(o.word, 'PENDING_PREREQUISITES');
    assert.match(o.summary, /### Publication outcome: PENDING_PREREQUISITES/);
    assert.match(o.summary, /\| decision \| REFUSE \|/);
    assert.match(o.summary, /awaiting 6 recorded prerequisite\(s\) — evaluation completed, nothing admitted/);
    assert.match(o.summary, /\| enabled \| not read by this step \|/, 'the gate report claims nothing about a variable it never read');
  });

  test('CONTROL: an enabled release, an invalid value and a missing flag all exit 1, and the outcome stays REFUSED', async () => {
    for (const [opts, code] of [
      [{ enablement: 'true' }, 'readiness.publication_enabled'],
      [{ enablement: 'yes' }, 'readiness.enablement_invalid'],
      [{ omitEnablement: true }, 'readiness.enablement_unread'],
    ]) {
      const dir = tempDir('readiness-cli');
      writeEvidence(dir);
      const r = await readiness(dir, opts);
      assert.equal(r.status, 1, JSON.stringify(opts));
      assert.deepEqual(r.record.problems.map((p) => p.code), [code]);
      assert.match(r.summary, /NOT the recorded waiting state/);
      const o = await outcome(dir);
      assert.equal(o.status, 1);
      assert.equal(o.word, 'REFUSED');
      assert.match(o.summary, new RegExp(`not the recorded waiting state \\(${code.replace(/\./g, '\\.')}\\)`));
    }
  });

  test('CONTROL: evidence that cannot be read back is never a wait — an empty decision file (decide died after the redirect)', async () => {
    const dir = tempDir('readiness-cli');
    writeEvidence(dir);
    writeFileSync(join(dir, 'decision.json'), '');
    const r = await readiness(dir);
    assert.equal(r.status, 1);
    assert.deepEqual(r.record.problems.map((p) => p.code), ['readiness.evidence_unreadable']);
    assert.match(r.record.problems[0].detail, /decision/);
  });

  test('CONTROL: a missing evidence file (a step that never wrote it) is never a wait', async () => {
    for (const missing of ['request', 'facts', 'served', 'peers']) {
      const dir = tempDir('readiness-cli');
      writeEvidence(dir, { [missing]: undefined });
      const r = await readiness(dir);
      assert.equal(r.status, 1, missing);
      assert.deepEqual(r.record.problems.map((p) => p.code), ['readiness.evidence_unreadable'], missing);
    }
  });

  test('CONTROL: an integrity failure beside the six exits 1 and names itself', async () => {
    const dir = tempDir('readiness-cli');
    writeEvidence(dir, { decision: refusal([...COMMITTED_AWAITING, 'artifact.digest_mismatch']) });
    const r = await readiness(dir);
    assert.equal(r.status, 1);
    assert.match(r.summary, /readiness\.unexpected_reason` \| artifact\.digest_mismatch/);
    assert.equal((await outcome(dir)).word, 'REFUSED');
  });

  test('CONTROL: a classification about ANOTHER decision does not turn this report green', async () => {
    const dir = tempDir('readiness-cli');
    writeEvidence(dir);
    assert.equal((await readiness(dir)).status, 0);
    // The decision file now says something else; the stale classification must not cover it.
    writeFileSync(join(dir, 'decision.json'), JSON.stringify(refusal([...COMMITTED_AWAITING, 'certification.failed'])));
    const o = await outcome(dir);
    assert.equal(o.status, 1);
    assert.equal(o.word, 'REFUSED');
  });

  test('CONTROL: with no classification at all the report is unchanged — REFUSED, and no readiness row', async () => {
    const dir = tempDir('readiness-cli');
    writeEvidence(dir);
    const o = await outcome(dir);
    assert.equal(o.status, 1);
    assert.equal(o.word, 'REFUSED');
    assert.doesNotMatch(o.summary, /\| readiness \|/);
  });
});
