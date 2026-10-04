/**
 * JOURNEY OBSERVATION (D16 / D08 B4, B2): the metadata collector and the offline bytes
 * mode, driven through an INJECTED fake transport.
 *
 * EVERY NETWORK FIXTURE HERE IS SYNTHETIC. The documents mirror the SHAPE GitHub's API
 * answers for each peer's certifying run (field names read, values not kept, from
 * Dinify-Backend run 36456818598 and Dinify-Admin run 36359784403), but every run, job and
 * artifact id, digest, name, date and byte is made up. The source commit and tree are the
 * approved receipts' own, because the collector refuses any selection the committed policy
 * does not approve. Nothing here contacts GitHub or any origin: the transport is a
 * function passed in, and it answers only from the table below.
 *
 * Expected refusals are written out as literal codes per case, not derived from the code.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { digestOf, digestOfValue, treeDigest } from '../lib/canonical.mjs';
import {
  API_ORIGIN, OUTCOMES, ROUTE_RE, SAVED_SCHEMA, approvalProblem, exitFor, observeBytes,
  observeMetadata, planRequests, readRoute, readSaved,
} from '../lib/journey-observation.mjs';
import { PEER_FORMATS, SELECTION_SCHEMA, backendListingDigest, peerDescriptorDigest } from '../lib/journey-peers.mjs';
import { POLICY } from './fixtures.mjs';
import { ROOT } from './harness.mjs';

const CANARY = 'CANARY-7f3e-provider-body-must-never-be-printed';
const TOKEN = 'ghs_SYNTHETICcanaryTOKENvalue0123456789';
const NOW_MS = Date.parse('2026-09-28T12:00:00Z');
const clone = (v) => JSON.parse(JSON.stringify(v));
const hex = (label) => digestOf(Buffer.from(`SYNTHETIC ${label}`)).slice('sha256:'.length);
const codes = (r) => r.reasons.map((x) => x.code);

// ── the approved selections, and a synthetic world for each ─────────────────────

function approved(peer) {
  const a = POLICY.compatibleSet.peers[peer].approved[0];
  const receipt = JSON.parse(readFileSync(join(ROOT, a.receipt), 'utf8'));
  return { commit: a.commit, digest: a.receiptDigest, receipt };
}

const PEERS = {
  backend: { runId: '910000001', attempt: '1', repoId: 810001, workflowId: 820001, others: ['dependency-audit-3.12.3-910000001-1'] },
  admin: { runId: '910000002', attempt: '1', repoId: 810002, workflowId: 820002, others: ['dependency-audit-910000002-1'] },
};

function selection(peer, over = {}) {
  const format = PEER_FORMATS[peer];
  const a = approved(peer);
  return {
    schema: SELECTION_SCHEMA,
    peer,
    repository: format.repository,
    source: { commit: a.commit, tree: a.receipt.tree },
    receipt: { commit: a.commit, digest: a.digest },
    producer: { workflowPath: format.workflowPath, event: format.event, ref: format.ref },
    run: { id: PEERS[peer].runId, attempt: PEERS[peer].attempt },
    requiredJobs: [...format.requiredJobs],
    ...over,
  };
}

/** The API's documents for one peer, keyed by path. Each entry may be a list (served in turn). */
function world(peer) {
  const format = PEER_FORMATS[peer];
  const p = PEERS[peer];
  const a = approved(peer);
  const repo = format.repository;
  const repoRef = { id: p.repoId, full_name: repo, name: repo.split('/')[1] };
  const runDoc = {
    id: Number(p.runId), name: 'CI', run_attempt: Number(p.attempt), run_number: 412, workflow_id: p.workflowId,
    path: format.workflowPath, event: 'push', head_branch: 'main', head_sha: a.commit, status: 'completed', conclusion: 'success',
    created_at: '2026-09-28T09:00:00Z', updated_at: '2026-09-28T09:20:00Z', run_started_at: '2026-09-28T09:00:00Z',
    repository: repoRef, head_repository: repoRef,
    logs_url: `${API_ORIGIN}/repos/${repo}/actions/runs/${p.runId}/logs`,
    artifacts_url: `${API_ORIGIN}/repos/${repo}/actions/runs/${p.runId}/artifacts`,
  };
  const jobs = format.requiredJobs.map((name, i) => ({
    id: Number(`7${p.runId}${i}`), run_id: Number(p.runId), run_attempt: Number(p.attempt), head_sha: a.commit, head_branch: 'main',
    name, status: 'completed', conclusion: 'success', workflow_name: 'CI', labels: ['ubuntu-24.04'],
    steps: [{ name: 'Set up job', status: 'completed', conclusion: 'success', number: 1 }],
  }));
  const artifact = (name, i) => ({
    id: Number(`6${p.runId}${i}`), name, size_in_bytes: 1000 + i, digest: `sha256:${hex(`${peer} ${name}`)}`,
    expired: false, expires_at: '2099-10-28T17:31:23Z', created_at: '2026-09-28T09:15:00Z', updated_at: '2026-09-28T09:15:00Z',
    archive_download_url: `${API_ORIGIN}/repos/${repo}/actions/artifacts/${Number(`6${p.runId}${i}`)}/zip`,
    workflow_run: { id: Number(p.runId), repository_id: p.repoId, head_repository_id: p.repoId, head_branch: 'main', head_sha: a.commit },
  });
  const names = [
    `${format.candidatePrefix}-${p.runId}-${p.attempt}`,
    ...format.companions.map((c) => `${c.prefix}-${p.runId}-${p.attempt}`),
    ...p.others,
  ];
  const plan = planRequests(selection(peer)).plan;
  return {
    plan,
    docs: {
      run: runDoc,
      jobs,
      artifacts: names.map(artifact),
    },
    routes: {
      [plan.latestRun]: [{ body: runDoc }, { body: runDoc }],
      [plan.workflow]: { body: { id: p.workflowId, name: 'CI', path: format.workflowPath, state: 'active' } },
      [plan.run]: { body: runDoc },
      [plan.commit]: { body: {
        sha: a.commit, tree: { sha: a.receipt.tree, url: `${API_ORIGIN}/repos/${repo}/git/trees/${a.receipt.tree}` },
        author: { name: 'Synthetic Author', email: 'synthetic@example.invalid', date: '2026-09-28T08:59:00Z' },
        message: 'synthetic', parents: [], verification: { verified: false, reason: 'unsigned', signature: null, payload: null },
      } },
      [plan.jobsPage(1)]: { body: { total_count: jobs.length, jobs } },
      [plan.artifactsPage(1)]: { body: { total_count: names.length, artifacts: names.map(artifact) } },
    },
  };
}

