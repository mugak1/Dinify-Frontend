// Reports module — real-branch parsing layer.
//
// Dormant while USE_MOCK_DATA = true. These normalise a raw backend payload
// (paginated `records`, `results`, or a bare array) into the typed row models,
// so flipping the mock flag in ReportsService is a one-line change.

import {
  DinersListingRow,
  DinersSummary,
  MenuRow,
  PaymentMode,
  PaymentStatus,
  SalesAggregateRow,
  SalesListingRow,
  TransactionStatus,
  TransactionType,
  TransactionsByStatusRow,
  TransactionsByTypeRow,
  TransactionsListingRow,
  TransactionsSummary,
} from '../models/reports.models';

function num(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// Backend transaction_type vocabulary -> the FE's neutral display tokens. The
// backend prefixes order-scoped types with `order_` (order_payment / order_refund
// / order_charge, see configss/string_definitions.py); the FE TransactionType is
// payment/refund/charge/subscription. Strip the prefix so a refund renders
// 'Refund', not the `?? 'Payment'` fallback the raw `order_refund` token would hit.
function txnType(raw: any): TransactionType {
  const token = String(raw ?? '')
    .toLowerCase()
    .replace(/^order_/, '');
  if (token === 'payment' || token === 'refund' || token === 'charge' || token === 'subscription') {
    return token;
  }
  return 'payment';
}

function toArray(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.records)) return raw.records;
  if (Array.isArray(raw?.results)) return raw.results;
  // menu-summary wraps its rows in `data: { grouping, rows: [...] }`; every
  // other caller passes a bare array (handled above), so this is menu-only.
  if (Array.isArray(raw?.rows)) return raw.rows;
  return [];
}

export function adaptSalesAggregate(raw: any): SalesAggregateRow[] {
  return toArray(raw).map((r) => ({
    period: String(r?.period ?? r?.date ?? ''),
    // sales-trends emits the per-bucket order count as `count`.
    orders: num(r?.orders ?? r?.order_count ?? r?.count),
    revenue: num(r?.revenue ?? r?.net_revenue),
    discount: num(r?.discount ?? r?.discount_total),
  }));
}

export function adaptSalesListing(raw: any): SalesListingRow[] {
  return toArray(raw).map((r) => ({
    order_number: String(r?.order_number ?? r?.order_no ?? ''),
    item_count: num(r?.item_count ?? r?.items),
    gross: num(r?.gross ?? r?.gross_amount),
    discount: num(r?.discount ?? r?.discount_amount),
    revenue: num(r?.revenue ?? r?.net_amount),
    payment_mode: (r?.payment_mode ?? 'Cash') as PaymentMode,
    payment_status: (r?.payment_status ?? 'paid') as PaymentStatus,
    time_created: String(r?.time_created ?? r?.created_at ?? ''),
  }));
}

export function adaptMenuSummary(raw: any): MenuRow[] {
  return toArray(raw).map((r) => ({
    name: String(r?.name ?? r?.label ?? ''),
    order_count: num(r?.order_count ?? r?.orders),
    quantity_sold: num(r?.quantity_sold ?? r?.qty ?? r?.quantity),
    revenue: num(r?.revenue ?? r?.net_revenue),
  }));
}

export function adaptTransactionsSummary(raw: any): TransactionsSummary {
  const byStatus: TransactionsByStatusRow[] = toArray(raw?.by_status ?? raw?.byStatus).map((r) => ({
    status: String(r?.status ?? '').toLowerCase() as TransactionStatus,
    count: num(r?.count),
    amount: num(r?.amount ?? r?.total),
  }));
  const byType: TransactionsByTypeRow[] = toArray(raw?.by_type ?? raw?.byType).map((r) => ({
    type: txnType(r?.type),
    count: num(r?.count),
    amount: num(r?.amount ?? r?.total),
  }));
  // Backend emits `total_transactions`; the reduce stays as a defensive fallback.
  const totalCount =
    num(raw?.total_transactions ?? raw?.total_count ?? raw?.totalCount) ||
    byStatus.reduce((a, r) => a + r.count, 0);
  return { byStatus, byType, totalCount };
}

export function adaptTransactionsListing(raw: any): TransactionsListingRow[] {
  return toArray(raw).map((r) => ({
    order_number: String(r?.order_number ?? r?.order_no ?? ''),
    // Normalise the backend `order_*` type vocabulary to the FE token; lowercase
    // the status (backend already emits raw lowercase success/failed/…).
    transaction_type: txnType(r?.transaction_type ?? r?.type),
    transaction_status: String(
      r?.transaction_status ?? r?.status ?? 'pending',
    ).toLowerCase() as TransactionStatus,
    amount: num(r?.amount),
    payment_mode: (r?.payment_mode ?? 'Cash') as PaymentMode,
    transaction_platform: String(r?.transaction_platform ?? r?.platform ?? ''),
    time_created: String(r?.time_created ?? r?.created_at ?? ''),
  }));
}

export function adaptDinersSummary(raw: any): DinersSummary {
  // Backend emits `most_active_diner`; keep the camel/short variants as fallbacks.
  const ma = raw?.most_active_diner ?? raw?.most_active ?? raw?.mostActive ?? null;
  return {
    identifiedDiners: num(raw?.identified_diners ?? raw?.identifiedDiners),
    repeatDiners: num(raw?.repeat_diners ?? raw?.repeatDiners),
    guestOrders: num(raw?.guest_orders ?? raw?.guestOrders),
    // Backend emits `average_spend_per_identified_diner`.
    avgSpendPerDiner: num(
      raw?.average_spend_per_identified_diner ??
        raw?.avg_spend_per_diner ??
        raw?.avgSpendPerDiner,
    ),
    mostActive: ma
      ? { name: String(ma?.name ?? ''), totalSpend: num(ma?.total_spend ?? ma?.totalSpend) }
      : undefined,
  };
}

export function adaptDinersListing(raw: any): DinersListingRow[] {
  return toArray(raw).map((r) => ({
    customer_id: String(r?.customer_id ?? r?.id ?? ''),
    name: String(r?.name ?? r?.customer_name ?? ''),
    phone_number: String(r?.phone_number ?? r?.phone ?? ''),
    no_orders: num(r?.no_orders ?? r?.order_count),
    total_spend: num(r?.total_spend ?? r?.total),
    average_spend: num(r?.average_spend ?? r?.avg_spend),
    last_order_date: String(r?.last_order_date ?? r?.last_order ?? ''),
  }));
}
