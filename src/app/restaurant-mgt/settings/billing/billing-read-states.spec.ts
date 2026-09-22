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
 * D07/G2 — THE BILLING SCREEN SAYS WHICH ANSWER IT GOT.
 *
 * This does NOT reopen a payment UI. `PayNow`, `Save`, `sendOtp` and
 * `InitPayment` stay removed, and a control-set sweep in
 * `billing.component.spec.ts` keeps them out. What changed is the READING: the
 * screen had two states where the wire has five, and the three it could not
 * express all rendered as one of the two it could.
 *
 * EVERY SPEC BELOW MARKED "THE REGRESSION" FAILED AGAINST UNMODIFIED `cabb672`.
 * The whole probe ran 8/8 FAILED, one of them by throwing
 * `newCollection[Symbol.iterator] is not a function` out of the template.
 *
 * The distinctions, and why each one is a different sentence:
 *
 *   TERMS
 *     current      readable open terms.
 *     none         the server said there are none OPEN. An answer, not a
 *                  failure — and not "none ever existed", because the selector
 *                  is `ended_at IS NULL` and an ENDED-only history answers the
 *                  same way.
 *     unstated     an older server that never mentioned the projection. It got
 *                  NOTHING before: a heading above blank space.
 *     unreadable   present and untrustworthy — including the shape that most
 *                  needed it, `recorded: false` beside a VALID `current`,
 *                  which used to render as absence and would hide a price the
 *                  restaurant is being charged.
 *     (failure)    the request failed, was denied, or the device is offline.
 *                  Never "Not configured".
 *
 *   CAPABILITY     the same four, and a malformed value used to be dropped in
 *                  the reader — so a broken contract silently removed the note
 *                  and the page looked like a build that had grown a collector.
 *
 *   OWNERSHIP      principal + restaurant + generation, captured BEFORE each
 *                  request. Without it a stale answer repainted a different
 *                  restaurant's price (measured), and an older failure could
 *                  overwrite a newer success.
 */
