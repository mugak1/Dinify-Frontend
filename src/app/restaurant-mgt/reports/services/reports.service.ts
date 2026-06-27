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

@Injectable({ providedIn: 'root' })
export class ReportsService {
  /**
   * Mock gate for the four reports. While `true`, every real-HTTP branch below
   * is dead code and the entire `reports-adapter` layer is unreachable — the
   * reports render frontend-shaped mock data.
   *
   * FLIP-TIME GATE — the report contracts are PINNED by reports.service.spec.ts
   * (slug + params) and reports-adapter.spec.ts (response shape) against the
   * backend-derived contract, but they are UNVERIFIED against a LIVE API (no
   * real restaurant with orders exists yet). Before setting this to `false`:
   *   1. Run the contract specs (npm run test:ci) and confirm green.
   *   2. Re-verify ALL FOUR reports (Sales, Menu, Transactions, Diners)
   *      end-to-end against the live backend — slug, params AND response shape.
   *   3. See CLAUDE.md › Mock Data Pattern › ReportsService flip-time gate.
   * A `static` (not module `const`) so the contract specs can exercise the real
   * branch by flipping it.
   */
  static USE_MOCK_DATA = true;

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
    if (ReportsService.USE_MOCK_DATA) {
      return of({
        data: getMockSalesAggregate(from, to, granularity),
      } as unknown as ApiResponse<SalesAggregateRow[]>).pipe(delay(600));
    }
    return this.api
      .get<SalesAggregateRow[]>(null, 'reports/restaurant/sales-trends/', {
        restaurant: restaurantId,
        from,
        to,
        // Backend trends param is `category` (daily|monthly|quarterly|annual);
        // the FE only derives daily|monthly, both valid. `result=table` (the
        // backend default) yields the array shape the adapter expects — sent
        // explicitly to pin the contract.
        category: granularity,
        result: 'table',
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
    if (ReportsService.USE_MOCK_DATA) {
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
    if (ReportsService.USE_MOCK_DATA) {
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
    if (ReportsService.USE_MOCK_DATA) {
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
    if (ReportsService.USE_MOCK_DATA) {
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
    if (ReportsService.USE_MOCK_DATA) {
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
    if (ReportsService.USE_MOCK_DATA) {
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
