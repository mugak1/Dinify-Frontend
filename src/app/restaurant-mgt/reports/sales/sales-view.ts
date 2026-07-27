// Pure presentation logic for the Sales tab.
//
// Consumes the PR-A timeframe engine's `bucketUnit` (range/bucket math lives in
// reports-timeframe.ts — NOT reimplemented here) and shapes the service rows into
// the cards' view models: per-bucket points, range totals, the weekday cycle, and
// the hour-of-day display window. No DI, no component, no fetching — so every
// transform is unit-testable in isolation (sales-view.spec.ts).

import {
  eachDayOfInterval,
  eachMonthOfInterval,
  eachWeekOfInterval,
  eachYearOfInterval,
  format,
  getDay,
  parseISO,
} from 'date-fns';
import { ReportBucketUnit, SeriesPairing } from '../../../_shared/timeframe';
import { SalesAggregateRow, SalesHourlyRow } from '../models/reports.models';

/** Which service feeds a bucket + how the breakdown table is titled. */
export type SalesSource = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'annual';

export interface SalesBucketView {
  source: SalesSource;
  /** Breakdown-table heading — renames with the bucket. */
  tableTitle: string;
}

/** A normalized per-bucket point every card renders from (hourly OR aggregate). */
export interface SalesPoint {
  /** Display label, e.g. '1 PM' · '15 Jun' · 'Jun 2026'. */
  label: string;
  /** Stable identity/sort key, e.g. '13' · '2026-06-15' · '2026-06'. */
  key: string;
  /** UGX, net of discount. */
  revenue: number;
  orders: number;
  /** UGX. */
  discount: number;
}

export interface SalesTotals {
  orders: number;
  /** UGX, gross = revenue + discount. */
  gross: number;
  /** UGX. */
  discounts: number;
  /** UGX, net of discount (NOT of refunds — the hero subtracts refunds separately). */
  revenue: number;
  /** UGX, average order value (revenue / orders). */
  aov: number;
}

export interface WeekdayRevenue {
  /** 0=Sun … 6=Sat (date-fns getDay). */
  weekday: number;
  label: string;
  revenue: number;
}

export interface HourBar {
  hour: number;
  label: string;
  revenue: number;
  orders: number;
  /** 0–100, relative to the busiest bar in the window. */
  pct: number;
  isPeak: boolean;
}

/** Mon-first ordering (Uganda week, matching presetToRange's weekStartsOn:1). */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_LABELS: Record<number, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};

/** Min inclusive span (days) before the weekday cycle is meaningful (≈2 weeks). */
export const WEEKDAY_MIN_DAYS = 14;

/** FE display window for the hour-of-day card — lunch through late dinner. */
export const HOUR_WINDOW_START = 11; // 11 AM
export const HOUR_WINDOW_END = 22; // 10 PM (inclusive)

/** Maps a resolved bucket to its data source + breakdown title (year → annual). */
export function salesBucketView(bucketUnit: ReportBucketUnit): SalesBucketView {
  switch (bucketUnit) {
    case 'hour':
      return { source: 'hourly', tableTitle: 'Hourly breakdown' };
    case 'day':
      return { source: 'daily', tableTitle: 'Daily breakdown' };
    case 'week':
      return { source: 'weekly', tableTitle: 'Weekly breakdown' };
    case 'year':
      return { source: 'annual', tableTitle: 'Yearly breakdown' };
    case 'month':
    default:
      return { source: 'monthly', tableTitle: 'Monthly breakdown' };
  }
}

