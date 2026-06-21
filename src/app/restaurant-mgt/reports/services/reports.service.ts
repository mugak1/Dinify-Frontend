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
  DinersListingRow,
  DinersSummary,
  MenuGrouping,
  MenuRow,
  ReportDateRange,
  ReportGranularity,
  SalesAggregateRow,
  SalesListingRow,
  TransactionsListingRow,
  TransactionsSummary,
  defaultRange,
  isValidReportDateRange,
} from '../models/reports.models';
import {
  getMockDinersListing,
  getMockDinersSummary,
  getMockMenuSummary,
  getMockSalesAggregate,
  getMockSalesListing,
  getMockTransactionsListing,
  getMockTransactionsSummary,
} from '../data/reports-mock-data';
import {
  adaptDinersListing,
  adaptDinersSummary,
  adaptMenuSummary,
  adaptSalesAggregate,
  adaptSalesListing,
  adaptTransactionsListing,
  adaptTransactionsSummary,
} from './reports-adapter';

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

  /** Menu performance, aggregated by section/group/item. Always a small set. */
  getMenuSummary(
    restaurantId: string,
    from: string,
    to: string,
    grouping: MenuGrouping,
  ): Observable<ApiResponse<MenuRow[]>> {
    if (USE_MOCK_DATA) {
      return of({
        data: getMockMenuSummary(grouping, from, to),
      } as unknown as ApiResponse<MenuRow[]>).pipe(delay(600));
    }
    return this.api
      .get<MenuRow[]>(null, 'reports/restaurant/menu-summary/', {
        restaurant: restaurantId,
        from,
        to,
        grouping,
      })
      .pipe(map((res: any) => ({ ...res, data: res.data ? adaptMenuSummary(res.data) : null })));
  }

  /** Transaction status + type breakdowns. Always loads (uncapped by range). */
  getTransactionsSummary(
    restaurantId: string,
    from: string,
    to: string,
  ): Observable<ApiResponse<TransactionsSummary>> {
    if (USE_MOCK_DATA) {
      return of({
        data: getMockTransactionsSummary(from, to),
      } as unknown as ApiResponse<TransactionsSummary>).pipe(delay(600));
    }
    return this.api
      .get<TransactionsSummary>(null, 'reports/restaurant/transactions-summary/', {
        restaurant: restaurantId,
        from,
        to,
      })
      .pipe(map((res: any) => ({ ...res, data: res.data ? adaptTransactionsSummary(res.data) : null })));
  }

  /** Per-transaction listing. Server-paginated in production — loadAllPages concatenates to one set. */
  getTransactionsListing(
    restaurantId: string,
    from: string,
    to: string,
  ): Observable<ApiResponse<TransactionsListingRow[]>> {
    if (USE_MOCK_DATA) {
      return of({
        data: getMockTransactionsListing(from, to),
      } as unknown as ApiResponse<TransactionsListingRow[]>).pipe(delay(600));
    }
    return this.api
      .loadAllPages<TransactionsListingRow>('reports/restaurant/transactions-listing/', {
        restaurant: restaurantId,
        from,
        to,
      })
      .pipe(
        map(
          (records) =>
            ({ data: adaptTransactionsListing(records) } as unknown as ApiResponse<
              TransactionsListingRow[]
            >),
        ),
      );
  }

  /** Diner overview scalars + most-active diner. Always loads (uncapped by range). */
  getDinersSummary(
    restaurantId: string,
    from: string,
    to: string,
  ): Observable<ApiResponse<DinersSummary>> {
    if (USE_MOCK_DATA) {
      return of({
        data: getMockDinersSummary(from, to),
      } as unknown as ApiResponse<DinersSummary>).pipe(delay(600));
    }
    return this.api
      .get<DinersSummary>(null, 'reports/restaurant/diners-summary/', {
        restaurant: restaurantId,
        from,
        to,
      })
      .pipe(map((res: any) => ({ ...res, data: res.data ? adaptDinersSummary(res.data) : null })));
  }

  /** Identified-diner listing. Server-paginated in production — loadAllPages concatenates to one set. */
  getDinersListing(
    restaurantId: string,
    from: string,
    to: string,
  ): Observable<ApiResponse<DinersListingRow[]>> {
    if (USE_MOCK_DATA) {
      return of({
        data: getMockDinersListing(from, to),
      } as unknown as ApiResponse<DinersListingRow[]>).pipe(delay(600));
    }
    return this.api
      .loadAllPages<DinersListingRow>('reports/restaurant/diners-listing/', {
        restaurant: restaurantId,
        from,
        to,
      })
      .pipe(
        map(
          (records) =>
            ({ data: adaptDinersListing(records) } as unknown as ApiResponse<DinersListingRow[]>),
        ),
      );
  }
}
