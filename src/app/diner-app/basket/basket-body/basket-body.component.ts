import { CommonModule, Location } from '@angular/common';
import { AfterViewInit, Component, ViewChild, ElementRef, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ConfirmDialogService } from 'src/app/_common/confirm-dialog.service';
import { BasketItem, OrderInitiated, Restaurant, TableScan } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { BasketService } from 'src/app/_services/basket.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { SessionStorageService } from 'src/app/_services/storage/session-storage.service';
import { environment } from 'src/environments/environment';
import { menuItemUrl } from '../../menu-item-detail/menu-item-url';
import { ConnectivityService } from '../../../_services/connectivity.service';

@Component({
    selector: 'app-basket-body',
    templateUrl: './basket-body.component.html',
    styleUrls: ['./basket-body.component.css'],
    standalone: true,
    imports: [CommonModule]
})
export class BasketBodyComponent implements OnInit, AfterViewInit, OnDestroy {
  table?: TableScan|any;
  order_initiated?: OrderInitiated;
  showUnavailableSheet = false;

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

  constructor(
    private sessionStorage: SessionStorageService,
    private basketService: BasketService,
    public loc: Location,
    private api: ApiService,
    private dialog: ConfirmDialogService,
    private router: Router,
    private toast: ToastService,
    private connectivity: ConnectivityService
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
    return this.upsellItems.length > 2;
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
  initiateOrder() {
    if (this.connectivity.isOffline()) {
      this.failOrder("You're offline — reconnect to place your order.");
      return;
    }
    this.dialog.openModal({
      title: 'Checkout',
      message: 'Are you sure you want to place this order?',
      submitButtonText: 'Order',
    }).subscribe((response: any) => {
      if (response?.action === 'yes') {
        this.placeOrder();
      }
    });
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
    this.placingOrder = true;
    const orderPayload = {
      // Idempotency key — reused across retries of an unchanged basket so a
      // retried submit returns the existing order instead of duplicating it.
      client_order_id: this.basketService.getOrCreateClientOrderId(),
      restaurant: this.restaurant?.id,
      table: this.table?.id,
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
        if (response.status === 200) {
          this.order_initiated = response.data;
          const od = this.order_initiated?.order_details;
          const unavailableCount =
            (od?.no_unavailable_items ?? 0) + (od?.no_unavailable_extras ?? 0);
          if (unavailableCount === 0) {
            this.submitOrder(); // everything available — commit straight away
          } else {
            // One or more items/extras sold out or were pulled since they were added.
            // Close the confirm dialog and let the diner review what dropped and the new
            // total, instead of dead-ending or silently trimming the order.
            this.dialog.closeModal();
            this.showUnavailableSheet = true;
            this.placingOrder = false;
          }
        } else {
          this.toast.success(response.message);
          this.placingOrder = false;
        }
      },
      (_error) => {
        // Genuine failure (lost signal, 5xx, etc). The ErrorInterceptor already
        // queued the raw message as a toast; failOrder() clears it and shows one
        // clean, friendly message inline at the button instead.
        this.dialog.closeModal();
        this.failOrder();
      }
    );
  }

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



  /** Whole dishes that became unavailable at checkout. */
  get unavailableItems(): any[] {
    return this.order_initiated?.unavailable_items ?? [];
  }

  /** Extras that became unavailable (their parent dish is still orderable). */
  get unavailableExtras(): any[] {
    return this.order_initiated?.unavailable_extras ?? [];
  }

  /** Recalculated amount payable for the remaining items. Unavailable lines are
   *  zeroed server-side, so actual_cost already excludes them. */
  get reviewedTotal(): number {
    return Number(this.order_initiated?.order_details?.actual_cost) || 0;
  }

  /** Diner accepted the trimmed order — commit the already-initiated order. */
  confirmPartialOrder(): void {
    this.showUnavailableSheet = false;
    this.submitOrder();
  }

  /** Diner backed out — return to the basket unchanged (no submit, no basket mutation). */
  cancelPartialOrder(): void {
    this.showUnavailableSheet = false;
  }

  // Submits the order to the server
  submitOrder() {
    const payload = {
      order: this.order_initiated?.order_details?.id,
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
          },
        });

        this.basketService.clearBasket(); // Clear the basket
        this.sessionStorage.clear();
      },
      (error) => {
        this.dialog.closeModal();

        // ── TEMP/TODO(orders-module): ongoing-order dev shim ──────────────────
        // When orders/submit/ fails with HTTP 400 because the table already has
        // an ongoing order, the backend returns that order's id at data.order_id.
        // The ErrorInterceptor forwards this one case as the structured body (it
        // strips every other error down to a string), so detect it here and treat
        // it as a soft success: run the SAME post-submit path as the success
        // branch above (forward the table, clear the basket, replaceUrl), using
        // the returned order_id as the reference. There is no UI yet to view or
        // close orders; remove this block (and its twin in error.interceptor.ts)
        // when the orders module lands.
        const ongoingOrderId = error?.data?.order_id;
        if (
          error?.status === 400 &&
          typeof ongoingOrderId === 'string' &&
          ongoingOrderId.trim().length > 0
        ) {
          this.router.navigate(['/diner', 'basket', 'order-complete'], {
            replaceUrl: true,
            state: {
              tableNumber: this.table?.number ?? null,
              tableId: this.table?.id ?? null,
              orderRef: ongoingOrderId,
            },
          });
          this.basketService.clearBasket();
          this.sessionStorage.clear();
          return;
        }
        // ── end TEMP shim ─────────────────────────────────────────────────────

        // Genuine submit failure (non-400, or a 400 without an ongoing-order id):
        // surface the inline error + Retry at the footer instead of the banner.
        this.failOrder();
      }
    );
  }
  /** True when a stored basket extra carries a discount (original > charged). */
  isExtraDiscounted(ex: any): boolean {
    return !!ex && ex.originalCost != null && Number(ex.originalCost) > Number(ex.cost ?? 0);
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
