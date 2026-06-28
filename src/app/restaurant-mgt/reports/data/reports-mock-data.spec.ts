import { getMockSalesAggregate, getMockSalesHourly, mockSalesRefunds } from './reports-mock-data';

const RID = 'r1';

describe('reports mock data — getMockSalesHourly', () => {
  const FROM = '2026-06-01';
  const TO = '2026-06-07';

  const sumHours = (rows: { hour: number; count: number }[], from: number, to: number): number =>
    rows.filter((r) => r.hour >= from && r.hour <= to).reduce((acc, r) => acc + r.count, 0);

  it('returns exactly 24 rows, one per hour-of-day in order (the zero-filled contract)', () => {
    const rows = getMockSalesHourly(RID, FROM, TO);
    expect(rows.length).toBe(24);
    rows.forEach((r, i) => expect(r.hour).toBe(i));
  });

  it('emits non-negative integer counts and non-negative UGX revenue/discount', () => {
    for (const r of getMockSalesHourly(RID, FROM, TO)) {
      expect(Number.isInteger(r.count)).toBeTrue();
      expect(r.count).toBeGreaterThanOrEqual(0);
      expect(r.revenue).toBeGreaterThanOrEqual(0);
      expect(r.discount).toBeGreaterThanOrEqual(0);
    }
  });

  it('is deterministic for a given range (seeded PRNG)', () => {
    expect(getMockSalesHourly(RID, FROM, TO)).toEqual(getMockSalesHourly(RID, FROM, TO));
  });

  it('produces a different dataset for a different range', () => {
    const a = JSON.stringify(getMockSalesHourly(RID, FROM, TO));
    const b = JSON.stringify(getMockSalesHourly(RID, '2026-07-01', '2026-07-07'));
    expect(a).not.toBe(b);
  });

  it('has a plausible peaked shape — lunch and dinner both dwarf the overnight lull', () => {
    const rows = getMockSalesHourly(RID, FROM, TO);
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

  it('sums to the daily-basis totals (derived, not independent)', () => {
    // Hourly is a distribution of the same basis the aggregate uses, so its column
    // totals match the daily aggregate's totals for the same range (± rounding).
    const hourly = getMockSalesHourly(RID, FROM, TO);
    const daily = getMockSalesAggregate(RID, FROM, TO, 'daily');
    const dailyOrders = daily.reduce((a, r) => a + r.orders, 0);
    const hourlyCount = hourly.reduce((a, r) => a + r.count, 0);
    expect(Math.abs(hourlyCount - dailyOrders)).toBeLessThanOrEqual(24); // ≤1 per hour bucket from rounding
  });
});

describe('reports mock data — mockSalesRefunds', () => {
  it('returns a non-negative UGX figure, deterministic per range', () => {
    const a = mockSalesRefunds(RID, '2026-06-01', '2026-06-30');
    const b = mockSalesRefunds(RID, '2026-06-01', '2026-06-30');
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 for an inverted range', () => {
    expect(mockSalesRefunds(RID, '2026-06-30', '2026-06-01')).toBe(0);
  });
});

describe('reports mock data — getMockSalesAggregate (annual bucket)', () => {
  it('returns one row per calendar year, keyed by bare year ("yyyy")', () => {
    const rows = getMockSalesAggregate(RID, '2023-01-01', '2026-12-31', 'annual');
    expect(rows.map((r) => r.period)).toEqual(['2023', '2024', '2025', '2026']);
  });

  it('emits positive orders/revenue and is deterministic per range', () => {
    const rows = getMockSalesAggregate(RID, '2023-01-01', '2026-12-31', 'annual');
    for (const r of rows) {
      expect(r.orders).toBeGreaterThan(0);
      expect(r.revenue).toBeGreaterThan(0);
      expect(r.discount).toBeGreaterThanOrEqual(0);
    }
    expect(getMockSalesAggregate(RID, '2023-01-01', '2026-12-31', 'annual')).toEqual(rows);
  });
});

describe('reports mock data — granularity reconciliation (shared basis)', () => {
  // THE acceptance guarantee: every coarser bucket is a pure sum of the SAME daily
  // rows, so day / month / annual reconcile by construction for an identical range.
  const sum = (rows: { orders: number; revenue: number; discount: number }[]) =>
    rows.reduce(
      (a, r) => ({ orders: a.orders + r.orders, revenue: a.revenue + r.revenue, discount: a.discount + r.discount }),
      { orders: 0, revenue: 0, discount: 0 },
    );

  it('monthly bucket === sum of the daily rows for the same range', () => {
    const FROM = '2026-06-01';
    const TO = '2026-06-30';
    const daily = getMockSalesAggregate(RID, FROM, TO, 'daily');
    const monthly = getMockSalesAggregate(RID, FROM, TO, 'monthly');
    const s = sum(daily);

    expect(daily.length).toBe(30);
    expect(monthly.length).toBe(1); // June only
    expect(monthly[0].period).toBe('2026-06');
    expect(monthly[0].orders).toBe(s.orders);
    expect(monthly[0].revenue).toBe(s.revenue);
    expect(monthly[0].discount).toBe(s.discount);
  });

  it('annual bucket === sum of its monthly buckets for the same range', () => {
    const FROM = '2026-01-01';
    const TO = '2026-12-31';
    const monthly = getMockSalesAggregate(RID, FROM, TO, 'monthly');
    const annual = getMockSalesAggregate(RID, FROM, TO, 'annual');
    const s = sum(monthly);

    expect(monthly.length).toBe(12);
    expect(annual.length).toBe(1);
    expect(annual[0].period).toBe('2026');
    expect(annual[0].orders).toBe(s.orders);
    expect(annual[0].revenue).toBe(s.revenue);
    expect(annual[0].discount).toBe(s.discount);
  });
});
