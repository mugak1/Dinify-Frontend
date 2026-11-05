import { HttpErrorResponse } from '@angular/common/http';
import { Inject, Injectable } from '@angular/core';
import { Observable, TimeoutError, catchError, defer, map, of, throwError, timeout } from 'rxjs';
import {
  FloorSnapshot,
  FloorStatusAction,
  FloorTableDetail,
  RoundCommand,
  RoundCommandAnswer,
} from '../models/floor.models';
import { Read, readCommandOk, readFloor, readFloorTable, readRefusal, readStatusOk } from './floor-adapter';
import { FloorMockBackend, FloorTransport } from './floor-mock-backend';
import { FloorHttpTransport } from './floor-http-transport';
import { FLOOR_DEV_MODE } from './floor-view-gate';

/** A floor read that started before the latest command answer is not applied. */
export type FloorRead<T> = Read<T> | { kind: 'superseded' };

/**
 * The answer to a status action (`table-actions/update-status/`).
 *   - `ok`: the server answered with this table at the status asked for.
 *   - `refused`: the server answered and did not make the change (a 400, 403 or 404,
 *     or a server error, whose transaction rolled back). `message` is the server's.
 *   - `unknown`: no answer at all (offline, a timeout). The action is idempotent, so
 *     trying again is safe; the floor re-read shows what the table really is.
 */
export type StatusAnswer = { kind: 'ok' } | { kind: 'refused'; message: string } | { kind: 'unknown' };

/** A read that has not answered in this long counts as a failure (the poll backs off). */
export const FLOOR_READ_TIMEOUT_MS = 8_000;
/** A command that has not answered in this long is UNKNOWN, never failed. */
export const FLOOR_COMMAND_TIMEOUT_MS = 15_000;

/** The sentinels `ErrorInterceptor` throws when no HTTP answer arrived at all. */
const NO_ANSWER_SENTINELS = new Set(['no network', 'rate_limited']);

/**
 * THE PRODUCTION GUARANTEE: mock data is never served outside a development build.
 * If `USE_MOCK_DATA` were ever left on in a shipped build, the service refuses rather
 * than hand a live restaurant sample tables and sample orders to confirm.
 */
const MOCK_REFUSED: FloorTransport = {
  getFloor: () => mockRefused(),
  getTable: () => mockRefused(),
  command: () => mockRefused(),
  setTableStatus: () => mockRefused(),
};

function mockRefused(): Observable<never> {
  return throwError(
    () => new Error('FloorService: mock floor data is never served outside a development build.'),
  );
}

/**
 * The floor view's one data source (Step 2, floor contract v1).
 *
 * LIVE SINCE FE-C. `USE_MOCK_DATA` is off, so every build reads BE-D's endpoints
 * through `FloorHttpTransport`. The in-memory `FloorMockBackend` stays for specs and
 * for a local design preview (flip the flag in a development build); a non-development
 * build that has the flag on is refused outright (`MOCK_REFUSED`), so production never
 * serves mock data. Every answer is read through `floor-adapter.ts` either way.
 *
 * THE SERVER DECIDES. A command marks nothing done on the client: the view shows it
 * pending, and this service hands back the server's answer — applied (with the round
 * as it now is), refused (409, with its reason and `data.round`), gone (404) or
 * unknown (no readable answer). An unknown is never turned into a success or a
 * failure; resending is safe because the server answers a repeat with
 * `changed: false`, so no unconfirmed-command store is kept.
 *
 * ONE FENCE, so an old read cannot undo a newer answer. Every read takes a stamp
 * when it STARTS and every command answer moves the fence when it LANDS; a read that
 * started before the fence is reported `superseded` and the view keeps what it has.
 */
@Injectable({ providedIn: 'root' })
export class FloorService {
  /**
   * `static`, like `ReportsService.USE_MOCK_DATA`, so specs can reach the mock branch.
   * OFF: the floor reads the real endpoints. Turning it on serves the mock in a
   * development build only.
   */
  static USE_MOCK_DATA = false;

  private opSeq = 0;
  private fence = 0;

  constructor(
    private readonly mock: FloorMockBackend,
    private readonly http: FloorHttpTransport,
    @Inject(FLOOR_DEV_MODE) private readonly devMode: boolean,
  ) {}

  private get transport(): FloorTransport {
    if (!FloorService.USE_MOCK_DATA) return this.http;
    return this.devMode ? this.mock : MOCK_REFUSED;
  }

