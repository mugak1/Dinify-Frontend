import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject, of } from 'rxjs';
import { delay, map } from 'rxjs/operators';
import { ApiService } from '../../../_services/api.service';
import { ApiResponse } from '../../../_models/app.models';
import { ReportBucketUnit } from '../../../_shared/timeframe';
import { DashboardV2Response, ReviewsSummaryResponse } from '../models/dashboard.models';
import { getMockDashboardData, getMockReviewsData } from '../data/dashboard-mock-data';
import { adaptDashboardResponse, adaptReviewsResponse } from './dashboard-adapter';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  /** Set to false to use real API endpoints instead of mock data.
   *
   *  `static` rather than a module const so the contract specs can flip it and exercise
   *  the real branch — the same reason `ReportsService.USE_MOCK_DATA` is one. Without
   *  that seam there is no way to assert what actually reaches the API. */
  static USE_MOCK_DATA = true;

  /** Reviews card is real-wired (reviews/summary/); flip to true for design review */
  static USE_MOCK_REVIEWS = false;

  /** Emit to force a data reload */
  refresh$ = new Subject<void>();

  /** Timestamp of last successful data fetch (rendered in the dashboard page header) */
  lastFetchTimestamp$ = new BehaviorSubject<number>(Date.now());

  constructor(private api: ApiService) {}

  /**
   * @param bucket the chart granularity, from `resolveTimeframe(range).bucketUnit`.
   *   The backend resolves this fail-CLOSED — an unrecognised value is a 400 rather
   *   than a silent fallback to hourly. The legacy `period` parameter (keyed on the old
   *   UI selection rather than on a granularity) is no longer sent by anything.
   */
  getDashboardData(
    restaurantId: string,
    dateFrom: string,
    dateTo: string,
    bucket: ReportBucketUnit,
  ): Observable<ApiResponse<DashboardV2Response>> {
    if (DashboardService.USE_MOCK_DATA) {
      return of({
        data: getMockDashboardData(restaurantId, dateFrom, dateTo, bucket),
      } as unknown as ApiResponse<DashboardV2Response>).pipe(delay(600));
    }
    return this.api.get<DashboardV2Response>(null, 'reports/restaurant/dashboard-v2/', {
      restaurant: restaurantId,
      from: dateFrom,
      to: dateTo,
      bucket,
    }).pipe(
      map((res: any) => ({
        ...res,
        data: res.data ? adaptDashboardResponse(res.data) : null,
      })),
    );
  }

  /**
   * The Guest Reviews card, over the SAME window the other cards were fetched for.
   *
   * `from` / `to` are inclusive days, exactly what `getDashboardData` sends. The server
   * counts AND lists the reviews in that window, so the card's rating, count, histogram
   * and quotes all describe one set of reviews. Without the pair it falls back to its
   * original contract (a rolling 30 days, with the three newest reviews of all time),
   * which is how the card came to read "0.0 · 0 reviews" above two five-star reviews from
   * two months ago, whatever range was picked. The pair always travels together — one
   * without the other is a 400.
   *
   * The mock ignores the window; it is a dormant design-review aid behind
   * `USE_MOCK_REVIEWS` and describes no particular period.
   */
  getReviewsSummary(
    restaurantId: string,
    dateFrom: string,
    dateTo: string,
  ): Observable<ApiResponse<ReviewsSummaryResponse>> {
    if (DashboardService.USE_MOCK_REVIEWS) {
      return of({ data: getMockReviewsData() } as unknown as ApiResponse<ReviewsSummaryResponse>).pipe(delay(400));
    }
    return this.api.get<ReviewsSummaryResponse>(null, 'reviews/summary/', {
      restaurant: restaurantId,
      from: dateFrom,
      to: dateTo,
    }).pipe(
      map((res: any) => ({
        ...res,
        data: res.data ? adaptReviewsResponse(res.data) : null,
      })),
    );
  }
}
