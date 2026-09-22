import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { AuthenticationService } from 'src/app/_services/authentication.service';
import { BillingComponent } from './billing.component';
import { readBillingHistory, readSubscriptionDetails } from './billing.model';

/**
 * D07/B2 — THE SCREEN VALIDATES THE DATA IT ACTUALLY DISPLAYS.
 *
 * G2 gave the billing read five answers where it had two, and validated the
 * SHAPE of the projection: is `subscription_terms` an object, is `recorded` a
 * boolean, is there something under `current`. It never asked whether the
 * VALUES inside it were the ones the wire contract promises. So:
 *
 *   currency: ''                  -> rendered a price with no currency
 *   currency: 'ugx' / 'UGANDA'    -> rendered whatever arrived
 *   effective_from: 'not-a-date'  -> Angular's DatePipe THREW out of the
 *                                    template and took the whole section down
 *   effective_from naive          -> rendered in the DEVICE's zone, which for
 *                                    an EAT platform administered from London
 *                                    is a three-hour lie about when a price
 *                                    took effect
 *   recurring_amount '-150000.00' -> rendered `UGX -150,000.00`
 *   billing_interval count 2**40  -> rendered "every 1099511627776 months"
 *
 * And the history was worse, because it answered with a SENTENCE:
 *
 *   [null, 'junk']        -> [] -> historyState 'ready' -> "No subscription
 *                            transactions recorded." A claim about the
 *                            restaurant, manufactured out of rows this client
 *                            could not read.
 *   [valid, null]         -> one row, presented as the WHOLE history, with
 *                            nothing on screen saying a row was dropped.
 *
 * THE SMALLEST TRUTHFUL BEHAVIOUR is the one this takes: a row this client
 * cannot read makes the HISTORY unreadable — the state that already exists,
 * with the read-only retry it already has — rather than being silently dropped
 * or silently rendered. The terms and the history still fail INDEPENDENTLY, so
 * an unreadable history leaves a readable price on screen.
 *
 * NOTHING IS REPAIRED. No row is dropped, rewritten, backfilled or
 * reclassified, no tender or status is invented, no currency is defaulted, no
 * date is resolved against the device clock and no amount is rounded. A
 * legitimately NULL tender or status is an UNKNOWN and stays a readable row —
 * that is the D07 `stated()` rule, and widening the validation to reject it
 * would be the same defect pointed the other way.
 *
 * THIS FILE DOES NOT CLAIM THE PRODUCTION INTERCEPTOR CHAIN. It drives the real
 * component, the real template and the real reader over a real `HttpClient`;
 * the chain claim and its two discriminating controls live in
 * `billing-live-ownership.spec.ts`. The pure-parser assertions are in their own
 * clearly-labelled block at the bottom and prove nothing about rendering.
 *
 * BASELINE: 19 FAILED / 13 SUCCESS against the unmodified reader, the 13 being
 * exactly the specs labelled CONTROL — every distinction this file adds was
 * reachable, and four of the failures are the ones a screen SAYS rather than
 * merely renders. Four more specs fail on main without the CONTROL label,
 * because the behaviour they pin is unchanged while their PREMISE needs the fix.
 *
 * SEVEN RULES, SEVEN PINS — each reverted alone, with every other spec holding:
 *
 *   terms values back to type-only checks    ->  7
 *   the recurrence-count bound removed       ->  2
 *   history back to the silent row drop      ->  11
 *   the duplicate-identity check removed     ->  2
 *   the row timestamp check removed          ->  1
 *   the row amount check removed             ->  2
 *   the template's null-status dash reverted ->  1
 *
 * A SHIPPED ORACLE IS CORRECTED, not relaxed:
 * `billing-read-states.spec.ts::'one unreadable row does not withhold the rest'`
 * asserted the silent drop. It is replaced there by the rule this file pins,
 * with its own control for a genuinely empty list.
 */
