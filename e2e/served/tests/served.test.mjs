/**
 * THE SERVED HARNESS'S PURE PARTS, offline.
 *
 * Nothing here reaches UAT, Firebase or GitHub: the interlock is exercised
 * against a loopback HTTP server this file starts, the bundle crawl against a
 * fetch this file supplies, and the redaction scan against files it writes.
 * Labels follow the repository's convention: REGRESSION (a defect this harness
 * must keep closed), CONTRACT (a promise the README or the workflow makes) and
 * CONTROL (the case that must keep passing, so a refusal is not refusing
 * everything).
 *
 *   node --test "e2e/served/tests/*.test.mjs"
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  ACCEPTED_COUNTS, DEV_OTP, InterlockError, SERVED_SKIPS, assertTestRestaurant, isLoopback, journeyTarget,
} from '../lib.mjs';
import {
  D01_INVALID_REQUEST_MESSAGE, D01_QUANTITY_MESSAGE, D07_MESSAGE, D07_REASON, D07_STATUS,
} from '../probes.mjs';
import { PATTERNS, redactText, scanText, selfTest } from '../redact.mjs';
import {
  JOURNEYS, WINDOW, bundleOrigins, classifyHealth, judgeJourney, londonHour, parseChecks,
} from '../run.mjs';

const ROOT = resolve(new URL('../../..', import.meta.url).pathname);
const SERVED = join(ROOT, 'e2e/served');
const source = (rel) => readFileSync(join(ROOT, 'e2e', rel), 'utf8');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SCRIPT_OF = Object.fromEntries(JOURNEYS.map((j) => [j.name, j.script]));

describe('the accepted counts and the declared skips', () => {
  it('CONTRACT: the accepted counts are the five accepted journeys, exactly', () => {
    assert.deepEqual({ ...ACCEPTED_COUNTS }, { journey: 43, recovery: 154, equivalence: 21, kitchen: 55, billing: 56 });
    assert.deepEqual(JOURNEYS.map((j) => j.name).sort(), Object.keys(ACCEPTED_COUNTS).sort());
  });

  it('CONTRACT: every declared skip names a check the journey really asserts, and is reached only through T.skip', () => {
    for (const [journey, skips] of Object.entries(SERVED_SKIPS)) {
      const text = source(SCRIPT_OF[journey]);
      for (const { name, reason } of skips) {
        assert.match(text, new RegExp(`check\\(\\s*['"\`]${escapeRe(name)}['"\`]`), `${journey}: "${name}" is not a check in ${SCRIPT_OF[journey]}`);
        assert.ok(reason.length > 40, `${journey}: "${name}" carries no real reason`);
      }
    }
  });

  it('CONTRACT: recovery skips nothing; the three sign-in skips are the one login the orchestrator does instead', () => {
    assert.deepEqual(SERVED_SKIPS.recovery, []);
    for (const j of ['journey', 'equivalence', 'kitchen']) {
      assert.deepEqual(SERVED_SKIPS[j].map((s) => s.name), ['the fixture operator can sign in']);
      assert.match(source(SCRIPT_OF[j]), /if \(T\.served\) T\.skip\('the fixture operator can sign in'\);\n\s+else check\('the fixture operator can sign in'/);
    }
    assert.equal(SERVED_SKIPS.billing.length, 41);
  });

  it('REGRESSION: an undeclared label cannot be skipped — it throws rather than quietly passing', () => {
    const T = journeyTarget({ target: 'served', restaurant: 'x' }, { api: 'https://example.invalid', journey: 'recovery' });
    assert.throws(() => T.skip('the accepted order stores the amount the diner agreed to'), /not a declared served skip/);
  });
});

describe('judging a journey', () => {
  const pass = (n) => Array.from({ length: n }, (_, i) => ({ name: `c${i}`, status: 'pass' }));
  const signIn = { name: 'the fixture operator can sign in', status: 'skip' };

  it('CONTROL: 42 passes plus the declared skip is the accepted 43', () => {
    assert.deepEqual(judgeJourney('journey', [...pass(42), signIn], 0).problems, []);
  });
  it('REGRESSION: a failed check fails the journey', () => {
    const r = judgeJourney('journey', [...pass(41), { name: 'x', status: 'fail' }, signIn], 1);
    assert.ok(r.problems.some((p) => /failed/.test(p)));
  });
  it('REGRESSION: a different total means a different path from the accepted evidence', () => {
    assert.ok(judgeJourney('journey', [...pass(41), signIn], 0).problems.some((p) => /42 checks reported, 43 accepted/.test(p)));
  });
  it('REGRESSION: an undeclared skip, or a declared one that did not happen, fails', () => {
    assert.ok(judgeJourney('journey', [...pass(42), { name: 'other', status: 'skip' }], 0).problems.some((p) => /skips differ/.test(p)));
    assert.ok(judgeJourney('journey', pass(43), 0).problems.some((p) => /skips differ/.test(p)));
  });
  it('REGRESSION: a journey that exits non-zero with no failed check (a refusal, a crash) fails', () => {
    assert.ok(judgeJourney('journey', [...pass(42), signIn], 2).problems.some((p) => /exited 2/.test(p)));
  });
});

describe('reading a journey\'s output', () => {
  it('CONTRACT: the checkout format, with and without a detail', () => {
    const out = 'PASS  a check\nFAIL  another one  — wanted 2, got 3\nSKIP  the fixture operator can sign in  — why\nnoise\n';
    assert.deepEqual(parseChecks(out, 'checkout'), [
      { name: 'a check', status: 'pass' },
      { name: 'another one', status: 'fail', detail: 'wanted 2, got 3' },
      { name: 'the fixture operator can sign in', status: 'skip', detail: 'why' },
    ]);
  });
  it('CONTRACT: the billing format', () => {
    const out = '  ok   states the capability\n  FAIL invents no price  — UGX 1\n  SKIP the revenue chart is not drawn  — why\n';
    assert.deepEqual(parseChecks(out, 'billing').map((c) => [c.name, c.status]), [
      ['states the capability', 'pass'], ['invents no price', 'fail'], ['the revenue chart is not drawn', 'skip'],
    ]);
  });
});

describe('the UAT window', () => {
  it('CONTRACT: 11:00–23:00 Europe/London, across both offsets', () => {
    assert.deepEqual({ ...WINDOW }, { zone: 'Europe/London', open: 11, close: 23 });
    assert.equal(londonHour(new Date('2026-07-01T10:00:00Z')), 11, 'BST');
    assert.equal(londonHour(new Date('2026-12-01T10:59:00Z')), 10, 'GMT');
  });
  it('CONTRACT: healthy runs; unreachable is NOT RUN outside the window and a failure inside it', () => {
    assert.equal(classifyHealth({ healthy: true, hour: 3 }), 'run');
    for (const hour of [0, 10, 23]) assert.equal(classifyHealth({ healthy: false, hour }), 'outside-window', hour);
    for (const hour of [11, 16, 22]) assert.equal(classifyHealth({ healthy: false, hour }), 'down-in-window', hour);
  });
});

describe('the served bundle names the API it calls', () => {
  const files = {
    '/': '<script src="polyfills-AAA.js" type="module"></script><script src="main-BBB111.js" type="module"></script>',
    '/polyfills-AAA.js': 'x',
    '/main-BBB111.js': 'import{a}from"./chunk-ENV.js";import("./chunk-LAZY.js")',
    '/chunk-ENV.js': 'var e={production:!1,apiUrl:`https://api-test.dinifyapp.com/uat`,version:"v1"};',
    '/chunk-LAZY.js': 'nothing here',
  };
  const fetchText = async (u) => files[new URL(u).pathname] ?? '';

  it('CONTRACT: the crawl follows static and dynamic imports and reports the main script and each apiUrl', async () => {
    const r = await bundleOrigins('https://site.example', fetchText);
    assert.equal(r.main, 'main-BBB111.js');
    assert.deepEqual(r.origins, [{ value: 'https://api-test.dinifyapp.com/uat', files: ['chunk-ENV.js'] }]);
    assert.equal(r.scripts, 4);
  });
  it('REGRESSION: a second configured origin is reported, so a mixed bundle cannot pass as one', async () => {
    const mixed = { ...files, '/chunk-LAZY.js': 'const x={apiUrl:"http://127.0.0.1:8099"}' };
    const r = await bundleOrigins('https://site.example', async (u) => mixed[new URL(u).pathname] ?? '');
    assert.deepEqual(r.origins.map((o) => o.value).sort(), ['http://127.0.0.1:8099', 'https://api-test.dinifyapp.com/uat']);
  });
});

describe('the interlock, against a loopback server', () => {
  const ID = '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
  const NAME = 'Dinify E2E Test Kitchen';
  let server; let api; let reply;
  before(async () => {
    server = createServer((req, res) => {
      const [status, body] = reply(req);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    api = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());
  const row = (over = {}) => ({ data: { id: ID, name: NAME, is_test: true, deleted: false, status: 'live', accepting_orders: true, ...over } });
  const check = () => assertTestRestaurant({ api, token: 't', restaurantId: ID, restaurantName: NAME });

  it('CONTROL: id, name and is_test all agree → the interlock passes and reads the lifecycle', async () => {
    reply = (req) => {
      assert.equal(req.url, `/api/v1/restaurant-setup/details/?record=restaurants&id=${ID}`);
      assert.equal(req.headers.authorization, 'Bearer t');
      return [200, row()];
    };
    assert.deepEqual(await check(), { status: 'live', accepting_orders: true });
  });
  for (const [label, over, why] of [
    ['is_test false', { is_test: false }, /not report it as a test restaurant/],
    ['is_test absent', { is_test: undefined }, /not report it as a test restaurant/],
    ['is_test "true" (a string)', { is_test: 'true' }, /not report it as a test restaurant/],
    ['a different name', { name: `${NAME} ` }, /name does not equal/],
    ['a different id', { id: '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e50' }, /different restaurant id/],
    ['soft-deleted', { deleted: true }, /soft-deleted/],
  ]) {
    it(`REGRESSION: ${label} → refused`, async () => {
      reply = () => [200, row(over)];
      await assert.rejects(check(), (e) => e instanceof InterlockError && why.test(e.message));
    });
  }
  it('REGRESSION: a 404 (unknown, foreign or deleted restaurant) is a refusal, not an absence to ignore', async () => {
    reply = () => [404, { status: 404, message: 'Not found' }];
    await assert.rejects(check(), /answered 404/);
  });
  it('REGRESSION: an unset name or a non-canonical id refuses before any request', async () => {
    reply = () => { throw new Error('no request may be made'); };
    await assert.rejects(assertTestRestaurant({ api, token: 't', restaurantId: ID, restaurantName: '' }), /NAME is not set/);
    await assert.rejects(assertTestRestaurant({ api, token: 't', restaurantId: ID.toUpperCase(), restaurantName: NAME }), /not a canonical/);
  });
  it('REGRESSION: a journey pointed at a non-local API without a served fixture refuses before any request', async () => {
    const T = journeyTarget({ restaurant: ID }, { api: 'https://api-test.dinifyapp.com/uat', journey: 'journey' });
    await assert.rejects(T.guard('t'), /non-loopback API needs a fixture/);
  });
  it('REGRESSION: a served fixture for another restaurant refuses before any request', async () => {
    const saved = { ...process.env };
    process.env.JOURNEY_RESTAURANT_ID = ID; process.env.JOURNEY_RESTAURANT_NAME = NAME;
    try {
      const T = journeyTarget({ target: 'served', restaurant: '00000000-0000-4000-8000-000000000000' }, { api, journey: 'journey' });
      await assert.rejects(T.guard('t'), /different restaurant from JOURNEY_RESTAURANT_ID/);
    } finally { process.env = saved; }
  });
  it('REGRESSION: a journey whose interlock REFUSED restores nothing — no write reaches that restaurant', async () => {
    const saved = { ...process.env };
    process.env.JOURNEY_RESTAURANT_ID = ID; process.env.JOURNEY_RESTAURANT_NAME = NAME;
    const seen = [];
    try {
      reply = (req) => { seen.push(req.method); return [200, row({ is_test: false })]; };
      const T = journeyTarget({ target: 'served', restaurant: ID, burger: 'b', rounding: 'r' }, { api, journey: 'journey' });
      await assert.rejects(T.guard('t'), InterlockError);
      assert.deepEqual(await T.restore('t'), []);
      assert.deepEqual(seen, ['GET'], 'the interlock read, and nothing after it');
    } finally { process.env = saved; }
  });
  it('CONTROL: once the interlock PASSED, the restore writes the canonical catalogue and trading', async () => {
    const saved = { ...process.env };
    process.env.JOURNEY_RESTAURANT_ID = ID; process.env.JOURNEY_RESTAURANT_NAME = NAME;
    const seen = [];
    try {
      reply = (req) => { seen.push(`${req.method} ${req.url}`); return [200, row()]; };
      const T = journeyTarget({ target: 'served', restaurant: ID, burger: 'b', rounding: 'r' }, { api, journey: 'journey' });
      await T.guard('t');
      assert.deepEqual(await T.restore('t'), []);
      assert.deepEqual(seen.slice(1), [
        'PUT /api/v1/restaurant-setup/menuitems/', 'PUT /api/v1/restaurant-setup/menuitems/',
        'PUT /api/v1/restaurant-setup/restaurants/',
      ]);
    } finally { process.env = saved; }
  });
  it('CONTROL: an unconfigured seeded LOCAL run is unchanged — the guard asks nothing', async () => {
    const saved = { ...process.env };
    delete process.env.JOURNEY_RESTAURANT_ID; delete process.env.JOURNEY_RESTAURANT_NAME;
    try {
      reply = () => { throw new Error('no request may be made'); };
      const T = journeyTarget({ restaurant: ID }, { api: 'http://127.0.0.1:8099', journey: 'journey' });
      assert.equal(T.served, false);
      assert.equal(T.pace(400), 400);
      assert.equal(await T.guard('t'), undefined);
      assert.deepEqual(await T.restore('t'), [], 'a seeded local run restores nothing, as before');
    } finally { process.env = saved; }
    assert.ok(isLoopback('http://127.0.0.1:8099') && !isLoopback('https://api-test.dinifyapp.com/uat'));
  });
});

describe('masking', () => {
  const runNode = (code, env) => spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: SERVED, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8',
  });

  it('CONTRACT: under GitHub Actions, mask() announces the value and its URL-encoded form with ::add-mask::', () => {
    const r = runNode("import { mask } from './lib.mjs'; mask('abc:def/ghi');", { GITHUB_ACTIONS: 'true' });
    assert.equal(r.stdout, '::add-mask::abc:def/ghi\n::add-mask::abc%3Adef%2Fghi\n');
  });
  it('CONTROL: outside Actions it prints nothing, but still registers the value for redaction', () => {
    const r = runNode("import { mask, knownSecrets } from './lib.mjs'; mask('abcdefgh'); console.error(knownSecrets().join());", {});
    assert.equal(r.stdout, '');
    assert.equal(r.stderr.trim(), 'abcdefgh');
  });
  it('CONTRACT: a journey announces a table session it minted, in served mode only', () => {
    const code = "import { journeyTarget } from './lib.mjs';"
      + "journeyTarget({ target: 'served' }, { api: 'x', journey: 'recovery' }).mask('session-value');"
      + "journeyTarget({}, { api: 'x', journey: 'recovery' }).mask('local-value');";
    assert.equal(runNode(code, { JOURNEY_MASK_PIPE: '1' }).stdout, '::add-mask::session-value\n');
  });
  it('CONTRACT: the orchestrator masks the username and password before anything else, and relays a journey\'s masks', () => {
    const run = readFileSync(join(SERVED, 'run.mjs'), 'utf8');
    const masked = run.indexOf('mask(cfg.username); mask(cfg.password);');
    assert.ok(masked > 0, 'the credentials are masked');
    for (const later of ['await servingIdentity(', 'await signIn(', 'await provision(']) {
      assert.ok(run.indexOf(later) > masked, `${later} runs after the credentials are masked`);
    }
    assert.match(run, /line\.startsWith\('::add-mask::'\)/, 'a journey\'s ::add-mask:: line is intercepted');
    assert.match(run, /JOURNEY_MASK_PIPE: '1'/);
    for (const j of ['checkout-journey/recovery.mjs', 'kitchen-board/kitchen.mjs']) {
      assert.match(source(j), /T\.mask\(/, `${j} announces the sessions it mints`);
    }
  });
});

describe('the redaction scan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'served-redact-test-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const scan = (text, env = {}) => {
    const file = join(dir, `e-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, text);
    return spawnSync(process.execPath, [join(SERVED, 'redact.mjs'), 'scan', file], {
      env: { PATH: process.env.PATH, ...env }, encoding: 'utf8',
    });
  };

  it('CONTRACT: the self-test plants one value of each class and finds every one', () => {
    assert.deepEqual(selfTest(), []);
    assert.deepEqual(PATTERNS.map(([n]) => n), ['jwt', 'django-signed', 'bearer', 'diner-header', 'credential-param', 'secret-field', 'msisdn']);
  });
  it('CONTROL: a clean evidence shape scans clean (exit 0)', () => {
    const r = scan(JSON.stringify({ restaurant: '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f', main: 'main-OWTGDKLC.js', sha: 'a'.repeat(40) }));
    assert.equal(r.status, 0, r.stdout);
  });
  it('REGRESSION: a planted JWT fails closed (exit 1), and the scan never prints the value it found', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoib3duZXIifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
    const r = scan(JSON.stringify({ detail: `token ${jwt}` }));
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FOUND jwt at offset/);
    assert.ok(!r.stdout.includes(jwt) && !r.stderr.includes(jwt));
  });
  it('REGRESSION: an exact operator credential that has no token shape is caught through REDACT_EXTRA_VALUES', () => {
    const r = scan(JSON.stringify({ note: 'correct horse battery' }), { REDACT_EXTRA_VALUES: '\ncorrect horse battery\n' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FOUND known-secret/);
  });
  it('REGRESSION: a missing file is not "clean" (exit 2), so no upload follows', () => {
    const r = spawnSync(process.execPath, [join(SERVED, 'redact.mjs'), 'scan', join(dir, 'absent.json')], { encoding: 'utf8' });
    assert.equal(r.status, 2);
  });
  it('CONTRACT: redaction leaves nothing findable', () => {
    const text = 'X-Diner-Session: .eJwNzDEOgDAIBdCrdK4mKFi5ilc6:1vDpFU:abcdefghijklmnopqrstuvwxyzAB ?c=abcdefghij0123456789 256700000901';
    assert.deepEqual(scanText(redactText(text)), []);
  });
});

describe('the probes assert the exact refusals', () => {
  it('CONTRACT: D01 messages come from the backend-authored ceiling and the order_input sentence', () => {
    const limits = JSON.parse(readFileSync(join(ROOT, 'src/app/_shared/order/checkout-limits.contract.json'), 'utf8'));
    assert.equal(D01_QUANTITY_MESSAGE, `Each item needs a whole quantity between 1 and ${limits.MAX_QUANTITY_PER_LINE}.`);
    assert.equal(D01_INVALID_REQUEST_MESSAGE, 'The order request is not valid. Please try again.');
  });
  it('CONTRACT: D07 is the same 501, reason and sentence billing.mjs asserts', () => {
    const billing = source('billing-journey/billing.mjs');
    assert.equal(D07_STATUS, 501);
    assert.ok(billing.includes(`'${D07_REASON}'`));
    for (const part of D07_MESSAGE.split('. ')) assert.ok(billing.includes(part.replace(/\.$/, '')), part);
  });
  it('CONTRACT: the five quantities and the non-object body are the ones the finding named', () => {
    const probes = readFileSync(join(SERVED, 'probes.mjs'), 'utf8');
    assert.ok(probes.includes(`[['0', 0], ['-3', -3], ['2.5', 2.5], ['true', true], ['"3"', '3']]`));
    assert.match(probes, /initiate\(\[\{ items: \[line\(1\)\], client_order_id: arrayKey \}\]\)/);
  });
});

describe('what the harness may and may not reach', () => {
  it('CONTRACT: the OTP is the fixed development code, never read from the environment', () => {
    assert.equal(DEV_OTP, '1234');
    for (const f of ['run.mjs', 'provision.mjs', 'lib.mjs', 'probes.mjs']) {
      assert.doesNotMatch(readFileSync(join(SERVED, f), 'utf8'), /process\.env\.[A-Z_]*OTP/, f);
    }
  });
  it('CONTRACT: provisioning and the probes reach no database and no shell — only the HTTP API', () => {
    for (const f of ['provision.mjs', 'probes.mjs', 'lib.mjs', 'redact.mjs']) {
      const text = readFileSync(join(SERVED, f), 'utf8');
      assert.doesNotMatch(text, /from 'node:child_process'|from 'pg'|from 'postgres'|\bspawn\(|\bexecSync\(|\bexecFile/, f);
    }
    const run = readFileSync(join(SERVED, 'run.mjs'), 'utf8');
    assert.equal(run.match(/\bspawn\(/g).length, 1, 'one process-spawning site');
    assert.match(run, /spawn\(process\.execPath, \[script\]/, 'it runs node, nothing else');
    assert.match(run, /runChild\(join\(E2E, j\.script\)/, 'on a journey script under e2e/');
    assert.doesNotMatch(run, /manage\.py|seed\.py|psql/);
  });
  it('CONTRACT: no harness or journey records a trace, a HAR, a video or a screenshot', () => {
    for (const rel of [...JOURNEYS.map((j) => j.script), 'served/run.mjs', 'served/provision.mjs', 'served/probes.mjs', 'served/lib.mjs']) {
      assert.doesNotMatch(source(rel), /tracing\.start|recordHar|routeFromHAR|recordVideo|\.screenshot\(/, rel);
    }
  });
});
