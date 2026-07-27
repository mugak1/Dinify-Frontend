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
  eachDayOfInterval,
  eachMonthOfInterval,
  eachWeekOfInterval,
  eachYearOfInterval,
  format,
  parseISO,
  startOfWeek,
} from 'date-fns';
import { ReportBucketUnit, previousEqualLengthPeriod } from '../../../_shared/timeframe';
import { DailyRevenueRow, dailyRevenue } from '../../../_shared/mock/daily-revenue';
import { distributeByHour } from '../../../_shared/mock/hour-of-day';

// The mock walks the SAME range→bucket ladder the live surface does, so mock mode and
// live mode render the same number of points for the same range. Everything numeric
// derives from the shared per-(restaurant, day) basis in `_shared/mock/`, which is what
// keeps Dashboard and Reports reconciling for an identical {from, to}.
//
// EVERY revenue-derived card reads that basis — revenue, orders, payment methods and
// popular items alike. Payments and popular items did not, until DASH-MOCK-COHERENCE-00:
// payments multiplied three fixed per-day constants by a CALENDAR-day count, and popular
// items took no arguments at all. So the closed weekday (CLOSED_WEEKDAY in
// `_shared/mock/daily-revenue`) read as UGX 0 revenue and 0 orders beside UGX 3.6M
// settled and 8.17M of popular-item revenue. That was always wrong — a restaurant with
// no orders would always have reported 3.6M settled — and the closure merely made it
// visible. A mock that contradicts itself is worse than no mock, because it teaches
// whoever reads the screen that the numbers do not have to agree.
//
// The rule this establishes, for the next generator added here: READ THE BASIS. Do not
// synthesise figures, and do not scale by a day count — a closed day is a calendar day
// that traded nothing, so `rangeDays`-style scaling overstates every window containing
// one. Summing the basis handles that by construction, which is why no trading-day
// helper is needed anywhere in this file.
//
// The old seeded-PRNG scaffolding (SEED_MAP, HOUR_MULTIPLIERS, getPatternMultiplier,
// getScaleFactor) is gone: once orders come from the shared basis, the per-day rhythm
// (weekday-seeded) and the intra-day curve (distributeByHour) both arrive with the data,
// and the invented multipliers were a second, contradictory rhythm layered on top of it.

// ── Date helpers ─────────────────────────────────────────

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
    // Monday-anchored, matching the backend. `eachWeekOfInterval` snaps back to the week
    // start, so a window opening mid-week yields a first slot dated BEFORE `from` — which is
    // right: that slot holds the partial opening week's takings.
    case 'week':
      return eachWeekOfInterval({ start, end }, { weekStartsOn: 1 }).map((d) =>
        dayAtIso(format(d, 'yyyy-MM-dd')),
      );
    case 'month':
      return eachMonthOfInterval({ start, end }).map((d) => dayAtIso(format(d, 'yyyy-MM-01')));
    case 'year':
      return eachYearOfInterval({ start, end }).map((d) => dayAtIso(`${format(d, 'yyyy')}-01-01`));
  }
}

/**
 * The bucket a given day falls into, as the matching `generateDates` key.
 *
 * MUST agree with `generateDates` key-for-key: `buildRevenueSeries` looks each row's bucket up
 * in the slot map with `slots.get(dayAtIso(bucketKey(...)))`, so a disagreement is not a type
 * error or an exception — every lookup silently misses and the whole series renders as zero.
 */
function bucketKey(date: string, bucket: ReportBucketUnit): string {
  const d = parseISO(date);
  switch (bucket) {
    case 'hour':
    case 'day':
      return format(d, 'yyyy-MM-dd');
    case 'week':
      return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    case 'month':
      return format(d, 'yyyy-MM-01');
    case 'year':
      return `${format(d, 'yyyy')}-01-01`;
  }
}

// ── Allocation ───────────────────────────────────────────

