import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { TransactionListItem } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { formatAmount } from 'src/app/_shared/utils/decimal-money';
import { SectionPageState } from '../components/section-page/section-page.component';
import {
  BillingInterval,
  CollectionCapabilityRead,
  SubscriptionDetailsRead,
  SubscriptionTerms,
  SubscriptionTermsRead,
  readBillingHistory,
  readSubscriptionDetails,
} from './billing.model';

/**
 * WHOSE ANSWER THIS IS (D07/G2).
 *
 * Both reads are fired from `ngOnInit` and again from `reload()`, and neither
 * used to carry any identity: a response that arrived after the operator had
 * moved to a second restaurant repainted the first restaurant's price onto the
 * second restaurant's screen (measured — the stale answer's UGX 150,000 landed
 * on a page scoped elsewhere). An older FAILURE could likewise overwrite a
 * newer success, which is the worse direction: it reports a working screen as
 * broken.
 *
 * THREE PARTS, AND ALL THREE ARE NEEDED. Restaurant alone misses a principal
 * change that keeps the same restaurant id; principal alone misses a
 * restaurant switch; and neither catches an ordinary Retry, where both are
 * unchanged and an older in-flight answer must still be discarded — that is
 * what `generation` is for.
 */
interface BillingScope {
  readonly principal: string;
  readonly restaurantId: string;
  readonly generation: number;
}

/** How a section's read ended. Kept apart from the READ vocabulary on purpose:
 *  a failed request must never become "no terms are recorded". */
type SectionState = 'loading' | 'ready' | 'failed';

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
export class BillingComponent implements OnInit, OnDestroy {
  rest_id: any;

  /** Drives the section-page chrome (loading skeleton / error+retry / ready). */
  loadState: SectionPageState = 'loading';

  /** The VALIDATED read, or undefined until one lands. Never defaulted. */
  details?: SubscriptionDetailsRead;

  /**
   * The billing history's own three states.
   *
   * SEPARATE FROM THE SECTION CHROME, because the two reads fail
   * independently: a subscription read that succeeded must not be reported as
   * broken because the listing timed out, and a listing that failed must not
   * sit in a skeleton for ever — which is exactly what it used to do, since
   * `load_list` only ever moved on a 200.
   */
  historyState: SectionState = 'loading';
  transaction_list: TransactionListItem[] = [];

  /** The scope every in-flight read is measured against. */
  private scope!: BillingScope;
  private generation = 0;

  /**
   * Closed by `ngOnDestroy`. BOTH reads are bound to it.
   *
   * Angular does NOT cancel an HTTP request when a component is destroyed —
   * only unsubscribing does — so without this a read issued by a screen the
   * operator has left goes on running and its callback goes on writing to a
   * dead instance.
   */
  private readonly destroy$ = new Subject<void>();

  /**
   * A DESTROYED INSTANCE OWNS NOTHING AND SENDS NOTHING.
   *
   * Read by `owns()` (so a callback that somehow still runs writes nothing)
   * and by `reload()` (so no replacement request is issued). Set BEFORE the
   * reads are released, so a synchronous teardown cannot slip between them.
   */
  private destroyed = false;

  constructor(
    private auth: AuthenticationService,
    private api: ApiService,
  ) {}

