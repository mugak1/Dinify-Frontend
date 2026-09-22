#!/usr/bin/env node
/**
 * The thin command line the release workflows call. All judgement lives in the pure
 * modules under `release/lib/` (decide, preflight, outcome, peers, storage, hosting,
 * policy, manifest, record); this file is the I/O around them. Keeping the two apart
 * is what lets the whole refusal matrix run locally from fixtures, and what lets the
 * workflow simulation drive exactly these commands against recorded API answers.
 *
 *   stamp                 produce dist/release.json + provenance (certify.yml)
 *   observe               measure a downloaded candidate, as DATA
 *   certification-facts   the certifying run, its jobs, its artifacts, its ancestry
 *   git-facts             the certified commit's source, hosting, storage, eligibility
 *   serve-state           read this site's served identity (+ relation, with git)
 *   peer-receipt          PRODUCE a peer receipt from that peer's own git
 *   peer-facts            read receipts, verify public ones, observe peer serving
 *   decide                the decision + the admitted record + a shadow-mode summary
 *   preflight             the publisher's critical-section recheck, then staging
 *   verify-served         fetch the identity and every certified file back
 *   outcome               the one outcome word for the whole run
 *   storage-reviewed      re-affirm (or check) the storage declaration's tripwire
 *   self-test             the matcher/extractor checks
 *
 * Every command prints JSON on stdout and diagnostics on stderr, so a caller can
 * always separate the answer from the noise. Exit status is the answer where a step
 * must pass or fail; it is never swallowed by a pipeline here.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { argv, exit, stderr, stdout } from 'node:process';

import { contractDigest, digestOf, digestOfValue, treeDigest } from './lib/canonical.mjs';
import { buildManifest, buildProvenance, validateManifest } from './lib/manifest.mjs';
import { readEnvironmentLiteral, readIntArrayConstant, readIntConstant, hostingHooks } from './lib/source.mjs';
import { decide, selectCertifiedArtifact } from './lib/decide.mjs';
import { validatePolicy } from './lib/policy.mjs';
import { effectiveHosting } from './lib/hosting.mjs';
import { manifestStorage, staleReviewedSources, validateStorageDeclaration, declarationDigest } from './lib/storage.mjs';
import { PEER_NAMES, produceReceipt, receiptDigest } from './lib/peers.mjs';
import { buildRecord, decodeRecord, encodeRecord, recordDigest } from './lib/record.mjs';
import { preflightReasons } from './lib/preflight.mjs';
import { FAILING_OUTCOMES, classifyVerification, summarizeOutcome } from './lib/outcome.mjs';
import { partitionByIgnore, supportedIgnorePattern, globToRegExp } from './lib/glob.mjs';
import {
  artifactFacts, fetchBackFiles, ghApi, git, gitShow, observeCandidate,
  readPublicCommitIdentity, readServedIdentity, relationOf, runFacts, walkTree,
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
  const provenance = buildProvenance({
    manifest,
    artifactName: String(f.artifactName ?? ''),
    artifactTreeDigest: treeDigest(walked.entries),
    entryCount: walked.entries.length,
  });
  writeFileSync(String(f.out ?? join(ROOT, 'provenance.json')), `${JSON.stringify(provenance, null, 2)}\n`);
  print({ manifest, provenance });
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
    verifierTree: git(ROOT, ['rev-parse', 'HEAD:release']).trim(),
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
  out.trusted = { legacyPublisherPresent: existsSync(join(ROOT, policy.prerequisites.singlePublisher.legacyWorkflow)) };
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

function shadowSummary({ decision, request, certification, observation, served, policyRevision, policy }) {
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

  const decision = decide({
    policy, request, certification, artifact: observation, source: facts.source, hosting: facts.hosting,
    served, baseline: facts.baseline, eligibility: facts.eligibility, peers, trusted: facts.trusted, now,
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
      artifact: observation, hosting: facts.hosting, served, peers, policy, now,
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
  });
  if (f.summary) {
    appendFileSync(String(f.summary), shadowSummary({
      decision, request, certification, observation, served, policyRevision: facts.policy?.revision, policy,
    }));
  }
  print(decision);
  exit(decision.decision === 'REFUSE' ? 1 : 0);
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
    try { currentTree = git(currentRoot, ['rev-parse', 'HEAD:release']).trim(); } catch { /* unreadable */ }
    const run = ghApi(`repos/${repo}/actions/runs/${record.certification.runId}`);
    const artifacts = ghApi(`repos/${repo}/actions/runs/${record.certification.runId}/artifacts?per_page=100`);
    const compare = ghApi(`repos/${repo}/compare/${record.target.commit}...${policy.defaultBranch}`);
    const certifiedRoot = String(f.certified);
    const parse = (p) => { try { return readJson(join(certifiedRoot, p)); } catch { return undefined; } };
    let certifiedHead = null;
    try { certifiedHead = git(certifiedRoot, ['rev-parse', 'HEAD']).trim(); } catch { /* reported by preflight */ }
    facts = {
      trusted: { verifierTree: git(ROOT, ['rev-parse', 'HEAD:release']).trim(), policyDigest: digestOfValue(policy) },
      current: currentTree ? { state: 'known', verifierTree: currentTree } : { state: 'unreadable' },
      run: run.ok ? runFacts(run.json) : { present: false },
      artifacts: artifacts.ok && (artifacts.json.total_count ?? 0) <= (artifacts.json.artifacts ?? []).length
        ? (artifacts.json.artifacts ?? []).map(artifactFacts) : null,
      candidate: {
        present: observation.present,
        valid: observation.manifestValid === true && observation.provenanceValid === true
          && observation.observedTreeDigest === observation.expectedTreeDigest,
        treeDigest: observation.observedTreeDigest,
        manifestDigest: observation.manifestDigest,
        unsafe: observation.unsafeEntries,
      },
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
    identity: { state: identity.state, commit: identity.servedCommit ?? null, manifestDigest: identity.manifestDigest ?? null },
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
  const { policy } = readPolicy();
  const word = f['decision-word'] === true ? '' : String(f['decision-word'] ?? '');
  // A run that stopped BEFORE a decision (a step failed first) has no decision to
  // report. It is refused, and the summary says it never got as far as deciding.
  const decision = f.decision && existsSync(String(f.decision)) ? readJson(f.decision).decision : word;
  const preflight = f.preflight && existsSync(String(f.preflight)) ? readJson(f.preflight) : null;
  const verification = f.verification && existsSync(String(f.verification)) ? readJson(f.verification) : null;
  const outcome = summarizeOutcome({
    decision,
    preflightOk: preflight ? preflight.ok === true : null,
    enabled: String(f.enabled) === 'true',
    publishStep: String(f['publish-step'] ?? 'skipped'),
    verification,
  });
  const lines = [
    `### Publication outcome: ${outcome}`, '',
    '| stage | result |', '|---|---|',
    `| decision | ${decision || 'none — the gate stopped before deciding; see the failed step'} |`,
    `| preflight | ${preflight ? (preflight.ok ? 'passed' : preflight.reasons.map((r) => r.code).join(', ')) : 'not run'} |`,
    `| enabled | ${String(f.enabled) === 'true' ? 'yes' : `no — ${policy?.publication?.enablementVariable ?? 'the enablement variable'} is not set`} |`,
    `| publication step | ${String(f['publish-step'] ?? 'skipped')} |`,
    `| served identity | ${verification ? `${verification.identity.state} ${verification.identity.manifestDigest ?? ''}` : 'not observed'} |`,
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
    case 'decide': cmdDecide(rest); break;
    case 'preflight': await cmdPreflight(rest); break;
    case 'verify-served': await cmdVerifyServed(rest); break;
    case 'outcome': cmdOutcome(rest); break;
    case 'storage-reviewed': cmdStorageReviewed(rest); break;
    case 'self-test': cmdSelfTest(); break;
    default:
      stderr.write('usage: node release/cli.mjs <stamp|observe|certification-facts|git-facts|serve-state|peer-receipt|peer-facts|decide|preflight|verify-served|outcome|storage-reviewed|self-test> [...]\n');
      exit(2);
  }
} catch (error) {
  stderr.write(`release: ${error.stack ?? error}\n`);
  exit(3);
}
