/**
 * THE PUBLISHER'S CRITICAL SECTION — re-establish, immediately before promotion, that
 * the unit about to be published is the unit the gate admitted, and that nothing the
 * admission depended on has moved.
 *
 * WHY THE GATE IS NOT ENOUGH. The gate and the publisher are separate jobs, and time
 * passes between them. In that interval: the certifying run can be re-run (a new
 * attempt is a new certification), its upload can expire, the served release can
 * change (the legacy writer still publishes independently), a peer's served revision
 * can change, the certification can age past its window, and the default branch's
 * policy can advance. Each of those makes the admission stale, and each is refused
 * here by name. The publisher also measures ITS OWN download and regenerates ITS OWN
 * hosting configuration, because what matters is the bytes and the configuration this
 * job is about to hand the tool — not the ones the gate held.
 *
 * WHAT IT DOES NOT CLAIM. This is re-checking, not locking: the served state and a
 * peer's served revision can still change after this function returns and before the
 * tool finishes. Workflow concurrency serialises this path's own runs; it does not
 * serialise the legacy deploy-prod.yml, which is why that is a named prerequisite.
 *
 * Pure: every fact arrives as an argument.
 */

import { canonicalJson } from './canonical.mjs';
import { selectCertifiedArtifact } from './decide.mjs';
import { assessmentTimeReasons } from './dependency-evidence.mjs';
import { validateRecord } from './record.mjs';

const reason = (code, detail) => ({ code, detail: String(detail) });
const same = (a, b) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

/**
 * THE GATE-UPLOADED ARTIFACT a record names — the fresh assessment or the prepared
 * toolchain — as THIS run lists it now: present, unexpired, with the id, name and digest
 * the record carries. Shared by both, so neither can be checked more loosely.
 */
function retainedIn(listing, admitted, runId) {
  if (!Array.isArray(listing)) return 'this run\'s artifacts could not be listed';
  const hit = listing.filter((a) => a?.id === admitted.id);
  if (hit.length !== 1) return `artifact ${String(admitted.id)} is not listed for run ${String(runId)}`;
  const a = hit[0];
  if (a.expired === true) return `${a.name} has expired`;
  if (a.name !== admitted.name || a.digest !== admitted.digest || String(a.workflowRunId) !== String(runId)) {
    return `listed ${String(a.name)} ${String(a.digest)} in run ${String(a.workflowRunId)}, admitted ${admitted.name} ${admitted.digest}`;
  }
  return null;
}

/**
 * The PUBLISHER'S OWN measurements of the toolchain and the fresh assessment, judged
 * against the record. Shared by the preflight and the publish command's last-boundary
 * recheck, which run the same checks at two moments with the same code.
 *
 * @param {object} input
 * @param {object} input.record
 * @param {object} input.policy
 * @param {object} input.tooling      {treeDigest, entryCount, unsafe, entrypointSha256, runtime}
 * @param {object} input.assessment   inspectAssessment() of this job's own download
 * @param {string} input.now
 * @param {string} input.prefix       'preflight' | 'publisher'
 */
export function dependencyBoundaryReasons({ record, policy, tooling, assessment, now, prefix }) {
  const reasons = [];
  const refuse = (code, detail) => reasons.push(reason(`${prefix}.${code}`, detail));
  const pub = record.publisher;
  const t = tooling ?? {};
  if ((t.unsafe ?? []).length > 0 || t.treeDigest !== pub.treeDigest || t.entryCount !== pub.entryCount
      || t.entrypointSha256 !== pub.entrypoint.sha256) {
    refuse('tooling_mismatch', `toolchain ${String(t.treeDigest)} (${String(t.entryCount)} files) entrypoint ${String(t.entrypointSha256)}${(t.unsafe ?? []).length ? ` unsafe ${t.unsafe.slice(0, 5).join(', ')}` : ''}; admitted ${pub.treeDigest} (${pub.entryCount}) ${pub.entrypoint.sha256}`);
  }
  if (t.runtime !== pub.node || pub.node !== `v${policy.publisher.node}`) {
    refuse('runtime_mismatch', `running ${String(t.runtime)}; admitted ${pub.node}, policy v${policy.publisher.node}`);
  }
  const admitted = record.dependencies.assessment;
  const a = assessment ?? {};
  if (a.state !== 'present' || (a.problems ?? []).length > 0 || a.digest !== admitted.digest || a.treeDigest !== admitted.treeDigest) {
    refuse('assessment_mismatch', `assessment ${String(a.digest)} ${(a.problems ?? []).map((p) => p.code).join(',')}; admitted ${admitted.digest}`);
    return reasons;
  }
  reasons.push(...assessmentTimeReasons({ assessment: a.doc, policy, now, prefix }));
  return reasons;
}

