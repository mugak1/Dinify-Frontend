import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

import { PaymentMethodsCardComponent } from './components/payment-methods-card/payment-methods-card.component';
import { RevenueCardComponent } from './components/revenue-card/revenue-card.component';
import { TablesCardComponent } from './components/tables-card/tables-card.component';
import { TotalOrdersCardComponent } from './components/total-orders-card/total-orders-card.component';
import { OrdersData, RevenueData, TablesData } from './models/dashboard.models';
import { adaptDashboardResponse } from './services/dashboard-adapter';
import { getMockDashboardData } from './data/dashboard-mock-data';
import {
  classifyPaymentDeclaration,
  comparisonIsSupported,
  measurementIsSupported,
  measurementNotice,
  measurementWithholdsFigures,
  readPaymentMeasurement,
} from '../../_shared/reporting/payment-measurement';

/**
 * D07/G1 — AN UNKNOWN MEASUREMENT IS RENDERED AS UNAVAILABLE, NOT AS A NUMBER.
 *
 * Several dashboard figures are aggregated over `payment_status='paid'`, a
 * column with no writer. D07/PR-5 made the server SAY so
 * (`payment_tracking_enabled`) and made three cards print a note underneath the
 * figures. **That was not enough, and this file is the correction.** A note
 * under a plotted series still shows the series; an operator reads the series.
 * Where a governed figure cannot be vouched for it is now REPLACED by a
 * statement of what is not known.
 *
 * FOUR ANSWERS, NOT TWO. The old reading was `=== false`, which merged three
 * different situations — the server said false, the server never said, and the
 * server said something unreadable — into a single "not false, so measured".
 * `_shared/reporting/payment-measurement.ts` is the one decision now, and the
 * adapter classifies it once from the payload because key presence is the only
 * thing that separates silence from an unreadable answer.
 *
 * FOUR CONSUMERS, and the fourth was never wired at all: the Tables card takes
 * five paid-gated fields and the Dashboard template bound the declaration on
 * every card except that one.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THREE PR-5 ORACLES ARE CORRECTED HERE RATHER THAN RELAXED, and each is
 * recorded at the spec that replaced it:
 *
 *   1. "CONTROL: an older server keeps the original wording" asserted that a
 *      MISSING declaration leaves the measured display intact. That is the
 *      behaviour G1 removes — missing is not permission — so the control is
 *      inverted and the reason is written at its replacement below.
 *   2. "CONTROL: it recomputes, suppresses and reprices nothing" asserted all
 *      four Revenue pills RENDER their figures. Its INTENT survives untouched
 *      and is still pinned (the server's numbers are neither recomputed nor
 *      repriced, and the payload is not mutated); what changed is that three
 *      of the four are no longer PRINTED.
 *   3. The four `netIsNegative` specs pinned a sentence explaining why the Net
 *      headline read below zero. That headline is no longer rendered when the
 *      basis is unvouched, so the clause explained a figure that is not there.
 *      The getter is deleted and the specs go with it; a control below pins
 *      that a measuring server's below-zero net is still shown plainly, which
 *      is the fact those specs existed to protect.
 * ──────────────────────────────────────────────────────────────────────────
 */
