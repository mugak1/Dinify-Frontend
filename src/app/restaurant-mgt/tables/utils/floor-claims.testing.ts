/**
 * Two matchers the floor-view specs share. Test-only: nothing in the app imports
 * this file, so it is never bundled.
 */

/**
 * Any red at all: brand red (`primary`, `d-red`), the destructive token, or a raw
 * Tailwind red/rose. A STATUS is never red — amber waits, green is released, grey is
 * neutral. The component specs check the rendered DOM with it.
 */
export const RED_CLASS = /(?:^|\s|:)(?:bg|text|border|ring|outline)-(?:primary|d-red|destructive|red-\d+|rose-\d+)(?:\/\S+)?(?=\s|$)/;

/**
 * A claim that a payment happened, or did not. Step 2 records no payment, so none of
 * these may appear anywhere the floor view renders or toasts. "Payment unknown" and a
 * held round's "to pay" are the allowed wording. The component specs use it too.
 */
export const PAYMENT_CLAIM =
  /\b(?:paid|unpaid|settled|off-system|refund(?:ed)?|balance|owed|amount due|charged|receipt|payment (?:taken|recorded|received|collected|made|complete(?:d)?|successful))\b/i;

