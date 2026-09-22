/**
 * THE ADAPTER HARNESS — real git repositories, the real CLI, local HTTPS origins and a
 * recorded GitHub API, for the suites that must go through the I/O layer rather than
 * around it.
 *
 * The pure refusal matrix (decide.test.mjs) proves the RULES. These suites prove the
 * ADAPTERS feed the rules what the world actually says: a receipt produced by the real
 * producer from a real git object store, a served identity read over real TLS, a
 * GitHub answer parsed by the same `gh api` call the workflow makes. A rule that is
 * right and an adapter that hands it the wrong fact is a gate that passes the wrong
 * thing, and only this layer can see that.
 *
 * NOTHING HERE TOUCHES ANYTHING REAL. Every origin is 127.0.0.1 with a certificate
 * minted for this process; every git repository is a temporary directory; `gh` is a
 * recorded stand-in on PATH; no proxy is used and no credential exists. Temporary
 * directories are removed at exit (set KEEP_RELEASE_FIXTURES=1 to inspect them).
 *
 * Not a test file: `node --test "release/tests/*.test.mjs"` does not collect it.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';

export const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
export const REPOSITORY = 'mugak1/Dinify-Frontend';

// ── temporary directories ───────────────────────────────────────────────────────

const made = [];
export function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `dinify-release-${prefix}-`));
  made.push(dir);
  return dir;
}
process.on('exit', () => {
  if (process.env.KEEP_RELEASE_FIXTURES) return;
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

// ── processes ───────────────────────────────────────────────────────────────────

/**
 * Run a process ASYNCHRONOUSLY. A synchronous spawn would block this process's event
 * loop, and the local origins it is being asked to read are served by that loop — the
 * first version of the baseline reproduction deadlocked exactly that way.
 */
export function run(command, args, { cwd, env, input } = {}) {
  return new Promise((resolve) => {
    // No stdin unless there is input to give. Writing to the stdin of a child that has
    // already exited raises EPIPE asynchronously, and under concurrent tests node:test
    // attributes that unhandled error to WHICHEVER test happens to be running.
    const child = spawn(command, args, {
      cwd, env: env ?? process.env, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b; });
    child.stderr.on('data', (b) => { stderr += b; });
    child.on('error', (error) => resolve({ status: null, stdout, stderr: `${stderr}${error}` }));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    if (input !== undefined) {
      child.stdin.on('error', () => { /* a child that exits without reading its input */ });
      child.stdin.end(input);
    }
  });
}

/** The CLI at `root` (default: this repository), run with the harness environment. */
export function cli(args, { root = ROOT, env = {}, cwd } = {}) {
  return run(process.execPath, [join(root, 'release/cli.mjs'), ...args], { cwd: cwd ?? root, env: childEnv(env) });
}

/**
 * The environment a child gets: local origins trusted through NODE_EXTRA_CA_CERTS and
 * reached directly, never through a proxy.
 */
export function childEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NODE_USE_ENV_PROXY']) {
    delete env[key];
  }
  env.NO_PROXY = '127.0.0.1,localhost';
  env.no_proxy = env.NO_PROXY;
  env.NODE_EXTRA_CA_CERTS = tlsMaterial().certPath;
  return { ...env, ...extra };
}

// ── git ─────────────────────────────────────────────────────────────────────────

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'release-fixture',
  GIT_AUTHOR_EMAIL: 'release-fixture@example.invalid',
  GIT_COMMITTER_NAME: 'release-fixture',
  GIT_COMMITTER_EMAIL: 'release-fixture@example.invalid',
};

