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
    // A TRADING day. 15 Jun 2026 is a Monday, and the mock restaurant is shut on Mondays, so
    // that date now resolves to a zero-order range and the empty state — correctly. The date
    // was incidental to what this spec is about; the 16th is the same test with trade in it.
    timeframe.set({ preset: 'today', from: '2026-06-16', to: '2026-06-16' });
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

    // An UNPLACED custom period issues no request either — it resolves to `null`, the exact
    // path `'none'` already takes, so the surface needs no branch of its own for it.
    it("issues NO comparison request for a 'custom' basis with no start placed", fakeAsync(() => {
      const spy = spyOn(reports, 'getSalesAggregate').and.callThrough();

      timeframe.setComparison('none');
      component.ngOnInit();
      tick(600);
      const baseline = spy.calls.count();

      spy.calls.reset();
      timeframe.setComparison('custom'); // no start
      tick(600);

      expect(spy.calls.count()).toBe(baseline);
    }));
  });

  // ─── Densification ────────────────────────────────────────────────────────────────
  //
  // The mock now shuts on Mondays and drops those buckets, mirroring the backend's group-by,
  // so this suite can finally observe the thing the fix is about.
  describe('series densification', () => {
    it('fills the closed days back in, so the series spans the whole range', fakeAsync(() => {
      // June 2026 has 30 days, five of them Mondays. The wire returns 25 buckets; the chart
      // must still plot 30, or the axis runs Sunday straight through to Tuesday.
      timeframe.set({ preset: 'custom', from: '2026-06-01', to: '2026-06-30' });
      component.ngOnInit();
      tick(600);

      expect(component.trendPoints.length).toBe(30);
      expect(component.trendPoints.filter((p) => p.orders === 0).length).toBe(5);
      expect(component.trendPoints[0].key).toBe('2026-06-01');
      expect(component.trendPoints[29].key).toBe('2026-06-30');
      // The breakdown table is a 1:1 map of the series, so it gains the same zero rows.
      expect(component.breakdownRows.length).toBe(30);
    }));

    it('leaves the totals to the buckets that traded', fakeAsync(() => {
      timeframe.set({ preset: 'custom', from: '2026-06-01', to: '2026-06-30' });
      component.ngOnInit();
      tick(600);

      const summed = component.trendPoints.reduce((a, p) => a + p.orders, 0);
      expect(component.current.orders).toBe(summed); // zero buckets contribute nothing
      expect(component.current.aov).toBe(Math.round(component.current.revenue / summed));
    }));

    // THE PAIR that keeps the two empty comparison cases distinguishable. `cmpRows` is empty
    // both when no request was made and when a real window had no trade; only the window
    // argument tells them apart, which is why it must be `p.cmp` and never `p.range`.
    it("yields previous === null under 'none' — no window, so nothing to fill", fakeAsync(() => {
      timeframe.setComparison('none');
      component.ngOnInit();
      tick(600);

      expect(component.previous).toBeNull();
      expect(component.trendComparisonPoints).toEqual([]);
      // And the chips are hidden by compareEnabled, not by the null — assert the real reason.
      let compareOn = true;
      component.compareEnabled$.subscribe((v) => (compareOn = v));
      expect(compareOn).toBeFalse();
    }));

    it('yields a ZEROED previous for a real comparison window that returned nothing', fakeAsync(() => {
      // A window before the restaurant existed. Densified it is a full run of zero points, so
      // `previous` is a zeroed SalesTotals rather than null — correct, and distinguishable
      // from the 'none' case above, which is the property this all turns on.
      const real = reports.getSalesAggregate.bind(reports);
      let call = 0;
      spyOn(reports, 'getSalesAggregate').and.callFake((...args: any[]) => {
        // Call order within one emission is main, then comparison.
        call += 1;
        return call === 2 ? of({ data: [] } as any) : (real as any)(...args);
      });

      timeframe.setComparison('prev-month-by-day');
      component.ngOnInit();
      tick(600);

      expect(component.previous).not.toBeNull();
      expect(component.previous!.orders).toBe(0);
      expect(component.previous!.revenue).toBe(0);
      expect(component.trendComparisonPoints.length).toBeGreaterThan(0);
      expect(component.trendComparisonPoints.every((p) => p.orders === 0)).toBeTrue();
    }));
  });
});
