/**
 * THE BASELINE SECURITY HEADERS (D14 B2) — what the release path would serve, per path.
 *
 * firebase.json appends one rule to every path: `object-src 'none'; base-uri 'self'`,
 * `nosniff` and `Referrer-Policy: strict-origin`. It restricts plugin objects and
 * `<base>` changes, enforces declared MIME types where the browser supports it, and
 * limits referrer detail. It is NOT script-injection protection, and it deliberately
 * sets no `frame-ancestors`: whether the product may be framed is a separate decision.
 *
 * These tests read the committed firebase.json and .firebaserc through `effectiveHosting`
 * (the gate's own decision) and serve the REGENERATED rules — the configuration the
 * publisher hands the tool — through superstatic's header middleware, Firebase's
 * open-source hosting server, the same oracle hosting-oracle.test.mjs pins the model
 * against. The legacy deploy-prod.yml deploys the committed firebase.json directly, so
 * the committed and regenerated rules must agree, and the first control says so.
 *
 * Every expected value is written out HERE, independently of the configuration under
 * test, so the file cannot agree with itself. superstatic normalises rule objects in
 * place (the RECORD below shows it), so every call gets its own deep copy.
 *
 * It asserts the configuration and a local matching oracle, never what the production
 * CDN serves: that is the owner-authorised live-header check, which this does not replace.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { effectiveHosting, headerSourceMatches, identityCacheControl } from '../lib/hosting.mjs';
import { ROOT } from './harness.mjs';
import { POLICY } from './fixtures.mjs';

const require = createRequire(join(ROOT, 'package.json'));
const SS = join(ROOT, 'node_modules/superstatic/lib');
const headersMiddleware = require(join(SS, 'middleware/headers.js'));
const { configMatcher } = require(join(SS, 'utils/patterns.js'));
const slasher = require(join(ROOT, 'node_modules/glob-slasher'));
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const FIREBASE_JSON = readJson('firebase.json');
const FIREBASERC = readJson('.firebaserc');

const deepFreeze = (value) => {
  if (value && typeof value === 'object') Object.values(Object.freeze(value)).forEach(deepFreeze);
  return value;
};

/** The approved block. Changing a value here is a reviewed policy change. */
const APPROVED_RULE = deepFreeze({
  source: '**',
  headers: [
    { key: 'Content-Security-Policy', value: "object-src 'none'; base-uri 'self'" },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin' },
  ],
});
const EXPECTED_SERVED = deepFreeze({
  'content-security-policy': "object-src 'none'; base-uri 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin',
});

