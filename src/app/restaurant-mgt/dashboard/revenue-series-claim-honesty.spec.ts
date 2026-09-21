import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { TooltipItem } from 'chart.js';

import { RevenueCardComponent } from './components/revenue-card/revenue-card.component';
import { adaptDashboardResponse } from './services/dashboard-adapter';
import { getMockOrdersData, getMockRevenueData } from './data/dashboard-mock-data';
import { classifyPaymentDeclaration } from '../../_shared/reporting/payment-measurement';

/**
 * THE REVENUE SERIES STATES WHAT THE SERVER SENT, AND NOTHING BESIDE IT.
 *
 * `_build_revenue` (`reports_app/controllers/restaurant/dashboard.py`) emits `at`,
 * `gross`, `discounts` and `refunds` per bucket. `adaptRevenueSeries` nonetheless built
 * each point with `orders: 0` and `aov: 0` — literals, backed by no wire key — and the
 * revenue chart's tooltip rendered both, so against a live backend every hover read
 * "Orders: 0 · AOV: 0" about a restaurant that had traded all day.
 *
 * IT WAS INVISIBLE IN THE RUNNING APP, WHICH IS WHAT MADE IT A FLIP-TIME LANDMINE
 * RATHER THAN A BUG SOMEBODY WOULD HAVE SEEN. `DashboardService.USE_MOCK_DATA` is
 * still `true`, and the mock generator populated both fields, so mock mode filled two
 * keys the wire has never had. The tooltip looked correct, and would have started
 * lying at the flip. Same family as the D07 reports-adapter defect (`?? 'Cash'`
 * manufacturing an entire tender column, PR #682) — an ORDERS claim rather than a
 * payment one, which is why it was reported out of that PR's scope rather than folded
 * into it.
 *
 * THE FIX IS THE HONEST ABSENCE: the fields are gone from `RevenueSeriesPoint`, from
 * the adapter, from the mock and from the tooltip. Making them real instead would have
 * been a BACKEND change first — the revenue series is driven by PAID orders while
 * `_build_orders` counts orders PLACED, so "orders in this revenue bucket" needs a
 * definition the server states, and joining the two series by `at` in the client would
 * only have replaced a zero with an assumption.
 *
 * WHAT THESE SPECS PIN. The three producers and the one consumer, so a literal cannot
 * come back at any of them: the adapter (live), the mock (which is what hid it), and
 * the tooltip (which is what said it out loud). The CONTROLS matter as much — the
 * orders series legitimately DOES carry a per-bucket count, and narrowing the revenue
 * point must not be mistaken for a reason to strip that too.
 *
 * REPRODUCED BEFORE IT WAS FIXED. Against unmodified `cabb672` — the two fields back on
 * the type, the two literals back in the adapter, the two lines back in the tooltip and
 * the mock filling both — **4 of the 11 fail and the other 7 hold**, the tooltip one
 * reading `'Gross: 120,000 · Net: 95,000 · Orders: 0 · AOV: 0'` verbatim. The type
 * narrowing is the primary gate (restoring a literal alone will not compile); these are
 * what catch a reintroduction that widens the type and the literal together, which is
 * the shape it would actually come back in.
 */

const RID = 'r1';
const FROM = '2026-06-01';
const TO = '2026-06-30';

/** A `dashboard-v2` payload in WIRE shape: exactly the four keys `_build_revenue`
 *  sends per revenue bucket, beside an orders section that DOES send a count. */
function rawDashboard() {
  return {
    revenue: {
      series: [
        { at: '2026-06-01T00:00:00Z', gross: '120000', discounts: '20000', refunds: '5000' },
        { at: '2026-06-02T00:00:00Z', gross: '90000', discounts: '0', refunds: '0' },
      ],
      totals: { gross: '210000', net: '185000', discounts: '20000', refunds: '5000' },
    },
    orders: {
      series: [
        { at: '2026-06-01T00:00:00Z', count: 12 },
        { at: '2026-06-02T00:00:00Z', count: 9 },
      ],
      breakdown: [{ status: 'paid', count: 21 }],
      total: 21,
    },
  };
}

