import {
  getMockDashboardData,
  getMockOrdersData,
  getMockPaymentMethods,
  getMockPopularItems,
  getMockRevenueData,
} from './dashboard-mock-data';
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

// DASH-MOCK-COHERENCE-00. Payments and popular items previously ignored the shared basis
// entirely — payments scaled fixed per-day constants by a CALENDAR-day count, popular
// items took no arguments at all — so a closed Monday read UGX 0 revenue beside UGX 3.6M
// settled and 8.17M of popular-item revenue. These specs pin that every card now reads
// the one basis, and that an ordinary trading day is left looking exactly as it was.
describe('dashboard payments + popular-items mock — one trading basis', () => {
  const RID = 'r1';
  /** June 2026: the 1st, 8th, 15th, 22nd and 29th are Mondays — the mock's closed day. */
  const CLOSED = '2026-06-01';
  const TRADING = '2026-06-02';
  const FROM = '2026-06-01';
  const TO = '2026-06-30';

  const netOver = (from: string, to: string) =>
    dailyRevenue(RID, from, to).reduce((a, r) => a + r.net, 0);
  const ordersOver = (from: string, to: string) =>
    dailyRevenue(RID, from, to).reduce((a, r) => a + r.orders, 0);
  const sumAmounts = (rows: { amount: number }[]) => rows.reduce((a, r) => a + r.amount, 0);

  /**
   * The pre-change fixture. Kept here verbatim as the reference the new generator must
   * still reproduce proportionally — the point of the change is that the ABSOLUTE figures
   * now track the window while the shares that drive ranking and the `%` column do not
   * move at all.
   */
  const LEGACY_ITEMS = [
    { revenue: 2_450_000, qty: 98 },
    { revenue: 1_870_000, qty: 187 },
    { revenue: 1_620_000, qty: 81 },
    { revenue: 1_340_000, qty: 67 },
    { revenue: 890_000, qty: 178 },
  ];
  const LEGACY_TOTAL = LEGACY_ITEMS.reduce((a, i) => a + i.revenue, 0); // 8_170_000
  const LEGACY_QTY_TOTAL = LEGACY_ITEMS.reduce((a, i) => a + i.qty, 0);

  // ── A window with no trade ────────────────────────────────
  describe('a window of closed days only', () => {
    it('settles nothing — every method zero, so the card falls to its empty state', () => {
      expect(netOver(CLOSED, CLOSED)).toBe(0); // precondition: the day really is closed
      const payments = getMockPaymentMethods(RID, CLOSED, CLOSED);

      expect(payments.length).toBe(3); // the methods you accept are still the methods you accept
      for (const p of payments) {
        expect(p.amount).withContext(p.method).toBe(0);
        expect(p.tx_count).withContext(p.method).toBe(0);
      }
      expect(sumAmounts(payments)).toBe(0); // ⇒ the card's `total === 0` branch
    });

    it('has no best sellers — an empty list, not five rows of zero', () => {
      // Five zero rows would render a full ranking table of `0` and `0.0%`; the backend's
      // group-by would return no rows at all, and so does this.
      expect(getMockPopularItems(RID, CLOSED, CLOSED)).toEqual([]);
    });

    it('reads zero across the WHOLE screen, not just the two cards that always did', () => {
      const d = getMockDashboardData(RID, CLOSED, CLOSED, 'hour');
      expect(d.revenue.totals.net).toBe(0);
      expect(d.orders.total).toBe(0);
      expect(sumAmounts(d.payments)).toBe(0);
      expect(d.popular_items).toEqual([]);
    });

    it('survives an inverted range without dividing by an empty basis', () => {
      expect(sumAmounts(getMockPaymentMethods(RID, TO, FROM))).toBe(0);
      expect(getMockPopularItems(RID, TO, FROM)).toEqual([]);
      for (const p of getMockPaymentMethods(RID, TO, FROM)) {
        expect(p.amount).not.toBeNaN();
        expect(p.tx_count).not.toBeNaN();
      }
    });
  });

  // ── Trading days, not calendar days ───────────────────────
  it('scales by trading days — a closed day in the window contributes nothing', () => {
    // Mon (closed) + Tue against Tue alone. The old `rangeDays` scaling would report
    // exactly double for the two-day window; summing the basis reports the same figure.
    const withClosedDay = getMockPaymentMethods(RID, CLOSED, TRADING);
    const tradingOnly = getMockPaymentMethods(RID, TRADING, TRADING);

    expect(sumAmounts(withClosedDay)).toBe(sumAmounts(tradingOnly));
    expect(sumAmounts(withClosedDay)).not.toBe(2 * sumAmounts(tradingOnly));
    expect(getMockPopularItems(RID, CLOSED, TRADING)).toEqual(
      getMockPopularItems(RID, TRADING, TRADING),
    );
  });

  // ── Cross-card coherence on a trading window ──────────────
  describe('an ordinary trading window', () => {
    it('settles exactly what the Revenue card puts in its headline', () => {
      // `revenue-card` renders `totals.net`; the payment card renders Σ amount as
      // "Total settled". Largest-remainder allocation makes them agree to the shilling.
      const d = getMockDashboardData(RID, FROM, TO, 'day');
      expect(sumAmounts(d.payments)).toBe(d.revenue.totals.net);
      expect(sumAmounts(d.payments)).toBe(netOver(FROM, TO));
    });

    it('counts one transaction per order, off the actual order count', () => {
      const d = getMockDashboardData(RID, FROM, TO, 'day');
      const txs = d.payments.reduce((a, p) => a + p.tx_count, 0);
      expect(txs).toBe(d.orders.total);
      expect(txs).toBe(ordersOver(FROM, TO));
    });

    it("bounds best-seller revenue by the window's takings", () => {
      const items = getMockPopularItems(RID, FROM, TO);
      const total = items.reduce((a, i) => a + i.revenue, 0);
      const net = netOver(FROM, TO);

      expect(items.length).toBe(5);
      expect(total).toBeGreaterThan(0);
      // The top five are a share of a wider menu — never more than the window took.
      expect(total).toBeLessThan(net);
      expect(total).toBe(Math.round(net * 0.6));
    });

    it('is scoped per restaurant — two restaurants no longer report identical payments', () => {
      const a = getMockPaymentMethods('resto-A', FROM, TO);
      const b = getMockPaymentMethods('resto-B', FROM, TO);
      expect(sumAmounts(a)).not.toBe(sumAmounts(b));
      expect(getMockPopularItems('resto-A', FROM, TO)).not.toEqual(
        getMockPopularItems('resto-B', FROM, TO),
      );
    });
  });

  // ── The change is invisible on a trading day ──────────────
  // If any of these move, something other than the basis wiring changed too.
  describe('proportions are preserved exactly', () => {
    const EXPECTED_METHOD_SHARE: Record<string, number> = {
      mobile_money: 1_800_000 / 3_600_000, // 50%
      cash: 1_200_000 / 3_600_000, // 33⅓%
      card: 600_000 / 3_600_000, // 16⅔%
    };

    it('splits payments 50 / 33 / 17 as the card renders them, for every window', () => {
      for (const [f, t] of [
        [TRADING, TRADING],
        [FROM, TO],
        ['2026-01-01', '2026-06-30'],
      ]) {
        const payments = getMockPaymentMethods(RID, f, t);
        const total = sumAmounts(payments);
        for (const p of payments) {
          expect(p.amount / total)
            .withContext(`${p.method} @ ${f}..${t}`)
            .toBeCloseTo(EXPECTED_METHOD_SHARE[p.method], 5);
        }
        // The integers the card actually prints.
        const pct = payments.map((p) => Math.round((p.amount / total) * 100));
        expect(pct).withContext(`${f}..${t}`).toEqual([50, 33, 17]);
      }
    });

    it('keeps the best-seller ranking and the % column identical to the old fixture', () => {
      const items = getMockPopularItems(RID, FROM, TO);
      const total = items.reduce((a, i) => a + i.revenue, 0);
      const qtyTotal = items.reduce((a, i) => a + i.qty, 0);

      items.forEach((item, i) => {
        // Revenue tab: the `%` column is a share of the displayed five, so a uniform
        // scale cancels out of it entirely.
        expect(item.revenue / total)
          .withContext(`revenue share #${i + 1}`)
          .toBeCloseTo(LEGACY_ITEMS[i].revenue / LEGACY_TOTAL, 4);
        // Quantity tab: same, and it still ranks Rolex above Juice above Luwombo.
        expect(item.qty / qtyTotal)
          .withContext(`qty share #${i + 1}`)
          .toBeCloseTo(LEGACY_ITEMS[i].qty / LEGACY_QTY_TOTAL, 3);
      });

      // Descending by revenue, as the card's default sort expects.
      expect(items.map((i) => i.revenue)).toEqual(
        [...items.map((i) => i.revenue)].sort((a, b) => b - a),
      );
    });

    it('derives qty from the unit price the old fixture already encoded', () => {
      // The previous figures divided out to exact round prices — 25K / 10K / 20K / 20K /
      // 5K — so quantity follows revenue at a stable price rather than being re-invented.
      const items = getMockPopularItems(RID, FROM, TO);
      items.forEach((item, i) => {
        const unitPrice = LEGACY_ITEMS[i].revenue / LEGACY_ITEMS[i].qty;
        expect(unitPrice).withContext(`unit price #${i + 1}`).toBe(Math.round(unitPrice));
        expect(item.qty)
          .withContext(`qty #${i + 1}`)
          .toBe(Math.round(item.revenue / unitPrice));
      });
    });

    it('tracks the window, where it used to be identical for every range', () => {
      const day = getMockPopularItems(RID, TRADING, TRADING);
      const month = getMockPopularItems(RID, FROM, TO);
      expect(day[0].revenue).toBeLessThan(month[0].revenue);
      expect(day[0].revenue).not.toBe(LEGACY_ITEMS[0].revenue);
    });
  });
});
