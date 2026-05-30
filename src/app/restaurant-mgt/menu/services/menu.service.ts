import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { LocalStorageService } from 'src/app/_services/storage/local-storage.service';
import { PersistedBehaviorSubject } from 'src/app/_services/storage/persisted-state';
import { MenuItem, MenuSectionListItem, ApiResponse } from 'src/app/_models/app.models';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { SORT_MODES, SortMode, applyMenuSort } from 'src/app/_shared/utils/menu-sort';

// Re-exported so existing importers (item-list, preview-menu-drawer, menu.component)
// keep importing SortMode/SORT_MODES from this service unchanged.
export { SORT_MODES };
export type { SortMode };

@Injectable({
  providedIn: 'root'
})
export class MenuService {

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  private readonly _rawSections$ = new BehaviorSubject<MenuSectionListItem[]>([]);

  private readonly _selectedSectionId$!: PersistedBehaviorSubject<string | null>;
  readonly selectedSectionId$!: Observable<string | null>;

  private readonly _allItems$ = new BehaviorSubject<MenuItem[]>([]);
  readonly allItems$ = this._allItems$.asObservable();

  readonly sections$: Observable<MenuSectionListItem[]> = this._rawSections$.asObservable();

  readonly items$!: Observable<MenuItem[]>;

  readonly extras$: Observable<MenuItem[]> = this._allItems$.pipe(
    map(items => items.filter(item => item.is_extra === true))
  );

  private readonly _sortMode$!: PersistedBehaviorSubject<SortMode>;
  readonly sortMode$!: Observable<SortMode>;

  private readonly _isLoading$ = new BehaviorSubject<boolean>(false);
  readonly isLoading$ = this._isLoading$.asObservable();

  private readonly _error$ = new BehaviorSubject<string | null>(null);
  readonly error$ = this._error$.asObservable();

  private readonly _searchResults$ = new BehaviorSubject<MenuItem[]>([]);
  readonly searchResults$ = this._searchResults$.asObservable();

  private readonly _isSearching$ = new BehaviorSubject<boolean>(false);
  readonly isSearching$ = this._isSearching$.asObservable();

  // Re-entrancy guard for loadAllItems. The "load all once, filter client-side"
  // architecture should only ever have one in-flight pagination loop; this
  // flag is the last line of defence against future callers accidentally
  // re-triggering the load while the first call is still draining pages.
  private allItemsLoading = false;

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  readonly sortedItems$!: Observable<MenuItem[]>;

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  constructor(
    private api: ApiService,
    private auth: AuthenticationService,
    private storage: LocalStorageService,
    private toast: ToastService
  ) {
    this._selectedSectionId$ = new PersistedBehaviorSubject<string | null>(null, {
      storage: this.storage,
      getKey: () => `menu.selectedSection:${this.auth.currentRestaurantRole?.restaurant_id ?? 'global'}`,
      validate: (v): v is string | null => v === null || typeof v === 'string',
    });
    this.selectedSectionId$ = this._selectedSectionId$.asObservable();
    this.items$ = combineLatest([
      this._allItems$,
      this._selectedSectionId$,
    ]).pipe(
      map(([allItems, sectionId]) =>
        sectionId ? allItems.filter(item => item.section === sectionId) : []
      )
    );
    this._sortMode$ = new PersistedBehaviorSubject<SortMode>('manual', {
      storage: this.storage,
      getKey: () => `menu.sortMode:${this.auth.currentRestaurantRole?.restaurant_id ?? 'global'}`,
      validate: (v): v is SortMode =>
        typeof v === 'string' && (SORT_MODES as readonly string[]).includes(v),
    });
    this.sortMode$ = this._sortMode$.asObservable();
    this.sortedItems$ = combineLatest([this.items$, this._sortMode$]).pipe(
      map(([items, mode]) => applyMenuSort(items, mode))
    );
  }

