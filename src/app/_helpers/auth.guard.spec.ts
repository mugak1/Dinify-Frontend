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
    const result = guard.canActivate(makeRoute(), makeState('/rest-app'));
    expect(result).toBeFalse();
    // No returnUrl is captured: the post-login redirect always lands the user on
    // their first accessible module.
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('should allow access when authenticated and no role restriction', () => {
    setUser({
      token: 'test-token',
      profile: { id: '1', first_name: 'A', last_name: 'B', email: '', roles: [], phone_number: '', other_names: '', restaurant_roles: [] }
    });
    const result = guard.canActivate(makeRoute(), makeState('/'));
    expect(result).toBeTrue();
  });

  it('should allow access when user has matching top-level role', () => {
    setUser({
      token: 'test-token',
      profile: { id: '1', first_name: 'A', last_name: 'B', email: '', roles: ['dinify_admin'], phone_number: '', other_names: '', restaurant_roles: [] }
    });
    const result = guard.canActivate(makeRoute(['dinify_admin']), makeState('/mgt-app'));
    expect(result).toBeTrue();
  });

  it('should allow restaurant_staff access when user has restaurant_roles even without top-level role', () => {
    setUser({
      token: 'test-token',
      profile: {
        id: '1', first_name: 'A', last_name: 'B', email: '',
        roles: [],  // no top-level 'restaurant_staff' role
        phone_number: '', other_names: '',
        restaurant_roles: [{ restaurant_id: 'r1', restaurant: 'Rest1', roles: ['manager'] }]
      }
    });
    const result = guard.canActivate(makeRoute(['restaurant_staff']), makeState('/rest-app'));
    expect(result).toBeTrue();
  });

  it('should deny access when user has no matching roles at all', () => {
    setUser({
      token: 'test-token',
      profile: { id: '1', first_name: 'A', last_name: 'B', email: '', roles: ['diner'], phone_number: '', other_names: '', restaurant_roles: [] }
    });
    const result = guard.canActivate(makeRoute(['dinify_admin']), makeState('/mgt-app'));
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });

  // ── Kitchen route policy (additive data.restaurant_roles) ───────────────
  // /kitchen → roles:['dinify_admin','dinify_account_manager'],
  //            restaurant_roles:['owner','manager','kitchen']
  const KITCHEN_TOP = ['dinify_admin', 'dinify_account_manager'];
  const KITCHEN_REST = ['owner', 'manager', 'kitchen'];

  function setKitchenUser(topRoles: string[], restRoles: string[]) {
    setUser({
      token: 'test-token',
      profile: {
        id: '1', first_name: 'A', last_name: 'B', email: '',
        roles: topRoles, phone_number: '', other_names: '',
        restaurant_roles: restRoles.length
          ? [{ restaurant_id: 'r1', restaurant: 'Rest1', roles: restRoles }]
          : [],
      },
    });
  }

  it('allows /kitchen for a restaurant kitchen role', () => {
    setKitchenUser([], ['kitchen']);
    expect(guard.canActivate(makeRoute(KITCHEN_TOP, KITCHEN_REST), makeState('/kitchen'))).toBeTrue();
  });

  it('allows /kitchen for a restaurant owner or manager role', () => {
    setKitchenUser([], ['manager']);
    expect(guard.canActivate(makeRoute(KITCHEN_TOP, KITCHEN_REST), makeState('/kitchen'))).toBeTrue();
    setKitchenUser([], ['owner']);
    expect(guard.canActivate(makeRoute(KITCHEN_TOP, KITCHEN_REST), makeState('/kitchen'))).toBeTrue();
  });

  it('allows /kitchen for a platform dinify_account_manager', () => {
    setKitchenUser(['dinify_account_manager'], []);
    expect(guard.canActivate(makeRoute(KITCHEN_TOP, KITCHEN_REST), makeState('/kitchen'))).toBeTrue();
  });

  it('denies /kitchen for a user holding none of the kitchen roles', () => {
    setKitchenUser([], ['cashier']);
    const result = guard.canActivate(makeRoute(KITCHEN_TOP, KITCHEN_REST), makeState('/kitchen'));
    expect(result).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });
});
