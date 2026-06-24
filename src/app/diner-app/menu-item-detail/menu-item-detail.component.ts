import { Component, OnDestroy, OnInit, computed, effect, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  BasketItem,
  MenuItem,
  MenuItemExtraRef,
  MenuItemTagRef,
  ModifierGroup,
  Restaurant,
  SelectedModifier,
} from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { BasketService } from 'src/app/_services/basket.service';
import { SessionStorageService } from 'src/app/_services/storage/session-storage.service';
import { parseModifierGroups, selectionConstraintPhrase } from 'src/app/_common/utils/modifier-utils';
import {
  getCurrentPriceFromDetails,
  discountIsLive as discountIsLiveFn,
  serverEffectivePrice,
  serverSavings,
} from 'src/app/_shared/utils/price-utils';
import { environment } from 'src/environments/environment';
import { MenuNavStateService } from '../menu/menu-nav-state.service';

@Component({
  selector: 'app-menu-item-detail',
  templateUrl: './menu-item-detail.component.html',
  styleUrls: ['./menu-item-detail.component.css'],
  standalone: false,
})
export class MenuItemDetailComponent implements OnInit, OnDestroy {
  url = environment.apiUrl;

  readonly table: string;
  readonly itemId: string;

  item = signal<MenuItem | null>(null);
  quantity = signal<number>(1);
  modifierGroups = signal<ModifierGroup[]>([]);
  selectedModifiers = signal<Record<string, string[]>>({});
  selectedExtras = signal<MenuItemExtraRef[]>([]);
  heroImageLoaded = signal<boolean>(false);
  formSubmitted = signal<boolean>(false);
  errorMessages = signal<string[]>([]);
  isFormValidFlag = signal<boolean>(true);
  loading = signal<boolean>(true);
  notFound = signal<boolean>(false);
  editingIndex = signal<number | null>(null);
  isEditMode = computed(() => this.editingIndex() !== null);