/** A transport that answers from `routes` only and records what it was asked. */
function fakeFetch(routes, log = []) {
  const table = clone(routes);
  return async (url, init = {}) => {
    log.push({ url: String(url), method: init.method, headers: { ...init.headers }, redirect: init.redirect, signal: init.signal });
    const path = String(url).startsWith(API_ORIGIN) ? String(url).slice(API_ORIGIN.length) : null;
    let spec = path === null ? undefined : table[path];
    if (Array.isArray(spec)) spec = spec.length > 1 ? spec.shift() : spec[0];
    if (spec === undefined) return new Response(`{"message":"${CANARY} unrouted"}`, { status: 404, headers: { 'content-type': 'application/json' } });
    if (spec.throw) {
      const e = new Error(`${CANARY} ${spec.throw}`);
      e.name = spec.throw;
      throw e;
    }
    const body = typeof spec.raw === 'string' ? spec.raw : JSON.stringify(spec.body);
    return new Response(body, { status: spec.status ?? 200, headers: { 'content-type': 'application/json; charset=utf-8', ...(spec.headers ?? {}) } });
  };
}

async function metadata(peer, { mutate, token = TOKEN, expected = selection(peer), clock } = {}) {
  const w = world(peer);
  if (mutate) mutate(w.routes, w);
  const log = [];
  const r = await observeMetadata({
    expected, receipt: approved(peer).receipt, policy: POLICY, fetchImpl: fakeFetch(w.routes, log), token,
    clock: clock ?? (() => NOW_MS),
  });
  return { ...r, log, w };
}

function keysDeep(v, out = new Set()) {
  if (Array.isArray(v)) for (const x of v) keysDeep(x, out);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out); }
  return out;
}
const noLeak = (r, label = '') => {
  const text = JSON.stringify(r);
  assert.ok(!text.includes(CANARY), `${label}: a provider body or exception text reached the result`);
  assert.ok(!text.includes(TOKEN), `${label}: the credential reached the result`);
};

// ── planning ────────────────────────────────────────────────────────────────────