/** git, synchronously — safe here because git never talks to the local origins. */
export function git(cwd, args) {
  const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, ...GIT_IDENTITY },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${String(r.stderr).trim()}`);
  return r.stdout.trim();
}

export function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q']);
  // A checkout stand-in fetches individual commits by SHA, as actions/checkout does.
  git(dir, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);
  return dir;
}

export function writeText(dir, rel, text) {
  const path = join(dir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function commitAll(dir, message) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', message]);
  return git(dir, ['rev-parse', 'HEAD']);
}

// ── TLS and local origins ───────────────────────────────────────────────────────

let tlsCache = null;

/** A certificate for 127.0.0.1, minted once per process. */
export function tlsMaterial() {
  if (tlsCache) return tlsCache;
  const dir = tempDir('tls');
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  const r = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '2', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
  ], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`openssl could not mint a test certificate: ${r.stderr}`);
  tlsCache = { key: readFileSync(keyPath), cert: readFileSync(certPath), certPath };
  return tlsCache;
}

/**
 * A local HTTPS origin. `route()` pins an exact answer for a path; `serveSite()` serves
 * a published directory with the two Firebase Hosting behaviours the release contract
 * depends on — the deployed configuration's exact-path header rules, and the `**`
 * rewrite that answers an unknown path with index.html at 200.
 */
export async function startOrigin({ log = null, name = 'origin' } = {}) {
  const { key, cert } = tlsMaterial();
  const state = { routes: new Map(), site: null, requests: [] };
  const server = createServer({ key, cert }, (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'https://origin.invalid').pathname);
    state.requests.push(path);
    // A shared log interleaves these reads with the workflow simulation's steps, so a
    // test can assert WHEN an origin was read relative to a promotion.
    if (log) log.push({ type: 'http', origin: name, path });
    const pinned = state.routes.get(path);
    if (pinned) {
      res.writeHead(pinned.status, pinned.headers);
      res.end(pinned.body);
      return;
    }
    if (state.site) {
      serveSiteFile(state.site, path, res);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `https://127.0.0.1:${server.address().port}`,
    requests: state.requests,
    route(path, { status = 200, headers = {}, body = '' } = {}) { state.routes.set(path, { status, headers, body }); },
    unroute(path) { state.routes.delete(path); },
    serveSite(dir, config) { state.site = dir === null ? null : { dir, config }; },
    site() { return state.site; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function serveSiteFile(site, path, res) {
  const entry = (Array.isArray(site.config?.hosting) ? site.config.hosting[0] : site.config?.hosting) ?? {};
  const headersFor = (p) => {
    const out = {};
    for (const rule of entry.headers ?? []) {
      if (rule.source === p) for (const kv of rule.headers) out[kv.key.toLowerCase()] = kv.value;
    }
    return out;
  };
  const rel = path.replace(/^\/+/, '');
  const file = join(site.dir, rel);
  if (rel && !rel.split('/').includes('..') && existsSync(file) && statSync(file).isFile()) {
    res.writeHead(200, headersFor(path));
    res.end(readFileSync(file));
    return;
  }
  const rewrite = (entry.rewrites ?? []).find((w) => w.source === '**');
  const destination = rewrite ? join(site.dir, rewrite.destination.replace(/^\/+/, '')) : null;
  if (destination && existsSync(destination)) {
    res.writeHead(200, { 'content-type': 'text/html', ...headersFor(rewrite.destination) });
    res.end(readFileSync(destination));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}

// ── a recorded GitHub API ───────────────────────────────────────────────────────

const GH_SCRIPT = `#!/usr/bin/env node
'use strict';
// A RECORDED GitHub API for the release tests: answers \`gh api <path>\` from a JSON
// map and logs every call with whether a token was present. It never reaches GitHub.
const fs = require('fs');
const args = process.argv.slice(2);
const path = args[args.length - 1];
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ args, token: Boolean(process.env.GH_TOKEN) }) + '\\n');
if (args[0] !== 'api') { process.stderr.write('fake gh: only "gh api" is recorded\\n'); process.exit(2); }
const map = JSON.parse(fs.readFileSync(process.env.FAKE_GH_RESPONSES, 'utf8'));
const answer = Object.prototype.hasOwnProperty.call(map, path) ? map[path] : null;
if (!answer) { process.stderr.write('gh: Not Found (HTTP 404)\\n'); process.exit(1); }
if (answer.status && answer.status !== 200) { process.stderr.write('gh: request failed (HTTP ' + answer.status + ')\\n'); process.exit(1); }
process.stdout.write(JSON.stringify(answer.json));
`;

export function installFakeGh() {
  const dir = tempDir('gh');
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const responses = join(dir, 'responses.json');
  const log = join(dir, 'calls.jsonl');
  writeFileSync(responses, '{}');
  writeFileSync(log, '');
  writeFileSync(join(bin, 'gh'), GH_SCRIPT);
  chmodSync(join(bin, 'gh'), 0o755);
  const read = () => JSON.parse(readFileSync(responses, 'utf8'));
  return {
    bin,
    set(map) { writeFileSync(responses, JSON.stringify(map)); },
    update(mutate) { const map = read(); mutate(map); writeFileSync(responses, JSON.stringify(map)); },
    get: read,
    calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    env: () => ({ PATH: `${bin}:${process.env.PATH}`, FAKE_GH_RESPONSES: responses, FAKE_GH_LOG: log }),
  };
}

/** A workflow run object, as `GET repos/{repo}/actions/runs/{id}` answers it. */
export function runObject({
  runId, runAttempt = 1, headSha, startedAt, conclusion = 'success', status = 'completed',
  path = '.github/workflows/certify.yml', event = 'push', branch = 'main', repository = REPOSITORY,
}) {
  return {
    id: Number(runId), run_attempt: Number(runAttempt), head_sha: headSha, head_branch: branch,
    path, event, status, conclusion, run_started_at: startedAt,
    repository: { full_name: repository }, head_repository: { full_name: repository },
  };
}

/** The recorded answers a certifying run is read through. */
export function certificationResponses({ repository = REPOSITORY, run, jobs = [{ name: 'certify', status: 'completed', conclusion: 'success' }], artifacts }) {
  const base = `repos/${repository}/actions/runs/${run.id}`;
  return {
    [base]: { json: run },
    [`${base}/jobs?filter=latest&per_page=100`]: { json: { total_count: jobs.length, jobs } },
    [`${base}/artifacts?per_page=100`]: { json: { total_count: artifacts.length, artifacts } },
  };
}

// ── artifacts ───────────────────────────────────────────────────────────────────

function listFiles(root) {
  const out = [];
  const visit = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = prefix ? posix.join(prefix, name) : name;
      if (statSync(full).isDirectory()) visit(full, rel);
      else out.push(rel);
    }
  };
  visit(root, '');
  return out;
}

