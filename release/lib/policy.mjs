/**
 * THE POLICY'S OWN SHAPE — validated before a single rule is evaluated.
 *
 * Every field in release/policy.json is decision-bearing: the gate reads it and a
 * wrong value changes what may be published. So the policy is validated as data first,
 * and an invalid policy is ONE refusal (`policy.invalid`) naming every problem, rather
 * than a TypeError halfway through decide() or — worse — a missing field read as
 * `undefined` and compared against something that is also `undefined`.
 *
 * That last failure is not hypothetical (R1.a/b, reproduced): deleting the backend
 * commit, or setting it to "not-a-sha", PROCEEDED, because nothing read it. A missing
 * or malformed peer SHA is now a named problem here.
 *
 * Pure. Never throws on data.
 */

import { supportedIgnorePattern } from './glob.mjs';
import { WAITING_CODES } from './readiness.mjs';

// /3 (D08 B2.2): `publisher` pins the publication toolchain as a reviewed graph, and
// `freshness.assessmentWindowHours` bounds the fresh dependency assessment. The tool
// version moved from `hosting.firebaseToolsVersion` to `publisher.version`: one fact,
// one place, checked against the lock that actually installs it.
export const POLICY_SCHEMA = 'dinify.release.policy/3';
export const MAX_ASSESSMENT_WINDOW_HOURS = 24;

