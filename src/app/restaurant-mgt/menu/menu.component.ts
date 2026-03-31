import { Component, HostListener } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MenuItem, MenuSectionListItem, RestaurantDetail } from 'src/app/_models/app.models';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { MenuService, SortMode } from './services/menu.service';

@Component({
    selector: 'app-menu',
    templateUrl: './menu.component.html',
    styleUrls: ['./menu.component.css'],
    standalone: false
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

  searchOpen = false;

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
    private menuService: MenuService
  ) {
    const depth = this.route.pathFromRoot.length;
    this.isThirdChild = (depth === 5);

    if (this.auth.currentRestaurantRole?.restaurant_id) {
      this.restaurant = this.auth.currentRestaurantRole.restaurant_id;
      this.menuService.loadSections(this.restaurant);
      this.menuService.loadExtras(this.restaurant);
    } else if (this.route.parent?.snapshot.params['id']) {
      this.restaurant = this.route.parent.snapshot.params['id'];
      this.loadRestaurant();
      this.menuService.loadSections(this.restaurant);
      this.menuService.loadExtras(this.restaurant);
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
    const op = payload.id
      ? this.menuService.updateSection(payload)
      : this.menuService.createSection(payload);

    op.subscribe(() => {
      this.closeSectionForm();
      this.menuService.loadSections(this.restaurant);
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

  onSectionDeleted(event: { id: string; reason: string }): void {
    this.menuService.deleteSection(event.id, event.reason).subscribe(() => {
      this.closeSectionDelete();
      this.menuService.loadSections(this.restaurant);
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
    const op = payload.id
      ? this.menuService.updateItem(payload)
      : this.menuService.createItem(payload);

    op.subscribe(() => {
      this.closeItemForm();
      this.menuService.refreshAll();
    });
  }

  // ---------------------------------------------------------------------------
  // Item delete
  // ---------------------------------------------------------------------------

  confirmDeleteItem(item: MenuItem): void {
    this.menuService.deleteItem(item.id, 'Deleted by user').subscribe(() => {
      this.menuService.refreshAll();
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
}
