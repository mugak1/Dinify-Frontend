/**
 * The release manifest — what a candidate IS, as machine-readable data.
 *
 * A2 (Stage B approval): the certification unit is
 *   (repository, commit, build configuration, dependency-lock digest,
 *    artifact digest, certifying run)
 * extended to an enforced compatible-release record. `release/README.md` is the
 * explanation for a human; THIS is the thing the gate reads, and the gate refuses
 * anything it cannot validate here.
 *
 * TWO RECORDS, DELIBERATELY SEPARATE, AND THE SPLIT IS LOAD-BEARING:
 *
 *   dist/release.json   the INNER manifest. Ships inside the artifact, is served at
 *                       /release.json, and is what a later run reads back off the
 *                       public origin to learn which release is live. It carries no
 *                       digest of itself — an artifact cannot contain its own final
 *                       hash.
 *   provenance.json     the OUTER record. Never shipped. Binds the inner manifest to
 *                       the artifact TREE DIGEST and to the certifying run, and is
 *                       what the publisher compares its own recomputation against.
 *
 * Everything here is pure. `now` is an argument; nothing reads a clock, a file or an
 * environment variable, so every field in a produced manifest is traceable to a
 * caller that had to state it.
 */

import { digestOfValue } from './canonical.mjs';
import { comparable } from './storage.mjs';

// /2 (D08 B1 completion): the manifest now binds the SOURCE TREE it was built from,
// declares storage compatibility as the exact pairs the build writes and reads
// (release/lib/storage.mjs), and states which quote-policy versions the client can
// act on. A /1 manifest is refused rather than read as /2 — its storage fields
// mean something different, and guessing is how a barrier is bypassed.
export const MANIFEST_SCHEMA = 'dinify.release.manifest/2';
export const PROVENANCE_SCHEMA = 'dinify.release.provenance/1';

const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function fail(problems, code, detail) {
  problems.push({ code, detail });
}

/**
 * Validate an INNER manifest. Returns `{ok, problems}` and never throws on data —
 * a malformed manifest is a refusal with a reason, not an exception that a shell
 * step might swallow.
 */
