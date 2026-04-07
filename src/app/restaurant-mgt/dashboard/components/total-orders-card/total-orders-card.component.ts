import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import { ChartData, ChartOptions } from 'chart.js';
import { CardComponent } from '../../../../_shared/ui/card/card.component';
import { CardSkeletonComponent } from '../card-skeleton/card-skeleton.component';
import { AnimatedNumberComponent } from '../animated-number/animated-number.component';
import { OrdersData, DateRange } from '../../models/dashboard.models';

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
    CommonModule,
    RouterModule,
    BaseChartDirective,
    CardComponent,
    CardSkeletonComponent,
    AnimatedNumberComponent,
  ],
  template: `
    @if (loading) {
      <app-card-skeleton variant="default"></app-card-skeleton>
    } @else if (ordersData) {
      <app-dn-card>
        <div class="p-4 sm:p-6">
          <!-- Header -->
          <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4 mb-4">
            <div class="min-w-0">
              <div class="flex items-center justify-between sm:justify-start gap-2 mb-1">
                <h2 class="text-base sm:text-lg font-bold text-foreground">Total Orders ({{ timeframeLabel }})</h2>
                <a
                  routerLink="/rest-app/orders"
                  class="text-xs text-primary hover:underline sm:hidden whitespace-nowrap"
                >
                  Open orders
                </a>
              </div>
              <div class="flex flex-wrap items-center gap-2 sm:gap-3">
                <app-animated-number
                  class="text-2xl sm:text-3xl font-bold"
                  [value]="ordersData.total"
                  [duration]="2000"
                ></app-animated-number>

                <!-- Trend badge -->
                <div
                  class="flex items-center gap-1 text-xs sm:text-sm font-medium px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md"
                  [class]="percentageChange >= 0
                    ? 'text-success bg-success/10'
                    : 'text-destructive bg-destructive/10'"
                >
                  @if (percentageChange >= 0) {
                    <svg aria-hidden="true" class="w-3 h-3 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
                    </svg>
                  } @else {
                    <svg aria-hidden="true" class="w-3 h-3 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>
                    </svg>
                  }
                  <span class="whitespace-nowrap">{{ absPercentage }}% {{ periodLabel }}</span>
                </div>
              </div>
            </div>
            <a
              routerLink="/rest-app/orders"
              class="hidden sm:block text-sm text-primary hover:underline whitespace-nowrap shrink-0"
            >
              View open orders
            </a>
          </div>

          <hr class="border-border mb-4" />

          <!-- Stacked status bar -->
          <div class="mb-4">
            <div class="flex gap-1 h-8 rounded-lg overflow-hidden">
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
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-4">
            @for (seg of segments; track seg.key) {
              <div class="text-center p-1.5 sm:p-2 bg-muted rounded-lg">
                <div class="text-base sm:text-lg font-bold" [class]="seg.colorClass">{{ seg.count }}</div>
                <div class="text-[10px] sm:text-xs text-foreground">{{ seg.label }}</div>
                <div class="text-[10px] sm:text-xs text-foreground">{{ seg.percentage }}%</div>
              </div>
            }
          </div>

          <hr class="border-border my-3 sm:my-4" />

          <!-- Orders vs Time chart -->
          <div>
            <h3 class="text-sm sm:text-base font-bold text-foreground mb-2">Orders vs Time</h3>
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
  @Input() dateRange: DateRange = 'day';
  @Input() loading = false;

  chartData: ChartData<'line'> = { labels: [], datasets: [] };
  chartOptions: ChartOptions<'line'> = {};
  segments: StatusSegment[] = [];

  get timeframeLabel(): string {
    switch (this.dateRange) {
      case 'day': return 'Today';
      case 'week': return 'This Week';
      case 'month': return 'This Month';
      case 'ytd': return 'Year to Date';
    }
  }

  get periodLabel(): string {
    switch (this.dateRange) {
      case 'day': return 'vs last day';
      case 'week': return 'vs last week';
      case 'month': return 'vs last month';
      case 'ytd': return 'vs last year';
    }
  }

  get percentageChange(): number {
    if (!this.ordersData || this.ordersData.previous_total === 0) return 0;
    return ((this.ordersData.total - this.ordersData.previous_total) / this.ordersData.previous_total) * 100;
  }

  get absPercentage(): string {
    return Math.abs(this.percentageChange).toFixed(1);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['ordersData'] || changes['dateRange']) && this.ordersData) {
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
          borderColor: 'hsl(var(--primary))',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: 'hsl(var(--primary))',
        },
      ],
    };

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
            color: 'rgba(0, 0, 0, 0.06)',
            tickBorderDash: [3, 3],
          },
          ticks: {
            color: 'hsl(var(--muted-foreground))',
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
