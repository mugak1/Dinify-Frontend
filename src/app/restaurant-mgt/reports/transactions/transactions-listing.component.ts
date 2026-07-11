import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../_shared/ui/card/card.component';
import { ButtonComponent } from '../../../_shared/ui/button/button.component';
import { ReportTableComponent } from '../components/report-table/report-table.component';
import { ReportStateComponent, ReportStateMode } from '../components/report-state/report-state.component';
import { ReportColumn } from '../models/reports.models';
import { TXN_FILTER_CHIPS, TxnFilterChip } from './transactions-view';

const LISTING_COLUMNS: ReportColumn[] = [
  { key: 'order_number', label: 'Txn', format: 'text' },
  { key: 'time_created', label: 'Time', format: 'datetime' },
  { key: 'transaction_type', label: 'Type', format: 'text' },
  { key: 'method', label: 'Method', format: 'text' },
  { key: 'amount', label: 'Amount', format: 'ugx', align: 'right', total: true },
  { key: 'transaction_status', label: 'Status', format: 'status' },
];

const RECENT_N = 8;
const PAGE_SIZE = 50;

/**
 * Recent transactions (a LISTING, not bucketed). Status filter chips drive the
 * fetch (mapped onto the real ?status=); the table shows the recent window, with a
 * "View all" expand to the full paginated list. Method is a COLUMN (data-driven
 * label, not a mix chart); cash cells carry a "†" self-reported marker explained in
 * the footnote. A banner shows when the range is capped to the recent 31 days.
 */
@Component({
  selector: 'app-transactions-listing',
  standalone: true,
  imports: [CommonModule, CardComponent, ButtonComponent, ReportTableComponent, ReportStateComponent],
  template: `
    <app-dn-card class="block">
      <div class="p-4 sm:p-5">
        <div class="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 class="text-card-title text-foreground">Recent transactions</h2>
          <div class="flex gap-1 flex-wrap">
            @for (c of chips; track c.key) {
              <button
                type="button"
                class="px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
                [class]="c.key === selectedChip ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'"
                (click)="filterChange.emit(c.key)"
              >
                {{ c.label }}
              </button>
            }
          </div>
        </div>

        @if (capped) {
          <div class="mb-3 px-3 py-2 rounded-md bg-muted text-xs text-gray-600">
            Showing the most recent 31 days — the per-transaction list is capped at 31 days. The summary
            above covers your full selection.
          </div>
        }

        @if (ready) {
          <app-report-table
            [columns]="columns"
            [rows]="pagedRows"
            [totals]="expanded ? totals : null"
            emptyLabel="No transactions match this filter."
          ></app-report-table>

          <div class="flex items-center justify-between gap-3 mt-3 flex-wrap">
            <p class="text-xs text-gray-400">† Cash is self-reported (operator-marked), not PSP-confirmed.</p>
            @if (!expanded && rows.length > recentN) {
              <button type="button" class="text-xs text-primary hover:underline" (click)="viewAll()">
                View all ({{ rows.length }})
              </button>
            } @else if (expanded && pageCount > 1) {
              <div class="flex items-center gap-3">
                <button app-dn-button variant="outline" size="sm" [disabled]="page === 0" (click)="prevPage()">
                  Previous
                </button>
                <span class="text-sm text-gray-500">Page {{ page + 1 }} of {{ pageCount }}</span>
                <button app-dn-button variant="outline" size="sm" [disabled]="page >= pageCount - 1" (click)="nextPage()">
                  Next
                </button>
              </div>
            }
          </div>
        } @else {
          <app-report-state [mode]="state" (retry)="retry.emit()"></app-report-state>
        }
      </div>
    </app-dn-card>
  `,
})
export class TransactionsListingComponent {
  @Input() rows: any[] = [];
  @Input() totals: Record<string, number> | null = null;
  @Input() ready = false;
  @Input() state: ReportStateMode = 'loading';
  @Input() selectedChip: TxnFilterChip = 'all';
  @Input() capped = false;

  @Output() filterChange = new EventEmitter<TxnFilterChip>();
  @Output() retry = new EventEmitter<void>();

  readonly columns = LISTING_COLUMNS;
  readonly chips = TXN_FILTER_CHIPS;
  readonly recentN = RECENT_N;
  readonly pageSize = PAGE_SIZE;

  expanded = false;
  page = 0;

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.rows.length / this.pageSize));
  }

  get pagedRows(): any[] {
    if (!this.expanded) return this.rows.slice(0, this.recentN);
    const start = this.page * this.pageSize;
    return this.rows.slice(start, start + this.pageSize);
  }

  viewAll(): void {
    this.expanded = true;
    this.page = 0;
  }

  prevPage(): void {
    if (this.page > 0) this.page--;
  }

  nextPage(): void {
    if (this.page < this.pageCount - 1) this.page++;
  }
}
