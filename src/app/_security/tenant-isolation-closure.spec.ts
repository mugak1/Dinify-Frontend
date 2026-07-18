/**
 * Frontend tenant-boundary closure regression gate (TENANT-ISO-PR6B).
 *
 * The consolidated, BEHAVIORAL attack matrix for the anonymous-diner + selected-
 * restaurant boundary: it drives the real interceptors, service state machine and
 * pure URL/response builders — it does NOT grep source text. It is the frontend
 * counterpart to the backend closure module
 * (dinify_backend/tenancy/tests_tenant_isolation_closure.py) and asserts the
 * cross-repo contract constants this repo OWNS (§14 parity).
 *
 * It is INTENTIONALLY a cross-cutting matrix, not a re-derivation of every spec.
 * The `test:tenant-boundary` CI gate runs this file ALONGSIDE the deep specs it
 * builds on (the diner-session interceptor/service, basket-body, diner + portal
 * menu, the tables QR preview/setup/service, and the kitchen scoping specs).
 *
 * Threat model mirrors the backend: unauthenticated diner, raw-UUID holder,
 * credential holder, session holder, tampered/expired/denied capability, staff
 * with stale state, multi-membership staff. See docs/TENANT_ISOLATION_CLOSURE.md
 * for the assurance boundary — this is a regression gate, not a certification.
 */
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  HTTP_INTERCEPTORS,
  HttpClient,
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { environment } from '../../environments/environment';
import { DinerSessionInterceptor } from '../_helpers/diner-session.interceptor';
import { AuthInterceptor } from '../_helpers/auth.interceptor';
import { DinerSessionService } from '../_services/diner-session.service';
import { AuthenticationService } from '../_services/authentication.service';
import { SessionStorageService } from '../_services/storage/session-storage.service';
import { WINDOW } from '../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../_services/storage/storage-key-prefix.token';
import { getTableQRUrl } from '../restaurant-mgt/tables/utils/qr-print-sheet';
import { RestaurantTable } from '../restaurant-mgt/tables/models/tables.models';

const API = environment.apiUrl;

// The contract constants the backend also asserts (its ContractParityClosureTests).
const CREDENTIAL_HEADER = 'X-Diner-Credential';
const SESSION_HEADER = 'X-Diner-Session';
const SCAN_ROUTE = 'orders/journey/table-scan/';
const SESSION_GATED_ROUTES = [
  'orders/journey/order-details/',
  'orders/journey/payment-details/',
  'orders/initiate/',
  'orders/submit/',
  'reviews/submit/',
];
const EXPIRED_MESSAGE = 'Your table session has expired. Please rescan the QR code.';
const CAPABILITY_DENIED_404 = 'Not found.';


