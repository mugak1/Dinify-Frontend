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

  /**
   * ONE canonical line, PRICED COHERENTLY FROM ONE AMOUNT.
   *
   * It used to spell the same '5000.00' into every monetary key and let each
   * spec override whichever one it cared about, which produced fixtures the
   * real backend can never emit — a line whose parent-only figure disagreed
   * with its own parent-plus-extras figure, under a payable equal to neither.
   * Nothing noticed, because nothing reconciled. Now the client does, so the
   * fixture has to be as coherent as the server is.
   */
  const quoteLine = (over: Record<string, unknown> = {}) => {
    const amount = (over['amount'] as string) ?? '5000.00';
    const { amount: _ignored, ...rest } = over as Record<string, unknown>;
    return {
      id: 'l1', item: 'i1', item_name: 'Burger', quantity: 1,
      available: true, status: 'available',
      selected_modifiers: {}, modifiers: [], options: [],
      // CANONICAL DECIMAL STRINGS, exactly as the wire now carries them.
      unit_price: amount, reference_unit_price: amount,
      discounted_price: amount,
      unit_cost_of_options: '0.00', discounted: false,
      total_cost: amount, reference_total_cost: amount,
      discounted_cost: amount,
      savings: '0.00', line_actual_cost: amount,
      line_total_with_extras: amount,
      extras: [] as unknown[], ...rest,
    };
  };

  /** A whole coherent response for ONE line at `amount`. */
  const pricedAt = (amount: string, details: Record<string, unknown> = {}) =>
    initiated({ quote: [quoteLine({ amount })] },
              { quote_total: amount, actual_cost: Number(amount), ...details });

  const initiated = (over: Record<string, unknown> = {}, details: Record<string, unknown> = {}) => ({
    status: 200,
    data: {
      order_details: {
        id: 'o1',
        no_items: 1,
        no_available_items: 1,
        no_unavailable_items: 0,
        no_available_extras: 0,
        no_unavailable_extras: 0,
        actual_cost: 5000,
        quote_total: '5000.00',
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
    api.postPatch.and.returnValue(of(pricedAt('4321.00')) as any);

    component.initiateOrder();

    // The canonical string, formatted from the integer: the scale survives.
    expect(component.reviewedTotalDisplay).toBe('4,321.00');
  });

  it('states the exact scale the server sent, not a rounded double', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(
      of(pricedAt('899.10', { actual_cost: 899.1 })) as any,
    );

    component.initiateOrder();

    // `| number` would render this `899.1`; `Number(actual_cost)` cannot even
    // carry the distinction.
    expect(component.reviewedTotalDisplay).toBe('899.10');
    expect(component.quoteIsUnreadable).toBeFalse();
  });

  it('shows the review without trimming the basket when a line dropped', () => {
    basket.items = [lineItem(), lineItem({ itemId: 'i2', itemName: 'Fries' })];
    api.postPatch.and.returnValue(
      of(initiated(
        {
          unavailable_items: [{ id: 'i2', name: 'Fries' }],
          // The quote carries the dropped row too, at its saved zero — the
          // counts and the lines describe the same population.
          quote: [
            quoteLine(),
            quoteLine({ id: 'l2', item: 'i2', item_name: 'Fries',
                        amount: '0.00', available: false, quantity: 0 }),
          ],
        },
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
  // The payload is the REAL pre-D02 shape, field for field — none of `quote`,
  // `quote_ref`, `pricing_version` or `reference_total_cost` existed — so this
  // also pins that the reference is the ONLY thing the sheet needed from the
  // new response. Everything else it reads (`id`, `actual_cost`,
  // `no_available_items`, the two unavailable lists) predates the change.
  // --- the explicit invalid-quote state (D02 completion A) ----------------
  //
  // A CORRECTED response that cannot produce a reference or a readable amount is
  // an ANOMALY, not "an old server". The transitional tolerance for a genuinely
  // LEGACY response is deliberately preserved and tested separately below; this
  // block is about the case that must NOT be tolerated. None of these payloads
  // is claimed to have occurred in production — they are the states the client
  // has to refuse rather than confirm.

  it('refuses a CORRECTED quote that names no reference', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(
      of(initiated({}, { pricing_version: 1, quote_ref: undefined })) as any,
    );

    component.initiateOrder();

    expect(component.quoteIsUnreadable).toBeTrue();
    // A legacy response in the same shape IS tolerated — the discriminator is
    // `pricing_version`, which the server publishes, so the client never guesses.
    expect(component.basketItems.length).toBe(1);
  });

  it('refuses a CORRECTED quote whose payable cannot be read', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(initiated({}, {
      quote_total: 'not-a-number', actual_cost: undefined,
    })) as any);

    component.initiateOrder();

    expect(component.quoteIsUnreadable).toBeTrue();
    expect(component.reviewedTotalDisplay).toBeNull();
  });

  it('refuses a CORRECTED quote whose payable is unreadable BESIDE a usable actual_cost', () => {
    // Note the difference from the tolerance spec below: here the server SENT a
    // `quote_total` and it is malformed — a promise it broke — rather than
    // having never sent one at all.
    // THE FALLBACK IS LEGACY-ONLY. The test above passes with `actual_cost`
    // absent, so it could not tell a version-discriminated refusal from an
    // absence of anything to fall back to. Here the legacy numeric field is
    // present and perfectly parseable — and must NOT be used, because a
    // response declaring itself CORRECTED promised a canonical decimal total.
    // Reading `actual_cost` instead would revert the exact-money guarantee in
    // the one case it exists for, and do it silently.
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(initiated({}, {
      quote_total: 'not-a-number', actual_cost: 4321, pricing_version: 1,
    })) as any);

    component.initiateOrder();

    expect(component.quoteIsUnreadable).toBeTrue();
    expect(component.reviewedTotalDisplay).toBeNull();

    // And the refusal is enforced in the handler, not only by a hidden button.
    api.postPatch.calls.reset();
    component.confirmQuote();
    expect(api.postPatch).not.toHaveBeenCalled();
    expect(component.basketItems.length).toBe(1);
  });

  it('refuses a CORRECTED quote whose total is explicitly null', () => {
    // ABSENT AND NULL ARE NOT THE SAME SHAPE, and only absence means "older
    // server". A pre-field backend omits the key entirely (3c32ef5 does not
    // contain the string at all), so a JSON `null` can only come from a
    // CORRECTED server that sent the key and failed to express a value — a
    // broken promise, which must reach the refusal panel rather than fall back
    // to the lossy numeric field beside it.
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(initiated({}, {
      quote_total: null, actual_cost: 4321, pricing_version: 1,
    })) as any);

    component.initiateOrder();

    expect(component.quoteIsUnreadable).toBeTrue();
    expect(component.reviewedTotalDisplay).toBeNull();
  });

  it('still reviews a CORRECTED server that predates quote_total', () => {
    // THE DEPLOY WINDOW, as a test. Backend #314 shipped `pricing_version` and
    // stamps CORRECTED on every new order; `quote_total` only arrived in #315.
    // So this exact payload — corrected, quote_ref present, itemised lines, no
    // `quote_total` — is what a real deployed server returns between the two,
    // and in either direction of a rollback across them.
    //
    // Refusing it blocked checkout outright, which is what the transitional
    // tolerance exists to prevent. The server never promised a canonical total
    // here, so the legacy numeric one is still the best available truth.
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(pricedAt('4321.00', {
      quote_total: undefined, pricing_version: 1,
    })) as any);

    component.initiateOrder();

    expect(component.quoteIsUnreadable).toBeFalse();
    expect(component.reviewedTotalDisplay).toBe('4,321.00');
  });

  it('still reads actual_cost when the server declares itself LEGACY', () => {
    // The other half of the discrimination: an EXPLICIT legacy version keeps the
    // established tolerance, so the narrowing above cannot have been achieved by
    // simply deleting the fallback.
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(initiated({ quote: [] }, {
      quote_total: undefined, actual_cost: 4321,
      pricing_version: 0, quote_ref: undefined,
    })) as any);

    component.initiateOrder();

    expect(component.quoteIsUnreadable).toBeFalse();
    expect(component.reviewedTotalDisplay).toBe('4,321.00');
  });

  // --- R1: the WHOLE corrected quote is validated, not just its total ------
  //
  // SYNTHETIC PAYLOADS. Neither of these is claimed to have been observed from
  // a Dinify server; they are the two shapes source inspection showed the
  // client would confirm, and the reason it now refuses them. The rules
  // themselves are unit-tested in `_shared/order/quote-review.spec.ts`; what is
  // pinned here is that the COMPONENT — the sheet and the handler that places
  // the order — reaches the same verdict.

  it('refuses a CORRECTED quote that claims an available dish above no lines', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(initiated({ quote: [] }, {
      quote_total: '25.00', actual_cost: 25, no_available_items: 1,
    })) as any);

    component.initiateOrder();

    expect(component.quoteIsUnreadable).toBeTrue();
    expect(component.quoteRefusalReason).toBe('availability_counts');
    expect(component.reviewedTotalDisplay).toBeNull();
  });

  it('refuses a complete-looking quote whose lines do not add up to the payable', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(initiated({
      quote: [quoteLine({ amount: '10.00' })],
    }, { quote_total: '25.00', actual_cost: 25 })) as any);

    component.initiateOrder();

    expect(component.quoteIsUnreadable).toBeTrue();
    expect(component.quoteRefusalReason).toBe('order_reconciliation');
    expect(component.reviewedTotalDisplay).toBeNull();
  });

  it('does not submit a non-reconciling quote, and keeps the basket and key', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(initiated({
      quote: [quoteLine({ amount: '10.00' })],
    }, { quote_total: '25.00', actual_cost: 25 })) as any);
    component.initiateOrder();
    api.postPatch.calls.reset();

    component.confirmQuote();

    expect(api.postPatch).not.toHaveBeenCalled();
    expect(component.orderError).toBeTrue();
    // The basket is never trimmed, and the idempotency key is never re-minted
    // on a failure — a new key would turn one attempt into two orders.
    expect(component.basketItems.length).toBe(1);
    expect(basketService.resetClientOrderId).not.toHaveBeenCalled();
  });

  it('renders and confirms from ONE verdict for the same payload', () => {
    // The markup state and the handler must not be able to disagree: a
    // refusal the sheet shows is the same refusal `confirmQuote` enforces.
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(initiated({
      quote: [quoteLine({ extras: [{
        id: 'x1', item: 'xi1', item_name: 'Cheese', quantity: 1,
        available: true, status: 'available',
        unit_price: '2000.00', discounted_price: '2000.00',
        actual_cost: '2000.00',
      }] })],
    })) as any);

    component.initiateOrder();

    // The extra is not folded into the line aggregate, so the line does not
    // compose — refused by the same rule the template reads.
    expect(component.quoteIsUnreadable).toBeTrue();
    expect(component.quoteRefusalReason).toBe('line_reconciliation');
    api.postPatch.calls.reset();
    component.confirmQuote();
    expect(api.postPatch).not.toHaveBeenCalled();
  });

  it('confirms a line whose extras DO compose it, counting the child once', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(initiated({
      quote: [quoteLine({
        line_total_with_extras: '7000.00',
        extras: [{
          id: 'x1', item: 'xi1', item_name: 'Cheese', quantity: 1,
          available: true, status: 'available',
          unit_price: '2000.00', discounted_price: '2000.00',
          actual_cost: '2000.00',
        }],
      })],
    }, { quote_total: '7000.00', actual_cost: 7000 })) as any);

    component.initiateOrder();

    expect(component.quoteIsUnreadable).toBeFalse();
    expect(component.reviewedTotalDisplay).toBe('7,000.00');
  });

  it('refuses a quote the SERVER itself says does not cover the payable', () => {
    // The backend sets `quote_complete: false` when a live row contributing to
    // the payable belongs under no quoted line. Two independent mechanisms
    // then refuse it: this flag, and the reconciliation that would fail anyway.
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(
      of(initiated({}, { quote_complete: false })) as any,
    );

    component.initiateOrder();

    expect(component.quoteIsUnreadable).toBeTrue();
    expect(component.quoteRefusalReason).toBe('quote_incomplete');
  });

  it('is unaffected by a server that does not publish quote_complete', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(initiated()) as any);
    component.initiateOrder();
    expect(component.quoteIsUnreadable).toBeFalse();
  });

  it('refuses a CORRECTED quote with an unreadable line amount', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(initiated({
      quote: [quoteLine({ line_total_with_extras: null })],
    })) as any);

    component.initiateOrder();

    expect(component.quoteIsUnreadable).toBeTrue();
    expect(component.lineTotalDisplay(component.quoteLines[0])).toBeNull();
  });

  it('does not submit an unreadable quote even if confirm is invoked directly', () => {
    // GUARDED IN THE HANDLER, not only by a disabled button: the template state
    // is a display decision and this one places an order.
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(
      of(initiated({}, { quote_total: 'nonsense', actual_cost: undefined })) as any,
    );
    component.initiateOrder();
    api.postPatch.calls.reset();

    component.confirmQuote();

    expect(api.postPatch).not.toHaveBeenCalled();
    expect(component.orderError).toBeTrue();
    expect(component.showQuoteSheet).toBeFalse();
    // The basket and its idempotency key are retained for a retry.
    expect(component.basketItems.length).toBe(1);
  });

  it('treats a legitimately FREE order as readable and placeable', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(pricedAt('0.00')) as any);

    component.initiateOrder();

    expect(component.quoteIsUnreadable).toBeFalse();
    expect(component.reviewedTotalDisplay).toBe('0.00');
    expect(component.quoteHasNothingToPlace).toBeFalse();
  });

  it('states each line amount at the exact scale the server sent', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(pricedAt('2697.30')) as any);

    component.initiateOrder();

    expect(component.lineTotalDisplay(component.quoteLines[0])).toBe('2,697.30');
    expect(component.reviewedTotalDisplay).toBe('2,697.30');
  });

  const legacyInitiated = () => ({
    status: 200,
    data: {
      order_details: {
        id: 'o1',
        order_number: 'R1',
        no_items: 1,
        no_unavailable_items: 0,
        no_available_items: 1,
        no_available_extras: 0,
        no_unavailable_extras: 0,
        total_cost: 4321,
        discounted_cost: 4321,
        savings: 0,
        actual_cost: 4321,
        order_status: 'initiated',
        payment_status: 'pending',
      },
      order_items: [] as unknown[],
      available_items: [] as unknown[],
      unavailable_items: [] as unknown[],
      extras: [] as unknown[],
      available_extras: [] as unknown[],
      unavailable_extras: [] as unknown[],
    },
  });

  it('still reviews the server total when the server names no quote', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(legacyInitiated()) as any);

    component.initiateOrder();

    // Placeable: nothing about the legacy shape reads as "nothing to prepare".
    expect(component.quoteHasNothingToPlace).toBeFalse();
    expect(component.quoteHasLosses).toBeFalse();
    expect(component.quoteLines).toEqual([]);

    expect(component.showQuoteSheet).toBeTrue();
    expect(component.orderError).toBeFalse();
    // A LEGACY payload has no `quote_total`; the established numeric
    // `actual_cost` is still read, so the tolerance is unchanged.
    expect(component.reviewedTotalDisplay).toBe('4,321.00');
    expect(component.quoteIsUnreadable).toBeFalse();
    expect(component.placingOrder).toBeFalse();
    // Reviewed, not submitted — the diner has still agreed to nothing.
    expect(api.postPatch).toHaveBeenCalledTimes(1);
    expect(api.postPatch.calls.argsFor(0)[0]).toContain('orders/initiate');
  });

  it('OMITS quote_ref entirely rather than sending a null one', () => {
    basket.items = [lineItem()];
    api.postPatch.and.returnValue(of(legacyInitiated()) as any);
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
