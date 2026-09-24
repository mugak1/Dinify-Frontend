/**
 * WHICH CONFIRMATION A REAL QUOTE GETS: the plain prompt or the itemised review.
 *
 * #693 brought back "Are you sure you want to place this order?" for an
 * ordinary checkout, and chose it by comparing the GRAND TOTAL alone. So a
 * readable quote with every line available and an unchanged total got the
 * plain prompt even when a line said something the basket had not shown: a
 * choice the restaurant relabelled under the same id and price, two lines
 * whose prices moved by offsetting amounts, an extra priced or named
 * differently. The plain prompt lists nothing, so the diner confirmed without
 * seeing any of it.
 *
 * WHAT THESE SPECS DRIVE. The real component through `initiateOrder`, the real
 * coordinator and session storage, the real `ApiService`, `HttpClient` and
 * `ErrorInterceptor`, with the server's reply flushed at the HTTP boundary and
 * the result read off the RENDERED template. Every changed-purchase case keeps
 * the grand total exactly equal to the basket's and every line available, so
 * the line-by-line check is the only thing that can send it to the review.
 *
 * The server shapes follow the backend at a6b25a6: `"Group: A, B"` labels in
 * canonical choice order, options priced per unit, one extra per dish. See
 * `quote-equivalence.fixture.ts`.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import {
  HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi, withXhr,
} from '@angular/common/http';
import {
  HttpTestingController, provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';

import { environment } from 'src/environments/environment';
import { WINDOW } from '../../../_services/storage/window.token';
import { STORAGE_KEY_PREFIX }
  from '../../../_services/storage/storage-key-prefix.token';
import { BasketService } from '../../../_services/basket.service';
import {
  CheckoutCoordinatorService,
} from '../../../_services/checkout-coordinator.service';
import { ErrorInterceptor } from '../../../_helpers/error.interceptor';
import { ToastService } from '../../../_shared/ui/toast/toast.service';
import { ConfirmDialogService } from '../../../_common/confirm-dialog.service';
import { ConnectivityService } from '../../../_services/connectivity.service';
import { BasketItem } from '../../../_models/app.models';
import { reviewQuote } from '../../../_shared/order/quote-review';
import {
  burger, chips, quoteBasket, quotedLine, quotePayload,
} from '../../../_shared/order/quote-equivalence.fixture';
import { BasketBodyComponent } from './basket-body.component';

describe('BasketBodyComponent — plain prompt only for an unchanged purchase', () => {
  let http: HttpTestingController;
  let basket: { items: BasketItem[]; totalAmount: number };
  let basketService: any;
  let revision: number;
  let coordinator: CheckoutCoordinatorService;
  let fixture: ComponentFixture<BasketBodyComponent>;
  let component: BasketBodyComponent;

  const API = `${environment.apiUrl}/api`;
  const V1 = `${API}/${environment.version}`;

  /** A correlated acceptance, so success is announced only on real evidence. */
  const accepted = (key: string) => ({
    status: 200, message: 'Order placed.', idempotent: false,
    checkout: {
      order_id: 'o1', intent_key: key,
      scope: { restaurant: 'r1', table: 't1' },
      acceptance: { state: 'accepted', outcome: 'newly_accepted',
                    quote_ref: 'q1', accepted_at: '2026-09-24T10:00:00Z' },
      current: { order_status: 'pending', fulfilment_status: 'new',
                 cancelled_at: null, served_at: null },
      checkout_protocol: 3,
    },
  });

  beforeEach(async () => {
    basket = { items: [], totalAmount: 0 };
    revision = 1;
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);

    basketService = {
      Basket: () => basket,
      clearBasket: jasmine.createSpy('clearBasket'),
      revision: () => revision,
      contentIdentity: () =>
        BasketService.prototype.contentIdentity.call(basketService),
      totalState: (items: BasketItem[]) =>
        BasketService.prototype.totalState.call(basketService, items),
    };

    await TestBed.configureTestingModule({
      imports: [BasketBodyComponent],
      providers: [
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
        provideRouter([]),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
        { provide: BasketService, useValue: basketService },
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
    http = TestBed.inject(HttpTestingController);
    coordinator = TestBed.inject(CheckoutCoordinatorService);
    window.sessionStorage.setItem('Table', JSON.stringify({ value: { id: 't1' } }));
    window.sessionStorage.setItem('restaurant', JSON.stringify({ value: { id: 'r1' } }));
  });

  afterEach(() => {
    http.verify();
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
    window.sessionStorage.removeItem('Table');
    window.sessionStorage.removeItem('restaurant');
  });

  /** Mount a consumer: the routed page, or the desktop sidebar beside it. */
  function mount(sidebar: boolean): void {
    fixture = TestBed.createComponent(BasketBodyComponent);
    component = fixture.componentInstance;
    component.sidebar = sidebar;
    fixture.detectChanges();
  }

  /** Put `lines` in the basket, press Checkout, and answer with `body`. */
  function price(lines: any[], body: any, sidebar = true): HTMLElement {
    basket.items = lines as BasketItem[];
    mount(sidebar);
    const review = reviewQuote(body);
    expect(review.readable).withContext('premise: a readable quote').toBe(true);
    component.initiateOrder();
    http.expectOne(`${API}/v2/orders/initiate/`).flush({ status: 200, data: body });
    fixture.detectChanges();
    expect(component.showQuoteSheet).withContext('premise: a confirmation opened').toBe(true);
    return fixture.nativeElement as HTMLElement;
  }

  /** The premise of every changed-purchase case: nothing else would object. */
  function onlyTheLinesDiffer(): void {
    expect(component.quoteIsUnreadable).withContext('premise: readable').toBe(false);
    expect(component.quoteHasLosses).withContext('premise: nothing dropped').toBe(false);
    expect(component.totalIsExact).withContext('premise: an exact basket total').toBe(true);
    expect(component.quoteDiffersFromBasket)
      .withContext('premise: the GRAND TOTAL is unchanged').toBe(false);
  }

  const plain = (root: HTMLElement) => root.querySelectorAll('[data-testid="checkout-confirm"]');
  const itemised = (root: HTMLElement) => root.querySelectorAll('[data-testid="quote-line"]');
  const button = (root: HTMLElement, scope: string, label: RegExp) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>(`${scope} button`))
      .find((b) => label.test((b.textContent ?? '').trim()))!;
  const texts = (root: HTMLElement, id: string) =>
    Array.from(root.querySelectorAll(`[data-testid="${id}"]`))
      .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());

  // ── the unchanged purchase keeps the plain prompt ─────────────────────
  for (const sidebar of [false, true]) {
    it(`CONTROL (${sidebar ? 'sidebar' : 'routed'}): an unchanged purchase gets exactly one `
       + 'plain prompt, and Order submits the reviewed order and quote', () => {
      const lines = [burger(), chips()];
      const root = price(lines, quoteBasket(lines), sidebar);
      expect(plain(root).length).toBe(1);
      expect(itemised(root).length).toBe(0);
      const key = coordinator.record()!.key;

      button(root, '[data-testid="checkout-confirm"]', /^Order$/).click();
      const submit = http.expectOne(`${V1}/orders/submit/`);
      expect(submit.request.body).toEqual({ order: 'o1', quote_ref: 'q1' });
      expect(coordinator.record()!.key).withContext('the SAME key').toBe(key);
      submit.flush(accepted(key));
      expect(basketService.clearBasket).toHaveBeenCalled();
    });
  }

  it('CONTROL: the plain prompt is the original "Are you sure?" dialog, not the itemised sheet', () => {
    const lines = [burger()];
    const root = price(lines, quoteBasket(lines));
    const prompt = plain(root)[0] as HTMLElement;
    const words = (prompt.textContent ?? '').replace(/\s+/g, ' ');
    expect(words).toContain('Checkout');
    expect(words).toContain('Are you sure you want to place this order?');
    expect(button(root, '[data-testid="checkout-confirm"]', /^Order$/)).toBeTruthy();
    expect(button(root, '[data-testid="checkout-confirm"]', /^Cancel$/)).toBeTruthy();
    expect(root.textContent).not.toContain('Review your order');
  });

  it('CONTROL: the plain prompt is a lock while the order is being placed', () => {
    const lines = [burger()];
    const root = price(lines, quoteBasket(lines));
    const key = coordinator.record()!.key;
    button(root, '[data-testid="checkout-confirm"]', /^Order$/).click();
    const submit = http.expectOne(`${V1}/orders/submit/`);
    fixture.detectChanges();
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(
      '[data-testid="checkout-confirm"] button'));
    expect(buttons.length).toBe(2);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    component.cancelQuote();
    expect(component.showQuoteSheet).withContext('Cancel is inert while placing').toBe(true);
    submit.flush(accepted(key));
  });

  it('CONTROL: Cancel on the plain prompt keeps the basket and the key and sends nothing', () => {
    const lines = [burger()];
    const root = price(lines, quoteBasket(lines));
    const key = coordinator.record()!.key;
    button(root, '[data-testid="checkout-confirm"]', /^Cancel$/).click();
    fixture.detectChanges();
    expect(component.showQuoteSheet).toBe(false);
    expect(basket.items.length).toBe(1);
    expect(coordinator.record()!.key).toBe(key);
    http.expectNone(`${V1}/orders/submit/`);
  });

  it('CONTROL: a different tapping order and lines the server merged still get the plain prompt', () => {
    const toppings = {
      groupId: 'g-top', groupName: 'Toppings', choices: [
        { id: 'c-bacon', name: 'Bacon', additionalCost: 500 },
        { id: 'c-cheese', name: 'Cheese', additionalCost: 500 },
      ],
    };
    const tapped = burger({ quantity: 1, selectedModifiers: [toppings] });
    const again = burger({ quantity: 1, selectedModifiers: [
      { ...toppings, choices: [...toppings.choices].reverse() }] });
    // The server lists choices in MENU order and merges the two into one row.
    const body = quoteBasket([burger({ quantity: 2, selectedModifiers: [toppings] })],
      { definitionOrder: { 'g-top': ['c-cheese', 'c-bacon'] } });
    expect(body.quote[0].modifiers).toEqual(['Toppings: Cheese, Bacon']);
    const root = price([tapped, again], body);
    expect(plain(root).length).toBe(1);
  });

  // ── a changed purchase gets the itemised review, whatever the total ──
  it('REGRESSION: a relabelled choice with the SAME ids and total shows the new meaning', () => {
    const lines = [burger()];
    const body = quoteBasket(lines);
    body.quote[0].modifiers = ['Size: Extra large'];
    const root = price(lines, body);
    onlyTheLinesDiffer();
    expect(plain(root).length).toBe(0);
    expect(texts(root, 'quote-line-modifiers')).toEqual(['Size: Extra large']);
    expect(texts(root, 'quote-total')[0]).toContain('UGX 14,000.00');
  });

  it('REGRESSION: offsetting line prices under the same total show the actual line amounts', () => {
    const lines = [burger(), chips()];
    const burgerLine = quotedLine(lines[0], 0);
    const chipsLine = quotedLine(lines[1], 1);
    burgerLine.line_actual_cost = '12500.00';
    burgerLine.line_total_with_extras = '14500.00';
    chipsLine.line_actual_cost = '2500.00';
    chipsLine.line_total_with_extras = '2500.00';
    const root = price(lines, quotePayload([burgerLine, chipsLine]));
    onlyTheLinesDiffer();
    expect(plain(root).length).toBe(0);
    expect(texts(root, 'quote-line-amount')).toEqual(['UGX 14,500.00', 'UGX 2,500.00']);
  });

  it('REGRESSION: an extra priced differently, offset by the dish, gets the review', () => {
    const lines = [burger()];
    const body = quoteBasket(lines);
    body.quote[0].extras[0].actual_cost = '3000.00';
    body.quote[0].line_actual_cost = '11000.00';
    const root = price(lines, body);
    onlyTheLinesDiffer();
    expect(plain(root).length).toBe(0);
    expect(itemised(root).length).toBe(1);
  });

  it('REGRESSION: a renamed extra gets the review, showing the new name', () => {
    const lines = [burger()];
    const body = quoteBasket(lines);
    body.quote[0].extras[0].item_name = 'Vegan cheese';
    const root = price(lines, body);
    onlyTheLinesDiffer();
    expect(plain(root).length).toBe(0);
    expect(texts(root, 'quote-line-extra')[0]).toContain('Vegan cheese');
  });

  it('the review submits the SAME order and quote the plain prompt would have', () => {
    const lines = [burger()];
    const body = quoteBasket(lines);
    body.quote[0].modifiers = ['Size: Extra large'];
    const root = price(lines, body);
    const key = coordinator.record()!.key;
    button(root, '', /^Place order/).click();
    const submit = http.expectOne(`${V1}/orders/submit/`);
    expect(submit.request.body).toEqual({ order: 'o1', quote_ref: 'q1' });
    submit.flush(accepted(key));
    expect(basketService.clearBasket).toHaveBeenCalled();
  });

  // ── what cannot be established falls back to the review ──────────────
  it('a server row with no selection to pair by gets the review', () => {
    const lines = [chips()];
    const body = quoteBasket(lines);
    delete body.quote[0].selected_modifiers;
    const root = price(lines, body);
    onlyTheLinesDiffer();
    expect(plain(root).length).toBe(0);
  });

  it('a LEGACY quote with no lines gets the review even when its total matches', () => {
    const lines = [chips()];
    const body = quotePayload([], { pricing_version: 0, quote_total: '3000.00',
                                    actual_cost: '3000.00', no_available_items: 1 });
    const root = price(lines, body);
    expect(component.quoteDiffersFromBasket).withContext('premise').toBe(false);
    expect(plain(root).length).toBe(0);
    expect(root.textContent).toContain("line-by-line breakdown isn't available");
  });

  it('an ESTIMATED basket total that happens to match still gets the review (#693)', () => {
    const line = chips({ basePrice: 'n/a' as unknown as number, totalPrice: 3000 });
    const body = quoteBasket([chips()]);
    const root = price([line], body);
    expect(component.totalIsExact).withContext('premise: an estimate').toBe(false);
    expect(component.quoteDiffersFromBasket).withContext('premise: it matches').toBe(false);
    expect(plain(root).length).toBe(0);
  });

  it('a quote the basket has moved on from is never confirmed through the plain prompt', () => {
    const lines = [chips()];
    const root = price(lines, quoteBasket(lines));
    expect(plain(root).length).withContext('premise').toBe(1);
    revision += 1;                          // the basket changed after pricing
    fixture.detectChanges();
    expect(plain(root).length).toBe(0);
    component.confirmQuote();
    http.expectNone(`${V1}/orders/submit/`);
    expect(component.orderError).toBe(true);
  });
});