  /** Read the whole floor. Errors when the transport fails; `invalid` when the answer is unreadable. */
  loadFloor(restaurantId: string): Observable<FloorRead<FloorSnapshot>> {
    return defer(() => {
      const stamp = ++this.opSeq;
      return this.transport.getFloor(restaurantId).pipe(
        timeout(FLOOR_READ_TIMEOUT_MS),
        map(raw => (stamp < this.fence ? { kind: 'superseded' as const } : readFloor(raw))),
      );
    });
  }

  /** Read one table for the drawer, items included. */
  loadTable(restaurantId: string, tableId: string): Observable<FloorRead<FloorTableDetail>> {
    return defer(() => {
      const stamp = ++this.opSeq;
      return this.transport.getTable(restaurantId, tableId).pipe(
        timeout(FLOOR_READ_TIMEOUT_MS),
        map(raw => (stamp < this.fence ? { kind: 'superseded' as const } : readFloorTable(raw, tableId))),
      );
    });
  }

  /**
   * Confirm or decline a held round. Never errors: every outcome is one of the four
   * `RoundCommandAnswer` kinds, and every outcome moves the fence, because even an
   * unknown answer may mean the server acted.
   */
  command(restaurantId: string, orderId: string, command: RoundCommand): Observable<RoundCommandAnswer> {
    return defer(() => this.transport.command(restaurantId, orderId, command)).pipe(
      timeout(FLOOR_COMMAND_TIMEOUT_MS),
      map(raw => {
        const read = readCommandOk(raw, orderId);
        return read.kind === 'ok' ? read.value : ({ kind: 'unknown' } as const);
      }),
      catchError((err: unknown) => of(commandFailure(err, orderId))),
      map(answer => {
        this.fence = ++this.opSeq;
        return answer;
      }),
    );
  }

  confirmRound(restaurantId: string, orderId: string) {
    return this.command(restaurantId, orderId, 'confirm');
  }

  declineRound(restaurantId: string, orderId: string) {
    return this.command(restaurantId, orderId, 'decline');
  }

  /**
   * Mark a table dirty, available or out of service through the backend's
   * `table-actions/update-status/` verb. It replaces the retired
   * `TablesService.updateTableStatus`, whose PUT to `restaurant-setup/tables/` the
   * backend silently ignored.
   */
  setTableStatus(restaurantId: string, tableId: string, status: FloorStatusAction): Observable<StatusAnswer> {
    return defer(() => this.transport.setTableStatus(restaurantId, tableId, status)).pipe(
      timeout(FLOOR_COMMAND_TIMEOUT_MS),
      map(raw =>
        readStatusOk(raw, tableId, status).kind === 'ok' ? ({ kind: 'ok' } as StatusAnswer) : ({ kind: 'unknown' } as StatusAnswer),
      ),
      catchError((err: unknown) => of(statusFailure(err))),
      map(answer => {
        this.fence = ++this.opSeq;
        return answer;
      }),
    );
  }
}

/**
 * A command that did not answer 200. The interceptor's floor carve-out forwards the
 * `HttpErrorResponse` untouched, so the STATUS is readable here:
 *   - 409: the server refused, and said why (`reason`) and where the round now is
 *     (`data.round`).
 *   - 404: the order is no longer available to this user (D-16, C-2).
 *   - anything else — a timeout, offline, a 5xx, a 403 — is UNKNOWN: nothing readable
 *     came back about this round, so nothing is claimed.
 */
function commandFailure(err: unknown, orderId: string): RoundCommandAnswer {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 409) return readRefusal(err.error, orderId);
    if (err.status === 404) return { kind: 'gone' };
  }
  return { kind: 'unknown' };
}

/**
 * A status action that did not answer 200. The verb is not under the floor carve-out
 * (it is a restaurant-setup route, and every other caller of the interceptor keeps its
 * behaviour), so with `SILENT_FAILURE` the interceptor throws the server's message as
 * a STRING when the server answered, and a sentinel when nothing arrived.
 */
function statusFailure(err: unknown): StatusAnswer {
  if (err instanceof TimeoutError) return { kind: 'unknown' };
  if (typeof err === 'string') {
    return NO_ANSWER_SENTINELS.has(err) || err.trim() === '' ? { kind: 'unknown' } : { kind: 'refused', message: err };
  }
  if (err instanceof HttpErrorResponse) {
    // The mock transport (development and specs) fails with the raw response.
    if (err.status === 0) return { kind: 'unknown' };
    const message = (err.error as { message?: unknown } | null)?.message;
    return { kind: 'refused', message: typeof message === 'string' && message.trim() ? message : err.statusText };
  }
  return { kind: 'unknown' };
}
