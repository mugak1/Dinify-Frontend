import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

import { PaymentMethodsCardComponent } from './components/payment-methods-card/payment-methods-card.component';
import { RevenueCardComponent } from './components/revenue-card/revenue-card.component';
import { TotalOrdersCardComponent } from './components/total-orders-card/total-orders-card.component';
import { OrdersData, RevenueData } from './models/dashboard.models';
import { adaptDashboardResponse } from './services/dashboard-adapter';

/**
 * D07/PR-5 — A CARD MUST NOT REPORT AN ABSENCE OF MEASUREMENT AS A MEASUREMENT.
 *
 * "Payment Methods" sums `order_payment` transactions with status `success`. The
 * writer for those was deleted in the non-custodial teardown, so the list is
 * permanently empty for every restaurant and every window. The card said
 * "No settled payments in this period" and "Based on settled payments in the
 * selected period" — both of which an operator reads as a statement about their
 * own trade, when they are statements about this platform's instrumentation.
 *
 * The server now says which it is (`payment_tracking_enabled`), and these pin that
 * the client renders the distinction instead of the bare zero.
 *
 * IT GOVERNS THREE FIGURES, SO THERE ARE THREE CONSUMERS. The flag is a single
 * statement about instrumentation, and `dashboard-v2` publishes it beside every
 * card it makes untrue:
 *
 *   * `payments`            -> Payment Methods (below);
 *   * `revenue`             -> the Revenue card. `gross` and `discounts` are
 *     aggregated over `payment_status='paid'`, so both are zero in every bucket;
 *     `net = gross - discounts - refunds` is derived from them, and `refunds` is
 *     NOT paid-gated — so a window holding one reports a NEGATIVE net, in success
 *     green, as the Dashboard's headline figure;
 *   * `orders.breakdown`    -> Total Orders. `paid` is the same unwritten column
 *     and `open` is everything else that was not cancelled or refunded, so the
 *     split reads "nobody has paid" about a restaurant that traded all day.
 *
 * Disclosing one or two of the three would be the same defect with a smaller
 * blast radius, so all three are pinned here together.
 *
 * ABSENCE IS NOT `false`. An older backend does not send the key, and the card
 * keeps its original wording there rather than asserting an absence on that
 * server's behalf — the same rule the billing screen applies to
 * `in_app_collection_supported`. Controls below pin that direction, because the
 * easy over-correction is to show the caveat whenever the flag is falsy.
 */
