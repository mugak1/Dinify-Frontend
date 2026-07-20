import { AfterViewInit, Component, ElementRef, Input, OnDestroy, OnInit, ViewChild, effect, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { BasketItem, MenuItem, MenuItemTagRef, Restaurant, TableScan } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { BasketService } from 'src/app/_services/basket.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { SessionStorageService } from 'src/app/_services/storage/session-storage.service';
import {
  discountIsLive as discountIsLiveFn,
  serverEffectivePrice,
  serverSavings,
} from 'src/app/_shared/utils/price-utils';
import { matchedDescriptionOnly } from 'src/app/_shared/utils/menu-search';
import { environment } from 'src/environments/environment';
import { MenuNavStateService } from './menu-nav-state.service';
import { splitTagsForCard, TagCardSplit } from 'src/app/_shared/tags/tag-truncation';
import { menuItemUrl } from '../menu-item-detail/menu-item-url';
import { resolveDinerMountEmbedded } from '../diner-mount';
import { ConnectivityService } from 'src/app/_services/connectivity.service';

@Component({
    selector: 'app-diners-menu',
    templateUrl: './menu.component.html',
    styleUrls: ['./menu.component.css'],
    standalone: false
})
export class DinersMenuComponent implements OnInit, AfterViewInit, OnDestroy {
  // One-shot sessionStorage key for restoring the menu's scroll position when
  // returning from the item-detail page. Cleared on read so a fresh menu load
  // (no prior item-detail navigation) lands at the top.
  private static readonly SCROLL_RESTORE_KEY = 'diner.menu.scrollY';

  /** Effective height (px) of the offline strip — the banner's sticky-top offset
   *  while offline, so it docks just under that strip. Matches the strip's visible
   *  40px (h-[42px] less the 2px safety tuck), mirroring the old 88 = 48 + 40. */
  private static readonly OFFLINE_STRIP_PX = 40;

  url = environment.apiUrl;

  // Set only when a COLD menu load (nothing rendered yet) fails outright —
  // renders the connection-error state with a "Try again" button. A background
  // revalidation failure behind a warm menu never sets this (see
  // refreshMenuInBackground), so a live menu is never replaced by an error.
  coldLoadFailed = false;
  isInRestApp = false;
  private storageSub?: Subscription;
  // Background revalidation bookkeeping: seq guards against a stale response
  // overwriting fresher data; refreshSub is torn down in ngOnDestroy.
  private refreshSeq = 0;
  private refreshSub?: Subscription;

  /** The single sticky banner — diner shell only; absent in the portal embed. */
  @ViewChild('menuBanner') private menuBanner?: ElementRef<HTMLElement>;
  /** Live banner height (px), fed by a ResizeObserver; 0 until first measured.
   *  Drives the scroll-margin var so clicked sections land flush under the banner. */
  private readonly bannerHeightPx = signal(0);
  private bannerResizeObserver?: ResizeObserver;

  @Input() restaurant?: Restaurant;
  @Input() restaurant_id: any = '';
  menu_list?: MenuItem[] | any = [];

  // Hero fields, read from the shared table-scan payload (sessionStorage) since
  // show-menu returns sections only. Populated by hydrateHeroFields() once the
  // restaurant resolves; coverPhoto null ⇒ no hero (it's optional).
  coverPhoto: string | null = null;
  /** A cover URL that 404'd — drops the hero so a broken image never shows a
   *  torn glyph; the menu falls back to its cover-less header. */
  coverFailed = false;
  restaurantName = '';
  tableNumber: number | null = null;

  /** True when the table has an order that hasn't cleared the kitchen. Reads the
   *  shared live signal (kept fresh by the shell's poll), so the heads-up banner
   *  appears/disappears without a manual refresh. */
  get tableHasOngoingOrder(): boolean {
    return this.navState.tableOngoingOrder();
  }

  get basketItems(): BasketItem[] {
    return this.basketService.Basket()?.items ?? [];
  }
  get totalAmount(): number {
    return this.basketService.Basket()?.totalAmount ?? 0;
  }

  /** Sticky-top offset for the single menu banner (diner shell). Flush to the
   *  viewport top when online; 40px down — clearing the offline strip — when offline.
   *  Identity-row (hero/condensed) visibility is CSS-driven; this only positions the
   *  banner. The portal embed renders the bare nav-bar with its own 49px offset. */
  get bannerTop(): string {
    return this.connectivity.isOffline() ? `${DinersMenuComponent.OFFLINE_STRIP_PX}px` : '0px';
  }

  constructor(
    private sessionStorage: SessionStorageService,
    private api: ApiService,
    private basketService: BasketService,
    private router: Router,
    private readonly route: ActivatedRoute,
    public navState: MenuNavStateService,
    private toast: ToastService,
    private connectivity: ConnectivityService,
  ) {
    // Embed detection is declared ON THE ROUTE (DINER_MOUNT_EMBEDDED data on
    // each DinerAppModule mount) and resolved once from this activation's own
    // snapshot — never sniffed from router.url, which can still hold the
    // previous tree while a navigation is in flight. Resolved at construction
    // (the snapshot is fixed for the component's lifetime) so the flag is valid
    // before EVERY tryLoadMenu path, including the StorageValue subscription
    // registered below. See resolveDinerMountEmbedded.
    this.isInRestApp = resolveDinerMountEmbedded(this.route.snapshot);
    // Seed currentSection reactively whenever the menu loads (or reloads after
    // ngOnDestroy clears it). Self-healing: if currentSection ever falls back
    // to '' while a menu is loaded, this re-fires and re-populates it. Idempotent
    // on a non-empty currentSection, so it never clobbers scroll-spy emissions
    // or pill clicks. Replaces a prior imperative setCurrentSection() call in
    // loadMenu that didn't take visual effect on initial load.
    effect(() => {
      const list = this.navState.filteredMenuList();
      if (!list?.length) return;
      if (this.navState.currentSection()) return;
      const firstSectionName = list[0]?.name as string | undefined;
      this.navState.setCurrentSection(
        this.navState.featuredItems().length > 0 ? 'Featured' : (firstSectionName ?? ''),
      );
    });

    // Feed the shared scroll-margin var (--menu-nav-stack-height) from the banner's
    // real height plus its sticky-top offset, so clicked sections land flush under
    // it. Re-runs on a measured-height change (ResizeObserver) or an offline flip
    // (which shifts the banner down 40px). Stays null until first measured and in the
    // portal embed (no banner), where the service falls back to its constant formula.
    effect(() => {
      const h = this.bannerHeightPx();
      const top = this.connectivity.isOffline() ? DinersMenuComponent.OFFLINE_STRIP_PX : 0;
      this.navState.setMenuBannerStackHeight(h > 0 ? top + h : null);
    });

    this.restaurant = this.sessionStorage.getItem<Restaurant>('restaurant') as any;
    this.navState.setPresetTags(this.restaurant?.preset_tags || []);
    this.hydrateHeroFields();

    // When coming directly from a QR scan, the table-scan API call in the
    // DinerAppComponent wrapper may not have resolved yet — so session storage
    // may still be empty. Wait for the `restaurant` key to be set, then load.
    if (!this.restaurant) {
      this.storageSub = this.sessionStorage.StorageValue.subscribe((key: any) => {
        if (typeof key !== 'string' || !key.includes('restaurant')) return;
        const r = this.sessionStorage.getItem<Restaurant>('restaurant') as any;
        if (!r) return;
        this.restaurant = r;
        this.navState.setPresetTags(this.restaurant?.preset_tags || []);
        this.hydrateHeroFields();
        this.storageSub?.unsubscribe();
        this.storageSub = undefined;
        this.tryLoadMenu();
      });
    }
  }

  /** Reads the hero's display data from the shared table-scan payload. Cover
   *  photo and name come off the resolved `restaurant`; the table number lives
   *  on the 'Table' payload (written alongside 'restaurant' in the same sync
   *  block, so it's present whenever 'restaurant' is). Captured into plain
   *  fields rather than getters so the template never re-parses sessionStorage
   *  on a change-detection cycle. */
  private hydrateHeroFields(): void {
    this.coverPhoto = this.restaurant?.cover_photo ?? null;
    this.restaurantName = this.restaurant?.name ?? '';
    const table = this.sessionStorage.getItem<TableScan>('Table') as TableScan | null;
    this.tableNumber = table?.number ?? null;
  }

  /** Normalises the tags payload to MenuItemTagRef[]. Tolerates the legacy
   *  string[] shape too — pre-PR1 menu data may still arrive from a stale
   *  cache and we don't want it to crash the renderer. */
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

  /** Per-card tag truncation: keep allergens (safety-critical), cap
   *  non-allergens at 2 with a "+N" indicator for the rest. The detail
   *  page continues to render every tag via getVisibleTags. */
  getCardTags(tags: MenuItemTagRef[] | any[] | null | undefined): TagCardSplit<MenuItemTagRef> {
    return splitTagsForCard(this.getVisibleTags(tags));
  }

  ngOnInit() {
    this.navState.setMenuActive(true);
    // If restaurant is already available (session storage sync-read OR @Input()
    // from staff ordering), proceed immediately. Otherwise the StorageValue
    // subscription in the constructor will call tryLoadMenu() once it arrives.
    if (this.restaurant) {
      this.tryLoadMenu();
    }
  }

  ngAfterViewInit(): void {
    // Observe the banner's rendered height rather than reading offsetHeight every
    // scroll frame: the observer fires only on real size changes (identity row
    // showing on condense, filter row, search↔pills), never per frame. The banner
    // exists only in the diner shell (!isInRestApp), so guard on its presence.
    const el = this.menuBanner?.nativeElement;
    if (!el) return;
    this.bannerResizeObserver = new ResizeObserver(() => this.bannerHeightPx.set(el.offsetHeight));
    this.bannerResizeObserver.observe(el);
  }

  ngOnDestroy(): void {
    this.storageSub?.unsubscribe();
    // Tear down any mid-flight background revalidation — the next menu entry
    // revalidates again anyway.
    this.refreshSub?.unsubscribe();
    this.bannerResizeObserver?.disconnect();
    // Drop the banner-measured override so a later portal-embed mount (or any non-banner
    // consumer) falls back to the constant scroll-margin formula.
    this.navState.setMenuBannerStackHeight(null);
    this.navState.setMenuActive(false);
    // Intentionally NOT clearing the menu list here. The item-detail page is a
    // sibling route that constructs after this component is destroyed, so it
    // resolves the tapped item from the shared store — leaving the data in place
    // lets it do so without refetching the whole show-menu payload. loadMenu()
    // overwrites the store on menu re-entry, so this never goes stale; do not
    // "restore" a setMenuList(null) here.
    this.navState.setLoading(true);
    this.navState.searchQuery.set('');
    this.navState.showSearch.set(false);
    this.navState.selectedDietary.set([]);
    this.navState.selectedAllergens.set([]);
    this.navState.showTagFilter.set(false);
    this.navState.currentSection.set('');
    this.navState.clearPendingClickTarget();
  }

  private tryLoadMenu(): void {
    if (this.restaurant?.menu_approval_status == 'approve' || (this.restaurant as any)?.first_time_menu_approval) {
      this.loadMenu();
    } else {
      // Standalone diner shell → the diner error page; an embedded mount
      // (portal preview / admin embed) appends 'error' to its own URL instead.
      // Reuses the route-resolved flag from ngOnInit — do not re-derive here.
      if (!this.isInRestApp) {
        this.router.navigate(['/diner', 'error']);
      } else {
        this.router.navigate([this.router.url, 'error']);
      }
    }
  }

  removeItem(Id: string) {
    this.basketService.removeItem(Id);
  }

  get QuantitySum() {
    return this.basketItems.reduce((a, b) => a + b.quantity, 0);
  }

  loadMenu() {
    const rid = this.restaurant_id || this.restaurant?.id;
    // Warm entry: the store still holds a menu FOR THIS restaurant (survived
    // menu↔item). Render it immediately and revalidate silently — no skeleton,
    // no preload gate. A cold load only happens on first entry, a hard refresh,
    // or a different restaurant.
    const warm =
      this.navState.menuList() != null &&
      this.navState.loadedRestaurantId() === rid;
    if (warm) {
      // Clear any leftover isLoading=true that ngOnDestroy set on the way out.
      // This runs synchronously in ngOnInit BEFORE the first render, so the
      // skeleton never flashes.
      this.navState.setLoading(false);
      // Re-derive filteredMenuList from the surviving data + live filter signals
      // (search/tag selections persist across the round trip).
      this.navState.filterMenu();
      // Land where the diner was before tapping into the item.
      this.restoreScrollIfReturning();
      this.refreshMenuInBackground(rid);
      return;
    }
    this.coldLoadMenu(rid);
  }

  /** First load / hard refresh / different restaurant. Today's exact behaviour,
   *  plus stamping which restaurant the cached menu belongs to. */
  private coldLoadMenu(rid: any) {
    this.coldLoadFailed = false;
    this.navState.setLoading(true);
    this.navState.setLoadedRestaurantId(rid);
    this.api.get<MenuItem>(null, 'orders/journey/show-menu/', { restaurant: rid }).subscribe({
      next: (x: any) => {
        this.coldLoadFailed = false;
        this.menu_list = (x?.data as any) ?? [];
        this.navState.setMenuList(this.menu_list);
        this.navState.setItemSortMode(x?.item_sort_mode ?? 'manual');
        this.navState.filterMenu();
        // currentSection is seeded by the constructor effect that watches
        // filteredMenuList — no imperative call needed here.
        this.cacheUpsell(x);
        // Keep the skeleton visible until every item image has been preloaded
        // into the browser cache, so the reveal paints with no pop-in. A 5s
        // timeout caps the wait in case a CDN stalls.
        this.preloadImages(this.menu_list).then(() => {
          this.navState.setLoading(false);
          // Restore scroll only once the menu is rendered and has height —
          // otherwise window.scrollTo is a no-op. Imperative here (rather
          // than another effect) keeps ordering relative to setLoading
          // explicit.
          this.restoreScrollIfReturning();
        });
      },
      error: () => {
        // Cold load failed with nothing on screen — show a recoverable error
        // state instead of a blank page. Clear the global toast so the diner
        // sees one clean message (the connection-error panel), not two.
        this.navState.setLoading(false);
        this.coldLoadFailed = true;
        this.toast.clear();
      }
    });
  }

  /** Re-runs the cold load after a "Try again" tap on the connection-error
   *  state. Resets the flag so the skeleton shows during the re-fetch. */
  retryColdLoad(): void {
    this.coldLoadFailed = false;
    this.coldLoadMenu(this.restaurant_id || this.restaurant?.id);
  }

  /** Silent revalidation behind a warm render. Never touches setLoading and
   *  never runs the preloadImages gate (first-visit images are already cached;
   *  a genuinely new image lazy-loads into its fixed-size slot). A per-instance
   *  sequence number plus a restaurant re-check guard against a stale response
   *  swapping in after the diner has moved on. */
  private refreshMenuInBackground(rid: any) {
    const seq = ++this.refreshSeq;
    this.refreshSub?.unsubscribe();
    this.refreshSub = this.api.get<MenuItem>(null, 'orders/journey/show-menu/', { restaurant: rid }).subscribe({
      next: (x: any) => {
        if (seq !== this.refreshSeq) return;                              // superseded
        if ((this.restaurant_id || this.restaurant?.id) !== rid) return;  // restaurant changed
        const fresh = (x?.data as any) ?? [];
        this.menu_list = fresh;
        this.navState.setMenuList(fresh);
        this.navState.setLoadedRestaurantId(rid);
        this.navState.setItemSortMode(x?.item_sort_mode ?? 'manual');
        this.navState.filterMenu();
        this.cacheUpsell(x);
      },
      error: () => {
        // Keep the cached menu shown; never setLoading(true) here. The next
        // entry revalidates again anyway.
      }
    });
  }

  /** Cache upsell config so the basket can render it without another round-trip.
   *  Shared by cold load and background refresh so they stay in parity. */
  private cacheUpsell(x: any): void {
    if (x?.upsell) {
      this.sessionStorage.setItem('upsellConfig', x.upsell);
    } else {
      this.sessionStorage.removeItem?.('upsellConfig');
    }
  }

  /**
   * Preloads every item image in the menu into the browser cache.
   * Resolves when all images have fired load or error, or after 5s — whichever
   * comes first. Broken images never block; a missing image list short-circuits.
   */
  private preloadImages(menuSections: any[]): Promise<void> {
    const imageUrls: string[] = [];
    for (const section of menuSections || []) {
      for (const item of section?.items || []) {
        if (item?.image) {
          imageUrls.push(this.url + item.image);
        }
      }
    }

    if (imageUrls.length === 0) {
      return Promise.resolve();
    }

    const imagePromises = imageUrls.map(url =>
      new Promise<void>(resolve => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = url;
      })
    );

    const timeout = new Promise<void>(resolve => setTimeout(resolve, 5000));
    return Promise.race([Promise.all(imagePromises).then(() => {}), timeout]);
  }

  viewItem(i: MenuItem) {
    if (this.isOutOfStock(i)) return;
    this.saveScrollForReturn();
    const tableId = (this.sessionStorage.getItem<TableScan>('Table') as TableScan | null)?.id ?? '';
    this.router.navigate(menuItemUrl(tableId, i.id));
  }

  /** Best-effort persist of the current scroll Y so we can restore it when
   *  the diner returns from the item-detail page. Wrapped in try/catch
   *  because a storage failure must never block navigation. */
  private saveScrollForReturn(): void {
    try {
      this.sessionStorage.setItem(DinersMenuComponent.SCROLL_RESTORE_KEY, window.scrollY);
    } catch {
      // intentionally silent
    }
  }

  /** One-shot: reads the stored scroll Y, removes the key, and defers the
   *  scroll to the next macrotask so layout has settled. Returning a fresh
   *  load (no key) lands at the top. */
  private restoreScrollIfReturning(): void {
    let savedY: number | null = null;
    try {
      savedY = this.sessionStorage.getItem<number>(DinersMenuComponent.SCROLL_RESTORE_KEY);
    } catch {
      return;
    }
    if (savedY === null || typeof savedY !== 'number') return;
    this.sessionStorage.removeItem(DinersMenuComponent.SCROLL_RESTORE_KEY);
    setTimeout(() => window.scrollTo({ top: savedY!, behavior: 'instant' as ScrollBehavior }), 0);
  }

  addUnderScore(x: string) {
    return x.replace(/ /g, "_");
  }

  removeUnderscore(x: string) {
    return x.replace(/_/g, " ");
  }

  onSectionChange(sectionId: string): void {
    const pending = this.navState.pendingClickTarget();
    if (pending) {
      if (sectionId === pending) {
        // Scroll has arrived at the click target — commit and release the lock.
        this.navState.setCurrentSection(sectionId);
        this.navState.clearPendingClickTarget();
      }
      // Otherwise: the smooth-scroll animation is mid-flight and the spy is
      // emitting intermediate sections. Don't clobber the click's intent.
      return;
    }
    this.navState.setCurrentSection(sectionId);
  }

  scrollTo(section: any, _i: number) {
    document.querySelector('#' + this.addUnderScore(section))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  sanitizeId(name: string): string {
    return name.replace(/\s+/g, '-').toLowerCase();
  }

  /** Server-gated discount magnitude (the server emits 0 when inactive). */
  calculateDiscount(item: any): number {
    return item ? (Number(item.discount_percentage) || 0) : 0;
  }

  /** Savings against the server's effective base price (shared helper — completes the
   *  dedup with item-detail from PR1). */
  priceSaved(item: any): number {
    return serverSavings(item);
  }

  /** primary_price coerced to a number for the struck original on the card. */
  basePrice(item: any): number {
    return Number(item?.primary_price) || 0;
  }

  isOutOfStock(item: any): boolean {
    return item.in_stock === false;
  }

  /** True when the active search matched this item via its description only —
   *  drives the "Contains" chip on the card. */
  descMatchOnly(i: any): boolean {
    return matchedDescriptionOnly(i, this.navState.searchQuery());
  }

  /** The server's live-now discount verdict for this item (template gate). */
  discountIsLive(item: any): boolean {
    return discountIsLiveFn(item);
  }

  /** The server's effective base price (discounted when live, else primary). */
  getDisplayPrice(item: any): number {
    return serverEffectivePrice(item);
  }

  /** trackBy for the section and item loops so the silent background swap
   *  reuses existing DOM instead of repainting — no flash or scroll jump
   *  when fresh data lands. */
  trackSection = (_: number, s: any) => s?.id ?? s?.name;
  trackItem = (_: number, item: any) => item?.id;
}
