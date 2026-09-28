/**
 * JOURNEY OBSERVATION: collecting what the journey peer selector judges, and handing it
 * local bytes, without trusting anything an observation says about where to go next
 * (D16 / D08 B4, B2).
 *
 * B1 (journey-peers.mjs) answers "does THIS evidence establish THIS expected selection?"
 * and deliberately owns no client: it reads the raw API documents a caller supplies. This
 * module is that caller, in two modes, and it adds no judgement of its own about a peer:
 *
 *   metadata  GET the workflow, the selected attempt, the run as it stands, the commit, and
 *             EVERY page of the attempt's jobs and the run's artifacts, from GitHub's API
 *             and nowhere else; re-read the run after the rest; hand the raw documents to
 *             B1 with `require: 'metadata'` BY NAME. No byte of any candidate is fetched.
 *   bytes     OFFLINE: the observations a metadata collection saved, plus an archive and a
 *             record the caller already holds as local files, handed to B1 with
 *             `require: 'bytes'`. Missing bytes are a refusal, never a quiet fall back to
 *             the metadata answer.
 *
 * WHAT A PASSING ANSWER MEANS, stated exactly:
 *   metadata-only                            the listing, the run, the attempt's jobs,
 *                                            the commit and the approved receipt agree
 *                                            with the selection. Not a verified or
 *                                            admitted candidate; no candidate byte seen.
 *   bytes-correspond-consumer-checks-deferred B1 hashed the supplied archive and it equals
 *                                            the listed digest, and read the supplied
 *                                            record and its claims agree. Every check B1
 *                                            names as deferred (archive membership, the
 *                                            record being INSIDE this archive, payload,
 *                                            wheels, audit re-decision, and for the
 *                                            backend the offline reconstruction on the
 *                                            target) is still the peer's own trusted
 *                                            consumer's to make.
 *
 * NOT AN ATOMIC SNAPSHOT. Every document is a separate GET, answered at a separate moment.
 * The run is read FIRST and LAST, and a difference in its attempt, status, conclusion,
 * head or update time between the two refuses the collection; paged listings must agree
 * on their total, hold exactly the entries it implies, and never repeat an id. That bounds
 * what can change unnoticed; it does not make the reads one transaction.
 *
 * WHERE REQUESTS GO. Only to API_ORIGIN, only by GET, only along the reviewed read routes
 * (ROUTE_RE), and only on paths built HERE from a selection B1's `checkSelection`
 * accepted, with the repository and workflow file taken from B1's reviewed peer format —
 * never from the selection text, and never from any URL an observation carries. Redirects
 * are refused. Every request and every body is bounded (OBSERVE_LIMITS).
 *
 * WHAT IS NEVER REPORTED. No response body, provider message, raw exception text, request
 * header or credential reaches a reason: every detail is a fixed sentence plus values that
 * matched a strict shape. A credential, if the caller supplies one, is attached only to
 * API_ORIGIN; this module never reads the environment.
 *
 * Pure except for the injected `fetchImpl` and `clock`. No filesystem, subprocess, archive
 * extraction or environment access.
 */

import { digestOfValue } from './canonical.mjs';
import {
  LIMITS as PEER_LIMITS, PEER_FORMATS, checkSelection, peerDescriptorDigest, selectPeerCandidate,
} from './journey-peers.mjs';
import { receiptDigest } from './peers.mjs';

export const API_ORIGIN = 'https://api.github.com';
export const SAVED_SCHEMA = 'dinify.journey.peer-observations/1';
export const RESULT_SCHEMA = 'dinify.journey.peer-observation-result/1';

/** The outcomes, and the exit status the CLI gives each. No status means verified or admitted. */
export const OUTCOMES = Object.freeze({
  bytes: Object.freeze({ outcome: 'bytes-correspond-consumer-checks-deferred', exit: 0 }),
  metadata: Object.freeze({ outcome: 'metadata-only', exit: 3 }),
  refused: Object.freeze({ outcome: 'refused', exit: 1 }),
  usage: Object.freeze({ outcome: 'usage', exit: 2 }),
});

