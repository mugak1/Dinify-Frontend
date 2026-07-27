// Shared timeframe engine — pure range→bucket resolution + comparison windows.
//
// Generalises the binary `days <= 31 ? 'daily' : 'monthly'` derivation into a 4-tier
// ladder that mirrors the backend's sales-trends day-span caps, and adds the
// single-day → hour-of-day path that feeds the `sales-hourly` endpoint. Pure
// functions only (no DI, no component) so the ladder, the cap clamp, and the
// comparison-window maths are unit-testable in isolation.
//
// Relocated out of the Reports module (TIMEFRAME-01A) alongside the range model so
// Dashboard can adopt the same ladder in 01B. Live consumers today: all four report tabs
// (resolveComparison), the shared picker (comparisonOptionsFor / stepRange), the Dashboard
// (previousEqualLengthPeriod), and the Sales tab + sales-view (resolveTimeframe /
// ReportBucketUnit / SalesTrendsCategory).
//
// ONE COMPARISON-WINDOW RESOLVER. `resolveComparison` is it. The preset-keyed
// `comparisonRange`/`comparisonRangeLabel` pair it replaced (TIMEFRAME-02A) is gone —
// a comparison basis is now a user SELECTION keyed on the range's shape, not a
// consequence of the preset. Do not reintroduce a second entry point.

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
import { ComparisonOption } from './comparison-option';
import {
  REPORT_PRESETS,
  ReportDateRange,
  ReportPreset,
  isRealIsoDate,
  presetToRange,
} from './timeframe-range';

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
 * NOT `resolveComparison`, and the Dashboard must never call that one. `resolveComparison`
 * answers "what did the USER choose to compare against", and its prev-month ids on a
 * month-to-date range give 1–26 Jun for 1–26 Jul — while dashboard-v2 always shifts by
 * the inclusive length. A frontend delta computed one way against a backend total computed
 * the other is a wrong number with no error attached to it. The two coincide only when the
 * selection happens to be a whole calendar month, which is why the drift was invisible
 * while the Dashboard could only pick four fixed ranges.
 *
 * `resolveComparison` DOES delegate here for its `prev-period` option, and that is the
 * intended direction: `prev-period` means precisely "the equal-length block immediately
 * before", so it must not re-derive the offset. The dependency does not run the other way
 * — do not "simplify" this function by routing it through the resolver, which would make
 * the backend mirror inherit any future change to comparison semantics.
 *
 * Takes only `from`/`to` so the mock data layer can call it with a bare pair.
 */
/**
 * Inclusive day count of a range — 1 Jun…1 Jun is 1, not 0.
 *
 * Used ONLY by `resolveComparison`'s `custom` branch. `previousEqualLengthPeriod`,
 * `nextEqualLengthPeriod` and `priorMonthWindow` inline the same `+ 1`; they mirror the
 * backend's formula and are spec-pinned as they stand, so folding them in here is a
 * separate change and not one 02D should smuggle in.
 */
function inclusiveDays(range: Pick<ReportDateRange, 'from' | 'to'>): number {
  return differenceInCalendarDays(parseISO(range.to), parseISO(range.from)) + 1;
}

/**
 * The LATEST start a custom comparison window may take for `range` — THE single bound, and
 * the only place it is derived (TIMEFRAME-02D).
 *
 * There look to be two rules, and there are not. The derived window is `[s, s + L − 1]`:
 *
 *   non-overlap  requires  s + L − 1 <  range.from   →  s ≤ range.from − L
 *   not-future   requires  s + L − 1 ≤  today        →  s ≤ today − (L − 1)
 *
 * `presetToRange` clamps every in-progress preset to today, so `range.from ≤ range.to ≤
 * today` always holds — which makes `range.from − L ≤ today − L < today − (L − 1)`. The
 * non-overlap bound is therefore STRICTLY TIGHTER and implies the future one.
 *
 * So one `max` covers both, and the calendar needs no per-date predicate. DO NOT re-add an
 * overlap check beside this believing `max` only handles the future rule — it handles both,
 * and the second check would be dead code implying a gap that is not there.
 */
export function maxCustomComparisonStart(range: Pick<ReportDateRange, 'from' | 'to'>): string {
  return fmt(subDays(parseISO(range.from), inclusiveDays(range)));
}

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
 * THE COMPARISON VOCABULARY INHERITS THIS (02A, shipped). `comparisonOptionsFor` and
 * `resolveComparison` key off shape and hit the identical tie on the 1st, which is why
 * the tiebreak lives here and not in a caller.
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
 * As of 02A the comparison vocabulary keys off `classifyRangeShape` rather than `preset`,
 * for the same reason that function classifies from dates. `preset` is now vestigial for
 * semantics: it survives to highlight the matching entry in the picker's preset list, and
 * to break the 1st-of-the-period shape tie described in `classifyRangeShape`.
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

