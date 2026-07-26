// Shared timeframe core. THE single import path for the range model, the
// range→bucket engine, the URL-backed timeframe state, and the picker — import from
// '@/_shared/timeframe' (relatively), never from the individual files, and never
// from the Reports module, which no longer owns any of it.
//
// INTERNAL RULE: files INSIDE this folder — picker/ included — import their siblings by
// DIRECT PATH (`./timeframe-range`, `../timeframe-range`), never `.`/`./index`. This
// barrel imports them, so a barrel import from inside is a cycle. It would not fail the
// build; it would surface as an `undefined` at module-init, in a vendor chunk, with no
// compile error pointing at the cause.

export {
  REPORT_PRESETS,
  defaultRange,
  isFutureDated,
  isValidReportDateRange,
  parseTimeframeParams,
  presetToRange,
  rangeIncludesToday,
} from './timeframe-range';
export type { ReportDateRange, ReportPreset, TimeframeParams } from './timeframe-range';

export {
  BUCKET_TO_CATEGORY,
  HOURLY_MAX_DAYS,
  SALES_TRENDS_CAP_DAYS,
  comparisonRange,
  comparisonRangeLabel,
  previousEqualLengthPeriod,
  resolveTimeframe,
} from './timeframe-engine';
export type { ReportBucketUnit, SalesTrendsCategory, TimeframeResolution } from './timeframe-engine';

export { TIMEFRAME_CONFIG } from './timeframe-config';
export type { TimeframeConfig } from './timeframe-config';

export { TimeframeService } from './timeframe.service';

// Only the picker itself is exported. `DateRangePanelComponent` and
// `RangeCalendarComponent` stay unexported on purpose: each carries a non-obvious
// contract (the panel owns staged state and re-seeds from `initial` in `ngOnChanges`;
// the calendar is controlled-reset / uncontrolled-interaction and must never be fed its
// own output back). Exporting them would invite a consumer to mount them without it.
export { TimeframePickerComponent } from './picker/timeframe-picker.component';
