import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from './api.service';
import {
  RestaurantTag,
  RestaurantTagUsageCount,
} from '../_models/app.models';

export interface RestaurantTagPayload {
  name: string;
  category: RestaurantTag['category'];
  icon: string | null;
  colour: string;
  filterable: boolean;
  display_order?: number;
}

/**
 * Wraps the /restaurant-tags/ CRUD endpoints shipped by backend PR #84.
 *
 * Tenant isolation is handled server-side from the authenticated request
 * context — the client only sends the restaurant filter on the list call
 * to scope the response. Mutations are bound to the authenticated
 * restaurant automatically.
 */
@Injectable({ providedIn: 'root' })
export class RestaurantTagService {
  private readonly base = 'restaurant-setup/restaurant-tags/';

  constructor(private api: ApiService) {}

  list(restaurantId: string): Observable<RestaurantTag[]> {
    return this.api
      .get<RestaurantTag>(null, this.base, { restaurant: restaurantId })
      .pipe(
        map((res: any) => {
          const records = res?.data?.records ?? res?.data ?? [];
          return Array.isArray(records) ? (records as RestaurantTag[]) : [];
        }),
      );
  }

  create(restaurantId: string, payload: RestaurantTagPayload): Observable<RestaurantTag> {
    return this.api
      .postPatch(this.base, { ...payload, restaurant: restaurantId }, 'post')
      .pipe(map((res: any) => (res?.data ?? res) as RestaurantTag));
  }

  update(id: string, payload: Partial<RestaurantTagPayload>): Observable<RestaurantTag> {
    return this.api
      .postPatch(this.base, { id, ...payload }, 'put')
      .pipe(map((res: any) => (res?.data ?? res) as RestaurantTag));
  }

  delete(id: string): Observable<unknown> {
    return this.api.Delete(`${this.base}${id}/`, {});
  }

  countItemsUsing(tagId: string): Observable<number> {
    return this.api
      .get<RestaurantTagUsageCount>(null, `${this.base}${tagId}/usage-count/`)
      .pipe(
        map((res: any) => {
          const count = res?.data?.count ?? res?.count ?? 0;
          return typeof count === 'number' ? count : Number(count) || 0;
        }),
      );
  }

  /**
   * Persists a new display order for a collection of tags. The backend
   * accepts an `order` payload of `{ id, display_order }` pairs and
   * updates all rows in a single transaction — one call total, not one
   * call per tag.
   */
  reorder(orderedIds: string[]): Observable<unknown> {
    const order = orderedIds.map((id, index) => ({ id, display_order: index }));
    return this.api.postPatch(`${this.base}reorder/`, { order }, 'post');
  }
}
