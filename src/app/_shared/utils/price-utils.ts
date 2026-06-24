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

export function getDiscountBadgeText(
  discountDetails: ItemDiscountDetails | null | undefined,
  primaryPrice: number,
): string {
  const p = Number(primaryPrice) || 0;
  if (p <= 0) return '';
  const savings = calculateSavings(p, discountDetails);
  if (savings <= 0) return '';
  return `-${Math.round((savings / p) * 100)}%`;
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

// Savings implied by the SERVER's effective price (primary_price − serverEffectivePrice),
// floored at 0. The server-truth counterpart to the device-clock calculateSavings above —
// shared by the diner surfaces that render a save amount off serverEffectivePrice (item-detail
// now; the menu card in PR2), replacing a hand-written duplicate of this subtraction.
export function serverSavings(item: MenuItem | null | undefined): number {
  const primary = Number(item?.primary_price) || 0;
  return Math.max(0, primary - serverEffectivePrice(item));
}
