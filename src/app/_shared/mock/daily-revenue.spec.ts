import { getDay, parseISO } from 'date-fns';
import { dailyRevenue } from './daily-revenue';

describe('shared daily-revenue basis', () => {
  const RID = 'resto-1';
  const FROM = '2026-06-01';
  const TO = '2026-06-30';
  /** Mon — see CLOSED_WEEKDAY. date-fns getDay: 0 = Sun. */
  const CLOSED = 1;
  const isOpen = (date: string): boolean => getDay(parseISO(date)) !== CLOSED;

  it('returns one row per inclusive calendar day, ascending', () => {
    // A CLOSED day is still a ROW here — only consumers mirroring the backend's group-by drop
    // it. The Dashboard mock densifies off these rows and needs every calendar day present.
    const rows = dailyRevenue(RID, FROM, TO);
    expect(rows.length).toBe(30);
    expect(rows[0].date).toBe('2026-06-01');
    expect(rows[29].date).toBe('2026-06-30');
  });

  it('returns [] for an inverted range', () => {
    expect(dailyRevenue(RID, TO, FROM)).toEqual([]);
  });

  // The mock is deliberately as SPARSE as production. The backend's period aggregation is a
  // plain group-by, so a day with no orders yields no bucket; a mock that trades every single
  // day is denser than the thing it stands in for, and hides every sparse-series defect from
  // the features built on it.
  it('shuts on the closed weekday — a fully zero row, not a quiet one', () => {
    const rows = dailyRevenue(RID, FROM, TO);
    const closed = rows.filter((r) => !isOpen(r.date));

    expect(closed.length).toBe(5); // five Mondays in June 2026
    for (const r of closed) {
      expect(r).toEqual({ date: r.date, orders: 0, gross: 0, discount: 0, refunds: 0, net: 0 });
    }
  });

  it('net === gross − discount − refunds for every row; open days all positive', () => {
    for (const r of dailyRevenue(RID, FROM, TO)) {
      expect(r.net).toBe(r.gross - r.discount - r.refunds);
      expect(r.discount).toBeGreaterThanOrEqual(0);
      expect(r.refunds).toBeGreaterThanOrEqual(0);
      if (!isOpen(r.date)) continue; // a closed day is legitimately all-zero
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
