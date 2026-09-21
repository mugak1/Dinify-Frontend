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
 * The two legacy keys are typed because the wire still carries them and this
 * change is additive. NOTHING IN THIS FOLDER READS THEM. They are not canonical:
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

/**
 * ABSENCE IS AN ANSWER. `recorded: false` is a successful statement that the
 * platform has recorded no terms — NOT a failure, and not something to fill in
 * with a default. Most restaurants are in this state today.
 */
export interface SubscriptionTermsState {
  recorded: boolean;
  current: SubscriptionTerms | null;
}

export interface SubscriptionDetails {
  /**
   * Whether the SERVER can collect a subscription payment in-app.
   *
   * OPTIONAL, and that is load-bearing: absent means the server did not state
   * it, which is NOT the same as stating `false`. Read it with `=== false`.
   */
  in_app_collection_supported?: boolean;
  /** Absent when the server did not state it — see above. */
  subscription_terms?: SubscriptionTermsState;

  // --- legacy, carried by the wire, deliberately unread here ---------------
  subscription_validity?: boolean;
  subscription_expiry_date?: string | null;
}

// --- reading the wire --------------------------------------------------------

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

/**
 * Read `data` from the subscription-details response.
 *
 * **A KEY THE SERVER DID NOT STATE IS OMITTED, NEVER DEFAULTED.** That is the
 * whole contract: every consumer of this object reads it strictly (`=== true` /
 * `=== false`), so an older server that has never heard of these facts says
 * NOTHING and the screen renders neither a price nor a reassurance about one.
 * Defaulting `in_app_collection_supported` to `false` here would put a claim on
 * the page that no server ever made — the same defect, one layer down.
 *
 * A MALFORMED `current` LEAVES `recorded` STANDING. The server said terms exist;
 * this client simply cannot read them, and those are different facts. The panel
 * reports that it cannot display the amount rather than quietly reporting that
 * none was recorded.
 */
export function readSubscriptionDetails(payload: unknown): SubscriptionDetails {
  const raw = record(payload) ?? {};
  const details: SubscriptionDetails = {} as SubscriptionDetails;

  if (typeof raw['in_app_collection_supported'] === 'boolean') {
    details.in_app_collection_supported = raw['in_app_collection_supported'];
  }

  const terms = record(raw['subscription_terms']);
  if (terms && typeof terms['recorded'] === 'boolean') {
    details.subscription_terms = {
      recorded: terms['recorded'],
      current: readTerms(terms['current']),
    };
  }

  // Passed through only so a reader can see they arrived; nothing here reads them.
  if (typeof raw['subscription_validity'] === 'boolean') {
    details.subscription_validity = raw['subscription_validity'];
  }
  if (typeof raw['subscription_expiry_date'] === 'string') {
    details.subscription_expiry_date = raw['subscription_expiry_date'];
  }

  return details;
}
