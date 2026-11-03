import { InjectionToken, isDevMode } from '@angular/core';

/**
 * Whether this is a DEVELOPMENT build (`ng serve` / the `development` configuration).
 *
 * WHY NOT `environment.production`. The build that actually ships, `uat`, bakes
 * `production: false` (see `release/policy.json` and CLAUDE.md), so a gate on that
 * flag would OPEN on the live site. `isDevMode()` is false in every optimised build:
 * `production`, `uat`, `dev` and `staging` all optimise scripts, which compiles
 * `ngDevMode` to `false`. Only the unoptimised `development` configuration answers
 * true.
 *
 * A token rather than a direct call so a spec can stand in for a production build;
 * the default is the real answer.
 */
export const FLOOR_DEV_MODE = new InjectionToken<boolean>('FLOOR_DEV_MODE', {
  providedIn: 'root',
  factory: () => isDevMode(),
});

/**
 * May the floor view (the Tables page's Service view) be shown?
 *
 * A live restaurant must never see mock tables or mock orders to confirm — that is
 * worse than no screen. So while the floor runs on mock data the view exists only in
 * a development build. FE-C wires the real endpoints and flips
 * `FloorService.USE_MOCK_DATA`, which is what opens it in production.
 */
export function floorViewAvailable(devMode: boolean, useMockData: boolean): boolean {
  return devMode || !useMockData;
}
