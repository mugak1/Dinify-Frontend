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
import {
  QuoteRefusal,
  closureAsserted,
  readPublishedClosure,
  readStoredClosureEvidence,
  readQuoteRefusal,
  ClosureEvidence,
  QuoteClosure,
} from 'src/app/_shared/order/quote-transition';

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
/**
 * What happened when a renewal was attempted after a closure (G3b/O1).
 *
 * `superseded` is NOT a failure a caller must report: the successor this call
 * wanted already exists — minted by the other mount, or by an earlier tap
 * whose response was lost — or the closure is about an attempt that is no
 * longer the one on screen. Either way there is nothing left to mint.
 */
export type RenewalResult =
  | { readonly kind: 'ready'; readonly key: string;
      readonly record: CheckoutRecord }
  | { readonly kind: 'superseded' }
  | { readonly kind: 'outstanding'; readonly record: CheckoutRecord }
  /**
   * O1 — THE CURRENT ATTEMPT IS NEITHER THE PREDECESSOR NOR ITS SUCCESSOR.
   *
   * The same purchase at the same table, under a key this closure says
   * nothing about. Renewing would abandon a key that is currently in use on
   * the strength of evidence about an older one, which is the precise thing a
   * conditional transition exists to refuse. Nothing is minted and nothing is
   * replaced.
   */
  | { readonly kind: 'conflict'; readonly record: CheckoutRecord }
  /**
   * E1 — A CLOSURE IS ASSERTED AND THIS BUILD MAY NOT ACT ON IT.
   *
   * Distinct from `none`, which means no closure was recorded at all. An
   * unrecognised policy version or an unreadable row is not permission to
   * treat the quote as open: nothing is minted, nothing is settled, the
   * record survives, and the consumer offers manual recovery instead of a
   * re-price that would replay the retired order under the same key.
   */
  | { readonly kind: 'unusable'; readonly evidence: ClosureEvidence }
  | { readonly kind: 'none' }
  | { readonly kind: 'storage-error' }
  | { readonly kind: 'blocked'; readonly stored: StoredCheckout };

export type CheckoutStage =
  | 'pricing' | 'reviewing' | 'accepting'
  | 'unresolved' | 'accepted' | 'refused';

/**
 * I1 — THE IMMUTABLE IDENTITY OF ONE PRICING OPERATION.
 *
 * The initiation counterpart of `CheckoutOwner`, and captured the same way:
 * BEFORE the request goes out, never re-read when its answer lands. An
 * initiation answer is the one reply in this checkout that carries no order
 * of its own to correlate against — the server is being asked to price, not
 * to act — so the only thing that can say which attempt it belongs to is
 * what the client knew when it asked.
 *
 * `orderId` is deliberately absent. A pricing operation has issued no
 * command, which is exactly why `settles()` cannot stand in for this: with a
 * null `orderId` it short-circuits to true for ANY answer naming the same key
 * and scope, including one that predates an acceptance issued since.
 */
export interface PricingOperation {
  readonly key: string;
  readonly scope: string;
  readonly purchase: string;
}

/**
 * I2-C — AN UNRESOLVED CLOSURE SITUATION, WHERE BOTH BASKET CONSUMERS READ IT.
 *
 * WHAT IT IS FOR. Three closure answers leave the diner held with NOTHING
 * durable to show for it, because in all three the local write is exactly what
 * did not happen:
 *
 *   `unusable-evidence`      the server asserted something under
 *                            `quote_closure` that this build may not act on,
 *                            so there is nothing valid to persist;
 *   `unrecorded-closure`     the closure is valid and `noteClosure`'s verified
 *                            write failed, so there is nothing persisted;
 *   `contradictory-evidence` the projection says the order was ACCEPTED *and*
 *                            that its quote was RETIRED. Neither half may be
 *                            persisted — acting on the acceptance clears a
 *                            basket for an order that may never have been
 *                            placed, acting on the closure mints a key for one
 *                            that was — so nothing is.
 *
 * THE THREE ARE KEPT APART BECAUSE THEY DIFFER IN WHAT IS KNOWN, and one word
 * for three facts is how the next consumer mis-diagnoses: a statement this
 * build cannot read, a statement it read and could not write down, and a
 * server contradicting itself. They agree only on what may be DONE.
 *
 * In all three, the record stays `pricing` with no command and no closure —
 * which is the honest state, and is also indistinguishable from an ordinary
 * attempt waiting to be reviewed. The receiving component knew better and held
 * that knowledge in a field of its own; the OTHER mount (the desktop sidebar
 * beside the routed page), and any component mounted afterwards, read the same
 * record and concluded the initiation was replayable.
 *
 * SO THE OBSERVATION LIVES HERE. It is memory-backed and reactive, which is
 * the appropriate shape for a hold that must survive within ONE document while
 * storage itself is the thing failing — a durable hold cannot be written down
 * by definition in the `unrecorded-closure` case. It is NOT a substitute for
 * persisting an attempt before sending it, nor for the verified durable
 * closure `renewAfterClosure` still requires before minting a successor.
 *
 * IT NAMES THE ATTEMPT IT WAS MADE ABOUT, captured before the request whose
 * answer produced it — never whatever record happens to be current when an old
 * answer lands. `unresolvedClosure()` is where that binding is enforced, so a
 * stale observation cannot block or mutate an unrelated successor.
 */
export type ClosureHoldKind =
  | 'unusable-evidence' | 'unrecorded-closure' | 'contradictory-evidence';

export interface ClosureHold {
  readonly kind: ClosureHoldKind;
  /**
   * The captured attempt identity. `key`, `scope` and `purchase` are what
   * `unresolvedClosure()` matches on — they are the attempt, and they are
   * stable across everything that does not change which purchase is being
   * made at which table.
   */
  readonly attempt: PricingOperation;
  /**
   * The order the answer named. RECORDED, NOT MATCHED: a held attempt cannot
   * acquire a command (`noteCommand` refuses one), so matching on it could
   * only ever make the hold lapse, which is the wrong direction. It is here
   * so the hold says what it is about.
   */
  readonly orderId: string | null;
  /** The server's own statement, in the existing evidence vocabulary, carried
   *  VERBATIM. On `unrecorded-closure` it is the valid `closure` that failed
   *  to persist; on `unusable-evidence` the `unsupported` or `malformed` row;
   *  on `contradictory-evidence` whatever stood beside the acceptance, which
   *  may itself be perfectly readable — it is the PAIR that cannot be acted
   *  on, not the row. Nothing is ever coerced between the three. */
  readonly evidence: ClosureEvidence;
}

/** Are these two holds about the same attempt? */
function sameAttempt(a: PricingOperation, b: PricingOperation): boolean {
  return a.key === b.key && a.scope === b.scope && a.purchase === b.purchase;
}

/**
 * May `incoming` take the one observation slot from `current`?
 *
 * Asked only of a `current` that STILL APPLIES — see `holdClosure`, which is
 * what makes a completed attempt's observation unable to veto the next one.
 */
function supersedes(current: ClosureHold, incoming: ClosureHold): boolean {
  // A statement about another attempt is not newer evidence about this one,
  // and taking the slot would lose the applicable observation outright.
  if (!sameAttempt(current.attempt, incoming.attempt)) return false;
  // An observation may never weaken a stronger one about the same attempt.
  return current.kind !== 'contradictory-evidence'
    || incoming.kind === 'contradictory-evidence';
}

/**
 * I1 — WHAT AN INITIATION ANSWER IS STILL ALLOWED TO DO.
 *
 * `superseded` is not a failure to report: the attempt this answer priced has
 * been overtaken — by an acceptance, by a terminal outcome, by a retirement,
 * or by a successor key — and an answer about a superseded attempt has
 * nothing left to say about the record.
 */
