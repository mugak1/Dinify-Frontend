/**
 * PEERS THROUGH THE REAL ADAPTERS (R1).
 *
 * decide.test.mjs proves the peer RULES against receipts built in memory. This file
 * proves the ADAPTERS: a receipt produced by the real `peer-receipt` command from a
 * real, disposable backend git repository; a public peer's receipt re-derived through
 * the same `gh api` calls the gate makes (answered by a recorded API); a peer's served
 * identity read over real TLS from a local origin; and the decision taken by the real
 * `decide` command reading the files the gate would read.
 *
 * What was wrong (reproduced on 3386724, see release/README.md "Baseline"): the
 * compatible set was literals. Nothing produced them from a peer's source, nothing read
 * the backend commit, and nothing observed what either peer was serving.
 *
 * Nothing here reaches a real peer. The backend is a temporary git repository whose two
 * export files mirror the paired backend change; the "backend serving identity" used
 * for the positive cases is HYPOTHETICAL — the real backend publishes none until B3 —
 * and the committed policy's refusal for that is asserted below by name.
 */

import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { contractDigest } from '../lib/canonical.mjs';
import { receiptDigest } from '../lib/peers.mjs';
import { preflightReasons } from '../lib/preflight.mjs';
import {
  ROOT, cli, commitAll, fixtureFrontend, git, initRepo, installFakeGh, startOrigin, tempDir, writeDependencyInputs, writeText,
} from './harness.mjs';
import { POLICY, admittedRecordFor, baseline, clone, unchangedPreflightFacts } from './fixtures.mjs';

const D01 = JSON.parse(readFileSync(join(ROOT, 'src/app/_shared/order/checkout-limits.contract.json'), 'utf8'));
const CEILINGS = Object.fromEntries(Object.entries(D01).filter(([k]) => !k.startsWith('_')));
const CAPABILITIES = { checkout_protocol: 3, quote_protocol: 2, kitchen_protocol: 1, quote_policy_version: 1 };
const LIMITS_PATH = 'orders_app/contracts/checkout_limits.contract.json';
const CAPS_PATH = 'orders_app/contracts/published_capabilities.contract.json';
const DEPLOY_PATH = '.github/workflows/deploy.yml';

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

const world = {};

before(async () => {
  // THE BACKEND, as three revisions of its own git history:
  //   B0  the ceiling export only — predates the capability export
  //   B1  both exports (the paired backend change's shape)
  //   B2  a ceiling moved on the backend side only
  const backend = initRepo(tempDir('backend'));
  writeText(backend, LIMITS_PATH, json({ _note: ['backend-side provenance note, deliberately different'], ...CEILINGS }));
  world.B0 = commitAll(backend, 'B0: ceiling export');
  writeText(backend, CAPS_PATH, json({ _note: ['published capability levels'], ...CAPABILITIES }));
  world.B1 = commitAll(backend, 'B1: capability export');
  writeText(backend, LIMITS_PATH, json({ ...CEILINGS, MAX_LINES_PER_ORDER: 120 }));
  world.B2 = commitAll(backend, 'B2: a ceiling moved');
  world.backend = backend;

  const admin = initRepo(tempDir('admin'));
  writeText(admin, DEPLOY_PATH, 'name: Deploy\n');
  world.A1 = commitAll(admin, 'A1');
  writeText(admin, DEPLOY_PATH, 'name: Deploy\n# changed\n');
  world.A2 = commitAll(admin, 'A2');
  world.admin = admin;

  world.receipt = async (peer, commit, repository) => {
    const r = await cli(['peer-receipt', '--peer', peer, '--repo-dir', peer === 'backend' ? backend : admin,
      '--commit', commit, '--repository', repository ?? (peer === 'backend' ? 'mugak1/Dinify-Backend' : 'mugak1/Dinify-Admin')]);
    assert.equal(r.status, 0, r.stderr);
    return { text: r.stdout, receipt: JSON.parse(r.stdout) };
  };

  world.backendOrigin = await startOrigin();
  world.adminOrigin = await startOrigin();
  world.gh = installFakeGh();
});

