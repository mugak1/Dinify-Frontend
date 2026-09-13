/**
 * KitchenOrderService — the swappable seam between the board UI and its data.
 *
 * D05 CHANGED HOW A COMMAND IS REPRESENTED HERE, and the change is the point.
 *
 * IT USED TO MUTATE THE STORE OPTIMISTICALLY AND RESTORE AN OLD SNAPSHOT ON
 * ERROR. Every failure mode of that was reachable and none of it was honest:
 * a failed serve or cancel did `[...tickets, ticket]`, so if a poll had already
 * re-added the ticket the board showed the SAME CARD TWICE; a cancel whose
 * RESPONSE was lost (the server having applied it) put the cancelled ticket
 * back on the board; a failed advance wrote a stale snapshot over newer server
 * state; and a failed command left no trace at all, so staff were shown a
 * confident wrong answer rather than "we do not know".
 *
 * NOW: a command marks its ticket PENDING, and the outcome is decided by the
 * SERVER. Success applies the server's own projection. A conflict keeps the
 * ticket visible and attaches the server's reason and authoritative state. A
 * timeout or transport failure resolves to UNKNOWN — never to a rollback, which
 * would be a claim that the server did not act.
 *
 * TWO FENCES stop an old answer from overwriting a newer one:
 *   * a SCOPE generation (restaurant + operator session), bumped whenever the
 *     board's context changes, and
 *   * a per-read sequence, so a delayed poll cannot replace a newer store.
 *
 * THE PRECONDITION IS NEVER REFRESHED ON A RETRY. `if_revision` is captured
 * when the operator decides, and a retry re-sends THAT — refreshing it would
 * turn a stale command into a newly authorised one, which is precisely what the
 * token exists to prevent.
 *
 * The board owns the poll lifecycle (startPolling on init, stopPolling on
 * destroy); ticket state lives here in signals — components never own it. The
 * mock dataset + dev controls remain behind USE_MOCK_DATA as dormant
 * design-review aids (flip the const to true to use them locally).
 */

import { Injectable, computed, signal } from '@angular/core';
import { Observable, of, Subscription } from 'rxjs';
import { delay, map, tap, timeout } from 'rxjs/operators';

import { ApiResponse } from '../../_models/app.models';
import { ApiService } from '../../_services/api.service';
import { AuthenticationService } from '../../_services/authentication.service';
import {
  ConnectionState,
  FulfilmentStatus,
  KitchenAction,
  KitchenOrderState,
  KitchenTicket,
  TicketOperation,
} from '../models/kitchen.models';
import {
  isLegalAdvance,
  isRecallEligible,
  isWithinRecallWindow,
  recallTarget,
  sortTickets,
} from './kitchen-logic';
import { buildInjectedTicket, getMockTickets } from '../mock/kitchen-mock-data';

/** Flip to true to serve the in-memory MOCK dataset for local design review. */
const USE_MOCK_DATA = false;

/** Healthy poll cadence. Failures back off 3 → 5 → 10s; recovery snaps back. */
const POLL_BASE_MS = 3000;
/** A poll that doesn't answer within this window counts as a failure (covers
 *  silent hangs so connection health can't get stuck on 'connected'). */
const POLL_TIMEOUT_MS = 8000;
/** A command that does not answer within this window is UNKNOWN, never failed. */
const COMMAND_TIMEOUT_MS = 15000;

/**
 * The kitchen command protocol this client speaks. A server that does not
 * declare at least this cannot be commanded safely: it would not enforce the
 * precondition, and inventing a revision to send it would be worse than not
 * trying. The board goes READ-ONLY in that case — it never falls back to the
 * retired target-only form.
 */
export const REQUIRED_KITCHEN_PROTOCOL = 1;

/**
 * Pull the ticket array out of the API envelope. Active-orders may come back as
 * a bare array or wrapped as `{ data: { records: [...] } }` — handle both.
 *
 * Returns `null` for a shape it cannot read, which is DIFFERENT from an empty
 * board: an unreadable envelope used to be indistinguishable from "no active
 * orders" and silently emptied the screen.
 */
