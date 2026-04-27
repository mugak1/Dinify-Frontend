import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Subscription } from 'rxjs';

import { UpsellService } from '../../services/upsell.service';
import { MenuService } from '../../services/menu.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { UpsellConfig, UpsellItem, MenuItem, MenuSectionListItem } from 'src/app/_models/app.models';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { SwitchComponent } from 'src/app/_shared/ui/switch/switch.component';
import { CardComponent } from 'src/app/_shared/ui/card/card.component';
import { SafeArrayPipe } from 'src/app/_shared/ui/safe-array.pipe';
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
    SafeArrayPipe,
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
    private toast: ToastService
  ) {}

  ngOnInit(): void {
    // Items, sections, and upsell config are already loaded by the parent
    // MenuComponent when the menu page mounts. We just subscribe to the
    // streams here. If a future refactor changes that ordering, this tab
    // will appear empty until the parent fetches resolve.

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
    this.upsellService.updateConfig({ id: this.config.id, enabled }).subscribe((res) => {
      this.toast.success(enabled ? 'Upsells enabled' : 'Upsells disabled');
      if (res?.data) this.upsellService.setConfigLocally(res.data);
    });
  }

  onTitleBlur(): void {
    if (!this.config || this.localTitle === this.config.title) return;
    this.upsellService.updateConfig({ id: this.config.id, title: this.localTitle }).subscribe((res) => {
      this.toast.success('Title updated');
      if (res?.data) this.upsellService.setConfigLocally(res.data);
    });
  }

  onMaxItemsChange(value: string): void {
    if (!this.config) return;
    this.upsellService.updateConfig({ id: this.config.id, max_items_to_show: +value }).subscribe((res) => {
      this.toast.success('Display settings updated');
      if (res?.data) this.upsellService.setConfigLocally(res.data);
    });
  }

  onHideIfInBasketChange(value: boolean): void {
    if (!this.config) return;
    this.upsellService.updateConfig({ id: this.config.id, hide_if_in_basket: value }).subscribe((res) => {
      this.toast.success('Display settings updated');
      if (res?.data) this.upsellService.setConfigLocally(res.data);
    });
  }

  onHideOutOfStockChange(value: boolean): void {
    if (!this.config) return;
    this.upsellService.updateConfig({ id: this.config.id, hide_out_of_stock: value }).subscribe((res) => {
      this.toast.success('Display settings updated');
      if (res?.data) this.upsellService.setConfigLocally(res.data);
    });
  }

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  onAddItems(itemIds: string[]): void {
    if (!this.config) return;
    this.upsellService.addItems(this.config.id, itemIds).subscribe((res) => {
      this.addModalOpen = false;
      this.toast.success(`${itemIds.length} item${itemIds.length !== 1 ? 's' : ''} added`);
      if (res?.data) this.upsellService.setConfigLocally(res.data);
    });
  }

  onRemoveItem(item: UpsellItem): void {
    this.upsellService.removeItem(item.id).subscribe((res) => {
      this.toast.success('Item removed');
      if (res?.data) this.upsellService.setConfigLocally(res.data);
    });
  }

  onDrop(event: CdkDragDrop<UpsellItem[]>): void {
    if (!this.config) return;
    const items = [...this.config.items];
    moveItemInArray(items, event.previousIndex, event.currentIndex);
    // Optimistic update
    this.config = { ...this.config, items };
    const itemIds = items.map(i => i.id);
    this.upsellService.reorderItems(this.config.id, itemIds).subscribe((res) => {
      if (res?.data) this.upsellService.setConfigLocally(res.data);
    });
  }

  getUpsellItemImage(item: UpsellItem): string {
    if (!item.item_image) return '';
    if (item.item_image.startsWith('http')) return item.item_image;
    return environment.apiUrl + item.item_image;
  }

  trackByUpsellItemId(_index: number, item: UpsellItem): string {
    return item.id;
  }
}
