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

/**
 * Billing is READ-ONLY and states only what the server knows (D07 / PR-3).
 *
 * These specs drive the real `ApiService` / `HttpClient` stack with
 * `HttpTestingController`, so what is asserted is the WIRE shape rather than a
 * hand-built view model. That matters twice over here: the recorded amount is a
 * canonical decimal STRING whose scale must survive to the screen, and the
 * billing-history row's amount key is exactly the one the serializer emits.
 */
describe('BillingComponent', () => {
  let component: BillingComponent;
  let fixture: ComponentFixture<BillingComponent>;
  let http: HttpTestingController;

  const RESTAURANT = 'rest-1';

  const authStub = {
    currentRestaurantRole: { restaurant_id: RESTAURANT },
    currentRestaurant: { id: RESTAURANT },
  };

  beforeEach(async () => {
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

  // -- helpers ---------------------------------------------------------------

  /** Answer the subscription read; the history read is flushed empty. */
  function start(data: any, history: any[] = []): void {
    fixture.detectChanges();                       // ngOnInit -> both reads
    const sub = http.expectOne((r) =>
      r.url.includes('restaurant-setup/subscription-details/'),
    );
    sub.flush({ status: 200, data });
    const list = http.expectOne((r) =>
      r.url.includes('reports/restaurant/transactions-listing/'),
    );
    list.flush({ status: 200, data: history });
    fixture.detectChanges();
  }

  const withTerms = (amount = '150000.00', count = 1) => ({
    subscription_validity: true,
    subscription_expiry_date: null,
    in_app_collection_supported: false,
    subscription_terms: {
      recorded: true,
      current: {
        recurring_amount: amount,
        currency: 'UGX',
        billing_interval: { unit: 'month', count },
        effective_from: '2026-07-01T00:00:00+03:00',
      },
    },
  });

  const withoutTerms = (extra: Record<string, unknown> = {}) => ({
    in_app_collection_supported: false,
    subscription_terms: { recorded: false, current: null },
    ...extra,
  });

  const text = () => fixture.nativeElement.textContent as string;

  it('should create', () => {
    start(withoutTerms());
    expect(component).toBeTruthy();
  });

  // -- the recorded terms ----------------------------------------------------

  describe('the recorded terms', () => {
    it('renders the amount the server recorded, with its scale intact', () => {
      start(withTerms('150000.00'));
      expect(component.recurringAmountDisplay).toBe('UGX 150,000.00');
      expect(text()).toContain('UGX 150,000.00');
    });

    it('renders a zero price as a price, never as "free"', () => {
      // A free pilot or a waived period is a real, deliberate decision. `0.00`
      // must not collapse to `0`, and the word "free" does not exist in this
      // domain — the absence of a price is the absence of a row.
      start(withTerms('0.00'));
      expect(component.recurringAmountDisplay).toBe('UGX 0.00');
      expect(text().toLowerCase()).not.toContain('free');
    });

    it('states the recurrence as a plain interval, never a plan name', () => {
      start(withTerms('90000.00', 2));
      expect(component.recurrenceLabel).toBe('every 2 months');
      expect(text()).toContain('every 2 months');
    });

    it('reports "cannot display" rather than "none recorded" for unreadable terms', () => {
      // THE SERVER SAID TERMS EXIST. A `current` block this client cannot read
      // is a display failure, not an absence, and collapsing the two would tell
      // a paying restaurant it has no subscription.
      start({
        in_app_collection_supported: false,
        subscription_terms: { recorded: true, current: { nonsense: true } },
      });
      // `hasCurrentTerms` REPLACED `termsRecorded` and asks a different
      // question: not "what boolean did the server send" but "are there
      // readable open terms on this screen". For this payload the answer is
      // no — and the distinction is what keeps this state out of the absence
      // branch, which is what the assertions below pin.
      expect(component.hasCurrentTerms).toBeFalse();
      expect(component.terms).toBeNull();
      expect(component.termsUnreadable).toBeTrue();
      expect(component.termsAbsent).toBeFalse();
      expect(text()).toContain("can't display your recorded subscription terms");
      expect(text()).not.toContain('No current subscription terms are recorded');
    });

    it('refuses to display an amount it cannot represent exactly', () => {
      // Rounding a recorded price into something plausible is the defect this
      // whole change removes. The state is NAMED instead.
      start(withTerms('not-a-number'));
      expect(component.recurringAmountDisplay).toBeNull();
      expect(component.termsUnreadable).toBeTrue();
      expect(text()).toContain("can't display your recorded subscription terms");
    });
  });

  // -- absence ---------------------------------------------------------------

  describe('when no terms are recorded', () => {
    it('says so explicitly and invents no price', () => {
      start(withoutTerms());
      expect(component.hasCurrentTerms).toBeFalse();
      // ORACLE CORRECTED, NOT RELAXED (D07/G2). `recorded` is driven by
      // `open_terms` — `ended_at IS NULL` — so a restaurant whose terms have
      // been ENDED answers this way too. The old sentence said none had been
      // recorded "yet", which claims none ever existed and that the venue has
      // never paid; neither is established by this response.
      expect(text()).toContain('No current subscription terms are recorded');
      expect(text()).not.toContain('UGX');
    });

    it('states that an older server did not answer, rather than staying blank', () => {
      // ORACLE CORRECTED, NOT RELAXED (D07/G2). This asserted the section
      // stayed SILENT. Rendering the reassuring "none recorded" sentence for
      // an older server would still be inventing an answer — that half is
      // unchanged and is still asserted below — but rendering NOTHING left a
      // heading above blank space, which reads as a broken page rather than
      // as "this server has not told us". Silence is not the same as saying
      // the terms are unavailable, and only one of the two is true.
      start({ subscription_validity: true });
      expect(component.hasCurrentTerms).toBeFalse();
      expect(component.collectionUnsupported).toBeFalse();
      expect(text()).not.toContain('No current subscription terms are recorded');
      expect(text()).not.toContain("aren't collected through the app");
      // ...and it SAYS SO, rather than rendering a heading above blank space.
      expect(text()).toContain("aren't available from this server");
    });
  });

  // -- nothing is inferred from the legacy columns ---------------------------

  describe('the legacy columns decide nothing', () => {
    it('does not manufacture terms from a true subscription_validity', () => {
      // THE DANGEROUS DIRECTION: that column defaults to true and nothing
      // maintains it, which is how the old panel read "Active" for everyone.
      start(withoutTerms({
        subscription_validity: true,
        subscription_expiry_date: '2027-01-01T00:00:00+03:00',
      }));
      expect(component.hasCurrentTerms).toBeFalse();
      expect(component.termsAbsent).toBeTrue();
      expect(text()).not.toContain('Active');
      expect(text()).not.toContain('Next billing date');
    });

    it('shows recorded terms even when the legacy flag reads false', () => {
      const payload = withTerms('75000.00');
      payload.subscription_validity = false;
      start(payload);
      expect(text()).toContain('UGX 75,000.00');
      expect(text()).not.toContain('Inactive');
    });
  });

  // -- the collection capability --------------------------------------------

  describe('the collection capability', () => {
    it('states that payments are not collected in the app, from the server', () => {
      start(withoutTerms());
      expect(component.collectionUnsupported).toBeTrue();
      expect(text()).toContain("aren't collected through the app");
    });

    it('offers no payment control, and no payment machinery survives', () => {
      start(withTerms());
      const body = text();
      for (const word of ['Pay Now', 'Renew', 'Subscribe', 'Switch to']) {
        expect(body).withContext(word).not.toContain(word);
      }
      // The collector, its OTP step and its form are gone from the class too —
      // an inert button that still sends a verification code would be worse
      // than no button at all.
      for (const member of [
        'PayNow', 'Save', 'sendOtp', 'InitPayment', 'closeModal',
        'PaymentForm', 'showModal', 'require_otp',
      ]) {
        expect((component as any)[member])
          .withContext(member).toBeUndefined();
      }
    });

    it('drops the note by itself if a collector is ever built', () => {
      // Rendered off the SERVER's flag, never a local constant — so this page
      // cannot outlive the absence it describes.
      start({ ...withoutTerms(), in_app_collection_supported: true });
      expect(component.collectionUnsupported).toBeFalse();
      expect(text()).not.toContain("aren't collected through the app");
    });
  });

  // -- billing history -------------------------------------------------------

  describe('billing history', () => {
    const row = {
      id: 'txn-1',
      time_created: '2026-06-01T09:00:00+03:00',
      transaction_type: 'subscription',
      order_number: null,
      amount: 150000.0,
      payment_mode: 'momo',
      transaction_status: 'pending',
      transaction_platform: 'web',
    };

    it('renders the amount the serializer actually emits', () => {
      // REGRESSION: the table read `amount_out`, a field the non-custodial
      // teardown removed, so `Number(undefined) || 0` rendered UGX 0 for every
      // recorded payment. The fixture carries the REAL wire shape, with no
      // `amount_out` at all, so the old code cannot pass this.
      start(withoutTerms(), [row]);
      expect((row as any).amount_out).toBeUndefined();
      expect(component.transactionAmount(row as any)).toBe('UGX 150,000.00');
      expect(text()).toContain('UGX 150,000.00');
    });

    it('shows a dash rather than a zero for an unreadable amount', () => {
      expect(component.transactionAmount({ amount: undefined } as any)).toBe('—');
    });

    it('renders the tender and the channel as separate facts', () => {
      start(withoutTerms(), [row]);
      const body = text();
      expect(body).toContain('momo');       // the tender
      expect(body).toContain('web');        // the channel it was raised through
    });
  });
});