describe('planning the reads', () => {
  test('CONTRACT: each peer\'s plan is exactly the reviewed GET routes, built from the reviewed format and the validated selection', () => {
    for (const peer of ['backend', 'admin']) {
      const s = selection(peer);
      const { plan, problems } = planRequests(s);
      assert.deepEqual(problems, []);
      const base = `/repos/${PEER_FORMATS[peer].repository}`;
      assert.equal(plan.workflow, `${base}/actions/workflows/ci.yml`);
      assert.equal(plan.run, `${base}/actions/runs/${s.run.id}/attempts/${s.run.attempt}`);
      assert.equal(plan.latestRun, `${base}/actions/runs/${s.run.id}`);
      assert.equal(plan.commit, `${base}/git/commits/${s.source.commit}`);
      assert.equal(plan.jobsPage(2), `${base}/actions/runs/${s.run.id}/attempts/${s.run.attempt}/jobs?per_page=100&page=2`);
      assert.equal(plan.artifactsPage(1), `${base}/actions/runs/${s.run.id}/artifacts?per_page=100&page=1`);
      for (const path of [plan.workflow, plan.run, plan.latestRun, plan.commit, plan.jobsPage(10), plan.artifactsPage(10)]) assert.match(path, ROUTE_RE);
    }
  });

  test('REGRESSION: the route grammar refuses every other path — downloads, logs, other hosts, other query strings, page 11', () => {
    for (const path of [
      '/repos/mugak1/Dinify-Backend/actions/artifacts/1/zip',
      '/repos/mugak1/Dinify-Backend/actions/runs/1/logs',
      '/repos/mugak1/Dinify-Backend/actions/runs/1/attempts/1/logs',
      '/repos/mugak1/Dinify-Backend/actions/runs/1/jobs?per_page=100&page=1',
      '/repos/mugak1/Dinify-Backend/actions/runs/1/artifacts?per_page=1000&page=1',
      '/repos/mugak1/Dinify-Backend/actions/runs/1/artifacts?per_page=100&page=11',
      '/repos/mugak1/Dinify-Backend/actions/runs/1/artifacts?per_page=100&page=1&name=x',
      '//evil.example/repos/a/b/git/commits/' + 'a'.repeat(40),
      '/repos/mugak1/Dinify-Backend/git/commits/0513adb',
      '/repos/mugak1/Dinify-Backend/contents/release/policy.json',
      'https://api.github.com/repos/mugak1/Dinify-Backend/actions/runs/1',
    ]) assert.doesNotMatch(path, ROUTE_RE, path);
  });

  test('REGRESSION: the single bounded GET refuses any path outside the reviewed routes WITHOUT a request — even when handed one directly', async () => {
    for (const path of [
      '/repos/mugak1/Dinify-Backend/actions/artifacts/1/zip',
      '/repos/mugak1/Dinify-Backend/actions/runs/1/logs',
      '@evil.example/repos/mugak1/Dinify-Backend/actions/runs/1',
      '.evil.example/repos/mugak1/Dinify-Backend/actions/runs/1',
      '/repos/mugak1/Dinify-Backend/actions/runs/1?redirect=https://evil.example',
    ]) {
      const log = [];
      const r = await readRoute(path, { fetchImpl: fakeFetch({}, log), token: TOKEN, clock: () => NOW_MS });
      assert.equal(r.ok, false, path);
      assert.equal(r.reason.code, 'journey.observe.route_refused', path);
      assert.equal(log.length, 0, `${path}: no request`);
    }
    const log = [];
    const w = world('admin');
    const ok = await readRoute(w.plan.workflow, { fetchImpl: fakeFetch(w.routes, log), token: TOKEN, clock: () => NOW_MS });
    assert.equal(ok.ok, true);
    assert.equal(ok.value.path, '.github/workflows/ci.yml');
    assert.deepEqual(log.map((c) => c.url), [`${API_ORIGIN}${w.plan.workflow}`]);
  });

  test('REGRESSION: a selection B1 refuses plans nothing and issues NO request — a path-shaped run id, "latest", a pull-request producer, another repository, an unknown key', async () => {
    const bad = {
      'a path-shaped run id': selection('backend', { run: { id: '1/../../x', attempt: '1' } }),
      'attempt "latest"': selection('backend', { run: { id: '910000001', attempt: 'latest' } }),
      'a numeric run id': selection('backend', { run: { id: 910000001, attempt: '1' } }),
      'a pull-request producer': selection('backend', { producer: { workflowPath: '.github/workflows/ci.yml', event: 'pull_request', ref: 'refs/heads/main' } }),
      'another repository': selection('backend', { repository: 'someone/Dinify-Backend' }),
      'an unknown key': { ...selection('backend'), verified: true },
      'a required job omitted': selection('backend', { requiredJobs: ['suite (3.12.3)', 'test'] }),
    };
    for (const [label, expected] of Object.entries(bad)) {
      assert.equal(planRequests(expected).plan, null, label);
      const { result, log } = await metadata('backend', { expected });
      assert.equal(log.length, 0, `${label}: no request`);
      assert.deepEqual([...new Set(codes(result))], ['journey.observe.selection_invalid'], label);
      assert.equal(result.outcome, 'refused');
    }
  });

  test('REGRESSION: a recognised peer with a malformed NESTED value (source, run or receipt null, a string or a list) is a structured selection_invalid refusal in both modes — never a crash while the refusal is built, and no request', async () => {
    const bad = {
      'source null': { source: null },
      'run null': { run: null },
      'receipt null': { receipt: null },
      'producer null': { producer: null },
      'source a string': { source: 'HEAD' },
      'run a list': { run: ['910000001', '1'] },
      'receipt a number': { receipt: 7 },
    };
    for (const [label, over] of Object.entries(bad)) {
      const expected = selection('backend', over);
      const { result, log } = await metadata('backend', { expected });
      assert.equal(log.length, 0, `${label}: no request`);
      const offlineResult = observeBytes({
        expected, receipt: approved('backend').receipt, policy: POLICY, saved: {}, archive: new Uint8Array(1), record: new Uint8Array(1), now: '2026-09-28T12:00:00Z',
      });
      for (const [mode, r] of [['metadata', result], ['bytes', offlineResult]]) {
        assert.equal(r.outcome, 'refused', `${label} (${mode})`);
        assert.equal(exitFor(r), 1, `${label} (${mode})`);
        assert.deepEqual([...new Set(codes(r))], ['journey.observe.selection_invalid'], `${label} (${mode})`);
        for (const k of ['peer', 'repository', 'source', 'run', 'receipt', 'level', 'descriptorDigest']) assert.equal(r[k], null, `${label} (${mode}): ${k}`);
        assert.deepEqual(r.deferred, [], `${label} (${mode}): nothing is said about a selection that was not accepted`);
      }
    }
  });

  test('REGRESSION: a value that made a selection malformed is never echoed into the refusal', async () => {
    const expected = selection('backend', { source: { commit: CANARY, tree: CANARY } });
    const { result, log } = await metadata('backend', { expected });
    assert.equal(log.length, 0);
    assert.deepEqual([...new Set(codes(result))], ['journey.observe.selection_invalid']);
    assert.equal(result.source, null);
    noLeak(result, 'malformed source');
  });

  test('CONTROL: an ACCEPTED selection the policy does not approve still names itself in the refusal — its values matched a strict shape', async () => {
    const a = approved('backend');
    const other = 'e'.repeat(40);
    const expected = selection('backend', { source: { commit: other, tree: a.receipt.tree }, receipt: { commit: other, digest: a.digest }, run: { id: '910000009', attempt: '2' } });
    const { result, log } = await metadata('backend', { expected });
    assert.equal(log.length, 0);
    assert.deepEqual(codes(result), ['journey.observe.selection_not_approved']);
    assert.equal(result.peer, 'backend');
    assert.deepEqual(result.source, { commit: other, tree: a.receipt.tree });
    assert.deepEqual(result.run, { id: '910000009', attempt: '2' });
    assert.deepEqual(result.deferred, [...PEER_FORMATS.backend.deferred]);
  });

  test('REGRESSION: a selection the committed policy does not approve is refused before any request — the replaced a6b25a6, another receipt digest, a receipt file that is not the approved one', async () => {
    const old = JSON.parse(readFileSync(join(ROOT, 'release/peers/backend-a6b25a619d572c8de68964ab9ca4b4c2ae9ebe0b.json'), 'utf8'));
    const oldSelection = selection('backend', {
      source: { commit: old.commit, tree: old.tree },
      receipt: { commit: old.commit, digest: 'sha256:c1355f5059f24506e9637ad29c24e4782a71275bfa5a0b18a80ed07cc5d3b920' },
    });
    const w = world('backend');
    let log = [];
    let r = await observeMetadata({ expected: oldSelection, receipt: old, policy: POLICY, fetchImpl: fakeFetch(w.routes, log), token: TOKEN, clock: () => NOW_MS });
    assert.deepEqual(codes(r.result), ['journey.observe.selection_not_approved']);
    assert.match(r.result.reasons[0].detail, /a6b25a619d572c8de68964ab9ca4b4c2ae9ebe0b is not approved in compatible set 2026-10-03-pilot-13; the selection needs review/);
    assert.equal(log.length, 0);

    log = [];
    const wrongDigest = selection('backend', { receipt: { commit: approved('backend').commit, digest: `sha256:${'0'.repeat(64)}` } });
    r = await observeMetadata({ expected: wrongDigest, receipt: approved('backend').receipt, policy: POLICY, fetchImpl: fakeFetch(w.routes, log), clock: () => NOW_MS });
    assert.deepEqual(codes(r.result), ['journey.observe.receipt_not_approved']);
    assert.equal(log.length, 0);

    log = [];
    const edited = clone(approved('backend').receipt);
    edited.publishes.quote_protocol = 1;
    r = await observeMetadata({ expected: selection('backend'), receipt: edited, policy: POLICY, fetchImpl: fakeFetch(w.routes, log), clock: () => NOW_MS });
    assert.deepEqual(codes(r.result), ['journey.observe.receipt_not_approved']);
    assert.equal(log.length, 0);
  });

  test('CONTROL: both approved selections — backend 0513adb and admin 89d2cf1 — pass the approval check against the committed policy', () => {
    for (const peer of ['backend', 'admin']) assert.equal(approvalProblem({ policy: POLICY, expected: selection(peer), receipt: approved(peer).receipt }), null, peer);
    assert.equal(approved('backend').commit, '0513adb441828d62faadc1c67799c5432868c33a');
    assert.equal(approved('admin').commit, '89d2cf1a9ce8d44ec4d0fcad9865df96053b3bc6');
  });
});

