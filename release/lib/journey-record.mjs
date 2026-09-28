/**
 * JOURNEY RECORD: the retained evidence of one cross-application journey run, and the
 * rules that decide whether it is truthful and whether it is complete enough to count as
 * a certified journey gate (D16 / D08 B4, component B1).
 *
 * THIS IS A COMPONENT INTERFACE, NOT A RELEASE DECISION. Nothing here reads a record out
 * of a workflow, changes `decide`, readiness or publication, or states production
 * readiness, runtime identity or cutover. A record that passes certified acceptance says:
 * the named scenarios and controls of a REVIEWED contract all passed, with cleanup, in ONE
 * producer run, against exactly the inputs the caller independently expected.
 *
 * WHAT THE RECORD BINDS
 *   contract   the contract the producer ran, by id, revision and digest
 *   producer   CI or local; for CI the workflow, run, attempt, event and ref; always the
 *              checkout actually tested, and whether that was a push commit, a
 *              synthetic merge or a branch head (a pull-request run tests a merge
 *              preview, not the branch head and not what lands on main)
 *   inputs     the Frontend and both peers (downloaded candidate or local build; for a
 *              candidate its listed and measured digests; whether it was EXECUTED), the
 *              harness source, the toolchain and browser, and the test-host profile
 *   outcomes   one entry per named scenario or control, each with its own window, the
 *              producer run it belongs to, and the KIND of every observation behind it
 *   cleanup    whether teardown completed, and when
 *
 * EVIDENCE KINDS are kept apart, per observation:
 *   source               source or a model; nothing executed
 *   synthetic            a response or fixture the harness made; never a server answer
 *   local-build          a build made locally at a commit; it does NOT inherit the
 *                        candidate's identity, even at the same commit
 *   candidate-execution  the downloaded certified bytes were EXECUTED (downloaded alone is
 *                        not executed)
 *   ci                   actual CI execution
 *   live                 a deployed origin, where separately established; B4 allows none
 *
 * TRUTHFUL IS NOT CERTIFIED. A local or partial record can be perfectly truthful and
 * still fail certified acceptance, and that is the expected answer for one. What a record
 * must cover comes from the CONTRACT the caller supplies (the reviewed B4_MINIMUM_CONTRACT
 * or a stricter one), never from the record's own declaration: a record that omits J2
 * and J4 from its own contract and from its outcomes has not narrowed anything, it has
 * failed to cover them.
 *
 * DATA IS MINIMAL. No cookie, token, OTP, claim or QR credential, private key or peer
 * inventory belongs in a record. The schema is strict (an unknown key is refused), and
 * there is NO free-text field: every string is a SHA, a digest, a numeric id, a word from
 * a fixed vocabulary, a lowercase slug, a version number, an artifact name in its
 * producer's own grammar, or a CI ref. Evidence references in particular are identifiers
 * (a digest, or a job, step or artifact id), never text. Key names and values that look
 * like secrets are refused by name as well, as a second guard. A test-host profile digest
 * identifies the configuration used; it is not a verified live-host identity.
 *
 * PEER SELECTION IS BOUND BY DIGEST. A downloaded peer's `descriptorDigest` is the digest
 * of the bytes-level descriptor journey-peers returned for it (`peerDescriptorDigest`
 * there); certified acceptance refuses a downloaded peer without one, and a local build
 * may not carry one.
 *
 * Pure. No clock, filesystem, network or environment.
 */

import { canonicalJson, digestOfValue } from './canonical.mjs';

export const RECORD_SCHEMA = 'dinify.journey.record/1';
export const CONTRACT_SCHEMA = 'dinify.journey.contract/1';

export const EVIDENCE_KINDS = Object.freeze(['source', 'synthetic', 'local-build', 'candidate-execution', 'ci', 'live']);
export const OUTCOME_KINDS = Object.freeze(['scenario', 'control', 'positive-control', 'negative-control', 'egress-check']);
export const RESULTS = Object.freeze(['passed', 'failed', 'skipped', 'error']);
export const CHECKOUT_KINDS = Object.freeze(['push-commit', 'synthetic-merge', 'branch-head', 'local-worktree']);
export const INPUT_KINDS = Object.freeze(['downloaded-candidate', 'local-build']);
export const EXECUTION_STATES = Object.freeze(['executed', 'downloaded-not-executed', 'not-executed']);
/**
 * What an outcome's evidence must include, per the contract:
 *   server             a candidate was executed (`candidate-execution`); no synthetic evidence
 *   synthetic-allowed  a candidate was executed, and a named synthetic response may stand
 *                      beside it (one approved scenario in the B4 minimum, and only there)
 *   environment        actual execution of the check itself (`ci`); no synthetic evidence.
 *                      For the isolation and transport checks, which examine the harness
 *                      environment rather than a candidate's behaviour.
 */
export const EVIDENCE_REQUIREMENTS = Object.freeze(['server', 'synthetic-allowed', 'environment']);

export const FRONTEND_REPOSITORY = 'mugak1/Dinify-Frontend';
const PEER_REPOSITORIES = Object.freeze({ admin: 'mugak1/Dinify-Admin', backend: 'mugak1/Dinify-Backend' });

