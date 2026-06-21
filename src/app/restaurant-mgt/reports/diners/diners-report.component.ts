// Diners report. A bespoke overview block of mixed-type metrics (identified /
// repeat diners, guest orders, average spend, most-active diner) — always
// loaded, uncapped — followed by an identified-diner listing drill-down
// (client-paginated 50/page) guarded behind a 31-day range cap, mirroring Sales.
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
import { ReportExportBarComponent } from '../components/report-export-bar/report-export-bar.component';
import { ButtonComponent } from '../../../_shared/ui/button/button.component';
import { CardComponent } from '../../../_shared/ui/card/card.component';
import { DinersListingRow, DinersSummary, ReportColumn, ReportDateRange } from '../models/reports.models';
import { sumColumns } from '../data/reports-mock-data';
import { formatUGX } from '../../../_shared/utils/price-utils';

// Omit the internal customer_id from the visible table. average_spend has no
// `total` flag — a sum of per-diner means is meaningless.
const LISTING_COLUMNS: ReportColumn[] = [
  { key: 'name', label: 'Name', format: 'text', align: 'left' },
  { key: 'phone_number', label: 'Phone', format: 'text' },
  { key: 'no_orders', label: 'Orders', format: 'number', align: 'right', total: true },
  { key: 'total_spend', label: 'Total spend', format: 'ugx', align: 'right', total: true },
  { key: 'average_spend', label: 'Avg spend', format: 'ugx', align: 'right' },
  { key: 'last_order_date', label: 'Last order', format: 'datetime' },
];

const LISTING_GUARD_DAYS = 31;
const PAGE_SIZE = 50;

@Component({
  selector: 'app-diners-report',
  standalone: true,
  imports: [
    CommonModule,
    ReportTableComponent,
    ReportStateComponent,
    ReportExportBarComponent,
    ButtonComponent,
    CardComponent,
  ],
  templateUrl: './diners-report.component.html',
})
export class DinersReportComponent implements OnInit, OnDestroy {
  readonly listingColumns = LISTING_COLUMNS;
  readonly pageSize = PAGE_SIZE;

  /** Exposed for the bespoke overview block to format money AOT-safely. */
  readonly formatUGX = formatUGX;

  summary: DinersSummary | null = null;
  summaryReady = false;
  summaryState: ReportStateMode = 'loading';

  listingRows: DinersListingRow[] = [];
  listingTableTotals: Record<string, number> | null = null;
  listingReady = false;
  listingState: ReportStateMode = 'loading';
  listingGuarded = false;

  /** Current range — passed to the export bar for filenames + the print header. */
  range: ReportDateRange | null = null;

  page = 0;

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
          this.page = 0;
        }),
        switchMap(([range]) => {
          this.range = range;
          const days = differenceInCalendarDays(parseISO(range.to), parseISO(range.from));
          this.listingGuarded = days > LISTING_GUARD_DAYS;

          const summary$ = this.reports
            .getDinersSummary(restaurantId, range.from, range.to)
            .pipe(catchError((err) => of({ data: null, error: err } as any)));

          // Skip the listing fetch entirely when guarded.
          const listing$ = this.listingGuarded
            ? of({ data: null } as any)
            : this.reports
                .getDinersListing(restaurantId, range.from, range.to)
                .pipe(catchError((err) => of({ data: null, error: err } as any)));

          return combineLatest([summary$, listing$]).pipe(
            map(([summary, listing]) => ({ summary, listing })),
          );
        }),
      )
      .subscribe(({ summary, listing }) => {
        this.applySummary(summary);
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

  private applySummary(res: any): void {
    const s: DinersSummary | null = res?.data ?? null;
    if (!s) {
      this.summaryReady = false;
      this.summaryState = 'error';
      return;
    }
    this.summary = s;
    // Empty only when there is genuinely nothing — guests-only is still populated.
    if (s.identifiedDiners === 0 && s.guestOrders === 0) {
      this.summaryReady = false;
      this.summaryState = 'empty';
      return;
    }
    this.summaryReady = true;
  }

  private applyListing(res: any): void {
    if (this.listingGuarded) {
      this.listingReady = false;
      this.listingRows = [];
      this.listingTableTotals = null;
      this.listingState = 'listing-guard';
      return;
    }
    const rows: DinersListingRow[] | null = res?.data ?? null;
    if (!rows) {
      this.listingReady = false;
      this.listingState = 'error';
      return;
    }
    this.listingRows = rows;
    if (rows.length) {
      // average_spend deliberately excluded — a sum of per-diner means is meaningless.
      this.listingTableTotals = sumColumns(rows, ['no_orders', 'total_spend']);
      this.listingReady = true;
    } else {
      this.listingTableTotals = null;
      this.listingReady = false;
      this.listingState = 'empty';
    }
  }

  // ── Client-side pagination of the listing ──
  get pageCount(): number {
    return Math.max(1, Math.ceil(this.listingRows.length / this.pageSize));
  }

  get pagedListingRows(): DinersListingRow[] {
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
