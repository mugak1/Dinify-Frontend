/**
 * Every API path the floor view (Step 2) calls, in one place.
 *
 * The portal has no shared API-path registry — each service names its paths beside
 * its calls — so the floor's live here, and nothing else in the floor code spells a
 * path. Paths are relative to `ApiService._base` (`<apiUrl>/api/<version>`).
 *
 * The four floor routes are BE-D's (`orders_app/urls_floor.py`, mounted at
 * `api/v1/floor/`; floor contract v1, `docs/FLOOR_CONTRACT.md` in the backend). The
 * status verb is the restaurant-setup table action (`restaurants_app/urls.py` →
 * `table-actions/<action>/`, `TableActionsEndpoint._update_status`), which takes
 * `{table_id, status}` and answers the table.
 *
 * `ErrorInterceptor.isFloorRoundCommand` recognises the two command routes by PATH
 * SHAPE; if a command path here changes, change that matcher and its spec with it.
 */
export const FLOOR_ROUTES = {
  /** GET `?restaurant=<uuid>` — the whole floor. */
  floor: (): string => 'floor/',
  /** GET `?restaurant=<uuid>` — one table with its rounds' items (the drawer). */
  table: (tableId: string): string => `floor/tables/${encodeURIComponent(tableId)}/`,
  /** POST `{restaurant}` — release a held round to the kitchen. */
  confirm: (orderId: string): string => `floor/rounds/${encodeURIComponent(orderId)}/confirm/`,
  /** POST `{restaurant}` — decline a held round. The server records the reason. */
  decline: (orderId: string): string => `floor/rounds/${encodeURIComponent(orderId)}/decline/`,
  /** POST `{table_id, status}` — Mark dirty / Mark available / Out of service. */
  updateStatus: (): string => 'restaurant-setup/table-actions/update-status/',
} as const;
