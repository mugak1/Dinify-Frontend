import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { AuthGuard } from './auth.guard';
import { AuthenticationService } from '../_services/authentication.service';
import { LoginResponse } from '../_models/app.models';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let authService: jasmine.SpyObj<AuthenticationService>;
  let router: jasmine.SpyObj<Router>;

  beforeEach(() => {
    const authSpy = jasmine.createSpyObj('AuthenticationService', [], {
      userValue: null
    });
    const routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    TestBed.configureTestingModule({
      providers: [
        AuthGuard,
        { provide: AuthenticationService, useValue: authSpy },
        { provide: Router, useValue: routerSpy }
      ]
    });

    guard = TestBed.inject(AuthGuard);
    authService = TestBed.inject(AuthenticationService) as jasmine.SpyObj<AuthenticationService>;
    router = TestBed.inject(Router) as jasmine.SpyObj<Router>;
  });

  function makeRoute(roles?: string[], restaurant_roles?: string[]): ActivatedRouteSnapshot {
    const route = new ActivatedRouteSnapshot();
    (route as any).data = {
      ...(roles ? { roles } : {}),
      ...(restaurant_roles ? { restaurant_roles } : {}),
    };
    return route;
  }

  function makeState(url: string): RouterStateSnapshot {
    return { url } as RouterStateSnapshot;
  }

  function setUser(user: Partial<LoginResponse> | null) {
    Object.defineProperty(authService, 'userValue', { get: () => user, configurable: true });
  }

  it('should redirect to login when not authenticated', () => {
    setUser(null);
    const result = guard.canActivate(makeRoute(), makeState('/dashboard'));
    expect(result).toBeFalse();
    // No returnUrl is captured: the post-login redirect always lands the user on
    // their first accessible module.
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('should allow access when authenticated and no role restriction', () => {
    setUser({
      token: 'test-token',
      profile: { id: '1', first_name: 'A', last_name: 'B', email: '', roles: [], phone_number: '', country: '', prompt_password_change: false, other_names: '', restaurant_roles: [] }
    });
    const result = guard.canActivate(makeRoute(), makeState('/'));
    expect(result).toBeTrue();
  });

  it('denies a route when the account-level roles array is the only thing that matches', () => {
    // The guard used to carry a `hasTopLevelRole` branch that admitted on
    // `profile.roles`. That is what made a platform role string in `data.roles`
    // grant route access, so it went with the platform-role vocabulary. Authority
    // comes from the MEMBERSHIP arrays now, and an account-level string alone
    // grants nothing — including for an ordinary restaurant role.
    setUser({
      token: 'test-token',
      profile: { id: '1', first_name: 'A', last_name: 'B', email: '', roles: ['restaurant_staff'], phone_number: '', country: '', prompt_password_change: false, other_names: '', restaurant_roles: [] }
    });
    const result = guard.canActivate(makeRoute(['restaurant_staff']), makeState('/dashboard'));
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });

  it('should allow restaurant_staff access when user has restaurant_roles even without top-level role', () => {
    setUser({
      token: 'test-token',
      profile: {
        id: '1', first_name: 'A', last_name: 'B', email: '',
        roles: [],  // no top-level 'restaurant_staff' role
        phone_number: '', country: '', prompt_password_change: false, other_names: '',
        restaurant_roles: [{ restaurant_id: 'r1', restaurant: 'Rest1', roles: ['manager'] }]
      }
    });
    const result = guard.canActivate(makeRoute(['restaurant_staff']), makeState('/dashboard'));
    expect(result).toBeTrue();
  });

  it('should deny access when user has no matching roles at all', () => {
    setUser({
      token: 'test-token',
      profile: { id: '1', first_name: 'A', last_name: 'B', email: '', roles: ['diner'], phone_number: '', country: '', prompt_password_change: false, other_names: '', restaurant_roles: [] }
    });
    const result = guard.canActivate(makeRoute(['restaurant_staff']), makeState('/dashboard'));
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });

  // ── Kitchen route policy (data.restaurant_roles only) ───────────────────
  // /kitchen → restaurant_roles:['owner','manager','kitchen'], and NO data.roles.
  // The platform-role entry that used to sit beside it is gone; a membership role
  // is now the only thing that admits.
  const KITCHEN_REST = ['owner', 'manager', 'kitchen'];

  function setKitchenUser(topRoles: string[], restRoles: string[]) {
    setUser({
      token: 'test-token',
      profile: {
        id: '1', first_name: 'A', last_name: 'B', email: '',
        roles: topRoles, phone_number: '', country: '', prompt_password_change: false, other_names: '',
        restaurant_roles: restRoles.length
          ? [{ restaurant_id: 'r1', restaurant: 'Rest1', roles: restRoles }]
          : [],
      },
    });
  }

  it('allows /kitchen for a restaurant kitchen role', () => {
    setKitchenUser([], ['kitchen']);
    expect(guard.canActivate(makeRoute(undefined, KITCHEN_REST), makeState('/kitchen'))).toBeTrue();
  });

  it('allows /kitchen for a restaurant owner or manager role', () => {
    setKitchenUser([], ['manager']);
    expect(guard.canActivate(makeRoute(undefined, KITCHEN_REST), makeState('/kitchen'))).toBeTrue();
    setKitchenUser([], ['owner']);
    expect(guard.canActivate(makeRoute(undefined, KITCHEN_REST), makeState('/kitchen'))).toBeTrue();
  });

  it('denies /kitchen for a user holding none of the kitchen roles', () => {
    setKitchenUser([], ['cashier']);
    const result = guard.canActivate(makeRoute(undefined, KITCHEN_REST), makeState('/kitchen'));
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });

  it('denies /kitchen for an account-level role, however privileged it looks', () => {
    // The replaced test asserted the opposite: it admitted a platform account
    // manager on the strength of profile.roles alone. That branch is gone, and the
    // route no longer carries data.roles at all — a membership is the only key.
    setKitchenUser(['owner', 'manager', 'kitchen'], []);
    const result = guard.canActivate(makeRoute(undefined, KITCHEN_REST), makeState('/kitchen'));
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });
});
