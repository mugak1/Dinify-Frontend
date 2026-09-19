/**
 * D06 completion, G4 — ONE VALIDATED, CORRELATED READING OF A QUOTE ANSWER.
 *
 * D04 established the discipline for ACCEPTANCE answers: an answer is acted on
 * only once it has been shown to be about THIS key, THIS order and THIS scope,
 * and the operation's identity is frozen at issuance rather than re-read when
 * the reply lands. `checkout-correlation.ts` is that reading, and every
 * acceptance consumer goes through it.
 *
 * The D06 enquiry never joined it. `renewQuote` asks `PUT orders/retire-quote/`
 * whether a saved quote may still be honoured — the one round trip whose answer
 * decides whether an order is SUBMITTED — and it read `response.outcome` and
 * acted, having checked nothing about what the answer was about. Four gaps, all
 * of them the same gaps D04 closed on its own side:
 *
 *   1. NOT CORRELATED. A late or misrouted 200 saying `quote_still_valid` was
 *      submitted. The enquiry names an order and a reference; the answer was
 *      never required to name them back.
 *   2. IDENTITY WAS NOT FROZEN. The guard was `issued !== this.attemptSeq`, a
 *      process-local counter that survives nothing and names no operation —
 *      exactly the identity D04 replaced with an immutable owner.
 *   3. THE CLOSED ANSWER RE-PRICED UNDER THE DEAD KEY. `quote_closed` is the
 *      most direct closure signal the client ever gets, and this path kept the
 *      key — so `initiate` replayed the retired order. G3b fixed the two other
 *      sites and this one was left behind.
 *   4. D06 SUPPORT WAS NOT REMEMBERED. `checkout_protocol` is remembered per
 *      attempt precisely so a later response carrying no projection reads as
 *      BROKEN rather than old; `quote_protocol` was re-read off each payload,
 *      so a server that had already demonstrated level 2 could go quiet and be
 *      taken for a level-1 server that never promised anything.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { Subject, of } from 'rxjs';

import { WINDOW } from '../../../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../../../_services/storage/storage-key-prefix.token';
import { BasketService } from '../../../_services/basket.service';
import { ApiService } from '../../../_services/api.service';
import {
  CheckoutCoordinatorService,
} from '../../../_services/checkout-coordinator.service';
import { ToastService } from '../../../_shared/ui/toast/toast.service';
import { ConfirmDialogService } from '../../../_common/confirm-dialog.service';
import { ConnectivityService } from '../../../_services/connectivity.service';
import { BasketItem } from '../../../_models/app.models';
import { BasketBodyComponent } from './basket-body.component';

describe('BasketBodyComponent — the quote answer (D06/G4)', () => {
  let basket: { items: BasketItem[]; totalAmount: number };
  let api: jasmine.SpyObj<ApiService>;
  let basketService: any;
  let coordinator: CheckoutCoordinatorService;
  let fixture: ComponentFixture<BasketBodyComponent>;
  let component: BasketBodyComponent;

  const line = () => ({
    itemId: 'i1', itemName: 'Burger', basePrice: 5000, totalPrice: 5000,
    quantity: 1, selectedModifiers: [], extras: [], isDiscounted: false,
  } as unknown as BasketItem);

  /** An initiate response whose quote is already past its deadline here, so
   *  `confirmQuote` asks the server instead of submitting. */
  const AMOUNT = '5000.00';

  /** ONE coherent priced line — a CORRECTED payload the shared `reviewQuote`
   *  boundary accepts, which is what lets `confirmQuote` reach the enquiry at
   *  all. A payload that cannot be reviewed is refused before it gets there. */
  const quoteLine = () => ({
    id: 'l1', item: 'i1', item_name: 'Burger', quantity: 1,
    available: true, status: 'available',
    selected_modifiers: {}, modifiers: [], options: [],
    unit_price: AMOUNT, reference_unit_price: AMOUNT,
    discounted_price: AMOUNT, unit_cost_of_options: '0.00', discounted: false,
    total_cost: AMOUNT, reference_total_cost: AMOUNT, discounted_cost: AMOUNT,
    savings: '0.00', line_actual_cost: AMOUNT, line_total_with_extras: AMOUNT,
    extras: [] as unknown[],
  });

  const priced = (details: Record<string, unknown> = {}) => ({
    status: 200,
    data: {
      order_details: {
        id: 'o1', quote_ref: 'q1', actual_cost: Number(AMOUNT),
        quote_total: AMOUNT, pricing_version: 'CORRECTED',
        no_items: 1, no_available_items: 1, no_unavailable_items: 0,
        no_available_extras: 0, no_unavailable_extras: 0,
        quote: [quoteLine()],
        quote_protocol: 2,
        quote_policy: {
          version: 1, status: 'live',
          expires_at: '2020-01-01T00:00:00Z',        // long past
        },
        ...details,
      },
      order_items: [], available_items: [], unavailable_items: [],
      extras: [], available_extras: [], unavailable_extras: [],
    },
  });

  /** The closure the backend attaches to every `quote_closed` answer — its
   *  `as_review_result` claims that word ONLY when a row was written or
   *  found, and `_metadata` puts the row beside it. */
  const CLOSURE = {
    quote_closure: {
      closed_at: '2026-09-18T10:00:00Z',
      reason: 'quote_expired',
      quote_ref: 'q1',
      policy_version: 1,
    },
  };

  /** A correlated retire answer — what the server actually sends. A closed
   *  outcome carries its closure, because the route never sends one without. */
  const answer = (outcome: string, over: Record<string, unknown> = {}) => ({
    status: 200, message: 'ok', outcome,
    order: 'o1', quote_ref: 'q1',
    ...(outcome === 'quote_closed' || outcome === 'quote_already_closed'
      ? CLOSURE : {}),
    ...over,
  });

  function initiateCalls(): any[] {
    return api.postPatch.calls.allArgs()
      .filter((args) => args[0] === 'orders/initiate/');
  }
  function retireCalls(): any[] {
    return api.postPatch.calls.allArgs()
      .filter((args) => args[0] === 'orders/retire-quote/');
  }
  function submitCalls(): any[] {
    return api.postPatch.calls.allArgs()
      .filter((args) => args[0] === 'orders/submit/');
  }

  beforeEach(async () => {
    basket = { items: [line()], totalAmount: 5000 };
    api = jasmine.createSpyObj<ApiService>('ApiService', ['postPatch', 'get']);
    api.get.and.returnValue(of({ data: null }) as any);
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
        provideHttpClient(withXhr()), provideHttpClientTesting(),
        provideRouter([]),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
        { provide: BasketService, useValue: basketService },
        { provide: ApiService, useValue: api },
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
    coordinator = TestBed.inject(CheckoutCoordinatorService);
    fixture = TestBed.createComponent(BasketBodyComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
  });

  /** Price a quote whose deadline has passed, then confirm it — which asks. */
  function askTheServer(retire: any, details: Record<string, unknown> = {}) {
    api.postPatch.and.callFake(((route: string) => {
      if (route === 'orders/initiate/') return of(priced(details)) as any;
      if (route === 'orders/retire-quote/') return retire as any;
      return of({ status: 200, message: 'placed' }) as any;
    }) as any);
    component.initiateOrder();
    (component as any).confirmQuote();
  }

  // ------------------------------------------------------------------
  // 1. the answer has to be about what was asked
  // ------------------------------------------------------------------

  describe('correlation', () => {
    it('submits on a correlated `quote_still_valid`', () => {
      askTheServer(of(answer('quote_still_valid')));
      expect(retireCalls().length).toBe(1);
      expect(submitCalls().length).toBe(1);
    });

    it('THE REGRESSION: does NOT submit on an answer about another order', () => {
      askTheServer(of(answer('quote_still_valid', { order: 'o-other' })));
      expect(submitCalls().length).toBe(0);
    });

    it('nor on an answer naming a different quote reference', () => {
      askTheServer(of(answer('quote_still_valid', { quote_ref: 'q-other' })));
      expect(submitCalls().length).toBe(0);
    });

    it('C2: an answer that names NOTHING is REFUSED once this server has '
       + 'demonstrated level 2', () => {
      // THE OLD ORACLE CALLED THIS OLDER-SERVER COMPATIBILITY, and it was the
      // right rule applied without looking at what this server had already
      // shown it could do. The G4 correlation and `QUOTE_PROTOCOL` 2 shipped
      // in ONE backend change and deployed together, so a server that
      // declared level 2 on the initiate — as this fixture does — and then
      // answers without naming what it is answering about is BROKEN, not old.
      // And this is the answer that leads to SUBMITTING an order.
      askTheServer(of({ status: 200, outcome: 'quote_still_valid' }));
      expect(submitCalls().length).toBe(0);
      // Nothing is discarded either: the quote is not known to be dead.
      expect(coordinator.record()).not.toBeNull();
    });

    it('CONTROL: and an uncorrelated answer from a server that has '
       + 'demonstrated NOTHING is still honoured', () => {
      // The compatibility the rule above narrows, preserved exactly. A
      // genuinely pre-G4 backend states no level, so its silence about the
      // enquiry is the only shape it has ever had — refusing it would leave
      // every such backend unable to complete a checkout whose deadline had
      // passed. The deadline is still consulted at level 1, which is why the
      // enquiry happens at all here.
      askTheServer(of({ status: 200, outcome: 'quote_still_valid' }),
                   { quote_protocol: 1 });
      expect(submitCalls().length).toBe(1);
    });

    it('an unreadable outcome submits nothing and discards nothing', () => {
      askTheServer(of(answer('something_new')));
      expect(submitCalls().length).toBe(0);
      expect(coordinator.record()).not.toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // 2. a closed quote renews here too
  // ------------------------------------------------------------------

  describe('a retired quote', () => {
    it('re-prices under a NEW key', () => {
      askTheServer(of(answer('quote_closed')));
      const keys = initiateCalls().map((a) => a[1].client_order_id);
      expect(keys.length).toBe(2);
      expect(keys[1]).not.toBe(keys[0]);
      expect(coordinator.record()!.replaces).toBe(keys[0]);
    });

    it('and says so', () => {
      askTheServer(of(answer('quote_closed')));
      expect((component as any).quoteRetired).toBeTrue();
    });

    it('treats an already-closed answer identically', () => {
      askTheServer(of(answer('quote_already_closed')));
      const keys = initiateCalls().map((a) => a[1].client_order_id);
      expect(keys[1]).not.toBe(keys[0]);
    });

    it('C2: a `quote_closed` carrying NO closure renews nothing', () => {
      // The route claims that word only when it actually wrote or found a
      // row, so the word without the row is a broken promise — and acting on
      // it would abandon an idempotency key on evidence nobody can read.
      askTheServer(of({ status: 200, outcome: 'quote_closed',
                        order: 'o1', quote_ref: 'q1' }));
      expect(initiateCalls().length).toBe(1);
      expect(submitCalls().length).toBe(0);
      expect((component as any).quoteRetired).toBeFalse();
    });

    it('C2: nor does one whose closure names a DIFFERENT quote', () => {
      askTheServer(of(answer('quote_closed', {
        quote_closure: { ...CLOSURE.quote_closure, quote_ref: 'q-other' },
      })));
      expect(initiateCalls().length).toBe(1);
      expect(submitCalls().length).toBe(0);
    });

    it('C1: and the closure the server stated is REMEMBERED', () => {
      // The successor carries none of its own, but the fact was recorded
      // before the renewal — which is what lets a reload, the other mount and
      // the diner's explicit review all read one established answer.
      askTheServer(of(answer('quote_closed')));
      expect(coordinator.record()!.replaces).not.toBeNull();
      expect(coordinator.record()!.closure).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // 2b. C2 — the capability is read LIVE, the identity stays FROZEN
  // ------------------------------------------------------------------

  describe('the two things read when an answer lands', () => {
    it('C2: the level is REMEMBERED durably, so a reload reads it', () => {
      // Asserted while the attempt is still live — a completed checkout drops
      // its record, which is correct and would make this assertion about
      // nothing.
      const held = new Subject<any>();
      askTheServer(held);
      expect(coordinator.record()!.quoteProtocol).toBe(2);
      expect(coordinator.establishedQuoteProtocol()).toBe(2);
      held.complete();
    });

    it('C2: an answer that states NO level cannot excuse its own silence', () => {
      // READ FROM THE MEMORY, NOT FROM THE PAYLOAD. If the level were taken
      // off the response, a broken answer could omit the correlation AND the
      // level and be read as an older server's. The record already holds what
      // this server demonstrated on the initiate, and a capability does not
      // un-demonstrate itself.
      askTheServer(of({ status: 200, outcome: 'quote_still_valid' }));
      expect(submitCalls().length).toBe(0);
      expect(coordinator.record()).not.toBeNull();
    });

    it('C2: a still-valid answer does NOT submit once the review has moved on',
       () => {
      // A STILL-VALID ANSWER CONTINUES AN INTENT; IT NEVER CREATES ONE. The
      // enquiry writes nothing and claims no table, so its 200 is permission
      // to go on with the press that asked it — about the same order and the
      // same reference — and nothing more.
      const late = new Subject<any>();
      askTheServer(late);
      // the review the diner confirmed is replaced underneath the enquiry
      (component as any).reviewedQuote = { ref: 'q-different',
                                           revision: 1, context: ':' };

      late.next(answer('quote_still_valid'));

      expect(submitCalls().length).toBe(0);
      expect(component.orderError).toBeTrue();
    });
  });

  // ------------------------------------------------------------------
  // 3. identity is frozen at issuance
  // ------------------------------------------------------------------

  describe('a late answer', () => {
    it('is ignored once the diner has started a different checkout', () => {
      const late = new Subject<any>();
      askTheServer(late);

      // The diner edits and checks out again while the enquiry is open.
      basket.items = [line(), line()];
      component.initiateOrder();
      const before = submitCalls().length;

      late.next(answer('quote_still_valid'));
      late.complete();

      expect(submitCalls().length).toBe(before);
    });

    it('is ignored after the component is destroyed', () => {
      // Angular does not cancel an in-flight request when a component goes
      // away; only unsubscribing does. An answer landing afterwards must not
      // submit an order on behalf of a screen the diner has left.
      const late = new Subject<any>();
      askTheServer(late);

      fixture.destroy();
      late.next(answer('quote_still_valid'));
      late.complete();

      expect(submitCalls().length).toBe(0);
    });
  });

  // ------------------------------------------------------------------
  // 4. the level this server demonstrated is remembered
  // ------------------------------------------------------------------

  describe('demonstrated D06 support', () => {
    it('is remembered from the initiate response', () => {
      api.postPatch.and.returnValue(of(priced()) as any);
      component.initiateOrder();
      expect(coordinator.record()!.quoteProtocol).toBe(2);
    });

    it('is MONOTONIC — a capability does not un-demonstrate itself', () => {
      api.postPatch.and.returnValue(of(priced()) as any);
      component.initiateOrder();
      coordinator.noteQuoteProtocol(1);
      expect(coordinator.record()!.quoteProtocol).toBe(2);
    });

    it('a server that never stated a level is remembered as having stated none', () => {
      api.postPatch.and.returnValue(
        of(priced({ quote_protocol: undefined })) as any);
      component.initiateOrder();
      expect(coordinator.record()!.quoteProtocol).toBe(0);
    });
  });
});
