/**
 * The wire shape of `GET restaurant-setup/subscription-details/` (D07 / PR-2).
 *
 * TWO CANONICAL FACTS, and they are separate on purpose. Whether Dinify can
 * COLLECT a subscription payment in-app is a capability of the running server;
 * what the restaurant has been RECORDED as paying is a commercial fact about the
 * restaurant. Neither implies the other, and neither implies that anything has
 * been paid — there is no invoice, receivable or collection record anywhere in
 * this platform, so this screen never renders one.
 *
 * The two legacy keys are carried on the read because the wire still sends
 * them and a reader should be able to see they arrived. NOTHING IN THIS
 * FOLDER READS THEM. They are not canonical:
 * no supported writer maintains either, and `subscription_validity` defaults to
 * `true`, which is exactly how the old panel came to render "Active" for every
 * restaurant on the platform.
 */

/** The recurrence, as two machine facts. This domain has no plan catalogue. */
export interface BillingInterval {
  unit: 'day' | 'week' | 'month' | 'year';
  count: number;
}

/**
 * One open terms row.
 *
 * `recurring_amount` is a CANONICAL DECIMAL STRING (`"150000.00"`), never a
 * number: the scale is part of the value, and `Number()` on the way in is what
 * turns `0.00` into `0`. Format it with `formatAmount` from
 * `_shared/utils/decimal-money`, which parses the digits exactly and answers
 * `null` rather than guessing.
 */
export interface SubscriptionTerms {
  recurring_amount: string;
  currency: string;
  billing_interval: BillingInterval;
  effective_from: string;
}

// --- reading the wire --------------------------------------------------------
//
// FIVE ANSWERS TO "WHAT ARE THIS RESTAURANT'S TERMS?", AND COLLAPSING ANY TWO
// IS THE DEFECT (D07/G2). The first cut of this screen had two — terms, or a
// sentence saying none are recorded — reached through `recorded === true` and
// `subscription_terms !== undefined`. Everything else fell through the gaps:
//
//   `current`      a valid open terms row.
//   `none`         the server stated `recorded: false` with no `current`.
//                  AN ANSWER, not a failure; most restaurants are here.
//   `unstated`     the response never mentioned `subscription_terms`. An older
//                  server. NOT a transport failure and NOT "none recorded" —
//                  rendering the reassuring sentence for it invents an answer
//                  out of silence, and rendering nothing at all (what it used
//                  to do) leaves the section blank with no explanation.
//   `unreadable`   the key is present and this client cannot trust it:
//                  a non-object, a non-boolean `recorded`, `recorded: true`
//                  with no readable `current`, or — the one most easily missed
//                  — `recorded: false` BESIDE a perfectly valid `current`.
//                  A contradiction is not evidence of absence.
//   (failure)      the request failed, was denied, or the device is offline.
//                  Owned by the load state, never by this vocabulary: a failed
//                  read must never become "Not configured".

/** Why a present projection could not be trusted. Diagnostic; one sentence reaches the screen. */
export type TermsUnreadableReason =
  | 'shape'          // not an object, or `recorded` is not a boolean
  | 'missing-current' // recorded: true with no readable terms
  | 'contradictory';  // recorded: false with a `current` beside it

export type SubscriptionTermsRead =
  | { readonly kind: 'current'; readonly terms: SubscriptionTerms }
  | { readonly kind: 'none' }
  | { readonly kind: 'unstated' }
  | { readonly kind: 'unreadable'; readonly reason: TermsUnreadableReason };

/**
 * Whether the SERVER can collect a subscription payment in-app.
 *
 * Four answers for the same reason the terms have five. `unstated` is an older
 * server; `unreadable` is one that sent the key and failed to express it, which
 * used to be silently dropped — so a broken contract removed the explanatory
 * note and looked exactly like a build that had grown a collector.
 */
export type CollectionCapabilityRead =
  | { readonly kind: 'supported' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'unstated' }
  | { readonly kind: 'unreadable' };

/** The whole validated read of one subscription-details response. */
export interface SubscriptionDetailsRead {
  readonly terms: SubscriptionTermsRead;
  readonly collection: CollectionCapabilityRead;
  /** Carried so a reader can see they arrived. NOTHING here reads them. */
  readonly legacy: {
    readonly validity?: boolean;
    readonly expiry?: string | null;
  };
}

