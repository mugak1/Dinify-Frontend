/**
 * The manifest and provenance readers.
 *
 * These matter for one reason: the publisher treats a downloaded artifact as DATA,
 * and a malformed manifest must produce a named refusal rather than an exception in
 * a shell step that something later swallows. Every case here asserts a CODE, not
 * merely that something went wrong.
 */

import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import { validateManifest, validateProvenance, buildProvenance, MANIFEST_SCHEMA } from '../lib/manifest.mjs';
import { canonicalJson, digestOfValue, treeDigest, contractDigest } from '../lib/canonical.mjs';
import { hostingDestinationProblems } from '../lib/source.mjs';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
import { manifestFor, provenanceFor, TREE_DIGEST, TARGET_SHA } from './fixtures.mjs';

const problemCodes = (r) => r.problems.map((p) => p.code);

describe('manifest validation', () => {
  test('CONTROL: the fixture manifest is valid', () => {
    const r = validateManifest(manifestFor());
    assert.equal(r.ok, true, JSON.stringify(r.problems));
  });

  const reject = (name, code, mutate) => test(name, () => {
    const m = manifestFor();
    mutate(m);
    const r = validateManifest(m);
    assert.equal(r.ok, false);
    assert.ok(problemCodes(r).includes(code), `expected ${code}, got ${JSON.stringify(problemCodes(r))}`);
  });

  test('rejects a non-object', () => {
    for (const value of [null, 'x', 42, []]) {
      const r = validateManifest(value);
      assert.equal(r.ok, false);
      assert.deepEqual(problemCodes(r), ['manifest.not_an_object']);
    }
  });

  reject('rejects a future schema it does not understand', 'manifest.wrong_schema', (m) => { m.schema = 'dinify.release.manifest/2'; });
  reject('rejects a short commit', 'manifest.bad_commit', (m) => { m.commit = 'abc1234'; });
  reject('rejects an uppercase commit', 'manifest.bad_commit', (m) => { m.commit = 'A'.repeat(40); });
  reject('rejects a missing build configuration', 'manifest.no_build_configuration', (m) => { delete m.buildConfiguration; });
  reject('rejects a non-ISO build time', 'manifest.bad_built_at', (m) => { m.builtAt = '22/09/2026'; });
  reject('rejects a non-https API origin', 'manifest.bad_api_url', (m) => { m.environment.apiUrl = 'http://api-test.dinifyapp.com/uat'; });
  reject('rejects an absent production flag — it is a fact, not an optional note', 'manifest.no_production_flag', (m) => { delete m.environment.productionFlag; });
  reject('rejects a lock digest that is not sha256', 'manifest.bad_lock_digest', (m) => { m.dependencies.lockDigest = 'md5:abc'; });
  reject('rejects a workflow path outside .github/workflows', 'manifest.bad_workflow_path', (m) => { m.certification.workflowPath = 'certify.yml'; });
  reject('rejects a non-numeric run id', 'manifest.bad_run_reference', (m) => { m.certification.runId = 'latest'; });
  reject('rejects a zero storage version', 'manifest.bad_storage_version', (m) => { m.compatibility.storage.checkoutRecordVersion = 0; });
  reject('rejects a missing semantics revision', 'manifest.bad_semantics_revision', (m) => { delete m.compatibility.storage.semanticsRevision; });
  reject('rejects empty client expectations', 'manifest.no_client_expectations', (m) => { m.compatibility.clientExpects = {}; });
  reject('rejects a non-integer protocol level', 'manifest.bad_protocol_level', (m) => { m.compatibility.clientExpects.quote_protocol = '2'; });
  reject('rejects a missing client-constant record', 'manifest.no_client_constants', (m) => { delete m.compatibility.clientConstants; });
  reject('rejects a malformed contract digest', 'manifest.bad_contract_digest', (m) => { m.compatibility.contracts.d01CheckoutLimits = 'sha256:short'; });

  test('reports EVERY problem, so one fix at a time is not needed', () => {
    const m = manifestFor();
    m.commit = 'nope';
    m.buildConfiguration = '';
    delete m.environment.productionFlag;
    const r = validateManifest(m);
    assert.ok(problemCodes(r).length >= 3, JSON.stringify(problemCodes(r)));
  });
});

