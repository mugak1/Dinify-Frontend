import { ItemDiscountDetails, MenuItem } from 'src/app/_models/app.models';

export function formatUGX(amount: number): string {
  if (amount == null || isNaN(amount)) return 'UGX 0';
  return `UGX ${amount.toLocaleString('en-UG')}`;
}

function _pct(dd: ItemDiscountDetails | null | undefined): number {
  return Number(dd?.discount_percentage) || 0;
}

function _amt(dd: ItemDiscountDetails | null | undefined): number {
  return Number(dd?.discount_amount) || 0;
}

export function isDiscountActive(discountDetails: ItemDiscountDetails | null | undefined): boolean {
  if (!discountDetails) return false;
  if (_pct(discountDetails) <= 0 && _amt(discountDetails) <= 0) return false;

  const now = new Date();

  if (discountDetails.start_date) {
    const start = new Date(discountDetails.start_date);
    if (!isNaN(start.getTime()) && now < start) return false;
  }
  if (discountDetails.end_date) {
    const end = new Date(discountDetails.end_date);
    if (!isNaN(end.getTime()) && now > end) return false;
  }

  if (
    Array.isArray(discountDetails.recurring_days) &&
    discountDetails.recurring_days.length > 0
  ) {
    // JS getDay(): 0=Sun..6=Sat → backend ISO: 1=Mon..7=Sun
    const jsDay = now.getDay();
    const backendDay = jsDay === 0 ? 7 : jsDay;
    if (!discountDetails.recurring_days.includes(backendDay)) return false;
  }

  return true;
}

export function getCurrentPriceFromDetails(
  primary: number,
  discountDetails: ItemDiscountDetails | null | undefined,
): number {
  const p = Number(primary) || 0;
  if (!isDiscountActive(discountDetails)) return p;
  const pct = _pct(discountDetails);
  const amt = _amt(discountDetails);
  if (pct > 0) return Math.max(0, Math.round(p * (1 - pct / 100)));
  if (amt > 0) return Math.max(0, p - amt);
  return p;
}

export function getCurrentPrice(item: MenuItem | null | undefined): number {
  if (!item) return 0;
  return getCurrentPriceFromDetails(Number(item.primary_price) || 0, item.discount_details);
}

export function calculateSavings(
  primaryPrice: number,
  discountDetails: ItemDiscountDetails | null | undefined,
): number {
  const p = Number(primaryPrice) || 0;
  return Math.max(0, p - getCurrentPriceFromDetails(p, discountDetails));
}

// Numeric discount percentage (rounded, positive magnitude), 0 when there is no live
// reduction. The numeric counterpart to getDiscountBadgeText below — used where a
// component wants the number (e.g. the diner discount badge) rather than a "-X%" string.
export function getDiscountPercent(
  discountDetails: ItemDiscountDetails | null | undefined,
  primaryPrice: number,
): number {
  const p = Number(primaryPrice) || 0;
  if (p <= 0) return 0;
  const savings = calculateSavings(p, discountDetails);
  if (savings <= 0) return 0;
  return Math.round((savings / p) * 100);
}

export function getDiscountBadgeText(
  discountDetails: ItemDiscountDetails | null | undefined,
  primaryPrice: number,
): string {
  const pct = getDiscountPercent(discountDetails, primaryPrice);
  return pct > 0 ? `-${pct}%` : '';
}

// Server's authoritative live-now verdict for the diner menu payload. Missing
// flag → inactive (safe failure: never show/charge a discount we're unsure
// about). Distinct from the device-clock isDiscountActive above.
export function discountIsLive(item: MenuItem | null | undefined): boolean {
  return !!item?.is_discount_active;
}

// Server's effective BASE price (string Decimal); falls back to primary_price
// if absent/malformed (guards against NaN). NOT the device-clock getCurrentPrice.
export function serverEffectivePrice(item: MenuItem | null | undefined): number {
  const cp = item?.current_price;
  if (cp != null && cp !== '') {
    const n = Number(cp);
    if (!Number.isNaN(n)) return n;
  }
  return Number(item?.primary_price ?? 0) || 0;
}

/**
 * The SERVER's effective price for an EXTRA, from its own published verdict.
 *
 * The diner checkout used `getCurrentPriceFromDetails` here — the device-clock
 * rule below, which applies a percentage with `Math.round` to WHOLE units. So a
 * 999 extra at 10% off was shown at 899 while the server charged 899.10, and the
 * discrepancy grew with quantity. Two pricing rules on the one surface that has
 * to agree with the server.
 *
 * `current_price` is a canonical decimal string; it is parsed as a number here
 * because the basket's stored shape is numeric (see `line-money.ts` on why that
 * adapter is deliberate). An explicit `null` means the server cannot price this
 * extra — it is filtered out of the published menu, so this is defence in depth
 * — and yields 0 only after `extraPriceUnreadable` has had the chance to refuse
 * the selection.
 *
 * When the two keys are ABSENT (an operator-branch payload, or a response cached
 * before they shipped) it falls back to `primary_price`, the LIST price. It does
 * NOT fall back to the device-clock rule: that would keep the competing rule
 * alive on exactly the path this exists to clean up, and an un-discounted list
 * price is at worst an over-estimate the server's own review sheet corrects.
 */
export function serverEffectiveExtraPrice(
  extra: { primary_price?: unknown; current_price?: string | null } | null | undefined,
): number {
  const listPrice = Number(extra?.primary_price ?? 0) || 0;
  if (!extra || !('current_price' in extra)) return listPrice;
  const current = extra.current_price;
  if (current === null || current === undefined || current === '') return listPrice;
  const parsed = Number(current);
  return Number.isFinite(parsed) ? parsed : listPrice;
}

/** Does the SERVER report a live discount on this extra? Never inferred from
 *  `discount_details` and never from the device clock. */
export function serverExtraDiscountIsLive(
  extra: { is_discount_active?: boolean } | null | undefined,
): boolean {
  return !!extra?.is_discount_active;
}

/**
 * Does the server report this item's price as UNREADABLE?
 *
 * `current_price` is the server's own effective price. Since D02 the serializer
 * emits an explicit `null` there when the stored figures cannot be read as
 * money at all — a malformed `primary_price`, or a currently-scheduled discount
 * whose magnitude is unusable. That is a DIFFERENT fact from "no discount", and
 * the difference matters: `serverEffectivePrice` falls back to `primary_price`,
 * which for an unreadable item is a number the server would refuse to charge.
 *
 * The test is deliberately narrow — the key must be PRESENT and exactly `null`.
 * An ABSENT key means a payload that never carried the field, where the
 * pre-existing fallback is still the right answer. An item in this state is
 * already filtered out of the public menu server-side (`item_priceable` gates
 * `item_visible_in_menu`), so this is defence in depth against a stale or
 * directly-navigated screen, not the primary control.
 */
export function serverPriceUnreadable(item: MenuItem | null | undefined): boolean {
  return !!item && 'current_price' in item && (item as { current_price?: unknown }).current_price === null;
}

// Savings implied by the SERVER's effective price (primary_price − serverEffectivePrice),
// floored at 0. The server-truth counterpart to the device-clock calculateSavings above —
// shared by the diner surfaces that render a save amount off serverEffectivePrice (item-detail
// now; the menu card in PR2), replacing a hand-written duplicate of this subtraction.
export function serverSavings(item: MenuItem | null | undefined): number {
  const primary = Number(item?.primary_price) || 0;
  return Math.max(0, primary - serverEffectivePrice(item));
}
