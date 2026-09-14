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
 * ONE FRESHNESS RULE now covers EVERY response path — both feeds, command
 * success, authorised conflict and the reconciliation read — because closing
 * one direction and leaving another writer replacing state unconditionally is
 * not a fence, it is a gap with a fence next to it:
 *   * a SCOPE generation (restaurant + operator), re-read when a request STARTS
 *     *and* when an answer LANDS, so a context change with no following read
 *     cannot let an old answer through;
 *   * one monotonic stamp per write, so a read can only speak for tickets whose
 *     last write it could have seen — in their FIELDS and in their MEMBERSHIP;
 *   * a per-store watermark on that same clock, because a feed is a statement
 *     about a SET: a read older than the newest one a store has applied may
 *     still correct a ticket it holds, but may neither admit one the newer read
 *     omitted nor remove one it never mentioned;
 *   * tombstones for ids a command removed, so an older read cannot resurrect
 *     them, forgotten again once a newer read has settled the question.
 *
 * AN UNCERTAIN COMMAND IS RECONCILED RATHER THAN LEFT SITTING. The command
 * itself is retained (route, values, original precondition, issuing context),
 * an ordinary read settles it where it can, a narrow per-order read settles the
 * case the feeds cannot — a cancelled order is in neither of them — and an
 * explicit retry re-sends the SAME command. Dismissing a notice never means
 * abandoning work the server may have done.
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

import { ApiService } from '../../_services/api.service';
import { AuthenticationService } from '../../_services/authentication.service';
import {
  ConnectionState,
  FulfilmentStatus,
  KitchenAction,
  KitchenOrderState,
  KitchenTicket,
  OperationOwner,
  RetainedCommand,
  TicketOperation,
} from '../models/kitchen.models';
import {
  isLegalAdvance,
  isRecallEligible,
  isWithinRecallWindow,
  recallTarget,
  sortTickets,
} from './kitchen-logic';
import {
  REQUIRED_KITCHEN_PROTOCOL,
  isCommandable,
  readCommandResult,
  readConflict,
  readFeed,
  readObservedState,
  readProtocol,
  stateSatisfies,
} from './kitchen-wire';
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
 *
 * DEFINED IN `kitchen-wire.ts` and re-exported here. The row rule has to read
 * it — from this level up the declaration promises a `fulfilment_revision` on
 * every ticket — so the wire contract is where it belongs, and two constants
 * with one value is how a promise and the thing that checks it drift apart.
 */
export { REQUIRED_KITCHEN_PROTOCOL };

/**
 * The protocol level a feed response declares. ABSENT MEANS 0 — a server that
 * says nothing promises nothing, and a client must not read silence as support.
 * Delegates to the one wire contract so the board and the validator cannot hold
 * different opinions about what a declaration is.
 */
export function kitchenProtocolOf(res: any): number {
  return readProtocol(res);
}

/** How many reconciliation reads one unresolved command may spend. Recovery has
 *  to be bounded or a dead server turns one lost reply into a poll loop. */
const MAX_RECONCILE_ATTEMPTS = 5;

/** How many removed/moved ids to remember, so a delayed read cannot resurrect
 *  them. Bounded: the board is a live surface, not an audit log. */
const MAX_TOMBSTONES = 200;

/**
 * How many orders to remember a stamp and revision floor for.
 *
 * Bounded for the same reason the tombstones are, and evicted under a rule that
 * CANNOT HAND AN OUTSTANDING OLD RESPONSE NEW AUTHORITY: only an id that is on
 * neither board and carries no operation is ever dropped, so the entry that a
 * stale row would have to clear is exactly the one that is never evicted. An id
 * we have genuinely finished with behaves like one never seen, which is what a
 * board that has moved on should do.
 */
const MAX_KNOWN_ORDERS = 500;

/** What the board remembers about one order beyond the visible ticket. */
interface KnownOrder {
  /** Local stamp of the write that last set it (see `opSeq`). */
  stamp: number;
  /** Highest SERVER revision ever reported for it, or -1 if none was. */
  revision: number;
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

  /**
   * ONE monotonic clock for every write, and that is what makes the freshness
   * rule uniform.
   *
   * A read takes a stamp when it STARTS; a command result takes one when it is
   * APPLIED. Every ticket remembers the stamp of the write that last set it. A
   * read can therefore only speak for tickets whose last write it could have
   * seen: if a ticket's stamp is newer than the read's start, that read is not
   * evidence about it — not for its fields, and not for its membership.
   *
   * The previous code had two separate read counters and nothing at all
   * connecting a read to a command, so a read that started before a command and
   * answered after it reinstated the pre-command row wholesale.
   */
  private opSeq = 0;

  /**
   * ONE counter for REQUEST identity, deliberately apart from `opSeq`.
   *
   * `opSeq` orders WRITES so a read can be told whether it could have seen one.
   * This one names the QUESTION a given request asked, so a late answer can be
   * told whether anyone is still waiting for it. They answer different things
   * and sharing a counter would only make each harder to reason about.
   */
  private requestSeq = 0;

  /**
   * What we know about one order: the local stamp of the write that last set it
   * AND the highest SERVER revision we have ever been told it reached.
   *
   * THEY ARE ONE ENTRY BECAUSE THEY MUST BE EVICTED TOGETHER. Local request
   * order is not server observation order — a read that STARTED later can carry
   * an older server snapshot, because the server observed it earlier — so the
   * stamp alone let a later-started read move a ticket backwards: onto the other
   * board, at a superseded revision, and even back from a cancellation. The
   * revision is the server's own ordering and is the floor a row has to clear.
   *
   * Neither replaces the other. The stamp still answers "could this read have
   * seen that write", which is what empty feeds and new membership turn on and
   * which a revision cannot express; the revision answers "is this row a state
   * the server has already moved past". A row must satisfy BOTH.
   *
   * IT OUTLIVES THE TICKET. A cancelled order is in neither store, so reading
   * the floor off the visible ticket lost it exactly when it was still needed.
   */
  private knownById = new Map<string, KnownOrder>();

