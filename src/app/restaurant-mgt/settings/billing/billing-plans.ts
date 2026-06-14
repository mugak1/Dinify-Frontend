/**
 * Billing plan catalogue — the published monthly / yearly subscription tiers
 * rendered on the Billing section's plan cards.
 *
 * Pricing lives on the FRONTEND: there is no backend pricing endpoint, so these
 * are DISPLAY values for the cards. The amount actually charged is the
 * restaurant's configured `flat_fee`, surfaced in the status row and inside the
 * (unchanged) payment dialog — so the two can differ until a backend pricing
 * source exists.
 *
 * TODO(pricing): confirm the real monthly/yearly figures before merge. Yearly is
 * currently 10× monthly so the "2 months free" framing stays self-consistent;
 * `savingsUGX` in the component is derived from these two numbers.
 */
export type BillingCycle = 'monthly' | 'yearly';

export interface BillingPlan {
  cycle: BillingCycle;
  name: string;
  priceUGX: number;
  /** Trailing label after the price, e.g. "per month". */
  cadence: string;
  blurb: string;
}

// PLACEHOLDER pricing — see TODO above.
export const MONTHLY_PRICE_UGX = 150_000;
export const YEARLY_PRICE_UGX = 1_500_000;

/** Features common to every plan (monthly and yearly differ only by cadence). */
export const BILLING_PLAN_FEATURES: readonly string[] = [
  'QR-code menu & ordering',
  'Menu management',
  'Kitchen View order board',
  'Sales dashboard & reports',
];

export const BILLING_PLANS: readonly BillingPlan[] = [
  {
    cycle: 'monthly',
    name: 'Monthly',
    priceUGX: MONTHLY_PRICE_UGX,
    cadence: 'per month',
    blurb: 'Flexible billing, charged every month.',
  },
  {
    cycle: 'yearly',
    name: 'Yearly',
    priceUGX: YEARLY_PRICE_UGX,
    cadence: 'per year',
    blurb: 'Best value — billed once a year.',
  },
];
