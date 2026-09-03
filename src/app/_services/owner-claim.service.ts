import { Injectable } from '@angular/core';
import { HttpBackend, HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, catchError, map, throwError } from 'rxjs';
import { environment } from 'src/environments/environment';
import { Profile } from '../_models/app.models';

/**
 * The owner-claim transport — backend Steps 2F.1 / 2F.2 / 2F.3.
 *
 * ═══ WHY THIS SERVICE BUILDS ITS OWN HttpClient ═══════════════════════════════
 *
 * All three calls go through an HttpClient constructed directly from `HttpBackend`,
 * so NO interceptor runs on them. That is a correctness requirement, not a tidiness
 * preference, and it closes two distinct defects:
 *
 *  1. AMBIENT AUTHORITY LEAKING INTO THE CLAIM. `AuthInterceptor` attaches
 *     `Authorization: Bearer <userValue.token>` to every request at `apiUrl` when
 *     anyone is signed in. The claim endpoints declare `authentication_classes = []`
 *     on the backend precisely so that no ambient credential — a customer JWT, a
 *     delegated session, an admin cookie — can influence WHICH invitation resolves
 *     or WHICH identity is established. Sending a stale operator's token alongside a
 *     claim would contradict that design from this side of the wire, even though the
 *     server ignores it. The credential for these two calls is the claim token and
 *     nothing else.
 *
 *  2. THE BOOTSTRAP READING THE WRONG PRINCIPAL. This is the one that would produce
 *     a genuinely wrong answer. `GET users/user-profile/` returns the profile of
 *     WHOEVER the bearer token names. If `AuthInterceptor` ran, it would overwrite
 *     the freshly-minted redemption token with the PREVIOUSLY persisted user's, and
 *     the claimant would be handed somebody else's memberships and then have them
 *     installed as their own session. The bootstrap must present the exact access
 *     token redemption just returned, so it sets that header itself.
 *
 * `ErrorInterceptor` is bypassed as a consequence, so this service owns its own error
 * translation (see `toOwnerClaimError`) instead of inheriting the global toasts,
 * 401-refresh and logout behaviour — all of which would be wrong here anyway: a 401
 * on the bootstrap must not log the ambient operator out, and a claim refusal is a
 * sentence the screen renders inline rather than a toast.
 *
 * ═══ WHAT THIS SERVICE DOES NOT HOLD ══════════════════════════════════════════
 *
 * IT IS STATELESS, and deliberately so. The raw claim token is passed in on every
 * call and never stored on the instance: this service is `providedIn: 'root'`, so a
 * field here would outlive the claim screen and keep a bearer credential in memory
 * for the rest of the browser session. The component owns the token for exactly as
 * long as its own lifetime — see `OwnerClaimComponent`.
 *
 * The token is never written to a URL, a query parameter, a body, storage, a cookie,
 * navigation state or a log. `X-Owner-Claim-Token` is its only transport, matching
 * the backend's single canonical extractor.
 */

/** How a claim call failed, in terms the screen can act on. */
export type OwnerClaimErrorKind =
  /** No response reached us at all (status 0) — offline, DNS, or the server is down. */
  | 'offline'
  /** 429 from the per-IP claim throttle. */
  | 'rate_limited'
  /**
   * The backend's ONE public claim refusal, or another shaped 400. Its sentence is
   * rendered VERBATIM and is never interpreted — see `toOwnerClaimError`.
   */
  | 'refused'
  /** A 400 carrying `errors.new_password`: Django's configured password validators. */
  | 'password'
  /** 5xx. On the challenge this is the backend's OTP-delivery failure. */
  | 'server'
  /** 401/403 — only reachable on the profile bootstrap, with the redemption token. */
  | 'unauthorized'
  /** A 2xx whose body did not carry the contracted fields. */
  | 'malformed'
  | 'unknown';

export interface OwnerClaimError {
  kind: OwnerClaimErrorKind;
  /** The sentence to show. The backend's own wherever it sent one. */
  message: string;
  /** Configured Django password-validator messages. Only when kind === 'password'. */
  passwordErrors?: string[];
  status: number;
}

/** Step 2F.1 — the one boolean the challenge returns. */
export interface OwnerClaimChallengeResult {
  /**
   * Whether redemption must carry a chosen password (a brand-new owner identity in
   * `pending_initial_claim`) or must NOT (an established owner claiming an additional
   * restaurant, whose credential must not be rewritten).
   *
   * READ FROM THE SERVER AND NEVER INFERRED. There is no other fact on this client
   * that implies it, and guessing is wrong in both directions: omitting a required
   * password is a 400, and sending an unwanted one is also a 400.
   */
  credentialSetupRequired: boolean;
}

