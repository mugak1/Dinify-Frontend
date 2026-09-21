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
import {
  MEASUREMENT_WITHHELD,
  PaymentMeasurement,
  comparisonIsSupported,
  measurementIsSupported,
  measurementNotice,
  measurementWithheldLabel,
} from 'src/app/_shared/reporting/payment-measurement';

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
                <!-- THE HEADLINE IS A MEASUREMENT OR IT IS NOTHING (D07/G1).
                Net derives from Gross and Discounts, both aggregated over
                settled payments. Where settlement is not measured the figure is
                REPLACED, not footnoted: a number in success green is read as
                takings whatever is printed beneath it, and the previous form
                rendered "-5,000" under a note explaining why it was meaningless.
                The em dash carries no meaning to a screen reader, so the state
                travels in an aria-label beside it. -->
                @if (measured) {
                  <app-animated-number
                    class="text-2xl sm:text-3xl font-bold text-success"
                    [value]="revenueData.totals.net"
                    [duration]="2000"
                    [formatFn]="currencyFormatter"
                  ></app-animated-number>
                } @else {
                  <span
                    data-testid="revenue-headline-withheld"
                    class="text-2xl sm:text-3xl font-bold text-muted-foreground"
                    [attr.aria-label]="withheldLabel"
                  >{{ withheld }}</span>
                }

                <!-- Trend badge + comparison caption. The caption is a SIBLING of the
                badge, never a child: with no usable baseline the badge is replaced by a
                "New" chip and the caption has to survive to name what was compared
                against. Wrapping lets it drop to its own line on a narrow phone. -->
                @if (comparisonWindow) {
                  <div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <!-- A PERCENTAGE NEEDS BOTH WINDOWS MEASURED. The baseline
                    comes from a SECOND dashboard-v2 call that carries its own
                    declaration, so during a rollout the two can disagree; a
                    delta between a measured window and an unmeasured one
                    describes our deployment and reads as the restaurant's
                    trade. Neither the badge NOR the "New" chip is right here —
                    the chip claims there is no history, and nobody established
                    that. The caption also drops its amount: it named a baseline
                    figure drawn from the same unmeasured basis. -->
                    @if (!comparable) {
                      <span
                        data-testid="revenue-comparison-withheld"
                        class="text-xs sm:text-sm text-muted-foreground"
                      >No comparison — {{ comparisonWindowLabel }}</span>
                    } @else if (hasBaseline) {
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
                    @if (comparable) {
                      <span class="text-xs sm:text-sm text-muted-foreground">{{ periodLabel }}</span>
                    }
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

          <!-- Pills row. REFUNDS SURVIVES A WITHHELD CARD and the others do not,
          because the two are measured differently: Refunds aggregates
          order_status=refunded, which is written on every refund, while Gross
          and Discounts aggregate payment_status=paid, which nothing writes. Blanking all four would hide a real measurement; showing all
          four presents two unmeasured figures and one derived from them as
          takings. So each pill states which it is. -->
          <div class="flex flex-wrap gap-1.5 sm:gap-2 mb-4 sm:mb-6">
            @for (pill of pills; track pill.label) {
              <div class="px-2 sm:px-3 py-0.5 sm:py-1 rounded-full bg-muted text-xs sm:text-sm">
                <span class="text-muted-foreground">{{ pill.label }}:</span>
                @if (pill.withheld) {
                  <span
                    class="font-medium text-muted-foreground"
                    [attr.data-testid]="'revenue-pill-withheld-' + pill.label"
                    [attr.aria-label]="withheldLabel"
                  >{{ withheld }}</span>
                } @else {
                  <span class="font-medium" [class]="pill.colorClass">{{ pill.formatted }}</span>
                }
              </div>
            }
          </div>

          <!-- D07/G1. The figures this card is built on are aggregated over
          settled payments, and the server has not established that it records
          them. What the card does about that is WITHHOLD them — the headline,
          the three derived pills, the comparison and the chart — rather than
          print them under an explanation, which is what it used to do and
          which an operator reads straight past.

          NOTHING IS RECOMPUTED, REBASED, SUPPRESSED-AND-REPLACED OR REPRICED.
          No figure is moved onto another queryset, no refund is dropped and no
          negative is clamped; the measured ones (Refunds) are still rendered
          verbatim. Only the claim that the unmeasured ones are measurements is
          withdrawn.

          THE THREE NON-SUPPORTED STATES GET DIFFERENT SENTENCES, from
          measurementNotice — the server saying it does not record settlement,
          the server never saying, and an answer this client could not read are
          three different facts and the copy says which.

          NEUTRAL, not the warning hue the pricing notice below uses. That one
          is window-specific (this period straddles a boundary); this is a
          standing property of the deployment, so an amber alarm on every load
          would devalue the one that really does mean something. -->
          @if (measurementNote) {
            <div
              role="note"
              data-testid="revenue-tracking-note"
              class="-mt-2 mb-4 sm:mb-6 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-caption text-muted-foreground"
            >
              <svg aria-hidden="true" class="w-4 h-4 shrink-0 mt-px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
              </svg>
              <span>{{ measurementNote }}</span>
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

          <!-- Chart. THE PLOTTED SERIES IS net PER BUCKET, derived from the
          same two unmeasured aggregates, so a withheld card draws no chart at
          all — a flat line at zero, or a line dipping below it on a refund,
          is the most persuasive form this untruth takes. buildChart also
          CLEARS the chart state when the decision changes, so a card that was
          measured a moment ago does not keep painting its last series. -->
          @if (measured) {
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
          } @else {
            <div
              data-testid="revenue-chart-withheld"
              class="h-48 sm:h-64 flex items-center justify-center rounded-md border border-dashed border-border text-caption text-muted-foreground px-4 text-center"
            >
              No revenue chart — {{ chartWithheldReason }}
            </div>
          }
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
  /**
   * Whether this platform measures settled payments, for the PRIMARY window
   * (D07/G1). Classified once by the adapter; see
   * `_shared/reporting/payment-measurement.ts` for the four answers.
   */
  @Input() measurement: PaymentMeasurement | null = null;
  /**
   * The same decision for the COMPARISON window, which is a SEPARATE
   * `dashboard-v2` response and carries its own declaration. Both must be
   * supported before a percentage means anything.
   */
  @Input() baselineMeasurement: PaymentMeasurement | null = null;
  @Input() loading = false;
  @Input() error: string | null = null;
  @Output() retry = new EventEmitter<void>();

  chartData: ChartData<'line'> = { labels: [], datasets: [] };
  chartOptions: ChartOptions<'line'> = {};
  pills: { label: string; formatted: string; colorClass: string; withheld: boolean }[] = [];

  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly currencyFormatter = (v: number) => formatCurrency(v);

  readonly withheld = MEASUREMENT_WITHHELD;

  /** Whether the settled-payment figures on this card are measurements. */
  get measured(): boolean {
    return measurementIsSupported(this.measurement);
  }

  /** Accessible name for every withheld figure — the glyph announces nothing. */
  get withheldLabel(): string {
    return measurementWithheldLabel(this.measurement);
  }

  /**
   * The sentence, or `null` when the figures are measurements.
   *
   * It names the WITHHELD subject rather than the card: Refunds is still on
   * screen and still real, so "Revenue can't be shown" would overstate what has
   * been withdrawn.
   */
  get measurementNote(): string | null {
    return measurementNotice(
      this.measurement,
      'Gross, Discounts, Net and the revenue chart',
    );
  }

  /** Short form for the chart placeholder, which has no room for the sentence. */
  get chartWithheldReason(): string {
    switch (this.measurement?.kind) {
      case 'unavailable':
        return 'Dinify doesn\u2019t record settled payments.';
      case 'unusable':
        return 'this server\u2019s answer about payment recording couldn\u2019t be read.';
      default:
        return 'this server didn\u2019t state whether it records settled payments.';
    }
  }

  /**
   * Whether a period-over-period percentage may be computed AT ALL.
   *
   * BOTH windows have to be measured, and the baseline window is a second
   * response — see `comparisonIsSupported`. False suppresses the badge, the
   * "New" chip and the caption's amount together: with nothing measurable on
   * either side there is no delta, no absence of history to report, and no
   * baseline figure to name.
   */
  get comparable(): boolean {
    return comparisonIsSupported(this.measurement, this.baselineMeasurement);
  }

  /** The compared window's dates, with no amount — used when it is not comparable. */
  get comparisonWindowLabel(): string {
    if (!this.comparisonWindow) return '';
    return baselineCaption(this.comparisonWindow, '').replace(/^vs\.\s*/, '').trim();
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
    // NOT MERELY HIDDEN — NOT COMPUTED. The template already withholds the
    // badge, and this is the second half of the same decision: a percentage
    // between two unmeasured nets is a number, and a number that exists gets
    // read, exported and asserted on eventually.
    if (!this.comparable) return null;
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
    // `measurement` JOINS THE TRIGGER LIST, and that is the "clear chart state
    // on capability change" requirement: without it a card that rendered a
    // series while the decision was `supported` keeps the built `chartData`
    // when the next response withholds, and the moment anything re-renders the
    // canvas the old series is back.
    if (
      (changes['revenueData'] || changes['bucketUnit'] || changes['range'] || changes['measurement'])
      && this.revenueData
    ) {
      this.buildPills();
      this.buildChart();
    }
  }

  private buildPills(): void {
    if (!this.revenueData) return;
    const t = this.revenueData.totals;
    const unmeasured = !this.measured;
    this.pills = [
      { label: 'Gross', formatted: formatCurrency(t.gross), colorClass: 'text-foreground', withheld: unmeasured },
      { label: 'Discounts', formatted: formatCurrency(t.discounts), colorClass: 'text-warning', withheld: unmeasured },
      // Refunds is NOT paid-gated, so it stays a measurement either way.
      { label: 'Refunds', formatted: formatCurrency(t.refunds), colorClass: 'text-destructive', withheld: false },
      { label: 'Net', formatted: formatCurrency(t.net), colorClass: 'text-success', withheld: unmeasured },
    ];
  }

  private buildChart(): void {
    if (!this.revenueData) return;

    // A WITHHELD CARD HOLDS NO SERIES. Clearing rather than skipping is the
    // point: skipping would leave the previously built datasets in place.
    if (!this.measured) {
      this.chartData = { labels: [], datasets: [] };
      this.chartOptions = {};
      return;
    }

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
