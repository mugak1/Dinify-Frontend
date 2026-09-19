import { CommonModule, Location } from '@angular/common';
import { ChangeDetectionStrategy, AfterViewInit, Component, ViewChild, ElementRef, OnDestroy, OnInit, Input } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ConfirmDialogService } from 'src/app/_common/confirm-dialog.service';
import { BasketItem, OrderInitiated, OrderQuoteLine, Restaurant, TableScan } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { BasketService } from 'src/app/_services/basket.service';
import {
  CheckoutCoordinatorService, CheckoutOwner, CheckoutRecord, FlightToken,
  IntentReservation, IssuedCommand, PURCHASE_CANON, RecoveryOutcome,
  RenewalResult,
} from 'src/app/_services/checkout-coordinator.service';
import {
  CHECKOUT_PROTOCOL_CORRELATED, CheckoutCorrelation, acceptanceVerdict,
  correlationPromised, currentDisposition, protocolLevel, readCorrelation,
} from 'src/app/_shared/order/checkout-correlation';
import {
  ClosureEvidence,
  quoteDeadlinePassed,
  quoteProtocolLevel,
  policyVersionSupported,
  QuoteClosure,
  readPublishedClosure,
  readPublishedPolicy,
  readQuoteAnswer,
  usableClosure,
} from 'src/app/_shared/order/quote-transition';

/**
 * E1 — WHAT A DINER IS TOLD WHEN A CLOSURE IS ASSERTED AND UNUSABLE.
 *
 * ONE sentence for every unusable shape: an unrecognised policy version, an
 * unreadable row, and a projection that claims an acceptance and a closure at
 * once. Distinguishing them for the diner would be an oracle over the
 * response and would ask them to act on a difference they cannot act on — the
 * remedy is the same in all three, and it is a person.
 */
const UNRESOLVED_CLOSURE_MESSAGE =
  'We could not confirm the status of this order. Please check with staff '
  + 'before ordering the same items again.';
import { DinerSessionService } from 'src/app/_services/diner-session.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { SessionStorageService } from 'src/app/_services/storage/session-storage.service';
import { environment } from 'src/environments/environment';
import { menuItemUrl } from '../../menu-item-detail/menu-item-url';
import { ConnectivityService } from '../../../_services/connectivity.service';
import { PriceDisplayComponent } from '../../../_shared/ui/price-display/price-display.component';
import { OngoingOrderBannerComponent } from '../../ongoing-order-banner/ongoing-order-banner.component';
import { MenuNavStateService } from '../../menu/menu-nav-state.service';
import { ButtonComponent } from '../../../_shared/ui/button/button.component';
import {
  addMinorUnits, formatAmount, formatMinorUnits, fromMinorUnits, sameAmount,
  toMinorUnits,
} from '../../../_shared/utils/decimal-money';
import {
  QuoteRefusal,
  QuoteReview,
  reviewQuote,
} from '../../../_shared/order/quote-review';
import {
  PricedLineParts, lineOriginalSubtotalMinor, lineSubtotalMinor,
} from '../../../_shared/order/line-money';
import {
  CheckoutLimitState, MAX_QUANTITY_PER_LINE, atLineQuantityCeiling,
  checkCheckoutLimits,
} from '../../../_shared/order/checkout-limits';

@Component({
    changeDetection: ChangeDetectionStrategy.Eager,
    selector: 'app-basket-body',
    templateUrl: './basket-body.component.html',
    styleUrls: ['./basket-body.component.css'],
    standalone: true,
    imports: [CommonModule, PriceDisplayComponent, OngoingOrderBannerComponent, ButtonComponent]
})
export class BasketBodyComponent implements OnInit, AfterViewInit, OnDestroy {
  table?: TableScan|any;
  /** True only at the desktop-sidebar call site (diner-app.component.html). Gates the
   *  centered "Table N" label — on the basket PAGE that's replaced by the header chip,
   *  but in the always-mounted sidebar it's the only table indicator. */
  @Input() sidebar = false;
  order_initiated?: OrderInitiated;
  /** The ONE authoritative review: the server's priced lines and total. */
  showQuoteSheet = false;

  /**
   * Which placement attempt is in flight, and what it was priced for.
   *
   * A LATE RESPONSE MUST NOT RENDER OR SUBMIT THE WRONG QUOTE. A basket
   * revision alone is not enough — the checkout CONTEXT (restaurant and table)
   * can change without the basket doing so, and two taps can overlap — so an
   * attempt carries its own sequence number alongside both.
   */
  /** R2 — set in `ngOnDestroy`; see `ownsRecovery`. */
  private destroyed = false;
  private attemptSeq = 0;
  private activeAttempt: {
    seq: number; revision: number; context: string;
  } | null = null;
  /** The quote the diner is actually looking at, if any.
   *
   *  `ref` is NULL against a server that prices the old way and therefore names
   *  no quote — see the tolerance in placeOrder(). Everything else about the
   *  binding (revision + checkout context) applies identically either way.
   *
   *  `key` IS THE ATTEMPT THIS REVIEW WAS PRICED UNDER, and it is the only part
   *  of the binding that can tell two attempts at ONE purchase apart. A
   *  renewal carries `request` and `scope` across unchanged — that is what
   *  makes it the same purchase — so the revision and the context are
   *  IDENTICAL either side of it and neither can say that the record has moved
   *  on. Null only where no record existed to read, which production does not
   *  reach: every checkout reserves before it prices. */
  private reviewedQuote:
    { ref: string | null; revision: number; context: string;
      key: string | null } | null = null;
  /** Set when the server refused a draft priced before the pricing correction. */
  legacyDraft = false;

  /**
   * Set when the server has RECORDED that the last reviewed quote may never be
   * accepted (D06 — expired, or the purchase changed).
   *
   * It exists to change what the diner is TOLD, never what happens: the
   * re-price is identical to the one a `quote_ref_stale` triggers. Saying "your
   * order was placed a while ago, so we have re-checked the prices" is accurate
   * only when the server really retired the quote; saying it for a refusal that
   * retired nothing would be a claim nobody made.
   */
  quoteRetired = false;

  /** Inline placement-error state, shown with a Retry at the checkout footer. */
  orderError = false;
  orderErrorMessage = '';
  /**
   * True while a placement round-trip is in flight — disables the CTA.
   *
   * SHARED, NOT LOCAL (D04/D). This component is mounted TWICE on desktop —
   * the routed basket page and the sidebar that lives beside the router
   * outlet — and this used to be a field on each instance, so one could start
   * a checkout while the other still showed a live button. It now reads the
   * coordinator's single flight, so the two cannot disagree about whether a
   * checkout is running.
   */
  get placingOrder(): boolean {
    return this.checkout.inFlight();
  }

  /** This instance's claim on that flight, if it holds it. */
  private flight: FlightToken | null = null;

  /**
   * The session keys a COMPLETED order makes stale, and only those.
   *
   * Deliberately NOT the diner's table, restaurant or capability tokens: the
   * order is finished, the diner is still at the table, and destroying their
   * context in order to rebuild part of it is what the blanket wipe this
   * replaces did. See `resetDinerOrderContext`.
   */
  private static readonly PER_ORDER_SESSION_KEYS = [
    'upsellConfig',
    'diner.menu.scrollY',
  ];

  /** What a reload found, when it found anything. Rendered as a one-line
   *  notice; never as a silent redirect, because a diner who does not know
   *  what happened is the problem being solved. */
  recovered: RecoveryOutcome | null = null;

  restaurant: any;
  url = environment.apiUrl;
  upsellConfig: any = null;
  upsellItems: any[] = [];
  imageLoaded: Record<string, boolean> = {};
  imageErrored: Record<string, boolean> = {};
  canScrollLeft = false;
  canScrollRight = false;
  @ViewChild('upsellCarousel') upsellCarousel?: ElementRef<HTMLDivElement>;
  private upsellStorageSub?: Subscription;
  private readonly onResize = () => this.checkScroll();

  get basketItems(): BasketItem[] {
    return this.basketService.Basket()?.items ?? [];
  }

  /**
   * THE DISPLAYED TOTAL AND ITS LABEL COME FROM ONE COMPUTATION.
   *
   * `totalAmount` used to read the PERSISTED `Basket().totalAmount` while
   * `totalIsExact` recomputed from the items, so the two described different
   * numbers for a basket restored from storage and not yet edited. Every
   * persisted total written before the exact helper landed is plain
   * `Σ totalPrice × quantity` double arithmetic, so a stored `1002.0099999…`
   * whose items recompute to exactly `1002.00` was shown as `1,002.01` under
   * the word "Total to pay" — an old estimate presented as authoritative,
   * beside a label that was describing some other number. Both now read the
   * same `totalState` call, so the label cannot disagree with the figure.
   *
   * NO STORED BASKET IS MIGRATED. The persisted value is simply not what the
   * screen reads; the first mutation rewrites it through the same helper
   * anyway. The estimate branch is the same arithmetic the legacy total used,
   * so a legacy basket still shows the number it showed — only the claim made
   * about it changes.
   *
   * Memoised on the basket's identity and revision for the same reason
   * `review` is: four template reads should cost one pass, not four.
   */
  private totalCacheFor: { basket: unknown; revision: number } | null = null;
  private totalCache: { amount: number; exact: boolean } | null = null;

  private get total(): { amount: number; exact: boolean } {
    const basket: unknown = this.basketService.Basket() ?? null;
    const revision = this.basketService.revision();
    if (
      this.totalCache === null ||
      this.totalCacheFor === null ||
      this.totalCacheFor.basket !== basket ||
      this.totalCacheFor.revision !== revision
    ) {
      this.totalCacheFor = { basket, revision };
      this.totalCache = this.basketService.totalState(this.basketItems);
    }
    return this.totalCache;
  }

  get totalAmount(): number {
    return this.total.amount;
  }

  /**
   * Can this basket's own total be stated exactly, before the server prices it?
   *
   * FALSE MEANS ESTIMATE, NOT ERROR. Checkout is deliberately not blocked: the
   * server prices the order and the review sheet states the SERVER's amount,
   * which is the only figure the diner ever confirms. What changes is what the
   * screen claims — an amount the client has established it cannot represent
   * is labelled an estimate rather than presented as the amount payable.
   */
  get totalIsExact(): boolean {
    return this.total.exact;
  }

  /** Pre-discount subtotal for the honest summary: the current total plus the savings
   *  already taken off (so subtotal − savings == total exactly). Named to avoid clashing
   *  with the per-line getSubtotal(item). */
  get cartSubtotal(): number {
    return this.totalAmount + this.getTotalSavings();
  }

  /** True when the table already has an order still working through the kitchen.
   *  Reads the shared live signal (kept fresh by the shell's poll, and set to
   *  true on an initiate 400), so checkout re-enables automatically once the
   *  kitchen serves the order — no refresh needed. */
  get tableHasOngoingOrder(): boolean {
    return this.navState.tableOngoingOrder();
  }

  constructor(
    private sessionStorage: SessionStorageService,
    private basketService: BasketService,
    private dinerSession: DinerSessionService,
    public loc: Location,
    private api: ApiService,
    private dialog: ConfirmDialogService,
    private router: Router,
    private toast: ToastService,
    private connectivity: ConnectivityService,
    private navState: MenuNavStateService,
    private checkout: CheckoutCoordinatorService
  ) {
    this.refreshTableContext();

    this.loadUpsellFromStorage();
  }

  ngOnInit(): void {
    this.upsellStorageSub = this.sessionStorage.StorageValue.subscribe((key: any) => {
      // StorageValue emits the prefixed key (e.g. "[dinify-diner-app]upsellConfig").
      // Use includes() for prefix-agnostic matching — mirrors menu.component.ts:63.
      if (typeof key !== 'string') return;
      // THE TABLE THE DINER IS AT CAN CHANGE UNDER A MOUNTED INSTANCE, and
      // this is the notification that says so — `getTableDetails` writes both
      // keys through the same service on every scan. See
      // `refreshTableContext` for why a constructor snapshot was not enough.
      if (this.storageKeyIs(key, 'Table')
          || this.storageKeyIs(key, 'restaurant')) {
        this.refreshTableContext();
      }
      if (!key.includes('upsellConfig')) return;
      this.loadUpsellFromStorage();
    });
    this.resumeInterruptedCheckout();
  }

  /**
   * Does this `StorageValue` emission name exactly `key`?
   *
   * The subject emits the PREFIXED key, so the prefix has to be tolerated —
   * but `includes()` is too loose for the two keys below: it would also fire
   * on any future key that merely CONTAINS `Table` or `restaurant`, and
   * re-reading the diner's table because something unrelated was written is
   * not a behaviour worth inheriting. (The `upsellConfig` test above keeps
   * `includes()` deliberately: it is pre-existing, has no such neighbour, and
   * widening this change to it would put an untested edit in a path this fix
   * is not about.)
   */
  private storageKeyIs(emitted: string, key: string): boolean {
    return emitted === key || emitted.endsWith(`]${key}`);
  }

  /**
   * Re-read the table and restaurant this component is acting for.
   *
   * THE CONSTRUCTOR SNAPSHOT WAS NOT ENOUGH, and the desktop sidebar is where
   * that showed. It is mounted inside `@if (table)` on the diner shell, so an
   * in-app rescan from table A to table B moves that value from truthy to
   * truthy and the block never tears down — the sidebar is never
   * re-instantiated, its constructor never re-runs, and it went on reporting
   * table A while the diner sat at table B.
   *
   * FIVE consumers read these two fields, which is why the fix belongs on the
   * fields rather than on any one of them: the header the diner reads
   * (`Table {{ table?.number }}`), `editItem`'s link back to the menu,
   * `checkoutContext()` — itself the reservation scope, the quote-staleness
   * stamp, `ownsRecovery` and `ownsDisplayedCart` — and the table and socials
   * carried to the confirmation screen.
   *
   * **THEY MUST MOVE TOGETHER.** Refreshing only the cleanup guard would
   * compare a live table against a record reserved under the stale one and
   * refuse to clear a basket the operation genuinely owns — a stale-scope gap
   * turned into a broken checkout. One source of truth (the store the shell
   * writes) is what keeps reserve, stamp and guard agreeing.
   */
  private refreshTableContext(): void {
    this.table = this.sessionStorage.getItem<TableScan>('Table');
    this.restaurant =
      this.sessionStorage.getItem<Restaurant>('restaurant') as any;
  }

