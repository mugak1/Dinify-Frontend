// Per-host configuration for `TimeframeService`.
//
// The service is route-scoped, and as of TIMEFRAME-01B there are TWO hosts — the
// Reports shell and the Dashboard. They answer different questions and so must not
// share a "last used" memo: Dashboard asks "how are we doing NOW", Reports asks
// "what happened over this PERIOD". A Dashboard that opens on last month because you
// were doing month-end reporting in Reports yesterday is wrong, which is why the
// seed key is per-host rather than per-app.

import { InjectionToken } from '@angular/core';
import { ReportPreset } from './timeframe-range';

export interface TimeframeConfig {
  /**
   * localStorage key PREFIX for the "last used" seed. The restaurant id is appended
   * as `:<id|global>`, matching the `<feature>.<setting>:<restaurantId>` convention
   * documented in `_services/storage/persisted-state.ts`.
   */
  seedKey: string;
  /**
   * Landing preset when neither the URL nor the seed supplies a usable range.
   *
   * `'custom'` is excluded BY TYPE rather than by documentation: `presetToRange`
   * returns a single-day seed at `now` for it, which is meaningless as a landing
   * default. Making it unrepresentable is cheaper than catching it at runtime.
   */
  defaultPreset: Exclude<ReportPreset, 'custom'>;
}

/**
 * Registered per host alongside `TimeframeService` in the route's `providers`.
 *
 * The root factory default exists so the service stays constructible in a TestBed
 * with no route. Its `seedKey` is deliberately NEUTRAL — not `'reports.dateRange'` —
 * so a host that forgets to register a config cannot silently read and write the
 * Reports seed. `'this-month'` preserves what `defaultRange()` meant before this
 * token existed.
 */
export const TIMEFRAME_CONFIG = new InjectionToken<TimeframeConfig>('TIMEFRAME_CONFIG', {
  providedIn: 'root',
  factory: () => ({ seedKey: 'timeframe.dateRange', defaultPreset: 'this-month' }),
});
