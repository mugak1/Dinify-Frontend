import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject, combineLatest, of, timer } from 'rxjs';
import { switchMap, startWith, catchError, tap, takeUntil, map } from 'rxjs/operators';
import { DashboardService } from './services/dashboard.service';
import { AuthenticationService } from '../../_services/authentication.service';
import { DashboardV2Response, DateRange, ReviewsSummaryResponse } from './models/dashboard.models';

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

  private destroy$ = new Subject<void>();

  constructor(
    public dashboardService: DashboardService,
    private auth: AuthenticationService,
  ) {}

  ngOnInit(): void {
    this.dashboardService.isDashboardActive$.next(true);
    this.dashboardService.dateRange$.next('day');

    const restaurantId = this.auth.currentRestaurantRole?.restaurant_id;
    if (!restaurantId) return;

    // Dashboard data: reacts to dateRange, autoRefresh toggle, and manual refresh
    combineLatest([
      this.dashboardService.dateRange$,
      this.dashboardService.autoRefresh$,
      this.dashboardService.refresh$.pipe(startWith(undefined)),
    ])
      .pipe(
        takeUntil(this.destroy$),
        tap(() => {
          this.loading = true;
          this.error = null;
        }),
        switchMap(([range, auto]) => {
          const tick$ = auto ? timer(0, 30_000) : of(0);
          return tick$.pipe(map(() => range));
        }),
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
        } else {
          this.error = res.error?.message || 'Failed to load dashboard data';
        }
        this.dashboardService.lastFetchTimestamp$.next(Date.now());
      });

    // Reviews data: reacts to autoRefresh toggle and manual refresh
    combineLatest([
      this.dashboardService.autoRefresh$,
      this.dashboardService.refresh$.pipe(startWith(undefined)),
    ])
      .pipe(
        takeUntil(this.destroy$),
        tap(() => {
          this.reviewsLoading = true;
          this.reviewsError = null;
        }),
        switchMap(([auto]) => {
          const tick$ = auto ? timer(0, 30_000) : of(0);
          return tick$;
        }),
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
        d.setDate(d.getDate() - 7);
        from = this.formatDate(d);
        break;
      }
      case 'month': {
        const d = new Date(today);
        d.setDate(d.getDate() - 30);
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