  /**
   * WHAT HAPPENED TO THE CHECKOUT THIS TAB WAS IN THE MIDDLE OF? (D04/D)
   *
   * A reload during a submission used to end at nothing: the key was in
   * memory, so it went with the page, and the diner's only option was to
   * place the order again and hope. The persisted attempt is resolved against
   * the server's own read, which is scoped to the table session — so this can
   * only ever surface an order on the table the diner is sitting at.
   *
   * IT ONLY RUNS ON THE ROUTED PAGE. The desktop sidebar is mounted on every
   * diner screen, so recovering there too would issue the same read twice per
   * load and let two instances narrate one outcome.
   *
   * NOTHING IS DECIDED SILENTLY. An accepted order is announced and the
   * finished basket cleared; a draft is left exactly as it is, for the diner
   * to review again; `absent` means the attempt never reached the server and
   * the key is dropped so the next checkout starts clean. `unknown` — an
   * unreachable server — changes NOTHING and keeps the key, because a server
   * that could not be asked is not evidence that nothing happened, and
   * treating it as such is how a recovery mechanism creates the duplicate it
   * exists to prevent.
   */
  private resumeInterruptedCheckout(): void {
    if (this.sidebar) return;
    const stored = this.checkout.read();
    if (stored.kind === 'none') return;

    // A COMPLETED CHECKOUT THAT DID NOT FINISH TIDYING UP. The outcome was
    // recorded durably before any cleanup, precisely so this case announces
    // the order rather than re-enquiring about one already in the kitchen.
    if (stored.kind === 'record' && stored.record.stage === 'accepted'
        && stored.record.outcome) {
      // R2 — AND IT IS STILL ONLY THE OWNER OF THIS CART. A restored terminal
      // record is evidence about a PAST purchase; it is not permission to
      // erase whatever is on screen now. This branch went straight to
      // `finishAcceptedCheckout()` with no owner at all.
      this.recovered = { kind: 'accepted', order: null, correlation: null };
      this.finishAcceptedCheckout(null, this.checkout.ownerOf(stored.record));
      return;
    }

    // C1 — A CLOSURE ALREADY ESTABLISHED NEEDS NO SERVER READ.
    //
    // CACHED RESTORATION, the same shape as the settled-acceptance branch
    // above and for the same reason: the fact was recorded durably precisely
    // so a reload states it rather than re-discovering it. Asking again would
    // be a round trip whose answer this client already holds — and on a server
    // that cannot be reached it would produce `unknown`, which BLOCKS the
    // checkout and offers a Retry, for a purchase whose remedy is a review.
    const restored = stored.kind === 'record'
      ? this.checkout.closureOf(stored.record).evidence
      : { kind: 'absent' as const };
    if (restored.kind === 'closure') {
      this.recovered = {
        kind: 'closed', order: null, correlation: null,
        closure: restored.closure,
      };
      return;
    }
    // E1 — AND A STORED CLOSURE THIS BUILD CANNOT ACT ON IS ITS OWN STATE,
    // never silence. Falling through here would offer Checkout for a purchase
    // whose key is bound to an order the server has retired.
    if (restored.kind !== 'absent') {
      this.recovered = null;
      return;
    }

    // GATE B — WHAT THIS RECOVERY BELONGS TO, captured before it is sent.
    // A held answer landing after the diner has edited, moved table or
    // started a permitted new attempt must not clear the newer state.
    const owner = this.recoveryOwner();
    this.checkout.recover().subscribe((outcome) => {
      if (!this.ownsRecovery(owner)) return;
      this.recovered = outcome;
      switch (outcome.kind) {
        case 'accepted':
          // DEFINITIVE, and the only outcome that finishes anything.
          this.finishAcceptedCheckout(outcome.correlation, owner);
          return;
        case 'closed':
          // C1 — REMEMBER IT, AND ATTEMPT NOTHING. The server has stated
          // durably that this quote can never be accepted; the record is
          // updated so the sidebar, the next reload and the diner's explicit
          // review all read one established fact. NO acceptance is issued and
          // NO successor is minted here: minting one is a purchase decision
          // and belongs to a deliberate tap, not to a page load.
          //
          // O1 — AND THE WRITE IS CHECKED. This ignored its return, so a
          // store that silently dropped it left the diner reading "review
          // your updated order" above a record that still said nothing about
          // a closure — and the review would then find none and price again
          // under the retired key. A failed write claims nothing.
          if (!this.checkout.noteClosure(outcome.closure)) {
            this.recovered = { kind: 'unknown' };
          }
          return;
        case 'accepted-unrecorded':
          // GATE B — UNKNOWN EVIDENCE STAYS UNRESOLVED. `evidence_unavailable`
          // is the server stating it CANNOT DETERMINE whether the submission
          // landed. This used to share the accepted branch, which clears the
          // basket AND DELETES THE RECORD — so the one outcome that most
          // needs a durable handle was the one that destroyed it, and the
          // next reload started clean with permission to order again.
          //
          // Nothing is cleared now. A second checkout is still refused
          // (`checkoutBlocked`), which is the actual protection; deleting the
          // basket was a SUBSTITUTE for blocking, not a form of it.
          return;
        default:
          // EVERY OTHER OUTCOME KEEPS THE RECORD. `absent` included, and that
          // is the change: one momentary observation must not discard the
          // identity of a checkout whose outcome is still open, and even a
          // proven absence licenses a SAME-KEY, SAME-REQUEST replay rather
          // than a new key. `draft`, `unknown`, `unsupported`, `unauthorized`,
          // `uncorrelated` and `blocked` all leave it exactly as it is.
          return;
      }
    });
  }

  /**
   * The one line a recovering diner reads. Deliberately not a redirect: a
   * diner who does not know what happened is the problem being solved.
   *
   * EVERY UNRESOLVED OUTCOME SAYS SO RATHER THAN SAYING NOTHING. Silence is
   * what the previous version gave for a server it could not reach, and a
   * blank screen beside a basket the diner may be about to re-order is the
   * worst of the available answers.
   */
  get recoveryNotice(): string | null {
    // E1 — AN UNUSABLE CLOSURE SAYS SO EVEN WHEN NO RECOVERY RAN. The
    // desktop sidebar never runs one, and a reload restores the record before
    // any read completes; `checkoutBlocked` already suppresses the CTA for
    // it, and a disabled button with no sentence beside it is the silence
    // this notice exists to remove.
    if (this.recovered?.kind !== 'inconsistent' && this.unusableClosure()) {
      return UNRESOLVED_CLOSURE_MESSAGE;
    }
    switch (this.recovered?.kind) {
      case 'accepted': {
        // GATE B — AN ACCEPTANCE AND WHAT HAPPENED AFTERWARDS ARE SEPARATE
        // FACTS. This said "it is with the kitchen" for every accepted
        // recovery, including one the kitchen had already cancelled — which
        // leaves a diner waiting for food nobody is cooking — and one
        // already served. The projection labels `current` apart from
        // `acceptance` precisely so the two need not be collapsed.
        switch (currentDisposition(this.recovered.correlation)) {
          case 'cancelled':
            return 'Your order was placed, but it has since been cancelled. '
              + 'Please check with staff.';
          case 'served':
            return 'Your order was placed and has already been served.';
          case 'live':
            return 'Your order was already placed — it is with the kitchen.';
          default:
            // No current state to read (a legacy acceptance, or a restored
            // local record). Say what IS known and claim nothing more.
            return 'Your order was already placed. Please check with staff '
              + 'if you have not received it.';
        }
      }
      case 'closed':
        // C1 — SAY WHAT HAPPENED AND NAME THE ACTION THAT WORKS. The draft
        // sentence below points at Retry, which here is a button whose every
        // press the server refuses; the footer offers "Review updated order"
        // instead, and this is the line above it. The reason-specific wording
        // lives in `updatedReviewPrompt`, beside that button, so the notice
        // stays one short statement rather than two copies of the same
        // sentence on one screen.
        return 'Your order could not be placed at the price you reviewed, and '
          + 'nothing has been sent to the kitchen.';
      case 'inconsistent':
        // E1 — THE SERVER SAID BOTH THINGS AT ONCE. Neither half may be
        // announced: "it is with the kitchen" would be a claim about an order
        // whose quote the same response says was retired, and "review your
        // order" would invite a replacement for one that may already be
        // cooking. The remedy is a person, and the record survives so a later
        // coherent read can still resolve it.
        return UNRESOLVED_CLOSURE_MESSAGE;
      case 'accepted-unrecorded':
        // NOT THE SAME SENTENCE, and the difference matters in the
        // dangerous direction. `evidence_unavailable` is the server saying
        // it CANNOT DETERMINE whether the submission landed: two producers
        // reach it — an acceptance predating the evidence table, and a
        // draft a kitchen write cancelled or advanced — and nothing on the
        // row separates them. Telling a diner their order is with the
        // kitchen when it was a cancelled draft leaves them waiting for
        // food nobody is cooking.
        //
        // THE ACTION ABOVE IS UNCHANGED AND STAYS CONSERVATIVE (the basket
        // is cleared, no second checkout is offered) precisely BECAUSE the
        // server does not know — one producer really is an order in the
        // kitchen. Only the claim is narrowed to what was actually
        // established, and the diner is pointed at the one party who can
        // resolve it.
        return 'Your order may already have been placed. Please check with '
          + 'staff before ordering the same items again.';
      case 'draft':
        // TWO DIFFERENT SITUATIONS BEHIND ONE WORD. Without an outstanding
        // command this is an ordinary unfinished order and reviewing it is
        // exactly right. WITH one, the diner already confirmed and the
        // acceptance did not reach the server — "review it again" would
        // point them at a button that is refused, so say what happened and
        // name the action that works.
        // GATE B — "DID NOT REACH US" ASSERTS NON-EXECUTION, and a draft
        // observed at one instant does not establish that. The honest
        // statement is that it is UNCONFIRMED and that retry re-sends the
        // same request under the same key, which is what actually happens.
        if (!this.outstandingCheckout()) {
          return 'We found your unfinished order. Please review it again.';
        }
        // AND A RETRY THAT CANNOT FIRE MUST NOT BE PROMISED. An outstanding
        // record whose command handle did not survive has nothing to re-send;
        // telling the diner to tap retry would point at a button that does
        // nothing, which is the dead end this notice exists to replace.
        return this.checkout.record()?.command
          ? 'We have not been able to confirm your order. Tap retry to send '
            + 'the same order again.'
          : 'We have not been able to confirm your order, and we cannot '
            + 'resend it from this device. Please check with staff before '
            + 'ordering the same items again.';
      case 'absent':
        // Same rule as `draft`: the server found no row for this key AT THIS
        // INSTANT. That licenses a same-key, same-request replay; it is not
        // a statement that nothing was received.
        return 'We could not confirm your last checkout. You can send the '
          + 'same order again.';
      case 'unauthorized':
        return 'We could not confirm your last order on this table. '
          + 'Please rescan the QR code.';
      case 'uncorrelated':
      case 'unsupported':
      case 'unknown':
        return "We're still confirming your last order. Please check with "
          + 'staff before ordering the same items again.';
      case 'blocked':
        return 'We could not read your last checkout on this device. '
          + 'Please check with staff before ordering again.';
      default:
        return null;
    }
  }

  /** True while an outcome the diner must resolve is outstanding — the CTA is
   *  suppressed rather than silently starting a second checkout. */
  get checkoutBlocked(): boolean {
    // E1 — A CLOSURE THIS BUILD CANNOT ACT ON BLOCKS, whether it arrived on a
    // live read or was restored from the record. It is not "no closure": the
    // key may be bound to an order the server has retired, so offering
    // Checkout would price under it, replay the retired order and loop.
    if (this.unusableClosure()) return true;
    switch (this.recovered?.kind) {
      case 'inconsistent':
      case 'uncorrelated':
      case 'unsupported':
      case 'unknown':
      case 'blocked':
        return true;
      case 'accepted-unrecorded':
        // GATE B — the basket is no longer cleared for this outcome, so the
        // CTA is what keeps a second checkout from being offered. That is
        // the actual protection; clearing the basket never was.
        return true;
      case 'closed':
        // DEFENCE IN DEPTH. The footer takes the review branch for a closed
        // quote (`updatedReviewPrompt`), so neither Checkout nor Retry is
        // rendered — but a getter that decides whether a second checkout may
        // be OFFERED must not depend on a template ordering to be right.
        return true;
      case 'draft':
        // A DRAFT IS ORDINARILY REVIEWABLE — unless this client already
        // issued an acceptance for it, in which case `reserveIntent` will
        // refuse a fresh checkout as `outstanding` and the only correct
        // next step is to replay the command that is already out there.
        // Offering Checkout there was a button whose every press was
        // rejected; Retry is the one that resolves it.
        return this.outstandingCheckout();
      default:
        return false;
    }
  }

  /** Does this device hold an acceptance it has not resolved? */
  private outstandingCheckout(): boolean {
    const record = this.checkout.record();
    return !!record && this.checkout.isOutstanding(record);
  }

  /**
   * Finish a checkout the server has confirmed landed.
   *
   * THE RECORD IS DROPPED LAST. Announcing first and clearing after means a
   * failure in between leaves a record that still says "accepted", which a
   * reload reads correctly — the other order leaves a diner being asked about
   * an order that is already cooking.
   */
  private finishAcceptedCheckout(
    correlation: CheckoutCorrelation | null = null,
    owner: CheckoutOwner | null = null,
  ): void {
    // GATE B — THE RESULT IS RECORDED BEFORE ANY CLEANUP, on this path too.
    // The submit handler already did this; a recovery-DISCOVERED acceptance
    // went straight to clearing, so a process dying mid-teardown came back
    // with no record and re-enquired about an order already in the kitchen.
    //
    // THE ORDER ID COMES FROM WHICHEVER SOURCE ACTUALLY HAS ONE. A level-3
    // answer names it; a LEVEL-2 server says only `accepted: true`, which is
    // still definitive (it is set from a durable evidence row) — so the id
    // is the one this client issued. What is NOT carried across is the
    // reference and the moment: a level-2 server states neither, and
    // substituting the reference we SENT for the one the server CONFIRMED
    // would conflate an issued command with an accepted one. Null is the
    // honest value, and `TerminalOutcome` allows it.
    const record = this.checkout.record();
    const orderId = correlation?.orderId ?? record?.command?.orderId ?? null;
    let recorded: boolean;
    if (record?.outcome != null) {
      recorded = true;                     // already durable; nothing to add
    } else if (orderId) {
      recorded = this.checkout.recordOutcome({
        kind: 'accepted',
        orderId,
        orderNumber: null,
        quoteRef: correlation?.acceptance.quoteRef ?? null,
        acceptedAt: correlation?.acceptance.acceptedAt ?? null,
        at: Date.now(),
      });
    } else {
      // NO LOCALLY ISSUED COMMAND AND NO NAMED ORDER. The server may have
      // established that the order was accepted elsewhere — a copied tab —
      // and that fact is presented without inventing a local acceptance
      // action for it. There is no outstanding command to protect, so the
      // attempt may be forgotten.
      recorded = !record || !this.checkout.isOutstanding(record);
    }

    // R2 — THE CART IS CLEARED ONLY BY THE OPERATION THAT OWNS IT. An
    // acceptance is authoritative about the purchase it accepted, never about
    // whatever the diner has put in the basket since. The two facts are kept
    // apart: the outcome is still recorded and still announced above, because
    // losing a real acceptance would be as wrong as erasing a cart that was
    // never part of it.
    if (this.ownsDisplayedCart(owner)) this.basketService.clearBasket();
    // CLEANUP ONLY ON A RECORDED OUTCOME — the same rule the submit path
    // applies. A store that silently drops writes must not lose the accepted
    // outcome while the REMOVAL succeeds, which would leave a reload free to
    // start a second checkout for an order already being cooked.
    if (recorded) this.checkout.clearIntent();
  }

  /**
   * A snapshot of what an in-flight recovery is ABOUT.
   *
   * GATE B — DELAYED CALLBACKS CARRY IMMUTABLE OPERATION OWNERSHIP. The
   * recovery paths performed destructive cleanup without checking that the
   * record and scope they captured were still the current ones, so an answer
   * held open across an edit or a table move cleared state it never owned.
   * Deliberately not a re-read of the CURRENT record: comparing a response
   * against whatever storage says now is what makes a stale answer look
   * authoritative.
   */
  private recoveryOwner(): CheckoutOwner | null {
    const record = this.checkout.record();
    return record ? this.checkout.ownerOf(record) : null;
  }

