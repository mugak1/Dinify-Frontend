import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { WINDOW } from '../../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../../_services/storage/storage-key-prefix.token';
import { DinersMenuComponent } from './menu.component';
import { ConnectivityService } from '../../_services/connectivity.service';

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
        provideHttpClient(),
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
    // (The rest-app embed renders the bare nav-bar with a fixed 49px offset via a
    // template literal, not this getter, so there's nothing to assert here for it.)
    isOfflineValue = false;
    expect(component.bannerTop).toBe('0px');
    isOfflineValue = true;
    expect(component.bannerTop).toBe('40px');
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
});
