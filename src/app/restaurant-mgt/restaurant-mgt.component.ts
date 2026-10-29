import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, ViewChild, inject } from '@angular/core';
import { DOCUMENT, NgClass } from '@angular/common';
import { AuthenticationService } from '../_services/authentication.service';
import { ApiService } from '../_services/api.service';
import { RestaurantDetail } from '../_models/app.models';
import { environment } from 'src/environments/environment';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { LocalStorageService } from '../_services/storage/local-storage.service';
import { SidebarComponent } from './layout/sidebar/sidebar.component';
import { TopNavComponent } from './layout/top-nav/top-nav.component';
import { OfflineBannerComponent } from '../_shared/ui';
import { SessionActionsService } from './layout/session-actions.service';
import { landingPathFor } from './layout/restaurant-landing';
import { EXPANDED_WIDTH_PX, RAIL_WIDTH_PX, ShellRegime, regimeForWidth } from './layout/shell-layout';

// The SAVED rail preference: expanded (true) or collapsed (false) in the
// 'rail-push' regime (1280px and above) — and nothing else. Stored through
// LocalStorageService as `[dinify]sidebar.expanded` (the `[dinify]` prefix and
// `{value:T}` wrapping are added by StorageService). It is a standard `[dinify]`
// nav-state key, so it is cleared on every login attempt and on logout by
// AuthenticationService.clearPersistedNavState() — a fresh login falls back to the
// EXPANDED default, while a refresh restores the last toggle.
//
// ONLY THE RAIL TOGGLE IN THE PUSH REGIME WRITES IT (SHELL-FINISH-00). One boolean
// used to mean "drawer open" on a phone and "rail expanded" on a desktop, and its
// setter persisted every write, so closing the drawer on a phone saved "collapsed"
// for the desktop. The drawer and the 1024–1279 overlay are now their own,
// never-persisted states.
const SIDEBAR_STATE_KEY = 'sidebar.expanded';

/** How long the cross-tab notice shows before the reload (staff requests are already stopped). */
export const CROSS_TAB_NOTICE_MS = 1200;

/** `restaurant id : profile id`, as stored right now (see onStorage). */
function storedScope(): string {
  const read = (key: string): any => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      return null;
    }
  };
  return `${read('rest_role')?.restaurant_id ?? ''}:${read('user')?.profile?.id ?? ''}`;
}

@Component({
    changeDetection: ChangeDetectionStrategy.Eager,
    selector: 'app-restaurant-mgt',
    templateUrl: './restaurant-mgt.component.html',
    styleUrls: ['./restaurant-mgt.component.css'],
    standalone: true,
    imports: [NgClass, RouterOutlet, SidebarComponent, TopNavComponent, OfflineBannerComponent]
})
export class RestaurantMgtComponent implements OnDestroy {
  private readonly document = inject(DOCUMENT);
  /** Records the routed page so sign-out can ask once about unsaved changes. */
  readonly sessionActions = inject(SessionActionsService);

  @ViewChild(SidebarComponent) private sidebar?: SidebarComponent;
  @ViewChild(TopNavComponent) private topNav?: TopNavComponent;

  /**
   * CROSS-TAB GUARD (SHELL-FINISH-00, PR 3). The scope this document acts for:
   * `restaurant id : profile id`, the same pair the kitchen board uses
   * (`KitchenOrderService.currentScope`). Read from STORAGE, because storage is
   * what another tab changes. A token renewal elsewhere rewrites `user` with the
   * same pair and is ignored; a venue switch, a sign-out or a different user
   * signing in changes the pair.
   */
  private readonly scopeAtLoad = storedScope();
  /** Another tab moved this document's scope; the reload notice is showing. */
  leavingFor: { kind: 'switched' | 'other-user' | 'signed-out'; restaurant: string | null } | null = null;
  @ViewChild('leavingNotice') private leavingNotice?: ElementRef<HTMLElement>;

  /** The width regime, from the one source (`layout/shell-layout.ts`). */
  regime: ShellRegime;
  /** Below 1024: the overlay drawer is open. Never persisted. */
  drawerOpen = false;
  /** 1024–1279: the full sidebar is open OVER the content. Never persisted. */
  railOverlayOpen = false;
  /** 1280 and above: the saved preference (see SIDEBAR_STATE_KEY). */
  railExpanded: boolean;

  /** An overlay (the drawer, or the rail's overlay expansion) is open. */
  get overlayOpen(): boolean {
    return (this.regime === 'drawer' && this.drawerOpen)
      || (this.regime === 'rail-overlay' && this.railOverlayOpen);
  }

  /** The sidebar shows its 220px labelled panel (open drawer, overlay, or expanded rail). */
  get sidebarExpanded(): boolean {
    switch (this.regime) {
      case 'drawer': return this.drawerOpen;
      case 'rail-overlay': return this.railOverlayOpen;
      case 'rail-push': return this.railExpanded;
    }
  }

  /** The width the sidebar takes IN FLOW. Only the push regime ever takes 220. */
  get inFlowWidth(): number {
    switch (this.regime) {
      case 'drawer': return 0;
      case 'rail-overlay': return RAIL_WIDTH_PX;
      case 'rail-push': return this.railExpanded ? EXPANDED_WIDTH_PX : RAIL_WIDTH_PX;
    }
  }

  isChildComponent = false;
  has_tables = false;
  isMenuRoute = false;
  baseUrl = environment.apiUrl;