describe('D07/PR-5 — payment-tracking disclosure', () => {

  describe('the adapter passes the server\'s answer through strictly', () => {
    it('THE REGRESSION: an explicit false survives to the model', () => {
      const d = adaptDashboardResponse({ payment_tracking_enabled: false });
      expect(d.payment_tracking_enabled).toBeFalse();
    });

    it('an explicit true survives too', () => {
      expect(
        adaptDashboardResponse({ payment_tracking_enabled: true })
          .payment_tracking_enabled,
      ).toBeTrue();
    });

    it('CONTROL: an older server that never said stays undefined, not false', () => {
      const d = adaptDashboardResponse({});
      expect(d.payment_tracking_enabled).toBeUndefined();
      expect(d.payment_tracking_enabled).not.toBeFalse();
    });

    it('a non-boolean is not coerced into an answer', () => {
      for (const v of ['false', 0, null, 'yes']) {
        expect(
          adaptDashboardResponse({ payment_tracking_enabled: v })
            .payment_tracking_enabled,
        ).toBeUndefined();
      }
    });
  });

  describe('the card renders the distinction', () => {
    function render(inputs: Partial<PaymentMethodsCardComponent>): string {
      TestBed.configureTestingModule({ imports: [PaymentMethodsCardComponent] });
      const fixture = TestBed.createComponent(PaymentMethodsCardComponent);
      Object.assign(fixture.componentInstance, inputs);
      fixture.componentInstance.ngOnChanges({ paymentMethods: {} as any });
      fixture.detectChanges();
      return (fixture.nativeElement as HTMLElement).textContent ?? '';
    }

    afterEach(() => TestBed.resetTestingModule());

    it('THE REGRESSION: an empty card no longer claims the period had no payments', () => {
      const text = render({ paymentMethods: [], paymentTrackingEnabled: false });
      expect(text).toContain("Dinify doesn't record settled payments");
      expect(text).not.toContain('No settled payments in this period');
    });

    it('a populated card says its figures are not a measurement', () => {
      const text = render({
        paymentMethods: [{ method: 'cash', amount: 5000, tx_count: 2 } as any],
        paymentTrackingEnabled: false,
      });
      expect(text).toContain("aren't a measurement of money received");
      expect(text).not.toContain('Based on settled payments in the selected period');
    });

    it('CONTROL: an older server keeps the original wording', () => {
      // `paymentTrackingEnabled` left undefined — the server said nothing.
      const text = render({ paymentMethods: [] });
      expect(text).toContain('No settled payments in this period');
      expect(text).not.toContain("Dinify doesn't record settled payments");
    });

    it('CONTROL: a server that DOES track keeps the original wording too', () => {
      const text = render({ paymentMethods: [], paymentTrackingEnabled: true });
      expect(text).toContain('No settled payments in this period');
      expect(text).not.toContain("Dinify doesn't record settled payments");
    });
  });

  describe('the predicate itself', () => {
    it('is true ONLY for an explicit false', () => {
      const c = new PaymentMethodsCardComponent();
      expect(c.trackingUnavailable).toBeFalse();          // undefined
      c.paymentTrackingEnabled = true;
      expect(c.trackingUnavailable).toBeFalse();
      c.paymentTrackingEnabled = false;
      expect(c.trackingUnavailable).toBeTrue();
    });
  });

  // ── The Revenue card — E5's principal claim ────────────────────────────────
  describe('the revenue card discloses the basis of its headline', () => {
    let fixture: ComponentFixture<RevenueCardComponent>;

    const revenue = (net: number): RevenueData => ({
      series: [],
      totals: { gross: 0, discounts: 0, refunds: net < 0 ? -net : 0, net },
    });

    /** `setInput` so `ngOnChanges` runs and the pills are actually built —
     *  assigning the field directly would leave them empty and prove nothing. */
    const render = (data: RevenueData, tracking?: boolean) => {
      fixture.componentRef.setInput('bucketUnit', 'day');
      fixture.componentRef.setInput('paymentTrackingEnabled', tracking);
      fixture.componentRef.setInput('revenueData', data);
      fixture.detectChanges();
    };

    const note = () =>
      (fixture.nativeElement as HTMLElement)
        .querySelector('[data-testid="revenue-tracking-note"]');

    const noteText = () => (note()?.textContent ?? '').replace(/\s+/g, ' ').trim();

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [RevenueCardComponent],
        providers: [provideRouter([]), provideCharts(withDefaultRegisterables())],
      }).compileComponents();
      fixture = TestBed.createComponent(RevenueCardComponent);
    });

    it('THE REGRESSION: it no longer presents unmeasured figures as takings', () => {
      render(revenue(0), false);
      expect(noteText()).toContain(
        "Dinify doesn't record settled payments, so Gross and Discounts — and "
        + 'the Net figure and chart derived from them — aren\'t a measurement of '
        + 'money taken.',
      );
    });

    it('THE REGRESSION: a below-zero net is explained, not left to be read as a loss', () => {
      render(revenue(-4500), false);
      expect(noteText()).toContain('That is why Net reads below zero here');
    });

    it('the below-zero clause is OBSERVED, not predicted', () => {
      // Same unmeasuring server, a window with no refund in it. The card says
      // what it can see; it does not forecast what the next window will send.
      render(revenue(0), false);
      expect(noteText()).not.toContain('below zero');
    });

    it('CONTROL: an older server that never said gets no note at all', () => {
      render(revenue(-4500), undefined);
      expect(note()).toBeNull();
    });

    it('CONTROL: a server that DOES measure payments gets no note', () => {
      render(revenue(120000), true);
      expect(note()).toBeNull();
    });

    it('CONTROL: a below-zero net from a MEASURING server is an ordinary fact', () => {
      // Refunds genuinely exceeded takings. That is the restaurant's week, not
      // our instrumentation, and it needs no sentence from us.
      render(revenue(-4500), true);
      expect(fixture.componentInstance.netIsNegative).toBeFalse();
      expect(note()).toBeNull();
    });

    it('CONTROL: it recomputes, suppresses and reprices nothing', () => {
      const data: RevenueData = {
        series: [],
        totals: { gross: 900000, discounts: 40000, refunds: 10000, net: 850000 },
      };
      render(data, false);
      // The server's own numbers, still rendered verbatim beside the statement.
      expect(fixture.componentInstance.pills.map((p) => p.formatted))
        .toEqual(['900,000', '40,000', '10,000', '850,000']);
      expect(data.totals).toEqual(
        { gross: 900000, discounts: 40000, refunds: 10000, net: 850000 },
      );
    });

    it('the second clause needs BOTH facts', () => {
      const c = fixture.componentInstance;

      render(revenue(-1), undefined);
      expect(c.netIsNegative).toBeFalse();                 // the server said nothing

      render(revenue(-1), false);
      expect(c.netIsNegative).toBeTrue();

      render(revenue(0), false);
      expect(c.netIsNegative).toBeFalse();                 // not below zero
    });
  });

  // ── Total Orders — the third governed figure ───────────────────────────────
  describe('the total-orders card discloses its paid/unpaid split', () => {
    let fixture: ComponentFixture<TotalOrdersCardComponent>;

    const orders: OrdersData = {
      series: [],
      total: 40,
      breakdown: { paid: 0, open: 37, cancelled: 2, refunded: 1 },
    };

    const render = (tracking?: boolean) => {
      fixture.componentRef.setInput('bucketUnit', 'day');
      fixture.componentRef.setInput('paymentTrackingEnabled', tracking);
      fixture.componentRef.setInput('ordersData', orders);
      fixture.detectChanges();
    };

    const note = () =>
      (fixture.nativeElement as HTMLElement)
        .querySelector('[data-testid="orders-tracking-note"]');

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [TotalOrdersCardComponent],
        providers: [provideCharts(withDefaultRegisterables())],
      }).compileComponents();
      fixture = TestBed.createComponent(TotalOrdersCardComponent);
    });

    it('THE REGRESSION: "Paid 0" no longer reads as a fact about the restaurant', () => {
      render(false);
      const text = (note()?.textContent ?? '').replace(/\s+/g, ' ').trim();
      expect(text).toContain(
        "Dinify doesn't record settled payments, so Paid and Open/Unpaid aren't "
        + 'a measurement of who has paid — every order that wasn\'t cancelled or '
        + 'refunded is counted as unpaid.',
      );
    });

    it('it names only the two segments that are not measured', () => {
      render(false);
      const el = note();
      expect(el).not.toBeNull();
      const text = (el!.textContent ?? '').replace(/\s+/g, ' ').trim();
      expect(text).toContain('Paid and Open/Unpaid');
      // Cancelled and Refunded sit on the ORDER-STATUS axis and are real
      // measurements, so the sentence must not sweep them into the caveat.
      expect(text).not.toContain('Cancelled');
      expect(text).not.toContain('Refunded');
    });

    it('it sits with the breakdown grid it describes, not at the foot of the card', () => {
      render(false);
      const html: string = (fixture.nativeElement as HTMLElement).innerHTML;
      // The first "Open/Unpaid" is the segment tile; the note follows it.
      expect(html.indexOf('Open/Unpaid'))
        .toBeLessThan(html.indexOf('orders-tracking-note'));
    });

    it('CONTROL: an older server that never said gets no note', () => {
      render(undefined);
      expect(note()).toBeNull();
    });

    it('CONTROL: a server that DOES measure payments gets no note', () => {
      render(true);
      expect(note()).toBeNull();
    });

    it('CONTROL: every count is still the server\'s own', () => {
      render(false);
      expect(fixture.componentInstance.segments.map((s) => s.count))
        .toEqual([0, 37, 2, 1]);
    });
  });
});
