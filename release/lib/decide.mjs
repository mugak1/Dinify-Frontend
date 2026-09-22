/**
 * THE decision: may this exact candidate be published to this destination, now?
 *
 * PURE. Every fact it judges arrives as an argument — the certifying run and its
 * artifact listing as the API reported them, the artifact as the gate measured it,
 * the certified commit's own source as git holds it, the hosting configuration the
 * tool would actually use, the peers' receipts and served identities, the served
 * state as the public origin answered it, and `now` as an ISO string. It performs no
 * network call, reads no file, spawns nothing and never consults a clock. That is
 * what makes the refusal matrix in `release/tests/` an executed control rather than
 * a description of one: every row is this function, called with data.
 *
 * It answers with a DECISION and the reasons for it, never with a thrown exception:
 *
 *   PROCEED          publish this candidate
 *   SKIP_IDENTICAL   exactly this candidate is already served; an automatic re-run
 *   SKIP_STALE       an older automatic candidate arriving after a newer one is served
 *   REFUSE           anything else, with at least one reason
 *
 * A SKIP IS NOT A SUCCESS DRESSED UP. It is reported as what it is, with the target
 * and the served release named, and nothing is published.
 *
 * WHAT CHANGED IN THE B1 COMPLETION, and why each input exists (the findings are
 * recorded in release/README.md and were reproduced on 3386724 before any change):
 *
 *  - `policy` is VALIDATED FIRST (release/lib/policy.mjs). A missing or malformed
 *    peer SHA used to be read as `undefined` and compared against nothing (R1).
 *  - `source` is the certified commit AS GIT HOLDS IT, read by the trusted verifier.
 *    Every decision-bearing manifest field that has a source is compared against it,
 *    so a manifest cannot describe a different tree, lock, contract, constant set or
 *    storage declaration from the commit it names.
 *  - `hosting` is the configuration the publish tool will ACTUALLY use, regenerated
 *    narrowly from the certified firebase.json AND .firebaserc (R3.4). The publisher
 *    must reproduce exactly the digest admitted here.
 *  - `peers` are RECEIPTS produced from each peer's git and pinned by digest, plus a
 *    SERVING observation where a peer publishes one (R1). A peer whose serving cannot
 *    be observed is refused by that name, not assumed.
 *  - STORAGE is set containment over declared pairs, on EVERY path that promotes —
 *    not only an explicit rollback, and never a numeric comparison (R2).
 *  - IDENTITY is the manifest digest, not the commit: two certifications of one SHA
 *    are two candidates (R3.a).
 */

import { validatePolicy } from './policy.mjs';
import { peerReasons } from './peers.mjs';
import { comparable, unreadableByCandidate } from './storage.mjs';
import { clientExpectationsFrom } from './manifest.mjs';
import { canonicalJson, digestOfValue } from './canonical.mjs';

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

const sameValue = (a, b) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

/** The artifact name the certifying workflow uploads for a run attempt. */
export function certifiedArtifactName(runId, runAttempt) {
  return `frontend-release-${runId}-${runAttempt}`;
}

/**
 * The ONE artifact the certifying run uploaded for this attempt, or the reason there
 * is not exactly one usable one. Shared with the publisher's preflight so the two
 * cannot select differently.
 */
export function selectCertifiedArtifact(listing, { runId, runAttempt }) {
  if (!Array.isArray(listing)) return { artifact: null, problem: 'the run\'s artifacts could not be listed' };
  const name = certifiedArtifactName(runId, runAttempt);
  const named = listing.filter((a) => a?.name === name);
  if (named.length !== 1) return { artifact: null, problem: `${named.length} artifacts named ${name}` };
  const a = named[0];
  if (!Number.isInteger(a.id) || a.id <= 0) return { artifact: null, problem: `${name} has no usable id` };
  if (a.expired === true) return { artifact: null, problem: `${name} has expired` };
  if (String(a.workflowRunId) !== String(runId)) {
    return { artifact: null, problem: `${name} belongs to run ${String(a.workflowRunId)}, not ${String(runId)}` };
  }
  if (!DIGEST_RE.test(String(a.digest))) return { artifact: null, problem: `${name} carries no sha256 digest` };
  return { artifact: a, problem: null };
}