  /**
   * The newest read each store has APPLIED, on that same clock. It is a
   * watermark, not a second clock, and it answers a question the per-ticket
   * stamp cannot: WHICH TICKETS ARE ON THIS BOARD AT ALL.
   *
   * A feed is a statement about a SET. A read that started earlier than the
   * newest applied one is not authoritative about that set, so it may neither
   * ADMIT an id the newer read omitted nor REMOVE one it did not mention. It
   * may still correct the fields of a ticket already held, which is what makes
   * this narrower than the whole-response discard it replaces.
   */
  private feedSeq: Record<'active' | 'completed', number> = { active: 0, completed: 0 };

  /**
   * The newest read, on that same clock, whose PROTOCOL DECLARATION has been
   * published — and it is deliberately NOT per store.
   *
   * A feed is a statement about one store's set, so membership is fenced per
   * store. The declaration is a statement about THE SERVER, so fencing it the
   * same way was not a fence at all: a Completed read that started before an
   * Active read is still the newest read for its own store, so it republished a
   * capability the Active read had already withdrawn — re-enabling commands
   * from stale information during exactly the situation the gate exists for, a
   * rollout or a mixed-version fleet.
   */
  private protocolSeq = 0;

  /**
   * Ids a command removed from the board, with the stamp of the removal. A read
   * older than that stamp must not bring them back — that is the resurrection
   * defect, reached through the feed rather than through the failure path.
   * Bounded, and an id is forgotten once a NEWER read has legitimately spoken.
   */
  private tombstones = new Map<string, number>();

