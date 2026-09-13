import { Injectable, computed, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, timeout } from 'rxjs/operators';

import { ApiService } from './api.service';
import { DinerSessionService } from './diner-session.service';
import { SessionStorageService } from './storage/session-storage.service';
import {
  CHECKOUT_PROTOCOL_CORRELATED, CheckoutCorrelation, acceptanceVerdict,
  correlationPromised, protocolLevel, readCorrelation,
} from 'src/app/_shared/order/checkout-correlation';

/**
 * D04 — ONE owner of the in-progress checkout, shared by every surface that
 * can start one.
 *
 * D04/D established three things this keeps: the intent key is PERSISTED
 * BEFORE the request is sent, there is a SINGLE FLIGHT across the two mounted
 * instances of the basket, and a lost response is RESOLVABLE through the
 * diner's own scoped read. What it did not establish is that any of it
 * actually held under the conditions it was built for.
 *
 * FOUR GAPS THIS CLOSES.
 *
 * 1. THE DURABLE WRITE WAS NOT CHECKED. `write()` swallowed every storage
 *    failure and `intentKey()` returned the key regardless, with a comment
 *    saying the result was "a WEAKER guarantee, not a failure". It was not
 *    weaker, it was ABSENT: the next call read nothing back, minted a second
 *    key and sent it — so a storage that refuses writes produced exactly the
 *    duplicate the key exists to prevent, silently. Persistence is now
 *    CHECKED BY READ-BACK (a store that accepts a write and returns nothing
 *    is the case a try/catch cannot see) and a failed required write means
 *    THE MUTATION IS NOT SENT.
 *
 * 2. A NOT-FOUND RETIRED THE INTENT. `absent` cleared the key, so one
 *    momentary observation discarded the identity of a checkout whose outcome
 *    was still open. NOT FOUND IS NOT PROOF OF NON-EXECUTION, and even where
 *    it is proof — a supported server, a proven scope, no matching row — what
 *    it licenses is a SAME-KEY, SAME-REQUEST replay, never a different key.
 *    Nothing here retires an unresolved intent any more.
 *
 * 3. THE ISSUED COMMAND WAS NOT PROTECTED. `intentKey()` overwrote the
 *    record whenever the basket or table changed, with no regard for whether
 *    an acceptance had already been sent — so editing the basket during an
 *    uncertain submit destroyed the only record of what was being recovered.
 *    A record carrying an issued command is now immutable to that path.
 *
 * 4. NOTHING VALIDATED THAT AN ANSWER WAS ABOUT THIS COMMAND. The server now
 *    publishes a correlated projection (`checkout_protocol` 3); this client
 *    READS AND VALIDATES it — key, order and scope — before believing an
 *    outcome, and gates on the level rather than assuming it.
 *
 * WHAT THIS DOES NOT PROMISE. Not exactly-once delivery: a response can still
 * be lost, and the whole design is about making the RETRY safe rather than
 * making loss impossible. Not payment idempotency — nothing here touches
 * money. And it does not decide what a checkout MEANS: the basket, the quote
 * and every refusal stay where they are.
 */

/** The persisted record's format. An explicit integer so a build can tell a
 *  shape it understands from one it does not, rather than guessing from which
 *  keys happen to be present. */
export const CHECKOUT_RECORD_VERSION = 2;

/**
 * WHERE A CHECKOUT HAS GOT TO. Small and explicit — this is a description of
 * one checkout, not a state-machine framework.
 *
 *  pricing     the initiate request is out; no order exists yet as far as
 *              this client knows.
 *  reviewing   the server priced a draft and the diner is looking at it.
 *  accepting   THE ACCEPTANCE COMMAND HAS BEEN ISSUED. From here the outcome
 *              is uncertain until a correlated answer arrives, and the record
 *              must survive anything the diner does to the basket.
 *  unresolved  an acceptance was issued and its outcome could not be
 *              established. The command stands; recovery is the only exit.
 *  accepted    terminal, and recorded BEFORE any cleanup, so a process that
 *              dies mid-teardown resumes announcing a completed order rather
 *              than re-enquiring about one.
 *  refused     terminal the other way: the server definitively refused, so
 *              nothing was accepted.
 */
export type CheckoutStage =
  | 'pricing' | 'reviewing' | 'accepting'
  | 'unresolved' | 'accepted' | 'refused';

/** The exact command that was issued, captured BEFORE it was sent. Replaying
 *  a lost acceptance means re-sending THIS, never rebuilding one from the
 *  basket as it stands now. */
export interface IssuedCommand {
  readonly orderId: string;
  readonly quoteRef: string | null;
}

/**
 * The purchase the key is bound to.
 *
 * `canon` names the rule that produced `identity`, so a future change to how
 * a basket is canonicalised is DETECTABLE rather than silently reinterpreted:
 * a record written under one rule cannot be compared against an identity
 * produced by another, and a mismatch is treated as a different purchase.
 */
export interface PurchaseRequest {
  readonly identity: string;
  readonly canon: string;
  /**
   * GATE B — THE VALIDATED INITIATION LINES, STORED VERBATIM.
   *
   * A replay must re-send what was ISSUED. Before this the record carried
   * identity and canon only, so `retryOrder` fell through to `placeOrder`,
   * which rebuilds the body from the LIVE basket — a retry after a lost
   * initiate therefore asked a different question from the one whose answer
   * was lost, and any edit in between silently changed what was retried.
   *
   * It is the request body's `items` array exactly as it was validated and
   * sent, not a reconstruction: nothing here is derived from priced rows or
   * from the basket as it stands. Bounded by the D01 request ceilings
   * (<= 100 lines), and carries only item/modifier/extra identifiers and
   * quantities — no amounts, no credentials.
   */
  readonly items?: readonly unknown[] | null;
}