  /** R2 — QUESTION TWO, asked in ONE place so every consumer asks it the
   *  same way: does this operation own the cart on screen? Nothing else is
   *  a licence to clear it — an edit re-reserves nothing, so the key and the
   *  scope are both unchanged while the cart is no longer the purchase that
   *  was accepted.
   *
   *  OWNERSHIP IS SCOPE **AND** CONTENTS, and the two conditions catch
   *  opposite mistakes. Contents alone cleared an identical-looking basket at
   *  another table: the receipt said one dish in one configuration, the cart
   *  in front of the diner said the same, and on a single restaurant's menu
   *  that coincidence is ordinary rather than rare. The scope comparison
   *  existed but lived in `ownsRecovery`, which the cached-terminal branch
   *  does not go through — so this is the missing intersection of two
   *  protections that were each already correct, not a new product rule.
   *
   *  It belongs HERE rather than at that one branch, because this is the
   *  common predicate guarding every destructive cleanup in this file
   *  (startup recovery, Retry, the restored terminal record, resend and the
   *  direct submit); fixing the caller would leave the shared answer wrong
   *  for whichever consumer is added next.
   *
   *  NO SERVER READ IS NEEDED to decide it. Unequal scopes cannot share cart
   *  ownership whatever any response says, and settlement is a SEPARATE
   *  question (`settles`) that is deliberately left alone: an acceptance for
   *  another table stays recorded and still announces itself — losing a real
   *  acceptance would be as wrong as erasing a cart it never contained. */
  private ownsDisplayedCart(owner: CheckoutOwner | null): boolean {
    if (!owner || this.destroyed) return false;
    return owner.scope === this.checkoutContext()
      && this.checkout.ownsPurchase(
        owner, this.basketService.contentIdentity());
  }

  private ownsRecovery(owner: CheckoutOwner | null): boolean {
    if (!owner || this.destroyed) return false;
    // R2 — MAY THIS ANSWER SETTLE THE OPERATION IT WAS ABOUT? Deliberately
    // NOT "and may it clear the cart": that is a second question with a
    // second answer (`ownsDisplayedCart`), and collapsing the two is what let
    // a cart-only edit lose its own contents.
    return this.checkout.settles(owner)
      && owner.scope === this.checkoutContext();
  }

  ngAfterViewInit(): void {
    window.addEventListener('resize', this.onResize);
    setTimeout(() => this.checkScroll(), 0);
  }

  ngOnDestroy(): void {
    // R2 — A DESTROYED INSTANCE OWNS NOTHING. Angular does not cancel an HTTP
    // request when a component is destroyed, so a recovery or resend opened by
    // a routed instance the diner has navigated away from still lands — and
    // used to run its own completion beside the live instance's. Both guards
    // below read this.
    this.destroyed = true;
    // ...AND IT CANNOT GIVE THE FLIGHT BACK LATER, SO IT GIVES IT BACK NOW.
    //
    // The flight is APP-WIDE and SINGLE, and `placingOrder` is a getter over
    // it — that is the whole point of D04/D, so the routed page and the
    // desktop sidebar cannot disagree about whether a checkout is running.
    // But every release site is a method on the instance that CLAIMED it, so
    // a token still held here is held forever: the sidebar (which lives
    // beside the router outlet and is never destroyed) and every later basket
    // instance keep a disabled Checkout button until the page is reloaded.
    //
    // `renewQuote` is the path that reached it. Its `mine()` guard returns on
    // BOTH callbacks once this instance is gone — correctly, an answer must
    // not place an order for a screen the diner has left — but nothing then
    // released the claim `confirmQuote` took before issuing the enquiry.
    // `placeOrder` and `submitOrder` both discard through `releaseIfLatest`,
    // which releases; that path had no equivalent.
    //
    // IT BELONGS HERE RATHER THAN AT THAT GUARD, and the difference is
    // load-bearing. A destroyed instance can have no NEWER operation, which
    // is what makes an unconditional release safe. At the guard, the other
    // way `mine()` goes false is that THIS instance moved the record on to a
    // newer attempt — and `holdCheckout()` is idempotent per instance, so
    // that attempt holds the SAME token. Releasing there would free a LIVE
    // flight, the exact hazard `releaseIfLatest` exists to avoid.
    //
    // NO DUPLICATE PROTECTION IS DROPPED. The flight is a UI single-flight;
    // what prevents a second order is the durable record and the idempotency
    // key, and both survive a destroyed instance untouched. A surface that
    // presses Checkout while an acceptance issued here is genuinely still in
    // flight is answered `outstanding` by `reserveIntent` and told the
    // checkout is still being confirmed — which is what a diner needs, rather
    // than a button that never comes back.
    this.releaseCheckout();
    this.upsellStorageSub?.unsubscribe();
    window.removeEventListener('resize', this.onResize);
  }

  get showArrows(): boolean {
    return this.upsellItems.length > 1;
  }

  checkScroll(): void {
    const el = this.upsellCarousel?.nativeElement;
    if (!el) {
      this.canScrollLeft = false;
      this.canScrollRight = false;
      return;
    }
    this.canScrollLeft = el.scrollLeft > 5;
    this.canScrollRight = el.scrollLeft < el.scrollWidth - el.clientWidth - 5;
  }

  /**
   * Reads upsellConfig from session storage and recomputes the upsell carousel.
   * Called once at construction and again whenever the menu component writes
   * a fresh config after its show-menu API call resolves.
   */
  private loadUpsellFromStorage(): void {
    const upsellRaw = this.sessionStorage.getItem<any>('upsellConfig');
    if (upsellRaw?.enabled && upsellRaw?.items?.length > 0) {
      this.upsellConfig = upsellRaw;
      this.computeUpsellItems();
    } else {
      this.upsellConfig = null;
      this.upsellItems = [];
    }
  }

  // Filters and trims the upsell list based on config + current basket state
  computeUpsellItems(): void {
    if (!this.upsellConfig) { this.upsellItems = []; return; }

    let items = [...(this.upsellConfig.items || [])];
    items.sort((a: any, b: any) => (a.listing_position || 0) - (b.listing_position || 0));
    items = items.filter((i: any) => i.item_available !== false);

    if (this.upsellConfig.hide_out_of_stock) {
      items = items.filter((i: any) => i.item_in_stock !== false);
    }
    if (this.upsellConfig.hide_if_in_basket) {
      const basketIds = new Set(this.basketItems.map(bi => bi.itemId));
      items = items.filter((i: any) => !basketIds.has(i.item_id || i.menu_item));
    }
    this.upsellItems = items.slice(0, this.upsellConfig.max_items_to_show || 6);
    setTimeout(() => this.checkScroll(), 0);
  }

  onUpsellImageLoad(itemId: string): void {
    this.imageLoaded[itemId] = true;
  }

  onUpsellImageError(itemId: string): void {
    this.imageErrored[itemId] = true;
    this.imageLoaded[itemId] = true;
  }

  /** Broken-thumbnail tracking for the basket line rows (keyed by row index) —
   *  a 404'd photo falls back to the "No img" placeholder instead of a torn glyph. */
  rowImageErrored: Record<number, boolean> = {};
  onRowImageError(idx: number): void {
    this.rowImageErrored[idx] = true;
  }

  // Adds an upsell item to the basket (simple items — no modifiers/extras)
  addUpsellItem(upsellItem: any): void {
    const original = parseFloat(upsellItem.item_price) || 0;
    const discounted =
      upsellItem.item_discounted_price != null
        ? parseFloat(upsellItem.item_discounted_price)
        : null;
    // Only treat as discounted when the flag is set AND a valid lower price is present.
    const isDiscounted =
      !!upsellItem.item_running_discount && discounted != null && discounted < original;
    const basePrice = isDiscounted ? (discounted as number) : original;

    this.basketService.addItem({
      itemId: upsellItem.item_id || upsellItem.menu_item,
      itemName: upsellItem.item_name,
      image: upsellItem.item_image || undefined,
      basePrice,
      totalPrice: basePrice, // upsell items have no modifiers/extras
      quantity: 1,
      selectedModifiers: [],
      extras: [],
      isDiscounted,
      originalBasePrice: isDiscounted ? original : undefined,
      discountAmount: isDiscounted ? original - basePrice : undefined,
      discountPercentage: isDiscounted
        ? (Number(upsellItem.item_discount_percentage) ||
           Math.round((1 - basePrice / original) * 100))
        : undefined,
    } as any);
    this.updateCart();
  }

  // Increments the quantity of the basket line at `index` (by index, not identity).
  incrementItem(index: number): void {
    // The per-line ceiling is the SUBMITTED maximum: stop here rather than let
    // the whole order be refused at the server. Decrement is never blocked, so
    // a restored over-limit basket can always be brought back down.
    if (this.atLineCeiling(index)) return;
    this.basketService.incrementItem(index);
    this.updateCart();
  }

  // Navigates to the item-detail page in edit mode. The detail page reads
  // `editingIndex` from the query params and rebuilds the prior selections
  // from the basket entry at that index.
  editItem(index: number): void {
    const item = this.basketItems[index];
    if (!item) return;
    const tableId = this.table?.id ?? '';
    this.router.navigate(menuItemUrl(tableId, item.itemId), {
      queryParams: { editingIndex: index },
    });
  }

  // Decrements the quantity of the basket line at `index`; removes it at 0.
  decrementItem(index: number): void {
    this.basketService.decrementItem(index);
    this.updateCart();
  }

  // Updates basketItems and totalAmount after adding/removing items
  updateCart() {
    // A basket change starts a fresh order (new client_order_id), so drop any
    // stale placement error and let the diner check out cleanly again.
    this.orderError = false;
    this.computeUpsellItems();
  }

  scrollUpsells(direction: 'left' | 'right'): void {
    const el = this.upsellCarousel?.nativeElement;
    if (!el) return;
    const firstChild = el.firstElementChild as HTMLElement | null;
    if (!firstChild) return;
    const itemWidth = firstChild.offsetWidth + 12;
    el.scrollBy({ left: direction === 'left' ? -itemWidth : itemWidth, behavior: 'smooth' });
  }

  // Opens the confirm dialog, then places the order on confirmation. When the
  // diner is already offline we skip the doomed round-trip (and the doomed
  // confirm dialog) and surface the inline error straight away — the ambient
  // offline strip already explains why.
  /**
   * Ask the server to price this basket, then show the diner THAT.
   *
   * THERE IS NO LONGER A PRE-PRICING CONFIRM DIALOG. It asked "are you sure?"
   * about a number this browser had computed, and placement then auto-submitted
   * whenever nothing happened to be sold out — so the server's amount was never
   * shown before the order was accepted. Correct calculation is not agreement to
   * an amount. Every order now gets exactly ONE confirmation and it is always
   * the server's: this replaces a dialog rather than adding a second one.
   */
  initiateOrder() {
    // A DELIBERATE PRESS CLEARS THE RETIRED NOTICE, and `placeOrder` does not.
    // The re-price that follows a retirement goes through `placeOrder`, so
    // resetting it there would erase the notice before the new review sheet
    // that is meant to carry it has rendered. This is the diner starting a
    // checkout of their own accord, which is when the previous quote's fate
    // stops being news.
    this.quoteRetired = false;
    // AND IT OPENS A NEW CHECKOUT EPISODE (G3b). The renewal guard below is
    // per-episode rather than per-request precisely so a re-price cannot reset
    // it: `placeOrder` is what the terminal branch calls, so resetting there
    // would let a server that keeps answering "closed" drive an unbounded
    // mint-and-retry loop. A deliberate press is the diner starting again.
    // Hard stop: the table already has an order in the kitchen. The CTA is
    // disabled in this state, so this is just defense in depth.
    if (this.tableHasOngoingOrder) return;
    if (this.limitState.breach) {
      this.failOrder(this.limitState.message);
      return;
    }
    if (this.connectivity.isOffline()) {
      this.failOrder("You're offline — reconnect to place your order.");
      return;
    }
    this.placeOrder();
  }

  /**
   * Re-attempt a failed placement without re-opening the confirm dialog.
   *
   * IT REPLAYS THE COMMAND THAT WAS ISSUED, IT DOES NOT PLACE A NEW ONE. The
   * previous version called `placeOrder()` unconditionally, which rebuilds
   * the request from the LIVE basket and re-runs `initiate` — so a retry
   * after an uncertain ACCEPTANCE asked the server a different question from
   * the one whose answer was lost, and any basket edit in between silently
   * changed what was being retried. Where the record carries an issued
   * command, this resolves THAT: the same order id and the same reference,
   * under the same key.
   */
  retryOrder() {
    if (this.connectivity.isOffline()) {
      this.failOrder("You're offline — reconnect to place your order.");
      return;
    }
    const record = this.checkout.record();
    if (record && this.checkout.isOutstanding(record)) {
      this.replayIssuedCommand(record);
      return;
    }
    // GATE B — A RETRY IS NOT AN EDIT. A reserved purchase whose INITIATE
    // response was lost still holds the lines that were sent, so re-send
    // THOSE under the SAME key. `placeOrder` would rebuild the body from the
    // live basket, which after any edit asks the server a different question
    // from the one whose answer was lost — and mints a different key for it.
    //
    // The approved distinction is preserved: a deliberate edit followed by
    // CHECKOUT still begins a new purchase, because that path goes through
    // `placeOrder`. Only Retry is bound to what was issued.
    // R2 — AND ONLY INTO THE SCOPE IT WAS PRICED FOR. `isReplayableInitiation`
    // classifies the RECORD; it knows nothing about the table the diner is at
    // now. Issuing the old purchase here and discovering the mismatch from the
    // response is a mutation made in the wrong scope — and there is nothing to
    // recover by doing so, since `reserveIntent` mints a fresh key for the new
    // scope and `placeOrder` below starts a clean purchase at this table.
    if (record && record.scope === this.checkoutContext()
        && this.checkout.isReplayableInitiation(record)) {
      this.replayInitiation(record);
      return;
    }
    this.placeOrder();
  }

  /**
   * Re-send the initiation that was already issued under this key.
   *
   * Deliberately NOT `placeOrder`: no re-reservation, no rebuild, no new
   * attempt identity beyond the sequence guard. The key and the body both
   * come from the record, so the server sees the same request twice and its
   * idempotency binding does the rest.
   */
  private replayInitiation(record: CheckoutRecord): void {
    if (!this.holdCheckout()) return;
    this.orderError = false;
    this.recovered = null;
    this.attemptSeq += 1;
    const attempt = {
      seq: this.attemptSeq,
      revision: this.basketService.revision(),
      context: record.scope,
    };
    this.activeAttempt = attempt;

    this.checkout.bounded(
      this.api.postPatch(
        'orders/initiate/',
        { client_order_id: record.key, items: record.request.items },
        'post', null, {}, false, 'v2'),
    ).subscribe(
      (response: any) => {
        if (!this.isCurrent(attempt)) {
          this.releaseIfLatest(attempt);
          return;
        }
        if (response?.status === 200) {
          this.order_initiated = response.data;
          const od = this.order_initiated?.order_details;
          this.checkout.noteProtocol(protocolLevel(od));
          // AND THE D06 LEVEL (G4), remembered for the same reason and kept
          // apart because the two are separate promises that move
          // independently. It is what makes a LATER response's silence about a
          // closure readable as "not retired" rather than "this server has
          // never said".
          this.checkout.noteQuoteProtocol(quoteProtocolLevel(od));
          this.reviewedQuote = {
            ref: od?.quote_ref ?? null,
            revision: attempt.revision,
            context: attempt.context,
            key: this.checkout.record()?.key ?? null,
          };
          this.checkout.noteStage('reviewing');
          this.showQuoteSheet = true;
        }
        this.releaseCheckout();
      },
      (error) => {
        if (!this.isCurrent(attempt)) {
          this.releaseIfLatest(attempt);
          return;
        }
        this.releaseCheckout();
        this.failOrder(this.placementErrorMessage(error));
      },
    );
  }

