import { getMockSalesAggregate, getMockSalesHourly, mockSalesRefunds } from './reports-mock-data';

describe('reports mock data — getMockSalesHourly', () => {
  const FROM = '2026-06-01';
  const TO = '2026-06-07';

  const sumHours = (rows: { hour: number; count: number }[], from: number, to: number): number =>
    rows.filter((r) => r.hour >= from && r.hour <= to).reduce((acc, r) => acc + r.count, 0);

  it('returns exactly 24 rows, one per hour-of-day in order (the zero-filled contract)', () => {
    const rows = getMockSalesHourly(FROM, TO);
    expect(rows.length).toBe(24);
    rows.forEach((r, i) => expect(r.hour).toBe(i));
  });

  it('emits non-negative integer counts and non-negative UGX revenue/discount', () => {
    for (const r of getMockSalesHourly(FROM, TO)) {
      expect(Number.isInteger(r.count)).toBeTrue();
      expect(r.count).toBeGreaterThanOrEqual(0);
      expect(r.revenue).toBeGreaterThanOrEqual(0);
      expect(r.discount).toBeGreaterThanOrEqual(0);
    }
  });

  it('is deterministic for a given range (seeded PRNG)', () => {
    expect(getMockSalesHourly(FROM, TO)).toEqual(getMockSalesHourly(FROM, TO));
  });

  it('produces a different dataset for a different range', () => {
    const a = JSON.stringify(getMockSalesHourly(FROM, TO));
    const b = JSON.stringify(getMockSalesHourly('2026-07-01', '2026-07-07'));
    expect(a).not.toBe(b);
  });

  it('has a plausible peaked shape — lunch and dinner both dwarf the overnight lull', () => {
    const rows = getMockSalesHourly(FROM, TO);
    const overnight = sumHours(rows, 0, 5);
    const lunch = sumHours(rows, 12, 14);
    const dinner = sumHours(rows, 19, 21);

    expect(lunch).toBeGreaterThan(overnight);
    expect(dinner).toBeGreaterThan(overnight);

    // The busiest hour sits inside the midday → evening service window.
    const peakHour = rows.reduce((best, r) => (r.count > best.count ? r : best)).hour;
    expect(peakHour).toBeGreaterThanOrEqual(12);
    expect(peakHour).toBeLessThanOrEqual(21);
  });
});

describe('reports mock data — mockSalesRefunds', () => {
  it('returns a non-negative UGX figure, deterministic per range', () => {
    const a = mockSalesRefunds('2026-06-01', '2026-06-30');
    const b = mockSalesRefunds('2026-06-01', '2026-06-30');
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 for an inverted range', () => {
    expect(mockSalesRefunds('2026-06-30', '2026-06-01')).toBe(0);
  });
});

describe('reports mock data — getMockSalesAggregate (annual bucket)', () => {
  it('returns one row per calendar year, keyed by bare year ("yyyy")', () => {
    const rows = getMockSalesAggregate('2023-01-01', '2026-12-31', 'annual');
    expect(rows.map((r) => r.period)).toEqual(['2023', '2024', '2025', '2026']);
  });

  it('emits positive orders/revenue and is deterministic per range', () => {
    const rows = getMockSalesAggregate('2023-01-01', '2026-12-31', 'annual');
    for (const r of rows) {
      expect(r.orders).toBeGreaterThan(0);
      expect(r.revenue).toBeGreaterThan(0);
      expect(r.discount).toBeGreaterThanOrEqual(0);
    }
    expect(getMockSalesAggregate('2023-01-01', '2026-12-31', 'annual')).toEqual(rows);
  });
});
