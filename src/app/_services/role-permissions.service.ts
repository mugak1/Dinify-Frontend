import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay, map } from 'rxjs/operators';

import { ApiService } from './api.service';
import { PermissionsMap } from '../_models/app.models';

/**
 * One role's row in the Roles & access grid: its lock state plus per-module
 * access flags. `editable` is sourced from the backend (D) — the owner row comes
 * back `editable:false` — and drives the UI lock; it is NEVER inferred from the
 * role name, so if the backend ever marks another role non-editable the grid
 * honours it without a UI change.
 */
export interface RoleGridRow {
  role: string;            // 'owner' | 'manager' | 'kitchen' | 'restaurant_staff'
  editable: boolean;
  modules: PermissionsMap;
}

/**
 * Defensive view of D's GET payload. The backend returns the four role rows; the
 * exact envelope is normalised by parseGrid (a bare array, `{records:[…]}`,
 * `{roles:[…]}`, or a role-keyed object are all accepted) so a small backend
 * shape change can't blank the grid.
 */
export interface RolePermissionsResponse {
  records?: unknown[];
  roles?: unknown[];
}

/**
 * Normalise D's grid payload into RoleGridRow[]. Tolerant of the response
 * envelope and of the per-module field name (`modules` | `permissions`). Each
 * row's `editable` is coerced to a boolean and `modules` defaults to an empty map.
 */
export function parseGrid(raw: any): RoleGridRow[] {
  const list: any[] = Array.isArray(raw)
    ? raw
    : raw?.records ??
      raw?.roles ??
      (raw && typeof raw === 'object'
        ? Object.entries(raw).map(([role, v]) => ({ role, ...(v as object) }))
        : []);
  return (list ?? [])
    .filter((r: any) => r && typeof r.role === 'string')
    .map((r: any) => ({
      role: r.role,
      editable: !!r.editable,
      modules: (r.modules ?? r.permissions ?? {}) as PermissionsMap,
    }));
}

/**
 * Data layer for the owner-only Roles & access grid (Settings → Team → Roles).
 * Reads D's role-permissions endpoint and PUTs a single role's full module map.
 * Mirrors restaurant-identity.service.ts: a constant USE_MOCK_DATA flag with a
 * dormant in-memory grid behind it (flip to true to nail visuals without a backend).
 */
@Injectable({ providedIn: 'root' })
export class RolePermissionsService {
  /** Real-wired (D's endpoint exists). Flip to true to drive the grid off the mock below. */
  private readonly USE_MOCK_DATA = false;
  private readonly gridUrl = 'role-permissions/';

  constructor(private api: ApiService) {}

  getGrid(restaurantId: string): Observable<RoleGridRow[]> {
    if (this.USE_MOCK_DATA) {
      return of(this.mockGrid()).pipe(delay(400));
    }
    return this.api
      .get<RolePermissionsResponse>(null, this.gridUrl, { restaurant: restaurantId })
      .pipe(map((res: any) => parseGrid(res?.data)));
  }

  saveRole(restaurant: string, role: string, modules: PermissionsMap): Observable<unknown> {
    if (this.USE_MOCK_DATA) {
      return of({ status: 200 }).pipe(delay(400));
    }
    return this.api.postPatch(this.gridUrl, { restaurant, role, modules }, 'put');
  }

  // ── Mock (design-review aid; dormant behind USE_MOCK_DATA) ───────────────
  private mockGrid(): RoleGridRow[] {
    const all = (v: boolean): PermissionsMap => ({
      dashboard: v, menu: v, tables: v, reviews: v, reports: v,
      settings: v, kitchen: v, billing: v, team: v,
    });
    return [
      { role: 'owner', editable: false, modules: all(true) },
      { role: 'manager', editable: true, modules: { ...all(true), settings: false, billing: false } },
      { role: 'kitchen', editable: true, modules: { ...all(false), dashboard: true, kitchen: true, tables: true } },
      { role: 'restaurant_staff', editable: true, modules: { ...all(false), dashboard: true, tables: true, menu: true } },
    ];
  }
}
