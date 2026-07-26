// Shared timeframe engine — pure range→bucket resolution + comparison windows.
//
// Generalises the binary `days <= 31 ? 'daily' : 'monthly'` derivation into a 4-tier
// ladder that mirrors the backend's sales-trends day-span caps, and adds the
// single-day → hour-of-day path that feeds the `sales-hourly` endpoint. Pure
// functions only (no DI, no component) so the ladder, the cap clamp, and the
// comparison-window maths are unit-testable in isolation.
//
// Relocated out of the Reports module (TIMEFRAME-01A) alongside the range model so
// Dashboard can adopt the same ladder in 01B. Live consumers today: the Reports shell
// (comparisonRangeLabel), all four report tabs (comparisonRange), and the Sales tab +
// sales-view (resolveTimeframe / ReportBucketUnit / SalesTrendsCategory).

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
import { ReportDateRange } from './timeframe-range';

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

/**
 * The EQUAL-LENGTH window immediately before a range — the exact formula
 * `reports/restaurant/dashboard-v2/` uses to build its `previous_totals`:
 *
 *     delta     = (to - from) + 1 day
 *     prev_from = from - delta
 *     prev_to   = from - 1 day
 *
 * MIRRORS THE BACKEND. If dashboard-v2's previous window changes, this changes in the
 * same PR. `prev_to` is written as `from - 1 day` literally rather than the equivalent
 * `to - length` so a line-by-line diff against the backend is trivially checkable.
 *
 * NOT `comparisonRange`, and the Dashboard must never call that one. `comparisonRange`
 * is PRESET-AWARE — a `this-month` range compares against the FULL prior calendar month
 * — while dashboard-v2 is not. A frontend delta computed one way against a backend total
 * computed the other is a wrong number with no error attached to it. The two coincide
 * only when the selection happens to be a whole calendar month, which is why the drift
 * was invisible while the Dashboard could only pick four fixed ranges.
 *
 * Do NOT "simplify" this by delegating to `comparisonRange`'s `custom` branch. That
 * branch is arithmetically identical TODAY only because both shift by the same inclusive
 * length; reaching it means synthesising `{...range, preset: 'custom'}`, which spells
 * "treat this as a custom range" — the exact semantic being avoided — and it would
 * silently inherit any future change to comparison semantics.
 *
 * Takes only `from`/`to` so the mock data layer can call it with a bare pair.
 */
export function previousEqualLengthPeriod(
  range: Pick<ReportDateRange, 'from' | 'to'>,
): ReportDateRange {
  const from = parseISO(range.from);
  const deltaDays = differenceInCalendarDays(parseISO(range.to), from) + 1;
  return comparison(subDays(from, deltaDays), subDays(from, 1));
}

/**
 * Human label for the period `comparisonRange` compares against — drives the shell's
 * "Compare to {label}" toggle. Preset-aware so the label reads naturally:
 *   today                 → "yesterday"
 *   this-week / last-week → "last week" / "the previous week"
 *   this-month/last-month → the prior calendar month's name (e.g. "May")
 *   this-year             → the prior calendar year (e.g. "2025")
 *   custom (and fallback) → "the previous period"
 * Consumes `comparisonRange` (single source of truth) for the month/year cases.
 */
export function comparisonRangeLabel(range: ReportDateRange): string {
  switch (range.preset) {
    case 'today':
      return 'yesterday';
    case 'yesterday':
      return 'the previous day';
    case 'this-week':
      return 'last week';
    case 'last-week':
      return 'the previous week';
    case 'this-month':
    case 'last-month':
      return format(parseISO(comparisonRange(range).from), 'MMMM');
    case 'this-year':
      return format(parseISO(comparisonRange(range).from), 'yyyy');
    case 'custom':
    default:
      return 'the previous period';
  }
}
