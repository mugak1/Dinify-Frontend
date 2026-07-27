// Shared timeframe core — the range model.
//
// Relocated out of the Reports module (TIMEFRAME-01A) so Dashboard can adopt the
// same vocabulary in 01B. Pure functions and types only: no DI, no HTTP, no
// component. The identifiers keep their `Report*` names deliberately — renaming
// `ReportDateRange` to `DateRange` would collide with the dashboard's coarse
// 'day'|'week'|'month'|'ytd' enum, which is exactly the type 01B deletes.

import {
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  isValid,
  min,
  parseISO,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
} from 'date-fns';
import { COMPARISON_OPTIONS, ComparisonOption } from './comparison-option';

export type ReportPreset =
  | 'today'
  | 'yesterday'
  | 'this-week'
  | 'last-week'
  | 'this-month'
  | 'last-month'
  | 'this-year'
  | 'custom';

/** Inclusive range. `from`/`to` are zero-padded ISO calendar dates (yyyy-MM-dd). */
export interface ReportDateRange {
  preset: ReportPreset;
  from: string;
  to: string;
}

export const REPORT_PRESETS: ReportPreset[] = [
  'today',
  'yesterday',
  'this-week',
  'last-week',
  'this-month',
  'last-month',
  'this-year',
  'custom',
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const fmt = (d: Date): string => format(d, 'yyyy-MM-dd');

/** The earlier of a period's end and `now` — keeps in-progress presets from running
 *  into the future. Both arguments carry a time component; only the date survives. */
const clampToToday = (periodEnd: Date, now: Date): string => fmt(min([periodEnd, now]));

/**
 * Maps a preset to a concrete {from,to}. Week starts Monday (Uganda convention,
 * and keeps specs deterministic). `custom` returns a single-day seed that the
 * date-range control overwrites with the user's two inputs.
 *
 * The three IN-PROGRESS presets — this-week / this-month / this-year — end at TODAY,
 * not at the end of the period: a range must never extend into the future. Reporting
 * on days that have not happened yet padded every chart with empty buckets and made
 * the range label ("1–31 Jul" on the 3rd) read as a promise the data could not keep.
 * The three CLOSED presets (yesterday, last-week, last-month) and `custom` are
 * untouched — they are already wholly in the past.
 *
 * Consequence worth knowing: on the first day or two of a period the clamped span is
 * ≤ 1 day, so `resolveTimeframe` buckets it by hour — "This week" on a Monday renders
 * the hour-of-day view, exactly as "Today" does. That is the ladder working as
 * designed, not a special case.
 */
export function presetToRange(preset: ReportPreset, now: Date = new Date()): ReportDateRange {
  switch (preset) {
    case 'today':
      return { preset, from: fmt(now), to: fmt(now) };
    case 'yesterday': {
      const y = subDays(now, 1);
      return { preset, from: fmt(y), to: fmt(y) };
    }
    case 'this-week':
      return {
        preset,
        from: fmt(startOfWeek(now, { weekStartsOn: 1 })),
        to: clampToToday(endOfWeek(now, { weekStartsOn: 1 }), now),
      };
    case 'last-week': {
      const lw = subWeeks(now, 1);
      return {
        preset,
        from: fmt(startOfWeek(lw, { weekStartsOn: 1 })),
        to: fmt(endOfWeek(lw, { weekStartsOn: 1 })),
      };
    }
    case 'this-month':
      return { preset, from: fmt(startOfMonth(now)), to: clampToToday(endOfMonth(now), now) };
    case 'last-month': {
      const lm = subMonths(now, 1);
      return { preset, from: fmt(startOfMonth(lm)), to: fmt(endOfMonth(lm)) };
    }
    case 'this-year':
      return { preset, from: fmt(startOfYear(now)), to: clampToToday(endOfYear(now), now) };
    case 'custom':
      return { preset, from: fmt(now), to: fmt(now) };
  }
}

/** Default landing range — MONTH-TO-DATE (1st → today), so it is always ≤31 days and
 *  the full Sales experience renders without a trailing run of empty buckets. */
export function defaultRange(now: Date = new Date()): ReportDateRange {
  return presetToRange('this-month', now);
}

/** Guard used by the persisted-state seed and any untrusted input. Deliberately does
 *  NOT range-check against today — `isFutureDated` is the separate, composable rule,
 *  so a caller can validate shape without also asserting recency. */
export function isValidReportDateRange(v: unknown): v is ReportDateRange {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['preset'] === 'string' &&
    REPORT_PRESETS.includes(r['preset'] as ReportPreset) &&
    typeof r['from'] === 'string' &&
    ISO_DATE.test(r['from']) &&
    typeof r['to'] === 'string' &&
    ISO_DATE.test(r['to']) &&
    r['from'] <= r['to']
  );
}

