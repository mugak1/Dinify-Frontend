/**
 * Period-over-period percentage change, or `null` when there is no usable baseline.
 *
 * A percentage change *from* zero is undefined. The dashboard cards used to return `0`
 * in that case and render it as "0.0% ▲" in success-green — telling a restaurant whose
 * previous period had no trade at all that it was flat, including one that went from
 * zero to UGX 2M. Zero is a real measured value, not a missing one, so when the change
 * cannot be stated honestly the UI must say nothing rather than say zero.
 *
 * Returns `null` when `previous` is `0`, `null`, `undefined`, non-finite, or NEGATIVE,
 * and when `current` is non-finite. Otherwise the signed percentage.
 *
 * The negative case deliberately widens the original spec, which listed only `0` /
 * `null` / `undefined` / non-finite. A negative denominator sign-flips the raw formula,
 * so a genuine recovery renders as a red decline — the same class of false statement
 * this helper exists to remove. It is reachable: revenue `net` is
 * `gross − discounts − refunds`, which goes negative in a refund-heavy period.
 *
 * `current === 0` against a positive baseline is NOT null — `-100%` is a true statement.
 *
 * ## Which components this is for
 *
 * - **In scope** — the component divides by a baseline it holds to produce a percentage.
 *   Route through `percentChange` and gate the badge with `@if`.
 *   Here: `revenue-card`, `total-orders-card`, `TrendIndicatorComponent`.
 * - **Report, don't fix** — the component displays a server-computed percentage
 *   (`change_pct`). The frontend holds no baseline to test, and suppressing on `=== 0`
 *   would also hide genuine flat periods. Here: none rendering today —
 *   `PaymentMethodData.change_pct` exists on the model and in mock data, but no template
 *   or getter consumes it. That changes the moment the payment-methods trend is wired.
 * - **Leave alone** — a direction-only indicator derived from a direct `current > previous`
 *   comparison. That comparison is well-defined at a zero baseline; 0 → 340 is a real
 *   increase and the arrow is honest. Only the percentage magnitude is undefined.
 * - **Not a delta** — a percentage of a capacity or total rather than of a prior period.
 *   Here: `tables-card.occupancyPct` divides by `total` (capacity), and its
 *   success/destructive colours are occupancy thresholds, not a change direction.
 *
 * ## The four baseline predicates in this repo
 *
 * | Site                     | Predicate                                         |
 * |--------------------------|---------------------------------------------------|
 * | `revenue-card`           | → `percentChange`                                 |
 * | `total-orders-card`      | → `percentChange`                                 |
 * | `trend-indicator`        | → `percentChange`                                 |
 * | `delta-chip.hasBaseline` | `isFinite(previous) && previous !== 0` — DIVERGES  |
 *
 * `ReportDeltaChipComponent` (`restaurant-mgt/reports/components/delta-chip/`) keeps its
 * own predicate, which has NO negative gate. The app therefore holds two different
 * answers for a negative baseline: Dashboard suppresses, Reports renders a sign-flipped
 * chip. That is a deliberate scoping decision, not an oversight — consolidating
 * `delta-chip` onto this helper is scheduled as a follow-up. Until it lands, ANY change
 * to the null set here must be applied to `delta-chip.hasBaseline` as well.
 */
export function percentChange(
  current: number,
  previous: number | null | undefined,
): number | null {
  if (previous === null || previous === undefined) return null;
  // `<= 0` covers both the zero and the negative baseline; the finite check has to come
  // first because `NaN <= 0` is false and would otherwise fall through to the division.
  if (!Number.isFinite(previous) || previous <= 0) return null;
  if (!Number.isFinite(current)) return null;
  return ((current - previous) / previous) * 100;
}
