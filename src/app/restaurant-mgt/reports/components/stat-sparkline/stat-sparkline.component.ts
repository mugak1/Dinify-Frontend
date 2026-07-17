import { Component, ElementRef, Input, OnChanges, inject } from '@angular/core';

import { BaseChartDirective } from 'ng2-charts';
import { ChartData, ChartOptions } from 'chart.js';
import { resolveColorString } from 'src/app/_common/utils/chart-theme-utils';

/**
 * Tiny inline trend line for a KPI tile — axis-less, legend-less, tooltip-less.
 * Reuses the house ng2-charts stack (registered globally via provideCharts in
 * RestaurantMgtModule); a reports primitive so the KPI rail (and C–E) can drop a
 * sparkline beside any metric.
 */
@Component({
  selector: 'app-report-sparkline',
  standalone: true,
  imports: [BaseChartDirective],
  template: `
    <div class="h-8 w-full">
      <canvas
        baseChart
        [type]="'line'"
        [data]="data"
        [options]="options"
        role="img"
        [attr.aria-label]="ariaLabel"
      ></canvas>
    </div>
  `,
})
export class ReportSparklineComponent implements OnChanges {
  @Input() values: number[] = [];
  @Input() color = 'hsl(var(--primary))';
  @Input() ariaLabel = 'Trend sparkline';

  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  data: ChartData<'line'> = { labels: [], datasets: [] };
  readonly options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: { x: { display: false }, y: { display: false } },
    elements: { point: { radius: 0 } },
  };

  ngOnChanges(): void {
    this.data = {
      labels: this.values.map((_, i) => i),
      datasets: [
        {
          data: this.values,
          borderColor: resolveColorString(this.host.nativeElement, this.color),
          borderWidth: 1.5,
          tension: 0.4,
          fill: false,
          pointRadius: 0,
          pointHoverRadius: 0,
        },
      ],
    };
  }
}
