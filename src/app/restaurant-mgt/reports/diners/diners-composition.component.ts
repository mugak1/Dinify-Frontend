import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../_shared/ui/card/card.component';
import { OrderSplit, RepeatBreakdown } from './diners-view';

/**
 * Diner composition — the tab's defining honesty element (the mock omits it).
 *   • Identified-vs-anonymous ORDER split (PROMINENT): both sides are order counts, so the
 *     units are consistent — anonymous QR diners are the majority and can't be individually
 *     attributed. (Windowed to the recent 31 days for long ranges; chips stay full-range.)
 *   • Repeat-vs-one-time WITHIN the identified subset — labelled "repeat vs one-time", NEVER
 *     "new vs returning" (no first-ever-seen logic exists).
 */
@Component({
  selector: 'app-diners-composition',
  standalone: true,
  imports: [CommonModule, CardComponent],
  template: `
    <app-dn-card class="block">
      <div class="p-4 sm:p-5">
        <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <h2 class="text-base font-semibold text-gray-900">Identified vs anonymous orders</h2>
          @if (capped) {
            <span class="text-xs text-gray-400">most recent 31 days</span>
          }
        </div>

        @if (split.total > 0) {
          <div class="flex h-4 rounded-full overflow-hidden bg-muted">
            <div class="bg-success h-full" [style.width.%]="split.identifiedPct"></div>
            <div class="bg-gray-400 h-full" [style.width.%]="split.guestPct"></div>
          </div>
          <div class="flex items-center justify-between gap-3 mt-2 text-sm flex-wrap">
            <span class="inline-flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-success"></span>
              <span class="text-gray-700">Identified</span>
              <span class="font-semibold text-gray-900 tabular-nums">{{ split.identified | number }} orders</span>
              <span class="text-gray-400 tabular-nums">{{ split.identifiedPct | number: '1.0-0' }}%</span>
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-gray-400"></span>
              <span class="text-gray-700">Anonymous</span>
              <span class="font-semibold text-gray-900 tabular-nums">{{ split.guest | number }} orders</span>
              <span class="text-gray-400 tabular-nums">{{ split.guestPct | number: '1.0-0' }}%</span>
            </span>
          </div>
        } @else {
          <p class="text-sm text-gray-500 py-4 text-center">No orders in this period.</p>
        }

        <p class="text-xs text-gray-400 mt-2">
          Most diners order anonymously via QR and can't be individually attributed — only
          account-holders appear in the metrics and leaderboard.
        </p>

        <div class="mt-5 pt-4 border-t border-border">
          <h3 class="text-sm font-semibold text-gray-900 mb-2">
            Repeat vs one-time <span class="font-normal text-gray-400">(identified)</span>
          </h3>
          @if (repeat.identified > 0) {
            <div class="flex h-3 rounded-full overflow-hidden bg-muted">
              <div class="bg-success h-full" [style.width.%]="repeat.repeatPct"></div>
              <div class="bg-secondary h-full" [style.width.%]="100 - repeat.repeatPct"></div>
            </div>
            <div class="flex items-center justify-between gap-3 mt-2 text-sm">
              <span class="text-gray-700">Repeat <span class="font-semibold tabular-nums">{{ repeat.repeat }}</span></span>
              <span class="text-gray-700">One-time <span class="font-semibold tabular-nums">{{ repeat.oneTime }}</span></span>
            </div>
          } @else {
            <p class="text-sm text-gray-500">No identified diners in this period.</p>
          }
        </div>
      </div>
    </app-dn-card>
  `,
})
export class DinersCompositionComponent {
  @Input() split: OrderSplit = { identified: 0, guest: 0, total: 0, identifiedPct: 0, guestPct: 0 };
  @Input() repeat: RepeatBreakdown = { repeat: 0, oneTime: 0, identified: 0, repeatPct: 0 };
  @Input() capped = false;
}
