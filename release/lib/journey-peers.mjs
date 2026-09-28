/**
 * JOURNEY PEERS: which EXACT peer candidate a cross-application journey may run against,
 * and what the supplied evidence does and does not establish about it (D16 / D08 B4, B1).
 *
 * THE QUESTION. A journey gate runs the certified Frontend beside an Admin and a Backend
 * build. Which builds? Not "latest main", not "whatever has an artifact", and not the
 * revision a receipt names merely because the receipt names it. The caller states an
 * EXPECTED SELECTION: repository, approved source commit and tree, the approved receipt's
 * identity, the producer workflow, event and ref, the exact run and attempt, and the jobs
 * that must have succeeded in that attempt. This module checks the OBSERVATIONS the caller
 * supplies (the API's own answers, and bytes where they were measured) against it, and
 * answers with named refusals or a small descriptor.
 *
 * THE PEERS' FORMATS ARE THEIR OWN. They are not erased into a common format:
 *   admin    Dinify-Admin ci.yml / job `validate` / push to refs/heads/main,
 *            artifact `admin-candidate-<run>-<attempt>`, record `certification.json`
 *            (dinify.admin.certification/1). Source: Dinify-Admin@94001b7
 *            release/policy.json, release/lib/admission.mjs selectCertification,
 *            release/lib/certification.mjs.
 *   backend  Dinify-Backend ci.yml / jobs `suite (3.12.3)`, `reconstruct`, `test` /
 *            push to refs/heads/main, artifacts `backend-candidate-<run>-<attempt>` and
 *            `backend-reconstruction-<run>-<attempt>` (and NEVER a
 *            `backend-candidate-nonpromotable-…` from the same attempt), record
 *            `record.json` (dinify.backend.candidate/1). Source: Dinify-Backend@7845b1c
 *            release/candidate.py, release/preflight.py select.
 *
 * THE OBSERVATIONS are the raw API documents, never pre-normalized by the caller, so a
 * caller cannot pre-bless a field:
 *   workflow   GET /repos/{r}/actions/workflows/ci.yml
 *   run        GET /repos/{r}/actions/runs/{id}/attempts/{attempt}
 *   latestRun  GET /repos/{r}/actions/runs/{id}
 *   jobs       every page of GET /repos/{r}/actions/runs/{id}/attempts/{attempt}/jobs
 *   artifacts  every page of GET /repos/{r}/actions/runs/{id}/artifacts
 *   commit     GET /repos/{r}/git/commits/{sha}
 *   receipt    the committed peer receipt (release/peers/<peer>-<commit>.json)
 *   archive    OPTIONAL bytes: the downloaded candidate archive, exactly as downloaded
 *   record     OPTIONAL bytes: the candidate's record file, as a future adapter extracts it
 * An unknown observation key is refused. A caller's `verified: true` is therefore not a
 * shortcut: it is an unknown key.
 *
 * WHAT A PASSING ANSWER MEANS, stated exactly:
 *   level 'metadata'  the listing, run, attempt jobs, commit and receipt agree with the
 *                     expected selection. No byte of the candidate was observed.
 *   level 'bytes'     additionally: THIS module hashed the supplied archive bytes and they
 *                     equal the provider-listed digest, and it hashed and parsed the
 *                     supplied record bytes and every claim it reads agrees with the
 *                     selection.
 * Neither level is a verified or admitted candidate, and neither is a reconstruction. Three
 * digests are kept apart throughout: the digest the PROVIDER LISTED, the digest a RECORD
 * CLAIMS, and a digest THIS MODULE MEASURED. Only the last is a measurement. Hash
 * correspondence is not a signature, a code review, a vulnerability assessment or proof of
 * every producer claim.
 *
 * DEFERRED to the peer's own trusted consumer, and named in every descriptor (`deferred`):
 * that the record bytes came from INSIDE this archive, that the archive holds no hidden,
 * duplicate or unexpected members, the payload, source and wheel bytes, the audit
 * evidence and its re-decision, and (Backend) the offline environment reconstruction on
 * the target and the reconstruction report bound to this record. A supplied entry list is
 * a CLAIM: its paths are validated and its declared digest is recomputed from it, which
 * proves the record is self-consistent and nothing about the archive.
 *
 * `require` defaults to 'bytes', so a caller must opt in to the weaker answer by name.
 *
 * Pure. No network client, downloader, archive extractor, subprocess, credential read,
 * environment read or implicit clock. `now` is an argument and is required.
 */

import { createHash } from 'node:crypto';

import { canonicalJson, digestOf, digestOfValue, treeDigest } from './canonical.mjs';
import { receiptDigest, validateReceipt } from './peers.mjs';

export const SELECTION_SCHEMA = 'dinify.journey.peer-selection/1';
export const DESCRIPTOR_SCHEMA = 'dinify.journey.peer-descriptor/1';
export const REQUIRE_LEVELS = Object.freeze(['metadata', 'bytes']);

