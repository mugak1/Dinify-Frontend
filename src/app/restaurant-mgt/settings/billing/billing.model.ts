import { toMinorUnits } from 'src/app/_shared/utils/decimal-money';

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

/**
 * The wire's own ceiling on `billing_interval_count`, not a display preference.
 * `commercial_app` stores it in a `PositiveIntegerField`, a 32-bit PostgreSQL
 * `integer`, and its writer caps it there explicitly — anything beyond cannot
 * have come from this contract.
 */
const MAX_INTERVAL_COUNT = 2_147_483_647;

/** ISO-4217: three uppercase ASCII letters, which is the backend's own CHECK. */
const CURRENCY_CODE = /^[A-Z]{3}$/;

/**
 * An ISO-8601 instant carrying an EXPLICIT offset.
 *
 * THE OFFSET IS REQUIRED, and that is the point rather than pedantry. The
 * backend's `AwareDateTimeField` refuses a naive value on the way IN because
 * midnight EAT and midnight UTC are three hours apart; accepting one on the way
 * OUT would resolve it against whatever zone the operator's device happens to
 * be in, and `effective_from` is the field that decides which terms were in
 * force. DRF emits `isoformat()` on an aware datetime, so the offset is always
 * there on a real response.
 */
const AWARE_ISO_MOMENT =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * A real instant this client can render.
 *
 * THE CALENDAR FIELDS ARE CHECKED SEPARATELY FROM `Date.parse`, because
 * `Date.parse` is permitted to be lenient and is: `2026-02-30T00:00:00+03:00`
 * parses happily as 2 March. Silently moving a price's effective date by two
 * days is the same class of untruth as rendering it in the wrong zone.
 */
function readsAsAwareMoment(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const parts = AWARE_ISO_MOMENT.exec(value);
  if (!parts) return false;
  const [, year, month, day, hour, minute, second] = parts;
  const y = Number(year);
  const mo = Number(month);
  if (mo < 1 || mo > 12) return false;
  const d = Number(day);
  if (d < 1 || d > daysInMonth(y, mo)) return false;
  if (Number(hour) > 23 || Number(minute) > 59) return false;
  // 60 is a leap second, which is legal in ISO-8601 and which `Date.parse`
  // then refuses — so the final check is what settles it either way.
  if (second !== undefined && Number(second) > 60) return false;
  return Number.isFinite(Date.parse(value));
}

/**
 * An amount this client can express EXACTLY, and which is not negative.
 *
 * `toMinorUnits` parses the digits of the canonical decimal string and answers
 * `null` rather than guessing — never `Number(value) * 100`. A recurring
 * SUBSCRIPTION FEE below zero is not a price, and an explicit `0.00` is: it
 * scales to 0, passes, and is displayed as the recorded price it is.
 */
function readsAsNonNegativeMoney(value: unknown): boolean {
  const minor = toMinorUnits(value);
  return minor !== null && minor >= 0;
}

function readInterval(value: unknown): BillingInterval | null {
  const raw = record(value);
  if (!raw) return null;
  const unit = raw['unit'];
  const count = raw['count'];
  if (!INTERVAL_UNITS.includes(unit as BillingInterval['unit'])) return null;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) return null;
  if (count > MAX_INTERVAL_COUNT) return null;
  return { unit: unit as BillingInterval['unit'], count };
}

/**
 * One open terms row, or `null` when any field the SCREEN RENDERS cannot be
 * trusted (D07/B2).
 *
 * IT USED TO CHECK ONLY THE TYPES. `typeof x === 'string'` admitted
 * `currency: ''` (a price rendered with no currency), `effective_from:
 * 'not-a-date'` (which threw out of Angular's DatePipe and took the whole
 * section down), a naive timestamp resolved against the device clock, and
 * `recurring_amount: '-150000.00'`. Each of those is a statement about money
 * this client had no basis for.
 *
 * NOTHING IS REPAIRED HERE. No currency is defaulted, no date is resolved, no
 * amount is rounded, no sign is flipped. The row is either displayed as the
 * server sent it or reported as unreadable, which is what the screen's one
 * sentence already says.
 */
