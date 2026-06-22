// Pure display helpers for the date-range control. Kept side-effect free so they
// can be unit-tested in isolation and reused by both the trigger label and the
// panel summary.

import { format, getMonth, getYear, parseISO } from 'date-fns';
import { ReportPreset } from '../../models/reports.models';

/** Human labels for every preset — drives the trigger text and the preset list. */
export const PRESET_LABELS: Record<ReportPreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  'this-week': 'This week',
  'last-week': 'Last week',
  'this-month': 'This month',
  'last-month': 'Last month',
  'this-year': 'This year',
  custom: 'Custom',
};

/** En dash (U+2013) — the range separator used throughout (never a hyphen). */
const EN_DASH = '–';

/**
 * Compact, "collapsing" range for the trigger. Shares the month/year when it can:
 *   single day        -> "1 Jun 2026"
 *   same month + year -> "1–30 Jun 2026"
 *   same year         -> "28 May – 3 Jun 2026"
 *   cross-year        -> "1 Jun 2025 – 2 Jan 2026"
 *
 * `from`/`to` are zero-padded ISO dates. Parsed with `parseISO` (local midnight
 * for a date-only string) so display is timezone-stable in CI.
 */
export function formatRangeSpan(from: string, to: string): string {
  const a = parseISO(from);
  const b = parseISO(to);
  if (from === to) return format(a, 'd MMM yyyy');

  const sameYear = getYear(a) === getYear(b);
  const sameMonth = sameYear && getMonth(a) === getMonth(b);

  if (sameMonth) return `${format(a, 'd')}${EN_DASH}${format(b, 'd MMM yyyy')}`;
  if (sameYear) return `${format(a, 'd MMM')} ${EN_DASH} ${format(b, 'd MMM yyyy')}`;
  return `${format(a, 'd MMM yyyy')} ${EN_DASH} ${format(b, 'd MMM yyyy')}`;
}

/**
 * Verbose, "non-collapsing" range for the panel summary line — repeats the month
 * within a year so the two endpoints read explicitly:
 *   single day -> "1 Jun 2026"
 *   same year  -> "1 Jun – 30 Jun 2026"
 *   cross-year -> "1 Jun 2025 – 2 Jan 2026"
 */
export function formatRangeSummary(from: string, to: string): string {
  const a = parseISO(from);
  const b = parseISO(to);
  if (from === to) return format(a, 'd MMM yyyy');

  if (getYear(a) === getYear(b)) return `${format(a, 'd MMM')} ${EN_DASH} ${format(b, 'd MMM yyyy')}`;
  return `${format(a, 'd MMM yyyy')} ${EN_DASH} ${format(b, 'd MMM yyyy')}`;
}
