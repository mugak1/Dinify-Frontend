/**
 * WHERE THE BASKET'S OVERLAYS ARE RENDERED: the checkout prompt, the itemised
 * review and the allergen pop-up.
 *
 * THE DEFECT. On desktop the basket lives in a sidebar `<aside>` that is sticky
 * and scrolls (`overflow-y: auto`), which makes it a stacking context that
 * clips. Safari paints a `position: fixed` descendant of such an element only
 * inside that element's box, while still laying it out and hit-testing it over
 * the whole page (WebKit bug 160953). After Checkout, the "Are you sure?" prompt
 * therefore greyed only the sidebar. Its Order and Cancel buttons, centred on
 * the page, were invisible but still took clicks, so the diner could neither
 * see the confirmation nor back out of it, and the draft sat unsubmitted until
 * a reload.
 *
 * THE RULE. Opened from the sidebar, every overlay is rendered under `<body>`
 * (`appBodyPortal`), where no ancestor clips it and its z-50 sits in the root
 * stacking context. On the basket page the overlays stay in place.
 *
 * Karma runs Chromium, which paints these overlays correctly either way, so
 * these specs assert the CONDITION Safari fails on rather than pixels: no
 * ancestor of an open overlay may be a stacking context that clips. A control
 * proves the harness reproduces that condition, so the regressions cannot pass
 * by accident.
 */
import { ChangeDetectionStrategy, Component, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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

/**
 * The two call sites, reduced to what decides the outcome. The aside keeps the
 * real sidebar's `sticky` and `overflow-y: auto`, written inline because
 * Karma's window is narrower than the `lg:` breakpoint those classes use.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: true,
  imports: [BasketBodyComponent],
  template: `
    @if (sidebar) {
      <aside data-testid="sidebar" style="position: sticky; top: 0; max-height: 320px; overflow-y: auto">
        <app-basket-body [sidebar]="true"></app-basket-body>
      </aside>
    } @else {
      <main data-testid="page"><app-basket-body></app-basket-body></main>
    }
  `,
})
class ShellComponent {
  sidebar = true;
  @ViewChild(BasketBodyComponent) basket!: BasketBodyComponent;
}

/** A stacking context, by the properties that make one. */
function isStackingContext(el: Element): boolean {
  const s = getComputedStyle(el);
  if (s.position === 'fixed' || s.position === 'sticky') return true;
  if (s.zIndex !== 'auto') {
    if (s.position !== 'static') return true;
    const parent = el.parentElement ? getComputedStyle(el.parentElement).display : '';
    if (/flex|grid/.test(parent)) return true;
  }
  return Number(s.opacity) < 1 || s.transform !== 'none' || s.filter !== 'none'
    || s.isolation === 'isolate' || /paint|strict|content/.test(s.contain);
}

const clips = (el: Element) => {
  const s = getComputedStyle(el);
  return s.overflowX !== 'visible' || s.overflowY !== 'visible';
};

function ancestors(el: Element): Element[] {
  const out: Element[] = [];
  for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) out.push(a);
  return out;
}

const describeEl = (el: Element) =>
  el.tagName.toLowerCase() + (el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : '');

/** The ancestors Safari would clip a fixed overlay to: the WebKit 160953 condition. */
const clippingContexts = (el: Element) =>
  ancestors(el).filter((a) => isStackingContext(a) && clips(a)).map(describeEl);

