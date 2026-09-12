import { TestBed } from '@angular/core/testing';
import {
  HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi, withXhr,
} from '@angular/common/http';
import {
  HttpTestingController, provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

import { AuthenticationService } from './authentication.service';
import { ConnectivityService } from './connectivity.service';
import { ErrorInterceptor } from '../_helpers/error.interceptor';
import { ToastService } from '../_shared/ui/toast/toast.service';

import { ApiService } from './api.service';
import {
  CheckoutCoordinatorService, PURCHASE_CANON, RecoveryOutcome,
} from './checkout-coordinator.service';
import { DinerSessionService } from './diner-session.service';
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
 *   appears stuck. The `reserveIntent` specs are that.
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
  let session: DinerSessionService;
  let api: jasmine.SpyObj<ApiService>;

  /** A basket identity, in the shape `BasketService.contentIdentity()`
   *  produces: one sorted `<lineIdentity>x<quantity>` entry per line. It is
   *  OPAQUE to this service — built here rather than imported so these specs
   *  stay about the coordinator's own rules. */
  const BASKET = JSON.stringify(['{"i":"i1","m":[],"e":[]}x2']);
  const CONTEXT = 'r1:t1';

  /** `reserveIntent`'s reply is a union — these specs are about the KEY, so
   *  they assert readiness once here rather than at every call site. */
  function key(basket = BASKET, context = CONTEXT): string {
    const reservation = service.reserveIntent(
      { identity: basket, canon: PURCHASE_CANON }, context);
    expect(reservation.kind).toBe('ready');
    return reservation.kind === 'ready' ? reservation.key : '';
  }

  /** A fresh service over the SAME storage: what a page reload produces. */
  function reload(): CheckoutCoordinatorService {
    return new CheckoutCoordinatorService(api, storage, session);
  }

  function keyOn(
    instance: CheckoutCoordinatorService, basket = BASKET, context = CONTEXT,
  ): string | null {
    const reservation = instance.reserveIntent(
      { identity: basket, canon: PURCHASE_CANON }, context);
    return reservation.kind === 'ready' ? reservation.key : null;
  }

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
    session = TestBed.inject(DinerSessionService);
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
      const reserved = key();
      const stored = service.record();
      expect(stored).not.toBeNull();
      expect(stored!.key).toBe(reserved);
    });

    it('survives a reload — a fresh service reads the same key', () => {
      // THE DEFECT, stated directly. This is what the in-memory field could
      // not do, and what made every reload mint a second order's worth of key.
      const reserved = key();
      expect(keyOn(reload())).toBe(reserved);
    });

    it('is bound to the basket CONTENTS, so a reload cannot change the answer', () => {
      // THE SECOND DEFECT, and the subtler one. This used to compare
      // `BasketService.revision()` — a counter on a service instance, which
      // restarts at 0 on a page load while the basket itself is RESTORED
      // from storage. So a diner who added an item, checked out and then
      // reloaded had their persisted attempt judged "a different basket" and
      // a fresh key minted: if the lost response had in fact succeeded, the
      // retry could place a SECOND order, through the very reload the key
      // was persisted to survive. A content identity is derived from what
      // survives, so there is nothing to reset. (Codex P1 on PR #663.)
      const reserved = key();
      // a reload: a brand-new service, the same restored basket
      const afterReload = reload();
      expect(keyOn(afterReload)).toBe(reserved);
      // and a genuinely different basket still mints afresh
      expect(keyOn(afterReload, BASKET + 'x')).not.toBe(reserved);
    });

    it('reuses one key while the basket and the table are unchanged', () => {
      const reserved = key();
      expect(key()).toBe(reserved);
      expect(key()).toBe(reserved);
    });

    it('mints a fresh key once the basket really changes', () => {
      const reserved = key();
      expect(key(BASKET + 'more')).not.toBe(reserved);
    });

    it('mints a fresh key at a different table', () => {
      // A key already used at another table is REFUSED by the server
      // (`checkout_intent_unusable`), so reusing one across a context change
      // would turn an ordinary table move into a checkout the diner cannot
      // complete. A different table is a different purchase.
      const reserved = key();
      expect(key(BASKET, 'r1:t2')).not.toBe(reserved);
    });

    it('mints a key that is a plausible UUID', () => {
      expect(key()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('records the stage and the command so a reload knows what to ask', () => {
      key();
      expect(service.noteStage('reviewing')).toBeTrue();
      expect(service.record()!.stage).toBe('reviewing');
      expect(service.noteCommand({ orderId: 'o1', quoteRef: 'q1' })).toBeTrue();
      const stored = service.record()!;
      expect(stored.stage).toBe('accepting');
      expect(stored.command).toEqual({ orderId: 'o1', quoteRef: 'q1' });
    });

    it('never resurrects an attempt the caller has already finished', () => {
      key();
      service.clearIntent();
      // AND IT REPORTS THE FAILURE. A caller recording progress on a
      // checkout that is not there has lost track of it; returning success
      // would hide that, and the callers now act on the boolean.
      expect(service.noteStage('accepting')).toBeFalse();
      expect(service.record()).toBeNull();
    });

    it('keeps the key across a stage note', () => {
      const reserved = key();
      service.noteStage('reviewing');
      expect(service.record()!.key).toBe(reserved);
    });
  });

  describe('forgetting an attempt', () => {
    it('removes ONE key and never clears storage', () => {
      // The diner session capability and the basket live in the same store,
      // so a blanket wipe here would sign the diner out of their own table to
      // tidy up a finished checkout.
      storage.setItem('somethingElse', { keep: true });
      key();

      service.clearIntent();

      expect(service.record()).toBeNull();
      expect(storage.getItem<any>('somethingElse')).toEqual({ keep: true });
    });
  });

  describe('a malformed or foreign record', () => {
    // Storage is shared with the whole origin. A checkout must not be blocked
    // by something else's bad write, and must not act on one either.
    it('yields no usable record', () => {
      for (const junk of [null, 'a string', 42, [], {}, { key: '' },
                          { key: 'k' }, { key: 'k', phase: 'nonsense' }]) {
        storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY, junk);
        expect(service.record()).withContext(JSON.stringify(junk)).toBeNull();
      }
    });

    it('BLOCKS a fresh key rather than being overwritten', () => {
      // THIS CONTRACT DELIBERATELY MOVED. It used to mint straight over the
      // junk, on the reasoning that a checkout must not be blocked by
      // somebody else's bad write. But only this app writes this key, so the
      // realistic source of an unparseable value is OUR OWN record — and
      // overwriting one is exactly how the identity of a checkout whose
      // outcome is unsettled disappears. It is reported instead, and the
      // caller says so rather than starting a second checkout.
      storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY, { key: 42 });
      const reservation = service.reserveIntent(
        { identity: BASKET, canon: PURCHASE_CANON }, CONTEXT);
      expect(reservation.kind).toBe('blocked');
      expect(service.read().kind).toBe('malformed');
    });

    it('is never ADOPTED when its basket identity is unreadable', () => {
      // The conservative direction: a record nobody can tie to this basket
      // is not this basket's, so it mints rather than reuses. (A D04/D
      // record with no `basket` field is UPGRADED — not discarded — and its
      // identity is set to a value nothing can equal.)
      storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY, {
        key: 'someone-elses', phase: 'pricing', context: CONTEXT,
      });
      expect(key()).not.toBe('someone-elses');
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
      const reserved = key();
      resolve();
      const [, url, params] = api.get.calls.argsFor(0);
      expect(url).toBe('orders/journey/order-details/');
      expect(params).toEqual({ intent: reserved });
    });

    it('reports an accepted order as accepted', () => {
      key();
      api.get.and.returnValue(
        of({ data: { id: 'o1', accepted: true } }) as any);
      const outcome = resolve();
      expect(outcome.kind).toBe('accepted');
      expect((outcome as any).order).toEqual({ id: 'o1', accepted: true });
    });

    it('reports an unaccepted order as a draft', () => {
      // Against a pre-correlation server, and only because THIS CLIENT'S OWN
      // record says it never issued an acceptance for this key — see the
      // level-2 specs, where the same payload after a command was issued is
      // deliberately NOT called a draft.
      key();
      api.get.and.returnValue(
        of({ data: { id: 'o1', accepted: false } }) as any);
      expect(resolve().kind).toBe('draft');
    });

    it('treats a 404 as ABSENT — the server said no such order', () => {
      // The read is non-disclosing by design: a foreign, unknown and
      // malformed key are indistinguishable, and all three mean the same
      // thing to a diner at this table — nothing to recover.
      key();
      api.get.and.returnValue(throwError(() => ({ status: 404 })) as any);
      expect(resolve()).toEqual({ kind: 'absent' });
    });

    it('treats every other failure as UNKNOWN, never absent', () => {
      // THE MOST IMPORTANT DISTINCTION IN THIS FILE. An unreachable server is
      // not evidence that nothing happened, and treating it as such is how a
      // recovery mechanism creates the duplicate order it exists to prevent.
      key();
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
      key();
      api.get.and.returnValue(of({ data: null }) as any);
      expect(resolve()).toEqual({ kind: 'unknown' });
    });

    it('leaves the attempt in place — resolving is not deciding', () => {
      // The coordinator reports; the caller decides what to drop. Clearing
      // here would silently discard a key on a `unknown` outcome, which is
      // exactly the case where it must survive.
      const reserved = key();
      api.get.and.returnValue(throwError(() => ({ status: 500 })) as any);
      resolve();
      expect(service.record()!.key).toBe(reserved);
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
      const bounded = new CheckoutCoordinatorService(api, storage, session)
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


/**
 * THE PRODUCTION PATH, not a hand-built error shape.
 *
 * The suite above stubs `ApiService` and hands `recover()` a
 * `{status: 404}` object. That is the shape a raw `HttpErrorResponse` has —
 * and NOT the shape the deployed app produces, because `ErrorInterceptor`
 * collapses an ordinary failure to `err.error.message || err.statusText`, a
 * bare string. So a definitive 404 arrived as "the server could not be
 * asked", the dead key was retained, and every basket page load repeated the
 * failed recovery with another error toast. (Codex P2 on PR #663, valid.)
 *
 * These specs run the real `HttpClient`, the real interceptor and the real
 * `ApiService`, so nothing here can pass on a shape production never emits.
 */
describe('CheckoutCoordinatorService through the real interceptor', () => {
  let service: CheckoutCoordinatorService;
  let storage: SessionStorageService;
  let httpMock: HttpTestingController;
  let toast: jasmine.SpyObj<ToastService>;
  let session: DinerSessionService;

  const BASKET = '["one-line"]';
  const CONTEXT = 'r1:t1';

  beforeEach(() => {
    toast = jasmine.createSpyObj<ToastService>(
      'ToastService', ['success', 'error', 'warning', 'info', 'clear',
                       'dismiss']);
    TestBed.configureTestingModule({
      providers: [
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: 'coord-http-spec' },
        { provide: ToastService, useValue: toast },
        {
          provide: AuthenticationService,
          useValue: jasmine.createSpyObj(
            'AuthenticationService', ['logout', 'attemptTokenRefresh'],
            { userValue: null }),
        },
        { provide: Router, useValue: { url: '/diner/basket' } },
        { provide: ConnectivityService, useValue: { isOffline: () => false } },
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(CheckoutCoordinatorService);
    storage = TestBed.inject(SessionStorageService);
    session = TestBed.inject(DinerSessionService);
    httpMock = TestBed.inject(HttpTestingController);
    storage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
  });

  afterEach(() => {
    httpMock.verify();
    storage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
  });

  function resolveWith(body: Record<string, unknown>,
                       options: { status: number;
                                  statusText: string } | null) {
    service.reserveIntent({ identity: BASKET, canon: PURCHASE_CANON },
                          CONTEXT);
    let outcome!: RecoveryOutcome;
    service.recover().subscribe((value) => (outcome = value));
    const request = httpMock.expectOne(
      (r) => r.url.includes('orders/journey/order-details/'));
    if (options) request.flush(body, options);
    else request.flush(body);
    return outcome;
  }

  it('classifies a real 404 as ABSENT and KEEPS the record', () => {
    const outcome = resolveWith(
      { status: 404, message: 'Order not found' },
      { status: 404, statusText: 'Not Found' });
    expect(outcome).toEqual({ kind: 'absent' });
    // AND IT DOES NOT RETIRE THE INTENT. A proven absence licenses a
    // SAME-KEY, SAME-REQUEST replay; it is not a reason to forget which key.
    expect(service.record()).not.toBeNull();
  });

  it('classifies a real 500 as UNKNOWN and keeps the key', () => {
    const outcome = resolveWith(
      { status: 500, message: 'boom' },
      { status: 500, statusText: 'Server Error' });
    expect(outcome).toEqual({ kind: 'unknown' });
    expect(service.record()).not.toBeNull();
  });

  it('classifies an older backend that does not know the key as UNKNOWN', () => {
    // Deployed before the recovery endpoint, `?intent=` is ignored and the
    // missing `?order=` is a 400. Not absence — the server never looked.
    const outcome = resolveWith(
      { status: 400, message: 'Please provide the order id' },
      { status: 400, statusText: 'Bad Request' });
    expect(outcome).toEqual({ kind: 'unknown' });
    expect(service.record()).not.toBeNull();
  });

  it('raises no toast for a background read nobody asked for', () => {
    resolveWith({ status: 404, message: 'Order not found' },
                { status: 404, statusText: 'Not Found' });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('still reads an accepted order off a real success', () => {
    const outcome = resolveWith(
      { status: 200, message: 'ok', data: { id: 'o1', accepted: true } }, null);
    expect(outcome.kind).toBe('accepted');
  });
});
