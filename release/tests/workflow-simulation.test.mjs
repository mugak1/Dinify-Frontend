/**
 * THE WORKFLOW, EXECUTED (§8) — .github/workflows/publish.yml run step by step against
 * a production-shaped fixture world, with an observable stand-in publisher.
 *
 * Each scenario builds its own world: a fixture frontend repository (the real release/
 * code, a policy pointing at local origins, real receipts for a disposable backend and
 * admin repository), candidates built and stamped by the REAL `stamp` from real commits,
 * an artifact store standing in for GitHub's uploads, a recorded GitHub API, a local
 * HTTPS origin serving whatever was last "published", and local peer origins. Then the
 * workflow file under review is executed by release/tests/workflow-engine.mjs.
 *
 * WHAT A SCENARIO PROVES, BOTH WAYS:
 *   AUTHORITY — when the decision is anything but an admitted, re-established unit,
 *   the credentialed step does not run and the credential is never evaluated; when it
 *   is, the credential reaches that one step and no other, and no checkout left a token
 *   behind.
 *   SEQUENCE — the served identity is read by the gate, re-read inside the critical
 *   section, and only then published over; the verification that follows fetches the
 *   identity and every certified file back from the origin.
 *
 * FAULT INJECTION IS LABELLED AS SUCH. Replacing an artifact's bytes, or an entry in the
 * store, does not claim that GitHub artifacts can be altered after upload — they cannot.
 * It proves the publisher re-establishes the unit from ITS OWN download and the API's
 * CURRENT answer rather than trusting that nothing changed.
 *
 * LABELS: REGRESSION — reproduced on 3386724 before the change (release/README.md,
 * "Baseline"); CONTRACT — a rule this change introduces; CONTROL — an allowed path that
 * must stay allowed.
 */

import { strict as assert } from 'node:assert';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { receiptDigest } from '../lib/peers.mjs';
import {
  REPOSITORY, ROOT, artifactDigest, artifactStore, buildCandidate, certificationResponses, cli, commitAll,
  fixtureFrontend, git, initRepo, installFakeGh, runObject, startOrigin, tempDir, writeText,
} from './harness.mjs';
import { POLICY, clone } from './fixtures.mjs';
import { runWorkflow } from './workflow-engine.mjs';

const WORKFLOW = join(ROOT, '.github/workflows/publish.yml');
const SECRET = 'SIMULATED-SERVICE-ACCOUNT-7f3c';
const TOKEN = 'ghs_SIMULATED_TOKEN';
const MINUTE = 60_000;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

const shared = {};
const opened = [];

before(async () => {
  // PEERS, once: real repositories, receipts produced by the real producer.
  const d01 = JSON.parse(readFileSync(join(ROOT, 'src/app/_shared/order/checkout-limits.contract.json'), 'utf8'));
  const backend = initRepo(tempDir('sim-backend'));
  writeText(backend, 'orders_app/contracts/checkout_limits.contract.json', `${JSON.stringify(d01, null, 2)}\n`);
  writeText(backend, 'orders_app/contracts/published_capabilities.contract.json',
    `${JSON.stringify({ checkout_protocol: 3, quote_protocol: 2, kitchen_protocol: 1, quote_policy_version: 1 }, null, 2)}\n`);
  shared.B1 = commitAll(backend, 'B1');
  const admin = initRepo(tempDir('sim-admin'));
  writeText(admin, '.github/workflows/deploy.yml', 'name: Deploy\n');
  shared.A1 = commitAll(admin, 'A1');
  writeText(admin, '.github/workflows/deploy.yml', 'name: Deploy\n# next\n');
  shared.A2 = commitAll(admin, 'A2');
  shared.admin = admin;
  const receipt = async (peer, repoDir, commit, repository) => {
    const r = await cli(['peer-receipt', '--peer', peer, '--repo-dir', repoDir, '--commit', commit, '--repository', repository]);
    assert.equal(r.status, 0, r.stderr);
    return { text: r.stdout, receipt: JSON.parse(r.stdout) };
  };
  shared.backendReceipt = await receipt('backend', backend, shared.B1, 'mugak1/Dinify-Backend');
  shared.adminReceipt = await receipt('admin', admin, shared.A1, 'mugak1/Dinify-Admin');
});

after(async () => {
  for (const origin of opened) await origin.close();
});

