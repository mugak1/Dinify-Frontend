import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../../../_shared/ui/card/card.component';
import { CardSkeletonComponent } from '../card-skeleton/card-skeleton.component';
import { CardErrorComponent } from '../card-error/card-error.component';
import { AnimatedNumberComponent } from '../animated-number/animated-number.component';
import { ReviewsSummaryResponse, ReviewDistribution, RecentReview } from '../../models/dashboard.models';

type Sentiment = 'positive' | 'neutral' | 'negative';

@Component({
  selector: 'app-reviews-card',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    CardComponent,
    CardSkeletonComponent,
    CardErrorComponent,
    AnimatedNumberComponent,
  ],
  template: `
    @if (loading) {
      <app-card-skeleton variant="wide"></app-card-skeleton>
    } @else if (error) {
      <app-card-error title="Reviews" [message]="error" (retry)="retry.emit()"></app-card-error>
    } @else if (!reviewsData) {
      <app-dn-card>
        <div class="p-4 sm:p-5 lg:p-6">
          <h2 class="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">Guest Reviews</h2>
          <hr class="border-border mb-4" />
          <p class="text-sm text-muted-foreground text-center py-8">No review data available</p>
        </div>
      </app-dn-card>
    } @else {
      <app-dn-card>
        <div class="p-4 sm:p-5 lg:p-6">
          <!-- Section 1: Header -->
          <div class="flex items-center justify-between mb-3 sm:mb-4">
            <h2 class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Guest Reviews
            </h2>
            <a
              routerLink="/reviews"
              class="text-xs sm:text-sm text-primary hover:text-primary/80 font-medium flex items-center gap-1"
            >
              View all <span aria-hidden="true">→</span>
            </a>
          </div>

          <!-- Section 2: Score + Distribution -->
          <div class="flex gap-4 sm:gap-8 mb-3 sm:mb-4">
            <!-- Left side - Big Score -->
            <div class="shrink-0">
              <app-animated-number
                [value]="reviewsData.avg_rating"
                [duration]="2000"
                [decimals]="1"
                class="text-3xl sm:text-5xl font-bold text-foreground leading-none mb-1 block"
              ></app-animated-number>
              <div class="flex gap-0.5 mb-1">
                @for (star of stars; track star) {
                  <svg
                    aria-hidden="true"
                    class="w-3 h-3 sm:w-4 sm:h-4"
                    [class.fill-warning]="star <= roundedRating"
                    [class.text-warning]="star <= roundedRating"
                    [class.text-muted-foreground/30]="star > roundedRating"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                }
              </div>
              <div class="text-[10px] sm:text-xs text-muted-foreground">
                <app-animated-number
                  [value]="reviewsData.total_reviews"
                  [duration]="2000"
                  suffix=" reviews"
                ></app-animated-number>
              </div>
            </div>

            <!-- Right side - Distribution Bars -->
            <div class="flex-1 space-y-1 sm:space-y-1.5 min-w-0">
              @for (row of sortedDistribution; track row.rating) {
                <div class="flex items-center gap-1.5 sm:gap-2">
                  <span class="text-[10px] sm:text-xs text-muted-foreground w-5 sm:w-6 text-right shrink-0">
                    {{ row.rating }}★
                  </span>
                  <div class="flex-1 h-2.5 sm:h-3 bg-muted rounded-full overflow-hidden min-w-0">
                    <div
                      class="h-full rounded-full transition-all"
                      [class]="getBarColor(row.rating)"
                      [style.width.%]="row.percentage"
                    ></div>
                  </div>
                  <span class="text-[10px] sm:text-xs text-muted-foreground w-5 sm:w-6 shrink-0 text-right tabular-nums">
                    {{ row.count }}
                  </span>
                </div>
              }
            </div>
          </div>

          <!-- Section 3: Recent Reviews -->
          @if (recentReviews.length > 0) {
            <div class="border-t border-border pt-3 sm:pt-4 space-y-2">
              @for (review of recentReviews; track review.review_id) {
                <div
                  class="p-2 sm:p-3 rounded-xl border"
                  [class.bg-success/5]="getSentiment(review.rating) === 'positive'"
                  [class.border-success/20]="getSentiment(review.rating) === 'positive'"
                  [class.bg-destructive/5]="getSentiment(review.rating) === 'negative'"
                  [class.border-destructive/20]="getSentiment(review.rating) === 'negative'"
                  [class.bg-warning/5]="getSentiment(review.rating) === 'neutral'"
                  [class.border-warning/20]="getSentiment(review.rating) === 'neutral'"
                >
                  <div class="flex items-center justify-between mb-1">
                    <div class="flex gap-0.5">
                      @for (star of stars; track star) {
                        <svg
                          aria-hidden="true"
                          class="w-2.5 h-2.5 sm:w-3 sm:h-3"
                          [class]="star <= review.rating ? getStarFillClass(review.rating) : 'text-muted-foreground/30'"
                          viewBox="0 0 24 24"
                          [attr.fill]="star <= review.rating ? 'currentColor' : 'none'"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                      }
                    </div>
                    <span class="text-[10px] sm:text-xs text-muted-foreground">
                      {{ formatTimeAgo(review.created_at) }}
                    </span>
                  </div>
                  <p class="text-xs sm:text-sm text-muted-foreground line-clamp-1">
                    {{ review.text }}
                  </p>
                </div>
              }
            </div>
          }

          <!-- Section 4: Warning Banner -->
          @if (lowRatingPct > 5) {
            <div class="mt-3 sm:mt-4 p-2 sm:p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-center">
              <span class="text-destructive font-bold text-sm sm:text-base">{{ lowRatingPct.toFixed(1) }}%</span>
              <span class="text-xs sm:text-sm text-muted-foreground ml-1">
                of reviews are 1-2 stars this month
              </span>
            </div>
          }
        </div>
      </app-dn-card>
    }
  `,
})
export class ReviewsCardComponent {
  @Input() reviewsData: ReviewsSummaryResponse | null = null;
  @Input() loading = false;
  @Input() error: string | null = null;
  @Output() retry = new EventEmitter<void>();