const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const CONFIG_RE = /^[a-z0-9-]+$/;
const VAR_RE = /^[A-Z][A-Z0-9_]*$/;
const SAFE_PATH_RE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._\/-]+$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isString = (v) => typeof v === 'string' && v.length > 0;
const isHttpsOrigin = (v) => {
  if (!isString(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.pathname === '/' && !u.search && !u.hash && !v.endsWith('/');
  } catch {
    return false;
  }
};

export function validatePolicy(policy) {
  const problems = [];
  const p = policy;
  const fail = (code, detail) => problems.push({ code, detail: String(detail) });

  if (!isObject(p)) {
    fail('policy.not_an_object', typeof p);
    return { ok: false, problems };
  }
  if (p.schema !== POLICY_SCHEMA) fail('policy.wrong_schema', p.schema);
  if (!isString(p.application)) fail('policy.no_application', p.application);
  if (!REPO_RE.test(String(p.repository))) fail('policy.bad_repository', p.repository);
  if (!isString(p.defaultBranch)) fail('policy.no_default_branch', p.defaultBranch);

  const c = p.certification;
  if (!isObject(c)) {
    fail('policy.no_certification', c);
  } else {
    if (!String(c.workflowPath).startsWith('.github/workflows/')) fail('policy.bad_workflow_path', c.workflowPath);
    if (c.event !== 'push') fail('policy.bad_certification_event', c.event);
    if (!isString(c.branch)) fail('policy.no_certification_branch', c.branch);
    if (!Array.isArray(c.requiredChecks) || c.requiredChecks.length === 0 || !c.requiredChecks.every(isString)) {
      fail('policy.no_required_checks', JSON.stringify(c.requiredChecks));
    }
  }

  const hours = p.freshness?.certificationWindowHours;
  if (!(typeof hours === 'number' && Number.isFinite(hours) && hours > 0)) fail('policy.bad_freshness', hours);
  const assessed = p.freshness?.assessmentWindowHours;
  if (!(typeof assessed === 'number' && Number.isFinite(assessed) && assessed > 0 && assessed <= MAX_ASSESSMENT_WINDOW_HOURS)) {
    fail('policy.bad_assessment_window', assessed);
  }

  const b = p.build;
  if (!isObject(b)) {
    fail('policy.no_build', b);
  } else {
    if (!CONFIG_RE.test(String(b.configuration))) fail('policy.bad_build_configuration', b.configuration);
    if (!String(b.expectedApiUrl).startsWith('https://')) fail('policy.bad_api_url', b.expectedApiUrl);
    if (typeof b.expectedProductionFlag !== 'boolean') fail('policy.bad_production_flag', b.expectedProductionFlag);
    if (!Array.isArray(b.forbiddenOriginsInBundle) || !b.forbiddenOriginsInBundle.every((o) => String(o).startsWith('https://'))) {
      fail('policy.bad_forbidden_origins', JSON.stringify(b.forbiddenOriginsInBundle));
    }
  }

  const h = p.hosting;
  if (!isObject(h)) {
    fail('policy.no_hosting', h);
  } else {
    for (const key of ['project', 'site', 'target', 'publicDirectory']) {
      if (!isString(h[key])) fail(`policy.bad_hosting_${key}`, h[key]);
    }
    if (h.channelId !== 'live') fail('policy.bad_hosting_channel', h.channelId);
    if (!isHttpsOrigin(h.identityOrigin)) fail('policy.bad_identity_origin', h.identityOrigin);
    if (!String(h.identityPath).startsWith('/')) fail('policy.bad_identity_path', h.identityPath);
    if ('firebaseToolsVersion' in h) fail('policy.bad_tools_version', 'the tool is pinned by publisher.version and the reviewed lock, not here');
    if (!Array.isArray(h.ignore) || !h.ignore.every(supportedIgnorePattern)) fail('policy.bad_hosting_ignore', JSON.stringify(h.ignore));
    const v = h.verification;
    if (!(Number.isInteger(v?.attempts) && v.attempts >= 1 && v.attempts <= 10
      && Number.isInteger(v?.intervalMs) && v.intervalMs >= 0 && v.intervalMs <= 60000)) {
      fail('policy.bad_verification_schedule', JSON.stringify(v));
    }
  }

  const pub = p.publisher;
  if (!isObject(pub)) {
    fail('policy.no_publisher', pub);
  } else {
    if (pub.root !== 'release/publisher') fail('policy.bad_publisher_root', pub.root);
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(String(pub.package))) fail('policy.bad_publisher_package', pub.package);
    if (!SEMVER_RE.test(String(pub.version))) fail('policy.bad_tools_version', pub.version);
    if (!SEMVER_RE.test(String(pub.node))) fail('policy.bad_publisher_node', pub.node);
    if (!(typeof pub.entrypoint === 'string' && pub.entrypoint.startsWith(`node_modules/${pub.package}/`)
        && SAFE_PATH_RE.test(pub.entrypoint) && pub.entrypoint.endsWith('.js'))) {
      fail('policy.bad_publisher_entrypoint', pub.entrypoint);
    }
    if (!isString(pub.deployAgent) || !/^[a-z0-9-]+$/.test(pub.deployAgent)) fail('policy.bad_publisher_agent', pub.deployAgent);
  }

  if (!SAFE_PATH_RE.test(String(p.storage?.declarationPath))) fail('policy.bad_storage_declaration_path', p.storage?.declarationPath);

  const boot = p.bootstrap;
  if (!isObject(boot) || typeof boot.authorized !== 'boolean') {
    fail('policy.bad_bootstrap', JSON.stringify(boot));
  } else if (boot.servedBaseline !== null && !(isObject(boot.servedBaseline) && SHA_RE.test(String(boot.servedBaseline.commit)))) {
    fail('policy.bad_bootstrap_baseline', JSON.stringify(boot.servedBaseline));
  }

  const e = p.eligibility;
  if (!isObject(e)) {
    fail('policy.no_eligibility', e);
  } else {
    if (e.minimumSafeTarget !== null && !SHA_RE.test(String(e.minimumSafeTarget))) fail('policy.bad_minimum_safe_target', e.minimumSafeTarget);
    if (!Array.isArray(e.revoked) || !e.revoked.every((r) => isObject(r) && SHA_RE.test(String(r.commit)) && isString(r.reason))) {
      fail('policy.bad_revocations', JSON.stringify(e.revoked));
    }
  }

  const set = p.compatibleSet;
  if (!isObject(set)) {
    fail('policy.no_compatible_set', set);
  } else {
    if (!isString(set.id)) fail('policy.no_compatible_set_id', set.id);
    if (!CONFIG_RE.test(String(set.frontendRequires?.buildConfiguration))) fail('policy.bad_set_configuration', set.frontendRequires?.buildConfiguration);
    for (const name of ['backend', 'admin']) validatePeer(set.peers?.[name], name, fail);
  }

  const pre = p.prerequisites;
  if (!isObject(pre)) {
    fail('policy.no_prerequisites', pre);
  } else {
    if (!['unrecorded', 'recorded', 'limitation-disclosed'].includes(pre.sourceProtection?.status)) {
      fail('policy.bad_source_protection', pre.sourceProtection?.status);
    }
    if (!['unverified', 'verified'].includes(pre.retention?.status)) fail('policy.bad_retention', pre.retention?.status);
    const single = pre.singlePublisher;
    if (!['legacy-writer-active', 'single-publisher'].includes(single?.status)) fail('policy.bad_single_publisher', single?.status);
    if (!String(single?.legacyWorkflow).startsWith('.github/workflows/')) fail('policy.bad_legacy_workflow', single?.legacyWorkflow);
  }

  if (!VAR_RE.test(String(p.publication?.enablementVariable))) fail('policy.bad_enablement_variable', p.publication?.enablementVariable);
  // The reviewed list of refusals a NON-PUBLISHING evaluation may report as waiting
  // rather than failing (lib/readiness.mjs). Shape and vocabulary only: whether each
  // entry still stands is the classifier's question, answered against this policy and
  // the run's evidence. An entry the registry does not know is not a wait to excuse.
  const awaiting = p.publication?.readiness?.awaiting;
  if (!Array.isArray(awaiting)) {
    fail('policy.bad_readiness', 'publication.readiness.awaiting must be a list');
  } else {
    for (const code of awaiting) {
      if (!WAITING_CODES.includes(code)) fail('policy.bad_readiness', `not a waiting condition: ${JSON.stringify(code)}`);
    }
    if (new Set(awaiting).size !== awaiting.length) fail('policy.bad_readiness', 'duplicate entry');
  }

  return { ok: problems.length === 0, problems };
}

