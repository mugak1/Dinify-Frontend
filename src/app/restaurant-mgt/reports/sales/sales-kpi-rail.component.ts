import { Component, Input, OnChanges } from '@angular/core';

import { CardComponent } from '../../../_shared/ui/card/card.component';
import { formatUGX } from '../../../_shared/utils/price-utils';
import { ReportDeltaChipComponent } from '../components/delta-chip/delta-chip.component';
import { ReportSparklineComponent } from '../components/stat-sparkline/stat-sparkline.component';
import { EMPTY_TOTALS, SalesPoint, SalesTotals } from './sales-view';

interface KpiTile {
  label: string;
  value: string;
  series: number[];
  current: number;
  previous: number;
  invert: boolean;
  color: string;
}

/**
 * KPI rail (range-aggregate): Orders, Avg order value, Discounts. Each tile pairs
 * the range total with a per-bucket sparkline and a delta chip vs the comparison
 * window. The parent supplies the per-bucket points + the current/previous totals.
 */
@Component({
  selector: 'app-sales-kpi-rail',
  standalone: true,
  imports: [CardComponent, ReportDeltaChipComponent, ReportSparklineComponent],
  template: `
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      @for (t of tiles; track t.label) {
        <app-dn-card class="block">
          <div class="p-4">
            <div class="flex items-center justify-between gap-2">
              <p class="text-sm text-gray-500">{{ t.label }}</p>
              <app-report-delta-chip
                [current]="t.current"
                [previous]="t.previous"
                [invert]="t.invert"
                [compareEnabled]="compareEnabled"
              ></app-report-delta-chip>
            </div>
            <p class="text-xl sm:text-2xl font-semibold text-gray-900 tabular-nums mt-1">{{ t.value }}</p>
            <div class="mt-2">
              <app-report-sparkline
                [values]="t.series"
                [color]="t.color"
                [ariaLabel]="t.label + ' trend'"
              ></app-report-sparkline>
            </div>
          </div>
        </app-dn-card>
      }
    </div>
  `,
})
export class SalesKpiRailComponent implements OnChanges {
  @Input() points: SalesPoint[] = [];
  @Input() current: SalesTotals = EMPTY_TOTALS;
  @Input() previous: SalesTotals | null = null;
  /** Forwarded to every tile's delta chip — false hides them (shell "Compare" toggle off). */
  @Input() compareEnabled = true;

  tiles: KpiTile[] = [];

  ngOnChanges(): void {
    const orders = this.points.map((p) => p.orders);
    const discounts = this.points.map((p) => p.discount);
    const aov = this.points.map((p) => (p.orders > 0 ? Math.round(p.revenue / p.orders) : 0));

    this.tiles = [
      {
        label: 'Orders',
        value: this.current.orders.toLocaleString('en-UG'),
        series: orders,
        current: this.current.orders,
        previous: this.previous?.orders ?? 0,
        invert: false,
        color: 'hsl(142, 76%, 36%)',
      },
      {
        label: 'Avg order value',
        value: formatUGX(this.current.aov),
        series: aov,
        current: this.current.aov,
        previous: this.previous?.aov ?? 0,
        invert: false,
        color: 'hsl(142, 76%, 36%)',
      },
      {
        label: 'Discounts',
        value: formatUGX(this.current.discounts),
        series: discounts,
        current: this.current.discounts,
        previous: this.previous?.discounts ?? 0,
        invert: true,
        color: 'hsl(38, 92%, 50%)',
      },
    ];
  }
}
