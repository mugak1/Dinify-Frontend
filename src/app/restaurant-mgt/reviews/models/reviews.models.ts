// Frontend models for the Reviews surfaces — the Overview analytics and the
// Feed list. Shapes here are the adapted (camelCase, parsed) forms produced by
// reviews-adapter.ts from the raw `reviews/analytics/` and `reviews/` responses.

/** A single review-dimension score (food, speed, service, value, cleanliness). */
export interface ReviewDimension {
  key: string;
  label: string;
  /** Average on a 0–5 scale, or null when there isn't enough data. */
  average: number | null;
  count: number;
}

/** One star-rating bucket of the distribution. */
export interface ReviewsDistributionRow {
  rating: number;
  count: number;
  percentage: number;
}

/** One point on the rating trend (consumed by the follow-up chart PR). */
export interface ReviewsTrendPoint {
  period: string;
  average: number;
  count: number;
}

/** The weakest-scoring dimension for the period. */
export interface WeakestDimension {
  key: string;
  label: string;
  average: number;
}

/** The period the analytics cover. */
export interface ReviewsPeriod {
  from: string;
  to: string;
  category: string;
}

/** The full Reviews Overview analytics model. */
export interface ReviewsAnalytics {
  averageRating: number;
  totalReviews: number;
  distribution: ReviewsDistributionRow[];
  dimensions: ReviewDimension[];
  weakestDimension: WeakestDimension | null;
  criticalCount: number;
  unresolvedCriticalCount: number;
  trend: ReviewsTrendPoint[];
  period: ReviewsPeriod;
}

/**
 * A single review row for the Feed list — the adapted form of one
 * `ReviewRestaurantReadSerializer` record from the `reviews/` endpoint.
 * (Distinct from the legacy `ReviewListItem` in `_models/app.models.ts`.)
 */
export interface ReviewListItem {
  id: number;
  overallRating: number;
  comment: string;
  createdAt: string;
  orderNumber: number | null;
  tableLabel: string | null;
  spend: string | null;
  isCritical: boolean;
  resolutionStatus: 'open' | 'resolved';
  // Per-dimension scores (0–5), carried to render compact chips on each card.
  // null when the diner skipped that dimension.
  foodRating: number | null;
  speedRating: number | null;
  serviceRating: number | null;
  valueRating: number | null;
  cleanlinessRating: number | null;
}
