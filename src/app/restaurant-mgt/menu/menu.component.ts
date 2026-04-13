import { Component, HostListener } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MenuItem, MenuSectionListItem, RestaurantDetail } from 'src/app/_models/app.models';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { MenuService, SortMode } from './services/menu.service';
import { TagService } from './services/tag.service';
import { CartService } from './services/cart.service';
import { UpsellService } from './services/upsell.service';

@Component({
    selector: 'app-menu',
    templateUrl: './menu.component.html',
    styleUrls: ['./menu.component.css'],
    standalone: false,
    host: { class: 'flex flex-col h-full overflow-hidden' }
})
export class MenuComponent {

  restaurant = '';
  restaurantProfile?: RestaurantDetail;

  // Dialog state
  sectionFormOpen = false;
  sectionDeleteOpen = false;
  editingSection?: MenuSectionListItem;

  itemFormOpen = false;
  editingItem?: MenuItem;

  itemDeleteOpen = false;
  deletingItem?: MenuItem;

  searchOpen = false;
  presetTagsOpen = false;

  // Preview drawer
  previewOpen = false;

  // Tabs
  activeTab: 'sections' | 'upsells' = 'sections';

  // Sort
  sortMode: SortMode = 'manual';

  // Observables for template
  sections$ = this.menuService.sections$;
  selectedSectionId$ = this.menuService.selectedSectionId$;

  // Approval bar
  isThirdChild = false;

  constructor(
    private route: ActivatedRoute,
    public auth: AuthenticationService,
    private menuService: MenuService,
    private tagService: TagService,
    private cartService: CartService,
    private upsellService: UpsellService
  ) {
    const depth = this.route.pathFromRoot.length;
    this.isThirdChild = (depth === 5);

    if (this.auth.currentRestaurantRole?.restaurant_id) {
      this.restaurant = this.auth.currentRestaurantRole.restaurant_id;
      this.menuService.loadSections(this.restaurant);
      this.menuService.loadAllItems(this.restaurant);
      this.tagService.loadPresetTags(this.restaurant);
      this.upsellService.loadConfig(this.restaurant);
    } else if (this.route.parent?.snapshot.params['id']) {
      this.restaurant = this.route.parent.snapshot.params['id'];
      this.loadRestaurant();
      this.menuService.loadSections(this.restaurant);
      this.menuService.loadAllItems(this.restaurant);
      this.tagService.loadPresetTags(this.restaurant);
      this.upsellService.loadConfig(this.restaurant);
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
      event.preventDefault();
      this.searchOpen = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Restaurant
  // ---------------------------------------------------------------------------

  private loadRestaurant(): void {
    this.menuService.loadRestaurantDetails(this.restaurant).subscribe((res) => {
      if (this.auth.currentRestaurantRole?.restaurant_id) {
        this.auth.setCurrentRestaurant(res.data);
      } else {
        this.restaurantProfile = res.data as any;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Section form
  // ---------------------------------------------------------------------------

  openSectionForm(sectionId?: string): void {
    if (sectionId) {
      const sections = this.menuService.getSectionsSnapshot();
      this.editingSection = sections.find(s => s.id === sectionId);
    } else {
      this.editingSection = undefined;
    }
    this.sectionFormOpen = true;
  }

  closeSectionForm(): void {
    this.sectionFormOpen = false;
    this.editingSection = undefined;
  }

  onSectionSaved(payload: any): void {
    // Close dialog immediately
    this.closeSectionForm();

    const op = payload.id
      ? this.menuService.updateSection(payload)
      : this.menuService.createSection(payload);

    op.subscribe({
      next: () => {
        this.menuService.loadSections(this.restaurant);
      },
      error: () => {
        this.menuService.loadSections(this.restaurant);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Section delete
  // ---------------------------------------------------------------------------

  confirmDeleteSection(sectionId: string): void {
    const sections = this.menuService.getSectionsSnapshot();
    this.editingSection = sections.find(s => s.id === sectionId);
    this.sectionDeleteOpen = true;
  }

  closeSectionDelete(): void {
    this.sectionDeleteOpen = false;
    this.editingSection = undefined;
  }

  onSectionDeleted(): void {
    if (!this.editingSection) return;
    const section = this.editingSection;

    // 1. Close dialog immediately
    this.closeSectionDelete();

    // 2. Remove from local state instantly
    this.menuService.removeSectionLocally(section.id);

    // 3. If the deleted section was selected, select the first remaining section
    const remaining = this.menuService.getSectionsSnapshot();
    if (remaining.length > 0) {
      this.menuService.selectSection(remaining[0].id);
    }

    // 4. API call in background
    this.menuService.deleteSection(section.id, 'Deleted by user').subscribe({
      error: () => {
        this.menuService.refreshAll();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Item form
  // ---------------------------------------------------------------------------

  openItemForm(item?: MenuItem): void {
    this.editingItem = item ?? undefined;
    this.itemFormOpen = true;
  }

  closeItemForm(): void {
    this.itemFormOpen = false;
    this.editingItem = undefined;
  }

  onItemSaved(payload: any): void {
    // Close dialog immediately — user doesn't need to wait
    this.closeItemForm();

    const op = payload.id
      ? this.menuService.updateItem(payload)
      : this.menuService.createItem(payload);

    op.subscribe({
      next: () => {
        this.menuService.refreshAll();
      },
      error: () => {
        this.menuService.refreshAll();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Item delete
  // ---------------------------------------------------------------------------

  confirmDeleteItem(item: MenuItem): void {
    this.deletingItem = item;
    this.itemDeleteOpen = true;
  }

  closeItemDelete(): void {
    this.itemDeleteOpen = false;
    this.deletingItem = undefined;
  }

  onItemDeleted(): void {
    if (!this.deletingItem) return;
    const item = this.deletingItem;

    // 1. Close dialog immediately
    this.closeItemDelete();

    // 2. Remove from local state instantly — UI updates now
    this.menuService.removeItemLocally(item.id);

    // 3. API call in background
    this.menuService.deleteItem(item.id, 'Deleted by user').subscribe({
      error: () => {
        // Revert: re-fetch to restore the item
        this.menuService.refreshAll();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Menu approval
  // ---------------------------------------------------------------------------

  approveMenu(status: string): void {
    const data = {
      restaurant: this.restaurant,
      decision: status,
      reason: ''
    };
    this.menuService.submitFirstTimeReview(data).subscribe(() => {
      this.loadRestaurant();
    });
  }

  // ---------------------------------------------------------------------------
  // Sort
  // ---------------------------------------------------------------------------

  onSortModeChange(mode: SortMode): void {
    this.sortMode = mode;
    this.menuService.setSortMode(mode);
  }

  // ---------------------------------------------------------------------------
  // Mobile section selector
  // ---------------------------------------------------------------------------

  onMobileSectionChange(sectionId: string): void {
    this.menuService.selectSection(sectionId);
  }

  // ---------------------------------------------------------------------------
  // Preview menu drawer
  // ---------------------------------------------------------------------------

  closePreview(): void {
    this.previewOpen = false;
    this.cartService.clearCart();
  }
}