describe('BasketBodyComponent: where the overlays are rendered', () => {
  let basket: { items: BasketItem[]; totalAmount: number };
  let fixture: ComponentFixture<ShellComponent>;

  const burger = {
    itemId: 'i1', itemName: 'Burger', basePrice: 5000, totalPrice: 5000,
    quantity: 1, selectedModifiers: [], extras: [], isDiscounted: false,
  } as unknown as BasketItem;

  beforeEach(async () => {
    basket = { items: [burger], totalAmount: 5000 };
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['postPatch', 'get']);
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
      imports: [ShellComponent],
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
    }).compileComponents();
    spyOn(TestBed.inject(Router), 'navigate').and.stub();
  });

  // A destroyed TEST fixture keeps its own nodes until TestBed removes its root
  // element. What must not survive is anything the basket put outside it.
  afterEach(() => {
    const root = fixture.nativeElement as HTMLElement;
    fixture.destroy();
    const strays = Array.from(document.querySelectorAll('[data-testid="checkout-confirm"], app-allergen-info-sheet'))
      .filter((el) => !root.contains(el));
    expect(strays.length).withContext('nothing is left behind in <body>').toBe(0);
  });

  function mount(sidebar: boolean): BasketBodyComponent {
    fixture = TestBed.createComponent(ShellComponent);
    fixture.componentInstance.sidebar = sidebar;
    fixture.detectChanges();
    return fixture.componentInstance.basket;
  }

  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const shell = () => fixture.nativeElement as HTMLElement;
  const aside = () => shell().querySelector<HTMLElement>('[data-testid="sidebar"]')!;
  const prompt = () => document.querySelector<HTMLElement>('[data-testid="checkout-confirm"]');
  const review = () => {
    const heading = Array.from(document.querySelectorAll('h3')).find((h) => text(h) === 'Review your order');
    return heading?.closest<HTMLElement>('.fixed') ?? null;
  };
  /** The sheet's own root: the fixed, z-50 element that holds the backdrop and the dialog. */
  const allergen = () => document.querySelector<HTMLElement>('app-allergen-info-sheet app-dn-sheet > .fixed');
  const button = (root: HTMLElement, label: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => text(b) === label)!;

  /** Open each overlay and return its root. The two checkout overlays are opened
   *  through their state here; `basket-body.quote-equivalence.spec.ts` reaches
   *  them through a real priced checkout, from both mounts. */
  const open: Record<string, (c: BasketBodyComponent) => HTMLElement | null> = {
    'the checkout prompt': (c) => {
      spyOnProperty(c, 'quoteNeedsReview', 'get').and.returnValue(false);
      c.showQuoteSheet = true;
      fixture.detectChanges();
      return prompt();
    },
    'the itemised review': (c) => {
      spyOnProperty(c, 'quoteNeedsReview', 'get').and.returnValue(true);
      c.showQuoteSheet = true;
      fixture.detectChanges();
      return review();
    },
    'the allergen pop-up': () => {
      shell().querySelector<HTMLButtonElement>('[data-testid="basket-allergen-info"] app-allergen-info-link button')!
        .click();
      fixture.detectChanges();
      return allergen();
    },
  };

  it('CONTROL: the sidebar in this harness is the shape Safari clips to', () => {
    mount(true);
    expect(isStackingContext(aside())).withContext('sticky: a stacking context').toBe(true);
    expect(clips(aside())).withContext('overflow-y: auto: a clip').toBe(true);
    expect(clippingContexts(aside().querySelector('app-basket-body')!))
      .withContext('the basket itself is inside it').toEqual(['aside[sidebar]']);
  });

  for (const [name, openIt] of Object.entries(open)) {
    it(`REGRESSION (sidebar): ${name} has no ancestor that clips it`, () => {
      const overlay = openIt(mount(true));
      expect(overlay).withContext(`premise: ${name} is open`).not.toBeNull();
      expect(aside().contains(overlay)).withContext('not inside the sidebar').toBe(false);
      expect(clippingContexts(overlay!)).toEqual([]);
    });

    it(`(sidebar) ${name} sits in the root stacking context, so its z-50 is measured against the page`, () => {
      const overlay = openIt(mount(true));
      expect(ancestors(overlay!).filter(isStackingContext).map(describeEl)).toEqual([]);
      expect(getComputedStyle(overlay!).zIndex).toBe('50');
    });

    it(`CONTROL (basket page): ${name} stays where the template put it`, () => {
      const overlay = openIt(mount(false));
      expect(overlay).withContext(`premise: ${name} is open`).not.toBeNull();
      expect(shell().querySelector('[data-testid="page"]')!.contains(overlay)).toBe(true);
      expect(clippingContexts(overlay!)).withContext('nothing clips it there either').toEqual([]);
    });
  }

  it('(sidebar) Cancel in the prompt still backs out of the checkout', () => {
    const basketBody = mount(true);
    open['the checkout prompt'](basketBody);
    button(prompt()!, 'Cancel').click();
    fixture.detectChanges();
    expect(basketBody.showQuoteSheet).toBe(false);
    expect(prompt()).toBeNull();
  });

  it('(sidebar) the review\'s backdrop still backs out of the checkout', () => {
    const basketBody = mount(true);
    open['the itemised review'](basketBody)!.click();
    fixture.detectChanges();
    expect(basketBody.showQuoteSheet).toBe(false);
    expect(review()).toBeNull();
  });

  it('(sidebar) Escape still closes the allergen pop-up', () => {
    const basketBody = mount(true);
    open['the allergen pop-up'](basketBody);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(allergen()).toBeNull();
    expect(basketBody.allergenInfoOpen()).toBe(false);
  });

  it('(sidebar) a prompt opened again is rendered under <body> again', () => {
    const basketBody = mount(true);
    open['the checkout prompt'](basketBody);
    basketBody.showQuoteSheet = false;
    fixture.detectChanges();
    expect(prompt()).toBeNull();
    basketBody.showQuoteSheet = true;
    fixture.detectChanges();
    expect(aside().contains(prompt())).toBe(false);
    expect(clippingContexts(prompt()!)).toEqual([]);
  });

  it('(sidebar) removing the sidebar takes its open overlay with it', () => {
    open['the checkout prompt'](mount(true));
    expect(prompt()).not.toBeNull();
    fixture.componentInstance.sidebar = false;
    fixture.detectChanges();
    expect(prompt()).withContext('the sidebar was destroyed, and nothing opened on the page').toBeNull();
  });
});
