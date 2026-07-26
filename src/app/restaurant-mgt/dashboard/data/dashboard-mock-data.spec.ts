import { getMockOrdersData, getMockRevenueData } from './dashboard-mock-data';
import { dailyRevenue } from '../../../_shared/mock/daily-revenue';
import { previousEqualLengthPeriod, resolveTimeframe } from '../../../_shared/timeframe';
import { getMockSalesAggregate, mockSalesRefunds, sumAggregate } from '../../reports/data/reports-mock-data';

// The whole point of PRs 3a + 3b: dashboard and Reports both aggregate the ONE shared
// per-(restaurant,day) basis, so an identical {from,to} yields identical figures on both.
describe('dashboard revenue mock — shared-basis reconciliation', () => {
  const RID = 'r1';
  const FROM = '2026-06-01';
  const TO = '2026-06-30';

  /** The bucket the LIVE surface would request for this range. Deriving it here rather
   *  than hard-coding one pins that the mock and the ladder agree — a hand-written
   *  bucket would keep passing even if resolveTimeframe started disagreeing with it. */
  const bucketFor = (from: string, to: string) =>
    resolveTimeframe({ preset: 'custom', from, to }).bucketUnit;

  const sumRows = (rows: { gross: number; net: number; discount: number; refunds: number }[]) =>
    rows.reduce(
      (t, r) => ({
        gross: t.gross + r.gross,
        net: t.net + r.net,
        discounts: t.discounts + r.discount,
        refunds: t.refunds + r.refunds,
      }),
      { gross: 0, net: 0, discounts: 0, refunds: 0 },
    );

  it('totals == Σ of the shared daily basis (net = gross − discounts − refunds)', () => {
    const rev = getMockRevenueData(RID, FROM, TO, bucketFor(FROM, TO));
    expect(rev.totals).toEqual(sumRows(dailyRevenue(RID, FROM, TO)));
    expect(rev.totals.net).toBe(rev.totals.gross - rev.totals.discounts - rev.totals.refunds);
  });

  it('reconciles with the REPORTS totals for the identical {from,to}', () => {
    const rev = getMockRevenueData(RID, FROM, TO, bucketFor(FROM, TO));
    const reports = sumAggregate(getMockSalesAggregate(RID, FROM, TO, 'daily')); // {orders, revenue(=gross−discount), discount}
    const reportsRefunds = mockSalesRefunds(RID, FROM, TO);

    expect(rev.totals.gross - rev.totals.discounts).toBe(reports.revenue);
    expect(rev.totals.discounts).toBe(reports.discount);
    expect(rev.totals.refunds).toBe(reportsRefunds);
    // ⇒ same underlying Orders: dashboard net == Reports net-of-discount − refunds.
    expect(rev.totals.net).toBe(reports.revenue - reportsRefunds);
  });

  it('series sums back to the totals at every rung of the bucket ladder', () => {
    // One case per bucket the ladder can produce, sized so resolveTimeframe picks it.
    const cases: [string, string][] = [
      ['2026-06-24', '2026-06-30'], // 7 days   → day
      [FROM, TO], //                   30 days  → day
      ['2026-01-01', '2026-06-30'], // 181 days → month
      ['2022-01-01', '2026-06-30'], // ~4.5 yrs → year
    ];
    for (const [f, t] of cases) {
      const bucket = bucketFor(f, t);
      const rev = getMockRevenueData(RID, f, t, bucket);
      expect(rev.series.reduce((a, p) => a + p.gross, 0))
        .withContext(`gross @ ${bucket} (${f}..${t})`)
        .toBe(rev.totals.gross);
      expect(rev.series.reduce((a, p) => a + p.net, 0))
        .withContext(`net @ ${bucket} (${f}..${t})`)
        .toBe(rev.totals.net);
    }
  });

  it('hourly view spreads the single day across 24 points that sum to the day total', () => {
    const DAY = '2026-06-15';
    expect(bucketFor(DAY, DAY)).toBe('hour'); // the ladder's ≤1-day rung
    const rev = getMockRevenueData(RID, DAY, DAY, 'hour');
    const [row] = dailyRevenue(RID, DAY, DAY);
    expect(rev.series.length).toBe(24);
    expect(rev.series.reduce((a, p) => a + p.gross, 0)).toBe(row.gross);
    expect(rev.series.reduce((a, p) => a + p.net, 0)).toBe(row.net);
    expect(rev.series.reduce((a, p) => a + p.orders, 0)).toBe(row.orders);
  });

  it('previous_totals == Σ over the equal-length window immediately before the range', () => {
    const rev = getMockRevenueData(RID, FROM, TO, bucketFor(FROM, TO)); // June = 30 days
    // The 30 days ending the day before June 1 → May 2 … May 31.
    expect(rev.previous_totals).toEqual(sumRows(dailyRevenue(RID, '2026-05-02', '2026-05-31')));
  });
});

describe('dashboard orders mock', () => {
  const RID = 'r1';
  const FROM = '2026-06-01';
  const TO = '2026-06-30';
  const bucket = resolveTimeframe({ preset: 'custom', from: FROM, to: TO }).bucketUnit;

  it('total == Σ orders over the shared daily basis', () => {
    const orders = getMockOrdersData(RID, FROM, TO, bucket);
    const expected = dailyRevenue(RID, FROM, TO).reduce((a, r) => a + r.orders, 0);
    expect(orders.total).toBe(expected);
  });

  // Was `Math.round(total * 0.88)` — a flat invented 12% that made the delta chip read
  // roughly +13.6% for every range and told you nothing about the selected window.
  it('previous_total traces to the SAME equal-length window the revenue card uses', () => {
    const orders = getMockOrdersData(RID, FROM, TO, bucket);
    const prev = previousEqualLengthPeriod({ from: FROM, to: TO });
    const expected = dailyRevenue(RID, prev.from, prev.to).reduce((a, r) => a + r.orders, 0);

    expect(orders.previous_total).toBe(expected);
    expect(orders.previous_total).not.toBe(Math.round(orders.total * 0.88));
  });

  it('breakdown sums to exactly the headline total', () => {
    // Largest-remainder allocation: the stacked bar and the number beside it must agree
    // for every total, including ones that do not divide evenly by the status shares.
    for (const [f, t] of [[FROM, TO], ['2026-06-15', '2026-06-15'], ['2026-01-01', '2026-06-30']]) {
      const o = getMockOrdersData(RID, f, t, resolveTimeframe({ preset: 'custom', from: f, to: t }).bucketUnit);
      const summed = o.breakdown.paid + o.breakdown.open + o.breakdown.cancelled + o.breakdown.refunded;
      expect(summed).withContext(`${f}..${t}`).toBe(o.total);
    }
  });

  it('shares the revenue series x-axis exactly', () => {
    const orders = getMockOrdersData(RID, FROM, TO, bucket);
    const revenue = getMockRevenueData(RID, FROM, TO, bucket);
    expect(orders.series.map((p) => p.at)).toEqual(revenue.series.map((p) => p.at));
  });
});
