/**
 * THE REFUSAL MATRIX — executed, not described.
 *
 * Every case calls `decide()` with data. Nothing here is a description of what a
 * workflow would do: the function under test is the one the publisher's gate runs.
 *
 * LABELS. `REGRESSION (Rx.y)` names a finding that was REPRODUCED on 3386724 before
 * anything changed — through the real `decide()`, the real CLI and a local origin; the
 * probe and its output are recorded in release/README.md ("Baseline"). The test itself
 * is written against the NEW contract: the decision's input changed shape precisely to
 * carry the evidence the finding showed missing, so the test pins the fix and the
 * recorded reproduction is the before-evidence. `CONTRACT` pins a rule this change
 * introduces. `CONTROL` pins an ALLOWED outcome — a gate that refused everything would
 * pass every refusal here, and the controls are what stop that being a passing result.
 */

import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { decide } from '../lib/decide.mjs';
import { validateAssessment, validateEvidenceRecord, validateTooling } from '../lib/dependency-evidence.mjs';
import { digestOfValue } from '../lib/canonical.mjs';
import { receiptDigest } from '../lib/peers.mjs';
import {
  baseline, codes, clone, manifestFor, servedKnown, storageProjection, withCandidateStorage, reattest,
  backendReceipt, allowedPolicy, peersFor, D01_CONTRACT, POLICY,
  TARGET_SHA, OLDER_SHA, BACKEND_SHA, ADMIN_SHA, TREE_DIGEST, STORAGE, reattestKeepingAssessment,
} from './fixtures.mjs';

function broken(mutate) {
  const input = baseline();
  mutate(input);
  return decide(input);
}

function assertRefused(result, code) {
  assert.equal(result.decision, 'REFUSE', `expected REFUSE, got ${result.decision} ${JSON.stringify(codes(result))}`);
  assert.equal(result.allow, false);
  assert.ok(codes(result).includes(code), `expected reason ${code}, got ${JSON.stringify(codes(result))}`);
}

function assertProceeds(result) {
  assert.equal(result.decision, 'PROCEED', JSON.stringify(codes(result)));
  assert.equal(result.allow, true);
}

const pair = (version, semantics = 1) => ({ version, semantics });

describe('positive controls — the gate is not simply refusing everything', () => {
  test('CONTROL: an ordinary automatic certification of merged main is allowed', () => {
    const result = decide(baseline());
    assertProceeds(result);
    assert.deepEqual(result.reasons, []);
  });

  test('CONTROL: an unchanged, approved, observed backend is allowed', () => {
    const input = baseline();
    assert.equal(input.policy.compatibleSet.peers.backend.approved[0].commit, BACKEND_SHA);
    assert.equal(input.peers.serving.backend.commit, BACKEND_SHA);
    assertProceeds(decide(input));
  });

  test('CONTROL: a manual redeploy of exactly the served candidate is allowed', () => {
    assertProceeds(broken((i) => {
      i.request.trigger = 'manual';
      i.served = servedKnown({ manifest: i.artifact.manifest, relation: 'identical' });
    }));
  });

  test('CONTROL: an explicit rollback that clears every precondition is allowed', () => {
    assertProceeds(broken((i) => {
      i.request = { mode: 'rollback', trigger: 'manual', target: TARGET_SHA };
      i.served = servedKnown({ commit: OLDER_SHA, relation: 'ancestor' });
    }));
  });

  test('CONTROL: an authorized bootstrap with a named, compatible baseline is allowed', () => {
    assertProceeds(broken((i) => {
      i.served = { state: 'absent' };
      i.policy.bootstrap = { authorized: true, servedBaseline: { commit: OLDER_SHA } };
      i.baseline = { state: 'known', commit: OLDER_SHA, storage: clone(STORAGE) };
    }));
  });
});

describe('the policy is validated before anything is judged', () => {
  test('REGRESSION (R1.a): a policy with the backend commit deleted is refused, not ignored', () => {
    const result = broken((i) => { delete i.policy.compatibleSet.peers.backend.approved[0].commit; });
    assertRefused(result, 'policy.invalid');
    assert.match(result.reasons[0].detail, /policy\.backend_commit_invalid/);
  });

  test('REGRESSION (R1.b): a malformed admin SHA is refused', () => {
    const result = broken((i) => { i.policy.compatibleSet.peers.admin.approved[0].commit = 'not-a-sha'; });
    assertRefused(result, 'policy.invalid');
    assert.match(result.reasons[0].detail, /policy\.admin_commit_invalid/);
  });

  test('CONTRACT: an invalid policy is ONE refusal naming every problem, and nothing else is judged', () => {
    const result = broken((i) => {
      i.policy.compatibleSet.peers.admin.approved[0].commit = 'x';
      i.policy.freshness.certificationWindowHours = -1;
      i.certification.conclusion = 'failure';
    });
    assert.deepEqual(codes(result), ['policy.invalid']);
    assert.match(result.reasons[0].detail, /policy\.bad_freshness/);
    assert.match(result.reasons[0].detail, /policy\.admin_commit_invalid/);
  });

  test('CONTRACT: decide() never throws on malformed input — a refusal is data', () => {
    assert.doesNotThrow(() => decide({}));
    assert.deepEqual(codes(decide({})), ['policy.invalid']);
    assert.doesNotThrow(() => decide({ policy: allowedPolicy(), request: null, certification: null, artifact: null, served: null, now: 'x' }));
    assert.equal(decide({ policy: allowedPolicy() }).decision, 'REFUSE');
  });
});

