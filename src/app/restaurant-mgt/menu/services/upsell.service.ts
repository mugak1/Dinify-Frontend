import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ApiResponse, UpsellConfig } from 'src/app/_models/app.models';

/**
 * Response shape for single-resource upsell config endpoints.
 * The generic ApiResponse<T> is shaped for paginated lists and
 * doesn't fit the 1:1 upsell-config resource.
 */
interface UpsellConfigResponse {
  status: number;
  message: string;
  data?: UpsellConfig;
}

@Injectable({
  providedIn: 'root'
})
export class UpsellService {

  private readonly _config$ = new BehaviorSubject<UpsellConfig | null>(null);
  readonly config$ = this._config$.asObservable();

  private readonly _isLoading$ = new BehaviorSubject<boolean>(false);
  readonly isLoading$ = this._isLoading$.asObservable();

  private readonly _isSaving$ = new BehaviorSubject<boolean>(false);
  readonly isSaving$ = this._isSaving$.asObservable();

  constructor(
    private api: ApiService,
    private auth: AuthenticationService
  ) {}

  loadConfig(restaurantId: string): void {
    this._isLoading$.next(true);

    this.api.get<UpsellConfig>(null, 'restaurant-setup/upsell-config/', { restaurant: restaurantId })
      .subscribe({
        next: (res: ApiResponse<UpsellConfig>) => {
          const response = res as unknown as UpsellConfigResponse;
          this._config$.next(response?.data ?? null);
          this._isLoading$.next(false);
        },
        error: () => {
          this._isLoading$.next(false);
        }
      });
  }

  updateConfig(data: any): Observable<any> {
    this._isSaving$.next(true);
    return this.api.postPatch(
      'restaurant-setup/upsell-config/', data, 'put', '', {}, false, '', true
    ).pipe(
      tap({
        next: () => this._isSaving$.next(false),
        error: () => this._isSaving$.next(false)
      })
    );
  }

  addItems(configId: string, itemIds: string[]): Observable<any> {
    return this.api.postPatch(
      'restaurant-setup/upsell-config/items/', { config: configId, item_ids: itemIds }, 'post'
    ).pipe(
      tap(() => this.reloadConfig())
    );
  }

  removeItem(itemId: string): Observable<any> {
    return this.api.Delete('restaurant-setup/upsell-config/items/', { id: itemId }).pipe(
      tap(() => this.reloadConfig())
    );
  }

  reorderItems(configId: string, itemIds: string[]): Observable<any> {
    return this.api.postPatch(
      'restaurant-setup/upsell-config/items/reorder/', { config: configId, item_ids: itemIds }, 'post'
    ).pipe(
      tap(() => this.reloadConfig())
    );
  }

  getConfigSnapshot(): UpsellConfig | null {
    return this._config$.getValue();
  }

  private reloadConfig(): void {
    const restaurantId = this.auth.currentRestaurantRole?.restaurant_id;
    if (restaurantId) {
      this.loadConfig(restaurantId);
    }
  }
}
