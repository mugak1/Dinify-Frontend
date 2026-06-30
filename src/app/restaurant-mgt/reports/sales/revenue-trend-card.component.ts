import { Component, ElementRef, Input, OnChanges, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BaseChartDirective } from 'ng2-charts';
import { ChartData, ChartOptions, TooltipItem } from 'chart.js';
import { CardComponent } from '../../../_shared/ui/card/card.component';
import { formatUGX } from '../../../_shared/utils/price-utils';
import { SalesPoint, bestPoint } from './sales-view';
import { chartMutedColor, chartTooltipTheme, resolveHsl } from 'src/app/_common/utils/chart-theme-utils';

const BRAND = 'hsl(142, 76%, 36%)'; // dashboard revenue-chart green
const BEST = 'hsl(142, 71%, 45%)';

/**
 * Revenue trend (bucket-driven, line). The x-axis IS the bucket — it redraws
 * hourly / daily / monthly as the timeframe changes. Shaped CLIENT-SIDE from the
 * normalized series (no result=graph call). Overlays: a dashed GHOST of the
 * comparison window (aligned by bucket index), a dashed AVERAGE reference line,
 * and a marker on the best bucket.
 */
@Component({
  selector: 'app-revenue-trend-card',
  standalone: true,
  imports: [CommonModule, CardComponent, BaseChartDirective],
  template: `
    <app-dn-card class="block">
      <div class="p-4 sm:p-5">
        <div class="flex items-center justify-between gap-3 mb-1">
          <h2 class="text-base font-semibold text-gray-900">Revenue trend</h2>
          <div class="flex items-center gap-3 text-xs text-gray-500">
            <span class="inline-flex items-center gap-1"><span class="w-3 h-0.5 rounded" [style.background]="brand"></span>This period</span>
            @if (compareEnabled && comparisonPoints.length) {
              <span class="inline-flex items-center gap-1"><span class="w-3 border-t border-dashed border-gray-400"></span>{{ comparisonLabel }}</span>
            }
          </div>
        </div>

        @if (points.length) {
          <div class="h-56 sm:h-72">
            <canvas
              baseChart
              [type]="'line'"
              [data]="data"
              [options]="options"
              role="img"
              aria-label="Revenue over the selected period"
            ></canvas>
          </div>
        } @else {
          <p class="text-sm text-gray-500 py-10 text-center">No revenue to chart for this period.</p>
        }
      </div>
    </app-dn-card>
  `,
})
export class RevenueTrendCardComponent implements OnChanges, OnInit {
  @Input() points: SalesPoint[] = [];
  @Input() comparisonPoints: SalesPoint[] = [];
  @Input() comparisonLabel = 'Previous period';
  /** When false, the dashed comparison "ghost" line + its legend are hidden. */
  @Input() compareEnabled = true;

  readonly brand = BRAND;
  data: ChartData<'line'> = { labels: [], datasets: [] };
  options!: ChartOptions<'line'>;

  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  ngOnInit(): void {
    this.options = this.buildOptions();
  }

  ngOnChanges(): void {
    const labels = this.points.map((p) => p.label);
    const main = this.points.map((p) => p.revenue);
    // Compare off → empty ghost series so the dashed comparison line draws nothing.
    const ghost = (this.compareEnabled ? this.comparisonPoints : []).map((p) => p.revenue);
    const avg = main.length ? main.reduce((a, b) => a + b, 0) / main.length : 0;

    const best = bestPoint(this.points);
    const bestIdx = best ? this.points.findIndex((p) => p.key === best.key) : -1;
    const pointRadius = this.points.map((_, i) => (i === bestIdx ? 5 : 0));
    const pointColor = this.points.map((_, i) => (i === bestIdx ? BEST : BRAND));

    const gradient = (ctx: { chart: { ctx: CanvasRenderingContext2D; chartArea?: { top: number; bottom: number } } }) => {
      const area = ctx.chart.chartArea;
      if (!area) return 'hsla(142, 76%, 36%, 0)';
      const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
      g.addColorStop(0, 'hsla(142, 76%, 36%, 0.25)');
      g.addColorStop(1, 'hsla(142, 76%, 36%, 0)');
      return g;
    };

    this.data = {
      labels,
      datasets: [
        {
          label: 'Average',
          data: labels.map(() => avg),
          borderColor: resolveHsl(this.host.nativeElement, '--muted-foreground', 'hsl(0 0% 38%)'),
          borderWidth: 1,
          borderDash: [3, 3],
          pointRadius: 0,
          fill: false,
          tension: 0,
        },
        {
          label: this.comparisonLabel,
          data: ghost,
          borderColor: resolveHsl(this.host.nativeElement, '--muted-foreground', 'hsl(0 0% 38%)'),
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
          tension: 0.4,
        },
        {
          label: 'Revenue',
          data: main,
          borderColor: BRAND,
          borderWidth: 2,
          backgroundColor: gradient as unknown as string,
          fill: true,
          tension: 0.4,
          pointRadius,
          pointBackgroundColor: pointColor,
          pointHoverRadius: 5,
        },
      ],
    };
  }

  private buildOptions(): ChartOptions<'line'> {
    const tt = chartTooltipTheme(this.host.nativeElement);
    const muted = chartMutedColor(this.host.nativeElement);
    return {
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
            label: (item: TooltipItem<'line'>) => `${item.dataset.label}: ${formatUGX(Number(item.raw) || 0)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: true, color: 'rgba(0, 0, 0, 0.06)', tickBorderDash: [3, 3] },
          ticks: { color: muted, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
        },
        y: {
          beginAtZero: true,
          grid: { display: true, color: 'rgba(0, 0, 0, 0.06)', tickBorderDash: [3, 3] },
          ticks: { color: muted, font: { size: 10 }, maxTicksLimit: 6 },
        },
      },
      interaction: { mode: 'index', intersect: false },
    };
  }
}
