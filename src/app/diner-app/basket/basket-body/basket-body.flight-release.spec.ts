/**
 * D06 completion, G4 residual — A DESTROYED INSTANCE GIVES THE FLIGHT BACK.
 *
 * Codex P1 on PR #674, and correct. `renewQuote` guards both of its callbacks
 * with `mine()` — `!this.destroyed && this.checkout.settles(owner)` — and G4
 * added that guard for a real reason: an answer landing after the diner has
 * left the screen must not submit an order on behalf of it. What it did not do
 * is give the CHECKOUT FLIGHT back on the way out.
 *
 * The flight is APP-WIDE and SINGLE (D04/D): `placingOrder` is a getter over
 * `CheckoutCoordinatorService.inFlight()`, precisely so the routed basket page
 * and the desktop sidebar — the same component, mounted twice — cannot disagree
 * about whether a checkout is running. Every site that releases it is a method
 * on the instance that claimed it, so a token still held when that instance is
 * destroyed is held FOREVER: the sidebar (which lives beside the router outlet
 * and is never destroyed) and every later basket instance keep a disabled
 * Checkout button until the page is reloaded.
 *
 * EVERY OTHER DISCARD PATH IN THAT FILE ALREADY DOES THIS. `placeOrder` and
 * `submitOrder` both discard a late response through `releaseIfLatest`, which
 * releases. `renewQuote` — added by G4 — was the one that did not, and its
 * round trip (`PUT orders/retire-quote/`) is issued with the flight already
 * held by `confirmQuote`.
 *
 * THE FIX IS IN `ngOnDestroy`, NOT AT THE GUARD, and the difference is
 * load-bearing. A destroyed instance can have no NEWER operation, which is what
 * makes releasing unconditionally safe there. At the guard, the OTHER way
 * `mine()` goes false is that this instance moved the record on to a newer
 * attempt — and `holdCheckout()` is idempotent per instance, so that attempt
 * holds the SAME token. Releasing there would free a LIVE flight, which is the
 * exact hazard `releaseIfLatest` exists to avoid.
 *
 * Releasing on destroy drops no duplicate protection. The flight is a UI
 * single-flight; what prevents a second order is the durable record and the
 * idempotency key, and both survive — a surface that presses Checkout while an
 * acceptance issued by the destroyed instance is genuinely still in flight is
 * answered `outstanding` by `reserveIntent` and told so, rather than facing a
 * button that never comes back.
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

describe('BasketBodyComponent — the flight survives no instance', () => {
  let basket: { items: BasketItem[]; totalAmount: number };
  let api: jasmine.SpyObj<ApiService>;
  let basketService: any;
  let coordinator: CheckoutCoordinatorService;
  let fixture: ComponentFixture<BasketBodyComponent>;
  let component: BasketBodyComponent;
  let retire: Subject<any>;

  const AMOUNT = '5000.00';

  const line = () => ({
    itemId: 'i1', itemName: 'Burger', basePrice: 5000, totalPrice: 5000,
    quantity: 1, selectedModifiers: [], extras: [], isDiscounted: false,
  } as unknown as BasketItem);

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

  /** A CORRECTED quote whose deadline is long past here, so `confirmQuote`
   *  asks the server rather than submitting. */
  const priced = () => ({
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
          version: 1, status: 'live', expires_at: '2020-01-01T00:00:00Z',
        },
      },
      order_items: [], available_items: [], unavailable_items: [],
      extras: [], available_extras: [], unavailable_extras: [],
    },
  });

  function submitCalls(): any[] {
    return api.postPatch.calls.allArgs()
      .filter((args) => args[0] === 'orders/submit/');
  }

  beforeEach(async () => {
    basket = { items: [line()], totalAmount: 5000 };
    retire = new Subject<any>();
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

    api.postPatch.and.callFake(((route: string) => {
      if (route === 'orders/initiate/') return of(priced()) as any;
      if (route === 'orders/retire-quote/') return retire.asObservable() as any;
      return of({ status: 200, message: 'placed' }) as any;
    }) as any);
  });

  afterEach(() => {
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
  });

  /** Price a quote whose deadline has passed and confirm it, leaving the
   *  enquiry genuinely in flight with the flight held. */
  function askAndLeaveItOpen(): void {
    component.initiateOrder();
    (component as any).confirmQuote();
  }

  it('CONTROL: the enquiry holds the flight while it is open', () => {
    askAndLeaveItOpen();
    expect(coordinator.inFlight())
      .withContext('confirmQuote holds the flight across the enquiry')
      .toBeTrue();
    expect(component.placingOrder).toBeTrue();
  });

  it('THE REGRESSION: destroying the instance gives the flight back', () => {
    askAndLeaveItOpen();
    expect(coordinator.inFlight()).toBeTrue();

    fixture.destroy();

    expect(coordinator.inFlight())
      .withContext(
        'a destroyed instance can never release it later, so it must release '
        + 'on the way out — otherwise the surviving sidebar keeps a disabled '
        + 'Checkout button until the page is reloaded')
      .toBeFalse();
  });

  it('a LATER instance is not stuck in placingOrder', () => {
    askAndLeaveItOpen();
    fixture.destroy();

    // The desktop sidebar is the same component mounted beside the router
    // outlet; a fresh instance stands in for it here. It reads the one
    // coordinator, so a leaked flight disables ITS button too.
    const survivor = TestBed.createComponent(BasketBodyComponent);
    expect(survivor.componentInstance.placingOrder)
      .withContext('the surviving mount can still check out')
      .toBeFalse();
  });

  it('the discarded answer still submits nothing', () => {
    askAndLeaveItOpen();
    fixture.destroy();

    // The request was never cancelled — Angular does not cancel on destroy —
    // so the answer lands on a destroyed instance. Releasing the flight must
    // not weaken the G4 guard that keeps it from placing an order.
    retire.next({
      status: 200, outcome: 'quote_still_valid', order: 'o1', quote_ref: 'q1',
    });
    retire.complete();

    expect(submitCalls().length)
      .withContext('a destroyed screen never places an order')
      .toBe(0);
    expect(coordinator.inFlight()).toBeFalse();
  });

  it('an ERROR answer landing after destruction leaves nothing held', () => {
    askAndLeaveItOpen();
    fixture.destroy();

    retire.error({ status: 500 });

    expect(submitCalls().length).toBe(0);
    expect(coordinator.inFlight()).toBeFalse();
  });

  it('NEGATIVE CONTROL: a live instance keeps the flight until it answers', () => {
    askAndLeaveItOpen();
    expect(coordinator.inFlight()).toBeTrue();

    // Nothing has been destroyed and nothing has answered: the flight must
    // still be held, or the fix has simply stopped guarding the CTA.
    expect(coordinator.inFlight()).toBeTrue();

    retire.next({
      status: 200, outcome: 'quote_still_valid', order: 'o1', quote_ref: 'q1',
    });
    retire.complete();

    expect(submitCalls().length)
      .withContext('a live instance still submits on a correlated answer')
      .toBe(1);
  });
});
