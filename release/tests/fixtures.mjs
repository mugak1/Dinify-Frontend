/**
 * ONE fixture that is deliberately ALLOWED, and helpers that change exactly one fact
 * about it.
 *
 * Every refusal test in this directory starts from `baseline()` and breaks one thing.
 * That is what makes each one discriminating: if a test passes because three other
 * facts were also wrong, it is not evidence about the rule it claims to test. The
 * positive controls assert the same baseline is allowed, so a gate that refused
 * everything could not pass this suite either.
 *
 * THE BASELINE IS NOT THE COMMITTED POLICY, AND SAYS SO. The committed policy refuses
 * every candidate today — the owner prerequisites are outstanding and the backend's
 * served revision cannot be observed until B3 — which is correct, and which a
 * baseline built on it could never demonstrate an ALLOWED case against. So
 * `allowedPolicy()` differs from the committed file in exactly three stated ways:
 * the prerequisites are recorded, the backend serving is observed at a hypothetical
 * public identity, and the approved receipts are this suite's own (produced by the
 * real producer over an in-memory object store). `committed-policy.test.mjs` proves
 * the committed file's refusals separately.
 */

import { readFileSync } from 'node:fs';
import { digestOfValue, treeDigest, contractDigest } from '../lib/canonical.mjs';
import { MANIFEST_SCHEMA, PROVENANCE_SCHEMA, clientExpectationsFrom } from '../lib/manifest.mjs';
import {
  ASSESSMENT_SCHEMA, EVIDENCE_SCHEMA, RETAINED, TOOLING_SCHEMA, buildEvidenceRecord,
} from '../lib/dependency-evidence.mjs';
import { INSTALLED_OBSERVATION, RETAINED_OBSERVATION } from '../../dependency-audit/lib/retained.mjs';
import { manifestStorage } from '../lib/storage.mjs';
import { produceReceipt, receiptDigest } from '../lib/peers.mjs';
import { decide, selectCertifiedArtifact } from '../lib/decide.mjs';
import { buildRecord } from '../lib/record.mjs';

export const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

export const POLICY = JSON.parse(readFileSync(`${ROOT}/release/policy.json`, 'utf8'));
export const D01_CONTRACT = JSON.parse(readFileSync(`${ROOT}/src/app/_shared/order/checkout-limits.contract.json`, 'utf8'));
export const D01_DIGEST = contractDigest(D01_CONTRACT);
export const DECLARATION = JSON.parse(readFileSync(`${ROOT}/${POLICY.storage.declarationPath}`, 'utf8'));
export const STORAGE = manifestStorage(DECLARATION);

export const TARGET_SHA = 'a'.repeat(40);
export const OLDER_SHA = 'b'.repeat(40);
export const BACKEND_SHA = 'c'.repeat(40);
export const ADMIN_SHA = 'd'.repeat(40);
export const SOURCE_TREE = 'e'.repeat(40);
export const NOW = '2026-09-22T12:00:00Z';
export const RUN_STARTED = '2026-09-22T11:30:00Z';
/** When the run STAMPED its candidate: later than it started, as certify.yml does. */
export const STAMPED = '2026-09-22T11:35:00Z';
export const ARTIFACT_ID = 777;
export const ZIP_DIGEST = `sha256:${'5'.repeat(64)}`;
export const HOSTING_DIGEST = `sha256:${'6'.repeat(64)}`;
export const LOCK_DIGEST = `sha256:${'1'.repeat(64)}`;

