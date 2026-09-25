/**
 * DEPENDENCY EVIDENCE FOR ONE CANDIDATE — certification-time, fresh, and the toolchain
 * that will publish it (D08 B2.2).
 *
 * THE GUARANTEE THIS FILE SERVES: the exact bytes considered for promotion are associated
 * with verifiable certification-time dependency evidence, and a FRESH assessment of that
 * same dependency inventory and of the actual publication toolchain must be acceptable
 * before publication authority is used. Rebuilding the app, scanning current main,
 * updating a timestamp, or independently resolving publisher dependencies cannot
 * substitute for either half.
 *
 * THREE RECORDS, three different claims, never merged:
 *
 *   dependency-evidence/record.json   CERTIFICATION. Ships BESIDE dist/ in the candidate
 *                                     upload (never inside the hosted payload). Binds the
 *                                     inputs, the installed-tree observation, the scanner,
 *                                     the policy and the raw scanner output to the exact
 *                                     candidate tree and manifest. Its digest is bound by
 *                                     provenance.json, so the inner/outer design holds:
 *                                     dist → record → provenance, nothing self-referential.
 *   assessment/assessment.json        FRESH. Made by the gate, now, over the RETAINED
 *                                     lock graph of that candidate, the pinned scanner and
 *                                     the prepared publisher toolchain, under the CURRENT
 *                                     trusted audit policy. Its own clock readings, its
 *                                     own raw output.
 *   tooling.json                      THE PUBLISHER. What the gate prepared from the
 *                                     reviewed lock, with scripts disabled, and measured.
 *
 * PURE. Files arrive as a Map of path → Buffer, facts as arguments, `now` as an ISO
 * string. Nothing here reads a file, a clock or the network. A problem is data, never a
 * thrown exception.
 */

import { canonicalJson, digestOf, digestOfValue, sha256Hex, treeDigest } from './canonical.mjs';
import { retainedInventory, RETAINED_OBSERVATION, INSTALLED_OBSERVATION } from '../../dependency-audit/lib/retained.mjs';
import { readReport, toolingScope } from '../../dependency-audit/lib/npm.mjs';
import { evaluate } from '../../dependency-audit/lib/core.mjs';

export const EVIDENCE_SCHEMA = 'dinify.release.dependency-evidence/1';
export const ASSESSMENT_SCHEMA = 'dinify.release.assessment/1';
export const TOOLING_SCHEMA = 'dinify.release.publisher-tooling/1';
export const EVIDENCE_DIR = 'dependency-evidence';
export const EVIDENCE_RECORD = 'record.json';
export const ASSESSMENT_DOC = 'assessment.json';

/** The retained files, by their place in the bundle. Raw scanner output is named by the collection. */
export const RETAINED = Object.freeze({
  manifest: 'inputs/package.json',
  lockfile: 'inputs/package-lock.json',
  scannerManifest: 'inputs/scanner/package.json',
  scannerLockfile: 'inputs/scanner/package-lock.json',
  policy: 'audit/policy.json',
  snapshot: 'audit/snapshot.json',
  collection: 'audit/collection.json',
  result: 'audit/result.json',
});

/**
 * The two artifacts a gate uploads for its publisher, named by ITS run and attempt —
 * one function, read by `decide` (which records the names) and pinned against the
 * workflow's upload steps, so the two cannot name different uploads.
 */
export const toolingArtifactName = (runId, runAttempt) => `publisher-tooling-${runId}-${runAttempt}`;
export const assessmentArtifactName = (runId, runAttempt) => `publish-assessment-${runId}-${runAttempt}`;

/** An audit that may carry a candidate forward. Anything else is not a pass. */
export const PASSING_OUTCOMES = Object.freeze(['within_policy', 'exceptions_only']);
export const ASSESSED_GRAPHS = Object.freeze(['application', 'scanner', 'publisher']);

const SHA_RE = /^[0-9a-f]{40}$/;
const HEX_RE = /^[0-9a-f]{64}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RAW_NAME_RE = /^(application|scanner|publisher)\.scanner-(stdout|stderr)\.txt$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const reason = (code, detail) => ({ code, detail: String(detail) });
const same = (a, b) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
const isInstant = (v) => typeof v === 'string' && ISO_RE.test(v) && Number.isFinite(Date.parse(v));

function parseJson(bytes) {
  try {
    const value = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes));
    return { ok: true, value };
  } catch (error) {
    return { ok: false, detail: error.message };
  }
}

/** A tree digest over an in-memory bundle, with the same composition walkTree feeds. */
export function bundleTreeDigest(files) {
  const entries = [...files.entries()].map(([path, bytes]) => ({ path, sha256: sha256Hex(bytes) }));
  return entries.length ? treeDigest(entries) : null;
}

// ── certification ─────────────────────────────────────────────────────────────

/**
 * The certification record `stamp` writes. Every value is copied from a document the
 * certification run produced or a measurement stamp made — nothing is synthesised, and
 * the one timestamp the certification collection offers is labelled for what it is.
 *
 * `invokedAt` is the moment the certification scan was INVOKED. The B2.1 collection
 * (shared with Dinify-Admin and Dinify-Backend) records that same instant as its finish
 * and decision time too, so this record claims no finish time it cannot support; the
 * FRESH assessment records its own real start and finish.
 */
