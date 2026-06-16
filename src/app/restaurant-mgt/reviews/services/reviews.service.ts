import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../../../_services/api.service';
import { ApiResponse } from '../../../_models/app.models';
import { ReviewsAnalytics } from '../models/reviews.models';
import { adaptReviewsAnalytics } from './reviews-adapter';

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
}
