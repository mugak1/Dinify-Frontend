import { Injectable, Signal, WritableSignal, computed, effect, signal } from '@angular/core';
import { MenuItemTagRef } from 'src/app/_models/app.models';
import { SessionStorageService } from 'src/app/_services/storage/session-storage.service';
import { persistedSignal } from 'src/app/_services/storage/persisted-state';
import { filterMenuItems, TagId } from 'src/app/_shared/tags';
import { searchMenuItems } from 'src/app/_shared/utils/menu-search';
import { SortMode, SORT_MODES, applyMenuSort } from 'src/app/_shared/utils/menu-sort';

/**
 * Filter option derived from the loaded menu — a tag that (a) actually
 * appears on at least one item and (b) the restaurant has marked
 * `filterable` in its preset catalog. The richer fields (icon, colour,
 * category) are sourced from the item's tag ref so the filter sheet
 * doesn't depend on the preset catalog carrying display metadata.
 */
export interface MenuFilterOption {
  id: TagId;
  name: string;
  icon: string | null;
  colour: string;
  category: MenuItemTagRef['category'];
}

@Injectable({ providedIn: 'root' })
export class MenuNavStateService {
  menuList: WritableSignal<any[] | null> = signal<any[] | null>(null);
  filteredMenuList: WritableSignal<any[] | null> = signal<any[] | null>(null);

  /**
   * Id of the restaurant the cached `menuList` belongs to. Lets menu re-entry
   * tell a warm hit (same restaurant — render cached, revalidate in background)
   * from a cold load (different restaurant or first load). Intentionally NOT
   * cleared in any reset path — it must survive menu↔item exactly like
   * `menuList` does; the cold load overwrites it for a new restaurant.
   */
  loadedRestaurantId: WritableSignal<string | null> = signal<string | null>(null);

  currentSection: WritableSignal<string> = signal('');
  searchQuery: WritableSignal<string> = signal('');
  showSearch: WritableSignal<boolean> = signal(false);
  isLoading: WritableSignal<boolean> = signal(true);

  /** Item sort mode applied to section items + the featured rail. Hydrated from
   *  the show-menu response (`item_sort_mode`) at each fetch site; `'manual'` =
   *  `listing_position` order. providedIn:'root' means it survives the warm
   *  re-entry path (which re-runs filterMenu without re-fetching). */
  itemSortMode: WritableSignal<SortMode> = signal<SortMode>('manual');

  /** Selected dietary tag IDs — positive AND filter. Persisted to
   *  sessionStorage so a refresh within the visit preserves the diner's
   *  choices; closing the tab resets, by design. Assigned in the constructor
   *  because persistedSignal needs the injected SessionStorageService. */
  readonly selectedDietary!: WritableSignal<TagId[]>;
  /** Selected allergen tag IDs — negative ANY filter. See selectedDietary. */
  readonly selectedAllergens!: WritableSignal<TagId[]>;

  presetTags: WritableSignal<any[]> = signal<any[]>([]);
  showTagFilter: WritableSignal<boolean> = signal(false);

  /** Draft (uncommitted) filter selections edited inside the filter sheet.
   *  Seeded from the applied selections each time the sheet opens; copied back
   *  to the applied signals only on Apply. Deliberately NOT persisted — an
   *  unapplied draft must not survive a refresh. */
  draftDietary: WritableSignal<TagId[]> = signal<TagId[]>([]);
  draftAllergens: WritableSignal<TagId[]> = signal<TagId[]>([]);

  draftFilterCount: Signal<number> = computed(
    () => this.draftDietary().length + this.draftAllergens().length,
  );

  isMenuActive: WritableSignal<boolean> = signal(false);

  /** True only while the basket PAGE route (BasketComponent) is active. Hides the shared
   *  shell brand-strip there — the basket page renders its own one-bar header — exactly
   *  like isMenuActive does for the menu route. Set by BasketComponent's lifecycle; the
   *  always-mounted desktop sidebar (basket-body) does NOT set it. */
  isBasketPageActive: WritableSignal<boolean> = signal(false);

