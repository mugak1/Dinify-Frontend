/**
 * ONE fixture that is deliberately ALLOWED, and helpers that change exactly one fact
 * about it.
 *
 * Every refusal test in this directory starts from `baseline()` and breaks one thing.
 * That is what makes each one discriminating: if a test passes because three other
 * facts were also wrong, it is not evidence about the rule it claims to test. The
 * positive controls assert the same baseline is allowed, so a gate that refused
 * everything could not pass this suite either.
 */

import { readFileSync } from 'node:fs';
import { digestOfValue, treeDigest, contractDigest } from '../lib/canonical.mjs';
import { MANIFEST_SCHEMA, PROVENANCE_SCHEMA } from '../lib/manifest.mjs';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

export const POLICY = JSON.parse(readFileSync(`${ROOT}/release/policy.json`, 'utf8'));
export const D01_DIGEST = contractDigest(
  JSON.parse(readFileSync(`${ROOT}/src/app/_shared/order/checkout-limits.contract.json`, 'utf8')),
);

export const TARGET_SHA = 'a'.repeat(40);
export const OLDER_SHA = 'b'.repeat(40);
export const NOW = '2026-09-22T12:00:00Z';
export const RUN_STARTED = '2026-09-22T11:30:00Z';

/** A deep clone that keeps the fixtures independent between tests. */
export const clone = (value) => JSON.parse(JSON.stringify(value));

export function manifestFor({ commit = TARGET_SHA, storage = { checkoutRecordVersion: 2, semanticsRevision: 1 } } = {}) {
  return {
    schema: MANIFEST_SCHEMA,
    application: 'dinify-frontend',
    repository: 'mugak1/Dinify-Frontend',
    commit,
    ref: 'refs/heads/main',
    buildConfiguration: 'uat',
    builtAt: RUN_STARTED,
    environment: {
      name: 'uat-targeted',
      apiUrl: 'https://api-test.dinifyapp.com/uat',
      dinerBaseUrl: 'https://order.dinifyapp.com',
      productionFlag: false,
    },
    dependencies: { lockDigest: `sha256:${'1'.repeat(64)}`, nodeVersion: '24.21.0' },
    certification: {
      workflowPath: '.github/workflows/certify.yml',
      runId: '4242',
      runAttempt: '1',
      runStartedAt: RUN_STARTED,
    },
    compatibility: {
      storage,
      clientExpects: { checkout_protocol: 3, quote_protocol: 2, kitchen_protocol: 1 },
      clientConstants: {
        CHECKOUT_RECORD_VERSION: storage.checkoutRecordVersion,
        REQUIRED_QUOTE_PROTOCOL: 1,
        REQUIRED_CLOSURE_PROTOCOL: 2,
        REQUIRED_KITCHEN_PROTOCOL: 1,
        CHECKOUT_PROTOCOL_CORRELATED: 3,
      },
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
    artifactName: `frontend-release-${manifest.commit}`,
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
 * The allowed case: an automatic deployment of a freshly certified candidate that
 * descends from what is served.
 *
 * The policy is cloned with `bootstrap.authorized` left FALSE — the served state here
 * is `known`, so bootstrap never applies and the baseline does not quietly depend on
 * it. The one policy field the baseline does change is `publication`, which decide()
 * does not read at all; it is the workflow's enablement, not a gate.
 */
export function baseline() {
  const manifest = manifestFor();
  return {
    policy: clone(POLICY),
    request: { mode: 'deploy', trigger: 'automatic' },
    certification: {
      present: true,
      repository: 'mugak1/Dinify-Frontend',
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
    },
    artifact: {
      present: true,
      manifest,
      manifestValid: true,
      manifestProblems: [],
      provenanceValid: true,
      provenanceProblems: [],
      expectedTreeDigest: TREE_DIGEST,
      observedTreeDigest: TREE_DIGEST,
      entryCount: 3,
      unsafeEntries: [],
      hostingConfigHooks: [],
      hostingConfigMatchesCertified: true,
    },
    served: {
      state: 'known',
      servedCommit: OLDER_SHA,
      relationToTarget: 'descendant',
      cacheControl: 'no-store',
      cacheControlNoStore: true,
      targetRetained: false,
      manifest: manifestFor({ commit: OLDER_SHA }),
    },
    now: NOW,
  };
}

/** Codes present in a decision, for assertions that name the rule under test. */
export const codes = (result) => result.reasons.map((r) => r.code);
