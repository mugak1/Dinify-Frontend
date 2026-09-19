/**
 * E1/O1 — THE EVIDENCE IS EXHAUSTIVE, AND ONE DELIBERATE SUCCESSOR COMES
 * FROM THE ATTEMPT THE SERVER ACTUALLY RETIRED.
 *
 * Every case here drives the REAL component through the REAL coordinator and
 * the REAL session storage. Four rules are under test and each of them was
 * reachable before:
 *
 *   E1a  A CLOSURE THIS BUILD MAY NOT ACT ON IS NOT "NO CLOSURE". An
 *        unrecognised policy version was accepted for renewal, with the
 *        supported flag used only to choose the wording — a
 *        forward-compatibility claim no protocol guarantee states. Refusing it
 *        outright is not the answer either: reading it as absence re-prices
 *        under a key bound to a retired order, replays it, and loops.
 *
 *   E1b  SAME-ATTEMPT DEMONSTRATED SUPPORT IS EVALUATED WHEN THE ANSWER
 *        LANDS. A server that published `quote_protocol: 2` for this attempt
 *        and then answers without it has not become an older server.
 *
 *   E1c  ACCEPTED *AND* CLOSED IS A CONTRADICTION AND NEITHER HALF MAY BE
 *        CHOSEN. Announcing the acceptance clears the basket and deletes the
 *        record; acting on the closure mints a replacement for an order that
 *        may be cooking.
 *
 *   O1   THE CLOSURE NAMES THE ATTEMPT IT WAS WRITTEN AGAINST, and the
 *        renewal is a CONDITIONAL transition for that predecessor rather than
 *        an unconditional one on whatever record is current.
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

describe('BasketBodyComponent — closure evidence gates (D06 E1/O1)', () => {
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

  const wireClosure = (over: Record<string, unknown> = {}) => ({
    closed_at: '2026-09-17T10:00:00Z',
    reason: 'quote_expired',
    quote_ref: 'q1',
    policy_version: 1,
    ...over,
  });

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

  function afterPricing(): string {
    component.initiateOrder();
    return coordinator.record()!.key;
  }

  function keysSent(): string[] {
    return api.postPatch.calls.allArgs()
      .filter((args) => args[0] === 'orders/initiate/')
      .map((args) => (args[1] as any).client_order_id);
  }

  // ------------------------------------------------------------------
  // E1a — an unrecognised policy version
  // ------------------------------------------------------------------

  describe('a closure under a policy version this build has never seen', () => {
    it('THE REGRESSION: it does not settle, renew or re-price', () => {
      const first = afterPricing();
      coordinator.noteCommand({ orderId: 'o1', quoteRef: 'q1' });

      (component as any).handleSubmitFailure(refusal('quote_expired', {
        quote_closure: wireClosure({ policy_version: 99 }),
      }));

      // NOTHING WAS ACTED ON. The key is untouched, the issued command is
      // still the only handle on this checkout, and no second request went
      // out under a fresh key.
      expect(keysSent().length).toBe(1);
      expect(coordinator.record()!.key).toBe(first);
      expect(coordinator.record()!.command).not.toBeNull();
      expect(coordinator.closureOf(coordinator.record()!).evidence.kind)
        .toBe('absent');
      expect(component.quoteRetired).toBeFalse();
    });

    it('CONTROL: a SUPPORTED version is acted on exactly as before', () => {
      // The discriminating half. Same refusal, same shape, version 1.
      afterPricing();

      (component as any).handleSubmitFailure(refusal('quote_expired', {
        quote_closure: wireClosure(),
      }));

      expect(coordinator.closureOf(coordinator.record()!).evidence.kind)
        .toBe('closure');
      expect(component.quoteRetired).toBeTrue();
      expect(component.updatedReviewPrompt).not.toBeNull();
    });

    it('a STORED one blocks the CTA and offers manual recovery', () => {
      // The rollback case: a future build wrote a closure under a version
      // this one does not know. Reading it as absence would offer Checkout,
      // price under a key bound to a retired order, and loop.
      afterPricing();
      expect(coordinator.noteClosure({
        closedAt: '2026-09-17T10:00:00Z', reason: 'quote_expired',
        quoteRef: 'q1', policyVersion: 99,
      })).toBeTrue();
      const sent = keysSent().length;

      expect(component.checkoutBlocked).toBeTrue();
      expect(component.recoveryNotice).toContain('check with staff');
      // AND NO REVIEW IS OFFERED: this build cannot say what was retired.
      expect(component.updatedReviewPrompt).toBeNull();

      component.initiateOrder();
      expect(keysSent().length).toBe(sent);
    });

    it('a renewal on one is REFUSED and mints nothing', () => {
      const first = afterPricing();
      expect(coordinator.noteClosure({
        closedAt: '2026-09-17T10:00:00Z', reason: 'quote_expired',
        quoteRef: 'q1', policyVersion: 99,
      })).toBeTrue();

      const renewal = coordinator.renewAfterClosure();
      expect(renewal.kind).toBe('unusable');
      expect(coordinator.record()!.key).toBe(first);
    });
  });

  // ------------------------------------------------------------------
  // E1b — demonstrated support, read when the answer lands
  // ------------------------------------------------------------------

  describe('a server that has already demonstrated level 2', () => {
    it('THE REGRESSION: its later silence is BROKEN, not absent', () => {
      // The level is remembered per attempt and monotonically. A response
      // that now says nothing about it cannot be read as "no closure".
      api.postPatch.and.returnValues(
        of(initiated({ quote_protocol: 2 })) as any,
        of(initiated({})) as any,
      );
      afterPricing();
      const sent = keysSent().length;

      // A second press on the same attempt: the reply omits the level.
      component.initiateOrder();

      // Nothing is reviewed on the strength of that silence, and the diner is
      // told rather than left with a disabled button and no sentence.
      expect((component as any).showQuoteSheet).toBeFalse();
      expect(component.orderError).toBeTrue();
      expect(keysSent().length).toBeGreaterThan(sent);
    });

    it('CONTROL: a server that has NEVER stated a level is silent, not broken',
       () => {
      // The pre-level-2 tolerance. Its silence about closures is the only
      // shape it has ever had, and refusing it would strand every such
      // backend.
      api.postPatch.and.returnValue(of(initiated({ quote_protocol: 1 })) as any);

      afterPricing();

      expect((component as any).showQuoteSheet).toBeTrue();
      expect(component.orderError).toBeFalse();
    });

    it('CONTROL: `checkout_protocol` does not stand in for `quote_protocol`',
       () => {
      // Two separate promises that move independently. A D04 level-3 server
      // that has said nothing about D06 publishes no closures, and its
      // silence must stay silence.
      api.postPatch.and.returnValue(
        of(initiated({ checkout_protocol: 3, pricing_version: 'CORRECTED' })) as any);

      afterPricing();

      expect((component as any).showQuoteSheet).toBeTrue();
      expect(component.orderError).toBeFalse();
      expect(coordinator.record()!.quoteProtocol).toBe(0);
      expect(coordinator.record()!.protocol).toBe(3);
    });
  });

  // ------------------------------------------------------------------
  // O1 — the closure names its predecessor
  // ------------------------------------------------------------------

  describe('the predecessor a closure carries', () => {
    it('names the key, the order, the scope and the purchase', () => {
      const first = afterPricing();
      coordinator.noteCommand({ orderId: 'o1', quoteRef: 'q1' });
      (component as any).handleSubmitFailure(refusal('quote_expired', {
        quote_closure: wireClosure(),
      }));

      const reading = coordinator.closureOf(coordinator.record()!);
      expect(reading.predecessor).toEqual({
        key: first,
        orderId: 'o1',
        scope: (component as any).checkoutContext(),
        purchase: basketService.contentIdentity(),
      });
    });

    it('survives the storage round trip', () => {
      afterPricing();
      (component as any).handleSubmitFailure(refusal('quote_expired', {
        quote_closure: wireClosure(),
      }));
      const before = coordinator.closureOf(coordinator.record()!);

      // Re-read from the store rather than from memory.
      const after = coordinator.currentClosure()!;
      expect(after.predecessor).toEqual(before.predecessor);
    });

    it('a record whose closure names ANOTHER attempt REFUSES the renewal',
       () => {
      // Unreachable through this service's own writers — every record that
      // carries a closure carries it for its own key — so this is the
      // corruption/foreign-write guard, and it is what makes "the closure
      // belongs to this attempt" a checked fact rather than an assumed one.
      afterPricing();
      (component as any).handleSubmitFailure(refusal('quote_expired', {
        quote_closure: wireClosure(),
      }));
      // The store wraps the record as `{value: ...}`, which is the shape a
      // corrupted or foreign write would also take.
      const stored = JSON.parse(window.sessionStorage.getItem(
        CheckoutCoordinatorService.ATTEMPT_KEY)!);
      stored.value.closure.predecessor.key = 'some-other-attempt';
      window.sessionStorage.setItem(
        CheckoutCoordinatorService.ATTEMPT_KEY, JSON.stringify(stored));

      const renewal = coordinator.renewAfterClosure();
      expect(renewal.kind).toBe('conflict');
      expect(coordinator.record()!.key).toBe(stored.value.key);
    });
  });

  // ------------------------------------------------------------------
  // O1 — the reviewed key gates every command
  // ------------------------------------------------------------------

  describe('the reviewed key before a command is persisted or sent', () => {
    it('THE REGRESSION: a review that predates a renewal cannot submit', () => {
      afterPricing();
      // The other mount settles this quote and mints the successor. Both
      // mounts render this basket, and a renewal is a NEW attempt at the SAME
      // purchase — so the revision, the context, the scope and the request
      // are all unchanged across it and only the key can tell them apart.
      expect(coordinator.noteClosure({
        closedAt: '2026-09-17T10:00:00Z', reason: 'quote_expired',
        quoteRef: 'q1', policyVersion: 1,
      })).toBeTrue();
      expect(coordinator.renewAfterClosure().kind).toBe('ready');
      api.postPatch.calls.reset();

      component.submitOrder();

      expect(api.postPatch).not.toHaveBeenCalled();
      expect(coordinator.record()!.command).toBeNull();
      expect(component.orderError).toBeTrue();
    });

    it('a NULL reviewed key is refused, never trusted', () => {
      afterPricing();
      (component as any).reviewedQuote = {
        ...(component as any).reviewedQuote, key: null,
      };
      api.postPatch.calls.reset();

      component.submitOrder();

      expect(api.postPatch).not.toHaveBeenCalled();
      expect(coordinator.record()!.command).toBeNull();
    });

    it('CONTROL: the ordinary submission is unaffected', () => {
      afterPricing();
      api.postPatch.calls.reset();
      api.postPatch.and.returnValue(of({ status: 200, message: 'ok' }) as any);

      component.submitOrder();

      expect(api.postPatch.calls.mostRecent().args[0]).toBe('orders/submit/');
    });
  });

  // ------------------------------------------------------------------
  // O1 — a refusal belongs to the command that was issued
  // ------------------------------------------------------------------

  describe('a refusal that lands after the attempt moved on', () => {
    const staleOwner = () => {
      const owner = coordinator.ownerOf(coordinator.record()!);
      // The attempt moves on: a renewal for the same purchase under a new
      // key, which is exactly the state a stale reply can arrive into.
      expect(coordinator.noteClosure({
        closedAt: '2026-09-17T10:00:00Z', reason: 'quote_expired',
        quoteRef: 'q1', policyVersion: 1,
      })).toBeTrue();
      expect(coordinator.renewAfterClosure().kind).toBe('ready');
      return owner;
    };

    it('a stale TERMINAL refusal settles nothing on the new attempt', () => {
      afterPricing();
      coordinator.noteCommand({ orderId: 'o1', quoteRef: 'q1' });
      const owner = staleOwner();
      const key = coordinator.record()!.key;

      const applied = coordinator.applyQuoteRefusal(
        refusal('quote_expired', { quote_closure: wireClosure() }), owner);

      expect(applied).toBeNull();
      expect(coordinator.record()!.key).toBe(key);
      expect(coordinator.closureOf(coordinator.record()!).evidence.kind)
        .toBe('absent');
    });

    it('a stale REPRICE refusal settles nothing either — and it carries no '
       + 'reference to catch it', () => {
      // `quote_ref_stale` has no closure, so the evidence check that guards
      // the terminal branch cannot see it. The owner is the only thing that
      // can.
      afterPricing();
      coordinator.noteCommand({ orderId: 'o1', quoteRef: 'q1' });
      const owner = staleOwner();
      coordinator.noteCommand({ orderId: 'o2', quoteRef: 'q2' });

      const applied = coordinator.applyQuoteRefusal(
        refusal('quote_ref_stale'), owner);

      expect(applied).toBeNull();
      expect(coordinator.record()!.command).toEqual(
        { orderId: 'o2', quoteRef: 'q2' });
    });

    it('CONTROL: the owner of the CURRENT attempt is honoured', () => {
      afterPricing();
      coordinator.noteCommand({ orderId: 'o1', quoteRef: 'q1' });
      const owner = coordinator.ownerOf(coordinator.record()!);

      const applied = coordinator.applyQuoteRefusal(
        refusal('quote_ref_stale'), owner);

      expect(applied!.disposition).toBe('reprice');
      expect(coordinator.record()!.command).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // O1 — a required storage write is checked
  // ------------------------------------------------------------------

  it('a recovery closure that cannot be written down promises no review', () => {
    afterPricing();
    spyOn(window.sessionStorage, 'setItem').and.stub();

    (component as any).handleSubmitFailure(refusal('quote_expired', {
      quote_closure: wireClosure(),
    }));

    // `applyQuoteRefusal` downgrades to `unknown` when the durable write
    // fails, so nothing claims the quote was retired.
    expect(component.quoteRetired).toBeFalse();
    expect(component.updatedReviewPrompt).toBeNull();
  });

  // ------------------------------------------------------------------
  // O1 — "stop" has to give the flight back
  // ------------------------------------------------------------------

  describe('the app-wide flight after a terminal refusal', () => {
    // FOUND IN A BROWSER, NOT HERE. `placingOrder` is a getter over the
    // coordinator's ONE flight, and every release site is a method on the
    // instance that claimed it — so a branch that returns without releasing
    // holds it for the rest of the document's life. The reprice path never
    // had the problem because `placeOrder()` owns the flight and releases on
    // every outcome; the terminal branch replaced that fall-through with a
    // `return`, and the "Review updated order" button it renders came up
    // disabled and aria-busy and stayed that way until a reload — a dead end
    // produced by the change that exists to remove one.
    //
    // No unit spec could see it while every spec asserted on the STATE behind
    // the button rather than on whether the button could be pressed.

    it('THE REGRESSION: a terminal refusal leaves the flight released', () => {
      afterPricing();
      coordinator.noteCommand({ orderId: 'o1', quoteRef: 'q1' });
      const owner = coordinator.ownerOf(coordinator.record()!);
      expect((component as any).holdCheckout()).toBeTrue();
      expect(component.placingOrder).toBeTrue();

      (component as any).handleSubmitFailure(
        refusal('quote_expired', { quote_closure: wireClosure() }), owner);

      // The closure is established, the review is offered — and it can
      // actually be pressed.
      expect(component.quoteRetired).toBeTrue();
      expect(component.updatedReviewPrompt).not.toBeNull();
      expect(component.placingOrder).toBeFalse();
      expect(coordinator.inFlight()).toBeFalse();
    });

    it('CONTROL: a terminal reason with NO readable closure ends unheld', () => {
      // NOT the same branch, and that is the point of having it: a terminal
      // reason carrying no closure is downgraded to `unknown` by
      // `applyQuoteRefusal` and never reaches the terminal branch at all, so
      // `failOrder` releases it. It passes before and after the fix, which is
      // what makes it a control rather than a second regression — the Retry it
      // surfaces would be equally unpressable if this ever changed.
      afterPricing();
      coordinator.noteCommand({ orderId: 'o1', quoteRef: 'q1' });
      const owner = coordinator.ownerOf(coordinator.record()!);
      expect((component as any).holdCheckout()).toBeTrue();

      (component as any).handleSubmitFailure(refusal('quote_expired'), owner);

      expect(component.placingOrder).toBeFalse();
    });

    it('CONTROL: a TRANSIENT refusal also ends unheld', () => {
      // `failOrder` already released this one; it is here so a fix to the
      // terminal branch cannot be mistaken for the only path that needed it.
      afterPricing();
      coordinator.noteCommand({ orderId: 'o1', quoteRef: 'q1' });
      const owner = coordinator.ownerOf(coordinator.record()!);
      expect((component as any).holdCheckout()).toBeTrue();

      (component as any).handleSubmitFailure(
        refusal('restaurant_not_accepting_orders'), owner);

      expect(component.placingOrder).toBeFalse();
    });
  });

  it('keeps PURCHASE_CANON as the canon it reserves under', () => {
    // A guard on the fixture rather than on production: a record written
    // under another canon is a different purchase, and every comparison above
    // would silently stop discriminating.
    afterPricing();
    expect(coordinator.record()!.request.canon).toBe(PURCHASE_CANON);
  });
});
