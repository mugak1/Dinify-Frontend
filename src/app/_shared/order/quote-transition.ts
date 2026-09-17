/**
 * THE ONE READING OF A D06 QUOTE REFUSAL, and of the deadline the server
 * publishes for a saved quote.
 *
 * WHY IT IS SHARED. `BasketBodyComponent` is mounted TWICE on desktop — the
 * routed page and the sidebar beside the router outlet — and both handle
 * checkout failures. Before D06 each refusal was matched by hand at the point
 * it arrived (`reason === 'legacy_pricing_version'`, `reason ===
 * 'quote_ref_stale'`), which is exactly how two mounts end up disagreeing about
 * whether a quote is finished: one re-prices, the other offers Retry, and the
 * diner sees whichever component they happen to be looking at.
 *
 * THE DISTINCTION THAT MATTERS IS NOT "which error" BUT "is this quote
 * finished". A restaurant that paused and a table taken out of service are
 * TRANSIENT: the same attempt, with the same quote and the same idempotency
 * key, may succeed in a minute, and re-pricing would throw away a perfectly
 * good quote and ask the diner to agree to the same amount again. An expired
 * quote and a purchase that changed are TERMINAL: the server has recorded that
 * this quote may never be accepted, so nothing but a NEW quote can succeed, and
 * offering Retry is a dead end. Getting that backwards in either direction is a
 * real failure, which is why the classification lives in one place with the
 * codes it classifies.
 *
 * WHAT THE CLIENT MUST NOT DO WITH IT.
 *
 *  - It must not decide TERMINAL for itself from `expires_at`. The deadline is
 *    advisory: the server samples its clock after its locks and that decision is
 *    the one that counts. A client may stop offering checkout when the deadline
 *    passes; it must not conclude the quote was retired, because it was not —
 *    only an attempt (or `retire-quote`) retires one.
 *  - It must not treat a live deadline as a reservation. The dish can sell out
 *    inside the window; `purchase_needs_review` is what says so.
 *  - It must not infer the server supports any of this from the presence of a
 *    `quote_policy` object. `quote_protocol` is the statement, an absent value
 *    is level 0, and level 0 promises nothing — in particular it does NOT mean
 *    quotes never expire here.
 *
 * The reason codes are the BACKEND's and are pinned against it by
 * `_security/tenant-isolation-closure.spec.ts`; both repositories assert the
 * same strings so either side drifting fails its own gate.
 */

/** The server's D06 quote-policy capability level, as published on an order read. */
export const REQUIRED_QUOTE_PROTOCOL = 1;

/**
 * TRANSIENT — the quote survives, and the SAME attempt may succeed later. Every
 * one of these is a statement about the restaurant or the table, never about
 * the purchase, so none of them retires anything.
 */
export const TRANSIENT_REASONS: readonly string[] = [
  'restaurant_paused',
  'restaurant_unavailable',
  'table_ordering_unavailable',
  'table_unavailable',
];

/**
 * TERMINAL — the server has recorded that this quote may never be accepted. A
 * new quote is the only way forward; a retry of the same command cannot work.
 */
export const TERMINAL_REASONS: readonly string[] = [
  'quote_expired',
  'purchase_needs_review',
  'quote_closed',
];

/**
 * REPRICE — the quote cannot be accepted as it stands, but the server has NOT
 * retired it. Kept apart from TERMINAL deliberately: the client's next step is
 * the same (get a fresh quote), and what differs is what may be SAID. Telling a
 * diner their order "can no longer be placed" when the server only failed to
 * establish how old it is would be a claim nobody made.
 */
export const REPRICE_REASONS: readonly string[] = [
  'quote_unverifiable',
  'quote_ref_stale',
  'legacy_pricing_version',
];

export type QuoteDisposition = 'transient' | 'terminal' | 'reprice' | 'unknown';

export interface QuotePolicy {
  readonly version: number;
  readonly status: 'live' | 'expired' | 'unavailable';
  readonly expiresAt: string | null;
}

export interface QuoteClosure {
  readonly closedAt: string | null;
  readonly reason: string;
  readonly quoteRef: string;
  readonly policyVersion: number;
}