describe('D07/G2 — billing read states', () => {
  let component: BillingComponent;
  let fixture: ComponentFixture<BillingComponent>;
  let http: HttpTestingController;

  const authStub: any = {
    currentRestaurantRole: { restaurant_id: 'rest-1' },
    currentRestaurant: { id: 'rest-1' },
    userValue: { profile: { id: 'user-1' } },
  };

  const TERMS = {
    recurring_amount: '150000.00',
    currency: 'UGX',
    billing_interval: { unit: 'month', count: 1 },
    effective_from: '2026-07-01T00:00:00+03:00',
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

  const sub = () =>
    http.expectOne((r) => r.url.includes('restaurant-setup/subscription-details/'));
  const list = () =>
    http.expectOne((r) => r.url.includes('reports/restaurant/transactions-listing/'));
  const text = () => (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');
  const el = (id: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);

  /** Answer both reads and settle the view. */
  function start(data: any, history: any = [], opts: { subStatus?: number } = {}) {
    fixture.detectChanges();
    const s = sub();
    if (opts.subStatus && opts.subStatus >= 400) {
      s.flush({ status: opts.subStatus, message: 'nope' },
        { status: opts.subStatus, statusText: 'Error' });
    } else {
      s.flush({ status: opts.subStatus ?? 200, data });
    }
    list().flush({ status: 200, data: history });
    fixture.detectChanges();
  }

  // ── the reader, directly ─────────────────────────────────────────────────
  describe('the reader separates every answer', () => {
    it('readable open terms', () => {
      const read = readSubscriptionDetails({
        subscription_terms: { recorded: true, current: TERMS },
      })!;
      expect(read.terms.kind).toBe('current');
    });

    it('an explicit absence of OPEN terms', () => {
      const read = readSubscriptionDetails({
        subscription_terms: { recorded: false, current: null },
      })!;
      expect(read.terms.kind).toBe('none');
    });

    it('THE REGRESSION: a missing projection is unstated, not absent', () => {
      const read = readSubscriptionDetails({ subscription_validity: true })!;
      expect(read.terms.kind).toBe('unstated');
      expect(read.terms.kind).not.toBe('none');
    });

    it('THE REGRESSION: recorded:false beside VALID terms is not absence', () => {
      const read = readSubscriptionDetails({
        subscription_terms: { recorded: false, current: TERMS },
      })!;
      expect(read.terms).toEqual({ kind: 'unreadable', reason: 'contradictory' });
    });

    it('recorded:true with unreadable terms is not absence either', () => {
      const read = readSubscriptionDetails({
        subscription_terms: { recorded: true, current: { nonsense: 1 } },
      })!;
      expect(read.terms).toEqual({ kind: 'unreadable', reason: 'missing-current' });
    });

    it('a malformed projection block is unreadable', () => {
      for (const block of ['x', 7, [], { recorded: 'yes' }, null]) {
        const read = readSubscriptionDetails({ subscription_terms: block })!;
        expect(read.terms.kind)
          .toBe('unreadable', `for ${JSON.stringify(block)}`);
      }
    });

    it('THE REGRESSION: a non-object body is a failure, not silence', () => {
      // It used to become `{}`, which every getter read as an older server.
      for (const body of ['nonsense', 7, null, undefined, []]) {
        expect(readSubscriptionDetails(body)).toBeNull();
      }
    });

    it('the capability gets the same four answers', () => {
      const of = (raw: any) => readSubscriptionDetails(raw)!.collection.kind;
      expect(of({ in_app_collection_supported: false })).toBe('unsupported');
      expect(of({ in_app_collection_supported: true })).toBe('supported');
      expect(of({})).toBe('unstated');
      expect(of({ in_app_collection_supported: 'no' })).toBe('unreadable');
      expect(of({ in_app_collection_supported: null })).toBe('unreadable');
    });

    it('THE REGRESSION: a malformed history payload is not an empty list', () => {
      expect(readBillingHistory({ not: 'an array' })).toBeNull();
      expect(readBillingHistory(null)).toBeNull();
      expect(readBillingHistory('x')).toBeNull();
      // A genuinely empty list still reads as one.
      expect(readBillingHistory([])).toEqual([]);
    });

    // CORRECTED ORACLE (D07/B2). This asserted
    //   `readBillingHistory([{id: 1}, 'junk', {id: 2}])` -> `[{id: 1}, {id: 2}]`
    // under the heading "one unreadable row does not withhold the rest". That
    // was the wrong rule for a financial table, and it produced two untrue
    // screens: an all-unreadable page became `[]` and rendered "No subscription
    // transactions recorded" — a claim about the restaurant — and a mixed page
    // rendered an incomplete history as the whole one with nothing saying a row
    // had gone. The rule is now that any unreadable row makes the HISTORY
    // unreadable; the full pinning, including every control, lives in
    // `billing-wire-validation.spec.ts`.
    it('one unreadable row withholds the history rather than the row', () => {
      expect(readBillingHistory([{ id: 1 }, 'junk', { id: 2 }])).toBeNull();
      // CONTROL: a page of readable rows is still returned, and verbatim.
      const page = [{ id: 1 }, { id: 2 }];
      expect(readBillingHistory(page)).toBe(page);
    });
  });

  // ── the screen ───────────────────────────────────────────────────────────
  describe('the screen states the answer it got', () => {
    it('THE REGRESSION: an older server is told about, not left blank', () => {
      start({ subscription_validity: true });
      expect(component.loadState).toBe('ready');
      expect(el('terms-unstated')).not.toBeNull();
      expect(el('terms-absent')).toBeNull();
      expect(text()).toContain("aren't available from this server");
    });

    it('THE REGRESSION: a contradiction is not reported as absence', () => {
      start({ subscription_terms: { recorded: false, current: TERMS } });
      expect(el('terms-absent')).toBeNull();
      expect(el('terms-unreadable')).not.toBeNull();
      // And the price is NOT quietly shown either — the response is not trusted.
      expect(text()).not.toContain('150,000');
    });

    it('THE REGRESSION: an unreadable body is a failure, never "Not configured"', () => {
      start('nonsense');
      expect(component.loadState).toBe('error');
      expect(el('terms-absent')).toBeNull();
    });

    it('THE REGRESSION: a body-level non-200 envelope is a failure', () => {
      // A 2xx transport carrying a refusal envelope used to be parsed anyway.
      fixture.detectChanges();
      sub().flush({ status: 403, message: 'Forbidden' });
      list().flush({ status: 200, data: [] });
      fixture.detectChanges();
      expect(component.loadState).toBe('error');
    });

    it('a transport failure is a failure', () => {
      start(null, [], { subStatus: 503 });
      expect(component.loadState).toBe('error');
      expect(el('terms-absent')).toBeNull();
      expect(el('terms-unstated')).toBeNull();
    });

    it('THE REGRESSION: a malformed capability is stated, not dropped', () => {
      start({
        in_app_collection_supported: 'no',
        subscription_terms: { recorded: false, current: null },
      });
      expect(el('collection-unreadable')).not.toBeNull();
      expect(el('collection-note')).toBeNull();
    });

    it('AN EXPLICIT ZERO IS A RECORDED PRICE, not a free trial', () => {
      start({
        in_app_collection_supported: false,
        subscription_terms: {
          recorded: true, current: { ...TERMS, recurring_amount: '0.00' },
        },
      });
      expect(el('terms-amount')!.textContent).toContain('UGX 0.00');
      for (const word of ['Free', 'free', 'Trial', 'trial', 'No charge']) {
        expect(text()).withContext(word).not.toContain(word);
      }
    });

    it('CONTROL: the canonical decimal string reaches the screen with its scale', () => {
      start({
        in_app_collection_supported: false,
        subscription_terms: {
          recorded: true, current: { ...TERMS, recurring_amount: '150000.50' },
        },
      });
      expect(el('terms-amount')!.textContent).toContain('UGX 150,000.50');
    });

    it('CONTROL: an explicit absence still says so', () => {
      start({
        in_app_collection_supported: false,
        subscription_terms: { recorded: false, current: null },
      });
      expect(el('terms-absent')).not.toBeNull();
      expect(text()).toContain('No current subscription terms are recorded');
      // Never a claim about history or about what the venue has paid.
      for (const word of ['yet', 'never', 'ever']) {
        expect(text().toLowerCase()).withContext(word).not.toContain(` ${word} `);
      }
    });

    it('CONTROL: nothing is read from the legacy columns in any state', () => {
      start({
        subscription_validity: true,
        subscription_expiry_date: '2027-01-01T00:00:00+03:00',
      });
      expect(el('terms-unstated')).not.toBeNull();
      expect(text()).not.toContain('Active');
      expect(text()).not.toContain('2027');
    });
  });

  // ── billing history ──────────────────────────────────────────────────────
  describe('billing history has its own three states', () => {
    const ok = { subscription_terms: { recorded: false, current: null } };

    it('THE REGRESSION: a failed read is reported, not left in a skeleton', () => {
      fixture.detectChanges();
      sub().flush({ status: 200, data: ok });
      list().flush({ status: 500, message: 'boom' },
        { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      expect(component.historyState).toBe('failed');
      expect(el('history-failed')).not.toBeNull();
      expect(el('history-empty')).toBeNull();
    });

    it('THE REGRESSION: a malformed successful payload is not an empty list', () => {
      // On main this threw `newCollection[Symbol.iterator] is not a function`
      // out of the template loop and took the section down.
      start(ok, { not: 'an array' });
      expect(component.historyState).toBe('failed');
      expect(el('history-empty')).toBeNull();
    });

    it('the retry is READ-ONLY and re-runs both reads', () => {
      fixture.detectChanges();
      sub().flush({ status: 200, data: ok });
      list().flush({ status: 500, message: 'boom' },
        { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      (el('history-failed')!.querySelector('button') as HTMLButtonElement).click();
      const again = http.match(() => true);
      expect(again.length).toBe(2);
      expect(again.every((r) => r.request.method === 'GET')).toBeTrue();
      again[0].flush({ status: 200, data: ok });
      again[1].flush({ status: 200, data: [] });
      fixture.detectChanges();
      expect(component.historyState).toBe('ready');
    });

    it('CONTROL: a genuinely empty list still says so', () => {
      start(ok, []);
      expect(component.historyState).toBe('ready');
      expect(el('history-empty')).not.toBeNull();
    });

    it('A SECTION FAILS ALONE: a broken history leaves the terms readable', () => {
      fixture.detectChanges();
      sub().flush({
        status: 200,
        data: { subscription_terms: { recorded: true, current: TERMS } },
      });
      list().flush({ status: 500, message: 'boom' },
        { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      expect(component.loadState).toBe('ready');
      expect(el('terms-amount')!.textContent).toContain('UGX 150,000.00');
      expect(el('history-failed')).not.toBeNull();
    });
  });

  // ── bounded read ownership ───────────────────────────────────────────────
  describe('a stale answer owns nothing', () => {
    it('THE REGRESSION: a previous restaurant\'s answer does not repaint', () => {
      fixture.detectChanges();
      const firstSub = sub();
      const firstList = list();

      authStub.currentRestaurantRole = { restaurant_id: 'rest-2' };
      authStub.currentRestaurant = { id: 'rest-2' };
      component.reload();

      const secondSub = sub();
      const secondList = list();
      secondSub.flush({
        status: 200,
        data: { subscription_terms: { recorded: false, current: null } },
      });
      secondList.flush({ status: 200, data: [] });
      fixture.detectChanges();

      // rest-1's answer arrives last, carrying a price.
      firstSub.flush({
        status: 200,
        data: { subscription_terms: { recorded: true, current: TERMS } },
      });
      firstList.flush({ status: 200, data: [{ id: 'x', amount: '1.00' }] });
      fixture.detectChanges();

      expect(text()).not.toContain('150,000');
      expect(el('terms-absent')).not.toBeNull();
      expect(component.transaction_list.length).toBe(0);
    });

    it('THE REGRESSION: an older FAILURE does not overwrite a newer success', () => {
      // The worse direction: it reports a working screen as broken.
      fixture.detectChanges();
      const firstSub = sub();
      const firstList = list();
      component.reload();
      const secondSub = sub();
      const secondList = list();
      secondSub.flush({
        status: 200,
        data: { subscription_terms: { recorded: true, current: TERMS } },
      });
      secondList.flush({ status: 200, data: [] });
      fixture.detectChanges();

      firstSub.flush({ status: 500, message: 'boom' },
        { status: 500, statusText: 'Server Error' });
      firstList.flush({ status: 500, message: 'boom' },
        { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      expect(component.loadState).toBe('ready');
      expect(component.historyState).toBe('ready');
    });

    it('a principal change is caught even when the restaurant id does not move', () => {
      fixture.detectChanges();
      const firstSub = sub();
      const firstList = list();
      authStub.userValue = { profile: { id: 'user-2' } };
      component.reload();
      const secondSub = sub();
      const secondList = list();
      secondSub.flush({
        status: 200,
        data: { subscription_terms: { recorded: false, current: null } },
      });
      secondList.flush({ status: 200, data: [] });
      firstSub.flush({
        status: 200,
        data: { subscription_terms: { recorded: true, current: TERMS } },
      });
      firstList.flush({ status: 200, data: [] });
      fixture.detectChanges();
      expect(text()).not.toContain('150,000');
    });

    it('PREVIOUS-SCOPE CONTENT IS CLEARED IMMEDIATELY, not when the answer lands', () => {
      start({
        in_app_collection_supported: false,
        subscription_terms: { recorded: true, current: TERMS },
      }, [{ id: 'x', amount: '1.00' }]);
      expect(text()).toContain('150,000');

      authStub.currentRestaurantRole = { restaurant_id: 'rest-2' };
      component.reload();
      fixture.detectChanges();

      // Nothing has answered yet, and the old restaurant's price is already off
      // the screen rather than sitting under the new restaurant's heading.
      expect(text()).not.toContain('150,000');
      expect(component.details).toBeUndefined();
      expect(component.transaction_list).toEqual([]);

      sub().flush({
        status: 200,
        data: { subscription_terms: { recorded: false, current: null } },
      });
      list().flush({ status: 200, data: [] });
      fixture.detectChanges();
    });

    it('CONTROL: an ordinary answer for the CURRENT scope still lands', () => {
      start({
        in_app_collection_supported: false,
        subscription_terms: { recorded: true, current: TERMS },
      });
      expect(el('terms-amount')!.textContent).toContain('UGX 150,000.00');
    });
  });
});
