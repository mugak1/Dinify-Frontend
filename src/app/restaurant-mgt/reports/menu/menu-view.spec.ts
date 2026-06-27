import { MenuRow } from '../models/reports.models';
import { categoryBars, menuTotals, rankItems } from './menu-view';

const ROWS: MenuRow[] = [
  { name: 'Pilau', order_count: 10, quantity_sold: 30, revenue: 300000 },
  { name: 'Rolex', order_count: 20, quantity_sold: 50, revenue: 100000 },
  { name: 'Soda', order_count: 5, quantity_sold: 20, revenue: 40000 },
];

describe('menu-view (pure)', () => {
  describe('menuTotals', () => {
    it('sums orders/units/revenue and derives avg item price', () => {
      expect(menuTotals(ROWS)).toEqual({
        orders: 35,
        units: 100,
        revenue: 440000,
        avgPrice: 4400, // 440000 / 100
      });
    });

    it('guards avg price against zero units', () => {
      expect(menuTotals([]).avgPrice).toBe(0);
    });
  });

  describe('rankItems', () => {
    it('ranks by revenue with share-of-total', () => {
      const ranked = rankItems(ROWS, 'revenue');
      expect(ranked.map((r) => r.name)).toEqual(['Pilau', 'Rolex', 'Soda']);
      expect(ranked[0].value).toBe(300000);
      expect(ranked[0].pct).toBeCloseTo((300000 / 440000) * 100, 5);
    });

    it('ranks by units (different order) and respects the limit', () => {
      const ranked = rankItems(ROWS, 'units', 2);
      expect(ranked.length).toBe(2);
      expect(ranked.map((r) => r.name)).toEqual(['Rolex', 'Pilau']); // 50 > 30 units
      expect(ranked[0].value).toBe(50);
    });

    it('returns zero pct for an empty set', () => {
      expect(rankItems([], 'revenue')).toEqual([]);
    });
  });

  describe('categoryBars', () => {
    it('sorts by revenue desc with width relative to the top category', () => {
      const bars = categoryBars(ROWS);
      expect(bars.map((b) => b.name)).toEqual(['Pilau', 'Rolex', 'Soda']);
      expect(bars[0].pct).toBe(100); // the max
      expect(bars[1].pct).toBe(Math.round((100000 / 300000) * 100));
    });
  });
});
