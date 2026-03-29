import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Observable } from 'rxjs';

import { MenuService } from '../../services/menu.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { MenuItem } from 'src/app/_models/app.models';
import { ItemCardComponent } from '../item-card/item-card.component';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';

@Component({
  selector: 'app-item-list',
  standalone: true,
  imports: [CommonModule, DragDropModule, ItemCardComponent, ButtonComponent],
  templateUrl: './item-list.component.html',
})
export class ItemListComponent {

  @Output() editItem = new EventEmitter<MenuItem>();
  @Output() deleteItem = new EventEmitter<MenuItem>();
  @Output() newItem = new EventEmitter<void>();

  sortedItems$: Observable<MenuItem[]>;
  isLoading$: Observable<boolean>;
  error$: Observable<string | null>;

  skeletons = Array(8);

  constructor(
    private menuService: MenuService,
    private auth: AuthenticationService
  ) {
    this.sortedItems$ = this.menuService.sortedItems$;
    this.isLoading$ = this.menuService.isLoading$;
    this.error$ = this.menuService.error$;
  }

  onDrop(event: CdkDragDrop<MenuItem[]>): void {
    const items = [...this.menuService.getItemsSnapshot()];
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

  onRetry(): void {
    this.menuService.refreshAll();
  }

  trackById(_index: number, item: MenuItem): string {
    return item.id;
  }
}
