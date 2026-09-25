#!/usr/bin/env node
/**
 * The thin command line the release workflows call. All judgement lives in the pure
 * modules under `release/lib/` (decide, preflight, outcome, peers, storage, hosting,
 * policy, manifest, record); this file is the I/O around them. Keeping the two apart
 * is what lets the whole refusal matrix run locally from fixtures, and what lets the
 * workflow simulation drive exactly these commands against recorded API answers.
 *
 *   stamp                 produce dist/release.json, the dependency-evidence bundle and
 *                         provenance (certify.yml)
 *   observe               measure a downloaded candidate, as DATA
 *   certification-facts   the certifying run, its jobs, its artifacts, its ancestry
 *   git-facts             the certified commit's source, hosting, storage, eligibility
 *   serve-state           read this site's served identity (+ relation, with git)
 *   peer-receipt          PRODUCE a peer receipt from that peer's own git
 *   peer-facts            read receipts, verify public ones, observe peer serving
 *   prepare-publisher     install the reviewed publisher lock, scripts disabled, and
 *                         measure it (the gate; no credential)
 *   assess                a FRESH advisory query over the candidate's retained graph, the
 *                         pinned scanner and the prepared toolchain (the gate)
 *   decide                the decision + the admitted record + a shadow-mode summary
 *   readiness             is a refusal EXACTLY the recorded waiting state of a
 *                         non-publishing evaluation? (asked only of a refusal)
 *   preflight             the publisher's critical-section recheck, then staging
 *   publish               the last-boundary recheck, then the admitted toolchain — the
 *                         ONLY command that reads the credential
 *   verify-served         fetch the identity and every certified file back
 *   outcome               the one outcome word for the whole run
 *   storage-reviewed      re-affirm (or check) the storage declaration's tripwire
 *   self-test             the matcher/extractor checks
 *
 * Every command prints JSON on stdout and diagnostics on stderr, so a caller can
 * always separate the answer from the noise. Exit status is the answer where a step
 * must pass or fail; it is never swallowed by a pipeline here.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync,
  writeFileSync, appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { argv, exit, stderr, stdout } from 'node:process';

import { contractDigest, digestOf, digestOfValue, sha256Hex, treeDigest } from './lib/canonical.mjs';
import {
  ASSESSMENT_DOC, ASSESSMENT_SCHEMA, EVIDENCE_DIR, EVIDENCE_RECORD, EVIDENCE_SCHEMA, RETAINED, TOOLING_SCHEMA,
  assessmentArtifactName, buildEvidenceRecord, inspectAssessment, inspectEvidenceBundle, toolingArtifactName, validateTooling,
} from './lib/dependency-evidence.mjs';
import { publishInvocation, readPublishResult } from './lib/publisher.mjs';
import {
  defaultInstallScanner, loadPolicy as loadAuditPolicy, reevaluate, spawnRunner, verifyScannerPin,
} from '../dependency-audit/lib/audit.mjs';
import { collect, retainedInventory, writeReplay } from '../dependency-audit/lib/retained.mjs';
import { inventory, scannerEnvironment, toolingScope } from '../dependency-audit/lib/npm.mjs';
import { evaluate, headline } from '../dependency-audit/lib/core.mjs';
import { buildManifest, buildProvenance, validateManifest } from './lib/manifest.mjs';
import { readEnvironmentLiteral, readIntArrayConstant, readIntConstant, hostingHooks } from './lib/source.mjs';
import { decide, selectCertifiedArtifact } from './lib/decide.mjs';
import { validatePolicy } from './lib/policy.mjs';
import { effectiveHosting } from './lib/hosting.mjs';
import { manifestStorage, staleReviewedSources, validateStorageDeclaration, declarationDigest } from './lib/storage.mjs';
import { PEER_NAMES, produceReceipt, receiptDigest } from './lib/peers.mjs';
import { buildRecord, decodeRecord, encodeRecord, recordDigest, validateRecord } from './lib/record.mjs';
import { certificationWindowReasons, dependencyBoundaryReasons, preflightReasons } from './lib/preflight.mjs';
import { FAILING_OUTCOMES, classifyVerification, summarizeOutcome } from './lib/outcome.mjs';
import { AWAITING, classifyReadiness, readinessCovers, unclassifiable } from './lib/readiness.mjs';
import { partitionByIgnore, supportedIgnorePattern, globToRegExp } from './lib/glob.mjs';
import {
  artifactFacts, fetchBackFiles, ghApi, git, gitShow, observeCandidate, readFilesUnder,
  readPublicCommitIdentity, readServedIdentity, relationOf, runFacts, walkTooling, walkTree,
} from './lib/io.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

/**
 * THE SOURCE OF EACH CLIENT CONSTANT. One table, read by `stamp` (from the working
 * tree it builds) and by `git-facts` (from the certified commit, in the trusted
 * verifier), so the two cannot disagree about where a number comes from.
 */
const CONSTANT_SOURCES = Object.freeze([
  ['CHECKOUT_RECORD_VERSION', 'src/app/_services/checkout-coordinator.service.ts'],
  ['REQUIRED_QUOTE_PROTOCOL', 'src/app/_shared/order/quote-transition.ts'],
  ['REQUIRED_CLOSURE_PROTOCOL', 'src/app/_shared/order/quote-transition.ts'],
  ['REQUIRED_KITCHEN_PROTOCOL', 'src/app/kitchen/services/kitchen-wire.ts'],
  ['CHECKOUT_PROTOCOL_CORRELATED', 'src/app/_shared/order/checkout-correlation.ts'],
]);
const SUPPORTED_VERSIONS_SOURCE = ['SUPPORTED_QUOTE_POLICY_VERSIONS', 'src/app/_shared/order/quote-transition.ts'];
const D01_CONTRACT_PATH = 'src/app/_shared/order/checkout-limits.contract.json';
const LOCK_PATH = 'package-lock.json';
const MANIFEST_PATH = 'package.json';
const AUDIT_POLICY_PATH = 'dependency-audit/policy.json';

/**
 * WHICH VERIFIER THIS IS: the trees of release/ and dependency-audit/ at a checkout's
 * HEAD. Both are the gate — the audit policy and scanner lock decide what a fresh
 * assessment means as surely as release/policy.json decides the rest — so a change to
 * either advances the verifier (preflight.policy_advanced).
 */
function verifierIdentity(root) {
  return {
    release: git(root, ['rev-parse', 'HEAD:release']).trim(),
    dependencyAudit: git(root, ['rev-parse', 'HEAD:dependency-audit']).trim(),
  };
}

/** A fresh, empty directory; refuses one that already holds anything. */
function freshDirectory(path, what) {
  if (existsSync(path) && readdirSync(path).length > 0) fail(`refusing to reuse a non-empty ${what}: ${path}`);
  mkdirSync(path, { recursive: true });
  return path;
}

// ── small helpers ───────────────────────────────────────────────────────────────

function flags(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    if (!args[i].startsWith('--')) continue;
    const key = args[i].slice(2);
    const next = args[i + 1];
    out[key] = next === undefined || next.startsWith('--') ? true : (i += 1, next);
  }
  return out;
}

const readJson = (path) => JSON.parse(readFileSync(String(path), 'utf8'));
const print = (value) => stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const fail = (message) => { stderr.write(`release: ${message}\n`); exit(1); };

function readPolicy() {
  const policy = readJson(join(ROOT, 'release/policy.json'));
  const check = validatePolicy(policy);
  return { policy, check };
}

/** Append `key=value` lines to a GitHub output file. Values are single-line by construction. */
function writeOutputs(file, values) {
  if (!file) return;
  const lines = Object.entries(values).map(([k, v]) => {
    const text = String(v ?? '');
    if (/[\r\n]/.test(text)) throw new Error(`output ${k} is not single-line`);
    return `${k}=${text}\n`;
  });
  appendFileSync(String(file), lines.join(''));
}

function environmentFileAt(readText, configuration) {
  const angular = JSON.parse(readText('angular.json'));
  const project = Object.keys(angular.projects)[0];
  const config = angular.projects[project].architect.build.configurations[configuration];
  if (!config) throw new Error(`angular.json has no build configuration \`${configuration}\``);
  const replacements = config.fileReplacements ?? [];
  if (replacements.length !== 1) {
    throw new Error(`configuration \`${configuration}\` must replace exactly one environment file, found ${replacements.length}`);
  }
  return replacements[0].with;
}

/** The facts a manifest is built from — the same reads for a working tree and a commit. */
function sourceFactsFrom(readText, readBytes, policy) {
  const constants = {};
  for (const [name, path] of CONSTANT_SOURCES) constants[name] = readIntConstant(readText(path), name);
  const supportedQuotePolicyVersions = readIntArrayConstant(readText(SUPPORTED_VERSIONS_SOURCE[1]), SUPPORTED_VERSIONS_SOURCE[0]);
  const environment = readEnvironmentLiteral(readText(environmentFileAt(readText, policy.build.configuration)));
  return {
    constants,
    supportedQuotePolicyVersions,
    environment,
    lockDigest: digestOf(readBytes(LOCK_PATH)),
    manifestDigest: digestOf(readBytes(MANIFEST_PATH)),
    d01Digest: contractDigest(JSON.parse(readText(D01_CONTRACT_PATH))),
  };
}

/** The storage declaration at a location, validated, with its tripwire evaluated. */
function storageFactsFrom(readText, readBytes, declarationPath) {
  let text;
  try {
    text = readText(declarationPath);
  } catch {
    return { present: false };
  }
  let declaration;
  try {
    declaration = JSON.parse(text);
  } catch (error) {
    return { present: true, problems: [{ code: 'storage.declaration_unreadable', detail: error.message }], stale: [] };
  }
  const check = validateStorageDeclaration(declaration);
  if (!check.ok) return { present: true, problems: check.problems, stale: [] };
  const actual = {};
  for (const path of Object.keys(declaration.reviewedSources)) {
    try { actual[path] = digestOf(readBytes(path)); } catch { /* missing — reported by the tripwire */ }
  }
  return {
    present: true,
    problems: [],
    stale: staleReviewedSources(declaration, actual),
    digest: declarationDigest(declaration),
    projection: manifestStorage(declaration),
  };
}

// ── stamp ───────────────────────────────────────────────────────────────────────