// ── the dependency half (D08 B2.2) ─────────────────────────────────────────────
// SYNTHETIC FACTS, in exactly the shapes the adapters produce: an evidence bundle as
// inspectEvidenceBundle() reports a sound one, an assessment as inspectAssessment()
// reports one, and the toolchain as prepare-publisher writes tooling.json. The pure
// matrix proves the RULES over them; that the real producers emit these shapes, and
// that a real bundle survives inspection, is proved through the I/O layer
// (dependency-evidence.test.mjs, workflow-simulation.test.mjs).
export const HEX = (c) => c.repeat(64);
export const EVALUATION = Object.freeze({ runId: '9100', runAttempt: '1' });
export const TRUSTED_REVISION = '9'.repeat(40);
export const AUDIT_POLICY_SHA = HEX('a');
export const SCANNER_LOCK_SHA = HEX('b');
export const SCANNER_MANIFEST_SHA = HEX('c');
export const PUBLISHER_LOCK_SHA = HEX('d');
export const PUBLISHER_MANIFEST_SHA = HEX('e');
export const MANIFEST_SHA = HEX('2');
export const INSTALLED_TREE_SHA = HEX('3');
export const PUBLISHER_TREE_SHA = HEX('4');
export const TOOLING_TREE = `sha256:${HEX('8')}`;
export const ENTRYPOINT_SHA = HEX('f');
export const TOOLING_ARTIFACT = Object.freeze({ id: 91001, digest: `sha256:${HEX('7')}` });
export const ASSESSMENT_ARTIFACT = Object.freeze({ id: 91002, digest: `sha256:${HEX('6')}` });
export const EVIDENCE_TREE = `sha256:${HEX('9')}`;
export const ENVIRONMENT = Object.freeze({ node: 'v24.21.0', platform: 'linux', arch: 'x64', libc: 'glibc' });

/** A deep clone that keeps the fixtures independent between tests. */
export const clone = (value) => JSON.parse(JSON.stringify(value));

export const CONSTANTS = Object.freeze({
  CHECKOUT_RECORD_VERSION: 2,
  REQUIRED_QUOTE_PROTOCOL: 1,
  REQUIRED_CLOSURE_PROTOCOL: 2,
  REQUIRED_KITCHEN_PROTOCOL: 1,
  CHECKOUT_PROTOCOL_CORRELATED: 3,
});

/** A storage projection with the given pairs, carrying a digest over its own content. */
export function storageProjection({
  writes = STORAGE.writes, reads = STORAGE.reads, key = STORAGE.key, store = STORAGE.store,
  physicalKey = STORAGE.physicalKey, encoding = STORAGE.encoding,
} = {}) {
  const body = { store, key, physicalKey, encoding, writes, reads };
  return { ...clone(body), declarationDigest: digestOfValue(body) };
}

export function manifestFor({ commit = TARGET_SHA, storage = STORAGE, runAttempt = '1', builtAt = STAMPED } = {}) {
  return {
    schema: MANIFEST_SCHEMA,
    application: 'dinify-frontend',
    repository: 'mugak1/Dinify-Frontend',
    commit,
    ref: 'refs/heads/main',
    source: { tree: SOURCE_TREE },
    buildConfiguration: 'uat',
    builtAt,
    environment: {
      name: 'uat-targeted',
      apiUrl: 'https://api-test.dinifyapp.com/uat',
      dinerBaseUrl: 'https://order.dinifyapp.com',
      productionFlag: false,
    },
    dependencies: { lockDigest: LOCK_DIGEST, nodeVersion: 'v24.21.0' },
    certification: {
      workflowPath: '.github/workflows/certify.yml',
      runId: '4242',
      runAttempt,
      runStartedAt: builtAt,
    },
    compatibility: {
      storage: clone(storage),
      clientExpects: clientExpectationsFrom(CONSTANTS),
      clientSupports: { quote_policy_version: [1] },
      clientConstants: { ...CONSTANTS },
      contracts: { d01CheckoutLimits: D01_DIGEST },
    },
    hosting: {
      project: 'dinify-dev',
      site: 'dinify-prod',
      target: 'dinify-prod',
      identityPath: '/release.json',
    },
  };
}

export function provenanceFor(manifest, digest, { evidence } = {}) {
  const e = evidence ?? evidenceFor(manifest, { treeDigest: digest });
  return {
    schema: PROVENANCE_SCHEMA,
    application: manifest.application,
    repository: manifest.repository,
    commit: manifest.commit,
    buildConfiguration: manifest.buildConfiguration,
    certification: manifest.certification,
    artifactName: `frontend-release-${manifest.certification.runId}-${manifest.certification.runAttempt}`,
    artifactTreeDigest: digest,
    entryCount: 3,
    manifestDigest: digestOfValue(manifest),
    dependencyEvidence: { schema: EVIDENCE_SCHEMA, recordDigest: e.recordDigest, treeDigest: e.treeDigest, entryCount: e.entryCount },
  };
}

export const TREE_DIGEST = treeDigest([
  { path: 'index.html', sha256: '0'.repeat(64) },
  { path: 'release.json', sha256: '1'.repeat(64) },
  { path: 'main-abc.js', sha256: '2'.repeat(64) },
]);

