import { Injectable, WritableSignal } from '@angular/core';
import { BasketItem, ShoppingBasket, SelectedModifier } from '../_models/app.models';
import { SessionStorageService } from './storage/session-storage.service';
import { persistedSignal } from './storage/persisted-state';

@Injectable({
  providedIn: 'root'
})
export class BasketService {
  readonly Basket!: WritableSignal<ShoppingBasket>;

  /**
   * Idempotency key for the in-progress checkout. Lazily minted, reused across
   * retries of the same basket, and reset whenever the basket changes (every
   * mutator below) or is cleared — so a changed cart starts a fresh order while
   * a retried submit of an unchanged cart is deduped by the backend.
   */
  private clientOrderId: string | null = null;

  constructor(private sessionStorage: SessionStorageService) {
    this.Basket = persistedSignal<ShoppingBasket>(
      { items: [], totalAmount: 0 },
      {
        storage: this.sessionStorage,
        getKey: () => 'diner.basket',
        validate: (v): v is ShoppingBasket =>
          v != null &&
          typeof v === 'object' &&
          Array.isArray((v as Partial<ShoppingBasket>).items) &&
          typeof (v as Partial<ShoppingBasket>).totalAmount === 'number',
      },
    );
  }

  // Calculates the total amount of the basket
  public calculateTotalAmount(items: BasketItem[]): number {
    return items.reduce((total, item) => total + item.totalPrice * item.quantity, 0);
  }

  // Adds an item to the basket with support for modifiers and extras
  public addItem(item: BasketItem) {
    this.resetClientOrderId();
    this.Basket.update((currentBasket) => {
      const existingItem = currentBasket.items.find(
        (i) =>
          i.itemId === item.itemId &&
          JSON.stringify(i.selectedModifiers) === JSON.stringify(item.selectedModifiers) &&
          JSON.stringify(i.extras) === JSON.stringify(item.extras)
      );

      if (existingItem) {
        existingItem.quantity += item.quantity;
      } else {
        currentBasket.items.push(item);
      }

      currentBasket.totalAmount = this.calculateTotalAmount(currentBasket.items);

      return currentBasket;
    });
  }

  // Removes an item or decreases its quantity
  public removeItem(itemId: string, selectedModifiers: SelectedModifier[] = []) {
    this.resetClientOrderId();
    this.Basket.update((currentBasket) => {
      const item = currentBasket.items.find(
        (i) =>
          i.itemId === itemId &&
          JSON.stringify(i.selectedModifiers) === JSON.stringify(selectedModifiers)
      );

      if (item) {
        if (item.quantity === 1) {
          currentBasket.items = currentBasket.items.filter((i) => i !== item);
        } else {
          item.quantity -= 1;
        }

        currentBasket.totalAmount = this.calculateTotalAmount(currentBasket.items);
      }

      return currentBasket;
    });
  }

  /** Increments the quantity of the basket line at `index` by 1. Operates by
   *  index (not identity) so it is unambiguous when two lines share the same
   *  item and modifiers but differ only by extras. */
  public incrementItem(index: number): void {
    this.resetClientOrderId();
    this.Basket.update((currentBasket) => {
      const item = currentBasket.items[index];
      if (item) {
        item.quantity += 1;
        currentBasket.totalAmount = this.calculateTotalAmount(currentBasket.items);
      }
      return currentBasket;
    });
  }

  /** Decrements the quantity of the basket line at `index` by 1, removing the
   *  line entirely when it would reach 0. Index-based for the same reason as
   *  incrementItem. */
  public decrementItem(index: number): void {
    this.resetClientOrderId();
    this.Basket.update((currentBasket) => {
      const item = currentBasket.items[index];
      if (!item) return currentBasket;
      if (item.quantity <= 1) {
        currentBasket.items = currentBasket.items.filter((_, i) => i !== index);
      } else {
        item.quantity -= 1;
      }
      currentBasket.totalAmount = this.calculateTotalAmount(currentBasket.items);
      return currentBasket;
    });
  }

  // Replaces a basket item at the given index with a new item.
  // Used when editing an existing basket item's selections.
  public updateItem(index: number, item: BasketItem): void {
    this.resetClientOrderId();
    this.Basket.update((currentBasket) => {
      if (index >= 0 && index < currentBasket.items.length) {
        currentBasket.items[index] = item;
        currentBasket.totalAmount = this.calculateTotalAmount(currentBasket.items);
      }
      return currentBasket;
    });
  }

  // Clears the basket
  public clearBasket() {
    this.resetClientOrderId();
    this.Basket.update(() => ({
      items: [],
      totalAmount: 0,
    }));
  }

  /** Mint-once / reuse the current checkout idempotency key. */
  public getOrCreateClientOrderId(): string {
    return (this.clientOrderId ??= crypto.randomUUID());
  }

  /** Drop the idempotency key (basket changed or order completed). */
  public resetClientOrderId(): void {
    this.clientOrderId = null;
  }
}