export const LIMITS = Object.freeze({
  maxRecordBytes: 256 * 1024,
  maxContractBytes: 64 * 1024,
  maxOutcomes: 200,
  maxEvidencePerOutcome: 16,
  maxDepth: 8,
});

const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const ID_RE = /^[1-9][0-9]{0,19}$/;
const ATTEMPT_RE = /^[1-9][0-9]{0,3}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const OUTCOME_ID_RE = /^(?=.{4,80}$)J[0-9]\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const JOURNEY_RE = /^J[0-9]$/;
const SLUG_RE = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_RE = /^v?[0-9]{1,6}(?:\.[0-9]{1,6}){0,3}$/;
const CI_REF_RE = /^refs\/(?:heads\/[A-Za-z0-9._/-]{1,100}|pull\/[1-9][0-9]{0,9}\/(?:merge|head))$/;
const BROWSERS = Object.freeze(['chromium', 'chrome', 'firefox', 'webkit']);

/**
 * EVIDENCE REFERENCES ARE IDENTIFIERS, NEVER TEXT. A reference names a retained file by
 * its digest, or a CI job, step or artifact by its numeric id, and nothing else can be
 * spelled: a free-form reference is exactly where a credential would be pasted. The
 * numeric ids are seven digits or more, as GitHub's job and artifact ids are, which also
 * keeps a four- or six-digit verification code out of the id slot. Which schemes each
 * evidence kind may use is fixed: CI evidence names a job or a step, synthetic evidence the
 * digest of its fixture, candidate execution a trace digest, a step or an artifact.
 */
const REF_SCHEMES = Object.freeze({
  sha256: /^sha256:[0-9a-f]{64}$/,
  job: /^job:[1-9][0-9]{6,19}$/,
  step: /^step:[1-9][0-9]{6,19}\/[1-9][0-9]{0,2}$/,
  artifact: /^artifact:[1-9][0-9]{6,19}$/,
});
const REF_SCHEMES_BY_KIND = Object.freeze({
  source: Object.freeze(['sha256']),
  synthetic: Object.freeze(['sha256']),
  'local-build': Object.freeze(['sha256']),
  'candidate-execution': Object.freeze(['sha256', 'step', 'artifact']),
  ci: Object.freeze(['job', 'step']),
  live: Object.freeze(['sha256']),
});
const refAllowed = (kind, ref) => typeof ref === 'string' && (REF_SCHEMES_BY_KIND[kind] ?? []).some((scheme) => REF_SCHEMES[scheme].test(ref));

/** Each artifact slot carries its own producer's name, `<prefix>-<run>-<attempt>`, only. */
const ARTIFACT_PREFIXES = Object.freeze({ frontend: 'frontend-release', admin: 'admin-candidate', backend: 'backend-candidate' });
const artifactNameRe = (prefix) => new RegExp(`^${prefix}-[1-9][0-9]{0,19}-[1-9][0-9]{0,3}$`);

/** Key names that never belong in a retained record, whatever their value. */
const SENSITIVE_KEY_RE = /(cookie|token|otp|passw|secret|credential|private.?key|authorization|bearer|claim.?code|csrf|session.?id|api.?key)/i;
/** Values that look like a bearer credential or key material, wherever they appear. */
const SENSITIVE_VALUE_RES = Object.freeze([
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./, // a JWT
  /-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)-----/,
  /\bBearer\s+\S/i,
  /__Host-[A-Za-z0-9_]+=/,
]);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => isObject(o) && Object.prototype.hasOwnProperty.call(o, k);
const exactKeys = (o, keys) => isObject(o) && Object.keys(o).length === keys.length && keys.every((k) => own(o, k));
const isoMs = (v) => (typeof v === 'string' && ISO_RE.test(v) ? Date.parse(v) : NaN);
const same = (a, b) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

// ── the reviewed B4 minimum ─────────────────────────────────────────────────────

const o = (id, kind, evidence = 'server') => Object.freeze({ id, journey: id.slice(0, 2), kind, evidence });

/**
 * THE REVIEWED MINIMUM a record must cover to count as the full B4 journey gate. A
 * supplied contract may add outcomes; it may not drop one, relax an evidence requirement,
 * or allow synthetic evidence anywhere this one does not. Changing it is a reviewed
 * change: the tests pin its digest.
 */
