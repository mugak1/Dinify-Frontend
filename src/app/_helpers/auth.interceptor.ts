import { Injectable } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor } from '@angular/common/http';
import { EMPTY, Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import { AuthenticationService } from '../_services/authentication.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
    constructor(private authenticationService: AuthenticationService) { }

    intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
        // add auth header with jwt if user is logged in and request is to api url
        const user = this.authenticationService.userValue;
       // console.log(user)
        const isLoggedIn = user?.token;
        const isApiUrl = request.url.startsWith(environment.apiUrl);
        // A RETIRED document sends no staff request (SHELL-FINISH-00, PR 3). Its
        // selected restaurant or its principal moved under it in another tab, or it
        // is switching restaurant and about to reload. Anything it sent now would
        // carry the NEW restaurant's id (read from storage per request) with the OLD
        // page's data — a blur autosave firing as the reload notice takes focus is
        // the worked example. It completes without a value or an error, so nothing
        // toasts and nothing retries; the page is about to be replaced.
        if (isLoggedIn && isApiUrl && this.authenticationService.isRetired) {
            return EMPTY;
        }
        if (isLoggedIn && isApiUrl) {
            request = request.clone({
                setHeaders: {
                    Authorization: `Bearer ${user.token}`
                }
            });
        }

        return next.handle(request);
    }
}