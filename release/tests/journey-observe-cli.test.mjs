/**
 * THE JOURNEY OBSERVE COMMAND, run as a real subprocess (D16 / D08 B4, B2).
 *
 * The production command takes NO host, URL, transport or executable option. The fake
 * transport therefore enters the way a test fixture may and an operator's input cannot:
 * a preload module this suite writes to a temporary directory and hands to `node
 * --import`. It replaces `fetch` with a table of SYNTHETIC answers, and it trips on (and
 * records) any subprocess, socket or HTTP client use, so the offline mode is shown to use
 * neither. Nothing here contacts GitHub or any other origin, and no credential is used:
 * the one in the environment is a canary, and every output is searched for it.
 *
 * Every id, digest, date and byte below is synthetic; the commit and tree are the
 * approved receipts' own, because the command refuses any selection the committed policy
 * does not approve.
 */

import { strict as assert } from 'node:assert';
import {
  chmodSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { digestOf, treeDigest } from '../lib/canonical.mjs';
import { PEER_FORMATS, SELECTION_SCHEMA, backendListingDigest } from '../lib/journey-peers.mjs';
import { POLICY } from './fixtures.mjs';
import { ROOT, run, tempDir } from './harness.mjs';

const COMMAND = join(ROOT, 'release/journey-observe.mjs');
const LIB = join(ROOT, 'release/lib/journey-observation.mjs');
const API = 'https://api.github.com';
const CANARY = 'CANARY-cli-provider-body-must-never-be-printed';
const TOKEN = 'ghs_SYNTHETICcliCANARYtoken9876543210';
const clone = (v) => JSON.parse(JSON.stringify(v));
const hex = (label) => digestOf(Buffer.from(`SYNTHETIC ${label}`)).slice('sha256:'.length);

// ── the preload: a synthetic transport, and tripwires ───────────────────────────

const PRELOAD = `
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
const require = createRequire(import.meta.url);
const fixture = JSON.parse(readFileSync(process.env.JOURNEY_TEST_FIXTURE, 'utf8'));
const report = { fetches: [], blocked: [] };
const credential = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const API = ${JSON.stringify(API)};
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const auth = init.headers ? init.headers.authorization : undefined;
  report.fetches.push({
    url: u, method: init.method, redirect: init.redirect, hasSignal: init.signal instanceof AbortSignal,
    authorization: auth === undefined ? 'absent' : (credential && auth === 'Bearer ' + credential ? 'the-credential' : 'other'),
  });
  if (fixture.offline) { report.blocked.push('fetch'); throw new TypeError('no network in this test'); }
  const path = u.startsWith(API) ? u.slice(API.length) : null;
  let spec = path === null ? undefined : fixture.routes[path];
  if (Array.isArray(spec)) spec = spec.length > 1 ? spec.shift() : spec[0];
  if (spec === undefined) return new Response(JSON.stringify({ message: ${JSON.stringify(CANARY)} }), { status: 404, headers: { 'content-type': 'application/json' } });
  if (spec.pad && spec.body) {
    // Grow every listed entry by spec.pad bytes, so a listing can be made large without a
    // large fixture file.
    for (const list of Object.values(spec.body)) if (Array.isArray(list)) for (const e of list) e.padding = 'x'.repeat(spec.pad);
  }
  const body = typeof spec.raw === 'string' ? spec.raw : JSON.stringify(spec.body);
  return new Response(body, { status: spec.status || 200, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, spec.headers || {}) });
};
if (fixture.slowStdout) {
  // A reader slower than the writer: each stdout write completes only later, as a write
  // to a full pipe does. Anything still queued when the process exits is lost.
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, encoding, callback) => {
    const done = typeof encoding === 'function' ? encoding : callback;
    setTimeout(() => write(chunk, typeof encoding === 'string' ? encoding : undefined, done), 150);
    return false;
  };
}
if (fixture.failWrite) {
  // A full disk: every write to a file this process opened fails, as ENOSPC does.
  const fs = require('node:fs');
  const real = fs.writeSync;
  fs.writeSync = (fd, ...rest) => {
    if (fd > 2) { const e = new Error('no space left on device'); e.code = 'ENOSPC'; throw e; }
    return real(fd, ...rest);
  };
}
for (const [mod, names] of Object.entries({
  'node:child_process': ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'],
  'node:net': ['connect', 'createConnection'],
  'node:tls': ['connect'],
  'node:http': ['request', 'get'],
  'node:https': ['request', 'get'],
})) {
  const m = require(mod);
  for (const n of names) m[n] = () => { report.blocked.push(mod + '.' + n); throw new Error('blocked by the test'); };
}
syncBuiltinESMExports();
process.on('exit', () => writeFileSync(process.env.JOURNEY_TEST_REPORT, JSON.stringify(report)));
`;

// ── the synthetic world ─────────────────────────────────────────────────────────

const RUNS = { backend: { runId: '920000001', repoId: 830001, workflowId: 840001 }, admin: { runId: '920000002', repoId: 830002, workflowId: 840002 } };

function approved(peer) {
  const a = POLICY.compatibleSet.peers[peer].approved[0];
  return { ...a, receiptFile: join(ROOT, a.receipt), body: JSON.parse(readFileSync(join(ROOT, a.receipt), 'utf8')) };
}

function selection(peer, over = {}) {
  const f = PEER_FORMATS[peer];
  const a = approved(peer);
  return {
    schema: SELECTION_SCHEMA, peer, repository: f.repository,
    source: { commit: a.commit, tree: a.body.tree }, receipt: { commit: a.commit, digest: a.receiptDigest },
    producer: { workflowPath: f.workflowPath, event: f.event, ref: f.ref },
    run: { id: RUNS[peer].runId, attempt: '1' }, requiredJobs: [...f.requiredJobs], ...over,
  };
}

function routes(peer, archive) {
  const f = PEER_FORMATS[peer];
  const { runId, repoId, workflowId } = RUNS[peer];
  const a = approved(peer);
  const base = `/repos/${f.repository}`;
  const repoRef = { id: repoId, full_name: f.repository };
  const runDoc = {
    id: Number(runId), run_attempt: 1, workflow_id: workflowId, path: f.workflowPath, event: 'push', head_branch: 'main',
    head_sha: a.commit, status: 'completed', conclusion: 'success', updated_at: '2026-09-28T09:20:00Z', repository: repoRef, head_repository: repoRef,
  };
  const jobs = f.requiredJobs.map((name, i) => ({ id: 3000 + i, run_id: Number(runId), run_attempt: 1, head_sha: a.commit, name, status: 'completed', conclusion: 'success' }));
  const names = [`${f.candidatePrefix}-${runId}-1`, ...f.companions.map((c) => `${c.prefix}-${runId}-1`), `dependency-audit-${runId}-1`];
  const artifacts = names.map((name, i) => ({
    id: 4000 + i, name, size_in_bytes: 100, digest: i === 0 && archive ? digestOf(archive) : `sha256:${hex(name)}`, expired: false, expires_at: '2099-01-01T00:00:00Z',
    workflow_run: { id: Number(runId), repository_id: repoId, head_repository_id: repoId, head_branch: 'main', head_sha: a.commit },
  }));
  return {
    [`${base}/actions/runs/${runId}`]: [{ body: runDoc }, { body: runDoc }],
    [`${base}/actions/workflows/ci.yml`]: { body: { id: workflowId, path: f.workflowPath } },
    [`${base}/actions/runs/${runId}/attempts/1`]: { body: runDoc },
    [`${base}/git/commits/${a.commit}`]: { body: { sha: a.commit, tree: { sha: a.body.tree }, author: { name: 'Synthetic', email: 'synthetic@example.invalid' } } },
    [`${base}/actions/runs/${runId}/attempts/1/jobs?per_page=100&page=1`]: { body: { total_count: jobs.length, jobs } },
    [`${base}/actions/runs/${runId}/artifacts?per_page=100&page=1`]: { body: { total_count: artifacts.length, artifacts } },
  };
}

function record(peer) {
  const s = selection(peer);
  if (peer === 'backend') {
    const files = [{ filename: 'synthetic_pkg-1.0-py3-none-any.whl', sha256: hex('wheel'), size: 12 }];
    return {
      schema: 'dinify.backend.candidate/1', repository: s.repository, commit: s.source.commit, tree: s.source.tree,
      eligibility: { promotable: true }, artifact: { name: `backend-candidate-${s.run.id}-1` },
      ci: { repository: s.repository, event: 'push', ref: 'refs/heads/main', sha: s.source.commit, runId: s.run.id, runAttempt: '1', workflowRef: `${s.repository}/.github/workflows/ci.yml@refs/heads/main` },
      source: { tree: s.source.tree, archive: { path: 'source.tar', sha256: hex('src'), size: 1 }, contentSha256: hex('content') },
      wheelhouse: { files, digest: backendListingDigest(files) },
      inputs: { lock: { sha256: hex('lock') }, requirements: { sha256: hex('req') } },
      environment: { digest: hex('env') }, audit: { outcome: 'within_policy' },
      target: { python: '3.12.3', implementation: 'CPython', platform: 'linux', machine: 'x86_64', libc: 'glibc 2.39' },
    };
  }
  const entries = [{ path: 'index.html', sha256: hex('index'), bytes: 1 }, { path: 'release.txt', sha256: hex('release'), bytes: 41 }];
  const files = [{ path: 'audit.json', sha256: hex('audit'), bytes: 2 }];
  return {
    schema: 'dinify.admin.certification/1', repository: s.repository, commit: s.source.commit, tree: s.source.tree,
    workflow: { path: '.github/workflows/ci.yml', job: 'validate', event: 'push', gitRef: 'refs/heads/main', runId: s.run.id, runAttempt: '1' },
    payload: { entries, treeDigest: treeDigest(entries), entryCount: 2, release: { path: 'release.txt', commit: s.source.commit }, archive: { path: 'payload.tar.gz', sha256: hex('payload'), bytes: 3 } },
    evidence: { files, treeDigest: treeDigest(files) }, source: { digest: `sha256:${hex('source')}` }, audit: { outcome: 'within_policy' },
  };
}

// ── running the command ─────────────────────────────────────────────────────────

function setup(prefix) {
  const dir = tempDir(`journey-${prefix}`);
  const preload = join(dir, 'preload.mjs');
  writeFileSync(preload, PRELOAD);
  const priv = join(dir, 'private');
  mkdirSync(priv, { mode: 0o700 });
  return { dir, preload, priv, report: join(dir, 'report.json'), fixture: join(dir, 'fixture.json') };
}

async function observe(t, args, { fixture = { routes: {} }, env = {}, preload = true } = {}) {
  writeFileSync(t.fixture, JSON.stringify(fixture));
  const childEnv = {
    PATH: process.env.PATH,
    JOURNEY_TEST_FIXTURE: t.fixture,
    JOURNEY_TEST_REPORT: t.report,
    ...env,
  };
  const argv = preload ? ['--import', pathToFileURL(t.preload).href, COMMAND, ...args] : [COMMAND, ...args];
  const r = await run(process.execPath, argv, { cwd: t.dir, env: childEnv });
  const report = existsSync(t.report) ? JSON.parse(readFileSync(t.report, 'utf8')) : null;
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* asserted by the caller */ }
  return { ...r, out, report };
}