/**
 * Splits `total` across `weights` by the Largest Remainder Method, so the parts sum to
 * EXACTLY `total` — no rounding drift between a card's rows and its own headline, and
 * none between two cards that share a total.
 *
 * Only the RATIOS of `weights` matter; they need not sum to 1. That is deliberate — the
 * callers pass the original hardcoded figures verbatim as weights, so the proportions
 * this file shipped with are preserved by construction rather than restated as decimals
 * someone has to check.
 *
 * A non-positive `total` (or an all-zero weight vector) yields all zeros, which is what
 * drives the cards' existing empty states on a window with no trade.
 */
function allocateByShares(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (w / sum) * total);
  const out = exact.map((v) => Math.floor(v));

  let remainder = Math.round(total - out.reduce((a, v) => a + v, 0));
  const byRemainder = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (const e of byRemainder) {
    if (remainder <= 0) break;
    out[e.i] += 1;
    remainder -= 1;
  }
  return out;
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

/**
 * The method mix, expressed as the per-day figures this file previously hardcoded. Used
 * as WEIGHTS, so the card's rendered split stays 50 / 33 / 17 exactly as it was — the
 * change is invisible on an ordinary trading day, and visible only where the basis is
 * zero or unusually low. `amount` and `tx_count` carry SEPARATE weights on purpose: cash
 * tickets are smaller than mobile-money ones (UGX ~31.6K vs ~40K average), so a single
 * vector would flatten a real difference the old figures already encoded.
 */
const PAYMENT_METHOD_MIX: { method: string; amountWeight: number; txWeight: number; change_pct: number }[] = [
  { method: 'mobile_money', amountWeight: 1_800_000, txWeight: 45, change_pct: 12.5 },
  { method: 'cash', amountWeight: 1_200_000, txWeight: 38, change_pct: -3.2 },
  { method: 'card', amountWeight: 600_000, txWeight: 15, change_pct: 28.1 },
];

/**
 * Settled payments for the window, split across the methods.
 *
 * The SETTLED TOTAL is the window's `net` (gross − discount − refunds) — the very figure
 * the Revenue card puts in its headline (`revenue-card` renders `totals.net`). Allocating
 * it by largest remainder means the payment card's "Total settled" equals the Revenue
 * headline to the shilling, which is the coherence this generator exists to provide: a
 * diner pays the discounted price, and a refund is money given back, so both belong out
 * of what was settled.
 *
 * Transaction counts scale off the window's ACTUAL order count, never a day count, so
 * payments-per-order stays around one however long the window is.
 *
 * `change_pct` is left as it was: still hardcoded, still consumed by no template, and its
 * correct source is a backend concern recorded as a follow-up.
 */
export function getMockPaymentMethods(
  restaurantId: string,
  from: string,
  to: string,
): PaymentMethodData[] {
  const rows = dailyRevenue(restaurantId, from, to);
  const settled = rows.reduce((a, r) => a + r.net, 0);
  const orders = rows.reduce((a, r) => a + r.orders, 0);

  const amounts = allocateByShares(settled, PAYMENT_METHOD_MIX.map((m) => m.amountWeight));
  const counts = allocateByShares(orders, PAYMENT_METHOD_MIX.map((m) => m.txWeight));

  return PAYMENT_METHOD_MIX.map((m, i) => ({
    method: m.method,
    amount: amounts[i],
    tx_count: counts[i],
    change_pct: m.change_pct,
  }));
}

// ── 3. Orders ────────────────────────────────────────────
/** Fixed status mix as a share of a REAL total, allocated by largest remainder so the
 *  four segments sum to exactly `total` — the stacked bar and the headline number can
 *  never disagree. (The shared basis models order counts, not order status.) */
