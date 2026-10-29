import { ChangeDetectorRef } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { AuthenticationService } from '../_services/authentication.service';
import { ApiService } from '../_services/api.service';
import { LocalStorageService } from '../_services/storage/local-storage.service';
import { KitchenComponent } from '../kitchen/kitchen.component';
import { routes } from '../app-routing.module';
import { CROSS_TAB_NOTICE_MS, RestaurantMgtComponent } from './restaurant-mgt.component';

/**
 * SHELL-FINISH-00, PR 3 — the shell's cross-tab guard.
 *
 * Keyed on the PAIR (restaurant id, profile id), as the kitchen board's
 * `currentScope()` is. Staff requests stop SYNCHRONOUSLY, before the notice
 * appears; then a REPLACE reload through the shared landing rule.
 */
describe('RestaurantMgtComponent — cross-tab guard', () => {
  const all = { dashboard: true, menu: true, tables: true, reviews: true, reports: true, settings: true, kitchen: true };
  const memberA = { restaurant_id: 'rest-a', restaurant: 'Baba House', roles: ['owner'], permissions: all };
  const memberB = { restaurant_id: 'rest-b', restaurant: 'Cafe Javas', roles: ['manager'], permissions: { ...all, menu: false } };
  const user = (profileId: string, token = 't') => JSON.stringify({ token, refresh: 'r', profile: { id: profileId, restaurant_roles: [] } });

  let auth: { retire: jasmine.Spy; retireAndReload: jasmine.Spy; setCurrentRestaurant: () => void; currentRestaurantRole: any };
  let order: string[];
  let shell: RestaurantMgtComponent;

  function storageEvent(key: string | null, area: Storage = localStorage): StorageEvent {
    return new StorageEvent('storage', { key, storageArea: area });
  }

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('rest_role', JSON.stringify(memberA));
    localStorage.setItem('user', user('user-1'));
    order = [];
    auth = {
      retire: jasmine.createSpy('retire').and.callFake(() => order.push('retire')),
      retireAndReload: jasmine.createSpy('retireAndReload').and.returnValue(Promise.resolve()),
      setCurrentRestaurant: () => {},
      get currentRestaurantRole() {
        try { return JSON.parse(localStorage.getItem('rest_role') ?? 'null'); } catch { return null; }
      },
    } as any;
    const storage = { getItem: () => null, setItem: () => {} } as unknown as LocalStorageService;
    const api = { get: () => of({ data: {} }) } as unknown as ApiService;
    const route = { pathFromRoot: [] } as unknown as ActivatedRoute;
    const router = { events: of(), url: '/menu/sections?s=9' } as unknown as Router;
    const cdr = { detectChanges: () => order.push('render') } as unknown as ChangeDetectorRef;
    shell = TestBed.runInInjectionContext(() => new RestaurantMgtComponent(
      auth as unknown as AuthenticationService, api, route, router, cdr, storage,
    ));
  });

  afterEach(() => {
    shell.ngOnDestroy();
    localStorage.clear();
  });

  it('a token renewal in another tab (same pair) is ignored', fakeAsync(() => {
    localStorage.setItem('user', user('user-1', 'renewed'));
    shell.onStorage(storageEvent('user'));
    tick(CROSS_TAB_NOTICE_MS * 2);
    expect(auth.retire).not.toHaveBeenCalled();
    expect(auth.retireAndReload).not.toHaveBeenCalled();
    expect(shell.leavingFor).toBeNull();
  }));

  it('an unrelated key, or sessionStorage, is ignored', fakeAsync(() => {
    localStorage.setItem('rest_role', JSON.stringify(memberB));
    shell.onStorage(storageEvent('[dinify]sidebar.expanded'));
    shell.onStorage(storageEvent('rest_role', sessionStorage));
    tick(CROSS_TAB_NOTICE_MS * 2);
    expect(auth.retire).not.toHaveBeenCalled();
  }));

  it('a venue switch in another tab: retire FIRST, then the notice, then a REPLACE reload by the shared rule', fakeAsync(() => {
    localStorage.setItem('rest_role', JSON.stringify(memberB));
    shell.onStorage(storageEvent('rest_role'));

    expect(order.slice(0, 2)).withContext('requests stop before anything renders').toEqual(['retire', 'render']);
    expect(shell.leavingFor).toEqual({ kind: 'switched', restaurant: 'Cafe Javas' });
    expect(auth.retireAndReload).not.toHaveBeenCalled();

    tick(CROSS_TAB_NOTICE_MS);
    // memberB cannot open Menu: the shared landing rule, never a reload of this URL.
    expect(auth.retireAndReload).toHaveBeenCalledOnceWith('/dashboard');
  }));

  it('the same top-level page is kept when the new restaurant allows it (query dropped)', fakeAsync(() => {
    localStorage.setItem('rest_role', JSON.stringify({ ...memberB, restaurant_id: 'rest-c', permissions: all }));
    shell.onStorage(storageEvent('rest_role'));
    tick(CROSS_TAB_NOTICE_MS);
    expect(auth.retireAndReload).toHaveBeenCalledOnceWith('/menu');
  }));

  it('a different user signing in elsewhere (same restaurant) is a change of pair', fakeAsync(() => {
    localStorage.setItem('user', user('user-2'));
    shell.onStorage(storageEvent('user'));
    expect(shell.leavingFor?.kind).toBe('other-user');
    tick(CROSS_TAB_NOTICE_MS);
    expect(auth.retireAndReload).toHaveBeenCalledTimes(1);
  }));

  it('a sign-out elsewhere (storage cleared) reloads to /login', fakeAsync(() => {
    localStorage.clear();
    shell.onStorage(storageEvent(null));
    expect(shell.leavingFor?.kind).toBe('signed-out');
    tick(CROSS_TAB_NOTICE_MS);
    expect(auth.retireAndReload).toHaveBeenCalledOnceWith('/login');
  }));

  it('acts once, however many events follow', fakeAsync(() => {
    localStorage.setItem('rest_role', JSON.stringify(memberB));
    shell.onStorage(storageEvent('rest_role'));
    localStorage.setItem('user', user('user-2'));
    shell.onStorage(storageEvent('user'));
    tick(CROSS_TAB_NOTICE_MS * 2);
    expect(auth.retire).toHaveBeenCalledTimes(1);
    expect(auth.retireAndReload).toHaveBeenCalledTimes(1);
  }));

  it('the kitchen board is not inside the shell, so the guard never reloads it', () => {
    const kitchen = routes.find(r => r.path === 'kitchen');
    expect(kitchen?.component).toBe(KitchenComponent);
    const shellRoute = routes.find(r => r.component === RestaurantMgtComponent);
    expect(shellRoute?.path).toBe('');
    // Declared BESIDE the shell, never under it.
    expect(routes.indexOf(kitchen!)).toBeLessThan(routes.indexOf(shellRoute!));
    expect(shellRoute?.children ?? []).not.toContain(jasmine.objectContaining({ path: 'kitchen' }));
  });
});
