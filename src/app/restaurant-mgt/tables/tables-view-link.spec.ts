import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthenticationService } from '../../_services/authentication.service';
import { LocalStorageService } from '../../_services/storage/local-storage.service';
import { PageHeaderComponent } from '../../_shared/ui/page-header/page-header.component';
import { DnSegmentedComponent } from '../../_shared/ui/segmented/segmented.component';
import { FLOOR_SERVICE_LINK } from '../rest-notifications/inbox-notification';
import { FloorService } from './services/floor.service';
import { FLOOR_DEV_MODE } from './services/floor-view-gate';
import { TablesComponent } from './tables.component';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-tables-setup-view',
  standalone: true,
  template: '<div data-testid="setup-view-stub"></div>',
})
class StubSetupViewComponent {}

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-tables-service-view',
  standalone: true,
  template: '<div data-testid="service-view-stub"></div>',
})
class StubServiceViewComponent {}

/**
 * Step 2, FE-E — the bell's `round_waiting` row opens the floor's SERVICE view.
 *
 * The Tables page toggles Setup/Service inside one route, so the link carries
 * `?view=service`, which the page reads once on load. Driven through the REAL
 * router with the bell's own link constant, so the link and the page cannot
 * drift apart.
 */
describe('TablesComponent — opened from the bell\'s floor link', () => {
  let setItem: jasmine.Spy;

  async function navigate(url: string, persisted: string | null = null): Promise<HTMLElement> {
    setItem = jasmine.createSpy('setItem');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'dining-tables', component: TablesComponent }]),
        { provide: AuthenticationService, useValue: { currentRestaurantRole: { restaurant_id: 'r1' } } },
        { provide: LocalStorageService, useValue: { getItem: () => persisted, setItem } },
        { provide: FLOOR_DEV_MODE, useValue: false },
      ],
    }).overrideComponent(TablesComponent, {
      set: { imports: [StubSetupViewComponent, StubServiceViewComponent, PageHeaderComponent, DnSegmentedComponent] },
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    harness.detectChanges();
    return harness.routeNativeElement as HTMLElement;
  }

  const floorUrl = () =>
    `${FLOOR_SERVICE_LINK.path}?${new URLSearchParams(FLOOR_SERVICE_LINK.queryParams).toString()}`;

  afterEach(() => (FloorService.USE_MOCK_DATA = false));

  it('the link opens the service view, even when Setup was the saved choice', async () => {
    const el = await navigate(floorUrl(), 'setup');
    expect(el.querySelector('[data-testid="service-view-stub"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="setup-view-stub"]')).toBeNull();
    // It counts as staff choosing the floor, so it is remembered like the toggle.
    expect(setItem).toHaveBeenCalledWith('tables.activeView:r1', 'service');
  });

  it('without the parameter the page opens as before (the saved choice, else Setup)', async () => {
    const el = await navigate('/dining-tables');
    expect(el.querySelector('[data-testid="setup-view-stub"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="service-view-stub"]')).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('an unknown view value changes nothing', async () => {
    const el = await navigate('/dining-tables?view=bogus');
    expect(el.querySelector('[data-testid="setup-view-stub"]')).toBeTruthy();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('the production gate still wins: with mock data forced on, the link cannot open the floor', async () => {
    FloorService.USE_MOCK_DATA = true;
    const el = await navigate(floorUrl());
    expect(el.querySelector('[data-testid="service-view-stub"]')).toBeNull();
    expect(el.querySelector('[data-testid="setup-view-stub"]')).toBeTruthy();
  });
});