export const B4_MINIMUM_CONTRACT = Object.freeze({
  schema: CONTRACT_SCHEMA,
  id: 'd08-b4-journeys',
  revision: 1,
  journeys: Object.freeze(['J0', 'J1', 'J2', 'J3', 'J4']),
  outcomes: Object.freeze([
    // J0 — egress and transport, each with a positive control before any journey runs.
    o('J0.egress.browser-origins-denied', 'egress-check', 'environment'),
    o('J0.egress.redirect-hop-denied', 'egress-check', 'environment'),
    o('J0.egress.workers-and-service-workers-denied', 'egress-check', 'environment'),
    o('J0.egress.ipv4-ipv6-and-proxy-denied', 'egress-check', 'environment'),
    o('J0.egress.node-client-denied', 'egress-check', 'environment'),
    o('J0.egress.backend-delivery-denied', 'egress-check', 'environment'),
    o('J0.transport.tls-names-verified', 'control', 'environment'),
    o('J0.positive.allowed-origins-reachable', 'positive-control', 'environment'),
    // J1 — diner to kitchen to completion and history, through the optimized UIs.
    o('J1.diner.scan-menu-configure', 'scenario'),
    o('J1.diner.server-price-exact', 'scenario'),
    o('J1.diner.plain-confirmation-accepts-once', 'scenario'),
    o('J1.kitchen.ui-consumes-order', 'scenario'),
    o('J1.kitchen.revision-to-completion', 'scenario'),
    o('J1.history.saved-name-provenance', 'scenario'),
    o('J1.control.negative-quantity-refused-api', 'control'),
    o('J1.control.foreign-scope-refused-api', 'control'),
    o('J1.control.stale-revision-refused-api', 'control'),
    o('J1.positive.quantity-one-accepted-api', 'positive-control'),
    o('J1.negative.cors-excluded-detected', 'negative-control'),
    // J2 — uncertain acceptance and the closed quote.
    o('J2.accept.lost-response-recovered-without-resend', 'scenario'),
    o('J2.accept.draft-command-resent-immutably', 'scenario'),
    o('J2.quote.closed-quote-successor-review', 'scenario'),
    o('J2.confirm.plain-equivalent-purchase', 'scenario'),
    o('J2.confirm.detailed-changed-purchase', 'scenario'),
    // J3 — billing truthfulness; the preview KPIs and real Reviews stay as they are.
    o('J3.billing.canonical-terms', 'scenario'),
    o('J3.billing.absent-terms', 'scenario'),
    o('J3.billing.unreadable-terms', 'scenario', 'synthetic-allowed'),
    o('J3.billing.no-lookup-otp-or-collector-request', 'control'),
    o('J3.billing.collector-501-external-api-probe', 'control'),
    o('J3.billing.foreign-and-missing-404-external-api-probe', 'control'),
    o('J3.dashboard.preview-kpis-and-real-reviews', 'scenario'),
    // J4 — Admin, and delegated QR withholding over the existing Backend interface.
    o('J4.admin.bootstrap-password-totp-cookies-csrf', 'scenario'),
    o('J4.admin.scoped-read', 'scenario'),
    o('J4.admin.guarded-write-confirmed-by-server', 'scenario'),
    o('J4.admin.d10-owner-refusals', 'control'),
    o('J4.admin.rotated-session-request-refused-without-mutation', 'control'),
    o('J4.admin.boundary-discards-predecessor-state', 'scenario'),
    o('J4.delegation.delegated-read-withholds-qr', 'scenario'),
    o('J4.positive.owner-read-carries-qr', 'positive-control'),
  ]),
  negativeControl: 'J1.negative.cors-excluded-detected',
  cleanup: 'required',
  allowedEvidence: Object.freeze(['candidate-execution', 'ci', 'source', 'synthetic']),
  // Checked at their actual layers, and never in a journey record. Named so their
  // absence here is a statement, not an omission.
  notInJourneys: Object.freeze([
    Object.freeze({ id: 'J2.confirm.unknown-estimate-comparison', layer: 'frontend-unit-specs' }),
    Object.freeze({ id: 'J1.concurrency.multi-connection-races', layer: 'backend-postgresql-tests' }),
  ]),
});

export function journeyContractDigest(contract) {
  return digestOfValue(contract);
}

export function journeyRecordDigest(record) {
  return digestOfValue(record);
}

export const B4_MINIMUM_CONTRACT_DIGEST = journeyContractDigest(B4_MINIMUM_CONTRACT);

