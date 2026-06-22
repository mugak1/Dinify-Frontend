import { SidebarComponent } from './sidebar.component';
import { AuthenticationService } from '../../../_services/authentication.service';
import { canAccess, firstAccessibleRoute, NO_MODULE_ROUTE } from '../../../_helpers/module-access';
import { ModuleKey, PermissionsMap } from '../../../_models/app.models';

describe('SidebarComponent', () => {
  // Back the sidebar with an auth stub whose RBAC answers come from the real
  // pure helpers over a fixture map, so the nav filtering is exercised for real.
  const makeSidebar = (map: PermissionsMap | undefined, roles: string[] = []) => {
    const auth = {
      canAccess: (k: ModuleKey) => canAccess(map, k),
      firstAccessibleRoute: () => firstAccessibleRoute(map, roles),
    } as unknown as AuthenticationService;
    return new SidebarComponent(auth);
  };

  const ALL_FALSE: PermissionsMap = {
    dashboard: false, menu: false, tables: false, reviews: false, reports: false,
    settings: false, kitchen: false, billing: false, team: false,
  };

  it('shows every module item when the map is absent (fail-open)', () => {
    const labels = makeSidebar(undefined).visibleNavItems.map(i => i.label);
    expect(labels).toEqual(['Dashboard', 'Menu', 'Tables', 'Reviews', 'Reports', 'Support', 'Settings']);
  });

  it('filters nav to the granted modules but always keeps the module-less Support item', () => {
    const map: PermissionsMap = { ...ALL_FALSE, menu: true, reviews: true };
    const labels = makeSidebar(map).visibleNavItems.map(i => i.label);
    expect(labels).toEqual(['Menu', 'Reviews', 'Support']);
  });

  it('leaves only Support visible for a no-module map', () => {
    const labels = makeSidebar(ALL_FALSE).visibleNavItems.map(i => i.label);
    expect(labels).toEqual(['Support']);
  });

  it('noModuleUser is true exactly when the landing is the account fallback', () => {
    expect(makeSidebar(ALL_FALSE).noModuleUser).toBeTrue();                        // all-false → /account
    expect(makeSidebar({ ...ALL_FALSE, tables: true }).noModuleUser).toBeFalse();  // has a module
    expect(makeSidebar(undefined).noModuleUser).toBeFalse();                       // absent → dashboard fallback
  });

  it('derives noModuleUser from the SAME predicate as the landing (note ⇔ landing)', () => {
    const sidebar = makeSidebar(ALL_FALSE);
    expect(sidebar.noModuleUser).toBe(sidebar.auth.firstAccessibleRoute() === NO_MODULE_ROUTE);
  });
});
