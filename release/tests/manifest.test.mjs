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

import {
  validateManifest, validateProvenance, buildProvenance, buildManifest, clientExpectationsFrom,
} from '../lib/manifest.mjs';
import { canonicalJson, digestOfValue, treeDigest, contractDigest } from '../lib/canonical.mjs';
import {
  manifestFor, provenanceFor, TREE_DIGEST, TARGET_SHA, SOURCE_TREE, CONSTANTS, STORAGE, POLICY,
  D01_DIGEST, LOCK_DIGEST, RUN_STARTED,
} from './fixtures.mjs';

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

  reject('rejects a future schema it does not understand', 'manifest.wrong_schema', (m) => { m.schema = 'dinify.release.manifest/3'; });
  reject('CONTRACT: rejects a /1 manifest — its storage fields mean something else', 'manifest.wrong_schema', (m) => { m.schema = 'dinify.release.manifest/1'; });
  reject('CONTRACT: rejects a missing source tree — a commit names history, not content', 'manifest.bad_source_tree', (m) => { delete m.source; });
  reject('CONTRACT: rejects an abbreviated source tree', 'manifest.bad_source_tree', (m) => { m.source.tree = 'e'.repeat(12); });
  reject('rejects a short commit', 'manifest.bad_commit', (m) => { m.commit = 'abc1234'; });
  reject('rejects an uppercase commit', 'manifest.bad_commit', (m) => { m.commit = 'A'.repeat(40); });
  reject('rejects a missing build configuration', 'manifest.no_build_configuration', (m) => { delete m.buildConfiguration; });
  reject('rejects a non-ISO build time', 'manifest.bad_built_at', (m) => { m.builtAt = '22/09/2026'; });
  reject('rejects a non-https API origin', 'manifest.bad_api_url', (m) => { m.environment.apiUrl = 'http://api-test.dinifyapp.com/uat'; });
  reject('rejects an absent production flag — it is a fact, not an optional note', 'manifest.no_production_flag', (m) => { delete m.environment.productionFlag; });
  reject('rejects a lock digest that is not sha256', 'manifest.bad_lock_digest', (m) => { m.dependencies.lockDigest = 'md5:abc'; });
  reject('rejects a workflow path outside .github/workflows', 'manifest.bad_workflow_path', (m) => { m.certification.workflowPath = 'certify.yml'; });
  reject('rejects a non-numeric run id', 'manifest.bad_run_reference', (m) => { m.certification.runId = 'latest'; });
  reject('CONTRACT: rejects a zero storage version', 'manifest.bad_storage', (m) => { m.compatibility.storage.writes.version = 0; });
  reject('CONTRACT: rejects a missing semantics pair', 'manifest.bad_storage', (m) => { delete m.compatibility.storage.writes.semantics; });
  reject('CONTRACT: rejects storage with no readable pairs', 'manifest.bad_storage', (m) => { m.compatibility.storage.reads = []; });
  reject('REGRESSION (R2): rejects the /1 numeric storage shape rather than guessing', 'manifest.bad_storage', (m) => {
    m.compatibility.storage = { checkoutRecordVersion: 2, semanticsRevision: 1 };
  });
  reject('CONTRACT: rejects a storage declaration digest that is not sha256', 'manifest.bad_storage_declaration_digest', (m) => { m.compatibility.storage.declarationDigest = 'sha1:x'; });
  reject('CONTRACT (Codex P2 on #687): rejects storage that does not say where its bytes are', 'manifest.bad_storage', (m) => { delete m.compatibility.storage.physicalKey; });
  reject('CONTRACT (Codex P2 on #687): rejects storage that does not say how its bytes are encoded', 'manifest.bad_storage', (m) => { m.compatibility.storage.encoding = ''; });
  reject('CONTRACT: rejects missing client quote-policy support', 'manifest.bad_client_supports', (m) => { delete m.compatibility.clientSupports; });
  reject('CONTRACT: rejects a non-integer supported quote-policy version', 'manifest.bad_client_supports', (m) => { m.compatibility.clientSupports.quote_policy_version = ['1']; });
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

describe('buildManifest — the shape stamp writes', () => {
  const built = () => buildManifest({
    policy: POLICY,
    commit: TARGET_SHA,
    ref: 'refs/heads/main',
    sourceTree: SOURCE_TREE,
    builtAt: RUN_STARTED,
    env: { apiUrl: 'https://api-test.dinifyapp.com/uat', dinerBaseUrl: 'https://order.dinifyapp.com', production: false },
    lockDigest: LOCK_DIGEST,
    nodeVersion: 'v24.21.0',
    run: { runId: 4242, runAttempt: 1, runStartedAt: RUN_STARTED },
    constants: { ...CONSTANTS },
    supportedQuotePolicyVersions: [1],
    storage: STORAGE,
    d01Digest: D01_DIGEST,
  });

  test('CONTROL: what stamp assembles validates', () => {
    const r = validateManifest(built());
    assert.equal(r.ok, true, JSON.stringify(r.problems));
  });

  test('CONTROL: stamp and the fixture agree on every field the gate reads', () => {
    assert.deepEqual(built(), manifestFor());
  });

  test('CONTRACT: the run reference is stored as strings, whatever the caller passed', () => {
    const m = built();
    assert.equal(m.certification.runId, '4242');
    assert.equal(m.certification.runAttempt, '1');
  });

  test('CONTRACT: client expectations are derived by ONE function the gate also calls', () => {
    const m = built();
    assert.deepEqual(m.compatibility.clientExpects, clientExpectationsFrom(m.compatibility.clientConstants));
    // The closure reader is gated on quote_protocol, so the two client constants
    // collapse to the larger of them on that one server key.
    assert.equal(m.compatibility.clientExpects.quote_protocol, 2);
  });
});