/** The current canonicalisation rule — `BasketService.contentIdentity`, which
 *  is built from the id-only, order-independent `lineIdentity`. */
export const PURCHASE_CANON = 'contentIdentity/lineIdentity-v1';

/**
 * A basket identity or scope that can never MATCH anything.
 *
 * Used when a stored record's own field is unreadable: a key nobody can tie
 * to this basket is not this basket's, so it must not be adopted — but the
 * record is still REPORTED rather than discarded, because an issued command
 * on it is still recoverable. No real identity can equal it.
 */
const UNMATCHABLE = '\u0000';

/** A correlated terminal result, written durably before any cleanup. */
export interface TerminalOutcome {
  readonly kind: 'accepted';
  readonly orderId: string;
  readonly orderNumber: string | null;
  /** The ORIGINAL reference the server says the acceptance was bound to. */
  readonly quoteRef: string | null;
  readonly acceptedAt: string | null;
  readonly at: number;
}

/**
 * What a persisted checkout records. Deliberately bounded: identifiers, a
 * stage and what the command was — never basket contents, never an amount,
 * and NEVER a session token, QR credential or JWT. It lives in sessionStorage,
 * readable by any script on the origin, so it carries nothing that is not
 * already an opaque handle the server scopes on its own.
 */
/**
 * R2 — what ONE checkout operation is, captured immutably at the moment a
 * request is issued. See `ownerOf`.
 */
export interface CheckoutOwner {
  readonly key: string;
  readonly scope: string;
  /** The basket CONTENT identity this operation is buying. Durable. */
  readonly purchase: string;
  /** The order the issued acceptance named, when one was issued. */
  readonly orderId: string | null;
}

export interface CheckoutRecord {
  readonly v: number;
  readonly key: string;
  /** `restaurant:table` — the scope the checkout was made in. Compared against
   *  the scope the SERVER resolves, which is what makes an answer verifiable. */
  readonly scope: string;
  readonly request: PurchaseRequest;
  readonly stage: CheckoutStage;
  readonly command: IssuedCommand | null;
  readonly outcome: TerminalOutcome | null;
  readonly startedAt: number;
  /**
   * GATE A — THE HIGHEST PROTOCOL LEVEL THIS SERVER HAS STATED FOR THIS
   * ATTEMPT. Monotonic and remembered, because a capability once
   * demonstrated does not un-demonstrate itself: a submit reply carrying no
   * projection from a server that advertised level 3 on the initiate is
   * BROKEN, not an older server, and falling back to the legacy reading
   * there announces an order having validated nothing.
   */
  readonly protocol: number;
  /**
   * GATE C — SOMETHING IN THIS RECORD WAS PRESENT BUT UNREADABLE.
   *
   * Distinct from a field that is simply absent. A `command` key holding a
   * malformed object means an acceptance MAY have been issued and its
   * handle did not survive; nulling it silently turns that into "no command
   * was ever issued", which is the inference the not-found rule forbids.
   */
  readonly degraded: boolean;
}

/**
 * WHAT IS IN STORAGE, as five distinguishable facts.
 *
 * Collapsing any of these into "no record" is how an unresolved checkout gets
 * retired by accident: a store that throws is not an empty store, and a
 * record this build cannot parse is not the absence of one.
 */
export type StoredCheckout =
  /** Nothing persisted. The ordinary case on any normal page load. */
  | { readonly kind: 'none' }
  /** Storage could not be read at all (it threw). Transient and retryable. */
  | { readonly kind: 'unreadable' }
  /** Something is under our key that this build cannot parse. */
  | { readonly kind: 'malformed' }
  /** A record written by a build with a NEWER format — another tab, mid
   *  deploy. Its contents are not ours to interpret. */
  | { readonly kind: 'unsupported'; readonly version: unknown }
  | { readonly kind: 'record'; readonly record: CheckoutRecord };

/** The answer to "may I start (or continue) a checkout, and under which key?" */
export type IntentReservation =
  /** Persisted and verified. This key may be sent. */
  | { readonly kind: 'ready'; readonly key: string;
      readonly record: CheckoutRecord }
  /** AN ACCEPTANCE IS ALREADY OUTSTANDING. Not an error — the diner has a
   *  checkout whose outcome is unsettled, and the only correct next step is
   *  to resolve THAT, never to start another. */
  | { readonly kind: 'outstanding'; readonly record: CheckoutRecord }
  /** The durable write did not succeed, so no mutation may be sent. */
  | { readonly kind: 'storage-error' }
  /** Storage holds something this build must not act around. */
  | { readonly kind: 'blocked'; readonly stored: StoredCheckout };

/**
 * What resolving a persisted key found. A DISCRIMINATED UNION rather than a
 * nullable order plus a flag: every caller is then forced to say what it does
 * about a server that could not be reached, or one whose answer it cannot
 * interpret — precisely the cases a boolean invites skipping.
 */
