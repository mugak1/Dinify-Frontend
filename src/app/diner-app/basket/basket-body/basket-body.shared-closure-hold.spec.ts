/**
 * I2-C — AN UNRESOLVED CLOSURE MUST BE A FACT BOTH BASKET CONSUMERS READ.
 *
 * THE MECHANISM, stated exactly. `applyInitiationResult` answers two closure
 * situations by assigning `this.recovered`:
 *
 *   - `closure-unreadable`  the server asserted something under
 *                           `quote_closure` that this build may not act on
 *                           (an unsupported policy version, a malformed row,
 *                           one naming a different quote, or a same-attempt
 *                           omission of a level already demonstrated);
 *   - `closure-unrecorded`  the closure is VALID and the local verified write
 *                           failed.
 *
 * Both assignments are COMPONENT-LOCAL. `RecoveryOutcome` being declared in
 * the coordinator module does not make a field on one component instance
 * shared runtime state — and `closureUnresolvable()` reads that field plus
 * `unusableClosure()`, which reads the same field and the PERSISTED closure.
 * In both situations the persisted record is still
 * `K1 / pricing / command=null / outcome=null / closure=null`, and the
 * app-wide flight has been released (correctly — nothing is in flight).
 *
 * SO THE SECOND MOUNT SEES NOTHING. `BasketBodyComponent` is mounted twice on
 * desktop — the routed page and the sidebar beside the router outlet — and the
 * sidebar has neither the first instance's `recovered` nor a persisted closure
 * to read. It classifies the original initiation as replayable and sends it
 * again, under a key that may be bound to an order the server has retired. The
 * first component remains blocked; the second is not. A component mounted
 * AFTER the hold has the same problem.
 *
 * WHAT THESE SPECS DRIVE. TWO real `BasketBodyComponent` instances over ONE
 * real `CheckoutCoordinatorService`, real session storage, the real
 * `ApiService`, the real `HttpClient` and the real `ErrorInterceptor`. B's OWN
 * Retry and confirmation methods are exercised — never a second call on A —
 * and the coordinator's own mutation decisions are inspected beside the button
 * state, because a getter that reads correctly while `reserveIntent` still
 * mints a key has not closed anything.
 *
 * THE CONTROLS ARE THE OTHER HALF. An ordinary ABSENCE of `quote_closure`, and
 * an older server that never promised to publish one, must both leave B
 * completely free — otherwise this would be a change that blocks checkout
 * rather than one that shares a hold. A valid closure that DOES persist is the
 * existing working path and is asserted to stay working, on both mounts.
 *
 * THE FIXTURE IS THE CORRECTED WIRE, and that is deliberate: every schedule
 * asserts `reviewQuote(...).readable === true` and `.itemised === true` on the
 * unmodified payload before injecting a fault, so a later refusal is
 * attributable to the fault and not to a structurally rejected quote. See
 * `corrected-quote.fixture.ts` for why a `'CORRECTED'` STRING is a legacy
 * payload wearing the word.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import {
  HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi, withXhr,
} from '@angular/common/http';
import {
  HttpTestingController, provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';

import { environment } from 'src/environments/environment';
import { WINDOW } from '../../../_services/storage/window.token';
import { STORAGE_KEY_PREFIX }
  from '../../../_services/storage/storage-key-prefix.token';
import { SessionStorageService }
  from '../../../_services/storage/session-storage.service';
import { BasketService } from '../../../_services/basket.service';
import {
  CheckoutCoordinatorService, PURCHASE_CANON,
} from '../../../_services/checkout-coordinator.service';
import { usableClosure } from '../../../_shared/order/quote-transition';
import { reviewQuote } from '../../../_shared/order/quote-review';
import { ErrorInterceptor } from '../../../_helpers/error.interceptor';
import { ToastService } from '../../../_shared/ui/toast/toast.service';
import { ConfirmDialogService } from '../../../_common/confirm-dialog.service';
import { ConnectivityService } from '../../../_services/connectivity.service';
import { BasketItem } from '../../../_models/app.models';
import { BasketBodyComponent } from './basket-body.component';
import { correctedInitiate, legacyInitiate } from './corrected-quote.fixture';

describe('BasketBodyComponent — the unresolved closure both mounts read '
         + '(D06/I2-C)', () => {
  let http: HttpTestingController;
  let basket: { items: BasketItem[]; totalAmount: number };
  let basketService: any;
  let coordinator: CheckoutCoordinatorService;
  let storage: SessionStorageService;

  const API = `${environment.apiUrl}/api`;
  const V1 = `${API}/${environment.version}`;
  const INITIATE = `${API}/v2/orders/initiate/`;
  const SUBMIT = `${V1}/orders/submit/`;

  const line = () => ({
    itemId: 'i1', itemName: 'Burger', basePrice: 5000, totalPrice: 5000,
    quantity: 1, selectedModifiers: [], extras: [], isDiscounted: false,
  } as unknown as BasketItem);

  /**
   * The diner's own scoped read, in the shape the server actually sends it:
   * the order details are FLAT on `data`, not nested under `order_details`.
   */
  const readAnswer = (key: string, over: Record<string, unknown> = {}) => ({
    status: 200,
    message: 'Successfully retrieved the order details',
    data: {
      id: 'o1', quote_ref: 'q1', actual_cost: '6000.00',
      quote_total: '6000.00', quote_complete: true, order_status: 'initiated',
      checkout_protocol: 3, quote_protocol: 2, quote_closure: null,
      accepted: false, accepted_at: null,
      checkout: {
        order_id: 'o1', intent_key: key,
        scope: { restaurant: 'r1', table: 't1' },
        acceptance: { state: 'not_accepted', outcome: null, quote_ref: null,
                      accepted_at: null },
        current: { order_status: 'initiated', fulfilment_status: 'new',
                   cancelled_at: null, served_at: null },
        checkout_protocol: 3,
      },
      items: [] as unknown[], quote: [] as unknown[],
      ...over,
    },
  });

  /** A closure this build CAN act on — valid, supported, naming this quote. */
  const CLOSURE = {
    closed_at: '2026-09-20T10:00:00Z',
    reason: 'quote_expired',
    quote_ref: 'q1',
    policy_version: 1,
  };

  /** A policy version this build has never seen: `unsupported`, NOT absent. */
  const UNSUPPORTED = { ...CLOSURE, policy_version: 99 };

  /** A row this build cannot read at all: `malformed`, NOT absent. */
  const MALFORMED = { ...CLOSURE, reason: 'something_this_build_never_heard_of' };

  function makeComponent(sidebar = true): ComponentFixture<BasketBodyComponent> {
    const fixture = TestBed.createComponent(BasketBodyComponent);
    // Every schedule drives its own requests explicitly. A routed instance
    // would run `resumeInterruptedCheckout` on `ngOnInit` and consume one.
    fixture.componentInstance.sidebar = sidebar;
    return fixture;
  }

  beforeEach(async () => {
    basket = { items: [line()], totalAmount: 5000 };
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);

    basketService = {
      Basket: () => basket,
      clearBasket: jasmine.createSpy('clearBasket'),
      revision: () => 1,
      contentIdentity: () =>
        BasketService.prototype.contentIdentity.call(basketService),
      totalState: (items: BasketItem[]) =>
        BasketService.prototype.totalState.call(basketService, items),
    };

    await TestBed.configureTestingModule({
      imports: [BasketBodyComponent],
      providers: [
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
        provideRouter([]),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
        { provide: BasketService, useValue: basketService },
        {
          provide: ConfirmDialogService,
          useValue: jasmine.createSpyObj<ConfirmDialogService>(
            'ConfirmDialogService', ['openModal', 'closeModal']),
        },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj<ToastService>(
            'ToastService',
            ['success', 'error', 'info', 'warning', 'clear', 'dismiss']),
        },
        { provide: ConnectivityService, useValue: { isOffline: () => false } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    spyOn(TestBed.inject(Router), 'navigate').and.stub();
    http = TestBed.inject(HttpTestingController);
    coordinator = TestBed.inject(CheckoutCoordinatorService);
    storage = TestBed.inject(SessionStorageService);
    window.sessionStorage.setItem(
      'Table', JSON.stringify({ value: { id: 't1' } }));
    window.sessionStorage.setItem(
      'restaurant', JSON.stringify({ value: { id: 'r1' } }));
  });

  afterEach(() => {
    http.verify();
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
    window.sessionStorage.removeItem('Table');
    window.sessionStorage.removeItem('restaurant');
  });

  // -- the schedule ------------------------------------------------------

  /**
   * A prices; the reply carries `closure` under `quote_closure`. Returns both
   * live mounts and the key the attempt reserved.
   *
   * `faultTheWrite` arms the storage fault AFTER the reservation and BEFORE
   * the reply, so the failure lands on the CLOSURE write specifically — never
   * on the key reservation, which would exercise an entirely different guard
   * and prove nothing about closure persistence.
   */
  function aReceives(
    closure: unknown,
    faultTheWrite: 'none' | 'throws' | 'silently-drops' = 'none',
    details: Record<string, unknown> = {},
  ) {
    const a = makeComponent();
    a.componentInstance.initiateOrder();
    const req = http.expectOne(INITIATE);
    const key = coordinator.record()!.key;

    if (faultTheWrite === 'throws') {
      spyOn(storage, 'setItem').and.throwError('QuotaExceededError');
    } else if (faultTheWrite === 'silently-drops') {
      // The realistic failing store: it accepts the write, throws nothing and
      // keeps the previous value. `persist`'s read-back is what catches it.
      spyOn(storage, 'setItem').and.stub();
    }

    const payload = correctedInitiate(
      'o1', 'q1', closure === undefined ? details
        : { quote_closure: closure, ...details });
    // THE PREMISE: without the closure this payload is ordinarily
    // confirmable, so a refusal below is the closure and not the quote.
    const control = reviewQuote(correctedInitiate('o1', 'q1').data as any);
    expect(control.readable)
      .withContext('the unmodified fixture must be a readable quote').toBeTrue();
    expect(control.itemised)
      .withContext('and an ITEMISED one — a `CORRECTED` string would take the '
                   + 'legacy branch and assert nothing about this contract')
      .toBeTrue();

    req.flush(payload);

    // B is a SECOND live mount of the same component over the same
    // coordinator — the desktop sidebar beside the routed page.
    const b = makeComponent();
    return { a, b, key };
  }

  /** Everything a consumer may do that mutates, asked of ONE instance. */
  /** The diner's own scoped read, selected by intent key. Matched on the
   *  REQUEST URL as the client actually builds it — `ApiService` appends the
   *  selector inline rather than through `HttpParams`, so a `params.get`
   *  matcher silently matches nothing. */
  const intentRead = (key: string) => (r: { urlWithParams: string }) =>
    r.urlWithParams
      === `${V1}/orders/journey/order-details/?intent=${key}`;

  function attemptEveryMutation(fixture: ComponentFixture<BasketBodyComponent>) {
    fixture.componentInstance.initiateOrder();   // the ordinary Checkout press
    fixture.componentInstance.retryOrder();      // the Retry press
    fixture.componentInstance.confirmQuote();    // an open review, confirmed
    fixture.componentInstance.reviewUpdatedOrder(); // the successor action
  }

  // == 1. an unusable closure ============================================

  describe('an asserted closure this build may not act on', () => {
    it('THE PREMISE: the record both mounts share says nothing about it',
       () => {
      const { key } = aReceives(UNSUPPORTED);

      const record = coordinator.record()!;
      expect(record.key).withContext('same attempt').toBe(key);
      expect(record.stage).toBe('pricing');
      expect(record.command).toBeNull();
      expect(record.outcome).toBeNull();
      expect(coordinator.closureOf(record).evidence.kind)
        .withContext('nothing was persisted — that IS the mechanism')
        .toBe('absent');
      expect(coordinator.inFlight())
        .withContext('and the flight was released, correctly').toBeFalse();
    });

    it('THE PREMISE: the receiving mount blocks itself', () => {
      const { a } = aReceives(UNSUPPORTED);
      expect(a.componentInstance.closureUnresolved).toBeTrue();
      expect(a.componentInstance.checkoutBlocked).toBeTrue();
    });

    it('THE REGRESSION: the OTHER live mount reports the same hold', () => {
      const { b } = aReceives(UNSUPPORTED);
      expect(b.componentInstance.closureUnresolved)
        .withContext('B has neither A`s `recovered` nor a persisted closure')
        .toBeTrue();
      expect(b.componentInstance.checkoutBlocked).toBeTrue();
    });

    it('THE REGRESSION: and B`s own Retry sends nothing', () => {
      const { b } = aReceives(UNSUPPORTED);
      b.componentInstance.retryOrder();
      http.expectNone(INITIATE);
      http.expectNone(SUBMIT);
      expect(http.match(() => true).length)
        .withContext('no request of any kind').toBe(0);
    });

    it('THE REGRESSION: and B`s own Checkout press sends nothing and mints '
       + 'no second key', () => {
      const { b, key } = aReceives(UNSUPPORTED);
      b.componentInstance.initiateOrder();
      expect(http.match(() => true).length).toBe(0);
      expect(coordinator.record()!.key)
        .withContext('the held attempt is not replaced').toBe(key);
    });

    it('THE REGRESSION: and B confirming a same-key review it already holds '
       + 'issues no acceptance', () => {
      // THE ORDER OF THIS SCHEDULE IS FORCED BY THE SINGLE FLIGHT. Only one
      // surface may price at a time, so B cannot open its review while A's
      // request is still open — B prices first, keeps its sheet, and A's
      // LATER answer is the one that carries evidence nothing may act on.
      const b = makeComponent();
      b.componentInstance.initiateOrder();
      http.expectOne(INITIATE).flush(correctedInitiate());
      const key = coordinator.record()!.key;
      expect(b.componentInstance.showQuoteSheet)
        .withContext('B is holding a confirmable review').toBeTrue();

      // A prices the SAME purchase, so `reserveIntent` hands back the SAME
      // key — the ordinary desktop shape, two mounts of one basket.
      const a = makeComponent();
      a.componentInstance.initiateOrder();
      http.expectOne(INITIATE)
        .flush(correctedInitiate('o1', 'q1', { quote_closure: UNSUPPORTED }));
      expect(coordinator.record()!.key)
        .withContext('both mounts are on one attempt').toBe(key);
      expect(a.componentInstance.closureUnresolved)
        .withContext('A is held').toBeTrue();
      expect(b.componentInstance.showQuoteSheet)
        .withContext('and B`s sheet is untouched — it has no idea').toBeTrue();

      b.componentInstance.confirmQuote();
      http.expectNone(SUBMIT);
      expect(http.match(() => true).length)
        .withContext('a newer shared hold outranks a reviewed key that still '
                     + 'matches').toBe(0);
      expect(coordinator.record()!.command)
        .withContext('and no command was recorded').toBeNull();
    });

    it('THE REGRESSION: and the diner is told which situation they are in, '
       + 'not that their device failed to save something', () => {
      // THE ISOLATION SPEC FOR THE CONSUMER GUARD. `noteCommand` refuses a
      // held attempt too, so removing the guard in `submitOrder` alone still
      // stops the acceptance — but it stops it with the STORAGE sentence
      // ("we couldn't save your checkout on this device… please try again"),
      // which points a diner at a retry that can never work for a quote the
      // server has permanently retired. The two layers are deliberate
      // duplication; this is the property that tells them apart.
      const b = makeComponent();
      b.componentInstance.initiateOrder();
      http.expectOne(INITIATE).flush(correctedInitiate());
      expect(b.componentInstance.showQuoteSheet).toBeTrue();

      const a = makeComponent();
      a.componentInstance.initiateOrder();
      http.expectOne(INITIATE)
        .flush(correctedInitiate('o1', 'q1', { quote_closure: UNSUPPORTED }));

      b.componentInstance.confirmQuote();
      http.expectNone(SUBMIT);
      expect(b.componentInstance.orderErrorMessage)
        .withContext('the situation, stated').toContain('check with staff');
      expect(b.componentInstance.orderErrorMessage)
        .withContext('and NOT the storage sentence, which invites a retry')
        .not.toContain('save your checkout');
      expect(b.componentInstance.showQuoteSheet)
        .withContext('the sheet is closed rather than left confirmable')
        .toBeFalse();
      expect(b.componentInstance.placingOrder)
        .withContext('and the flight is given back').toBeFalse();
    });

    it('THE REGRESSION: the coordinator itself refuses every mutation for the '
       + 'held attempt', () => {
      const { key } = aReceives(UNSUPPORTED);
      const record = coordinator.record()!;

      expect(coordinator.isReplayableInitiation(record))
        .withContext('a held attempt is not replayable').toBeFalse();
      expect(coordinator.noteCommand({ orderId: 'o1', quoteRef: 'q1' }))
        .withContext('no acceptance may be recorded, so none may be issued')
        .toBeFalse();
      expect(coordinator.renewAfterClosure().kind)
        .withContext('and no successor may be minted from evidence this build '
                     + 'cannot read').not.toBe('ready');

      const reserved = coordinator.reserveIntent(
        { identity: basketService.contentIdentity(), canon: PURCHASE_CANON,
          items: [] },
        'r1:t1',
      );
      expect(reserved.kind)
        .withContext('the same purchase may not simply carry on').not
        .toBe('ready');
      expect(coordinator.record()!.key).toBe(key);
    });

    it('THE REGRESSION: a malformed row holds both mounts too', () => {
      const { a, b } = aReceives(MALFORMED);
      expect(a.componentInstance.closureUnresolved).toBeTrue();
      expect(b.componentInstance.closureUnresolved).toBeTrue();
      b.componentInstance.retryOrder();
      expect(http.match(() => true).length).toBe(0);
    });

    it('THE REGRESSION: and so does a same-attempt omission of a level this '
       + 'server already demonstrated', () => {
      // First response demonstrates `quote_protocol: 2` for this attempt.
      const a = makeComponent();
      a.componentInstance.initiateOrder();
      http.expectOne(INITIATE).flush(correctedInitiate());
      expect(coordinator.establishedQuoteProtocol())
        .withContext('the level is remembered for this attempt').toBe(2);

      // A second answer for the SAME attempt now says nothing about the
      // level. That is this server failing a promise, not an older one.
      a.componentInstance.retryOrder();
      const second = http.expectOne(INITIATE);
      second.flush(correctedInitiate('o1', 'q1', { quote_protocol: undefined }));

      const b = makeComponent();
      expect(a.componentInstance.closureUnresolved).toBeTrue();
      expect(b.componentInstance.closureUnresolved)
        .withContext('the omission is a shared fact, not a local message')
        .toBeTrue();
      b.componentInstance.retryOrder();
      expect(http.match(() => true).length).toBe(0);
    });
  });

  // == 2. a valid closure whose local write failed ========================

  describe('a valid closure this device could not write down', () => {
    it('THE PREMISE: the write really failed and nothing false was recorded',
       () => {
      const { key } = aReceives(CLOSURE, 'throws');
      const record = coordinator.record()!;
      expect(record.key).withContext('the original key is preserved').toBe(key);
      expect(record.command).toBeNull();
      expect(coordinator.closureOf(record).evidence.kind)
        .withContext('no durable closure — that is the whole situation')
        .toBe('absent');
      expect(usableClosure(coordinator.closureOf(record).evidence))
        .withContext('and certainly no FALSE durable closure').toBeNull();
    });

    it('THE PREMISE: the receiving mount blocks itself', () => {
      const { a } = aReceives(CLOSURE, 'throws');
      expect(a.componentInstance.closureUnresolved).toBeTrue();
      expect(a.componentInstance.checkoutBlocked).toBeTrue();
    });

    it('THE REGRESSION: the OTHER live mount reports the same hold', () => {
      const { b } = aReceives(CLOSURE, 'throws');
      expect(b.componentInstance.closureUnresolved).toBeTrue();
      expect(b.componentInstance.checkoutBlocked).toBeTrue();
    });

    it('THE REGRESSION: and B may not price, retry, confirm or renew', () => {
      const { b, key } = aReceives(CLOSURE, 'throws');
      attemptEveryMutation(b);
      expect(http.match(() => true).length)
        .withContext('a quote the server retired cannot be re-sent because '
                     + 'this device failed to write it down').toBe(0);
      expect(coordinator.record()!.key).toBe(key);
      expect(coordinator.record()!.replaces)
        .withContext('and no successor was minted from an unpersisted closure')
        .toBeNull();
    });

    it('THE REGRESSION: a silently dropped write holds both mounts as well',
       () => {
      const { a, b, key } = aReceives(CLOSURE, 'silently-drops');
      expect(a.componentInstance.closureUnresolved).toBeTrue();
      expect(b.componentInstance.closureUnresolved)
        .withContext('a store that accepts and keeps the previous value is '
                     + 'the realistic failure, and `persist` read-back is what '
                     + 'catches it').toBeTrue();
      attemptEveryMutation(b);
      expect(http.match(() => true).length).toBe(0);
      expect(coordinator.record()!.key).toBe(key);
    });
  });

  // == 3. mounting and unmounting ========================================

  describe('the hold does not belong to an instance', () => {
    it('THE REGRESSION: a component mounted AFTER the hold observes it', () => {
      const { a } = aReceives(UNSUPPORTED);
      expect(a.componentInstance.closureUnresolved).toBeTrue();

      const c = makeComponent();
      expect(c.componentInstance.closureUnresolved)
        .withContext('a fresh mount must not start clean while the attempt is '
                     + 'still held').toBeTrue();
      c.componentInstance.retryOrder();
      expect(http.match(() => true).length).toBe(0);
    });

    it('THE REGRESSION: destroying the receiver does not remove the '
       + 'protection', () => {
      const { a, key } = aReceives(CLOSURE, 'throws');
      a.destroy();

      const c = makeComponent();
      expect(c.componentInstance.closureUnresolved)
        .withContext('the observation outlives the instance that made it')
        .toBeTrue();
      attemptEveryMutation(c);
      expect(http.match(() => true).length).toBe(0);
      expect(coordinator.record()!.key).toBe(key);
    });
  });

  // == 4. the controls that must NOT be blocked ==========================

  describe('CONTROLS — nothing else is held', () => {
    it('an ordinary absence of `quote_closure` leaves both mounts free', () => {
      const { a, b } = aReceives(undefined);
      expect(a.componentInstance.closureUnresolved).toBeFalse();
      expect(b.componentInstance.closureUnresolved).toBeFalse();
      expect(a.componentInstance.showQuoteSheet)
        .withContext('and the ordinary review is offered').toBeTrue();

      b.componentInstance.initiateOrder();
      http.expectOne(INITIATE).flush(correctedInitiate());
      expect(b.componentInstance.showQuoteSheet).toBeTrue();
    });

    it('an older server that never promised to publish a closure leaves both '
       + 'mounts free', () => {
      const a = makeComponent();
      a.componentInstance.initiateOrder();
      // `quote_protocol` 1: below `REQUIRED_CLOSURE_PROTOCOL`, so silence
      // about a closure says NOTHING and must not read as a hold.
      http.expectOne(INITIATE).flush(legacyInitiate('o1', 'q1', {
        quote_protocol: 1,
      }));
      const b = makeComponent();

      expect(a.componentInstance.closureUnresolved).toBeFalse();
      expect(b.componentInstance.closureUnresolved).toBeFalse();
      b.componentInstance.retryOrder();
      // Nothing is held, so an ordinary Retry is free to act.
      const retried = http.match(INITIATE);
      expect(retried.length)
        .withContext('an unheld attempt may still be retried').toBe(1);
      retried[0].flush(legacyInitiate('o1', 'q1', { quote_protocol: 1 }));
    });

    it('a VALID closure that DOES persist keeps working, on both mounts',
       () => {
      const { a, b } = aReceives(CLOSURE);

      const record = coordinator.record()!;
      expect(coordinator.closureOf(record).evidence.kind)
        .withContext('durably recorded — the existing working path').toBe('closure');
      expect(a.componentInstance.updatedReviewPrompt)
        .withContext('the review action is offered').not.toBeNull();
      expect(b.componentInstance.updatedReviewPrompt)
        .withContext('to BOTH mounts, through storage, exactly as before')
        .not.toBeNull();
      expect(a.componentInstance.closureUnresolved)
        .withContext('a readable, recorded closure is not an unresolved one')
        .toBeFalse();
      expect(b.componentInstance.closureUnresolved).toBeFalse();
    });

    it('and the explicit review action on the SECOND mount still produces one '
       + 'successor', () => {
      const { a, b, key } = aReceives(CLOSURE);

      b.componentInstance.reviewUpdatedOrder();
      const successor = coordinator.record()!;
      expect(successor.key).not.toBe(key);
      expect(successor.replaces).toBe(key);

      // A tapping the same action afterwards is `superseded`, not a second
      // key — the one-successor rule, unchanged.
      a.componentInstance.reviewUpdatedOrder();
      expect(coordinator.record()!.key).toBe(successor.key);
      http.match(() => true).forEach((r) => r.flush(correctedInitiate('o2', 'q2')));
    });
  });

  // == 4b. the SUBMIT door asserts closures too ===========================

  describe('a closure that arrives on the acceptance refusal', () => {
    /**
     * Price and confirm on A, then answer the acceptance with `body`.
     *
     * `faultTheWrite` is armed AFTER the request is on the wire — so
     * `noteCommand`, which runs before the send, has already succeeded and the
     * failure lands on the CLOSURE write specifically. Arming it earlier
     * refuses the submission outright and exercises a different guard.
     *
     * FOUND BY THE BROWSER, NOT BY A SPEC. The first cut of I2-C shared the
     * hold from the initiation and recovery doors and left this one, because
     * `applyQuoteRefusal` downgrades a closure it cannot act on (or cannot
     * write down) to `unknown` — which blocks the mount that received it and
     * tells no one else. `recovery.mjs`'s I2-C scenario reported
     * `stage=accepting notices=0 mutatingButtons=1`.
     */
    function confirmAndRefuse(
      body: Record<string, unknown>,
      faultTheWrite: 'none' | 'silently-drops' = 'none',
    ) {
      const a = makeComponent();
      a.componentInstance.initiateOrder();
      http.expectOne(INITIATE).flush(correctedInitiate());
      const key = coordinator.record()!.key;
      a.componentInstance.confirmQuote();
      const submit = http.expectOne(SUBMIT);
      if (faultTheWrite === 'silently-drops') {
        spyOn(storage, 'setItem').and.stub();
      }
      submit.flush(body, { status: 400, statusText: 'Bad Request' });
      const b = makeComponent();
      return { a, b, key };
    }

    const refusal = (reason: string, over: Record<string, unknown> = {}) => ({
      status: 400, message: `refused: ${reason}`, reason, ...over,
    });

    it('THE REGRESSION: a valid closure whose write fails holds BOTH mounts',
       () => {
      const { a, b, key } = confirmAndRefuse(
        refusal('quote_expired', { quote_protocol: 2, quote_closure: CLOSURE }),
        'silently-drops');

      expect(coordinator.closureOf(coordinator.record()!).evidence.kind)
        .withContext('nothing durable was written — that is the situation')
        .toBe('absent');
      expect(a.componentInstance.closureUnresolved).toBeTrue();
      expect(b.componentInstance.closureUnresolved)
        .withContext('the mount that never saw the refusal').toBeTrue();
      attemptEveryMutation(b);
      expect(http.match(() => true).length).toBe(0);
      expect(coordinator.record()!.key).toBe(key);
    });

    it('THE REGRESSION: and a closure this build may not act on does too',
       () => {
      const { a, b } = confirmAndRefuse(refusal('quote_expired', {
        quote_protocol: 2,
        quote_closure: { ...CLOSURE, policy_version: 99 },
      }));

      expect(a.componentInstance.closureUnresolved).toBeTrue();
      expect(b.componentInstance.closureUnresolved).toBeTrue();
      b.componentInstance.retryOrder();
      expect(http.match(() => true).length)
        .withContext('a Retry the server would refuse identically is not an '
                     + 'offer either mount may make').toBe(0);
    });

    it('CONTROL: a refusal carrying NO closure is genuine uncertainty, and '
       + 'BOTH mounts may still retry', () => {
      // The discriminating half. `applyQuoteRefusal` downgrades an
      // unrecognised reason to `unknown` as well, and that one must stay a
      // real Retry — nothing was asserted about the quote, so nothing is held.
      const { a, b } = confirmAndRefuse(refusal('something_unrecognised'));

      expect(a.componentInstance.closureUnresolved)
        .withContext('no closure was asserted').toBeFalse();
      expect(b.componentInstance.closureUnresolved).toBeFalse();
      // The Retry is offered by `orderError`, which is the established
      // answer for a placement failure — not by `checkoutBlocked`, and not by
      // a hold. Asserted because it is what makes the next step possible.
      expect(a.componentInstance.orderError)
        .withContext('an ordinary placement failure, reported as one')
        .toBeTrue();

      b.componentInstance.retryOrder();
      const retried = http.match(() => true);
      expect(retried.length)
        .withContext('an unresolved acceptance is resolved by asking, which '
                     + 'is exactly what a hold must not prevent').toBe(1);
      retried[0].flush({ status: 200, data: { id: 'o1' } });
    });

    it('CONTROL: an ordinary reprice refusal is untouched', () => {
      const { a, b } = confirmAndRefuse(refusal('quote_ref_stale'));
      expect(a.componentInstance.closureUnresolved).toBeFalse();
      expect(b.componentInstance.closureUnresolved).toBeFalse();
      // The reprice is the established behaviour and still happens.
      const repriced = http.match(INITIATE);
      expect(repriced.length).toBe(1);
      repriced[0].flush(correctedInitiate());
    });
  });

  // == 4c. the RECOVERY door asserts closures too =========================

  describe('a closure that arrives on the authorized read', () => {
    it('THE REGRESSION: a routed mount that recovers unusable evidence holds '
       + 'the sidebar too', () => {
      // ONLY THE ROUTED PAGE RUNS A RECOVERY — the sidebar never does — so
      // without sharing, the mount that ASKED would be the only one that
      // knew. That is the same defect as the initiation door, reached through
      // the other producer of `closure-unreadable`.
      const priced = makeComponent();
      priced.componentInstance.initiateOrder();
      http.expectOne(INITIATE).flush(correctedInitiate());
      const key = coordinator.record()!.key;
      priced.destroy();

      const routed = makeComponent(false);
      routed.detectChanges();
      http.expectOne(intentRead(key)).flush(readAnswer(key, {
        quote_closure: { ...CLOSURE, policy_version: 99 },
      }));
      expect(routed.componentInstance.closureUnresolved)
        .withContext('the mount that asked').toBeTrue();

      const sidebar = makeComponent();
      expect(sidebar.componentInstance.closureUnresolved)
        .withContext('and the one that never could have').toBeTrue();
      attemptEveryMutation(sidebar);
      expect(http.match(() => true).length).toBe(0);
      expect(coordinator.record()!.key).toBe(key);
    });

    it('THE REGRESSION: a VALID closure the recovery cannot write down holds '
       + 'the sidebar too', () => {
      // CODEX P2 ON #678, VALID — and the same defect class as the three doors
      // this change already covers, at the fourth. `shareUnusableEvidence`
      // gated on `closure-unreadable`, so a recovery that resolved a
      // PERFECTLY VALID closure and then failed to persist it set
      // `{kind: 'unknown'}` on ONE component and shared nothing. The record
      // stays a commandless `reviewing` with no closure, which is exactly what
      // an ordinary reviewable attempt looks like — so the other mount
      // re-initiates a permanently retired quote.
      const priced = makeComponent();
      priced.componentInstance.initiateOrder();
      http.expectOne(INITIATE).flush(correctedInitiate());
      const key = coordinator.record()!.key;
      priced.destroy();

      const routed = makeComponent(false);
      routed.detectChanges();
      // The fault is armed AFTER the read is issued, so it lands on the
      // CLOSURE write specifically and not on anything earlier.
      const read = http.expectOne(intentRead(key));
      spyOn(storage, 'setItem').and.stub();
      read.flush(readAnswer(key, { quote_closure: CLOSURE }));

      expect(coordinator.closureOf(coordinator.record()!).evidence.kind)
        .withContext('the write really failed').toBe('absent');
      expect(routed.componentInstance.closureUnresolved)
        .withContext('the mount that recovered it').toBeTrue();

      const sidebar = makeComponent();
      expect(sidebar.componentInstance.closureUnresolved)
        .withContext('and the one that never ran a recovery').toBeTrue();
      attemptEveryMutation(sidebar);
      expect(http.match(() => true).length)
        .withContext('a retired quote is not re-initiated because this device '
                     + 'could not write the closure down').toBe(0);
      expect(coordinator.record()!.key).toBe(key);
    });

    it('THE REGRESSION: and it says which situation it is, not "we could not '
       + 'confirm"', () => {
      // `unknown` claims the outcome is undetermined. It is not: the server
      // stated the quote is retired and this device failed to record it, which
      // is the `closure-unrecorded` fact the initiation door already reports.
      const priced = makeComponent();
      priced.componentInstance.initiateOrder();
      http.expectOne(INITIATE).flush(correctedInitiate());
      const key = coordinator.record()!.key;
      priced.destroy();

      const routed = makeComponent(false);
      routed.detectChanges();
      const read = http.expectOne(intentRead(key));
      spyOn(storage, 'setItem').and.stub();
      read.flush(readAnswer(key, { quote_closure: CLOSURE }));

      const notice = routed.componentInstance.recoveryNotice ?? '';
      expect(notice.toLowerCase())
        .withContext('the local failure, named').toContain('could not save');
      expect(notice.toLowerCase())
        .withContext('and the remedy that works').toContain('reload');
    });

    it('THE REGRESSION: the RETRY recovery sink shares it as well', () => {
      // The second sink. A lost acceptance leaves an outstanding command, so
      // Retry replays it through a recovery read — the same `closed` outcome
      // and the same failed write, down a different path.
      const a = makeComponent();
      a.componentInstance.initiateOrder();
      http.expectOne(INITIATE).flush(correctedInitiate());
      const key = coordinator.record()!.key;
      a.componentInstance.confirmQuote();
      http.expectOne(SUBMIT)
        .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown' });
      expect(coordinator.isOutstanding(coordinator.record()!))
        .withContext('an acceptance is outstanding, so Retry recovers')
        .toBeTrue();

      a.componentInstance.retryOrder();
      const read = http.expectOne(intentRead(key));
      spyOn(storage, 'setItem').and.stub();
      read.flush(readAnswer(key, { quote_closure: CLOSURE }));

      const sidebar = makeComponent();
      expect(a.componentInstance.closureUnresolved)
        .withContext('the mount that retried').toBeTrue();
      expect(sidebar.componentInstance.closureUnresolved)
        .withContext('and the mount that did not').toBeTrue();
      attemptEveryMutation(sidebar);
      expect(http.match(() => true).length).toBe(0);
    });

    it('CONTROL: a recovered closure that DOES persist is the working path',
       () => {
      const priced = makeComponent();
      priced.componentInstance.initiateOrder();
      http.expectOne(INITIATE).flush(correctedInitiate());
      const key = coordinator.record()!.key;
      priced.destroy();

      const routed = makeComponent(false);
      routed.detectChanges();
      http.expectOne(intentRead(key))
        .flush(readAnswer(key, { quote_closure: CLOSURE }));

      expect(coordinator.closureOf(coordinator.record()!).evidence.kind)
        .toBe('closure');
      const sidebar = makeComponent();
      expect(routed.componentInstance.closureUnresolved)
        .withContext('a recorded closure is not an unresolved one').toBeFalse();
      expect(sidebar.componentInstance.closureUnresolved).toBeFalse();
      expect(sidebar.componentInstance.updatedReviewPrompt)
        .withContext('and BOTH mounts are offered the review').not.toBeNull();
    });

    it('CONTROL: an ordinary draft read holds nothing', () => {
      const priced = makeComponent();
      priced.componentInstance.initiateOrder();
      http.expectOne(INITIATE).flush(correctedInitiate());
      const key = coordinator.record()!.key;
      priced.destroy();

      const routed = makeComponent(false);
      routed.detectChanges();
      http.expectOne(intentRead(key)).flush(readAnswer(key));

      const sidebar = makeComponent();
      expect(routed.componentInstance.closureUnresolved).toBeFalse();
      expect(sidebar.componentInstance.closureUnresolved)
        .withContext('no closure was asserted, so nothing is held').toBeFalse();
    });
  });

  // == 5. a cart edit is not a way out ===================================

  describe('what does NOT release a hold', () => {
    it('THE REGRESSION: changing the basket does not mint a second key around '
       + 'the hold', () => {
      const { key } = aReceives(UNSUPPORTED);

      // The diner edits the basket and presses Checkout. The record still
      // says `pricing`, the cart is now a different purchase, and a mount
      // that never saw the answer has no local error — the three things that
      // must NOT, separately or together, license a replacement key. The
      // held attempt may be bound to an order the server retired, and minting
      // here would abandon the observation without resolving it.
      basket.items = [
        { ...line(), itemId: 'i2', itemName: 'Chips' } as BasketItem,
      ];
      const c = makeComponent();
      c.componentInstance.initiateOrder();

      expect(http.match(() => true).length)
        .withContext('nothing is sent for the new basket either').toBe(0);
      expect(coordinator.record()!.key)
        .withContext('and the held attempt is still the one on record')
        .toBe(key);
    });

    it('and the coordinator says so in its own words', () => {
      aReceives(UNSUPPORTED);
      basket.items = [
        { ...line(), itemId: 'i2', itemName: 'Chips' } as BasketItem,
      ];
      const reserved = coordinator.reserveIntent(
        { identity: basketService.contentIdentity(), canon: PURCHASE_CANON,
          items: [] },
        'r1:t1',
      );
      expect(reserved.kind)
        .withContext('`held` — not `ready`, and not `blocked` either: the '
                     + 'record is perfectly readable and nothing was issued')
        .toBe('held');
    });
  });

  // == 6. the durable resolution, and the successor it permits ============

  describe('an authorized read resolves what the failed write could not', () => {
    /**
     * The documented recovery, end to end: the server retired the quote, this
     * device could not write it down, storage then recovers, and the diner's
     * OWN scoped read establishes the same closure durably.
     *
     * `recover()` is a GET. It is deliberately outside every gate above —
     * reading cannot duplicate anything, and a hold whose only exit was a
     * mutation would be a dead end.
     */
    function resolveThroughTheRead(key: string) {
      const c = makeComponent(false);   // a routed mount runs the resume
      c.detectChanges();
      http.expectOne(intentRead(key)).flush(readAnswer(key, {
        quote_closure: CLOSURE,
      }));
      return c;
    }

    it('THE REGRESSION: the read establishes the closure and BOTH mounts '
       + 'update', () => {
      const { a, b, key } = aReceives(CLOSURE, 'silently-drops');
      expect(a.componentInstance.closureUnresolved).toBeTrue();
      expect(b.componentInstance.closureUnresolved).toBeTrue();

      // Storage recovers — the fault was in the store, not in the record.
      (storage.setItem as jasmine.Spy).and.callThrough();
      const c = resolveThroughTheRead(key);

      expect(coordinator.closureOf(coordinator.record()!).evidence.kind)
        .withContext('durably established at last').toBe('closure');
      expect(c.componentInstance.closureUnresolved)
        .withContext('the reader is no longer held').toBeFalse();
      expect(a.componentInstance.closureUnresolved)
        .withContext('AND the mount that made the observation is released by '
                     + 'the newer established fact — a local result must not '
                     + 'mask a shared resolution').toBeFalse();
      expect(b.componentInstance.closureUnresolved).toBeFalse();
      expect(b.componentInstance.updatedReviewPrompt)
        .withContext('and the review action is offered instead').not.toBeNull();
    });

    it('THE REGRESSION: and only THEN does the explicit review action produce '
       + 'one successor', () => {
      const { a, b, key } = aReceives(CLOSURE, 'silently-drops');

      // Held: the action is refused and nothing is minted.
      b.componentInstance.reviewUpdatedOrder();
      expect(coordinator.record()!.key)
        .withContext('no successor from a closure nothing recorded').toBe(key);
      expect(http.match(() => true).length).toBe(0);

      (storage.setItem as jasmine.Spy).and.callThrough();
      resolveThroughTheRead(key);

      b.componentInstance.reviewUpdatedOrder();
      const successor = coordinator.record()!;
      expect(successor.key).not.toBe(key);
      expect(successor.replaces).toBe(key);

      // A stale hold for K1 cannot answer for the K2 that replaced it.
      expect(a.componentInstance.closureUnresolved)
        .withContext('the observation was about the retired attempt').toBeFalse();
      const c = makeComponent();
      expect(c.componentInstance.closureUnresolved).toBeFalse();
      http.match(() => true).forEach(
        (r) => r.flush(correctedInitiate('o2', 'q2')));
    });

    it('THE CONTROL: a read taken BEFORE the retirement cannot reopen a quote '
       + 'since established as closed', () => {
      // The stale-read schedule, built rather than contrived: the resume
      // short-circuits on a RESTORED closure, so the only way a read that
      // says "no closure" can land after one is established is for it to have
      // been issued before — which is exactly the case worth protecting.
      const { key } = aReceives(CLOSURE, 'silently-drops');

      // C resumes while nothing is recorded, and its read is held open.
      const c = makeComponent(false);
      c.detectChanges();
      const stale = http.expectOne(intentRead(key));

      // Storage recovers and ANOTHER mount's read establishes the closure.
      (storage.setItem as jasmine.Spy).and.callThrough();
      const d = makeComponent(false);
      d.detectChanges();
      http.expectOne(intentRead(key)).flush(readAnswer(key, {
        quote_closure: CLOSURE,
      }));
      expect(coordinator.closureOf(coordinator.record()!).evidence.kind)
        .withContext('durably established').toBe('closure');

      // Only now does C's older answer land, from a snapshot taken before
      // the retirement. It names the order and says the quote is open.
      stale.flush(readAnswer(key));

      expect(coordinator.closureOf(coordinator.record()!).evidence.kind)
        .withContext('a read that says nothing about a closure is not '
                     + 'evidence that there is none').toBe('closure');
      expect(d.componentInstance.updatedReviewPrompt)
        .withContext('and the review action is still the offer').not.toBeNull();
      expect(coordinator.record()!.key)
        .withContext('with no successor minted behind anyone`s back').toBe(key);
    });
  });

  // == 7. the ordinary paths keep working ================================

  describe('CONTROLS — nothing unheld is affected', () => {
    it('an ordinary initiation prices, reviews and accepts', () => {
      const a = makeComponent();
      a.componentInstance.initiateOrder();
      http.expectOne(INITIATE).flush(correctedInitiate());
      expect(a.componentInstance.showQuoteSheet).toBeTrue();

      a.componentInstance.confirmQuote();
      const submit = http.expectOne(SUBMIT);
      expect(coordinator.record()!.command)
        .withContext('the command is recorded before it is sent')
        .toEqual({ orderId: 'o1', quoteRef: 'q1' });
      submit.flush({
        status: 200, message: 'Order placed.', idempotent: false,
        checkout: {
          order_id: 'o1', intent_key: coordinator.record()?.key ?? 'k',
          scope: { restaurant: 'r1', table: 't1' },
          acceptance: { state: 'accepted', outcome: 'newly_accepted',
                        quote_ref: 'q1',
                        accepted_at: '2026-09-20T10:00:00Z' },
          current: { order_status: 'pending', fulfilment_status: 'new',
                     cancelled_at: null, served_at: null },
          checkout_protocol: 3,
        },
      });
      expect(basketService.clearBasket)
        .withContext('a confirmed acceptance still completes').toHaveBeenCalled();
    });

    it('a genuine network failure still offers a real Retry', () => {
      const a = makeComponent();
      a.componentInstance.initiateOrder();
      http.expectOne(INITIATE)
        .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown' });

      const b = makeComponent();
      expect(a.componentInstance.closureUnresolved)
        .withContext('no closure was asserted, so nothing is held').toBeFalse();
      expect(b.componentInstance.closureUnresolved).toBeFalse();

      b.componentInstance.retryOrder();
      const retried = http.match(INITIATE);
      expect(retried.length)
        .withContext('uncertainty is not a hold — that distinction is the '
                     + 'whole of D04`s not-found rule').toBe(1);
      retried[0].flush(correctedInitiate());
    });
  });
});
