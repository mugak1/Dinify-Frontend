import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay, map } from 'rxjs/operators';

import { ApiService } from './api.service';
import {
  BrandingConfiguration,
  RestaurantDetail,
  Socials,
} from '../_models/app.models';

/** JSON-PUT payload for the editable identity fields (no image files). */
export interface IdentityFieldsPayload {
  id: string;
  name: string;
  tagline: string | null;
  cuisine_types: string[];
  contact_phone: string | null;
  contact_email: string | null;
  location: string | null;
  landmark: string | null;
  socials: Socials;
  branding_configuration: BrandingConfiguration;
  /** Present (and `null`) only when the owner clears the cover photo. */
  cover_photo?: null;
}

/** Multipart-PUT payload — carries only the staged image File(s). */
export interface IdentityImagesPayload {
  id: string;
  logo?: File;
  cover_photo?: File;
}

/**
 * Data layer for the Restaurant identity & branding settings section.
 *
 * Reads the owner's restaurant via the detail endpoint and saves through the
 * Secretary PUT. All edited fields are on the restaurant model + edit_information
 * whitelist (PR2, PR3a, original model).
 *
 * Save is intentionally SPLIT into two calls (see plan):
 *  - `saveFields`   — a JSON PUT carrying every text/JSON field. The JSON path
 *                     preserves `null` end-to-end, so emptied optional fields
 *                     clear correctly (the null-clears convention).
 *  - `uploadImages` — a multipart PUT carrying only staged logo/cover File(s),
 *                     sent ONLY when an image actually changed. Clearing an
 *                     image rides the JSON PUT as `cover_photo: null`, never the
 *                     multipart path (toFormData drops null).
 *
 * Follows the repo's constant-flag mock pattern. Flip USE_MOCK_DATA to true
 * locally to nail the visuals against the dormant mock without a backend.
 */
@Injectable({ providedIn: 'root' })
export class RestaurantIdentityService {
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

  saveFields(payload: IdentityFieldsPayload): Observable<unknown> {
    if (this.USE_MOCK_DATA) {
      return of({ status: 200 }).pipe(delay(400));
    }
    return this.api.postPatch(this.saveUrl, payload, 'put');
  }

  uploadImages(payload: IdentityImagesPayload): Observable<unknown> {
    if (this.USE_MOCK_DATA) {
      return of({ status: 200 }).pipe(delay(400));
    }
    // isFormData = true → multipart; only the staged File(s) + id are present.
    return this.api.postPatch(this.saveUrl, payload, 'put', '', {}, true);
  }

  // ── Mock (design-review aid; dormant behind USE_MOCK_DATA) ───────────────
  private mockDetail(id: string): RestaurantDetail {
    return {
      id,
      name: 'The Lawns Kampala',
      location: 'Plot 11, Kyadondo Road, Nakasero, Kampala',
      logo: '',
      cover_photo: null,
      tagline: 'Wood-fired grills under the jacaranda trees.',
      cuisine_types: ['Grill / BBQ', 'Continental', 'Café'],
      contact_phone: '256700123456',
      contact_email: 'hello@thelawns.ug',
      landmark: 'Opposite the Uganda Museum',
      socials: {
        instagram: 'thelawnskla',
        facebook: 'thelawnskampala',
        x: '',
        tiktok: '',
      },
      branding_configuration: {
        home: {
          header_style: 'standard',
          brand_color: '#2E7D32',
          logo_display: 'logo_and_name',
          tagline: '',
        },
      },
    } as RestaurantDetail;
  }
}