/**
 * A digest over an artifact directory's bytes. It stands in for the SHA-256 GitHub
 * computes over an artifact's zip: an identifier of immutable uploaded bytes, which
 * the download stand-in re-derives and compares exactly as the real action does.
 */
export function artifactDigest(dir) {
  const hash = createHash('sha256');
  for (const rel of listFiles(dir)) {
    hash.update(`${rel}\u0000${createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex')}\n`);
  }
  return `sha256:${hash.digest('hex')}`;
}

/** Uploaded artifacts, by id. The listing a run's API answer carries is derived here. */
export function artifactStore() {
  const entries = [];
  let nextId = 70001;
  return {
    entries,
    add(candidate, { id } = {}) {
      const entry = {
        id: id ?? nextId++, name: candidate.name, runId: String(candidate.runId), headSha: candidate.commit,
        digest: candidate.digest, expired: false, dir: candidate.dir,
      };
      entries.push(entry);
      return entry;
    },
    get: (id) => entries.find((e) => e.id === Number(id)) ?? null,
    listing(runId) {
      return entries.filter((e) => e.runId === String(runId)).map((e) => ({
        id: e.id, name: e.name, expired: e.expired, digest: e.digest, size_in_bytes: 1,
        workflow_run: { id: Number(e.runId), head_sha: e.headSha },
      }));
    },
  };
}

// ── a production-shaped frontend fixture ────────────────────────────────────────

/**
 * Every file the release CLI reads at a certified commit, copied from THIS
 * repository, so the fixture's constants, environment, contracts, storage declaration
 * and hosting configuration are the real ones. The lockfile is the one stand-in: its
 * digest is recorded, its contents are never interpreted.
 */