/** Structural problems of a contract. Empty means it is a usable contract. */
export function validateContract(contract) {
  const problems = [];
  const bad = (detail) => problems.push({ code: 'journey.record.contract_invalid', detail });
  if (contract === undefined || contract === null) return [{ code: 'journey.record.contract_missing', detail: 'no expected contract was supplied' }];
  let size = 0;
  try { size = Buffer.byteLength(canonicalJson(contract), 'utf8'); } catch { return [{ code: 'journey.record.contract_invalid', detail: 'not plain data' }]; }
  if (size > LIMITS.maxContractBytes) return [{ code: 'journey.record.contract_invalid', detail: 'larger than any contract this repository defines' }];
  if (!exactKeys(contract, ['schema', 'id', 'revision', 'journeys', 'outcomes', 'negativeControl', 'cleanup', 'allowedEvidence', 'notInJourneys'])) {
    return [{ code: 'journey.record.contract_invalid', detail: 'unknown or missing contract fields' }];
  }
  if (contract.schema !== CONTRACT_SCHEMA) bad(`schema is not ${CONTRACT_SCHEMA}`);
  if (typeof contract.id !== 'string' || !SLUG_RE.test(contract.id) || !Number.isSafeInteger(contract.revision) || contract.revision < 1) bad('id or revision');
  if (!Array.isArray(contract.journeys) || contract.journeys.length === 0 || !contract.journeys.every((j) => JOURNEY_RE.test(String(j)))
      || new Set(contract.journeys).size !== contract.journeys.length) bad('journeys must be a non-empty list of distinct J<n>');
  const outcomes = contract.outcomes;
  if (!Array.isArray(outcomes) || outcomes.length === 0 || outcomes.length > LIMITS.maxOutcomes) {
    bad('outcomes must be a non-empty bounded list');
  } else {
    const seen = new Set();
    for (const x of outcomes) {
      if (!exactKeys(x, ['id', 'journey', 'kind', 'evidence']) || !OUTCOME_ID_RE.test(String(x.id)) || x.journey !== String(x.id).slice(0, 2)
          || !OUTCOME_KINDS.includes(x.kind) || !EVIDENCE_REQUIREMENTS.includes(x.evidence)) {
        bad('an outcome is not {id, journey, kind, evidence} in the vocabulary');
        continue;
      }
      if (seen.has(x.id)) bad(`outcome ${x.id} is listed twice`);
      seen.add(x.id);
      if (Array.isArray(contract.journeys) && !contract.journeys.includes(x.journey)) bad(`outcome ${x.id} belongs to no listed journey`);
    }
    if (Array.isArray(contract.journeys)) {
      for (const j of contract.journeys) if (!outcomes.some((x) => x?.journey === j)) bad(`journey ${String(j)} has no outcome`);
    }
    const neg = outcomes.find((x) => x?.id === contract.negativeControl);
    if (!neg || neg.kind !== 'negative-control') bad('negativeControl must name a listed negative-control outcome');
  }
  if (contract.cleanup !== 'required') bad('cleanup must be required');
  if (!Array.isArray(contract.allowedEvidence) || !contract.allowedEvidence.every((k) => EVIDENCE_KINDS.includes(k))) bad('allowedEvidence must use the evidence vocabulary');
  if (Array.isArray(contract.allowedEvidence) && contract.allowedEvidence.includes('live')) bad('live evidence is not a B4 journey observation');
  if (!Array.isArray(contract.notInJourneys) || !contract.notInJourneys.every((x) => exactKeys(x, ['id', 'layer']) && OUTCOME_ID_RE.test(String(x.id)) && SLUG_RE.test(String(x.layer)))) {
    bad('notInJourneys must be a list of {id, layer}');
  }
  return problems;
}

/**
 * A requirement a contract may put in place of the minimum's, because it asks strictly
 * more: `server` is `synthetic-allowed` without the allowance. `environment` and
 * `server` ask different questions and neither stands in for the other.
 */
const STRICTER_EVIDENCE = Object.freeze({ 'synthetic-allowed': Object.freeze(['server']) });

/**
 * Does `contract` require at least everything the reviewed minimum requires, as strictly?
 * Returns the gaps; empty means it covers the minimum.
 */
export function contractGaps(contract, minimum = B4_MINIMUM_CONTRACT) {
  const gaps = [];
  const byId = new Map((contract.outcomes ?? []).map((x) => [x.id, x]));
  const inMinimum = new Set(minimum.outcomes.map((m) => m.id));
  for (const need of minimum.outcomes) {
    const have = byId.get(need.id);
    if (!have) gaps.push(`${need.id} is not required`);
    else if (have.kind !== need.kind) gaps.push(`${need.id} is a ${have.kind}, not a ${need.kind}`);
    else if (have.evidence !== need.evidence && !(STRICTER_EVIDENCE[need.evidence] ?? []).includes(have.evidence)) {
      gaps.push(`${need.id} requires ${need.evidence} evidence, not ${have.evidence}`);
    }
  }
  // An outcome the minimum does not name may be added, but never with a synthetic
  // allowance: that exception is confined to the approved scenario.
  for (const x of contract.outcomes ?? []) {
    if (!inMinimum.has(x.id) && x.evidence === 'synthetic-allowed') gaps.push(`${x.id} allows synthetic evidence the minimum does not`);
  }
  if (contract.negativeControl !== minimum.negativeControl) gaps.push('the negative control is not the defined one');
  for (const kind of contract.allowedEvidence ?? []) if (!minimum.allowedEvidence.includes(kind)) gaps.push(`${kind} evidence is allowed`);
  return gaps;
}

// ── the record's structure ──────────────────────────────────────────────────────

/** Every key and string in the record, scanned for secrets before anything else. */
function sensitiveProblems(value, path = 'record', depth = 0, out = []) {
  if (out.length >= 8) return out;
  if (depth > LIMITS.maxDepth) { out.push({ code: 'journey.record.structure_invalid', detail: `${path} is nested too deeply` }); return out; }
  if (typeof value === 'string') {
    if (SENSITIVE_VALUE_RES.some((re) => re.test(value))) out.push({ code: 'journey.record.sensitive_value', detail: `${path} holds a value shaped like a credential` });
    return out;
  }
  if (Array.isArray(value)) { value.forEach((v, i) => sensitiveProblems(v, `${path}[${i}]`, depth + 1, out)); return out; }
  if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      const shownKey = /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k) ? k : '<key>';
      if (SENSITIVE_KEY_RE.test(k)) out.push({ code: 'journey.record.sensitive_field', detail: `${path}.${shownKey} is a field no journey record may carry` });
      else sensitiveProblems(v, `${path}.${shownKey}`, depth + 1, out);
    }
  }
  return out;
}