/**
 * An in-memory git object store, so the REAL receipt producer runs in a pure test.
 * `files` maps path → text at `commit`; blobs are named by the text's digest.
 */
export function fakeGit({ commit, tree = 'f'.repeat(40), files }) {
  const blobs = new Map(Object.entries(files).map(([path, text]) => [path, digestOfValue({ path, text }).slice(7, 47)]));
  return (args) => {
    const [cmd, ...rest] = args;
    if (cmd === 'rev-parse' && rest[0] === '--verify') return rest[2] === `${commit}^{commit}` ? `${commit}\n` : '';
    if (cmd === 'rev-parse') return `${tree}\n`;
    if (cmd === 'ls-tree') {
      const path = rest[rest.length - 1];
      return blobs.has(path) ? `100644 blob ${blobs.get(path)}\t${path}\n` : '';
    }
    if (cmd === 'cat-file') {
      const blob = rest[1];
      const hit = [...blobs.entries()].find(([, b]) => b === blob);
      return hit ? files[hit[0]] : '';
    }
    throw new Error(`fakeGit: unexpected ${args.join(' ')}`);
  };
}

export const BACKEND_PUBLISHES = Object.freeze({ checkout_protocol: 3, quote_protocol: 2, kitchen_protocol: 1, quote_policy_version: 1 });

export function backendReceipt({ commit = BACKEND_SHA, publishes = BACKEND_PUBLISHES, d01 = D01_CONTRACT } = {}) {
  const files = {
    'orders_app/contracts/checkout_limits.contract.json': JSON.stringify(d01),
  };
  if (publishes) files['orders_app/contracts/published_capabilities.contract.json'] = JSON.stringify({ _note: 'fixture', ...publishes });
  return produceReceipt({ peer: 'backend', repository: 'mugak1/Dinify-Backend', commit, git: fakeGit({ commit, files }) });
}

export function adminReceipt({ commit = ADMIN_SHA } = {}) {
  return produceReceipt({
    peer: 'admin', repository: 'mugak1/Dinify-Admin', commit,
    git: fakeGit({ commit, files: { '.github/workflows/deploy.yml': 'name: Deploy\n' } }),
  });
}

/**
 * The committed policy with three stated differences: prerequisites recorded, backend
 * serving observed at a hypothetical identity, and this suite's own receipts approved.
 */
export function allowedPolicy({ backend = backendReceipt(), admin = adminReceipt() } = {}) {
  const policy = clone(POLICY);
  policy.prerequisites.sourceProtection.status = 'recorded';
  policy.prerequisites.retention.status = 'verified';
  policy.prerequisites.singlePublisher.status = 'single-publisher';
  policy.compatibleSet.peers.backend.approved = [
    { commit: backend.commit, receipt: `release/peers/backend-${backend.commit}.json`, receiptDigest: receiptDigest(backend) },
  ];
  policy.compatibleSet.peers.backend.serving = { observation: 'public-identity', origin: 'https://backend.example', path: '/release.txt' };
  policy.compatibleSet.peers.admin.approved = [
    { commit: admin.commit, receipt: `release/peers/admin-${admin.commit}.json`, receiptDigest: receiptDigest(admin) },
  ];
  return policy;
}

export function peersFor({ backend = backendReceipt(), admin = adminReceipt() } = {}) {
  return {
    receipts: {
      backend: [{ commit: backend.commit, path: `release/peers/backend-${backend.commit}.json`, present: true, readable: true, receipt: backend, digest: receiptDigest(backend) }],
      admin: [{ commit: admin.commit, path: `release/peers/admin-${admin.commit}.json`, present: true, readable: true, receipt: admin, digest: receiptDigest(admin) }],
    },
    verification: { admin: { [admin.commit]: { state: 'verified', detail: '' } } },
    serving: {
      backend: { state: 'known', commit: backend.commit, noStore: true, cacheControl: 'no-store' },
      admin: { state: 'known', commit: admin.commit, noStore: true, cacheControl: 'no-store' },
    },
  };
}

const COUNTS = Object.freeze({ findings: 0, blocking: 0, excepted: 0, triageRequired: 0, triaged: 0, unresolved: 0, refusedRecords: 0, appliedRecords: 0 });