const SHA_RE = /^[0-9a-f]{40}$/;
const HEX_RE = /^[0-9a-f]{64}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const ID_RE = /^[1-9][0-9]{0,19}$/;
const ATTEMPT_RE = /^[1-9][0-9]{0,3}$/;
const JOB_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,99}$/;
const KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,40}$/;
const ARTIFACT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
// Dinify-Admin release/lib/tree.mjs pathProblem: components of [A-Za-z0-9._@+~-], no
// empty, `.` or `..` component, at most 240 UTF-8 bytes.
const ADMIN_COMPONENT_RE = /^[A-Za-z0-9._@+~-]+$/;
const ADMIN_MAX_PATH_BYTES = 240;
// A Backend wheelhouse entry is ONE file name, never a path.
const WHEEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,199}\.whl$/;
// The audit outcomes both producers certify under (Dinify-Admin certification.mjs
// PASSING; Dinify-Backend candidate.py ACCEPTED_AUDIT_OUTCOMES). A CLAIM, re-decided from
// the raw output only by the peer's own consumer.
const PASSING_AUDIT = Object.freeze(['within_policy', 'exceptions_only']);

/** Bounds on what is accepted at all. Anything larger is refused unread. */
export const LIMITS = Object.freeze({
  maxPages: 10,
  maxPerPage: 100,
  maxRequiredJobs: 32,
  maxReceiptBytes: 64 * 1024,
  maxRecordBytes: 1024 * 1024,
  maxArchiveBytes: 512 * 1024 * 1024,
  maxEntries: 10000,
  maxClaimString: 200,
});

/**
 * THE REVIEWED PEER FORMATS. The expected selection must agree with these; it may name
 * MORE required jobs, never fewer. Frozen, and pinned by the tests.
 */
export const PEER_FORMATS = Object.freeze({
  admin: Object.freeze({
    repository: 'mugak1/Dinify-Admin',
    workflowPath: '.github/workflows/ci.yml',
    event: 'push',
    ref: 'refs/heads/main',
    requiredJobs: Object.freeze(['validate']),
    candidatePrefix: 'admin-candidate',
    companions: Object.freeze([]),
    contradictoryPrefixes: Object.freeze([]),
    recordFile: 'certification.json',
    recordSchemas: Object.freeze(['dinify.admin.certification/1']),
    deferred: Object.freeze([
      'archive-members: the archive holds exactly certification.json, payload.tar.gz and the listed evidence files, each once, with no link or hidden member',
      'record-membership: the record bytes are the certification.json inside THIS archive',
      'payload-archive: payload.tar.gz bytes are the recorded archive',
      'payload-tree: the extracted payload tree digest, recomputed from its bytes, is the recorded one',
      'evidence-and-audit: the evidence files and the audit re-decision from their raw output',
      'source-digest: the recorded source digest against the commit tree as the API states it',
    ]),
  }),
  backend: Object.freeze({
    repository: 'mugak1/Dinify-Backend',
    workflowPath: '.github/workflows/ci.yml',
    event: 'push',
    ref: 'refs/heads/main',
    requiredJobs: Object.freeze(['suite (3.12.3)', 'reconstruct', 'test']),
    candidatePrefix: 'backend-candidate',
    companions: Object.freeze([Object.freeze({ key: 'reconstruction', prefix: 'backend-reconstruction' })]),
    contradictoryPrefixes: Object.freeze(['backend-candidate-nonpromotable']),
    recordFile: 'record.json',
    recordSchemas: Object.freeze(['dinify.backend.candidate/1']),
    // The target the lock declares and the consumer reconstructs on (Dinify-Backend
    // release/python-lock.json `target`, release/environment.py target_problems): the
    // record's claimed target must be it, with glibc at least the declared version.
    target: Object.freeze({ python: '3.12.3', implementation: 'CPython', platform: 'linux', machine: 'x86_64', glibcMinimum: Object.freeze([2, 39]) }),
    deferred: Object.freeze([
      'archive-members: the archive holds exactly record.json, source.tar and the listed wheelhouse and evidence files, each once, with no link or hidden member',
      'record-membership: the record bytes are the record.json inside THIS archive',
      'source-archive: source.tar bytes and the tree they export, against the commit',
      'wheelhouse-bytes: every wheel file against the lock and the record',
      'evidence-and-audit: the evidence files and the audit re-decision from their raw output',
      'environment-reconstruction: the offline rebuild by the trusted consumer checkout on the target (CPython 3.12.3, Linux x86_64, glibc 2.39 minimum)',
      'reconstruction-report: the backend-reconstruction artifact bound to this record',
    ]),
  }),
});

