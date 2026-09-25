/**
 * THE ADMITTED RECORD — one certified unit, carried from the gate to the publisher.
 *
 * WHAT WAS WRONG (R3, reproduced on 3386724). The gate's outputs were
 * `allow, decision, sha, run_id, artifact_name`, and the publisher downloaded BY NAME,
 * checked out its verifier at whatever `main` was by then, re-verified only that the
 * bytes it received were self-consistent, and declared success when the served
 * identity named the right COMMIT. Each of those let the publisher act on something
 * the gate never evaluated: a different upload under the same name, a different
 * verifier or policy, a different candidate of the same commit (a self-consistent
 * substitute passed), and a different build of the same SHA reported as published.
 *
 * WHAT REPLACES IT. The gate emits this record — every identity the publisher needs to
 * prove it is acting on the same unit — and its digest. The publisher refuses unless
 * its own download, its own verifier checkout, its own regenerated hosting
 * configuration and the state it re-reads inside the critical section all agree with
 * it. Nothing here asserts that an artifact WAS substituted; GitHub artifacts are
 * immutable once uploaded. The record is what makes "the same unit" checkable rather
 * than assumed, including across a re-run, an expired upload or a policy change.
 *
 * Pure.
 */

import { canonicalJson, digestOfValue } from './canonical.mjs';
import { ASSESSMENT_SCHEMA, EVIDENCE_SCHEMA, TOOLING_SCHEMA, assessmentExpiresAt } from './dependency-evidence.mjs';

// /2 (D08 B2.2): the record also binds the candidate's CERTIFICATION dependency evidence,
// the FRESH assessment (its own artifact, run, attempt, clock readings, policy, scanner
// and outcome) and the exact PUBLISHER TOOLCHAIN (its content tree, entrypoint, runtime,
// lock and artifact). The publisher re-establishes each from its own downloads. There is
// deliberately no `auditPassed: true`: an outcome is carried beside the evidence it was
// derived from, and the evidence is what gets checked.
export const RECORD_SCHEMA = 'dinify.release.record/2';

const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Build the record from the facts the decision was made on. Called for EVERY
 * decision so the retained evidence has one shape; only a PROCEED is admitted.
 */
