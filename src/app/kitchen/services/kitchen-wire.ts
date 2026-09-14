/**
 * THE kitchen wire contract, read once and in one place (K3).
 *
 * This is deliberately NOT a schema framework. It is a small, specific reading
 * of the payloads `kitchen/orders/…` actually emits, and it exists because the
 * board used to believe anything roughly shaped right:
 *
 *   * any array was a ticket list, `[null]` included;
 *   * any finite number was a protocol level, `1.5` included;
 *   * any `data` carrying a numeric revision was a command result — including
 *     one describing a DIFFERENT order, which was then applied to the ticket
 *     the operator had commanded and its pending badge cleared. That is the
 *     sharpest of them: the board reported a success the server never stated
 *     about that order.
 *
 * TWO FAILURES ARE KEPT APART, because they call for opposite behaviour:
 *
 *   UNSUPPORTED — a server that declares no protocol. That is an OLDER server,
 *   not a broken one. Its feed is perfectly readable; the board simply may not
 *   command it. Nothing here may turn that into an error state.
 *
 *   INVALID — a server that claims the current protocol and then sends
 *   something this contract does not define. That is a contract error: the last
 *   valid board is retained, the operator is told, and no command is issued.
 *
 * What it does NOT do: compute business state. It checks that the server said
 * something well-formed about the right order; it never decides what the answer
 * should have been.
 */

import {
  FulfilmentStatus,
  KitchenAction,
  KitchenOrderState,
  KitchenTicket,
  KitchenTicketExtra,
  KitchenTicketItem,
  OrderStatus,
} from '../models/kitchen.models';

/** Fulfilment vocabulary, exactly as the server publishes it. */
const FULFILMENT_STATUSES: ReadonlySet<string> =
  new Set(['new', 'preparing', 'ready', 'served']);

/** Order-lifecycle vocabulary, exactly as the server publishes it. */
const ORDER_STATUSES: ReadonlySet<string> = new Set([
  'initiated', 'pending', 'preparing', 'served', 'paid', 'refunded', 'cancelled',
]);

/** The outcomes a successful kitchen command may report. */
const COMMAND_OUTCOMES: ReadonlySet<string> = new Set(['applied', 'unchanged']);

/**
 * A revision is a counter, so it is a non-negative INTEGER. `typeof x ===
 * 'number'` was the old test and it admits NaN, 2.5 and -1 — each of which
 * would then be sent back as a precondition the server cannot match.
 * The ceiling is the server's own PositiveIntegerField bound.
 */
const MAX_REVISION = 2147483647;

/**
 * The kitchen command protocol this client speaks — and, from this level up,
 * **a promise about the ROWS as well as about the routes**: a server declaring
 * it will publish a `fulfilment_revision` on every ticket. It lives here rather
 * than with the service because it is a fact about the wire, and because the
 * row rule below has to read it.
 */
export const REQUIRED_KITCHEN_PROTOCOL = 1;

export function isValidRevision(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    && value <= MAX_REVISION;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string');
}

function isAllergenTagList(value: unknown): boolean {
  return Array.isArray(value) && value.every(tag =>
    !!tag && typeof tag === 'object'
    && typeof (tag as any).name === 'string'
    && typeof (tag as any).icon === 'string'
    && typeof (tag as any).colour === 'string');
}

function isExtra(value: unknown): value is KitchenTicketExtra {
  if (!value || typeof value !== 'object') return false;
  const e = value as any;
  return typeof e.item_name_snapshot === 'string'
    && typeof e.quantity === 'number' && Number.isFinite(e.quantity)
    && isStringArray(e.modifiers)
    && isAllergenTagList(e.allergen_tags);
}

function isItem(value: unknown): value is KitchenTicketItem {
  if (!value || typeof value !== 'object') return false;
  const i = value as any;
  if (typeof i.item_name_snapshot !== 'string') return false;
  if (typeof i.quantity !== 'number' || !Number.isFinite(i.quantity)) return false;
  if (!isStringArray(i.modifiers)) return false;
  if (!isAllergenTagList(i.allergen_tags)) return false;
  if (i.extras !== undefined
      && !(Array.isArray(i.extras) && i.extras.every(isExtra))) return false;
  return true;
}

