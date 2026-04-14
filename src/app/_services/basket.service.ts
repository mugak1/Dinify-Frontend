import { Injectable,signal} from '@angular/core';
import { BasketItem, ShoppingBasket, SelectedOption } from '../_models/app.models';

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

  // Adds an item to the basket with support for options and choices
  public addItem(item: BasketItem) {
    this.Basket.update((currentBasket) => {
      const existingItem = currentBasket.items.find(
        (i) =>
          i.itemId === item.itemId &&
          JSON.stringify(i.options) === JSON.stringify(item.options) // Match item with its exact options
      );

      if (existingItem) {
        // Increment quantity if the exact item with the same options already exists
        existingItem.quantity += item.quantity;
      } else {
        // Add the new item with its options to the basket
        currentBasket.items.push(item);
      }

      // Update the total amount
      currentBasket.totalAmount = this.calculateTotalAmount(currentBasket.items);

      return currentBasket;
    });
  }

  // Removes an item or decreases its quantity
  public removeItem(itemId: string, options: SelectedOption[] = []) {
    this.Basket.update((currentBasket) => {
      const item = currentBasket.items.find(
        (i) =>
          i.itemId === itemId &&
          JSON.stringify(i.options) === JSON.stringify(options) // Match the exact item and options
      );

      if (item) {
        if (item.quantity === 1) {
          // Remove the item completely if quantity is 1
          currentBasket.items = currentBasket.items.filter(
            (i) => i !== item
          );
        } else {
          // Decrease the quantity
          item.quantity -= 1;
        }

        // Update the total amount
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

