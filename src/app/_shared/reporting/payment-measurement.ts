/**
 * WHETHER THIS PLATFORM MEASURES SETTLED PAYMENTS — ONE DECISION, READ ONCE.
 *
 * D07 established that several reporting figures are aggregated over
 * `payment_status='paid'`, a column with no writer, and are therefore not
 * measurements of anything. The backend states that in ONE place
 * (`reports_app.controllers.restaurant.dashboard.PAYMENT_TRACKING_ENABLED`,
 * published on both the v1 `dashboard` and v2 `dashboard-v2` payloads as
 * `payment_tracking_enabled`), and every consumer that renders a governed
 * figure has to reach the same conclusion about it.
 *
 * **FOUR ANSWERS, AND COLLAPSING ANY TWO IS THE DEFECT.** The first cut of this
 * work read the declaration as `=== false` and treated everything else as
 * "measured", which merged three genuinely different situations into the one
 * that is most flattering:
 *
 *   `supported`     the server stated `true`. The figures are measurements.
 *   `unavailable`   the server stated `false`. It does not record settlement.
 *   `unestablished` the server did not state the key at all — an older build.
 *                   We do not know, and a figure derived from a basis we cannot
 *                   vouch for is not a measurement we may present as one.
 *   `unusable`      the key arrived as `null`, a string, a number, an object or
 *                   an array. The server tried to say something and this client
 *                   cannot read it, which is a different fact from silence and
 *                   is worth saying differently.
 *
 * **ONLY `supported` LICENSES A FIGURE.** The other three withhold it. That is
 * the substantive change from the disclosure-note behaviour this replaced: a
 * note under a plotted series still shows the series, and an operator reads the
 * series. Where a governed figure cannot be vouched for it is not rendered,
 * caveated or greyed — it is replaced by a statement of what is not known.
 *
 * **WHAT IT NEVER DOES.** It reprices nothing, rebases nothing onto another
 * queryset, equates nothing with `served`, synthesises no settlement, removes
 * no refund and clamps no negative. It decides only whether a figure may be
 * presented as a measurement.
 */

/** The four answers. A discriminated union so a consumer cannot test it as a boolean. */
export type PaymentMeasurement =
  | { readonly kind: 'supported' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'unestablished' }
  | { readonly kind: 'unusable' };

const SUPPORTED: PaymentMeasurement = { kind: 'supported' };
const UNAVAILABLE: PaymentMeasurement = { kind: 'unavailable' };
const UNESTABLISHED: PaymentMeasurement = { kind: 'unestablished' };
const UNUSABLE: PaymentMeasurement = { kind: 'unusable' };

/** The wire key both dashboard payloads publish it under. */
export const PAYMENT_MEASUREMENT_KEY = 'payment_tracking_enabled';

/**
 * Classify the declaration carried by one dashboard payload.
 *
 * **KEY PRESENCE IS THE DISCRIMINATOR BETWEEN `unestablished` AND `unusable`,
 * and reading it off the VALUE cannot work.** JSON cannot transmit `undefined`,
 * so `payload.payment_tracking_enabled === undefined` is true both for a server
 * that never heard of the key and for one that sent `undefined` — which it
 * cannot. But it is ALSO true for a payload that is not an object at all, where
 * nothing was declared either. So the check is `in`, on an object, and anything
 * that is not an object declares nothing.
 *
 * An explicit `null` is deliberately NOT silence. A key present with a null
 * value is a server that reached for this fact and produced something
 * unreadable; treating it as "never mentioned" would file a broken contract as
 * an old one and would stop anyone noticing.
 */
export function readPaymentMeasurement(payload: unknown): PaymentMeasurement {
  if (payload === null || typeof payload !== 'object') return UNESTABLISHED;
  if (!(PAYMENT_MEASUREMENT_KEY in (payload as Record<string, unknown>))) {
    return UNESTABLISHED;
  }
  return classifyPaymentDeclaration(
    (payload as Record<string, unknown>)[PAYMENT_MEASUREMENT_KEY],
  );
}

