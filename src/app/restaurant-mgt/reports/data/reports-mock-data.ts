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
  DinersListingRow,
  DinersSummary,
  MenuGrouping,
  MenuRow,
  PaymentMode,
  PaymentStatus,
  ReportGranularity,
  SalesAggregateRow,
  SalesHourlyRow,
  SalesListingRow,
  SalesListingTotals,
  TransactionStatus,
  TransactionType,
  TransactionsListingRow,
  TransactionsSummary,
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

/**
 * Hour-of-day shape (24 weights) — near-zero overnight, a breakfast bump (~08:00),
 * a lunch peak (~13:00) and a dinner peak (~19:00–21:00). The day-level generators
 * carry only a weekday rhythm with no intra-day curve; this gives the hourly series
 * its believable within-day shape. Scaled by range length, so low-traffic hours
 * round to ~0 — reproducing the contract's zero-filled rows.
 */
const HOUR_OF_DAY_SHAPE = [
  0.02, 0.01, 0.01, 0.01, 0.02, 0.04, // 00–05 overnight
  0.12, 0.35, 0.6, 0.45, 0.35, 0.7, //   06–11 breakfast → late morning
  1.35, 1.6, 1.05, 0.55, 0.45, 0.7, //   12–17 lunch peak (13:00) → afternoon lull
  1.25, 1.7, 1.8, 1.4, 0.55, 0.18, //    18–23 dinner peak (20:00)
];

/**
 * Deterministic hour-of-day sales for the live `sales-hourly` contract: ALWAYS
 * exactly 24 rows (hour 0–23), aggregated across the window. Seeded per range
 * (salt 8) so the same window stays stable across refreshes. Counts scale with the
 * inclusive range length and carry the lunch/dinner curve above; revenue is net of
 * discount, mirroring `buildAggregateRow`. Raw — the UI owns the display window.
 */
