/**
 * R1 — THE ONE READING OF A SERVER QUOTE, shared by the review sheet and by the
 * handler that places the order.
 *
 * WHAT IT REPLACED. The client checked that the payable could be READ and that
 * every line it happened to receive carried a readable amount. It never
 * required a corrected server to SEND any lines, and never asked whether the
 * lines it did send added up to the amount the diner was confirming. Both gaps
 * are silent, and the second is the dangerous one: a payload asserting
 * `quote_total: "25.00"` above lines totalling `"10.00"` rendered a review that
 * looked itemised, reconciled nothing, and submitted.
 *
 * THE VERSION IS THE DISCRIMINATOR, AND THE THREE CASES ARE DELIBERATELY APART.
 * They are not degrees of strictness; they are different servers.
 *
 *   LEGACY (`pricing_version` 0 or absent) — a pre-D02 server. It never
 *   promised an itemised quote or a canonical total, so requiring either would
 *   invent a contract it was never party to. Reviewed through `actual_cost`,
 *   exactly as before. The backend refuses such a draft at submit
 *   (`legacy_pricing_version`) and the basket re-prices; that is unchanged.
 *
 *   CORRECTED WITHOUT `quote_total` — backend #314. It shipped
 *   `pricing_version`, `quote_ref` AND the itemised `quote`; only the canonical
 *   total arrived later, in #315. So this is a real deployable server, its
 *   lines are fully validated, and the bounded `actual_cost` compatibility path
 *   supplies the total. A CORRECTED payload with missing LINES is NOT this
 *   case — no deployed server has ever produced one, because `quote`,
 *   `quote_ref` and `pricing_version` all landed in the same commit.
 *
 *   CORRECTED WITH `quote_total` — the current contract. Everything is
 *   required, and a total the server SENT but cannot express is refused with no
 *   fallback to the lossy numeric field beside it.
 *
 * WHAT IT NEVER DOES. It never fabricates a line, trims the basket, recomputes
 * a replacement quote, or adjusts a server amount to force a reconciliation.
 * The lines it returns are the server's own array. A quote it cannot validate
 * produces a refusal the caller renders — not a smaller, tidier quote.
 *
 * IT IS NOT A SCHEMA FRAMEWORK. It answers one question about one payload, in
 * the vocabulary of this contract, and nothing here generalises.
 */
import { OrderInitiated, OrderQuoteExtra, OrderQuoteLine } from '../../_models/app.models';
import { addMinorUnits, toMinorUnits } from '../utils/decimal-money';
import {
  MAX_EXTRAS_PER_LINE,
  MAX_LINES_PER_ORDER,
  PRICING_VERSION_CORRECTED,
} from './checkout-limits';

/**
 * Why a quote cannot be confirmed. Diagnostic only — the diner sees ONE
 * sentence, because which internal rule tripped is not their problem and a
 * per-reason message would be an oracle over the response.
 */
export type QuoteRefusal =
  | 'no_payload'
  | 'total_unreadable'
  | 'reference_missing'
  | 'quote_missing'
  | 'quote_shape'
  | 'line_identity'
  | 'line_quantity'
  | 'line_amount'
  | 'line_display'
  | 'line_reconciliation'
  | 'order_reconciliation'
  | 'availability_counts'
  | 'quote_incomplete';

export interface QuoteReview {
  /** May this quote be rendered as a confirmable amount and submitted? */
  readable: boolean;
  /** Which rule refused it. `null` when readable. */
  reason: QuoteRefusal | null;
  /** The server's payable in exact minor units, or `null` when unreadable. */
  totalMinor: number | null;
  /**
   * The lines to RENDER — the server's own array, never rebuilt and never
   * filtered. A refused quote still carries whatever array-shaped lines
   * arrived, so the sheet can show what it was asked to confirm beside the
   * refusal instead of going blank.
   */
  lines: OrderQuoteLine[];
  /** True when an itemised quote was actually validated (the CORRECTED path). */
  itemised: boolean;
}

/**
 * Response sanity bounds, DERIVED rather than invented, and deliberately not a
 * second opinion about what may be submitted: the server merges identical
 * configurations, so merging can only REDUCE row counts. A response therefore
 * cannot hold more parent lines than one request could submit, nor more extras
 * on a line than one submitted line could carry. Per-line QUANTITY is
 * deliberately NOT bounded here — a merged row may legitimately exceed the
 * submit ceiling, which is exactly what `checkout-limits` says.
 */
const MAX_QUOTE_LINES = MAX_LINES_PER_ORDER;
const MAX_QUOTE_EXTRAS_PER_LINE = MAX_EXTRAS_PER_LINE;

/** Money that is a PAYABLE or a REFERENCE: exact, and never negative.
 *  A modifier adjustment is excluded on purpose — "no cheese, −500" is a legal
 *  configuration end to end, so its sign is real information. */
const NON_NEGATIVE_LINE_MONEY = [
  'line_actual_cost', 'line_total_with_extras',
  'reference_unit_price', 'reference_total_cost',
] as const;

