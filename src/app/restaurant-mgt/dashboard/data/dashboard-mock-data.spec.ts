import { getMockRevenueData } from './dashboard-mock-data';
import { dailyRevenue } from '../../../_shared/mock/daily-revenue';
import { getMockSalesAggregate, mockSalesRefunds, sumAggregate } from '../../reports/data/reports-mock-data';

// The whole point of PRs 3a + 3b: dashboard and Reports both aggregate the ONE shared
// per-(restaurant,day) basis, so an identical {from,to} yields identical figures on both.
describe('dashboard revenue mock — shared-basis reconciliation', () => {
  const RID = 'r1';
  const FROM = '2026-06-01';
  const TO = '2026-06-30';

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
    const rev = getMockRevenueData(RID, FROM, TO, 'month');
    expect(rev.totals).toEqual(sumRows(dailyRevenue(RID, FROM, TO)));
    expect(rev.totals.net).toBe(rev.totals.gross - rev.totals.discounts - rev.totals.refunds);
  });

  it('reconciles with the REPORTS totals for the identical {from,to}', () => {
    const rev = getMockRevenueData(RID, FROM, TO, 'month');
    const reports = sumAggregate(getMockSalesAggregate(RID, FROM, TO, 'daily')); // {orders, revenue(=gross−discount), discount}
    const reportsRefunds = mockSalesRefunds(RID, FROM, TO);

    expect(rev.totals.gross - rev.totals.discounts).toBe(reports.revenue);
    expect(rev.totals.discounts).toBe(reports.discount);
    expect(rev.totals.refunds).toBe(reportsRefunds);
    // ⇒ same underlying Orders: dashboard net == Reports net-of-discount − refunds.
    expect(rev.totals.net).toBe(reports.revenue - reportsRefunds);
  });

  it('series sums back to the totals for week / month / ytd', () => {
    const cases = [
      ['week', '2026-06-24', '2026-06-30'],
      ['month', FROM, TO],
      ['ytd', '2026-01-01', '2026-06-30'],
    ] as const;
    for (const [period, f, t] of cases) {
      const rev = getMockRevenueData(RID, f, t, period);
      expect(rev.series.reduce((a, p) => a + p.gross, 0)).toBe(rev.totals.gross);
      expect(rev.series.reduce((a, p) => a + p.net, 0)).toBe(rev.totals.net);
    }
  });

  it('day view spreads the single day across 24 hourly points that sum to the day total', () => {
    const DAY = '2026-06-15';
    const rev = getMockRevenueData(RID, DAY, DAY, 'day');
    const [row] = dailyRevenue(RID, DAY, DAY);
    expect(rev.series.length).toBe(24);
    expect(rev.series.reduce((a, p) => a + p.gross, 0)).toBe(row.gross);
    expect(rev.series.reduce((a, p) => a + p.net, 0)).toBe(row.net);
    expect(rev.series.reduce((a, p) => a + p.orders, 0)).toBe(row.orders);
  });

  it('previous_totals == Σ over the equal-length window immediately before the range', () => {
    const rev = getMockRevenueData(RID, FROM, TO, 'month'); // June = 30 days
    // The 30 days ending the day before June 1 → May 2 … May 31.
    expect(rev.previous_totals).toEqual(sumRows(dailyRevenue(RID, '2026-05-02', '2026-05-31')));
  });
});
