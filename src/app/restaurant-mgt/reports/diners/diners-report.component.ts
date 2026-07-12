// Diners report — the mock-first analytics surface (PR E, the final tab of the redesign).
//
// The honesty-laden tab: it mirrors the backend's separation of IDENTIFIED diners
// (account-holders) from ANONYMOUS guests (the majority, an order count only), with NO
// new-vs-returning and NO member-since. Orchestrator only, ONE pipeline:
//   • full-range summary (+ comparisonRange) → the 4 chips + repeat-vs-one-time;
//   • listing over the recent-31-day window → the leaderboard + identified-order count;
//   • a windowed summary (only when capped) → the split's window-consistent guest_orders.
// The order split is the centrepiece; all maths live in the pure diners-view helpers.

import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, combineLatest, of } from 'rxjs';
import { catchError, map, startWith, switchMap, takeUntil, tap } from 'rxjs/operators';
import { ReportsService } from '../services/reports.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { comparisonRange } from '../utils/reports-timeframe';
import { DinersListingRow, DinersSummary, ReportColumn, ReportDateRange, ReportPreset } from '../models/reports.models';
import { sumColumns } from '../data/reports-mock-data';
import { formatUGX } from '../../../_shared/utils/price-utils';
import {
  OrderSplit,
  RepeatBreakdown,
  orderSplit,
  rankDiners,
  recentWindow,
  repeatBreakdown,
  repeatRate,
  sumIdentifiedOrders,
} from './diners-view';
import { ReportStateComponent, ReportStateMode } from '../components/report-state/report-state.component';
import { ReportExportBarComponent } from '../components/report-export-bar/report-export-bar.component';
import { ReportDeltaChipComponent } from '../components/delta-chip/delta-chip.component';
import { CardComponent } from '../../../_shared/ui/card/card.component';
import { DinersCompositionComponent } from './diners-composition.component';
import { DinersLeaderboardComponent } from './diners-leaderboard.component';
import { PageHeaderComponent } from '../../../_shared/ui/page-header/page-header.component';

const EXPORT_COLUMNS: ReportColumn[] = [
  { key: 'name', label: 'Diner', format: 'text', align: 'left' },
  { key: 'phone_number', label: 'Phone', format: 'text' },
  { key: 'no_orders', label: 'Orders', format: 'number', align: 'right', total: true },
  { key: 'total_spend', label: 'Total spend', format: 'ugx', align: 'right', total: true },
  { key: 'average_spend', label: 'Avg spend', format: 'ugx', align: 'right' },
  { key: 'last_order_date', label: 'Last seen', format: 'datetime' },
];

const COMPARISON_LABELS: Partial<Record<ReportPreset, string>> = {
  today: 'vs yesterday',
  yesterday: 'vs prior day',
  'this-week': 'vs last week',
  'last-week': 'vs prior week',
  'this-month': 'vs last month',
  'last-month': 'vs prior month',
  'this-year': 'vs last year',
};

@Component({
  selector: 'app-diners-report',
  standalone: true,
  imports: [
    CommonModule,
    PageHeaderComponent,
    CardComponent,
    ReportStateComponent,
    ReportExportBarComponent,
    ReportDeltaChipComponent,
    DinersCompositionComponent,
    DinersLeaderboardComponent,
  ],
  templateUrl: './diners-report.component.html',
})
export class DinersReportComponent implements OnInit, OnDestroy {
  readonly exportColumns = EXPORT_COLUMNS;
  readonly fmt = formatUGX;
  readonly rate = repeatRate;
  /** Shared "compare to previous period" toggle — gates the delta chips. */
  readonly compareEnabled$ = this.reports.compareEnabled$;

  // Summary (range-aggregate, full range).
  summaryReady = false;
  summaryState: ReportStateMode = 'loading';
  summary: DinersSummary | null = null;
  prevSummary: DinersSummary | null = null;
  comparisonLabel = '';
  range: ReportDateRange | null = null;

