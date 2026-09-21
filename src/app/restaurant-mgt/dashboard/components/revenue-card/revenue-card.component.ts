import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  inject,
} from '@angular/core';

import { RouterModule } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import { ChartData, ChartOptions, TooltipItem } from 'chart.js';
import { CardComponent } from '../../../../_shared/ui/card/card.component';
import { CardSkeletonComponent } from '../card-skeleton/card-skeleton.component';
import { CardErrorComponent } from '../card-error/card-error.component';
import { AnimatedNumberComponent } from '../animated-number/animated-number.component';
import { RevenueData } from '../../models/dashboard.models';
import { ReportBucketUnit, ReportDateRange } from '../../../../_shared/timeframe';
import { formatCurrency, formatChartTick, formatCompact } from '../../utils/format.utils';
import { bucketAxisLabel, baselineCaption } from '../../utils/timeframe-labels';
import { percentChange } from '../../../../_shared/utils/percent-change';
import { NoBaselineChipComponent } from '../../../../_shared/ui/no-baseline-chip/no-baseline-chip.component';
import { chartMutedColor, chartTooltipTheme } from 'src/app/_common/utils/chart-theme-utils';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-revenue-card',
  standalone: true,
  imports: [
    RouterModule,
    BaseChartDirective,
    CardComponent,
    CardSkeletonComponent,
    CardErrorComponent,
    AnimatedNumberComponent,
    NoBaselineChipComponent
],
  template: `
    @if (loading) {
      <app-card-skeleton variant="default"></app-card-skeleton>
    } @else if (error) {
      <app-card-error title="Revenue" [message]="error" (retry)="retry.emit()"></app-card-error>
    } @else if (revenueData) {
      <app-dn-card>
        <div class="p-4 sm:p-6">
          <!-- Header -->
          <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4 mb-8">
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between sm:justify-start gap-2 mb-1">
                <h2 class="text-card-title text-foreground">Revenue (UGX)</h2>
                <a
                  routerLink="/reports"
                  class="text-xs sm:text-sm text-primary hover:underline flex items-center gap-1 sm:hidden whitespace-nowrap"
                >
                  Sales
                  <svg aria-hidden="true" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                  </svg>
                </a>
              </div>
              <div class="flex flex-wrap items-baseline gap-2 sm:gap-3">
                <app-animated-number
                  class="text-2xl sm:text-3xl font-bold text-success"
                  [value]="revenueData.totals.net"
                  [duration]="2000"
                  [formatFn]="currencyFormatter"
                ></app-animated-number>

                <!-- Trend badge + comparison caption. The caption is a SIBLING of the
                badge, never a child: with no usable baseline the badge is replaced by a
                "New" chip and the caption has to survive to name what was compared
                against. Wrapping lets it drop to its own line on a narrow phone. -->
                @if (comparisonWindow) {
                  <div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    @if (hasBaseline) {
                      <div
                        class="flex items-center gap-1 text-xs sm:text-sm font-medium"
                        [class]="isPositive ? 'text-success' : 'text-destructive'"
                      >
                        @if (isPositive) {
                          <svg aria-hidden="true" class="w-3 h-3 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
                          </svg>
                        } @else {
                          <svg aria-hidden="true" class="w-3 h-3 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>
                          </svg>
                        }
                        <span class="whitespace-nowrap">{{ absPercentage }}%</span>
                      </div>
                    } @else {
                      <app-no-baseline-chip></app-no-baseline-chip>
                    }
                    <span class="text-xs sm:text-sm text-muted-foreground">{{ periodLabel }}</span>
                  </div>
                }
              </div>
            </div>
            <a
              routerLink="/reports"
              class="hidden sm:flex text-sm text-primary hover:underline items-center gap-1 whitespace-nowrap shrink-0"
            >
              See Sales report
              <svg aria-hidden="true" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
              </svg>
            </a>
          </div>

          <!-- Pills row -->
          <div class="flex flex-wrap gap-1.5 sm:gap-2 mb-4 sm:mb-6">
            @for (pill of pills; track pill.label) {
              <div class="px-2 sm:px-3 py-0.5 sm:py-1 rounded-full bg-muted text-xs sm:text-sm">
                <span class="text-muted-foreground">{{ pill.label }}:</span>
                <span class="font-medium" [class]="pill.colorClass">{{ pill.formatted }}</span>
              </div>
            }
          </div>

          <!-- D07/PR-5. Gross and Discounts are measured over SETTLED PAYMENTS,
          and the server has just said it does not record them; Net and the chart
          are derived from those two less Refunds. So the figures above are not a
          measurement of money taken, and an operator reading them as one is
          reading this platform's instrumentation as their own trade.

          NOTHING IS RECOMPUTED, SUPPRESSED OR REPRICED — the server's own numbers
          are still rendered verbatim, beside a statement of what they are.

          NEUTRAL, not the warning hue the pricing notice below uses. That one is
          window-specific ("this period straddles a boundary"); this one is a
          permanent property of every window and every restaurant, so an amber
          alarm on every load would read as "something went wrong today" and
          would devalue the one that really does mean it. -->
          @if (trackingUnavailable) {
            <div
              role="note"
              data-testid="revenue-tracking-note"
              class="-mt-2 mb-4 sm:mb-6 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-caption text-muted-foreground"
            >
              <svg aria-hidden="true" class="w-4 h-4 shrink-0 mt-px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
              </svg>
              <span>
                Dinify doesn't record settled payments, so Gross and Discounts —
                and the Net figure and chart derived from them — aren't a
                measurement of money taken.
                @if (netIsNegative) {
                  That is why Net reads below zero here: refunds are subtracted
                  from figures nothing measured.
                }
              </span>
            </div>
          }

          <!-- The server's mixed-pricing-convention notice, beside the figures
          it is about. Gross and Discounts are the two affected pills, so it
          sits immediately under them rather than at the foot of the card. -->
          @if (pricingNotice) {
            <div
              role="note"
              class="-mt-2 mb-4 sm:mb-6 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-caption text-muted-foreground"
            >
              <svg aria-hidden="true" class="w-4 h-4 shrink-0 mt-px text-warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
              </svg>
              <span>{{ pricingNotice }}</span>
            </div>
          }

          <!-- Chart -->
          <div class="h-48 sm:h-64">
            <canvas
              aria-label="Revenue over time chart"
              role="img"
              baseChart
              [type]="'line'"
              [data]="chartData"
              [options]="chartOptions"
            ></canvas>
          </div>
        </div>
      </app-dn-card>
    }
  `,
})
export class RevenueCardComponent implements OnChanges {
  @Input() revenueData: RevenueData | null = null;
  /** The range the rendered data covers — labels the comparison window. */
  @Input() range: ReportDateRange | null = null;
  /** Resolved bucket for the rendered range — drives axis tick formatting. */
  @Input() bucketUnit: ReportBucketUnit = 'hour';
  /** Baseline for the delta — the comparison window's net revenue. `null` means the
   *  window returned nothing, which `percentChange` turns into the "New" chip. */
  @Input() previousNet: number | null = null;
  /**
   * The window the baseline was measured over, or `null` when the basis is 'none'.
   *
   * `null` suppresses the ENTIRE comparison row — badge, "New" chip and caption alike.
   * A user who picked "No comparison" is not missing a baseline, they declined one, and
   * a "New" chip would answer a question they did not ask.
   */
  @Input() comparisonWindow: ReportDateRange | null = null;
  /** The server's answer to whether it records settled payments, or `undefined`
   *  when it did not state one (D07). */
  @Input() paymentTrackingEnabled?: boolean;
  @Input() loading = false;
  @Input() error: string | null = null;
  @Output() retry = new EventEmitter<void>();

