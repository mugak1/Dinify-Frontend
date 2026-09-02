import { ChangeDetectionStrategy, Component, OnInit, OnDestroy } from '@angular/core';
import { Observable, Subject, combineLatest, of, timer } from 'rxjs';
import { switchMap, startWith, catchError, tap, takeUntil, takeWhile, map } from 'rxjs/operators';
import { DashboardService } from './services/dashboard.service';
import { AuthenticationService } from '../../_services/authentication.service';
import { MenuService } from 'src/app/restaurant-mgt/menu/services/menu.service';
import { MenuItem } from 'src/app/_models/app.models';
import { environment } from 'src/environments/environment';
import {
  ComparisonOption,
  ReportBucketUnit,
  ReportDateRange,
  TimeframeService,
  classifyRangeShape,
  defaultComparisonFor,
  isComparisonOfferedFor,
  rangeIncludesToday,
  resolveComparison,
  resolveTimeframe,
} from '../../_shared/timeframe';
import {
  DashboardV2Response,
  PopularItemData,
  ReviewsSummaryResponse,
} from './models/dashboard.models';

@Component({
    changeDetection: ChangeDetectionStrategy.Default,
    selector: 'app-rest-dashboard',
    templateUrl: './dashboard.component.html',
    standalone: false,
})
export class DashboardComponent implements OnInit, OnDestroy {
  private static readonly POLL_MS = 30_000;

  dashboardData: DashboardV2Response | null = null;
  reviewsData: ReviewsSummaryResponse | null = null;
  loading = true;
  error: string | null = null;
  reviewsLoading = true;
  reviewsError: string | null = null;

  /** Live range, for the picker binding only. */
  readonly range$ = this.timeframe.range$;

  /** Live comparison basis, for the picker binding only. */
  readonly comparison$ = this.timeframe.comparison$;

  /** Live custom-window start, for the picker binding only. */
  readonly customComparisonFrom$ = this.timeframe.customComparisonFrom$;

  /**
   * The comparison window's payload, and the window it covers. Both `null` while the
   * basis is `'none'` — which is what tells the cards to render no comparison row at all.
   *
   * Captured at fetch time for the same reason `range` is: the caption names the window,
   * and a caption describing a window the numbers beside it were not measured over is
   * exactly the kind of wrong that never looks wrong.
   */
  comparisonData: DashboardV2Response | null = null;
  comparisonWindow: ReportDateRange | null = null;

  /**
   * The range and bucket the CURRENTLY-RENDERED data was fetched for — captured at
   * fetch time, not read live. Binding the cards to `range$` directly would let their
   * axis format and comparison label describe a range one frame ahead of the numbers
   * beside them, which is exactly the kind of wrong that never looks wrong.
   */
  range: ReportDateRange | null = null;
  bucketUnit: ReportBucketUnit = 'hour';

  // Placeholder Popular Items metrics with real menu-item identities overlaid.
  popularItems: PopularItemData[] | null = null;
  private availableMenuItems: MenuItem[] = [];

  private destroy$ = new Subject<void>();

  constructor(
    public dashboardService: DashboardService,
    private timeframe: TimeframeService,
    private auth: AuthenticationService,
    private menuService: MenuService,
  ) {}

  /** Commit a range the user picked. The URL is the source of truth; the service owns it. */
  onRange(range: ReportDateRange): void {
    this.timeframe.set(range);
  }

  /** Commit a comparison basis the user picked. Mirrors `onRange`. */
  onComparison(e: { option: ComparisonOption; customFrom?: string | null }): void {
    // Basis and custom start commit TOGETHER — see `setComparison`. Two calls would leave a
    // frame where 'custom' names a stale window and every pipeline fetches it.
    this.timeframe.setComparison(e.option, e.customFrom);
  }

