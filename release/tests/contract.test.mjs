/**
 * THE D01 CEILING CONTRACT — one authority, two compiled copies, one digest.
 *
 * The request ceilings are the BACKEND's. This repository holds a synchronized copy
 * so the basket can refuse an over-ceiling order before the round trip, and the two
 * copies must not be able to drift apart unnoticed.
 *
 * Before this, each side asserted its own constants against its own file, and the
 * cross-repository assertion on the backend side `skipTest`s whenever Dinify-Frontend
 * is not checked out beside it — which, in CI, is always. Two independently checked
 * copies are not parity: they are two things that each agree with themselves.
 *
 * What closes it ON THIS PATH is a DIGEST OVER THE VALUES in a canonical form both
 * languages produce byte for byte. The frontend records its copy's digest in every
 * release manifest; the backend's copy is read from the backend's OWN git at an
 * approved revision into a peer receipt (release/peers/), and the gate compares the
 * two. That makes a one-sided change REFUSABLE ON THE FRONTEND'S PUBLICATION PATH.
 *
 * WHAT IT DOES NOT DO, stated because the earlier wording claimed it: it does not stop
 * the BACKEND releasing a changed ceiling. The backend's deploy consults nothing here,
 * so cross-repository changes remain an ORDERED, MANUAL sequence — backend first, then
 * a reviewed frontend change that approves a receipt for the new backend revision.
 *
 * These tests assert the links in that chain that live in this repository. The
 * fourth — that the backend's own committed copy matches its live constants
 * unconditionally — is asserted on the backend side.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test, describe } from 'node:test';

import { canonicalJson, contractDigest } from '../lib/canonical.mjs';
import { readIntConstant } from '../lib/source.mjs';
import { receiptDigest } from '../lib/peers.mjs';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const CONTRACT_PATH = 'src/app/_shared/order/checkout-limits.contract.json';
const LIMITS_PATH = 'src/app/_shared/order/checkout-limits.ts';

const contract = JSON.parse(readFileSync(`${ROOT}/${CONTRACT_PATH}`, 'utf8'));
const limitsSource = readFileSync(`${ROOT}/${LIMITS_PATH}`, 'utf8');
const policy = JSON.parse(readFileSync(`${ROOT}/release/policy.json`, 'utf8'));

const ceilingNames = Object.keys(contract).filter((k) => !k.startsWith('_'));

describe('link 1 — the compiled constants are the contract file', () => {
  test('every published ceiling is compiled with the value the contract states', () => {
    assert.ok(ceilingNames.length >= 7, `expected the full ceiling set, found ${ceilingNames.length}`);
    for (const name of ceilingNames) {
      assert.equal(
        readIntConstant(limitsSource, name), contract[name],
        `${name}: ${LIMITS_PATH} disagrees with ${CONTRACT_PATH}`,
      );
    }
  });

  test('the extractor used at stamp time really reads this file — a negative control', () => {
    // If `readIntConstant` silently stopped matching, the test above would pass
    // vacuously only if it also threw; it throws, so this asserts the other half:
    // a name that is NOT in the file must be refused rather than defaulted.
    assert.throws(() => readIntConstant(limitsSource, 'MAX_NOT_A_REAL_CEILING'), /found 0/);
  });
});

describe('link 2 — the digest is reproducible across languages', () => {
  test('the canonical form is exactly what Python json.dumps(sort_keys, separators) emits', () => {
    const values = Object.fromEntries(ceilingNames.sort().map((k) => [k, contract[k]]));
    assert.equal(
      canonicalJson(values),
      '{"MAX_CHOICES_PER_GROUP":64,"MAX_EXTRAS_PER_LINE":64,"MAX_LINES_PER_ORDER":100,'
      + '"MAX_MODIFIER_GROUPS_PER_LINE":32,"MAX_QUANTITY_PER_LINE":99,'
      + '"MAX_SELECTION_ENTRIES_PER_REQUEST":2048,"MAX_TOTAL_UNITS":500}',
      'the canonical form is the cross-language contract; changing it changes every digest',
    );
  });

  test('provenance notes do not enter the digest, and values do', () => {
    const bare = Object.fromEntries(ceilingNames.map((k) => [k, contract[k]]));
    assert.equal(contractDigest(contract), contractDigest(bare));
    assert.notEqual(contractDigest(contract), contractDigest({ ...bare, MAX_TOTAL_UNITS: 501 }));
  });
});

describe('link 3 — the approved backend receipt agrees with this copy', () => {
  const approved = policy.compatibleSet.peers.backend.approved;

  test('every approved backend receipt carries the digest of the contract this repository compiles', () => {
    assert.ok(approved.length >= 1, 'the compatible set approves no backend revision');
    for (const entry of approved) {
      const receipt = JSON.parse(readFileSync(`${ROOT}/${entry.receipt}`, 'utf8'));
      assert.equal(receipt.commit, entry.commit, `${entry.receipt} is about ${receipt.commit}, not ${entry.commit}`);
      assert.equal(receiptDigest(receipt), entry.receiptDigest, `${entry.receipt} is not the receipt the policy approved`);
      assert.equal(
        receipt.contracts.d01CheckoutLimits?.digest, contractDigest(contract),
        `backend ${entry.commit} publishes a D01 contract this repository does not compile. `
        + 'Either the backend moved and this copy was not synchronized, or this copy moved '
        + 'and a receipt for a matching backend revision was not approved.',
      );
    }
  });

  test('the receipt\'s values are the backend\'s export, not a restatement of ours', () => {
    // The receipt carries the VALUES it read, so the digest is re-derivable from the
    // receipt alone — a reviewer does not have to trust the digest field.
    for (const entry of approved) {
      const receipt = JSON.parse(readFileSync(`${ROOT}/${entry.receipt}`, 'utf8'));
      assert.equal(contractDigest(receipt.contracts.d01CheckoutLimits.values), receipt.contracts.d01CheckoutLimits.digest);
    }
  });

  test('REGRESSION (R1.f): a backend whose export moved is refused — the literal is gone', async () => {
    // On 3386724 this comparison read a digest TYPED INTO the policy, so it could fail
    // only when someone edited that literal. Now the backend side is a receipt produced
    // by the real producer from the backend's files at a revision.
    const { decide } = await import('../lib/decide.mjs');
    const { baseline, codes, backendReceipt, allowedPolicy, peersFor } = await import('./fixtures.mjs');
    const drifted = { ...Object.fromEntries(ceilingNames.map((k) => [k, contract[k]])), MAX_LINES_PER_ORDER: 120 };
    const backend = backendReceipt({ d01: drifted });
    const input = baseline();
    input.policy = allowedPolicy({ backend });
    input.peers = peersFor({ backend });
    const result = decide(input);
    assert.equal(result.decision, 'REFUSE');
    assert.ok(codes(result).includes('peers.contract_mismatch'), JSON.stringify(codes(result)));
  });

  test('CONTRACT: a frontend whose copy moved is refused against an unchanged backend', async () => {
    const { decide } = await import('../lib/decide.mjs');
    const { baseline, codes } = await import('./fixtures.mjs');
    const { digestOfValue } = await import('../lib/canonical.mjs');
    const drifted = { ...Object.fromEntries(ceilingNames.map((k) => [k, contract[k]])), MAX_TOTAL_UNITS: 501 };
    const input = baseline();
    input.artifact.manifest.compatibility.contracts.d01CheckoutLimits = contractDigest(drifted);
    input.artifact.manifestDigest = digestOfValue(input.artifact.manifest);
    input.source.d01Digest = contractDigest(drifted);
    const result = decide(input);
    assert.equal(result.decision, 'REFUSE');
    assert.ok(codes(result).includes('peers.contract_mismatch'), JSON.stringify(codes(result)));
  });

  test('CONTROL: matching copies on both sides are not refused on this ground', async () => {
    const { decide } = await import('../lib/decide.mjs');
    const { baseline, codes } = await import('./fixtures.mjs');
    const result = decide(baseline());
    assert.ok(!codes(result).includes('peers.contract_mismatch'), JSON.stringify(codes(result)));
    assert.equal(result.decision, 'PROCEED');
  });
});
