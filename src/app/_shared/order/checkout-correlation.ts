/**
 * D04 — reading the server's correlated checkout answer, and checking it is
 * about the command this client issued.
 *
 * WHY THIS EXISTS AS ONE MODULE. The same answer arrives on two surfaces —
 * the `orders/submit/` reply and the diner's `order-details/` read — and two
 * places in this client act on it: the coordinator's recovery and the submit
 * handler that decides whether to announce success. Four readings of one
 * payload is four chances to disagree about whether an order was accepted,
 * which is the one question a checkout must not get two answers to. The
 * backend states the same rule for the same reason: `acceptance_result` is a
 * single projection consumed by both of its surfaces.
 *
 * WHAT IT IS NOT. Not a schema framework and not a second pricing
 * implementation — it validates the correlation envelope and nothing else.
 * The quote, the total and every monetary rule stay in `quote-review.ts`.
 */

/** The key is bound to the purchase; a creation retry is safe. */
export const CHECKOUT_PROTOCOL_BINDING = 1;

/** Plus durable acceptance evidence and a scoped read by intent key. */
export const CHECKOUT_PROTOCOL_RECOVERABLE = 2;

/**
 * Plus a correlated projection on both surfaces: which order, which key,
 * which scope, a three-state acceptance verdict, and the ORIGINAL accepted
 * reference and moment.
 *
 * A NEW LEVEL, NOT A NEW MEANING FOR 2 — the server raised it the same way,
 * and this client must gate on it rather than assume. A level-2 server is
 * real and deployable: it answers every request this client makes, it simply
 * cannot separate a draft from an acceptance it has no record of.
 */
export const CHECKOUT_PROTOCOL_CORRELATED = 3;

/**
 * THE THREE-STATE VERDICT, and why two of them are not the same.
 *
 *  `accepted`             the submission landed and the server holds the
 *                         evidence: when, and against which quote.
 *  `not_accepted`         the order is still a DRAFT. Definitive. It may be
 *                         reviewed and it may be accepted.
 *  `evidence_unavailable` the order is NOT a draft, so a submission did land,
 *                         but nothing records it — an order accepted before
 *                         the evidence table existed. IT MUST NEVER BE
 *                         ACCEPTED AGAIN. At protocol 2 this case and a
 *                         genuine draft both read `accepted: false`, which is
 *                         precisely why that boolean cannot be trusted to
 *                         decide whether to submit.
 */
export type AcceptanceState =
  | 'accepted' | 'not_accepted' | 'evidence_unavailable';

/** Which acceptance attempt produced this answer, when it was one. A READ
 *  carries `null`: an observation is not the outcome of an attempt. */
export type AcceptanceOutcome = 'newly_accepted' | 'already_accepted' | null;

export interface CheckoutCorrelation {
  readonly orderId: string;
  readonly intentKey: string | null;
  readonly scope: { readonly restaurant: string | null;
                    readonly table: string | null };
  readonly acceptance: {
    readonly state: AcceptanceState;
    readonly outcome: AcceptanceOutcome;
    /** THE ORIGINAL reference the diner confirmed, read from the server's
     *  stored acceptance. Never recomputed here or there. */
    readonly quoteRef: string | null;
    readonly acceptedAt: string | null;
  };
  readonly current: {
    readonly orderStatus: string | null;
    readonly fulfilmentStatus: string | null;
    readonly cancelledAt: string | null;
    readonly servedAt: string | null;
  };
  readonly protocol: number;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * The capability level a payload claims, or 0.
 *
 * 0 MEANS PROMISE NOTHING, and an absent key is 0 — never an assumed
 * baseline. A non-integer or negative value is 0 too: a server that cannot
 * state its level coherently has not stated one.
 */
export function protocolLevel(payload: unknown): number {
  const value = (payload as { checkout_protocol?: unknown } | null)
    ?.checkout_protocol;
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value : 0;
}

/**
 * Read the correlated projection, or `null`.
 *
 * `null` is returned for a payload that does not carry one AND for one that
 * carries a malformed one — deliberately the same answer, because the caller's
 * response to both is identical: fall back to the level-2 reading, which is
 * conservative. It is NOT reconstructed from the surrounding legacy keys: a
 * projection assembled here out of `accepted` / `id` would carry exactly the
 * draft/legacy conflation the projection exists to remove, wearing the shape
 * that says it does not.
 */
export function readCorrelation(payload: unknown): CheckoutCorrelation | null {
  const root = payload as { checkout?: unknown } | null;
  const raw = root?.checkout as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return null;

  const orderId = str(raw['order_id']);
  if (!orderId) return null;

  const acceptance = raw['acceptance'] as Record<string, unknown> | undefined;
  if (!acceptance || typeof acceptance !== 'object') return null;
  const state = acceptance['state'];
  if (state !== 'accepted' && state !== 'not_accepted'
      && state !== 'evidence_unavailable') {
    return null;
  }
  const outcome = acceptance['outcome'];
  if (outcome !== null && outcome !== undefined
      && outcome !== 'newly_accepted' && outcome !== 'already_accepted') {
    return null;
  }

  const protocol = protocolLevel(raw);
  if (protocol < CHECKOUT_PROTOCOL_CORRELATED) return null;

  const scope = (raw['scope'] ?? {}) as Record<string, unknown>;
  const current = (raw['current'] ?? {}) as Record<string, unknown>;

  return {
    orderId,
    intentKey: str(raw['intent_key']),
    scope: {
      restaurant: str(scope['restaurant']),
      table: str(scope['table']),
    },
    acceptance: {
      state,
      outcome: (outcome ?? null) as AcceptanceOutcome,
      quoteRef: str(acceptance['quote_ref']),
      acceptedAt: str(acceptance['accepted_at']),
    },
    current: {
      orderStatus: str(current['order_status']),
      fulfilmentStatus: str(current['fulfilment_status']),
      cancelledAt: str(current['cancelled_at']),
      servedAt: str(current['served_at']),
    },
    protocol,
  };
}

/** What the client believes it commanded, to check the answer against. */
export interface ExpectedCommand {
  /** The intent key this client minted and persisted. */
  readonly key: string;
  /** `restaurant:table`, the context the checkout was made in. */
  readonly scope: string;
  /** The order the acceptance named, when one had been issued. */
  readonly orderId?: string | null;
}

/**
 * Is this answer about the command we issued?
 *
 * EVERY STATED FIELD MUST AGREE; a field the server did not state is not
 * evidence and cannot satisfy the check. That asymmetry is the whole value:
 * a response that merely looks plausible is not the same as one that names
 * the order, key and table the client is holding, and announcing success on
 * the first is how a late or misrouted reply becomes a phantom order.
 *
 * `intent_key` is REQUIRED to match. The server publishes it from the order's
 * own `client_order_id`, so an answer that omits it is about an order this
 * key did not create.
 */
export function correlationMatches(
  correlation: CheckoutCorrelation, expected: ExpectedCommand,
): boolean {
  if (correlation.intentKey !== expected.key) return false;
  if (expected.orderId && correlation.orderId !== expected.orderId) {
    return false;
  }
  const scope =
    `${correlation.scope.restaurant ?? ''}:${correlation.scope.table ?? ''}`;
  return scope === expected.scope;
}
