import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, combineLatest } from 'rxjs';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { DialogComponent } from 'src/app/_shared/ui/dialog/dialog.component';
import { MenuService, SortMode } from '../../services/menu.service';
import { CartService } from '../../services/cart.service';
import { TagService, PresetTag } from '../../services/tag.service';
import { UpsellService } from '../../services/upsell.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { CartItem } from '../../models/cart.model';
import { MenuSectionListItem } from 'src/app/_models/app.models';
import {
  formatUGX,
  getCurrentPrice,
  isDiscountActive,
  getDiscountBadgeText,
  calculateSavings,
} from '../../utils/price-utils';
import { getTagColorClasses, getTagIcon } from 'src/app/_common/utils/tag-utils';
import { isSectionCurrentlyActive } from '../../utils/schedule-utils';
import { environment } from 'src/environments/environment';
import { ItemDetailViewComponent } from '../item-detail-view/item-detail-view.component';
import { TagFilterSheetComponent } from '../tag-filter-sheet/tag-filter-sheet.component';
import { UpsellCarouselComponent } from '../upsell-carousel/upsell-carousel.component';
import { ScrollSpyCommonDirective } from 'src/app/_common/scroll-spy-common.directive';

type DrawerView = 'list' | 'detail' | 'cart';

@Component({
  selector: 'app-preview-menu-drawer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    DialogComponent,
    ItemDetailViewComponent,
    TagFilterSheetComponent,
    UpsellCarouselComponent,
    ScrollSpyCommonDirective,
  ],
  templateUrl: './preview-menu-drawer.component.html',
})
export class PreviewMenuDrawerComponent implements OnInit, OnDestroy, OnChanges {
  @Input() open = false;
  @Output() closed = new EventEmitter<void>();

  @ViewChild('scrollContent') scrollContent!: ElementRef<HTMLDivElement>;
  @ViewChild('stickyHeader') stickyHeader!: ElementRef<HTMLDivElement>;

  // State
  view: DrawerView = 'list';
  searchTerm = '';
  showSearch = false;
  activeSection = '';
  isLoading = false;
  selectedItem: any = null;
  editingCartItem: CartItem | null = null;
  selectedTags: string[] = [];
  showTagFilter = false;
  itemToRemove: CartItem | null = null;
  returnToCart = false;

  // Data
  sections: MenuSectionListItem[] = [];
  allItems: any[] = [];
  cartItems: CartItem[] = [];
  presetTags: PresetTag[] = [];
  sortMode: SortMode = 'manual';

  imageBaseUrl = environment.apiUrl;

  private dataSub?: Subscription;
  private cartSub?: Subscription;

  constructor(
    private menuService: MenuService,
    public cartService: CartService,
    private tagService: TagService,
    private upsellService: UpsellService,
    private toast: ToastService
  ) {}

  ngOnInit(): void {
    this.dataSub = combineLatest([
      this.menuService.sections$,
      this.menuService.allItems$,
      this.tagService.presetTags$,
      this.menuService.sortMode$,
      this.menuService.isLoading$,
    ]).subscribe(([sections, allItems, presetTags, sortMode, isLoading]) => {
      this.sections = sections;
      this.allItems = allItems;
      this.presetTags = presetTags;
      this.sortMode = sortMode;
      this.isLoading = isLoading;
    });

    this.cartSub = this.cartService.items$.subscribe(items => {
      this.cartItems = items;
    });
  }

