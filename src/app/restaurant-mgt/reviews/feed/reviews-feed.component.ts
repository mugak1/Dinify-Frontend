import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { switchMap, tap, takeUntil, map, catchError } from 'rxjs/operators';
import { CardComponent } from '../../../_shared/ui/card/card.component';
import { CardErrorComponent } from '../../dashboard/components/card-error/card-error.component';
import { BadgeComponent } from '../../../_shared/ui/badge/badge.component';
import { AuthenticationService } from '../../../_services/authentication.service';
import { ReviewsService, ReviewFeedFilters } from '../services/reviews.service';
import { ReviewListItem } from '../models/reviews.models';
import { formatUGX } from '../../../_shared/utils/price-utils';

type FeedView = 'all' | 'attention';
type ResolutionFilter = 'open' | 'resolved' | null;

/**
 * Reviews Feed — the browse/queue surface at /rest-app/reviews/feed. Read-only
 * list of real reviews (the `reviews/` endpoint) with a prominent
 * "needs attention" queue (critical + open). Sentiment treatment (sentiment by
 * rating) mirrors the dashboard reviews-card. The resolve action is a follow-up.
 */
@Component({
  selector: 'app-reviews-feed',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CardComponent, CardErrorComponent, BadgeComponent],
  template: `
    <div class="space-y-4 sm:space-y-6">
      <!-- Header -->
      <div>
        <a
          routerLink="/rest-app/reviews"
          class="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back to reviews
        </a>
        <h1 class="text-2xl sm:text-3xl font-bold text-foreground">Reviews feed</h1>
        <p class="text-sm text-muted-foreground mt-1">
          Every guest review, with the ones that need attention up top.
        </p>
      </div>

      <!-- Filter bar (always visible so the user can re-query) -->
      <div class="space-y-3 sm:space-y-4">
        <!-- View: All reviews | Needs attention -->
        <div class="inline-flex items-center gap-1 p-1 rounded-lg bg-muted/60">
          <button
            type="button"
            (click)="setView('all')"
            class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
            [class.bg-primary/10]="view === 'all'"
            [class.text-primary]="view === 'all'"
            [class.text-muted-foreground]="view !== 'all'"
          >
            All reviews
          </button>
          <button
            type="button"
            (click)="setView('attention')"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
            [class.bg-warning/10]="view === 'attention'"
            [class.text-warning]="view === 'attention'"
            [class.text-muted-foreground]="view !== 'attention'"
          >
            <svg
              aria-hidden="true"
              class="w-4 h-4"
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
            Needs attention
          </button>
        </div>

        <!-- Secondary filters -->
        <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
          <!-- Rating -->
          <div class="flex items-center gap-2">
            <span class="text-xs font-medium text-muted-foreground">Rating</span>
            <div class="inline-flex items-center gap-1 p-1 rounded-lg bg-muted/60">
              <button
                type="button"
                (click)="setRating(null)"
                class="px-2.5 py-1 text-sm font-medium rounded-md transition-colors"
                [class.bg-primary/10]="rating === null"
                [class.text-primary]="rating === null"
                [class.text-muted-foreground]="rating !== null"
              >
                All
              </button>
              @for (r of ratingOptions; track r) {
                <button
                  type="button"
                  (click)="setRating(r)"
                  class="px-2.5 py-1 text-sm font-medium rounded-md transition-colors tabular-nums"
                  [class.bg-primary/10]="rating === r"
                  [class.text-primary]="rating === r"
                  [class.text-muted-foreground]="rating !== r"
                >
                  {{ r }}★
                </button>
              }
            </div>
          </div>

          <!-- Resolution (pinned to Open in the needs-attention view, so hidden there) -->
          @if (view === 'all') {
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium text-muted-foreground">Status</span>
              <div class="inline-flex items-center gap-1 p-1 rounded-lg bg-muted/60">
                <button
                  type="button"
                  (click)="setResolution(null)"
                  class="px-2.5 py-1 text-sm font-medium rounded-md transition-colors"
                  [class.bg-primary/10]="resolution === null"
                  [class.text-primary]="resolution === null"
                  [class.text-muted-foreground]="resolution !== null"
                >
                  All
                </button>
                <button
                  type="button"
                  (click)="setResolution('open')"
                  class="px-2.5 py-1 text-sm font-medium rounded-md transition-colors"
                  [class.bg-primary/10]="resolution === 'open'"
                  [class.text-primary]="resolution === 'open'"
                  [class.text-muted-foreground]="resolution !== 'open'"
                >
                  Open
                </button>
                <button
                  type="button"
                  (click)="setResolution('resolved')"
                  class="px-2.5 py-1 text-sm font-medium rounded-md transition-colors"
                  [class.bg-primary/10]="resolution === 'resolved'"
                  [class.text-primary]="resolution === 'resolved'"
                  [class.text-muted-foreground]="resolution !== 'resolved'"
                >
                  Resolved
                </button>
              </div>
            </div>
          } @else {
            <p class="text-xs text-muted-foreground">Showing open, critical reviews.</p>
          }
        </div>
      </div>

      <!-- Content states -->
      @if (loading) {
        <div class="space-y-3 sm:space-y-4">
          @for (i of skeletonRows; track i) {
            <app-dn-card>
              <div class="p-4 sm:p-5 space-y-3">
                <div class="flex items-center justify-between">
                  <div class="h-4 w-28 bg-muted rounded animate-pulse"></div>
                  <div class="h-5 w-16 bg-muted rounded-full animate-pulse"></div>
                </div>
                <div class="h-3 w-full bg-muted rounded animate-pulse"></div>
                <div class="h-3 w-2/3 bg-muted rounded animate-pulse"></div>
                <div class="h-3 w-48 bg-muted rounded animate-pulse"></div>
              </div>
            </app-dn-card>
          }
        </div>
      } @else if (error) {
        <app-card-error title="Reviews" [message]="error" (retry)="retry()"></app-card-error>
      } @else if (reviews.length === 0) {
        <!-- Friendly empty state (varies by filter) -->
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
            <h2 class="text-base font-semibold text-foreground mb-1">{{ emptyTitle }}</h2>
            <p class="text-sm text-muted-foreground max-w-sm">{{ emptyBody }}</p>
          </div>
        </app-dn-card>
      } @else {
        <!-- Review list -->
        <div class="space-y-3 sm:space-y-4">
          @for (review of reviews; track review.id) {
            <app-dn-card>
              <div class="p-4 sm:p-5">
                <!-- Stars + status/critical badges -->
                <div class="flex items-start justify-between gap-3 mb-2">
                  <div class="flex items-center gap-2 min-w-0">
                    <div class="flex gap-0.5 shrink-0">
                      @for (star of stars; track star) {
                        <svg
                          aria-hidden="true"
                          class="w-3.5 h-3.5 sm:w-4 sm:h-4"
                          [class]="
                            star <= round(review.overallRating)
                              ? getStarFillClass(review.overallRating)
                              : 'text-muted-foreground/30'
                          "
                          viewBox="0 0 24 24"
                          [attr.fill]="star <= round(review.overallRating) ? 'currentColor' : 'none'"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <polygon
                            points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                          />
                        </svg>
                      }
                    </div>
                    <span class="text-sm font-semibold text-foreground tabular-nums">
                      {{ review.overallRating | number: '1.0-1' }}
                    </span>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    @if (review.isCritical) {
                      <app-dn-badge variant="destructive">
                        <svg
                          aria-hidden="true"
                          class="w-3 h-3 mr-1"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                          <line x1="12" x2="12" y1="9" y2="13" />
                          <line x1="12" x2="12.01" y1="17" y2="17" />
                        </svg>
                        Critical
                      </app-dn-badge>
                    }
                    <app-dn-badge [variant]="review.resolutionStatus === 'resolved' ? 'success' : 'warning'">
                      {{ review.resolutionStatus === 'resolved' ? 'Resolved' : 'Open' }}
                    </app-dn-badge>
                  </div>
                </div>

                <!-- Comment -->
                @if (review.comment) {
                  <p class="text-sm text-foreground whitespace-pre-line break-words">{{ review.comment }}</p>
                } @else {
                  <p class="text-sm italic text-muted-foreground">No comment left.</p>
                }

                <!-- Per-dimension chips (only the dimensions the diner rated) -->
                @if (dimensionChips(review).length > 0) {
                  <div class="flex flex-wrap gap-1.5 mt-3">
                    @for (chip of dimensionChips(review); track chip.label) {
                      <span
                        class="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums"
                      >
                        {{ chip.label }} {{ chip.value | number: '1.0-1' }}★
                      </span>
                    }
                  </div>
                }

                <!-- Action taken: the resolution note on a resolved review -->
                @if (review.resolutionStatus === 'resolved' && review.resolutionNote) {
                  <p class="text-xs italic text-muted-foreground mt-3 break-words">
                    Action taken: {{ review.resolutionNote }}
                  </p>
                }

                <!-- Footer: order context (left) + resolve action (right) -->
                <div class="flex items-center gap-3 mt-3">
                  @if (orderContext(review).length > 0) {
                    <p class="text-xs text-muted-foreground min-w-0 truncate">
                      {{ orderContext(review).join(' · ') }}
                    </p>
                  }
                  @if (!isPanelOpen(review)) {
                    <button
                      type="button"
                      (click)="toggleResolve(review)"
                      [disabled]="isResolving(review)"
                      class="ml-auto inline-flex items-center gap-1.5 shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                      [ngClass]="
                        review.resolutionStatus === 'resolved'
                          ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
                          : 'text-success hover:bg-success/10'
                      "
                    >
                      @if (review.resolutionStatus !== 'resolved') {
                        <svg
                          aria-hidden="true"
                          class="w-3.5 h-3.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      }
                      {{ resolveLabel(review) }}
                    </button>
                  }
                </div>

                <!-- Inline resolve-with-note panel (revealed when marking an open review resolved) -->
                @if (isPanelOpen(review)) {
                  <div class="mt-3 rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                    <textarea
                      [(ngModel)]="noteDraft"
                      rows="2"
                      placeholder="What's being done, or what you did — optional"
                      class="w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    ></textarea>
                    <div class="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        (click)="cancelResolve()"
                        class="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        (click)="confirmResolve(review)"
                        [disabled]="isResolving(review)"
                        class="inline-flex items-center gap-1.5 rounded-md bg-success px-2.5 py-1 text-xs font-medium text-success-foreground transition-colors hover:bg-success/90 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        @if (!isResolving(review)) {
                          <svg
                            aria-hidden="true"
                            class="w-3.5 h-3.5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.5"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        }
                        {{ isResolving(review) ? 'Resolving…' : 'Resolve' }}
                      </button>
                    </div>
                  </div>
                }
              </div>
            </app-dn-card>
          }
        </div>
      }
    </div>
  `,
})
export class ReviewsFeedComponent implements OnInit, OnDestroy {
  reviews: ReviewListItem[] = [];
  loading = true;
  error: string | null = null;

