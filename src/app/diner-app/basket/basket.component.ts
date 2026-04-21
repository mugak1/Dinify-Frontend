import { Location } from '@angular/common';
import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ConfirmDialogService } from 'src/app/_common/confirm-dialog.service';
import { BasketItem, OrderInitiated, Restaurant, SelectedModifier, ShoppingBasket, TableScan } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { BasketService } from 'src/app/_services/basket.service';
import { MessageService } from 'src/app/_services/message.service';
import { SessionStorageService } from 'src/app/_services/storage/session-storage.service';
import { environment } from 'src/environments/environment';

@Component({
    selector: 'app-basket',
    templateUrl: './basket.component.html',
    styleUrls: ['./basket.component.css'],
    standalone: false
})
export class BasketComponent {
  basket_items: BasketItem[] = [];
  totalAmount: number;
  basketItems: BasketItem[];
  table?: TableScan|any;
  order_initiated?: OrderInitiated;
  restaurant: any;
  url = environment.apiUrl;
  upsellConfig: any = null;
  upsellItems: any[] = [];
  imageLoaded: Record<string, boolean> = {};
  imageErrored: Record<string, boolean> = {};

  discountActive: boolean = false; // Set to true only if discount is available
discountType: 'percentage' | 'flat' = 'percentage';
discountValue: number = 10; // 10% or UGX amount

  constructor(
    private sessionStorage: SessionStorageService,
    private basketService: BasketService,
    public loc: Location,
    private api: ApiService,
    private dialog: ConfirmDialogService,
    private router: Router,
    private messageService: MessageService
  ) {
    // Initialize basket from session storage
    this.basket_items = this.sessionStorage.getItem<BasketItem[]>('Basket') || [];
    this.basketService.Basket = signal<ShoppingBasket>({
      items: this.basket_items,
      totalAmount: this.basketService.calculateTotalAmount(this.basket_items),
    });
    this.basketItems = this.basketService.Basket().items;
    this.totalAmount = this.basketService.Basket().totalAmount;
    this.table = this.sessionStorage.getItem<TableScan>('Table');
    this.restaurant=this.sessionStorage.getItem<Restaurant>('restaurant') as any;

    // Load upsell config cached by the menu component on show-menu
    const upsellRaw = this.sessionStorage.getItem<any>('upsellConfig');
    if (upsellRaw?.enabled && upsellRaw?.items?.length > 0) {
      this.upsellConfig = upsellRaw;
      this.computeUpsellItems();
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
    const price = parseFloat(upsellItem.item_price) || 0;
    this.basketService.addItem({
      itemId: upsellItem.item_id || upsellItem.menu_item,
      itemName: upsellItem.item_name,
      image: upsellItem.item_image || null,
      basePrice: price,
      totalPrice: price,
      quantity: 1,
      selectedModifiers: [],
      extras: [],
    } as any);
    this.updateCart();
  }

  // Adds an item to the basket
  addItem(item: BasketItem) {
    this.basketService.addItem({
      itemId: item.itemId,
      itemName: item.itemName,
      basePrice: item.basePrice,
      totalPrice: item.totalPrice,
      quantity: 1,
      selectedModifiers: item.selectedModifiers,
      extras: item.extras
    });
    this.updateCart();
  }

  // Stores edit context and navigates back to the menu so the item detail modal
  // can re-open with existing selections pre-populated.
  editItem(index: number): void {
    const item = this.basketItems[index];
    if (!item) return;
    this.sessionStorage.setItem('editingBasketItem', {
      basketIndex: index,
      itemId: item.itemId,
    });
    this.loc.back();
  }

  // Removes an item from the basket
  removeItem(itemId: string, selectedModifiers: SelectedModifier[] = []) {
    this.basketService.removeItem(itemId, selectedModifiers);
    this.updateCart();
  }

  // Updates basketItems and totalAmount after adding/removing items
  updateCart() {
    this.basketItems = this.basketService.Basket().items;
    this.totalAmount = this.basketService.Basket().totalAmount;
    this.computeUpsellItems();
  }

  // Initiates an order
  initiateOrder() {
    const _ref = this.dialog.openModal({
      title: 'Checkout',
      message: 'Are you sure you want to place this order?',
      submitButtonText: 'Order',
    }).subscribe((response: any) => {
      if (response?.action === 'yes') {
      const orderPayload = {
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
              if (this.order_initiated?.order_details?.no_unavailable_items === 0) {
                this.submitOrder(); // Automatically submit if no unavailable items
              }
            } else {
              this.messageService.addMessage({severity:'info', summary:'Info', message: response.message});
            }
          },
          (error) => {
            this.messageService.addMessage({severity:'error', summary:'Error', message: error.message});
          }
        );
      }
    });
  }
  getOriginalSubtotal(item: BasketItem): number | null {
    if (!item.isDiscounted || !item.originalBasePrice) return null;

    const modifiersCost = (item.selectedModifiers || []).reduce(
      (sum, mod) => sum + mod.choices.reduce((s, c) => s + c.additionalCost, 0),
      0
    );
    const extrasCost = item.extras?.reduce((sum: number, ex: any) => sum + (ex.cost || 0), 0) || 0;

    return (Number(item.originalBasePrice) + modifiersCost + extrasCost) * item.quantity;
  }
  getTotalSavings(): number {
    return this.basketItems.reduce((total, item) => {
      if (!item.isDiscounted || !item.originalBasePrice) return total;
  
      const discountedSubtotal = this.getSubtotal(item);
      const originalSubtotal = this.getOriginalSubtotal(item);
      return total + ((originalSubtotal ?? 0) - discountedSubtotal);
    }, 0);
  }
  
  
  
  // Submits the order to the server
  submitOrder() {
    const payload = {
      order: this.order_initiated?.order_details?.id,
    };

    this.api.postPatch('orders/submit/', payload, 'put').subscribe(
      (_response: any) => {
        this.dialog.closeModal();
        this.router.navigate([this.router.url,'order-complete']); // Navigate to the order-complete page
      
        this.basketService.clearBasket(); // Clear the basket
        this.sessionStorage.clear();
      },
      (error) => {
        this.dialog.closeModal();
        this.messageService.addMessage({severity:'error', summary:'Error', message: error.message});
      }
    );
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
   getDiscountAmount(): number {
    if (!this.discountActive) return 0;
  
    const rawTotal = this.totalAmount;
    return this.discountType === 'percentage'
      ? (rawTotal * this.discountValue) / 100
      : this.discountValue;
  }
  
  getFinalTotal(): number {
    return Math.max(0, this.totalAmount - this.getDiscountAmount());
  }
}
