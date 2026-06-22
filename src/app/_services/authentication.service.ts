import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, of, map, catchError } from 'rxjs';
import { ApiResponse, LoginResponse, ModuleKey, OTPResponse, PermissionsMap, RestaurantDetail, RestaurantRole} from '../_models/app.models';
import { HttpBackend, HttpClient } from '@angular/common/http';
import { environment } from 'src/environments/environment';
import { canAccess as canAccessModule, firstAccessibleRoute as firstAccessibleModuleRoute } from '../_helpers/module-access';

/**
 * Persisted state keys that survive operator logout. Everything else under
 * the [dinify] localStorage prefix is cleared on logout so each session
 * starts from each module's default navigational state (selected section,
 * active view, area filter, etc.). Viewing preferences — how the operator
 * likes things displayed — go here.
 *
 * Match is by key prefix (the part before any :<restaurantId> suffix), so
 * `menu.sortMode:` covers `menu.sortMode:abc-123`, `menu.sortMode:def-456`,
 * etc. across multiple restaurant memberships.
 */
const LOGOUT_PRESERVE_PREFIXES: readonly string[] = [
  '[dinify]menu.sortMode:',
] as const;

@Injectable({
  providedIn: 'root'
})
export class AuthenticationService {
  private userSubject: BehaviorSubject<LoginResponse | null>;
  public user: Observable<LoginResponse | null>;
  private _base = `${environment.apiUrl}/api/${environment.version}`;
  private rawHttp: HttpClient;

  constructor(
      private router: Router,
      private http: HttpClient,
      httpBackend: HttpBackend
  ) {
      this.userSubject = new BehaviorSubject(JSON.parse(localStorage.getItem('user')!));
      this.user = this.userSubject.asObservable();
      // Bypasses interceptors so refresh requests can't recurse through ErrorInterceptor.handle401.
      this.rawHttp = new HttpClient(httpBackend);
  }

  public get userValue() {
      return this.userSubject.value;
  }

  public get currentRestaurantRole(){
    return JSON.parse(localStorage.getItem('rest_role') as any) as unknown as RestaurantRole
  }
  public get currentRestaurant(){
    return JSON.parse(localStorage.getItem('current_resta') as any) as unknown as RestaurantDetail
  }

  // ── RBAC read-through wrappers ──────────────────────────────────────────
  // Thin delegates over the selected membership's permissions map so the
  // permission guard, sidebar nav, and post-login landing all read one object.
  // The actual logic lives in the pure module-access helpers.

  /** The selected membership's resolved permissions map, if present. */
  permissionsMap(): PermissionsMap | undefined {
    return this.currentRestaurantRole?.permissions;
  }

  /** Whether the current membership may access a module (UX hygiene only). */
  canAccess(key: ModuleKey): boolean {
    return canAccessModule(this.permissionsMap(), key);
  }

  /** The route the current membership should land on / be redirected to. */
  firstAccessibleRoute(): string {
    return firstAccessibleModuleRoute(this.permissionsMap(), this.currentRestaurantRole?.roles);
  }

  login(username: string, password: string,source?:any) {
      return this.http.post<any>(`${this._base}/users/auth/login/`, source?{username,password,source}:{ username, password })
          .pipe(map((response:ApiResponse<LoginResponse>) => {
              const data = response.data as unknown as LoginResponse;
              if (!data.require_otp && !data.prompt_password_change) {
                // Only persist tokens when login is complete (no OTP/password-change pending)
                localStorage.setItem('user', JSON.stringify(data));
                this.userSubject.next(data as any);
              }
              return response;
          }));
  }
  updateProfile(profile:any){
    const u:any =this.userValue;
u.profile=profile;
localStorage.setItem('user', JSON.stringify((u)));
this.userSubject.next(u as any)
  }
  /**
   * Persist user after OTP verification.
   * Takes the original login response (which may not have been persisted if OTP
   * was required) and merges the real tokens from the verify-otp response.
   */
  UpdateUser(otpResponse:OTPResponse, loginResponse?: LoginResponse){
    const base: any = loginResponse || this.userValue;
    if (!base) return null;
    const u = { ...base, token: otpResponse.token, refresh: otpResponse.refresh };
    localStorage.setItem('user', JSON.stringify(u));
    this.userSubject.next(u as any);
    return u;
  }
  setOtp(user:any,otp:any){
    return this.http.post<any>(`${this._base}/users/auth/verify-otp/`,{ user,otp })
    .pipe(map((response:ApiResponse<OTPResponse>) => {
        // store user details and jwt token in local storage to keep user logged in between page refreshes
      //  localStorage.setItem('user', JSON.stringify((response.data)));
      //  this.userSubject.next(response.data as any)
        return response;
    }));
  }
 
  resendOtp(identification:any,identifier:any){
    return this.http.post<any>(`${this._base}/users/auth/resend-otp/`,{"identification": identification, "identifier": identifier,"purpose": 'login'})
    .pipe(map((response:ApiResponse<OTPResponse>) => {
        // store user details and jwt token in local storage to keep user logged in between page refreshes
      //  localStorage.setItem('user', JSON.stringify((response.data)));
      //  this.userSubject.next(response.data as any)
        return response;
    }));
  
  }
 