function writeSelection(t, peer, over) {
  const path = join(t.dir, `selection-${peer}.json`);
  writeFileSync(path, JSON.stringify(selection(peer, over)));
  return path;
}

const collectArgs = (t, peer, { out = join(t.priv, `${peer}.observations.json`), selectionPath } = {}) => [
  'collect', '--selection', selectionPath ?? writeSelection(t, peer), '--receipt', approved(peer).receiptFile, ...(out ? ['--observations-out', out] : []),
];

const leakFree = (r, label) => {
  for (const [name, text] of [['stdout', r.stdout], ['stderr', r.stderr]]) {
    assert.ok(!text.includes(TOKEN), `${label}: the credential reached ${name}`);
    assert.ok(!text.includes(CANARY), `${label}: a provider body reached ${name}`);
  }
};

// ── collect ─────────────────────────────────────────────────────────────────────

describe('journey-observe collect', () => {
  for (const peer of ['backend', 'admin']) {
    test(`CONTRACT (${peer}): exit 3 and metadata-only; every read a GET to the API with the credential, the raw documents only in a new 0600 file`, async () => {
      const t = setup(`collect-${peer}`);
      const out = join(t.priv, `${peer}.observations.json`);
      const r = await observe(t, collectArgs(t, peer, { out }), { fixture: { routes: routes(peer) }, env: { GH_TOKEN: TOKEN } });
      assert.equal(r.status, 3, r.stderr);
      assert.equal(r.stderr, 'journey-observe: metadata-only\n');
      assert.equal(r.out.outcome, 'metadata-only');
      assert.equal(r.out.status, 'metadata-consistent-bytes-not-established');
      assert.equal(r.out.descriptorDigest, null);
      assert.deepEqual(r.out.deferred, [...PEER_FORMATS[peer].deferred]);
      assert.equal(r.report.fetches.length, 7);
      for (const f of r.report.fetches) {
        assert.ok(f.url.startsWith(`${API}/repos/${PEER_FORMATS[peer].repository}/`), f.url);
        assert.equal(f.method, 'GET');
        assert.equal(f.redirect, 'error');
        assert.equal(f.hasSignal, true);
        assert.equal(f.authorization, 'the-credential');
      }
      assert.deepEqual(r.report.blocked, [], 'no subprocess, socket or HTTP client was used');
      assert.equal(statSync(out).mode & 0o777, 0o600);
      const saved = readFileSync(out, 'utf8');
      assert.equal(JSON.parse(saved).schema, 'dinify.journey.peer-observations/1');
      assert.ok(!saved.includes(TOKEN));
      assert.ok(!r.stdout.includes('synthetic@example.invalid'), 'raw documents (author e-mail included) stay out of the printed summary');
      assert.ok(!r.stdout.includes(t.dir), 'no local path is printed');
      leakFree(r, peer);
    });
  }

  test('CONTRACT: GITHUB_TOKEN is used when GH_TOKEN is absent; with neither, no authorization header is sent', async () => {
    let t = setup('token-github');
    let r = await observe(t, collectArgs(t, 'admin', { out: null }), { fixture: { routes: routes('admin') }, env: { GITHUB_TOKEN: TOKEN } });
    assert.equal(r.status, 3, r.stderr);
    assert.ok(r.report.fetches.every((f) => f.authorization === 'the-credential'));
    t = setup('token-none');
    r = await observe(t, collectArgs(t, 'admin', { out: null }), { fixture: { routes: routes('admin') } });
    assert.equal(r.status, 3, r.stderr);
    assert.ok(r.report.fetches.every((f) => f.authorization === 'absent'));
    assert.equal(r.out.collection.credentialAttached, false);
  });

  test('REGRESSION: a refused selection is exit 1 with B1\'s code; the complete collection is still saved for diagnosis', async () => {
    const t = setup('refused-job');
    const fixture = { routes: routes('backend') };
    const key = Object.keys(fixture.routes).find((k) => k.includes('/jobs?'));
    fixture.routes[key].body.jobs[1].conclusion = 'failure';
    const out = join(t.priv, 'refused.json');
    const r = await observe(t, collectArgs(t, 'backend', { out }), { fixture, env: { GH_TOKEN: TOKEN } });
    assert.equal(r.status, 1);
    assert.equal(r.stderr, 'journey-observe: refused\n');
    assert.deepEqual(r.out.reasons.map((x) => x.code), ['journey.peers.job_not_successful']);
    assert.equal(r.out.level, null);
    assert.ok(existsSync(out));
  });

  test('REGRESSION: a rate-limited read is exit 1, named, its body never printed, and no partial file is left behind', async () => {
    const t = setup('rate');
    const fixture = { routes: routes('backend') };
    const key = Object.keys(fixture.routes).find((k) => k.endsWith('/attempts/1'));
    fixture.routes[key] = { status: 403, body: { message: CANARY }, headers: { 'x-ratelimit-remaining': '0' } };
    const out = join(t.priv, 'rate.json');
    const r = await observe(t, collectArgs(t, 'backend', { out }), { fixture, env: { GH_TOKEN: TOKEN } });
    assert.equal(r.status, 1);
    assert.deepEqual(r.out.reasons.map((x) => x.code), ['journey.observe.rate_limited']);
    assert.ok(!existsSync(out), 'the reserved file is removed when nothing complete was collected');
    leakFree(r, 'rate limit');
  });

  test('REGRESSION: the run changing during collection is exit 1 run_changed_during_collection', async () => {
    const t = setup('changed');
    const fixture = { routes: routes('backend') };
    const key = Object.keys(fixture.routes).find((k) => /\/runs\/[0-9]+$/.test(k));
    fixture.routes[key][1] = { body: { ...fixture.routes[key][0].body, run_attempt: 2, status: 'queued', conclusion: null } };
    const r = await observe(t, collectArgs(t, 'backend', { out: null }), { fixture });
    assert.equal(r.status, 1);
    assert.deepEqual(r.out.reasons.map((x) => x.code), ['journey.observe.run_changed_during_collection']);
  });

  test('REGRESSION: a stable current run that contradicts the selected attempt is exit 1 run_contradicts_attempt, and no file is left behind', async () => {
    const t = setup('contradicts');
    const fixture = { routes: routes('backend') };
    const key = Object.keys(fixture.routes).find((k) => /\/runs\/[0-9]+$/.test(k));
    const current = { ...fixture.routes[key][0].body, conclusion: 'failure' };
    fixture.routes[key] = [{ body: current }, { body: current }];
    const out = join(t.priv, 'contradicts.json');
    const r = await observe(t, collectArgs(t, 'backend', { out }), { fixture });
    assert.equal(r.status, 1, r.stderr);
    assert.equal(r.stderr, 'journey-observe: refused\n');
    assert.deepEqual(r.out.reasons.map((x) => x.code), ['journey.observe.run_contradicts_attempt']);
    assert.ok(!existsSync(out));
  });

  test('REGRESSION: a selection with a malformed NESTED value is exit 1 selection_invalid in both modes — a structured refusal, not an internal error — and no request, nothing reserved', async () => {
    for (const [label, over] of Object.entries({ 'source null': { source: null }, 'run null': { run: null }, 'receipt null': { receipt: null } })) {
      const t = setup(`nested-${label.replace(/ /g, '-')}`);
      const sel = writeSelection(t, 'backend', over);
      const out = join(t.priv, 'nested.json');
      const collected = await observe(t, collectArgs(t, 'backend', { out, selectionPath: sel }), { fixture: { routes: routes('backend') } });
      const offline = await observe(t, [
        'bytes', '--selection', sel, '--receipt', approved('backend').receiptFile, '--observations', sel, '--archive', sel, '--record', sel,
      ], { fixture: { offline: true, routes: {} } });
      for (const [mode, r] of [['collect', collected], ['bytes', offline]]) {
        assert.equal(r.status, 1, `${label} (${mode}): ${r.stderr}`);
        assert.equal(r.stderr, 'journey-observe: refused\n', `${label} (${mode})`);
        assert.ok(r.out, `${label} (${mode}): stdout is one JSON document`);
        assert.deepEqual([...new Set(r.out.reasons.map((x) => x.code))], ['journey.observe.selection_invalid'], `${label} (${mode})`);
        assert.equal(r.out.source, null, `${label} (${mode})`);
        assert.deepEqual(r.report.fetches, [], `${label} (${mode}): no request`);
      }
      assert.ok(!existsSync(out), `${label}: the reserved file is removed`);
    }
  });

  test('REGRESSION: observations larger than bytes mode will read are refused before they are written — nothing is kept at the destination', async () => {
    // 1000 jobs and 1000 artifacts over ten full pages each, every page just under the
    // 4 MiB answer bound: a complete collection of about 80 MB, above the 64 MiB that
    // bytes mode accepts as saved observations.
    const t = setup('too-large');
    const peer = 'backend';
    const f = PEER_FORMATS[peer];
    const { runId, repoId } = RUNS[peer];
    const a = approved(peer);
    const base = `/repos/${f.repository}`;
    const fixture = { routes: routes(peer) };
    const jobsKey = (n) => `${base}/actions/runs/${runId}/attempts/1/jobs?per_page=100&page=${n}`;
    const artifactsKey = (n) => `${base}/actions/runs/${runId}/artifacts?per_page=100&page=${n}`;
    const firstJobs = fixture.routes[jobsKey(1)].body.jobs;
    const firstArtifacts = fixture.routes[artifactsKey(1)].body.artifacts;
    const jobs = [...firstJobs, ...Array.from({ length: 1000 - firstJobs.length }, (_, i) => ({
      id: 50000 + i, run_id: Number(runId), run_attempt: 1, head_sha: a.commit, name: `filler ${i}`, status: 'completed', conclusion: 'success',
    }))];
    const artifacts = [...firstArtifacts, ...Array.from({ length: 1000 - firstArtifacts.length }, (_, i) => ({
      id: 90000 + i, name: `filler-${i}`, size_in_bytes: 1, digest: `sha256:${hex(`filler ${i}`)}`, expired: false, expires_at: '2099-01-01T00:00:00Z',
      workflow_run: { id: Number(runId), repository_id: repoId, head_repository_id: repoId, head_branch: 'main', head_sha: a.commit },
    }))];
    for (let n = 1; n <= 10; n += 1) {
      fixture.routes[jobsKey(n)] = { pad: 40000, body: { total_count: 1000, jobs: jobs.slice((n - 1) * 100, n * 100) } };
      fixture.routes[artifactsKey(n)] = { pad: 40000, body: { total_count: 1000, artifacts: artifacts.slice((n - 1) * 100, n * 100) } };
    }
    const out = join(t.priv, 'large.json');
    const r = await observe(t, collectArgs(t, peer, { out }), { fixture });
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(r.out.reasons.map((x) => x.code), ['journey.observe.observations_too_large']);
    assert.ok(!existsSync(out), 'nothing unusable is left at the destination');
    assert.equal(r.report.fetches.length, 25, 'the collection itself completed');
    // CONTROL: the same collection without an output file is not refused for its size.
    const c = await observe(t, collectArgs(t, peer, { out: null }), { fixture });
    assert.ok(c.out && !c.out.reasons.some((x) => x.code === 'journey.observe.observations_too_large'), c.stderr);
  });

  test('REGRESSION: a write that fails (a full disk) is exit 1 observations_unwritable, the reserved file is removed, and the same destination works on retry', async () => {
    const t = setup('unwritable');
    const out = join(t.priv, 'admin.json');
    const r = await observe(t, collectArgs(t, 'admin', { out }), { fixture: { routes: routes('admin'), failWrite: true } });
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.out, 'a structured answer, not an internal error');
    assert.deepEqual(r.out.reasons.map((x) => x.code), ['journey.observe.observations_unwritable']);
    assert.ok(!existsSync(out), 'the partly written file is removed');
    assert.ok(!r.stdout.includes(t.dir), 'no local path is printed');
    const retry = await observe(t, collectArgs(t, 'admin', { out }), { fixture: { routes: routes('admin') } });
    assert.equal(retry.status, 3, retry.stderr);
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).schema, 'dinify.journey.peer-observations/1');
  });

  test('REGRESSION: the replaced backend a6b25a6 is refused before any request — the selection is never moved to what is approved', async () => {
    const t = setup('old');
    const old = JSON.parse(readFileSync(join(ROOT, 'release/peers/backend-a6b25a619d572c8de68964ab9ca4b4c2ae9ebe0b.json'), 'utf8'));
    const sel = writeSelection(t, 'backend', {
      source: { commit: old.commit, tree: old.tree },
      receipt: { commit: old.commit, digest: 'sha256:c1355f5059f24506e9637ad29c24e4782a71275bfa5a0b18a80ed07cc5d3b920' },
    });
    const r = await observe(t, ['collect', '--selection', sel, '--receipt', join(ROOT, 'release/peers/backend-a6b25a619d572c8de68964ab9ca4b4c2ae9ebe0b.json')], { fixture: { routes: routes('backend') } });
    assert.equal(r.status, 1);
    assert.deepEqual(r.out.reasons.map((x) => x.code), ['journey.observe.selection_not_approved']);
    assert.equal(r.report.fetches.length, 0);
  });
});