function extractTickets(res: ApiResponse<KitchenTicket>): KitchenTicket[] | null {
  const d: any = res?.data;
  if (Array.isArray(d)) return d as KitchenTicket[];
  if (Array.isArray(d?.records)) return d.records as KitchenTicket[];
  return null;
}

/**
 * The protocol level a feed response declares. ABSENT MEANS 0 — a server that
 * says nothing promises nothing, and a client must not read silence as support.
 */
export function kitchenProtocolOf(res: any): number {
  const declared = res?.kitchen_protocol;
  return typeof declared === 'number' && Number.isFinite(declared) ? declared : 0;
}

/** served_at as epoch ms; null/absent sorts as the oldest possible completion. */
function servedAtMs(served_at: string | null): number {
  return served_at ? new Date(served_at).getTime() : -Infinity;
}

@Injectable({ providedIn: 'root' })
export class KitchenOrderService {
  /** Raw ticket store — the single source of truth. */
  private readonly _tickets = signal<KitchenTicket[]>([]);

  /** Completed (served) store — mirrors _tickets for the Completed view. */
  private readonly _completed = signal<KitchenTicket[]>([]);

  /**
   * In-flight or unresolved commands, keyed by order id. A ticket with an entry
   * here is showing a pending/conflict/unknown badge; it is NOT removed from the
   * board, because removing it is what made a lost response indistinguishable
   * from a refusal.
   */
  private readonly _operations = signal<Record<string, TicketOperation>>({});

  /**
   * The protocol the server most recently DECLARED on a feed response. 0 means
   * it has said nothing, so commands are withheld.
   */
  readonly serverProtocol = signal(0);

  /** True when the board may issue commands at all. */
  readonly canCommand = computed(
    () => this.serverProtocol() >= REQUIRED_KITCHEN_PROTOCOL);

  /** True when a read returned a shape this client cannot parse. The board keeps
   *  its last valid content and says so, rather than blanking. */
  readonly feedUnreadable = signal(false);

  /**
   * Board-ordered tickets: priority first, then oldest first. Sorting here is
   * comparator-only (independent of `now`), so the computed does not need a
   * clock dependency — the board passes `now` to cards for age display.
   */
  readonly activeTickets = computed(() => sortTickets(this._tickets(), Date.now()));

  /**
   * Completed tickets, newest completion first (served_at DESCENDING). A missing
   * served_at sinks to the bottom — the real feed always stamps it, but this keeps
   * the sort total either way.
   */
  readonly completedTickets = computed(() =>
    [...this._completed()].sort(
      (a, b) => servedAtMs(b.served_at) - servedAtMs(a.served_at),
    ),
  );

  /** Always-visible link health, derived from poll outcomes (NOT navigator.onLine). */
  readonly connectionState = signal<ConnectionState>('connected');

  // ── Poll loop state (service-owned) ───────────────────────────────────
  private pollActive = false;
  private pollHandle: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Subscription | null = null;
  private consecutiveFailures = 0;

