import { Component, ElementRef, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../_services/api.service';
import { SessionStorageService } from '../_services/storage/session-storage.service';
import { Restaurant, TableScan } from '../_models/app.models';
import { environment } from 'src/environments/environment';
import { BasketService } from '../_services/basket.service';
import { ToastService } from '../_shared/ui/toast/toast.service';
import { ConnectivityService } from '../_services/connectivity.service';

@Component({
    selector: 'app-diner-app',
    templateUrl: './diner-app.component.html',
    styleUrls: ['./diner-app.component.css'],
    standalone: false
})
export class DinerAppComponent {
  restaurant_name = '';
  restaurant_id = '';
  table?: TableScan;
  logo!: string;
  // Optional restaurant cover photo from the table-scan payload. Drives the
  // diner menu hero (and the shell's inert `has-hero` flag); null ⇒ no hero.
  coverPhoto: string | null = null;
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

  @ViewChild('brandStrip') brandStrip?: ElementRef<HTMLElement>;

  constructor(
    private readonly sessionStorage: SessionStorageService,
    private route: ActivatedRoute,
    private api: ApiService,
    public basketService: BasketService,
    private toast: ToastService,
    public connectivity: ConnectivityService,
  ) {
    if (this.route.children.length > 0) {
      this.route.children.at(0)?.params.subscribe(x => {
        if (x['table']) {
          this.table_id = x['table'];
          this.getTableDetails(x['table']);
        } else {
          this.hydrateFromSession();
        }
      });
    } else {
      this.hydrateFromSession();
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
      this.coverPhoto = restaurant.cover_photo ?? null;
    }
  }

  getTableDetails(id: any): void {
    this.scanFailed = false;
    this.scanRetryable = false;
    this.api.get<TableScan>(null, 'orders/journey/table-scan/?table=' + id).subscribe({
      next: x => {
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
        this.coverPhoto = scanned.restaurant.cover_photo ?? null;
      },
      error: err => {
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
}
