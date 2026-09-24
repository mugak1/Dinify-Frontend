/**
 * The basket's allergen and special-request guidance, rendered.
 *
 * WHAT IT REPLACED. An always-open amber box sat between "Total to pay" and the
 * Checkout bar: "We're unable to take custom dietary or special-prep requests.
 * Each item shows its allergens…". It now follows the item page: a subtle
 * "Allergens & dietary info" link, here at the top of the Checkout bar, opening
 * the same pop-up in its `basket` context.
 *
 * WHERE THE POP-UP IS MOUNTED MATTERS. The Checkout bar is `sticky`, and a
 * sticky element is its own stacking context, so a fixed overlay inside it would
 * paint beneath the basket's sticky header. The pop-up is mounted at the root of
 * the basket template instead; the specs below pin both halves.
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
  const bar = (root: HTMLElement) => link(root)?.closest('.sticky') ?? null;
  const checkout = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
    .find((b) => text(b).startsWith('Checkout —')) ?? null;
  const dialog = (root: HTMLElement) => root.querySelector<HTMLElement>('[role="dialog"]');

  for (const sidebar of [false, true]) {
    const where = sidebar ? 'sidebar' : 'basket page';

    it(`REGRESSION (${where}): the always-open amber notice is gone`, () => {
      const root = mount(sidebar);
      expect(text(root)).not.toContain('special-prep');
      expect(root.querySelector('.bg-amber-50')).toBeNull();
    });

    it(`(${where}) the link sits in the sticky Checkout bar, above the Checkout button`, () => {
      const root = mount(sidebar);
      expect(text(link(root))).toBe('Allergens & dietary info');
      expect(bar(root)).withContext('the link is inside the sticky bar').not.toBeNull();
      const cta = checkout(root)!;
      expect(bar(root)!.contains(cta)).withContext('premise: the same bar holds Checkout').toBe(true);
      // DOCUMENT_POSITION_FOLLOWING: the Checkout button comes after the link.
      expect(link(root)!.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it(`(${where}) the link opens the basket pop-up, led by the no-special-requests sentence`, () => {
      const root = mount(sidebar);
      expect(dialog(root)).toBeNull();
      link(root)!.click();
      fixture.detectChanges();
      expect(text(dialog(root))).toContain("We're unable to take custom dietary or special-prep requests.");
      expect(root.querySelector('[data-testid="allergen-basket-guidance"]')).not.toBeNull();
    });

    it(`(${where}) THE POP-UP IS NOT INSIDE THE STICKY BAR, whose stacking context would bury it`, () => {
      const root = mount(sidebar);
      link(root)!.click();
      fixture.detectChanges();
      expect(dialog(root)!.closest('.sticky')).toBeNull();
      expect(bar(root)!.contains(dialog(root))).toBe(false);
    });
  }

  it('closing hands the basket back, and the link opens it again', () => {
    const root = mount(false);
    link(root)!.click();
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('button[aria-label="Close allergen information"]')!.click();
    fixture.detectChanges();
    expect(dialog(root)).toBeNull();
    expect(fixture.componentInstance.allergenInfoOpen()).toBe(false);
    link(root)!.click();
    fixture.detectChanges();
    expect(dialog(root)).not.toBeNull();
  });

  it('CONTROL: an empty basket has no Checkout bar, so no link either', () => {
    const root = mount(false, []);
    expect(link(root)).toBeNull();
    expect(text(root)).toContain('Your basket is empty');
  });
});
