// Shared timeframe core. THE single import path for the range model, the
// range→bucket engine, and the URL-backed timeframe state — import from
// '@/_shared/timeframe' (relatively), never from the individual files, and never
// from the Reports module, which no longer owns any of it.

export {
  REPORT_PRESETS,
  defaultRange,
  isFutureDated,
  isValidReportDateRange,
  parseTimeframeParams,
  presetToRange,
} from './timeframe-range';
export type { ReportDateRange, ReportPreset, TimeframeParams } from './timeframe-range';

export {
  BUCKET_TO_CATEGORY,
  HOURLY_MAX_DAYS,
  SALES_TRENDS_CAP_DAYS,
  comparisonRange,
  comparisonRangeLabel,
  resolveTimeframe,
} from './timeframe-engine';
export type { ReportBucketUnit, SalesTrendsCategory, TimeframeResolution } from './timeframe-engine';

export { TIMEFRAME_CONFIG } from './timeframe-config';
export type { TimeframeConfig } from './timeframe-config';

export { TimeframeService } from './timeframe.service';