  // ── Fences ────────────────────────────────────────────────────────────
  /** Bumped whenever the board's restaurant/operator context changes. Any answer
   *  captured under an older generation is DISCARDED, never applied. */
  private scopeGeneration = 0;
  private scopeKey: string | null = null;
  /** Monotonic per-read sequence: a delayed poll cannot replace a newer store. */
  private readSeq = 0;
  private lastAppliedActive = 0;
  private lastAppliedCompleted = 0;

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthenticationService,
  ) {}

  /** The tablet's restaurant — the active-orders query is scoped to it. Reads the
   *  login-selected membership (rest_role), the single source of truth for the
   *  active restaurant, so a multi-restaurant user gets the board they chose. */
  private get restaurantId(): string | undefined {
    return this.auth.currentRestaurantRole?.restaurant_id;
  }

  /**
   * The context an answer belongs to. Re-read on every request rather than
   * cached, so an operator switching restaurant is noticed immediately — the
   * stale-scope defect this fence closes came from reading it once.
   */
  private currentScope(): string {
    const role = this.auth.currentRestaurantRole;
    return `${role?.restaurant_id ?? ''}:${(this.auth as any).userValue?.profile?.id ?? ''}`;
  }

  /** Note the live scope, bumping the generation when it has moved. */
  private syncScope(): number {
    const key = this.currentScope();
    if (this.scopeKey !== key) {
      this.scopeKey = key;
      this.scopeGeneration += 1;
      // A new context owns nothing the previous one produced.
      this._tickets.set([]);
      this._completed.set([]);
      this._operations.set({});
      this.feedUnreadable.set(false);
      this.serverProtocol.set(0);
      this.lastAppliedActive = 0;
      this.lastAppliedCompleted = 0;
    }
    return this.scopeGeneration;
  }

  /** Owner/manager at the active restaurant — the elevated-void gate (mirrors
   *  the backend): they may cancel a ticket past 'new'. Evaluated against the
   *  login-selected membership's roles, matching restaurantId's scope. */
  get isManager(): boolean {
    const roles = this.auth.currentRestaurantRole?.roles ?? [];
    return roles.includes('owner') || roles.includes('manager');
  }

  // ── Pending / conflict state ──────────────────────────────────────────

  operationFor(id: string): TicketOperation | undefined {
    return this._operations()[id];
  }

  /** True while a command against this ticket is unresolved. The UI disables
   *  further commands on it — and ONLY on it; unrelated tickets stay live. */
  isBusy(id: string): boolean {
    return this._operations()[id]?.phase === 'pending';
  }

  /** Dismiss a conflict/unknown notice once the operator has read it. Never
   *  clears a PENDING one — that outcome is still open. */
  acknowledge(id: string): void {
    const op = this._operations()[id];
    if (!op || op.phase === 'pending') return;
    this._operations.update(map => {
      const next = { ...map };
      delete next[id];
      return next;
    });
  }

  private setOperation(op: TicketOperation): void {
    this._operations.update(map => ({ ...map, [op.orderId]: op }));
  }

  private clearOperation(id: string): void {
    this._operations.update(map => {
      const next = { ...map };
      delete next[id];
      return next;
    });
  }

  /**
   * Fetch the active ticket set once and write it into the store. THE SEAM —
   * the poll loop calls this on a schedule; tests call it directly.
   */
  loadActive(): Observable<KitchenTicket[]> {
    if (USE_MOCK_DATA) {
      return of(getMockTickets()).pipe(
        delay(400),
        tap(tickets => this._tickets.set(tickets)),
      );
    }
    const generation = this.syncScope();
    const seq = ++this.readSeq;
    // The backend 400s without a restaurant scope; omit the param entirely when
    // absent so it never serialises as the literal string "undefined".
    const params = this.restaurantId ? { restaurant: this.restaurantId } : {};
    return this.api.get<KitchenTicket>(null, 'kitchen/orders/active/', params).pipe(
      map(res => this.applyFeed(res, generation, seq, 'active')),
    );
  }

  /**
   * Fetch the Completed (served) set once and write it into the completed store.
   * Mirrors loadActive — same restaurant scope + extractTickets — but hits the
   * server's completed feed, which returns served tickets newest-first. The board
   * calls this on enter (and on a refresh cadence while Completed is open).
   */
  loadCompleted(): Observable<KitchenTicket[]> {
    if (USE_MOCK_DATA) {
      // Mock: surface the served tickets from the design set as the completed feed.
      const served = getMockTickets().filter(t => t.fulfilment_status === 'served');
      return of(served).pipe(
        delay(400),
        tap(tickets => this._completed.set(tickets)),
      );
    }
    const generation = this.syncScope();
    const seq = ++this.readSeq;
    const params = this.restaurantId ? { restaurant: this.restaurantId } : {};
    return this.api.get<KitchenTicket>(null, 'kitchen/orders/completed/', params).pipe(
      map(res => this.applyFeed(res, generation, seq, 'completed')),
    );
  }

  /**
   * Apply one feed response, or refuse to.
   *
   * THREE REASONS TO DISCARD, and none of them empties the board:
   *   * the answer belongs to a scope that is no longer current;
   *   * a NEWER read has already been applied (a delayed poll must never
   *     overwrite fresher state);
   *   * the envelope cannot be read — which is a different fact from "there are
   *     no orders", and used to be silently treated as the latter.
   */
  private applyFeed(
    res: any, generation: number, seq: number, which: 'active' | 'completed',
  ): KitchenTicket[] {
    const store = which === 'active' ? this._tickets : this._completed;
    if (generation !== this.scopeGeneration) return store();
    const last = which === 'active'
      ? this.lastAppliedActive : this.lastAppliedCompleted;
    if (seq < last) return store();

    const tickets = extractTickets(res);
    if (tickets === null) {
      this.feedUnreadable.set(true);
      return store();
    }
    this.feedUnreadable.set(false);
    this.serverProtocol.set(kitchenProtocolOf(res));
    if (which === 'active') this.lastAppliedActive = seq;
    else this.lastAppliedCompleted = seq;
    store.set(tickets);
    return tickets;
  }

  // ── Poll lifecycle (board drives start/stop) ──────────────────────────

  /** Begin polling. Idempotent. */
  startPolling(): void {
    if (this.pollActive) return;
    this.pollActive = true;
    if (USE_MOCK_DATA) {
      // Mock: one-shot load so injected/mutated tickets aren't clobbered by a loop.
      this.inFlight = this.loadActive().subscribe();
      return;
    }
    this.pollOnce();
  }

  /** Stop polling and cancel any in-flight request / pending timer. */
  stopPolling(): void {
    this.pollActive = false;
    if (this.pollHandle) {
      clearTimeout(this.pollHandle);
      this.pollHandle = null;
    }
    this.inFlight?.unsubscribe();
    this.inFlight = null;
  }

  private pollOnce(): void {
    if (!this.pollActive) return;
    this.inFlight = this.loadActive()
      .pipe(timeout(POLL_TIMEOUT_MS))
      .subscribe({
        next: () => {
          this.consecutiveFailures = 0;
          this.connectionState.set('connected');
          this.inFlight = null;
          this.scheduleNext();
        },
        error: () => {
          this.consecutiveFailures++;
          // One missed window → reconnecting; ~3 in a row → offline.
          this.connectionState.set(this.consecutiveFailures >= 3 ? 'offline' : 'reconnecting');
          this.inFlight = null;
          this.scheduleNext();
        },
      });
  }

  private scheduleNext(): void {
    if (!this.pollActive) return;
    this.pollHandle = setTimeout(() => this.pollOnce(), this.nextDelayMs());
  }

  private nextDelayMs(): number {
    switch (this.consecutiveFailures) {
      case 0: return POLL_BASE_MS; // healthy / just recovered
      case 1: return 5000;
      default: return 10000; // 2+ consecutive failures
    }
  }

  // ── Commands ──────────────────────────────────────────────────────────

  /**
   * Advance one step along new → preparing → ready. Serving is its own command
   * (`serve`) because it is the one fulfilment transition with a commercial
   * consequence. Returns false when the client can see the request is not
   * sensible — never as a claim about what the server would have said.
   */
  advanceStatus(id: string, next: FulfilmentStatus): boolean {
    const ticket = this.find(id);
    if (!ticket || !isLegalAdvance(ticket.fulfilment_status, next)) return false;
    return this.command(
      ticket,
      next === 'served' ? 'serve' : 'advance',
      next === 'served' ? 'Serving' : `Moving to ${next}`,
    );
  }

  /**
   * Step a ticket back: served → ready (the server enforces the recall window)
   * or ready → preparing. Rejected (returns false) when the client can already
   * see it makes no sense.
   */
  recall(id: string): boolean {
    const ticket = this.find(id);
    if (!ticket || !isRecallEligible(ticket, Date.now())) return false;
    const target = recallTarget(ticket.fulfilment_status);
    if (!target) return false;
    return this.command(
      ticket,
      ticket.fulfilment_status === 'served' ? 'recall' : 'correct',
      ticket.fulfilment_status === 'served' ? 'Recalling' : 'Sending back',
    );
  }

  /**
   * Recall a completed ticket back onto the active board (served → ready).
   *
   * IT GOES THROUGH THE SAME CONTRACT AS EVERY OTHER COMMAND. It used to skip
   * the eligibility helper entirely and fire the request regardless of age,
   * which is why the ten-minute rule was dead in the shipped UI. The window is
   * the SERVER's rule; this check only spares an operator a round trip.
   */
  recallCompleted(id: string): boolean {
    const ticket = this._completed().find(t => t.id === id);
    if (!ticket || !isRecallEligible(ticket, Date.now())) return false;
    return this.command(ticket, 'recall', 'Recalling', 'completed');
  }

  /**
   * Set the priority flag to an EXPLICIT value. The old toggle is gone: it sent
   * the negation of a possibly-stale local snapshot, so a retry undid itself.
   */
  setPriority(id: string, priority: boolean): boolean {
    const ticket = this.find(id);
    if (!ticket) return false;
    return this.issue(ticket, 'kitchen/orders/' + id + '/priority/',
                      { priority }, priority ? 'Prioritising' : 'Clearing priority');
  }

  /** Kept for callers that still express intent as a flip; it resolves the
   *  explicit value here so the REQUEST always states one. */
  togglePriority(id: string): void {
    const ticket = this.find(id);
    if (!ticket) return;
    this.setPriority(id, !ticket.priority);
  }

  /** Void/cancel an order with a structured reason. */
  cancelOrder(id: string, reason: string): boolean {
    const ticket = this.find(id);
    if (!ticket) return false;
    return this.issue(ticket, 'kitchen/orders/' + id + '/cancel/',
                      { cancellation_reason: reason }, 'Cancelling');
  }

  private find(id: string): KitchenTicket | undefined {
    return this._tickets().find(t => t.id === id)
      ?? this._completed().find(t => t.id === id);
  }

  private command(
    ticket: KitchenTicket, action: KitchenAction, label: string,
    from: 'active' | 'completed' = 'active',
  ): boolean {
    return this.issue(
      ticket, `kitchen/orders/${ticket.id}/fulfilment-status/`,
      { action }, label, from);
  }

  /**
   * Issue ONE command and resolve it from the SERVER's answer.
   *
   * THE PRECONDITION COMES FROM THE TICKET THE OPERATOR ACTED ON. A ticket with
   * no revision means the server never published one, so the command is not sent
   * at all — inventing a zero would defeat the check.
   */
  private issue(
    ticket: KitchenTicket, url: string, body: Record<string, unknown>,
    label: string, from: 'active' | 'completed' = 'active',
  ): boolean {
    if (!this.canCommand()) return false;
    const ifRevision = ticket.fulfilment_revision;
    if (typeof ifRevision !== 'number') return false;
    if (this._operations()[ticket.id]?.phase === 'pending') return false;

    const generation = this.scopeGeneration;
    this.setOperation({
      orderId: ticket.id, phase: 'pending', label, ifRevision,
    });
    if (USE_MOCK_DATA) {
      this.clearOperation(ticket.id);
      return true;
    }

    this.api
      .postPatch(url, { ...body, if_revision: ifRevision }, 'put')
      .pipe(timeout(COMMAND_TIMEOUT_MS))
      .subscribe({
        next: (res: any) => this.resolveSuccess(ticket.id, generation, res, from),
        error: (err: any) => this.resolveFailure(ticket.id, generation, err, label),
      });
    return true;
  }

  /**
   * The server applied (or explicitly did not change) the command. Its own
   * projection is the truth — the client never computes the resulting state.
   */
  private resolveSuccess(
    id: string, generation: number, res: any, from: 'active' | 'completed',
  ): void {
    if (generation !== this.scopeGeneration) return;
    const state: KitchenOrderState | undefined = res?.data;
    this.clearOperation(id);
    if (!state || typeof state.fulfilment_revision !== 'number') {
      // A server that claimed the protocol and then sent an unusable body is a
      // contract error, not an older server. Say we do not know and let the
      // next poll settle it.
      this.setOperation({
        orderId: id, phase: 'unknown', label: 'Checking',
        ifRevision: -1,
        message: 'The kitchen server sent an answer this app could not read. '
               + 'Checking the current state.',
      });
      return;
    }
    this.mergeState(id, state, from);
  }

  /**
   * A refusal or a lost answer.
   *
   * A 409 is the server telling us what the ticket actually is: keep the card,
   * attach the reason and the authoritative state. Anything else — a timeout, a
   * transport failure, a 5xx — is UNKNOWN. It is never a rollback: the server
   * may well have acted, and restoring an old snapshot would assert it did not.
   */
  private resolveFailure(
    id: string, generation: number, err: any, label: string,
  ): void {
    if (generation !== this.scopeGeneration) return;
    const status = err?.status;
    const body = err?.error;
    if ((status === 409 || status === 403 || status === 400) && body?.reason) {
      this.setOperation({
        orderId: id, phase: 'conflict', label,
        ifRevision: this._operations()[id]?.ifRevision ?? -1,
        reason: body.reason,
        message: body.message,
        state: body.data,
      });
      if (body.data) this.mergeState(id, body.data, 'active', false);
      return;
    }
    this.setOperation({
      orderId: id, phase: 'unknown', label,
      ifRevision: this._operations()[id]?.ifRevision ?? -1,
      message: 'We could not confirm this with the kitchen server. '
             + 'The board will show the current state shortly.',
    });
  }

  /**
   * Fold the server's projection into the stores by KEY — never by appending.
   *
   * It also moves the ticket between the active and Completed stores when the
   * server says the fulfilment axis moved, so the two cannot disagree about
   * where a ticket lives while the next poll is still pending.
   */
  private mergeState(
    id: string, state: KitchenOrderState, from: 'active' | 'completed',
    allowMove = true,
  ): void {
    // A PROJECTION OLDER THAN THE STORED TICKET IS DISCARDED.
    //
    // The revision only ever increases on the server, so a lower one is
    // definitionally stale — and applying it does two harms at once: it restores
    // an older status over a newer poll, and it moves the STORED revision
    // BACKWARDS, so the operator's next command would carry a precondition the
    // server has already passed and earn a conflict nobody caused.
    //
    // It is the same rule the read path already applies through its sequence
    // fence; a command answer needs its own because it races the poll rather
    // than other reads. A ticket with no stored revision (a pre-D05 shape) is
    // overwritten: anything the server states is better than nothing.
    const current = this.find(id);
    const known = current?.fulfilment_revision;
    if (typeof known === 'number'
        && typeof state.fulfilment_revision === 'number'
        && state.fulfilment_revision < known) {
      return;
    }
    const patch = (t: KitchenTicket): KitchenTicket => ({
      ...t,
      fulfilment_status: state.fulfilment_status,
      priority: state.priority,
      served_at: state.served_at,
      order_status: state.order_status,
      fulfilment_revision: state.fulfilment_revision,
    });
    const existing = this.find(id);
    this._tickets.update(list => list.map(t => (t.id === id ? patch(t) : t)));
    this._completed.update(list => list.map(t => (t.id === id ? patch(t) : t)));
    if (!allowMove || !existing) return;

    const moved = patch(existing);
    const leavesTheBoard = moved.fulfilment_status === 'served'
      || moved.order_status === 'cancelled';
    if (leavesTheBoard) {
      this._tickets.update(list => list.filter(t => t.id !== id));
      if (moved.fulfilment_status === 'served'
          && moved.order_status !== 'cancelled') {
        this._completed.update(list =>
          list.some(t => t.id === id) ? list : [...list, moved]);
      }
    } else if (from === 'completed') {
      this._completed.update(list => list.filter(t => t.id !== id));
      this._tickets.update(list =>
        list.some(t => t.id === id) ? list : [...list, moved]);
    }
  }

  /**
   * Drop served tickets that have aged past the recall window. The board no
   * longer calls this in Phase 3 (the server's active-set query owns pruning),
   * but it's kept as a pure helper for the dormant mock path and its unit test.
   */
  pruneServed(now: number): void {
    const current = this._tickets();
    const kept = current.filter(t => isWithinRecallWindow(t, now));
    if (kept.length !== current.length) this._tickets.set(kept);
  }

  // ── Dev controls (MOCK-ONLY — for design review) ──────────────────────

  /** Force a connection state to exercise the indicator. Mock-only. */
  simulateConnectionState(state: ConnectionState): void {
    this.connectionState.set(state);
  }

  /**
   * Append a brand-new ticket. The board detects it as a new ID and fires the
   * chime + entry animation — the same path real poll results surface through.
   * Mock-only.
   */
  injectNewTicket(): KitchenTicket {
    const ticket = buildInjectedTicket();
    this._tickets.update(tickets => [...tickets, ticket]);
    return ticket;
  }
}
