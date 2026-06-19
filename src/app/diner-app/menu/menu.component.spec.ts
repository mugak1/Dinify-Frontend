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
  // Mutable offline flag backing a ConnectivityService stub so navStickyTop is
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

  it('computes the nav-bar sticky offset for diner (online/offline) and rest-app', () => {
    // Diner shell: pins under the 48px brand strip, or 88px when the offline strip
    // is showing. navStickyTop is a pure getter — no ngOnInit/detectChanges needed.
    component.isInRestApp = false;
    isOfflineValue = false;
    expect(component.navStickyTop).toBe('48px');
    isOfflineValue = true;
    expect(component.navStickyTop).toBe('88px');

    // Embedded in the rest-app there is no diner brand/offline strip, so it keeps
    // the component's 49px default regardless of connectivity.
    component.isInRestApp = true;
    expect(component.navStickyTop).toBe('49px');
  });
});
