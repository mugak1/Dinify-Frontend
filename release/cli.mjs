#!/usr/bin/env node
/**
 * The thin command line the release workflows call. All judgement lives in
 * `release/lib/decide.mjs`, which is pure and separately tested; this file is the
 * I/O around it — read the tree, walk the artifact, fetch the served identity, print
 * JSON. Keeping the two apart is what lets the whole refusal matrix be executed
 * locally from fixtures with no network, no GitHub and no Firebase.
 *
 *   stamp          --dist <dir> --out <file> ...   produce dist/release.json + provenance
 *   observe        --root <dir>                    measure a downloaded artifact, as DATA
 *   serve-state    --origin <url> --target <sha>   read the live identity, classify it
 *   decide         --observation … --certification … --served … --now …
 *   self-test                                      the matcher/extractor checks
 *
 * Every command prints JSON on stdout and diagnostics on stderr, so a caller can
 * always separate the answer from the noise.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, lstatSync, existsSync } from 'node:fs';
import { join, relative, sep, posix } from 'node:path';
import { argv, exit, stderr, stdout } from 'node:process';

import { digestOf, digestOfValue, sha256Hex, treeDigest, contractDigest } from './lib/canonical.mjs';
import { MANIFEST_SCHEMA, buildProvenance, validateManifest, validateProvenance } from './lib/manifest.mjs';
import { hostingDestinationProblems, hostingHooks, readEnvironmentLiteral, readIntConstant } from './lib/source.mjs';
import { decide } from './lib/decide.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

function environmentFileFor(configuration) {
  const angular = JSON.parse(readFileSync(join(ROOT, 'angular.json'), 'utf8'));
  const project = Object.keys(angular.projects)[0];
  const config = angular.projects[project].architect.build.configurations[configuration];
  if (!config) throw new Error(`angular.json has no build configuration \`${configuration}\``);
  const replacements = config.fileReplacements ?? [];
  if (replacements.length !== 1) {
    throw new Error(`configuration \`${configuration}\` must replace exactly one environment file, found ${replacements.length}`);
  }
  return { file: replacements[0].with, config };
}

// ── artifact walking ──────────────────────────────────────────────────────────

const SAFE_ENTRY = /^[A-Za-z0-9._][A-Za-z0-9._@+-]*$/;

/**
 * Walk a directory as DATA. Returns the regular files with their digests, and every
 * entry it refused, so a caller can report the refusal rather than silently skipping.
 * Symlinks, devices, sockets, absolute-looking and traversing names are all refused:
 * an uploaded artifact is untrusted input to the one job that holds the publishing
 * credential, and "extract it and see" is not a validation strategy.
 */
export function walkTree(root) {
  const entries = [];
  const unsafe = [];
  const visit = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = prefix ? posix.join(prefix, name) : name;
      if (!SAFE_ENTRY.test(name)) { unsafe.push(`unsafe name: ${rel}`); continue; }
      const st = lstatSync(full);
      if (st.isSymbolicLink()) { unsafe.push(`symbolic link: ${rel}`); continue; }
      if (st.isDirectory()) { visit(full, rel); continue; }
      if (!st.isFile()) { unsafe.push(`not a regular file: ${rel}`); continue; }
      entries.push({ path: rel, sha256: sha256Hex(readFileSync(full)), size: st.size });
    }
  };
  visit(root, '');
  return { entries, unsafe };
}

// ── commands ──────────────────────────────────────────────────────────────────

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