describe('provenance validation', () => {
  test('CONTROL: a provenance record built for a manifest validates against it', () => {
    const manifest = manifestFor();
    const provenance = buildProvenance({
      manifest, artifactName: 'frontend-release', artifactTreeDigest: TREE_DIGEST, entryCount: 3,
    });
    const r = validateProvenance(provenance, manifest);
    assert.equal(r.ok, true, JSON.stringify(r.problems));
  });

  test('rejects a provenance record describing a different commit', () => {
    const manifest = manifestFor();
    const provenance = provenanceFor(manifest, TREE_DIGEST);
    provenance.commit = 'f'.repeat(40);
    const r = validateProvenance(provenance, manifest);
    assert.ok(problemCodes(r).includes('provenance.commit_disagrees'));
  });

  test('rejects a provenance record whose manifest digest does not match the manifest', () => {
    const manifest = manifestFor();
    const provenance = provenanceFor(manifest, TREE_DIGEST);
    manifest.builtAt = '2026-09-22T11:31:00Z';
    const r = validateProvenance(provenance, manifest);
    assert.ok(problemCodes(r).includes('provenance.manifest_digest_disagrees'));
  });

  test('rejects a tree digest that is not sha256', () => {
    const manifest = manifestFor();
    const r = validateProvenance(provenanceFor(manifest, 'sha1:abc'), manifest);
    assert.ok(problemCodes(r).includes('provenance.bad_tree_digest'));
  });
});

describe('canonical form and digests', () => {
  test('object key order does not change the canonical form', () => {
    assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
    assert.equal(digestOfValue({ b: 1, a: 2 }), digestOfValue({ a: 2, b: 1 }));
  });

  test('array order DOES change it — an ordered list is data, not a set', () => {
    assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  });

  test('a tree digest is independent of the order entries are supplied in', () => {
    const a = [{ path: 'a', sha256: '0'.repeat(64) }, { path: 'b', sha256: '1'.repeat(64) }];
    assert.equal(treeDigest(a), treeDigest([...a].reverse()));
  });

  test('a tree digest changes when any file content changes', () => {
    const a = [{ path: 'a', sha256: '0'.repeat(64) }];
    const b = [{ path: 'a', sha256: '1'.repeat(64) }];
    assert.notEqual(treeDigest(a), treeDigest(b));
  });

  test('a tree digest changes when a file is renamed', () => {
    assert.notEqual(
      treeDigest([{ path: 'a', sha256: '0'.repeat(64) }]),
      treeDigest([{ path: 'b', sha256: '0'.repeat(64) }]),
    );
  });

  test('a path cannot spell another entry — the delimiter is NUL, not whitespace', () => {
    const sixty4 = '0'.repeat(64);
    assert.notEqual(
      treeDigest([{ path: 'a', sha256: sixty4 }, { path: 'b', sha256: sixty4 }]),
      treeDigest([{ path: `a\u0000${sixty4}\nb`, sha256: sixty4 }]),
    );
  });

  test('refuses a duplicate path rather than silently keeping one', () => {
    assert.throws(() => treeDigest([
      { path: 'a', sha256: '0'.repeat(64) }, { path: 'a', sha256: '1'.repeat(64) },
    ]), /duplicate/);
  });

  test('refuses an entry with no digest', () => {
    assert.throws(() => treeDigest([{ path: 'a' }]), /sha256/);
  });

  test('the D01 digest ignores provenance notes but not values', () => {
    const base = { MAX_A: 1, MAX_B: 2 };
    assert.equal(contractDigest(base), contractDigest({ ...base, _source: 'anywhere', _note: ['x'] }));
    assert.notEqual(contractDigest(base), contractDigest({ MAX_A: 1, MAX_B: 3 }));
  });

  test('the D01 digest refuses a non-integer ceiling', () => {
    assert.throws(() => contractDigest({ MAX_A: '1' }), /not an integer/);
    assert.throws(() => contractDigest({ MAX_A: 1.5 }), /not an integer/);
  });

  test('the D01 digest refuses an empty contract', () => {
    assert.throws(() => contractDigest({ _note: 'nothing here' }), /empty/);
  });
});

