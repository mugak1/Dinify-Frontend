/**
 * WHAT HAPPENED, stated as what it is.
 *
 * A publication has stages that can each end differently, and collapsing them is how
 * a run reports success for something that did not happen. So the outcome is one of a
 * closed set, and every run's summary names the stage it stopped at:
 *
 *   REFUSED              the gate refused; nothing was admitted
 *   SKIPPED_IDENTICAL    exactly this candidate is already served
 *   SKIPPED_STALE        an older automatic candidate; a newer one is served
 *   PREFLIGHT_REFUSED    admitted, then refused inside the critical section
 *   WOULD_PUBLISH        admitted and re-checked; publication is not enabled
 *   PUBLICATION_FAILED   the tool failed and the origin does not serve the candidate
 *   PUBLISHED_VERIFIED   the origin serves this candidate's identity, and every
 *                        certified file fetched back from it matched, at one moment
 *                        from one vantage point
 *   PUBLISHED_DEGRADED   something was published and the verification could not
 *                        establish that it is exactly this candidate — including the
 *                        tool reporting failure while the origin serves the candidate
 *
 * RESTORED_AFTER_FAILURE IS NEVER PRODUCED. Nothing here restores anything after a
 * failed publication; a restore is a manual rollback, which is its own run with its
 * own decision. The word is listed so its absence is a statement, not an oversight.
 *
 * Pure.
 */

export const OUTCOMES = Object.freeze([
  'REFUSED', 'SKIPPED_IDENTICAL', 'SKIPPED_STALE', 'PREFLIGHT_REFUSED', 'WOULD_PUBLISH',
  'PUBLICATION_FAILED', 'PUBLISHED_VERIFIED', 'PUBLISHED_DEGRADED',
]);

/** Outcomes that must turn the run red. A skip and a would-publish are uneventful. */
export const FAILING_OUTCOMES = Object.freeze(new Set([
  'REFUSED', 'PREFLIGHT_REFUSED', 'PUBLICATION_FAILED', 'PUBLISHED_DEGRADED',
]));

/**
 * Classify a post-publication observation against the admitted record.
 *
 * `observed` is {identity: {state, commit, manifestDigest}, files: {checked, mismatched:[], unreachable:[]}}.
 * The IDENTITY FILE ALONE PROVES NOTHING ABOUT THE OTHER FILES: it is one file among
 * the upload. So every certified file is fetched back and compared, and even then the
 * claim is bounded — one fetch, one vantage point, one moment.
 */
export function classifyVerification(record, observed) {
  const identity = observed?.identity ?? {};
  const files = observed?.files ?? {};
  const servesCandidate = identity.state === 'known'
    && identity.commit === record.target.commit
    && identity.manifestDigest === record.artifact.manifestDigest;
  const filesMatch = Number.isInteger(files.checked)
    && files.checked === record.artifact.entryCount
    && (files.mismatched ?? []).length === 0
    && (files.unreachable ?? []).length === 0;
  return { servesCandidate, filesMatch, verified: servesCandidate && filesMatch };
}

/**
 * @param {object} input
 * @param {string} input.decision            the gate's decision
 * @param {boolean|null} input.preflightOk    null when preflight did not run
 * @param {boolean} input.enabled
 * @param {string} input.publishStep         'success' | 'failure' | 'skipped' | 'cancelled'
 * @param {object|null} input.verification    classifyVerification() result, when it ran
 */
export function summarizeOutcome({ decision, preflightOk, enabled, publishStep, verification }) {
  if (decision === 'SKIP_IDENTICAL') return 'SKIPPED_IDENTICAL';
  if (decision === 'SKIP_STALE') return 'SKIPPED_STALE';
  if (decision !== 'PROCEED') return 'REFUSED';
  if (preflightOk !== true) return 'PREFLIGHT_REFUSED';
  if (enabled !== true) return 'WOULD_PUBLISH';
  if (publishStep !== 'success') {
    return verification?.servesCandidate === true ? 'PUBLISHED_DEGRADED' : 'PUBLICATION_FAILED';
  }
  return verification?.verified === true ? 'PUBLISHED_VERIFIED' : 'PUBLISHED_DEGRADED';
}