  // ---------------------------------------------------------------------------
  // Boundary normalization
  // ---------------------------------------------------------------------------

  /**
   * Coerces a backend MenuItem record's JSONField values to their expected
   * shapes. Older items with corrupted JSONField data (e.g. tags stored
   * as an object literal instead of an array) would otherwise cause NG0901
   * errors when their values feed into *ngFor in the templates.
   *
   * This is intentionally tolerant: anything that doesn't match the expected
   * type is replaced with the empty form (array → [], object → {}). We do not
   * attempt to "interpret" malformed data — if it's wrong, treat it as empty
   * and let the user re-enter it through the form if they care.
   */
  private normalizeMenuItem(item: any): any {
    if (!item || typeof item !== 'object') return item;
    // Post-PR3, tags are objects ({id,name,category,icon,colour}); tolerate
    // the legacy string[] shape one release more in case a stale cached
    // payload sneaks through, then drop the fallback.
    const rawTags = Array.isArray(item.tags) ? item.tags : [];
    const tags = rawTags
      .map((t: any) => {
        if (t && typeof t === 'object' && t.name) return t;
        if (typeof t === 'string' && t.trim()) {
          return { id: t, name: t, category: 'descriptor', icon: null, colour: 'gray' };
        }
        return null;
      })
      .filter((t: any) => t !== null);
    return {
      ...item,
      allergens: Array.isArray(item.allergens) ? item.allergens : [],
      tags,
      extras_applicable: Array.isArray(item.extras_applicable) ? item.extras_applicable : [],
      options: this.normalizeOptions(item.options),
      discount_details: (item.discount_details && typeof item.discount_details === 'object' && !Array.isArray(item.discount_details))
        ? item.discount_details
        : {},
    };
  }

