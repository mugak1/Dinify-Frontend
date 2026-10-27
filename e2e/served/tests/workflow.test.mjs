/**
 * .github/workflows/uat-journeys.yml, PINNED.
 *
 * The workflow handles the owner's credentials in a public repository, so each
 * property it relies on is asserted here rather than left to review: the
 * trigger, the permissions, SHA-pinned actions, where the secrets may appear,
 * the masking, the absence of trace, HAR and video uploads, and the redaction
 * scan that must pass before the one file it uploads.
 *
 * It parses the file with the repository's YAML subset reader
 * (dependency-audit/tests/yaml-subset.mjs), imported read-only. That reader is
 * held equal to the `yaml` library on EVERY workflow file by
 * dependency-audit/tests/workflow.test.mjs, which `validate` runs, so this file
 * needs no node_modules and runs inside the dispatched workflow too.
 *
 *   node --test "e2e/served/tests/*.test.mjs"
 */
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

import { parseYaml } from '../../../dependency-audit/tests/yaml-subset.mjs';
// A namespace import, so a name this branch adds reads as undefined (a failing
// assertion) rather than a link error that hides every other test in the file.
import * as RUNMOD from '../run.mjs';

const ROOT = resolve(new URL('../../..', import.meta.url).pathname);
const DIR = join(ROOT, '.github/workflows');
const FILE = join(DIR, 'uat-journeys.yml');
const TEXT = readFileSync(FILE, 'utf8');
const WF = parseYaml(TEXT);
const HEALTH = WF.jobs.health;
const JOURNEYS = WF.jobs.journeys;
const step = (job, name) => {
  const s = job.steps.find((x) => x.name === name);
  assert.ok(s, `no step "${name}"`);
  return s;
};
const RUN = step(JOURNEYS, 'Run the journeys against the served stack');
const DELETE = JOURNEYS.steps.at(-1);
const SCAN = step(JOURNEYS, 'Redaction scan of the evidence file');
const UPLOAD = step(JOURNEYS, 'Upload the redacted evidence');
const INSTALL = step(JOURNEYS, 'Install Playwright 1.56.1 and its Chromium');
const EVIDENCE = '${{ runner.temp }}/uat-journeys-evidence.json';
const HASHES = '${{ runner.temp }}/uat-journeys-secret-hashes.json';

/** Every step of every job, with its job name. */
const ALL = Object.entries(WF.jobs).flatMap(([job, j]) => j.steps.map((s, index) => ({ job, index, step: s })));

describe('trigger and authority', () => {
  it('CONTRACT: workflow_dispatch only — no pull_request, push, schedule or workflow_run, and no inputs', () => {
    assert.deepEqual(Object.keys(WF.on), ['workflow_dispatch']);
    assert.equal(WF.on.workflow_dispatch, null);
  });

  it('CONTRACT: top-level permissions are contents: read; only the journeys job adds actions: read, and nothing else; no id-token', () => {
    assert.deepEqual(WF.permissions, { contents: 'read' });
    assert.equal(HEALTH.permissions, undefined, 'the health job keeps contents: read');
    assert.deepEqual(JOURNEYS.permissions, { contents: 'read', actions: 'read' });
    assert.deepEqual(Object.keys(WF.jobs), ['health', 'journeys']);
    assert.doesNotMatch(TEXT, /id-token/);
    assert.doesNotMatch(TEXT, /:\s*write\b/);
  });

  it('REGRESSION: the serving identity is read with the job\'s token, in the run step only', () => {
    assert.equal(RUN.env.JOURNEY_GITHUB_TOKEN, '${{ github.token }}');
    const holders = ALL.filter(({ step: s }) => /github\.token|secrets\.GITHUB_TOKEN/.test(JSON.stringify(s)));
    assert.deepEqual(holders.map(({ step: s }) => s.name), [RUN.name]);
    assert.equal(JSON.stringify(WF.env).includes('github.token'), false);
    assert.equal(JSON.stringify(JOURNEYS.env).includes('github.token'), false);
  });

  it('CONTRACT: one run at a time, never cancelling one that is acting on the restaurant', () => {
    assert.deepEqual(WF.concurrency, { group: 'uat-journeys', 'cancel-in-progress': false });
  });

  it('CONTRACT: nothing else triggers on this workflow', () => {
    for (const file of readdirSync(DIR)) {
      if (file === 'uat-journeys.yml') continue;
      const other = parseYaml(readFileSync(join(DIR, file), 'utf8'));
      assert.ok(!(other.on?.workflow_run?.workflows ?? []).includes(WF.name), `${file} triggers on ${WF.name}`);
    }
  });
});