/** True when either bound lies after today. ISO `yyyy-MM-dd` strings sort
 *  chronologically, so a string compare is the whole test. */
export function isFutureDated(range: { from: string; to: string }, now: Date = new Date()): boolean {
  const today = fmt(now);
  return range.from > today || range.to > today;
}

/**
 * True when TODAY falls inside the (inclusive) range — i.e. the range is still OPEN and
 * its numbers can still change. A closed window cannot, so a surface polling one is
 * spending requests on an answer that is already final.
 *
 * Written as the honest two-sided test rather than `to === today`. Those are equivalent
 * only because `presetToRange` clamps and `parseTimeframeParams` rejects future bounds —
 * invariants that live in other functions and could be relaxed without anyone thinking
 * to look here. Same string-compare trick as `isFutureDated`: ISO dates sort
 * chronologically.
 */
export function rangeIncludesToday(
  range: { from: string; to: string },
  now: Date = new Date(),
): boolean {
  const today = fmt(now);
  return range.from <= today && today <= range.to;
}

/**
 * A real calendar date in `yyyy-MM-dd`. The regex alone accepts `2026-02-31`, so the
 * parsed value is round-tripped back through `format` — if the two disagree, date-fns
 * rolled the day over and the input was never a real date.
 */
function isRealIsoDate(v: string | null): v is string {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) return false;
  const parsed = parseISO(v);
  return isValid(parsed) && fmt(parsed) === v;
}

/** The URL query params the timeframe owns — each independently absent. */
export interface TimeframeParams {
  from: string | null;
  to: string | null;
  preset: string | null;
  /** Comparison basis (TIMEFRAME-02A). Absent whenever the selection is the default. */
  cmp: string | null;
}

/**
 * What the URL yielded: the range, plus the comparison basis if one was named.
 *
 * `comparison` is `null` for an absent OR unrecognised `cmp` — the caller then falls
 * back to its seed and finally to the shape's default, exactly as it does for a missing
 * range. It is deliberately NOT resolved to a default here: this function has no idea
 * what shape the range is, and the shape is what decides which bases are on offer.
 */
export interface ParsedTimeframe {
  range: ReportDateRange;
  comparison: ComparisonOption | null;
}

/**
 * Parses URL query params into a range + comparison basis, or `null` when the range
 * params are absent or unusable. NEVER throws — a hand-edited URL is untrusted input,
 * not an error condition.
 *
 * A param triple is accepted when both bounds are real `yyyy-MM-dd` dates, `from <= to`,
 * and neither bound is in the future. `preset` is treated as METADATA, not as a
 * validity condition: absent or unrecognised coerces to `'custom'` rather than
 * rejecting an otherwise-good range. It is carried explicitly (never re-derived from
 * the dates) because it breaks the shape tie on the 1st of a period, and re-deriving it
 * would make a shared link mean something different tomorrow than it did today.
 *
 * `cmp` is validated only as a KNOWN TOKEN. Whether that basis is offered for this
 * particular range is a shape question, and shape lives in `timeframe-engine.ts`, which
 * imports this file — so asking here would be a cycle. `TimeframeService` owns that
 * second check. THE ONE URL PARSER: everything the timeframe reads off the query string
 * is read here, so there is a single place where an untrusted URL is made safe.
 */
export function parseTimeframeParams(
  params: TimeframeParams,
  now: Date = new Date(),
): ParsedTimeframe | null {
  const { from, to } = params;
  if (!isRealIsoDate(from) || !isRealIsoDate(to)) return null;
  if (from > to) return null;
  if (isFutureDated({ from, to }, now)) return null;

  const preset = REPORT_PRESETS.includes(params.preset as ReportPreset)
    ? (params.preset as ReportPreset)
    : 'custom';

  const comparison = COMPARISON_OPTIONS.includes(params.cmp as ComparisonOption)
    ? (params.cmp as ComparisonOption)
    : null;

  return { range: { preset, from, to }, comparison };
}
