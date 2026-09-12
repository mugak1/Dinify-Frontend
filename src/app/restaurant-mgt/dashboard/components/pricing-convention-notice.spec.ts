import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

import { RevenueCardComponent } from './revenue-card/revenue-card.component';
import { PricingConventions, RevenueData } from '../models/dashboard.models';
import { ReportDateRange } from '../../../_shared/timeframe';

/**
 * R4 — the Revenue card SHOWS the server's mixed-pricing-convention notice.
 *
 * The backend has published `revenue.pricing_conventions` since D02/C; the
 * frontend passed `revenue` straight into this card, rendered gross, discounts,
 * net and the chart from it, and never consumed the notice. So the one place an
 * operator reads those figures was also the one place the disclosure about them
 * did not appear.
 *
 * THE NOTICE IS ABOUT COMPARABILITY, NOT CORRECTNESS. No total changes, no
 * order is repriced or excluded, and nothing here says the money is wrong.
 */
const range: ReportDateRange = { preset: 'custom', from: '2026-07-14', to: '2026-07-20' };
const NOTICE =
  'This period contains orders priced under two different conventions. '
  + 'The amount each diner actually paid is unaffected.';

const revenue = (conventions?: PricingConventions): RevenueData => ({
  series: [],
  totals: { gross: 1000000, net: 850000, discounts: 100000, refunds: 50000 },
  ...(conventions ? { pricing_conventions: conventions } : {}),
});

describe('revenue card — mixed pricing convention notice', () => {
  let fixture: ComponentFixture<RevenueCardComponent>;
  let card: RevenueCardComponent;

  const noticeEl = () =>
    fixture.nativeElement.querySelector('[role="note"]') as HTMLElement | null;

  /** `setInput` so Angular runs `ngOnChanges` — assigning the field directly
   *  leaves the pills and the chart unbuilt and would prove nothing. */
  const render = (data: RevenueData) => {
    fixture.componentRef.setInput('range', range);
    fixture.componentRef.setInput('bucketUnit', 'day');
    fixture.componentRef.setInput('revenueData', data);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RevenueCardComponent],
      providers: [provideRouter([]), provideCharts(withDefaultRegisterables())],
    }).compileComponents();
    fixture = TestBed.createComponent(RevenueCardComponent);
    card = fixture.componentInstance;
  });

  it('shows the notice the SERVER issued for a mixed window', () => {
    render(revenue({
      mixed: true, legacy_orders: 4, corrected_orders: 9, notice: NOTICE,
    }));
    expect(card.pricingNotice).toBe(NOTICE);
    expect(noticeEl()?.textContent).toContain('two different conventions');
  });

  it('renders it beside the figures it is about', () => {
    render(revenue({
      mixed: true, legacy_orders: 4, corrected_orders: 9, notice: NOTICE,
    }));
    // The pills carry Gross and Discounts — the two figures D02 changed the
    // meaning of — and the notice sits with them, not at the foot of the card.
    const html: string = fixture.nativeElement.innerHTML;
    expect(html.indexOf('Discounts')).toBeLessThan(html.indexOf('role="note"'));
  });

  it('changes no figure the card displays', () => {
    render(revenue());
    const withoutNotice = card.pills.map((p) => `${p.label}=${p.formatted}`);

    render(revenue({
      mixed: true, legacy_orders: 4, corrected_orders: 9, notice: NOTICE,
    }));
    // Byte-identical pills: the disclosure adds a sentence, never a repricing.
    expect(card.pills.map((p) => `${p.label}=${p.formatted}`))
      .toEqual(withoutNotice);
    expect(card.revenueData!.totals.net).toBe(850000);
  });

  it('shows nothing for a LEGACY-only window', () => {
    render(revenue({
      mixed: false, legacy_orders: 12, corrected_orders: 0, notice: null,
    }));
    expect(card.pricingNotice).toBeNull();
    expect(noticeEl()).toBeNull();
  });

  it('shows nothing for a CORRECTED-only window', () => {
    render(revenue({
      mixed: false, legacy_orders: 0, corrected_orders: 12, notice: null,
    }));
    expect(card.pricingNotice).toBeNull();
    expect(noticeEl()).toBeNull();
  });

  it('shows nothing, and does not break, for a response that predates the field', () => {
    render(revenue());
    expect(card.pricingNotice).toBeNull();
    expect(noticeEl()).toBeNull();
    // The card still renders normally: absence is not an error state, and it is
    // not evidence of a uniform convention either — the server simply did not say.
    expect(card.pills.length).toBe(4);
  });

  it('never invents a sentence the server did not send', () => {
    render(revenue({
      mixed: true, legacy_orders: 4, corrected_orders: 9, notice: null,
    }));
    expect(card.pricingNotice).toBeNull();
    expect(noticeEl()).toBeNull();
  });

  it('REMOVES a stale notice when the period changes', () => {
    render(revenue({
      mixed: true, legacy_orders: 4, corrected_orders: 9, notice: NOTICE,
    }));
    expect(noticeEl()).not.toBeNull();

    // A different window, entirely on one side of the boundary.
    fixture.componentRef.setInput(
      'range', { preset: 'custom', from: '2026-08-01', to: '2026-08-07' });
    render(revenue({
      mixed: false, legacy_orders: 0, corrected_orders: 31, notice: null,
    }));
    expect(card.pricingNotice).toBeNull();
    expect(noticeEl()).toBeNull();
  });

  it('drops the notice when the new period carries no conventions at all', () => {
    render(revenue({
      mixed: true, legacy_orders: 4, corrected_orders: 9, notice: NOTICE,
    }));
    render(revenue());
    expect(noticeEl()).toBeNull();
  });
});
