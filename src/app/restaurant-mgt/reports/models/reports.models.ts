// Reports module — report-specific models.
//
// One shared date-range drives every report; that range model, the timeframe
// engine and the URL-backed state that owns them all live in
// `_shared/timeframe/` (relocated in TIMEFRAME-01A so Dashboard can adopt them in
// 01B) — import `ReportDateRange` / `ReportPreset` from there, not from here. What
// remains below is Reports' own vocabulary. The table types are deliberately
// generic so the report-table component carries zero report-specific logic.

export type ReportKey = 'sales' | 'menu' | 'transactions' | 'diners';

/**
 * Granularity the Sales tab requests as the sales-trends `category`. Mirrors the
 * backend's accepted category set and the timeframe engine's `SalesTrendsCategory`
 * (`_shared/timeframe/timeframe-engine.ts`) — the engine picks which one a given
 * range needs (year-wide ranges resolve to `annual`; `quarterly` is accepted but
 * never auto-selected).
 */
export type ReportGranularity = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';

export interface SalesAggregateRow {
  /** ISO label: yyyy-MM-dd (daily, and weekly as the Monday) or yyyy-MM (monthly) —
   *  sorts chronologically as text. */
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
  /**
  * `null` means THE SERVER STATED NO TENDER (D07). It is not "Cash": nothing in
  * the platform records how a diner paid, so a row that carries no tender is a
  * row we know nothing about.
  */
  payment_mode: PaymentMode | null;
  /** `null` means the server stated no payment status — never "paid". */
  payment_status: PaymentStatus | null;
  /** ISO 8601 datetime. */
  time_created: string;
}

export interface SalesListingTotals {
  orders: number;
  gross: number;
  discount: number;
  revenue: number;
}

/**
 * `tender` is `text` PLUS THE ABSENCE RULE (D07/PR-6), and it exists because the
 * two are different facts. An empty `text` cell means the row carried nothing
 * worth printing; a tender column's empty cell means THE SERVER STATED NO
 * TENDER, which is the whole point of the null this adapter now preserves.
 *
 * Without it the Sales listing rendered a BLANK Method cell beside a `—` Status
 * cell on the same row — one absence spelled two ways, which reads as data loss
 * rather than as the deliberate statement it is. The other two consumers
 * (`statusLabel`, `methodDisplay`) already said `—`; this is that same rule
 * reaching the third.
 *
 * It maps no vocabulary and renames nothing: the `momo`/`cash`/`card` versus
 * `MTN MoMo`/`Cash` mismatch is a separate KNOWN GAP needing a product call, and
 * widening this token to touch it would be exactly the conflation D07 removes.
 */
export type ReportColumnFormat = 'text' | 'tender' | 'number' | 'ugx' | 'datetime' | 'status';

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
  /** `null` means the server stated no status — never "pending". */
  transaction_status: TransactionStatus | null;
  /** UGX. */
  amount: number;
  /** `null` means the server stated no tender — see SalesListingRow. */
  payment_mode: PaymentMode | null;
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