const OBSERVATION_KEYS = Object.freeze(['workflow', 'run', 'latestRun', 'jobs', 'artifacts', 'commit', 'receipt', 'archive', 'record']);
const REQUIRED_OBSERVATIONS = Object.freeze(['workflow', 'run', 'latestRun', 'jobs', 'artifacts', 'commit', 'receipt']);
const SELECTION_KEYS = Object.freeze(['schema', 'peer', 'repository', 'source', 'receipt', 'producer', 'run', 'requiredJobs']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => isObject(o) && Object.prototype.hasOwnProperty.call(o, k);
const isBytes = (v) => v instanceof Uint8Array;
const sameKeys = (o, keys) => isObject(o) && Object.keys(o).length === keys.length && keys.every((k) => own(o, k));
/** A value from outside is only echoed into a diagnostic if it matches a strict shape. */
const shown = (v, re) => (typeof v === 'string' && re.test(v) ? v : typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : '<omitted>');
const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const branchOf = (ref) => (typeof ref === 'string' && ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null);

/** `<prefix>-<run>-<attempt>`: the name every peer producer gives an attempt's artifact. */
export function attemptArtifactName(prefix, runId, attempt) {
  return `${prefix}-${runId}-${attempt}`;
}

/** Dinify-Backend release/candidate.py listing_digest: unprefixed hex over sorted lines. */
export function backendListingDigest(files) {
  const lines = [...files]
    .sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0))
    .map((e) => `${e.filename}\0${e.sha256}\0${e.size}\n`)
    .join('');
  return sha256Hex(Buffer.from(lines, 'utf8'));
}

/** Null when `path` is a canonical Admin payload/evidence path, otherwise why not. */
export function adminPathProblem(path) {
  if (typeof path !== 'string' || path.length === 0) return 'empty path';
  if (Buffer.byteLength(path, 'utf8') > ADMIN_MAX_PATH_BYTES) return 'path too long';
  for (const part of path.split('/')) {
    if (part === '') return 'empty component';
    if (part === '.' || part === '..') return 'dot component';
    if (!ADMIN_COMPONENT_RE.test(part)) return 'character outside the payload alphabet';
  }
  return null;
}

// ── the expected selection ──────────────────────────────────────────────────────

/**
 * Is this a complete, well-formed selection that agrees with the peer's reviewed format?
 * Returns {format, problems}. A selection is never completed or corrected here.
 */
export function checkSelection(expected) {
  const problems = [];
  const bad = (detail) => problems.push(detail);
  if (!sameKeys(expected, SELECTION_KEYS)) {
    return { format: null, problems: ['the selection must carry exactly schema, peer, repository, source, receipt, producer, run and requiredJobs'] };
  }
  if (expected.schema !== SELECTION_SCHEMA) bad(`schema is not ${SELECTION_SCHEMA}`);
  const format = own(PEER_FORMATS, expected.peer) ? PEER_FORMATS[expected.peer] : null;
  if (!format) return { format: null, problems: [...problems, 'peer is not admin or backend'] };
  if (expected.repository !== format.repository) bad(`repository is not ${format.repository}`);
  const s = expected.source;
  if (!sameKeys(s, ['commit', 'tree']) || !SHA_RE.test(String(s.commit)) || !SHA_RE.test(String(s.tree))) bad('source must be {commit, tree} as full SHAs');
  const r = expected.receipt;
  if (!sameKeys(r, ['commit', 'digest']) || !DIGEST_RE.test(String(r.digest)) || r.commit !== s?.commit) {
    bad('receipt must be {commit, digest} naming the same commit as source');
  }
  const p = expected.producer;
  if (!sameKeys(p, ['workflowPath', 'event', 'ref']) || p.workflowPath !== format.workflowPath || p.event !== format.event || p.ref !== format.ref) {
    // A pull-request or other-branch run is never a main candidate.
    bad(`producer must be ${format.workflowPath} on ${format.event} to ${format.ref}`);
  }
  const run = expected.run;
  if (!sameKeys(run, ['id', 'attempt']) || !ID_RE.test(String(run.id)) || !ATTEMPT_RE.test(String(run.attempt))
      || typeof run.id !== 'string' || typeof run.attempt !== 'string') {
    bad('run must be {id, attempt} as decimal strings');
  }
  const jobs = expected.requiredJobs;
  if (!Array.isArray(jobs) || jobs.length === 0 || jobs.length > LIMITS.maxRequiredJobs
      || !jobs.every((j) => typeof j === 'string' && JOB_NAME_RE.test(j)) || new Set(jobs).size !== jobs.length) {
    bad('requiredJobs must be a non-empty list of distinct job names');
  } else {
    for (const j of format.requiredJobs) if (!jobs.includes(j)) bad(`requiredJobs omits ${j}, which the ${expected.peer} format requires`);
  }
  return { format, problems };
}

// ── listings, page by page ──────────────────────────────────────────────────────

/**
 * Join paged API answers into one list, or say why that cannot be done. Every page must
 * state the same total, the entries must add up to it exactly, and no id may repeat.
 */