describe('D07/B2 — the billing screen validates what it displays', () => {
  let component: BillingComponent;
  let fixture: ComponentFixture<BillingComponent>;
  let http: HttpTestingController;

  const authStub: any = {
    currentRestaurantRole: { restaurant_id: 'rest-1' },
    currentRestaurant: { id: 'rest-1' },
    userValue: { profile: { id: 'user-1' } },
  };

  /** The canonical row, exactly as `commercial_reads.commercial_summary` emits it. */
  const TERMS = {
    recurring_amount: '150000.00',
    currency: 'UGX',
    billing_interval: { unit: 'month', count: 1 },
    effective_from: '2026-07-01T00:00:00+03:00',
  };

  /** One row, exactly as `SerializerGetRestaurantTransactionListing` emits it. */
  const ROW = {
    id: 'txn-1',
    transaction_type: 'subscription',
    transaction_status: 'pending',
    order_number: null,
    amount: 150000.0,
    payment_mode: 'momo',
    transaction_platform: 'web',
    time_created: '2026-07-01T09:15:00+03:00',
  };

  beforeEach(async () => {
    authStub.currentRestaurantRole = { restaurant_id: 'rest-1' };
    authStub.currentRestaurant = { id: 'rest-1' };
    authStub.userValue = { profile: { id: 'user-1' } };

    await TestBed.configureTestingModule({
      declarations: [BillingComponent],
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthenticationService, useValue: authStub },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(BillingComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const text = () => (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');
  const el = (id: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);
  const rows = () =>
    (fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr');

  /** Answer both reads and settle the VIEW — every assertion below reads the DOM. */
  function start(terms: any, history: any = []): void {
    fixture.detectChanges();
    http
      .expectOne((r) => r.url.includes('restaurant-setup/subscription-details/'))
      .flush({
        status: 200,
        data: { in_app_collection_supported: false, subscription_terms: terms },
      });
    http
      .expectOne((r) => r.url.includes('reports/restaurant/transactions-listing/'))
      .flush({ status: 200, data: history });
    fixture.detectChanges();
  }

  /** One open terms row with `patch` applied over the canonical one. */
  const recorded = (patch: any) => ({ recorded: true, current: { ...TERMS, ...patch } });

  // ── the recorded terms ────────────────────────────────────────────────────

  describe('a terms row is displayed only when every field it renders is readable', () => {
    it('THE REGRESSION: a blank currency does not render a price with no currency', () => {
      start(recorded({ currency: '' }));

      expect(component.hasCurrentTerms).toBe(false);
      expect(el('terms-amount')).toBeNull();
      expect(el('terms-unreadable')).not.toBeNull();
      // And the one thing it must NEVER do: pick a currency.
      expect(text()).not.toContain('150,000.00');
    });

    it('THE REGRESSION: a currency that is not an ISO-4217 code is refused', () => {
      // The backend column is CharField(3), DB-constrained to three uppercase
      // ASCII letters. The wider vocabulary sweep is in the PURE block below;
      // this is the one that proves the screen withholds rather than renders.
      start(recorded({ currency: 'ugx' }));

      expect(component.hasCurrentTerms).toBe(false);
      expect(text()).not.toContain('ugx');
      expect(el('terms-unreadable')).not.toBeNull();
    });

    it('THE REGRESSION: an unparseable effective date does not take the section down', () => {
      // On the unmodified reader Angular's DatePipe raises
      // `Unable to convert "not-a-date" into a date` out of the template, which
      // kills the whole billing screen rather than one field.
      expect(() => start(recorded({ effective_from: 'not-a-date' }))).not.toThrow();

      expect(component.hasCurrentTerms).toBe(false);
      expect(el('terms-unreadable')).not.toBeNull();
    });

    it('THE REGRESSION: an impossible calendar date is refused', () => {
      // `Date.parse` is LENIENT here — it reads 30 February as 2 March and
      // returns a perfectly good number — so this is the case that only an
      // explicit calendar-range check catches.
      expect(() => start(recorded({ effective_from: '2026-02-30T00:00:00+03:00' })))
        .not.toThrow();
      expect(component.hasCurrentTerms).toBe(false);
      expect(el('terms-unreadable')).not.toBeNull();
    });

    it('THE REGRESSION: a NAIVE effective date is refused, not resolved against the device clock', () => {
      // The backend's own `AwareDateTimeField` refuses a naive value on the way
      // IN for exactly this reason: midnight EAT and midnight UTC are three
      // hours apart, and this field decides which terms were in force.
      start(recorded({ effective_from: '2026-07-01T00:00:00' }));

      expect(component.hasCurrentTerms).toBe(false);
      expect(el('terms-unreadable')).not.toBeNull();
    });

    it('THE REGRESSION: a negative recurring amount is refused', () => {
      start(recorded({ recurring_amount: '-150000.00' }));

      expect(component.hasCurrentTerms).toBe(false);
      expect(text()).not.toContain('-150,000.00');
      expect(el('terms-unreadable')).not.toBeNull();
    });

    it('THE REGRESSION: a recurrence count beyond the wire bound is refused', () => {
      // `billing_interval_count` is a 32-bit PostgreSQL integer and the backend
      // writer caps it at 2^31-1. Anything past that never came from this wire.
      start(recorded({ billing_interval: { unit: 'month', count: 2 ** 40 } }));

      expect(component.hasCurrentTerms).toBe(false);
      expect(el('terms-unreadable')).not.toBeNull();
    });

    it('CONTROL: the canonical row still renders in full', () => {
      start(recorded({}));

      expect(component.hasCurrentTerms).toBe(true);
      expect(el('terms-amount')!.textContent).toContain('UGX 150,000.00');
      expect(el('terms-amount')!.textContent).toContain('every month');
      expect(el('terms-unreadable')).toBeNull();
    });

    it('CONTROL: an explicit 0.00 is a RECORDED PRICE, never free and never absent', () => {
      start(recorded({ recurring_amount: '0.00' }));

      expect(component.hasCurrentTerms).toBe(true);
      expect(el('terms-amount')!.textContent).toContain('UGX 0.00');
      expect(el('terms-absent')).toBeNull();
      expect(text().toLowerCase()).not.toContain('free');
      expect(text().toLowerCase()).not.toContain('trial');
    });

    it('CONTROL: a UTC `Z` offset is accepted', () => {
      start(recorded({ effective_from: '2026-07-01T00:00:00Z' }));
      expect(component.hasCurrentTerms).toBe(true);
    });

    it('CONTROL: the microsecond form DRF actually emits is accepted', () => {
      start(recorded({ effective_from: '2026-07-01T00:00:00.123456+03:00' }));
      expect(component.hasCurrentTerms).toBe(true);
    });

    it('CONTROL: a multi-period recurrence still renders its own words', () => {
      start(recorded({ billing_interval: { unit: 'month', count: 2 } }));
      expect(el('terms-amount')!.textContent).toContain('every 2 months');
    });

    it('CONTROL: the four G2 answers are unchanged', () => {
      start({ recorded: false, current: null });
      expect(el('terms-absent')).not.toBeNull();
      expect(el('terms-unreadable')).toBeNull();
    });

    it('CONTROL: a server that never mentioned terms is still `unstated`', () => {
      fixture.detectChanges();
      http
        .expectOne((r) => r.url.includes('restaurant-setup/subscription-details/'))
        .flush({ status: 200, data: { in_app_collection_supported: false } });
      http
        .expectOne((r) => r.url.includes('reports/restaurant/transactions-listing/'))
        .flush({ status: 200, data: [] });
      fixture.detectChanges();

      expect(el('terms-unstated')).not.toBeNull();
      expect(el('terms-absent')).toBeNull();
    });
  });

  // ── the billing history ───────────────────────────────────────────────────

  describe('an unreadable history says so instead of claiming one', () => {
    it('THE REGRESSION: rows this client cannot read are NOT "no transactions recorded"', () => {
      start(recorded({}), [null, 'junk']);

      expect(el('history-empty')).toBeNull();
      expect(text()).not.toContain('No subscription transactions recorded');
      expect(el('history-failed')).not.toBeNull();
      expect(component.historyState).toBe('failed');
    });

    it('THE REGRESSION: a partial history is not presented as the whole one', () => {
      start(recorded({}), [ROW, null]);

      expect(rows().length).toBe(0);
      expect(el('history-failed')).not.toBeNull();
    });

    it('THE REGRESSION: an unparseable row timestamp does not take the section down', () => {
      expect(() => start(recorded({}), [{ ...ROW, time_created: 'whenever' }]))
        .not.toThrow();
      expect(el('history-failed')).not.toBeNull();
    });

    it('THE REGRESSION: duplicate row identities do not reach the template', () => {
      // `@for (t of transaction_list; track t.id)` raises NG0955 on a duplicate
      // key, which is the section dying rather than a row rendering twice.
      expect(() => start(recorded({}), [ROW, { ...ROW }])).not.toThrow();
      expect(el('history-failed')).not.toBeNull();
    });

    it('THE REGRESSION: an amount that arrived and cannot be read is not rendered as an absent one', () => {
      // `transactionAmount` answers `—` for BOTH, so a figure this client could
      // not parse was indistinguishable from a row that carries no amount.
      start(recorded({}), [{ ...ROW, amount: '1,500.00' }]);

      expect(el('history-failed')).not.toBeNull();
      expect(rows().length).toBe(0);
    });

    it('THE REGRESSION: a row identity the template cannot track is refused', () => {
      start(recorded({}), [{ ...ROW, id: { nested: true } }]);
      expect(el('history-failed')).not.toBeNull();
    });

    it('CONTROL: a canonical row still renders, with its amount formatted exactly', () => {
      start(recorded({}), [ROW]);

      expect(component.historyState).toBe('ready');
      expect(rows().length).toBe(1);
      expect(text()).toContain('UGX 150,000.00');
      expect(el('history-failed')).toBeNull();
    });

    it('CONTROL: a legitimately NULL tender stays a readable row and is not invented', () => {
      start(recorded({}), [{ ...ROW, payment_mode: null }]);

      expect(component.historyState).toBe('ready');
      expect(rows().length).toBe(1);
      const cells = rows()[0].querySelectorAll('td');
      expect(cells[2].textContent!.trim()).toBe('—');
      expect(text().toLowerCase()).not.toContain('cash');
    });

    it('THE REGRESSION: a legitimately NULL status is shown as unknown, not blank and not invented', () => {
      start(recorded({}), [{ ...ROW, transaction_status: null }]);

      expect(component.historyState).toBe('ready');
      const cells = rows()[0].querySelectorAll('td');
      expect(cells[4].textContent!.trim()).toBe('—');
      expect(text().toLowerCase()).not.toContain('success');
    });

    it('CONTROL: the documented legacy nullables do not fail the read', () => {
      start(recorded({}), [
        { ...ROW, order_number: null, transaction_platform: null, amount: null },
      ]);

      expect(component.historyState).toBe('ready');
      expect(rows().length).toBe(1);
    });

    it('CONTROL: a genuinely empty list still says so', () => {
      start(recorded({}), []);

      expect(el('history-empty')).not.toBeNull();
      expect(el('history-failed')).toBeNull();
    });

    // NOT labelled CONTROL: the BEHAVIOUR is unchanged, but the premise (a
    // `[null]` page being unreadable at all) needs the fix, so it fails on the
    // unmodified reader like the regressions do.
    it('the sections still fail independently — an unreadable history leaves the price', () => {
      start(recorded({}), [null]);

      expect(el('terms-amount')!.textContent).toContain('UGX 150,000.00');
      expect(component.loadState).toBe('ready');
      expect(el('history-failed')).not.toBeNull();
    });

    // NOT labelled CONTROL, for the same reason as the spec above it.
    it('the read-only retry still re-runs BOTH reads after an unreadable history', () => {
      start(recorded({}), [null]);
      expect(el('history-failed')).not.toBeNull();

      component.reload();
      http
        .expectOne((r) => r.url.includes('restaurant-setup/subscription-details/'))
        .flush({ status: 200, data: { subscription_terms: recorded({}) } });
      http
        .expectOne((r) => r.url.includes('reports/restaurant/transactions-listing/'))
        .flush({ status: 200, data: [ROW] });
      fixture.detectChanges();

      expect(component.historyState).toBe('ready');
      expect(rows().length).toBe(1);
    });
  });

  // ── PURE PARSER — no component, no template, no rendering claim ────────────

  describe('PURE: the reader in isolation', () => {
    const termsKind = (current: any) =>
      readSubscriptionDetails({ subscription_terms: { recorded: true, current } })!.terms.kind;

    it('refuses every field the wire contract constrains', () => {
      expect(termsKind(TERMS)).toBe('current');
      expect(termsKind({ ...TERMS, currency: '' })).toBe('unreadable');
      expect(termsKind({ ...TERMS, currency: 'ugx' })).toBe('unreadable');
      expect(termsKind({ ...TERMS, effective_from: 'not-a-date' })).toBe('unreadable');
      expect(termsKind({ ...TERMS, effective_from: '2026-07-01T00:00:00' })).toBe('unreadable');
      expect(termsKind({ ...TERMS, recurring_amount: '-1.00' })).toBe('unreadable');
      expect(termsKind({ ...TERMS, recurring_amount: '150000.005' })).toBe('unreadable');
      expect(termsKind({ ...TERMS, recurring_amount: 150000 })).toBe('unreadable');
      expect(termsKind({ ...TERMS, billing_interval: { unit: 'month', count: 0 } }))
        .toBe('unreadable');
      expect(termsKind({ ...TERMS, billing_interval: { unit: 'fortnight', count: 1 } }))
        .toBe('unreadable');
      expect(termsKind({ ...TERMS, billing_interval: { unit: 'month', count: 2 ** 40 } }))
        .toBe('unreadable');
    });

    it('CONTROL: a valid `current` beside `recorded: false` is STILL the contradiction', () => {
      const read = readSubscriptionDetails({
        subscription_terms: { recorded: false, current: TERMS },
      })!;
      expect(read.terms.kind).toBe('unreadable');
      expect((read.terms as any).reason).toBe('contradictory');
    });

    it('any unreadable row makes the whole history unreadable', () => {
      expect(readBillingHistory([])).toEqual([]);
      expect(readBillingHistory([ROW])).toEqual([ROW]);
      expect(readBillingHistory([ROW, 'junk'])).toBeNull();
      expect(readBillingHistory([null])).toBeNull();
      expect(readBillingHistory([ROW, { ...ROW }])).toBeNull();
      expect(readBillingHistory([{ ...ROW, amount: 'x' }])).toBeNull();
      expect(readBillingHistory([{ ...ROW, transaction_status: 7 }])).toBeNull();
    });

    it('CONTROL: a non-array is still unreadable and an empty array is still empty', () => {
      expect(readBillingHistory({ not: 'an array' })).toBeNull();
      expect(readBillingHistory(null)).toBeNull();
      expect(readBillingHistory([])).toEqual([]);
    });

    it('THE REGRESSION: the parser REPAIRS nothing — a readable page is returned verbatim', () => {
      const page = [ROW, { ...ROW, id: 'txn-2', payment_mode: null }];
      expect(readBillingHistory(page)).toBe(page as unknown[]);
    });
  });
});
