/**
 * THE WORKFLOW FILES, HELD TO THE POLICY AND TO THEIR OWN STATED SHAPE.
 *
 * workflow-simulation.test.mjs EXECUTES publish.yml and proves what its steps do. This
 * file proves what the three workflow files ARE, statically, for the properties an
 * execution cannot show because the simulation would simply follow whatever the file
 * says: that the credential is referenced in exactly one place, that no expression is
 * interpolated into a shell script, that every action is pinned to a commit, that the
 * destination the tool is handed is the one the policy pins, and that the legacy path
 * still consumes the configuration this directory certifies — which is the disclosure
 * a merge of this directory owes (release/README.md, "What merging does").
 *
 * Every literal compared here is READ from release/policy.json or from another
 * workflow file, never retyped, so a test cannot agree with a stale copy of itself.
 *
 * Labels, as in the other suites: REGRESSION pins a finding reproduced on 3386724,
 * CONTRACT pins a rule this change introduces, CONTROL pins something that must NOT
 * change.
 */

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { certifiedArtifactName } from '../lib/decide.mjs';
import { ROOT } from './harness.mjs';
import { MODELLED_ACTIONS, parseWorkflow } from './workflow-engine.mjs';

const POLICY = JSON.parse(readFileSync(join(ROOT, 'release/policy.json'), 'utf8'));
const PATHS = {
  publish: join(ROOT, '.github/workflows/publish.yml'),
  certify: join(ROOT, POLICY.certification.workflowPath),
  ci: join(ROOT, '.github/workflows/ci.yml'),
  legacy: join(ROOT, POLICY.prerequisites.singlePublisher.legacyWorkflow),
};
const TEXT = Object.fromEntries(Object.entries(PATHS).filter(([, p]) => existsSync(p)).map(([k, p]) => [k, readFileSync(p, 'utf8')]));
const PUBLISH = parseWorkflow(PATHS.publish);
const CERTIFY = parseWorkflow(PATHS.certify);
const CI = parseWorkflow(PATHS.ci);

/** Every step of every job, with where it lives. */
function stepsOf(workflow) {
  return Object.entries(workflow.jobs).flatMap(([job, def]) => (def.steps ?? []).map((step, index) => ({ job, index, step })));
}
const byName = (workflow, job, name) => workflow.jobs[job].steps.find((s) => s.name === name);
const actionOf = (uses) => String(uses).split('@')[0];

