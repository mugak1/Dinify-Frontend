/**
 * READINESS — is this refusal the recorded waiting state of a deliberately
 * non-publishing evaluation, or something somebody has to look at?
 *
 * WHY THIS EXISTS. Until the cutover, every merge to main runs the gate, and the gate
 * refuses: the owner prerequisites are outstanding, and it names each one. That refusal
 * is CORRECT and it is EXPECTED, and reported as a red run on every merge it reads as a
 * broken release — which is how a real integrity failure ends up ignored among red runs
 * that only meant "still waiting". This module separates the two without touching the
 * decision.
 *
 * THREE FACTS STAY SEPARATE, and nothing here merges them:
 *
 *   evaluation completed correctly     this module's question
 *   release decision                   REFUSE, allow:false — decide.mjs's, UNCHANGED
 *   publication performed              no — nothing here can admit, mint or publish
 *
 * A successful classification never becomes PROCEED, WOULD_PUBLISH, PUBLISHED_VERIFIED
 * or an admitted record. It changes exactly one thing: whether a run whose ONLY
 * refusals are recorded, still-pending commissioning prerequisites is reported as a
 * completed evaluation rather than as a failure.
 *
 * WHEN — ALL of these, or it is not a waiting state:
 *   - an AUTOMATIC `deploy` evaluation. A refusal of a manual deploy or rollback is a
 *     refused attempt somebody made on purpose, and it stays red;
 *   - publication DEMONSTRABLY DISABLED: the enablement variable unset, or exactly
 *     `false`. `true` is an enabled release, whose refusal is a failed release; any
 *     other value is a misconfiguration, never an ordinary disabled state;
 *   - a FULLY PRODUCED decision: readable, REFUSE, allow:false, about this request;
 *   - every refusal reason LISTED in the committed policy's `publication.readiness.
 *     awaiting` AND known to the registry below AND standing in its MATCHING CONTEXT;
 *   - every listed condition whose context stands PRESENT in the decision (a required
 *     check that disappeared is a defect, not good news), and none of them STALE.
 *
 * WHY A CODE ALONE IS NOT ENOUGH. The same code could conceal a different failure if it
 * were ever emitted under other circumstances, so each condition carries two
 * predicates: PENDING, over the committed policy — the reviewed statement that this
 * prerequisite is still outstanding — and OBSERVED, over the evidence this run
 * gathered — that the world looks the way that pending state says it should. A
 * bootstrap refusal counts only while the policy leaves bootstrap unauthorized AND the
 * identity origin answered with a correctly classified no-identity result (404, or the
 * SPA rewrite at 200) at the policy's own identity URL; a network or parser failure is
 * `served.unreadable`, which is never a waiting state.
 *
 * WHAT IS NEVER ACCEPTED: a wildcard (`peers.*`, `prerequisite.*`), an allowlist learned
 * from the result being classified, a list from anywhere but the trusted policy, or a
 * code the registry does not know. An unlisted reason is a finding. A listed reason
 * whose policy says it is resolved is a STALE model — the change that resolved it must
 * update the list in the same reviewed change — and is reported rather than excused.
 *
 * WHAT IT CANNOT SAY. Nothing about the legacy deployment's health (its own runs report
 * that), nothing about whether the site is up, and nothing about whether the candidate
 * WOULD publish once the prerequisites clear — only a later evaluation can say that.
 *
 * Pure: no clock, no filesystem, no network, no environment.
 */

import { digestOfValue } from './canonical.mjs';

export const READINESS_SCHEMA = 'dinify.release.readiness/1';

/** The non-red classification. Its only other value is `not-a-waiting-state`. */
export const AWAITING = 'awaiting-prerequisites';
export const NOT_WAITING = 'not-a-waiting-state';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * THE CONDITIONS A REFUSAL MAY BE WAITING ON — closed, and each tied to its context.
 * Adding one is a reviewed change to this file AND to the policy's list; neither alone
 * accepts anything.
 */
