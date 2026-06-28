import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { ApiService } from '../_services/api.service';
import { SessionStorageService } from '../_services/storage/session-storage.service';
import { Restaurant, TableScan } from '../_models/app.models';
import { environment } from 'src/environments/environment';
import { BasketService } from '../_services/basket.service';
import { ToastService } from '../_shared/ui/toast/toast.service';
import { ConnectivityService } from '../_services/connectivity.service';
import { MenuNavStateService } from './menu/menu-nav-state.service';

@Component({
    selector: 'app-diner-app',
    templateUrl: './diner-app.component.html',
    styleUrls: ['./diner-app.component.css'],
    standalone: false
})
export class DinerAppComponent implements OnInit, OnDestroy {
  restaurant_name = '';
  restaurant_id = '';
  table?: TableScan;
  logo!: string;
  url = environment.apiUrl;
  table_id!: string;

  // Set when a QR scan can't open a table (bad/missing code, or a
  // removed/disabled/unavailable table). Surfaced by the inline no-table panel.
  scanFailed = false;
  scanMessage = '';
  // True when the failure was a retryable connectivity/transient blip rather
  // than a terminal "table unavailable" — swaps the no-table panel for the
  // connection-error state with a "Try again" button.
  scanRetryable = false;
  private readonly DEFAULT_UNAVAILABLE =
    "This table isn't available right now — please ask a member of staff.";

  /** Live-status polling: re-fetch the table-scan so the ongoing-order banner /
   *  checkout gate clear automatically once the kitchen serves the order. */
  private static readonly POLL_MS = 8000;
  private routerSub?: Subscription;
  private pollSub?: Subscription;
  private pollHandle: ReturnType<typeof setTimeout> | null = null;
  private pollActive = false;
  /** Id of an in-flight nav-scan, so a NavigationEnd that lands mid-scan doesn't
   *  fire a duplicate fetch for the same table. */
  private scanInFlightId: string | null = null;
  private readonly onVisibility = () => this.handleVisibility();

  @ViewChild('brandStrip') brandStrip?: ElementRef<HTMLElement>;

  constructor(
    private readonly sessionStorage: SessionStorageService,
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    public basketService: BasketService,
    private toast: ToastService,
    public connectivity: ConnectivityService,
    // Read on the menu route to hide the shell brand-strip (the menu renders its
    // own single-banner header) and to re-pin the offline strip to the top there.
    // providedIn:'root' singleton — the same instance the menu component drives.
    public navState: MenuNavStateService,
  ) {}

  ngOnInit(): void {
    // Resolve the active table on first paint AND on every in-app navigation —
    // the shell is NOT recreated when moving order-complete → /diner/h/:table, so
    // a one-shot constructor read never re-scans (that left "back to menu" stuck
    // on the skeleton once submitOrder() had cleared sessionStorage).
    this.syncActiveTable();
    this.routerSub = this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(() => this.syncActiveTable());

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    this.stopPolling();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
  }

  /** Find the deepest `:table` route param under the shell (present on the menu
   *  and item-detail routes, absent on basket / order-complete). */
  private activeTableParam(): string | null {
    let r: ActivatedRoute | null = this.route;
    while (r) {
      const t = r.snapshot.params['table'];
      if (t) return t;
      r = r.firstChild;
    }
    return null;
  }

  /** Keep the shell's table context in step with the active route. Re-scans when
   *  the table changed or the cached context was lost (post-order back-to-menu),
   *  but skips redundant scans during normal browsing. */
  private syncActiveTable(): void {
    const tableId = this.activeTableParam();
    if (tableId) {
      const contextMissing = !this.sessionStorage.getItem<Restaurant>('restaurant') || !this.table;
      const changed = tableId !== this.table_id;
      this.table_id = tableId;
      if ((changed || contextMissing) && this.scanInFlightId !== tableId) {
        this.getTableDetails(tableId);
      }
      this.startPolling();
    } else if (!this.table) {
      // No table param and nothing loaded yet (basket deep-link / reload) — fall
      // back to the last scan persisted in sessionStorage.
      this.hydrateFromSession();
      if (this.table_id) this.startPolling();
    }
  }

  private hydrateFromSession(): void {
    const restaurant = this.sessionStorage.getItem<Restaurant>('restaurant');
    this.table = this.sessionStorage.getItem<TableScan>('Table') ?? undefined;
    this.table_id = this.table?.id ?? '';
    if (restaurant) {
      this.restaurant_name = restaurant.name;
      this.restaurant_id = restaurant.id;
      this.logo = restaurant.logo;
    }
    // Seed the live flag from the last known scan so a basket reload paints the
    // right state before the first poll lands.
    this.navState.setTableOngoingOrder(!!this.table?.current_order?.ongoing);
  }

