import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../_shared/ui/card/card.component';
import { formatUGX } from '../../../_shared/utils/price-utils';
import { WeekdayRevenue } from './sales-view';

/**
 * Revenue by weekday (CYCLE). Aggregates revenue by day-of-week across the range
 * — only meaningful over ≈2+ weeks of daily data, so the PARENT omits this card
 * for short and long ranges (see weekdayEligible). CSS-% bars, best weekday
 * highlighted. No comparison ghost (deltas live on the headline numbers only).
 */
@Component({
  selector: 'app-revenue-weekday-card',
  standalone: true,
  imports: [CommonModule, CardComponent],
  template: `
    <app-dn-card class="block">
      <div class="p-4 sm:p-5">
        <h2 class="text-card-title text-foreground mb-3">Revenue by weekday</h2>
        <div class="space-y-2">
          @for (d of days; track d.weekday) {
            <div class="flex items-center gap-3">
              <span
                class="w-10 shrink-0 text-sm"
                [class]="d.weekday === bestWeekday ? 'font-semibold text-gray-900' : 'text-gray-500'"
                >{{ d.label }}</span
              >
              <div class="flex-1 min-w-0 h-3.5 bg-muted rounded-full overflow-hidden">
                <div
                  class="h-full rounded-full transition-all"
                  [class]="d.weekday === bestWeekday ? 'bg-success' : 'bg-gray-300'"
                  [style.width.%]="width(d.revenue)"
                ></div>
              </div>
              <span class="w-28 shrink-0 text-right text-sm tabular-nums text-gray-700">{{ fmt(d.revenue) }}</span>
            </div>
          }
        </div>
      </div>
    </app-dn-card>
  `,
})
export class RevenueWeekdayCardComponent {
  @Input() days: WeekdayRevenue[] = [];
  @Input() bestWeekday: number | null = null;

  readonly fmt = formatUGX;

  private get max(): number {
    return this.days.reduce((m, d) => Math.max(m, d.revenue), 0);
  }

  width(revenue: number): number {
    return this.max > 0 ? Math.round((revenue / this.max) * 100) : 0;
  }
}
