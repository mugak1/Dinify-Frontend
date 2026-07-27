// Sales report — the mock-first analytics surface (PR B of the Reports redesign).
//
// Orchestrator only: it owns the data flow and hands each card a finished view
// model. The shared timeframe drives everything through the PR-A engine —
// resolveTimeframe(range) picks the bucket (hour/day/month/year) and resolveComparison
// gives the window the user chose to compare against, for the ghost line + delta chips.
// Per the engine: today → hourly, week/month → daily, year → monthly, multi-year → annual. All card maths live
// in the pure sales-view helpers; the cards themselves are presentational.

import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, Subject, combineLatest, of } from 'rxjs';
import { catchError, map, startWith, switchMap, takeUntil, tap } from 'rxjs/operators';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { ReportsService } from '../services/reports.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import {
  ComparisonOption,
  comparisonCaption,
  ReportBucketUnit,
  ReportDateRange,
  resolveComparison,
  resolveTimeframe,
  SalesTrendsCategory,
  TimeframeService,
} from '../../../_shared/timeframe';
import {
  ReportColumn,
  SalesAggregateRow,
  SalesHourlyRow,
  SalesListingRow,
} from '../models/reports.models';
import { mockSalesRefunds } from '../data/reports-mock-data';
import {
  EMPTY_TOTALS,
  HourBar,
  SalesBreakdownRow,
  SalesPoint,
  SalesTotals,
  WeekdayRevenue,
  aggregateByWeekday,
  bestPoint,
  breakdownTotals,
  computeTotals,
  hourDisplayWindow,
  normalizeSeries,
  salesBucketView,
  toBreakdownRows,
  weekdayEligible,
} from './sales-view';
import { ReportStateComponent, ReportStateMode } from '../components/report-state/report-state.component';
import { SalesHeroComponent } from './sales-hero.component';
import { RevenueTrendCardComponent } from './revenue-trend-card.component';
import { SalesKpiRailComponent } from './sales-kpi-rail.component';
import { RevenueWeekdayCardComponent } from './revenue-weekday-card.component';
import { OrdersByHourCardComponent } from './orders-by-hour-card.component';
import { SalesBreakdownCardComponent } from './sales-breakdown-card.component';
import { PageHeaderComponent } from '../../../_shared/ui/page-header/page-header.component';

/** Per-order export columns (granular drill-down for ≤31-day ranges). */
const SALES_LISTING_COLUMNS: ReportColumn[] = [
  { key: 'order_number', label: 'Order', format: 'text' },
  { key: 'time_created', label: 'Time', format: 'datetime' },
  { key: 'item_count', label: 'Items', format: 'number', align: 'right', total: true },
  { key: 'gross', label: 'Gross', format: 'ugx', align: 'right', total: true },
  { key: 'discount', label: 'Discount', format: 'ugx', align: 'right', total: true },
  { key: 'revenue', label: 'Net', format: 'ugx', align: 'right', total: true },
  { key: 'payment_mode', label: 'Method', format: 'text' },
  { key: 'payment_status', label: 'Status', format: 'status' },
];

@Component({
  selector: 'app-sales-report',
  standalone: true,
  imports: [
    CommonModule,
    PageHeaderComponent,
    ReportStateComponent,
    SalesHeroComponent,
    RevenueTrendCardComponent,
    SalesKpiRailComponent,
    RevenueWeekdayCardComponent,
    OrdersByHourCardComponent,
    SalesBreakdownCardComponent,
  ],
  templateUrl: './sales-report.component.html',
})
export class SalesReportComponent implements OnInit, OnDestroy {
  /** Whether a comparison is being shown at all — gates the ghost line + delta chips.
   *  Derived from the shared basis, so "No comparison" hides them exactly as the old
   *  boolean toggle did, and the templates' `@let compareOn` line is unchanged. */
  readonly compareEnabled$ = this.timeframe.comparison$.pipe(map((o) => o !== 'none'));
  ready = false;
  stateMode: ReportStateMode = 'loading';
  range: ReportDateRange | null = null;
  comparisonLabel = '';
  /**
   * The basis and bucket the RENDERED series was built for — captured at apply time, the
   * same discipline as `range`. Reading them live would let the trend chart pair its two
   * series by a selection the points on screen predate, which is the kind of wrong that
   * never looks wrong.
   */
  basis: ComparisonOption = 'none';
  bucketUnit: ReportBucketUnit = 'hour';

  // Hero + KPI (range-aggregate).
  current: SalesTotals = EMPTY_TOTALS;
  previous: SalesTotals | null = null;
  refunds = 0;
  prevRefunds = 0;

