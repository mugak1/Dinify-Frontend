import { ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { AuthenticationService } from '../_services/authentication.service';
import { ApiService } from '../_services/api.service';
import { ConfirmDialogService } from '../_common/confirm-dialog.service';
import { LocalStorageService } from '../_services/storage/local-storage.service';
import { RestaurantMgtComponent } from './restaurant-mgt.component';

/**
 * Sidebar expand/collapse persistence:
 *   - fresh session (no stored value) opens EXPANDED,
 *   - a refresh restores the user's last toggle,
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
    const dialog = {} as unknown as ConfirmDialogService;
    const route = { pathFromRoot: [] } as unknown as ActivatedRoute;
    const router = { events: of(), url: '/dashboard' } as unknown as Router;
    const cdr = { detectChanges: () => {} } as unknown as ChangeDetectorRef;

    const component = new RestaurantMgtComponent(
      auth, api, dialog, route, router, cdr, storage,
    );
    return { component, setCalls };
  }

  it('defaults to EXPANDED on a fresh session (no stored value, desktop)', () => {
    const { component } = createComponent({ stored: null, innerWidth: 1280 });
    expect(component.sidebarOpen).toBe(true);
  });

  it('restores a persisted collapsed state on refresh (desktop)', () => {
    const { component } = createComponent({ stored: false, innerWidth: 1280 });
    expect(component.sidebarOpen).toBe(false);
  });

  it('restores a persisted expanded state on refresh (desktop)', () => {
    const { component } = createComponent({ stored: true, innerWidth: 1280 });
    expect(component.sidebarOpen).toBe(true);
  });

  it('persists the new value whenever the sidebar is toggled', () => {
    const { component, setCalls } = createComponent({ stored: null, innerWidth: 1280 });
    expect(component.sidebarOpen).toBe(true);
    // Seeding writes the backing field directly — no persistence during construction.
    expect(setCalls.length).toBe(0);

    component.sidebarOpen = false; // user collapses
    expect(component.sidebarOpen).toBe(false);
    expect(setCalls).toEqual([{ key: SIDEBAR_KEY, value: false }]);

    component.sidebarOpen = true; // user expands again
    expect(setCalls).toEqual([
      { key: SIDEBAR_KEY, value: false },
      { key: SIDEBAR_KEY, value: true },
    ]);
  });

  it('starts collapsed on mobile without overwriting the stored desktop preference', () => {
    const { component, setCalls } = createComponent({ stored: true, innerWidth: 800 });
    // Mobile drawer starts closed regardless of the stored expanded preference …
    expect(component.sidebarOpen).toBe(false);
    // … and the clamp must not persist (so the desktop preference survives).
    expect(setCalls.length).toBe(0);
  });

  it('starts collapsed on a large tablet in portrait (1024 — iPad Pro, below the xl rail boundary)', () => {
    // The overlay→rail boundary is Tailwind `xl` (1280), so a 1024-wide viewport
    // (iPad Pro 12.9" portrait) sits in the mobile-drawer regime: it seeds CLOSED
    // and must not overwrite the stored desktop preference. This locks in the
    // lg→xl boundary move — it would fail under the former `< 1024` clamp, where
    // 1024 counted as desktop and the drawer seeded OPEN.
    const { component, setCalls } = createComponent({ stored: true, innerWidth: 1024 });
    expect(component.sidebarOpen).toBe(false);
    expect(setCalls.length).toBe(0);
  });
});