export const WAITING_CONDITIONS = Object.freeze({
  'prerequisite.source_protection_unrecorded': Object.freeze({
    means: 'branch protection on the certified branch has not been recorded (owner action)',
    pending: (policy) => policy.prerequisites.sourceProtection.status === 'unrecorded',
    observed: () => true,
  }),
  'prerequisite.retention_unverified': Object.freeze({
    means: 'what Firebase Hosting retains for this site has not been established (owner action)',
    pending: (policy) => policy.prerequisites.retention.status === 'unverified',
    observed: () => true,
  }),
  // BOTH legacy conditions need the commissioning phase the policy records AND the
  // legacy workflow still present in the trusted checkout. A policy that still says
  // "legacy writer active" about a file that is gone, or one that claims a single
  // publisher beside a file that is still there, is a contradiction, not a wait.
  'prerequisite.legacy_publisher_active': Object.freeze({
    means: 'the legacy workflow still publishes independently; the cutover retires it',
    pending: (policy) => policy.prerequisites.singlePublisher.status === 'legacy-writer-active',
    observed: ({ facts }) => facts?.trusted?.legacyPublisherPresent === true,
  }),
  'prerequisite.legacy_publisher_present': Object.freeze({
    means: 'the legacy workflow file is still on the default branch; the cutover deletes it',
    pending: (policy) => policy.prerequisites.singlePublisher.status === 'legacy-writer-active',
    observed: ({ facts }) => facts?.trusted?.legacyPublisherPresent === true,
  }),
  // "Not implemented yet" — the policy declares NO serving observation for the backend
  // (B3). An implemented observation that failed is peers.backend_serving_unreadable,
  // a different code, and never a wait.
  'peers.backend_serving_unverified': Object.freeze({
    means: 'the backend publishes no served-revision identity yet (B3)',
    pending: (policy) => policy.compatibleSet.peers.backend.serving.observation === 'unavailable',
    observed: ({ peers }) => peers?.serving?.backend === undefined,
  }),
  'served.bootstrap_unauthorized': Object.freeze({
    means: 'nothing has published an identity on this path, and the first publication is not authorized (owner action)',
    pending: (policy) => policy.bootstrap.authorized === false && policy.bootstrap.servedBaseline === null,
    observed: ({ policy, served }) => served?.state === 'absent'
      && served.url === `${policy.hosting.identityOrigin}${policy.hosting.identityPath}`
      && (served.status === 404 || served.status === 200),
  }),
});

export const WAITING_CODES = Object.freeze(Object.keys(WAITING_CONDITIONS).sort());

/**
 * The raw enablement variable, read strictly. GitHub renders an unset repository
 * variable as the empty string; a value that was never READ (undefined) is not that,
 * and a wrapper that forgot to pass it must not be mistaken for "disabled".
 */
export function readEnablement(value) {
  if (value === undefined || value === null) return 'unread';
  if (value === '') return 'disabled-unset';
  if (value === 'false') return 'disabled';
  if (value === 'true') return 'enabled';
  return 'invalid';
}

/** A decision exactly as decide.mjs produces it, or null. */
function readDecision(decision) {
  if (!isObject(decision)) return null;
  const keys = Object.keys(decision).sort().join(',');
  if (keys !== 'allow,decision,mode,reasons,trigger') return null;
  if (typeof decision.decision !== 'string' || typeof decision.allow !== 'boolean') return null;
  if (!Array.isArray(decision.reasons)) return null;
  if (!decision.reasons.every((r) => isObject(r) && typeof r.code === 'string' && r.code.length > 0)) return null;
  return decision;
}

/**
 * @param {object} input
 * @param {object} input.policy       the trusted, VALIDATED policy (the caller validates)
 * @param {object} input.request      {mode, trigger, target}
 * @param {string|undefined} input.enablement  the raw enablement variable
 * @param {unknown} input.decision    decide.mjs's output, as read back from disk
 * @param {object} input.facts        git-facts output
 * @param {object} input.served       serve-state output
 * @param {object} input.peers        peer-facts output
 */
