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

/**
 * The restaurant's configured payment timing, or `null` when nothing is configured
 * (BE-D D-10). `not_chosen` is a VISIT's word and is never emitted at the restaurant
 * level, so the adapter refuses it there.
 */
export type PaymentTiming = 'pay_after' | 'pay_first';

/**
 * The five floor-axis values (`Table.status`) this view knows. Occupancy is a separate
 * fact; see `occupied`.
 *
 * A table's `status` on the view model is a plain STRING, not this union (decision 2,
 * FE-C): BE-D reports the stored value as stored (D-17), and a value outside the five
 * may exist from before PR-5. One such row must not blank the whole floor, so the
 * adapter keeps the unknown value verbatim and the view reads it as "Status unknown".
 * Use `isKnownTableStatus` to narrow.
 */
export type FloorTableStatus = 'available' | 'seated' | 'bill_requested' | 'dirty' | 'out_of_service';

export const FLOOR_TABLE_STATUSES: readonly FloorTableStatus[] = [
  'available',
  'seated',
  'bill_requested',
  'dirty',
  'out_of_service',
];

export function isKnownTableStatus(status: string): status is FloorTableStatus {
  return (FLOOR_TABLE_STATUSES as readonly string[]).includes(status);
}

/** Only live rounds are listed on the floor: a served, cancelled or declined round is not. */
export type RoundState = 'held' | 'released';

/**
 * What a COMMAND answers about its round (BE-D A-4). A command answers about the round
 * it was sent for, which may have left the floor, so its state is wider than the
 * floor's: a successful Decline answers `declined`, and a crossed command may find
 * the round `cancelled` (by the kitchen), `served` or still a `draft`.
 */
export type CommandRoundState = RoundState | 'declined' | 'cancelled' | 'served' | 'draft';

export const COMMAND_ROUND_STATES: readonly CommandRoundState[] = [
  'held',
  'released',
  'declined',
  'cancelled',
  'served',
  'draft',
];

/**
 * Where `accepted_at` came from (BE-D A-3 / D-1): a recorded acceptance, or the
 * order's creation time for an order accepted before acceptances were recorded.
 */
export type AcceptedAtProvenance = 'acceptance' | 'order_created';

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

/**
 * The makeability classifications a `cannot_be_made` object may carry (BE-D D-13).
 * Kept as a string on the view model: the view names the item, never the
 * classification, so a new classification must not refuse a read.
 */
export const CANNOT_BE_MADE_REASONS: readonly string[] = [
  'item_sold_out',
  'item_deleted',
  'item_missing',
  'section_or_group_deleted',
  'extra_not_attachable',
  'extras_bounds_no_longer_met',
  'modifier_definition_removed',
  'modifier_definition_invalid',
  'modifier_group_missing',
  'modifier_choice_missing',
  'modifier_group_bounds_no_longer_met',
  'modifier_selection_meaning_changed',
  'allergen_declaration_changed',
];

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
  /** As stored (D-17); normally one of `FloorTableStatus`, but not guaranteed. */
  status: string;
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
  /** Additive (A-3). */
  accepted_at_provenance?: AcceptedAtProvenance;
  held_since: string | null;
  /** `null` for a held round, and for a released round with no placement (D-4). */
  released_at: string | null;
  stale: boolean;
  fulfilment_status: FulfilmentStatus;
  item_count: number;
  value: string;
}

/** The round a COMMAND answers about (A-4): the same object, with the wider state. */
export interface WireCommandRound extends Omit<WireRound, 'state'> {
  state: CommandRoundState;
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
 * round already where the command would have put it. The round carries the wider
 * command state (A-4): a successful Decline answers `declined`.
 */
export interface WireRoundCommandOk {
  round: WireCommandRound;
  changed: boolean;
}

/**
 * The 409 body, mirroring the kitchen's `_conflict` envelope (A-5): `reason` and
 * `state` beside `status`/`message`, and the round as it now is under `data.round`.
 * A `cannot_be_made` refusal also carries `item_name` and the `cannot_be_made`
 * object the drawer shows.
 */
export interface WireRoundRefusal {
  status: 409;
  message: string;
  reason: RoundRefusalReason;
  state: CommandRoundState;
  item_name?: string;
  cannot_be_made?: WireCannotBeMade;
  data: { round: WireCommandRound };
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
  /**
   * The stored value, VERBATIM. Normally one of `FloorTableStatus`; anything else is
   * kept as sent (never guessed into one of the five) and reads "Status unknown".
   * Narrow with `isKnownTableStatus`.
   */
  status: string;
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
  /** `null` when the server did not say (an older backend). */
  acceptedAtProvenance: AcceptedAtProvenance | null;
  heldSince: string | null;
  /** `null` while held, and for a released round whose release was never recorded (D-4). */
  releasedAt: string | null;
  stale: boolean;
  fulfilmentStatus: FulfilmentStatus;
  itemCount: number;
  /** The canonical decimal string, verbatim. A held round's value is "to pay", not owed. */
  value: string;
}

/** The round a command answered about. Its state may say it has left the floor. */
export interface CommandRound extends Omit<FloorRound, 'state'> {
  state: CommandRoundState;
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
      /** The round as the server now has it. The view takes it as the answer. */
      round: CommandRound;
    }
  | {
      kind: 'refused';
      reason: RoundRefusalReason | 'unknown';
      message: string;
      state: CommandRoundState | null;
      itemName: string | null;
      /**
       * `data.round`, the round as it now is (A-5). The view replaces its copy with it.
       * `null` when the body carried none, or one it could not read, or one about a
       * different order — never guessed.
       */
      round: CommandRound | null;
      /** A `cannot_be_made` refusal's object (A-5), the same one the drawer shows. */
      cannotBeMade: CannotBeMade | null;
    }
  /**
   * 404: the order is no longer available to this user (it does not exist, it is
   * outside the restaurant, the user lost the `tables` module, or the restaurant was
   * suspended — D-16 and C-2 give all of them the same answer).
   */
  | { kind: 'gone' }
  /**
   * No readable answer: a lost response, a timeout, or a 200 that did not name this
   * round. The server MAY have acted, so this is never shown as success or failure.
   */
  | { kind: 'unknown' };