// ── a slow reader ───────────────────────────────────────────────────────────────

describe('journey-observe output reaches a slow reader', () => {
  test('REGRESSION: when every stdout write completes only later, the whole JSON document still arrives and the exit status is kept — metadata-only (3), refused (1), usage (2)', async () => {
    const cases = [
      ['metadata-only', 3, (t) => collectArgs(t, 'admin', { out: null }), { routes: routes('admin') }],
      ['refused', 1, (t) => collectArgs(t, 'backend', { out: null, selectionPath: writeSelection(t, 'backend', { run: null }) }), { routes: routes('backend') }],
      ['usage', 2, (t) => [...collectArgs(t, 'admin', { out: null }), '--url', 'x'], { routes: routes('admin') }],
    ];
    for (const [outcome, status, argsFor, fixture] of cases) {
      const t = setup(`slow-${outcome}`);
      const r = await observe(t, argsFor(t), { fixture: { ...fixture, slowStdout: true } });
      assert.equal(r.status, status, `${outcome}: ${r.stderr}`);
      assert.ok(r.out, `${outcome}: stdout is one complete JSON document (${r.stdout.length} bytes arrived)`);
      assert.equal(r.out.outcome, outcome);
      assert.match(r.stderr, new RegExp(`^journey-observe: ${outcome}`), outcome);
    }
  });
});

