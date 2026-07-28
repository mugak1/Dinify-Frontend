import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { of, throwError } from 'rxjs';

import { SalesReportComponent } from './sales-report.component';
import { provideRouter } from '@angular/router';
import { ReportsService } from '../services/reports.service';
import { resolveTimeframe, TimeframeService } from '../../../_shared/timeframe';
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
    // The date is incidental to what this spec is about — any single day gives an hourly
    // bucket. (It was moved off the 15th when the mock shut on Mondays; closures are off
    // again, so both dates now trade, and it is left here rather than churned back.)
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

  // ─── The comparison window spans the PRIMARY's window (REPORTS-COMPARISON-00) ──────
  //
  // The invariant is same-window-as-primary, not "use effectiveRange". Sales fetches its
  // primary over `effectiveRange`, so its comparison must resolve from there too; above the
  // annual cap the clamp moves `from` and the raw range is ~900 days longer, which would set
  // a longer baseline beside a clamped primary and call the arithmetic a trend.
  //
  // Reachable only through a hand-crafted over-cap URL, which is why nothing caught it.
  describe('comparison window vs the primary window', () => {
    const OVER_CAP = { preset: 'custom' as const, from: '2019-01-01', to: '2026-06-30' };
    const span = (from: string, to: string) =>
      differenceInCalendarDays(parseISO(to), parseISO(from)) + 1;

    it('measures the comparison over the same span as the primary request', fakeAsync(() => {
      const spy = spyOn(reports, 'getSalesAggregate').and.callThrough();
      timeframe.set(OVER_CAP);
      timeframe.setComparison('prev-period');
      component.ngOnInit();
      tick(600);

      // [0] is main$ (the primary), [1] is cmp$ — both built eagerly, in source order.
      const [primary, comparison] = spy.calls.allArgs();
      expect(spy.calls.count()).toBe(2);
      expect(span(comparison[1], comparison[2])).toBe(span(primary[1], primary[2]));
    }));

    it('clamps both windows to the cap — not the primary alone', fakeAsync(() => {
      const spy = spyOn(reports, 'getSalesAggregate').and.callThrough();
      timeframe.set(OVER_CAP);
      timeframe.setComparison('prev-period');
      component.ngOnInit();
      tick(600);

      const effective = resolveTimeframe(OVER_CAP).effectiveRange;
      const capped = span(effective.from, effective.to);
      const raw = span(OVER_CAP.from, OVER_CAP.to);
      expect(capped).toBeLessThan(raw); // the fixture really is over the cap

      const [primary, comparison] = spy.calls.allArgs();
      expect(span(primary[1], primary[2])).toBe(capped);
      // Was `raw` before the fix — a baseline ~900 days longer than what it was compared to.
      expect(span(comparison[1], comparison[2])).toBe(capped);
    }));
  });

  // ─── Series spans the window ──────────────────────────────────────────────────────
  //
  // MOCK-NO-CLOSURES-00: the mock trades every day again (CLOSED_WEEKDAY = null), so the wire
  // hands this component a DENSE series and there is nothing here for `normalizeSeries` to
  // fill. The fill itself is covered by `sales-view.spec.ts`, whose sparse fixtures are
  // hand-built and never touched the mock. What is still worth pinning end to end is that the
  // rendered series spans the SELECTED WINDOW rather than whatever the wire happened to send —
  // true at any wire density, and the thing that breaks if the window stops being threaded in.
  describe('series spans the selected window', () => {
    it('plots every day of the range, in order', fakeAsync(() => {
      timeframe.set({ preset: 'custom', from: '2026-06-01', to: '2026-06-30' });
      component.ngOnInit();
      tick(600);

      expect(component.trendPoints.length).toBe(30);
      expect(component.trendPoints[0].key).toBe('2026-06-01');
      expect(component.trendPoints[29].key).toBe('2026-06-30');
      // The breakdown table is a 1:1 map of the series.
      expect(component.breakdownRows.length).toBe(30);
    }));

    it('totals the plotted series exactly — the headline and the chart agree', fakeAsync(() => {
      timeframe.set({ preset: 'custom', from: '2026-06-01', to: '2026-06-30' });
      component.ngOnInit();
      tick(600);

      // Holds whether or not the series carries filled zero buckets: a zero bucket adds
      // nothing to the sum, so the headline matches the chart at any wire density.
      const summed = component.trendPoints.reduce((a, p) => a + p.orders, 0);
      expect(component.current.orders).toBe(summed);
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
