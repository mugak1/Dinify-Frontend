import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay, map } from 'rxjs/operators';

import { ApiService } from './api.service';
import { RestaurantDetail } from '../_models/app.models';

/** JSON-PUT payload for the editable availability fields. */
export interface AvailabilityFieldsPayload {
  id: string;
  accepting_orders: boolean;
}

/**
 * Data layer for the Availability settings section.
 *
 * Reads the owner's restaurant via the same detail endpoint the Identity section
 * uses, and saves through the Secretary PUT. `accepting_orders` is on the
 * restaurant model + the `edit_information` whitelist (settings-fields backend
 * PR), so the PUT updates only the field(s) present in the payload — sending just
 * `{ id, accepting_orders }` cannot clobber Identity's fields.
 *
 * Opening-hours scheduling is a later PR; this section ships only the toggle.
 *
 * Follows the repo's constant-flag mock pattern. Flip USE_MOCK_DATA to true
 * locally to drive the UI off the dormant in-memory mock without a backend.
 */
@Injectable({ providedIn: 'root' })
export class RestaurantAvailabilityService {
  /** Real-wired. Flip to true to drive the UI off the in-memory mock below. */
  private readonly USE_MOCK_DATA = false;

  private readonly detailUrl = 'restaurant-setup/details/';
  private readonly saveUrl = 'restaurant-setup/restaurants/';

  constructor(private api: ApiService) {}

  getDetail(id: string): Observable<RestaurantDetail> {
    if (this.USE_MOCK_DATA) {
      return of(this.mockDetail(id)).pipe(delay(400));
    }
    return this.api
      .get<RestaurantDetail>(null, this.detailUrl, { id, record: 'restaurants' })
      .pipe(map((res: any) => res?.data as RestaurantDetail));
  }

  save(payload: AvailabilityFieldsPayload): Observable<unknown> {
    if (this.USE_MOCK_DATA) {
      return of({ status: 200 }).pipe(delay(400));
    }
    return this.api.postPatch(this.saveUrl, payload, 'put');
  }

  // ── Mock (design-review aid; dormant behind USE_MOCK_DATA) ───────────────
  private mockDetail(id: string): RestaurantDetail {
    return {
      id,
      accepting_orders: true,
    } as RestaurantDetail;
  }
}
