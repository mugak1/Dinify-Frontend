import { Injectable, Signal, WritableSignal, computed, effect, signal } from '@angular/core';
import { getTagColorClasses, getTagIcon } from 'src/app/_common/utils/tag-utils';

@Injectable({ providedIn: 'root' })
export class MenuNavStateService {
  menuList: WritableSignal<any[] | null> = signal<any[] | null>(null);
  filteredMenuList: WritableSignal<any[] | null> = signal<any[] | null>(null);

  currentSection: WritableSignal<string> = signal('');
  searchQuery: WritableSignal<string> = signal('');
  showSearch: WritableSignal<boolean> = signal(false);
  isLoading: WritableSignal<boolean> = signal(true);

  selectedTags: WritableSignal<string[]> = signal<string[]>([]);
  presetTags: WritableSignal<any[]> = signal<any[]>([]);
  showTagFilter: WritableSignal<boolean> = signal(false);
  localSelectedTags: WritableSignal<string[]> = signal<string[]>([]);

  isMenuActive: WritableSignal<boolean> = signal(false);

  /**
   * Pixel offset at which the nav bar sticks to the viewport top. Set by
   * MenuNavBarComponent from its `stickyTop` @Input on mount. Default 49 matches
   * the rest-app inline nav bar; the diner shell overrides to 60.
   */
  stickyTopPx: WritableSignal<number> = signal(49);

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
      (this.selectedTags().length > 0 ? FILTER_ROW_PX : 0)
    );
  });

  constructor() {
    // Mirror navStackHeight into a CSS custom property on :root so that
    // section `scroll-mt-[var(--menu-nav-stack-height)]` tracks the real
    // nav bar height reactively. Effect runs on service instantiation
    // (setting an initial value) and on every change to stickyTopPx or
    // selectedTags. The service is providedIn:'root', so the effect's
    // lifetime matches the app's.
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

  filterableTags: Signal<any[]> = computed(() =>
    this.presetTags().filter((t: any) => t.filterable),
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

  filterMenu(): void {
    const menu = this.menuList();
    if (!menu) return;

    let result: any[] = menu as any[];
    const tags = this.selectedTags();
    const query = this.searchQuery();

    if (tags.length > 0) {
      result = result
        .map((section: any) => ({
          ...section,
          items: (section.items || []).filter((item: any) =>
            tags.some(tag => item.allergens?.includes(tag)),
          ),
        }))
        .filter((section: any) => section.items.length > 0);
    }

    if (query) {
      const q = query.toLowerCase();
      result = result
        .map((section: any) => ({
          ...section,
          items: (section.items || []).filter((item: any) =>
            item.name.toLowerCase().includes(q),
          ),
        }))
        .filter((section: any) => section.items.length > 0);
    }

    this.filteredMenuList.set(result);
  }

  openTagFilter(): void {
    this.localSelectedTags.set([...this.selectedTags()]);
    this.showTagFilter.set(true);
  }

  closeTagFilter(): void {
    this.showTagFilter.set(false);
  }

  removeTag(tagName: string): void {
    this.selectedTags.set(this.selectedTags().filter(t => t !== tagName));
    this.filterMenu();
  }

  clearAllTags(): void {
    this.selectedTags.set([]);
    this.filterMenu();
  }

  getTagBadge(tagName: string): { colorClasses: string; iconSvg: string } {
    const preset = this.presetTags().find((p: any) => p.name === tagName);
    return {
      colorClasses: preset ? getTagColorClasses(preset.color) : 'bg-gray-100 text-gray-700',
      iconSvg: preset ? getTagIcon(preset.icon) : '',
    };
  }

  toggleTagSelection(tagName: string): void {
    const current = this.localSelectedTags();
    this.localSelectedTags.set(
      current.includes(tagName)
        ? current.filter(t => t !== tagName)
        : [...current, tagName],
    );
  }

  isTagSelected(tagName: string): boolean {
    return this.localSelectedTags().includes(tagName);
  }

  clearLocalTagSelection(): void {
    this.localSelectedTags.set([]);
  }

  applyTagFilter(): void {
    this.selectedTags.set([...this.localSelectedTags()]);
    this.showTagFilter.set(false);
    this.filterMenu();
  }
}