  /**
   * Resolve an acceptance that was issued and never settled.
   *
   * ASK FIRST, RE-SEND ONLY ON A PROVEN ABSENCE. Reading the key is cheap and
   * cannot duplicate anything; re-sending is safe too (the server binds the
   * key), but asking first means the common case — the acceptance DID land —
   * is answered without another write, and the diner is told what happened
   * rather than watching a second attempt.
   */
  private replayIssuedCommand(record: CheckoutRecord): void {
    if (!this.holdCheckout()) return;
    this.orderError = false;
    // R2 — RETRY IS A CONSUMER OF THE SAME RULE, and had no guard at all:
    // only the startup path captured an owner, so a Retry answer held across
    // an edit or a table move completed unconditionally.
    const owner = this.checkout.ownerOf(record);
    this.checkout.recover().subscribe((outcome) => {
      if (!this.ownsRecovery(owner)) {
        this.releaseCheckout();
        return;
      }
      this.recovered = outcome;
      this.releaseCheckout();
      switch (outcome.kind) {
        case 'accepted':
          this.finishAcceptedCheckout(outcome.correlation, owner);
          return;
        case 'accepted-unrecorded':
          // Gate B, exactly as in the resume path: the server cannot
          // determine whether it landed, so nothing is cleared.
          return;
        case 'closed':
          // C1 — THE DEAD END THIS WHOLE CHANGE IS ABOUT. `draft` below
          // re-sends the recorded command, which is right when the only fact
          // is that the acceptance did not commit. Here the server has ALSO
          // recorded that the quote can never be accepted, so the re-send can
          // only be refused — and its refusal files as `unknown`, offering
          // Retry, which returns to exactly this point.
          //
          // O1 — AND THE WRITE IS CHECKED, for the reason the startup path
          // records: an unverified closure is not an established fact.
          if (!this.checkout.noteClosure(outcome.closure)) {
            this.recovered = { kind: 'unknown' };
          }
          return;
        case 'absent':
        case 'draft':
          // BOTH ARE PROOF THE ACCEPTANCE DID NOT LAND, so both re-send the
          // SAME command under the SAME key — never a fresh one, which is
          // the whole point of having recorded it.
          //
          // `absent`: no row for this key at a scope the server resolved
          // itself. `draft`: a level-3 `not_accepted`, which is DEFINITIVE
          // and in fact the stronger evidence — the server names the order
          // and says it is still `initiated`, and the backend writes its
          // acceptance row in the SAME transaction as the transition, so
          // "still a draft, no evidence" means the acceptance did not
          // commit. It is also the LIKELIER case: a request that never
          // arrives leaves behind the draft `initiate` already created, so
          // recovery finds that draft rather than nothing.
          //
          // This branch previously did nothing, and doing nothing was a
          // DEAD END rather than a pause: the record still held a command,
          // so Checkout was refused as `outstanding` and Retry returned
          // here to no-op again, leaving the diner permanently unable to
          // submit that order.
          //
          // BUT ONLY WHERE THE HANDLE SURVIVED. This used to dereference
          // `record.command!` on the strength of an invariant that no longer
          // holds: `isOutstanding` required a non-null command until the
          // durability gate made it stage-based, precisely so that a record
          // whose handle was LOST stays protected. Such a record now reaches
          // here, and re-sending is not something it can do — there is no
          // order id to name. The recovery read above was still worth making
          // (it resolves an `accepted` outcome properly); what must not
          // happen is a mutation invented from a handle this build does not
          // have, or a crash instead of a preserved checkout (Codex P2 on
          // PR #665, valid).
          if (!record.command) return;
          this.resendIssuedCommand(record.command);
          return;
        default:
          // Draft, unreachable, unsupported, unauthorised or uncorrelated:
          // all unresolved. The record stands and the notice says so.
          return;
      }
    });
  }

  // Shared placement body for both the dialog-"yes" path and Retry. Posts the
  // current basket to orders/initiate/ and, when everything is still available,
  // commits straight away; otherwise it hands off to the unavailable-items sheet.
  /**
   * One renewal per checkout episode. See `initiateOrder`, which opens one.
   */

  /**
   * Is the server telling us this quote has been RETIRED?
   *
   * GATED ON THE STATED LEVEL, never on the key merely being present — the
   * same rule `readPublishedPolicy` applies to the deadline. A server that has
   * not said it publishes closures is not one whose silence means "not
   * closed", and treating an absent key as a verdict would make every older
   * backend look like it was answering a question it has never been asked.
   */
  private publishedClosureEvidence(orderDetails: any): ClosureEvidence {
    return readPublishedClosure(
      orderDetails,
      { quoteRef: this.checkout.record()?.command?.quoteRef ?? null },
      // E1 — THE LEVEL THIS SERVER HAS ALREADY DEMONSTRATED FOR THIS ATTEMPT,
      // read when the answer lands. A response that omits `quote_protocol`
      // after an earlier one published it has not become an older server, and
      // reading its silence as "no closure" is the convenient half.
      this.checkout.establishedQuoteProtocol(),
    );
  }

  /**
   * C1 — IS THIS ATTEMPT'S QUOTE RETIRED, AS AN ESTABLISHED DURABLE FACT?
   *
   * Read from the RECORD as well as from the live recovery, and the record is
   * what makes both mounts and a reload agree: the desktop sidebar never runs
   * recovery (it would issue the same read twice per load), so without the
   * persisted evidence it would go on offering Checkout for a purchase the
   * routed page has already established can never be placed.
   *
   * It clears itself: `renewAfterClosure` mints a successor carrying no
   * closure, so the moment the diner acts this reads false again.
   */
  private closedQuote(): QuoteClosure | null {
    if (this.recovered?.kind === 'closed') return this.recovered.closure;
    return usableClosure(this.storedClosure());
  }

  /** What the record says about its quote, through the ONE reading. */
  private storedClosure(): ClosureEvidence {
    const record = this.checkout.record();
    return record ? this.checkout.closureOf(record).evidence
      : { kind: 'absent' };
  }

  /**
   * E1 — A CLOSURE THIS BUILD MAY NOT ACT ON, or `null`.
   *
   * `unsupported` (a policy version this build has never seen) and
   * `malformed` are NOT "no closure". Reading them as absence re-prices under
   * a key bound to a retired order, replays it, is refused identically and
   * loops — so they get their own state: the attempt is kept, nothing is
   * minted, nothing is settled, and the diner is pointed at staff. A later
   * authorized read from a build that does know the version resolves it.
   */
  private unusableClosure(): ClosureEvidence | null {
    if (this.recovered?.kind === 'inconsistent') return this.recovered.evidence;
    const evidence = this.storedClosure();
    return evidence.kind === 'unsupported' || evidence.kind === 'malformed'
      ? evidence : null;
  }

  /**
   * The sentence above the one action a retired quote permits, or `null` when
   * no re-review is being offered.
   *
   * TWO PRODUCERS, ONE BUTTON. A LEGACY-priced draft and a retired quote are
   * different facts with the same remedy — get a fresh quote for the SAME
   * basket, having sent nothing to the kitchen — so they share the action and
   * differ only in what is said. The closure's own reason decides that, and a
   * policy version this build does not know falls back to the neutral wording
   * rather than claiming an expiry under a rule it cannot read.
   */
  get updatedReviewPrompt(): string | null {
    if (this.legacyDraft) {
      return 'Prices have been updated since you started. Review your order '
        + 'to continue — nothing has been sent to the kitchen.';
    }
    const closure = this.closedQuote();
    if (!closure) return null;
    if (closure.reason === 'purchase_needs_review') {
      return 'Something on your order changed, so it can no longer be placed '
        + 'as it was. Review your order to continue — nothing has been sent '
        + 'to the kitchen.';
    }
    if (closure.reason === 'quote_expired' && policyVersionSupported(closure)) {
      return 'This order was priced a while ago, so that price is no longer '
        + 'available. Review your order to continue — nothing has been sent '
        + 'to the kitchen.';
    }
    return 'This order can no longer be placed as it was. Review your order '
      + 'to continue — nothing has been sent to the kitchen.';
  }

  /**
   * Mint ONE new attempt for a purchase whose quote the server retired.
   *
   * Returns whether it is safe to go on and price again. The refusals are not
   * interchangeable and none of them is "try anyway":
   *
   *   superseded  the OTHER mount already renewed this exact record — which
   *               is the outcome this call wanted, so it proceeds. It does
   *               not mint a second key for one closure.
   *   none        nothing is persisted, so `reserveIntent` will mint a fresh
   *               key on its own. Proceeding is the renewal.
   *   outstanding an acceptance MAY be in flight. A renewal abandons the key
   *               that is the only way to resolve it, so this is exactly the
   *               case that must not proceed — the diner is asked to settle
   *               the outstanding checkout first.
   *   storage-error / blocked  a key nobody wrote down is not an idempotency
   *               key, and a record this build cannot read must not be
   *               reasoned about. Nothing is sent.
   */
  private renewAfterClosure(): boolean {
    // O1 — THE COORDINATOR DECIDES, FROM THE PERSISTED CLOSURE AND THE
    // PREDECESSOR IT CARRIES. This used to hand it a `QuoteClosure` the
    // caller was holding plus an optional record; omitting the record meant
    // "renew whatever is current", which is exactly how a mount holding a
    // stale refusal for K1 could abandon a K2 another mount had established.
    // Nothing is passed now, so there is nothing to pass staleley.
    const renewal = this.checkout.renewAfterClosure();
    if (renewal.kind === 'ready' || renewal.kind === 'superseded'
        || renewal.kind === 'none') {
      return true;
    }
    this.releaseCheckout();
    this.onReservationRefused(renewal);
    return false;
  }

  /**
   * O1 — RECORD A CLOSURE THIS CLIENT HAS JUST LEARNED, AND STOP.
   *
   * THE THREE AUTOMATIC RENEWALS ARE GONE. A refused submission, an initiate
   * that handed back a retired order and an enquiry answered `quote_closed`
   * all used to mint a successor key and immediately re-price, inside the
   * response handler that learned of the closure. Minting an idempotency key
   * is the most consequential thing this client does with one, and doing it
   * as a side effect of reading a response means it happens on whatever
   * record is current at that instant — the stale-mount hazard — and without
   * the diner having asked for anything.
   *
   * What each of them does now is the same three steps, in order: establish
   * the closure DURABLY (verified, because a key nobody wrote down is not an
   * idempotency key), surface the one action that works, and wait for the
   * diner to take it. `reviewUpdatedOrder` is that action and is the ONLY
   * renewal site left.
   *
   * Returns whether the closure is now established. `false` means the write
   * could not be verified: nothing is claimed, and the caller falls through
   * to its ordinary unresolved handling rather than promising a review.
   */
  private establishClosure(closure: QuoteClosure): boolean {
    if (!this.checkout.noteClosure(closure)) return false;
    this.quoteRetired = true;
    return true;
  }

