/**
 * THE HOSTING CONFIGURATION THE TOOL WILL ACTUALLY USE (R3).
 *
 * What was wrong (reproduced on 3386724, see release/README.md "Baseline"): the gate
 * read firebase.json for hooks and `hosting.public` and never read .firebaserc at all.
 * The tool resolves its destination through BOTH, so an alias in .firebaserc could
 * send `--project dinify-dev` somewhere else (R3.j), and an `ignore` entry could drop a
 * certified script from an upload that then reports success (R3.i).
 *
 * `effectiveHosting` resolves the destination the way firebase-tools does, refuses
 * anything outside a narrow allow-list, proves every certified file survives the
 * effective ignores, and generates the narrow pair the publisher hands the tool. The
 * resolution itself is pinned against the installed tool by hosting-oracle.test.mjs.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  cacheControlIsNoStore, effectiveHosting, headerSourceMatches, identityCacheControl, TOOL_BUILTIN_IGNORES,
} from '../lib/hosting.mjs';
import { ROOT } from './harness.mjs';
import { POLICY, clone } from './fixtures.mjs';

const FIREBASE_JSON = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
const FIREBASERC = JSON.parse(readFileSync(join(ROOT, '.firebaserc'), 'utf8'));
const FILES = ['index.html', 'main-abc.js', 'styles-x.css', 'release.json', 'assets/icon.svg'];

const evaluate = ({ config = FIREBASE_JSON, rc = FIREBASERC, policy = POLICY, files = FILES } = {}) => effectiveHosting({
  firebaseJson: clone(config), firebaserc: clone(rc), policy, files,
});
const problemCodes = (r) => r.problems.map((p) => p.code);
const entry = (mutate) => { const c = clone(FIREBASE_JSON); mutate(c.hosting[0], c); return c; };
const rcWith = (mutate) => { const r = clone(FIREBASERC); mutate(r); return r; };

function refused(args, code) {
  const r = evaluate(args);
  assert.ok(problemCodes(r).includes(code), `expected ${code}, got ${JSON.stringify(problemCodes(r))}`);
  assert.equal(r.config, null, 'a refused configuration is never generated');
  assert.equal(r.digest, null);
  return r;
}

describe('controls', () => {
  test('CONTROL: the configuration this repository commits is accepted', () => {
    const r = evaluate();
    assert.deepEqual(r.problems, []);
  });

  test('CONTROL: the generated pair carries only the policy\'s destination and the certified serving rules', () => {
    const r = evaluate();
    assert.deepEqual(r.rc, { projects: { default: 'dinify-dev' }, targets: { 'dinify-dev': { hosting: { 'dinify-prod': ['dinify-prod'] } } } });
    assert.deepEqual(Object.keys(r.config), ['hosting']);
    assert.equal(r.config.hosting.length, 1);
    const h = r.config.hosting[0];
    assert.deepEqual(Object.keys(h).sort(), ['headers', 'ignore', 'public', 'rewrites', 'site']);
    assert.equal(h.site, POLICY.hosting.site);
    assert.equal(h.public, POLICY.hosting.publicDirectory);
    assert.deepEqual(h.ignore, POLICY.hosting.ignore);
    assert.deepEqual(h.rewrites, FIREBASE_JSON.hosting[0].rewrites);
    assert.deepEqual(h.headers, FIREBASE_JSON.hosting[0].headers);
    assert.match(r.digest, /^sha256:[0-9a-f]{64}$/);
  });

  test('CONTROL: a single hosting object is read like a one-entry array', () => {
    assert.deepEqual(evaluate({ config: { hosting: clone(FIREBASE_JSON.hosting[0]) } }).problems, []);
  });

  test('CONTROL: equivalent spellings of the public directory are one directory', () => {
    for (const value of ['./dist', 'dist', 'dist/', './dist/']) {
      assert.deepEqual(evaluate({ config: entry((e) => { e.public = value; }) }).problems, [], value);
    }
  });

  test('CONTROL: an entry that names the TARGET resolves through .firebaserc, as the tool does', () => {
    const r = evaluate({ config: entry((e) => { delete e.site; e.target = 'dinify-prod'; }) });
    assert.deepEqual(r.problems, []);
    assert.equal(r.config.hosting[0].site, 'dinify-prod');
  });

  test('CONTRACT: a different header rule is a different configuration digest', () => {
    // The rule changed is index.html's, not the identity's: a change to the identity's
    // Cache-Control is refused outright (see "the served identity" below), so it cannot
    // be the example of an ACCEPTED configuration with a different digest.
    const a = evaluate();
    const b = evaluate({ config: entry((e) => { e.headers[1].headers[0].value = 'no-store'; }) });
    assert.equal(FIREBASE_JSON.hosting[0].headers[1].source, '/index.html');
    assert.deepEqual(b.problems, []);
    assert.notEqual(a.digest, b.digest);
  });
});

describe('.firebaserc — the project an explicit --project resolves to (R3.j)', () => {
  test('REGRESSION (R3.j): an alias that redirects --project dinify-dev is refused', () => {
    refused({ rc: rcWith((r) => { r.projects['dinify-dev'] = 'somewhere-else'; }) }, 'hosting.project_alias_redirect');
  });
  test('CONTRACT: a default project that is not the policy\'s is refused', () => {
    refused({ rc: rcWith((r) => { r.projects.default = 'somewhere-else'; }) }, 'hosting.project_default_mismatch');
  });
  test('CONTRACT: a target mapped to another site is refused', () => {
    refused({ rc: rcWith((r) => { r.targets['dinify-dev'].hosting['dinify-prod'] = ['somewhere-else']; }) }, 'hosting.target_mapping_mismatch');
  });
  test('CONTRACT: a target mapped to two sites is refused', () => {
    refused({ rc: rcWith((r) => { r.targets['dinify-dev'].hosting['dinify-prod'] = ['dinify-prod', 'other']; }) }, 'hosting.target_mapping_mismatch');
  });
  test('CONTRACT: an unrecognised .firebaserc key is refused rather than ignored', () => {
    refused({ rc: rcWith((r) => { r.etags = {}; }) }, 'hosting.rc_unexpected_key');
  });
  test('CONTRACT: a missing .firebaserc is refused', () => {
    const r = effectiveHosting({ firebaseJson: clone(FIREBASE_JSON), firebaserc: undefined, policy: POLICY, files: FILES });
    assert.deepEqual(problemCodes(r), ['hosting.rc_unreadable']);
  });
});

describe('firebase.json — the entry --only hosting:<target> selects', () => {
  test('CONTRACT: a missing firebase.json is refused', () => {
    const r = effectiveHosting({ firebaseJson: undefined, firebaserc: clone(FIREBASERC), policy: POLICY, files: FILES });
    assert.deepEqual(problemCodes(r), ['hosting.config_unreadable']);
  });
  test('CONTRACT: a predeploy hook is refused — it is a shell command the tool runs', () => {
    refused({ config: entry((e) => { e.predeploy = ['echo hi']; }) }, 'hosting.hook_present');
  });
  test('CONTRACT: another product beside hosting is refused', () => {
    refused({ config: entry((e, c) => { c.functions = { source: 'functions' }; }) }, 'hosting.unexpected_product');
  });
  test('CONTRACT: two hosting entries are refused — which one publishes would be ambiguous', () => {
    refused({ config: { hosting: [clone(FIREBASE_JSON.hosting[0]), { ...clone(FIREBASE_JSON.hosting[0]), site: 'other' }] } }, 'hosting.entry_count');
  });
  test('CONTRACT: a web-frameworks `source` (which runs a build) is refused', () => {
    refused({ config: entry((e) => { e.source = '.'; }) }, 'hosting.unsupported_key');
  });
  test('CONTRACT: redirects are refused until reviewed into the allow-list', () => {
    refused({ config: entry((e) => { e.redirects = [{ source: '/a', destination: '/b', type: 301 }]; }) }, 'hosting.unsupported_key');
  });
  test('CONTRACT: an entry naming both a site and a target is refused, as the tool refuses it', () => {
    refused({ config: entry((e) => { e.target = 'dinify-prod'; }) }, 'hosting.site_and_target');
  });
  test('CONTRACT: an entry the target does not select is refused', () => {
    refused({ config: entry((e) => { e.site = 'somewhere-else'; }) }, 'hosting.not_selected');
  });
  test('CONTRACT: a target that resolves to no single site is refused', () => {
    refused({
      config: entry((e) => { delete e.site; e.target = 'dinify-prod'; }),
      rc: rcWith((r) => { delete r.targets['dinify-dev'].hosting['dinify-prod']; }),
    }, 'hosting.target_unresolved');
  });
  test('THE #686 REGRESSION, kept: a public directory of "." is refused', () => {
    refused({ config: entry((e) => { e.public = '.'; }) }, 'hosting.public_mismatch');
  });
  test('CONTRACT: any other public directory is refused', () => {
    refused({ config: entry((e) => { e.public = 'build'; }) }, 'hosting.public_mismatch');
    refused({ config: entry((e) => { e.public = './dist/browser'; }) }, 'hosting.public_mismatch');
  });
  test('CONTRACT: a function rewrite is refused', () => {
    refused({ config: entry((e) => { e.rewrites = [{ source: '/api/**', function: 'api' }]; }) }, 'hosting.rewrite_unsupported');
  });
  test('CONTRACT: a malformed header rule is refused', () => {
    refused({ config: entry((e) => { e.headers = [{ source: '/x', headers: { 'Cache-Control': 'no-store' } }]; }) }, 'hosting.header_unsupported');
  });
});

describe('the file set — every certified file must survive the effective ignores (R3.i)', () => {
  test('REGRESSION (R3.i): an ignore change that would drop certified scripts is refused', () => {
    refused({ config: entry((e) => { e.ignore = ['**/*.js']; }) }, 'hosting.ignore_changed');
  });

  test('CONTRACT: when the policy itself would drop a certified file, the file is named', () => {
    const policy = clone(POLICY);
    policy.hosting.ignore = ['**/*.js'];
    const r = refused({ config: entry((e) => { e.ignore = ['**/*.js']; }), policy }, 'hosting.certified_asset_filtered');
    assert.ok(r.problems.some((p) => p.detail.startsWith('main-abc.js')), JSON.stringify(r.problems));
  });

  test('CONTRACT: a certified dotfile is refused rather than silently not uploaded', () => {
    const r = refused({ files: [...FILES, 'assets/.gitkeep'] }, 'hosting.certified_asset_filtered');
    assert.match(r.problems[0].detail, /assets\/\.gitkeep \(by \*\*\/\.\*\)/);
  });

  test('CONTROL: a file INSIDE a dot-directory is uploaded — `**/.*` matches names, not ancestors', () => {
    // Pinned against the tool's own listFiles by hosting-oracle.test.mjs; the obvious
    // reading of `**/.*` ("everything under a dotted path") is not what glob does.
    assert.deepEqual(evaluate({ files: [...FILES, '.well-known/assetlinks.json'] }).problems, []);
  });

  test('CONTRACT: the tool\'s own ignores apply too — a debug log in the payload is refused', () => {
    assert.ok(TOOL_BUILTIN_IGNORES.includes('**/firebase-debug.log'));
    refused({ files: [...FILES, 'firebase-debug.log'] }, 'hosting.certified_asset_filtered');
  });

  test('CONTRACT: a file named firebase.json inside the payload is refused', () => {
    refused({ files: [...FILES, 'firebase.json'] }, 'hosting.certified_asset_filtered');
  });

  test('CONTRACT: an ignore pattern outside the supported dialect is refused, never approximated', () => {
    const policy = clone(POLICY);
    policy.hosting.ignore = ['**/*.{js,css}'];
    refused({ config: entry((e) => { e.ignore = ['**/*.{js,css}']; }), policy }, 'hosting.ignore_unsupported');
  });
});

