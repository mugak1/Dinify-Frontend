import { Injectable, Signal, WritableSignal, computed, effect, signal } from '@angular/core';
import { MenuItemTagRef } from 'src/app/_models/app.models';
import { filterMenuItems, TagId } from 'src/app/_shared/tags';

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

  currentSection: WritableSignal<string> = signal('');
  searchQuery: WritableSignal<string> = signal('');
  showSearch: WritableSignal<boolean> = signal(false);
  isLoading: WritableSignal<boolean> = signal(true);

  /** Selected dietary tag IDs — positive AND filter. */
  selectedDietary: WritableSignal<TagId[]> = signal<TagId[]>([]);
  /** Selected allergen tag IDs — negative ANY filter. */
  selectedAllergens: WritableSignal<TagId[]> = signal<TagId[]>([]);

  presetTags: WritableSignal<any[]> = signal<any[]>([]);
  showTagFilter: WritableSignal<boolean> = signal(false);

  isMenuActive: WritableSignal<boolean> = signal(false);

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
   * Total vertical space occupied by the sticky header + nav bar from the
   * viewport top, in pixels. Drives both the section scroll-margin-top
   * (so clicked pills land flush against the nav bar bottom) and — by
   * virtue of the scroll-spy host sitting at this same document Y — the
   * scroll-spy reading line. Grows when tag filters are active because
   * the filter-badge row adds ~32px below the pill row.
   */
  navStackHeight: Signal<number> = computed(() => {
    const PILL_ROW_PX = 52;
    const FILTER_ROW_PX = 32;
    return (
      this.stickyTopPx() +
      PILL_ROW_PX +
      (this.hasActiveFilters() ? FILTER_ROW_PX : 0)
    );
  });

  constructor() {
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
    return out;
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

  setPresetTags(tags: any[]): void {
    this.presetTags.set(tags || []);
  }

  setLoading(value: boolean): void {
    this.isLoading.set(value);
  }

  setMenuActive(value: boolean): void {
    this.isMenuActive.set(value);
  }

  setCurrentSection(name: string): void {
    this.currentSection.set(name);
  }

  setStickyTopPx(px: number): void {
    this.stickyTopPx.set(px);
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
    this.filterMenu();
  }

  /**
   * Recomputes `filteredMenuList` from the loaded menu by:
   *   1. running the pure tag filter helper over each section's items
   *      (dietary AND + allergen ANY-hide), then
   *   2. applying the search-name filter.
   * Sections with zero remaining items are dropped so the diner never
   * sees an empty "Breakfast" heading after filtering.
   */
  filterMenu(): void {
    const menu = this.menuList();
    if (!menu) return;

    const dietary = this.selectedDietary();
    const allergens = this.selectedAllergens();
    const query = this.searchQuery();

    let result: any[] = (menu as any[]).map((section: any) => ({
      ...section,
      items: filterMenuItems(section.items || [], dietary, allergens),
    }));

    if (query) {
      const q = query.toLowerCase();
      result = result.map((section: any) => ({
        ...section,
        items: section.items.filter((item: any) =>
          (item?.name ?? '').toLowerCase().includes(q),
        ),
      }));
    }

    result = result.filter((section: any) => section.items.length > 0);
    this.filteredMenuList.set(result);
  }

  openTagFilter(): void {
    this.showTagFilter.set(true);
  }

  closeTagFilter(): void {
    this.showTagFilter.set(false);
  }

  setTagFilterOpen(open: boolean): void {
    this.showTagFilter.set(open);
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
   * Count of items that would be visible if only this dietary tag were
   * the active filter — i.e. items carrying it. Used for the live
   * "(8)" hint next to each chip.
   */
  dietaryOptionCount(tagId: TagId): number {
    return filterMenuItems(this.allItems(), [tagId], []).length;
  }

  /**
   * Count of items that would be visible if only this allergen filter
   * were active — i.e. items NOT carrying it.
   */
  allergenOptionCount(tagId: TagId): number {
    return filterMenuItems(this.allItems(), [], [tagId]).length;
  }
}