  // Filter state
  view: FeedView = 'all';
  rating: number | null = null;
  resolution: ResolutionFilter = null;

  readonly stars = [1, 2, 3, 4, 5];
  readonly ratingOptions = [5, 4, 3, 2, 1];
  readonly skeletonRows = [1, 2, 3, 4];

  /** Review ids with an in-flight resolve PATCH — disables their button. */
  readonly pendingResolve = new Set<string>();

  /**
   * The id of the review whose inline resolve-with-note panel is open (one at a
   * time), and the draft note being typed. Marking an OPEN review resolved
   * reveals this panel rather than resolving immediately; reopening a resolved
   * review stays one-click.
   */
  resolvingId: string | null = null;
  noteDraft = '';

  private restaurantId = '';
  private filters$ = new BehaviorSubject<ReviewFeedFilters>({});
  private destroy$ = new Subject<void>();

  constructor(
    private reviewsService: ReviewsService,
    private auth: AuthenticationService,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.restaurantId =
      this.auth.currentRestaurantRole?.restaurant_id ||
      this.route.parent?.snapshot.params['id'] ||
      '';

    // Deep-link from the Overview's "View flagged reviews →" entry:
    // ?view=attention opens the feed straight on the Needs-attention
    // (critical + open) queue. Seed filters$ BEFORE subscribing so the first
    // load already carries those filters — no throwaway all-reviews fetch.
    // Any other/absent value keeps the 'all' default.
    if (this.route.snapshot.queryParamMap.get('view') === 'attention') {
      this.view = 'attention';
      this.filters$.next(this.buildFilters());
    }

    this.filters$
      .pipe(
        takeUntil(this.destroy$),
        tap(() => {
          this.loading = true;
          this.error = null;
        }),
        switchMap((filters) =>
          this.reviewsService.getReviews(this.restaurantId, filters).pipe(
            map((reviews) => ({ reviews, error: null as string | null })),
            // loadAllPages returns partial data on per-page failure rather than
            // erroring, so this guards the rare hard failure; the global HTTP
            // interceptor still toasts request errors.
            catchError((err) =>
              of({
                reviews: [] as ReviewListItem[],
                error: err?.error?.message || 'Failed to load reviews',
              }),
            ),
          ),
        ),
      )
      .subscribe(({ reviews, error }) => {
        this.loading = false;
        this.reviews = reviews;
        this.error = error;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // --- Filter controls -----------------------------------------------------

  setView(view: FeedView): void {
    if (this.view === view) return;
    this.view = view;
    this.reload();
  }

  setRating(rating: number | null): void {
    if (this.rating === rating) return;
    this.rating = rating;
    this.reload();
  }

  setResolution(resolution: ResolutionFilter): void {
    if (this.resolution === resolution) return;
    this.resolution = resolution;
    this.reload();
  }

  retry(): void {
    this.reload();
  }

  /** Translate the UI filter state into server-side params and re-fetch. */
  private reload(): void {
    this.filters$.next(this.buildFilters());
  }

  /**
   * The needs-attention view IS the critical+open queue, so it overrides the
   * resolution control (which is hidden in that view). The rating filter always
   * applies on top.
   */
  buildFilters(): ReviewFeedFilters {
    const filters: ReviewFeedFilters = {};
    if (this.view === 'attention') {
      filters.critical = true;
      filters.resolutionStatus = 'open';
    } else if (this.resolution) {
      filters.resolutionStatus = this.resolution;
    }
    if (this.rating != null) {
      filters.rating = this.rating;
    }
    return filters;
  }

  // --- Resolve action ------------------------------------------------------

  /**
   * Footer button entry point. A resolved review reopens in one click; an open
   * review reveals the inline note panel (resolving happens on confirm).
   */
  toggleResolve(review: ReviewListItem): void {
    if (review.resolutionStatus === 'resolved') {
      this.reopen(review);
    } else {
      this.startResolve(review);
    }
  }

  /** Open the resolve-with-note panel for an open review (one at a time). */
  startResolve(review: ReviewListItem): void {
    this.resolvingId = String(review.id);
    this.noteDraft = '';
  }

  /** Close the panel without resolving. */
  cancelResolve(): void {
    this.resolvingId = null;
    this.noteDraft = '';
  }

  /** Whether a review's resolve-with-note panel is currently open. */
  isPanelOpen(review: ReviewListItem): boolean {
    return this.resolvingId === String(review.id);
  }

  /**
   * Confirm the panel: mark the review resolved, attaching the trimmed note when
   * one was typed (a blank draft sends no note). On success the panel closes and
   * the updated item is folded back into the feed.
   */
  confirmResolve(review: ReviewListItem): void {
    const note = this.noteDraft.trim() || undefined;
    this.performResolve(String(review.id), 'resolved', note, () => {
      this.resolvingId = null;
      this.noteDraft = '';
    });
  }

  /** Reopen a resolved review — one click, no note. */
  reopen(review: ReviewListItem): void {
    this.performResolve(String(review.id), 'open');
  }

  /**
   * Shared resolve/reopen PATCH. The id is tracked as pending so its confirm/
   * reopen button disables while in flight. On success `onSuccess` runs (e.g.
   * closing the panel) and the updated item is folded back into the feed; on
   * error we just clear pending — the global HTTP interceptor already toasts
   * request failures, so we don't add a second error surface (the panel stays
   * open so the draft survives a retry).
   */
  private performResolve(
    id: string,
    status: 'open' | 'resolved',
    note?: string,
    onSuccess?: () => void,
  ): void {
    if (this.pendingResolve.has(id)) return;
    this.pendingResolve.add(id);
    this.reviewsService
      .resolveReview(id, status, note)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updated) => {
          this.pendingResolve.delete(id);
          onSuccess?.();
          this.applyResolved(updated);
        },
        error: () => {
          this.pendingResolve.delete(id);
        },
      });
  }