function checkPeerInput(p, name, bad) {
  if (!exactKeys(p, ['kind', 'repository', 'commit', 'tree', 'descriptorDigest', 'artifact', 'execution'])) { bad(`inputs.peers.${name} fields`); return; }
  if (!INPUT_KINDS.includes(p.kind) || p.repository !== PEER_REPOSITORIES[name] || !SHA_RE.test(String(p.commit)) || !SHA_RE.test(String(p.tree))
      || !EXECUTION_STATES.includes(p.execution) || !(p.descriptorDigest === null || DIGEST_RE.test(String(p.descriptorDigest)))) {
    bad(`inputs.peers.${name} values`);
  }
  if (p.artifact !== null) checkArtifact(p.artifact, name, `inputs.peers.${name}.artifact`, bad);
}

function checkArtifact(a, slot, where, bad) {
  if (!exactKeys(a, ['id', 'name', 'listedDigest', 'measuredDigest']) || !Number.isSafeInteger(a.id) || a.id <= 0
      || !artifactNameRe(ARTIFACT_PREFIXES[slot]).test(String(a.name)) || !DIGEST_RE.test(String(a.listedDigest))
      || !(a.measuredDigest === null || DIGEST_RE.test(String(a.measuredDigest)))) bad(where);
}

/**
 * Structural validity only: exact keys, vocabulary, bounds. Returns problems (codes
 * `journey.record.*`). Says nothing about completeness or truthfulness.
 */