export type RecoveryOutcome =
  /** Nothing was in flight. */
  | { readonly kind: 'none' }
  /** The local record is unusable, so there is nothing to resolve it BY. */
  | { readonly kind: 'blocked'; readonly stored: StoredCheckout }
  /** DEFINITIVE: the order was accepted, and the answer names this command. */
  | { readonly kind: 'accepted'; readonly order: any;
      readonly correlation: CheckoutCorrelation | null }
  /** The order was accepted but the server holds no record of when or against
   *  which quote — an acceptance that predates its evidence table. TREAT AS
   *  ACCEPTED: it must never be accepted a second time. */
  | { readonly kind: 'accepted-unrecorded'; readonly order: any;
      readonly correlation: CheckoutCorrelation }
  /** The key resolved to a draft the server has NOT accepted. */
  | { readonly kind: 'draft'; readonly order: any;
      readonly correlation: CheckoutCorrelation | null }
  /** THE SERVER ANSWERED AND HAS NO ROW FOR THIS KEY, at a scope it resolved
   *  itself. It licenses a SAME-KEY, SAME-REQUEST replay — never a new key,
   *  and never discarding the record. */
  | { readonly kind: 'absent' }
  /** An answer arrived that is not about the command we issued. */
  | { readonly kind: 'uncorrelated'; readonly order: any }
  /** The server cannot express the distinction this client needs. */
  | { readonly kind: 'unsupported'; readonly protocol: number }
  /** The table session was refused, so the scope could not be proven. */
  | { readonly kind: 'unauthorized' }
  /** THE SERVER COULD NOT BE ASKED. Explicitly NOT `absent`: an unreachable
   *  server is not evidence that nothing happened, and treating it as such is
   *  how a recovery mechanism creates the duplicate it exists to prevent. */
  | { readonly kind: 'unknown' };

/** A claim on the single flight. Held by the caller and handed back to release
 *  it, so a release cannot be attributed to the wrong attempt. */
export interface FlightToken {
  readonly id: number;
}

@Injectable({ providedIn: 'root' })
export class CheckoutCoordinatorService {
  /** sessionStorage, not localStorage: a checkout belongs to the tab and the
   *  table session that started it. A key surviving into a different tab
   *  would offer one diner another's attempt. */
  static readonly ATTEMPT_KEY = 'diner.checkout.attempt';

  /**
   * THE CEILING ON AN UNRESOLVED REQUEST. Without one, a connection that is
   * open but dead leaves the CTA spinning for as long as the browser keeps the
   * socket — indefinitely, on a mobile network that has silently gone away —
   * and the diner's only escape is a reload.
   *
   * Generous on purpose: a slow checkout that eventually succeeds is a far
   * better outcome than one abandoned early, and a timeout NEVER re-mints the
   * key, so timing out and retrying is safe rather than duplicative.
   */
  static readonly REQUEST_TIMEOUT_MS = 30_000;

  private readonly _flight = signal<FlightToken | null>(null);
  private nextFlightId = 1;

  /** True while any surface holds the flight. Both component instances read
   *  this, so they cannot disagree about whether a checkout is running. */
  readonly inFlight = computed(() => this._flight() !== null);

  constructor(
    private readonly api: ApiService,
    private readonly storage: SessionStorageService,
    private readonly dinerSession: DinerSessionService,
  ) {}

  // -- the persisted record ----------------------------------------------

  /**
   * Read what is in storage, as one of five distinguishable facts.
   *
   * IT NEVER REPAIRS AND NEVER DELETES. A record it cannot use is REPORTED,
   * so the caller decides — silently dropping one is how the identity of an
   * unresolved checkout disappears.
   */
  read(): StoredCheckout {
    let raw: unknown;
    try {
      raw = this.storage.getItem(CheckoutCoordinatorService.ATTEMPT_KEY);
    } catch {
      return { kind: 'unreadable' };
    }
    if (raw === null || raw === undefined) return { kind: 'none' };
    if (typeof raw !== 'object') return { kind: 'malformed' };

    const value = raw as Record<string, unknown>;
    const version = value['v'];

    if (version === undefined) {
      // A D04/D (#663) record: `{key, phase, orderId, quoteRef, basket,
      // context, startedAt}`. UPGRADED, NOT DISCARDED — a diner mid-checkout
      // across a deploy must keep their key, which is the one thing the key
      // exists to guarantee. Nothing is manufactured: the request identity
      // and the command come from the old record's own fields, and where the
      // old shape said nothing the new one says nothing either.
      const upgraded = this.upgradeV1(value);
      return upgraded
        ? { kind: 'record', record: upgraded }
        : { kind: 'malformed' };
    }
    if (version !== CHECKOUT_RECORD_VERSION) {
      return { kind: 'unsupported', version };
    }

    const record = this.parseV2(value);
    return record ? { kind: 'record', record } : { kind: 'malformed' };
  }

  /** The record if there is a usable one, else null. A convenience over
   *  `read()` for callers that have already decided what to do about the
   *  other four states. */
  record(): CheckoutRecord | null {
    const stored = this.read();
    return stored.kind === 'record' ? stored.record : null;
  }

