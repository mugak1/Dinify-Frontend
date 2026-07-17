import { Component, Input } from '@angular/core';

import { CardComponent } from '../../../_shared/ui/card/card.component';
import { ReportDeltaChipComponent } from '../components/delta-chip/delta-chip.component';

/**
 * One metric chip for the Menu rail. Two modes:
 *   • range-aggregate — pass `current` (+ `previous`) → a delta-chip vs the comparison
 *     window appears (Items sold / Menu revenue / Avg item price).
 *   • point-in-time — omit `current`, pass `subtext` + `caption` ("as of now") → NO
 *     delta-chip and the value never reacts to the timeframe (Active items).
 */
@Component({
  selector: 'app-menu-stat-card',
  standalone: true,
  imports: [CardComponent, ReportDeltaChipComponent],
  template: `
    <app-dn-card class="block">
      <div class="p-4">
        <div class="flex items-center justify-between gap-2">
          <p class="text-sm text-gray-500">{{ label }}</p>
          @if (current != null) {
            <app-report-delta-chip
              [current]="current"
              [previous]="previous"
              [invert]="invert"
              [label]="comparisonLabel"
              [compareEnabled]="compareEnabled"
            ></app-report-delta-chip>
          }
        </div>
        <p class="text-xl sm:text-2xl font-semibold text-gray-900 tabular-nums mt-1">{{ value }}</p>
        @if (subtext) {
          <p class="text-sm text-gray-500 mt-0.5">{{ subtext }}</p>
        }
        @if (caption) {
          <p class="text-xs text-gray-400 mt-1">{{ caption }}</p>
        }
      </div>
    </app-dn-card>
  `,
})
export class MenuStatCardComponent {
  @Input() label = '';
  @Input() value = '';
  /** Omit (null) for a point-in-time chip → no delta-chip. */
  @Input() current: number | null = null;
  @Input() previous = 0;
  @Input() invert = false;
  @Input() comparisonLabel = '';
  /** Forwarded to the delta chip — false hides it (shell "Compare" toggle off). */
  @Input() compareEnabled = true;
  @Input() subtext = '';
  @Input() caption = '';
}