// ─── Comparison basis (TIMEFRAME-02A) ────────────────────────────────────────────────
//
// What a range is measured AGAINST is a user selection. The vocabulary lives in
// `comparison-option.ts`; the two functions below are the whole of the logic — which
// options a shape offers, and what window a chosen option resolves to.
//
// KEYED ON SHAPE, NEVER ON PRESET, for the reason `classifyRangeShape` documents: two
// steps back from `this-month` reads `custom` while the range is still a real calendar
// month, and a preset-keyed comparison would then be wrong the moment month lengths
// differ.

/**
 * The comparison bases on offer for a range of this shape, in MENU ORDER. The first
 * entry is always `'none'`; the second is the shape's default (see
 * `defaultComparisonFor`).
 *
 * No set contains two entries that resolve to the same window AND pair it the same way —
 * that would be a menu that lies. The rule is why the year shapes omit `dates-last-year`:
 * for a whole calendar year it is `prev-year` (see below), so offering both would render
 * one window under two names.
 *
 * 02C widened it from "window" to "(window, pairing)". The month sets deliberately carry
 * pairs that SHARE a window — `prev-month-by-day` / `prev-month-by-date`, and
 * `prev-year-by-day` / `dates-last-year` — because at month level how the two series are
 * paired inside the chart is a real question with two legitimate answers. They behave
 * differently, which is what the rule was ever about.
 *
 * `custom` (02D) is offered by EVERY shape and is always LAST. Last is load-bearing:
 * `defaultComparisonFor` reads index 1, so appending it cannot change any shape's default.
 * Offered everywhere is what makes it survive a shape change untouched — `carryComparison`
 * keeps a basis the new shape still offers, so a placed custom window is never silently
 * swapped out from under the user by an arrow step.
 */
export function comparisonOptionsFor(shape: RangeShape): ComparisonOption[] {
  switch (shape) {
    case 'day':
      return ['none', 'prev-day', 'prev-week', 'prev-year', 'dates-last-year', 'custom'];
    case 'week':
    case 'week-to-date':
      return ['none', 'prev-week', 'prev-year', 'dates-last-year', 'custom'];
    case 'month':
    case 'month-to-date':
      // Month level is the ONLY place pairing is a question, so it is the only place the
      // menu carries by-day / by-date variants. `prev-year` is deliberately absent here:
      // at month level "previous year" means the same calendar month, which is what
      // `prev-year-by-day` and `dates-last-year` give.
      return [
        'none',
        'prev-month-by-day',
        'prev-month-by-date',
        'prev-year-by-day',
        'dates-last-year',
        'custom',
      ];
    case 'year':
    case 'year-to-date':
      return ['none', 'prev-year', 'custom'];
    case 'custom':
      return ['none', 'prev-period', 'custom'];
  }
}

/**
 * A shape's default basis: its first non-`'none'` option.
 *
 * NOT `'none'`. Reports has always shown a comparison and must keep doing so — landing on
 * "No comparison" would silently remove a number people read every day, and read it as a
 * bug rather than a default.
 */
export function defaultComparisonFor(shape: RangeShape): ComparisonOption {
  return comparisonOptionsFor(shape)[1];
}

/** True when `option` is on offer for a range of this shape. */
export function isComparisonOfferedFor(shape: RangeShape, option: ComparisonOption): boolean {
  return comparisonOptionsFor(shape).includes(option);
}

/**
 * `1 .. n` of the month `monthsBack` before `from`'s, where `n` is the primary range's
 * inclusive day count — clamped to that month's real length.
 *
 * The clamp is the February case: month-to-date 1–30 Mar has no 30th to land on in
 * February, so it resolves to 1–28 (or 1–29 in a leap year). Shortening rather than
 * spilling into March keeps the comparison inside the month it names.
 */
function priorMonthWindow(from: Date, lengthDays: number): ReportDateRange {
  const start = startOfMonth(subMonths(from, 1));
  const end = endOfMonth(start);
  const wanted = addDays(start, lengthDays - 1);
  return comparison(start, wanted > end ? end : wanted);
}

