/**
 * THE REFUSAL MATRIX — executed, not described.
 *
 * Milestone B1 of the D08 Stage B approval requires local fixtures proving refusal
 * BEFORE deploy authority on: failed or missing tests, the wrong workflow, a fork or
 * unrelated target, the wrong artifact / digest / configuration, expired or absent
 * certification, an unapproved peer combination and an incompatible rollback — and
 * proving that ordinary main certification and unchanged-peer pinning still work.
 *
 * Every case below calls `decide()` with data. Nothing here is a description of what
 * a workflow would do: the function under test is the same one the publisher runs.
 *
 * READ THE CONTROLS AS PART OF THE SUITE. A gate that refused everything would pass
 * every refusal test in this file; the positive controls are what stop that being a
 * passing result.
 */

import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { decide } from '../lib/decide.mjs';
import { baseline, codes, clone, manifestFor, D01_DIGEST, TARGET_SHA, OLDER_SHA, TREE_DIGEST } from './fixtures.mjs';

/** Break exactly one thing about the allowed case. */
function broken(mutate) {
  const input = baseline();
  mutate(input);
  return decide(input);
}

function assertRefused(result, code) {
  assert.equal(result.decision, 'REFUSE', `expected REFUSE, got ${result.decision}`);
  assert.equal(result.allow, false);
  assert.ok(codes(result).includes(code), `expected reason ${code}, got ${JSON.stringify(codes(result))}`);
}

describe('positive controls — the gate is not simply refusing everything', () => {
  test('CONTROL: an ordinary automatic certification of merged main is allowed', () => {
    const result = decide(baseline());
    assert.equal(result.decision, 'PROCEED');
    assert.deepEqual(result.reasons, []);
  });

  test('CONTROL: unchanged-peer pinning is satisfied by the committed compatible set', () => {
    const input = baseline();
    // Nothing about the peers is touched: the candidate's contract digest and its
    // required capability levels are exactly what the pinned backend publishes.
    assert.equal(input.artifact.manifest.compatibility.contracts.d01CheckoutLimits, D01_DIGEST);
    assert.equal(
      input.policy.compatibleSet.peers.backend.contracts.d01CheckoutLimits,
      D01_DIGEST,
      'the committed policy must pin the same D01 digest the frontend compiles against',
    );
    assert.equal(decide(input).decision, 'PROCEED');
  });

  test('CONTROL: a manual redeploy of exactly what is already served is allowed', () => {
    const result = broken((i) => {
      i.request.trigger = 'manual';
      i.served.relationToTarget = 'identical';
      i.served.servedCommit = TARGET_SHA;
    });
    assert.equal(result.decision, 'PROCEED');
  });

  test('CONTROL: an explicit rollback that clears every precondition is allowed', () => {
    const result = broken((i) => {
      i.request = { mode: 'rollback', trigger: 'manual' };
      i.served.relationToTarget = 'ancestor';
      i.served.targetRetained = true;
      // The target is an OLDER release whose storage revision is the same — the only
      // shape a rollback may legitimately take while the barrier stands.
      i.served.manifest = manifestFor({ commit: TARGET_SHA });
    });
    assert.equal(result.decision, 'PROCEED', JSON.stringify(codes(result)));
  });
});

