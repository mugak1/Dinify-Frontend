import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map, timer } from 'rxjs';
import { MOCK_FLOOR_TABLES, MockTableSeed } from '../data/floor-mock-data';
import {
  FLOOR_CONTRACT,
  FloorStatusAction,
  FloorTableStatus,
  FulfilmentStatus,
  PaymentTiming,
  RoundCommand,
  RoundRefusalReason,
  RoundSource,
  WireEnvelope,
  WireFloor,
  WireFloorTable,
  WireFloorTableDetail,
  WireRound,
  WireRoundCommandOk,
  WireRoundDetail,
  WireRoundItem,
  WireRoundRefusal,
} from '../models/floor.models';

/**
 * The transport seam. FloorService talks to the floor through exactly these four
 * calls and reads every answer through `floor-adapter.ts`. FE-C supplies an HTTP
 * implementation of this interface and flips `FloorService.USE_MOCK_DATA`; nothing
 * else in the view changes.
 *
 * Every method returns the RAW wire body (the `{status, message, data}` envelope) and
 * fails with an `HttpErrorResponse`, exactly as an HTTP transport would.
 */
export interface FloorTransport {
  getFloor(restaurantId: string): Observable<unknown>;
  getTable(restaurantId: string, tableId: string): Observable<unknown>;
  command(restaurantId: string, orderId: string, command: RoundCommand): Observable<unknown>;
  setTableStatus(restaurantId: string, tableId: string, status: FloorStatusAction): Observable<unknown>;
}

type MockRoundState = 'held' | 'released' | 'declined' | 'cancelled' | 'served';

interface MockRound {
  orderId: string;
  roundNumber: number;
  state: MockRoundState;
  source: RoundSource;
  acceptedAt: number;
  heldSince: number | null;
  releasedAt: number | null;
  fulfilmentStatus: FulfilmentStatus;
  items: WireRoundItem[];
  value: string;
  cannotBeMadeItem: string | null;
}

interface MockTable {
  id: string;
  number: number;
  displayName: string;
  areaId: string | null;
  status: FloorTableStatus;
  menuOnly: boolean;
  visit: { id: string; openedAt: number } | null;
  rounds: MockRound[];
}

export interface MockFloorDb {
  restaurant: { acceptingOrders: boolean; paymentTiming: PaymentTiming | null; trading: boolean };
  tables: MockTable[];
}

const MINUTE = 60_000;
/** The contract's stale threshold, computed here because the SERVER computes it. */
const STALE_AFTER_MS = 15 * MINUTE;
const EAT_OFFSET_MS = 3 * 60 * MINUTE;

/** ISO 8601 with the restaurant's offset (+03:00), as the backend answers. */
export function toEatIso(ms: number): string {
  return new Date(ms + EAT_OFFSET_MS).toISOString().replace(/\.\d{3}Z$/, '+03:00');
}

const LIVE: readonly MockRoundState[] = ['held', 'released'];

/**
 * An in-memory stand-in for the BE-D floor endpoints, answering in contract v1.
 * It keeps the server's rules (stale, needs-staff, ordering, idempotent resends, the
 * 409 reasons) so the view is exercised against the shapes it will meet for real.
 *
 * MOCK ONLY. `FloorService` uses it while `USE_MOCK_DATA` is true AND the build is a
 * development build; a production build never reaches it.
 */
@Injectable({ providedIn: 'root' })
export class FloorMockBackend implements FloorTransport {
  /** Latency, so the view's pending state is visible. Specs advance it with `tick`. */
  static READ_DELAY_MS = 250;
  static COMMAND_DELAY_MS = 600;

  /** The mock server's clock. Specs pin it. */
  clock: () => number = () => Date.now();

  private _db: MockFloorDb | null = null;

  /** The mock's state, seeded on first use. Specs edit it to stage a crossed command. */
  get db(): MockFloorDb {
    if (!this._db) this.reset();
    return this._db!;
  }