describe('certification — is this candidate certified, by the right thing?', () => {
  const cases = [
    ['refuses when no certifying run was resolved', 'certification.missing', (i) => { i.certification = { present: false }; }],
    ['refuses a certifying run that failed', 'certification.failed', (i) => { i.certification.conclusion = 'failure'; }],
    ['refuses a MISSING required check as firmly as a failed one', 'certification.check_missing', (i) => { i.certification.checks = []; }],
    ['refuses a required check still running', 'certification.check_incomplete', (i) => { i.certification.checks = [{ name: 'certify', status: 'in_progress', conclusion: null }]; }],
    ['refuses a SKIPPED required check', 'certification.check_not_passing', (i) => { i.certification.checks = [{ name: 'certify', status: 'completed', conclusion: 'skipped' }]; }],
    ['refuses a truncated job listing', 'certification.checks_unreadable', (i) => { i.certification.checksTruncated = true; }],
    ['refuses a run belonging to a different workflow file', 'certification.wrong_workflow', (i) => { i.certification.workflowPath = '.github/workflows/ci.yml'; }],
    ['refuses a run from an unrelated repository', 'certification.wrong_repository', (i) => { i.certification.repository = 'someone-else/Dinify-Frontend'; }],
    ['refuses a run whose head is a fork', 'certification.wrong_repository', (i) => { i.certification.headRepository = 'someone-else/Dinify-Frontend'; }],
    ['refuses a run triggered by something other than a push', 'certification.wrong_event', (i) => { i.certification.event = 'pull_request'; }],
    ['refuses a green run on a branch that is not main', 'certification.wrong_branch', (i) => { i.certification.headBranch = 'feature/x'; }],
    ['refuses a run that certified a different commit than requested', 'certification.wrong_target', (i) => { i.request.target = OLDER_SHA; }],
    ['refuses a target that is not an ancestor of the default branch', 'certification.not_ancestor', (i) => { i.certification.ancestorOfDefaultBranch = false; }],
    ['refuses a certification older than the freshness window', 'certification.stale', (i) => { i.certification.runStartedAt = '2026-09-20T11:30:00Z'; }],
    ['refuses a certification timestamp it cannot read', 'certification.unreadable_time', (i) => { i.certification.runStartedAt = 'yesterday'; }],
    ['refuses a certification dated in the future', 'certification.time_in_future', (i) => { i.certification.runStartedAt = '2026-09-23T11:30:00Z'; }],
    ['CONTRACT (R3): refuses when the run listed no artifact for this attempt', 'certification.artifact_unavailable', (i) => { i.certification.artifacts = []; }],
    ['CONTRACT (R3): refuses an EXPIRED artifact', 'certification.artifact_unavailable', (i) => { i.certification.artifacts[0].expired = true; }],
    ['CONTRACT (R3): refuses an artifact the API lists under another run', 'certification.artifact_unavailable', (i) => { i.certification.artifacts[0].workflowRunId = 9999; }],
    ['CONTRACT (R3): refuses when the artifacts could not be listed at all', 'certification.artifact_unavailable', (i) => { i.certification.artifacts = null; }],
    ['CONTRACT (R3): refuses two artifacts with the attempt\'s name', 'certification.artifact_unavailable', (i) => { i.certification.artifacts.push({ ...i.certification.artifacts[0], id: 778 }); }],
  ];
  for (const [name, code, mutate] of cases) test(name, () => assertRefused(broken(mutate), code));
});

describe('artifact — is this the exact unit that run certified?', () => {
  const cases = [
    ['refuses when no artifact was retrieved', 'artifact.missing', (i) => { i.artifact = { present: false }; }],
    ['refuses a tree digest that disagrees with the certifying run', 'artifact.digest_mismatch', (i) => { i.artifact.observedTreeDigest = `sha256:${'9'.repeat(64)}`; }],
    ['refuses an artifact whose expected digest is absent', 'artifact.no_expected_digest', (i) => { delete i.artifact.expectedTreeDigest; }],
    ['refuses a manifest that does not validate', 'artifact.manifest_invalid', (i) => { i.artifact.manifestValid = false; i.artifact.manifestProblems = [{ code: 'manifest.bad_commit', detail: 'x' }]; }],
    ['refuses an artifact built from a different commit', 'artifact.commit_mismatch', (i) => { i.artifact.manifest.commit = OLDER_SHA; }],
    ['refuses an artifact left by an EARLIER ATTEMPT of the same run', 'artifact.attempt_mismatch', (i) => { i.certification.runAttempt = '2'; i.certification.artifacts[0].name = 'frontend-release-4242-2'; }],
    ['refuses an artifact built with a different configuration', 'artifact.configuration_mismatch', (i) => { i.artifact.manifest.buildConfiguration = 'production'; }],
    ['refuses an artifact stamped by a different run', 'artifact.run_mismatch', (i) => { i.artifact.manifest.certification.runId = '9999'; }],
    ['refuses an artifact baked against an unapproved API origin', 'artifact.api_url_mismatch', (i) => { i.artifact.manifest.environment.apiUrl = 'https://api.dinifyapp.com'; }],
    ['refuses a production flag the policy no longer expects', 'artifact.production_flag_mismatch', (i) => { i.policy.build.expectedProductionFlag = true; }],
    ['refuses an artifact addressed at a different destination', 'artifact.destination_mismatch', (i) => { i.artifact.manifest.hosting.site = 'somewhere-else'; }],
    ['refuses an unsafe archive entry rather than extracting it', 'artifact.unsafe_entry', (i) => { i.artifact.unsafeEntries = ['symbolic link: dist/evil']; }],
    ['CONTRACT (R3): refuses a download that is not the listed artifact', 'artifact.wrong_artifact', (i) => { i.artifact.artifactId = 999; }],
  ];
  for (const [name, code, mutate] of cases) test(name, () => assertRefused(broken(mutate), code));

  test('CONTROL: the matching attempt of a re-run is not refused', () => {
    assertProceeds(broken((i) => {
      i.certification.runAttempt = '2';
      i.certification.artifacts[0].name = 'frontend-release-4242-2';
      i.artifact.manifest.certification.runAttempt = '2';
      reattest(i);
    }));
  });
});

describe('source binding — the manifest describes the commit it names', () => {
  const cases = [
    ['REGRESSION (R3.h): a self-consistent substitute built from another tree is refused', 'artifact.source_tree_mismatch', (i) => { i.artifact.manifest.source.tree = '0'.repeat(40); }],
    ['CONTRACT: a manifest naming a different lockfile is refused', 'artifact.lock_mismatch', (i) => { i.artifact.manifest.dependencies.lockDigest = `sha256:${'8'.repeat(64)}`; }],
    ['REGRESSION (R1.f): the D01 digest is checked against the certified SOURCE, not a literal', 'artifact.contract_source_mismatch', (i) => { i.artifact.manifest.compatibility.contracts.d01CheckoutLimits = `sha256:${'7'.repeat(64)}`; }],
    ['CONTRACT: a manifest whose storage declaration is not the source\'s is refused', 'artifact.storage_declaration_mismatch', (i) => { i.artifact.manifest.compatibility.storage.declarationDigest = `sha256:${'4'.repeat(64)}`; }],
    ['CONTRACT: constants that are not the certified source\'s are refused', 'artifact.constants_mismatch', (i) => { i.artifact.manifest.compatibility.clientConstants.CHECKOUT_RECORD_VERSION = 9; }],
    ['CONTRACT: expectations not derived from the certified constants are refused', 'artifact.constants_mismatch', (i) => { i.artifact.manifest.compatibility.clientExpects.checkout_protocol = 1; }],
    ['CONTRACT: supported policy versions that are not the source\'s are refused', 'artifact.constants_mismatch', (i) => { i.artifact.manifest.compatibility.clientSupports.quote_policy_version = [1, 2]; }],
    ['CONTRACT: an environment that is not the certified environment file is refused', 'artifact.environment_mismatch', (i) => { i.source.environment.apiUrl = 'https://elsewhere.example'; }],
    ['CONTRACT: an unreadable certified commit is refused', 'source.unreadable', (i) => { i.source = { present: false, detail: 'not in the clone' }; }],
    ['REGRESSION (R2.e): a commit with NO storage declaration is refused, never defaulted', 'storage.declaration_missing', (i) => { i.source.storage = { present: false }; }],
    ['CONTRACT: an invalid storage declaration is refused', 'storage.declaration_invalid', (i) => { i.source.storage.problems = [{ code: 'storage.declaration_bad_writes', detail: 'x' }]; }],
    ['CONTRACT: a declaration not re-affirmed after its reader changed is refused', 'storage.declaration_stale', (i) => { i.source.storage.stale = ['src/app/_services/checkout-coordinator.service.ts: changed']; }],
  ];
  for (const [name, code, mutate] of cases) test(name, () => assertRefused(broken(mutate), code));
});

