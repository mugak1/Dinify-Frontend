import { ModuleKey, PermissionsMap } from '../_models/app.models';

/**
 * Pure, framework-free RBAC access helpers — the single anti-drift source that
 * the permission guard, the sidebar nav, the post-login landing, and the
 * settings hub all import. Keeping the permission→route vocabulary and the
 * access predicates in one place stops the four call sites from drifting apart.
 *
 * IMPORTANT: the frontend is NOT the security boundary. The backend enforces
 * module access server-side on every gate, so everything here is UX hygiene —
 * don't show a user a module the backend will 403, and don't dump them on a
 * page they can't use. That framing is why canAccess() fails OPEN (see below).
 */

/**
 * The reconciliation point between permission vocabulary (ModuleKey) and router
 * vocabulary (absolute routes). Note tables→/dining-tables and kitchen→/kitchen
 * (a top-level route, not under /rest-app), and the two settings sub-modules.
 */
export const MODULE_ROUTES: Record<ModuleKey, string> = {
  dashboard: '/rest-app/dashboard',
  menu: '/rest-app/menu',
  tables: '/rest-app/dining-tables',
  reviews: '/rest-app/reviews',
  reports: '/rest-app/reports',
  settings: '/rest-app/settings',
  kitchen: '/kitchen',
  team: '/rest-app/settings/team',
  billing: '/rest-app/settings/billing',
};

/**
 * Where a user who can access NO module lands. Ungated (the top-level account
 * page), so redirecting here can never loop. Shared by firstAccessibleRoute()
 * and the sidebar "No modules assigned" note so the landing and the note cannot
 * diverge — a user on /account for having no modules MUST see the note, and a
 * user seeing the note MUST be one who landed on /account.
 */
export const NO_MODULE_ROUTE = '/rest-app/account';

/**
 * Landing priority: the first module the user can access wins. Dashboard is the
 * natural home; the settings sub-modules (team, billing) trail so a user with
 * only a sub-module still lands somewhere usable rather than on /account.
 */
export const MODULE_PRIORITY: ModuleKey[] = [
  'dashboard', 'menu', 'tables', 'reviews', 'reports', 'kitchen', 'settings', 'team', 'billing',
];

/**
 * Whether a membership may access a module, per its permissions map.
 *
 * - map === undefined → ALLOW. This is a DELIBERATE migration cushion: a
 *   rest_role snapshot taken before the backend added the permissions field
 *   must not be locked out of every module on deploy day. The backend enforces
 *   module access server-side regardless, so this fail-open is a UX cushion,
 *   NOT a security gap. DO NOT change this to fail-closed — doing so would cause
 *   a deploy-day lockout for every pre-permissions session.
 * - map[key] === false → DENY (explicit).
 * - otherwise → ALLOW. A present map missing a key cannot occur under the
 *   backend's stable 9-key contract; if it ever did, the backend still 403s the
 *   underlying call, so this resolves to a harmless UX wart, not exposure.
 *   Left fail-open by design.
 */
export function canAccess(map: PermissionsMap | undefined, key: ModuleKey): boolean {
  if (map === undefined) return true;
  if (map[key] === false) return false;
  return true;
}

/**
 * The route a membership should land on / be redirected to.
 *
 * - Absent map → role-based fallback (same migration cushion as canAccess):
 *   kitchen-only staff → the Kitchen board, everyone else → the dashboard.
 * - Present map → the first MODULE_PRIORITY module the user can access.
 * - Present map granting nothing → NO_MODULE_ROUTE (the shared predicate).
 */
export function firstAccessibleRoute(
  map: PermissionsMap | undefined,
  roles?: string[],
): string {
  if (map === undefined) {
    const r = roles ?? [];
    const kitchenOnly =
      r.includes('kitchen') && !r.includes('owner') && !r.includes('manager');
    return kitchenOnly ? MODULE_ROUTES.kitchen : MODULE_ROUTES.dashboard;
  }
  for (const key of MODULE_PRIORITY) {
    if (canAccess(map, key)) return MODULE_ROUTES[key];
  }
  return NO_MODULE_ROUTE;
}