export function classifyReadiness({ policy, request, enablement, decision, facts, served, peers }) {
  const problems = [];
  const problem = (code, detail) => problems.push({ code, detail });
  const enablementState = readEnablement(enablement);
  const d = readDecision(decision);
  const out = {
    schema: READINESS_SCHEMA,
    kind: NOT_WAITING,
    evaluationCompleted: false,
    decision: d?.decision ?? null,
    allow: d?.allow ?? null,
    published: false,
    enablement: enablementState,
    decisionDigest: d ? digestOfValue(d) : null,
    awaiting: [],
    problems,
  };

  if (!d) {
    problem('readiness.decision_unreadable', 'no fully produced decision to classify');
    return out;
  }
  if (d.decision !== 'REFUSE' || d.allow !== false || d.reasons.length === 0) {
    problem('readiness.not_a_refusal', `decision=${String(d.decision)} allow=${String(d.allow)} reasons=${d.reasons.length}`);
    return out;
  }
  if (d.mode !== request?.mode || d.trigger !== request?.trigger) {
    problem('readiness.request_mismatch', `decision ${String(d.mode)}/${String(d.trigger)} is not about request ${String(request?.mode)}/${String(request?.trigger)}`);
    return out;
  }
  // The decision is complete and is about this request: the evaluation itself finished.
  out.evaluationCompleted = true;

  if (request.trigger !== 'automatic' || request.mode !== 'deploy') {
    problem('readiness.deliberate_attempt', `a refused ${request.trigger} ${request.mode} is a refused attempt, not a waiting evaluation`);
  }
  if (enablementState === 'enabled') {
    problem('readiness.publication_enabled', 'publication is enabled, so this refusal is a failed release');
  } else if (enablementState === 'invalid') {
    problem('readiness.enablement_invalid', 'the enablement variable is neither unset, "false" nor "true"');
  } else if (enablementState === 'unread') {
    problem('readiness.enablement_unread', 'the enablement variable was not read');
  }

  const listed = policy?.publication?.readiness?.awaiting;
  if (!Array.isArray(listed)) {
    problem('readiness.no_reviewed_expectation', 'the policy records no awaiting list');
    return out;
  }
  const context = { policy, facts, served, peers };
  const stands = (code) => {
    const c = WAITING_CONDITIONS[code];
    return { pending: c.pending(policy) === true, observed: c.observed(context) === true };
  };

  // EVERY REASON the decision gave must be a listed, known condition in its context.
  const emitted = new Set();
  for (const r of d.reasons) {
    emitted.add(r.code);
    if (!listed.includes(r.code) || !Object.hasOwn(WAITING_CONDITIONS, r.code)) {
      problem('readiness.unexpected_reason', `${r.code}: ${String(r.detail ?? '')}`.trim());
      continue;
    }
    const s = stands(r.code);
    if (!s.pending || !s.observed) {
      problem('readiness.context_mismatch', `${r.code}: pending=${s.pending} observed=${s.observed}`);
      continue;
    }
    out.awaiting.push({ code: r.code, means: WAITING_CONDITIONS[r.code].means, detail: r.detail ?? null });
  }

  // EVERY LISTED CONDITION must still be pending, and present where its context stands.
  for (const code of listed) {
    if (!Object.hasOwn(WAITING_CONDITIONS, code)) {
      problem('readiness.unknown_expectation', code);
      continue;
    }
    const s = stands(code);
    if (!s.pending) {
      problem('readiness.expectation_stale', `${code} is listed as awaited, but the policy records it resolved`);
    } else if (s.observed && !emitted.has(code)) {
      problem('readiness.expected_reason_missing', `${code} stands in the policy and the evidence, and the decision did not give it`);
    }
  }

  if (problems.length === 0) out.kind = AWAITING;
  if (out.kind !== AWAITING) out.awaiting = [];
  return out;
}

/**
 * The record for a refusal that could not even be classified — an invalid trusted
 * policy, or evidence that could not be read back. Never the waiting kind.
 */
export function unclassifiable(code, detail) {
  return {
    schema: READINESS_SCHEMA,
    kind: NOT_WAITING,
    evaluationCompleted: false,
    decision: null,
    allow: null,
    published: false,
    enablement: null,
    decisionDigest: null,
    awaiting: [],
    problems: [{ code, detail }],
  };
}

/**
 * Does a readiness record classify EXACTLY this decision as awaiting? The outcome report
 * asks this rather than trusting a file: the record must be the non-red kind, and bound
 * by digest to the decision the report is about.
 */
export function readinessCovers(readiness, decision) {
  const d = readDecision(decision);
  return isObject(readiness)
    && readiness.schema === READINESS_SCHEMA
    && readiness.kind === AWAITING
    && readiness.evaluationCompleted === true
    && readiness.published === false
    && d !== null
    && d.decision === 'REFUSE'
    && d.allow === false
    && readiness.decisionDigest === digestOfValue(d);
}
