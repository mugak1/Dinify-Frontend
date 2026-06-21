// Reports module — shared state + data access.
//
// Mirrors DashboardService exactly: a USE_MOCK_DATA flag gates a mock branch
// (of({data}).pipe(delay)) against a scaffolded real branch (api.get / loadAllPages
// → adapter). The date range is a PersistedBehaviorSubject keyed by restaurant,
// so it survives both report switches and full sessions.

import { Injectable } from '@angular/core';
import { Observable, Subject, of } from 'rxjs';
import { delay, map } from 'rxjs/operators';
import { ApiService } from '../../../_services/api.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { LocalStorageService } from '../../../_services/storage/local-storage.service';
import { PersistedBehaviorSubject } from '../../../_services/storage/persisted-state';
import { ApiResponse } from '../../../_models/app.models';
import {
  ReportDateRange,
  ReportGranularity,
  SalesAggregateRow,
  SalesListingRow,
  defaultRange,
  isValidReportDateRange,
} from '../models/reports.models';
import { getMockSalesAggregate, getMockSalesListing } from '../data/reports-mock-data';
import { adaptSalesAggregate, adaptSalesListing } from './reports-adapter';

/** Set to false to use real API endpoints instead of mock data. */
const USE_MOCK_DATA = true;

@Injectable({ providedIn: 'root' })
export class ReportsService {
  /** Emit to force a data reload. */
  refresh$ = new Subject<void>();

  /** Shared, persisted preset date range (survives report switches AND sessions). */
  dateRange$!: PersistedBehaviorSubject<ReportDateRange>;

  constructor(
    private api: ApiService,
    private localStorage: LocalStorageService,
    private auth: AuthenticationService,
  ) {
    this.dateRange$ = new PersistedBehaviorSubject<ReportDateRange>(defaultRange(), {
      storage: this.localStorage,
      getKey: () => `reports.dateRange:${this.auth.currentRestaurantRole?.restaurant_id ?? 'global'}`,
      validate: isValidReportDateRange,
    });
  }

  /** Time-bucketed sales summary. Always small (≤31 daily rows, or ~12 monthly). */
  getSalesAggregate(
    restaurantId: string,
    from: string,
    to: string,
    granularity: ReportGranularity,
  ): Observable<ApiResponse<SalesAggregateRow[]>> {
    if (USE_MOCK_DATA) {
      return of({
        data: getMockSalesAggregate(from, to, granularity),
      } as unknown as ApiResponse<SalesAggregateRow[]>).pipe(delay(600));
    }
    return this.api
      .get<SalesAggregateRow[]>(null, 'reports/restaurant/sales-aggregate/', {
        restaurant: restaurantId,
        from,
        to,
        granularity,
      })
      .pipe(
        map((res: any) => ({ ...res, data: res.data ? adaptSalesAggregate(res.data) : null })),
      );
  }

  /** Per-order listing. Server-paginated in production — loadAllPages concatenates to one set. */
  getSalesListing(
    restaurantId: string,
    from: string,
    to: string,
  ): Observable<ApiResponse<SalesListingRow[]>> {
    if (USE_MOCK_DATA) {
      return of({
        data: getMockSalesListing(from, to),
      } as unknown as ApiResponse<SalesListingRow[]>).pipe(delay(600));
    }
    return this.api
      .loadAllPages<SalesListingRow>('reports/restaurant/sales-listing/', {
        restaurant: restaurantId,
        from,
        to,
      })
      .pipe(
        map((records) => ({ data: adaptSalesListing(records) } as unknown as ApiResponse<SalesListingRow[]>)),
      );
  }
}