export type PricedAnswer =
  | { readonly kind: 'owned'; readonly record: CheckoutRecord }
  | { readonly kind: 'superseded' };

/**
 * I1 — THE RESULT OF MOVING AN OWNED PRICING OPERATION TO `reviewing`.
 *
 * `storage-error` is reported rather than swallowed, for the reason every
 * other durable write here reports it — but see `notePricedReview` for why
 * this particular failure is not a reason to withhold the review.
 */
export type ReviewTransition =
  | { readonly kind: 'reviewing'; readonly record: CheckoutRecord }
  | { readonly kind: 'superseded' }
  | { readonly kind: 'storage-error' };

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

/**
 * O1 — WHICH ATTEMPT A STORED CLOSURE WAS WRITTEN AGAINST.
 *
 * A closure retires ONE quote of ONE order, reached under ONE key at ONE
 * scope for ONE purchase. Without that written down beside it, a renewal
 * could only ask "is there a closure on whatever record is current now", and
 * a mount holding a stale refusal would answer yes about a record another
 * mount had already moved on. The reference itself lives on the closure; this
 * is the rest of the identity.
 *
 * `orderId` is nullable because a refusal does not always name one; every
 * other field is what `ownerOf` already captures, so the two cannot drift.
 */
export interface ClosurePredecessor {
  readonly key: string;
  readonly orderId: string | null;
  readonly scope: string;
  readonly purchase: string;
}

/** What a record says about its quote having been retired. */
export interface StoredClosureReading {
  readonly evidence: ClosureEvidence;
  readonly predecessor: ClosurePredecessor | null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function readPredecessor(value: unknown): ClosurePredecessor | null {
  if (!value || typeof value !== 'object') return null;
  const raw = (value as Record<string, unknown>)['predecessor'];
  if (!raw || typeof raw !== 'object') return null;
  const found = raw as Record<string, unknown>;
  const key = textOrNull(found['key']);
  const scope = textOrNull(found['scope']);
  const purchase = textOrNull(found['purchase']);
  // PARTIAL IS NOT USABLE. The whole point of the identity is that a renewal
  // can refuse a closure belonging to a different attempt, and a predecessor
  // missing the fields it would be compared on cannot do that. `orderId` is
  // the one exception, because a refusal legitimately omits it.
  if (key === null || scope === null || purchase === null) return null;
  return { key, orderId: textOrNull(found['orderId']), scope, purchase };
}

/**
 * C1/E1 — READ A PERSISTED CLOSURE BACK THROUGH THE SAME CONTRACT THE WIRE
 * USES, AND SAY EXACTLY WHAT IT IS.
 *
 * A stored record is not more trustworthy than a response: it may have been
 * written by a build with a different idea of what a closure is, or edited, or
 * truncated. `readClosureEvidence` is the one rule, so this build cannot
 * quietly act on a value it does not understand.
 *
 * IT RETURNS THE EVIDENCE RATHER THAN A NULLABLE CLOSURE (E1). Collapsing
 * `unsupported` and `malformed` into `null` made the record "behave exactly as
 * one written before closures existed" — which is right for a build that may
 * act on any closure it can parse, and WRONG once an unrecognised policy
 * version is deliberately not actionable: the re-price it licensed replays the
 * retired order under the same key, is refused identically, and loops. The
 * consumers need the distinction to offer manual recovery instead.
 *
 * It is given no expected reference: the record's own command may since have
 * been settled and cleared, and a closure that was validated against the right
 * reference when it was WRITTEN does not become wrong because the handle used
 * to validate it has gone.
 */
export function readRecordClosure(value: unknown): StoredClosureReading {
  return {
    evidence: readStoredClosureEvidence(value),
    predecessor: readPredecessor(value),
  };
}

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
  /**
   * G3b — THE ATTEMPT THIS ONE REPLACES, when it replaces one.
   *
   * Provenance for a renewal after a closure: it says this key is the
   * successor of a purchase the server permanently retired, rather than an
   * unrelated second checkout. PURELY INFORMATIONAL — the "exactly one
   * successor" guarantee is enforced by comparing the record that is CURRENT,
   * never by reading this.
   *
   * THAT IS WHY THE RECORD VERSION DOES NOT MOVE FOR IT, and the reasoning is
   * worth keeping. Bumping would make every record this build writes
   * `unsupported` to the previous one, and an `unsupported` record BLOCKS: a
   * rollback mid-checkout would strand a diner who has an order in flight,
   * to protect a field that carries no guarantee. An older build reading a
   * record with this key ignores it and loses nothing it was relying on.
   */
  readonly replaces: string | null;
  /**
   * G4 — THE HIGHEST D06 QUOTE-PROTOCOL LEVEL THIS SERVER HAS STATED FOR THIS
   * ATTEMPT. Monotonic, and remembered for the same reason `protocol` is: a
   * capability once demonstrated does not un-demonstrate itself.
   *
   * It is what makes a LATER response's SILENCE readable. A server that
   * published `quote_protocol: 2` on the initiate and then answers with no
   * `quote_closure` is saying the quote is not retired; one that never stated a
   * level is saying nothing at all, and reading its silence as a verdict would
   * make every older backend look like it was answering a question it has never
   * been asked. Kept apart from `protocol` because the two levels are separate
   * promises that move independently — D04 answers "can an uncertain checkout be
   * recovered", D06 "may this quote still be accepted".
   */
  readonly quoteProtocol: number;
  /**
   * C1 — THE SERVER'S DURABLE STATEMENT THAT THIS ATTEMPT'S QUOTE IS FINISHED.
   *
   * WHY IT IS PERSISTED RATHER THAN HELD IN MEMORY. A closure is the one D06
   * fact a client learns and can then LOSE: the refusal that announces it is
   * exactly the response a dropped connection destroys, and the reload that
   * follows is what this record exists to survive. Without it the diner's
   * explicit "review updated order" would have to re-read the server to find
   * out what it already knew, and a second mount would have no way to see that
   * the first had established it.
   *
   * IT IS EVIDENCE, NOT A FLAG. It is written only from a closure this build
   * VALIDATED (`readClosureEvidence`), it names the reference the server
   * retired, and it is never inferred from a reason code, a deadline, a
   * refusal that carried no row, or the absence of anything.
   *
   * IT IS HELD AS THE RAW PERSISTED VALUE AND READ THROUGH ONE FUNCTION
   * (`readRecordClosure`), which is what makes E1 true rather than intended:
   * parsing it into a nullable closure DISCARDED anything this build could not
   * use, and re-persisting the record then erased it from storage as well. The
   * raw value round-trips untouched, so a closure written by a build that knows
   * a policy version this one does not survives a rollback intact — and so does
   * the O1 `predecessor` that rides on the same object.
   *
   * THE RECORD VERSION DELIBERATELY DOES NOT MOVE FOR IT, for the reason
   * `replaces` records at length: bumping would make every record this build
   * writes `unsupported` to the previous one, and an `unsupported` record
   * BLOCKS — a rollback mid-checkout would strand a diner with an order in
   * flight. An older build reading a record carrying this key ignores it and
   * loses nothing it relied on: the key is kept and the command settled, so its
   * next re-price replays the retired order and its own G3b initiate-handler
   * check renews there instead. That is one wasted round trip, not a dead end.
   */
  readonly closure: unknown;
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
  /**
   * I2-C — THIS ATTEMPT IS HELD BY AN UNRESOLVED CLOSURE SITUATION.
   *
   * Distinct from `blocked` (the stored record cannot be read) and from
   * `outstanding` (an acceptance is in flight): the record here is perfectly
   * readable and nothing was ever issued. What is known is that the server
   * said something about this quote which this device could neither act on
   * nor write down, so neither continuing under the same key nor minting a
   * fresh one is available — the first replays a quote that may be retired,
   * the second abandons the attempt the observation is about.
   */
  | { readonly kind: 'held'; readonly hold: ClosureHold }
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
  /**
   * C1 — THE ORDER IS A DEFINITIVE DRAFT *AND* ITS QUOTE HAS BEEN RETIRED.
   *
   * Kept apart from `draft` because the two call for OPPOSITE actions. A
   * draft's acceptance may be re-sent — that is D04's proof-of-non-execution
   * rule, and withholding the re-send there is its own dead end. A CLOSED
   * quote can never be accepted, so re-sending is the dead end: the server
   * refuses identically, the refusal files as unknown, and Retry returns here.
   *
   * It is only ever reached from a `not-accepted` verdict: acceptance is
   * resolved FIRST, so an order the server accepted stays accepted whatever a
   * closure beside it says.
   */
  | { readonly kind: 'closed'; readonly order: any;
      readonly correlation: CheckoutCorrelation | null;
      readonly closure: QuoteClosure }
  /**
   * E1 — THE PROJECTION SAYS THE ORDER WAS ACCEPTED *AND* ITS QUOTE WAS
   * RETIRED, WHICH THE SERVER CANNOT BOTH BE TRUE ABOUT.
   *
   * `quote_closure.close` refuses to write a closure beside acceptance
   * evidence, and the acceptance path resolves evidence FIRST, so one order
   * carries at most one of the two. A response carrying both is a server
   * contradicting itself, and either half taken alone leads somewhere
   * irreversible: announce the acceptance and the basket is cleared for an
   * order that may never have been placed; act on the closure and a
   * replacement key is minted for one that was.
   *
   * SO NEITHER HALF IS CHOSEN. The original attempt is preserved, no ordinary
   * success is announced, no successor is minted and nothing is erased — the
   * diner is pointed at the one party who can resolve it, and the record
   * survives so a later coherent read still can.
   */
  | { readonly kind: 'inconsistent'; readonly order: any;
      readonly correlation: CheckoutCorrelation | null;
      readonly evidence: ClosureEvidence }
  /**
   * E1 — THE SERVER ASSERTED A CLOSURE THIS BUILD MAY NOT ACT ON, BESIDE AN
   * ORDER IT HAS NOT ACCEPTED.
   *
   * A policy version this build has never seen, a malformed row, or one
   * naming a different quote. None of them is `absent`: the server recorded
   * SOMETHING under `quote_closure`, and reading that as "no closure" is the
   * convenient half — the key may be bound to an order the server has
   * retired, so the `draft` fallback would re-send the recorded acceptance,
   * be refused identically, file as `unknown` and return here.
   *
   * KEPT APART FROM `inconsistent` DELIBERATELY. That one is the server
   * contradicting ITSELF (accepted AND closed); this one is a single
   * coherent statement this build cannot read. The remedy is the same today
   * — preserve the attempt, announce nothing, mint nothing, erase nothing,
   * point at staff, and let a later authorized read from a build that knows
   * the version resolve it — but the causes are different, and one word for
   * two facts is how the next reader mis-diagnoses.
   */
  | { readonly kind: 'closure-unreadable'; readonly order: any;
      readonly correlation: CheckoutCorrelation | null;
      readonly evidence: ClosureEvidence }
  /**
   * I2 — THE SERVER RETIRED THE QUOTE AND THIS DEVICE COULD NOT WRITE IT DOWN.
   *
   * NOT `closure-unreadable`, and the difference is the whole reason it has
   * its own word: the closure is valid, supported and names this attempt's
   * quote. What failed is the LOCAL transition — `noteClosure`'s verified
   * write — so the server fact is known and the record does not carry it.
   *
   * Pretending the write succeeded would offer a successor for a closure
   * nothing recorded; treating it as absence would open an ordinary
   * confirmable review for a quote that can never be paid, which is what the
   * fall-through it replaces actually did. So neither: the key and the request
   * are kept, no successor is minted, nothing is erased, and the diner is told
   * the quote is finished and that this device could not save it. A reload
   * re-reads the order, finds the SAME published closure and writes it then —
   * which is the recovery, and it needs nothing to have been guessed here.
   */
  | { readonly kind: 'closure-unrecorded'; readonly closure: QuoteClosure }
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