  private placeOrder() {
    // SINGLE FLIGHT (D04/D). The desktop sidebar and the routed basket page
    // are two instances of this component; before the coordinator each had
    // its own `placingOrder`, so both could start a checkout at once. The
    // server refuses the second — same key and purchase returns the first
    // order, a different purchase is a conflict — so this is not the last
    // line of defence, but a client that cannot tell it is already checking
    // out shows two live buttons and can present no coherent outcome.
    if (!this.holdCheckout()) return;

    // C1 — NEVER PRICE UNDER A KEY THIS CLIENT KNOWS IS BOUND TO A RETIRED
    // QUOTE.
    //
    // `reserveIntent` hands the SAME key back for the same purchase, which is
    // exactly right until a closure is established: from then on that key
    // names an order the server has permanently refused, so an initiate under
    // it REPLAYS that order and comes back retired. It self-heals one wasted
    // round trip later at the initiate handler below — which is not a reason
    // to send a request whose answer is already known, the same judgement
    // `renewQuote` records for the enquiry's retired branch.
    //
    // THE UI DOES NOT REACH THIS: a closed record renders "Review updated
    // order" rather than Checkout or Retry, and that path renews first. This
    // is the guard for every other entry — a direct `retryOrder`, a future
    // caller, or a second mount acting on state the first established.
    // O1 — IT STOPS RATHER THAN RENEWING. Minting a key here would be a
    // purchase decision taken inside a guard, on behalf of a diner who
    // pressed Checkout. The established fact is already durable, so the
    // footer's "Review updated order" is rendered and the renewal happens
    // when they take it.
    if (this.closedQuote() || this.unusableClosure()) {
      this.quoteRetired = !!this.closedQuote();
      this.releaseCheckout();
      return;
    }

    this.orderError = false;
    this.legacyDraft = false;
    this.recovered = null;
    // Stamp this attempt with the basket revision AND the checkout context it
    // was priced for. A response that no longer matches both is discarded.
    this.attemptSeq += 1;
    const attempt = {
      seq: this.attemptSeq,
      revision: this.basketService.revision(),
      context: this.checkoutContext(),
    };
    this.activeAttempt = attempt;

    // RESERVE THE KEY, AND DO NOT SEND ANYTHING IF THAT FAILS.
    //
    // Two things changed here. The reservation is CHECKED: a storage that
    // refuses the write used to be swallowed and the key returned anyway, so
    // the next attempt read nothing back and minted a second key — the exact
    // duplicate the key exists to prevent, produced silently by the safety
    // mechanism. And an OUTSTANDING ACCEPTANCE is refused rather than
    // overwritten: the record of a command whose outcome is unsettled is the
    // only thing that can resolve it, and the old path destroyed it whenever
    // the basket or the table changed.
    // GATE B — THE LINES ARE BUILT ONCE AND STORED WITH THE RESERVATION, so
    // a later replay re-sends what was issued instead of rebuilding from a
    // basket that has moved on. Built before reserving for exactly that
    // reason: the record must carry the body it is the key for.
    const lines = this.buildOrderLines();
    const reservation = this.checkout.reserveIntent(
      { identity: this.basketService.contentIdentity(),
        canon: PURCHASE_CANON, items: lines },
      attempt.context,
    );
    if (reservation.kind !== 'ready') {
      this.activeAttempt = null;
      this.releaseCheckout();
      this.onReservationRefused(reservation);
      return;
    }

    const orderPayload = {
      // THE IDEMPOTENCY KEY, PERSISTED BEFORE THIS REQUEST IS SENT (D04/D).
      // Reused across retries of an unchanged basket at an unchanged table,
      // so a retried attempt returns the existing order instead of
      // duplicating it — and it now survives a reload, which is the single
      // most likely thing a diner does when a checkout appears stuck. The
      // coordinator mints a fresh one when the revision or the context
      // differs, so a changed basket is a new purchase by derivation rather
      // than by somebody remembering to reset it.
      // BOUND TO THE BASKET'S CONTENTS, not to `attempt.revision`. That
      // counter is a field on `BasketService` and restarts at 0 on every
      // page load while the basket itself is restored from storage — so a
      // reload made the persisted attempt look like a different basket and
      // minted a fresh key, defeating the persistence in exactly the case it
      // was added for.
      client_order_id: reservation.key,
      // No raw restaurant/table UUIDs: the backend derives both from the diner
      // table session (X-Diner-Session), so a foreign body id can't override the
      // scope of the order. The session is the sole authority.
      //
      // THE RESERVED LINES, not a second build. `reserveIntent` returns the
      // record this key belongs to — which for a reused key is the ORIGINAL
      // purchase — so the body and the key can never describe different
      // things.
      items: reservation.record.request.items ?? lines,
    };
    // API call to initiate the order
    // BOUNDED (D04/D). Without a ceiling, a connection that is open but dead
    // leaves the CTA spinning for as long as the browser keeps the socket —
    // indefinitely on a mobile network that has quietly gone away — and the
    // diner's only escape used to be the reload that lost the key. A timeout
    // is handled as any other lost response: the SAME key retries.
    this.checkout.bounded(
      this.api.postPatch(
        'orders/initiate/', orderPayload, 'post', null, {}, false, 'v2'),
    ).subscribe(
      (response: any) => {
        if (!this.isCurrent(attempt)) {
          // A LATE RESPONSE for a basket or a table the diner has moved on
          // from. It priced something they are no longer looking at, so it is
          // neither rendered nor submitted — and the draft it created is left
          // alone rather than cancelled, because this client cannot know it was
          // not something else's.
          this.releaseIfLatest(attempt);
          return;
        }
        if (response.status === 200) {
          this.order_initiated = response.data;
          const od = this.order_initiated?.order_details;
          // A SERVER THAT PRICES THE OLD WAY NAMES NO QUOTE, and that is not an
          // error. This client ships BEFORE the paired backend (see the release
          // order), so treating a missing reference as a failure would turn
          // every otherwise-successful checkout into one for the whole window —
          // an outage, from the change meant to make checkout truthful.
          //
          // What a legacy response cannot give is a NAME for the quote. It
          // still carries the server's own total, so the diner still reviews
          // and confirms the server's amount rather than this browser's, and
          // submit simply omits an acknowledgement that server never issued and
          // does not ask for. Once the corrected backend is live the reference
          // is always present, always sent, and its acceptance path requires it
          // — there is no client-side switch that can turn that off.
          // G3b — THE SERVER JUST HANDED BACK A RETIRED QUOTE.
          //
          // Reachable without any refusal being lost: the key is bound to a
          // purchase, so `initiate` REPLAYS the order it was used for, and
          // that order's quote may have been retired since — by a lost
          // refusal here, or by the other mount, or by `retire-quote`.
          // Rendering it would put a review sheet in front of the diner for
          // something that can never be placed.
          //
          // `quote_closure` is what makes this visible at all, and it is
          // gated on the level rather than on the key being present: a server
          // that has not said it publishes closures is not one whose silence
          // means "not closed". IT NO LONGER RENEWS, so the once-per-episode
          // bound this used to need is gone with it: the only renewal left is
          // a deliberate tap, and a successful one clears the persisted
          // closure, so a second tap mints nothing.
          const handedBack = this.publishedClosureEvidence(od);
          if (handedBack.kind === 'closure') {
            // O1 — ESTABLISH AND STOP. This used to mint a successor and
            // re-price immediately, which put a key mint inside a response
            // handler. The closure is recorded durably instead and the
            // footer offers the review; a failed write claims nothing and
            // falls through to the ordinary sheet.
            if (this.establishClosure(handedBack.closure)) {
              this.showQuoteSheet = false;
              this.releaseCheckout();
              return;
            }
          } else if (handedBack.kind !== 'absent') {
            // E1 — ASSERTED AND UNUSABLE. Not silence, and not a reason to
            // review: this build cannot say what the server retired, so it
            // says so and stops rather than pricing again under a key that
            // may be bound to a retired order.
            this.showQuoteSheet = false;
            this.releaseCheckout();
            this.failOrder(UNRESOLVED_CLOSURE_MESSAGE);
            return;
          }
          const quoteReference = od?.quote_ref ?? null;
          this.reviewedQuote = {
            ref: quoteReference,
            revision: attempt.revision,
            context: attempt.context,
            key: this.checkout.record()?.key ?? null,
          };
          // GATE A — REMEMBER WHAT THIS SERVER SAYS IT CAN DO. The backend
          // publishes `order_details.checkout_protocol` (D04/B), and a level
          // demonstrated on the initiate is what makes a later submit reply
          // carrying NO projection readable as broken rather than old.
          this.checkout.noteProtocol(protocolLevel(od));
          // AND THE D06 LEVEL (G4). Both initiate consumers note it — this one
          // and `resendInitiation` — because "which level did this server
          // demonstrate" must not depend on which path happened to ask.
          this.checkout.noteQuoteProtocol(quoteProtocolLevel(od));
          // The stage a reload should ask about. NOT the command — nothing
          // has been accepted yet, and recording one here would make a draft
          // the diner is still reading look like an outstanding acceptance.
          this.checkout.noteStage('reviewing');
          // ALWAYS review — whether or not anything dropped. The diner sees the
          // server's lines and the server's total, and nothing is accepted
          // until they say so.
          this.showQuoteSheet = true;
          this.releaseCheckout();
        } else {
          this.toast.success(response.message);
          this.releaseCheckout();
        }
      },
      (error) => {
        if (!this.isCurrent(attempt)) {
          this.releaseIfLatest(attempt);
          return;
        }
        this.dialog.closeModal();

        // The table already has an order working through the kitchen. The backend
        // rejects the new one with HTTP 400 { message, data:{ order_id } }; the
        // ErrorInterceptor forwards this one case as the structured body (every
        // other error is a string). Push the just-learned truth into the shared
        // live signal so the checkout CTA is replaced by the explanatory
        // ongoing-order banner + disabled button (the shell's poll then keeps it
        // accurate and clears it once the kitchen serves the order).
        if (error?.status === 400 && typeof error?.data?.order_id === 'string') {
          this.navState.setTableOngoingOrder(true);
          this.toast.clear();
          this.releaseCheckout();
          return;
        }

        // Diner table-session failures are about the QR/session, not the order:
        //  - a denied/invalid credential (QR regenerated) → invalidate it and let
        //    the shell prompt a fresh scan (no dead-end at the checkout button);
        //  - a plain TTL lapse → drop the stale token so the shell poll re-mints
        //    from the retained credential, and surface a friendly retry inline.
        if (this.dinerSession.isCredentialDenied(error)) {
          this.dinerSession.invalidateCredential();
          this.toast.clear();
          this.releaseCheckout();
          return;
        }
        if (this.dinerSession.isSessionExpired(error)) {
          this.dinerSession.expireSession();
        }

        // Genuine failure (lost signal, 5xx, etc). The ErrorInterceptor already
        // queued the raw message as a toast; surface that SAME backend message
        // inline at the button (orders/initiate returns diner-friendly text),
        // falling back to the generic line for the network / non-string error
        // tokens the interceptor throws. Clears the duplicate toast either way.
        this.failOrder(this.placementErrorMessage(error));
      }
    );
  }

  /** The backend's own message when it sent a usable one, else undefined so
   *  failOrder() shows its generic fallback. Guards the non-message tokens the
   *  interceptor throws (the 'no network' sentinel, non-strings). */
  private placementErrorMessage(error: unknown): string | undefined {
    if (typeof error === 'string') {
      return error && error !== 'no network' ? error : undefined;
    }
    // A structured refusal the interceptor forwarded whole (see
    // error.interceptor.ts): it carries the sentence beside the machine code,
    // and is NOT toasted there, so the message has to be read off it here.
    const message = (error as { message?: unknown } | null)?.message;
    return typeof message === 'string' && message ? message : undefined;
  }

  /** The backend's stable refusal code, when it sent one. */
  private refusalReason(error: any): string | null {
    const reason = error?.reason ?? error?.error?.reason;
    return typeof reason === 'string' ? reason : null;
  }

  // --- D01 request ceilings, surfaced before the round trip --------------

  /** Whether this basket can be submitted as it stands, and why not. */
  get limitState(): CheckoutLimitState {
    return checkCheckoutLimits(this.basketItems);
  }

  /** Mark the individual lines a diner has to reduce. */
  isOverLineLimit(index: number): boolean {
    return this.limitState.overLimitLineIndexes.includes(index);
  }

  /** One more unit on this line would exceed the per-line ceiling. */
  atLineCeiling(index: number): boolean {
    return atLineQuantityCeiling(this.basketItems[index]?.quantity ?? 0);
  }

  /** The ceiling itself, so the inline message states a number rather than a rule. */
  readonly maxQuantityPerLine = MAX_QUANTITY_PER_LINE;

  // Surfaces a friendly inline placement error + Retry at the checkout footer,
  // clearing the global toast first so the diner sees one message, not two.
  private failOrder(message = "We couldn't place your order. Please try again."): void {
    this.toast.clear();
    this.orderError = true;
    this.orderErrorMessage = message;
    this.releaseCheckout();
  }
  /** The same line priced WITHOUT its discounts, or `null` when it carries
   *  none. Through the shared exact helper, like every other figure here. */
  getOriginalSubtotal(item: BasketItem): number | null {
    return fromMinorUnits(lineOriginalSubtotalMinor(
      item as PricedLineParts & { isDiscounted?: boolean; originalBasePrice?: unknown },
      this.hasDiscountedExtra(item),
    ));
  }

  /** Total deal savings — summed in MINOR UNITS, so the subtraction that
   *  produces it cannot drift from the two figures it is derived from. */
  getTotalSavings(): number {
    const parts: (number | null)[] = [];
    for (const item of this.basketItems) {
      const original = lineOriginalSubtotalMinor(
        item as PricedLineParts & { isDiscounted?: boolean; originalBasePrice?: unknown },
        this.hasDiscountedExtra(item),
      );
      if (original === null) continue;
      const discounted = lineSubtotalMinor(item as PricedLineParts);
      if (discounted === null) continue;
      parts.push(original - discounted);
    }
    return fromMinorUnits(addMinorUnits(...parts)) ?? 0;
  }



  // --- the authoritative review ----------------------------------------

  /** Identity of the checkout CONTEXT this basket would be priced against. */
  private checkoutContext(): string {
    return `${this.restaurant?.id ?? ''}:${this.table?.id ?? ''}`;
  }

  /**
   * The initiation lines, built from the basket as it stands RIGHT NOW.
   *
   * Called in exactly one place — when a purchase is first reserved. A replay
   * must never call it: that is the whole point of storing the result on the
   * record (Gate B).
   */
  private buildOrderLines(): readonly unknown[] {
    return this.basketItems.map((item) => ({
      item: item.itemId,
      quantity: item.quantity,
      selected_modifiers: (item.selectedModifiers || []).reduce(
        (acc, mod) => {
          acc[mod.groupId] = mod.choices.map(c => c.id);
          return acc;
        },
        {} as Record<string, string[]>,
      ),
      extras: item.extras.map(extra => extra.id),
    }));
  }

  /**
   * Re-send an acceptance the server has proved it never received.
   *
   * IT SENDS THE RECORDED COMMAND, NOT A REBUILT ONE. The order id and the
   * reference come from the record written before the original send, so a
   * basket edited in the meantime cannot change what is being retried — and
   * the key is unchanged, so even if this arrives twice the server binds both
   * to one acceptance.
   */
  private resendIssuedCommand(command: IssuedCommand): void {
    if (!this.holdCheckout()) return;
    // R2 — CAPTURED BEFORE THE SEND. `issued.seq` below is a component
    // counter: a cart edit does not move it, so it cannot say whether this
    // answer still owns what is on screen.
    const owner = this.recoveryOwner();
    const payload: { order: unknown; quote_ref?: string } =
      { order: command.orderId };
    if (command.quoteRef) payload.quote_ref = command.quoteRef;
    const issued = { seq: ++this.attemptSeq, orderId: command.orderId };
    // THE SAME OWNERSHIP PREDICATE THE ENQUIRY USES, for the same reason.
    //
    // `issued.seq` is a COMPONENT counter: it moves when THIS instance starts
    // something newer and never when another one does, and it does not exist
    // at all once this instance is gone. Angular does not cancel an in-flight
    // request on destroy — `ngOnDestroy` releases the app-wide flight and the
    // socket stays open — so a resend outliving its component lands with its
    // seq still matching and writes to the SHARED record: the error path hands
    // a refusal to `applyQuoteRefusal`, which can settle a command and record
    // a closure against whatever attempt is current by then, and the success
    // path records an outcome and forgets the intent. Neither is this
    // instance's to do any more.
    //
    // A NULL OWNER FAILS CLOSED. It means no record was readable when the
    // resend went out, which `retryOrder` cannot produce — it reads the
    // command off a record in the same synchronous turn — so this is a guard
    // rather than a path. Permitting it would be worse than useless: with no
    // operation to be the current one, an answer would be free to act on
    // whatever record a DIFFERENT checkout had created by the time it landed.
    const mine = () =>
      !this.destroyed && owner !== null && this.checkout.settles(owner);

    this.checkout.bounded(
      this.api.postPatch('orders/submit/', payload, 'put'),
    ).subscribe(
      (response: any) => {
        if (issued.seq !== this.attemptSeq) {
          this.releaseIfLatest(issued);
          return;
        }
        this.releaseCheckout();
        if (!mine()) return;
        // The same single decision as `submitOrder` — see `submitVerdict`.
        const { correlation, verdict } =
          this.submitVerdict(response, command.orderId, command.quoteRef);
        if (verdict && verdict.kind !== 'accepted') {
          this.recovered = verdict.kind === 'not-accepted'
            ? { kind: 'draft', order: response, correlation }
            : { kind: 'uncorrelated', order: response };
          return;
        }
        const recorded = this.checkout.recordOutcome({
          kind: 'accepted',
          orderId: command.orderId,
          orderNumber: null,
          quoteRef: verdict?.kind === 'accepted'
            ? verdict.quoteRef : command.quoteRef,
          acceptedAt: verdict?.kind === 'accepted'
            ? verdict.acceptedAt : null,
          at: Date.now(),
        });
        this.recovered = { kind: 'accepted', order: response, correlation };
        // R2 — AND ONLY THE OWNER OF THE DISPLAYED CART MAY CLEAR IT. The
        // scope half of this is already caught by `submitVerdict` (the reply
        // names the scope it was resolved at); a cart edit is invisible to
        // that check and to `issued.seq` alike.
        if (this.ownsDisplayedCart(owner)) this.basketService.clearBasket();
        if (recorded) this.checkout.clearIntent();
      },
      (error) => {
        if (issued.seq !== this.attemptSeq) {
          this.releaseIfLatest(issued);
          return;
        }
        this.releaseCheckout();
        if (!mine()) return;
        // C1 — A RESEND IS REFUSED BY THE SAME SERVER AND MUST BE READ THE
        // SAME WAY.
        //
        // This handler filed EVERY failure as `unknown`, which is right for a
        // timeout or an unreachable server and wrong for the one answer that
        // is definitive: a `quote_expired` or `purchase_needs_review` refusal
        // carrying the closure the server wrote. Left as `unknown` the record
        // stayed outstanding, the CTA offered Retry, and the next press
        // arrived back here — the dead end this work closes, reached through
        // the resend rather than the read. The shared transition settles the
        // command and records the closure; the diner is then offered the
        // review, exactly as on every other path.
        //
        // O1 — AND IT NAMES THE OPERATION IT BELONGS TO. The transition
        // settles a command and records a closure; both act on the record,
        // so a reply landing after the attempt moved on must not.
        const refusal = this.checkout.applyQuoteRefusal(
          error, owner ?? undefined);
        if (refusal?.disposition === 'terminal' && refusal.closure) {
          this.recovered = {
            kind: 'closed', order: null, correlation: null,
            closure: refusal.closure,
          };
          this.quoteRetired = true;
          this.toast.clear();
          this.failOrder(this.placementErrorMessage(error));
          return;
        }
        // THE RECORD SURVIVES EVERY OTHER FAILURE HERE. The command was
        // issued; a failure to re-send it says nothing about whether the first
        // one landed, so the checkout stays unresolved and recoverable.
        this.recovered = { kind: 'unknown' };
        this.failOrder(this.placementErrorMessage(error));
      },
    );
  }

