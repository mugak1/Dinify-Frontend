// Timeframe display strings for the dashboard cards.
//
// Both the revenue card and the total-orders card rendered byte-identical copies of an
// axis formatter and a comparison caption, keyed on the old coarse enum. One copy each
// now, keyed on the resolved bucket and range, so the two charts can never disagree
// about how a tick reads or which window a delta is measured against.

import { ReportBucketUnit, ReportDateRange, previousEqualLengthPeriod } from '../../../_shared/timeframe';
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
 */
export function bucketAxisLabel(at: string, bucketUnit: ReportBucketUnit): string {
  const d = new Date(at);
  if (isNaN(d.getTime())) return at;
  switch (bucketUnit) {
    case 'hour':
      return d.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
    case 'day':
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    case 'month':
      return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    case 'year':
      return d.toLocaleDateString('en-US', { year: 'numeric' });
  }
}

/**
 * Caption for a period-over-period delta: `vs. <previous value> (<from> – <to>)`.
 *
 * It names the window the number was actually measured against, computed with
 * `previousEqualLengthPeriod` — the mirror of what dashboard-v2 does. This replaces
 * 'vs last day' / 'vs last week' / 'vs last month' / 'vs last year', which were derived
 * from the UI selection and never from the data. The YTD case was outright wrong: the
 * backend returns the preceding equal-length block (roughly Jun–Dec of the prior year
 * for a Jan–Jul selection), never "last year".
 *
 * `formattedPrevious` is the caller's already-formatted scalar, so a currency card and a
 * count card can each render their own units without this helper knowing about either.
 */
export function comparisonCaption(range: ReportDateRange, formattedPrevious: string): string {
  const prev = previousEqualLengthPeriod(range);
  return `vs. ${formattedPrevious} (${formatRangeSpan(prev.from, prev.to)})`;
}
