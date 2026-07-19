import { TestBed } from '@angular/core/testing';
import {
  HTTP_INTERCEPTORS,
  HttpClient,
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { DinerSessionInterceptor } from './diner-session.interceptor';
import { AuthInterceptor } from './auth.interceptor';
import { DinerSessionService } from '../_services/diner-session.service';
import { AuthenticationService } from '../_services/authentication.service';
import { SessionStorageService } from '../_services/storage/session-storage.service';
import { WINDOW } from '../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../_services/storage/storage-key-prefix.token';
import {
  CREDENTIAL_HEADER,
  SESSION_HEADER,
  CREDENTIAL_ROUTE,
  SESSION_ROUTES,
  PUBLIC_MENU_ROUTE,
} from '../_security/diner-capability-contract';

// The interceptor now requires the configured first-party API origin/base, so every
// URL is built off environment.apiUrl + the contract route paths (no hardcoded origin).
const API = environment.apiUrl;
const u = (path: string) => `${API}${path}`;
/** Look a session route up by a path fragment so tests read off the contract, not copies. */
const sessionUrl = (needle: string) =>
  u(SESSION_ROUTES.find(r => r.path.includes(needle))!.path);

describe('DinerSessionInterceptor', () => {
  let httpClient: HttpClient;
  let httpMock: HttpTestingController;
  let dinerSession: DinerSessionService;

  beforeEach(() => {
    const authSpy = jasmine.createSpyObj('AuthenticationService', ['logout'], { userValue: null });

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthenticationService, useValue: authSpy },
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
        SessionStorageService,
        DinerSessionService,
        { provide: HTTP_INTERCEPTORS, useClass: DinerSessionInterceptor, multi: true },
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
      ],
    });

    httpClient = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    dinerSession = TestBed.inject(DinerSessionService);
  });

  afterEach(() => {
    httpMock.verify();
    window.sessionStorage.clear();
  });

  it('attaches X-Diner-Credential (not session) on the table-scan exchange', () => {
    dinerSession.setCredential('QR-CRED');
    dinerSession.setToken('SESS');

    httpClient.get(u(CREDENTIAL_ROUTE.path)).subscribe();
    const req = httpMock.expectOne(u(CREDENTIAL_ROUTE.path));

    expect(req.request.headers.get(CREDENTIAL_HEADER)).toBe('QR-CRED');
    expect(req.request.headers.has(SESSION_HEADER)).toBeFalse();
    req.flush({ data: {} });
  });

  // Covers every session-gated route (order-details, payment-details, v2 initiate,
  // v1 submit, reviews) straight off the contract — session header only, no credential.
  for (const route of SESSION_ROUTES) {
    it(`attaches only the session on ${route.method} ${route.path}`, () => {
      dinerSession.setToken('SESS');

      const target = u(route.path);
      const options = route.method === 'GET' ? {} : { body: {} };
      httpClient.request(route.method, target, options).subscribe();
      const req = httpMock.expectOne(target);

      expect(req.request.headers.get(SESSION_HEADER)).toBe('SESS');
      expect(req.request.headers.has(CREDENTIAL_HEADER)).toBeFalse();
      req.flush({ data: {} });
    });
  }

  it('classifies a known route correctly even with a query string (payment-details)', () => {
    dinerSession.setToken('SESS-Q');

    const target = sessionUrl('payment-details') + '?transaction=t1';
    httpClient.get(target).subscribe();
    const req = httpMock.expectOne(target);

    expect(req.request.headers.get(SESSION_HEADER)).toBe('SESS-Q');
    req.flush({ data: {} });
  });

  it('does NOT attach a diner capability to the public show-menu read', () => {
    dinerSession.setCredential('QR-CRED');
    dinerSession.setToken('SESS');

    const target = u(PUBLIC_MENU_ROUTE.path) + '?restaurant=r1';
    httpClient.get(target).subscribe();
    const req = httpMock.expectOne(target);

    expect(req.request.headers.has(SESSION_HEADER)).toBeFalse();
    expect(req.request.headers.has(CREDENTIAL_HEADER)).toBeFalse();
    req.flush({ data: {} });
  });

  it('does NOT attach a diner capability to an unknown orders/journey/* route', () => {
    dinerSession.setToken('SESS');

    httpClient.get(u('/api/v1/orders/journey/some-future-endpoint/')).subscribe();
    const req = httpMock.expectOne(u('/api/v1/orders/journey/some-future-endpoint/'));

    expect(req.request.headers.has(SESSION_HEADER)).toBeFalse();
    expect(req.request.headers.has(CREDENTIAL_HEADER)).toBeFalse();
    req.flush({ data: {} });
  });

  it('does NOT attach a diner capability on a known route with the wrong HTTP method', () => {
    dinerSession.setToken('SESS');

    // initiate is POST-only; a GET must not be treated as the diner initiate route.
    httpClient.get(sessionUrl('initiate')).subscribe();
    const req = httpMock.expectOne(sessionUrl('initiate'));

    expect(req.request.headers.has(SESSION_HEADER)).toBeFalse();
    expect(req.request.headers.has(CREDENTIAL_HEADER)).toBeFalse();
    req.flush({ data: {} });
  });

  it('does NOT attach a diner capability on a similar-but-not-exact pathname', () => {
    dinerSession.setToken('SESS');

    httpClient.post(u('/api/v2/orders/initiate/extra/'), {}).subscribe();
    const req = httpMock.expectOne(u('/api/v2/orders/initiate/extra/'));

    expect(req.request.headers.has(SESSION_HEADER)).toBeFalse();
    expect(req.request.headers.has(CREDENTIAL_HEADER)).toBeFalse();
    req.flush({ data: {} });
  });

  it('does NOT attach a capability to an external origin containing the exact scan path', () => {
    dinerSession.setCredential('QR-CRED');
    dinerSession.setToken('SESS');

    const foreign = `https://evil.example.com${CREDENTIAL_ROUTE.path}`;
    httpClient.get(foreign).subscribe();
    const req = httpMock.expectOne(foreign);

    expect(req.request.headers.has(CREDENTIAL_HEADER)).toBeFalse();
    expect(req.request.headers.has(SESSION_HEADER)).toBeFalse();
    req.flush({ data: {} });
  });

  it('does NOT attach a capability to an external origin containing the exact initiate path', () => {
    dinerSession.setToken('SESS');

    const foreign = 'https://evil.example.com/api/v2/orders/initiate/';
    httpClient.post(foreign, {}).subscribe();
    const req = httpMock.expectOne(foreign);

    expect(req.request.headers.has(SESSION_HEADER)).toBeFalse();
    expect(req.request.headers.has(CREDENTIAL_HEADER)).toBeFalse();
    req.flush({ data: {} });
  });

  it('does NOT attach a capability when a route string appears only in a query parameter', () => {
    dinerSession.setToken('SESS');

    const target = u('/api/v1/health/') + '?next=/api/v2/orders/initiate/';
    httpClient.get(target).subscribe();
    const req = httpMock.expectOne(r => r.urlWithParams === target);

    expect(req.request.headers.has(SESSION_HEADER)).toBeFalse();
    expect(req.request.headers.has(CREDENTIAL_HEADER)).toBeFalse();
    req.flush({ data: {} });
  });

  it('keeps the session token out of the URL and body (header only)', () => {
    dinerSession.setToken('SECRET-TOKEN');

    httpClient.post(sessionUrl('reviews'), { order: 'o1' }).subscribe();
    const req = httpMock.expectOne(sessionUrl('reviews'));

    expect(req.request.urlWithParams).not.toContain('SECRET-TOKEN');
    expect(JSON.stringify(req.request.body)).not.toContain('SECRET-TOKEN');
    req.flush({});
  });

  it('keeps the credential out of the URL and body on the scan (header only)', () => {
    dinerSession.setCredential('SECRET-CRED');

    httpClient.get(u(CREDENTIAL_ROUTE.path)).subscribe();
    const req = httpMock.expectOne(u(CREDENTIAL_ROUTE.path));

    expect(req.request.urlWithParams).not.toContain('SECRET-CRED');
    expect(JSON.stringify(req.request.body)).not.toContain('SECRET-CRED');
    req.flush({ data: {} });
  });

  it('does NOT attach a diner capability to non-diner endpoints', () => {
    dinerSession.setCredential('QR-CRED');
    dinerSession.setToken('SESS');

    httpClient.get(u('/api/v1/restaurant-setup/menuitems/')).subscribe();
    const req = httpMock.expectOne(u('/api/v1/restaurant-setup/menuitems/'));

    expect(req.request.headers.has(SESSION_HEADER)).toBeFalse();
    expect(req.request.headers.has(CREDENTIAL_HEADER)).toBeFalse();
    req.flush({ data: {} });
  });

  it('attaches nothing when there is no capability yet', () => {
    httpClient.post(sessionUrl('initiate'), {}).subscribe();
    const req = httpMock.expectOne(sessionUrl('initiate'));

    expect(req.request.headers.has(SESSION_HEADER)).toBeFalse();
    expect(req.request.headers.has(CREDENTIAL_HEADER)).toBeFalse();
    req.flush({ status: 200, data: {} });
  });
});