  // Composition.
  split: OrderSplit = { identified: 0, guest: 0, total: 0, identifiedPct: 0, guestPct: 0 };
  repeat: RepeatBreakdown = { repeat: 0, oneTime: 0, identified: 0, repeatPct: 0 };

  // Leaderboard (identified-only, recent window).
  leaderboardRows: DinersListingRow[] = [];
  listingReady = false;
  listingState: ReportStateMode = 'loading';
  listingCapped = false;
  exportTotals: Record<string, number> | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private reports: ReportsService,
    private auth: AuthenticationService,
  ) {}

  ngOnInit(): void {
    const restaurantId = this.auth.currentRestaurantRole?.restaurant_id;
    if (!restaurantId) {
      this.summaryState = 'error';
      this.listingState = 'error';
      return;
    }

    combineLatest([this.reports.dateRange$, this.reports.refresh$.pipe(startWith(undefined))])
      .pipe(
        takeUntil(this.destroy$),
        tap(() => {
          this.summaryReady = false;
          this.listingReady = false;
          this.summaryState = 'loading';
          this.listingState = 'loading';
        }),
        switchMap(([range]) => {
          const win = recentWindow(range);
          const cmp = comparisonRange(range);
          const full$ = this.reports
            .getDinersSummary(restaurantId, range.from, range.to)
            .pipe(catchError(() => of({ data: null } as any)));
          const prev$ = this.reports
            .getDinersSummary(restaurantId, cmp.from, cmp.to)
            .pipe(catchError(() => of({ data: null } as any)));
          const listing$ = this.reports
            .getDinersListing(restaurantId, win.from, win.to)
            .pipe(catchError(() => of({ data: null } as any)));
          // Only when capped do we need a window-consistent guest_orders for the split.
          const winSum$ = win.capped
            ? this.reports.getDinersSummary(restaurantId, win.from, win.to).pipe(catchError(() => of({ data: null } as any)))
            : of(null);

          return combineLatest([full$, prev$, listing$, winSum$]).pipe(
            map(([full, prev, listing, winSum]) => ({ range, win, full, prev, listing, winSum })),
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

  private apply(p: {
    range: ReportDateRange;
    win: { from: string; to: string; capped: boolean };
    full: any;
    prev: any;
    listing: any;
    winSum: any;
  }): void {
    this.range = p.range;

    const s: DinersSummary | null = p.full?.data ?? null;
    if (!s) {
      this.summaryReady = false;
      this.summaryState = 'error';
      this.listingReady = false;
      this.listingState = 'error';
      return;
    }
    // Empty only when there is genuinely nothing — guests-only is still populated.
    if (s.identifiedDiners === 0 && s.guestOrders === 0) {
      this.summaryReady = false;
      this.summaryState = 'empty';
      return;
    }

    this.summary = s;
    this.prevSummary = p.prev?.data ?? null;
    this.comparisonLabel = COMPARISON_LABELS[p.range.preset] ?? 'vs prior period';
    this.repeat = repeatBreakdown(s);

    // Leaderboard + export (identified, recent window).
    this.listingCapped = p.win.capped;
    const rows: DinersListingRow[] | null = p.listing?.data ?? null;
    if (!rows) {
      this.listingReady = false;
      this.listingState = 'error';
      this.leaderboardRows = [];
    } else if (rows.length === 0) {
      this.leaderboardRows = [];
      this.exportTotals = null;
      this.listingReady = false;
      this.listingState = 'empty';
    } else {
      this.leaderboardRows = rankDiners(rows);
      this.exportTotals = sumColumns(this.leaderboardRows, ['no_orders', 'total_spend']);
      this.listingReady = true;
    }

    // Order-level split — windowed guest_orders so both sides share a window.
    const identifiedOrders = sumIdentifiedOrders(rows ?? []);
    const guestOrders = p.win.capped ? (p.winSum?.data?.guestOrders ?? 0) : s.guestOrders;
    this.split = orderSplit(identifiedOrders, guestOrders);

    this.summaryReady = true;
  }
}
