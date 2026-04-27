import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { MenuItem, MenuSectionListItem, ApiResponse } from 'src/app/_models/app.models';

export type SortMode = 'manual' | 'a-z' | 'price-low' | 'price-high';

@Injectable({
  providedIn: 'root'
})
export class MenuService {

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  private readonly _rawSections$ = new BehaviorSubject<MenuSectionListItem[]>([]);

  private readonly _selectedSectionId$ = new BehaviorSubject<string | null>(null);
  readonly selectedSectionId$ = this._selectedSectionId$.asObservable();

  private readonly _allItems$ = new BehaviorSubject<MenuItem[]>([]);
  readonly allItems$ = this._allItems$.asObservable();

  /**
   * Whether _allItems$ has received its first successful response. Until this
   * is true, sections$ should use the backend-provided item_count instead of
   * the frontend-derived count — otherwise the derivation produces 0 for every
   * section during the gap between sections-GET and items-GET, causing a brief
   * "0 Items" flicker on initial page load.
   *
   * Once flipped to true, this stays true for the lifetime of the service.
   * Subsequent loadAllItems calls (e.g. via refreshAll on error fallback)
   * don't reset it, because the existing derived counts are correct enough
   * during a refetch — better to show slightly stale derived counts during a
   * refetch than to flicker back to backend counts and back again.
   */
  private readonly _allItemsLoaded$ = new BehaviorSubject<boolean>(false);

  readonly sections$: Observable<MenuSectionListItem[]> = combineLatest([
    this._rawSections$,
    this._allItems$,
    this._allItemsLoaded$,
  ]).pipe(
    map(([sections, allItems, itemsLoaded]) => {
      if (!itemsLoaded) {
        // Items haven't returned yet on this page load. Use backend's
        // pre-computed item_count rather than deriving 0 from an empty
        // _allItems$.
        return sections;
      }
      return sections.map(section => ({
        ...section,
        item_count: allItems.filter(item => (item as any).section === section.id).length,
      }));
    })
  );

  readonly items$: Observable<MenuItem[]> = combineLatest([
    this._allItems$,
    this._selectedSectionId$,
  ]).pipe(
    map(([allItems, sectionId]) =>
      sectionId ? allItems.filter(item => (item as any).section === sectionId) : []
    )
  );

  readonly extras$: Observable<MenuItem[]> = this._allItems$.pipe(
    map(items => items.filter(item => item.is_extra === true))
  );

  private readonly _sortMode$ = new BehaviorSubject<SortMode>('manual');
  readonly sortMode$ = this._sortMode$.asObservable();

  private readonly _isLoading$ = new BehaviorSubject<boolean>(false);
  readonly isLoading$ = this._isLoading$.asObservable();

  private readonly _error$ = new BehaviorSubject<string | null>(null);
  readonly error$ = this._error$.asObservable();

  private readonly _searchResults$ = new BehaviorSubject<MenuItem[]>([]);
  readonly searchResults$ = this._searchResults$.asObservable();

  private readonly _isSearching$ = new BehaviorSubject<boolean>(false);
  readonly isSearching$ = this._isSearching$.asObservable();

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  readonly sortedItems$: Observable<MenuItem[]> = combineLatest([
    this.items$,
    this._sortMode$
  ]).pipe(
    map(([items, mode]) => this.applySortMode([...items], mode))
  );

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  constructor(
    private api: ApiService,
    private auth: AuthenticationService
  ) {}

  // ---------------------------------------------------------------------------
  // Boundary normalization
  // ---------------------------------------------------------------------------

  /**
   * Coerces a backend MenuItem record's JSONField values to their expected
   * shapes. Older items with corrupted JSONField data (e.g. allergens stored
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
    return {
      ...item,
      allergens: Array.isArray(item.allergens) ? item.allergens : [],
      tags: Array.isArray(item.tags) ? item.tags : [],
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

    this.api.get<MenuSectionListItem>(null, 'restaurant-setup/menusections/', { restaurant: restaurantId })
      .subscribe({
        next: (res: ApiResponse<MenuSectionListItem>) => {
          const sections = res?.data?.records ?? [];
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
    this._selectedSectionId$.next(id);
    this.loadItems(id);
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

  loadItems(sectionId: string): void {
    // items$ is derived from allItems$ + selectedSectionId$.
    // If allItems$ is empty, trigger a load; otherwise the derived stream handles it.
    if (this._allItems$.getValue().length === 0) {
      const restaurantId = this.auth.currentRestaurantRole?.restaurant_id;
      if (restaurantId) {
        this.loadAllItems(restaurantId);
      }
    }
  }

  loadAllItems(restaurantId: string): void {
    this.api.get<MenuItem>(null, 'restaurant-setup/menuitems/', { restaurant: restaurantId })
      .subscribe({
        next: (res: ApiResponse<MenuItem>) => {
          const records = res?.data?.records ?? [];
          this._allItems$.next(records.map(item => this.normalizeMenuItem(item)));
          this._allItemsLoaded$.next(true);
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
    // items$ and extras$ update automatically via derivation from allItems$
  }

  setSortMode(mode: SortMode): void {
    this._sortMode$.next(mode);
  }

  getSectionsSnapshot(): MenuSectionListItem[] {
    return this._rawSections$.getValue();
  }

  updateSectionsLocally(sections: MenuSectionListItem[]): void {
    this._rawSections$.next(sections);
  }

  getItemsSnapshot(): MenuItem[] {
    const sectionId = this._selectedSectionId$.getValue();
    return this._allItems$.getValue().filter(item => (item as any).section === sectionId);
  }

  updateItemLocally(itemId: string, changes: Partial<MenuItem>): void {
    const allItems = this._allItems$.getValue();
    this._allItems$.next(
      allItems.map(item => item.id === itemId ? { ...item, ...changes } : item)
    );
    // items$ and extras$ update automatically via derivation
  }

  removeItemLocally(itemId: string): void {
    const allItems = this._allItems$.getValue();
    this._allItems$.next(allItems.filter(item => item.id !== itemId));
    // items$ and extras$ update automatically via derivation
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
    // items$, extras$, and section item_count all update automatically via derivation.
  }

  updateItemFullyLocally(item: MenuItem): void {
    const normalized = this.normalizeMenuItem(item);
    const allItems = this._allItems$.getValue();
    this._allItems$.next(
      allItems.map(i => i.id === normalized.id ? normalized : i)
    );
    // items$, extras$ update automatically via derivation.
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

  private applySortMode(items: MenuItem[], mode: SortMode): MenuItem[] {
    switch (mode) {
      case 'a-z':
        return items.sort((a, b) =>
          (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' })
        );
      case 'price-low':
        return items.sort((a, b) => (a.primary_price ?? 0) - (b.primary_price ?? 0));
      case 'price-high':
        return items.sort((a, b) => (b.primary_price ?? 0) - (a.primary_price ?? 0));
      case 'manual':
      default:
        return items;
    }
  }

  private hasFileValue(obj: any): boolean {
    if (!obj || typeof obj !== 'object') return false;
    return Object.values(obj).some(v => v instanceof File);
  }
}