export const OBSERVE_LIMITS = Object.freeze({
  perRequestMs: 20_000,
  totalMs: 120_000,
  maxResponseBytes: 4 * 1024 * 1024,
  perPage: PEER_LIMITS.maxPerPage,
  maxPages: PEER_LIMITS.maxPages,
  maxSavedBytes: 64 * 1024 * 1024,
});

// The only paths a request may take: a workflow file, a run, one of its attempts, that
// attempt's jobs page, the run's artifacts page, a commit. Page size and number are fixed
// here too, so nothing but a page index in 1..maxPages can vary.
const OWNER_REPO = '[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}';
const PAGE = `per_page=${OBSERVE_LIMITS.perPage}&page=(?:[1-9]|10)`;
export const ROUTE_RE = new RegExp(
  `^/repos/${OWNER_REPO}/(?:actions/workflows/[A-Za-z0-9._-]{1,100}\\.ya?ml`
  + `|actions/runs/[1-9][0-9]{0,19}(?:/attempts/[1-9][0-9]{0,3}(?:/jobs\\?${PAGE})?|/artifacts\\?${PAGE})?`
  + '|git/commits/[0-9a-f]{40})$',
);

const WORKFLOW_PREFIX = '.github/workflows/';
const TOKEN_RE = /^[A-Za-z0-9_.-]{1,255}$/;
const SAVED_KEYS = Object.freeze(['workflow', 'run', 'latestRun', 'jobs', 'artifacts', 'commit']);
const SAVED_ENVELOPE_KEYS = Object.freeze(['schema', 'selectionDigest', 'peer', 'collection', 'observations']);
// The fields that must be identical in the first and the final read of the run.
const RUN_STABLE_FIELDS = Object.freeze(['id', 'run_attempt', 'status', 'conclusion', 'head_sha', 'updated_at']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => isObject(o) && Object.prototype.hasOwnProperty.call(o, k);
const isBytes = (v) => v instanceof Uint8Array;

class Refusal {
  constructor(code, detail) { this.code = `journey.observe.${code}`; this.detail = String(detail); }
}
const refusal = (code, detail) => ({ ok: false, reason: new Refusal(code, detail) });
const asReason = (r) => ({ code: r.code, detail: r.detail });

/** Is `token` a credential this module will attach? Shape only; the value is never shown. */
export function credentialUsable(token) {
  return token === undefined || token === null || token === '' || TOKEN_RE.test(token);
}

/**
 * The GET paths for a selection, or why none can be built. Built ONLY from a selection
 * B1 accepted; the repository and workflow file come from B1's reviewed peer format.
 */
export function planRequests(expected) {
  const { format, problems } = checkSelection(expected);
  if (problems.length > 0 || !format) return { plan: null, problems };
  if (!format.workflowPath.startsWith(WORKFLOW_PREFIX)) return { plan: null, problems: ['the reviewed workflow path is not a workflow file'] };
  const base = `/repos/${format.repository}`;
  const workflowFile = format.workflowPath.slice(WORKFLOW_PREFIX.length);
  const { id, attempt } = expected.run;
  const per = OBSERVE_LIMITS.perPage;
  const plan = Object.freeze({
    workflow: `${base}/actions/workflows/${workflowFile}`,
    run: `${base}/actions/runs/${id}/attempts/${attempt}`,
    latestRun: `${base}/actions/runs/${id}`,
    commit: `${base}/git/commits/${expected.source.commit}`,
    jobsPage: (page) => `${base}/actions/runs/${id}/attempts/${attempt}/jobs?per_page=${per}&page=${page}`,
    artifactsPage: (page) => `${base}/actions/runs/${id}/artifacts?per_page=${per}&page=${page}`,
  });
  for (const path of [plan.workflow, plan.run, plan.latestRun, plan.commit, plan.jobsPage(1), plan.artifactsPage(1)]) {
    if (!ROUTE_RE.test(path)) return { plan: null, problems: ['a planned request is not one of the reviewed read routes'] };
  }
  return { plan, problems: [] };
}

// ── one bounded GET ─────────────────────────────────────────────────────────────

async function readBounded(res, max) {
  const declared = res.headers?.get?.('content-length');
  if (typeof declared === 'string' && /^[0-9]{1,15}$/.test(declared) && Number(declared) > max) {
    try { await res.body?.cancel(); } catch { /* nothing to report */ }
    return { tooLarge: true };
  }
  if (!res.body || typeof res.body.getReader !== 'function') return { bytes: new Uint8Array(0) };
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try { await reader.cancel(); } catch { /* nothing to report */ }
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  return { bytes };
}

async function discard(res) {
  try { await res.body?.cancel(); } catch { /* the body is never read */ }
}

/**
 * ONE bounded GET of a reviewed route, on its own: the parsed JSON object, or a sanitized
 * refusal. The collection below is built from this and nothing else.
 */
export async function readRoute(path, { fetchImpl, token = null, clock = () => Date.now() } = {}) {
  if (!credentialUsable(token)) return refusal('credential_malformed', 'the supplied credential is not a usable token');
  if (typeof fetchImpl !== 'function') return refusal('transport_missing', 'no HTTP client was supplied');
  return getJson(path, 'read', { fetchImpl, token: token || null, clock, deadlineMs: clock() + OBSERVE_LIMITS.perRequestMs, requests: 0, maxRequests: 1 });
}

/** GET one reviewed route; the parsed JSON object, or a sanitized refusal. */
async function getJson(path, label, ctx) {
  if (typeof path !== 'string' || !ROUTE_RE.test(path)) return refusal('route_refused', `${label}: not one of the reviewed read routes`);
  if (ctx.requests >= ctx.maxRequests) return refusal('request_budget_exceeded', `${label}: more requests than a complete collection needs`);
  const remaining = ctx.deadlineMs - ctx.clock();
  if (!(remaining > 0)) return refusal('deadline_exceeded', `${label}: the collection deadline passed`);
  const timeout = Math.max(1, Math.min(OBSERVE_LIMITS.perRequestMs, remaining));
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'dinify-journey-observe',
  };
  if (ctx.token) headers.authorization = `Bearer ${ctx.token}`;
  ctx.requests += 1;
  let res;
  try {
    res = await ctx.fetchImpl(`${API_ORIGIN}${path}`, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return refusal('timeout', `${label}: no answer within ${timeout} ms`);
    return refusal('transport_failed', `${label}: the request did not complete`);
  }
  const status = Number.isSafeInteger(res?.status) ? res.status : 0;
  if (status !== 200) {
    await discard(res);
    if (status === 401) return refusal('unauthorized', `${label}: the API answered 401`);
    const remainingQuota = res.headers?.get?.('x-ratelimit-remaining');
    if (status === 429 || (status === 403 && remainingQuota === '0')) return refusal('rate_limited', `${label}: the API refused the request for rate limiting (${status})`);
    if (status === 403) return refusal('forbidden', `${label}: the API answered 403`);
    if (status === 404) return refusal('not_found', `${label}: the API answered 404`);
    if (status >= 300 && status < 400) return refusal('redirect_refused', `${label}: the API answered a redirect (${status}), which is not followed`);
    return refusal('http_status', `${label}: the API answered ${status >= 100 && status <= 599 ? status : 'an invalid status'}`);
  }
  const type = res.headers?.get?.('content-type');
  if (typeof type !== 'string' || !/^application\/json\b/i.test(type)) {
    await discard(res);
    return refusal('response_malformed', `${label}: the answer is not JSON`);
  }
  let read;
  try {
    read = await readBounded(res, OBSERVE_LIMITS.maxResponseBytes);
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return refusal('timeout', `${label}: the answer did not finish within ${timeout} ms`);
    return refusal('transport_failed', `${label}: the answer did not finish`);
  }
  if (read.tooLarge) return refusal('response_too_large', `${label}: the answer is larger than ${OBSERVE_LIMITS.maxResponseBytes} bytes`);
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.bytes));
  } catch {
    return refusal('response_malformed', `${label}: the answer is not readable JSON`);
  }
  if (!isObject(value)) return refusal('response_malformed', `${label}: the answer is not a JSON object`);
  return { ok: true, value };
}