// ── usage: what the command does not take ───────────────────────────────────────

describe('journey-observe usage', () => {
  test('REGRESSION: there is no host, URL, transport, executable, clock, policy or credential option — each is a usage error before any request', async () => {
    for (const option of ['--api-host', '--url', '--transport', '--gh', '--now', '--policy', '--token', '--insecure']) {
      const t = setup(`usage${option.replace(/-/g, '_')}`);
      const r = await observe(t, [...collectArgs(t, 'backend', { out: null }), option, 'https://evil.example'], { fixture: { routes: routes('backend') } });
      assert.equal(r.status, 2, option);
      assert.equal(r.out.outcome, 'usage');
      assert.equal(r.report.fetches.length, 0, `${option}: no request`);
      assert.ok(!r.stdout.includes('evil.example'), 'the value of an unknown option is never echoed');
    }
  });

  test('REGRESSION: a malformed command line is a usage error — no mode, another mode, a missing or doubled option', async () => {
    const t = setup('usage-shape');
    const sel = writeSelection(t, 'backend');
    for (const args of [[], ['verify'], ['collect'], ['collect', '--selection', sel], ['collect', '--selection', sel, '--selection', sel, '--receipt', 'x'], ['bytes', '--selection', sel]]) {
      const r = await observe(t, args);
      assert.equal(r.status, 2, JSON.stringify(args));
      assert.equal(r.out.outcome, 'usage');
    }
  });

  test('REGRESSION: the observations file must be NEW and PRIVATE — checked before any request, and an existing file is never touched', async () => {
    const t = setup('private');
    const open = join(t.dir, 'open');
    mkdirSync(open, { mode: 0o755 });
    chmodSync(open, 0o755);
    let r = await observe(t, collectArgs(t, 'backend', { out: join(open, 'x.json') }), { fixture: { routes: routes('backend') } });
    assert.equal(r.status, 2);
    assert.match(r.out.reasons[0].detail, /mode 0700/);
    assert.equal(r.report.fetches.length, 0);
    const existing = join(t.priv, 'existing.json');
    writeFileSync(existing, 'KEEP');
    r = await observe(t, collectArgs(t, 'backend', { out: existing }), { fixture: { routes: routes('backend') } });
    assert.equal(r.status, 2);
    assert.equal(r.report.fetches.length, 0);
    assert.equal(readFileSync(existing, 'utf8'), 'KEEP');
  });
});

