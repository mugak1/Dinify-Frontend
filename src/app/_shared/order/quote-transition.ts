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
 * The level at which a server publishes a RETIRED quote on the order read
 * (backend D06/G3a). Level 1 enforces the lifetime and retires quotes durably
 * but announces a closure only on the refusal that created it — the one
 * response a client can lose — so at level 1 an absent `quote_closure` on a
 * read says NOTHING, and must never be read as "not closed".
 *
 * A SEPARATE CONSTANT FROM `REQUIRED_QUOTE_PROTOCOL`, not a bump of it: the
 * deadline is still published at 1 and the client still consults it there.
 * Folding the two would silently stop a level-1 server's deadline being read.
 */
export const REQUIRED_CLOSURE_PROTOCOL = 2;

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

/**
 * May this build make a POLICY-DERIVED claim about a closure?
 *
 * Retirement itself is version-independent, so this never decides whether a
 * quote is finished — only whether the client may say WHY in the policy's own
 * terms ("it expired") rather than in the neutral ones.
 */
export function policyVersionSupported(closure: QuoteClosure): boolean {
  return SUPPORTED_QUOTE_POLICY_VERSIONS.includes(closure.policyVersion);
}

export type QuoteDisposition = 'transient' | 'terminal' | 'reprice' | 'unknown';

export interface QuotePolicy {
  readonly version: number;
  readonly status: 'live' | 'expired' | 'unavailable';
  readonly expiresAt: string | null;
}

export interface QuoteClosure {
  /** A real instant. `readClosureEvidence` refuses a closure without one, so
   *  every consumer may rely on it rather than branching on absence. */
  readonly closedAt: string;
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
  /**
   * C2 — WHY THERE IS NO CLOSURE, when there is none.
   *
   * `closure` alone cannot distinguish "this server said nothing" from "this
   * server said something this build refuses to act on", and the two call for
   * opposite handling: the first is an older or non-retiring answer, the
   * second is a broken promise. Every TERMINAL reason this backend emits
   * carries a closure (`_TerminalQuoteOutcome._metadata` attaches one whenever
   * it wrote one, and the two reasons that reach a client without one are
   * classified REPRICE here, not TERMINAL), so a terminal reason with no
   * readable closure is a contradiction rather than an older shape.
   */
  readonly evidence: ClosureEvidence;
}

/**
 * THE NARROW VOCABULARY A CLOSURE MAY BE RECORDED UNDER.
 *
 * The backend guards the same two strings with a `CheckConstraint` on
 * `OrderQuoteClosure.reason`, precisely so a future caller cannot widen them:
 * a pause, a menu-only table, a lost response or a permission failure says
 * "not now", never "finished". A value outside this set is therefore not a
 * closure this build has any business acting on.
 */
export const CLOSURE_REASONS: readonly string[] = [
  'quote_expired',
  'purchase_needs_review',
];

/**
 * The quote-policy versions whose closures this build can reason about.
 *
 * The backend states that the version is FROZEN and that a future change of
 * duration is a NEW version rather than an edit to this one — so an
 * unrecognised version is a real possibility rather than a corruption, and it
 * gets its own answer below rather than being silently accepted or refused.
 */
export const SUPPORTED_QUOTE_POLICY_VERSIONS: readonly number[] = [1];

/** Which part of a closure this build could not accept. Diagnostic only —
 *  no diner ever sees one, for the reason the refusal messages are uniform. */
export type ClosureDefect =
  | 'shape' | 'reason' | 'quote_ref' | 'closed_at' | 'policy_version'
  | 'other_quote';

/**
 * C2 — ONE READING OF A DURABLE CLOSURE, AND THREE DISTINGUISHABLE ANSWERS.
 *
 * `absent` and `malformed` are DIFFERENT FACTS and collapsing them is how a
 * broken server gets trusted — the same distinction this repo already draws
 * for `quote_total` and for D04's correlated projection. Absence may be an
 * older server, a quote that was never retired, or a level that promises
 * nothing; a malformed closure is a server that said something it could not
 * express, and acting on it would mean minting a replacement key on evidence
 * nobody can read.
 *
 * `policySupported` IS A FLAG ON ACCEPTED EVIDENCE RATHER THAN A FOURTH
 * ANSWER, and that is deliberate. RETIREMENT IS VERSION-INDEPENDENT: the
 * server recorded that this quote may never be accepted, and that is true
 * whatever rule produced it — so refusing an unrecognised version outright
 * would strand a diner against a future backend with no way forward, which is
 * the exact dead end this whole change exists to remove. What an unsupported
 * version does forfeit is any POLICY-DERIVED claim: the client may not say
 * "it expired" under a rule it does not know, and says the neutral sentence.
 */