  chartData: ChartData<'line'> = { labels: [], datasets: [] };
  chartOptions: ChartOptions<'line'> = {};
  pills: { label: string; formatted: string; colorClass: string }[] = [];

  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly currencyFormatter = (v: number) => formatCurrency(v);

  /**
   * True ONLY when the server explicitly said it does not record settled
   * payments (D07/PR-5). An absent flag says nothing, so an older response
   * leaves the card exactly as it was rather than asserting an absence on that
   * server's behalf — the same strict rule `payment-methods-card` applies.
   *
   * WHY THIS CARD NEEDED IT, AND WHY IT IS THE LOUDEST OF THE THREE CONSUMERS.
   * `_build_revenue` aggregates `gross` and `discounts` over orders filtered
   * `payment_status='paid'` — a column with no writer — so both are zero in
   * every bucket and in `totals`, and `net = gross - discounts - refunds` is
   * built on top of them. The headline figure on the Dashboard is therefore a
   * derivation from two unmeasured quantities, presented in success green.
   */
  get trackingUnavailable(): boolean {
    return this.paymentTrackingEnabled === false;
  }

  /**
   * The second clause of the notice, and it is OBSERVED rather than predicted.
   *
   * `refunds` is NOT paid-gated (`order_status='refunded'` is reachable), so a
   * window holding one reports a NEGATIVE net against a zero gross. The card is
   * rendering that number, so it can say why — but it says so only when it can
   * actually see it, rather than claiming in advance what the server will send.
   *
   * It is gated on the disclosure: a negative net from a server that DOES
   * measure payments is an ordinary trading fact (refunds exceeded takings) and
   * needs no explanation from us.
   */
  get netIsNegative(): boolean {
    return this.trackingUnavailable && (this.revenueData?.totals.net ?? 0) < 0;
  }