export function buildRecord({
  decision, request, policyFacts, certification, listedArtifact, artifact, hosting,
  served, peers, policy, now, dependencies = {},
}) {
  const manifest = artifact?.manifest ?? null;
  const started = Date.parse(certification?.runStartedAt ?? '');
  const ev = artifact?.dependencyEvidence;
  const as = dependencies.assessment;
  const tooling = dependencies.tooling;
  const uploads = dependencies.uploads ?? {};
  // The unit stops being promotable at the FIRST of: the certification window, the fresh
  // assessment's window, or the lapse of an exception record the assessment applied.
  let expiresMs = Number.isFinite(started) ? started + policy.freshness.certificationWindowHours * 3_600_000 : NaN;
  const assessed = as?.doc && Array.isArray(as.doc.recordsApplied) && typeof as.doc.startedAt === 'string';
  if (assessed) {
    const assessmentEnd = Date.parse(assessmentExpiresAt({ assessment: as.doc, policy }));
    if (Number.isFinite(assessmentEnd) && Number.isFinite(expiresMs)) expiresMs = Math.min(expiresMs, assessmentEnd);
  }
  const expires = Number.isFinite(expiresMs) ? new Date(expiresMs).toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
  const graphDigests = (graph) => {
    const d = as?.doc?.graphs?.[graph]?.digests;
    return d ? { lockfileSha256: d.lockfileSha256 ?? null, manifestSha256: d.manifestSha256 ?? null, installedTreeSha256: d.installedTreeSha256 ?? null } : null;
  };
  return {
    schema: RECORD_SCHEMA,
    decision: decision.decision,
    admitted: decision.decision === 'PROCEED',
    request: { mode: request.mode, trigger: request.trigger, target: request.target },
    policy: {
      revision: policyFacts.revision,
      digest: policyFacts.digest,
      verifierTree: policyFacts.verifierTree,
    },
    target: {
      repository: policy.repository,
      commit: request.target,
      sourceTree: manifest?.source?.tree ?? null,
    },
    certification: {
      workflowPath: certification?.workflowPath ?? null,
      runId: certification?.runId ?? null,
      runAttempt: certification?.runAttempt ?? null,
      runStartedAt: certification?.runStartedAt ?? null,
    },
    artifact: {
      id: listedArtifact?.id ?? null,
      name: listedArtifact?.name ?? null,
      digest: listedArtifact?.digest ?? null,
      treeDigest: artifact?.observedTreeDigest ?? null,
      manifestDigest: manifest ? digestOfValue(manifest) : null,
      entryCount: artifact?.entryCount ?? null,
    },
    hosting: {
      project: policy.hosting.project,
      site: policy.hosting.site,
      target: policy.hosting.target,
      channelId: policy.hosting.channelId,
      toolsVersion: policy.publisher.version,
      configDigest: hosting?.digest ?? null,
    },
    dependencies: {
      evidence: ev?.record ? {
        schema: EVIDENCE_SCHEMA,
        recordDigest: ev.recordDigest,
        treeDigest: ev.treeDigest,
        entryCount: ev.entryCount,
        lockDigest: ev.inputs?.lockDigest ?? null,
        manifestSha256: ev.inputs?.manifestSha256 ?? null,
        installedTreeSha256: ev.record.inventory?.installedTreeSha256 ?? null,
        environment: ev.record.environment ?? null,
        certificationRun: { runId: ev.record.certification?.runId ?? null, runAttempt: ev.record.certification?.runAttempt ?? null },
      } : null,
      assessment: as?.doc ? {
        schema: ASSESSMENT_SCHEMA,
        digest: as.digest,
        treeDigest: as.treeDigest,
        entryCount: as.entryCount,
        artifact: { id: uploads.assessment?.id ?? null, name: uploads.assessment?.name ?? null, digest: uploads.assessment?.digest ?? null },
        runId: as.doc.assessor?.runId ?? null,
        runAttempt: as.doc.assessor?.runAttempt ?? null,
        startedAt: as.doc.startedAt ?? null,
        finishedAt: as.doc.finishedAt ?? null,
        decidedAt: as.doc.decidedAt ?? null,
        outcome: as.doc.outcome ?? null,
        counts: as.doc.counts ?? null,
        policySha256: as.doc.policy?.sha256 ?? null,
        scanner: as.doc.scanner ?? null,
        recordsApplied: as.doc.recordsApplied ?? null,
        graphs: { application: graphDigests('application'), scanner: graphDigests('scanner'), publisher: graphDigests('publisher') },
      } : null,
    },
    publisher: tooling && typeof tooling === 'object' ? {
      schema: TOOLING_SCHEMA,
      package: tooling.package ?? null,
      version: tooling.version ?? null,
      node: tooling.node ?? null,
      deployAgent: policy.publisher.deployAgent,
      entrypoint: tooling.entrypoint ?? null,
      treeDigest: tooling.treeDigest ?? null,
      entryCount: tooling.entryCount ?? null,
      lockfileSha256: tooling.lock?.lockfileSha256 ?? null,
      installedTreeSha256: tooling.installedTreeSha256 ?? null,
      artifact: { id: uploads.tooling?.id ?? null, name: uploads.tooling?.name ?? null, digest: uploads.tooling?.digest ?? null },
    } : null,
    served: {
      state: served?.state ?? null,
      commit: served?.servedCommit ?? null,
      manifestDigest: served?.manifestDigest ?? null,
      relation: served?.relationToTarget ?? null,
    },
    peers: {
      setId: policy.compatibleSet.id,
      backend: policy.compatibleSet.peers.backend.approved.map((x) => ({ commit: x.commit, receiptDigest: x.receiptDigest })),
      admin: policy.compatibleSet.peers.admin.approved.map((x) => ({ commit: x.commit, receiptDigest: x.receiptDigest })),
      adminServed: peers?.serving?.admin?.state === 'known' ? peers.serving.admin.commit : null,
    },
    admittedAt: now,
    expiresAt: expires,
  };
}

export function recordDigest(record) {
  return digestOfValue(record);
}

