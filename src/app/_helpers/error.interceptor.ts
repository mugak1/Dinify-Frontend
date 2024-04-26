import { Injectable } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthenticationService } from '../_services/authentication.service';
import { MessageService } from '../_services/message.service';

@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
    constructor(private authenticationService: AuthenticationService,private message:MessageService) { }

    intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
        return next.handle(request).pipe(catchError(err => {
            if ([401, 403].includes(err.status) && this.authenticationService.userValue) {
                // auto logout if 401 Unauthorized or 403 Forbidden response returned from api
                console.log(err);
                this.authenticationService.logout();
            }
console.log(err)
if(err.status===0){
    this.message.add("no network");
    return throwError(() => "no network");
}else{
                const error = err.error.message || err.statusText;
            if(error){
                       this.message.add(error);     
            }
return throwError(() => error);
}

            
        }))
    }
}