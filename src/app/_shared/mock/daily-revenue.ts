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

/**
 * The weekday the mock restaurant is CLOSED — no orders, no takings, at all.
 * `null` DISABLES closures: every calendar day trades.
 *
 * CURRENTLY OFF, DELIBERATELY. The Dashboard defaults to Today, so one day in seven its
 * opening screen read zero revenue, zero orders, "No settled payments in this period" and
 * "No item data available" — every figure correct and the whole screen useless, including in
 * front of a prospective restaurant. Design work needs every date populated, so closures are
 * switched off rather than removed. Setting this back to a weekday index (`1` = Mon) is ALL
 * that is required to restore them; the guard below, the zero-row shape and every consumer's
 * sparse handling are untouched and still work.
 *
 * WHY THEY EXISTED, which is the whole reason this is a constant and not a deletion: the
 * backend's period aggregation is a plain group-by, so a day with no orders yields NO BUCKET;
 * only the hourly path is zero-filled. A mock that emits every calendar day is therefore DENSER
 * than the thing it stands in for, and a mock denser than production silently hides an entire
 * class of defect from every feature built on it — the sparse-series bugs in the Sales trend
 * axis and in comparison-series pairing survived three consecutive PRs in that exact area
 * precisely because nothing in the running app could produce a gap. That is the condition we
 * are back in. The sparse-input specs for `normalizeSeries` and `alignComparisonSeries` build
 * their own fixtures and still cover the logic, but nothing in the RUNNING APP produces a gap
 * again. So: the next change to densification, comparison pairing or the bucket ladder should
 * flip this back to `1` for its verification pass.
 *
 * Monday when on, because `weekdayMultiplier` already makes it the quietest day and a closure
 * is trivial to spot on screen ("every Monday is missing"). One closed weekday is enough: the
 * point is that gaps EXIST, not how many.
 */
const CLOSED_WEEKDAY: number | null = null; // 1 = Mon (date-fns getDay: 0 = Sun)

/** Fri/Sat busiest, Mon quietest — a believable weekly rhythm. Unused on a closed day. */
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
    // A closed day is emitted as a ZERO ROW, not omitted. This function's contract is one row
    // per inclusive calendar day, and the Dashboard mock densifies off it. Consumers that
    // mirror the backend's group-by (getMockSalesAggregate) drop the zero rows themselves.
    // With CLOSED_WEEKDAY at null this branch never runs and every day trades — see its
    // docstring for why it is switched off rather than deleted.
    if (CLOSED_WEEKDAY !== null && getDay(d) === CLOSED_WEEKDAY) {
      return { date, orders: 0, gross: 0, discount: 0, refunds: 0, net: 0 };
    }
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
