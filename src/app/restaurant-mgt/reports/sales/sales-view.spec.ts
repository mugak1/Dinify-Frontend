import { addDays, format, getDay, parseISO } from 'date-fns';
import { ReportBucketUnit, SeriesPairing } from '../../../_shared/timeframe';
import { SalesAggregateRow, SalesHourlyRow } from '../models/reports.models';
import {
  aggregateByWeekday,
  alignComparisonSeries,
  pointDateLabel,
  bestPoint,
  breakdownTotals,
  computeTotals,
  formatHourLabel,
  hourDisplayWindow,
  normalizeSeries,
  peakLabel,
  salesBucketView,
  toBreakdownRows,
  tradingBuckets,
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
    // A `null` window is the "do not densify" escape hatch, so it is what the pure
    // shape/labelling cases below use — they are about mapping, not filling.
    it('maps hourly rows (count → orders, hour → label)', () => {
      const rows: SalesHourlyRow[] = [{ hour: 13, count: 5, revenue: 100, discount: 10 }];
      expect(normalizeSeries(rows, 'hour', null)).toEqual([
        { label: '1 PM', key: '13', revenue: 100, orders: 5, discount: 10 },
      ]);
    });

    it('labels daily aggregate rows as "d MMM"', () => {
      const rows: SalesAggregateRow[] = [{ period: '2026-06-15', orders: 10, revenue: 1000, discount: 100 }];
      const [p] = normalizeSeries(rows, 'day', null);
      expect(p).toEqual({ label: '15 Jun', key: '2026-06-15', revenue: 1000, orders: 10, discount: 100 });
    });

    it('labels monthly aggregate rows as "MMM yyyy"', () => {
      const rows: SalesAggregateRow[] = [{ period: '2026-06', orders: 300, revenue: 50000, discount: 5000 }];
      expect(normalizeSeries(rows, 'month', null)[0].label).toBe('Jun 2026');
    });

    it('labels annual (year-bucket) aggregate rows as "yyyy"', () => {
      const rows: SalesAggregateRow[] = [{ period: '2024', orders: 30000, revenue: 5_000_000, discount: 500_000 }];
      const [p] = normalizeSeries(rows, 'year', null);
      expect(p.label).toBe('2024');
      expect(p.key).toBe('2024');
    });
  });

  // ─── Densification ────────────────────────────────────────────────────────────────
  //
  // The backend zero-fills only the hourly path; a period with no orders yields no bucket at
  // all. Left sparse, the x-axis omits closed days outright and every index after a gap shifts,
  // which misaligns the comparison series under BOTH pairings.
  describe('normalizeSeries — zero-fill to the window', () => {
    const day = (period: string, orders: number): SalesAggregateRow => ({
      period,
      orders,
      revenue: orders * 100,
      discount: orders,
    });

    it('fills a missing DAY bucket with a labelled zero point, in order', () => {
      // Tue 2 Jun is absent from the wire — the restaurant was closed.
      const rows = [day('2026-06-01', 10), day('2026-06-03', 30)];
      const points = normalizeSeries(rows, 'day', { from: '2026-06-01', to: '2026-06-03' });

      expect(points.map((p) => p.key)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
      expect(points[1]).toEqual({
        label: '2 Jun',
        key: '2026-06-02',
        revenue: 0,
        orders: 0,
        discount: 0,
      });
    });

    it('fills MONTH and YEAR buckets in their own wire key formats', () => {
      const months = normalizeSeries([day('2026-06', 5)], 'month', {
        from: '2026-05-15',
        to: '2026-07-04',
      });
      expect(months.map((p) => p.key)).toEqual(['2026-05', '2026-06', '2026-07']);
      expect(months[0].label).toBe('May 2026'); // a filled bucket still labels correctly

      const years = normalizeSeries([day('2025', 5)], 'year', {
        from: '2024-03-01',
        to: '2026-02-01',
      });
      expect(years.map((p) => p.key)).toEqual(['2024', '2025', '2026']);
      expect(years[2].label).toBe('2026');
    });

    it('returns the rows verbatim for a NULL window — the "none" comparison basis', () => {
      // The distinction is load-bearing: no request was made, so a run of zero points would be
      // a baseline the user explicitly asked not to have.
      const rows = [day('2026-06-01', 10), day('2026-06-03', 30)];
      expect(normalizeSeries(rows, 'day', null).map((p) => p.key)).toEqual([
        '2026-06-01',
        '2026-06-03',
      ]);
      expect(normalizeSeries([], 'day', null)).toEqual([]);
    });

    it('leaves the HOUR bucket alone even when handed a window', () => {
      // Its key is '0'…'23' — no date for a window to enumerate, and it is already dense on
      // both the backend and the mock.
      const rows: SalesHourlyRow[] = [{ hour: 13, count: 5, revenue: 100, discount: 10 }];
      const points = normalizeSeries(rows, 'hour', { from: '2026-06-01', to: '2026-06-01' });
      expect(points.map((p) => p.key)).toEqual(['13']);
    });

    it('drops a bucket outside the window — the window DEFINES the series', () => {
      // Unreachable against a real fetch (both request exactly this window); carrying it would
      // put an out-of-sequence label on the axis.
      const rows = [day('2026-05-30', 10), day('2026-06-01', 10)];
      const points = normalizeSeries(rows, 'day', { from: '2026-06-01', to: '2026-06-02' });
      expect(points.map((p) => p.key)).toEqual(['2026-06-01', '2026-06-02']);
    });

    it('changes NO total — zero buckets add zero to every accumulator', () => {
      // The claim the whole change rests on: this is an axis fix, not a numbers change.
      const rows = [day('2026-06-01', 10), day('2026-06-03', 30)];
      const sparse = normalizeSeries(rows, 'day', null);
      const dense = normalizeSeries(rows, 'day', { from: '2026-06-01', to: '2026-06-05' });

      expect(dense.length).toBe(5);
      expect(sparse.length).toBe(2);
      expect(computeTotals(dense)).toEqual(computeTotals(sparse));
      expect(breakdownTotals(dense)).toEqual(breakdownTotals(sparse));
    });
  });

  describe('tradingBuckets', () => {
    const pt = (key: string, orders: number): SalesPoint => ({
      label: key,
      key,
      orders,
      revenue: orders * 100,
      discount: 0,
    });

    it('counts only buckets that took an order', () => {
      expect(tradingBuckets([pt('a', 3), pt('b', 0), pt('c', 7)])).toBe(2);
      expect(tradingBuckets([])).toBe(0);
    });

    it('is what keeps a per-day average stable across densification', () => {
      const rows: SalesAggregateRow[] = [
        { period: '2026-06-01', orders: 10, revenue: 1000, discount: 0 },
        { period: '2026-06-03', orders: 10, revenue: 1000, discount: 0 },
      ];
      const sparse = normalizeSeries(rows, 'day', null);
      const dense = normalizeSeries(rows, 'day', { from: '2026-06-01', to: '2026-06-05' });

      // `points.length` moves 2 → 5; the trading-day count does not, which is the point.
      expect(dense.length).not.toBe(sparse.length);
      expect(tradingBuckets(dense)).toBe(tradingBuckets(sparse));
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
  // ─── Comparison-series pairing (TIMEFRAME-02C) ───────────────────────────────────────
  //
  // July 2026 opens on a WEDNESDAY, June 2026 on a MONDAY. Every expectation below is
  // hand-derived from those two facts rather than from the implementation's own arithmetic.

  describe('alignComparisonSeries', () => {
    /** A dense daily series over `count` days from `from`, revenue = the day-of-month. */
    const series = (from: string, count: number): SalesPoint[] =>
      Array.from({ length: count }, (_, i) => {
        const key = format(addDays(parseISO(from), i), 'yyyy-MM-dd');
        return { label: format(parseISO(key), 'd MMM'), key, revenue: i + 1, orders: 1, discount: 0 };
      });

    const july = series('2026-07-01', 31);
    const june = series('2026-06-01', 30);

    it('pairs by INDEX under by-date — position N against position N', () => {
      const aligned = alignComparisonSeries(july, june, 'by-date', 'day');

      // Index 4 is Sun 5 Jul; by DATE it reads index 4 of June, which is Fri 5 Jun.
      expect(aligned[4]!.key).toBe('2026-06-05');
      expect(aligned[0]!.key).toBe('2026-06-01');
    });

    it('shifts by the opening-weekday difference under by-day, so weekdays meet', () => {
      const aligned = alignComparisonSeries(july, june, 'by-day', 'day');

      // Wed(2) − Mon(0) = offset 2. Index 4 (Sun 5 Jul) reads index 6 (Sun 7 Jun).
      expect(aligned[4]!.key).toBe('2026-06-07');
      expect(getDay(parseISO(aligned[4]!.key))).toBe(getDay(parseISO(july[4].key)));
      // …and that holds for every paired point, which is the whole promise of by-day.
      for (const [i, cmp] of aligned.entries()) {
        if (!cmp) continue;
        expect(getDay(parseISO(cmp.key)))
          .withContext(`index ${i}: ${july[i].key} vs ${cmp.key}`)
          .toBe(getDay(parseISO(july[i].key)));
      }
    });

    it('yields null past the end of the comparison series — never wraps, never clamps', () => {
      const aligned = alignComparisonSeries(july, june, 'by-day', 'day');

      // 31 primary days, 30 comparison days, offset 2 → the last 3 have nothing to read.
      expect(aligned.length).toBe(31);
      expect(aligned.filter((p) => p === null).length).toBe(3);
      expect(aligned.slice(-3).every((p) => p === null)).toBeTrue();
      // A wrap would have put the series' own start at the end; a clamp its own end.
      expect(aligned[30]).toBeNull();
    });

    // RESIDUAL ROBUSTNESS, not a pipeline case. `normalizeSeries` now densifies both series to
    // their windows, so production never hands this function a gap — but it is exported and
    // pure, so the two specs below pin the FUNCTION rather than the pipeline. They are why the
    // offset stays data-derived: dropping a leading element shifts every index down by one AND
    // advances the observed opening weekday by one, and the two cancel, so reading the offset
    // off the data self-corrects where one computed from window bounds would not.
    it('is unaffected by a MISSING FIRST comparison bucket', () => {
      const sparseJune = june.slice(1); // no trade on Mon 1 Jun
      const dense = alignComparisonSeries(july, june, 'by-day', 'day');
      const sparse = alignComparisonSeries(july, sparseJune, 'by-day', 'day');

      // Offset falls 2 → 1, so index 4 lands on sparseJune[5] — the SAME point, Sun 7 Jun.
      expect(sparse[4]!.key).toBe('2026-06-07');
      expect(sparse[4]!.key).toBe(dense[4]!.key);
    });

    it('self-corrects for a leading gap in EITHER series', () => {
      const sparseJuly = july.slice(1); // no trade on Wed 1 Jul
      const aligned = alignComparisonSeries(sparseJuly, june, 'by-day', 'day');

      // sparseJuly[0] is Thu 2 Jul; offset becomes 3, so it reads june[3] = Thu 4 Jun.
      expect(getDay(parseISO(aligned[0]!.key))).toBe(getDay(parseISO(sparseJuly[0].key)));
      expect(aligned[0]!.key).toBe('2026-06-04');
    });

    it('falls back to index pairing when either series is empty', () => {
      expect(alignComparisonSeries(july, [], 'by-day', 'day').every((p) => p === null)).toBeTrue();
      expect(alignComparisonSeries([], june, 'by-day', 'day')).toEqual([]);
    });

    // Weekday alignment is meaningless once buckets are months, and impossible for `hour`,
    // where `key` is '0'…'23' and parsing it as a date would throw or lie.
    it('ignores pairing for any bucket other than day', () => {
      const hours: SalesPoint[] = [0, 1, 2].map((h) => ({
        label: `${h}`, key: String(h), revenue: h, orders: 1, discount: 0,
      }));
      for (const bucket of ['hour', 'month', 'year'] as ReportBucketUnit[]) {
        const aligned = alignComparisonSeries(hours, hours, 'by-day', bucket);
        expect(aligned.map((p) => p!.key)).withContext(bucket).toEqual(['0', '1', '2']);
      }
    });

    it('always returns one entry per PRIMARY index, under either pairing', () => {
      for (const pairing of ['by-day', 'by-date'] as SeriesPairing[]) {
        expect(alignComparisonSeries(july, june, pairing, 'day').length).toBe(july.length);
        expect(alignComparisonSeries([], june, pairing, 'day').length).toBe(0);
      }
    });
  });

  describe('pointDateLabel', () => {
    const point = (key: string, label: string): SalesPoint => ({
      label, key, revenue: 0, orders: 0, discount: 0,
    });

    // The day label is '15 Jun' with NO YEAR, so beside a dates-last-year comparison it
    // would print a date indistinguishable from the primary's. Formatted from `key` instead.
    it('formats a day bucket from key, WITH the year', () => {
      expect(pointDateLabel(point('2026-06-15', '15 Jun'), 'day')).toBe('15 Jun 2026');
      expect(pointDateLabel(point('2025-06-15', '15 Jun'), 'day')).toBe('15 Jun 2025');
    });

    it('reuses the label for buckets whose label is already unambiguous', () => {
      expect(pointDateLabel(point('2026-06', 'Jun 2026'), 'month')).toBe('Jun 2026');
      expect(pointDateLabel(point('2026', '2026'), 'year')).toBe('2026');
      expect(pointDateLabel(point('13', '1 PM'), 'hour')).toBe('1 PM');
    });
  });
});
