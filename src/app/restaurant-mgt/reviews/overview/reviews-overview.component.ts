import { Component, ElementRef, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { switchMap, tap, takeUntil, catchError } from 'rxjs/operators';
import { CardComponent } from '../../../_shared/ui/card/card.component';
import { PageHeaderComponent } from '../../../_shared/ui/page-header/page-header.component';
import { CardErrorComponent } from '../../dashboard/components/card-error/card-error.component';
import { AuthenticationService } from '../../../_services/authentication.service';
import { ReviewsService } from '../services/reviews.service';
import { ReviewsAnalytics } from '../models/reviews.models';
import { BaseChartDirective } from 'ng2-charts';
import { ChartData, ChartOptions } from 'chart.js';
import { chartMutedColor, chartTooltipTheme } from 'src/app/_common/utils/chart-theme-utils';

type TimeframeDays = 30 | 90;

/**
 * Reviews Overview — the analytics landing for /rest-app/reviews. Layout B
 * (action-first): summary line → needs-attention block → dimension hero →
 * demoted metrics strip → rating-trend line chart (fed by the adapter-parsed
 * `trend`).
 */
@Component({
  selector: 'app-reviews-overview',
  standalone: true,
  imports: [CommonModule, RouterModule, PageHeaderComponent, CardComponent, CardErrorComponent, BaseChartDirective],
  template: `
    <div class="space-y-4 sm:space-y-6">
      <!-- Header + timeframe toggle (always visible) -->
      <app-page-header title="Reviews">
        <!-- Persistent feed entry + timeframe toggle, grouped on the right -->
        <div actions class="flex items-center gap-3 self-start">
          <div class="inline-flex items-center gap-1 p-1 rounded-lg bg-muted/60">
            @for (days of timeframeOptions; track days) {
              <button
                type="button"
                (click)="setTimeframe(days)"
                class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
                [class.bg-primary/10]="timeframeDays === days"
                [class.text-primary]="timeframeDays === days"
                [class.text-muted-foreground]="timeframeDays !== days"
              >
                {{ days }} days
              </button>
            }
          </div>
          <!-- Primary-action slot: solid brand-red CTA to the full reviews feed -->
          <a
            routerLink="/rest-app/reviews/feed"
            class="inline-flex items-center gap-2 h-[42px] px-5 rounded-md bg-d-red text-white text-[15px] font-semibold whitespace-nowrap shadow-[0_1px_2px_rgba(255,44,50,0.28),0_8px_20px_-8px_rgba(255,44,50,0.5)] transition-[background-color,box-shadow,transform] duration-200 desktop-hover:bg-d-red-hover desktop-hover:-translate-y-px motion-safe:active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-d-red focus-visible:ring-offset-2"
          >
            View all reviews
            <svg
              aria-hidden="true"
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </a>
        </div>
      </app-page-header>

      @if (loading) {
        <!-- Skeleton (shaped to the layout: summary, 5 dimension rows, strip) -->
        <app-dn-card>
          <div class="p-4 sm:p-6 space-y-6">
            <div class="h-5 w-64 max-w-full bg-muted rounded animate-pulse"></div>
            <div class="space-y-4">
              @for (i of skeletonRows; track i) {
                <div class="flex items-center gap-3 sm:gap-4">
                  <div class="h-4 w-20 sm:w-24 bg-muted rounded animate-pulse shrink-0"></div>
                  <div class="flex-1 h-3 bg-muted rounded-full animate-pulse"></div>
                  <div class="h-4 w-24 sm:w-28 bg-muted rounded animate-pulse shrink-0"></div>
                </div>
              }
            </div>
            <div class="grid grid-cols-3 gap-3 sm:gap-4">
              @for (j of [1, 2, 3]; track j) {
                <div class="h-16 bg-muted rounded-lg animate-pulse"></div>
              }
            </div>
          </div>
        </app-dn-card>
      } @else if (error) {
        <app-card-error title="Reviews" [message]="error" (retry)="retry()"></app-card-error>
      } @else if (!analytics || analytics.totalReviews === 0) {
        <!-- Friendly empty state -->
        <app-dn-card>
          <div class="flex flex-col items-center justify-center text-center min-h-[240px] p-6">
            <svg
              aria-hidden="true"
              class="w-10 h-10 text-muted-foreground/40 mb-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polygon
                points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
              />
            </svg>
            <h2 class="text-base font-semibold text-foreground mb-1">No reviews yet for this period</h2>
            <p class="text-sm text-muted-foreground max-w-sm">
              Try widening the timeframe, or check back once diners start leaving feedback.
            </p>
          </div>
        </app-dn-card>
      } @else {
        <!-- 1. Plain-language summary -->
        <p class="text-sm sm:text-base text-muted-foreground">
          <span class="font-semibold text-foreground">{{ analytics.totalReviews }}</span>
          {{ analytics.totalReviews === 1 ? 'review' : 'reviews' }} · averaging
          <span class="font-semibold text-foreground"
            >{{ analytics.averageRating | number: '1.1-1' }}★</span
          >
          this period.
        </p>

        <!-- 2. Needs-attention block (adaptive — hidden when nothing to flag) -->
        @if (analytics.unresolvedCriticalCount > 0) {
          <div class="rounded-xl bg-warning/10 border border-warning/20 p-4 sm:p-5">
            <div class="flex items-start gap-3">
              <svg
                aria-hidden="true"
                class="w-5 h-5 text-warning shrink-0 mt-0.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <line x1="12" x2="12" y1="9" y2="13" />
                <line x1="12" x2="12.01" y1="17" y2="17" />
              </svg>
              <div class="min-w-0 flex-1">
                <h2 class="text-sm font-semibold text-foreground mb-1">Needs attention</h2>
                <ul class="space-y-0.5 text-sm text-muted-foreground">
                  @if (analytics.weakestDimension) {
                    <li>
                      <span class="font-medium text-foreground">{{ analytics.weakestDimension.label }}</span>
                      is the weak spot · {{ analytics.weakestDimension.average | number: '1.1-1' }}★
                    </li>
                  }
                  @if (analytics.unresolvedCriticalCount > 0) {
                    <li>
                      <span class="font-medium text-foreground">{{ analytics.unresolvedCriticalCount }}</span>
                      {{ analytics.unresolvedCriticalCount === 1 ? 'review needs' : 'reviews need' }} attention
                    </li>
                  }
                </ul>
                <a
                  routerLink="/rest-app/reviews/feed"
                  [queryParams]="{ view: 'attention' }"
                  class="inline-flex items-center gap-1 mt-2 text-sm font-medium text-primary hover:text-primary/80"
                >
                  View flagged reviews <span aria-hidden="true">→</span>
                </a>
              </div>
            </div>
          </div>
        }

        <!-- 3. Dimension-breakdown hero (centerpiece) -->
        <app-dn-card>
          <div class="p-4 sm:p-6">
            <h2 class="text-card-title text-foreground mb-1">How diners rate you</h2>
            <p class="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6">
              Average score per dimension, out of 5.
            </p>
            <div class="space-y-4 sm:space-y-5">
              @for (dim of analytics.dimensions; track dim.key) {
                <div class="flex items-center gap-3 sm:gap-4">
                  <span class="w-20 sm:w-24 shrink-0 text-sm font-medium text-foreground">{{ dim.label }}</span>
                  <div class="flex-1 min-w-0 h-3 sm:h-3.5 bg-muted rounded-full overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all"
                      [class]="barColor(dim.average)"
                      [style.width.%]="barWidth(dim.average)"
                    ></div>
                  </div>
                  <span class="w-28 sm:w-32 shrink-0 text-right text-sm">
                    @if (dim.average != null) {
                      <span class="font-semibold text-foreground tabular-nums"
                        >{{ dim.average | number: '1.1-1' }}★</span
                      >
                      <span class="text-muted-foreground"> · {{ dim.count }}</span>
                    } @else {
                      <span class="text-muted-foreground italic">Not enough data</span>
                    }
                  </span>
                </div>
              }
            </div>
          </div>
        </app-dn-card>

        <!-- 4. Demoted metrics strip (health read) -->
        <div class="grid grid-cols-3 gap-3 sm:gap-4">
          <div class="rounded-lg bg-muted/40 p-3 sm:p-4 text-center">
            <div class="text-base sm:text-lg font-bold text-foreground tabular-nums">
              {{ analytics.averageRating | number: '1.1-1' }}★
            </div>
            <div class="text-[11px] sm:text-xs text-muted-foreground mt-0.5">Average rating</div>
          </div>
          <div class="rounded-lg bg-muted/40 p-3 sm:p-4 text-center">
            <div class="text-base sm:text-lg font-bold text-foreground tabular-nums">
              {{ analytics.totalReviews }}
            </div>
            <div class="text-[11px] sm:text-xs text-muted-foreground mt-0.5">Total reviews</div>
          </div>
          <div class="rounded-lg bg-muted/40 p-3 sm:p-4 text-center">
            <div class="text-base sm:text-lg font-bold text-foreground tabular-nums">
              {{ criticalSharePct | number: '1.0-0' }}%
            </div>
            <div class="text-[11px] sm:text-xs text-muted-foreground mt-0.5">Critical share</div>
          </div>
        </div>

        <!-- 5. Rating trend (deepest health read) -->
        <app-dn-card>
          <div class="p-4 sm:p-6">
            <h2 class="text-card-title text-foreground mb-1">Rating trend</h2>
            @if (analytics.trend.length >= 2) {
              <div class="h-48 sm:h-64 mt-3 sm:mt-4">
                <canvas
                  baseChart
                  [type]="'line'"
                  [data]="chartData"
                  [options]="chartOptions"
                  role="img"
                  aria-label="Average rating over time"
                ></canvas>
              </div>
            } @else {
              <p class="text-sm text-muted-foreground mt-1">Not enough data yet to show a trend</p>
            }
          </div>
        </app-dn-card>
      }
    </div>
  `,
})
export class ReviewsOverviewComponent implements OnInit, OnDestroy {
  analytics: ReviewsAnalytics | null = null;
  loading = true;
  error: string | null = null;
  timeframeDays: TimeframeDays = 90;

  readonly timeframeOptions: TimeframeDays[] = [30, 90];
  readonly skeletonRows = [1, 2, 3, 4, 5];

  chartData: ChartData<'line'> = { labels: [], datasets: [] };

  chartOptions!: ChartOptions<'line'>;

  private restaurantId = '';
  private timeframe$ = new BehaviorSubject<TimeframeDays>(90);
  private destroy$ = new Subject<void>();
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor(
    private reviewsService: ReviewsService,
    private auth: AuthenticationService,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.chartOptions = this.buildChartOptions();

    this.restaurantId =
      this.auth.currentRestaurantRole?.restaurant_id ||
      this.route.parent?.snapshot.params['id'] ||
      '';

    this.timeframe$
      .pipe(
        takeUntil(this.destroy$),
        tap(() => {
          this.loading = true;
          this.error = null;
        }),
        switchMap((days) => {
          const { from, to } = this.computeRange(days);
          return this.reviewsService
            .getAnalytics(this.restaurantId, from, to)
            .pipe(catchError((err) => of({ data: null, error: err })));
        }),
      )
      .subscribe((res: any) => {
        this.loading = false;
        if (res.data) {
          this.analytics = res.data;
          this.buildTrendChart();
        } else {
          this.error = res.error?.message || 'Failed to load reviews analytics';
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setTimeframe(days: TimeframeDays): void {
    if (days === this.timeframeDays) return;
    this.timeframeDays = days;
    this.timeframe$.next(days);
  }

  retry(): void {
    this.timeframe$.next(this.timeframeDays);
  }

  /** Canvas-safe tooltip/axis colors resolved from the themed host element. */
  private buildChartOptions(): ChartOptions<'line'> {
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
            title: (items) => (items.length ? items[0].label || '' : ''),
            label: (item) => {
              const point = this.analytics?.trend?.[item.dataIndex];
              if (!point) return '';
              const n = point.count;
              return `${point.average.toFixed(1)}★ · ${n} ${n === 1 ? 'review' : 'reviews'}`;
            },
          },
        },
      },
      scales: {
        x: {
          display: true,
          grid: { display: true, color: 'rgba(0, 0, 0, 0.06)', tickBorderDash: [3, 3] },
          ticks: {
            color: muted,
            font: { size: 10 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
          },
        },
        y: {
          min: 0,
          max: 5,
          grid: { display: true, color: 'rgba(0, 0, 0, 0.06)', tickBorderDash: [3, 3] },
          ticks: { color: muted, font: { size: 10 }, stepSize: 1 },
        },
      },
      interaction: { mode: 'index', intersect: false },
    };
  }

  /** Build the rating-trend line chart from the adapter-parsed analytics.trend. */
  buildTrendChart(): void {
    const trend = this.analytics?.trend ?? [];

    // Subtle brand-red gradient fill, mirroring the dashboard revenue card.
    const gradientBg = (ctx: any) => {
      const { ctx: canvasCtx, chartArea } = ctx.chart;
      if (!chartArea) return 'hsla(4, 90%, 52%, 0)';
      const g = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      g.addColorStop(0, 'hsla(4, 90%, 52%, 0.25)');
      g.addColorStop(1, 'hsla(4, 90%, 52%, 0)');
      return g;
    };

    this.chartData = {
      labels: trend.map((p) => this.formatTrendLabel(p.period)),
      datasets: [
        {
          data: trend.map((p) => p.average),
          fill: true,
          tension: 0.4,
          borderColor: 'hsl(4, 90%, 52%)',
          borderWidth: 2,
          backgroundColor: gradientBg as any,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: 'hsl(4, 90%, 52%)',
        },
      ],
    };
  }

  /** Critical reviews as a share of total, guarded against divide-by-zero. */
  get criticalSharePct(): number {
    const total = this.analytics?.totalReviews ?? 0;
    if (total <= 0) return 0;
    return ((this.analytics?.criticalCount ?? 0) / total) * 100;
  }

  /** Bar fill colour by dimension score (out of 5). */
  barColor(average: number | null): string {
    if (average == null) return 'bg-muted';
    if (average >= 4) return 'bg-success';
    if (average >= 3) return 'bg-warning';
    return 'bg-destructive';
  }

  /** Bar width as a percentage of the 0–5 scale. */
  barWidth(average: number | null): number {
    if (average == null) return 0;
    return (average / 5) * 100;
  }

  private computeRange(days: number): { from: string; to: string } {
    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - days);
    return { from: this.formatDate(fromDate), to: this.formatDate(today) };
  }

  private formatDate(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /** Format an ISO period (week/day start) as a short "4 May" label, in UTC to avoid date drift. */
  private formatTrendLabel(period: string): string {
    if (!period) return '';
    const d = new Date(period);
    if (isNaN(d.getTime())) return period;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
}