describe('actions are pinned', () => {
  const uses = ALL.filter(({ step: s }) => s.uses).map(({ step: s }) => s.uses);
  const lines = TEXT.split('\n').filter((l) => /^\s*uses:/.test(l));

  it('CONTRACT: every action is pinned by a full commit SHA with its version beside it', () => {
    assert.ok(uses.length >= 3);
    for (const line of lines) assert.match(line, /^\s*uses: [a-z-]+\/[a-z-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, line);
  });

  it('CONTRACT: each pin is one this repository already reviewed in certify.yml or publish.yml', () => {
    const reviewed = ['certify.yml', 'publish.yml'].map((f) => readFileSync(join(DIR, f), 'utf8')).join('\n');
    for (const line of lines) assert.ok(reviewed.includes(line.trim()), `${line.trim()} is not an already-reviewed pin`);
  });

  it('CONTRACT: only checkout, setup-node and upload-artifact are used — no cache, no third-party action', () => {
    assert.deepEqual([...new Set(uses.map((u) => u.split('@')[0]))].sort(),
      ['actions/checkout', 'actions/setup-node', 'actions/upload-artifact']);
    for (const { step: s } of ALL.filter(({ step: x }) => x.uses?.startsWith('actions/checkout@'))) {
      assert.equal(s.with['persist-credentials'], false, 'checkout leaves no token in .git/config');
    }
  });
});

describe('the health gate comes first and decides', () => {
  it('CONTRACT: the first job checks UAT health, holds no secret and publishes its verdict', () => {
    assert.deepEqual(Object.keys(WF.jobs), ['health', 'journeys']);
    assert.doesNotMatch(JSON.stringify(HEALTH), /secrets\.|vars\./);
    const gate = HEALTH.steps.at(-1);
    assert.equal(gate.id, 'health');
    assert.equal(gate.run.trim(), 'node e2e/served/run.mjs health-gate');
    assert.deepEqual(HEALTH.steps.map((s) => s.uses?.split('@')[0] ?? s.run.trim()),
      ['actions/checkout', 'actions/setup-node', 'node e2e/served/run.mjs health-gate']);
    assert.deepEqual(HEALTH.outputs, { verdict: '${{ steps.health.outputs.verdict }}' });
  });

  it('CONTRACT: the journeys run only on a healthy verdict — NOT RUN outside the window skips the job rather than failing it', () => {
    assert.equal(JOURNEYS.needs, 'health');
    assert.equal(JOURNEYS.if, "needs.health.outputs.verdict == 'run'");
  });

  it('CONTRACT: both jobs talk to the same API, which is the one the uat build bakes in, and the site deploy-prod publishes', () => {
    assert.equal(WF.env.JOURNEY_API, 'https://api-test.dinifyapp.com/uat');
    assert.equal(HEALTH.env, undefined, 'the health job inherits the one workflow-level JOURNEY_API');
    assert.equal(JOURNEYS.env.JOURNEY_API, undefined);
    const uat = readFileSync(join(ROOT, 'src/environments/environment.uat.ts'), 'utf8');
    assert.match(uat, new RegExp(`apiUrl: '${WF.env.JOURNEY_API}'`));
    const sites = [].concat(JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8')).hosting).map((h) => h.site);
    assert.deepEqual(sites, ['dinify-prod']);
    assert.equal(JOURNEYS.env.JOURNEY_WEB, `https://${sites[0]}.web.app`);
    assert.match(readFileSync(join(DIR, 'deploy-prod.yml'), 'utf8'), /--configuration=uat/);
  });

  it('CONTRACT: a non-main ref is refused before checkout', () => {
    const first = JOURNEYS.steps[0];
    assert.equal(first.name, 'Refuse any ref but main');
    assert.match(first.run, /"\$REF" != "refs\/heads\/main"/);
    assert.equal(first.env.REF, '${{ github.ref }}');
  });

  it('REGRESSION: the secrets and variables are an ENVIRONMENT\'s, so a branch\'s copy of this file cannot reach them', () => {
    // The in-file check above runs from the file that runs, so a dispatch on
    // another branch runs that branch's copy, which can drop it. The deployment-
    // branch rule of the environment is enforced by GitHub, outside the file.
    assert.equal(JOURNEYS.environment, 'uat-journeys');
    assert.equal(HEALTH.environment, undefined, 'the health job holds no secret and needs no environment');
    for (const { job, step: s } of ALL) {
      if (/secrets\.|vars\./.test(JSON.stringify(s))) assert.equal(job, 'journeys', s.name);
    }
    assert.ok(/vars\./.test(JSON.stringify(JOURNEYS.env)));
    assert.equal(JSON.stringify(WF.env).match(/secrets\.|vars\./), null, 'nothing workflow-level reads a secret or variable');
  });

  it('CONTRACT: the README tells the owner to create the environment with a main-only branch rule and to keep the values out of the repository level', () => {
    const readme = readFileSync(join(ROOT, 'e2e/served/README.md'), 'utf8');
    assert.match(readme, /Settings → Environments → New environment/);
    assert.match(readme, /`uat-journeys`/);
    assert.match(readme, /Selected branches and tags/);
    assert.match(readme, /Name pattern\*\* `main`/);
    assert.match(readme, /not at repository level/);
    for (const name of ['UAT_JOURNEY_OPERATOR_USERNAME', 'UAT_JOURNEY_OPERATOR_PASSWORD', 'UAT_JOURNEY_RESTAURANT_ID', 'UAT_JOURNEY_RESTAURANT_NAME']) {
      assert.ok(readme.includes(`\`${name}\``), name);
    }
  });
});

describe('a run the gate starts can finish', () => {
  const BUDGET = RUNMOD.BUDGET;
  const WINDOW = RUNMOD.WINDOW;
  const INSTALL_STEP = step(JOURNEYS, 'Install Playwright 1.56.1 and its Chromium');

  it('REGRESSION: the job is given no more than the gate guarantees is left in the window', () => {
    assert.equal(JOURNEYS['timeout-minutes'], 45);
    assert.ok(JOURNEYS['timeout-minutes'] <= WINDOW.minRunMinutes, 'a run the gate started could outlive the window');
    assert.equal(HEALTH['timeout-minutes'], 10);
  });

  it('REGRESSION: the run step outlasts the run\'s own budget, and install plus the run fit the job with room for the rest', () => {
    assert.deepEqual({ ...BUDGET }, { runMinutes: 30, journeyMinutes: 15, minJourneyMinutes: 3, finalResetMinutes: 3 });
    assert.equal(RUN['timeout-minutes'], 35);
    assert.equal(INSTALL_STEP['timeout-minutes'], 5);
    assert.ok(RUN['timeout-minutes'] >= BUDGET.runMinutes + 5, 'the step would kill the run before its final reset and evidence');
    assert.ok(INSTALL_STEP['timeout-minutes'] + RUN['timeout-minutes'] + 5 <= JOURNEYS['timeout-minutes']);
  });

  it('REGRESSION: a journey\'s limit fits inside the run\'s budget with the final reset kept back', () => {
    assert.ok(BUDGET.journeyMinutes <= BUDGET.runMinutes - BUDGET.finalResetMinutes);
    assert.ok(BUDGET.minJourneyMinutes <= BUDGET.journeyMinutes);
    const run = readFileSync(join(ROOT, 'e2e/served/run.mjs'), 'utf8');
    assert.doesNotMatch(run, /40 \* 60 \* 1000/, 'the old 40-minute child limit (5 x 40 > the old 90-minute job)');
    assert.match(run, /runChild\(join\(E2E, j\.script\), env, timeoutMs\)/);
  });
});

describe('secrets and masking', () => {
  it('CONTRACT: the two operator secrets reach exactly two steps, through env only — never a run: line or with:', () => {
    const holders = ALL.filter(({ step: s }) => JSON.stringify(s).includes('secrets.'));
    assert.deepEqual(holders.map(({ step: s }) => s.name), [RUN.name, SCAN.name]);
    assert.deepEqual(RUN.env, {
      JOURNEY_OPERATOR_USERNAME: '${{ secrets.UAT_JOURNEY_OPERATOR_USERNAME }}',
      JOURNEY_OPERATOR_PASSWORD: '${{ secrets.UAT_JOURNEY_OPERATOR_PASSWORD }}',
      JOURNEY_GITHUB_TOKEN: '${{ github.token }}',
      JOURNEY_EVIDENCE: EVIDENCE,
      JOURNEY_SECRET_HASHES: HASHES,
    });
    for (const { step: s } of holders) {
      assert.doesNotMatch(s.run, /secrets\./, `${s.name} interpolates a secret into its script`);
      assert.equal(s.with, undefined);
    }
    assert.deepEqual([...TEXT.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]).sort(), [
      'UAT_JOURNEY_OPERATOR_PASSWORD', 'UAT_JOURNEY_OPERATOR_PASSWORD',
      'UAT_JOURNEY_OPERATOR_USERNAME', 'UAT_JOURNEY_OPERATOR_USERNAME',
    ]);
  });

  it('CONTRACT: the restaurant interlock comes from the environment\'s variables, not from the run', () => {
    assert.equal(JOURNEYS.env.JOURNEY_RESTAURANT_ID, '${{ vars.UAT_JOURNEY_RESTAURANT_ID }}');
    assert.equal(JOURNEYS.env.JOURNEY_RESTAURANT_NAME, '${{ vars.UAT_JOURNEY_RESTAURANT_NAME }}');
  });

  it('CONTRACT: masking is done by the orchestrator the run step calls; no step turns on debug logging', () => {
    assert.equal(RUN.run.trim(), 'node e2e/served/run.mjs');
    assert.doesNotMatch(TEXT, /ACTIONS_STEP_DEBUG|ACTIONS_RUNNER_DEBUG|PWDEBUG|DEBUG\s*:|set -x/);
    // run.mjs: ::add-mask:: for the username and password first, then for each
    // token, QR credential and table session the moment it exists (pinned in
    // served.test.mjs → "masking").
    const run = readFileSync(join(ROOT, 'e2e/served/run.mjs'), 'utf8');
    assert.ok(run.includes('mask(cfg.username); mask(cfg.password);'));
  });
});

describe('what leaves the runner', () => {
  it('CONTRACT: exactly ONE upload, and it is the evidence JSON — no trace, HAR, video or screenshot', () => {
    const uploads = ALL.filter(({ step: s }) => s.uses?.startsWith('actions/upload-artifact@'));
    assert.equal(uploads.length, 1);
    assert.equal(UPLOAD.with.path, EVIDENCE);
    assert.equal(UPLOAD.with['if-no-files-found'], 'error');
    // Read off the PARSED file, so the comments saying none is uploaded do not count.
    assert.doesNotMatch(JSON.stringify(WF), /trace|\.har\b|video|screenshot|test-results|playwright-report/i);
  });

  it('CONTRACT: the scan reads the same file and the run\'s hash file, runs even after a failed run, and cannot be softened', () => {
    assert.equal(SCAN.id, 'scan');
    assert.equal(SCAN.if, 'always()');
    assert.equal(SCAN.run.trim(), 'node e2e/served/redact.mjs scan "$JOURNEY_EVIDENCE" --hashes "$JOURNEY_SECRET_HASHES"');
    assert.equal(SCAN.env.JOURNEY_EVIDENCE, EVIDENCE);
    assert.equal(SCAN.env.JOURNEY_SECRET_HASHES, HASHES);
    assert.equal(RUN.env.JOURNEY_SECRET_HASHES, SCAN.env.JOURNEY_SECRET_HASHES, 'the scan reads the file the run wrote');
    assert.match(SCAN.env.REDACT_EXTRA_VALUES, /secrets\.UAT_JOURNEY_OPERATOR_USERNAME[\s\S]*secrets\.UAT_JOURNEY_OPERATOR_PASSWORD/);
    assert.doesNotMatch(TEXT, /continue-on-error|\|\| true/);
  });

  it('CONTRACT: the upload happens only after a clean scan, and the scan step precedes it', () => {
    assert.equal(UPLOAD.if, "always() && steps.scan.outcome == 'success'");
    assert.ok(JOURNEYS.steps.indexOf(SCAN) < JOURNEYS.steps.indexOf(UPLOAD));
    assert.ok(JOURNEYS.steps.indexOf(RUN) < JOURNEYS.steps.indexOf(SCAN));
  });

  it('REGRESSION MATRIX: a found token stops the upload; a failed run still uploads its clean evidence; both stay red', () => {
    // GitHub's sequencing for exactly the conditions this job uses; an unknown
    // condition throws, so a new one forces this model to be revisited.
    const simulate = (outcomes) => {
      let status = 'success';
      const outcome = {};
      const ran = {};
      for (const s of JOURNEYS.steps) {
        const cond = s.if ?? 'success()';
        const go = {
          'success()': () => status === 'success',
          'always()': () => true,
          "always() && steps.scan.outcome == 'success'": () => outcome.scan === 'success',
        }[cond];
        if (!go) throw new Error(`unmodelled condition: ${cond}`);
        if (!go()) { ran[s.name] = 'skipped'; continue; }
        // The scan of a file the run never wrote exits 2 (served.test.mjs pins it).
        const fallback = s === SCAN && ran[RUN.name] === 'skipped' ? 'failure' : 'success';
        const out = outcomes[s.name] ?? fallback;
        ran[s.name] = out;
        if (s.id) outcome[s.id] = out;
        if (out === 'failure') status = 'failure';
      }
      return { conclusion: status, ran };
    };
    const clean = simulate({});
    assert.equal(clean.conclusion, 'success');
    assert.equal(clean.ran[UPLOAD.name], 'success');

    const tokenFound = simulate({ [SCAN.name]: 'failure' });
    assert.equal(tokenFound.ran[UPLOAD.name], 'skipped');
    assert.equal(tokenFound.conclusion, 'failure');

    const journeyFailed = simulate({ [RUN.name]: 'failure' });
    assert.equal(journeyFailed.ran[SCAN.name], 'success');
    assert.equal(journeyFailed.ran[UPLOAD.name], 'success');
    assert.equal(journeyFailed.ran[DELETE.name], 'success');
    assert.equal(journeyFailed.conclusion, 'failure');

    const selfTestFailed = simulate({ 'Self-test the harness (offline)': 'failure' });
    assert.equal(selfTestFailed.ran[RUN.name], 'skipped', 'nothing touches UAT after a failed self-test');
    assert.equal(selfTestFailed.ran[UPLOAD.name], 'skipped', 'the scan of a missing file is not clean');
  });

  it('CONTRACT: the fixture, the hash file and the evidence are deleted from the runner whatever happened', () => {
    assert.equal(DELETE.name, 'Delete the fixture, hash and evidence files');
    assert.equal(DELETE.if, 'always()');
    assert.match(DELETE.run, /rm -rf "\$WORK"\/served-journeys-\* "\$WORK\/uat-journeys-evidence\.json" "\$WORK\/uat-journeys-secret-hashes\.json"/);
    assert.equal(DELETE.env.WORK, '${{ runner.temp }}');
  });

  it('CONTRACT: the hash file is never uploaded', () => {
    assert.notEqual(UPLOAD.with.path, HASHES);
    assert.doesNotMatch(JSON.stringify(UPLOAD), /secret-hashes/);
  });
});

describe('Playwright follows the repository precedent', () => {
  it('CONTRACT: pinned 1.56.1, installed --no-save outside the application tree, Chromium only, manifests untouched', () => {
    assert.equal(INSTALL.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, '1');
    assert.match(INSTALL.run, /npm i --no-save --no-package-lock --ignore-scripts --prefix e2e playwright@1\.56\.1/);
    assert.match(INSTALL.run, /install --with-deps chromium\n/);
    assert.doesNotMatch(INSTALL.run, /firefox|webkit|npm ci/);
    assert.match(INSTALL.run, /git diff --exit-code -- package\.json package-lock\.json/);
  });

  it('CONTRACT: the offline self-test runs before anything installs or reaches UAT', () => {
    const self = step(JOURNEYS, 'Self-test the harness (offline)');
    assert.match(self.run, /node e2e\/served\/redact\.mjs --self-test/);
    assert.match(self.run, /node --test "e2e\/served\/tests\/\*\.test\.mjs"/);
    assert.ok(JOURNEYS.steps.indexOf(self) < JOURNEYS.steps.indexOf(INSTALL));
  });
});
