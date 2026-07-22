import { ChangeDetectorRef, Component, HostListener } from '@angular/core';
import { NgClass } from '@angular/common';
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

// Persisted sidebar expand/collapse state. Stored through LocalStorageService as
// `[dinify]sidebar.expanded` (the `[dinify]` prefix and `{value:T}` wrapping are
// added by StorageService). It is a standard `[dinify]` nav-state key, so it is
// cleared on every login attempt and on logout by
// AuthenticationService.clearPersistedNavState() — meaning a fresh login falls
// back to the EXPANDED default below, while a plain refresh restores the last toggle.
const SIDEBAR_STATE_KEY = 'sidebar.expanded';

@Component({
    selector: 'app-restaurant-mgt',
    templateUrl: './restaurant-mgt.component.html',
    styleUrls: ['./restaurant-mgt.component.css'],
    standalone: true,
    imports: [NgClass, RouterOutlet, SidebarComponent, TopNavComponent, OfflineBannerComponent]
})
export class RestaurantMgtComponent {
  private _sidebarOpen = true;

  /**
   * Sidebar expanded (true) / collapsed (false). Reads/writes go through this
   * accessor so every existing template assignment (`sidebarOpen = !sidebarOpen`,
   * backdrop `= false`) and the ESC/route handlers persist transparently. The
   * seed is hydrated once in the constructor (default EXPANDED when absent).
   */
  get sidebarOpen(): boolean {
    return this._sidebarOpen;
  }
  set sidebarOpen(value: boolean) {
    this._sidebarOpen = value;
    try {
      this.localStorage.setItem(SIDEBAR_STATE_KEY, value);
    } catch (e) {
      // Persistence is best-effort and must never break the UI.
      console.warn('[restaurant-mgt] failed to persist sidebar state', e);
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
    // Hydrate the persisted sidebar state. An absent key → EXPANDED default; a
    // stored boolean is restored as-is so a refresh preserves the last toggle.
    // On mobile (< Tailwind `xl`) always start with the drawer closed, matching
    // existing behavior — written to the backing field directly so this clamp
    // never overwrites the persisted desktop preference.
    const stored = this.localStorage.getItem<boolean>(SIDEBAR_STATE_KEY);
    const seed = typeof stored === 'boolean' ? stored : true;
    this._sidebarOpen = window.innerWidth < 1280 ? false : seed;

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
        if (window.innerWidth < 1280) {   // < Tailwind `xl`; mobile drawer only
          this.sidebarOpen = false;
        }
        this.cdr.detectChanges();
      });

    this.isMenuRoute =
      /\/menu(\/|\?|$)/.test(this.router.url) && !this.router.url.includes('/reports/');
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.sidebarOpen && window.innerWidth < 1280) {
      this.sidebarOpen = false;
    }
  }

  logout(): void {
    const ref = this.dialog
      .openModal({
        title: 'Logout',
        message: 'Are you sure you want to <strong>Log out</strong> ?',
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
