import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, ReplaySubject, Subscription, TimeoutError, defer, of, map, take, timeout } from 'rxjs';
import { ApiResponse, LoginResponse, ModuleKey, OTPResponse, PermissionsMap, RestaurantDetail, RestaurantRole} from '../_models/app.models';
import { HttpBackend, HttpClient, HttpErrorResponse, HttpRequest } from '@angular/common/http';
import { environment } from 'src/environments/environment';
import { canAccess as canAccessModule, firstAccessibleRoute as firstAccessibleModuleRoute } from '../_helpers/module-access';
import { CREDENTIAL_HEADER, SESSION_HEADER } from '../_security/diner-capability-contract';

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

/**
 * How long ONE request waits for a shared session renewal before it gives up
 * on recovery. The wait belongs to the REQUEST, not to the renewal: a waiter
 * that times out has ended its own recovery for good, and the renewal carries
 * on for anybody else still waiting. It deliberately leaves the consumers' own
 * limits alone (kitchen 8 s poll / 15 s command, checkout 30 s): whichever is
 * shorter ends that request first.
 */
export const REFRESH_WAIT_MS = 10_000;

/**
 * The hard cap on the renewal TRANSPORT. Fixed when the flight starts, so a
 * request that joins late never extends it. When it fires the flight settles
 * `unavailable/timeout` and its slot is released, so a later request can try
 * again. The server may already have rotated the refresh token by then — that
 * is recorded as uncertainty, not something this client can recover.
 */
export const REFRESH_TRANSPORT_CAP_MS = 60_000;

/** Why a renewal could not establish a verdict about the credential. */
export type RenewalUnavailableCause =
  | 'transport'    // no HTTP answer (status 0) — NOT proof the device is offline
  | 'timeout'      // the transport cap, or this request's own wait bound
  | 'server'       // 5xx
  | 'protocol'     // an answer that is not the refresh contract (malformed 200, 400, 403, 429, HTML…)
  | 'persistence'; // renewed, but the new credentials could not be durably written

/**
 * The terminal outcome of a session renewal, as seen by one request.
 *
 *  - `renewed`     — the owned session holds a new, durably persisted access token.
 *  - `rejected`    — the refresh endpoint refused the credential, or this
 *                    session holds no usable refresh token. The ONLY outcome
 *                    that proves the session is over.
 *  - `unavailable` — no verdict. The session and its evidence are kept.
 *  - `superseded`  — the session that asked no longer owns the answer (logout,
 *                    a replacement login, an adoption, a reset, or a visible
 *                    replacement in shared storage). Nothing was written.
 */
export type RenewalOutcome =
  | { readonly kind: 'renewed'; readonly access: string }
  // `ended`: the refusal ended the session this renewal belonged to — the
  // service did that ONCE, before any waiter heard the answer.
  | { readonly kind: 'rejected'; readonly ended: boolean }
  | { readonly kind: 'unavailable'; readonly cause: RenewalUnavailableCause }
  | { readonly kind: 'superseded' };

/**
 * Who a request belongs to, captured BEFORE it is dispatched.
 *
 * `session` and `context` are opaque generations: the first moves whenever the
 * signed-in session is adopted, replaced, reset or ended (never on a renewal),
 * the second whenever the SELECTED restaurant actually changes. `token` is the
 * access credential the request actually carried. It lives only in memory, for
 * the lifetime of that one request — it is never persisted or logged, and no
 * history of past tokens is kept anywhere.
 */
export interface RequestOwner {
  readonly session: number;
  readonly context: number;
  readonly restaurantId: string | null;
  readonly token: string;
}

interface RenewalFlight {
  readonly session: number;
  readonly presentedRefresh: string;
  readonly outcome: ReplaySubject<RenewalOutcome>;
}

const SUPERSEDED: RenewalOutcome = { kind: 'superseded' };
const REJECTED: RenewalOutcome = { kind: 'rejected', ended: false };
const unavailable = (cause: RenewalUnavailableCause): RenewalOutcome =>
  ({ kind: 'unavailable', cause });

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Is this failure the refresh endpoint REFUSING the credential?
 *
 * The pinned backend (SimpleJWT 5.5.1 behind `GatedTokenRefreshView`) answers
 * an expired, blacklisted, invalid, platform-staff or pending-claim refresh
 * token with 401 `{detail, code: 'token_not_valid'}`, and an inactive account
 * with 401 `{detail}` and no code. Anything else — including a 400 for a
 * missing field, a 403, a 429 or an HTML 401 from something in front of the
 * API — is not proof that the credential expired.
 */