  /**
   * Fold an updated review back into the feed: replace it in place so its badge
   * and button flip immediately — unless the active filter would now exclude it
   * (the needs-attention view, or an Open/Resolved status filter), in which case
   * drop it so the queue reflects reality. Resolve only mutates
   * `resolutionStatus`, which is exactly the dimension buildFilters keys on, so
   * its `resolutionStatus` output is the single source of truth here.
   */
  private applyResolved(updated: ReviewListItem): void {
    const wanted = this.buildFilters().resolutionStatus;
    if (wanted && wanted !== updated.resolutionStatus) {
      this.reviews = this.reviews.filter((r) => r.id !== updated.id);
    } else {
      this.reviews = this.reviews.map((r) => (r.id === updated.id ? updated : r));
    }
  }

  /** Whether a review has an in-flight resolve PATCH. */
  isResolving(review: ReviewListItem): boolean {
    return this.pendingResolve.has(String(review.id));
  }

  /**
   * Footer button label. Reopen is one-click so it reflects its in-flight state;
   * "Mark resolved" only opens the note panel, so the in-flight "Resolving…"
   * label lives on the panel's confirm button instead.
   */
  resolveLabel(review: ReviewListItem): string {
    if (review.resolutionStatus === 'resolved') {
      return this.isResolving(review) ? 'Reopening…' : 'Reopen';
    }
    return 'Mark resolved';
  }