  private storageSub?: Subscription;
  private menuFetchTriggered = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    public navState: MenuNavStateService,
    private basketService: BasketService,
    private sessionStorage: SessionStorageService,
    private api: ApiService,
  ) {
    // Read params in the constructor so they're set before the resolution
    // effect's first run (effects run after the first change detection).
    this.table = this.route.snapshot.paramMap.get('table') ?? '';
    this.itemId = this.route.snapshot.paramMap.get('itemId') ?? '';
    const editing = this.route.snapshot.queryParamMap.get('editingIndex');
    this.editingIndex.set(editing !== null ? Number(editing) : null);

    // Synchronous warm-path resolution: when the shared store survived the
    // menu→detail navigation, the item resolves here in the constructor and
    // clears `loading` before the first change-detection pass — no skeleton
    // flash. On a genuine cold load `allItems()` is empty, so this returns
    // having changed nothing and the effect/fetch path below takes over.
    this.resolveItemFromState();

    // Resolve the item from `allItems` whenever the menu populates. Idempotent
    // — skips work once `item` is set so it doesn't re-fire on later signal
    // emissions (filter changes, etc.). Still needed on the cold path: it reads
    // allItems() and re-fires once the fetched menu lands.
    effect(() => {
      this.resolveItemFromState();
    });

    // Warm-load path — if the menu is already in nav state, the resolution
    // effect will resolve the item on its first run. Otherwise, fetch.
    if (this.navState.menuList()?.length) {
      return;
    }

    // Cold-load path — fetch the menu ourselves. If sessionStorage already has
    // the restaurant, fetch immediately. Otherwise wait for DinerAppComponent's
    // table-scan call to land.
    const restaurant = this.sessionStorage.getItem<Restaurant>('restaurant') as Restaurant | null;
    if (restaurant?.id) {
      this.fetchMenu(restaurant.id);
      return;
    }

    this.storageSub = this.sessionStorage.StorageValue.subscribe((key: any) => {
      if (typeof key !== 'string' || !key.includes('restaurant')) return;
      const r = this.sessionStorage.getItem<Restaurant>('restaurant') as Restaurant | null;
      if (!r?.id) return;
      this.storageSub?.unsubscribe();
      this.storageSub = undefined;
      this.fetchMenu(r.id);
    });
  }

  ngOnInit(): void {
    // The item-detail page should always open scrolled to the top, regardless
    // of where the diner was scrolled on the menu when they tapped in. The
    // menu preserves its own scroll position separately for the return trip,
    // so this does not interfere with back-navigation restore.
    window.scrollTo({ top: 0, left: 0 });
  }

  ngOnDestroy(): void {
    this.storageSub?.unsubscribe();
  }

  /**
   * Resolves the tapped item from the shared menu store (`allItems`). Idempotent
   * — skips work once `item` is set so it doesn't re-do work on later signal
   * emissions (filter changes, etc.). Returns having changed nothing when the
   * store is empty (cold load before the fetch lands), so it's safe to call both
   * synchronously from the constructor and from the resolution effect.
   */
  private resolveItemFromState(): void {
    if (this.item()) return;
    const all = this.navState.allItems();
    if (!all.length) return;
    const found = all.find((i) => i?.id === this.itemId) as MenuItem | undefined;
    if (found) {
      this.item.set(found);
      this.modifierGroups.set(parseModifierGroups(found.options));
      this.selectedModifiers.set({});
      this.selectedExtras.set([]);
      this.heroImageLoaded.set(false);
      // Edit-mode pre-population: when arriving with ?editingIndex=<n>, rebuild
      // the prior selections from the basket entry at that index. Falls back to
      // add mode if the index is out of range (e.g. basket was cleared between
      // navigations).
      const idx = this.editingIndex();
      if (idx !== null) {
        const basketItem = this.basketService.Basket().items[idx];
        if (basketItem) {
          this.quantity.set(basketItem.quantity);
          const reconstructed: Record<string, string[]> = {};
          for (const mod of basketItem.selectedModifiers || []) {
            reconstructed[mod.groupId] = mod.choices.map((c) => c.id);
          }
          this.selectedModifiers.set(reconstructed);
          // Use the menuItem's own extra refs so isExtraSelected's identity
          // check matches.
          this.selectedExtras.set(
            (basketItem.extras || [])
              .map((ext: any) => (found.extras || []).find((e: any) => e.id === ext.id))
              .filter((e: MenuItemExtraRef | undefined): e is MenuItemExtraRef => !!e),
          );
        } else {
          this.editingIndex.set(null);
        }
      }
      this.validateForm();
      this.loading.set(false);
    } else {
      this.loading.set(false);
      this.notFound.set(true);
    }
  }

  // TODO(PR-5b+): this duplicates MenuComponent.loadMenu's fetch leg. Extract
  // a `MenuNavStateService.loadMenuFor(restaurantId)` helper once both call
  // sites can share it; left inline here to keep PR 5a additive.
  private fetchMenu(restaurantId: string): void {
    if (this.menuFetchTriggered) return;
    this.menuFetchTriggered = true;
    this.api
      .get<MenuItem>(null, 'orders/journey/show-menu/', { restaurant: restaurantId })
      .subscribe({
        next: (x: any) => {
          this.navState.setMenuList((x?.data as any) ?? []);
          this.navState.setItemSortMode(x?.item_sort_mode ?? 'manual');
          this.navState.filterMenu();
          // The allItems effect picks up the change and resolves the item.
        },
        error: (err) => {
          console.warn('[MenuItemDetailComponent] menu fetch failed', err);
          this.loading.set(false);
          this.notFound.set(true);
        },
      });
  }

  /** The server's live-now discount verdict for the main item (template gate). */
  discountIsLive(item: MenuItem): boolean {
    return discountIsLiveFn(item);
  }

  getDisplayPrice(item: MenuItem): number {
    return serverEffectivePrice(item);
  }

  priceSaved(item: MenuItem): number {
    return serverSavings(item);
  }

  /** primary_price coerced to a number — DRF serialises the DecimalField as a string. */
  basePrice(item: MenuItem): number {
    return Number(item.primary_price) || 0;
  }

  /** An extra's base (pre-discount) price as a number (DecimalField-as-string). */
  extraBasePrice(extra: MenuItemExtraRef): number {
    return Number(extra.primary_price) || 0;
  }

  /** Effective (discount-aware) price of an extra, recomputed client-side
   *  from its discount_details — mirrors the parent item's price path so an
   *  extra shows the same figure whether viewed standalone or as an extra. */
  extraEffectivePrice(extra: MenuItemExtraRef): number {
    return getCurrentPriceFromDetails(Number(extra.primary_price) || 0, extra.discount_details);
  }

  /** True when the extra has an active discount right now (effective < base). */
  extraIsDiscounted(extra: MenuItemExtraRef): boolean {
    return this.extraEffectivePrice(extra) < (Number(extra.primary_price) || 0);
  }

  /** Normalises the tags payload to MenuItemTagRef[]. Tolerates legacy
   *  string[] shapes that may still arrive from a stale cache. */
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

  isOutOfStock(item: MenuItem | null): boolean {
    return !!item && item.in_stock === false;
  }

  isExtraSelected(extra: MenuItemExtraRef): boolean {
    return this.selectedExtras().includes(extra);
  }

  setExtra(extra: MenuItemExtraRef): void {
    const current = this.selectedExtras();
    const idx = current.findIndex((x) => x.id === extra.id);
    if (idx === -1) {
      const max = this.item()?.extras_max_selections;
      if (max && current.length >= max) return; // at max — ignore
      this.selectedExtras.set([...current, extra]);
    } else {
      this.selectedExtras.set(current.filter((_, i) => i !== idx));
    }
    this.validateForm();
  }

  // --- Extras selection constraints (coerced the same way as modifier groups,
  //     so the extras block speaks the same guidance language). ---

  /** Minimum extras required — non-negative integer, 0 when unset/invalid. */
  get extrasMin(): number {
    const n = Math.floor(Number(this.item()?.extras_min_selections));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /** Max extras allowed — falls back to the number of extras on offer when
   *  the backend value is unset/invalid. */
  get extrasMax(): number {
    const n = Math.floor(Number(this.item()?.extras_max_selections));
    return Number.isFinite(n) && n > 0 ? n : (this.item()?.extras?.length ?? 0);
  }

  extrasRequired(): boolean {
    return this.extrasMin > 0;
  }

  /** Count phrase for the extras block (e.g. "Select 2", "up to 3", ""). */
  extrasConstraintLabel(): string {
    return selectionConstraintPhrase(this.extrasMin, this.extrasMax);
  }

  /** True once the diner has hit the extras cap — used to grey out the rest. */
  isExtrasAtMax(): boolean {
    return this.extrasMax > 0 && this.selectedExtras().length >= this.extrasMax;
  }

  /** True when a required extras block hasn't met its minimum yet. */
  extrasUnmet(): boolean {
    return this.extrasMin > 0 && this.selectedExtras().length < this.extrasMin;
  }

  extrasErrorText(): string {
    return this.extrasMin <= 1
      ? 'Please add an extra'
      : 'Please add at least ' + this.extrasMin + ' extras';
  }

  isModifierChoiceSelected(groupId: string, choiceId: string): boolean {
    return (this.selectedModifiers()[groupId] || []).includes(choiceId);
  }

  getModifierSelectedCount(groupId: string): number {
    return (this.selectedModifiers()[groupId] || []).length;
  }

  /** Count phrase for a modifier group (e.g. "Select 1", "up to 3", ""). */
  groupConstraintLabel(group: ModifierGroup): string {
    return selectionConstraintPhrase(group.minSelections, group.maxSelections);
  }

  /** True when a required group hasn't met its minimum yet. */
  groupUnmet(group: ModifierGroup): boolean {
    return group.minSelections > 0 && this.getModifierSelectedCount(group.id) < group.minSelections;
  }

  groupErrorText(group: ModifierGroup): string {
    return group.minSelections <= 1
      ? 'Please select an option'
      : 'Please select at least ' + group.minSelections + ' options';
  }

  handleModifierSingleSelect(groupId: string, choiceId: string): void {
    const map = this.selectedModifiers();
    const current = map[groupId] || [];
    const next =
      current.length === 1 && current[0] === choiceId
        ? { ...map, [groupId]: [] }
        : { ...map, [groupId]: [choiceId] };
    this.selectedModifiers.set(next);
    this.validateForm();
  }

  handleModifierMultiSelect(
    groupId: string,
    choiceId: string,
    checked: boolean,
    maxSelections: number,
  ): void {
    const map = this.selectedModifiers();
    const current = map[groupId] || [];
    if (checked) {
      if (current.length >= maxSelections) return;
      this.selectedModifiers.set({ ...map, [groupId]: [...current, choiceId] });
    } else {
      this.selectedModifiers.set({
        ...map,
        [groupId]: current.filter((id) => id !== choiceId),
      });
    }
    this.validateForm();
  }

  validateForm(): void {
    const errors: string[] = [];
    for (const group of this.modifierGroups()) {
      const selectedCount = (this.selectedModifiers()[group.id] || []).length;
      if (group.minSelections > 0 && selectedCount < group.minSelections) {
        errors.push(
          group.minSelections === 1
            ? `Please select an option for "${group.name}".`
            : `Please select at least ${group.minSelections} options for "${group.name}".`,
        );
      }
    }
    const item = this.item();
    if (item?.has_extras) {
      const minExtras = item.extras_min_selections ?? 0;
      const count = this.selectedExtras().length;
      if (minExtras > 0 && count < minExtras) {
        errors.push(minExtras === 1
          ? 'Please add at least one extra.'
          : `Please add at least ${minExtras} extras.`);
      }
    }
    this.errorMessages.set(errors);
    this.isFormValidFlag.set(errors.length === 0);
  }

  isFormValid(): boolean {
    return this.isFormValidFlag();
  }

  submitForm(): void {
    this.validateForm();
  }

  get computedItemTotal(): number {
    const item = this.item();
    if (!item) return 0;
    const basePrice = discountIsLiveFn(item)
      ? serverEffectivePrice(item)
      : Number(item.primary_price) || 0;
    let modifiersCost = 0;
    const selected = this.selectedModifiers();
    for (const group of this.modifierGroups()) {
      const selectedIds = selected[group.id] || [];
      for (const choiceId of selectedIds) {
        const choice = group.choices.find((c) => c.id === choiceId);
        if (choice) modifiersCost += choice.additionalCost;
      }
    }
    const extrasCost = this.selectedExtras().reduce(
      (acc, extra) => acc + this.extraEffectivePrice(extra),
      0,
    );
    return (basePrice + modifiersCost + extrasCost) * this.quantity();
  }

  /** After a blocked submit, bring the first unmet section into view so the
   *  freshly-revealed inline error is on screen. First unmet modifier group (in
   *  render order) wins, else the extras block. Degrades silently if the element
   *  isn't in the DOM. Mirrors the direct `window` access used in ngOnInit. */
  private scrollToFirstUnmet(): void {
    const firstUnmet = this.modifierGroups().find((g) => this.groupUnmet(g));
    const id = firstUnmet
      ? 'mod-group-' + firstUnmet.id
      : this.extrasUnmet()
        ? 'extras-section'
        : null;
    if (!id) return;
    setTimeout(
      () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      0,
    );
  }

  addToBasket(): void {
    if (!this.isFormValid()) {
      this.formSubmitted.set(true);
      this.scrollToFirstUnmet();
      return;
    }
    const item = this.item();
    if (!item || this.isOutOfStock(item)) return;

    this.formSubmitted.set(false);

    const groups = this.modifierGroups();
    const selectedModifiers = this.selectedModifiers();
    const selectedModifiersList: SelectedModifier[] = groups
      .filter((g) => (selectedModifiers[g.id] || []).length > 0)
      .map((g) => ({
        groupId: g.id,
        groupName: g.name,
        choices: (selectedModifiers[g.id] || [])
          .map((cid) => g.choices.find((c) => c.id === cid))
          .filter(Boolean)
          .map((c) => ({ id: c!.id, name: c!.name, additionalCost: c!.additionalCost })),
      }));

    const selectedExtras = this.selectedExtras().map((extra) => {
      const original = Number(extra.primary_price) || 0;
      const effective = this.extraEffectivePrice(extra);
      return {
        id: extra.id,
        name: extra.name,
        cost: effective,
        ...(effective < original ? { originalCost: original } : {}),
      };
    });

    const isDiscounted = discountIsLiveFn(item);
    const originalBasePrice = Number(item.primary_price) || 0;
    const basePrice = isDiscounted ? serverEffectivePrice(item) : originalBasePrice;

    const modifiersCost = selectedModifiersList.reduce(
      (acc, mod) => acc + mod.choices.reduce((s, c) => s + c.additionalCost, 0),
      0,
    );
    const extrasCost = selectedExtras.reduce((acc, extra) => acc + extra.cost, 0);
    const totalPrice = basePrice + modifiersCost + extrasCost;

    const basketItem: BasketItem = {
      itemId: item.id,
      itemName: item.name,
      image: item.image || undefined,
      basePrice,
      totalPrice,
      quantity: this.quantity(),
      selectedModifiers: selectedModifiersList,
      extras: selectedExtras,
      isDiscounted,
      originalBasePrice: isDiscounted ? originalBasePrice : undefined,
      discountAmount: isDiscounted ? originalBasePrice - basePrice : undefined,
      discountPercentage: isDiscounted
        ? Math.round((1 - basePrice / originalBasePrice) * 100)
        : undefined,
    };

    const idx = this.editingIndex();
    if (idx !== null) {
      this.basketService.updateItem(idx, basketItem);
      this.router.navigate(['/diner', 'basket']);
    } else {
      this.basketService.addItem(basketItem);
      this.goBack();
    }
  }

  goBack(): void {
    if (this.table) {
      this.router.navigate(['/diner', 'h', this.table]);
    } else {
      this.router.navigate(['/diner']);
    }
  }

  decrementQuantity(): void {
    const q = this.quantity();
    if (q > 1) this.quantity.set(q - 1);
  }

  incrementQuantity(): void {
    this.quantity.set(this.quantity() + 1);
  }
}