  /**
   * GATE A — THE ONE PLACE EITHER SUBMIT SURFACE DECIDES IT SUCCEEDED.
   *
   * It used to be `correlationMatches()` alone, which answers a DIFFERENT
   * question: *is this answer about my command?* A projection can name this
   * key, this order and this scope and still report that the acceptance did
   * not happen, or name a quote the diner never confirmed, or carry no
   * evidence at all. Using resource identity as the success decision
   * announced orders the server had just declined to accept.
   *
   * Returns the verdict; the caller renders it. Both callers go through here
   * so they cannot form different opinions about one reply.
   */
  private submitVerdict(response: unknown, orderId: string,
                        quoteRef: string | null) {
    const correlation = readCorrelation(response);
    if (correlation) {
      // A LEVEL ONCE STATED IS REMEMBERED — see `noteProtocol`.
      this.checkout.noteProtocol(correlation.protocol);
      return {
        correlation,
        verdict: acceptanceVerdict(correlation, {
          key: this.checkout.record()?.key ?? '',
          scope: this.checkoutContext(),
          orderId,
          quoteRef,
        }, { mutation: true }),
      };
    }
    // NO PROJECTION. Broken or simply old? `correlationPromised` reads the
    // PAYLOAD; the record remembers what this server already demonstrated
    // for THIS attempt, and a capability does not un-demonstrate itself.
    const promised = correlationPromised(response)
      || this.checkout.establishedProtocol() >= CHECKOUT_PROTOCOL_CORRELATED;
    return {
      correlation: null,
      verdict: promised
        ? { kind: 'incomplete' as const, missing: 'checkout' }
        : null,                                   // a genuinely older server
    };
  }

  /** Say what a refused reservation means, without starting a checkout. */
  private onReservationRefused(
    reservation:
      | Exclude<IntentReservation, { kind: 'ready' }>
      | Extract<RenewalResult,
                { kind: 'outstanding' | 'storage-error' | 'blocked'
                        | 'conflict' | 'unusable' }>,
  ): void {
    switch (reservation.kind) {
      case 'conflict':
        // O1 — THE CLOSURE IS ABOUT AN ATTEMPT THAT IS NO LONGER THE CURRENT
        // ONE, at the same table for the same basket. Another mount, or an
        // earlier tap, has moved this purchase on; minting here would abandon
        // a key that is in use. Nothing is sent and nothing is replaced.
        this.failOrder(
          'Your order has already been updated on this device. Please '
          + 'review it again.');
        return;
      case 'unusable':
        // E1 — A CLOSURE IS RECORDED AND THIS BUILD MAY NOT ACT ON IT.
        this.failOrder(UNRESOLVED_CLOSURE_MESSAGE);
        return;
      case 'outstanding':
        // An acceptance is already out there. Resolving THAT is the only
        // correct next step; starting another is what the record exists to
        // prevent.
        this.recovered = { kind: 'unknown' };
        this.failOrder(
          "Your last order is still being confirmed. Tap retry and we'll "
          + 'check what happened before placing anything else.');
        return;
      case 'storage-error':
        // NOTHING WAS SENT. A checkout whose key cannot be written down is a
        // checkout whose retry can duplicate, so it is refused rather than
        // attempted — which is the opposite of the previous behaviour.
        this.failOrder(
          "We couldn't save your checkout on this device, so we haven't "
          + 'placed the order. Please try again.');
        return;
      default:
        this.recovered = { kind: 'blocked', stored: reservation.stored };
        this.failOrder(
          'We could not read your last checkout on this device. Please check '
          + 'with staff before ordering again.');
        return;
    }
  }

  /**
   * Clear the per-order browse state a completed order makes stale.
   *
   * THIS REPLACES A BLANKET `sessionStorage.clear()`, and the blanket wipe was
   * the problem rather than the mechanism around it. `StorageService.clear()`
   * calls `sessionStorage.clear()` on the RAW store, so it emptied every key
   * on the origin — prefixed or not, this app's or not — and then put two
   * diner tokens back through `retainSessionThrough`. That is a restore list
   * that has to be maintained by hand against a wipe that keeps widening, and
   * it was already wrong for the portal-embedded diner mount
   * (`rest-app-ordering`), where an operator's own session keys sit in the
   * same store.
   *
   * WHAT IS REMOVED is exactly what a finished order makes stale: the menu's
   * upsell configuration and the menu scroll position. WHAT IS KEPT is the
   * diner's own context — the table, the restaurant and the capability
   * tokens — which the wipe used to destroy and then partially rebuild. The
   * diner shell treats missing context as a reason to re-scan, so keeping it
   * is what lets "back to menu" work without one.
   */
  private resetDinerOrderContext(): void {
    for (const key of BasketBodyComponent.PER_ORDER_SESSION_KEYS) {
      try {
        this.sessionStorage.removeItem(key);
      } catch {
        /* a store that refuses to erase is not a reason to fail an order */
      }
    }
  }

  /**
   * Give the checkout button back after a DISCARDED attempt.
   *
   * Discarding a late response is correct — it priced a basket the diner has
   * moved on from — but the button was put into its loading state when that
   * attempt started, and nothing else clears it: editing the basket mid-flight
   * left the CTA disabled with no way back except reloading, which on the
   * desktop sidebar (never destroyed, it lives in the shell) means the whole
   * page.
   *
   * ONLY when this was the LATEST attempt started. A newer attempt still in
   * flight owns the loading state, and re-enabling the button underneath it
   * would invite a second checkout for a basket already being priced.
   */
  /** Take the app-wide checkout flight, or report that another surface has
   *  it. Idempotent for THIS instance: a surface that already holds it
   *  (pricing then submitting) keeps the same claim rather than deadlocking
   *  against itself. */
  private holdCheckout(): boolean {
    this.flight ??= this.checkout.claimFlight();
    return this.flight !== null;
  }

  /** Give it back. Safe to call when this instance does not hold it — the
   *  coordinator ignores a token that is no longer current, so a late release
   *  from a superseded attempt cannot free a live one. */
  private releaseCheckout(): void {
    this.checkout.releaseFlight(this.flight);
    this.flight = null;
  }

  private releaseIfLatest(attempt: { seq: number }): void {
    if (attempt.seq === this.attemptSeq) this.releaseCheckout();
  }

  /** Is this attempt still the one the diner is waiting on? */
  private isCurrent(attempt: { seq: number; revision: number; context: string }):
    boolean {
    return (
      this.activeAttempt?.seq === attempt.seq &&
      this.basketService.revision() === attempt.revision &&
      this.checkoutContext() === attempt.context
    );
  }

  /** True once the basket or the table has moved on from the shown quote. */
  get quoteIsStale(): boolean {
    if (!this.reviewedQuote) return true;
    return (
      this.basketService.revision() !== this.reviewedQuote.revision ||
      this.checkoutContext() !== this.reviewedQuote.context
    );
  }

  /**
   * ONE VALIDATION PER PAYLOAD, SHARED BY THE SHEET AND BY `confirmQuote`.
   *
   * Memoised on the payload's own identity, so the markup, the total, the
   * refusal state and the handler that places the order can never disagree
   * about the same response — and so a getter read repeatedly during change
   * detection costs one pass, not one per read.
   */
  private reviewCacheFor: OrderInitiated | null = null;
  private reviewCache: QuoteReview | null = null;

  private get review(): QuoteReview {
    const payload = this.order_initiated ?? null;
    if (this.reviewCache === null || this.reviewCacheFor !== payload) {
      this.reviewCacheFor = payload;
      this.reviewCache = reviewQuote(payload);
    }
    return this.reviewCache;
  }

  /** Which rule refused the quote — diagnostic; the diner sees one sentence. */
  get quoteRefusalReason(): QuoteRefusal | null {
    return this.review.reason;
  }

  /** The server's priced lines, each with its extras nested underneath.
   *  A refused quote still returns whatever arrived, so the sheet can show what
   *  it was asked to confirm beside the refusal rather than going blank. */
  get quoteLines(): OrderQuoteLine[] {
    return this.review.lines;
  }

  /** Whole dishes that became unavailable at checkout. */
  get unavailableItems(): any[] {
    return this.order_initiated?.unavailable_items ?? [];
  }

  /** Extras that became unavailable (their parent dish is still orderable).
   *  An extra dropped only BECAUSE its dish was dropped is not listed here —
   *  the server reports that as one loss, not two. */
  get unavailableExtras(): any[] {
    return this.order_initiated?.unavailable_extras ?? [];
  }

  /** True when anything the diner chose is not deliverable. */
  get quoteHasLosses(): boolean {
    return this.unavailableItems.length > 0 || this.unavailableExtras.length > 0;
  }

  /**
   * THE SERVER'S amount payable, in exact minor units. Never recomputed here,
   * and `null` when the quote cannot be confirmed at all.
   *
   * The version discrimination and the bounded `actual_cost` compatibility
   * path now live with every structural rule in ONE place —
   * `_shared/order/quote-review.ts` — because the total and the lines are the
   * same judgement. Reading the total under one rule while the lines were
   * checked by another is what let a payload state a payable above lines that
   * summed to something else and still be confirmed.
   */
  private get reviewedTotalMinor(): number | null {
    return this.review.totalMinor;
  }

  /** The reviewed payable as a display string (`'2,697.30'`), or `null`.
   *  Formatted from the integer, so the scale the server sent survives —
   *  Angular's number pipe would render `899.10` as `899.1`. */
  get reviewedTotalDisplay(): string | null {
    return formatMinorUnits(this.reviewedTotalMinor);
  }

  /**
   * IS THE SERVER'S QUOTE CONFIRMABLE AT ALL? An EXPLICIT STATE, not an absence.
   *
   * Delegates to the shared boundary, so the markup and `confirmQuote` reach
   * the same verdict for the same payload BY CONSTRUCTION rather than by two
   * pieces of code agreeing. It is no longer only "can the payable be read":
   * a CORRECTED response must also name its quote, send lines carrying usable
   * identities, quantities and exact amounts, nest each extra under exactly one
   * parent, agree with its own availability counts, and add up to the amount
   * the diner is being asked to confirm.
   *
   * A legitimate `0.00` is confirmable and is NOT this state.
   */
  get quoteIsUnreadable(): boolean {
    return !this.review.readable;
  }

  /** One actionable sentence for the invalid-quote state. */
  readonly quoteUnreadableMessage =
    "We couldn't read the restaurant's price for this order. Your basket is "
    + 'unchanged — please try again.';

  /** A line's payable, exactly as the server saved it. `null` renders as a
   *  refusal rather than a number the server never sent. */
  lineTotalDisplay(line: OrderQuoteLine): string | null {
    return formatAmount(line.line_total_with_extras);
  }

  /**
   * Does the server's total match what this basket was showing?
   *
   * EXACT, through the decimal-string parser — no epsilon, no whole-shilling
   * rounding. Used only to LABEL the review ("the total changed"), never to
   * decide whether to submit: the diner confirms the server's number either
   * way.
   */
  get quoteDiffersFromBasket(): boolean {
    const server = this.order_initiated?.order_details?.quote_total
      ?? this.order_initiated?.order_details?.actual_cost;
    if (toMinorUnits(server) === null) return true;
    return !sameAmount(server, this.totalAmount);
  }

  /** Nothing survived — there is no order to place. */
  get quoteHasNothingToPlace(): boolean {
    const details = this.order_initiated?.order_details;
    if (!details) return true;
    return (details.no_available_items ?? 0) < 1;
  }

  /**
   * Diner accepted the server's quote — commit that exact draft.
   *
   * THE SHEET STAYS UP UNTIL SUBMIT RESOLVES, in a loading state. Closing it
   * first handed the live basket straight back: the quantity controls are not
   * disabled during a submit, and the checkout CTA had already been released
   * when the sheet opened — so a slow submission left the diner free to edit
   * the basket or start a second checkout, and the success handler then cleared
   * the basket and navigated away, taking those edits with it. Keeping the
   * modal up locks every mutation behind it without a single new disabled
   * binding.
   */
  confirmQuote(): void {
    if (this.quoteIsUnreadable) {
      // GUARDED IN THE HANDLER AS WELL AS THE TEMPLATE. A disabled button is a
      // display state; this is the one that decides whether an order is placed,
      // and it must refuse independently of what the markup rendered.
      this.showQuoteSheet = false;
      this.failOrder(this.quoteUnreadableMessage);
      return;
    }
    if (this.quoteIsStale) {
      // The basket changed while the review was open. The old quote can no
      // longer be accepted; the basket is left exactly as it is.
      this.showQuoteSheet = false;
      this.failOrder('Your basket changed. Please review your order again.');
      return;
    }
    // The pricing round trip released the flight when the sheet opened, so
    // the submission claims it again. A second surface that grabbed it in
    // between owns the checkout, and this confirmation waits rather than
    // racing it.
    if (!this.holdCheckout()) return;
    // D06. THE DEADLINE HAS PASSED ON THIS DEVICE — SO ASK THE SERVER, DO NOT
    // DECIDE. The published `expires_at` is advisory: the server samples its
    // clock after its locks and that decision is the one that counts, so a
    // client concluding "expired" from its own clock would be wrong on any
    // skew and would discard a quote the server would still honour.
    // `retire-quote` is how the question is asked without attempting an
    // acceptance — which, when the quote turns out to be fine, SUCCEEDS,
    // claiming a table and sending food to a kitchen in order to find out.
    if (this.quoteDeadlineHasPassed()) {
      this.renewQuote();
      return;
    }
    this.submitOrder();
  }

  /** Has the server's published deadline for the reviewed quote passed here?
   *
   *  `false` whenever the server has not published one — an older server, or a
   *  quote whose age it could not establish. Absence is not evidence. */
  private quoteDeadlineHasPassed(): boolean {
    return quoteDeadlinePassed(
      readPublishedPolicy(this.order_initiated?.order_details), Date.now());
  }