  /**
   * When a pill is clicked, we optimistically set currentSection and record
   * the click target here. During the smooth-scroll animation, window:scroll
   * events fire and the spy emits the section currently at the threshold
   * (usually "Featured" early in the animation). Those spy emissions would
   * clobber the click's intent — so menu.component.ts's onSectionChange
   * suppresses them while this is set, committing only when the spy emits
   * a matching value (scroll has arrived) or after a 1000ms timeout
   * (fallback if the scroll is interrupted).
   */
  pendingClickTarget: WritableSignal<string | null> = signal<string | null>(null);
  private pendingClickTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Pixel offset at which the nav bar sticks to the viewport top. Set by
   * MenuNavBarComponent from its `stickyTop` @Input on mount. Default 49 matches
   * the rest-app inline nav bar; the diner shell overrides to 60.
   */
  stickyTopPx: WritableSignal<number> = signal(49);

  /** Total number of currently-applied filters across both dimensions. */
  activeFilterCount: Signal<number> = computed(
    () => this.selectedDietary().length + this.selectedAllergens().length,
  );

  hasActiveFilters: Signal<boolean> = computed(() => this.activeFilterCount() > 0);

  /**
   * Diner single-banner override for the scroll-margin stack height, in px
   * (the banner's sticky-top offset + its measured height). Set by the menu
   * component's ResizeObserver while the banner is mounted; null elsewhere
   * (e.g. the rest-app embed, or before first measure), where navStackHeight
   * falls back to its constant pill/filter formula.
   */
  menuBannerStackHeight: WritableSignal<number | null> = signal<number | null>(null);

  /**
   * Total vertical space occupied by the sticky header + nav bar from the
   * viewport top, in pixels. Drives both the section scroll-margin-top
   * (so clicked pills land flush against the nav bar bottom) and — by
   * virtue of the scroll-spy host sitting at this same document Y — the
   * scroll-spy reading line. Grows when tag filters are active because
   * the filter-badge row adds ~32px below the pill row.
   */
  navStackHeight: Signal<number> = computed(() => {
    // Diner single-banner: prefer the live measured stack (banner height + its
    // sticky-top offset) so the scroll-margin tracks the identity row appearing on
    // condense, the persistent search row, the pills, and the filter row — all
    // without per-frame reflow.
    const measured = this.menuBannerStackHeight();
    if (measured != null) return measured;
    // Fallback (rest-app embed / pre-measure). Must equal the nav bar's own height
    // so clicked sections land flush under it: the persistent search row + its gap,
    // the pill/skeleton row, and the filter-badge row when active. Literal px
    // because html{font-size:14px} shrinks rem-based Tailwind heights below their px name.
    const SEARCH_ROW_PX = 44;
    const PILL_ROW_PX = 36;
    const FILTER_ROW_PX = 32;
    return (
      this.stickyTopPx() +
      SEARCH_ROW_PX +
      PILL_ROW_PX +
      (this.hasActiveFilters() ? FILTER_ROW_PX : 0)
    );
  });