after(async () => {
  await world.backendOrigin.close();
  await world.adminOrigin.close();
});

/** Serve a peer's identity the way Admin serves release.txt. */
function serveCommit(origin, commit, { noStore = true, status = 200, body } = {}) {
  origin.route('/release.txt', {
    status,
    headers: noStore ? { 'cache-control': 'no-store', 'content-type': 'text/plain' } : { 'content-type': 'text/plain' },
    body: body ?? `${commit}\n`,
  });
}

/** Recorded answers for re-deriving an Admin receipt from Admin's public repository. */
function adminApi(commit, { tree, blob } = {}) {
  return {
    [`repos/mugak1/Dinify-Admin/git/commits/${commit}`]: { json: { sha: commit, tree: { sha: tree ?? git(world.admin, ['rev-parse', `${commit}^{tree}`]) } } },
    [`repos/mugak1/Dinify-Admin/contents/${DEPLOY_PATH}?ref=${commit}`]: { json: { type: 'file', sha: blob ?? git(world.admin, ['rev-parse', `${commit}:${DEPLOY_PATH}`]) } },
  };
}

/**
 * A fixture trusted clone whose policy approves the given receipts, then the gate's
 * two peer steps — `peer-facts`, then `decide` — run from it. Everything that is not
 * the peer half comes from the pure suite's allowed baseline.
 */
async function gatePeerHalf({
  backend, admin, backendApproved = backend, adminApproved = admin, files = {}, serving = 'public-identity',
  mutatePolicy, extraReceipts = {},
}) {
  const policy = clone(POLICY);
  policy.prerequisites.sourceProtection.status = 'recorded';
  policy.prerequisites.retention.status = 'verified';
  policy.prerequisites.singlePublisher.status = 'single-publisher';
  const approve = (peer, entry) => ({
    commit: entry.receipt.commit, receipt: `release/peers/${peer}-${entry.receipt.commit}.json`, receiptDigest: receiptDigest(entry.receipt),
  });
  policy.compatibleSet.peers.backend.approved = [approve('backend', backendApproved)];
  policy.compatibleSet.peers.admin.approved = [approve('admin', adminApproved)];
  policy.compatibleSet.peers.backend.serving = serving === 'public-identity'
    ? { observation: 'public-identity', origin: world.backendOrigin.origin, path: '/release.txt' }
    : clone(POLICY.compatibleSet.peers.backend.serving);
  policy.compatibleSet.peers.admin.serving = { observation: 'public-identity', origin: world.adminOrigin.origin, path: '/release.txt' };
  if (mutatePolicy) mutatePolicy(policy);

  // `null` in `files` means "this receipt is not there at all".
  const receiptFiles = Object.fromEntries(Object.entries({
    [`release/peers/backend-${backend.receipt.commit}.json`]: backend.text,
    [`release/peers/admin-${admin.receipt.commit}.json`]: admin.text,
    ...extraReceipts,
    ...files,
  }).filter(([, text]) => text !== null));
  const trusted = fixtureFrontend({ policy, files: receiptFiles });

  const facts = await cli(['peer-facts', '--timeout', '5000'], { root: trusted.dir, env: world.gh.env() });

  const dir = tempDir('decide');
  const input = baseline();
  const write = (name, value) => { const p = join(dir, name); writeFileSync(p, json(value)); return p; };
  const args = [
    'decide',
    '--request', write('request.json', input.request),
    '--certification', write('certification.json', input.certification),
    '--observation', write('observation.json', input.artifact),
    '--facts', write('facts.json', {
      policy: { revision: 'f'.repeat(40), digest: `sha256:${'0'.repeat(64)}`, verifierTree: { release: 'e'.repeat(40), dependencyAudit: 'd'.repeat(40) } },
      source: input.source, hosting: input.hosting, baseline: input.baseline, eligibility: input.eligibility, trusted: input.trusted,
    }),
    '--served', write('served.json', input.served),
    '--peers', facts.status === 0 ? write('peers.json', JSON.parse(facts.stdout)) : write('peers.json', {}),
    ...writeDependencyInputs(dir, input),
    '--now', input.now,
  ];
  const decision = await cli(args, { root: trusted.dir });
  return {
    facts, peers: facts.status === 0 ? JSON.parse(facts.stdout) : null,
    status: decision.status, decision: JSON.parse(decision.stdout || '{}'), stderr: decision.stderr,
  };
}

