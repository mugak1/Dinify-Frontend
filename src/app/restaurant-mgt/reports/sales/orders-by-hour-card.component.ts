import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../_shared/ui/card/card.component';
import { HourBar, formatHourLabel, peakLabel } from './sales-view';

/**
 * "When orders land" (hour-of-day cycle). Renders the FE display window (~11a–10p)
 * of the 24-hour series from getSalesHourly as CSS-% column bars, with the busiest
 * hour highlighted + a lunch/dinner caption. Unlike the weekday cycle this never
 * degenerates — for long ranges it shows the average hour-of-day shape — so it
 * always renders. No comparison ghost (deltas live on headline numbers only).
 */
@Component({
  selector: 'app-orders-by-hour-card',
  standalone: true,
  imports: [CommonModule, CardComponent],
  template: `
    <app-dn-card class="block">
      <div class="p-4 sm:p-6">
        <div class="flex items-center justify-between gap-3 mb-3">
          <h2 class="text-card-title text-foreground">When orders land</h2>
          @if (peakHour !== null) {
            <span class="text-xs text-gray-500">{{ caption }}</span>
          }
        </div>

        <div class="flex items-end gap-1 sm:gap-1.5 h-40">
          @for (b of bars; track b.hour) {
            <div class="flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-1" [title]="b.label + ' · ' + b.orders + ' orders'">
              <div
                class="w-full rounded-t transition-all"
                [class]="b.isPeak ? 'bg-success' : 'bg-gray-300'"
                [style.height.%]="b.pct"
              ></div>
            </div>
          }
        </div>

        <div class="flex items-center justify-between mt-1.5 text-[10px] text-gray-400">
          <span>{{ firstLabel }}</span>
          <span>{{ lastLabel }}</span>
        </div>
      </div>
    </app-dn-card>
  `,
})
export class OrdersByHourCardComponent {
  @Input() bars: HourBar[] = [];
  @Input() peakHour: number | null = null;

  get caption(): string {
    if (this.peakHour === null) return '';
    return `${peakLabel(this.peakHour)} · ${formatHourLabel(this.peakHour)}`;
  }
  get firstLabel(): string {
    return this.bars.length ? this.bars[0].label : '';
  }
  get lastLabel(): string {
    return this.bars.length ? this.bars[this.bars.length - 1].label : '';
  }
}
