import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { MenuReportComponent } from './menu-report.component';
import { ReportsService } from '../services/reports.service';
import { ApiService } from '../../../_services/api.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { LocalStorageService } from '../../../_services/storage/local-storage.service';
import { MenuService } from '../../menu/services/menu.service';

const MENU_ITEMS = [
  { available: true, in_stock: true },
  { available: true, in_stock: false }, // active but sold out
  { available: false, in_stock: true }, // hidden — not counted
];

describe('MenuReportComponent', () => {
  let component: MenuReportComponent;
  let fixture: ComponentFixture<MenuReportComponent>;
  let reports: ReportsService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MenuReportComponent],
      providers: [
        { provide: ApiService, useValue: jasmine.createSpyObj('ApiService', ['get', 'loadAllPages']) },
        {
          provide: AuthenticationService,
          useValue: { currentRestaurantRole: { restaurant_id: 'r1' }, currentRestaurant: { name: 'Test' } },
        },
        { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => {} } },
        { provide: MenuService, useValue: { loadAllItems: () => {}, allItems$: of(MENU_ITEMS as any) } },
      ],
    }).compileComponents();

    reports = TestBed.inject(ReportsService);
    fixture = TestBed.createComponent(MenuReportComponent);
    component = fixture.componentInstance;
  });

  it('loads aggregates + the point-in-time active-items count for the default range', fakeAsync(() => {
    component.ngOnInit();
    tick(600);

    expect(component.ready).toBeTrue();
    expect(component.items.length).toBeGreaterThan(0);
    expect(component.current.units).toBeGreaterThan(0);
    expect(component.previous).not.toBeNull(); // comparison window resolved
    // Active items come from the live menu, NOT the range summary.
    expect(component.activeCount).toBe(2);
    expect(component.outOfStockCount).toBe(1);
  }));

  it('re-fetches the category grouping when the toggle changes', fakeAsync(() => {
    const spy = spyOn(reports, 'getMenuSummary').and.callThrough();

    component.ngOnInit();
    tick(600);
    // The category fetch (last source) carries the selected grouping.
    expect(spy.calls.mostRecent().args[3]).toBe('sections');

    component.onGrouping('groups');
    tick(600);
    expect(spy.calls.mostRecent().args[3]).toBe('groups');
    expect(component.grouping).toBe('groups');
    expect(component.ready).toBeTrue();
  }));

  it('Full menu switches the grouping to items', fakeAsync(() => {
    component.ngOnInit();
    tick(600);

    component.showFullMenu();
    tick(600);

    expect(component.grouping).toBe('items');
    expect(component.ready).toBeTrue();
  }));

  it('renders at a range longer than 31 days (no listing guard for menu)', fakeAsync(() => {
    reports.dateRange$.next({ preset: 'custom', from: '2026-01-01', to: '2026-06-30' });

    component.ngOnInit();
    tick(600);

    expect(component.ready).toBeTrue();
    expect(component.items.length).toBeGreaterThan(0);
  }));

  it('shows the empty state when no rows are returned', fakeAsync(() => {
    spyOn(reports, 'getMenuSummary').and.returnValue(of({ data: [] } as any));

    component.ngOnInit();
    tick(600);

    expect(component.ready).toBeFalse();
    expect(component.state).toBe('empty');
  }));

  it('shows the error state and retry re-triggers a fetch', fakeAsync(() => {
    spyOn(reports, 'getMenuSummary').and.returnValue(throwError(() => new Error('boom')));

    component.ngOnInit();
    tick(600);

    expect(component.state).toBe('error');

    const refreshSpy = spyOn(reports.refresh$, 'next');
    component.retry();
    expect(refreshSpy).toHaveBeenCalled();
  }));
});
