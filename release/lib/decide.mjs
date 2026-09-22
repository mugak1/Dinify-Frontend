/**
 * THE decision: may this exact artifact be published to this destination, now?
 *
 * PURE. Every fact it judges arrives as an argument — the certifying run as the API
 * reported it, the artifact as the publisher measured it, the served state as the
 * public origin answered it, and `now` as an ISO string. It performs no network call,
 * reads no file, spawns nothing and never consults a clock. That is what makes the
 * refusal matrix in `release/tests/decide.test.mjs` an executed control rather than a
 * description of one: every row is this function, called with data.
 *
 * It answers with a DECISION and the reasons for it, never with a thrown exception:
 *
 *   PROCEED          publish this artifact
 *   SKIP_IDENTICAL   already served; an automatic re-run, not a release
 *   SKIP_STALE       an older automatic candidate arriving after a newer one is served
 *   REFUSE           anything else, with at least one reason
 *
 * A SKIP IS NOT A SUCCESS DRESSED UP. It is reported as what it is, with the target
 * and the served release named, and nothing is published.
 */

const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

function reason(code, detail) {
  return { code, detail };
}

function hoursBetween(laterIso, earlierIso) {
  const later = Date.parse(laterIso);
  const earlier = Date.parse(earlierIso);
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return null;
  return (later - earlier) / 3_600_000;
}

/** Lexicographic (version, semantics) comparison. Returns -1 / 0 / 1, or null when
 *  either side cannot be read — which is a refusal, never an assumed equality. */
export function compareStorage(a, b) {
  const ok = (s) => s && Number.isInteger(s.checkoutRecordVersion) && Number.isInteger(s.semanticsRevision);
  if (!ok(a) || !ok(b)) return null;
  if (a.checkoutRecordVersion !== b.checkoutRecordVersion) {
    return a.checkoutRecordVersion < b.checkoutRecordVersion ? -1 : 1;
  }
  if (a.semanticsRevision !== b.semanticsRevision) {
    return a.semanticsRevision < b.semanticsRevision ? -1 : 1;
  }
  return 0;
}

/**
 * @param {object} input
 * @param {object} input.policy            release/policy.json, as committed
 * @param {object} input.request           {mode: 'deploy'|'rollback', trigger: 'automatic'|'manual', target?}
 * @param {object} input.certification     what the API said about the certifying run
 * @param {object} input.artifact          what the publisher measured, plus the inner manifest
 * @param {object} input.served            what the public origin answered
 * @param {string} input.now               ISO-8601 Z
 */
