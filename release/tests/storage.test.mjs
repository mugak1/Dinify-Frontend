/**
 * STORAGE COMPATIBILITY (R2) — the declaration, its tripwire, and the rule.
 *
 * What was wrong (reproduced on 3386724, see release/README.md "Baseline"): the
 * barrier compared two hand-maintained numbers lexicographically, and only on the
 * explicit rollback path. An ordinary automatic deploy of a DESCENDANT — a revert, say
 * — that dropped a reader the served build needed PROCEEDED, and certify.yml never
 * passed the semantics number at all, so stamp recorded a default.
 *
 * Now a reviewed declaration in source names the exact (version, semantics) pairs the
 * build writes and reads; stamp reads it from the commit it certifies and refuses when
 * its tripwire says the implementing files changed since it was affirmed; and the gate
 * requires set containment on every promoting path. The BEHAVIOURAL half — that a
 * record of every declared read pair really is recovered under the same key — is the
 * Karma spec src/app/_services/checkout-record-storage.contract.spec.ts, because only
 * a browser-side spec can drive the real coordinator.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { digestOf } from '../lib/canonical.mjs';
import { readIntConstant } from '../lib/source.mjs';
import {
  STORAGE_SCHEMA, declarationDigest, manifestStorage, staleReviewedSources, unreadableByCandidate,
  validateStorageDeclaration,
} from '../lib/storage.mjs';
import { decide } from '../lib/decide.mjs';
import { ROOT, buildCandidate, cli, commitAll, fixtureFrontend, git, writeText } from './harness.mjs';
import { DECLARATION, POLICY, baseline, clone, codes, manifestFor, servedKnown, storageProjection, withCandidateStorage } from './fixtures.mjs';

const pair = (version, semantics = 1) => ({ version, semantics });
const problemCodes = (r) => r.problems.map((p) => p.code);

describe('the committed declaration', () => {
  test('CONTROL: it validates', () => {
    const r = validateStorageDeclaration(DECLARATION);
    assert.equal(r.ok, true, JSON.stringify(r.problems));
    assert.equal(DECLARATION.schema, STORAGE_SCHEMA);
  });

  test('CONTRACT: it names the key and store the coordinator actually uses', () => {
    const coordinator = readFileSync(join(ROOT, 'src/app/_services/checkout-coordinator.service.ts'), 'utf8');
    assert.match(coordinator, new RegExp(`ATTEMPT_KEY\\s*=\\s*'${DECLARATION.key.replace(/\./g, '\\.')}'`));
    assert.match(coordinator, /SessionStorageService/);
    assert.equal(DECLARATION.store, 'sessionStorage');
  });

  test('CONTRACT: it writes the version the code writes', () => {
    const coordinator = readFileSync(join(ROOT, 'src/app/_services/checkout-coordinator.service.ts'), 'utf8');
    assert.equal(DECLARATION.writes.version, readIntConstant(coordinator, 'CHECKOUT_RECORD_VERSION'));
  });

  test('THE TRIPWIRE: every reviewed source still has the bytes it was affirmed against', () => {
    // This is the check that fails a pull request which changes the checkout record's
    // reader or writer without re-affirming the declaration. It is deliberately a
    // byte digest: a reviewer re-affirms after reading the change, and
    // `node release/cli.mjs storage-reviewed --write` records that they did.
    const actual = {};
    for (const path of Object.keys(DECLARATION.reviewedSources)) actual[path] = digestOf(readFileSync(join(ROOT, path)));
    assert.deepEqual(staleReviewedSources(DECLARATION, actual), [],
      'the checkout record code changed; re-read it against the declaration, then run '
      + '`node release/cli.mjs storage-reviewed --write`');
  });

  test('CONTROL: the storage-reviewed command agrees, and exits zero', async () => {
    const r = await cli(['storage-reviewed']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { stale: [] });
  });

  test('CONTRACT: the manifest projection carries the declaration digest, notes excluded', () => {
    const projection = manifestStorage(DECLARATION);
    assert.equal(projection.declarationDigest, declarationDigest(DECLARATION));
    assert.equal(declarationDigest(DECLARATION), declarationDigest({ ...DECLARATION, _note: ['a different note'] }));
    assert.notEqual(declarationDigest(DECLARATION), declarationDigest({ ...DECLARATION, reads: [pair(2)] }));
  });
});

describe('the tripwire through the real stamp', () => {
  test('REGRESSION (R2.e): stamp refuses a candidate whose storage declaration was not re-affirmed', async () => {
    const fixture = fixtureFrontend();
    writeText(fixture.dir, 'src/app/_services/checkout-coordinator.service.ts',
      `${readFileSync(join(ROOT, 'src/app/_services/checkout-coordinator.service.ts'), 'utf8')}\n// a reader change nobody re-affirmed\n`);
    const changed = commitAll(fixture.dir, 'change the reader');

    const stale = await cli(['storage-reviewed'], { root: fixture.dir });
    assert.equal(stale.status, 1);
    assert.deepEqual(JSON.parse(stale.stdout).stale, ['src/app/_services/checkout-coordinator.service.ts: changed']);

    await assert.rejects(
      buildCandidate({ repo: fixture.dir, commit: changed, runId: 4300, startedAt: '2026-09-22T11:30:00Z' }),
      /storage declaration not re-affirmed: src\/app\/_services\/checkout-coordinator\.service\.ts: changed/,
    );
  });

  test('CONTROL: re-affirming records the new bytes, and the same change then stamps', async () => {
    const fixture = fixtureFrontend();
    writeText(fixture.dir, 'src/app/_services/checkout-coordinator.service.ts',
      `${readFileSync(join(ROOT, 'src/app/_services/checkout-coordinator.service.ts'), 'utf8')}\n// a reviewed reader change\n`);
    const write = await cli(['storage-reviewed', '--write'], { root: fixture.dir });
    assert.equal(write.status, 0, write.stderr);
    const affirmed = commitAll(fixture.dir, 'change the reader and re-affirm');
    const candidate = await buildCandidate({ repo: fixture.dir, commit: affirmed, runId: 4301, startedAt: '2026-09-22T11:30:00Z' });
    assert.equal(candidate.manifest.compatibility.storage.key, DECLARATION.key);
  });

  test('CONTRACT: the declaration stamp reads is the one AT THE COMMIT, not a newer one elsewhere', async () => {
    const fixture = fixtureFrontend();
    const declared = JSON.parse(readFileSync(join(fixture.dir, POLICY.storage.declarationPath), 'utf8'));
    const candidate = await buildCandidate({ repo: fixture.dir, commit: fixture.commit, runId: 4302, startedAt: '2026-09-22T11:30:00Z' });
    assert.equal(candidate.manifest.compatibility.storage.declarationDigest, declarationDigest(declared));
    assert.equal(candidate.manifest.source.tree, git(fixture.dir, ['rev-parse', `${fixture.commit}^{tree}`]));
  });
});

describe('declaration shape', () => {
  const rejected = (mutate, code) => {
    const d = clone(DECLARATION);
    mutate(d);
    const r = validateStorageDeclaration(d);
    assert.equal(r.ok, false);
    assert.ok(problemCodes(r).includes(code), `expected ${code}, got ${JSON.stringify(problemCodes(r))}`);
  };
  test('CONTRACT: a wrong schema', () => rejected((d) => { d.schema = 'x/1'; }, 'storage.declaration_wrong_schema'));
  test('CONTRACT: no store', () => rejected((d) => { delete d.store; }, 'storage.declaration_no_store'));
  test('CONTRACT: no key', () => rejected((d) => { d.key = ''; }, 'storage.declaration_no_key'));
  test('CONTRACT: a zero version', () => rejected((d) => { d.writes = pair(0); }, 'storage.declaration_bad_writes'));
  test('CONTRACT: a non-integer semantics', () => rejected((d) => { d.reads = [{ version: 2, semantics: '1' }]; }, 'storage.declaration_bad_reads'));
  test('CONTRACT: no reads', () => rejected((d) => { d.reads = []; }, 'storage.declaration_bad_reads'));
  test('CONTRACT: a duplicated read pair', () => rejected((d) => { d.reads = [pair(2), pair(2)]; }, 'storage.declaration_duplicate_read'));
  test('CONTRACT: a build that cannot read what it writes', () => rejected((d) => { d.reads = [pair(1)]; }, 'storage.declaration_writes_unread'));
  test('CONTRACT: no reviewed sources', () => rejected((d) => { d.reviewedSources = {}; }, 'storage.declaration_no_reviewed_sources'));
  test('CONTRACT: a reviewed source that climbs out of the repository', () => rejected((d) => { d.reviewedSources = { '../x.ts': `sha256:${'0'.repeat(64)}` }; }, 'storage.declaration_bad_source_path'));
  test('CONTRACT: a reviewed source digest that is not sha256', () => rejected((d) => { d.reviewedSources = { 'a.ts': 'md5:0' }; }, 'storage.declaration_bad_source_digest'));
});

describe('the rule — set containment, never numeric', () => {
  const side = (writes, reads) => ({ writes, reads });

  test('CONTROL: a build that reads everything the served build writes and reads is compatible', () => {
    assert.deepEqual(unreadableByCandidate({ candidate: side(pair(2), [pair(1), pair(2)]), baseline: side(pair(2), [pair(1), pair(2)]) }), []);
  });

  test('CONTROL: moving forward — a candidate that ALSO reads a newer pair — is compatible', () => {
    assert.deepEqual(unreadableByCandidate({ candidate: side(pair(3), [pair(1), pair(2), pair(3)]), baseline: side(pair(2), [pair(1), pair(2)]) }), []);
  });

  test('CONTRACT: a candidate that cannot read what the served build WRITES is not', () => {
    assert.deepEqual(unreadableByCandidate({ candidate: side(pair(2), [pair(2)]), baseline: side(pair(3), [pair(2), pair(3)]) }), ['3.1']);
  });

  test('CONTRACT: a candidate that cannot read what the served build still READS is not — a diner may hold it', () => {
    assert.deepEqual(unreadableByCandidate({ candidate: side(pair(2), [pair(2)]), baseline: side(pair(2), [pair(1), pair(2)]) }), ['1.1']);
  });

  test('CONTRACT: a numerically LARGER version is not assumed to read an older record', () => {
    assert.deepEqual(unreadableByCandidate({ candidate: side(pair(9), [pair(9)]), baseline: side(pair(2), [pair(2)]) }), ['2.1']);
  });

  test('CONTRACT: the same version with different semantics is a different record', () => {
    assert.deepEqual(unreadableByCandidate({ candidate: side(pair(2, 2), [pair(2, 2)]), baseline: side(pair(2, 1), [pair(2, 1)]) }), ['2.1']);
  });
});

describe('every promoting path, through the decision (R2)', () => {
  const narrowed = storageProjection({ writes: pair(2), reads: [pair(2)] });
  const refusedFor = (mutate) => {
    const input = baseline();
    mutate(input);
    return codes(decide(input));
  };

  test('REGRESSION (R2.a): an automatic REVERT — a descendant commit — that drops a reader is refused', () => {
    assert.ok(refusedFor((i) => withCandidateStorage(i, narrowed)).includes('storage.incompatible'));
  });

  test('CONTRACT: a manual deploy that drops a reader is refused', () => {
    assert.ok(refusedFor((i) => { i.request.trigger = 'manual'; withCandidateStorage(i, narrowed); }).includes('storage.incompatible'));
  });

  test('CONTRACT: a rollback to a build that cannot read what is served is refused', () => {
    assert.ok(refusedFor((i) => {
      i.request = { mode: 'rollback', trigger: 'manual', target: i.request.target };
      i.served = servedKnown({ relation: 'ancestor' });
      withCandidateStorage(i, narrowed);
    }).includes('storage.incompatible'));
  });

  test('CONTRACT: a bootstrap against an incompatible named baseline is refused', () => {
    assert.ok(refusedFor((i) => {
      i.served = { state: 'absent' };
      i.policy.bootstrap = { authorized: true, servedBaseline: { commit: 'b'.repeat(40) } };
      i.baseline = { state: 'known', commit: 'b'.repeat(40), storage: storageProjection({ writes: pair(3), reads: [pair(2), pair(3)] }) };
    }).includes('storage.incompatible'));
  });

  test('CONTROL: a same-SHA re-certification is evaluated against what is served, and passes when the pairs agree', () => {
    const input = baseline();
    input.request.trigger = 'manual';
    input.served = servedKnown({ manifest: { ...manifestFor(), certification: { ...manifestFor().certification, runId: '4000' } }, relation: 'identical' });
    const r = decide(input);
    assert.equal(r.decision, 'PROCEED', JSON.stringify(codes(r)));
  });

  test('CONTROL: a same-semantics rollback is allowed', () => {
    const input = baseline();
    input.request = { mode: 'rollback', trigger: 'manual', target: input.request.target };
    input.served = servedKnown({ relation: 'ancestor' });
    assert.equal(decide(input).decision, 'PROCEED', JSON.stringify(codes(decide(input))));
  });

  test('CONTROL: forward evolution across a storage version is allowed', () => {
    const input = baseline();
    withCandidateStorage(input, storageProjection({ writes: pair(3), reads: [pair(1), pair(2), pair(3)] }));
    assert.equal(decide(input).decision, 'PROCEED', JSON.stringify(codes(decide(input))));
  });
});