describe('dashboard revenue series — no claim the server did not make', () => {
  describe('the adapter (the live path)', () => {
    it('THE REGRESSION: a bucket carries exactly {at, gross, net} — no orders, no aov', () => {
      const [point] = adaptDashboardResponse(rawDashboard()).revenue.series;

      expect(Object.keys(point).sort()).toEqual(['at', 'gross', 'net']);
    });

    // `in` rather than toBeUndefined: Jasmine treats an absent key and a key holding
    // `undefined` as equal, and "absent" is precisely what is being asserted. Restoring
    // `orders: 0` / `aov: 0` fails here even if nothing renders them.
    it('THE REGRESSION: does not resurrect them as zeroed keys on any bucket', () => {
      const { series } = adaptDashboardResponse(rawDashboard()).revenue;

      expect(series.length).toBe(2);
      for (const point of series) {
        expect('orders' in point).withContext(point.at).toBeFalse();
        expect('aov' in point).withContext(point.at).toBeFalse();
      }
    });

    // Field by field rather than a whole-object `toEqual`, DELIBERATELY: the shape is
    // owned by the two assertions above, and conflating the two here would report a
    // resurrected literal as a compile error inside a control that is about arithmetic.
    // Keeping them apart is also what lets the whole file compile against BOTH shapes,
    // so reintroducing the fields can be mutation-tested rather than merely argued.
    it('CONTROL: net is still DERIVED from the three figures the server did send', () => {
      // The one computation on this path, and it is arithmetic over server values
      // rather than a figure invented beside them: 120000 − 20000 − 5000.
      const [first, second] = adaptDashboardResponse(rawDashboard()).revenue.series;

      expect(first.at).toBe('2026-06-01T00:00:00Z');
      expect(first.gross).toBe(120000);
      expect(first.net).toBe(95000);
      expect(second.at).toBe('2026-06-02T00:00:00Z');
      expect(second.gross).toBe(90000);
      expect(second.net).toBe(90000);
    });

    it('CONTROL: the ORDERS series still states its per-bucket count', () => {
      // `_build_orders` DOES send one, so this is a real server figure and must not be
      // narrowed away in sympathy with the revenue point.
      expect(adaptDashboardResponse(rawDashboard()).orders.series).toEqual([
        { at: '2026-06-01T00:00:00Z', orders: 12 },
        { at: '2026-06-02T00:00:00Z', orders: 9 },
      ]);
    });
  });

  describe('the mock (what hid it)', () => {
    // NOT a regression pin, and the difference is worth stating: this assertion PASSES
    // against the original defect, because the mock and the adapter were wrong TOGETHER
    // — which is exactly why mock mode showed a correct-looking tooltip and nothing
    // caught it. What it pins is DRIFT, in either direction: a mock that goes back to
    // carrying a field the wire has not got is how the next one of these gets hidden.
    it('the mock states exactly the keys the live path does — no richer, no poorer', () => {
      // Comparing the two key SETS rather than restating a literal list, so the two
      // cannot be brought back into agreement by editing only this spec.
      const live = adaptDashboardResponse(rawDashboard()).revenue.series;
      const mocked = getMockRevenueData(RID, FROM, TO, 'day').series;

      expect(mocked.length).toBeGreaterThan(0);
      for (const point of mocked) {
        expect(Object.keys(point).sort()).withContext(point.at).toEqual(Object.keys(live[0]).sort());
      }
    });

    it('CONTROL: the orders mock still carries a per-bucket count', () => {
      const series = getMockOrdersData(RID, FROM, TO, 'day').series;

      expect(series.length).toBeGreaterThan(0);
      expect(series.every((p) => typeof p.orders === 'number')).toBeTrue();
      expect(series.some((p) => p.orders > 0)).toBeTrue();
    });

    it('CONTROL: the two mock series still share one x-axis', () => {
      // `buildBuckets` feeds both. Splitting the revenue point's shape off the orders
      // point's must not have split the slots they are built from.
      const revenue = getMockRevenueData(RID, FROM, TO, 'day').series;
      const orders = getMockOrdersData(RID, FROM, TO, 'day').series;

      expect(orders.map((p) => p.at)).toEqual(revenue.map((p) => p.at));
    });
  });

  describe('the revenue chart tooltip (what said it out loud)', () => {
    let fixture: ComponentFixture<RevenueCardComponent>;

    /** The lines one hover renders, for the bucket at `index`. Driven end to end from a
     *  WIRE payload through the real adapter, so this pins the whole chain rather than a
     *  hand-built point that could quietly disagree with what the adapter produces. */
    function tooltipLines(index: number): string[] {
      fixture.componentRef.setInput('bucketUnit', 'day');
      // A SUPPORTED MEASUREMENT IS NOW A PRECONDITION OF THE CHART EXISTING, and
      // this fixture predates that input. D07/G1 made `buildChart` withhold the
      // plotted series — `chartOptions = {}` — unless settlement is measured,
      // because a chart is the most persuasive form an unmeasured figure takes.
      // Without this line the tooltip callback is simply absent and these four
      // specs fail on `label === undefined`, which says nothing about what the
      // tooltip READS. That withholding has its own pin (`revenue-chart-withheld`
      // in payment-tracking-disclosure.spec.ts); what THIS group owns is the
      // CONTENT of the tooltip once it is drawn, so it states the precondition
      // rather than either rule being relaxed. Through the same classifier the
      // adapter uses, so it cannot become a second opinion about what `true` means.
      fixture.componentRef.setInput('measurement', classifyPaymentDeclaration(true));
      fixture.componentRef.setInput('revenueData', adaptDashboardResponse(rawDashboard()).revenue);
      fixture.detectChanges();

      const label = fixture.componentInstance.chartOptions.plugins?.tooltip?.callbacks?.label as
        | unknown
        | undefined;
      expect(typeof label).toBe('function');

      const out = (label as (item: TooltipItem<'line'>) => string | string[])(
        { dataIndex: index } as unknown as TooltipItem<'line'>,
      );
      return Array.isArray(out) ? out : [out];
    }

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [RevenueCardComponent],
        providers: [provideRouter([]), provideCharts(withDefaultRegisterables())],
      }).compileComponents();
      fixture = TestBed.createComponent(RevenueCardComponent);
    });

    it('THE REGRESSION: never reads "Orders: 0 · AOV: 0" over a bucket that traded', () => {
      const text = tooltipLines(0).join(' · ');

      expect(text).not.toContain('Orders');
      expect(text).not.toContain('AOV');
    });

    it('THE REGRESSION: states only the two figures the bucket carries', () => {
      // Length as well as content: a third line is a claim, whatever it is spelled.
      expect(tooltipLines(0)).toEqual(['Gross: 120,000', 'Net: 95,000']);
    });

    it('CONTROL: it still states both of them, on every bucket', () => {
      // The fix must not have EMPTIED the tooltip — narrowing it to nothing would be a
      // different way of telling the operator less than the server said. Containment
      // rather than equality on purpose: a control has to hold under the mutation this
      // file is written against, and the line COUNT is already owned by the spec above.
      const lines = tooltipLines(1);

      expect(lines).toContain('Gross: 90,000');
      expect(lines).toContain('Net: 90,000');
    });

    it('CONTROL: a hover past the end of the series still renders nothing at all', () => {
      expect(tooltipLines(99)).toEqual(['']);
    });
  });
});
