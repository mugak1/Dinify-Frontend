import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';

import { Subscription } from 'rxjs';
import { MenuService } from '../../services/menu.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { SelectedModifier, SelectedExtra } from '../../models/cart.model';
import { MenuItemTagRef, ModifierGroup } from 'src/app/_models/app.models';
import {
  getCurrentPrice,
  formatUGX,
  isDiscountActive,
  getDiscountBadgeText,
  calculateSavings,
  getDiscountPercent,
} from 'src/app/_shared/utils/price-utils';
import { parseModifierGroups } from 'src/app/_common/utils/modifier-utils';
import { TagPillComponent } from 'src/app/_shared/tags/tag-pill.component';
import { PriceDisplayComponent } from 'src/app/_shared/ui/price-display/price-display.component';
import { SavingsIndicatorComponent } from 'src/app/_shared/ui/savings-indicator/savings-indicator.component';
import { DiscountBadgeComponent } from 'src/app/_shared/ui/discount-badge/discount-badge.component';
import { ModifierGroupsSelectorComponent } from 'src/app/_shared/ui/modifier-groups-selector/modifier-groups-selector.component';
import { ExtrasSelectorComponent } from 'src/app/_shared/ui/extras-selector/extras-selector.component';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-item-detail-view',
  standalone: true,
  imports: [
    TagPillComponent,
    PriceDisplayComponent,
    SavingsIndicatorComponent,
    DiscountBadgeComponent,
    ModifierGroupsSelectorComponent,
    ExtrasSelectorComponent
],
  templateUrl: './item-detail-view.component.html',
  host: {
    class: 'flex flex-col h-full min-h-0',
  },
})
export class ItemDetailViewComponent implements OnInit, OnChanges, OnDestroy {
  @Input() item: any = null;
  @Input() editingCartItem: any = null;
  @Input() presetTags: any[] = [];

  @Output() back = new EventEmitter<void>();
  @Output() addToCart = new EventEmitter<{
    item: any;
    quantity: number;
    selectedModifiers: SelectedModifier[];
    selectedExtras: SelectedExtra[];
    modifiersTotal: number;
    extrasTotal: number;
  }>();

  quantity = 1;
  selectedModifiers: Record<string, string[]> = {};
  selectedExtras: string[] = [];
  /** Inline per-group errors for the shared modifier selector (populated on a blocked add,
   *  mirroring the diner item-detail's inline validation instead of the old toast). */
  modifierErrors: Record<string, string> = {};
  allItems: any[] = [];
  imageBaseUrl = environment.apiUrl;

  private allItemsSub!: Subscription;

