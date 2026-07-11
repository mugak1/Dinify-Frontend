import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../_shared/ui/card/card.component';
import { ButtonComponent } from '../../../_shared/ui/button/button.component';
import { AvatarComponent } from '../../../_shared/ui/avatar/avatar.component';
import { ReportTableComponent } from '../components/report-table/report-table.component';
import { ReportStateComponent, ReportStateMode } from '../components/report-state/report-state.component';
import { DinersListingRow, ReportColumn } from '../models/reports.models';
import { formatUGX } from '../../../_shared/utils/price-utils';
import { dinerName } from './diners-view';

const TABLE_COLUMNS: ReportColumn[] = [
  { key: 'diner', label: 'Diner', format: 'text', align: 'left' },
  { key: 'no_orders', label: 'Orders', format: 'number', align: 'right', total: true },
  { key: 'total_spend', label: 'Total spend', format: 'ugx', align: 'right', total: true },
  { key: 'average_spend', label: 'Avg spend', format: 'ugx', align: 'right' },
  { key: 'last_order_date', label: 'Last seen', format: 'datetime' },
];

const RECENT_N = 5;
const PAGE_SIZE = 50;

/**
 * Top diners leaderboard — IDENTIFIED-only by design (privacy: anonymous diners are never
 * individually profiled). Ranked by spend, with initials (app-dn-avatar), the name (phone
 * fallback, mirroring the backend _diner_name) and "last seen" (last_order_date — NEVER
 * "member since", which is not a backend field). "View all" expands to the full sortable +
 * searchable list; a banner shows when the range is capped to the recent 31 days.
 */
@Component({
  selector: 'app-diners-leaderboard',
  standalone: true,
  imports: [CommonModule, CardComponent, ButtonComponent, AvatarComponent, ReportTableComponent, ReportStateComponent],
  template: `
    <app-dn-card class="block">
      <div class="p-4 sm:p-5">
        <div class="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 class="text-card-title text-foreground">Top diners</h2>
          <span class="text-xs text-gray-400">identified only</span>
        </div>

        @if (capped) {
          <div class="mb-3 px-3 py-2 rounded-md bg-muted text-xs text-gray-600">
            Showing the most recent 31 days — the diner list is capped at 31 days. The chips above cover
            your full selection.
          </div>
        }

        @if (ready) {
          @if (!expanded) {
            <ol class="space-y-2.5">
              @for (d of topRows; track d.customer_id; let i = $index) {
                <li class="flex items-center gap-3">
                  <span class="w-5 shrink-0 text-sm font-medium text-gray-400 tabular-nums">{{ i + 1 }}</span>
                  <app-dn-avatar [name]="d.name" size="sm"></app-dn-avatar>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-gray-900 truncate">{{ name(d) }}</p>
                    <p class="text-xs text-gray-400">
                      {{ d.no_orders | number }} orders · last seen {{ d.last_order_date | date: 'd MMM' }}
                    </p>
                  </div>
                  <span class="shrink-0 text-sm font-semibold text-gray-900 tabular-nums">{{ fmt(d.total_spend) }}</span>
                </li>
              }
            </ol>
            @if (rows.length > recentN) {
              <button type="button" class="text-xs text-primary hover:underline mt-3" (click)="viewAll()">
                View all ({{ rows.length }})
              </button>
            }
          } @else {
            <app-report-table
              [columns]="columns"
              [rows]="pagedRows"
              [totals]="totals"
              [searchable]="true"
              searchPlaceholder="Find a diner…"
              emptyLabel="No identified diners."
            ></app-report-table>
            @if (pageCount > 1) {
              <div class="flex items-center justify-end gap-3 mt-3">
                <button app-dn-button variant="outline" size="sm" [disabled]="page === 0" (click)="prevPage()">
                  Previous
                </button>
                <span class="text-sm text-gray-500">Page {{ page + 1 }} of {{ pageCount }}</span>
                <button app-dn-button variant="outline" size="sm" [disabled]="page >= pageCount - 1" (click)="nextPage()">
                  Next
                </button>
              </div>
            }
          }
        } @else {
          <app-report-state
            [mode]="state"
            title="No identified diners"
            message="No account-holders ordered in the dates you selected."
            (retry)="retry.emit()"
          ></app-report-state>
        }
      </div>
    </app-dn-card>
  `,
})
export class DinersLeaderboardComponent implements OnChanges {
  /** Already ranked by spend (desc). */
  @Input() rows: DinersListingRow[] = [];
  @Input() ready = false;
  @Input() state: ReportStateMode = 'loading';
  @Input() capped = false;
  @Output() retry = new EventEmitter<void>();

  readonly columns = TABLE_COLUMNS;
  readonly recentN = RECENT_N;
  readonly pageSize = PAGE_SIZE;
  readonly fmt = formatUGX;
  readonly name = dinerName;

  expanded = false;
  page = 0;
  tableRows: Record<string, unknown>[] = [];
  totals: Record<string, number> | null = null;

  ngOnChanges(): void {
    this.tableRows = this.rows.map((r) => ({
      diner: dinerName(r),
      no_orders: r.no_orders,
      total_spend: r.total_spend,
      average_spend: r.average_spend,
      last_order_date: r.last_order_date,
    }));
    this.totals = this.rows.length
      ? {
          no_orders: this.rows.reduce((a, r) => a + r.no_orders, 0),
          total_spend: this.rows.reduce((a, r) => a + r.total_spend, 0),
        }
      : null;
    this.expanded = false;
    this.page = 0;
  }

  get topRows(): DinersListingRow[] {
    return this.rows.slice(0, this.recentN);
  }
  get pageCount(): number {
    return Math.max(1, Math.ceil(this.tableRows.length / this.pageSize));
  }
  get pagedRows(): Record<string, unknown>[] {
    const start = this.page * this.pageSize;
    return this.tableRows.slice(start, start + this.pageSize);
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