function joinPages(pages, key) {
  const list = Array.isArray(pages) ? pages : [pages];
  if (list.length === 0 || list.length > LIMITS.maxPages) return { entries: null, problem: `${list.length} pages` };
  let total = null;
  const entries = [];
  for (const page of list) {
    if (!isObject(page) || !Number.isSafeInteger(page.total_count) || page.total_count < 0 || !Array.isArray(page[key])) {
      return { entries: null, problem: 'a page is not a listing' };
    }
    if (page[key].length > LIMITS.maxPerPage) return { entries: null, problem: 'a page is larger than the API returns' };
    if (total === null) total = page.total_count;
    else if (page.total_count !== total) return { entries: null, problem: 'pages disagree about the total' };
    entries.push(...page[key]);
  }
  if (entries.length !== total) return { entries: null, problem: `${entries.length} entries for a stated total of ${total}` };
  const ids = entries.map((e) => (isObject(e) ? e.id : undefined));
  if (!ids.every((id) => Number.isSafeInteger(id) && id > 0) || new Set(ids).size !== ids.length) {
    return { entries: null, problem: 'an entry has no usable id, or an id repeats across pages' };
  }
  return { entries, problem: null };
}

// ── the main question ───────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {object} input.expected       the expected selection (SELECTION_SCHEMA)
 * @param {object} input.observations   the raw observations (see the module comment)
 * @param {string} input.now            ISO-8601; required, used only for artifact expiry
 * @param {string} [input.require]      'bytes' (default) or 'metadata'
 * @returns {{ok: boolean, level: string|null, reasons: Array<{code, detail}>, descriptor: object|null}}
 */