export function getMockSalesHourly(from: string, to: string): SalesHourlyRow[] {
  const start = parseISO(from);
  const end = parseISO(to);
  const days = Math.max(1, differenceInCalendarDays(end, start) + 1); // inclusive; ≥1 even if inverted

  const rand = seededRandom(hashRange(from, to, 8));

  return HOUR_OF_DAY_SHAPE.map((weight, hour) => {
    const count = Math.round(weight * days * (0.85 + rand() * 0.3)); // ±15% jitter, scaled by span
    const avgTicket = randInt(rand, 18000, 35000); // UGX
    const gross = count * avgTicket;
    const discount = Math.round(gross * (0.04 + rand() * 0.08)); // 4–12%
    return { hour, count, revenue: gross - discount, discount };
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

/**
 * Sums only the named numeric columns into the Record<string,number> shape the
 * report-table `[totals]` input expects. Columns not listed are never
 * aggregated — which is how per-row means (e.g. average_spend) are deliberately
 * kept out of a totals footer.
 */
export function sumColumns<T extends Record<string, any>>(
  rows: T[],
  keys: (keyof T & string)[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = 0;
  for (const r of rows) for (const k of keys) out[k] += Number(r[k]) || 0;
  return out;
}

// ── Menu performance (salt 3) ───────────────────────────
const MENU_SECTIONS = ['Mains', 'Grills', 'Sides', 'Drinks', 'Desserts', 'Breakfast', 'Combos'];
const MENU_GROUPS = ['Chicken', 'Beef', 'Vegetarian', 'Beverages', 'Street Food', 'Platters'];
const MENU_ITEMS = [
  'Pilau',
  'Chicken Luwombo',
  'Beef Stew',
  'Rolex',
  'Matoke',
  'Chapati',
  'Katogo',
  'Nyama Choma',
  'Goat Pilau',
  'Fresh Juice',
  'Soda',
  'Mandazi',
  'Fish Fillet',
  'Posho & Beans',
  'Chips Masala',
];

/**
 * Menu performance, aggregated by section/group/item. Always a small set. The
 * real backend currently caps this at >31-day ranges (a backend PR relaxes it);
 * the mock renders at every range.
 */
export function getMockMenuSummary(grouping: MenuGrouping, from: string, to: string): MenuRow[] {
  const start = parseISO(from);
  const end = parseISO(to);
  if (differenceInCalendarDays(end, start) < 0) return [];

  const rand = seededRandom(hashRange(from, to, 3));
  const weeks = Math.max(1, Math.round((differenceInCalendarDays(end, start) + 1) / 7));
  const names =
    grouping === 'sections' ? MENU_SECTIONS : grouping === 'groups' ? MENU_GROUPS : MENU_ITEMS;

  return names
    .map((name) => {
      const orderCount = randInt(rand, 8, 60) * weeks;
      const quantitySold = orderCount + randInt(rand, 0, orderCount); // ≥ order_count
      const avgLine = randInt(rand, 6000, 24000); // UGX per line
      return {
        name,
        order_count: orderCount,
        quantity_sold: quantitySold,
        revenue: quantitySold * avgLine,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

// ── Transactions (salts 4 & 5) ──────────────────────────
const TXN_STATUSES: TransactionStatus[] = ['success', 'failed', 'pending', 'initiated'];
const TXN_TYPES: TransactionType[] = ['payment', 'refund', 'charge', 'subscription'];
const TXN_PLATFORMS = ['Flutterwave', 'Pesapal', 'Direct'];

/**
 * Status + type breakdowns. Deliberately SPARSE — a short or quiet window can
 * legitimately return zero transactions, so the empty state is easy to reach.
 */
export function getMockTransactionsSummary(from: string, to: string): TransactionsSummary {
  const start = parseISO(from);
  const end = parseISO(to);
  if (differenceInCalendarDays(end, start) < 0) return { byStatus: [], byType: [], totalCount: 0 };

  const rand = seededRandom(hashRange(from, to, 4));
  const days = differenceInCalendarDays(end, start) + 1;
  const total = randInt(rand, 0, Math.min(40, days * 2));
  if (total === 0) return { byStatus: [], byType: [], totalCount: 0 };

  const byStatus = TXN_STATUSES.map((status) => {
    const count = randInt(rand, 0, Math.ceil(total / 2));
    return { status, count, amount: count * randInt(rand, 15000, 45000) };
  }).filter((r) => r.count > 0);

  const byType = TXN_TYPES.map((type) => {
    const count = randInt(rand, 0, Math.ceil(total / 2));
    return { type, count, amount: count * randInt(rand, 15000, 45000) };
  }).filter((r) => r.count > 0);

  return { byStatus, byType, totalCount: total };
}

/** Per-transaction listing. SPARSE — a quiet day yields no rows. Caller invokes only within ≤31 days. */
export function getMockTransactionsListing(from: string, to: string): TransactionsListingRow[] {
  const start = parseISO(from);
  const end = parseISO(to);
  if (differenceInCalendarDays(end, start) < 0) return [];

  const rand = seededRandom(hashRange(from, to, 5));
  const rows: TransactionsListingRow[] = [];
  let counter = 1;

  for (const d of eachDayOfInterval({ start, end })) {
    const perDay = randInt(rand, 0, 3);
    for (let i = 0; i < perDay; i++) {
      const dt = new Date(d);
      dt.setHours(randInt(rand, 9, 21), randInt(rand, 0, 59), 0, 0);
      rows.push({
        order_number: `ORD-${String(counter++).padStart(4, '0')}`,
        transaction_type: TXN_TYPES[randInt(rand, 0, TXN_TYPES.length - 1)],
        transaction_status: TXN_STATUSES[randInt(rand, 0, TXN_STATUSES.length - 1)],
        amount: randInt(rand, 12000, 90000),
        payment_mode: pickPaymentMode(rand),
        transaction_platform: TXN_PLATFORMS[randInt(rand, 0, TXN_PLATFORMS.length - 1)],
        time_created: dt.toISOString(),
      });
    }
  }
  return rows;
}

// ── Diners (salts 6 & 7) ────────────────────────────────
const DINER_NAMES = [
  'Aisha N.',
  'Brian K.',
  'Catherine M.',
  'David O.',
  'Esther A.',
  'Farouk S.',
  'Grace T.',
  'Henry W.',
];

/**
 * Diner overview. THIN by nature — few identified diners against a large guest
 * count, so the listing empty state is easy to reach while the overview still
 * shows guest activity.
 */
export function getMockDinersSummary(from: string, to: string): DinersSummary {
  const start = parseISO(from);
  const end = parseISO(to);
  if (differenceInCalendarDays(end, start) < 0) {
    return { identifiedDiners: 0, repeatDiners: 0, guestOrders: 0, avgSpendPerDiner: 0 };
  }

  const rand = seededRandom(hashRange(from, to, 6));
  const identified = randInt(rand, 0, 8);
  if (identified === 0) {
    // Quiet window: no identified diners, but guests may still have ordered.
    return {
      identifiedDiners: 0,
      repeatDiners: 0,
      guestOrders: randInt(rand, 0, 30),
      avgSpendPerDiner: 0,
    };
  }

  const avgSpend = randInt(rand, 25000, 80000);
  return {
    identifiedDiners: identified,
    repeatDiners: randInt(rand, 0, identified),
    guestOrders: randInt(rand, 20, 120),
    avgSpendPerDiner: avgSpend,
    mostActive: {
      name: DINER_NAMES[randInt(rand, 0, DINER_NAMES.length - 1)],
      totalSpend: avgSpend * randInt(rand, 3, 9),
    },
  };
}

/** Identified-diner listing. THIN — often a handful of rows or none. Caller invokes only within ≤31 days. */
export function getMockDinersListing(from: string, to: string): DinersListingRow[] {
  const start = parseISO(from);
  const end = parseISO(to);
  if (differenceInCalendarDays(end, start) < 0) return [];

  const rand = seededRandom(hashRange(from, to, 7));
  const span = Math.max(0, differenceInCalendarDays(end, start));
  const count = randInt(rand, 0, 8);
  const rows: DinersListingRow[] = [];

  for (let i = 0; i < count; i++) {
    const orders = randInt(rand, 1, 18);
    const totalSpend = orders * randInt(rand, 18000, 60000);
    const last = new Date(end);
    last.setDate(last.getDate() - randInt(rand, 0, span));
    last.setHours(randInt(rand, 9, 21), randInt(rand, 0, 59), 0, 0);
    rows.push({
      customer_id: `CUST-${String(i + 1).padStart(4, '0')}`,
      name: DINER_NAMES[i % DINER_NAMES.length],
      phone_number: `+2567${randInt(rand, 10, 99)}${String(randInt(rand, 0, 999999)).padStart(6, '0')}`,
      no_orders: orders,
      total_spend: totalSpend,
      average_spend: Math.round(totalSpend / orders),
      last_order_date: last.toISOString(),
    });
  }
  return rows;
}