/**
 * The certification evidence of `manifest`'s candidate, as inspectEvidenceBundle()
 * reports a sound bundle. The record is built by the REAL producer (buildEvidenceRecord)
 * from synthetic audit documents, so its shape cannot drift from what `stamp` writes.
 */
export function evidenceFor(manifest = manifestFor(), { treeDigest = TREE_DIGEST, outcome = 'within_policy' } = {}) {
  const lockSha = manifest.dependencies.lockDigest.slice(7);
  const snapshot = {
    capturedAt: manifest.certification.runStartedAt,
    binding: {
      repository: manifest.repository,
      revision: { commit: manifest.commit, tree: manifest.source.tree },
      environment: { ...ENVIRONMENT, node: manifest.dependencies.nodeVersion },
      application: { lockfileSha256: lockSha, manifestSha256: MANIFEST_SHA, installedTreeSha256: INSTALLED_TREE_SHA, locked: 3, installed: 3 },
    },
    packages: [{ path: 'application:node_modules/shipped', name: 'shipped', version: '2.0.0' }],
  };
  const collection = {
    startedAt: manifest.certification.runStartedAt,
    scanner: { package: 'npm', pinned: '11.19.1' },
    graphs: { scanner: { digests: { lockfileSha256: SCANNER_LOCK_SHA, manifestSha256: SCANNER_MANIFEST_SHA, installedTreeSha256: HEX('5') } } },
  };
  const result = { outcome, exitCode: outcome === 'within_policy' || outcome === 'exceptions_only' ? 0 : outcome === 'blocking' ? 1 : 2, counts: { ...COUNTS } };
  const reevaluation = { decidedAt: manifest.certification.runStartedAt, outcome };
  const files = [
    { path: RETAINED.manifest, sha256: MANIFEST_SHA, bytes: 100 },
    { path: RETAINED.lockfile, sha256: lockSha, bytes: 200 },
  ];
  const record = buildEvidenceRecord({
    repository: manifest.repository, commit: manifest.commit, tree: manifest.source.tree, buildConfiguration: manifest.buildConfiguration,
    certification: manifest.certification, snapshot, collection, result, reevaluation, files,
    candidate: { artifactTreeDigest: treeDigest, manifestDigest: digestOfValue(manifest), entryCount: 3 },
  });
  return {
    state: 'present', problems: [], unsafe: [], record, recordDigest: digestOfValue(record), treeDigest: EVIDENCE_TREE, entryCount: 13,
    inputs: { manifestSha256: MANIFEST_SHA, lockfileSha256: lockSha, lockDigest: manifest.dependencies.lockDigest, manifestDigest: `sha256:${MANIFEST_SHA}` },
    audit: { outcome, counts: { ...COUNTS }, findings: 0 },
  };
}

/** tooling.json, as prepare-publisher writes it for the reviewed lock. */
export function toolingFor(policy = POLICY) {
  return {
    schema: TOOLING_SCHEMA, package: policy.publisher.package, version: policy.publisher.version, node: `v${policy.publisher.node}`,
    lock: { lockfileSha256: PUBLISHER_LOCK_SHA, manifestSha256: PUBLISHER_MANIFEST_SHA },
    installedTreeSha256: PUBLISHER_TREE_SHA, locked: 672, installed: 671, absentOptional: 1,
    treeDigest: TOOLING_TREE, entryCount: 20272, entrypoint: { path: policy.publisher.entrypoint, sha256: ENTRYPOINT_SHA },
    removedLinks: 6, problems: [],
  };
}

const graph = (name, observation, digests, { startedAt, finishedAt, locked }) => ({
  observation, startedAt, finishedAt, digests, counts: { locked },
  run: {
    argv: ['node', 'npm-cli.js', 'audit', '--json'], status: 0, signal: null, timedOut: false, error: null, durationMs: 900,
    stdoutFile: `${name}.scanner-stdout.txt`, stdoutSha256: HEX('0'), stdoutBytes: 10,
    stderrFile: `${name}.scanner-stderr.txt`, stderrSha256: HEX('0'),
  },
});

/**
 * The fresh assessment of the baseline candidate, as inspectAssessment() reports one.
 * Collected ten minutes before NOW by THIS evaluation (EVALUATION), under the trusted
 * audit policy, over the candidate's retained graph, the pinned scanner and the
 * prepared toolchain.
 */
