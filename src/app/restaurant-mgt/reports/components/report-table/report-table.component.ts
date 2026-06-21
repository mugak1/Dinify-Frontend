// Generic, report-agnostic data table. Driven entirely by ReportColumn metadata:
// it sorts, formats (text / number / UGX / datetime / status pill), right-aligns
// numerics and renders a column-totals footer. ZERO report-specific logic lives
// here — Sales-specific behaviour (pagination, captions) composes around it.

import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { format as formatDate, parseISO } from 'date-fns';
import { BadgeComponent, BadgeVariant } from '../../../../_shared/ui/badge/badge.component';
import { formatUGX } from '../../../../_shared/utils/price-utils';
import { ReportColumn, ReportColumnFormat } from '../../models/reports.models';

type SortDir = 'asc' | 'desc';

function compareValues(a: any, b: any, fmt: ReportColumnFormat | undefined, dir: number): number {
  if (fmt === 'number' || fmt === 'ugx') {
    return ((Number(a) || 0) - (Number(b) || 0)) * dir;
  }
  if (fmt === 'datetime') {
    return (new Date(a).getTime() - new Date(b).getTime()) * dir;
  }
  return String(a ?? '').localeCompare(String(b ?? '')) * dir;
}

@Component({
  selector: 'app-report-table',
  standalone: true,
  imports: [CommonModule, BadgeComponent],
  template: `
    <div class="overflow-x-auto">
      <table class="w-full text-sm font-sans border-collapse border border-border">
        <thead>
          <tr class="bg-muted text-muted-foreground">
            @for (col of columns; track col.key) {
              <th
                [ngClass]="alignClass(col)"
                class="border border-border px-3 py-2 font-semibold whitespace-nowrap select-none cursor-pointer"
                (click)="onSort(col)"
                scope="col"
              >
                <span class="inline-flex items-center gap-1">
                  {{ col.label }}
                  @if (sortKey === col.key) {
                    <span aria-hidden="true">{{ sortDir === 'asc' ? '▲' : '▼' }}</span>
                  }
                </span>
              </th>
            }
          </tr>
        </thead>

        <tbody>
          @if (sortedRows.length === 0) {
            <tr>
              <td [attr.colspan]="columns.length" class="px-3 py-8 text-center text-muted-foreground">
                {{ emptyLabel }}
              </td>
            </tr>
          } @else {
            @for (row of sortedRows; track $index) {
              <tr [ngClass]="'even:bg-muted/40 hover:bg-muted'">
                @for (col of columns; track col.key) {
                  <td [ngClass]="alignClass(col)" class="border border-border px-3 py-2 whitespace-nowrap">
                    @if (col.format === 'status') {
                      <app-dn-badge [variant]="statusVariant(row[col.key])">{{
                        statusLabel(row[col.key])
                      }}</app-dn-badge>
                    } @else {
                      {{ formatCell(row[col.key], col.format) }}
                    }
                  </td>
                }
              </tr>
            }
          }
        </tbody>

        @if (totals && sortedRows.length > 0) {
          <tfoot>
            <tr class="border-t-2 border-border font-semibold">
              @for (col of columns; track col.key; let i = $index) {
                <td [ngClass]="alignClass(col)" class="border border-border px-3 py-2 whitespace-nowrap">
                  @if (totalCell(col) !== null) {
                    {{ totalCell(col) }}
                  } @else if (i === 0) {
                    Total
                  }
                </td>
              }
            </tr>
          </tfoot>
        }
      </table>
    </div>
  `,
})
export class ReportTableComponent implements OnChanges {
  @Input() columns: ReportColumn[] = [];
  @Input() rows: any[] = [];
  @Input() totals: Record<string, number> | null = null;
  @Input() emptyLabel = 'No rows for this period.';

  sortedRows: any[] = [];
  sortKey: string | null = null;
  sortDir: SortDir = 'asc';

  ngOnChanges(): void {
    this.applySort();
  }

  onSort(col: ReportColumn): void {
    if (this.sortKey === col.key) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = col.key;
      this.sortDir = 'asc';
    }
    this.applySort();
  }

  private applySort(): void {
    const rows = this.rows ?? [];
    if (!this.sortKey) {
      this.sortedRows = [...rows];
      return;
    }
    const key = this.sortKey;
    const fmt = this.columns.find((c) => c.key === key)?.format;
    const dir = this.sortDir === 'asc' ? 1 : -1;
    this.sortedRows = [...rows].sort((a, b) => compareValues(a[key], b[key], fmt, dir));
  }

  alignClass(col: ReportColumn): string {
    const align =
      col.align ?? (col.format === 'number' || col.format === 'ugx' ? 'right' : 'left');
    return align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  }

  formatCell(value: any, fmt: ReportColumnFormat | undefined): string {
    switch (fmt) {
      case 'number':
        return (Number(value) || 0).toLocaleString('en-UG');
      case 'ugx':
        return formatUGX(Number(value) || 0);
      case 'datetime':
        return value ? formatDate(parseISO(String(value)), 'd MMM yyyy, HH:mm') : '';
      default:
        return value == null ? '' : String(value);
    }
  }

  totalCell(col: ReportColumn): string | null {
    if (this.totals && col.total && this.totals[col.key] != null) {
      return this.formatCell(this.totals[col.key], col.format);
    }
    return null;
  }

  statusVariant(value: string): BadgeVariant {
    switch (value) {
      case 'paid':
      case 'success':
        return 'success';
      case 'pending':
        return 'warning';
      case 'failed':
        return 'destructive';
      case 'refunded':
      case 'initiated':
        return 'secondary';
      default:
        return 'outline';
    }
  }

  statusLabel(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
  }
}
