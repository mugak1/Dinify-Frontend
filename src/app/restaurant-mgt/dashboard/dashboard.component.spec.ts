import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, discardPeriodicTasks, tick } from '@angular/core/testing';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { format, subDays } from 'date-fns';

import { DashboardComponent } from './dashboard.component';
import { DashboardService } from './services/dashboard.service';
import { MenuService } from '../menu/services/menu.service';
import { AuthenticationService } from '../../_services/authentication.service';
import { ReportDateRange, TimeframeService } from '../../_shared/timeframe';

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
  let refresh$: Subject<void>;
  let dashboardService: jasmine.SpyObj<DashboardService> & { refresh$: Subject<void> };
  let timeframeSet: jasmine.Spy;

  function boot(initial: ReportDateRange): void {
    range$ = new BehaviorSubject<ReportDateRange>(initial);
    refresh$ = new Subject<void>();
    timeframeSet = jasmine.createSpy('set');

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
            get value() {
              return range$.value;
            },
            set: timeframeSet,
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
});