/** For a job output: base64 of the canonical form, so no shell quoting touches it. */
export function encodeRecord(record) {
  return Buffer.from(canonicalJson(record), 'utf8').toString('base64');
}

/**
 * Decode, verify against the digest the gate emitted beside it, and validate. A
 * record that does not reproduce its digest is not the record that was admitted.
 */
export function decodeRecord(encoded, expectedDigest) {
  const problems = [];
  let record = null;
  try {
    record = JSON.parse(Buffer.from(String(encoded ?? ''), 'base64').toString('utf8'));
  } catch (error) {
    problems.push({ code: 'preflight.record_invalid', detail: `undecodable: ${error.message}` });
    return { ok: false, record: null, problems };
  }
  if (!DIGEST_RE.test(String(expectedDigest)) || recordDigest(record) !== expectedDigest) {
    problems.push({ code: 'preflight.record_invalid', detail: `digest ${recordDigest(record)} != ${String(expectedDigest)}` });
  }
  problems.push(...validateRecord(record));
  return { ok: problems.length === 0, record, problems };
}

export function validateRecord(r) {
  const problems = [];
  const bad = (detail) => problems.push({ code: 'preflight.record_invalid', detail });
  if (!isObject(r) || r.schema !== RECORD_SCHEMA) {
    bad(`schema ${String(r?.schema)}`);
    return problems;
  }
  if (r.decision !== 'PROCEED' || r.admitted !== true) {
    problems.push({ code: 'preflight.not_admitted', detail: `decision ${String(r.decision)}` });
  }
  if (!SHA_RE.test(String(r.request?.target)) || r.target?.commit !== r.request?.target) bad('target');
  if (!SHA_RE.test(String(r.policy?.revision)) || !DIGEST_RE.test(String(r.policy?.digest))
      || !SHA_RE.test(String(r.policy?.verifierTree?.release)) || !SHA_RE.test(String(r.policy?.verifierTree?.dependencyAudit))) bad('policy');
  if (!Number.isInteger(r.artifact?.id) || !DIGEST_RE.test(String(r.artifact?.digest))
      || !DIGEST_RE.test(String(r.artifact?.treeDigest)) || !DIGEST_RE.test(String(r.artifact?.manifestDigest))) bad('artifact');
  if (!DIGEST_RE.test(String(r.hosting?.configDigest))) bad('hosting');
  if (!ISO_RE.test(String(r.expiresAt))) bad('expiresAt');
  if (!/^[0-9]+$/.test(String(r.certification?.runId)) || !/^[0-9]+$/.test(String(r.certification?.runAttempt))) bad('certification');
  const ev = r.dependencies?.evidence;
  if (!isObject(ev) || ev.schema !== EVIDENCE_SCHEMA || !DIGEST_RE.test(String(ev.recordDigest)) || !DIGEST_RE.test(String(ev.treeDigest))
      || !DIGEST_RE.test(String(ev.lockDigest))) bad('dependencies.evidence');
  const as = r.dependencies?.assessment;
  if (!isObject(as) || as.schema !== ASSESSMENT_SCHEMA || !DIGEST_RE.test(String(as.digest)) || !DIGEST_RE.test(String(as.treeDigest))
      || !Number.isInteger(as.artifact?.id) || !DIGEST_RE.test(String(as.artifact?.digest)) || typeof as.artifact?.name !== 'string'
      || !/^[0-9]+$/.test(String(as.runId)) || !/^[0-9]+$/.test(String(as.runAttempt))
      || !ISO_RE.test(String(as.startedAt)) || !Array.isArray(as.recordsApplied)) bad('dependencies.assessment');
  const pub = r.publisher;
  if (!isObject(pub) || pub.schema !== TOOLING_SCHEMA || !DIGEST_RE.test(String(pub.treeDigest)) || !Number.isInteger(pub.artifact?.id)
      || !DIGEST_RE.test(String(pub.artifact?.digest)) || typeof pub.artifact?.name !== 'string'
      || !/^v\d+\.\d+\.\d+$/.test(String(pub.node)) || typeof pub.entrypoint?.path !== 'string'
      || !/^[0-9a-f]{64}$/.test(String(pub.entrypoint?.sha256))) bad('publisher');
  return problems;
}
