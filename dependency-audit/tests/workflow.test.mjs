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
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

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
