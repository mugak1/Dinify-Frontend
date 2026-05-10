import { Injectable } from '@angular/core';
import {
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpInterceptor,
} from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';

/**
 * Disables HTTP caching for API GETs.
 *
 * Menu, order, payment, table, and journey responses encode mutable state
 * (prices, discounts, in_stock, availability, order status, payment status,
 * seated parties). Without explicit response Cache-Control headers, browsers
 * fall back to heuristic caching — a diner who reopens a tab may see stale
 * stock or an obsolete order. Forcing `no-store` on the request side keeps
 * those responses out of every cache layer regardless of what the backend
 * sends back.
 *
 * Image requests are issued via <img> tags (see ImageWithSkeletonComponent
 * and CommonImageComponent), not HttpClient — they don't pass through this
 * interceptor and remain free to be cached aggressively per the backend's
 * response Cache-Control headers. See BACKEND_DEPENDENCIES.md §9 for the
 * required media-response policy.
 */
@Injectable()
export class CacheControlInterceptor implements HttpInterceptor {
  intercept(
    request: HttpRequest<unknown>,
    next: HttpHandler,
  ): Observable<HttpEvent<unknown>> {
    if (request.method !== 'GET') {
      return next.handle(request);
    }
    if (!request.url.startsWith(environment.apiUrl)) {
      return next.handle(request);
    }
    return next.handle(
      request.clone({
        setHeaders: {
          'Cache-Control': 'no-store',
          Pragma: 'no-cache',
        },
      }),
    );
  }
}