describe('the served identity must be no-store — decided BEFORE publication (Codex P2 on #687)', () => {
  // Every later decision reads the served identity and refuses a cacheable one in EVERY
  // mode (decide.mjs, served.identity_cacheable) — rollback included. Reproduced on
  // ce6b892 through the executed workflow: a certified firebase.json serving
  // /release.json as `public, max-age=300` was admitted, published and reported
  // PUBLISHED_VERIFIED, and then a redeploy AND a rollback were both refused. The gate
  // must never admit a configuration it would itself refuse to read back.
  const IDENTITY = POLICY.hosting.identityPath;
  const withIdentityValue = (value) => entry((e) => { e.headers[0].headers[0].value = value; });

  test('CONTROL: the committed configuration serves the identity no-store', () => {
    assert.equal(FIREBASE_JSON.hosting[0].headers[0].source, IDENTITY);
    assert.deepEqual(identityCacheControl(FIREBASE_JSON.hosting[0].headers, IDENTITY), { state: 'no-store', values: ['no-store'] });
    assert.deepEqual(evaluate().problems, []);
  });

  test('REGRESSION (Codex P2 on #687): a certified change making the identity cacheable is refused at the gate', () => {
    const r = refused({ config: withIdentityValue('public, max-age=300') }, 'hosting.identity_cacheable');
    assert.match(r.problems.find((p) => p.code === 'hosting.identity_cacheable').detail, /public, max-age=300/);
  });

  test('CONTRACT: no-cache is not no-store — it still permits storing, and the next gate refuses it', () => {
    refused({ config: withIdentityValue('no-cache') }, 'hosting.identity_cacheable');
  });

  test('CONTRACT: no rule setting Cache-Control on the identity leaves the host default, which is cacheable', () => {
    const r = refused({ config: entry((e) => { e.headers = e.headers.slice(1); }) }, 'hosting.identity_cacheable');
    assert.match(r.problems.find((p) => p.code === 'hosting.identity_cacheable').detail, /host default/);
  });

  test('CONTRACT: a broader matching rule with a cacheable value is refused in EITHER order — rule order never decides it', () => {
    const broad = { source: '/**', headers: [{ key: 'Cache-Control', value: 'public, max-age=60' }] };
    refused({ config: entry((e) => { e.headers = [broad, ...e.headers]; }) }, 'hosting.identity_cacheable');
    refused({ config: entry((e) => { e.headers = [...e.headers, broad]; }) }, 'hosting.identity_cacheable');
  });

  test('CONTRACT: the header name is case-insensitive, as HTTP says', () => {
    refused({ config: entry((e) => { e.headers[0].headers[0] = { key: 'cache-control', value: 'max-age=60' }; }) }, 'hosting.identity_cacheable');
    assert.deepEqual(evaluate({ config: entry((e) => { e.headers[0].headers[0].key = 'cache-control'; }) }).problems, []);
  });

  test('CONTROL: no-store beside other directives is no-store — the same predicate the served check applies', () => {
    assert.deepEqual(evaluate({ config: withIdentityValue('no-store, max-age=0') }).problems, []);
    for (const v of ['no-store', 'NO-STORE', 'private, no-store', 'no-store,max-age=0']) assert.equal(cacheControlIsNoStore(v), true, v);
    for (const v of ['no-cache', 'public, max-age=300', 'x-no-store', 'no-storex', '', null]) assert.equal(cacheControlIsNoStore(v), false, String(v));
  });

  test('CONTRACT: a rule that sets Cache-Control with a pattern the model cannot decide is refused, never assumed not to apply', () => {
    for (const source of ['/{release,index}.json', '/[r]elease.json', '/!(index).json', '!/index.html', '/+(release).json', '/*(r)elease.json', '/rel\\ease.json']) {
      const r = refused({ config: entry((e) => { e.headers = [...e.headers, { source, headers: [{ key: 'Cache-Control', value: 'max-age=60' }] }]; }) }, 'hosting.identity_cache_unproven');
      assert.match(r.problems.find((p) => p.code === 'hosting.identity_cache_unproven').detail, /cannot decide/, source);
    }
  });

  test('CONTROL: an undecidable pattern that sets no Cache-Control cannot affect the identity\'s caching', () => {
    const config = entry((e) => { e.headers = [...e.headers, { source: '/{a,b}.html', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] }]; });
    assert.deepEqual(evaluate({ config }).problems, []);
  });

  test('CONTRACT: an identity path the model cannot match is unproven rather than assumed safe', () => {
    const policy = clone(POLICY);
    policy.hosting.identityPath = '/.well-known/release.json';
    refused({ policy }, 'hosting.identity_cache_unproven');
  });

  test('CONTRACT: the matcher — decided cases, and undecidable ones answered null', () => {
    const cases = [
      ['/release.json', '/release.json', true],
      ['release.json', '/release.json', true],
      ['/index.html', '/release.json', false],
      ['/**/*.@(js|css)', '/release.json', false],
      ['/**/*.@(js|css)', '/main-abc.js', true],
      ['/**/*.@(js|css)', '/assets/deep/styles.css', true],
      ['/**', '/release.json', true],
      ['**', '/release.json', true],
      ['/*.json', '/release.json', true],
      ['/*.json', '/a/release.json', false],
      ['/**/*.json', '/a/b/release.json', true],
      ['/releas?.json', '/release.json', true],
      ['/release.json/', '/release.json', false],
      ['/a/../release.json', '/release.json', true],
      ['/RELEASE.json', '/release.json', false],
      ['/{release,x}.json', '/release.json', null],
      ['/[r]elease.json', '/release.json', null],
      ['!/release.json', '/release.json', null],
      ['/rel**ease.json', '/release.json', null],
    ];
    for (const [source, path, expected] of cases) assert.equal(headerSourceMatches(source, path), expected, `${source} vs ${path}`);
  });
});