  constructor(private sessionStorage: SessionStorageService) {
    const isTagIdArray = (v: unknown): v is TagId[] =>
      Array.isArray(v) && v.every((item) => typeof item === 'string');

    this.selectedDietary = persistedSignal<TagId[]>([], {
      storage: this.sessionStorage,
      getKey: () => 'diner.selectedDietary',
      validate: isTagIdArray,
    });
    this.selectedAllergens = persistedSignal<TagId[]>([], {
      storage: this.sessionStorage,
      getKey: () => 'diner.selectedAllergens',
      validate: isTagIdArray,
    });

    // Mirror navStackHeight into a CSS custom property on :root so that
    // section `scroll-mt-[var(--menu-nav-stack-height)]` tracks the real
    // nav bar height reactively. Effect runs on service instantiation
    // (setting an initial value) and on every change to stickyTopPx or
    // the active-filter count. The service is providedIn:'root', so the
    // effect's lifetime matches the app's.
    effect(() => {
      document.documentElement.style.setProperty(
        '--menu-nav-stack-height',
        `${this.navStackHeight()}px`,
      );
    });

    // Prune persisted selections that no longer correspond to a filterable
    // tag on any loaded item — e.g. the operator edited the preset catalog
    // or item tags between visits. Gated on menuList() so the empty initial
    // filterOptions can't clobber a freshly-rehydrated selection before the
    // menu fetch lands.
    effect(() => {
      if (this.menuList() === null) return;

      const validDietary = new Set(this.dietaryFilterOptions().map((o) => o.id));
      const validAllergens = new Set(this.allergenFilterOptions().map((o) => o.id));

      const dietary = this.selectedDietary();
      const prunedDietary = dietary.filter((id) => validDietary.has(id));
      if (prunedDietary.length !== dietary.length) {
        this.selectedDietary.set(prunedDietary);
      }

      const allergens = this.selectedAllergens();
      const prunedAllergens = allergens.filter((id) => validAllergens.has(id));
      if (prunedAllergens.length !== allergens.length) {
        this.selectedAllergens.set(prunedAllergens);
      }
    });
  }

  featuredItems: Signal<any[]> = computed(() => {
    const list = this.filteredMenuList();
    if (!list?.length) return [];
    const out: any[] = [];
    for (const section of list as any[]) {
      for (const item of section?.items || []) {
        if (item?.is_featured) out.push(item);
      }
    }
    return applyMenuSort(out, this.itemSortMode());
  });

  allItems: Signal<any[]> = computed(() => {
    const list = this.menuList();
    if (!list?.length) return [];
    const out: any[] = [];
    for (const section of list as any[]) {
      for (const item of section?.items || []) {
        out.push(item);
      }
    }
    return out;
  });

  /**
   * Flat, ranked search results for the diner search view. Name matches first,
   * then description-only matches, each in menu order. Derived from the
   * tag-filtered grouped list (filteredMenuList) so dietary/allergen filters
   * apply before ranking. Empty when the (trimmed) query is blank.
   */
  searchResults: Signal<any[]> = computed(() => {
    if (!this.searchQuery().trim()) return [];
    const grouped = this.filteredMenuList() ?? [];
    const flat: any[] = [];
    for (const section of grouped as any[]) {
      for (const item of section?.items ?? []) flat.push(item);
    }
    return searchMenuItems(flat, this.searchQuery());
  });

  /**
   * Lookup of preset tag id → whether the restaurant flagged the tag as
   * filterable. Tolerates the legacy `id`-or-`tag_id` and missing
   * filterable shapes — anything without `id` is skipped.
   */
  private filterablePresetIds: Signal<Set<TagId>> = computed(() => {
    const out = new Set<TagId>();
    for (const t of this.presetTags() ?? []) {
      const id = (t?.id ?? t?.tag_id) as TagId | undefined;
      if (!id) continue;
      if (t?.filterable === true) out.add(id);
    }
    return out;
  });

  /**
   * Filter options surfaced in the bottom-sheet — the intersection of
   * tags actually applied to at least one loaded item AND tags the
   * restaurant has marked as filterable. Deduped by id, ordered by the
   * first appearance in the menu so siblings of the same category land
   * together in display_order.
   */
  filterOptions: Signal<MenuFilterOption[]> = computed(() => {
    const filterable = this.filterablePresetIds();
    if (filterable.size === 0) return [];
    const seen = new Set<TagId>();
    const out: MenuFilterOption[] = [];
    for (const item of this.allItems()) {
      const tags = Array.isArray(item?.tags) ? item.tags : [];
      for (const t of tags) {
        if (!t || typeof t !== 'object') continue;
        const id = t.id as TagId | undefined;
        if (!id || seen.has(id) || !filterable.has(id)) continue;
        const category = (t.category ?? 'descriptor') as MenuItemTagRef['category'];
        if (category !== 'dietary' && category !== 'allergen') continue;
        seen.add(id);
        out.push({
          id,
          name: String(t.name ?? ''),
          icon: t.icon ?? null,
          colour: t.colour ?? 'gray',
          category,
        });
      }
    }
    return out;
  });