// ── the metadata answer ─────────────────────────────────────────────────────────

describe('the metadata collection, both peers', () => {
  for (const peer of ['backend', 'admin']) {
    test(`CONTRACT (${peer}): every read is a bounded GET to the API origin, in the reviewed order, and B1's answer is metadata-only by name`, async () => {
      const { result, saved, log, w } = await metadata(peer);
      assert.equal(result.outcome, 'metadata-only', JSON.stringify(result.reasons));
      assert.equal(exitFor(result), 3);
      assert.equal(result.level, 'metadata');
      assert.equal(result.status, 'metadata-consistent-bytes-not-established');
      assert.equal(result.descriptorDigest, null);
      assert.deepEqual(result.reasons, []);
      assert.deepEqual(log.map((c) => c.url.slice(API_ORIGIN.length)), [
        w.plan.latestRun, w.plan.workflow, w.plan.run, w.plan.commit, w.plan.jobsPage(1), w.plan.artifactsPage(1), w.plan.latestRun,
      ]);
      for (const call of log) {
        assert.equal(call.method, 'GET');
        assert.equal(call.redirect, 'error', 'a redirect is refused, never followed');
        assert.ok(call.signal instanceof AbortSignal, 'every request carries a deadline');
        assert.ok(call.url.startsWith(`${API_ORIGIN}/`));
        assert.equal(call.headers.authorization, `Bearer ${TOKEN}`);
      }
      assert.deepEqual(result.jobs.map((j) => j.name), PEER_FORMATS[peer].requiredJobs);
      const chosen = Object.keys(result.artifacts).sort();
      assert.deepEqual(chosen, ['candidate', ...PEER_FORMATS[peer].companions.map((c) => c.key)].sort(), 'the unrelated audit artifact is not a candidate');
      assert.deepEqual(result.deferred, [...PEER_FORMATS[peer].deferred]);
      assert.equal(result.collection.currentAttemptRechecked, true);
      assert.equal(result.collection.atomicSnapshot, false, 'the reads are not one transaction, and the result says so');
      assert.equal(result.collection.requests, 7);
      assert.equal(result.collection.credentialAttached, true);
      assert.deepEqual(result.collection.pages, { jobs: 1, artifacts: 1 });
      noLeak(result, peer);
      // What a later bytes run is bound to: the raw documents, and nothing that came from bytes.
      assert.equal(saved.schema, SAVED_SCHEMA);
      assert.equal(saved.selectionDigest, digestOfValue(selection(peer)));
      assert.deepEqual(Object.keys(saved.observations).sort(), ['artifacts', 'commit', 'jobs', 'latestRun', 'run', 'workflow']);
      assert.ok(!JSON.stringify(saved).includes(TOKEN));
      assert.deepEqual(saved.observations.run, w.docs.run, 'raw, never normalized');
    });
  }

  test('CONTRACT: nothing in a metadata answer claims verification or admission, and no descriptor digest exists for it', async () => {
    const { result } = await metadata('backend');
    for (const k of ['verified', 'admitted', 'consumerPassed', 'certified']) assert.ok(!keysDeep(result).has(k), k);
    assert.equal(peerDescriptorDigest({ ...result, schema: 'dinify.journey.peer-descriptor/1' }), null);
    assert.match(result.statement, /^Metadata only: no byte of the candidate was observed\. This is not a verified or admitted candidate\.$/);
  });

  test('CONTRACT: with no credential no authorization header is sent, and the answer says none was attached', async () => {
    const { result, log } = await metadata('admin', { token: null });
    assert.equal(result.outcome, 'metadata-only');
    assert.ok(log.every((c) => !Object.hasOwn(c.headers, 'authorization')));
    assert.equal(result.collection.credentialAttached, false);
  });

  test('REGRESSION: a malformed credential is refused before any request, and its value is not shown', async () => {
    const bad = `${TOKEN}\r\nX-Injected: 1`;
    const { result, log } = await metadata('backend', { token: bad });
    assert.deepEqual(codes(result), ['journey.observe.credential_malformed']);
    assert.equal(log.length, 0);
    assert.ok(!JSON.stringify(result).includes('X-Injected'));
  });
});

// ── every page ──────────────────────────────────────────────────────────────────

/** Replace a listing with `total` synthetic entries on pages of `pageSizes`. */
function paged(w, kind, total, pageSizes, { patch } = {}) {
  const key = kind;
  const template = kind === 'jobs' ? w.docs.jobs[0] : w.docs.artifacts[w.docs.artifacts.length - 1];
  const required = kind === 'jobs' ? w.docs.jobs : w.docs.artifacts;
  const entries = [...required];
  for (let i = entries.length; i < total; i += 1) entries.push({ ...clone(template), id: 5000000 + i, name: `extra-${i}` });
  const pageFn = kind === 'jobs' ? w.plan.jobsPage : w.plan.artifactsPage;
  let at = 0;
  pageSizes.forEach((size, i) => {
    const page = { total_count: total, [key]: entries.slice(at, at + size) };
    at += size;
    w.routes[pageFn(i + 1)] = { body: patch ? patch(page, i + 1, entries) : page };
  });
}

