import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../_services/api.service';
import { SILENT_FAILURE } from '../../../_helpers/error.interceptor';
import { FloorStatusAction, RoundCommand } from '../models/floor.models';
import { FloorTransport } from './floor-mock-backend';
import { FLOOR_ROUTES } from './floor-routes';

/**
 * The real floor transport (FE-C): BE-D's floor endpoints and the table status verb,
 * over the app's ordinary `HttpClient`, so every request runs the real interceptor
 * chain (staff Bearer token, 401 renewal, error classification).
 *
 * It returns the RAW wire body and fails with whatever the interceptor chain throws;
 * `FloorService` reads both through `floor-adapter.ts`. What each call gets from the
 * `ErrorInterceptor` is deliberate:
 *
 *   - THE TWO READS carry `SILENT_FAILURE`. The floor is polled every few seconds and
 *     the view shows its own error and "couldn't refresh" states, so a failing poll
 *     must not raise a toast on every attempt.
 *   - THE TWO COMMANDS carry nothing: the interceptor's floor carve-out
 *     (`isFloorRoundCommand`) forwards their `HttpErrorResponse` untouched, so the
 *     409 reasons, `data.round` and the 404 reach the view, which renders them itself.
 *   - THE STATUS VERB carries `SILENT_FAILURE` too: the view reports its outcome in
 *     one toast of its own, so the interceptor's generic toast would be a second.
 */
@Injectable({ providedIn: 'root' })
export class FloorHttpTransport implements FloorTransport {
  constructor(
    private readonly http: HttpClient,
    private readonly api: ApiService,
  ) {}

  private url(path: string): string {
    return `${this.api._base}/${path}`;
  }

  private silent(): HttpContext {
    return new HttpContext().set(SILENT_FAILURE, true);
  }

  getFloor(restaurantId: string): Observable<unknown> {
    return this.http.get(this.url(FLOOR_ROUTES.floor()), {
      params: { restaurant: restaurantId },
      context: this.silent(),
    });
  }

  getTable(restaurantId: string, tableId: string): Observable<unknown> {
    return this.http.get(this.url(FLOOR_ROUTES.table(tableId)), {
      params: { restaurant: restaurantId },
      context: this.silent(),
    });
  }

  command(restaurantId: string, orderId: string, command: RoundCommand): Observable<unknown> {
    const path = command === 'confirm' ? FLOOR_ROUTES.confirm(orderId) : FLOOR_ROUTES.decline(orderId);
    // Decline takes no reason from the client: the server records `declined_by_staff`.
    return this.http.post(this.url(path), { restaurant: restaurantId });
  }

  setTableStatus(_restaurantId: string, tableId: string, status: FloorStatusAction): Observable<unknown> {
    // The verb names the table, not the restaurant: the server resolves the table's
    // restaurant and checks the `tables` module there itself.
    return this.http.post(
      this.url(FLOOR_ROUTES.updateStatus()),
      { table_id: tableId, status },
      { context: this.silent() },
    );
  }
}