export function decide({ policy, request, certification, artifact, served, now }) {
  const reasons = [];
  const refuse = (code, detail) => { reasons.push(reason(code, detail)); };

  // ── 0. The request itself ────────────────────────────────────────────────────
  const mode = request?.mode;
  const trigger = request?.trigger;
  if (mode !== 'deploy' && mode !== 'rollback') {
    refuse('request.bad_mode', String(mode));
  }
  if (trigger !== 'automatic' && trigger !== 'manual') {
    refuse('request.bad_trigger', String(trigger));
  }
  // Automatic runs are always ordinary deployments. A backward move is a decision a
  // person makes; an event cannot make it on their behalf.
  if (trigger === 'automatic' && mode === 'rollback') {
    refuse('request.automatic_rollback', 'rollback is a deliberate, manual act');
  }

  // ── 1. Trusted provenance: is this candidate certified, and by the right thing? ──
  const c = certification ?? {};
  if (!c.present) {
    refuse('certification.missing', 'no certifying run was resolved for this target');
  } else {
    if (c.repository !== policy.repository) {
      refuse('certification.wrong_repository', `${String(c.repository)} != ${policy.repository}`);
    }
    if (c.workflowPath !== policy.certification.workflowPath) {
      refuse('certification.wrong_workflow', `${String(c.workflowPath)} != ${policy.certification.workflowPath}`);
    }
    if (c.event !== policy.certification.event) {
      refuse('certification.wrong_event', `${String(c.event)} != ${policy.certification.event}`);
    }
    if (c.headBranch !== policy.certification.branch) {
      refuse('certification.wrong_branch', `${String(c.headBranch)} != ${policy.certification.branch}`);
    }
    if (c.conclusion !== 'success') {
      refuse('certification.failed', `conclusion=${String(c.conclusion)}`);
    }
    if (typeof c.headSha !== 'string' || !SHA_RE.test(c.headSha)) {
      refuse('certification.bad_head_sha', String(c.headSha));
    }
    // Ancestry is necessary and NOT sufficient: an ordinary revert leaves the reverted
    // commit in ancestry for ever, so "is an ancestor of main" can never mean "is a
    // target anybody still wants". It is paired with explicit eligibility below.
    if (c.ancestorOfDefaultBranch !== true) {
      refuse('certification.not_ancestor', `ancestorOfDefaultBranch=${String(c.ancestorOfDefaultBranch)}`);
    }
    // Every required context, by name. A missing one is refused exactly as a failed
    // one is: "the check did not run" and "the check said no" are both "not certified".
    const observed = new Map((c.checks ?? []).map((r) => [r.name, r]));
    for (const required of policy.certification.requiredChecks) {
      const run = observed.get(required);
      if (!run) {
        refuse('certification.check_missing', required);
      } else if (run.status !== 'completed') {
        refuse('certification.check_incomplete', `${required} status=${String(run.status)}`);
      } else if (run.conclusion !== 'success') {
        // Anything that is not EXACTLY `success` is refused — `skipped` and
        // `neutral` included, and any conclusion GitHub adds later. An allow-list of
        // one is the safe direction: a deny-list would admit the next new value.
        refuse('certification.check_not_passing', `${required} conclusion=${String(run.conclusion)}`);
      }
    }
    // Freshness. A certification is a statement about a moment; it does not stay true
    // for ever, and the dependency evidence behind it least of all (B2/D13).
    const age = hoursBetween(now, c.runStartedAt ?? '');
    if (age === null) {
      refuse('certification.unreadable_time', String(c.runStartedAt));
    } else if (age < 0) {
      refuse('certification.time_in_future', `${age.toFixed(2)}h`);
    } else if (age > policy.freshness.certificationWindowHours) {
      refuse('certification.stale', `${age.toFixed(2)}h > ${policy.freshness.certificationWindowHours}h`);
    }
  }

  // ── 2. The artifact: is it the one that run certified, and is it safe to unpack? ──
  const a = artifact ?? {};
  const manifest = a.manifest;
  if (!a.present) {
    refuse('artifact.missing', 'no artifact was retrieved for the certifying run');
  } else {
    if (a.manifestValid !== true) {
      refuse('artifact.manifest_invalid', (a.manifestProblems ?? []).map((p) => p.code).join(',') || 'unspecified');
    }
    if (a.provenanceValid !== true) {
      refuse('artifact.provenance_invalid', (a.provenanceProblems ?? []).map((p) => p.code).join(',') || 'unspecified');
    }
    // The digest is compared against the value bound to the TRUSTED certifying run —
    // the provenance record retrieved from that run's own artifact, by run id. A digest
    // recomputed over whatever bytes arrived proves only that they hash to themselves.
    if (!DIGEST_RE.test(a.expectedTreeDigest ?? '')) {
      refuse('artifact.no_expected_digest', String(a.expectedTreeDigest));
    } else if (a.observedTreeDigest !== a.expectedTreeDigest) {
      refuse('artifact.digest_mismatch', `${String(a.observedTreeDigest)} != ${a.expectedTreeDigest}`);
    }
    for (const entry of a.unsafeEntries ?? []) {
      refuse('artifact.unsafe_entry', String(entry));
    }
    if (manifest) {
      if (c.present && manifest.commit !== c.headSha) {
        refuse('artifact.commit_mismatch', `${String(manifest.commit)} != ${String(c.headSha)}`);
      }
      if (manifest.buildConfiguration !== policy.build.configuration) {
        refuse('artifact.configuration_mismatch', `${String(manifest.buildConfiguration)} != ${policy.build.configuration}`);
      }
      if (c.present && manifest.certification?.runId !== String(c.runId)) {
        refuse('artifact.run_mismatch', `${String(manifest.certification?.runId)} != ${String(c.runId)}`);
      }
      // A re-run is a DIFFERENT certification of the same commit. Artifacts are
      // scoped to a run rather than to an attempt, so without this an artifact left
      // by attempt 1 could be published as though attempt 2 had certified it — which
      // is precisely the case where somebody re-ran because attempt 1 was wrong.
      if (c.present && manifest.certification?.runAttempt !== String(c.runAttempt)) {
        refuse('artifact.attempt_mismatch', `${String(manifest.certification?.runAttempt)} != ${String(c.runAttempt)}`);
      }
      if (manifest.environment?.apiUrl !== policy.build.expectedApiUrl) {
        refuse('artifact.api_url_mismatch', `${String(manifest.environment?.apiUrl)} != ${policy.build.expectedApiUrl}`);
      }
      // The same triple as the origin above, and checked for the same reason: the
      // stamper refuses to produce a candidate whose flag disagrees with the policy,
      // but the policy can move AFTER a candidate is certified and while it is still
      // inside the freshness window. Comparing one field of a triple and not the
      // other would leave a diagnostic-mode bundle publishable under a policy that
      // had since asked for the opposite.
      if (manifest.environment?.productionFlag !== policy.build.expectedProductionFlag) {
        refuse(
          'artifact.production_flag_mismatch',
          `${String(manifest.environment?.productionFlag)} != ${String(policy.build.expectedProductionFlag)}`,
        );
      }
      if (manifest.hosting?.site !== policy.hosting.site || manifest.hosting?.target !== policy.hosting.target) {
        refuse('artifact.destination_mismatch', `${String(manifest.hosting?.site)}/${String(manifest.hosting?.target)}`);
      }
    }
    // The publish tool loads its configuration from `firebase.json`, which may carry
    // `predeploy`/`postdeploy` hooks — arbitrary shell commands that would run inside
    // the one job holding the publishing credential. A trusted deploy tool may execute
    // there; a hook specified by the thing being published may not.
    if (a.hostingConfigHooks && a.hostingConfigHooks.length > 0) {
      refuse('artifact.hosting_hooks_present', a.hostingConfigHooks.join(','));
    }
    if (a.hostingConfigMatchesCertified === false) {
      refuse('artifact.hosting_config_uncertified', 'firebase.json does not come from the certified commit');
    }
    // WHERE THE PAYLOAD GOES IS PART OF WHAT IS BEING PUBLISHED. `hosting.public`
    // names the directory Firebase uploads, and the publish job places the verified
    // artifact at one specific path beside the configuration. A certified commit
    // that changed that field would deploy a different tree — successfully — and the
    // post-publish identity read would find out only afterwards, with the site
    // already serving the wrong thing.
    for (const problem of a.hostingConfigProblems ?? []) {
      refuse('artifact.hosting_destination_invalid', String(problem));
    }
  }

  // ── 3. The compatible set: does this candidate belong beside its peers? ──────────
  const setId = policy.compatibleSet?.id;
  const set = policy.compatibleSet;
  if (!set) {
    refuse('peers.no_compatible_set', 'policy declares no compatible set');
  } else if (manifest) {
    if (manifest.buildConfiguration !== set.frontendRequires.buildConfiguration) {
      refuse('peers.configuration_not_in_set', `${String(manifest.buildConfiguration)} != ${set.frontendRequires.buildConfiguration}`);
    }
    const backend = set.peers?.backend;
    if (!backend) {
      refuse('peers.backend_unpinned', setId ?? 'unnamed set');
    } else {
      // The D01 request ceilings are ONE contract with two compiled copies. The digest
      // is taken over the VALUES, in a form Python and JavaScript both produce byte for
      // byte, so a ceiling changed on one side and not the other cannot be released.
      const ours = manifest.compatibility?.contracts?.d01CheckoutLimits;
      if (ours !== backend.contracts?.d01CheckoutLimits) {
        refuse('peers.contract_mismatch', `d01CheckoutLimits ${String(ours)} != ${String(backend.contracts?.d01CheckoutLimits)}`);
      }
      // Every capability the client needs must be one the pinned peer publishes. The
      // comparison is `>=` on the SERVER's own field names: a client that needs level 3
      // cannot be released beside a server that answers 2.
      for (const [capability, needed] of Object.entries(manifest.compatibility?.clientExpects ?? {})) {
        const published = backend.publishes?.[capability];
        if (!Number.isInteger(published)) {
          refuse('peers.capability_unknown', `${capability} not published by the pinned backend`);
        } else if (published < needed) {
          refuse('peers.capability_below_requirement', `${capability} ${published} < ${needed}`);
        }
      }
    }
    if (!set.peers?.admin?.commit) {
      refuse('peers.admin_unpinned', setId ?? 'unnamed set');
    }
  }

  // ── 4. Served state, ordering and rollback ──────────────────────────────────────
  const s = served ?? {};
  let ordering = 'proceed';

  if (s.state === 'unreadable' || s.state === 'error') {
    // Fail closed. "I could not read what is live" is not "nothing is live".
    refuse('served.unreadable', String(s.detail ?? s.state));
  } else if (s.state === 'absent') {
    // Nothing has ever published an identity file. That is a real state exactly once,
    // and it is the one case where the ordering guard has nothing to compare against —
    // so it is an explicitly authorized bootstrap, not a silent pass.
    if (policy.bootstrap?.authorized !== true) {
      refuse('served.bootstrap_unauthorized', policy.bootstrap?.note ?? 'no served identity, and bootstrap is not authorized');
    }
  } else if (s.state === 'known') {
    if (s.cacheControlNoStore === false) {
      refuse('served.identity_cacheable', String(s.cacheControl));
    }
    const relation = s.relationToTarget;
    if (mode === 'deploy') {
      if (relation === 'identical') {
        // An automatic re-run of something already live is a no-op. A person asking for
        // it again is asking for a redeploy, which is a legitimate thing to want.
        if (trigger === 'automatic') ordering = 'skip_identical';
      } else if (relation === 'ancestor') {
        if (trigger === 'automatic') {
          ordering = 'skip_stale';
        } else {
          refuse('rollback.implicit', 'an ordinary deploy may not move backward; use mode=rollback');
        }
      } else if (relation === 'divergent' || relation === 'unknown') {
        refuse('served.divergent', `relationToTarget=${String(relation)}`);
      } else if (relation !== 'descendant') {
        refuse('served.bad_relation', String(relation));
      }
    } else if (mode === 'rollback') {
      if (relation !== 'ancestor' && relation !== 'identical') {
        refuse('rollback.not_backward', `relationToTarget=${String(relation)}`);
      }
      // A rollback target must still EXIST where it would be promoted from, and this
      // repository cannot currently establish Firebase Hosting release retention — that
      // is an owner inventory item. Unknown is refused, not assumed.
      if (s.targetRetained !== true) {
        refuse('rollback.retention_unproven', `targetRetained=${String(s.targetRetained)}; see release/README.md`);
      }
      // THE STORAGE BARRIER. An older bundle's reader discards a record written by a
      // newer one — for the checkout record that means an outstanding idempotency key
      // is dropped and a fresh one minted, which is how one purchase becomes two orders.
      // The barrier ships WITH the rollback capability, never after it.
      const cmp = compareStorage(manifest?.compatibility?.storage, s.manifest?.compatibility?.storage);
      if (cmp === null) {
        refuse('rollback.storage_unreadable', 'a storage revision could not be read on one side');
      } else if (cmp < 0) {
        const t = manifest.compatibility.storage;
        const live = s.manifest.compatibility.storage;
        refuse(
          'rollback.storage_barrier',
          `target storage v${t.checkoutRecordVersion}.${t.semanticsRevision} < served v${live.checkoutRecordVersion}.${live.semanticsRevision}`,
        );
      }
    }
  } else {
    refuse('served.bad_state', String(s.state));
  }

  if (reasons.length > 0) {
    return { decision: 'REFUSE', allow: false, mode, trigger, reasons };
  }
  if (ordering === 'skip_identical') {
    return { decision: 'SKIP_IDENTICAL', allow: false, mode, trigger, reasons: [reason('ordering.identical', String(s.servedCommit))] };
  }
  if (ordering === 'skip_stale') {
    return { decision: 'SKIP_STALE', allow: false, mode, trigger, reasons: [reason('ordering.stale', `served ${String(s.servedCommit)} is newer`)] };
  }
  return { decision: 'PROCEED', allow: true, mode, trigger, reasons: [] };
}
