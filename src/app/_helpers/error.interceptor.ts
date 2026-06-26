import { Injectable } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, filter, take, switchMap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { AuthenticationService } from '../_services/authentication.service';
import { ToastService } from '../_shared/ui/toast/toast.service';
import { ConnectivityService } from '../_services/connectivity.service';

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
                    const onBannerShell = /^\/(rest-app|mgt-app)/.test(this.router.url);
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

                // ── TEMP/TODO(orders-module): ongoing-order dev shim ───────────────
                // orders/submit/ returns HTTP 400 { status, message, data:{ order_id } }
                // when the table already has an ongoing order. There is no UI yet to
                // view/close orders, so the basket treats this single case as a soft
                // success and routes the diner to order-complete (see
                // basket-body.component.ts submitOrder()). Forward the structured body
                // untouched — and do NOT toast it, since it is handled as success — so
                // the component can read order_id. Scoped to orders/submit so every
                // other error keeps the string + toast behaviour below. Delete this
                // block (and its twin in basket-body.component.ts) when the orders
                // module lands.
                if (request.url.includes('orders/submit') && err.status === 400 && err.error?.data?.order_id) {
                    return throwError(() => err.error);
                }
                // ── end TEMP shim ──────────────────────────────────────────────────

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
            || request.url.includes('orders/submit/');
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
