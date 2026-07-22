import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Observable, Subject, forkJoin } from 'rxjs';
import { map, takeUntil } from 'rxjs/operators';

import { MenuService, SortMode } from '../../services/menu.service';
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
  host: { class: 'flex-1 flex flex-col overflow-hidden min-w-0' }
})
export class ItemListComponent implements OnInit, OnDestroy {

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

  itemReorderMode = false;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private menuService: MenuService,
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

  ngOnInit(): void {
    // Reorder mode only makes sense in manual sort. If the user switches to
    // another sort, silently leave reorder mode.
    this.sortMode$
      .pipe(takeUntil(this.destroy$))
      .subscribe((mode) => {
        if (mode !== 'manual' && this.itemReorderMode) {
          this.itemReorderMode = false;
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleReorderMode(): void {
    this.itemReorderMode = !this.itemReorderMode;
    if (this.itemReorderMode) {
      // Reorder and selection are mutually exclusive.
      this.selectionMode = false;
      this.selectedItemIds.clear();
    }
  }

  onDrop(event: CdkDragDrop<MenuItem[]>): void {
    if (event.previousIndex === event.currentIndex) return;

    // Build the flat DOM order for this section: featured items render
    // first, then regular items. The cdkDropList's previousIndex /
    // currentIndex are positional within this flat ordering.
    const sectionItems = this.menuService.getItemsSnapshot();
    const featured = sectionItems.filter(i => !!i.is_featured);
    const regular = sectionItems.filter(i => !i.is_featured);
    const flat = [...featured, ...regular];

    // Reject cross-group drags (featured ↔ regular) by design:
    // featured-ness is a separate axis, controlled by toggling
    // the badge — not by where you drop. The dragged item snaps back via
    // cdk's default behaviour because we never mutate state here.
    const featuredCount = featured.length;
    const sourceIsFeatured = event.previousIndex < featuredCount;
    const targetIsFeatured = event.currentIndex < featuredCount;
    if (sourceIsFeatured !== targetIsFeatured) return;

    // Compute the new flat order.
    const newOrder = [...flat];
    moveItemInArray(newOrder, event.previousIndex, event.currentIndex);
    const orderedIds = newOrder.map(i => i.id);

    const sectionId = this.menuService.getSelectedSectionId();
    if (!sectionId) return;

    // Optimistic update — UI snaps to new order immediately.
    this.menuService.updateItemsOrderLocally(sectionId, orderedIds);

    // Persist. On error, refresh from backend to revert to the actual state.
    this.menuService.reorderItems(sectionId, orderedIds).subscribe({
      error: () => {
        this.toast.error('Could not save the new order. Refreshing...');
        this.menuService.refreshAll();
      },
    });
  }

  onToggleAvailability(event: { id: string; available: boolean }): void {
    this.menuService.updateItemLocally(event.id, { available: event.available });
    this.menuService.toggleItemAvailability(event.id, event.available).subscribe({
      error: () => {
        this.menuService.updateItemLocally(event.id, { available: !event.available });
      }
    });
  }

  onToggleBadge(event: { id: string; [key: string]: any }, field: 'is_featured' | 'is_popular' | 'is_new'): void {
    this.menuService.updateItemLocally(event.id, { [field]: event[field] });
    this.menuService.toggleItemBadge(event.id, field, event[field]).subscribe({
      error: () => {
        this.menuService.updateItemLocally(event.id, { [field]: !event[field] });
      }
    });
  }

  onToggleStock(event: { id: string; in_stock: boolean }): void {
    this.menuService.updateItemLocally(event.id, { in_stock: event.in_stock });
    this.menuService.toggleItemStock(event.id, event.in_stock).subscribe({
      error: () => {
        this.menuService.updateItemLocally(event.id, { in_stock: !event.in_stock });
      }
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
    if (this.selectionMode) {
      // Reorder and selection are mutually exclusive.
      this.itemReorderMode = false;
    } else {
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

    // Optimistic local update — UI reflects new state immediately.
    ids.forEach(id => this.menuService.updateItemLocally(id, { available }));

    const calls = ids.map((id) =>
      this.menuService.toggleItemAvailability(id, available)
    );

    forkJoin(calls).subscribe({
      next: () => {
        this.selectedItemIds.clear();
        this.selectionMode = false;
      },
      error: () => {
        // Some calls may have succeeded and some failed — safest reconciliation
        // is a single refresh of the items list rather than reverting every id.
        this.menuService.refreshAll();
      }
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

    // Optimistic local update.
    ids.forEach(id => this.menuService.updateItemLocally(id, { [field]: value }));

    const calls = ids.map((id) => this.menuService.toggleItemBadge(id, field, value));

    forkJoin(calls).subscribe({
      next: () => {
        const action = value ? 'Added' : 'Removed';
        this.toast.success(`${action} ${label} badge ${value ? 'to' : 'from'} ${ids.length} item${ids.length !== 1 ? 's' : ''}`);
        this.selectedItemIds.clear();
        this.selectionMode = false;
      },
      error: () => {
        this.menuService.refreshAll();
      }
    });
  }
}
