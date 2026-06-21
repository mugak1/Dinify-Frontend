// Reports module — deterministic, Kampala-flavoured mock data.
//
// Mirrors the dashboard mock pattern: a seeded PRNG (mulberry32) keeps data
// stable for a given range across refreshes. The seed is derived from the range
// itself so switching reports (same range) shows a consistent dataset.

import {
  differenceInCalendarDays,
  eachDayOfInterval,
  eachMonthOfInterval,
  endOfMonth,
  format,
  getDay,
  parseISO,
  startOfMonth,
} from 'date-fns';
import {
  PaymentMode,
  PaymentStatus,
  ReportGranularity,
  SalesAggregateRow,
  SalesListingRow,
  SalesListingTotals,
} from '../models/reports.models';

// ── Seeded PRNG (mulberry32) ─────────────────────────────
function seededRandom(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** djb2 over the range string + salt, so the same window yields stable data. */
function hashRange(from: string, to: string, salt: number): number {
  let h = (5381 ^ salt) | 0;
  const s = `${from}|${to}`;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function randInt(rand: () => number, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

/** Fri/Sat busiest, Mon quietest — gives the series a believable weekly rhythm. */
function weekdayMultiplier(date: Date): number {
  switch (getDay(date)) {
    case 5:
      return 1.35; // Fri
    case 6:
      return 1.5; // Sat
    case 0:
      return 1.1; // Sun
    case 1:
      return 0.8; // Mon
    default:
      return 1;
  }
}

function buildAggregateRow(period: string, orders: number, rand: () => number): SalesAggregateRow {
  const avgTicket = randInt(rand, 18000, 35000); // UGX
  const gross = orders * avgTicket;
  const discount = Math.round(gross * (0.04 + rand() * 0.08)); // 4–12%
  return { period, orders, revenue: gross - discount, discount };
}

export function getMockSalesAggregate(
  from: string,
  to: string,
  granularity: ReportGranularity,
): SalesAggregateRow[] {
  const start = parseISO(from);
  const end = parseISO(to);
  if (differenceInCalendarDays(end, start) < 0) return [];

  const rand = seededRandom(hashRange(from, to, 1));

  if (granularity === 'monthly') {
    return eachMonthOfInterval({ start, end }).map((m) => {
      const dailyAvg = randInt(rand, 70, 150);
      const daysInMonth = differenceInCalendarDays(endOfMonth(m), startOfMonth(m)) + 1;
      return buildAggregateRow(format(m, 'yyyy-MM'), dailyAvg * daysInMonth, rand);
    });
  }

  return eachDayOfInterval({ start, end }).map((d) => {
    const orders = Math.round(randInt(rand, 60, 160) * weekdayMultiplier(d));
    return buildAggregateRow(format(d, 'yyyy-MM-dd'), orders, rand);
  });
}

const PAYMENT_MODE_WEIGHTS: { mode: PaymentMode; weight: number }[] = [
  { mode: 'MTN MoMo', weight: 0.55 },
  { mode: 'Airtel MoMo', weight: 0.3 },
  { mode: 'Cash', weight: 0.15 },
];

function pickPaymentMode(rand: () => number): PaymentMode {
  const r = rand();
  let acc = 0;
  for (const p of PAYMENT_MODE_WEIGHTS) {
    acc += p.weight;
    if (r <= acc) return p.mode;
  }
  return 'MTN MoMo';
}

function pickPaymentStatus(rand: () => number, mode: PaymentMode): PaymentStatus {
  const r = rand();
  if (mode === 'Cash') {
    // Cash is collected at the counter — overwhelmingly paid.
    if (r < 0.9) return 'paid';
    if (r < 0.97) return 'refunded';
    return 'failed';
  }
  if (r < 0.72) return 'paid';
  if (r < 0.87) return 'pending';
  if (r < 0.95) return 'failed';
  return 'refunded';
}

function buildListingRow(day: Date, n: number, rand: () => number): SalesListingRow {
  const itemCount = randInt(rand, 1, 6);
  let gross = 0;
  for (let i = 0; i < itemCount; i++) gross += randInt(rand, 5000, 28000); // UGX per line
  const discount = rand() < 0.25 ? Math.round(gross * (0.05 + rand() * 0.1)) : 0;
  const mode = pickPaymentMode(rand);
  const dt = new Date(day);
  dt.setHours(randInt(rand, 9, 21), randInt(rand, 0, 59), 0, 0); // business hours

  return {
    order_number: `ORD-${String(n).padStart(4, '0')}`,
    item_count: itemCount,
    gross,
    discount,
    revenue: gross - discount,
    payment_mode: mode,
    payment_status: pickPaymentStatus(rand, mode),
    time_created: dt.toISOString(),
  };
}

/** Per-order rows for the listing drill-down. Caller only invokes this within the ≤31-day window. */
export function getMockSalesListing(from: string, to: string): SalesListingRow[] {
  const start = parseISO(from);
  const end = parseISO(to);
  if (differenceInCalendarDays(end, start) < 0) return [];

  const rand = seededRandom(hashRange(from, to, 2));
  const rows: SalesListingRow[] = [];
  const MAX_ROWS = 1500;
  let counter = 1;

  for (const d of eachDayOfInterval({ start, end })) {
    const perDay = Math.round(randInt(rand, 80, 120) * weekdayMultiplier(d));
    for (let i = 0; i < perDay && rows.length < MAX_ROWS; i++) {
      rows.push(buildListingRow(d, counter++, rand));
    }
    if (rows.length >= MAX_ROWS) break;
  }
  return rows;
}

/** Explicit empty producer so the empty state is reachable in design review and specs. */
export function getMockSalesEmpty(): { aggregate: SalesAggregateRow[]; listing: SalesListingRow[] } {
  return { aggregate: [], listing: [] };
}

// ── Pure reducers (reused by the Sales component and its specs) ──
export function sumAggregate(
  rows: SalesAggregateRow[],
): { orders: number; revenue: number; discount: number } {
  return rows.reduce(
    (acc, r) => ({
      orders: acc.orders + r.orders,
      revenue: acc.revenue + r.revenue,
      discount: acc.discount + r.discount,
    }),
    { orders: 0, revenue: 0, discount: 0 },
  );
}

export function sumListing(rows: SalesListingRow[]): SalesListingTotals {
  return rows.reduce(
    (acc, r) => ({
      orders: acc.orders + 1,
      gross: acc.gross + r.gross,
      discount: acc.discount + r.discount,
      revenue: acc.revenue + r.revenue,
    }),
    { orders: 0, gross: 0, discount: 0, revenue: 0 },
  );
}