describe('D07/G1 — payment measurement', () => {

  // ── The one decision ──────────────────────────────────────────────────────
  describe('the shared decision separates all four answers', () => {
    it('an explicit true is the only thing that supports a figure', () => {
      expect(readPaymentMeasurement({ payment_tracking_enabled: true }))
        .toEqual({ kind: 'supported' });
      expect(measurementIsSupported({ kind: 'supported' })).toBeTrue();
    });

    it('an explicit false is the server stating a limitation of its own', () => {
      expect(readPaymentMeasurement({ payment_tracking_enabled: false }))
        .toEqual({ kind: 'unavailable' });
    });

    it('THE REGRESSION: a missing key is unestablished, NOT measured', () => {
      // PR-5 read this as "not false, therefore fine" and printed the figures.
      expect(readPaymentMeasurement({})).toEqual({ kind: 'unestablished' });
      expect(measurementWithholdsFigures(readPaymentMeasurement({}))).toBeTrue();
    });

    it('THE REGRESSION: an explicit null is unusable, NOT silence', () => {
      // A key present with an unreadable value is a server that reached for
      // this fact and failed. Filing it as "never mentioned" would report a
      // broken contract as an old one, and nobody would look.
      expect(readPaymentMeasurement({ payment_tracking_enabled: null }))
        .toEqual({ kind: 'unusable' });
      expect(readPaymentMeasurement({ payment_tracking_enabled: null }))
        .not.toEqual(readPaymentMeasurement({}));
    });

    it('every other shape is unusable too', () => {
      for (const v of ['true', 'false', 0, 1, {}, []]) {
        expect(readPaymentMeasurement({ payment_tracking_enabled: v }))
          .toEqual({ kind: 'unusable' }, `for ${JSON.stringify(v)}`);
      }
    });

    it('a payload that is not an object declares nothing', () => {
      for (const p of [null, undefined, 'x', 7]) {
        expect(readPaymentMeasurement(p)).toEqual({ kind: 'unestablished' });
      }
    });

    it('a consumer given no decision at all withholds, rather than failing open', () => {
      expect(measurementIsSupported(null)).toBeFalse();
      expect(measurementIsSupported(undefined)).toBeFalse();
      expect(measurementWithholdsFigures(null)).toBeTrue();
    });

    it('false and missing do not share wording', () => {
      const stated = measurementNotice({ kind: 'unavailable' }, 'X');
      const silent = measurementNotice({ kind: 'unestablished' }, 'X');
      const broken = measurementNotice({ kind: 'unusable' }, 'X');
      expect(stated).not.toEqual(silent);
      expect(silent).not.toEqual(broken);
      expect(stated).toContain("Dinify doesn't record settled payments");
      // Saying that on behalf of a server that never said it would be the same
      // manufactured claim pointed the other way.
      expect(silent).not.toContain("Dinify doesn't record settled payments");
      expect(silent).toContain("didn't state");
      expect(broken).toContain("couldn't be read");
    });

    it('a measured figure needs no sentence', () => {
      expect(measurementNotice({ kind: 'supported' }, 'X')).toBeNull();
    });

    it('a comparison needs BOTH windows supported', () => {
      const yes = { kind: 'supported' } as const;
      const no = { kind: 'unavailable' } as const;
      expect(comparisonIsSupported(yes, yes)).toBeTrue();
      expect(comparisonIsSupported(yes, no)).toBeFalse();
      expect(comparisonIsSupported(no, yes)).toBeFalse();
      expect(comparisonIsSupported(yes, null)).toBeFalse();
    });
  });

  // ── The adapter is the only thing that still holds the payload ────────────
  describe('the adapter classifies once, from the payload', () => {
    it('carries the server\'s answer through to the model', () => {
      expect(adaptDashboardResponse({ payment_tracking_enabled: false })
        .payment_measurement).toEqual({ kind: 'unavailable' });
      expect(adaptDashboardResponse({ payment_tracking_enabled: true })
        .payment_measurement).toEqual({ kind: 'supported' });
    });

    it('THE REGRESSION: it no longer collapses missing and unreadable', () => {
      // Both used to become `undefined`, and `undefined === false` is false, so
      // both printed the figures.
      expect(adaptDashboardResponse({}).payment_measurement)
        .toEqual({ kind: 'unestablished' });
      expect(adaptDashboardResponse({ payment_tracking_enabled: null }).payment_measurement)
        .toEqual({ kind: 'unusable' });
    });

    it('the decision is REQUIRED on the model, so no consumer invents one', () => {
      expect(adaptDashboardResponse({}).payment_measurement).toBeDefined();
    });

    it('the mock states the same fact through the same function', () => {
      // The mock builds the response directly rather than adapting a payload,
      // so a literal here would be a second opinion about what `false` means.
      const data = getMockDashboardData('r1', '2026-09-01', '2026-09-07', 'day');
      expect(data.payment_measurement).toEqual(classifyPaymentDeclaration(false));
      expect(data.payment_measurement).toEqual({ kind: 'unavailable' });
    });
  });

  // ── Revenue ───────────────────────────────────────────────────────────────
  describe('the revenue card withholds what it cannot vouch for', () => {
    let fixture: ComponentFixture<RevenueCardComponent>;

    const revenue = (net: number): RevenueData => ({
      series: [
        { at: '2026-09-01T00:00:00+03:00', gross: 0, net, orders: 0, aov: 0 },
      ],
      totals: { gross: 0, discounts: 0, refunds: net < 0 ? -net : 0, net },
    } as RevenueData);

    const WINDOW = { from: '2026-08-01', to: '2026-08-31', preset: 'custom' } as any;

    /** `setInput` so `ngOnChanges` runs and the pills/chart are really built. */
    const render = (data: RevenueData, kind?: string, baseline?: string) => {
      fixture.componentRef.setInput('bucketUnit', 'day');
      fixture.componentRef.setInput('measurement', kind ? { kind } : null);
      fixture.componentRef.setInput(
        'baselineMeasurement', baseline ? { kind: baseline } : null,
      );
      fixture.componentRef.setInput('previousNet', 200000);
      fixture.componentRef.setInput('comparisonWindow', WINDOW);
      fixture.componentRef.setInput('revenueData', data);
      fixture.detectChanges();
    };

    const el = (id: string) =>
      (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);
    const text = () =>
      ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ').trim();

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [RevenueCardComponent],
        providers: [provideRouter([]), provideCharts(withDefaultRegisterables())],
      }).compileComponents();
      fixture = TestBed.createComponent(RevenueCardComponent);
    });

    for (const kind of ['unavailable', 'unestablished', 'unusable']) {
      it(`THE REGRESSION (${kind}): the headline figure is not rendered`, () => {
        render(revenue(-5000), kind);
        expect(el('revenue-headline-withheld')).not.toBeNull();
        expect(text()).not.toContain('-5,000');
      });

      it(`THE REGRESSION (${kind}): no percentage is computed`, () => {
        render(revenue(-5000), kind, kind);
        expect(fixture.componentInstance.percentageChange).toBeNull();
        expect(text()).not.toMatch(/\d+\.\d%/);
      });

      it(`THE REGRESSION (${kind}): the chart is not drawn`, () => {
        render(revenue(-5000), kind);
        expect(el('revenue-chart-withheld')).not.toBeNull();
        expect(fixture.componentInstance.chartData.datasets).toEqual([]);
      });

      it(`(${kind}): the withheld figure carries an accessible name`, () => {
        render(revenue(-5000), kind);
        expect(el('revenue-headline-withheld')!.getAttribute('aria-label'))
          .toContain('Not shown');
      });
    }

    it('THE REGRESSION: a missing declaration withholds exactly as an explicit false does', () => {
      // This REPLACES PR-5's "CONTROL: an older server keeps the original
      // wording", which asserted the opposite. That control was written when
      // the remedy was a note; under G1 the remedy is withholding, and
      // "the server has not told us" is not a reason to present a figure as a
      // measurement. Tolerating an older server is not the same as trusting it.
      render(revenue(-5000), 'unestablished');
      expect(el('revenue-headline-withheld')).not.toBeNull();
    });

    it('the three states are not given the same sentence', () => {
      const said: string[] = [];
      for (const kind of ['unavailable', 'unestablished', 'unusable']) {
        render(revenue(0), kind);
        said.push(fixture.componentInstance.measurementNote ?? '');
      }
      expect(new Set(said).size).toBe(3);
    });

    it('REFUNDS SURVIVES: a real measurement is not withheld with the rest', () => {
      // `refunds` aggregates order_status, which is written on every refund.
      // Blanking it would hide a fact the server does measure — and "no
      // removing refunds" is an explicit constraint on this work.
      render(revenue(-5000), 'unavailable');
      const pills = fixture.componentInstance.pills;
      expect(pills.filter((p) => !p.withheld).map((p) => p.label)).toEqual(['Refunds']);
      expect(text()).toContain('5,000');
    });

    it('CONTROL: it recomputes, suppresses and reprices nothing', () => {
      // PR-5's control, INTENT PRESERVED. It used to assert that all four
      // figures render; three of them no longer do. What it was protecting —
      // that the server's own numbers are neither recalculated nor repriced,
      // and the payload is not mutated — is unchanged and still pinned.
      const data: RevenueData = {
        series: [],
        totals: { gross: 900000, discounts: 40000, refunds: 10000, net: 850000 },
      } as RevenueData;
      render(data, 'unavailable');
      expect(fixture.componentInstance.pills.map((p) => p.formatted))
        .toEqual(['900,000', '40,000', '10,000', '850,000']);
      expect(data.totals).toEqual(
        { gross: 900000, discounts: 40000, refunds: 10000, net: 850000 },
      );
    });

    it('CONTROL: a measuring server renders the headline, the badge and the chart', () => {
      render(revenue(120000), 'supported', 'supported');
      expect(el('revenue-headline-withheld')).toBeNull();
      expect(el('revenue-chart-withheld')).toBeNull();
      expect(fixture.componentInstance.measurementNote).toBeNull();
      expect(fixture.componentInstance.percentageChange).not.toBeNull();
      expect(fixture.componentInstance.chartData.datasets.length).toBe(1);
    });

    it('CONTROL: a below-zero net from a MEASURING server is shown plainly', () => {
      // This is what the deleted `netIsNegative` specs were protecting: a
      // refund-heavy week is the restaurant's week, not our instrumentation,
      // and it gets no sentence and no withholding from us.
      render(revenue(-4500), 'supported', 'supported');
      expect(el('revenue-headline-withheld')).toBeNull();
      expect(fixture.componentInstance.measurementNote).toBeNull();
      expect(text()).toContain('-4,500');
    });

    it('THE COMPARISON WINDOW IS A SEPARATE RESPONSE, and one of the two is enough', () => {
      // A rollout answers the two calls from different builds. A delta between
      // a measured window and an unmeasured one describes our deployment.
      render(revenue(120000), 'supported', 'unestablished');
      expect(fixture.componentInstance.comparable).toBeFalse();
      expect(fixture.componentInstance.percentageChange).toBeNull();
      expect(el('revenue-comparison-withheld')).not.toBeNull();
      // And no baseline AMOUNT is named — it comes from the same basis.
      expect(text()).not.toContain('200K');
    });

    it('CAPABILITY CHANGE CLEARS THE CHART, rather than leaving the last series', () => {
      render(revenue(120000), 'supported', 'supported');
      expect(fixture.componentInstance.chartData.datasets.length).toBe(1);
      fixture.componentRef.setInput('measurement', { kind: 'unavailable' });
      fixture.detectChanges();
      expect(fixture.componentInstance.chartData.datasets).toEqual([]);
    });
  });

  // ── Payment Methods ───────────────────────────────────────────────────────
  describe('the payment-methods card', () => {
    function render(kind: string | null, methods: any[] | null = []): string {
      TestBed.configureTestingModule({ imports: [PaymentMethodsCardComponent] });
      const fixture = TestBed.createComponent(PaymentMethodsCardComponent);
      fixture.componentRef.setInput('measurement', kind ? { kind } : null);
      fixture.componentRef.setInput('paymentMethods', methods);
      fixture.detectChanges();
      return ((fixture.nativeElement as HTMLElement).textContent ?? '')
        .replace(/\s+/g, ' ').trim();
    }

    afterEach(() => TestBed.resetTestingModule());

    for (const kind of ['unavailable', 'unestablished', 'unusable']) {
      it(`THE REGRESSION (${kind}): it claims nothing about the period`, () => {
        const t = render(kind);
        expect(t).not.toContain('No settled payments in this period');
        expect(t).not.toContain('No payments recorded in this period');
      });

      it(`THE REGRESSION (${kind}): rows are not rendered as a share of payments`, () => {
        const t = render(kind, [{ method: 'cash', amount: 5000, tx_count: 2 }]);
        expect(t).not.toContain('Total settled');
        expect(t).not.toContain('Based on payments recorded');
      });
    }

    it('CONTROL: a measuring server with no rows says what IS true of the period', () => {
      // "RECORDED", not "settled": this sentence is now only ever said by a
      // server that does record settlement, and "no settled payments" invites
      // the reading that money was owed and not taken.
      const t = render('supported');
      expect(t).toContain('No payments recorded in this period');
    });

    it('CONTROL: a measuring server with rows renders them, with one footer', () => {
      const t = render('supported', [{ method: 'cash', amount: 5000, tx_count: 2 }]);
      expect(t).toContain('Total settled');
      expect(t).toContain('Based on payments recorded in the selected period.');
      expect(t).not.toContain("Dinify doesn't record settled payments");
    });
  });

  // ── Total Orders ──────────────────────────────────────────────────────────
  describe('the total-orders card withholds only the payment axis', () => {
    let fixture: ComponentFixture<TotalOrdersCardComponent>;

    const orders: OrdersData = {
      series: [{ at: '2026-09-01T00:00:00+03:00', orders: 40 }],
      total: 40,
      breakdown: { paid: 0, open: 37, cancelled: 2, refunded: 1 },
    } as OrdersData;

    const render = (kind?: string) => {
      fixture.componentRef.setInput('bucketUnit', 'day');
      fixture.componentRef.setInput('measurement', kind ? { kind } : null);
      fixture.componentRef.setInput('ordersData', orders);
      fixture.detectChanges();
    };

    const el = (id: string) =>
      (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);
    const text = () =>
      ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ').trim();

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [TotalOrdersCardComponent],
        providers: [provideCharts(withDefaultRegisterables())],
      }).compileComponents();
      fixture = TestBed.createComponent(TotalOrdersCardComponent);
    });

    for (const kind of ['unavailable', 'unestablished', 'unusable']) {
      it(`THE REGRESSION (${kind}): Paid and Open/Unpaid are withheld`, () => {
        render(kind);
        expect(el('orders-withheld-paid')).not.toBeNull();
        expect(el('orders-withheld-open')).not.toBeNull();
        const segs = fixture.componentInstance.segments;
        expect(segs.filter((s) => s.withheld).map((s) => s.key))
          .toEqual(['paid', 'open']);
      });

      it(`(${kind}): the card is not hidden and the real counts stay`, () => {
        render(kind);
        // Total is a plain order count; cancelled/refunded are order-status.
        // The headline is asserted on the BINDING rather than the rendered
        // text: `app-animated-number` counts up over 2s, so a synchronous read
        // sees '0' for a figure that is present and correct.
        const headline = (fixture.nativeElement as HTMLElement)
          .querySelector('app-animated-number');
        expect(headline).not.toBeNull();
        expect(fixture.componentInstance.ordersData!.total).toBe(40);
        expect(el('orders-withheld-cancelled')).toBeNull();
        expect(el('orders-withheld-refunded')).toBeNull();
        expect(text()).toContain('2Cancelled5.0%');
        expect(text()).toContain('1Refunded2.5%');
      });
    }

    it('the unmeasured orders appear once, as a remainder of measured figures', () => {
      render('unavailable');
      // 40 total - 2 cancelled - 1 refunded = 37 whose payment state is unknown.
      // Derived from three measurements; it never claims which side they fall.
      expect(fixture.componentInstance.unmeasuredBandTitle)
        .toBe('Payment state not measured: 37');
      expect(el('orders-unmeasured-band')).not.toBeNull();
    });

    it('a payload whose parts exceed its total cannot draw a negative band', () => {
      fixture.componentRef.setInput('measurement', { kind: 'unavailable' });
      fixture.componentRef.setInput('ordersData', {
        series: [], total: 2, breakdown: { paid: 0, open: 0, cancelled: 5, refunded: 5 },
      } as OrdersData);
      fixture.detectChanges();
      expect(fixture.componentInstance.unmeasuredShare).toBe(0);
    });

    it('it names only the two segments that are not measured', () => {
      render('unavailable');
      const note = el('orders-tracking-note');
      expect(note).not.toBeNull();
      const t = (note!.textContent ?? '').replace(/\s+/g, ' ').trim();
      expect(t).toContain('Paid and Open/Unpaid');
      expect(t).not.toContain('Cancelled');
      expect(t).not.toContain('Refunded');
    });

    it('THE TREND BADGE IS NOT WITHHELD — it is an order count on both sides', () => {
      fixture.componentRef.setInput('previousTotal', 20);
      fixture.componentRef.setInput(
        'comparisonWindow', { from: '2026-08-01', to: '2026-08-31', preset: 'custom' } as any,
      );
      render('unavailable');
      expect(fixture.componentInstance.percentageChange).toBe(100);
    });

    it('CONTROL: a measuring server renders all four counts', () => {
      render('supported');
      expect(el('orders-withheld-paid')).toBeNull();
      expect(el('orders-tracking-note')).toBeNull();
      expect(el('orders-unmeasured-band')).toBeNull();
      expect(fixture.componentInstance.segments.every((s) => !s.withheld)).toBeTrue();
    });

    it('CONTROL: every count is still the server\'s own', () => {
      render('unavailable');
      expect(fixture.componentInstance.segments.map((s) => s.count))
        .toEqual([0, 37, 2, 1]);
    });
  });

  // ── Tables — the consumer that was never wired ────────────────────────────
  describe('the tables card, which the dashboard never bound at all', () => {
    let fixture: ComponentFixture<TablesCardComponent>;

    const tables: TablesData = {
      total: 10, occupied: 4, occupancy_pct: 40,
      median_visit_minutes: 0, turns_today: 0, turns_yesterday: 0,
      avg_ticket_today: 0, avg_ticket_yesterday: 0,
    } as TablesData;

    const render = (kind?: string) => {
      fixture.componentRef.setInput('measurement', kind ? { kind } : null);
      fixture.componentRef.setInput('tablesData', tables);
      fixture.detectChanges();
    };

    const el = (id: string) =>
      (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);
    const text = () =>
      ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ').trim();

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [TablesCardComponent],
        providers: [provideRouter([])],
      }).compileComponents();
      fixture = TestBed.createComponent(TablesCardComponent);
    });

    it('THE REGRESSION: it accepts the decision at all', () => {
      // PR-5 bound the declaration on three cards and not this one, while four
      // of its five history tiles are paid-gated in `_build_tables`.
      render('unavailable');
      expect(el('tables-tracking-note')).not.toBeNull();
    });

    for (const kind of ['unavailable', 'unestablished', 'unusable']) {
      it(`THE REGRESSION (${kind}): the five paid-gated fields are withheld`, () => {
        render(kind);
        expect(el('tables-withheld-median')).not.toBeNull();
        expect(el('tables-withheld-turns')).not.toBeNull();
        expect(el('tables-withheld-avg-ticket')).not.toBeNull();
        // turns_yesterday / avg_ticket_yesterday reach the screen only through
        // the two trend indicators, which go with their figures.
        expect(text()).not.toContain('vs yesterday');
      });
    }

    it('OCCUPANCY IS NOT WITHHELD: it is live floor state, not a paid aggregate', () => {
      render('unavailable');
      expect(text()).toContain('4 / 10 tables occupied');
      expect(text()).toContain('Current occupancy');
    });

    it('CONTROL: a measuring server renders all five', () => {
      fixture.componentRef.setInput('measurement', { kind: 'supported' });
      fixture.componentRef.setInput('tablesData', {
        ...tables, median_visit_minutes: 42, turns_today: 2.4, turns_yesterday: 2,
        avg_ticket_today: 31000, avg_ticket_yesterday: 30000,
      } as TablesData);
      fixture.detectChanges();
      expect(el('tables-tracking-note')).toBeNull();
      expect(el('tables-withheld-median')).toBeNull();
      expect(text()).toContain('42m');
      expect(text()).toContain('2.4');
    });
  });
});