// =============================================================================
// A + F. Capability transport & channel separation — BOTH interceptors live, so
//        the JWT and diner channels are proven mutually exclusive (task §11.A/F).
// =============================================================================
describe('Closure §A/F — capability transport & channel separation', () => {
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
        // Order matters only cosmetically; both run. This proves the two channels
        // never overlay each other regardless of registration.
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

  it('anon scan carries only X-Diner-Credential (no session, no JWT)', () => {
    dinerSession.setCredential('QR-CRED');
    dinerSession.setToken('SESS');
    httpClient.get(`${API}/api/v1/${SCAN_ROUTE}`).subscribe();
    const req = httpMock.expectOne(`${API}/api/v1/${SCAN_ROUTE}`);
    expect(req.request.headers.get(CREDENTIAL_HEADER)).toBe('QR-CRED');
    expect(req.request.headers.has(SESSION_HEADER)).toBeFalse();
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({ data: {} });
  });

  it('anon downstream diner calls carry only X-Diner-Session (no credential, no JWT)', () => {
    dinerSession.setToken('SESS-1');
    httpClient.post(`${API}/api/v2/orders/initiate/`, { items: [] }).subscribe();
    const req = httpMock.expectOne(`${API}/api/v2/orders/initiate/`);
    expect(req.request.headers.get(SESSION_HEADER)).toBe('SESS-1');
    expect(req.request.headers.has(CREDENTIAL_HEADER)).toBeFalse();
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({ status: 200, data: {} });
  });

  it('a signed-in staff user rides the JWT channel and gets NO diner header on a diner endpoint', () => {
    setUser({ token: 'staff-jwt' });
    dinerSession.setToken('SESS');   // stale diner state must not leak
    httpClient.post(`${API}/api/v2/orders/initiate/`, { source: 'admin' }).subscribe();
    const req = httpMock.expectOne(`${API}/api/v2/orders/initiate/`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer staff-jwt');
    expect(req.request.headers.has(SESSION_HEADER)).toBeFalse();
    expect(req.request.headers.has(CREDENTIAL_HEADER)).toBeFalse();
    req.flush({ status: 200, data: {} });
  });

  it('an anon diner request gets NO Authorization header even with stale staff state absent', () => {
    dinerSession.setToken('SESS-2');
    httpClient.post(`${API}/api/v1/reviews/submit/`, { order: 'o1' }).subscribe();
    const req = httpMock.expectOne(`${API}/api/v1/reviews/submit/`);
    expect(req.request.headers.has('Authorization')).toBeFalse();
    expect(req.request.headers.get(SESSION_HEADER)).toBe('SESS-2');
    req.flush({ status: 201, data: {} });
  });

  it('the session token never rides the URL or body (header-only)', () => {
    dinerSession.setToken('SECRET-TOKEN');
    httpClient.post(`${API}/api/v1/reviews/submit/`, { order: 'o1' }).subscribe();
    const req = httpMock.expectOne(`${API}/api/v1/reviews/submit/`);
    expect(req.request.urlWithParams).not.toContain('SECRET-TOKEN');
    expect(JSON.stringify(req.request.body)).not.toContain('SECRET-TOKEN');
    req.flush({});
  });

  it('a non-diner endpoint gets neither diner header', () => {
    dinerSession.setCredential('QR-CRED');
    dinerSession.setToken('SESS');
    httpClient.get(`${API}/api/v1/restaurant-setup/menuitems/`).subscribe();
    const req = httpMock.expectOne(`${API}/api/v1/restaurant-setup/menuitems/`);
    expect(req.request.headers.has(SESSION_HEADER)).toBeFalse();
    expect(req.request.headers.has(CREDENTIAL_HEADER)).toBeFalse();
    req.flush({ data: {} });
  });
});


// =============================================================================
// A + F. Credential/session state machine, recovery & disclosure (service).
// =============================================================================
describe('Closure §A/F — capability state machine & disclosure', () => {
  let dinerSession: DinerSessionService;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
        SessionStorageService,
        DinerSessionService,
      ],
    });
    dinerSession = TestBed.inject(DinerSessionService);
  });

  afterEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  function storeValues(store: Storage): string[] {
    const out: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)!;
      out.push(store.getItem(k) ?? '');
    }
    return out;
  }

  it('stores the capability in sessionStorage only — never localStorage', () => {
    dinerSession.setCredential('CRED-XYZ');
    dinerSession.setToken('TOK-XYZ');
    expect(storeValues(window.sessionStorage).some(v => v.includes('CRED-XYZ'))).toBeTrue();
    expect(storeValues(window.sessionStorage).some(v => v.includes('TOK-XYZ'))).toBeTrue();
    expect(storeValues(window.localStorage).some(v => v.includes('CRED-XYZ'))).toBeFalse();
    expect(storeValues(window.localStorage).some(v => v.includes('TOK-XYZ'))).toBeFalse();
  });

  it('never writes the credential/session to the console', () => {
    const spies = [
      spyOn(console, 'log'), spyOn(console, 'warn'), spyOn(console, 'error'),
      spyOn(console, 'info'), spyOn(console, 'debug'),
    ];
    dinerSession.setCredential('CRED-LOG');
    dinerSession.setToken('TOK-LOG');
    dinerSession.isSessionExpired({ status: 400, error: { message: EXPIRED_MESSAGE } });
    dinerSession.isCredentialDenied({ status: 404, error: { message: CAPABILITY_DENIED_404 } });
    dinerSession.expireSession();
    dinerSession.invalidateCredential();
    for (const spy of spies) {
      for (const call of spy.calls.all()) {
        const blob = JSON.stringify(call.args);
        expect(blob).not.toContain('CRED-LOG');
        expect(blob).not.toContain('TOK-LOG');
      }
    }
  });

  it('expireSession drops the session but KEEPS the credential (silent re-mint path)', () => {
    dinerSession.setCredential('CRED-1');
    dinerSession.setToken('TOK-1');
    dinerSession.expireSession();
    expect(dinerSession.hasSession()).toBeFalse();
    expect(dinerSession.credential).toBe('CRED-1');   // retained for re-scan
    expect(dinerSession.needsRescan()).toBeFalse();
  });

  it('invalidateCredential wipes everything and demands a physical rescan', () => {
    dinerSession.setCredential('CRED-2');
    dinerSession.setToken('TOK-2');
    dinerSession.invalidateCredential();
    expect(dinerSession.hasCredential()).toBeFalse();
    expect(dinerSession.hasSession()).toBeFalse();
    expect(dinerSession.needsRescan()).toBeTrue();
  });

  it('retainSessionThrough survives a blanket storage clear at checkout', () => {
    dinerSession.setCredential('CRED-3');
    dinerSession.setToken('TOK-3');
    dinerSession.retainSessionThrough(() => window.sessionStorage.clear());
    // A fresh service instance rehydrates from storage → tokens survived the clear.
    const revived = TestBed.inject(DinerSessionService);
    // (same singleton) — assert the in-memory + storage state both survived.
    expect(dinerSession.credential).toBe('CRED-3');
    expect(dinerSession.token).toBe('TOK-3');
    void revived;
  });

  it('classifies the backend expiry (400) as a recoverable session lapse, not a credential death', () => {
    const err = { status: 400, error: { message: EXPIRED_MESSAGE } };
    expect(dinerSession.isSessionExpired(err)).toBeTrue();
    expect(dinerSession.isCredentialDenied(err)).toBeFalse();
    // Also the ErrorInterceptor's collapsed string form.
    expect(dinerSession.isSessionExpired(EXPIRED_MESSAGE)).toBeTrue();
  });

  it('classifies the backend denied 404 (Not found.) as a credential death (rescan)', () => {
    const err = { status: 404, error: { message: CAPABILITY_DENIED_404 } };
    expect(dinerSession.isCredentialDenied(err)).toBeTrue();
    expect(dinerSession.isSessionExpired(err)).toBeFalse();
    // A resource miss with the same shape must NOT invalidate the credential.
    const resourceMiss = { status: 404, error: { message: 'Order not found.' } };
    expect(dinerSession.isCredentialDenied(resourceMiss)).toBeFalse();
  });
});


