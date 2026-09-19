/**
 * C3 — A PERSISTED CLOSURE PRODUCES ONE DELIBERATE SUCCESSOR.
 *
 * THE SEQUENCE, end to end, and every step of it is asserted below:
 *
 *   O1/K1/Q1  the diner prices and reviews
 *      |      the acceptance is issued and the reply is lost
 *   C1         the SERVER committed a closure for Q1
 *      |      a reload reads it back on the authorized order read
 *   persisted  the closure is recorded durably — one established fact, read
 *      |      by the routed page, the desktop sidebar and the next load
 *   REVIEW     the diner taps "Review updated order". THIS is the purchase
 *      |      decision; nothing before it mints a key or sends a mutation
 *   K2/O2      ONE successor, linked by `replaces`, carrying the SAME
 *      |      purchase — a new attempt at one order, not a new order
 *   Q2         reviewed
 *   accept     and accepted, explicitly
 *
 * WHAT THE SPECS BELOW ARE REALLY GUARDING, in the order a reviewer should
 * read them:
 *
 *   - the successor is ONE, however many surfaces decide about the same
 *     closure. Both mounts can hold it, and the second must not mint a second
 *     key for one closure.
 *   - the OLD attempt is never repriced, never deleted and never contradicted.
 *     O1, Q1 and C1 are server facts this client cannot write.
 *   - a STORAGE failure sends nothing. A key nobody wrote down is not an
 *     idempotency key, and issuing under one is how a retry duplicates.
 *   - a CHANGED cart is preserved. A renewal carries the purchase it was made
 *     for; a diner who edits first is starting a different purchase and
 *     `reserveIntent` mints for that instead.
 *   - a LOST successor replays K2 with the ORIGINAL lines, never a fresh key
 *     and never a body rebuilt from the basket as it stands.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { WINDOW } from '../../../_services/storage/window.token';
import { STORAGE_KEY_PREFIX }
  from '../../../_services/storage/storage-key-prefix.token';
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

describe('BasketBodyComponent — one successor from a closure (D06/C3)', () => {
  let basket: { items: BasketItem[]; totalAmount: number };
  let api: jasmine.SpyObj<ApiService>;
  let basketService: any;
  let coordinator: CheckoutCoordinatorService;
  let fixture: ComponentFixture<BasketBodyComponent>;
  let component: BasketBodyComponent;

  const line = (itemId = 'i1') => ({
    itemId, itemName: 'Burger', basePrice: 5000, totalPrice: 5000,
    quantity: 1, selectedModifiers: [], extras: [], isDiscounted: false,
  } as unknown as BasketItem);

  const CLOSURE = {
    closedAt: '2026-09-18T10:00:00Z',
    reason: 'quote_expired',
    quoteRef: 'q1',
    policyVersion: 1,
  };

  const initiated = (id = 'o1', ref = 'q1') => ({
    status: 200,
    data: {
      order_details: {
        id, quote_ref: ref, actual_cost: '5000.00',
        quote_total: '5000.00', pricing_version: 'CORRECTED',
        checkout_protocol: 3, quote_protocol: 2,
      },
      order_items: [], available_items: [], unavailable_items: [],
      extras: [], available_extras: [], unavailable_extras: [],
      quote: [], quote_total: '5000.00',
    },
  });

  function initiateCalls(): any[] {
    return api.postPatch.calls.allArgs()
      .filter((args) => args[0] === 'orders/initiate/');
  }
  function keysSent(): string[] {
    return initiateCalls().map((args) => args[1].client_order_id);
  }

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

  /** O1/K1/Q1 reviewed, the acceptance issued, and C1 recorded. */
  function withPersistedClosure(): string {
    component.initiateOrder();
    const k1 = coordinator.record()!.key;
    coordinator.noteCommand({ orderId: 'o1', quoteRef: 'q1' });
    expect(coordinator.noteClosure(CLOSURE)).toBeTrue();
    api.postPatch.calls.reset();
    return k1;
  }

  // -- the established fact ---------------------------------------------

  it('the closure is an ESTABLISHED fact, not a live one', () => {
    withPersistedClosure();
    // Both mounts read it, and a reload reads it: it is on the record, not in
    // one component's memory. The command is settled with it in the same
    // write, so nothing is left outstanding for a retry to re-send.
    const record = coordinator.record()!;
    expect(record.closure).toEqual(CLOSURE);
    expect(record.command).toBeNull();
    expect(record.stage).toBe('refused');
  });

  it('and NOTHING is sent until the diner decides', () => {
    withPersistedClosure();
    expect(initiateCalls().length).toBe(0);
    expect(api.postPatch).not.toHaveBeenCalled();
  });

  it('the footer offers a review rather than Checkout or Retry', () => {
    withPersistedClosure();
    expect(component.updatedReviewPrompt).not.toBeNull();
    expect(component.updatedReviewPrompt!.toLowerCase())
      .toContain('nothing has been sent to the kitchen');
  });

  // -- the deliberate successor ------------------------------------------

  it('THE SEQUENCE: the review mints ONE successor with a NEW key', () => {
    const k1 = withPersistedClosure();
    api.postPatch.and.returnValue(of(initiated('o2', 'q2')) as any);

    component.reviewUpdatedOrder();

    const keys = keysSent();
    expect(keys.length).toBe(1);
    expect(keys[0]).not.toBe(k1);
    expect(coordinator.record()!.key).toBe(keys[0]);
  });

  it('the successor LINKS to what it replaces and carries the SAME purchase',
     () => {
    const k1 = withPersistedClosure();
    const purchase = coordinator.record()!.request.identity;
    api.postPatch.and.returnValue(of(initiated('o2', 'q2')) as any);

    component.reviewUpdatedOrder();

    const after = coordinator.record()!;
    expect(after.replaces).toBe(k1);
    expect(after.request.identity).toBe(purchase);
    // and it starts clean: the closure belonged to the retired attempt.
    expect(after.closure).toBeNull();
    expect(after.command).toBeNull();
  });

  it('and the diner reviews the SECOND quote', () => {
    withPersistedClosure();
    api.postPatch.and.returnValue(of(initiated('o2', 'q2')) as any);

    component.reviewUpdatedOrder();

    expect((component as any).showQuoteSheet).toBeTrue();
    expect((component as any).reviewedQuote.ref).toBe('q2');
  });

  // -- exactly one --------------------------------------------------------

  it('repeated taps produce ONE successor, not one per tap', () => {
    withPersistedClosure();
    api.postPatch.and.returnValue(of(initiated('o2', 'q2')) as any);

    component.reviewUpdatedOrder();
    const after = coordinator.record()!.key;
    component.reviewUpdatedOrder();

    // The second tap has no closure left to act on — the successor carries
    // none — so it takes the ordinary path and does NOT mint again.
    expect(coordinator.record()!.key).toBe(after);
    expect(new Set(keysSent()).size).toBe(1);
  });

  it('a SECOND MOUNT deciding about the same closure does not mint again',
     () => {
    withPersistedClosure();
    const first = coordinator.record()!;
    api.postPatch.and.returnValue(of(initiated('o2', 'q2')) as any);

    component.reviewUpdatedOrder();
    const successor = coordinator.record()!.key;

    // The other mount held the SAME record and renews it too. The primitive
    // answers `superseded` — which the caller treats as success, because
    // another surface already did the thing it wanted.
    const second = coordinator.renewAfterClosure(CLOSURE, first);
    expect(second.kind).toBe('superseded');
    expect(coordinator.record()!.key).toBe(successor);
  });

  // -- what must never happen --------------------------------------------

  it('a STORAGE failure sends no mutation at all', () => {
    withPersistedClosure();
    spyOn(window.sessionStorage, 'setItem').and.stub();

    component.reviewUpdatedOrder();

    expect(initiateCalls().length).toBe(0);
  });

  it('never deletes the closure to recover', () => {
    withPersistedClosure();
    spyOn(window.sessionStorage, 'setItem').and.stub();

    component.reviewUpdatedOrder();

    // The record is untouched, so the established fact survives the failure
    // and the next tap can still act on it.
    expect(coordinator.record()!.closure).toEqual(CLOSURE);
  });

  it('never mints a successor while an acceptance is outstanding', () => {
    // Constructed: `applyQuoteRefusal` settles the command in the same write
    // that records the closure, so production does not reach this. It is
    // asserted because the renewal is what abandons a key, and this is the
    // one state where doing so produces two orders.
    component.initiateOrder();
    api.postPatch.calls.reset();
    coordinator.noteCommand({ orderId: 'o1', quoteRef: 'q1' });
    const key = coordinator.record()!.key;

    expect(coordinator.renewAfterClosure(CLOSURE).kind).toBe('outstanding');
    expect(coordinator.record()!.key).toBe(key);
    expect(coordinator.record()!.command).toEqual(
      { orderId: 'o1', quoteRef: 'q1' });
  });

  it('a CHANGED cart is preserved — it is a different purchase', () => {
    withPersistedClosure();
    // The diner edits before tapping. The renewal carries the purchase it was
    // made for; `reserveIntent` then sees a different basket and mints for
    // THAT, so nothing about the edit is lost or silently re-priced.
    basket = { items: [line('i1'), line('i2')], totalAmount: 10000 };
    api.postPatch.and.returnValue(of(initiated('o2', 'q2')) as any);

    component.reviewUpdatedOrder();

    expect(coordinator.record()!.request.identity)
      .toBe(basketService.contentIdentity());
    expect(keysSent().length).toBe(1);
  });

  it('a LOST successor replays K2 with the ORIGINAL lines', () => {
    withPersistedClosure();
    api.postPatch.and.returnValue(
      throwError(() => ({ status: 0 })) as any);

    component.reviewUpdatedOrder();
    const k2 = coordinator.record()!.key;
    const sentItems = initiateCalls()[0][1].items;
    api.postPatch.calls.reset();
    api.postPatch.and.returnValue(of(initiated('o2', 'q2')) as any);

    // The diner edits, then taps Retry. A retry is NOT an edit: the same
    // request goes back under the same key, so the server's idempotency
    // binding resolves it to one order.
    basket = { items: [line('i1'), line('i2')], totalAmount: 10000 };
    component.retryOrder();

    expect(keysSent()).toEqual([k2]);
    expect(initiateCalls()[0][1].items).toEqual(sentItems);
  });
});
