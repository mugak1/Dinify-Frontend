import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { SidebarComponent } from './sidebar.component';
import { AuthenticationService } from '../../../_services/authentication.service';
import { canAccess, firstAccessibleRoute, NO_MODULE_ROUTE } from '../../../_helpers/module-access';
import { ModuleKey, PermissionsMap } from '../../../_models/app.models';
import { ShellRegime } from '../shell-layout';

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
    expect(labels).toEqual(['Dashboard', 'Menu', 'Tables', 'Kitchen', 'Reviews', 'Reports', 'Support', 'Settings']);
  });

  it('gates the Kitchen entry on the kitchen module (shown for owner/manager/kitchen, hidden for staff)', () => {
    // kitchen:true (owner/manager/kitchen role template) → Kitchen visible.
    const withKitchen = makeSidebar({ ...ALL_FALSE, dashboard: true, tables: true, kitchen: true }).visibleNavItems.map(i => i.label);
    expect(withKitchen).toContain('Kitchen');
    // kitchen:false (restaurant_staff template) → Kitchen hidden.
    const withoutKitchen = makeSidebar({ ...ALL_FALSE, dashboard: true, tables: true, menu: true }).visibleNavItems.map(i => i.label);
    expect(withoutKitchen).not.toContain('Kitchen');
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

describe('SidebarComponent (rendered) — Kitchen opens in a new tab', () => {
  const render = async (expanded: boolean, regime: ShellRegime = 'rail-push') => {
    const auth = {
      canAccess: () => true,
      firstAccessibleRoute: () => '/dashboard',
      userValue: null,
      currentRestaurantRole: null,
    } as unknown as AuthenticationService;
    await TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [provideRouter([]), { provide: AuthenticationService, useValue: auth }],
    }).compileComponents();
    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentInstance.expanded = expanded;
    fixture.componentInstance.regime = regime;
    fixture.detectChanges();
    const links = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('nav a'),
    );
    return { fixture, links, byLabel: (l: string) => links.find(a => a.textContent!.includes(l))! };
  };


  it('gives the Kitchen link target="_blank" with rel="noopener", still pointing at /kitchen', async () => {
    const { byLabel } = await render(true);
    const kitchen = byLabel('Kitchen');
    expect(kitchen.getAttribute('target')).toBe('_blank');
    expect(kitchen.getAttribute('rel')).toBe('noopener');
    expect(kitchen.getAttribute('href')).toBe('/kitchen');
    expect(kitchen.textContent).toContain('(opens in a new tab)');
  });

  it('CONTROL: every other portal item still navigates in the same tab', async () => {
    const { links } = await render(true);
    const others = links.filter(a => !a.textContent!.includes('Kitchen'));
    expect(others.length).toBe(7);
    for (const a of others) {
      expect(a.hasAttribute('target')).withContext(a.textContent!.trim()).toBeFalse();
      expect(a.hasAttribute('rel')).withContext(a.textContent!.trim()).toBeFalse();
    }
  });

  it('shows the new-tab glyph only on the expanded rail, and keeps target when collapsed', async () => {
    const open = await render(true);
    expect(open.byLabel('Kitchen').querySelector('[data-testid="nav-new-tab-icon"]')).not.toBeNull();
    expect(open.fixture.nativeElement.querySelectorAll('[data-testid="nav-new-tab-icon"]').length).toBe(1);
    TestBed.resetTestingModule();
    const collapsed = await render(false);
    const kitchen = collapsed.byLabel('Kitchen');
    expect(kitchen.querySelector('[data-testid="nav-new-tab-icon"]')).toBeNull();
    expect(kitchen.getAttribute('target')).toBe('_blank');
  });
});

describe('SidebarComponent (rendered) — regimes, inert and the collapsed rail', () => {
  const render = async (regime: ShellRegime, expanded: boolean, url = '/dashboard') => {
    const auth = {
      canAccess: () => true,
      firstAccessibleRoute: () => '/dashboard',
      userValue: null,
      currentRestaurantRole: null,
    } as unknown as AuthenticationService;
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: AuthenticationService, useValue: auth },
      ],
    }).compileComponents();
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentInstance.regime = regime;
    fixture.componentInstance.expanded = expanded;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      panel: el.querySelector<HTMLElement>('[data-testid="sidebar-panel"]')!,
      toggle: el.querySelector<HTMLButtonElement>('[data-testid="sidebar-toggle"]'),
      el,
    };
  };

  it('a closed drawer is inert and off-screen; an open one is not', async () => {
    const closed = await render('drawer', false);
    expect(closed.panel.hasAttribute('inert')).toBeTrue();
    expect(closed.panel.classList).toContain('-translate-x-full');
    expect(closed.panel.classList).toContain('fixed');
    const open = await render('drawer', true);
    expect(open.panel.hasAttribute('inert')).toBeFalse();
    expect(open.panel.classList).not.toContain('-translate-x-full');
  });

  it('is inert ONLY in the drawer regime: never the collapsed or expanded rail', async () => {
    for (const regime of ['rail-overlay', 'rail-push'] as ShellRegime[]) {
      for (const expanded of [false, true]) {
        const { panel } = await render(regime, expanded);
        expect(panel.hasAttribute('inert')).withContext(`${regime} expanded=${expanded}`).toBeFalse();
        expect(panel.classList).withContext(regime).toContain('absolute');
        expect(panel.classList).not.toContain('-translate-x-full');
      }
    }
  });

  it('the rail toggle exists only from 1024, and controls the panel', async () => {
    expect((await render('drawer', true)).toggle).toBeNull();
    for (const regime of ['rail-overlay', 'rail-push'] as ShellRegime[]) {
      const { toggle } = await render(regime, false);
      expect(toggle).withContext(regime).not.toBeNull();
      expect(toggle!.getAttribute('aria-controls')).toBe('portal-sidebar');
      expect(toggle!.getAttribute('aria-expanded')).toBe('false');
      expect(toggle!.getBoundingClientRect().width).withContext('44px touch target').toBe(44);
    }
    const open = await render('rail-overlay', true);
    expect(open.toggle!.getAttribute('aria-expanded')).toBe('true');
  });

  it('panel width: the drawer is always 220, the rail 64 until expanded', async () => {
    expect((await render('drawer', false)).panel.style.width).toBe('220px');
    expect((await render('rail-overlay', false)).panel.style.width).toBe('64px');
    expect((await render('rail-overlay', true)).panel.style.width).toBe('220px');
    expect((await render('rail-push', false)).panel.style.width).toBe('64px');
  });

  it('keeps the "you are here" marker on the COLLAPSED rail too', async () => {
    const collapsed = await render('rail-push', false, '/menu');
    expect(collapsed.el.querySelectorAll('[data-testid="nav-active-marker"]').length).toBe(1);
    const expanded = await render('rail-push', true, '/menu');
    expect(expanded.el.querySelectorAll('[data-testid="nav-active-marker"]').length).toBe(1);
  });

  it('focusToggle() moves focus to the rail toggle', async () => {
    const { fixture, toggle } = await render('rail-overlay', true);
    document.body.appendChild(fixture.nativeElement);
    fixture.componentInstance.focusToggle();
    expect(document.activeElement).toBe(toggle);
    fixture.nativeElement.remove();
  });
});
