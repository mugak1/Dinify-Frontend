/**
 * I2-C (lifecycle) — AN OBSERVATION'S REGISTRATION, APPLICATION AND RETIREMENT.
 *
 * #679 made the contradiction a SHARED observation and gave it an exit. What
 * it did not do is make that exit reachable from every state the lifecycle
 * can actually be in, and the three gaps below are each one end of it.
 *
 * L1 — THE CACHED SHORTCUT PREVENTS THE READ THAT WOULD RESOLVE.
 * `resumeInterruptedCheckout()` returns early on a usable persisted closure,
 * BEFORE it consults the observation or issues the authorized GET. The
 * ordering rule #679 added makes "a closure is stored AND a contradiction is
 * unresolved" a legitimate state — a coherent read that began before the
 * contradiction persists its closure and is correctly refused the release. A
 * consumer mounted after that takes the shortcut, issues no read, and can
 * never obtain the later coherent answer the release requires. The mutation
 * gates correctly refuse it, so they must not become the way out.
 *
 * L2 — SHARED RESOLUTION DOES NOT REACH THE COMPONENT THAT OBSERVED.
 * `closureUnresolvable()` returns true unconditionally on this instance's own
 * `recovered.kind === 'inconsistent'`, and `staleLocalClosureResult()` covers
 * only the two ordinary kinds. So a later authorized read can legitimately
 * clear the shared hold and establish the closure while the mount that made
 * the observation goes on claiming it — and that survives a legitimate
 * successor, leaving one component blocking a purchase it has no fact about.
 *
 * L3 — A COMPLETED ATTEMPT'S OBSERVATION OCCUPIES THE SLOT.
 * The coherent accepted branch finishes through `finishAcceptedCheckout()` and
 * `clearIntent()`, neither of which touches `_closureHold`. `unresolvedClosure`
 * then correctly reports nothing for the next attempt — but `holdClosure`
 * compares the incoming hold against the RAW slot, so #679's contradiction
 * priority rejects the NEXT attempt's ordinary hold on the strength of a
 * contradiction about an attempt that is over. The next purchase is then
 * unprotected in exactly the situation the hold exists for.
 *
 * WHAT THESE SPECS DRIVE. Real `BasketBodyComponent` instances over ONE real
 * `CheckoutCoordinatorService`, real session storage, the real `ApiService`,
 * the real `HttpClient` and the real `ErrorInterceptor` — the same harness the
 * H1/H2 specs use. Both consumers are inspected after every resolution, never
 * the coordinator alone, because "the shared hold is null" is exactly the
 * state in which the component-local claims were found to disagree with it.
 *
 * THE CONTROLS ARE THE OTHER HALF. An ordinary settled cached closure must
 * still need no read; an unsupported stored closure must stay protected; a
 * still-current contradiction must still refuse an ordinary downgrade and a
 * stale foreign-attempt update; a stale answer must still be refused the
 * release; and nothing here may retire an observation on the strength of a
 * removal that was merely attempted.
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
import { CheckoutCoordinatorService }
  from '../../../_services/checkout-coordinator.service';
import { reviewQuote } from '../../../_shared/order/quote-review';
import { ErrorInterceptor } from '../../../_helpers/error.interceptor';
import { ToastService } from '../../../_shared/ui/toast/toast.service';
import { ConfirmDialogService } from '../../../_common/confirm-dialog.service';
import { ConnectivityService } from '../../../_services/connectivity.service';
import { BasketItem } from '../../../_models/app.models';
import { BasketBodyComponent } from './basket-body.component';
import { correctedInitiate } from './corrected-quote.fixture';

const UNRESOLVED_CLOSURE_MESSAGE =
  'We could not confirm the status of this order. Please check with staff '
  + 'before ordering the same items again.';

describe('BasketBodyComponent — the observation lifecycle (D06/I2-C)', () => {
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

  /** A closure this build CAN act on — valid, supported, naming this quote. */
  const closureFor = (ref: string) => ({
    closed_at: '2026-09-20T10:00:00Z',
    reason: 'quote_expired',
    quote_ref: ref,
    policy_version: 1,
  });

  /** A REAL closure written under a policy this build has never seen. It is
   *  `unsupported` — an assertion the server made and this build may not act
   *  on — which is what produces a `closure-unreadable` outcome. */
  const unsupportedClosureFor = (ref: string) => ({
    ...closureFor(ref), policy_version: 99,
  });

  const readAnswer = (
    key: string, order: string, ref: string, over: Record<string, unknown> = {},
  ) => ({
    status: 200,
    message: 'Successfully retrieved the order details',
    data: {
      id: order, quote_ref: ref, actual_cost: '6000.00',
      quote_total: '6000.00', quote_complete: true, order_status: 'initiated',
      checkout_protocol: 3, quote_protocol: 2, quote_closure: null,
      accepted: false, accepted_at: null,
      checkout: {
        order_id: order, intent_key: key,
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

  /** ACCEPTED AND RETIRED in one payload — the contradiction. */
  const contradictoryAnswer = (key: string) =>
    readAnswer(key, 'o1', 'q1', {
      order_status: 'pending', accepted: true,
      accepted_at: '2026-09-20T10:00:00Z',
      quote_closure: closureFor('q1'),
      checkout: {
        order_id: 'o1', intent_key: key,
        scope: { restaurant: 'r1', table: 't1' },
        acceptance: { state: 'accepted', outcome: 'newly_accepted',
                      quote_ref: 'q1', accepted_at: '2026-09-20T10:00:00Z' },
        current: { order_status: 'pending', fulfilment_status: 'new',
                   cancelled_at: null, served_at: null },
        checkout_protocol: 3,
      },
    });

  /** COHERENT AND ACCEPTED: the order landed, and nothing claims its quote
   *  was retired. This is the answer a contradiction's acceptance half turns
   *  out to have been true about. */
  const acceptedAnswer = (key: string) =>
    readAnswer(key, 'o1', 'q1', {
      order_status: 'pending', accepted: true,
      accepted_at: '2026-09-20T10:00:00Z',
      checkout: {
        order_id: 'o1', intent_key: key,
        scope: { restaurant: 'r1', table: 't1' },
        acceptance: { state: 'accepted', outcome: 'newly_accepted',
                      quote_ref: 'q1', accepted_at: '2026-09-20T10:00:00Z' },
        current: { order_status: 'pending', fulfilment_status: 'new',
                   cancelled_at: null, served_at: null },
        checkout_protocol: 3,
      },
    });

  function makeComponent(sidebar = true): ComponentFixture<BasketBodyComponent> {
    const fixture = TestBed.createComponent(BasketBodyComponent);
    fixture.componentInstance.sidebar = sidebar;
    return fixture;
  }

  const intentRead = () => (r: { url: string }) =>
    r.url.startsWith(`${V1}/orders/journey/order-details/`)
      && r.url.includes('intent=');

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

  // -- shared schedule pieces -------------------------------------------

  /** K1/O1/Q1 priced and reviewable. THE PREMISE is asserted once here: the
   *  unmodified fixture is an ordinarily confirmable, ITEMISED quote, so every
   *  refusal below is attributable to the fault under test. */
  function aPricedAttempt(order = 'o1', ref = 'q1') {
    const a = makeComponent();
    a.componentInstance.initiateOrder();
    const control = reviewQuote(correctedInitiate(order, ref).data as any);
    expect(control.readable).withContext('readable quote').toBeTrue();
    expect(control.itemised).withContext('ITEMISED quote').toBeTrue();
    http.expectOne(INITIATE).flush(correctedInitiate(order, ref));
    return { a, key: coordinator.record()!.key };
  }

  /** The realistic failing store: it accepts the write, throws nothing and
   *  keeps the previous value. `persist`'s read-back is what catches it. */
  function faultTheWrite(): void {
    spyOn(storage, 'setItem').and.stub();
  }

  /**
   * L1's premise, and #679's own ordering rule reached through real reads: a
   * coherent closed answer whose read BEGAN before the contradiction persists
   * its closure and is refused the release. The result is the legitimate
   * conservative state a closure exists locally AND the contradiction stands.
   */
  function aStoredClosureBesideALiveContradiction(key: string) {
    // D's coherent read is issued FIRST and held.
    const d = makeComponent(false);
    d.detectChanges();
    const dRead = http.expectOne(intentRead());

    // The contradiction is observed while it is open.
    const c = makeComponent(false);
    c.detectChanges();
    http.expectOne(intentRead()).flush(contradictoryAnswer(key));
    expect(coordinator.unresolvedClosure()!.kind)
      .withContext('the contradiction is established')
      .toBe('contradictory-evidence');

    // D's OLDER answer lands last: its closure is written, its release is not.
    dRead.flush(readAnswer(key, 'o1', 'q1', { quote_closure: closureFor('q1') }));

    expect(coordinator.closureOf(coordinator.record()!).evidence.kind)
      .withContext('THE PREMISE: the closure IS stored').toBe('closure');
    expect(coordinator.unresolvedClosure())
      .withContext('THE PREMISE: and the contradiction is STILL unresolved')
      .not.toBeNull();
    return { c, d };
  }

  // == L1. the cached shortcut ===========================================

  describe('L1 — cached restoration when an observation is unresolved', () => {
    it('THE REGRESSION: a consumer mounted afterwards issues a REAL read '
       + 'rather than restoring the cached closure', () => {
      const { key } = aPricedAttempt();
      aStoredClosureBesideALiveContradiction(key);

      // The next routed consumer. On the cached shortcut it asks nothing,
      // which is the one thing that can never resolve the situation.
      const e = makeComponent(false);
      e.detectChanges();

      const reads = http.match(intentRead());
      expect(reads.length)
        .withContext('the resolving read is issued despite the cached closure')
        .toBe(1);

      // AND NOT BY MUTATING. The gates refuse the attempt, and they must not
      // become the escape hatch from it.
      http.expectNone(SUBMIT);
      http.expectNone(INITIATE);

      // Answering it coherently resolves the observation it legitimately owns.
      reads[0].flush(
        readAnswer(key, 'o1', 'q1', { quote_closure: closureFor('q1') }));
      expect(coordinator.unresolvedClosure())
        .withContext('the contradiction is resolved by an answer that owns it')
        .toBeNull();
    });

    it('THE REGRESSION: and the closure is neither erased nor turned into a '
       + 'successor by the read', () => {
      const { key } = aPricedAttempt();
      aStoredClosureBesideALiveContradiction(key);
      const before = coordinator.record()!.key;

      const e = makeComponent(false);
      e.detectChanges();
      http.match(intentRead()).forEach((r) => r.flush(
        readAnswer(key, 'o1', 'q1', { quote_closure: closureFor('q1') })));

      expect(coordinator.record()!.key)
        .withContext('the attempt is not dropped').toBe(before);
      expect(coordinator.closureOf(coordinator.record()!).evidence.kind)
        .withContext('the closure still stands').toBe('closure');
      expect(http.match(() => true).length)
        .withContext('and no successor was minted on a page load').toBe(0);
    });

    it('CONTROL: an ordinary settled cached closure still needs NO read', () => {
      const { key } = aPricedAttempt();
      expect(coordinator.noteClosure({
        closedAt: closureFor('q1').closed_at, reason: 'quote_expired',
        quoteRef: 'q1', policyVersion: 1,
      } as any)).withContext('the closure is established').toBeTrue();
      expect(coordinator.unresolvedClosure())
        .withContext('and nothing is unresolved').toBeNull();
      expect(key).toBeTruthy();

      const e = makeComponent(false);
      e.detectChanges();

      http.expectNone(intentRead());
      expect(e.componentInstance.recovered?.kind)
        .withContext('it is restored from the record, as before').toBe('closed');
    });

    it('CONTROL: an UNSUPPORTED stored closure stays protected and still '
       + 'blocks', () => {
      aPricedAttempt();
      const e = makeComponent(false);
      e.detectChanges();
      http.expectOne(intentRead()).flush(readAnswer(
        coordinator.record()!.key, 'o1', 'q1',
        { quote_closure: unsupportedClosureFor('q1') }));

      expect(e.componentInstance.checkoutBlocked)
        .withContext('an assertion this build may not act on blocks')
        .toBeTrue();
      expect(coordinator.unresolvedClosure()!.kind).toBe('unusable-evidence');
    });
  });

  // == L2. the component that observed ===================================

  describe('L2 — shared resolution and the original consumer', () => {
    /** A observes the contradiction; B is another live consumer. */
    function aContradictionObservedBy() {
      const { key } = aPricedAttempt();
      const a = makeComponent(false);
      a.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));
      const b = makeComponent();
      b.detectChanges();

      expect(a.componentInstance.recovered!.kind)
        .withContext('THE PREMISE: A made the observation').toBe('inconsistent');
      expect(a.componentInstance.closureUnresolved)
        .withContext('THE PREMISE: and A blocks on it').toBeTrue();
      expect(b.componentInstance.closureUnresolved)
        .withContext('THE PREMISE: as does the other consumer').toBeTrue();
      return { a, b, key };
    }

    /** A later authorized read, issued AFTER the contradiction, coherent. */
    function resolvedByALaterRead(key: string) {
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead())
        .flush(readAnswer(key, 'o1', 'q1', { quote_closure: closureFor('q1') }));
      expect(coordinator.unresolvedClosure())
        .withContext('the shared observation is legitimately resolved')
        .toBeNull();
      return c;
    }

    it('THE REGRESSION: the consumer that OBSERVED stops claiming it once it '
       + 'is resolved', () => {
      const { a, b, key } = aContradictionObservedBy();
      resolvedByALaterRead(key);

      expect(a.componentInstance.closureUnresolved)
        .withContext('A stops blocking on a situation that is resolved')
        .toBeFalse();
      expect(b.componentInstance.closureUnresolved)
        .withContext('and so does the consumer that never observed it')
        .toBeFalse();
    });

    it('THE REGRESSION: and it stops SAYING it — the unresolved sentence is '
       + 'withdrawn from both consumers', () => {
      const { a, b, key } = aContradictionObservedBy();
      resolvedByALaterRead(key);

      expect(a.componentInstance.recoveryNotice)
        .withContext('A no longer points the diner at staff')
        .not.toBe(UNRESOLVED_CLOSURE_MESSAGE);
      expect(b.componentInstance.recoveryNotice)
        .not.toBe(UNRESOLVED_CLOSURE_MESSAGE);
    });

    it('THE REGRESSION: the observing consumer can take the ordinary review '
       + 'action itself', () => {
      const { a, key } = aContradictionObservedBy();
      resolvedByALaterRead(key);

      // ONE deliberate successor, from the component that had been stuck.
      a.componentInstance.reviewUpdatedOrder();
      const successor = coordinator.record();
      expect(successor)
        .withContext('a successor attempt exists').not.toBeNull();
      expect(successor!.key)
        .withContext('under a NEW key').not.toBe(key);
      expect(successor!.replaces)
        .withContext('linked to the attempt it replaces').toBe(key);
      // It prices under that new key, and exactly once.
      http.expectOne(INITIATE).flush(correctedInitiate('o2', 'q2'));
    });

    it('THE REGRESSION: a legitimate successor created by the OTHER consumer '
       + 'is not blocked by the stale observation', () => {
      const { a, b, key } = aContradictionObservedBy();
      resolvedByALaterRead(key);

      b.componentInstance.reviewUpdatedOrder();
      const k2 = coordinator.record()!.key;
      expect(k2).withContext('B minted the successor').not.toBe(key);
      http.expectOne(INITIATE).flush(correctedInitiate('o2', 'q2'));

      expect(a.componentInstance.checkoutBlocked)
        .withContext('A does not withhold Checkout for K2 either').toBeFalse();
      expect(a.componentInstance.closureUnresolved)
        .withContext('A does not block K2 with its K1 observation').toBeFalse();
      expect(b.componentInstance.closureUnresolved).toBeFalse();
      expect(coordinator.unresolvedClosure())
        .withContext('and nothing is held against the successor').toBeNull();
    });

    it('CONTROL: an UNRESOLVED contradiction still blocks both consumers, and '
       + 'no absence of a hold is mistaken for resolution', () => {
      const { a, b } = aContradictionObservedBy();

      expect(coordinator.unresolvedClosure())
        .withContext('nothing resolved it').not.toBeNull();
      expect(a.componentInstance.checkoutBlocked).toBeTrue();
      expect(b.componentInstance.checkoutBlocked).toBeTrue();
      expect(a.componentInstance.recoveryNotice)
        .toBe(UNRESOLVED_CLOSURE_MESSAGE);
    });

    it('CONTROL: a STALE coherent answer does not resolve the observing '
       + 'consumer either', () => {
      const { key } = aPricedAttempt();
      const { c } = aStoredClosureBesideALiveContradiction(key);

      expect(c.componentInstance.closureUnresolved)
        .withContext('the observing mount still blocks: nothing resolved it')
        .toBeTrue();
      expect(coordinator.unresolvedClosure()).not.toBeNull();
    });
  });

  // == L3. the next attempt ==============================================

  describe('L3 — a completed attempt and the next one', () => {
    /**
     * K1 observes a contradiction, then a later coherent read establishes the
     * acceptance half as true. The outcome is recorded durably and ordinary
     * targeted cleanup completes — which is what leaves the slot naming an
     * attempt that is over.
     */
    function k1ContradictedThenLegitimatelyAccepted() {
      const { key } = aPricedAttempt();
      const a = makeComponent(false);
      a.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));
      expect(coordinator.unresolvedClosure()!.kind)
        .withContext('THE PREMISE: K1 is contradicted')
        .toBe('contradictory-evidence');

      const b = makeComponent(false);
      b.detectChanges();
      http.expectOne(intentRead()).flush(acceptedAnswer(key));

      expect(coordinator.record())
        .withContext('THE PREMISE: K1 completed and tidied up').toBeNull();
      return { a, b, k1: key };
    }

    /** A legitimate next purchase. Cart and table are unchanged, so the KEY
     *  is the only thing that distinguishes it from K1. */
    function aNextPurchase() {
      const n = makeComponent();
      n.componentInstance.initiateOrder();
      http.expectOne(INITIATE).flush(correctedInitiate('o2', 'q2'));
      return { n, k2: coordinator.record()!.key };
    }

    it('THE REGRESSION: K2`s own unusable-evidence hold is registered and '
       + 'enforced', () => {
      const { k1 } = k1ContradictedThenLegitimatelyAccepted();
      const { k2 } = aNextPurchase();
      expect(k2).withContext('a genuinely different attempt').not.toBe(k1);

      const e = makeComponent(false);
      e.detectChanges();
      http.expectOne(intentRead()).flush(readAnswer(
        k2, 'o2', 'q2', { quote_closure: unsupportedClosureFor('q2') }));

      const held = coordinator.unresolvedClosure();
      expect(held)
        .withContext('K2`s own observation is registered').not.toBeNull();
      expect(held!.attempt.key)
        .withContext('and it names K2, not the attempt that is over').toBe(k2);
      expect(held!.kind).toBe('unusable-evidence');
    });

    it('THE REGRESSION: so every K2 mutation is refused, at the shared '
       + 'boundary', () => {
      k1ContradictedThenLegitimatelyAccepted();
      const { k2 } = aNextPurchase();
      const e = makeComponent(false);
      e.detectChanges();
      http.expectOne(intentRead()).flush(readAnswer(
        k2, 'o2', 'q2', { quote_closure: unsupportedClosureFor('q2') }));

      const record = coordinator.record()!;
      expect(coordinator.reserveIntent(record.request, record.scope).kind)
        .withContext('a fresh checkout is refused').toBe('held');
      expect(coordinator.noteCommand({ orderId: 'o2', quoteRef: 'q2' }))
        .withContext('and an acceptance may not be issued').toBeFalse();
      expect(coordinator.renewAfterClosure().kind)
        .withContext('and no successor is minted').not.toBe('ready');
    });

    it('THE REGRESSION: and BOTH K2 consumers see it', () => {
      k1ContradictedThenLegitimatelyAccepted();
      const { n, k2 } = aNextPurchase();
      const e = makeComponent(false);
      e.detectChanges();
      http.expectOne(intentRead()).flush(readAnswer(
        k2, 'o2', 'q2', { quote_closure: unsupportedClosureFor('q2') }));

      expect(e.componentInstance.closureUnresolved)
        .withContext('the consumer that observed').toBeTrue();
      expect(n.componentInstance.closureUnresolved)
        .withContext('and the one that did not').toBeTrue();
    });

    it('THE REGRESSION: the same is true of a VALID K2 closure this device '
       + 'could not write down', () => {
      k1ContradictedThenLegitimatelyAccepted();
      const { k2 } = aNextPurchase();

      const e = makeComponent(false);
      e.detectChanges();
      const read = http.expectOne(intentRead());
      // The store accepts the write, throws nothing and keeps the previous
      // value: `noteClosure`'s read-back is what catches it.
      faultTheWrite();
      read.flush(
        readAnswer(k2, 'o2', 'q2', { quote_closure: closureFor('q2') }));

      const held = coordinator.unresolvedClosure();
      expect(held).withContext('the failed write is shared').not.toBeNull();
      expect(held!.kind).toBe('unrecorded-closure');
      expect(held!.attempt.key).toBe(k2);
    });

    it('CONTROL: a still-current contradiction is STILL not downgraded by '
       + 'ordinary same-attempt evidence', () => {
      const { key } = aPricedAttempt();
      const a = makeComponent(false);
      a.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));

      // A second, ordinary observation about the SAME live attempt.
      const b = makeComponent(false);
      b.detectChanges();
      http.expectOne(intentRead()).flush(
        readAnswer(key, 'o1', 'q1',
                   { quote_closure: unsupportedClosureFor('q1') }));

      expect(coordinator.unresolvedClosure()!.kind)
        .withContext('the contradiction survives the downgrade')
        .toBe('contradictory-evidence');
    });

    it('CONTROL: a stale FOREIGN-attempt observation does not displace a '
       + 'current contradiction', () => {
      const { key } = aPricedAttempt();
      const a = makeComponent(false);
      a.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));

      // An observation naming an attempt that is not the one on record. It
      // would be refused by `unresolvedClosure` afterwards — which is exactly
      // why it must not be allowed to take the slot.
      coordinator.holdClosure({
        kind: 'unusable-evidence',
        attempt: { key: 'k-other', scope: 'r1:t1', purchase: 'other' },
        orderId: 'o9',
        evidence: { kind: 'absent' },
      } as any);

      const held = coordinator.unresolvedClosure();
      expect(held)
        .withContext('the current contradiction is not lost').not.toBeNull();
      expect(held!.attempt.key).toBe(key);
      expect(held!.kind).toBe('contradictory-evidence');
    });

    it('CONTROL: nor does a foreign-attempt CONTRADICTION — the downgrade rule '
       + 'alone does not cover this one', () => {
      const { key } = aPricedAttempt();
      const a = makeComponent(false);
      a.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));

      // SAME KIND, so nothing about severity refuses it. Only the identity
      // question does — and taking the one slot would leave K1's live
      // contradiction unrepresented, since `unresolvedClosure` then refuses
      // the replacement for naming an attempt the record does not.
      coordinator.holdClosure({
        kind: 'contradictory-evidence',
        attempt: { key: 'k-other', scope: 'r1:t1', purchase: 'other' },
        orderId: 'o9',
        evidence: { kind: 'absent' },
      } as any);

      const held = coordinator.unresolvedClosure();
      expect(held)
        .withContext('K1 is still held').not.toBeNull();
      expect(held!.attempt.key).toBe(key);
      expect(a.componentInstance.closureUnresolved)
        .withContext('and the mount that observed it still blocks').toBeTrue();
    });

    /**
     * Codex P2 on PR #680, valid. An ACCEPTED read issued BEFORE a
     * contradiction can land after it, and the accepted branch consults the
     * `observed` hold it already captures for nothing: `clearIntent` removes
     * the record, `unresolvedClosure()` then answers null for want of an
     * attempt, and the newer observation is silenced by an older answer that
     * was never allowed to resolve it.
     */
    function anOlderAcceptedAnswerUnderANewerContradiction() {
      const { key } = aPricedAttempt();

      // A's accepted read is issued FIRST and held. Nothing is observed yet,
      // so it can never be the answer that resolves what comes next.
      const a = makeComponent(false);
      a.detectChanges();
      const aRead = http.expectOne(intentRead());

      // The contradiction is observed while it is open.
      const b = makeComponent(false);
      b.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));
      expect(coordinator.unresolvedClosure()!.kind)
        .withContext('THE PREMISE: the contradiction is established')
        .toBe('contradictory-evidence');

      // A's OLDER answer lands last, and it is coherent.
      aRead.flush(acceptedAnswer(key));
      return { a, b, key };
    }

    it('THE REGRESSION: an older accepted answer does not retire a '
       + 'contradiction observed while it was open', () => {
      const { key } = anOlderAcceptedAnswerUnderANewerContradiction();

      expect(coordinator.unresolvedClosure())
        .withContext('the newer observation still applies').not.toBeNull();
      expect(coordinator.record()?.key)
        .withContext('because the attempt it names was not forgotten')
        .toBe(key);
    });

    it('THE REGRESSION: so the consumer that observed it keeps saying so',
       () => {
      const { a, b } = anOlderAcceptedAnswerUnderANewerContradiction();

      expect(b.componentInstance.closureUnresolved)
        .withContext('the mount that observed the contradiction').toBeTrue();
      expect(a.componentInstance.closureUnresolved)
        .withContext('and the one that did not, through the shared hold')
        .toBeTrue();
    });

    it('THE REGRESSION: and the acceptance is NOT lost — only the forgetting '
       + 'is withheld', () => {
      anOlderAcceptedAnswerUnderANewerContradiction();

      expect(coordinator.record()?.outcome?.kind)
        .withContext('the terminal outcome is still durably recorded')
        .toBe('accepted');
    });

    it('CONTROL: an accepted answer that DID observe the hold still tidies '
       + 'up', () => {
      const { key } = aPricedAttempt();
      const b = makeComponent(false);
      b.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));

      // Issued AFTER the contradiction, so it is the answer to a question
      // asked in full knowledge of it.
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(acceptedAnswer(key));

      expect(coordinator.record())
        .withContext('the settled attempt is forgotten as it always was')
        .toBeNull();
      expect(coordinator.unresolvedClosure())
        .withContext('and nothing is held against a fresh purchase')
        .toBeNull();
    });

    it('CONTROL: an answer whose observation was LEGITIMATELY RESOLVED while '
       + 'it was open still tidies up', () => {
      const { key } = aPricedAttempt();

      // D's accepted read is issued while the contradiction STANDS, so it is
      // the answer to a question asked in full knowledge of it.
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));
      const d = makeComponent(false);
      d.detectChanges();
      const dRead = http.expectOne(intentRead());

      // A later coherent read resolves it through the ordering check — the
      // documented exit — so by the time D's answer lands the observation it
      // was measured against is gone, and there is nothing left to silence.
      const e = makeComponent(false);
      e.detectChanges();
      http.expectOne(intentRead())
        .flush(readAnswer(key, 'o1', 'q1', { quote_closure: closureFor('q1') }));
      expect(coordinator.unresolvedClosure())
        .withContext('THE PREMISE: the observation is legitimately resolved')
        .toBeNull();

      dRead.flush(acceptedAnswer(key));

      expect(coordinator.record())
        .withContext('with nothing held, the forgetting silences nothing')
        .toBeNull();
    });

    it('CONTROL: an ORDINARY accepted recovery with no observation at all '
       + 'still tidies up', () => {
      const { key } = aPricedAttempt();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(acceptedAnswer(key));

      expect(coordinator.record())
        .withContext('the ordinary path is untouched').toBeNull();
    });

    it('CONTROL: a FAILED terminal write retires nothing — the observation '
       + 'stands and the record survives', () => {
      const { key } = aPricedAttempt();
      const a = makeComponent(false);
      a.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));

      const b = makeComponent(false);
      b.detectChanges();
      const read = http.expectOne(intentRead());
      faultTheWrite();
      read.flush(acceptedAnswer(key));

      expect(coordinator.record())
        .withContext('a removal that could not be recorded retires nothing')
        .not.toBeNull();
      expect(coordinator.unresolvedClosure())
        .withContext('so the observation still stands').not.toBeNull();
    });
  });
});
