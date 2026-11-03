/**
 * Floor contract v1 (Step 2) — the shape the backend floor endpoints (BE-D) and this
 * floor view agree on.
 *
 * TWO LAYERS, AND ONLY ONE PLACE CROSSES BETWEEN THEM.
 *   - The `Wire*` types are the contract exactly as the server sends it: snake_case,
 *     ISO 8601 strings with an offset, money as a decimal string. Nothing outside
 *     `floor-adapter.ts` reads them.
 *   - The camelCase types are what the view renders. `floor-adapter.ts` is the ONE
 *     mapping from one to the other, so FE-C changes the transport and the flag and
 *     nothing else.
 *
 * THERE IS NO PAYMENT FIELD EXCEPT `payment: "unknown"`. Step 2 records no payment and
 * Dinify is non-custodial, so nothing in this file can carry a claim that a payment was
 * taken: there is no `is_paid`, `current_check` or `balance`, and `payment` is a literal
 * type with one value.
 */

/** The contract tag every floor read carries. A read with any other tag is refused. */
export const FLOOR_CONTRACT = 'floor.v1' as const;

export type PaymentTiming = 'pay_after' | 'pay_first' | 'not_chosen';

/** The floor axis (`Table.status`). Occupancy is a separate fact; see `occupied`. */
export type FloorTableStatus = 'available' | 'seated' | 'bill_requested' | 'dirty' | 'out_of_service';

/** Only live rounds are listed: a served, cancelled or declined round is not. */
export type RoundState = 'held' | 'released';

export type RoundSource = 'diner' | 'staff';

/** The kitchen axis. Meaningful only for a released round. */
export type FulfilmentStatus = 'new' | 'preparing' | 'ready' | 'served';

/** The one payment value the contract allows. */
export type VisitPayment = 'unknown';

/** The three status actions the floor view offers. */
export type FloorStatusAction = 'dirty' | 'available' | 'out_of_service';

/** Every `reason` a 409 on confirm or decline may carry. */
export type RoundRefusalReason =
  | 'round_declined'
  | 'round_released'
  | 'round_not_held'
  | 'restaurant_not_trading'
  | 'ordering_paused'
  | 'table_menu_only'
  | 'table_out_of_service'
  | 'cannot_be_made';

export const ROUND_REFUSAL_REASONS: readonly RoundRefusalReason[] = [
  'round_declined',
  'round_released',
  'round_not_held',
  'restaurant_not_trading',
  'ordering_paused',
  'table_menu_only',
  'table_out_of_service',
  'cannot_be_made',
];

export type RoundCommand = 'confirm' | 'decline';

// ── Wire (contract) ──────────────────────────────────────────────

export interface WireEnvelope<T> {
  status: number;
  message: string;
  data: T;
}

export interface WireFloor {
  contract: typeof FLOOR_CONTRACT;
  server_time: string;
  restaurant: {
    id: string;
    accepting_orders: boolean;
    payment_timing: PaymentTiming | null;
  };
  waiting_for_staff: number;
  tables: WireFloorTable[];
}

export interface WireFloorTable {
  id: string;
  number: number;
  display_name: string;
  area_id: string | null;
  status: FloorTableStatus;
  occupied: boolean;
  needs_staff: boolean;
  visit: WireVisit | null;
  rounds: WireRound[];
}

export interface WireVisit {
  id: string;
  opened_at: string;
  payment: VisitPayment;
}

export interface WireRound {
  order_id: string;
  round_number: number;
  state: RoundState;
  source: RoundSource;
  accepted_at: string;
  held_since: string | null;
  released_at: string | null;
  stale: boolean;
  fulfilment_status: FulfilmentStatus;
  item_count: number;
  value: string;
}

/** The table drawer's read adds `items` and `cannot_be_made` to every round. */
export interface WireRoundDetail extends WireRound {
  items: WireRoundItem[];
  cannot_be_made: WireCannotBeMade | null;
}

export interface WireFloorTableDetail extends Omit<WireFloorTable, 'rounds'> {
  rounds: WireRoundDetail[];
}

export interface WireRoundItem {
  name: string;
  quantity: number;
  extras: { name: string; quantity: number }[];
  modifiers: string[];
  note: string | null;
}

export interface WireCannotBeMade {
  reason: string;
  item_name: string;
}

/**
 * The 200 answer to confirm or decline. `changed: false` is a resend that found the
 * round already where the command would have put it.
 *
 * The round object here is NOT narrowed to `RoundState`: a declined round is not a
 * live one, so the decline answer's `state` is outside the list's vocabulary. The
 * adapter reads it as a plain string (see `RoundCommandAnswer`).
 */
export interface WireRoundCommandOk {
  round: Omit<WireRound, 'state'> & { state: string };
  changed: boolean;
}

/** The 409 body. `reason` and `state` sit beside `status`/`message`, as on the kitchen board. */
export interface WireRoundRefusal {
  status: 409;
  message: string;
  reason: RoundRefusalReason;
  state: string;
  item_name?: string;
}

// ── View model (camelCase) ───────────────────────────────────────

export interface FloorSnapshot {
  contract: typeof FLOOR_CONTRACT;
  /** The server's clock when it answered. Ages are measured against it, not the device's. */
  serverTime: string;
  restaurant: {
    id: string;
    acceptingOrders: boolean;
    paymentTiming: PaymentTiming | null;
  };
  /** Rendered verbatim as "N waiting"; never recomputed here. */
  waitingForStaff: number;
  tables: FloorTable[];
}

export interface FloorTable {
  id: string;
  number: number;
  displayName: string;
  areaId: string | null;
  status: FloorTableStatus;
  occupied: boolean;
  needsStaff: boolean;
  visit: FloorVisit | null;
  rounds: FloorRound[];
}

export interface FloorVisit {
  id: string;
  openedAt: string;
  payment: VisitPayment;
}

export interface FloorRound {
  orderId: string;
  roundNumber: number;
  state: RoundState;
  source: RoundSource;
  acceptedAt: string;
  heldSince: string | null;
  releasedAt: string | null;
  stale: boolean;
  fulfilmentStatus: FulfilmentStatus;
  itemCount: number;
  /** The canonical decimal string, verbatim. A held round's value is "to pay", not owed. */
  value: string;
}

export interface FloorRoundItem {
  name: string;
  quantity: number;
  extras: { name: string; quantity: number }[];
  modifiers: string[];
  note: string | null;
}

export interface CannotBeMade {
  reason: string;
  itemName: string;
}

export interface FloorRoundDetail extends FloorRound {
  items: FloorRoundItem[];
  cannotBeMade: CannotBeMade | null;
}

export interface FloorTableDetail extends Omit<FloorTable, 'rounds'> {
  rounds: FloorRoundDetail[];
}

/** The answer to confirm or decline, after the adapter has read it. */
export type RoundCommandAnswer =
  | {
      kind: 'ok';
      changed: boolean;
      orderId: string;
      /** `held` / `released` when the round is still live; anything else (e.g. a decline's answer) means it has left the floor. */
      state: string;
    }
  | {
      kind: 'refused';
      reason: RoundRefusalReason | 'unknown';
      message: string;
      state: string | null;
      itemName: string | null;
    }
  /**
   * No readable answer: a lost response, a timeout, or a 200 that did not name this
   * round. The server MAY have acted, so this is never shown as success or failure.
   */
  | { kind: 'unknown' };
