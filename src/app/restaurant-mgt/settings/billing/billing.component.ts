import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { TransactionListItem } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { formatAmount } from 'src/app/_shared/utils/decimal-money';
import { SectionPageState } from '../components/section-page/section-page.component';
import {
  BillingInterval,
  SubscriptionDetails,
  SubscriptionTerms,
  readSubscriptionDetails,
} from './billing.model';

/**
 * Billing — READ-ONLY (D07 / PR-3).
 *
 * This screen used to state four things the platform could not support, and the
 * removals below are the point of the change rather than a tidy-up:
 *
 *   A PLAN CATALOGUE WITH PRICES. `billing-plans.ts` carried UGX 150,000 /
 *   1,500,000 and a "Save UGX 300,000/yr" badge derived from them, under a
 *   `TODO(pricing): confirm the real figures before merge` that was never
 *   confirmed. No server ever sent those numbers and no owner ever approved
 *   them. The file is DELETED rather than relabelled "indicative": a price a
 *   restaurant reads on its own billing page is a price it will hold us to.
 *
 *   A PAY / RENEW / SUBSCRIBE CONTROL. It opened a dialog, took a phone number,
 *   sent a real OTP, and POSTed `finances/transactions/` — which contacted no
 *   provider, wrote a Pending row and answered "The subscription payment has
 *   been initiated. Please confirm payment when promted". There is no aggregator
 *   integration in the platform. The server now refuses that call outright
 *   (HTTP 501), so the control had nothing behind it in either repository.
 *
 *   AN "ACTIVE" STATUS BADGE, read from `subscription_validity` — a column that
 *   DEFAULTS TO TRUE and that no supported writer maintains, so it read "Active"
 *   for every restaurant on the platform regardless of anything. The Admin plane
 *   froze the equivalent boolean `false` for exactly this reason.
 *
 *   A "NEXT BILLING DATE", read from `subscription_expiry_date` — likewise
 *   unwritten, and a claim about a billing run that does not exist.
 *
 * WHAT IT STATES INSTEAD is what the server actually knows: the canonical
 * recorded terms (`commercial_app.RestaurantSubscriptionTerms`) or an explicit
 * "none recorded", and whether in-app collection is supported at all. Both come
 * from the SERVER — the capability especially, so this page cannot outlive a
 * collector's absence the way the old button did.
 *
 * WHAT IT DELIBERATELY DOES NOT ADD: no "mark as paid" acknowledgement, no
 * invoice, no receivable, no amount due, no balance, no bank details and no
 * payment instruction. None of those exist in the platform, and inventing one on
 * the screen is the same defect this change removes, wearing a different shape.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-billing',
  templateUrl: './billing.component.html',
  styleUrl: './billing.component.css',
  standalone: false,
})
export class BillingComponent implements OnInit {
  rest_id: any;

  /** Drives the section-page chrome (loading skeleton / error+retry / ready). */
  loadState: SectionPageState = 'loading';

  /** The server's answer, or undefined until it lands. Never defaulted. */
  details?: SubscriptionDetails;

  transaction_list: TransactionListItem[] = [];
  load_list = false;

  constructor(
    private auth: AuthenticationService,
    private api: ApiService,
  ) {}

  ngOnInit(): void {
    this.rest_id =
      this.auth.currentRestaurantRole?.restaurant_id ?? this.auth.currentRestaurant?.id;
    if (!this.rest_id) {
      this.loadState = 'error';
      return;
    }
    this.reload();
  }

  reload(): void {
    this.loadState = 'loading';
    this.loadingBillingSub();
    this.getTransactionList();
  }

  // ── The recorded terms ──────────────────────────────────────────────────────

  /**
   * True only when the SERVER said so. `undefined` (not yet loaded, or an older
   * server that does not send the key) is NOT "no terms" — it is "not stated",
   * and the template renders neither an amount nor a reassurance for it.
   */
  get termsRecorded(): boolean {
    return this.details?.subscription_terms?.recorded === true;
  }

  /**
   * Whether the server answered the terms question AT ALL.
   *
   * SEPARATE FROM `termsRecorded`, and the separation is the point: a response
   * that never mentioned `subscription_terms` has said nothing, and rendering
   * "no terms have been recorded" for it would invent a reassuring answer out
   * of an older server's silence. Only a server that stated the fact gets to
   * have that sentence shown on its behalf.
   */
  get termsStated(): boolean {
    return this.details?.subscription_terms !== undefined;
  }

  get terms(): SubscriptionTerms | null {
    return this.details?.subscription_terms?.current ?? null;
  }

  /**
   * The recorded price, or `null` when it cannot be represented EXACTLY.
   *
   * `formatAmount` parses the canonical decimal string digit by digit and
   * answers `null` rather than guessing — so `"0.00"` reads `0.00` (a real,
   * deliberate price: a free pilot, a waived period) instead of collapsing to
   * `0`, and an amount this client cannot express is REPORTED rather than
   * rounded into something plausible. The same rule the diner checkout applies
   * to a quote: a figure that cannot be shown exactly is not shown.
   */
  get recurringAmountDisplay(): string | null {
    const terms = this.terms;
    if (!terms) return null;
    const formatted = formatAmount(terms.recurring_amount);
    if (formatted === null) return null;
    return `${terms.currency} ${formatted}`;
  }

  /**
   * True when the SERVER says terms are recorded and this client cannot show
   * the amount — whether because the figure is inexpressible or because the
   * `current` block could not be read at all. Both are "we cannot display it",
   * and neither is "none recorded", which is a different statement entirely.
   */
  get amountIsUnreadable(): boolean {
    return this.termsRecorded && this.recurringAmountDisplay === null;
  }

  /** "every month" / "every 2 months" — never a plan name; there is no catalogue. */
  get recurrenceLabel(): string | null {
    const interval: BillingInterval | undefined = this.terms?.billing_interval;
    if (!interval?.unit) return null;
    const count = Number(interval.count);
    if (!Number.isFinite(count) || count < 1) return null;
    return count === 1 ? `every ${interval.unit}` : `every ${count} ${interval.unit}s`;
  }

  get effectiveFrom(): string | null {
    return this.terms?.effective_from ?? null;
  }

  // ── The collection capability ───────────────────────────────────────────────

  /**
   * Whether the SERVER says it can collect in-app. Read strictly: only an
   * explicit `false` produces the explanatory note, so a response that never
   * mentioned the capability says nothing rather than asserting an absence.
   *
   * Rendering the note off this flag — rather than off a constant here — is what
   * makes it disappear by itself if a collector is ever built, instead of
   * becoming the next thing on this page that is no longer true.
   */
  get inAppCollectionUnsupported(): boolean {
    return this.details?.in_app_collection_supported === false;
  }

  // ── Billing history ─────────────────────────────────────────────────────────

  /**
   * One recorded transaction's amount.
   *
   * It reads `amount`, which is WHAT THE WIRE CARRIES. The old table read
   * `amount_out` — a field the custodial teardown removed from the serializer
   * years of commits ago — so `Number(undefined) || 0` rendered **UGX 0** for
   * every row in this table. A payment history that reports every payment as
   * zero is the same class of untruth as a Pay button with no collector behind
   * it, so it is fixed here rather than left for the next reader.
   */
  transactionAmount(record: TransactionListItem): string {
    const formatted = formatAmount(record?.amount);
    return formatted === null ? '—' : `UGX ${formatted}`;
  }

  subtractMonths(date: Date, monthsToSubtract: number): Date {
    const dateCopy = new Date(date);
    dateCopy.setMonth(dateCopy.getMonth() - monthsToSubtract);
    return dateCopy;
  }

  getTransactionList() {
    this.load_list = false;
    const today = new Date();
    const from_today = this.subtractMonths(today, 5);
    this.api
      .get<any>(null, `reports/restaurant/` + 'transactions-listing/', {
        restaurant: this.rest_id,
        from: `${from_today.getFullYear()}-${from_today.getMonth() + 1}-${from_today.getDate()}`,
        to: `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`,
        type: 'subscription',
      })
      .subscribe((x) => {
        if (x?.status == 200) {
          this.transaction_list = x?.data as any;
          this.load_list = true;
        }
      });
  }

  loadingBillingSub() {
    this.api
      .get<any>(null, 'restaurant-setup/subscription-details/', { restaurant: this.rest_id })
      .subscribe({
        next: (x) => {
          this.details = readSubscriptionDetails(x?.data);
          this.loadState = 'ready';
        },
        error: () => {
          this.loadState = 'error';
        },
      });
  }

  // Phase 1: subscription COLLECTION is not a restaurant-portal capability.
  //
  // `PayNow()` / `InitPayment()` / `Save()` / `sendOtp()` / `closeModal()` and the
  // dialog they drove are GONE, along with `PaymentForm`, `showModal`,
  // `require_otp` and `data`. They POSTed `finances/transactions/` (which the
  // server now refuses with 501), issued a REAL OTP through
  // `users/auth/resend-otp/` for a payment that could never happen, and probed
  // `users/msisdn-lookup/` with a typed-in number. Nothing replaced them
  // deliberately: there is no collector to put behind a button, and an inert
  // control that sends an OTP is worse than no control at all.
  //
  // A `canChangeBillingDate` getter used to stand here too, gating a third "Cash"
  // option in the payment-method picker on a platform role read off
  // profile.roles. It went with the platform-role vocabulary.
}
