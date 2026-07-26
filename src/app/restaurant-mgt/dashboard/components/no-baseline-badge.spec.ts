import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

import { RevenueCardComponent } from './revenue-card/revenue-card.component';
import { TotalOrdersCardComponent } from './total-orders-card/total-orders-card.component';
import { TrendIndicatorComponent } from './trend-indicator/trend-indicator.component';
import { OrdersData, RevenueData, RevenueTotals } from '../models/dashboard.models';
import { ReportDateRange } from '../../../_shared/timeframe';

/**
 * The invariant: a trend badge never asserts a percentage it cannot compute. When the
 * baseline is unusable the badge is replaced by the neutral "New" chip — and, on the two
 * headline cards, the comparison caption SURVIVES so the operator still learns what was
 * compared against. That caption used to live inside the badge, so gating the badge would
 * have taken it with it; these specs are what stop it drifting back in.
 */

const NO_BASELINE = '[aria-label="No prior period to compare"]';

/** 14–20 Jul 2026 — a closed 7-day window, so the compared period is 7–13 Jul. */
const range: ReportDateRange = { preset: 'custom', from: '2026-07-14', to: '2026-07-20' };

const totals = (net: number): RevenueTotals => ({ gross: net, net, discounts: 0, refunds: 0 });

const revenue = (net: number, prevNet: number): RevenueData => ({
  series: [],
  totals: totals(net),
  previous_totals: totals(prevNet),
});

const orders = (total: number, previous_total: number): OrdersData => ({
  series: [],
  breakdown: { paid: total, open: 0, cancelled: 0, refunded: 0 },
  total,
  previous_total,
});

describe('dashboard trend badges — no-baseline handling', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RevenueCardComponent, TotalOrdersCardComponent, TrendIndicatorComponent],
      // revenue-card links out to /reports, so it needs a router; both cards draw charts.
      providers: [provideRouter([]), provideCharts(withDefaultRegisterables())],
    }).compileComponents();
  });

  describe('revenue-card', () => {
    let fixture: ComponentFixture<RevenueCardComponent>;
    let host: HTMLElement;

    function render(net: number, prevNet: number): void {
      fixture = TestBed.createComponent(RevenueCardComponent);
      fixture.componentRef.setInput('revenueData', revenue(net, prevNet));
      fixture.componentRef.setInput('range', range);
      fixture.detectChanges();
      host = fixture.nativeElement as HTMLElement;
    }

    it('renders the ordinary badge when the baseline is usable', () => {
      render(1_350_000, 1_200_000);
      expect(host.querySelector(NO_BASELINE)).toBeNull();
      expect(host.textContent).toContain('12.5%');
    });

    it('replaces the badge with the New chip on a zero baseline', () => {
      render(2_000_000, 0);
      expect(host.querySelector(NO_BASELINE)).withContext('New chip should render').toBeTruthy();
      // Asserted on the contract rather than the card's text, because unrelated parts of
      // these cards legitimately render "0.0%" of their own.
      expect(fixture.componentInstance.hasBaseline).toBeFalse();
      expect(fixture.componentInstance.absPercentage).toBe('');
    });

    it('keeps the comparison caption in BOTH states', () => {
      render(1_350_000, 1_200_000);
      expect(host.textContent).toContain('vs. UGX 1.2M');

      render(2_000_000, 0);
      expect(host.textContent)
        .withContext('caption must survive the badge being suppressed')
        .toContain('vs. UGX 0');
    });

    // With the badge gone the caption is the ONLY signal left, so the sign has to survive
    // in it. `formatCompact` renders it correctly today; this pins that against a future
    // tidy-up, on a path that only became reachable when negatives started suppressing.
    it('keeps the sign on a negative baseline caption', () => {
      render(0, -100_000);
      expect(host.querySelector(NO_BASELINE)).toBeTruthy();
      expect(host.textContent).toContain('UGX -100K');
    });
  });

  describe('total-orders-card', () => {
    let fixture: ComponentFixture<TotalOrdersCardComponent>;
    let host: HTMLElement;

    function render(total: number, previous: number): void {
      fixture = TestBed.createComponent(TotalOrdersCardComponent);
      fixture.componentRef.setInput('ordersData', orders(total, previous));
      fixture.componentRef.setInput('range', range);
      fixture.detectChanges();
      host = fixture.nativeElement as HTMLElement;
    }

    it('renders the ordinary badge when the baseline is usable', () => {
      render(135, 120);
      expect(host.querySelector(NO_BASELINE)).toBeNull();
      expect(host.textContent).toContain('12.5%');
    });

    it('replaces the badge with the New chip on a zero baseline', () => {
      render(340, 0);
      expect(host.querySelector(NO_BASELINE)).toBeTruthy();
      // The status-breakdown grid below renders its own "0.0%" cells, so this asserts the
      // contract rather than searching the card's text.
      expect(fixture.componentInstance.hasBaseline).toBeFalse();
      expect(fixture.componentInstance.absPercentage).toBe('');
    });

    it('keeps the comparison caption in BOTH states', () => {
      render(135, 120);
      expect(host.textContent).toContain('vs. 120 orders');

      render(340, 0);
      expect(host.textContent)
        .withContext('caption must survive the badge being suppressed')
        .toContain('vs. 0 orders');
    });
  });

  describe('trend-indicator', () => {
    let fixture: ComponentFixture<TrendIndicatorComponent>;
    let host: HTMLElement;

    function render(current: number, previous: number): void {
      fixture = TestBed.createComponent(TrendIndicatorComponent);
      fixture.componentRef.setInput('current', current);
      fixture.componentRef.setInput('previous', previous);
      fixture.detectChanges();
      host = fixture.nativeElement as HTMLElement;
    }

    it('renders the ordinary pill when the baseline is usable', () => {
      render(2.25, 2.0);
      expect(host.querySelector(NO_BASELINE)).toBeNull();
      expect(host.textContent).toContain('12.5%');
    });

    // It already suppressed the pill here; what changed is that the blank space it left
    // is now the New chip, so a Monday after a closed Sunday explains itself.
    it('shows the New chip on a zero baseline where it used to render nothing', () => {
      render(2.25, 0);
      expect(host.querySelector(NO_BASELINE)).toBeTruthy();
    });

    it('shows the New chip on a negative baseline', () => {
      render(0, -500);
      expect(host.querySelector(NO_BASELINE)).toBeTruthy();
    });
  });
});
