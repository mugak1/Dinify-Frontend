// Timeframe display strings for the dashboard cards.
//
// Both the revenue card and the total-orders card rendered byte-identical copies of an
// axis formatter and a comparison caption, keyed on the old coarse enum. One copy each
// now, keyed on the resolved bucket and range, so the two charts can never disagree
// about how a tick reads or which window a delta is measured against.

import { ReportBucketUnit, ReportDateRange } from '../../../_shared/timeframe';
import { formatRangeSpan } from '../../../_shared/timeframe/picker/range-label';

/**
 * X-axis tick for a series point, keyed on the resolved bucket.
 *
 * Two of these deliberately differ from the pre-01B formats, because the buckets now
 * span far more than the four fixed ranges did:
 *   `day`   was weekday-short ("Mon") for the 7-day range — but `day` now covers 2–31
 *           days, where weekday names repeat and stop identifying a point.
 *   `month` was month-only ("Jun") for YTD — but `month` now covers up to 731 days, so
 *           a bare month name would appear twice on a two-year axis.
 * `year` is new: the old enum could not express a multi-year range at all.
 *
 * `week` (LADDER-WEEK-00) is the point's Monday, PREFIXED "w/c". This is a per-point tick, not
 * an axis title — the cards call it once per point, and the tooltip title reuses whatever it
 * returns — so a bucket NOUN here would label every tick and every tooltip identically. The
 * prefix is what keeps it from reading as a single day: without it a week tick is byte-identical
 * to a `day` tick. The bucket noun ("Week") lives on the Sales breakdown table's column heading.
 */
export function bucketAxisLabel(at: string, bucketUnit: ReportBucketUnit): string {
  const d = new Date(at);
  if (isNaN(d.getTime())) return at;
  switch (bucketUnit) {
    case 'hour':
      return d.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
    case 'day':
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    case 'week':
      return `w/c ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    case 'month':
      return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    case 'year':
      return d.toLocaleDateString('en-US', { year: 'numeric' });
  }
}

/**
 * Caption for a period-over-period delta: `vs. <baseline value> (<from> – <to>)`.
 *
 * TAKES THE WINDOW, COMPUTES NONE. Until 02B it derived its own with
 * `previousEqualLengthPeriod`, which was right only while the Dashboard's baseline came
 * from `dashboard-v2`'s `previous_totals`. Now the user picks the basis, so a
 * self-computed window would confidently print dates nobody chose — and would print them
 * beside a number measured over a different span.
 *
 * NAMES NO BASIS, deliberately. The basis is in the header dropdown governing every card;
 * repeating "vs previous month" per card duplicates it, and the caption is always visible,
 * so the extra clause wraps to a second line on a phone. That also keeps this away from
 * `comparisonCaption(option)` in `_shared/timeframe/comparison-option.ts`, which is THE
 * basis-word table — there is no second vocabulary here to drift from it.
 *
 * NAMED `baselineCaption`, not `comparisonCaption`. The shared module already exports that
 * name with a different signature, and two same-named functions are a trap the moment
 * someone auto-imports, disjoint module trees or not. "Baseline" is DASH-BASELINE-00's own
 * word for the thing a delta is measured against.
 *
 * `formattedValue` is the caller's already-formatted scalar, so a currency card and a
 * count card can each render their own units without this helper knowing about either.
 */
export function baselineCaption(
  comparisonWindow: ReportDateRange,
  formattedValue: string,
): string {
  return `vs. ${formattedValue} (${formatRangeSpan(comparisonWindow.from, comparisonWindow.to)})`;
}
