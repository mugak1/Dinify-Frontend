import { TestBed } from '@angular/core/testing';
import { HTTP_INTERCEPTORS, HttpClient, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
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
    profile: { id: '1', first_name: 'A', last_name: 'B', email: '', roles: [], phone_number: '', country: '', prompt_password_change: false, other_names: '', restaurant_roles: [] },
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
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
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
      // OfflineBannerComponent already shows on the portal shell (now at the URL
      // root), so the toast would double up.
      routerStub.url = '/dashboard';
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
      routerStub.url = '/dashboard';
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

    it('still shows the toast on the Kitchen board while offline (no banner there)', (done) => {
      // /kitchen is a first segment on the NON_BANNER_SHELL_ROOTS deny-list: the
      // board renders no OfflineBannerComponent, so the toast stays its only signal.
      routerStub.url = '/kitchen';
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

    it('still shows the toast on the owner-claim screen while offline (no banner there)', (done) => {
      // /owner-claim is on the NON_BANNER_SHELL_ROOTS deny-list: it renders the
      // AuthShell, not the portal, so no OfflineBannerComponent owns the signal.
      // Without the deny-list entry the interceptor would classify it as a banner
      // shell and swallow the toast, leaving a failed claim silent.
      routerStub.url = '/owner-claim';
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

    it('still shows the toast at the bare root "/" while offline (mid-navigation: no shell rendered yet)', (done) => {
      // router.url is '/' until the first navigation commits — a request fired
      // from a guard or the diner scan mid-flight must keep its offline toast.
      routerStub.url = '/';
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

    it('still shows the toast for an empty router.url while offline (same bare-root guard)', (done) => {
      routerStub.url = '';
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

    it('treats a deep portal URL with query params as the banner shell (suppressed)', (done) => {
      // First-segment parsing must survive query strings — /settings/team?tab=roles
      // is still the portal shell, so the banner owns the offline signal.
      routerStub.url = '/settings/team?tab=roles';
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

  describe('checkout recovery reads (D04/D)', () => {
    // The recovery read resolves a persisted INTENT KEY. Its 404 is the ONLY
    // reply meaning "no such order on this table", and that is what lets the
    // coordinator drop a dead key rather than retain it forever. Collapsed to
    // a string it became indistinguishable from a timeout, so a definitive
    // absence was classified "the server could not be asked" — the one
    // distinction the mechanism turns on. (Codex P2 on PR #663.)
    const RECOVERY_URL =
      '/api/v1/orders/journey/order-details/?intent=abc-123';
    const ORDINARY_URL = '/api/v1/orders/journey/order-details/?order=o1';

    it('forwards the 404 with its status intact', () => {
      let caught: any = null;
      httpClient.get(RECOVERY_URL).subscribe({ error: (e) => (caught = e) });
      httpMock.expectOne(RECOVERY_URL).flush(
        { status: 404, message: 'Order not found' },
        { status: 404, statusText: 'Not Found' },
      );
      expect(caught?.status).toBe(404);
    });

    it('does not toast it — nobody asked for that read', () => {
      // It runs by itself on a basket page load, so a toast reports a
      // background enquiry as a failure the diner did nothing to cause, and
      // repeats on every load while the attempt is unresolved.
      httpClient.get(RECOVERY_URL).subscribe({ error: () => {} });
      httpMock.expectOne(RECOVERY_URL).flush(
        { status: 404, message: 'Order not found' },
        { status: 404, statusText: 'Not Found' },
      );
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('forwards a non-404 failure structurally too, so it reads as unknown', () => {
      // An older backend that does not know `intent` answers 400 "Please
      // provide the order id". That is NOT absence, and must not be
      // classified as one.
      let caught: any = null;
      httpClient.get(RECOVERY_URL).subscribe({ error: (e) => (caught = e) });
      httpMock.expectOne(RECOVERY_URL).flush(
        { status: 400, message: 'Please provide the order id' },
        { status: 400, statusText: 'Bad Request' },
      );
      expect(caught?.status).toBe(400);
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('leaves the ordinary order-id read exactly as it was', () => {
      // The carve-out is scoped to the `intent=` form; every other read keeps
      // its string + toast behaviour.
      let caught: any = null;
      httpClient.get(ORDINARY_URL).subscribe({ error: (e) => (caught = e) });
      httpMock.expectOne(ORDINARY_URL).flush(
        { status: 404, message: 'Order not found' },
        { status: 404, statusText: 'Not Found' },
      );
      expect(caught).toBe('Order not found');
      expect(toast.error).toHaveBeenCalledWith('Order not found');
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

    // An acceptance refusal carries a machine-readable `reason` beside the
    // sentence. The basket branches on that code to re-review the order; making
    // it match on the sentence instead is exactly the brittleness the code
    // exists to remove. It is not toasted here — the component renders it
    // inline at the checkout footer, so the diner sees one message, not two.
    it('forwards the structured body and shows no toast for an orders/submit 400 acceptance refusal', (done) => {
      httpClient.put('/api/v1/orders/submit/', {}).subscribe({
        error: (err) => {
          expect(err).toEqual(
            jasmine.objectContaining({ reason: 'quote_ref_stale', message: 'Your order total changed.' })
          );
          expect(toast.error).not.toHaveBeenCalled();
          done();
        }
      });

      const req = httpMock.expectOne('/api/v1/orders/submit/');
      req.flush(
        { status: 400, message: 'Your order total changed.', reason: 'quote_ref_stale' },
        { status: 400, statusText: 'Bad Request' }
      );
    });

    it('still flattens an orders/submit 400 that carries no reason code', (done) => {
      httpClient.put('/api/v1/orders/submit/', {}).subscribe({
        error: (err) => {
          expect(err).toBe('Something went wrong');
          expect(toast.error).toHaveBeenCalledWith('Something went wrong');
          done();
        }
      });

      const req = httpMock.expectOne('/api/v1/orders/submit/');
      req.flush(
        { status: 400, message: 'Something went wrong' },
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

  // ── D05: kitchen command refusals keep their status, reason and state ────
  describe('kitchen order commands', () => {
    const conflictBody = {
      status: 409, message: 'This ticket changed since you loaded it.',
      reason: 'kitchen_precondition_stale',
      data: {
        id: 'o1', fulfilment_revision: 7, order_status: 'pending',
        fulfilment_status: 'ready', priority: false, served_at: null,
        cancelled_at: null, cancellation_reason: null,
      },
    };

    function expectForwarded(url: string): void {
      let caught: any;
      httpClient.put(url, {}).subscribe({ error: err => (caught = err) });
      httpMock.expectOne(url).flush(conflictBody, {
        status: 409, statusText: 'Conflict',
      });
      // THE HttpErrorResponse ITSELF, not a flattened string: the service needs
      // the STATUS to tell a refusal from a lost answer, and the projection to
      // show what the ticket actually is.
      expect(caught?.status).toBe(409);
      expect(caught?.error?.reason).toBe('kitchen_precondition_stale');
      expect(caught?.error?.data?.fulfilment_revision).toBe(7);
      // And it does not toast: the card renders the message in one place.
      expect(toast.error).not.toHaveBeenCalled();
    }

    it('forwards a fulfilment-status conflict untouched', () => {
      expectForwarded('/api/v1/kitchen/orders/o1/fulfilment-status/');
    });

    it('forwards a priority conflict untouched', () => {
      expectForwarded('/api/v1/kitchen/orders/o1/priority/');
    });

    it('forwards a cancel conflict untouched', () => {
      expectForwarded('/api/v1/kitchen/orders/o1/cancel/');
    });

    it('forwards a 403 with its reason, so an escalation refusal is legible', () => {
      let caught: any;
      const url = '/api/v1/kitchen/orders/o1/cancel/';
      httpClient.put(url, {}).subscribe({ error: err => (caught = err) });
      httpMock.expectOne(url).flush(
        { status: 403, message: 'Only a manager can cancel an order once '
                              + 'preparation has started',
          reason: 'kitchen_manage_required' },
        { status: 403, statusText: 'Forbidden' });
      expect(caught?.status).toBe(403);
      expect(caught?.error?.reason).toBe('kitchen_manage_required');
    });

    it('leaves the kitchen READS on the ordinary string + toast path', () => {
      // Only the three command routes are carved out; a failed feed read is an
      // ordinary error the operator should be told about.
      let caught: any;
      const url = '/api/v1/kitchen/orders/active/';
      httpClient.get(url).subscribe({ error: err => (caught = err) });
      httpMock.expectOne(url).flush(
        { message: 'boom' }, { status: 500, statusText: 'Server Error' });
      expect(typeof caught).toBe('string');
      expect(toast.error).toHaveBeenCalled();
    });

    it('leaves the stock toggle on the ordinary path', () => {
      let caught: any;
      const url = '/api/v1/kitchen/menu-items/m1/stock/';
      httpClient.put(url, {}).subscribe({ error: err => (caught = err) });
      httpMock.expectOne(url).flush(
        { message: 'boom' }, { status: 500, statusText: 'Server Error' });
      expect(typeof caught).toBe('string');
    });

    it('does not borrow the carve-out for a URL that merely mentions it', () => {
      let caught: any;
      const url = '/api/v1/reports/restaurant/x/?q=kitchen/orders/o1/cancel/';
      httpClient.put(url, {}).subscribe({ error: err => (caught = err) });
      httpMock.expectOne(url).flush(
        { message: 'boom' }, { status: 409, statusText: 'Conflict' });
      expect(typeof caught).toBe('string');
    });
  });
});
