import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import { ApiService } from './api.service';
import {
  CheckoutCoordinatorService, RecoveryOutcome,
} from './checkout-coordinator.service';
import { SessionStorageService } from './storage/session-storage.service';
import { STORAGE_KEY_PREFIX } from './storage/storage-key-prefix.token';
import { WINDOW } from './storage/window.token';

/**
 * D04/D — the coordinator.
 *
 * The three gaps it closes, and what each spec below is actually about:
 *
 *   THE KEY LIVED ONLY IN MEMORY. A reload dropped it and the next attempt
 *   minted a NEW one, so the server's whole idempotency guarantee was
 *   bypassed by the single most likely thing a diner does when a checkout
 *   appears stuck. The `intentKey` specs are that.
 *
 *   THERE WAS NO SINGLE FLIGHT. `BasketBodyComponent` is mounted twice on
 *   desktop and `placingOrder` was a field on each instance.
 *
 *   A LOST RESPONSE WAS UNRECOVERABLE. Nothing could ask what the key already
 *   held resolved to. The `recover` specs are that, and the one that matters
 *   most is the distinction between "the server said no such order" and "the
 *   server could not be asked".
 */
describe('CheckoutCoordinatorService', () => {
  let service: CheckoutCoordinatorService;
  let storage: SessionStorageService;
  let api: jasmine.SpyObj<ApiService>;

  const REV = 7;
  const CONTEXT = 'r1:t1';

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'postPatch']);
    api.get.and.returnValue(of({ data: {} }) as any);

    TestBed.configureTestingModule({
      providers: [
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: 'coord-spec' },
        { provide: ApiService, useValue: api },
      ],
    });
    service = TestBed.inject(CheckoutCoordinatorService);
    storage = TestBed.inject(SessionStorageService);
    storage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
  });

  afterEach(() => {
    storage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
  });

  // -- the intent key ----------------------------------------------------

  describe('the intent key', () => {
    it('is persisted BEFORE it is handed to a caller', () => {
      // The ORDER of those two operations is the whole point: minting a key
      // and putting it in a request body is a promise to treat the retry as
      // the same attempt, and a promise held only in memory does not survive
      // the thing it protects against.
      const key = service.intentKey(REV, CONTEXT);
      const stored = service.attempt();
      expect(stored).not.toBeNull();
      expect(stored!.key).toBe(key);
    });

    it('survives a reload — a fresh service reads the same key', () => {
      // THE DEFECT, stated directly. This is what the in-memory field could
      // not do, and what made every reload mint a second order's worth of key.
      const key = service.intentKey(REV, CONTEXT);
      const reloaded = new CheckoutCoordinatorService(api, storage);
      expect(reloaded.intentKey(REV, CONTEXT)).toBe(key);
    });

    it('reuses one key while the basket and the table are unchanged', () => {
      const key = service.intentKey(REV, CONTEXT);
      expect(service.intentKey(REV, CONTEXT)).toBe(key);
      expect(service.intentKey(REV, CONTEXT)).toBe(key);
    });

    it('mints a fresh key once the basket really changes', () => {
      const key = service.intentKey(REV, CONTEXT);
      expect(service.intentKey(REV + 1, CONTEXT)).not.toBe(key);
    });

    it('mints a fresh key at a different table', () => {
      // A key already used at another table is REFUSED by the server
      // (`checkout_intent_unusable`), so reusing one across a context change
      // would turn an ordinary table move into a checkout the diner cannot
      // complete. A different table is a different purchase.
      const key = service.intentKey(REV, CONTEXT);
      expect(service.intentKey(REV, 'r1:t2')).not.toBe(key);
    });

    it('mints a key that is a plausible UUID', () => {
      expect(service.intentKey(REV, CONTEXT)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('records the phase so a reload knows what to ask about', () => {
      service.intentKey(REV, CONTEXT);
      service.notePhase('reviewing', { orderId: 'o1', quoteRef: 'q1' });
      const stored = service.attempt()!;
      expect(stored.phase).toBe('reviewing');
      expect(stored.orderId).toBe('o1');
      expect(stored.quoteRef).toBe('q1');
    });

    it('never resurrects an attempt the caller has already finished', () => {
      service.intentKey(REV, CONTEXT);
      service.clearIntent();
      service.notePhase('submitting');
      expect(service.attempt()).toBeNull();
    });

    it('keeps the key across a phase note', () => {
      const key = service.intentKey(REV, CONTEXT);
      service.notePhase('submitting');
      expect(service.attempt()!.key).toBe(key);
    });
  });

  describe('forgetting an attempt', () => {
    it('removes ONE key and never clears storage', () => {
      // The diner session capability and the basket live in the same store,
      // so a blanket wipe here would sign the diner out of their own table to
      // tidy up a finished checkout.
      storage.setItem('somethingElse', { keep: true });
      service.intentKey(REV, CONTEXT);

      service.clearIntent();

      expect(service.attempt()).toBeNull();
      expect(storage.getItem<any>('somethingElse')).toEqual({ keep: true });
    });
  });

  describe('a malformed or foreign record', () => {
    // Storage is shared with the whole origin. A checkout must not be blocked
    // by something else's bad write, and must not act on one either.
    it('is treated as no attempt at all', () => {
      for (const junk of [null, 'a string', 42, [], {}, { key: '' },
                          { key: 'k' }, { key: 'k', phase: 'nonsense' }]) {
        storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY, junk);
        expect(service.attempt()).withContext(JSON.stringify(junk)).toBeNull();
      }
    });

    it('does not stop a fresh key being minted', () => {
      storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY, { key: 42 });
      expect(service.intentKey(REV, CONTEXT)).toBeTruthy();
      expect(service.attempt()).not.toBeNull();
    });
  });

  // -- the single flight -------------------------------------------------

  describe('the single flight', () => {
    it('is free to start with', () => {
      expect(service.inFlight()).toBeFalse();
    });

    it('admits one holder and refuses the second', () => {
      // The two mounted instances of the basket body, exactly.
      const first = service.claimFlight();
      const second = service.claimFlight();
      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(service.inFlight()).toBeTrue();
    });

    it('is free again once the holder releases it', () => {
      const token = service.claimFlight();
      service.releaseFlight(token);
      expect(service.inFlight()).toBeFalse();
      expect(service.claimFlight()).not.toBeNull();
    });

    it('ignores a release from a token that no longer holds it', () => {
      // A late release from a superseded attempt must not free a live one —
      // otherwise a discarded response hands the checkout button back while
      // somebody else's submission is in flight.
      const stale = service.claimFlight();
      service.releaseFlight(stale);
      const live = service.claimFlight();

      service.releaseFlight(stale);

      expect(service.inFlight()).toBeTrue();
      service.releaseFlight(live);
      expect(service.inFlight()).toBeFalse();
    });

    it('ignores a null release', () => {
      service.claimFlight();
      service.releaseFlight(null);
      expect(service.inFlight()).toBeTrue();
    });
  });

  // -- recovery ----------------------------------------------------------

  describe('recovering an interrupted checkout', () => {
    function resolve(): RecoveryOutcome {
      let outcome!: RecoveryOutcome;
      service.recover().subscribe((value) => (outcome = value));
      return outcome;
    }

    it('reports nothing when no attempt is persisted', () => {
      expect(resolve()).toEqual({ kind: 'none' });
      expect(api.get).not.toHaveBeenCalled();
    });

    it('asks the diner read by intent key', () => {
      const key = service.intentKey(REV, CONTEXT);
      resolve();
      const [, url, params] = api.get.calls.argsFor(0);
      expect(url).toBe('orders/journey/order-details/');
      expect(params).toEqual({ intent: key });
    });

    it('reports an accepted order as accepted', () => {
      service.intentKey(REV, CONTEXT);
      api.get.and.returnValue(
        of({ data: { id: 'o1', accepted: true } }) as any);
      expect(resolve()).toEqual(
        { kind: 'accepted', order: { id: 'o1', accepted: true } } as any);
    });

    it('reports an unaccepted order as a draft', () => {
      service.intentKey(REV, CONTEXT);
      api.get.and.returnValue(
        of({ data: { id: 'o1', accepted: false } }) as any);
      expect(resolve().kind).toBe('draft');
    });

    it('treats a 404 as ABSENT — the server said no such order', () => {
      // The read is non-disclosing by design: a foreign, unknown and
      // malformed key are indistinguishable, and all three mean the same
      // thing to a diner at this table — nothing to recover.
      service.intentKey(REV, CONTEXT);
      api.get.and.returnValue(throwError(() => ({ status: 404 })) as any);
      expect(resolve()).toEqual({ kind: 'absent' });
    });

    it('treats every other failure as UNKNOWN, never absent', () => {
      // THE MOST IMPORTANT DISTINCTION IN THIS FILE. An unreachable server is
      // not evidence that nothing happened, and treating it as such is how a
      // recovery mechanism creates the duplicate order it exists to prevent.
      service.intentKey(REV, CONTEXT);
      for (const failure of [
        { status: 0 }, { status: 500 }, { status: 401 },
        'no network', null, undefined, new Error('boom'),
      ]) {
        api.get.and.returnValue(throwError(() => failure) as any);
        expect(resolve()).withContext(String(failure))
          .toEqual({ kind: 'unknown' });
      }
    });

    it('treats a response with no order as unknown rather than absent', () => {
      service.intentKey(REV, CONTEXT);
      api.get.and.returnValue(of({ data: null }) as any);
      expect(resolve()).toEqual({ kind: 'unknown' });
    });

    it('leaves the attempt in place — resolving is not deciding', () => {
      // The coordinator reports; the caller decides what to drop. Clearing
      // here would silently discard a key on a `unknown` outcome, which is
      // exactly the case where it must survive.
      const key = service.intentKey(REV, CONTEXT);
      api.get.and.returnValue(throwError(() => ({ status: 500 })) as any);
      resolve();
      expect(service.attempt()!.key).toBe(key);
    });
  });

  // -- bounded requests --------------------------------------------------

  describe('bounded requests', () => {
    it('passes a value straight through', () => {
      let seen: unknown;
      service.bounded(of('ok')).subscribe((v) => (seen = v));
      expect(seen).toBe('ok');
    });

    it('passes an error straight through', () => {
      let seen: unknown;
      service.bounded(throwError(() => 'boom')).subscribe({
        error: (e) => (seen = e),
      });
      expect(seen).toBe('boom');
    });

    it('fails a request that never resolves', (done) => {
      // Without a ceiling a dead-but-open connection leaves the CTA spinning
      // for as long as the browser keeps the socket, and the diner's only
      // escape is the reload that used to lose the key.
      const never = new Observable<never>(() => {});
      const original = CheckoutCoordinatorService.REQUEST_TIMEOUT_MS;
      (CheckoutCoordinatorService as any).REQUEST_TIMEOUT_MS = 5;
      const bounded = new CheckoutCoordinatorService(api, storage)
        .bounded(never);
      (CheckoutCoordinatorService as any).REQUEST_TIMEOUT_MS = original;

      bounded.subscribe({
        next: () => done.fail('a request that never resolves must not succeed'),
        error: () => done(),
      });
    });

    it('uses a generous ceiling — a slow success beats an early abandon', () => {
      // And timing out is SAFE rather than duplicative, because it never
      // re-mints the key: the retry is the same attempt.
      expect(CheckoutCoordinatorService.REQUEST_TIMEOUT_MS)
        .toBeGreaterThanOrEqual(15_000);
    });
  });
});