// =============================================================================
// Channel separation — BOTH real interceptors live, so the JWT and diner channels
// are proven mutually exclusive on a diner endpoint (as the closure suite does).
// =============================================================================
describe('DinerSessionInterceptor — staff/diner channel separation', () => {
  let httpClient: HttpClient;
  let httpMock: HttpTestingController;
  let dinerSession: DinerSessionService;
  let authService: jasmine.SpyObj<AuthenticationService>;

  beforeEach(() => {
    const authSpy = jasmine.createSpyObj('AuthenticationService', ['logout'], { userValue: null });

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthenticationService, useValue: authSpy },
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
        SessionStorageService,
        DinerSessionService,
        { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
        { provide: HTTP_INTERCEPTORS, useClass: DinerSessionInterceptor, multi: true },
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
      ],
    });

    httpClient = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    dinerSession = TestBed.inject(DinerSessionService);
    authService = TestBed.inject(AuthenticationService) as jasmine.SpyObj<AuthenticationService>;
  });

  afterEach(() => {
    httpMock.verify();
    window.sessionStorage.clear();
  });

  function setUser(user: unknown) {
    Object.defineProperty(authService, 'userValue', { get: () => user, configurable: true });
  }

  it('a signed-in staff user rides the JWT channel and gets NO diner header on a diner endpoint', () => {
    setUser({ token: 'staff-jwt' });
    dinerSession.setToken('SESS'); // stale diner state must not leak

    // The same endpoint an admin uses to create an order — must stay on the JWT channel.
    httpClient.post(sessionUrl('initiate'), { source: 'admin' }).subscribe();
    const req = httpMock.expectOne(sessionUrl('initiate'));

    expect(req.request.headers.get('Authorization')).toBe('Bearer staff-jwt');
    expect(req.request.headers.has(SESSION_HEADER)).toBeFalse();
    expect(req.request.headers.has(CREDENTIAL_HEADER)).toBeFalse();
    req.flush({ status: 200, data: {} });
  });

  it('an anonymous diner request gets its session but NO Authorization header', () => {
    dinerSession.setToken('SESS-2');

    httpClient.post(sessionUrl('reviews'), { order: 'o1' }).subscribe();
    const req = httpMock.expectOne(sessionUrl('reviews'));

    expect(req.request.headers.has('Authorization')).toBeFalse();
    expect(req.request.headers.get(SESSION_HEADER)).toBe('SESS-2');
    req.flush({ status: 201, data: {} });
  });
});