describe('pagination is complete, or the collection is refused', () => {
  test('CONTRACT: a listing on several pages is read page by page and passed whole — 150 jobs, 101 artifacts', async () => {
    const { result, log } = await metadata('backend', {
      mutate: (routes, w) => { paged(w, 'jobs', 150, [100, 50]); paged(w, 'artifacts', 101, [100, 1]); },
    });
    assert.equal(result.outcome, 'metadata-only', JSON.stringify(result.reasons));
    assert.deepEqual(result.collection.pages, { jobs: 2, artifacts: 2 });
    assert.equal(log.length, 9);
  });

  test('CONTRACT: an empty listing is one page, and B1 then names the missing jobs', async () => {
    const { result } = await metadata('backend', { mutate: (routes, w) => { routes[w.plan.jobsPage(1)] = { body: { total_count: 0, jobs: [] } }; } });
    assert.deepEqual(codes(result), ['journey.peers.required_job_missing', 'journey.peers.required_job_missing', 'journey.peers.required_job_missing']);
  });

  const cases = {
    'a repeated page (page 2 answers page 1 again)': ['journey.observe.pagination_repeated', (routes, w) => {
      paged(w, 'jobs', 200, [100, 100]);
      routes[w.plan.jobsPage(2)] = clone(routes[w.plan.jobsPage(1)]);
    }],
    'pages that disagree about the total': ['journey.observe.pagination_inconsistent', (routes, w) => {
      paged(w, 'jobs', 150, [100, 50], { patch: (page, n) => (n === 2 ? { ...page, total_count: 151 } : page) });
    }],
    'a truncated last page': ['journey.observe.pagination_truncated', (routes, w) => { paged(w, 'artifacts', 150, [100, 49]); }],
    'a truncated first page': ['journey.observe.pagination_truncated', (routes, w) => { paged(w, 'artifacts', 150, [99, 50]); }],
    'a page holding more than the total implies': ['journey.observe.pagination_inconsistent', (routes, w) => {
      paged(w, 'jobs', 3, [3], { patch: (page) => ({ ...page, jobs: [...page.jobs, { ...clone(page.jobs[0]), id: 4242 }] }) });
    }],
    'a total that needs more pages than are ever read': ['journey.observe.pagination_unbounded', (routes, w) => {
      routes[w.plan.artifactsPage(1)] = { body: { total_count: 1001, artifacts: w.docs.artifacts } };
    }],
    'a page that is a list, not a listing': ['journey.observe.response_malformed', (routes, w) => { routes[w.plan.jobsPage(1)] = { body: w.docs.jobs }; }],
    'a total that is text': ['journey.observe.response_malformed', (routes, w) => { routes[w.plan.jobsPage(1)] = { body: { total_count: '3', jobs: w.docs.jobs } }; }],
    'an entry with no id': ['journey.observe.response_malformed', (routes, w) => {
      routes[w.plan.artifactsPage(1)] = { body: { total_count: 1, artifacts: [{ name: 'x' }] } };
    }],
  };
  for (const [label, [code, mutate]] of Object.entries(cases)) {
    test(`REGRESSION: ${label} is refused as ${code}, and no answer is formed`, async () => {
      const { result, saved } = await metadata('backend', { mutate });
      assert.deepEqual(codes(result), [code]);
      assert.equal(result.outcome, 'refused');
      assert.equal(exitFor(result), 1);
      assert.equal(saved, null);
      assert.equal(result.level, null);
    });
  }

  test('CONTRACT: an unbounded listing is refused after its FIRST page — no further page is requested', async () => {
    const { log } = await metadata('backend', {
      mutate: (routes, w) => { routes[w.plan.jobsPage(1)] = { body: { total_count: 5000, jobs: w.docs.jobs } }; },
    });
    assert.ok(!log.some((c) => c.url.endsWith('page=2')));
  });
});

// ── transport failures ──────────────────────────────────────────────────────────

describe('transport failures are named, sanitized and final', () => {
  const failing = {
    401: [{ status: 401, body: { message: CANARY } }, 'journey.observe.unauthorized'],
    403: [{ status: 403, body: { message: CANARY }, headers: { 'x-ratelimit-remaining': '4999' } }, 'journey.observe.forbidden'],
    '403 rate limit': [{ status: 403, body: { message: CANARY }, headers: { 'x-ratelimit-remaining': '0' } }, 'journey.observe.rate_limited'],
    429: [{ status: 429, body: { message: CANARY } }, 'journey.observe.rate_limited'],
    404: [{ status: 404, body: { message: CANARY } }, 'journey.observe.not_found'],
    500: [{ status: 500, raw: `<html>${CANARY}</html>` }, 'journey.observe.http_status'],
    'a redirect': [{ status: 301, body: { url: 'https://elsewhere.example/', message: CANARY } }, 'journey.observe.redirect_refused'],
    'a non-JSON answer': [{ raw: CANARY, headers: { 'content-type': 'text/html' } }, 'journey.observe.response_malformed'],
    'unreadable JSON': [{ raw: `{"${CANARY}": ` }, 'journey.observe.response_malformed'],
    'a declared oversized body': [{ raw: '{}', headers: { 'content-length': String(64 * 1024 * 1024) } }, 'journey.observe.response_too_large'],
    'a streamed oversized body': [{ raw: `{"pad":"${'x'.repeat(4 * 1024 * 1024 + 16)}"}` }, 'journey.observe.response_too_large'],
    'a timeout': [{ throw: 'TimeoutError' }, 'journey.observe.timeout'],
    'a dropped connection': [{ throw: 'TypeError' }, 'journey.observe.transport_failed'],
  };
  for (const [label, [spec, code]] of Object.entries(failing)) {
    test(`REGRESSION: ${label} on the selected attempt is ${code}; nothing after it is requested and nothing it said is shown`, async () => {
      const { result, log, saved } = await metadata('backend', { mutate: (routes, w) => { routes[w.plan.run] = spec; } });
      assert.deepEqual(codes(result), [code]);
      assert.equal(result.outcome, 'refused');
      assert.equal(saved, null);
      assert.equal(log.length, 3, 'first run read, workflow, then the failing read — and no further request');
      noLeak(result, label);
    });
  }

  test('REGRESSION: the collection deadline is enforced from the injected clock', async () => {
    let t = NOW_MS;
    const { result, log } = await metadata('backend', { clock: () => { t += 30_000; return t; } });
    assert.deepEqual(codes(result), ['journey.observe.deadline_exceeded']);
    assert.ok(log.length < 7);
  });
});