function readTerms(value: unknown): SubscriptionTerms | null {
  const raw = record(value);
  if (!raw) return null;

  const interval = readInterval(raw['billing_interval']);
  if (!interval) return null;

  const amount = raw['recurring_amount'];
  // A canonical decimal STRING: `commercial_reads` calls `str()` on the
  // Decimal precisely so the scale survives, and a JSON number would already
  // have lost `0.00`.
  if (typeof amount !== 'string' || !readsAsNonNegativeMoney(amount)) return null;

  const currency = raw['currency'];
  if (typeof currency !== 'string' || !CURRENCY_CODE.test(currency)) return null;

  const effectiveFrom = raw['effective_from'];
  if (!readsAsAwareMoment(effectiveFrom)) return null;

  return {
    recurring_amount: amount,
    currency,
    billing_interval: interval,
    effective_from: effectiveFrom as string,
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

/** Displayed as text; absent and `null` are legitimate and render as unknown. */
const OPTIONAL_TEXT_KEYS = ['transaction_status', 'transaction_platform', 'payment_mode'];

/**
 * Whether one row can be displayed. It asks about THE FIELDS THIS TEMPLATE
 * RENDERS and nothing else — `transaction_type` and `order_number` reach no
 * pixel here, so nothing is asserted about them.
 */
function rowIsDisplayable(row: unknown): boolean {
  const raw = record(row);
  if (!raw) return false;

  // The `@for` track expression. A row with no identity cannot be tracked, and
  // Angular raises NG0955 on a duplicate — the section dying rather than a row
  // rendering twice. Duplicates are caught by the caller, which sees the page.
  const id = raw['id'];
  const identified =
    (typeof id === 'string' && id.length > 0) || (typeof id === 'number' && Number.isFinite(id));
  if (!identified) return false;

  // Piped through `| date`, which THROWS on a value it cannot convert.
  const createdAt = raw['time_created'];
  if (createdAt !== undefined && createdAt !== null && !readsAsAwareMoment(createdAt)) {
    return false;
  }

  // `transactionAmount` answers `—` for an amount it cannot read AND for one
  // that is absent, so an unreadable figure was indistinguishable from a row
  // carrying none. On a financial table those are different facts.
  const amount = raw['amount'];
  if (amount !== undefined && amount !== null && toMinorUnits(amount) === null) return false;

  return OPTIONAL_TEXT_KEYS.every((key) => {
    const value = raw[key];
    return value === undefined || value === null || typeof value === 'string';
  });
}

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
 * **AND A ROW IT CANNOT READ IS THE SAME FACT (D07/B2).** This used to DROP
 * such a row and return the rest, which produced the two answers a financial
 * view must never give: `[null, 'junk']` became `[]` and the screen said "No
 * subscription transactions recorded" — a claim about the restaurant
 * manufactured out of rows nobody could read — and `[valid, null]` presented an
 * incomplete history as the whole one, with nothing on screen saying a row had
 * gone. The smallest truthful behaviour is the state that already exists: the
 * history is UNREADABLE, the screen says so, the read-only retry is offered,
 * and the terms beside it stay readable because the two sections fail
 * independently.
 *
 * **NO ROW IS DELETED, CHANGED, BACKFILLED OR RECLASSIFIED**, here or anywhere
 * downstream. A readable page is returned VERBATIM — the same array, not a
 * rebuilt one — so there is no place for a repair to hide. A legitimately null
 * tender or status is an UNKNOWN and keeps its row; inventing `cash` or
 * `pending` for it is the defect the D07 reports rule already names.
 */
export function readBillingHistory(payload: unknown): unknown[] | null {
  if (!Array.isArray(payload)) return null;

  const seen = new Set<string>();
  for (const row of payload) {
    if (!rowIsDisplayable(row)) return null;
    const id = (row as Record<string, unknown>)['id'];
    // `track t.id` keys a Map, so `'1'` and `1` are different rows to Angular
    // and the same row to a looser comparison. Keep the type in the key.
    const key = `${typeof id}:${String(id)}`;
    if (seen.has(key)) return null;
    seen.add(key);
  }
  return payload;
}