  readonly stars = [1, 2, 3, 4, 5];

  get roundedRating(): number {
    return Math.round(this.reviewsData?.avg_rating ?? 0);
  }

  get sortedDistribution(): ReviewDistribution[] {
    if (!this.reviewsData?.distribution) return [];
    return [...this.reviewsData.distribution].sort((a, b) => b.rating - a.rating);
  }

  get recentReviews(): RecentReview[] {
    return (this.reviewsData?.recent ?? []).slice(0, 2);
  }

  get lowRatingPct(): number {
    if (this.reviewsData?.low_rating_share != null) {
      return this.reviewsData.low_rating_share;
    }
    if (!this.reviewsData?.distribution) return 0;
    return this.reviewsData.distribution
      .filter((d) => d.rating <= 2)
      .reduce((sum, d) => sum + d.percentage, 0);
  }

  getBarColor(stars: number): string {
    if (stars >= 4) return 'bg-success';
    if (stars === 3) return 'bg-warning';
    return 'bg-destructive';
  }

  getSentiment(rating: number): Sentiment {
    if (rating >= 4) return 'positive';
    if (rating <= 2) return 'negative';
    return 'neutral';
  }

  getStarFillClass(rating: number): string {
    const sentiment = this.getSentiment(rating);
    switch (sentiment) {
      case 'positive': return 'fill-success text-success';
      case 'negative': return 'fill-destructive text-destructive';
      default: return 'fill-warning text-warning';
    }
  }

  formatTimeAgo(dateStr: string): string {
    const date = new Date(dateStr);
    const hours = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60));
    if (hours < 1) return 'Just now';
    if (hours === 1) return '1h ago';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return '1d ago';
    return `${days}d ago`;
  }
}
