import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { AuthenticationService } from '../_services/authentication.service';
import { ApiService } from '../_services/api.service';
import { LocalStorageService } from '../_services/storage/local-storage.service';
import { RestaurantMgtComponent } from './restaurant-mgt.component';
import { regimeForWidth } from './layout/shell-layout';

/**
 * Sidebar expand/collapse persistence:
 *   - fresh session (no stored value) opens EXPANDED (1280+),
 *   - a refresh restores the user's last toggle,
 *   - only the rail toggle in the push regime writes it,
 *   - login resets to expanded via the existing nav-state clear
 *     (AuthenticationService.clearPersistedNavState removes the [dinify] key —
 *     locked by authentication.service.spec.ts), so this suite covers the
 *     component's hydrate/persist half.
 *
 * Direct construction with stubs, matching the module's spec style
 * (see tables.component.spec.ts). The heavy real template (sidebar / top-nav)
 * is irrelevant here — all the persistence logic lives in the constructor seed
 * and the sidebarOpen accessor.
 */
describe('RestaurantMgtComponent — sidebar state persistence', () => {
  // Raw key the component hands to LocalStorageService; the `[dinify]` prefix and
  // `{value:T}` wrapping are added by StorageService, which the stub stands in for.
  const SIDEBAR_KEY = 'sidebar.expanded';

  let originalInnerWidth: number;

  beforeEach(() => {
    originalInnerWidth = window.innerWidth;
  });

  afterEach(() => {
    setViewport(originalInnerWidth);
  });

  function setViewport(width: number): void {
    Object.defineProperty(window, 'innerWidth', {
      value: width,
      configurable: true,
      writable: true,
    });
  }

  // In-memory LocalStorageService stand-in. getItem returns the already-unwrapped
  // value (or null); setItem records every write so we can assert persistence.
  function makeStorage(initial: Record<string, unknown> = {}) {
    const store = new Map<string, unknown>(Object.entries(initial));
    const setCalls: Array<{ key: string; value: unknown }> = [];
    const storage = {
      getItem: (key: string) => (store.has(key) ? store.get(key) : null),
      setItem: (key: string, value: unknown) => {
        store.set(key, value);
        setCalls.push({ key, value });
      },
    } as unknown as LocalStorageService;
    return { storage, setCalls };
  }

  function createComponent(opts: { stored?: boolean | null; innerWidth?: number } = {}) {
    const { stored = null, innerWidth = 1280 } = opts;
    setViewport(innerWidth);

    const { storage, setCalls } = makeStorage(
      stored === null ? {} : { [SIDEBAR_KEY]: stored },
    );

    const auth = { currentRestaurantRole: null } as unknown as AuthenticationService;
    const api = { get: () => of({ data: {} }) } as unknown as ApiService;
    const route = { pathFromRoot: [] } as unknown as ActivatedRoute;
    const router = { events: of(), url: '/dashboard' } as unknown as Router;
    const cdr = { detectChanges: () => {} } as unknown as ChangeDetectorRef;

    const component = TestBed.runInInjectionContext(() => new RestaurantMgtComponent(
      auth, api, route, router, cdr, storage,
    ));
    return { component, setCalls };
  }

  it('defaults to EXPANDED on a fresh session (no stored value, desktop)', () => {
    const { component } = createComponent({ stored: null, innerWidth: 1280 });
    expect(component.regime).toBe('rail-push');
    expect(component.sidebarExpanded).toBe(true);
  });

  it('restores a persisted collapsed state on refresh (desktop)', () => {
    const { component } = createComponent({ stored: false, innerWidth: 1280 });
    expect(component.sidebarExpanded).toBe(false);
    expect(component.inFlowWidth).toBe(64);
  });

  it('restores a persisted expanded state on refresh (desktop)', () => {
    const { component } = createComponent({ stored: true, innerWidth: 1280 });
    expect(component.sidebarExpanded).toBe(true);
    expect(component.inFlowWidth).toBe(220);
  });

  it('persists the preference whenever the rail toggle is used in the push regime', () => {
    const { component, setCalls } = createComponent({ stored: null, innerWidth: 1280 });
    // Seeding reads only — no persistence during construction.
    expect(setCalls.length).toBe(0);

    component.onRailToggle(); // user collapses
    expect(component.sidebarExpanded).toBe(false);
    expect(setCalls).toEqual([{ key: SIDEBAR_KEY, value: false }]);

    component.onRailToggle(); // user expands again
    expect(setCalls).toEqual([
      { key: SIDEBAR_KEY, value: false },
      { key: SIDEBAR_KEY, value: true },
    ]);
  });

  it('starts with the drawer closed on mobile without overwriting the stored desktop preference', () => {
    const { component, setCalls } = createComponent({ stored: true, innerWidth: 800 });
    expect(component.regime).toBe('drawer');
    expect(component.sidebarExpanded).toBe(false);
    expect(component.inFlowWidth).toBe(0);
    expect(setCalls.length).toBe(0);
  });

  // Replaces "starts collapsed on a large tablet in portrait (1024 …)". Its intent — the
  // iPad Pro in portrait must never get the 220px rail pushing the content, and must not
  // overwrite the desktop preference — is kept; what changed is that 1024 now gets the
  // 64px rail in flow (audit item 8), with an overlay expansion instead of a push.
  it('gives a 1024 viewport (iPad Pro portrait) the 64px rail in flow, never the pushing 220px one', () => {
    const { component, setCalls } = createComponent({ stored: true, innerWidth: 1024 });
    expect(component.regime).toBe('rail-overlay');
    expect(component.inFlowWidth).toBe(64);
    expect(component.sidebarExpanded).toBe(false);
    component.onRailToggle();
    expect(component.sidebarExpanded).toBe(true);
    expect(component.inFlowWidth).withContext('the expansion overlays; content does not move').toBe(64);
    expect(setCalls.length).toBe(0);
  });
});

