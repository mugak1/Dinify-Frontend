import {
  DateRange,
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

// ── Seeded PRNG (mulberry32) ─────────────────────────────
// Keeps data stable across auto-refresh cycles within the same dateRange.
function seededRandom(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED_MAP: Record<DateRange, number> = { day: 101, week: 202, month: 303, ytd: 404 };

// ── Hourly pattern multipliers (hour 0-23) ───────────────
const HOUR_MULTIPLIERS = [
  0.1, 0.1, 0.05, 0.05, 0.05, 0.1, // 0-5 am: near-zero
  0.3, 0.5, 0.7, 0.8, 0.9, 1.0, // 6-11 am: morning ramp
  1.2, 1.1, 0.9, 0.7, 0.7, 0.8, // 12-5 pm: lunch peak then lull
  1.0, 1.3, 1.2, 0.9, 0.6, 0.3, // 6-11 pm: dinner peak then wind-down
];

// ── Date helpers ─────────────────────────────────────────
function generateDates(dateRange: DateRange): string[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dates: string[] = [];

  switch (dateRange) {
    case 'day':
      for (let h = 0; h < 24; h++) {
        const d = new Date(today);
        d.setHours(h, 0, 0, 0);
        dates.push(d.toISOString());
      }
      break;
    case 'week':
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString());
      }
      break;
    case 'month':
      for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString());
      }
      break;
    case 'ytd': {
      const currentMonth = now.getMonth();
      for (let m = 0; m <= currentMonth; m++) {
        const d = new Date(now.getFullYear(), m, 1);
        dates.push(d.toISOString());
      }
      break;
    }
  }
  return dates;
}

function getPatternMultiplier(dateRange: DateRange, index: number, total: number): number {
  switch (dateRange) {
    case 'day':
      return HOUR_MULTIPLIERS[index] ?? 0.5;
    case 'week':
      return [0.8, 0.9, 1.0, 1.1, 1.2, 1.4, 1.3][index] ?? 1.0;
    case 'month':
      return 0.8 + 0.4 * Math.sin((index / total) * Math.PI);
    case 'ytd':
      return 0.7 + 0.6 * Math.sin((index / total) * Math.PI * 2);
    default:
      return 1.0;
  }
}

function getBaseRevenue(dateRange: DateRange): number {
  switch (dateRange) {
    case 'day':
      return 200_000;
    case 'week':
      return 3_500_000;
    case 'month':
      return 3_500_000;
    case 'ytd':
      return 90_000_000;
    default:
      return 200_000;
  }
}

function getScaleFactor(dateRange: DateRange): number {
  switch (dateRange) {
    case 'day':
      return 1;
    case 'week':
      return 7;
    case 'month':
      return 30;
    case 'ytd':
      return 120;
    default:
      return 1;
  }
}

// ── 1. Revenue ───────────────────────────────────────────
export function getMockRevenueData(dateRange: DateRange): RevenueData {
  const rand = seededRandom(SEED_MAP[dateRange]);
  const dates = generateDates(dateRange);
  const base = getBaseRevenue(dateRange);

  const series: RevenueSeriesPoint[] = dates.map((at, i) => {
    const pattern = getPatternMultiplier(dateRange, i, dates.length);
    const variance = 0.8 + rand() * 0.4;
    const gross = Math.round(base * pattern * variance);
    const net = Math.round(gross * 0.9);
    const orders = Math.max(1, Math.round(gross / 25_000));
    const aov = Math.round(net / orders);
    return { at, gross, net, orders, aov };
  });

  const totalGross = series.reduce((sum, p) => sum + p.gross, 0);
  const discounts = Math.round(totalGross * 0.08);
  const refunds = Math.round(totalGross * 0.02);
  const totalNet = totalGross - discounts - refunds;

  const totals: RevenueTotals = { gross: totalGross, net: totalNet, discounts, refunds };

  const prevFactor = 0.85 + rand() * 0.05;
  const previous_totals: RevenueTotals = {
    gross: Math.round(totalGross * prevFactor),
    net: Math.round(totalNet * prevFactor),
    discounts: Math.round(discounts * prevFactor),
    refunds: Math.round(refunds * prevFactor),
  };

  return { series, totals, previous_totals };
}

// ── 2. Payment Methods ───────────────────────────────────
export function getMockPaymentMethods(dateRange: DateRange): PaymentMethodData[] {
  const scale = getScaleFactor(dateRange);
  return [
    { method: 'mobile_money', amount: Math.round(1_800_000 * scale), tx_count: Math.round(45 * scale), change_pct: 12.5 },
    { method: 'cash', amount: Math.round(1_200_000 * scale), tx_count: Math.round(38 * scale), change_pct: -3.2 },
    { method: 'card', amount: Math.round(600_000 * scale), tx_count: Math.round(15 * scale), change_pct: 28.1 },
  ];
}

// ── 3. Orders ────────────────────────────────────────────
export function getMockOrdersData(dateRange: DateRange): OrdersData {
  const rand = seededRandom(SEED_MAP[dateRange] + 50);
  const dates = generateDates(dateRange);
  const baseOrders = dateRange === 'day' ? 8 : 45;

  const series = dates.map((at, i) => {
    const pattern = getPatternMultiplier(dateRange, i, dates.length);
    const variance = 0.8 + rand() * 0.4;
    const orders = Math.max(1, Math.round(baseOrders * pattern * variance));
    return { at, orders };
  });

  const scale = getScaleFactor(dateRange);
  const breakdown: OrdersBreakdown = {
    paid: Math.round(52 * scale),
    open: Math.round(8 * scale),
    cancelled: Math.round(3 * scale),
    refunded: Math.round(2 * scale),
  };

  const total = breakdown.paid + breakdown.open + breakdown.cancelled + breakdown.refunded;
  const previous_total = Math.round(total * 0.88);

  return { series, breakdown, total, previous_total };
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
export function getMockDashboardData(dateRange: DateRange): DashboardV2Response {
  return {
    revenue: getMockRevenueData(dateRange),
    payments: getMockPaymentMethods(dateRange),
    orders: getMockOrdersData(dateRange),
    popular_items: getMockPopularItems(),
    tables: getMockTablesData(),
    kds: getMockKdsData(),
  };
}