/**
 * THE CERTIFICATION WINDOW, measured from the admitted certification's start under the
 * verifier's policy. Named on its own: the record's `expiresAt` is the EARLIEST of this
 * and the fresh assessment's window, and refusing on that alone would call a lapsed
 * assessment a stale certification. The assessment's window is assessmentTimeReasons'.
 */
export function certificationWindowReasons({ record, policy, now, prefix }) {
  const started = Date.parse(String(record.certification?.runStartedAt ?? ''));
  const at = Date.parse(String(now));
  const end = started + policy.freshness.certificationWindowHours * 3_600_000;
  if (!Number.isFinite(at) || !Number.isFinite(started) || at > end) {
    return [reason(`${prefix}.certification_stale`, `now ${String(now)} is past ${Number.isFinite(end) ? new Date(end).toISOString() : 'an unreadable certification start'}`)];
  }
  return [];
}

/**
 * @param {object} input
 * @param {object} input.record      the admitted record (already digest-verified)
 * @param {object} input.policy      the policy from the verifier checkout at record.policy.revision
 * @param {object} input.facts       what this job observed:
 *   trusted   {verifierTree, policyDigest}          the verifier checkout it is running
 *   current   {state:'known'|'unreadable', verifierTree}   the default branch now
 *   run       {present, conclusion, headSha, runAttempt}    the certifying run now
 *   artifacts [...listing]                           the run's artifacts now
 *   candidate {present, treeDigest, manifestDigest, unsafe:[], valid}   its own download
 *   compare   {status}                               target...default branch, per the API
 *   served    serve-state output for this site
 *   adminServed {state, commit}
 *   hosting   {problems, digest}                     regenerated from the certified commit
 *   certifiedCheckout {head}                         the commit the configuration was read at
 * @param {string} input.now
 */