function cmdStamp(args) {
  const f = flags(args);
  const { policy, check } = readPolicy();
  if (!check.ok) fail(`the committed policy is invalid:\n  - ${check.problems.map((p) => `${p.code}: ${p.detail}`).join('\n  - ')}`);
  const dist = String(f.dist ?? join(ROOT, 'dist'));
  const commit = String(f.commit ?? '');
  const problems = [];

  // THE SOURCE THE BYTES WERE BUILT FROM. The commit named must be the checkout, and
  // the checkout must be clean, or the source tree recorded would not be what was built.
  const head = git(ROOT, ['rev-parse', 'HEAD']).trim();
  if (commit !== head) problems.push(`--commit ${commit} is not the checked-out HEAD ${head}`);
  const dirty = git(ROOT, ['status', '--porcelain', '--untracked-files=no']).trim();
  if (dirty) problems.push(`the working tree has tracked changes:\n${dirty}`);
  const sourceTree = git(ROOT, ['rev-parse', 'HEAD^{tree}']).trim();

  const readText = (p) => readFileSync(join(ROOT, p), 'utf8');
  const readBytes = (p) => readFileSync(join(ROOT, p));
  let facts;
  try {
    facts = sourceFactsFrom(readText, readBytes, policy);
  } catch (error) {
    fail(`refusing to stamp: ${error.message}`);
  }
  if (facts.environment.apiUrl !== policy.build.expectedApiUrl) {
    problems.push(`environment apiUrl ${facts.environment.apiUrl} != policy ${policy.build.expectedApiUrl}`);
  }
  if (facts.environment.production !== policy.build.expectedProductionFlag) {
    problems.push(`environment production ${facts.environment.production} != policy ${policy.build.expectedProductionFlag}`);
  }

  // THE STORAGE DECLARATION AND ITS TRIPWIRE. A declaration not re-affirmed after the
  // code that implements it changed is a stale claim, and is not certified.
  const storage = storageFactsFrom(readText, readBytes, policy.storage.declarationPath);
  if (!storage.present) problems.push(`no storage declaration at ${policy.storage.declarationPath}`);
  for (const p of storage.problems ?? []) problems.push(`${p.code}: ${p.detail}`);
  for (const s of storage.stale ?? []) problems.push(`storage declaration not re-affirmed: ${s} (node release/cli.mjs storage-reviewed --write)`);

  // THE BUILT BYTES, not the source. A file replacement that silently did not apply
  // produces an artifact that passes every source-level check and points at the wrong
  // API; this is the only check that can see that.
  const scripts = walkTree(dist).entries.filter((e) => e.path.endsWith('.js'));
  if (scripts.length === 0) problems.push(`no .js emitted under ${dist}`);
  let sawExpected = false;
  for (const entry of scripts) {
    const text = readFileSync(join(dist, entry.path), 'utf8');
    if (text.includes(policy.build.expectedApiUrl)) sawExpected = true;
    for (const forbidden of policy.build.forbiddenOriginsInBundle) {
      if (text.includes(forbidden)) problems.push(`forbidden origin ${forbidden} baked into ${entry.path}`);
    }
  }
  if (!sawExpected) problems.push(`expected origin ${policy.build.expectedApiUrl} is in no emitted script`);
  if (problems.length > 0) fail(`refusing to stamp\n  - ${problems.join('\n  - ')}`);

  const manifest = buildManifest({
    policy,
    commit,
    ref: String(f.ref ?? `refs/heads/${policy.defaultBranch}`),
    sourceTree,
    builtAt: String(f.now ?? ''),
    env: { apiUrl: facts.environment.apiUrl, dinerBaseUrl: facts.environment.dinerBaseUrl, production: facts.environment.production },
    lockDigest: facts.lockDigest,
    nodeVersion: String(f.nodeVersion ?? ''),
    run: { runId: f.runId ?? '', runAttempt: f.runAttempt ?? '', runStartedAt: f.runStartedAt ?? '' },
    constants: facts.constants,
    supportedQuotePolicyVersions: facts.supportedQuotePolicyVersions,
    storage: storage.projection,
    d01Digest: facts.d01Digest,
  });
  const valid = validateManifest(manifest);
  if (!valid.ok) fail(`manifest invalid\n  - ${valid.problems.map((p) => `${p.code}: ${p.detail}`).join('\n  - ')}`);

  writeFileSync(join(dist, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const walked = walkTree(dist);
  if (walked.unsafe.length > 0) fail(`built tree is not clean\n  - ${walked.unsafe.join('\n  - ')}`);
  const artifactTreeDigest = treeDigest(walked.entries);
  const outPath = String(f.out ?? join(ROOT, 'provenance.json'));
  const evidence = stampDependencyEvidence({
    policy,
    commit,
    sourceTree,
    manifest,
    certification: {
      workflowPath: policy.certification.workflowPath,
      runId: String(f.runId ?? ''),
      runAttempt: String(f.runAttempt ?? ''),
      runStartedAt: String(f.runStartedAt ?? ''),
    },
    candidate: { artifactTreeDigest, manifestDigest: digestOfValue(manifest), entryCount: walked.entries.length },
    auditDir: String(f.dependencyAudit ?? join(ROOT, 'dependency-audit', 'evidence')),
    outDir: String(f.evidenceOut ?? join(dirname(outPath), EVIDENCE_DIR)),
    now: String(f.now ?? ''),
  });
  const provenance = buildProvenance({
    manifest,
    artifactName: String(f.artifactName ?? ''),
    artifactTreeDigest,
    entryCount: walked.entries.length,
    dependencyEvidence: { schema: EVIDENCE_SCHEMA, recordDigest: evidence.recordDigest, treeDigest: evidence.treeDigest, entryCount: evidence.entryCount },
  });
  writeFileSync(outPath, `${JSON.stringify(provenance, null, 2)}\n`);
  print({ manifest, provenance, dependencyEvidence: evidence.record });
}

/**
 * THE CERTIFICATION DEPENDENCY EVIDENCE, bound to the candidate just stamped.
 *
 * Two things are proved before anything is written, and both are the reason this runs
 * AFTER the build rather than before it:
 *   1. The retained audit evidence is THIS checkout's, and still passes: `reevaluate`
 *      re-captures the installed inventory NOW — after the build — and refuses when it
 *      is not the inventory snapshotted right after `npm ci` and scanned. A dependency
 *      input that changed during the build (an install, a removal, a lockfile or
 *      package.json edit) therefore attaches no evidence at all: no candidate is stamped.
 *   2. The raw scanner output is the bytes the collection recorded, and reads back as
 *      the decision certification made (inspectEvidenceBundle, run over the bundle
 *      exactly as a later gate will).
 *
 * What the installed-tree digest proves is PATHS AND VERSIONS as npm wrote them — not
 * a hash of every executable byte — and the record says so.
 */
function stampDependencyEvidence({ policy, commit, sourceTree, manifest, certification, candidate, auditDir, outDir, now }) {
  const reevaluation = reevaluate(ROOT, { evidenceDir: auditDir, now });
  if (reevaluation.exitCode !== 0) {
    fail(`refusing to stamp: the dependency audit evidence does not re-evaluate within policy for this checkout after the build\n  ${reevaluation.headline}\n  - ${reevaluation.reasons.map((r) => `${r.code}: ${r.detail}`).join('\n  - ')}`);
  }
  const readAudit = (name) => readJson(join(auditDir, name));
  const snapshot = readAudit('snapshot.json');
  const collection = readAudit('collection.json');
  const result = readAudit('result.json');
  if (snapshot.binding?.revision?.commit !== commit || snapshot.binding?.revision?.tree !== sourceTree) {
    fail(`refusing to stamp: the dependency snapshot was taken at ${String(snapshot.binding?.revision?.commit)}, not ${commit}`);
  }
  freshDirectory(outDir, 'dependency-evidence directory');
  const copies = [
    [join(ROOT, MANIFEST_PATH), RETAINED.manifest],
    [join(ROOT, LOCK_PATH), RETAINED.lockfile],
    [join(ROOT, 'dependency-audit/scanner/package.json'), RETAINED.scannerManifest],
    [join(ROOT, 'dependency-audit/scanner/package-lock.json'), RETAINED.scannerLockfile],
    [join(ROOT, AUDIT_POLICY_PATH), RETAINED.policy],
    [join(auditDir, 'snapshot.json'), RETAINED.snapshot],
    [join(auditDir, 'collection.json'), RETAINED.collection],
    [join(auditDir, 'result.json'), RETAINED.result],
  ];
  for (const graph of ['application', 'scanner']) {
    const run = collection.graphs?.[graph]?.run;
    if (!run) fail(`refusing to stamp: the audit collection recorded no ${graph} scan`);
    copies.push([join(auditDir, run.stdoutFile), `audit/${run.stdoutFile}`], [join(auditDir, run.stderrFile), `audit/${run.stderrFile}`]);
  }
  const files = [];
  for (const [from, to] of copies) {
    const bytes = readFileSync(from);
    mkdirSync(dirname(join(outDir, to)), { recursive: true });
    writeFileSync(join(outDir, to), bytes);
    files.push({ path: to, sha256: sha256Hex(bytes), bytes: bytes.length });
  }
  const record = buildEvidenceRecord({
    repository: policy.repository, commit, tree: sourceTree, buildConfiguration: manifest.buildConfiguration,
    certification, snapshot, collection, result, reevaluation, files, candidate,
  });
  writeFileSync(join(outDir, EVIDENCE_RECORD), `${JSON.stringify(record, null, 2)}\n`);
  // SELF-CHECK: the bundle must survive the same inspection the gate will make of it.
  const bundle = readFilesUnder(outDir);
  const inspected = inspectEvidenceBundle(bundle.files, null);
  const problems = [...bundle.unsafe.map((u) => ({ code: 'evidence.unsafe', detail: u })), ...inspected.problems];
  if (problems.length > 0) fail(`refusing to stamp: the dependency evidence does not survive inspection\n  - ${problems.map((p) => `${p.code}: ${p.detail}`).join('\n  - ')}`);
  return { record, recordDigest: inspected.recordDigest, treeDigest: inspected.treeDigest, entryCount: inspected.entryCount };
}

// ── observe ─────────────────────────────────────────────────────────────────────

function cmdObserve(args) {
  const f = flags(args);
  const id = f['artifact-id'] === undefined ? null : Number(f['artifact-id']);
  print(observeCandidate(String(f.root), { artifactId: Number.isInteger(id) ? id : null }));
}

// ── certification-facts ─────────────────────────────────────────────────────────

function cmdCertificationFacts(args) {
  const f = flags(args);
  const { policy, check } = readPolicy();
  if (!check.ok) fail('the trusted policy is invalid');
  const repo = String(f.repo);
  const target = String(f.target);
  const trigger = String(f.trigger);
  const absent = (detail) => {
    writeOutputs(f.outputs, { run_id: '', artifact_id: '', artifact_name: '' });
    print({ present: false, detail });
  };

  let runId = null;
  if (trigger === 'automatic') {
    runId = /^[0-9]+$/.test(String(f['event-run-id'] ?? '')) ? String(f['event-run-id']) : null;
    if (!runId) return absent('the triggering event names no run');
  } else {
    // A manual request names a commit; the run is resolved BY WORKFLOW PATH, and only a
    // successful push run on the certification branch is a candidate.
    const file = basename(policy.certification.workflowPath);
    const listing = ghApi(`repos/${repo}/actions/workflows/${file}/runs?head_sha=${target}&event=${policy.certification.event}&branch=${policy.certification.branch}&status=success&per_page=100`);
    if (!listing.ok) return absent(`runs could not be listed: ${listing.detail}`);
    const runs = (listing.json.workflow_runs ?? [])
      .filter((r) => r.path === policy.certification.workflowPath && r.head_sha === target && r.conclusion === 'success')
      .sort((a, b) => b.id - a.id);
    if (runs.length === 0) return absent(`no successful certifying run for ${target}`);
    runId = String(runs[0].id);
  }

  const run = ghApi(`repos/${repo}/actions/runs/${runId}`);
  if (!run.ok) return absent(`run ${runId} could not be read: ${run.detail}`);
  const facts = runFacts(run.json);

  // THE JOBS OF THIS RUN'S LATEST ATTEMPT — never the check-runs of the commit, which
  // any other workflow on the same SHA could satisfy.
  const jobs = ghApi(`repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`);
  facts.checks = jobs.ok ? (jobs.json.jobs ?? []).map((j) => ({ name: j.name, status: j.status, conclusion: j.conclusion })) : [];
  facts.checksTruncated = !jobs.ok || (jobs.json.total_count ?? 0) > (jobs.json.jobs ?? []).length;

  const artifacts = ghApi(`repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`);
  facts.artifacts = artifacts.ok && (artifacts.json.total_count ?? 0) <= (artifacts.json.artifacts ?? []).length
    ? (artifacts.json.artifacts ?? []).map(artifactFacts)
    : null;

  // Ancestry of the default branch, from the trusted clone's full history.
  const rel = relationOf(ROOT, target, git(ROOT, ['rev-parse', 'HEAD']).trim());
  facts.ancestorOfDefaultBranch = rel === 'descendant' || rel === 'identical';

  const name = `frontend-release-${facts.runId}-${facts.runAttempt}`;
  const chosen = (facts.artifacts ?? []).filter((a) => a.name === name);
  writeOutputs(f.outputs, {
    run_id: facts.runId,
    artifact_id: chosen.length === 1 ? chosen[0].id : '',
    artifact_name: name,
  });
  print(facts);
}

// ── git-facts ───────────────────────────────────────────────────────────────────

function cmdGitFacts(args) {
  const f = flags(args);
  const { policy, check } = readPolicy();
  if (!check.ok) fail('the trusted policy is invalid');
  const commit = String(f.commit);
  const out = {};

  out.policy = {
    revision: git(ROOT, ['rev-parse', 'HEAD']).trim(),
    digest: digestOfValue(policy),
    verifierTree: verifierIdentity(ROOT),
  };

  // THE CERTIFIED COMMIT, read by the TRUSTED verifier from git — never from the
  // candidate's upload and never from whatever the working tree holds.
  const readBytes = (path) => {
    const bytes = gitShow(ROOT, commit, path);
    if (bytes === null) throw new Error(`${path} is not at ${commit}`);
    return bytes;
  };
  const readText = (path) => readBytes(path).toString('utf8');
  let resolved = null;
  try {
    resolved = git(ROOT, ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`]).trim();
  } catch { /* reported below */ }
  if (resolved !== commit) {
    out.source = { present: false, commit, detail: `${commit} is not in the trusted clone` };
  } else {
    try {
      out.source = {
        present: true,
        commit,
        tree: git(ROOT, ['rev-parse', `${commit}^{tree}`]).trim(),
        ...sourceFactsFrom(readText, readBytes, policy),
      };
    } catch (error) {
      out.source = { present: false, commit, detail: error.message };
    }
    const storage = storageFactsFrom(readText, readBytes, policy.storage.declarationPath);
    if (out.source.present) out.source.storage = storage;
  }

  // THE HOSTING CONFIGURATION THE TOOL WOULD USE, over the files the gate downloaded.
  const observation = f.observation ? readJson(f.observation) : { files: [] };
  const parseAt = (path) => {
    try { return JSON.parse(readText(path)); } catch { return undefined; }
  };
  out.hosting = resolved === commit
    ? effectiveHosting({ firebaseJson: parseAt('firebase.json'), firebaserc: parseAt('.firebaserc'), policy, files: observation.files ?? [] })
    : { problems: [{ code: 'hosting.config_unreadable', detail: 'certified commit not available' }], digest: null };

  // THE BOOTSTRAP BASELINE — only meaningful when nothing is served, and only when an
  // owner has named, in reviewed policy, which build is live.
  const named = policy.bootstrap.servedBaseline;
  if (named === null) {
    out.baseline = { state: 'none' };
  } else {
    const read = (path) => {
      const bytes = gitShow(ROOT, named.commit, path);
      if (bytes === null) throw new Error(`${path} is not at ${named.commit}`);
      return bytes;
    };
    const storage = storageFactsFrom((p) => read(p).toString('utf8'), read, policy.storage.declarationPath);
    if (!storage.present) out.baseline = { state: 'unreadable', commit: named.commit, detail: 'no storage declaration at the named baseline' };
    else if ((storage.problems ?? []).length || (storage.stale ?? []).length) out.baseline = { state: 'unreadable', commit: named.commit, detail: 'the named baseline\'s declaration is invalid or stale' };
    else out.baseline = { state: 'known', commit: named.commit, storage: storage.projection };
  }

  out.eligibility = {
    relationToMinimum: policy.eligibility.minimumSafeTarget === null
      ? 'not-applicable'
      : relationOf(ROOT, policy.eligibility.minimumSafeTarget, commit),
  };
  // THE TRUSTED CHECKOUT'S OWN REVIEWED INPUTS for the fresh half: the audit policy, the
  // scanner lock and the publisher lock the gate is about to use — read from THIS
  // checkout, never from the candidate, which could otherwise hand the gate its own. And
  // read as COMMITTED at the gate's revision, not from the working tree: "reviewed" means
  // what that revision holds, so a file edited in the workspace before the toolchain is
  // prepared is not the reviewed one, and the decision says so (tooling_unreviewed).
  const sha = (rel) => { const bytes = gitShow(ROOT, 'HEAD', rel); return bytes ? sha256Hex(bytes) : null; };
  out.trusted = {
    legacyPublisherPresent: existsSync(join(ROOT, policy.prerequisites.singlePublisher.legacyWorkflow)),
    revision: out.policy.revision,
    auditPolicySha256: sha(AUDIT_POLICY_PATH),
    scannerLockfileSha256: sha('dependency-audit/scanner/package-lock.json'),
    publisherLockfileSha256: sha(`${policy.publisher.root}/package-lock.json`),
    publisherManifestSha256: sha(`${policy.publisher.root}/package.json`),
  };
  print(out);
}

// ── serve-state ─────────────────────────────────────────────────────────────────

async function cmdServeState(args) {
  const f = flags(args);
  const { policy } = readPolicy();
  const served = await readServedIdentity(String(f.origin ?? policy.hosting.identityOrigin), policy.hosting.identityPath, {
    timeoutMs: Number(f.timeout ?? 15000),
  });
  if (served.state === 'known' && f['relate-to']) {
    served.relationToTarget = relationOf(ROOT, served.servedCommit, String(f['relate-to']));
  }
  print(served);
}

// ── peers ───────────────────────────────────────────────────────────────────────

function cmdPeerReceipt(args) {
  const f = flags(args);
  const repoDir = String(f['repo-dir']);
  const receipt = produceReceipt({
    peer: String(f.peer),
    repository: String(f.repository),
    commit: String(f.commit),
    git: (gitArgs) => git(repoDir, gitArgs),
  });
  const text = `${JSON.stringify(receipt, null, 2)}\n`;
  if (f.write) {
    const path = join(ROOT, `release/peers/${receipt.peer}-${receipt.commit}.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    stderr.write(`wrote ${path}\n`);
  }
  stdout.write(text);
  stderr.write(`receiptDigest ${receiptDigest(receipt)}\n`);
}

async function cmdPeerFacts(args) {
  const f = flags(args);
  const { policy, check } = readPolicy();
  if (!check.ok) fail('the trusted policy is invalid');
  const timeoutMs = Number(f.timeout ?? 15000);
  const out = { receipts: {}, verification: {}, serving: {} };

  for (const name of PEER_NAMES) {
    const declared = policy.compatibleSet.peers[name];
    out.receipts[name] = declared.approved.map((a) => {
      const path = join(ROOT, a.receipt);
      if (!existsSync(path)) return { commit: a.commit, path: a.receipt, present: false };
      try {
        const receipt = readJson(path);
        return { commit: a.commit, path: a.receipt, present: true, readable: true, receipt, digest: receiptDigest(receipt) };
      } catch (error) {
        return { commit: a.commit, path: a.receipt, present: true, readable: false, detail: error.message };
      }
    });

    // A PUBLIC peer's receipt is re-derived from that peer's own repository, through
    // the API, at decision time. A private one cannot be, and the policy says so.
    if (declared.receiptVerification === 'public-repository') {
      out.verification[name] = {};
      for (const entry of out.receipts[name]) {
        if (!entry.readable) continue;
        const r = entry.receipt;
        const commitObject = ghApi(`repos/${declared.repository}/git/commits/${entry.commit}`);
        if (!commitObject.ok) {
          out.verification[name][entry.commit] = { state: 'unavailable', detail: commitObject.detail };
          continue;
        }
        const mismatches = [];
        if (commitObject.json.tree?.sha !== r.tree) mismatches.push(`tree ${String(commitObject.json.tree?.sha)} != ${String(r.tree)}`);
        for (const source of r.sources ?? []) {
          const content = ghApi(`repos/${declared.repository}/contents/${source.path}?ref=${entry.commit}`);
          const blob = content.ok && content.json?.type === 'file' ? content.json.sha : content.status === 404 ? null : undefined;
          if (blob === undefined) mismatches.push(`${source.path}: unreadable`);
          else if (blob !== source.blob) mismatches.push(`${source.path}: ${String(blob)} != ${String(source.blob)}`);
        }
        out.verification[name][entry.commit] = mismatches.length
          ? { state: 'mismatch', detail: mismatches.join('; ') }
          : { state: 'verified', detail: '' };
      }
    }

    // SERVING — separately, and only where the peer publishes an identity.
    if (declared.serving.observation === 'public-identity') {
      out.serving[name] = await readPublicCommitIdentity(declared.serving.origin, declared.serving.path, { timeoutMs });
    }
  }
  print(out);
}

// ── decide ──────────────────────────────────────────────────────────────────────

const GROUPS = [
  ['prerequisite.', 'Owner prerequisites outstanding. Until each is resolved in a reviewed change, this path refuses EVERY candidate — these refusals are expected, and they are the list of what enabling it still requires'],
  ['peers.', 'Peers — selection receipts and serving evidence'],
  ['', 'Candidate, certification and ordering'],
];

const OPENING = {
  REFUSE: [
    'This path would **not** publish this candidate. That is a statement about this publication path only:',
    'it does not mean the build is broken, and it changes nothing about what is live.',
  ],
  PROCEED: [
    'Every check passed and the candidate is admitted. Whether anything is published is decided in the',
    '`publish` job, which re-establishes this record inside its critical section and publishes only when the',
    'enablement variable is set.',
  ],
  SKIP_IDENTICAL: ['Exactly this candidate is already served. Nothing is published, and nothing needed to be.'],
  SKIP_STALE: ['A newer candidate is already served, so this older automatic run publishes nothing.'],
};

/**
 * THE DEPENDENCY HALF, stated as what was observed — never as a verdict the decision did
 * not reach. Each row says what exists: a bound certification record and its outcome, a
 * fresh assessment and its window, a prepared toolchain — or, where it does not exist,
 * that it was NOT PERFORMED / NOT PREPARED. A skipped step is never rendered as a pass.
 */
function dependencyRows(observation, dependencies) {
  const ev = observation?.dependencyEvidence;
  let evidence = 'not observed — the candidate was not read';
  if (observation?.present) {
    if (observation.provenance?.legacy) evidence = 'none — a pre-B2.2 candidate (unsupported; never retrofitted)';
    else if (!ev || ev.state === 'absent') evidence = 'absent';
    else if (ev.problems?.length) evidence = `present but refused (${ev.problems.map((p) => p.code).join(', ')})`;
    else evidence = `\`${ev.recordDigest}\` — certified ${ev.record?.audit?.outcome ?? '?'} at ${ev.record?.audit?.invokedAt ?? '?'}`;
  }
  const a = dependencies?.assessment;
  let assessment = 'NOT PERFORMED';
  if (a?.state === 'present' && a.doc && !(a.problems ?? []).length) {
    assessment = `${a.doc.outcome} — collected ${a.doc.startedAt} → ${a.doc.finishedAt}, decided ${a.doc.decidedAt}`;
  } else if (a?.state === 'present') {
    assessment = `unreadable (${(a.problems ?? []).map((p) => p.code).join(', ')})`;
  }
  const t = dependencies?.tooling;
  let tooling = 'NOT PREPARED';
  if (t && t.schema !== 'unreadable') {
    tooling = (t.problems ?? []).length
      ? `refused (${t.problems.map((p) => p.code).join(', ')})`
      : `${t.package}@${t.version} under ${t.node}, tree \`${t.treeDigest}\``;
  } else if (t) tooling = 'unreadable';
  return [
    `| certification dependency evidence | ${evidence} |`,
    `| fresh dependency assessment | ${assessment} |`,
    `| publisher toolchain | ${tooling} |`,
  ];
}

function shadowSummary({ decision, request, certification, observation, served, policyRevision, policy, dependencies }) {
  const lines = [];
  lines.push(`### Publication decision: ${decision.decision}`, '');
  lines.push(...(OPENING[decision.decision] ?? []), '');
  // Read defensively: the summary is also written for a decision taken against an
  // INVALID policy (policy.invalid), and must not be the thing that crashes.
  const legacy = policy?.prerequisites?.singlePublisher?.legacyWorkflow ?? 'the legacy deploy workflow';
  const variable = policy?.publication?.enablementVariable ?? 'the enablement variable';
  lines.push(`_This is the certified publication path (\`publish.yml\`). \`${legacy}\``);
  lines.push('still builds and publishes every merge to `main` on its own and consults none of this; while it does,');
  lines.push(`it is the live path, and \`${variable}\` alone would not make this one the only writer._`, '');
  lines.push('| | |', '|---|---|');
  lines.push(`| target | \`${request.target}\` (${request.mode}, ${request.trigger}) |`);
  lines.push(`| certifying run | ${certification?.present ? `${certification.runId} attempt ${certification.runAttempt}` : 'none resolved'} |`);
  lines.push(`| candidate manifest | \`${observation?.manifestDigest ?? '—'}\` |`);
  lines.push(`| candidate tree | \`${observation?.observedTreeDigest ?? '—'}\` |`);
  lines.push(`| served | ${served?.state ?? '—'} ${served?.servedCommit ? `\`${served.servedCommit}\`` : ''} |`);
  lines.push(...dependencyRows(observation, dependencies));
  lines.push(`| policy revision | \`${policyRevision ?? '—'}\` |`, '');
  if (decision.reasons.length === 0) {
    lines.push('No objections.');
  } else {
    const remaining = [...decision.reasons];
    for (const [prefix, title] of GROUPS) {
      const mine = remaining.filter((r) => r.code.startsWith(prefix));
      if (mine.length === 0) continue;
      for (const r of mine) remaining.splice(remaining.indexOf(r), 1);
      lines.push(`**${title}**`, '', '```');
      for (const r of mine) lines.push(`${r.code}  ${r.detail ?? ''}`);
      lines.push('```', '');
    }
  }
  return `${lines.join('\n')}\n`;
}

// ── prepare-publisher ───────────────────────────────────────────────────────────

/**
 * THE PUBLICATION TOOLCHAIN, prepared in the job that holds NO credential.
 *
 * Installed ONLY from the trusted checkout's reviewed release/publisher lock, by the
 * PINNED scanner's npm (the same npm the audit trusts, from its own lockfile), with
 * lifecycle scripts disabled and against the public registry the audit policy names —
 * so nothing the graph ships executes here, and nothing is resolved: `npm ci` refuses a
 * lock that does not satisfy the manifest. The result is then measured as data:
 *   - the installed tree must BE the lock graph (the audit's own inventory rule);
 *   - npm's `.bin` links are removed — the only links npm writes — and any other link,
 *     unusual name or unexpected top-level entry (an .npmrc, a hook) is refused;
 *   - the pinned package, version and entrypoint must be what the policy names;
 *   - the Node running this must be the exact version the publisher will run under.
 * The measurement — content tree digest, entrypoint digest, installed inventory — is
 * what the gate admits and the publisher re-derives from its own download.
 */
function cmdPreparePublisher(args) {
  const f = flags(args);
  const { policy, check } = readPolicy();
  if (!check.ok) fail('the trusted policy is invalid');
  const pin = policy.publisher;
  const toolingDir = String(f.out);
  const problems = [];
  const problem = (code, detail) => problems.push({ code, detail: String(detail) });
  if (process.version !== `v${pin.node}`) problem('tooling.runtime_mismatch', `this job runs Node ${process.version}; the publisher is pinned to v${pin.node}`);

  const { policy: auditPolicy, problems: auditProblems } = loadAuditPolicy(ROOT);
  problems.push(...auditProblems.map((p) => ({ code: `tooling.${p.code}`, detail: p.detail })));
  let facts = {
    schema: TOOLING_SCHEMA, package: pin.package, version: null, node: process.version, lock: null,
    installedTreeSha256: null, locked: null, installed: null, absentOptional: null, treeDigest: null, entryCount: 0,
    entrypoint: { path: pin.entrypoint, sha256: null }, removedLinks: 0, problems,
  };
  const finish = () => {
    facts.problems = problems;
    if (f.facts) writeFileSync(String(f.facts), `${JSON.stringify(facts, null, 2)}\n`);
    print(facts);
    exit(problems.length === 0 && validateTooling(facts).length === 0 ? 0 : 1);
  };
  if (!auditPolicy) return finish();

  const scannerRoot = join(ROOT, auditPolicy.scanner.root);
  const scanner = defaultInstallScanner({ root: ROOT, scannerRoot, policy: auditPolicy, runner: spawnRunner });
  problems.push(...scanner.problems.map((p) => ({ code: `tooling.${p.code}`, detail: p.detail })));
  if (problems.length > 0) return finish();

  freshDirectory(toolingDir, 'toolchain directory');
  const reviewed = join(ROOT, pin.root);
  for (const name of ['package.json', 'package-lock.json']) cpSync(join(reviewed, name), join(toolingDir, name));
  const manifest = readJson(join(toolingDir, 'package.json'));
  const lock = readJson(join(toolingDir, 'package-lock.json'));
  facts.lock = {
    lockfileSha256: sha256Hex(readFileSync(join(toolingDir, 'package-lock.json'))),
    manifestSha256: sha256Hex(readFileSync(join(toolingDir, 'package.json'))),
  };
  if (manifest.dependencies?.[pin.package] !== pin.version || Object.keys(manifest.dependencies ?? {}).length !== 1) {
    problem('tooling.manifest_mismatch', `the reviewed manifest must depend on exactly ${pin.package}@${pin.version}`);
  }
  if (lock.packages?.[`node_modules/${pin.package}`]?.version !== pin.version) {
    problem('tooling.lock_mismatch', `the reviewed lock locks ${pin.package}@${String(lock.packages?.[`node_modules/${pin.package}`]?.version)}, the policy ${pin.version}`);
  }
  if (problems.length > 0) return finish();

  const npmCli = join(scannerRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const install = spawnRunner({
    command: process.execPath,
    args: [npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--no-update-notifier', `--registry=${auditPolicy.scanner.registry}`],
    cwd: toolingDir,
    env: scannerEnvironment(process.env).env,
    timeoutMs: auditPolicy.scanner.timeoutSeconds * 1000,
  });
  if (install.status !== 0) {
    problem('tooling.install_failed', `the reviewed lock could not be installed (status ${install.status}${install.timedOut ? ', timed out' : ''}): ${(install.stderr || install.error || '').slice(-400)}`);
    return finish();
  }
  const inv = inventory(toolingDir, { graph: 'publisher', scopeOf: toolingScope });
  problems.push(...inv.problems.map((p) => ({ code: `tooling.${p.code}`, detail: p.detail })));
  facts.installedTreeSha256 = inv.digests.installedTreeSha256 ?? null;
  facts.locked = inv.counts.locked ?? null;
  facts.installed = inv.counts.installed ?? null;
  facts.absentOptional = inv.counts.absentOptional ?? null;

  // npm's generated bin links are the only links it writes; they are not part of the
  // toolchain (the entrypoint is invoked by path) and are removed rather than shipped.
  const removeBins = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = lstatSync(full);
      if (!st.isDirectory() || st.isSymbolicLink()) continue;
      if (name === '.bin') {
        for (const link of readdirSync(full)) {
          if (!lstatSync(join(full, link)).isSymbolicLink()) problem('tooling.unexpected_bin', `${full}/${link} is not a link npm wrote`);
        }
        rmSync(full, { recursive: true, force: true });
        facts.removedLinks += 1;
        continue;
      }
      removeBins(full);
    }
  };
  removeBins(join(toolingDir, 'node_modules'));
  const walked = walkTooling(toolingDir);
  problems.push(...walked.unsafe.map((u) => ({ code: 'tooling.unsafe', detail: u })));
  facts.treeDigest = walked.treeDigest;
  facts.entryCount = walked.entries.length;
  const entry = walked.entries.find((e) => e.path === pin.entrypoint);
  if (!entry) problem('tooling.no_entrypoint', `${pin.entrypoint} is not in the prepared toolchain`);
  facts.entrypoint = { path: pin.entrypoint, sha256: entry?.sha256 ?? null };
  try {
    facts.version = readJson(join(toolingDir, 'node_modules', pin.package, 'package.json')).version ?? null;
  } catch { /* reported below */ }
  if (facts.version !== pin.version) problem('tooling.version_mismatch', `installed ${pin.package}@${String(facts.version)}, pinned ${pin.version}`);
  return finish();
}

// ── assess ──────────────────────────────────────────────────────────────────────

/**
 * THE FRESH ASSESSMENT: a real advisory query, now, by the trusted pinned scanner, over
 *   application  the candidate's RETAINED lock graph — a replay directory holding only
 *                the two retained files, whose digests the evidence binds; what was
 *                installed is the certification observation, labelled as such, never a
 *                forged node_modules;
 *   scanner      the pinned scanner's own installed graph;
 *   publisher    the prepared toolchain's installed graph —
 * decided under the TRUSTED dependency-audit policy (this checkout's, not the
 * candidate's). No candidate script, hook or build runs. Each graph records its own
 * start and finish from the clock; `--now` (the trusted workflow's reading) is the
 * collection start. Writes nothing, and exits 2, when the evidence it needs is unusable:
 * an assessment that could not be performed is recorded as not performed, never passed.
 */
function cmdAssess(args) {
  const f = flags(args);
  const { policy, check } = readPolicy();
  if (!check.ok) fail('the trusted policy is invalid');
  // ONE-SECOND RESOLUTION, truncated — the resolution of the workflow's own clock readings
  // (`date -u +%Y-%m-%dT%H:%M:%SZ`), which every later boundary compares these times with.
  // A millisecond reading here would put an assessment decided in the same second as the
  // next step's reading AFTER that reading, and be refused as decided in the future.
  const clock = () => new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace(/\.000Z$/, 'Z');
  const startedAt = String(f.now ?? '');
  if (!Number.isFinite(Date.parse(startedAt)) || Date.parse(startedAt) > Date.now() + 60_000) fail('assess needs --now: the collection start, from the trusted workflow');
  const candidateRoot = String(f.candidate);
  const toolingDir = String(f.tooling);
  const outDir = String(f.out);
  const certification = readJson(f.certification);
  const tooling = readJson(f['tooling-facts']);

  const observation = observeCandidate(candidateRoot);
  const evidence = observation.dependencyEvidence;
  if (observation.provenance?.legacy || evidence.state !== 'present' || evidence.problems.length > 0 || evidence.unsafe.length > 0) {
    stderr.write(`release: assessment NOT PERFORMED — the candidate's dependency evidence is unusable (${[
      observation.provenance?.legacy ? 'legacy provenance' : '', evidence.state, ...evidence.problems.map((p) => p.code), ...evidence.unsafe,
    ].filter(Boolean).join(', ')})\n`);
    exit(2);
  }
  if (validateTooling(tooling).length > 0 || tooling.problems.length > 0) {
    stderr.write('release: assessment NOT PERFORMED — the publisher toolchain was not prepared\n');
    exit(2);
  }
  const listed = certification.present ? selectCertifiedArtifact(certification.artifacts, { runId: certification.runId, runAttempt: certification.runAttempt }).artifact : null;
  if (!listed) {
    stderr.write('release: assessment NOT PERFORMED — the certifying run lists no candidate artifact\n');
    exit(2);
  }

  const { policy: auditPolicy, problems: auditProblems } = loadAuditPolicy(ROOT);
  const incomplete = [...auditProblems];
  freshDirectory(outDir, 'assessment directory');
  const graphs = {};
  const findings = [];
  let walkedTooling = null;
  if (auditPolicy) {
    const scannerRoot = join(ROOT, auditPolicy.scanner.root);
    incomplete.push(...verifyScannerPin(scannerRoot, auditPolicy));
    const npmCli = join(scannerRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const bundle = readFilesUnder(join(candidateRoot, EVIDENCE_DIR)).files;
    const manifestBytes = bundle.get(RETAINED.manifest);
    const lockBytes = bundle.get(RETAINED.lockfile);
    const snapshot = JSON.parse(bundle.get(RETAINED.snapshot).toString('utf8'));
    const replay = freshDirectory(String(f.replay ?? join(dirname(outDir), 'assessment-replay')), 'replay directory');
    incomplete.push(...writeReplay(replay, { manifestBytes, lockBytes }));
    walkedTooling = walkTooling(toolingDir);
    if (walkedTooling.treeDigest !== tooling.treeDigest || walkedTooling.unsafe.length > 0) {
      incomplete.push({ code: 'tooling_changed', detail: 'the toolchain is not the one prepared and measured' });
    }
    const plan = [
      { graph: 'application', dir: replay, kind: 'retained', inv: retainedInventory({ graph: 'application', manifestBytes, lockBytes, snapshot }) },
      { graph: 'scanner', dir: scannerRoot, kind: 'installed', scopeOf: toolingScope, inv: inventory(scannerRoot, { graph: 'scanner', scopeOf: toolingScope }) },
      { graph: 'publisher', dir: toolingDir, kind: 'installed', scopeOf: toolingScope, inv: inventory(toolingDir, { graph: 'publisher', scopeOf: toolingScope }) },
    ];
    for (const g of plan) {
      const c = collect({ ...g, npmCli, policy: auditPolicy, runner: spawnRunner, clock, evidenceDir: outDir });
      incomplete.push(...c.problems);
      findings.push(...c.findings);
      graphs[g.graph] = c.record;
    }
  }
  const finishedAt = clock();
  const records = auditPolicy?.records ?? [];
  const decidedAt = clock();
  const result = evaluate({ incomplete, findings, records, now: decidedAt });
  const applied = new Set(result.records.filter((r) => r.status === 'applied' && r.covers > 0).map((r) => r.id));
  const doc = {
    schema: ASSESSMENT_SCHEMA,
    purpose: 'promotion',
    repository: policy.repository,
    assessor: { runId: String(f['run-id'] ?? ''), runAttempt: String(f['run-attempt'] ?? ''), revision: git(ROOT, ['rev-parse', 'HEAD']).trim() },
    candidate: {
      commit: observation.manifest?.commit ?? null,
      runId: String(certification.runId),
      runAttempt: String(certification.runAttempt),
      artifactId: listed.id,
      artifactDigest: listed.digest,
      treeDigest: observation.observedTreeDigest,
      manifestDigest: observation.manifestDigest,
      evidenceRecordDigest: evidence.recordDigest,
    },
    policy: { path: AUDIT_POLICY_PATH, sha256: sha256Hex(readFileSync(join(ROOT, AUDIT_POLICY_PATH))) },
    scanner: { package: 'npm', version: auditPolicy?.scanner?.version ?? null, registry: auditPolicy?.scanner?.registry ?? null },
    tooling: { package: tooling.package, version: tooling.version, treeDigest: walkedTooling?.treeDigest ?? null },
    startedAt,
    finishedAt,
    decidedAt,
    graphs,
    headline: headline(result),
    ...result,
    recordsApplied: records.filter((r) => applied.has(r.id)).map((r) => ({ id: r.id, expires: r.expires })),
  };
  writeFileSync(join(outDir, ASSESSMENT_DOC), `${JSON.stringify(doc, null, 2)}\n`);
  stderr.write(`${doc.headline}\n`);
  if (f.summary) {
    appendFileSync(String(f.summary), `### Fresh dependency assessment\n\n**${doc.headline}**\n\nCollected ${startedAt} → ${finishedAt}, decided ${decidedAt}, by run ${doc.assessor.runId}.${doc.assessor.runAttempt} under the trusted audit policy. Graphs: ${Object.entries(graphs).map(([g, r]) => `${g} (${r.counts?.locked ?? '?'} locked, ${r.observation})`).join(', ')}.\n\n`);
  }
  print({ outcome: doc.outcome, exitCode: doc.exitCode, counts: doc.counts, startedAt, finishedAt, decidedAt });
  exit(doc.exitCode);
}

function cmdDecide(args) {
  const f = flags(args);
  // THE POLICY IS THIS CHECKOUT'S, and only this checkout's. There is deliberately no
  // flag to supply another one: the gate's whole point is that a candidate cannot hand
  // the gate its own rules, and a CLI switch for it is one workflow edit from doing so.
  const { policy } = readPolicy();
  const request = readJson(f.request);
  const certification = readJson(f.certification);
  const observation = readJson(f.observation);
  const facts = readJson(f.facts);
  const served = readJson(f.served);
  const peers = readJson(f.peers);
  const now = String(f.now);
  // THE FRESH HALF. Each input is optional on the command line and ABSENT is data: an
  // assessment or toolchain that was not produced is refused by name, never assumed.
  const evaluation = { runId: String(f['evaluation-run-id'] ?? ''), runAttempt: String(f['evaluation-run-attempt'] ?? '') };
  const assessmentDir = typeof f.assessment === 'string' ? f.assessment : null;
  const assessmentFiles = assessmentDir ? readFilesUnder(assessmentDir) : { files: new Map(), unsafe: [] };
  const assessment = inspectAssessment(assessmentFiles.files);
  for (const u of assessmentFiles.unsafe) assessment.problems.push({ code: 'assessment.unsafe', detail: u });
  let tooling = null;
  if (typeof f['tooling-facts'] === 'string' && existsSync(f['tooling-facts'])) {
    try { tooling = readJson(f['tooling-facts']); } catch { tooling = { schema: 'unreadable' }; }
  }
  const upload = (kind, name) => {
    const id = Number(f[`${kind}-artifact-id`]);
    const digest = String(f[`${kind}-artifact-digest`] ?? '');
    return Number.isInteger(id) && id > 0 ? { id, name, digest: digest.startsWith('sha256:') ? digest : `sha256:${digest}` } : null;
  };
  const uploads = {
    tooling: upload('tooling', toolingArtifactName(evaluation.runId, evaluation.runAttempt)),
    assessment: upload('assessment', assessmentArtifactName(evaluation.runId, evaluation.runAttempt)),
  };
  const dependencies = { assessment, tooling, uploads };

  const decision = decide({
    policy, request, certification, artifact: observation, source: facts.source, hosting: facts.hosting,
    served, baseline: facts.baseline, eligibility: facts.eligibility, peers, trusted: facts.trusted,
    dependencies, evaluation, now,
  });

  // The record names the artifact THE RUN'S LISTING names — the same selection the
  // decision and the publisher's preflight make — never whatever id was downloaded.
  // No record can be built against an INVALID policy (it has no window, destination or
  // compatible set to bind), and none is needed: that decision is a refusal.
  let record = null;
  if (validatePolicy(policy).ok) {
    const listed = certification.present
      ? selectCertifiedArtifact(certification.artifacts, { runId: certification.runId, runAttempt: certification.runAttempt }).artifact
      : null;
    record = buildRecord({
      decision, request, policyFacts: facts.policy, certification, listedArtifact: listed,
      artifact: observation, hosting: facts.hosting, served, peers, policy, now, dependencies,
    });
    if (f['record-out']) writeFileSync(String(f['record-out']), `${JSON.stringify(record, null, 2)}\n`);
  }
  writeOutputs(f.outputs, {
    decision: decision.decision,
    allow: String(decision.allow),
    record: record ? encodeRecord(record) : '',
    record_digest: record ? recordDigest(record) : '',
    artifact_id: record?.artifact.id ?? '',
    run_id: record?.certification.runId ?? '',
    policy_revision: facts.policy?.revision ?? '',
    tooling_artifact_id: record?.publisher?.artifact?.id ?? '',
    assessment_artifact_id: record?.dependencies?.assessment?.artifact?.id ?? '',
  });
  if (f.summary) {
    appendFileSync(String(f.summary), shadowSummary({
      decision, request, certification, observation, served, policyRevision: facts.policy?.revision, policy, dependencies,
    }));
  }
  print(decision);
  exit(decision.decision === 'REFUSE' ? 1 : 0);
}

// ── readiness ───────────────────────────────────────────────────────────────────

/**
 * Asked ONLY of a refusal, by the workflow wrapper around `decide`. `decide` keeps its
 * own exit status — 1 on REFUSE — and this is the one further question: is the refusal
 * EXACTLY the recorded waiting state of a non-publishing evaluation
 * (lib/readiness.mjs)? Exit 0 for that and for nothing else. An invalid policy, an
 * input that cannot be read back, an enablement that was not passed, or any other answer is 1,
 * so a wrapper can translate this one status and no arbitrary other.
 *
 * The decision is read back from the file `decide` wrote and classified as DATA; it is
 * never re-derived, edited or re-emitted. Nothing here writes a decision, an allow, a
 * record or anything the publish job reads.
 */
function cmdReadiness(args) {
  const f = flags(args);
  const { policy, check } = readPolicy();
  const read = (name) => {
    if (typeof f[name] !== 'string' || !existsSync(f[name])) return { ok: false };
    try { return { ok: true, value: readJson(f[name]) }; } catch { return { ok: false }; }
  };
  const inputs = Object.fromEntries(['decision', 'request', 'facts', 'served', 'peers'].map((n) => [n, read(n)]));
  let result;
  if (!check.ok) {
    result = unclassifiable('readiness.policy_invalid', check.problems.map((p) => p.code).join(','));
  } else if (Object.values(inputs).some((i) => !i.ok)) {
    const missing = Object.entries(inputs).filter(([, i]) => !i.ok).map(([n]) => n);
    result = unclassifiable('readiness.evidence_unreadable', `unreadable: ${missing.join(', ')}`);
  } else {
    result = classifyReadiness({
      policy,
      request: inputs.request.value,
      // A wrapper that forgot `--enablement` hands over undefined, which the classifier
      // reads as NOT READ (readiness.enablement_unread) — never as "disabled".
      enablement: f.enablement,
      decision: inputs.decision.value,
      facts: inputs.facts.value,
      served: inputs.served.value,
      peers: inputs.peers.value,
    });
  }
  if (f.out) writeFileSync(String(f.out), `${JSON.stringify(result, null, 2)}\n`);
  writeOutputs(f.outputs, { readiness: result.kind });
  if (f.summary) appendFileSync(String(f.summary), readinessSummary(result, policy));
  // STDERR, deliberately: it runs inside the Decide step, whose stdout is the
  // decision and nothing else. Two documents on one stream is how a reader of the
  // log — or of the step — mistakes one for the other.
  stderr.write(`${JSON.stringify(result, null, 2)}\n`);
  exit(result.kind === AWAITING ? 0 : 1);
}

function readinessSummary(result, policy) {
  const legacy = policy?.prerequisites?.singlePublisher?.legacyWorkflow ?? 'the legacy deploy workflow';
  const variable = policy?.publication?.enablementVariable ?? 'the enablement variable';
  const enablement = {
    'disabled-unset': `disabled — \`${variable}\` is not set`,
    disabled: `disabled — \`${variable}\` is \`false\``,
    enabled: `ENABLED — \`${variable}\` is \`true\``,
    invalid: `INVALID — \`${variable}\` is neither unset, \`false\` nor \`true\``,
  }[result.enablement] ?? 'not read';
  const lines = [];
  if (result.kind === AWAITING) {
    lines.push('### Readiness evaluation completed', '');
    lines.push('- **New-path publication: NOT PERMITTED** — pending recorded prerequisites.');
    lines.push('- **Release decision:** `REFUSE`; allow: `false`. Nothing was admitted.');
    lines.push('- **Published by this run:** no.');
    lines.push(`- **Publication enablement:** ${enablement}.`);
    lines.push(`- **Legacy deployment:** remains separately configured (\`${legacy}\`). Its own runs report its result; this evaluation neither observes nor vouches for it.`);
    lines.push('', `**Outstanding (${result.awaiting.length})** — each listed in \`release/policy.json\` → \`publication.readiness.awaiting\` and standing in its context:`, '');
    lines.push('| reason | waiting on |', '|---|---|');
    for (const a of result.awaiting) lines.push(`| \`${a.code}\` | ${a.means} |`);
    lines.push('', '_Green because the evaluation completed and every refusal is a recorded, still-pending prerequisite. It does not mean anything was, or would be, published._', '');
  } else {
    lines.push('### Readiness evaluation: NOT the recorded waiting state', '');
    lines.push('This refusal stays a failure. What separates it from the recorded waiting state:', '');
    lines.push('| problem | detail |', '|---|---|');
    for (const p of result.problems) lines.push(`| \`${p.code}\` | ${String(p.detail ?? '').replace(/\|/g, '\\|')} |`);
    lines.push('', `Publication enablement: ${enablement}. Published by this run: no.`, '');
  }
  return `${lines.join('\n')}\n`;
}

// ── preflight ───────────────────────────────────────────────────────────────────

async function cmdPreflight(args) {
  const f = flags(args);
  const { policy, check } = readPolicy();
  const decoded = decodeRecord(f['record-b64'], f['record-digest']);
  const record = decoded.record;
  const repo = String(f.repo);
  const now = String(f.now);
  const reasons = [...decoded.problems];
  if (!check.ok) reasons.push({ code: 'preflight.policy_mismatch', detail: 'the pinned verifier\'s policy is invalid' });

  // The decoded record is written out for the verification step, which must compare
  // what is served against THIS record — the one whose digest was just re-derived —
  // rather than against anything re-computed later.
  if (decoded.ok && f['record-out']) writeFileSync(String(f['record-out']), `${JSON.stringify(record, null, 2)}\n`);

  let facts = null;
  if (decoded.ok && check.ok) {
    const candidateRoot = String(f.candidate);
    const observation = observeCandidate(candidateRoot);
    const currentRoot = String(f.current);
    let currentTree = null;
    try { currentTree = verifierIdentity(currentRoot); } catch { /* unreadable */ }
    const evaluationRun = String(f['run-id'] ?? '');
    const evaluationArtifacts = /^[0-9]+$/.test(evaluationRun) ? ghApi(`repos/${repo}/actions/runs/${evaluationRun}/artifacts?per_page=100`) : { ok: false };
    const toolingWalk = walkTooling(String(f.tooling));
    const entrypoint = toolingWalk.entries.find((e) => e.path === record.publisher?.entrypoint?.path);
    const assessmentFiles = readFilesUnder(String(f.assessment));
    const assessment = inspectAssessment(assessmentFiles.files);
    for (const u of assessmentFiles.unsafe) assessment.problems.push({ code: 'assessment.unsafe', detail: u });
    const run = ghApi(`repos/${repo}/actions/runs/${record.certification.runId}`);
    const artifacts = ghApi(`repos/${repo}/actions/runs/${record.certification.runId}/artifacts?per_page=100`);
    const compare = ghApi(`repos/${repo}/compare/${record.target.commit}...${policy.defaultBranch}`);
    const certifiedRoot = String(f.certified);
    const parse = (p) => { try { return readJson(join(certifiedRoot, p)); } catch { return undefined; } };
    let certifiedHead = null;
    try { certifiedHead = git(certifiedRoot, ['rev-parse', 'HEAD']).trim(); } catch { /* reported by preflight */ }
    facts = {
      trusted: { verifierTree: verifierIdentity(ROOT), policyDigest: digestOfValue(policy) },
      current: currentTree ? { state: 'known', verifierTree: currentTree } : { state: 'unreadable' },
      run: run.ok ? runFacts(run.json) : { present: false },
      artifacts: artifacts.ok && (artifacts.json.total_count ?? 0) <= (artifacts.json.artifacts ?? []).length
        ? (artifacts.json.artifacts ?? []).map(artifactFacts) : null,
      candidate: {
        present: observation.present,
        valid: observation.manifestValid === true && observation.provenanceValid === true
          && observation.observedTreeDigest === observation.expectedTreeDigest
          && observation.provenance?.legacy === false
          && observation.dependencyEvidence?.state === 'present' && observation.dependencyEvidence.problems.length === 0,
        treeDigest: observation.observedTreeDigest,
        manifestDigest: observation.manifestDigest,
        evidenceRecordDigest: observation.dependencyEvidence?.recordDigest ?? null,
        evidenceTreeDigest: observation.dependencyEvidence?.treeDigest ?? null,
        unsafe: [...observation.unsafeEntries, ...(observation.dependencyEvidence?.unsafe ?? [])],
      },
      evaluation: { runId: evaluationRun, runAttempt: String(f['run-attempt'] ?? '') },
      evaluationArtifacts: evaluationArtifacts.ok && (evaluationArtifacts.json.total_count ?? 0) <= (evaluationArtifacts.json.artifacts ?? []).length
        ? (evaluationArtifacts.json.artifacts ?? []).map(artifactFacts) : null,
      tooling: {
        treeDigest: toolingWalk.treeDigest,
        entryCount: toolingWalk.entries.length,
        unsafe: toolingWalk.unsafe,
        entrypointSha256: entrypoint?.sha256 ?? null,
        runtime: process.version,
      },
      assessment,
      compare: compare.ok ? { status: compare.json.status } : { status: `unreadable (${compare.detail})` },
      served: await readServedIdentity(policy.hosting.identityOrigin, policy.hosting.identityPath),
      adminServed: policy.compatibleSet.peers.admin.serving.observation === 'public-identity'
        ? await readPublicCommitIdentity(policy.compatibleSet.peers.admin.serving.origin, policy.compatibleSet.peers.admin.serving.path)
        : null,
      hosting: effectiveHosting({ firebaseJson: parse('firebase.json'), firebaserc: parse('.firebaserc'), policy, files: observation.files }),
      certifiedCheckout: { head: certifiedHead },
    };
    reasons.push(...preflightReasons({ record, policy, facts, now }));

    if (reasons.length === 0) {
      // STAGE exactly what was verified: the regenerated configuration and the
      // verified payload, and nothing else. The tool is pointed at this directory.
      const stage = String(f.stage);
      mkdirSync(stage, { recursive: true });
      writeFileSync(join(stage, 'firebase.json'), `${JSON.stringify(facts.hosting.config, null, 2)}\n`);
      writeFileSync(join(stage, '.firebaserc'), `${JSON.stringify(facts.hosting.rc, null, 2)}\n`);
      const publicDir = join(stage, policy.hosting.publicDirectory);
      renameSync(join(candidateRoot, 'dist'), publicDir);
      const staged = walkTree(publicDir);
      if (staged.unsafe.length > 0 || treeDigest(staged.entries) !== record.artifact.treeDigest) {
        reasons.push({ code: 'preflight.candidate_mismatch', detail: 'the staged payload does not reproduce the admitted tree digest' });
      }
      if (hostingHooks(facts.hosting.config).length > 0) {
        reasons.push({ code: 'preflight.hosting_mismatch', detail: 'the staged configuration carries a hook' });
      }
    }
  }
  const result = { ok: reasons.length === 0, reasons, record: record ? { target: record.target, artifact: record.artifact } : null };
  if (f.out) writeFileSync(String(f.out), `${JSON.stringify(result, null, 2)}\n`);
  print(result);
  exit(result.ok ? 0 : 1);
}

// ── publish ─────────────────────────────────────────────────────────────────────

/**
 * THE LAST BOUNDARY, then the admitted toolchain. The ONLY command that reads the
 * credential, and it reads it last.
 *
 * Immediately before the credential is read, with a clock reading the workflow takes at
 * that moment: the toolchain is re-measured (content tree, entrypoint, the Node running
 * this), the fresh assessment is re-read from this job's own download and re-checked
 * against the record, and its age and every applied exception's expiry are re-evaluated
 * — the preflight made the same checks minutes earlier, and time passed. Any refusal
 * here publishes nothing and never touches the credential.
 *
 * Then the entrypoint the record names is run by path with a built environment
 * (release/lib/publisher.mjs). The credential goes to a 0600 file in a fresh 0700
 * directory that is removed whatever the tool does, and is never placed in the tool's
 * environment, argv or output.
 */
function cmdPublish(args) {
  const f = flags(args);
  const { policy, check } = readPolicy();
  const now = String(f.now ?? '');
  const reasons = [];
  let record = null;
  try { record = readJson(f.record); } catch (error) { reasons.push({ code: 'publisher.record_unreadable', detail: error.message }); }
  if (!check.ok) reasons.push({ code: 'publisher.policy_invalid', detail: check.problems.map((p) => p.code).join(',') });
  if (record) reasons.push(...validateRecord(record).map((p) => ({ code: p.code.replace(/^preflight\./, 'publisher.'), detail: p.detail })));
  const stage = String(f.stage);
  const toolingRoot = String(f.tooling);
  const result = { ok: false, reasons, tool: null };
  if (reasons.length === 0) {
    if (!existsSync(join(stage, 'firebase.json'))) reasons.push({ code: 'publisher.no_config', detail: `no firebase.json at ${stage}` });
    const walked = walkTooling(toolingRoot);
    const entry = walked.entries.find((e) => e.path === record.publisher.entrypoint.path);
    const assessment = inspectAssessment(readFilesUnder(String(f.assessment)).files);
    reasons.push(...dependencyBoundaryReasons({
      record,
      policy,
      tooling: { treeDigest: walked.treeDigest, entryCount: walked.entries.length, unsafe: walked.unsafe, entrypointSha256: entry?.sha256 ?? null, runtime: process.version },
      assessment,
      now,
      prefix: 'publisher',
    }));
    reasons.push(...certificationWindowReasons({ record, policy, now, prefix: 'publisher' }));
  }
  if (reasons.length === 0) {
    const credential = process.env.FIREBASE_SERVICE_ACCOUNT ?? '';
    if (credential === '') {
      reasons.push({ code: 'publisher.no_credential', detail: 'FIREBASE_SERVICE_ACCOUNT is empty' });
    } else {
      const dir = mkdtempSync(join(String(f['temp-root'] ?? process.env.RUNNER_TEMP ?? tmpdir()), 'dinify-publish-'));
      chmodSync(dir, 0o700);
      const credentialPath = join(dir, 'service-account.json');
      const home = join(dir, 'home');
      try {
        mkdirSync(home, { mode: 0o700 });
        writeFileSync(credentialPath, credential, { mode: 0o600 });
        const inv = publishInvocation({ policy, record, toolingRoot, stage, credentialPath, home, baseEnv: process.env });
        const r = spawnSync(process.execPath, [inv.entrypoint, ...inv.args], {
          cwd: inv.cwd, env: inv.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60_000,
        });
        stderr.write(String(r.stderr ?? ''));
        const read = readPublishResult({ status: r.status, stdout: r.stdout, signal: r.signal, error: r.error ? r.error.message : null });
        result.tool = { argv: [inv.entrypoint, ...inv.args], state: read.state, detail: read.detail, status: r.status };
        result.ok = read.ok;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  result.ok = result.ok === true && reasons.length === 0;
  if (f.out) writeFileSync(String(f.out), `${JSON.stringify(result, null, 2)}\n`);
  print(result);
  exit(result.ok ? 0 : 1);
}

// ── verify-served ───────────────────────────────────────────────────────────────

async function cmdVerifyServed(args) {
  const f = flags(args);
  const { policy } = readPolicy();
  const record = readJson(f.record);
  const origin = policy.hosting.identityOrigin;
  // The wait is reviewed policy; the flags exist for a person running this by hand.
  const attempts = Number(f.attempts ?? policy.hosting.verification.attempts);
  const interval = Number(f['interval-ms'] ?? policy.hosting.verification.intervalMs);

  let identity = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    identity = await readServedIdentity(origin, policy.hosting.identityPath);
    if (identity.state === 'known' && identity.manifestDigest === record.artifact.manifestDigest) break;
    stderr.write(`attempt ${attempt}: ${identity.state} ${identity.servedCommit ?? ''} ${identity.manifestDigest ?? ''}\n`);
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, interval * attempt));
  }
  // The payload is the STAGED one — what the tool was handed — located the way the
  // preflight placed it, never a path typed separately into the workflow.
  const payload = f.payload ? String(f.payload) : join(String(f.stage), policy.hosting.publicDirectory);
  const entries = walkTree(payload).entries;
  const files = await fetchBackFiles(origin, entries);
  const observed = {
    identity: {
      state: identity.state,
      commit: identity.servedCommit ?? null,
      manifestDigest: identity.manifestDigest ?? null,
      // What the NEXT decision reads before anything else (served.identity_cacheable).
      cacheControl: identity.cacheControl ?? null,
      cacheControlNoStore: identity.cacheControlNoStore === true,
    },
    files,
    note: 'one fetch of each file, from one vantage point, at one moment — not a guarantee about any other edge or any later request',
  };
  const result = { ...observed, ...classifyVerification(record, observed) };
  if (f.out) writeFileSync(String(f.out), `${JSON.stringify(result, null, 2)}\n`);
  print(result);
}

// ── outcome ─────────────────────────────────────────────────────────────────────

function cmdOutcome(args) {
  const f = flags(args);
  // The report must still say REFUSED when the trusted policy itself cannot be parsed;
  // it reads the policy for one variable NAME and nothing else.
  let policy = null;
  try { ({ policy } = readPolicy()); } catch { policy = null; }
  const word = f['decision-word'] === true ? '' : String(f['decision-word'] ?? '');
  // A run that stopped BEFORE a decision (a step failed first) has no decision to
  // report. It is refused, and the summary says it never got as far as deciding.
  // A decision file that exists but cannot be read (decide died after the shell had
  // already created it) is the same fact as no decision: nothing was decided.
  const readable = (path) => {
    if (!path || !existsSync(String(path))) return null;
    try { return readJson(path); } catch { return null; }
  };
  const decisionObject = readable(f.decision);
  const decision = typeof decisionObject?.decision === 'string' ? decisionObject.decision : word;
  const preflight = f.preflight && existsSync(String(f.preflight)) ? readJson(f.preflight) : null;
  const verification = f.verification && existsSync(String(f.verification)) ? readJson(f.verification) : null;
  // THE LAST BOUNDARY: the publish command refused BEFORE it read the credential or ran
  // the tool. Read strictly off its own result — reasons stated, no tool invocation — so a
  // tool that ran and failed is never re-labelled a refusal.
  const published = readable(f.publish);
  const boundaryRefused = Boolean(published) && published.ok === false && published.tool === null
    && Array.isArray(published.reasons) && published.reasons.length > 0;
  // A recorded wait counts only when the readiness record classifies EXACTLY the
  // decision in this file (bound by digest) — never on the word of a stray file.
  let readiness = null;
  const readinessPresent = Boolean(f.readiness) && existsSync(String(f.readiness));
  if (readinessPresent) {
    try { readiness = readJson(f.readiness); } catch { readiness = null; }
  }
  const awaiting = readinessCovers(readiness, decisionObject);
  const outcome = summarizeOutcome({
    decision,
    awaiting,
    preflightOk: preflight ? preflight.ok === true : null,
    enabled: String(f.enabled) === 'true',
    publishStep: String(f['publish-step'] ?? 'skipped'),
    boundaryRefused,
    verification,
  });
  const lines = [
    `### Publication outcome: ${outcome}`, '',
    '| stage | result |', '|---|---|',
    `| decision | ${decision || 'none — the gate stopped before deciding; see the failed step'} |`,
    ...(readinessPresent ? [`| readiness | ${awaiting ? `awaiting ${readiness.awaiting.length} recorded prerequisite(s) — evaluation completed, nothing admitted` : `not the recorded waiting state${readiness?.problems?.length ? ` (${readiness.problems.map((p) => p.code).join(', ')})` : ''}`} |`] : []),
    `| preflight | ${preflight ? (preflight.ok ? 'passed' : preflight.reasons.map((r) => r.code).join(', ')) : 'not run'} |`,
    // The gate's report is not handed the variable, and must not claim what it never
    // read: "is not set" beside a refused ENABLED release would be false. The gate's
    // own reading is the readiness line above.
    `| enabled | ${!Object.hasOwn(f, 'enabled') ? 'not read by this step' : String(f.enabled) === 'true' ? 'yes' : `no — ${policy?.publication?.enablementVariable ?? 'the enablement variable'} is not \`true\``} |`,
    `| publication step | ${String(f['publish-step'] ?? 'skipped')}${boundaryRefused ? ` — refused at the last boundary before the credential was read (${published.reasons.map((r) => r.code).join(', ')}); the tool did not run` : ''} |`,
    `| served identity | ${verification ? `${verification.identity.state} ${verification.identity.manifestDigest ?? ''}, Cache-Control ${verification.identity.cacheControlNoStore === true ? 'no-store' : `${JSON.stringify(verification.identity.cacheControl ?? null).replace(/\|/g, '\\|')} — NOT no-store`}` : 'not observed'} |`,
    `| certified files fetched back | ${verification ? `${verification.files.checked} checked, ${verification.files.mismatched.length} mismatched, ${verification.files.unreachable.length} unreachable` : 'not observed'} |`,
    '',
  ];
  if (verification) lines.push(`_${verification.note}_`, '');
  if (f.summary) appendFileSync(String(f.summary), `${lines.join('\n')}\n`);
  print({ outcome });
  exit(FAILING_OUTCOMES.has(outcome) ? 1 : 0);
}

// ── storage-reviewed ────────────────────────────────────────────────────────────

function cmdStorageReviewed(args) {
  const f = flags(args);
  const { policy } = readPolicy();
  const path = join(ROOT, policy.storage.declarationPath);
  const declaration = readJson(path);
  const actual = {};
  for (const p of Object.keys(declaration.reviewedSources ?? {})) {
    if (existsSync(join(ROOT, p))) actual[p] = digestOf(readFileSync(join(ROOT, p)));
  }
  const stale = staleReviewedSources(declaration, actual);
  if (f.write) {
    for (const p of Object.keys(declaration.reviewedSources)) {
      if (actual[p] === undefined) fail(`${p} does not exist; edit reviewedSources by hand`);
      declaration.reviewedSources[p] = actual[p];
    }
    writeFileSync(path, `${JSON.stringify(declaration, null, 2)}\n`);
    stderr.write(`re-affirmed ${Object.keys(actual).length} reviewed source(s) in ${policy.storage.declarationPath}\n`);
    print({ reaffirmed: stale });
    return;
  }
  print({ stale });
  exit(stale.length === 0 ? 0 : 1);
}

// ── self-test ───────────────────────────────────────────────────────────────────

/**
 * --self-test, in the house style of scripts/check-platform-roles.mjs: a gate whose
 * matcher silently stopped matching would otherwise pass everything. These cover the
 * extractors that read meaning out of source text and the glob dialect that decides
 * whether a certified file would be uploaded.
 */
function cmdSelfTest() {
  const cases = [];
  const check = (name, fn) => {
    try { fn(); cases.push([true, name]); } catch (error) { cases.push([false, `${name}: ${error.message}`]); }
  };
  const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
  const throws = (fn) => { let threw = false; try { fn(); } catch { threw = true; } if (!threw) throw new Error('expected a refusal'); };

  check('reads a single integer constant', () => eq(readIntConstant('export const A = 7;\n', 'A'), 7));
  check('refuses a duplicated constant', () => throws(() => readIntConstant('export const A = 7;\nexport const A = 8;\n', 'A')));
  check('refuses a missing constant', () => throws(() => readIntConstant('export const B = 1;\n', 'A')));
  check('refuses a renamed constant', () => throws(() => readIntConstant('export const A_RENAMED = 7;\n', 'A')));
  check('ignores a constant in a comment', () => throws(() => readIntConstant('// export const A = 7;\nconst A = 7;\n', 'A')));
  check('reads a typed integer-array constant', () => eq(readIntArrayConstant('export const V: readonly number[] = [1, 2];\n', 'V'), [1, 2]));
  check('refuses an empty integer-array constant', () => throws(() => readIntArrayConstant('export const V = [];\n', 'V')));
  check('refuses a computed array constant', () => throws(() => readIntArrayConstant('export const V = [...W];\n', 'V')));
  check('reads the environment literal', () => {
    const e = readEnvironmentLiteral("  production: false,\n  apiUrl: 'https://x/y',\n  dinerBaseUrl: 'https://z',\n");
    eq([e.production, e.apiUrl, e.dinerBaseUrl], [false, 'https://x/y', 'https://z']);
  });
  check('refuses an ambiguous environment literal', () => throws(() => readEnvironmentLiteral(
    "  production: false,\n  production: true,\n  apiUrl: 'https://x',\n  dinerBaseUrl: 'https://z',\n")));
  check('finds a predeploy hook', () => eq(hostingHooks({ hosting: [{ predeploy: ['rm -rf /'] }] }).length, 1));
  check('finds a nested postdeploy hook', () => eq(hostingHooks({ a: { b: { postdeploy: 'x' } } })[0], '$.a.b.postdeploy'));
  check('glob: ** matches every depth', () => eq(globToRegExp('**/.*').test('a/b/.x'), true));
  check('glob: * stays within a segment', () => eq(globToRegExp('*.js').test('a/b.js'), false));
  check('glob: a dropped certified file is reported', () => eq(partitionByIgnore(['a.js', 'b.css'], ['**/*.js']).dropped.map((d) => d.path), ['a.js']));
  check('glob: brace expansion is refused, not approximated', () => eq(supportedIgnorePattern('**/*.{js,css}'), false));

  const failed = cases.filter(([ok]) => !ok);
  for (const [ok, name] of cases) stderr.write(`${ok ? 'ok  ' : 'FAIL'} ${name}\n`);
  stderr.write(`${cases.length - failed.length}/${cases.length} self-test cases passed\n`);
  exit(failed.length === 0 ? 0 : 1);
}

const [, , command, ...rest] = argv;
try {
  switch (command) {
    case 'stamp': cmdStamp(rest); break;
    case 'observe': cmdObserve(rest); break;
    case 'certification-facts': cmdCertificationFacts(rest); break;
    case 'git-facts': cmdGitFacts(rest); break;
    case 'serve-state': await cmdServeState(rest); break;
    case 'peer-receipt': cmdPeerReceipt(rest); break;
    case 'peer-facts': await cmdPeerFacts(rest); break;
    case 'prepare-publisher': cmdPreparePublisher(rest); break;
    case 'assess': cmdAssess(rest); break;
    case 'decide': cmdDecide(rest); break;
    case 'readiness': cmdReadiness(rest); break;
    case 'preflight': await cmdPreflight(rest); break;
    case 'publish': cmdPublish(rest); break;
    case 'verify-served': await cmdVerifyServed(rest); break;
    case 'outcome': cmdOutcome(rest); break;
    case 'storage-reviewed': cmdStorageReviewed(rest); break;
    case 'self-test': cmdSelfTest(); break;
    default:
      stderr.write('usage: node release/cli.mjs <stamp|observe|certification-facts|git-facts|serve-state|peer-receipt|peer-facts|decide|readiness|preflight|verify-served|outcome|storage-reviewed|self-test> [...]\n');
      exit(2);
  }
} catch (error) {
  stderr.write(`release: ${error.stack ?? error}\n`);
  exit(3);
}
