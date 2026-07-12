import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { NEVER, of, throwError } from 'rxjs';
import { WINDOW } from '../../../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../../../_services/storage/storage-key-prefix.token';
import { BasketService } from '../../../_services/basket.service';
import { ApiService } from '../../../_services/api.service';
import { ToastService } from '../../../_shared/ui/toast/toast.service';
import { ConfirmDialogService } from '../../../_common/confirm-dialog.service';
import { ConnectivityService } from '../../../_services/connectivity.service';
import { BasketItem } from '../../../_models/app.models';
import { BasketBodyComponent } from './basket-body.component';
import { MenuNavStateService } from '../../menu/menu-nav-state.service';

describe('BasketBodyComponent', () => {
  let component: BasketBodyComponent;
  // Mutable basket backing the BasketService stub — basketItems is a getter over
  // basketService.Basket().items, so we drive it through this object per test.
  let basket: { items: BasketItem[]; totalAmount: number };

  // Collaborators for the order-placement flow.
  let api: jasmine.SpyObj<ApiService>;
  let dialog: jasmine.SpyObj<ConfirmDialogService>;
  let toast: jasmine.SpyObj<ToastService>;
  let basketService: {
    Basket: () => { items: BasketItem[]; totalAmount: number };
    getOrCreateClientOrderId: jasmine.Spy;
    clearBasket: jasmine.Spy;
  };
  let connectivity: { isOffline: () => boolean };
  let router: Router;

  // Stable idempotency key — mirrors BasketService reusing one id for an
  // unchanged basket, so a retry must re-send THIS value, not mint a new one.
  const CLIENT_ID = 'fixed-client-order-id';

  function lineItem(overrides: Partial<BasketItem> = {}): BasketItem {
    return {
      itemId: 'i1',
      itemName: 'Burger',
      basePrice: 5000,
      totalPrice: 5000,
      quantity: 1,
      selectedModifiers: [],
      extras: [],
      isDiscounted: false,
      ...overrides,
    } as BasketItem;
  }

  beforeEach(async () => {
    basket = { items: [], totalAmount: 0 };

    api = jasmine.createSpyObj<ApiService>('ApiService', ['postPatch']);
    api.postPatch.and.returnValue(of() as any); // inert default; order tests override

    dialog = jasmine.createSpyObj<ConfirmDialogService>('ConfirmDialogService', ['openModal', 'closeModal']);
    dialog.openModal.and.returnValue(of({ action: 'yes' }) as any);

    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info', 'warning', 'clear', 'dismiss']);

    connectivity = { isOffline: () => false };

    basketService = {
      Basket: () => basket,
      getOrCreateClientOrderId: jasmine.createSpy('getOrCreateClientOrderId').and.returnValue(CLIENT_ID),
      clearBasket: jasmine.createSpy('clearBasket'),
    };

    await TestBed.configureTestingModule({
      imports: [BasketBodyComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
        { provide: BasketService, useValue: basketService },
        { provide: ApiService, useValue: api },
        { provide: ConfirmDialogService, useValue: dialog },
        { provide: ToastService, useValue: toast },
        { provide: ConnectivityService, useValue: connectivity },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.stub();

    // Construct only — no detectChanges(): we exercise methods directly, skipping
    // ngOnInit's storage subscription and the full template render.
    component = TestBed.createComponent(BasketBodyComponent).componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // ── pricing (unchanged) ──────────────────────────────────────────────────
  it('counts a discounted extra on a non-discounted parent toward total savings', () => {
    basket.items = [
      lineItem({ extras: [{ id: 'e1', name: 'Cheese', cost: 800, originalCost: 1000 }] }),
    ];
    // original: (5000 base + 1000 extra original) * 1 = 6000
    // charged:  (5000 base +  800 extra cost)     * 1 = 5800
    expect(component.getTotalSavings()).toBe(200);
  });

  it('multiplies an extra-only saving by quantity', () => {
    basket.items = [
      lineItem({
        quantity: 2,
        extras: [{ id: 'e1', name: 'Cheese', cost: 800, originalCost: 1000 }],
      }),
    ];
    expect(component.getTotalSavings()).toBe(400);
  });

  it('reports no savings when neither parent nor extra is discounted', () => {
    basket.items = [lineItem({ extras: [{ id: 'e1', name: 'Cheese', cost: 800 }] })];
    expect(component.getTotalSavings()).toBe(0);
  });

  it('derives the honest pre-discount subtotal as total + savings', () => {
    basket.items = [lineItem({ isDiscounted: true, basePrice: 800, originalBasePrice: 1000 })];
    basket.totalAmount = 800;
    // savings = (1000 − 800) × 1 = 200 ⇒ subtotal = 800 + 200 = 1000 (subtotal − savings == total)
    expect(component.getTotalSavings()).toBe(200);
    expect(component.cartSubtotal).toBe(1000);
  });

  // ── inline placement error + retry ───────────────────────────────────────
  it('shows an inline error on a genuine placement failure, and Retry re-attempts idempotently without re-opening the dialog', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(throwError(() => 'no network') as any);

    component.initiateOrder();

    expect(dialog.openModal).toHaveBeenCalledTimes(1);
    expect(api.postPatch).toHaveBeenCalledTimes(1);
    expect(component.orderError).toBeTrue();
    expect(toast.clear).toHaveBeenCalled();
    expect((api.postPatch.calls.argsFor(0)[1] as any).client_order_id).toBe(CLIENT_ID);

    component.retryOrder();

    // Retry re-attempts placement reusing the same id, with NO second dialog.
    expect(api.postPatch).toHaveBeenCalledTimes(2);
    expect(dialog.openModal).toHaveBeenCalledTimes(1);
    expect((api.postPatch.calls.argsFor(1)[1] as any).client_order_id).toBe(CLIENT_ID);
  });

  it('surfaces the backend failure message inline on a genuine placement error', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(throwError(() => 'Sorry, Jollof Rice just sold out') as any);

    component.initiateOrder();

    expect(component.orderError).toBeTrue();
    expect(component.orderErrorMessage).toBe('Sorry, Jollof Rice just sold out');
  });

  it("falls back to the generic line for the 'no network' sentinel (never shows the raw token)", () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(throwError(() => 'no network') as any);

    component.initiateOrder();

    expect(component.orderError).toBeTrue();
    expect(component.orderErrorMessage).not.toContain('no network');
    expect(component.orderErrorMessage.toLowerCase()).toContain('place your order');
  });

  it('holds placingOrder true while an order is in flight (drives the checkout spinner)', () => {
    // A never-resolving request keeps the placement pending; the checkout CTA is
    // bound [loading]="placingOrder", so this is exactly the spinner-visible,
    // non-retappable window.
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(NEVER as any);

    component.initiateOrder();

    expect(component.placingOrder).toBeTrue();
    expect(component.orderError).toBeFalse();
  });

  // ── ongoing-order block (table already has an un-served order) ────────────
  it('blocks checkout on an initiate 400 ongoing-order: sets the shared flag, no navigation', () => {
    const navState = TestBed.inject(MenuNavStateService);
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(
      throwError(() => ({
        status: 400,
        message: 'The table has an ongoing order',
        data: { order_id: 'existing-123' },
      })) as any,
    );

    component.initiateOrder();

    // The reject is on initiate/, before any submit — so we never navigate.
    expect(api.postPatch).toHaveBeenCalledTimes(1);
    expect(api.postPatch.calls.argsFor(0)[0]).toContain('orders/initiate');
    expect(navState.tableOngoingOrder()).toBeTrue();
    expect(component.tableHasOngoingOrder).toBeTrue();
    expect(component.placingOrder).toBeFalse();
    expect(component.orderError).toBeFalse();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('refuses to initiate when the table already has an ongoing order', () => {
    const navState = TestBed.inject(MenuNavStateService);
    basket.items = [lineItem()];
    navState.setTableOngoingOrder(true);

    expect(component.tableHasOngoingOrder).toBeTrue();

    component.initiateOrder();

    expect(dialog.openModal).not.toHaveBeenCalled();
    expect(api.postPatch).not.toHaveBeenCalled();
  });

  it('forwards the real order id to order-complete on a successful submit', () => {
    component.order_initiated = { order_details: { id: 'o1' } } as any;
    component.table = { number: 3, id: 't1' };
    api.postPatch.and.returnValue(of({}) as any);

    component.submitOrder();

    expect(router.navigate).toHaveBeenCalledWith(
      ['/diner', 'basket', 'order-complete'],
      jasmine.objectContaining({ state: jasmine.objectContaining({ orderId: 'o1' }) }),
    );
    expect(basketService.clearBasket).toHaveBeenCalled();
  });

  it('resets transient placement state on a successful submit (persistent sidebar instance)', () => {
    // The desktop sidebar basket-body is never destroyed, so a stuck placingOrder
    // would keep the checkout button disabled after the table frees up.
    component.order_initiated = { order_details: { id: 'o1' } } as any;
    component.placingOrder = true;
    api.postPatch.and.returnValue(of({}) as any);

    component.submitOrder();

    // Navigation state was captured synchronously, so the order id still forwards…
    expect(router.navigate).toHaveBeenCalledWith(
      ['/diner', 'basket', 'order-complete'],
      jasmine.objectContaining({ state: jasmine.objectContaining({ orderId: 'o1' }) }),
    );
    // …but the transient state is cleared for the next order.
    expect(component.placingOrder).toBeFalse();
    expect(component.order_initiated).toBeUndefined();
  });

  it('shows an inline error on a genuine (non-400) submit failure without navigating', () => {
    component.order_initiated = { order_details: { id: 'o1' } } as any;
    api.postPatch.and.returnValue(throwError(() => 'no network') as any);

    component.submitOrder();

    expect(component.orderError).toBeTrue();
    expect(toast.clear).toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('short-circuits checkout when already offline: no dialog, no request, friendly message', () => {
    connectivity.isOffline = () => true;
    basket.items = [lineItem()];

    component.initiateOrder();

    expect(dialog.openModal).not.toHaveBeenCalled();
    expect(api.postPatch).not.toHaveBeenCalled();
    expect(component.orderError).toBeTrue();
    expect(component.orderErrorMessage.toLowerCase()).toContain('offline');
  });
});