function validatePeer(peer, name, fail) {
  if (!isObject(peer)) {
    fail(`policy.${name}_unpinned`, peer);
    return;
  }
  if (!REPO_RE.test(String(peer.repository))) fail(`policy.${name}_bad_repository`, peer.repository);
  if (!['operator', 'public-repository'].includes(peer.receiptVerification)) {
    fail(`policy.${name}_bad_receipt_verification`, peer.receiptVerification);
  }
  if (!Array.isArray(peer.approved) || peer.approved.length === 0) {
    fail(`policy.${name}_unpinned`, 'no approved revision');
  } else {
    const commits = new Set();
    for (const a of peer.approved) {
      if (!isObject(a) || !SHA_RE.test(String(a.commit))) {
        fail(`policy.${name}_commit_invalid`, isObject(a) ? a.commit : a);
        continue;
      }
      if (commits.has(a.commit)) fail(`policy.${name}_commit_duplicate`, a.commit);
      commits.add(a.commit);
      if (a.receipt !== `release/peers/${name}-${a.commit}.json`) fail(`policy.${name}_bad_receipt_path`, a.receipt);
      if (!DIGEST_RE.test(String(a.receiptDigest))) fail(`policy.${name}_bad_receipt_digest`, a.receiptDigest);
    }
  }
  const s = peer.serving;
  if (!isObject(s)) {
    fail(`policy.${name}_no_serving`, s);
  } else if (s.observation === 'unavailable') {
    if (!isString(s.reason)) fail(`policy.${name}_serving_no_reason`, s.reason);
  } else if (s.observation === 'public-identity') {
    if (!isHttpsOrigin(s.origin)) fail(`policy.${name}_serving_bad_origin`, s.origin);
    if (!String(s.path).startsWith('/')) fail(`policy.${name}_serving_bad_path`, s.path);
  } else {
    fail(`policy.${name}_serving_unknown_observation`, s.observation);
  }
  if (name === 'admin' && !(Array.isArray(peer.assumptions) && peer.assumptions.length > 0 && peer.assumptions.every(isString))) {
    fail('policy.admin_no_assumptions', JSON.stringify(peer.assumptions));
  }
}