/** Money that must merely be READABLE — including the signed adjustment. */
const READABLE_LINE_MONEY = [
  'unit_price', 'discounted_price', 'unit_cost_of_options',
  'total_cost', 'discounted_cost', 'savings',
] as const;

const NON_NEGATIVE_EXTRA_MONEY = ['actual_cost', 'unit_price'] as const;

function refuse(reason: QuoteRefusal, lines: OrderQuoteLine[]): QuoteReview {
  return { readable: false, reason, totalMinor: null, lines, itemised: false };
}

/** A row identity that can actually be used to tell one line from another. */
function usableId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** A server-stated row quantity: a whole, non-negative, safe integer. */
function usableQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function exactNonNegative(value: unknown): number | null {
  const minor = toMinorUnits(value);
  if (minor === null || minor < 0) return null;
  return minor;
}

/**
 * THE DISPLAY SHAPES THE REVIEW TEMPLATE ACTUALLY DEREFERENCES — and only
 * those. This is not a second schema layer and it is deliberately not
 * generalised: it is the exact list of reads the sheet performs on a line it
 * has been handed, because the amounts being sound says nothing about whether
 * the row can be drawn.
 *
 * WHY IT IS A REFUSAL RATHER THAN A RENDER-TIME GUARD. `modifiers` is a
 * display field, so the monetary contract never looked at it — yet the sheet
 * calls `.join()` on it behind an `?.length` test that a STRING satisfies
 * (`'Large'.length` is 5). The quote validated perfectly, `readable` was true,
 * the Place order button was live, and the panel threw while rendering the row
 * the diner was being asked to confirm. A quote whose rows cannot be drawn
 * cannot be reviewed, and something that cannot be reviewed must not be
 * confirmable — so it is refused here, once, where the handler and the markup
 * both read the verdict, rather than patched into the template where only the
 * markup would be protected.
 *
 * NOTHING IS COERCED. A label is used as it arrived or the quote is refused;
 * an object is never stringified into a line the kitchen never promised.
 */
function displayableLabels(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return Array.isArray(value) && value.every((label) => typeof label === 'string');
}

