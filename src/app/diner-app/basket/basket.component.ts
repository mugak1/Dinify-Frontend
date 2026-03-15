import { Location } from '@angular/common';
import { Component, signal } from '@angular/core';
import { NonNullableFormBuilder } from '@angular/forms';
import { Router } from '@angular/router';
import { ConfirmDialogService } from 'src/app/_common/confirm-dialog.service';
import { BasketItem, Item, OrderInitiated, Restaurant, SelectedOption, ShoppingBasket, TableListItem, TableScan } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { BasketService } from 'src/app/_services/basket.service';
import { LocalStorageService } from 'src/app/_services/storage/local-storage.service';
import { MessageService } from 'src/app/_services/message.service';
import { SessionStorageService } from 'src/app/_services/storage/session-storage.service';

@Component({
  selector: 'app-basket',
  templateUrl: './basket.component.html',
  styleUrls: ['./basket.component.css']
})
export class BasketComponent {
  basket_items: BasketItem[] = [];
  totalAmount: number;
  basketItems: BasketItem[];
  table?: TableScan|any;
  order_initiated?: OrderInitiated;
  order_remarks = '';
  restaurant: any;

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
  }

  // Adds an item to the basket
  addItem(item: BasketItem) {
    this.basketService.addItem({
      itemId: item.itemId,
      itemName: item.itemName,
      basePrice: item.basePrice,
      totalPrice: item.totalPrice,
      quantity: 1,
      options: item.options,
      extras: item.extras
    });
    this.updateCart();
  }

  // Removes an item from the basket
  removeItem(itemId: string, options: SelectedOption[] = []) {
    this.basketService.removeItem(itemId, options);
    this.updateCart();
    if (this.basketItems.length === 0) {
      this.loc.back(); // Navigate back if the basket is empty
    }
  }

  // Updates basketItems and totalAmount after adding/removing items
  updateCart() {
    this.basketItems = this.basketService.Basket().items;
    this.totalAmount = this.basketService.Basket().totalAmount;
  }

  // Initiates an order
  initiateOrder() {
    const ref = this.dialog.openModal({
      title: 'Confirm Order',
      message: 'Are you sure you want to place this order?',
      submitButtonText: 'Order',
    }).subscribe((response: any) => {
      if (response?.action === 'yes') {
/*         const orderPayload = {
          restaurant: this.restaurant.id,
          table: this.table?.id,
          items: this.basketItems.map((item) => ({
            item: item.itemId,
            quantity: item.quantity,
            options: item.options.map((opt) => ({
              optionName: opt.optionName,
              choice: opt.choice,
              cost: opt.cost,
            })),
          })),
          order_remarks: this.order_remarks,
        }; */
      const orderPayload = {
        restaurant: this.restaurant.id,
        table: this.table?.id,
        order_remarks: this.order_remarks,
        items: this.basketItems.map((item) => ({
          
          item: item.itemId,
          quantity: item.quantity,

          // ✅ Transform options array → { optionIndex: [choiceIndex] }
          options: item.options.reduce((acc: { [key: number]: number[] }, opt: any) => {
            acc[opt.optionIndex] = [opt.choiceIndex];
            return acc;
          }, {}),

          // ✅ Transform extras → array of extra IDs
          extras: item.extras.map(extra => extra.id)
        })),
      };
        // API call to initiate the order
        this.api.postPatch('orders/initiate/', orderPayload, 'post',null,{},false,'v2').subscribe(
          (response: any) => {
            if (response.status === 200) {
              this.order_initiated = response.data;
              if (this.order_initiated?.order_details.no_unavailable_items === 0) {
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
  
    const optionsCost = item.options?.reduce((sum, opt) => sum + (opt.cost || 0), 0) || 0;
    const extrasCost = item.extras?.reduce((sum, ex) => sum + (ex.cost || 0), 0) || 0;
  
    return (item.originalBasePrice + optionsCost + extrasCost) * item.quantity;
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
      order: this.order_initiated?.order_details.id,
    };

    this.api.postPatch('orders/submit/', payload, 'put').subscribe(
      (response: any) => {
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
  getSubtotalOld(item: BasketItem): number {
    const optionsCost = item.options?.reduce((sum: number, opt: any) => sum + (opt.cost || 0), 0) || 0;
    const extrasCost = item.extras?.reduce((sum: number, ex: any) => sum + (ex.cost || 0), 0) || 0;
    const singleItemTotal = item.basePrice + optionsCost + extrasCost;
    return singleItemTotal * item.quantity;
  }
  getSubtotal(item: BasketItem): number {
    const optionsCost = item.options?.reduce((sum: number, opt: any) => sum + (opt.cost || 0), 0) || 0;
    const extrasCost = item.extras?.reduce((sum: number, ex: any) => sum + (ex.cost || 0), 0) || 0;
    const effectiveBasePrice = item.basePrice; // already discounted if applicable
  
    return (effectiveBasePrice + optionsCost + extrasCost) * item.quantity;
  }
  
  shouldShowSubtotal(item: BasketItem): boolean {
    return this.basketItems.length > 1 && item.quantity > 1;
  }
  
  showItemTotal(item: BasketItem) {
   return item.options.some(option => option.cost > 0)
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
