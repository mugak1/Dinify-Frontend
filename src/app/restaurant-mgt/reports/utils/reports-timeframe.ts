// Reports timeframe engine — pure range→bucket resolution + comparison windows.
//
// Generalises the binary `days <= 31 ? 'daily' : 'monthly'` derivation (today
// living inline in sales-report.component.ts) into a 4-tier ladder that mirrors
// the backend's sales-trends day-span caps, and adds the single-day → hour-of-day
// path that feeds the new `sales-hourly` endpoint. Pure functions only (no DI, no
// component) so the ladder, the cap clamp, and the comparison-window maths are
// unit-testable in isolation. Lands DORMANT — no tab calls it yet (PRs B–E adopt
// it); it is validated entirely by reports-timeframe.spec.ts.

import {
  differenceInCalendarDays,
  endOfMonth,
  endOfYear,
  format,
  parseISO,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
  subYears,
} from 'date-fns';
import { ReportDateRange } from '../models/reports.models';

/** Time bucket the UI renders a range at. `hour` is the single-day sales-hourly path. */
export type ReportBucketUnit = 'hour' | 'day' | 'month' | 'year';

/**
 * Backend `category` vocabulary for sales-trends. Superset of the narrower
 * `ReportGranularity` (daily|monthly) the Sales tab derives today. `quarterly` is
 * a valid backend category but the ladder never auto-selects it (a month bucket
 * already covers that span) — it is exposed here + in the cap map for completeness.
 */
export type SalesTrendsCategory = 'daily' | 'monthly' | 'quarterly' | 'annual';

/**
 * Max day-span (`differenceInCalendarDays`, i.e. to − from) the backend accepts
 * per category before it 400s. Mirrored here as the single source of truth that
 * drives both the ladder and the over-cap clamp.
 */
export const SALES_TRENDS_CAP_DAYS: Record<SalesTrendsCategory, number> = {
  daily: 31,
  monthly: 731,
  quarterly: 731,
  annual: 1850,
};

/** At/under this span (in days) a range buckets by hour-of-day (sales-hourly). */
export const HOURLY_MAX_DAYS = 1;

/** Bucket → sales-trends category. `hour` has no category (it uses sales-hourly). */
export const BUCKET_TO_CATEGORY: Record<ReportBucketUnit, SalesTrendsCategory | null> = {
  hour: null,
  day: 'daily',
  month: 'monthly',
  year: 'annual',
};

export interface TimeframeResolution {
  /** Bucket the range renders at. */
  bucketUnit: ReportBucketUnit;
  /** sales-trends category, or `null` when `bucketUnit === 'hour'` (sales-hourly path). */
  category: SalesTrendsCategory | null;
  /**
   * The range to actually request. Equals the input range UNLESS its span exceeds
   * the annual cap, in which case `from` is advanced so the span === the cap — so
   * the UI never issues a request the backend would 400.
   */
  effectiveRange: ReportDateRange;
  /** True when `effectiveRange` was clamped to the annual cap. */
  clamped: boolean;
}

const fmt = (d: Date): string => format(d, 'yyyy-MM-dd');

/**
 * Maps a date range to the bucket + sales-trends category the UI should request,
 * mirroring the backend caps. Ladder by calendar-day span (to − from):
 *   ≤ 1     → hour   (sales-hourly; no category)
 *   ≤ 31    → day    → 'daily'
 *   ≤ 731   → month  → 'monthly'
 *   ≤ 1850  → year   → 'annual'
 *   > 1850  → year   → 'annual', range clamped so the request stays within the cap.
 */
export function resolveTimeframe(range: ReportDateRange): TimeframeResolution {
  const to = parseISO(range.to);
  const span = differenceInCalendarDays(to, parseISO(range.from));

  if (span <= HOURLY_MAX_DAYS) {
    return { bucketUnit: 'hour', category: null, effectiveRange: range, clamped: false };
  }
  if (span <= SALES_TRENDS_CAP_DAYS.daily) {
    return { bucketUnit: 'day', category: 'daily', effectiveRange: range, clamped: false };
  }
  if (span <= SALES_TRENDS_CAP_DAYS.monthly) {
    return { bucketUnit: 'month', category: 'monthly', effectiveRange: range, clamped: false };
  }
  if (span <= SALES_TRENDS_CAP_DAYS.annual) {
    return { bucketUnit: 'year', category: 'annual', effectiveRange: range, clamped: false };
  }

  // Span exceeds the annual cap → clamp `from` forward so the span equals the cap.
  const clampedFrom = fmt(subDays(to, SALES_TRENDS_CAP_DAYS.annual));
  return {
    bucketUnit: 'year',
    category: 'annual',
    effectiveRange: { preset: range.preset, from: clampedFrom, to: range.to },
    clamped: true,
  };
}

/** Computed comparison windows carry no user preset. */
function comparison(from: Date, to: Date): ReportDateRange {
  return { preset: 'custom', from: fmt(from), to: fmt(to) };
}

/**
 * The equivalent prior window for a range — the basis for period-over-period
 * deltas (the visuals land in a later PR; the range maths live here). Preset-aware:
 *   today / yesterday     → the prior single day
 *   this-week / last-week → the prior Mon–Sun week
 *   this-month/last-month → the FULL prior calendar month (not a fixed-day shift)
 *   this-year             → the prior calendar year
 *   custom (and fallback) → an equal-length window immediately before the range
 */
export function comparisonRange(range: ReportDateRange): ReportDateRange {
  const from = parseISO(range.from);
  const to = parseISO(range.to);

  switch (range.preset) {
    case 'today':
    case 'yesterday':
      return comparison(subDays(from, 1), subDays(to, 1));

    case 'this-week':
    case 'last-week':
      return comparison(subWeeks(from, 1), subWeeks(to, 1));

    case 'this-month':
    case 'last-month': {
      const prev = subMonths(from, 1);
      return comparison(startOfMonth(prev), endOfMonth(prev));
    }

    case 'this-year': {
      const prev = subYears(from, 1);
      return comparison(startOfYear(prev), endOfYear(prev));
    }

    case 'custom':
    default: {
      const lengthDays = differenceInCalendarDays(to, from) + 1; // inclusive length
      return comparison(subDays(from, lengthDays), subDays(to, lengthDays));
    }
  }
}