export function assessmentFor({ manifest = manifestFor(), evidence = evidenceFor(manifest), tooling = toolingFor(), startedAt = '2026-09-22T11:50:00Z', outcome = 'within_policy', recordsApplied = [] } = {}) {
  const at = (minutes) => new Date(Date.parse(startedAt) + minutes * 60_000).toISOString().replace(/\.000Z$/, 'Z');
  const doc = {
    schema: ASSESSMENT_SCHEMA,
    purpose: 'promotion',
    repository: manifest.repository,
    assessor: { runId: EVALUATION.runId, runAttempt: EVALUATION.runAttempt, revision: TRUSTED_REVISION },
    candidate: {
      commit: manifest.commit, runId: manifest.certification.runId, runAttempt: manifest.certification.runAttempt,
      artifactId: ARTIFACT_ID, artifactDigest: ZIP_DIGEST, treeDigest: evidence.record.candidate.artifactTreeDigest,
      manifestDigest: digestOfValue(manifest), evidenceRecordDigest: evidence.recordDigest,
    },
    policy: { path: 'dependency-audit/policy.json', sha256: AUDIT_POLICY_SHA },
    scanner: { package: 'npm', version: '11.19.1', registry: 'https://registry.npmjs.org/' },
    tooling: { package: tooling.package, version: tooling.version, treeDigest: tooling.treeDigest },
    startedAt,
    finishedAt: at(3),
    decidedAt: at(3),
    graphs: {
      application: graph('application', RETAINED_OBSERVATION, {
        lockfileSha256: evidence.inputs.lockfileSha256, manifestSha256: evidence.inputs.manifestSha256,
        installedTreeSha256: evidence.record.inventory.installedTreeSha256,
      }, { startedAt: at(0), finishedAt: at(1), locked: evidence.record.inventory.locked }),
      scanner: graph('scanner', INSTALLED_OBSERVATION, { lockfileSha256: SCANNER_LOCK_SHA, manifestSha256: SCANNER_MANIFEST_SHA, installedTreeSha256: HEX('5') },
        { startedAt: at(1), finishedAt: at(2), locked: 144 }),
      publisher: graph('publisher', INSTALLED_OBSERVATION, { lockfileSha256: tooling.lock.lockfileSha256, manifestSha256: tooling.lock.manifestSha256, installedTreeSha256: tooling.installedTreeSha256 },
        { startedAt: at(2), finishedAt: at(3), locked: tooling.locked }),
    },
    headline: 'WITHIN POLICY',
    outcome,
    exitCode: outcome === 'within_policy' || outcome === 'exceptions_only' ? 0 : outcome === 'blocking' ? 1 : 2,
    counts: { ...COUNTS },
    reasons: [],
    findings: [],
    records: [],
    recordsApplied,
  };
  return { state: 'present', problems: [], doc, digest: digestOfValue(doc), treeDigest: `sha256:${HEX('1')}`, entryCount: 7 };
}

/** The fresh half as `decide` receives it. */
export function dependenciesFor({ policy = POLICY, manifest = manifestFor(), evidence, tooling, assessment } = {}) {
  const t = tooling ?? toolingFor(policy);
  const e = evidence ?? evidenceFor(manifest);
  return {
    tooling: t,
    assessment: assessment ?? assessmentFor({ manifest, evidence: e, tooling: t }),
    uploads: {
      tooling: { ...TOOLING_ARTIFACT, name: `publisher-tooling-${EVALUATION.runId}-${EVALUATION.runAttempt}` },
      assessment: { ...ASSESSMENT_ARTIFACT, name: `publish-assessment-${EVALUATION.runId}-${EVALUATION.runAttempt}` },
    },
  };
}

/** What the trusted checkout states about its own audit policy, scanner and publisher lock. */
export const TRUSTED = Object.freeze({
  legacyPublisherPresent: false,
  revision: TRUSTED_REVISION,
  auditPolicySha256: AUDIT_POLICY_SHA,
  scannerLockfileSha256: SCANNER_LOCK_SHA,
  publisherLockfileSha256: PUBLISHER_LOCK_SHA,
  publisherManifestSha256: PUBLISHER_MANIFEST_SHA,
});