  /** Re-seed from `MOCK_FLOOR_TABLES` against the current clock. */
  reset(seeds: MockTableSeed[] = MOCK_FLOOR_TABLES): void {
    const now = this.clock();
    const ago = (min: number) => now - min * MINUTE;
    this._db = {
      restaurant: { acceptingOrders: true, paymentTiming: 'pay_after', trading: true },
      tables: seeds.map(t => ({
        id: t.id,
        number: t.number,
        displayName: t.displayName,
        areaId: t.areaId,
        status: t.status,
        menuOnly: t.menuOnly ?? false,
        visit: t.visitOpenedMinAgo === null ? null : { id: `visit-${t.id}`, openedAt: ago(t.visitOpenedMinAgo) },
        rounds: t.rounds.map(r => ({
          orderId: r.orderId,
          roundNumber: r.roundNumber,
          state: r.state,
          source: r.source,
          acceptedAt: ago(r.acceptedMinAgo),
          heldSince: r.state === 'held' ? ago(r.sinceMinAgo) : null,
          releasedAt: r.state === 'released' ? ago(r.sinceMinAgo) : null,
          fulfilmentStatus: r.fulfilmentStatus,
          items: r.items.map(i => ({ ...i, extras: i.extras.map(e => ({ ...e })), modifiers: [...i.modifiers] })),
          value: r.value,
          cannotBeMadeItem: r.cannotBeMadeItem ?? null,
        })),
      })),
    };
  }

  /** Find a round by order id (spec helper). */
  round(orderId: string): MockRound | undefined {
    for (const t of this.db.tables) {
      const r = t.rounds.find(x => x.orderId === orderId);
      if (r) return r;
    }
    return undefined;
  }

  table(tableId: string): MockTable | undefined {
    return this.db.tables.find(t => t.id === tableId);
  }

  // ── Transport ──────────────────────────────────────────────────

  getFloor(restaurantId: string): Observable<unknown> {
    return this.answer(FloorMockBackend.READ_DELAY_MS, () => this.ok('Floor', this.floor(restaurantId)));
  }

  getTable(_restaurantId: string, tableId: string): Observable<unknown> {
    return this.answer(FloorMockBackend.READ_DELAY_MS, () => {
      const t = this.table(tableId);
      if (!t) throw this.error(404, { status: 404, message: 'Not found.' });
      return this.ok('Table', this.tableDetail(t));
    });
  }

  command(_restaurantId: string, orderId: string, command: RoundCommand): Observable<unknown> {
    return this.answer(FloorMockBackend.COMMAND_DELAY_MS, () =>
      command === 'confirm' ? this.confirm(orderId) : this.decline(orderId),
    );
  }

  setTableStatus(_restaurantId: string, tableId: string, status: FloorStatusAction): Observable<unknown> {
    return this.answer(FloorMockBackend.COMMAND_DELAY_MS, () => {
      const t = this.table(tableId);
      if (!t) throw this.error(404, { status: 404, message: 'Not found.' });
      t.status = status;
      return this.ok('Table status updated', { id: t.id, status: t.status });
    });
  }

  // ── Rules ──────────────────────────────────────────────────────

  private confirm(orderId: string): WireEnvelope<WireRoundCommandOk> {
    const { table, round } = this.locate(orderId);
    if (round.state === 'released') return this.commandOk('Already confirmed', round, false);
    if (round.state === 'declined') throw this.refuse('round_declined', round);
    if (round.state !== 'held') throw this.refuse('round_not_held', round);
    if (!this.db.restaurant.trading) throw this.refuse('restaurant_not_trading', round);
    if (round.source === 'diner') {
      if (!this.db.restaurant.acceptingOrders) throw this.refuse('ordering_paused', round);
      if (table.menuOnly) throw this.refuse('table_menu_only', round);
      if (table.status === 'out_of_service') throw this.refuse('table_out_of_service', round);
    }
    if (round.cannotBeMadeItem) throw this.refuse('cannot_be_made', round, round.cannotBeMadeItem);
    round.state = 'released';
    round.releasedAt = this.clock();
    round.heldSince = null;
    round.fulfilmentStatus = 'new';
    return this.commandOk('Order sent to the kitchen', round, true);
  }

  private decline(orderId: string): WireEnvelope<WireRoundCommandOk> {
    const { round } = this.locate(orderId);
    if (round.state === 'declined') return this.commandOk('Already declined', round, false);
    if (round.state === 'released') throw this.refuse('round_released', round);
    if (round.state !== 'held') throw this.refuse('round_not_held', round);
    if (!this.db.restaurant.trading) throw this.refuse('restaurant_not_trading', round);
    round.state = 'declined';
    round.heldSince = null;
    return this.commandOk('Order declined', round, true);
  }

