import {
  formatUGX,
  isDiscountActive,
  getCurrentPrice,
  getCurrentPriceFromDetails,
  calculateSavings,
  getDiscountBadgeText,
  discountIsLive,
  serverEffectivePrice,
} from './price-utils';
import { DiscountDetails, MenuItem } from 'src/app/_models/app.models';

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

function pct(percentage: number): DiscountDetails {
  return {
    discount_type: 'percentage',
    discount_percentage: percentage,
    discount_amount: 0,
    recurring_days: ALL_DAYS,
    start_date: '',
    end_date: '',
    start_time: '',
    end_time: '',
  };
}

function fixed(amount: number): DiscountDetails {
  return {
    discount_type: 'fixed',
    discount_percentage: 0,
    discount_amount: amount,
    recurring_days: ALL_DAYS,
    start_date: '',
    end_date: '',
    start_time: '',
    end_time: '',
  };
}

function makeItem(
  primary: number,
  dd: DiscountDetails | null = null,
  server: { is_discount_active?: boolean; current_price?: string } = {},
): MenuItem {
  return {
    id: 'x',
    name: 'x',
    description: '',
    primary_price: String(primary),
    discounted_price: null,
    running_discount: !!dd,
    image: null,
    section: 'sec-x',
    group: null,
    available: true,
    in_stock: true,
    is_extra: false,
    is_special: false,
    is_featured: false,
    is_popular: false,
    is_new: false,
    has_options: false,
    options: { hasModifiers: false, groups: [] },
    has_extras: false,
    extras: [],
    tags: [],
    allergens: [],
    discount_details: dd,
    discount_percentage: 0,
    calories: null,
    ...server,
  };
}

describe('price-utils', () => {
  describe('formatUGX', () => {
    it('formats numeric values with locale separators', () => {
      expect(formatUGX(10000)).toBe('UGX 10,000');
    });

    it('handles null/NaN safely', () => {
      expect(formatUGX(null as any)).toBe('UGX 0');
      expect(formatUGX(NaN)).toBe('UGX 0');
    });
  });

  describe('isDiscountActive', () => {
    it('returns false for null details', () => {
      expect(isDiscountActive(null)).toBe(false);
    });

    it('returns false when both percentage and amount are zero', () => {
      expect(isDiscountActive({ discount_percentage: 0, discount_amount: 0, recurring_days: ALL_DAYS })).toBe(false);
    });

    it('returns true for percentage > 0', () => {
      expect(isDiscountActive(pct(20))).toBe(true);
    });

    it('returns true for amount > 0', () => {
      expect(isDiscountActive(fixed(2000))).toBe(true);
    });

    it('returns false when today is not in recurring_days', () => {
      const dd = pct(20);
      const jsDay = new Date().getDay();
      const todayBackend = jsDay === 0 ? 7 : jsDay;
      dd.recurring_days = ALL_DAYS.filter(d => d !== todayBackend);
      expect(isDiscountActive(dd)).toBe(false);
    });
  });

  describe('getCurrentPriceFromDetails', () => {
    it('returns primary when no discount', () => {
      expect(getCurrentPriceFromDetails(10000, null)).toBe(10000);
    });

    it('applies percentage 20% on 10000 -> 8000', () => {
      expect(getCurrentPriceFromDetails(10000, pct(20))).toBe(8000);
    });

    it('applies fixed 2000 on 10000 -> 8000', () => {
      expect(getCurrentPriceFromDetails(10000, fixed(2000))).toBe(8000);
    });

    it('clamps percentage 100 to 0', () => {
      expect(getCurrentPriceFromDetails(10000, pct(100))).toBe(0);
    });

    it('clamps fixed > primary to 0', () => {
      expect(getCurrentPriceFromDetails(10000, fixed(15000))).toBe(0);
    });
  });

  describe('getCurrentPrice', () => {
    it('reads from MenuItem wrapper', () => {
      expect(getCurrentPrice(makeItem(10000, pct(20)))).toBe(8000);
      expect(getCurrentPrice(makeItem(10000, fixed(2000)))).toBe(8000);
      expect(getCurrentPrice(makeItem(10000, null))).toBe(10000);
    });

    it('returns 0 for null item', () => {
      expect(getCurrentPrice(null)).toBe(0);
    });
  });

  describe('calculateSavings', () => {
    it('matches primary - currentPrice for percentage', () => {
      expect(calculateSavings(10000, pct(20))).toBe(2000);
    });

    it('matches primary - currentPrice for fixed', () => {
      expect(calculateSavings(10000, fixed(2000))).toBe(2000);
    });

    it('returns 0 when no discount', () => {
      expect(calculateSavings(10000, null)).toBe(0);
    });

    it('clamps at 0 for over-large fixed', () => {
      expect(calculateSavings(10000, fixed(15000))).toBe(10000);
    });
  });

  describe('getDiscountBadgeText', () => {
    it('returns -20% for percentage 20', () => {
      expect(getDiscountBadgeText(pct(20), 10000)).toBe('-20%');
    });

    it('returns -20% for fixed 2000 on 10000', () => {
      expect(getDiscountBadgeText(fixed(2000), 10000)).toBe('-20%');
    });

    it('returns empty string when no discount', () => {
      expect(getDiscountBadgeText(null, 10000)).toBe('');
    });

    it('returns empty string when primary is zero', () => {
      expect(getDiscountBadgeText(pct(20), 0)).toBe('');
    });
  });

  describe('discountIsLive (server verdict)', () => {
    it('returns the is_discount_active flag', () => {
      expect(discountIsLive(makeItem(10000, null, { is_discount_active: true }))).toBe(true);
      expect(discountIsLive(makeItem(10000, null, { is_discount_active: false }))).toBe(false);
    });

    it('treats a missing flag or nullish item as inactive', () => {
      expect(discountIsLive(makeItem(10000, null))).toBe(false);
      expect(discountIsLive(null)).toBe(false);
      expect(discountIsLive(undefined)).toBe(false);
    });
  });

  describe('serverEffectivePrice (server base price)', () => {
    it('returns current_price when present', () => {
      expect(serverEffectivePrice(makeItem(10000, null, { current_price: '8000.00' }))).toBe(8000);
    });

    it('falls back to primary_price when current_price is missing/empty/non-numeric', () => {
      expect(serverEffectivePrice(makeItem(10000, null))).toBe(10000);
      expect(serverEffectivePrice(makeItem(10000, null, { current_price: '' }))).toBe(10000);
      expect(serverEffectivePrice(makeItem(10000, null, { current_price: 'abc' }))).toBe(10000);
    });

    it('returns 0 for a nullish item', () => {
      expect(serverEffectivePrice(null)).toBe(0);
      expect(serverEffectivePrice(undefined)).toBe(0);
    });
  });
});