  /**
   * Ask the server whether the reviewed quote can still be honoured, and act on
   * its answer rather than on this device's clock.
   *
   * THREE ANSWERS, AND ONLY ONE OF THEM IS "IT IS DEAD":
   *
   *   quote_still_valid   the clock here was ahead. Submit exactly as the
   *                       diner asked; nothing was written and nothing about
   *                       the quote changed.
   *   quote_closed /      the server retired it. Renew (G3b — the key is
   *   already_closed      bound to the order the closure was written against,
   *                       so re-pricing under it would replay that order) and
   *                       review the UNCHANGED basket again under a new one.
   *   anything else       treated as a failed placement and surfaced with a
   *                       Retry. It is NOT read as "the quote is fine" — a
   *                       round trip that did not answer is not an answer, and
   *                       (G4) neither is one that answered about something
   *                       else.
   *
   * The response is bounded like every other checkout round trip, and a
   * timeout takes the last branch: an enquiry that never landed says nothing
   * about the quote, and must never be turned into permission to submit.
   */
  private renewQuote(): void {
    const orderId = this.order_initiated?.order_details?.id;
    const quoteReference = this.reviewedQuote?.ref ?? null;
    if (orderId == null || !quoteReference) {
      // Nothing to name, so nothing to ask about. Fall through to the ordinary
      // submission, which refuses on its own terms rather than guessing here.
      this.submitOrder();
      return;
    }
    const asked = { order: String(orderId), quoteRef: quoteReference };

    // G4 — IDENTITY IS FROZEN AT ISSUANCE, through the SAME owner every
    // acceptance consumer uses. The old guard was `issued !== this.attemptSeq`:
    // a process-local counter that survives nothing, names no operation and
    // restarts at 0 on every load — exactly the identity D04 replaced. An
    // answer is acted on only if the record it was issued against is still the
    // one in hand, and never after this instance has been destroyed (Angular
    // does not cancel an in-flight request when a component goes away; only
    // unsubscribing does, and an answer landing afterwards would submit an
    // order on behalf of a screen the diner has left). The `destroyed` flag is
    // the component's established mechanism for that — the same one every
    // ownership predicate here reads — rather than a second one beside it.
    const owner = this.recoveryOwner();
    if (owner === null) {
      // NOTHING TO BIND AN ANSWER TO. Every checkout reserves a record before
      // it prices, so reaching here means the record was lost between the
      // review and the confirmation. The answer would decide whether an order
      // is SUBMITTED, so it must not be acted on unbound — and it must not
      // hang either: a silent return would leave the CTA spinning with nothing
      // said, which is the failure mode the enquiry exists to avoid.
      this.showQuoteSheet = false;
      this.failOrder(
        "We couldn't confirm your checkout on this device, so we haven't "
        + 'placed the order. Please try again.');
      return;
    }
    const mine = () => !this.destroyed && this.checkout.settles(owner);

    this.checkout.bounded(
      this.api.postPatch(
        'orders/retire-quote/',
        { order: asked.order, quote_ref: asked.quoteRef },
        'put',
      ),
    ).subscribe(
      (response: any) => {
        if (!mine()) return;
        // THE LEVEL THIS SERVER HAS NOW DEMONSTRATED, remembered like D04's.
        this.checkout.noteQuoteProtocol(quoteProtocolLevel(response));

        // C2 — THE LEVEL IS READ WHEN THE ANSWER LANDS, and it is the
        // MONOTONIC memory rather than what this payload happens to state: a
        // broken answer must not excuse itself by omitting the level too. The
        // note above has already folded in whatever this response declared.
        const answer = readQuoteAnswer(
          response, asked, this.checkout.establishedQuoteProtocol());
        // C2 — AN ANSWER MAY ONLY ACT ON THE REVIEW THAT ASKED FOR IT, and
        // that is ONE rule covering both branches that do anything.
        //
        // The enquiry is a QUESTION — it writes nothing and claims no table —
        // and its two decisive answers SUBMIT an order or ABANDON an
        // idempotency key. Neither may be done on behalf of a review the diner
        // is no longer confirming, or one belonging to an attempt that has
        // since been superseded. `settles(owner)` above refuses an answer
        // whose attempt moved on AFTER the enquiry went out; this is the
        // question it cannot reach, whether the review itself still matches
        // the attempt in hand (see `reviewedIntentIsStill`).
        //
        // `unreadable` is deliberately NOT gated on it: that branch acts on
        // nothing, and a Retry is the right offer however stale the screen is.
        if ((answer.kind === 'still-valid' || answer.kind === 'retired')
            && !this.reviewedIntentIsStill(asked)) {
          this.showQuoteSheet = false;
          this.failOrder('Your order changed while we were checking. '
            + 'Please review it again.');
          return;
        }
        if (answer.kind === 'still-valid') {
          // The clock here was ahead. Submit exactly as the diner asked;
          // nothing was written and nothing about the quote changed.
          this.submitOrder();
          return;
        }
        if (answer.kind === 'retired') {
          this.showQuoteSheet = false;
          this.reviewedQuote = null;
          // A READ rather than an inference, though it does not go through
          // `QuoteRefusal`: this is a 200 in which the SERVER stated the
          // outcome, and the route claims that word only when it actually
          // wrote or found a closure. There is no refusal object on this
          // path, so do not "align" it with `refusal.retired`.
          this.quoteRetired = true;
          this.toast.clear();
          // G3b APPLIES HERE TOO, and this is the most direct closure signal
          // the client ever gets. Re-pricing under the same key would replay
          // the retired order — it would self-heal at the initiate handler,
          // one wasted round trip later, which is not a reason to send a
          // request whose answer is already known.
          //
          // THE CURRENT RECORD IS THE RIGHT `replaced` HERE ONLY BECAUSE OF
          // THE GATE ABOVE. `renewAfterClosure` compares it against what
          // storage holds to decide `superseded`, so passing "whatever is
          // current" can never report one — it is right only for a caller
          // that has just established this record is the attempt it decided
          // about, which `reviewedIntentIsStill` has now done by key.
          // O1 — ESTABLISH AND STOP, as at every other site that LEARNS of
          // a closure. The enquiry answered that this quote is finished; the
          // replacement is the diner's decision, not this handler's.
          this.showQuoteSheet = false;
          if (this.establishClosure(answer.closure)) {
            this.releaseCheckout();
            return;
          }
          this.failOrder(UNRESOLVED_CLOSURE_MESSAGE);
          return;
        }
        // An answer this build cannot read, or one that is about something
        // else. The quote is not known to be dead and is not known to be
        // good, so nothing is submitted and nothing is discarded.
        this.showQuoteSheet = false;
        this.failOrder(this.placementErrorMessage(response));
      },
      (error) => {
        if (!mine()) return;
        this.showQuoteSheet = false;
        if (this.dinerSession.isCredentialDenied(error)) {
          this.dinerSession.invalidateCredential();
          this.toast.clear();
          this.releaseCheckout();
          return;
        }
        if (this.dinerSession.isSessionExpired(error)) {
          this.dinerSession.expireSession();
        }
        // A refusal here carries the same vocabulary a submission's does —
        // an already-accepted order above all, which is not a failure of
        // anything and must not be re-sent.
        const refusal = this.checkout.applyQuoteRefusal(error, owner);
        // READ, never inferred from the disposition — `QuoteRefusal.retired`
        // is true only when the server actually sent a closure this build
        // could read. A terminal reason whose closure object is absent or
        // unreadable must not produce a notice claiming one was recorded.
        this.quoteRetired = refusal?.retired === true;
        this.failOrder(this.placementErrorMessage(error));
      },
    );
  }

  /**
   * Is the review this enquiry was issued for STILL the one the diner is
   * looking at?
   *
   * The sheet is the lock from confirm until submit resolves, so in practice
   * this holds — which is exactly why it is asserted rather than assumed: the
   * one thing that must never happen is an enquiry's answer placing an order
   * for a quote the diner is no longer confirming.
   */
  private reviewedIntentIsStill(
    asked: { readonly order: string; readonly quoteRef: string },
  ): boolean {
    if (!this.showQuoteSheet) return false;
    if (String(this.order_initiated?.order_details?.id ?? '') !== asked.order) {
      return false;
    }
    if ((this.reviewedQuote?.ref ?? '') !== asked.quoteRef) return false;
    // AND THE RECORD MUST STILL BE THE ATTEMPT THIS REVIEW BELONGS TO.
    //
    // The three checks above are about the SCREEN and `settles(owner)` is
    // about the ATTEMPT — but that owner is frozen when the ENQUIRY is issued,
    // which is too late to see a renewal that happened before the diner
    // pressed the button. Both mounts render this basket: one can be holding a
    // stale sheet for O1/Q1 while the other has already settled Q1's closure
    // and minted a live K2 successor. The stale sheet still shows O1/Q1, so
    // every screen check passes; the owner is captured from the CURRENT (K2)
    // record, so `settles` passes too; and nothing between them notices that
    // this review predates the attempt in hand.
    //
    // The key is what closes it, and nothing else can: a renewal is a new
    // attempt at the SAME purchase, so the revision, the context, the scope
    // and the request are all unchanged across it.
    //
    // A NULL REVIEWED KEY DISCRIMINATES NOTHING and is treated as such rather
    // than as a refusal. It means no record was readable when the review was
    // established — which `renewQuote` has already failed closed on by then,
    // since `recoveryOwner()` would have returned null — so inventing a
    // refusal here would answer a question this field cannot answer.
    return this.reviewedAttemptIsCurrent();
  }

  /**
   * O1 — IS THE REVIEW IN HAND STILL THE ATTEMPT THE RECORD DESCRIBES?
   *
   * The key is what closes it and nothing else can: a renewal is a new
   * attempt at the SAME purchase, so the revision, the context, the scope and
   * the request all carry across unchanged, and every other comparison
   * available to this component passes over one.
   *
   * A NULL REVIEWED KEY IS NOT A MATCH. It used to be treated as "discriminates
   * nothing, so allow" — which is fine for a predicate that only decides
   * whether to keep going with something already established, and wrong for
   * one that gates persisting and sending a command: if a record has appeared
   * since, the command would be bound to an attempt this review never belonged
   * to. The honest reading of a null is that the review was established
   * against no readable record, so there is nothing for it to still be.
   */
  private reviewedAttemptIsCurrent(): boolean {
    const reviewedKey = this.reviewedQuote?.key ?? null;
    if (reviewedKey === null) return false;
    return (this.checkout.record()?.key ?? null) === reviewedKey;
  }

  /** Diner backed out — return to the basket unchanged (no submit, no basket mutation).
   *
   *  Inert while a submission is in flight: the sheet is the lock, so dismissing
   *  it (backdrop or "Back to basket") must not release the basket under an
   *  acceptance the server may already have committed. */
  cancelQuote(): void {
    if (this.placingOrder) return;
    this.showQuoteSheet = false;
    this.releaseCheckout();
  }

  /**
   * The server refused a draft priced before the pricing correction. Re-price
   * the unchanged basket so the diner reviews and accepts a corrected quote.
   *
   * A FRESH IDEMPOTENCY KEY IS MINTED HERE, and only here: the backend has
   * authoritatively established that the old order is still a DRAFT its
   * acceptance path refuses, so it can never be accepted and a new attempt
   * cannot duplicate it. This is the one case — never a timeout, never an
   * ambiguous failure, never a lost response.
   */
  reviewUpdatedOrder(): void {
    // WHICH OF THE TWO PRODUCERS ASKED FOR THIS, read BEFORE the flag is
    // cleared. They take opposite paths — one forgets the intent, the other
    // renews it — so "neither" must be a no-op rather than falling through to
    // whichever branch happens to be last.
    const wasLegacyDraft = this.legacyDraft;
    this.legacyDraft = false;
    this.orderError = false;
    this.order_initiated = undefined;
    this.reviewedQuote = null;
    // A DELIBERATE TAP OPENS A NEW CHECKOUT EPISODE, exactly as a Checkout
    // press does — so the renewal below is the episode's one renewal and the
    // initiate handler's own guard still bounds a server that keeps answering
    // "closed".
    const closure = this.closedQuote();
    if (closure) {
      // C3 — ONE DELIBERATE SUCCESSOR, FROM THE PERSISTED CLOSURE.
      //
      // NOT `clearIntent`. The legacy branch below forgets the intent because
      // the draft it refers to is LEGACY-priced and can never be accepted by
      // anything, so a fresh key cannot duplicate it. A closure is different:
      // the old attempt is a real order the server knows about, and the new
      // key must be LINKED to it (`replaces`) rather than replacing it
      // anonymously. `renewAfterClosure` is the one primitive that does that,
      // and it refuses while an acceptance is outstanding — which is exactly
      // the case where minting a second key produces two orders.
      this.quoteRetired = true;
      if (!this.renewAfterClosure()) return;
      this.recovered = null;
      this.placeOrder();
      return;
    }

    if (!wasLegacyDraft) {
      // NOTHING TO REVIEW AROUND, AND NOTHING MAY BE FORGOTTEN. The two
      // producers are a LEGACY-priced draft and a retired quote; with neither
      // established, dropping the record would retire a reserved key on no
      // evidence at all — the not-found rule in the one place it is easiest
      // to break, because `clearIntent` reads like tidying up.
      //
      // Unreachable from the UI: the footer renders this action only while
      // `updatedReviewPrompt` is non-null, which requires one of the two. It
      // is guarded because the method is public and a second tap on a stale
      // frame is exactly the kind of thing that arrives later.
      return;
    }
    // A LEGACY DRAFT IS THE ONE CASE A FRESH KEY CANNOT DUPLICATE: the server
    // has authoritatively said its acceptance path refuses that draft, so it
    // can never become an order and forgetting it is safe.
    this.checkout.clearIntent();
    this.placeOrder();
  }