describe('hosting — the configuration the tool will actually use', () => {
  test('CONTRACT: an unevaluated hosting configuration is refused', () => {
    assertRefused(broken((i) => { i.hosting = null; }), 'hosting.unevaluated');
  });

  test('CONTRACT: each hosting problem is refused under its own code', () => {
    const result = broken((i) => {
      i.hosting = { problems: [{ code: 'hosting.project_alias_redirect', detail: 'x' }, { code: 'hosting.certified_asset_filtered', detail: 'main.js' }], digest: null };
    });
    assertRefused(result, 'hosting.project_alias_redirect');
    assertRefused(result, 'hosting.certified_asset_filtered');
  });
});

describe('peers — selection receipts (R1)', () => {
  test('REGRESSION (R1.c): a well-formed SHA with no receipt is refused', () => {
    assertRefused(broken((i) => {
      i.policy.compatibleSet.peers.backend.approved[0].commit = '9'.repeat(40);
      i.policy.compatibleSet.peers.backend.approved[0].receipt = `release/peers/backend-${'9'.repeat(40)}.json`;
    }), 'peers.receipt_missing');
  });

  test('REGRESSION (R1.d): a receipt for a FOREIGN repository is refused', () => {
    assertRefused(broken((i) => { i.policy.compatibleSet.peers.backend.repository = 'someone-else/Dinify-Backend'; }), 'peers.receipt_foreign');
  });

  test('CONTRACT: a receipt that is present but unreadable is refused', () => {
    assertRefused(broken((i) => { i.peers.receipts.backend[0] = { commit: BACKEND_SHA, present: true, readable: false, detail: 'bad JSON' }; }), 'peers.receipt_unreadable');
  });

  test('CONTRACT: a receipt for a different revision is refused, even when its digest is approved', () => {
    const other = backendReceipt({ commit: '1'.repeat(40) });
    assertRefused(broken((i) => {
      i.peers.receipts.backend[0].receipt = other;
      i.policy.compatibleSet.peers.backend.approved[0].receiptDigest = receiptDigest(other);
    }), 'peers.receipt_wrong_revision');
  });

  test('CONTRACT: a receipt edited without re-approval is refused', () => {
    assertRefused(broken((i) => {
      i.peers.receipts.backend[0].receipt = { ...i.peers.receipts.backend[0].receipt, tree: '2'.repeat(40) };
    }), 'peers.receipt_mismatch');
  });

  test('CONTRACT: a receipt whose recorded digest does not match its values is refused', () => {
    assertRefused(broken((i) => {
      const r = clone(i.peers.receipts.backend[0].receipt);
      r.contracts.d01CheckoutLimits.values.MAX_TOTAL_UNITS = 501;
      i.peers.receipts.backend[0].receipt = r;
      i.policy.compatibleSet.peers.backend.approved[0].receiptDigest = receiptDigest(r);
    }), 'peers.receipt_inconsistent');
  });

  test('CONTRACT: a public receipt that does not re-derive from the peer\'s repository is refused', () => {
    assertRefused(broken((i) => { i.peers.verification.admin[ADMIN_SHA] = { state: 'mismatch', detail: 'tree differs' }; }), 'peers.admin_receipt_unverified');
  });

  test('CONTRACT: a public receipt that could not be checked is refused', () => {
    assertRefused(broken((i) => { i.peers.verification = {}; }), 'peers.admin_receipt_unverified');
  });

  test('THE CROSS-REPOSITORY NEGATIVE: this candidate is refused beside a backend whose D01 ceilings moved', () => {
    const drifted = backendReceipt({ d01: { ...D01_CONTRACT, MAX_LINES_PER_ORDER: 120 } });
    const result = broken((i) => {
      i.policy = allowedPolicy({ backend: drifted });
      i.peers = peersFor({ backend: drifted });
    });
    assertRefused(result, 'peers.contract_mismatch');
  });

  test('CONTRACT: a backend revision that publishes no capability export is refused by name', () => {
    const old = backendReceipt({ publishes: null });
    assertRefused(broken((i) => { i.policy = allowedPolicy({ backend: old }); i.peers = peersFor({ backend: old }); }), 'peers.capabilities_unpublished');
  });

  test('CONTRACT: a capability level below the client\'s requirement is refused', () => {
    const low = backendReceipt({ publishes: { checkout_protocol: 2, quote_protocol: 2, kitchen_protocol: 1, quote_policy_version: 1 } });
    assertRefused(broken((i) => { i.policy = allowedPolicy({ backend: low }); i.peers = peersFor({ backend: low }); }), 'peers.capability_below_requirement');
  });

  test('CONTRACT: a capability the backend does not publish is refused', () => {
    assertRefused(broken((i) => { i.artifact.manifest.compatibility.clientExpects.settlement_protocol = 1; }), 'peers.capability_unknown');
  });

  test('CONTRACT: a quote policy version the client cannot act on is refused', () => {
    const newer = backendReceipt({ publishes: { checkout_protocol: 3, quote_protocol: 2, kitchen_protocol: 1, quote_policy_version: 2 } });
    assertRefused(broken((i) => { i.policy = allowedPolicy({ backend: newer }); i.peers = peersFor({ backend: newer }); }), 'peers.policy_version_unsupported');
  });

  test('CONTRACT: a build configuration outside the set is refused', () => {
    assertRefused(broken((i) => { i.policy.compatibleSet.frontendRequires.buildConfiguration = 'staging'; }), 'peers.configuration_not_in_set');
  });

  test('CONTROL: two approved backend revisions, both compatible, are allowed', () => {
    const second = backendReceipt({ commit: '3'.repeat(40) });
    assertProceeds(broken((i) => {
      i.policy.compatibleSet.peers.backend.approved.push({ commit: second.commit, receipt: `release/peers/backend-${second.commit}.json`, receiptDigest: receiptDigest(second) });
      i.peers.receipts.backend.push({ commit: second.commit, present: true, readable: true, receipt: second, digest: receiptDigest(second) });
    }));
  });

  test('CONTRACT: EVERY approved backend must be compatible, since any of them may be the live one', () => {
    const old = backendReceipt({ commit: '3'.repeat(40), publishes: null });
    assertRefused(broken((i) => {
      i.policy.compatibleSet.peers.backend.approved.push({ commit: old.commit, receipt: `release/peers/backend-${old.commit}.json`, receiptDigest: receiptDigest(old) });
      i.peers.receipts.backend.push({ commit: old.commit, present: true, readable: true, receipt: old, digest: receiptDigest(old) });
    }), 'peers.capabilities_unpublished');
  });
});