function isRefreshCredentialRefusal(err: HttpErrorResponse): boolean {
  if (err.status !== 401) return false;
  const body = err.error;
  if (!body || typeof body !== 'object' || typeof body.detail !== 'string') return false;
  return body.code === 'token_not_valid' || body.code === undefined;
}

function classifyRenewalFailure(err: unknown): RenewalOutcome {
  if (err instanceof TimeoutError) return unavailable('timeout');
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return unavailable('transport');
    if (isRefreshCredentialRefusal(err)) return REJECTED;
    if (err.status >= 500) return unavailable('server');
    return unavailable('protocol');
  }
  return unavailable('protocol');
}

/**
 * Does this URL target the configured Dinify API — same origin, under its base
 * path — rather than merely START with the same characters? A lookalike host
 * (`https://api.example.com.evil.test/…`) or prefix (`/uatx/…`) is not ours.
 */
function isTrustedApiUrl(url: string): boolean {
  let base: URL;
  let target: URL;
  try {
    base = new URL(environment.apiUrl);
    target = new URL(url);
  } catch {
    return false;
  }
  if (target.origin !== base.origin) return false;
  const basePath = base.pathname.replace(/\/+$/, '');
  return target.pathname.startsWith(`${basePath}/api/`);
}

@Injectable({
  providedIn: 'root'
})
export class AuthenticationService {
  private userSubject: BehaviorSubject<LoginResponse | null>;
  public user: Observable<LoginResponse | null>;
  private _base = `${environment.apiUrl}/api/${environment.version}`;
  private rawHttp: HttpClient;

  // ── Session / context ownership (D09) ──────────────────────────────────
  // All in memory. Nothing here is a credential store or a token history.

  /** Moves on every adoption, replacement, reset and logout intent. Never on a renewal. */
  private sessionGeneration = 0;
  /** Moves only when a session is ADOPTED (login, OTP, owner-claim install). */
  private adoptionGeneration = 0;
  /** Moves only when the SELECTED restaurant identity actually changes. */
  private contextGeneration = 0;
  /** The session generation a logout is currently ending, or null. */
  private exitingSession: number | null = null;
  /** The one renewal in flight for the current session, or null. */
  private flight: RenewalFlight | null = null;

