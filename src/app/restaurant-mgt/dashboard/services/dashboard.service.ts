import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { ApiService } from '../../../_services/api.service';
import { ApiResponse } from '../../../_models/app.models';
import { DashboardV2Response, DateRange, ReviewsSummaryResponse } from '../models/dashboard.models';

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

  constructor(private api: ApiService) {}

  getDashboardData(
    restaurantId: string,
    dateFrom: string,
    dateTo: string,
    period: string,
  ): Observable<ApiResponse<DashboardV2Response>> {
    return this.api.get<DashboardV2Response>(null, 'reports/restaurant/dashboard-v2/', {
      restaurant: restaurantId,
      from: dateFrom,
      to: dateTo,
      period,
    });
  }

  getReviewsSummary(restaurantId: string): Observable<ApiResponse<ReviewsSummaryResponse>> {
    return this.api.get<ReviewsSummaryResponse>(null, 'reports/restaurant/dashboard-reviews/', {
      restaurant: restaurantId,
    });
  }
}
