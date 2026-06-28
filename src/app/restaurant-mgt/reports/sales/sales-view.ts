// Pure presentation logic for the Sales tab.
//
// Consumes the PR-A timeframe engine's `bucketUnit` (range/bucket math lives in
// reports-timeframe.ts — NOT reimplemented here) and shapes the service rows into
// the cards' view models: per-bucket points, range totals, the weekday cycle, and
// the hour-of-day display window. No DI, no component, no fetching — so every
// transform is unit-testable in isolation (sales-view.spec.ts).

import { format, getDay, parseISO } from 'date-fns';
import { ReportBucketUnit } from '../utils/reports-timeframe';
import { SalesAggregateRow, SalesHourlyRow } from '../models/reports.models';

/** Which service feeds a bucket + how the breakdown table is titled. */
export type SalesSource = 'hourly' | 'daily' | 'monthly' | 'annual';

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

function formatPeriodLabel(period: string, source: SalesSource): string {
  const d = parseISO(period);
  if (source === 'annual') return format(d, 'yyyy');
  return source === 'monthly' ? format(d, 'MMM yyyy') : format(d, 'd MMM');
}

/** Hourly rows OR aggregate rows → one common point shape, labelled for the bucket. */
export function normalizeSeries(
  rows: SalesAggregateRow[] | SalesHourlyRow[],
  bucketUnit: ReportBucketUnit,
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
  return (rows as SalesAggregateRow[]).map((r) => ({
    label: formatPeriodLabel(r.period, source),
    key: r.period,
    revenue: r.revenue,
    orders: r.orders,
    discount: r.discount,
  }));
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