  getTableDetails(id: any): void {
    this.scanFailed = false;
    this.scanRetryable = false;
    this.scanInFlightId = String(id);
    this.api.get<TableScan>(null, 'orders/journey/table-scan/?table=' + id).subscribe({
      next: x => {
        this.scanInFlightId = null;
        // The journey table-scan endpoint returns the TableScan directly in
        // `data` (a single object), not the paginated `Data<T>` wrapper the
        // shared ApiResponse<T> models — hence the explicit narrowing. Modelling
        // the single-object journey responses properly is a post-launch typing
        // task; out of scope for this hygiene pass.
        const scanned = x?.data as unknown as TableScan | undefined;
        if (!scanned) {
          this.showScanError(this.DEFAULT_UNAVAILABLE);
          return;
        }
        this.table = scanned;
        this.sessionStorage.setItem('Table', scanned);
        this.sessionStorage.setItem('restaurant', scanned.restaurant);
        this.logo = scanned.restaurant.logo;
        this.restaurant_name = scanned.restaurant.name;
        this.restaurant_id = scanned.restaurant.id;
        this.navState.setTableOngoingOrder(!!scanned.current_order?.ongoing);
      },
      error: err => {
        this.scanInFlightId = null;
        // Two distinct failures land here:
        //  - retryable connectivity/transient blip (the diner just lost signal)
        //    → offer a "Try again" so they aren't stranded on a blank page;
        //  - terminal 4xx (table removed/disabled, bad QR) carrying a
        //    diner-friendly message → keep the calm "ask staff" dead-end.
        // Backend 400/404 each carry a diner-friendly message.
        if (this.isRetryableScanError(err)) {
          this.showScanRetry();
        } else {
          this.showScanError(this.extractScanError(err, this.DEFAULT_UNAVAILABLE));
        }
      },
    });
  }

  /**
   * A scan failure is retryable when it's a connectivity/rate-limit blip, not a
   * genuine "this table is unavailable". In production the ErrorInterceptor
   * collapses those to the sentinel strings 'no network' (status 0) and
   * 'rate_limited' (429). A raw HttpErrorResponse can also reach here when no
   * interceptor sits in front (e.g. tests) — treat its status 0/429 the same
   * way. Everything else is a real backend message → terminal.
   */
  private isRetryableScanError(err: unknown): boolean {
    if (err === 'no network' || err === 'rate_limited') return true;
    const status = (err as { status?: number } | null)?.status;
    return status === 0 || status === 429;
  }

  /** Terminal dead-end: a real "table unavailable" message, no retry. */
  private showScanError(message: string): void {
    // The global ErrorInterceptor already queued this as a toast; clear it so
    // the diner sees one clean message (the no-table panel).
    this.toast.clear();
    this.table = undefined;
    this.scanMessage = message;
    this.scanFailed = true;
    this.scanRetryable = false;
  }

  /** Recoverable dead-end: connectivity blip → show the connection-error state
   *  with a "Try again" button (which re-runs getTableDetails). */
  private showScanRetry(): void {
    // Mirror showScanError: clear the global toast so the diner sees one clean
    // state — the connection-error panel — not a duplicate red toast.
    this.toast.clear();
    this.table = undefined;
    this.scanFailed = true;
    this.scanRetryable = true;
  }

  private extractScanError(err: unknown, fallback: string): string {
    // The interceptor rethrows a string (the backend's diner-friendly message),
    // which is the production path. A raw HttpErrorResponse may also reach here
    // (e.g. in tests); prefer its structured body message. Deliberately do NOT
    // fall back to HttpErrorResponse.message — that's the framework's
    // "Http failure response for ..." string, never fit for a diner.
    if (typeof err === 'string' && err.trim()) return err;
    const e = err as { error?: { message?: string } } | null;
    return e?.error?.message || fallback;
  }

  // ── live ongoing-order polling ────────────────────────────────────────────
  // Lightweight re-fetch of the table-scan that updates ONLY the shared
  // `tableOngoingOrder` signal (+ the in-memory current_order) — it does not
  // rewrite sessionStorage or touch the menu load. Mirrors the kitchen board's
  // setTimeout poll. Paused while offline or the tab is hidden; a tab regaining
  // focus refreshes immediately (the diner's KDS-in-another-tab workflow).
  private startPolling(): void {
    if (this.pollActive) return;
    this.pollActive = true;
    this.scheduleNextPoll();
  }

  private stopPolling(): void {
    this.pollActive = false;
    if (this.pollHandle) {
      clearTimeout(this.pollHandle);
      this.pollHandle = null;
    }
    this.pollSub?.unsubscribe();
    this.pollSub = undefined;
  }

  private scheduleNextPoll(): void {
    if (!this.pollActive) return;
    this.pollHandle = setTimeout(() => this.pollOnce(), DinerAppComponent.POLL_MS);
  }

  private pollOnce(): void {
    if (!this.pollActive) return;
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (!this.table_id || this.connectivity.isOffline() || hidden) {
      this.scheduleNextPoll();
      return;
    }
    this.pollSub = this.api
      .get<TableScan>(null, 'orders/journey/table-scan/?table=' + this.table_id)
      .subscribe({
        next: x => {
          const scanned = x?.data as unknown as TableScan | undefined;
          if (scanned) {
            this.navState.setTableOngoingOrder(!!scanned.current_order?.ongoing);
            if (this.table) this.table.current_order = scanned.current_order;
          }
          this.scheduleNextPoll();
        },
        // Transient failure — keep the last known state and try again next tick.
        error: () => this.scheduleNextPoll(),
      });
  }

  /** Tab regained focus → refresh now (don't wait up to POLL_MS) so a status
   *  change made while the diner was on the KDS tab shows the moment they return. */
  private handleVisibility(): void {
    if (typeof document === 'undefined' || document.hidden || !this.pollActive) return;
    if (this.pollHandle) {
      clearTimeout(this.pollHandle);
      this.pollHandle = null;
    }
    this.pollOnce();
  }
}
