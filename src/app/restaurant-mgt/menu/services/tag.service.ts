import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { ApiService } from 'src/app/_services/api.service';

export interface PresetTag {
  id: string;
  name: string;
  icon: string;
  color: string;
  displayOrder: number;
  filterable: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class TagService {

  private readonly _presetTags$ = new BehaviorSubject<PresetTag[]>([]);
  readonly presetTags$ = this._presetTags$.asObservable();

  private readonly _isLoading$ = new BehaviorSubject<boolean>(false);
  readonly isLoading$ = this._isLoading$.asObservable();

  constructor(private api: ApiService) {}

  loadPresetTags(restaurantId: string): void {
    this._isLoading$.next(true);
    this.api.get<any>(null, 'restaurant-setup/preset-tags/', { restaurant: restaurantId })
      .subscribe({
        next: (res: any) => {
          const tags = res?.data?.records ?? res?.data?.tags ?? res?.data ?? [];
          this._presetTags$.next(Array.isArray(tags) ? tags : []);
          this._isLoading$.next(false);
        },
        error: () => {
          this._presetTags$.next([]);
          this._isLoading$.next(false);
        }
      });
  }

  savePresetTags(restaurantId: string, tags: PresetTag[]): Observable<any> {
    return this.api.postPatch(
      'restaurant-setup/preset-tags/',
      { restaurant: restaurantId, tags: JSON.stringify(tags) },
      'put'
    ).pipe(
      tap(() => this._presetTags$.next(tags))
    );
  }

  getPresetTagsSnapshot(): PresetTag[] {
    return this._presetTags$.getValue();
  }
}
