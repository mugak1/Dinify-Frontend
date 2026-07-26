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
  addDays,
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  endOfMonth,
  endOfYear,
  format,
  getDate,
  getDay,
  getMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
  subYears,
} from 'date-fns';
import { REPORT_PRESETS, ReportDateRange, ReportPreset, presetToRange } from './timeframe-range';

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
 * The EXACT INVERSE of `previousEqualLengthPeriod` — the equal-length window immediately
 * AFTER a range:
 *
 *     delta     = (to - from) + 1 day
 *     next_from = to + 1 day
 *     next_to   = to + delta
 *
 * `previousEqualLengthPeriod(nextEqualLengthPeriod(r))` returns `r`, and vice versa; that
 * identity is spec-pinned and is the whole point of writing the two side by side. The
 * reference implementation this feature is modelled on gets the BACKWARD case wrong by
 * offsetting `from` by the INCLUSIVE length instead of the exclusive one, so its window
 * grows a day on every click, in both directions. Keeping forward and backward adjacent
 * and provably inverse is what stops that reappearing here.
 *
 * These two functions are the ONLY place equal-length stepping arithmetic lives. Callers
 * step through them; they do not re-derive offsets.
 *
 * Note the caller, not this function, is responsible for clamping `to` to today — an
 * equal-length window after a range that ends near the present legitimately runs into the
 * future, and only the caller knows whether that is allowed.
 */