  /**
   * Reserve the key for this checkout, PERSISTING IT BEFORE RETURNING IT.
   *
   * The order of those two operations is the whole point, and D04/D got the
   * order right while leaving the outcome unchecked. Minting a key and putting
   * it in a request body is a promise to treat the retry as the same attempt,
   * and a promise that was never written down is not one.
   *
   * A RECORD CARRYING AN ISSUED COMMAND IS NEVER OVERWRITTEN HERE. That is
   * gap 3: the previous version replaced the record whenever the basket or
   * the table changed, so a diner editing their basket during an uncertain
   * submit destroyed the record of what was being recovered. An outstanding
   * acceptance is REPORTED instead, and resolving it is the only way past.
   */
  reserveIntent(request: PurchaseRequest, scope: string): IntentReservation {
    const stored = this.read();
    if (stored.kind === 'unreadable') return { kind: 'storage-error' };
    if (stored.kind === 'malformed' || stored.kind === 'unsupported') {
      return { kind: 'blocked', stored };
    }

    if (stored.kind === 'record') {
      const existing = stored.record;
      if (this.sameCommand(existing, request, scope)
          && !this.isProtected(existing, request)) {
        return { kind: 'ready', key: existing.key, record: existing };
      }
      if (this.isProtected(existing, request)) {
        return { kind: 'outstanding', record: existing };
      }
    }

    // A different purchase, a different table, or nothing at all. A fresh key
    // is DERIVED from the change rather than pushed by somebody remembering
    // to reset one — and this branch is reachable only when no acceptance is
    // outstanding, so no issued command can be lost by it.
    const record: CheckoutRecord = {
      v: CHECKOUT_RECORD_VERSION,
      key: this.mintKey(),
      scope,
      request,
      stage: 'pricing',
      command: null,
      outcome: null,
      startedAt: Date.now(),
      protocol: 0,
      degraded: false,
    };
    return this.persist(record)
      ? { kind: 'ready', key: record.key, record }
      : { kind: 'storage-error' };
  }

  /**
   * Is an acceptance outstanding — i.e. MAY a command have been issued whose
   * outcome is not settled?
   *
   * GATE C — THE TEST IS THE STAGE, NOT WHETHER THE HANDLE SURVIVED. It used
   * to require `command !== null`, and that is what lost the protection in
   * the one case it was written for: `upgradeV1` turns a D04/D `submitting`
   * record with no usable order id into `unresolved` with a null command —
   * honestly, since nothing may be manufactured — and the record it produced
   * then read as NOT outstanding, so a changed basket replaced it with a
   * fresh key.
   *
   * Protection follows the fact that a command MAY HAVE BEEN ISSUED. Missing
   * handles reduce the ability to RECOVER; they never establish that no
   * operation ran. `accepting` and `unresolved` are both reached only after
   * an acceptance was about to be or had been sent.
   */
  isOutstanding(record: CheckoutRecord): boolean {
    return record.stage === 'accepting' || record.stage === 'unresolved';
  }

  /**
   * Can this record safely be REPLACED by a fresh key for a new purchase?
   *
   * Separate from `isOutstanding` because the reasons differ: an outstanding
   * acceptance must be resolved, while a record this build cannot fully read
   * must not be reasoned about at all. Both refuse a replacement; only the
   * first is recoverable by asking the server.
   */
  private isProtected(record: CheckoutRecord, request: PurchaseRequest):
      boolean {
    if (this.isOutstanding(record)) return true;
    // A terminal claim with no evidence behind it is not a settled checkout.
    if (record.stage === 'accepted' && !record.outcome) return true;
    if (record.degraded) return true;
    // AN IDENTITY PRODUCED BY A RULE THIS BUILD DOES NOT KNOW cannot be
    // compared against one produced by the current rule, so "a different
    // purchase" is not a conclusion available here.
    return record.request.canon !== request.canon;
  }

  /**
   * May this build re-issue the INITIATION recorded here?
   *
   * A POSITIVE CLASSIFICATION, never the absence of a reason to refuse — the
   * first cut asked only whether `request.items` was non-empty, and a record
   * can carry perfectly readable lines and still be one nothing may be issued
   * from: a `degraded` parse, a terminal `accepted` claim with no outcome
   * behind it, or an identity produced by a canonicalisation this build does
   * not know. `reserveIntent` already refuses all three (`isProtected`), so a
   * retry path that bypassed reservation defeated exactly the protection this
   * change added (Codex P2 on PR #665, valid).
   *
   * AN ISSUED COMMAND IS A DIFFERENT CASE and is deliberately excluded: that
   * one is resolved by replaying the COMMAND, never by re-initiating. What is
   * left is the lost-INITIATE case the stored lines exist for — a reserved key
   * at `pricing` or `reviewing` with nothing issued against it.
   */
  isReplayableInitiation(record: CheckoutRecord): boolean {
    if (record.degraded) return false;
    if (record.request.canon !== PURCHASE_CANON) return false;
    if (record.command !== null || record.outcome !== null) return false;
    if (record.stage !== 'pricing' && record.stage !== 'reviewing') {
      return false;
    }
    const items = record.request.items;
    return Array.isArray(items) && items.length > 0;
  }

  /**
   * R2 — THE IMMUTABLE IDENTITY OF ONE CHECKOUT OPERATION.
   *
   * Captured BEFORE a request goes out and compared when its answer lands,
   * so a reply held open across an edit, a table move or a navigation is
   * measured against what it was actually about. Deliberately not a re-read
   * of whatever storage says on arrival: comparing a response against the
   * present is what makes a stale answer look authoritative.
   *
   * WHAT IS IN IT AND WHY. `key` and `scope` identify the attempt; `orderId`
   * is the command that was issued, when one was. `purchase` is the basket
   * CONTENT identity — durable, because it is a property of what the diner is
   * buying and comes back from storage unchanged. The process-local
   * `revision()` is deliberately NOT here: it restarts at 0 on every page
   * load, and using it as durable intent identity is the exact defect
   * Codex found on #663.
   */
  ownerOf(record: CheckoutRecord): CheckoutOwner {
    return {
      key: record.key,
      scope: record.scope,
      purchase: record.request.identity,
      orderId: record.command?.orderId ?? null,
    };
  }