export function selectPeerCandidate({ expected, observations, now, require = 'bytes' } = {}) {
  const reasons = [];
  const refuse = (code, detail) => reasons.push({ code: `journey.peers.${code}`, detail: String(detail) });
  const done = (level, descriptor) => ({ ok: reasons.length === 0, level: reasons.length === 0 ? level : null, reasons, descriptor: reasons.length === 0 ? descriptor : null });

  if (!REQUIRE_LEVELS.includes(require)) {
    refuse('request_invalid', 'require must be metadata or bytes');
    return done(null, null);
  }
  const nowMs = typeof now === 'string' ? Date.parse(now) : NaN;
  if (!Number.isFinite(nowMs)) {
    refuse('clock_missing', 'an explicit ISO-8601 now is required; no clock is read here');
    return done(null, null);
  }
  const { format, problems } = checkSelection(expected);
  if (problems.length > 0 || !format) {
    for (const p of problems) refuse('selection_invalid', p);
    return done(null, null);
  }
  const o = observations;
  if (!isObject(o)) {
    refuse('observation_missing', 'no observations were supplied');
    return done(null, null);
  }
  for (const key of Object.keys(o)) if (!OBSERVATION_KEYS.includes(key)) refuse('observation_unknown', shown(key, KEY_RE));
  for (const key of REQUIRED_OBSERVATIONS) if (!own(o, key) || o[key] === undefined || o[key] === null) refuse('observation_missing', key);
  if (reasons.length > 0) return done(null, null);

  const repo = expected.repository;
  const commit = expected.source.commit;
  const tree = expected.source.tree;
  const runId = expected.run.id;
  const attempt = expected.run.attempt;
  const branch = branchOf(expected.producer.ref);

  // THE WORKFLOW, THE ATTEMPT AND THE RUN AS IT STANDS NOW.
  const wf = o.workflow;
  if (!isObject(wf) || !Number.isSafeInteger(wf.id) || wf.path !== expected.producer.workflowPath) {
    refuse('workflow_mismatch', `the workflow observation is not ${expected.producer.workflowPath}`);
  }
  const run = o.run;
  if (!isObject(run)) {
    refuse('observation_missing', 'run');
  } else {
    if (String(run.id) !== runId) refuse('run_mismatch', `the run read is ${shown(run.id, ID_RE)}, not ${runId}`);
    if (String(run.run_attempt) !== attempt) refuse('attempt_mismatch', `the attempt read is ${shown(run.run_attempt, ATTEMPT_RE)}, not ${attempt}`);
    if (!isObject(wf) || run.workflow_id !== wf.id || run.path !== expected.producer.workflowPath) {
      refuse('run_wrong_workflow', `run ${runId} is not a run of ${expected.producer.workflowPath}`);
    }
    if (run.repository?.full_name !== repo || run.head_repository?.full_name !== repo) {
      refuse('run_wrong_repository', `run ${runId} is not a run of ${repo} on its own branch`);
    }
    if (run.event !== expected.producer.event || run.head_branch !== branch) {
      refuse('run_wrong_event', `run ${runId} was not a ${expected.producer.event} to ${expected.producer.ref}`);
    }
    if (run.head_sha !== commit) refuse('run_wrong_source', `run ${runId} is for ${shown(run.head_sha, SHA_RE)}, the selection is ${commit}`);
    if (run.status !== 'completed' || run.conclusion !== 'success') refuse('run_not_successful', `run ${runId} attempt ${attempt} did not complete successfully`);
  }
  const latest = o.latestRun;
  if (!isObject(latest) || String(latest.id) !== runId) {
    refuse('run_mismatch', `the current run observation is not run ${runId}`);
  } else if (String(latest.run_attempt) !== attempt) {
    // A later attempt is a DIFFERENT certification of the same commit; a selection made
    // before it names an attempt that is no longer the run's answer.
    refuse('attempt_superseded', `run ${runId} is now at attempt ${shown(latest.run_attempt, ATTEMPT_RE)}; the selection names ${attempt}`);
  }

  // THE SOURCE, AS THE API AND THE RECEIPT STATE IT.
  const c = o.commit;
  if (!isObject(c) || c.sha !== commit || !isObject(c.tree) || c.tree.sha !== tree) {
    refuse('source_tree_mismatch', `the commit observation does not state ${commit} with tree ${tree}`);
  }
  const receipt = o.receipt;
  let receiptOk = false;
  try {
    if (Buffer.byteLength(canonicalJson(receipt), 'utf8') > LIMITS.maxReceiptBytes) {
      refuse('receipt_invalid', 'the receipt is larger than any receipt this repository produces');
    } else {
      const check = validateReceipt(receipt, { peer: expected.peer, repository: repo, commit });
      for (const p of check.problems) refuse('receipt_invalid', p.code);
      if (check.ok) {
        if (receiptDigest(receipt) !== expected.receipt.digest) refuse('receipt_mismatch', 'the receipt is not the approved receipt');
        else if (receipt.tree !== tree) refuse('receipt_mismatch', 'the receipt names another tree');
        else receiptOk = true;
      }
    }
  } catch {
    refuse('receipt_invalid', 'the receipt is not plain data');
  }

  // THE JOBS OF THE SELECTED ATTEMPT, EVERY PAGE.
  const jobs = joinPages(o.jobs, 'jobs');
  const selectedJobs = [];
  if (jobs.problem) {
    refuse('jobs_listing_incomplete', jobs.problem);
  } else {
    for (const job of jobs.entries) {
      if (String(job.run_id) !== runId || String(job.run_attempt) !== attempt || job.head_sha !== commit) {
        // A partial re-run carries earlier attempts' jobs into a later attempt. One
        // attempt's candidate cannot be vouched for by another attempt's checks.
        refuse('mixed_attempt', `job ${shown(job.name, JOB_NAME_RE)} is from run ${shown(job.run_id, ID_RE)} attempt ${shown(job.run_attempt, ATTEMPT_RE)}, not ${runId} attempt ${attempt}`);
      } else if (job.status !== 'completed' || job.conclusion !== 'success') {
        refuse('job_not_successful', `job ${shown(job.name, JOB_NAME_RE)} of attempt ${attempt} did not succeed`);
      }
    }
    for (const name of expected.requiredJobs) {
      const named = jobs.entries.filter((j) => j.name === name);
      if (named.length === 0) refuse('required_job_missing', name);
      else if (named.length > 1) refuse('required_job_duplicate', `${named.length} jobs named ${name}`);
      else selectedJobs.push({ name, id: String(named[0].id) });
    }
  }

  // THE ARTIFACTS OF THE RUN, EVERY PAGE. Ambiguity concerns ELIGIBLE candidates only: an
  // unrelated artifact, or another attempt's candidate, is not a second candidate.
  const artifacts = joinPages(o.artifacts, 'artifacts');
  const chosen = {};
  if (artifacts.problem) {
    refuse('artifact_listing_incomplete', artifacts.problem);
  } else {
    for (const prefix of format.contradictoryPrefixes) {
      const name = attemptArtifactName(prefix, runId, attempt);
      if (artifacts.entries.some((a) => a.name === name)) refuse('candidate_contradictory', `attempt ${attempt} also lists ${name}`);
    }
    const wanted = [{ key: 'candidate', prefix: format.candidatePrefix }, ...format.companions];
    for (const { key, prefix } of wanted) {
      const name = attemptArtifactName(prefix, runId, attempt);
      const matches = artifacts.entries.filter((a) => a.name === name);
      if (matches.length === 0) { refuse(`${key}_missing`, `run ${runId} attempt ${attempt} lists no ${name}`); continue; }
      if (matches.length > 1) { refuse(`${key}_ambiguous`, `run ${runId} lists ${matches.length} artifacts named ${name}`); continue; }
      const listed = listedArtifact(matches[0], { name, runId, commit, branch, run, nowMs, refuse });
      if (listed) chosen[key] = listed;
    }
  }

  // BYTES, WHERE THEY WERE MEASURED HERE — AND ONLY THEN.
  let archiveState = 'not-observed';
  let archiveMeasured = null;
  if (own(o, 'archive') && o.archive !== undefined) {
    if (!isBytes(o.archive) || o.archive.length > LIMITS.maxArchiveBytes) {
      refuse('archive_bytes_invalid', 'the archive observation must be the downloaded bytes, within the size bound');
    } else {
      archiveMeasured = digestOf(o.archive);
      if (!chosen.candidate) {
        refuse('archive_unbound', 'archive bytes were supplied but no listed candidate digest was selected to compare them with');
      } else if (archiveMeasured !== chosen.candidate.listedDigest) {
        refuse('archive_digest_mismatch', 'the measured archive digest is not the digest the provider listed');
      } else {
        archiveState = 'measured-match';
      }
    }
  }
  let recordState = 'not-observed';
  let recordMeasured = null;
  let claims = null;
  if (own(o, 'record') && o.record !== undefined) {
    const parsed = readRecordBytes(o.record);
    if (parsed.problem) {
      refuse('record_unreadable', parsed.problem);
    } else {
      recordMeasured = parsed.digest;
      const ctx = { expected, format, runId, attempt, commit, tree, repo };
      const checked = expected.peer === 'admin' ? adminRecord(parsed.value, ctx) : backendRecord(parsed.value, ctx);
      for (const p of checked.problems) refuse(p.code, p.detail);
      if (checked.problems.length === 0) { recordState = 'consistent'; claims = checked.claims; }
    }
  }
  if (require === 'bytes') {
    if (!own(o, 'archive') || o.archive === undefined) refuse('bytes_not_observed', 'no archive bytes were supplied; metadata cannot establish byte correspondence');
    if (!own(o, 'record') || o.record === undefined) refuse('bytes_not_observed', 'no record bytes were supplied; the record claims were not read');
  }

  const descriptor = {
    schema: DESCRIPTOR_SCHEMA,
    peer: expected.peer,
    repository: repo,
    source: { commit, tree },
    receipt: { commit: expected.receipt.commit, digest: expected.receipt.digest, validated: receiptOk },
    producer: { workflowPath: expected.producer.workflowPath, workflowId: isObject(wf) ? wf.id : null, event: expected.producer.event, ref: expected.producer.ref },
    run: { id: runId, attempt },
    jobs: selectedJobs,
    artifacts: chosen,
    bytes: {
      archive: { listedDigest: chosen.candidate?.listedDigest ?? null, measuredDigest: archiveMeasured, state: archiveState },
      record: { file: format.recordFile, measuredDigest: recordMeasured, state: recordState },
    },
    claims,
    deferred: [...format.deferred],
    status: archiveState === 'measured-match' && recordState === 'consistent'
      ? 'bytes-correspond-consumer-checks-deferred'
      : 'metadata-consistent-bytes-not-established',
  };
  return done(archiveState === 'measured-match' && recordState === 'consistent' ? 'bytes' : 'metadata', descriptor);
}