// ── the run as it stands, before and after ──────────────────────────────────────

describe('the run is re-read after collection', () => {
  const changed = {
    'a new attempt started': (doc) => ({ ...doc, run_attempt: 2, status: 'in_progress', conclusion: null }),
    'the update time moved': (doc) => ({ ...doc, updated_at: '2026-09-28T11:59:59Z' }),
    'the conclusion changed': (doc) => ({ ...doc, conclusion: 'failure' }),
  };
  for (const [label, change] of Object.entries(changed)) {
    test(`REGRESSION: ${label} between the first and the final read refuses the collection`, async () => {
      const { result, saved } = await metadata('backend', {
        mutate: (routes, w) => { routes[w.plan.latestRun] = [{ body: w.docs.run }, { body: change(w.docs.run) }]; },
      });
      assert.deepEqual(codes(result), ['journey.observe.run_changed_during_collection']);
      assert.equal(saved, null);
    });
  }

  const contradictions = {
    'a failed conclusion': { conclusion: 'failure' },
    'another head': { head_sha: 'e'.repeat(40) },
    'a run still in progress': { status: 'in_progress', conclusion: null },
    'another workflow': { workflow_id: 999 },
    'another workflow path': { path: '.github/workflows/other.yml' },
    'another event': { event: 'workflow_dispatch' },
    'another branch': { head_branch: 'release' },
    'another repository': { head_repository: { id: 1, full_name: 'someone/Dinify-Backend' } },
  };
  for (const [label, change] of Object.entries(contradictions)) {
    test(`REGRESSION: a STABLE current run naming the selected attempt with ${label} contradicts the attempt read, and is refused before B1 is asked — nothing is saved`, async () => {
      const field = Object.keys(change)[0];
      const { result, saved } = await metadata('backend', {
        mutate: (routes, w) => { const current = { ...w.docs.run, ...change }; routes[w.plan.latestRun] = [{ body: current }, { body: current }]; },
      });
      assert.deepEqual(codes(result), ['journey.observe.run_contradicts_attempt']);
      assert.ok(result.reasons[0].detail.includes(field === 'head_repository' ? 'head_repository.full_name' : field), result.reasons[0].detail);
      assert.equal(result.outcome, 'refused');
      assert.equal(saved, null);
      assert.equal(result.collection.currentAttemptRechecked, false);
    });
  }

  test('REGRESSION: the contradiction is refused in either direction — an attempt read saying failure beside a current run saying success', async () => {
    const { result } = await metadata('admin', {
      mutate: (routes, w) => { routes[w.plan.run] = { body: { ...w.docs.run, conclusion: 'failure' } }; },
    });
    assert.deepEqual(codes(result), ['journey.observe.run_contradicts_attempt']);
  });

  test('CONTROL: the agreement is asked only of the fields that describe the attempt — a later update time, another run number or display title on the current run still passes', async () => {
    const { result } = await metadata('backend', {
      mutate: (routes, w) => {
        const current = { ...w.docs.run, updated_at: '2026-09-28T11:00:00Z', run_number: 413, display_title: 'another title' };
        routes[w.plan.latestRun] = [{ body: current }, { body: current }];
      },
    });
    assert.equal(result.outcome, 'metadata-only', JSON.stringify(result.reasons));
    assert.equal(result.collection.currentAttemptRechecked, true);
  });

  test('CONTROL: a current run at a LATER attempt is not compared with the selected one — whatever it says, the answer is B1\'s attempt_superseded', async () => {
    const { result } = await metadata('backend', {
      mutate: (routes, w) => {
        const later = { ...w.docs.run, run_attempt: 2, status: 'in_progress', conclusion: null, head_sha: 'e'.repeat(40) };
        routes[w.plan.latestRun] = [{ body: later }, { body: later }];
      },
    });
    assert.deepEqual(codes(result), ['journey.peers.attempt_superseded']);
  });

  test('REGRESSION: a run already at a later attempt on BOTH reads is B1\'s attempt_superseded — the selection is never moved to the newer attempt', async () => {
    const { result, log } = await metadata('backend', {
      mutate: (routes, w) => { const later = { ...w.docs.run, run_attempt: 2 }; routes[w.plan.latestRun] = [{ body: later }, { body: later }]; },
    });
    assert.deepEqual(codes(result), ['journey.peers.attempt_superseded']);
    assert.ok(log.every((c) => !c.url.includes('/attempts/2')), 'attempt 2 is never read on the selection\'s behalf');
  });
});

// ── what B1 refuses, surfaced ───────────────────────────────────────────────────