function splitBreakdown(total: number, shares: OrdersBreakdown): OrdersBreakdown {
  const keys = Object.keys(shares) as (keyof OrdersBreakdown)[];
  const parts = allocateByShares(
    total,
    keys.map((k) => shares[k]),
  );
  const out = { paid: 0, open: 0, cancelled: 0, refunded: 0 } as OrdersBreakdown;
  keys.forEach((k, i) => (out[k] = parts[i]));
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

/**
 * The five placeholder dishes, as a revenue WEIGHT and a unit price.
 *
 * `revenueWeight` is the revenue figure this file previously hardcoded, reused verbatim
 * so the ranking and the card's `%` column are preserved exactly — that column is a share
 * of the displayed five, so a uniform scale cancels out of it entirely.
 *
 * `unitPrice` is not invented either: the old fixture's revenue ÷ qty came out to an exact
 * round price for all five (25K / 10K / 20K / 20K / 5K). Deriving `qty` back from it keeps
 * today's non-obvious quantity ordering — Rolex 187 > Juice 178 > Luwombo 98, because a
 * Rolex is a tenth the price of a Luwombo — rather than re-deriving something plausible.
 * Feeding a top-five total of UGX 8,170,000 reproduces the previous fixture exactly.
 *
 * Names here are a FALLBACK only: `DashboardComponent.recomputePopularItems` overlays the
 * restaurant's real menu identities onto these rows positionally, keeping the metrics.
 */
const POPULAR_ITEM_MIX: {
  item_id: string;
  name: string;
  section: string;
  revenueWeight: number;
  unitPrice: number;
}[] = [
  { item_id: 'item-001', name: 'Luwombo Chicken', section: 'Main Course', revenueWeight: 2_450_000, unitPrice: 25_000 },
  { item_id: 'item-002', name: 'Rolex (Chapati Egg Roll)', section: 'Street Food', revenueWeight: 1_870_000, unitPrice: 10_000 },
  { item_id: 'item-003', name: 'Matoke & Groundnut Stew', section: 'Main Course', revenueWeight: 1_620_000, unitPrice: 20_000 },
  { item_id: 'item-004', name: 'Tilapia Fillet (Grilled)', section: 'Seafood', revenueWeight: 1_340_000, unitPrice: 20_000 },
  { item_id: 'item-005', name: 'Passion Fruit Juice (1L)', section: 'Beverages', revenueWeight: 890_000, unitPrice: 5_000 },
];

/**
 * What share of a window's takings the five best sellers account for.
 *
 * These rows are the TOP five, not the whole menu — the card links out to the full list
 * in Reports — so they must not sum to the window's entire revenue, which would assert a
 * five-item restaurant. 60% is a modelling choice, and the only free parameter here;
 * everything else in this generator is derived.
 */
const TOP_ITEMS_REVENUE_SHARE = 0.6;

/**
 * The window's best sellers, scaled off the same basis every other card reads.
 *
 * Previously this took NO arguments, so it returned identical figures for "Today", for
 * "Last year", and for a period with no trade at all. It now tracks the window: a window
 * with no takings has no best sellers, so it returns an EMPTY LIST rather than five rows
 * of zero — which is both what the backend's group-by would produce and what drives the
 * card's existing "No item data available" state, instead of a ranking table of `0.0%`.
 */
export function getMockPopularItems(
  restaurantId: string,
  from: string,
  to: string,
): PopularItemData[] {
  const net = dailyRevenue(restaurantId, from, to).reduce((a, r) => a + r.net, 0);
  if (net <= 0) return [];

  const topRevenue = Math.round(net * TOP_ITEMS_REVENUE_SHARE);
  const revenues = allocateByShares(topRevenue, POPULAR_ITEM_MIX.map((m) => m.revenueWeight));

  return POPULAR_ITEM_MIX.map((m, i) => ({
    item_id: m.item_id,
    name: m.name,
    section: m.section,
    revenue: revenues[i],
    qty: Math.round(revenues[i] / m.unitPrice),
  }));
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
    payments: getMockPaymentMethods(restaurantId, from, to),
    orders: getMockOrdersData(restaurantId, from, to, bucket),
    popular_items: getMockPopularItems(restaurantId, from, to),
    tables: getMockTablesData(),
    kds: getMockKdsData(),
  };
}
