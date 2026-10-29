import { TestBed } from '@angular/core/testing';
import { HttpBackend, HttpClient, HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from 'src/environments/environment';
import { AuthenticationService } from './authentication.service';
import { AuthInterceptor } from '../_helpers/auth.interceptor';

/**
 * SHELL-FINISH-00, PR 3 — the authentication half of a restaurant switch.
 *
 * What is pinned: the switch writes ONLY the profile, onto the STORED session
 * (never this document's in-memory copy), refuses when the stored session or the
 * fresh profile belongs to somebody else, clears the restaurant-scoped `[dinify]`
 * keys while keeping the operator's own preferences, and ends in a REPLACE
 * reload. And once a document is retired, AuthInterceptor sends nothing.
 */
describe('AuthenticationService — restaurant switch (SHELL-FINISH-00 PR 3)', () => {
  const memberA = {
    restaurant_id: 'rest-a', restaurant: 'Baba House', roles: ['owner'],
    permissions: { dashboard: true, menu: true, tables: true, reviews: true, reports: true, settings: true, kitchen: true },
  };
  const memberB = {
    restaurant_id: 'rest-b', restaurant: 'Cafe Javas', roles: ['manager'],
    permissions: { dashboard: true, menu: true, tables: false, reviews: true, reports: false, settings: false, kitchen: true },
  };
  const profile = (id: string, roles: any[]) => ({
    id, first_name: 'Ada', last_name: 'Okello', email: '', roles: [], phone_number: '',
    country: 'UG', prompt_password_change: false, other_names: '', restaurant_roles: roles,
  });
  const session = (token: string, refresh: string, p: any) => ({
    token, refresh, profile: p, require_otp: false, prompt_password_change: false,
  });

  let service: AuthenticationService;
  let redirect: jasmine.Spy;

  function make(): AuthenticationService {
    const svc = new AuthenticationService(TestBed.inject(HttpClient), TestBed.inject(HttpBackend));
    redirect = spyOn<any>(svc, 'hardRedirect');
    return svc;
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withXhr(), withInterceptorsFromDi()), provideHttpClientTesting()],
    });
    // Signed in as user-1, at restaurant A, with the tokens this document loaded.
    localStorage.setItem('user', JSON.stringify(session('doc-access', 'doc-refresh', profile('user-1', [memberA, memberB]))));
    localStorage.setItem('rest_role', JSON.stringify(memberA));
    service = make();
  });

  afterEach(() => localStorage.clear());

  it('writes ONLY the fresh profile onto the STORED session, keeping the stored tokens', () => {
    // Another tab renewed after this document loaded: the stored refresh token is
    // newer than this document's. Writing the in-memory copy would put a spent one back.
    localStorage.setItem('user', JSON.stringify(session('tab-b-access', 'tab-b-refresh', profile('user-1', [memberA, memberB]))));
    const fresh = profile('user-1', [{ ...memberA }, { ...memberB }]);
    const outcome = service.switchRestaurantAndReload(fresh as any, fresh.restaurant_roles[1] as any, '/dashboard');

    expect(outcome).toBe('switched');
    const stored = JSON.parse(localStorage.getItem('user')!);
    expect(stored.token).toBe('tab-b-access');
    expect(stored.refresh).toBe('tab-b-refresh');
    expect(stored.profile).toEqual(fresh);
  });

  it('selects the membership taken FROM the fresh profile (with its resolved permissions)', () => {
    const fresh = profile('user-1', [memberA, { ...memberB, permissions: { ...memberB.permissions, reports: true } }]);
    service.switchRestaurantAndReload(fresh as any, fresh.restaurant_roles[1] as any, '/reports');
    const role = JSON.parse(localStorage.getItem('rest_role')!);
    expect(role.restaurant_id).toBe('rest-b');
    expect(role.permissions.reports).withContext('the fresh map, not the sign-in copy').toBeTrue();
  });

  it('refuses a membership that is not an entry of the fresh profile (no hand-built objects)', () => {
    const fresh = profile('user-1', [memberA, memberB]);
    expect(() => service.switchRestaurantAndReload(fresh as any, { ...memberB } as any, '/dashboard')).toThrowError(/fresh profile/);
    expect(JSON.parse(localStorage.getItem('rest_role')!).restaurant_id).toBe('rest-a');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('clears the restaurant-scoped [dinify] keys and current_resta, keeping the operator preferences', () => {
    localStorage.setItem('current_resta', JSON.stringify({ id: 'rest-a' }));
    localStorage.setItem('[dinify]tables.activeArea:rest-a', '"area-9"');
    localStorage.setItem('[dinify]menu.selectedSection:rest-a', '"s-1"');
    localStorage.setItem('[dinify]reports.dateRange:rest-a', '{}');
    localStorage.setItem('[dinify]sidebar.expanded', 'true');
    localStorage.setItem('[dinify]menu.sortMode:rest-a', '"manual"');
    localStorage.setItem('unrelated', 'kept');

    const fresh = profile('user-1', [memberA, memberB]);
    service.switchRestaurantAndReload(fresh as any, fresh.restaurant_roles[1] as any, '/dashboard');

    expect(localStorage.getItem('current_resta')).toBeNull();
    expect(localStorage.getItem('[dinify]tables.activeArea:rest-a')).toBeNull();
    expect(localStorage.getItem('[dinify]menu.selectedSection:rest-a')).toBeNull();
    expect(localStorage.getItem('[dinify]reports.dateRange:rest-a')).toBeNull();
    expect(localStorage.getItem('[dinify]sidebar.expanded')).toBe('true');
    expect(localStorage.getItem('[dinify]menu.sortMode:rest-a')).toBe('"manual"');
    expect(localStorage.getItem('unrelated')).toBe('kept');
  });

  it('ends in a REPLACE reload to the landing path it was given, as the LAST step', () => {
    const fresh = profile('user-1', [memberA, memberB]);
    redirect.and.callFake(() => {
      // Everything is written before the page goes.
      expect(JSON.parse(localStorage.getItem('rest_role')!).restaurant_id).toBe('rest-b');
    });
    service.switchRestaurantAndReload(fresh as any, fresh.restaurant_roles[1] as any, '/menu');
    expect(redirect.calls.allArgs()).toEqual([['/menu', 'replace']]);
  });

  it('writes NOTHING when the stored session now belongs to someone else (another tab signed in)', () => {
    const other = JSON.stringify(session('x', 'y', profile('user-2', [memberB])));
    localStorage.setItem('user', other);
    const fresh = profile('user-1', [memberA, memberB]);

    const outcome = service.switchRestaurantAndReload(fresh as any, fresh.restaurant_roles[1] as any, '/dashboard');

    expect(outcome).toBe('principal-changed');
    expect(localStorage.getItem('user')).toBe(other);
    expect(JSON.parse(localStorage.getItem('rest_role')!).restaurant_id).toBe('rest-a');
    expect(redirect).not.toHaveBeenCalled();
    expect(service.isRetired).withContext('it still stops sending').toBeTrue();
  });

  it('writes NOTHING when the fresh profile is someone else\'s', () => {
    const fresh = profile('user-2', [memberA, memberB]);
    const before = localStorage.getItem('user');
    expect(service.switchRestaurantAndReload(fresh as any, fresh.restaurant_roles[1] as any, '/dashboard'))
      .toBe('principal-changed');
    expect(localStorage.getItem('user')).toBe(before);
    expect(JSON.parse(localStorage.getItem('rest_role')!).restaurant_id).toBe('rest-a');
  });

  it('retireAndReload writes nothing and REPLACES', () => {
    const before = { ...localStorage };
    service.retireAndReload('/login');
    expect({ ...localStorage }).toEqual(before);
    expect(redirect.calls.allArgs()).toEqual([['/login', 'replace']]);
    expect(service.isRetired).toBeTrue();
  });
});

describe('AuthInterceptor — a retired document sends no staff request', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: AuthenticationService;
  const api = `${environment.apiUrl}/api/${environment.version}/menu/`;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({
      token: 't', refresh: 'r', require_otp: false, prompt_password_change: false,
      profile: { id: 'user-1', restaurant_roles: [] },
    }));
    TestBed.configureTestingModule({
      providers: [
        { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthenticationService);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('control: a live document sends, with its bearer token', () => {
    http.get(api).subscribe();
    expect(httpMock.expectOne(api).request.headers.get('Authorization')).toBe('Bearer t');
  });

  it('after retire(), a staff request never reaches the wire and completes silently', () => {
    auth.retire();
    const seen = { next: 0, error: 0, complete: 0 };
    http.get(api).subscribe({ next: () => seen.next++, error: () => seen.error++, complete: () => seen.complete++ });
    httpMock.expectNone(api);
    expect(seen).toEqual({ next: 0, error: 0, complete: 1 });
  });

  it('a non-API URL is not the interceptor\'s business and still goes', () => {
    auth.retire();
    http.get('/assets/i18n.json').subscribe();
    httpMock.expectOne('/assets/i18n.json').flush({});
  });
});
