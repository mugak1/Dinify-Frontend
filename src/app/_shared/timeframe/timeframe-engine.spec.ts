import { addDays, differenceInCalendarDays, format, parseISO, subDays } from 'date-fns';
import { COMPARISON_OPTIONS, ComparisonOption, pairingFor } from './comparison-option';
import { ReportDateRange, ReportPreset, presetToRange } from './timeframe-range';
import {
  BUCKET_TO_CATEGORY,
  HOURLY_MAX_DAYS,
  RangeShape,
  ReportBucketUnit,
  SALES_TRENDS_CAP_DAYS,
  classifyRangeShape,
  comparisonOptionsFor,
  defaultComparisonFor,
  maxCustomComparisonStart,
  nextEqualLengthPeriod,
  previousEqualLengthPeriod,
  resolveComparison,
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

  /** ISO day string, matching the engine's own `fmt`. */
  const fmtIso = (d: Date): string => format(d, 'yyyy-MM-dd');

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

  // ─── Comparison basis (TIMEFRAME-02A) ──────────────────────────────────────────────
  //
  // Windows below are HAND-COMPUTED, not derived with the same date-fns calls the
  // implementation uses — the convention this file already applies to
  // previousEqualLengthPeriod, for the same reason: a spec that re-runs the
  // implementation's own arithmetic passes no matter what that arithmetic does.

  describe('comparisonOptionsFor — the menu each shape offers', () => {
    // `'custom'` (02D) closes every row, and LAST is load-bearing: `defaultComparisonFor`
    // reads index 1, so appending it cannot move any shape's default.
    const EXPECTED: Record<RangeShape, ComparisonOption[]> = {
      day: ['none', 'prev-day', 'prev-week', 'prev-year', 'dates-last-year', 'custom'],
      week: ['none', 'prev-week', 'prev-year', 'dates-last-year', 'custom'],
      'week-to-date': ['none', 'prev-week', 'prev-year', 'dates-last-year', 'custom'],
      // Month level is the only place pairing is a question, so it is the only place the
      // menu carries by-day / by-date variants — and the only place `prev-year` is ABSENT,
      // because at month level "previous year" means the same calendar month.
      month: [
        'none',
        'prev-month-by-day',
        'prev-month-by-date',
        'prev-year-by-day',
        'dates-last-year',
        'custom',
      ],
      'month-to-date': [
        'none',
        'prev-month-by-day',
        'prev-month-by-date',
        'prev-year-by-day',
        'dates-last-year',
        'custom',
      ],
      year: ['none', 'prev-year', 'custom'],
      'year-to-date': ['none', 'prev-year', 'custom'],
      custom: ['none', 'prev-period', 'custom'],
    };
    const SHAPES = Object.keys(EXPECTED) as RangeShape[];

    for (const shape of SHAPES) {
      it(`offers exactly the documented set for '${shape}'`, () => {
        expect(comparisonOptionsFor(shape)).toEqual(EXPECTED[shape]);
      });
    }

    it("starts every set with 'none'", () => {
      for (const shape of SHAPES) {
        expect(comparisonOptionsFor(shape)[0]).withContext(shape).toBe('none');
      }
    });

    it("makes each shape's default its first non-'none' entry — never 'none' itself", () => {
      for (const shape of SHAPES) {
        expect(defaultComparisonFor(shape)).withContext(shape).toBe(EXPECTED[shape][1]);
        expect(defaultComparisonFor(shape)).withContext(shape).not.toBe('none');
      }
    });

    // Pairing is an axis of its own: `by-date` for everything that is not explicitly
    // `-by-day`, so every option predating 02C keeps its behaviour exactly.
    it('maps every option in the union to a pairing, by-date unless -by-day', () => {
      const byDay: ComparisonOption[] = ['prev-month-by-day', 'prev-year-by-day'];
      for (const option of COMPARISON_OPTIONS) {
        expect(pairingFor(option))
          .withContext(option)
          .toBe(byDay.includes(option) ? 'by-day' : 'by-date');
      }
    });

    /** One representative range per shape. Shared by the two sweeps below. */
    const SAMPLES: Record<RangeShape, ReportDateRange> = {
      day: { preset: 'today', from: ANCHOR, to: ANCHOR },
      week: { preset: 'custom', from: '2026-06-08', to: '2026-06-14' },
      // NOW is a MONDAY, so week-to-date is necessarily a single day here — and that
      // collides with `day`, which wins on declaration order. The `this-week` preset is
      // what breaks the tie (see `classifyRangeShape`'s scoped exception), and it is
      // load-bearing rather than decorative: with `preset: 'custom'` this entry classified
      // as `custom`, so both sweeps below silently exercised custom's option set while
      // claiming to cover week-to-date. The fidelity guard above is what caught that.
      'week-to-date': { preset: 'this-week', from: ANCHOR, to: ANCHOR },
      month: { preset: 'custom', from: '2026-05-01', to: '2026-05-31' },
      'month-to-date': { preset: 'this-month', from: '2026-06-01', to: ANCHOR },
      year: { preset: 'custom', from: '2025-01-01', to: '2025-12-31' },
      'year-to-date': { preset: 'this-year', from: '2026-01-01', to: ANCHOR },
      custom: rangeOfSpan(13),
    };

    // The sweeps below are only as good as the table they iterate: a sample that does not
    // actually classify as the shape it is filed under would test the wrong option set and
    // still pass. Pin it.
    it('the sample table classifies as the shape each entry is filed under', () => {
      for (const shape of SHAPES) {
        expect(classifyRangeShape(SAMPLES[shape], NOW)).withContext(shape).toBe(shape);
      }
    });

    // A set holding two entries that BEHAVE identically is a menu that lies: the user picks
    // a different label and nothing changes. This is why the year shapes omit
    // 'dates-last-year' — with a calendar-aligned prev-year it would duplicate it.
    //
    // 02C LOOSENED THIS FROM "window" TO "(window, pairing)", deliberately. The month sets
    // now carry two pairs that SHARE a window on purpose — prev-month-by-day /
    // prev-month-by-date, and prev-year-by-day / dates-last-year — because at month level
    // how the two series are PAIRED inside the chart is a real question with two
    // legitimate answers. The rule it was ever about is intact; what counts as
    // "identically" has widened to include how the series are drawn. Narrowing it back to
    // the window alone would make the month menu unrepresentable, not safer.
    //
    // `'custom'` (02D) is EXCLUDED. Its window is supplied by the user, so a coincidental
    // match with another basis is the user's own choice — not a menu offering two entries
    // that behave identically, which is the only thing this rule was ever about. (It also
    // resolves to `null` without a start, so it has no window to key on here.)
    it('never offers two bases that resolve to the same window AND pair it the same way', () => {
      for (const shape of SHAPES) {
        const behaviours = comparisonOptionsFor(shape)
          .filter((o) => o !== 'none' && o !== 'custom')
          .map((o) => {
            const w = resolveComparison(SAMPLES[shape], o, NOW)!;
            return `${w.from}..${w.to}/${pairingFor(o)}`;
          });
        expect(new Set(behaviours).size).withContext(shape).toBe(behaviours.length);
      }
    });

    // …and the pairs that share a window really do share it, so the amendment above is
    // load-bearing rather than a licence granted and never used.
    it('offers exactly two window-sharing pairs at month level, distinguished by pairing', () => {
      for (const shape of ['month', 'month-to-date'] as RangeShape[]) {
        const w = (o: ComparisonOption) => {
          const r = resolveComparison(SAMPLES[shape], o, NOW)!;
          return `${r.from}..${r.to}`;
        };
        expect(w('prev-month-by-day')).withContext(shape).toBe(w('prev-month-by-date'));
        expect(w('prev-year-by-day')).withContext(shape).toBe(w('dates-last-year'));
        expect(pairingFor('prev-month-by-day')).not.toBe(pairingFor('prev-month-by-date'));
        expect(pairingFor('prev-year-by-day')).not.toBe(pairingFor('dates-last-year'));
      }
    });

    // THE NON-OVERLAP NET (TIMEFRAME-02B). 02A asserted this for the one shape where it
    // was nearly got wrong — a 364-day shift on a calendar year lands its last day INSIDE
    // the range — and swept the full matrix only for `not.toThrow()`. This is the
    // exhaustive version: no offered basis, on any shape, may resolve to a window that
    // touches the range it is measured against.
    //
    // It lands here rather than with 02C/02D deliberately. Those grow the vocabulary —
    // by-day/by-date variants, then user-supplied windows — and a NEW option that
    // silently overlaps is precisely what this catches. The net is worth more before the
    // vocabulary grows than after.
    //
    // `'custom'` cannot join a DETERMINISTIC sweep — its window is whatever start the user
    // placed, and with none it resolves to `null`. The property still has to hold for it, so
    // it is asserted separately over the starts the UI can actually produce; see "a custom
    // window never overlaps, for any start the calendar allows" below. This filter narrows
    // the sweep's reach, not the invariant's.
    it('never resolves a window that overlaps the range it is compared against', () => {
      for (const shape of SHAPES) {
        const range = SAMPLES[shape];
        for (const option of comparisonOptionsFor(shape).filter(
          (o) => o !== 'none' && o !== 'custom',
        )) {
          const w = resolveComparison(range, option, NOW)!;
          // ISO dates sort chronologically, so a string compare is the whole test.
          expect(w.to < range.from)
            .withContext(`${shape} / ${option} → ${w.from}..${w.to} vs range from ${range.from}`)
            .toBeTrue();
        }
      }
    });

    // The targeted half of the invariant, standing in for `custom` in the sweep above.
    // The claim is not "some starts are safe" but "exactly the starts the calendar ALLOWS
    // are safe, and exactly the ones it blocks are not" — so the UI cannot produce an
    // overlapping window, and is not needlessly refusing a legal one either.
    it('a custom window never overlaps, for any start the calendar allows', () => {
      for (const shape of SHAPES) {
        const range = SAMPLES[shape];
        const max = maxCustomComparisonStart(range);

        // Every allowed start, sampled from the bound backwards.
        for (const back of [0, 1, 2, 7, 45, 400]) {
          const start = fmtIso(subDays(parseISO(max), back));
          const w = resolveComparison(range, 'custom', NOW, start)!;
          expect(w.to < range.from)
            .withContext(`${shape} / start ${start} → ${w.from}..${w.to} vs ${range.from}`)
            .toBeTrue();
          // …and it is the same length as the range, which is the other half of the deal.
          expect(inclusiveLen(w)).withContext(`${shape} / start ${start}`).toBe(inclusiveLen(range));
        }

        // The first BLOCKED start — one day past the bound — is exactly where it breaks.
        const justPast = fmtIso(addDays(parseISO(max), 1));
        const bad = resolveComparison(range, 'custom', NOW, justPast)!;
        expect(bad.to < range.from)
          .withContext(`${shape} / start ${justPast} should overlap`)
          .toBeFalse();
      }
    });

    // The bound looks like two rules and is one — see `maxCustomComparisonStart`. This pins
    // the implication so nobody re-adds a redundant future check believing it is missing.
    it('the non-overlap bound already implies the not-future bound', () => {
      for (const shape of SHAPES) {
        const range = SAMPLES[shape];
        const w = resolveComparison(range, 'custom', NOW, maxCustomComparisonStart(range))!;
        // The latest legal window ends before the range starts, and therefore before today.
        expect(w.to < range.from).withContext(shape).toBeTrue();
        expect(w.to <= ANCHOR).withContext(`${shape} → ${w.to} vs today ${ANCHOR}`).toBeTrue();
      }
    });
  });

  describe('resolveComparison — the one comparison-window resolver', () => {
    const cmp = (from: string, to: string): ReportDateRange => ({ preset: 'custom', from, to });

    it("returns null for 'none'", () => {
      expect(resolveComparison(presetToRange('this-month', NOW), 'none', NOW)).toBeNull();
    });

    // ─── The user-placed window (TIMEFRAME-02D) ─────────────────────────────────────
    //
    // The ONE option that does not determine its own window. Only the START is state; the
    // end is derived here, from the primary's length, on every read.
    describe("'custom'", () => {
      it('derives the end from the RANGE length, so the two windows always match', () => {
        // 1–15 Jun is 15 inclusive days, so a 1 Mar start runs 1–15 Mar.
        const range = presetToRange('this-month', NOW);
        expect(inclusiveLen(range)).toBe(15);
        expect(resolveComparison(range, 'custom', NOW, '2026-03-01')).toEqual(
          cmp('2026-03-01', '2026-03-15'),
        );
      });

      it('holds for a 5-day and a 31-day primary alike', () => {
        // Hand-computed: 5 days from 2 Feb is 2–6 Feb; 31 days from 1 Jan is 1–31 Jan.
        expect(resolveComparison(rangeOfSpan(4), 'custom', NOW, '2026-02-02')).toEqual(
          cmp('2026-02-02', '2026-02-06'),
        );
        expect(resolveComparison(rangeOfSpan(30), 'custom', NOW, '2026-01-01')).toEqual(
          cmp('2026-01-01', '2026-01-31'),
        );
      });

      it('crosses a month boundary by DAY COUNT, not by calendar shape', () => {
        // 15 days from 25 Feb 2026 (a 28-day February) runs into March: 25 Feb → 11 Mar.
        expect(resolveComparison(presetToRange('this-month', NOW), 'custom', NOW, '2026-02-25')).toEqual(
          cmp('2026-02-25', '2026-03-11'),
        );
      });

      // An unplaced comparison is not an error — it takes the exact path `'none'` does, so
      // no consumer needs a branch for it.
      it('returns null for an absent, empty or unreal start', () => {
        const range = presetToRange('this-month', NOW);
        for (const bad of [undefined, null, '', 'banana', '2026-02-31', '2026/03/01']) {
          expect(resolveComparison(range, 'custom', NOW, bad as string | null))
            .withContext(String(bad))
            .toBeNull();
        }
      });

      it('is ignored by every other basis', () => {
        const range = presetToRange('this-month', NOW);
        for (const option of COMPARISON_OPTIONS.filter((o) => o !== 'custom')) {
          expect(resolveComparison(range, option, NOW, '2020-01-01'))
            .withContext(option)
            .toEqual(resolveComparison(range, option, NOW));
        }
      });

      // Two arbitrarily-placed windows share no weekday structure to align to, so index
      // pairing — what every non-`-by-day` id already does — is the only honest answer.
      it('pairs by DATE (index pairing)', () => {
        expect(pairingFor('custom')).toBe('by-date');
      });
    });

    it('always returns a computed (custom) window', () => {
      expect(resolveComparison(presetToRange('today', NOW), 'prev-day', NOW)!.preset).toBe('custom');
    });

    it('prev-day → the prior single day', () => {
      expect(resolveComparison(presetToRange('today', NOW), 'prev-day', NOW)).toEqual(
        cmp('2026-06-14', '2026-06-14'),
      );
      expect(resolveComparison(presetToRange('yesterday', NOW), 'prev-day', NOW)).toEqual(
        cmp('2026-06-13', '2026-06-13'),
      );
    });

    it('prev-week on a single day → the same weekday one week back', () => {
      // 15 Jun 2026 is a Monday; 8 Jun 2026 is the Monday before it.
      expect(resolveComparison(presetToRange('today', NOW), 'prev-week', NOW)).toEqual(
        cmp('2026-06-08', '2026-06-08'),
      );
    });

    it('prev-week on a complete Mon–Sun week → the previous complete week', () => {
      const week: ReportDateRange = { preset: 'custom', from: '2026-06-08', to: '2026-06-14' };
      expect(resolveComparison(week, 'prev-week', NOW)).toEqual(cmp('2026-06-01', '2026-06-07'));
    });

    it('prev-week on a week-to-date range → partial-to-partial, equal length', () => {
      const wtd: ReportDateRange = { preset: 'custom', from: '2026-06-08', to: '2026-06-10' };
      const comp = resolveComparison(wtd, 'prev-week', NOW)!;
      expect(comp).toEqual(cmp('2026-06-01', '2026-06-03'));
      expect(inclusiveLen(comp)).toBe(inclusiveLen(wtd));
    });

    // THE 02A BEHAVIOUR CHANGE, and the reason this spec was rewritten rather than
    // deleted. It formerly read "this-month → the FULL prior calendar month (May, not a
    // 30-day shift)" and asserted 1–31 May. That set a 15-day month-to-date total against
    // a complete 31-day month, so early in any month the comparison showed a collapse
    // that was arithmetic rather than trade. The week-level case above always compared
    // partial-to-partial, which made the month behaviour an inconsistency rather than a
    // considered choice. This is an INTENDED change, not a regression.
    it('MONTH-TO-DATE compares PARTIAL-TO-PARTIAL — 1–15 Jun → 1–15 May, not all of May', () => {
      expect(resolveComparison(presetToRange('this-month', NOW), 'prev-month-by-day', NOW)).toEqual(
        cmp('2026-05-01', '2026-05-15'),
      );
    });

    // Scoping the change: a COMPLETE month is unaffected.
    it('a complete calendar month still compares to the complete prior month', () => {
      expect(resolveComparison(presetToRange('last-month', NOW), 'prev-month-by-day', NOW)).toEqual(
        cmp('2026-04-01', '2026-04-30'),
      );
      // 31 → 30 boundary: July compares to the whole of June, not to a 31-day window.
      const july: ReportDateRange = { preset: 'custom', from: '2025-07-01', to: '2025-07-31' };
      expect(resolveComparison(july, 'prev-month-by-day', NOW)).toEqual(cmp('2025-06-01', '2025-06-30'));
    });

    it('prev-month clamps into a SHORTER prior month rather than spilling past its end', () => {
      // Month-to-date 1–30 Mar has no 30th to land on in February.
      const mar2026: ReportDateRange = { preset: 'custom', from: '2026-03-01', to: '2026-03-30' };
      expect(resolveComparison(mar2026, 'prev-month-by-day', new Date(2026, 2, 30))).toEqual(
        cmp('2026-02-01', '2026-02-28'),
      );
      // …and 2028 is a leap year, so the same window gains a day.
      const mar2028: ReportDateRange = { preset: 'custom', from: '2028-03-01', to: '2028-03-30' };
      expect(resolveComparison(mar2028, 'prev-month-by-day', new Date(2028, 2, 30))).toEqual(
        cmp('2028-02-01', '2028-02-29'),
      );
    });

    it('prev-year is WEEKDAY-aligned below the year level — exactly 364 days back', () => {
      const comp = resolveComparison(presetToRange('today', NOW), 'prev-year', NOW)!;
      expect(comp).toEqual(cmp('2025-06-16', '2025-06-16'));
      // 364 = 52 whole weeks, so the weekday is preserved: Monday → Monday.
      expect(differenceInCalendarDays(parseISO(ANCHOR), parseISO(comp.from))).toBe(364);
      expect(format(parseISO(comp.from), 'EEEE')).toBe(format(parseISO(ANCHOR), 'EEEE'));
    });

    // 02C: the calendar-aligned branch widened DOWN to the month shapes. A 364-day shift on
    // July 2026 gives roughly 3 Jul – 2 Aug 2025 — a total mixing two months' takings that
    // no operator would recognise as "last July". Month menus no longer offer the id at all;
    // the branch is fixed anyway so no path can return that window.
    it('prev-year is CALENDAR-aligned for the MONTH shapes too', () => {
      const july: ReportDateRange = { preset: 'custom', from: '2026-07-01', to: '2026-07-31' };
      expect(resolveComparison(july, 'prev-year', NOW)).toEqual(cmp('2025-07-01', '2025-07-31'));

      const mtd = presetToRange('this-month', NOW); // 1–15 Jun 2026
      expect(resolveComparison(mtd, 'prev-year', NOW)).toEqual(cmp('2025-06-01', '2025-06-15'));
    });

    // Asserted as an ABSENCE so the window change above cannot be quietly reverted by
    // re-adding the id to the month menu.
    it('does NOT offer prev-year at month level — that is prev-year-by-day now', () => {
      for (const shape of ['month', 'month-to-date'] as RangeShape[]) {
        expect(comparisonOptionsFor(shape)).withContext(shape).not.toContain('prev-year');
      }
      // …while every shape that legitimately carries it still does.
      for (const shape of ['day', 'week', 'week-to-date', 'year', 'year-to-date'] as RangeShape[]) {
        expect(comparisonOptionsFor(shape)).withContext(shape).toContain('prev-year');
      }
    });

    it('prev-year is CALENDAR-aligned for the year shapes, so it cannot overlap the range', () => {
      const year: ReportDateRange = { preset: 'custom', from: '2025-01-01', to: '2025-12-31' };
      const comp = resolveComparison(year, 'prev-year', NOW)!;
      expect(comp).toEqual(cmp('2024-01-01', '2024-12-31'));
      // A literal 364-day shift would give 2 Jan 2024 – 1 Jan 2025, whose last day sits
      // INSIDE the range being compared. That is the defect this branch exists to avoid.
      expect(comp.to < year.from).toBeTrue();
    });

    it('year-to-date compares against the same dates last year', () => {
      expect(resolveComparison(presetToRange('this-year', NOW), 'prev-year', NOW)).toEqual(
        cmp('2025-01-01', '2025-06-15'),
      );
    });

    it('dates-last-year is CALENDAR-aligned, and differs from prev-year below the year level', () => {
      const today = presetToRange('today', NOW);
      expect(resolveComparison(today, 'dates-last-year', NOW)).toEqual(
        cmp('2025-06-15', '2025-06-15'),
      );
      // Same calendar date, DIFFERENT weekday — which is exactly why both are offered.
      expect(resolveComparison(today, 'dates-last-year', NOW)).not.toEqual(
        resolveComparison(today, 'prev-year', NOW)!,
      );
    });

    it('dates-last-year rolls 29 Feb back onto 28 Feb', () => {
      const leapDay: ReportDateRange = { preset: 'custom', from: '2028-02-29', to: '2028-02-29' };
      expect(resolveComparison(leapDay, 'dates-last-year', new Date(2028, 1, 29))).toEqual(
        cmp('2027-02-28', '2027-02-28'),
      );
    });

    it('prev-period → an equal-length window immediately before the range', () => {
      for (const span of [0, 13, 199]) {
        const range = rangeOfSpan(span);
        const comp = resolveComparison(range, 'prev-period', NOW)!;
        expect(comp.preset).toBe('custom');
        expect(inclusiveLen(comp)).toBe(inclusiveLen(range));
        expect(differenceInCalendarDays(parseISO(range.from), parseISO(comp.to))).toBe(1);
      }
    });

    // Totality. The service rejects a shape-invalid `cmp` before it reaches the resolver,
    // but a hand-edited URL must never be able to throw its way into the render path.
    it('resolves every option against every shape without throwing', () => {
      const ranges: ReportDateRange[] = [
        presetToRange('today', NOW),
        presetToRange('this-week', NOW),
        presetToRange('this-month', NOW),
        presetToRange('this-year', NOW),
        { preset: 'custom', from: '2025-01-01', to: '2025-12-31' },
        rangeOfSpan(13),
      ];
      for (const range of ranges) {
        for (const option of COMPARISON_OPTIONS) {
          expect(() => resolveComparison(range, option, NOW)).not.toThrow();
        }
      }
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

    // The reason Dashboard must not reuse the user-facing comparison resolver. For a
    // month-to-date range the two disagree outright; if this ever stops failing, one of
    // them changed meaning.
    //
    // These two specs predate 02A and are DELIBERATELY KEPT. Only the symbol changed:
    // they used to compare against the deleted preset-keyed `comparisonRange`, and now
    // compare against `resolveComparison(…, 'prev-month-by-day')` — which is what a
    // month-shaped range's default basis resolves to. The divergence they exist to pin
    // survives the rename intact.
    it("DIVERGES from the user-selected 'prev-month-by-day' basis on a partial month", () => {
      const midMonth: ReportDateRange = { preset: 'this-month', from: '2026-06-01', to: '2026-06-15' };
      const NOW_MID = new Date(2026, 5, 15);

      expect(previousEqualLengthPeriod(midMonth)).toEqual({
        preset: 'custom',
        from: '2026-05-17',
        to: '2026-05-31',
      });
      // Post-02A this is partial-to-partial (1–15 May), where it used to be all of May.
      // Either way it is NOT the equal-length window above — that is the point.
      expect(resolveComparison(midMonth, 'prev-month-by-day', NOW_MID)).toEqual({
        preset: 'custom',
        from: '2026-05-01',
        to: '2026-05-15',
      });
    });

    it("coincides with the 'prev-month-by-day' basis only for a WHOLE calendar month", () => {
      const wholeMonth: ReportDateRange = { preset: 'this-month', from: '2026-06-01', to: '2026-06-30' };
      const NOW_EOM = new Date(2026, 5, 30);
      const basis = resolveComparison(wholeMonth, 'prev-month-by-day', NOW_EOM)!;

      // Same end; the equal-length window is one day shorter than full May because
      // June has 30 days and May has 31 — so even here they are not identical.
      expect(previousEqualLengthPeriod(wholeMonth).to).toBe(basis.to);
      expect(previousEqualLengthPeriod(wholeMonth).from).not.toBe(basis.from);
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
      expect(() => resolveTimeframe(range)).not.toThrow();
      // Every preset must also resolve a comparison for its own shape's default basis.
      // The (shape × option) sweep lives in the resolveComparison describe above; this
      // one guards the preset→shape→basis path each host actually lands on.
      const shape = classifyRangeShape(range, NOW);
      expect(() => resolveComparison(range, defaultComparisonFor(shape), NOW)).not.toThrow();
    }
  });
});
