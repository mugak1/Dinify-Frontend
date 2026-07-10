import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject, combineLatest, of, timer } from 'rxjs';
import { switchMap, startWith, catchError, tap, takeUntil, map } from 'rxjs/operators';
import { DashboardService } from './services/dashboard.service';
import { AuthenticationService } from '../../_services/authentication.service';
import { MenuService } from 'src/app/restaurant-mgt/menu/services/menu.service';
import { MenuItem } from 'src/app/_models/app.models';
import { environment } from 'src/environments/environment';
import {
  DashboardV2Response,
  DateRange,
  PopularItemData,
  ReviewsSummaryResponse,
} from './models/dashboard.models';

@Component({
    selector: 'app-rest-dashboard',
    templateUrl: './dashboard.component.html',
    standalone: false,
})
export class DashboardComponent implements OnInit, OnDestroy {
  dashboardData: DashboardV2Response | null = null;
  reviewsData: ReviewsSummaryResponse | null = null;
  loading = true;
  error: string | null = null;
  reviewsLoading = true;
  reviewsError: string | null = null;

  // Placeholder Popular Items metrics with real menu-item identities overlaid.
  popularItems: PopularItemData[] | null = null;
  private availableMenuItems: MenuItem[] = [];

  private destroy$ = new Subject<void>();

  constructor(
    public dashboardService: DashboardService,
    private auth: AuthenticationService,
    private menuService: MenuService,
  ) {}

  ngOnInit(): void {
    this.dashboardService.isDashboardActive$.next(true);
    this.dashboardService.dateRange$.next('day');

    const restaurantId = this.auth.currentRestaurantRole?.restaurant_id;
    if (!restaurantId) return;

    // Reuse the Menu module's existing fetch path to overlay real item
    // identities (name + image) onto the placeholder Popular Items metrics.
    this.menuService.loadAllItems(restaurantId);
    this.menuService.allItems$
      .pipe(takeUntil(this.destroy$))
      .subscribe((items) => {
        this.availableMenuItems = items.filter((it) => it.available);
        this.recomputePopularItems();
      });

    // Dashboard data: reacts to dateRange and manual refresh; always polls in
    // the background (every 30s) so the surface stays live without a page reload.
    combineLatest([
      this.dashboardService.dateRange$,
      this.dashboardService.refresh$.pipe(startWith(undefined)),
    ])
      .pipe(
        takeUntil(this.destroy$),
        tap(() => {
          this.loading = true;
          this.error = null;
        }),
        switchMap(([range]) => timer(0, 30_000).pipe(map(() => range))),
        switchMap((range) => {
          const { from, to } = this.computeDateRange(range);
          return this.dashboardService
            .getDashboardData(restaurantId, from, to, range)
            .pipe(catchError((err) => of({ data: null, error: err })));
        }),
      )
      .subscribe((res: any) => {
        this.loading = false;
        if (res.data) {
          this.dashboardData = res.data;
          this.recomputePopularItems();
        } else {
          this.error = res.error?.message || 'Failed to load dashboard data';
        }
        this.dashboardService.lastFetchTimestamp$.next(Date.now());
      });

    // Reviews data: reacts to manual refresh; always polls in the background.
    this.dashboardService.refresh$
      .pipe(
        startWith(undefined),
        takeUntil(this.destroy$),
        tap(() => {
          this.reviewsLoading = true;
          this.reviewsError = null;
        }),
        switchMap(() => timer(0, 30_000)),
        switchMap(() =>
          this.dashboardService
            .getReviewsSummary(restaurantId)
            .pipe(catchError((err) => of({ data: null, error: err }))),
        ),
      )
      .subscribe((res: any) => {
        this.reviewsLoading = false;
        if (res.data) {
          this.reviewsData = res.data;
        } else {
          this.reviewsError = res.error?.message || 'Failed to load reviews';
        }
      });
  }

  ngOnDestroy(): void {
    this.dashboardService.isDashboardActive$.next(false);
    this.destroy$.next();
    this.destroy$.complete();
  }

  retryDashboard(): void {
    this.dashboardService.refresh$.next();
  }

  retryReviews(): void {
    this.dashboardService.refresh$.next();
  }

  /**
   * Overlays real menu-item identities onto the placeholder Popular Items
   * metrics. Revenue/qty/section stay mock; only name + image become real.
   * Each metric row is paired positionally with an available menu item (first
   * N in load order). Slots without a matching real item keep their mock
   * identity, so a short or empty menu still renders the full placeholder card.
   */
  private recomputePopularItems(): void {
    const metrics = this.dashboardData?.popular_items ?? null;
    if (!metrics) {
      this.popularItems = null;
      return;
    }
    const real = this.availableMenuItems;
    this.popularItems = metrics.map((m, i) => {
      const it = real[i];
      if (!it) return m;
      return {
        ...m,
        item_id: it.id,
        name: it.name,
        image_url: it.image ? environment.apiUrl + it.image : undefined,
      };
    });
  }

  private computeDateRange(range: DateRange): { from: string; to: string } {
    const today = new Date();
    const to = this.formatDate(today);
    let from: string;

    switch (range) {
      case 'day':
        from = to;
        break;
      case 'week': {
        const d = new Date(today);
        d.setDate(d.getDate() - 6); // inclusive of today → exactly 7 days (last 7)
        from = this.formatDate(d);
        break;
      }
      case 'month': {
        const d = new Date(today);
        d.setDate(d.getDate() - 29); // inclusive of today → exactly 30 days (last 30)
        from = this.formatDate(d);
        break;
      }
      case 'ytd': {
        from = `${today.getFullYear()}-01-01`;
        break;
      }
    }

    return { from, to };
  }

  private formatDate(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
