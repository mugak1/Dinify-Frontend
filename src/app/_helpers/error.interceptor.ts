import { Injectable } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { Router } from '@angular/router';
import {
    AuthenticationService, RenewalOutcome, RequestOwner,
} from '../_services/authentication.service';
import { ToastService } from '../_shared/ui/toast/toast.service';
import { ConnectivityService } from '../_services/connectivity.service';

/**
 * First URL segments that are NOT back-office banner shells. Now that the
 * restaurant portal lives at the URL ROOT, the banner-shell check is INVERTED
 * into this deny-list: a positive list of portal segments would drift (the
 * portal owns support/notifications/account/rest-app-ordering, which are not
 * RBAC modules, while kitchen IS a module but renders no OfflineBanner), so a
 * URL counts as a banner shell UNLESS its first segment is one of these known
 * bannerless surfaces — the auth/legal/lock screens, the standalone diner app,
 * and the Kitchen board. A NEW root-level surface without an
 * OfflineBannerComponent must be added here, or its failed requests will lose
 * the offline toast.
 */
export const NON_BANNER_SHELL_ROOTS: readonly string[] = [
    'login', 'register', 'forgot-password', 'welcome', 'lock-otp-exp',
    'owner-claim', 'privacy', 'terms', 'cookies', 'kitchen', 'diner',
];

/**
 * Is this one of the three D05 kitchen ORDER COMMAND routes?
 *
 * Matched on the path SHAPE rather than a substring, so a URL that merely
 * contains the words — a query parameter, another host — cannot borrow the
 * behaviour. `kitchen/menu-items/<id>/stock/` is deliberately NOT included: it
 * is a catalogue write with its own delegated audit and its own error handling.
 */
export function isKitchenOrderCommand(request: HttpRequest<unknown>): boolean {
    if (request.method !== 'PUT') return false;
    return /\/kitchen\/orders\/[^/]+\/(fulfilment-status|priority|cancel)\/?($|\?)/
        .test(request.url);
}

/** The session really ended: its credential was definitively refused. */
export const SESSION_EXPIRED = 'Session expired';

/**
 * The request belonged to a session or selected restaurant that is no longer
 * the current one (a logout, a replacement sign-in, a restaurant switch). It
 * is deliberately NOT "Session expired": the session in front of the user may
 * be perfectly valid, and saying otherwise would be false.
 */
export const SESSION_CHANGED_MESSAGE =
    'Your sign-in or restaurant changed while this was in progress. Please try again.';

/**
 * A renewal could not reach a verdict — the server was slow, answered with
 * something that is not the refresh contract, or the new credentials could
 * not be saved. Nothing about the credential was proven, so nothing ends.
 */
export const SESSION_UNCONFIRMED_MESSAGE =
    "We couldn't confirm your sign-in just now. Please try again.";

/**
 * What a 401 PROVES, read from its body.
 *
 * The pinned backend authenticates in DRF's `initial()`, before any business
 * handler runs, and `CustomerJWTAuthentication` (SimpleJWT) answers a refused
 * access credential with `{detail, code}`:
 *
 *  - `token_not_valid` / `bad_authorization_header` → `renewable`: the handler
 *    never ran, so ONE recovery (renew, then replay) cannot duplicate a write.
 *    That is the proof — not the HTTP verb, and not the fact that a token
 *    exists now. It says nothing about authentication logging, only that the
 *    business handler did not execute.
 *  - `user_inactive` / `user_not_found` → `terminal`: no renewal can fix it.
 *  - anything else → `null`: NOT a session failure this client can prove.
 *    That includes the code-less `{status: 401, message}` envelope some views
 *    use for a PERMISSION refusal (`manager-actions/first-time-menu-review/`)
 *    and any unrecognised 401 — on any HTTP method. Those are ordinary errors:
 *    no renewal, no replay, no speculative logout.
 *
 * The code is only trusted alongside everything else recovery checks: the
 * trusted API origin/path and this session's own credential on the request.
 */
type AuthRefusal = 'renewable' | 'terminal' | null;

function authRefusal(body: unknown): AuthRefusal {
    if (!body || typeof body !== 'object') return null;
    const b = body as Record<string, unknown>;
    // SimpleJWT's shape. A view's hand-written envelope carries `status` and
    // `message`; that is not an authentication-stage refusal.
    if (typeof b['detail'] !== 'string' || 'status' in b || 'message' in b) return null;
    const code = b['code'];
    if (code === 'token_not_valid' || code === 'bad_authorization_header') return 'renewable';
    if (code === 'user_inactive' || code === 'user_not_found') return 'terminal';
    return null;
}

