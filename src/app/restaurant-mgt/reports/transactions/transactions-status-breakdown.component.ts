import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../_shared/ui/card/card.component';
import { formatUGX } from '../../../_shared/utils/price-utils';
import { DisplayTone, StatusBreakdown } from './transactions-view';

/**
 * Status breakdown (range-aggregate, categorical) — the Transactions tab's own
 * value-add (NOT on the dashboard). Paid / Refunded / Pending with counts + values,
 * ZERO-FILLED onto the fixed axis (so an empty status shows 0, not missing), plus a
 * "% settled cleanly / refund rate" footer. CSS-% bars (Reviews precedent). Refunded
 * is mock-only until the payment integration (Gate 2) — marked with a footnote.
 */
@Component({
  selector: 'app-transactions-status-breakdown',
  standalone: true,
  imports: [CommonModule, CardComponent],
  template: `
    <app-dn-card class="block">
      <div class="p-4 sm:p-5">
        <h2 class="text-base font-semibold text-gray-900 mb-3">Status breakdown</h2>
        <div class="space-y-2.5">
          @for (b of breakdown.buckets; track b.key) {
            <div class="flex items-center gap-3">
              <span class="w-24 shrink-0 text-sm text-gray-700">
                {{ b.label }}@if (b.mockOnly) {<span class="text-gray-400">*</span>}
              </span>
              <div class="flex-1 min-w-0 h-3.5 bg-muted rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all" [class]="barClass(b.tone)" [style.width.%]="b.pct"></div>
              </div>
              <span class="w-10 shrink-0 text-right text-sm tabular-nums text-gray-500">{{ b.count }}</span>
              <span class="w-28 shrink-0 text-right text-sm tabular-nums text-gray-700">{{ fmt(b.amount) }}</span>
            </div>
          }
        </div>

        <div class="mt-4 pt-3 border-t border-border flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span class="text-gray-500"
            >Settled cleanly
            <span class="font-semibold text-gray-900 tabular-nums">{{ breakdown.settledPct | number: '1.0-1' }}%</span></span
          >
          <span class="text-gray-500"
            >Refund rate
            <span class="font-semibold text-gray-900 tabular-nums">{{ breakdown.refundRate | number: '1.0-1' }}%</span></span
          >
        </div>

        @if (hasMockOnly) {
          <p class="mt-2 text-xs text-gray-400">
            * Refunds aren't tracked yet — shown on mock until the payment integration.
          </p>
        }
      </div>
    </app-dn-card>
  `,
})
export class TransactionsStatusBreakdownComponent {
  @Input() breakdown: StatusBreakdown = { buckets: [], settledPct: 0, refundRate: 0 };

  readonly fmt = formatUGX;

  get hasMockOnly(): boolean {
    return this.breakdown.buckets.some((b) => b.mockOnly);
  }

  barClass(tone: DisplayTone): string {
    return tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : 'bg-gray-400';
  }
}