// ── every page of a listing ─────────────────────────────────────────────────────

/**
 * Every page of a listing, or a refusal naming why the listing cannot be complete: pages
 * that disagree about the total, a page holding fewer (truncated) or more entries than
 * the total implies, an id repeated across pages (a repeated page), or a total needing
 * more pages than are ever read.
 */
async function collectPages(kind, key, pageUrl, ctx) {
  const per = OBSERVE_LIMITS.perPage;
  const shape = (page) => isObject(page) && Number.isSafeInteger(page.total_count) && page.total_count >= 0 && Array.isArray(page[key]);
  const first = await getJson(pageUrl(1), `${kind} page 1`, ctx);
  if (!first.ok) return first;
  if (!shape(first.value)) return refusal('response_malformed', `${kind} page 1 is not a listing`);
  const total = first.value.total_count;
  const pageCount = total === 0 ? 1 : Math.ceil(total / per);
  if (pageCount > OBSERVE_LIMITS.maxPages) {
    return refusal('pagination_unbounded', `${kind}: a stated total of ${total} needs ${pageCount} pages; at most ${OBSERVE_LIMITS.maxPages} are read`);
  }
  const pages = [first.value];
  for (let n = 2; n <= pageCount; n += 1) {
    const next = await getJson(pageUrl(n), `${kind} page ${n}`, ctx);
    if (!next.ok) return next;
    if (!shape(next.value)) return refusal('response_malformed', `${kind} page ${n} is not a listing`);
    pages.push(next.value);
  }
  const seen = new Set();
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    if (page.total_count !== total) {
      return refusal('pagination_inconsistent', `${kind}: page ${i + 1} states a total of ${page.total_count}, page 1 stated ${total}`);
    }
    const want = i < pageCount - 1 ? per : total - per * (pageCount - 1);
    const got = page[key].length;
    if (got < want) return refusal('pagination_truncated', `${kind}: page ${i + 1} holds ${got} entries where the total implies ${want}`);
    if (got > want) return refusal('pagination_inconsistent', `${kind}: page ${i + 1} holds ${got} entries where the total implies ${want}`);
    for (const entry of page[key]) {
      const id = isObject(entry) ? entry.id : undefined;
      if (!Number.isSafeInteger(id) || id <= 0) return refusal('response_malformed', `${kind}: page ${i + 1} has an entry with no usable id`);
      if (seen.has(id)) return refusal('pagination_repeated', `${kind}: an entry id repeats across pages`);
      seen.add(id);
    }
  }
  return { ok: true, pages };
}

