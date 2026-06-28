import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject, of } from 'rxjs';
import { delay, map } from 'rxjs/operators';
import { ApiService } from '../../../_services/api.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { LocalStorageService } from '../../../_services/storage/local-storage.service';
import { PersistedBehaviorSubject } from '../../../_services/storage/persisted-state';
import { ApiResponse } from '../../../_models/app.models';
import { DashboardV2Response, DateRange, ReviewsSummaryResponse } from '../models/dashboard.models';
import { getMockDashboardData, getMockReviewsData } from '../data/dashboard-mock-data';
import { adaptDashboardResponse, adaptReviewsResponse } from './dashboard-adapter';

/** Set to false to use real API endpoints instead of mock data */
const USE_MOCK_DATA = true;

/** Reviews card is real-wired (reviews/summary/); flip to true for design review */
const USE_MOCK_REVIEWS = false;

const DATE_RANGES = ['day', 'week', 'month', 'ytd'] as const;

@Injectable({ providedIn: 'root' })
export class DashboardService {
  /** Emit to force a data reload */
  refresh$ = new Subject<void>();

  /** Shared state: current date range (TopNav ↔ Dashboard) */
  dateRange$!: PersistedBehaviorSubject<DateRange>;

  /** Shared state: auto-refresh toggle */
  autoRefresh$!: PersistedBehaviorSubject<boolean>;

  /** Whether the dashboard route is currently active (controls TopNav pills visibility) */
  isDashboardActive$ = new BehaviorSubject<boolean>(false);

  /** Timestamp of last successful data fetch (TopNav uses this to display "updated Xs ago") */
  lastFetchTimestamp$ = new BehaviorSubject<number>(Date.now());

  constructor(
    private api: ApiService,
    private localStorage: LocalStorageService,
    private auth: AuthenticationService,
  ) {
    this.dateRange$ = new PersistedBehaviorSubject<DateRange>('day', {
      storage: this.localStorage,
      getKey: () => `dashboard.dateRange:${this.auth.currentRestaurantRole?.restaurant_id ?? 'global'}`,
      validate: (v): v is DateRange =>
        typeof v === 'string' && (DATE_RANGES as readonly string[]).includes(v),
    });

    this.autoRefresh$ = new PersistedBehaviorSubject<boolean>(true, {
      storage: this.localStorage,
      getKey: () => `dashboard.autoRefresh:${this.auth.currentRestaurantRole?.restaurant_id ?? 'global'}`,
      validate: (v): v is boolean => typeof v === 'boolean',
    });
  }

  getDashboardData(
    restaurantId: string,
    dateFrom: string,
    dateTo: string,
    period: string,
  ): Observable<ApiResponse<DashboardV2Response>> {
    if (USE_MOCK_DATA) {
      return of({
        data: getMockDashboardData(restaurantId, dateFrom, dateTo, period as DateRange),
      } as unknown as ApiResponse<DashboardV2Response>).pipe(delay(600));
    }
    return this.api.get<DashboardV2Response>(null, 'reports/restaurant/dashboard-v2/', {
      restaurant: restaurantId,
      from: dateFrom,
      to: dateTo,
      period,
    }).pipe(
      map((res: any) => ({
        ...res,
        data: res.data ? adaptDashboardResponse(res.data) : null,
      })),
    );
  }

  getReviewsSummary(restaurantId: string): Observable<ApiResponse<ReviewsSummaryResponse>> {
    if (USE_MOCK_REVIEWS) {
      return of({ data: getMockReviewsData() } as unknown as ApiResponse<ReviewsSummaryResponse>).pipe(delay(400));
    }
    return this.api.get<ReviewsSummaryResponse>(null, 'reviews/summary/', {
      restaurant: restaurantId,
    }).pipe(
      map((res: any) => ({
        ...res,
        data: res.data ? adaptReviewsResponse(res.data) : null,
      })),
    );
  }
}
