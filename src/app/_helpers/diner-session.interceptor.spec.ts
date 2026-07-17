import { TestBed } from '@angular/core/testing';
import {
  HTTP_INTERCEPTORS,
  HttpClient,
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DinerSessionInterceptor } from './diner-session.interceptor';
import { DinerSessionService } from '../_services/diner-session.service';
import { AuthenticationService } from '../_services/authentication.service';
import { SessionStorageService } from '../_services/storage/session-storage.service';
import { WINDOW } from '../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../_services/storage/storage-key-prefix.token';

const API = 'https://api.example.test/api';

describe('DinerSessionInterceptor', () => {
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

  function setUser(user: any) {
    Object.defineProperty(authService, 'userValue', { get: () => user, configurable: true });
  }

  it('attaches X-Diner-Credential (not session) on the table-scan exchange', () => {
    dinerSession.setCredential('QR-CRED');
    dinerSession.setToken('SESS');

    httpClient.get(`${API}/v1/orders/journey/table-scan/`).subscribe();
    const req = httpMock.expectOne(`${API}/v1/orders/journey/table-scan/`);

    expect(req.request.headers.get('X-Diner-Credential')).toBe('QR-CRED');
    expect(req.request.headers.has('X-Diner-Session')).toBeFalse();
    req.flush({ data: {} });
  });

  it('attaches the session to order initiation (v2 initiate)', () => {
    dinerSession.setToken('SESS-1');

    httpClient.post(`${API}/v2/orders/initiate/`, {}).subscribe();
    const req = httpMock.expectOne(`${API}/v2/orders/initiate/`);

    expect(req.request.headers.get('X-Diner-Session')).toBe('SESS-1');
    expect(req.request.headers.has('X-Diner-Credential')).toBeFalse();
    req.flush({ status: 200, data: {} });
  });

  it('attaches the session to order submit', () => {
    dinerSession.setToken('SESS-2');

    httpClient.put(`${API}/v1/orders/submit/`, {}).subscribe();
    const req = httpMock.expectOne(`${API}/v1/orders/submit/`);

    expect(req.request.headers.get('X-Diner-Session')).toBe('SESS-2');
    req.flush({});
  });

  it('attaches the session to order details', () => {
    dinerSession.setToken('SESS-3');

    httpClient.get(`${API}/v1/orders/journey/order-details/?order=o1`).subscribe();
    const req = httpMock.expectOne(r => r.url.includes('orders/journey/order-details/'));

    expect(req.request.headers.get('X-Diner-Session')).toBe('SESS-3');
    req.flush({ data: {} });
  });

  it('attaches the session to payment details', () => {
    dinerSession.setToken('SESS-4');

    httpClient.get(`${API}/v1/orders/journey/payment-details/?transaction=t1`).subscribe();
    const req = httpMock.expectOne(r => r.url.includes('orders/journey/payment-details/'));

    expect(req.request.headers.get('X-Diner-Session')).toBe('SESS-4');
    req.flush({ data: {} });
  });

  it('attaches the session to review submission', () => {
    dinerSession.setToken('SESS-5');

    httpClient.post(`${API}/v1/reviews/submit/`, {}).subscribe();
    const req = httpMock.expectOne(`${API}/v1/reviews/submit/`);

    expect(req.request.headers.get('X-Diner-Session')).toBe('SESS-5');
    req.flush({ status: 201, data: {} });
  });

  it('keeps the session token out of the URL and body (header only)', () => {
    dinerSession.setToken('SECRET-TOKEN');

    httpClient.post(`${API}/v1/reviews/submit/`, { order: 'o1' }).subscribe();
    const req = httpMock.expectOne(`${API}/v1/reviews/submit/`);

    expect(req.request.urlWithParams).not.toContain('SECRET-TOKEN');
    expect(JSON.stringify(req.request.body)).not.toContain('SECRET-TOKEN');
    req.flush({});
  });

  it('does NOT attach a diner capability to non-diner endpoints', () => {
    dinerSession.setCredential('QR-CRED');
    dinerSession.setToken('SESS');

    httpClient.get(`${API}/v1/restaurant-setup/menuitems/`).subscribe();
    const req = httpMock.expectOne(`${API}/v1/restaurant-setup/menuitems/`);

    expect(req.request.headers.has('X-Diner-Session')).toBeFalse();
    expect(req.request.headers.has('X-Diner-Credential')).toBeFalse();
    req.flush({ data: {} });
  });

  it('does NOT attach a diner capability when a staff user is signed in (staff/admin flows untouched)', () => {
    setUser({ token: 'staff-jwt' });
    dinerSession.setToken('SESS');

    // Same endpoint an admin uses to create an order — must stay on the JWT channel.
    httpClient.post(`${API}/v2/orders/initiate/`, { source: 'admin' }).subscribe();
    const req = httpMock.expectOne(`${API}/v2/orders/initiate/`);

    expect(req.request.headers.has('X-Diner-Session')).toBeFalse();
    req.flush({ status: 200, data: {} });
  });

  it('attaches nothing when there is no capability yet', () => {
    httpClient.post(`${API}/v2/orders/initiate/`, {}).subscribe();
    const req = httpMock.expectOne(`${API}/v2/orders/initiate/`);

    expect(req.request.headers.has('X-Diner-Session')).toBeFalse();
    expect(req.request.headers.has('X-Diner-Credential')).toBeFalse();
    req.flush({ status: 200, data: {} });
  });
});