// ── the metadata collection ─────────────────────────────────────────────────────

/**
 * Collect the raw observations for `expected`. Returns {ok, reasons, observations,
 * collection}. `observations` carries the raw documents exactly as answered (never
 * normalized); it is null when the collection itself could not be completed.
 */
export async function collectObservations({ expected, fetchImpl, token, clock = () => Date.now() } = {}) {
  const { plan, problems } = planRequests(expected);
  if (!plan) {
    return { ok: false, reasons: problems.map((p) => ({ code: 'journey.observe.selection_invalid', detail: p })), observations: null, collection: null };
  }
  if (!credentialUsable(token)) {
    return { ok: false, reasons: [asReason(new Refusal('credential_malformed', 'the supplied credential is not a usable token'))], observations: null, collection: null };
  }
  if (typeof fetchImpl !== 'function') {
    return { ok: false, reasons: [asReason(new Refusal('transport_missing', 'no HTTP client was supplied'))], observations: null, collection: null };
  }
  const startedMs = clock();
  const ctx = {
    fetchImpl, token: token || null, clock,
    deadlineMs: startedMs + OBSERVE_LIMITS.totalMs,
    requests: 0,
    maxRequests: 5 + 2 * OBSERVE_LIMITS.maxPages,
  };
  const collection = (extra = {}) => ({
    origin: API_ORIGIN,
    requests: ctx.requests,
    startedAt: new Date(startedMs).toISOString(),
    finishedAt: new Date(clock()).toISOString(),
    currentAttemptRechecked: false,
    atomicSnapshot: false,
    credentialAttached: ctx.token !== null,
    ...extra,
  });
  const fail = (r) => ({ ok: false, reasons: [asReason(r.reason)], observations: null, collection: collection() });

  const firstRun = await getJson(plan.latestRun, 'run (first read)', ctx);
  if (!firstRun.ok) return fail(firstRun);
  const workflow = await getJson(plan.workflow, 'workflow', ctx);
  if (!workflow.ok) return fail(workflow);
  const run = await getJson(plan.run, 'selected attempt', ctx);
  if (!run.ok) return fail(run);
  const commit = await getJson(plan.commit, 'commit', ctx);
  if (!commit.ok) return fail(commit);
  const jobs = await collectPages('jobs', 'jobs', plan.jobsPage, ctx);
  if (!jobs.ok) return fail(jobs);
  const artifacts = await collectPages('artifacts', 'artifacts', plan.artifactsPage, ctx);
  if (!artifacts.ok) return fail(artifacts);
  const finalRun = await getJson(plan.latestRun, 'run (final read)', ctx);
  if (!finalRun.ok) return fail(finalRun);

  const pages = { jobs: jobs.pages.length, artifacts: artifacts.pages.length };
  const changed = RUN_STABLE_FIELDS.filter((f) => {
    const a = firstRun.value[f];
    const b = finalRun.value[f];
    return a !== b || (a !== null && typeof a === 'object');
  });
  if (changed.length > 0) {
    return {
      ok: false,
      reasons: [asReason(new Refusal('run_changed_during_collection', `the run's ${changed.join(', ')} differed between the first and the final read; collect again`))],
      observations: null,
      collection: collection({ pages }),
    };
  }
  return {
    ok: true,
    reasons: [],
    observations: {
      workflow: workflow.value,
      run: run.value,
      latestRun: finalRun.value,
      jobs: jobs.pages,
      artifacts: artifacts.pages,
      commit: commit.value,
    },
    collection: collection({ pages, currentAttemptRechecked: true }),
  };
}