@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
    constructor(
        private authenticationService: AuthenticationService,
        private toast: ToastService,
        private router: Router,
        private connectivity: ConnectivityService
    ) {}

    intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
        // CAPTURED BEFORE DISPATCH. Who this request belongs to — the session,
        // the selected restaurant and the credential it actually carried — is
        // fixed now, so a later answer is judged against the context that
        // ASKED, never against whoever happens to be signed in when it lands.
        const owner = this.authenticationService.captureRequestOwner(request);
        return next.handle(request).pipe(
            catchError((err: HttpErrorResponse) => {
                if (err?.status === 401 && owner) {
                    return this.recover401(request, next, err, owner);
                }
                return this.classify(request, err);
            })
        );
    }

    /**
     * THE ONE RESOURCE-ERROR CLASSIFIER, shared by first attempts and replays,
     * so a leader, a waiter and an unrefreshed request all receive the same
     * shape for the same answer — including every structured carve-out below.
     * It never renews and never logs out.
     */
    private classify(request: HttpRequest<any>, err: HttpErrorResponse): Observable<never> {
        if (err.status === 0) {
            return this.networkFailure(request);
        }

        if (err.status === 429) {
            const retryMsg = err.error?.message || 'Too many attempts. Please wait a few minutes before trying again.';
            this.toast.warning(retryMsg);
            return throwError(() => 'rate_limited');
        }

        // Kitchen command refusal (D05). A kitchen order command
        // answers a conflict with { status, message, reason, data },
        // where `data` is the server's authoritative current state.
        // Forward the HttpErrorResponse UNTOUCHED so the service can
        // read the STATUS (409 conflict vs anything else, which is
        // "unknown"), branch on the machine `reason`, and fold the
        // projection into the board.
        //
        // Flattened to `err.error?.message` all three are lost: the
        // status disappears, so a refusal and a lost answer become the
        // same thing — and the whole point of D05's client half is that
        // they are NOT the same thing. The card renders the message
        // itself, so the toast is suppressed to keep it to one place.
        //
        // IT SITS ABOVE THE GENERIC AUTHENTICATED-403 BRANCH, and that
        // ordering is the fix rather than a tidy-up: the kitchen's own
        // manage-level escalation refusal (`kitchen_manage_required`)
        // IS a 403, and every real kitchen caller is a signed-in
        // operator — so the generic branch flattened the one case this
        // carve-out exists for, and the board reported "we could not
        // confirm" instead of "only a manager can do that". It is
        // placed AFTER the network and 429 branches; a staff 401 is
        // handled before classification at all (`recover401`), because
        // those are about the SESSION rather than this resource.
        //
        // Scoped to the three ORDER COMMAND routes by path shape. The
        // kitchen READS and the stock toggle are deliberately excluded
        // and keep the string + toast behaviour below.
        if (isKitchenOrderCommand(request)) {
            return throwError(() => err);
        }

        if (err.status === 403 && this.authenticationService.userValue) {
            // 403 = authenticated but NOT authorized for this resource (module/tenant
            // denial) — distinct from 401 (dead/expired/missing session, which owns
            // logout via recover401). Do NOT log out: surface the denial and rethrow
            // so any inline handler (e.g. the roles-access optimistic revert) still
            // runs. Module-denial 403s became real once the Roles & Access grid began
            // enforcing server-side; every backend session-bad scenario returns 401,
            // so dropping logout-on-403 cannot trap a genuinely dead session.
            const denial = err.error?.message || "You don't have permission to do that.";
            this.toast.error(denial);
            return throwError(() => denial);
        }

        // Ongoing-order block: orders/initiate/ returns HTTP 400
        // { status, message, data:{ order_id } } when the table already has an
        // order that hasn't cleared the kitchen. Forward the structured body
        // untouched — and do NOT toast it — so the basket can read order_id,
        // latch its blocked state and render the explanatory banner inline
        // (see basket-body.component.ts placeOrder()). Scoped to
        // orders/initiate so every other error keeps the string + toast
        // behaviour below.
        if (request.url.includes('orders/initiate') && err.status === 400 && err.error?.data?.order_id) {
            return throwError(() => err.error);
        }

        // Acceptance refusal: orders/submit/ returns HTTP 400
        // { status, message, reason } when the saved quote cannot be
        // accepted — it was priced under the superseded rules, the
        // acknowledgement is missing or stale, or nothing on it is
        // still deliverable. Forward the structured body untouched so
        // the basket can branch on the machine-readable `reason` and
        // re-review, rather than matching on a human sentence (which is
        // exactly the brittleness the reason code exists to remove).
        // The message is still surfaced — by the component, inline at
        // the checkout footer, so the diner sees one message, not two.
        //
        // D06 EXTENDED IT TO `orders/retire-quote/` AND TO 409, and
        // both halves matter. That route answers with the SAME refusal
        // vocabulary — an already-accepted order above all — and the
        // coordinator's shared transition branches on exactly those
        // codes; flattened to a sentence it would classify every one of
        // them as `unknown` and the client would neither re-price nor
        // retry. The 409 is the already-accepted conflict, which is the
        // one answer that must never be re-sent.
        if ((request.url.includes('orders/submit')
             || request.url.includes('orders/retire-quote'))
            && (err.status === 400 || err.status === 409)
            && typeof err.error?.reason === 'string') {
            return throwError(() => err.error);
        }

        // Checkout recovery: the diner's order read resolved by INTENT
        // KEY (orders/journey/order-details/?intent=…, D04/D). Forward
        // the response untouched and do NOT toast it, for two reasons
        // the generic branch below gets wrong.
        //
        // FIRST, THE STATUS IS THE ANSWER. That read is non-disclosing
        // by design — a foreign, unknown and malformed key are one
        // 404 — and 404 is the ONLY reply meaning "no such order on
        // this table". The coordinator reads it as `absent`, which it
        // resolves by re-sending the SAME recorded command under the
        // SAME key — it does not retire the record on it (an earlier
        // version of this comment said it dropped the key; that has not
        // been true since the D04 completion). Collapsed to
        // `err.error.message` it became an ordinary string, so a
        // definitive absence was classified as "the server could not
        // be asked" — the one distinction that whole mechanism turns
        // on. (Codex P2 on PR #663, valid.)
        //
        // SECOND, NOBODY ASKED FOR IT. This read runs by itself on a
        // basket page load; a toast about it reports a background
        // enquiry as a failure the diner did nothing to cause, and
        // repeats on every load while the attempt is unresolved.
        //
        // Scoped to the `intent=` form: the ordinary `?order=` read
        // keeps its existing string + toast behaviour exactly.
        if (request.url.includes('orders/journey/order-details/')
            && request.url.includes('intent=')) {
            return throwError(() => err);
        }

        const error = err.error?.message || err.statusText;
        if (error) {
            this.toast.error(error);
        }
        return throwError(() => error);
    }

    /**
     * Diner journey/order endpoints that own their offline UX (the ambient
     * offline strip + inline order retry). Used to suppress the global
     * 'no network' toast for the diner only — every other surface keeps it.
     */
    private isDinerRequest(request: HttpRequest<any>): boolean {
        return request.url.includes('orders/journey/')   // show-menu, table-scan, order-details
            || request.url.includes('orders/initiate/')
            || request.url.includes('orders/submit/')
            || request.url.includes('orders/retire-quote/')  // D06 quote renewal
            || request.url.includes('reviews/submit/');  // diner order-complete review
    }

    /**
     * Offline UX is owned per-surface, so the global 'no network' toast is
     * suppressed where a persistent indicator already shows. Shared by a
     * status-0 resource failure and a renewal that got no HTTP answer, so the
     * two cannot drift. It rethrows the same `'no network'` sentinel either way.
     */
    private networkFailure(request: HttpRequest<any>): Observable<never> {
        // Where the toast is suppressed:
        //  - the diner app (ambient amber strip + inline order retry) — always, and
        //  - the restaurant/admin back-office shells, whose OfflineBannerComponent
        //    shows whenever the browser reports offline.
        // It still fires elsewhere (e.g. login/auth) and for a status-0 failure
        // while the browser reports ONLINE (server down/DNS), where no banner shows.
        // A status 0 does not PROVE the device is offline, and nothing here
        // changes connectivity state; the wording is the long-standing one.
        // Rethrow either way so callers' own handlers (scan retry, failOrder) keep working.
        // Shell detection is inverted (see NON_BANNER_SHELL_ROOTS): the portal owns
        // the URL root, so everything is a banner shell except the known bannerless
        // first segments — and the bare root, because router.url can still be '/'
        // while a request fired mid-navigation (e.g. from a guard or the diner
        // scan) is in flight, and no shell is rendered there to own the signal.
        const firstSegment = this.router.url.split('?')[0].split('#')[0].split('/').filter(Boolean)[0] ?? '';
        const onBannerShell = firstSegment !== '' && !NON_BANNER_SHELL_ROOTS.includes(firstSegment);
        if (!this.isDinerRequest(request) && !(onBannerShell && this.connectivity.isOffline())) {
            this.toast.error("You're offline — check your connection.");
        }
        return throwError(() => 'no network');
    }

    /**
     * A 401 on a request this session's own credential was attached to.
     *
     * Recovery happens AT MOST ONCE, and only on proof: the body must show an
     * authentication-stage refusal (`authRefusal`), and the request must still
     * belong to the current session and selected restaurant. Everything else is
     * an ordinary error, classified exactly as a first attempt would be.
     */
    private recover401(
        request: HttpRequest<any>, next: HttpHandler,
        err: HttpErrorResponse, owner: RequestOwner,
    ): Observable<HttpEvent<any>> {
        const refusal = authRefusal(err.error);
        if (refusal === null) return this.classify(request, err);

        // A request from a session or restaurant that is no longer current can
        // neither recover nor end anything: its successor is not its to touch.
        if (!this.authenticationService.ownerIsCurrent(owner)) {
            return throwError(() => SESSION_CHANGED_MESSAGE);
        }

        if (refusal === 'terminal') {
            return throwError(() =>
                this.authenticationService.endOwnedSession(owner, owner.token)
                    ? SESSION_EXPIRED : SESSION_CHANGED_MESSAGE);
        }

        // SAME SESSION, ALREADY RENEWED. The request went out under an older
        // token of this very session and context, and a renewal has landed
        // since: use the current token once, without rotating again.
        const current = this.authenticationService.currentAccessToken();
        if (current && current !== owner.token) {
            return this.replay(request, next, owner, current);
        }

        return this.authenticationService.renewSession(owner).pipe(
            switchMap((outcome) => this.afterRenewal(request, next, owner, outcome)),
        );
    }

    private afterRenewal(
        request: HttpRequest<any>, next: HttpHandler,
        owner: RequestOwner, outcome: RenewalOutcome,
    ): Observable<HttpEvent<any>> {
        switch (outcome.kind) {
            case 'renewed':
                // The wait may have outlived the context: a restaurant switch
                // (or anything else) during it ends this request's authority.
                if (!this.authenticationService.ownerIsCurrent(owner)) {
                    return throwError(() => SESSION_CHANGED_MESSAGE);
                }
                return this.replay(request, next, owner, outcome.access);
            case 'rejected':
                // Either the service already ended this session on the
                // refusal (every waiter hears the same verdict), or there was
                // no refresh token to present and the refused request's own
                // credential decides it.
                return throwError(() =>
                    outcome.ended || this.authenticationService.endOwnedSession(owner, owner.token)
                        ? SESSION_EXPIRED : SESSION_CHANGED_MESSAGE);
            case 'superseded':
                return throwError(() => SESSION_CHANGED_MESSAGE);
            case 'unavailable':
                // NOT a verdict about the credential. The session and any
                // retained command evidence are kept; a later request may try
                // again. A transport failure keeps the existing 'no network'
                // contract; anything else gets one fixed human sentence.
                if (outcome.cause === 'transport') return this.networkFailure(request);
                this.toast.error(SESSION_UNCONFIRMED_MESSAGE);
                return throwError(() => SESSION_UNCONFIRMED_MESSAGE);
        }
    }

    /**
     * Re-send the ORIGINAL request — same body, same idempotency key, quote
     * reference or revision — with only its Authorization changed.
     *
     * Its failure is classified exactly like a first attempt's. A 401 here is
     * never renewed a second time; it ends the session only when it is a
     * definitive authentication refusal of the credential this session STILL
     * holds. A code-less permission 401 stays an ordinary error, and an old
     * replay refused after a newer session or context took over settles
     * without touching it.
     */
    private replay(
        request: HttpRequest<any>, next: HttpHandler,
        owner: RequestOwner, token: string,
    ): Observable<HttpEvent<any>> {
        return next.handle(request.clone({
            setHeaders: { Authorization: `Bearer ${token}` },
        })).pipe(
            catchError((err: HttpErrorResponse) => {
                if (err?.status === 401 && authRefusal(err.error) !== null) {
                    return throwError(() =>
                        this.authenticationService.endOwnedSession(owner, token)
                            ? SESSION_EXPIRED : SESSION_CHANGED_MESSAGE);
                }
                return this.classify(request, err);
            }),
        );
    }
}
