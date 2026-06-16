import {
  ReviewsAnalytics,
  ReviewsDistributionRow,
  ReviewDimension,
  ReviewsTrendPoint,
  WeakestDimension,
} from '../models/reviews.models';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a (possibly stringified) number, falling back when null/NaN. */
function safeFloat(val: any, fallback = 0): number {
  if (val == null) return fallback;
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

/**
 * Like safeFloat but preserves null — dimension and weakest averages can be
 * `null` ("not enough data") and must NOT be coerced to 0.
 */
function safeFloatOrNull(val: any): number | null {
  return val == null ? null : safeFloat(val);
}

/** Canonical dimension order + display labels. */
const DIMENSION_ORDER = ['food', 'speed', 'service', 'value', 'cleanliness'] as const;
const DIMENSION_LABELS: Record<string, string> = {
  food: 'Food',
  speed: 'Speed',
  service: 'Service',
  value: 'Value',
  cleanliness: 'Cleanliness',
};

// ---------------------------------------------------------------------------
// Section adapters
// ---------------------------------------------------------------------------

function adaptDistribution(raw: any[], totalReviews: number): ReviewsDistributionRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((d) => {
    const count = d?.count ?? 0;
    return {
      rating: d?.stars ?? 0,
      count,
      percentage: totalReviews > 0 ? (count / totalReviews) * 100 : 0,
    };
  });
}

function adaptDimensions(raw: any): ReviewDimension[] {
  return DIMENSION_ORDER.map((key) => {
    const d = raw?.[key];
    return {
      key,
      label: DIMENSION_LABELS[key],
      average: safeFloatOrNull(d?.average),
      count: d?.count ?? 0,
    };
  });
}

function adaptWeakest(raw: any): WeakestDimension | null {
  if (!raw || raw.key == null) return null;
  return {
    key: raw.key,
    label: DIMENSION_LABELS[raw.key] ?? raw.key,
    average: safeFloat(raw.average),
  };
}

function adaptTrend(raw: any[]): ReviewsTrendPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => ({
    period: p?.period ?? '',
    average: safeFloat(p?.average),
    count: p?.count ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function adaptReviewsAnalytics(raw: any): ReviewsAnalytics {
  const totalReviews = raw?.total_reviews ?? 0;
  return {
    averageRating: safeFloat(raw?.average_rating),
    totalReviews,
    distribution: adaptDistribution(raw?.distribution, totalReviews),
    dimensions: adaptDimensions(raw?.dimensions),
    weakestDimension: adaptWeakest(raw?.weakest_dimension),
    criticalCount: raw?.critical_count ?? 0,
    unresolvedCriticalCount: raw?.unresolved_critical_count ?? 0,
    trend: adaptTrend(raw?.trend),
    period: {
      from: raw?.period?.from ?? '',
      to: raw?.period?.to ?? '',
      category: raw?.period?.category ?? '',
    },
  };
}