const codesOf = (d) => (d.reasons ?? []).map((r) => r.code);

describe('the producer reads the peer\'s own git at exactly one revision', () => {
  test('CONTRACT: a receipt binds the tree and the export blobs of that revision', async () => {
    const { receipt } = await world.receipt('backend', world.B1);
    assert.equal(receipt.commit, world.B1);
    assert.equal(receipt.tree, git(world.backend, ['rev-parse', `${world.B1}^{tree}`]));
    assert.deepEqual(
      receipt.sources.map((s) => [s.path, s.blob]),
      [[LIMITS_PATH, git(world.backend, ['rev-parse', `${world.B1}:${LIMITS_PATH}`])],
        [CAPS_PATH, git(world.backend, ['rev-parse', `${world.B1}:${CAPS_PATH}`])]],
    );
  });

  test('CONTRACT: the D01 digest is the backend EXPORT\'s, and a provenance note does not move it', async () => {
    const { receipt } = await world.receipt('backend', world.B1);
    assert.equal(receipt.contracts.d01CheckoutLimits.digest, contractDigest(D01));
  });

  test('CONTRACT: capability levels are READ from the export, not typed into the policy', async () => {
    const { receipt } = await world.receipt('backend', world.B1);
    assert.deepEqual(receipt.publishes, CAPABILITIES);
    assert.deepEqual(receipt.unavailable, []);
  });

  test('CONTRACT: a revision that predates the capability export says so rather than guessing', async () => {
    const { receipt } = await world.receipt('backend', world.B0);
    assert.equal(receipt.publishes, null);
    assert.deepEqual(receipt.unavailable, ['publishedCapabilities']);
  });

  test('CONTRACT: the producer is deterministic — a reviewer re-derives the same bytes', async () => {
    const first = await world.receipt('backend', world.B1);
    const second = await world.receipt('backend', world.B1);
    assert.equal(first.text, second.text);
  });

  test('REGRESSION (R1.a): a missing backend SHA is refused by the producer', async () => {
    const r = await cli(['peer-receipt', '--peer', 'backend', '--repo-dir', world.backend, '--repository', 'mugak1/Dinify-Backend']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /full 40-character lowercase SHA/);
  });

  test('CONTRACT: an abbreviated SHA is refused by the producer', async () => {
    const r = await cli(['peer-receipt', '--peer', 'backend', '--repo-dir', world.backend, '--repository', 'mugak1/Dinify-Backend', '--commit', world.B1.slice(0, 7)]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /full 40-character lowercase SHA/);
  });

  test('CONTRACT: a revision the clone does not hold is refused, not approximated', async () => {
    const r = await cli(['peer-receipt', '--peer', 'backend', '--repo-dir', world.backend, '--repository', 'mugak1/Dinify-Backend', '--commit', '0'.repeat(40)]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /does not hold commit/);
  });
});

