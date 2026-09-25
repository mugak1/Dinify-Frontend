/**
 * DINIFY-FRONTEND'S WIRING: the dependency audit is part of BOTH the pull-request
 * `validate` check and the merged-main `certify` job, a failure in either cannot produce a
 * green result or a candidate, and nothing about the audit can authorize a publication on
 * its own. Repository-specific (the other test files in this directory are shared
 * byte-for-byte with Dinify-Admin).
 *
 * THE LEGACY PATH IS DISCLOSED, NOT CLAIMED: deploy-prod.yml runs on every push to main,
 * consumes no CI result, and therefore does not consume this audit either. One test below
 * pins that fact so it cannot be forgotten while the file exists.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

import { runWorkflow } from '../../release/tests/workflow-engine.mjs';
import { auditedProject, HIGH_RUNTIME_MISSING_CAUSE, SUPPORTED_CHAIN } from './project.mjs';
import { commandOf, loadWorkflow, runStep, simulateJob, statusSwallowers } from './workflow-harness.mjs';
import { parseYaml } from './yaml-subset.mjs';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const WF = (name) => join(ROOT, '.github/workflows', name);
const CI = loadWorkflow(WF('ci.yml'));
const CERTIFY = loadWorkflow(WF('certify.yml'));
const PUBLISH = loadWorkflow(WF('publish.yml'));
const LEGACY = loadWorkflow(WF('deploy-prod.yml'));
const AUDIT = loadWorkflow(WF('audit.yml'));
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const SNAPSHOT = 'npm run audit:snapshot';
const SCAN = 'npm run audit:deps';
const JOBS = { validate: CI.jobs.validate.steps, certify: CERTIFY.jobs.certify.steps };
const indexOfRun = (steps, run) => steps.findIndex((s) => commandOf(s) === run);

describe('the YAML subset reader agrees with the `yaml` library on every workflow here', () => {
  it('CONTRACT: identical parse of each workflow file (the oracle for the reader Dinify-Admin relies on)', () => {
    const YAML = createRequire(join(ROOT, 'package.json'))('yaml');
    for (const file of readdirSync(join(ROOT, '.github/workflows'))) {
      const text = readFileSync(WF(file), 'utf8');
      assert.deepEqual(parseYaml(text), YAML.parse(text), file);
    }
  });
});

describe('the audit is part of BOTH required validation paths', () => {
  for (const [job, steps] of Object.entries(JOBS)) {
    it(`CONTRACT (${job}): the snapshot is taken immediately after installation`, () => {
      const install = indexOfRun(steps, 'npm ci');
      assert.ok(install >= 0);
      assert.equal(indexOfRun(steps, SNAPSHOT), install + 1);
    });

    it(`CONTRACT (${job}): neither audit step can be skipped, softened or have its status rewritten`, () => {
      for (const run of [SNAPSHOT, SCAN, 'npm run test:audit']) {
        const step = steps[indexOfRun(steps, run)];
        assert.ok(step, `${run} is missing from ${job}`);
        assert.equal(step.if, undefined, `${run} has a condition`);
        assert.equal(step['continue-on-error'], undefined, `${run} can continue on error`);
        assert.equal(step.shell, undefined, `${run} overrides the shell`);
        assert.deepEqual(statusSwallowers(commandOf(step)), [], run);
      }
    });

    it(`CONTRACT (${job}): the pre-existing gates are all still present — the audit replaces none`, () => {
      for (const run of ['npm run type-check', 'npm run lint', 'npm run test:release', 'npm run test:tenant-boundary', 'npm run test:ci', 'npm run build:prod']) {
        assert.ok(indexOfRun(steps, run) >= 0, run);
      }
    });

    it(`REGRESSION MATRIX (${job}): the audit fails while the suite passes → the job is red`, () => {
      assert.equal(simulateJob(steps, () => 'success').conclusion, 'success', 'CONTROL: all green is green');
      assert.equal(simulateJob(steps, (s) => (commandOf(s) === SCAN ? 'failure' : 'success')).conclusion, 'failure');
      assert.equal(simulateJob(steps, (s) => (commandOf(s) === SCAN ? 'cancelled' : 'success')).conclusion, 'cancelled');
      assert.equal(simulateJob(steps, (s) => (commandOf(s) === 'npm run test:ci' ? 'failure' : 'success')).conclusion, 'failure', 'an existing gate still fails the job');
    });
  }

  it('CONTRACT: in validate the scan is the last validation step, followed only by evidence retention', () => {
    const steps = JOBS.validate;
    const after = steps.slice(indexOfRun(steps, SCAN) + 1);
    assert.deepEqual(after.map((s) => s.name), ['Retain the dependency-audit evidence']);
    assert.equal(after[0].if, 'always()');
  });

  it('REGRESSION MATRIX (certify): a failed or incomplete audit leaves NO candidate — nothing is built, stamped or uploaded', () => {
    const steps = JOBS.certify;
    const scan = indexOfRun(steps, SCAN);
    const candidate = ['Build the shipping candidate', 'Stamp the release identity and provenance', 'Upload the candidate'];
    for (const name of candidate) assert.ok(steps.findIndex((s) => s.name === name) > scan, `${name} runs before the audit`);
    const r = simulateJob(steps, (s) => (commandOf(s) === SCAN ? 'failure' : 'success'));
    assert.equal(r.conclusion, 'failure');
    for (const name of candidate) assert.deepEqual(r.ran.find(([n]) => n === name), [name, 'skipped']);
    assert.deepEqual(r.ran.find(([n]) => n === 'Retain the dependency-audit evidence'), ['Retain the dependency-audit evidence', 'success']);
  });

  it('CONTRACT: the evidence artifact cannot be mistaken for the candidate the publisher selects', () => {
    const uploads = JOBS.certify.filter((s) => String(s.uses).startsWith('actions/upload-artifact@'));
    assert.deepEqual(uploads.map((s) => s.with.name), ['frontend-release-${{ github.run_id }}-${{ github.run_attempt }}', 'dependency-audit-${{ github.run_id }}-${{ github.run_attempt }}']);
  });

  it('REGRESSION MATRIX: the step\'s own shell propagates the audit\'s exit status; a pipe under the default shell would not', () => {
    const script = JOBS.validate[indexOfRun(JOBS.validate, SCAN)].run;
    assert.equal(runStep(script, { npmExit: 0 }).status, 0, 'CONTROL');
    assert.equal(runStep(script, { npmExit: 1 }).status, 1);
    assert.equal(runStep(script, { npmExit: 2 }).status, 2);
    assert.equal(runStep(`${SCAN} | tee audit.log\n`, { npmExit: 2 }).status, 0, 'NEGATIVE CONTROL: `bash -e` without pipefail hides it');
  });

  it('CONTRACT: the npm scripts behind the steps are the pinned evaluator, self-test first', () => {
    assert.equal(PKG.scripts['audit:snapshot'], 'node dependency-audit/cli.mjs snapshot');
    assert.equal(PKG.scripts['audit:deps'], 'node dependency-audit/cli.mjs self-test && node dependency-audit/cli.mjs audit');
    assert.equal(PKG.scripts['test:audit'], 'node --test dependency-audit/tests/*.test.mjs');
  });
});

describe('an unaccounted vulnerability fails `validate` and leaves NO candidate — decided by the real evaluator, carried by the real steps', () => {
  // The chain is EXECUTED, not assumed, four links long:
  //   1. the real audit() decides a SYNTHETIC answer injected at its runner seam, and
  //      leaves its evidence on disk;
  //   2. the `npm run audit:deps` step exactly as each job declares it runs under the
  //      runner's default shell, with `npm` answered by the REAL `evaluate` command over
  //      that evidence — so the step's status is the evaluator's own exit status;
  //   3. GitHub's step sequencing over the actual `validate` and `certify` steps turns
  //      that status into each job's conclusion;
  //   4. the release engine EXECUTES publish.yml for a Certify run that concluded that
  //      way, with the publication variable ON and the credential PRESENT, and records
  //      every step, secret read and publisher call.
  const within = (answer, fn) => { const p = auditedProject(answer); try { return fn(p); } finally { p.cleanup(); } };
  const jobWith = (steps, p) => {
    const scanStep = steps[indexOfRun(steps, SCAN)];
    const step = runStep(scanStep.run, { npmBody: p.evaluateCommand });
    const job = simulateJob(steps, (s) => (s === scanStep ? (step.status === 0 ? 'success' : 'failure') : 'success'));
    return { step, job };
  };
  const CANDIDATE = ['Resolve the shipping configuration from the committed policy', 'Build the shipping candidate', 'Stamp the release identity and provenance', 'Upload the candidate'];
  const RETAIN = 'Retain the dependency-audit evidence';

  for (const [name, steps] of Object.entries(JOBS)) {
    it(`REGRESSION MATRIX (${name}): a HIGH runtime entry whose cause the report does not list turns the job red with status 2`, () => within(HIGH_RUNTIME_MISSING_CAUSE, (p) => {
      assert.equal(p.result.outcome, 'incomplete');
      const { step, job } = jobWith(steps, p);
      assert.equal(step.status, 2, step.stdout + step.stderr);
      assert.match(step.stdout, /scanner_dangling_cause/);
      assert.equal(job.conclusion, 'failure');
    }));

    it(`CONTROL (${name}): the same path with a supported dependency chain is green`, () => within(SUPPORTED_CHAIN, (p) => {
      const { step, job } = jobWith(steps, p);
      assert.equal(step.status, 0, step.stdout + step.stderr);
      assert.equal(job.conclusion, 'success');
    }));
  }

  it('REGRESSION MATRIX (certify): that failure builds, stamps and uploads NOTHING', () => within(HIGH_RUNTIME_MISSING_CAUSE, (p) => {
    const { job } = jobWith(JOBS.certify, p);
    for (const step of CANDIDATE) assert.deepEqual(job.ran.find(([n]) => n === step), [step, 'skipped']);
    // CONTROL: a supported chain does reach them, so the skip above is the audit's doing.
    within(SUPPORTED_CHAIN, (q) => {
      const green = jobWith(JOBS.certify, q).job;
      for (const step of CANDIDATE) assert.deepEqual(green.ran.find(([n]) => n === step), [step, 'success']);
    });
  }));

  it('REGRESSION MATRIX: the evidence is retained on that failure in both jobs, and `if: always()` does not rescue either', () => within(HIGH_RUNTIME_MISSING_CAUSE, (p) => {
    for (const [name, steps] of Object.entries(JOBS)) {
      const { job } = jobWith(steps, p);
      const retain = steps.find((s) => s.name === RETAIN);
      assert.equal(retain.if, 'always()', name);
      assert.equal(retain.with.path, 'dependency-audit/evidence/', name);
      assert.deepEqual(job.ran.find(([n]) => n === RETAIN), [RETAIN, 'success'], `${name}: the evidence step ran after the failure`);
      assert.equal(job.conclusion, 'failure', `${name}: collecting the evidence did not turn the job green`);
      // A retention step that itself failed would not make a failed job pass either.
      assert.equal(simulateJob(steps, (s) => (s === retain || commandOf(s) === SCAN ? 'failure' : 'success')).conclusion, 'failure', name);
    }
    // What that step collects is on disk and says why: the raw answer, byte for byte, and
    // a result that names the unaccounted cause.
    assert.equal(readFileSync(join(p.evidence, 'application.scanner-stdout.txt'), 'utf8'), HIGH_RUNTIME_MISSING_CAUSE.stdout);
    const result = JSON.parse(readFileSync(join(p.evidence, 'result.json'), 'utf8'));
    assert.equal(result.outcome, 'incomplete');
    assert.ok(result.reasons.some((r) => r.code === 'scanner_dangling_cause'));
    assert.ok(existsSync(join(p.evidence, 'collection.json')) && existsSync(join(p.evidence, 'snapshot.json')));
  }));

  it('CONTRACT (certify): the always() summary, executed as written, states that no candidate was produced', () => {
    const summarise = JOBS.certify.find((s) => s.name === 'Summarise');
    assert.equal(summarise.if, 'always()');
    const dir = mkdtempSync(join(tmpdir(), 'summarise-'));
    try {
      const out = join(dir, 'summary.md');
      const r = spawnSync('bash', ['-e', '-c', summarise.run], { cwd: dir, env: { PATH: '/usr/bin:/bin', GITHUB_STEP_SUMMARY: out }, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(readFileSync(out, 'utf8'), /no candidate was produced/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const certifyRun = (conclusion) => ({
    name: 'workflow_run', ref: 'refs/heads/main', sha: '1'.repeat(40), runId: 9701, runAttempt: 1,
    payload: { action: 'completed', workflow_run: { id: 9700, name: CERTIFY.name, head_sha: '2'.repeat(40), head_branch: 'main', conclusion, event: 'push', path: '.github/workflows/certify.yml' } },
  });
  // Publication switched ON and the credential PRESENT, so nothing but the Certify
  // conclusion stands between that run and the publisher.
  const world = () => ({
    log: [], token: 'simulated-token', repository: 'mugak1/Dinify-Frontend',
    secrets: { FIREBASE_SERVICE_ACCOUNT: 'simulated-credential-never-read' }, vars: { FRONTEND_PUBLISH_ENABLED: 'true' },
    publisher: { calls: [], published: [] },
  });

  it('LOCAL WORKFLOW SIMULATION: publish.yml, executed for the Certify run that audit failed, runs no step, reads no secret and calls no publisher', async () => {
    const conclusion = within(HIGH_RUNTIME_MISSING_CAUSE, (p) => jobWith(JOBS.certify, p).job.conclusion);
    assert.equal(conclusion, 'failure');
    const w = world();
    const result = await runWorkflow({ workflowPath: WF('publish.yml'), event: certifyRun(conclusion), world: w });
    assert.equal(result.triggered, true, 'a completed Certify run does trigger publish.yml — the jobs are what refuse it');
    assert.equal(result.jobs.gate.result, 'skipped');
    assert.equal(result.jobs.publish.result, 'skipped');
    assert.deepEqual(result.steps, []);
    assert.deepEqual(result.secretAccess, []);
    assert.deepEqual(w.publisher.calls, []);
    assert.deepEqual(w.publisher.published, []);
    assert.deepEqual(w.log.filter((e) => e.type === 'step'), []);
  });

  it('CONTROL (LOCAL WORKFLOW SIMULATION): for a SUCCESSFUL Certify run the gate job does start — the skip above is the conclusion\'s doing', async () => {
    const conclusion = within(SUPPORTED_CHAIN, (p) => jobWith(JOBS.certify, p).job.conclusion);
    assert.equal(conclusion, 'success');
    const w = world();
    const reached = [];
    const stop = new Error('stopped at the first gate step');
    // FAULT INJECTION: the run is halted before its first step executes, so the control
    // proves the gate is ADMITTED without running any of it.
    const hooks = { beforeStep: ({ job, step }) => { reached.push([job, step]); throw stop; } };
    await assert.rejects(runWorkflow({ workflowPath: WF('publish.yml'), event: certifyRun(conclusion), world: w, hooks }), (e) => e === stop);
    assert.equal(reached.length, 1);
    assert.equal(reached[0][0], 'gate');
    assert.deepEqual(w.publisher.calls, []);
  });
});

describe('what the audit does and does not authorize', () => {
  it('CONTRACT: publication can follow only a SUCCESSFUL Certify run, so a failed audit there reaches no publisher', () => {
    assert.deepEqual(PUBLISH.on.workflow_run.workflows, [CERTIFY.name]);
    assert.match(String(PUBLISH.jobs.gate.if), /github\.event\.workflow_run\.conclusion == 'success'/);
  });

  it('CONTRACT: the scheduled audit is not a workflow anything triggers on, and uses the same evaluator', () => {
    assert.deepEqual(Object.keys(AUDIT.on).sort(), ['schedule', 'workflow_dispatch']);
    for (const file of readdirSync(join(ROOT, '.github/workflows'))) {
      const consumed = loadWorkflow(WF(file)).on?.workflow_run?.workflows ?? [];
      assert.ok(!consumed.includes(AUDIT.name), `${file} triggers on the audit workflow`);
      assert.doesNotMatch(readFileSync(WF(file), 'utf8'), /npm audit --audit-level/, `${file} runs a raw threshold audit`);
    }
    assert.deepEqual(AUDIT.jobs.audit.steps.map(commandOf).filter(Boolean), ['npm ci', SNAPSHOT, SCAN]);
  });

  it('DISCLOSURE: the live legacy deploy-prod.yml runs on push and consumes NO validation result, this audit included', () => {
    // Stated so it cannot be claimed otherwise: until the reviewed cutover deletes this
    // file, a merge publishes whatever main builds, whatever `validate` or `certify` said.
    assert.deepEqual(LEGACY.on.push.branches, ['main']);
    assert.equal(LEGACY.on.workflow_run, undefined);
    const runs = LEGACY.jobs['build-and-deploy'].steps.map(commandOf).filter(Boolean);
    assert.ok(!runs.some((r) => r.includes('audit')), 'the legacy path runs no audit');
  });
});