export type ClosureEvidence =
  | { readonly kind: 'closure'; readonly closure: QuoteClosure;
      readonly policySupported: boolean }
  | { readonly kind: 'absent' }
  | { readonly kind: 'malformed'; readonly defect: ClosureDefect };

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

/** A timestamp that MEANS something — present, and a real instant. The
 *  column is NOT NULL on the server and its projection formats it directly,
 *  so a missing or unparseable one is a defect rather than an older shape. */
function moment(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) { return null; }
  return Number.isNaN(Date.parse(raw)) ? null : raw;
}

/**
 * Read a closure, saying exactly what it is or exactly why it is not one.
 *
 * `expected.quoteRef`, when given, is the reference THIS client is asking
 * about — the one it reviewed and submitted. A closure naming a different
 * reference is a statement about a different quote, and the CONTRADICTS rule
 * applies: it is refused rather than honoured. It is checked only when the
 * caller has one, because an authorized read with no issued command can
 * legitimately surface a closure minted elsewhere (the other mount, or
 * `retire-quote`) and there is no local reference to compare it against.
 */
export function readClosureEvidence(
  source: any,
  expected?: { readonly quoteRef?: string | null },
): ClosureEvidence {
  const raw = source?.quote_closure;
  if (raw === undefined || raw === null) { return { kind: 'absent' }; }
  if (typeof raw !== 'object') { return { kind: 'malformed', defect: 'shape' }; }
  // THE WIRE'S KEYS, mapped once. The validation below is shared with the
  // STORED form, which carries this module's own camelCase names — one rule,
  // two spellings, and a stored closure is therefore held to exactly the
  // standard the response it came from was.
  return validateClosure({
    closedAt: raw.closed_at,
    reason: raw.reason,
    quoteRef: raw.quote_ref,
    policyVersion: raw.policy_version,
  }, expected);
}

/**
 * The same contract, applied to a closure this client PERSISTED.
 *
 * A stored record is not more trustworthy than a response: it may have been
 * written by a build with a different idea of what a closure is, or edited, or
 * truncated. Sharing `validateClosure` is what makes that true rather than
 * merely intended — and the read-back verification on every durable write is
 * what caught the first version of this, which read the wire's snake_case keys
 * off a stored camelCase object and quietly returned `absent` for every
 * closure it had just written.
 */
export function readStoredClosureEvidence(value: unknown): ClosureEvidence {
  if (value === undefined || value === null) { return { kind: 'absent' }; }
  if (typeof value !== 'object') {
    return { kind: 'malformed', defect: 'shape' };
  }
  const raw = value as Record<string, unknown>;
  return validateClosure({
    closedAt: raw['closedAt'],
    reason: raw['reason'],
    quoteRef: raw['quoteRef'],
    policyVersion: raw['policyVersion'],
  });
}

function validateClosure(
  candidate: {
    closedAt: unknown; reason: unknown;
    quoteRef: unknown; policyVersion: unknown;
  },
  expected?: { readonly quoteRef?: string | null },
): ClosureEvidence {
  const reason = text(candidate.reason);
  if (reason === null || !CLOSURE_REASONS.includes(reason)) {
    return { kind: 'malformed', defect: 'reason' };
  }
  const quoteRef = text(candidate.quoteRef);
  if (quoteRef === null) {
    return { kind: 'malformed', defect: 'quote_ref' };
  }
  const closedAt = moment(candidate.closedAt);
  if (closedAt === null) {
    return { kind: 'malformed', defect: 'closed_at' };
  }
  const policyVersion = whole(candidate.policyVersion);
  if (policyVersion === null || policyVersion < 1) {
    return { kind: 'malformed', defect: 'policy_version' };
  }
  if (expected?.quoteRef && quoteRef !== expected.quoteRef) {
    return { kind: 'malformed', defect: 'other_quote' };
  }

  return {
    kind: 'closure',
    closure: { closedAt, reason, quoteRef, policyVersion },
    policySupported: SUPPORTED_QUOTE_POLICY_VERSIONS.includes(policyVersion),
  };
}

