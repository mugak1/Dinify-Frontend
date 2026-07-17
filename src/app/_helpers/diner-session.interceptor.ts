import { Injectable } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor } from '@angular/common/http';
import { Observable } from 'rxjs';

import { AuthenticationService } from '../_services/authentication.service';
import { DinerSessionService } from '../_services/diner-session.service';

/** Backend PR 7A capability headers. */
const CREDENTIAL_HEADER = 'X-Diner-Credential';
const SESSION_HEADER = 'X-Diner-Session';

/** The protected exchange endpoint: QR credential in, session out. */
const SCAN_PATH = 'orders/journey/table-scan/';

/**
 * Anonymous diner endpoints that carry the table-session capability. Mirrors the
 * set the ErrorInterceptor already treats as diner-owned. `orders/journey/`
 * covers table-scan (credential), show-menu, order-details and payment-details.
 */
function isDinerEndpoint(url: string): boolean {
  return url.includes('orders/journey/')
    || url.includes('orders/initiate/')
    || url.includes('orders/submit/')
    || url.includes('reviews/submit/');
}

/**
 * Attaches the diner table-session capability to anonymous diner requests — the
 * QR credential (`X-Diner-Credential`) on the scan exchange, and the minted
 * session (`X-Diner-Session`) on every later diner call. This is the ONLY place
 * the capability is transmitted; it never rides a URL, body or log.
 *
 * A completely separate channel from staff auth: if a staff user is signed in
 * (`AuthInterceptor` will attach their JWT), we attach nothing — the admin order
 * paths stay on the JWT channel and diner state can never bleed into them.
 */
@Injectable()
export class DinerSessionInterceptor implements HttpInterceptor {
  constructor(
    private readonly authenticationService: AuthenticationService,
    private readonly dinerSession: DinerSessionService,
  ) {}

  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Staff JWT flows own their own channel — never overlay a diner capability
    // (keeps admin `orders/initiate/` and every back-office call untouched).
    if (this.authenticationService.userValue) {
      return next.handle(request);
    }

    if (!isDinerEndpoint(request.url)) {
      return next.handle(request);
    }

    if (request.url.includes(SCAN_PATH)) {
      const credential = this.dinerSession.credential;
      if (credential) {
        request = request.clone({ setHeaders: { [CREDENTIAL_HEADER]: credential } });
      }
    } else {
      const token = this.dinerSession.token;
      if (token) {
        request = request.clone({ setHeaders: { [SESSION_HEADER]: token } });
      }
    }

    return next.handle(request);
  }
}
