import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Subscription } from 'rxjs';

import { UpsellService } from '../../services/upsell.service';
import { MenuService } from '../../services/menu.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { UpsellConfig, UpsellItem, MenuItem, MenuSectionListItem } from 'src/app/_models/app.models';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { SwitchComponent } from 'src/app/_shared/ui/switch/switch.component';
import { CardComponent } from 'src/app/_shared/ui/card/card.component';
import { AddUpsellItemModalComponent } from '../add-upsell-item-modal/add-upsell-item-modal.component';
import { UpsellPreviewModalComponent } from '../upsell-preview-modal/upsell-preview-modal.component';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-upsells-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DragDropModule,
    ButtonComponent,
    SwitchComponent,
    CardComponent,
    AddUpsellItemModalComponent,
    UpsellPreviewModalComponent,
  ],
  templateUrl: './upsells-tab.component.html',
})
export class UpsellsTabComponent implements OnInit, OnDestroy {

  config: UpsellConfig | null = null;
  localTitle = '';
  addModalOpen = false;
  previewOpen = false;

  allItems: MenuItem[] = [];
  sections: MenuSectionListItem[] = [];

  private subs: Subscription[] = [];

  constructor(
    private upsellService: UpsellService,
    private menuService: MenuService,
    private auth: AuthenticationService,
    private toast: ToastService
  ) {}

  ngOnInit(): void {
    const restaurantId = this.auth.currentRestaurantRole?.restaurant_id;
    if (restaurantId) {
      this.upsellService.loadConfig(restaurantId);
      this.menuService.loadAllItems(restaurantId);
    }

    this.subs.push(
      this.upsellService.config$.subscribe(config => {
        this.config = config;
        this.localTitle = config?.title ?? '';
      }),
      this.menuService.allItems$.subscribe(items => {
        this.allItems = items;
      }),
      this.menuService.sections$.subscribe(sections => {
        this.sections = sections;
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  get upsellMenuItems(): MenuItem[] {
    if (!this.config?.items) return [];
    return this.config.items
      .filter(i => i.menu_item_details)
      .map(i => i.menu_item_details!);
  }

  get addedItemIds(): Set<string> {
    if (!this.config?.items) return new Set();
    return new Set(this.config.items.map(i => i.menu_item));
  }

  getItemImageUrl(item: MenuItem): string {
    if (!item.image) return '';
    if (item.image.startsWith('http')) return item.image;
    return environment.apiUrl + item.image;
  }

  // ---------------------------------------------------------------------------
  // Config updates
  // ---------------------------------------------------------------------------

  onToggleEnabled(enabled: boolean): void {
    if (!this.config) return;
    this.upsellService.updateConfig({ id: this.config.id, enabled }).subscribe(() => {
      this.toast.success(enabled ? 'Upsells enabled' : 'Upsells disabled');
      this.reloadConfig();
    });
  }

  onTitleBlur(): void {
    if (!this.config || this.localTitle === this.config.title) return;
    this.upsellService.updateConfig({ id: this.config.id, title: this.localTitle }).subscribe(() => {
      this.toast.success('Title updated');
      this.reloadConfig();
    });
  }

  onMaxItemsChange(value: string): void {
    if (!this.config) return;
    this.upsellService.updateConfig({ id: this.config.id, max_items_to_show: +value }).subscribe(() => {
      this.toast.success('Display settings updated');
      this.reloadConfig();
    });
  }

  onHideIfInBasketChange(value: boolean): void {
    if (!this.config) return;
    this.upsellService.updateConfig({ id: this.config.id, hide_if_in_basket: value }).subscribe(() => {
      this.toast.success('Display settings updated');
      this.reloadConfig();
    });
  }

  onHideOutOfStockChange(value: boolean): void {
    if (!this.config) return;
    this.upsellService.updateConfig({ id: this.config.id, hide_out_of_stock: value }).subscribe(() => {
      this.toast.success('Display settings updated');
      this.reloadConfig();
    });
  }

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  onAddItems(itemIds: string[]): void {
    if (!this.config) return;
    this.upsellService.addItems(this.config.id, itemIds).subscribe(() => {
      this.addModalOpen = false;
      this.toast.success(`${itemIds.length} item${itemIds.length !== 1 ? 's' : ''} added`);
    });
  }

  onRemoveItem(item: UpsellItem): void {
    this.upsellService.removeItem(item.id).subscribe(() => {
      this.toast.success('Item removed');
    });
  }

  onDrop(event: CdkDragDrop<UpsellItem[]>): void {
    if (!this.config) return;
    const items = [...this.config.items];
    moveItemInArray(items, event.previousIndex, event.currentIndex);
    // Optimistic update
    this.config = { ...this.config, items };
    const itemIds = items.map(i => i.id);
    this.upsellService.reorderItems(this.config.id, itemIds).subscribe();
  }

  getUpsellItemImage(item: UpsellItem): string {
    if (!item.menu_item_details?.image) return '';
    const img = item.menu_item_details.image;
    if (img.startsWith('http')) return img;
    return environment.apiUrl + img;
  }

  trackByUpsellItemId(_index: number, item: UpsellItem): string {
    return item.id;
  }

  private reloadConfig(): void {
    const restaurantId = this.auth.currentRestaurantRole?.restaurant_id;
    if (restaurantId) {
      this.upsellService.loadConfig(restaurantId);
    }
  }
}
