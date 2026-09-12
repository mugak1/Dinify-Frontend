/**
 * The D01 request ceilings, defined ONCE for the whole diner app.
 *
 * These are the BACKEND's limits — application safety ceilings on one order
 * request, not a statement about stock, menu size or what a restaurant may sell.
 * The diner app's job is to stop a basket reaching a state the server will
 * refuse, and to say so before the round trip rather than after it.
 *
 * PROVENANCE AND DRIFT. The numbers come from
 * `orders_app/controllers/services/order_input.py` in Dinify-Backend. They are
 * checked against `checkout-limits.contract.json` — a copy of those backend
 * constants — by `checkout-limits.spec.ts` here, and the backend asserts the
 * same values against the same file's contents in
 * `orders_app/tests_order_input.py`. Either side drifting fails its own suite.
 * There is deliberately no runtime service fetching them: eight constants do not
 * need a network round trip, and a fetched limit would be unavailable exactly
 * when the diner is offline and most needs the basket to behave.
 */

/** Largest quantity accepted on ONE submitted order line. */
export const MAX_QUANTITY_PER_LINE = 99;
/** Largest number of submitted parent lines in one order. */
export const MAX_LINES_PER_ORDER = 100;
/** Largest total of all submitted line quantities in one order. */
export const MAX_TOTAL_UNITS = 500;
/** Largest number of modifier GROUPS a single submitted line may carry. */
export const MAX_MODIFIER_GROUPS_PER_LINE = 32;
/** Largest number of RAW choice entries in one submitted group. */
export const MAX_CHOICES_PER_GROUP = 64;
/** Largest number of RAW extra entries on one submitted line. */
export const MAX_EXTRAS_PER_LINE = 64;
/** Largest total of RAW choice + extra entries across the whole request. */
export const MAX_SELECTION_ENTRIES_PER_REQUEST = 2048;

/** Why a basket cannot be submitted as it stands. */
export type CheckoutLimitBreach =
  | 'line_quantity'
  | 'too_many_lines'
  | 'too_many_units'
  | 'line_selections'
  | 'too_many_selections';

export interface CheckoutLimitState {
  breach: CheckoutLimitBreach | null;
  message: string;
  /** Lines whose own quantity is over the per-line ceiling. */
  overLimitLineIndexes: number[];
}

interface BasketLineLike {
  quantity: number;
  selectedModifiers?: { choices?: unknown[] }[] | null;
  extras?: unknown[] | null;
}

const OK: CheckoutLimitState = {
  breach: null,
  message: '',
  overLimitLineIndexes: [],
};

/** One line carries more options or extras than the server will accept. The
 *  offending line is named so it can be marked in place, exactly as an
 *  over-quantity line is — never cleared or trimmed on the diner's behalf. */
function lineSelectionBreach(index: number, rule: string): CheckoutLimitState {
  return {
    breach: 'line_selections',
    message: `${rule} Please simplify the highlighted item.`,
    overLimitLineIndexes: [index],
  };
}

/**
 * Can this basket be submitted? Reports the FIRST breach with a message the
 * diner can act on, plus which lines are individually over the per-line ceiling
 * so they can be marked in place.
 *
 * IMPORTANT: this describes what may be SUBMITTED. The backend legitimately
 * merges several valid lines into one stored row above the per-line ceiling, so
 * a restored basket showing a larger merged quantity elsewhere is not a
 * contradiction.
 */
export function checkCheckoutLimits(
  lines: readonly BasketLineLike[],
): CheckoutLimitState {
  if (!lines || lines.length === 0) return OK;

  const overLimitLineIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => (line.quantity ?? 0) > MAX_QUANTITY_PER_LINE)
    .map(({ index }) => index);

  if (overLimitLineIndexes.length > 0) {
    return {
      breach: 'line_quantity',
      message:
        `Each item can have at most ${MAX_QUANTITY_PER_LINE}. ` +
        'Reduce the highlighted items to place your order.',
      overLimitLineIndexes,
    };
  }

  if (lines.length > MAX_LINES_PER_ORDER) {
    return {
      breach: 'too_many_lines',
      message:
        `An order can carry at most ${MAX_LINES_PER_ORDER} items. ` +
        'Please place the rest as a second order.',
      overLimitLineIndexes: [],
    };
  }

  const totalUnits = lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0);
  if (totalUnits > MAX_TOTAL_UNITS) {
    return {
      breach: 'too_many_units',
      message:
        `An order can carry at most ${MAX_TOTAL_UNITS} items in total. ` +
        'Please place the rest as a second order.',
      overLimitLineIndexes: [],
    };
  }

  // PER-LINE DIMENSION CEILINGS, checked before the whole-request total.
  //
  // The aggregate below cannot stand in for these and it is tempting to think it
  // can: a line carrying 65 extras, or a group carrying 65 choices, is nowhere
  // near 2,048 entries, so a preflight that only counted the total would publish
  // three limits it never checked and let the server do the refusing — exactly
  // the round trip this module exists to spare the diner.
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const groups = line.selectedModifiers ?? [];
    if (groups.length > MAX_MODIFIER_GROUPS_PER_LINE) {
      return lineSelectionBreach(
        index,
        `An item can carry at most ${MAX_MODIFIER_GROUPS_PER_LINE} option groups.`,
      );
    }
    const widestGroup = groups.reduce(
      (widest, group) => Math.max(widest, group?.choices?.length ?? 0),
      0,
    );
    if (widestGroup > MAX_CHOICES_PER_GROUP) {
      return lineSelectionBreach(
        index,
        `An option group can carry at most ${MAX_CHOICES_PER_GROUP} choices.`,
      );
    }
    if ((line.extras?.length ?? 0) > MAX_EXTRAS_PER_LINE) {
      return lineSelectionBreach(
        index,
        `An item can carry at most ${MAX_EXTRAS_PER_LINE} extras.`,
      );
    }
  }

  // RAW entries, before de-duplication — the same basis the backend counts on.
  const selectionEntries = lines.reduce((sum, line) => {
    const choices = (line.selectedModifiers ?? []).reduce(
      (inner, group) => inner + (group?.choices?.length ?? 0),
      0,
    );
    return sum + choices + (line.extras?.length ?? 0);
  }, 0);
  if (selectionEntries > MAX_SELECTION_ENTRIES_PER_REQUEST) {
    return {
      breach: 'too_many_selections',
      message: 'That order carries too many options and extras. Please simplify it.',
      overLimitLineIndexes: [],
    };
  }

  return OK;
}

/** True when one more unit on this line would exceed the per-line ceiling. */
export function atLineQuantityCeiling(quantity: number): boolean {
  return (quantity ?? 0) >= MAX_QUANTITY_PER_LINE;
}

/**
 * `Order.pricing_version` on the wire: 0 = LEGACY (priced before the D02
 * correction), 1 = CORRECTED.
 *
 * THE CLIENT'S ONE DISCRIMINATOR between "this server predates the corrected
 * pricing contract" and "this server claims the corrected contract and then
 * failed to honour it". Without it the two are the same absence, and the
 * transitional tolerance that makes the first case survivable would silently
 * swallow the second.
 */
export const PRICING_VERSION_LEGACY = 0;
export const PRICING_VERSION_CORRECTED = 1;
