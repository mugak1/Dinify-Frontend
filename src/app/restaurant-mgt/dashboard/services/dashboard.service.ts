import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { ApiService } from '../../../_services/api.service';
import { ApiResponse } from '../../../_models/app.models';
import { DashboardV2Response, DateRange, ReviewsSummaryResponse } from '../models/dashboard.models';
import { getMockDashboardData, getMockReviewsData } from '../data/dashboard-mock-data';

/** Set to false to use real API endpoints instead of mock data */
const USE_MOCK_DATA = true;

@Injectable({ providedIn: 'root' })
export class DashboardService {
  /** Emit to force a data reload */
  refresh$ = new Subject<void>();

  /** Shared state: current date range (TopNav ↔ Dashboard) */
  dateRange$ = new BehaviorSubject<DateRange>('day');

  /** Shared state: auto-refresh toggle */
  autoRefresh$ = new BehaviorSubject<boolean>(true);

  /** Whether the dashboard route is currently active (controls TopNav pills visibility) */
  isDashboardActive$ = new BehaviorSubject<boolean>(false);

  /** Timestamp of last successful data fetch (TopNav uses this to display "updated Xs ago") */
  lastFetchTimestamp$ = new BehaviorSubject<number>(Date.now());

  constructor(private api: ApiService) {}

  getDashboardData(
    restaurantId: string,
    dateFrom: string,
    dateTo: string,
    period: string,
  ): Observable<ApiResponse<DashboardV2Response>> {
    if (USE_MOCK_DATA) {
      return of({ data: getMockDashboardData(period as DateRange) } as unknown as ApiResponse<DashboardV2Response>).pipe(
        delay(600),
      );
    }
    return this.api.get<DashboardV2Response>(null, 'reports/restaurant/dashboard-v2/', {
      restaurant: restaurantId,
      from: dateFrom,
      to: dateTo,
      period,
    });
  }

  getReviewsSummary(restaurantId: string): Observable<ApiResponse<ReviewsSummaryResponse>> {
    if (USE_MOCK_DATA) {
      return of({ data: getMockReviewsData() } as unknown as ApiResponse<ReviewsSummaryResponse>).pipe(delay(400));
    }
    return this.api.get<ReviewsSummaryResponse>(null, 'reports/restaurant/dashboard-reviews/', {
      restaurant: restaurantId,
    });
  }
}
