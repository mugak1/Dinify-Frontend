import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthenticationService } from './authentication.service';
import { environment } from 'src/environments/environment';
import { HttpBackend, HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

describe('AuthenticationService', () => {
  let service: AuthenticationService;
  let httpMock: HttpTestingController;
  let router: jasmine.SpyObj<Router>;
  const base = `${environment.apiUrl}/api/${environment.version}`;

  beforeEach(() => {
    localStorage.clear();

    const routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    TestBed.configureTestingModule({
    imports: [],
    providers: [
        AuthenticationService,
        { provide: Router, useValue: routerSpy },
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting()
    ]
});

    service = TestBed.inject(AuthenticationService);
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router) as jasmine.SpyObj<Router>;
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
      const stored = { token: 'abc', refresh: 'def', profile: { id: '1', first_name: 'A', last_name: 'B', email: '', roles: [], phone_number: '', other_names: '', restaurant_roles: [] }, require_otp: false, prompt_password_change: false };
      localStorage.setItem('user', JSON.stringify(stored));

      // Re-create service to pick up localStorage
      const svc = new AuthenticationService(router, TestBed.inject(HttpClient), TestBed.inject(HttpBackend));
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
          profile: { id: '1', first_name: 'Test', last_name: 'User', email: 'test@test.com', roles: ['dinify_admin'], phone_number: '123', other_names: '', restaurant_roles: [] },
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
      req.flush({ data: { token: 't', refresh: 'r', profile: { id: '1', first_name: '', last_name: '', email: '', roles: [], phone_number: '', other_names: '', restaurant_roles: [] }, require_otp: false, prompt_password_change: false } });
    });

    it('should NOT store user in localStorage when require_otp is true', () => {
      const mockResponse = {
        data: {
          token: 'temp-token',
          refresh: 'temp-refresh',
          profile: { id: '1', first_name: 'Test', last_name: 'User', email: '', roles: [], phone_number: '', other_names: '', restaurant_roles: [] },
          require_otp: true,
          prompt_password_change: false
        }
      };

      service.login('user', 'pass').subscribe((res) => {
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
          profile: { id: '1', first_name: 'Test', last_name: 'User', email: '', roles: [], phone_number: '', other_names: '', restaurant_roles: [] },
          require_otp: false,
          prompt_password_change: true
        }
      };

      service.login('user', 'pass').subscribe((res) => {
        expect(localStorage.getItem('user')).toBeNull();
        expect(service.userValue).toBeNull();
      });

      const req = httpMock.expectOne(`${base}/users/auth/login/`);
      req.flush(mockResponse);
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
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('should not redirect when no_redirect is true', () => {
      service.logout(true);
      expect(redirectSpy).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();
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

  describe('attemptTokenRefresh', () => {
    const userWithRefresh = {
      token: 'old-access',
      refresh: 'refresh-123',
      profile: { id: '1', first_name: '', last_name: '', email: '', roles: [], phone_number: '', other_names: '', restaurant_roles: [] },
      require_otp: false,
      prompt_password_change: false
    };

    it('should return null when no user is logged in', (done) => {
      service.attemptTokenRefresh().subscribe((result) => {
        expect(result).toBeNull();
        done();
      });
      httpMock.expectNone(`${base}/users/auth/token/refresh/`);
    });

    it('should return null when user has no refresh token', (done) => {
      localStorage.setItem('user', JSON.stringify({ token: 'abc', profile: { id: '1', first_name: '', last_name: '', email: '', roles: [], phone_number: '', other_names: '', restaurant_roles: [] } }));

      const svc = new AuthenticationService(router, TestBed.inject(HttpClient), TestBed.inject(HttpBackend));
      svc.attemptTokenRefresh().subscribe((result) => {
        expect(result).toBeNull();
        done();
      });
      httpMock.expectNone(`${base}/users/auth/token/refresh/`);
    });

    it('should POST refresh token and resolve to new access token from native SimpleJWT shape', (done) => {
      localStorage.setItem('user', JSON.stringify(userWithRefresh));

      const svc = new AuthenticationService(router, TestBed.inject(HttpClient), TestBed.inject(HttpBackend));
      svc.attemptTokenRefresh().subscribe((result) => {
        expect(result).toBe('new-access');
        expect(svc.userValue!.token).toBe('new-access');
        // Refresh token must be preserved (ROTATE_REFRESH_TOKENS=False).
        expect(svc.userValue!.refresh).toBe('refresh-123');
        const stored = JSON.parse(localStorage.getItem('user')!);
        expect(stored.token).toBe('new-access');
        expect(stored.refresh).toBe('refresh-123');
        done();
      });

      const req = httpMock.expectOne(`${base}/users/auth/token/refresh/`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ refresh: 'refresh-123' });
      req.flush({ access: 'new-access' });
    });

    it('should persist the rotated refresh token when the response includes one (ROTATE_REFRESH_TOKENS=True)', (done) => {
      localStorage.setItem('user', JSON.stringify(userWithRefresh));

      const svc = new AuthenticationService(router, TestBed.inject(HttpClient), TestBed.inject(HttpBackend));
      svc.attemptTokenRefresh().subscribe((result) => {
        expect(result).toBe('new-access');
        expect(svc.userValue!.token).toBe('new-access');
        expect(svc.userValue!.refresh).toBe('new-refresh');
        const stored = JSON.parse(localStorage.getItem('user')!);
        expect(stored.token).toBe('new-access');
        expect(stored.refresh).toBe('new-refresh');
        done();
      });

      const req = httpMock.expectOne(`${base}/users/auth/token/refresh/`);
      req.flush({ access: 'new-access', refresh: 'new-refresh' });
    });

    it('should return null (and NOT call logout) when refresh endpoint returns 401', (done) => {
      localStorage.setItem('user', JSON.stringify(userWithRefresh));

      const svc = new AuthenticationService(router, TestBed.inject(HttpClient), TestBed.inject(HttpBackend));
      const logoutSpy = spyOn(svc, 'logout');

      svc.attemptTokenRefresh().subscribe((result) => {
        expect(result).toBeNull();
        // Architectural contract: the service must not unilaterally log out.
        // ErrorInterceptor owns that decision based on the null return value.
        expect(logoutSpy).not.toHaveBeenCalled();
        // The stored user must remain untouched on failure so the interceptor
        // can still observe userValue when it decides to log out.
        expect(svc.userValue!.token).toBe('old-access');
        done();
      });

      const req = httpMock.expectOne(`${base}/users/auth/token/refresh/`);
      req.flush({ detail: 'Token is invalid or expired', code: 'token_not_valid' }, { status: 401, statusText: 'Unauthorized' });
    });

    it('should return null when response is missing the access field', (done) => {
      localStorage.setItem('user', JSON.stringify(userWithRefresh));

      const svc = new AuthenticationService(router, TestBed.inject(HttpClient), TestBed.inject(HttpBackend));
      svc.attemptTokenRefresh().subscribe((result) => {
        expect(result).toBeNull();
        done();
      });

      const req = httpMock.expectOne(`${base}/users/auth/token/refresh/`);
      req.flush({});
    });
  });

  describe('UpdateUser', () => {
    it('should merge OTP tokens with login response and persist', () => {
      const loginResponse: any = {
        token: 'old', refresh: 'old-r',
        profile: { id: '1', first_name: 'A', last_name: 'B', email: '', roles: [], phone_number: '', other_names: '', restaurant_roles: [] },
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
        profile: { id: '1', first_name: 'A', last_name: 'B', email: '', roles: [], phone_number: '', other_names: '', restaurant_roles: [] }
      }));
      const svc = new AuthenticationService(router, TestBed.inject(HttpClient), TestBed.inject(HttpBackend));

      const result = svc.UpdateUser({ valid: true, token: 'new-token', refresh: 'new-refresh' });
      expect(result!.token).toBe('new-token');
    });

    it('should return null when no user is available', () => {
      const result = service.UpdateUser({ valid: true, token: 'tok', refresh: 'ref' });
      expect(result).toBeNull();
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
