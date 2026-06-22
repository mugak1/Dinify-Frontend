import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { permissionGuard } from './permission.guard';
import { AuthenticationService } from '../_services/authentication.service';
import { canAccess, firstAccessibleRoute } from './module-access';
import { ModuleKey, PermissionsMap } from '../_models/app.models';

describe('permissionGuard', () => {
  // An explicit-false (Tables-only) fixture so the deny path is REAL: the false
  // flows through the actual pure helpers, not a hand-stubbed canAccess.
  const TABLES_ONLY: PermissionsMap = {
    dashboard: false, menu: false, tables: true, reviews: false, reports: false,
    settings: false, kitchen: false, billing: false, team: false,
  };

  const authStub = {
    canAccess: (k: ModuleKey) => canAccess(TABLES_ONLY, k),
    firstAccessibleRoute: () => firstAccessibleRoute(TABLES_ONLY),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthenticationService, useValue: authStub },
      ],
    });
  });

  const routeFor = (module?: ModuleKey): ActivatedRouteSnapshot =>
    ({ data: module ? { module } : {} } as unknown as ActivatedRouteSnapshot);

  const run = (route: ActivatedRouteSnapshot) =>
    TestBed.runInInjectionContext(() => permissionGuard(route, {} as RouterStateSnapshot));

  it('allows an accessible module', () => {
    expect(run(routeFor('tables'))).toBeTrue();
  });

  it('allows a route that declares no module key', () => {
    expect(run(routeFor())).toBeTrue();
  });

  it('redirects a denied module to the first accessible route as a UrlTree (never navigate to /)', () => {
    const result = run(routeFor('menu'));
    expect(result instanceof UrlTree).toBeTrue();
    // Tables-only → first accessible route is /rest-app/dining-tables, which is
    // itself accessible, so the redirect cannot loop.
    const router = TestBed.inject(Router);
    expect((result as UrlTree).toString()).toBe(router.parseUrl('/rest-app/dining-tables').toString());
    expect((result as UrlTree).toString()).toBe('/rest-app/dining-tables');
  });
});
