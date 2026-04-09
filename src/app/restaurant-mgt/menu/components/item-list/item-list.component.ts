import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Observable, forkJoin } from 'rxjs';
import { map } from 'rxjs/operators';

import { MenuService, SortMode } from '../../services/menu.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { MenuItem } from 'src/app/_models/app.models';
import { ItemCardComponent } from '../item-card/item-card.component';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { BulkStockBarComponent } from '../bulk-stock-bar/bulk-stock-bar.component';

@Component({
  selector: 'app-item-list',
  standalone: true,
  imports: [CommonModule, DragDropModule, ItemCardComponent, ButtonComponent, BulkStockBarComponent],
  templateUrl: './item-list.component.html',
})
export class ItemListComponent {

  @Output() editItem = new EventEmitter<MenuItem>();
  @Output() deleteItem = new EventEmitter<MenuItem>();
  @Output() newItem = new EventEmitter<void>();

  sortedItems$: Observable<MenuItem[]>;
  sortMode$: Observable<SortMode>;
  groupedItems$: Observable<{ featured: MenuItem[]; regular: MenuItem[] }>;
  isLoading$: Observable<boolean>;
  error$: Observable<string | null>;

  skeletons = Array(8);

  selectionMode = false;
  selectedItemIds = new Set<string>();

  constructor(
    private menuService: MenuService,
    private auth: AuthenticationService,
    private toast: ToastService
  ) {
    this.sortedItems$ = this.menuService.sortedItems$;
    this.sortMode$ = this.menuService.sortMode$;
    this.isLoading$ = this.menuService.isLoading$;
    this.error$ = this.menuService.error$;
    this.groupedItems$ = this.sortedItems$.pipe(
      map((items) => ({
        featured: items.filter((i) => !!i.is_featured),
        regular: items.filter((i) => !i.is_featured),
      }))
    );
  }

  onDrop(event: CdkDragDrop<MenuItem[]>): void {
    // The DOM renders featured items first, then regular items, as a single
    // cdkDropList. Reorder the matching DOM-order array so previousIndex/
    // currentIndex line up with the rendered sequence.
    const snapshot = this.menuService.getItemsSnapshot();
    const items = [
      ...snapshot.filter((i) => !!i.is_featured),
      ...snapshot.filter((i) => !i.is_featured),
    ];
    moveItemInArray(items, event.previousIndex, event.currentIndex);

    const ordering = items.map((item, i) => ({ id: item.id, listing_position: i + 1 }));
    this.menuService.reorderItems(ordering).subscribe();
  }

  onToggleAvailability(event: { id: string; available: boolean }): void {
    this.menuService.toggleItemAvailability(event.id, event.available).subscribe(() => {
      const restaurantId = this.auth.currentRestaurantRole?.restaurant_id;
      if (restaurantId) {
        this.menuService.refreshAll();
      }
    });
  }

  onToggleBadge(event: { id: string; [key: string]: any }, field: 'is_featured' | 'is_popular' | 'is_new'): void {
    this.menuService.toggleItemBadge(event.id, field, event[field]).subscribe(() => {
      this.menuService.refreshAll();
    });
  }

  onRetry(): void {
    this.menuService.refreshAll();
  }

  trackById(_index: number, item: MenuItem): string {
    return item.id;
  }

  // ---------------------------------------------------------------------------
  // Selection mode
  // ---------------------------------------------------------------------------

  toggleSelectionMode(): void {
    this.selectionMode = !this.selectionMode;
    if (!this.selectionMode) {
      this.selectedItemIds.clear();
    }
  }

  toggleItemSelection(id: string): void {
    if (this.selectedItemIds.has(id)) {
      this.selectedItemIds.delete(id);
    } else {
      this.selectedItemIds.add(id);
    }
  }

  isItemSelected(id: string): boolean {
    return this.selectedItemIds.has(id);
  }

  selectAll(items: MenuItem[]): void {
    items.forEach((item) => this.selectedItemIds.add(item.id));
  }

  clearSelection(): void {
    this.selectedItemIds.clear();
  }

  // ---------------------------------------------------------------------------
  // Bulk actions
  // ---------------------------------------------------------------------------

  markAvailable(): void {
    this.bulkToggle(true);
  }

  markUnavailable(): void {
    this.bulkToggle(false);
  }

  private bulkToggle(available: boolean): void {
    const ids = Array.from(this.selectedItemIds);
    if (ids.length === 0) return;

    const calls = ids.map((id) =>
      this.menuService.toggleItemAvailability(id, available)
    );

    forkJoin(calls).subscribe(() => {
      this.selectedItemIds.clear();
      this.selectionMode = false;
      this.menuService.refreshAll();
    });
  }

  bulkAddBadge(badge: 'featured' | 'popular' | 'new'): void {
    this.bulkBadgeToggle(`is_${badge}` as 'is_featured' | 'is_popular' | 'is_new', true, badge);
  }

  bulkRemoveBadge(badge: 'featured' | 'popular' | 'new'): void {
    this.bulkBadgeToggle(`is_${badge}` as 'is_featured' | 'is_popular' | 'is_new', false, badge);
  }

  private bulkBadgeToggle(field: 'is_featured' | 'is_popular' | 'is_new', value: boolean, label: string): void {
    const ids = Array.from(this.selectedItemIds);
    if (ids.length === 0) return;

    const calls = ids.map((id) => this.menuService.toggleItemBadge(id, field, value));

    forkJoin(calls).subscribe(() => {
      const action = value ? 'Added' : 'Removed';
      this.toast.success(`${action} ${label} badge ${value ? 'to' : 'from'} ${ids.length} item${ids.length !== 1 ? 's' : ''}`);
      this.selectedItemIds.clear();
      this.selectionMode = false;
      this.menuService.refreshAll();
    });
  }
}