/** Source facts that agree with `manifestFor()`, as git-facts would report them. */
export function sourceFor(manifest = manifestFor()) {
  return {
    present: true,
    commit: manifest.commit,
    tree: manifest.source.tree,
    constants: { ...manifest.compatibility.clientConstants },
    supportedQuotePolicyVersions: [...manifest.compatibility.clientSupports.quote_policy_version],
    environment: { apiUrl: manifest.environment.apiUrl, dinerBaseUrl: manifest.environment.dinerBaseUrl, production: manifest.environment.productionFlag },
    lockDigest: manifest.dependencies.lockDigest,
    manifestDigest: `sha256:${MANIFEST_SHA}`,
    d01Digest: manifest.compatibility.contracts.d01CheckoutLimits,
    storage: {
      present: true, problems: [], stale: [],
      digest: manifest.compatibility.storage.declarationDigest,
      projection: clone(manifest.compatibility.storage),
    },
  };
}

export function servedKnown({ commit = OLDER_SHA, relation = 'descendant', storage = STORAGE, manifest } = {}) {
  const m = manifest ?? manifestFor({ commit, storage });
  return {
    state: 'known',
    servedCommit: m.commit,
    manifest: m,
    manifestDigest: digestOfValue(m),
    relationToTarget: relation,
    cacheControl: 'no-store',
    cacheControlNoStore: true,
  };
}

/**
 * The allowed case: an automatic deployment of a freshly certified candidate that
 * descends from what is served, beside approved and observed peers.
 */
export function baseline() {
  const manifest = manifestFor();
  const policy = allowedPolicy();
  const evidence = evidenceFor(manifest);
  return {
    policy,
    request: { mode: 'deploy', trigger: 'automatic', target: TARGET_SHA },
    certification: {
      present: true,
      repository: 'mugak1/Dinify-Frontend',
      headRepository: 'mugak1/Dinify-Frontend',
      workflowPath: '.github/workflows/certify.yml',
      event: 'push',
      headBranch: 'main',
      headSha: TARGET_SHA,
      conclusion: 'success',
      runId: '4242',
      runAttempt: '1',
      runStartedAt: RUN_STARTED,
      ancestorOfDefaultBranch: true,
      checks: [{ name: 'certify', status: 'completed', conclusion: 'success' }],
      checksTruncated: false,
      artifacts: [{ id: ARTIFACT_ID, name: 'frontend-release-4242-1', expired: false, digest: ZIP_DIGEST, workflowRunId: 4242 }],
    },
    artifact: {
      present: true,
      artifactId: ARTIFACT_ID,
      manifest,
      manifestDigest: digestOfValue(manifest),
      manifestValid: true,
      manifestProblems: [],
      provenanceValid: true,
      provenanceProblems: [],
      expectedTreeDigest: TREE_DIGEST,
      observedTreeDigest: TREE_DIGEST,
      entryCount: 3,
      files: ['index.html', 'main-abc.js', 'release.json'],
      unsafeEntries: [],
      provenance: { schema: PROVENANCE_SCHEMA, legacy: false },
      dependencyEvidence: evidence,
    },
    source: sourceFor(manifest),
    hosting: { problems: [], digest: HOSTING_DIGEST, config: {}, rc: {} },
    served: servedKnown(),
    baseline: { state: 'none' },
    eligibility: { relationToMinimum: 'not-applicable' },
    peers: peersFor(),
    trusted: { ...TRUSTED },
    dependencies: dependenciesFor({ policy, manifest, evidence }),
    evaluation: { ...EVALUATION },
    now: NOW,
  };
}

/**
 * The input's candidate is now a DIFFERENT, legitimately certified candidate (a re-run,
 * a candidate with another storage declaration): its certification evidence and its
 * fresh assessment describe it, as they would for a real one. A test that changes the
 * manifest WITHOUT calling this is testing that stale evidence is refused.
 */
export function reattest(input) {
  const manifest = input.artifact.manifest;
  input.artifact.manifestDigest = digestOfValue(manifest);
  const evidence = evidenceFor(manifest, { treeDigest: input.artifact.observedTreeDigest });
  input.artifact.dependencyEvidence = evidence;
  input.dependencies = dependenciesFor({ policy: input.policy, manifest, evidence });
  return input;
}

