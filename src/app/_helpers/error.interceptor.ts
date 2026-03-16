import { Injectable } from '@angular/core';
import {
    HttpRequest,
    HttpHandler,
    HttpEvent,
    HttpInterceptor,
    HttpErrorResponse
} from '@angular/common/http';
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

                const error = err.error?.message || err.statusText;
                if (error) {
                    this.message.add(error);
                }
                return throwError(() => error);
            })
        );
    }

    /**
     * Handle 401 responses by attempting a silent token refresh.
     *
     * BACKEND DEPENDENCY: Silent refresh requires the backend to expose a
     * token refresh endpoint. The expected contract is:
     *
     *   POST /api/{version}/users/auth/token/refresh/
     *   Request body:  { "refresh": "<refresh-token>" }
     *   Response body: { "data": { "token": "<new-access-token>", "refresh": "<new-refresh-token>" } }
     *
     * Once the backend exposes this endpoint, uncomment the refresh call in
     * AuthenticationService.refreshToken() and this interceptor will
     * automatically retry failed requests with the new access token.
     */
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
