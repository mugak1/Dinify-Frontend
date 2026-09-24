/**
 * QG01 — THE REVIEW SHEET IS RENDERED, not merely computed.
 *
 * WHY THIS FILE EXISTS SEPARATELY. `basket-body.component.spec.ts` constructs
 * the component and deliberately never calls `detectChanges()` — it exercises
 * methods directly. That is a reasonable way to test handlers and it is why no
 * existing spec could observe any of the defects below: every one of them is a
 * throw raised by the TEMPLATE while drawing a row, on a payload the pure
 * validator had already judged. So these specs render, and their central
 * assertion is that rendering does not throw.
 *
 * THE FOUR ACCEPTANCE CASES are the shapes that actually threw against the real
 * template at f426eba:
 *
 *   quote: [null]            -> `track line.id`      on a null row
 *   extras: [null]           -> `track extra.id`     on a null child
 *   modifiers: 'Large'       -> `modifiers.join(...)` behind an `?.length`
 *   modifiers: {length: 1}      test that a string and a shaped object both pass
 *
 * The last two are the instructive pair: the validator did NOT refuse them,
 * because `modifiers` is a display field and the monetary contract never looked
 * at it. The quote read as confirmable, the Place order button was live, and
 * the panel threw while drawing the row the diner was being asked to agree to.
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
import { CheckoutCoordinatorService } from '../../../_services/checkout-coordinator.service';
import { ToastService } from '../../../_shared/ui/toast/toast.service';
import { ConfirmDialogService } from '../../../_common/confirm-dialog.service';
import { ConnectivityService } from '../../../_services/connectivity.service';
import { BasketItem } from '../../../_models/app.models';
import { BasketBodyComponent } from './basket-body.component';
import { reviewQuote } from '../../../_shared/order/quote-review';

describe('BasketBodyComponent — review sheet rendering (QG01)', () => {
  let basket: { items: BasketItem[]; totalAmount: number };
  let api: jasmine.SpyObj<ApiService>;
  let basketService: any;
  let fixture: ComponentFixture<BasketBodyComponent>;
  let component: BasketBodyComponent;

  const CLIENT_ID = 'fixed-client-order-id';

  /** One coherent CORRECTED line at `amount`, priced so it reconciles. */
  const quoteLine = (over: Record<string, unknown> = {}) => {
    const amount = (over['amount'] as string) ?? '5000.00';
    const rest: Record<string, unknown> = { ...over };
    delete rest['amount'];
    return {
      id: 'l1', item: 'i1', item_name: 'Burger', quantity: 1,
      available: true, status: 'available',
      selected_modifiers: {}, modifiers: [], options: [],
      unit_price: amount, reference_unit_price: amount,
      discounted_price: amount, unit_cost_of_options: '0.00', discounted: false,
      total_cost: amount, reference_total_cost: amount, discounted_cost: amount,
      savings: '0.00', line_actual_cost: amount, line_total_with_extras: amount,
      extras: [] as unknown[], ...rest,
    };
  };

  const payload = (
    quote: unknown, details: Record<string, unknown> = {},
  ): any => ({
    order_details: {
      id: 'o1', no_items: 1, no_available_items: 1, no_unavailable_items: 0,
      no_available_extras: 0, no_unavailable_extras: 0,
      actual_cost: 5000, quote_total: '5000.00', reference_total_cost: 5000,
      pricing_version: 1, quote_ref: 'qref-1', ...details,
    },
    unavailable_items: [] as unknown[], unavailable_extras: [] as unknown[],
    quote,
  });

  beforeEach(async () => {
    basket = { items: [], totalAmount: 0 };
    api = jasmine.createSpyObj<ApiService>('ApiService', ['postPatch', 'get']);
    api.postPatch.and.returnValue(of() as any);
    api.get.and.returnValue(of() as any);
    // D04/D: `sessionStorage` is shared across Karma cases, so a persisted
    // checkout attempt from an earlier one would make this component resume a
    // recovery it knows nothing about. Cleared per case, not per file.
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
    const dialog = jasmine.createSpyObj<ConfirmDialogService>(
      'ConfirmDialogService', ['openModal', 'closeModal']);
    const toast = jasmine.createSpyObj<ToastService>(
      'ToastService', ['success', 'error', 'info', 'warning', 'clear', 'dismiss']);
    basketService = {
      Basket: () => basket,
      getOrCreateClientOrderId: jasmine.createSpy('getOrCreateClientOrderId')
        .and.returnValue(CLIENT_ID),
      clearBasket: jasmine.createSpy('clearBasket'),
      revision: () => 0,
      resetClientOrderId: jasmine.createSpy('resetClientOrderId'),
      // The REAL derivation, so these fakes bind to the identity
      // production computes rather than a literal that could drift.
      contentIdentity: () =>
        BasketService.prototype.contentIdentity.call(basketService),
      totalState: (items: BasketItem[]) =>
        BasketService.prototype.totalState.call(basketService, items),
    };

    await TestBed.configureTestingModule({
      imports: [BasketBodyComponent],
      providers: [
        provideHttpClient(withXhr()), provideHttpClientTesting(), provideRouter([]),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
        { provide: BasketService, useValue: basketService },
        { provide: ApiService, useValue: api },
        { provide: ConfirmDialogService, useValue: dialog },
        { provide: ToastService, useValue: toast },
        { provide: ConnectivityService, useValue: { isOffline: () => false } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    spyOn(TestBed.inject(Router), 'navigate').and.stub();
    fixture = TestBed.createComponent(BasketBodyComponent);
    component = fixture.componentInstance;
    basket.items = [{
      itemId: 'i1', itemName: 'Burger', basePrice: 5000, totalPrice: 5000,
      quantity: 1, selectedModifiers: [], extras: [], isDiscounted: false,
    } as unknown as BasketItem];
  });

  /** Open the review sheet for `body` and RENDER it. Throws if the template does. */
  function render(body: any): HTMLElement {
    component.order_initiated = body;
    component.showQuoteSheet = true;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /** A basket whose total differs from the quote, so the ITEMISED review
   *  renders instead of the plain "Are you sure?" prompt. */
  function basketTotal(amount: number): void {
    basket.items[0] = { ...basket.items[0], basePrice: amount, totalPrice: amount } as BasketItem;
  }

  const text = (el: HTMLElement) => el.textContent ?? '';
  const q = (el: HTMLElement, sel: string) => el.querySelectorAll(sel);

  // ── the four shapes that threw ─────────────────────────────────────────
  const UNRENDERABLE: Array<[string, unknown]> = [
    ['a null parent row', [null]],
    ['a null nested extra', [quoteLine({ extras: [null] })]],
    ['a string where modifier labels belong', [quoteLine({ modifiers: 'Large' })]],
    ['an object that merely has a length', [quoteLine({ modifiers: { length: 1 } })]],
  ];

  for (const [label, quote] of UNRENDERABLE) {
    describe(label, () => {
      it('is refused by the shared boundary, so the handler and the view agree', () => {
        expect(reviewQuote(payload(quote)).readable).toBe(false);
      });

      it('renders an error-only panel instead of throwing', () => {
        let root!: HTMLElement;
        expect(() => { root = render(payload(quote)); }).not.toThrow();
        expect(q(root, '[data-testid="quote-unreadable"]').length).toBe(1);
        expect(text(root)).toContain("We couldn't read the restaurant's price");
      });

      it('draws no line, no total and no confirm button', () => {
        const root = render(payload(quote));
        expect(q(root, '[data-testid="quote-line"]').length).toBe(0);
        expect(q(root, '[data-testid="quote-line-amount"]').length).toBe(0);
        expect(q(root, '[data-testid="quote-line-modifiers"]').length).toBe(0);
        expect(q(root, '[data-testid="quote-line-extra"]').length).toBe(0);
        expect(q(root, '[data-testid="quote-total"]').length).toBe(0);
        expect(text(root)).not.toContain('Place order');
      });

      it('confirming anyway submits nothing and leaves the basket and key alone', () => {
        render(payload(quote));
        component.confirmQuote();
        fixture.detectChanges();

        expect(api.postPatch).not.toHaveBeenCalled();
        expect(basketService.clearBasket).not.toHaveBeenCalled();
        expect(basketService.resetClientOrderId).not.toHaveBeenCalled();
        expect(basket.items.length).toBe(1);
      });

      it('offers a safe way back, and going back throws nothing', () => {
        const root = render(payload(quote));
        expect(text(root)).toContain('Back to basket');
        expect(() => { component.cancelQuote(); fixture.detectChanges(); }).not.toThrow();
        expect(component.showQuoteSheet).toBe(false);
        expect(api.postPatch).not.toHaveBeenCalled();
      });
    });
  }

  // ── the states that must STAY understandable ───────────────────────────
  // ── the plain prompt for an ordinary quote ─────────────────────────────
  it('AN ORDINARY QUOTE GETS THE PLAIN "Are you sure?" PROMPT, not the itemised sheet', () => {
    const root = render(payload([quoteLine({ modifiers: ['Size: Large'] })]));
    expect(component.quoteNeedsReview).toBe(false);
    expect(q(root, '[data-testid="checkout-confirm"]').length).toBe(1);
    expect(text(root)).toContain('Are you sure you want to place this order?');
    expect(text(root)).toContain('Order');
    expect(text(root)).toContain('Cancel');
    expect(q(root, '[data-testid="quote-line"]').length).toBe(0);
    expect(text(root)).not.toContain('Review your order');
  });

  it('the plain prompt submits the SAME quote through confirmQuote', () => {
    const root = render(payload([quoteLine()]));
    const confirm = spyOn(component, 'confirmQuote');
    const order = Array.from(root.querySelectorAll('[data-testid="checkout-confirm"] button'))
      .find(b => b.textContent?.trim() === 'Order') as HTMLButtonElement;
    order.click();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('Cancel on the plain prompt returns to the basket and submits nothing', () => {
    const root = render(payload([quoteLine()]));
    const cancel = Array.from(root.querySelectorAll('[data-testid="checkout-confirm"] button'))
      .find(b => b.textContent?.trim() === 'Cancel') as HTMLButtonElement;
    cancel.click();
    fixture.detectChanges();
    expect(component.showQuoteSheet).toBe(false);
    expect(api.postPatch).not.toHaveBeenCalled();
  });

  it('the plain prompt is a lock while the order is being placed', () => {
    const root = render(payload([quoteLine()]));
    spyOnProperty(component, 'placingOrder', 'get').and.returnValue(true);
    fixture.detectChanges();
    const buttons = Array.from(
      root.querySelectorAll('[data-testid="checkout-confirm"] button')) as HTMLButtonElement[];
    expect(buttons.length).toBe(2);
    expect(buttons.every(b => b.disabled)).toBe(true);
    component.cancelQuote();
    expect(component.showQuoteSheet).toBe(true);
  });

  it('A CHANGED TOTAL gets the itemised review, never the plain prompt', () => {
    basketTotal(4500);
    const root = render(payload([quoteLine()]));
    expect(component.quoteNeedsReview).toBe(true);
    expect(q(root, '[data-testid="checkout-confirm"]').length).toBe(0);
    expect(text(root)).toContain('Review your order');
    expect(text(root)).toContain('The total has changed');
  });

  it('AN ESTIMATED BASKET TOTAL gets the itemised review even when it matches '
     + 'the server (Codex P2 on PR #693)', () => {
    // A legacy basket line whose base price cannot be read: the fallback figure
    // still lands on 5,000, but the basket labels it an estimate.
    basket.items[0] = {
      ...basket.items[0], basePrice: 'not-a-price' as unknown as number,
      totalPrice: 5000,
    } as BasketItem;
    const root = render(payload([quoteLine()]));
    expect(component.totalIsExact).toBe(false);
    expect(component.totalAmount).toBe(5000);
    expect(component.quoteDiffersFromBasket).toBe(false);
    expect(component.quoteNeedsReview).toBe(true);
    expect(q(root, '[data-testid="checkout-confirm"]').length).toBe(0);
    expect(q(root, '[data-testid="quote-total"]')[0].textContent)
      .toContain('UGX 5,000.00');
  });

  it('A DROPPED ITEM gets the itemised review, never the plain prompt', () => {
    const body = payload([quoteLine()]);
    body.unavailable_items = [{ item: 'i2', item_name: 'Chips', quantity: 1 }];
    const root = render(body);
    expect(q(root, '[data-testid="checkout-confirm"]').length).toBe(0);
    expect(text(root)).toContain('Some items are no longer available');
  });

  it('renders a legitimate quote, its line, its labels and its total', () => {
    basketTotal(4500);
    const root = render(payload([quoteLine({ modifiers: ['Size: Large'] })]));
    expect(q(root, '[data-testid="quote-line"]').length).toBe(1);
    expect(q(root, '[data-testid="quote-line-modifiers"]')[0].textContent)
      .toContain('Size: Large');
    expect(q(root, '[data-testid="quote-total"]')[0].textContent)
      .toContain('UGX 5,000.00');
    expect(text(root)).toContain('Place order');
  });

  it('renders nested extras beneath their parent', () => {
    basketTotal(4500);
    const root = render(payload([quoteLine({
      amount: '5000.00',
      line_actual_cost: '4000.00',
      extras: [{
        id: 'e1', item: 'x1', item_name: 'Cheese', quantity: 1, available: true,
        status: 'available', unit_price: '1000.00', discounted_price: '1000.00',
        actual_cost: '1000.00',
      }],
    })]));
    expect(q(root, '[data-testid="quote-line-extra"]')[0].textContent)
      .toContain('Cheese');
  });

  it('A FREE DISH IS CONFIRMABLE — 0.00 is a price, not an absence', () => {
    const root = render(payload([quoteLine({ amount: '0.00' })],
                                { quote_total: '0.00', actual_cost: 0 }));
    expect(q(root, '[data-testid="quote-unreadable"]').length).toBe(0);
    expect(q(root, '[data-testid="quote-total"]')[0].textContent).toContain('UGX 0.00');
    expect(text(root)).toContain('Place order');
  });

  it('AN ALL-UNAVAILABLE QUOTE IS UNDERSTANDABLE, not invalid', () => {
    const root = render(payload(
      [quoteLine({ available: false, quantity: 0, amount: '0.00' })],
      { quote_total: '0.00', actual_cost: 0,
        no_available_items: 0, no_unavailable_items: 1 },
    ));
    expect(q(root, '[data-testid="quote-unreadable"]').length).toBe(0);
    expect(text(root)).toContain('nothing to send to');
    expect(text(root)).not.toContain('Place order');
  });

  it('#661 COMPATIBILITY SURVIVES: a CORRECTED server that never sent a '
     + 'quote_total still reviews through actual_cost', () => {
    const body = payload([quoteLine()], {});
    delete body.order_details.quote_total;          // ABSENT, never null
    basketTotal(4500);
    const root = render(body);
    expect(q(root, '[data-testid="quote-unreadable"]').length).toBe(0);
    expect(q(root, '[data-testid="quote-total"]')[0].textContent)
      .toContain('UGX 5,000.00');
  });

  it('a LEGACY server that sent no itemised quote still reviews its total', () => {
    basketTotal(4500);
    const root = render(payload([], { pricing_version: 0, quote_ref: undefined }));
    expect(q(root, '[data-testid="quote-unreadable"]').length).toBe(0);
    expect(text(root)).toContain("line-by-line breakdown isn't available");
    expect(text(root)).toContain('Place order');
  });

  it('MALFORMED CONTENTS ARE NOT AN OLD-SERVER EXEMPTION: a LEGACY payload '
     + 'that DID send an undrawable row is refused too', () => {
    let root!: HTMLElement;
    expect(() => {
      root = render(payload([quoteLine({ modifiers: 'Large' })],
                            { pricing_version: 0, quote_ref: undefined }));
    }).not.toThrow();
    expect(q(root, '[data-testid="quote-unreadable"]').length).toBe(1);
    expect(q(root, '[data-testid="quote-line"]').length).toBe(0);
  });
});
