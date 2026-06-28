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

/**
 * Granularity the Sales tab requests as the sales-trends `category`. Mirrors the
 * backend's accepted category set and the timeframe engine's `SalesTrendsCategory`
 * (reports-timeframe.ts) — the engine picks which one a given range needs (year-wide
 * ranges resolve to `annual`; `quarterly` is accepted but never auto-selected).
 */
export type ReportGranularity = 'daily' | 'monthly' | 'quarterly' | 'annual';

export interface SalesAggregateRow {
  /** ISO label: yyyy-MM-dd (daily) or yyyy-MM (monthly) — sorts chronologically as text. */
  period: string;
  orders: number;
  /** UGX, net of discount (gross − discount). */
  revenue: number;
  /** UGX. */
  discount: number;
}

/**
 * Live `sales-hourly` contract: exactly 24 zero-filled rows, one per hour-of-day
 * (0–23), aggregated across the requested window. Raw — the UI owns the display
 * window and any "peak" labelling. Note the backend key is `count` (NOT `orders`).
 */
export interface SalesHourlyRow {
  /** Hour of day, 0–23. */
  hour: number;
  /** Orders in that hour-of-day across the range. */
  count: number;
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

// ── Menu performance ──────────────────────────────────────
/** Aggregation level for the menu-performance report. */
export type MenuGrouping = 'sections' | 'groups' | 'items';

export interface MenuRow {
  /** Section, group or item display name, depending on the active grouping. */
  name: string;
  order_count: number;
  quantity_sold: number;
  /** UGX. */
  revenue: number;
}

// ── Transactions ──────────────────────────────────────────
/**
 * Lowercase status tokens. The backend emits Success/Failed/Pending/Initiated;
 * the adapter lowercases them so they feed the report-table status pill directly.
 */
export type TransactionStatus = 'success' | 'failed' | 'pending' | 'initiated';

/**
 * Internal transaction-type tokens. Mapped to neutral, non-custodial labels for
 * display (Payment/Refund/Charge/Subscription) — Dinify never disburses, so there
 * is deliberately no 'disbursement' member.
 */
export type TransactionType = 'payment' | 'refund' | 'charge' | 'subscription';

export interface TransactionsByStatusRow {
  status: TransactionStatus;
  count: number;
  /** UGX. */
  amount: number;
}

export interface TransactionsByTypeRow {
  type: TransactionType;
  count: number;
  /** UGX. */
  amount: number;
}

export interface TransactionsSummary {
  byStatus: TransactionsByStatusRow[];
  byType: TransactionsByTypeRow[];
  totalCount: number;
}

export interface TransactionsListingRow {
  order_number: string;
  transaction_type: TransactionType;
  transaction_status: TransactionStatus;
  /** UGX. */
  amount: number;
  payment_mode: PaymentMode;
  transaction_platform: string;
  /** ISO 8601 datetime. */
  time_created: string;
}

// ── Diners ────────────────────────────────────────────────
export interface DinersSummary {
  identifiedDiners: number;
  repeatDiners: number;
  /** Orders placed by un-identified guests — a standalone count, not rows. */
  guestOrders: number;
  /** UGX, mean spend across identified diners. */
  avgSpendPerDiner: number;
  mostActive?: { name: string; totalSpend: number };
}

export interface DinersListingRow {
  customer_id: string;
  name: string;
  phone_number: string;
  no_orders: number;
  /** UGX. */
  total_spend: number;
  /** UGX, per-diner mean — NEVER summed in a totals footer. */
  average_spend: number;
  /** ISO 8601 datetime. */
  last_order_date: string;
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
