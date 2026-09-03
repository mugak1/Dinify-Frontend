import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of, map, catchError, timeout } from 'rxjs';
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

/**
 * Upper bound on how long logout waits for the server-side refresh-token
 * revocation before proceeding to clear storage and redirect anyway. A slow
 * or failed revoke must never trap the user on the page.
 */
const LOGOUT_REVOKE_TIMEOUT_MS = 2000;

@Injectable({
  providedIn: 'root'
})
export class AuthenticationService {
  private userSubject: BehaviorSubject<LoginResponse | null>;
  public user: Observable<LoginResponse | null>;
  private _base = `${environment.apiUrl}/api/${environment.version}`;
  private rawHttp: HttpClient;

  constructor(
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
 
  /**
   * Install an ALREADY-AUTHENTICATED, COMPLETE principal and RELOAD THE PAGE onto
   * `landingPath`.
   *
   * The one sanctioned way to seat a session this service did not itself mint. Its
   * only caller is owner-claim redemption (backend Step 2F.2 + 2F.3), which
   * authenticates out-of-band against `users/owner-claim/redeem/` and then hydrates
   * the canonical profile from `GET users/user-profile/` — a flow that cannot go
   * through `login()` at all, because an owner membership sets `require_otp` and
   * would demand a SECOND verification code moments after the claim transaction
   * consumed its own.
   *
   * ═══ THE RELOAD IS PART OF THE OPERATION, NOT A NAVIGATION DETAIL ═════════════
   *
   * It is named `…AndReload` because a caller must not be able to treat the full-page
   * boundary as optional. CLEARING STORAGE IS NOT ENOUGH TO REPLACE AN OPERATOR.
   * `resetStorage()` empties localStorage, but every `providedIn: 'root'` service is
   * still the SAME INSTANCE afterwards, still holding the PREVIOUS tenant's data in
   * its in-memory subjects. `MenuService._rawSections$` / `_allItems$` are the
   * concrete example: they are BehaviorSubjects, so `sections$` KEEPS EMITTING the
   * outgoing restaurant's menu from the moment the principal changes until a
   * replacement read for the incoming one settles — and anything rendering off that
   * subject in the meantime paints one tenant's data inside another tenant's
   * session.
   *
   * Owner claim can begin while a DIFFERENT operator is signed in — that is a
   * supported entry, since the route is public — so a soft `router.navigateByUrl`
   * here would carry one tenant's cached data into another tenant's session. The
   * hard navigation is what destroys the Angular injector and forces every root
   * service to be reconstructed under the new principal. This is the same reasoning
   * `revokeAndExit` already relies on for ordinary logout; here it matters more,
   * because the outgoing and incoming principals can differ.
   *
   * Do NOT "optimise" this into a router navigation, and do NOT try to substitute a
   * hand-maintained list of root caches to clear — that list drifts the moment
   * another root service starts holding tenant data.
   *
   * The navigation REPLACES the current history entry rather than pushing onto it,
   * so the pre-claim document cannot be restored by Back (see `hardRedirect`'s
   * `mode`). Destroying a document achieves nothing if the browser can return it
   * intact from the back-forward cache.
   *
   * ═══ WHAT THE ARGUMENTS GUARANTEE ════════════════════════════════════════════
   *
   * Deliberately NOT a generic `setUser(any)`. All three arguments are typed and
   * required, so a caller cannot seat a half-built principal:
   *  - `session` must be a COMPLETE LoginResponse (tokens AND the canonical
   *    profile). AuthGuard reads `profile.restaurant_roles`, so persisting a
   *    session whose profile has not arrived yet creates a browser that believes
   *    it is authenticated and has no memberships to authorise with. The caller
   *    must therefore hold its tokens in memory until the profile read succeeds.
   *  - `membership` must be an entry taken FROM `session.profile.restaurant_roles`
   *    — the resolved object itself, carrying the backend's `permissions` map.
   *    Never a hand-built `{restaurant_id, roles:['owner']}`: the frontend cannot
   *    compute a permissions map, and inventing one puts a second, wrong source of
   *    truth in front of the real one.
   *  - `landingPath` must already be resolved (the caller runs the same
   *    `firstAccessibleRoute` login uses). It is the reload TARGET, so it is read
   *    before anything is written and never re-derived from storage afterwards.
   *
   * MINTS NOTHING. No token request, no refresh, no `login()`, no `verify-otp`, no
   * OTP of any kind — the credentials are handed in, already established.
   *
   * ORDER IS LOAD-BEARING: every write lands BEFORE the reload is triggered, so the
   * restarted application reads the new principal rather than racing it.
   * `resetStorage()` goes first, so a PREVIOUS operator's `rest_role`,
   * `current_resta` and per-module persisted nav state cannot survive underneath the
   * new principal.
   */
  installAuthenticatedSessionAndReload(
    session: LoginResponse,
    membership: RestaurantRole,
    landingPath: string,
  ): void {
    this.resetStorage();
    localStorage.setItem('user', JSON.stringify(session));
    this.userSubject.next(session);
    this.setCurrentRestaurantRole(membership);
    // LAST. Full page load: the Angular injector and every providedIn:'root'
    // service go with it, which is the only thing that clears the outgoing
    // operator's in-memory tenant data.
    //
    // REPLACE, not push. Destroying the document is not enough if the browser can
    // hand it straight back: `location.href` would leave the pre-claim document in
    // history, and a bfcache restore returns its whole JS heap — the hybrid state
    // where this service has published the INCOMING principal while the other root
    // services still hold the OUTGOING tenant's data. `location.replace` leaves no
    // history entry pointing at it.
    this.hardRedirect(landingPath, 'replace');
  }

  setCurrentRestaurantRole(role:any){
    localStorage.setItem('rest_role', JSON.stringify((role)));    
  }
  setCurrentRestaurant(restaurant:any){
    localStorage.setItem('current_resta', JSON.stringify((restaurant)));    
  }

  /**
   * Clear the persisted principal and the per-module nav state.
   *
   * STORAGE ONLY. This does NOT end a session on its own: every
   * `providedIn: 'root'` service survives it as the same instance, still holding
   * whatever tenant data it had in memory. Both callers pair it with a full page
   * load for exactly that reason — `revokeAndExit` on logout, and
   * `installAuthenticatedSessionAndReload` when one operator replaces another. A new
   * caller that clears storage and then SOFT-navigates is carrying the old tenant's
   * cached data into the next session.
   */
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
    // Hard reload (in revokeAndExit) so all providedIn:'root' services are
    // destroyed and re-seeded from cleaned localStorage on the next login. Soft
    // navigation would leave in-memory PersistedBehaviorSubject values intact,
    // defeating the storage clear.
    this.revokeAndExit(no_redirect ? null : '/login');
  }