  private locate(orderId: string): { table: MockTable; round: MockRound } {
    for (const table of this.db.tables) {
      const round = table.rounds.find(r => r.orderId === orderId);
      if (round) return { table, round };
    }
    throw this.error(404, { status: 404, message: 'Not found.' });
  }

  // ── Serialisation (contract v1) ────────────────────────────────

  private floor(restaurantId: string): WireFloor {
    const now = this.clock();
    const tables = this.db.tables.map(t => this.tableObject(t, now));
    const needs = tables.filter(t => t.needs_staff).sort((a, b) => a.number - b.number);
    const rest = tables.filter(t => !t.needs_staff).sort((a, b) => a.number - b.number);
    return {
      contract: FLOOR_CONTRACT,
      server_time: toEatIso(now),
      restaurant: {
        id: restaurantId,
        accepting_orders: this.db.restaurant.acceptingOrders,
        payment_timing: this.db.restaurant.paymentTiming,
      },
      waiting_for_staff: tables.reduce((n, t) => n + t.rounds.filter(r => r.state === 'held').length, 0),
      tables: [...needs, ...rest],
    };
  }

  private tableObject(t: MockTable, now: number): WireFloorTable {
    const live = t.rounds.filter(r => LIVE.includes(r.state));
    return {
      id: t.id,
      number: t.number,
      display_name: t.displayName,
      area_id: t.areaId,
      status: t.status,
      occupied: live.length > 0,
      needs_staff: live.some(r => r.state === 'held'),
      visit: t.visit ? { id: t.visit.id, opened_at: toEatIso(t.visit.openedAt), payment: 'unknown' } : null,
      rounds: live.map(r => this.roundObject(r, now) as WireRound),
    };
  }

  private tableDetail(t: MockTable): WireFloorTableDetail {
    const now = this.clock();
    const shell = this.tableObject(t, now);
    const live = t.rounds.filter(r => LIVE.includes(r.state));
    return {
      ...shell,
      rounds: live.map((r): WireRoundDetail => ({
        ...(this.roundObject(r, now) as WireRound),
        items: r.items.map(i => ({ ...i, extras: i.extras.map(e => ({ ...e })), modifiers: [...i.modifiers] })),
        cannot_be_made:
          r.state === 'held' && r.cannotBeMadeItem
            ? { reason: 'item_sold_out', item_name: r.cannotBeMadeItem }
            : null,
      })),
    };
  }

  private roundObject(r: MockRound, now: number): Omit<WireRound, 'state'> & { state: string } {
    return {
      order_id: r.orderId,
      round_number: r.roundNumber,
      state: r.state,
      source: r.source,
      accepted_at: toEatIso(r.acceptedAt),
      held_since: r.state === 'held' && r.heldSince !== null ? toEatIso(r.heldSince) : null,
      released_at: r.state === 'released' && r.releasedAt !== null ? toEatIso(r.releasedAt) : null,
      stale: r.state === 'held' && r.heldSince !== null && now - r.heldSince >= STALE_AFTER_MS,
      fulfilment_status: r.fulfilmentStatus,
      item_count: r.items.reduce((n, i) => n + i.quantity, 0),
      value: r.value,
    };
  }

  // ── Envelopes ──────────────────────────────────────────────────

  private ok<T>(message: string, data: T): WireEnvelope<T> {
    return { status: 200, message, data };
  }

  private commandOk(message: string, round: MockRound, changed: boolean): WireEnvelope<WireRoundCommandOk> {
    return this.ok(message, { round: this.roundObject(round, this.clock()), changed });
  }

  private refuse(reason: RoundRefusalReason, round: MockRound, itemName?: string): HttpErrorResponse {
    const body: WireRoundRefusal = {
      status: 409,
      message: `Refused: ${reason}`,
      reason,
      state: round.state,
      ...(itemName ? { item_name: itemName } : {}),
    };
    return this.error(409, body);
  }

  private error(status: number, body: unknown): HttpErrorResponse {
    return new HttpErrorResponse({ status, statusText: status === 409 ? 'Conflict' : 'Not Found', error: body });
  }

  /**
   * Answer after `delayMs`. The rule runs when the "request lands", as on a server,
   * and a thrown `HttpErrorResponse` becomes the error notification.
   */
  private answer(delayMs: number, produce: () => unknown): Observable<unknown> {
    return timer(delayMs).pipe(map(() => produce()));
  }
}
