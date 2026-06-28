import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { SalesReportComponent } from './sales-report.component';
import { ReportsService } from '../services/reports.service';
import { ApiService } from '../../../_services/api.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { LocalStorageService } from '../../../_services/storage/local-storage.service';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

describe('SalesReportComponent', () => {
  let component: SalesReportComponent;
  let fixture: ComponentFixture<SalesReportComponent>;
  let reports: ReportsService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SalesReportComponent],
      providers: [
        provideCharts(withDefaultRegisterables()),
        { provide: ApiService, useValue: jasmine.createSpyObj('ApiService', ['get', 'loadAllPages']) },
        {
          provide: AuthenticationService,
          useValue: { currentRestaurantRole: { restaurant_id: 'r1' }, currentRestaurant: { name: 'Test' } },
        },
        { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => {} } },
      ],
    }).compileComponents();

    reports = TestBed.inject(ReportsService);
    fixture = TestBed.createComponent(SalesReportComponent);
    component = fixture.componentInstance;
  });

  it('renders the full card set for the default this-month (daily) range', fakeAsync(() => {
    component.ngOnInit();
    tick(600);

    expect(component.ready).toBeTrue();
    expect(component.current.orders).toBeGreaterThan(0);
    expect(component.breakdownTitle).toBe('Daily breakdown');
    expect(component.breakdownRows.length).toBe(component.trendPoints.length);
    expect(component.hourBars.length).toBe(12); // 11:00–22:00 window
    expect(component.showWeekday).toBeTrue(); // ~30 days of daily data
    expect(component.previous).not.toBeNull(); // comparison window resolved
  }));

  it('uses the hourly bucket for a single-day range and hides the weekday cycle', fakeAsync(() => {
    reports.dateRange$.next({ preset: 'today', from: '2026-06-15', to: '2026-06-15' });
    component.ngOnInit();
    tick(600);

    expect(component.ready).toBeTrue();
    expect(component.breakdownTitle).toBe('Hourly breakdown');
    expect(component.trendPoints.length).toBe(24); // one point per hour-of-day
    expect(component.showWeekday).toBeFalse();
  }));

  it('uses the monthly bucket for a single calendar year and hides the weekday cycle', fakeAsync(() => {
    // ~364 days ≤ the 731-day monthly cap → a single year stays a MONTHLY bucket.
    reports.dateRange$.next({ preset: 'this-year', from: '2026-01-01', to: '2026-12-31' });
    component.ngOnInit();
    tick(600);

    expect(component.ready).toBeTrue();
    expect(component.breakdownTitle).toBe('Monthly breakdown');
    expect(component.showWeekday).toBeFalse();
  }));

  it('uses the annual bucket for a multi-year range and requests category=annual [B2]', fakeAsync(() => {
    // ~1460 days (>731-day monthly cap, ≤1850-day annual cap) → the engine resolves
    // 'annual'; the component must consume tf.category and NOT collapse it to monthly
    // (which the backend would 400). callThrough so the mock still feeds the cards.
    const aggSpy = spyOn(reports, 'getSalesAggregate').and.callThrough();
    reports.dateRange$.next({ preset: 'custom', from: '2023-01-01', to: '2026-12-31' });
    component.ngOnInit();
    tick(600);

    expect(component.ready).toBeTrue();
    expect(component.breakdownTitle).toBe('Yearly breakdown');
    expect(component.showWeekday).toBeFalse();
    expect(aggSpy).toHaveBeenCalledWith('r1', jasmine.any(String), jasmine.any(String), 'annual');
    expect(aggSpy).not.toHaveBeenCalledWith('r1', jasmine.any(String), jasmine.any(String), 'monthly');
  }));

  it('shows the empty state when no data is returned', fakeAsync(() => {
    spyOn(reports, 'getSalesAggregate').and.returnValue(of({ data: [] } as any));
    spyOn(reports, 'getSalesHourly').and.returnValue(of({ data: [] } as any));
    spyOn(reports, 'getSalesListing').and.returnValue(of({ data: [] } as any));

    component.ngOnInit();
    tick(600);

    expect(component.ready).toBeFalse();
    expect(component.stateMode).toBe('empty');
  }));

  it('shows the error state and retry re-triggers a fetch', fakeAsync(() => {
    spyOn(reports, 'getSalesAggregate').and.returnValue(throwError(() => new Error('boom')));
    spyOn(reports, 'getSalesHourly').and.returnValue(of({ data: [] } as any));
    spyOn(reports, 'getSalesListing').and.returnValue(of({ data: [] } as any));

    component.ngOnInit();
    tick(600);

    expect(component.ready).toBeFalse();
    expect(component.stateMode).toBe('error');

    const refreshSpy = spyOn(reports.refresh$, 'next');
    component.retry();
    expect(refreshSpy).toHaveBeenCalled();
  }));
});
