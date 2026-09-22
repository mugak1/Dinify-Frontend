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

import { selectCertifiedArtifact } from './decide.mjs';
import { validateRecord } from './record.mjs';

const reason = (code, detail) => ({ code, detail: String(detail) });

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
  if (f.trusted?.verifierTree !== record.policy.verifierTree || f.trusted?.policyDigest !== record.policy.digest) {
    refuse('preflight.policy_mismatch', `running verifier ${String(f.trusted?.verifierTree)}, admitted ${record.policy.verifierTree}`);
  }
  // A POLICY OR VERIFIER THAT ADVANCED is an explicit restart, never a silent carry-on:
  // the admission was made under rules that are no longer the default branch's rules.
  if (f.current?.state !== 'known') {
    refuse('preflight.policy_unverifiable', 'the default branch\'s release/ tree could not be read');
  } else if (f.current.verifierTree !== record.policy.verifierTree) {
    refuse('preflight.policy_advanced', `release/ on the default branch is now ${String(f.current.verifierTree)}; re-run the publication`);
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
  const expires = Date.parse(record.expiresAt);
  const at = Date.parse(now);
  if (!Number.isFinite(at) || !Number.isFinite(expires) || at > expires) {
    refuse('preflight.certification_stale', `now ${String(now)} is past ${record.expiresAt}`);
  }
  const compare = f.compare?.status;
  if (compare !== 'ahead' && compare !== 'identical') {
    refuse('preflight.target_not_on_main', `compare ${String(record.target.commit)}...${policy.defaultBranch} status=${String(compare)}`);
  }

  // ITS OWN DOWNLOAD.
  const cand = f.candidate ?? {};
  if (cand.present !== true || cand.valid !== true || (cand.unsafe ?? []).length > 0
      || cand.treeDigest !== record.artifact.treeDigest || cand.manifestDigest !== record.artifact.manifestDigest) {
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

  // SERVED STATE AND PEERS, RE-READ INSIDE THE CRITICAL SECTION.
  const served = f.served ?? {};
  const admittedServed = record.served;
  const same = served.state === admittedServed.state
    && (served.state !== 'known'
      || (served.servedCommit === admittedServed.commit && served.manifestDigest === admittedServed.manifestDigest));
  if (!same) {
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