  /**
   * The server's mixed-pricing-convention sentence, or `null`.
   *
   * READ FROM THE RESPONSE FOR THE WINDOW ACTUALLY DISPLAYED, never from a
   * locally inferred deployment date — the server counts the orders on each
   * side of the boundary and decides; the client only renders what it said.
   * Because it is a getter over `revenueData`, changing the period replaces the
   * input and a stale notice disappears with it.
   *
   * THREE THINGS IT IS NOT. It is not a claim that any figure is wrong (the
   * payable each diner paid is unaffected, no order is repriced or excluded);
   * it is not derived from the counts (only a notice the server issued is
   * shown); and its ABSENCE is not evidence of a uniform convention — a
   * response that predates the field simply said nothing.
   *
   * This card is fed the PRIMARY window's response. The Dashboard's separate
   * comparison-window call supplies only a baseline total and is never read
   * here, so a notice can never describe a period the card is not showing.
   */
  get pricingNotice(): string | null {
    const conventions = this.revenueData?.pricing_conventions;
    if (!conventions?.mixed) return null;
    return conventions.notice ?? null;
  }

  /** Signed % change, or `null` when the baseline cannot support one — see
   *  `_shared/utils/percent-change.ts` for which baselines qualify and why. */
  get percentageChange(): number | null {
    if (!this.revenueData) return null;
    return percentChange(this.revenueData.totals.net, this.previousNet);
  }

  /** Gates the badge: `false` swaps in the "New" chip and leaves the caption standing. */
  get hasBaseline(): boolean {
    return this.percentageChange !== null;
  }

  get isPositive(): boolean {
    const change = this.percentageChange;
    return change !== null && change >= 0;
  }

  get absPercentage(): string {
    const change = this.percentageChange;
    return change === null ? '' : Math.abs(change).toFixed(1);
  }

