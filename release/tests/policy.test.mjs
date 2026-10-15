/**
 * THE POLICY AS DATA — every field is decision-bearing, so every field is validated
 * before a single rule is evaluated.
 *
 * On 3386724 a peer's commit was a literal nothing read: deleting it, or replacing it
 * with "not-a-sha", PROCEEDED (R1.a/R1.b, reproduced — see release/README.md). A policy
 * that cannot be read as intended is now ONE refusal, `policy.invalid`, naming every
 * problem; the problem codes asserted here are what that refusal carries.
 */

import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { isCalendarDate, validatePolicy, POLICY_SCHEMA } from '../lib/policy.mjs';
import { decide } from '../lib/decide.mjs';
import { POLICY, allowedPolicy, baseline, clone, codes } from './fixtures.mjs';

const problemCodes = (r) => r.problems.map((p) => p.code);

function rejected(mutate, code) {
  const policy = clone(POLICY);
  mutate(policy);
  const r = validatePolicy(policy);
  assert.equal(r.ok, false, `expected ${code}, the policy validated`);
  assert.ok(problemCodes(r).includes(code), `expected ${code}, got ${JSON.stringify(problemCodes(r))}`);
  return r;
}

describe('controls', () => {
  test('CONTROL: the committed policy validates', () => {
    const r = validatePolicy(POLICY);
    assert.equal(r.ok, true, JSON.stringify(r.problems));
    assert.equal(POLICY.schema, POLICY_SCHEMA);
  });

  test('CONTROL: the suite\'s allowed policy validates', () => {
    const r = validatePolicy(allowedPolicy());
    assert.equal(r.ok, true, JSON.stringify(r.problems));
  });

  test('CONTROL: a non-object is one problem, not an exception', () => {
    for (const value of [null, undefined, 'x', 7, []]) {
      assert.deepEqual(problemCodes(validatePolicy(value)), ['policy.not_an_object']);
    }
  });
});

describe('peers — a pin that cannot be read is not a pin (R1)', () => {
  test('REGRESSION (R1.a): an approved backend entry with no commit', () => {
    rejected((p) => { delete p.compatibleSet.peers.backend.approved[0].commit; }, 'policy.backend_commit_invalid');
  });
  test('REGRESSION (R1.b): an approved admin commit that is not a SHA', () => {
    rejected((p) => { p.compatibleSet.peers.admin.approved[0].commit = 'not-a-sha'; }, 'policy.admin_commit_invalid');
  });
  test('REGRESSION (R1.c): a backend commit that is a nonsense string, or an abbreviated SHA, is not a pin', () => {
    rejected((p) => { p.compatibleSet.peers.backend.approved[0].commit = 'not-a-commit'; }, 'policy.backend_commit_invalid');
    rejected((p) => { p.compatibleSet.peers.backend.approved[0].commit = '9448f55'; }, 'policy.backend_commit_invalid');
  });
  test('CONTRACT: an uppercase SHA is not the form git prints and is refused', () => {
    rejected((p) => { p.compatibleSet.peers.backend.approved[0].commit = p.compatibleSet.peers.backend.approved[0].commit.toUpperCase(); }, 'policy.backend_commit_invalid');
  });
  test('CONTRACT: a peer with no approved revision is unpinned', () => {
    rejected((p) => { p.compatibleSet.peers.backend.approved = []; }, 'policy.backend_unpinned');
  });
  test('CONTRACT: a missing peer is unpinned', () => {
    rejected((p) => { delete p.compatibleSet.peers.admin; }, 'policy.admin_unpinned');
  });
  test('CONTRACT: the same revision approved twice is refused', () => {
    rejected((p) => { p.compatibleSet.peers.backend.approved.push(clone(p.compatibleSet.peers.backend.approved[0])); }, 'policy.backend_commit_duplicate');
  });
  test('CONTRACT: a receipt path that does not name its revision is refused', () => {
    rejected((p) => { p.compatibleSet.peers.backend.approved[0].receipt = 'release/peers/backend-latest.json'; }, 'policy.backend_bad_receipt_path');
  });
  test('CONTRACT: a receipt path outside release/peers/ is refused', () => {
    rejected((p) => {
      const a = p.compatibleSet.peers.admin.approved[0];
      a.receipt = `../elsewhere/admin-${a.commit}.json`;
    }, 'policy.admin_bad_receipt_path');
  });
  test('CONTRACT: an approval must pin a receipt digest', () => {
    rejected((p) => { delete p.compatibleSet.peers.backend.approved[0].receiptDigest; }, 'policy.backend_bad_receipt_digest');
  });
  test('CONTRACT: a malformed repository name is refused', () => {
    rejected((p) => { p.compatibleSet.peers.backend.repository = 'Dinify-Backend'; }, 'policy.backend_bad_repository');
  });
  test('CONTRACT: receipt verification is a closed vocabulary', () => {
    rejected((p) => { p.compatibleSet.peers.backend.receiptVerification = 'trust-me'; }, 'policy.backend_bad_receipt_verification');
  });
  test('CONTRACT: serving is either observed or refused by name — nothing else', () => {
    rejected((p) => { p.compatibleSet.peers.backend.serving = { observation: 'operator-attested' }; }, 'policy.backend_serving_unknown_observation');
  });
  test('CONTRACT: an unavailable serving observation must say why', () => {
    rejected((p) => { delete p.compatibleSet.peers.backend.serving.reason; }, 'policy.backend_serving_no_reason');
  });
  test('CONTRACT: a public identity must be an https origin', () => {
    rejected((p) => { p.compatibleSet.peers.admin.serving.origin = 'http://admin.dinifyapp.com'; }, 'policy.admin_serving_bad_origin');
  });
  test('CONTRACT: a public identity origin carries no path', () => {
    rejected((p) => { p.compatibleSet.peers.admin.serving.origin = 'https://admin.dinifyapp.com/api'; }, 'policy.admin_serving_bad_origin');
  });
  test('CONTRACT: Admin\'s assumptions are stated, not implied', () => {
    rejected((p) => { p.compatibleSet.peers.admin.assumptions = []; }, 'policy.admin_no_assumptions');
  });
});

