// Shared timeframe core — the COMPARISON VOCABULARY (TIMEFRAME-02A).
//
// What a range is measured AGAINST is a user selection, not a consequence of the
// preset. This file holds the vocabulary of that selection — the option ids, the URL
// token set, and the labels. The maths that turns an option into a window lives in
// `timeframe-engine.ts` (`comparisonOptionsFor` / `resolveComparison`), because that
// needs `RangeShape`.
//
// WHY ITS OWN FILE. `timeframe-range.ts` has to validate the `cmp` URL param inside
// `parseTimeframeParams` (one parser, not two), and `timeframe-engine.ts` already
// imports `timeframe-range.ts` — so the range module can never import the engine
// without creating a cycle. A leaf module with ZERO imports keeps
// `comparison-option → timeframe-range → timeframe-engine` a strict DAG. Do not add
// an import here; that is the whole point of the file.

/**
 * A comparison basis. Which of these are OFFERED depends on the shape of the selected
 * range (`comparisonOptionsFor`), so this union is the full vocabulary, not a menu.
 *
 * `prev-year` and `dates-last-year` are genuinely different windows and both belong in
 * the sets that carry them: `prev-year` is WEEKDAY-aligned (a Wednesday compares to a
 * Wednesday), `dates-last-year` is CALENDAR-aligned (22 Jul compares to 22 Jul, which
 * was a different weekday). Where the two would resolve identically — a whole calendar
 * year — only one is offered, because an option set containing two entries that render
 * the same window is a menu that lies.
 */
export type ComparisonOption =
  | 'none'
  /** The immediately preceding block of equal length. Only shape `custom` offers it. */
  | 'prev-period'
  | 'prev-day'
  | 'prev-week'
  | 'prev-month'
  /** Weekday-aligned: 364 days back. Calendar-aligned for whole-year shapes. */
  | 'prev-year'
  /** Calendar-aligned: the same dates, one year back. */
  | 'dates-last-year';

/**
 * Every option id, for validating an untrusted `cmp` URL param. Membership here means
 * "this is a known token", NOT "this is valid for the current range" — shape-validity
 * is `TimeframeService`'s job, since only it knows the range.
 */
export const COMPARISON_OPTIONS: ComparisonOption[] = [
  'none',
  'prev-period',
  'prev-day',
  'prev-week',
  'prev-month',
  'prev-year',
  'dates-last-year',
];

/**
 * THE one label source. Before 02A there were five: four byte-identical
 * `COMPARISON_LABELS` maps (one per report tab), plus `comparisonRangeLabel` in the
 * engine for the shell toggle — two independent vocabularies for one concept, which
 * agreed only by coincidence. One table, two columns, keyed on the SELECTION rather
 * than on the preset.
 *
 * `menu` is what the dropdown shows. `caption` is the trailing text on a delta chip
 * ("vs previous month"); `none` has none, since nothing renders a chip when the
 * comparison is off.
 */
const COMPARISON_LABELS: Record<ComparisonOption, { menu: string; caption: string }> = {
  none: { menu: 'No comparison', caption: '' },
  'prev-period': { menu: 'Previous period', caption: 'vs previous period' },
  'prev-day': { menu: 'Previous day', caption: 'vs previous day' },
  'prev-week': { menu: 'Previous week', caption: 'vs previous week' },
  'prev-month': { menu: 'Previous month', caption: 'vs previous month' },
  'prev-year': { menu: 'Previous year', caption: 'vs previous year' },
  // The "(DD/MM)" qualifier earns its place in the MENU, where it is what distinguishes
  // this entry from "Previous year" sitting directly above it. On a chip, beside a
  // number, it is noise.
  'dates-last-year': { menu: 'Dates last year (DD/MM)', caption: 'vs dates last year' },
};

/** Dropdown label, e.g. "Previous month". */
export function comparisonOptionLabel(option: ComparisonOption): string {
  return COMPARISON_LABELS[option].menu;
}

/** Delta-chip caption, e.g. "vs previous month". Empty string for `'none'`. */
export function comparisonCaption(option: ComparisonOption): string {
  return COMPARISON_LABELS[option].caption;
}