// ── the approved receipt ────────────────────────────────────────────────────────

/**
 * Null when the policy approves exactly this selection's commit and receipt, otherwise a
 * reason. The selection is never adjusted to fit the policy: an approval for another
 * commit, or another receipt digest, is a refusal naming the selection needing review.
 */
export function approvalProblem({ policy, expected, receipt }) {
  const peer = isObject(expected) ? expected.peer : undefined;
  const declared = own(PEER_FORMATS, peer) ? policy?.compatibleSet?.peers?.[peer] : undefined;
  if (!isObject(declared)) return asReason(new Refusal('selection_not_approved', 'the policy declares no such peer'));
  const setId = typeof policy.compatibleSet.id === 'string' ? policy.compatibleSet.id : '<unnamed set>';
  if (declared.repository !== expected.repository) return asReason(new Refusal('selection_not_approved', `the policy's ${peer} repository is not the selection's`));
  const commit = expected.source?.commit;
  const approved = Array.isArray(declared.approved) ? declared.approved.filter((a) => isObject(a) && a.commit === commit) : [];
  if (approved.length !== 1) {
    return asReason(new Refusal('selection_not_approved', `${peer} ${/^[0-9a-f]{40}$/.test(String(commit)) ? commit : '<omitted>'} is not approved in compatible set ${setId}; the selection needs review`));
  }
  if (approved[0].receiptDigest !== expected.receipt?.digest) {
    return asReason(new Refusal('receipt_not_approved', `the selection names a receipt digest compatible set ${setId} does not approve for ${peer} ${commit}`));
  }
  let actual = null;
  try { actual = receiptDigest(receipt); } catch { /* reported below */ }
  if (actual !== approved[0].receiptDigest) {
    return asReason(new Refusal('receipt_not_approved', `the supplied receipt is not the one compatible set ${setId} approves for ${peer} ${commit}`));
  }
  return null;
}