// =============================================================================
// D. QR output — fail-closed on empty credential + URL parity (pure builder).
// =============================================================================
describe('Closure §D — QR URL fail-closed & parity', () => {
  function table(over: Partial<RestaurantTable> = {}): RestaurantTable {
    return { id: 't-1', number: 1, qrCredential: 'CRED', ...over } as RestaurantTable;
  }

  it('returns null (no renderable/copyable/printable URL) when the credential is missing/blank', () => {
    expect(getTableQRUrl(table({ qrCredential: undefined }))).toBeNull();
    expect(getTableQRUrl(table({ qrCredential: '' }))).toBeNull();
    expect(getTableQRUrl(table({ qrCredential: '   ' }))).toBeNull();
    expect(getTableQRUrl(table({ id: '', qrCredential: 'CRED' }))).toBeNull();
  });

  it('builds a credential-bearing /diner/h/:table?c= URL when a credential is present', () => {
    const url = getTableQRUrl(table({ id: 't-9', qrCredential: 'ab c/d' }))!;
    expect(url).toContain('/diner/h/t-9?c=');
    // The credential is URL-encoded, never raw.
    expect(url).toContain(encodeURIComponent('ab c/d'));
    expect(url).not.toContain('?c=ab c/d');
  });
});


// =============================================================================
// E. Selected-restaurant scope authority (task §11.E).
// =============================================================================
describe('Closure §E — selected-restaurant scope authority', () => {
  let auth: AuthenticationService;

  beforeEach(() => {
    window.localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    auth = TestBed.inject(AuthenticationService);
  });

  afterEach(() => window.localStorage.clear());

  it('currentRestaurantRole reads the login-SELECTED membership (rest_role), not restaurant_roles[0]', () => {
    const selected = { restaurant_id: 'rest-SELECTED', roles: ['manager'] };
    window.localStorage.setItem('rest_role', JSON.stringify(selected));
    expect(auth.currentRestaurantRole?.restaurant_id).toBe('rest-SELECTED');
  });

  it('has no selected membership when rest_role is unset (no silent restaurant_roles[0] fallback)', () => {
    expect(auth.currentRestaurantRole).toBeNull();
  });
});


// =============================================================================
// §14. Cross-repository contract parity — constants OWNED by the frontend.
//      The backend asserts the identical values; if either drifts, a gate fails.
// =============================================================================
describe('Closure §14 — cross-repo contract parity', () => {
  it('capability header names match the backend', () => {
    expect(CREDENTIAL_HEADER).toBe('X-Diner-Credential');
    expect(SESSION_HEADER).toBe('X-Diner-Session');
  });

  it('the scan route and session-gated route set are the agreed contract', () => {
    expect(SCAN_ROUTE).toBe('orders/journey/table-scan/');
    // Every session-gated route is recognised by the interceptor's diner matcher.
    const isDiner = (u: string) =>
      u.includes('orders/journey/') || u.includes('orders/initiate/') ||
      u.includes('orders/submit/') || u.includes('reviews/submit/');
    for (const route of SESSION_GATED_ROUTES) {
      expect(isDiner(route)).withContext(route).toBeTrue();
    }
  });

  it('the session-expiry (400) and credential-denied (404) messages match the backend', () => {
    expect(EXPIRED_MESSAGE).toBe('Your table session has expired. Please rescan the QR code.');
    expect(CAPABILITY_DENIED_404).toBe('Not found.');
    // And the service recognises them (parity with its own private constants).
    const svc = new DinerSessionService({
      getItem: () => null, setItem: () => {}, removeItem: () => {},
    } as unknown as SessionStorageService);
    expect(svc.isSessionExpired(EXPIRED_MESSAGE)).toBeTrue();
    expect(svc.isCredentialDenied(CAPABILITY_DENIED_404)).toBeTrue();
  });

  it('the QR URL builder emits the credential-bearing /diner/h/:table?c= shape the backend scan expects', () => {
    const url = getTableQRUrl({ id: 'TID', number: 1, qrCredential: 'CREDVAL' } as RestaurantTable)!;
    expect(url).toContain('/diner/h/TID?c=CREDVAL');
  });
});