  /**
   * QUESTION ONE: may an authoritative answer still SETTLE this operation?
   *
   * Separate from `ownsPurchase` on purpose. A legitimate acceptance for an
   * earlier purchase must still be recorded and announced even when the cart
   * has moved on — losing it would be as wrong as erasing the cart.
   */
  settles(owner: CheckoutOwner): boolean {
    const now = this.record();
    if (!now) return false;
    if (now.key !== owner.key || now.scope !== owner.scope) return false;
    // A command, once issued, is part of the operation's identity. A record
    // that has since settled or been reissued is a different operation.
    return owner.orderId === null
      || (now.command?.orderId ?? null) === owner.orderId;
  }

  /**
   * QUESTION TWO: does this operation own the cart currently on screen?
   *
   * The ONLY licence to clear it. `key` and `scope` cannot answer this — an
   * edit re-reserves nothing, so both are unchanged while the cart is no
   * longer the purchase that was accepted.
   */
  ownsPurchase(owner: CheckoutOwner, purchase: string): boolean {
    return owner.purchase === purchase;
  }

  /** The highest level any server has stated for the live attempt, or 0. */
  establishedProtocol(): number {
    return this.record()?.protocol ?? 0;
  }

  /**
   * Remember a stated capability level. MONOTONIC — a level once stated is
   * never lowered by a later response that happens to omit it, because that
   * omission is exactly the broken case the memory exists to catch.
   */
  noteProtocol(level: number): boolean {
    const current = this.record();
    if (!current || !Number.isInteger(level) || level <= current.protocol) {
      return false;
    }
    return this.persist({ ...current, protocol: level });
  }

  private sameCommand(
    record: CheckoutRecord, request: PurchaseRequest, scope: string,
  ): boolean {
    return record.scope === scope
      && record.request.canon === request.canon
      && record.request.identity === request.identity;
  }

  /**
   * Move the stage on. Returns whether the write is durable.
   *
   * A no-op when nothing is persisted — this never RESURRECTS an attempt the
   * caller has already finished — and it reports that as a FAILURE, because a
   * caller asking to record progress on a checkout that is not there has lost
   * track of it, and treating that as success hides the fact.
   */
  /**
   * Settle a command the server has DEFINITIVELY refused, keeping the key.
   *
   * The outstanding state exists because an issued acceptance whose outcome
   * is UNKNOWN must be resolved before anything else is sent. A refusal the
   * server stated under its own lock is not unknown: `quote_ref_stale` means
   * it re-read the order and the reference does not match, so THIS command
   * can never be accepted and nothing is left to recover. Holding the
   * reservation open for it dead-ends the diner — the branch that promises a
   * reprice cannot start one, and a retry only re-sends a command that will
   * be refused again.
   *
   * **THE KEY AND THE PURCHASE ARE KEPT; ONLY THE COMMAND IS CLEARED.** The
   * basket has not changed, so this is the same purchase and must reuse its
   * idempotency key — `sameCommand` hands that key straight back on the next
   * `reserveIntent`. That is what separates this from `clearIntent`, which
   * forgets the intent entirely and is reserved for a terminal outcome or a
   * draft the server has refused OUTRIGHT (`reviewUpdatedOrder`, where the
   * draft is LEGACY-priced and a fresh key cannot duplicate anything).
   *
   * THIS IS NOT A WAY AROUND THE NOT-FOUND RULE. It requires a refusal the
   * server actually stated about this exact command; it must never be called
   * on a timeout, a lost response, an unreachable server or any outcome the
   * client merely failed to observe.
   */
  settleRefusedCommand(): boolean {
    const current = this.record();
    if (!current) return false;
    return this.persist({ ...current, stage: 'refused', command: null });
  }

  noteStage(stage: CheckoutStage): boolean {
    const current = this.record();
    if (!current) return false;
    return this.persist({ ...current, stage });
  }

  /**
   * Record the EXACT command about to be issued, before issuing it.
   *
   * This is what makes a lost acceptance replayable: recovery re-sends this
   * order id and this reference, never a command rebuilt from whatever the
   * basket holds by then. A failed write means the acceptance is not sent.
   */
  noteCommand(command: IssuedCommand): boolean {
    const current = this.record();
    if (!current) return false;
    return this.persist({ ...current, stage: 'accepting', command });
  }

  /**
   * Record a correlated terminal result, DURABLY, BEFORE ANY CLEANUP.
   *
   * If the process dies between this and the teardown that follows, a reload
   * reads a completed checkout and says so, instead of re-enquiring about an
   * order that is already in the kitchen.
   */
  recordOutcome(outcome: TerminalOutcome): boolean {
    const current = this.record();
    if (!current) return false;
    return this.persist({ ...current, stage: 'accepted', outcome });
  }

  /**
   * Forget this attempt.
   *
   * TARGETED: it removes ONE key and never clears storage, because the diner
   * session capability and the basket live in the same store and a blanket
   * wipe here would sign the diner out of their own table to tidy up a
   * checkout.
   *
   * CALLED ON A DEFINITIVE OUTCOME ONLY — a completed order whose result has
   * already been recorded, or a draft the server has authoritatively said can
   * never be accepted. NEVER on a timeout, a lost response, an unreachable
   * server or a not-found: those are exactly when the record must survive.
   */
  clearIntent(): void {
    try {
      this.storage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
    } catch {
      /* a storage that refuses to erase is not a reason to fail a checkout */
    }
  }

