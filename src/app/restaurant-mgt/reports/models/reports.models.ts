// Reports module — shared models + pure date helpers.
//
// One shared, persisted preset date-range drives every report. The table types
// are deliberately generic so the report-table component carries zero
// report-specific logic.

import {
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
} from 'date-fns';

export type ReportKey = 'sales' | 'menu' | 'transactions' | 'diners';

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

export type ReportGranularity = 'daily' | 'monthly';

export interface SalesAggregateRow {
  /** ISO label: yyyy-MM-dd (daily) or yyyy-MM (monthly) — sorts chronologically as text. */
  period: string;
  orders: number;
  /** UGX, net of discount (gross − discount). */
  revenue: number;
  /** UGX. */
  discount: number;
}

export type PaymentMode = 'MTN MoMo' | 'Airtel MoMo' | 'Cash';
export type PaymentStatus = 'paid' | 'pending' | 'failed' | 'refunded';

export interface SalesListingRow {
  order_number: string;
  item_count: number;
  /** UGX before discount. */
  gross: number;
  /** UGX. */
  discount: number;
  /** UGX, net (gross − discount). */
  revenue: number;
  payment_mode: PaymentMode;
  payment_status: PaymentStatus;
  /** ISO 8601 datetime. */
  time_created: string;
}

export interface SalesListingTotals {
  orders: number;
  gross: number;
  discount: number;
  revenue: number;
}

export type ReportColumnFormat = 'text' | 'number' | 'ugx' | 'datetime' | 'status';

export interface ReportColumn {
  /** Row property key. */
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  format?: ReportColumnFormat;
  /** Include this column in the totals footer. */
  total?: boolean;
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

/**
 * Maps a preset to a concrete {from,to}. Week starts Monday (Uganda convention,
 * and keeps specs deterministic). `custom` returns a single-day seed that the
 * date-range control overwrites with the user's two inputs.
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
        to: fmt(endOfWeek(now, { weekStartsOn: 1 })),
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
      return { preset, from: fmt(startOfMonth(now)), to: fmt(endOfMonth(now)) };
    case 'last-month': {
      const lm = subMonths(now, 1);
      return { preset, from: fmt(startOfMonth(lm)), to: fmt(endOfMonth(lm)) };
    }
    case 'this-year':
      return { preset, from: fmt(startOfYear(now)), to: fmt(endOfYear(now)) };
    case 'custom':
      return { preset, from: fmt(now), to: fmt(now) };
  }
}

/** Default landing range — this-month is always ≤31 days, so the full Sales experience renders. */
export function defaultRange(now: Date = new Date()): ReportDateRange {
  return presetToRange('this-month', now);
}

/** Guard used by the persisted-state seed and any untrusted input. */
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