/** A name the sheet interpolates. Absent is fine — the row simply has none. */
function displayableName(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

/** Every display read the template performs on ONE parent row and its extras. */
function displayShapeOk(line: OrderQuoteLine): boolean {
  if (!displayableLabels(line.modifiers)) return false;
  if (!displayableName(line.item_name)) return false;
  // `@for (extra of line.extras; track extra.id)` evaluates the tracking
  // expression per entry, so a null child throws before any guard in the body
  // can run. The array-ness itself is checked by the caller.
  const extras: unknown[] = Array.isArray(line.extras) ? line.extras : [];
  return extras.every(
    (extra) => !!extra && typeof extra === 'object'
      && displayableName((extra as OrderQuoteExtra).item_name),
  );
}

/**
 * THE boundary. Give it the whole `initiate` payload; it answers whether the
 * diner may be shown a confirmable amount, and what that amount is.
 */
export function reviewQuote(
  payload: OrderInitiated | null | undefined,
): QuoteReview {
  const details = payload?.order_details;
  const rawLines = Array.isArray(payload?.quote) ? payload!.quote! : [];
  if (!details) return refuse('no_payload', []);

  const corrected = details.pricing_version === PRICING_VERSION_CORRECTED;

  // ── the payable ───────────────────────────────────────────────────────
  // ONLY AN ABSENT PROPERTY IS THE COMPATIBILITY CASE — `undefined`, never
  // `null`. A pre-field backend omits `quote_total` from the payload
  // altogether, so absence is the only shape an older server can produce; an
  // explicit `null` can come from just one place, a CORRECTED server that sent
  // the key and failed to express a value, which is the broken promise this
  // refuses.
  let totalMinor = toMinorUnits(details.quote_total);
  if (totalMinor === null) {
    if (corrected && details.quote_total !== undefined) {
      return refuse('total_unreadable', rawLines);
    }
    totalMinor = toMinorUnits(details.actual_cost);
  }
  if (totalMinor === null || totalMinor < 0) {
    return refuse('total_unreadable', rawLines);
  }

  if (!corrected) {
    // The pre-D02 tolerance, unchanged and deliberately bounded to the TOTAL.
    //
    // AN OLD SERVER IS EXCUSED FROM SENDING AN ITEMISED QUOTE — it never
    // promised one — but it is NOT excused from the shape of one it did send.
    // A pre-D02 payload carries no `quote` key at all, so `rawLines` is empty
    // here and this loop does not run; #661's absent-total compatibility is
    // untouched. What it refuses is the different fact of a payload that SENT
    // rows the sheet cannot draw, which is malformed content rather than an
    // older contract.
    for (const line of rawLines) {
      if (!line || typeof line !== 'object' || !displayShapeOk(line)) {
        return refuse('line_display', rawLines);
      }
    }
    return {
      readable: true, reason: null, totalMinor, lines: rawLines,
      itemised: false,
    };
  }

  // ── everything below is the CORRECTED contract ────────────────────────
  // An explicit `false` only: a server that does not publish the key says
  // nothing, and absence must never be read as a refusal.
  if (details.quote_complete === false) {
    return refuse('quote_incomplete', rawLines);
  }
  if (!usableId(details.quote_ref)) return refuse('reference_missing', rawLines);
  if (!Array.isArray(payload!.quote)) return refuse('quote_missing', rawLines);
  if (rawLines.length > MAX_QUOTE_LINES) return refuse('quote_shape', rawLines);

  const seen = new Set<string>();
  let available = 0;
  let unavailable = 0;
  const lineTotals: (number | null)[] = [];

  for (const line of rawLines) {
    if (!line || typeof line !== 'object') return refuse('quote_shape', rawLines);
    if (!usableId(line.id) || !usableId(line.item)) {
      return refuse('line_identity', rawLines);
    }
    // Row identity must be UNIQUE across the whole quote, parents and extras
    // alike: a repeated id is a row that could be counted twice, or two rows a
    // client could not tell apart.
    if (seen.has(line.id)) return refuse('line_identity', rawLines);
    seen.add(line.id);

    if (typeof line.available !== 'boolean') return refuse('quote_shape', rawLines);
    if (!usableQuantity(line.quantity)) return refuse('line_quantity', rawLines);
    // A line the server says it WILL deliver must have something to deliver.
    if (line.available && line.quantity < 1) return refuse('line_quantity', rawLines);
    if (line.available) available += 1; else unavailable += 1;

    const parentMinor = validateMoney(line);
    if (parentMinor === null) return refuse('line_amount', rawLines);

    const extras: OrderQuoteExtra[] = Array.isArray(line.extras) ? line.extras : [];
    if (!Array.isArray(line.extras)) return refuse('quote_shape', rawLines);
    if (extras.length > MAX_QUOTE_EXTRAS_PER_LINE) {
      return refuse('quote_shape', rawLines);
    }

    // The display reads, checked for the SAME row whose amounts are checked
    // below. Sound money on a row that cannot be drawn is not a confirmable
    // quote — see `displayShapeOk`.
    if (!displayShapeOk(line)) return refuse('line_display', rawLines);

    const childAmounts: (number | null)[] = [];
    for (const extra of extras) {
      if (!extra || typeof extra !== 'object') return refuse('quote_shape', rawLines);
      if (!usableId(extra.id) || !usableId(extra.item)) {
        return refuse('line_identity', rawLines);
      }
      if (seen.has(extra.id)) return refuse('line_identity', rawLines);
      seen.add(extra.id);
      if (typeof extra.available !== 'boolean') return refuse('quote_shape', rawLines);
      if (!usableQuantity(extra.quantity)) return refuse('line_quantity', rawLines);
      if (extra.available && extra.quantity < 1) return refuse('line_quantity', rawLines);
      for (const key of NON_NEGATIVE_EXTRA_MONEY) {
        if (exactNonNegative(extra[key]) === null) return refuse('line_amount', rawLines);
      }
      if (toMinorUnits(extra.discounted_price) === null) {
        return refuse('line_amount', rawLines);
      }
      childAmounts.push(toMinorUnits(extra.actual_cost));
    }

    // EACH CHILD COUNTED EXACTLY ONCE. `line_actual_cost` is the parent alone
    // and `line_total_with_extras` is the parent plus its extras — the two
    // aggregates the response labels apart precisely so they cannot be mixed.
    const composed = addMinorUnits(
      toMinorUnits(line.line_actual_cost), ...childAmounts);
    if (composed === null || composed !== parentMinor) {
      return refuse('line_reconciliation', rawLines);
    }
    lineTotals.push(parentMinor);
  }

  // THE QUOTE AND THE COUNTS DESCRIBE THE SAME ROWS. A payload claiming one
  // available dish above an empty quote is the case the old loop passed
  // vacuously, and it is the difference between "nothing was sold out" and
  // "the server sent no lines at all".
  if (details.no_available_items !== available
      || details.no_unavailable_items !== unavailable) {
    return refuse('availability_counts', rawLines);
  }

  // THE LINES ADD UP TO THE AMOUNT BEING CONFIRMED. Exact integers, no epsilon,
  // and the server's total is never adjusted to meet them.
  const summed = addMinorUnits(...lineTotals);
  if (summed === null || summed !== totalMinor) {
    return refuse('order_reconciliation', rawLines);
  }

  return { readable: true, reason: null, totalMinor, lines: rawLines, itemised: true };
}

/** Every monetary key a line publishes, read exactly once. Returns the line's
 *  parent-plus-extras figure, or `null` if anything is unreadable. */
function validateMoney(line: OrderQuoteLine): number | null {
  for (const key of NON_NEGATIVE_LINE_MONEY) {
    if (exactNonNegative(line[key]) === null) return null;
  }
  for (const key of READABLE_LINE_MONEY) {
    if (toMinorUnits(line[key]) === null) return null;
  }
  return toMinorUnits(line.line_total_with_extras);
}