  setCurrentRestaurantRole(role:any){
    localStorage.setItem('rest_role', JSON.stringify((role)));    
  }
  setCurrentRestaurant(restaurant:any){
    localStorage.setItem('current_resta', JSON.stringify((restaurant)));    
  }

  resetStorage() {
    localStorage.removeItem('rest_role');
    localStorage.removeItem('current_resta');
    localStorage.removeItem('user');
    this.clearPersistedNavState();
  }

  private clearPersistedNavState(): void {
    // Snapshot keys first — mutating localStorage while iterating it by index
    // shifts subsequent indices and skips entries.
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (!key.startsWith('[dinify]')) continue;
      if (LOGOUT_PRESERVE_PREFIXES.some(p => key.startsWith(p))) continue;
      keysToRemove.push(key);
    }
    keysToRemove.forEach(k => {
      try {
        localStorage.removeItem(k);
      } catch (e) {
        console.warn('[auth] failed to clear nav-state key', k, e);
      }
    });
  }

  /**
   * Silent access-token refresh.
   *
   * Backend endpoint is SimpleJWT's TokenRefreshView, which uses the native
   * top-level shape — NOT the wrapped `{data: ...}` envelope used elsewhere
   * in the Dinify API:
   *   POST /api/{version}/users/auth/token/refresh/
   *   Request:  { "refresh": "<refresh-token>" }
   *   Response (ROTATE_REFRESH_TOKENS = False): { "access": "<new-access>" }
   *   Response (ROTATE_REFRESH_TOKENS = True ): { "access": "<new-access>",
   *                                               "refresh": "<new-refresh>" }
   *
   * Handles both shapes. When `refresh` is present in the response (rotation
   * on), the stored refresh token is replaced — otherwise it's left as-is so
   * the existing refresh token continues to be reused (rotation off).
   *
   * This forwards-compatibility ships ahead of the backend rotation flip: a
   * separate backend PR enables ROTATE_REFRESH_TOKENS = True, at which point
   * the original refresh would be blacklisted on first use. Persisting the
   * rotated refresh here means the FE keeps a valid token across the cutover
   * without a coordinated deploy. Until rotation flips on, the `refresh`
   * branch below is a no-op.
   *
   * Uses HttpBackend (rawHttp) to bypass interceptors — otherwise a 401 from
   * this endpoint would re-enter ErrorInterceptor.handle401 and deadlock the
   * single-flight queue.
   *
   * Returns the new access token on success, or null on any failure. Never
   * calls logout(); that decision belongs to ErrorInterceptor.
   */
  attemptTokenRefresh(): Observable<string | null> {
    const user = this.userValue;
    if (!user?.refresh) {
      return of(null);
    }

    return this.rawHttp.post<{ access: string; refresh?: string }>(
      `${this._base}/users/auth/token/refresh/`,
      { refresh: user.refresh }
    ).pipe(
      map((response) => {
        if (!response?.access) {
          return null;
        }
        const updated: any = { ...user, token: response.access };
        if (response.refresh) {
          updated.refresh = response.refresh;
        }
        localStorage.setItem('user', JSON.stringify(updated));
        this.userSubject.next(updated as any);
        return response.access;
      }),
      catchError(() => of(null))
    );
  }

  logout(no_redirect?: boolean) {
    this.resetStorage();
    this.userSubject.next(null);
    if (!no_redirect) {
      // Hard reload so all providedIn:'root' services are destroyed and
      // re-seeded from cleaned localStorage on the next login. Soft
      // navigation would leave in-memory PersistedBehaviorSubject values
      // intact, defeating the storage clear.
      this.hardRedirect('/login');
    }
  }

  /**
   * Logout triggered by client-side inactivity timer (15 min idle).
   * Distinct from logout() so the login page can show a different message,
   * and so the current authenticated route is preserved as returnUrl.
   * Skips returnUrl capture for unauthenticated routes to avoid bouncing
   * the user back to /login or mid-flow auth screens (e.g. lock-otp-exp).
   */
  logoutDueToInactivity() {
    const currentUrl = this.router.url || '';
    const path = currentUrl.split('?')[0];
    const skipReturnUrl =
      !path ||
      path === '/' ||
      path.startsWith('/login') ||
      path.startsWith('/register') ||
      path.startsWith('/forgot-password') ||
      path.startsWith('/lock-otp-exp');

    this.resetStorage();
    this.userSubject.next(null);

    const params = new URLSearchParams({ reason: 'inactivity' });
    if (!skipReturnUrl) {
      params.set('returnUrl', currentUrl);
    }
    this.hardRedirect(`/login?${params.toString()}`);
  }

  // Indirection over `window.location.href = url` so unit tests can spy on
  // navigation without actually unloading the Karma host page.
  protected hardRedirect(url: string): void {
    window.location.href = url;
  }
}
