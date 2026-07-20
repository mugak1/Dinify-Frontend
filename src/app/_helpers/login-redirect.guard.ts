import { inject } from '@angular/core';
import { CanActivateFn, RedirectCommand, Router } from '@angular/router';
import { AuthenticationService } from '../_services/authentication.service';
import { LoginResponse } from '../_models/app.models';
import { firstAccessibleRoute, MODULE_ROUTES } from './module-access';

/**
 * /login gate for ALREADY-authenticated users. Since the portal moved to the
 * URL root, the bare domain redirects to /login — so a signed-in operator who
 * types the domain (or navigates to /login) was shown the login form again.
 * This guard forwards them to the same landing the post-login redirect uses,
 * as a UrlTree redirect (never router.navigate — the permission.guard
 * philosophy: the router decides, components don't sniff state).
 *
 * Redirect only when a landing is actually resolvable; otherwise the form
 * renders (return true):
 * - no user → login renders (includes every post-logout arrival: both logout
 *   paths clear storage BEFORE a full-page hardRedirect, so the arriving
 *   /login?reason=inactivity load is unauthenticated and its banner shows)
 * - login-selected membership (rest_role) → firstAccessibleRoute for it
 * - no membership but dinify_admin → /mgt-app (the post-login admin branch;
 *   without this an admin would bounce /dashboard → AuthGuard deny → '/' →
 *   /login → here, forever)
 * - no membership, not admin (a multi-restaurant user who never picked one,
 *   or a zero-membership account) → login renders, matching today
 *
 * replaceUrl: the /login (or bare-domain) history entry must not survive the
 * redirect, or the back button would bounce straight back into this guard.
 */
export const loginRedirectGuard: CanActivateFn = () => {
  const auth = inject(AuthenticationService);
  const router = inject(Router);

  const user = auth.userValue;
  if (!user) {
    return true;
  }

  const membership = auth.currentRestaurantRole;
  let target: string | null = null;
  if (membership) {
    target = firstAccessibleRoute(membership.permissions, membership.roles);
    // /kitchen is the one landing with an AuthGuard role policy BEYOND the
    // permissions map. A membership whose map resolves kitchen-first while its
    // user cannot pass that policy (e.g. a Staff role granted only the Kitchen
    // module in the Roles & access grid) would loop: /kitchen deny → '/' →
    // /login → here. Mask kitchen and land on the next accessible module (or
    // /account). Only a PRESENT map can hit this: the map-absent branch of
    // firstAccessibleRoute returns /kitchen solely for kitchen-role members.
    if (target === MODULE_ROUTES.kitchen && !canEnterKitchenRoute(user)) {
      target = firstAccessibleRoute(
        { ...(membership.permissions ?? {}), kitchen: false },
        membership.roles,
      );
    }
  } else if ((user.profile?.roles ?? []).includes('dinify_admin')) {
    target = '/mgt-app';
  }

  if (!target) {
    return true;
  }
  return new RedirectCommand(router.parseUrl(target), { replaceUrl: true });
};

// The /kitchen route's admission policy, mirrored from its declaration in
// app-routing.module.ts (data.roles + data.restaurant_roles as AuthGuard
// evaluates them — any membership counts, not just the selected one). Keep in
// sync with that route.
const KITCHEN_ROUTE_TOP_LEVEL_ROLES = ['dinify_admin', 'dinify_account_manager'];
const KITCHEN_ROUTE_RESTAURANT_ROLES = ['owner', 'manager', 'kitchen'];

function canEnterKitchenRoute(user: LoginResponse): boolean {
  const topLevelRoles = user.profile?.roles ?? [];
  if (KITCHEN_ROUTE_TOP_LEVEL_ROLES.some((role) => topLevelRoles.includes(role))) {
    return true;
  }
  return (user.profile?.restaurant_roles ?? []).some(
    (rr) => rr.roles?.some((role) => KITCHEN_ROUTE_RESTAURANT_ROLES.includes(role)),
  );
}