describe('certification — is this candidate certified, by the right thing?', () => {
  test('refuses when no certifying run was resolved', () => {
    assertRefused(broken((i) => { i.certification = { present: false }; }), 'certification.missing');
  });

  test('refuses a certifying run that failed', () => {
    assertRefused(broken((i) => { i.certification.conclusion = 'failure'; }), 'certification.failed');
  });

  test('refuses a certifying run that was cancelled', () => {
    assertRefused(broken((i) => { i.certification.conclusion = 'cancelled'; }), 'certification.failed');
  });

  test('refuses a MISSING required check as firmly as a failed one', () => {
    assertRefused(broken((i) => { i.certification.checks = []; }), 'certification.check_missing');
  });

  test('refuses a required check that is still running', () => {
    assertRefused(
      broken((i) => { i.certification.checks = [{ name: 'certify', status: 'in_progress', conclusion: null }]; }),
      'certification.check_incomplete',
    );
  });

  test('refuses a SKIPPED required check — skipped is not passed', () => {
    assertRefused(
      broken((i) => { i.certification.checks = [{ name: 'certify', status: 'completed', conclusion: 'skipped' }]; }),
      'certification.check_not_passing',
    );
  });

  test('refuses a TIMED OUT required check', () => {
    assertRefused(
      broken((i) => { i.certification.checks = [{ name: 'certify', status: 'completed', conclusion: 'timed_out' }]; }),
      'certification.check_not_passing',
    );
  });

  test('refuses a run belonging to a different workflow file', () => {
    assertRefused(
      broken((i) => { i.certification.workflowPath = '.github/workflows/ci.yml'; }),
      'certification.wrong_workflow',
    );
  });

  test('refuses a run from a fork or unrelated repository', () => {
    assertRefused(
      broken((i) => { i.certification.repository = 'someone-else/Dinify-Frontend'; }),
      'certification.wrong_repository',
    );
  });

  test('refuses a run triggered by something other than a push', () => {
    assertRefused(broken((i) => { i.certification.event = 'pull_request'; }), 'certification.wrong_event');
  });

  test('refuses a green run on a branch that is not main', () => {
    assertRefused(broken((i) => { i.certification.headBranch = 'feature/x'; }), 'certification.wrong_branch');
  });

  test('refuses a target that is not an ancestor of the default branch', () => {
    assertRefused(broken((i) => { i.certification.ancestorOfDefaultBranch = false; }), 'certification.not_ancestor');
  });

  test('refuses a certification older than the freshness window', () => {
    assertRefused(broken((i) => { i.certification.runStartedAt = '2026-09-20T11:30:00Z'; }), 'certification.stale');
  });

  test('refuses a certification timestamp it cannot read', () => {
    assertRefused(broken((i) => { i.certification.runStartedAt = 'yesterday'; }), 'certification.unreadable_time');
  });

  test('refuses a certification dated in the future', () => {
    assertRefused(broken((i) => { i.certification.runStartedAt = '2026-09-23T11:30:00Z'; }), 'certification.time_in_future');
  });
});

describe('artifact — is this the exact thing that run certified?', () => {
  test('refuses when no artifact was retrieved', () => {
    assertRefused(broken((i) => { i.artifact = { present: false }; }), 'artifact.missing');
  });

  test('refuses a tree digest that disagrees with the certifying run', () => {
    assertRefused(broken((i) => { i.artifact.observedTreeDigest = `sha256:${'9'.repeat(64)}`; }), 'artifact.digest_mismatch');
  });

  test('refuses an artifact whose expected digest is absent — recomputation alone is not provenance', () => {
    assertRefused(broken((i) => { delete i.artifact.expectedTreeDigest; }), 'artifact.no_expected_digest');
  });

  test('refuses a manifest that does not validate', () => {
    assertRefused(broken((i) => {
      i.artifact.manifestValid = false;
      i.artifact.manifestProblems = [{ code: 'manifest.bad_commit', detail: 'x' }];
    }), 'artifact.manifest_invalid');
  });

  test('refuses an artifact built from a different commit than the one certified', () => {
    assertRefused(broken((i) => { i.artifact.manifest.commit = OLDER_SHA; }), 'artifact.commit_mismatch');
  });

  test('refuses an artifact left by an EARLIER ATTEMPT of the same run', () => {
    // A re-run is a different certification of the same commit, and it usually
    // happens because the previous attempt was wrong.
    assertRefused(broken((i) => { i.certification.runAttempt = '2'; }), 'artifact.attempt_mismatch');
  });

  test('CONTROL: the matching attempt is not refused', () => {
    const result = broken((i) => {
      i.certification.runAttempt = '2';
      i.artifact.manifest.certification.runAttempt = '2';
    });
    assert.equal(result.decision, 'PROCEED', JSON.stringify(codes(result)));
  });

  test('refuses an artifact built with a different configuration', () => {
    assertRefused(broken((i) => { i.artifact.manifest.buildConfiguration = 'production'; }), 'artifact.configuration_mismatch');
  });

  test('refuses an artifact stamped by a different run', () => {
    assertRefused(broken((i) => { i.artifact.manifest.certification.runId = '9999'; }), 'artifact.run_mismatch');
  });

  test('refuses an artifact baked against an unapproved API origin', () => {
    assertRefused(broken((i) => { i.artifact.manifest.environment.apiUrl = 'https://api.dinifyapp.com'; }), 'artifact.api_url_mismatch');
  });

  test('refuses an artifact addressed at a different hosting destination', () => {
    assertRefused(broken((i) => { i.artifact.manifest.hosting.site = 'somewhere-else'; }), 'artifact.destination_mismatch');
  });

  test('refuses an unsafe archive entry rather than extracting it', () => {
    assertRefused(broken((i) => { i.artifact.unsafeEntries = ['symbolic link: dist/evil']; }), 'artifact.unsafe_entry');
  });

  test('refuses a hosting config carrying a predeploy hook', () => {
    assertRefused(broken((i) => { i.artifact.hostingConfigHooks = ['$.hosting[0].predeploy']; }), 'artifact.hosting_hooks_present');
  });

  test('refuses a hosting config that does not come from the certified commit', () => {
    assertRefused(broken((i) => { i.artifact.hostingConfigMatchesCertified = false; }), 'artifact.hosting_config_uncertified');
  });
});

