import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import { ChartData, ChartOptions, TooltipItem } from 'chart.js';
import { CardComponent } from '../../../../_shared/ui/card/card.component';
import { CardSkeletonComponent } from '../card-skeleton/card-skeleton.component';
import { CardErrorComponent } from '../card-error/card-error.component';
import { AnimatedNumberComponent } from '../animated-number/animated-number.component';
import { RevenueData, DateRange } from '../../models/dashboard.models';
import { formatCurrency, formatChartTick } from '../../utils/format.utils';

@Component({
  selector: 'app-revenue-card',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    BaseChartDirective,
    CardComponent,
    CardSkeletonComponent,
    CardErrorComponent,
    AnimatedNumberComponent,
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
          <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4 mb-4">
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between sm:justify-start gap-2 mb-1">
                <h2 class="text-base sm:text-lg font-bold text-foreground">Revenue (UGX)</h2>
                <a
                  routerLink="/rest-app/reports"
                  class="text-xs sm:text-sm text-primary hover:underline flex items-center gap-1 sm:hidden whitespace-nowrap"
                >
                  Sales
                  <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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

                <!-- Trend indicator -->
                <div
                  class="flex items-center gap-1 text-xs sm:text-sm font-medium"
                  [class]="percentageChange >= 0 ? 'text-success' : 'text-destructive'"
                >
                  @if (percentageChange >= 0) {
                    <svg class="w-3 h-3 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
                    </svg>
                  } @else {
                    <svg class="w-3 h-3 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>
                    </svg>
                  }
                  <span class="whitespace-nowrap">{{ absPercentage }}% {{ periodLabel }}</span>
                </div>
              </div>
            </div>
            <a
              routerLink="/rest-app/reports"
              class="hidden sm:flex text-sm text-primary hover:underline items-center gap-1 whitespace-nowrap shrink-0"
            >
              See Sales report
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
              </svg>
            </a>
          </div>

          <hr class="border-border mb-4" />

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
  @Input() dateRange: DateRange = 'day';
  @Input() loading = false;
  @Input() error: string | null = null;
  @Output() retry = new EventEmitter<void>();

  chartData: ChartData<'line'> = { labels: [], datasets: [] };
  chartOptions: ChartOptions<'line'> = {};
  pills: { label: string; formatted: string; colorClass: string }[] = [];

  readonly currencyFormatter = (v: number) => formatCurrency(v);

  get percentageChange(): number {
    if (!this.revenueData) return 0;
    const prev = this.revenueData.previous_totals.net;
    if (prev === 0) return 0;
    return ((this.revenueData.totals.net - prev) / prev) * 100;
  }

  get absPercentage(): string {
    return Math.abs(this.percentageChange).toFixed(1);
  }

  get periodLabel(): string {
    switch (this.dateRange) {
      case 'day': return 'vs last day';
      case 'week': return 'vs last week';
      case 'month': return 'vs last month';
      case 'ytd': return 'vs last year';
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['revenueData'] || changes['dateRange']) && this.revenueData) {
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
      if (!chartArea) return 'rgba(34,197,94,0)';
      const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      gradient.addColorStop(0, 'hsla(142, 76%, 36%, 0.3)');
      gradient.addColorStop(1, 'hsla(142, 76%, 36%, 0)');
      return gradient;
    };

    this.chartData = {
      labels,
      datasets: [
        {
          data: netValues,
          fill: true,
          tension: 0.4,
          borderColor: 'hsl(142, 76%, 36%)',
          borderWidth: 2,
          backgroundColor: gradientBg as any,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: 'hsl(142, 76%, 36%)',
        },
      ],
    };

    // Store series reference for tooltip access
    const seriesRef = series;

    this.chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          backgroundColor: 'hsl(var(--popover))',
          titleColor: 'hsl(var(--foreground))',
          bodyColor: 'hsl(var(--muted-foreground))',
          borderColor: 'hsl(var(--border))',
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
            color: 'hsl(var(--border))',
            tickBorderDash: [3, 3],
          },
          ticks: {
            color: 'hsl(var(--muted-foreground))',
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
            color: 'hsl(var(--border))',
            tickBorderDash: [3, 3],
          },
          ticks: {
            color: 'hsl(var(--muted-foreground))',
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
    const d = new Date(at);
    if (isNaN(d.getTime())) return at;
    switch (this.dateRange) {
      case 'day':
        return d.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
      case 'week':
        return d.toLocaleDateString('en-US', { weekday: 'short' });
      case 'month':
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      case 'ytd':
        return d.toLocaleDateString('en-US', { month: 'short' });
    }
  }
}
