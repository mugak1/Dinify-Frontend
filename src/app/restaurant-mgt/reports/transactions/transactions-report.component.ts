// Transactions report — the mock-first analytics surface (PR D of the Reports redesign).
//
// The most payment-gated tab: real data lives on DinifyTransaction and stays empty
// until the PSP integration (Gate 2), so it is built fully on mock now. Orchestrator
// only — TWO independent pipelines: a SUMMARY pipeline (range + the selected comparison) drives
// the four chips + the status breakdown over the FULL range; a LISTING pipeline (range +
// the status-filter chip) drives the recent-transactions table over the most-recent-31-day
// window. All display vocab is PROVISIONAL (transactions-view), reconciled at Gate 2.

import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BehaviorSubject, Subject, combineLatest, of } from 'rxjs';
import { catchError, map, startWith, switchMap, takeUntil, tap } from 'rxjs/operators';
import { ReportsService } from '../services/reports.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import {
  ComparisonOption,
  comparisonCaption,
  resolveComparison,
  ReportDateRange,
  TimeframeService,
} from '../../../_shared/timeframe';
import { ReportColumn, TransactionsListingRow, TransactionsSummary } from '../models/reports.models';
import { sumColumns } from '../data/reports-mock-data';
import { formatUGX } from '../../../_shared/utils/price-utils';
import {
  EMPTY_TXN_METRICS,
  StatusBreakdown,
  TxnFilterChip,
  TxnMetrics,
  filterChipParam,
  isCashMode,
  listingDisplayStatus,
  methodDisplay,
  recentWindow,
  statusBreakdown,
  txnSummaryMetrics,
  typeDisplay,
} from './transactions-view';
import { ReportStateComponent, ReportStateMode } from '../components/report-state/report-state.component';
import { ReportExportBarComponent } from '../components/report-export-bar/report-export-bar.component';
import { ReportDeltaChipComponent } from '../components/delta-chip/delta-chip.component';
import { CardComponent } from '../../../_shared/ui/card/card.component';
import { TransactionsStatusBreakdownComponent } from './transactions-status-breakdown.component';
import { TransactionsListingComponent } from './transactions-listing.component';
import { PageHeaderComponent } from '../../../_shared/ui/page-header/page-header.component';

/** Display columns for the listing + export (Txn / Time / Type / Method / Amount / Status). */
const LISTING_COLUMNS: ReportColumn[] = [
  { key: 'order_number', label: 'Txn', format: 'text' },
  { key: 'time_created', label: 'Time', format: 'datetime' },
  { key: 'transaction_type', label: 'Type', format: 'text' },
  { key: 'method', label: 'Method', format: 'text' },
  { key: 'amount', label: 'Amount', format: 'ugx', align: 'right', total: true },
  { key: 'transaction_status', label: 'Status', format: 'status' },
];

@Component({
  selector: 'app-transactions-report',
  standalone: true,
  imports: [
    CommonModule,
    PageHeaderComponent,
    CardComponent,
    ReportStateComponent,
    ReportExportBarComponent,
    ReportDeltaChipComponent,
    TransactionsStatusBreakdownComponent,
    TransactionsListingComponent,
  ],
  templateUrl: './transactions-report.component.html',
})
export class TransactionsReportComponent implements OnInit, OnDestroy {
  readonly exportColumns = LISTING_COLUMNS;
  readonly fmt = formatUGX;
  /** Whether a comparison is being shown at all — gates the delta chips. Derived from
   *  the shared basis, so "No comparison" hides them exactly as the old boolean toggle
   *  did, and the template's `@let compareOn` line is unchanged. */
  readonly compareEnabled$ = this.timeframe.comparison$.pipe(map((o) => o !== 'none'));

  // Summary (range-aggregate).
  summaryReady = false;
  summaryState: ReportStateMode = 'loading';
  metrics: TxnMetrics = EMPTY_TXN_METRICS;
  prevMetrics: TxnMetrics | null = null;
  breakdown: StatusBreakdown = { buckets: [], settledPct: 0, refundRate: 0 };
  comparisonLabel = '';
  range: ReportDateRange | null = null;

  // Listing.
  listingRows: Record<string, unknown>[] = [];
  listingTotals: Record<string, number> | null = null;
  listingReady = false;
  listingState: ReportStateMode = 'loading';
  listingCapped = false;
  selectedChip: TxnFilterChip = 'all';

  private filter$ = new BehaviorSubject<TxnFilterChip>('all');
  private destroy$ = new Subject<void>();

  constructor(
    private reports: ReportsService,
    private timeframe: TimeframeService,
    private auth: AuthenticationService,
  ) {}