// ── bytes, offline ──────────────────────────────────────────────────────────────

describe('journey-observe bytes (offline)', () => {
  async function prepared(peer, prefix) {
    const t = setup(prefix);
    const archive = Buffer.from(`#!/bin/sh\ntouch ${join(t.dir, 'EXECUTED')}\n# SYNTHETIC ${peer} archive: never extracted, never run\n`);
    const saved = join(t.priv, `${peer}.observations.json`);
    const c = await observe(t, collectArgs(t, peer, { out: saved }), { fixture: { routes: routes(peer, archive) } });
    assert.equal(c.status, 3, c.stderr);
    const archivePath = join(t.priv, 'candidate.zip');
    writeFileSync(archivePath, archive);
    chmodSync(archivePath, 0o755);
    const recordPath = join(t.priv, PEER_FORMATS[peer].recordFile);
    writeFileSync(recordPath, JSON.stringify(record(peer)));
    const args = (over = {}) => {
      const a = { selection: join(t.dir, `selection-${peer}.json`), receipt: approved(peer).receiptFile, observations: saved, archive: archivePath, record: recordPath, ...over };
      return ['bytes', ...Object.entries(a).flatMap(([k, v]) => [`--${k}`, v])];
    };
    return { t, args, archive, archivePath, recordPath };
  }

  for (const peer of ['backend', 'admin']) {
    test(`CONTRACT (${peer}): exit 0 — bytes correspond, consumer checks deferred — with no network, no subprocess, and nothing it read executed`, async () => {
      const { t, args } = await prepared(peer, `bytes-${peer}`);
      const r = await observe(t, args(), { fixture: { offline: true, routes: {} }, env: { GH_TOKEN: TOKEN } });
      assert.equal(r.status, 0, r.stdout);
      assert.equal(r.stderr, 'journey-observe: bytes-correspond-consumer-checks-deferred\n');
      assert.equal(r.out.level, 'bytes');
      assert.deepEqual(r.out.deferred, [...PEER_FORMATS[peer].deferred]);
      assert.match(r.out.descriptorDigest, /^sha256:[0-9a-f]{64}$/);
      assert.deepEqual(r.report.fetches, [], 'the offline mode made no request');
      assert.deepEqual(r.report.blocked, [], 'no subprocess, socket or HTTP client was even attempted');
      assert.ok(!existsSync(join(t.dir, 'EXECUTED')), 'the archive was not executed');
      assert.ok(!r.stdout.includes(t.dir));
      leakFree(r, peer);
    });
  }

  test('REGRESSION: a slow reader still receives the whole bytes answer, and the status is still 0', async () => {
    const { t, args } = await prepared('admin', 'bytes-slow');
    const r = await observe(t, args(), { fixture: { offline: true, routes: {}, slowStdout: true } });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.out, `stdout is one complete JSON document (${r.stdout.length} bytes arrived)`);
    assert.equal(r.out.outcome, 'bytes-correspond-consumer-checks-deferred');
    assert.deepEqual(r.report.fetches, []);
  });

  test('REGRESSION: a tampered archive is exit 1 archive_digest_mismatch', async () => {
    const { t, args, archive, archivePath } = await prepared('backend', 'bytes-tamper');
    const tampered = Buffer.from(archive);
    tampered[tampered.length - 2] ^= 1;
    writeFileSync(archivePath, tampered);
    const r = await observe(t, args(), { fixture: { offline: true, routes: {} } });
    assert.equal(r.status, 1);
    assert.deepEqual(r.out.reasons.map((x) => x.code), ['journey.peers.archive_digest_mismatch']);
  });

  test('REGRESSION: an absent, oversized or non-regular byte input is refused by name — never answered from metadata', async () => {
    const { t, args, recordPath, archivePath } = await prepared('backend', 'bytes-inputs');
    const big = join(t.priv, 'big-record.json');
    writeFileSync(big, Buffer.alloc(1024 * 1024 + 1, 0x20));
    const link = join(t.priv, 'link.zip');
    symlinkSync(archivePath, link);
    for (const [label, over, code] of [
      ['an absent archive', { archive: join(t.priv, 'absent.zip') }, 'journey.observe.bytes_input_missing'],
      ['an absent record', { record: join(t.priv, 'absent.json') }, 'journey.observe.bytes_input_missing'],
      ['an oversized record', { record: big }, 'journey.observe.bytes_input_too_large'],
      ['a symbolic link', { archive: link }, 'journey.observe.bytes_input_not_regular'],
      ['a directory', { record: t.priv }, 'journey.observe.bytes_input_not_regular'],
    ]) {
      const r = await observe(t, args(over), { fixture: { offline: true, routes: {} } });
      assert.equal(r.status, 1, label);
      assert.deepEqual(r.out.reasons.map((x) => x.code), [code], label);
      assert.equal(r.out.outcome, 'refused', label);
      assert.notEqual(r.out.level, 'metadata', `${label}: no metadata fall back`);
      assert.deepEqual(r.report.fetches, [], label);
    }
    assert.ok(existsSync(recordPath));
  });

  test('REGRESSION: saved observations bound to another selection are exit 1 observations_foreign', async () => {
    const { t, args } = await prepared('backend', 'bytes-foreign');
    const other = writeSelection(t, 'backend', { run: { id: '920000009', attempt: '1' } });
    const r = await observe(t, args({ selection: other }), { fixture: { offline: true, routes: {} } });
    assert.equal(r.status, 1);
    assert.deepEqual(r.out.reasons.map((x) => x.code), ['journey.observe.observations_foreign']);
  });
});

