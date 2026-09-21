import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';

import { CardComponent } from '../../../../_shared/ui/card/card.component';
import { CardSkeletonComponent } from '../card-skeleton/card-skeleton.component';
import { AnimatedNumberComponent } from '../animated-number/animated-number.component';
import { PaymentMethodData } from '../../models/dashboard.models';
import { formatCompact } from '../../utils/format.utils';
import {
  PaymentMeasurement,
  measurementIsSupported,
  measurementNotice,
} from 'src/app/_shared/reporting/payment-measurement';

interface MethodRow {
  method: string;
  label: string;
  amount: number;
  color: string;
  percentage: number;
  compactAmount: string;
}

const METHOD_LABELS: Record<string, string> = {
  card: 'Card',
  mobile_money: 'Mobile Money',
  cash: 'Cash',
};

const METHOD_COLORS: Record<string, string> = {
  card: 'hsl(var(--primary))',
  mobile_money: 'hsl(50, 100%, 50%)',
  cash: 'hsl(142, 70%, 45%)',
};

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-payment-methods-card',
  standalone: true,
  host: { class: 'block h-full' },
  imports: [CardComponent, CardSkeletonComponent, AnimatedNumberComponent],
  template: `
    @if (loading) {
      <app-card-skeleton variant="compact"></app-card-skeleton>
    } @else if (!measured || !paymentMethods || total === 0) {
      <app-dn-card [fullHeight]="true">
        <div class="p-4 sm:p-6 h-full flex flex-col overflow-hidden">
          <div class="mb-4 sm:mb-5">
            <h2 class="text-card-title text-foreground">Payment Methods (UGX)</h2>
            <p class="text-[10px] sm:text-xs text-muted-foreground">Share of payments in selected period</p>
          </div>
          <div class="flex-1 flex items-center justify-center">
            <!-- THE UNMEASURED BRANCH COMES FIRST AND IS STRUCTURAL. It does not
            ask whether rows happen to have arrived: a server that cannot vouch
            for settlement could send rows and they would still not be a share of
            payments. -->
            @if (!measured) {
              <p
                data-testid="payments-measurement-note"
                class="text-sm text-muted-foreground text-center"
              >{{ measurementNote }}</p>
            } @else {
              <!-- "RECORDED", NOT "SETTLED". This sentence is now only ever said
              by a server that DOES record settlement, so it is a statement about
              the period; "no settled payments" invites the reading that money
              was owed and not taken, where what is true is that none was
              recorded. -->
              <p class="text-sm text-muted-foreground text-center">No payments recorded in this period</p>
            }
          </div>
        </div>
      </app-dn-card>
    } @else {
      <app-dn-card [fullHeight]="true">
        <div class="p-4 sm:p-6 h-full flex flex-col overflow-hidden">
          <!-- Header -->
          <div class="mb-4 sm:mb-5">
            <h2 class="text-card-title text-foreground">Payment Methods (UGX)</h2>
            <p class="text-[10px] sm:text-xs text-muted-foreground">Share of payments in selected period</p>
            <p class="text-[10px] sm:text-xs text-muted-foreground/80 mt-0.5">
              Total settled: <span class="font-medium text-foreground">{{ totalCompact }} UGX</span>
            </p>
          </div>

          <!-- Method bars -->
          <div class="flex flex-col gap-3 flex-1">
            @for (row of rows; track row.method) {
              <div class="group">
                <!-- Label row -->
                <div class="flex items-center justify-between mb-1">
                  <div class="flex items-center gap-2">
                    <div
                      class="w-2.5 h-2.5 rounded-full shrink-0"
                      [style.backgroundColor]="row.color"
                    ></div>
                    <span class="text-xs sm:text-sm font-medium text-foreground">{{ row.label }}</span>
                  </div>
                  <span class="text-xs sm:text-sm font-semibold tabular-nums text-foreground">
                    <app-animated-number
                      [value]="row.amount"
                      [duration]="1600"
                      [formatFn]="compactFormatter"
                    ></app-animated-number>
                  </span>
                </div>

                <!-- Horizontal bar -->
                <div class="relative h-6 sm:h-7 bg-muted/50 rounded overflow-hidden">
                  <div
                    class="absolute inset-y-0 left-0 rounded-l transition-all duration-500 ease-out group-hover:brightness-110"
                    [style.width.%]="row.percentage"
                    [style.backgroundColor]="row.color"
                  ></div>
                  <div class="absolute inset-0 flex items-center px-2">
                    <span
                      class="text-xs font-semibold tabular-nums text-foreground"
                      [class]="row.percentage > 20 ? 'drop-shadow-sm ml-auto mr-1' : 'absolute right-2'"
                    >
                      {{ row.percentage }}%
                    </span>
                  </div>
                </div>
              </div>
            }
          </div>

          <!-- Footer. Only a measured card reaches this branch now, so there is
          one sentence and it is true of it. -->
          <p class="text-[10px] sm:text-xs text-muted-foreground mt-auto pt-3">
            Based on payments recorded in the selected period.
          </p>
        </div>
      </app-dn-card>
    }
  `,
})
export class PaymentMethodsCardComponent implements OnChanges {
  @Input() paymentMethods: PaymentMethodData[] | null = null;
  @Input() loading = false;