describe('compatible set — does this candidate belong beside its pinned peers?', () => {
  test('refuses a D01 ceiling contract that disagrees with the pinned backend', () => {
    // THE CROSS-REPOSITORY NEGATIVE CASE: a ceiling changed on the backend and its own
    // fixture updated, while this repository's copy stayed as it was.
    assertRefused(
      broken((i) => { i.policy.compatibleSet.peers.backend.contracts.d01CheckoutLimits = `sha256:${'c'.repeat(64)}`; }),
      'peers.contract_mismatch',
    );
  });

  test('refuses a client that needs a capability level the pinned backend does not reach', () => {
    assertRefused(
      broken((i) => { i.policy.compatibleSet.peers.backend.publishes.checkout_protocol = 2; }),
      'peers.capability_below_requirement',
    );
  });

  test('refuses a capability the pinned backend does not publish at all', () => {
    assertRefused(
      broken((i) => { i.artifact.manifest.compatibility.clientExpects.settlement_protocol = 1; }),
      'peers.capability_unknown',
    );
  });

  test('refuses when the backend peer is not pinned', () => {
    assertRefused(broken((i) => { delete i.policy.compatibleSet.peers.backend; }), 'peers.backend_unpinned');
  });

  test('refuses when the admin peer is not pinned', () => {
    assertRefused(broken((i) => { delete i.policy.compatibleSet.peers.admin; }), 'peers.admin_unpinned');
  });

  test('refuses when the policy declares no compatible set at all', () => {
    assertRefused(broken((i) => { delete i.policy.compatibleSet; }), 'peers.no_compatible_set');
  });
});

describe('ordering — an older candidate must never overwrite a newer one', () => {
  test('a queued older automatic candidate arriving after a newer release SKIPS', () => {
    const result = broken((i) => { i.served.relationToTarget = 'ancestor'; i.served.servedCommit = OLDER_SHA; });
    assert.equal(result.decision, 'SKIP_STALE');
    assert.equal(result.allow, false);
  });

  test('an automatic re-run of what is already served SKIPS rather than republishing', () => {
    const result = broken((i) => { i.served.relationToTarget = 'identical'; i.served.servedCommit = TARGET_SHA; });
    assert.equal(result.decision, 'SKIP_IDENTICAL');
    assert.equal(result.allow, false);
  });

  test('refuses a divergent history rather than guessing which side is newer', () => {
    assertRefused(broken((i) => { i.served.relationToTarget = 'divergent'; }), 'served.divergent');
  });

  test('refuses when the relation to the served release is unknown', () => {
    assertRefused(broken((i) => { i.served.relationToTarget = 'unknown'; }), 'served.divergent');
  });

  test('refuses when the served identity cannot be read — fails closed, never assumed absent', () => {
    assertRefused(broken((i) => { i.served = { state: 'unreadable', detail: 'HTTP 502' }; }), 'served.unreadable');
  });

  test('refuses an unbootstrapped origin while bootstrap is not authorized', () => {
    assertRefused(broken((i) => { i.served = { state: 'absent' }; }), 'served.bootstrap_unauthorized');
  });

  test('CONTROL: the same unbootstrapped origin is allowed once bootstrap IS authorized', () => {
    const result = broken((i) => { i.served = { state: 'absent' }; i.policy.bootstrap.authorized = true; });
    assert.equal(result.decision, 'PROCEED');
  });

  test('refuses a served identity that is cacheable — a stale read is not an observation', () => {
    assertRefused(
      broken((i) => { i.served.cacheControl = 'public, max-age=3600'; i.served.cacheControlNoStore = false; }),
      'served.identity_cacheable',
    );
  });
});