/**
 * @param {object} input
 * @param {object} input.policy          release/policy.json from the trusted default branch
 * @param {object} input.request         {mode: 'deploy'|'rollback', trigger: 'automatic'|'manual', target: sha}
 * @param {object} input.certification   the certifying run, its required jobs and its artifact listing, per the API
 * @param {object} input.artifact        the gate's measurement of the downloaded candidate
 * @param {object} input.source          the certified commit's facts, read from git by the trusted verifier
 * @param {object} input.hosting         effectiveHosting() over the certified commit's configuration
 * @param {object} input.served          what the public origin answered, plus its relation to the target
 * @param {object} input.baseline        the bootstrap baseline's storage declaration, when nothing is served
 * @param {object} input.eligibility     {relationToMinimum}
 * @param {object} input.peers           receipts, public-repository verification and serving observations
 * @param {object} input.trusted         facts about the trusted checkout itself ({legacyPublisherPresent})
 * @param {string} input.now             ISO-8601 Z
 */
export function decide(input) {
  const {
    policy, request, certification, artifact, source, hosting, served,
    baseline, eligibility, peers, trusted, now,
  } = input ?? {};
  const mode = request?.mode;
  const trigger = request?.trigger;

  // ── -1. The policy. Nothing below is meaningful against an invalid one. ─────────
  const policyCheck = validatePolicy(policy);
  if (!policyCheck.ok) {
    return {
      decision: 'REFUSE',
      allow: false,
      mode,
      trigger,
      reasons: [reason('policy.invalid', policyCheck.problems.map((p) => `${p.code}: ${p.detail}`).join('; '))],
    };
  }

  const reasons = [];
  const refuse = (code, detail) => { reasons.push(reason(code, detail)); };

  // ── 0. The request itself ────────────────────────────────────────────────────
  const target = request?.target;
  if (mode !== 'deploy' && mode !== 'rollback') refuse('request.bad_mode', String(mode));
  if (trigger !== 'automatic' && trigger !== 'manual') refuse('request.bad_trigger', String(trigger));
  if (typeof target !== 'string' || !SHA_RE.test(target)) refuse('request.bad_target', String(target));
  // Automatic runs are always ordinary deployments. A backward move is a decision a
  // person makes; an event cannot make it on their behalf.
  if (trigger === 'automatic' && mode === 'rollback') {
    refuse('request.automatic_rollback', 'rollback is a deliberate, manual act');
  }

  // ── 1. Trusted provenance: is this candidate certified, and by the right thing? ──
  const c = certification ?? {};
  let listed = null;
  if (!c.present) {
    refuse('certification.missing', 'no certifying run was resolved for this target');
  } else {
    if (c.repository !== policy.repository || (c.headRepository !== undefined && c.headRepository !== policy.repository)) {
      refuse('certification.wrong_repository', `${String(c.repository)} / head ${String(c.headRepository)} != ${policy.repository}`);
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
    if (c.conclusion !== 'success') refuse('certification.failed', `conclusion=${String(c.conclusion)}`);
    if (typeof c.headSha !== 'string' || !SHA_RE.test(c.headSha)) {
      refuse('certification.bad_head_sha', String(c.headSha));
    } else if (SHA_RE.test(String(target)) && c.headSha !== target) {
      refuse('certification.wrong_target', `run certified ${c.headSha}, request names ${String(target)}`);
    }
    // Ancestry is necessary and NOT sufficient: an ordinary revert leaves the reverted
    // commit in ancestry for ever, so "is an ancestor of main" can never mean "is a
    // target anybody still wants". Eligibility (section 7) is the explicit half.
    if (c.ancestorOfDefaultBranch !== true) {
      refuse('certification.not_ancestor', `ancestorOfDefaultBranch=${String(c.ancestorOfDefaultBranch)}`);
    }
    if (c.checksTruncated === true) refuse('certification.checks_unreadable', 'the job listing was truncated');
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
        // Anything that is not EXACTLY `success` is refused — `skipped` and `neutral`
        // included, and any conclusion GitHub adds later.
        refuse('certification.check_not_passing', `${required} conclusion=${String(run.conclusion)}`);
      }
    }
    // Freshness. A certification is a statement about a moment. This window is a
    // CONSERVATIVE LIMIT, not a claim that the dependency evidence is fresh: B2 has not
    // supplied a candidate-inventory rescan yet, so nothing here proves an audit.
    const age = hoursBetween(now, c.runStartedAt ?? '');
    if (age === null) {
      refuse('certification.unreadable_time', String(c.runStartedAt));
    } else if (age < 0) {
      refuse('certification.time_in_future', `${age.toFixed(2)}h`);
    } else if (age > policy.freshness.certificationWindowHours) {
      refuse('certification.stale', `${age.toFixed(2)}h > ${policy.freshness.certificationWindowHours}h`);
    }
    // THE ARTIFACT THE RUN UPLOADED, by the API's own listing. Its id is what the gate
    // and the publisher both download by, and its digest is what the download is
    // verified against — so "the candidate" means one immutable upload, not a name.
    const selected = selectCertifiedArtifact(c.artifacts, { runId: c.runId, runAttempt: c.runAttempt });
    if (selected.problem) refuse('certification.artifact_unavailable', selected.problem);
    listed = selected.artifact;
  }

  // ── 2. The artifact: is it the one that run certified, and is it safe? ─────────
  const a = artifact ?? {};
  const manifest = a.manifest;
  const manifestUsable = Boolean(manifest) && a.manifestValid === true;
  if (!a.present) {
    refuse('artifact.missing', 'no artifact was retrieved for the certifying run');
  } else {
    if (a.manifestValid !== true) {
      refuse('artifact.manifest_invalid', (a.manifestProblems ?? []).map((p) => p.code).join(',') || 'unspecified');
    }
    if (a.provenanceValid !== true) {
      refuse('artifact.provenance_invalid', (a.provenanceProblems ?? []).map((p) => p.code).join(',') || 'unspecified');
    }
    if (listed && a.artifactId !== listed.id) {
      refuse('artifact.wrong_artifact', `downloaded ${String(a.artifactId)}, listed ${listed.id}`);
    }
    // The tree digest is compared against the value bound to the certifying run — the
    // provenance record inside that run's own upload, whose bytes the download action
    // verified against the API's digest. Recomputation alone proves nothing.
    if (!DIGEST_RE.test(a.expectedTreeDigest ?? '')) {
      refuse('artifact.no_expected_digest', String(a.expectedTreeDigest));
    } else if (a.observedTreeDigest !== a.expectedTreeDigest) {
      refuse('artifact.digest_mismatch', `${String(a.observedTreeDigest)} != ${a.expectedTreeDigest}`);
    }
    for (const entry of a.unsafeEntries ?? []) refuse('artifact.unsafe_entry', String(entry));
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
      // A re-run is a DIFFERENT certification of the same commit, usually because the
      // previous attempt was wrong.
      if (c.present && manifest.certification?.runAttempt !== String(c.runAttempt)) {
        refuse('artifact.attempt_mismatch', `${String(manifest.certification?.runAttempt)} != ${String(c.runAttempt)}`);
      }
      if (manifest.environment?.apiUrl !== policy.build.expectedApiUrl) {
        refuse('artifact.api_url_mismatch', `${String(manifest.environment?.apiUrl)} != ${policy.build.expectedApiUrl}`);
      }
      if (manifest.environment?.productionFlag !== policy.build.expectedProductionFlag) {
        refuse(
          'artifact.production_flag_mismatch',
          `${String(manifest.environment?.productionFlag)} != ${String(policy.build.expectedProductionFlag)}`,
        );
      }
      const mh = manifest.hosting ?? {};
      if (mh.project !== policy.hosting.project || mh.site !== policy.hosting.site
          || mh.target !== policy.hosting.target || mh.identityPath !== policy.hosting.identityPath) {
        refuse('artifact.destination_mismatch', `${String(mh.project)}/${String(mh.site)}/${String(mh.target)}${String(mh.identityPath)}`);
      }
    }
  }

  // ── 3. The certified commit's SOURCE, as git holds it ─────────────────────────
  // Every manifest field with a source is compared against it. A stamp is code at the
  // certified commit; this comparison is made by the TRUSTED verifier from main.
  const src = source ?? {};
  if (src.present !== true) {
    refuse('source.unreadable', String(src.detail ?? 'the certified commit could not be read from git'));
  } else {
    if (src.commit !== target) refuse('source.wrong_commit', `${String(src.commit)} != ${String(target)}`);
    if (!src.storage || src.storage.present !== true) {
      refuse('storage.declaration_missing', `${policy.storage.declarationPath} is not at ${String(src.commit)}`);
    } else {
      for (const p of src.storage.problems ?? []) refuse('storage.declaration_invalid', `${p.code}: ${p.detail}`);
      for (const stale of src.storage.stale ?? []) refuse('storage.declaration_stale', stale);
    }
    if (manifest) {
      if (manifest.source?.tree !== src.tree) {
        refuse('artifact.source_tree_mismatch', `${String(manifest.source?.tree)} != ${String(src.tree)}`);
      }
      if (manifest.dependencies?.lockDigest !== src.lockDigest) {
        refuse('artifact.lock_mismatch', `${String(manifest.dependencies?.lockDigest)} != ${String(src.lockDigest)}`);
      }
      if (manifest.compatibility?.contracts?.d01CheckoutLimits !== src.d01Digest) {
        refuse('artifact.contract_source_mismatch', `${String(manifest.compatibility?.contracts?.d01CheckoutLimits)} != ${String(src.d01Digest)}`);
      }
      if (src.storage?.present === true
          && manifest.compatibility?.storage?.declarationDigest !== src.storage.digest) {
        refuse('artifact.storage_declaration_mismatch', `${String(manifest.compatibility?.storage?.declarationDigest)} != ${String(src.storage.digest)}`);
      }
      if (!sameValue(manifest.compatibility?.clientConstants, src.constants)) {
        refuse('artifact.constants_mismatch', 'clientConstants differ from the certified source');
      } else if (src.constants && !sameValue(manifest.compatibility?.clientExpects, clientExpectationsFrom(src.constants))) {
        refuse('artifact.constants_mismatch', 'clientExpects is not derived from the certified constants');
      }
      if (!sameValue(manifest.compatibility?.clientSupports?.quote_policy_version, src.supportedQuotePolicyVersions)) {
        refuse('artifact.constants_mismatch', 'clientSupports differs from the certified source');
      }
      if (manifest.environment?.apiUrl !== src.environment?.apiUrl
          || manifest.environment?.productionFlag !== src.environment?.production) {
        refuse('artifact.environment_mismatch', 'the manifest environment is not the certified environment file');
      }
    }
  }

  // ── 4. The hosting configuration the tool will actually use ──────────────────────
  const h = hosting ?? null;
  if (!h || !Array.isArray(h.problems)) {
    refuse('hosting.unevaluated', 'the effective hosting configuration was not established');
  } else {
    for (const p of h.problems) refuse(p.code, String(p.detail));
    if (h.problems.length === 0 && !DIGEST_RE.test(String(h.digest))) {
      refuse('hosting.unevaluated', 'no configuration digest');
    }
  }

  // ── 5. Peers: selection receipts and serving observations ──────────────────────
  if (manifestUsable) {
    reasons.push(...peerReasons({ policy, manifest, peers }));
  }

  // ── 6. Publication prerequisites. Owner actions, named rather than assumed. ─────
  const pre = policy.prerequisites;
  if (pre.sourceProtection.status === 'unrecorded') {
    refuse('prerequisite.source_protection_unrecorded', 'branch protection on the certified branch has not been recorded or disclosed as a limitation');
  }
  if (pre.retention.status !== 'verified') {
    refuse('prerequisite.retention_unverified', 'what Firebase Hosting retains for this site has not been established');
  }
  if (pre.singlePublisher.status !== 'single-publisher') {
    refuse('prerequisite.legacy_publisher_active', `${pre.singlePublisher.legacyWorkflow} still publishes independently`);
  }
  if (trusted?.legacyPublisherPresent !== false) {
    // An OBSERVATION of the trusted checkout, not the policy's statement about it:
    // the policy cannot declare one publisher while a second workflow file exists.
    refuse('prerequisite.legacy_publisher_present',
      trusted?.legacyPublisherPresent === true
        ? `${pre.singlePublisher.legacyWorkflow} exists on the default branch`
        : 'whether a legacy publisher exists was not established');
  }

  // ── 7. Served state, ordering, storage and eligibility ─────────────────────────
  const s = served ?? {};
  const candidateDigest = manifest ? digestOfValue(manifest) : null;
  let ordering = null;
  let baselineStorage = null;

  if (s.state === 'unreadable' || s.state === 'error') {
    // Fail closed. "I could not read what is live" is not "nothing is live".
    refuse('served.unreadable', String(s.detail ?? s.state));
  } else if (s.state === 'absent') {
    // Nothing has ever published an identity file. That is a real state exactly once,
    // and it is an EXPLICITLY AUTHORIZED bootstrap, not a silent pass.
    if (policy.bootstrap.authorized !== true) {
      refuse('served.bootstrap_unauthorized', 'no served identity, and bootstrap is not authorized');
    } else if (mode === 'rollback') {
      refuse('rollback.not_backward', 'nothing is served to roll back from');
    } else {
      ordering = 'promote';
      const b = baseline ?? {};
      if (b.state === 'known' && comparable(b.storage)) baselineStorage = b.storage;
      else if (b.state === 'none') refuse('storage.bootstrap_baseline_missing', 'bootstrap names no served baseline whose storage declaration can be read');
      else refuse('storage.baseline_unreadable', String(b.detail ?? b.state ?? 'no baseline'));
    }
  } else if (s.state === 'known') {
    if (s.cacheControlNoStore !== true) refuse('served.identity_cacheable', String(s.cacheControl));
    const servedStorage = s.manifest?.compatibility?.storage;
    if (!DIGEST_RE.test(String(s.manifestDigest))) refuse('served.unreadable', 'the served identity carries no manifest digest');
    const relation = s.relationToTarget;
    // IDENTITY IS THE CANDIDATE, NOT THE COMMIT. Two certifications of one SHA are two
    // builds with two manifests; "the same commit" is not "already served".
    const sameCandidate = s.servedCommit === target && candidateDigest !== null && s.manifestDigest === candidateDigest;
    if (mode === 'deploy') {
      if (relation === 'identical') {
        if (trigger === 'automatic') {
          if (sameCandidate) ordering = 'skip_identical';
          else refuse('served.same_commit_different_candidate', `served ${String(s.manifestDigest)}, candidate ${String(candidateDigest)}`);
        } else {
          ordering = 'promote';
        }
      } else if (relation === 'ancestor') {
        if (trigger === 'automatic') ordering = 'skip_stale';
        else refuse('rollback.implicit', 'an ordinary deploy may not move backward; use mode=rollback');
      } else if (relation === 'descendant') {
        ordering = 'promote';
      } else if (relation === 'divergent' || relation === 'unknown') {
        refuse('served.divergent', `relationToTarget=${String(relation)}`);
      } else {
        refuse('served.bad_relation', String(relation));
      }
    } else if (mode === 'rollback') {
      if (relation === 'ancestor' || relation === 'identical') ordering = 'promote';
      else refuse('rollback.not_backward', `relationToTarget=${String(relation)}`);
      // WHAT A ROLLBACK NEEDS RETAINED. This path does not ask Firebase to re-promote an
      // old release: it REPUBLISHES the target's certified artifact through the same
      // gate and publisher as any deploy. So the thing that must still exist is that
      // artifact — listed, unexpired and within the certification window — and that is
      // already required of every mode above (certification.artifact_unavailable,
      // certification.stale). Firebase's own release retention is the owner's
      // fallback and is a publication prerequisite, not a property of this target.
    }
    if (ordering === 'promote') {
      if (comparable(servedStorage)) baselineStorage = servedStorage;
      else refuse('storage.baseline_unreadable', 'the served manifest declares no comparable storage');
    }
  } else {
    refuse('served.bad_state', String(s.state));
  }

  if (ordering === 'promote') {
    // THE STORAGE RULE, ON EVERY PROMOTING PATH. The incoming build must read every
    // pair the served build writes or reads. SET CONTAINMENT, never numeric: a larger
    // version is not evidence that its reader preserves an older issued command.
    const candidateStorage = manifest?.compatibility?.storage;
    if (baselineStorage && comparable(candidateStorage)) {
      const missing = unreadableByCandidate({ candidate: candidateStorage, baseline: baselineStorage });
      if (missing.length > 0) {
        refuse('storage.incompatible', `the candidate cannot read ${missing.join(', ')}, which the served build writes or reads`);
      }
      if (candidateStorage.key !== baselineStorage.key || candidateStorage.store !== baselineStorage.store) {
        refuse('storage.incompatible', `the candidate keeps its record at ${candidateStorage.store}:${candidateStorage.key}, the served build at ${baselineStorage.store}:${baselineStorage.key}`);
      }
    }
    // ELIGIBILITY, SEPARATE FROM ANCESTRY. A revoked target stays an ancestor of main
    // for ever; a minimum safe target is the floor below which nothing is promoted.
    const revoked = policy.eligibility.revoked.find((r) => r.commit === target);
    if (revoked) refuse('eligibility.revoked', `${String(target)}: ${revoked.reason}`);
    if (policy.eligibility.minimumSafeTarget !== null) {
      const rel = eligibility?.relationToMinimum;
      if (rel === 'ancestor' || rel === 'divergent') {
        refuse('eligibility.below_minimum_safe_target', `target is ${rel} of ${policy.eligibility.minimumSafeTarget}`);
      } else if (rel !== 'identical' && rel !== 'descendant') {
        refuse('eligibility.relation_unknown', `relationToMinimum=${String(rel)}`);
      }
    }
  }

  if (reasons.length > 0) return { decision: 'REFUSE', allow: false, mode, trigger, reasons };
  if (ordering === 'skip_identical') {
    return { decision: 'SKIP_IDENTICAL', allow: false, mode, trigger, reasons: [reason('ordering.identical', `served ${String(s.servedCommit)} ${String(s.manifestDigest)}`)] };
  }
  if (ordering === 'skip_stale') {
    return { decision: 'SKIP_STALE', allow: false, mode, trigger, reasons: [reason('ordering.stale', `served ${String(s.servedCommit)} is newer`)] };
  }
  if (ordering !== 'promote') {
    // Unreachable with the branches above; stated so a future edit cannot fall through
    // to PROCEED without having decided to promote.
    return { decision: 'REFUSE', allow: false, mode, trigger, reasons: [reason('served.bad_state', 'no ordering decision')] };
  }
  return { decision: 'PROCEED', allow: true, mode, trigger, reasons: [] };
}
