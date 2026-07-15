/**
 * KitchenStockService — the menu-stock ("86") seam for the kitchen board.
 *
 * Mirrors KitchenOrderService: signal-held state, a restaurant-scoped read, and
 * optimistic PATCH-then-revert writes. The sold-out panel is the only consumer.
 * Toggling `in_stock` never touches the order board (the board shows orders, not
 * the menu) — the diner menu reflects the same column automatically, so this
 * service is fully self-contained.
 */

import { Injectable, computed, signal } from '@angular/core';
import { map } from 'rxjs/operators';

import { ApiResponse } from '../../_models/app.models';
import { ApiService } from '../../_services/api.service';
import { AuthenticationService } from '../../_services/authentication.service';
import { KitchenMenuItem } from '../models/kitchen.models';

/**
 * Pull the item array out of the API envelope. The list may come back as a bare
 * array or wrapped as `{ data: { records: [...] } }` — handle both (same shape
 * contract as the active-orders read).
 */
function extractItems(res: ApiResponse<KitchenMenuItem>): KitchenMenuItem[] {
  const d: any = res?.data;
  if (Array.isArray(d)) return d as KitchenMenuItem[];
  if (Array.isArray(d?.records)) return d.records as KitchenMenuItem[];
  return [];
}

@Injectable({ providedIn: 'root' })
export class KitchenStockService {
  /** Raw item store — the single source of truth for the panel. */
  private readonly _items = signal<KitchenMenuItem[]>([]);

  /** Read-only view of the menu items. */
  readonly items = this._items.asReadonly();

  /** How many items are currently 86'd — drives the board trigger's badge. */
  readonly soldOutCount = computed(() => this._items().filter(i => !i.in_stock).length);

  /** Panel loading state for the initial fetch / refresh. */
  readonly loading = signal(false);

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthenticationService,
  ) {}

  /** The tablet's restaurant — the item list is scoped to it. Reads the
   *  login-selected membership (rest_role), matching KitchenOrderService, so a
   *  multi-restaurant user's sold-out panel tracks the restaurant they chose. */
  private get restaurantId(): string | undefined {
    return this.auth.currentRestaurantRole?.restaurant_id;
  }

  /**
   * Fetch the restaurant's on-menu items into the store. Self-contained: manages
   * the loading flag and, on error, leaves the last-known list intact (a first
   * load surfaces an empty state; a refresh failure keeps the stale list rather
   * than blanking the panel).
   */
  loadItems(): void {
    this.loading.set(true);
    // The backend 400s without a restaurant scope; omit the param entirely when
    // absent so it never serialises as the literal string "undefined".
    const params = this.restaurantId ? { restaurant: this.restaurantId } : {};
    this.api
      .get<KitchenMenuItem>(null, 'kitchen/menu-items/', params)
      .pipe(map(extractItems))
      .subscribe({
        next: items => {
          this._items.set(items);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      });
  }

  /**
   * Flip an item's stock flag (optimistic + PUT + revert on failure). Mirrors
   * KitchenOrderService.togglePriority. The next panel open reconciles with the
   * server; a failed PUT rolls the optimistic flip back.
   */
  toggleStock(id: string, nextInStock: boolean): void {
    const item = this._items().find(i => i.id === id);
    if (!item) return;
    this.patchItem(id, { in_stock: nextInStock });
    this.api
      .postPatch(`kitchen/menu-items/${id}/stock/`, { in_stock: nextInStock }, 'put')
      .subscribe({ error: () => this.revertItem(item) });
  }

  // ── internal ──────────────────────────────────────────────────────────

  private patchItem(id: string, changes: Partial<KitchenMenuItem>): void {
    this._items.update(items =>
      items.map(i => (i.id === id ? { ...i, ...changes } : i)),
    );
  }

  /** Restore an item to its pre-mutation snapshot after a failed PUT. */
  private revertItem(prior: KitchenMenuItem): void {
    this._items.update(items =>
      items.map(i => (i.id === prior.id ? prior : i)),
    );
  }
}
