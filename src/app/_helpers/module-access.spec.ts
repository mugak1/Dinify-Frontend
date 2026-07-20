import {
  canAccess,
  firstAccessibleRoute,
  MODULE_ROUTES,
  NO_MODULE_ROUTE,
} from './module-access';
import { ModuleKey, PermissionsMap } from '../_models/app.models';

const ALL_KEYS: ModuleKey[] = [
  'dashboard', 'menu', 'tables', 'reviews', 'reports', 'settings', 'kitchen', 'billing', 'team',
];

/** A full 9-key map with every flag set to `value`. */
const fullMap = (value: boolean): PermissionsMap =>
  ALL_KEYS.reduce((m, k) => { m[k] = value; return m; }, {} as PermissionsMap);

/** A full 9-key map, all false except the listed keys set true. */
const onlyTrue = (...keys: ModuleKey[]): PermissionsMap => {
  const m = fullMap(false);
  keys.forEach(k => (m[k] = true));
  return m;
};

describe('module-access', () => {
  describe('canAccess', () => {
    it('fails OPEN on an absent (undefined) map — the migration cushion', () => {
      ALL_KEYS.forEach(k => expect(canAccess(undefined, k)).toBeTrue());
    });

    it('denies on an explicit false (real deny path via a permissions fixture)', () => {
      const map = onlyTrue('tables'); // tables:true, everything else explicitly false
      expect(canAccess(map, 'menu')).toBeFalse();
      expect(canAccess(map, 'dashboard')).toBeFalse();
      expect(canAccess(map, 'tables')).toBeTrue();
    });

    it('fails OPEN on a present map that is missing a key', () => {
      const map: PermissionsMap = { dashboard: false }; // only one key present
      expect(canAccess(map, 'menu')).toBeTrue();        // missing key → allow
      expect(canAccess(map, 'dashboard')).toBeFalse();  // present false → deny
    });
  });

  describe('firstAccessibleRoute', () => {
    it('lands an all-true map on the dashboard (head of MODULE_PRIORITY)', () => {
      expect(firstAccessibleRoute(fullMap(true))).toBe(MODULE_ROUTES.dashboard);
    });

    it('lands a Tables-only map on /dining-tables', () => {
      expect(firstAccessibleRoute(onlyTrue('tables'))).toBe('/dining-tables');
      expect(firstAccessibleRoute(onlyTrue('tables'))).toBe(MODULE_ROUTES.tables);
    });

    it('lands an all-false map on /account (the no-module fallback)', () => {
      expect(firstAccessibleRoute(fullMap(false))).toBe(NO_MODULE_ROUTE);
      expect(firstAccessibleRoute(fullMap(false))).toBe('/account');
    });

    it('honours MODULE_PRIORITY order (menu beats tables when both granted)', () => {
      expect(firstAccessibleRoute(onlyTrue('tables', 'menu'))).toBe(MODULE_ROUTES.menu);
    });

    it('lands a present kitchen-only map on /kitchen', () => {
      expect(firstAccessibleRoute(onlyTrue('kitchen'))).toBe('/kitchen');
    });

    it('lands a billing-only map on /settings/billing (sub-module trails)', () => {
      expect(firstAccessibleRoute(onlyTrue('billing'))).toBe(MODULE_ROUTES.billing);
    });

    describe('absent map → role-based fallback', () => {
      it('routes kitchen-only roles to /kitchen', () => {
        expect(firstAccessibleRoute(undefined, ['kitchen'])).toBe('/kitchen');
      });
      it('routes kitchen + owner to the dashboard', () => {
        expect(firstAccessibleRoute(undefined, ['kitchen', 'owner'])).toBe(MODULE_ROUTES.dashboard);
      });
      it('routes kitchen + manager to the dashboard', () => {
        expect(firstAccessibleRoute(undefined, ['kitchen', 'manager'])).toBe(MODULE_ROUTES.dashboard);
      });
      it('routes owner-only to the dashboard', () => {
        expect(firstAccessibleRoute(undefined, ['owner'])).toBe(MODULE_ROUTES.dashboard);
      });
      it('routes an empty / missing role list to the dashboard', () => {
        expect(firstAccessibleRoute(undefined, [])).toBe(MODULE_ROUTES.dashboard);
        expect(firstAccessibleRoute(undefined)).toBe(MODULE_ROUTES.dashboard);
      });
    });
  });

  describe('shared no-module predicate (note ⇔ landing)', () => {
    it('an all-false map resolves to NO_MODULE_ROUTE', () => {
      expect(firstAccessibleRoute(fullMap(false))).toBe(NO_MODULE_ROUTE);
    });
    it('any granted module makes the user NOT a no-module user', () => {
      expect(firstAccessibleRoute(onlyTrue('settings'))).not.toBe(NO_MODULE_ROUTE);
    });
    it('an absent map is NOT a no-module user (role fallback, never /account)', () => {
      expect(firstAccessibleRoute(undefined, [])).not.toBe(NO_MODULE_ROUTE);
    });
  });
});
