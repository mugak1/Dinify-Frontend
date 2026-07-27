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
 * An id names TWO things: the window to compare against, and — at month level, where the
 * question exists — how the two series are PAIRED inside the chart (`pairingFor`). Below
 * month level pairing is not a choice: a day is one point, and a Mon–Sun week against a
 * Mon–Sun week is already weekday-aligned by position.
 *
 * ⚠ `prev-year` and `prev-year-by-day` are DIFFERENT WINDOWS, not two spellings of one.
 * This is the most confusable pair in the vocabulary, so it is spelled out here rather
 * than left to a commit message:
 *   `prev-year`        — a bare 364-day shift. Offered BELOW month level, where the window
 *                        itself is the unit being compared and shifting it is what makes
 *                        "the same Wednesday last year" mean anything. (At year shapes it
 *                        resolves calendar-aligned; a 364-day shift on a 365-day year would
 *                        overlap the range itself.)
 *   `prev-year-by-day` — the SAME CALENDAR MONTH one year back, paired by weekday. Offered
 *                        at month level only. A 364-day shift there straddles two months,
 *                        so its total mixes July and August takings and no operator would
 *                        recognise it as "last July".
 */
export type ComparisonOption =
  | 'none'
  /** The immediately preceding block of equal length. Only shape `custom` offers it. */
  | 'prev-period'
  | 'prev-day'
  | 'prev-week'
  /** The previous calendar month, paired by weekday. Month shapes only. */
  | 'prev-month-by-day'
  /** The previous calendar month, paired by calendar date. Month shapes only. */
  | 'prev-month-by-date'
  /** A bare 364-day shift. Below month level; calendar-aligned at whole-year shapes. */
  | 'prev-year'
  /** The same calendar month one year back, paired by weekday. Month shapes only. */
  | 'prev-year-by-day'
  /** Calendar-aligned: the same dates, one year back. */
  | 'dates-last-year';

/**
 * How the two series line up inside a chart, independent of which window they are drawn
 * from (TIMEFRAME-02C).
 *
 * `by-date` is index pairing — position N of the comparison against position N of the
 * primary, which is what the chart has always done. `by-day` shifts the comparison lookup
 * so weekdays meet: a restaurant's Saturday does not resemble its Tuesday, so pairing July
 * against June by calendar date sets Tue 7 Jul beside Sun 7 Jun and reads as a collapse
 * that never happened.
 */
export type SeriesPairing = 'by-day' | 'by-date';

/**
 * The pairing an id implies. `by-date` for everything that is not explicitly `-by-day`,
 * so every option that predates 02C keeps its behaviour exactly.
 */
export function pairingFor(option: ComparisonOption): SeriesPairing {
  return option === 'prev-month-by-day' || option === 'prev-year-by-day' ? 'by-day' : 'by-date';
}

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
  'prev-month-by-day',
  'prev-month-by-date',
  'prev-year',
  'prev-year-by-day',
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
  // THE CAPTION NAMES THE WINDOW, NOT THE PAIRING. `prev-month-by-day` and
  // `prev-month-by-date` resolve to the SAME window, so their delta chips show identical
  // numbers — captioning them differently would imply a difference the figures do not
  // have. Pairing is a chart concern and shows up in the chart.
  //
  // THAT PRINCIPLE IS DELIBERATELY NOT APPLIED to `prev-year-by-day` / `dates-last-year`,
  // which also share a window at month level yet are worded differently. `dates-last-year`
  // is offered at day and week level TOO, where "same month last year" would be simply
  // false, so its caption has to stay shape-agnostic. Unifying the two to satisfy the rule
  // above would break the shapes that rule was never about — the divergence is intended.
  'prev-month-by-day': { menu: 'Previous month by day (Mon–Sun)', caption: 'vs previous month' },
  'prev-month-by-date': { menu: 'Previous month by date (DD/MM)', caption: 'vs previous month' },
  'prev-year': { menu: 'Previous year', caption: 'vs previous year' },
  'prev-year-by-day': {
    menu: 'Previous year by day (Mon–Sun)',
    caption: 'vs same month last year',
  },
  // The "(DD/MM)" qualifier earns its place in the MENU, where it is what distinguishes
  // these entries from the "by day" ones sitting directly above them. On a chip, beside a
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
