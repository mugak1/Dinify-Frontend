import { HttpErrorResponse } from '@angular/common/http';
import { Inject, Injectable } from '@angular/core';
import { Observable, catchError, defer, map, of, throwError } from 'rxjs';
import {
  FloorSnapshot,
  FloorStatusAction,
  FloorTableDetail,
  RoundCommand,
  RoundCommandAnswer,
} from '../models/floor.models';
import { Read, readCommandOk, readFloor, readFloorTable, readRefusal } from './floor-adapter';
import { FloorMockBackend, FloorTransport } from './floor-mock-backend';
import { FLOOR_DEV_MODE } from './floor-view-gate';

/** A floor read that started before the latest command answer is not applied. */
export type FloorRead<T> = Read<T> | { kind: 'superseded' };

/** The answer to a status action. There is no 409 vocabulary for it in contract v1. */
export type StatusAnswer = { kind: 'ok' } | { kind: 'unknown' };

/** Where the real transport goes. FE-C replaces this with an HTTP `FloorTransport`. */
const UNWIRED: FloorTransport = {
  getFloor: () => notWired(),
  getTable: () => notWired(),
  command: () => notWired(),
  setTableStatus: () => notWired(),
};

function notWired(): Observable<never> {
  return throwError(
    () => new Error('FloorService: the real floor endpoints are not wired yet (FE-C).'),
  );
}

/**
 * Defence in depth for the production gate. `TablesComponent` already hides the view
 * in a production build while mock data is on; this makes the SERVICE refuse to hand
 * out mock tables there too, so no other caller can surface them.
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
 * While `USE_MOCK_DATA` is true it reads from `FloorMockBackend`, an in-memory
 * stand-in that answers in the contract's exact shapes. FE-C flips the flag and
 * supplies the HTTP transport; every answer is read through `floor-adapter.ts`
 * either way, so nothing else changes.
 *
 * THE SERVER DECIDES. A command marks nothing done on the client: the view shows it
 * pending, and this service hands back the server's answer — applied, refused (409,
 * with its reason) or unknown (no readable answer). An unknown is never turned into
 * a success or a failure; resending is safe because the server answers a repeat with
 * `changed: false`.
 *
 * ONE FENCE, so an old read cannot undo a newer answer. Every read takes a stamp
 * when it STARTS and every command answer moves the fence when it LANDS; a read that
 * started before the fence is reported `superseded` and the view keeps what it has.
 */
@Injectable({ providedIn: 'root' })
export class FloorService {
  /** `static`, like `ReportsService.USE_MOCK_DATA`, so specs can reach the real branch. */
  static USE_MOCK_DATA = true;

  private opSeq = 0;
  private fence = 0;

  constructor(
    private readonly mock: FloorMockBackend,
    @Inject(FLOOR_DEV_MODE) private readonly devMode: boolean,
  ) {}

  private get transport(): FloorTransport {
    if (!FloorService.USE_MOCK_DATA) return UNWIRED;
    return this.devMode ? this.mock : MOCK_REFUSED;
  }

  /** Read the whole floor. Errors when the transport fails; `invalid` when the answer is unreadable. */
  loadFloor(restaurantId: string): Observable<FloorRead<FloorSnapshot>> {
    return defer(() => {
      const stamp = ++this.opSeq;
      return this.transport
        .getFloor(restaurantId)
        .pipe(map(raw => (stamp < this.fence ? { kind: 'superseded' as const } : readFloor(raw))));
    });
  }

  /** Read one table for the drawer, items included. */
  loadTable(restaurantId: string, tableId: string): Observable<FloorRead<FloorTableDetail>> {
    return defer(() => {
      const stamp = ++this.opSeq;
      return this.transport
        .getTable(restaurantId, tableId)
        .pipe(
          map(raw =>
            stamp < this.fence ? { kind: 'superseded' as const } : readFloorTable(raw, tableId),
          ),
        );
    });
  }

  /**
   * Confirm or decline a held round. Never errors: every outcome is one of the three
   * `RoundCommandAnswer` kinds, and every outcome moves the fence, because even an
   * unknown answer may mean the server acted.
   */
  command(restaurantId: string, orderId: string, command: RoundCommand): Observable<RoundCommandAnswer> {
    return this.transport.command(restaurantId, orderId, command).pipe(
      map(raw => {
        const read = readCommandOk(raw, orderId);
        return read.kind === 'ok' ? read.value : ({ kind: 'unknown' } as const);
      }),
      catchError((err: unknown) =>
        of(
          err instanceof HttpErrorResponse && err.status === 409
            ? readRefusal(err.error)
            : ({ kind: 'unknown' } as const),
        ),
      ),
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
   * Mark a table dirty, available or out of service. FE-C points this at
   * `table-actions/update-status/`; it replaces the retired
   * `TablesService.updateTableStatus`, whose PUT the backend ignored.
   */
  setTableStatus(restaurantId: string, tableId: string, status: FloorStatusAction): Observable<StatusAnswer> {
    return this.transport.setTableStatus(restaurantId, tableId, status).pipe(
      map(() => ({ kind: 'ok' }) as StatusAnswer),
      catchError(() => of({ kind: 'unknown' } as StatusAnswer)),
      map(answer => {
        this.fence = ++this.opSeq;
        return answer;
      }),
    );
  }
}