export function nextEqualLengthPeriod(
  range: Pick<ReportDateRange, 'from' | 'to'>,
): ReportDateRange {
  const to = parseISO(range.to);
  const deltaDays = differenceInCalendarDays(to, parseISO(range.from)) + 1;
  return comparison(addDays(to, 1), addDays(to, deltaDays));
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

// ─── Range shape + period stepping (TIMEFRAME-01C) ───────────────────────────────────

/**
 * What a range IS, structurally: a single day, a Mon–Sun week, a whole calendar
 * month/year, the in-progress version of any of those, or none of the above.
 */
export type RangeShape =
  | 'day'
  | 'week'
  | 'week-to-date'
  | 'month'
  | 'month-to-date'
  | 'year'
  | 'year-to-date'
  | 'custom';

/** The natural period a shape is measured in. `custom` has none — it steps by length. */
type PeriodLevel = 'day' | 'week' | 'month' | 'year';

const SHAPE_PERIOD: Record<Exclude<RangeShape, 'custom'>, PeriodLevel> = {
  day: 'day',
  week: 'week',
  'week-to-date': 'week',
  month: 'month',
  'month-to-date': 'month',
  year: 'year',
  'year-to-date': 'year',
};

/**
 * Preset → period level, used ONLY to break a tie the dates cannot break (see
 * `classifyRangeShape`) and to keep a stepped range's preset continuous (see
 * `presetForSteppedRange`).
 *
 * `yesterday` / `last-week` / `last-month` are deliberately absent: they are CLOSED
 * ranges (`to < today`) and every ambiguity here requires `to === today`, so they can
 * never reach a tiebreak. `custom` reads as `day` — the narrowest reading of a
 * hand-picked single day, since no period intent was recorded.
 */
const PRESET_PERIOD: Partial<Record<ReportPreset, PeriodLevel>> = {
  today: 'day',
  'this-week': 'week',
  'this-month': 'month',
  'this-year': 'year',
  custom: 'day',
};

/**
 * Every shape whose definition these dates satisfy, in precedence order. Declaration
 * order IS the precedence: complete before to-date at each period level, `day` first.
 */
function matchingShapes(from: string, to: string, now: Date): Exclude<RangeShape, 'custom'>[] {
  const start = parseISO(from);
  const today = fmt(now);
  const matches: Exclude<RangeShape, 'custom'>[] = [];

  if (from === to) matches.push('day');
  if (getDay(start) === 1 && to === fmt(addDays(start, 6))) matches.push('week');
  if (from === fmt(startOfWeek(now, { weekStartsOn: 1 })) && to === today) {
    matches.push('week-to-date');
  }
  if (getDate(start) === 1 && to === fmt(endOfMonth(start))) matches.push('month');
  if (from === fmt(startOfMonth(now)) && to === today) matches.push('month-to-date');
  if (getDate(start) === 1 && getMonth(start) === 0 && to === fmt(endOfYear(start))) {
    matches.push('year');
  }
  if (from === fmt(startOfYear(now)) && to === today) matches.push('year-to-date');

  return matches;
}

/**
 * The shape of a range — what the period arrows step by.
 *
 * CLASSIFY FROM THE DATES. Step back twice from `this-month` and the preset reads
 * `custom` while the range is still a real calendar month; stepping it by equal length
 * would then be wrong the moment month lengths differ (1–31 Jul → 1–31 Jun, a month that
 * does not exist). The dates always know what shape they are; a stepped preset has
 * decayed.
 *
 * Precedence is `matchingShapes`' declaration order, so a to-date range that happens to
 * be COMPLETE — today is Sunday, or the last day of the month — classifies as the
 * complete shape. Harmless, since the two step identically, but pinned so it is
 * deliberate rather than incidental.
 *
 * THE ONE SCOPED EXCEPTION. Some date pairs satisfy several definitions at once, and in
 * those the dates carry no distinguishing information AT ALL: on the 1st of a month,
 * Reports' `this-month` and the Dashboard's `today` produce byte-identical `from`/`to`.
 * There — and only there — `preset` breaks the tie, picking the matching shape at its
 * period level (preferring the complete variant, so the rule above still holds).
 *
 * That does not reopen the door the first rule closes, which is about a STALE preset —
 * one left over from a range since stepped away from its period. A tie requires
 * `to === today`, and every pair of COMPLETE shapes is mutually impossible (a 7-day
 * month, a 1-day year), so a multi-match always contains a to-date shape. That leaves
 * exactly two cases, both sound:
 *   - an UNSTEPPED range — the preset is the user's own selection and has not decayed;
 *   - a range stepped FORWARD into the present (1–30 Jun → 1–1 Jul, on the 1st) — there
 *     `stepRange` has just assigned the preset by CONTINUITY of the shape it stepped
 *     from, so it is truthful by construction. That is precisely what makes
 *     back-then-forward return the original range.
 * A range stepped BACKWARD always lands in the past and can never reach the tie.
 *
 * PHASE 2 inherits this. Its comparison vocabulary keys off shape and will hit the
 * identical tie on the 1st, which is why the tiebreak lives here and not in a caller.
 */
export function classifyRangeShape(
  range: { from: string; to: string; preset?: ReportPreset },
  now: Date = new Date(),
): RangeShape {
  const matches = matchingShapes(range.from, range.to, now);
  if (matches.length === 0) return 'custom';

  if (matches.length > 1) {
    const level = range.preset ? PRESET_PERIOD[range.preset] : undefined;
    const preferred = level && matches.find((s) => SHAPE_PERIOD[s] === level);
    if (preferred) return preferred;
  }

  return matches[0];
}

/**
 * The preset to stamp on a stepped range: the known preset whose resolution for `now`
 * EXACTLY equals it, else `custom`. Stepping back from `this-month` therefore yields
 * `last-month` and the picker highlights it.
 *
 * `level` is the period level of the shape stepped FROM, and it is load-bearing rather
 * than cosmetic. On the 1st of a month `today` and `this-month` resolve to the SAME
 * dates, so a forward step from 1–30 Jun into 1–1 Jul matches both. Continuity picks
 * `this-month` — a month-shaped step lands on a month preset. Assign `today` instead and
 * the next back-click moves one DAY, and back-then-forward stops returning the original
 * range. (Collisions are possible only among the open to-date presets, all of which have
 * `to === today`; the closed presets can coincide with nothing.)
 *
 * Cosmetic in every OTHER respect — `classifyRangeShape`, not this, drives stepping.
 *
 * PHASE 2 NOTE: the comparison vocabulary must key off `classifyRangeShape`, not
 * `preset`, for the same reason that function classifies from dates. That may leave
 * `preset` vestigial for semantics and useful only for picker highlighting — a decision
 * for Phase 2, not something to pre-empt here.
 */
function presetForSteppedRange(
  from: string,
  to: string,
  now: Date,
  level: PeriodLevel | null,
): ReportPreset {
  const matches = REPORT_PRESETS.filter((p) => {
    if (p === 'custom') return false;
    const resolved = presetToRange(p, now);
    return resolved.from === from && resolved.to === to;
  });

  if (matches.length === 0) return 'custom';
  if (matches.length > 1 && level) {
    const preferred = matches.find((p) => PRESET_PERIOD[p] === level);
    if (preferred) return preferred;
  }
  return matches[0];
}

/**
 * Step the whole window one period in `direction` (-1 back, +1 forward), where "one
 * period" is decided by the range's SHAPE, not its preset.
 *
 * BACKWARD always yields the COMPLETE natural period:
 *   day                    → the previous day
 *   week | week-to-date    → the previous complete Mon–Sun week
 *   month | month-to-date  → the previous complete calendar month
 *   year | year-to-date    → the previous complete calendar year
 *   custom                 → `previousEqualLengthPeriod`
 * So stepping back from month-to-date (1–26 Jul) gives ALL of June, not 1–26 Jun. A
 * completed month is a completed month; truncating it to match the shape of an
 * in-progress one would hide four days of real trade.
 *
 * FORWARD mirrors that, then clamps the END to today (22–24 Jul → 25–26 Jul, not
 * 25–27 Jul). It does NOT collapse an overshoot to a single "Today" range the way the
 * reference model does — that silently turns a three-day measurement into a one-day one.
 * Clamping the end is honest, and the label shows the real dates.
 *
 * Stepping arithmetic is never re-derived here: the equal-length case goes through
 * `previousEqualLengthPeriod` / `nextEqualLengthPeriod`, which are provably inverse.
 */
export function stepRange(
  range: ReportDateRange,
  direction: -1 | 1,
  now: Date = new Date(),
): ReportDateRange {
  const shape = classifyRangeShape(range, now);
  const level = shape === 'custom' ? null : SHAPE_PERIOD[shape];
  const from = parseISO(range.from);
  const today = fmt(now);
  const back = direction === -1;

  let stepped: { from: string; to: string };

  switch (level) {
    case 'day': {
      const d = back ? subDays(from, 1) : addDays(from, 1);
      stepped = { from: fmt(d), to: fmt(d) };
      break;
    }
    case 'week': {
      // `from` is this week's Monday for both week shapes, so one formula serves both.
      const monday = back ? subWeeks(from, 1) : addWeeks(from, 1);
      stepped = { from: fmt(monday), to: fmt(addDays(monday, 6)) };
      break;
    }
    case 'month': {
      const first = back ? subMonths(startOfMonth(from), 1) : addMonths(startOfMonth(from), 1);
      stepped = { from: fmt(first), to: fmt(endOfMonth(first)) };
      break;
    }
    case 'year': {
      const first = back ? subYears(startOfYear(from), 1) : addYears(startOfYear(from), 1);
      stepped = { from: fmt(first), to: fmt(endOfYear(first)) };
      break;
    }
    default: {
      const equal = back ? previousEqualLengthPeriod(range) : nextEqualLengthPeriod(range);
      stepped = { from: equal.from, to: equal.to };
    }
  }

  if (!back) {
    // The period has not begun yet — the UI disables the control here, so this is
    // defensive. Returning the range unchanged keeps the function total and stops it ever
    // emitting `from > to` or a future-dated range, which `parseTimeframeParams` would
    // reject on the next page load.
    if (stepped.from > today) return range;
    if (stepped.to > today) stepped = { from: stepped.from, to: today };
  }

  return {
    preset: presetForSteppedRange(stepped.from, stepped.to, now, level),
    from: stepped.from,
    to: stepped.to,
  };
}
