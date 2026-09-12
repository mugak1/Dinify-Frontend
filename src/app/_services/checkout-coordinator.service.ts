import { Injectable, computed, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, timeout } from 'rxjs/operators';

import { ApiService } from './api.service';
import { SessionStorageService } from './storage/session-storage.service';

/**
 * D04/D — ONE owner of the in-progress checkout, shared by every surface that
 * can start one.
 *
 * THREE THINGS WERE MISSING ON THIS SIDE, and the backend guarantees cannot
 * reach a diner without them.
 *
 * 1. THE INTENT KEY LIVED ONLY IN MEMORY. `BasketService.clientOrderId` was a
 *    private field, so a page reload — a diner tapping refresh on a spinner
 *    that will not resolve, the browser reclaiming a backgrounded tab, a
 *    crash — dropped it and the next attempt minted a NEW one. The server's
 *    entire idempotency guarantee was bypassed by the single most likely
 *    recovery action a person takes. The key is now WRITTEN BEFORE THE REQUEST
 *    IS SENT: minting it and sending it in the same expression is a promise
 *    that cannot survive the process, so the write happens first or the key is
 *    not used.
 *
 * 2. THERE WAS NO SINGLE FLIGHT. `BasketBodyComponent` is mounted TWICE on
 *    desktop — the routed basket page and the sidebar that lives beside the
 *    router outlet — and `placingOrder` was a field on each instance. Two
 *    checkouts could therefore run at once, each believing it was the only
 *    one. The server refuses the second (same key, same purchase → the first
 *    order; different purchase → a conflict), so this is not the last line of
 *    defence — but a client that cannot tell it is already checking out shows
 *    the diner two live buttons and cannot present one coherent outcome.
 *
 * 3. A LOST RESPONSE WAS UNRECOVERABLE IN THE UI. The client had no way to ask
 *    "what did the key I already hold resolve to?", so an interrupted checkout
 *    ended at a dead spinner and the diner's only option was to try again and
 *    hope. `recover()` resolves the persisted key against the server's own
 *    read.
 *
 * WHAT THIS DOES NOT PROMISE. Not exactly-once delivery: a response can still
 * be lost, and the whole design is about making the RETRY safe rather than
 * making loss impossible. Not payment idempotency — nothing here touches
 * money. And it does not decide what a checkout MEANS: the basket, the quote
 * and every refusal stay where they are.
 */

/** The stage a persisted attempt had reached when it was last written. */
export type CheckoutPhase = 'pricing' | 'reviewing' | 'submitting';

/** What a persisted attempt records. Deliberately small: an id, a stage and
 *  what it was bound to — never basket contents, never an amount, never a
 *  session token. It is written to sessionStorage, which is readable by any
 *  script on the origin, so it carries nothing that is not already an opaque
 *  handle. */
export interface CheckoutAttempt {
  readonly key: string;
  readonly phase: CheckoutPhase;
  readonly orderId: string | null;
  readonly quoteRef: string | null;
  /** WHAT the attempt was for, derived from the basket's CONTENTS — never a
   *  process-local counter, which a reload resets while the contents
   *  survive. See `BasketService.contentIdentity`. */
  readonly basket: string;
  /** WHERE it was for: the restaurant and table it was priced against. */
  readonly context: string;
  readonly startedAt: number;
}

/**
 * What resolving a persisted key found. A DISCRIMINATED UNION rather than a
 * nullable order plus a flag: every caller is then forced to say what it does
 * about a server that could not be reached, which is precisely the case a
 * boolean invites skipping.
 */
