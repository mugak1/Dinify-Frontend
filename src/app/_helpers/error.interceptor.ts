import { Injectable } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, filter, take, switchMap } from 'rxjs/operators';
import { AuthenticationService } from '../_services/authentication.service';
import { MessageService } from '../_services/message.service';

@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
    private isRefreshing = false;
    private refreshTokenSubject = new BehaviorSubject<string | null>(null);

    constructor(
        private authenticationService: AuthenticationService,
        private message: MessageService
    ) {}

    intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
        this.message.clear();
        return next.handle(request).pipe(
            catchError((err: HttpErrorResponse) => {
                if (err.status === 0) {
                    this.message.add('no network');
                    return throwError(() => 'no network');
                }

                if (err.status === 429) {
                    const retryMsg = err.error?.message || 'Too many attempts. Please wait a few minutes before trying again.';
                    this.message.add(retryMsg);
                    return throwError(() => 'rate_limited');
                }

                if (err.status === 401 && this.authenticationService.userValue) {
                    return this.handle401(request, next);
                }

                if (err.status === 403 && this.authenticationService.userValue) {
                    // 403 is a permissions error, not an expired token — log out immediately
                    this.authenticationService.logout();
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
                    this.message.add(error);
                }
                return throwError(() => error);
            })
        );
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
