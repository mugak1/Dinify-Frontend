import { Component, ElementRef, Input, OnChanges, SimpleChanges, inject } from '@angular/core';

import { BaseChartDirective } from 'ng2-charts';
import { ChartData, ChartOptions } from 'chart.js';
import { CardComponent } from '../../../../_shared/ui/card/card.component';
import { CardSkeletonComponent } from '../card-skeleton/card-skeleton.component';
import { AnimatedNumberComponent } from '../animated-number/animated-number.component';
import { OrdersData } from '../../models/dashboard.models';
import { ReportBucketUnit, ReportDateRange } from '../../../../_shared/timeframe';
import { bucketAxisLabel, baselineCaption } from '../../utils/timeframe-labels';
import { percentChange } from '../../../../_shared/utils/percent-change';
import { NoBaselineChipComponent } from '../../../../_shared/ui/no-baseline-chip/no-baseline-chip.component';
import { chartMutedColor, chartTooltipTheme } from 'src/app/_common/utils/chart-theme-utils';

interface StatusSegment {
  key: string;
  label: string;
  count: number;
  percentage: string;
  colorClass: string;
  bgClass: string;
}

@Component({
  selector: 'app-total-orders-card',
  standalone: true,
  imports: [
    BaseChartDirective,
    CardComponent,
    CardSkeletonComponent,
    AnimatedNumberComponent,
    NoBaselineChipComponent
],
  template: `
    @if (loading) {
      <app-card-skeleton variant="default"></app-card-skeleton>
    } @else if (ordersData) {
      <app-dn-card>
        <div class="p-4 sm:p-6">
          <!-- Header -->
          <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4 mb-8">
            <div class="min-w-0">
              <div class="flex items-center justify-between sm:justify-start gap-2 mb-1">
                <!-- No range in the title: the picker in the page header states it, and
                a parenthetical that can now read "(1 – 26 Jul)" is noise beside it. -->
                <h2 class="text-card-title text-foreground">Total Orders</h2>
              </div>
              <div class="flex flex-wrap items-center gap-2 sm:gap-3">
                <app-animated-number
                  class="text-2xl sm:text-3xl font-bold"
                  [value]="ordersData.total"
                  [duration]="2000"
                ></app-animated-number>

                <!-- Trend badge + comparison caption. The caption is a SIBLING of the
                badge, never a child: with no usable baseline the badge is replaced by a
                "New" chip and the caption has to survive to name what was compared
                against. One deliberate consequence — the tinted pill now wraps the
                percentage only, where it used to enclose the caption as well. -->
                @if (comparisonWindow) {
                  <div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    @if (hasBaseline) {
                      <div
                        class="flex items-center gap-1 text-xs sm:text-sm font-medium px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md"
                        [class]="isPositive
                          ? 'text-success bg-success/10'
                          : 'text-destructive bg-destructive/10'"
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
          </div>

          <!-- Stacked status bar -->
          <div class="mb-4">
            <div class="flex gap-1 h-8 rounded-none overflow-hidden">
              @for (seg of segments; track seg.key) {
                <div
                  class="transition-all"
                  [class]="seg.bgClass"
                  [style.width.%]="seg.count > 0 ? (seg.count / ordersData.total * 100) : 0"
                  [title]="seg.label + ': ' + seg.count + ' (' + seg.percentage + '%)'"
                ></div>
              }
            </div>
          </div>

          <!-- Status breakdown grid -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-7 sm:mb-8">
            @for (seg of segments; track seg.key) {
              <div class="text-center p-1.5 sm:p-2 bg-muted rounded-none">
                <div class="text-base sm:text-lg font-bold" [class]="seg.colorClass">{{ seg.count }}</div>
                <div class="text-[10px] sm:text-xs text-foreground">{{ seg.label }}</div>
                <div class="text-[10px] sm:text-xs text-foreground">{{ seg.percentage }}%</div>
              </div>
            }
          </div>

          <!-- Orders vs Time chart -->
          <div>
            <h3 class="text-card-title text-foreground mb-2">Orders vs Time</h3>
            <div class="h-32 sm:h-40">
              <canvas
                aria-label="Orders over time chart"
                role="img"
                baseChart
                [type]="'line'"
                [data]="chartData"
                [options]="chartOptions"
              ></canvas>
            </div>
          </div>
        </div>
      </app-dn-card>
    }
  `,
})
export class TotalOrdersCardComponent implements OnChanges {
  @Input() ordersData: OrdersData | null = null;
  /** The range the rendered data covers — labels the comparison window. */
  @Input() range: ReportDateRange | null = null;
  /** Resolved bucket for the rendered range — drives axis tick formatting. */
  @Input() bucketUnit: ReportBucketUnit = 'hour';
  /** Baseline for the delta — the comparison window's order count. `null` means the
   *  window returned nothing, which `percentChange` turns into the "New" chip. */
  @Input() previousTotal: number | null = null;
  /**
   * The window the baseline was measured over, or `null` when the basis is 'none'.
   *
   * `null` suppresses the ENTIRE comparison row — badge, "New" chip and caption alike.
   * A user who picked "No comparison" is not missing a baseline, they declined one, and
   * a "New" chip would answer a question they did not ask.
   */
  @Input() comparisonWindow: ReportDateRange | null = null;
  @Input() loading = false;

