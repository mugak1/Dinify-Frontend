import { ChangeDetectionStrategy, Component, ElementRef, Input, OnChanges, OnInit, inject } from '@angular/core';

import { BaseChartDirective } from 'ng2-charts';
import { ChartData, ChartOptions, TooltipItem } from 'chart.js';
import { CardComponent } from '../../../_shared/ui/card/card.component';
import { formatUGX } from '../../../_shared/utils/price-utils';
import { ComparisonOption, ReportBucketUnit, pairingFor } from '../../../_shared/timeframe';
import {
  SalesPoint,
  alignComparisonSeries,
  bestPoint,
  pointDateLabel,
  tradingBuckets,
} from './sales-view';
import { chartMutedColor, chartTooltipTheme, resolveHsl } from 'src/app/_common/utils/chart-theme-utils';

const BRAND = 'hsl(142, 76%, 36%)'; // dashboard revenue-chart green
const BEST = 'hsl(142, 71%, 45%)';

/**
 * Revenue trend (bucket-driven, line). The x-axis IS the bucket — it redraws
 * hourly / daily / monthly as the timeframe changes. Shaped CLIENT-SIDE from the
 * normalized series (no result=graph call). Overlays: a dashed GHOST of the
 * comparison window and a marker on the best bucket.
 *
 * HOW THE GHOST LINES UP is the user's choice at month level (02C): `by-date` is index
 * pairing, `by-day` shifts the lookup so weekdays meet. The alignment itself lives in
 * `alignComparisonSeries`; this card only routes `pairingFor(basis)` into it and keeps the
 * result for the tooltip. The x-axis ALWAYS shows the primary range's own dates — the
 * comparison LOOKUP shifts, the axis never does.
 * The daily average is surfaced as a "Daily avg" stat chip in the card header
 * (it is no longer drawn as a chart line).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-revenue-trend-card',
  standalone: true,
  imports: [CardComponent, BaseChartDirective],
  template: `
    <app-dn-card class="block">
      <div class="p-4 sm:p-6">
        <div class="flex items-center justify-between gap-3 mb-1">
          <h2 class="text-card-title text-foreground">Revenue trend</h2>
          <div class="flex flex-col items-end gap-1">
            @if (hasTrade) {
              <span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-500">
                <span class="w-3 border-t border-dotted border-gray-400"></span>
                Daily avg
                <span class="text-gray-900 font-semibold">{{ dailyAvgLabel }}</span>
              </span>
            }
            <div class="flex items-center gap-3 text-xs text-gray-500">
              <span class="inline-flex items-center gap-1"><span class="w-3 h-0.5 rounded" [style.background]="brand"></span>This period</span>
              <!-- .length, NOT hasTrade — deliberate. The host passes an empty array only when
                   NO comparison was fetched, so length here means "is there a comparison at
                   all". A window that WAS fetched and genuinely earned nothing should show its
                   legend and its flat-zero ghost: that is true, and it is information. -->
              @if (compareEnabled && comparisonPoints.length) {
                <span class="inline-flex items-center gap-1"><span class="w-3 border-t border-dashed border-gray-400"></span>{{ comparisonLabel }}</span>
              }
            </div>
          </div>
        </div>

        @if (hasTrade) {
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
  /** The selected basis. The card reads only `pairingFor(basis)` off it. */
  @Input() basis: ComparisonOption = 'none';
  /** Resolved bucket — pairing applies to `day` only; see `alignComparisonSeries`. */
  @Input() bucketUnit: ReportBucketUnit = 'day';

  readonly brand = BRAND;
  /** Daily average, formatted as millions for the header chip (e.g. "UGX 2.93M"). */
  dailyAvgLabel = 'UGX 0.00M';

  /**
   * Is there anything worth charting? Not `points.length` — since densification a dead window
   * arrives as a full run of zero points, so length only tells you the window exists. Gating on
   * it would replace "No revenue to chart for this period." with a flat line along the axis.
   */
  get hasTrade(): boolean {
    return tradingBuckets(this.points) > 0;
  }
  data: ChartData<'line'> = { labels: [], datasets: [] };
  options!: ChartOptions<'line'>;

  /**
   * The comparison point rendered at each primary index, `null` where there is none.
   * Held on the instance because `ghost` reduces to a bare `number[]` and the tooltip
   * still needs the comparison DATE — the same closure-over-the-series pattern the
   * dashboard revenue card uses.
   */
  private aligned: (SalesPoint | null)[] = [];

  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  ngOnInit(): void {
    this.options = this.buildOptions();
  }

  ngOnChanges(): void {
    const labels = this.points.map((p) => p.label);
    const main = this.points.map((p) => p.revenue);
    // Compare off → empty ghost series so the dashed comparison line draws nothing.
    this.aligned = this.compareEnabled
      ? alignComparisonSeries(
          this.points,
          this.comparisonPoints,
          pairingFor(this.basis),
          this.bucketUnit,
        )
      : [];
    // `null` where the pairing offset runs past the end of the comparison series —
    // Chart.js draws a gap there, which is honest where a fabricated point is not.
    const ghost = this.aligned.map((p) => p?.revenue ?? null);
    // Divide by buckets that TRADED, not by buckets in the window. `main.length` used to mean
    // the former only because the series was sparse; once densified it would silently mean the
    // latter and drop this figure on every range containing a closed day. `tradingBuckets`
    // states the predicate so the number survives densification unchanged.
    const traded = tradingBuckets(this.points);
    const avg = traded ? main.reduce((a, b) => a + b, 0) / traded : 0;
    this.dailyAvgLabel = 'UGX ' + (avg / 1e6).toFixed(2) + 'M';

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

  /**
   * Tooltip callbacks, built once but reading `this` live so they follow each redraw.
   *
   * NAMING BOTH DATES IS LOAD-BEARING, not polish. Under `by-day` a point's comparison
   * value no longer comes from the same date number, so without it the user sees two lines
   * and has no way to learn what the grey one is aligned to. Before 02C there was only a
   * `label` callback and no `title` at all, so nothing named any date.
   */
  private tooltipCallbacks() {
    return {
      title: (items: TooltipItem<'line'>[]) => {
        const p = this.points[items[0]?.dataIndex ?? -1];
        return p ? pointDateLabel(p, this.bucketUnit) : '';
      },
      label: (item: TooltipItem<'line'>) => {
        const value = formatUGX(Number(item.raw) || 0);
        // Dataset 0 is the ghost (see the datasets array); only it carries a second date.
        if (item.datasetIndex !== 0) return `${item.dataset.label}: ${value}`;
        const cmp = this.aligned[item.dataIndex];
        if (!cmp) return '';
        return `${item.dataset.label}: ${value} · ${pointDateLabel(cmp, this.bucketUnit)}`;
      },
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
          callbacks: this.tooltipCallbacks(),
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
