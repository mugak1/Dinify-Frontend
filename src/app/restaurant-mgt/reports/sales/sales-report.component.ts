// Sales report. Composes the generic report-table twice:
//   1. a lead AGGREGATE summary (granularity auto-derived from the range), and
//   2. a per-order LISTING drill-down (client-paginated 50/page, with a totals
//      footer), suppressed behind a guard when the range exceeds 31 days.
// State + data come from ReportsService (mock-first). No charts, no KPI tiles.

import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, combineLatest, of } from 'rxjs';
import { catchError, map, startWith, switchMap, takeUntil, tap } from 'rxjs/operators';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { ReportsService } from '../services/reports.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { ReportTableComponent } from '../components/report-table/report-table.component';
import { ReportStateComponent, ReportStateMode } from '../components/report-state/report-state.component';
import { ButtonComponent } from '../../../_shared/ui/button/button.component';
import { CardComponent } from '../../../_shared/ui/card/card.component';
import {
  ReportColumn,
  ReportGranularity,
  SalesAggregateRow,
  SalesListingRow,
  SalesListingTotals,
} from '../models/reports.models';
import { sumAggregate, sumListing } from '../data/reports-mock-data';

const SALES_AGGREGATE_COLUMNS: ReportColumn[] = [
  { key: 'period', label: 'Period', format: 'text', align: 'left' },
  { key: 'orders', label: 'Orders', format: 'number', align: 'right', total: true },
  { key: 'revenue', label: 'Revenue', format: 'ugx', align: 'right', total: true },
  { key: 'discount', label: 'Discounts', format: 'ugx', align: 'right', total: true },
];

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

/** Daily aggregate + per-order listing are available up to this many days; beyond it the listing is guarded. */
const LISTING_GUARD_DAYS = 31;
const PAGE_SIZE = 50;

@Component({
  selector: 'app-sales-report',
  standalone: true,
  imports: [CommonModule, ReportTableComponent, ReportStateComponent, ButtonComponent, CardComponent],
  templateUrl: './sales-report.component.html',
})
export class SalesReportComponent implements OnInit, OnDestroy {
  readonly aggregateColumns = SALES_AGGREGATE_COLUMNS;
  readonly listingColumns = SALES_LISTING_COLUMNS;
  readonly pageSize = PAGE_SIZE;

  aggRows: SalesAggregateRow[] = [];
  aggTotals: Record<string, number> | null = null;
  aggReady = false;
  aggState: ReportStateMode = 'loading';

  listingRows: SalesListingRow[] = [];
  listingTableTotals: Record<string, number> | null = null;
  listingTotals: SalesListingTotals | null = null;
  listingReady = false;
  listingState: ReportStateMode = 'loading';
  listingGuarded = false;

  page = 0;

  private destroy$ = new Subject<void>();

  constructor(
    private reports: ReportsService,
    private auth: AuthenticationService,
  ) {}

  ngOnInit(): void {
    const restaurantId = this.auth.currentRestaurantRole?.restaurant_id;
    if (!restaurantId) {
      this.aggState = 'error';
      this.listingState = 'error';
      return;
    }

    combineLatest([this.reports.dateRange$, this.reports.refresh$.pipe(startWith(undefined))])
      .pipe(
        takeUntil(this.destroy$),
        tap(() => {
          this.aggReady = false;
          this.listingReady = false;
          this.aggState = 'loading';
          this.listingState = 'loading';
          this.page = 0;
        }),
        switchMap(([range]) => {
          const days = differenceInCalendarDays(parseISO(range.to), parseISO(range.from));
          const granularity: ReportGranularity = days <= LISTING_GUARD_DAYS ? 'daily' : 'monthly';
          this.listingGuarded = days > LISTING_GUARD_DAYS;

          const agg$ = this.reports
            .getSalesAggregate(restaurantId, range.from, range.to, granularity)
            .pipe(catchError((err) => of({ data: null, error: err } as any)));

          // Skip the (potentially huge) listing fetch entirely when guarded.
          const listing$ = this.listingGuarded
            ? of({ data: null } as any)
            : this.reports
                .getSalesListing(restaurantId, range.from, range.to)
                .pipe(catchError((err) => of({ data: null, error: err } as any)));

          return combineLatest([agg$, listing$]).pipe(map(([agg, listing]) => ({ agg, listing })));
        }),
      )
      .subscribe(({ agg, listing }) => {
        this.applyAggregate(agg);
        this.applyListing(listing);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  retry(): void {
    this.reports.refresh$.next();
  }

  private applyAggregate(res: any): void {
    const rows: SalesAggregateRow[] | null = res?.data ?? null;
    if (!rows) {
      this.aggReady = false;
      this.aggState = 'error';
      return;
    }
    this.aggRows = rows;
    if (rows.length) {
      this.aggTotals = sumAggregate(rows);
      this.aggReady = true;
    } else {
      this.aggTotals = null;
      this.aggReady = false;
      this.aggState = 'empty';
    }
  }

  private applyListing(res: any): void {
    if (this.listingGuarded) {
      this.listingReady = false;
      this.listingRows = [];
      this.listingTotals = null;
      this.listingTableTotals = null;
      this.listingState = 'listing-guard';
      return;
    }
    const rows: SalesListingRow[] | null = res?.data ?? null;
    if (!rows) {
      this.listingReady = false;
      this.listingState = 'error';
      return;
    }
    this.listingRows = rows;
    if (rows.length) {
      const t = sumListing(rows);
      const items = rows.reduce((acc, r) => acc + r.item_count, 0);
      this.listingTotals = t;
      // Totals are over the WHOLE range, never the current page.
      this.listingTableTotals = {
        item_count: items,
        gross: t.gross,
        discount: t.discount,
        revenue: t.revenue,
      };
      this.listingReady = true;
    } else {
      this.listingTotals = null;
      this.listingTableTotals = null;
      this.listingReady = false;
      this.listingState = 'empty';
    }
  }

  // ── Client-side pagination of the listing ──
  get pageCount(): number {
    return Math.max(1, Math.ceil(this.listingRows.length / this.pageSize));
  }

  get pagedListingRows(): SalesListingRow[] {
    const start = this.page * this.pageSize;
    return this.listingRows.slice(start, start + this.pageSize);
  }

  prevPage(): void {
    if (this.page > 0) this.page--;
  }

  nextPage(): void {
    if (this.page < this.pageCount - 1) this.page++;
  }
}
