import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../_shared/ui/card/card.component';
import { DnSegmentedComponent, DnSegItem } from '../../../_shared/ui/segmented/segmented.component';
import { formatUGX } from '../../../_shared/utils/price-utils';
import { MenuRow } from '../models/reports.models';
import { MenuMetric, RankedItem, rankItems } from './menu-view';

const TOP_N = 6;

/**
 * Top selling items (range-aggregate). A ranked list with a units⇄revenue toggle
 * (dashboard Popular Items precedent): rank · inline bar · item · metric · %-of-total.
 * A "Full menu" button asks the parent to switch the grouping to items (revealing the
 * complete sortable item table). No per-item compare — that's deferred.
 */
@Component({
  selector: 'app-menu-top-items',
  standalone: true,
  imports: [CommonModule, CardComponent, DnSegmentedComponent],
  template: `
    <app-dn-card class="block">
      <div class="p-4 sm:p-5">
        <div class="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h2 class="text-card-title text-foreground">Top selling items</h2>
          <app-dn-segmented
            [items]="metricItems"
            [value]="by"
            (valueChange)="setBy($event)"
            ariaLabel="Rank top items by"
          ></app-dn-segmented>
        </div>

        @if (displayItems.length) {
          <ol class="space-y-2.5">
            @for (item of displayItems; track item.name; let i = $index) {
              <li class="flex items-center gap-3">
                <span class="w-5 shrink-0 text-sm font-medium text-gray-400 tabular-nums">{{ i + 1 }}</span>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm font-medium text-gray-900 truncate">{{ item.name }}</span>
                    <span class="text-sm font-semibold text-gray-900 tabular-nums shrink-0">{{ metricLabel(item) }}</span>
                  </div>
                  <div class="mt-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div class="h-full bg-success/70 rounded-full transition-all" [style.width.%]="barWidth(item)"></div>
                  </div>
                </div>
                <span class="w-12 shrink-0 text-right text-xs text-gray-500 tabular-nums">{{ item.pct | number: '1.0-1' }}%</span>
              </li>
            }
          </ol>
          <button
            type="button"
            class="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-3"
            (click)="fullMenu.emit()"
          >
            Full menu
            <svg aria-hidden="true" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </button>
        } @else {
          <p class="text-sm text-gray-500 py-6 text-center">No items sold in this period.</p>
        }
      </div>
    </app-dn-card>
  `,
})
export class MenuTopItemsComponent implements OnChanges {
  @Input() items: MenuRow[] = [];
  @Output() fullMenu = new EventEmitter<void>();

  by: MenuMetric = 'revenue';
  displayItems: RankedItem[] = [];
  private maxValue = 0;

  readonly metricItems: DnSegItem[] = [
    { value: 'revenue', label: 'By revenue' },
    { value: 'units', label: 'By units' },
  ];

  ngOnChanges(): void {
    this.recompute();
  }

  // Widened to string so the segmented control's (valueChange) binds directly
  // under strictTemplates; values come from metricItems so the cast is safe.
  setBy(by: string): void {
    this.by = by as MenuMetric;
    this.recompute();
  }

  metricLabel(item: RankedItem): string {
    return this.by === 'revenue' ? formatUGX(item.revenue) : `${item.units.toLocaleString('en-UG')} sold`;
  }

  barWidth(item: RankedItem): number {
    return this.maxValue > 0 ? Math.round((item.value / this.maxValue) * 100) : 0;
  }

  private recompute(): void {
    this.displayItems = rankItems(this.items ?? [], this.by, TOP_N);
    this.maxValue = this.displayItems[0]?.value ?? 0;
  }
}