/**
 * Classify a declaration whose PRESENCE is already established.
 *
 * Separate from `readPaymentMeasurement` because the mock dashboard data builds
 * its response object directly rather than adapting a wire payload, and a
 * second copy of the true/false/otherwise rule in that file is exactly how a
 * fixture comes to disagree with the thing it stands in for.
 */
export function classifyPaymentDeclaration(value: unknown): PaymentMeasurement {
  if (value === true) return SUPPORTED;
  if (value === false) return UNAVAILABLE;
  return UNUSABLE;
}

/** A measurement nothing declared. The state an absent payload resolves to. */
export function paymentMeasurementUnestablished(): PaymentMeasurement {
  return UNESTABLISHED;
}

/**
 * Whether a figure aggregated over settled payments may be presented as a
 * measurement. ONLY an explicit `true` qualifies.
 */
export function measurementIsSupported(m: PaymentMeasurement | null | undefined): boolean {
  return m?.kind === 'supported';
}

/**
 * The inverse, stated positively because it is what every template branches on:
 * this figure is withheld.
 *
 * `null`/`undefined` withholds too — a consumer that was never given the
 * decision has not established one, and failing open here would reinstate the
 * defect one binding at a time.
 */
export function measurementWithholdsFigures(
  m: PaymentMeasurement | null | undefined,
): boolean {
  return !measurementIsSupported(m);
}

/**
 * Whether BOTH windows of a period-over-period comparison may be compared.
 *
 * The dashboard fetches its baseline with a SECOND `dashboard-v2` call, which
 * carries its own declaration. During a rollout the two calls can be answered
 * by different builds, so a percentage is only meaningful when both said
 * `true` — a delta between a measured window and an unmeasured one is a
 * statement about our deployment, rendered as a statement about the
 * restaurant's trade.
 */
export function comparisonIsSupported(
  current: PaymentMeasurement | null | undefined,
  baseline: PaymentMeasurement | null | undefined,
): boolean {
  return measurementIsSupported(current) && measurementIsSupported(baseline);
}

/**
 * The sentence for the state, with the SUBJECT of the withheld figures named by
 * the caller (`'Revenue'`, `'Paid and Open/Unpaid'`, `'These figures'`).
 *
 * **`unavailable` AND `unestablished` GET DIFFERENT WORDS, deliberately.** One
 * is the platform stating a limitation of its own; the other is this client not
 * knowing. Saying "Dinify doesn't record settled payments" on behalf of a
 * server that never said so is the same manufactured claim, pointed the other
 * way — and it would be printed against every older deployment for as long as
 * one is running.
 *
 * Returns `null` for `supported`: there is nothing to say about a figure that
 * is a measurement.
 */
export function measurementNotice(
  m: PaymentMeasurement | null | undefined,
  subject: string,
): string | null {
  switch (m?.kind) {
    case 'supported':
      return null;
    case 'unavailable':
      return `Dinify doesn't record settled payments, so ${subject} can't be shown.`;
    case 'unusable':
      return `This server's answer about payment recording couldn't be read, so ${subject} can't be shown.`;
    default:
      return `This server didn't state whether it records settled payments, so ${subject} can't be shown.`;
  }
}

/**
 * The short label that stands in for a withheld figure.
 *
 * An em dash rather than `0`, `—%`, `N/A` or a blank: zero is a number an
 * operator will read as trade, and a blank reads as a rendering fault. The
 * figure is accompanied by `measurementNotice` wherever it appears.
 */
export const MEASUREMENT_WITHHELD = '—';

/**
 * Screen-reader text for a withheld figure. The em dash above is announced as
 * nothing at all by most screen readers, so the state has to be carried in an
 * accessible name rather than only in the glyph.
 */
export function measurementWithheldLabel(m: PaymentMeasurement | null | undefined): string {
  switch (m?.kind) {
    case 'unavailable':
      return 'Not shown: Dinify does not record settled payments';
    case 'unusable':
      return "Not shown: this server's answer about payment recording could not be read";
    default:
      return 'Not shown: this server did not state whether it records settled payments';
  }
}
