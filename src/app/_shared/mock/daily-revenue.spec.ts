import { dailyRevenue } from './daily-revenue';

describe('shared daily-revenue basis', () => {
  const RID = 'resto-1';
  const FROM = '2026-06-01';
  const TO = '2026-06-30';

  it('returns one row per inclusive calendar day, ascending', () => {
    const rows = dailyRevenue(RID, FROM, TO);
    expect(rows.length).toBe(30);
    expect(rows[0].date).toBe('2026-06-01');
    expect(rows[29].date).toBe('2026-06-30');
  });

  it('returns [] for an inverted range', () => {
    expect(dailyRevenue(RID, TO, FROM)).toEqual([]);
  });

  it('net === gross − discount − refunds for every row (all positive)', () => {
    for (const r of dailyRevenue(RID, FROM, TO)) {
      expect(r.net).toBe(r.gross - r.discount - r.refunds);
      expect(r.gross).toBeGreaterThan(0);
      expect(r.discount).toBeGreaterThanOrEqual(0);
      expect(r.refunds).toBeGreaterThanOrEqual(0);
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