  ngOnInit(): void {
    const restaurantId = this.auth.currentRestaurantRole?.restaurant_id;
    if (!restaurantId) return;

    // Reuse the Menu module's existing fetch path to overlay real item
    // identities (name + image) onto the placeholder Popular Items metrics.
    this.menuService.loadAllItems(restaurantId);
    this.menuService.allItems$
      .pipe(takeUntil(this.destroy$))
      .subscribe((items) => {
        this.availableMenuItems = items.filter((it) => it.available);
        this.recomputePopularItems();
      });

    // Dashboard data: reacts to the shared timeframe and to manual refresh. Polls only
    // while the selected range is still open — see fetchTicks.
    combineLatest([
      this.timeframe.range$,
      this.dashboardService.refresh$.pipe(startWith(undefined)),
    ])
      .pipe(
        takeUntil(this.destroy$),
        // ABOVE the timer switchMap on purpose: the skeleton shows on a range change or
        // a manual refresh, never on a background poll tick.
        tap(() => {
          this.loading = true;
          this.error = null;
        }),
        switchMap(([range]) => this.fetchTicks(range).pipe(map(() => range))),
        switchMap((range) => {
          const { bucketUnit, effectiveRange } = resolveTimeframe(range);
          this.range = range;
          this.bucketUnit = bucketUnit;
          return this.dashboardService
            .getDashboardData(restaurantId, effectiveRange.from, effectiveRange.to, bucketUnit)
            .pipe(catchError((err) => of({ data: null, error: err })));
        }),
      )
      .subscribe((res: any) => {
        this.loading = false;
        if (res.data) {
          this.dashboardData = res.data;
          this.recomputePopularItems();
        } else {
          this.error = res.error?.message || 'Failed to load dashboard data';
        }
        this.dashboardService.lastFetchTimestamp$.next(Date.now());
      });

    // Comparison window: a SECOND call, deliberately OUTSIDE the polling chain.
    //
    // A comparison window is always in the past, so its data cannot change — fetching it
    // once per window change is the whole of the requirement. It cannot live in the stream
    // above: the 30s timer sits inside `fetchTicks`, so every tick re-emits `range` into
    // that stream's request `switchMap`, and a request placed there would poll a settled
    // answer forever.
    //
    // The window changes on an arrow step, a calendar Apply (both land on `range$` via
    // TimeframeService.set) and an option change (`comparison$`) — all three re-fetch here.
    // `refresh$` joins them so a manual retry re-attempts a comparison fetch that failed.
    combineLatest([
      this.timeframe.range$,
      this.timeframe.comparison$,
      this.timeframe.customComparisonFrom$,
      this.dashboardService.refresh$.pipe(startWith(undefined)),
    ])
      .pipe(
        takeUntil(this.destroy$),
        switchMap(([range, basis, customFrom]) => {
          const { bucketUnit, effectiveRange } = resolveTimeframe(range);
          // CLASSIFY AND RESOLVE FROM THE SAME WINDOW. `effectiveRange` is what the primary
          // request actually measured, so the baseline has to span the same length or the
          // delta compares unlike things. Below the ~1850-day cap the two are identical and
          // this is inert; above it, deriving the offered set from one window and the
          // comparison from another is how a menu comes to offer an option the resolver
          // will not honour.
          const shape = classifyRangeShape(effectiveRange);
          const honoured = isComparisonOfferedFor(shape, basis)
            ? basis
            : defaultComparisonFor(shape);
          const cmp = resolveComparison(effectiveRange, honoured, undefined, customFrom);
          this.comparisonWindow = cmp;

          // 'none' → no request at all. Nothing renders it, so fetching it would spend a
          // round trip answering a question the user declined to ask. An UNPLACED 'custom'
          // resolves to null too and takes this same path — a comparison not yet placed is
          // not a comparison, and needs no handling of its own.
          if (!cmp) return of({ data: null });
          return this.dashboardService
            .getDashboardData(restaurantId, cmp.from, cmp.to, bucketUnit)
            .pipe(catchError(() => of({ data: null })));
        }),
      )
      .subscribe((res: any) => {
        this.comparisonData = res.data ?? null;
      });

    // Reviews data: reacts to manual refresh; always polls in the background. NOT gated
    // on the timeframe — `reviews/summary/` takes no date range at all, so "the selected
    // window is closed" says nothing about whether reviews changed.
    this.dashboardService.refresh$
      .pipe(
        startWith(undefined),
        takeUntil(this.destroy$),
        tap(() => {
          this.reviewsLoading = true;
          this.reviewsError = null;
        }),
        switchMap(() => timer(0, DashboardComponent.POLL_MS)),
        switchMap(() =>
          this.dashboardService
            .getReviewsSummary(restaurantId)
            .pipe(catchError((err) => of({ data: null, error: err }))),
        ),
      )
      .subscribe((res: any) => {
        this.reviewsLoading = false;
        if (res.data) {
          this.reviewsData = res.data;
        } else {
          this.reviewsError = res.error?.message || 'Failed to load reviews';
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * One emission per fetch of `range`.
   *
   *   OPEN range (includes today) → poll every 30s; the numbers can still move.
   *   CLOSED range                → fetch exactly once. A finished period cannot change,
   *                                 so repolling it is spending requests on a settled
   *                                 answer. Manual refresh re-enters the OUTER
   *                                 combineLatest, so retryDashboard() still works here.
   *
   * The `takeWhile` covers midnight: `timer` captures `range` by closure, so a dashboard
   * left open overnight on "Today" would otherwise poll for yesterday forever. When the
   * captured range stops including today the poll stops rather than continuing to ask
   * for a window that is now closed. The displayed range stays as the URL describes it —
   * re-picking is the user's move, and quietly rewriting the URL under them is not ours.
   */
  private fetchTicks(range: ReportDateRange): Observable<unknown> {
    if (!rangeIncludesToday(range)) return of(0);
    return timer(0, DashboardComponent.POLL_MS).pipe(takeWhile(() => rangeIncludesToday(range)));
  }

  retryDashboard(): void {
    this.dashboardService.refresh$.next();
  }

  retryReviews(): void {
    this.dashboardService.refresh$.next();
  }

  /**
   * Overlays real menu-item identities onto the placeholder Popular Items
   * metrics. Revenue/qty/section stay mock; only name + image become real.
   * Each metric row is paired positionally with an available menu item (first
   * N in load order). Slots without a matching real item keep their mock
   * identity, so a short or empty menu still renders the full placeholder card.
   */
  private recomputePopularItems(): void {
    const metrics = this.dashboardData?.popular_items ?? null;
    if (!metrics) {
      this.popularItems = null;
      return;
    }
    const real = this.availableMenuItems;
    this.popularItems = metrics.map((m, i) => {
      const it = real[i];
      if (!it) return m;
      return {
        ...m,
        item_id: it.id,
        name: it.name,
        image_url: it.image ? environment.apiUrl + it.image : undefined,
      };
    });
  }

}