  /**
   * I2-C — the unresolved closure observation, shared exactly as the flight
   * is. See `ClosureHold` for what it is and `unresolvedClosure()` for the
   * binding that keeps a stale one harmless.
   */
  private readonly _closureHold = signal<ClosureHold | null>(null);

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

    // I2-C — A HELD ATTEMPT IS NEITHER CONTINUED NOR REPLACED.
    //
    // BOTH branches below had to be refused, and refusing only one would have
    // been worse than refusing neither. `sameCommand` hands the SAME key back
    // for the same purchase, which would re-price under a key that may be
    // bound to a retired order; the mint below would abandon the attempt the
    // observation is about and start a second one for the same basket. The
    // check sits here, above both, so every consumer — the routed page, the
    // sidebar, a component mounted after the hold — reaches one answer.
    const held = this.unresolvedClosure();
    if (held) return { kind: 'held', hold: held };

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
      replaces: null,
      quoteProtocol: 0,
      // A FRESH ATTEMPT IS NOT RETIRED. Nothing has been priced yet.
      closure: null,
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
    // I2-C — AND NOT WHILE THE ATTEMPT IS HELD. Re-issuing the recorded
    // initiation is precisely what a second mount did on the strength of a
    // record that says `pricing` with no closure, which is what the
    // observation exists to contradict.
    if (this.heldRecord(record)) return false;
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

  // -- the shared unresolved-closure observation (I2-C) --------------------

  /**
   * Record that an attempt is held by a closure situation this device could
   * neither act on nor write down.
   *
   * IT ASSERTS NOTHING THE SERVER DID NOT SAY. The evidence is carried
   * verbatim in the vocabulary it was read in, so an `unsupported` or
   * `malformed` assertion stays exactly that — this is deliberately not a
   * route by which an unusable assertion becomes a valid terminal fact, which
   * is `noteClosure`'s job and requires a validated closure.
   *
   * IT IS MEASURED AGAINST THE HOLD THAT STILL APPLIES, never against the raw
   * slot. An observation whose attempt is over does not survive as a veto: it
   * lingers in the one slot until something replaces it, and comparing
   * against it refused the NEXT attempt's own hold — leaving the purchase
   * that needed protecting with none (L3).
   *
   * `supersedes` is the whole rule, and both halves are load-bearing. An
   * observation about a DIFFERENT attempt never displaces an applicable one,
   * because `unresolvedClosure` would then refuse the replacement for not
   * matching the record and the original would simply be lost. And ordinary
   * evidence never downgrades a contradiction about the SAME attempt, because
   * only that kind withholds the durable-closure yield — a closure records
   * the retired half and says nothing about the acceptance the same response
   * claimed (Codex P2 on PR #679).
   *
   * Everything else still replaces freely: a contradiction over an ordinary
   * hold, a fresher contradiction over an older one, and the two ordinary
   * kinds over each other.
   *
   * ONE SLOT IS A PRE-EXISTING LIMIT. Two holds about two attempts have never
   * been representable; what this fixes is the slot outliving its attempt.
   * The contradiction's exit is still `releaseClosureHold`, ordering-aware.
   */
  holdClosure(hold: ClosureHold): void {
    const current = this.unresolvedClosure();
    if (current && !supersedes(current, hold)) return;
    this._closureHold.set(hold);
  }

