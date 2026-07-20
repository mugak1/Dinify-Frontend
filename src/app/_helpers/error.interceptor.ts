import { Injectable } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, filter, take, switchMap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { AuthenticationService } from '../_services/authentication.service';
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
 * and the Kitchen board. `mgt-app` is a banner shell and is deliberately
 * absent. A NEW root-level surface without an OfflineBannerComponent must be
 * added here, or its failed requests will lose the offline toast.
 */
export const NON_BANNER_SHELL_ROOTS: readonly string[] = [
    'login', 'register', 'forgot-password', 'welcome', 'lock-otp-exp',
    'privacy', 'terms', 'cookies', 'kitchen', 'diner',
];

@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
    private isRefreshing = false;
    private refreshTokenSubject = new BehaviorSubject<string | null>(null);

    constructor(
        private authenticationService: AuthenticationService,
        private toast: ToastService,
        private router: Router,
        private connectivity: ConnectivityService
    ) {}

    intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
        return next.handle(request).pipe(
            catchError((err: HttpErrorResponse) => {
                if (err.status === 0) {
                    // Offline UX is owned per-surface, so the global 'no network' toast is
                    // suppressed where a persistent indicator already shows:
                    //  - the diner app (ambient amber strip + inline order retry) — always, and
                    //  - the restaurant/admin back-office shells, whose OfflineBannerComponent
                    //    shows whenever the browser reports offline.
                    // It still fires elsewhere (e.g. login/auth) and for a status-0 failure
                    // while the browser reports ONLINE (server down/DNS), where no banner shows.
                    // Rethrow either way so callers' own handlers (scan retry, failOrder) keep working.
                    // Shell detection is inverted (see NON_BANNER_SHELL_ROOTS): the portal owns
                    // the URL root, so everything is a banner shell except the known bannerless
                    // first segments (and the bare root, which renders no shell at all).
                    const firstSegment = this.router.url.split('?')[0].split('#')[0].split('/').filter(Boolean)[0] ?? '';
                    const onBannerShell = firstSegment !== '' && !NON_BANNER_SHELL_ROOTS.includes(firstSegment);
                    if (!this.isDinerRequest(request) && !(onBannerShell && this.connectivity.isOffline())) {
                        this.toast.error("You're offline — check your connection.");
                    }
                    return throwError(() => 'no network');
                }

                if (err.status === 429) {
                    const retryMsg = err.error?.message || 'Too many attempts. Please wait a few minutes before trying again.';
                    this.toast.warning(retryMsg);
                    return throwError(() => 'rate_limited');
                }

                if (err.status === 401 && this.authenticationService.userValue) {
                    return this.handle401(request, next);
                }

                if (err.status === 403 && this.authenticationService.userValue) {
                    // 403 = authenticated but NOT authorized for this resource (module/tenant
                    // denial) — distinct from 401 (dead/expired/missing session, which owns
                    // logout via handle401). Do NOT log out: surface the denial and rethrow
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

                const error = err.error?.message || err.statusText;
                if (error) {
                    this.toast.error(error);
                }
                return throwError(() => error);
            })
        );
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
            || request.url.includes('reviews/submit/');  // diner order-complete review
    }

    private handle401(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
        if (!this.isRefreshing) {
            this.isRefreshing = true;
            this.refreshTokenSubject.next(null);

            return this.authenticationService.attemptTokenRefresh().pipe(
                switchMap((newToken: string | null) => {
                    this.isRefreshing = false;
                    if (newToken) {
                        this.refreshTokenSubject.next(newToken);
                        return next.handle(this.addToken(request, newToken));
                    }
                    // Refresh not available or failed — log out
                    this.authenticationService.logout();
                    return throwError(() => 'Session expired');
                }),
                catchError((_err) => {
                    this.isRefreshing = false;
                    this.authenticationService.logout();
                    return throwError(() => 'Session expired');
                })
            );
        }

        // Another request is already refreshing — wait for it to complete
        return this.refreshTokenSubject.pipe(
            filter((token) => token !== null),
            take(1),
            switchMap((token) => next.handle(this.addToken(request, token!)))
        );
    }

    private addToken(request: HttpRequest<any>, token: string): HttpRequest<any> {
        return request.clone({
            setHeaders: { Authorization: `Bearer ${token}` }
        });
    }
}