export type RecoveryOutcome =
  /** Nothing was in flight — the ordinary case on any normal page load. */
  | { readonly kind: 'none' }
  /** The key resolved, and the server says the order was ACCEPTED. */
  | { readonly kind: 'accepted'; readonly order: any }
  /** The key resolved to a draft the server has NOT accepted. */
  | { readonly kind: 'draft'; readonly order: any }
  /** The key resolved to nothing: the attempt never reached the server, or it
   *  belongs to a table this session is not on. Safe to start again. */
  | { readonly kind: 'absent' }
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
  /** sessionStorage, not localStorage, and the amendment's choice: a checkout
   *  belongs to the tab and the table session that started it. A key surviving
   *  into a different tab would offer one diner another's attempt. */
  static readonly ATTEMPT_KEY = 'diner.checkout.attempt';

  /**
   * THE CEILING ON AN UNRESOLVED REQUEST. Without one, a connection that is
   * open but dead leaves the CTA spinning for as long as the browser keeps the
   * socket — indefinitely, on a mobile network that has silently gone away —
   * and the diner's only escape is the reload that used to lose the key.
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
  ) {}

  // -- the intent key ----------------------------------------------------

  /**
   * The key for this checkout, PERSISTED BEFORE IT IS RETURNED.
   *
   * The order of those two operations is the whole point. Minting a key and
   * putting it in a request body is a promise to treat the retry as the same
   * attempt, and a promise held only in memory does not survive the thing it
   * is supposed to protect against.
   */
  intentKey(basket: string, context: string): string {
    const existing = this.attempt();
    if (existing && existing.context === context && existing.basket === basket) {
      return existing.key;
    }
    const key = this.mintKey();
    this.write({
      key,
      phase: 'pricing',
      orderId: null,
      quoteRef: null,
      basket,
      context,
      startedAt: Date.now(),
    });
    return key;
  }

  /** The persisted attempt, or null. Tolerates a malformed or partial record
   *  rather than throwing: storage is shared with the whole origin and a
   *  checkout must not be blocked by something else's bad write. */
  attempt(): CheckoutAttempt | null {
    let raw: unknown;
    try {
      raw = this.storage.getItem(CheckoutCoordinatorService.ATTEMPT_KEY);
    } catch {
      return null;
    }
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as Partial<CheckoutAttempt>;
    if (typeof value.key !== 'string' || !value.key) return null;
    if (value.phase !== 'pricing' && value.phase !== 'reviewing'
        && value.phase !== 'submitting') {
      return null;
    }
    return {
      key: value.key,
      phase: value.phase,
      orderId: typeof value.orderId === 'string' ? value.orderId : null,
      quoteRef: typeof value.quoteRef === 'string' ? value.quoteRef : null,
      // A record whose basket identity is unreadable can never MATCH, so it
      // mints a fresh key rather than being adopted — the conservative
      // direction: a key nobody can tie to this basket is not this basket's.
      basket: typeof value.basket === 'string' ? value.basket : '\u0000',
      context: typeof value.context === 'string' ? value.context : '\u0000',
      startedAt: typeof value.startedAt === 'number' ? value.startedAt : 0,
    };
  }

  /** Record how far the attempt has got, so a reload knows what to ask about.
   *  A no-op when nothing is persisted — this never RESURRECTS an attempt the
   *  caller has already finished. */
  notePhase(phase: CheckoutPhase, details?: {
    orderId?: string | null; quoteRef?: string | null;
  }): void {
    const current = this.attempt();
    if (!current) return;
    this.write({
      ...current,
      phase,
      orderId: details?.orderId !== undefined
        ? details.orderId : current.orderId,
      quoteRef: details?.quoteRef !== undefined
        ? details.quoteRef : current.quoteRef,
    });
  }

  /**
   * Forget this attempt.
   *
   * TARGETED: it removes ONE key and never clears storage, because the diner
   * session capability and the basket live in the same store and a blanket
   * wipe here would sign the diner out of their own table to tidy up a
   * checkout. Called on a DEFINITIVE outcome only — a completed order, or a
   * basket change that makes this a different purchase. Never on a timeout, a
   * lost response or an ambiguous failure: those are exactly when the key must
   * survive.
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
   * Ask the server what the persisted key resolved to.
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
    const pending = this.attempt();
    if (!pending) return of<RecoveryOutcome>({ kind: 'none' });

    return this.bounded(
      this.api.get<any>(
        null, 'orders/journey/order-details/', { intent: pending.key },
      ) as Observable<any>,
    ).pipe(
      map((response: any): RecoveryOutcome => {
        const order = response?.data;
        if (!order) return { kind: 'unknown' };
        return order.accepted
          ? { kind: 'accepted', order }
          : { kind: 'draft', order };
      }),
      catchError((error: unknown) =>
        of<RecoveryOutcome>(
          this.isNotFound(error) ? { kind: 'absent' } : { kind: 'unknown' },
        ),
      ),
    );
  }

  /**
   * Did the server say this key resolves to nothing?
   *
   * A 404 from this read is the ONE answer that means "no such order on this
   * table", and it is non-disclosing by design — a foreign, unknown and
   * malformed key are indistinguishable. Everything else (offline, 5xx, a
   * timeout, the `ErrorInterceptor`'s collapsed string form) is not an answer
   * at all.
   */
  private isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    return (error as { status?: number }).status === 404;
  }

  //
  // WHY THAT READS A STATUS AND NOT A MESSAGE. `ErrorInterceptor` collapses
  // an ordinary failure to `err.error.message || err.statusText`, a bare
  // string — so without the narrow carve-out it now makes for this exact
  // request, a definitive 404 arrived here indistinguishable from a timeout
  // and was classified `unknown`, retaining a key the server had just said
  // resolves to nothing. Matching on the human sentence instead would be the
  // brittleness the reason codes elsewhere in this repo exist to remove.
  // A non-object still falls through to `unknown`, which is the safe
  // direction: an unreachable server is never evidence that nothing
  // happened.
  //

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

  private write(attempt: CheckoutAttempt): void {
    try {
      this.storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY, attempt);
    } catch {
      // A storage that refuses the write (private mode, quota) means this
      // checkout has no durable key. That is a WEAKER guarantee, not a
      // failure: the request still carries the in-request key and the server
      // still binds it, so a retry within the page's lifetime is still safe.
      // Failing the checkout here would trade a recoverable weakness for a
      // certain outage.
    }
  }

  /** Unused by production code; the specs reset the singleton between cases. */
  resetForTest(): void {
    this._flight.set(null);
    this.nextFlightId = 1;
  }
}