  // Submits the order to the server
  /**
   * Accept the exact quote the diner reviewed.
   *
   * `quote_ref` names THAT saved draft. The server validates it under the order
   * lock and refuses anything else — a stale acknowledgement is a controlled
   * refusal, never a silent reprice and never a second order.
   */
  submitOrder() {
    const orderId = this.order_initiated?.order_details?.id;
    // OMITTED, not sent as null, when the server named no quote: there is
    // nothing to acknowledge, and a null would be an assertion about a quote
    // rather than the absence of one. A corrected server always names one, and
    // refuses a submission that arrives without it.
    const quoteReference = this.reviewedQuote?.ref ?? null;

    // O1 — THE REVIEWED KEY IS CHECKED BEFORE EVERY COMMAND, not only when
    // an expired local deadline happens to trigger the extra enquiry.
    //
    // `reviewedIntentIsStill` was reached ONLY from `renewQuote`'s answer
    // handler, so the ordinary submission — the common path, the one that
    // places most orders — persisted and sent a command without ever asking
    // whether the review it is confirming belongs to the attempt in hand.
    // Both mounts render this basket: one can be holding a sheet priced under
    // K1 while the other has already renewed to K2, and every other check
    // passes across a renewal because a renewal is a new attempt at the SAME
    // purchase (the revision, the context, the scope and the request are all
    // unchanged).
    //
    // A NULL REVIEWED KEY IS REFUSED HERE RATHER THAN TRUSTED. It means no
    // record was readable when the review was established; if one exists now,
    // writing a command onto it would bind this review to an attempt it never
    // belonged to, and if none exists `noteCommand` refuses anyway. Either
    // way there is nothing to confirm against, which is not the same as
    // confirming.
    if (!this.reviewedAttemptIsCurrent()) {
      this.showQuoteSheet = false;
      this.releaseCheckout();
      this.failOrder('Your order changed while we were checking. '
        + 'Please review it again.');
      return;
    }

    // RECORD THE EXACT COMMAND BEFORE ISSUING IT, AND DO NOT ISSUE IT IF THAT
    // FAILS. From here the outcome is genuinely uncertain until the response
    // lands — the acceptance may commit and the reply be lost — so the only
    // thing that can resolve it afterwards is a durable note of what was
    // sent. A command held only in memory does not survive the reload that is
    // the most likely response to a stuck checkout.
    if (orderId == null
        || !this.checkout.noteCommand({
          orderId: String(orderId), quoteRef: quoteReference,
        })) {
      this.showQuoteSheet = false;
      this.releaseCheckout();
      this.failOrder(
        "We couldn't save your checkout on this device, so we haven't placed "
        + 'the order. Please try again.');
      return;
    }

    const payload: { order: unknown; quote_ref?: string } = { order: orderId };
    if (quoteReference) payload.quote_ref = quoteReference;
    const issued = { seq: this.attemptSeq, orderId: String(orderId) };
    // R2 — CAPTURED AFTER `noteCommand`, so the owner names the command that
    // is about to be issued rather than the reservation before it.
    const submitOwner = this.recoveryOwner();

    this.checkout.bounded(
      this.api.postPatch('orders/submit/', payload, 'put'),
    ).subscribe(
      (response: any) => {
        // A DELAYED REPLY MUST NOT FINISH A CHECKOUT THE DINER HAS MOVED ON
        // FROM. `placeOrder` has always guarded its own late responses this
        // way; the acceptance path never did, so a slow submit landing after
        // a re-price could clear a basket and navigate away on the strength
        // of an older attempt.
        if (issued.seq !== this.attemptSeq) {
          this.releaseIfLatest(issued);
          return;
        }
        // VALIDATE THE ANSWER IS ABOUT THIS COMMAND BEFORE ANNOUNCING IT.
        // Where the server publishes the correlated projection the key, the
        // order and the scope must all agree; below that level there is
        // nothing to check and the reply is taken as before.
        // A PROMISE IT COULD NOT KEEP IS REFUSED, NEVER DOWNGRADED. The two
        // refusals below are one rule: the answer must be about THIS
        // command, and a projection this client cannot read cannot say that
        // it is. Taking such a reply as success would announce an order,
        // clear the basket and navigate away having validated nothing —
        // while a reply that promised NOTHING is an older server and is
        // still taken as before.
        const { correlation, verdict } =
          this.submitVerdict(response, issued.orderId, quoteReference);
        if (verdict && verdict.kind !== 'accepted') {
          // NOT A SUCCESS, AND THE RECORD SURVIVES. Every non-accepted
          // verdict here leaves the intent, the command and the basket
          // exactly as they are: a projection saying the order is still a
          // draft, or naming a quote the diner never confirmed, or carrying
          // no evidence, is something to resolve — never something to
          // announce and tidy away.
          this.showQuoteSheet = false;
          this.releaseCheckout();
          this.recovered = verdict.kind === 'not-accepted'
            ? { kind: 'draft', order: response, correlation }
            : { kind: 'uncorrelated', order: response };
          this.failOrder(
            "We couldn't confirm this is your order. Please check with staff "
            + 'before ordering again.');
          return;
        }
        // THE TERMINAL RESULT IS RECORDED BEFORE ANY CLEANUP. A process that
        // dies between here and the teardown below resumes announcing a
        // completed order instead of re-enquiring about one.
        const recorded = this.checkout.recordOutcome({
          kind: 'accepted',
          orderId: issued.orderId,
          orderNumber: this.order_initiated?.order_details?.order_number != null
            ? String(this.order_initiated.order_details.order_number) : null,
          quoteRef: verdict?.kind === 'accepted'
            ? verdict.quoteRef : quoteReference,
          acceptedAt: verdict?.kind === 'accepted'
            ? verdict.acceptedAt : null,
          at: Date.now(),
        });
        this.showQuoteSheet = false;
        this.dialog.closeModal();
        // Forward the table for the confirmation page (captured before the
        // sessionStorage clear below), and replaceUrl so Back doesn't return to
        // the basket/confirm state.
        this.router.navigate(['/diner', 'basket', 'order-complete'], {
          replaceUrl: true,
          state: {
            tableNumber: this.table?.number ?? null,
            tableId: this.table?.id ?? null,
            // Forward the real backend order id so the diner can leave a review.
            orderId: this.order_initiated?.order_details?.id ?? null,
            // Human-facing order number (R1) — shown on the confirmation card and
            // matches the KDS. Null when the payload omits it.
            orderNumber: this.order_initiated?.order_details?.order_number ?? null,
            socials: this.restaurant?.socials ?? null,
          },
        });

        this.reviewedQuote = null;
        this.activeAttempt = null;
        // DEFINITIVE OUTCOME, so the attempt is forgotten — and forgotten
        // TARGETEDLY: `clearIntent` removes one key and never clears storage,
        // because the diner session capability lives in the same store and a
        // blanket wipe here would sign the diner out of their own table to
        // tidy up a finished checkout. This is the ONLY place besides an
        // explicit re-review that drops it; never a timeout, a lost response
        // or an ambiguous failure.
        // R2 — THE SAME OWNERSHIP RULE, on the path that normally owns the
        // cart outright. The review sheet locks the basket from confirm until
        // submit resolves, so this is defence in depth rather than a hole
        // being closed — but a component sequence is not cart ownership, and
        // every terminal write in this file now asks the same question.
        if (this.ownsDisplayedCart(submitOwner)) {
          this.basketService.clearBasket();
        }
        // CLEANUP ONLY ON A RECORDED OUTCOME. `recordOutcome` exists to
        // report a failed durable write, and ignoring its answer reopens
        // the defect this whole mechanism closes: a store that silently
        // drops writes loses the accepted outcome while the REMOVAL below
        // still succeeds, so a reload finds no record at all and can start
        // a second checkout for an order already in the kitchen.
        //
        // The order DID land, so success is still announced and the basket
        // is still cleared — withholding either would report a failure for
        // something that succeeded. Only the forgetting is withheld, and
        // the surviving record is what makes a later reload recover
        // `accepted` and tidy up then.
        if (recorded) this.checkout.clearIntent();
        this.resetDinerOrderContext();
        // Reset transient placement state. The desktop basket sidebar is never
        // destroyed (it lives in the shell beside the router-outlet), so without
        // this `placingOrder` stays true on that instance and keeps the checkout
        // button disabled after the table later frees — until a manual refresh.
        // (The navigation `state` above was built synchronously, so clearing
        // `order_initiated` here is safe.)
        this.releaseCheckout();
        this.order_initiated = undefined;
      },
      (error) => this.handleSubmitFailure(error, submitOwner)
    );
  }

  /**
   * THE ONE PLACE A FAILED ACCEPTANCE IS INTERPRETED.
   *
   * Extracted from the subscriber so it is reachable by name — this component
   * is mounted TWICE on desktop and the interpretation must be identical on
   * both, which is far easier to believe of a named method than of a closure
   * nobody can call. It also makes the D06 dispositions testable without
   * driving an HTTP round trip to produce each one.
   */
  private handleSubmitFailure(
    error: unknown, issued?: CheckoutOwner | null,
  ): void {
    // The acceptance resolved, so the review sheet stops being the lock:
    // every branch below either explains itself at the checkout footer or
    // re-prices, and both need the basket back.
    this.showQuoteSheet = false;
    this.dialog.closeModal();
    // A table-session failure can still surface here if the session lapsed
    // between initiate and submit — route it the same way as placeOrder().
    if (this.dinerSession.isCredentialDenied(error)) {
      this.dinerSession.invalidateCredential();
      this.toast.clear();
      this.releaseCheckout();
      return;
    }
    if (this.dinerSession.isSessionExpired(error)) {
      this.dinerSession.expireSession();
    }
    // The server refused the draft because it was priced by the previous
    // calculation. Offer an explicit re-review rather than retrying the
    // same acceptance, which can only fail the same way.
    if (this.refusalReason(error) === 'legacy_pricing_version') {
      this.legacyDraft = true;
      this.toast.clear();
      this.releaseCheckout();
      return;
    }
    // EVERY QUOTE REFUSAL GOES THROUGH THE ONE SHARED TRANSITION (D06).
    // This used to be a hand-written `reason === 'quote_ref_stale'` test
    // beside the legacy one above, on a component that is mounted TWICE on
    // desktop — which is precisely how two mounts end up disagreeing about
    // whether a quote is finished. The coordinator owns the state move; the
    // branches below own only what the diner is told.
    // O1 — THE REFUSAL IS BOUND TO THE ACCEPTANCE THAT WAS ISSUED.
    //
    // Both branches below act on the RECORD: the terminal one settles the
    // command and records a closure, and the `quote_ref_stale` reprice
    // settles it with no closure at all — so on the reprice path there is no
    // reference for the evidence check to compare, and a reply arriving after
    // the attempt moved on had nothing to catch it. `submitOwner` is the
    // operation this reply belongs to, frozen when the command went out.
    const refusal = this.checkout.applyQuoteRefusal(error, issued ?? undefined);
    if (refusal) {
      this.toast.clear();

      if (refusal.disposition === 'transient') {
        // THE QUOTE SURVIVES. The restaurant paused, or the table went out
        // of service — the same attempt, with the same quote and the same
        // key, may succeed shortly. Re-pricing here would throw away a
        // perfectly good quote and ask the diner to agree to the same
        // amount again, so the reviewed quote is deliberately KEPT and the
        // server's own sentence is shown with a Retry.
        this.quoteRetired = false;
        this.failOrder(this.placementErrorMessage(error));
        return;
      }

      if (refusal.disposition === 'terminal'
          || refusal.disposition === 'reprice') {
        this.reviewedQuote = null;
        // `applyQuoteRefusal` downgrades to `unknown` when the durable
        // settle fails, so reaching here means the record is consistent and
        // a fresh quote may be requested. TERMINAL says the server RECORDED
        // that this quote is finished; REPRICE says only that it refused
        // this command. The action is the same and the sentence is not,
        // which is why they are separate words.
        //
        // THE NOTICE IS READ, NOT INFERRED. It keys on `retired` — the
        // server having sent a closure this build could read — rather than
        // on the disposition, because the two can disagree: a terminal
        // reason whose `quote_closure` is absent or malformed parses to
        // `retired: false`, and showing the notice there would claim a
        // closure the response never carried. The re-price below is
        // unchanged either way; only the sentence moves.
        this.quoteRetired = refusal.retired;
        // G3b — A CLOSED QUOTE NEEDS A NEW KEY, AND A REPRICE DOES NOT.
        // `settleRefusedCommand` keeps the key, which is right for
        // `quote_ref_stale` (the order is still acceptable; only the
        // reference moved) and FATAL for a closure: the key is bound to the
        // order the closure was written against, so the re-price below
        // REPLAYS it and the same retired draft comes back — a review sheet
        // for a quote that can never be paid, refused again on submit, with
        // no way out of the app. The two arrive through this one branch,
        // which is why they had one answer and only one of them was right.
        // C2 — `applyQuoteRefusal` only reports TERMINAL with a validated
        // closure behind it (a terminal reason carrying none is downgraded to
        // `unknown` and never reaches here), so the evidence is guaranteed —
        // and it is passed rather than re-read, because the coordinator has
        // already recorded exactly this row.
        if (refusal.disposition === 'terminal') {
          // O1 — ESTABLISH AND STOP. `applyQuoteRefusal` has already written
          // the closure and settled the command in ONE verified write, so the
          // fact is durable here; what used to follow was a key mint and an
          // immediate re-price, both inside a failure handler. The footer
          // offers "Review updated order" and the diner decides.
          //
          // AND THE FLIGHT IS GIVEN BACK — the one thing "stop" has to do that
          // "re-price" did for free. `placeOrder()` below owns the flight and
          // releases it on every outcome; a branch that returns instead left
          // the APP-WIDE single flight held, so the very button this branch
          // renders ("Review updated order") came up `disabled` / `aria-busy`
          // and stayed that way until the page was reloaded — a dead end
          // produced by the change that exists to remove one. The acceptance
          // has RESOLVED here, so there is nothing left to protect; and
          // `releaseFlight` ignores a token that is no longer current, so a
          // late release from a superseded attempt cannot free a live one.
          //
          // Found by `e2e/checkout-journey/recovery.mjs` scenario D06e, which
          // is the only check that presses the button rather than asserting on
          // the state behind it.
          this.releaseCheckout();
          if (!refusal.closure) return;
          this.quoteRetired = true;
          return;
        }
        this.placeOrder();
        return;
      }

      // UNKNOWN — including a refusal whose settle could not be written
      // down. Nothing is re-sent and nothing is discarded: an outcome this
      // build cannot classify must not be guessed into either bucket.
      this.failOrder(this.placementErrorMessage(error));
      return;
    }
    // submit/ otherwise only runs after a successful initiate/, which already
    // passed the table-gate — so it can't carry the ongoing-order 400 (that's
    // handled in placeOrder()). Any remaining failure is genuine: surface the
    // backend message inline + Retry at the footer.
    this.failOrder(this.placementErrorMessage(error));
  }
  /** True when a stored basket extra carries a discount (original > charged). */
  isExtraDiscounted(ex: any): boolean {
    return !!ex && ex.originalCost != null && Number(ex.originalCost) > Number(ex.cost ?? 0);
  }

  // Numeric coercers feeding the shared price-display. BasketItem.basePrice is already a
  // number, but extras and upsell prices can arrive as Decimal strings — formatUGX needs
  // numbers, so coerce at the call site (the snapshot values themselves are unchanged).
  extraEffective(ex: any): number {
    return Number(ex?.cost) || 0;
  }

  extraOriginal(ex: any): number {
    return Number(ex?.originalCost) || 0;
  }

  upsellHasDiscount(item: any): boolean {
    return !!item?.item_running_discount && item?.item_discounted_price != null;
  }

  upsellEffective(item: any): number {
    return Number(item?.item_discounted_price) || 0;
  }

  upsellOriginal(item: any): number {
    return Number(item?.item_price) || 0;
  }

  private hasDiscountedExtra(item: BasketItem): boolean {
    return (item.extras || []).some((ex: any) => this.isExtraDiscounted(ex));
  }

  /** One line's payable subtotal, through the shared exact helper.
   *  `null` (an unreadable component) shows 0 here rather than NaN — this is a
   *  pre-quote estimate, and the SERVER's review is what gets confirmed. */
  getSubtotal(item: BasketItem): number {
    return fromMinorUnits(lineSubtotalMinor(item as PricedLineParts)) ?? 0;
  }

  shouldShowSubtotal(item: BasketItem): boolean {
    const modifiersCost = (item.selectedModifiers || []).reduce(
      (sum, mod) => sum + mod.choices.reduce((s, c) => s + c.additionalCost, 0),
      0
    );
    const extrasCost = item.extras?.reduce((sum: number, ex: any) => sum + (ex.cost || 0), 0) || 0;
    return item.quantity > 1 || modifiersCost > 0 || extrasCost > 0;
  }

  showItemTotal(item: BasketItem) {
    return (item.selectedModifiers || []).some(
      mod => mod.choices.some(c => c.additionalCost > 0)
    );
  }
}