// ── results ─────────────────────────────────────────────────────────────────────

const STATEMENTS = Object.freeze({
  metadata: 'Metadata only: no byte of the candidate was observed. This is not a verified or admitted candidate.',
  bytes: 'The supplied archive bytes hash to the listed digest and the supplied record agrees with the selection. Every deferred check remains the peer consumer\'s; this is not a verified or admitted candidate.',
  refused: 'Refused: the evidence does not establish the selection at the requested level.',
});

function result({ mode, expected, selected, reasons: given, collection }) {
  const reasons = [...given];
  // The outcome follows the LEVEL B1 established, never the mode that was asked for, and
  // each mode accepts exactly its own level: a bytes run that came back at the metadata
  // level is refused rather than reported as either answer.
  if (reasons.length === 0 && selected?.ok === true && selected.level !== mode) {
    reasons.push(asReason(new Refusal(mode === 'bytes' ? 'bytes_not_established' : 'level_unexpected', `the selector answered at the ${selected.level === 'bytes' ? 'bytes' : 'metadata'} level; this mode answers only at the ${mode} level`)));
  }
  const ok = reasons.length === 0 && selected?.ok === true;
  const kind = !ok ? 'refused' : selected.level;
  const format = isObject(expected) && own(PEER_FORMATS, expected.peer) ? PEER_FORMATS[expected.peer] : null;
  const descriptor = ok ? selected.descriptor : null;
  return {
    schema: RESULT_SCHEMA,
    mode,
    outcome: OUTCOMES[kind].outcome,
    statement: STATEMENTS[kind],
    peer: format ? expected.peer : null,
    repository: format ? format.repository : null,
    source: format ? { commit: expected.source.commit, tree: expected.source.tree } : null,
    run: format ? { id: expected.run.id, attempt: expected.run.attempt } : null,
    receipt: format ? { commit: expected.receipt.commit, digest: expected.receipt.digest } : null,
    level: ok ? selected.level : null,
    status: descriptor ? descriptor.status : null,
    reasons,
    jobs: descriptor ? descriptor.jobs : null,
    artifacts: descriptor ? descriptor.artifacts : null,
    bytes: descriptor ? descriptor.bytes : null,
    deferred: format ? [...format.deferred] : [],
    descriptorDigest: ok ? peerDescriptorDigest(descriptor) : null,
    collection: collection ?? null,
  };
}

/** The exit status for a result. */
export function exitFor(r) {
  return r.outcome === OUTCOMES.bytes.outcome ? OUTCOMES.bytes.exit
    : r.outcome === OUTCOMES.metadata.outcome ? OUTCOMES.metadata.exit
      : OUTCOMES.refused.exit;
}

/**
 * Collect, then ask B1 for the METADATA answer by name. The returned `saved` is the
 * envelope a later bytes run is bound to; it is null when nothing complete was collected.
 */
