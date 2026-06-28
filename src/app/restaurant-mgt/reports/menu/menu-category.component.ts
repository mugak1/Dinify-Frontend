import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../_shared/ui/card/card.component';
import {
  TabsComponent,
  TabListComponent,
  TabTriggerComponent,
} from '../../../_shared/ui/tabs/tabs.component';
import { ReportTableComponent } from '../components/report-table/report-table.component';
import { formatUGX } from '../../../_shared/utils/price-utils';
import { MenuGrouping, MenuRow, ReportColumn } from '../models/reports.models';
import { sumColumns } from '../data/reports-mock-data';
import { CategoryBar } from './menu-view';

const ITEM_COLUMNS: ReportColumn[] = [
  { key: 'name', label: 'Item', format: 'text', align: 'left' },
  { key: 'order_count', label: 'Orders', format: 'number', align: 'right', total: true },
  { key: 'quantity_sold', label: 'Qty sold', format: 'number', align: 'right', total: true },
  { key: 'revenue', label: 'Revenue', format: 'ugx', align: 'right', total: true },
];

const GROUPINGS: { value: MenuGrouping; label: string }[] = [
  { value: 'sections', label: 'Sections' },
  { value: 'groups', label: 'Groups' },
  { value: 'items', label: 'Items' },
];

/**
 * Sales by category + the "Full menu" drill, behind one shared grouping toggle.
 *   • sections / groups → CSS-% revenue bars (Reviews precedent).
 *   • items → the complete sortable + searchable item-performance table (report-table)
 *     — this IS the full menu (grouping=items on menu-summary; no listing endpoint).
 */
@Component({
  selector: 'app-menu-category',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    TabsComponent,
    TabListComponent,
    TabTriggerComponent,
    ReportTableComponent,
  ],
  template: `
    <app-dn-card class="block">
      <div class="p-4 sm:p-5">
        <div class="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 class="text-base font-semibold text-gray-900">
            {{ grouping === 'items' ? 'Full menu' : 'Sales by category' }}
          </h2>
          <app-dn-tabs [value]="grouping" (valueChange)="onGrouping($event)">
            <app-dn-tab-list>
              @for (g of groupings; track g.value) {
                <app-dn-tab-trigger [value]="g.value">{{ g.label }}</app-dn-tab-trigger>
              }
            </app-dn-tab-list>
          </app-dn-tabs>
        </div>

        @if (grouping === 'items') {
          <app-report-table
            [columns]="itemColumns"
            [rows]="itemRows"
            [totals]="itemTotals"
            [searchable]="true"
            searchPlaceholder="Find an item…"
            emptyLabel="No items sold in this period."
          ></app-report-table>
        } @else if (bars.length) {
          <div class="space-y-2.5">
            @for (b of bars; track b.name) {
              <div class="flex items-center gap-3">
                <span class="w-24 sm:w-28 shrink-0 text-sm text-gray-700 truncate">{{ b.name }}</span>
                <div class="flex-1 min-w-0 h-3.5 bg-muted rounded-full overflow-hidden">
                  <div class="h-full bg-success/70 rounded-full transition-all" [style.width.%]="b.pct"></div>
                </div>
                <span class="w-28 shrink-0 text-right text-sm tabular-nums text-gray-700">{{ fmt(b.revenue) }}</span>
              </div>
            }
          </div>
        } @else {
          <p class="text-sm text-gray-500 py-6 text-center">No menu activity in this period.</p>
        }
      </div>
    </app-dn-card>
  `,
})
export class MenuCategoryComponent implements OnChanges {
  @Input() grouping: MenuGrouping = 'sections';
  /** Category bars for sections/groups. */
  @Input() bars: CategoryBar[] = [];
  /** Item rows for the grouping=items full-menu table. */
  @Input() itemRows: MenuRow[] = [];
  @Output() groupingChange = new EventEmitter<MenuGrouping>();

  readonly groupings = GROUPINGS;
  readonly itemColumns = ITEM_COLUMNS;
  readonly fmt = formatUGX;
  itemTotals: Record<string, number> | null = null;

  ngOnChanges(): void {
    this.itemTotals = this.itemRows.length
      ? sumColumns(this.itemRows, ['order_count', 'quantity_sold', 'revenue'])
      : null;
  }

  onGrouping(value: string): void {
    this.groupingChange.emit(value as MenuGrouping);
  }
}
