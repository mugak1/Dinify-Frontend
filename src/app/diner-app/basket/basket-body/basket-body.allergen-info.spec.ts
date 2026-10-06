/**
 * The basket's allergen and special-request guidance, rendered.
 *
 * WHAT IT REPLACED. An always-open amber box sat between "Total to pay" and the
 * Checkout bar: "We're unable to take custom dietary or special-prep requests.
 * Each item shows its allergens…". It now follows the item page: a subtle
 * "Allergens & dietary info" link straight after the total, opening the same
 * pop-up in its `basket` context. It is NOT in the sticky Checkout bar, which
 * stays just the button. The summary above it has ONE total: the Subtotal row,
 * which repeated "Total to pay" for every basket without a deal, is gone.
 *
 * WHERE THE POP-UP IS MOUNTED MATTERS. The Checkout bar is `sticky`, and a
 * sticky element is its own stacking context, so a fixed overlay inside it would
 * paint beneath the basket's sticky header. The pop-up is mounted at the root of
 * the basket template, beside the checkout overlays, and never inside the bar.
 *
 * FROM THE DESKTOP SIDEBAR IT IS RENDERED UNDER `<body>`, with the checkout
 * overlays, because the sidebar clips fixed overlays in Safari. So these specs
 * read the pop-up from the document, not from the component.
 * `basket-body.overlay-placement.spec.ts` pins where each overlay goes.
 *
 * Both mounts are driven: the routed basket page and the desktop sidebar.
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

describe('BasketBodyComponent: allergen information', () => {
  let basket: { items: BasketItem[]; totalAmount: number };
  let api: jasmine.SpyObj<ApiService>;
  let fixture: ComponentFixture<BasketBodyComponent>;

  const burger = {
    itemId: 'i1', itemName: 'Burger', basePrice: 5000, totalPrice: 5000,
    quantity: 1, selectedModifiers: [], extras: [], isDiscounted: false,
  } as unknown as BasketItem;

  beforeEach(async () => {
    basket = { items: [], totalAmount: 0 };
    api = jasmine.createSpyObj<ApiService>('ApiService', ['postPatch', 'get']);
    api.postPatch.and.returnValue(of() as any);
    api.get.and.returnValue(of() as any);
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
    const basketService: any = {
      Basket: () => basket,
      revision: () => 0,
      clearBasket: jasmine.createSpy('clearBasket'),
      contentIdentity: () => BasketService.prototype.contentIdentity.call(basketService),
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
        {
          provide: ConfirmDialogService,
          useValue: jasmine.createSpyObj<ConfirmDialogService>('ConfirmDialogService', ['openModal', 'closeModal']),
        },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj<ToastService>(
            'ToastService', ['success', 'error', 'info', 'warning', 'clear', 'dismiss']),
        },
        { provide: ConnectivityService, useValue: { isOffline: () => false } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
    spyOn(TestBed.inject(Router), 'navigate').and.stub();
  });

  function mount(sidebar: boolean, items: BasketItem[] = [burger]): HTMLElement {
    basket.items = items;
    fixture = TestBed.createComponent(BasketBodyComponent);
    fixture.componentInstance.sidebar = sidebar;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const link = (root: HTMLElement) =>
    root.querySelector<HTMLButtonElement>('[data-testid="basket-allergen-info"] app-allergen-info-link button');
  const checkout = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
    .find((b) => text(b).startsWith('Checkout —')) ?? null;
  const bar = (root: HTMLElement) => checkout(root)?.closest('.sticky') ?? null;
  const totalLabel = (root: HTMLElement) => Array.from(root.querySelectorAll('span'))
    .find((s) => text(s) === 'Total to pay') ?? null;
  const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  /** From the document: opened from the sidebar, the pop-up is rendered under `<body>`. */
  const dialog = () => document.querySelector<HTMLElement>('app-allergen-info-sheet [role="dialog"]');

  for (const sidebar of [false, true]) {
    const where = sidebar ? 'sidebar' : 'basket page';

    it(`REGRESSION (${where}): the always-open amber notice is gone`, () => {
      const root = mount(sidebar);
      expect(text(root)).not.toContain('special-prep');
      expect(root.querySelector('.bg-amber-50')).toBeNull();
    });

    it(`(${where}) the link comes straight after "Total to pay", outside the sticky Checkout bar`, () => {
      const root = mount(sidebar);
      expect(text(link(root))).toBe('Allergens & dietary info');
      expect(bar(root)).withContext('premise: the sticky bar holds Checkout').not.toBeNull();
      expect(bar(root)!.contains(link(root))).withContext('the link is NOT in the sticky bar').toBe(false);
      expect(link(root)!.closest('.sticky')).toBeNull();
      expect(follows(totalLabel(root)!, link(root)!)).withContext('after the total').toBe(true);
      expect(follows(link(root)!, checkout(root)!)).withContext('before the Checkout bar').toBe(true);
    });

    it(`REGRESSION (${where}): one total, "Total to pay", and no Subtotal row`, () => {
      const root = mount(sidebar);
      expect(text(root)).not.toContain('Subtotal');
      expect(Array.from(root.querySelectorAll('span')).filter((s) => text(s) === 'Total to pay').length)
        .toBe(1);
    });

    it(`(${where}) the link opens the basket pop-up, led by the no-special-requests sentence`, () => {
      const root = mount(sidebar);
      expect(dialog()).toBeNull();
      link(root)!.click();
      fixture.detectChanges();
      expect(text(dialog())).toContain("We're unable to take custom dietary or special-prep requests.");
      expect(dialog()!.querySelector('[data-testid="allergen-basket-guidance"]')).not.toBeNull();
    });

    it(`(${where}) THE POP-UP IS NOT INSIDE THE STICKY BAR, whose stacking context would bury it`, () => {
      const root = mount(sidebar);
      link(root)!.click();
      fixture.detectChanges();
      expect(dialog()!.closest('.sticky')).toBeNull();
      expect(bar(root)!.contains(dialog())).toBe(false);
    });

    it(`(${where}) Escape closes it, through the sheet itself`, () => {
      const root = mount(sidebar);
      link(root)!.click();
      fixture.detectChanges();
      expect(dialog()).withContext('premise: it is open').not.toBeNull();
      // Escape closes it through the sheet itself, not through our close button.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      expect(dialog()).toBeNull();
      expect(fixture.componentInstance.allergenInfoOpen()).toBe(false);
    });
  }

  it('closing hands the basket back, and the link opens it again', () => {
    const root = mount(false);
    link(root)!.click();
    fixture.detectChanges();
    dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Close allergen information"]')!.click();
    fixture.detectChanges();
    expect(dialog()).toBeNull();
    expect(fixture.componentInstance.allergenInfoOpen()).toBe(false);
    link(root)!.click();
    fixture.detectChanges();
    expect(dialog()).not.toBeNull();
  });

  it('CONTROL: a deal still states its saving, just above the one total', () => {
    const deal = {
      ...burger, basePrice: 800, totalPrice: 800, originalBasePrice: 1000, isDiscounted: true,
    } as unknown as BasketItem;
    const root = mount(false, [deal]);
    const savings = Array.from(root.querySelectorAll('span')).find((s) => text(s) === 'Deal savings');
    expect(savings).withContext('the saving is still stated').toBeDefined();
    expect(follows(savings!, totalLabel(root)!)).toBe(true);
    expect(text(root)).not.toContain('Subtotal');
  });

  it('CONTROL: an empty basket has no total, so no link either', () => {
    const root = mount(false, []);
    expect(link(root)).toBeNull();
    expect(text(root)).toContain('Your basket is empty');
  });
});