  ngOnInit(): void {
    const restaurantId = this.auth.currentRestaurantRole?.restaurant_id;
    if (!restaurantId) {
      this.summaryState = 'error';
      this.listingState = 'error';
      return;
    }

    // Summary pipeline — chips + breakdown over the FULL range (uncapped). The listing
    // pipeline below carries no comparison; it works off `recentWindow(range)`.
    combineLatest([
      this.timeframe.range$,
      this.timeframe.comparison$,
      this.timeframe.customComparisonFrom$,
      this.reports.refresh$.pipe(startWith(undefined)),
    ])
      .pipe(
        takeUntil(this.destroy$),
        tap(() => {
          this.summaryReady = false;
          this.summaryState = 'loading';
        }),
        switchMap(([range, basis, customFrom]) => {
          // THE COMPARISON WINDOW SPANS THE WINDOW THIS SURFACE'S PRIMARY WAS FETCHED OVER.
          // Here that is the RAW range — `cur$` below requests `range` uncapped (see the
          // pipeline comment above), so the raw range is the correct argument and this already
          // satisfies the invariant. Switching it to `resolveTimeframe(range).effectiveRange`
          // for symmetry with Sales would set a clamped baseline beside an unclamped primary
          // and BREAK it. Sales differs because its primary is fetched over `effectiveRange`.
          const cmp = resolveComparison(range, basis, undefined, customFrom);
          const cur$ = this.reports
            .getTransactionsSummary(restaurantId, range.from, range.to)
            .pipe(catchError(() => of({ data: null } as any)));
          // NO REQUEST when the basis is 'none' — see the Sales pipeline for the why.
          const prev$ = cmp
            ? this.reports
                .getTransactionsSummary(restaurantId, cmp.from, cmp.to)
                .pipe(catchError(() => of({ data: null } as any)))
            : of({ data: null } as any);
          return combineLatest([cur$, prev$]).pipe(
            map(([cur, prev]) => ({ range, basis, cur, prev })),
          );
        }),
      )
      .subscribe(({ range, basis, cur, prev }) => this.applySummary(range, basis, cur, prev));

    // Listing pipeline — recent window, re-fetched on the status-filter chip.
    combineLatest([
      this.timeframe.range$,
      this.reports.refresh$.pipe(startWith(undefined)),
      this.filter$,
    ])
      .pipe(
        takeUntil(this.destroy$),
        tap(() => {
          this.listingReady = false;
          this.listingState = 'loading';
        }),
        switchMap(([range, , chip]) => {
          const win = recentWindow(range);
          this.listingCapped = win.capped;
          this.selectedChip = chip;
          return this.reports
            .getTransactionsListing(restaurantId, win.from, win.to, filterChipParam(chip))
            .pipe(catchError(() => of({ data: null } as any)));
        }),
      )
      .subscribe((res) => this.applyListing(res));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onFilter(chip: TxnFilterChip): void {
    this.filter$.next(chip);
  }

  retry(): void {
    this.reports.refresh$.next();
  }

  private applySummary(
    range: ReportDateRange,
    basis: ComparisonOption,
    cur: any,
    prev: any,
  ): void {
    this.range = range;
    const s: TransactionsSummary | null = cur?.data ?? null;
    if (!s) {
      this.summaryReady = false;
      this.summaryState = 'error';
      return;
    }
    if (s.totalCount === 0) {
      this.metrics = EMPTY_TXN_METRICS;
      this.prevMetrics = null;
      this.breakdown = { buckets: [], settledPct: 0, refundRate: 0 };
      this.summaryReady = false;
      this.summaryState = 'empty';
      return;
    }
    this.metrics = txnSummaryMetrics(s);
    const ps: TransactionsSummary | null = prev?.data ?? null;
    this.prevMetrics = ps ? txnSummaryMetrics(ps) : null;
    this.breakdown = statusBreakdown(s);
    this.comparisonLabel = comparisonCaption(basis);
    this.summaryReady = true;
  }

  private applyListing(res: any): void {
    const rows: TransactionsListingRow[] | null = res?.data ?? null;
    if (!rows) {
      this.listingReady = false;
      this.listingState = 'error';
      return;
    }
    if (rows.length === 0) {
      this.listingRows = [];
      this.listingTotals = null;
      this.listingReady = false;
      this.listingState = 'empty';
      return;
    }
    // Build display rows — PROVISIONAL labels, cash marked self-reported.
    this.listingRows = rows.map((r) => ({
      order_number: r.order_number,
      time_created: r.time_created,
      transaction_type: typeDisplay(r.transaction_type),
      method: methodDisplay(r.payment_mode) + (isCashMode(r.payment_mode) ? ' †' : ''),
      amount: r.amount,
      transaction_status: listingDisplayStatus(r.transaction_type, r.transaction_status),
    }));
    this.listingTotals = sumColumns(this.listingRows, ['amount']);
    this.listingReady = true;
  }
}
