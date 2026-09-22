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
import { manifestStorage } from '../lib/storage.mjs';
import { produceReceipt, receiptDigest } from '../lib/peers.mjs';

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
export const ARTIFACT_ID = 777;
export const ZIP_DIGEST = `sha256:${'5'.repeat(64)}`;
export const HOSTING_DIGEST = `sha256:${'6'.repeat(64)}`;
export const LOCK_DIGEST = `sha256:${'1'.repeat(64)}`;

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
export function storageProjection({ writes = STORAGE.writes, reads = STORAGE.reads, key = STORAGE.key, store = STORAGE.store } = {}) {
  const body = { store, key, writes, reads };
  return { ...clone(body), declarationDigest: digestOfValue(body) };
}

export function manifestFor({ commit = TARGET_SHA, storage = STORAGE, runAttempt = '1', builtAt = RUN_STARTED } = {}) {
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
      runStartedAt: RUN_STARTED,
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

export function provenanceFor(manifest, digest) {
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
  return {
    policy: allowedPolicy(),
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
    },
    source: sourceFor(manifest),
    hosting: { problems: [], digest: HOSTING_DIGEST, config: {}, rc: {} },
    served: servedKnown(),
    baseline: { state: 'none' },
    eligibility: { relationToMinimum: 'not-applicable' },
    peers: peersFor(),
    trusted: { legacyPublisherPresent: false },
    now: NOW,
  };
}

/** Put a different storage declaration on the CANDIDATE — manifest and source together. */
export function withCandidateStorage(input, storage) {
  input.artifact.manifest.compatibility.storage = clone(storage);
  input.artifact.manifestDigest = digestOfValue(input.artifact.manifest);
  input.source.storage.projection = clone(storage);
  input.source.storage.digest = storage.declarationDigest;
  return input;
}

/** Codes present in a decision, for assertions that name the rule under test. */
export const codes = (result) => result.reasons.map((r) => r.code);