describe('the tripwires themselves', () => {
  test('CONTROL: a script that DOES spawn, open a socket or fetch under the same preload is caught — so an empty record above is evidence, not a blind spot', async () => {
    const t = setup('tripwire');
    const probe = join(t.dir, 'probe.mjs');
    writeFileSync(probe, [
      "import { spawnSync } from 'node:child_process';",
      "import https from 'node:https';",
      "import { connect } from 'node:net';",
      "try { spawnSync('true'); } catch {}",
      "try { https.get('https://example.invalid/'); } catch {}",
      "try { connect(443, 'example.invalid'); } catch {}",
      "try { await fetch('https://api.github.com/repos/x/y'); } catch {}",
    ].join('\n'));
    writeFileSync(t.fixture, JSON.stringify({ offline: true, routes: {} }));
    const r = await run(process.execPath, ['--import', pathToFileURL(t.preload).href, probe], {
      cwd: t.dir, env: { PATH: process.env.PATH, JOURNEY_TEST_FIXTURE: t.fixture, JOURNEY_TEST_REPORT: t.report },
    });
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(readFileSync(t.report, 'utf8'));
    assert.deepEqual(report.blocked.sort(), ['fetch', 'node:child_process.spawnSync', 'node:https.get', 'node:net.connect'].sort());
  });
});

// ── what the command is built from ──────────────────────────────────────────────

describe('journey-observe imports', () => {
  test('CONTRACT: the command and its adapter import no subprocess, socket or HTTP module and not the existing ghApi helper — the one network client is the fetch they are handed', () => {
    const importsOf = (file) => [...readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\s[^;]*?from\s+'([^']+)'/gms)].map((m) => m[1]);
    assert.deepEqual(importsOf(COMMAND).sort(), ['./lib/journey-observation.mjs', './lib/journey-peers.mjs', 'node:fs', 'node:path', 'node:url'].sort());
    assert.deepEqual(importsOf(LIB).sort(), ['./canonical.mjs', './journey-peers.mjs', './peers.mjs'].sort());
    for (const file of [COMMAND, LIB]) {
      const text = readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /child_process|node:https?['/]|node:net|node:tls|ghApi|\bio\.mjs\b|\beval\s*\(|new Function/, file);
    }
  });
});
