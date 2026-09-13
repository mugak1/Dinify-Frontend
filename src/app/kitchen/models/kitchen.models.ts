/**
 * Kitchen View — data contract.
 *
 * Phase 1 is MOCK-ONLY, but these snake_case interfaces ARE the API contract:
 * Phase 2's DRF serializer will be built to match this shape EXACTLY. Do NOT
 * rename or add fields here without coordinating the backend serializer.
 */

/**
 * An add-on attached to a ticket line (e.g. "Add bacon"). Mirrors the Phase 2
 * nested serializer shape — same self-contained allergen snapshot as the parent
 * line so the board needs no menu lookup.
 */
export interface KitchenTicketExtra {
  item_name_snapshot: string;
  quantity: number;
  modifiers: string[];
  allergen_tags: { name: string; icon: string; colour: string }[];
}

/** A single line on a kitchen ticket. */
export interface KitchenTicketItem {
  /** Name captured at order time (immune to later menu edits). */
  item_name_snapshot: string;
  quantity: number;
  /** Human-readable modifiers, e.g. ["Size: Large", "No onions"]. */
  modifiers: string[];
  /** Allergen snapshot — self-contained so the board needs no menu lookup. */
  allergen_tags: { name: string; icon: string; colour: string }[];
  /** Add-ons chosen for this line. Optional: many lines have none. */
  extras?: KitchenTicketExtra[];
}

/** The order-level lifecycle axis, as the server reports it (D05). */
export type OrderStatus =
  | 'initiated' | 'pending' | 'preparing' | 'served' | 'paid'
  | 'refunded' | 'cancelled';

/** A kitchen ticket = one order as seen by the kitchen. */
export interface KitchenTicket {
  /** Order UUID — the command target. */
  id: string;
  /** Sequential order number, displayed as #NNN. */
  order_number: number;
  /** e.g. "Table 7". */
  table_label: string;
  order_source: 'diner_self_service' | 'server_assisted';
  fulfilment_status: 'new' | 'preparing' | 'ready' | 'served';
  priority: boolean;
  /** ISO timestamp — drives age/escalation. */
  created_at: string;
  /** ISO timestamp — set when served; drives the recall window. */
  served_at: string | null;
  items: KitchenTicketItem[];

  // ── D05: what a command needs, and what a conflict is explained with ──
  /**
   * THE PRECONDITION. Every kitchen command names the revision it believes it
   * is acting on; the server refuses when that no longer matches the row it
   * locked. Optional ONLY so a pre-D05 server's payload still parses — a client
   * must never invent one (see `kitchenProtocolOf`).
   */
  fulfilment_revision?: number;
  /**
   * The order-level axis. Without it the board could not tell a cancelled or
   * draft order from a live one, so it could neither explain a conflict nor
   * explain a disappearance.
   */
  order_status?: OrderStatus;
}

/** The commands a kitchen client may issue. One action names ONE edge. */
export type KitchenAction = 'advance' | 'serve' | 'correct' | 'recall';

/**
 * The server's current-state projection, returned by every success and every
 * authorised conflict. ONE shape, so there is one thing to reconcile against.
 */
export interface KitchenOrderState {
  id: string;
  fulfilment_revision: number;
  order_status: OrderStatus;
  fulfilment_status: KitchenTicket['fulfilment_status'];
  priority: boolean;
  served_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
}

/** What the UI shows while a command is in flight or after it was refused. */
export type TicketOperationPhase =
  | 'pending'    // issued, no answer yet
  | 'conflict'   // the server refused, and said why — definitive
  | 'unknown'    // no usable answer: the server MAY have acted
  | 'checking'   // a reconciliation read is in flight against an unknown
  | 'resolved';  // reconciled: the current state is known, the cause is not

/**
 * The command itself, retained so an unresolved operation can be re-sent
 * EXACTLY as issued. Without this an "unknown" was unrecoverable in principle,
 * not merely unimplemented: a label and a revision are not a command.
 */
export interface RetainedCommand {
  /** The route the command was issued against. */
  url: string;
  /** The request body, INCLUDING the original `if_revision`. Never rebuilt from
   *  current state — refreshing the precondition would turn a stale command
   *  into a newly authorised one. */
  body: Record<string, unknown>;
  /** The kitchen action, where the command names one. */
  action?: KitchenAction;
  /** Which store the ticket was acted on from, so a move can be applied. */
  from: 'active' | 'completed';
}

/**
 * The context a command was issued under. IMMUTABLE and captured before the
 * request, so a delayed answer is judged against the world that asked the
 * question rather than whatever the board shows when it lands.
 */
export interface OperationOwner {
  scopeKey: string;
  generation: number;
}

/** One in-flight or unresolved command against one ticket. */
export interface TicketOperation {
  orderId: string;
  phase: TicketOperationPhase;
  /** What was asked for — used for the message, never to infer an outcome. */
  label: string;
  /** The precondition the command was issued with. NEVER refreshed on retry. */
  ifRevision: number;
  /** The retained command, so retry re-sends rather than re-decides. */
  command?: RetainedCommand;
  /** The context that issued it. */
  owner?: OperationOwner;
  /** Reconciliation attempts spent, so recovery is bounded. */
  attempts?: number;
  /** Present on a conflict: the machine reason and the authoritative state. */
  reason?: string;
  message?: string;
  state?: KitchenOrderState;
  /** True once the ticket has left both feeds — the notice must then be shown
   *  somewhere other than on its (now absent) card. */
  detached?: boolean;
}

/**
 * A menu item as the kitchen sees it for stock ("86") control. Matches the
 * prompt-6 list serializer (GET kitchen/menu-items/) EXACTLY — snake_case, per
 * the contract note above. The sold-out panel reads these and toggles `in_stock`
 * via PUT kitchen/menu-items/{id}/stock/.
 */
export interface KitchenMenuItem {
  /** Menu-item UUID — the PUT target for stock toggles. */
  id: string;
  name: string;
  /** Orderable right now? false ⇒ "Sold out" — the 86 flag this panel toggles. */
  in_stock: boolean;
  /** On the menu at all? Independent of in_stock (see CLAUDE.md domain note). */
  available: boolean;
  /** Owning menu section, e.g. "Pizzas" — the panel groups rows by this. */
  section_name: string;
}

// ── Local-only helper types (NOT part of the API contract) ──────────────

export type FulfilmentStatus = KitchenTicket['fulfilment_status'];

/** Live link health for the always-visible connection indicator. */
export type ConnectionState = 'connected' | 'reconnecting' | 'offline';

/** Age-driven urgency cue for a not-yet-served ticket. */
export type EscalationLevel = 'normal' | 'warning' | 'overdue';