  /**
   * Logout triggered by client-side inactivity timer (15 min idle).
   * Distinct from logout() so the login page can show a different message
   * (the `reason=inactivity` banner). Like logout(), it does NOT preserve the
   * current route: the post-login redirect always lands the user on their first
   * accessible module, so there is no returnUrl to capture.
   */
  logoutDueToInactivity() {
    this.revokeAndExit('/login?reason=inactivity');
  }

  /**
   * Shared logout tail: revoke the refresh token server-side, then clear local
   * state and (optionally) redirect. Blacklisting the refresh token is what
   * makes "sign out" actually end the server session — without it the token
   * stays valid for its full refresh lifetime after logout.
   *
   * Sequencing rules baked in here:
   * - Capture the access + refresh tokens BEFORE resetStorage() wipes them.
   * - Use rawHttp (bypasses interceptors): ErrorInterceptor.handle401 calls
   *   logout(), so an interceptor-wrapped logout that 401s would recurse. Since
   *   we bypass the JWT interceptor, attach the Authorization header explicitly.
   * - hardRedirect is a full page load that cancels in-flight requests, so we do
   *   NOT fire-and-forget: storage-clear + redirect run once, from a single
   *   settled exit, on BOTH the success and error paths.
   * - A slow/failed revoke must never trap the user: a timeout backstops the
   *   request so the redirect always proceeds.
   * - No refresh token → skip the POST and exit immediately (prior behaviour).
   */
  private revokeAndExit(redirectTarget: string | null): void {
    const user = this.userValue;
    const refresh = user?.refresh;
    const access = user?.token;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      this.resetStorage();
      this.userSubject.next(null);
      if (redirectTarget) {
        this.hardRedirect(redirectTarget);
      }
    };

    if (!refresh) {
      finish();
      return;
    }

    this.rawHttp
      .post(
        `${this._base}/users/auth/logout/`,
        { refresh },
        access ? { headers: { Authorization: `Bearer ${access}` } } : {},
      )
      .pipe(timeout(LOGOUT_REVOKE_TIMEOUT_MS))
      .subscribe({ next: () => finish(), error: () => finish() });
  }

  /**
   * The full-page navigation primitive.
   *
   * Deliberately PROTECTED. It is reachable only through an operation that has
   * already put storage in a consistent state — `revokeAndExit` (logout) or
   * `installAuthenticatedSessionAndReload` (owner claim) — so no caller can trigger
   * a reload without having decided what the reloaded app should find. A public
   * `hardRedirect(url)` would be a bare `window.location` with extra steps.
   *
   * Its real execution destroys the Angular injector and with it every
   * `providedIn: 'root'` service, which is the property both callers depend on. The
   * indirection exists so unit tests can spy on that boundary without unloading the
   * Karma host page.
   *
   * ═══ `mode` — WHETHER THE OUTGOING DOCUMENT STAYS REACHABLE ══════════════════
   *
   * `'push'` (`location.href`, the default) leaves the outgoing document as a
   * history entry, so Back can return to it — and the browser's back-forward cache
   * may restore its ENTIRE JS heap rather than re-executing the page, injector and
   * root services included.
   *
   * `'replace'` (`location.replace`) replaces the current history entry instead, so
   * nothing points at the outgoing document and Back cannot restore it.
   *
   * WHICH ONE A CALLER NEEDS DEPENDS ON WHAT ITS OUTGOING DOCUMENT CONTAINS.
   * `installAuthenticatedSessionAndReload` requires `'replace'`: by the time it
   * navigates, that document is a HYBRID — this service has already published the
   * INCOMING principal while every other root service still holds the OUTGOING
   * tenant's data. Restoring one document holding both is the exact condition the
   * reload exists to destroy, so it must not remain reachable. (It also has no
   * legitimate use: the claim code is spent, so going Back to the claim screen can
   * only show a stale spinner.) Logout keeps `'push'`: its outgoing document is
   * internally consistent — one operator's services beside a `userSubject` this
   * service set to null — and its history behaviour is deliberately unchanged here.
   */
  protected hardRedirect(url: string, mode: 'push' | 'replace' = 'push'): void {
    if (mode === 'replace') {
      window.location.replace(url);
      return;
    }
    window.location.href = url;
  }
}
