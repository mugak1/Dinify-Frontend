import { Injectable } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import { AuthenticationService } from '../_services/authentication.service';
import { DinerSessionService } from '../_services/diner-session.service';
import {
  CREDENTIAL_HEADER,
  SESSION_HEADER,
  classifyDinerCapabilityRequest,
} from '../_security/diner-capability-contract';

/**
 * Attaches the diner table-session capability to anonymous diner requests — the
 * QR credential (`X-Diner-Credential`) on the scan exchange, and the minted
 * session (`X-Diner-Session`) on every later diner call. This is the ONLY place
 * the capability is transmitted; it never rides a URL, body or log.
 *
 * The set of routes that receive each header is an EXACT first-party allowlist,
 * not substring inference: `classifyDinerCapabilityRequest` (in
 * `_security/diner-capability-contract`) proves the request targets the configured
 * Dinify API origin/base and matches a known route + HTTP method exactly. The public
 * `orders/journey/show-menu/` read, an unknown journey endpoint, a wrong method, an
 * external origin that merely contains a route substring, and a route embedded only in
 * a query parameter therefore all receive NEITHER capability header.
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

    const capability = classifyDinerCapabilityRequest(
      request.method,
      request.url,
      environment.apiUrl,
    );

    if (capability === 'credential') {
      const credential = this.dinerSession.credential;
      if (credential) {
        request = request.clone({ setHeaders: { [CREDENTIAL_HEADER]: credential } });
      }
    } else if (capability === 'session') {
      const token = this.dinerSession.token;
      if (token) {
        request = request.clone({ setHeaders: { [SESSION_HEADER]: token } });
      }
    }

    return next.handle(request);
  }
}
