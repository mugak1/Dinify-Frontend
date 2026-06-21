// Transactions report. A lead summary of two breakdown tables (by status, by
// type) plus a transaction count — always loaded, uncapped — followed by a
// per-transaction listing drill-down (client-paginated 50/page) guarded behind a
// 31-day range cap, mirroring Sales. State + data come from ReportsService
// (mock-first). No charts, no KPI tiles.

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
  TransactionType,
  TransactionsListingRow,
  TransactionsSummary,
} from '../models/reports.models';
import { sumColumns } from '../data/reports-mock-data';

// Neutral, non-custodial labels. Dinify does not disburse, so there is no
// "Disbursement" — the TransactionType union has no such member.
const TXN_TYPE_LABEL: Record<TransactionType, string> = {
  payment: 'Payment',
  refund: 'Refund',
  charge: 'Charge',
  subscription: 'Subscription',
};

const BY_STATUS_COLUMNS: ReportColumn[] = [
  { key: 'status', label: 'Status', format: 'status', align: 'left' },
  { key: 'count', label: 'Count', format: 'number', align: 'right', total: true },
  { key: 'amount', label: 'Amount', format: 'ugx', align: 'right', total: true },
];

const BY_TYPE_COLUMNS: ReportColumn[] = [
  { key: 'type', label: 'Type', format: 'text', align: 'left' },
  { key: 'count', label: 'Count', format: 'number', align: 'right', total: true },
  { key: 'amount', label: 'Amount', format: 'ugx', align: 'right', total: true },
];

// Omit the internal id from the visible table.
const LISTING_COLUMNS: ReportColumn[] = [
  { key: 'order_number', label: 'Order', format: 'text' },
  { key: 'time_created', label: 'Time', format: 'datetime' },
  { key: 'transaction_type', label: 'Type', format: 'text' },
  { key: 'transaction_status', label: 'Status', format: 'status' },
  { key: 'amount', label: 'Amount', format: 'ugx', align: 'right', total: true },
  { key: 'payment_mode', label: 'Method', format: 'text' },
  { key: 'transaction_platform', label: 'Platform', format: 'text' },
];

const LISTING_GUARD_DAYS = 31;
const PAGE_SIZE = 50;

/** Display row: transaction_type pre-mapped to its neutral label for the table. */
interface TxnDisplayRow extends Omit<TransactionsListingRow, 'transaction_type'> {
  transaction_type: string;
}

@Component({
  selector: 'app-transactions-report',
  standalone: true,
  imports: [CommonModule, ReportTableComponent, ReportStateComponent, ButtonComponent, CardComponent],
  templateUrl: './transactions-report.component.html',
})
export class TransactionsReportComponent implements OnInit, OnDestroy {
  readonly byStatusColumns = BY_STATUS_COLUMNS;
  readonly byTypeColumns = BY_TYPE_COLUMNS;
  readonly listingColumns = LISTING_COLUMNS;
  readonly pageSize = PAGE_SIZE;

  summary: TransactionsSummary | null = null;
  byStatusTotals: Record<string, number> | null = null;
  byTypeTotals: Record<string, number> | null = null;
  summaryReady = false;
  summaryState: ReportStateMode = 'loading';

  listingRows: TxnDisplayRow[] = [];
  listingTableTotals: Record<string, number> | null = null;
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
          const days = differenceInCalendarDays(parseISO(range.to), parseISO(range.from));
          this.listingGuarded = days > LISTING_GUARD_DAYS;

          const summary$ = this.reports
            .getTransactionsSummary(restaurantId, range.from, range.to)
            .pipe(catchError((err) => of({ data: null, error: err } as any)));

          // Skip the (potentially large) listing fetch entirely when guarded.
          const listing$ = this.listingGuarded
            ? of({ data: null } as any)
            : this.reports
                .getTransactionsListing(restaurantId, range.from, range.to)
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
    const s: TransactionsSummary | null = res?.data ?? null;
    if (!s) {
      this.summaryReady = false;
      this.summaryState = 'error';
      return;
    }
    this.summary = s;
    if (s.totalCount === 0 || (s.byStatus.length === 0 && s.byType.length === 0)) {
      this.byStatusTotals = null;
      this.byTypeTotals = null;
      this.summaryReady = false;
      this.summaryState = 'empty';
      return;
    }
    this.byStatusTotals = sumColumns(s.byStatus, ['count', 'amount']);
    this.byTypeTotals = sumColumns(s.byType, ['count', 'amount']);
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
    const rows: TransactionsListingRow[] | null = res?.data ?? null;
    if (!rows) {
      this.listingReady = false;
      this.listingState = 'error';
      return;
    }
    // Pre-map type → neutral label (the generic table renders row[col.key] verbatim).
    this.listingRows = rows.map((r) => ({
      ...r,
      transaction_type: TXN_TYPE_LABEL[r.transaction_type] ?? 'Payment',
    }));
    if (this.listingRows.length) {
      // Totals are over the WHOLE range, never the current page.
      this.listingTableTotals = sumColumns(this.listingRows, ['amount']);
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

  get pagedListingRows(): TxnDisplayRow[] {
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