const IMMUTABLE = 'public, max-age=31536000, immutable';
/** The rules that were there before the block, unchanged by it. */
const EXISTING_RULES = deepFreeze([
  { source: '/release.json', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
  { source: '/index.html', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
  { source: '/**/*.@(js|css)', headers: [{ key: 'Cache-Control', value: IMMUTABLE }] },
]);

/** One path per class the site serves, and the Cache-Control that class is served with.
 *  `undefined` means no rule sets it, so the host's default applies. */
const PATHS = deepFreeze([
  { cls: 'the root', path: '/', cache: undefined },
  { cls: 'the index document', path: '/index.html', cache: 'no-cache' },
  { cls: 'a portal deep link', path: '/dining-tables', cache: undefined },
  { cls: 'a nested portal route', path: '/reports/sales', cache: undefined },
  { cls: 'a diner route', path: '/diner/h/33333333-3333-3333-3333-333333333307', cache: undefined },
  { cls: 'the release identity', path: '/release.json', cache: 'no-store' },
  { cls: 'a hashed entry script', path: '/main-WBAIEGT6.js', cache: IMMUTABLE },
  { cls: 'a hashed lazy chunk', path: '/chunk-DY3w8FNB.js', cache: IMMUTABLE },
  { cls: 'a hashed stylesheet', path: '/styles-6IFACDR2.css', cache: IMMUTABLE },
  { cls: 'a font', path: '/media/plus-jakarta-sans-latin-wght-normal-XZSBT77D.woff2', cache: undefined },
  { cls: 'an SVG image', path: '/assets/images/dinify-logo-full.svg', cache: undefined },
  { cls: 'the favicon', path: '/favicon.ico', cache: undefined },
]);

/** Headers this slice must not add anywhere: framing, transport, reporting, other policies. */
const UNAPPROVED_KEYS = [
  'x-frame-options', 'strict-transport-security', 'permissions-policy', 'content-security-policy-report-only',
  'report-to', 'reporting-endpoints', 'cross-origin-opener-policy', 'cross-origin-embedder-policy',
];

/** The headers superstatic's middleware sets on `path` under `rules` (a deep copy of them). */
function served(rules, path) {
  const set = {};
  const res = { setHeader: (k, v) => { set[k.toLowerCase()] = v; }, writeHead: () => {} };
  headersMiddleware({})({ url: path, superstatic: { headers: structuredClone(rules) } }, res, () => {});
  res.writeHead(200);
  return set;
}

/** The gate's decision over a firebase.json (the committed one unless given). */
function evaluate(firebaseJson = FIREBASE_JSON) {
  return effectiveHosting({
    firebaseJson: structuredClone(firebaseJson), firebaserc: structuredClone(FIREBASERC), policy: POLICY, files: [],
  });
}

/** The rules the publisher would hand the tool. */
function regenerated() {
  const r = evaluate();
  assert.deepEqual(r.problems, [], JSON.stringify(r.problems));
  return r.config.hosting[0].headers;
}

/** The committed configuration with its header rules replaced. */
function withRules(rules) {
  const c = structuredClone(FIREBASE_JSON);
  c.hosting[0].headers = structuredClone(rules);
  return c;
}

const codes = (r) => r.problems.map((p) => p.code);
const directives = (csp) => csp.split(';').map((d) => d.trim()).filter(Boolean);

describe('the approved block, as committed', () => {
  test('CONTRACT: firebase.json appends exactly the approved rule, last', () => {
    const rules = FIREBASE_JSON.hosting[0].headers;
    assert.equal(rules.length, EXISTING_RULES.length + 1);
    assert.deepEqual(rules.at(-1), APPROVED_RULE);
    const carriers = rules.filter((r) => r.headers.some((kv) => Object.hasOwn(EXPECTED_SERVED, kv.key.toLowerCase())));
    assert.equal(carriers.length, 1, 'exactly one rule sets any of the three headers');
  });

  test('CONTROL: the existing rules and the rest of the entry are unchanged', () => {
    const entry = FIREBASE_JSON.hosting[0];
    assert.deepEqual(entry.headers.slice(0, EXISTING_RULES.length), EXISTING_RULES);
    assert.deepEqual({ site: entry.site, public: entry.public, ignore: entry.ignore, rewrites: entry.rewrites }, {
      site: 'dinify-prod', public: './dist', ignore: ['firebase.json', '**/.*', '**/node_modules/**'],
      rewrites: [{ source: '**', destination: '/index.html' }],
    });
  });

  test('CONTRACT: the block carries two CSP directives and three keys — no framing, reporting, source list or cache', () => {
    const block = FIREBASE_JSON.hosting[0].headers.at(-1);
    assert.deepEqual(block.headers.map((kv) => kv.key.toLowerCase()).sort(), Object.keys(EXPECTED_SERVED).sort());
    const csp = block.headers.find((kv) => kv.key.toLowerCase() === 'content-security-policy').value;
    assert.deepEqual(directives(csp).map((d) => d.split(/\s+/)[0]), ['object-src', 'base-uri']);
  });

  test('CONTROL: no rule anywhere restricts framing or adds another unapproved header', () => {
    for (const rule of FIREBASE_JSON.hosting[0].headers) {
      for (const { key, value } of rule.headers) {
        assert.ok(!UNAPPROVED_KEYS.includes(key.toLowerCase()), `${key} on ${rule.source}`);
        if (key.toLowerCase() === 'content-security-policy') {
          for (const d of directives(value)) {
            assert.ok(!/^(frame-ancestors|report-uri|report-to|sandbox)\b/i.test(d), `${d} on ${rule.source}`);
          }
        }
      }
    }
  });
});

describe('as the release path would serve it', () => {
  test('CONTROL: the gate admits the committed configuration and regenerates its rules verbatim', () => {
    const rules = regenerated();
    assert.deepEqual(rules, FIREBASE_JSON.hosting[0].headers, 'the legacy deploy and the publisher serve the same rules');
    assert.notEqual(rules, FIREBASE_JSON.hosting[0].headers, 'a regenerated copy, not the parsed file');
  });

  test('CONTRACT: the regenerated configuration carries the approved block, last', () => {
    assert.deepEqual(regenerated().at(-1), APPROVED_RULE);
  });

  for (const { cls, path, cache } of PATHS) {
    test(`CONTRACT: ${cls} (${path}) carries exactly the three values, and keeps its own Cache-Control`, () => {
      const set = served(regenerated(), path);
      for (const [key, value] of Object.entries(EXPECTED_SERVED)) assert.equal(set[key], value, `${key} on ${path}`);
      assert.equal(set['cache-control'], cache, `Cache-Control on ${path}`);
      for (const key of UNAPPROVED_KEYS) assert.equal(set[key], undefined, `${key} on ${path}`);
    });
  }

  test('CONTRACT: the header model agrees with the hosting library wherever it decides, and does not guess the root', () => {
    let decided = 0;
    for (const { path } of PATHS) {
      const model = headerSourceMatches(APPROVED_RULE.source, path);
      if (model === null) continue;
      decided += 1;
      assert.equal(model, true, path);
      assert.equal(configMatcher(slasher(path), { source: slasher(APPROVED_RULE.source) }), true, path);
    }
    assert.equal(headerSourceMatches(APPROVED_RULE.source, '/'), null, 'the root is outside the model, and stays so');
    assert.equal(decided, PATHS.length - 1);
  });

  test('CONTRACT: the identity stays no-store with the block present', () => {
    assert.deepEqual(identityCacheControl(regenerated(), POLICY.hosting.identityPath), { state: 'no-store', values: ['no-store'] });
    assert.equal(POLICY.hosting.identityPath, '/release.json', 'the identity path class above is this path');
  });
});

describe('the identity refusals still hold with the block present', () => {
  const block = () => structuredClone(APPROVED_RULE);

  test('CONTRACT: an identity made cacheable is refused', () => {
    const r = evaluate(withRules([
      { source: '/release.json', headers: [{ key: 'Cache-Control', value: 'public, max-age=300' }] },
      ...EXISTING_RULES.slice(1), block(),
    ]));
    assert.ok(codes(r).includes('hosting.identity_cacheable'), JSON.stringify(codes(r)));
    assert.equal(r.config, null);
  });

  test('CONTRACT: an identity with no Cache-Control rule is refused — the block does not stand in for one', () => {
    const r = evaluate(withRules([...EXISTING_RULES.slice(1), block()]));
    assert.ok(codes(r).includes('hosting.identity_cacheable'), JSON.stringify(codes(r)));
  });

  test('CONTRACT: an undecidable rule that sets Cache-Control is refused as unproven', () => {
    const r = evaluate(withRules([...EXISTING_RULES, block(),
      { source: '/{release,x}.json', headers: [{ key: 'Cache-Control', value: 'max-age=60' }] }]));
    assert.ok(codes(r).includes('hosting.identity_cache_unproven'), JSON.stringify(codes(r)));
  });

  test('CONTRACT: a Cache-Control inside the block would reach the identity and is refused', () => {
    const cached = block();
    cached.headers.push({ key: 'Cache-Control', value: 'no-cache' });
    const r = evaluate(withRules([...EXISTING_RULES, cached]));
    assert.ok(codes(r).includes('hosting.identity_cacheable'), JSON.stringify(codes(r)));
  });

  test('CONTRACT: the block is part of the admitted configuration — removing it changes the digest', () => {
    const withBlock = evaluate();
    const without = evaluate(withRules(EXISTING_RULES));
    assert.deepEqual(withBlock.problems, []);
    assert.deepEqual(without.problems, []);
    assert.notEqual(withBlock.digest, without.digest);
  });
});

describe('record', () => {
  test('RECORD: the oracle and publisher versions', (t) => {
    const ss = readJson('node_modules/superstatic/package.json').version;
    const ft = readJson('node_modules/firebase-tools/package.json').version;
    const lock = readJson('release/publisher/package-lock.json').packages;
    for (const v of [ss, ft]) assert.match(v, /^\d+\.\d+\.\d+$/);
    t.diagnostic(`oracle: superstatic ${ss} (installed with firebase-tools ${ft}); `
      + `publisher lock: firebase-tools ${lock['node_modules/firebase-tools']?.version}, superstatic ${lock['node_modules/superstatic']?.version}. `
      + 'superstatic is a local matching oracle, not the production CDN.');
  });

  test('RECORD: superstatic rewrites the rules it is handed, which is why every call gets a copy', () => {
    const rules = [structuredClone(APPROVED_RULE)];
    const res = { setHeader: () => {}, writeHead: () => {} };
    headersMiddleware({})({ url: '/', superstatic: { headers: rules } }, res, () => {});
    res.writeHead(200);
    assert.equal(rules[0].source, '/**', 'normalised in place from "**"');
    assert.equal(APPROVED_RULE.source, '**', 'the expected value was not the object handed over');
  });
});
