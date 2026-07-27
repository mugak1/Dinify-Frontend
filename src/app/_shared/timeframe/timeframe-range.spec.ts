import { differenceInCalendarDays, getDay, parseISO } from 'date-fns';
import {
  REPORT_PRESETS,
  defaultRange,
  isFutureDated,
  isValidReportDateRange,
  parseTimeframeParams,
  presetToRange,
  rangeIncludesToday,
} from './timeframe-range';

describe('timeframe range model', () => {
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

    // ── In-progress presets end at TODAY, not at the end of the period ──
    it('clamps this-month to month-to-date, leaving last-month whole', () => {
      expect(presetToRange('this-month', now)).toEqual({
        preset: 'this-month',
        from: '2026-06-01',
        to: '2026-06-15', // today, NOT 2026-06-30
      });
      // A closed period is already wholly in the past — untouched.
      expect(presetToRange('last-month', now)).toEqual({
        preset: 'last-month',
        from: '2026-05-01',
        to: '2026-05-31',
      });
    });

    it('clamps this-year to year-to-date', () => {
      expect(presetToRange('this-year', now)).toEqual({
        preset: 'this-year',
        from: '2026-01-01',
        to: '2026-06-15', // today, NOT 2026-12-31
      });
    });

    it('clamps this-week to week-to-date, keeping the Monday start', () => {
      const tw = presetToRange('this-week', now);
      expect(getDay(parseISO(tw.from))).toBe(1); // Monday
      expect(tw.to).toBe('2026-06-15'); // today — the reference date IS a Monday,
      expect(tw.from).toBe('2026-06-15'); // so week-to-date is a single day here
    });

    it('leaves last-week a whole Monday→Sunday span, adjacent to this week', () => {
      const tw = presetToRange('this-week', now);
      const lw = presetToRange('last-week', now);
      expect(getDay(parseISO(lw.from))).toBe(1); // Monday
      expect(differenceInCalendarDays(parseISO(lw.to), parseISO(lw.from))).toBe(6);
      // Last week ends the day before this week starts.
      expect(differenceInCalendarDays(parseISO(tw.from), parseISO(lw.to))).toBe(1);
    });

    it('never emits a bound past today, for any preset', () => {
      const today = '2026-06-15';
      for (const p of REPORT_PRESETS) {
        const r = presetToRange(p, now);
        expect(r.from <= today)
          .withContext(`${p} from=${r.from}`)
          .toBeTrue();
        expect(r.to <= today)
          .withContext(`${p} to=${r.to}`)
          .toBeTrue();
      }
    });

    it('defaults to month-to-date (always ≤31 days)', () => {
      const d = defaultRange(now);
      expect(d.preset).toBe('this-month');
      expect(d.to).toBe('2026-06-15'); // ends today, not at month-end
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

    it('does NOT range-check against today — that is isFutureDated\'s job', () => {
      // Kept as a separate rule so the seed can be shape-validated without also
      // asserting recency; the URL parser composes the two.
      expect(isValidReportDateRange({ preset: 'custom', from: '2999-01-01', to: '2999-01-02' })).toBeTrue();
    });
  });

  describe('isFutureDated', () => {
    it('flags a bound after today, and only that', () => {
      expect(isFutureDated({ from: '2026-06-01', to: '2026-06-15' }, now)).toBeFalse(); // to === today
      expect(isFutureDated({ from: '2026-06-01', to: '2026-06-16' }, now)).toBeTrue();
      expect(isFutureDated({ from: '2026-06-16', to: '2026-06-20' }, now)).toBeTrue();
    });
  });

  describe('parseTimeframeParams', () => {
    const parse = (
      from: string | null,
      to: string | null,
      preset: string | null = null,
      cmp: string | null = null,
      cmpFrom: string | null = null,
    ) => parseTimeframeParams({ from, to, preset, cmp, cmpFrom }, now);

    it('accepts a valid, past-bounded pair and keeps a known preset', () => {
      expect(parse('2026-06-01', '2026-06-15', 'this-month')).toEqual({
        range: { preset: 'this-month', from: '2026-06-01', to: '2026-06-15' },
        comparison: null,
        customFrom: null,
      });
    });

    it('coerces an absent or unrecognised preset to custom rather than rejecting', () => {
      expect(parse('2026-06-01', '2026-06-10')).toEqual({
        range: { preset: 'custom', from: '2026-06-01', to: '2026-06-10' },
        comparison: null,
        customFrom: null,
      });
      expect(parse('2026-06-01', '2026-06-10', 'banana')).toEqual({
        range: { preset: 'custom', from: '2026-06-01', to: '2026-06-10' },
        comparison: null,
        customFrom: null,
      });
    });

    // The `cmp` param joined this parser in 02A rather than getting one of its own, so
    // there stays exactly ONE place an untrusted timeframe URL is made safe.
    it('carries a known cmp token through', () => {
      expect(parse('2026-06-01', '2026-06-15', 'this-month', 'prev-year')?.comparison).toBe(
        'prev-year',
      );
      expect(parse('2026-06-01', '2026-06-15', 'this-month', 'none')?.comparison).toBe('none');
    });

    it('treats an unrecognised cmp as ABSENT — never as a reason to reject the range', () => {
      const parsed = parse('2026-06-01', '2026-06-15', 'this-month', 'banana');
      expect(parsed).not.toBeNull();
      expect(parsed!.range.from).toBe('2026-06-01'); // the range still stands
      expect(parsed!.comparison).toBeNull();
    });

    // Whether a basis is OFFERED for this range is a shape question, and shape lives in
    // timeframe-engine, which imports this file — so it cannot be asked here. The parser
    // only vouches for the token; TimeframeService applies the shape gate.
    it('does not shape-check a known cmp — that is the service\'s job', () => {
      // 'prev-month-by-day' is not offered for a single-day range, yet the token is known.
      expect(parse('2026-06-15', '2026-06-15', 'today', 'prev-month-by-day')?.comparison).toBe(
        'prev-month-by-day',
      );
    });

    // `cmpFrom` (TIMEFRAME-02D) joined this parser too, for the same reason `cmp` did.
    describe('cmpFrom — the custom window start', () => {
      it('carries a real date through, but only alongside cmp=custom', () => {
        expect(
          parse('2026-06-01', '2026-06-15', 'this-month', 'custom', '2026-04-01')?.customFrom,
        ).toBe('2026-04-01');
      });

      it('drops it when the basis is anything else', () => {
        // Not a partially-valid state worth preserving: under any other basis the start
        // names nothing the page renders.
        expect(
          parse('2026-06-01', '2026-06-15', 'this-month', 'prev-year', '2026-04-01')?.customFrom,
        ).toBeNull();
        expect(parse('2026-06-01', '2026-06-15', 'this-month', null, '2026-04-01')?.customFrom).toBeNull();
      });

      it('drops an unreal date and never rejects the range for it', () => {
        const parsed = parse('2026-06-01', '2026-06-15', 'this-month', 'custom', '2026-02-31');
        expect(parsed).not.toBeNull();
        expect(parsed!.range.from).toBe('2026-06-01'); // the range still stands
        expect(parsed!.customFrom).toBeNull();
        expect(parse('2026-06-01', '2026-06-15', 'this-month', 'custom', 'banana')?.customFrom).toBeNull();
      });

      // Whether the start is REACHABLE — non-overlapping, not future-dated — depends on the
      // range's LENGTH, and that is a window question. Same split as the `cmp` shape gate
      // directly above: the parser vouches for the token, the service for the window.
      it('does not bound-check the start — that is the service\'s job', () => {
        // Wildly overlapping (it sits inside the range), yet a perfectly real date.
        expect(
          parse('2026-06-01', '2026-06-15', 'this-month', 'custom', '2026-06-10')?.customFrom,
        ).toBe('2026-06-10');
      });
    });

    it('returns null for absent, malformed, inverted or future params — never throws', () => {
      expect(() => parse(null, null)).not.toThrow();
      expect(parse(null, null)).toBeNull();
      expect(parse('2026-06-01', null)).toBeNull(); // incomplete pair
      expect(parse('2026-13-45', '2026-06-15')).toBeNull(); // unparseable
      expect(parse('2026/06/01', '2026-06-15')).toBeNull(); // wrong separator
      expect(parse('2026-06-10', '2026-06-01')).toBeNull(); // inverted
      expect(parse('2026-06-01', '2999-01-01')).toBeNull(); // future `to`
      expect(parse('2999-01-01', '2999-01-02')).toBeNull(); // wholly future
    });

    it('rejects a regex-shaped but non-existent calendar date', () => {
      // 2026 is not a leap year, and February never has 31 days.
      expect(parse('2026-02-29', '2026-06-15')).toBeNull();
      expect(parse('2026-06-01', '2026-02-31')).toBeNull();
    });
  });

  // Drives "is this range still OPEN?" — the Dashboard polls a live range and fetches a
  // closed one exactly once, because a closed period's numbers cannot change.
  describe('rangeIncludesToday', () => {
    it('is true when today is inside the range', () => {
      expect(rangeIncludesToday({ from: '2026-06-01', to: '2026-06-30' }, now)).toBeTrue();
    });

    it('is true on either inclusive boundary', () => {
      expect(rangeIncludesToday({ from: '2026-06-15', to: '2026-06-30' }, now)).toBeTrue();
      expect(rangeIncludesToday({ from: '2026-06-01', to: '2026-06-15' }, now)).toBeTrue();
    });

    it('is true for a single-day range that IS today', () => {
      expect(rangeIncludesToday({ from: '2026-06-15', to: '2026-06-15' }, now)).toBeTrue();
    });

    it('is false for a wholly past range', () => {
      expect(rangeIncludesToday({ from: '2026-05-01', to: '2026-05-31' }, now)).toBeFalse();
      // Ends the day before today — the boundary a `<=` slip would get wrong.
      expect(rangeIncludesToday({ from: '2026-06-01', to: '2026-06-14' }, now)).toBeFalse();
    });

    it('is false for a wholly future range', () => {
      // Unreachable through the picker, but the predicate is two-sided on purpose and
      // must not answer "open" for a window that has not started.
      expect(rangeIncludesToday({ from: '2026-06-16', to: '2026-06-20' }, now)).toBeFalse();
    });

    it('holds for every in-progress preset, and for none of the closed ones', () => {
      for (const preset of ['today', 'this-week', 'this-month', 'this-year'] as const) {
        expect(rangeIncludesToday(presetToRange(preset, now), now))
          .withContext(preset)
          .toBeTrue();
      }
      for (const preset of ['yesterday', 'last-week', 'last-month'] as const) {
        expect(rangeIncludesToday(presetToRange(preset, now), now))
          .withContext(preset)
          .toBeFalse();
      }
    });
  });
});