/**
 * The window a chosen comparison basis resolves to, or `null` for `'none'`.
 *
 * THE ONE COMPARISON-WINDOW RESOLVER. Every surface routes through this; nothing
 * re-derives a comparison offset of its own.
 *
 * Two of the options need the range's SHAPE, so it is classified here rather than passed
 * in — a caller that computed shape separately could hand us one derived from a different
 * `now` than the window is built with, and the menu and the number would disagree with no
 * error attached.
 *
 *   none            → null
 *   prev-period     → `previousEqualLengthPeriod` (which is the ONLY place equal-length
 *                     stepping arithmetic lives — see its docstring)
 *   prev-day        → both bounds one day back
 *   prev-week       → both bounds seven days back; partial-to-partial for week-to-date,
 *                     and "the same weekday last week" for a single day
 *   prev-month-by-day, prev-month-by-date
 *                   → ONE window: a COMPLETE month compares to the complete prior month,
 *                     a MONTH-TO-DATE range PARTIAL-TO-PARTIAL (see below). They differ
 *                     only in `pairingFor`, which is a chart concern
 *   prev-year       → 364 days back, so a Wednesday compares to a Wednesday — EXCEPT from
 *                     MONTH LEVEL UP, where it is calendar-aligned (see below)
 *   prev-year-by-day, dates-last-year
 *                   → ONE window: the same calendar dates one year back (29 Feb → 28 Feb),
 *                     which at month level is the same calendar month. Again they differ
 *                     only in pairing
 *
 * MONTH-TO-DATE COMPARES PARTIAL-TO-PARTIAL (behaviour change, 02A). 1–26 Jul resolves to
 * 1–26 Jun, not the whole of June. Setting a 26-day total against a complete 30-day month
 * makes every month look like a collapse until roughly the 28th, for arithmetic reasons
 * rather than trading ones. The week-level equivalent already did the right thing, which
 * makes the old month behaviour an inconsistency rather than a considered choice. Complete
 * shapes are unaffected: a whole calendar month still compares to the whole prior one.
 *
 * `prev-year` IS CALENDAR-ALIGNED FROM MONTH LEVEL UP (year shapes in 02A, month shapes
 * in 02C). A 364-day shift is the retail convention and is right for a day or a week, but
 * it straddles boundaries above that. On a MONTH it produces roughly 3 Jul – 2 Aug for a
 * July range, whose total mixes two months' takings; 02C moved weekday alignment at month
 * level into `pairingFor`, where it belongs, so the window can be the honest one. On a
 * YEAR it is worse still: shifting 2026 back by 364 gives 2 Jan 2025 – 1 Jan 2026, which
 * OVERLAPS
 * the range it is being compared to. It is also what makes the year sets honest — with
 * calendar alignment, `dates-last-year` would resolve identically there, which is why it
 * is not offered.
 *
 * TOTAL BY CONSTRUCTION. `TimeframeService` rejects a shape-invalid `cmp` before it ever
 * reaches here, but an option is still resolved for any shape rather than throwing —
 * same discipline as `stepRange`'s forward-overshoot guard.
 *
 * `custom` (02D) IS THE ONE OPTION THAT DOES NOT DETERMINE ITS OWN WINDOW. It needs
 * `customFrom` passed alongside it, and yields `null` without one — an unplaced comparison,
 * not an error. Every consumer already renders `null` as no comparison and skips the
 * request, so the unplaced state costs no new handling anywhere. Only the START is ever
 * stored: the end is derived HERE, from the primary's length, on every single read. That is
 * what keeps the window equal-length through an arrow step across a 31 → 30 month boundary
 * without rewriting a date the user picked. Do not derive an end anywhere else.
 */
export function resolveComparison(
  range: ReportDateRange,
  option: ComparisonOption,
  now: Date = new Date(),
  customFrom?: string | null,
): ReportDateRange | null {
  if (option === 'none') return null;
  if (option === 'prev-period') return previousEqualLengthPeriod(range);
  if (option === 'custom') {
    if (!isRealIsoDate(customFrom)) return null;
    const start = parseISO(customFrom);
    return comparison(start, addDays(start, inclusiveDays(range) - 1));
  }

  const from = parseISO(range.from);
  const to = parseISO(range.to);
  const shape = classifyRangeShape(range, now);

  switch (option) {
    case 'prev-day':
      return comparison(subDays(from, 1), subDays(to, 1));

    case 'prev-week':
      return comparison(subWeeks(from, 1), subWeeks(to, 1));

    // One window, two pairings. The `-by-day` / `-by-date` split is a CHART concern
    // (`pairingFor`) and changes nothing about which dates are fetched — which is exactly
    // why they share this branch rather than each getting one.
    case 'prev-month-by-day':
    case 'prev-month-by-date': {
      if (shape === 'month') {
        const prev = startOfMonth(subMonths(from, 1));
        return comparison(prev, endOfMonth(prev));
      }
      if (shape === 'month-to-date') {
        return priorMonthWindow(from, differenceInCalendarDays(to, from) + 1);
      }
      // Defensive: the prev-month ids are offered for the month shapes only.
      return comparison(subMonths(from, 1), subMonths(to, 1));
    }

    case 'prev-year':
      // CALENDAR-ALIGNED FROM MONTH LEVEL UP (02C widened this from the year shapes). A
      // 364-day shift on a month straddles two of them — July 2026 would compare against
      // roughly 3 Jul – 2 Aug 2025, a total mixing July and August takings that no
      // operator would recognise as "last July". Month menus no longer offer this id at
      // all; the branch is fixed anyway so no path can return that window.
      if (
        shape === 'year' ||
        shape === 'year-to-date' ||
        shape === 'month' ||
        shape === 'month-to-date'
      ) {
        return comparison(subYears(from, 1), subYears(to, 1));
      }
      // Below month level the window IS the unit being compared, and shifting it whole is
      // what makes "the same Wednesday last year" mean anything.
      return comparison(subDays(from, 364), subDays(to, 364));

    // Same window, different pairing — see the prev-month pair above.
    case 'prev-year-by-day':
    case 'dates-last-year':
      return comparison(subYears(from, 1), subYears(to, 1));
  }
}