export function validateManifest(manifest) {
  const problems = [];
  const m = manifest;
  if (m === null || typeof m !== 'object' || Array.isArray(m)) {
    fail(problems, 'manifest.not_an_object', typeof m);
    return { ok: false, problems };
  }
  if (m.schema !== MANIFEST_SCHEMA) {
    fail(problems, 'manifest.wrong_schema', String(m.schema));
  }
  if (typeof m.application !== 'string' || m.application.length === 0) {
    fail(problems, 'manifest.no_application', String(m.application));
  }
  if (typeof m.repository !== 'string' || !m.repository.includes('/')) {
    fail(problems, 'manifest.no_repository', String(m.repository));
  }
  if (typeof m.commit !== 'string' || !SHA_RE.test(m.commit)) {
    fail(problems, 'manifest.bad_commit', String(m.commit));
  }
  // THE SOURCE TREE. A commit names history; the tree names content. The gate
  // re-derives this from git at the certified commit, so a candidate whose manifest
  // names one commit while describing another tree is refused rather than trusted.
  if (m.source === null || typeof m.source !== 'object' || !SHA_RE.test(m.source?.tree ?? '')) {
    fail(problems, 'manifest.bad_source_tree', String(m.source?.tree));
  }
  if (typeof m.buildConfiguration !== 'string' || m.buildConfiguration.length === 0) {
    fail(problems, 'manifest.no_build_configuration', String(m.buildConfiguration));
  }
  if (typeof m.builtAt !== 'string' || !ISO_RE.test(m.builtAt)) {
    fail(problems, 'manifest.bad_built_at', String(m.builtAt));
  }

  const env = m.environment;
  if (env === null || typeof env !== 'object') {
    fail(problems, 'manifest.no_environment', String(env));
  } else {
    if (typeof env.name !== 'string' || env.name.length === 0) {
      fail(problems, 'manifest.no_environment_name', String(env.name));
    }
    if (typeof env.apiUrl !== 'string' || !env.apiUrl.startsWith('https://')) {
      fail(problems, 'manifest.bad_api_url', String(env.apiUrl));
    }
    // Recorded as a fact, never as a claim. The shipping configuration today bakes
    // `production: false`, which changes diagnostic behaviour in the served bundle
    // (see release/README.md). It is written down so nobody has to infer it, and so
    // a change of it is visible in a diff rather than discovered in a browser.
    if (typeof env.productionFlag !== 'boolean') {
      fail(problems, 'manifest.no_production_flag', String(env.productionFlag));
    }
  }

  const dep = m.dependencies;
  if (dep === null || typeof dep !== 'object') {
    fail(problems, 'manifest.no_dependencies', String(dep));
  } else if (!DIGEST_RE.test(dep.lockDigest ?? '')) {
    fail(problems, 'manifest.bad_lock_digest', String(dep?.lockDigest));
  }

  const cert = m.certification;
  if (cert === null || typeof cert !== 'object') {
    fail(problems, 'manifest.no_certification', String(cert));
  } else {
    if (typeof cert.workflowPath !== 'string' || !cert.workflowPath.startsWith('.github/workflows/')) {
      fail(problems, 'manifest.bad_workflow_path', String(cert?.workflowPath));
    }
    for (const key of ['runId', 'runAttempt']) {
      if (typeof cert[key] !== 'string' || !/^[0-9]+$/.test(cert[key])) {
        fail(problems, 'manifest.bad_run_reference', `${key}=${String(cert?.[key])}`);
      }
    }
  }

  const compat = m.compatibility;
  if (compat === null || typeof compat !== 'object') {
    fail(problems, 'manifest.no_compatibility', String(compat));
  } else {
    // STORAGE COMPATIBILITY, as declared pairs — see release/lib/storage.mjs. The
    // digest binds the whole reviewed declaration (including its source tripwire);
    // the pairs are what the gate compares, as set containment and never numerically.
    const storage = compat.storage;
    if (!comparable(storage)) {
      fail(problems, 'manifest.bad_storage', JSON.stringify(storage));
    } else {
      if (typeof storage.store !== 'string' || typeof storage.key !== 'string') {
        fail(problems, 'manifest.bad_storage', 'store/key');
      }
      if (!DIGEST_RE.test(storage.declarationDigest ?? '')) {
        fail(problems, 'manifest.bad_storage_declaration_digest', String(storage.declarationDigest));
      }
    }
    // Which quote-policy versions this client can ACT on. A backend publishing a
    // version outside this list is one whose closures the client may not treat as
    // usable evidence, so the pairing is refused rather than discovered at checkout.
    const supports = compat.clientSupports?.quote_policy_version;
    if (!Array.isArray(supports) || supports.length === 0 || !supports.every((v) => Number.isInteger(v) && v >= 1)) {
      fail(problems, 'manifest.bad_client_supports', JSON.stringify(compat.clientSupports));
    }
    // KEYED BY THE SERVER CAPABILITY NAME, not by the client constant that produced
    // it. The client reads `checkout_protocol`, `quote_protocol` and
    // `kitchen_protocol` off the wire, so those are the names a peer's published
    // levels can be compared against with a plain `>=`. Mapping a client constant to
    // a server field is a judgement (the closure reader is gated on `quote_protocol`,
    // not on a field of its own), and it is made ONCE, at stamp time, where the
    // constants are read — never re-derived inside the gate.
    const expects = compat.clientExpects;
    if (expects === null || typeof expects !== 'object' || Array.isArray(expects)) {
      fail(problems, 'manifest.no_client_expectations', String(expects));
    } else if (Object.keys(expects).length === 0) {
      fail(problems, 'manifest.no_client_expectations', 'empty');
    } else {
      for (const [key, level] of Object.entries(expects)) {
        if (!Number.isInteger(level) || level < 0) {
          fail(problems, 'manifest.bad_protocol_level', `${key}=${String(level)}`);
        }
      }
    }
    // The raw constants the expectations were derived from, so the derivation is
    // auditable from the record rather than only from this file's history.
    const raw = compat.clientConstants;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length === 0) {
      fail(problems, 'manifest.no_client_constants', String(raw));
    }
    const contracts = compat.contracts;
    if (contracts === null || typeof contracts !== 'object') {
      fail(problems, 'manifest.no_contracts', String(contracts));
    } else if (!DIGEST_RE.test(contracts.d01CheckoutLimits ?? '')) {
      fail(problems, 'manifest.bad_contract_digest', String(contracts?.d01CheckoutLimits));
    }
  }

  return { ok: problems.length === 0, problems };
}

