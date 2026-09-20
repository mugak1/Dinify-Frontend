/**
 * THE CORRECTED-WIRE INITIATE FIXTURE, BUILT ONCE.
 *
 * WHY IT EXISTS. The `pricing_version` discriminator is the NUMERIC
 * `PRICING_VERSION_CORRECTED` (1), compared with `===` in `reviewQuote`. A
 * fixture spelling it `'CORRECTED'` is therefore a LEGACY payload wearing the
 * word: `corrected` is false, the itemised contract is never entered, and the
 * whole of `reviewQuote`'s corrected branch — the reference, the row
 * identities, the per-line reconciliation, the availability counts and the
 * order-level sum — goes unexercised. Two #677 spec files did exactly that, so
 * their premise "an ordinarily confirmable quote" was true only of the older
 * contract. The constant is IMPORTED here rather than restated, which is what
 * stops the same drift recurring.
 *
 * WHAT IT GUARANTEES. `reviewQuote(correctedInitiate().data).readable` is
 * `true` and `.itemised` is `true` — asserted directly by the specs that use
 * it, on the unmodified payload, BEFORE any closure or storage fault is
 * injected. That is what makes a later refusal attributable to the fault
 * rather than to a structurally rejected quote.
 *
 * THE AMOUNTS RECONCILE EXACTLY, because the corrected contract checks that
 * they do. One parent (5,000) with one extra (1,000):
 *
 *   line_actual_cost        5000.00   the parent alone
 *   extras[0].actual_cost   1000.00   the child, counted exactly once
 *   line_total_with_extras  6000.00   parent + extras
 *   quote_total             6000.00   the sum of the parent aggregates
 *
 * and the availability counts describe the PARENT rows only, which is what
 * `reviewQuote` counts.
 *
 * A genuinely LEGACY payload is `legacyInitiate()`, which is labelled as such
 * at every call site. It is not a weaker version of this one — it is a
 * different server, and specs that mean it say so.
 */
import { PRICING_VERSION_CORRECTED } from '../../../_shared/order/checkout-limits';

/** The payable, as the canonical decimal string the corrected wire carries. */
export const CORRECTED_QUOTE_TOTAL = '6000.00';

/** One parent row and its one extra, reconciling to `CORRECTED_QUOTE_TOTAL`. */
export function correctedQuoteLines(): any[] {
  return [
    {
      id: 'ql1',
      item: 'i1',
      item_name: 'Burger',
      modifiers: ['No pickles'],
      available: true,
      quantity: 1,
      // the four figures that must be readable AND non-negative
      line_actual_cost: '5000.00',
      line_total_with_extras: CORRECTED_QUOTE_TOTAL,
      reference_unit_price: '5000.00',
      reference_total_cost: '5000.00',
      // the six that must merely be readable (`unit_cost_of_options` is
      // legitimately signed — "no cheese, -500" is legal end to end)
      unit_price: '5000.00',
      discounted_price: '5000.00',
      unit_cost_of_options: '0.00',
      total_cost: '5000.00',
      discounted_cost: '5000.00',
      savings: '0.00',
      extras: [
        {
          id: 'qx1',
          item: 'x1',
          item_name: 'Extra cheese',
          available: true,
          quantity: 1,
          actual_cost: '1000.00',
          unit_price: '1000.00',
          discounted_price: '1000.00',
        },
      ],
    },
  ];
}

/**
 * A complete corrected `initiate` 200 the diner could ordinarily confirm.
 *
 * `details` is merged over `order_details` so a spec can inject exactly one
 * fault — a `quote_closure`, a `quote_protocol`, a different `quote_ref` —
 * without rebuilding the quote and without weakening anything else.
 */
export function correctedInitiate(
  orderId = 'o1',
  quoteRef = 'q1',
  details: Record<string, unknown> = {},
): any {
  return {
    status: 200,
    data: {
      order_details: {
        id: orderId,
        quote_ref: quoteRef,
        actual_cost: CORRECTED_QUOTE_TOTAL,
        quote_total: CORRECTED_QUOTE_TOTAL,
        pricing_version: PRICING_VERSION_CORRECTED,
        no_available_items: 1,
        no_unavailable_items: 0,
        checkout_protocol: 3,
        quote_protocol: 2,
        ...details,
      },
      order_items: [],
      available_items: [],
      unavailable_items: [],
      extras: [],
      available_extras: [],
      unavailable_extras: [],
      quote: correctedQuoteLines(),
      quote_total: CORRECTED_QUOTE_TOTAL,
    },
  };
}

/**
 * A genuinely LEGACY `initiate` 200 — a pre-D02 server that never promised an
 * itemised quote and does not send one.
 *
 * Kept and labelled rather than deleted: the compatibility tolerance it
 * exercises is real, and a spec that means "an older server" must be able to
 * say so without reaching for a corrected payload with a field knocked out.
 */
export function legacyInitiate(
  orderId = 'o1',
  quoteRef = 'q1',
  details: Record<string, unknown> = {},
): any {
  return {
    status: 200,
    data: {
      order_details: {
        id: orderId,
        quote_ref: quoteRef,
        actual_cost: '5000.00',
        checkout_protocol: 3,
        ...details,
      },
      order_items: [],
      available_items: [],
      unavailable_items: [],
      extras: [],
      available_extras: [],
      unavailable_extras: [],
    },
  };
}
