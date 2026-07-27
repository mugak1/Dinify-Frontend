import { Injectable } from '@angular/core';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { AuthenticationService } from '../_services/authentication.service';

@Injectable({ providedIn: 'root' })
export class AuthGuard {
    constructor(
        private router: Router,
        private authenticationService: AuthenticationService
    ) { }

    canActivate(route: ActivatedRouteSnapshot, _state: RouterStateSnapshot) {
        const user = this.authenticationService.userValue;
        if (user) {
            // check if route is restricted by role
            const { roles, restaurant_roles } = route.data;
            if (roles || restaurant_roles) {
                // NOTE there is deliberately no `profile.roles` branch here. One used to
                // sit above this line, and it was the mechanism by which a platform role
                // string in `data.roles` granted route access. `profile.roles` is the
                // ACCOUNT-level array; authority comes from the MEMBERSHIP arrays below.
                // Held by scripts/check-platform-roles.mjs — do not reintroduce it.

                // The 'restaurant_staff' bridge — any restaurant membership grants
                // access. This is what gates the portal shell.
                const hasRestaurantRole = Array.isArray(roles)
                    && roles.includes('restaurant_staff')
                    && user.profile.restaurant_roles
                    && user.profile.restaurant_roles.length > 0;

                // Additive: a route may require SPECIFIC restaurant roles via
                // data.restaurant_roles (e.g. ['owner','manager','kitchen']). Granted
                // when the user holds any of them at any restaurant. Existing routes
                // don't set this key, so their behaviour is unchanged.
                const requiredRestaurantRoles: string[] =
                    Array.isArray(restaurant_roles) ? restaurant_roles : [];
                const hasSpecificRestaurantRole = requiredRestaurantRoles.length > 0
                    && (user.profile.restaurant_roles ?? []).some(
                        rr => rr.roles?.some(role => requiredRestaurantRoles.includes(role)));

                if (!hasRestaurantRole && !hasSpecificRestaurantRole) {
                    this.router.navigate(['/']);
                    return false;
                }
            }

            // authorized so return true
            return true;
        }

        // not logged in so redirect to login page. The post-login redirect always
        // lands on the user's first accessible module, so we deliberately do NOT
        // capture a returnUrl here.
        this.router.navigate(['/login']);
        return false;
    }
}