describe('B1\'s refusals reach the answer unchanged', () => {
  const art = (w, name) => w.docs.artifacts.findIndex((a) => a.name === name);
  const cases = {
    'a commit whose tree is not the receipt\'s': ['journey.peers.source_tree_mismatch', (r, w) => { r[w.plan.commit].body.tree.sha = 'f'.repeat(40); }],
    'another workflow file': ['journey.peers.workflow_mismatch', (r, w) => { r[w.plan.workflow].body.path = '.github/workflows/other.yml'; }],
    'a run of another workflow': ['journey.peers.run_wrong_workflow', (r, w) => { r[w.plan.run].body.workflow_id += 1; }],
    'a pull-request run': ['journey.peers.run_wrong_event', (r, w) => { r[w.plan.run].body.event = 'pull_request'; }],
    'a run from a fork': ['journey.peers.run_wrong_repository', (r, w) => { r[w.plan.run].body.head_repository = { id: 1, full_name: 'someone/Dinify-Backend' }; }],
    'a failed run': ['journey.peers.run_not_successful', (r, w) => { r[w.plan.run].body.conclusion = 'failure'; }],
    'a missing required job': ['journey.peers.required_job_missing', (r, w) => {
      const p = r[w.plan.jobsPage(1)].body; p.jobs = p.jobs.filter((j) => j.name !== 'reconstruct'); p.total_count = p.jobs.length;
    }],
    'a failed required job': ['journey.peers.job_not_successful', (r, w) => { r[w.plan.jobsPage(1)].body.jobs[1].conclusion = 'failure'; }],
    'a duplicated required job': ['journey.peers.required_job_duplicate', (r, w) => {
      const p = r[w.plan.jobsPage(1)].body; p.jobs.push({ ...clone(p.jobs[2]), id: 4343 }); p.total_count = p.jobs.length;
    }],
    'a job carried from another attempt': ['journey.peers.mixed_attempt', (r, w) => { r[w.plan.jobsPage(1)].body.jobs[0].run_attempt = 2; }],
    'an expired candidate': ['journey.peers.artifact_expired', (r, w) => {
      const a = r[w.plan.artifactsPage(1)].body.artifacts[art(w, 'backend-candidate-910000001-1')]; a.expired = true;
    }],
    'a candidate past its expiry time': ['journey.peers.artifact_expired', (r, w) => {
      r[w.plan.artifactsPage(1)].body.artifacts[art(w, 'backend-candidate-910000001-1')].expires_at = '2026-09-01T00:00:00Z';
    }],
    'two candidates of one name': ['journey.peers.candidate_ambiguous', (r, w) => {
      const p = r[w.plan.artifactsPage(1)].body; p.artifacts.push({ ...clone(p.artifacts[0]), id: 4444 }); p.total_count = p.artifacts.length;
    }],
    'a missing reconstruction companion': ['journey.peers.reconstruction_missing', (r, w) => {
      const p = r[w.plan.artifactsPage(1)].body; p.artifacts = p.artifacts.filter((a) => !a.name.startsWith('backend-reconstruction')); p.total_count = p.artifacts.length;
    }],
    'a stale companion from an earlier run': ['journey.peers.artifact_wrong_run', (r, w) => {
      r[w.plan.artifactsPage(1)].body.artifacts[art(w, 'backend-reconstruction-910000001-1')].workflow_run.id = 910000000;
    }],
    'a contradictory non-promotable candidate': ['journey.peers.candidate_contradictory', (r, w) => {
      const p = r[w.plan.artifactsPage(1)].body; p.artifacts.push({ ...clone(p.artifacts[0]), id: 4545, name: 'backend-candidate-nonpromotable-910000001-1' }); p.total_count = p.artifacts.length;
    }],
  };
  for (const [label, [code, mutate]] of Object.entries(cases)) {
    test(`REGRESSION: ${label} is refused as ${code}`, async () => {
      const { result, saved } = await metadata('backend', { mutate });
      assert.ok(codes(result).includes(code), `${label}: ${JSON.stringify(codes(result))}`);
      assert.equal(result.outcome, 'refused');
      assert.equal(exitFor(result), 1);
      assert.equal(result.level, null);
      assert.ok(saved, 'the raw documents a complete collection read are still saved for diagnosis');
    });
  }
});

// ── bytes, offline ──────────────────────────────────────────────────────────────

function backendRecord(s) {
  const files = [{ filename: 'synthetic_pkg-1.0-py3-none-any.whl', name: 'synthetic-pkg', version: '1.0', role: 'application', sha256: hex('wheel'), size: 1234 }];
  return {
    schema: 'dinify.backend.candidate/1', repository: s.repository, commit: s.source.commit, tree: s.source.tree,
    eligibility: { promotable: true }, artifact: { name: `backend-candidate-${s.run.id}-${s.run.attempt}` },
    ci: { repository: s.repository, event: 'push', ref: 'refs/heads/main', sha: s.source.commit, runId: s.run.id, runAttempt: s.run.attempt, workflowRef: `${s.repository}/.github/workflows/ci.yml@refs/heads/main` },
    source: { tree: s.source.tree, archive: { path: 'source.tar', sha256: hex('source'), size: 4096 }, contentSha256: hex('content') },
    wheelhouse: { files, digest: backendListingDigest(files) },
    inputs: { lock: { sha256: hex('lock') }, requirements: { sha256: hex('requirements') } },
    environment: { digest: hex('environment') },
    audit: { outcome: 'within_policy' },
    target: { python: '3.12.3', implementation: 'CPython', platform: 'linux', machine: 'x86_64', libc: 'glibc 2.39' },
  };
}

function adminRecord(s) {
  const entries = [{ path: 'index.html', sha256: hex('index'), bytes: 10 }, { path: 'release.txt', sha256: hex('release'), bytes: 41 }];
  const files = [{ path: 'audit.json', sha256: hex('audit'), bytes: 20 }];
  return {
    schema: 'dinify.admin.certification/1', repository: s.repository, commit: s.source.commit, tree: s.source.tree,
    workflow: { path: '.github/workflows/ci.yml', job: 'validate', event: 'push', gitRef: 'refs/heads/main', runId: s.run.id, runAttempt: s.run.attempt },
    payload: { entries, treeDigest: treeDigest(entries), entryCount: entries.length, release: { path: 'release.txt', commit: s.source.commit }, archive: { path: 'payload.tar.gz', sha256: hex('payload'), bytes: 100 } },
    evidence: { files, treeDigest: treeDigest(files) },
    source: { digest: `sha256:${hex('source digest')}` },
    audit: { outcome: 'within_policy' },
    build: { environment: { node: '24.15.0' } },
  };
}

/** Saved observations plus synthetic local bytes whose digest the listing states. */
async function offline(peer) {
  const archive = Buffer.from(`SYNTHETIC ${peer} candidate archive — not a real artifact`);
  const { saved, w } = await metadata(peer, {
    mutate: (routes, world) => {
      const name = `${PEER_FORMATS[peer].candidatePrefix}-${PEERS[peer].runId}-${PEERS[peer].attempt}`;
      const listed = routes[world.plan.artifactsPage(1)].body.artifacts.find((a) => a.name === name);
      listed.digest = digestOf(archive);
      listed.size_in_bytes = archive.length;
    },
  });
  const s = selection(peer);
  const record = Buffer.from(JSON.stringify(peer === 'backend' ? backendRecord(s) : adminRecord(s)));
  return { saved, archive, record, w, s };
}

