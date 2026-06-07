import { Component, ElementRef, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../_services/api.service';
import { SessionStorageService } from '../_services/storage/session-storage.service';
import { Restaurant, TableScan, BrandingConfiguration } from '../_models/app.models';
import { environment } from 'src/environments/environment';
import { MenuNavStateService } from './menu/menu-nav-state.service';
import { BasketService } from '../_services/basket.service';
import { MessageService } from '../_services/message.service';
import { getContrastTextColor } from '../_common/utils/color-utils';

@Component({
    selector: 'app-diner-app',
    templateUrl: './diner-app.component.html',
    styleUrls: ['./diner-app.component.css'],
    standalone: false
})
export class DinerAppComponent {
  restaurant_name = '';
  restaurant_id = '';
  branding_configs?: BrandingConfiguration;
  table?: TableScan;
  logo!: string;
  url = environment.apiUrl;
  table_id!: string;

  // Set when a QR scan can't open a table (bad/missing code, or a
  // removed/disabled/unavailable table). Surfaced by the inline no-table panel.
  scanFailed = false;
  scanMessage = '';
  private readonly DEFAULT_UNAVAILABLE =
    "This table isn't available right now — please ask a member of staff.";

  @ViewChild('brandStrip') brandStrip?: ElementRef<HTMLElement>;

  constructor(
    private readonly sessionStorage: SessionStorageService,
    private route: ActivatedRoute,
    private api: ApiService,
    public navState: MenuNavStateService,
    public basketService: BasketService,
    private message: MessageService,
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
      this.branding_configs = restaurant.branding_configuration;
      this.logo = restaurant.logo;
    }
  }

  getTableDetails(id: any): void {
    this.scanFailed = false;
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
        this.branding_configs = scanned.restaurant.branding_configuration;
      },
      error: err => {
        // Backend returns 400 (bad/missing code) or 404 (removed/disabled/
        // unavailable table), each with a diner-friendly message. Surface it as
        // a calm inline dead-end rather than an error page or a working menu.
        this.showScanError(this.extractScanError(err, this.DEFAULT_UNAVAILABLE));
      },
    });
  }

  private showScanError(message: string): void {
    // The global ErrorInterceptor already queued this on the MessageService
    // banner; clear it so the diner sees one clean message (the no-table panel).
    this.message.clear();
    this.table = undefined;
    this.scanMessage = message;
    this.scanFailed = true;
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

  get brandStripBgColor(): string {
    return this.branding_configs?.home?.brand_color || '#ffffff';
  }

  get brandStripTextColor(): string {
    return getContrastTextColor(this.brandStripBgColor);
  }
}