/**
 * One ticket row. The two D05 fields are OPTIONAL here on purpose: a pre-D05
 * server omits them and its board must still render. When present they must be
 * valid — a malformed revision is worse than an absent one, because an absent
 * one correctly makes the ticket non-commandable while a malformed one used to
 * sail through `typeof … === 'number'` and become a precondition.
 */
function isTicket(value: unknown, revisionRequired: boolean): value is KitchenTicket {
  if (!value || typeof value !== 'object') return false;
  const t = value as any;
  if (!isNonEmptyString(t.id)) return false;
  if (typeof t.order_number !== 'number' || !Number.isFinite(t.order_number)) return false;
  if (typeof t.table_label !== 'string') return false;
  if (typeof t.order_source !== 'string') return false;
  if (!FULFILMENT_STATUSES.has(t.fulfilment_status)) return false;
  if (typeof t.priority !== 'boolean') return false;
  if (!isNonEmptyString(t.created_at)) return false;
  if (!isStringOrNull(t.served_at)) return false;
  if (!Array.isArray(t.items) || !t.items.every(isItem)) return false;
  // THE DECLARATION IS A PROMISE ABOUT THE ROWS. An absent revision is fine from
  // a server that declares nothing — that is the pre-D05 shape, and its board is
  // simply read-only. From one that CLAIMS the protocol it is a contract error,
  // and treating it as tolerable produced the worst available outcome: the board
  // enabled itself on the declaration while `isCommandable` refused every single
  // click, so an operator pressed Start and nothing happened, with no notice.
  if (revisionRequired) {
    if (!isValidRevision(t.fulfilment_revision)) return false;
  } else if (t.fulfilment_revision !== undefined
             && !isValidRevision(t.fulfilment_revision)) {
    return false;
  }
  if (t.order_status !== undefined && !ORDER_STATUSES.has(t.order_status)) return false;
  return true;
}

/** A ticket may be commanded only when the server published a usable revision. */
export function isCommandable(ticket: KitchenTicket | undefined): boolean {
  return !!ticket && isValidRevision(ticket.fulfilment_revision);
}

/**
 * The protocol a response declares. ABSENT MEANS 0 — silence promises nothing.
 * A non-integer is not a level this client can speak, so it is also 0 rather
 * than an error: it leaves the board read-only, which is the safe direction.
 */
export function readProtocol(res: unknown): number {
  const declared = (res as any)?.kitchen_protocol;
  return isValidRevision(declared) ? declared : 0;
}

export type FeedVerdict =
  | { kind: 'ok'; tickets: KitchenTicket[]; protocol: number }
  | { kind: 'unreadable'; why: string };

/**
 * Read one feed response.
 *
 * Duplicate ids are refused rather than de-duplicated: the board addresses
 * tickets BY id (commands, operations, the Active/Completed split all key on
 * it), so a feed naming one id twice is not a board this client can represent,
 * and silently keeping one of them would be choosing an answer the server did
 * not give.
 */
export function readFeed(res: unknown): FeedVerdict {
  const data: any = (res as any)?.data;
  const rows: unknown =
    Array.isArray(data) ? data : Array.isArray(data?.records) ? data.records : null;
  if (rows === null) return { kind: 'unreadable', why: 'envelope' };

  // Read the declaration BEFORE the rows, because it decides how strict the row
  // rule is. The refusal is about the WHOLE answer, as every refusal here is: a
  // feed this client cannot represent is not a board it can render half of.
  const protocol = readProtocol(res);
  const revisionRequired = protocol >= REQUIRED_KITCHEN_PROTOCOL;

  const list = rows as unknown[];
  if (!list.every(row => isTicket(row, revisionRequired))) {
    return { kind: 'unreadable', why: 'ticket' };
  }

  const tickets = list as KitchenTicket[];
  const ids = new Set(tickets.map(t => t.id));
  if (ids.size !== tickets.length) return { kind: 'unreadable', why: 'duplicate' };

  return { kind: 'ok', tickets, protocol };
}

function isState(value: unknown): value is KitchenOrderState {
  if (!value || typeof value !== 'object') return false;
  const s = value as any;
  return isNonEmptyString(s.id)
    && isValidRevision(s.fulfilment_revision)
    && ORDER_STATUSES.has(s.order_status)
    && FULFILMENT_STATUSES.has(s.fulfilment_status)
    && typeof s.priority === 'boolean'
    && isStringOrNull(s.served_at)
    && isStringOrNull(s.cancelled_at)
    && isStringOrNull(s.cancellation_reason);
}