const bytesRun = (peer, input) => observeBytes({
  expected: selection(peer), receipt: approved(peer).receipt, policy: POLICY, now: '2026-09-28T12:00:00Z', ...input,
});

describe('the offline bytes mode', () => {
  for (const peer of ['backend', 'admin']) {
    test(`CONTRACT (${peer}): local bytes that hash to the listed digest, with an agreeing record, correspond — and every consumer check stays deferred`, async () => {
      const { saved, archive, record } = await offline(peer);
      const r = bytesRun(peer, { saved, archive, record });
      assert.equal(r.outcome, 'bytes-correspond-consumer-checks-deferred', JSON.stringify(r.reasons));
      assert.equal(exitFor(r), 0);
      assert.equal(r.level, 'bytes');
      assert.equal(r.status, 'bytes-correspond-consumer-checks-deferred');
      assert.deepEqual(r.deferred, [...PEER_FORMATS[peer].deferred], 'the deferred vocabulary is B1\'s, whole');
      assert.equal(r.bytes.archive.state, 'measured-match');
      assert.equal(r.bytes.archive.measuredDigest, digestOf(archive));
      assert.equal(r.bytes.record.state, 'consistent');
      assert.match(r.descriptorDigest, /^sha256:[0-9a-f]{64}$/);
      assert.equal(r.collection, null, 'the saved collection block is file content and is not echoed');
      for (const k of ['verified', 'admitted', 'consumerPassed']) assert.ok(!keysDeep(r).has(k), k);
    });
  }

  test('REGRESSION: one flipped archive byte is a digest mismatch; an edited record is a record refusal', async () => {
    const { saved, archive, record } = await offline('backend');
    const tampered = Buffer.from(archive);
    tampered[3] ^= 1;
    assert.deepEqual(codes(bytesRun('backend', { saved, archive: tampered, record })), ['journey.peers.archive_digest_mismatch']);
    const r = JSON.parse(record.toString('utf8'));
    r.commit = 'e'.repeat(40);
    assert.ok(codes(bytesRun('backend', { saved, archive, record: Buffer.from(JSON.stringify(r)) })).includes('journey.peers.record_mismatch'));
    assert.deepEqual(codes(bytesRun('backend', { saved, archive, record: Buffer.from('not json') })), ['journey.peers.record_unreadable']);
  });

  test('REGRESSION: missing bytes are refused by name — never answered from metadata', async () => {
    const { saved, archive, record } = await offline('backend');
    for (const [label, input] of Object.entries({
      'no archive': { saved, record }, 'no record': { saved, archive }, 'neither': { saved },
      'an archive that is text, not bytes': { saved, archive: archive.toString('latin1'), record },
    })) {
      const r = bytesRun('backend', input);
      assert.deepEqual(codes(r), ['journey.observe.bytes_input_missing'], label);
      assert.equal(r.outcome, 'refused', label);
      assert.equal(r.level, null, label);
      assert.equal(r.status, null, label);
    }
  });

  test('REGRESSION: saved observations for another selection, or carrying bytes or a receipt of their own, are refused', async () => {
    const { saved, archive, record } = await offline('backend');
    const other = observeBytes({
      expected: selection('backend', { run: { id: '910000009', attempt: '1' } }), receipt: approved('backend').receipt, policy: POLICY, saved, archive, record, now: '2026-09-28T12:00:00Z',
    });
    assert.deepEqual(codes(other), ['journey.observe.observations_foreign']);
    for (const [label, change] of Object.entries({
      'a saved archive': (s) => { s.observations.archive = [1, 2]; },
      'a saved receipt': (s) => { s.observations.receipt = approved('backend').receipt; },
      'another schema': (s) => { s.schema = 'dinify.journey.peer-observations/2'; },
      'an extra envelope key': (s) => { s.verified = true; },
      'a listing that is not a page list': (s) => { s.observations.jobs = {}; },
    })) {
      const s = clone(saved);
      change(s);
      assert.deepEqual(readSaved(s, selection('backend')).observations, null, label);
      const r = bytesRun('backend', { saved: s, archive, record });
      assert.equal(r.outcome, 'refused', label);
      assert.ok(codes(r)[0].startsWith('journey.observe.observations_'), `${label}: ${JSON.stringify(codes(r))}`);
    }
  });

  test('REGRESSION: saved observations whose current run contradicts the selected attempt are refused on the way back in — a file is not a way past the collection\'s rule', async () => {
    const { saved, archive, record } = await offline('backend');
    for (const [label, change] of Object.entries({
      'a failed current run': (s) => { s.observations.latestRun.conclusion = 'failure'; },
      'another head on the attempt read': (s) => { s.observations.run.head_sha = 'e'.repeat(40); },
    })) {
      const s = clone(saved);
      change(s);
      const back = readSaved(s, selection('backend'));
      assert.equal(back.observations, null, label);
      assert.equal(back.reason.code, 'journey.observe.run_contradicts_attempt', label);
      assert.deepEqual(codes(bytesRun('backend', { saved: s, archive, record })), ['journey.observe.run_contradicts_attempt'], label);
    }
    const moved = clone(saved);
    moved.observations.latestRun.updated_at = '2026-09-28T11:00:00Z';
    assert.equal(bytesRun('backend', { saved: moved, archive, record }).outcome, 'bytes-correspond-consumer-checks-deferred', 'CONTROL: a field outside the agreement does not refuse');
  });

  test('CONTRACT: the exit statuses are distinct and none of them means verified — 0 bytes (deferred), 3 metadata, 1 refused, 2 usage', () => {
    assert.deepEqual(Object.fromEntries(Object.entries(OUTCOMES).map(([k, v]) => [k, [v.outcome, v.exit]])), {
      bytes: ['bytes-correspond-consumer-checks-deferred', 0],
      metadata: ['metadata-only', 3],
      refused: ['refused', 1],
      usage: ['usage', 2],
    });
  });
});
