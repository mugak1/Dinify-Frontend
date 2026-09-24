import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChangeDetectionStrategy, Component, NO_ERRORS_SCHEMA, inject } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { WINDOW } from '../../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../../_services/storage/storage-key-prefix.token';
import { DinersMenuComponent } from './menu.component';
import { ConnectivityService } from '../../_services/connectivity.service';
import { BasketService } from '../../_services/basket.service';
import { BasketItem } from '../../_models/app.models';
import { MenuNavStateService } from './menu-nav-state.service';

describe('DinersMenuComponent', () => {
  let component: DinersMenuComponent;
  let fixture: ComponentFixture<DinersMenuComponent>;
  let httpMock: HttpTestingController;
  // Mutable offline flag backing a ConnectivityService stub so bannerTop is
  // deterministic regardless of the runner's real navigator.onLine.
  let isOfflineValue = false;
  const connectivityStub = { isOffline: () => isOfflineValue };

  beforeEach(async () => {
    isOfflineValue = false;
    await TestBed.configureTestingModule({
      declarations: [DinersMenuComponent],
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
        { provide: ConnectivityService, useValue: connectivityStub },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(DinersMenuComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  /** An approved restaurant so tryLoadMenu() proceeds to load rather than
   *  redirect to the menu-not-approved error page. */
  const approvedRestaurant = () =>
    ({ id: 'r1', name: 'Test Diner', menu_approval_status: 'approve' }) as any;

  /** A simulated flaky-connection failure (status 0). */
  const failWith = (req: { error: (e: ProgressEvent, o?: object) => void }) =>
    req.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

  it('renders the connection-error state when a cold load fails', () => {
    component.restaurant = approvedRestaurant();
    fixture.detectChanges(); // ngOnInit → tryLoadMenu → coldLoadMenu

    failWith(httpMock.expectOne(r => r.url.includes('show-menu')));
    fixture.detectChanges();

    expect(component.coldLoadFailed).toBeTrue();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-diner-connection-error')).toBeTruthy();
  });

  it('re-fetches the menu when "Try again" is invoked', () => {
    component.restaurant = approvedRestaurant();
    fixture.detectChanges();
    failWith(httpMock.expectOne(r => r.url.includes('show-menu')));
    expect(component.coldLoadFailed).toBeTrue();

    // The connection-error (retry) output is wired to retryColdLoad().
    component.retryColdLoad();

    expect(component.coldLoadFailed).toBeFalse(); // cleared while the retry runs
    const retry = httpMock.expectOne(r => r.url.includes('show-menu'));
    retry.flush({ data: [{ name: 'Mains', items: [] }], item_sort_mode: 'manual' });

    expect(component.coldLoadFailed).toBeFalse();
  });

  it('keeps a warm menu on a background-revalidation failure (no error screen)', () => {
    // Warm entry: the store already holds a menu for this restaurant, so
    // loadMenu() revalidates silently in the background instead of cold-loading.
    component.navState.setMenuList([{ name: 'Mains', items: [] }]);
    component.navState.setLoadedRestaurantId('r1');
    component.restaurant = approvedRestaurant();
    fixture.detectChanges(); // ngOnInit → loadMenu → warm → refreshMenuInBackground

    failWith(httpMock.expectOne(r => r.url.includes('show-menu')));
    fixture.detectChanges();

    // A background failure must never replace the live menu with an error screen.
    expect(component.coldLoadFailed).toBeFalse();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('app-diner-connection-error'),
    ).toBeFalsy();
  });

  it('positions the single menu banner flush online and below the offline strip offline', () => {
    // Diner shell banner: flush to the viewport top online, dropped 40px (clearing the
    // top offline strip) offline. bannerTop is a pure getter — no detectChanges needed.
    // (The portal embed renders the bare nav-bar with a fixed 49px offset via a
    // template literal, not this getter, so there's nothing to assert here for it.)
    isOfflineValue = false;
    expect(component.bannerTop).toBe('0px');
    isOfflineValue = true;
    expect(component.bannerTop).toBe('40px');
  });

  // ── public menu request contract (tenant isolation: no preview bypass) ─────
  // The diner surface is anonymous/public, so its show-menu request must carry
  // ONLY the restaurant identity — never the `ignore-approval` preview flag that
  // would ask the public endpoint for unapproved data. These pin that contract so
  // a future edit can't reintroduce the bypass on the diner path.
  describe('public menu request omits the ignore-approval preview flag', () => {
    it('sends only the restaurant identity on a cold load, then renders', () => {
      component.restaurant = approvedRestaurant();
      fixture.detectChanges(); // ngOnInit → tryLoadMenu → coldLoadMenu

      const req = httpMock.expectOne(r => r.url.includes('show-menu'));
      expect(req.request.url).toContain('restaurant=r1');
      expect(req.request.url).not.toContain('ignore-approval');

      // A standard menu load still renders (the flag's absence doesn't break loading).
      req.flush({ data: [{ name: 'Mains', items: [] }], item_sort_mode: 'manual' });
      expect(component.menu_list.length).toBe(1);
      expect(component.navState.menuList()?.length).toBe(1);
    });

    it('sends no preview flag on the warm-entry background revalidation either', () => {
      // Warm entry revalidates silently via refreshMenuInBackground — guard that
      // second call site too.
      component.navState.setMenuList([{ name: 'Mains', items: [] }]);
      component.navState.setLoadedRestaurantId('r1');
      component.restaurant = approvedRestaurant();
      fixture.detectChanges(); // ngOnInit → loadMenu → warm → refreshMenuInBackground

      const req = httpMock.expectOne(r => r.url.includes('show-menu'));
      expect(req.request.url).toContain('restaurant=r1');
      expect(req.request.url).not.toContain('ignore-approval');
      req.flush({ data: [{ name: 'Mains', items: [] }], item_sort_mode: 'manual' });
    });
  });

  describe('discount rendering gates (server truth)', () => {
    // The card's badge + strikethrough are *ngIf-gated on discountIsLive(i),
    // so a false verdict guarantees neither renders; figures come from the
    // server fields (discount_percentage / current_price), not the device clock.
    const activeItem = {
      primary_price: '10000', current_price: '8000',
      is_discount_active: true, discount_percentage: 20, in_stock: true,
    };
    const inactiveItem = {
      primary_price: '10000', current_price: '10000',
      is_discount_active: false, discount_percentage: 0, in_stock: true,
    };

    it('treats a server-inactive discount as none (gate false, zero figures, base = primary)', () => {
      expect(component.discountIsLive(inactiveItem)).toBeFalse();
      expect(component.calculateDiscount(inactiveItem)).toBe(0);
      expect(component.priceSaved(inactiveItem)).toBe(0);
      expect(component.getDisplayPrice(inactiveItem)).toBe(10000);
    });

    it('renders the discount from server fields when active', () => {
      expect(component.discountIsLive(activeItem)).toBeTrue();
      expect(component.calculateDiscount(activeItem)).toBe(20);
      expect(component.priceSaved(activeItem)).toBe(2000);
      expect(component.getDisplayPrice(activeItem)).toBe(8000);
    });
  });

  describe('the basket pill shows the same figure as the basket screen', () => {
    // It used to read the PERSISTED `Basket().totalAmount`. Every total
    // persisted before the exact helper landed is plain double arithmetic, so
    // a returning diner could see the pill say one number and the basket
    // screen — which derives its figure — say another for one basket.
    it('derives the pill total rather than reading the stored one', () => {
      const basketService = TestBed.inject(BasketService);
      basketService.addItem({
        itemId: 'i1', itemName: 'Burger', basePrice: 1000, totalPrice: 1000,
        quantity: 1, isDiscounted: false, extras: [],
        selectedModifiers: [{
          groupId: 'g', groupName: 'g',
          choices: [
            { id: 'a', name: 'a', additionalCost: 1.005 },
            { id: 'b', name: 'b', additionalCost: 1.005 },
          ],
        }],
      } as unknown as BasketItem);
      // Whatever the basket happens to have persisted, the pill states the
      // half-even figure the server would price: 1000 + 1.00 + 1.00.
      basketService.Basket().totalAmount = 1002.0099999999999;

      expect(component.totalAmount).toBe(1002);
    });
  });

  // The FIXED "View Basket" bar used to cover the diner footer for good: the
  // only space reserved for it was this list's own bottom padding, which sits
  // ABOVE the footer. The bar now publishes its height and the shell reserves
  // that space AFTER the footer (see diner-app.component.spec.ts).
  describe('the fixed basket bar and the diner footer', () => {
    const addBurger = () => TestBed.inject(BasketService).addItem({
      itemId: 'i1', itemName: 'Burger', basePrice: 1000, totalPrice: 1000,
      quantity: 1, isDiscounted: false, extras: [], selectedModifiers: [],
    } as unknown as BasketItem);
    // Two frames: the ResizeObserver reports after layout.
    const settle = async () => {
      for (let i = 0; i < 2; i++) await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r)));
    };
    const bar = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('div.fixed.bottom-0');

    afterEach(() => TestBed.inject(BasketService).clearBasket());

    it('publishes the bar\'s height while it is on screen', async () => {
      addBurger();
      fixture.detectChanges();
      await settle();
      expect(bar()).withContext('premise: the fixed bar is rendered').not.toBeNull();
      expect(bar()!.offsetHeight).withContext('premise: visible below the lg breakpoint').toBeGreaterThan(0);
      expect(component.navState.fixedBasketBarHeight()).toBe(bar()!.offsetHeight);
    });

    it('reserves nothing once the basket empties, or after the menu leaves', async () => {
      addBurger();
      fixture.detectChanges();
      await settle();
      expect(component.navState.fixedBasketBarHeight()).withContext('premise').toBeGreaterThan(0);

      TestBed.inject(BasketService).clearBasket();
      fixture.detectChanges();
      expect(bar()).toBeNull();
      expect(component.navState.fixedBasketBarHeight()).toBe(0);

      addBurger();
      fixture.detectChanges();
      await settle();
      const navState = component.navState;
      expect(navState.fixedBasketBarHeight()).withContext('premise: back on screen').toBeGreaterThan(0);
      fixture.destroy();
      expect(navState.fixedBasketBarHeight()).toBe(0);
    });

    it('keeps the list\'s own pb-24 only in the portal embed, which has no shell to reserve the space', async () => {
      component.restaurant = approvedRestaurant();
      fixture.detectChanges();
      httpMock.expectOne(r => r.url.includes('show-menu'))
        .flush({ data: [{ name: 'Mains', items: [] }], item_sort_mode: 'manual' });
      await settle(); // the skeleton stays up until the image preload resolves
      addBurger();
      fixture.detectChanges();
      const list = () => (fixture.nativeElement as HTMLElement).querySelector('[appscrollspy]')!;
      expect(list()).withContext('premise: the browse list rendered').not.toBeNull();
      expect(list().classList.contains('pb-24')).withContext('diner shell').toBe(false);

      component.isInRestApp = true;
      fixture.detectChanges();
      expect(list().classList.contains('pb-24')).withContext('portal embed').toBe(true);
    });
  });
});

/**
 * The menu WRITES the bar height during its own change detection (the view
 * query setter), and the diner shell, its PARENT, READS it. A parent binding
 * that changes after it was checked is exactly what dev-mode `checkNoChanges`
 * reports as NG0100. This host reproduces that arrangement, and TestBed runs
 * `checkNoChanges` on every `detectChanges()`.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-spacer-host',
  standalone: false,
  template: `<span id="reserved">{{ nav.fixedBasketBarHeight() }}</span><app-diners-menu></app-diners-menu>`,
})
class SpacerHostComponent {
  readonly nav = inject(MenuNavStateService);
}

describe('DinersMenuComponent: the bar height reaches a parent that was already checked', () => {
  let fixture: ComponentFixture<SpacerHostComponent>;
  const settle = async () => {
    for (let i = 0; i < 2; i++) await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r)));
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SpacerHostComponent, DinersMenuComponent],
      providers: [
        provideHttpClient(withXhr()), provideHttpClientTesting(), provideRouter([]),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
        { provide: ConnectivityService, useValue: { isOffline: () => false } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
    fixture = TestBed.createComponent(SpacerHostComponent);
  });

  afterEach(() => TestBed.inject(BasketService).clearBasket());

  it('shows, then clears, without an ExpressionChanged error', async () => {
    const reserved = () => (fixture.nativeElement as HTMLElement).querySelector('#reserved')!.textContent;
    TestBed.inject(BasketService).addItem({
      itemId: 'i1', itemName: 'Burger', basePrice: 1000, totalPrice: 1000,
      quantity: 1, isDiscounted: false, extras: [], selectedModifiers: [],
    } as unknown as BasketItem);
    expect(() => fixture.detectChanges()).not.toThrow();
    await settle();
    fixture.detectChanges();
    expect(Number(reserved())).withContext('premise: the bar was measured').toBeGreaterThan(0);

    // The basket empties while the menu is on screen: the setter clears the
    // height DURING the menu's check, after the host's binding was checked.
    TestBed.inject(BasketService).clearBasket();
    expect(() => fixture.detectChanges()).not.toThrow();
    expect(reserved()).toBe('0');
  });
});