describe('the rest of the policy', () => {
  const cases = [
    ['a /1 policy is not read as /2', 'policy.wrong_schema', (p) => { p.schema = 'dinify.release.policy/1'; }],
    ['a certification event other than push', 'policy.bad_certification_event', (p) => { p.certification.event = 'pull_request'; }],
    ['no required checks', 'policy.no_required_checks', (p) => { p.certification.requiredChecks = []; }],
    ['a zero certification window', 'policy.bad_freshness', (p) => { p.freshness.certificationWindowHours = 0; }],
    ['a build configuration that is not a plain name', 'policy.bad_build_configuration', (p) => { p.build.configuration = 'uat;rm'; }],
    ['a production flag that is not a boolean', 'policy.bad_production_flag', (p) => { p.build.expectedProductionFlag = 'false'; }],
    ['a hosting channel other than live', 'policy.bad_hosting_channel', (p) => { p.hosting.channelId = 'preview'; }],
    ['an identity origin with a trailing slash', 'policy.bad_identity_origin', (p) => { p.hosting.identityOrigin = 'https://dinify-prod.web.app/'; }],
    ['an unpinned tool version', 'policy.bad_tools_version', (p) => { p.hosting.firebaseToolsVersion = 'latest'; }],
    ['an ignore pattern outside the supported dialect', 'policy.bad_hosting_ignore', (p) => { p.hosting.ignore = ['**/*.{js,css}']; }],
    ['no verification schedule', 'policy.bad_verification_schedule', (p) => { delete p.hosting.verification; }],
    ['a verification that never reads', 'policy.bad_verification_schedule', (p) => { p.hosting.verification.attempts = 0; }],
    ['an unbounded verification wait', 'policy.bad_verification_schedule', (p) => { p.hosting.verification.intervalMs = 600000; }],
    ['a storage declaration path that climbs', 'policy.bad_storage_declaration_path', (p) => { p.storage.declarationPath = '../x.json'; }],
    ['bootstrap authorization that is not a boolean', 'policy.bad_bootstrap', (p) => { p.bootstrap.authorized = 'yes'; }],
    ['a bootstrap baseline that is not a SHA', 'policy.bad_bootstrap_baseline', (p) => { p.bootstrap.servedBaseline = { commit: 'main' }; }],
    ['a minimum safe target that is not a SHA', 'policy.bad_minimum_safe_target', (p) => { p.eligibility.minimumSafeTarget = 'HEAD~3'; }],
    ['a revocation without a reason', 'policy.bad_revocations', (p) => { p.eligibility.revoked = [{ commit: 'a'.repeat(40) }]; }],
    ['source protection outside its vocabulary', 'policy.bad_source_protection', (p) => { p.prerequisites.sourceProtection.status = 'probably'; }],
    ['retention outside its vocabulary', 'policy.bad_retention', (p) => { p.prerequisites.retention.status = 'assumed'; }],
    ['single publisher outside its vocabulary', 'policy.bad_single_publisher', (p) => { p.prerequisites.singlePublisher.status = 'both'; }],
    ['an enablement variable that is not a variable name', 'policy.bad_enablement_variable', (p) => { p.publication.enablementVariable = 'enabled'; }],
    // D08 B2.2 — the publisher toolchain is pinned as a reviewed graph, never a tag or range.
    ['no publisher block', 'policy.no_publisher', (p) => { delete p.publisher; }],
    ['a publisher version that is `latest`', 'policy.bad_tools_version', (p) => { p.publisher.version = 'latest'; }],
    ['a publisher version that is a range', 'policy.bad_tools_version', (p) => { p.publisher.version = '^15.31.0'; }],
    ['a publisher Node that is a major only', 'policy.bad_publisher_node', (p) => { p.publisher.node = '24'; }],
    ['a publisher root other than the reviewed lock', 'policy.bad_publisher_root', (p) => { p.publisher.root = 'node_modules'; }],
    ['an entrypoint outside the pinned package', 'policy.bad_publisher_entrypoint', (p) => { p.publisher.entrypoint = 'node_modules/other/lib/bin/firebase.js'; }],
    ['an entrypoint that climbs', 'policy.bad_publisher_entrypoint', (p) => { p.publisher.entrypoint = 'node_modules/firebase-tools/../../x.js'; }],
    ['a deploy agent with spaces', 'policy.bad_publisher_agent', (p) => { p.publisher.deployAgent = 'dinify release'; }],
    ['an assessment window beyond 24 hours', 'policy.bad_assessment_window', (p) => { p.freshness.assessmentWindowHours = 25; }],
    ['no assessment window', 'policy.bad_assessment_window', (p) => { delete p.freshness.assessmentWindowHours; }],
  ];
  for (const [name, code, mutate] of cases) test(`CONTRACT: ${name}`, () => rejected(mutate, code));
});