  /** e.g. `vs. UGX 1.2M (14 – 20 Jul)` — the compared window, named. Compact rather than
   *  full precision to keep it short enough to sit beside the badge. */
  get periodLabel(): string {
    if (!this.comparisonWindow) return '';
    return baselineCaption(this.comparisonWindow, `UGX ${formatCompact(this.previousNet ?? 0)}`);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['revenueData'] || changes['bucketUnit'] || changes['range']) && this.revenueData) {
      this.buildPills();
      this.buildChart();
    }
  }

  private buildPills(): void {
    if (!this.revenueData) return;
    const t = this.revenueData.totals;
    this.pills = [
      { label: 'Gross', formatted: formatCurrency(t.gross), colorClass: 'text-foreground' },
      { label: 'Discounts', formatted: formatCurrency(t.discounts), colorClass: 'text-warning' },
      { label: 'Refunds', formatted: formatCurrency(t.refunds), colorClass: 'text-destructive' },
      { label: 'Net', formatted: formatCurrency(t.net), colorClass: 'text-success' },
    ];
  }

  private buildChart(): void {
    if (!this.revenueData) return;

    const series = this.revenueData.series;
    const labels = series.map((p) => this.formatXLabel(p.at));
    const netValues = series.map((p) => p.net);

    // Gradient fill via backgroundColor function
    const gradientBg = (ctx: any) => {
      const chart = ctx.chart;
      const { ctx: canvasCtx, chartArea } = chart;
      if (!chartArea) return 'rgba(0,0,0,0)';
      const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      gradient.addColorStop(0, 'hsla(0, 0%, 9%, 0.3)');
      gradient.addColorStop(1, 'hsla(0, 0%, 9%, 0)');
      return gradient;
    };

    this.chartData = {
      labels,
      datasets: [
        {
          data: netValues,
          fill: true,
          tension: 0.4,
          borderColor: 'hsl(0 0% 9%)',
          borderWidth: 2,
          backgroundColor: gradientBg as any,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: 'hsl(0 0% 9%)',
        },
      ],
    };

    // Store series reference for tooltip access
    const seriesRef = series;

    const tt = chartTooltipTheme(this.host.nativeElement);
    const muted = chartMutedColor(this.host.nativeElement);

    this.chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          backgroundColor: tt.backgroundColor,
          titleColor: tt.titleColor,
          bodyColor: tt.bodyColor,
          borderColor: tt.borderColor,
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            title: (items: TooltipItem<'line'>[]) => {
              if (!items.length) return '';
              return items[0].label || '';
            },
            // GROSS AND NET ONLY — the two things a bucket actually carries.
            //
            // It used to add `Orders: ${point.orders}` and `AOV: ${point.aov}`,
            // both read off literals the adapter wrote because `_build_revenue`
            // sends no such key. Against a live backend every hover therefore
            // read "Orders: 0 · AOV: 0" about a restaurant that had traded.
            // The mock populated both, so it looked right in the running app and
            // would have started lying at the `USE_MOCK_DATA` flip.
            //
            // The fields are gone from `RevenueSeriesPoint`, so restoring these
            // two lines will not compile — which is the intent. Re-adding them
            // means a server-side orders count on the revenue bucket first; see
            // that type for why joining `orders.series` by `at` is not it.
            label: (item: TooltipItem<'line'>) => {
              const idx = item.dataIndex;
              const point = seriesRef[idx];
              if (!point) return '';
              return [
                `Gross: ${formatCurrency(point.gross)}`,
                `Net: ${formatCurrency(point.net)}`,
              ] as any;
            },
          },
        },
      },
      scales: {
        x: {
          display: true,
          grid: {
            display: true,
            color: 'rgba(0, 0, 0, 0.06)',
            tickBorderDash: [3, 3],
          },
          ticks: {
            color: muted,
            font: { size: 10 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
          },
        },
        y: {
          display: true,
          grid: {
            display: true,
            color: 'rgba(0, 0, 0, 0.06)',
            tickBorderDash: [3, 3],
          },
          ticks: {
            color: muted,
            font: { size: 10 },
            callback: (value: any) => formatChartTick(Number(value)),
          },
        },
      },
      interaction: {
        mode: 'index',
        intersect: false,
      },
    };
  }

  private formatXLabel(at: string): string {
    return bucketAxisLabel(at, this.bucketUnit);
  }
}