export type StateVerdict =
  | { kind: 'ok'; state: KitchenOrderState; outcome?: 'applied' | 'unchanged' }
  | { kind: 'invalid'; why: string };

/**
 * Read a projection the server sent ABOUT A PARTICULAR ORDER.
 *
 * `expectedId` is the whole point. A complete, internally valid payload is not
 * evidence about the commanded order unless it names it, and correlating that
 * here means every consumer — success, conflict and the reconciliation read —
 * gets the check without having to remember it.
 */
function readProjection(payload: unknown, expectedId: string): StateVerdict {
  if (!isState(payload)) return { kind: 'invalid', why: 'state' };
  const state = payload as KitchenOrderState;
  if (state.id !== expectedId) return { kind: 'invalid', why: 'wrong-order' };
  return { kind: 'ok', state };
}

/**
 * Read a COMMAND SUCCESS. Beyond the projection this also requires a defined
 * outcome word and refuses an error envelope delivered on a 2xx transport —
 * a body carrying `reason`, or a `status` of 400 and up, is the server
 * refusing, whatever the HTTP frame said, and must never clear a pending badge
 * as though the command had applied.
 */
export function readCommandSuccess(res: unknown, expectedId: string): StateVerdict {
  const body: any = res;
  if (!body || typeof body !== 'object') return { kind: 'invalid', why: 'envelope' };
  if (body.reason !== undefined) return { kind: 'invalid', why: 'refusal-envelope' };
  if (typeof body.status === 'number' && body.status >= 400) {
    return { kind: 'invalid', why: 'refusal-envelope' };
  }
  if (!COMMAND_OUTCOMES.has(body.outcome)) return { kind: 'invalid', why: 'outcome' };

  const verdict = readProjection(body.data, expectedId);
  if (verdict.kind !== 'ok') return verdict;
  return { kind: 'ok', state: verdict.state, outcome: body.outcome };
}

/**
 * The command as it was ISSUED — the thing a result has to be consistent with.
 *
 * `readCommandSuccess` above answers "is this a readable answer about the right
 * order". That is not the same question as "could this be the result of the
 * command I sent", and treating the first as the second is how an impossible
 * result cleared a pending badge.
 */
export interface IssuedCommand {
  /** The precondition the command carried. */
  ifRevision: number;
  action?: KitchenAction;
  /** The exact fulfilment state asked for, where the command names one. */
  target?: FulfilmentStatus;
  /** The request body, so an explicit value (priority, cancellation) is checked
   *  against what the server reports rather than against the action alone. */
  body: Record<string, unknown>;
}

/**
 * Does this state show WHAT THE COMMAND ASKED FOR?
 *
 * Deliberately says nothing about revisions — it is the "did it end up as
 * asked" half, shared by the result validator and by the reconciliation path so
 * the two cannot form different opinions about one command.
 *
 * A command with no recorded target matches nothing, which is the safe
 * direction: the operator is told what the order IS rather than that their
 * command worked.
 */
export function stateSatisfies(
  cmd: IssuedCommand, state: KitchenOrderState,
): boolean {
  const body: any = cmd.body ?? {};
  if (body.cancellation_reason !== undefined) {
    return state.order_status === 'cancelled';
  }
  // A CANCELLED ORDER SATISFIES NO OTHER COMMAND, and the reason is the same
  // coincidence this predicate was written to refuse. Cancel writes the
  // `order_status` axis and leaves the FULFILMENT axis exactly where it was —
  // the server's documented contract — so an order cancelled while it sat at
  // `ready` reports `ready` forever after. A recall that asked for `ready` then
  // matched by accident, and an operator who recalled a ticket a manager
  // cancelled underneath them was told their recall had landed, about an order
  // that is on no board at all. The revision moving is evidence that SOME
  // command applied; the retained axis is not evidence that this one did.
  if (state.order_status === 'cancelled') return false;
  if (body.priority !== undefined) return state.priority === body.priority;
  return cmd.target !== undefined && state.fulfilment_status === cmd.target;
}