describe('RestaurantMgtComponent — regimes, drawer state and the saved preference', () => {
  const SIDEBAR_KEY = 'sidebar.expanded';
  let originalInnerWidth: number;

  beforeEach(() => { originalInnerWidth = window.innerWidth; });
  afterEach(() => {
    setViewport(originalInnerWidth);
    document.body.classList.remove('dn-drawer-open');
  });

  function setViewport(width: number): void {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
  }

  function create(innerWidth: number, stored: boolean | null = null) {
    setViewport(innerWidth);
    const store = new Map<string, unknown>(stored === null ? [] : [[SIDEBAR_KEY, stored]]);
    const setCalls: Array<{ key: string; value: unknown }> = [];
    const storage = {
      getItem: (k: string) => (store.has(k) ? store.get(k) : null),
      setItem: (k: string, v: unknown) => { store.set(k, v); setCalls.push({ key: k, value: v }); },
    } as unknown as LocalStorageService;
    const component = TestBed.runInInjectionContext(() => new RestaurantMgtComponent(
      { currentRestaurantRole: null } as unknown as AuthenticationService,
      { get: () => of({ data: {} }) } as unknown as ApiService,
      { pathFromRoot: [] } as unknown as ActivatedRoute,
      { events: of(), url: '/dashboard' } as unknown as Router,
      { detectChanges: () => {} } as unknown as ChangeDetectorRef,
      storage,
    ));
    return { component, setCalls };
  }

  const locked = () => document.body.classList.contains('dn-drawer-open');

  it('maps each width to its regime from the one source', () => {
    const cases: Array<[number, string]> = [
      [390, 'drawer'], [900, 'drawer'], [1023, 'drawer'],
      [1024, 'rail-overlay'], [1194, 'rail-overlay'], [1279, 'rail-overlay'],
      [1280, 'rail-push'], [1366, 'rail-push'], [1440, 'rail-push'],
    ];
    for (const [w, regime] of cases) {
      expect(regimeForWidth(w)).withContext(`${w}px`).toBe(regime as any);
      expect(create(w).component.regime).withContext(`${w}px`).toBe(regime as any);
    }
  });

  it('closing the drawer below 1280 never writes the desktop preference', () => {
    for (const w of [390, 900, 1023]) {
      const { component, setCalls } = create(w, true);
      component.onMenuButton();
      expect(component.drawerOpen).toBeTrue();
      expect(locked()).withContext(`${w}: drawer locks background scroll`).toBeTrue();
      component.onMenuButton();
      component.onMenuButton();
      component.closeOverlays();
      expect(setCalls).withContext(`${w}px`).toEqual([]);
      expect(component.railExpanded).toBeTrue();
      expect(locked()).toBeFalse();
    }
  });

  it('opening and closing the 1024–1279 overlay never writes the desktop preference', () => {
    for (const w of [1024, 1194, 1279]) {
      const { component, setCalls } = create(w, false);
      component.onRailToggle();
      expect(component.railOverlayOpen).toBeTrue();
      expect(component.overlayOpen).toBeTrue();
      expect(locked()).withContext(`${w}: overlay locks background scroll`).toBeTrue();
      component.onRailToggle();
      component.onRailToggle();
      component.onEscapeKey();
      expect(component.railOverlayOpen).toBeFalse();
      expect(setCalls).withContext(`${w}px`).toEqual([]);
      expect(component.railExpanded).toBeFalse();
    }
  });

  it('the expanded rail at 1280+ pushes and does not lock background scroll', () => {
    const { component } = create(1366, false);
    component.onRailToggle();
    expect(component.sidebarExpanded).toBeTrue();
    expect(component.inFlowWidth).toBe(220);
    expect(component.overlayOpen).toBeFalse();
    expect(locked()).toBeFalse();
  });

  it('the menu button does nothing outside the drawer regime', () => {
    const { component } = create(1194);
    component.onMenuButton();
    expect(component.drawerOpen).toBeFalse();
    expect(component.overlayOpen).toBeFalse();
  });

  it('resizing across 1024 and 1280 lands in the right state', () => {
    const { component, setCalls } = create(900, false);
    component.onMenuButton(); // drawer open on a phone-width window

    setViewport(1100); component.onResize();
    expect(component.regime).toBe('rail-overlay');
    expect(component.drawerOpen).withContext('crossing closes the drawer').toBeFalse();
    expect(component.inFlowWidth).toBe(64);
    expect(locked()).toBeFalse();

    component.onRailToggle(); // overlay open
    setViewport(1300); component.onResize();
    expect(component.regime).toBe('rail-push');
    expect(component.railOverlayOpen).withContext('crossing closes the overlay').toBeFalse();
    expect(component.sidebarExpanded).withContext('the saved preference (collapsed) applies').toBeFalse();
    expect(component.inFlowWidth).toBe(64);

    component.onRailToggle(); // expand on desktop → persisted
    setViewport(1279); component.onResize();
    expect(component.regime).toBe('rail-overlay');
    expect(component.sidebarExpanded).withContext('1024–1279 never starts expanded').toBeFalse();
    expect(component.inFlowWidth).toBe(64);

    setViewport(1023); component.onResize();
    expect(component.regime).toBe('drawer');
    expect(component.inFlowWidth).toBe(0);
    expect(component.sidebarExpanded).toBeFalse();

    setViewport(1440); component.onResize();
    expect(component.sidebarExpanded).withContext('the preference saved at 1300 survives').toBeTrue();
    expect(setCalls).toEqual([{ key: SIDEBAR_KEY, value: true }]);
  });

  it('a resize inside one regime changes nothing', () => {
    const { component } = create(1100);
    component.onRailToggle();
    setViewport(1200); component.onResize();
    expect(component.railOverlayOpen).toBeTrue();
  });

  it('Esc closes the drawer and returns focus to the menu button', () => {
    const { component } = create(800);
    const focusMenuButton = jasmine.createSpy('focusMenuButton');
    const focusToggle = jasmine.createSpy('focusToggle');
    (component as any).topNav = { focusMenuButton };
    (component as any).sidebar = { focusToggle };
    component.onMenuButton();
    component.onEscapeKey();
    expect(component.drawerOpen).toBeFalse();
    expect(focusMenuButton).toHaveBeenCalled();
    expect(focusToggle).not.toHaveBeenCalled();
  });

  it('Esc closes the 1024–1279 overlay and returns focus to the rail toggle', () => {
    const { component } = create(1100);
    const focusToggle = jasmine.createSpy('focusToggle');
    (component as any).sidebar = { focusToggle };
    component.onRailToggle();
    component.onEscapeKey();
    expect(component.railOverlayOpen).toBeFalse();
    expect(focusToggle).toHaveBeenCalled();
  });

  it('Esc with nothing open (including the expanded 1280+ rail) does nothing', () => {
    const { component } = create(1366, true);
    const focusToggle = jasmine.createSpy('focusToggle');
    (component as any).sidebar = { focusToggle };
    component.onEscapeKey();
    expect(component.sidebarExpanded).toBeTrue();
    expect(focusToggle).not.toHaveBeenCalled();
  });
});