  /**
   * Whether this platform measures settled payments (D07/G1). Classified once
   * by the adapter — see `_shared/reporting/payment-measurement.ts`.
   */
  @Input() measurement: PaymentMeasurement | null = null;

  /**
   * Whether the totals and shares on this card are measurements.
   *
   * WHY THIS CARD NEEDS IT. It sums `order_payment` transactions with status
   * `success`; the writer for those was deleted in the non-custodial teardown,
   * so the list is permanently empty and every sentence about it — the total,
   * the shares and the two empty-state lines — describes a measurement nothing
   * performs. An operator reads them as a statement about their own trade.
   */
  get measured(): boolean {
    return measurementIsSupported(this.measurement);
  }

  /** The sentence for the non-supported state, or `null` when measured. */
  get measurementNote(): string | null {
    return measurementNotice(this.measurement, 'a share of payments');
  }

  rows: MethodRow[] = [];
  total = 0;
  totalCompact = '';

  readonly compactFormatter = (v: number) => formatCompact(v);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['paymentMethods']) {
      this.buildRows();
    }
  }

  private buildRows(): void {
    if (!this.paymentMethods || this.paymentMethods.length === 0) {
      this.rows = [];
      this.total = 0;
      this.totalCompact = '';
      return;
    }

    this.total = this.paymentMethods.reduce((s, m) => s + m.amount, 0);
    this.totalCompact = formatCompact(this.total);

    const sorted = [...this.paymentMethods].sort((a, b) => b.amount - a.amount);
    const balancedPcts = this.getBalancedPercentages(sorted);

    this.rows = sorted.map((m, i) => ({
      method: m.method,
      label: METHOD_LABELS[m.method] || m.method,
      amount: m.amount,
      color: METHOD_COLORS[m.method] || 'hsl(var(--muted-foreground))',
      percentage: balancedPcts[i],
      compactAmount: formatCompact(m.amount),
    }));
  }

  /** Largest Remainder Method — ensures percentages sum to exactly 100 */
  private getBalancedPercentages(sorted: PaymentMethodData[]): number[] {
    if (this.total === 0) return sorted.map(() => 0);

    const rawPcts = sorted.map((d) => (d.amount / this.total) * 100);
    const floors = rawPcts.map((p) => Math.floor(p));
    const remainders = rawPcts.map((p, i) => ({ index: i, remainder: p - floors[i] }));

    const remaining = 100 - floors.reduce((a, b) => a + b, 0);
    remainders.sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < remaining; i++) {
      floors[remainders[i].index]++;
    }

    return floors;
  }
}
