import {
  DashboardV2Response,
  KdsData,
  OrdersBreakdown,
  OrdersData,
  PaymentMethodData,
  PopularItemData,
  RevenueData,
  RevenueSeriesPoint,
  RevenueTotals,
  ReviewsSummaryResponse,
  TablesData,
} from '../models/dashboard.models';
import {
  differenceInCalendarDays,
  eachDayOfInterval,
  eachMonthOfInterval,
  eachYearOfInterval,
  format,
  parseISO,
} from 'date-fns';
import { ReportBucketUnit, previousEqualLengthPeriod } from '../../../_shared/timeframe';
import { DailyRevenueRow, dailyRevenue } from '../../../_shared/mock/daily-revenue';
import { distributeByHour } from '../../../_shared/mock/hour-of-day';

// The mock walks the SAME range→bucket ladder the live surface does, so mock mode and
// live mode render the same number of points for the same range. Everything numeric
// derives from the shared per-(restaurant, day) basis in `_shared/mock/`, which is what
// keeps Dashboard and Reports reconciling for an identical {from, to}.
//
// The old seeded-PRNG scaffolding (SEED_MAP, HOUR_MULTIPLIERS, getPatternMultiplier,
// getScaleFactor) is gone: once orders come from the shared basis, the per-day rhythm
// (weekday-seeded) and the intra-day curve (distributeByHour) both arrive with the data,
// and the invented multipliers were a second, contradictory rhythm layered on top of it.

// ── Date helpers ─────────────────────────────────────────

/** Inclusive day count of [from, to]; at least 1 so an inverted pair can't zero a divisor. */
function rangeDays(from: string, to: string): number {
  return Math.max(1, differenceInCalendarDays(parseISO(to), parseISO(from)) + 1);
}

/**
 * The bucket boundaries [from, to] renders at — the same ladder `resolveTimeframe`
 * walks. Unlike the version this replaces, it honours the ACTUAL range instead of
 * re-deriving a window from `new Date()`, so an arbitrary historical range works.
 *
 * It also defines the EMPTY buckets: a month with no orders still gets a point rather
 * than vanishing from the axis.
 */
function generateDates(from: string, to: string, bucket: ReportBucketUnit): string[] {
  const start = parseISO(from);
  const end = parseISO(to);

  switch (bucket) {
    // A ≤1-day span renders as hour-of-day on the first day, matching the live path.
    case 'hour':
      return Array.from({ length: 24 }, (_, h) => dayAtIso(from, h));
    case 'day':
      return eachDayOfInterval({ start, end }).map((d) => dayAtIso(format(d, 'yyyy-MM-dd')));
    case 'month':
      return eachMonthOfInterval({ start, end }).map((d) => dayAtIso(format(d, 'yyyy-MM-01')));
    case 'year':
      return eachYearOfInterval({ start, end }).map((d) => dayAtIso(`${format(d, 'yyyy')}-01-01`));
  }
}

/** The bucket a given day falls into, as the matching `generateDates` key. */
function bucketKey(date: string, bucket: ReportBucketUnit): string {
  const d = parseISO(date);
  switch (bucket) {
    case 'hour':
    case 'day':
      return format(d, 'yyyy-MM-dd');
    case 'month':
      return format(d, 'yyyy-MM-01');
    case 'year':
      return `${format(d, 'yyyy')}-01-01`;
  }
}

// ── 1. Revenue (derived from the shared per-(restaurant,day) basis) ──
// Every series + total aggregates the SAME daily rows the Reports mock uses, so an
// identical {from,to} reconciles across both surfaces (mirroring live data). Windows
// stay rolling — the component decides day/week/month/ytd; this only shapes the rows.
function sumTotals(rows: DailyRevenueRow[]): RevenueTotals {
  return rows.reduce(
    (t, r) => ({
      gross: t.gross + r.gross,
      net: t.net + r.net,
      discounts: t.discounts + r.discount,
      refunds: t.refunds + r.refunds,
    }),
    { gross: 0, net: 0, discounts: 0, refunds: 0 },
  );
}