/**
 * Classify a refusal, or `null` when it is not one this vocabulary covers.
 *
 * `unknown` is a REAL answer and not a failure to parse: a reason this build has
 * never heard of must not be guessed into either bucket. A newer server is
 * entitled to add one, and treating it as transient would loop a dead quote
 * while treating it as terminal would discard a live one.
 */
export function readQuoteRefusal(
  error: any, expected?: { readonly quoteRef?: string | null },
): QuoteRefusal | null {
  const found = body(error);
  const reason = text(found?.reason);
  if (reason === null) { return null; }

  let disposition: QuoteDisposition = 'unknown';
  if (TRANSIENT_REASONS.includes(reason)) { disposition = 'transient'; }
  else if (TERMINAL_REASONS.includes(reason)) { disposition = 'terminal'; }
  else if (REPRICE_REASONS.includes(reason)) { disposition = 'reprice'; }

  const evidence = readClosureEvidence(found, expected);

  // C2 — A TERMINAL REASON IS ONLY TERMINAL WITH THE EVIDENCE BEHIND IT.
  //
  // TERMINAL means "the server RECORDED that this quote may never be
  // accepted", and every backend that can emit one of these reasons attaches
  // the closure it wrote: `quote_expired` and `purchase_needs_review` are
  // built by `_TerminalQuoteOutcome` only after `quote_closure.close`
  // returned a row, and `quote_closed` is the branch that found an existing
  // one. A refusal carrying the word and not the row is therefore a BROKEN
  // PROMISE, not an older shape — and the client acted on it: it settled the
  // issued command and minted a replacement key on a claim nobody could read.
  //
  // `unknown` is the honest answer and the safe one. Nothing is settled,
  // nothing is renewed, the diner is told, and the record survives — so the
  // authorized read (which publishes the closure at level 2, exactly for the
  // client that lost this response) can resolve it afterwards.
  if (disposition === 'terminal' && evidence.kind !== 'closure') {
    disposition = 'unknown';
  }

  const closure = evidence.kind === 'closure' ? evidence.closure : null;
  return {
    reason,
    disposition,
    // READ, never inferred from the disposition: `quote_unverifiable` needs a
    // fresh quote and retires nothing, and a server that refused without
    // recording one has said so by omitting the object.
    retired: closure !== null,
    policy: readQuotePolicy(found),
    closure,
    evidence,
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
 * The closure a server has PUBLISHED for a saved quote, or `null`.
 *
 * GATED ON THE STATED LEVEL, like the deadline beside it, and for a sharper
 * reason: this one is read as a VERDICT — it is what tells a client its key is
 * bound to an order that can never be accepted, so the client mints a new one.
 * An absent key from a server that has not said it publishes closures is
 * silence, not a negative, and treating silence as "still good" is the safe
 * direction: the client goes on using its key, and the server refuses the
 * acceptance if the quote really is retired.
 *
 * DELIBERATELY NOT the same gate as `readQuoteRefusal`'s closure, which is
 * UNGATED. That one arrives on the direct answer to a command the client
 * issued — the server put it there, in response to this request — while this
 * one is a projection on a read, whose availability is exactly what the level
 * states.
 */
export function readPublishedClosure(
  orderDetails: any, expected?: { readonly quoteRef?: string | null },
): ClosureEvidence {
  const level = whole(orderDetails?.quote_protocol);
  if (level === null || level < REQUIRED_CLOSURE_PROTOCOL) {
    // NOT `malformed`: a server that has not promised to publish closures has
    // said nothing at all, whatever keys happen to be beside the promise.
    return { kind: 'absent' };
  }
  return readClosureEvidence(orderDetails, expected);
}

/**
 * WHAT THE RETIRE ENQUIRY ANSWERED, once the answer is shown to be about what
 * was asked (D06 completion, G4).
 *
 * `still-valid` is the answer that leads to SUBMITTING an order, so it is the
 * one that most needs to be correlated — and it was the one with nothing to
 * correlate against until the backend began naming the enquiry back. D04 made
 * this discipline standard for acceptance answers; the enquiry was left out.
 *
 * THE CORRELATION RULE IS "CONTRADICTS", NOT "CONFIRMS". An answer that names a
 * DIFFERENT order or a different reference is refused: it is not about this
 * enquiry, whatever it says. An answer that names NEITHER is honoured, because
 * that is an older server answering the request it was sent on the connection
 * it was sent on — refusing it would leave every pre-G4 backend unable to
 * complete a checkout whose deadline had passed, which is a worse failure than
 * the one being guarded against.
 *
 * `unreadable` covers an outcome this build does not know, an answer about
 * something else, and (C2) a `quote_closed` whose closure cannot be read. It is
 * a REAL answer, not a parse failure: the quote is not known to be dead and not
 * known to be good, so nothing may be submitted and nothing may be discarded.
 * Its `defect` is DIAGNOSTIC — the diner sees one sentence, because a
 * per-reason message would be an oracle over the response.
 */
export type QuoteAnswer =
  | { readonly kind: 'still-valid' }
  | { readonly kind: 'retired'; readonly closure: QuoteClosure;
      readonly policySupported: boolean }
  | { readonly kind: 'unreadable'; readonly defect: string };

export function readQuoteAnswer(
  response: any,
  asked: { readonly order: string; readonly quoteRef: string },
  demonstrated: number,
): QuoteAnswer {
  // THE RESPONSE ITSELF, not `body()`. That helper finds a REFUSAL body and
  // keys on a `reason`, which a successful enquiry does not carry — reading a
  // 200 through it would make every `quote_still_valid` unreadable. A success
  // and a refusal are different shapes arriving on different callbacks, and
  // this is the reader for the first.
  const found = response && typeof response === 'object' ? response : null;
  if (!found) { return { kind: 'unreadable', defect: 'shape' }; }

  const namedOrder = text(found.order);
  if (namedOrder !== null && namedOrder !== asked.order) {
    return { kind: 'unreadable', defect: 'order' };
  }
  const namedRef = text(found.quote_ref);
  if (namedRef !== null && namedRef !== asked.quoteRef) {
    return { kind: 'unreadable', defect: 'quote_ref' };
  }

  const outcome = text(found.outcome);
  if (outcome === null) { return { kind: 'unreadable', defect: 'outcome' }; }

  // C2 — AN OMITTED CORRELATION IS OLDER-SERVER COMPATIBILITY ONLY WHILE THIS
  // SERVER HAS NOT DEMONSTRATED BETTER.
  //
  // The G4 correlation (`order`, `quote_ref` and `quote_protocol` on every
  // answer that states an outcome or a reason) and `QUOTE_PROTOCOL` 2 shipped
  // in ONE backend change and deployed together, so there is no level-2 server
  // that answers without naming what it is answering about. Honouring an
  // uncorrelated answer from one that has proved it is level 2 is therefore
  // trusting a BROKEN response under a rule written for an OLD one — and this
  // is the answer that leads to submitting an order.
  //
  // `demonstrated` is the MONOTONIC level remembered for this attempt, not the
  // level this payload happens to state: a capability does not un-demonstrate
  // itself, and reading it off the response would let the broken answer excuse
  // itself by omitting the level too.
  if (demonstrated >= REQUIRED_CLOSURE_PROTOCOL
      && namedOrder === null && namedRef === null) {
    return { kind: 'unreadable', defect: 'uncorrelated' };
  }

  if (outcome === 'quote_still_valid') { return { kind: 'still-valid' }; }
  if (outcome === 'quote_closed' || outcome === 'quote_already_closed') {
    // READ, NEVER INFERRED FROM THE WORD. The route claims these only when it
    // actually wrote or found a closure and attaches the row beside them, so an
    // answer carrying the word and not the row is a broken promise — and acting
    // on it would retire a quote on evidence nobody can read.
    const evidence = readClosureEvidence(found, { quoteRef: asked.quoteRef });
    if (evidence.kind !== 'closure') {
      return {
        kind: 'unreadable',
        defect: evidence.kind === 'absent' ? 'closure_absent'
          : `closure_${evidence.defect}`,
      };
    }
    return {
      kind: 'retired',
      closure: evidence.closure,
      policySupported: evidence.policySupported,
    };
  }
  return { kind: 'unreadable', defect: 'outcome' };
}

/**
 * The D06 level a response states, or `0` when it states none.
 *
 * `0` PROMISES NOTHING and is not "level 1": a server that has not said cannot
 * be assumed to enforce a lifetime, publish a closure, or offer the enquiry.
 */
export function quoteProtocolLevel(source: any): number {
  return whole(source?.quote_protocol) ?? 0;
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