describe('the gate\'s peer half, through peer-facts and decide', () => {
  test('CONTROL: approved, verified and observed peers are allowed', async () => {
    const backend = await world.receipt('backend', world.B1);
    const admin = await world.receipt('admin', world.A1);
    serveCommit(world.backendOrigin, world.B1);
    serveCommit(world.adminOrigin, world.A1);
    world.gh.set(adminApi(world.A1));
    const r = await gatePeerHalf({ backend, admin });
    assert.equal(r.facts.status, 0, r.facts.stderr);
    assert.equal(r.peers.verification.admin[world.A1].state, 'verified');
    assert.equal(r.decision.decision, 'PROCEED', JSON.stringify(codesOf(r.decision)));
    assert.equal(r.status, 0);
  });

  test('CONTROL: an unchanged backend stays allowed while newer backend revisions merely exist', async () => {
    const backend = await world.receipt('backend', world.B1);
    const admin = await world.receipt('admin', world.A1);
    serveCommit(world.backendOrigin, world.B1);
    serveCommit(world.adminOrigin, world.A1);
    world.gh.set(adminApi(world.A1));
    assert.notEqual(git(world.backend, ['rev-parse', 'HEAD']), world.B1, 'the backend repository has moved on');
    const r = await gatePeerHalf({ backend, admin });
    assert.equal(r.decision.decision, 'PROCEED', JSON.stringify(codesOf(r.decision)));
  });

  test('CONTRACT: a NEW backend revision serving needs approved-set evidence — a receipt on disk is not an approval', async () => {
    const backend = await world.receipt('backend', world.B1);
    const moved = await world.receipt('backend', world.B2);
    const admin = await world.receipt('admin', world.A1);
    serveCommit(world.backendOrigin, world.B2);
    serveCommit(world.adminOrigin, world.A1);
    world.gh.set(adminApi(world.A1));
    const r = await gatePeerHalf({ backend, admin, extraReceipts: { [`release/peers/backend-${world.B2}.json`]: moved.text } });
    assert.equal(r.decision.decision, 'REFUSE');
    assert.ok(codesOf(r.decision).includes('peers.backend_serving_unapproved'), JSON.stringify(codesOf(r.decision)));
  });

  test('CONTRACT: approving a backend revision whose ceilings moved is refused by the contract', async () => {
    const moved = await world.receipt('backend', world.B2);
    const admin = await world.receipt('admin', world.A1);
    serveCommit(world.backendOrigin, world.B2);
    serveCommit(world.adminOrigin, world.A1);
    world.gh.set(adminApi(world.A1));
    const r = await gatePeerHalf({ backend: moved, admin });
    assert.ok(codesOf(r.decision).includes('peers.contract_mismatch'), JSON.stringify(codesOf(r.decision)));
  });

  test('CONTRACT: approving a backend revision that predates the capability export is refused by name', async () => {
    const early = await world.receipt('backend', world.B0);
    const admin = await world.receipt('admin', world.A1);
    serveCommit(world.backendOrigin, world.B0);
    serveCommit(world.adminOrigin, world.A1);
    world.gh.set(adminApi(world.A1));
    const r = await gatePeerHalf({ backend: early, admin });
    assert.ok(codesOf(r.decision).includes('peers.capabilities_unpublished'), JSON.stringify(codesOf(r.decision)));
  });

  describe('receipts', () => {
    const setup = async () => {
      const backend = await world.receipt('backend', world.B1);
      const admin = await world.receipt('admin', world.A1);
      serveCommit(world.backendOrigin, world.B1);
      serveCommit(world.adminOrigin, world.A1);
      world.gh.set(adminApi(world.A1));
      return { backend, admin };
    };

    test('CONTRACT: an approved receipt that is missing is refused', async () => {
      const { backend, admin } = await setup();
      const r = await gatePeerHalf({ backend, admin, files: { [`release/peers/backend-${world.B1}.json`]: null } });
      assert.ok(codesOf(r.decision).includes('peers.receipt_missing'), JSON.stringify(codesOf(r.decision)));
    });

    test('CONTRACT: an approved receipt that cannot be parsed is refused', async () => {
      const { backend, admin } = await setup();
      const r = await gatePeerHalf({ backend, admin, files: { [`release/peers/backend-${world.B1}.json`]: 'not json' } });
      assert.ok(codesOf(r.decision).includes('peers.receipt_unreadable'), JSON.stringify(codesOf(r.decision)));
    });

    test('REGRESSION (R1.d): a receipt for a FOREIGN repository is refused, even when approved by digest', async () => {
      const { admin } = await setup();
      const foreign = await world.receipt('backend', world.B1, 'someone-else/Dinify-Backend');
      const r = await gatePeerHalf({ backend: foreign, admin });
      assert.ok(codesOf(r.decision).includes('peers.receipt_foreign'), JSON.stringify(codesOf(r.decision)));
    });

    test('CONTRACT: a receipt for a different revision is refused, even when approved by digest', async () => {
      const { admin } = await setup();
      const early = await world.receipt('backend', world.B0);
      // B0's receipt, filed and approved under B1's name.
      const r = await gatePeerHalf({
        backend: { text: early.text, receipt: { ...early.receipt, commit: world.B1 } },
        admin,
        files: { [`release/peers/backend-${world.B1}.json`]: early.text },
        mutatePolicy: (p) => { p.compatibleSet.peers.backend.approved[0].receiptDigest = receiptDigest(early.receipt); },
      });
      assert.ok(codesOf(r.decision).includes('peers.receipt_wrong_revision'), JSON.stringify(codesOf(r.decision)));
    });

    test('CONTRACT: a receipt edited after approval is refused', async () => {
      const { backend, admin } = await setup();
      const edited = clone(backend.receipt);
      edited.publishes.quote_protocol = 9;
      const r = await gatePeerHalf({ backend, admin, files: { [`release/peers/backend-${world.B1}.json`]: json(edited) } });
      assert.ok(codesOf(r.decision).includes('peers.receipt_mismatch'), JSON.stringify(codesOf(r.decision)));
    });

    test('CONTRACT: a public peer\'s receipt that does not re-derive from its repository is refused', async () => {
      const { backend, admin } = await setup();
      world.gh.set(adminApi(world.A1, { tree: 'f'.repeat(40) }));
      const r = await gatePeerHalf({ backend, admin });
      assert.equal(r.peers.verification.admin[world.A1].state, 'mismatch');
      assert.ok(codesOf(r.decision).includes('peers.admin_receipt_unverified'), JSON.stringify(codesOf(r.decision)));
    });

    test('CONTRACT: a public peer\'s receipt that could not be checked is refused, not assumed', async () => {
      const { backend, admin } = await setup();
      world.gh.set({ [`repos/mugak1/Dinify-Admin/git/commits/${world.A1}`]: { status: 502 } });
      const r = await gatePeerHalf({ backend, admin });
      assert.equal(r.peers.verification.admin[world.A1].state, 'unavailable');
      assert.ok(codesOf(r.decision).includes('peers.admin_receipt_unverified'), JSON.stringify(codesOf(r.decision)));
    });

    test('CONTRACT: the recorded API was asked about exactly the approved revision, with a token', async () => {
      const { backend, admin } = await setup();
      const before = world.gh.calls().length;
      await gatePeerHalf({ backend, admin });
      const calls = world.gh.calls().slice(before).map((c) => c.args[c.args.length - 1]);
      assert.deepEqual(calls.sort(), Object.keys(adminApi(world.A1)).sort());
    });
  });

  describe('the policy\'s pins', () => {
    test('REGRESSION (R1.a): a policy whose approved backend has no commit is refused — by the adapter and by the decision', async () => {
      const backend = await world.receipt('backend', world.B1);
      const admin = await world.receipt('admin', world.A1);
      const r = await gatePeerHalf({ backend, admin, mutatePolicy: (p) => { delete p.compatibleSet.peers.backend.approved[0].commit; } });
      assert.notEqual(r.facts.status, 0, 'peer-facts refuses to read an invalid policy');
      assert.match(r.facts.stderr, /trusted policy is invalid/);
      assert.deepEqual(codesOf(r.decision), ['policy.invalid']);
      assert.match(r.decision.reasons[0].detail, /policy\.backend_commit_invalid/);
    });

    test('REGRESSION (R1.b): a malformed Admin SHA is refused', async () => {
      const backend = await world.receipt('backend', world.B1);
      const admin = await world.receipt('admin', world.A1);
      const r = await gatePeerHalf({ backend, admin, mutatePolicy: (p) => { p.compatibleSet.peers.admin.approved[0].commit = 'not-a-sha'; } });
      assert.deepEqual(codesOf(r.decision), ['policy.invalid']);
      assert.match(r.decision.reasons[0].detail, /policy\.admin_commit_invalid/);
    });
  });

  describe('serving evidence, kept apart from selection', () => {
    const setup = async () => ({
      backend: await world.receipt('backend', world.B1),
      admin: await world.receipt('admin', world.A1),
    });

    test('REGRESSION (R1.e): the committed backend serving observation is refused by name, and nothing is fetched for it', async () => {
      const { backend, admin } = await setup();
      serveCommit(world.adminOrigin, world.A1);
      world.gh.set(adminApi(world.A1));
      const before = world.backendOrigin.requests.length;
      const r = await gatePeerHalf({ backend, admin, serving: 'committed' });
      assert.ok(codesOf(r.decision).includes('peers.backend_serving_unverified'), JSON.stringify(codesOf(r.decision)));
      assert.equal(r.peers.serving.backend, undefined);
      assert.equal(world.backendOrigin.requests.length, before, 'no backend identity was requested');
    });

    test('CONTRACT: a served peer outside the approved set is refused', async () => {
      const { backend, admin } = await setup();
      serveCommit(world.backendOrigin, world.B1);
      serveCommit(world.adminOrigin, world.A2);
      world.gh.set(adminApi(world.A1));
      const r = await gatePeerHalf({ backend, admin });
      assert.ok(codesOf(r.decision).includes('peers.admin_serving_unapproved'), JSON.stringify(codesOf(r.decision)));
    });

    test('CONTRACT: a cacheable peer identity is not an observation', async () => {
      const { backend, admin } = await setup();
      serveCommit(world.backendOrigin, world.B1);
      serveCommit(world.adminOrigin, world.A1, { noStore: false });
      world.gh.set(adminApi(world.A1));
      const r = await gatePeerHalf({ backend, admin });
      assert.ok(codesOf(r.decision).includes('peers.admin_serving_cacheable'), JSON.stringify(codesOf(r.decision)));
    });

    test('CONTRACT: an absent peer identity is unreadable, never "nothing served"', async () => {
      const { backend, admin } = await setup();
      serveCommit(world.backendOrigin, world.B1);
      serveCommit(world.adminOrigin, world.A1, { status: 404, body: 'not found' });
      world.gh.set(adminApi(world.A1));
      const r = await gatePeerHalf({ backend, admin });
      assert.ok(codesOf(r.decision).includes('peers.admin_serving_unreadable'), JSON.stringify(codesOf(r.decision)));
    });

    test('CONTRACT: a peer identity that is not exactly one full SHA is unreadable', async () => {
      const { backend, admin } = await setup();
      serveCommit(world.backendOrigin, world.B1);
      serveCommit(world.adminOrigin, world.A1, { body: `${world.A1.slice(0, 12)}\n` });
      world.gh.set(adminApi(world.A1));
      const r = await gatePeerHalf({ backend, admin });
      assert.ok(codesOf(r.decision).includes('peers.admin_serving_unreadable'), JSON.stringify(codesOf(r.decision)));
    });
  });
});

describe('the recheck at the promotion boundary', () => {
  // The adapter-level version is the workflow simulation's peer scenario; this pins
  // the rule itself: what the gate saw Admin serving is part of the admitted record,
  // and the publisher refuses if it has changed by the time it would publish.
  const input = baseline();
  const record = () => {
    const r = admittedRecordFor(input);
    r.peers.adminServed = world.A1;
    return r;
  };
  const facts = (adminCommit) => {
    const f = unchangedPreflightFacts(record(), input);
    f.adminServed = { state: 'known', commit: adminCommit };
    return f;
  };

  test('CONTROL: unchanged peers pass the recheck', () => {
    assert.deepEqual(preflightReasons({ record: record(), policy: POLICY, facts: facts(world.A1), now: '2026-09-22T12:05:00Z' }), []);
  });

  test('CONTRACT: Admin serving a different revision by promotion time is refused', () => {
    const reasons = preflightReasons({ record: record(), policy: POLICY, facts: facts(world.A2), now: '2026-09-22T12:05:00Z' });
    assert.deepEqual(reasons.map((r) => r.code), ['preflight.peer_changed']);
  });
});