/** ISO datetime for a local-midnight day key (+ optional hour) — the legacy series `at` format. */
function dayAtIso(date: string, hour = 0): string {
  const d = parseISO(date);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function aov(net: number, orders: number): number {
  return orders > 0 ? Math.round(net / orders) : 0;
}

/**
 * Groups the shared daily rows into the bucket slots `generateDates` defines, so
 * `Σ series === totals` holds by construction at every granularity and the revenue and
 * orders charts share one x-axis exactly.
 */
function buildRevenueSeries(
  rows: DailyRevenueRow[],
  from: string,
  to: string,
  bucket: ReportBucketUnit,
): RevenueSeriesPoint[] {
  // hour → spread the single day's totals across 24 hours; the points sum to the day total.
  if (bucket === 'hour') {
    const day = rows[0];
    if (!day) return [];
    const oH = distributeByHour(day.orders);
    const gH = distributeByHour(day.gross);
    const nH = distributeByHour(day.net);
    return oH.map((orders, h) => ({
      at: dayAtIso(day.date, h),
      gross: gH[h],
      net: nH[h],
      orders,
      aov: aov(nH[h], orders),
    }));
  }

  const slots = new Map<string, RevenueSeriesPoint>(
    generateDates(from, to, bucket).map((at) => [at, { at, gross: 0, net: 0, orders: 0, aov: 0 }]),
  );
  for (const r of rows) {
    const p = slots.get(dayAtIso(bucketKey(r.date, bucket)));
    if (!p) continue;
    p.gross += r.gross;
    p.net += r.net;
    p.orders += r.orders;
  }
  return [...slots.values()].map((p) => ({ ...p, aov: aov(p.net, p.orders) }));
}

export function getMockRevenueData(
  restaurantId: string,
  from: string,
  to: string,
  bucket: ReportBucketUnit,
): RevenueData {
  const rows = dailyRevenue(restaurantId, from, to);
  const prev = previousEqualLengthPeriod({ from, to });
  const prevRows = dailyRevenue(restaurantId, prev.from, prev.to);

  return {
    series: buildRevenueSeries(rows, from, to, bucket),
    totals: sumTotals(rows),
    previous_totals: sumTotals(prevRows),
  };
}

// ── 2. Payment Methods ───────────────────────────────────
export function getMockPaymentMethods(from: string, to: string): PaymentMethodData[] {
  const scale = rangeDays(from, to);
  return [
    { method: 'mobile_money', amount: Math.round(1_800_000 * scale), tx_count: Math.round(45 * scale), change_pct: 12.5 },
    { method: 'cash', amount: Math.round(1_200_000 * scale), tx_count: Math.round(38 * scale), change_pct: -3.2 },
    { method: 'card', amount: Math.round(600_000 * scale), tx_count: Math.round(15 * scale), change_pct: 28.1 },
  ];
}

// ── 3. Orders ────────────────────────────────────────────
/** Fixed status mix as a share of a REAL total, allocated by largest remainder so the
 *  four segments sum to exactly `total` — the stacked bar and the headline number can
 *  never disagree. (The shared basis models order counts, not order status.) */
function splitBreakdown(total: number, shares: OrdersBreakdown): OrdersBreakdown {
  const keys = Object.keys(shares) as (keyof OrdersBreakdown)[];
  const exact = keys.map((k) => ({ k, v: total * shares[k] }));
  const out = { paid: 0, open: 0, cancelled: 0, refunded: 0 } as OrdersBreakdown;
  for (const e of exact) out[e.k] = Math.floor(e.v);

  let remainder = total - keys.reduce((a, k) => a + out[k], 0);
  for (const e of [...exact].sort((a, b) => (b.v % 1) - (a.v % 1))) {
    if (remainder <= 0) break;
    out[e.k] += 1;
    remainder -= 1;
  }
  return out;
}

export function getMockOrdersData(
  restaurantId: string,
  from: string,
  to: string,
  bucket: ReportBucketUnit,
): OrdersData {
  const rows = dailyRevenue(restaurantId, from, to);
  const total = rows.reduce((a, r) => a + r.orders, 0);

  // A REAL equal-length comparison, same window the backend uses. This previously read
  // `Math.round(total * 0.88)` — a flat, invented 12% that made the delta chip show
  // roughly +13.6% for every range and hid whether the timeframe was working at all.
  const prev = previousEqualLengthPeriod({ from, to });
  const previous_total = dailyRevenue(restaurantId, prev.from, prev.to).reduce(
    (a, r) => a + r.orders,
    0,
  );

  // Same slots as the revenue series, so the two charts share one x-axis exactly.
  const series = buildRevenueSeries(rows, from, to, bucket).map((p) => ({
    at: p.at,
    orders: p.orders,
  }));

  return {
    series,
    breakdown: splitBreakdown(total, { paid: 0.8, open: 0.12, cancelled: 0.05, refunded: 0.03 }),
    total,
    previous_total,
  };
}

// ── 4. Popular Items ─────────────────────────────────────
export function getMockPopularItems(): PopularItemData[] {
  return [
    { item_id: 'item-001', name: 'Luwombo Chicken', section: 'Main Course', revenue: 2_450_000, qty: 98 },
    { item_id: 'item-002', name: 'Rolex (Chapati Egg Roll)', section: 'Street Food', revenue: 1_870_000, qty: 187 },
    { item_id: 'item-003', name: 'Matoke & Groundnut Stew', section: 'Main Course', revenue: 1_620_000, qty: 81 },
    { item_id: 'item-004', name: 'Tilapia Fillet (Grilled)', section: 'Seafood', revenue: 1_340_000, qty: 67 },
    { item_id: 'item-005', name: 'Passion Fruit Juice (1L)', section: 'Beverages', revenue: 890_000, qty: 178 },
  ];
}

// ── 5. Tables ────────────────────────────────────────────
export function getMockTablesData(): TablesData {
  return {
    total: 24,
    occupied: 18,
    available: 6,
    needs_attention: 2,
    occupancy_pct: 75,
    median_visit_minutes: 42,
    turns_today: 2.8,
    turns_yesterday: 2.5,
    avg_ticket_today: 85_000,
    avg_ticket_yesterday: 78_000,
  };
}

// ── 6. KDS ───────────────────────────────────────────────
export function getMockKdsData(): KdsData {
  return {
    active: 12,
    over_sla: 2,
    at_risk: 3,
    stale_ready: 1,
    open_tickets: 12,
    avg_fulfillment_minutes: 9.2,
    target_minutes: 8,
    late_minutes: 12,
    oldest_ticket_minutes: 17,
  };
}

// ── 7. Reviews ───────────────────────────────────────────
export function getMockReviewsData(): ReviewsSummaryResponse {
  return {
    avg_rating: 4.2,
    total_reviews: 156,
    distribution: [
      { rating: 5, count: 72, percentage: 46.2 },
      { rating: 4, count: 45, percentage: 28.8 },
      { rating: 3, count: 22, percentage: 14.1 },
      { rating: 2, count: 11, percentage: 7.1 },
      { rating: 1, count: 6, percentage: 3.8 },
    ],
    recent: [
      {
        review_id: 'rev-001',
        rating: 5,
        text: 'The Luwombo was absolutely divine! Best I have had in Kampala. Will definitely be back.',
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        resolved: false,
      },
      {
        review_id: 'rev-002',
        rating: 2,
        text: 'Waited 45 minutes for our food. The Rolex was cold when it arrived. Disappointing service.',
        created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        resolved: false,
      },
      {
        review_id: 'rev-003',
        rating: 4,
        text: 'Great ambiance and friendly staff. The tilapia was fresh and well-seasoned.',
        created_at: new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString(),
        resolved: true,
      },
    ],
  };
}

// ── 8. Composite ─────────────────────────────────────────
export function getMockDashboardData(
  restaurantId: string,
  from: string,
  to: string,
  bucket: ReportBucketUnit,
): DashboardV2Response {
  return {
    revenue: getMockRevenueData(restaurantId, from, to, bucket),
    payments: getMockPaymentMethods(from, to),
    orders: getMockOrdersData(restaurantId, from, to, bucket),
    popular_items: getMockPopularItems(),
    tables: getMockTablesData(),
    kds: getMockKdsData(),
  };
}
