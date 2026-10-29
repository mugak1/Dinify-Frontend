import { RestaurantRole } from '../../_models/app.models';
import { ModuleKey } from '../../_models/app.models';
import { canAccess, firstAccessibleRoute } from '../../_helpers/module-access';

/**
 * Where to land after the selected restaurant changes (SHELL-FINISH-00, PR 3):
 * ONE rule, shared by the venue switcher and the cross-tab guard so the two
 * cannot disagree.
 *
 * The SAME top-level page, if the new membership can open it; otherwise its
 * first accessible route (the rule login uses). Only the top-level segment is
 * kept: deeper paths and query strings carry restaurant-specific ids (a section,
 * an order, a review), which mean nothing — or something else — at the other
 * restaurant. The portal pages that are not RBAC modules (Support, My account,
 * Notifications) are open to every member, so they are always kept.
 *
 * No membership (another tab signed out, or a sign-in in another tab cleared
 * storage) lands on /login.
 */
const ALWAYS_OPEN: readonly string[] = ['support', 'account', 'notifications'];

const SEGMENT_MODULE: Readonly<Record<string, ModuleKey>> = {
  dashboard: 'dashboard',
  menu: 'menu',
  'dining-tables': 'tables',
  reviews: 'reviews',
  reports: 'reports',
  settings: 'settings',
};

export function landingPathFor(currentUrl: string, membership: RestaurantRole | null | undefined): string {
  if (!membership || typeof membership.restaurant_id !== 'string' || !membership.restaurant_id) {
    return '/login';
  }
  const segment = currentUrl.split('?')[0].split('#')[0].split('/').filter(Boolean)[0] ?? '';
  if (ALWAYS_OPEN.includes(segment)) return `/${segment}`;
  const module = SEGMENT_MODULE[segment];
  if (module && canAccess(membership.permissions, module)) return `/${segment}`;
  return firstAccessibleRoute(membership.permissions, membership.roles);
}