export function validateJourneyRecord(record) {
  let size = 0;
  try { size = Buffer.byteLength(canonicalJson(record), 'utf8'); } catch { return [{ code: 'journey.record.structure_invalid', detail: 'not plain data' }]; }
  if (size > LIMITS.maxRecordBytes) return [{ code: 'journey.record.structure_invalid', detail: 'larger than the bound' }];
  const sensitive = sensitiveProblems(record);
  if (sensitive.length > 0) return sensitive;
  const problems = [];
  const bad = (detail) => problems.push({ code: 'journey.record.structure_invalid', detail });
  if (!exactKeys(record, ['schema', 'contract', 'producer', 'inputs', 'startedAt', 'finishedAt', 'outcomes', 'cleanup', 'overall'])) {
    return [{ code: 'journey.record.structure_invalid', detail: 'unknown or missing record fields' }];
  }
  if (record.schema !== RECORD_SCHEMA) bad(`schema is not ${RECORD_SCHEMA}`);
  const c = record.contract;
  if (!exactKeys(c, ['id', 'revision', 'digest']) || !SLUG_RE.test(String(c.id)) || !Number.isSafeInteger(c.revision) || !DIGEST_RE.test(String(c.digest))) bad('contract');
  const p = record.producer;
  if (!exactKeys(p, ['kind', 'repository', 'workflowPath', 'runId', 'runAttempt', 'event', 'ref', 'checkout'])) {
    bad('producer fields');
  } else {
    if ((p.kind !== 'ci' && p.kind !== 'local') || p.repository !== FRONTEND_REPOSITORY) bad('producer kind or repository');
    if (p.kind === 'ci' && (typeof p.workflowPath !== 'string' || !/^\.github\/workflows\/[a-z0-9_-]+\.ya?ml$/.test(p.workflowPath)
        || !ID_RE.test(String(p.runId)) || !ATTEMPT_RE.test(String(p.runAttempt)) || typeof p.runId !== 'string' || typeof p.runAttempt !== 'string'
        || !['push', 'pull_request', 'workflow_dispatch'].includes(p.event) || !CI_REF_RE.test(String(p.ref)))) bad('producer run');
    if (p.kind === 'local' && (p.workflowPath !== null || p.runId !== null || p.runAttempt !== null || p.event !== null || p.ref !== null)) bad('a local producer names no CI run');
    const co = p.checkout;
    if (!exactKeys(co, ['kind', 'commit', 'tree']) || !CHECKOUT_KINDS.includes(co.kind) || !SHA_RE.test(String(co.commit)) || !SHA_RE.test(String(co.tree))) bad('producer checkout');
  }
  const i = record.inputs;
  if (!exactKeys(i, ['frontend', 'peers', 'harness', 'toolchain', 'testHost'])) {
    bad('inputs fields');
  } else {
    const f = i.frontend;
    if (!exactKeys(f, ['kind', 'repository', 'commit', 'tree', 'artifact', 'payloadTreeDigest', 'execution'])
        || !INPUT_KINDS.includes(f.kind) || f.repository !== FRONTEND_REPOSITORY || !SHA_RE.test(String(f.commit)) || !SHA_RE.test(String(f.tree))
        || !DIGEST_RE.test(String(f.payloadTreeDigest)) || !EXECUTION_STATES.includes(f.execution)) bad('inputs.frontend');
    else if (f.artifact !== null) checkArtifact(f.artifact, 'frontend', 'inputs.frontend.artifact', bad);
    if (!exactKeys(i.peers, ['admin', 'backend'])) bad('inputs.peers must name admin and backend');
    else for (const name of ['admin', 'backend']) checkPeerInput(i.peers[name], name, bad);
    const h = i.harness;
    if (!exactKeys(h, ['repository', 'commit', 'tree']) || h.repository !== FRONTEND_REPOSITORY || !SHA_RE.test(String(h.commit)) || !SHA_RE.test(String(h.tree))) bad('inputs.harness');
    const t = i.toolchain;
    if (!exactKeys(t, ['lockDigest', 'node', 'browser']) || !DIGEST_RE.test(String(t.lockDigest)) || !VERSION_RE.test(String(t.node))
        || !exactKeys(t.browser, ['name', 'version', 'archiveDigest']) || !BROWSERS.includes(t.browser.name) || !VERSION_RE.test(String(t.browser.version))
        || !(t.browser.archiveDigest === null || DIGEST_RE.test(String(t.browser.archiveDigest)))) bad('inputs.toolchain');
    const th = i.testHost;
    if (!exactKeys(th, ['kind', 'profileDigest']) || !['ci-runner', 'local'].includes(th.kind) || !DIGEST_RE.test(String(th.profileDigest))) bad('inputs.testHost');
  }
  if (!Number.isFinite(isoMs(record.startedAt)) || !Number.isFinite(isoMs(record.finishedAt))) bad('startedAt / finishedAt');
  const outcomes = record.outcomes;
  if (!Array.isArray(outcomes) || outcomes.length > LIMITS.maxOutcomes) {
    bad('outcomes must be a bounded list');
  } else {
    outcomes.forEach((x, n) => {
      if (!exactKeys(x, ['id', 'kind', 'result', 'startedAt', 'finishedAt', 'producerRun', 'evidence'])
          || !OUTCOME_ID_RE.test(String(x.id)) || !OUTCOME_KINDS.includes(x.kind) || !RESULTS.includes(x.result)
          || !Number.isFinite(isoMs(x.startedAt)) || !Number.isFinite(isoMs(x.finishedAt))) { bad(`outcomes[${n}]`); return; }
      const pr = x.producerRun;
      if (!exactKeys(pr, ['runId', 'runAttempt']) || !(pr.runId === null || ID_RE.test(String(pr.runId))) || !(pr.runAttempt === null || ATTEMPT_RE.test(String(pr.runAttempt)))) bad(`outcomes[${n}].producerRun`);
      if (!Array.isArray(x.evidence) || x.evidence.length === 0 || x.evidence.length > LIMITS.maxEvidencePerOutcome
          || !x.evidence.every((e) => exactKeys(e, ['kind', 'ref']) && EVIDENCE_KINDS.includes(e.kind) && refAllowed(e.kind, e.ref))) bad(`outcomes[${n}].evidence`);
    });
  }
  const cl = record.cleanup;
  if (!exactKeys(cl, ['result', 'finishedAt']) || !['completed', 'failed', 'not-run'].includes(cl.result)
      || !(cl.finishedAt === null || Number.isFinite(isoMs(cl.finishedAt)))) bad('cleanup');
  if (record.overall !== 'passed' && record.overall !== 'failed') bad('overall');
  return problems;
}

// ── truthfulness: what the record may say about itself ─────────────────────────

/**
 * Contradictions inside a structurally valid record. A record with any of these is
 * UNTRUTHFUL, whatever else it covers: it says something about itself that its own
 * fields rule out.
 */
