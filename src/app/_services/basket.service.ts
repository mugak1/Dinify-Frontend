import { Injectable,signal} from '@angular/core';
import { BasketItem, ShoppingBasket, SelectedModifier } from '../_models/app.models';

@Injectable({
  providedIn: 'root'
})
export class BasketService {
  Basket = signal<ShoppingBasket>({
    items: [],
    totalAmount: 0,
  });

  // Calculates the total amount of the basket
  public calculateTotalAmount(items: BasketItem[]): number {
    return items.reduce((total, item) => total + item.totalPrice * item.quantity, 0);
  }

  // Adds an item to the basket with support for modifiers and extras
  public addItem(item: BasketItem) {
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

  // Replaces a basket item at the given index with a new item.
  // Used when editing an existing basket item's selections.
  public updateItem(index: number, item: BasketItem): void {
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
    this.Basket.update(() => ({
      items: [],
      totalAmount: 0,
    }));
  }
}