export function preflightReasons({ record, policy, facts, now }) {
  const reasons = [];
  const refuse = (code, detail) => reasons.push(reason(code, detail));
  for (const p of validateRecord(record)) refuse(p.code, p.detail);
  if (reasons.length > 0) return reasons;
  const f = facts ?? {};

  // THE VERIFIER AND POLICY ARE PINNED TO THE ADMITTING REVISION.
  if (!same(f.trusted?.verifierTree, record.policy.verifierTree) || f.trusted?.policyDigest !== record.policy.digest) {
    refuse('preflight.policy_mismatch', `running verifier ${canonicalJson(f.trusted?.verifierTree ?? null)}, admitted ${canonicalJson(record.policy.verifierTree)}`);
  }
  // A POLICY OR VERIFIER THAT ADVANCED is an explicit restart, never a silent carry-on:
  // the admission was made under rules that are no longer the default branch's rules.
  if (f.current?.state !== 'known') {
    refuse('preflight.policy_unverifiable', 'the default branch\'s release/ and dependency-audit/ trees could not be read');
  } else if (!same(f.current.verifierTree, record.policy.verifierTree)) {
    // The dependency-audit policy and scanner are part of the verifier: a gate admitted
    // under one audit policy is not re-used under another.
    refuse('preflight.policy_advanced', `release/ + dependency-audit/ on the default branch are now ${canonicalJson(f.current.verifierTree)}; re-run the publication`);
  }

  // THE CERTIFICATION, AS IT STANDS NOW.
  const run = f.run ?? {};
  if (run.present !== true || run.conclusion !== 'success' || run.headSha !== record.target.commit) {
    refuse('preflight.certification_changed', `run ${String(record.certification.runId)} conclusion=${String(run.conclusion)} head=${String(run.headSha)}`);
  }
  if (String(run.runAttempt) !== String(record.certification.runAttempt)) {
    refuse('preflight.attempt_changed', `attempt ${String(run.runAttempt)} != admitted ${record.certification.runAttempt}`);
  }
  const selected = selectCertifiedArtifact(f.artifacts, {
    runId: record.certification.runId, runAttempt: record.certification.runAttempt,
  });
  if (selected.problem) {
    refuse('preflight.artifact_unavailable', selected.problem);
  } else if (selected.artifact.id !== record.artifact.id || selected.artifact.digest !== record.artifact.digest) {
    refuse('preflight.artifact_replaced', `listed ${selected.artifact.id} ${selected.artifact.digest}, admitted ${record.artifact.id} ${record.artifact.digest}`);
  }
  reasons.push(...certificationWindowReasons({ record, policy, now, prefix: 'preflight' }));
  const compare = f.compare?.status;
  if (compare !== 'ahead' && compare !== 'identical') {
    refuse('preflight.target_not_on_main', `compare ${String(record.target.commit)}...${policy.defaultBranch} status=${String(compare)}`);
  }

  // ITS OWN DOWNLOAD.
  const cand = f.candidate ?? {};
  if (cand.present !== true || cand.valid !== true || (cand.unsafe ?? []).length > 0
      || cand.treeDigest !== record.artifact.treeDigest || cand.manifestDigest !== record.artifact.manifestDigest
      || cand.evidenceRecordDigest !== record.dependencies.evidence.recordDigest
      || cand.evidenceTreeDigest !== record.dependencies.evidence.treeDigest) {
    refuse('preflight.candidate_mismatch', `tree ${String(cand.treeDigest)} manifest ${String(cand.manifestDigest)}${(cand.unsafe ?? []).length ? ` unsafe ${cand.unsafe.join(',')}` : ''}`);
  }

  // ITS OWN HOSTING CONFIGURATION, regenerated from the certified commit — and read at
  // THAT commit. A configuration identical in content but read somewhere else would pass
  // the digest; the checkout it came from is part of what was admitted.
  if (f.certifiedCheckout?.head !== record.target.commit) {
    refuse('preflight.hosting_mismatch', `configuration read at ${String(f.certifiedCheckout?.head)}, admitted ${record.target.commit}`);
  }
  const hosting = f.hosting ?? {};
  if (!Array.isArray(hosting.problems) || hosting.problems.length > 0 || hosting.digest !== record.hosting.configDigest) {
    refuse('preflight.hosting_mismatch', `${String(hosting.digest)} != admitted ${record.hosting.configDigest}${(hosting.problems ?? []).map((p) => ` ${p.code}`).join('')}`);
  }

  // THE FRESH ASSESSMENT AND THE TOOLCHAIN — both made by THIS run's gate, re-established
  // from this job's own downloads. A re-run of this job alone would carry an assessment
  // made by an earlier attempt: a repeat re-assesses, so it is refused.
  const evaluation = f.evaluation ?? {};
  const admittedAssessment = record.dependencies.assessment;
  if (admittedAssessment.runId !== String(evaluation.runId) || admittedAssessment.runAttempt !== String(evaluation.runAttempt)) {
    refuse('preflight.assessment_not_current', `assessed in run ${admittedAssessment.runId}.${admittedAssessment.runAttempt}, this is ${String(evaluation.runId)}.${String(evaluation.runAttempt)}; re-run the whole publication`);
  }
  const assessmentListed = retainedIn(f.evaluationArtifacts, admittedAssessment.artifact, admittedAssessment.runId);
  if (assessmentListed) refuse('preflight.assessment_replaced', assessmentListed);
  const toolingListed = retainedIn(f.evaluationArtifacts, record.publisher.artifact, admittedAssessment.runId);
  if (toolingListed) refuse('preflight.tooling_replaced', toolingListed);
  reasons.push(...dependencyBoundaryReasons({ record, policy, tooling: f.tooling, assessment: f.assessment, now, prefix: 'preflight' }));

  // SERVED STATE AND PEERS, RE-READ INSIDE THE CRITICAL SECTION.
  const served = f.served ?? {};
  const admittedServed = record.served;
  const servedSame = served.state === admittedServed.state
    && (served.state !== 'known'
      || (served.servedCommit === admittedServed.commit && served.manifestDigest === admittedServed.manifestDigest));
  if (!servedSame) {
    refuse('preflight.served_changed', `now ${String(served.state)} ${String(served.servedCommit ?? '')} ${String(served.manifestDigest ?? '')}; admitted ${String(admittedServed.state)} ${String(admittedServed.commit ?? '')}`);
  }
  if (policy.compatibleSet.peers.admin.serving.observation === 'public-identity') {
    const admin = f.adminServed ?? {};
    if (admin.state !== 'known' || admin.commit !== record.peers.adminServed) {
      refuse('preflight.peer_changed', `admin now ${String(admin.state)} ${String(admin.commit ?? '')}; admitted ${String(record.peers.adminServed)}`);
    }
  }
  return reasons;
}
