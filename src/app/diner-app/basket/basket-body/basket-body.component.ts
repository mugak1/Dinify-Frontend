import { CommonModule, Location } from '@angular/common';
import { ChangeDetectionStrategy, AfterViewInit, Component, ViewChild, ElementRef, OnDestroy, OnInit, Input } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ConfirmDialogService } from 'src/app/_common/confirm-dialog.service';
import { BasketItem, OrderInitiated, OrderQuoteLine, Restaurant, TableScan } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { BasketService } from 'src/app/_services/basket.service';
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
import { sameAmount, toMinorUnits } from '../../../_shared/utils/decimal-money';
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
  private attemptSeq = 0;
  private activeAttempt: {
    seq: number; revision: number; context: string;
  } | null = null;
  /** The quote the diner is actually looking at, if any. */
  private reviewedQuote: { ref: string; revision: number; context: string } | null = null;
  /** Set when the server refused a draft priced before the pricing correction. */
  legacyDraft = false;

  /** Inline placement-error state, shown with a Retry at the checkout footer. */
  orderError = false;
  orderErrorMessage = '';
  /** True while a placement round-trip is in flight — disables the CTA. */
  placingOrder = false;

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

  get totalAmount(): number {
    return this.basketService.Basket()?.totalAmount ?? 0;
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
    private navState: MenuNavStateService
  ) {
    this.table = this.sessionStorage.getItem<TableScan>('Table');
    this.restaurant=this.sessionStorage.getItem<Restaurant>('restaurant') as any;

    this.loadUpsellFromStorage();
  }

  ngOnInit(): void {
    this.upsellStorageSub = this.sessionStorage.StorageValue.subscribe((key: any) => {
      // StorageValue emits the prefixed key (e.g. "[dinify-diner-app]upsellConfig").
      // Use includes() for prefix-agnostic matching — mirrors menu.component.ts:63.
      if (typeof key !== 'string' || !key.includes('upsellConfig')) return;
      this.loadUpsellFromStorage();
    });
  }

  ngAfterViewInit(): void {
    window.addEventListener('resize', this.onResize);
    setTimeout(() => this.checkScroll(), 0);
  }

  ngOnDestroy(): void {
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

  // Re-attempts a failed placement without re-opening the confirm dialog.
  // BasketService hands back the same client_order_id while the basket is
  // unchanged, so the backend dedups rather than creating a second order.
  retryOrder() {
    if (this.connectivity.isOffline()) {
      this.failOrder("You're offline — reconnect to place your order.");
      return;
    }
    this.placeOrder();
  }

  // Shared placement body for both the dialog-"yes" path and Retry. Posts the
  // current basket to orders/initiate/ and, when everything is still available,
  // commits straight away; otherwise it hands off to the unavailable-items sheet.
  private placeOrder() {
    this.orderError = false;
    this.legacyDraft = false;
    this.placingOrder = true;
    // Stamp this attempt with the basket revision AND the checkout context it
    // was priced for. A response that no longer matches both is discarded.
    this.attemptSeq += 1;
    const attempt = {
      seq: this.attemptSeq,
      revision: this.basketService.revision(),
      context: this.checkoutContext(),
    };
    this.activeAttempt = attempt;
    const orderPayload = {
      // Idempotency key — reused across retries of an unchanged basket so a
      // retried submit returns the existing order instead of duplicating it.
      client_order_id: this.basketService.getOrCreateClientOrderId(),
      // No raw restaurant/table UUIDs: the backend derives both from the diner
      // table session (X-Diner-Session), so a foreign body id can't override the
      // scope of the order. The session is the sole authority.
      items: this.basketItems.map((item) => ({
        item: item.itemId,
        quantity: item.quantity,
        selected_modifiers: (item.selectedModifiers || []).reduce(
          (acc, mod) => {
            acc[mod.groupId] = mod.choices.map(c => c.id);
            return acc;
          },
          {} as Record<string, string[]>
        ),
        extras: item.extras.map(extra => extra.id)
      })),
    };
    // API call to initiate the order
    this.api.postPatch('orders/initiate/', orderPayload, 'post',null,{},false,'v2').subscribe(
      (response: any) => {
        if (!this.isCurrent(attempt)) {
          // A LATE RESPONSE for a basket or a table the diner has moved on
          // from. It priced something they are no longer looking at, so it is
          // neither rendered nor submitted — and the draft it created is left
          // alone rather than cancelled, because this client cannot know it was
          // not something else's.
          return;
        }
        if (response.status === 200) {
          this.order_initiated = response.data;
          const od = this.order_initiated?.order_details;
          const quoteReference = od?.quote_ref ?? null;
          if (!quoteReference) {
            // A backend that cannot name the quote it priced cannot be
            // acknowledged, and submitting anyway would accept an unreviewed
            // amount. Fail clearly instead.
            this.failOrder(
              'We could not confirm your order total. Please try again.',
            );
            return;
          }
          this.reviewedQuote = {
            ref: quoteReference,
            revision: attempt.revision,
            context: attempt.context,
          };
          // ALWAYS review — whether or not anything dropped. The diner sees the
          // server's lines and the server's total, and nothing is accepted
          // until they say so.
          this.showQuoteSheet = true;
          this.placingOrder = false;
        } else {
          this.toast.success(response.message);
          this.placingOrder = false;
        }
      },
      (error) => {
        if (!this.isCurrent(attempt)) return;
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
          this.placingOrder = false;
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
          this.placingOrder = false;
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
    this.placingOrder = false;
  }
  getOriginalSubtotal(item: BasketItem): number | null {
    const parentDiscounted = !!item.isDiscounted && item.originalBasePrice != null;
    const extrasDiscounted = this.hasDiscountedExtra(item);
    if (!parentDiscounted && !extrasDiscounted) return null;

    const modifiersCost = (item.selectedModifiers || []).reduce(
      (sum, mod) => sum + mod.choices.reduce((s, c) => s + c.additionalCost, 0),
      0
    );
    const extrasOriginal = item.extras?.reduce(
      (sum: number, ex: any) => sum + (Number(ex.originalCost ?? ex.cost) || 0),
      0
    ) || 0;
    const baseOriginal = parentDiscounted
      ? Number(item.originalBasePrice)
      : Number(item.basePrice) || 0;

    return (baseOriginal + modifiersCost + extrasOriginal) * item.quantity;
  }
  getTotalSavings(): number {
    return this.basketItems.reduce((total, item) => {
      const originalSubtotal = this.getOriginalSubtotal(item);
      if (originalSubtotal == null) return total;
      const discountedSubtotal = this.getSubtotal(item);
      return total + (originalSubtotal - discountedSubtotal);
    }, 0);
  }



  // --- the authoritative review ----------------------------------------

  /** Identity of the checkout CONTEXT this basket would be priced against. */
  private checkoutContext(): string {
    return `${this.restaurant?.id ?? ''}:${this.table?.id ?? ''}`;
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

  /** The server's priced lines, each with its extras nested underneath. */
  get quoteLines(): OrderQuoteLine[] {
    return this.order_initiated?.order_details ? this.order_initiated.quote ?? [] : [];
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

  /** THE SERVER'S amount payable. Never recomputed here. */
  get reviewedTotal(): number {
    return Number(this.order_initiated?.order_details?.actual_cost) || 0;
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
    const server = this.order_initiated?.order_details?.actual_cost;
    if (toMinorUnits(server) === null) return true;
    return !sameAmount(server, this.totalAmount);
  }

  /** Nothing survived — there is no order to place. */
  get quoteHasNothingToPlace(): boolean {
    const details = this.order_initiated?.order_details;
    if (!details) return true;
    return (details.no_available_items ?? 0) < 1;
  }

  /** Diner accepted the server's quote — commit that exact draft. */
  confirmQuote(): void {
    if (this.quoteIsStale) {
      // The basket changed while the review was open. The old quote can no
      // longer be accepted; the basket is left exactly as it is.
      this.showQuoteSheet = false;
      this.failOrder('Your basket changed. Please review your order again.');
      return;
    }
    this.showQuoteSheet = false;
    this.submitOrder();
  }

  /** Diner backed out — return to the basket unchanged (no submit, no basket mutation). */
  cancelQuote(): void {
    this.showQuoteSheet = false;
    this.placingOrder = false;
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
    this.legacyDraft = false;
    this.orderError = false;
    this.order_initiated = undefined;
    this.reviewedQuote = null;
    this.basketService.resetClientOrderId();
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
    const payload = {
      order: this.order_initiated?.order_details?.id,
      quote_ref: this.reviewedQuote?.ref,
    };

    this.api.postPatch('orders/submit/', payload, 'put').subscribe(
      (_response: any) => {
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
        this.basketService.clearBasket(); // Clear the basket
        // Reset the diner's order/menu context, but KEEP the table-session
        // capability alive across the wipe — the order-complete review submission
        // and the back-to-menu re-scan both still authorise off X-Diner-Session.
        this.dinerSession.retainSessionThrough(() => this.sessionStorage.clear());
        // Reset transient placement state. The desktop basket sidebar is never
        // destroyed (it lives in the shell beside the router-outlet), so without
        // this `placingOrder` stays true on that instance and keeps the checkout
        // button disabled after the table later frees — until a manual refresh.
        // (The navigation `state` above was built synchronously, so clearing
        // `order_initiated` here is safe.)
        this.placingOrder = false;
        this.order_initiated = undefined;
      },
      (error) => {
        this.dialog.closeModal();
        // A table-session failure can still surface here if the session lapsed
        // between initiate and submit — route it the same way as placeOrder().
        if (this.dinerSession.isCredentialDenied(error)) {
          this.dinerSession.invalidateCredential();
          this.toast.clear();
          this.placingOrder = false;
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
          this.placingOrder = false;
          return;
        }
        // The saved quote moved under us. Re-price and review again; the basket
        // is untouched and the idempotency key is deliberately NOT re-minted.
        if (this.refusalReason(error) === 'quote_ref_stale') {
          this.toast.clear();
          this.reviewedQuote = null;
          this.placeOrder();
          return;
        }
        // submit/ otherwise only runs after a successful initiate/, which already
        // passed the table-gate — so it can't carry the ongoing-order 400 (that's
        // handled in placeOrder()). Any remaining failure is genuine: surface the
        // backend message inline + Retry at the footer.
        this.failOrder(this.placementErrorMessage(error));
      }
    );
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

  getSubtotal(item: BasketItem): number {
    const modifiersCost = (item.selectedModifiers || []).reduce(
      (sum, mod) => sum + mod.choices.reduce((s, c) => s + c.additionalCost, 0),
      0
    );
    const extrasCost = item.extras?.reduce((sum: number, ex: any) => sum + (ex.cost || 0), 0) || 0;
    const effectiveBasePrice = Number(item.basePrice) || 0;

    return (effectiveBasePrice + modifiersCost + extrasCost) * item.quantity;
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
