// Shared deterministic daily-revenue basis for the mock surfaces.
//
// The single source of truth both the Reports mock and (later, PR 3b) the Dashboard
// mock aggregate from, so the same {restaurant, date range} yields the same figures
// on both — mirroring live, where both read the same Orders. The linchpin is the
// PER-DAY seed: a given (restaurantId, calendar-day) produces the SAME row no matter
// which query range or granularity contains it, so day / week / month / annual totals
// are pure sums of identical daily rows and reconcile by construction. (Contrast the
// previous per-RANGE seeding, where the monthly bucket was generated independently of
// its days and never equalled their sum.)

import { differenceInCalendarDays, eachDayOfInterval, format, getDay, parseISO } from 'date-fns';

/** One restaurant-day of mock revenue. `net = gross − discount − refunds`. */
export interface DailyRevenueRow {
  /** Local calendar day, yyyy-MM-dd. */
  date: string;
  orders: number;
  /** UGX, before discount. */
  gross: number;
  /** UGX. */
  discount: number;
  /** UGX, on-platform refunds for the day (usually 0). */
  refunds: number;
  /** UGX, gross − discount − refunds. */
  net: number;
}

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

/** djb2 over `${restaurantId}T${date}` — the per-(restaurant, day) seed key. */
function hashDay(restaurantId: string, date: string): number {
  let h = 5381 | 0;
  const s = `${restaurantId}T${date}`;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function randInt(rand: () => number, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

/** Fri/Sat busiest, Mon quietest — a believable weekly rhythm. */
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

/**
 * Deterministic per-day revenue for a restaurant over an inclusive [from, to] range.
 * Each day is seeded by (restaurantId, that calendar day) ALONE — independent of the
 * query range — so the same day always yields the same row and every aggregation
 * period is a pure sum of these rows. Inverted range → [].
 */
export function dailyRevenue(restaurantId: string, from: string, to: string): DailyRevenueRow[] {
  const start = parseISO(from);
  const end = parseISO(to);
  if (differenceInCalendarDays(end, start) < 0) return [];

  return eachDayOfInterval({ start, end }).map((d) => {
    const date = format(d, 'yyyy-MM-dd');
    const rand = seededRandom(hashDay(restaurantId, date));
    const orders = Math.round(randInt(rand, 60, 160) * weekdayMultiplier(d));
    const avgTicket = randInt(rand, 18000, 35000); // UGX
    const gross = orders * avgTicket;
    const discount = Math.round(gross * (0.04 + rand() * 0.08)); // 4–12%
    // Refunds are rare — roughly one day in seven sees a small on-platform refund
    // (placeholder until payment integration). Now part of the one basis, summed by
    // mockSalesRefunds rather than invented separately.
    const refunds = rand() < 1 / 7 ? randInt(rand, 20000, 60000) : 0;
    const net = gross - discount - refunds;
    return { date, orders, gross, discount, refunds, net };
  });
}
