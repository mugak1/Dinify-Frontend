/**
 * D06 completion, G3b — A CLOSED QUOTE PRODUCES ONE NEW ATTEMPT, WITH A NEW KEY.
 *
 * THE DEAD END THIS CLOSES. A terminal refusal means the server has RECORDED
 * that this quote may never be accepted, and the client's answer was to re-price
 * over the unchanged basket — correct — while KEEPING the idempotency key. That
 * key is bound to the order the closure was written against, so `initiate`
 * replays it: the same closed draft comes back, the review sheet renders a quote
 * that can never be paid, submitting it is refused again, and the diner loops
 * with no way out of the app.
 *
 * Keeping the key is RIGHT for a `quote_ref_stale` reprice — the order is still
 * acceptable and only the reference moved — and WRONG for a closure, and the two
 * arrive through the same branch. That is the distinction under test.
 *
 * WHAT A RENEWAL IS ALLOWED TO BE. Exactly ONE new persisted attempt, carrying
 * the SAME purchase (the basket has not changed) under a NEW key, linked to the
 * record it replaces. It never reprices the old order, never deletes or
 * contradicts the closure — the client cannot write one and must not pretend to
 * — and never lets one key name two orders, which is the whole reason the key
 * exists.
 *
 * AND IT IS REFUSED WHILE AN ACCEPTANCE IS OUTSTANDING. A renewal abandons the
 * current key; doing that with a command whose outcome is unknown is how a
 * diner ends up with two orders, which is the exact failure the not-found rule
 * exists to prevent.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { WINDOW } from './storage/window.token';
import { STORAGE_KEY_PREFIX } from './storage/storage-key-prefix.token';
import {
  CheckoutCoordinatorService,
  PURCHASE_CANON,
} from './checkout-coordinator.service';

describe('CheckoutCoordinatorService — renewal after a closure (D06/G3b)', () => {
  let coordinator: CheckoutCoordinatorService;

  const SCOPE = 'r1:tA';
  const request = () => ({
    identity: 'burger x1',
    canon: PURCHASE_CANON,
    items: [{ item: 'i1', quantity: 1 }],
  });

  const reserve = () => {
    const reservation = coordinator.reserveIntent(request(), SCOPE);
    expect(reservation.kind).toBe('ready');
    return reservation as Extract<
      ReturnType<CheckoutCoordinatorService['reserveIntent']>,
      { kind: 'ready' }>;
  };

  beforeEach(() => {
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
        CheckoutCoordinatorService,
      ],
    });
    coordinator = TestBed.inject(CheckoutCoordinatorService);
  });

  afterEach(() => {
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
  });

  /**
   * C2/O1 — THE EVIDENCE THE PRIMITIVE REQUIRES, AND WHERE IT COMES FROM.
   *
   * CHANGED EXPECTATION. C2 made `renewAfterClosure` take the caller's
   * validated closure, which made the requirement a property of the
   * primitive. O1 goes one step further: it reads the PERSISTED closure
   * instead, because a closure passed in is a closure the CALLER is holding
   * — and a mount holding a stale refusal for K1 could hand it over and
   * renew a K2 another mount had already established. Every case below
   * therefore establishes the closure through `noteClosure` first, which is
   * what the production paths now do.
   */
  const CLOSURE = {
    closedAt: '2026-09-18T10:00:00Z',
    reason: 'quote_expired',
    quoteRef: 'ref-1',
    policyVersion: 1,
  };

  describe('the dead end', () => {
    it('THE REGRESSION: settling a refused command hands the SAME key back', () => {
      const first = reserve();
      coordinator.noteCommand({ orderId: 'o1', quoteRef: 'ref-1' });
      expect(coordinator.settleRefusedCommand()).toBeTrue();

      // This is correct for a `quote_ref_stale` reprice and fatal for a
      // closure: the key names the order the closure was written against, so
      // the next initiate replays a draft that can never be accepted.
      const again = reserve();
      expect(again.key).toBe(first.key);
    });

    it('and a renewal is what breaks it — a NEW key for the SAME purchase', () => {
      const first = reserve();
      coordinator.noteCommand({ orderId: 'o1', quoteRef: 'ref-1' });
      expect(coordinator.noteClosure(CLOSURE)).toBeTrue();

      const renewed = coordinator.renewAfterClosure();
      expect(renewed.kind).toBe('ready');

      const after = reserve();
      expect(after.key).not.toBe(first.key);
      expect(after.record.request.identity).toBe('burger x1');
      expect(after.record.scope).toBe(SCOPE);
    });
  });

  describe('exactly one successor', () => {
    it('two mounts renewing the same record produce ONE new key', () => {
      reserve();
      expect(coordinator.noteClosure(CLOSURE)).toBeTrue();

      const a = coordinator.renewAfterClosure();
      const b = coordinator.renewAfterClosure();

      // O1 — ONE KEY, AND THE SECOND CALL MINTS NOTHING. The successor
      // carries no closure (it has not been priced, let alone retired), so
      // the second call finds no evidence rather than a record to compare
      // handles against. The property under test — two mounts, one new key —
      // is unchanged; what reports it is the store rather than a `replaced`
      // argument a stale caller could get wrong.
      expect(a.kind).toBe('ready');
      expect(b.kind).toBe('none');
      expect(reserve().key).toBe(
        (a as Extract<typeof a, { kind: 'ready' }>).key);
    });

    it('a renewal naming a record that is no longer current is refused', () => {
      const first = reserve();
      expect(coordinator.noteClosure(CLOSURE)).toBeTrue();
      coordinator.renewAfterClosure();

      // O1 — THE SUCCESSOR CARRIES NO CLOSURE, so a second call finds no
      // evidence and mints nothing. That is the same protection the old
      // `replaced` handle gave, reached from the store instead of from a
      // caller's memory of which record it decided about.
      const stale = coordinator.renewAfterClosure();
      expect(stale.kind).toBe('none');
      expect(coordinator.record()!.replaces).toBe(first.key);
    });

    it('the successor LINKS to what it replaces', () => {
      const first = reserve();
      expect(coordinator.noteClosure(CLOSURE)).toBeTrue();
      coordinator.renewAfterClosure();

      const after = reserve();
      expect(after.record.replaces).toBe(first.key);
      expect(after.record.key).not.toBe(first.key);
    });

    it('a fresh reservation carries no linkage', () => {
      expect(reserve().record.replaces).toBeNull();
    });
  });

  describe('what a renewal must never do', () => {
    it('is REFUSED while an acceptance is outstanding', () => {
      // O1 — REACHED THE WAY PRODUCTION CAN REACH IT. `noteClosure` settles
      // the command in the same write (a closed quote can never have been
      // accepted), so the closure is established FIRST and a command issued
      // after it is what leaves the record outstanding. The protection is
      // unchanged; only the route to the state is.
      const first = reserve();
      expect(coordinator.noteClosure(CLOSURE)).toBeTrue();
      coordinator.noteCommand({ orderId: 'o1', quoteRef: 'ref-1' });

      const refused = coordinator.renewAfterClosure();
      expect(refused.kind).toBe('outstanding');
      // and the key is untouched, so the outstanding command is still
      // recoverable by exactly the record that issued it.
      expect(coordinator.record()!.key).toBe(first.key);
      expect(coordinator.record()!.command).toEqual(
        { orderId: 'o1', quoteRef: 'ref-1' });
    });

    it('is refused when there is no record to renew', () => {
      expect(coordinator.renewAfterClosure().kind).toBe('none');
    });

    it('C2: is refused with NO verified closure behind it', () => {
      // A renewal abandons an idempotency key. The only thing that entitles a
      // client to do that is the server having RECORDED that the quote behind
      // it can never be accepted — so "no evidence" must not mint a key, and
      // the record must be left exactly as it was.
      const first = reserve();
      coordinator.settleRefusedCommand();

      expect(coordinator.renewAfterClosure().kind).toBe('none');
      expect(coordinator.record()!.key).toBe(first.key);
    });

    it('E1: is refused on a closure this build may not ACT on', () => {
      // A policy version this build has never seen. It is not absence — the
      // server recorded something — and it is not permission either: nothing
      // is minted, the key is untouched, and the consumer offers manual
      // recovery rather than a re-price that would replay the retired order.
      const first = reserve();
      expect(coordinator.noteClosure(
        { ...CLOSURE, policyVersion: 99 })).toBeTrue();

      const refused = coordinator.renewAfterClosure();
      expect(refused.kind).toBe('unusable');
      expect(refused.kind === 'unusable'
        && refused.evidence.kind).toBe('unsupported');
      expect(coordinator.record()!.key).toBe(first.key);
    });

    it('does not carry the replaced attempt COMMAND forward', () => {
      reserve();
      coordinator.noteCommand({ orderId: 'o1', quoteRef: 'ref-1' });
      expect(coordinator.noteClosure(CLOSURE)).toBeTrue();
      coordinator.renewAfterClosure();

      const after = coordinator.record()!;
      expect(after.command).toBeNull();
      expect(after.stage).toBe('pricing');
      expect(after.outcome).toBeNull();
    });

    it('does not carry a demonstrated protocol level forward', () => {
      reserve();
      coordinator.noteProtocol(3);
      expect(coordinator.noteClosure(CLOSURE)).toBeTrue();
      coordinator.renewAfterClosure();

      // A NEW ATTEMPT IS A NEW QUESTION. The level is remembered per attempt
      // and is re-demonstrated by the server's next response; carrying it
      // across would let a record assert a capability about an exchange that
      // has not happened yet.
      expect(coordinator.record()!.protocol).toBe(0);
    });
  });

  describe('the durable write is verified', () => {
    it('a storage that silently drops the write refuses the renewal', () => {
      reserve();
      expect(coordinator.noteClosure(CLOSURE)).toBeTrue();
      const before = coordinator.record()!.key;

      spyOn(window.sessionStorage, 'setItem').and.stub();
      expect(coordinator.renewAfterClosure().kind).toBe('storage-error');

      // NOTHING IS SENT on a key nobody wrote down: the previous record is
      // still what storage holds, so the client has not silently started an
      // attempt it cannot recover.
      expect(coordinator.record()!.key).toBe(before);
    });
  });
});