/** Step 2F.2 — everything the redemption transaction hands back. */
export interface OwnerClaimRedemption {
  token: string;
  refresh: string;
  /**
   * The restaurant just claimed. CONTEXT, never authority: it says which membership
   * to SELECT out of the canonical profile, and nothing about what that membership
   * may do. Never build a `RestaurantRole` from it.
   */
  restaurantId: string;
}

/** The header the raw claim token travels in — the backend reads it nowhere else. */
export const OWNER_CLAIM_TOKEN_HEADER = 'X-Owner-Claim-Token';

const FALLBACK_MESSAGES: Record<OwnerClaimErrorKind, string> = {
  offline: "We couldn't reach Dinify. Check your connection and try again.",
  rate_limited: 'Too many attempts. Please wait a few minutes before trying again.',
  refused: 'This owner claim is invalid or no longer available.',
  password: 'Please choose a different password.',
  server: 'Something went wrong on our side. Please try again.',
  unauthorized: 'This claim session is no longer valid. Please start again.',
  malformed: "We couldn't read the response from Dinify. Please try again.",
  unknown: 'Something went wrong. Please try again.',
};

@Injectable({ providedIn: 'root' })
export class OwnerClaimService {
  private readonly rawHttp: HttpClient;
  private readonly base = `${environment.apiUrl}/api/${environment.version}`;

  constructor(httpBackend: HttpBackend) {
    this.rawHttp = new HttpClient(httpBackend);
  }

  /**
   * Step 2F.1 — resolve the claim token and send an owner-claim OTP to the invited
   * owner's canonical phone.
   *
   * Sends the claim token and NOTHING else: no Authorization header, an empty JSON
   * body. Also the resend path — the owner-claim OTP has its own purpose and
   * lifecycle, so `users/auth/resend-otp/` (which issues a `login` OTP) is the wrong
   * endpoint and would not produce a code redemption can spend.
   */
  challenge(claimToken: string): Observable<OwnerClaimChallengeResult> {
    return this.rawHttp
      .post<unknown>(`${this.base}/users/owner-claim/challenge/`, {}, {
        headers: new HttpHeaders({ [OWNER_CLAIM_TOKEN_HEADER]: claimToken }),
      })
      .pipe(map(parseChallenge), catchError(toOwnerClaimError));
  }

  /**
   * Step 2F.2 — spend the claim token plus its OTP.
   *
   * `otp` stays a STRING (a leading zero is significant, so it is never parsed as a
   * number) and `newPassword` is passed through untrimmed (whitespace can be part of
   * a password; trimming would store a credential the owner never typed).
   *
   * `new_password` is OMITTED entirely unless the challenge said it was required. The
   * backend REFUSES an unwanted one rather than ignoring it, so sending it "just in
   * case" fails an established owner's claim.
   */
  redeem(claimToken: string, otp: string, newPassword?: string): Observable<OwnerClaimRedemption> {
    const body: Record<string, string> = { otp };
    if (newPassword !== undefined) {
      body['new_password'] = newPassword;
    }
    return this.rawHttp
      .post<unknown>(`${this.base}/users/owner-claim/redeem/`, body, {
        headers: new HttpHeaders({ [OWNER_CLAIM_TOKEN_HEADER]: claimToken }),
      })
      .pipe(map(parseRedemption), catchError(toOwnerClaimError));
  }

  /**
   * Step 2F.3 — the canonical profile bootstrap, authenticated by the access token
   * redemption just returned.
   *
   * The claim token is NOT sent here: this is an ordinary authenticated customer read
   * that happens to be the missing half of the handoff. The Authorization header is
   * set explicitly, from the argument — see the class docstring for why letting an
   * interceptor supply it would hydrate the wrong principal.
   */
  bootstrapProfile(accessToken: string): Observable<Profile> {
    return this.rawHttp
      .get<unknown>(`${this.base}/users/user-profile/`, {
        headers: new HttpHeaders({ Authorization: `Bearer ${accessToken}` }),
      })
      .pipe(map(parseProfile), catchError(toOwnerClaimError));
  }
}

// ── Response parsing ────────────────────────────────────────────────────────────
// Strict, and failing rather than defaulting. Every field below drives an
// irreversible decision, so a missing one is a contract breach worth surfacing, not
// something to paper over with a plausible zero value.