/** 13 → '1 PM', 0 → '12 AM', 12 → '12 PM'. */
export function formatHourLabel(hour: number): string {
  const h = ((Math.trunc(hour) % 24) + 24) % 24;
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

/**
 * `weekly` shares the daily `yyyy-MM-dd` key format (the bucket's Monday), so its label
 * has to say WEEK explicitly — an unadorned '20 Jul' beside a daily axis is indistinguishable
 * from a single day's takings.
 */
function formatPeriodLabel(period: string, source: SalesSource): string {
  const d = parseISO(period);
  if (source === 'annual') return format(d, 'yyyy');
  if (source === 'monthly') return format(d, 'MMM yyyy');
  return source === 'weekly' ? `w/c ${format(d, 'd MMM')}` : format(d, 'd MMM');
}

/** The inclusive window a series was fetched over. Structural so a caller needn't invent a preset. */
export interface SeriesWindow {
  from: string;
  to: string;
}

/**
 * Every bucket key the window covers, ascending, in the WIRE `period` format the rows use.
 *
 * The formats have to match `formatPeriodLabel`'s `parseISO` input exactly, which is why this
 * lives beside `normalizeSeries` rather than in `_shared/timeframe/`: it emits a Reports wire
 * contract, not a timeframe concept. `dashboard-mock-data.ts`'s `generateDates` is the same
 * idea one surface over, but it emits ISO DATETIMES via `dayAtIso` — a different key format —
 * so it is precedent to follow, not code to import.
 *
 * `hour` never reaches here: its key is `'0'…'23'` with no date, and the caller exempts it.
 *
 * `week` IS KEYED TO ITS MONDAY, matching what the backend anchors to, and that key can fall
 * BEFORE `window.from` — by up to six days, whenever the window opens mid-week. That is not a
 * bug to guard against, it is the contract: `eachWeekOfInterval` snaps `start` back to its
 * containing week start, and defeating that (by pre-advancing `start` to the next Monday, say)
 * would leave the first returned bucket unmatched and densify it to zero. Every other bucket
 * happens to have `from` land on or after its own boundary, which is why nothing before this
 * had to state the rule.
 *
 * NOTE: this `switch` has a `default`, so adding a member to `ReportBucketUnit` does NOT make
 * the compiler flag it here. A new bucket needs an arm added by hand.
 */
function bucketKeysIn(window: SeriesWindow, bucketUnit: ReportBucketUnit): string[] {
  const start = parseISO(window.from);
  const end = parseISO(window.to);
  switch (bucketUnit) {
    case 'week':
      // Monday-first (Uganda convention, and what TRENDS-WEEKLY-00 anchors to server-side).
      return eachWeekOfInterval({ start, end }, { weekStartsOn: 1 }).map((d) =>
        format(d, 'yyyy-MM-dd'),
      );
    case 'month':
      return eachMonthOfInterval({ start, end }).map((d) => format(d, 'yyyy-MM'));
    case 'year':
      return eachYearOfInterval({ start, end }).map((d) => format(d, 'yyyy'));
    default:
      return eachDayOfInterval({ start, end }).map((d) => format(d, 'yyyy-MM-dd'));
  }
}

/**
 * Hourly rows OR aggregate rows → one common point shape, labelled for the bucket, ZERO-FILLED
 * to `window`.
 *
 * WHY DENSIFY. `reports_app/controllers/common/bucketing.py` zero-fills only the hourly path
 * (its line 111); the period path is a plain group-by, so a day with no orders is simply ABSENT
 * from the response. Closed days are ordinary in hospitality, so a sparse series is the normal
 * case, not an edge one — and it costs two things. The x-axis omits the closed day entirely,
 * drawing Sunday straight through to Tuesday as though the month ran unbroken; and every index
 * after the gap shifts, which misaligns `alignComparisonSeries` under BOTH pairings.
 *
 * A zero-filled bucket is not a fabricated point. The restaurant genuinely took nothing that
 * day, and saying so is more honest than not drawing it. (Contrast `alignComparisonSeries`,
 * which yields `null` past the end of the comparison series — there no corresponding bucket
 * EXISTS, so a zero would be an invention.)
 *
 * THE ENUMERATION DEFINES THE SERIES. Pass the window the rows were actually FETCHED over — for
 * the primary series that is `effectiveRange`, not the raw range, since the engine's over-cap
 * clamp moves `from`. `bucketKeysIn` turns that window into the exact key set the output carries,
 * and a returned bucket outside that set is dropped — carrying it would put an out-of-sequence
 * label on the axis.
 *
 * The enumeration is NOT the window's literal bounds, and the difference is load-bearing for
 * `week`: a weekly bucket is keyed to its Monday, so when the window opens mid-week the FIRST
 * enumerated key precedes `from` by up to six days — deliberately, because that is the key the
 * backend returns for the partial opening week. Matching it is what keeps that week's real
 * takings on the chart instead of zero-filling over them. (For every other bucket the two
 * coincide, which is why this used to read as "a bucket outside the window cannot occur".)
 *
 * `window: null` means DO NOT densify, and is the only escape hatch — used when no request was
 * made at all (the `'none'` comparison basis), where a full array of zero points would be a
 * baseline nobody asked for. The argument is required rather than defaulted so every call site
 * answers the question deliberately.
 *
 * `hour` is exempt: it is already dense by contract on both paths (the backend zero-fills it and
 * `getMockSalesHourly` returns exactly 24 rows), and its key carries no date for a window to
 * enumerate.
 */
export function normalizeSeries(
  rows: SalesAggregateRow[] | SalesHourlyRow[],
  bucketUnit: ReportBucketUnit,
  window: SeriesWindow | null,
): SalesPoint[] {
  const { source } = salesBucketView(bucketUnit);
  if (source === 'hourly') {
    return (rows as SalesHourlyRow[]).map((r) => ({
      label: formatHourLabel(r.hour),
      key: String(r.hour),
      revenue: r.revenue,
      orders: r.count,
      discount: r.discount,
    }));
  }

  const points = (rows as SalesAggregateRow[]).map((r) => ({
    label: formatPeriodLabel(r.period, source),
    key: r.period,
    revenue: r.revenue,
    orders: r.orders,
    discount: r.discount,
  }));
  if (!window) return points;

  const byKey = new Map(points.map((p) => [p.key, p]));
  return bucketKeysIn(window, bucketUnit).map(
    (key) =>
      byKey.get(key) ?? {
        label: formatPeriodLabel(key, source),
        key,
        revenue: 0,
        orders: 0,
        discount: 0,
      },
  );
}

/**
 * Buckets that actually traded — the honest divisor for a per-day average.
 *
 * `points.length` USED to mean this, but only by accident: the series was sparse, so absent
 * buckets were absent from the count. It was never a deliberate choice, and now that the series
 * is densified it would silently mean "calendar days" instead. Stating the predicate keeps the
 * number it feeds fixed across that change.
 *
 * KNOWN LIMIT OF THE PROXY: a missing bucket means "no orders", NOT "closed". This counts days
 * with at least one order and cannot tell a closure from an open day that took nothing.
 */
export function tradingBuckets(points: SalesPoint[]): number {
  return points.filter((p) => p.orders > 0).length;
}

/** A zeroed totals object — a safe default for the hero/KPI inputs before data lands. */
export const EMPTY_TOTALS: SalesTotals = { orders: 0, gross: 0, discounts: 0, revenue: 0, aov: 0 };

/** Range totals for the hero/KPI rail. `revenue` is net of discount (refunds handled by the hero). */
export function computeTotals(points: SalesPoint[]): SalesTotals {
  const orders = points.reduce((a, p) => a + p.orders, 0);
  const revenue = points.reduce((a, p) => a + p.revenue, 0);
  const discounts = points.reduce((a, p) => a + p.discount, 0);
  return {
    orders,
    gross: revenue + discounts,
    discounts,
    revenue,
    aov: orders > 0 ? Math.round(revenue / orders) : 0,
  };
}

/** The point with the highest revenue (the "best bucket"), or null for an empty series. */
export function bestPoint(points: SalesPoint[]): SalesPoint | null {
  if (!points.length) return null;
  return points.reduce((best, p) => (p.revenue > best.revenue ? p : best), points[0]);
}

/** A breakdown-table row (gross/discount/net) keyed for the best-bucket highlight. */
export interface SalesBreakdownRow {
  /** Hidden identity key for highlightRowKey (not a visible column). */
  key: string;
  label: string;
  orders: number;
  gross: number;
  discount: number;
  net: number;
}

/** Rolls the per-bucket points up into the on-screen breakdown rows. */
export function toBreakdownRows(points: SalesPoint[]): SalesBreakdownRow[] {
  return points.map((p) => ({
    key: p.key,
    label: p.label,
    orders: p.orders,
    gross: p.revenue + p.discount,
    discount: p.discount,
    net: p.revenue,
  }));
}

/** Footer totals for the breakdown table, keyed to its columns. */
export function breakdownTotals(points: SalesPoint[]): Record<string, number> {
  const t = computeTotals(points);
  return { orders: t.orders, gross: t.gross, discount: t.discounts, net: t.revenue };
}

/** Aggregates daily rows into a Mon-first weekday revenue cycle + the best weekday. */
export function aggregateByWeekday(rows: SalesAggregateRow[]): {
  days: WeekdayRevenue[];
  bestWeekday: number | null;
} {
  const totals = [0, 0, 0, 0, 0, 0, 0]; // indexed by getDay (0=Sun)
  for (const r of rows) totals[getDay(parseISO(r.period))] += r.revenue;

  const days = WEEKDAY_ORDER.map((wd) => ({
    weekday: wd,
    label: WEEKDAY_LABELS[wd],
    revenue: totals[wd],
  }));
  const top = days.reduce((best, d) => (d.revenue > best.revenue ? d : best), days[0]);
  return { days, bestWeekday: top.revenue > 0 ? top.weekday : null };
}

/** The weekday cycle needs a daily bucket and ≈2+ weeks; hides for short AND long ranges. */
export function weekdayEligible(bucketUnit: ReportBucketUnit, inclusiveDays: number): boolean {
  return bucketUnit === 'day' && inclusiveDays >= WEEKDAY_MIN_DAYS;
}

/** Slices the 24 hour-of-day rows to the FE display window with bar percentages + the peak. */
export function hourDisplayWindow(rows: SalesHourlyRow[]): {
  bars: HourBar[];
  peakHour: number | null;
} {
  const windowed = rows.filter((r) => r.hour >= HOUR_WINDOW_START && r.hour <= HOUR_WINDOW_END);
  const max = windowed.reduce((m, r) => Math.max(m, r.revenue), 0);
  const peak = windowed.reduce<SalesHourlyRow | null>(
    (best, r) => (best && best.revenue >= r.revenue ? best : r),
    null,
  );
  const peakHour = peak && peak.revenue > 0 ? peak.hour : null;
  const bars = windowed.map((r) => ({
    hour: r.hour,
    label: formatHourLabel(r.hour),
    revenue: r.revenue,
    orders: r.count,
    pct: max > 0 ? Math.round((r.revenue / max) * 100) : 0,
    isPeak: r.hour === peakHour,
  }));
  return { bars, peakHour };
}

/** Human label for the busiest hour — drives the "Lunch/Dinner peak" caption. */
export function peakLabel(hour: number | null): string {
  if (hour == null) return '';
  if (hour >= 12 && hour <= 14) return 'Lunch peak';
  if (hour >= 18 && hour <= 21) return 'Dinner peak';
  return 'Busiest hour';
}

// ─── Comparison-series pairing (TIMEFRAME-02C) ───────────────────────────────────────
//
// WHICH window the comparison is drawn from is `resolveComparison`'s job. HOW the two
// series line up inside the chart is this one's, and at month level it is a real question
// with two legitimate answers: a restaurant's Saturday does not resemble its Tuesday, so
// pairing July against June by calendar date sets Tue 7 Jul beside Sun 7 Jun and reads as
// a collapse that never happened — while accounting-style reconciliation wants exactly
// that date-against-date view.
//
// This lives here rather than in `_shared/timeframe/` for two reasons: it needs date-fns,
// which the zero-import comparison-option module must not take on; and it operates on
// `SalesPoint`, a Sales type the shared timeframe core has no business knowing about.

/** Monday-first weekday index, 0 = Mon … 6 = Sun. Matches `presetToRange`'s weekStartsOn. */
const mondayIndex = (isoDate: string): number => (getDay(parseISO(isoDate)) + 6) % 7;

/**
 * The comparison point to render at each PRIMARY index, or `null` where there is none.
 *
 * Returns POINTS rather than numbers so one alignment feeds both the chart series and the
 * tooltip's comparison date — a second lookup would mean a second offset calculation, and
 * two of those disagree the moment either changes.
 *
 * `by-date` is index pairing, which is what the chart has always done. `by-day` shifts the
 * lookup by the difference between the two series' opening weekdays, so weekdays meet:
 * July 2026 opens on a Wednesday and June 2026 on a Monday, giving an offset of 2, so
 * primary index 4 (Sun 5 Jul) reads comparison index 6 (Sun 7 Jun).
 *
 * THE OFFSET IS READ FROM THE SERIES' OWN FIRST `key`, NOT FROM THE WINDOW BOUNDS. Since
 * densification `normalizeSeries` zero-fills each series to the window it was fetched over, so
 * `points[0].key` IS that window's first bucket and the two derivations coincide — this is no
 * longer a choice between two answers.
 *
 * It stays data-derived because that form needs no window threaded through the card, and stays
 * correct under EITHER condition. `alignComparisonSeries` is exported and pure; handed a sparse
 * series directly it still self-corrects for leading gaps, because dropping a leading element
 * shifts every index down by one AND advances the observed opening weekday by one — the two
 * cancel exactly. Window bounds would compute an offset for a dense array and then index a
 * sparse one. The sparse-input specs in `sales-view.spec.ts` pin that residual robustness; they
 * pin the FUNCTION, not the pipeline, which no longer feeds it gaps.
 *
 * PAIRING APPLIES ONLY TO THE `day` BUCKET. Weekday alignment is meaningless once buckets
 * are months, and impossible for `hour`, where `key` is `'0'…'23'` and no date exists
 * anywhere in the pipeline. Any other bucket falls back to index pairing.
 *
 * `week` FALLING TO INDEX PAIRING IS CORRECT, NOT INCIDENTAL — do not "fix" it by widening the
 * guard. Both series are Monday-anchored on both sides, so index i is the i-th Monday in each
 * and positional pairing already aligns week to week; a weekday offset between two Mondays is
 * zero by construction. (It cannot even be reached: `pairingFor` returns `by-day` only for
 * `prev-month-by-day` / `prev-year-by-day`, offered at month shapes only, whose spans are ≤31
 * days and therefore resolve to the `day` bucket.)
 *
 * Out-of-range indices yield `null` — never wrapped, never clamped to the nearest end.
 * Chart.js draws a gap there (its `spanGaps` default is false), and a visible gap is
 * honest where a fabricated point is not.
 */
export function alignComparisonSeries(
  points: SalesPoint[],
  comparisonPoints: SalesPoint[],
  pairing: SeriesPairing,
  bucketUnit: ReportBucketUnit,
): (SalesPoint | null)[] {
  const offset =
    pairing === 'by-day' && bucketUnit === 'day' && points.length && comparisonPoints.length
      ? (mondayIndex(points[0].key) - mondayIndex(comparisonPoints[0].key) + 7) % 7
      : 0;

  return points.map((_, i) => comparisonPoints[i + offset] ?? null);
}

/**
 * A point's date, unambiguous enough to sit in a tooltip.
 *
 * The `day` and `week` cases format from `key` rather than reusing `label`, which is `'15 Jun'`
 * / `'w/c 15 Jun'` and carries NO YEAR — beside a `prev-year-by-day` or `dates-last-year`
 * comparison that would print a date indistinguishable from the primary's. Every other bucket's
 * label already carries a year (`'Jun 2026'`, `'2026'`) or is date-free (`'1 PM'`), so it is
 * reused. `week` keeps its `w/c` prefix here: a bare Monday date in a tooltip reads as a single
 * day's takings, which is precisely what the point is not.
 */
export function pointDateLabel(p: SalesPoint, bucketUnit: ReportBucketUnit): string {
  if (bucketUnit === 'week') return `w/c ${format(parseISO(p.key), 'd MMM yyyy')}`;
  return bucketUnit === 'day' ? format(parseISO(p.key), 'd MMM yyyy') : p.label;
}