  /**
   * The hold that applies to the attempt on record NOW, or `null`.
   *
   * THE BINDING IS THE WHOLE POINT. A hold is about ONE attempt, and every
   * consumer reads it through here so none of them can act on one that has
   * been left behind. Five cases, and each is a decision:
   *
   *   no record at all      DOES NOT APPLY. There is no attempt to hold, and
   *                         blocking a fresh one would strand the diner with
   *                         nothing to recover from — `reserveIntent` mints a
   *                         new key there, which IS the way out.
   *   a different attempt   DOES NOT APPLY. A different key, table or
   *                         purchase is a different operation and this
   *                         observation was never about it. That is what
   *                         stops a stale K1 hold blocking a legitimate K2.
   *   same attempt, and a
   *   VALID durable closure DOES NOT APPLY — EXCEPT to a CONTRADICTION. The
   *                         situation has been resolved by a verified write —
   *                         from a later authorized read, or from the other
   *                         mount — and a newer established fact outranks an
   *                         older observation. This is what keeps a local
   *                         result from masking a shared resolution forever.
   *                         **`contradictory-evidence` is deliberately outside
   *                         it**: a durable closure records the RETIRED half
   *                         and says nothing about the acceptance the same
   *                         response claimed, so yielding would offer a
   *                         successor for an order that may be in the kitchen
   *                         — which is the irreversible half of the
   *                         contradiction. Only an answer that resolves it
   *                         (`releaseClosureHold`) clears that one.
   *   same attempt          APPLIES.
   *   unreadable storage    APPLIES. Nothing here can prove the hold is about
   *                         a different attempt, so it stands. (Those records
   *                         are independently refused by `reserveIntent`.)
   *
   * It is a plain read: no write, no repair, no expiry and no clock.
   */
  unresolvedClosure(): ClosureHold | null {
    const hold = this._closureHold();
    if (!hold) return null;

    const stored = this.read();
    if (stored.kind === 'none') return null;
    if (stored.kind !== 'record') return hold;

    const now = stored.record;
    if (now.key !== hold.attempt.key
        || now.scope !== hold.attempt.scope
        || now.request.identity !== hold.attempt.purchase) {
      return null;
    }
    if (hold.kind !== 'contradictory-evidence'
        && readRecordClosure(now.closure).evidence.kind === 'closure') {
      return null;
    }
    return hold;
  }

  /**
   * Is the attempt this OPERATION names held?
   *
   * THE ONE SHARED SEND-ELIGIBILITY QUESTION, asked by everything that is
   * about to mutate on behalf of one attempt. `noteCommand` asks it of the
   * record it is about to write, `isReplayableInitiation` of the record it is
   * classifying, and the acceptance RESEND of the immutable owner captured
   * before its read — which is the consumer that had no gate at all, because
   * a resend re-sends a command that was persisted before the ORIGINAL
   * acceptance and therefore writes nothing on its way out.
   *
   * A NULL OPERATION NAMES NOTHING, so it cannot be shown to be a different
   * attempt: it FAILS CLOSED and any live hold applies, exactly as
   * `unresolvedClosure` does for storage it cannot read. The realistic
   * producer is a record that was unreadable when the request went out, which
   * is precisely when nothing should be sent.
   */
  heldOperation(operation: PricingOperation | null): ClosureHold | null {
    const hold = this.unresolvedClosure();
    if (!hold) return null;
    if (!operation) return hold;
    return sameAttempt(hold.attempt, operation) ? hold : null;
  }

  /**
   * I2-C (completion) — A COHERENT ANSWER RESOLVES THE SITUATION IT IS ABOUT.
   *
   * The two ordinary kinds already have a passive exit: a VERIFIED durable
   * closure on the record, which `unresolvedClosure` yields to. A CONTRADICTION
   * has none, deliberately — see the yield rule above — so without this it
   * could only ever be resolved by the record disappearing, and a server that
   * stopped contradicting itself would leave the diner held for ever.
   *
   * ORDERING IS THE WHOLE GUARD, and it is stated as reference identity:
   * `observed` is the hold that was current when the request whose answer
   * this is went OUT. If the current hold is not that same one, an observation
   * has been made since and this answer describes a moment before it — so it
   * is refused, however much later it happens to land. A null `observed`
   * (nothing was held when the request was issued) can therefore never clear a
   * hold established while it was open.
   *
   * It is not a general "clear the hold" setter: the answer must be about the
   * attempt the hold names, which is what routing through `heldOperation`
   * asserts.
   */
  releaseClosureHold(
    operation: PricingOperation | null, observed: ClosureHold | null,
  ): boolean {
    if (!observed) return false;
    if (this.heldOperation(operation) !== observed) return false;
    this._closureHold.set(null);
    return true;
  }

  /** Is the attempt this record names held? The record-shaped question, for
   *  callers that already have one in hand. */
  private heldRecord(record: CheckoutRecord): ClosureHold | null {
    return this.heldOperation({
      key: record.key,
      scope: record.scope,
      purchase: record.request.identity,
    });
  }

  /**
   * The highest level this server has demonstrated for the attempt an answer
   * is about, read AT THE MOMENT THE ANSWER LANDS.
   *
   * `recover()` snapshots `pending` BEFORE the request, and startup recovery
   * deliberately does not claim the checkout flight — so a diner can initiate
   * against a level-3 node while an earlier read is still open, and the
   * snapshot then says 0 for a server that has since proved it can do better.
   * Reading only the snapshot let the legacy branch trust `accepted: true`
   * from exactly the case the memory exists to refuse (Codex P1 on PR #666).
   *
   * THE SNAPSHOT'S IDENTITY HALF IS UNTOUCHED, and that split is the point:
   * key, scope and the issued command must stay as captured, or a held answer
   * starts being measured against whatever storage says now — which is what
   * makes a stale answer look authoritative. Only the CAPABILITY is read
   * live, because it is monotonic: a server does not un-demonstrate a level.
   * The live value is consulted ONLY for the same attempt; a record replaced
   * by a different key describes a different operation and says nothing about
   * this one.
   */
  private demonstratedProtocol(pending: CheckoutRecord): number {
    const now = this.record();
    return now && now.key === pending.key
      ? Math.max(pending.protocol, now.protocol)
      : pending.protocol;
  }

  /** The highest level any server has stated for the live attempt, or 0. */
  establishedProtocol(): number {
    return this.record()?.protocol ?? 0;
  }

