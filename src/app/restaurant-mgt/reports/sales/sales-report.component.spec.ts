import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { SalesReportComponent } from './sales-report.component';
import { provideRouter } from '@angular/router';
import { ReportsService } from '../services/reports.service';
import { TimeframeService } from '../../../_shared/timeframe';
import { ApiService } from '../../../_services/api.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { LocalStorageService } from '../../../_services/storage/local-storage.service';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

describe('SalesReportComponent', () => {
  let component: SalesReportComponent;
  let fixture: ComponentFixture<SalesReportComponent>;
  let reports: ReportsService;
  let timeframe: TimeframeService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SalesReportComponent],
      providers: [
        provideRouter([]),
        TimeframeService,
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

    timeframe = TestBed.inject(TimeframeService);
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
    timeframe.set({ preset: 'today', from: '2026-06-15', to: '2026-06-15' });
    component.ngOnInit();
    tick(600);

    expect(component.ready).toBeTrue();
    expect(component.breakdownTitle).toBe('Hourly breakdown');
    expect(component.trendPoints.length).toBe(24); // one point per hour-of-day
    expect(component.showWeekday).toBeFalse();
  }));

  it('uses the monthly bucket for a single calendar year and hides the weekday cycle', fakeAsync(() => {
    // ~364 days ≤ the 731-day monthly cap → a single year stays a MONTHLY bucket.
    timeframe.set({ preset: 'this-year', from: '2026-01-01', to: '2026-12-31' });
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
    timeframe.set({ preset: 'custom', from: '2023-01-01', to: '2026-12-31' });
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
  // ─── Comparison basis (TIMEFRAME-02A) ──────────────────────────────────────────────
  //
  // Before 02A the comparison window was fetched on EVERY load regardless of the compare
  // toggle — wasted work then, indefensible once "No comparison" is a deliberate choice.
  // Driven through the LIVE pipeline (comparison$ is one of its inputs), which is how a
  // user actually flips the basis.
  describe('comparison basis', () => {
    it("issues NO comparison request while the basis is 'none', and one when it is not", fakeAsync(() => {
      const spy = spyOn(reports, 'getSalesAggregate').and.callThrough();

      timeframe.setComparison('none');
      component.ngOnInit();
      tick(600);

      const withoutComparison = spy.calls.count();
      expect(component.previous).toBeNull();

      // Flip to a real basis on the same live pipeline: one MORE call, and a comparison.
      spy.calls.reset();
      timeframe.setComparison('prev-month-by-day');
      tick(600);

      expect(spy.calls.count()).toBeGreaterThan(withoutComparison);
      expect(component.previous).not.toBeNull();
    }));
  });
});
