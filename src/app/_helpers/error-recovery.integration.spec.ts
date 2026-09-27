/**
 * D09 — BOUNDED SESSION RENEWAL AND OWNED REQUEST RECOVERY, END TO END.
 *
 * Everything here runs the REAL chain exactly as `app.module.ts` registers it —
 * `AuthInterceptor` → `DinerSessionInterceptor` → `ErrorInterceptor`, class
 * based, `withXhr()` + `withInterceptorsFromDi()` — over the REAL
 * `AuthenticationService`, whose raw refresh and logout clients land on the same
 * `HttpTestingController`. Where a consumer matters, the consumer is real too:
 * `KitchenOrderService`, and the basket component with its checkout coordinator.
 *
 * The stubbed `error.interceptor.spec.ts` cannot see any of this: every defect
 * below lives in the INTERACTION between the interceptor and the service (a
 * waiter nobody settles, a leader whose cancellation latches the service, a
 * late answer writing into a successor session).
 *
 * SERVER RESPONSES ARE SYNTHETIC. They mirror the pinned backend contract
 * (SimpleJWT `{detail, code}` 401s, the refresh endpoint's `{access, refresh}`
 * rotation) but none of this is a live API execution. Ordering is controlled by
 * explicit flush barriers and time by `fakeAsync`.
 *
 * THIS FILE DELIBERATELY IMPORTS NOTHING THE D09 CHANGE ADDED, and spells the
 * user-facing sentences as literals, so the very same file compiles against the
 * reviewed baseline (`0ea7e9b`). That is how the failed-before evidence was
 * produced: every spec marked `REGRESSION` fails there; every `CONTROL` passes
 * both before and after. A spec marked `NEW DESIGN` discriminates a property
 * the baseline could not express at all.
 */
