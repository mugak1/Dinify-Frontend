import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../../../_services/api.service';
import { ApiResponse } from '../../../_models/app.models';
import { ReviewsAnalytics, ReviewListItem } from '../models/reviews.models';
import { adaptReviewsAnalytics, adaptReviewListItem } from './reviews-adapter';

/** Server-side filters for the reviews/ retrieval endpoint. */
export interface ReviewFeedFilters {
  critical?: boolean;
  resolutionStatus?: 'open' | 'resolved';
  rating?: number;
}

@Injectable({ providedIn: 'root' })
export class ReviewsService {
  constructor(private api: ApiService) {}

  /**
   * Fetch the Reviews Overview analytics for a restaurant. `from`/`to` are
   * `YYYY-MM-DD`; the endpoint defaults to 90 days / weekly when omitted.
   */
  getAnalytics(
    restaurantId: string,
    from?: string,
    to?: string,
    category?: string,
  ): Observable<ApiResponse<ReviewsAnalytics>> {
    // Build params conditionally — ApiService serialises every key, so an
    // undefined optional would otherwise hit the backend as `category=undefined`.
    const params: Record<string, string> = { restaurant: restaurantId };
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    if (category) params['category'] = category;

    return this.api.get<ReviewsAnalytics>(null, 'reviews/analytics/', params).pipe(
      map((res: any) => ({
        ...res,
        data: res.data ? adaptReviewsAnalytics(res.data) : null,
      })),
    );
  }

  /**
   * Fetch the reviews Feed for a restaurant. The `reviews/` endpoint is a
   * paginated DinifyPaginator, so we lean on ApiService.loadAllPages to
   * concatenate every page. Filters are built conditionally — never send an
   * `undefined`, which ApiService would serialise as the string "undefined".
   */
  getReviews(
    restaurantId: string,
    filters?: ReviewFeedFilters,
  ): Observable<ReviewListItem[]> {
    const params: Record<string, string> = { restaurant: restaurantId };
    if (filters?.critical) params['critical'] = 'true';
    if (filters?.resolutionStatus) params['resolution_status'] = filters.resolutionStatus;
    if (filters?.rating) params['rating'] = String(filters.rating);

    return this.api
      .loadAllPages<any>('reviews/', params)
      .pipe(map((records) => records.map(adaptReviewListItem)));
  }
}