function cmdStamp(args) {
  const f = flags(args);
  const policy = JSON.parse(readFileSync(join(ROOT, 'release/policy.json'), 'utf8'));
  const dist = f.dist ?? join(ROOT, 'dist');
  const configuration = policy.build.configuration;
  const { file: envFile } = environmentFileFor(configuration);
  const env = readEnvironmentLiteral(readFileSync(join(ROOT, envFile), 'utf8'));

  const problems = [];
  if (env.apiUrl !== policy.build.expectedApiUrl) {
    problems.push(`environment apiUrl ${env.apiUrl} != policy ${policy.build.expectedApiUrl}`);
  }
  if (env.production !== policy.build.expectedProductionFlag) {
    problems.push(`environment production ${env.production} != policy ${policy.build.expectedProductionFlag}`);
  }

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

  if (problems.length > 0) {
    stderr.write(`release: refusing to stamp\n  - ${problems.join('\n  - ')}\n`);
    exit(1);
  }

  const coordinator = readFileSync(join(ROOT, 'src/app/_services/checkout-coordinator.service.ts'), 'utf8');
  const transition = readFileSync(join(ROOT, 'src/app/_shared/order/quote-transition.ts'), 'utf8');
  const kitchen = readFileSync(join(ROOT, 'src/app/kitchen/services/kitchen-wire.ts'), 'utf8');
  const correlation = readFileSync(join(ROOT, 'src/app/_shared/order/checkout-correlation.ts'), 'utf8');
  const constants = {
    CHECKOUT_RECORD_VERSION: readIntConstant(coordinator, 'CHECKOUT_RECORD_VERSION'),
    REQUIRED_QUOTE_PROTOCOL: readIntConstant(transition, 'REQUIRED_QUOTE_PROTOCOL'),
    REQUIRED_CLOSURE_PROTOCOL: readIntConstant(transition, 'REQUIRED_CLOSURE_PROTOCOL'),
    REQUIRED_KITCHEN_PROTOCOL: readIntConstant(kitchen, 'REQUIRED_KITCHEN_PROTOCOL'),
    CHECKOUT_PROTOCOL_CORRELATED: readIntConstant(correlation, 'CHECKOUT_PROTOCOL_CORRELATED'),
  };

  const manifest = {
    schema: MANIFEST_SCHEMA,
    application: policy.application,
    repository: policy.repository,
    commit: String(f.commit ?? ''),
    ref: String(f.ref ?? `refs/heads/${policy.defaultBranch}`),
    buildConfiguration: configuration,
    builtAt: String(f.now ?? ''),
    environment: {
      name: `${configuration}-targeted`,
      apiUrl: env.apiUrl,
      dinerBaseUrl: env.dinerBaseUrl,
      // Recorded because it is true, not because it is desirable: the shipping
      // configuration bakes Angular's `production` flag FALSE today.
      productionFlag: env.production,
    },
    dependencies: {
      lockDigest: digestOf(readFileSync(join(ROOT, 'package-lock.json'))),
      nodeVersion: String(f.nodeVersion ?? ''),
    },
    certification: {
      workflowPath: policy.certification.workflowPath,
      runId: String(f.runId ?? ''),
      runAttempt: String(f.runAttempt ?? ''),
      runStartedAt: String(f.runStartedAt ?? ''),
    },
    compatibility: {
      storage: {
        checkoutRecordVersion: constants.CHECKOUT_RECORD_VERSION,
        // Bumped by hand when a policy or protocol transition changed what a stored
        // record MEANS without moving CHECKOUT_RECORD_VERSION. See release/README.md.
        semanticsRevision: Number.parseInt(String(f.semanticsRevision ?? '1'), 10),
      },
      // Keyed by the SERVER field the client reads, so a peer's published level can be
      // compared with a plain `>=`. The closure reader is gated on `quote_protocol`,
      // which is why the two client constants collapse to one server key here.
      clientExpects: {
        checkout_protocol: constants.CHECKOUT_PROTOCOL_CORRELATED,
        quote_protocol: Math.max(constants.REQUIRED_QUOTE_PROTOCOL, constants.REQUIRED_CLOSURE_PROTOCOL),
        kitchen_protocol: constants.REQUIRED_KITCHEN_PROTOCOL,
      },
      clientConstants: constants,
      contracts: {
        d01CheckoutLimits: contractDigest(
          JSON.parse(readFileSync(join(ROOT, 'src/app/_shared/order/checkout-limits.contract.json'), 'utf8')),
        ),
      },
    },
    hosting: {
      project: policy.hosting.project,
      site: policy.hosting.site,
      target: policy.hosting.target,
      identityPath: policy.hosting.identityPath,
    },
  };

  const check = validateManifest(manifest);
  if (!check.ok) {
    stderr.write(`release: manifest invalid\n  - ${check.problems.map((p) => `${p.code}: ${p.detail}`).join('\n  - ')}\n`);
    exit(1);
  }

  writeFileSync(join(dist, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const walked = walkTree(dist);
  if (walked.unsafe.length > 0) {
    stderr.write(`release: built tree is not clean\n  - ${walked.unsafe.join('\n  - ')}\n`);
    exit(1);
  }
  const provenance = buildProvenance({
    manifest,
    artifactName: String(f.artifactName ?? ''),
    artifactTreeDigest: treeDigest(walked.entries),
    entryCount: walked.entries.length,
  });
  writeFileSync(f.out ?? join(ROOT, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  stdout.write(`${JSON.stringify({ manifest, provenance }, null, 2)}\n`);
}

function cmdObserve(args) {
  const f = flags(args);
  const root = String(f.root);
  const distDir = join(root, 'dist');
  const out = { present: false, unsafeEntries: [], hostingConfigHooks: [], hostingConfigProblems: [] };

  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    out.unsafeEntries.push('artifact carries no dist/ directory');
    stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }
  for (const name of readdirSync(root)) {
    if (name !== 'dist' && name !== 'provenance.json') out.unsafeEntries.push(`unexpected artifact entry: ${name}`);
  }
  const walked = walkTree(distDir);
  out.present = true;
  out.unsafeEntries.push(...walked.unsafe);
  out.entryCount = walked.entries.length;
  out.observedTreeDigest = treeDigest(walked.entries);

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(distDir, 'release.json'), 'utf8'));
  } catch (error) {
    out.manifestValid = false;
    out.manifestProblems = [{ code: 'manifest.unreadable', detail: String(error.message) }];
  }
  if (manifest !== undefined) {
    const check = validateManifest(manifest);
    out.manifest = manifest;
    out.manifestValid = check.ok;
    out.manifestProblems = check.problems;
  }

  let provenance;
  try {
    provenance = JSON.parse(readFileSync(join(root, 'provenance.json'), 'utf8'));
  } catch (error) {
    out.provenanceValid = false;
    out.provenanceProblems = [{ code: 'provenance.unreadable', detail: String(error.message) }];
  }
  if (provenance !== undefined) {
    const check = validateProvenance(provenance, manifest);
    out.provenanceValid = check.ok;
    out.provenanceProblems = check.problems;
    out.expectedTreeDigest = provenance.artifactTreeDigest;
  }

  if (f['hosting-config']) {
    // The policy is read from THIS checkout — the trusted default branch — never
    // from the candidate, for the same reason the gate's code is.
    const policy = JSON.parse(readFileSync(join(ROOT, 'release/policy.json'), 'utf8'));
    try {
      const config = JSON.parse(readFileSync(String(f['hosting-config']), 'utf8'));
      out.hostingConfigHooks = hostingHooks(config);
      out.hostingConfigProblems = hostingDestinationProblems(config, {
        site: policy.hosting.site,
        publicDirectory: policy.hosting.publicDirectory,
      });
      out.hostingConfigMatchesCertified = true;
    } catch (error) {
      out.hostingConfigHooks = [];
      out.hostingConfigProblems = [];
      out.hostingConfigMatchesCertified = false;
      out.unsafeEntries.push(`hosting config unreadable: ${error.message}`);
    }
  }
  stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

async function cmdServeState(args) {
  const f = flags(args);
  const policy = JSON.parse(readFileSync(join(ROOT, 'release/policy.json'), 'utf8'));
  const url = `${f.origin ?? policy.hosting.identityOrigin}${policy.hosting.identityPath}`;
  const out = { state: 'unreadable', url };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(f.timeout ?? 15000));
    const response = await fetch(url, { redirect: 'manual', signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    out.status = response.status;
    out.cacheControl = response.headers.get('cache-control');
    out.cacheControlNoStore = /(^|[\s,])no-store([\s,]|$)/i.test(out.cacheControl ?? '');
    if (response.status === 404) {
      // Firebase rewrites an unmatched path to index.html, so a genuinely absent
      // identity file usually answers 200 with HTML rather than 404. Both are handled;
      // neither is read as "an identity was served and it said nothing".
      out.state = 'absent';
    } else if (response.status === 200) {
      const text = await response.text();
      try {
        const manifest = JSON.parse(text);
        const check = validateManifest(manifest);
        if (check.ok) {
          out.state = 'known';
          out.manifest = manifest;
          out.servedCommit = manifest.commit;
        } else {
          out.state = 'unreadable';
          out.detail = `served identity invalid: ${check.problems.map((p) => p.code).join(',')}`;
        }
      } catch {
        out.state = text.trimStart().startsWith('<') ? 'absent' : 'unreadable';
        if (out.state === 'unreadable') out.detail = 'served identity is neither JSON nor the SPA document';
      }
    } else {
      out.state = 'unreadable';
      out.detail = `unexpected status ${response.status}`;
    }
  } catch (error) {
    out.state = 'unreadable';
    out.detail = String(error.message ?? error);
  }
  stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

function cmdDecide(args) {
  const f = flags(args);
  const read = (key) => JSON.parse(readFileSync(String(f[key]), 'utf8'));
  const policy = f.policy ? read('policy') : JSON.parse(readFileSync(join(ROOT, 'release/policy.json'), 'utf8'));
  const result = decide({
    policy,
    request: read('request'),
    certification: read('certification'),
    artifact: read('observation'),
    served: read('served'),
    now: String(f.now),
  });
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exit(result.decision === 'REFUSE' ? 1 : 0);
}

/**
 * --self-test, in the house style of scripts/check-platform-roles.mjs: a gate whose
 * matcher silently stopped matching would otherwise pass everything. These cover the
 * two extractors that read meaning out of source text, and the two artifact refusals.
 */
function cmdSelfTest() {
  const cases = [];
  const check = (name, fn) => {
    try { fn(); cases.push([true, name]); } catch (error) { cases.push([false, `${name}: ${error.message}`]); }
  };
  const eq = (a, b) => { if (a !== b) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
  const throws = (fn) => { let threw = false; try { fn(); } catch { threw = true; } if (!threw) throw new Error('expected a refusal'); };

  check('reads a single integer constant', () => eq(readIntConstant('export const A = 7;\n', 'A'), 7));
  check('refuses a duplicated constant', () => throws(() => readIntConstant('export const A = 7;\nexport const A = 8;\n', 'A')));
  check('refuses a missing constant', () => throws(() => readIntConstant('export const B = 1;\n', 'A')));
  check('refuses a renamed constant', () => throws(() => readIntConstant('export const A_RENAMED = 7;\n', 'A')));
  check('ignores a constant in a comment', () => throws(() => readIntConstant('// export const A = 7;\nconst A = 7;\n', 'A')));
  check('reads the environment literal', () => {
    const env = readEnvironmentLiteral("  production: false,\n  apiUrl: 'https://x/y',\n  dinerBaseUrl: 'https://z',\n");
    eq(env.production, false); eq(env.apiUrl, 'https://x/y'); eq(env.dinerBaseUrl, 'https://z');
  });
  check('refuses an ambiguous environment literal', () => throws(() => readEnvironmentLiteral(
    "  production: false,\n  production: true,\n  apiUrl: 'https://x',\n  dinerBaseUrl: 'https://z',\n")));
  check('finds a predeploy hook', () => eq(hostingHooks({ hosting: [{ predeploy: ['rm -rf /'] }] }).length, 1));
  check('finds a nested postdeploy hook', () => eq(hostingHooks({ a: { b: { postdeploy: 'x' } } })[0], '$.a.b.postdeploy'));
  check('reports a clean hosting config', () => eq(hostingHooks({ hosting: [{ site: 's', public: './dist' }] }).length, 0));

  const failed = cases.filter(([ok]) => !ok);
  for (const [ok, name] of cases) stderr.write(`${ok ? 'ok  ' : 'FAIL'} ${name}\n`);
  stderr.write(`${cases.length - failed.length}/${cases.length} self-test cases passed\n`);
  exit(failed.length === 0 ? 0 : 1);
}

const [, , command, ...rest] = argv;
switch (command) {
  case 'stamp': cmdStamp(rest); break;
  case 'observe': cmdObserve(rest); break;
  case 'serve-state': await cmdServeState(rest); break;
  case 'decide': cmdDecide(rest); break;
  case 'self-test': cmdSelfTest(); break;
  default:
    stderr.write('usage: node release/cli.mjs <stamp|observe|serve-state|decide|self-test> [...]\n');
    exit(2);
}
