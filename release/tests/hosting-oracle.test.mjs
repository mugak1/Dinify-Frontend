/**
 * THE ORACLE — our model of how firebase-tools resolves a deploy, checked against the
 * tool itself.
 *
 * release/lib/hosting.mjs re-implements three things firebase-tools does: resolve the
 * explicit `--project` through .firebaserc aliases (Command#applyRC), select the
 * hosting entry `--only hosting:<target>` names (hosting/config.js), and list the files
 * an upload includes (listFiles.js). A re-implementation that drifted from the tool
 * would let the gate approve a configuration the tool then deploys differently, so the
 * model is pinned here against the tool's OWN functions rather than asserted from
 * reading its documentation.
 *
 * THE VERSION, STATED. This runs the firebase-tools installed in this repository
 * (a devDependency). The publisher runs the version pinned in release/policy.json. They
 * are not the same version today, and this test records both rather than pretending
 * the pinned one was exercised here. The three functions consulted are small and have
 * been stable across these releases; that is an observation, not a guarantee, and a
 * change of pin should re-run this oracle against the pinned version.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { effectiveHosting, TOOL_BUILTIN_IGNORES } from '../lib/hosting.mjs';
import { partitionByIgnore } from '../lib/glob.mjs';
import { ROOT, tempDir, writeText } from './harness.mjs';
import { POLICY, clone } from './fixtures.mjs';

process.noDeprecation = true;
const require = createRequire(join(ROOT, 'package.json'));
const FT = join(ROOT, 'node_modules/firebase-tools/lib');
const { Command } = require(join(FT, 'command.js'));
const { hostingConfig } = require(join(FT, 'hosting/config.js'));
const { listFiles } = require(join(FT, 'listFiles.js'));
const INSTALLED = JSON.parse(readFileSync(join(ROOT, 'node_modules/firebase-tools/package.json'), 'utf8')).version;

const FIREBASE_JSON = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
const FIREBASERC = JSON.parse(readFileSync(join(ROOT, '.firebaserc'), 'utf8'));

/** What the tool resolves for `firebase deploy --only hosting:<target> --project <project>`. */
async function toolResolves({ config = FIREBASE_JSON, rc = FIREBASERC }) {
  const dir = tempDir('oracle');
  writeFileSync(join(dir, 'firebase.json'), JSON.stringify(config));
  writeFileSync(join(dir, '.firebaserc'), JSON.stringify(rc));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  const options = { cwd: dir, projectRoot: dir, project: POLICY.hosting.project, only: `hosting:${POLICY.hosting.target}` };
  await new Command('deploy').applyRC(options);
  const entries = hostingConfig({ ...options, config: { src: clone(config), projectDir: dir } });
  return { project: options.project, sites: entries.map((e) => e.site), publics: entries.map((e) => e.public) };
}

describe('the installed tool agrees with the model', () => {
  test('RECORD: the installed and the pinned firebase-tools versions', (t) => {
    assert.match(INSTALLED, /^\d+\.\d+\.\d+$/);
    t.diagnostic(`installed firebase-tools ${INSTALLED}; publisher pin ${POLICY.hosting.firebaseToolsVersion}${INSTALLED === POLICY.hosting.firebaseToolsVersion ? '' : ' — NOT the version exercised here'}`);
  });

  test('CONTROL: the committed pair resolves to the policy\'s project and site, and the model agrees', async () => {
    const tool = await toolResolves({});
    assert.equal(tool.project, POLICY.hosting.project);
    assert.deepEqual(tool.sites, [POLICY.hosting.site]);
    assert.deepEqual(tool.publics, [POLICY.hosting.publicDirectory]);
    assert.deepEqual(effectiveHosting({ firebaseJson: FIREBASE_JSON, firebaserc: FIREBASERC, policy: POLICY, files: [] }).problems, []);
  });

  test('REGRESSION (R3.j): the tool REALLY follows a .firebaserc alias away from --project, and the model refuses it', async () => {
    const rc = clone(FIREBASERC);
    rc.projects[POLICY.hosting.project] = 'somewhere-else';
    const tool = await toolResolves({ rc });
    assert.equal(tool.project, 'somewhere-else', 'the tool deploys to the alias target, not to --project');
    const model = effectiveHosting({ firebaseJson: FIREBASE_JSON, firebaserc: rc, policy: POLICY, files: [] });
    assert.ok(model.problems.some((p) => p.code === 'hosting.project_alias_redirect'));
  });

  test('CONTROL: a TARGET entry resolves through .firebaserc to the same site in both', async () => {
    const config = clone(FIREBASE_JSON);
    delete config.hosting[0].site;
    config.hosting[0].target = POLICY.hosting.target;
    const tool = await toolResolves({ config });
    assert.deepEqual(tool.sites, [POLICY.hosting.site]);
    const model = effectiveHosting({ firebaseJson: config, firebaserc: FIREBASERC, policy: POLICY, files: [] });
    assert.equal(model.config.hosting[0].site, tool.sites[0]);
  });

  test('CONTRACT: a site entry is selected BEFORE a target entry of the same name, in both', async () => {
    const config = { hosting: [{ ...clone(FIREBASE_JSON.hosting[0]) }] };
    const tool = await toolResolves({ config });
    assert.deepEqual(tool.sites, ['dinify-prod']);
  });

  test('CONTRACT: the tool refuses an entry with both site and target; so does the model', async () => {
    const config = clone(FIREBASE_JSON);
    config.hosting[0].target = POLICY.hosting.target;
    await assert.rejects(toolResolves({ config }), /either "site" or "target"/);
    assert.ok(effectiveHosting({ firebaseJson: config, firebaserc: FIREBASERC, policy: POLICY, files: [] })
      .problems.some((p) => p.code === 'hosting.site_and_target'));
  });
});

describe('the upload list — the tool\'s own listFiles against the model\'s glob', () => {
  const TREE = [
    'index.html', 'main-abc.js', 'styles-x.css', 'release.json', 'assets/icon.svg', 'assets/fonts/a.woff2',
    '.hidden', 'assets/.nested-dot', '.well-known/assetlinks.json', 'firebase.json', 'firebase-debug.log',
    'firebase-debug.1.log', 'a/firebase-debug.log', 'node_modules/x/index.js', 'deep/node_modules/y.js',
    '.firebase/cache', 'chunk-ABC.js',
  ];
  const tree = () => {
    const dir = tempDir('listfiles');
    for (const rel of TREE) writeText(dir, rel, rel);
    return dir;
  };

  for (const [label, ignore] of [
    ['the policy\'s ignore list', POLICY.hosting.ignore],
    ['an ignore that drops scripts (R3.i)', ['**/*.js']],
    ['no ignore at all', []],
    ['a question-mark pattern', ['assets/?onts/**']],
  ]) {
    test(`CONTRACT: ${label} — kept files agree exactly`, () => {
      const dir = tree();
      const toolKept = listFiles(dir, ignore).sort();
      const modelKept = partitionByIgnore(TREE, [...TOOL_BUILTIN_IGNORES, ...ignore]).kept.sort();
      assert.deepEqual(modelKept, toolKept);
    });
  }
});
