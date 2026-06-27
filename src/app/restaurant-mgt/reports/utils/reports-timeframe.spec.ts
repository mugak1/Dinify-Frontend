import { differenceInCalendarDays, format, parseISO, subDays } from 'date-fns';
import { ReportDateRange, ReportPreset, presetToRange } from '../models/reports.models';
import {
  BUCKET_TO_CATEGORY,
  HOURLY_MAX_DAYS,
  SALES_TRENDS_CAP_DAYS,
  comparisonRange,
  resolveTimeframe,
} from './reports-timeframe';

describe('reports timeframe engine', () => {
  // Fixed reference date keeps month/week/year boundaries deterministic.
  const NOW = new Date(2026, 5, 15); // 15 Jun 2026 (local)
  const ANCHOR = '2026-06-15';

  /** A custom range whose calendar-day span (to − from) is exactly `span`, ending at ANCHOR. */
  function rangeOfSpan(span: number): ReportDateRange {
    return { preset: 'custom', from: format(subDays(parseISO(ANCHOR), span), 'yyyy-MM-dd'), to: ANCHOR };
  }

  const inclusiveLen = (r: ReportDateRange): number =>
    differenceInCalendarDays(parseISO(r.to), parseISO(r.from)) + 1;

  describe('constants mirror the backend caps', () => {
    it('pins the sales-trends day-span caps (incl. quarterly for completeness)', () => {
      expect(SALES_TRENDS_CAP_DAYS).toEqual({ daily: 31, monthly: 731, quarterly: 731, annual: 1850 });
      expect(HOURLY_MAX_DAYS).toBe(1);
    });

    it('maps each bucket to its sales-trends category (hour → none)', () => {
      expect(BUCKET_TO_CATEGORY).toEqual({
        hour: null,
        day: 'daily',
        month: 'monthly',
        year: 'annual',
      });
    });
  });

  describe('resolveTimeframe — auto-selection ladder', () => {
    it('buckets a single day (and a 1-day span) by hour, with no category', () => {
      for (const span of [0, 1]) {
        const r = resolveTimeframe(rangeOfSpan(span));
        expect(r.bucketUnit).toBe('hour');
        expect(r.category).toBeNull();
        expect(r.clamped).toBeFalse();
      }
    });

    it('buckets ≤ 31 days as daily', () => {
      for (const span of [2, 7, 30, 31]) {
        const r = resolveTimeframe(rangeOfSpan(span));
        expect(r.bucketUnit).toBe('day');
        expect(r.category).toBe('daily');
      }
    });

    it('buckets 32 … 731 days as monthly', () => {
      for (const span of [32, 90, 365, 731]) {
        const r = resolveTimeframe(rangeOfSpan(span));
        expect(r.bucketUnit).toBe('month');
        expect(r.category).toBe('monthly');
      }
    });

    it('buckets 732 … 1850 days as annual', () => {
      for (const span of [732, 1000, 1850]) {
        const r = resolveTimeframe(rangeOfSpan(span));
        expect(r.bucketUnit).toBe('year');
        expect(r.category).toBe('annual');
        expect(r.clamped).toBeFalse();
      }
    });

    it('does not clamp at exactly the annual cap (1850)', () => {
      const r = resolveTimeframe(rangeOfSpan(1850));
      expect(r.clamped).toBeFalse();
      expect(r.effectiveRange).toEqual(rangeOfSpan(1850));
    });
  });

  describe('resolveTimeframe — over-cap clamp', () => {
    it('clamps a span beyond the annual cap so the request stays within 1850 days', () => {
      const input = rangeOfSpan(2500);
      const r = resolveTimeframe(input);

      expect(r.bucketUnit).toBe('year');
      expect(r.category).toBe('annual');
      expect(r.clamped).toBeTrue();
      // `to` is preserved; `from` advances so the span === the annual cap.
      expect(r.effectiveRange.to).toBe(input.to);
      expect(differenceInCalendarDays(parseISO(r.effectiveRange.to), parseISO(r.effectiveRange.from))).toBe(
        SALES_TRENDS_CAP_DAYS.annual,
      );
      // The clamped range is now a legal annual request (not > cap).
      expect(resolveTimeframe(r.effectiveRange).clamped).toBeFalse();
    });
  });

  describe('comparisonRange — equivalent prior window', () => {
    it('always returns a computed (custom) window', () => {
      expect(comparisonRange(presetToRange('this-month', NOW)).preset).toBe('custom');
    });

    it('today → the prior single day; yesterday → the day before', () => {
      expect(comparisonRange(presetToRange('today', NOW))).toEqual({
        preset: 'custom',
        from: '2026-06-14',
        to: '2026-06-14',
      });
      expect(comparisonRange(presetToRange('yesterday', NOW))).toEqual({
        preset: 'custom',
        from: '2026-06-13',
        to: '2026-06-13',
      });
    });

    it('this-week → last-week (equal-length Mon–Sun window)', () => {
      const lw = presetToRange('last-week', NOW);
      expect(comparisonRange(presetToRange('this-week', NOW))).toEqual({
        preset: 'custom',
        from: lw.from,
        to: lw.to,
      });
    });

    it('last-week → the week before it (equal length, adjacent)', () => {
      const lw = presetToRange('last-week', NOW);
      const comp = comparisonRange(lw);
      expect(inclusiveLen(comp)).toBe(7);
      expect(differenceInCalendarDays(parseISO(lw.from), parseISO(comp.to))).toBe(1); // adjacent
    });

    it('this-month → the FULL prior calendar month (May, not a 30-day shift)', () => {
      expect(comparisonRange(presetToRange('this-month', NOW))).toEqual({
        preset: 'custom',
        from: '2026-05-01',
        to: '2026-05-31',
      });
    });

    it('last-month → the month before it (April)', () => {
      expect(comparisonRange(presetToRange('last-month', NOW))).toEqual({
        preset: 'custom',
        from: '2026-04-01',
        to: '2026-04-30',
      });
    });

    it('this-year → the full prior calendar year', () => {
      expect(comparisonRange(presetToRange('this-year', NOW))).toEqual({
        preset: 'custom',
        from: '2025-01-01',
        to: '2025-12-31',
      });
    });

    it('custom N-day windows → an equal-length window immediately before', () => {
      for (const span of [0, 13, 199]) {
        const range = rangeOfSpan(span);
        const comp = comparisonRange(range);
        expect(comp.preset).toBe('custom');
        // Equal inclusive length…
        expect(inclusiveLen(comp)).toBe(inclusiveLen(range));
        // …sitting immediately before the source range.
        expect(differenceInCalendarDays(parseISO(range.from), parseISO(comp.to))).toBe(1);
      }
    });
  });

  it('covers every preset without throwing', () => {
    const presets: ReportPreset[] = [
      'today',
      'yesterday',
      'this-week',
      'last-week',
      'this-month',
      'last-month',
      'this-year',
      'custom',
    ];
    for (const p of presets) {
      const range = presetToRange(p, NOW);
      expect(() => comparisonRange(range)).not.toThrow();
      expect(() => resolveTimeframe(range)).not.toThrow();
    }
  });
});