/**
 * Re-derive the candidate's evidence for its current manifest, and re-point the EXISTING
 * assessment at it — for a test that is about the assessment's own times, not about
 * which candidate it names.
 */
export function reattestKeepingAssessment(input) {
  const doc = input.dependencies.assessment.doc;
  reattest(input);
  const fresh = input.dependencies.assessment.doc;
  for (const key of ['startedAt', 'finishedAt', 'decidedAt']) fresh[key] = doc[key];
  for (const g of Object.keys(fresh.graphs)) { fresh.graphs[g].startedAt = doc.graphs[g].startedAt; fresh.graphs[g].finishedAt = doc.graphs[g].finishedAt; }
  return input;
}

/** Put a different storage declaration on the CANDIDATE — manifest and source together. */
export function withCandidateStorage(input, storage) {
  input.artifact.manifest.compatibility.storage = clone(storage);
  input.source.storage.projection = clone(storage);
  input.source.storage.digest = storage.declarationDigest;
  return reattest(input);
}

/** Codes present in a decision, for assertions that name the rule under test. */
export const codes = (result) => result.reasons.map((r) => r.code);

// ── the admitted record, and what the publisher sees when nothing moved ──────────

/** The trusted checkout's policy facts, as git-facts reports them. */
export const POLICY_FACTS = Object.freeze({
  revision: '9'.repeat(40), digest: `sha256:${'8'.repeat(64)}`,
  verifierTree: Object.freeze({ release: '7'.repeat(40), dependencyAudit: '6'.repeat(40) }),
});

/** The record the gate emits for an input, exactly as `decide` builds it. */
export function admittedRecordFor(input = baseline(), { policyFacts = POLICY_FACTS } = {}) {
  const decision = decide(input);
  const listed = selectCertifiedArtifact(input.certification.artifacts, {
    runId: input.certification.runId, runAttempt: input.certification.runAttempt,
  }).artifact;
  return buildRecord({
    decision, request: input.request, policyFacts: clone(policyFacts), certification: input.certification,
    listedArtifact: listed, artifact: input.artifact, hosting: input.hosting, served: input.served,
    peers: input.peers, policy: input.policy, now: input.now, dependencies: input.dependencies,
  });
}

/**
 * What the publisher's preflight observes when NOTHING has changed since the gate: the
 * same verifier, run, listing, download, hosting configuration, served state and peers —
 * and THIS run's own uploads of the toolchain and the assessment, downloaded intact.
 */
export function unchangedPreflightFacts(record, input = baseline()) {
  const listed = (a) => ({ id: a.id, name: a.name, expired: false, digest: a.digest, workflowRunId: Number(record.dependencies.assessment.runId) });
  return {
    trusted: { verifierTree: clone(record.policy.verifierTree), policyDigest: record.policy.digest },
    current: { state: 'known', verifierTree: clone(record.policy.verifierTree) },
    run: { present: true, conclusion: 'success', headSha: record.target.commit, runAttempt: record.certification.runAttempt },
    artifacts: [{ id: record.artifact.id, name: record.artifact.name, expired: false, digest: record.artifact.digest, workflowRunId: Number(record.certification.runId) }],
    candidate: {
      present: true, valid: true, treeDigest: record.artifact.treeDigest, manifestDigest: record.artifact.manifestDigest, unsafe: [],
      evidenceRecordDigest: record.dependencies.evidence.recordDigest, evidenceTreeDigest: record.dependencies.evidence.treeDigest,
    },
    evaluation: { runId: record.dependencies.assessment.runId, runAttempt: record.dependencies.assessment.runAttempt },
    evaluationArtifacts: [listed(record.dependencies.assessment.artifact), listed(record.publisher.artifact)],
    tooling: {
      treeDigest: record.publisher.treeDigest, entryCount: record.publisher.entryCount, unsafe: [],
      entrypointSha256: record.publisher.entrypoint.sha256, runtime: record.publisher.node,
    },
    assessment: clone(input.dependencies.assessment),
    compare: { status: 'ahead' },
    served: { state: record.served.state, servedCommit: record.served.commit, manifestDigest: record.served.manifestDigest },
    adminServed: { state: 'known', commit: record.peers.adminServed },
    hosting: { problems: [], digest: record.hosting.configDigest },
    certifiedCheckout: { head: record.target.commit },
  };
}
