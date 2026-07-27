import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, discardPeriodicTasks, tick } from '@angular/core/testing';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { format, subDays } from 'date-fns';

import { DashboardComponent } from './dashboard.component';
import { DashboardService } from './services/dashboard.service';
import { MenuService } from '../menu/services/menu.service';
import { AuthenticationService } from '../../_services/authentication.service';
import {
  ComparisonOption,
  ReportDateRange,
  TimeframeService,
  classifyRangeShape,
  comparisonOptionsFor,
  resolveComparison,
} from '../../_shared/timeframe';

const today = format(new Date(), 'yyyy-MM-dd');
const daysAgo = (n: number) => format(subDays(new Date(), n), 'yyyy-MM-dd');

/** A range ending TODAY, i.e. still open. */
const openRange = (spanDays: number): ReportDateRange => ({
  preset: 'custom',
  from: daysAgo(spanDays),
  to: today,
});

/** A range wholly in the past, i.e. closed. */
const closedRange: ReportDateRange = { preset: 'custom', from: '2026-01-01', to: '2026-01-31' };

describe('DashboardComponent — timeframe wiring', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let component: DashboardComponent;
  let range$: BehaviorSubject<ReportDateRange>;
  let comparison$: BehaviorSubject<ComparisonOption>;
  let customFrom$: BehaviorSubject<string | null>;
  let refresh$: Subject<void>;
  let dashboardService: jasmine.SpyObj<DashboardService> & { refresh$: Subject<void> };
  let timeframeSet: jasmine.Spy;
  let timeframeSetComparison: jasmine.Spy;

  function boot(initial: ReportDateRange, basis: ComparisonOption = 'none'): void {
    range$ = new BehaviorSubject<ReportDateRange>(initial);
    // Defaults to 'none' so the pre-02B specs keep asserting the PRIMARY request in
    // isolation — with a basis set, every call count would also carry the comparison.
    comparison$ = new BehaviorSubject<ComparisonOption>(basis);
    customFrom$ = new BehaviorSubject<string | null>(null);
    refresh$ = new Subject<void>();
    timeframeSet = jasmine.createSpy('set');
    timeframeSetComparison = jasmine.createSpy('setComparison');

    const getDashboardData = jasmine.createSpy('getDashboardData').and.returnValue(of({ data: null }));
    const getReviewsSummary = jasmine.createSpy('getReviewsSummary').and.returnValue(of({ data: null }));

    dashboardService = {
      refresh$,
      lastFetchTimestamp$: new BehaviorSubject<number>(0),
      getDashboardData,
      getReviewsSummary,
    } as unknown as jasmine.SpyObj<DashboardService> & { refresh$: Subject<void> };

    TestBed.configureTestingModule({
      declarations: [DashboardComponent], // non-standalone
      // The child cards render as inert elements — this spec is about the data chain, not
      // about chart.js. NOTE this means it can NOT catch a missing
      // TimeframePickerComponent registration in RestaurantMgtModule.imports; that is an
      // AOT-only failure (NG8001) and build:prod is its gate.
      schemas: [CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA],
      providers: [
        { provide: DashboardService, useValue: dashboardService },
        {
          provide: TimeframeService,
          useValue: {
            range$: range$.asObservable(),
            comparison$: comparison$.asObservable(),
            customComparisonFrom$: customFrom$.asObservable(),
            get value() {
              return range$.value;
            },
            get comparisonValue() {
              return comparison$.value;
            },
            get customComparisonFromValue() {
              return customFrom$.value;
            },
            set: timeframeSet,
            setComparison: timeframeSetComparison,
          },
        },
        {
          provide: AuthenticationService,
          useValue: { currentRestaurantRole: { restaurant_id: 'r1' } },
        },
        { provide: MenuService, useValue: { loadAllItems: () => undefined, allItems$: of([]) } },
      ],
    });

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
  }

  afterEach(() => fixture?.destroy());

  /** The bucket argument of the most recent getDashboardData call. */
  const lastBucket = (): string =>
    dashboardService.getDashboardData.calls.mostRecent().args[3] as string;

  /** {from,to} of the most recent getDashboardData call. */
  const lastWindow = (): [string, string] => {
    const args = dashboardService.getDashboardData.calls.mostRecent().args;
    return [args[1] as string, args[2] as string];
  };

  // The ladder is unit-tested in timeframe-engine.spec.ts; what matters HERE is that the
  // resolved bucket is what actually reaches the API, rather than being computed and
  // then dropped on the floor.
  describe('bucket derivation reaches the request', () => {
    const cases: { label: string; span: number; bucket: string }[] = [
      { label: '1 day', span: 1, bucket: 'hour' },
      { label: '25 days', span: 25, bucket: 'day' },
      { label: '200 days', span: 200, bucket: 'month' },
      { label: '900 days', span: 900, bucket: 'year' },
    ];

    for (const c of cases) {
      it(`${c.label} → ${c.bucket}`, fakeAsync(() => {
        boot(openRange(c.span));
        fixture.detectChanges();
        tick();

        expect(lastBucket()).toBe(c.bucket);
        expect(component.bucketUnit).toBe(c.bucket as never);

        discardPeriodicTasks();
      }));
    }

    it('captures the range and bucket the rendered data was fetched for', fakeAsync(() => {
      boot(closedRange);
      fixture.detectChanges();
      tick();

      expect(component.range).toEqual(closedRange);
      expect(lastWindow()).toEqual([closedRange.from, closedRange.to]);
    }));
  });

  describe('conditional polling', () => {
    it('polls a range that includes today', fakeAsync(() => {
      boot(openRange(0));
      fixture.detectChanges();
      tick(); // initial fetch

      expect(dashboardService.getDashboardData).toHaveBeenCalledTimes(1);

      tick(30_000);
      expect(dashboardService.getDashboardData).toHaveBeenCalledTimes(2);

      tick(30_000);
      expect(dashboardService.getDashboardData).toHaveBeenCalledTimes(3);

      discardPeriodicTasks();
    }));

    // A finished period's numbers cannot change, so repolling it spends requests on a
    // settled answer.
    it('fetches a historical range exactly once and stops', fakeAsync(() => {
      boot(closedRange);
      fixture.detectChanges();
      tick();

      expect(dashboardService.getDashboardData).toHaveBeenCalledTimes(1);

      tick(120_000);
      expect(dashboardService.getDashboardData).toHaveBeenCalledTimes(1);
    }));

    it('still refetches a historical range on manual refresh', fakeAsync(() => {
      boot(closedRange);
      fixture.detectChanges();
      tick();
      expect(dashboardService.getDashboardData).toHaveBeenCalledTimes(1);

      component.retryDashboard();
      tick();

      expect(dashboardService.getDashboardData).toHaveBeenCalledTimes(2);
    }));

    it('restarts the chain when the range changes', fakeAsync(() => {
      boot(openRange(0));
      fixture.detectChanges();
      tick();
      expect(dashboardService.getDashboardData).toHaveBeenCalledTimes(1);

      range$.next(closedRange);
      tick();

      expect(dashboardService.getDashboardData).toHaveBeenCalledTimes(2);
      expect(lastWindow()).toEqual([closedRange.from, closedRange.to]);

      // ...and the newly-selected closed range does not resume polling.
      tick(120_000);
      expect(dashboardService.getDashboardData).toHaveBeenCalledTimes(2);
    }));
  });

  describe('loading state', () => {
    it('shows the skeleton on a range change but not on a background poll', fakeAsync(() => {
      boot(openRange(0));
      fixture.detectChanges();
      tick();
      expect(component.loading).toBeFalse();

      // A background poll must not flash the skeleton over data that is already on screen.
      tick(30_000);
      expect(component.loading).toBeFalse();

      range$.next(openRange(25));
      expect(component.loading).toBeTrue();
      tick();
      expect(component.loading).toBeFalse();

      discardPeriodicTasks();
    }));
  });

  it('commits a picked range through the service, not to local state', () => {
    boot(openRange(0));
    const picked: ReportDateRange = { preset: 'last-month', from: '2026-05-01', to: '2026-05-31' };

    component.onRange(picked);

    expect(timeframeSet).toHaveBeenCalledWith(picked);
  });
  // ─── Comparison basis (TIMEFRAME-02B) ──────────────────────────────────────────────
  //
  // The Dashboard stopped reading `dashboard-v2`'s `previous_totals` and now honours the
  // user's selected basis via a SECOND call for that window. Everything below is about
  // that call: whether it happens, what window it asks for, where the number comes from,
  // and — the one that would silently cost real money — that it never rides the poll.

  /** Every window `getDashboardData` was asked for, in call order. */
  const windows = (): string[] =>
    dashboardService.getDashboardData.calls
      .allArgs()
      .map((a) => `${a[1]}..${a[2]}`);

  /** Calls for anything OTHER than the primary window — i.e. the comparison ones. */
  const comparisonCalls = (primary: ReportDateRange): string[] =>
    windows().filter((w) => w !== `${primary.from}..${primary.to}`);

  describe("basis 'none'", () => {
    it('issues NO second request', fakeAsync(() => {
      boot(closedRange, 'none');
      fixture.detectChanges();
      tick();

      expect(dashboardService.getDashboardData).toHaveBeenCalledTimes(1);
      expect(comparisonCalls(closedRange)).toEqual([]);
    }));

    it('renders no comparison at all — window null, so no badge, chip or caption', fakeAsync(() => {
      boot(closedRange, 'none');
      fixture.detectChanges();
      tick();

      expect(component.comparisonWindow).toBeNull();
      expect(component.comparisonData).toBeNull();
    }));
  });

  // An UNPLACED custom period (TIMEFRAME-02D) takes the SAME path — it resolves to `null`,
  // so the Dashboard needs no branch of its own for "chosen but not yet placed".
  describe("basis 'custom' with no start placed", () => {
    it('issues no second request and renders no comparison', fakeAsync(() => {
      boot(closedRange, 'custom'); // customFrom$ seeds to null
      fixture.detectChanges();
      tick();

      expect(dashboardService.getDashboardData).toHaveBeenCalledTimes(1);
      expect(comparisonCalls(closedRange)).toEqual([]);
      expect(component.comparisonWindow).toBeNull();
      expect(component.comparisonData).toBeNull();
    }));

    it('fetches an equal-length window as soon as a start IS placed', fakeAsync(() => {
      boot(closedRange, 'custom');
      fixture.detectChanges();
      tick();
      expect(component.comparisonWindow).toBeNull();

      // closedRange is Jan 2026 — 31 inclusive days — so 1 Nov 2025 runs 1 Nov – 1 Dec.
      customFrom$.next('2025-11-01');
      tick();

      expect(component.comparisonWindow).toEqual({
        preset: 'custom',
        from: '2025-11-01',
        to: '2025-12-01',
      });
    }));
  });

  describe('a selected basis', () => {
    // A whole calendar July: the equal-length block before it is 31 May – 30 Jun, while
    // `prev-month` is 1–30 Jun. Choosing a range where the two DIFFER is the whole point —
    // on most ranges a wrong implementation would coincide with a right one.
    const july: ReportDateRange = { preset: 'custom', from: '2025-07-01', to: '2025-07-31' };

    it('requests exactly the window resolveComparison returns', fakeAsync(() => {
      boot(july, 'prev-month-by-day');
      fixture.detectChanges();
      tick();

      const expected = resolveComparison(july, 'prev-month-by-day')!;
      expect(expected.from).toBe('2025-06-01');
      expect(expected.to).toBe('2025-06-30'); // NOT 31 May – 30 Jun
      expect(comparisonCalls(july)).toEqual([`${expected.from}..${expected.to}`]);
    }));

    it('sends the same bucket as the primary request', fakeAsync(() => {
      boot(july, 'prev-month-by-day');
      fixture.detectChanges();
      tick();

      const buckets = dashboardService.getDashboardData.calls.allArgs().map((a) => a[3]);
      expect(new Set(buckets).size).toBe(1);
    }));

    it('captures the window it fetched, for the caption to name', fakeAsync(() => {
      boot(july, 'prev-month-by-day');
      fixture.detectChanges();
      tick();

      expect(component.comparisonWindow).toEqual(
        jasmine.objectContaining({ from: '2025-06-01', to: '2025-06-30' }),
      );
    }));

    // The 02B swap, asserted where it can actually be caught: a response whose two fields
    // DISAGREE. Reading `previous_totals` would give 999_999_999.
    it("takes the baseline from the comparison response's totals, never its previous_totals", fakeAsync(() => {
      const comparisonResponse = {
        data: {
          revenue: {
            series: [],
            totals: { gross: 500, net: 500, discounts: 0, refunds: 0 },
            previous_totals: { gross: 999999999, net: 999999999, discounts: 0, refunds: 0 },
          },
          orders: { series: [], breakdown: {}, total: 42, previous_total: 999999999 },
        },
      };
      boot(july, 'prev-month-by-day');
      dashboardService.getDashboardData.and.callFake(
        (...args: unknown[]) =>
          of(args[1] === july.from ? { data: null } : comparisonResponse) as never,
      );
      fixture.detectChanges();
      tick();

      expect(component.comparisonData!.revenue.totals.net).toBe(500);
      expect(component.comparisonData!.orders.total).toBe(42);
    }));

    // The offered set and the resolved window must be derived from the SAME range, or a
    // menu can offer an option the resolver will not honour.
    it('honours only a basis the resolver’s own window actually offers', fakeAsync(() => {
      boot(july, 'prev-month-by-day');
      fixture.detectChanges();
      tick();

      const window = component.comparisonWindow!;
      const shape = classifyRangeShape(july);
      expect(comparisonOptionsFor(shape)).toContain('prev-month-by-day');
      expect(resolveComparison(july, 'prev-month-by-day')).toEqual(window);
    }));
  });

  describe('the comparison never rides the poll', () => {
    // A comparison window is always in the past, so its data cannot change. Re-fetching it
    // every 30 seconds would be spending requests on a settled answer, forever.
    it('N poll ticks issue N primary requests and exactly ONE comparison request', fakeAsync(() => {
      const open = openRange(3);
      boot(open, 'prev-week');
      fixture.detectChanges();
      tick();

      const afterFirst = comparisonCalls(open).length;
      expect(afterFirst).toBe(1);

      tick(30_000);
      tick(30_000);
      tick(30_000);

      // Primary polled three more times…
      expect(windows().filter((w) => w === `${open.from}..${open.to}`).length).toBe(4);
      // …and the comparison did not move.
      expect(comparisonCalls(open).length).toBe(1);

      discardPeriodicTasks();
    }));
  });

  describe('the comparison re-fetches when its window changes', () => {
    const july: ReportDateRange = { preset: 'custom', from: '2025-07-01', to: '2025-07-31' };
    const june: ReportDateRange = { preset: 'custom', from: '2025-06-01', to: '2025-06-30' };

    it('on a range change — an arrow step or a calendar Apply', fakeAsync(() => {
      boot(july, 'prev-month-by-day');
      fixture.detectChanges();
      tick();
      expect(comparisonCalls(july)).toEqual(['2025-06-01..2025-06-30']);

      dashboardService.getDashboardData.calls.reset();
      range$.next(june);
      tick();

      // The new range's comparison is May, fetched fresh.
      expect(comparisonCalls(june)).toEqual(['2025-05-01..2025-05-31']);
    }));

    it('on an option change', fakeAsync(() => {
      boot(july, 'prev-month-by-day');
      fixture.detectChanges();
      tick();

      dashboardService.getDashboardData.calls.reset();
      comparison$.next('prev-year-by-day');
      tick();

      const expected = resolveComparison(july, 'prev-year-by-day')!;
      expect(comparisonCalls(july)).toEqual([`${expected.from}..${expected.to}`]);
    }));
  });

  it('commits a picked basis through the service, not to local state', () => {
    boot(openRange(0));

    component.onComparison({ option: 'prev-year' });

    expect(timeframeSetComparison).toHaveBeenCalledWith('prev-year', undefined);
  });
});