import { ComponentFixture, TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import {
  HTTP_INTERCEPTORS, HttpClient, HttpErrorResponse,
  provideHttpClient, withInterceptorsFromDi, withXhr,
} from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { Subscription } from 'rxjs';
import { timeout } from 'rxjs/operators';

import { environment } from 'src/environments/environment';
import { AuthInterceptor } from './auth.interceptor';
import { DinerSessionInterceptor } from './diner-session.interceptor';
import { ErrorInterceptor } from './error.interceptor';
import { AuthenticationService } from '../_services/authentication.service';
import { ConnectivityService } from '../_services/connectivity.service';
import { DinerSessionService } from '../_services/diner-session.service';
import { WINDOW } from '../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../_services/storage/storage-key-prefix.token';
import { ToastService } from '../_shared/ui/toast/toast.service';
import { ConfirmDialogService } from '../_common/confirm-dialog.service';
import { KitchenOrderService } from '../kitchen/services/kitchen-order.service';
import { BasketService } from '../_services/basket.service';
import { CheckoutCoordinatorService } from '../_services/checkout-coordinator.service';
import { BasketItem } from '../_models/app.models';
import { BasketBodyComponent } from '../diner-app/basket/basket-body/basket-body.component';

const ROOT = `${environment.apiUrl}/api`;
const API = `${ROOT}/${environment.version}`;
const REFRESH = `${API}/users/auth/token/refresh/`;
const LOGOUT = `${API}/users/auth/logout/`;

// The literal sentences (see the header for why these are not imported).
const EXPIRED = 'Session expired';
const CHANGED = 'Your sign-in or restaurant changed while this was in progress. Please try again.';
const UNCONFIRMED = "We couldn't confirm your sign-in just now. Please try again.";
const WAIT_MS = 10_000;          // REFRESH_WAIT_MS
const CAP_MS = 60_000;           // REFRESH_TRANSPORT_CAP_MS

const PROFILE = (id = 'u1') => ({
  id, first_name: 'A', last_name: 'B', email: '', roles: [], phone_number: '',
  country: '', prompt_password_change: false, other_names: '',
  restaurant_roles: [{ restaurant_id: 'r1', restaurant: 'R', roles: ['owner'] }],
});
const user = (token: string, refresh: string | null, id = 'u1') => ({
  token, refresh, profile: PROFILE(id), require_otp: false, prompt_password_change: false,
});

const EXPIRED_401 = {
  detail: 'Given token not valid for any token type', code: 'token_not_valid',
  messages: [{ token_class: 'AccessToken', token_type: 'access', message: 'Token is expired' }],
};
const PERMISSION_401 = {
  status: 401, message: 'You do not have the necessary permissions to perform this action.',
};

type Outcome = { settled: boolean; value?: any; error?: any; sub: Subscription };

describe('D09 — error recovery through the real interceptor chain', () => {
  let http: HttpClient;
  let mock: HttpTestingController;
  let auth: AuthenticationService;
  let toast: ToastService;
  let redirect: jasmine.Spy;
  let logout: jasmine.Spy;

  function boot(
    seed: any,
    restaurantId: string | null = 'r1',
    extra: { providers?: any[]; imports?: any[] } = {},
  ): void {
    localStorage.clear();
    sessionStorage.clear();
    if (seed) localStorage.setItem('user', JSON.stringify(seed));
    if (restaurantId) {
      localStorage.setItem('rest_role', JSON.stringify({ restaurant_id: restaurantId, restaurant: 'R', roles: ['owner'] }));
    }
    TestBed.configureTestingModule({
      providers: [
        { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
        { provide: HTTP_INTERCEPTORS, useClass: DinerSessionInterceptor, multi: true },
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
        { provide: ConnectivityService, useValue: { isOffline: () => false } },
        ...(extra.providers ?? []),
      ],
      imports: extra.imports ?? [],
      schemas: extra.imports ? [NO_ERRORS_SCHEMA] : [],
    });
    http = TestBed.inject(HttpClient);
    mock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthenticationService);
    toast = TestBed.inject(ToastService);
    spyOn(toast, 'error').and.callThrough();
    spyOn(toast, 'warning').and.callThrough();
    redirect = spyOn(auth as any, 'hardRedirect');
    logout = spyOn(auth, 'logout').and.callThrough();
  }

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  function watch(obs: any): Outcome {
    const o = { settled: false } as Outcome;
    o.sub = obs.subscribe({
      next: (v: any) => { o.settled = true; o.value = v; },
      error: (e: any) => { o.settled = true; o.error = e; },
    });
    return o;
  }
  const fail401 = (req: TestRequest, body: any = EXPIRED_401) =>
    req.flush(body, { status: 401, statusText: 'Unauthorized' });
  const expire = (url: string) => fail401(mock.expectOne(url));
  const stored = () => JSON.parse(localStorage.getItem('user') ?? 'null');
  /** Answer every open revoke, and report how many there were. */
  const revokes = () => {
    const all = mock.match(LOGOUT);
    all.forEach((r) => r.flush({ status: 200, message: 'Logout successful.' }));
    return all.length;
  };

  // ───────────────────────────────────────────────────────────────────────
  // 1. One bounded refresh, and EVERY subscriber settles
  // ───────────────────────────────────────────────────────────────────────

  describe('one refresh, every subscriber settles', () => {
    it('CONTROL: three concurrent coded 401s share ONE raw refresh (no Authorization) and all three replay', () => {
      boot(user('a1', 'r1'));
      const w = [1, 2, 3].map((i) => watch(http.get(`${API}/x/${i}`)));
      [1, 2, 3].forEach((i) => expire(`${API}/x/${i}`));
      const refresh = mock.expectOne(REFRESH);
      expect(refresh.request.headers.has('Authorization')).toBeFalse();
      refresh.flush({ access: 'a2', refresh: 'r2' });
      [1, 2, 3].forEach((i) => {
        const replay = mock.expectOne(`${API}/x/${i}`);
        expect(replay.request.headers.get('Authorization')).toBe('Bearer a2');
        replay.flush({ ok: i });
      });
      expect(w.map((x) => x.value?.ok)).toEqual([1, 2, 3]);
      expect(stored().refresh).toBe('r2');
      expect(logout).not.toHaveBeenCalled();
    });

    it('REGRESSION: a REJECTED refresh settles every leader and waiter, with one revoke and one redirect', () => {
      boot(user('a1', 'r1'));
      const w = [1, 2, 3].map((i) => watch(http.get(`${API}/x/${i}`)));
      [1, 2, 3].forEach((i) => expire(`${API}/x/${i}`));
      mock.expectOne(REFRESH).flush({ detail: 'Token is blacklisted', code: 'token_not_valid' }, { status: 401, statusText: 'Unauthorized' });
      expect(w.map((x) => x.error)).toEqual([EXPIRED, EXPIRED, EXPIRED]);
      expect(revokes()).toBe(1);
      expect(redirect.calls.allArgs()).toEqual([['/login']]);
    });

    const unavailable: Array<[string, (r: TestRequest) => void, string]> = [
      ['no HTTP answer (status 0)', (r) => r.error(new ProgressEvent('error'), { status: 0, statusText: '' }), 'no network'],
      ['a 503', (r) => r.flush('upstream down', { status: 503, statusText: 'Service Unavailable' }), UNCONFIRMED],
      ['a 200 without an access token', (r) => r.flush({}), UNCONFIRMED],
      ['a partial 200 (access, no rotated refresh)', (r) => r.flush({ access: 'a2' }), UNCONFIRMED],
      ['a 200 with blank tokens', (r) => r.flush({ access: '', refresh: '' }), UNCONFIRMED],
      ['a 400 for a missing field', (r) => r.flush({ refresh: ['This field is required.'] }, { status: 400, statusText: 'Bad Request' }), UNCONFIRMED],
      ['an unexpected 403', (r) => r.flush({ detail: 'nope' }, { status: 403, statusText: 'Forbidden' }), UNCONFIRMED],
      ['an unexpected 429', (r) => r.flush({ detail: 'slow' }, { status: 429, statusText: 'Too Many Requests' }), UNCONFIRMED],
      ['an HTML body', (r) => r.flush('<html>502</html>', { status: 401, statusText: 'Unauthorized' }), UNCONFIRMED],
    ];
    for (const [name, answer, expected] of unavailable) {
      it(`REGRESSION: ${name} from the refresh endpoint is UNAVAILABLE, not rejected — every waiter settles, nobody is logged out`, () => {
        boot(user('a1', 'r1'));
        const w = [1, 2, 3].map((i) => watch(http.get(`${API}/x/${i}`)));
        [1, 2, 3].forEach((i) => expire(`${API}/x/${i}`));
        answer(mock.expectOne(REFRESH));
        expect(w.map((x) => x.error)).toEqual([expected, expected, expected]);
        expect(logout).not.toHaveBeenCalled();
        expect(mock.match(LOGOUT).length).toBe(0);
        // The session and its evidence are kept, untouched.
        expect(stored().token).toBe('a1');
        expect(stored().refresh).toBe('r1');
        expect(auth.userValue?.token).toBe('a1');
      });
    }

    it('REGRESSION: a later request may retry renewal after an unavailable flight completed', () => {
      boot(user('a1', 'r1'));
      const first = watch(http.get(`${API}/x`));
      expire(`${API}/x`);
      mock.expectOne(REFRESH).flush('down', { status: 503, statusText: 'Service Unavailable' });
      expect(first.error).toBe(UNCONFIRMED);
      const later = watch(http.get(`${API}/y`));
      expire(`${API}/y`);
      mock.expectOne(REFRESH).flush({ access: 'a2', refresh: 'r2' });
      mock.expectOne(`${API}/y`).flush({ ok: true });
      expect(later.value?.ok).toBeTrue();
    });

    it('REGRESSION: a local PERSISTENCE failure is unavailable — no logout, no replay claimed durable', () => {
      boot(user('a1', 'r1'));
      const w = watch(http.get(`${API}/x`));
      expire(`${API}/x`);
      const refresh = mock.expectOne(REFRESH);
      const setItem = localStorage.setItem.bind(localStorage);
      spyOn(localStorage, 'setItem').and.callFake((k: string, v: string) => {
        if (k === 'user') throw new Error('QuotaExceededError');
        setItem(k, v);
      });
      refresh.flush({ access: 'a2', refresh: 'r2' });
      expect(w.error).toBe(UNCONFIRMED);
      expect(mock.match(`${API}/x`).length).toBe(0);
      expect(logout).not.toHaveBeenCalled();
    });

    it('REGRESSION: a missing refresh token ends the session ONCE and sends no refresh', () => {
      boot(user('a1', null));
      const w = [1, 2].map((i) => watch(http.get(`${API}/x/${i}`)));
      expire(`${API}/x/1`);
      expire(`${API}/x/2`);
      expect(mock.match(REFRESH).length).toBe(0);
      expect(w[0].error).toBe(EXPIRED);
      // The second request belongs to a session that is already ending.
      expect(w[1].settled).toBeTrue();
      expect(redirect.calls.count()).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 2. Deadlines, cancellation and the flight slot
  // ───────────────────────────────────────────────────────────────────────

  describe('deadlines and cancellation', () => {
    it('REGRESSION: every caller settles at the wait bound; a slow success afterwards persists with ZERO late replay', fakeAsync(() => {
      boot(user('a1', 'r1'));
      const w = [1, 2].map((i) => watch(http.get(`${API}/x/${i}`)));
      [1, 2].forEach((i) => expire(`${API}/x/${i}`));
      const refresh = mock.expectOne(REFRESH);
      tick(WAIT_MS);
      expect(w.map((x) => x.error)).toEqual([UNCONFIRMED, UNCONFIRMED]);
      expect(refresh.cancelled).toBeFalse();
      refresh.flush({ access: 'a2', refresh: 'r2' });
      // Credentials only — the service never replays a resource command.
      expect(mock.match(() => true).filter((r) => r.request.url !== REFRESH).length).toBe(0);
      expect(stored().refresh).toBe('r2');
      expect(auth.userValue?.token).toBe('a2');
      flush();
    }));

    it('REGRESSION: the leader UNSUBSCRIBING does not cancel the refresh another waiter shares', () => {
      boot(user('a1', 'r1'));
      const leader = watch(http.get(`${API}/a`));
      const waiter = watch(http.get(`${API}/b`));
      expire(`${API}/a`);
      expire(`${API}/b`);
      const refresh = mock.expectOne(REFRESH);
      leader.sub.unsubscribe();
      expect(refresh.cancelled).toBeFalse();
      refresh.flush({ access: 'a2', refresh: 'r2' });
      expect(mock.match(`${API}/a`).length).withContext('the departed leader is never replayed').toBe(0);
      mock.expectOne(`${API}/b`).flush({ ok: 'b' });
      expect(waiter.value?.ok).toBe('b');
    });

    it('REGRESSION: a leader cut off by its own upstream timeout does not latch the service', fakeAsync(() => {
      boot(user('a1', 'r1'));
      const leader = watch(http.get(`${API}/poll`).pipe(timeout(8000)));
      expire(`${API}/poll`);
      const refresh = mock.expectOne(REFRESH);
      tick(8000);
      expect(leader.error?.name).toBe('TimeoutError');
      expect(refresh.cancelled).toBeFalse();
      refresh.flush({ access: 'a2', refresh: 'r2' });
      const later = watch(http.get(`${API}/later`));
      // Sent with the renewed token already: nothing to recover.
      const req = mock.expectOne(`${API}/later`);
      expect(req.request.headers.get('Authorization')).toBe('Bearer a2');
      req.flush({ ok: true });
      expect(later.value?.ok).toBeTrue();
      flush();
    }));

    it('REGRESSION: the transport hard cap frees the flight; a late joiner does not extend it; a new request recovers', fakeAsync(() => {
      boot(user('a1', 'r1'));
      watch(http.get(`${API}/first`));
      expire(`${API}/first`);
      const stuck = mock.expectOne(REFRESH);
      tick(CAP_MS - 5_000);
      const late = watch(http.get(`${API}/late`));
      expire(`${API}/late`);
      expect(mock.match(REFRESH).length).withContext('the late request joins, it does not start another').toBe(0);
      tick(5_000);
      expect(stuck.cancelled).toBeTrue();
      expect(late.error).toBe(UNCONFIRMED);
      const again = watch(http.get(`${API}/again`));
      expire(`${API}/again`);
      mock.expectOne(REFRESH).flush({ access: 'a2', refresh: 'r2' });
      mock.expectOne(`${API}/again`).flush({ ok: true });
      expect(again.value?.ok).toBeTrue();
      flush();
    }));
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3. Session ends and adoptions are fenced, both ways
  // ───────────────────────────────────────────────────────────────────────

  describe('logout and adoption fences', () => {
    it('REGRESSION: logout before the revoke completes — a refresh landing in that interval writes nothing and replays nothing', () => {
      boot(user('a1', 'r1'));
      const w = watch(http.get(`${API}/x`));
      expire(`${API}/x`);
      const refresh = mock.expectOne(REFRESH);
      auth.logout();
      expect(w.error).withContext('the old recovery is invalidated at intent').toBe(CHANGED);
      refresh.flush({ access: 'a2', refresh: 'r2' });
      expect(stored().token).toBe('a1');
      expect(mock.match(`${API}/x`).length).toBe(0);
      expect(revokes()).toBe(1);
      expect(localStorage.getItem('user')).toBeNull();
      expect(redirect.calls.allArgs()).toEqual([['/login']]);
    });

    it('REGRESSION: an old REJECTED refresh after a replacement install neither revokes nor logs out the successor', () => {
      boot(user('a1', 'r1'));
      const w = watch(http.get(`${API}/x`));
      expire(`${API}/x`);
      const refresh = mock.expectOne(REFRESH);
      const u2 = user('b1', 's1', 'u2');
      auth.installAuthenticatedSessionAndReload(u2 as any, u2.profile.restaurant_roles[0] as any, '/dashboard');
      refresh.flush({ detail: 'Token is blacklisted', code: 'token_not_valid' }, { status: 401, statusText: 'Unauthorized' });
      expect(w.error).toBe(CHANGED);
      expect(mock.match(LOGOUT).length).toBe(0);
      expect(stored().refresh).toBe('s1');
      expect(redirect.calls.allArgs()).toEqual([['/dashboard', 'replace']]);
    });

    it('REGRESSION: an old SUCCESSFUL refresh after a replacement install does not overwrite it, and U1 is not replayed', () => {
      boot(user('a1', 'r1'));
      watch(http.get(`${API}/x`));
      expire(`${API}/x`);
      const refresh = mock.expectOne(REFRESH);
      const u2 = user('b1', 's1', 'u2');
      auth.installAuthenticatedSessionAndReload(u2 as any, u2.profile.restaurant_roles[0] as any, '/dashboard');
      refresh.flush({ access: 'a2', refresh: 'r2' });
      expect(stored().profile.id).toBe('u2');
      expect(stored().refresh).toBe('s1');
      expect(auth.userValue?.token).toBe('b1');
      expect(mock.match(`${API}/x`).length).toBe(0);
    });

    it('REGRESSION: a revoke completing after a replacement login does not clear or redirect the successor', () => {
      boot(user('a1', 'r1'));
      auth.logout();
      const revoke = mock.expectOne(LOGOUT);
      auth.UpdateUser({ token: 'b1', refresh: 's1' } as any, user('b1', 's1', 'u2') as any);
      revoke.flush({});
      expect(stored().refresh).toBe('s1');
      expect(auth.userValue?.token).toBe('b1');
      expect(redirect).not.toHaveBeenCalled();
    });

    it('REGRESSION: public resetStorage then OTP adoption — the old refresh cannot touch the new session', () => {
      boot(user('a1', 'r1'));
      watch(http.get(`${API}/x`));
      expire(`${API}/x`);
      const refresh = mock.expectOne(REFRESH);
      auth.resetStorage();
      auth.UpdateUser({ token: 'b1', refresh: 's1' } as any, user('b1', 's1', 'u2') as any);
      refresh.flush({ access: 'a2', refresh: 'r2' });
      expect(stored().refresh).toBe('s1');
      expect(mock.match(`${API}/x`).length).toBe(0);
    });

    it('REGRESSION: a fresh login as the SAME profile is still a new session', () => {
      boot(user('a1', 'r1'));
      const w = watch(http.get(`${API}/x`));
      expire(`${API}/x`);
      const refresh = mock.expectOne(REFRESH);
      auth.login('0700000000', 'pw').subscribe();
      mock.expectOne(`${API}/users/auth/login/`).flush({ status: 200, data: user('c1', 't1') });
      refresh.flush({ access: 'a2', refresh: 'r2' });
      expect(w.error).toBe(CHANGED);
      expect(stored().token).toBe('c1');
      expect(stored().refresh).toBe('t1');
      expect(mock.match(`${API}/x`).length).toBe(0);
    });

    it('NEW DESIGN: a VISIBLE shared-storage replacement is left untouched and never adopted (non-atomic: narrows the race only)', () => {
      boot(user('a1', 'r1'));
      const w = watch(http.get(`${API}/x`));
      expire(`${API}/x`);
      const refresh = mock.expectOne(REFRESH);
      const otherTab = JSON.stringify(user('tab-a', 'tab-a-refresh'));  // same profile
      localStorage.setItem('user', otherTab);
      refresh.flush({ access: 'a2', refresh: 'r2' });
      expect(w.error).toBe(CHANGED);
      expect(localStorage.getItem('user')).toBe(otherTab);
      expect(auth.userValue?.token).toBe('a1');
      expect(logout).not.toHaveBeenCalled();
    });

    it('CONTROL: the next legitimate session can log out too, and logout(no_redirect) / inactivity keep their destinations', () => {
      boot(user('a1', 'r1'));
      auth.logout(true);
      expect(revokes()).toBe(1);
      expect(redirect).not.toHaveBeenCalled();
      auth.UpdateUser({ token: 'b1', refresh: 's1' } as any, user('b1', 's1') as any);
      auth.logoutDueToInactivity();
      expect(revokes()).toBe(1);
      expect(redirect.calls.allArgs()).toEqual([['/login?reason=inactivity']]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 4. Request ownership: the selected context, and stale credentials
  // ───────────────────────────────────────────────────────────────────────

  describe('request ownership', () => {
    it('REGRESSION: a restaurant switch during the refresh ends the old request\'s replay — the rotation still persists for the login', () => {
      boot(user('a1', 'r1'));
      const w = watch(http.put(`${API}/kitchen/orders/o1/priority/`, { priority: true, if_revision: 2 }));
      expire(`${API}/kitchen/orders/o1/priority/`);
      const refresh = mock.expectOne(REFRESH);
      auth.setCurrentRestaurantRole({ restaurant_id: 'r2', restaurant: 'R2', roles: ['owner'] });
      refresh.flush({ access: 'a2', refresh: 'r2' });
      expect(w.error).toBe(CHANGED);
      expect(mock.match(`${API}/kitchen/orders/o1/priority/`).length).toBe(0);
      expect(stored().refresh).toBe('r2');
      // A request in the NEW context simply carries the rotated token.
      http.get(`${API}/y`).subscribe();
      expect(mock.expectOne(`${API}/y`).request.headers.get('Authorization')).toBe('Bearer a2');
    });

    it('REGRESSION: A→B→A does not revive a command issued in the first A', () => {
      boot(user('a1', 'r1'));
      const w = watch(http.put(`${API}/kitchen/orders/o1/priority/`, { priority: true, if_revision: 2 }));
      expire(`${API}/kitchen/orders/o1/priority/`);
      const refresh = mock.expectOne(REFRESH);
      auth.setCurrentRestaurantRole({ restaurant_id: 'r2', roles: ['owner'] });
      auth.setCurrentRestaurantRole({ restaurant_id: 'r1', restaurant: 'R', roles: ['owner'] });
      refresh.flush({ access: 'a2', refresh: 'r2' });
      expect(w.error).toBe(CHANGED);
      expect(mock.match(`${API}/kitchen/orders/o1/priority/`).length).toBe(0);
    });

    it('CONTROL: re-storing the same restaurant\'s refreshed detail is not a context change', () => {
      boot(user('a1', 'r1'));
      auth.setCurrentRestaurant({ id: 'r1', name: 'R' });
      const w = watch(http.get(`${API}/x`));
      expire(`${API}/x`);
      const refresh = mock.expectOne(REFRESH);
      auth.setCurrentRestaurant({ id: 'r1', name: 'R, renamed' });
      auth.updateProfile({ ...PROFILE(), first_name: 'Changed' });
      refresh.flush({ access: 'a2', refresh: 'r2' });
      mock.expectOne(`${API}/x`).flush({ ok: true });
      expect(w.value?.ok).toBeTrue();
      expect(stored().profile.first_name).toBe('Changed');
    });

    it('REGRESSION: a late 401 for a request sent under the OLDER token of an unchanged session uses the current token, without a second rotation', () => {
      boot(user('a1', 'r1'));
      const a = watch(http.get(`${API}/a`));
      const b = watch(http.get(`${API}/b`));
      const bReq = mock.expectOne(`${API}/b`);
      expire(`${API}/a`);
      mock.expectOne(REFRESH).flush({ access: 'a2', refresh: 'r2' });
      mock.expectOne(`${API}/a`).flush({ ok: 'a' });
      fail401(bReq);
      expect(mock.match(REFRESH).length).toBe(0);
      const replay = mock.expectOne(`${API}/b`);
      expect(replay.request.headers.get('Authorization')).toBe('Bearer a2');
      replay.flush({ ok: 'b' });
      expect([a.value?.ok, b.value?.ok]).toEqual(['a', 'b']);
    });

    it('REGRESSION: a stale ORIGINAL 401 that lands after a new owner took over neither refreshes nor logs out', () => {
      boot(user('a1', 'r1'));
      const w = watch(http.get(`${API}/x`));
      const pending = mock.expectOne(`${API}/x`);
      const u2 = user('b1', 's1', 'u2');
      auth.installAuthenticatedSessionAndReload(u2 as any, u2.profile.restaurant_roles[0] as any, '/dashboard');
      fail401(pending);
      expect(w.error).toBe(CHANGED);
      expect(mock.match(REFRESH).length).toBe(0);
      expect(mock.match(`${API}/x`).length).toBe(0);
      expect(logout).not.toHaveBeenCalled();
    });

    it('REGRESSION: a stale REPLAY 401 after a newer token was installed cannot log out the newer credential', () => {
      boot(user('a1', 'r1'));
      const first = watch(http.get(`${API}/first`));
      expire(`${API}/first`);
      mock.expectOne(REFRESH).flush({ access: 'a2', refresh: 'r2' });
      const firstReplay = mock.expectOne(`${API}/first`);              // held, under a2
      const second = watch(http.get(`${API}/second`));                   // sent under a2
      expire(`${API}/second`);
      mock.expectOne(REFRESH).flush({ access: 'a3', refresh: 'r3' });
      mock.expectOne(`${API}/second`).flush({ ok: true });
      fail401(firstReplay);                                              // a2 refused, late
      expect(first.error).toBe(CHANGED);
      expect(second.value?.ok).toBeTrue();
      expect(logout).not.toHaveBeenCalled();
      expect(auth.userValue?.token).toBe('a3');
    });

    it('REGRESSION: an unrelated origin and a LOOKALIKE API prefix never enter staff recovery', () => {
      boot(user('a1', 'r1'));
      const base = new URL(environment.apiUrl);
      const lookalike = `https://${base.host}.evil.test${base.pathname.replace(/\/$/, '')}/api/v1/x/`;
      const w1 = watch(http.get(lookalike));
      fail401(mock.expectOne(lookalike));
      const w2 = watch(http.get('https://example.test/api/v1/x/'));
      fail401(mock.expectOne('https://example.test/api/v1/x/'));
      expect(mock.match(REFRESH).length).toBe(0);
      expect(w1.settled && w2.settled).toBeTrue();
      expect(logout).not.toHaveBeenCalled();
    });

    it('CONTROL: an anonymous diner 401 is never refreshed, and the capability header still rides the request', () => {
      boot(null);
      TestBed.inject(DinerSessionService).setToken('diner-session-token');
      const w = watch(http.put(`${API}/orders/submit/`, { order: 'o1', quote_ref: 'q1' }));
      const req = mock.expectOne(`${API}/orders/submit/`);
      expect(req.request.headers.get('X-Diner-Session')).toBe('diner-session-token');
      expect(req.request.headers.has('Authorization')).toBeFalse();
      req.flush({ detail: 'Authentication credentials were not provided.' }, { status: 401, statusText: 'Unauthorized' });
      expect(w.settled).toBeTrue();
      expect(mock.match(REFRESH).length).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 5. What a 401 proves, and resource errors after renewal
  // ───────────────────────────────────────────────────────────────────────

  describe('evidence and resource errors', () => {
    function afterRenewal(method: 'get' | 'post', url: string, answer: [any, number, string]): Outcome[] {
      const w = [watch((http as any)[method](url, method === 'post' ? { a: 1 } : undefined)),
                 watch((http as any)[method](`${url}?waiter=1`, method === 'post' ? { a: 1 } : undefined))];
      expire(url);
      expire(`${url}?waiter=1`);
      mock.expectOne(REFRESH).flush({ access: 'a2', refresh: 'r2' });
      [url, `${url}?waiter=1`].forEach((u) =>
        mock.expectOne(u).flush(answer[0], { status: answer[1], statusText: answer[2] }));
      return w;
    }

    it('REGRESSION: a resource 403 after renewal is the SAME denial for leader and waiter — toast, no logout', () => {
      boot(user('a1', 'r1'));
      const [leader, waiter] = afterRenewal('get', `${API}/x`, [{ status: 403, message: 'Not in your module.' }, 403, 'Forbidden']);
      expect(leader.error).toBe('Not in your module.');
      expect(waiter.error).toBe('Not in your module.');
      expect(toast.error).toHaveBeenCalledWith('Not in your module.');
      expect(logout).not.toHaveBeenCalled();
    });

    it('REGRESSION: a resource 500 after renewal is the SAME resource error for leader and waiter, no logout', () => {
      boot(user('a1', 'r1'));
      const [leader, waiter] = afterRenewal('get', `${API}/x`, [{ message: 'Something failed' }, 500, 'Server Error']);
      expect(leader.error).toBe('Something failed');
      expect(waiter.error).toBe('Something failed');
      expect(logout).not.toHaveBeenCalled();
    });

    it('REGRESSION: an expired token, renewal, then first-time-menu-review\'s code-less PERMISSION 401 is an ordinary permission failure', () => {
      boot(user('a1', 'r1'));
      const url = `${API}/restaurant-setup/manager-actions/first-time-menu-review/`;
      const w = watch(http.post(url, { restaurant: 'r1', decision: 'approve' }));
      expire(url);
      mock.expectOne(REFRESH).flush({ access: 'a2', refresh: 'r2' });
      mock.expectOne(url).flush(PERMISSION_401, { status: 401, statusText: 'Unauthorized' });
      expect(w.error).toBe(PERMISSION_401.message);
      expect(mock.match(REFRESH).length).withContext('never a second renewal').toBe(0);
      expect(logout).not.toHaveBeenCalled();
    });

    it('REGRESSION: the same permission 401 on a FIRST attempt burns no refresh and replays nothing', () => {
      boot(user('a1', 'r1'));
      const url = `${API}/restaurant-setup/manager-actions/first-time-menu-review/`;
      const w = watch(http.post(url, { restaurant: 'r1', decision: 'approve' }));
      mock.expectOne(url).flush(PERMISSION_401, { status: 401, statusText: 'Unauthorized' });
      expect(w.error).toBe(PERMISSION_401.message);
      expect(mock.match(REFRESH).length).toBe(0);
      expect(mock.match(url).length).toBe(0);
      expect(logout).not.toHaveBeenCalled();
    });

    it('REGRESSION: an UNRECOGNISED 401 — even on a GET — is not renewed, not replayed, and ends nothing', () => {
      boot(user('a1', 'r1'));
      const w1 = watch(http.get(`${API}/x`));
      mock.expectOne(`${API}/x`).flush({ detail: 'Mystery', code: 'mystery_code' }, { status: 401, statusText: 'Unauthorized' });
      const w2 = watch(http.get(`${API}/y`));
      mock.expectOne(`${API}/y`).flush('<html>401</html>', { status: 401, statusText: 'Unauthorized' });
      expect(mock.match(REFRESH).length).toBe(0);
      expect(w1.settled && w2.settled).toBeTrue();
      expect(logout).not.toHaveBeenCalled();
    });

    it('CONTROL: a DEFINITIVE refusal of the renewed credential on replay logs out ONCE, without a second refresh', () => {
      boot(user('a1', 'r1'));
      const w = watch(http.get(`${API}/x`));
      expire(`${API}/x`);
      mock.expectOne(REFRESH).flush({ access: 'a2', refresh: 'r2' });
      expire(`${API}/x`);
      expect(w.error).toBe(EXPIRED);
      expect(mock.match(REFRESH).length).toBe(0);
      expect(revokes()).toBe(1);
    });

    it('REGRESSION: user_inactive for the CURRENT credential ends the session without spending a refresh', () => {
      boot(user('a1', 'r1'));
      const w = watch(http.get(`${API}/x`));
      mock.expectOne(`${API}/x`).flush({ detail: 'User is inactive', code: 'user_inactive' }, { status: 401, statusText: 'Unauthorized' });
      expect(w.error).toBe(EXPIRED);
      expect(mock.match(REFRESH).length).toBe(0);
      expect(revokes()).toBe(1);
    });

    it('CONTROL: a legitimate 403 with no renewal stays a denial', () => {
      boot(user('a1', 'r1'));
      const w = watch(http.get(`${API}/x`));
      mock.expectOne(`${API}/x`).flush({ status: 403, message: 'Denied.' }, { status: 403, statusText: 'Forbidden' });
      expect(w.error).toBe('Denied.');
      expect(mock.match(REFRESH).length).toBe(0);
      expect(logout).not.toHaveBeenCalled();
    });

    it('CONTROL: \'rate_limited\' and \'no network\' consumers keep their sentinels', () => {
      boot(user('a1', 'r1'));
      const a = watch(http.post(`${API}/users/auth/login/`, {}));
      mock.expectOne(`${API}/users/auth/login/`).flush({ detail: 'Request was throttled.' }, { status: 429, statusText: 'Too Many Requests' });
      const b = watch(http.get(`${API}/x`));
      mock.expectOne(`${API}/x`).error(new ProgressEvent('error'), { status: 0, statusText: '' });
      expect(a.error).toBe('rate_limited');
      expect(b.error).toBe('no network');
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 6. The real kitchen board
  // ───────────────────────────────────────────────────────────────────────

  describe('the real kitchen board', () => {
    const ID = 'k-01';
    const ticket = (over: any = {}) => ({
      id: ID, order_number: 1, table_label: 'T1', order_source: 'diner_self_service',
      fulfilment_status: 'preparing', priority: false, created_at: new Date().toISOString(),
      served_at: null, items: [], order_status: 'pending', fulfilment_revision: 3, ...over,
    });
    const feed = (rows: any[]) => ({ status: 200, kitchen_protocol: 1, data: { records: rows } });
    const conflict = {
      status: 409, reason: 'stale_revision', message: 'This ticket changed.',
      data: { id: ID, fulfilment_revision: 4, order_status: 'pending', fulfilment_status: 'ready',
              priority: false, served_at: null, cancelled_at: null, cancellation_reason: null },
    };
    const active = () => mock.expectOne((r) => r.url.startsWith(`${API}/kitchen/orders/active/`));

    function seeded(): KitchenOrderService {
      const kitchen = TestBed.inject(KitchenOrderService);
      kitchen.loadActive().subscribe({ error: () => undefined });
      active().flush(feed([ticket()]));
      return kitchen;
    }

    it('CONTROL: a first-attempt stale_revision conflict reads as a conflict with its reason', () => {
      boot(user('a1', 'r1'));
      const kitchen = seeded();
      expect(kitchen.advanceStatus(ID, 'ready')).toBeTrue();
      mock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`).flush(conflict, { status: 409, statusText: 'Conflict' });
      expect(kitchen.operationFor(ID)?.phase).toBe('conflict');
      expect(kitchen.operationFor(ID)?.reason).toBe('stale_revision');
    });

    it('REGRESSION: after renewal the same conflict keeps its reason and state, the ORIGINAL if_revision is replayed, the board stays', () => {
      boot(user('a1', 'r1'));
      const kitchen = seeded();
      expect(kitchen.advanceStatus(ID, 'ready')).toBeTrue();
      const first = mock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`);
      const body = JSON.stringify(first.request.body);
      expect(body).toBe('{"action":"advance","if_revision":3}');
      fail401(first);
      mock.expectOne(REFRESH).flush({ access: 'a2', refresh: 'r2' });
      const replay = mock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`);
      expect(JSON.stringify(replay.request.body)).toBe(body);
      expect(replay.request.headers.get('Authorization')).toBe('Bearer a2');
      replay.flush(conflict, { status: 409, statusText: 'Conflict' });
      expect(kitchen.operationFor(ID)?.phase).toBe('conflict');
      expect(kitchen.operationFor(ID)?.reason).toBe('stale_revision');
      expect(kitchen.activeTickets().map((t) => t.fulfilment_revision)).toEqual([4]);
      expect(logout).not.toHaveBeenCalled();
    });

    it('REGRESSION: leaving the board (stopPolling) mid-refresh cancels nothing; the next command reaches the server with the renewed token', fakeAsync(() => {
      boot(user('a1', 'r1'));
      const kitchen = seeded();
      kitchen.startPolling();
      fail401(active());
      const refresh = mock.expectOne(REFRESH);
      kitchen.stopPolling();
      expect(refresh.cancelled).toBeFalse();
      refresh.flush({ access: 'a2', refresh: 'r2' });
      expect(mock.match((r) => r.url.startsWith(`${API}/kitchen/orders/active/`)).length)
        .withContext('the stopped poll is never replayed').toBe(0);
      expect(kitchen.advanceStatus(ID, 'ready')).toBeTrue();
      const cmd = mock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`);
      expect(cmd.request.headers.get('Authorization')).toBe('Bearer a2');
      cmd.flush(conflict, { status: 409, statusText: 'Conflict' });
      expect(kitchen.operationFor(ID)?.phase).toBe('conflict');
      kitchen.stopPolling();
      flush();
    }));

    it('CONTROL: an ordinary same-principal renewal keeps the board (scope is restaurant:profile.id)', () => {
      boot(user('a1', 'r1'));
      const kitchen = seeded();
      watch(http.get(`${API}/x`));
      expire(`${API}/x`);
      mock.expectOne(REFRESH).flush({ access: 'a2', refresh: 'r2' });
      mock.expectOne(`${API}/x`).flush({ ok: true });
      expect(kitchen.activeTickets().length).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 7. The real checkout, on the staff (JWT) channel of the portal embed
  // ───────────────────────────────────────────────────────────────────────

  describe('the real checkout coordinator and basket', () => {
    let fixture: ComponentFixture<BasketBodyComponent>;
    let component: BasketBodyComponent;
    let coordinator: CheckoutCoordinatorService;
    let basketService: any;

    const line = () => ({
      itemId: 'i1', itemName: 'Burger', basePrice: 5000, totalPrice: 5000,
      quantity: 1, selectedModifiers: [], extras: [], isDiscounted: false,
    } as unknown as BasketItem);

    /** An initiate 200 whose quote may expire in the past (to route through retire-quote). */
    const initiated = (expired = false) => ({
      status: 200,
      data: {
        order_details: {
          id: 'o1', quote_ref: 'q1', actual_cost: '5000.00', quote_total: '5000.00',
          pricing_version: 'CORRECTED', checkout_protocol: 3, quote_protocol: 2,
          ...(expired ? { quote_policy: { version: 1, status: 'live', expires_at: '2020-01-01T00:00:00Z' } } : {}),
        },
        order_items: [], available_items: [], unavailable_items: [],
        extras: [], available_extras: [], unavailable_extras: [],
        quote: [], quote_total: '5000.00',
      },
    });

    async function mount(): Promise<void> {
      basketService = {
        Basket: () => ({ items: [line()], totalAmount: 5000 }),
        clearBasket: jasmine.createSpy('clearBasket'),
        revision: () => 1,
        contentIdentity: () => BasketService.prototype.contentIdentity.call(basketService),
        totalState: (items: BasketItem[]) => BasketService.prototype.totalState.call(basketService, items),
      };
      // Everything is configured BEFORE the first inject: TestBed cannot be
      // reconfigured once a service has been instantiated.
      boot(user('a1', 'r1'), 'r1', {
        imports: [BasketBodyComponent],
        providers: [
          { provide: BasketService, useValue: basketService },
          {
            provide: ConfirmDialogService,
            useValue: jasmine.createSpyObj('ConfirmDialogService', ['openModal', 'closeModal']),
          },
        ],
      });
      await TestBed.compileComponents();
      spyOn(TestBed.inject(Router), 'navigate').and.stub();
      coordinator = TestBed.inject(CheckoutCoordinatorService);
      window.sessionStorage.setItem('Table', JSON.stringify({ value: { id: 't1' } }));
      window.sessionStorage.setItem('restaurant', JSON.stringify({ value: { id: 'r1' } }));
      fixture = TestBed.createComponent(BasketBodyComponent);
      component = fixture.componentInstance;
      component.sidebar = true;
    }

    /**
     * Answer ONE logical request, either directly or through an expired-token
     * 401 → renewal → replay. Records the logical request, and asserts that
     * the replay is the SAME request (method, url, body) with only its
     * Authorization changed.
     */
    function answer(match: (r: any) => boolean, body: any, status: number, renewing: boolean, log: string[]): void {
      const first = mock.expectOne(match);
      log.push(`${first.request.method} ${first.request.urlWithParams.replace(ROOT, '')} ${JSON.stringify(first.request.body)}`);
      let target = first;
      if (renewing) {
        fail401(first);
        mock.expectOne(REFRESH).flush({ access: 'a2', refresh: 'r2' });
        target = mock.expectOne(match);
        expect(target.request.method).toBe(first.request.method);
        expect(target.request.urlWithParams).toBe(first.request.urlWithParams);
        expect(JSON.stringify(target.request.body)).toBe(JSON.stringify(first.request.body));
        expect(target.request.headers.get('Authorization')).toBe('Bearer a2');
      }
      if (status === 0) target.error(new ProgressEvent('error'), { status: 0, statusText: '' });
      else target.flush(body, { status, statusText: String(status) });
    }

    function snapshot() {
      const r = coordinator.record();
      const next = mock.match(() => true).map((q) =>
        `${q.request.method} ${q.request.urlWithParams.replace(ROOT, '')} ${JSON.stringify(q.request.body)}`);
      return {
        key: r?.key ?? null, stage: r?.stage ?? null, command: r?.command ?? null,
        orderError: component.orderError, retired: component.quoteRetired,
        recovered: (component as any).recovered?.kind ?? null,
        nextRequests: next,
      };
    }

    /**
     * Two independent runs mint two different random idempotency keys. The
     * equality oracle compares everything ELSE; each run separately asserts
     * that its key never changed within the run.
     */
    function normalised<T>(out: T, key: string | null): T {
      if (!key) return out;
      return JSON.parse(JSON.stringify(out).split(key).join('<key>'));
    }

    const isInitiate = (r: any) => r.url === `${ROOT}/v2/orders/initiate/`;
    const isSubmit = (r: any) => r.url === `${API}/orders/submit/`;
    const isRetire = (r: any) => r.url === `${API}/orders/retire-quote/`;
    const isIntentRead = (r: any) => r.url.startsWith(`${API}/orders/journey/order-details/`) && r.url.includes('intent=');

    async function submitConflict(renewing: boolean, refusal: any, status: number) {
      await mount();
      const log: string[] = [];
      component.initiateOrder();
      answer(isInitiate, initiated(), 200, false, log);
      const key = coordinator.record()!.key;
      component.confirmQuote();
      answer(isSubmit, refusal, status, renewing, log);
      const out = normalised({ log, state: snapshot(), logouts: logout.calls.count() }, key);
      TestBed.resetTestingModule();
      return out;
    }

    for (const [label, body, status] of [
      ['a 400 quote_ref_stale (re-price under the SAME key)', { status: 400, message: 'The order changed.', reason: 'quote_ref_stale' }, 400],
      ['a 409 order_already_accepted', { status: 409, message: 'Already accepted.', reason: 'order_already_accepted' }, 409],
    ] as Array<[string, any, number]>) {
      it(`REGRESSION: a submit answered with ${label} after renewal follows the SAME coordinator/component flow as a first attempt`, async () => {
        const direct = await submitConflict(false, body, status);
        const renewed = await submitConflict(true, body, status);
        expect(renewed.logouts).withContext('no session is ended by a resource conflict').toBe(0);
        expect(renewed.state).toEqual(direct.state);
        expect(renewed.log).toEqual(direct.log);
        // The issued command's identity survived the renewal: same key, same body.
        expect(direct.log[1]).toContain('"order":"o1"');
        expect(direct.log[1]).toContain('"quote_ref":"q1"');
      });
    }

    async function retireConflict(renewing: boolean) {
      await mount();
      const log: string[] = [];
      component.initiateOrder();
      answer(isInitiate, initiated(true), 200, false, log);
      const key = coordinator.record()!.key;
      component.confirmQuote();
      answer(isRetire, { status: 409, message: 'Already accepted.', reason: 'order_already_accepted', order: 'o1', quote_ref: 'q1', quote_protocol: 2 }, 409, renewing, log);
      const out = normalised({ log, state: snapshot(), logouts: logout.calls.count() }, key);
      TestBed.resetTestingModule();
      return out;
    }

    it('REGRESSION: a retire-quote conflict after renewal follows the SAME flow as a first attempt', async () => {
      const direct = await retireConflict(false);
      const renewed = await retireConflict(true);
      expect(direct.log.some((l) => l.includes('/orders/retire-quote/'))).toBeTrue();
      expect(renewed.logouts).toBe(0);
      expect(renewed.state).toEqual(direct.state);
      expect(renewed.log).toEqual(direct.log);
    });

    async function lostReplyThenRecovery(renewing: boolean) {
      await mount();
      const log: string[] = [];
      component.initiateOrder();
      answer(isInitiate, initiated(), 200, false, log);
      const key = coordinator.record()!.key;
      component.confirmQuote();
      answer(isSubmit, null, 0, false, log);                    // the acceptance reply is lost
      component.retryOrder();
      answer(isIntentRead, { status: 404, message: 'Not found' }, 404, renewing, log);
      const out = { ...normalised({ log, state: snapshot(), logouts: logout.calls.count() }, key), key };
      TestBed.resetTestingModule();
      return out;
    }

    it('REGRESSION: the intent read after a lost reply keeps its raw 404 through renewal — same recovery, same key, same command', async () => {
      const direct = await lostReplyThenRecovery(false);
      const renewed = await lostReplyThenRecovery(true);
      expect(renewed.logouts).toBe(0);
      expect(renewed.state).toEqual(direct.state);
      expect(renewed.log).toEqual(direct.log);
      expect(renewed.state.key).withContext('the key never changed within the run').toBe('<key>');
      expect(renewed.state.command).toEqual({ orderId: 'o1', quoteRef: 'q1' });
    });

    it('REGRESSION: a checkout whose renewal is UNAVAILABLE keeps the issued command and key for a same-key retry', async () => {
      await mount();
      const log: string[] = [];
      component.initiateOrder();
      answer(isInitiate, initiated(), 200, false, log);
      const key = coordinator.record()!.key;
      component.confirmQuote();
      fail401(mock.expectOne(isSubmit));
      mock.expectOne(REFRESH).flush('down', { status: 503, statusText: 'Service Unavailable' });
      expect(logout).not.toHaveBeenCalled();
      expect(coordinator.record()?.key).toBe(key);
      expect(coordinator.record()?.command).toEqual({ orderId: 'o1', quoteRef: 'q1' });
      expect(coordinator.isOutstanding(coordinator.record()!)).toBeTrue();
      TestBed.resetTestingModule();
    });

    afterEach(() => {
      window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
    });
  });

  it('CONTROL: keeps the raw error type assertion honest (HttpErrorResponse is still what the kitchen carve-out forwards)', () => {
    boot(user('a1', 'r1'));
    const w = watch(http.put(`${API}/kitchen/orders/o1/cancel/`, { if_revision: 1 }));
    mock.expectOne(`${API}/kitchen/orders/o1/cancel/`).flush({ status: 409, reason: 'x' }, { status: 409, statusText: 'Conflict' });
    expect(w.error instanceof HttpErrorResponse).toBeTrue();
  });
});
