import { getDay, parseISO } from 'date-fns';
import { dailyRevenue } from './daily-revenue';

describe('shared daily-revenue basis', () => {
  const RID = 'resto-1';
  const FROM = '2026-06-01';
  const TO = '2026-06-30';

  it('returns one row per inclusive calendar day, ascending', () => {
    // Were CLOSED_WEEKDAY set, a closed day would still be a ROW here — only consumers
    // mirroring the backend's group-by drop it. The Dashboard mock densifies off these rows
    // and needs every calendar day present either way.
    const rows = dailyRevenue(RID, FROM, TO);
    expect(rows.length).toBe(30);
    expect(rows[0].date).toBe('2026-06-01');
    expect(rows[29].date).toBe('2026-06-30');
  });

  it('returns [] for an inverted range', () => {
    expect(dailyRevenue(RID, TO, FROM)).toEqual([]);
  });

  // MOCK-NO-CLOSURES-00. Closures are switched off (CLOSED_WEEKDAY = null), so EVERY calendar
  // day trades — the Dashboard opens on Today and a blank default screen was unacceptable
  // during design work. The spec that pinned the closure itself went with it rather than being
  // left to assert disabled behaviour; restoring the constant is what restores both.
  it('trades on every weekday — no day is zeroed', () => {
    const rows = dailyRevenue(RID, FROM, TO);
    const weekdaysSeen = new Set(rows.map((r) => getDay(parseISO(r.date))));

    // Prove the window really spans all seven, rather than assuming June 2026 does.
    expect(weekdaysSeen.size).toBe(7);
    for (const r of rows) {
      expect(r.orders).withContext(r.date).toBeGreaterThan(0);
      expect(r.net).withContext(r.date).toBeGreaterThan(0);
    }
  });

  it('net === gross − discount − refunds for every row, all of them positive', () => {
    for (const r of dailyRevenue(RID, FROM, TO)) {
      expect(r.net).toBe(r.gross - r.discount - r.refunds);
      expect(r.discount).toBeGreaterThanOrEqual(0);
      expect(r.refunds).toBeGreaterThanOrEqual(0);
      expect(r.gross).toBeGreaterThan(0);
      expect(r.net).toBeGreaterThan(0);
    }
  });

  it('is deterministic for the same (restaurant, range)', () => {
    expect(dailyRevenue(RID, FROM, TO)).toEqual(dailyRevenue(RID, FROM, TO));
  });

  it('seeds PER DAY — a given day is identical regardless of the range containing it', () => {
    // The linchpin: the 2026-06-15 row must be byte-identical whether the query is
    // the whole month or a narrow window around the 15th. This is what makes every
    // aggregation period reconcile by construction.
    const wide = dailyRevenue(RID, FROM, TO).find((r) => r.date === '2026-06-15');
    const narrow = dailyRevenue(RID, '2026-06-10', '2026-06-20').find((r) => r.date === '2026-06-15');
    expect(wide).toBeDefined();
    expect(wide).toEqual(narrow!);
  });

  it('varies by restaurant (the seed includes the restaurant id)', () => {
    const a = dailyRevenue('resto-A', FROM, TO);
    const b = dailyRevenue('resto-B', FROM, TO);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});
