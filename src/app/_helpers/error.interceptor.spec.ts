import { TestBed } from '@angular/core/testing';
import { HTTP_INTERCEPTORS, HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ErrorInterceptor } from './error.interceptor';
import { AuthenticationService } from '../_services/authentication.service';
import { ToastService } from '../_shared/ui/toast/toast.service';
import { ConnectivityService } from '../_services/connectivity.service';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';

describe('ErrorInterceptor', () => {
  let httpClient: HttpClient;
  let httpMock: HttpTestingController;
  let authService: jasmine.SpyObj<AuthenticationService>;
  let toast: jasmine.SpyObj<ToastService>;
  let routerStub: { url: string };
  let connectivityStub: { isOffline: () => boolean };

  const mockUser = {
    token: 'test-token',
    refresh: 'test-refresh',
    profile: { id: '1', first_name: 'A', last_name: 'B', email: '', roles: [], phone_number: '', other_names: '', restaurant_roles: [] },
    require_otp: false,
    prompt_password_change: false
  };

  beforeEach(() => {
    const authSpy = jasmine.createSpyObj('AuthenticationService', ['logout', 'attemptTokenRefresh'], {
      userValue: null
    });
    const toastSpy = jasmine.createSpyObj('ToastService', ['success', 'error', 'warning', 'info', 'clear', 'dismiss']);
    // Mutable stubs: the interceptor reads router.url + connectivity.isOffline() at
    // catch time, so tests set these before triggering the error. Default to a
    // non-banner route that is online, so the offline toast fires unless overridden.
    routerStub = { url: '/login' };
    connectivityStub = { isOffline: () => false };

    TestBed.configureTestingModule({
    imports: [],
    providers: [
        { provide: ToastService, useValue: toastSpy },
        { provide: AuthenticationService, useValue: authSpy },
        { provide: Router, useValue: routerStub },
        { provide: ConnectivityService, useValue: connectivityStub },
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting()
    ]
});

    httpClient = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    authService = TestBed.inject(AuthenticationService) as jasmine.SpyObj<AuthenticationService>;
    toast = TestBed.inject(ToastService) as jasmine.SpyObj<ToastService>;
  });

  afterEach(() => {
    httpMock.verify();
  });

  function setUser(user: any) {
    Object.defineProperty(authService, 'userValue', { get: () => user, configurable: true });
  }

  describe('network errors (status 0)', () => {
    it('shows the offline toast and throws for a non-diner request off the banner shells', (done) => {
      routerStub.url = '/login';
      httpClient.get('/api/test').subscribe({
        error: (err) => {
          expect(err).toBe('no network');
          expect(toast.error).toHaveBeenCalledWith("You're offline — check your connection.");
          done();
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    });

    it('suppresses the toast for a diner request but still throws "no network"', (done) => {
      // The diner owns its offline UX (amber strip + inline retry), so the global
      // toast must not also fire for its journey/order endpoints.
      httpClient.get('/api/v1/orders/journey/show-menu/').subscribe({
        error: (err) => {
          expect(err).toBe('no network');
          expect(toast.error).not.toHaveBeenCalled();
          done();
        }
      });

      const req = httpMock.expectOne('/api/v1/orders/journey/show-menu/');
      req.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    });

    it('suppresses the toast on the restaurant shell while the browser reports offline', (done) => {
      // OfflineBannerComponent already shows on /rest-app, so the toast would double up.
      routerStub.url = '/rest-app/dashboard';
      connectivityStub.isOffline = () => true;

      httpClient.get('/api/test').subscribe({
        error: (err) => {
          expect(err).toBe('no network');
          expect(toast.error).not.toHaveBeenCalled();
          done();
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    });

    it('suppresses the toast on the admin shell while the browser reports offline', (done) => {
      routerStub.url = '/mgt-app/dashboard';
      connectivityStub.isOffline = () => true;

      httpClient.get('/api/test').subscribe({
        error: (err) => {
          expect(err).toBe('no network');
          expect(toast.error).not.toHaveBeenCalled();
          done();
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    });

    it('still shows the toast on a banner shell for a status-0 failure while online (server down)', (done) => {
      // navigator.onLine is true → no banner is showing, so the toast is the only signal.
      routerStub.url = '/rest-app/dashboard';
      connectivityStub.isOffline = () => false;

      httpClient.get('/api/test').subscribe({
        error: (err) => {
          expect(err).toBe('no network');
          expect(toast.error).toHaveBeenCalledWith("You're offline — check your connection.");
          done();
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    });

    it('still shows the toast on the login screen while offline (no banner there)', (done) => {
      routerStub.url = '/login';
      connectivityStub.isOffline = () => true;

      httpClient.get('/api/test').subscribe({
        error: (err) => {
          expect(err).toBe('no network');
          expect(toast.error).toHaveBeenCalledWith("You're offline — check your connection.");
          done();
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    });
  });

  describe('401 handling', () => {
    it('should call attemptTokenRefresh and logout when refresh returns null', (done) => {
      setUser(mockUser);
      authService.attemptTokenRefresh.and.returnValue(of(null));

      httpClient.get('/api/test').subscribe({
        error: (err) => {
          expect(authService.attemptTokenRefresh).toHaveBeenCalled();
          expect(authService.logout).toHaveBeenCalled();
          expect(err).toBe('Session expired');
          done();
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    });

    it('should not attempt refresh when user is not logged in', (done) => {
      setUser(null);

      httpClient.get('/api/test').subscribe({
        error: () => {
          expect(authService.attemptTokenRefresh).not.toHaveBeenCalled();
          expect(authService.logout).not.toHaveBeenCalled();
          done();
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    });

    it('should retry the request with new token when refresh succeeds', (done) => {
      setUser(mockUser);
      authService.attemptTokenRefresh.and.returnValue(of('new-token'));

      httpClient.get('/api/test').subscribe({
        next: (res: any) => {
          expect(res.data).toBe('success');
          expect(authService.logout).not.toHaveBeenCalled();
          done();
        }
      });

      // First request returns 401
      const req1 = httpMock.expectOne('/api/test');
      req1.flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

      // Retried request with new token should succeed
      const req2 = httpMock.expectOne('/api/test');
      expect(req2.request.headers.get('Authorization')).toBe('Bearer new-token');
      req2.flush({ data: 'success' });
    });

    it('should logout when attemptTokenRefresh throws an error', (done) => {
      setUser(mockUser);
      authService.attemptTokenRefresh.and.returnValue(throwError(() => 'refresh failed'));

      httpClient.get('/api/test').subscribe({
        error: (err) => {
          expect(authService.logout).toHaveBeenCalled();
          expect(err).toBe('Session expired');
          done();
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    });
  });

  describe('403 handling (module/tenant denial — graceful, no logout)', () => {
    it('does NOT log out on 403 when logged in; surfaces the backend message and rethrows', (done) => {
      // 403 = authorized-failure (lacks the module/resource), not a dead session.
      // The user must stay signed in; only 401 (via handle401) may log out.
      setUser(mockUser);

      httpClient.get('/api/test').subscribe({
        error: (err) => {
          expect(authService.logout).not.toHaveBeenCalled();
          expect(authService.attemptTokenRefresh).not.toHaveBeenCalled();
          expect(toast.error).toHaveBeenCalledWith('You cannot access this');
          expect(err).toBe('You cannot access this');
          done();
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.flush({ message: 'You cannot access this' }, { status: 403, statusText: 'Forbidden' });
    });

    it('falls back to a friendly message when the 403 carries no backend detail', (done) => {
      setUser(mockUser);

      httpClient.get('/api/test').subscribe({
        error: (err) => {
          expect(authService.logout).not.toHaveBeenCalled();
          expect(toast.error).toHaveBeenCalledWith("You don't have permission to do that.");
          expect(err).toBe("You don't have permission to do that.");
          done();
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.flush({}, { status: 403, statusText: 'Forbidden' });
    });

    it('does not log out on 403 when user is not logged in', (done) => {
      setUser(null);

      httpClient.get('/api/test').subscribe({
        error: () => {
          expect(authService.logout).not.toHaveBeenCalled();
          done();
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.flush({ message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });
    });
  });

  describe('429 rate limiting', () => {
    it('should return rate_limited error and show a warning toast', (done) => {
      httpClient.get('/api/test').subscribe({
        error: (err) => {
          expect(err).toBe('rate_limited');
          expect(toast.warning).toHaveBeenCalledWith(jasmine.stringMatching(/Too many attempts/));
          expect(authService.logout).not.toHaveBeenCalled();
          done();
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.flush({}, { status: 429, statusText: 'Too Many Requests' });
    });

    it('should use backend message when provided', (done) => {
      httpClient.get('/api/test').subscribe({
        error: (err) => {
          expect(err).toBe('rate_limited');
          expect(toast.warning).toHaveBeenCalledWith('Please wait 60 seconds');
          done();
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.flush({ message: 'Please wait 60 seconds' }, { status: 429, statusText: 'Too Many Requests' });
    });
  });

  describe('other errors', () => {
    it('should show an error toast for 500 errors and never log out (change is 403-scoped)', (done) => {
      setUser(mockUser);
      httpClient.get('/api/test').subscribe({
        error: () => {
          expect(toast.error).toHaveBeenCalledWith('Server error');
          expect(authService.logout).not.toHaveBeenCalled();
          done();
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.flush({ message: 'Server error' }, { status: 500, statusText: 'Internal Server Error' });
    });

    it('should use statusText when error message is not available', (done) => {
      httpClient.get('/api/test').subscribe({
        error: (err) => {
          expect(err).toBe('Bad Request');
          expect(toast.error).toHaveBeenCalledWith('Bad Request');
          done();
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.flush({}, { status: 400, statusText: 'Bad Request' });
    });
  });

  describe('toast behaviour', () => {
    it('does not clear existing toasts on a new request', (done) => {
      httpClient.get('/api/test').subscribe({
        next: () => {
          expect(toast.clear).not.toHaveBeenCalled();
          done();
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.flush({});
    });

    it('forwards the structured body (not a string) and shows no toast for the orders/initiate 400 ongoing-order block', (done) => {
      httpClient.post('/api/v2/orders/initiate/', {}).subscribe({
        error: (err) => {
          // The basket reads err.data.order_id to latch its blocked state, so the
          // interceptor must rethrow the structured body untouched and must NOT toast it.
          expect(err).toEqual(
            jasmine.objectContaining({ data: jasmine.objectContaining({ order_id: 'existing-123' }) })
          );
          expect(toast.error).not.toHaveBeenCalled();
          done();
        }
      });

      const req = httpMock.expectOne('/api/v2/orders/initiate/');
      req.flush(
        { status: 400, message: 'The table has an ongoing order', data: { order_id: 'existing-123' } },
        { status: 400, statusText: 'Bad Request' }
      );
    });
  });

  describe('concurrent 401 handling', () => {
    it('should retry failed request with refreshed token', (done) => {
      setUser(mockUser);
      authService.attemptTokenRefresh.and.returnValue(of('refreshed-token'));

      httpClient.get('/api/test').subscribe({
        next: (res: any) => {
          expect(res.ok).toBe(true);
          expect(authService.logout).not.toHaveBeenCalled();
          done();
        }
      });

      // First attempt returns 401
      const req1 = httpMock.expectOne('/api/test');
      req1.flush({}, { status: 401, statusText: 'Unauthorized' });

      // Retry with refreshed token
      const retry = httpMock.expectOne('/api/test');
      expect(retry.request.headers.get('Authorization')).toBe('Bearer refreshed-token');
      retry.flush({ ok: true });
    });
  });
});