const INTERVAL_UNITS: readonly BillingInterval['unit'][] = ['day', 'week', 'month', 'year'];

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readInterval(value: unknown): BillingInterval | null {
  const raw = record(value);
  if (!raw) return null;
  const unit = raw['unit'];
  const count = raw['count'];
  if (!INTERVAL_UNITS.includes(unit as BillingInterval['unit'])) return null;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) return null;
  return { unit: unit as BillingInterval['unit'], count };
}

function readTerms(value: unknown): SubscriptionTerms | null {
  const raw = record(value);
  if (!raw) return null;
  const interval = readInterval(raw['billing_interval']);
  if (
    typeof raw['recurring_amount'] !== 'string'
    || typeof raw['currency'] !== 'string'
    || typeof raw['effective_from'] !== 'string'
    || !interval
  ) {
    return null;
  }
  return {
    recurring_amount: raw['recurring_amount'],
    currency: raw['currency'],
    billing_interval: interval,
    effective_from: raw['effective_from'],
  };
}

function readTermsState(raw: Record<string, unknown>): SubscriptionTermsRead {
  if (!('subscription_terms' in raw)) return { kind: 'unstated' };

  const block = record(raw['subscription_terms']);
  if (!block || typeof block['recorded'] !== 'boolean') {
    return { kind: 'unreadable', reason: 'shape' };
  }

  const currentPresent = block['current'] !== undefined && block['current'] !== null;

  if (block['recorded']) {
    const terms = readTerms(block['current']);
    // `recorded: true` means an OPEN ROW EXISTS. Without readable terms beside
    // it this client cannot display the amount, and "none recorded" would be a
    // different — and false — statement.
    return terms
      ? { kind: 'current', terms }
      : { kind: 'unreadable', reason: 'missing-current' };
  }

  // `recorded: false` means NO OPEN ROW. A `current` beside it contradicts
  // that, and a VALID one is the dangerous shape: read as absence it would
  // silently hide a price the restaurant is being charged.
  return currentPresent
    ? { kind: 'unreadable', reason: 'contradictory' }
    : { kind: 'none' };
}

function readCapability(raw: Record<string, unknown>): CollectionCapabilityRead {
  if (!('in_app_collection_supported' in raw)) return { kind: 'unstated' };
  const value = raw['in_app_collection_supported'];
  if (value === true) return { kind: 'supported' };
  if (value === false) return { kind: 'unsupported' };
  return { kind: 'unreadable' };
}

/**
 * Read `data` from the subscription-details response.
 *
 * **KEY PRESENCE, NOT VALUE, SEPARATES SILENCE FROM A BROKEN ANSWER.** JSON
 * cannot transmit `undefined`, so a value test cannot tell an older server
 * from one that sent `null`, and the two call for opposite responses: the
 * first is tolerated, the second is a contract error somebody should see.
 *
 * **A NON-OBJECT BODY IS NOT AN OLDER SERVER.** It used to become `{}` here,
 * which read as "said nothing" about both facts at once. It returns `null` now
 * so the caller can report a failure rather than a silence.
 */
export function readSubscriptionDetails(payload: unknown): SubscriptionDetailsRead | null {
  const raw = record(payload);
  if (!raw) return null;

  const legacy: { validity?: boolean; expiry?: string | null } = {};
  if (typeof raw['subscription_validity'] === 'boolean') {
    legacy.validity = raw['subscription_validity'];
  }
  if (typeof raw['subscription_expiry_date'] === 'string') {
    legacy.expiry = raw['subscription_expiry_date'];
  }

  return {
    terms: readTermsState(raw),
    collection: readCapability(raw),
    legacy,
  };
}

// --- billing history ---------------------------------------------------------

/**
 * Read the transactions listing.
 *
 * **A MALFORMED SUCCESSFUL PAYLOAD IS NOT AN EMPTY LIST.** The old code did
 * `x?.data as any` and handed whatever arrived to a template loop; a non-array
 * body threw `newCollection[Symbol.iterator] is not a function` out of Angular
 * and took the section down. Returning `null` lets the caller say it could not
 * read the history, which is true, instead of "no transactions recorded",
 * which is a claim about the restaurant.
 *
 * A row that is not an object is DROPPED rather than failing the whole read —
 * one unreadable row is not a reason to withhold the rest — and the component
 * formats each field defensively, as it already did.
 */
export function readBillingHistory(payload: unknown): unknown[] | null {
  if (!Array.isArray(payload)) return null;
  return payload.filter((row) => record(row) !== null);
}