  chartData: ChartData<'line'> = { labels: [], datasets: [] };
  chartOptions: ChartOptions<'line'> = {};
  segments: StatusSegment[] = [];

  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** e.g. `vs. 340 orders (14 – 20 Jul)` — the compared window, named. */
  get periodLabel(): string {
    if (!this.comparisonWindow) return '';
    return baselineCaption(this.comparisonWindow, `${this.previousTotal ?? 0} orders`);
  }

  /** Signed % change, or `null` when the baseline cannot support one — see
   *  `_shared/utils/percent-change.ts` for which baselines qualify and why. */
  get percentageChange(): number | null {
    if (!this.ordersData) return null;
    return percentChange(this.ordersData.total, this.previousTotal);
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

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['ordersData'] || changes['bucketUnit'] || changes['range']) && this.ordersData) {
      this.buildSegments();
      this.buildChart();
    }
  }

  private buildSegments(): void {
    if (!this.ordersData) return;
    const b = this.ordersData.breakdown;
    const total = this.ordersData.total || 1;

    this.segments = [
      { key: 'paid', label: 'Paid', count: b.paid, percentage: ((b.paid / total) * 100).toFixed(1), colorClass: 'text-success', bgClass: 'bg-success' },
      { key: 'open', label: 'Open/Unpaid', count: b.open, percentage: ((b.open / total) * 100).toFixed(1), colorClass: 'text-warning', bgClass: 'bg-warning' },
      { key: 'cancelled', label: 'Cancelled', count: b.cancelled, percentage: ((b.cancelled / total) * 100).toFixed(1), colorClass: 'text-muted-foreground', bgClass: 'bg-muted-foreground' },
      { key: 'refunded', label: 'Refunded', count: b.refunded, percentage: ((b.refunded / total) * 100).toFixed(1), colorClass: 'text-destructive', bgClass: 'bg-destructive' },
    ];
  }

  private buildChart(): void {
    if (!this.ordersData) return;

    const series = this.ordersData.series;
    const labels = series.map((p) => this.formatXLabel(p.at));
    const values = series.map((p) => p.orders);

    this.chartData = {
      labels,
      datasets: [
        {
          data: values,
          fill: false,
          tension: 0.4,
          borderColor: 'hsl(0 0% 9%)',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: 'hsl(0 0% 9%)',
        },
      ],
    };

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
          padding: 8,
          cornerRadius: 6,
          displayColors: false,
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
            precision: 0 as any,
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
