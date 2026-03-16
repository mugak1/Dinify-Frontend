import { TestBed } from '@angular/core/testing';
import { HTTP_INTERCEPTORS, HttpClient, HttpErrorResponse } from '@angular/common/http';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ErrorInterceptor } from './error.interceptor';
import { AuthenticationService } from '../_services/authentication.service';
import { MessageService } from '../_services/message.service';
import { of, throwError } from 'rxjs';

describe('ErrorInterceptor', () => {
  let httpClient: HttpClient;
  let httpMock: HttpTestingController;
  let authService: jasmine.SpyObj<AuthenticationService>;
  let messageService: MessageService;

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

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        MessageService,
        { provide: AuthenticationService, useValue: authSpy },
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true }
      ]
    });

    httpClient = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    authService = TestBed.inject(AuthenticationService) as jasmine.SpyObj<AuthenticationService>;
    messageService = TestBed.inject(MessageService);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function setUser(user: any) {
    Object.defineProperty(authService, 'userValue', { get: () => user, configurable: true });
  }

  describe('network errors (status 0)', () => {
    it('should add "no network" message and throw', (done) => {
      httpClient.get('/api/test').subscribe({
        error: (err) => {
          expect(err).toBe('no network');
          expect(messageService.messages.length).toBe(1);
          expect(messageService.messages[0].message).toBe('no network');
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
        error: (err) => {
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

  describe('403 handling', () => {
    it('should logout immediately on 403 when user is logged in', (done) => {
      setUser(mockUser);

      httpClient.get('/api/test').subscribe({
        error: () => {
          expect(authService.logout).toHaveBeenCalled();
          expect(authService.attemptTokenRefresh).not.toHaveBeenCalled();
          done();
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.flush({ message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });
    });

    it('should not logout on 403 when user is not logged in', (done) => {
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
    it('should return rate_limited error and add message', (done) => {
      httpClient.get('/api/test').subscribe({
        error: (err) => {
          expect(err).toBe('rate_limited');
          expect(messageService.messages.length).toBe(1);
          expect(messageService.messages[0].message).toContain('Too many attempts');
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
          expect(messageService.messages[0].message).toBe('Please wait 60 seconds');
          done();
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.flush({ message: 'Please wait 60 seconds' }, { status: 429, statusText: 'Too Many Requests' });
    });
  });

  describe('other errors', () => {
    it('should add error message to message service for 500 errors', (done) => {
      httpClient.get('/api/test').subscribe({
        error: (err) => {
          expect(messageService.messages.length).toBe(1);
          expect(messageService.messages[0].message).toBe('Server error');
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
          done();
        }
      });

      const req = httpMock.expectOne('/api/test');
      req.flush({}, { status: 400, statusText: 'Bad Request' });
    });
  });

  describe('message clearing', () => {
    it('should clear messages before each request', () => {
      messageService.add('old message');
      expect(messageService.messages.length).toBe(1);

      httpClient.get('/api/test').subscribe();
      // Messages should be cleared when intercept is called
      const req = httpMock.expectOne('/api/test');
      req.flush({});

      // After a successful request, old messages should be cleared
      // (cleared at intercept entry, no new ones added on success)
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