/** Validate an OUTER provenance record against the inner manifest it describes. */
export function validateProvenance(provenance, manifest) {
  const problems = [];
  const p = provenance;
  if (p === null || typeof p !== 'object' || Array.isArray(p)) {
    fail(problems, 'provenance.not_an_object', typeof p);
    return { ok: false, problems };
  }
  if (p.schema !== PROVENANCE_SCHEMA) fail(problems, 'provenance.wrong_schema', String(p.schema));
  if (!DIGEST_RE.test(p.artifactTreeDigest ?? '')) {
    fail(problems, 'provenance.bad_tree_digest', String(p.artifactTreeDigest));
  }
  if (!DIGEST_RE.test(p.manifestDigest ?? '')) {
    fail(problems, 'provenance.bad_manifest_digest', String(p.manifestDigest));
  }
  if (typeof p.artifactName !== 'string' || p.artifactName.length === 0) {
    fail(problems, 'provenance.no_artifact_name', String(p.artifactName));
  }
  if (manifest !== undefined) {
    if (p.commit !== manifest.commit) {
      fail(problems, 'provenance.commit_disagrees', `${String(p.commit)} vs ${String(manifest?.commit)}`);
    }
    const expected = digestOfValue(manifest);
    if (p.manifestDigest !== expected) {
      fail(problems, 'provenance.manifest_digest_disagrees', `${String(p.manifestDigest)} vs ${expected}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/** Build the OUTER record for a validated inner manifest and a measured tree. */
export function buildProvenance({ manifest, artifactName, artifactTreeDigest, entryCount }) {
  return {
    schema: PROVENANCE_SCHEMA,
    application: manifest.application,
    repository: manifest.repository,
    commit: manifest.commit,
    buildConfiguration: manifest.buildConfiguration,
    certification: manifest.certification,
    artifactName,
    artifactTreeDigest,
    entryCount,
    manifestDigest: digestOfValue(manifest),
  };
}

/**
 * The SERVER capability levels this client needs, derived from its own constants.
 *
 * Keyed by the SERVER field the client reads, so a peer's published level can be
 * compared with a plain `>=`. The closure reader is gated on `quote_protocol`, which
 * is why the two client constants collapse to one server key here. ONE function,
 * used by the stamp that writes the manifest AND by the gate that re-derives it from
 * git at the certified commit — so the mapping is made once and cannot be restated.
 */
export function clientExpectationsFrom(constants) {
  return {
    checkout_protocol: constants.CHECKOUT_PROTOCOL_CORRELATED,
    quote_protocol: Math.max(constants.REQUIRED_QUOTE_PROTOCOL, constants.REQUIRED_CLOSURE_PROTOCOL),
    kitchen_protocol: constants.REQUIRED_KITCHEN_PROTOCOL,
  };
}

/**
 * The INNER manifest, from facts a caller has already established. Pure: `stamp`
 * gathers the facts (files, git, the built bytes) and this assembles them, so the
 * shape a certified candidate carries is testable without a build.
 */
export function buildManifest({
  policy, commit, ref, sourceTree, builtAt, env, lockDigest, nodeVersion, run,
  constants, supportedQuotePolicyVersions, storage, d01Digest,
}) {
  return {
    schema: MANIFEST_SCHEMA,
    application: policy.application,
    repository: policy.repository,
    commit,
    ref,
    source: { tree: sourceTree },
    buildConfiguration: policy.build.configuration,
    builtAt,
    environment: {
      name: `${policy.build.configuration}-targeted`,
      apiUrl: env.apiUrl,
      dinerBaseUrl: env.dinerBaseUrl,
      // Recorded because it is true, not because it is desirable: the shipping
      // configuration bakes Angular's `production` flag FALSE today.
      productionFlag: env.production,
    },
    dependencies: { lockDigest, nodeVersion },
    certification: {
      workflowPath: policy.certification.workflowPath,
      runId: String(run.runId),
      runAttempt: String(run.runAttempt),
      runStartedAt: String(run.runStartedAt),
    },
    compatibility: {
      storage,
      clientExpects: clientExpectationsFrom(constants),
      clientSupports: { quote_policy_version: [...supportedQuotePolicyVersions] },
      clientConstants: constants,
      contracts: { d01CheckoutLimits: d01Digest },
    },
    hosting: {
      project: policy.hosting.project,
      site: policy.hosting.site,
      target: policy.hosting.target,
      identityPath: policy.hosting.identityPath,
    },
  };
}