describe('peers — serving evidence, kept apart from selection (R1)', () => {
  test('REGRESSION (R1.e): a peer whose served revision cannot be observed is refused by name', () => {
    assertRefused(broken((i) => {
      i.policy.compatibleSet.peers.backend.serving = { observation: 'unavailable', reason: 'no public identity until B3' };
    }), 'peers.backend_serving_unverified');
  });

  test('CONTRACT: an unreadable peer identity is refused', () => {
    assertRefused(broken((i) => { i.peers.serving.admin = { state: 'unreadable', detail: 'HTTP 502' }; }), 'peers.admin_serving_unreadable');
  });

  test('CONTRACT: a cacheable peer identity is not an observation', () => {
    assertRefused(broken((i) => { i.peers.serving.admin.noStore = false; }), 'peers.admin_serving_cacheable');
  });

  test('CONTRACT: a served peer outside the approved set is refused', () => {
    assertRefused(broken((i) => { i.peers.serving.admin.commit = '4'.repeat(40); }), 'peers.admin_serving_unapproved');
  });

  test('CONTRACT: a NEW backend revision serving needs approved-set evidence first', () => {
    assertRefused(broken((i) => { i.peers.serving.backend.commit = '4'.repeat(40); }), 'peers.backend_serving_unapproved');
  });
});

describe('publication prerequisites — owner actions, named', () => {
  test('CONTRACT: unrecorded source protection is refused', () => {
    assertRefused(broken((i) => { i.policy.prerequisites.sourceProtection.status = 'unrecorded'; }), 'prerequisite.source_protection_unrecorded');
  });

  test('CONTROL: source protection disclosed as a limitation is accepted', () => {
    assertProceeds(broken((i) => { i.policy.prerequisites.sourceProtection.status = 'limitation-disclosed'; }));
  });

  test('CONTRACT: unverified retention is refused', () => {
    assertRefused(broken((i) => { i.policy.prerequisites.retention.status = 'unverified'; }), 'prerequisite.retention_unverified');
  });

  test('CONTRACT: an active legacy writer is refused', () => {
    assertRefused(broken((i) => { i.policy.prerequisites.singlePublisher.status = 'legacy-writer-active'; }), 'prerequisite.legacy_publisher_active');
  });

  test('CONTRACT: the policy cannot claim one publisher while the legacy workflow file exists', () => {
    assertRefused(broken((i) => { i.trusted.legacyPublisherPresent = true; }), 'prerequisite.legacy_publisher_present');
  });

  test('CONTRACT: an unestablished legacy-publisher observation is refused, not assumed absent', () => {
    assertRefused(broken((i) => { i.trusted = undefined; }), 'prerequisite.legacy_publisher_present');
  });
});

describe('ordering and identity — the candidate, not the commit (R3)', () => {
  test('a queued older automatic candidate SKIPS', () => {
    const result = broken((i) => { i.served = servedKnown({ commit: OLDER_SHA, relation: 'ancestor' }); });
    assert.equal(result.decision, 'SKIP_STALE');
    assert.equal(result.allow, false);
  });

  test('an automatic re-run of EXACTLY the served candidate SKIPS', () => {
    const result = broken((i) => { i.served = servedKnown({ manifest: i.artifact.manifest, relation: 'identical' }); });
    assert.equal(result.decision, 'SKIP_IDENTICAL');
  });

  test('REGRESSION (R3.a/b): the same SHA with a DIFFERENT manifest is not "identical" — the relation is not decided on the SHA alone', () => {
    const result = broken((i) => {
      const other = manifestFor({ commit: TARGET_SHA, builtAt: '2026-09-22T11:00:00Z' });
      i.served = servedKnown({ manifest: other, relation: 'identical' });
    });
    assertRefused(result, 'served.same_commit_different_candidate');
  });

  test('CONTROL: two certifications of one SHA — a person may choose to publish the second', () => {
    assertProceeds(broken((i) => {
      i.request.trigger = 'manual';
      i.served = servedKnown({ manifest: manifestFor({ commit: TARGET_SHA, builtAt: '2026-09-22T11:00:00Z' }), relation: 'identical' });
    }));
  });

  test('refuses a divergent history rather than guessing', () => {
    assertRefused(broken((i) => { i.served.relationToTarget = 'divergent'; }), 'served.divergent');
  });

  test('refuses an unknown relation', () => {
    assertRefused(broken((i) => { i.served.relationToTarget = 'unknown'; }), 'served.divergent');
  });

  test('refuses an unreadable served identity — never assumed absent', () => {
    assertRefused(broken((i) => { i.served = { state: 'unreadable', detail: 'HTTP 502' }; }), 'served.unreadable');
  });

  test('CONTRACT: a served identity with no manifest digest is unreadable', () => {
    assertRefused(broken((i) => { delete i.served.manifestDigest; }), 'served.unreadable');
  });

  test('refuses an unbootstrapped origin while bootstrap is not authorized', () => {
    assertRefused(broken((i) => { i.served = { state: 'absent' }; }), 'served.bootstrap_unauthorized');
  });

  test('refuses a cacheable served identity', () => {
    assertRefused(broken((i) => { i.served.cacheControlNoStore = false; i.served.cacheControl = 'public, max-age=3600'; }), 'served.identity_cacheable');
  });

  test('CONTRACT: a served identity whose caching was not established is refused', () => {
    assertRefused(broken((i) => { delete i.served.cacheControlNoStore; }), 'served.identity_cacheable');
  });
});