export interface QuoteRefusal {
  readonly reason: string;
  readonly disposition: QuoteDisposition;
  /** The server recorded a durable closure. Never inferred — read, or false. */
  readonly retired: boolean;
  readonly policy: QuotePolicy | null;
  readonly closure: QuoteClosure | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/** The refusal body, wherever the interceptor left it. */
function body(error: any): any {
  if (!error || typeof error !== 'object') { return null; }
  // `ErrorInterceptor` forwards an `orders/submit/` 400 carrying a `reason` as
  // the STRUCTURED body; a raw `HttpErrorResponse` keeps it under `.error`.
  // Reading both is what lets this work from either side of that forward rather
  // than depending on which one happened to fire.
  if (text(error.reason)) { return error; }
  if (error.error && typeof error.error === 'object'
      && text(error.error.reason)) { return error.error; }
  return null;
}

export function readQuotePolicy(source: any): QuotePolicy | null {
  const raw = source?.quote_policy;
  if (!raw || typeof raw !== 'object') { return null; }
  const version = whole(raw.version);
  const status = text(raw.status);
  if (version === null) { return null; }
  if (status !== 'live' && status !== 'expired' && status !== 'unavailable') {
    return null;
  }
  return { version, status, expiresAt: text(raw.expires_at) };
}

function readClosure(source: any): QuoteClosure | null {
  const raw = source?.quote_closure;
  if (!raw || typeof raw !== 'object') { return null; }
  const reason = text(raw.reason);
  const quoteRef = text(raw.quote_ref);
  const policyVersion = whole(raw.policy_version);
  if (reason === null || quoteRef === null || policyVersion === null) {
    return null;
  }
  return { closedAt: text(raw.closed_at), reason, quoteRef, policyVersion };
}

/**
 * Classify a refusal, or `null` when it is not one this vocabulary covers.
 *
 * `unknown` is a REAL answer and not a failure to parse: a reason this build has
 * never heard of must not be guessed into either bucket. A newer server is
 * entitled to add one, and treating it as transient would loop a dead quote
 * while treating it as terminal would discard a live one.
 */
export function readQuoteRefusal(error: any): QuoteRefusal | null {
  const found = body(error);
  const reason = text(found?.reason);
  if (reason === null) { return null; }

  let disposition: QuoteDisposition = 'unknown';
  if (TRANSIENT_REASONS.includes(reason)) { disposition = 'transient'; }
  else if (TERMINAL_REASONS.includes(reason)) { disposition = 'terminal'; }
  else if (REPRICE_REASONS.includes(reason)) { disposition = 'reprice'; }

  const closure = readClosure(found);
  return {
    reason,
    disposition,
    // READ, never inferred from the disposition: `quote_unverifiable` needs a
    // fresh quote and retires nothing, and a server that refused without
    // recording one has said so by omitting the object.
    retired: closure !== null,
    policy: readQuotePolicy(found),
    closure,
  };
}

/**
 * The published deadline for a saved quote, or `null` when this server has not
 * promised one.
 *
 * GATED ON THE STATED LEVEL. An absent or lower `quote_protocol` means the
 * server has said nothing, and a `quote_policy` object appearing beside it does
 * not upgrade that — the level is the promise, the object is data.
 */
export function readPublishedPolicy(orderDetails: any): QuotePolicy | null {
  const level = whole(orderDetails?.quote_protocol);
  if (level === null || level < REQUIRED_QUOTE_PROTOCOL) { return null; }
  return readQuotePolicy(orderDetails);
}

/**
 * Has the published deadline passed at `now`?
 *
 * ADVISORY ONLY. A `true` here means "stop offering checkout and get a fresh
 * quote", never "the quote was retired" — retirement is a server fact and this
 * function cannot observe one. `false` for a policy with no deadline, because
 * an unreadable anchor is not a statement that the quote is dead.
 */
export function quoteDeadlinePassed(
  policy: QuotePolicy | null, now: number): boolean {
  if (!policy || policy.expiresAt === null) { return false; }
  const deadline = Date.parse(policy.expiresAt);
  if (Number.isNaN(deadline)) { return false; }
  // `>=` mirrors the server, where the exact deadline instant is expired.
  return now >= deadline;
}
