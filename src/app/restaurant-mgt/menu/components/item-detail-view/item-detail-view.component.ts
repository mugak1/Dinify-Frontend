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
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { MenuService } from '../../services/menu.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { SelectedModifier, SelectedExtra } from '../../models/cart.model';
import {
  getCurrentPrice,
  formatUGX,
  isDiscountActive,
  getDiscountBadgeText,
  calculateSavings,
} from '../../utils/price-utils';
import { getTagColorClasses, getTagIcon } from 'src/app/_common/utils/tag-utils';
import { environment } from 'src/environments/environment';

interface ParsedModifierGroup {
  id: string;
  name: string;
  required: boolean;
  selectionType: 'single' | 'multiple';
  minSelections: number;
  maxSelections: number;
  choices: {
    id: string;
    name: string;
    additionalCost: number;
    available: boolean;
  }[];
}

@Component({
  selector: 'app-item-detail-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './item-detail-view.component.html',
  host: {
    class: 'flex flex-col h-full min-h-0'
  }
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

  get modifierGroups(): ParsedModifierGroup[] {
    if (!this.item) return [];
    const opts = this.parseOptions(this.item.options);
    if (!opts || !opts.hasModifiers || !Array.isArray(opts.groups)) return [];
    return opts.groups.map((g: any) => ({
      ...g,
      choices: (g.choices || []).filter((c: any) => c.available !== false),
    }));
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

  getSelectionHint(group: ParsedModifierGroup): string {
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

  getTagClasses(tagName: string): string {
    const match = this.presetTags.find((t) => t.name === tagName);
    if (!match) return 'bg-gray-100 text-gray-800';
    return getTagColorClasses(match.color);
  }

  getTagIconSvg(tagName: string): string {
    const match = this.presetTags.find((t) => t.name === tagName);
    if (!match?.icon) return '';
    return getTagIcon(match.icon);
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
    // Validate required modifier groups
    const missingGroups = this.modifierGroups.filter(
      (group) =>
        group.required &&
        (!this.selectedModifiers[group.id] ||
          this.selectedModifiers[group.id].length < (group.minSelections || 1))
    );
    if (missingGroups.length > 0) {
      const names = missingGroups
        .map((g) => g.name || 'Untitled Group')
        .join(', ');
      this.toastService.error(`Please select: ${names}`);
      return;
    }

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

    this.resetState();
    this.back.emit();
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private parseOptions(options: any): any {
    if (!options) return null;
    let parsed = options;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return null;
      }
    }
    // New grouped format
    if (parsed.groups !== undefined) {
      return { hasModifiers: parsed.hasModifiers ?? false, groups: parsed.groups };
    }
    // Legacy flat format — convert to groups
    if (Array.isArray(parsed.options) && parsed.options.length > 0) {
      const groups = parsed.options.map((opt: any) => ({
        id: opt.name || crypto.randomUUID(),
        name: opt.name || 'Untitled Group',
        required: opt.required ?? false,
        selectionType: opt.selectable ? 'multiple' : 'single',
        minSelections: opt.required ? 1 : 0,
        maxSelections: opt.selectable
          ? (opt.choices?.length || opt.options?.length || 1)
          : 1,
        choices: (opt.choices || opt.options || []).map((c: any, i: number) => ({
          id: c.id || `${opt.name}-${i}`,
          name: c.name || '',
          additionalCost: c.additionalCost ?? c.cost ?? 0,
          available: c.available !== false,
        })),
      }));
      return { hasModifiers: true, groups };
    }
    return null;
  }

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
  }
}