/**
 * The digest a journey record binds a downloaded peer to (`inputs.peers.<peer>.
 * descriptorDigest`): the digest of a BYTES-level descriptor this module returned, or null
 * for anything else, a metadata-level descriptor included. A caller deriving its expected
 * inputs uses this, so a metadata-only selection cannot stand behind a certified record.
 */
export function peerDescriptorDigest(descriptor) {
  if (!isObject(descriptor) || descriptor.schema !== DESCRIPTOR_SCHEMA || descriptor.status !== 'bytes-correspond-consumer-checks-deferred') return null;
  return digestOfValue(descriptor);
}

/** One listed artifact, judged against the selection. Returns its facts or null. */
function listedArtifact(a, { name, runId, commit, branch, run, nowMs, refuse }) {
  if (!Number.isSafeInteger(a.id) || a.id <= 0 || !DIGEST_RE.test(String(a.digest)) || !Number.isSafeInteger(a.size_in_bytes) || a.size_in_bytes < 0) {
    refuse('artifact_listing_invalid', `${name} carries no usable id, digest or size`);
    return null;
  }
  let ok = true;
  const expires = typeof a.expires_at === 'string' ? Date.parse(a.expires_at) : NaN;
  if (a.expired !== false) { refuse('artifact_expired', `${name} is expired or states no expiry`); ok = false; }
  else if (!Number.isFinite(expires)) { refuse('artifact_expired', `${name} states no readable expiry`); ok = false; }
  else if (expires <= nowMs) { refuse('artifact_expired', `${name} expired at ${new Date(expires).toISOString()}`); ok = false; }
  const wr = a.workflow_run;
  if (!isObject(wr) || String(wr.id) !== runId || wr.head_sha !== commit || wr.head_branch !== branch) {
    refuse('artifact_wrong_run', `${name} is not listed as run ${runId}'s for ${commit}`);
    ok = false;
  } else if (!Number.isSafeInteger(wr.repository_id) || wr.repository_id !== wr.head_repository_id
      || (isObject(run?.repository) && Number.isSafeInteger(run.repository.id) && run.repository.id !== wr.repository_id)) {
    refuse('artifact_wrong_repository', `${name} was not produced in the selected repository`);
    ok = false;
  }
  if (!ok) return null;
  return { id: a.id, name, listedDigest: a.digest, size: a.size_in_bytes, expiresAt: new Date(expires).toISOString() };
}

/** Bytes → a parsed JSON object, measured by this module. Never a string, never a claim. */
function readRecordBytes(bytes) {
  if (!isBytes(bytes)) return { problem: 'the record observation must be bytes' };
  if (bytes.length === 0 || bytes.length > LIMITS.maxRecordBytes) return { problem: 'the record is empty or larger than the bound' };
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return { problem: 'the record is not UTF-8' };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { problem: 'the record is not JSON' };
  }
  if (!isObject(value)) return { problem: 'the record is not a JSON object' };
  return { value, digest: digestOf(bytes) };
}

// ── the peers' own records: only the fields this selection depends on ──────────