function envelopeData(response: unknown): Record<string, unknown> {
  const data = (response as { data?: unknown } | null)?.data;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

function parseChallenge(response: unknown): OwnerClaimChallengeResult {
  const required = envelopeData(response)['credential_setup_required'];
  // Not coerced. A truthiness test would read a missing field as "no password
  // needed" and strand a brand-new owner on a form that cannot succeed.
  if (typeof required !== 'boolean') {
    throw malformed('credential_setup_required');
  }
  return { credentialSetupRequired: required };
}

function parseRedemption(response: unknown): OwnerClaimRedemption {
  const data = envelopeData(response);
  const token = data['token'];
  const refresh = data['refresh'];
  const restaurantId = data['restaurant_id'];
  if (!isNonEmptyString(token) || !isNonEmptyString(refresh) || !isNonEmptyString(restaurantId)) {
    throw malformed('redemption');
  }
  return { token, refresh, restaurantId };
}

function parseProfile(response: unknown): Profile {
  const profile = envelopeData(response)['profile'];
  // `restaurant_roles` is the whole point of this read: it is the authority the
  // claimed membership is selected from. A profile without it cannot seat a session.
  if (
    !profile
    || typeof profile !== 'object'
    || !Array.isArray((profile as Profile).restaurant_roles)
  ) {
    throw malformed('profile');
  }
  return profile as Profile;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function malformed(what: string): OwnerClaimError {
  return { kind: 'malformed', message: FALLBACK_MESSAGES.malformed, status: 0, ...devDetail(what) };
}

// The field name is useful when developing and is never rendered; it is kept off the
// object in production builds so it cannot leak into a screen by accident.
function devDetail(what: string): Record<string, never> | { detail: string } {
  return environment.production ? {} : { detail: `owner-claim: malformed ${what}` };
}

// ── Error translation ───────────────────────────────────────────────────────────

/**
 * Map a raw `HttpErrorResponse` onto the vocabulary the screen renders.
 *
 * THE REFUSAL IS NEVER INTERPRETED. The backend collapses unknown token, expired,
 * cancelled, superseded, already-consumed, verification-locked, owner-changed,
 * ownership-drifted, inactive account and wrong OTP into ONE sentence on purpose —
 * telling them apart would let a guesser learn which of their two factors was right,
 * and would leak the state of a restaurant they have no relationship with. So a 400
 * carries the server's sentence through verbatim and this client adds no diagnosis of
 * its own on top of it.
 *
 * An `OwnerClaimError` thrown by a parser passes through unchanged.
 */
function toOwnerClaimError(error: unknown): Observable<never> {
  if (isOwnerClaimError(error)) {
    return throwError(() => error);
  }
  if (!(error instanceof HttpErrorResponse)) {
    return throwError(() => ({
      kind: 'unknown' as const, message: FALLBACK_MESSAGES.unknown, status: 0,
    }));
  }

  const status = error.status;
  const serverMessage = messageFrom(error);
  const kind = kindFor(status, error);
  const failure: OwnerClaimError = {
    kind,
    // A server sentence wins wherever there is one: it is written for this exact
    // situation and is the only text that can be accurate about it.
    message: serverMessage ?? FALLBACK_MESSAGES[kind],
    status,
  };
  if (kind === 'password') {
    failure.passwordErrors = passwordErrorsFrom(error);
  }
  return throwError(() => failure);
}

function kindFor(status: number, error: HttpErrorResponse): OwnerClaimErrorKind {
  if (status === 0) return 'offline';
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'unauthorized';
  if (status >= 500) return 'server';
  if (status === 400 && passwordErrorsFrom(error).length > 0) return 'password';
  // 400 and 415 alike: a shaped client-side refusal whose sentence we relay.
  if (status >= 400) return 'refused';
  return 'unknown';
}

function messageFrom(error: HttpErrorResponse): string | null {
  const body = error.error;
  if (!body || typeof body !== 'object') return null;
  // `message` is the Dinify envelope's; `detail` is DRF's own (the throttle uses it).
  const message = (body as { message?: unknown }).message;
  if (isNonEmptyString(message)) return message;
  const detail = (body as { detail?: unknown }).detail;
  return isNonEmptyString(detail) ? detail : null;
}

function passwordErrorsFrom(error: HttpErrorResponse): string[] {
  const errors = (error.error as { errors?: unknown } | null)?.errors;
  if (!errors || typeof errors !== 'object') return [];
  const entries = (errors as { new_password?: unknown }).new_password;
  return Array.isArray(entries) ? entries.filter(isNonEmptyString) : [];
}

export function isOwnerClaimError(value: unknown): value is OwnerClaimError {
  return !!value && typeof value === 'object' && typeof (value as OwnerClaimError).kind === 'string'
    && typeof (value as OwnerClaimError).message === 'string';
}