  dietaryFilterOptions: Signal<MenuFilterOption[]> = computed(() =>
    this.filterOptions().filter((o) => o.category === 'dietary'),
  );

  allergenFilterOptions: Signal<MenuFilterOption[]> = computed(() =>
    this.filterOptions().filter((o) => o.category === 'allergen'),
  );

  hasAnyFilterOptions: Signal<boolean> = computed(
    () =>
      this.dietaryFilterOptions().length > 0 ||
      this.allergenFilterOptions().length > 0,
  );

  setMenuList(list: any[] | null): void {
    this.menuList.set(list);
  }

  /** Apply a sort mode from the backend, falling back to 'manual' for anything
   *  not in SORT_MODES (defensive against unknown/legacy values). */
  setItemSortMode(mode: string | null | undefined): void {
    this.itemSortMode.set(
      (SORT_MODES as readonly string[]).includes(mode as string) ? (mode as SortMode) : 'manual',
    );
  }

  setLoadedRestaurantId(id: string | null): void {
    this.loadedRestaurantId.set(id);
  }

  setPresetTags(tags: any[]): void {
    this.presetTags.set(tags || []);
  }

  setLoading(value: boolean): void {
    this.isLoading.set(value);
  }

  setMenuActive(value: boolean): void {
    this.isMenuActive.set(value);
  }

  setBasketPageActive(value: boolean): void {
    this.isBasketPageActive.set(value);
  }

  setCurrentSection(name: string): void {
    this.currentSection.set(name);
  }

  setStickyTopPx(px: number): void {
    this.stickyTopPx.set(px);
  }

  /** Set (or clear, with null) the diner banner's measured scroll-margin stack
   *  height. See `menuBannerStackHeight`. */
  setMenuBannerStackHeight(px: number | null): void {
    this.menuBannerStackHeight.set(px);
  }

  setPendingClickTarget(target: string): void {
    if (this.pendingClickTimer) {
      clearTimeout(this.pendingClickTimer);
    }
    this.pendingClickTarget.set(target);
    this.pendingClickTimer = setTimeout(() => {
      this.clearPendingClickTarget();
    }, 1000);
  }

  clearPendingClickTarget(): void {
    if (this.pendingClickTimer) {
      clearTimeout(this.pendingClickTimer);
      this.pendingClickTimer = null;
    }
    this.pendingClickTarget.set(null);
  }

