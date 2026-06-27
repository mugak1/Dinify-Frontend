import { DinersListingRow, DinersSummary } from '../models/reports.models';
import {
  dinerName,
  orderSplit,
  rankDiners,
  recentWindow,
  repeatBreakdown,
  repeatRate,
  sumIdentifiedOrders,
} from './diners-view';

function row(name: string, no_orders: number, total_spend: number): DinersListingRow {
  return {
    customer_id: name,
    name,
    phone_number: '+256700000000',
    no_orders,
    total_spend,
    average_spend: Math.round(total_spend / Math.max(1, no_orders)),
    last_order_date: '2026-06-10T10:00:00.000Z',
  };
}

describe('diners-view (pure)', () => {
  describe('dinerName', () => {
    it('uses the name, falls back to phone, then to Guest', () => {
      expect(dinerName({ name: 'Jane D', phone_number: '+2567' })).toBe('Jane D');
      expect(dinerName({ name: '  ', phone_number: '+2567' })).toBe('+2567');
      expect(dinerName({ name: '', phone_number: '' })).toBe('Guest');
    });
  });

  describe('sumIdentifiedOrders', () => {
    it('sums no_orders across the identified rows', () => {
      expect(sumIdentifiedOrders([row('a', 3, 100), row('b', 5, 200)])).toBe(8);
    });
  });

  describe('orderSplit', () => {
    it('splits at the ORDER level with consistent units', () => {
      expect(orderSplit(40, 160)).toEqual({
        identified: 40,
        guest: 160,
        total: 200,
        identifiedPct: 20,
        guestPct: 80,
      });
    });

    it('guards an all-zero window', () => {
      expect(orderSplit(0, 0).identifiedPct).toBe(0);
    });
  });

  describe('repeatBreakdown', () => {
    it('splits identified into repeat (>1 order) vs one-time', () => {
      expect(repeatBreakdown({ identifiedDiners: 10, repeatDiners: 4, guestOrders: 0, avgSpendPerDiner: 0 })).toEqual({
        repeat: 4,
        oneTime: 6,
        identified: 10,
        repeatPct: 40,
      });
    });

    it('clamps repeat to identified and handles null', () => {
      expect(repeatBreakdown({ identifiedDiners: 3, repeatDiners: 9, guestOrders: 0, avgSpendPerDiner: 0 }).repeat).toBe(3);
      expect(repeatBreakdown(null).identified).toBe(0);
    });
  });

  describe('repeatRate', () => {
    it('is repeat / identified as a percentage', () => {
      const s: DinersSummary = { identifiedDiners: 8, repeatDiners: 2, guestOrders: 0, avgSpendPerDiner: 0 };
      expect(repeatRate(s)).toBe(25);
      expect(repeatRate(null)).toBe(0);
    });
  });

  describe('rankDiners', () => {
    it('ranks by total spend descending', () => {
      const ranked = rankDiners([row('a', 1, 100), row('b', 1, 500), row('c', 1, 300)]);
      expect(ranked.map((r) => r.name)).toEqual(['b', 'c', 'a']);
    });
  });

  describe('recentWindow', () => {
    it('passes a ≤31-day range through, clamps a longer one to the recent 31 days', () => {
      expect(recentWindow({ preset: 'this-month', from: '2026-06-01', to: '2026-06-30' }).capped).toBeFalse();
      const w = recentWindow({ preset: 'this-year', from: '2026-01-01', to: '2026-12-31' });
      expect(w.capped).toBeTrue();
      expect(w.from).toBe('2026-11-30');
      expect(w.to).toBe('2026-12-31');
    });
  });
});