const claimString = (v) => (typeof v === 'string' && v.length <= LIMITS.maxClaimString ? v : null);

function entryList(list, { max = LIMITS.maxEntries } = {}) {
  return Array.isArray(list) && list.length > 0 && list.length <= max ? list : null;
}

function adminRecord(r, ctx) {
  const problems = [];
  const bad = (code, detail) => problems.push({ code, detail });
  if (!ctx.format.recordSchemas.includes(r.schema)) {
    bad('record_unsupported', `record schema ${shown(r.schema, /^[a-z.]+\/[0-9]+$/)} is not supported`);
    return { problems, claims: null };
  }
  if (r.repository !== ctx.repo || r.commit !== ctx.commit || r.tree !== ctx.tree) bad('record_mismatch', 'the record names another repository, commit or tree');
  const w = r.workflow;
  if (!isObject(w) || w.path !== ctx.expected.producer.workflowPath || !ctx.format.requiredJobs.includes(w.job)
      || w.event !== ctx.expected.producer.event || w.gitRef !== ctx.expected.producer.ref
      || w.runId !== ctx.runId || w.runAttempt !== ctx.attempt) {
    bad('record_mismatch', 'the record was not certified by the selected workflow, event, run and attempt');
  }
  const p = r.payload;
  const entries = isObject(p) ? entryList(p.entries) : null;
  if (!entries) {
    bad('record_entry_invalid', 'the payload entry list is missing, empty or unbounded');
  } else {
    const entryProblem = adminEntries(entries);
    if (entryProblem) bad('record_entry_invalid', `payload ${entryProblem}`);
    else {
      let recomputed = null;
      try { recomputed = treeDigest(entries); } catch { /* reported below */ }
      if (!DIGEST_RE.test(String(p.treeDigest)) || recomputed !== p.treeDigest || p.entryCount !== entries.length) {
        bad('record_inconsistent', 'the payload tree digest or count is not the one its own entries compose');
      }
      const paths = new Set(entries.map((e) => e.path));
      if (!paths.has('index.html') || !paths.has('release.txt')) bad('record_inconsistent', 'the payload lists no index.html or release.txt');
    }
    if (!isObject(p.release) || p.release.path !== 'release.txt' || p.release.commit !== ctx.commit) bad('record_mismatch', 'the payload release marker names another commit');
    if (!isObject(p.archive) || p.archive.path !== 'payload.tar.gz' || !HEX_RE.test(String(p.archive.sha256)) || !Number.isSafeInteger(p.archive.bytes)) {
      bad('record_entry_invalid', 'the payload archive claim is malformed');
    }
  }
  const ev = r.evidence;
  const evEntries = isObject(ev) ? entryList(ev.files) : null;
  if (!evEntries) {
    bad('record_entry_invalid', 'the evidence file list is missing, empty or unbounded');
  } else {
    const entryProblem = adminEntries(evEntries);
    if (entryProblem) bad('record_entry_invalid', `evidence ${entryProblem}`);
    else {
      let recomputed = null;
      try { recomputed = treeDigest(evEntries); } catch { /* reported below */ }
      if (recomputed !== ev.treeDigest) bad('record_inconsistent', 'the evidence tree digest is not the one its own entries compose');
    }
  }
  if (!isObject(r.source) || !DIGEST_RE.test(String(r.source.digest))) bad('record_entry_invalid', 'the source digest claim is malformed');
  const outcome = r.audit?.outcome;
  if (!PASSING_AUDIT.includes(outcome)) bad('record_audit_not_passing', 'the record does not claim a passing dependency audit');
  if (problems.length > 0) return { problems, claims: null };
  return {
    problems,
    claims: {
      kind: 'producer-claims',
      auditOutcome: outcome,
      payloadTreeDigest: p.treeDigest,
      payloadEntryCount: p.entryCount,
      payloadArchiveSha256: `sha256:${p.archive.sha256}`,
      evidenceTreeDigest: ev.treeDigest,
      sourceDigest: r.source.digest,
      buildNode: claimString(r.build?.environment?.node),
    },
  };
}

function adminEntries(entries) {
  const seen = new Set();
  for (const e of entries) {
    if (!sameKeys(e, ['path', 'sha256', 'bytes']) || !HEX_RE.test(String(e.sha256)) || !Number.isSafeInteger(e.bytes) || e.bytes < 0) {
      return 'has an entry that is not exactly {path, sha256, bytes}';
    }
    const problem = adminPathProblem(e.path);
    if (problem) return `has an unsafe path (${problem})`;
    if (seen.has(e.path)) return 'lists a path twice';
    seen.add(e.path);
  }
  // A path that is both a file and the parent of another is ambiguous on disk.
  for (const path of seen) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i += 1) if (seen.has(parts.slice(0, i).join('/'))) return 'lists a file that is also a directory';
  }
  return null;
}

