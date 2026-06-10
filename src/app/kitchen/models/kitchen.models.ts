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

/** A kitchen ticket = one order as seen by the kitchen. */
export interface KitchenTicket {
  /** Order UUID — the PATCH target in Phase 3. */
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
}

// ── Local-only helper types (NOT part of the API contract) ──────────────

export type FulfilmentStatus = KitchenTicket['fulfilment_status'];

/** Live link health for the always-visible connection indicator. */
export type ConnectionState = 'connected' | 'reconnecting' | 'offline';

/** Age-driven urgency cue for a not-yet-served ticket. */
export type EscalationLevel = 'normal' | 'warning' | 'overdue';
