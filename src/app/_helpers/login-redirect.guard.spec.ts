import { Component, NO_ERRORS_SCHEMA, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { SpyLocation, provideLocationMocks } from '@angular/common/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Route, Router, RouterOutlet, Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from '../app-routing.module';
import { LoginComponent } from '../auth/login/login.component';
import { AuthenticationService } from '../_services/authentication.service';
import { LoginResponse, PermissionsMap, RestaurantRole } from '../_models/app.models';

/**
 * Routed specs for loginRedirectGuard: an already-authenticated user who
 * navigates to /login (or the bare domain, which redirects there) must land on
 * the same route the post-login redirect would pick — settling in ONE
 * navigation with no /login history entry — while an unauthenticated user
 * still gets the real login form (including the ?reason=inactivity notice).
 *
 * Navigations run against a stubbed copy of the real `routes` array (paths,
 * ordering, redirects and the login route's guard are real; components are
 * stubs — except /login, which mounts the REAL LoginComponent so the
 * form-renders cases exercise the actual template). Every OTHER guard is
 * dropped, mirroring app-routing.module.spec.ts's stubbing approach.
 */

@Component({ template: '' })
class NamedStubComponent {}

@Component({ template: '<router-outlet />', imports: [RouterOutlet] })
class ShellStubComponent {}

@Component({ template: '' })
class LazyLeafStubComponent {}

function stubRoutesKeepingLoginGuard(): Routes {
  return routes.map((route) => {
    const copy: Route = { ...route };
    if (route.path !== 'login') {
      delete copy.canActivate;
    }
    if (copy.loadComponent) {
      delete copy.loadComponent;
      copy.component = NamedStubComponent;
    } else if (copy.component) {
      copy.component = route.path === 'login'
        ? LoginComponent
        : copy.loadChildren ? ShellStubComponent : NamedStubComponent;
    }
    if (copy.loadChildren) {
      delete copy.loadChildren;
      copy.children = [
        { path: '', pathMatch: 'full', component: LazyLeafStubComponent },
        { path: '**', component: LazyLeafStubComponent },
      ];
    }
    return copy;
  });
}

const ALL_FALSE: PermissionsMap = {
  dashboard: false, menu: false, tables: false, reviews: false, reports: false,
  settings: false, kitchen: false, billing: false, team: false,
};

const membership = (roles: string[], permissions?: PermissionsMap): RestaurantRole =>
  ({ restaurant_id: 'r1', restaurant: 'Test Restaurant', roles, ...(permissions ? { permissions } : {}) });

const user = (topRoles: string[], memberships: RestaurantRole[]): LoginResponse => ({
  token: 't', refresh: 'r', require_otp: false, prompt_password_change: false,
  profile: {
    id: 'u1', first_name: 'Asha', last_name: 'K', email: 'asha@test.ug',
    roles: topRoles, other_names: null, phone_number: null, restaurant_roles: memberships,
  },
});

describe('loginRedirectGuard (routed)', () => {
  let harness: RouterTestingHarness;
  let router: Router;
  let location: SpyLocation;

  // The guard reads these at navigation time; each test sets them before navigating.
  let authState: { userValue: LoginResponse | null; currentRestaurantRole: RestaurantRole | null };

  /** Sign in as a member whose selected membership is also on the profile. */
  function signInWithMembership(m: RestaurantRole, topRoles: string[] = ['restaurant_staff']): void {
    authState.userValue = user(topRoles, [m]);
    authState.currentRestaurantRole = m;
  }

  beforeEach(async () => {
    authState = { userValue: null, currentRestaurantRole: null };
    TestBed.configureTestingModule({
      declarations: [LoginComponent],
      providers: [
        provideRouter(stubRoutesKeepingLoginGuard()),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthenticationService,
          useValue: {
            get userValue() { return authState.userValue; },
            get currentRestaurantRole() { return authState.currentRestaurantRole; },
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    harness = await RouterTestingHarness.create();
    router = TestBed.inject(Router);
    location = TestBed.inject(Location) as SpyLocation;
  });

  function deepestComponent(): Type<unknown> | null {
    let snapshot = router.routerState.snapshot.root;
    while (snapshot.firstChild) snapshot = snapshot.firstChild;
    return (snapshot.component as Type<unknown> | null) ?? null;
  }

  describe('authenticated user hitting /login lands on the post-login route', () => {
    it('lands an owner membership on /dashboard', async () => {
      signInWithMembership(membership(['owner']));
      await harness.navigateByUrl('/login');
      expect(router.url).toBe('/dashboard');
    });

    it('lands a kitchen-only membership on /kitchen — NOT a hardcoded /dashboard', async () => {
      signInWithMembership(membership(['kitchen']));
      await harness.navigateByUrl('/login');
      expect(router.url).toBe('/kitchen');
    });

    it('lands a Tables-only permissions map on /dining-tables (map-based resolution)', async () => {
      signInWithMembership(membership(['restaurant_staff'], { ...ALL_FALSE, tables: true }));
      await harness.navigateByUrl('/login');
      expect(router.url).toBe('/dining-tables');
    });

    it('lands a no-modules (all-false map) membership on /account', async () => {
      signInWithMembership(membership(['restaurant_staff'], ALL_FALSE));
      await harness.navigateByUrl('/login');
      expect(router.url).toBe('/account');
    });

    it('lands a membershipless dinify_admin on /mgt-app (never /dashboard, which its AuthGuard would deny into a loop)', async () => {
      authState.userValue = user(['dinify_admin'], []);
      authState.currentRestaurantRole = null;
      await harness.navigateByUrl('/login');
      expect(router.url).toBe('/mgt-app');
    });

    it('settles in ONE navigation and writes NO /login history entry (back button cannot bounce)', async () => {
      signInWithMembership(membership(['owner']));
      await harness.navigateByUrl('/login');
      expect(location.path()).toBe('/dashboard');
      expect(location.urlChanges.filter((change) => change.includes('login')))
        .withContext('a /login URL reached the history log — back would bounce through the guard')
        .toEqual([]);
      expect(location.urlChanges.length)
        .withContext('the redirect must resolve inside the /login navigation, not as a second one')
        .toBe(1);
    });
  });

  describe('authenticated states with no resolvable landing render the form', () => {
    it('keeps a signed-in multi-restaurant user who never selected a membership on /login', async () => {
      authState.userValue = user(['restaurant_staff'], [membership(['owner']), membership(['manager'])]);
      authState.currentRestaurantRole = null;
      await harness.navigateByUrl('/login');
      expect(router.url).toBe('/login');
      expect(deepestComponent()).toBe(LoginComponent);
    });

    it('masks a kitchen-first map the user cannot enter (/kitchen requires a kitchen/owner/manager role) and lands /account in one hop', async () => {
      // A Staff-role membership granted ONLY the Kitchen module in the Roles &
      // access grid: firstAccessibleRoute says /kitchen, but that route's
      // AuthGuard would deny → '/' → /login → guard, forever. The guard must
      // pre-empt the bounce, not loop on it.
      signInWithMembership(membership(['restaurant_staff'], { ...ALL_FALSE, kitchen: true }));
      await harness.navigateByUrl('/login');
      expect(router.url).toBe('/account');
      expect(location.urlChanges.length).toBe(1);
    });
  });

  describe('unauthenticated user gets the real login form', () => {
    it('renders the form on /login', async () => {
      await harness.navigateByUrl('/login');
      expect(router.url).toBe('/login');
      expect(deepestComponent()).toBe(LoginComponent);
      expect(harness.routeNativeElement?.querySelector('form'))
        .withContext('the login form did not render')
        .toBeTruthy();
    });

    it('renders the form AND the inactivity notice on /login?reason=inactivity', async () => {
      const component = await harness.navigateByUrl('/login?reason=inactivity', LoginComponent);
      expect(component.inactivityNotice).toBeTrue();
      expect(harness.routeNativeElement?.querySelector('form')).toBeTruthy();
      expect(harness.routeNativeElement?.textContent)
        .withContext('the inactivity notice did not render')
        .toContain('We paused your session');
    });
  });

  describe('bare domain (the ""→login redirect feeds the guard)', () => {
    it('lands an authenticated member on their first accessible route', async () => {
      signInWithMembership(membership(['owner']));
      await harness.navigateByUrl('/');
      expect(router.url).toBe('/dashboard');
      expect(location.urlChanges.filter((change) => change.includes('login'))).toEqual([]);
    });

    it('lands an unauthenticated visitor on /login', async () => {
      await harness.navigateByUrl('/');
      expect(router.url).toBe('/login');
      expect(deepestComponent()).toBe(LoginComponent);
    });
  });
});