function backendRecord(r, ctx) {
  const problems = [];
  const bad = (code, detail) => problems.push({ code, detail });
  if (!ctx.format.recordSchemas.includes(r.schema)) {
    bad('record_unsupported', `record schema ${shown(r.schema, /^[a-z.]+\/[0-9]+$/)} is not supported`);
    return { problems, claims: null };
  }
  if (r.repository !== ctx.repo || r.commit !== ctx.commit || r.tree !== ctx.tree) bad('record_mismatch', 'the record names another repository, commit or tree');
  if (!isObject(r.eligibility) || r.eligibility.promotable !== true) bad('record_not_promotable', 'the record does not state a promotable push-to-main candidate');
  const name = attemptArtifactName(ctx.format.candidatePrefix, ctx.runId, ctx.attempt);
  if (!isObject(r.artifact) || r.artifact.name !== name) bad('record_mismatch', `the record names another artifact than ${name}`);
  const ci = r.ci;
  const workflowRef = `${ctx.repo}/${ctx.expected.producer.workflowPath}@${ctx.expected.producer.ref}`;
  if (!isObject(ci) || ci.repository !== ctx.repo || ci.event !== ctx.expected.producer.event || ci.ref !== ctx.expected.producer.ref
      || ci.sha !== ctx.commit || ci.runId !== ctx.runId || ci.runAttempt !== ctx.attempt || ci.workflowRef !== workflowRef) {
    bad('record_mismatch', 'the record was not produced by the selected workflow, event, run and attempt');
  }
  const src = r.source;
  if (!isObject(src) || src.tree !== ctx.tree || !isObject(src.archive) || src.archive.path !== 'source.tar'
      || !HEX_RE.test(String(src.archive.sha256)) || !Number.isSafeInteger(src.archive.size) || !HEX_RE.test(String(src.contentSha256))) {
    bad('record_mismatch', 'the source claim is malformed or names another tree');
  }
  const wh = r.wheelhouse;
  const files = isObject(wh) ? entryList(wh.files, { max: 1000 }) : null;
  if (!files) {
    bad('record_entry_invalid', 'the wheelhouse file list is missing, empty or unbounded');
  } else {
    const seen = new Set();
    let entryProblem = null;
    for (const f of files) {
      if (!sameKeys(f, ['filename', 'sha256', 'size']) || !WHEEL_NAME_RE.test(String(f.filename)) || !HEX_RE.test(String(f.sha256))
          || !Number.isSafeInteger(f.size) || f.size < 0) { entryProblem = 'has an entry that is not exactly {filename, sha256, size} naming one wheel'; break; }
      if (seen.has(f.filename)) { entryProblem = 'lists a wheel twice'; break; }
      seen.add(f.filename);
    }
    if (entryProblem) bad('record_entry_invalid', `wheelhouse ${entryProblem}`);
    else if (!HEX_RE.test(String(wh.digest)) || backendListingDigest(files) !== wh.digest) {
      bad('record_inconsistent', 'the wheelhouse digest is not the one its own file list composes');
    }
  }
  const lock = r.inputs?.lock;
  const reqs = r.inputs?.requirements;
  if (!isObject(lock) || !HEX_RE.test(String(lock.sha256)) || !isObject(reqs) || !HEX_RE.test(String(reqs.sha256))) {
    bad('record_entry_invalid', 'the lock or requirements claim is malformed');
  }
  if (!isObject(r.environment) || !HEX_RE.test(String(r.environment.digest))) bad('record_entry_invalid', 'the environment digest claim is malformed');
  const outcome = r.audit?.outcome;
  if (!PASSING_AUDIT.includes(outcome)) bad('record_audit_not_passing', 'the record does not claim a passing dependency audit');
  const t = isObject(r.target) ? r.target : {};
  const want = ctx.format.target;
  const glibc = typeof t.libc === 'string' ? /^glibc ([0-9]{1,3})\.([0-9]{1,3})$/.exec(t.libc) : null;
  const glibcOk = glibc !== null && (Number(glibc[1]) > want.glibcMinimum[0]
    || (Number(glibc[1]) === want.glibcMinimum[0] && Number(glibc[2]) >= want.glibcMinimum[1]));
  if (!isObject(r.target) || t.python !== want.python || t.implementation !== want.implementation || t.platform !== want.platform
      || t.machine !== want.machine || !glibcOk) {
    // A candidate built for another interpreter, machine or C library cannot be
    // reconstructed on the reviewed target, so it is not selected.
    bad('record_target_unsupported', `the record's target is not ${want.implementation} ${want.python} on ${want.platform} ${want.machine} with glibc ${want.glibcMinimum.join('.')} or later`);
  }
  if (problems.length > 0) return { problems, claims: null };
  return {
    problems,
    claims: {
      kind: 'producer-claims',
      sourceArchiveSha256: `sha256:${src.archive.sha256}`,
      sourceContentSha256: src.contentSha256,
      wheelhouseDigest: wh.digest,
      wheelCount: files.length,
      environmentDigest: r.environment.digest,
      lockSha256: lock.sha256,
      requirementsSha256: reqs.sha256,
      auditOutcome: outcome,
      target: { python: t.python, implementation: t.implementation, platform: t.platform, machine: t.machine, libc: t.libc },
    },
  };
}
