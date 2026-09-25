/**
 * WHAT HAPPENED, stated as what it is.
 *
 * A publication has stages that can each end differently, and collapsing them is how
 * a run reports success for something that did not happen. So the outcome is one of a
 * closed set, and every run's summary names the stage it stopped at:
 *
 *   REFUSED              the gate refused; nothing was admitted
 *   PENDING_PREREQUISITES
 *                        the gate refused, and the refusal is EXACTLY the recorded,
 *                        still-pending commissioning prerequisites of an automatic
 *                        evaluation with publication disabled (lib/readiness.mjs).
 *                        The evaluation completed; the decision is still REFUSE,
 *                        nothing was admitted and nothing was published. It is a
 *                        separate word so a green run can never be read as
 *                        "published", "would publish" or "admitted"
 *   SKIPPED_IDENTICAL    exactly this candidate is already served
 *   SKIPPED_STALE        an older automatic candidate; a newer one is served
 *   PREFLIGHT_REFUSED    admitted, then refused inside the critical section — or at
 *                        the LAST BOUNDARY, by the publish command itself, before it
 *                        read the credential or ran the tool (the fresh assessment
 *                        aged out, an applied exception lapsed, or the toolchain in
 *                        hand is not the admitted one). The tool never ran, so this is
 *                        not a failed publication and is never reported as one
 *   WOULD_PUBLISH        admitted and re-checked; publication is not enabled
 *   PUBLICATION_FAILED   the tool failed and the origin does not serve the candidate
 *   PUBLISHED_VERIFIED   the origin serves this candidate's identity, `no-store`, and
 *                        every certified file fetched back from it matched, at one
 *                        moment from one vantage point
 *   PUBLISHED_DEGRADED   something was published and the verification could not
 *                        establish that it is exactly this candidate, served the way
 *                        the next decision requires — including the tool reporting
 *                        failure while the origin serves the candidate
 *
 * RESTORED_AFTER_FAILURE IS NEVER PRODUCED. Nothing here restores anything after a
 * failed publication; a restore is a manual rollback, which is its own run with its
 * own decision. The word is listed so its absence is a statement, not an oversight.
 *
 * Pure.
 */

export const OUTCOMES = Object.freeze([
  'REFUSED', 'PENDING_PREREQUISITES', 'SKIPPED_IDENTICAL', 'SKIPPED_STALE', 'PREFLIGHT_REFUSED', 'WOULD_PUBLISH',
  'PUBLICATION_FAILED', 'PUBLISHED_VERIFIED', 'PUBLISHED_DEGRADED',
]);

/** Outcomes that must turn the run red. A skip, a would-publish and a recorded wait
 *  are uneventful — and none of the three published anything. */
export const FAILING_OUTCOMES = Object.freeze(new Set([
  'REFUSED', 'PREFLIGHT_REFUSED', 'PUBLICATION_FAILED', 'PUBLISHED_DEGRADED',
]));

/**
 * Classify a post-publication observation against the admitted record.
 *
 * `observed` is {identity: {state, commit, manifestDigest, cacheControl, cacheControlNoStore},
 * files: {checked, mismatched:[], unreachable:[]}}.
 * The IDENTITY FILE ALONE PROVES NOTHING ABOUT THE OTHER FILES: it is one file among
 * the upload. So every certified file is fetched back and compared, and even then the
 * claim is bounded — one fetch, one vantage point, one moment.
 *
 * AND THE IDENTITY MUST BE SERVED `no-store` (Codex P2 on #687). That is the one fact
 * about this publication the NEXT decision depends on: it refuses a cacheable identity
 * in every mode, rollback included. A publication that leaves the path unable to decide
 * again is not "verified", whatever its bytes are. The gate refuses such a configuration
 * before publishing (hosting.identity_cacheable); this is the observation that the host
 * actually did what the configuration said.
 */
export function classifyVerification(record, observed) {
  const identity = observed?.identity ?? {};
  const files = observed?.files ?? {};
  const servesCandidate = identity.state === 'known'
    && identity.commit === record.target.commit
    && identity.manifestDigest === record.artifact.manifestDigest;
  const identityNoStore = identity.cacheControlNoStore === true;
  const filesMatch = Number.isInteger(files.checked)
    && files.checked === record.artifact.entryCount
    && (files.mismatched ?? []).length === 0
    && (files.unreachable ?? []).length === 0;
  return { servesCandidate, identityNoStore, filesMatch, verified: servesCandidate && identityNoStore && filesMatch };
}

/**
 * @param {object} input
 * @param {string} input.decision            the gate's decision
 * @param {boolean} [input.awaiting]          lib/readiness.mjs classified THIS refusal
 *                                            as the recorded waiting state (readinessCovers)
 * @param {boolean|null} input.preflightOk    null when preflight did not run
 * @param {boolean} input.enabled
 * @param {string} input.publishStep         'success' | 'failure' | 'skipped' | 'cancelled'
 * @param {boolean} [input.boundaryRefused]   the publish command refused at its last
 *                                            boundary and ran no tool (strictly `true`)
 * @param {object|null} input.verification    classifyVerification() result, when it ran
 */
export function summarizeOutcome({ decision, awaiting = false, preflightOk, enabled, publishStep, boundaryRefused = false, verification }) {
  if (decision === 'SKIP_IDENTICAL') return 'SKIPPED_IDENTICAL';
  if (decision === 'SKIP_STALE') return 'SKIPPED_STALE';
  // ONLY a refusal can be a recorded wait; anything else ignores the flag outright.
  if (decision === 'REFUSE' && awaiting === true) return 'PENDING_PREREQUISITES';
  if (decision !== 'PROCEED') return 'REFUSED';
  if (preflightOk !== true) return 'PREFLIGHT_REFUSED';
  if (enabled !== true) return 'WOULD_PUBLISH';
  if (publishStep !== 'success') {
    // Whatever the publish command SAYS, an origin serving the candidate is a publication
    // this run cannot vouch for — so the observation is asked first.
    if (verification?.servesCandidate === true) return 'PUBLISHED_DEGRADED';
    return boundaryRefused === true ? 'PREFLIGHT_REFUSED' : 'PUBLICATION_FAILED';
  }
  return verification?.verified === true ? 'PUBLISHED_VERIFIED' : 'PUBLISHED_DEGRADED';
}
