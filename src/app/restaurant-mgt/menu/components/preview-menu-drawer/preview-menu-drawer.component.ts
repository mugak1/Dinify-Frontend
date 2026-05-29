import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  computed,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { DialogComponent } from 'src/app/_shared/ui/dialog/dialog.component';
import { SafeArrayPipe } from 'src/app/_shared/ui/safe-array.pipe';
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
} from 'src/app/_shared/utils/price-utils';
import { getTagColorClasses, getTagIcon } from 'src/app/_common/utils/tag-utils';
import { isSectionCurrentlyActive } from '../../utils/schedule-utils';
import { environment } from 'src/environments/environment';
import { ItemDetailViewComponent } from '../item-detail-view/item-detail-view.component';
import { TagFilterSheetComponent } from '../tag-filter-sheet/tag-filter-sheet.component';
import { UpsellCarouselComponent } from '../upsell-carousel/upsell-carousel.component';
import { ScrollSpyCommonDirective } from 'src/app/_common/scroll-spy-common.directive';
import { FeaturedCarouselComponent } from 'src/app/_shared/ui/featured-carousel/featured-carousel.component';
import { TagPillComponent } from 'src/app/_shared/tags/tag-pill.component';
import { TagOverflowPillComponent } from 'src/app/_shared/tags/tag-overflow-pill.component';
import { splitTagsForCard, TagCardSplit } from 'src/app/_shared/tags/tag-truncation';
import { MenuItemTagRef } from 'src/app/_models/app.models';
import { searchMenuItems, matchedDescriptionOnly } from 'src/app/_shared/utils/menu-search';
import { HighlightPipe } from 'src/app/_shared/ui/highlight.pipe';

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
    SafeArrayPipe,
    FeaturedCarouselComponent,
    TagPillComponent,
    TagOverflowPillComponent,
    HighlightPipe,
  ],
  templateUrl: './preview-menu-drawer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreviewMenuDrawerComponent implements OnChanges {
  @Input() open = false;
  @Output() closed = new EventEmitter<void>();

  @ViewChild('scrollContent') scrollContent!: ElementRef<HTMLDivElement>;
  @ViewChild('stickyHeader') stickyHeader!: ElementRef<HTMLDivElement>;

  constructor(
    private menuService: MenuService,
    public cartService: CartService,
    private tagService: TagService,
    private upsellService: UpsellService,
    private toast: ToastService,
    private host: ElementRef<HTMLElement>,
  ) {}

  // Service streams as signals (toSignal handles teardown — no manual subscriptions)
  sections = toSignal(this.menuService.sections$, { initialValue: [] as MenuSectionListItem[] });
  allItems = toSignal(this.menuService.allItems$, { initialValue: [] as any[] });
  presetTags = toSignal(this.tagService.presetTags$, { initialValue: [] as PresetTag[] });
  sortMode = toSignal(this.menuService.sortMode$, { initialValue: 'manual' as SortMode });
  isLoading = toSignal(this.menuService.isLoading$, { initialValue: false });
  cartItems = toSignal(this.cartService.items$, { initialValue: [] as CartItem[] });

  // Local state as signals (so OnPush re-renders when they change)
  searchTerm = signal('');
  selectedTags = signal<string[]>([]);
  activeSection = signal('');

  // State
  view: DrawerView = 'list';
  showSearch = false;
  selectedItem: any = null;
  editingCartItem: CartItem | null = null;
  showTagFilter = false;
  itemToRemove: CartItem | null = null;
  returnToCart = false;

  imageBaseUrl = environment.apiUrl;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']) {
      if (this.open) {
        this.view = 'list';
        this.searchTerm.set('');
        this.showSearch = false;
        this.selectedItem = null;
        this.editingCartItem = null;
        this.selectedTags.set([]);
        this.showTagFilter = false;
        this.itemToRemove = null;
        this.returnToCart = false;
        setTimeout(() => {
          if (this.activeSection()) return;
          if (this.featuredItems().length > 0) {
            this.activeSection.set('featured');
          } else if (this.availableSections().length > 0) {
            this.activeSection.set(this.availableSections()[0].id);
          }
        }, 200);
      }
    }
  }

  // ─── Computed ────────────────────────────────────────────────────

  availableSections = computed<MenuSectionListItem[]>(() =>
    this.sections().filter((s) => s.available && isSectionCurrentlyActive(s)),
  );

  get filterableTags(): PresetTag[] {
    return this.presetTags().filter(t => t.filterable);
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

  featuredItems = computed<any[]>(() => {
    if (this.isSearching()) return [];
    const activeSectionIds = new Set(this.availableSections().map((s) => s.id));
    let featured = this.allItems().filter(
      (i) => i.is_featured && i.available && activeSectionIds.has(i.section),
    );
    featured = featured.filter((item) => this.matchesSelectedTags(item));
    return this.sortItems(featured);
  });

  /** Sections with their tag-filtered, sorted items. Sections that end up with zero
   *  items are DROPPED so the drawer never shows an empty heading (mirrors the diner menu).
   *  Yields nothing during an active search — results flow through searchResults instead. */
  filteredSections = computed<any[]>(() => {
    if (this.isSearching()) return [];
    return this.availableSections()
      .map((section) => {
        const items = this.getAvailableItems(section.id).filter((item) =>
          this.matchesSelectedTags(item),
        );
        return { ...section, items };
      })
      .filter((section) => section.items.length > 0);
  });

  /**
   * Flat, ranked search results (name matches first, then description-only, each
   * in menu order). Built from the tag-filtered available items so tag filters
   * apply before ranking — parity with the diner. Empty when the (trimmed) query
   * is blank. When this is non-empty the browse computeds short-circuit to [],
   * so only one view renders at a time.
   */
  searchResults = computed<any[]>(() => {
    if (!this.searchTerm().trim()) return [];
    const flat: any[] = [];
    for (const section of this.availableSections()) {
      const items = this.getAvailableItems(section.id).filter((item) =>
        this.matchesSelectedTags(item),
      );
      for (const item of items) flat.push(item);
    }
    return searchMenuItems(flat, this.searchTerm());
  });

  /** Active search predicate — drives the browse/search view switch. */
  isSearching = computed<boolean>(() => this.searchTerm().trim().length > 0);

  /** True when the active search matched this item via its description only —
   *  drives the "Contains" chip on the card. */
  descMatchOnly(item: any): boolean {
    return matchedDescriptionOnly(item, this.searchTerm());
  }

  hasAnyResults = computed<boolean>(() =>
    this.isSearching()
      ? this.searchResults().length > 0
      : this.featuredItems().length > 0 || this.filteredSections().length > 0,
  );

  // ─── Section Items ──────────────────────────────────────────────

  getAvailableItems(sectionId: string): any[] {
    const sectionItems = this.allItems().filter(
      i => i.section === sectionId && i.available
    );
    return this.sortItems(sectionItems);
  }

  private sortItems(items: any[]): any[] {
    const sorted = [...items];
    switch (this.sortMode()) {
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
    const id = sectionId === 'sec-featured' ? 'featured' : sectionId.replace(/^sec-/, '');
    this.activeSection.set(id);
    this.scrollActivePillIntoView(id);
  }

  scrollToFeatured(): void {
    this.scrollToSection('featured');
  }

  private scrollActivePillIntoView(id: string): void {
    if (!id) return;
    const pill = this.host.nativeElement.querySelector<HTMLElement>(
      `[data-section-id="${CSS.escape(id)}"]`,
    );
    pill?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }

  toggleSearch(): void {
    this.showSearch = !this.showSearch;
    if (!this.showSearch) {
      this.searchTerm.set('');
    }
  }

  scrollToSection(sectionId: string): void {
    const container = this.scrollContent?.nativeElement;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`#sec-${sectionId}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.activeSection.set(sectionId);
    this.scrollActivePillIntoView(sectionId);
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

  /** Filters out empty/malformed tag entries.
   *
   *  Tags are now structured objects from the restaurant tag catalog (post-PR3);
   *  pre-PR1 menu items had a free-text string[] which we still tolerate
   *  defensively in case a stale cached payload sneaks through. */
  getVisibleTags(tags: MenuItemTagRef[] | any[] | null | undefined): MenuItemTagRef[] {
    if (!Array.isArray(tags)) return [];
    return tags
      .map((t: any): MenuItemTagRef | null => {
        if (t && typeof t === 'object' && t.name) {
          return {
            id: t.id ?? t.name,
            name: t.name,
            category: t.category ?? 'descriptor',
            icon: t.icon ?? null,
            colour: t.colour ?? 'gray',
          };
        }
        return null;
      })
      .filter((t): t is MenuItemTagRef => t !== null);
  }

  /** Per-card tag truncation that mirrors the diner card exactly:
   *  allergens always visible (safety-critical), non-allergens capped at
   *  2 with a "+N" indicator. The detail view renders every tag. */
  getCardTags(tags: MenuItemTagRef[] | any[] | null | undefined): TagCardSplit<MenuItemTagRef> {
    return splitTagsForCard(this.getVisibleTags(tags));
  }

  /** True when the item carries a tag matching the given preset-tag NAME.
   *  selectedTags holds tag names (TagFilterSheetComponent emits names); item.tags
   *  are objects ({id,name,...}) after normalizeMenuItem. Tolerate the legacy string[]
   *  shape defensively — mirrors TagFilterSheetComponent.getItemCount. */
  private itemHasTag(item: any, tagName: string): boolean {
    const tags = Array.isArray(item?.tags) ? item.tags : [];
    return tags.some((t: any) => (typeof t === 'string' ? t : t?.name) === tagName);
  }

  /** True when the item matches the active tag filter (AND-any across selected tags).
   *  No filter selected → always true. */
  private matchesSelectedTags(item: any): boolean {
    return (
      this.selectedTags().length === 0 ||
      this.selectedTags().some((tagName) => this.itemHasTag(item, tagName))
    );
  }

  getDiscountPercent(item: any): number {
    const primary = parseFloat(item?.primary_price) || 0;
    const savings = calculateSavings(primary, item?.discount_details);
    if (primary <= 0 || savings <= 0) return 0;
    return Math.round((savings / primary) * 100);
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
    this.selectedTags.set(tags);
  }

  removeTag(tagName: string): void {
    this.selectedTags.set(this.selectedTags().filter(t => t !== tagName));
  }

  clearAllTags(): void {
    this.selectedTags.set([]);
  }

  getTagColor(tagName: string): string {
    const preset = this.presetTags().find(p => p.name === tagName);
    return preset ? getTagColorClasses(preset.color) : 'bg-muted text-muted-foreground';
  }

  getTagIconSvg(tagName: string): string {
    const preset = this.presetTags().find(p => p.name === tagName);
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
