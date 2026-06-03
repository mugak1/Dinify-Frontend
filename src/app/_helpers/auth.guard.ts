import { Injectable } from '@angular/core';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { AuthenticationService } from '../_services/authentication.service';

@Injectable({ providedIn: 'root' })
export class AuthGuard {
    constructor(
        private router: Router,
        private authenticationService: AuthenticationService
    ) { }

    canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot) {
        const user = this.authenticationService.userValue;
        if (user) {
            // check if route is restricted by role
            const { roles, restaurant_roles } = route.data;
            if (roles || restaurant_roles) {
                const hasTopLevelRole = Array.isArray(roles)
                    && roles.some((r: string) => user.profile.roles.includes(r));

                // Existing 'restaurant_staff' bridge — any restaurant role grants
                // access, since the backend may not duplicate that into profile.roles.
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

                if (!hasTopLevelRole && !hasRestaurantRole && !hasSpecificRestaurantRole) {
                    this.router.navigate(['/']);
                    return false;
                }
            }

            // authorized so return true
            return true;
        }

        // not logged in so redirect to login page with the return url
        this.router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
        return false;
    }
}