describe('modes — backward movement is a decision a person makes', () => {
  test('refuses backward movement requested as an ordinary manual deploy', () => {
    assertRefused(
      broken((i) => { i.request.trigger = 'manual'; i.served.relationToTarget = 'ancestor'; }),
      'rollback.implicit',
    );
  });

  test('refuses an automatic rollback — an event cannot decide to move backward', () => {
    assertRefused(broken((i) => { i.request = { mode: 'rollback', trigger: 'automatic' }; }), 'request.automatic_rollback');
  });

  test('refuses a rollback whose target is not backward at all', () => {
    assertRefused(broken((i) => {
      i.request = { mode: 'rollback', trigger: 'manual' };
      i.served.targetRetained = true;
    }), 'rollback.not_backward');
  });

  test('refuses a rollback whose target cannot be shown to be retained', () => {
    assertRefused(broken((i) => {
      i.request = { mode: 'rollback', trigger: 'manual' };
      i.served.relationToTarget = 'ancestor';
      i.served.targetRetained = 'unknown';
      i.served.manifest = manifestFor({ commit: TARGET_SHA });
    }), 'rollback.retention_unproven');
  });

  test('refuses an unrecognised mode', () => {
    assertRefused(broken((i) => { i.request.mode = 'promote'; }), 'request.bad_mode');
  });
});

describe('THE STORAGE BARRIER — a rollback may not discard an outstanding checkout', () => {
  const rollbackTo = (targetStorage, servedStorage) => broken((i) => {
    i.request = { mode: 'rollback', trigger: 'manual' };
    i.served.relationToTarget = 'ancestor';
    i.served.targetRetained = true;
    i.artifact.manifest = manifestFor({ commit: TARGET_SHA, storage: targetStorage });
    i.served.manifest = manifestFor({ commit: OLDER_SHA, storage: servedStorage });
  });

  test('refuses a rollback across CHECKOUT_RECORD_VERSION 2 -> 1 (D08-F18)', () => {
    // The pre-v2 reader rejects any record whose `phase` is unset, and a v2 record has
    // `stage`. It therefore reads null, mints a FRESH idempotency key, and the server's
    // duplicate-order guarantee is bypassed at the moment of a rollback.
    const result = rollbackTo(
      { checkoutRecordVersion: 1, semanticsRevision: 1 },
      { checkoutRecordVersion: 2, semanticsRevision: 1 },
    );
    assertRefused(result, 'rollback.storage_barrier');
    assert.match(result.reasons.find((r) => r.code === 'rollback.storage_barrier').detail, /v1\.1 < served v2\.1/);
  });

  test('refuses a rollback across a SEMANTICS revision even at the same record version', () => {
    // Equality of CHECKOUT_RECORD_VERSION alone is not sufficient: D06 changed what a
    // stored record means several times without moving the number.
    assertRefused(
      rollbackTo({ checkoutRecordVersion: 2, semanticsRevision: 1 }, { checkoutRecordVersion: 2, semanticsRevision: 2 }),
      'rollback.storage_barrier',
    );
  });

  test('refuses a rollback when either storage revision cannot be read', () => {
    assertRefused(
      rollbackTo({ checkoutRecordVersion: 2, semanticsRevision: 1 }, { checkoutRecordVersion: 2 }),
      'rollback.storage_unreadable',
    );
  });

  test('CONTROL: a rollback within the same storage revision is allowed', () => {
    const result = rollbackTo(
      { checkoutRecordVersion: 2, semanticsRevision: 1 },
      { checkoutRecordVersion: 2, semanticsRevision: 1 },
    );
    assert.equal(result.decision, 'PROCEED', JSON.stringify(codes(result)));
  });

  test('CONTROL: moving FORWARD across a storage version is not blocked', () => {
    // The barrier is about an older READER meeting a newer RECORD. A newer bundle
    // upgrades an older record deliberately, so a forward deploy must not be refused.
    const result = broken((i) => {
      i.artifact.manifest = manifestFor({ commit: TARGET_SHA, storage: { checkoutRecordVersion: 3, semanticsRevision: 1 } });
      i.served.manifest = manifestFor({ commit: OLDER_SHA, storage: { checkoutRecordVersion: 2, semanticsRevision: 1 } });
    });
    assert.equal(result.decision, 'PROCEED', JSON.stringify(codes(result)));
  });
});

describe('a refusal names every reason, not the first one', () => {
  test('several independent faults are all reported', () => {
    const result = broken((i) => {
      i.certification.conclusion = 'failure';
      i.certification.workflowPath = '.github/workflows/ci.yml';
      i.artifact.observedTreeDigest = `sha256:${'9'.repeat(64)}`;
    });
    const reported = codes(result);
    for (const code of ['certification.failed', 'certification.wrong_workflow', 'artifact.digest_mismatch']) {
      assert.ok(reported.includes(code), `missing ${code} in ${JSON.stringify(reported)}`);
    }
  });

  test('decide() never throws on malformed input — a refusal is data, not an exception', () => {
    assert.doesNotThrow(() => decide({ policy: { certification: { requiredChecks: [] }, freshness: {}, build: {}, hosting: {} }, request: null, certification: null, artifact: null, served: null, now: 'x' }));
  });
});
