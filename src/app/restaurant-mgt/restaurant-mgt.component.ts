import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, OnDestroy, ViewChild, inject } from '@angular/core';
import { DOCUMENT, NgClass } from '@angular/common';
import { AuthenticationService } from '../_services/authentication.service';
import { ApiService } from '../_services/api.service';
import { RestaurantDetail } from '../_models/app.models';
import { ConfirmDialogService } from '../_common/confirm-dialog.service';
import { environment } from 'src/environments/environment';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { LocalStorageService } from '../_services/storage/local-storage.service';
import { SidebarComponent } from './layout/sidebar/sidebar.component';
import { TopNavComponent } from './layout/top-nav/top-nav.component';
import { OfflineBannerComponent } from '../_shared/ui';
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

  @ViewChild(SidebarComponent) private sidebar?: SidebarComponent;
  @ViewChild(TopNavComponent) private topNav?: TopNavComponent;

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
    private dialog: ConfirmDialogService,
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

  logout(): void {
    const ref = this.dialog
      .openModal({
        title: 'Log out of Dinify?',
        message: 'You can sign back in at any time.',
        tone: 'neutral',
        submitButtonText: 'Log out',
      })
      .subscribe((x: any) => {
        if (x?.action === 'yes') {
          this.auth.logout();
          this.dialog.closeModal();
          ref.unsubscribe();
        }
        if (x?.action === 'no') {
          this.dialog.closeModal();
          ref.unsubscribe();
        }
      });
  }
}
