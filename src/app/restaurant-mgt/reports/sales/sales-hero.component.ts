import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../_shared/ui/card/card.component';
import { formatUGX } from '../../../_shared/utils/price-utils';
import { ReportDeltaChipComponent } from '../components/delta-chip/delta-chip.component';
import { EMPTY_TOTALS, SalesTotals } from './sales-view';

/**
 * Hero + ledger (range-aggregate). Net-revenue headline with a delta chip, over a
 * Gross → Discounts → Refunds → Net ledger that reconciles. Refunds is a mock
 * placeholder until payment integration — the caption flags that it will become
 * "on-platform refunds only". Pure presentational: the parent computes the totals.
 */
@Component({
  selector: 'app-sales-hero',
  standalone: true,
  imports: [CommonModule, CardComponent, ReportDeltaChipComponent],
  template: `
    <app-dn-card class="block">
      <div class="p-4 sm:p-6">
        <p class="text-sm text-gray-500">Net revenue</p>
        <div class="flex flex-wrap items-end gap-x-3 gap-y-1 mt-1">
          <span class="text-3xl sm:text-4xl font-semibold text-gray-900 tabular-nums">{{ fmt(net) }}</span>
          <app-report-delta-chip
            [current]="net"
            [previous]="prevNet"
            [label]="comparisonLabel"
            [compareEnabled]="compareEnabled"
          ></app-report-delta-chip>
        </div>

        <dl class="mt-5 border-t border-border divide-y divide-border">
          <div class="flex items-center justify-between py-2.5">
            <dt class="text-sm text-gray-600">Gross sales</dt>
            <dd class="flex items-center gap-2">
              <span class="text-sm font-medium text-gray-900 tabular-nums">{{ fmt(current.gross) }}</span>
              <app-report-delta-chip [current]="current.gross" [previous]="prevGross" [compareEnabled]="compareEnabled"></app-report-delta-chip>
            </dd>
          </div>

          <div class="flex items-center justify-between py-2.5">
            <dt class="text-sm text-gray-600">− Discounts</dt>
            <dd class="flex items-center gap-2">
              <span class="text-sm font-medium text-gray-900 tabular-nums">{{ fmt(current.discounts) }}</span>
              <app-report-delta-chip
                [current]="current.discounts"
                [previous]="prevDiscounts"
                [invert]="true"
                [compareEnabled]="compareEnabled"
              ></app-report-delta-chip>
            </dd>
          </div>

          <div class="flex items-start justify-between py-2.5">
            <dt class="text-sm text-gray-600">
              − Refunds
              <span class="block text-xs text-gray-400">On-platform refunds only (with payments)</span>
            </dt>
            <dd class="flex items-center gap-2">
              <span class="text-sm font-medium text-gray-900 tabular-nums">{{ fmt(refunds) }}</span>
              <app-report-delta-chip
                [current]="refunds"
                [previous]="previousRefunds"
                [invert]="true"
                [compareEnabled]="compareEnabled"
              ></app-report-delta-chip>
            </dd>
          </div>

          <div class="flex items-center justify-between py-2.5">
            <dt class="text-sm font-semibold text-gray-900">Net revenue</dt>
            <dd class="text-sm font-semibold text-gray-900 tabular-nums">{{ fmt(net) }}</dd>
          </div>
        </dl>
      </div>
    </app-dn-card>
  `,
})
export class SalesHeroComponent {
  @Input() current: SalesTotals = EMPTY_TOTALS;
  @Input() previous: SalesTotals | null = null;
  @Input() refunds = 0;
  @Input() previousRefunds = 0;
  @Input() comparisonLabel = '';
  /** Forwarded to every delta chip — false hides them (shell "Compare" toggle off). */
  @Input() compareEnabled = true;

  readonly fmt = formatUGX;

  get net(): number {
    return this.current.revenue - this.refunds;
  }
  get prevNet(): number {
    return this.previous ? this.previous.revenue - this.previousRefunds : 0;
  }
  get prevGross(): number {
    return this.previous?.gross ?? 0;
  }
  get prevDiscounts(): number {
    return this.previous?.discounts ?? 0;
  }
}
