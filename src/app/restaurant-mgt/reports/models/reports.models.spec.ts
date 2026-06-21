import { differenceInCalendarDays, getDay, parseISO } from 'date-fns';
import {
  defaultRange,
  isValidReportDateRange,
  presetToRange,
} from './reports.models';

describe('reports.models helpers', () => {
  // Fixed reference date keeps month/week boundaries deterministic.
  const now = new Date(2026, 5, 15); // 15 Jun 2026 (local)

  describe('presetToRange', () => {
    it('maps single-day presets', () => {
      expect(presetToRange('today', now)).toEqual({ preset: 'today', from: '2026-06-15', to: '2026-06-15' });
      expect(presetToRange('yesterday', now)).toEqual({
        preset: 'yesterday',
        from: '2026-06-14',
        to: '2026-06-14',
      });
    });

    it('maps month and year presets', () => {
      expect(presetToRange('this-month', now)).toEqual({
        preset: 'this-month',
        from: '2026-06-01',
        to: '2026-06-30',
      });
      expect(presetToRange('last-month', now)).toEqual({
        preset: 'last-month',
        from: '2026-05-01',
        to: '2026-05-31',
      });
      expect(presetToRange('this-year', now)).toEqual({
        preset: 'this-year',
        from: '2026-01-01',
        to: '2026-12-31',
      });
    });

    it('maps week presets to a Monday→Sunday span', () => {
      const tw = presetToRange('this-week', now);
      expect(getDay(parseISO(tw.from))).toBe(1); // Monday
      expect(differenceInCalendarDays(parseISO(tw.to), parseISO(tw.from))).toBe(6);

      const lw = presetToRange('last-week', now);
      expect(getDay(parseISO(lw.from))).toBe(1);
      expect(differenceInCalendarDays(parseISO(lw.to), parseISO(lw.from))).toBe(6);
      // Last week ends the day before this week starts.
      expect(differenceInCalendarDays(parseISO(tw.from), parseISO(lw.to))).toBe(1);
    });

    it('defaults to this-month (always ≤31 days)', () => {
      const d = defaultRange(now);
      expect(d.preset).toBe('this-month');
      expect(differenceInCalendarDays(parseISO(d.to), parseISO(d.from))).toBeLessThanOrEqual(31);
    });
  });

  describe('isValidReportDateRange', () => {
    it('accepts a well-formed range', () => {
      expect(isValidReportDateRange({ preset: 'today', from: '2026-06-15', to: '2026-06-15' })).toBeTrue();
    });

    it('rejects bad presets, bad dates, inverted ranges and non-objects', () => {
      expect(isValidReportDateRange({ preset: 'nope', from: '2026-06-15', to: '2026-06-15' })).toBeFalse();
      expect(isValidReportDateRange({ preset: 'today', from: '2026/06/15', to: '2026-06-15' })).toBeFalse();
      expect(isValidReportDateRange({ preset: 'today', from: '2026-06-16', to: '2026-06-15' })).toBeFalse();
      expect(isValidReportDateRange(null)).toBeFalse();
      expect(isValidReportDateRange('today')).toBeFalse();
    });
  });
});