export function buildEvidenceRecord({
  repository, commit, tree, buildConfiguration, certification, snapshot, collection, result,
  reevaluation, files, candidate,
}) {
  const app = snapshot.binding.application;
  const scannerGraph = collection.graphs.scanner;
  const manifestFile = files.find((f) => f.path === RETAINED.manifest);
  const lockFile = files.find((f) => f.path === RETAINED.lockfile);
  return {
    schema: EVIDENCE_SCHEMA,
    repository,
    commit,
    tree,
    buildConfiguration,
    certification: {
      workflowPath: String(certification.workflowPath),
      runId: String(certification.runId),
      runAttempt: String(certification.runAttempt),
      runStartedAt: String(certification.runStartedAt),
    },
    environment: snapshot.binding.environment,
    inputs: {
      manifest: { path: RETAINED.manifest, sha256: manifestFile.sha256 },
      lockfile: { path: RETAINED.lockfile, sha256: lockFile.sha256 },
      lockDigest: `sha256:${lockFile.sha256}`,
    },
    inventory: {
      observation: 'installed-tree-paths-and-versions',
      observedAt: snapshot.capturedAt,
      reobservedAt: reevaluation.decidedAt,
      locked: app.locked,
      installed: app.installed,
      installedTreeSha256: app.installedTreeSha256,
      packagesDigest: digestOfValue(snapshot.packages),
    },
    scanner: {
      package: collection.scanner?.package ?? null,
      version: collection.scanner?.pinned ?? null,
      lockfileSha256: scannerGraph.digests.lockfileSha256,
      manifestSha256: scannerGraph.digests.manifestSha256,
      installedTreeSha256: scannerGraph.digests.installedTreeSha256,
    },
    audit: {
      invokedAt: collection.startedAt,
      outcome: result.outcome,
      exitCode: result.exitCode,
      counts: result.counts,
      reevaluatedAt: reevaluation.decidedAt,
      reevaluatedOutcome: reevaluation.outcome,
    },
    files: [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    candidate: {
      artifactTreeDigest: candidate.artifactTreeDigest,
      manifestDigest: candidate.manifestDigest,
      entryCount: candidate.entryCount,
    },
  };
}

/** Shape only. Whether the record is TRUE is inspectEvidenceBundle's and evidenceReasons' question. */
export function validateEvidenceRecord(record) {
  const problems = [];
  const p = (code, detail) => problems.push({ code, detail: String(detail) });
  if (!isObject(record)) return [{ code: 'evidence.not_an_object', detail: typeof record }];
  if (record.schema !== EVIDENCE_SCHEMA) p('evidence.wrong_schema', record.schema);
  if (typeof record.repository !== 'string' || !record.repository.includes('/')) p('evidence.bad_repository', record.repository);
  if (!SHA_RE.test(String(record.commit))) p('evidence.bad_commit', record.commit);
  if (!SHA_RE.test(String(record.tree))) p('evidence.bad_tree', record.tree);
  if (typeof record.buildConfiguration !== 'string' || !record.buildConfiguration) p('evidence.bad_configuration', record.buildConfiguration);
  const c = record.certification;
  if (!isObject(c) || !String(c.workflowPath).startsWith('.github/workflows/') || !/^\d+$/.test(String(c.runId))
      || !/^\d+$/.test(String(c.runAttempt)) || !isInstant(c.runStartedAt)) p('evidence.bad_certification', JSON.stringify(c));
  const e = record.environment;
  if (!isObject(e) || typeof e.node !== 'string' || typeof e.platform !== 'string' || typeof e.arch !== 'string') p('evidence.bad_environment', JSON.stringify(e));
  const i = record.inputs;
  if (!isObject(i) || i.manifest?.path !== RETAINED.manifest || !HEX_RE.test(String(i.manifest?.sha256))
      || i.lockfile?.path !== RETAINED.lockfile || !HEX_RE.test(String(i.lockfile?.sha256))
      || i.lockDigest !== `sha256:${i.lockfile?.sha256}`) p('evidence.bad_inputs', JSON.stringify(i));
  const v = record.inventory;
  if (!isObject(v) || !Number.isInteger(v.locked) || !Number.isInteger(v.installed) || !HEX_RE.test(String(v.installedTreeSha256))
      || !DIGEST_RE.test(String(v.packagesDigest)) || !isInstant(v.observedAt)) p('evidence.bad_inventory', JSON.stringify(v));
  const s = record.scanner;
  if (!isObject(s) || s.package !== 'npm' || !/^\d+\.\d+\.\d+$/.test(String(s.version)) || !HEX_RE.test(String(s.lockfileSha256))) p('evidence.bad_scanner', JSON.stringify(s));
  const a = record.audit;
  if (!isObject(a) || typeof a.outcome !== 'string' || !Number.isInteger(a.exitCode) || !isInstant(a.invokedAt)) p('evidence.bad_audit', JSON.stringify(a));
  if (!Array.isArray(record.files) || record.files.length === 0) {
    p('evidence.bad_files', 'no files listed');
  } else {
    const seen = new Set();
    for (const f of record.files) {
      if (!isObject(f) || typeof f.path !== 'string' || !/^(inputs|audit)\/[A-Za-z0-9._\/-]+$/.test(f.path) || f.path.includes('..')
          || !HEX_RE.test(String(f.sha256)) || !Number.isInteger(f.bytes) || f.bytes < 0) {
        p('evidence.bad_files', JSON.stringify(f));
        continue;
      }
      if (seen.has(f.path)) p('evidence.bad_files', `duplicate ${f.path}`);
      seen.add(f.path);
    }
  }
  const cand = record.candidate;
  if (!isObject(cand) || !DIGEST_RE.test(String(cand.artifactTreeDigest)) || !DIGEST_RE.test(String(cand.manifestDigest))
      || !Number.isInteger(cand.entryCount)) p('evidence.bad_candidate', JSON.stringify(cand));
  return problems;
}

/**
 * Everything the gate can establish about a candidate's evidence bundle FROM THE BUNDLE,
 * re-derived rather than read: every listed file against its digest, the documents
 * against each other, the raw scanner output against the digests the collection recorded,
 * and the certification decision REPRODUCED by reading that raw output against the
 * retained inventory. A reproduction is evaluated at the certification's own decision
 * time — it re-establishes what certification decided, and says nothing about today.
 *
 * @param {Map<string, Buffer>} files  every file under dependency-evidence/, by relative path
 * @param {object} [expected]          provenance.dependencyEvidence, when there is one
 * @returns {object} facts; `problems` empty means internally consistent
 */
export function inspectEvidenceBundle(files, expected) {
  const out = { state: 'present', problems: [], record: null, recordDigest: null, treeDigest: null, entryCount: 0, inputs: null, audit: null };
  const problem = (code, detail) => out.problems.push({ code, detail: String(detail) });
  if (!(files instanceof Map) || files.size === 0) {
    out.state = 'absent';
    return out;
  }
  out.treeDigest = bundleTreeDigest(files);
  out.entryCount = files.size;
  const recordBytes = files.get(EVIDENCE_RECORD);
  if (!recordBytes) { problem('evidence.no_record', `${EVIDENCE_DIR}/${EVIDENCE_RECORD} is missing`); return out; }
  out.recordDigest = digestOf(recordBytes);
  const parsed = parseJson(recordBytes);
  if (!parsed.ok) { problem('evidence.record_unreadable', parsed.detail); return out; }
  const record = parsed.value;
  out.record = record;
  for (const p of validateEvidenceRecord(record)) out.problems.push(p);
  if (out.problems.length) return out;

  if (expected) {
    if (expected.recordDigest !== out.recordDigest) problem('evidence.record_not_bound', `${out.recordDigest} != provenance ${String(expected.recordDigest)}`);
    if (expected.treeDigest !== out.treeDigest) problem('evidence.tree_not_bound', `${out.treeDigest} != provenance ${String(expected.treeDigest)}`);
    if (expected.entryCount !== out.entryCount) problem('evidence.tree_not_bound', `${out.entryCount} files, provenance says ${String(expected.entryCount)}`);
  }

  // Every file is listed, every listed file is present with exactly the recorded bytes.
  const listed = new Map(record.files.map((f) => [f.path, f]));
  for (const [path, bytes] of files) {
    if (path === EVIDENCE_RECORD) continue;
    const entry = listed.get(path);
    if (!entry) { problem('evidence.unlisted_file', path); continue; }
    if (sha256Hex(bytes) !== entry.sha256 || bytes.length !== entry.bytes) problem('evidence.file_altered', path);
  }
  for (const path of listed.keys()) if (!files.has(path)) problem('evidence.file_missing', path);
  for (const path of Object.values(RETAINED)) if (!files.has(path)) problem('evidence.file_missing', path);
  if (out.problems.length) return out;

  const doc = (path) => {
    const r = parseJson(files.get(path));
    if (!r.ok) { problem('evidence.document_unreadable', `${path}: ${r.detail}`); return null; }
    if (!isObject(r.value)) { problem('evidence.document_unreadable', `${path} is not an object`); return null; }
    return r.value;
  };
  const snapshot = doc(RETAINED.snapshot);
  const collection = doc(RETAINED.collection);
  const result = doc(RETAINED.result);
  const auditPolicy = doc(RETAINED.policy);
  if (!snapshot || !collection || !result || !auditPolicy) return out;
  if (snapshot.schema !== 'dinify.dependency-audit.snapshot/v1' || collection.schema !== 'dinify.dependency-audit.collection/v1'
      || result.schema !== 'dinify.dependency-audit.result/v1' || auditPolicy.schema !== 'dinify.dependency-audit.policy/v1') {
    problem('evidence.document_schema', 'a retained audit document does not carry the schema the audit writes');
    return out;
  }

  const manifestBytes = files.get(RETAINED.manifest);
  const lockBytes = files.get(RETAINED.lockfile);
  out.inputs = {
    manifestSha256: sha256Hex(manifestBytes),
    lockfileSha256: sha256Hex(lockBytes),
    lockDigest: digestOf(lockBytes),
    manifestDigest: digestOf(manifestBytes),
  };

  // The documents agree with each other and with the record.
  if (!same(snapshot.binding, collection.binding)) problem('evidence.inconsistent', 'the scan is not bound to the snapshot it claims');
  if (!isObject(snapshot.binding?.revision) || snapshot.binding.revision.commit !== record.commit || snapshot.binding.revision.tree !== record.tree) {
    problem('evidence.inconsistent', `the snapshot was taken at ${String(snapshot.binding?.revision?.commit)}, the record names ${record.commit}`);
  }
  if (!same(snapshot.binding?.environment, record.environment)) problem('evidence.inconsistent', 'the record environment is not the snapshot environment');
  const app = snapshot.binding?.application ?? {};
  if (app.lockfileSha256 !== out.inputs.lockfileSha256 || app.manifestSha256 !== out.inputs.manifestSha256) {
    problem('evidence.inconsistent', 'the retained inputs are not the files the snapshot was taken over');
  }
  if (app.installedTreeSha256 !== record.inventory.installedTreeSha256 || app.locked !== record.inventory.locked || app.installed !== record.inventory.installed) {
    problem('evidence.inconsistent', 'the record inventory is not the snapshot inventory');
  }
  if (digestOfValue(snapshot.packages) !== record.inventory.packagesDigest) problem('evidence.inconsistent', 'the record does not bind the snapshot package list');
  if (record.inputs.manifest.sha256 !== out.inputs.manifestSha256 || record.inputs.lockfile.sha256 !== out.inputs.lockfileSha256) {
    problem('evidence.inconsistent', 'the record inputs are not the retained inputs');
  }
  if (result.outcome !== record.audit.outcome || result.exitCode !== record.audit.exitCode || !same(result.counts, record.audit.counts)) {
    problem('evidence.inconsistent', 'the record audit outcome is not the retained result');
  }
  const scannerGraph = collection.graphs?.scanner;
  const scannerManifestSha = sha256Hex(files.get(RETAINED.scannerManifest));
  const scannerLockSha = sha256Hex(files.get(RETAINED.scannerLockfile));
  if (!isObject(scannerGraph) || scannerGraph.digests?.lockfileSha256 !== scannerLockSha || scannerGraph.digests?.manifestSha256 !== scannerManifestSha
      || record.scanner.lockfileSha256 !== scannerLockSha || record.scanner.version !== collection.scanner?.pinned) {
    problem('evidence.inconsistent', 'the retained scanner inputs are not the ones the scan recorded');
  }
  if (out.problems.length) return out;

  // The RAW output is the bytes the collection recorded, for both certified graphs.
  const raw = {};
  for (const graph of ['application', 'scanner']) {
    const run = collection.graphs?.[graph]?.run;
    if (!isObject(run) || !RAW_NAME_RE.test(String(run.stdoutFile)) || !RAW_NAME_RE.test(String(run.stderrFile))) {
      problem('evidence.raw_missing', `${graph}: no raw output is recorded`);
      continue;
    }
    const stdout = files.get(`audit/${run.stdoutFile}`);
    const stderr = files.get(`audit/${run.stderrFile}`);
    if (!stdout || !stderr) { problem('evidence.raw_missing', `${graph}: the raw output is not retained`); continue; }
    if (sha256Hex(stdout) !== run.stdoutSha256 || sha256Hex(stderr) !== run.stderrSha256) {
      problem('evidence.raw_mismatch', `${graph}: the raw output is not the bytes the collection recorded`);
      continue;
    }
    raw[graph] = { run, stdout: stdout.toString('utf8') };
  }
  if (out.problems.length) return out;

  // REPRODUCE the certification decision from the raw output and the retained inventory.
  // A result document that says "no findings" is worth nothing without this: the raw
  // answer has to say so too, and has to have covered exactly this graph.
  const appInv = retainedInventory({ graph: 'application', manifestBytes, lockBytes, snapshot });
  const scannerInv = lockOnlyInventory('scanner', files.get(RETAINED.scannerManifest), files.get(RETAINED.scannerLockfile));
  const incomplete = [...appInv.problems, ...scannerInv.problems];
  const findings = [];
  for (const [graph, inv] of [['application', appInv], ['scanner', scannerInv]]) {
    const read = readReport({ graph, run: { ...raw[graph].run, stdout: raw[graph].stdout }, inv });
    incomplete.push(...read.problems);
    findings.push(...read.findings);
  }
  const reproduced = evaluate({ incomplete, findings, records: Array.isArray(auditPolicy.records) ? auditPolicy.records : [], now: result.decidedAt });
  out.audit = { outcome: reproduced.outcome, counts: reproduced.counts, findings: reproduced.findings.length };
  if (reproduced.outcome !== result.outcome || !same(reproduced.counts, result.counts)) {
    problem('evidence.unreproducible', `the raw output reads as ${reproduced.outcome} ${canonicalJson(reproduced.counts)}, the retained result says ${String(result.outcome)} ${canonicalJson(result.counts)}`);
  }
  return out;
}

/**
 * A lock-graph inventory with NO installed observation, for reading a TOOLING graph's
 * report (every package tooling scope). Used only to re-read a recorded answer; it is not
 * evidence about what was installed and is never presented as such.
 */
export function lockOnlyInventory(graph, manifestBytes, lockBytes) {
  const problems = [];
  let lock;
  try { lock = JSON.parse(lockBytes); JSON.parse(manifestBytes); } catch (error) {
    return { packages: [], problems: [{ code: 'unreadable_manifest', detail: `${graph}: ${error.message}` }], digests: {}, counts: {} };
  }
  if (!isObject(lock?.packages)) return { packages: [], problems: [{ code: 'lockfile_version', detail: `${graph}: no packages map` }], digests: {}, counts: {} };
  const packages = Object.entries(lock.packages).filter(([path]) => path !== '').map(([path, entry]) => ({
    path: `${graph}:${path}`, version: entry?.version ?? null, scope: toolingScope(entry),
  }));
  return { packages, problems, digests: { lockfileSha256: sha256Hex(lockBytes), manifestSha256: sha256Hex(manifestBytes) }, counts: { locked: packages.length } };
}

/**
 * The decision's view of a candidate's certification evidence: is it THIS candidate's,
 * from THIS certification, over THIS commit's dependency inputs?
 *
 * @param {object} input
 * @param {object} input.evidence        inspectEvidenceBundle() facts
 * @param {object} input.provenance      {schema, legacy} as the observation read it
 * @param {object} input.manifest        the candidate's inner manifest
 * @param {string} input.observedTreeDigest  the dist/ tree digest the gate measured
 * @param {object} input.source          the certified commit's facts, from git
 * @param {object} input.certification   the certifying run, per the API
 * @param {object} input.policy          the release policy
 */
export function evidenceReasons({ evidence, provenance, manifest, observedTreeDigest, source, certification, policy }) {
  if (provenance?.legacy === true) {
    // No retrofit and no "old artifact is safe" bypass: this build of the gate cannot
    // establish what a pre-B2.2 candidate was built from, so it is not promoted by it.
    return [reason('dependency.evidence_unsupported', `${String(provenance.schema)} carries no dependency evidence; re-certify to promote this commit`)];
  }
  if (!evidence || evidence.state === 'absent') {
    return [reason('dependency.evidence_missing', `the candidate carries no ${EVIDENCE_DIR}/`)];
  }
  const out = [];
  if (Array.isArray(evidence.unsafe) && evidence.unsafe.length) out.push(reason('dependency.evidence_invalid', evidence.unsafe.join('; ')));
  if (evidence.problems?.length) {
    out.push(reason('dependency.evidence_invalid', evidence.problems.map((p) => `${p.code}: ${p.detail}`).join('; ')));
    return out;
  }
  const r = evidence.record;
  if (r.repository !== policy.repository) out.push(reason('dependency.evidence_wrong_repository', `${r.repository} != ${policy.repository}`));
  if (!manifest) return out;
  if (r.candidate.artifactTreeDigest !== observedTreeDigest || r.candidate.manifestDigest !== digestOfValue(manifest)) {
    out.push(reason('dependency.evidence_wrong_candidate', `evidence binds ${r.candidate.artifactTreeDigest}, the candidate is ${String(observedTreeDigest)}`));
  }
  if (r.commit !== manifest.commit) out.push(reason('dependency.evidence_wrong_commit', `${r.commit} != ${String(manifest.commit)}`));
  if (r.tree !== manifest.source?.tree || (source?.present === true && r.tree !== source.tree)) {
    out.push(reason('dependency.evidence_wrong_tree', `${r.tree} != ${String(manifest.source?.tree)} / ${String(source?.tree)}`));
  }
  if (r.buildConfiguration !== policy.build.configuration || r.buildConfiguration !== manifest.buildConfiguration) {
    out.push(reason('dependency.evidence_wrong_configuration', `${r.buildConfiguration} != ${policy.build.configuration}`));
  }
  if (r.certification.workflowPath !== policy.certification.workflowPath) {
    out.push(reason('dependency.evidence_wrong_run', `${r.certification.workflowPath} != ${policy.certification.workflowPath}`));
  }
  // The evidence and the manifest are written by ONE stamp, so they name one run, one
  // attempt and one stamp time. The stamp time is NOT the API's run_started_at — the run
  // starts, installs, tests and builds before it stamps — and is never compared with it.
  const mc = manifest.certification ?? {};
  if (r.certification.runId !== String(mc.runId) || r.certification.runAttempt !== String(mc.runAttempt) || r.certification.runStartedAt !== mc.runStartedAt) {
    out.push(reason('dependency.evidence_wrong_run', `evidence stamped for run ${r.certification.runId}.${r.certification.runAttempt} at ${r.certification.runStartedAt}, the manifest for ${String(mc.runId)}.${String(mc.runAttempt)} at ${String(mc.runStartedAt)}`));
  }
  if (certification?.present) {
    if (r.certification.runId !== String(certification.runId)) {
      out.push(reason('dependency.evidence_wrong_run', `evidence from run ${r.certification.runId}, the candidate's run is ${String(certification.runId)}`));
    }
    if (r.certification.runAttempt !== String(certification.runAttempt)) {
      out.push(reason('dependency.evidence_wrong_attempt', `evidence from attempt ${r.certification.runAttempt}, the candidate's is ${String(certification.runAttempt)}`));
    }
  }
  if (r.inputs.lockDigest !== manifest.dependencies?.lockDigest || evidence.inputs.lockDigest !== manifest.dependencies?.lockDigest
      || (source?.present === true && evidence.inputs.lockDigest !== source.lockDigest)) {
    out.push(reason('dependency.evidence_wrong_lock', `retained ${String(evidence.inputs.lockDigest)}, manifest ${String(manifest.dependencies?.lockDigest)}, commit ${String(source?.lockDigest)}`));
  }
  if (source?.present === true && evidence.inputs.manifestDigest !== source.manifestDigest) {
    out.push(reason('dependency.evidence_wrong_manifest', `retained ${evidence.inputs.manifestDigest}, commit ${String(source.manifestDigest)}`));
  }
  if (r.environment.node !== manifest.dependencies?.nodeVersion) {
    out.push(reason('dependency.evidence_wrong_environment', `evidence on Node ${r.environment.node}, the candidate was built on ${String(manifest.dependencies?.nodeVersion)}`));
  }
  if (!PASSING_OUTCOMES.includes(r.audit.outcome) || r.audit.exitCode !== 0
      || !PASSING_OUTCOMES.includes(r.audit.reevaluatedOutcome) || !PASSING_OUTCOMES.includes(evidence.audit?.outcome)) {
    out.push(reason('dependency.evidence_not_passing', `certification audit ${String(r.audit.outcome)} (re-evaluated ${String(r.audit.reevaluatedOutcome)})`));
  }
  return out;
}

// ── the fresh assessment ────────────────────────────────────────────────────────

/** Shape of the fresh assessment document. Truth is assessmentReasons' question. */
export function validateAssessment(doc) {
  const problems = [];
  const p = (code, detail) => problems.push({ code, detail: String(detail) });
  if (!isObject(doc)) return [{ code: 'assessment.not_an_object', detail: typeof doc }];
  if (doc.schema !== ASSESSMENT_SCHEMA) p('assessment.wrong_schema', doc.schema);
  if (doc.purpose !== 'promotion') p('assessment.wrong_purpose', doc.purpose);
  for (const key of ['startedAt', 'finishedAt', 'decidedAt']) if (!isInstant(doc[key])) p('assessment.bad_time', `${key}=${String(doc[key])}`);
  if (!isObject(doc.assessor) || !/^\d+$/.test(String(doc.assessor.runId)) || !/^\d+$/.test(String(doc.assessor.runAttempt)) || !SHA_RE.test(String(doc.assessor.revision))) {
    p('assessment.bad_assessor', JSON.stringify(doc.assessor));
  }
  if (!isObject(doc.candidate) || !Number.isInteger(doc.candidate.artifactId) || !DIGEST_RE.test(String(doc.candidate.artifactDigest))
      || !DIGEST_RE.test(String(doc.candidate.treeDigest)) || !DIGEST_RE.test(String(doc.candidate.manifestDigest))
      || !DIGEST_RE.test(String(doc.candidate.evidenceRecordDigest)) || !SHA_RE.test(String(doc.candidate.commit))
      || !/^\d+$/.test(String(doc.candidate.runId)) || !/^\d+$/.test(String(doc.candidate.runAttempt))) {
    p('assessment.bad_candidate', JSON.stringify(doc.candidate));
  }
  if (!isObject(doc.policy) || !HEX_RE.test(String(doc.policy.sha256))) p('assessment.bad_policy', JSON.stringify(doc.policy));
  if (!isObject(doc.scanner) || doc.scanner.package !== 'npm' || !/^\d+\.\d+\.\d+$/.test(String(doc.scanner.version))) p('assessment.bad_scanner', JSON.stringify(doc.scanner));
  if (!isObject(doc.tooling) || !DIGEST_RE.test(String(doc.tooling.treeDigest))) p('assessment.bad_tooling', JSON.stringify(doc.tooling));
  if (!isObject(doc.graphs)) {
    p('assessment.bad_graphs', 'no graphs');
  } else {
    for (const graph of ASSESSED_GRAPHS) {
      const g = doc.graphs[graph];
      if (!isObject(g) || !isInstant(g.startedAt) || !isInstant(g.finishedAt) || !isObject(g.digests) || !isObject(g.run)
          || !RAW_NAME_RE.test(String(g.run.stdoutFile)) || !HEX_RE.test(String(g.run.stdoutSha256)) || !HEX_RE.test(String(g.run.stderrSha256))) {
        p('assessment.bad_graph', graph);
      }
    }
    for (const graph of Object.keys(doc.graphs)) if (!ASSESSED_GRAPHS.includes(graph)) p('assessment.bad_graph', `unexpected ${graph}`);
  }
  if (typeof doc.outcome !== 'string' || !Number.isInteger(doc.exitCode) || !isObject(doc.counts)) p('assessment.bad_result', `${String(doc.outcome)} ${String(doc.exitCode)}`);
  if (!Array.isArray(doc.recordsApplied) || !doc.recordsApplied.every((r) => isObject(r) && typeof r.id === 'string' && DATE_RE.test(String(r.expires)))) {
    p('assessment.bad_records', JSON.stringify(doc.recordsApplied));
  }
  return problems;
}

/**
 * The assessment directory as data: the document, its digest, the tree digest, and every
 * raw output re-checked against the digest the document recorded.
 */
export function inspectAssessment(files) {
  const out = { state: 'present', problems: [], doc: null, digest: null, treeDigest: null, entryCount: 0 };
  const problem = (code, detail) => out.problems.push({ code, detail: String(detail) });
  if (!(files instanceof Map) || files.size === 0) { out.state = 'absent'; return out; }
  out.treeDigest = bundleTreeDigest(files);
  out.entryCount = files.size;
  const bytes = files.get(ASSESSMENT_DOC);
  if (!bytes) { problem('assessment.no_document', ASSESSMENT_DOC); return out; }
  out.digest = digestOf(bytes);
  const parsed = parseJson(bytes);
  if (!parsed.ok) { problem('assessment.unreadable', parsed.detail); return out; }
  out.doc = parsed.value;
  for (const p of validateAssessment(out.doc)) out.problems.push(p);
  if (out.problems.length) return out;
  const expected = new Set([ASSESSMENT_DOC]);
  for (const graph of ASSESSED_GRAPHS) {
    const run = out.doc.graphs[graph].run;
    for (const [file, digest] of [[run.stdoutFile, run.stdoutSha256], [run.stderrFile, run.stderrSha256]]) {
      expected.add(file);
      const raw = files.get(file);
      if (!raw) problem('assessment.raw_missing', `${graph}: ${file}`);
      else if (sha256Hex(raw) !== digest) problem('assessment.raw_mismatch', `${graph}: ${file}`);
    }
  }
  for (const path of files.keys()) if (!expected.has(path)) problem('assessment.unexpected_file', path);
  return out;
}

const hoursBetween = (later, earlier) => (Date.parse(later) - Date.parse(earlier)) / 3_600_000;
/** 00:00 UTC on a record's `expires` date: from that instant it has lapsed (core.mjs's rule). */
export const recordLapsesAt = (expires) => `${expires}T00:00:00Z`;

/**
 * The instant the admitted unit stops being promotable on its dependency evidence: the
 * assessment window end, or the first applied record's lapse, whichever is earlier.
 */
export function assessmentExpiresAt({ assessment, policy }) {
  const windowEnd = Date.parse(assessment.startedAt) + policy.freshness.assessmentWindowHours * 3_600_000;
  const lapses = assessment.recordsApplied.map((r) => Date.parse(recordLapsesAt(r.expires)));
  const end = Math.min(windowEnd, ...lapses);
  return new Date(end).toISOString().replace(/\.000Z$/, 'Z');
}

/**
 * Is this the time-bound half still standing at `now`? Shared by the decision, the
 * publisher's preflight and the publish command's last-boundary recheck, so the three
 * cannot disagree about when an assessment has aged out. `prefix` names the boundary.
 */
export function assessmentTimeReasons({ assessment, policy, now, prefix = 'dependency' }) {
  const out = [];
  const a = assessment;
  const times = [a.startedAt, ...ASSESSED_GRAPHS.flatMap((g) => [a.graphs[g].startedAt, a.graphs[g].finishedAt]), a.finishedAt, a.decidedAt];
  if (!times.every(isInstant) || !isInstant(now)) return [reason(`${prefix}.assessment_time_invalid`, 'an assessment time is not an instant')];
  const ms = (t) => Date.parse(t);
  const ordered = ASSESSED_GRAPHS.every((g) => ms(a.startedAt) <= ms(a.graphs[g].startedAt) && ms(a.graphs[g].startedAt) <= ms(a.graphs[g].finishedAt)
    && ms(a.graphs[g].finishedAt) <= ms(a.finishedAt)) && ms(a.finishedAt) <= ms(a.decidedAt);
  if (!ordered) out.push(reason(`${prefix}.assessment_time_invalid`, `collection ${a.startedAt} … ${a.finishedAt}, decided ${a.decidedAt}, out of order`));
  if (ms(a.decidedAt) > ms(now)) out.push(reason(`${prefix}.assessment_time_invalid`, `decided ${a.decidedAt}, which is after ${now}`));
  const age = hoursBetween(now, a.startedAt);
  if (age > policy.freshness.assessmentWindowHours) {
    out.push(reason(`${prefix}.assessment_stale`, `collected ${a.startedAt}, ${age.toFixed(2)}h > ${policy.freshness.assessmentWindowHours}h`));
  }
  for (const r of a.recordsApplied) {
    if (ms(now) >= ms(recordLapsesAt(r.expires))) out.push(reason(`${prefix}.exception_expired`, `${r.id} lapsed on ${r.expires}`));
  }
  return out;
}

/**
 * The decision's view of the fresh assessment.
 *
 * @param {object} input
 * @param {object} input.assessment    inspectAssessment() facts
 * @param {object} input.evidence      inspectEvidenceBundle() facts
 * @param {object} input.observation   the candidate observation (tree and manifest digests)
 * @param {object} input.listed        the certifying run's listed artifact
 * @param {object} input.certification the certifying run
 * @param {string} input.target        the requested commit
 * @param {object} input.tooling       the prepared toolchain's facts
 * @param {object} input.trusted       {revision, auditPolicySha256, scannerLockfileSha256}
 * @param {object} input.evaluation    {runId, runAttempt} of THIS evaluation
 * @param {object} input.policy        the release policy
 * @param {string} input.now
 */
export function assessmentReasons({ assessment, evidence, observation, listed, certification, target, tooling, trusted, evaluation, policy, now }) {
  if (!assessment || assessment.state === 'absent') {
    return [reason('dependency.assessment_missing', 'no fresh assessment was performed for this evaluation — not performed is not passed')];
  }
  if (assessment.problems?.length) {
    return [reason('dependency.assessment_invalid', assessment.problems.map((p) => `${p.code}: ${p.detail}`).join('; '))];
  }
  const a = assessment.doc;
  const out = [];
  if (!evaluation || a.assessor.runId !== String(evaluation.runId) || a.assessor.runAttempt !== String(evaluation.runAttempt)) {
    out.push(reason('dependency.assessment_not_current', `assessed by run ${a.assessor.runId}.${a.assessor.runAttempt}, this evaluation is ${String(evaluation?.runId)}.${String(evaluation?.runAttempt)}`));
  }
  if (a.assessor.revision !== trusted?.revision) out.push(reason('dependency.assessment_not_current', `assessed by ${a.assessor.revision}, the trusted verifier is ${String(trusted?.revision)}`));
  const cand = a.candidate;
  const wrong = [];
  if (cand.commit !== target) wrong.push(`commit ${cand.commit}`);
  if (listed && (cand.artifactId !== listed.id || cand.artifactDigest !== listed.digest)) wrong.push(`artifact ${cand.artifactId}`);
  if (cand.treeDigest !== observation?.observedTreeDigest || cand.manifestDigest !== observation?.manifestDigest) wrong.push('candidate tree');
  if (cand.evidenceRecordDigest !== evidence?.recordDigest) wrong.push('evidence record');
  if (certification?.present && (cand.runId !== String(certification.runId) || cand.runAttempt !== String(certification.runAttempt))) wrong.push(`run ${cand.runId}.${cand.runAttempt}`);
  if (wrong.length) out.push(reason('dependency.assessment_wrong_candidate', wrong.join(', ')));

  const app = a.graphs.application;
  const r = evidence?.record;
  if (app.observation !== RETAINED_OBSERVATION || !r || !evidence.inputs
      || app.digests.lockfileSha256 !== evidence.inputs.lockfileSha256 || app.digests.manifestSha256 !== evidence.inputs.manifestSha256
      || app.digests.installedTreeSha256 !== r.inventory.installedTreeSha256 || app.counts?.locked !== r.inventory.locked) {
    out.push(reason('dependency.assessment_wrong_graph', 'the application graph assessed is not the candidate\'s retained graph'));
  }
  const sc = a.graphs.scanner;
  if (sc.observation !== INSTALLED_OBSERVATION || sc.digests.lockfileSha256 !== trusted?.scannerLockfileSha256) {
    out.push(reason('dependency.assessment_wrong_scanner', 'the scanner graph assessed is not the trusted pinned scanner'));
  }
  const pub = a.graphs.publisher;
  if (!tooling || pub.observation !== INSTALLED_OBSERVATION || pub.digests.lockfileSha256 !== tooling.lock?.lockfileSha256
      || pub.digests.installedTreeSha256 !== tooling.installedTreeSha256 || a.tooling.treeDigest !== tooling.treeDigest) {
    out.push(reason('dependency.assessment_wrong_tooling', 'the publisher graph assessed is not the prepared toolchain'));
  }
  if (a.policy.sha256 !== trusted?.auditPolicySha256) out.push(reason('dependency.assessment_policy_mismatch', `assessed under ${a.policy.sha256}, the trusted audit policy is ${String(trusted?.auditPolicySha256)}`));
  out.push(...assessmentTimeReasons({ assessment: a, policy, now }));
  // An assessment of a candidate cannot have been collected before that candidate was
  // stamped: such a document is not a statement about these bytes at all.
  const stamped = Date.parse(String(r?.certification?.runStartedAt ?? ''));
  if (Number.isFinite(stamped) && Date.parse(a.startedAt) < stamped) {
    out.push(reason('dependency.assessment_time_invalid', `collected ${a.startedAt}, before the candidate was stamped at ${r.certification.runStartedAt}`));
  }
  if (a.outcome === 'blocking') out.push(reason('dependency.assessment_blocking', a.headline ?? 'blocking'));
  else if (a.outcome === 'incomplete') out.push(reason('dependency.assessment_incomplete', a.headline ?? 'incomplete'));
  else if (!PASSING_OUTCOMES.includes(a.outcome) || a.exitCode !== 0) out.push(reason('dependency.assessment_invalid', `outcome ${String(a.outcome)} exit ${String(a.exitCode)}`));
  return out;
}

// ── the publisher toolchain ─────────────────────────────────────────────────────

/** Shape of tooling.json. */
export function validateTooling(t) {
  const problems = [];
  const p = (code, detail) => problems.push({ code, detail: String(detail) });
  if (!isObject(t)) return [{ code: 'tooling.not_an_object', detail: typeof t }];
  if (t.schema !== TOOLING_SCHEMA) p('tooling.wrong_schema', t.schema);
  if (typeof t.package !== 'string' || !/^\d+\.\d+\.\d+$/.test(String(t.version))) p('tooling.bad_package', `${String(t.package)}@${String(t.version)}`);
  if (!/^v\d+\.\d+\.\d+$/.test(String(t.node))) p('tooling.bad_node', t.node);
  if (!isObject(t.lock) || !HEX_RE.test(String(t.lock.lockfileSha256)) || !HEX_RE.test(String(t.lock.manifestSha256))) p('tooling.bad_lock', JSON.stringify(t.lock));
  if (!HEX_RE.test(String(t.installedTreeSha256))) p('tooling.bad_inventory', t.installedTreeSha256);
  if (!DIGEST_RE.test(String(t.treeDigest)) || !Number.isInteger(t.entryCount) || t.entryCount <= 0) p('tooling.bad_tree', `${String(t.treeDigest)} ${String(t.entryCount)}`);
  if (!isObject(t.entrypoint) || typeof t.entrypoint.path !== 'string' || !HEX_RE.test(String(t.entrypoint.sha256))) p('tooling.bad_entrypoint', JSON.stringify(t.entrypoint));
  if (!Array.isArray(t.problems)) p('tooling.bad_problems', JSON.stringify(t.problems));
  return problems;
}

/**
 * The decision's view of the prepared toolchain: is it the reviewed lock, installed
 * exactly, measured, and the one the policy pins — and was it retained for the publisher?
 */
export function toolingReasons({ tooling, trusted, policy, uploads }) {
  if (!tooling) return [reason('dependency.tooling_missing', 'no publisher toolchain was prepared')];
  const shape = validateTooling(tooling);
  if (shape.length) return [reason('dependency.tooling_invalid', shape.map((p) => `${p.code}: ${p.detail}`).join('; '))];
  const out = [];
  if (tooling.problems.length) out.push(reason('dependency.tooling_invalid', tooling.problems.map((p) => `${p.code}: ${p.detail}`).join('; ')));
  const pin = policy.publisher;
  if (tooling.package !== pin.package || tooling.version !== pin.version || tooling.entrypoint.path !== pin.entrypoint || tooling.node !== `v${pin.node}`) {
    out.push(reason('dependency.tooling_mismatch', `prepared ${tooling.package}@${tooling.version} ${tooling.entrypoint.path} on ${tooling.node}, the policy pins ${pin.package}@${pin.version} ${pin.entrypoint} on v${pin.node}`));
  }
  if (tooling.lock.lockfileSha256 !== trusted?.publisherLockfileSha256 || tooling.lock.manifestSha256 !== trusted?.publisherManifestSha256) {
    out.push(reason('dependency.tooling_unreviewed', 'the prepared toolchain was not installed from the reviewed publisher lock'));
  }
  const up = uploads ?? {};
  if (!Number.isInteger(up.tooling?.id) || up.tooling.id <= 0 || !DIGEST_RE.test(String(up.tooling?.digest))) {
    out.push(reason('dependency.tooling_unretained', 'the prepared toolchain was not retained as an artifact for the publisher'));
  }
  if (!Number.isInteger(up.assessment?.id) || up.assessment.id <= 0 || !DIGEST_RE.test(String(up.assessment?.digest))) {
    out.push(reason('dependency.assessment_unretained', 'the fresh assessment was not retained as an artifact for the publisher'));
  }
  return out;
}