  constructor(
    private menuService: MenuService,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    this.allItemsSub = this.menuService.allItems$.subscribe(
      (items) => (this.allItems = items)
    );
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['editingCartItem'] && this.editingCartItem) {
      this.prefillFromCartItem(this.editingCartItem);
    }
    if (changes['item'] && this.item && !this.editingCartItem) {
      this.resetState();
    }
  }

  ngOnDestroy(): void {
    this.allItemsSub?.unsubscribe();
  }

  // ── Computed properties ──────────────────────────────────────────────

  get modifierGroups(): ModifierGroup[] {
    if (!this.item) return [];
    return parseModifierGroups(this.item.options);
  }

  get hasModifierGroups(): boolean {
    return this.modifierGroups.length > 0;
  }

  get basePrice(): number {
    return getCurrentPrice(this.item);
  }

  get primaryPrice(): number {
    return parseFloat(this.item?.primary_price) || 0;
  }

  get hasDiscount(): boolean {
    return isDiscountActive(this.item?.discount_details);
  }

  get discountBadgeText(): string {
    return getDiscountBadgeText(this.item?.discount_details, this.primaryPrice);
  }

  get modifiersCost(): number {
    let cost = 0;
    for (const group of this.modifierGroups) {
      const selectedIds = this.selectedModifiers[group.id] || [];
      for (const choiceId of selectedIds) {
        const choice = group.choices.find((c) => c.id === choiceId);
        if (choice) cost += choice.additionalCost;
      }
    }
    return cost;
  }

  get extrasCost(): number {
    let cost = 0;
    for (const extraId of this.selectedExtras) {
      const extraItem = this.allItems.find((mi) => mi.id === extraId);
      if (extraItem) cost += getCurrentPrice(extraItem);
    }
    return cost;
  }

  get totalPrice(): number {
    return (this.basePrice + this.modifiersCost) * this.quantity + this.extrasCost * this.quantity;
  }

  get savings(): number {
    return calculateSavings(this.primaryPrice, this.item?.discount_details) * this.quantity;
  }

  /** Per-unit savings for the price-row pill — mirrors the diner item-detail, which shows the
   *  per-unit save beside the price (not the quantity-scaled total). */
  get unitSavings(): number {
    return calculateSavings(this.primaryPrice, this.item?.discount_details);
  }

  /** Discount percentage for the hero "% off" frosted badge. */
  get discountPercentValue(): number {
    return getDiscountPercent(this.item?.discount_details, this.primaryPrice);
  }

  /** Extras normalised for app-extras-selector (id/name + already-resolved prices). */
  get cardExtras(): Array<{
    id: string;
    name: string;
    effectivePrice: number;
    originalPrice: number;
    isDiscounted: boolean;
  }> {
    return this.extraItems.map((e) => {
      const effective = getCurrentPrice(e);
      const original = parseFloat(e.primary_price) || 0;
      return {
        id: e.id,
        name: e.name,
        effectivePrice: effective,
        originalPrice: original,
        isDiscounted: effective < original,
      };
    });
  }

  get extraItems(): any[] {
    if (!this.item?.has_extras || !this.item.extras) return [];
    const extraIds: string[] = (this.item.extras || []).map((e: any) =>
      typeof e === 'string' ? e : e.id
    );
    return this.allItems.filter(
      (mi) => extraIds.includes(mi.id) && mi.is_extra === true
    );
  }

  get isEditMode(): boolean {
    return !!this.editingCartItem;
  }

  // ── Template helpers ─────────────────────────────────────────────────

  formatPrice(amount: number): string {
    return formatUGX(amount);
  }

  getSelectionHint(group: ModifierGroup): string {
    if (group.selectionType === 'single') {
      return group.required ? 'Choose 1' : 'Choose up to 1';
    }
    if (group.required && group.minSelections > 0) {
      return `Choose ${group.minSelections}\u2013${group.maxSelections}`;
    }
    return `Choose up to ${group.maxSelections}`;
  }

  isModifierSelected(groupId: string, choiceId: string): boolean {
    return (this.selectedModifiers[groupId] || []).includes(choiceId);
  }

  getSelectedCount(groupId: string): number {
    return (this.selectedModifiers[groupId] || []).length;
  }

  isExtraSelected(extraId: string): boolean {
    return this.selectedExtras.includes(extraId);
  }

  /** Coerces the tags payload to MenuItemTagRef[]. Tolerates the legacy
   *  string[] shape defensively, in case stale cached data is in flight. */
  getItemTags(): MenuItemTagRef[] {
    const tags = this.item?.tags;
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

  getCurrentExtraPrice(extra: any): number {
    return getCurrentPrice(extra);
  }

  // ── Actions ──────────────────────────────────────────────────────────

  handleSingleSelect(groupId: string, choiceId: string): void {
    this.selectedModifiers = {
      ...this.selectedModifiers,
      [groupId]: [choiceId],
    };
  }

  handleMultiSelect(
    groupId: string,
    choiceId: string,
    checked: boolean,
    maxSelections: number
  ): void {
    const current = this.selectedModifiers[groupId] || [];
    if (checked) {
      if (current.length >= maxSelections) {
        this.toastService.error(`Maximum ${maxSelections} selections allowed`);
        return;
      }
      this.selectedModifiers = {
        ...this.selectedModifiers,
        [groupId]: [...current, choiceId],
      };
    } else {
      this.selectedModifiers = {
        ...this.selectedModifiers,
        [groupId]: current.filter((id) => id !== choiceId),
      };
    }
  }

  toggleExtra(extraId: string): void {
    if (this.selectedExtras.includes(extraId)) {
      this.selectedExtras = this.selectedExtras.filter((id) => id !== extraId);
    } else {
      this.selectedExtras = [...this.selectedExtras, extraId];
    }
  }

  incrementQuantity(): void {
    this.quantity++;
  }

  decrementQuantity(): void {
    if (this.quantity > 1) this.quantity--;
  }

  onBack(): void {
    this.resetState();
    this.back.emit();
  }

  handleAddToCart(): void {
    // Validate required modifier groups — surface inline per-group errors (mirrors the diner
    // item-detail) instead of a toast, so the preview reads the same as the live menu.
    const errors: Record<string, string> = {};
    for (const group of this.modifierGroups) {
      const count = (this.selectedModifiers[group.id] || []).length;
      if (group.minSelections > 0 && count < group.minSelections) {
        errors[group.id] =
          group.minSelections <= 1
            ? 'Please select an option'
            : `Please select at least ${group.minSelections} options`;
      }
    }
    this.modifierErrors = errors;
    if (Object.keys(errors).length > 0) return;

    // Transform selectedModifiers Record → SelectedModifier[]
    const transformedModifiers: SelectedModifier[] = [];
    for (const group of this.modifierGroups) {
      const selectedIds = this.selectedModifiers[group.id] || [];
      if (selectedIds.length > 0) {
        const choices = selectedIds.map((choiceId) => {
          const choice = group.choices.find((c) => c.id === choiceId);
          return {
            id: choiceId,
            name: choice?.name || '',
            additionalCost: choice?.additionalCost || 0,
          };
        });
        transformedModifiers.push({
          groupId: group.id,
          groupName: group.name || 'Options',
          choices,
        });
      }
    }

    // Transform selectedExtras string[] → SelectedExtra[]
    const transformedExtras: SelectedExtra[] = this.selectedExtras.map(
      (extraId) => {
        const extraItem = this.allItems.find((mi) => mi.id === extraId);
        return {
          id: extraId,
          name: extraItem?.name || '',
          price: extraItem ? getCurrentPrice(extraItem) : 0,
        };
      }
    );

    this.addToCart.emit({
      item: this.item,
      quantity: this.quantity,
      selectedModifiers: transformedModifiers,
      selectedExtras: transformedExtras,
      modifiersTotal: this.modifiersCost,
      extrasTotal: this.extrasCost * this.quantity,
    });

    // Local cleanup of form state. The parent
    // (PreviewMenuDrawerComponent.handleAddToCart) handles all post-add
    // navigation (view, selectedItem, editingCartItem, returnToCart).
    // Do NOT emit `back` here — doing so causes a double-emission that
    // races handleBackFromDetail against the just-completed
    // handleAddToCart, clobbering the navigation intent for
    // edit-cart-item and upsell-needs-modifiers flows.
    this.resetState();
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private prefillFromCartItem(cartItem: any): void {
    this.quantity = cartItem.quantity || 1;

    // Rebuild selectedModifiers from SelectedModifier[]
    this.selectedModifiers = {};
    if (cartItem.selectedModifiers) {
      for (const mod of cartItem.selectedModifiers) {
        this.selectedModifiers[mod.groupId] = mod.choices.map(
          (c: any) => c.id
        );
      }
    }

    // Rebuild selectedExtras from SelectedExtra[]
    this.selectedExtras = (cartItem.selectedExtras || []).map(
      (e: any) => e.id
    );
  }

  private resetState(): void {
    this.quantity = 1;
    this.selectedModifiers = {};
    this.selectedExtras = [];
    this.modifierErrors = {};
  }
}
