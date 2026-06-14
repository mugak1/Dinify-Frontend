import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay, map } from 'rxjs/operators';

import { ApiService } from './api.service';
import { RestaurantDetail } from '../_models/app.models';

/** JSON-PUT payload for the editable tax & receipts fields. */
export interface TaxReceiptsFieldsPayload {
  id: string;
  vat_registered: boolean;
  /** Clean decimal value the backend DecimalField accepts (no float math). */
  vat_rate: string;
  /** Optional — `null` clears it (null-clears convention). */
  tin: string | null;
  /** Optional — `null` clears it (null-clears convention). */
  receipt_footer: string | null;
}

/**
 * Data layer for the Tax & receipts settings section.
 *
 * Reads the owner's restaurant via the same detail endpoint the Identity and
 * Availability sections use, and saves through the Secretary PUT. All four
 * fields (`vat_registered`, `vat_rate`, `tin`, `receipt_footer`) are on the
 * restaurant model + the `edit_information` whitelist (settings-fields backend
 * PR), so the PUT updates only the field(s) present in the payload — sending
 * just these keys cannot clobber another section's fields. The JSON path
 * preserves `null` end-to-end, so an emptied optional `tin`/`receipt_footer`
 * clears correctly.
 *
 * This section only stores the config; applying `vat_rate` to order totals or
 * rendering `receipt_footer` on receipts is the order/receipt pipeline (separate).
 *
 * Follows the repo's constant-flag mock pattern. Flip USE_MOCK_DATA to true
 * locally to drive the UI off the dormant in-memory mock without a backend.
 */
@Injectable({ providedIn: 'root' })
export class RestaurantTaxReceiptsService {
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

  save(payload: TaxReceiptsFieldsPayload): Observable<unknown> {
    if (this.USE_MOCK_DATA) {
      return of({ status: 200 }).pipe(delay(400));
    }
    return this.api.postPatch(this.saveUrl, payload, 'put');
  }

  // ── Mock (design-review aid; dormant behind USE_MOCK_DATA) ───────────────
  private mockDetail(id: string): RestaurantDetail {
    return {
      id,
      vat_registered: true,
      vat_rate: '18.00',
      tin: '1000123456',
      receipt_footer: 'Thank you for dining with us! WiFi: thelawns-guest',
    } as RestaurantDetail;
  }
}
