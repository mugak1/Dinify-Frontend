import {
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
import { bucketAxisLabel, comparisonCaption } from '../../utils/timeframe-labels';
import { percentChange } from '../../../../_shared/utils/percent-change';
import { NoBaselineChipComponent } from '../../../../_shared/ui/no-baseline-chip/no-baseline-chip.component';
import { chartMutedColor, chartTooltipTheme } from 'src/app/_common/utils/chart-theme-utils';

@Component({
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
  @Input() loading = false;
  @Input() error: string | null = null;
  @Output() retry = new EventEmitter<void>();

  chartData: ChartData<'line'> = { labels: [], datasets: [] };
  chartOptions: ChartOptions<'line'> = {};
  pills: { label: string; formatted: string; colorClass: string }[] = [];

  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly currencyFormatter = (v: number) => formatCurrency(v);

  /** Signed % change, or `null` when the baseline cannot support one — see
   *  `_shared/utils/percent-change.ts` for which baselines qualify and why. */
  get percentageChange(): number | null {
    if (!this.revenueData) return null;
    return percentChange(this.revenueData.totals.net, this.revenueData.previous_totals.net);
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
    if (!this.range || !this.revenueData) return '';
    return comparisonCaption(this.range, `UGX ${formatCompact(this.revenueData.previous_totals.net)}`);
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
            label: (item: TooltipItem<'line'>) => {
              const idx = item.dataIndex;
              const point = seriesRef[idx];
              if (!point) return '';
              return [
                `Gross: ${formatCurrency(point.gross)}`,
                `Net: ${formatCurrency(point.net)}`,
                `Orders: ${point.orders}`,
                `AOV: ${formatCurrency(point.aov)}`,
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
