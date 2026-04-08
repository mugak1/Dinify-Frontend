import {
  DashboardV2Response,
  RevenueSeriesPoint,
  RevenueTotals,
  RevenueData,
  PaymentMethodData,
  OrdersSeriesPoint,
  OrdersBreakdown,
  OrdersData,
  PopularItemData,
  TablesData,
  KdsData,
  ReviewsSummaryResponse,
  ReviewDistribution,
  RecentReview,
} from '../models/dashboard.models';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeFloat(val: any, fallback = 0): number {
  if (val == null) return fallback;
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

// ---------------------------------------------------------------------------
// Dashboard V2 — section adapters
// ---------------------------------------------------------------------------

function adaptRevenueSeries(raw: any[]): RevenueSeriesPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => {
    const gross = safeFloat(p.gross);
    const discounts = safeFloat(p.discounts);
    const refunds = safeFloat(p.refunds);
    return {
      at: p.at ?? '',
      gross,
      net: gross - discounts - refunds,
      orders: 0,
      aov: 0,
    };
  });
}

function adaptRevenueTotals(raw: any): RevenueTotals {
  if (!raw) return { gross: 0, net: 0, discounts: 0, refunds: 0 };
  return {
    gross: safeFloat(raw.gross),
    net: safeFloat(raw.net),
    discounts: safeFloat(raw.discounts),
    refunds: safeFloat(raw.refunds),
  };
}

function adaptRevenue(raw: any): RevenueData {
  if (!raw) {
    const emptyTotals: RevenueTotals = { gross: 0, net: 0, discounts: 0, refunds: 0 };
    return { series: [], totals: emptyTotals, previous_totals: emptyTotals };
  }
  return {
    series: adaptRevenueSeries(raw.series),
    totals: adaptRevenueTotals(raw.totals),
    previous_totals: adaptRevenueTotals(raw.previous_totals),
  };
}

function adaptPaymentMethods(raw: any[]): PaymentMethodData[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => ({
    method: p.method ?? '',
    amount: safeFloat(p.amount),
    tx_count: p.tx_count ?? 0,
    change_pct: 0,
  }));
}

function adaptOrdersSeries(raw: any[]): OrdersSeriesPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => ({
    at: p.at ?? '',
    orders: p.count ?? 0,
  }));
}

function adaptOrdersBreakdown(raw: any[]): OrdersBreakdown {
  const result: OrdersBreakdown = { paid: 0, open: 0, cancelled: 0, refunded: 0 };
  if (!Array.isArray(raw)) return result;
  for (const entry of raw) {
    const status = entry.status as keyof OrdersBreakdown;
    if (status in result) {
      result[status] = entry.count ?? 0;
    }
  }
  return result;
}

function adaptOrders(raw: any): OrdersData {
  if (!raw) {
    return {
      series: [],
      breakdown: { paid: 0, open: 0, cancelled: 0, refunded: 0 },
      total: 0,
      previous_total: 0,
    };
  }
  return {
    series: adaptOrdersSeries(raw.series),
    breakdown: adaptOrdersBreakdown(raw.breakdown),
    total: raw.total ?? 0,
    previous_total: raw.previous_total ?? 0,
  };
}

function adaptPopularItems(raw: any[]): PopularItemData[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => ({
    item_id: item.item_id ?? '',
    name: item.name ?? '',
    section: '',
    image_url: item.image_url ?? undefined,
    revenue: safeFloat(item.revenue),
    qty: item.qty ?? 0,
  }));
}

function adaptTables(raw: any): TablesData {
  if (!raw) {
    return {
      total: 0,
      occupied: 0,
      available: 0,
      needs_attention: 0,
      occupancy_pct: 0,
      median_visit_minutes: null,
      turns_today: 0,
      turns_yesterday: 0,
      avg_ticket_today: 0,
      avg_ticket_yesterday: 0,
    };
  }
  const total = raw.total ?? 0;
  const occupied = raw.occupied ?? 0;
  return {
    total,
    occupied,
    available: total - occupied,
    needs_attention: 0,
    occupancy_pct: safeFloat(raw.occupancy_pct),
    median_visit_minutes: raw.median_visit_minutes != null ? safeFloat(raw.median_visit_minutes) : null,
    turns_today: safeFloat(raw.turns_today),
    turns_yesterday: safeFloat(raw.turns_yesterday),
    avg_ticket_today: safeFloat(raw.avg_ticket_today),
    avg_ticket_yesterday: safeFloat(raw.avg_ticket_yesterday),
  };
}

function adaptKds(raw: any): KdsData {
  if (!raw) {
    return {
      active: 0,
      over_sla: 0,
      at_risk: 0,
      stale_ready: 0,
      open_tickets: 0,
      avg_fulfillment_minutes: 0,
      target_minutes: 15,
      late_minutes: 20,
      oldest_ticket_minutes: 0,
    };
  }
  return {
    active: raw.open_tickets ?? 0,
    over_sla: raw.over_sla ?? 0,
    at_risk: raw.at_risk ?? 0,
    stale_ready: 0,
    open_tickets: raw.open_tickets ?? 0,
    avg_fulfillment_minutes: raw.avg_fulfillment_minutes != null ? safeFloat(raw.avg_fulfillment_minutes) : 0,
    target_minutes: 15,
    late_minutes: 20,
    oldest_ticket_minutes: raw.oldest_ticket_minutes ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Reviews — section adapters
// ---------------------------------------------------------------------------

function adaptDistribution(raw: any[], totalReviews: number): ReviewDistribution[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((d) => ({
    rating: d.stars ?? 0,
    count: d.count ?? 0,
    percentage: totalReviews > 0 ? ((d.count ?? 0) / totalReviews) * 100 : 0,
  }));
}

function adaptRecentReviews(raw: any[]): RecentReview[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => ({
    review_id: r.order_id ?? '',
    rating: r.rating ?? 0,
    text: r.text ?? '',
    created_at: r.created_at ?? '',
    resolved: false,
  }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function adaptDashboardResponse(raw: any): DashboardV2Response {
  return {
    revenue: adaptRevenue(raw?.revenue),
    payments: adaptPaymentMethods(raw?.payment_methods),
    orders: adaptOrders(raw?.orders),
    popular_items: adaptPopularItems(raw?.popular_items),
    tables: adaptTables(raw?.tables),
    kds: adaptKds(raw?.kds),
  };
}

export function adaptReviewsResponse(raw: any): ReviewsSummaryResponse {
  const totalReviews = raw?.total_reviews_30d ?? 0;
  return {
    avg_rating: safeFloat(raw?.avg_rating_30d),
    total_reviews: totalReviews,
    distribution: adaptDistribution(raw?.distribution, totalReviews),
    recent: adaptRecentReviews(raw?.recent_reviews),
    low_rating_share: safeFloat(raw?.low_rating_share_30d),
  };
}