describe('modes — backward movement is a decision a person makes', () => {
  test('refuses backward movement requested as an ordinary manual deploy', () => {
    assertRefused(broken((i) => { i.request.trigger = 'manual'; i.served.relationToTarget = 'ancestor'; }), 'rollback.implicit');
  });

  test('refuses an automatic rollback', () => {
    assertRefused(broken((i) => { i.request.mode = 'rollback'; }), 'request.automatic_rollback');
  });

  test('refuses a rollback whose target is not backward', () => {
    assertRefused(broken((i) => { i.request = { mode: 'rollback', trigger: 'manual', target: TARGET_SHA }; }), 'rollback.not_backward');
  });

  test('CONTRACT: a rollback whose certified artifact has expired is refused — the artifact IS what it republishes', () => {
    assertRefused(broken((i) => {
      i.request = { mode: 'rollback', trigger: 'manual', target: TARGET_SHA };
      i.served = servedKnown({ commit: OLDER_SHA, relation: 'ancestor' });
      i.certification.artifacts[0].expired = true;
    }), 'certification.artifact_unavailable');
  });

  test('CONTRACT: a rollback to a candidate certified outside the window is refused, not waved through', () => {
    assertRefused(broken((i) => {
      i.request = { mode: 'rollback', trigger: 'manual', target: TARGET_SHA };
      i.served = servedKnown({ commit: OLDER_SHA, relation: 'ancestor' });
      i.now = '2026-09-24T12:00:00Z';
    }), 'certification.stale');
  });

  test('CONTRACT: a rollback with nothing served is refused', () => {
    assertRefused(broken((i) => {
      i.request = { mode: 'rollback', trigger: 'manual', target: TARGET_SHA };
      i.served = { state: 'absent' };
      i.policy.bootstrap = { authorized: true, servedBaseline: { commit: OLDER_SHA } };
    }), 'rollback.not_backward');
  });

  test('refuses an unrecognised mode', () => {
    assertRefused(broken((i) => { i.request.mode = 'promote'; }), 'request.bad_mode');
  });
});

describe('STORAGE — set containment, on every promoting path (R2)', () => {
  const upgraded = storageProjection({ writes: pair(3), reads: [pair(1), pair(2), pair(3)] });
  const downgraded = storageProjection({ writes: pair(2), reads: [pair(1), pair(2)] });

  test('CONTROL: moving FORWARD across a storage version is allowed', () => {
    assertProceeds(broken((i) => { withCandidateStorage(i, upgraded); }));
  });

  test('REGRESSION (R2.b): an AUTOMATIC DESCENDANT that cannot read the served record version is refused', () => {
    // A revert on main is an ordinary automatic deploy of a descendant commit. It
    // passed unchecked, because the barrier existed only on the rollback path.
    assertRefused(broken((i) => { i.served = servedKnown({ commit: OLDER_SHA, relation: 'descendant', storage: upgraded }); }), 'storage.incompatible');
  });

  test('REGRESSION (R2.b): a MANUAL deploy that cannot read the served record version is refused', () => {
    assertRefused(broken((i) => {
      i.request.trigger = 'manual';
      i.served = servedKnown({ commit: OLDER_SHA, relation: 'descendant', storage: upgraded });
    }), 'storage.incompatible');
  });

  test('CONTROL (R2.c): the one case the old barrier refused — a rollback to an older record version — is still refused', () => {
    assertRefused(broken((i) => {
      i.request = { mode: 'rollback', trigger: 'manual', target: TARGET_SHA };
      i.served = servedKnown({ commit: OLDER_SHA, relation: 'ancestor', storage: upgraded });
      withCandidateStorage(i, downgraded);
    }), 'storage.incompatible');
  });

  test('CONTROL: a rollback within the same semantics is allowed', () => {
    assertProceeds(broken((i) => {
      i.request = { mode: 'rollback', trigger: 'manual', target: TARGET_SHA };
      i.served = servedKnown({ commit: OLDER_SHA, relation: 'ancestor' });
    }));
  });

  test('REGRESSION (R2.a): a descendant that cannot read the served SEMANTICS is refused, at the same version', () => {
    const newSemantics = storageProjection({ writes: pair(2, 2), reads: [pair(1), pair(2), pair(2, 2)] });
    assertRefused(broken((i) => { i.served = servedKnown({ commit: OLDER_SHA, relation: 'descendant', storage: newSemantics }); }), 'storage.incompatible');
  });

  test('CONTRACT: a numerically LARGER version is not assumed to read an older record', () => {
    const largerButNarrow = storageProjection({ writes: pair(3), reads: [pair(3)] });
    const result = broken((i) => { withCandidateStorage(i, largerButNarrow); });
    assertRefused(result, 'storage.incompatible');
    assert.match(result.reasons.find((r) => r.code === 'storage.incompatible').detail, /2\.1/);
  });

  test('CONTRACT: a moved storage key is refused', () => {
    const moved = storageProjection({ key: 'diner.checkout.elsewhere' });
    assertRefused(broken((i) => { withCandidateStorage(i, moved); }), 'storage.incompatible');
  });

  test('CONTRACT: a served manifest with no comparable storage is refused', () => {
    assertRefused(broken((i) => { delete i.served.manifest.compatibility.storage; }), 'storage.baseline_unreadable');
  });

  test('CONTRACT: the candidate and the served declarations are independent objects', () => {
    const input = baseline();
    assert.notStrictEqual(input.artifact.manifest.compatibility.storage, input.served.manifest.compatibility.storage);
    // Changing only the SERVED side changes the verdict; the candidate's own
    // declaration is never read as the baseline.
    input.served = servedKnown({ commit: OLDER_SHA, relation: 'descendant', storage: upgraded });
    assertRefused(decide(input), 'storage.incompatible');
    // And changing only the CANDIDATE side, compatibly, does not.
    const again = baseline();
    withCandidateStorage(again, upgraded);
    assertProceeds(decide(again));
  });

  test('CONTROL: a skip evaluates no storage — it promotes nothing', () => {
    const result = broken((i) => { i.served = servedKnown({ commit: OLDER_SHA, relation: 'ancestor', storage: upgraded }); });
    assert.equal(result.decision, 'SKIP_STALE');
  });

  test('CONTRACT: bootstrap without a named baseline is refused', () => {
    assertRefused(broken((i) => {
      i.served = { state: 'absent' };
      i.policy.bootstrap = { authorized: true, servedBaseline: null };
      i.baseline = { state: 'none' };
    }), 'storage.bootstrap_baseline_missing');
  });

  test('CONTRACT: bootstrap with an unreadable baseline is refused', () => {
    assertRefused(broken((i) => {
      i.served = { state: 'absent' };
      i.policy.bootstrap = { authorized: true, servedBaseline: { commit: OLDER_SHA } };
      i.baseline = { state: 'unreadable', detail: 'no declaration at the named baseline' };
    }), 'storage.baseline_unreadable');
  });

  test('CONTRACT: bootstrap against an incompatible baseline is refused', () => {
    assertRefused(broken((i) => {
      i.served = { state: 'absent' };
      i.policy.bootstrap = { authorized: true, servedBaseline: { commit: OLDER_SHA } };
      i.baseline = { state: 'known', commit: OLDER_SHA, storage: upgraded };
    }), 'storage.incompatible');
  });
});

