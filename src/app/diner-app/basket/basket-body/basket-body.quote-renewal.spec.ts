/**
 * D06 completion, G3b — what the BASKET does when the server retires a quote.
 *
 * `checkout-coordinator.renewal.spec.ts` proves the primitive mints one new key
 * and refuses the cases it must. This proves the two places that call it, and
 * they are the reason the defect was reachable at all:
 *
 *   1. A TERMINAL refusal re-priced with the SAME key. The key is bound to the
 *      order the closure was written against, so `initiate` REPLAYS it and the
 *      same retired draft comes back — a review sheet for a quote that can
 *      never be paid, refused again on submit, with no way out of the app. A
 *      `quote_ref_stale` reprice arrives through the very same branch and must
 *      KEEP its key, which is why one answer was wrong for exactly half of it.
 *
 *   2. `initiate` CAN HAND BACK A RETIRED QUOTE WITH NO REFUSAL INVOLVED. The
 *      key is bound to a purchase, so a replay returns whatever order that key
 *      was used for — and its quote may have been retired since, by a refusal
 *      whose response was lost, by the other mount, or by `retire-quote`. The
 *      client has to notice from the read itself.
 *
 * The level gate is the subtle half of (2). A server at level 1 retires quotes
 * durably and publishes a closure only on the refusal, so an absent
 * `quote_closure` on its read says NOTHING — reading that silence as "still
 * good" is correct there, and reading it as a verdict would make every older
 * backend look like it was answering a question it has never been asked.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';

import { WINDOW } from '../../../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../../../_services/storage/storage-key-prefix.token';
import { BasketService } from '../../../_services/basket.service';
import { ApiService } from '../../../_services/api.service';
import {
  CheckoutCoordinatorService,
  PURCHASE_CANON,
} from '../../../_services/checkout-coordinator.service';
import { ToastService } from '../../../_shared/ui/toast/toast.service';
import { ConfirmDialogService } from '../../../_common/confirm-dialog.service';
import { ConnectivityService } from '../../../_services/connectivity.service';
import { BasketItem } from '../../../_models/app.models';
import { BasketBodyComponent } from './basket-body.component';

describe('BasketBodyComponent — renewal after a closure (D06/G3b)', () => {
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

  /** An initiate response, with whatever quote facts the case needs. */
  const initiated = (details: Record<string, unknown> = {}) => ({
    status: 200,
    data: {
      order_details: {
        id: 'o1', quote_ref: 'q1', actual_cost: '5000.00',
        quote_total: '5000.00', pricing_version: 'CORRECTED',
        ...details,
      },
      order_items: [], available_items: [], unavailable_items: [],
      extras: [], available_extras: [], unavailable_extras: [],
      quote: [], quote_total: '5000.00',
    },
  });

  const closureFacts = {
    quote_protocol: 2,
    quote_closure: {
      closed_at: '2026-09-17T10:00:00Z',
      reason: 'quote_expired',
      quote_ref: 'q1',
      policy_version: 1,
    },
  };

  const refusal = (reason: string, over: Record<string, unknown> = {}) => ({
    status: 400, message: `refused: ${reason}`, reason, ...over,
  });

  beforeEach(async () => {
    basket = { items: [line()], totalAmount: 5000 };
    api = jasmine.createSpyObj<ApiService>('ApiService', ['postPatch', 'get']);
    api.get.and.returnValue(of({ data: null }) as any);
    api.postPatch.and.returnValue(of(initiated()) as any);
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

  /** The state after one checkout press: a key reserved and a quote reviewed. */
  function afterPricing(): string {
    component.initiateOrder();
    return coordinator.record()!.key;
  }

  /** Every key the client sent on `orders/initiate/`, in order. */
  function keysSent(): string[] {
    return api.postPatch.calls.allArgs()
      .filter((args) => args[0] === 'orders/initiate/')
      .map((args) => (args[1] as any).client_order_id);
  }

  // ------------------------------------------------------------------
  // 1. the terminal refusal
  // ------------------------------------------------------------------

  describe('a terminal refusal', () => {
    it('O1: ESTABLISHES the closure and STOPS — the diner re-prices', () => {
      // CHANGED EXPECTATION, DELIBERATELY. This asserted that the refusal
      // handler itself minted a new key and re-priced. Minting an idempotency
      // key is the most consequential thing this client does with one, and
      // doing it as a side effect of reading a failure means it happens on
      // whatever record is current at that instant, without the diner having
      // asked for anything.
      //
      // The three steps are the same and the ORDER is the change: establish
      // the closure durably, offer the one action that works, and mint on the
      // tap. Both halves are asserted here.
      const first = afterPricing();
      (component as any).handleSubmitFailure(
        refusal('quote_expired', closureFacts));

      // NOTHING IS SENT, and the key is untouched.
      expect(keysSent().length).toBe(1);
      expect(coordinator.record()!.key).toBe(first);
      // The closure IS established, and the action is offered.
      const reading = coordinator.closureOf(coordinator.record()!);
      expect(reading.evidence.kind).toBe('closure');
      expect(component.updatedReviewPrompt).not.toBeNull();

      // THE DELIBERATE TAP is what renews.
      component.reviewUpdatedOrder();
      const keys = keysSent();
      expect(keys.length).toBe(2);
      expect(keys[1]).not.toBe(keys[0]);
      expect(coordinator.record()!.key).not.toBe(first);
    });

    it('C2: CONTROL — the same reason with NO closure renews nothing', () => {
      // The discriminating half of the correction above. A server that says
      // the word and sends no row has made a promise it did not keep, and
      // minting a key on it is acting on evidence nobody can read.
      const first = afterPricing();
      (component as any).handleSubmitFailure(refusal('quote_expired'));

      expect(keysSent().length).toBe(1);
      expect(coordinator.record()!.key).toBe(first);
      expect(coordinator.record()!.command).toBeNull();
    });

    it('and the new attempt LINKS to the retired one', () => {
      const first = afterPricing();
      (component as any).handleSubmitFailure(
        refusal('quote_expired', closureFacts));
      component.reviewUpdatedOrder();
      expect(coordinator.record()!.replaces).toBe(first);
    });

    it('carries the SAME purchase across — it is a new attempt, not a new basket', () => {
      afterPricing();
      const identity = coordinator.record()!.request.identity;
      (component as any).handleSubmitFailure(
        refusal('quote_expired', closureFacts));
      component.reviewUpdatedOrder();
      expect(coordinator.record()!.request.identity).toBe(identity);
    });

    it('CONTROL: a reprice refusal keeps its key', () => {
      // `quote_ref_stale` means the server re-read the order and the reference
      // moved — the order is still acceptable, so the same purchase must reuse
      // its key. Renewing here would turn one attempt into two orders.
      const first = afterPricing();
      (component as any).handleSubmitFailure(refusal('quote_ref_stale'));

      const keys = keysSent();
      expect(keys.length).toBe(2);
      expect(keys[1]).toBe(keys[0]);
      expect(coordinator.record()!.key).toBe(first);
    });

    it('CONTROL: a transient refusal renews nothing and sends nothing', () => {
      const first = afterPricing();
      (component as any).handleSubmitFailure(refusal('restaurant_paused'));

      expect(keysSent().length).toBe(1);
      expect(coordinator.record()!.key).toBe(first);
    });
  });

  // ------------------------------------------------------------------
  // 2. a replay that comes back retired
  // ------------------------------------------------------------------

  describe('an initiate that hands back a retired quote', () => {
    it('O1: ESTABLISHES the closure and STOPS, then the tap re-prices', () => {
      // CHANGED EXPECTATION, DELIBERATELY — the same correction as the
      // terminal refusal above, at the other site that LEARNS of a closure.
      // A key mint inside a response handler acts on whatever record is
      // current at that instant; the diner's tap is what decides.
      api.postPatch.and.returnValues(
        of(initiated(closureFacts)) as any,
        of(initiated({ quote_protocol: 2 })) as any,
      );

      component.initiateOrder();

      // ONE request, no successor, and the retired quote is NOT reviewed.
      expect(keysSent().length).toBe(1);
      expect((component as any).showQuoteSheet).toBeFalse();
      expect(coordinator.closureOf(coordinator.record()!).evidence.kind)
        .toBe('closure');
      expect(component.updatedReviewPrompt).not.toBeNull();

      component.reviewUpdatedOrder();
      const keys = keysSent();
      expect(keys.length).toBe(2);
      expect(keys[1]).not.toBe(keys[0]);
      expect(coordinator.record()!.key).toBe(keys[1]);
      expect(coordinator.record()!.replaces).toBe(keys[0]);
      // and the diner is shown the SECOND quote, not the retired one
      expect((component as any).showQuoteSheet).toBeTrue();
      expect((component as any).reviewedQuote.ref).toBe('q1');
    });

    it('O1: a server that keeps answering "closed" cannot loop', () => {
      // CHANGED EXPECTATION. This asserted a once-per-episode bound on an
      // AUTOMATIC renewal. There is no automatic renewal left, so the bound
      // is structural: every cycle costs a deliberate tap, and nothing this
      // client does on its own sends a second request.
      api.postPatch.and.returnValue(of(initiated(closureFacts)) as any);

      component.initiateOrder();
      expect(keysSent().length).toBe(1);

      component.reviewUpdatedOrder();
      expect(keysSent().length).toBe(2);
    });

    it('CONTROL: an ordinary response is reviewed under its own key', () => {
      const first = afterPricing();
      expect(keysSent()).toEqual([first]);
      expect((component as any).showQuoteSheet).toBeTrue();
    });

    it('CONTROL: a level-1 server\'s silence is not a closure', () => {
      // Level 1 retires quotes durably and announces them only on the refusal,
      // so an absent `quote_closure` on its read says nothing at all. Treating
      // that as "not closed" is correct; treating it as a verdict would make
      // every older backend look like it was answering a question it has never
      // been asked.
      api.postPatch.and.returnValue(of(initiated({ quote_protocol: 1 })) as any);
      const first = afterPricing();
      expect(keysSent()).toEqual([first]);
    });

    it('CONTROL: a closure from a server that stated NO level is ignored', () => {
      api.postPatch.and.returnValue(
        of(initiated({ quote_closure: closureFacts.quote_closure })) as any);
      const first = afterPricing();
      expect(keysSent()).toEqual([first]);
    });
  });

  // ------------------------------------------------------------------
  // 3. what must never be renewed around
  // ------------------------------------------------------------------

  describe('an outstanding acceptance', () => {
    it('is never abandoned by a renewal', () => {
      // Constructed rather than reached: `applyQuoteRefusal` settles the
      // command before this branch runs, so production cannot get here today.
      // It is asserted anyway, because the renewal is what abandons a key and
      // this is the one state where doing so produces two orders.
      afterPricing();
      // O1 — the closure is ESTABLISHED first (that is where one comes from
      // now), and the command issued after it is what leaves the record
      // outstanding. The protection is unchanged; the route to the state is.
      expect(coordinator.noteClosure({
        closedAt: closureFacts.quote_closure!.closed_at,
        reason: closureFacts.quote_closure!.reason,
        quoteRef: closureFacts.quote_closure!.quote_ref,
        policyVersion: closureFacts.quote_closure!.policy_version,
      })).toBeTrue();
      coordinator.noteCommand({ orderId: 'o1', quoteRef: 'q1' });
      const key = coordinator.record()!.key;
      const sent = keysSent().length;

      const proceeded = (component as any).renewAfterClosure();

      expect(proceeded).toBeFalse();
      expect(coordinator.record()!.key).toBe(key);
      expect(coordinator.record()!.command).toEqual(
        { orderId: 'o1', quoteRef: 'q1' });
      expect(keysSent().length).toBe(sent);
    });

    it('and a storage that cannot record the renewal sends nothing', () => {
      afterPricing();
      const sent = keysSent().length;
      spyOn(coordinator, 'renewAfterClosure').and.returnValue(
        { kind: 'storage-error' });

      expect((component as any).renewAfterClosure()).toBeFalse();
      expect(keysSent().length).toBe(sent);
    });
  });
});
