import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PaymentMethodsCardComponent } from './payment-methods-card/payment-methods-card.component';
import { PopularItemsCardComponent } from './popular-items-card/popular-items-card.component';
import { getMockPaymentMethods, getMockPopularItems } from '../data/dashboard-mock-data';

/**
 * The invariant: on a window with no trade, both cards say so — they do not render
 * structure with zeros in it.
 *
 * Until DASH-MOCK-COHERENCE-00 neither branch was reachable in mock mode. Payments
 * multiplied fixed constants by a calendar-day count and popular items took no arguments,
 * so both cards reported takings for a day with no orders. The empty states existed but
 * nothing in the running app could produce one, and neither card had any spec at all.
 *
 * These specs feed the cards the REAL generator output rather than hand-written zeros, so
 * they pin the generator → card contract end to end: if a future generator goes back to
 * synthesising its own figures, the empty state stops rendering and this fails.
 */

const RID = 'r1';
/**
 * A window with no trade. MOCK-NO-CLOSURES-00 switched closures off (CLOSED_WEEKDAY = null)
 * so every calendar day trades, which leaves an INVERTED range as the only input for which
 * the basis yields no rows — `dailyRevenue` returns [] for one by contract. Restore
 * CLOSED_WEEKDAY to a weekday index and a single closed date works here again. Feeding the
 * generators rather than hand-writing an empty array is the point: it is the generator → card
 * contract under test, not the cards alone.
 */
const NO_TRADE_FROM = '2026-06-02';
const NO_TRADE_TO = '2026-06-01';
const TRADING = '2026-06-02';

describe('dashboard cards — a window with no trade', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PaymentMethodsCardComponent, PopularItemsCardComponent],
      // popular-items links out to /reports with a routerLink.
      providers: [provideRouter([])],
    }).compileComponents();
  });

  describe('payment-methods-card', () => {
    let fixture: ComponentFixture<PaymentMethodsCardComponent>;

    function render(from: string, to: string): HTMLElement {
      fixture = TestBed.createComponent(PaymentMethodsCardComponent);
      fixture.componentRef.setInput('paymentMethods', getMockPaymentMethods(RID, from, to));
      fixture.componentRef.setInput('loading', false);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    it('says nothing settled, rather than showing a zero-width split', () => {
      const host = render(NO_TRADE_FROM, NO_TRADE_TO);

      expect(host.textContent).toContain('No settled payments in this period');
      expect(host.textContent).not.toContain('Total settled');
      // The empty branch short-circuits before any bar is built, so there is no
      // zero-width, full-width or NaN-width bar to get wrong.
      expect(host.querySelectorAll('[style*="width"]').length).toBe(0);
    });

    it('computes no percentage it cannot state — no NaN anywhere', () => {
      const host = render(NO_TRADE_FROM, NO_TRADE_TO);
      expect(host.textContent).not.toContain('NaN');
      expect(fixture.componentInstance.total).toBe(0);

      // The rows ARE built — `buildRows` only bails on an empty array, and three
      // zero-amount methods is not that. What keeps them off screen is the template's
      // `total === 0` branch. The percentages come back 0 rather than NaN because
      // `getBalancedPercentages` returns before dividing, so even if that branch were
      // ever removed the card would degrade to zeros, not to garbage.
      expect(fixture.componentInstance.rows.map((r) => r.percentage)).toEqual([0, 0, 0]);
      expect(fixture.componentInstance.rows.every((r) => r.amount === 0)).toBeTrue();
    });

    it('still renders the ordinary split on a trading day', () => {
      const host = render(TRADING, TRADING);

      expect(host.textContent).toContain('Total settled');
      expect(host.textContent).not.toContain('No settled payments in this period');
      expect(host.textContent).not.toContain('NaN');
      // 50 / 33 / 17 — the proportions this card has always shown.
      expect(fixture.componentInstance.rows.map((r) => r.percentage)).toEqual([50, 33, 17]);

      // The per-method figure is rendered by `app-animated-number`, which counts up from
      // a literal '0' once an IntersectionObserver or its 1s fallback fires — neither
      // happens in a synchronous detectChanges, so the DOM reads '0' here regardless of
      // the data. Assert the value it animates TOWARD instead, or this card's figures
      // would be untested.
      const { rows, total } = fixture.componentInstance;
      expect(rows.every((r) => r.amount > 0)).toBeTrue();
      expect(rows.every((r) => /\d/.test(r.compactAmount))).toBeTrue();
      expect(rows.reduce((a, r) => a + r.amount, 0)).toBe(total);
    });
  });

  describe('popular-items-card', () => {
    let fixture: ComponentFixture<PopularItemsCardComponent>;

    function render(from: string, to: string): HTMLElement {
      fixture = TestBed.createComponent(PopularItemsCardComponent);
      fixture.componentRef.setInput('items', getMockPopularItems(RID, from, to));
      fixture.componentRef.setInput('loading', false);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    it('renders the empty state, not a ranking table of 0 and 0.0%', () => {
      const host = render(NO_TRADE_FROM, NO_TRADE_TO);

      expect(host.textContent).toContain('No item data available');
      expect(host.querySelector('table')).toBeNull();
      expect(host.textContent).not.toContain('0.0%');
      expect(host.textContent).not.toContain('NaN');
    });

    it('divides by no zero total — the denominator is never reached', () => {
      render(NO_TRADE_FROM, NO_TRADE_TO);
      expect(fixture.componentInstance.displayItems).toEqual([]);
      expect(fixture.componentInstance.totalValue).toBe(0);
    });

    it('still ranks five items on a trading day', () => {
      const host = render(TRADING, TRADING);

      expect(host.querySelector('table')).not.toBeNull();
      expect(host.textContent).not.toContain('No item data available');
      expect(host.textContent).not.toContain('NaN');
      expect(fixture.componentInstance.displayItems.length).toBe(5);

      // Percentages still sum to ~100 and none is 0.0 — the scale is real, not a stub.
      const pcts = fixture.componentInstance.displayItems.map((i) =>
        Number(fixture.componentInstance.getPercentage(i)),
      );
      expect(pcts.reduce((a, p) => a + p, 0)).toBeCloseTo(100, 0);
      for (const p of pcts) expect(p).toBeGreaterThan(0);
    });
  });
});