  ngOnInit(): void {
    this.reload();

    // THE ONE EVENT THE PRINCIPAL HALF OF OWNERSHIP HAS, and the mechanism this
    // repository already uses for exactly this question (`kitchen-order.service`).
    // `AuthenticationService` publishes on profile update, on OTP completion, on
    // a token refresh and — as `null` — on sign-out. Without observing it, a
    // billing screen with no read in flight keeps rendering the previous
    // principal's recorded price until something happens to ask again.
    //
    // ORDER IS LOAD-BEARING: `user` is a BehaviorSubject, so subscribing HERE
    // fires synchronously with the principal `reload()` has just captured. It
    // therefore matches and no-ops. Subscribing before `reload()` would fire
    // against an unset scope.
    //
    // This is an OBSERVATION, not an authentication path: it reads a stable
    // principal identifier and nothing else. No token is captured, compared,
    // stored in ownership metadata or logged.
    this.auth.user?.pipe(takeUntil(this.destroy$)).subscribe(() => this.onContextPublished());
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Start a fresh generation and re-read both sections.
   *
   * THE PREVIOUS SCOPE'S CONTENT IS CLEARED IMMEDIATELY, before either request
   * goes out. Leaving the old terms on screen while a new restaurant's read is
   * in flight shows one restaurant's price under another restaurant's heading
   * for as long as the network takes, which is the same untruth the ownership
   * guard exists to prevent — arriving a moment earlier.
   */
  reload(): void {
    // `reload()` is PUBLIC — the section chrome's Retry and the history's Try
    // again both call it — so the guard belongs here rather than at each call
    // site. A destroyed instance issues no replacement request.
    if (this.destroyed) return;

    const live = this.liveContext();
    this.rest_id = live.restaurantId || undefined;

    this.generation += 1;
    this.scope = { ...live, generation: this.generation };

    this.details = undefined;
    this.transaction_list = [];
    this.loadState = 'loading';
    this.historyState = 'loading';

    if (!this.rest_id) {
      this.loadState = 'error';
      this.historyState = 'failed';
      return;
    }

    this.loadingBillingSub(this.scope);
    this.getTransactionList(this.scope);
  }

  /**
   * The principal and restaurant AS THEY ARE NOW. Read fresh on every call —
   * `currentRestaurantRole` is a getter over localStorage and `userValue` is a
   * getter over the published subject, so neither is cached here.
   *
   * It carries an IDENTIFIER, never a credential. A stable principal id is not
   * a bearer token and the session token is deliberately not part of ownership.
   */
  private liveContext(): { principal: string; restaurantId: string } {
    return {
      principal: String(this.auth.userValue?.profile?.id ?? ''),
      restaurantId: String(
        this.auth.currentRestaurantRole?.restaurant_id ?? this.auth.currentRestaurant?.id ?? '',
      ),
    };
  }

  /** Does the context an answer was requested under still hold? */
  private contextMatches(at: BillingScope): boolean {
    const live = this.liveContext();
    return at.principal === live.principal && at.restaurantId === live.restaurantId;
  }

  /**
   * Whether an answer captured under `at` may still write to this screen.
   *
   * THE OWNER STAYS FROZEN AND WHAT IT IS MEASURED AGAINST IS READ LIVE — the
   * shape D04 settled for the diner checkout and the kitchen board settled for
   * its own scope. `at` is captured BEFORE the request and never re-derived on
   * arrival; replacing it with the current principal would be the opposite
   * error, attributing an old answer to a new user.
   *
   * IT USED TO COMPARE `at` AGAINST `this.scope`, a field only `reload()` ever
   * writes — so the guard could only ever see a transition this component had
   * already been told about. A principal or restaurant that moved underneath a
   * mounted screen passed it, and the departed scope's answer repainted.
   *
   * Three parts and all three are needed: `destroyed` (a dead instance owns
   * nothing), the GENERATION (an ordinary Retry, where both context halves are
   * unchanged and the older in-flight answer must still lose), and the LIVE
   * CONTEXT (a change nothing told this component about).
   */
  private owns(at: BillingScope): boolean {
    return !this.destroyed
      && at.generation === this.generation
      && this.contextMatches(at);
  }

  /**
   * The published principal moved.
   *
   * ONE TRANSITION, AND IT IS `reload()`: it clears the previous scope's
   * content AT ONCE (rather than leaving one principal's recorded price under
   * another's heading until some other answer happens to arrive), bumps the
   * generation so every read still in flight is disowned, and re-reads for
   * whatever is current now. It sends NOTHING when there is nothing to read —
   * sign-out clears storage before publishing, so the restaurant is already
   * gone and `reload()` returns before issuing a request.
   *
   * A REPUBLISHED SAME PRINCIPAL CHANGES NOTHING. A token refresh pushes a new
   * object carrying the same profile; treating every emission as a context
   * change would discard an ordinary billing read on every refresh, which is
   * the opposite defect.
   */
  private onContextPublished(): void {
    if (this.destroyed || !this.scope) return;
    if (this.contextMatches(this.scope)) return;
    this.reload();
  }

  // ── The recorded terms ──────────────────────────────────────────────────────

  /** The validated read, or `null` before one lands. */
  get termsRead(): SubscriptionTermsRead | null {
    return this.details?.terms ?? null;
  }

  /** The one open terms row, or `null` in every other state. */
  get terms(): SubscriptionTerms | null {
    const read = this.termsRead;
    return read?.kind === 'current' ? read.terms : null;
  }

  /** The server stated an OPEN ROW EXISTS and this client could read it. */
  get hasCurrentTerms(): boolean {
    return this.termsRead?.kind === 'current';
  }

  /**
   * The server stated there are NO OPEN TERMS.
   *
   * THE SELECTOR IS `open_terms` — `ended_at IS NULL` and nothing else — so a
   * restaurant whose only terms have been ENDED also answers
   * `{recorded: false, current: null}`. The copy therefore says no CURRENT
   * terms are recorded, and never that none ever existed or that the venue has
   * never paid, neither of which this response establishes. (There is no
   * historical-terms API, and adding one to make a sentence accurate would be
   * building a surface to justify copy.)
   */
  get termsAbsent(): boolean {
    return this.termsRead?.kind === 'none';
  }

  /**
   * The response never mentioned the projection — an older server.
   *
   * IT GETS A SENTENCE OF ITS OWN, and that is the change. It used to render
   * NOTHING: the section carried a heading and then blank space, which reads
   * as a loading failure or a layout bug rather than as "this server has not
   * told us". It is not a transport failure and must not be reported as one.
   */
  get termsUnstated(): boolean {
    return this.termsRead?.kind === 'unstated';
  }

  /**
   * The projection arrived and cannot be trusted.
   *
   * THREE PRODUCERS, ONE SENTENCE. A malformed block, `recorded: true` with no
   * readable terms, and `recorded: false` beside a `current` are different
   * faults and the same remedy — ask a person, do not rely on this page. The
   * reason is kept on the read for diagnosis and deliberately does not branch
   * the copy, which would make the screen an oracle over the response.
   *
   * It ALSO covers a readable row whose amount this client cannot express
   * exactly: `formatAmount` answers `null` rather than rounding, and a price
   * that cannot be shown exactly is not shown.
   */
  get termsUnreadable(): boolean {
    const read = this.termsRead;
    if (!read) return false;
    if (read.kind === 'unreadable') return true;
    return read.kind === 'current' && this.recurringAmountDisplay === null;
  }

  /**
   * The recorded price, or `null` when it cannot be represented EXACTLY.
   *
   * `formatAmount` parses the canonical decimal string digit by digit and
   * answers `null` rather than guessing — so `"0.00"` reads `0.00` (a real,
   * deliberate price: a free pilot, a waived period) instead of collapsing to
   * `0`, and an amount this client cannot express is REPORTED rather than
   * rounded into something plausible. **An explicit zero is a RECORDED VALUE**,
   * never a free trial, a discount or an absence — the absence is a row that
   * does not exist, which is `termsAbsent`.
   */
  get recurringAmountDisplay(): string | null {
    const terms = this.terms;
    if (!terms) return null;
    const formatted = formatAmount(terms.recurring_amount);
    if (formatted === null) return null;
    return `${terms.currency} ${formatted}`;
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

  get collectionRead(): CollectionCapabilityRead | null {
    return this.details?.collection ?? null;
  }

  /**
   * The server says it cannot collect in-app.
   *
   * Rendering the note off the SERVER's answer — rather than off a constant
   * here — is what makes it disappear by itself if a collector is ever built,
   * instead of becoming the next thing on this page that is no longer true.
   */
  get collectionUnsupported(): boolean {
    return this.collectionRead?.kind === 'unsupported';
  }

  /**
   * The server sent the capability key and this client could not read it.
   *
   * SAID OUT LOUD RATHER THAN DROPPED. A malformed value used to be discarded
   * in the reader, so a broken contract silently removed the explanatory note
   * and the page looked exactly like a build that had grown a collector.
   */
  get collectionUnreadable(): boolean {
    return this.collectionRead?.kind === 'unreadable';
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

  getTransactionList(at: BillingScope = this.scope): void {
    const today = new Date();
    const from_today = this.subtractMonths(today, 5);
    this.api
      .get<any>(null, `reports/restaurant/` + 'transactions-listing/', {
        restaurant: at.restaurantId,
        from: `${from_today.getFullYear()}-${from_today.getMonth() + 1}-${from_today.getDate()}`,
        to: `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`,
        type: 'subscription',
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (x) => {
          if (!this.owns(at)) return;
          // A 2xx body whose envelope says otherwise is a FAILURE, not an
          // empty history — the old code simply left the skeleton up for it.
          if (x?.status !== 200) {
            this.historyState = 'failed';
            return;
          }
          const rows = readBillingHistory(x?.data);
          if (rows === null) {
            // A MALFORMED SUCCESSFUL PAYLOAD IS NOT AN EMPTY LIST. Handing a
            // non-array to the template loop threw
            // `newCollection[Symbol.iterator] is not a function` out of
            // Angular and took the section down with it.
            this.historyState = 'failed';
            return;
          }
          this.transaction_list = rows as TransactionListItem[];
          this.historyState = 'ready';
        },
        error: () => {
          if (!this.owns(at)) return;
          this.historyState = 'failed';
        },
      });
  }

  loadingBillingSub(at: BillingScope = this.scope): void {
    this.api
      .get<any>(null, 'restaurant-setup/subscription-details/', { restaurant: at.restaurantId })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (x) => {
          if (!this.owns(at)) return;
          // THE ENVELOPE IS CHECKED BEFORE THE BODY. A non-200 envelope on a
          // 2xx transport used to be parsed anyway, producing an empty read
          // that rendered as silence — a denial reported as "this server said
          // nothing about terms".
          if (x?.status !== 200) {
            this.loadState = 'error';
            return;
          }
          const read = readSubscriptionDetails(x?.data);
          if (read === null) {
            // A body this client cannot parse at all is a FAILURE. It used to
            // become `{}`, which every downstream getter read as an older
            // server that had simply not answered.
            this.loadState = 'error';
            return;
          }
          this.details = read;
          this.loadState = 'ready';
        },
        error: () => {
          if (!this.owns(at)) return;
          // A FAILED, DENIED OR OFFLINE READ IS NEVER "Not configured". The
          // section chrome renders its own error with a read-only retry.
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
