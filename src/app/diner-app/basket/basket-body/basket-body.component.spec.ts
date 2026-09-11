import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { NEVER, Subject, of, throwError } from 'rxjs';
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
    revision: () => number;
    resetClientOrderId: jasmine.Spy;
    incrementItem: (index: number) => void;
    decrementItem: (index: number) => void;
  };
  // The basket's own change counter. A quote is bound to the revision it was
  // priced for, so a test that edits the basket must bump it exactly as
  // BasketService does on a real mutation.
  let revision: number;
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

  const quoteLine = (over: Record<string, unknown> = {}) => ({
    id: 'l1', item: 'i1', item_name: 'Burger', quantity: 1,
    available: true, status: 'available',
    selected_modifiers: {}, modifiers: [], options: [],
    unit_price: 5000, reference_unit_price: 5000, discounted_price: 5000,
    unit_cost_of_options: 0, discounted: false,
    total_cost: 5000, reference_total_cost: 5000, discounted_cost: 5000,
    savings: 0, line_actual_cost: 5000, line_total_with_extras: 5000,
    extras: [] as unknown[], ...over,
  });

  const initiated = (over: Record<string, unknown> = {}, details: Record<string, unknown> = {}) => ({
    status: 200,
    data: {
      order_details: {
        id: 'o1',
        no_unavailable_items: 0,
        no_unavailable_extras: 0,
        actual_cost: 5000,
        reference_total_cost: 5000,
        pricing_version: 1,
        quote_ref: 'qref-1',
        ...details,
      },
      unavailable_items: [] as unknown[],
      unavailable_extras: [] as unknown[],
      quote: [quoteLine()],
      ...over,
    },
  });

  beforeEach(async () => {
    basket = { items: [], totalAmount: 0 };
    revision = 0;

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
      revision: () => revision,
      resetClientOrderId: jasmine.createSpy('resetClientOrderId'),
      incrementItem: (index: number) => {
        const line = basket.items[index];
        if (line) { line.quantity += 1; revision += 1; }
      },
      decrementItem: (index: number) => {
        const line = basket.items[index];
        if (!line) return;
        revision += 1;
        if (line.quantity === 1) basket.items = basket.items.filter((l) => l !== line);
        else line.quantity -= 1;
      },
    };

    await TestBed.configureTestingModule({
      imports: [BasketBodyComponent],
      providers: [
        provideHttpClient(withXhr()),
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
  it('shows an inline error on a genuine placement failure, and Retry re-attempts idempotently', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(throwError(() => 'no network') as any);

    component.initiateOrder();

    // NO pre-pricing confirm dialog: it asked "are you sure?" about a number
    // this browser computed. The only confirmation is the server's quote.
    expect(dialog.openModal).not.toHaveBeenCalled();
    expect(api.postPatch).toHaveBeenCalledTimes(1);
    expect(component.orderError).toBeTrue();
    expect(toast.clear).toHaveBeenCalled();
    expect((api.postPatch.calls.argsFor(0)[1] as any).client_order_id).toBe(CLIENT_ID);

    component.retryOrder();

    // Retry re-attempts placement reusing the same id, and still no dialog.
    expect(api.postPatch).toHaveBeenCalledTimes(2);
    expect(dialog.openModal).not.toHaveBeenCalled();
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

  it('omits raw restaurant/table identifiers from the initiate body (the session governs scope)', () => {
    basket.items = [lineItem()];
    // Even if the component holds table/restaurant context, none of it is sent as
    // authority — the backend derives scope from X-Diner-Session, closing the
    // cross-table body-id override vector.
    component.table = { id: 'some-table', number: 9 } as any;
    component.restaurant = { id: 'some-restaurant' } as any;
    api.postPatch.and.returnValue(of(initiated()) as any);

    component.initiateOrder();

    const body = api.postPatch.calls.argsFor(0)[1] as any;
    expect(api.postPatch.calls.argsFor(0)[0]).toContain('orders/initiate');
    expect(body.client_order_id).toBe(CLIENT_ID);
    expect(body.items.length).toBe(1);
    expect('table' in body).toBeFalse();
    expect('restaurant' in body).toBeFalse();
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

  // ── the authoritative quote review at checkout ────────────────────────────
  // The server prices the order and the diner confirms THAT — not a browser
  // estimate. The review sheet is shown for EVERY order, not only when a line
  // dropped: correct calculation is not agreement to an amount, and the old
  // flow auto-submitted whenever nothing happened to be sold out. The local
  // basket is never silently mutated and a rejected line is never re-POSTed.
  it('reviews the SERVER quote before submitting, even when nothing dropped', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(initiated()) as any);

    component.initiateOrder();

    // Initiate ran; submit did NOT — the diner has not agreed to anything yet.
    expect(component.showQuoteSheet).toBeTrue();
    expect(api.postPatch).toHaveBeenCalledTimes(1);
    expect(api.postPatch.calls.argsFor(0)[0]).toContain('orders/initiate');
    expect(component.placingOrder).toBeFalse();
    expect(component.quoteHasLosses).toBeFalse();
    expect(component.quoteLines.length).toBe(1);
    // The initiate payload carries the basket items unchanged.
    expect((api.postPatch.calls.argsFor(0)[1] as any).items.length).toBe(1);
    expect((api.postPatch.calls.argsFor(0)[1] as any).items[0].item).toBe('i1');
  });

  it('renders the SERVER total, never a recomputed one', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(
      of(initiated({}, { actual_cost: 4321 })) as any,
    );

    component.initiateOrder();

    expect(component.reviewedTotal).toBe(4321);
  });

  it('shows the review without trimming the basket when a line dropped', () => {
    basket.items = [lineItem(), lineItem({ itemId: 'i2', itemName: 'Fries' })];
    api.postPatch.and.returnValue(
      of(initiated(
        { unavailable_items: [{ id: 'i2', name: 'Fries' }] },
        { no_unavailable_items: 1 },
      )) as any,
    );

    component.initiateOrder();

    expect(component.showQuoteSheet).toBeTrue();
    expect(component.quoteHasLosses).toBeTrue();
    expect(api.postPatch).toHaveBeenCalledTimes(1);
    expect(basket.items.length).toBe(2);
    expect(component.unavailableItems).toEqual([{ id: 'i2', name: 'Fries' }]);
  });

  it('confirmQuote submits the initiated order id plus the quote it reviewed', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(initiated()) as any);
    component.initiateOrder();
    expect(component.showQuoteSheet).toBeTrue();

    api.postPatch.calls.reset();
    api.postPatch.and.returnValue(of({}) as any);

    component.confirmQuote();

    expect(component.showQuoteSheet).toBeFalse();
    // Exactly one follow-up call, to submit/ with the order id AND the
    // acknowledgement — NOT another initiate/ with the item payload.
    expect(api.postPatch).toHaveBeenCalledTimes(1);
    expect(api.postPatch.calls.argsFor(0)[0]).toContain('orders/submit');
    expect(api.postPatch.calls.argsFor(0)[0]).not.toContain('orders/initiate');
    expect(api.postPatch.calls.argsFor(0)[1]).toEqual({
      order: 'o1', quote_ref: 'qref-1',
    });
  });

  // The review sheet is the LOCK on the basket while an acceptance is in
  // flight. Closing it on confirm handed the live basket straight back: the
  // quantity steppers are not disabled during a submit and the checkout CTA had
  // already been released when the sheet opened, so a slow submission let the
  // diner edit the basket or start a second checkout — and the success handler
  // then cleared the basket and navigated away, taking those edits with it.
  it('keeps the review up, in a loading state, until the submit resolves', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(initiated()) as any);
    component.initiateOrder();

    const pending = new Subject<any>();
    api.postPatch.calls.reset();
    api.postPatch.and.returnValue(pending as any);
    component.confirmQuote();

    expect(component.showQuoteSheet).toBeTrue();
    expect(component.placingOrder).toBeTrue();

    // And dismissing it is inert while the acceptance may already have
    // committed server-side.
    component.cancelQuote();
    expect(component.showQuoteSheet).toBeTrue();

    pending.next({});
    pending.complete();
    expect(component.showQuoteSheet).toBeFalse();
  });

  it('gives the basket back when the submit fails, with the error at the footer', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(initiated()) as any);
    component.initiateOrder();

    api.postPatch.calls.reset();
    api.postPatch.and.returnValue(throwError(() => 'Something went wrong.') as any);
    component.confirmQuote();

    expect(component.showQuoteSheet).toBeFalse();
    expect(component.placingOrder).toBeFalse();
    expect(component.orderError).toBeTrue();
    expect(basket.items.length).toBe(1);
  });

  it('cancelQuote closes the sheet and submits nothing', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(initiated()) as any);
    component.initiateOrder();
    expect(component.showQuoteSheet).toBeTrue();

    api.postPatch.calls.reset();
    component.cancelQuote();

    expect(component.showQuoteSheet).toBeFalse();
    expect(api.postPatch).not.toHaveBeenCalled();
    expect(basket.items.length).toBe(1);
  });

  // ── compatibility with a server that prices the old way ───────────────────
  // This client ships BEFORE the paired backend, so for that window the
  // initiate response carries no quote_ref. Treating that as a failure would
  // take checkout down entirely — an outage produced by the change meant to
  // make checkout truthful. The diner still reviews and confirms the SERVER's
  // total; only the acknowledgement, which that server never issued and does
  // not ask for, is absent.
  it('still reviews the server total when the server names no quote', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(
      of(initiated({ quote: undefined }, { quote_ref: undefined, actual_cost: 4321 })) as any,
    );

    component.initiateOrder();

    expect(component.showQuoteSheet).toBeTrue();
    expect(component.orderError).toBeFalse();
    expect(component.reviewedTotal).toBe(4321);
    expect(component.placingOrder).toBeFalse();
    // Reviewed, not submitted — the diner has still agreed to nothing.
    expect(api.postPatch).toHaveBeenCalledTimes(1);
    expect(api.postPatch.calls.argsFor(0)[0]).toContain('orders/initiate');
  });

  it('OMITS quote_ref entirely rather than sending a null one', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(
      of(initiated({ quote: undefined }, { quote_ref: undefined })) as any,
    );
    component.initiateOrder();

    api.postPatch.calls.reset();
    api.postPatch.and.returnValue(of({}) as any);
    component.confirmQuote();

    expect(api.postPatch.calls.argsFor(0)[0]).toContain('orders/submit');
    // Exactly `{order}` — no key at all, so nothing asserts about a quote that
    // was never issued.
    expect(api.postPatch.calls.argsFor(0)[1]).toEqual({ order: 'o1' });
  });

  // A LATE response priced a basket the diner has moved on from. It is neither
  // rendered nor submitted, and the draft it created is left alone — this
  // client cannot know the draft was not something else's.
  it('discards a response for a basket that changed while it was in flight', () => {
    basket.items = [lineItem()];
    const late = new Subject<any>();
    api.postPatch.and.returnValue(late as any);

    component.initiateOrder();
    basket.items = [lineItem({ quantity: 4 })];
    revision += 1;
    late.next(initiated());
    late.complete();

    expect(component.showQuoteSheet).toBeFalse();
    expect(api.postPatch).toHaveBeenCalledTimes(1);
    // ...AND the checkout button is given back. Discarding is correct, but the
    // button was put into its loading state when the attempt started and
    // nothing else clears it — the diner would be left unable to check out the
    // basket they had just edited, with no way back but a reload.
    expect(component.placingOrder).toBeFalse();
  });

  // ...unless a NEWER attempt is still in flight: that one owns the loading
  // state, and re-enabling the button underneath it invites a second checkout
  // for a basket already being priced.
  it('leaves the button loading when a newer attempt is still in flight', () => {
    basket.items = [lineItem()];
    const first = new Subject<any>();
    const second = new Subject<any>();
    api.postPatch.and.returnValue(first as any);
    component.initiateOrder();

    api.postPatch.and.returnValue(second as any);
    component.initiateOrder();

    // The FIRST response lands late, for a superseded attempt.
    first.next(initiated());
    first.complete();

    expect(component.showQuoteSheet).toBeFalse();
    expect(component.placingOrder).toBeTrue();
  });

  // The reviewed quote is bound to the basket it was priced for. Editing the
  // basket while the sheet is open invalidates it rather than silently
  // submitting the older amount.
  it('marks a reviewed quote stale once the basket changes underneath it', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(initiated()) as any);
    component.initiateOrder();
    expect(component.quoteIsStale).toBeFalse();

    basket.items = [lineItem({ quantity: 2 })];
    revision += 1;

    expect(component.quoteIsStale).toBeTrue();
  });

  // A draft this device started BEFORE the corrected pricing shipped. The
  // basket is KEPT — only the stale draft is discarded — so the diner
  // re-reviews the same selections at today's prices.
  it('offers recovery for a legacy draft instead of submitting it', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(initiated()) as any);
    component.initiateOrder();
    api.postPatch.calls.reset();
    api.postPatch.and.returnValue(
      throwError(() => ({ status: 400, message: 'Prices have changed.', reason: 'legacy_pricing_version' })) as any,
    );

    component.confirmQuote();

    expect(component.legacyDraft).toBeTrue();
    expect(basket.items.length).toBe(1);

    api.postPatch.calls.reset();
    api.postPatch.and.returnValue(of(initiated()) as any);
    component.reviewUpdatedOrder();

    expect(component.legacyDraft).toBeFalse();
    // Re-prices from scratch rather than re-submitting the stale draft.
    expect(api.postPatch.calls.argsFor(0)[0]).toContain('orders/initiate');
  });

  // The server refused the acknowledgement because the saved quote moved. The
  // diner must see the new one, never have the new amount accepted silently.
  it('re-reviews rather than retrying when the server calls the quote stale', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(initiated()) as any);
    component.initiateOrder();
    api.postPatch.calls.reset();
    api.postPatch.and.returnValue(
      throwError(() => ({ status: 400, message: 'Your order total changed.', reason: 'quote_ref_stale' })) as any,
    );

    component.confirmQuote();

    expect(component.showQuoteSheet).toBeFalse();
    expect(component.orderError).toBeTrue();
    expect(basket.items.length).toBe(1);
  });

  // ── D01 request ceilings, said before the round trip ──────────────────────
  it('refuses to place an order over the per-line ceiling, keeping the basket', () => {
    basket.items = [lineItem({ quantity: 120 })];
    api.postPatch.calls.reset();

    component.initiateOrder();

    expect(api.postPatch).not.toHaveBeenCalled();
    expect(component.orderError).toBeTrue();
    expect(component.limitState.breach).toBe('line_quantity');
    expect(component.isOverLineLimit(0)).toBeTrue();
    // The basket is RETAINED and stays reducible.
    expect(basket.items.length).toBe(1);
  });

  it('stops the stepper at the ceiling but still allows reduction', () => {
    basket.items = [lineItem({ quantity: 99 })];
    expect(component.atLineCeiling(0)).toBeTrue();

    component.incrementItem(0);
    expect(basket.items[0].quantity).toBe(99);

    component.decrementItem(0);
    expect(basket.items[0].quantity).toBe(98);
  });
});
