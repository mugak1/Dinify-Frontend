import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { CartItem, SelectedModifier, SelectedExtra } from '../models/cart.model';
import { getCurrentPrice } from '../utils/price-utils';

@Injectable({
  providedIn: 'root'
})
export class CartService {

  private readonly itemsSubject = new BehaviorSubject<CartItem[]>([]);
  readonly items$ = this.itemsSubject.asObservable();

  addItem(
    item: any,
    quantity: number,
    selectedModifiers: SelectedModifier[],
    selectedExtras: SelectedExtra[],
    modifiersTotal: number = 0,
    extrasTotal: number = 0
  ): void {
    const currentPrice = getCurrentPrice(item);
    const primaryPrice = parseFloat(item.primary_price) || 0;
    const itemPrice = currentPrice + modifiersTotal;
    const totalPrice = (itemPrice * quantity) + extrasTotal;
    const originalPrice = (primaryPrice + modifiersTotal) * quantity + extrasTotal;

    const cartItem: CartItem = {
      id: `${item.id}-${Date.now()}`,
      item,
      quantity,
      selectedModifiers,
      selectedExtras,
      extrasTotal,
      modifiersTotal,
      itemPrice,
      totalPrice,
      originalPrice,
    };

    this.itemsSubject.next([...this.itemsSubject.getValue(), cartItem]);
  }

  removeItem(cartItemId: string): void {
    const items = this.itemsSubject.getValue().filter(i => i.id !== cartItemId);
    this.itemsSubject.next(items);
  }

  updateQuantity(cartItemId: string, quantity: number): void {
    const items = this.itemsSubject.getValue().map(cartItem => {
      if (cartItem.id === cartItemId) {
        const totalPrice = (cartItem.itemPrice * quantity) + cartItem.extrasTotal;
        const primaryPrice = parseFloat(cartItem.item.primary_price) || 0;
        const originalPrice = (primaryPrice + cartItem.modifiersTotal) * quantity + cartItem.extrasTotal;
        return { ...cartItem, quantity, totalPrice, originalPrice };
      }
      return cartItem;
    });
    this.itemsSubject.next(items);
  }

  updateItem(
    cartItemId: string,
    quantity: number,
    selectedModifiers: SelectedModifier[],
    selectedExtras: SelectedExtra[],
    modifiersTotal: number,
    extrasTotal: number
  ): void {
    const items = this.itemsSubject.getValue().map(cartItem => {
      if (cartItem.id === cartItemId) {
        const currentPrice = getCurrentPrice(cartItem.item);
        const primaryPrice = parseFloat(cartItem.item.primary_price) || 0;
        const itemPrice = currentPrice + modifiersTotal;
        const totalPrice = (itemPrice * quantity) + extrasTotal;
        const originalPrice = (primaryPrice + modifiersTotal) * quantity + extrasTotal;

        return {
          ...cartItem,
          quantity,
          selectedModifiers,
          selectedExtras,
          extrasTotal,
          modifiersTotal,
          itemPrice,
          totalPrice,
          originalPrice,
        };
      }
      return cartItem;
    });
    this.itemsSubject.next(items);
  }

  clearCart(): void {
    this.itemsSubject.next([]);
  }

  getTotalPrice(): number {
    return this.itemsSubject.getValue().reduce((sum, item) => sum + item.totalPrice, 0);
  }

  getTotalItems(): number {
    return this.itemsSubject.getValue().reduce((sum, item) => sum + item.quantity, 0);
  }

  getOriginalTotal(): number {
    return this.itemsSubject.getValue().reduce((sum, item) => sum + item.originalPrice, 0);
  }

  getTotalSavings(): number {
    return this.getOriginalTotal() - this.getTotalPrice();
  }
}