  constructor(
      private http: HttpClient,
      httpBackend: HttpBackend
  ) {
      this.userSubject = new BehaviorSubject(JSON.parse(localStorage.getItem('user')!));
      this.user = this.userSubject.asObservable();
      // Bypasses interceptors so refresh requests can't recurse through ErrorInterceptor's 401 recovery.
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
                this.markAdoption();
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
    this.markAdoption();
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
    this.markAdoption();
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

  /**
   * Select the membership the portal acts in.
   *
   * A change of the selected restaurant IDENTITY moves the context generation,
   * which ends replay authority for every request issued in the previous
   * context — including A→B→A, where the start and end values match but the
   * request was issued in a context that has since been left. It does NOT end
   * the login: a renewal still owned by this session may keep its credentials.
   */
  setCurrentRestaurantRole(role:any){
    if (this.restaurantIdOf(this.readStored('rest_role'), 'restaurant_id')
        !== this.restaurantIdOf(role, 'restaurant_id')) {
      this.contextGeneration += 1;
    }
    localStorage.setItem('rest_role', JSON.stringify((role)));    
  }

  /**
   * Store the selected restaurant's DETAIL record. The shell re-fetches and
   * re-stores it on every load, so only a change of restaurant identity counts
   * as a context change — refreshed detail for the same restaurant does not.
   */
  setCurrentRestaurant(restaurant:any){
    if (this.restaurantIdOf(this.readStored('current_resta'), 'id')
        !== this.restaurantIdOf(restaurant, 'id')) {
      this.contextGeneration += 1;
    }
    localStorage.setItem('current_resta', JSON.stringify((restaurant)));    
  }

  /**
   * Clear the persisted principal and the per-module nav state.
   *
   * STORAGE, PLUS ONE FENCE. It moves the session generation, so no renewal or
   * request recovery begun before the reset can write, replay or log out after
   * it. It does NOT otherwise end a session: every `providedIn: 'root'` service
   * survives it as the same instance, still holding whatever tenant data it had
   * in memory. The service's own callers pair it with a full page load for
   * exactly that reason — `revokeAndExit` on logout, and
   * `installAuthenticatedSessionAndReload` when one operator replaces another.
   * It is also public and called directly (the login screen clears before every
   * attempt). A caller that clears storage and then SOFT-navigates is carrying
   * the old tenant's cached data into the next session.
   */
  resetStorage() {
    // A reset ends whatever session this document was acting for: no renewal
    // or request recovery begun before it may write, replay or log out after it.
    this.bumpSession();
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

  // ── Request ownership and session renewal (D09) ───────────────────────

  /**
   * Capture who a request belongs to, BEFORE it is dispatched.
   *
   * Returns an owner only for a request this session's staff credential was
   * actually attached to: a trusted API URL (origin and base path, not a string
   * prefix), carrying exactly `Bearer <current access token>`, and no diner
   * capability header. An anonymous or diner request, a request to another
   * origin, one carrying a caller-supplied credential, or one issued while a
   * logout is in progress has no owner — and therefore no staff recovery.
   */
  captureRequestOwner(request: HttpRequest<unknown>): RequestOwner | null {
    const token = this.userValue?.token;
    if (!nonEmptyString(token)) return null;
    if (this.exitingSession === this.sessionGeneration) return null;
    if (!isTrustedApiUrl(request.url)) return null;
    if (request.headers.get('Authorization') !== `Bearer ${token}`) return null;
    if (request.headers.has(CREDENTIAL_HEADER) || request.headers.has(SESSION_HEADER)) return null;
    return {
      session: this.sessionGeneration,
      context: this.contextGeneration,
      restaurantId: this.currentRestaurantId(),
      token,
    };
  }

  /**
   * Does this owner still describe the session AND the selected context this
   * document is acting in? A renewal does not change the answer; an adoption,
   * reset, logout or restaurant switch does.
   */
  ownerIsCurrent(owner: RequestOwner): boolean {
    return owner.session === this.sessionGeneration
      && this.exitingSession !== this.sessionGeneration
      && owner.context === this.contextGeneration
      && owner.restaurantId === this.currentRestaurantId()
      && nonEmptyString(this.userValue?.token);
  }

  /** The access token the current session holds, or null. */
  currentAccessToken(): string | null {
    const token = this.userValue?.token;
    return nonEmptyString(token) ? token : null;
  }

  /**
   * Renew the current session's access token, on behalf of one request.
   *
   * ONE FLIGHT PER SESSION, OWNED BY THIS SERVICE. The refresh request is
   * subscribed here, not by any caller, so a caller that unsubscribes or times
   * out cannot abort a renewal others are waiting on, and cannot leave a latch
   * behind. Each caller waits at most `REFRESH_WAIT_MS`; the transport itself
   * is capped at `REFRESH_TRANSPORT_CAP_MS` from when the flight started, and a
   * late joiner does not extend that. A completed flight — whatever its
   * outcome — releases its own slot and nothing else, so a later request may
   * try again; there is no automatic retry inside a flight.
   *
   * THE SERVICE ONLY EVER TOUCHES CREDENTIALS. It never replays a request:
   * that decision stays with the request that asked, after its own ownership
   * checks. A slow success that lands after every waiter has gone may still
   * persist for the session that owns it — and only for that session.
   *
   * Uses `rawHttp` (bypasses interceptors, sends no Authorization) so a 401
   * from the refresh endpoint can never re-enter request recovery.
   */
  renewSession(owner: RequestOwner): Observable<RenewalOutcome> {
    return defer(() => {
      if (!this.ownerIsCurrent(owner)) return of(SUPERSEDED);
      const flight = this.flight ?? this.startFlight();
      if (!flight) return of(REJECTED);
      return flight.outcome.pipe(
        take(1),
        timeout({ first: REFRESH_WAIT_MS, with: () => of(unavailable('timeout')) }),
      );
    });
  }

  /**
   * End the session because ONE request's owned credential was definitively
   * refused. Does nothing — and returns false — unless the owner is still the
   * current session and context AND the refused credential is still the one
   * this session holds: an old request refused after a renewal, a restaurant
   * switch, a replacement login or a logout must never end its successor.
   */
  endOwnedSession(owner: RequestOwner, refusedToken: string): boolean {
    if (!this.ownerIsCurrent(owner)) return false;
    if (this.currentAccessToken() !== refusedToken) return false;
    this.logout();
    return true;
  }

  private startFlight(): RenewalFlight | null {
    const presentedRefresh = this.userValue?.refresh;
    if (!nonEmptyString(presentedRefresh)) return null;
    const flight: RenewalFlight = {
      session: this.sessionGeneration,
      presentedRefresh,
      outcome: new ReplaySubject<RenewalOutcome>(1),
    };
    this.flight = flight;
    // Held by the SERVICE for the flight's whole life. Not stored: nothing
    // ever unsubscribes it early — the transport cap ends it.
    const transport: Subscription = this.rawHttp.post<unknown>(
      `${this._base}/users/auth/token/refresh/`,
      { refresh: presentedRefresh },
    ).pipe(
      timeout(REFRESH_TRANSPORT_CAP_MS),
    ).subscribe({
      next: (body) => this.settleFlight(flight, this.adoptRenewal(flight, body)),
      error: (err) => this.settleFlight(flight, classifyRenewalFailure(err)),
    });
    void transport;
    return flight;
  }

  /**
   * Settle a flight once, and release ONLY its own slot.
   *
   * The slot is released BEFORE anybody hears the answer: a waiter reacting
   * to it may end or start a session, and must find no half-settled flight.
   *
   * A refusal of the refresh token THIS session presented is the verdict on
   * the session, so the service ends it here, exactly once, and tells every
   * waiter so. Leaving that to the first waiter was a defect: its logout
   * superseded the session under the others, and they reported a context
   * change for what was in fact the same expired session.
   */
  private settleFlight(flight: RenewalFlight, outcome: RenewalOutcome): void {
    if (this.flight === flight) this.flight = null;
    let settled = flight.session === this.sessionGeneration ? outcome : SUPERSEDED;
    if (settled.kind === 'rejected'
        && (this.userValue as { refresh?: unknown } | null)?.refresh === flight.presentedRefresh) {
      this.logout();
      settled = { kind: 'rejected', ended: true };
    }
    flight.outcome.next(settled);
    flight.outcome.complete();
  }

  /**
   * Persist a renewal — only if it is complete and still owned.
   *
   * The current contract rotates AND blacklists (`ROTATE_REFRESH_TOKENS`,
   * `BLACKLIST_AFTER_ROTATION`), so a success must carry BOTH a new access and
   * a new refresh token; a partial 200 is unreadable, not a success.
   *
   * Ownership is checked three ways before anything is written: the session
   * generation is unchanged, the in-memory refresh token is still the one that
   * was presented, and the VISIBLE persisted session still holds it too. If
   * another document replaced or removed the persisted session, that is a
   * replacement: the answer is superseded and storage is left untouched. This
   * client never adopts another tab's credentials — not even a same-profile
   * session. LIMITATION: localStorage read-compare-write is not atomic across
   * documents, so this narrows a cross-tab race; it does not close it.
   *
   * Only the two tokens are merged, into the CURRENT principal, so profile or
   * membership data updated while the refresh was in flight is preserved.
   */
  private adoptRenewal(flight: RenewalFlight, body: unknown): RenewalOutcome {
    if (flight.session !== this.sessionGeneration) return SUPERSEDED;
    const answer = body as { access?: unknown; refresh?: unknown } | null;
    if (!answer || typeof answer !== 'object'
        || !nonEmptyString(answer.access) || !nonEmptyString(answer.refresh)) {
      return unavailable('protocol');
    }
    const current = this.userValue as (LoginResponse & { refresh?: string }) | null;
    if (!current || current.refresh !== flight.presentedRefresh) return SUPERSEDED;
    const stored = this.readStored('user');
    if (!stored || stored.refresh !== flight.presentedRefresh) return SUPERSEDED;

    const updated = { ...current, token: answer.access, refresh: answer.refresh };
    let durable: boolean;
    try {
      localStorage.setItem('user', JSON.stringify(updated));
      const back = this.readStored('user');
      durable = back?.token === answer.access && back?.refresh === answer.refresh;
    } catch {
      durable = false;
    }
    // The server has already rotated: the new pair is the only live credential
    // this session has, so this document keeps using it either way. What is
    // NOT claimed, when the write did not stick, is that the renewal is durable.
    this.userSubject.next(updated as any);
    return durable ? { kind: 'renewed', access: answer.access } : unavailable('persistence');
  }

  /** Invalidate every recovery and renewal belonging to the current session. */
  private bumpSession(): void {
    this.sessionGeneration += 1;
    const flight = this.flight;
    this.flight = null;
    if (flight) this.settleFlight(flight, SUPERSEDED);
  }

  /** A new session has been adopted in this document. */
  private markAdoption(): void {
    this.bumpSession();
    this.adoptionGeneration += 1;
  }

  private currentRestaurantId(): string | null {
    return this.restaurantIdOf(this.readStored('rest_role'), 'restaurant_id');
  }

  private restaurantIdOf(value: any, key: 'restaurant_id' | 'id'): string | null {
    const id = value?.[key];
    return id === undefined || id === null ? null : String(id);
  }

  private readStored(key: string): any {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      return undefined;
    }
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
   * - Use rawHttp (bypasses interceptors): ErrorInterceptor's 401 recovery can
   *   call logout(), so an interceptor-wrapped logout that 401s would recurse. Since
   *   we bypass the JWT interceptor, attach the Authorization header explicitly.
   * - hardRedirect is a full page load that cancels in-flight requests, so we do
   *   NOT fire-and-forget: storage-clear + redirect run once, from a single
   *   settled exit, on BOTH the success and error paths.
   * - A slow/failed revoke must never trap the user: a timeout backstops the
   *   request so the redirect always proceeds.
   * - No refresh token → skip the POST and exit immediately (prior behaviour).
   */
  private revokeAndExit(redirectTarget: string | null): void {
    // IDEMPOTENT PER OUTGOING SESSION. A second logout for the session that is
    // already ending (several requests refused at once, inactivity racing an
    // explicit sign-out) sends no second revoke and no second redirect. It is
    // not a permanent latch: the next adopted session can log out again.
    if (this.exitingSession === this.sessionGeneration) return;

    const user = this.userValue;
    const refresh = user?.refresh;
    const access = user?.token;

    // FENCE AT INTENT, before the bounded revoke even starts. From here every
    // renewal and request recovery belonging to the outgoing session is
    // superseded: none of them may persist, replay, revoke, clear, redirect or
    // log anything out on its behalf.
    this.bumpSession();
    this.exitingSession = this.sessionGeneration;
    const adoptionAtIntent = this.adoptionGeneration;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      // FENCE AT COMPLETION. A session adopted while the revoke was pending
      // (a fresh login, an OTP adoption, an owner-claim install) is not the one
      // being ended, and this late completion must not clear or redirect it.
      if (this.adoptionGeneration !== adoptionAtIntent) return;
      // Destroy only storage that still belongs to the outgoing session. A
      // VISIBLE replacement (another document signed in while this one was
      // ending ITS session) is left untouched. A document ending no session of
      // its own keeps the long-standing clear-everything behaviour. Same
      // non-atomic limit as renewal: this narrows a cross-tab race only.
      const hadSession = access !== undefined || refresh !== undefined;
      const stored = this.readStored('user');
      const replaced = hadSession && stored !== null
        && (stored?.token !== access || stored?.refresh !== refresh);
      if (!replaced) {
        this.resetStorage();
      }
      this.userSubject.next(null);
      if (redirectTarget) {
        this.hardRedirect(redirectTarget);
      }
    };

    if (!refresh) {
      finish();
      return;
    }

    // A bounded ATTEMPT to revoke. It does not prove the server session ended:
    // an already-expired access token is refused before the logout handler
    // runs, and the endpoint blacklists only the refresh token it is handed.
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