  constructor(
    public auth: AuthenticationService,
    private api: ApiService,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private localStorage: LocalStorageService
  ) {
    // Hydrate the saved rail preference. An absent key → EXPANDED default; a
    // stored boolean is restored as-is so a refresh preserves the last toggle.
    // Reading it writes nothing, at any width.
    const stored = this.localStorage.getItem<boolean>(SIDEBAR_STATE_KEY);
    this.railExpanded = typeof stored === 'boolean' ? stored : true;
    this.regime = regimeForWidth(window.innerWidth);
    this.syncScrollLock();

    const depth = this.route.pathFromRoot.length;
    this.isChildComponent = depth === 4;

    if (this.auth.currentRestaurantRole) {
      this.api
        .get<RestaurantDetail>(null, 'restaurant-setup/' + 'details/', {
          id: this.auth.currentRestaurantRole?.restaurant_id,
          record: 'restaurants',
        })
        .subscribe((x) => {
          this.auth.setCurrentRestaurant(x.data);
        });
    }

    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe(() => {
        this.has_tables = this.router.url.includes('tables');
        this.isMenuRoute =
          /\/menu(\/|\?|$)/.test(this.router.url) && !this.router.url.includes('/reports/');
        // A navigation closes whatever overlay is open; the saved rail
        // preference is not touched.
        this.closeOverlays();
        this.cdr.detectChanges();
      });

    this.isMenuRoute =
      /\/menu(\/|\?|$)/.test(this.router.url) && !this.router.url.includes('/reports/');
  }

  /**
   * Resizing or rotating across a boundary lands in the new regime's resting
   * state: both overlays closed, the saved preference applied as it was.
   */
  @HostListener('window:resize')
  onResize(): void {
    const next = regimeForWidth(window.innerWidth);
    if (next === this.regime) return;
    this.regime = next;
    this.drawerOpen = false;
    this.railOverlayOpen = false;
    this.syncScrollLock();
  }

  /**
   * Another tab changed the selected restaurant or the principal. This tab must
   * stop acting for the previous one at once and reload:
   *
   *  1. FIRST, synchronously, stop every staff request (`auth.retire()`). The
   *     notice below takes focus, and a focused field that saves on blur (the
   *     Upsells title) would otherwise send the OLD page's data under the NEW
   *     restaurant's id, because the API layer reads `rest_role` per request.
   *  2. Then show a brief notice, and reload with `location.replace` through the
   *     same landing rule the switcher uses, never a plain reload of this URL:
   *     the URL can carry ids that belong to the old restaurant.
   *
   * It lives in the PORTAL SHELL on purpose: the kitchen board (`/kitchen`) is
   * outside it and already follows `rest_role` by design, and reloading it could
   * disarm its sound.
   */
  @HostListener('window:storage', ['$event'])
  onStorage(event: StorageEvent): void {
    if (this.leavingFor) return;
    if (event.storageArea && event.storageArea !== window.localStorage) return;
    if (event.key !== null && event.key !== 'rest_role' && event.key !== 'user') return;
    if (storedScope() === this.scopeAtLoad) return;
    this.auth.retire();
    const now = storedScope();
    const [, profileNow] = now.split(':');
    const [, profileAtLoad] = this.scopeAtLoad.split(':');
    const role = this.auth.currentRestaurantRole;
    this.leavingFor = {
      kind: !profileNow || !role ? 'signed-out' : profileNow !== profileAtLoad ? 'other-user' : 'switched',
      restaurant: role?.restaurant ?? null,
    };
    this.closeOverlays();
    this.cdr.detectChanges();
    this.leavingNotice?.nativeElement.focus();
    setTimeout(() => {
      this.auth.retireAndReload(landingPathFor(this.router.url, this.auth.currentRestaurantRole));
    }, CROSS_TAB_NOTICE_MS);
  }

  /** Esc closes an open overlay and returns focus to the control that opened it. */
  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (!this.overlayOpen) return;
    const regime = this.regime;
    this.closeOverlays();
    this.cdr.detectChanges();
    if (regime === 'drawer') {
      this.topNav?.focusMenuButton();
    } else {
      this.sidebar?.focusToggle();
    }
  }

  /** The top bar's menu button. It is only rendered in the drawer regime. */
  onMenuButton(): void {
    if (this.regime !== 'drawer') return;
    this.drawerOpen = !this.drawerOpen;
    this.syncScrollLock();
  }

  /**
   * The rail's own toggle. In 1024–1279 it opens the overlay; from 1280 it
   * flips the saved preference — the ONLY place that preference is written.
   */
  onRailToggle(): void {
    if (this.regime === 'rail-overlay') {
      this.railOverlayOpen = !this.railOverlayOpen;
    } else if (this.regime === 'rail-push') {
      this.railExpanded = !this.railExpanded;
      try {
        this.localStorage.setItem(SIDEBAR_STATE_KEY, this.railExpanded);
      } catch (e) {
        // Persistence is best-effort and must never break the UI.
        console.warn('[restaurant-mgt] failed to persist sidebar state', e);
      }
    }
    this.syncScrollLock();
  }

  /** Close the drawer and the rail overlay. Never touches the saved preference. */
  closeOverlays(): void {
    this.drawerOpen = false;
    this.railOverlayOpen = false;
    this.syncScrollLock();
  }

  ngOnDestroy(): void {
    this.document.body.classList.remove('dn-drawer-open');
  }

  /**
   * Lock background scroll while an overlay is open. styles.css owns the actual
   * rule; it carries no media query, because the shell already knows the regime.
   */
  private syncScrollLock(): void {
    this.document.body.classList.toggle('dn-drawer-open', this.overlayOpen);
  }


}