describe('ELIGIBILITY — separate from ancestry (R2)', () => {
  test('REGRESSION (R2.d): a revoked target is refused on an ordinary deploy', () => {
    assertRefused(broken((i) => { i.policy.eligibility.revoked = [{ commit: TARGET_SHA, reason: 'reverted: bad release' }]; }), 'eligibility.revoked');
  });

  test('CONTRACT: a revoked target is refused on a rollback too', () => {
    assertRefused(broken((i) => {
      i.request = { mode: 'rollback', trigger: 'manual', target: TARGET_SHA };
      i.served = servedKnown({ commit: OLDER_SHA, relation: 'ancestor' });
      i.policy.eligibility.revoked = [{ commit: TARGET_SHA, reason: 'unsafe' }];
    }), 'eligibility.revoked');
  });

  test('CONTRACT: a target below the minimum safe target is refused', () => {
    assertRefused(broken((i) => {
      i.policy.eligibility.minimumSafeTarget = OLDER_SHA;
      i.eligibility.relationToMinimum = 'ancestor';
    }), 'eligibility.below_minimum_safe_target');
  });

  test('CONTRACT: an unestablished relation to the minimum is refused', () => {
    assertRefused(broken((i) => {
      i.policy.eligibility.minimumSafeTarget = OLDER_SHA;
      i.eligibility.relationToMinimum = 'unknown';
    }), 'eligibility.relation_unknown');
  });

  test('CONTROL: a target descending from the minimum safe target is allowed', () => {
    assertProceeds(broken((i) => {
      i.policy.eligibility.minimumSafeTarget = OLDER_SHA;
      i.eligibility.relationToMinimum = 'descendant';
    }));
  });
});

describe('a refusal names every reason, not the first one', () => {
  test('several independent faults are all reported', () => {
    const result = broken((i) => {
      i.certification.conclusion = 'failure';
      i.certification.workflowPath = '.github/workflows/ci.yml';
      i.artifact.observedTreeDigest = `sha256:${'9'.repeat(64)}`;
      i.policy.prerequisites.retention.status = 'unverified';
    });
    for (const code of ['certification.failed', 'certification.wrong_workflow', 'artifact.digest_mismatch', 'prerequisite.retention_unverified']) {
      assert.ok(codes(result).includes(code), `missing ${code} in ${JSON.stringify(codes(result))}`);
    }
  });
});

