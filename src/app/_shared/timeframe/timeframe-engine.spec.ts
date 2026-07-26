import { differenceInCalendarDays, format, parseISO, subDays } from 'date-fns';
import { ReportDateRange, ReportPreset, presetToRange } from './timeframe-range';
import {
  BUCKET_TO_CATEGORY,
  HOURLY_MAX_DAYS,
  RangeShape,
  ReportBucketUnit,
  SALES_TRENDS_CAP_DAYS,
  classifyRangeShape,
  comparisonRange,
  comparisonRangeLabel,
  nextEqualLengthPeriod,
  previousEqualLengthPeriod,
  resolveTimeframe,
  stepRange,
} from './timeframe-engine';

describe('shared timeframe engine', () => {
  // Fixed reference date keeps month/week/year boundaries deterministic.
  const NOW = new Date(2026, 5, 15); // 15 Jun 2026 (local)
  const ANCHOR = '2026-06-15';

  /** A custom range whose calendar-day span (to − from) is exactly `span`, ending at ANCHOR. */
  function rangeOfSpan(span: number): ReportDateRange {
    return { preset: 'custom', from: format(subDays(parseISO(ANCHOR), span), 'yyyy-MM-dd'), to: ANCHOR };
  }

  const inclusiveLen = (r: Pick<ReportDateRange, 'from' | 'to'>): number =>
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

    // Regression guard for the presetToRange to-date clamp: shortening an in-progress
    // preset must not silently re-bucket the report it feeds. Mid-period both the
    // clamped and unclamped spans land in the same ladder tier.
    it('keeps the bucket an in-progress preset resolves to, clamped or not', () => {
      const cases: Array<[string, ReportDateRange, ReportDateRange, ReportBucketUnit]> = [
        [
          'this-month',
          presetToRange('this-month', NOW), // 2026-06-01 → 06-15, span 14
          { preset: 'this-month', from: '2026-06-01', to: '2026-06-30' }, // span 29
          'day',
        ],
        [
          'this-year',
          presetToRange('this-year', NOW), // 2026-01-01 → 06-15, span 165
          { preset: 'this-year', from: '2026-01-01', to: '2026-12-31' }, // span 364
          'month',
        ],
      ];
      for (const [label, clamped, unclamped, expected] of cases) {
        expect(resolveTimeframe(clamped).bucketUnit).withContext(`${label} clamped`).toBe(expected);
        expect(resolveTimeframe(unclamped).bucketUnit)
          .withContext(`${label} unclamped`)
          .toBe(expected);
      }
    });

    // The one place the clamp DOES move the bucket, documented rather than guarded: on
    // the opening day(s) of a period the to-date span is ≤ HOURLY_MAX_DAYS, so the range
    // renders hour-of-day — the same treatment `today` already gets. NOW is a Monday.
    it('buckets an opening-of-period preset by hour, as any ≤1-day span is', () => {
      expect(resolveTimeframe(presetToRange('this-week', NOW)).bucketUnit).toBe('hour');
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

    it('this-week → the same week-to-date window one week back', () => {
      // this-week is clamped to week-to-date, so its comparison shifts BOTH bounds by a
      // week rather than landing on the whole of last week — deliberately like-for-like
      // (N days vs the same N days), unlike the month/year cases below.
      const tw = presetToRange('this-week', NOW);
      const comp = comparisonRange(tw);
      expect(comp).toEqual({ preset: 'custom', from: '2026-06-08', to: '2026-06-08' });
      expect(inclusiveLen(comp)).toBe(inclusiveLen(tw));
      // It sits inside last week, which is a full Mon–Sun span in its own right.
      const lw = presetToRange('last-week', NOW);
      expect(comp.from >= lw.from && comp.to <= lw.to).toBeTrue();
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

  describe('comparisonRangeLabel — toggle label for the comparison period', () => {
    it('labels each preset by the period it compares against', () => {
      expect(comparisonRangeLabel(presetToRange('today', NOW))).toBe('yesterday');
      expect(comparisonRangeLabel(presetToRange('yesterday', NOW))).toBe('the previous day');
      expect(comparisonRangeLabel(presetToRange('this-week', NOW))).toBe('last week');
      expect(comparisonRangeLabel(presetToRange('last-week', NOW))).toBe('the previous week');
      // month/year compare against the FULL prior calendar month/year → its name.
      expect(comparisonRangeLabel(presetToRange('this-month', NOW))).toBe('May');
      expect(comparisonRangeLabel(presetToRange('last-month', NOW))).toBe('April');
      expect(comparisonRangeLabel(presetToRange('this-year', NOW))).toBe('2025');
      expect(comparisonRangeLabel(rangeOfSpan(13))).toBe('the previous period');
    });
  });

  // previousEqualLengthPeriod mirrors the backend's dashboard-v2 `previous_totals`
  // window. Every expectation below is HAND-COMPUTED from the backend formula
  //   delta = (to - from) + 1d;  prev_from = from - delta;  prev_to = from - 1d
  // rather than derived with the same date-fns calls the implementation uses — a spec
  // that re-runs the implementation's own arithmetic would pass no matter what it did.
  describe('previousEqualLengthPeriod — parity with dashboard-v2', () => {
    const cases: { label: string; from: string; to: string; prevFrom: string; prevTo: string }[] = [
      // The off-by-one case: 5 inclusive days must step back exactly 5, not 4 or 6.
      { label: '5-day range', from: '2026-06-10', to: '2026-06-14', prevFrom: '2026-06-05', prevTo: '2026-06-09' },
      { label: 'single day', from: '2026-06-15', to: '2026-06-15', prevFrom: '2026-06-14', prevTo: '2026-06-14' },
      // Month boundary: a full 30-day June steps into a 30-day slice of May that does
      // NOT start on the 1st — the exact place a calendar-month comparison would differ.
      { label: 'whole calendar month', from: '2026-06-01', to: '2026-06-30', prevFrom: '2026-05-02', prevTo: '2026-05-31' },
      { label: 'year boundary', from: '2026-01-01', to: '2026-01-31', prevFrom: '2025-12-01', prevTo: '2025-12-31' },
      { label: 'across a leap February', from: '2024-03-01', to: '2024-03-05', prevFrom: '2024-02-25', prevTo: '2024-02-29' },
    ];

    for (const c of cases) {
      it(`steps back one equal-length block — ${c.label}`, () => {
        expect(previousEqualLengthPeriod({ from: c.from, to: c.to })).toEqual({
          preset: 'custom',
          from: c.prevFrom,
          to: c.prevTo,
        });
      });
    }

    it('always returns a window of exactly the same inclusive length', () => {
      for (const span of [0, 1, 4, 29, 30, 364]) {
        const range = rangeOfSpan(span);
        expect(inclusiveLen(previousEqualLengthPeriod(range))).toBe(inclusiveLen(range));
      }
    });

    it('ends the day before the range starts, leaving no gap and no overlap', () => {
      for (const span of [0, 6, 45]) {
        const range = rangeOfSpan(span);
        const prev = previousEqualLengthPeriod(range);
        expect(differenceInCalendarDays(parseISO(range.from), parseISO(prev.to))).toBe(1);
      }
    });

    it('ignores the preset — that is what makes it match the backend', () => {
      const asPreset: ReportDateRange = { preset: 'this-month', from: '2026-06-01', to: '2026-06-15' };
      const asCustom: ReportDateRange = { ...asPreset, preset: 'custom' };

      expect(previousEqualLengthPeriod(asPreset)).toEqual(previousEqualLengthPeriod(asCustom));
    });

    // The reason Dashboard must not reuse comparisonRange. For a month-to-date range the
    // two disagree outright; if this ever stops failing, one of them changed meaning.
    it('DIVERGES from the preset-aware comparisonRange on a partial month', () => {
      const midMonth: ReportDateRange = { preset: 'this-month', from: '2026-06-01', to: '2026-06-15' };

      expect(previousEqualLengthPeriod(midMonth)).toEqual({
        preset: 'custom',
        from: '2026-05-17',
        to: '2026-05-31',
      });
      expect(comparisonRange(midMonth)).toEqual({
        preset: 'custom',
        from: '2026-05-01',
        to: '2026-05-31',
      });
    });

    it('coincides with comparisonRange only for a WHOLE calendar month', () => {
      const wholeMonth: ReportDateRange = { preset: 'this-month', from: '2026-06-01', to: '2026-06-30' };

      // Same start; the equal-length window is one day shorter than full May because
      // June has 30 days and May has 31 — so even here they are not identical.
      expect(previousEqualLengthPeriod(wholeMonth).to).toBe(comparisonRange(wholeMonth).to);
      expect(previousEqualLengthPeriod(wholeMonth).from).not.toBe(comparisonRange(wholeMonth).from);
    });
  });

  // ─── Range shape + period stepping (TIMEFRAME-01C) ─────────────────────────────────
  //
  // Same rule as the block above: every expected date is HAND-COMPUTED and written out
  // literally. A spec that re-derives its expectations with the same date-fns calls the
  // implementation uses would pass no matter what the implementation did.
  //
  // Weekday anchors used below, all verified against the real calendar:
  //   2026-07-26 Sun   2026-07-22 Wed   2026-07-20 Mon   2026-07-13 Mon   2026-07-19 Sun
  //   2026-07-01 Wed   2026-01-01 Thu   2026-06-01 Mon   2026-05-25 Mon   2026-05-31 Sun
  describe('range shape + period stepping', () => {
    /** 26 Jul 2026 — a SUNDAY, so "this week" is a COMPLETE Mon 20 – Sun 26 at this anchor. */
    const SUN_26_JUL = new Date(2026, 6, 26);
    /** 22 Jul 2026 — a Wednesday, needed for a genuinely in-progress week. */
    const WED_22_JUL = new Date(2026, 6, 22);

    const r = (from: string, to: string, preset: ReportPreset = 'custom'): ReportDateRange => ({
      preset,
      from,
      to,
    });
    /** Dates only — a stepped range's preset legitimately differs from its input's. */
    const dates = (x: { from: string; to: string }) => ({ from: x.from, to: x.to });

    describe('classifyRangeShape — precision, including near-misses', () => {
      const cases: { label: string; range: ReportDateRange; now: Date; shape: RangeShape }[] = [
        { label: 'a single day', range: r('2026-07-15', '2026-07-15'), now: SUN_26_JUL, shape: 'day' },
        { label: 'a complete Mon–Sun week', range: r('2026-07-13', '2026-07-19'), now: SUN_26_JUL, shape: 'week' },
        { label: 'an in-progress week', range: r('2026-07-20', '2026-07-22'), now: WED_22_JUL, shape: 'week-to-date' },
        { label: 'a whole calendar month', range: r('2026-06-01', '2026-06-30'), now: SUN_26_JUL, shape: 'month' },
        { label: 'a month-to-date', range: r('2026-07-01', '2026-07-26'), now: SUN_26_JUL, shape: 'month-to-date' },
        { label: 'a whole calendar year', range: r('2025-01-01', '2025-12-31'), now: SUN_26_JUL, shape: 'year' },
        { label: 'a year-to-date', range: r('2026-01-01', '2026-07-26'), now: SUN_26_JUL, shape: 'year-to-date' },
        // The near-misses. Each is one day / one boundary off a real period.
        { label: 'Tue–Mon, 7 days but not a week', range: r('2026-07-14', '2026-07-20'), now: SUN_26_JUL, shape: 'custom' },
        { label: '1–30 Jul, a 31-day month one day short', range: r('2026-07-01', '2026-07-30'), now: SUN_26_JUL, shape: 'custom' },
        { label: '2 Jan – 31 Dec, a year starting a day late', range: r('2025-01-02', '2025-12-31'), now: SUN_26_JUL, shape: 'custom' },
        { label: 'a mid-month 5-day span', range: r('2026-07-10', '2026-07-14'), now: SUN_26_JUL, shape: 'custom' },
      ];

      for (const c of cases) {
        it(`classifies ${c.label} as '${c.shape}'`, () => {
          expect(classifyRangeShape(c.range, c.now)).toBe(c.shape);
        });
      }

      // Deliberate precedence, not an accident of check order: the two step identically,
      // so the only thing at stake is that the answer is stable and pinned.
      it("calls a to-date range that IS complete by its complete shape (today is Sunday)", () => {
        expect(classifyRangeShape(r('2026-07-20', '2026-07-26', 'this-week'), SUN_26_JUL)).toBe('week');
      });

      it('ignores a decayed preset — a stepped calendar month is still a month', () => {
        // preset says 'custom' (two steps back from this-month); the DATES say June.
        expect(classifyRangeShape(r('2026-06-01', '2026-06-30', 'custom'), SUN_26_JUL)).toBe('month');
      });
    });

    // The whole reason the preset is consulted at all. On the 1st of a period several
    // definitions match the SAME dates, so the dates cannot decide — Reports' this-month
    // and the Dashboard's today are byte-identical there.
    describe('classifyRangeShape — the preset tiebreak on the 1st', () => {
      const FIRST_JUL = new Date(2026, 6, 1); // Wednesday
      const FIRST_JAN = new Date(2026, 0, 1); // Thursday
      const FIRST_JUN = new Date(2026, 5, 1); // MONDAY — pulls week-to-date into the tie

      it("resolves 1–1 Jul by preset: today → day, this-month → month-to-date", () => {
        expect(classifyRangeShape(r('2026-07-01', '2026-07-01', 'today'), FIRST_JUL)).toBe('day');
        expect(classifyRangeShape(r('2026-07-01', '2026-07-01', 'this-month'), FIRST_JUL)).toBe(
          'month-to-date',
        );
      });

      it("reads a hand-picked single day ('custom') as the narrowest shape", () => {
        expect(classifyRangeShape(r('2026-07-01', '2026-07-01', 'custom'), FIRST_JUL)).toBe('day');
      });

      it('falls back to the narrowest shape when no preset is supplied at all', () => {
        expect(classifyRangeShape({ from: '2026-07-01', to: '2026-07-01' }, FIRST_JUL)).toBe('day');
      });

      it('resolves the 1 Jan TRIPLE collision (day / month-to-date / year-to-date)', () => {
        expect(classifyRangeShape(r('2026-01-01', '2026-01-01', 'today'), FIRST_JAN)).toBe('day');
        expect(classifyRangeShape(r('2026-01-01', '2026-01-01', 'this-month'), FIRST_JAN)).toBe(
          'month-to-date',
        );
        expect(classifyRangeShape(r('2026-01-01', '2026-01-01', 'this-year'), FIRST_JAN)).toBe(
          'year-to-date',
        );
      });

      it('resolves a MONDAY 1st, where week-to-date joins the collision', () => {
        expect(classifyRangeShape(r('2026-06-01', '2026-06-01', 'this-week'), FIRST_JUN)).toBe(
          'week-to-date',
        );
        expect(classifyRangeShape(r('2026-06-01', '2026-06-01', 'this-month'), FIRST_JUN)).toBe(
          'month-to-date',
        );
        expect(classifyRangeShape(r('2026-06-01', '2026-06-01', 'today'), FIRST_JUN)).toBe('day');
      });

      it('steps the 1st by the period the preset names', () => {
        expect(dates(stepRange(r('2026-07-01', '2026-07-01', 'today'), -1, FIRST_JUL))).toEqual({
          from: '2026-06-30',
          to: '2026-06-30',
        });
        expect(dates(stepRange(r('2026-07-01', '2026-07-01', 'this-month'), -1, FIRST_JUL))).toEqual({
          from: '2026-06-01',
          to: '2026-06-30',
        });
      });

      // Continuity: forward from June must land on `this-month`, not `today`. Both resolve
      // to 1–1 Jul on the 1st, and picking `today` would make the NEXT back-click step one
      // day instead of one month — silently breaking the round trip.
      it('round-trips from the 1st in both directions, for both presets', () => {
        const asToday = r('2026-07-01', '2026-07-01', 'today');
        const backFromToday = stepRange(asToday, -1, FIRST_JUL);
        const returnedToday = stepRange(backFromToday, 1, FIRST_JUL);
        expect(dates(returnedToday)).toEqual(dates(asToday));
        expect(returnedToday.preset).toBe('today');

        const asMonth = r('2026-07-01', '2026-07-01', 'this-month');
        const backFromMonth = stepRange(asMonth, -1, FIRST_JUL);
        const returnedMonth = stepRange(backFromMonth, 1, FIRST_JUL);
        expect(dates(returnedMonth)).toEqual(dates(asMonth));
        expect(returnedMonth.preset).toBe('this-month');

        // …and the restored preset keeps stepping by MONTH, which is the point of it.
        expect(dates(stepRange(returnedMonth, -1, FIRST_JUL))).toEqual({
          from: '2026-06-01',
          to: '2026-06-30',
        });
      });
    });

    // THE regression this feature exists to avoid. The reference implementation offsets
    // `from` by the INCLUSIVE length instead of the exclusive one, so its window grows a
    // day on every click, in BOTH directions: 10–14 Jul back gives 4–9 Jul (6 days), back
    // again 27 Jun – 3 Jul (7 days). Pin its absence first and hardest.
    describe('stepRange — the window never grows', () => {
      it('holds a 5-day custom range at 5 days across three steps BACK', () => {
        const start = r('2026-07-10', '2026-07-14');
        const first = stepRange(start, -1, SUN_26_JUL);

        // The exact off-by-one: 5 Jul, never 4 Jul.
        expect(dates(first)).toEqual({ from: '2026-07-05', to: '2026-07-09' });

        const second = stepRange(first, -1, SUN_26_JUL);
        expect(dates(second)).toEqual({ from: '2026-06-30', to: '2026-07-04' });

        const third = stepRange(second, -1, SUN_26_JUL);
        expect(dates(third)).toEqual({ from: '2026-06-25', to: '2026-06-29' });

        for (const step of [start, first, second, third]) {
          expect(inclusiveLen(step)).toBe(5);
        }
      });

      it('holds a 5-day custom range at 5 days across three steps FORWARD', () => {
        // Started far enough back that the clamp never engages (clamping is its own spec).
        const start = r('2026-06-10', '2026-06-14');
        const first = stepRange(start, 1, SUN_26_JUL);
        expect(dates(first)).toEqual({ from: '2026-06-15', to: '2026-06-19' });

        const second = stepRange(first, 1, SUN_26_JUL);
        expect(dates(second)).toEqual({ from: '2026-06-20', to: '2026-06-24' });

        const third = stepRange(second, 1, SUN_26_JUL);
        expect(dates(third)).toEqual({ from: '2026-06-25', to: '2026-06-29' });

        for (const step of [start, first, second, third]) {
          expect(inclusiveLen(step)).toBe(5);
        }
      });

      it('leaves no gap and no overlap between a range and its predecessor', () => {
        const start = r('2026-07-10', '2026-07-14');
        const back = stepRange(start, -1, SUN_26_JUL);
        expect(differenceInCalendarDays(parseISO(start.from), parseISO(back.to))).toBe(1);
      });
    });

    describe('stepRange — month lengths are respected', () => {
      const MID_APR_2026 = new Date(2026, 3, 15);
      const MID_APR_2028 = new Date(2028, 3, 15);
      const MID_AUG_2026 = new Date(2026, 7, 15);

      it('steps a 31-day July back into a 30-day June', () => {
        expect(dates(stepRange(r('2026-07-01', '2026-07-31'), -1, MID_AUG_2026))).toEqual({
          from: '2026-06-01',
          to: '2026-06-30',
        });
      });

      it('steps March back into a 28-day February', () => {
        expect(dates(stepRange(r('2026-03-01', '2026-03-31'), -1, MID_APR_2026))).toEqual({
          from: '2026-02-01',
          to: '2026-02-28',
        });
      });

      it('steps March back into a 29-day February in a leap year', () => {
        expect(dates(stepRange(r('2028-03-01', '2028-03-31'), -1, MID_APR_2028))).toEqual({
          from: '2028-02-01',
          to: '2028-02-29',
        });
      });

      it('steps January forward into February, leap and non-leap', () => {
        expect(dates(stepRange(r('2026-01-01', '2026-01-31'), 1, MID_APR_2026))).toEqual({
          from: '2026-02-01',
          to: '2026-02-28',
        });
        expect(dates(stepRange(r('2028-01-01', '2028-01-31'), 1, MID_APR_2028))).toEqual({
          from: '2028-02-01',
          to: '2028-02-29',
        });
      });
    });

    describe('stepRange — round-trip for every complete shape', () => {
      const cases: { label: string; range: ReportDateRange }[] = [
        { label: 'day', range: r('2026-07-15', '2026-07-15') },
        { label: 'week', range: r('2026-07-13', '2026-07-19') },
        { label: 'month', range: r('2026-06-01', '2026-06-30') },
        { label: 'year', range: r('2025-01-01', '2025-12-31') },
      ];

      // Dates only: the returned preset legitimately IMPROVES (13–19 Jul comes back
      // labelled 'last-week'), which is the picker highlighting doing its job.
      for (const c of cases) {
        it(`returns the original ${c.label} range after back-then-forward`, () => {
          const back = stepRange(c.range, -1, SUN_26_JUL);
          expect(dates(stepRange(back, 1, SUN_26_JUL))).toEqual(dates(c.range));
        });
      }

      it('steps a complete week to the complete week before it', () => {
        expect(dates(stepRange(r('2026-07-13', '2026-07-19'), -1, SUN_26_JUL))).toEqual({
          from: '2026-07-06',
          to: '2026-07-12',
        });
      });
    });

    describe('stepRange — to-date ranges promote to the complete period', () => {
      it('steps month-to-date back to ALL of the previous month, not a matching slice', () => {
        const mtd = r('2026-07-01', '2026-07-26', 'this-month');
        const back = stepRange(mtd, -1, SUN_26_JUL);

        expect(dates(back)).toEqual({ from: '2026-06-01', to: '2026-06-30' });
        // The truncation we are refusing to do: 1–26 Jun would hide four days of trade.
        expect(back.to).not.toBe('2026-06-26');
      });

      it('steps a complete month forward into a CLAMPED month-to-date', () => {
        const forward = stepRange(r('2026-06-01', '2026-06-30', 'last-month'), 1, SUN_26_JUL);

        expect(dates(forward)).toEqual({ from: '2026-07-01', to: '2026-07-26' });
        expect(forward.preset).toBe('this-month');
      });

      it('steps year-to-date back to the whole previous year', () => {
        expect(dates(stepRange(r('2026-01-01', '2026-07-26', 'this-year'), -1, SUN_26_JUL))).toEqual({
          from: '2025-01-01',
          to: '2025-12-31',
        });
      });

      it('steps an in-progress week back to the complete week before it', () => {
        expect(dates(stepRange(r('2026-07-20', '2026-07-22', 'this-week'), -1, WED_22_JUL))).toEqual({
          from: '2026-07-13',
          to: '2026-07-19',
        });
      });
    });

    describe('stepRange — forward clamps at the present', () => {
      it('clamps the END and keeps the computed start', () => {
        // 25–27 Jul overshoots by a day; the honest answer is 25–26, NOT a collapse to
        // "today", which would turn a three-day measurement into a one-day one.
        const forward = stepRange(r('2026-07-22', '2026-07-24'), 1, SUN_26_JUL);

        expect(dates(forward)).toEqual({ from: '2026-07-25', to: '2026-07-26' });
        expect(forward.from).not.toBe('2026-07-26');
      });

      it('returns the range untouched when the next period has not begun', () => {
        const today = r('2026-07-26', '2026-07-26', 'today');
        expect(stepRange(today, 1, SUN_26_JUL)).toEqual(today);

        const mtd = r('2026-07-01', '2026-07-26', 'this-month');
        expect(stepRange(mtd, 1, SUN_26_JUL)).toEqual(mtd);
      });

      it('never emits a future-dated or inverted range, in either direction', () => {
        const seeds: ReportDateRange[] = [
          r('2026-07-26', '2026-07-26', 'today'),
          r('2026-07-01', '2026-07-26', 'this-month'),
          r('2026-07-20', '2026-07-26', 'this-week'),
          r('2026-01-01', '2026-07-26', 'this-year'),
          r('2026-07-22', '2026-07-24'),
          r('2026-06-01', '2026-06-30'),
        ];

        for (const seed of seeds) {
          for (const direction of [-1, 1] as const) {
            const stepped = stepRange(seed, direction, SUN_26_JUL);
            expect(stepped.from <= stepped.to).toBeTrue();
            expect(stepped.to <= '2026-07-26').toBeTrue();
          }
        }
      });
    });

    describe('stepRange — preset assignment', () => {
      it('labels a step back from this-month as last-month', () => {
        const back = stepRange(r('2026-07-01', '2026-07-26', 'this-month'), -1, SUN_26_JUL);
        expect(back.preset).toBe('last-month');
      });

      it('falls to custom on the second step back — and still moves a WHOLE month', () => {
        const once = stepRange(r('2026-07-01', '2026-07-26', 'this-month'), -1, SUN_26_JUL);
        const twice = stepRange(once, -1, SUN_26_JUL);

        expect(twice.preset).toBe('custom');
        expect(dates(twice)).toEqual({ from: '2026-05-01', to: '2026-05-31' });
      });

      it('labels the obvious single-period steps', () => {
        expect(stepRange(r('2026-07-26', '2026-07-26', 'today'), -1, SUN_26_JUL).preset).toBe(
          'yesterday',
        );
        expect(stepRange(r('2026-07-20', '2026-07-26', 'this-week'), -1, SUN_26_JUL).preset).toBe(
          'last-week',
        );
      });
    });

    // A step must never push a range over a ladder cap — that would silently re-bucket
    // the data (or trigger resolveTimeframe's clamp) as a side effect of paging.
    describe('stepRange — cap safety', () => {
      it('keeps calendar-month steps on the daily bucket across the 31→28 Feb boundary', () => {
        const marchBack = stepRange(r('2026-03-01', '2026-03-31'), -1, new Date(2026, 3, 15));
        const febForward = stepRange(r('2026-02-01', '2026-02-28'), 1, new Date(2026, 3, 15));

        for (const stepped of [marchBack, febForward]) {
          const resolved = resolveTimeframe(stepped);
          expect(resolved.bucketUnit).toBe('day');
          expect(resolved.clamped).toBeFalse();
        }
      });

      it('keeps whole-year steps on the monthly bucket, leap year included', () => {
        const back = stepRange(r('2025-01-01', '2025-12-31'), -1, SUN_26_JUL);

        expect(dates(back)).toEqual({ from: '2024-01-01', to: '2024-12-31' });
        expect(resolveTimeframe(back).bucketUnit).toBe('month');
        expect(resolveTimeframe(back).clamped).toBeFalse();
      });

      it('preserves the span of a range sitting exactly on the annual cap', () => {
        const atCap = rangeOfSpan(SALES_TRENDS_CAP_DAYS.annual);
        const back = stepRange(atCap, -1, NOW);

        expect(inclusiveLen(back)).toBe(inclusiveLen(atCap));
        expect(resolveTimeframe(back).clamped).toBeFalse();
      });
    });

    // The structural guard against the growth bug ever returning on the forward side.
    describe('nextEqualLengthPeriod — the exact inverse of previousEqualLengthPeriod', () => {
      const samples = [
        { from: '2026-06-10', to: '2026-06-14' },
        { from: '2026-06-15', to: '2026-06-15' },
        { from: '2026-06-01', to: '2026-06-30' },
        { from: '2024-02-25', to: '2024-03-05' },
      ];

      it('round-trips forward-then-back', () => {
        for (const s of samples) {
          expect(dates(previousEqualLengthPeriod(nextEqualLengthPeriod(s)))).toEqual(s);
        }
      });

      it('round-trips back-then-forward', () => {
        for (const s of samples) {
          expect(dates(nextEqualLengthPeriod(previousEqualLengthPeriod(s)))).toEqual(s);
        }
      });

      it('starts the day after the range ends, leaving no gap and no overlap', () => {
        for (const s of samples) {
          const next = nextEqualLengthPeriod(s);
          expect(differenceInCalendarDays(parseISO(next.from), parseISO(s.to))).toBe(1);
          expect(inclusiveLen(next)).toBe(inclusiveLen(s));
        }
      });
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
