// Reports module — real-branch parsing layer.
//
// Dormant while USE_MOCK_DATA = true. These normalise a raw backend payload
// (paginated `records`, `results`, or a bare array) into the typed row models,
// so flipping the mock flag in ReportsService is a one-line change.

import {
  PaymentMode,
  PaymentStatus,
  SalesAggregateRow,
  SalesListingRow,
} from '../models/reports.models';

function num(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function toArray(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.records)) return raw.records;
  if (Array.isArray(raw?.results)) return raw.results;
  return [];
}

export function adaptSalesAggregate(raw: any): SalesAggregateRow[] {
  return toArray(raw).map((r) => ({
    period: String(r?.period ?? r?.date ?? ''),
    orders: num(r?.orders ?? r?.order_count),
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
