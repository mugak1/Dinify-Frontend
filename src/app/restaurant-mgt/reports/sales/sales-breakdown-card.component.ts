import { Component, Input, OnChanges } from '@angular/core';

import { CardComponent } from '../../../_shared/ui/card/card.component';
import { ReportTableComponent } from '../components/report-table/report-table.component';
import { ReportExportBarComponent } from '../components/report-export-bar/report-export-bar.component';
import { ReportColumn, ReportDateRange } from '../models/reports.models';
import { SalesBreakdownRow } from './sales-view';

/**
 * Breakdown table (bucket-driven). Reuses report-table with the bucket-named title,
 * in-table search, sticky totals and the best-bucket row highlight. A net-focus ⇄
 * all-columns toggle controls the columns. The export bar is fed the GRANULAR rows
 * (per-order for ≤31-day ranges, bucket rows otherwise) — the on-screen table rolls
 * up, but the export never does.
 */
@Component({
  selector: 'app-sales-breakdown-card',
  standalone: true,
  imports: [CardComponent, ReportTableComponent, ReportExportBarComponent],
  template: `
    <app-dn-card class="block">
      <div class="p-4 sm:p-6">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
          <h2 class="text-card-title text-foreground">{{ title }}</h2>
          <div class="flex items-center gap-4">
            <button type="button" class="text-xs text-primary hover:underline" (click)="toggleNetFocus()">
              {{ netFocus ? 'Show all columns' : 'Net only' }}
            </button>
            <app-report-export-bar
              [columns]="exportColumns"
              [rows]="exportRows"
              reportTitle="Sales"
              [range]="range"
              [disabled]="exportDisabled"
              [disabledReason]="exportDisabledReason"
            ></app-report-export-bar>
          </div>
        </div>

        <app-report-table
          [columns]="columns"
          [rows]="rows"
          [totals]="totals"
          [searchable]="true"
          searchPlaceholder="Find a bucket…"
          [stickyTotals]="true"
          highlightRowKey="key"
          [highlightRowValue]="bestKey"
          [emptyLabel]="'No sales in this period.'"
        ></app-report-table>
      </div>
    </app-dn-card>
  `,
})
export class SalesBreakdownCardComponent implements OnChanges {
  @Input() title = 'Breakdown';
  /** Header for the bucket column, e.g. 'Hour' / 'Day' / 'Month'. */
  @Input() periodLabel = 'Period';
  @Input() rows: SalesBreakdownRow[] = [];
  @Input() totals: Record<string, number> | null = null;
  @Input() bestKey?: string;

  /** Granular export payload (per-order listing, or bucket rows when guarded). */
  @Input() exportColumns: ReportColumn[] = [];
  @Input() exportRows: unknown[] = [];
  @Input() range: ReportDateRange | null = null;
  @Input() exportDisabled = false;
  @Input() exportDisabledReason = '';

  netFocus = false;
  columns: ReportColumn[] = [];

  ngOnChanges(): void {
    this.rebuildColumns();
  }

  toggleNetFocus(): void {
    this.netFocus = !this.netFocus;
    this.rebuildColumns();
  }

  private rebuildColumns(): void {
    const period: ReportColumn = { key: 'label', label: this.periodLabel, format: 'text', align: 'left' };
    const orders: ReportColumn = { key: 'orders', label: 'Orders', format: 'number', align: 'right', total: true };
    const net: ReportColumn = { key: 'net', label: 'Net', format: 'ugx', align: 'right', total: true };
    this.columns = this.netFocus
      ? [period, orders, net]
      : [
          period,
          orders,
          { key: 'gross', label: 'Gross', format: 'ugx', align: 'right', total: true },
          { key: 'discount', label: 'Discounts', format: 'ugx', align: 'right', total: true },
          net,
        ];
  }
}
