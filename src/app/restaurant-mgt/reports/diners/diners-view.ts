// Pure presentation logic for the Diners tab.
//
// The honesty-laden tab: the backend separates IDENTIFIED diners (account-holders)
// from ANONYMOUS guests (the majority, an order count only) and computes NO
// new-vs-returning. These helpers mirror that — an ORDER-level identified-vs-anonymous
// split (consistent units on both sides), a "repeat vs one-time" identified breakdown
// (NEVER "new vs returning"), and a spend-ranked leaderboard. No DI, no component —
// every transform is unit-testable (diners-view.spec.ts).

import { differenceInCalendarDays, format, parseISO, subDays } from 'date-fns';
import { DinersListingRow, DinersSummary, ReportDateRange } from '../models/reports.models';

/** Display name — full name, phone-number fallback (mirrors the backend `_diner_name`). */
export function dinerName(row: { name?: string; phone_number?: string }): string {
  return (row.name ?? '').trim() || (row.phone_number ?? '').trim() || 'Guest';
}

/** Total IDENTIFIED orders in the window (Σ no_orders across the identified listing). */
export function sumIdentifiedOrders(rows: DinersListingRow[]): number {
  return rows.reduce((a, r) => a + r.no_orders, 0);
}

export interface OrderSplit {
  identified: number;
  guest: number;
  total: number;
  identifiedPct: number;
  guestPct: number;
}

/** Order-level identified-vs-anonymous split — BOTH sides are ORDER counts (consistent units). */
export function orderSplit(identifiedOrders: number, guestOrders: number): OrderSplit {
  const identified = Math.max(0, identifiedOrders);
  const guest = Math.max(0, guestOrders);
  const total = identified + guest;
  return {
    identified,
    guest,
    total,
    identifiedPct: total > 0 ? (identified / total) * 100 : 0,
    guestPct: total > 0 ? (guest / total) * 100 : 0,
  };
}

export interface RepeatBreakdown {
  repeat: number;
  oneTime: number;
  identified: number;
  repeatPct: number;
}

/** Within the IDENTIFIED subset: repeat (>1 order in range) vs one-time. NEVER "new vs returning". */
export function repeatBreakdown(summary: DinersSummary | null): RepeatBreakdown {
  const identified = summary?.identifiedDiners ?? 0;
  const repeat = Math.min(summary?.repeatDiners ?? 0, identified);
  const oneTime = Math.max(0, identified - repeat);
  return { repeat, oneTime, identified, repeatPct: identified > 0 ? (repeat / identified) * 100 : 0 };
}

/** Repeat rate among identified diners (%). */
export function repeatRate(summary: DinersSummary | null): number {
  const identified = summary?.identifiedDiners ?? 0;
  return identified > 0 ? ((summary?.repeatDiners ?? 0) / identified) * 100 : 0;
}

/** Identified diners ranked by spend (desc) — the leaderboard order. */
export function rankDiners(rows: DinersListingRow[]): DinersListingRow[] {
  return [...rows].sort((a, b) => b.total_spend - a.total_spend);
}

// ── 31-day listing cap — show the recent window, don't hide (tab-local copy) ───
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
