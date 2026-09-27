import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  AuthenticationService, REFRESH_TRANSPORT_CAP_MS, REFRESH_WAIT_MS, RenewalOutcome,
} from './authentication.service';
import { environment } from 'src/environments/environment';
import { HttpBackend, HttpClient, HttpHeaders, HttpRequest, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';

describe('AuthenticationService', () => {
  let service: AuthenticationService;
  let httpMock: HttpTestingController;
  const base = `${environment.apiUrl}/api/${environment.version}`;

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
    imports: [],
    providers: [
        AuthenticationService,
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting()
    ]
});

    service = TestBed.inject(AuthenticationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('constructor / state initialization', () => {
    it('should initialize userValue as null when localStorage is empty', () => {
      expect(service.userValue).toBeNull();
    });

    it('should restore user from localStorage on construction', () => {
      const stored = { token: 'abc', refresh: 'def', profile: { id: '1', first_name: 'A', last_name: 'B', email: '', roles: [], phone_number: '', country: '', prompt_password_change: false, other_names: '', restaurant_roles: [] }, require_otp: false, prompt_password_change: false };
      localStorage.setItem('user', JSON.stringify(stored));

      // Re-create service to pick up localStorage
      const svc = new AuthenticationService(TestBed.inject(HttpClient), TestBed.inject(HttpBackend));
      expect(svc.userValue).toBeTruthy();
      expect(svc.userValue!.token).toBe('abc');
    });
  });

  describe('login', () => {
    it('should POST credentials and store user in localStorage', () => {
      const mockResponse = {
        message: 'ok',
        status: 200,
        data: {
          token: 'jwt-token',
          refresh: 'refresh-token',
          profile: { id: '1', first_name: 'Test', last_name: 'User', email: 'test@test.com', roles: ['restaurant_staff'], phone_number: '123', country: '', prompt_password_change: false, other_names: '', restaurant_roles: [] },
          require_otp: false,
          prompt_password_change: false
        },
        pagination: { number_of_pages: 0, current_page: 0, total_records: 0, records_per_page: 0, has_next: false, has_previous: false }
      };

      service.login('testuser', 'testpass').subscribe((res) => {
        expect(res.data).toBeTruthy();
        expect(service.userValue).toBeTruthy();
        expect(service.userValue!.token).toBe('jwt-token');
        expect(localStorage.getItem('user')).toContain('jwt-token');
      });

      const req = httpMock.expectOne(`${base}/users/auth/login/`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ username: 'testuser', password: 'testpass' });
      req.flush(mockResponse);
    });

    it('should include source in payload when provided', () => {
      service.login('user', 'pass', 'diner').subscribe();

      const req = httpMock.expectOne(`${base}/users/auth/login/`);
      expect(req.request.body).toEqual({ username: 'user', password: 'pass', source: 'diner' });
      req.flush({ data: { token: 't', refresh: 'r', profile: { id: '1', first_name: '', last_name: '', email: '', roles: [], phone_number: '', country: '', prompt_password_change: false, other_names: '', restaurant_roles: [] }, require_otp: false, prompt_password_change: false } });
    });

    it('should NOT store user in localStorage when require_otp is true', () => {
      const mockResponse = {
        data: {
          token: 'temp-token',
          refresh: 'temp-refresh',
          profile: { id: '1', first_name: 'Test', last_name: 'User', email: '', roles: [], phone_number: '', country: '', prompt_password_change: false, other_names: '', restaurant_roles: [] },
          require_otp: true,
          prompt_password_change: false
        }
      };

      service.login('user', 'pass').subscribe(() => {
        expect(localStorage.getItem('user')).toBeNull();
        expect(service.userValue).toBeNull();
      });

      const req = httpMock.expectOne(`${base}/users/auth/login/`);
      req.flush(mockResponse);
    });

    it('should NOT store user in localStorage when prompt_password_change is true', () => {
      const mockResponse = {
        data: {
          token: 'temp-token',
          refresh: 'temp-refresh',
          profile: { id: '1', first_name: 'Test', last_name: 'User', email: '', roles: [], phone_number: '', country: '', prompt_password_change: false, other_names: '', restaurant_roles: [] },
          require_otp: false,
          prompt_password_change: true
        }
      };

      service.login('user', 'pass').subscribe(() => {
        expect(localStorage.getItem('user')).toBeNull();
        expect(service.userValue).toBeNull();
      });

      const req = httpMock.expectOne(`${base}/users/auth/login/`);
      req.flush(mockResponse);
    });

    // PR-6: the customer origin holds no administrator credential path. The
    // backend is the boundary — it refuses to mint a customer token for a
    // platform-staff account (backend PR-2b) and returns the SAME 401 body as
    // an ordinary wrong password, deliberately, so the response is not an
    // account-type oracle. That indistinguishability is exactly why this test
    // asserts the general rule rather than a platform-staff special case: a
    // rejected login must persist NOTHING, whoever it belonged to.
    it('persists no auth state when the login is rejected (no admin credential path on this origin)', () => {
      let errored = false;

      service.login('platform-admin', 'pass').subscribe({
        next: () => fail('a 401 login must not emit a user'),
        error: () => { errored = true; },
      });

      const req = httpMock.expectOne(`${base}/users/auth/login/`);
      req.flush(
        { status: 401, message: 'The password is incorrect.' },
        { status: 401, statusText: 'Unauthorized' },
      );

      expect(errored).toBeTrue();
      expect(localStorage.getItem('user')).toBeNull();
      expect(localStorage.getItem('rest_role')).toBeNull();
      expect(localStorage.getItem('current_resta')).toBeNull();
      expect(service.userValue).toBeNull();
    });
  });

  describe('logout', () => {
    let redirectSpy: jasmine.Spy;

    beforeEach(() => {
      localStorage.setItem('user', '{"token":"t"}');
      localStorage.setItem('rest_role', '{"role":"admin"}');
      localStorage.setItem('current_resta', '{"id":"r1"}');
      // Stub the hard redirect so tests don't actually navigate the Karma host page.
      redirectSpy = spyOn<any>(service, 'hardRedirect');
    });

    it('should clear all localStorage keys', () => {
      service.logout(true);
      expect(localStorage.getItem('user')).toBeNull();
      expect(localStorage.getItem('rest_role')).toBeNull();
      expect(localStorage.getItem('current_resta')).toBeNull();
    });

    it('should clear persisted [dinify] nav state but preserve menu.sortMode', () => {
      localStorage.setItem('[dinify]menu.selectedSection:r1', '{"value":"sec-1"}');
      localStorage.setItem('[dinify]tables.activeView:r1', '{"value":"reservations"}');
      // Sidebar expand/collapse is nav state too: it must be cleared so a fresh
      // login falls back to the EXPANDED default (the reset half of the feature).
      localStorage.setItem('[dinify]sidebar.expanded', '{"value":false}');
      localStorage.setItem('[dinify]menu.sortMode:r1', '{"value":"a-z"}');
      localStorage.setItem('[dinify]menu.sortMode:r2', '{"value":"price-low"}');
      localStorage.setItem('unrelated', 'keep-me');

      service.logout(true);

      expect(localStorage.getItem('[dinify]menu.selectedSection:r1')).toBeNull();
      expect(localStorage.getItem('[dinify]tables.activeView:r1')).toBeNull();
      expect(localStorage.getItem('[dinify]sidebar.expanded')).toBeNull();
      expect(localStorage.getItem('[dinify]menu.sortMode:r1')).toBe('{"value":"a-z"}');
      expect(localStorage.getItem('[dinify]menu.sortMode:r2')).toBe('{"value":"price-low"}');
      expect(localStorage.getItem('unrelated')).toBe('keep-me');
    });

    it('should set userValue to null', () => {
      service.logout(true);
      expect(service.userValue).toBeNull();
    });

    it('should hard-redirect to /login by default', () => {
      service.logout();
      expect(redirectSpy).toHaveBeenCalledWith('/login');
    });

    it('should not redirect when no_redirect is true', () => {
      service.logout(true);
      expect(redirectSpy).not.toHaveBeenCalled();
    });
  });

  describe('logoutDueToInactivity', () => {
    let redirectSpy: jasmine.Spy;

    beforeEach(() => {
      localStorage.setItem('user', '{"token":"t"}');
      redirectSpy = spyOn<any>(service, 'hardRedirect');
    });

    it('hard-redirects to /login?reason=inactivity, clears the user, and never sets a returnUrl', () => {
      service.logoutDueToInactivity();
      expect(redirectSpy).toHaveBeenCalledTimes(1);
      const url = redirectSpy.calls.mostRecent().args[0] as string;
      expect(url.startsWith('/login?')).toBeTrue();
      const params = new URLSearchParams(url.split('?')[1]);
      expect(params.get('reason')).toBe('inactivity');
      // The last route is no longer preserved — login always lands on the first module.
      expect(params.get('returnUrl')).toBeNull();
      expect(service.userValue).toBeNull();
    });
  });

  describe('logout — refresh-token revocation', () => {
    const userWithRefresh = {
      token: 'access-xyz',
      refresh: 'refresh-abc',
      profile: { id: '1', first_name: '', last_name: '', email: '', roles: [], phone_number: '', country: '', prompt_password_change: false, other_names: '', restaurant_roles: [] },
      require_otp: false,
      prompt_password_change: false,
    };

    // Build a service that reads the just-seeded localStorage user. Its rawHttp
    // is wired to the same testing HttpBackend, so httpMock catches the POST.
    function makeService(): { svc: AuthenticationService; redirectSpy: jasmine.Spy } {
      const svc = new AuthenticationService(TestBed.inject(HttpClient), TestBed.inject(HttpBackend));
      const redirectSpy = spyOn<any>(svc, 'hardRedirect');
      return { svc, redirectSpy };
    }

    it('POSTs the refresh token to users/auth/logout/ with a Bearer header, then clears storage and redirects', () => {
      localStorage.setItem('user', JSON.stringify(userWithRefresh));
      const { svc, redirectSpy } = makeService();

      svc.logout();

      const req = httpMock.expectOne(`${base}/users/auth/logout/`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ refresh: 'refresh-abc' });
      expect(req.request.headers.get('Authorization')).toBe('Bearer access-xyz');
      req.flush({ status: 200, message: 'Logout successful.' });

      expect(localStorage.getItem('user')).toBeNull();
      expect(svc.userValue).toBeNull();
      expect(redirectSpy).toHaveBeenCalledWith('/login');
    });

    it('still clears storage and redirects when the revocation POST errors', () => {
      localStorage.setItem('user', JSON.stringify(userWithRefresh));
      const { svc, redirectSpy } = makeService();

      svc.logout();

      const req = httpMock.expectOne(`${base}/users/auth/logout/`);
      req.flush('server error', { status: 500, statusText: 'Server Error' });

      expect(localStorage.getItem('user')).toBeNull();
      expect(svc.userValue).toBeNull();
      expect(redirectSpy).toHaveBeenCalledWith('/login');
    });

    it('revokes but does not redirect when no_redirect is true', () => {
      localStorage.setItem('user', JSON.stringify(userWithRefresh));
      const { svc, redirectSpy } = makeService();

      svc.logout(true);

      const req = httpMock.expectOne(`${base}/users/auth/logout/`);
      expect(req.request.body).toEqual({ refresh: 'refresh-abc' });
      req.flush({ status: 200 });

      expect(localStorage.getItem('user')).toBeNull();
      expect(svc.userValue).toBeNull();
      expect(redirectSpy).not.toHaveBeenCalled();
    });

    it('does not POST when there is no refresh token, and redirects immediately', () => {
      localStorage.setItem('user', JSON.stringify({ token: 'access-only', profile: userWithRefresh.profile }));
      const { svc, redirectSpy } = makeService();

      svc.logout();

      httpMock.expectNone(`${base}/users/auth/logout/`);
      expect(localStorage.getItem('user')).toBeNull();
      expect(svc.userValue).toBeNull();
      expect(redirectSpy).toHaveBeenCalledWith('/login');
    });

    it('logoutDueToInactivity revokes then redirects to /login?reason=inactivity', () => {
      localStorage.setItem('user', JSON.stringify(userWithRefresh));
      const { svc, redirectSpy } = makeService();

      svc.logoutDueToInactivity();

      const req = httpMock.expectOne(`${base}/users/auth/logout/`);
      expect(req.request.method).toBe('POST');
      req.flush({ status: 200 });

      expect(svc.userValue).toBeNull();
      expect(redirectSpy).toHaveBeenCalledWith('/login?reason=inactivity');
    });

    it('redirects anyway if the revocation exceeds the timeout', fakeAsync(() => {
      localStorage.setItem('user', JSON.stringify(userWithRefresh));
      const { svc, redirectSpy } = makeService();

      svc.logout();

      // Issued but never flushed — the timeout must backstop it so the user is
      // never trapped on the page by a hung revoke.
      httpMock.expectOne(`${base}/users/auth/logout/`);
      expect(redirectSpy).not.toHaveBeenCalled();

      tick(2000);

      expect(redirectSpy).toHaveBeenCalledWith('/login');
      expect(localStorage.getItem('user')).toBeNull();
    }));
  });

  // ── D09: session renewal, request ownership and the logout fences ─────────
  //
  // ORACLE CORRECTIONS, recorded rather than silently rewritten. The retired
  // `attemptTokenRefresh()` specs pinned three things this contract changes on
  // purpose:
  //  - "401 → null" and "missing access → null": both were the SAME `null`, and
  //    the interceptor logged out on it. A refused credential is now `rejected`
  //    and an unreadable answer `unavailable/protocol`, because only the first
  //    proves the session is over.
  //  - "an access-only 200 resolves": the pinned backend rotates AND blacklists
  //    (`ROTATE_REFRESH_TOKENS`, `BLACKLIST_AFTER_ROTATION`), so a 200 without a
  //    replacement refresh token is a partial answer, and adopting it would keep
  //    a refresh token the server has already blacklisted.
  //  - the retired method never logged out, and left that to whichever caller
  //    heard `null` first. A refusal of the refresh token the session presented
  //    now ends the session ONCE, in the service, before any waiter hears it —
  //    leaving it to the first waiter superseded the session under the others,
  //    and they misreported an expired session as a context change.
  describe('renewSession', () => {
    const REFRESH = `${base}/users/auth/token/refresh/`;
    const profile = { id: 'u1', first_name: 'A', last_name: 'B', email: '', roles: [], phone_number: '', country: '', prompt_password_change: false, other_names: '', restaurant_roles: [] };
    const signedIn = (over: Record<string, unknown> = {}) =>
      ({ token: 'old-access', refresh: 'refresh-123', profile, require_otp: false, prompt_password_change: false, ...over });

    function makeService(user: any = signedIn()): AuthenticationService {
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('rest_role', JSON.stringify({ restaurant_id: 'r1', roles: ['owner'] }));
      const svc = new AuthenticationService(TestBed.inject(HttpClient), TestBed.inject(HttpBackend));
      spyOn<any>(svc, 'hardRedirect');
      return svc;
    }

    function ownerOf(svc: AuthenticationService, url = `${base}/menu/`, auth?: string) {
      const token = svc.userValue?.token;
      const headers = new HttpHeaders(auth ?? token ? { Authorization: auth ?? `Bearer ${token}` } : {});
      return svc.captureRequestOwner(new HttpRequest('GET', url, null, { headers }));
    }

    function outcomes(svc: AuthenticationService, owner: any) {
      const seen: RenewalOutcome[] = [];
      svc.renewSession(owner).subscribe((o) => seen.push(o));
      return seen;
    }

    it('rejects without a request when the session holds no usable refresh token', () => {
      for (const refresh of [undefined, '', '   ']) {
        localStorage.clear();
        const svc = makeService(signedIn({ refresh }));
        const seen = outcomes(svc, ownerOf(svc));
        expect(seen).toEqual([{ kind: 'rejected', ended: false }]);
      }
      httpMock.expectNone(REFRESH);
    });

    it('renews: one raw POST with no Authorization, both tokens persisted, the CURRENT profile kept', () => {
      const svc = makeService();
      const owner = ownerOf(svc)!;
      const seen = outcomes(svc, owner);
      // A profile update while the refresh is in flight must survive it.
      svc.updateProfile({ ...profile, first_name: 'Changed' });
      const req = httpMock.expectOne(REFRESH);
      expect(req.request.headers.has('Authorization')).toBeFalse();
      expect(req.request.body).toEqual({ refresh: 'refresh-123' });
      req.flush({ access: 'new-access', refresh: 'new-refresh' });

      expect(seen).toEqual([{ kind: 'renewed', access: 'new-access' }]);
      const stored = JSON.parse(localStorage.getItem('user')!);
      expect(stored.token).toBe('new-access');
      expect(stored.refresh).toBe('new-refresh');
      expect(stored.profile.first_name).toBe('Changed');
      // A renewal is not a session change: the request is still owned.
      expect(svc.ownerIsCurrent(owner)).toBeTrue();
    });

    it('shares ONE flight between concurrent callers', () => {
      const svc = makeService();
      const owner = ownerOf(svc)!;
      const a = outcomes(svc, owner);
      const b = outcomes(svc, owner);
      httpMock.expectOne(REFRESH).flush({ access: 'n', refresh: 'm' });
      expect(a).toEqual([{ kind: 'renewed', access: 'n' }]);
      expect(b).toEqual([{ kind: 'renewed', access: 'n' }]);
    });

    const cases: Array<[string, (r: any) => void, RenewalOutcome]> = [
      ['401 token_not_valid (expired/blacklisted)',
        (r) => r.flush({ detail: 'Token is blacklisted', code: 'token_not_valid' }, { status: 401, statusText: 'Unauthorized' }),
        { kind: 'rejected', ended: true }],
      ['401 {detail} without a code (inactive account)',
        (r) => r.flush({ detail: 'No active account found for the given token.' }, { status: 401, statusText: 'Unauthorized' }),
        { kind: 'rejected', ended: true }],
      ['an access-only 200',
        (r) => r.flush({ access: 'n' }), { kind: 'unavailable', cause: 'protocol' }],
      ['an empty 200', (r) => r.flush({}), { kind: 'unavailable', cause: 'protocol' }],
      ['blank tokens', (r) => r.flush({ access: '', refresh: ' ' }), { kind: 'unavailable', cause: 'protocol' }],
      ['non-string tokens', (r) => r.flush({ access: 5, refresh: {} }), { kind: 'unavailable', cause: 'protocol' }],
      ['a 400 for a missing/blank field',
        (r) => r.flush({ refresh: ['This field may not be blank.'] }, { status: 400, statusText: 'Bad Request' }),
        { kind: 'unavailable', cause: 'protocol' }],
      ['an unexpected 403', (r) => r.flush({ detail: 'x' }, { status: 403, statusText: 'Forbidden' }), { kind: 'unavailable', cause: 'protocol' }],
      ['an unexpected 429', (r) => r.flush({ detail: 'slow down' }, { status: 429, statusText: 'Too Many Requests' }), { kind: 'unavailable', cause: 'protocol' }],
      ['an HTML 401 from something in front of the API',
        (r) => r.flush('<html>401</html>', { status: 401, statusText: 'Unauthorized' }), { kind: 'unavailable', cause: 'protocol' }],
      ['a 503', (r) => r.flush('down', { status: 503, statusText: 'Service Unavailable' }), { kind: 'unavailable', cause: 'server' }],
      ['no HTTP answer (status 0)', (r) => r.error(new ProgressEvent('error'), { status: 0, statusText: '' }), { kind: 'unavailable', cause: 'transport' }],
    ];
    for (const [name, answer, expected] of cases) {
      // A REFUSAL of the presented refresh token ends the session ONCE, in the
      // service, before any waiter hears it; nothing else ever ends it here.
      const ends = expected.kind === 'rejected';
      it(`classifies ${name} as ${expected.kind}${'cause' in expected ? '/' + expected.cause : ''}, and ${ends ? 'ends the session exactly once' : 'never logs out'}`, () => {
        const svc = makeService();
        const logout = spyOn(svc, 'logout');
        const seen = outcomes(svc, ownerOf(svc));
        answer(httpMock.expectOne(REFRESH));
        expect(seen).toEqual([expected]);
        expect(logout).toHaveBeenCalledTimes(ends ? 1 : 0);
        // Nothing but a complete, owned success writes the session.
        expect(JSON.parse(localStorage.getItem('user')!).token).toBe('old-access');
        expect(svc.userValue!.refresh).toBe('refresh-123');
      });
    }

    it('bounds each CALLER at REFRESH_WAIT_MS, while the flight continues and a slow success still persists', fakeAsync(() => {
      const svc = makeService();
      const owner = ownerOf(svc)!;
      const seen = outcomes(svc, owner);
      const req = httpMock.expectOne(REFRESH);
      tick(REFRESH_WAIT_MS);
      expect(seen).toEqual([{ kind: 'unavailable', cause: 'timeout' }]);
      expect(req.cancelled).toBeFalse();
      req.flush({ access: 'late-access', refresh: 'late-refresh' });
      // Owned by the same session, so the rotated pair is kept — the server has
      // already blacklisted the old refresh token.
      expect(svc.userValue!.token).toBe('late-access');
      expect(JSON.parse(localStorage.getItem('user')!).refresh).toBe('late-refresh');
      expect(seen.length).toBe(1);
    }));

    it('caps the TRANSPORT at REFRESH_TRANSPORT_CAP_MS from the start; a late joiner does not extend it; the slot is then free', fakeAsync(() => {
      const svc = makeService();
      const owner = ownerOf(svc)!;
      outcomes(svc, owner);
      const first = httpMock.expectOne(REFRESH);
      tick(REFRESH_TRANSPORT_CAP_MS - 5_000);
      const late = outcomes(svc, owner);          // joins the SAME flight
      httpMock.expectNone(REFRESH);
      tick(5_000);
      expect(first.cancelled).toBeTrue();
      expect(late).toEqual([{ kind: 'unavailable', cause: 'timeout' }]);
      // A new request may try again: a fresh flight, a fresh POST.
      outcomes(svc, owner);
      httpMock.expectOne(REFRESH).flush({ access: 'n', refresh: 'm' });
      tick(REFRESH_WAIT_MS);
    }));

    it('supersedes an in-flight renewal when the session is reset, and writes nothing when it lands', () => {
      const svc = makeService();
      const seen = outcomes(svc, ownerOf(svc));
      const req = httpMock.expectOne(REFRESH);
      svc.resetStorage();
      expect(seen).toEqual([{ kind: 'superseded' }]);
      req.flush({ access: 'n', refresh: 'm' });
      expect(localStorage.getItem('user')).toBeNull();
      expect(svc.userValue!.token).toBe('old-access');
    });

    it('supersedes (and leaves storage untouched) when the persisted session was visibly replaced', () => {
      const svc = makeService();
      const seen = outcomes(svc, ownerOf(svc));
      const req = httpMock.expectOne(REFRESH);
      // Another document signed in — even as the same profile. Never adopted.
      const other = JSON.stringify(signedIn({ token: 'tab-a', refresh: 'tab-a-refresh' }));
      localStorage.setItem('user', other);
      req.flush({ access: 'n', refresh: 'm' });
      expect(seen).toEqual([{ kind: 'superseded' }]);
      expect(localStorage.getItem('user')).toBe(other);
      expect(svc.userValue!.token).toBe('old-access');
    });

    it('reports a persistence failure as unavailable, never as a durable renewal', () => {
      const svc = makeService();
      const seen = outcomes(svc, ownerOf(svc));
      const req = httpMock.expectOne(REFRESH);
      const setItem = localStorage.setItem.bind(localStorage);
      spyOn(localStorage, 'setItem').and.callFake((k: string, v: string) => {
        if (k === 'user') throw new Error('QuotaExceededError');
        setItem(k, v);
      });
      req.flush({ access: 'n', refresh: 'm' });
      expect(seen).toEqual([{ kind: 'unavailable', cause: 'persistence' }]);
    });

    it('releases only its own slot: an old flight finishing never clears a newer one', () => {
      const svc = makeService();
      outcomes(svc, ownerOf(svc));
      const old = httpMock.expectOne(REFRESH);
      // Replacement session adopted in this document.
      svc.UpdateUser({ token: 'b1', refresh: 's1' } as any, signedIn({ token: 'b1', refresh: 's1' }) as any);
      const owner2 = ownerOf(svc)!;
      const second = outcomes(svc, owner2);
      const fresh = httpMock.expectOne(REFRESH);
      expect(fresh.request.body).toEqual({ refresh: 's1' });
      old.flush({ access: 'stale', refresh: 'stale' });
      // Still one flight for the new session: another caller joins it.
      const third = outcomes(svc, owner2);
      httpMock.expectNone(REFRESH);
      fresh.flush({ access: 'b2', refresh: 's2' });
      expect(second).toEqual([{ kind: 'renewed', access: 'b2' }]);
      expect(third).toEqual([{ kind: 'renewed', access: 'b2' }]);
      expect(JSON.parse(localStorage.getItem('user')!).refresh).toBe('s2');
    });
  });

  describe('captureRequestOwner', () => {
    const profile = { id: 'u1', restaurant_roles: [] };
    function makeService(): AuthenticationService {
      localStorage.setItem('user', JSON.stringify({ token: 'tok', refresh: 'ref', profile }));
      localStorage.setItem('rest_role', JSON.stringify({ restaurant_id: 'r1' }));
      return new AuthenticationService(TestBed.inject(HttpClient), TestBed.inject(HttpBackend));
    }
    const req = (url: string, headers: Record<string, string> = { Authorization: 'Bearer tok' }) =>
      new HttpRequest('GET', url, null, { headers: new HttpHeaders(headers) });
    const host = new URL(environment.apiUrl);

    it('owns a trusted API request carrying this session\'s credential', () => {
      const svc = makeService();
      expect(svc.captureRequestOwner(req(`${base}/x/`))).toEqual(
        jasmine.objectContaining({ restaurantId: 'r1', token: 'tok' }));
    });

    it('owns nothing that is not provably this session\'s staff request', () => {
      const svc = makeService();
      expect(svc.captureRequestOwner(req(`https://${host.host}.evil.test${host.pathname}/api/v1/x/`)))
        .withContext('lookalike host').toBeNull();
      expect(svc.captureRequestOwner(req(`${host.origin}${host.pathname}x/api/v1/x/`)))
        .withContext('lookalike base path').toBeNull();
      expect(svc.captureRequestOwner(req('https://example.com/api/v1/x/')))
        .withContext('unrelated origin').toBeNull();
      expect(svc.captureRequestOwner(req(`${base}/x/`, { Authorization: 'Bearer someone-else' })))
        .withContext('caller-supplied credential').toBeNull();
      expect(svc.captureRequestOwner(req(`${base}/x/`, {})))
        .withContext('no credential').toBeNull();
      expect(svc.captureRequestOwner(req(`${base}/x/`, { Authorization: 'Bearer tok', 'X-Diner-Session': 's' })))
        .withContext('diner capability request').toBeNull();
    });

    it('owns nothing once a logout has begun', () => {
      const svc = makeService();
      spyOn<any>(svc, 'hardRedirect');
      svc.logout();
      expect(svc.captureRequestOwner(req(`${base}/x/`))).toBeNull();
      httpMock.expectOne(`${base}/users/auth/logout/`).flush({});
    });

    it('a selected-restaurant change — including A→B→A — ends the old request\'s ownership, but the login stays', () => {
      const svc = makeService();
      const owner = svc.captureRequestOwner(req(`${base}/x/`))!;
      svc.setCurrentRestaurantRole({ restaurant_id: 'r2' });
      expect(svc.ownerIsCurrent(owner)).toBeFalse();
      svc.setCurrentRestaurantRole({ restaurant_id: 'r1' });
      expect(svc.ownerIsCurrent(owner)).withContext('A→B→A is a third context').toBeFalse();
      expect(svc.userValue!.token).toBe('tok');
      const fresh = svc.captureRequestOwner(req(`${base}/x/`))!;
      expect(svc.ownerIsCurrent(fresh)).toBeTrue();
    });

    // Codex P2 on #710: the login screen clears storage, so the shell's first
    // detail hydration finds no stored detail. That is not a restaurant change
    // when it hydrates the restaurant the membership already selects.
    it('the FIRST detail hydration of the already-selected restaurant is not a context change', () => {
      const svc = makeService();
      expect(localStorage.getItem('current_resta')).toBeNull();
      const owner = svc.captureRequestOwner(req(`${base}/x/`))!;
      svc.setCurrentRestaurant({ id: 'r1', name: 'Selected' });
      expect(svc.ownerIsCurrent(owner)).toBeTrue();
    });

    it('CONTROL: a first detail hydration of a DIFFERENT restaurant than the one selected still ends ownership', () => {
      const svc = makeService();
      const owner = svc.captureRequestOwner(req(`${base}/x/`))!;
      svc.setCurrentRestaurant({ id: 'r2', name: 'Other' });
      expect(svc.ownerIsCurrent(owner)).toBeFalse();
    });

    it('re-storing the SAME restaurant (refreshed detail, same membership) is not a context change', () => {
      const svc = makeService();
      svc.setCurrentRestaurant({ id: 'r1', name: 'Old' });
      const owner = svc.captureRequestOwner(req(`${base}/x/`))!;
      svc.setCurrentRestaurant({ id: 'r1', name: 'Renamed' });
      svc.setCurrentRestaurantRole({ restaurant_id: 'r1', roles: ['owner'] });
      svc.updateProfile({ ...profile, first_name: 'X' });
      expect(svc.ownerIsCurrent(owner)).toBeTrue();
    });
  });

  describe('logout fences (D09)', () => {
    const LOGOUT = `${base}/users/auth/logout/`;
    const u = (token: string, refresh: string) => ({ token, refresh, profile: { id: 'u1', restaurant_roles: [] } });
    function makeService() {
      localStorage.setItem('user', JSON.stringify(u('a1', 'r1')));
      const svc = new AuthenticationService(TestBed.inject(HttpClient), TestBed.inject(HttpBackend));
      const redirect = spyOn<any>(svc, 'hardRedirect');
      return { svc, redirect };
    }

    it('is idempotent per outgoing session: one revoke, one redirect', () => {
      const { svc, redirect } = makeService();
      svc.logout();
      svc.logout();
      svc.logoutDueToInactivity();
      httpMock.expectOne(LOGOUT).flush({});
      expect(redirect.calls.allArgs()).toEqual([['/login']]);
    });

    it('lets the NEXT adopted session log out too', () => {
      const { svc } = makeService();
      svc.logout(true);
      httpMock.expectOne(LOGOUT).flush({});
      svc.UpdateUser({ token: 'b1', refresh: 's1' } as any, u('b1', 's1') as any);
      svc.logout(true);
      const second = httpMock.expectOne(LOGOUT);
      expect(second.request.body).toEqual({ refresh: 's1' });
      second.flush({});
      expect(svc.userValue).toBeNull();
    });

    it('a revoke that completes after a replacement was adopted leaves the successor alone', () => {
      const { svc, redirect } = makeService();
      svc.logout();
      const revoke = httpMock.expectOne(LOGOUT);
      const successor = u('b1', 's1');
      svc.installAuthenticatedSessionAndReload(successor as any, { restaurant_id: 'r9' } as any, '/dashboard');
      revoke.flush({});
      expect(JSON.parse(localStorage.getItem('user')!).refresh).toBe('s1');
      expect(svc.userValue!.token).toBe('b1');
      expect(redirect.calls.allArgs()).toEqual([['/dashboard', 'replace']]);
    });

    it('does not destroy a VISIBLY replaced persisted session (non-atomic, narrows the race only)', () => {
      const { svc } = makeService();
      svc.logout(true);
      const other = JSON.stringify(u('tab-b', 'tab-b-refresh'));
      localStorage.setItem('user', other);
      httpMock.expectOne(LOGOUT).flush({});
      expect(localStorage.getItem('user')).toBe(other);
      expect(svc.userValue).toBeNull();
    });
  });

  describe('UpdateUser', () => {
    it('should merge OTP tokens with login response and persist', () => {
      const loginResponse: any = {
        token: 'old', refresh: 'old-r',
        profile: { id: '1', first_name: 'A', last_name: 'B', email: '', roles: [], phone_number: '', country: '', prompt_password_change: false, other_names: '', restaurant_roles: [] },
        require_otp: true, prompt_password_change: false
      };

      const result = service.UpdateUser({ valid: true, token: 'new-token', refresh: 'new-refresh' }, loginResponse);
      expect(result.token).toBe('new-token');
      expect(result.refresh).toBe('new-refresh');
      expect(result.profile.id).toBe('1');

      const stored = JSON.parse(localStorage.getItem('user')!);
      expect(stored.token).toBe('new-token');
      expect(service.userValue).toBeTruthy();
      expect(service.userValue!.token).toBe('new-token');
    });

    it('should fall back to userValue when no loginResponse provided', () => {
      localStorage.setItem('user', JSON.stringify({
        token: 'old', refresh: 'old-r',
        profile: { id: '1', first_name: 'A', last_name: 'B', email: '', roles: [], phone_number: '', country: '', prompt_password_change: false, other_names: '', restaurant_roles: [] }
      }));
      const svc = new AuthenticationService(TestBed.inject(HttpClient), TestBed.inject(HttpBackend));

      const result = svc.UpdateUser({ valid: true, token: 'new-token', refresh: 'new-refresh' });
      expect(result!.token).toBe('new-token');
    });

    it('should return null when no user is available', () => {
      const result = service.UpdateUser({ valid: true, token: 'tok', refresh: 'ref' });
      expect(result).toBeNull();
    });
  });

  describe('installAuthenticatedSessionAndReload', () => {
    // The owner-claim flow's session seat. Everything asserted here is about it
    // being ATOMIC, MINTING NOTHING, and ending in a FULL PAGE LOAD — the last of
    // which is the whole reason the operation is named the way it is.

    const membership = {
      restaurant_id: 'claimed-1',
      restaurant: 'Baba House',
      roles: ['owner'],
      permissions: { dashboard: true, menu: true },
    };

    const session: any = {
      token: 'claim-access',
      refresh: 'claim-refresh',
      profile: {
        id: 'owner-1', first_name: 'Asha', last_name: 'K', email: 'a@test.ug',
        country: 'UG', roles: [], other_names: null, phone_number: '256700000000',
        prompt_password_change: false, restaurant_roles: [membership],
      },
      require_otp: false,
      prompt_password_change: false,
    };

    let redirectSpy: jasmine.Spy;

    beforeEach(() => {
      // `hardRedirect` is the `window.location.href = url` boundary. Spying on it is
      // what lets this run at all: executing it for real would unload the Karma host
      // page — which is precisely the property the production code depends on, since
      // that unload is what destroys the Angular injector and every
      // providedIn:'root' service along with it.
      redirectSpy = spyOn<any>(service, 'hardRedirect');
    });

    it('persists the COMPLETE LoginResponse and publishes it through userSubject', (done) => {
      service.installAuthenticatedSessionAndReload(session, membership as any, '/dashboard');

      expect(JSON.parse(localStorage.getItem('user')!)).toEqual(session);
      expect(service.userValue).toEqual(session);
      service.user.subscribe((published) => {
        expect(published?.token).toBe('claim-access');
        expect(published?.profile.restaurant_roles.length).toBe(1);
        done();
      });
    });

    it('persists the given membership as the selected rest_role', () => {
      service.installAuthenticatedSessionAndReload(session, membership as any, '/dashboard');
      expect(JSON.parse(localStorage.getItem('rest_role')!)).toEqual(membership);
      expect(service.currentRestaurantRole).toEqual(membership as any);
    });

    it('clears a PREVIOUS operator\'s selection and persisted nav state first', () => {
      // Ordering matters: without the resetStorage() the old operator's
      // current_resta and per-module nav state would sit underneath the new
      // principal and scope the portal to the wrong restaurant.
      localStorage.setItem('current_resta', JSON.stringify({ id: 'old-restaurant' }));
      localStorage.setItem('rest_role', JSON.stringify({ restaurant_id: 'old-restaurant' }));
      localStorage.setItem('[dinify]tables.activeArea:old-restaurant', '"area-9"');

      service.installAuthenticatedSessionAndReload(session, membership as any, '/dashboard');

      expect(localStorage.getItem('current_resta')).toBeNull();
      expect(localStorage.getItem('[dinify]tables.activeArea:old-restaurant')).toBeNull();
      expect(JSON.parse(localStorage.getItem('rest_role')!).restaurant_id).toBe('claimed-1');
    });

    it('HARD-navigates to the landing path it was given, REPLACING the history entry', () => {
      // A full page load, never a router navigation: replacing one operator with
      // another has to destroy the root services holding the outgoing tenant's data.
      //
      // And it must REPLACE rather than push. Destroying the document achieves
      // nothing if Back can hand it back: the browser's back-forward cache restores
      // a whole JS heap rather than re-executing the page, and the pre-claim
      // document is a hybrid — this service has already published the INCOMING
      // principal while every other root service still holds the OUTGOING tenant's
      // data. `location.replace` leaves no history entry pointing at it.
      service.installAuthenticatedSessionAndReload(session, membership as any, '/dining-tables');
      expect(redirectSpy).toHaveBeenCalledOnceWith('/dining-tables', 'replace');
    });

    it('does not re-derive the target — it reloads onto exactly the path passed in', () => {
      // The caller resolves the landing from the membership's permissions BEFORE the
      // install. If this method recomputed it from storage the two could disagree.
      service.installAuthenticatedSessionAndReload(
        session,
        { ...membership, permissions: { dashboard: false, menu: true } } as any,
        '/some/caller/resolved/path',
      );
      expect(redirectSpy).toHaveBeenCalledOnceWith('/some/caller/resolved/path', 'replace');
    });

    it('leaves LOGOUT on the default push navigation — its history behaviour is unchanged', () => {
      // Scope guard. Logout's outgoing document is internally consistent (one
      // operator's services beside a userSubject this service set to null), so it
      // does not need the replace treatment and this change does not give it one.
      redirectSpy.and.stub();
      service.logout(false);
      // Called with the URL only — no mode argument, so hardRedirect's 'push'
      // default applies exactly as before.
      expect(redirectSpy).toHaveBeenCalledOnceWith('/login');
    });

    it('completes every write BEFORE triggering the reload', () => {
      // If the reload fired first, the restarting application could race the writes
      // and boot on the OLD principal — or on none at all.
      const seen: Record<string, string | null> = {};
      redirectSpy.and.callFake(() => {
        seen['user'] = localStorage.getItem('user');
        seen['rest_role'] = localStorage.getItem('rest_role');
      });

      service.installAuthenticatedSessionAndReload(session, membership as any, '/dashboard');

      expect(redirectSpy).toHaveBeenCalled();
      expect(JSON.parse(seen['user']!)).toEqual(session);
      expect(JSON.parse(seen['rest_role']!)).toEqual(membership);
    });

    it('issues NO http request — it mints nothing and calls neither login nor verify-otp', () => {
      service.installAuthenticatedSessionAndReload(session, membership as any, '/dashboard');
      // httpMock.verify() in afterEach would fail on any stray request; this is the
      // explicit statement of the same fact.
      httpMock.expectNone(`${base}/users/auth/login/`);
      httpMock.expectNone(`${base}/users/auth/verify-otp/`);
      httpMock.expectNone(`${base}/users/auth/token/refresh/`);
      // In particular it does NOT revoke anything: this replaces a principal, it is
      // not a logout.
      httpMock.expectNone(`${base}/users/auth/logout/`);
    });

    it('drives the RBAC read-throughs off the newly selected membership', () => {
      service.installAuthenticatedSessionAndReload(
        session,
        { ...membership, permissions: { dashboard: false, menu: true } } as any,
        '/menu',
      );
      expect(service.canAccess('dashboard')).toBeFalse();
      expect(service.canAccess('menu')).toBeTrue();
      expect(service.firstAccessibleRoute()).toBe('/menu');
    });
  });

  describe('setCurrentRestaurantRole / setCurrentRestaurant', () => {
    it('should store restaurant role in localStorage', () => {
      service.setCurrentRestaurantRole({ restaurant_id: 'r1', restaurant: 'Rest1', roles: ['manager'] });
      expect(JSON.parse(localStorage.getItem('rest_role')!).restaurant_id).toBe('r1');
    });

    it('should store current restaurant in localStorage', () => {
      service.setCurrentRestaurant({ id: 'r1', name: 'TestRest' });
      expect(JSON.parse(localStorage.getItem('current_resta')!).id).toBe('r1');
    });
  });
});
