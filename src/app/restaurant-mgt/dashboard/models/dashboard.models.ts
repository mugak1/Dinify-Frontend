import { PaymentMeasurement } from '../../../_shared/reporting/payment-measurement';

// ── Date range ────────────────────────────────────────────
// The coarse 'day'|'week'|'month'|'ytd' enum that used to live here was deleted in
// TIMEFRAME-01B. The Dashboard now shares the range model in `_shared/timeframe`
// (`ReportDateRange` + `ReportBucketUnit`) with Reports, so arbitrary ranges are
// selectable and there is one timeframe vocabulary in the app rather than two.

// ── Revenue ───────────────────────────────────────────────
export interface RevenueSeriesPoint {
  at: string;
  gross: number;
  net: number;
  orders: number;
  aov: number;
}

export interface RevenueTotals {
  gross: number;
  net: number;
  discounts: number;
  refunds: number;
}

/**
 * WHICH PRICING CONVENTION PRODUCED `gross` AND `discounts` (D02/C, backend).
 *
 * D02 changed what two persisted columns MEAN: a CORRECTED order's `total_cost`
 * includes paid modifier costs and its `savings` can never be negative, while a
 * LEGACY order's excluded them and could be. A window spanning the deployment
 * therefore sums two measurements, and `net` is derived from both.
 *
 * NOTHING HERE REPRICES, EXCLUDES OR RECLASSIFIES AN ORDER — it is a disclosure
 * about COMPARABILITY, not about correctness, and the amount each diner paid is
 * unaffected. `notice` is present only when the window actually straddles the
 * boundary; one that appeared on every response would be ignored on the one
 * that mattered.
 *
 * OPTIONAL, deliberately: a response that predates the field says nothing, and
 * its absence must never be rendered as proof of a uniform convention.
 */
export interface PricingConventions {
  mixed: boolean;
  legacy_orders: number;
  corrected_orders: number;
  notice: string | null;
}

export interface RevenueData {
  series: RevenueSeriesPoint[];
  totals: RevenueTotals;
  pricing_conventions?: PricingConventions;
}

// ── Payment methods ───────────────────────────────────────
export interface PaymentMethodData {
  method: string;
  amount: number;
  tx_count: number;
}

// ── Orders ────────────────────────────────────────────────
export interface OrdersSeriesPoint {
  at: string;
  orders: number;
}

export interface OrdersBreakdown {
  paid: number;
  open: number;
  cancelled: number;
  refunded: number;
}

export interface OrdersData {
  series: OrdersSeriesPoint[];
  breakdown: OrdersBreakdown;
  total: number;
}

// ── Popular items ─────────────────────────────────────────
export interface PopularItemData {
  item_id: string;
  name: string;
  section: string;
  image_url?: string;
  revenue: number;
  qty: number;
}

// ── Tables ────────────────────────────────────────────────
export interface TablesData {
  total: number;
  occupied: number;
  available: number;
  needs_attention: number;
  occupancy_pct?: number;
  median_visit_minutes?: number | null;
  turns_today?: number;
  turns_yesterday?: number;
  avg_ticket_today?: number;
  avg_ticket_yesterday?: number;
}

// ── KDS ───────────────────────────────────────────────────
export interface KdsData {
  active: number;
  over_sla: number;
  at_risk: number;
  stale_ready: number;
  open_tickets?: number;
  avg_fulfillment_minutes?: number;
  target_minutes?: number;
  late_minutes?: number;
  oldest_ticket_minutes?: number;
}

// ── Reviews ───────────────────────────────────────────────
export interface ReviewDistribution {
  rating: number;
  count: number;
  percentage: number;
}

export interface RecentReview {
  review_id: string;
  rating: number;
  text: string;
  created_at: string;
  resolved: boolean;
}

export interface ReviewsSummaryResponse {
  avg_rating: number;
  total_reviews: number;
  distribution: ReviewDistribution[];
  recent: RecentReview[];
  low_rating_share?: number;
}

// ── Dashboard V2 composite response ──────────────────────
export interface DashboardV2Response {
  /**
   * Whether this platform measures settled payments, CLASSIFIED ONCE (D07).
   *
   * It replaced `payment_tracking_enabled?: boolean`, and the type change is
   * the point rather than tidying: an optional boolean has three inhabitants
   * and the wire has four states, so `undefined` was carrying both "an older
   * server never said" and "the server said something this client could not
   * read". Every consumer then re-derived the rule with `=== false`, which made
   * both of those render as a measurement.
   *
   * REQUIRED, not optional. A response that declared nothing still resolves to
   * a decision (`unestablished`), so no consumer has to invent one from an
   * absent field — which is how the boolean came to be read as `false`-or-fine.
   */
  payment_measurement: PaymentMeasurement;
  revenue: RevenueData;
  payments: PaymentMethodData[];
  orders: OrdersData;
  popular_items: PopularItemData[];
  tables: TablesData;
  kds: KdsData;
}