  // --- Display helpers (sentiment treatment mirrors the reviews-card) -------

  round(n: number): number {
    return Math.round(n);
  }

  getStarFillClass(rating: number): string {
    if (rating >= 4) return 'fill-success text-success';
    if (rating <= 2) return 'fill-destructive text-destructive';
    return 'fill-warning text-warning';
  }

  /** Non-null per-dimension scores, in canonical order, for the chip row. */
  dimensionChips(review: ReviewListItem): { label: string; value: number }[] {
    return (
      [
        { label: 'Food', value: review.foodRating },
        { label: 'Speed', value: review.speedRating },
        { label: 'Service', value: review.serviceRating },
        { label: 'Value', value: review.valueRating },
        { label: 'Clean', value: review.cleanlinessRating },
      ] as { label: string; value: number | null }[]
    ).filter((c): c is { label: string; value: number } => c.value != null);
  }

  /** Order context segments, each included only when present. */
  orderContext(review: ReviewListItem): string[] {
    const parts: string[] = [];
    if (review.orderNumber != null) parts.push(`Order #${review.orderNumber}`);
    if (review.tableLabel) parts.push(review.tableLabel);
    if (review.spend) parts.push(this.formatSpend(review.spend));
    const ago = this.formatTimeAgo(review.createdAt);
    if (ago) parts.push(ago);
    return parts;
  }

  get emptyTitle(): string {
    return this.view === 'attention' ? 'Nothing needs attention' : 'No reviews match';
  }

  get emptyBody(): string {
    if (this.view === 'attention') {
      return 'No open, critical reviews right now — nice work staying on top of feedback.';
    }
    if (this.rating != null || this.resolution) {
      return 'No reviews match these filters. Try clearing or widening them.';
    }
    return 'No reviews yet. Once diners leave feedback, it will show up here.';
  }

  /** Spend arrives as a decimal string; show it as UGX when it parses. */
  private formatSpend(spend: string): string {
    const n = Number(spend);
    return isNaN(n) ? spend : formatUGX(n);
  }

  /**
   * Relative timestamp — extends the reviews-card helper with weeks, falling
   * back to an absolute date past ~a month (feed reviews can be old).
   */
  private formatTimeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    const hours = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60));
    if (hours < 1) return 'Just now';
    if (hours === 1) return '1h ago';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return '1d ago';
    if (days < 7) return `${days}d ago`;
    if (days < 30) {
      const weeks = Math.floor(days / 7);
      return weeks === 1 ? '1w ago' : `${weeks}w ago`;
    }
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