describe('the source-protection observation (SP-1) — evidence beside the status, validated without throwing', () => {
  const observation = (mutate) => (p) => mutate(p.prerequisites.sourceProtection.observation);
  // Validation must ANSWER for a bad date, never throw: a RangeError out of validatePolicy
  // would take decide() down instead of producing one named policy.invalid refusal.
  const refusedWithoutThrowing = (mutate, label) => {
    let r;
    assert.doesNotThrow(() => { r = rejected(observation(mutate), 'policy.bad_source_protection_observation'); }, label);
    return r;
  };

  test('CONTROL: the committed observation validates, is about the certified branch, and leaves the status unrecorded', () => {
    const r = validatePolicy(POLICY);
    assert.equal(r.ok, true, JSON.stringify(r.problems));
    const sp = POLICY.prerequisites.sourceProtection;
    assert.equal(sp.status, 'unrecorded', 'SP-1 records evidence; it does not move the status');
    assert.equal(sp.observation.branch, POLICY.certification.branch);
    assert.ok(sp.observation.limitations.length > 0);
  });

  test('CONTROL: a policy with no observation at all still validates — the field is optional', () => {
    const policy = clone(POLICY);
    delete policy.prerequisites.sourceProtection.observation;
    const r = validatePolicy(policy);
    assert.equal(r.ok, true, JSON.stringify(r.problems));
  });

  test('REGRESSION: month 13 and month 00 are refused by name — no RangeError escapes', () => {
    for (const bad of ['2026-13-01', '2026-00-01', '2026-99-15']) {
      // The flaw being pinned: formatting an Invalid Date throws.
      assert.throws(() => new Date(`${bad}T00:00:00Z`).toISOString(), RangeError, `premise: ${bad} is an Invalid Date`);
      assert.equal(isCalendarDate(bad), false, bad);
      refusedWithoutThrowing((o) => { o.observedOn = bad; }, bad);
    }
  });

  test('REGRESSION: a day the month does not have is refused, not rolled over — 29 February in a non-leap year, 30 February, 31 April, day 00', () => {
    for (const bad of ['2026-02-29', '2027-02-29', '2100-02-29', '2026-02-30', '2026-04-31', '2026-10-00', '2026-10-32']) {
      assert.equal(isCalendarDate(bad), false, bad);
      refusedWithoutThrowing((o) => { o.observedOn = bad; }, bad);
    }
  });

  test('CONTROL: a real leap day is accepted, and so is every ordinary boundary', () => {
    for (const good of ['2024-02-29', '2028-02-29', '2000-02-29', '2026-02-28', '2026-04-30', '2026-12-31', '2026-01-01', '2026-10-15']) {
      assert.equal(isCalendarDate(good), true, good);
      const policy = clone(POLICY);
      policy.prerequisites.sourceProtection.observation.observedOn = good;
      const r = validatePolicy(policy);
      assert.equal(r.ok, true, `${good}: ${JSON.stringify(r.problems)}`);
    }
  });

  test('CONTRACT: a date in any other form is refused — a timestamp, single digits, a number, absence', () => {
    for (const bad of ['2026-10-15T00:00:00Z', '2026-1-5', '15/10/2026', '20261015', ' 2026-10-15', 20261015, null, undefined]) {
      assert.equal(isCalendarDate(bad), false, String(bad));
      refusedWithoutThrowing((o) => { if (bad === undefined) delete o.observedOn; else o.observedOn = bad; }, String(bad));
    }
  });

  test('CONTRACT: the observation must be about the certified branch, say how it was made, carry the rules and state at least one limitation', () => {
    refusedWithoutThrowing((o) => { o.branch = 'develop'; }, 'another branch');
    refusedWithoutThrowing((o) => { delete o.branch; }, 'no branch');
    refusedWithoutThrowing((o) => { o.method = ''; }, 'no method');
    refusedWithoutThrowing((o) => { delete o.rules; }, 'no rules');
    refusedWithoutThrowing((o) => { o.limitations = []; }, 'no limitations');
    refusedWithoutThrowing((o) => { o.limitations = ['ok', 7]; }, 'a limitation that is not a statement');
  });

  test('CONTRACT: a response digest is a sha256: digest or absent — never an arbitrary string', () => {
    refusedWithoutThrowing((o) => { o.responseSha256 = { 'GET /x': 'abc' }; }, 'not a digest');
    refusedWithoutThrowing((o) => { o.responseSha256 = {}; }, 'an empty map claims nothing');
    refusedWithoutThrowing((o) => { o.responseSha256 = 'sha256:' + '0'.repeat(64); }, 'not a map');
    const policy = clone(POLICY);
    delete policy.prerequisites.sourceProtection.observation.responseSha256;
    assert.equal(validatePolicy(policy).ok, true, 'dropping the digests is allowed; inventing one is not');
  });

  test('CONTRACT: an observation that is not an object is one named problem', () => {
    for (const bad of [null, 'recorded', [], 7]) {
      assert.doesNotThrow(() => rejected((p) => { p.prerequisites.sourceProtection.observation = bad; }, 'policy.bad_source_protection_observation'), String(bad));
    }
  });

  test('CONTRACT: through decide(), a malformed observation is ONE policy.invalid refusal — not a crash', () => {
    const input = baseline();
    input.policy.prerequisites.sourceProtection.observation = clone(POLICY.prerequisites.sourceProtection.observation);
    input.policy.prerequisites.sourceProtection.observation.observedOn = '2026-13-01';
    let r;
    assert.doesNotThrow(() => { r = decide(input); });
    assert.equal(r.decision, 'REFUSE');
    assert.deepEqual(codes(r), ['policy.invalid']);
    assert.match(r.reasons[0].detail, /policy\.bad_source_protection_observation/);
  });
});

describe('what decide() does with an invalid policy', () => {
  test('CONTRACT: every problem is carried in ONE policy.invalid refusal', () => {
    const input = baseline();
    input.policy.compatibleSet.peers.backend.approved[0].commit = 'x';
    input.policy.hosting.firebaseToolsVersion = 'latest';
    const r = decide(input);
    assert.equal(r.decision, 'REFUSE');
    assert.deepEqual(codes(r), ['policy.invalid']);
    assert.match(r.reasons[0].detail, /policy\.backend_commit_invalid/);
    assert.match(r.reasons[0].detail, /policy\.bad_tools_version/);
  });
});