  /**
   * The highest D06 level any server has stated for the live attempt, or 0.
   *
   * C2 — READ WHEN AN ANSWER LANDS, not when the request was sent, and
   * deliberately NOT from the response being read: a capability once
   * demonstrated does not un-demonstrate itself, so an answer that omits both
   * the level and the correlation must not be excused by its own silence.
   */
  establishedQuoteProtocol(): number {
    return this.record()?.quoteProtocol ?? 0;
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

  /**
   * Remember the D06 level this server has stated. Monotonic — see
   * `CheckoutRecord.quoteProtocol`.
   */
  noteQuoteProtocol(level: number): boolean {
    const current = this.record();
    if (!current || !Number.isInteger(level)
        || level <= current.quoteProtocol) {
      return false;
    }
    return this.persist({ ...current, quoteProtocol: level });
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

  /**
   * C1 — RECORD THAT THE SERVER RETIRED THIS ATTEMPT'S QUOTE.
   *
   * ONE WRITE, TWO FACTS, AND THEY MUST NOT BE SPLIT. The command is settled
   * (a closed quote can never be accepted, so the issued acceptance is
   * definitively dead — the `settleRefusedCommand` reasoning, reached by the
   * strongest possible evidence) AND the closure is remembered, so the diner's
   * explicit review action, the other mount and the next page load all see the
   * same established fact without asking the server again. Writing them
   * separately would leave a window where the command is settled and the
   * reason is gone — a record that looks like an ordinary reprice.
   *
   * THE KEY IS KEPT. The successor is minted by `renewAfterClosure` from a
   * DELIBERATE diner action; retiring the key here would discard the identity
   * of the attempt before anything had decided what to do about it.
   *
   * It takes a VALIDATED closure and never a reason code: the whole point is
   * that this is evidence the server produced, not a conclusion this client
   * drew. Returns whether the write is durable; a caller must not act on
   * `false`.
   */
  noteClosure(closure: QuoteClosure): boolean {
    const current = this.record();
    if (!current) return false;
    return this.persist({
      ...current,
      stage: 'refused',
      command: null,
      // O1 — THE CLOSURE CARRIES THE ATTEMPT IT WAS WRITTEN AGAINST.
      // `command` is cleared in this same write, so the order id is read
      // BEFORE it goes. The reference itself is already on the closure; this
      // is the rest of the identity, and it is what lets `renewAfterClosure`
      // make a CONDITIONAL transition rather than acting on whatever record
      // happens to be current when a caller gets round to asking.
      closure: {
        closedAt: closure.closedAt,
        reason: closure.reason,
        quoteRef: closure.quoteRef,
        policyVersion: closure.policyVersion,
        predecessor: {
          key: current.key,
          orderId: current.command?.orderId ?? null,
          scope: current.scope,
          purchase: current.request.identity,
        },
      },
    });
  }

  /** What this record says about its quote having been retired. ONE reading,
   *  so no consumer forms its own opinion about a stored closure. */
  closureOf(record: CheckoutRecord): StoredClosureReading {
    return readRecordClosure(record.closure);
  }

  /** The same, for whatever attempt is current. `null` when there is no
   *  readable record at all — which is not the same as "no closure". */
  currentClosure(): StoredClosureReading | null {
    const current = this.record();
    return current ? this.closureOf(current) : null;
  }

  private closureDigest(record: CheckoutRecord): unknown {
    const reading = readRecordClosure(record.closure);
    const identity = reading.predecessor
      ? [reading.predecessor.key, reading.predecessor.orderId,
         reading.predecessor.scope, reading.predecessor.purchase]
      : null;
    switch (reading.evidence.kind) {
      case 'absent':
        return null;
      case 'malformed':
        return ['malformed', reading.evidence.defect, identity];
      default:
        return [
          reading.evidence.kind,
          reading.evidence.closure.closedAt, reading.evidence.closure.reason,
          reading.evidence.closure.quoteRef,
          reading.evidence.closure.policyVersion,
          identity,
        ];
    }
  }

  /**
   * Write a stage onto whatever record is current — UNCONDITIONALLY.
   *
   * IT HAS NO PRODUCTION CALLER, and that is deliberate rather than an
   * oversight waiting to be tidied up. It is kept because the specs use it to
   * BUILD a record in a named stage, which is honest fixture setup; what it
   * must never again be is the way a RESPONSE moves the checkout on.
   *
   * It spreads over `record()` and asks nothing about which operation the
   * caller was answering for, so a late pricing reply walked an `accepting`
   * record back to `reviewing` and — since `isOutstanding` reads the STAGE —
   * unprotected the issued acceptance underneath it. Every transition driven
   * by an answer goes through a CONDITIONAL one instead
   * (`notePricedReview`, `noteCommand`, `recordOutcome`, `noteClosure`,
   * `settleRefusedCommand`), each of which establishes that the record it is
   * about is still the record it was issued for.
   *
   * So: if you are reaching for this from a subscriber, you want
   * `notePricedReview`.
   */
  noteStage(stage: CheckoutStage): boolean {
    const current = this.record();
    if (!current) return false;
    return this.persist({ ...current, stage });
  }

  /**
   * I1 — MAY THIS PRICING ANSWER STILL ACT ON THE RECORD?
   *
   * THE DEFECT THIS ANSWERS. Both initiation handlers guarded their callbacks
   * on a component-local `{seq, revision, context}` and then wrote to the
   * SHARED record. None of those three moves when another mount advances the
   * checkout, and a destroyed instance keeps its `activeAttempt` — so the
   * ordinary interruption (price on the routed page, navigate away, finish on
   * the sidebar) let a held initiation answer land over an acceptance that had
   * been issued since. `noteStage('reviewing')` then walked the record back
   * from `accepting`, and because `isOutstanding` reads the STAGE, the issued
   * command stopped being protected: the next changed purchase minted a fresh
   * key and erased the only handle the unsettled acceptance could be
   * recovered by.
   *
   * SO IT IS A CONDITIONAL TRANSITION, the shape `renewAfterClosure` already
   * uses, and it refuses on two independent grounds.
   *
   * IDENTITY — the record must still be the attempt this operation was issued
   * for: the same key, at the same scope, for the same purchase. A successor
   * minted after a closure carries a different key and is not this answer's
   * to touch.
   *
   * STATE — and the attempt must not have MOVED ON, which identity alone
   * cannot say. `accepting`, `unresolved` and `accepted` are all reached only
   * by an acceptance; an issued `command` says the same thing from the other
   * side and is checked independently, because a handle can be lost without
   * the operation having been. An asserted closure is refused too: a quote the
   * server has retired must never be walked back to a reviewable one, and that
   * is reachable exactly when one mount establishes a closure while another's
   * older pricing answer is still in flight.
   *
   * `refused` IS AN ALLOWED SOURCE, and deliberately so: `settleRefusedCommand`
   * leaves a `quote_ref_stale` reprice at `refused` with no command and no
   * closure, and `placeOrder` then prices again under the same key. Refusing
   * it here would break the ordinary reprice.
   */
  resolvePricedAnswer(operation: PricingOperation): PricedAnswer {
    const current = this.record();
    if (!current) return { kind: 'superseded' };
    if (current.key !== operation.key
        || current.scope !== operation.scope
        || current.request.identity !== operation.purchase) {
      return { kind: 'superseded' };
    }
    if (current.stage !== 'pricing' && current.stage !== 'reviewing'
        && current.stage !== 'refused') {
      return { kind: 'superseded' };
    }
    if (current.command !== null) return { kind: 'superseded' };
    if (readRecordClosure(current.closure).evidence.kind !== 'absent') {
      return { kind: 'superseded' };
    }
    return { kind: 'owned', record: current };
  }

  /**
   * I1 — MOVE AN OWNED PRICING OPERATION TO `reviewing`, OR DO NOTHING.
   *
   * The write `noteStage('reviewing')` used to make unconditionally. It
   * re-asks `resolvePricedAnswer` rather than trusting a check the caller made
   * earlier, so the gate and the write cannot be separated by anything — the
   * same reasoning that keeps `renewAfterClosure`'s decision inside the
   * primitive rather than at its four call sites.
   *
   * A FAILED WRITE IS REPORTED BUT IS NOT A REASON TO WITHHOLD THE REVIEW, and
   * that is a narrower claim than it looks. `pricing` and `reviewing` are
   * indistinguishable to every consumer that matters — neither is outstanding,
   * both are replayable initiations — so a record stuck at `pricing` describes
   * the same recoverable attempt. Nothing the diner is about to confirm rests
   * on it, unlike the closure write in `noteClosure`, which is the sole record
   * of a fact only the server knows.
   */
  notePricedReview(operation: PricingOperation): ReviewTransition {
    const owned = this.resolvePricedAnswer(operation);
    if (owned.kind !== 'owned') return { kind: 'superseded' };
    const record: CheckoutRecord = { ...owned.record, stage: 'reviewing' };
    return this.persist(record)
      ? { kind: 'reviewing', record }
      : { kind: 'storage-error' };
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
    // I2-C — NO ACCEPTANCE IS RECORDED FOR A HELD ATTEMPT, SO NONE IS ISSUED.
    //
    // THE STRUCTURAL GATE, and the reason a consumer-side guard is not enough
    // on its own: every acceptance in this client is written down before it
    // is sent, so refusing the write refuses the send — for the direct
    // confirmation, for a resend, and for any future caller. A second mount
    // holding a review opened BEFORE the hold passes every check it can make
    // about itself (its reviewed key still matches, its sheet is still open,
    // the basket has not moved) and is stopped here.
    if (this.heldRecord(current)) return false;
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
   * G3b — ONE NEW ATTEMPT, WITH A NEW KEY, FOR A QUOTE THE SERVER RETIRED.
   *
   * THE DEAD END THIS EXISTS FOR. `settleRefusedCommand` keeps the key, and
   * that is RIGHT for a `quote_ref_stale` reprice: the order is still
   * acceptable and only the reference moved, so the same purchase must reuse
   * its key. It is FATAL for a closure. The key is bound to the order the
   * closure was written against, so the next `initiate` REPLAYS it: the same
   * retired draft comes back, the review sheet renders a quote that can never
   * be paid, submitting it is refused again, and the diner loops with no way
   * out of the app. The two arrive through the same branch, which is why they
   * had the same answer and why only one of them was correct.
   *
   * A renewal is not a repair. It does not reprice the old order, it cannot
   * delete or contradict the closure — that is a server fact and this client
   * has no business pretending otherwise — and it never lets one key name two
   * orders. It is a NEW attempt at the SAME purchase: the basket has not
   * changed, so `request` and `scope` carry across unchanged and only the key
   * is new.
   *
   * EXACTLY ONE SUCCESSOR. `BasketBodyComponent` is mounted TWICE on desktop,
   * and both can be holding the same refusal. `replaced` names the record the
   * caller decided about; if it is no longer the current one, another mount
   * has already renewed and this call reports `superseded` rather than
   * minting a second key for the same closure. Called with no argument it
   * renews whatever is current, which is right for a caller that has just
   * read it.
   *
   * IT IS REFUSED WHILE AN ACCEPTANCE IS OUTSTANDING, and that is the
   * important refusal. A renewal abandons the current key; abandoning one
   * whose command may have been issued and whose outcome is unknown is
   * exactly how a diner ends up with two orders — the failure the not-found
   * rule exists to prevent. `isProtected` also refuses a degraded record, an
   * `accepted` claim with no outcome behind it, and an identity produced by a
   * canonicalisation this build does not know, for the reasons recorded
   * there.
   *
   * THE WRITE IS VERIFIED BEFORE THE KEY IS RETURNED. A key nobody wrote down
   * is not an idempotency key, so a storage that silently drops the write
   * refuses the renewal and the caller sends nothing.
   */
  renewAfterClosure(): RenewalResult {
    const stored = this.read();
    if (stored.kind === 'none') return { kind: 'none' };
    if (stored.kind !== 'record') return { kind: 'blocked', stored };

    const current = stored.record;

    // I2-C — A HELD ATTEMPT MINTS NO SUCCESSOR, and the two kinds answer
    // differently because they differ in what is KNOWN.
    //
    // `unusable-evidence` is E1's answer reached one step earlier: the server
    // asserted a closure this build cannot read, so nothing was persisted and
    // the record's own evidence reads `absent` — which without this would
    // return `none` and read to a caller as "no closure, carry on".
    //
    // `unrecorded-closure` is a valid closure this device failed to write
    // down. A successor may only ever come from a VERIFIED durable closure,
    // so there is nothing here to mint from; `storage-error` is what that is,
    // and it is the answer the consumer already handles by keeping the
    // attempt and saying so.
    //
    // `contradictory-evidence` is `unusable` for a different reason, and the
    // mapping is spelled out rather than left to a two-way `else`: the row
    // beside the acceptance may itself be perfectly readable, so this is not
    // "the closure cannot be read" — it is that a closure claimed beside an
    // acceptance may not be acted on at all, which is exactly what `unusable`
    // means to the consumer. Minting here is the irreversible half.
    const held = this.heldRecord(current);
    if (held) {
      switch (held.kind) {
        case 'unrecorded-closure':
          return { kind: 'storage-error' };
        case 'unusable-evidence':
        case 'contradictory-evidence':
          return { kind: 'unusable', evidence: held.evidence };
      }
    }

    // O1 — THE EVIDENCE IS READ FROM THE RECORD, NEVER PASSED IN.
    //
    // This used to take the caller's `QuoteClosure` and an optional record
    // handle, so the decision was made about whatever the CALLER was holding.
    // A mount holding a stale refusal for K1 could therefore renew a record
    // another mount had already moved to K2: `replaced` was optional, and
    // omitting it — which the initiate-replay and enquiry paths did — meant
    // "renew whatever is current". Reading the persisted closure makes the
    // decision about the attempt the SERVER retired, which is the only
    // identity that means anything here.
    //
    // C2's rule survives intact and is now a property of the store rather
    // than of four call sites: no persisted evidence, no successor.
    const reading = readRecordClosure(current.closure);
    if (reading.evidence.kind === 'absent') return { kind: 'none' };
    if (reading.evidence.kind !== 'closure') {
      // E1 — ASSERTED AND UNUSABLE IS NOT ABSENT. A closure this build cannot
      // act on must not mint a key (that is the supported-policy rule) and
      // must not be read as "no closure" either (that re-prices under a key
      // bound to a retired order and loops). It is its own answer, and the
      // consumer offers manual recovery.
      return { kind: 'unusable', evidence: reading.evidence };
    }

    // THE CONDITIONAL TRANSITION. Exactly three outcomes for a predecessor:
    // create K2 once, observe the K2 that already exists, or refuse.
    const predecessor = reading.predecessor;
    if (predecessor && predecessor.key !== current.key) {
      if (current.replaces === predecessor.key) {
        // The successor is already established — by the other mount, or by an
        // earlier tap whose response was lost. This call wanted exactly that.
        return { kind: 'superseded' };
      }
      if (current.scope !== predecessor.scope
          || current.request.identity !== predecessor.purchase) {
        // A different table or a different basket: this closure is not about
        // the attempt on screen and nothing needs renewing for it.
        return { kind: 'superseded' };
      }
      // Same purchase, neither the predecessor nor its successor — a later
      // attempt this closure says nothing about. REFUSED rather than
      // replaced: minting here would abandon a key that is currently in use.
      return { kind: 'conflict', record: current };
    }

    if (this.isProtected(current, current.request)) {
      return { kind: 'outstanding', record: current };
    }

    const record: CheckoutRecord = {
      v: CHECKOUT_RECORD_VERSION,
      key: this.mintKey(),
      scope: current.scope,
      request: current.request,
      stage: 'pricing',
      // A NEW ATTEMPT CARRIES NOTHING FORWARD BUT THE PURCHASE. The command
      // belonged to the refused attempt and the outcome to no attempt at all;
      // the protocol level is re-demonstrated by this server's next response,
      // and carrying it would let a record assert a capability about an
      // exchange that has not happened yet.
      command: null,
      outcome: null,
      startedAt: Date.now(),
      protocol: 0,
      degraded: false,
      replaces: current.key,
      // A NEW ATTEMPT IS A NEW QUESTION, for this level as for the other: the
      // server re-states what it supports on the next response.
      quoteProtocol: 0,
      // AND IT CARRIES NO CLOSURE. The closure belonged to the RETIRED
      // attempt and is left on nothing — the successor's quote has not been
      // priced yet, let alone retired. Copying it forward would make a brand
      // new attempt read as already finished.
      closure: null,
    };
    return this.persist(record)
      ? { kind: 'ready', key: record.key, record }
      : { kind: 'storage-error' };
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

  // -- the D06 quote transition ------------------------------------------

  /**
   * THE ONE PLACE A QUOTE REFUSAL MOVES CHECKOUT STATE.
   *
   * Both basket mounts hand every refusal here rather than each matching
   * reason codes at the point it arrives, so the routed page and the desktop
   * sidebar cannot reach different conclusions about the same answer — which
   * is exactly what "which component am I looking at" bugs are made of.
   *
   * WHAT IT DOES, PER DISPOSITION, and why each is what it is:
   *
   *   TRANSIENT  nothing. The restaurant paused or the table went out of
   *              service; the quote survives, the key survives, and the SAME
   *              attempt may succeed in a minute. Settling the command here
   *              would let the diner start a second checkout for a purchase
   *              the server has not refused.
   *
   *   TERMINAL   settle the command and KEEP the key. The server has recorded
   *              that this quote may never be accepted, so the issued command
   *              is definitively dead and holding it outstanding would strand
   *              the diner: `reserveIntent` would answer `outstanding` and
   *              Retry would replay a command the server has already refused.
   *              The KEY stays because the basket is unchanged and this is
   *              still the same purchase — a fresh key would turn one attempt
   *              into two orders, which is what the key exists to prevent.
   *
   *   REPRICE    the same, and deliberately so. The server did not retire the
   *              quote, but it did refuse THIS command definitively, and the
   *              client's next step is identical. They are separate words
   *              because what may be SAID differs, not what must be done.
   *
   *   UNKNOWN    nothing, and that is the safe direction. A reason this build
   *              has never heard of must not be guessed into a bucket: a newer
   *              server is entitled to add one, and settling on it would
   *              discard a command that may still be live.
   *
   * IT IS NOT A WAY AROUND THE NOT-FOUND RULE. Every disposition it acts on
   * comes from a refusal the server STATED about this exact command; a
   * timeout, a lost response or an unreachable server produces no refusal
   * body, so `readQuoteRefusal` returns null and this returns null with it.
   */
  applyQuoteRefusal(error: unknown, issued?: CheckoutOwner): QuoteRefusal | null {
    const current = this.record();

    // O1 — THE REFUSAL MUST BE ABOUT THE COMMAND THAT WAS ISSUED.
    //
    // This read `this.record()` and acted on whatever was current when the
    // reply landed. Both halves of that are consequential: the terminal
    // branch SETTLES a command and records a closure, and the reprice branch
    // settles one with no closure at all — so a `quote_ref_stale` reply
    // arriving after the attempt moved on had nothing to catch it, because
    // there is no reference on that path for the evidence check to compare.
    //
    // `issued` is the operation this reply belongs to, frozen when the
    // command went out. Omitted by a caller that has no command in flight
    // (an authorized enquiry about a quote this client never submitted),
    // which is the case the reference check below already covers.
    if (issued && !this.settles(issued)) return null;

    // C2 — THE CLOSURE IS VALIDATED AGAINST THE COMMAND THAT WAS ISSUED. A
    // closure naming a different reference is a statement about a different
    // quote; honouring it here would settle THIS command and mint a successor
    // on evidence about something else. Absent when no command was issued,
    // which is the case an authorized answer about a quote this client never
    // submitted legitimately reaches.
    const refusal = readQuoteRefusal(error, {
      quoteRef: current?.command?.quoteRef ?? null,
    });
    if (!refusal) return null;

    // I2-C — THE SUBMIT DOOR ASSERTS UNUSABLE EVIDENCE TOO, AND SAYS SO
    // SHARED.
    //
    // `readQuoteRefusal` downgrades a terminal reason whose closure this build
    // cannot read to `unknown` — correctly, because nothing may be acted on —
    // and the consumer then reports generic uncertainty and offers a Retry the
    // server refuses identically. The DOWNGRADE stays; what is added is that
    // the fact becomes shared, so the other mount does not go on offering a
    // checkout under a key that may be bound to a retired order.
    //
    // A refusal carrying NO closure at all is left completely alone: that is
    // genuine uncertainty, and a Retry there is the right offer. The
    // distinction is `closureAsserted`, which is the same predicate every
    // other consumer uses.
    if (current && refusal.disposition === 'unknown'
        && closureAsserted(refusal.evidence)) {
      this.holdClosure({
        kind: 'unusable-evidence',
        attempt: { key: current.key, scope: current.scope,
                   purchase: current.request.identity },
        orderId: issued?.orderId ?? current.command?.orderId ?? null,
        evidence: refusal.evidence,
      });
    }

    if (refusal.disposition === 'terminal'
        && refusal.evidence.kind === 'closure') {
      // C1 — THE CLOSURE IS REMEMBERED, NOT JUST ACTED ON. The refusal that
      // carries it is the one response a client can lose, and a diner who
      // reloads must not have to discover it again by attempting an
      // acceptance the server has already permanently refused.
      if (!this.noteClosure(refusal.evidence.closure)) {
        // I2-C — AND A FAILED WRITE IS SHARED, NOT ONLY DOWNGRADED.
        //
        // The downgrade is right and stays: nothing durable was recorded, so
        // no caller may re-price or mint a successor. But `unknown` alone is
        // a LOCAL message on ONE mount, and the record it leaves behind is
        // indistinguishable from an ordinary attempt — which is how the
        // sidebar went on offering a checkout for a quote the server had
        // permanently retired. THE SERVER FACT IS KNOWN HERE; only this
        // device's record of it is missing, which is exactly the
        // `unrecorded-closure` situation.
        if (current) {
          this.holdClosure({
            kind: 'unrecorded-closure',
            attempt: { key: current.key, scope: current.scope,
                       purchase: current.request.identity },
            orderId: issued?.orderId ?? current.command?.orderId ?? null,
            evidence: refusal.evidence,
          });
        }
        return { ...refusal, disposition: 'unknown' };
      }
      return refusal;
    }
    if (refusal.disposition === 'reprice') {
      // A FAILED DURABLE WRITE IS HONOURED: re-pricing on top of a record that
      // still names an unsettled command would leave one nobody resolves, so
      // the caller is told and must not send anything.
      if (!this.settleRefusedCommand()) {
        return { ...refusal, disposition: 'unknown' };
      }
    }
    return refusal;
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
        case 'accepted': {
          // E1 — AND THE SAME PAYLOAD MUST NOT ALSO SAY THE QUOTE IS DEAD.
          //
          // The `not-accepted` branch below already consults the closure;
          // this one returned before looking, so an ACCEPTED-AND-CLOSED
          // projection was silently reduced to its acceptance half — the
          // basket cleared and the record deleted on a response the server
          // has no coherent way to produce.
          //
          // `closureAsserted` rather than "is it usable": the question here
          // is whether the server said anything at all under `quote_closure`,
          // and a malformed row beside an acceptance is no more coherent than
          // a valid one. The expected reference is deliberately NOT supplied
          // — ANY closure on an accepted order is the contradiction, not just
          // one naming this quote.
          const beside = this.publishedClosure(order, pending, null);
          if (closureAsserted(beside)) {
            return { kind: 'inconsistent', order, correlation,
                     evidence: beside };
          }
          return { kind: 'accepted', order, correlation };
        }
        case 'not-accepted':
          // C1 — A DEFINITIVE DRAFT IS NOT NECESSARILY A RE-SUBMITTABLE ONE.
          //
          // `not_accepted` is proof the acceptance did not commit, and D04
          // rightly re-sends the recorded command on it. But the same read
          // can ALSO carry the server's durable statement that this order's
          // quote was retired — which is exactly what the level-2 projection
          // exists to publish, for exactly the client that lost the refusal
          // announcing it. Re-sending there is a dead end by construction:
          // the server refuses identically, the refusal files as unknown,
          // and Retry comes back here.
          //
          // ACCEPTANCE IS RESOLVED FIRST, and that ordering is the contract
          // rather than an accident of the switch: an order the server
          // accepted stays accepted whatever a closure beside it says, so the
          // closure is consulted only on the one verdict that has ruled
          // acceptance OUT.
          return this.closedOr(
            { kind: 'draft', order, correlation }, order, pending,
            correlation);
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
        || this.demonstratedProtocol(pending) >= CHECKOUT_PROTOCOL_CORRELATED) {
      return { kind: 'uncorrelated', order };
    }

    // BELOW LEVEL 3. `accepted: true` is still definitive — the server only
    // sets it from a durable evidence row. `accepted: false` is the ambiguous
    // one: at level 2 a genuine draft and an acceptance that predates the
    // evidence table read identically, and the server's own docstring says so.
    if (order.accepted === true) {
      // E1 — AND THE CONTRADICTION GATE REACHES THIS ACCEPTED PATH TOO.
      //
      // The level-3 branch above refuses an accepted-AND-closed projection;
      // this one returned before looking, so the same payload announced the
      // acceptance, cleared the basket and deleted the record. The two levels
      // are INDEPENDENT by design — `quote_protocol` says whether closures
      // are published and `checkout_protocol` whether the correlated
      // projection is — so a server that publishes a closure while answering
      // below level 3 is exactly the shape this gate exists for, and a gate
      // applied to one of two accepted returns is not a gate (Codex P2 on
      // PR #676, valid).
      //
      // `closureAsserted`, not "is it usable": ANY closure beside an
      // acceptance is the contradiction, so no expected reference is
      // supplied and a malformed row counts as much as a valid one.
      const beside = this.publishedClosure(order, pending, null);
      if (closureAsserted(beside)) {
        return { kind: 'inconsistent', order, correlation: null,
                 evidence: beside };
      }
      return { kind: 'accepted', order, correlation: null };
    }
    if (pending.command === null) {
      // THIS CLIENT'S OWN DURABLE RECORD RESOLVES THE AMBIGUITY, without
      // inferring anything from the server: it never issued an acceptance for
      // this key, so there is no acceptance for the server to have lost track
      // of, and the order can only be the draft that initiate created.
      //
      // C1 APPLIES HERE TOO. A commandless draft whose quote the server
      // retired is just as unacceptable as one whose acceptance was lost —
      // the diner would press Checkout, replay the retired order under the
      // same key and be handed a review sheet for a quote that can never be
      // paid. The level gate inside `readPublishedClosure` is what keeps this
      // silent against a server that has not promised to publish closures.
      return this.closedOr(
        { kind: 'draft', order, correlation: null }, order, pending, null);
    }
    // An acceptance WAS issued and this server cannot say whether it landed.
    // Unresolved, and reported as such rather than guessed either way.
    return { kind: 'unsupported', protocol: protocolLevel(order) };
  }

  /**
   * C1 — PROMOTE A DRAFT VERDICT TO `closed` WHEN THE READ PUBLISHES A
   * VALIDATED CLOSURE FOR IT, otherwise hand back the verdict unchanged.
   *
   * ONE PLACE, TWO CALLERS, and it has to be: the level-3 `not-accepted`
   * branch and the level-2 commandless-draft fallback are the same situation
   * reached through different evidence about the ACCEPTANCE, and a closure is
   * equally decisive in both. Two copies would disagree on whichever the next
   * change touched.
   *
   * The closure is validated against the reference this client SUBMITTED when
   * it has one: a closure naming a different quote is a statement about
   * something else and must not retire this attempt.
   */
  private closedOr(
    fallback: RecoveryOutcome, order: any, pending: CheckoutRecord,
    correlation: CheckoutCorrelation | null,
  ): RecoveryOutcome {
    const evidence = this.publishedClosure(
      order, pending, pending.command?.quoteRef ?? null);
    if (evidence.kind === 'closure') {
      return { kind: 'closed', order, correlation, closure: evidence.closure };
    }
    // E1 — ASSERTED BUT UNUSABLE IS NOT ABSENT, AND THIS IS WHERE THAT WAS
    // LOST. Both non-`closure` kinds fell through to `fallback`, which on
    // every caller is `draft` — and `draft` is proof of non-execution, so
    // `replayIssuedCommand` re-sends the acceptance for a quote the server
    // may already have retired. That is the refusal/retry loop this change
    // exists to remove, reintroduced by the one branch that did not
    // distinguish the two (Codex P2 on PR #676, valid).
    //
    // The rule is E1's own: a malformed, unsupported or wrong-reference
    // closure is never permission to treat the quote as open, resend an
    // acceptance, discard evidence or create another intent. The last usable
    // attempt is KEPT and an actionable unresolved state is surfaced.
    if (closureAsserted(evidence)) {
      return { kind: 'closure-unreadable', order, correlation, evidence };
    }
    return fallback;
  }

  /**
   * E1 — ONE READING OF A PUBLISHED CLOSURE, WITH THIS ATTEMPT'S DEMONSTRATED
   * D06 LEVEL SUPPLIED.
   *
   * `readPublishedClosure` gates on the level the PAYLOAD states, which is
   * right for a first answer and wrong for a later one: a server that
   * published `quote_protocol: 2` for this attempt and then answers without
   * it has not become an older server, and reading its silence as "no
   * closure" is the convenient half. The level is read LIVE, monotonically,
   * for the same key; the operation's identity stays as captured.
   */
  private publishedClosure(
    order: any, pending: CheckoutRecord, quoteRef: string | null,
  ): ClosureEvidence {
    return readPublishedClosure(
      order, { quoteRef }, this.demonstratedQuoteProtocol(pending));
  }

  /**
   * The highest D06 level this server has stated for THIS attempt.
   *
   * The `demonstratedProtocol` split, applied to the other level: only the
   * CAPABILITY is read live, and only for the same key. A record replaced by
   * a different key describes a different operation and says nothing here.
   */
  private demonstratedQuoteProtocol(pending: CheckoutRecord): number {
    const now = this.record();
    return now && now.key === pending.key
      ? Math.max(pending.quoteProtocol, now.quoteProtocol)
      : pending.quoteProtocol;
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
      // ABSENT MEANS "NOT A RENEWAL", which is what every record written
      // before G3b is. It is provenance, so an unreadable value is simply
      // absent rather than `degraded`: nothing is decided from it.
      replaces: typeof value['replaces'] === 'string' && value['replaces']
        ? (value['replaces'] as string) : null,
      // ABSENT MEANS "NOTHING DEMONSTRATED", which is what every record written
      // before G4 carries and what a pre-D06 server would leave.
      quoteProtocol: typeof value['quoteProtocol'] === 'number'
        && Number.isInteger(value['quoteProtocol'])
        && value['quoteProtocol'] > 0
        ? (value['quoteProtocol'] as number) : 0,
      // C1/E1 — CARRIED VERBATIM, INTERPRETED NOWHERE BUT `readRecordClosure`.
      // Absent means "not known to be retired", which is what every record
      // written before this change carries and what every live attempt
      // carries. A value this build cannot act on is NOT nulled here: doing so
      // erased it on the next write, and an unusable closure is a reason to
      // offer manual recovery rather than a reason to re-price. It is
      // deliberately NOT `degraded`: that flag is about whether an ACCEPTANCE
      // may be outstanding, which a closure says nothing about.
      closure: value['closure'] ?? null,
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
      // A D04/D record predates renewals, so it replaces nothing.
      replaces: null,
      // and predates the D06 level memory, so nothing is claimed.
      quoteProtocol: 0,
      // and predates closures entirely, so nothing is known about its quote.
      closure: null,
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
      // C1/C2 — BOTH LEVELS AND THE CLOSURE ARE READ-BACK VERIFIED.
      // `quoteProtocol` decides whether an uncorrelated enquiry answer is
      // honoured or refused, and `closure` decides whether a renewal may be
      // minted at all; a store that accepted the write and kept the previous
      // value would have reported success on both, which is the exact failure
      // Gate C's fingerprint exists to catch.
      record.quoteProtocol,
      // E1 — DIGESTED THROUGH THE READING, NEVER OFF THE RAW OBJECT. A raw
      // `JSON.stringify` would make the digest depend on key order, which is
      // not something either side of a storage round trip promises; and an
      // unusable closure must still be verified, because "a closure was
      // asserted and this build cannot act on it" is exactly a fact a later
      // consumer reads.
      this.closureDigest(record),
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