export async function observeMetadata({ expected, receipt, policy, fetchImpl, token, clock = () => Date.now() } = {}) {
  const { problems } = checkSelection(expected);
  if (problems.length > 0) {
    return { result: result({ mode: 'metadata', expected, selected: null, reasons: problems.map((p) => ({ code: 'journey.observe.selection_invalid', detail: p })) }), saved: null };
  }
  const approval = approvalProblem({ policy, expected, receipt });
  if (approval) return { result: result({ mode: 'metadata', expected, selected: null, reasons: [approval] }), saved: null };
  const collected = await collectObservations({ expected, fetchImpl, token, clock });
  if (!collected.ok) {
    return { result: result({ mode: 'metadata', expected, selected: null, reasons: collected.reasons, collection: collected.collection }), saved: null };
  }
  const selected = selectPeerCandidate({
    expected,
    observations: { ...collected.observations, receipt },
    now: new Date(clock()).toISOString(),
    require: 'metadata',
  });
  const saved = {
    schema: SAVED_SCHEMA,
    selectionDigest: digestOfValue(expected),
    peer: expected.peer,
    collection: collected.collection,
    observations: collected.observations,
  };
  return { result: result({ mode: 'metadata', expected, selected, reasons: selected.reasons, collection: collected.collection }), saved };
}

/** The saved observations for `expected`, or a reason. Nothing here came from bytes. */
export function readSaved(saved, expected) {
  if (!isObject(saved) || saved.schema !== SAVED_SCHEMA) return { observations: null, reason: asReason(new Refusal('observations_invalid', `the saved observations are not ${SAVED_SCHEMA}`)) };
  if (Object.keys(saved).some((k) => !SAVED_ENVELOPE_KEYS.includes(k))) return { observations: null, reason: asReason(new Refusal('observations_invalid', 'the saved observations carry an unexpected key')) };
  let wanted = null;
  try { wanted = digestOfValue(expected); } catch { /* reported below */ }
  if (saved.selectionDigest !== wanted) return { observations: null, reason: asReason(new Refusal('observations_foreign', 'the saved observations were collected for another selection')) };
  const o = saved.observations;
  if (!isObject(o) || Object.keys(o).length !== SAVED_KEYS.length || !SAVED_KEYS.every((k) => own(o, k))) {
    // A saved `archive`, `record` or `receipt` is refused: bytes come only from local
    // files, and the receipt only from the approved file.
    return { observations: null, reason: asReason(new Refusal('observations_invalid', `the saved observations must carry exactly ${SAVED_KEYS.join(', ')}`)) };
  }
  if (!Array.isArray(o.jobs) || !Array.isArray(o.artifacts)) return { observations: null, reason: asReason(new Refusal('observations_invalid', 'the saved listings are not page lists')) };
  return { observations: o, reason: null };
}

/**
 * OFFLINE: the saved observations plus local archive and record bytes, judged by B1 with
 * `require: 'bytes'`. Missing or non-byte input is refused before B1 is asked anything:
 * there is no metadata fall back from this mode.
 */
export function observeBytes({ expected, receipt, policy, saved, archive, record, now } = {}) {
  const { problems } = checkSelection(expected);
  if (problems.length > 0) {
    return result({ mode: 'bytes', expected, selected: null, reasons: problems.map((p) => ({ code: 'journey.observe.selection_invalid', detail: p })) });
  }
  const approval = approvalProblem({ policy, expected, receipt });
  if (approval) return result({ mode: 'bytes', expected, selected: null, reasons: [approval] });
  const missing = [];
  if (!isBytes(archive)) missing.push('archive');
  if (!isBytes(record)) missing.push('record');
  if (missing.length > 0) {
    return result({ mode: 'bytes', expected, selected: null, reasons: [asReason(new Refusal('bytes_input_missing', `no ${missing.join(' or ')} bytes were supplied; this mode never answers from metadata alone`))] });
  }
  const { observations, reason } = readSaved(saved, expected);
  if (reason) return result({ mode: 'bytes', expected, selected: null, reasons: [reason] });
  const selected = selectPeerCandidate({ expected, observations: { ...observations, receipt, archive, record }, now, require: 'bytes' });
  // The saved `collection` block is not echoed: it is file content, and only values this
  // module produced and validated are ever printed.
  return result({ mode: 'bytes', expected, selected, reasons: selected.reasons });
}
