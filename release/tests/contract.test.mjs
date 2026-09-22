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
 * What closes it is a DIGEST OVER THE VALUES in a canonical form both languages
 * produce byte for byte, recorded in the release manifest and compared against the
 * pinned peer in the compatible set. A ceiling changed on one side and not the other
 * cannot then be released, whichever side moved.
 *
 * These tests assert the three links in that chain that live in this repository. The
 * fourth — that the backend's own committed copy matches its live constants
 * unconditionally — is asserted on the backend side, by the paired change.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test, describe } from 'node:test';

import { canonicalJson, contractDigest } from '../lib/canonical.mjs';
import { readIntConstant } from '../lib/source.mjs';

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

describe('link 3 — the pinned peer in the compatible set agrees with this copy', () => {
  test('the committed policy pins the digest of the contract this repository compiles', () => {
    const pinned = policy.compatibleSet.peers.backend.contracts.d01CheckoutLimits;
    assert.equal(
      pinned, contractDigest(contract),
      'release/policy.json pins a D01 digest that is not the one this repository would ship. '
      + 'Either the backend peer moved and this copy was not synchronized, or this copy '
      + 'moved and the peer was not re-pinned. Both are release-blocking by design.',
    );
  });

  test('THE NEGATIVE CASE: a ceiling changed on one side only does not release', async () => {
    // The scenario the Stage B approval names: the backend raises a ceiling and
    // updates its own fixture, this repository's copy stays as it was, and the release
    // must refuse. Here the backend's move is represented by the pinned digest moving.
    const { decide } = await import('../lib/decide.mjs');
    const { baseline, codes } = await import('./fixtures.mjs');
    const input = baseline();
    const drifted = { ...Object.fromEntries(ceilingNames.map((k) => [k, contract[k]])), MAX_LINES_PER_ORDER: 120 };
    input.policy.compatibleSet.peers.backend.contracts.d01CheckoutLimits = contractDigest(drifted);
    const result = decide(input);
    assert.equal(result.decision, 'REFUSE');
    assert.ok(codes(result).includes('peers.contract_mismatch'), JSON.stringify(codes(result)));
  });
});