  private authSub: Subscription | null = null;

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthenticationService,
  ) {
    // THE ONE EVENT THE PRINCIPAL HALF OF OWNERSHIP HAS. `currentRestaurantRole`
    // is read from storage on every access, so a restaurant change is caught by
    // re-reading (which every entry point and every response now does). The
    // USER half has no such read-through: sign-out and session replacement are
    // published here, and without observing them a board with no poll running
    // would keep showing the previous principal's tickets until something
    // happened to ask. This is an observation, not an authentication path.
    this.authSub = this.auth.user?.subscribe(() => this.syncScope()) ?? null;
  }

  /** Release the auth observation. The board is root-provided, so this matters
   *  for tests and for any future non-singleton use. */
  ngOnDestroy(): void {
    this.authSub?.unsubscribe();
    this.authSub = null;
    this.stopPolling();
  }

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
      // MONOTONIC, never restored. Going A -> B -> A is a THIRD context, not a
      // return to the first: an answer captured under the original A must still
      // be discarded, because nothing guarantees the board is what it was.
      this.scopeGeneration += 1;
      // A new context owns nothing the previous one produced.
      this._tickets.set([]);
      this._completed.set([]);
      this._operations.set({});
      this.feedUnreadable.set(false);
      this.serverProtocol.set(0);
      this.knownById.clear();
      this.tombstones.clear();
      this.feedSeq = { active: 0, completed: 0 };
      this.protocolSeq = 0;
    }
    return this.scopeGeneration;
  }

  /** The stamp for the next write. See `opSeq`. */
  private nextStamp(): number {
    return ++this.opSeq;
  }

  /** Local stamp of the last write to this order (0 = never written). */
  private stampOf(id: string): number {
    return this.knownById.get(id)?.stamp ?? 0;
  }

  /** Highest server revision ever reported for this order (-1 = never). */
  private revisionOf(id: string): number {
    return this.knownById.get(id)?.revision ?? -1;
  }

  /**
   * Which board currently holds this ticket, if either.
   *
   * THE ANSWER IS READ, NEVER ASSUMED. Every membership decision outside the
   * feed merge used to assume Active, which is wrong for anything an operator
   * acted on from Completed — a recall's refusal, most obviously.
   */
  private storeOf(id: string): 'active' | 'completed' | undefined {
    if (this._tickets().some(t => t.id === id)) return 'active';
    if (this._completed().some(t => t.id === id)) return 'completed';
    return undefined;
  }

  /**
   * Is this feed row a server state we already know has been superseded?
   *
   * LOCAL REQUEST ORDER IS NOT SERVER OBSERVATION ORDER. Two reads issued a
   * moment apart are answered from two snapshots the server took in whatever
   * order it got to them, so a read that STARTED later can carry the OLDER
   * state. The stamp fence cannot see that — by its clock the later read is
   * newer and therefore authoritative — so a perfectly valid pair of responses,
   * neither malformed and neither out of scope, walked a ticket backwards
   * across the two boards at a revision the server had already left behind.
   *
   * The server's own revision is the only ordering that survives that, and it
   * is a FLOOR rather than a replacement: the stamp still answers "could this
   * read have seen that write", which is what an empty feed and new membership
   * turn on and which a revision cannot express. A row must clear BOTH.
   *
   * A row carrying no revision (a pre-D05 shape, reachable only on an
   * UNDECLARED feed) says nothing about server ordering, so it is not held
   * back here — the stamp fence remains its only ordering, exactly as before.
   */
  private behindKnownRevision(fresh: KitchenTicket): boolean {
    const known = this.revisionOf(fresh.id);
    if (known < 0) return false;
    const rev = fresh.fulfilment_revision;
    if (typeof rev !== 'number') return false;
    return rev < known;
  }

  /**
   * Record a write: its local stamp, and the server revision it carried.
   *
   * THE REVISION ONLY EVER CLIMBS. A row that clears the floor sets a new one;
   * a row without a revision (a pre-D05 shape) advances the stamp and leaves
   * the floor where it was, because it says nothing about server ordering.
   *
   * IT DOES NOT EVICT, and that is the point rather than an omission. Eviction
   * reads the stores to decide what is still live, and a write happens BEFORE
   * the store it belongs to has been installed — so a sweep fired from here saw
   * the PRE-merge board and treated the very row being admitted as finished
   * with. Its floor was deleted the instant it was created, and the next older
   * snapshot walked that ticket backwards: exactly the regression this map
   * exists to prevent, produced by the map's own housekeeping. `evictKnown` is
   * therefore called by the writers AFTER their stores are final.
   */
  private noteWrite(id: string, stamp: number, revision?: number): void {
    const known = this.knownById.get(id);
    const next: KnownOrder = {
      stamp,
      revision: Math.max(
        known?.revision ?? -1,
        typeof revision === 'number' ? revision : -1,
      ),
    };
    this.knownById.delete(id);      // re-insert so Map order is recency
    this.knownById.set(id, next);
  }

  /**
   * Forget the oldest orders we are certainly finished with.
   *
   * THREE CLASSES ARE NEVER DROPPED, and each is one a delayed answer could
   * still speak about — evicting any of them would hand that answer exactly the
   * authority this map exists to deny:
   *   * an id on either board;
   *   * an id carrying an operation, resolved or not — the lost cancellation is
   *     this case, and it is the one that matters most, because the order is on
   *     no board and its floor has nowhere else to live;
   *   * an id a command REMOVED from the board, for as long as that removal is
   *     still load-bearing. The tombstone was already the map of exactly those
   *     ids; it simply was not consulted here.
   *
   * IT IS CALLED BY THE WRITERS, AFTER THEIR STORES ARE FINAL, and never from
   * `noteWrite`. It decides liveness by READING the stores, and a write happens
   * before the store it belongs to is installed — so a sweep fired at write
   * time saw the PRE-merge board, found the row being admitted absent from it,
   * and deleted the floor it had just created. The next older snapshot then
   * walked that ticket backwards: the regression this map exists to prevent,
   * caused by its own housekeeping. Both call sites are therefore placed after
   * the last store update on their path, and there are only two because
   * `noteWrite` has only two callers.
   *
   * WHAT IT DOES NOT PROMISE, stated rather than implied: the map is bounded,
   * so a fully settled order with no operation, on no board and past its
   * tombstone is eventually forgotten, and after that a sufficiently delayed
   * snapshot of it would be treated as new. That is bounded memory behaving as
   * bounded memory, and the window it leaves is the few seconds a read can be
   * in flight — every read carries an 8s timeout and every command a 15s one.
   * Tests pin both halves: the protection, and the bound.
   */
  private evictKnown(): void {
    const live = new Set<string>([
      ...this._tickets().map(t => t.id),
      ...this._completed().map(t => t.id),
      ...Object.keys(this._operations()),
      ...this.tombstones.keys(),
    ]);
    for (const id of [...this.knownById.keys()]) {
      if (this.knownById.size <= MAX_KNOWN_ORDERS) return;
      if (!live.has(id)) this.knownById.delete(id);
    }
  }

  private rememberTombstone(id: string, stamp: number): void {
    this.tombstones.set(id, stamp);
    if (this.tombstones.size > MAX_TOMBSTONES) {
      // Oldest-first: Map preserves insertion order.
      const oldest = this.tombstones.keys().next();
      if (!oldest.done) this.tombstones.delete(oldest.value);
    }
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

  /**
   * Dismiss a SETTLED notice once the operator has read it.
   *
   * IT DOES NOT DISMISS AN OPEN QUESTION. `unknown` and `checking` mean the
   * server may have acted and we have not established whether it did; deleting
   * that on OK made a dismissal silently mean "abandon whatever the server did
   * with this command", which is not a thing a button should quietly do. A
   * conflict is different — the server stated its refusal, so reading it is the
   * end of it — and so is a reconciled `resolved`.
   */
  acknowledge(id: string): void {
    const op = this._operations()[id];
    if (!op) return;
    if (op.phase !== 'conflict' && op.phase !== 'resolved') return;
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
    const seq = this.nextStamp();
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
    const seq = this.nextStamp();
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
    // RE-READ THE LIVE CONTEXT FIRST. The generation used to be sampled only
    // when a request started, so a context change with no following read left
    // it unmoved and an answer from the previous restaurant passed the check.
    this.syncScope();
    if (generation !== this.scopeGeneration) return store();

    const verdict = readFeed(res);
    if (verdict.kind !== 'ok') {
      // A server declaring the current protocol and sending something this
      // contract does not define is a CONTRACT ERROR, not an older server, and
      // not an empty board. Keep the last valid content and say so.
      this.feedUnreadable.set(true);
      return store();
    }
    this.feedUnreadable.set(false);

    // IS THIS THE NEWEST READ THIS STORE HAS SEEN? That decides MEMBERSHIP, which
    // is a per-store question.
    const isNewestRead = seq >= this.feedSeq[which];
    if (isNewestRead) this.feedSeq[which] = seq;

    // THE DECLARATION IS ORDERED GLOBALLY, across both feeds, because it is a
    // claim about the SERVER rather than about either set. A delayed older
    // answer must not flip a commandable board read-only — nor, which the
    // per-store fence allowed, re-enable one a newer answer disabled.
    // (`feedUnreadable` is deliberately NOT gated either way: an unreadable
    // answer really did arrive, whenever it was asked for.)
    if (seq >= this.protocolSeq) {
      this.protocolSeq = seq;
      this.serverProtocol.set(verdict.protocol);
    }

    const merged = this.mergeFeed(store(), verdict.tickets, seq, which, isNewestRead);
    store.set(merged);
    this.reconcileOperationsAgainstFeed(merged);
    // THE STORES ARE FINAL HERE, and only here — after the merge is installed
    // and after operations have settled against it. A sweep any earlier judges
    // liveness from a board that does not yet include what this read admitted.
    this.evictKnown();
    return merged;
  }

  /**
   * Fold one feed into a store under the single freshness rule.
   *
   * MEMBERSHIP AND FIELDS ARE SEPARATE QUESTIONS, and conflating them is what
   * made a delayed read so destructive:
   *
   *   * FIELDS — a row the feed carries is applied only if this read is newer
   *     than the last write to that ticket. Otherwise the ticket we hold was
   *     set by something this read could not have seen, and the feed's copy is
   *     simply out of date.
   *
   *   * MEMBERSHIP — a ticket we hold that the feed omits is dropped only if
   *     this read is newer than that ticket's write. A read taken before a
   *     recall cannot retire the recalled ticket, and an EMPTY read taken
   *     before a command cannot empty the board. A genuinely later read still
   *     removes what it omits, so the board does not grow without bound.
   *
   *   * TOMBSTONES — an id a command removed is not re-added by a read older
   *     than the removal.
   */
  private mergeFeed(
    current: KitchenTicket[], incoming: KitchenTicket[], seq: number,
    which: 'active' | 'completed', isNewestRead: boolean,
  ): KitchenTicket[] {
    const byId = new Map(current.map(t => [t.id, t]));
    const incomingIds = new Set(incoming.map(t => t.id));
    const out: KitchenTicket[] = [];

    for (const fresh of incoming) {
      const stamp = this.stampOf(fresh.id);
      const tomb = this.tombstones.get(fresh.id) ?? 0;
      if (tomb > seq) continue;                  // removed by a newer write
      if (this.behindKnownRevision(fresh)) {
        // THE SERVER HAS ALREADY MOVED PAST THIS ROW.
        //
        // Local request order is not server observation order: a read that
        // STARTED later can carry a snapshot the server took EARLIER, so the
        // sequence fence below cannot see this at all. Left unchecked it moved
        // a ticket between boards at a superseded revision, and brought a
        // cancelled order back from a snapshot taken before the cancel.
        //
        // Skipping is total — fields, membership AND relocation. The row is not
        // evidence about this order, so it may not be used to do anything to it.
        const held = byId.get(fresh.id);
        if (held) out.push(held);
        continue;
      }
      if (stamp > seq) {
        // THIS READ PREDATES THE LAST WRITE TO THIS TICKET, so it is not
        // evidence about it AT ALL — not about its fields, and not about which
        // board it belongs on. Keeping only the field half was the subtler bug:
        // a serve or a recall MOVES a ticket between the two stores, so the row
        // is absent from the store being merged, `held` is undefined, and the
        // old copy was pushed back in as though it were new. One id then sat on
        // Active and Completed at once, each claiming to be current.
        const held = byId.get(fresh.id);
        if (held) out.push(held);
        continue;
      }
      if (!byId.has(fresh.id) && !isNewestRead) {
        // A read OLDER than the newest one this store has applied may not ADMIT
        // a ticket, because the newer read spoke about the whole set and did not
        // list it. Correcting a ticket already held is still fine — that is a
        // field question, not a membership one.
        continue;
      }
      out.push(fresh);
      this.noteWrite(fresh.id, seq, fresh.fulfilment_revision);
    }

    // Keep anything this read cannot speak for: a ticket written since it began,
    // and — when it is not the newest read — everything, since it is not
    // authoritative about the set.
    for (const held of current) {
      if (incomingIds.has(held.id)) continue;
      const stamp = this.stampOf(held.id);
      if (!isNewestRead || stamp > seq) out.push(held);
    }

    // A read newer than a tombstone has settled the question; stop remembering.
    for (const [id, stamp] of [...this.tombstones]) {
      if (seq > stamp && !incomingIds.has(id)) this.tombstones.delete(id);
    }

    // An id that legitimately moved stores must not linger in the other one —
    // but only THE NEWEST READ may say so. Relocating from a stale read is a
    // membership decision by an answer that is not authoritative about the set,
    // which is the same mistake the two rules above exist to prevent; the next
    // poll settles it either way, so there is nothing to gain by being eager.
    if (isNewestRead) {
      const other = which === 'active' ? this._completed : this._tickets;
      const otherIds = new Set(out.map(t => t.id));
      const otherList = other();
      const pruned = otherList.filter(t => {
        if (!otherIds.has(t.id)) return true;
        const stamp = this.stampOf(t.id);
        return stamp > seq;   // too new for this read to relocate
      });
      if (pruned.length !== otherList.length) other.set(pruned);
    }

    return out;
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
    this.syncScope();
    const ticket = this.find(id);
    if (!ticket || !isLegalAdvance(ticket.fulfilment_status, next)) return false;
    return this.command(
      ticket,
      next === 'served' ? 'serve' : 'advance',
      next === 'served' ? 'Serving' : `Moving to ${next}`,
      next,
    );
  }

  /**
   * Step a ticket back: served → ready (the server enforces the recall window)
   * or ready → preparing. Rejected (returns false) when the client can already
   * see it makes no sense.
   */
  recall(id: string): boolean {
    this.syncScope();
    const ticket = this.find(id);
    if (!ticket || !isRecallEligible(ticket, Date.now())) return false;
    const target = recallTarget(ticket.fulfilment_status);
    if (!target) return false;
    return this.command(
      ticket,
      ticket.fulfilment_status === 'served' ? 'recall' : 'correct',
      ticket.fulfilment_status === 'served' ? 'Recalling' : 'Sending back',
      target,
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
    this.syncScope();
    const ticket = this._completed().find(t => t.id === id);
    if (!ticket || !isRecallEligible(ticket, Date.now())) return false;
    return this.command(ticket, 'recall', 'Recalling', 'ready', 'completed');
  }

  /**
   * Set the priority flag to an EXPLICIT value. The old toggle is gone: it sent
   * the negation of a possibly-stale local snapshot, so a retry undid itself.
   */
  setPriority(id: string, priority: boolean): boolean {
    this.syncScope();
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
    this.syncScope();
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
    target: FulfilmentStatus, from: 'active' | 'completed' = 'active',
  ): boolean {
    return this.issue(
      ticket, `kitchen/orders/${ticket.id}/fulfilment-status/`,
      { action }, label, from, action, target);
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
    action?: KitchenAction, target?: FulfilmentStatus,
  ): boolean {
    // RE-READ THE LIVE CONTEXT BEFORE COMMANDING. The caller resolved the
    // ticket from the store, which may belong to a restaurant the operator has
    // since left; commanding from it would send a precondition captured
    // somewhere else entirely.
    const generation = this.syncScope();
    const live = this.find(ticket.id);
    if (!live) return false;

    if (!this.canCommand()) return false;
    if (!isCommandable(live)) return false;
    const ifRevision = live.fulfilment_revision as number;

    // AN UNANSWERED COMMAND BLOCKS THE NEXT ONE, not merely an in-flight one.
    // `pending` alone was the old test, so a lost reply left the ticket open to
    // a fresh command at a refreshed revision — a different question asked as
    // though it were the same, and the only record of the first one overwritten.
    if (this.isUnresolved(live.id)) return false;

    const command: RetainedCommand = {
      url, body: { ...body, if_revision: ifRevision }, ifRevision,
      action, target, from,
    };
    const owner = this.newOwner(generation);
    this.setOperation({
      orderId: live.id, phase: 'pending', label, ifRevision, command, owner,
      attempts: 0,
    });
    if (USE_MOCK_DATA) {
      this.clearOperation(live.id);
      return true;
    }

    this.send(live.id, command, label, owner);
    return true;
  }

  /** Put one retained command on the wire. Used by the first issue AND by an
   *  explicit retry, so a retry cannot drift from what was originally sent. */
  private send(
    id: string, command: RetainedCommand, label: string, owner: OperationOwner,
  ): void {
    this.api
      .postPatch(command.url, command.body, 'put')
      .pipe(timeout(COMMAND_TIMEOUT_MS))
      .subscribe({
        next: (res: any) => this.resolveSuccess(id, owner, res, command),
        error: (err: any) => this.resolveFailure(id, owner, err, label),
      });
  }

  /** The identity of ONE request: the context it was asked in, and which
   *  question it is. Captured before the request, never afterwards. */
  private newOwner(generation: number): OperationOwner {
    return {
      scopeKey: this.scopeKey ?? '', generation, opId: ++this.requestSeq,
    };
  }

  /** True while the server's answer to a command against this ticket is still
   *  outstanding — in flight, lost, or being checked. */
  private isUnresolved(id: string): boolean {
    const phase = this._operations()[id]?.phase;
    return phase === 'pending' || phase === 'unknown' || phase === 'checking';
  }

  /** An answer may only be applied by the context that asked the question. */
  private ownsAnswer(owner: OperationOwner): boolean {
    this.syncScope();
    return owner.generation === this.scopeGeneration
      && owner.scopeKey === this.scopeKey;
  }

  /**
   * Is this answer the one the OUTSTANDING request is waiting for?
   *
   * Context ownership is necessary and not sufficient: it admits every answer
   * about this board, including one to a question that has since been replaced
   * by a retry or a reconciliation. Only the request whose identity the
   * operation still carries may write to that operation.
   */
  private ownsOperation(id: string, owner: OperationOwner): boolean {
    if (!this.ownsAnswer(owner)) return false;
    return this._operations()[id]?.owner?.opId === owner.opId;
  }

  /**
   * Keep an operation's notice where the operator can see it.
   *
   * A notice renders inside a ticket card, so an operation whose ticket has
   * left BOTH boards — a cancellation, a serve past the Completed window — has
   * nowhere to draw. `detached` moves it to the board-level strip. It is
   * two-way: a recall that brings the ticket back re-homes the notice on its
   * card rather than leaving a duplicate in the strip.
   */
  private syncDetached(id: string): void {
    const op = this._operations()[id];
    if (!op) return;
    const gone = this.storeOf(id) === undefined;
    if (gone === !!op.detached) return;
    this.setOperation({ ...op, detached: gone });
  }

  /**
   * The server applied (or explicitly did not change) the command. Its own
   * projection is the truth — the client never computes the resulting state.
   *
   * IT IS JUDGED AGAINST THE COMMAND THAT PRODUCED IT, and against the one this
   * REQUEST carried rather than whatever the operation map holds on arrival.
   * Correlating the order id alone answered "is this a readable answer about
   * the right ticket", which is not the same question as "could this be the
   * result of what I sent": a body reporting the ticket unchanged at the
   * original revision, or two revisions on, or in a state nobody asked for,
   * cleared the pending badge as a success.
   *
   * A VALID RESULT IS SELF-PROVING, and that is deliberately the opposite of
   * how an OBSERVATION is treated. `readCommandResult` has established that the
   * server wrote this row at this command's precondition, so the command landed
   * even when the board has since learned a HIGHER revision from a poll: the
   * operation is resolved, while `mergeState` independently refuses to paint
   * the older state. An observation carries no such proof — its revision is its
   * only evidence — which is why `settleFromObservation` keeps the question
   * open in exactly that case.
   */
  private resolveSuccess(
    id: string, owner: OperationOwner, res: any, command: RetainedCommand,
  ): void {
    // WRONG BOARD ENTIRELY: this answer is not about anything here.
    if (!this.ownsAnswer(owner)) return;

    const verdict = readCommandResult(res, id, command);
    // A SUPERSEDED REQUEST'S ANSWER MAY NOT WRITE TO THE OPERATION, because
    // somebody is waiting on a different question. Its STATE is still authentic
    // server state about this order, validated against the command that
    // produced it and floored by `mergeState`, so it is not thrown away.
    const owned = this.ownsOperation(id, owner);
    if (verdict.kind !== 'ok') {
      if (owned) this.markUnreadableAnswer(id);
      return;
    }
    if (owned) this.clearOperation(id);
    this.mergeState(id, verdict.state, this.storeOf(id) ?? command.from);
    this.syncDetached(id);
  }

  /** A server that claimed the protocol and then sent something unusable is a
   *  contract error, not an older server — and not a success. The command's
   *  outcome is genuinely unknown, so it keeps its retained command. */
  private markUnreadableAnswer(id: string): void {
    const existing = this._operations()[id];
    this.setOperation({
      ...(existing ?? { orderId: id, label: 'Checking', ifRevision: -1 }),
      orderId: id,
      phase: 'unknown',
      message: 'The kitchen server sent an answer this app could not read. '
             + 'The command may or may not have been applied.',
    });
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
    id: string, owner: OperationOwner, err: any, label: string,
  ): void {
    if (!this.ownsAnswer(owner)) return;
    // A SUPERSEDED REQUEST'S FAILURE MAY NOT WRITE TO THE OPERATION. A lost
    // first attempt returning 409 after the operator has already retried must
    // not overwrite the retry's state with a refusal of a question nobody is
    // waiting for.
    if (!this.ownsOperation(id, owner)) return;
    const existing = this._operations()[id];
    const status = err?.status;

    if (status === 409 || status === 403 || status === 400) {
      const verdict = readConflict(err?.error, id);
      if (verdict.kind === 'ok') {
        // DEFINITIVE: the server refused and said why. The command is answered,
        // so the retained copy goes with it — there is nothing left to recover.
        this.setOperation({
          orderId: id, phase: 'conflict', label,
          ifRevision: existing?.ifRevision ?? -1,
          owner: existing?.owner,
          reason: verdict.reason,
          message: verdict.message,
          state: verdict.state,
        });
        // AN AUTHORISED CONFLICT IS AUTHORITATIVE ABOUT MEMBERSHIP TOO.
        //
        // This used to merge with moves DISABLED, so a 409 saying "cancelled"
        // repainted the card and left it sitting on the active board — false
        // membership used as the mechanism for displaying a refusal. The same
        // policy now covers command success, authorised conflict, feeds and the
        // per-order observation.
        //
        // The store is the ticket's ACTUAL one, never the assumption that every
        // conflict came from Active: a recall conflict answers about a ticket
        // the operator acted on from Completed, and the server saying it is
        // `ready` means it belongs back on the active board.
        if (verdict.state) {
          this.mergeState(id, verdict.state, this.storeOf(id) ?? 'active');
          // The refusal outlives the card it was drawn on: a 409 saying
          // `order_cancelled` removes the ticket from both boards, and the
          // notice has to move to the board strip rather than vanish with it.
          this.syncDetached(id);
        }
        return;
      }
      // A refusal we cannot read is not a refusal we can act on.
      this.markUnreadableAnswer(id);
      return;
    }

    this.setOperation({
      ...(existing ?? { orderId: id, label, ifRevision: -1 }),
      orderId: id, phase: 'unknown', label,
      message: 'We could not confirm this with the kitchen server. '
             + 'It may or may not have been applied — check, or try again.',
    });
  }

  /**
   * Fold the server's projection into the stores by KEY — never by appending.
   *
   * It also moves the ticket between the active and Completed stores when the
   * server says the fulfilment axis moved, so the two cannot disagree about
   * where a ticket lives while the next poll is still pending.
   *
   * THERE IS NO WAY TO OPT OUT OF THAT ANY MORE. The `allowMove` parameter is
   * gone, and with it the one caller that passed `false`: an authorised 409
   * used to repaint the card and leave the ticket where it was, so a refusal
   * reading `order_cancelled` displayed a cancelled order sitting on the active
   * board — false membership used as the mechanism for showing a message. A
   * server statement about an order is authoritative about WHERE it belongs or
   * it is not authoritative at all.
   */
  private mergeState(
    id: string, state: KitchenOrderState, from: 'active' | 'completed',
  ): boolean {
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
    // THE FLOOR COMES FROM WHAT WE KNOW, NOT FROM WHAT IS ON SCREEN. Reading it
    // off `find(id)` lost it precisely when it still mattered: a cancelled order
    // is in neither store, so every projection about it — however old — was
    // accepted as current.
    const known = this.revisionOf(id);
    if (known >= 0
        && typeof state.fulfilment_revision === 'number'
        && state.fulfilment_revision < known) {
      // REPORTED, not merely skipped. A caller that goes on to draw a
      // CONCLUSION from this projection needs to know the board refused it —
      // see `settleFromObservation`.
      return false;
    }
    // This write takes a stamp on the ONE clock reads are ordered by, so a read
    // that started before it cannot undo it — in its fields OR its membership.
    const stamp = this.nextStamp();
    this.noteWrite(id, stamp, state.fulfilment_revision);

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
    if (existing) {
      const moved = patch(existing);
      const leavesTheBoard = moved.fulfilment_status === 'served'
        || moved.order_status === 'cancelled';
      if (leavesTheBoard) {
        this._tickets.update(list => list.filter(t => t.id !== id));
        if (moved.fulfilment_status === 'served'
            && moved.order_status !== 'cancelled') {
          this._completed.update(list =>
            list.some(t => t.id === id) ? list : [...list, moved]);
        } else {
          // Gone from both boards: remember that, so a read taken before this
          // does not put it back.
          this.rememberTombstone(id, stamp);
        }
      } else if (from === 'completed') {
        this._completed.update(list => list.filter(t => t.id !== id));
        this._tickets.update(list =>
          list.some(t => t.id === id) ? list : [...list, moved]);
      }
    }
    // Final here too — including the tombstone, which is itself protection.
    this.evictKnown();
    return true;
  }

  // ── Reconciling an uncertain command (K2) ─────────────────────────────

  /**
   * Every operation whose outcome is still open, including ones whose ticket
   * has left both feeds.
   *
   * THE DETACHED CASE IS THE POINT. The notice renders inside a ticket card, so
   * a lost CANCELLATION — which removes the order from both feeds — took its
   * own warning off the screen. The board renders this list separately.
   *
   * A SETTLED REFUSAL IS INCLUDED, because it has exactly the same problem: a
   * 409 reading `order_cancelled` is authoritative about membership, so acting
   * on it removes the ticket, and the message explaining the removal used to go
   * with the card. It arrives here already answered, so the strip offers it
   * dismissal rather than recovery. Only the DETACHED ones are drawn there —
   * a notice whose ticket is still on a board stays on that card.
   */
  readonly unresolvedOperations = computed<TicketOperation[]>(() =>
    Object.values(this._operations())
      .filter(op => op.phase === 'unknown' || op.phase === 'checking'
                 || op.phase === 'resolved' || op.phase === 'conflict'));

  /** The sentence shown for a reconciled operation, or undefined. */
  resolvedNoticeFor(id: string): string | undefined {
    const op = this._operations()[id];
    return op?.phase === 'resolved' ? op.message : undefined;
  }

  /**
   * Ask the server what this order is NOW.
   *
   * This is the one surface the feeds cannot replace: a cancelled order is in
   * neither of them, so "it is not on the board" is not an answer about whether
   * the cancellation ran. The read is authorised exactly as the feeds are and
   * returns the same projection.
   *
   * IT ESTABLISHES CURRENT STATE, NOT HISTORY. Nothing here concludes that the
   * earlier command caused what it finds.
   */
  reconcile(id: string): boolean {
    const generation = this.syncScope();
    const op = this._operations()[id];
    // SINGLE-FLIGHT, ENFORCED HERE RATHER THAN HOPED FOR. `checking` used to be
    // an accepted entry state, so a second tap fired a second read against the
    // same order and whichever answered last wrote the outcome. One question at
    // a time per order: a check in flight is refused, and its own timeout
    // returns the operation to `unknown` so recovery is never stuck.
    if (!op || op.phase !== 'unknown') return false;
    if ((op.attempts ?? 0) >= MAX_RECONCILE_ATTEMPTS) return false;
    if (op.owner && op.owner.scopeKey !== this.scopeKey) return false;

    const owner = this.newOwner(generation);
    this.setOperation({
      ...op, phase: 'checking', owner, attempts: (op.attempts ?? 0) + 1,
    });

    this.api
      .get<KitchenTicket>(null, `kitchen/orders/${id}/state/`)
      .pipe(timeout(COMMAND_TIMEOUT_MS))
      .subscribe({
        next: (res: any) => this.settleFromObservation(id, owner, res),
        error: () => this.leaveUnresolved(id, owner),
      });
    return true;
  }

  /**
   * Re-send the retained command, byte for byte, under its ORIGINAL
   * precondition. This is a replay of the same question, not a new decision —
   * refreshing the revision here is exactly what the token exists to prevent.
   */
  retry(id: string): boolean {
    const generation = this.syncScope();
    const op = this._operations()[id];
    if (!op || !op.command) return false;
    // SINGLE-FLIGHT: a check in flight owns the question until it answers.
    if (op.phase !== 'unknown') return false;
    if (op.owner && op.owner.scopeKey !== this.scopeKey) return false;

    // EVERY MUTATION ENTRY GOES THROUGH THE SAME GATE, replay included.
    //
    // This one did not. `issue()` refuses to command a server that has not
    // declared the protocol — it would not enforce the precondition — but a
    // retry walked straight past that check, so a board that had gone
    // read-only after a rollback could still put a command on the wire through
    // the Try again button. The command is KEPT, not discarded: support may
    // come back, and the retained copy is the only record of what was asked.
    if (!this.canCommand()) return false;
    // The precondition is the retained one and is NEVER refreshed, so it is
    // what has to be usable. A live row is checked too where there is one —
    // there is not always: the case a retry exists for is a cancellation, which
    // takes the ticket off both boards.
    if (!Number.isInteger(op.ifRevision) || op.ifRevision < 0) return false;
    const live = this.find(id);
    if (live && !isCommandable(live)) return false;

    const owner = this.newOwner(generation);
    this.setOperation({ ...op, phase: 'pending', owner });
    this.send(id, op.command, op.label, owner);
    return true;
  }

  private settleFromObservation(id: string, owner: OperationOwner, res: any): void {
    // AN OBSERVATION CARRIES NO PROOF OF ITS OWN. Unlike a mutation result it
    // cannot show that any particular command ran — its revision is its only
    // evidence — so it is worth something ONLY to the question that asked for
    // it. A superseded read is discarded outright; the next poll re-reads the
    // same state a moment later anyway.
    if (!this.ownsOperation(id, owner)) return;
    const verdict = readObservedState(res, id);
    if (verdict.kind !== 'ok') { this.leaveUnresolved(id, owner); return; }

    const op = this._operations()[id];
    if (!op) return;

    // AN ANSWER THE BOARD DISCARDED CANNOT CLOSE THE QUESTION. `mergeState`
    // refuses a projection older than the stored ticket — the revision only ever
    // increases — and settling from that same projection afterwards was the
    // defect this whole change is about, reappearing on the path added to fix
    // it: a poll landing first with revision 7 left this read's revision 6 both
    // rejected as state AND accepted as evidence, so it could clear an
    // uncertainty or display a resolution contradicting the visible board.
    // The question stays open; the next ordinary read settles it from state the
    // board actually holds.
    const applied = this.mergeState(
      id, verdict.state, this.storeOf(id) ?? op.command?.from ?? 'active');
    if (!applied) {
      this.setOperation({
        ...this._operations()[id]!, phase: 'unknown',
        message: 'This ticket changed while we were checking. '
               + 'We still could not confirm your command.',
      });
      return;
    }
    this.settleAgainst(id, verdict.state);
    // The observation is authoritative about membership too — a recall seen as
    // `ready` puts the ticket back on the active board, a cancellation takes it
    // off both — so the notice follows the ticket.
    this.syncDetached(id);
  }

  /**
   * Decide what an authoritative observation says about one open command.
   *
   * The ONLY inference drawn is from the revision, and it is drawn in ONE
   * direction. A revision beyond the precondition means SOME command has been
   * applied, not necessarily this one — so the state is reported and the
   * operation cleared only when it is what was asked for.
   *
   * A REVISION AT OR BELOW THE PRECONDITION PROVES NOTHING, and saying
   * otherwise was a false statement dressed as a verdict. This read takes no
   * lock and opens no transaction: it reports whatever was committed at the
   * instant it ran. The command may have been received and be waiting behind
   * the very row lock the transition takes, or be mid-transaction and not yet
   * visible, or have been lost before it arrived. Those are different
   * situations with different remedies and this observation cannot separate
   * them, so the operator is told what is TRUE — nothing has changed yet, and
   * we could not confirm the command — and the question stays open.
   */
  private settleAgainst(id: string, state: KitchenOrderState): void {
    const op = this._operations()[id];
    if (!op) return;

    if (state.fulfilment_revision <= op.ifRevision) {
      // NOT "it did not reach the server". See the note above: an unlocked read
      // showing no change is equally consistent with a command still waiting to
      // be applied, and telling an operator to re-send on that basis invites a
      // second command they were never told might be redundant.
      this.setOperation({
        ...op, phase: 'unknown',
        message: 'No change is visible yet, so we could not confirm this '
               + 'command. It may still be in progress — check again, or try '
               + 'again.',
      });
      return;
    }

    if (this.matchesRequest(op, state)) {
      this.clearOperation(id);
      return;
    }

    this.setOperation({
      ...op, phase: 'resolved', state,
      message: this.describeState(state),
    });
  }

  /**
   * Did the order end up in the state THIS command asked for?
   *
   * A FULFILMENT COMMAND IS SETTLED BY ITS OWN TARGET, never by "some forward
   * state". The action alone does not identify one — `advance` from `new`
   * targets `preparing` and from `preparing` targets `ready` — so accepting
   * either let a ticket still sitting in `preparing` match an advance TO
   * `ready`. Another device bumping the revision with an unrelated priority
   * change was then enough to clear the operation, and the board reported a
   * command that never landed as having succeeded. The revision moving is
   * evidence that SOME command applied; it was never evidence that this one did.
   *
   * A command with no recorded target matches nothing, which is the safe
   * direction: the operator is told what the order is rather than that their
   * command worked.
   */
  private matchesRequest(op: TicketOperation, state: KitchenOrderState): boolean {
    // ONE RULE, SHARED WITH THE RESULT VALIDATOR. It used to be a second copy
    // here, and a second copy of "did this end up as asked" is exactly the
    // thing that drifts: the mutation path and the reconciliation path would
    // then disagree about one command, and which answer an operator saw would
    // depend on how their answer happened to arrive.
    return op.command ? stateSatisfies(op.command, state) : false;
  }

  /**
   * Say what the order IS. Deliberately never "your cancellation went through":
   * the server tells us the current state, and attributing it to this command
   * would be inventing a causal claim the observation does not carry.
   */
  private describeState(state: KitchenOrderState): string {
    if (state.order_status === 'cancelled') {
      return 'This order is now cancelled.';
    }
    switch (state.fulfilment_status) {
      case 'served':    return 'This order is now marked served.';
      case 'ready':     return 'This order is now ready.';
      case 'preparing': return 'This order is now in preparation.';
      default:          return 'This order is now waiting to be started.';
    }
  }

  /** A read that did not answer proves nothing — keep the uncertainty. It is
   *  still only the OUTSTANDING request's to say so: a timed-out check must not
   *  push a retry that replaced it back into `unknown`. */
  private leaveUnresolved(id: string, owner: OperationOwner): void {
    if (!this.ownsOperation(id, owner)) return;
    const op = this._operations()[id];
    if (!op) return;
    this.setOperation({
      ...op, phase: 'unknown',
      message: 'We still could not confirm this with the kitchen server. '
             + 'It may or may not have been applied.',
    });
  }

  /**
   * Let an ordinary feed settle what it can.
   *
   * A read is evidence when it shows the revision has moved past the command's
   * precondition; it is NOT evidence when the row is unchanged, because an
   * unchanged row is equally consistent with a command that never arrived and
   * one the server is still applying. A ticket that has left the feed is marked
   * DETACHED so its warning keeps a home.
   */
  private reconcileOperationsAgainstFeed(tickets: KitchenTicket[]): void {
    const ops = this._operations();
    const present = new Map(tickets.map(t => [t.id, t]));
    for (const op of Object.values(ops)) {
      const seen = present.get(op.orderId);
      if (op.phase === 'unknown' && seen
          && isCommandable(seen)
          && (seen.fulfilment_revision as number) > op.ifRevision) {
        this.settleAgainst(op.orderId, {
          id: seen.id,
          fulfilment_revision: seen.fulfilment_revision as number,
          order_status: seen.order_status ?? 'pending',
          fulfilment_status: seen.fulfilment_status,
          priority: seen.priority,
          served_at: seen.served_at,
          cancelled_at: null,
          cancellation_reason: null,
        });
      }
      // Where the notice draws is asked of EVERY operation, not only the
      // unknown ones — a settled refusal on a ticket the same refusal removed
      // needs the strip just as much — and it is asked of the board rather than
      // of this one feed, so a ticket present in the other store is not called
      // detached. `which` is therefore no longer read here.
      this.syncDetached(op.orderId);
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
