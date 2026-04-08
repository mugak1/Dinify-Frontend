// ── Date range ────────────────────────────────────────────
export type DateRange = 'day' | 'week' | 'month' | 'ytd';

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

export interface RevenueData {
  series: RevenueSeriesPoint[];
  totals: RevenueTotals;
  previous_totals: RevenueTotals;
}

// ── Payment methods ───────────────────────────────────────
export interface PaymentMethodData {
  method: string;
  amount: number;
  tx_count: number;
  change_pct: number;
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
  previous_total: number;
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
  revenue: RevenueData;
  payments: PaymentMethodData[];
  orders: OrdersData;
  popular_items: PopularItemData[];
  tables: TablesData;
  kds: KdsData;
}