  // -- the single flight -------------------------------------------------

  /** Claim the flight, or null when another surface already holds it. */
  claimFlight(): FlightToken | null {
    if (this._flight() !== null) return null;
    const token = { id: this.nextFlightId++ };
    this._flight.set(token);
    return token;
  }

  /** Release the flight — only if this token still holds it, so a late
   *  release from a superseded attempt cannot free a live one. */
  releaseFlight(token: FlightToken | null): void {
    if (token && this._flight()?.id === token.id) this._flight.set(null);
  }

  // -- bounded requests --------------------------------------------------

  /** Every checkout round trip goes through this, so none of them can hang
   *  forever. A timeout surfaces as an ordinary error the caller already
   *  handles; it is deliberately NOT a distinct recovery path, because the
   *  correct response to it is the same as to any lost response — retry with
   *  the same key. */
  bounded<T>(source: Observable<T>): Observable<T> {
    return source.pipe(
      timeout(CheckoutCoordinatorService.REQUEST_TIMEOUT_MS),
    );
  }

  // -- recovery ----------------------------------------------------------

  /**
   * Ask the server what the persisted key resolved to, and check the answer
   * is about the command this client issued.
   *
   * It reads the diner's OWN order read (`order-details/?intent=`), which is
   * scoped to the table session — so this can only ever surface an order on
   * the table the diner is sitting at, whatever key happens to be in storage.
   *
   * A FAILURE IS `unknown`, NEVER `absent`. The difference decides whether it
   * is safe to place another order, and an unreachable server is not evidence
   * that nothing happened.
   */
  recover(): Observable<RecoveryOutcome> {
    const stored = this.read();
    if (stored.kind === 'none') return of<RecoveryOutcome>({ kind: 'none' });
    if (stored.kind !== 'record') {
      return of<RecoveryOutcome>({ kind: 'blocked', stored });
    }
    const pending = stored.record;

    return this.bounded(
      this.api.get<any>(
        null, 'orders/journey/order-details/', { intent: pending.key },
      ) as Observable<any>,
    ).pipe(
      map((response: any): RecoveryOutcome =>
        this.classify(response?.data, pending)),
      catchError((error: unknown) =>
        of<RecoveryOutcome>(this.classifyFailure(error))),
    );
  }

  /**
   * Read one order payload as an outcome for THIS record.
   *
   * THE CORRELATED PROJECTION IS PREFERRED AND THE LEVEL IS CHECKED. Where
   * the server publishes one (`checkout_protocol` >= 3) the three-state
   * verdict decides, and the answer must NAME this key, this order (when one
   * was issued) and this scope. Where it does not, the level-2 reading
   * applies — and it is deliberately conservative about the one case level 2
   * cannot express.
   */
  classify(order: any, pending: CheckoutRecord): RecoveryOutcome {
    if (!order) return { kind: 'unknown' };

    const correlation = readCorrelation(order);
    if (correlation) {
      // R1 — THE SAME EVIDENCE DECISION THE SUBMIT GATE MAKES. This asked
      // `correlationMatches` alone — *is this answer ABOUT my command?* — and
      // then switched on `acceptance.state`. Those are different questions: a
      // projection can name this key, this order and this scope and still
      // report an acceptance of a quote the diner never confirmed, or carry
      // no reference and no moment at all. The recovery consumers could
      // therefore complete exactly what `submitVerdict` refuses.
      //
      // `{mutation: false}` IS THE ONE DIFFERENCE, and it is load-bearing
      // rather than a relaxation: a READ is an OBSERVATION, so a null attempt
      // `outcome` is correct here and contradictory on a mutation reply. The
      // expected reference comes from the IMMUTABLE issued command — absent
      // when this client issued none, which is how an authorized read may
      // still surface an acceptance made elsewhere (a copied tab) without
      // requiring a reference to match itself.
      const verdict = acceptanceVerdict(correlation, {
        key: pending.key,
        scope: pending.scope,
        orderId: pending.command?.orderId ?? null,
        quoteRef: pending.command?.quoteRef ?? null,
      }, { mutation: false });
      switch (verdict.kind) {
        case 'accepted':
          return { kind: 'accepted', order, correlation };
        case 'not-accepted':
          return { kind: 'draft', order, correlation };
        case 'indeterminate':
          return { kind: 'accepted-unrecorded', order, correlation };
        default:
          // Wrong command, a reference the diner never agreed to, or
          // evidence that cannot be read. All unresolved, none announced,
          // and the record survives every one of them.
          return { kind: 'uncorrelated', order };
      }
    }

    // A PROMISE IT COULD NOT KEEP IS REFUSED, NEVER DOWNGRADED. Falling back
    // here is correct only for a payload that advertised NO projection — an
    // older server, whose `accepted` boolean is the best it has. A payload
    // that promised one and could not express it is BROKEN, and trusting the
    // legacy boolean beside it would clear the basket having checked no key,
    // no order and no scope: exactly the unvalidated announcement the
    // projection exists to prevent. Same distinction this repo already draws
    // for `quote_total`.
    // R1 — AND THE PROMISE IS REMEMBERED, NOT RE-READ PER RESPONSE.
    // `correlationPromised` reads the PAYLOAD; the record remembers what this
    // server already demonstrated for THIS attempt, and a capability does not
    // un-demonstrate itself. A read carrying no projection from a server whose
    // initiate declared level 3 is BROKEN, not old — and trusting the legacy
    // boolean beside it would announce an order having checked nothing.
    if (correlationPromised(order)
        || pending.protocol >= CHECKOUT_PROTOCOL_CORRELATED) {
      return { kind: 'uncorrelated', order };
    }

    // BELOW LEVEL 3. `accepted: true` is still definitive — the server only
    // sets it from a durable evidence row. `accepted: false` is the ambiguous
    // one: at level 2 a genuine draft and an acceptance that predates the
    // evidence table read identically, and the server's own docstring says so.
    if (order.accepted === true) {
      return { kind: 'accepted', order, correlation: null };
    }
    if (pending.command === null) {
      // THIS CLIENT'S OWN DURABLE RECORD RESOLVES THE AMBIGUITY, without
      // inferring anything from the server: it never issued an acceptance for
      // this key, so there is no acceptance for the server to have lost track
      // of, and the order can only be the draft that initiate created.
      return { kind: 'draft', order, correlation: null };
    }
    // An acceptance WAS issued and this server cannot say whether it landed.
    // Unresolved, and reported as such rather than guessed either way.
    return { kind: 'unsupported', protocol: protocolLevel(order) };
  }