export function truthfulnessProblems(record) {
  const problems = [];
  const bad = (code, detail) => problems.push({ code: `journey.record.${code}`, detail });
  const p = record.producer;
  const f = record.inputs.frontend;
  const peers = record.inputs.peers;

  // A local build at the same commit does not inherit the candidate's identity.
  for (const [where, input] of [['frontend', f], ['peers.admin', peers.admin], ['peers.backend', peers.backend]]) {
    if (input.kind === 'local-build' && input.artifact !== null) bad('local_build_claims_candidate', `inputs.${where} is a local build carrying a candidate artifact identity`);
    if (input.kind === 'local-build' && input.descriptorDigest != null) bad('local_build_claims_candidate', `inputs.${where} is a local build carrying a peer selection`);
    if (input.kind === 'local-build' && input.execution === 'downloaded-not-executed') bad('input_inconsistent', `inputs.${where} is a local build described as downloaded`);
    if (input.kind === 'downloaded-candidate' && input.artifact === null) bad('input_inconsistent', `inputs.${where} is a downloaded candidate with no artifact identity`);
  }
  // The checkout that was tested, against the event that produced the run.
  const co = p.checkout;
  if (p.kind === 'local' && co.kind !== 'local-worktree') bad('checkout_inconsistent', 'a local producer tested something other than a local worktree');
  if (p.kind === 'ci') {
    if (co.kind === 'local-worktree') bad('checkout_inconsistent', 'a CI producer describes a local worktree');
    if (co.kind === 'push-commit' && p.event !== 'push') bad('checkout_inconsistent', 'a push-commit checkout from a non-push run');
    if (co.kind === 'synthetic-merge' && p.event !== 'pull_request') bad('checkout_inconsistent', 'a synthetic merge from a non-pull-request run');
  }
  const startMs = isoMs(record.startedAt);
  const endMs = isoMs(record.finishedAt);
  if (startMs > endMs) bad('time_inconsistent', 'the record finished before it started');

  const executedCandidate = [f, peers.admin, peers.backend].some((x) => x.kind === 'downloaded-candidate' && x.execution === 'executed');
  const ids = new Map();
  let lastFinish = startMs;
  let anyNotPassed = false;
  for (const x of record.outcomes) {
    if (ids.has(x.id)) {
      bad('duplicate_outcome', `${x.id} is reported ${ids.get(x.id) === x.result ? 'twice' : `twice, as ${ids.get(x.id)} and ${x.result}`}`);
    }
    ids.set(x.id, x.result);
    if (x.result !== 'passed') anyNotPassed = true;
    const s = isoMs(x.startedAt);
    const e = isoMs(x.finishedAt);
    if (s > e || s < startMs || e > endMs) bad('time_inconsistent', `${x.id} ran outside the record's window`);
    lastFinish = Math.max(lastFinish, e);
    // One record is one run: an outcome carried from another run cannot be spliced in.
    const runOk = p.kind === 'ci'
      ? x.producerRun.runId === p.runId && x.producerRun.runAttempt === p.runAttempt
      : x.producerRun.runId === null && x.producerRun.runAttempt === null;
    if (!runOk) bad('outcome_from_other_run', `${x.id} names another producer run`);
    for (const ev of x.evidence) {
      if (ev.kind === 'ci' && p.kind !== 'ci') bad('evidence_kind_inconsistent', `${x.id} claims CI evidence from a local producer`);
      if (ev.kind === 'candidate-execution' && !executedCandidate) {
        bad('evidence_kind_inconsistent', `${x.id} claims candidate execution, but no downloaded candidate was executed`);
      }
      if (ev.kind === 'local-build' && f.kind !== 'local-build' && peers.admin.kind !== 'local-build' && peers.backend.kind !== 'local-build') {
        bad('evidence_kind_inconsistent', `${x.id} claims a local build, but no input is one`);
      }
    }
  }
  const cl = record.cleanup;
  if (cl.result === 'completed' && (cl.finishedAt === null || isoMs(cl.finishedAt) < lastFinish || isoMs(cl.finishedAt) > endMs)) {
    bad('time_inconsistent', 'cleanup is reported complete outside the record window or before the last outcome finished');
  }
  // An overall pass is a claim about every outcome and the teardown. It cannot hide one.
  if (record.overall === 'passed' && (anyNotPassed || cl.result !== 'completed')) {
    bad('failure_hidden', 'overall is passed while an outcome did not pass or cleanup did not complete');
  }
  return problems;
}

// ── assessment against an independently supplied contract and inputs ──────────

const INPUT_SECTIONS = Object.freeze([
  ['frontend', (i) => i.frontend],
  ['peers.admin', (i) => i.peers.admin],
  ['peers.backend', (i) => i.peers.backend],
  ['harness', (i) => i.harness],
  ['toolchain', (i) => i.toolchain],
  ['testHost', (i) => i.testHost],
]);

/**
 * @param {object} input
 * @param {object} input.record          the journey record, as retained
 * @param {object} input.contract        the EXPECTED contract, from the reviewer or the
 *                                       reviewed B4_MINIMUM_CONTRACT; never the record's
 * @param {object} input.expectedInputs  the inputs the caller independently expects, in
 *                                       the record's `inputs` shape
 * @returns {{structurallyValid: boolean, truthful: boolean, certifiedGateAcceptance: boolean,
 *            reasons: Array<{code, detail}>, coverage: object|null}}
 */
