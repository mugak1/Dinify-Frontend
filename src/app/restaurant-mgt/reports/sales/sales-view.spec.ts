import { getDay, parseISO } from 'date-fns';
import { SalesAggregateRow, SalesHourlyRow } from '../models/reports.models';
import {
  aggregateByWeekday,
  bestPoint,
  breakdownTotals,
  computeTotals,
  formatHourLabel,
  hourDisplayWindow,
  normalizeSeries,
  peakLabel,
  salesBucketView,
  toBreakdownRows,
  weekdayEligible,
  SalesPoint,
} from './sales-view';

describe('sales-view (pure)', () => {
  describe('salesBucketView', () => {
    it('maps each bucket to its source + breakdown title (year → annual)', () => {
      expect(salesBucketView('hour')).toEqual({ source: 'hourly', tableTitle: 'Hourly breakdown' });
      expect(salesBucketView('day')).toEqual({ source: 'daily', tableTitle: 'Daily breakdown' });
      expect(salesBucketView('month')).toEqual({ source: 'monthly', tableTitle: 'Monthly breakdown' });
      expect(salesBucketView('year')).toEqual({ source: 'annual', tableTitle: 'Yearly breakdown' });
    });
  });

  describe('formatHourLabel', () => {
    it('renders 12-hour clock labels', () => {
      expect(formatHourLabel(0)).toBe('12 AM');
      expect(formatHourLabel(11)).toBe('11 AM');
      expect(formatHourLabel(12)).toBe('12 PM');
      expect(formatHourLabel(13)).toBe('1 PM');
      expect(formatHourLabel(23)).toBe('11 PM');
    });
  });

  describe('normalizeSeries', () => {
    it('maps hourly rows (count → orders, hour → label)', () => {
      const rows: SalesHourlyRow[] = [{ hour: 13, count: 5, revenue: 100, discount: 10 }];
      expect(normalizeSeries(rows, 'hour')).toEqual([
        { label: '1 PM', key: '13', revenue: 100, orders: 5, discount: 10 },
      ]);
    });

    it('labels daily aggregate rows as "d MMM"', () => {
      const rows: SalesAggregateRow[] = [{ period: '2026-06-15', orders: 10, revenue: 1000, discount: 100 }];
      const [p] = normalizeSeries(rows, 'day');
      expect(p).toEqual({ label: '15 Jun', key: '2026-06-15', revenue: 1000, orders: 10, discount: 100 });
    });

    it('labels monthly aggregate rows as "MMM yyyy"', () => {
      const rows: SalesAggregateRow[] = [{ period: '2026-06', orders: 300, revenue: 50000, discount: 5000 }];
      expect(normalizeSeries(rows, 'month')[0].label).toBe('Jun 2026');
    });

    it('labels annual (year-bucket) aggregate rows as "yyyy"', () => {
      const rows: SalesAggregateRow[] = [{ period: '2024', orders: 30000, revenue: 5_000_000, discount: 500_000 }];
      const [p] = normalizeSeries(rows, 'year');
      expect(p.label).toBe('2024');
      expect(p.key).toBe('2024');
    });
  });

  describe('computeTotals', () => {
    it('sums orders/revenue/discount and derives gross + AOV', () => {
      const points: SalesPoint[] = [
        { label: 'a', key: 'a', revenue: 1000, orders: 10, discount: 100 },
        { label: 'b', key: 'b', revenue: 2000, orders: 20, discount: 200 },
      ];
      expect(computeTotals(points)).toEqual({
        orders: 30,
        gross: 3300, // revenue 3000 + discounts 300
        discounts: 300,
        revenue: 3000,
        aov: 100, // 3000 / 30
      });
    });

    it('guards AOV against zero orders', () => {
      expect(computeTotals([]).aov).toBe(0);
    });
  });

  describe('bestPoint', () => {
    it('returns the highest-revenue point, or null when empty', () => {
      const points: SalesPoint[] = [
        { label: 'a', key: 'a', revenue: 10, orders: 1, discount: 0 },
        { label: 'b', key: 'b', revenue: 99, orders: 1, discount: 0 },
      ];
      expect(bestPoint(points)?.key).toBe('b');
      expect(bestPoint([])).toBeNull();
    });
  });

  describe('aggregateByWeekday', () => {
    it('buckets revenue by weekday (Mon-first) and flags the best', () => {
      const rows: SalesAggregateRow[] = [
        { period: '2026-06-15', orders: 1, revenue: 500, discount: 0 },
        { period: '2026-06-16', orders: 1, revenue: 300, discount: 0 },
      ];
      const { days, bestWeekday } = aggregateByWeekday(rows);

      expect(days.map((d) => d.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
      expect(days.reduce((a, d) => a + d.revenue, 0)).toBe(800);
      // The richer day (the 15th, 500) wins.
      expect(bestWeekday).toBe(getDay(parseISO('2026-06-15')));
    });

    it('returns null best weekday when there is no revenue', () => {
      expect(aggregateByWeekday([]).bestWeekday).toBeNull();
    });
  });

  describe('weekdayEligible', () => {
    it('requires a daily bucket of at least ~2 weeks', () => {
      expect(weekdayEligible('day', 14)).toBeTrue();
      expect(weekdayEligible('day', 30)).toBeTrue();
      expect(weekdayEligible('day', 13)).toBeFalse();
      expect(weekdayEligible('hour', 1)).toBeFalse();
      expect(weekdayEligible('month', 400)).toBeFalse();
      expect(weekdayEligible('year', 800)).toBeFalse();
    });
  });

  describe('hourDisplayWindow', () => {
    const rows: SalesHourlyRow[] = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      count: h,
      revenue: h === 20 ? 1000 : h * 10, // dinner peak at 20:00
      discount: 0,
    }));

    it('slices to the 11:00–22:00 window with bar percentages + the peak', () => {
      const { bars, peakHour } = hourDisplayWindow(rows);
      expect(bars.length).toBe(12); // hours 11..22 inclusive
      expect(bars[0].hour).toBe(11);
      expect(bars[bars.length - 1].hour).toBe(22);
      expect(peakHour).toBe(20);
      const peakBar = bars.find((b) => b.hour === 20)!;
      expect(peakBar.pct).toBe(100);
      expect(peakBar.isPeak).toBeTrue();
    });
  });

  describe('peakLabel', () => {
    it('names lunch / dinner / other windows', () => {
      expect(peakLabel(13)).toBe('Lunch peak');
      expect(peakLabel(20)).toBe('Dinner peak');
      expect(peakLabel(9)).toBe('Busiest hour');
      expect(peakLabel(null)).toBe('');
    });
  });

  describe('breakdown rows', () => {
    const points: SalesPoint[] = [
      { label: '15 Jun', key: '2026-06-15', revenue: 1000, orders: 10, discount: 100 },
      { label: '16 Jun', key: '2026-06-16', revenue: 2000, orders: 20, discount: 200 },
    ];

    it('maps points to gross/discount/net rows with a hidden identity key', () => {
      expect(toBreakdownRows(points)).toEqual([
        { key: '2026-06-15', label: '15 Jun', orders: 10, gross: 1100, discount: 100, net: 1000 },
        { key: '2026-06-16', label: '16 Jun', orders: 20, gross: 2200, discount: 200, net: 2000 },
      ]);
    });

    it('totals the breakdown columns', () => {
      expect(breakdownTotals(points)).toEqual({ orders: 30, gross: 3300, discount: 300, net: 3000 });
    });
  });
});