  ngOnDestroy(): void {
    this.dataSub?.unsubscribe();
    this.cartSub?.unsubscribe();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']) {
      if (this.open) {
        this.view = 'list';
        this.searchTerm = '';
        this.showSearch = false;
        this.selectedItem = null;
        this.editingCartItem = null;
        this.selectedTags = [];
        this.showTagFilter = false;
        this.itemToRemove = null;
        this.returnToCart = false;
        setTimeout(() => {
          if (this.activeSection) return;
          if (this.featuredItems.length > 0) {
            this.activeSection = 'featured';
          } else if (this.availableSections.length > 0) {
            this.activeSection = this.availableSections[0].id;
          }
        }, 200);
      }
    }
  }

  // ─── Computed ────────────────────────────────────────────────────

  get availableSections(): MenuSectionListItem[] {
    return this.sections.filter(s => s.available && isSectionCurrentlyActive(s));
  }

  get filterableTags(): PresetTag[] {
    return this.presetTags.filter(t => t.filterable);
  }

  get totalItems(): number {
    return this.cartService.getTotalItems();
  }

  get totalPrice(): number {
    return this.cartService.getTotalPrice();
  }

  get originalTotal(): number {
    return this.cartService.getOriginalTotal();
  }

  get totalSavings(): number {
    return this.cartService.getTotalSavings();
  }

  // ─── Featured Items ─────────────────────────────────────────────

  get featuredItems(): any[] {
    const activeSectionIds = new Set(this.availableSections.map(s => s.id));
    let featured = this.allItems.filter(
      i => i.is_featured && i.available && activeSectionIds.has(i.section)
    );

    if (this.selectedTags.length > 0) {
      featured = featured.filter(item =>
        this.selectedTags.some(tag => item.allergens?.includes(tag))
      );
    }

    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      featured = featured.filter(
        i =>
          i.name?.toLowerCase().includes(term) ||
          i.description?.toLowerCase().includes(term)
      );
    }

    return this.sortItems(featured);
  }

  // ─── Section Items ──────────────────────────────────────────────

  getAvailableItems(sectionId: string): any[] {
    const sectionItems = this.allItems.filter(
      i => i.section === sectionId && i.available
    );
    return this.sortItems(sectionItems);
  }

  getFilteredItems(sectionId: string): any[] {
    let items = this.getAvailableItems(sectionId);

    if (this.selectedTags.length > 0) {
      items = items.filter(item =>
        this.selectedTags.some(tag => item.allergens?.includes(tag))
      );
    }

    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      items = items.filter(
        i =>
          i.name?.toLowerCase().includes(term) ||
          i.description?.toLowerCase().includes(term)
      );
    }

    return items;
  }

  shouldShowSection(sectionId: string): boolean {
    if (this.searchTerm || this.selectedTags.length > 0) {
      return this.getFilteredItems(sectionId).length > 0;
    }
    return true;
  }

  get hasAnyResults(): boolean {
    if (this.featuredItems.length > 0) return true;
    return this.availableSections.some(s => this.getFilteredItems(s.id).length > 0);
  }

  private sortItems(items: any[]): any[] {
    const sorted = [...items];
    switch (this.sortMode) {
      case 'a-z':
        return sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      case 'price-low':
        return sorted.sort((a, b) => (parseFloat(a.primary_price) || 0) - (parseFloat(b.primary_price) || 0));
      case 'price-high':
        return sorted.sort((a, b) => (parseFloat(b.primary_price) || 0) - (parseFloat(a.primary_price) || 0));
      default:
        return sorted.sort((a, b) => (a.listing_position || 0) - (b.listing_position || 0));
    }
  }

  // ─── Scroll Tracking ────────────────────────────────────────────

  onSectionChange(sectionId: string): void {
    if (!sectionId) return;
    this.activeSection = sectionId === 'sec-featured'
      ? 'featured'
      : sectionId.replace(/^sec-/, '');
  }

  scrollToFeatured(): void {
    this.scrollToSection('featured');
  }

  toggleSearch(): void {
    this.showSearch = !this.showSearch;
    if (!this.showSearch) {
      this.searchTerm = '';
    }
  }

  scrollToSection(sectionId: string): void {
    const container = this.scrollContent?.nativeElement;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`#sec-${sectionId}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.activeSection = sectionId;
  }

  // ─── Item Helpers ───────────────────────────────────────────────

  isOutOfStock(item: any): boolean {
    return item.in_stock === false;
  }

  hasActiveDiscount(item: any): boolean {
    return isDiscountActive(item.discount_details);
  }

  getDiscountBadge(item: any): string {
    return getDiscountBadgeText(item.discount_details, parseFloat(item.primary_price) || 0);
  }

  getItemPrice(item: any): string {
    return formatUGX(getCurrentPrice(item));
  }

  getOriginalPrice(item: any): string {
    return formatUGX(parseFloat(item.primary_price) || 0);
  }

  formatPrice(amount: number): string {
    return formatUGX(amount);
  }

  getTagBadge(tagName: string): { colorClasses: string; iconSvg: string } {
    const preset = this.presetTags.find(p => p.name === tagName);
    return {
      colorClasses: preset ? getTagColorClasses(preset.color) : 'bg-muted text-muted-foreground',
      iconSvg: preset ? getTagIcon(preset.icon) : '',
    };
  }

  /** Filters out empty/blank allergen entries */
  getVisibleAllergens(allergens: string[] | null | undefined): string[] {
    if (!Array.isArray(allergens)) return [];
    return allergens.filter((a: any) => typeof a === 'string' && a.trim().length > 0);
  }

  getDiscountPercent(item: any): number {
    const original = parseFloat(item?.primary_price) || 0;
    const discounted = parseFloat(item?.discount_details?.discount_amount) || 0;
    if (!original || !discounted) return 0;
    return Math.round(((original - discounted) / original) * 100);
  }

  getItemSavingsFromItem(item: any): number {
    return calculateSavings(
      parseFloat(item?.primary_price) || 0,
      item?.discount_details
    );
  }

  getModifierAdditionalCost(modifier: any): number {
    return (modifier.choices || []).reduce((sum: number, c: any) => sum + (c.additionalCost || 0), 0);
  }

  getItemSavings(cartItem: CartItem): number {
    return calculateSavings(
      parseFloat(cartItem.item.primary_price) || 0,
      cartItem.item.discount_details
    ) * cartItem.quantity;
  }

  // ─── Navigation ─────────────────────────────────────────────────

  handleItemClick(item: any): void {
    if (this.isOutOfStock(item)) return;
    this.selectedItem = item;
    this.editingCartItem = null;
    this.returnToCart = false;
    this.view = 'detail';
  }

  handleBackFromDetail(): void {
    if (this.returnToCart) {
      this.view = 'cart';
    } else {
      this.view = 'list';
    }
    this.selectedItem = null;
    this.editingCartItem = null;
    this.returnToCart = false;
  }

  handleAddToCart(event: {
    item: any;
    quantity: number;
    selectedModifiers: any[];
    selectedExtras: any[];
    modifiersTotal: number;
    extrasTotal: number;
  }): void {
    // If editing, remove old item first
    if (this.editingCartItem) {
      this.cartService.removeItem(this.editingCartItem.id);
    }

    this.cartService.addItem(
      event.item,
      event.quantity,
      event.selectedModifiers,
      event.selectedExtras,
      event.modifiersTotal,
      event.extrasTotal
    );

    if (this.returnToCart) {
      this.view = 'cart';
    } else {
      this.view = 'list';
    }
    this.selectedItem = null;
    this.editingCartItem = null;
    this.returnToCart = false;
  }

  openCart(): void {
    this.view = 'cart';
  }

  backToList(): void {
    this.view = 'list';
  }

  handleEditCartItem(cartItem: CartItem): void {
    this.editingCartItem = cartItem;
    this.selectedItem = null;
    this.returnToCart = true;
    this.view = 'detail';
  }

  // ─── Cart Actions ───────────────────────────────────────────────

  decrementQuantity(cartItem: CartItem): void {
    if (cartItem.quantity <= 1) {
      this.itemToRemove = cartItem;
    } else {
      this.cartService.updateQuantity(cartItem.id, cartItem.quantity - 1);
    }
  }

  incrementQuantity(cartItem: CartItem): void {
    this.cartService.updateQuantity(cartItem.id, cartItem.quantity + 1);
  }

  confirmRemove(): void {
    if (this.itemToRemove) {
      this.cartService.removeItem(this.itemToRemove.id);
      this.itemToRemove = null;
    }
  }

  cancelRemove(): void {
    this.itemToRemove = null;
  }

  placeOrder(): void {
    this.toast.info('This is a preview — orders are placed by diners through the QR code menu');
  }

  // ─── Upsell Carousel Events ─────────────────────────────────────

  onUpsellAddItem(item: any): void {
    this.cartService.addItem(item, 1, [], [], 0, 0);
    this.toast.success(`${item.name} added to your order`);
  }

  onUpsellItemNeedsModifiers(item: any): void {
    this.selectedItem = item;
    this.editingCartItem = null;
    this.returnToCart = true;
    this.view = 'detail';
  }

  // ─── Tag Filter ─────────────────────────────────────────────────

  onTagFilterApply(tags: string[]): void {
    this.selectedTags = tags;
  }

  removeTag(tagName: string): void {
    this.selectedTags = this.selectedTags.filter(t => t !== tagName);
  }

  clearAllTags(): void {
    this.selectedTags = [];
  }

  getTagColor(tagName: string): string {
    const preset = this.presetTags.find(p => p.name === tagName);
    return preset ? getTagColorClasses(preset.color) : 'bg-muted text-muted-foreground';
  }

  getTagIconSvg(tagName: string): string {
    const preset = this.presetTags.find(p => p.name === tagName);
    return preset ? getTagIcon(preset.icon) : '';
  }

  // ─── Drawer Actions ─────────────────────────────────────────────

  onClose(): void {
    this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open && !this.showTagFilter && !this.itemToRemove) {
      this.onClose();
    }
  }
}