  // Trend (bucket-driven) + KPI series.
  trendPoints: SalesPoint[] = [];
  trendComparisonPoints: SalesPoint[] = [];
  kpiPoints: SalesPoint[] = [];

  // Weekday cycle.
  showWeekday = false;
  weekdayDays: WeekdayRevenue[] = [];
  weekdayBest: number | null = null;

  // Hour-of-day cycle.
  hourBars: HourBar[] = [];
  hourPeak: number | null = null;

  // Breakdown table.
  breakdownTitle = 'Breakdown';
  breakdownPeriodLabel = 'Period';
  breakdownRows: SalesBreakdownRow[] = [];
  breakdownTotalsRec: Record<string, number> | null = null;
  breakdownBestKey?: string;

  // Export (granular, never rolled up).
  exportColumns: ReportColumn[] = [];
  exportRows: unknown[] = [];
  exportDisabled = false;
  exportDisabledReason = '';

  private destroy$ = new Subject<void>();

  constructor(
    private reports: ReportsService,
    private timeframe: TimeframeService,
    private auth: AuthenticationService,
  ) {}

  ngOnInit(): void {
    const restaurantId = this.auth.currentRestaurantRole?.restaurant_id;
    if (!restaurantId) {
      this.ready = false;
      this.stateMode = 'error';
      return;
    }

    combineLatest([
      this.timeframe.range$,
      this.timeframe.comparison$,
      this.timeframe.customComparisonFrom$,
      this.reports.refresh$.pipe(startWith(undefined)),
    ])
      .pipe(
        takeUntil(this.destroy$),
        tap(() => {
          this.ready = false;
          this.stateMode = 'loading';
        }),
        switchMap(([range, basis, customFrom]) => {
          const tf = resolveTimeframe(range);
          const cmp = resolveComparison(range, basis, undefined, customFrom);
          const er = tf.effectiveRange;
          const inclusiveDays = differenceInCalendarDays(parseISO(range.to), parseISO(range.from)) + 1;

          const main$ = this.fetchSeries(restaurantId, er.from, er.to, tf.category).pipe(
            catchError((error) => of({ data: null, error } as any)),
          );
          // NO REQUEST when the basis is 'none'. Before 02A this fired regardless of the
          // compare toggle — wasted then, indefensible now that a user can deliberately
          // ask for no comparison and still be charged a round trip for one.
          const cmp$ = cmp
            ? this.fetchSeries(restaurantId, cmp.from, cmp.to, tf.category).pipe(
                catchError(() => of({ data: null } as any)),
              )
            : of({ data: null } as any);
          // The hour-of-day card needs the 24-hour shape for ANY range; reuse main when it IS hourly.
          const hourly$ =
            tf.bucketUnit === 'hour'
              ? main$
              : this.reports
                  .getSalesHourly(restaurantId, range.from, range.to)
                  .pipe(catchError(() => of({ data: null } as any)));
          // Granular per-order export only within the listing window (≤31 days).
          const listing$ =
            inclusiveDays <= 31
              ? this.reports
                  .getSalesListing(restaurantId, range.from, range.to)
                  .pipe(catchError(() => of({ data: null } as any)))
              : of({ data: null } as any);

          return combineLatest([main$, cmp$, hourly$, listing$]).pipe(
            map(([main, comparison, hourly, listing]) => ({
              range,
              basis,
              tf,
              cmp,
              inclusiveDays,
              main,
              comparison,
              hourly,
              listing,
            })),
          );
        }),
      )
      .subscribe((payload) => this.apply(payload));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  retry(): void {
    this.reports.refresh$.next();
  }

  // Consume the timeframe engine's category verbatim (single source of truth): it
  // already picked the right bucket+category for the range and clamped any over-cap
  // span, so a request the backend would 400 is never issued here. A `null` category
  // is the hour bucket, which routes to the sales-hourly endpoint.
  private fetchSeries(
    restaurantId: string,
    from: string,
    to: string,
    category: SalesTrendsCategory | null,
  ): Observable<any> {
    if (category === null) {
      return this.reports.getSalesHourly(restaurantId, from, to);
    }
    return this.reports.getSalesAggregate(restaurantId, from, to, category);
  }

  private apply(p: {
    range: ReportDateRange;
    basis: ComparisonOption;
    tf: ReturnType<typeof resolveTimeframe>;
    cmp: ReportDateRange | null;
    inclusiveDays: number;
    main: any;
    comparison: any;
    hourly: any;
    listing: any;
  }): void {
    this.range = p.range;
    const bucketUnit = p.tf.bucketUnit;

    if (!p.main || p.main.data == null) {
      this.ready = false;
      this.stateMode = 'error';
      return;
    }

    const mainRows = p.main.data as SalesAggregateRow[] | SalesHourlyRow[];
    // Densify to `effectiveRange`, NOT `p.range` — the fetch above used the same, and the
    // engine's over-cap clamp moves `from`. Filling to the raw range would fabricate buckets
    // that were never requested.
    const mainPoints = normalizeSeries(mainRows, bucketUnit, p.tf.effectiveRange);
    const current = computeTotals(mainPoints);
    // `mainPoints.length === 0` used to guard this too; densification made it unreachable for
    // any non-empty window. `current.orders === 0` is what catches a dead range now.
    if (current.orders === 0) {
      this.ready = false;
      this.stateMode = 'empty';
      return;
    }

    const view = salesBucketView(bucketUnit);
    const cmpRows = (p.comparison?.data ?? []) as SalesAggregateRow[] | SalesHourlyRow[];
    // `p.cmp`, never `p.range` — and its NULLNESS is load-bearing. `cmpRows` is empty in two
    // different situations: the basis is 'none' (no request was ever made) and a real window
    // that had no trade. A null window skips densification, so the first keeps yielding `[]`
    // → `previous === null` → no chips. Densifying unconditionally would light every chip up
    // against a baseline the user explicitly asked not to have.
    const cmpPoints = normalizeSeries(cmpRows, bucketUnit, p.cmp);

    // Hero + KPI rail.
    this.current = current;
    this.previous = cmpPoints.length ? computeTotals(cmpPoints) : null;
    // Refunds derive from the shared per-(restaurant,day) basis, so they reconcile
    // with the aggregate. ngOnInit already bailed if there's no restaurant id.
    const refundRestaurantId = this.auth.currentRestaurantRole?.restaurant_id ?? '';
    this.refunds = mockSalesRefunds(refundRestaurantId, p.range.from, p.range.to);
    this.prevRefunds = p.cmp ? mockSalesRefunds(refundRestaurantId, p.cmp.from, p.cmp.to) : 0;
    this.comparisonLabel = comparisonCaption(p.basis);
    this.basis = p.basis;
    this.bucketUnit = bucketUnit;

    // Trend + KPI series.
    this.trendPoints = mainPoints;
    this.trendComparisonPoints = cmpPoints;
    this.kpiPoints = mainPoints;

    // Weekday cycle — only over a daily bucket of ≈2+ weeks.
    this.showWeekday = weekdayEligible(bucketUnit, p.inclusiveDays);
    if (this.showWeekday) {
      const wk = aggregateByWeekday(mainRows as SalesAggregateRow[]);
      this.weekdayDays = wk.days;
      this.weekdayBest = wk.bestWeekday;
    } else {
      this.weekdayDays = [];
      this.weekdayBest = null;
    }

    // Hour-of-day cycle — always on.
    const hourlyRows = (p.hourly?.data ?? []) as SalesHourlyRow[];
    const hw = hourDisplayWindow(hourlyRows);
    this.hourBars = hw.bars;
    this.hourPeak = hw.peakHour;

    // Breakdown table (rolled up to the bucket).
    this.breakdownTitle = view.tableTitle;
    this.breakdownPeriodLabel = this.periodLabel(bucketUnit);
    this.breakdownRows = toBreakdownRows(mainPoints);
    this.breakdownTotalsRec = breakdownTotals(mainPoints);
    this.breakdownBestKey = bestPoint(mainPoints)?.key;

    // Export — granular per-order when available, else the bucket rows.
    const listingRows = (p.listing?.data ?? null) as SalesListingRow[] | null;
    if (listingRows && listingRows.length) {
      this.exportColumns = SALES_LISTING_COLUMNS;
      this.exportRows = listingRows;
    } else {
      this.exportColumns = this.bucketExportColumns();
      this.exportRows = this.breakdownRows;
    }
    this.exportDisabled = false;
    this.exportDisabledReason = '';

    this.ready = true;
  }

  private periodLabel(bucketUnit: ReportBucketUnit): string {
    if (bucketUnit === 'hour') return 'Hour';
    if (bucketUnit === 'day') return 'Day';
    if (bucketUnit === 'year') return 'Year';
    return 'Month';
  }

  private bucketExportColumns(): ReportColumn[] {
    return [
      { key: 'label', label: this.breakdownPeriodLabel, format: 'text', align: 'left' },
      { key: 'orders', label: 'Orders', format: 'number', align: 'right', total: true },
      { key: 'gross', label: 'Gross', format: 'ugx', align: 'right', total: true },
      { key: 'discount', label: 'Discounts', format: 'ugx', align: 'right', total: true },
      { key: 'net', label: 'Net', format: 'ugx', align: 'right', total: true },
    ];
  }
}
