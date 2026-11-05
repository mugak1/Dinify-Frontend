/**
 * Step 2 (diner round state v1) — WHAT CHECKOUT HANDS THE CONFIRMATION SCREEN.
 *
 * The submit reply's correlated projection may carry `current.round`
 * (`held` / `declined` / `released`). Checkout forwards it, in its WIRE form,
 * through navigation state alongside what it already forwarded, plus the
 * order's own key (the idempotency key) so the confirmation screen can re-read
 * a held round through the diner's existing order read. `history.state` is
 * what survives a reload of that screen; sessionStorage does not hold the key
 * any more, because the success path forgets it straight after navigating.
 *
 * Driven through the REAL component handler, coordinator and storage. Synthetic
 * replies, in the shape of the existing D04 Gate A fixtures.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { readDinerRound } from '../../../_shared/order/checkout-correlation';

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

describe('BasketBodyComponent — Step 2 round handoff to order-complete', () => {
  let router: Router;
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

  beforeEach(async () => {
    basket = { items: [line()], totalAmount: 5000 };
    api = jasmine.createSpyObj<ApiService>('ApiService', ['postPatch', 'get']);
    api.postPatch.and.returnValue(of() as any);
    api.get.and.returnValue(of({ data: null }) as any);
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);

    basketService = {
      Basket: () => basket,
      clearBasket: jasmine.createSpy('clearBasket'),
      revision: () => 3,
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

    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.stub();
    coordinator = TestBed.inject(CheckoutCoordinatorService);
    fixture = TestBed.createComponent(BasketBodyComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
  });

  /** The initiate reply. `checkout_protocol` is what the server states it can
   *  promise (backend D04/B) — the client is expected to remember it. */
  const initiated = (over: Record<string, unknown> = {}) => ({
    status: 200,
    data: {
      order_details: {
        id: 'o9', quote_ref: 'qref-9', actual_cost: 5000,
        no_items: 1, no_available_items: 1, no_unavailable_items: 0,
        no_available_extras: 0, no_unavailable_extras: 0,
        checkout_protocol: 3, ...over,
      },
      unavailable_items: [] as unknown[], unavailable_extras: [] as unknown[],
    },
  });

  /** Price a draft so a command can be issued for it. */
  function reviewed(over: Record<string, unknown> = {}): void {
    api.postPatch.and.returnValue(of(initiated(over)) as any);
    component.initiateOrder();
    api.postPatch.calls.reset();
  }

  /** A well-formed level-3 submit reply, overridable field by field. */
  const reply = (acceptance: Record<string, unknown> = {},
                 over: Record<string, unknown> = {}) => ({
    status: 200,
    checkout: {
      order_id: 'o9',
      intent_key: coordinator.record()?.key ?? null,
      scope: { restaurant: null, table: null },
      acceptance: {
        state: 'accepted', outcome: 'newly_accepted',
        quote_ref: 'qref-9', accepted_at: '2026-09-12T10:00:00+00:00',
        ...acceptance,
      },
      current: { order_status: 'pending', fulfilment_status: 'new',
                 cancelled_at: null, served_at: null },
      checkout_protocol: 3,
      ...over,
    },
  });

  /** The navigation-state object of the order-complete navigation. */
  function navState(): Record<string, unknown> {
    const call = (router.navigate as jasmine.Spy).calls.mostRecent();
    expect(call.args[0]).toEqual(['/diner', 'basket', 'order-complete']);
    return call.args[1].state;
  }

  it('forwards the reply\'s held round (wire form) and the order\'s own key', () => {
    reviewed();
    const key = coordinator.record()!.key;
    const round = { state: 'held', held_since: '2026-11-05T12:01:09+03:00', stale: false };
    api.postPatch.and.returnValue(of(reply({}, {
      current: { order_status: 'pending', fulfilment_status: 'new',
                 cancelled_at: null, served_at: null, round },
    })) as any);

    component.confirmQuote();

    const state = navState();
    expect(state['round']).toEqual(round);
    expect(state['intentKey']).toBe(key);
    // Read on the other side by the same reader the reply was read with.
    expect(readDinerRound(state['round'])?.state).toBe('held');
    // Everything forwarded before is still forwarded.
    expect(state['orderId']).toBe('o9');
    // And the key really has left storage, which is why it travels here.
    expect(coordinator.record()).toBeNull();
  });

  it('forwards a declined round as stated', () => {
    reviewed();
    api.postPatch.and.returnValue(of(reply({}, {
      current: { order_status: 'cancelled', fulfilment_status: 'new',
                 cancelled_at: '2026-11-05T12:05:00+03:00', served_at: null,
                 round: { state: 'declined', held_since: null, stale: false } },
    })) as any);

    component.confirmQuote();

    expect(readDinerRound(navState()['round'])?.state).toBe('declined');
  });

  it('TODAY\'S REPLY (no round): forwards round null, which reads as released', () => {
    reviewed();
    api.postPatch.and.returnValue(of(reply()) as any);

    component.confirmQuote();

    const state = navState();
    expect(state['round']).toBeNull();
    expect(readDinerRound(state['round'])).toBeNull();
    expect(state['orderId']).toBe('o9');
  });

  it('an older server (no projection at all): round null, nothing invented', () => {
    reviewed({ checkout_protocol: undefined });
    api.postPatch.and.returnValue(of({ status: 200 }) as any);

    component.confirmQuote();

    expect(navState()['round']).toBeNull();
  });
});
