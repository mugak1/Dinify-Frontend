// Shared intra-day sales curve for the mock surfaces. Both the Reports hourly series
// and the Dashboard `day` view spread a day's totals across the hours using this one
// shape, so neither duplicates the curve (PR 3b extracted it from reports-mock-data).

/**
 * Hour-of-day shape (24 weights, index = hour 0–23) — near-zero overnight, a breakfast
 * bump (~08:00), a lunch peak (~13:00) and a dinner peak (~19:00–21:00). Day-level
 * generators carry only a weekday rhythm with no intra-day curve; this gives an hourly
 * series its believable within-day shape.
 */
export const HOUR_OF_DAY_SHAPE = [
  0.02, 0.01, 0.01, 0.01, 0.02, 0.04, // 00–05 overnight
  0.12, 0.35, 0.6, 0.45, 0.35, 0.7, //   06–11 breakfast → late morning
  1.35, 1.6, 1.05, 0.55, 0.45, 0.7, //   12–17 lunch peak (13:00) → afternoon lull
  1.25, 1.7, 1.8, 1.4, 0.55, 0.18, //    18–23 dinner peak (20:00)
];

/**
 * Distribute an integer `total` across the 24 hours weighted by HOUR_OF_DAY_SHAPE,
 * returning 24 non-negative integers that sum EXACTLY to `total` (largest-remainder
 * allocation, so rounding never loses or invents a unit). Used by the dashboard `day`
 * view so its 24 hourly points reconcile exactly with the day's total. `total <= 0`
 * → 24 zeros.
 */
export function distributeByHour(total: number): number[] {
  if (total <= 0) return HOUR_OF_DAY_SHAPE.map(() => 0);

  const weightSum = HOUR_OF_DAY_SHAPE.reduce((a, w) => a + w, 0);
  const raw = HOUR_OF_DAY_SHAPE.map((w) => (total * w) / weightSum);
  const out = raw.map((v) => Math.floor(v));
  const remainder = total - out.reduce((a, v) => a + v, 0);

  // Hand the leftover whole units to the buckets with the largest fractional parts.
  const byFrac = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder; k++) out[byFrac[k].i] += 1;
  return out;
}
