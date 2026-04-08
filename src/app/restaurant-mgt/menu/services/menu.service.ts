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

  private readonly _sections$ = new BehaviorSubject<MenuSectionListItem[]>([]);
  readonly sections$ = this._sections$.asObservable();

  private readonly _selectedSectionId$ = new BehaviorSubject<string | null>(null);
  readonly selectedSectionId$ = this._selectedSectionId$.asObservable();

  private readonly _items$ = new BehaviorSubject<MenuItem[]>([]);
  readonly items$ = this._items$.asObservable();

  private readonly _extras$ = new BehaviorSubject<MenuItem[]>([]);
  readonly extras$ = this._extras$.asObservable();

  private readonly _sortMode$ = new BehaviorSubject<SortMode>('manual');
  readonly sortMode$ = this._sortMode$.asObservable();

  private readonly _allItems$ = new BehaviorSubject<MenuItem[]>([]);
  readonly allItems$ = this._allItems$.asObservable();

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
    this._items$,
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
  // Sections
  // ---------------------------------------------------------------------------

  loadSections(restaurantId: string): void {
    this._isLoading$.next(true);
    this._error$.next(null);

    this.api.get<MenuSectionListItem>(null, 'restaurant-setup/menusections/', { restaurant: restaurantId })
      .subscribe({
        next: (res: ApiResponse<MenuSectionListItem>) => {
          const sections = res?.data?.records ?? [];
          this._sections$.next(sections);
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
    this._isLoading$.next(true);
    this._error$.next(null);

    this.api.get<MenuItem>(null, 'restaurant-setup/menuitems/', { section: sectionId })
      .subscribe({
        next: (res: ApiResponse<MenuItem>) => {
          this._items$.next(res?.data?.records ?? []);
          this._isLoading$.next(false);
        },
        error: (err) => {
          this._error$.next(err?.message ?? 'Failed to load items');
          this._isLoading$.next(false);
        }
      });
  }

  loadAllItems(restaurantId: string): void {
    this.api.get<MenuItem>(null, 'restaurant-setup/menuitems/', { restaurant: restaurantId })
      .subscribe({
        next: (res: ApiResponse<MenuItem>) => {
          this._allItems$.next(res?.data?.records ?? []);
        },
      });
  }

  loadExtras(restaurantId: string): void {
    this.api.get<MenuItem>(null, 'restaurant-setup/menuitems/', { is_extra: true, restaurant: restaurantId })
      .subscribe({
        next: (res: ApiResponse<MenuItem>) => {
          this._extras$.next(res?.data?.records ?? []);
        },
        error: (err) => {
          this._error$.next(err?.message ?? 'Failed to load extras');
        }
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

  toggleItemBadge(id: string, field: 'is_featured' | 'is_popular' | 'is_new', value: boolean): Observable<any> {
    return this.api.postPatch(
      'restaurant-setup/menuitems/', { id, [field]: value }, 'put', '', {}, false, '', true
    );
  }

  reorderItems(ordering: { id: string; listing_position: number }[]): Observable<any> {
    return this.api.postPatch(
      'restaurant-setup/reorder-menu-items/', { ordering }, 'put'
    );
  }

  searchItems(query: string, restaurantId: string): void {
    this._isSearching$.next(true);
    this._searchResults$.next([]);

    this.api.get<MenuItem>(null, 'restaurant-setup/menuitems/', { name: query, restaurant: restaurantId })
      .subscribe({
        next: (res: ApiResponse<MenuItem>) => {
          this._searchResults$.next(res?.data?.records ?? []);
          this._isSearching$.next(false);
        },
        error: (err) => {
          this._error$.next(err?.message ?? 'Search failed');
          this._isSearching$.next(false);
        }
      });
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

    const sectionId = this._selectedSectionId$.getValue();
    if (sectionId) {
      this.loadItems(sectionId);
    }
  }

  setSortMode(mode: SortMode): void {
    this._sortMode$.next(mode);
  }

  getSectionsSnapshot(): MenuSectionListItem[] {
    return this._sections$.getValue();
  }

  updateSectionsLocally(sections: MenuSectionListItem[]): void {
    this._sections$.next(sections);
  }

  getItemsSnapshot(): MenuItem[] {
    return this._items$.getValue();
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
