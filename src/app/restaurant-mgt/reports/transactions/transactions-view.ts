// Pure presentation logic for the Transactions tab.
//
// Transactions is the most payment-gated tab — its real data lives on
// DinifyTransaction and stays empty until the PSP/payment integration (Gate 2).
// Built fully on mock now. These helpers turn the range-scoped summary into the
// chips + status breakdown, and own the PROVISIONAL display vocab. No DI, no
// component — every transform is unit-testable (transactions-view.spec.ts).

import { differenceInCalendarDays, format, parseISO, subDays } from 'date-fns';
import { ReportDateRange, TransactionsSummary } from '../models/reports.models';

// ── PROVISIONAL display vocab (reconciled at Gate 2) ───────────────────────────
// Presentation intent ONLY. Driven by whatever token a row carries (+ a humanize
// fallback), NOT a canonical enum the component depends on — so the real backend
// vocab (status success/failed/pending/initiated; payment_mode momo/card/cash)
// renders WITHOUT a re-layout when this flips.

function humanize(token: string): string {
  const t = (token ?? '').replace(/[_-]+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

const METHOD_DISPLAY: Record<string, string> = {
  momo: 'Mobile money',
  mobile_money: 'Mobile money',
  card: 'Card',
  cash: 'Cash',
};

/** The mock already carries friendly 'MTN MoMo'/'Airtel MoMo'/'Cash'; real tokens map here. */
export function methodDisplay(mode: string): string {
  return METHOD_DISPLAY[(mode ?? '').toLowerCase()] ?? (mode || '—');
}

/** Cash is operator-asserted (self-reported), not PSP-confirmed. */
export function isCashMode(mode: string): boolean {
  return (mode ?? '').toLowerCase() === 'cash';
}

const TYPE_DISPLAY: Record<string, string> = {
  payment: 'Payment',
  refund: 'Refund',
  charge: 'Charge',
  subscription: 'Subscription',
};

export function typeDisplay(type: string): string {
  return TYPE_DISPLAY[(type ?? '').toLowerCase()] ?? humanize(type);
}

/**
 * PROVISIONAL status token for the listing pill — mapped to a token report-table
 * already colours (paid/refunded/pending/failed/initiated): a refund-TYPE row →
 * `refunded`, `success` → `paid`, otherwise the raw status passes through (so an
 * unknown real token still renders a sensible pill). Reconciled at Gate 2.
 */
export function listingDisplayStatus(type: string, status: string): string {
  if ((type ?? '').toLowerCase() === 'refund') return 'refunded';
  if ((status ?? '').toLowerCase() === 'success') return 'paid';
  return (status ?? '').toLowerCase();
}

// ── Range-aggregate chips ──────────────────────────────────────────────────────
function statusOf(s: TransactionsSummary, status: string): { count: number; amount: number } {
  const r = s.byStatus.find((x) => x.status === status);
  return { count: r?.count ?? 0, amount: r?.amount ?? 0 };
}
function typeOf(s: TransactionsSummary, type: string): { count: number; amount: number } {
  const r = s.byType.find((x) => x.type === type);
  return { count: r?.count ?? 0, amount: r?.amount ?? 0 };
}

export interface TxnMetrics {
  count: number;
  /** UGX, settled (success) amount. */
  gross: number;
  /** UGX, gross / count. */
  avgTicket: number;
  /** UGX, refund-type amount — MOCK-ONLY (no backend representation until Gate 2). */
  refunds: number;
}

export const EMPTY_TXN_METRICS: TxnMetrics = { count: 0, gross: 0, avgTicket: 0, refunds: 0 };

export function txnSummaryMetrics(summary: TransactionsSummary | null): TxnMetrics {
  if (!summary) return EMPTY_TXN_METRICS;
  const count = summary.totalCount;
  const gross = statusOf(summary, 'success').amount;
  return {
    count,
    gross,
    avgTicket: count > 0 ? Math.round(gross / count) : 0,
    refunds: typeOf(summary, 'refund').amount, // MOCK-ONLY
  };
}

// ── Status breakdown (the tab's value-add) ─────────────────────────────────────
export type DisplayTone = 'success' | 'warning' | 'secondary';

export interface BreakdownBucket {
  key: string;
  label: string;
  count: number;
  amount: number;
  tone: DisplayTone;
  /** 0–100, share of the bucket set by amount (bar width). */
  pct: number;
  /** Refunded is mock-only (Gate 2 backend addition). */
  mockOnly?: boolean;
}

export interface StatusBreakdown {
  buckets: BreakdownBucket[];
  /** % of transactions that settled cleanly (paid / total). */
  settledPct: number;
  /** refund count / paid count, as a %. */
  refundRate: number;
}

/** Zero-filled onto the design's fixed {Paid, Refunded, Pending} axis (mirrors the backend fill). */
export function statusBreakdown(summary: TransactionsSummary | null): StatusBreakdown {
  const s: TransactionsSummary = summary ?? { byStatus: [], byType: [], totalCount: 0 };
  const paid = statusOf(s, 'success');
  const pending = statusOf(s, 'pending');
  const refund = typeOf(s, 'refund'); // refund is a TYPE, surfaced as a pseudo-status (mock-only)

  const raw: BreakdownBucket[] = [
    { key: 'paid', label: 'Paid', count: paid.count, amount: paid.amount, tone: 'success', pct: 0 },
    { key: 'refunded', label: 'Refunded', count: refund.count, amount: refund.amount, tone: 'secondary', pct: 0, mockOnly: true },
    { key: 'pending', label: 'Pending', count: pending.count, amount: pending.amount, tone: 'warning', pct: 0 },
  ];
  const max = raw.reduce((m, b) => Math.max(m, b.amount), 0);
  const buckets = raw.map((b) => ({ ...b, pct: max > 0 ? Math.round((b.amount / max) * 100) : 0 }));

  return {
    buckets,
    settledPct: s.totalCount > 0 ? (paid.count / s.totalCount) * 100 : 0,
    refundRate: paid.count > 0 ? (refund.count / paid.count) * 100 : 0,
  };
}

// ── Listing filter chips → real ?status= / ?type= params ───────────────────────
export type TxnFilterChip = 'all' | 'paid' | 'refunded' | 'pending' | 'failed';

export interface TxnFilter {
  status?: string;
  type?: string;
}

export const TXN_FILTER_CHIPS: { key: TxnFilterChip; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'paid', label: 'Paid' },
  { key: 'refunded', label: 'Refunded' },
  { key: 'pending', label: 'Pending' },
  { key: 'failed', label: 'Failed' },
];

/** PROVISIONAL chip → backend filter. Status chips map onto the real transactions-listing ?status=. */
export function filterChipParam(chip: TxnFilterChip): TxnFilter {
  switch (chip) {
    case 'paid':
      return { status: 'success' };
    case 'pending':
      return { status: 'pending' };
    case 'failed':
      return { status: 'failed' };
    case 'refunded':
      return { type: 'refund' }; // refund is a TYPE, not a status (Gate-2 nuance)
    case 'all':
    default:
      return {};
  }
}

// ── 31-day listing cap — show the recent window, don't hide ────────────────────
export const LISTING_CAP_DAYS = 31;

export interface ListingWindow {
  from: string;
  to: string;
  capped: boolean;
}

export function recentWindow(range: ReportDateRange): ListingWindow {
  const span = differenceInCalendarDays(parseISO(range.to), parseISO(range.from));
  if (span <= LISTING_CAP_DAYS) return { from: range.from, to: range.to, capped: false };
  return {
    from: format(subDays(parseISO(range.to), LISTING_CAP_DAYS), 'yyyy-MM-dd'),
    to: range.to,
    capped: true,
  };
}