  private classifyFailure(error: unknown): RecoveryOutcome {
    if (this.dinerSession.isCredentialDenied(error)
        || this.dinerSession.isSessionExpired(error)) {
      // THE SCOPE COULD NOT BE PROVEN, so an answer about "no such order on
      // this table" would be an answer about no table at all.
      return { kind: 'unauthorized' };
    }
    return this.isNotFound(error) ? { kind: 'absent' } : { kind: 'unknown' };
  }

  /**
   * Did the server say this key resolves to nothing?
   *
   * A 404 from this read is the ONE answer that means "no such order on this
   * table", and it is non-disclosing by design — a foreign, unknown and
   * malformed key are indistinguishable. Everything else (offline, 5xx, a
   * timeout, the `ErrorInterceptor`'s collapsed string form) is not an answer
   * at all.
   *
   * WHY THAT READS A STATUS AND NOT A MESSAGE. `ErrorInterceptor` collapses
   * an ordinary failure to `err.error.message || err.statusText`, a bare
   * string — so without the narrow carve-out it makes for this exact request,
   * a definitive 404 arrives indistinguishable from a timeout. Matching on the
   * human sentence instead would be the brittleness the reason codes
   * elsewhere in this repo exist to remove. A non-object still falls through
   * to `unknown`, which is the safe direction.
   */
  private isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    return (error as { status?: number }).status === 404;
  }

  // -- parsing and persistence -------------------------------------------

  private parseV2(value: Record<string, unknown>): CheckoutRecord | null {
    const key = value['key'];
    if (typeof key !== 'string' || !key) return null;
    const stage = value['stage'];
    if (!this.isStage(stage)) return null;

    const request = value['request'] as Record<string, unknown> | undefined;
    if (!request || typeof request !== 'object') return null;
    if (typeof request['identity'] !== 'string') return null;
    if (typeof request['canon'] !== 'string') return null;

    const scope = value['scope'];
    if (typeof scope !== 'string') return null;

    // PRESENT-BUT-UNREADABLE IS NOT ABSENT (Gate C). A `command` or `outcome`
    // key that is there and cannot be parsed means a handle did not survive,
    // which is a REDUCED ability to recover — never evidence that no
    // operation ran. Nulling it silently is what let `reserveIntent` treat
    // such a record as an ordinary replaceable one.
    const rawCommand = value['command'];
    const command = this.parseCommand(rawCommand);
    const rawOutcome = value['outcome'];
    const outcome = this.parseOutcome(rawOutcome);
    const degraded =
      (rawCommand !== undefined && rawCommand !== null && command === null)
      || (rawOutcome !== undefined && rawOutcome !== null && outcome === null);

    return {
      v: CHECKOUT_RECORD_VERSION,
      key,
      scope,
      request: {
        identity: request['identity'] as string,
        canon: request['canon'] as string,
        items: Array.isArray(request['items'])
          ? (request['items'] as readonly unknown[]) : null,
      },
      stage,
      command,
      outcome,
      startedAt: typeof value['startedAt'] === 'number'
        ? (value['startedAt'] as number) : 0,
      protocol: typeof value['protocol'] === 'number'
        && Number.isInteger(value['protocol']) && value['protocol'] > 0
        ? (value['protocol'] as number) : 0,
      degraded,
    };
  }

  /**
   * Carry a D04/D record forward.
   *
   * CONSERVATIVE IN BOTH DIRECTIONS. The key, the scope and the basket
   * identity are the old record's own values, so nothing is invented — and
   * the old `basket` field held `contentIdentity` under the same rule, so the
   * canon carries across honestly. A `submitting` record with an order id
   * DID have a command issued and is upgraded as such; one without an order
   * id cannot name a command, so it does not get one, and it lands
   * `unresolved` rather than being called a draft.
   */
  private upgradeV1(value: Record<string, unknown>): CheckoutRecord | null {
    const key = value['key'];
    if (typeof key !== 'string' || !key) return null;
    const phase = value['phase'];
    if (phase !== 'pricing' && phase !== 'reviewing'
        && phase !== 'submitting') {
      return null;
    }
    const orderId = typeof value['orderId'] === 'string'
      ? (value['orderId'] as string) : null;
    const quoteRef = typeof value['quoteRef'] === 'string'
      ? (value['quoteRef'] as string) : null;
    const issued = phase === 'submitting' && orderId
      ? { orderId, quoteRef } : null;

    return {
      v: CHECKOUT_RECORD_VERSION,
      key,
      scope: typeof value['context'] === 'string'
        ? (value['context'] as string) : UNMATCHABLE,
      request: {
        identity: typeof value['basket'] === 'string'
          ? (value['basket'] as string) : UNMATCHABLE,
        canon: PURCHASE_CANON,
      },
      stage: phase === 'submitting'
        ? (issued ? 'accepting' : 'unresolved') : phase,
      command: issued,
      outcome: null,
      startedAt: typeof value['startedAt'] === 'number'
        ? (value['startedAt'] as number) : 0,
      // A D04/D record predates the level memory, so nothing is claimed.
      protocol: 0,
      // A `submitting` record that could not name its order is DEGRADED, not
      // merely commandless: an acceptance may have gone out and the handle
      // did not survive. `isOutstanding` already protects `unresolved`; this
      // says WHY, and keeps it protected if the stage vocabulary ever moves.
      degraded: phase === 'submitting' && !issued,
    };
  }

  private isStage(value: unknown): value is CheckoutStage {
    return value === 'pricing' || value === 'reviewing'
      || value === 'accepting' || value === 'unresolved'
      || value === 'accepted' || value === 'refused';
  }

  private parseCommand(value: unknown): IssuedCommand | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    if (typeof raw['orderId'] !== 'string' || !raw['orderId']) return null;
    return {
      orderId: raw['orderId'] as string,
      quoteRef: typeof raw['quoteRef'] === 'string'
        ? (raw['quoteRef'] as string) : null,
    };
  }

  private parseOutcome(value: unknown): TerminalOutcome | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    if (raw['kind'] !== 'accepted') return null;
    if (typeof raw['orderId'] !== 'string' || !raw['orderId']) return null;
    return {
      kind: 'accepted',
      orderId: raw['orderId'] as string,
      orderNumber: typeof raw['orderNumber'] === 'string'
        ? (raw['orderNumber'] as string) : null,
      quoteRef: typeof raw['quoteRef'] === 'string'
        ? (raw['quoteRef'] as string) : null,
      acceptedAt: typeof raw['acceptedAt'] === 'string'
        ? (raw['acceptedAt'] as string) : null,
      at: typeof raw['at'] === 'number' ? (raw['at'] as number) : 0,
    };
  }

  /**
   * Write the record and PROVE IT LANDED.
   *
   * A try/catch is not enough, and that is the defect this replaces: a store
   * can accept `setItem` and return nothing from `getItem` — a private-mode
   * quota that silently drops, a stubbed or disabled store — and a write that
   * throws nothing is not a write that happened. Reading it back and comparing
   * the key and the stage is the only check that distinguishes the two.
   *
   * The caller must not send a mutation on `false`.
   */
  private persist(record: CheckoutRecord): boolean {
    try {
      this.storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY, record);
    } catch {
      return false;
    }
    const stored = this.read();
    return stored.kind === 'record'
      && this.fingerprint(stored.record) === this.fingerprint(record);
  }

  /**
   * A deterministic digest of everything a caller acts on.
   *
   * GATE C — KEY AND STAGE WERE NOT ENOUGH. `noteCommand` moves a record from
   * `accepting` to `accepting` when a previous attempt already set the stage,
   * and `recordOutcome` writes an outcome onto a record whose key never
   * changes — so a store that accepted `setItem` and kept the PREVIOUS value
   * satisfied both old checks and reported success. The caller then issued an
   * acceptance believing its command was written down.
   *
   * `startedAt` is excluded deliberately (written once, never re-asserted);
   * everything a later recovery reads is included. Bounded by the D01
   * ceilings, and built from data already being serialised to this store.
   */
  private fingerprint(record: CheckoutRecord): string {
    return JSON.stringify([
      record.v, record.key, record.scope,
      record.request.identity, record.request.canon,
      record.request.items ?? null,
      record.stage,
      record.command
        ? [record.command.orderId, record.command.quoteRef] : null,
      record.outcome
        ? [record.outcome.orderId, record.outcome.orderNumber,
           record.outcome.quoteRef, record.outcome.acceptedAt] : null,
      record.protocol,
    ]);
  }

  private mintKey(): string {
    const api = (globalThis as { crypto?: Crypto }).crypto;
    if (api?.randomUUID) return api.randomUUID();
    // A browser without `crypto.randomUUID` still needs a key, and an
    // idempotency key needs to be UNIQUE rather than unguessable — it is
    // never authority, and the table session is what authorises the request.
    const bytes = new Uint8Array(16);
    if (api?.getRandomValues) {
      api.getRandomValues(bytes);
    } else {                                        // pragma: no cover
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return [
      hex.slice(0, 4).join(''), hex.slice(4, 6).join(''),
      hex.slice(6, 8).join(''), hex.slice(8, 10).join(''),
      hex.slice(10, 16).join(''),
    ].join('-');
  }

  /** Unused by production code; the specs reset the singleton between cases. */
  resetForTest(): void {
    this._flight.set(null);
    this.nextFlightId = 1;
  }
}

/** Re-exported so a caller needs one import for the protocol vocabulary. */
export { CHECKOUT_PROTOCOL_CORRELATED };