  toggleSearch(): void {
    this.showSearch.set(!this.showSearch());
    if (!this.showSearch()) {
      this.clearSearch();
    }
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  /**
   * Recomputes `filteredMenuList` from the loaded menu by running the pure tag
   * filter helper over each section's items (dietary AND + allergen ANY-hide).
   * Sections with zero remaining items are dropped so the diner never sees an
   * empty "Breakfast" heading after filtering.
   *
   * Search is no longer applied here — it is a separate ranked computed
   * (`searchResults`) derived from this tag-filtered list.
   */
  filterMenu(): void {
    const menu = this.menuList();
    if (!menu) return;

    const dietary = this.selectedDietary();
    const allergens = this.selectedAllergens();

    let result: any[] = (menu as any[]).map((section: any) => ({
      ...section,
      items: applyMenuSort(
        filterMenuItems(section.items || [], dietary, allergens) as any[],
        this.itemSortMode(),
      ),
    }));

    result = result.filter((section: any) => section.items.length > 0);
    this.filteredMenuList.set(result);
  }

  openTagFilter(): void {
    this.draftDietary.set([...this.selectedDietary()]);
    this.draftAllergens.set([...this.selectedAllergens()]);
    this.showTagFilter.set(true);
  }

  closeTagFilter(): void {
    this.showTagFilter.set(false);
  }

  setTagFilterOpen(open: boolean): void {
    if (open) {
      this.openTagFilter();
    } else {
      this.closeTagFilter();
    }
  }

  /** Toggles a dietary tag id in/out of the DRAFT. No live re-filter — the
   *  draft is committed only by applyDraftFilters(). */
  toggleDraftDietary(tagId: TagId): void {
    const current = this.draftDietary();
    this.draftDietary.set(
      current.includes(tagId)
        ? current.filter((t) => t !== tagId)
        : [...current, tagId],
    );
  }

  toggleDraftAllergen(tagId: TagId): void {
    const current = this.draftAllergens();
    this.draftAllergens.set(
      current.includes(tagId)
        ? current.filter((t) => t !== tagId)
        : [...current, tagId],
    );
  }

  isDraftDietarySelected(tagId: TagId): boolean {
    return this.draftDietary().includes(tagId);
  }

  isDraftAllergenSelected(tagId: TagId): boolean {
    return this.draftAllergens().includes(tagId);
  }

  /** Clears the DRAFT only (the in-sheet Reset). Applied filters stay until
   *  the diner taps Apply. */
  clearDraft(): void {
    this.draftDietary.set([]);
    this.draftAllergens.set([]);
  }

  /** Commits draft -> applied (persisted) selections, re-filters, and closes. */
  applyDraftFilters(): void {
    this.selectedDietary.set([...this.draftDietary()]);
    this.selectedAllergens.set([...this.draftAllergens()]);
    this.filterMenu();
    this.closeTagFilter();
  }

  /** Toggles a dietary tag id in/out of the selection and re-filters live. */
  toggleDietary(tagId: TagId): void {
    const current = this.selectedDietary();
    this.selectedDietary.set(
      current.includes(tagId)
        ? current.filter((t) => t !== tagId)
        : [...current, tagId],
    );
    this.filterMenu();
  }

  /** Toggles an allergen tag id in/out of the selection and re-filters live. */
  toggleAllergen(tagId: TagId): void {
    const current = this.selectedAllergens();
    this.selectedAllergens.set(
      current.includes(tagId)
        ? current.filter((t) => t !== tagId)
        : [...current, tagId],
    );
    this.filterMenu();
  }

  isDietarySelected(tagId: TagId): boolean {
    return this.selectedDietary().includes(tagId);
  }

  isAllergenSelected(tagId: TagId): boolean {
    return this.selectedAllergens().includes(tagId);
  }

  /** Clears both dimensions and re-filters. */
  clearAllFilters(): void {
    this.selectedDietary.set([]);
    this.selectedAllergens.set([]);
    this.filterMenu();
  }

  /**
   * Count of items carrying this dietary tag. Shown as the "(n)" hint
   * next to each dietary option in the filter sheet. Symmetric with
   * allergenOptionCount — both report "items with this tag".
   */
  dietaryOptionCount(tagId: TagId): number {
    return filterMenuItems(this.allItems(), [tagId], []).length;
  }

  /**
   * Count of items carrying this allergen tag. Shown as the "(n)" hint
   * next to each allergen in the filter sheet. Symmetric with
   * dietaryOptionCount — both report "items with this tag" so the diner
   * reads the label and number as a single thought.
   *
   * Why not the inverse (items remaining if the filter were applied)?
   * Because the label sitting next to the count is the allergen noun
   * ("Contains Gluten"). Diners pair the number with the label
   * unavoidably; the count must agree with that pairing.
   */
  allergenOptionCount(tagId: TagId): number {
    return filterMenuItems(this.allItems(), [tagId], []).length;
  }
}