function serveCommit(origin, commit) {
  origin.route('/release.txt', { status: 200, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' }, body: `${commit}\n` });
}

/**
 * One world. `prerequisites: 'recorded'` gives the allowed policy; `'committed'` keeps
 * the committed policy's outstanding prerequisites. `c2Files` changes files at the
 * target commit (e.g. its hosting configuration).
 */
async function makeWorld({
  prerequisites = 'recorded', enabled = true, c2Files = {}, legacyWorkflow = false, policyMutate,
  certifyStartedAgo = 30 * MINUTE,
} = {}) {
  const log = [];
  const site = await startOrigin({ log, name: 'site' });
  const adminOrigin = await startOrigin({ log, name: 'admin' });
  const backendOrigin = await startOrigin({ log, name: 'backend' });
  opened.push(site, adminOrigin, backendOrigin);
  serveCommit(adminOrigin, shared.A1);
  serveCommit(backendOrigin, shared.B1);

  const policy = clone(POLICY);
  if (prerequisites === 'recorded') {
    policy.prerequisites.sourceProtection.status = 'recorded';
    policy.prerequisites.retention.status = 'verified';
    policy.prerequisites.singlePublisher.status = 'single-publisher';
  }
  policy.hosting.identityOrigin = site.origin;
  // A local origin serves a published file at once; the production wait is for a CDN.
  policy.hosting.verification = { attempts: 2, intervalMs: 50 };
  const approve = (peer, r) => ({ commit: r.receipt.commit, receipt: `release/peers/${peer}-${r.receipt.commit}.json`, receiptDigest: receiptDigest(r.receipt) });
  policy.compatibleSet.peers.backend.approved = [approve('backend', shared.backendReceipt)];
  // HYPOTHETICAL: the real backend publishes no serving identity until B3. The
  // committed policy's refusal for that is asserted by committed-policy.test.mjs.
  policy.compatibleSet.peers.backend.serving = { observation: 'public-identity', origin: backendOrigin.origin, path: '/release.txt' };
  policy.compatibleSet.peers.admin.approved = [approve('admin', shared.adminReceipt)];
  policy.compatibleSet.peers.admin.serving = { observation: 'public-identity', origin: adminOrigin.origin, path: '/release.txt' };
  if (policyMutate) policyMutate(policy);

  const fixture = fixtureFrontend({
    policy,
    legacyWorkflow,
    files: {
      [`release/peers/backend-${shared.B1}.json`]: shared.backendReceipt.text,
      [`release/peers/admin-${shared.A1}.json`]: shared.adminReceipt.text,
    },
  });
  const repo = fixture.dir;
  writeText(repo, 'fixture/CHANGES.txt', 'one\n');
  const C1 = commitAll(repo, 'C1');
  writeText(repo, 'fixture/CHANGES.txt', 'two\n');
  for (const [rel, text] of Object.entries(c2Files)) writeText(repo, rel, text);
  const C2 = commitAll(repo, 'C2');

  const now = Date.now();
  const started = {
    5101: iso(now - 40 * MINUTE),
    5102: iso(now - certifyStartedAgo),
    5103: iso(now - 20 * MINUTE),
  };
  const candidates = {
    c1: await buildCandidate({ repo, commit: C1, runId: 5101, startedAt: started[5101] }),
    c2: await buildCandidate({ repo, commit: C2, runId: 5102, startedAt: started[5102] }),
    twin: await buildCandidate({ repo, commit: C2, runId: 5103, startedAt: started[5103], marker: ' twin' }),
  };
  const store = artifactStore();
  const ids = {
    c1: store.add(candidates.c1).id,
    c2: store.add(candidates.c2).id,
    twin: store.add(candidates.twin).id,
  };

  const gh = installFakeGh();
  const runs = {
    5101: runObject({ runId: 5101, headSha: C1, startedAt: started[5101] }),
    5102: runObject({ runId: 5102, headSha: C2, startedAt: started[5102] }),
    5103: runObject({ runId: 5103, headSha: C2, startedAt: started[5103] }),
  };
  const world = {
    repository: REPOSITORY,
    repositories: { [REPOSITORY]: repo },
    token: TOKEN,
    secrets: { FIREBASE_SERVICE_ACCOUNT: SECRET },
    vars: enabled ? { FRONTEND_PUBLISH_ENABLED: 'true' } : {},
    gh,
    artifacts: store,
    evidence: tempDir('sim-evidence'),
    hosting: { project: 'dinify-dev', sites: { 'dinify-prod': site } },
    publisher: { mode: 'ok', calls: [], published: [], substitute: null },
    log,
    // fixture handles for scenarios
    repo, C1, C2, candidates, ids, runs, site, adminOrigin, backendOrigin, policy,
    listedForManual: { [C1]: [5101], [C2]: [5102, 5103] },
  };
  world.refreshApi = () => refreshApi(world);
  world.refreshApi();
  // What is live before the scenario: C1's candidate, published earlier.
  world.serve = (candidate) => serveCandidate(world, candidate);
  world.serve(candidates.c1);
  return world;
}

/** The recorded GitHub API, derived from the world's current state. */
function refreshApi(world) {
  const map = {};
  for (const run of Object.values(world.runs)) {
    Object.assign(map, certificationResponses({ run, artifacts: world.artifacts.listing(run.id) }));
  }
  for (const [commit, runIds] of Object.entries(world.listedForManual)) {
    map[`repos/${REPOSITORY}/actions/workflows/certify.yml/runs?head_sha=${commit}&event=push&branch=main&status=success&per_page=100`] = {
      json: { total_count: runIds.length, workflow_runs: runIds.map((id) => world.runs[id]) },
    };
  }
  const head = git(world.repo, ['rev-parse', 'main']);
  for (const commit of [world.C1, world.C2]) {
    let status = 'diverged';
    if (commit === head) status = 'identical';
    else if (git(world.repo, ['merge-base', commit, head]) === commit) status = 'ahead';
    map[`repos/${REPOSITORY}/compare/${commit}...main`] = { json: { status } };
  }
  const tree = git(shared.admin, ['rev-parse', `${shared.A1}^{tree}`]);
  const blob = git(shared.admin, ['rev-parse', `${shared.A1}:.github/workflows/deploy.yml`]);
  map[`repos/mugak1/Dinify-Admin/git/commits/${shared.A1}`] = { json: { sha: shared.A1, tree: { sha: tree } } };
  map[`repos/mugak1/Dinify-Admin/contents/.github/workflows/deploy.yml?ref=${shared.A1}`] = { json: { type: 'file', sha: blob } };
  world.gh.set(map);
}

/** Put a candidate on the site as though an earlier publication had done so. */
function serveCandidate(world, candidate) {
  const docroot = tempDir('sim-served');
  cpSync(join(candidate.dir, 'dist'), docroot, { recursive: true });
  const config = JSON.parse(git(world.repo, ['show', `${candidate.commit}:firebase.json`]));
  world.site.serveSite(docroot, config);
}

function automaticEvent(world, runId, { conclusion = 'success', branch = 'main', name = 'Certify', headSha } = {}) {
  const run = world.runs[runId];
  return {
    name: 'workflow_run',
    ref: 'refs/heads/main',
    sha: git(world.repo, ['rev-parse', 'main']),
    runId: 9000 + Number(runId),
    runAttempt: 1,
    payload: {
      action: 'completed',
      workflow_run: { id: Number(runId), name, head_sha: headSha ?? run.head_sha, head_branch: branch, conclusion, event: 'push', path: run.path },
    },
  };
}

function manualEvent(world, sha, mode = 'deploy', { ref = 'refs/heads/main' } = {}) {
  return { name: 'workflow_dispatch', ref, sha: git(world.repo, ['rev-parse', 'main']), runId: 8001, runAttempt: 1, inputs: { sha, mode } };
}

const simulate = (world, event, hooks) => runWorkflow({ workflowPath: WORKFLOW, event, world, hooks });

// ── reading a result ────────────────────────────────────────────────────────────

const step = (result, job, name) => result.jobs[job]?.steps.find((s) => s.name === name) ?? null;

function decisionOf(result) {
  const s = step(result, 'gate', 'Decide');
  if (!s || s.outcome === 'skipped') return null;
  return JSON.parse(s.stdout.slice(s.stdout.indexOf('{')));
}

function outcomeOf(result) {
  const job = result.jobs.publish?.result !== 'skipped' && result.jobs.publish ? 'publish' : 'gate';
  const s = step(result, job, 'Report the outcome');
  if (!s || s.outcome === 'skipped') return null;
  return JSON.parse(s.stdout).outcome;
}

function preflightOf(result) {
  const s = step(result, 'publish', 'Re-establish the admitted unit, then stage it');
  if (!s || s.outcome === 'skipped') return null;
  return JSON.parse(s.stdout);
}

const codesOf = (x) => (x?.reasons ?? []).map((r) => r.code);

/** A file the publish job retained, as upload-artifact stored it. */
const retained = (world, event, file) => JSON.parse(readFileSync(join(world.evidence, `publish-publisher-${event.runId}-1`, file), 'utf8'));

function servedCommitNow(world) {
  const site = world.site.site();
  return site ? JSON.parse(readFileSync(join(site.dir, 'release.json'), 'utf8')) : null;
}

/** THE AUTHORITY INVARIANT, when nothing may be published. */
function assertNothingPublished(world, result) {
  assert.equal(world.publisher.calls.length, 0, 'the credentialed step ran');
  assert.deepEqual(result.secretAccess, [], `the credential was evaluated: ${JSON.stringify(result.secretAccess)}`);
}

/** THE AUTHORITY INVARIANT, when something was: exactly one step, exactly one credential. */
function assertCredentialConfined(world, result) {
  assert.equal(world.publisher.calls.length, 1);
  assert.equal(world.publisher.calls[0].received, SECRET, 'the publisher received the credential');
  assert.deepEqual(result.secretAccess.map((a) => [a.job, a.step, a.name]), [['publish', 'Publish to Firebase Hosting', 'FIREBASE_SERVICE_ACCOUNT']]);
  for (const s of result.steps) {
    if (s.script) assert.ok(!s.script.includes(SECRET), `the credential reached the script of "${s.name}"`);
    if (s.env) assert.ok(!Object.values(s.env).includes(SECRET), `the credential reached the environment of "${s.name}"`);
  }
}

function assertNoPersistedCredentials(result) {
  for (const s of result.steps.filter((x) => x.action === 'actions/checkout' && x.outcome === 'success')) {
    assert.equal(s.observed.persistCredentials, false, `checkout "${s.name}" left a token in its git config`);
  }
}

// ── scenarios ───────────────────────────────────────────────────────────────────

describe('publish.yml, executed against a production-shaped world', { concurrency: 4 }, () => {
  test('CONTRACT: an admitted automatic candidate is published, verified file by file, and the credential reaches one step', async () => {
    const world = await makeWorld();
    const event = automaticEvent(world, 5102);
    const result = await simulate(world, event);
    assert.equal(result.jobs.gate.result, 'success');
    assert.equal(decisionOf(result).decision, 'PROCEED');
    assert.equal(result.jobs.publish.result, 'success', step(result, 'publish', 'Re-establish the admitted unit, then stage it')?.stderr);
    assert.equal(outcomeOf(result), 'PUBLISHED_VERIFIED');
    assert.equal(servedCommitNow(world).commit, world.C2);
    assert.equal(servedCommitNow(world).certification.runId, '5102');

    assertCredentialConfined(world, result);
    assertNoPersistedCredentials(result);

    // THE TOOL WAS HANDED THE POLICY'S DESTINATION AND PIN, and only the staged tree.
    const call = world.publisher.calls[0].inputs;
    assert.deepEqual(
      [call.projectId, call.target, call.channelId, call.entryPoint, call.firebaseToolsVersion],
      [POLICY.hosting.project, POLICY.hosting.target, 'live', 'stage', POLICY.hosting.firebaseToolsVersion],
    );
    const published = world.publisher.published[0];
    assert.equal(published.site, POLICY.hosting.site);
    const record = retained(world, event, 'record.json');
    assert.equal(published.files.length, record.artifact.entryCount, 'the tool uploaded exactly the certified files');
    const verification = retained(world, event, 'verification.json');
    assert.equal(verification.files.checked, record.artifact.entryCount);
    assert.equal(verification.verified, true);

    // THE PRIVILEGED JOB HELD NO APPLICATION SOURCE.
    const checkouts = result.jobs.publish.steps.filter((s) => s.action === 'actions/checkout').map((s) => s.observed);
    const gateRevision = result.jobs.gate.outputs.policy_revision;
    assert.deepEqual(checkouts.map((c) => [c.path, c.ref, c.sparse]), [
      ['trusted', gateRevision, ['release']],
      ['current', 'main', ['release']],
      ['certified', world.C2, ['firebase.json', '.firebaserc']],
    ]);
    assert.ok(!result.jobs.publish.steps.some((s) => s.script && /\bnpm\b|\bnpx\b|ng build/.test(s.script)), 'the privileged job ran a package manager or a build');

    // SEQUENCE: the served identity is read by the gate, re-read inside the critical
    // section, published over, and read back — in that order.
    const events = world.log.filter((e) => (e.type === 'http' && e.origin === 'site' && e.path === '/release.json')
      || (e.type === 'step' && ['Decide', 'Re-establish the admitted unit, then stage it', 'Publish to Firebase Hosting', 'Verify what the origin serves'].includes(e.step)));
    const shape = events.map((e) => (e.type === 'http' ? 'read' : e.step));
    const at = (label, from = 0) => shape.indexOf(label, from);
    const decide = at('Decide');
    const preflight = at('Re-establish the admitted unit, then stage it');
    const publish = at('Publish to Firebase Hosting');
    const verify = at('Verify what the origin serves');
    assert.ok(shape.slice(0, decide).includes('read'), `the gate read the served identity: ${shape}`);
    assert.ok(shape.slice(preflight, publish).includes('read'), `the critical section re-read it: ${shape}`);
    assert.ok(shape.slice(verify).includes('read'), `the verification read it back: ${shape}`);
  });

  test('CONTROL: with publication NOT enabled the whole path runs and stops before the tool — WOULD_PUBLISH', async () => {
    const world = await makeWorld({ enabled: false });
    const result = await simulate(world, automaticEvent(world, 5102));
    assert.equal(decisionOf(result).decision, 'PROCEED');
    assert.equal(preflightOf(result).ok, true);
    assert.equal(step(result, 'publish', 'Publish to Firebase Hosting').outcome, 'skipped');
    assert.equal(outcomeOf(result), 'WOULD_PUBLISH');
    assert.equal(result.jobs.publish.result, 'success');
    assertNothingPublished(world, result);
    assert.equal(servedCommitNow(world).commit, world.C1, 'the served release is unchanged');
  });

  test('CONTRACT: outstanding owner prerequisites refuse at the gate; the publish job never starts', async () => {
    const world = await makeWorld({ prerequisites: 'committed', legacyWorkflow: true });
    const result = await simulate(world, automaticEvent(world, 5102));
    assert.equal(result.jobs.gate.result, 'failure', 'a refusal is red');
    // Red AT the decision, not only at the report after it. The job would still go red
    // through the report step if the Decide step discarded the CLI's status — which is
    // exactly why that has to be pinned here: the step an operator opens first must be
    // the one that says no, and softening the report later must not turn a refusal green.
    const decide = step(result, 'gate', 'Decide');
    assert.equal(decide.status, 1, 'the Decide step exits with the refusal');
    assert.equal(decide.outcome, 'failure');
    assert.equal(result.jobs.publish.result, 'skipped');
    const codes = codesOf(decisionOf(result));
    for (const code of ['prerequisite.source_protection_unrecorded', 'prerequisite.retention_unverified',
      'prerequisite.legacy_publisher_active', 'prerequisite.legacy_publisher_present']) {
      assert.ok(codes.includes(code), `${code} missing from ${codes}`);
    }
    assert.equal(outcomeOf(result), 'REFUSED');
    assertNothingPublished(world, result);
    assert.match(result.jobs.gate.summary, /Owner prerequisites outstanding/);
    assert.match(result.jobs.gate.summary, /deploy-prod\.yml` *\n?still builds and publishes/);
  });

  test('REGRESSION (R3.d): a policy that advanced between the jobs stops the publisher — an explicit restart', async () => {
    const world = await makeWorld();
    const result = await simulate(world, automaticEvent(world, 5102), {
      betweenJobs: async () => {
        const policy = JSON.parse(readFileSync(join(world.repo, 'release/policy.json'), 'utf8'));
        policy.eligibility.revoked = [{ commit: world.C1, reason: 'revoked while the gate was running' }];
        writeFileSync(join(world.repo, 'release/policy.json'), `${JSON.stringify(policy, null, 2)}\n`);
        commitAll(world.repo, 'policy moves on main');
        world.refreshApi();
      },
    });
    assert.equal(decisionOf(result).decision, 'PROCEED');
    assert.deepEqual(codesOf(preflightOf(result)), ['preflight.policy_advanced']);
    assert.equal(outcomeOf(result), 'PREFLIGHT_REFUSED');
    assert.equal(result.jobs.publish.result, 'failure');
    assertNothingPublished(world, result);
  });

  test('CONTRACT: a served release that changed between the jobs (the legacy writer) stops the publisher', async () => {
    const world = await makeWorld();
    const result = await simulate(world, automaticEvent(world, 5102), {
      betweenJobs: async () => { world.serve(world.candidates.twin); },
    });
    assert.equal(decisionOf(result).decision, 'PROCEED');
    assert.deepEqual(codesOf(preflightOf(result)), ['preflight.served_changed']);
    assertNothingPublished(world, result);
  });

  test('CONTRACT: a re-run of the certification between the jobs is a new certification — refused', async () => {
    const world = await makeWorld();
    const result = await simulate(world, automaticEvent(world, 5102), {
      betweenJobs: async () => {
        world.runs[5102] = { ...world.runs[5102], run_attempt: 2 };
        const rerun = await buildCandidate({ repo: world.repo, commit: world.C2, runId: 5102, runAttempt: 2, startedAt: world.runs[5102].run_started_at, marker: ' rerun' });
        world.artifacts.add(rerun);
        world.refreshApi();
      },
    });
    assert.deepEqual(codesOf(preflightOf(result)), ['preflight.attempt_changed']);
    assertNothingPublished(world, result);
  });

  test('CONTRACT: an admitted upload that expired before the publisher could fetch it — nothing published', async () => {
    const world = await makeWorld();
    const result = await simulate(world, automaticEvent(world, 5102), {
      betweenJobs: async () => {
        world.artifacts.get(world.ids.c2).expired = true;
        world.refreshApi();
      },
    });
    assert.equal(step(result, 'publish', 'Download the admitted candidate').outcome, 'failure');
    assert.equal(outcomeOf(result), 'PREFLIGHT_REFUSED');
    assertNothingPublished(world, result);
  });

  test('CONTRACT: bytes that do not match the listed digest are refused at download, in either job (fault injection)', async () => {
    const atGate = await makeWorld();
    writeFileSync(join(atGate.artifacts.get(atGate.ids.c2).dir, 'dist/styles-fixture.css'), 'altered');
    const gateResult = await simulate(atGate, automaticEvent(atGate, 5102));
    assert.equal(step(gateResult, 'gate', 'Download the candidate').outcome, 'failure');
    assert.ok(codesOf(decisionOf(gateResult)).includes('artifact.missing'));
    assertNothingPublished(atGate, gateResult);

    const atPublisher = await makeWorld();
    const pubResult = await simulate(atPublisher, automaticEvent(atPublisher, 5102), {
      betweenJobs: async () => { writeFileSync(join(atPublisher.artifacts.get(atPublisher.ids.c2).dir, 'dist/styles-fixture.css'), 'altered'); },
    });
    assert.equal(step(pubResult, 'publish', 'Download the admitted candidate').outcome, 'failure');
    assert.equal(outcomeOf(pubResult), 'PREFLIGHT_REFUSED');
    assertNothingPublished(atPublisher, pubResult);
  });

  test('REGRESSION (R3.g/h): a self-consistent substitute in the publisher\'s hands is refused (fault injection)', async () => {
    const world = await makeWorld();
    const result = await simulate(world, automaticEvent(world, 5102), {
      betweenJobs: async () => {
        // Not a claim that GitHub artifacts can be replaced: a stand-in for "the unit in
        // the publisher's hands is not the one the gate evaluated", however that arose.
        const entry = world.artifacts.get(world.ids.c2);
        entry.dir = world.candidates.twin.dir;
        entry.digest = artifactDigest(world.candidates.twin.dir);
        world.refreshApi();
      },
    });
    const codes = codesOf(preflightOf(result));
    assert.ok(codes.includes('preflight.artifact_replaced'), codes.join(','));
    assert.ok(codes.includes('preflight.candidate_mismatch'), codes.join(','));
    assertNothingPublished(world, result);
  });

  test('REGRESSION (R3.j): a .firebaserc alias that redirects the project is refused at the gate', async () => {
    const rc = JSON.parse(readFileSync(join(ROOT, '.firebaserc'), 'utf8'));
    rc.projects[POLICY.hosting.project] = 'somewhere-else';
    const world = await makeWorld({ c2Files: { '.firebaserc': `${JSON.stringify(rc, null, 2)}\n` } });
    const result = await simulate(world, automaticEvent(world, 5102));
    assert.ok(codesOf(decisionOf(result)).includes('hosting.project_alias_redirect'));
    assertNothingPublished(world, result);
  });

  test('REGRESSION (R3.i): an ignore rule that would drop the certified scripts is refused at the gate', async () => {
    const fb = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
    fb.hosting[0].ignore = [...fb.hosting[0].ignore, '**/*.js'];
    const world = await makeWorld({ c2Files: { 'firebase.json': `${JSON.stringify(fb, null, 2)}\n` } });
    const result = await simulate(world, automaticEvent(world, 5102));
    assert.ok(codesOf(decisionOf(result)).includes('hosting.ignore_changed'));
    assertNothingPublished(world, result);
  });

  test('REGRESSION (R3.k): a tool that publishes a DIFFERENT build of the same SHA is not reported as published', async () => {
    const world = await makeWorld();
    world.publisher.mode = 'wrong-candidate';
    world.publisher.substitute = join(world.candidates.twin.dir, 'dist');
    const event = automaticEvent(world, 5102);
    const result = await simulate(world, event);
    const verification = retained(world, event, 'verification.json');
    assert.equal(verification.identity.commit, world.C2, 'the served marker names the admitted commit');
    assert.equal(verification.servesCandidate, false);
    assert.equal(outcomeOf(result), 'PUBLISHED_DEGRADED');
    assert.equal(result.jobs.publish.result, 'failure');
  });

  for (const [mode, expected, why] of [
    ['partial', 'PUBLISHED_DEGRADED', 'a file the tool dropped is caught by fetching it back'],
    ['fail-after', 'PUBLISHED_DEGRADED', 'a tool that fails AFTER going live is not a clean failure'],
    ['fail-before', 'PUBLICATION_FAILED', 'a tool that fails before uploading publishes nothing'],
  ]) {
    test(`CONTRACT: ${why} — ${expected}`, async () => {
      const world = await makeWorld();
      world.publisher.mode = mode;
      const result = await simulate(world, automaticEvent(world, 5102));
      assert.equal(outcomeOf(result), expected);
      assert.equal(result.jobs.publish.result, 'failure');
    });
  }

  test('REGRESSION (R3.a): two certifications of one SHA are two candidates — an automatic twin is refused', async () => {
    const world = await makeWorld();
    world.serve(world.candidates.c2);
    const result = await simulate(world, automaticEvent(world, 5103));
    assert.ok(codesOf(decisionOf(result)).includes('served.same_commit_different_candidate'));
    assertNothingPublished(world, result);
  });

  test('CONTROL: an automatic re-delivery of exactly the served candidate is SKIPPED_IDENTICAL, green, and publishes nothing', async () => {
    const world = await makeWorld();
    world.serve(world.candidates.c2);
    const result = await simulate(world, automaticEvent(world, 5102));
    assert.equal(decisionOf(result).decision, 'SKIP_IDENTICAL');
    assert.equal(result.jobs.gate.result, 'success');
    assert.equal(step(result, 'gate', 'Decide').status, 0, 'a skip is not a refusal at the decision either');
    assert.equal(result.jobs.publish.result, 'skipped');
    assert.equal(outcomeOf(result), 'SKIPPED_IDENTICAL');
    assertNothingPublished(world, result);
  });

  test('CONTROL: an older automatic candidate after a newer one is served is SKIPPED_STALE', async () => {
    const world = await makeWorld();
    world.serve(world.candidates.c2);
    const result = await simulate(world, automaticEvent(world, 5101));
    assert.equal(decisionOf(result).decision, 'SKIP_STALE');
    assert.equal(result.jobs.gate.result, 'success', 'an automatic run that arrived late is not a failure');
    assert.equal(step(result, 'gate', 'Decide').status, 0);
    assert.equal(outcomeOf(result), 'SKIPPED_STALE');
    assertNothingPublished(world, result);
  });

  test('CONTROL: a deliberate manual redeploy of the served candidate is admitted and verified', async () => {
    const world = await makeWorld();
    world.listedForManual[world.C2] = [5102];
    world.refreshApi();
    world.serve(world.candidates.c2);
    const result = await simulate(world, manualEvent(world, world.C2, 'deploy'));
    assert.equal(decisionOf(result).decision, 'PROCEED');
    assert.equal(outcomeOf(result), 'PUBLISHED_VERIFIED');
    assertCredentialConfined(world, result);
  });

  test('CONTROL: an allowed manual rollback republishes the older certified artifact and verifies it', async () => {
    const world = await makeWorld();
    world.serve(world.candidates.c2);
    const result = await simulate(world, manualEvent(world, world.C1, 'rollback'));
    assert.equal(decisionOf(result).decision, 'PROCEED');
    assert.equal(outcomeOf(result), 'PUBLISHED_VERIFIED');
    assert.equal(servedCommitNow(world).commit, world.C1);
    assertCredentialConfined(world, result);
  });

  test('CONTRACT: an ordinary deploy may not move backward — rollback is its own mode', async () => {
    const world = await makeWorld();
    world.serve(world.candidates.c2);
    const result = await simulate(world, manualEvent(world, world.C1, 'deploy'));
    assert.ok(codesOf(decisionOf(result)).includes('rollback.implicit'));
    assertNothingPublished(world, result);
  });

  test('CONTRACT: Admin serving a different revision by promotion time stops the publisher', async () => {
    const world = await makeWorld();
    const result = await simulate(world, automaticEvent(world, 5102), {
      betweenJobs: async () => { serveCommit(world.adminOrigin, shared.A2); },
    });
    assert.deepEqual(codesOf(preflightOf(result)), ['preflight.peer_changed']);
    assertNothingPublished(world, result);
  });

  test('CONTRACT: a certification older than the window is refused at the gate', async () => {
    const world = await makeWorld({ certifyStartedAgo: 25 * 60 * MINUTE });
    const result = await simulate(world, automaticEvent(world, 5102));
    assert.ok(codesOf(decisionOf(result)).includes('certification.stale'));
    assertNothingPublished(world, result);
  });

  test('CONTRACT: a run of ANOTHER workflow that merely shares the display name is refused', async () => {
    const world = await makeWorld();
    world.runs[5102] = { ...world.runs[5102], path: '.github/workflows/impostor.yml' };
    world.refreshApi();
    const result = await simulate(world, automaticEvent(world, 5102));
    assert.ok(codesOf(decisionOf(result)).includes('certification.wrong_workflow'));
    assertNothingPublished(world, result);
  });

  test('CONTROL: a failed certification produces a skipped publication, not a red one', async () => {
    const world = await makeWorld();
    const result = await simulate(world, automaticEvent(world, 5102, { conclusion: 'failure' }));
    assert.equal(result.jobs.gate.result, 'skipped');
    assert.equal(result.jobs.publish.result, 'skipped');
    assert.equal(result.steps.length, 0);
    assertNothingPublished(world, result);
  });

  test('CONTRACT: the trigger filter — another branch, or another display name, starts nothing', async () => {
    const world = await makeWorld();
    const other = await simulate(world, automaticEvent(world, 5102, { branch: 'feature' }));
    assert.equal(other.triggered, false);
    const renamed = await simulate(world, automaticEvent(world, 5102, { name: 'Certify (copy)' }));
    assert.equal(renamed.triggered, false);
    assert.equal(world.publisher.calls.length, 0);
  });

  test('CONTRACT: a dispatch against another ref stops at the first step and reports that no decision was reached', async () => {
    const world = await makeWorld();
    const result = await simulate(world, manualEvent(world, world.C2, 'deploy', { ref: 'refs/heads/feature' }));
    assert.equal(step(result, 'gate', 'Refuse an unexpected event or ref').outcome, 'failure');
    assert.equal(result.jobs.publish.result, 'skipped');
    assert.equal(outcomeOf(result), 'REFUSED');
    assert.match(result.jobs.gate.summary, /stopped before its own code was checked out/);
    assertNothingPublished(world, result);
  });

  test('CONTRACT: an invalid policy on the default branch stops the gate before any decision — refused, and it says so', async () => {
    const world = await makeWorld();
    // After the candidates exist: the stamp would rightly refuse to certify under it.
    const policy = JSON.parse(readFileSync(join(world.repo, 'release/policy.json'), 'utf8'));
    policy.hosting.firebaseToolsVersion = 'latest';
    writeFileSync(join(world.repo, 'release/policy.json'), `${JSON.stringify(policy, null, 2)}\n`);
    commitAll(world.repo, 'an unpinned tool lands on main');
    world.refreshApi();
    const result = await simulate(world, automaticEvent(world, 5102));
    assert.equal(step(result, 'gate', 'Establish the certifying run').outcome, 'failure');
    assert.match(step(result, 'gate', 'Establish the certifying run').stderr, /the trusted policy is invalid/);
    assert.equal(step(result, 'gate', 'Decide').outcome, 'skipped');
    assert.equal(outcomeOf(result), 'REFUSED');
    assert.match(result.jobs.gate.summary, /the gate stopped before deciding/);
    assert.equal(result.jobs.publish.result, 'skipped');
    assertNothingPublished(world, result);
  });

  test('CONTRACT: every action the workflow uses is pinned to a full commit SHA', async () => {
    const world = await makeWorld({ enabled: true });
    const result = await simulate(world, automaticEvent(world, 5102));
    const uses = result.steps.filter((s) => s.action);
    assert.ok(uses.length > 0);
    for (const s of uses) assert.equal(s.pinned, true, `${s.name} uses ${s.uses}`);
  });
});