/**
 * Read a mutation result AGAINST THE COMMAND THAT PRODUCED IT.
 *
 * The server builds a success from the locked row immediately after this
 * command's write, and `_assert_revision` guarantees the row was at
 * `if_revision` when it did. That fixes exactly two shapes:
 *
 *   * `applied` — the row was written, so the revision is the precondition plus
 *     ONE. Every applied path goes through the one `_bump`, which increments
 *     once; nothing in the contract increments twice or not at all.
 *   * `unchanged` — the single no-write result, emitted from ONE place: setting
 *     priority to the value it already holds. It reports the ORIGINAL revision
 *     and the requested boolean already in place. It is not an available result
 *     for a cancel, serve, advance, correct or recall, and accepting one there
 *     cleared a command that had demonstrably not been performed.
 *
 * And in both shapes the state must show what was asked for.
 *
 * THIS VALIDATES THE DEFINED PROTOCOL. It does not compute business state, and
 * it never decides what the server should have done — only whether what came
 * back is a result the contract permits for this command.
 */
export function readCommandResult(
  res: unknown, expectedId: string, cmd: IssuedCommand,
): StateVerdict {
  const verdict = readCommandSuccess(res, expectedId);
  if (verdict.kind !== 'ok') return verdict;

  const { state, outcome } = verdict;
  if (outcome === 'unchanged') {
    // The no-write result exists for priority alone.
    if ((cmd.body ?? {})['priority'] === undefined) {
      return { kind: 'invalid', why: 'unchanged-not-available' };
    }
    if (state.fulfilment_revision !== cmd.ifRevision) {
      return { kind: 'invalid', why: 'unchanged-revision' };
    }
  } else if (state.fulfilment_revision !== cmd.ifRevision + 1) {
    return { kind: 'invalid', why: 'applied-revision' };
  }

  if (!stateSatisfies(cmd, state)) {
    return { kind: 'invalid', why: 'result-mismatch' };
  }
  return verdict;
}

/**
 * Read an AUTHORISED CONFLICT body. The reason is what the operator is shown,
 * so it must be present; the projection is still correlated, because a conflict
 * about somebody else's order is no more applicable than a success about one.
 *
 * ABSENT STATE AND PRESENT-BUT-INVALID STATE ARE DIFFERENT FACTS. A genuine
 * policy denial carries none (a 403 deliberately does), and that must stay an
 * interpretable refusal. But a projection the server DID send and this contract
 * cannot correlate — naming another order, or malformed — used to be dropped
 * silently and the refusal reported as clean, which discarded the retained
 * command on the strength of a body we had just failed to read.
 */
export function readConflict(
  body: unknown, expectedId: string,
): { kind: 'ok'; reason: string; message?: string; state?: KitchenOrderState }
  | { kind: 'invalid'; why: string } {
  const b: any = body;
  if (!b || typeof b !== 'object') return { kind: 'invalid', why: 'envelope' };
  if (!isNonEmptyString(b.reason)) return { kind: 'invalid', why: 'reason' };

  // A refusal need not carry state (a 403 deliberately carries none).
  if (b.data === undefined || b.data === null) {
    return { kind: 'ok', reason: b.reason, message: b.message };
  }
  const verdict = readProjection(b.data, expectedId);
  if (verdict.kind !== 'ok') return { kind: 'invalid', why: verdict.why };
  return { kind: 'ok', reason: b.reason, message: b.message, state: verdict.state };
}

/**
 * Read the per-order reconciliation response. It is an OBSERVATION, so there is
 * no outcome word to check — and requiring one would be wrong, because a read
 * is not the result of an attempt.
 *
 * It still refuses an ERROR ENVELOPE delivered on a 2xx transport. A body
 * carrying `reason`, or a `status` of 400 and up, is the server declining;
 * a parseable `data` object beside it does not make it authoritative state.
 */
export function readObservedState(res: unknown, expectedId: string): StateVerdict {
  const body: any = res;
  if (!body || typeof body !== 'object') return { kind: 'invalid', why: 'envelope' };
  if (body.reason !== undefined) return { kind: 'invalid', why: 'refusal-envelope' };
  if (typeof body.status === 'number' && body.status >= 400) {
    return { kind: 'invalid', why: 'refusal-envelope' };
  }
  return readProjection(body.data, expectedId);
}

/** Vocabulary re-exported for the few places that legitimately branch on it. */
export function isTerminalOrderStatus(status: OrderStatus | undefined): boolean {
  return status === 'cancelled' || status === 'refunded';
}