export function assessJourneyRecord({ record, contract, expectedInputs } = {}) {
  const structural = validateJourneyRecord(record);
  if (structural.length > 0) {
    return { structurallyValid: false, truthful: false, certifiedGateAcceptance: false, reasons: structural, coverage: null };
  }
  const untruthful = truthfulnessProblems(record);
  const reasons = [...untruthful];
  const refuse = (code, detail) => reasons.push({ code: `journey.record.${code}`, detail });

  // THE CONTRACT comes from the caller. The record's own reference must match it.
  const contractProblems = validateContract(contract);
  reasons.push(...contractProblems);
  let byId = null;
  if (contractProblems.length === 0) {
    for (const gap of contractGaps(contract)) refuse('contract_below_minimum', gap);
    const digest = journeyContractDigest(contract);
    if (record.contract.digest !== digest || record.contract.id !== contract.id || record.contract.revision !== contract.revision) {
      refuse('contract_mismatch', 'the record was produced against another contract than the one expected');
    }
    byId = new Map(contract.outcomes.map((x) => [x.id, x]));
  }

  // THE PRODUCER: only a push-to-main CI run of this repository, testing the pushed commit.
  const p = record.producer;
  const f = record.inputs.frontend;
  if (p.kind !== 'ci') refuse('not_certified_producer', 'a local producer is not a certified gate run');
  else if (p.event !== 'push' || p.ref !== 'refs/heads/main' || p.checkout.kind !== 'push-commit') {
    refuse('not_certified_producer', `a ${p.checkout.kind} checkout from a ${String(p.event)} run is not the pushed main commit`);
  }
  if (p.checkout.commit !== f.commit || p.checkout.tree !== f.tree) refuse('not_certified_producer', 'the tested checkout is not the Frontend candidate commit');

  // THE INPUTS, against what the caller expects, section by section.
  if (!isObject(expectedInputs)) {
    refuse('inputs_missing', 'no independently expected inputs were supplied');
  } else {
    for (const [name, pick] of INPUT_SECTIONS) {
      let expected;
      try { expected = pick(expectedInputs); } catch { expected = undefined; }
      if (expected === undefined || !same(pick(record.inputs), expected)) refuse('input_mismatch', `inputs.${name} is not the expected one`);
    }
  }
  // Certified bytes, and only executed ones.
  for (const [where, input] of [['frontend', f], ['peers.admin', record.inputs.peers.admin], ['peers.backend', record.inputs.peers.backend]]) {
    if (input.kind !== 'downloaded-candidate' || input.execution !== 'executed' || input.artifact === null
        || input.artifact.measuredDigest === null || input.artifact.measuredDigest !== input.artifact.listedDigest) {
      refuse('input_not_candidate_execution', `inputs.${where} is not a downloaded candidate whose measured bytes were executed`);
    }
  }
  // A downloaded peer is bound to the result of peer selection, by digest. Without it
  // the record names a candidate but not the receipt, run, attempt, jobs and companion
  // artifacts it was selected by, and matching a null expectation proves nothing.
  for (const name of ['admin', 'backend']) {
    const peer = record.inputs.peers[name];
    if (peer.kind === 'downloaded-candidate' && peer.descriptorDigest === null) {
      refuse('peer_selection_unbound', `inputs.peers.${name} carries no peer-selection descriptor digest`);
    }
  }
  if (record.inputs.testHost.kind !== 'ci-runner') refuse('not_certified_producer', 'the test host is not a CI runner');
  if (record.inputs.toolchain.browser.archiveDigest === null) refuse('toolchain_unidentified', 'the browser archive is not identified by digest');

  // COVERAGE, from the contract.
  let coverage = null;
  if (byId) {
    const seen = new Map();
    for (const x of record.outcomes) seen.set(x.id, [...(seen.get(x.id) ?? []), x]);
    coverage = { required: byId.size, passed: 0, missing: [], notPassed: [], unexpected: [] };
    for (const [id, want] of byId) {
      const got = seen.get(id) ?? [];
      if (got.length === 0) { coverage.missing.push(id); refuse('outcome_missing', id); continue; }
      if (got.length > 1) continue; // already refused as duplicate_outcome
      const x = got[0];
      if (x.kind !== want.kind) refuse('outcome_kind_mismatch', `${id} is reported as ${x.kind}, the contract requires ${want.kind}`);
      if (x.result !== 'passed') { coverage.notPassed.push(id); refuse('outcome_not_passed', `${id} ${x.result}`); }
      else coverage.passed += 1;
      const kinds = x.evidence.map((e) => e.kind);
      for (const k of kinds) if (!contract.allowedEvidence.includes(k)) refuse('evidence_kind_not_allowed', `${id} carries ${k} evidence`);
      if (want.evidence === 'environment') {
        if (!kinds.includes('ci')) refuse('execution_evidence_missing', `${id} carries no ci evidence of its own execution`);
      } else if (!kinds.includes('candidate-execution')) {
        refuse('candidate_execution_missing', `${id} carries no candidate-execution evidence`);
      }
      if (kinds.includes('synthetic') && want.evidence !== 'synthetic-allowed') refuse('synthetic_not_allowed', `${id} carries synthetic evidence`);
    }
    for (const [id] of seen) if (!byId.has(id)) { coverage.unexpected.push(id); refuse('outcome_unexpected', id); }
    const neg = seen.get(contract.negativeControl) ?? [];
    if (neg.length !== 1 || neg[0].result !== 'passed') refuse('negative_control_not_passed', 'the defined negative control did not run and detect its fault exactly once');
  }
  if (record.cleanup.result !== 'completed') refuse('cleanup_incomplete', `cleanup ${record.cleanup.result}`);
  if (record.overall !== 'passed') refuse('overall_not_passed', 'the producer reports a failure');

  return {
    structurallyValid: true,
    truthful: untruthful.length === 0,
    certifiedGateAcceptance: reasons.length === 0,
    reasons,
    coverage,
  };
}