describe('publish.yml, statically, against release/policy.json', () => {
  it('CONTRACT: it runs only on a completed Certify on main, or a manual dispatch — never on a pull request or a push', () => {
    assert.deepEqual(Object.keys(PUBLISH.on).sort(), ['workflow_dispatch', 'workflow_run']);
    const wr = PUBLISH.on.workflow_run;
    // The display name is READ from the certifying workflow, so renaming it without
    // updating this filter fails here rather than silently never triggering.
    assert.deepEqual(wr.workflows, [CERTIFY.name]);
    assert.deepEqual(wr.types, ['completed']);
    assert.deepEqual(wr.branches, [POLICY.defaultBranch]);
    const inputs = PUBLISH.on.workflow_dispatch.inputs;
    assert.deepEqual(Object.keys(inputs).sort(), ['mode', 'sha']);
    assert.deepEqual(inputs.mode.options, ['deploy', 'rollback']);
    assert.equal(inputs.sha.required, true);
  });

  it('CONTRACT: no top-level permission, and every job holds exactly contents:read + actions:read — no id-token, no write', () => {
    assert.deepEqual(PUBLISH.permissions, {});
    for (const [job, def] of Object.entries(PUBLISH.jobs)) {
      assert.deepEqual(def.permissions, { contents: 'read', actions: 'read' }, job);
    }
  });

  it('REGRESSION (privilege separation): the service-account secret is referenced ONCE, by the tool step of the publish job', () => {
    // Counted on the RAW text, comments included: a secret mentioned anywhere is a
    // secret one edit from being used there.
    const mentions = TEXT.publish.match(/secrets\./g) ?? [];
    assert.equal(mentions.length, 1, 'exactly one secrets.* reference in the file');
    const holders = stepsOf(PUBLISH).filter(({ step }) => JSON.stringify(step).includes('secrets.'));
    assert.deepEqual(holders.map(({ job, step }) => [job, step.name]), [['publish', 'Publish to Firebase Hosting']]);
    assert.equal(holders[0].step.with.firebaseServiceAccount, '${{ secrets.FIREBASE_SERVICE_ACCOUNT }}');
    assert.equal(holders[0].step.env, undefined, 'the secret never reaches a shell environment');
  });

  it('CONTRACT: no expression is interpolated into a shell script — every value reaches a script through env', () => {
    for (const [name, workflow] of [['publish', PUBLISH], ['certify', CERTIFY], ['ci', CI]]) {
      for (const { job, step } of stepsOf(workflow)) {
        if (typeof step.run !== 'string') continue;
        assert.ok(!step.run.includes('${{'), `${name}.${job}.${step.name ?? step.run.slice(0, 30)} interpolates an expression into its script`);
      }
    }
  });

  it('CONTRACT: every script in the publication path fails on the first error and swallows none', () => {
    assert.ok(!TEXT.publish.includes('|| true'), 'publish.yml discards an exit status');
    for (const { job, step } of stepsOf(PUBLISH)) {
      if (typeof step.run !== 'string') continue;
      assert.match(step.run, /^set -euo pipefail\n/, `${job}.${step.name}`);
    }
  });

  it('REGRESSION (R3): every action is pinned to a full commit SHA with its version recorded beside it', () => {
    const lines = TEXT.publish.split('\n').filter((l) => /^\s*(-\s+)?uses:/.test(l));
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.match(line, /uses: [A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40} # v\S+$/, line.trim());
    }
  });

  it('CONTRACT: every action the file uses is one the simulation executes — a new action cannot pass unexercised', () => {
    const used = new Set(stepsOf(PUBLISH).filter(({ step }) => step.uses).map(({ step }) => actionOf(step.uses)));
    for (const action of used) assert.ok(MODELLED_ACTIONS.includes(action), `${action} is not modelled in workflow-engine.mjs`);
  });

  it('REGRESSION (R3): the tool is handed exactly the policy destination, the pinned tool version and the staged directory', () => {
    const deploy = byName(PUBLISH, 'publish', 'Publish to Firebase Hosting');
    assert.match(deploy.uses, /^FirebaseExtended\/action-hosting-deploy@[0-9a-f]{40}$/);
    assert.deepEqual(Object.keys(deploy.with).sort(), [
      'channelId', 'disableComment', 'entryPoint', 'firebaseServiceAccount', 'firebaseToolsVersion', 'projectId', 'target',
    ], 'no repoToken, no expires, nothing that widens what the tool may do');
    assert.equal(deploy.with.projectId, POLICY.hosting.project);
    assert.equal(deploy.with.target, POLICY.hosting.target);
    assert.equal(deploy.with.channelId, POLICY.hosting.channelId);
    assert.equal(deploy.with.firebaseToolsVersion, POLICY.hosting.firebaseToolsVersion);
    // entryPoint is the directory the preflight STAGES into — the regenerated
    // configuration beside the verified payload, and nothing else.
    const preflight = byName(PUBLISH, 'publish', 'Re-establish the admitted unit, then stage it');
    const staged = /--stage (\S+)/.exec(preflight.run)?.[1];
    assert.equal(deploy.with.entryPoint, staged);
    const verify = byName(PUBLISH, 'publish', 'Verify what the origin serves');
    assert.equal(/--stage (\S+)/.exec(verify.run)?.[1], staged, 'verification reads the same staged tree');
  });

  it('CONTRACT: publication is gated on the variable the policy names, and on nothing a candidate controls', () => {
    const enablement = byName(PUBLISH, 'publish', 'Publication enablement');
    assert.equal(enablement.env.ENABLED, `\${{ vars.${POLICY.publication.enablementVariable} }}`);
    const deploy = byName(PUBLISH, 'publish', 'Publish to Firebase Hosting');
    assert.equal(deploy.if, "steps.enablement.outputs.enabled == 'true'");
    // BOTH of the gate's own decision outputs, never the gate JOB's result: a gate that
    // completed a non-publishing evaluation is green and has admitted nothing, so
    // "the gate succeeded" cannot be what starts the credentialed job. The implicit
    // success() still applies on top — this expression names no status function.
    assert.equal(PUBLISH.jobs.publish.if, "needs.gate.outputs.decision == 'PROCEED' && needs.gate.outputs.allow == 'true'");
    assert.ok(!/needs\.gate\.result|success\(\)|always\(\)|failure\(\)|cancelled\(\)/.test(PUBLISH.jobs.publish.if),
      'the publish job keys on a job status, not the admitted decision');
  });

  it('CONTRACT: the readiness wrapper reads the SAME variable, and translates exactly one status', () => {
    const decide = byName(PUBLISH, 'gate', 'Decide');
    assert.equal(decide.env.ENABLEMENT, `\${{ vars.${POLICY.publication.enablementVariable} }}`);
    const script = decide.run;
    // `decide` runs first and writes the decision the report reads; `readiness` is asked
    // only inside the status-1 branch, and the step exits with `decide`'s own status
    // everywhere else.
    assert.ok(script.indexOf('cli.mjs decide') < script.indexOf('cli.mjs readiness'));
    assert.match(script, /if \[ "\$status" -eq 1 \]; then[\s\S]*cli\.mjs readiness[\s\S]*exit "\$readiness"\n\s*fi\n\s*exit "\$status"\s*$/);
    assert.match(script, /--enablement "\$ENABLEMENT"/);
    assert.match(script, /rm -f readiness\.json[\s\S]*cli\.mjs decide/, 'a stale classification is removed before deciding');
    // The report reads the classification, and nothing else in the gate does.
    const report = byName(PUBLISH, 'gate', 'Report the outcome');
    assert.match(report.run, /cli\.mjs outcome --decision decision\.json[^\n]*--readiness readiness\.json/);
    assert.equal(report.if, "always() && steps.decide.outputs.decision != 'PROCEED'");
    // No output the publish job reads is written by the readiness step.
    assert.deepEqual(Object.keys(PUBLISH.jobs.gate.outputs).sort(),
      ['allow', 'artifact_id', 'decision', 'policy_revision', 'record', 'record_digest', 'run_id', 'sha']);
    for (const [name, value] of Object.entries(PUBLISH.jobs.gate.outputs)) {
      if (name !== 'sha') assert.match(value, /^\$\{\{ steps\.decide\.outputs\.[a-z_]+ \}\}$/, name);
    }
  });

  it('CONTRACT: the gate is named for what it does on every merge, and the run says which kind it was', () => {
    assert.equal(PUBLISH.jobs.gate.name, 'Evaluate release readiness (non-publishing)');
    assert.equal(PUBLISH.jobs.publish.name, 'Publish admitted candidate');
    assert.match(PUBLISH['run-name'], /Readiness evaluation: automatic/);
    assert.match(PUBLISH['run-name'], /Release attempt: manual/);
  });

  it('REGRESSION (R3.d): the publisher runs the verifier the GATE ran — its revision, not main as it is now', () => {
    const trustedGate = byName(PUBLISH, 'gate', 'Check out the trusted gate code');
    assert.equal(trustedGate.with.ref, '${{ github.sha }}');
    assert.equal(trustedGate.with['fetch-depth'], 0, 'ancestry and ordering are answered from full history');
    assert.equal(PUBLISH.jobs.gate.outputs.policy_revision, '${{ steps.decide.outputs.policy_revision }}');

    const verifier = byName(PUBLISH, 'publish', 'Check out the verifier the gate ran');
    assert.equal(verifier.with.ref, '${{ needs.gate.outputs.policy_revision }}');
    assert.equal(verifier.with.path, 'trusted');
    assert.equal(verifier.with['sparse-checkout'], 'release');
    // The default branch's release tree, read only to NOTICE a policy that moved.
    const current = byName(PUBLISH, 'publish', 'Check out the default branch\'s release tree');
    assert.equal(current.with.ref, POLICY.defaultBranch);
    assert.equal(current.with['sparse-checkout'], 'release');
    // Every command the publish job runs is the pinned verifier's.
    for (const { job, step } of stepsOf(PUBLISH)) {
      if (job !== 'publish' || typeof step.run !== 'string' || !step.run.includes('cli.mjs')) continue;
      assert.match(step.run, /node trusted\/release\/cli\.mjs /, step.name);
      assert.ok(!/node (current\/)?release\/cli\.mjs/.test(step.run), `${step.name} runs an unpinned verifier`);
    }
  });

  it('CONTRACT: the publish job checks out no application source and runs no install or build', () => {
    for (const { job, step } of stepsOf(PUBLISH)) {
      if (job !== 'publish') continue;
      if (actionOf(step.uses) === 'actions/checkout') {
        assert.ok(step.with['sparse-checkout'], `${step.name} checks out a whole tree`);
      }
      if (typeof step.run === 'string') {
        assert.ok(!/\b(npm|npx|yarn|pnpm|ng)\b/.test(step.run), `${step.name} runs a package manager or a build`);
      }
    }
    const certified = byName(PUBLISH, 'publish', 'Check out the certified hosting configuration');
    assert.equal(certified.with.ref, '${{ needs.gate.outputs.sha }}');
    assert.deepEqual(String(certified.with['sparse-checkout']).trim().split('\n').map((s) => s.trim()).sort(), ['.firebaserc', 'firebase.json']);
    assert.equal(certified.with['sparse-checkout-cone-mode'], false);
  });

  it('CONTRACT: every checkout, in the publication path and in certification, leaves no credential behind', () => {
    for (const [name, workflow] of [['publish', PUBLISH], ['certify', CERTIFY]]) {
      for (const { job, step } of stepsOf(workflow)) {
        if (actionOf(step.uses) !== 'actions/checkout') continue;
        assert.equal(step.with?.['persist-credentials'], false, `${name}.${job}.${step.name}`);
      }
    }
  });

  it('REGRESSION (R3.e): the candidate is downloaded BY ID from the certifying run, and a digest mismatch is an error', () => {
    const downloads = stepsOf(PUBLISH).filter(({ step }) => actionOf(step.uses) === 'actions/download-artifact');
    assert.deepEqual(downloads.map(({ job }) => job), ['gate', 'publish']);
    for (const { job, step } of downloads) {
      assert.equal(step.with.name, undefined, `${job} downloads by name`);
      assert.ok(step.with['artifact-ids'], `${job} names no artifact id`);
      assert.ok(step.with['run-id'], `${job} names no run`);
      assert.ok(step.with['github-token'], `${job} cannot read another run's artifact`);
      assert.equal(step.with['digest-mismatch'], 'error', job);
      assert.equal(step.with['merge-multiple'], true, job);
    }
    assert.equal(downloads[1].step.with['artifact-ids'], '${{ needs.gate.outputs.artifact_id }}');
    assert.equal(downloads[1].step.with['run-id'], '${{ needs.gate.outputs.run_id }}');
  });

  it('CONTRACT: one concurrency group, never cancelled mid-flight (its pending-run limit is disclosed in the file)', () => {
    assert.deepEqual(PUBLISH.concurrency, { group: 'publish-frontend', 'cancel-in-progress': false });
    assert.match(TEXT.publish, /at most one\s*\n?#?\s*PENDING run per group/);
  });
});

describe('certify.yml and ci.yml, against the policy and each other', () => {
  it('CONTRACT: certification is a push to the default branch, read-only, and references no secret', () => {
    assert.deepEqual(Object.keys(CERTIFY.on), [POLICY.certification.event]);
    assert.deepEqual(CERTIFY.on[POLICY.certification.event].branches, [POLICY.certification.branch]);
    assert.deepEqual(CERTIFY.permissions, { contents: 'read' });
    assert.ok(!TEXT.certify.includes('secrets.'), 'certify.yml references a secret');
  });

  it('CONTRACT: every check the policy requires is a job of the certifying workflow, by its reported name', () => {
    const reported = Object.entries(CERTIFY.jobs).map(([key, def]) => def.name ?? key);
    for (const required of POLICY.certification.requiredChecks) assert.ok(reported.includes(required), required);
  });

  it('CONTRACT: the artifact certify.yml uploads is the one the gate selects, and the one the stamp names', () => {
    const upload = stepsOf(CERTIFY).find(({ step }) => actionOf(step.uses) === 'actions/upload-artifact').step;
    const resolve = (template) => template.replace('${{ github.run_id }}', '4242').replace('${{ github.run_attempt }}', '1');
    assert.equal(resolve(upload.with.name), certifiedArtifactName('4242', '1'));
    const stamp = byName(CERTIFY, 'certify', 'Stamp the release identity and provenance');
    assert.match(stamp.run, /--artifactName "frontend-release-\$RUN_ID-\$RUN_ATTEMPT"/);
    assert.equal(stamp.env.RUN_ID, '${{ github.run_id }}');
    assert.equal(stamp.env.RUN_ATTEMPT, '${{ github.run_attempt }}');
  });

  it('CONTROL: certification runs the same validation commands, in the same order, as the required `validate` check', () => {
    assert.ok(CI.jobs.validate, 'the required status check is the job named `validate`');
    const contract = (workflow, job) => workflow.jobs[job].steps
      .filter((s) => typeof s.run === 'string' && /^npm (ci|run \S+)$/.test(s.run.trim()))
      .map((s) => s.run.trim());
    const certified = contract(CERTIFY, 'certify');
    assert.deepEqual(certified, contract(CI, 'validate'));
    assert.ok(certified.includes('npm run test:release'), 'the release contract is part of both');
  });

  it('CONTRACT: both certify.yml and ci.yml build the shipping configuration by reading it from the policy', () => {
    for (const [name, workflow] of [['certify', CERTIFY], ['ci', CI]]) {
      const reads = stepsOf(workflow).some(({ step }) => typeof step.run === 'string'
        && step.run.includes("require('./release/policy.json').build.configuration"));
      assert.ok(reads, `${name} types its configuration instead of reading it`);
    }
  });
});

describe('the legacy path — what merging this directory still changes', () => {
  it('CONTRACT (disclosure): the live deploy-prod.yml builds THE configuration this directory certifies', () => {
    // #686 described itself as inert. It was not: it changed the angular.json
    // configuration named below, and the legacy workflow builds exactly that
    // configuration on every merge to main. A merge touching it changes what the LIVE
    // path builds, whatever this workflow does; release/README.md records the measured
    // before/after digests. If the legacy path stops building this configuration, the
    // disclosure changes, and this test is where that is noticed.
    assert.ok(TEXT.legacy, `${POLICY.prerequisites.singlePublisher.legacyWorkflow} is expected to exist while it is the live path`);
    const configurations = [...TEXT.legacy.matchAll(/ng build --configuration=([a-z0-9-]+)/g)].map((m) => m[1]);
    assert.deepEqual(configurations, [POLICY.build.configuration]);
  });

  it('CONTRACT: while the legacy workflow exists, the policy cannot claim a single publisher', () => {
    assert.ok(existsSync(PATHS.legacy));
    assert.notEqual(POLICY.prerequisites.singlePublisher.status, 'single-publisher');
  });

  it('CONTROL: the legacy workflow is untouched by this change — it still publishes on every push to main', () => {
    const legacy = parseWorkflow(PATHS.legacy);
    assert.deepEqual(legacy.on.push.branches, ['main']);
    const deploy = stepsOf(legacy).find(({ step }) => String(step.uses).startsWith('FirebaseExtended/action-hosting-deploy'));
    assert.ok(deploy, 'the legacy path still deploys');
    assert.equal(deploy.step.with.projectId, POLICY.hosting.project);
    assert.equal(deploy.step.with.target, POLICY.hosting.target);
  });
});