export const FRONTEND_FILES = Object.freeze([
  'angular.json',
  'firebase.json',
  '.firebaserc',
  'src/environments/environment.uat.ts',
  'src/app/_services/checkout-coordinator.service.ts',
  'src/app/_shared/order/quote-transition.ts',
  'src/app/kitchen/services/kitchen-wire.ts',
  'src/app/_shared/order/checkout-correlation.ts',
  'src/app/_shared/order/checkout-limits.contract.json',
  'src/app/_services/checkout-record.storage.json',
  '.github/workflows/publish.yml',
  '.github/workflows/certify.yml',
]);

export function fixtureFrontend({ policy, receipts = {}, legacyWorkflow = false, files = {} } = {}) {
  const dir = initRepo(tempDir('frontend'));
  for (const rel of FRONTEND_FILES) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    cpSync(join(ROOT, rel), join(dir, rel));
  }
  cpSync(join(ROOT, 'release/lib'), join(dir, 'release/lib'), { recursive: true });
  cpSync(join(ROOT, 'release/cli.mjs'), join(dir, 'release/cli.mjs'));
  writeText(dir, 'release/policy.json', `${JSON.stringify(policy ?? JSON.parse(readFileSync(join(ROOT, 'release/policy.json'), 'utf8')), null, 2)}\n`);
  for (const [peer, list] of Object.entries(receipts)) {
    for (const receipt of list) writeText(dir, `release/peers/${peer}-${receipt.commit}.json`, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  writeText(dir, 'package-lock.json', '{"name":"release-fixture","lockfileVersion":3,"packages":{}}\n');
  if (legacyWorkflow) cpSync(join(ROOT, '.github/workflows/deploy-prod.yml'), join(dir, '.github/workflows/deploy-prod.yml'));
  for (const [rel, text] of Object.entries(files)) writeText(dir, rel, text);
  return { dir, commit: commitAll(dir, 'fixture: initial') };
}

/**
 * Build a candidate the way certify.yml does: a checkout of exactly `commit`, a build
 * output (stand-in bytes, carrying the policy's API origin so the built-bytes check has
 * something real to find), and the REAL `stamp`. Returns the artifact directory
 * (`dist/` + `provenance.json`) and its identity.
 */
export async function buildCandidate({ repo, commit, runId, runAttempt = 1, startedAt, marker = '', mutate }) {
  const parent = tempDir('build');
  const work = join(parent, 'wt');
  git(repo, ['worktree', 'add', '--detach', '-q', work, commit]);
  try {
    const policy = JSON.parse(readFileSync(join(work, 'release/policy.json'), 'utf8'));
    const tag = `${commit.slice(0, 8)} run ${runId}.${runAttempt}${marker}`;
    writeText(work, 'dist/index.html', `<!doctype html><title>fixture ${tag}</title>\n`);
    writeText(work, `dist/main-${commit.slice(0, 8)}.js`, `const api=${JSON.stringify(policy.build.expectedApiUrl)};/* ${tag} */\n`);
    writeText(work, 'dist/styles-fixture.css', `body{margin:0}/* ${tag} */\n`);
    writeText(work, 'dist/assets/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
    if (mutate) mutate(join(work, 'dist'));
    const name = `frontend-release-${runId}-${runAttempt}`;
    const r = await run(process.execPath, [
      join(work, 'release/cli.mjs'), 'stamp', '--dist', join(work, 'dist'), '--out', join(work, 'provenance.json'),
      '--commit', commit, '--ref', 'refs/heads/main', '--now', startedAt, '--runId', String(runId),
      '--runAttempt', String(runAttempt), '--runStartedAt', startedAt, '--nodeVersion', process.version,
      '--artifactName', name,
    ], { cwd: work });
    if (r.status !== 0) throw new Error(`stamp refused the fixture candidate:\n${r.stderr}`);
    const dir = tempDir('artifact');
    cpSync(join(work, 'dist'), join(dir, 'dist'), { recursive: true });
    cpSync(join(work, 'provenance.json'), join(dir, 'provenance.json'));
    const manifest = JSON.parse(readFileSync(join(dir, 'dist/release.json'), 'utf8'));
    return { name, runId: String(runId), runAttempt: String(runAttempt), commit, dir, manifest, digest: artifactDigest(dir) };
  } finally {
    git(repo, ['worktree', 'remove', '--force', work]);
  }
}