  private normalizeOptions(options: any): any {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      return { hasModifiers: false, groups: [] };
    }
    return {
      hasModifiers: !!options.hasModifiers,
      groups: Array.isArray(options.groups)
        ? options.groups.map((group: any) => ({
            ...group,
            choices: Array.isArray(group?.choices) ? group.choices : [],
          }))
        : [],
    };
  }

  // ---------------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------------

  loadSections(restaurantId: string): void {
    this._isLoading$.next(true);
    this._error$.next(null);

    this.api.loadAllPages<MenuSectionListItem>(
      'restaurant-setup/menusections/',
      { restaurant: restaurantId }
    ).subscribe({
      next: (sections: MenuSectionListItem[]) => {
        this._rawSections$.next(sections);
        this._isLoading$.next(false);
        if (sections.length > 0) {
          const currentId = this._selectedSectionId$.getValue();
          if (!currentId || !sections.find(s => s.id === currentId)) {
            this.selectSection(sections[0].id);
          }
        }
      },
      error: (err) => {
        this._error$.next(err?.message ?? 'Failed to load sections');
        this._isLoading$.next(false);
      }
    });
  }

  createSection(data: any): Observable<any> {
    const isFormData = this.hasFileValue(data);
    return this.api.postPatch(
      'restaurant-setup/menusections/', data, 'post', '', {}, isFormData, '', true
    );
  }

  updateSection(data: any): Observable<any> {
    const isFormData = this.hasFileValue(data);
    return this.api.postPatch(
      'restaurant-setup/menusections/', data, 'put', '', {}, isFormData, '', true
    );
  }

  deleteSection(id: string, reason: string): Observable<any> {
    return this.api.Delete('restaurant-setup/menusections/', { id, deletion_reason: reason });
  }

  selectSection(id: string): void {
    // Pure selection — items$ derives from _allItems$ + _selectedSectionId$,
    // so simply advancing the selection re-filters the already-loaded items.
    // Triggering a fetch from here caused the duplicate menuitems requests
    // because loadSections auto-selects before the parallel loadAllItems has
    // finished, and an empty _allItems$ snapshot misled loadItems into
    // re-entering loadAllPages.
    this._selectedSectionId$.next(id);
  }

  toggleSectionAvailability(id: string, available: boolean): Observable<any> {
    return this.api.postPatch(
      'restaurant-setup/menusections/', { id, available }, 'put', '', {}, false, '', true
    );
  }

  // ---------------------------------------------------------------------------
  // Section Groups
  // ---------------------------------------------------------------------------

  loadSectionGroups(sectionId: string): Observable<ApiResponse<any>> {
    return this.api.get<any>(null, 'restaurant-setup/sectiongroups/', { section: sectionId });
  }

  createSectionGroup(data: any): Observable<any> {
    return this.api.postPatch(
      'restaurant-setup/sectiongroups/', data, 'post', null, {}, false, '', true
    );
  }

  updateSectionGroup(data: any): Observable<any> {
    return this.api.postPatch(
      'restaurant-setup/sectiongroups/', data, 'put', null, {}, false, '', true
    );
  }

  deleteSectionGroup(id: string, reason: string): Observable<any> {
    return this.api.Delete('restaurant-setup/sectiongroups/', { id, deletion_reason: reason });
  }

  toggleGroupAvailability(id: string, available: boolean): Observable<any> {
    return this.api.postPatch(
      'restaurant-setup/sectiongroups/', { id, available }, 'put', null, {}, false, '', true
    );
  }

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  loadAllItems(restaurantId: string): void {
    if (this.allItemsLoading) return;
    this.allItemsLoading = true;
    this.api.loadAllPages<MenuItem>(
      'restaurant-setup/menuitems/',
      { restaurant: restaurantId }
    ).pipe(
      finalize(() => { this.allItemsLoading = false; })
    ).subscribe({
      next: (records: MenuItem[]) => {
        this._allItems$.next(records.map(item => this.normalizeMenuItem(item)));
      },
    });
  }

  createItem(data: any): Observable<any> {
    const isFormData = this.hasFileValue(data);
    return this.api.postPatch(
      'restaurant-setup/menuitems/', data, 'post', '', {}, isFormData, '', true
    );
  }

  updateItem(data: any): Observable<any> {
    const isFormData = this.hasFileValue(data);
    return this.api.postPatch(
      'restaurant-setup/menuitems/', data, 'put', '', {}, isFormData, '', true
    );
  }

  deleteItem(id: string, reason: string): Observable<any> {
    return this.api.Delete('restaurant-setup/menuitems/', { id, deletion_reason: reason });
  }

  toggleItemAvailability(id: string, available: boolean): Observable<any> {
    return this.api.postPatch(
      'restaurant-setup/menuitems/', { id, available }, 'put', '', {}, false, '', true
    );
  }

  toggleItemStock(id: string, inStock: boolean): Observable<any> {
    return this.api.postPatch(
      'restaurant-setup/menuitems/', { id, in_stock: inStock }, 'put', '', {}, false, '', true
    );
  }

  toggleItemBadge(id: string, field: 'is_featured' | 'is_popular' | 'is_new', value: boolean): Observable<any> {
    return this.api.postPatch(
      'restaurant-setup/menuitems/', { id, [field]: value }, 'put', '', {}, false, '', true
    );
  }

  reorderSections(orderedIds: string[]): Observable<any> {
    return this.api.postPatch(
      'restaurant-setup/reorder-menu-sections/', { ordered_ids: orderedIds }, 'put'
    );
  }

  reorderItems(sectionId: string, orderedIds: string[]): Observable<any> {
    return this.api.postPatch(
      'restaurant-setup/reorder-section-items/',
      { section_id: sectionId, ordered_ids: orderedIds },
      'put'
    );
  }

  searchItems(query: string, _restaurantId: string): void {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      this._searchResults$.next([]);
      return;
    }

    const allItems = this._allItems$.getValue();
    const matches = allItems.filter(item => {
      const name = (item.name ?? '').toLowerCase();
      const description = (item.description ?? '').toLowerCase();
      return name.includes(trimmed) || description.includes(trimmed);
    });

    this._searchResults$.next(matches);
    // _isSearching$ is intentionally not toggled — search is now synchronous.
  }

  updateItemImage(data: any): Observable<any> {
    return this.api.postPatch(
      'restaurant-setup/menuitems/', data, 'put', '', {}, true, '', true
    );
  }

  // ---------------------------------------------------------------------------
  // Other
  // ---------------------------------------------------------------------------

  loadRestaurantDetails(id: string): Observable<any> {
    return this.api.get<any>(null, 'restaurant-setup/details/', { id, record: 'restaurants' });
  }

  submitFirstTimeReview(data: any): Observable<any> {
    return this.api.postPatch(
      'restaurant-setup/manager-actions/first-time-menu-review/', data, 'post'
    );
  }

  refreshAll(): void {
    const restaurantId = this.auth.currentRestaurantRole?.restaurant_id;
    if (!restaurantId) return;

    this.loadSections(restaurantId);
    this.loadAllItems(restaurantId);
    this.hydrateSortMode(restaurantId);
    // items$ and extras$ update automatically via derivation from allItems$
  }

  setSortMode(mode: SortMode): void {
    const prev = this._sortMode$.getValue();
    // Optimistic: instant UI + localStorage cache via the PersistedBehaviorSubject.
    this._sortMode$.next(mode);

    const restaurant = this.auth.currentRestaurantRole?.restaurant_id;
    if (!restaurant) return; // no restaurant id → keep the optimistic local value only

    // Persist server-side (mirrors updateSection's postPatch shape).
    this.api
      .postPatch('restaurant-setup/menu-item-sort-mode/', { restaurant, mode }, 'put', '', {}, false, '', true)
      .subscribe({
        error: () => {
          this._sortMode$.next(prev);
          this.toast.error('Failed to save sort order');
        },
      });
  }

  /**
   * Server is the source of truth for the sort mode; localStorage stays only as a
   * no-flash paint cache. On load, fetch the persisted mode and apply it when it's
   * a valid SORT_MODES value. On error, keep the cached value.
   */
  private hydrateSortMode(restaurantId: string): void {
    this.api
      .get<any>(null, 'restaurant-setup/menu-item-sort-mode/', { restaurant: restaurantId })
      .subscribe({
        next: (res: any) => {
          const it = res?.item_sort_mode;
          if ((SORT_MODES as readonly string[]).includes(it)) {
            this._sortMode$.next(it as SortMode);
          }
        },
        error: () => {
          /* keep the cached localStorage value */
        },
      });
  }

  getSectionsSnapshot(): MenuSectionListItem[] {
    return this._rawSections$.getValue();
  }

  updateSectionsLocally(sections: MenuSectionListItem[]): void {
    this._rawSections$.next(sections);
  }

  getItemsSnapshot(): MenuItem[] {
    const sectionId = this._selectedSectionId$.getValue();
    return this._allItems$.getValue().filter(item => item.section === sectionId);
  }

  getSelectedSectionId(): string | null {
    return this._selectedSectionId$.getValue();
  }

  updateItemLocally(itemId: string, changes: Partial<MenuItem>): void {
    const allItems = this._allItems$.getValue();
    const before = allItems.find(item => item.id === itemId);
    this._allItems$.next(
      allItems.map(item => item.id === itemId ? { ...item, ...changes } : item)
    );
    // Section change moves an item between sections — adjust both counts.
    const nextSection = changes.section;
    const prevSection = before?.section;
    if (nextSection && prevSection && nextSection !== prevSection) {
      this.adjustSectionItemCount(prevSection, -1);
      this.adjustSectionItemCount(nextSection, +1);
    }
  }

  removeItemLocally(itemId: string): void {
    const allItems = this._allItems$.getValue();
    const removed = allItems.find(item => item.id === itemId);
    this._allItems$.next(allItems.filter(item => item.id !== itemId));
    if (removed) {
      this.adjustSectionItemCount(removed.section, -1);
    }
  }

  addItemLocally(item: MenuItem): void {
    const normalized = this.normalizeMenuItem(item);
    const allItems = this._allItems$.getValue();
    // Guard against double-insert (e.g. backend somehow returns an existing id).
    if (allItems.some(i => i.id === normalized.id)) {
      this._allItems$.next(
        allItems.map(i => i.id === normalized.id ? normalized : i)
      );
      return;
    }
    this._allItems$.next([...allItems, normalized]);
    this.adjustSectionItemCount(normalized.section, +1);
  }

  updateItemFullyLocally(item: MenuItem): void {
    const normalized = this.normalizeMenuItem(item);
    const allItems = this._allItems$.getValue();
    const before = allItems.find(i => i.id === normalized.id);
    this._allItems$.next(
      allItems.map(i => i.id === normalized.id ? normalized : i)
    );
    const prevSection = before?.section;
    const nextSection = normalized.section;
    if (nextSection && prevSection && nextSection !== prevSection) {
      this.adjustSectionItemCount(prevSection, -1);
      this.adjustSectionItemCount(nextSection, +1);
    }
  }

  /**
   * Reorder items WITHIN a single section in `_allItems$`, preserving the
   * relative position of items in OTHER sections. Used for optimistic UI
   * updates when the user drags an item — the rendered order updates
   * immediately, the backend call follows.
   *
   * Walks `_allItems$` once, and whenever it encounters an item belonging to
   * `sectionId`, replaces it in place with the next item from the reordered
   * sequence. Items in other sections keep their original positions.
   *
   * Quietly ignores ids in `orderedIds` that don't currently exist in the
   * section — the caller has already validated the order against a snapshot
   * of `getItemsSnapshot()`, so a stray id here would represent a race we
   * can't recover from optimistically anyway. The backend reorder call will
   * either succeed (new state correct) or fail and we refreshAll() to recover.
   */
  updateItemsOrderLocally(sectionId: string, orderedIds: string[]): void {
    const allItems = this._allItems$.getValue();
    const sectionItemsById = new Map<string, MenuItem>(
      allItems
        .filter(i => i.section === sectionId)
        .map(i => [i.id, i] as const)
    );

    const reorderedSection: MenuItem[] = orderedIds
      .map(id => sectionItemsById.get(id))
      .filter((i): i is MenuItem => !!i);

    let cursor = 0;
    const newAllItems = allItems.map(item => {
      if (item.section === sectionId) {
        return reorderedSection[cursor++] ?? item;
      }
      return item;
    });

    this._allItems$.next(newAllItems);
  }

  removeSectionLocally(sectionId: string): void {
    const currentSections = this._rawSections$.getValue();
    this._rawSections$.next(currentSections.filter(s => s.id !== sectionId));
  }

  updateSectionLocally(sectionId: string, changes: Partial<MenuSectionListItem>): void {
    const current = this._rawSections$.getValue();
    const updated = current.map(s =>
      s.id === sectionId ? { ...s, ...changes } : s
    );
    this._rawSections$.next(updated);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private hasFileValue(obj: any): boolean {
    if (!obj || typeof obj !== 'object') return false;
    return Object.values(obj).some(v => v instanceof File);
  }

  /**
   * Bumps `item_count` for a section by `delta` (e.g. +1 on add, -1 on remove)
   * in the local sections cache so the rail counter reflects optimistic
   * mutations until the next loadSections call. Floors at 0.
   */
  private adjustSectionItemCount(sectionId: string | undefined | null, delta: number): void {
    if (!sectionId) return;
    const sections = this._rawSections$.getValue();
    let changed = false;
    const next = sections.map(s => {
      if (s.id !== sectionId) return s;
      changed = true;
      return { ...s, item_count: Math.max(0, (s.item_count ?? 0) + delta) };
    });
    if (changed) this._rawSections$.next(next);
  }
}