describe('DEPENDENCIES (D08 B2.2) — certification evidence, the fresh assessment, the toolchain', () => {
  const ev = (i) => i.artifact.dependencyEvidence;
  const as = (i) => i.dependencies.assessment.doc;

  test('CONTROL: the baseline carries passing evidence, a passing fresh assessment and a prepared toolchain — and proceeds', () => {
    const input = baseline();
    assert.deepEqual(validateEvidenceRecord(ev(input).record), [], 'the fixture record has the shape stamp writes');
    assert.deepEqual(validateAssessment(as(input)), [], 'the fixture assessment has the shape assess writes');
    assert.deepEqual(validateTooling(input.dependencies.tooling), [], 'the fixture toolchain has the shape prepare-publisher writes');
    assertProceeds(decide(input));
  });

  test('CONTROL: the stamp time is not the API\'s run_started_at, and is never compared with it', () => {
    const input = baseline();
    assert.notEqual(input.artifact.manifest.certification.runStartedAt, input.certification.runStartedAt);
    assert.equal(ev(input).record.certification.runStartedAt, input.artifact.manifest.certification.runStartedAt);
    assertProceeds(decide(input));
  });

  // ── the certification half ──
  const evidenceCases = [
    ['REGRESSION: an OLD candidate (pre-B2.2 provenance) is unsupported — no retrofit, no bypass', 'dependency.evidence_unsupported', (i) => {
      i.artifact.provenance = { schema: 'dinify.release.provenance/1', legacy: true };
      i.artifact.dependencyEvidence = { state: 'absent', problems: [], unsafe: [] };
    }],
    ['CONTRACT: a current candidate that carries no evidence', 'dependency.evidence_missing', (i) => { i.artifact.dependencyEvidence = { state: 'absent', problems: [], unsafe: [] }; }],
    ['CONTRACT: evidence the gate could not re-derive (a raw output missing)', 'dependency.evidence_invalid', (i) => { ev(i).problems = [{ code: 'evidence.raw_missing', detail: 'application' }]; }],
    ['CONTRACT: a result.json the raw output does not reproduce', 'dependency.evidence_invalid', (i) => { ev(i).problems = [{ code: 'evidence.unreproducible', detail: 'blocking != within_policy' }]; }],
    ['CONTRACT: an evidence directory carrying a link or an unexpected entry', 'dependency.evidence_invalid', (i) => { ev(i).unsafe = ['symbolic link: dependency-evidence/audit/x']; }],
    ['CONTRACT: evidence of ANOTHER repository', 'dependency.evidence_wrong_repository', (i) => { ev(i).record.repository = 'mugak1/Dinify-Admin'; }],
    ['CONTRACT: evidence bound to a DIFFERENT candidate tree', 'dependency.evidence_wrong_candidate', (i) => { ev(i).record.candidate.artifactTreeDigest = `sha256:${'0'.repeat(64)}`; }],
    ['CONTRACT: evidence bound to a different manifest (another certification of the same SHA)', 'dependency.evidence_wrong_candidate', (i) => { ev(i).record.candidate.manifestDigest = `sha256:${'0'.repeat(64)}`; }],
    ['CONTRACT: evidence of another commit', 'dependency.evidence_wrong_commit', (i) => { ev(i).record.commit = OLDER_SHA; }],
    ['CONTRACT: evidence of another source tree', 'dependency.evidence_wrong_tree', (i) => { ev(i).record.tree = '0'.repeat(40); }],
    ['CONTRACT: evidence of another build configuration', 'dependency.evidence_wrong_configuration', (i) => { ev(i).record.buildConfiguration = 'production'; }],
    ['CONTRACT: evidence of another certifying run', 'dependency.evidence_wrong_run', (i) => { ev(i).record.certification.runId = '9999'; }],
    ['CONTRACT: evidence stamped at another moment than its manifest (not the same stamp)', 'dependency.evidence_wrong_run', (i) => { ev(i).record.certification.runStartedAt = '2026-09-22T11:36:00Z'; }],
    ['CONTRACT: evidence of another certification workflow', 'dependency.evidence_wrong_run', (i) => { ev(i).record.certification.workflowPath = '.github/workflows/ci.yml'; }],
    ['CONTRACT: evidence of an earlier attempt of the run', 'dependency.evidence_wrong_attempt', (i) => { ev(i).record.certification.runAttempt = '2'; }],
    ['CONTRACT: evidence over another lockfile than the manifest names', 'dependency.evidence_wrong_lock', (i) => { ev(i).inputs.lockDigest = `sha256:${'0'.repeat(64)}`; }],
    ['CONTRACT: a record that claims one lockfile beside a retained file that is another', 'dependency.evidence_wrong_lock', (i) => { ev(i).record.inputs.lockDigest = `sha256:${'0'.repeat(64)}`; }],
    ['CONTRACT: evidence over another package.json than the certified commit holds', 'dependency.evidence_wrong_manifest', (i) => { i.source.manifestDigest = `sha256:${'0'.repeat(64)}`; }],
    ['CONTRACT: evidence taken on another Node than the build', 'dependency.evidence_wrong_environment', (i) => { ev(i).record.environment.node = 'v24.0.0'; }],
    ['CONTRACT: a certification audit that did not pass', 'dependency.evidence_not_passing', (i) => { ev(i).record.audit.outcome = 'blocking'; ev(i).record.audit.exitCode = 1; }],
    ['CONTRACT: a certification the stamp re-evaluated as not passing', 'dependency.evidence_not_passing', (i) => { ev(i).record.audit.reevaluatedOutcome = 'incomplete'; }],
    ['CONTRACT: a certification whose raw output reproduces as not passing', 'dependency.evidence_not_passing', (i) => { ev(i).audit.outcome = 'blocking'; }],
  ];
  for (const [name, code, mutate] of evidenceCases) test(name, () => assertRefused(broken(mutate), code));

  // ── the fresh half ──
  const assessmentCases = [
    ['CONTRACT: no fresh assessment — not performed is not passed', 'dependency.assessment_missing', (i) => { i.dependencies.assessment = { state: 'absent', problems: [] }; }],
    ['CONTRACT: an assessment directory that does not check out', 'dependency.assessment_invalid', (i) => { i.dependencies.assessment.problems = [{ code: 'assessment.raw_mismatch', detail: 'publisher' }]; }],
    ['CONTRACT: an assessment made by ANOTHER evaluation run', 'dependency.assessment_not_current', (i) => { i.evaluation.runId = '9101'; }],
    ['CONTRACT: an assessment made by an earlier attempt of this run', 'dependency.assessment_not_current', (i) => { i.evaluation.runAttempt = '2'; }],
    ['CONTRACT: an assessment made by another verifier revision', 'dependency.assessment_not_current', (i) => { as(i).assessor.revision = '0'.repeat(40); }],
    ['CONTRACT: an assessment of another commit', 'dependency.assessment_wrong_candidate', (i) => { as(i).candidate.commit = OLDER_SHA; }],
    ['CONTRACT: an assessment of another artifact', 'dependency.assessment_wrong_candidate', (i) => { as(i).candidate.artifactId = 778; }],
    ['CONTRACT: an assessment of another tree', 'dependency.assessment_wrong_candidate', (i) => { as(i).candidate.treeDigest = `sha256:${'0'.repeat(64)}`; }],
    ['CONTRACT: an assessment of other evidence', 'dependency.assessment_wrong_candidate', (i) => { as(i).candidate.evidenceRecordDigest = `sha256:${'0'.repeat(64)}`; }],
    ['CONTRACT: an assessment of another certification attempt', 'dependency.assessment_wrong_candidate', (i) => { as(i).candidate.runAttempt = '2'; }],
    ['REGRESSION (the premise): an assessment of CURRENT MAIN\'s graph, not the candidate\'s', 'dependency.assessment_wrong_graph', (i) => { as(i).graphs.application.digests.lockfileSha256 = '0'.repeat(64); }],
    ['CONTRACT: an application graph read from an installed tree rather than the certification snapshot', 'dependency.assessment_wrong_graph', (i) => { as(i).graphs.application.observation = 'installed-now'; }],
    ['CONTRACT: an application graph whose inventory is not the certified one', 'dependency.assessment_wrong_graph', (i) => { as(i).graphs.application.digests.installedTreeSha256 = '0'.repeat(64); }],
    ['CONTRACT: a scanner graph that is not the trusted pinned scanner', 'dependency.assessment_wrong_scanner', (i) => { as(i).graphs.scanner.digests.lockfileSha256 = '0'.repeat(64); }],
    ['REGRESSION (the premise): a publisher graph resolved independently, not the prepared toolchain', 'dependency.assessment_wrong_tooling', (i) => { as(i).graphs.publisher.digests.lockfileSha256 = '0'.repeat(64); }],
    ['CONTRACT: an assessed toolchain tree that is not the prepared one', 'dependency.assessment_wrong_tooling', (i) => { as(i).tooling.treeDigest = `sha256:${'0'.repeat(64)}`; }],
    ['CONTRACT: an assessment under another audit policy (a policy change is a restart)', 'dependency.assessment_policy_mismatch', (i) => { i.trusted.auditPolicySha256 = '0'.repeat(64); }],
    ['CONTRACT: collection times out of order', 'dependency.assessment_time_invalid', (i) => { as(i).graphs.scanner.finishedAt = '2026-09-22T11:49:00Z'; }],
    ['CONTRACT: an assessment decided AFTER the moment it is read at', 'dependency.assessment_time_invalid', (i) => { as(i).decidedAt = '2026-09-22T12:00:01Z'; }],
    ['CONTRACT: an assessment "collected" before the candidate was stamped', 'dependency.assessment_time_invalid', (i) => {
      const doc = as(i);
      doc.startedAt = '2026-09-22T11:20:00Z';
      for (const g of Object.values(doc.graphs)) { g.startedAt = '2026-09-22T11:21:00Z'; g.finishedAt = '2026-09-22T11:22:00Z'; }
      doc.finishedAt = '2026-09-22T11:23:00Z'; doc.decidedAt = '2026-09-22T11:23:00Z';
    }],
    ['CONTRACT: an assessment older than the window', 'dependency.assessment_stale', (i) => { i.policy.freshness.assessmentWindowHours = 0.1; }],
    ['REGRESSION (the premise): OLD evidence re-decided with today\'s clock is not fresh — the window runs from the COLLECTION', 'dependency.assessment_stale', (i) => {
      // Collected a day and more ago, re-decided a minute ago: a re-decision is not a query.
      const doc = as(i);
      doc.startedAt = '2026-09-21T11:40:00Z';
      for (const g of Object.values(doc.graphs)) { g.startedAt = '2026-09-21T11:41:00Z'; g.finishedAt = '2026-09-21T11:42:00Z'; }
      doc.finishedAt = '2026-09-21T11:43:00Z';
      doc.decidedAt = '2026-09-22T11:59:00Z';
      i.certification.runStartedAt = '2026-09-21T11:30:00Z';
      i.policy.freshness.certificationWindowHours = 48;
      i.artifact.manifest.certification.runStartedAt = '2026-09-21T11:35:00Z';
      i.artifact.manifest.builtAt = '2026-09-21T11:35:00Z';
      reattestKeepingAssessment(i);
    }],
    ['CONTRACT: an applied exception that has lapsed', 'dependency.exception_expired', (i) => { as(i).recordsApplied = [{ id: 'fixture-exception', expires: '2026-09-22' }]; }],
    ['CONTRACT (SYNTHETIC advisory): a new advisory refuses UNCHANGED bytes', 'dependency.assessment_blocking', (i) => { as(i).outcome = 'blocking'; as(i).exitCode = 1; }],
    ['CONTRACT: a scanner, network or parse failure is incomplete — never a pass', 'dependency.assessment_incomplete', (i) => { as(i).outcome = 'incomplete'; as(i).exitCode = 2; }],
    ['CONTRACT: an outcome word the gate does not know', 'dependency.assessment_invalid', (i) => { as(i).outcome = 'clean'; }],
    ['CONTRACT: a passing word with a failing exit status', 'dependency.assessment_invalid', (i) => { as(i).exitCode = 1; }],
  ];
  for (const [name, code, mutate] of assessmentCases) test(name, () => assertRefused(broken(mutate), code));

  test('CONTROL: an assessment that passes only through an applied, in-date exception proceeds', () => {
    assertProceeds(broken((i) => { as(i).outcome = 'exceptions_only'; as(i).recordsApplied = [{ id: 'fixture-exception', expires: '2026-10-01' }]; }));
  });

  test('CONTROL: lower-severity findings stay VISIBLE and do not block', () => {
    assertProceeds(broken((i) => { as(i).counts.findings = 2; as(i).counts.triageRequired = 2; }));
  });

  test('CONTROL: the last moment inside the assessment window is still inside it', () => {
    assertProceeds(broken((i) => { i.policy.freshness.assessmentWindowHours = 1 / 6; }));
  });

  // ── the toolchain ──
  const toolingCases = [
    ['CONTRACT: no toolchain was prepared', 'dependency.tooling_missing', (i) => { i.dependencies.tooling = null; }],
    ['CONTRACT: tooling facts that are not the shape prepare-publisher writes', 'dependency.tooling_invalid', (i) => { i.dependencies.tooling.schema = 'x'; }],
    ['CONTRACT: preparation reported a problem', 'dependency.tooling_invalid', (i) => { i.dependencies.tooling.problems = [{ code: 'tooling.install_failed', detail: 'x' }]; }],
    ['CONTRACT: another version of the tool than the policy pins', 'dependency.tooling_mismatch', (i) => { i.dependencies.tooling.version = '15.30.2'; }],
    ['CONTRACT: another entrypoint than the policy pins', 'dependency.tooling_mismatch', (i) => { i.dependencies.tooling.entrypoint.path = 'node_modules/.bin/firebase'; }],
    ['CONTRACT: prepared under another Node than the policy pins', 'dependency.tooling_mismatch', (i) => { i.dependencies.tooling.node = 'v24.0.0'; }],
    ['CONTRACT: prepared from a lock that is not the reviewed one', 'dependency.tooling_unreviewed', (i) => { i.trusted.publisherLockfileSha256 = '0'.repeat(64); }],
    ['CONTRACT: prepared from a manifest that is not the reviewed one', 'dependency.tooling_unreviewed', (i) => { i.trusted.publisherManifestSha256 = '0'.repeat(64); }],
    ['CONTRACT: the toolchain was not retained for the publisher', 'dependency.tooling_unretained', (i) => { i.dependencies.uploads.tooling = null; }],
    ['CONTRACT: the assessment was not retained for the publisher', 'dependency.assessment_unretained', (i) => { i.dependencies.uploads.assessment = null; }],
  ];
  for (const [name, code, mutate] of toolingCases) test(name, () => assertRefused(broken(mutate), code));

  test('CONTRACT: a PASS makes nothing else promotable — a revoked target with a clean assessment is still refused', () => {
    const result = broken((i) => { i.policy.eligibility.revoked = [{ commit: TARGET_SHA, reason: 'revoked for the test' }]; });
    assertRefused(result, 'eligibility.revoked');
    assert.equal(codes(result).some((c) => c.startsWith('dependency.')), false, 'the dependency half passed; the refusal is eligibility alone');
  });

  test('CONTRACT: each half is its own requirement — a passing assessment does not stand in for missing evidence, nor the reverse', () => {
    assertRefused(broken((i) => { i.artifact.dependencyEvidence = { state: 'absent', problems: [], unsafe: [] }; }), 'dependency.evidence_missing');
    assertRefused(broken((i) => { i.dependencies.assessment = { state: 'absent', problems: [] }; }), 'dependency.assessment_missing');
  });
});

describe('fixture sanity — the baseline is what it claims', () => {
  test('the candidate manifest digest is the one the observation carries', () => {
    const input = baseline();
    assert.equal(input.artifact.manifestDigest, digestOfValue(input.artifact.manifest));
    assert.equal(input.artifact.expectedTreeDigest, TREE_DIGEST);
  });

  test('the committed policy is NOT the baseline, and differs only as stated', () => {
    const allowed = allowedPolicy();
    const committed = clone(POLICY);
    for (const path of [['prerequisites'], ['compatibleSet', 'peers', 'backend', 'approved'], ['compatibleSet', 'peers', 'backend', 'serving'], ['compatibleSet', 'peers', 'admin', 'approved']]) {
      let a = allowed; let c = committed;
      for (const k of path.slice(0, -1)) { a = a[k]; c = c[k]; }
      delete a[path[path.length - 1]];
      delete c[path[path.length - 1]];
    }
    assert.deepEqual(allowed, committed);
  });
});
