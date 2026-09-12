import { Injectable, WritableSignal } from '@angular/core';
import { BasketItem, ShoppingBasket, SelectedModifier } from '../_models/app.models';
import { SessionStorageService } from './storage/session-storage.service';
import { persistedSignal } from './storage/persisted-state';
import { fromMinorUnits } from '../_shared/utils/decimal-money';
import {
  PricedLineParts,
  basketTotalMinor,
} from '../_shared/order/line-money';

/**
 * Canonical identity of a basket line (D03, the client half).
 *
 * `JSON.stringify` was the old comparison, and it made identity depend on
 * INSERTION ORDER: a diner who picked "Cheese then Bacon" got a different basket
 * line from one who picked "Bacon then Cheese", the server then merged the two
 * into one row, and the basket, the confirmation and the kitchen ticket all
 * disagreed about how many lines there were.
 *
 * This mirrors the server's rule exactly — same dish, same complete modifier
 * selection, same complete extras — with every collection sorted so order cannot
 * decide it, and it is built from IDs alone. Labels and prices are display
 * values and must never be part of identity.
 */
function lineIdentity(item: {
  itemId: string;
  selectedModifiers?: SelectedModifier[] | null;
  extras?: { id: string }[] | null;
}): string {
  const modifiers = (item.selectedModifiers ?? [])
    .map((group) => ({
      g: String(group.groupId),
      // De-duplicated and sorted, matching the server's canonical form: a
      // repeated choice is one selection there, so it must be here too.
      c: Array.from(new Set((group.choices ?? []).map((choice) => String(choice.id)))).sort(),
    }))
    .filter((group) => group.c.length > 0)
    .sort((a, b) => (a.g < b.g ? -1 : a.g > b.g ? 1 : 0));
  const extras = (item.extras ?? []).map((extra) => String(extra.id)).sort();
  return JSON.stringify({ i: String(item.itemId), m: modifiers, e: extras });
}

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
   *
   * It is NEVER re-minted because a response was lost, a quote comparison
   * failed, or a request timed out: a new key would turn one attempt into two
   * orders, which is precisely the failure the key exists to prevent.
   */
  private clientOrderId: string | null = null;

  /**
   * Monotonic revision of the basket's CONTENTS. Every mutator bumps it, so a
   * server quote can be tied to the basket it was priced for and a response
   * that arrives after an edit can be recognised as describing something the
   * diner is no longer looking at.
   *
   * A revision is necessary but NOT sufficient on its own — the checkout
   * context (restaurant and table) can change without the basket doing so, and
   * the component guards that separately.
   */
  private revisionCounter = 0;

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

  /** The current basket revision. Bumped by every content change. */
  public revision(): number {
    return this.revisionCounter;
  }

  private changed(): void {
    this.revisionCounter += 1;
    this.resetClientOrderId();
  }

  // Calculates the total amount of the basket
  /**
   * The basket's payable total, through the SHARED EXACT HELPER.
   *
   * It was `Σ totalPrice * quantity` in ordinary doubles. That is the figure the
   * checkout button states and the figure `quoteDiffersFromBasket` compares
   * against the server's, so the one number most likely to disagree with the
   * server was produced by the one arithmetic that cannot represent it: two
   * sub-cent modifier adjustments on a 1000 base give 1002.0099999999999, not
   * the server's 1002.00.
   *
   * It recomputes from the line's COMPONENTS rather than trusting the stored
   * `totalPrice`, so a basket persisted by an older build is re-derived exactly
   * rather than having its rounding carried forward.
   */
  public calculateTotalAmount(items: BasketItem[]): number {
    return this.totalState(items).amount;
  }

  /**
   * THE BASKET TOTAL AND WHETHER IT IS EXACT — an explicit state, not a silent
   * fallback.
   *
   * The exact helper returning `null` used to drop straight back to the old
   * `Σ totalPrice * quantity` double arithmetic and hand the result back as an
   * ordinary total, so a figure the client had just established it could not
   * represent was displayed with the same confidence as one it could.
   *
   * WHAT THE DINER SEES BEFORE A SERVER QUOTE. When `exact` is false the basket
   * still shows a number — a basket restored from browser storage is not the
   * place to start refusing to show anything — but it is labelled an ESTIMATE
   * and says the restaurant's price is confirmed at checkout. It is never
   * described as the amount payable, and checkout is NOT blocked: the server
   * prices the order and the review sheet states the server's amount, which is
   * the only figure the diner is ever asked to confirm.
   *
   * THE ESTIMATE IS THE SAME ARITHMETIC AS BEFORE, deliberately. Replacing it
   * with `0`, a blank or a stored `totalAmount` would each be a worse answer;
   * this keeps a legacy basket behaving exactly as it did and only changes what
   * the screen CLAIMS about the number.
   *
   * A LEGACY BASKET IS NOT AN INEXACT ONE. `line-money` parses the existing
   * stored numeric shapes deliberately — finite numbers and decimal strings —
   * and an absent optional adjustment whose established meaning is zero
   * (`additionalCost`, an extra's `cost`) is read as zero rather than as
   * malformed. `exact` goes false only for a component that genuinely cannot be
   * represented: missing, non-numeric, non-finite, out of range, or a
   * fractional or negative quantity. No stored basket is migrated.
   */
  public totalState(items: BasketItem[]): { amount: number; exact: boolean } {
    const exact = fromMinorUnits(basketTotalMinor(items as PricedLineParts[]));
    if (exact !== null) return { amount: exact, exact: true };
    return {
      amount: (items || []).reduce(
        (total, item) => total + item.totalPrice * item.quantity, 0),
      exact: false,
    };
  }

  // Adds an item to the basket with support for modifiers and extras
  public addItem(item: BasketItem) {
    this.changed();
    this.Basket.update((currentBasket) => {
      const identity = lineIdentity(item);
      const existingItem = currentBasket.items.find(
        (i) => lineIdentity(i) === identity,
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

  /**
   * Removes one unit of the line matching this FULL variant, or the whole line
   * when it would reach 0.
   *
   * `extras` is part of the match. It used to be ignored entirely, so removing
   * from a basket holding two variants of one dish that differ only by their
   * extras removed whichever happened to come first — a different dish from the
   * one the diner pointed at.
   */
  public removeItem(
    itemId: string,
    selectedModifiers: SelectedModifier[] = [],
    extras: { id: string }[] = [],
  ) {
    this.changed();
    this.Basket.update((currentBasket) => {
      const identity = lineIdentity({ itemId, selectedModifiers, extras });
      const item = currentBasket.items.find((i) => lineIdentity(i) === identity);

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
    this.changed();
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
   *  incrementItem.
   *
   *  DECREMENT IS ALWAYS ALLOWED, even from a state the server would refuse: a
   *  restored basket can hold a line above the per-line ceiling, and the diner
   *  must be able to bring it back down. */
  public decrementItem(index: number): void {
    this.changed();
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
    this.changed();
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
    this.changed();
    this.Basket.update(() => ({
      items: [],
      totalAmount: 0,
    }));
  }

  /** Mint-once / reuse the current checkout idempotency key. */
  public getOrCreateClientOrderId(): string {
    return (this.clientOrderId ??= crypto.randomUUID());
  }

  /**
   * Drop the idempotency key (basket changed or order completed).
   *
   * Deliberately NOT called on a lost response, a timeout or a failed quote
   * comparison: the whole point of the key is that an attempt whose outcome is
   * unknown retries as the SAME attempt.
   */
  public resetClientOrderId(): void {
    this.clientOrderId = null;
  }
}