describe('the hosting destination — what gets published, and where', () => {
  // Codex P1 on #686: until this existed, the gate validated the payload
  // exhaustively and validated almost nothing about the configuration that decides
  // where the payload goes.
  const POLICY_DESTINATION = { site: 'dinify-prod', publicDirectory: './dist' };
  const ok = (config) => hostingDestinationProblems(config, POLICY_DESTINATION);
  const shipping = { hosting: [{ site: 'dinify-prod', public: './dist' }] };

  test('CONTROL: the configuration this repository ships is accepted', () => {
    assert.deepEqual(ok(JSON.parse(readFileSync(`${ROOT}/firebase.json`, 'utf8'))), []);
  });

  test('CONTROL: the policy and firebase.json agree today', () => {
    const policy = JSON.parse(readFileSync(`${ROOT}/release/policy.json`, 'utf8'));
    const config = JSON.parse(readFileSync(`${ROOT}/firebase.json`, 'utf8'));
    assert.deepEqual(
      hostingDestinationProblems(config, {
        site: policy.hosting.site,
        publicDirectory: policy.hosting.publicDirectory,
      }),
      [],
      'release/policy.json and firebase.json disagree about the hosting destination',
    );
  });

  test('THE REGRESSION: a public directory of "." is refused', () => {
    const problems = ok({ hosting: [{ site: 'dinify-prod', public: '.' }] });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /hosting\.public/);
  });

  test('refuses any other public directory', () => {
    assert.equal(ok({ hosting: [{ site: 'dinify-prod', public: 'build' }] }).length, 1);
    assert.equal(ok({ hosting: [{ site: 'dinify-prod', public: './dist/browser' }] }).length, 1);
  });

  test('refuses a missing or non-string public directory', () => {
    assert.equal(ok({ hosting: [{ site: 'dinify-prod' }] }).length, 1);
    assert.equal(ok({ hosting: [{ site: 'dinify-prod', public: ['./dist'] }] }).length, 1);
  });

  test('accepts the equivalent spellings of the same directory', () => {
    // `./dist`, `dist` and `dist/` name one directory to Firebase; refusing a
    // semantically identical value would be a false gate.
    for (const value of ['./dist', 'dist', 'dist/', './dist/']) {
      assert.deepEqual(ok({ hosting: [{ site: 'dinify-prod', public: value }] }), [], value);
    }
  });

  test('accepts a single hosting object as well as an array', () => {
    assert.deepEqual(ok({ hosting: { site: 'dinify-prod', public: './dist' } }), []);
  });

  test('refuses a configuration with no hosting block', () => {
    assert.equal(ok({}).length, 1);
    assert.equal(ok({ hosting: [] }).length, 1);
  });

  test('refuses a configuration that declares a different site', () => {
    assert.equal(ok({ hosting: [{ site: 'somewhere-else', public: './dist' }] }).length, 1);
  });

  test('refuses an ambiguous configuration declaring the site twice', () => {
    const problems = ok({ hosting: [shipping.hosting[0], { site: 'dinify-prod', public: 'other' }] });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /2 hosting blocks/);
  });

  test('a block for an unrelated site alongside ours is not refused', () => {
    assert.deepEqual(ok({ hosting: [{ site: 'other-site', public: 'x' }, shipping.hosting[0]] }), []);
  });
});
