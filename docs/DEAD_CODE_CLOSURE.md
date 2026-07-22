# Dead-Code Closure — Frontend (DEAD-CODE-FE-CLOSE)

> **Engineering closure record, not a certification.**
> It documents what the frontend dead-code-audit program removed, at which
> commits — and, as importantly, what it deliberately **kept** and why. It is the
> counterpart to `docs/TENANT_ISOLATION_CLOSURE.md` and records the shape of the
> tree so the deliberate keeps are not later mistaken for oversights.

## Narrow closure statement

At the audited commits below, the frontend dead-code-audit program (dependency
hygiene + dead-code removal) is **complete**: the findings it accepted are executed
and merged, its gates (`lint`, `type-check`, `test:tenant-boundary`, `test:ci`,
`build:prod`) were green at merge, and every item it deliberately did **not** remove
is inventoried here with its rationale.

We do **not** claim the tree is now free of all dead code, that every future addition
is automatically live, or that the deferred items below are safe to remove without the
noted check. This record covers the **frontend** repo only. The retained `USE_MOCK`
seams are product-state — dormant mocks awaiting a confirmed live backend — **not**
oversights.

## Audited commits

| Anchor | Commit |
|---|---|
| Audit base (2026-07-21) | `3236273e303f9012a36f424276d102f837954944` |
| Validity (this record) | `37da3098d3499db9b1831fe0ead7b5d08da33789` |

The audit was taken against the tree at the audit-base commit; this record is valid as
of the validity commit (`origin/main` after the dead-code-removal PR merged). Re-audit
when the deliberate keeps change (see **Re-audit triggers**).

## Fix-forward ledger

Repairs shipped ahead of / alongside the removal program — functional fixes, not
deletions:

| Repair | PR | What changed |
|---|---|---|
| Tag edit PATCH route | **#597** (`49dff5c`) | `RestaurantTagService.update()` now PATCHes the DETAIL route `restaurant-setup/restaurant-tags/<id>/` (id in the path, not the body). The list route serves GET/POST only, so the old PUT-to-list `405`'d on every edit / filterable toggle. |
| Logout token revocation | **#597** (`49dff5c`) | `AuthenticationService.revokeAndExit()` POSTs the refresh token to `users/auth/logout/` (via `rawHttp`, to dodge the error-interceptor `401 → logout()` recursion) **before** clearing state, on both `logout()` and `logoutDueToInactivity()`; a 2 s timeout backstops the redirect, a missing refresh skips the POST. |
| Restaurant-tag reorder + usage-count | code + backend **#245** | `RestaurantTagService.reorder()` (POST `restaurant-tags/reorder/`) and `countItemsUsing()` (GET `restaurant-tags/<id>/usage-count/`) are functional against the backend routes from PR #245. (These reached the frontend via content commit `62bafe6`; there is no dedicated FE PR titled for them.) |

## Executed-finding ledger (per PR)

### FE-2 — dependency hygiene · PR **#599** (`cce2677`)

Phantom-dependency fix + dead-dep removal, one lockfile event:

- Removed `angularx-qrcode`, `lz-string`, `ngx-color-picker` (dependencies) and
  `autoprefixer` (devDependency).
- **Promoted `qrcode` to a direct dependency** (`^1.5.4`) — six source files imported
  raw `qrcode` that previously only resolved as `angularx-qrcode`'s transitive dep.
- Removed **one of the two Angular-22 upgrade blockers** (`angularx-qrcode`).

### FE-3 — dead-code removal · PR **#603** (`37da309`)

73 files, ~5,443 deletions, across eight independently re-verified clusters:

| Cluster | Removed |
|---|---|
| A — dead components | `_common/auto-complete/`, `date-picker/`, the `currency-input` chain (`CurrencyModule` / `InputModule`), `utils/color-utils.ts`, + module unwiring (`ConfirmDialogComponent` kept) |
| B — surgical | the `AVAILABLE_ICONS` export; `NgxCurrencyDirective` from the diner-app + restaurant-mgt modules; the duplicated inline `searchArray` |
| C — apexcharts retirement | `_common/common-chart/`, the commented dinify-mgt dashboard layout + `NgApexchartsModule` + apex-typed code, the `apexcharts` + `ng-apexcharts` deps, and the orphaned `app.models` `ChartData` |
| D — billing remnant | the dead `value='ova'` Collections radio (+ the `grid-cols` / duplicated `for=` fixes it exposed) |
| E — commented cleanup | dead commented blocks across 6 files (`common-image.css` partial — live CSS kept; the `tag-palette.ts` rule comment kept) |
| F — dead model types | 25 dead `app.models.ts` interfaces (legacy-orders, dead-dashboard, grouped-tables, singles, and the app.models `ReviewListItem` twin) |
| G — unused params | `confirm-dialog` `modalSubscription`; `authentication.service` `router` (+ its spec construction sites); `welcome` `router`; login's unused `_u` binding; two spec `res` params; `item-list` `auth`; `preview-menu-drawer` `upsellService` |
| H — assets | 26 Montserrat fonts + `default-cover.jpg` + `placeholder.png`; untracked the committed `.firebase` hosting cache |

`chart.js` / `ng2-charts` (the live chart stack) were untouched throughout.

## Deliberate keeps (and why)

Code the program deliberately did **not** remove. These are intentional — do not
delete them as "dead" without the noted check.

- **`lucide-angular`** (`^1.0.0`, imported only by `dinify-mgt.module.ts`) — with
  `angularx-qrcode` gone, this is the **sole remaining dependency that supports the
  current Angular 21 but caps its peer below 22** (`@angular/common` / `@angular/core`:
  `13.x – 21.x`) — the last of the two Angular-22 upgrade blockers the audit named.
  Kept because the legacy `dinify-mgt` (Platform Admin) module still imports it; new
  code uses inline SVGs per project rule. Removing it is an Angular-22-prep task in its
  own right.
  - *Footnote:* `ngx-currency`'s peer caps even lower (`^19.0.0`) — already behind
    Angular 21 and tolerated only via `npm ci --legacy-peer-deps` — a **pre-existing
    peer gap, not a 21→22 blocker**. CI installs with `--legacy-peer-deps`, so neither
    package mechanically blocks an install; the peer ranges are official-support
    signals only.
- **`tag-palette.ts` rule comment** (`src/app/_shared/tags/tag-palette.ts:86–90` —
  "SVG markup is inlined (no lucide-angular dependency per project Angular rules)") —
  **kept (audit override DC-FE-197)**: it encodes a standing project rule, not stale
  narration. Deleting it would drop the "why inline SVG here" context.
- **`ngx-currency`** (`^19.0.0`) — **live**: the `currencyMask` directive on the
  `flat_fee` input at `dinify-mgt/restaurants/restaurants.component.html:524` (sole
  importer `dinify-mgt.module.ts`). FE-3 removed only the two *unused* module imports
  (diner-app, restaurant-mgt); the package and its live use stay.
- **`firebase-tools`** (`^15.22.0`, devDependency) — **kept by default**: no automated
  consumer. The production deploy uses the `FirebaseExtended/action-hosting-deploy`
  marketplace action (not a `firebase deploy` shell-out), and no npm script invokes
  `firebase`. It is a local / manual-CLI convenience — removable the day the owner
  confirms nobody runs a manual local `firebase deploy`.
- **`USE_MOCK` seams + mock datasets (T2 inventory)** — product-state, not dead. Each
  flag gates a dormant in-repo mock kept as a design-review aid until its live backend
  is confirmed. A `false` flag keeps its mock dormant behind the flag (not deleted) so
  a review can flip it locally.

  | Flag | Location | Value |
  |---|---|---|
  | `USE_MOCK_DATA` | `kitchen/services/kitchen-order.service.ts:33` | `false` |
  | `USE_MOCK_DATA` | `restaurant-mgt/dashboard/services/dashboard.service.ts:14` | `true` |
  | `USE_MOCK_REVIEWS` | `restaurant-mgt/dashboard/services/dashboard.service.ts:17` | `false` |
  | `USE_MOCK_SETUP` | `restaurant-mgt/tables/services/tables.service.ts:27` | `false` |
  | `USE_MOCK_SERVICE` | `restaurant-mgt/tables/services/tables.service.ts:30` | `true` |
  | `USE_MOCK_DATA` (`static`) | `restaurant-mgt/reports/services/reports.service.ts:69` | `true` |
  | `USE_MOCK_DATA` | `_services/restaurant-identity.service.ts:56` | `false` |
  | `USE_MOCK_DATA` | `_services/restaurant-availability.service.ts:32` | `false` |
  | `USE_MOCK_DATA` | `_services/restaurant-tax-receipts.service.ts:41` | `false` |
  | `USE_MOCK_DATA` | `_services/role-permissions.service.ts:63` | `false` |

  Datasets: `_shared/mock/{daily-revenue,hour-of-day}.ts`, `kitchen/mock/`,
  `restaurant-mgt/dashboard/data/`, `restaurant-mgt/reports/data/`,
  `restaurant-mgt/tables/data/`, plus the inline mocks in the four `_services/`
  settings-section services.
- **Parked Tables Service View** — the reservations / waitlist / seated-party surface
  is parked **and** hidden: `TablesComponent` seeds and validates `activeView` to
  `'setup'` only (`tables.component.ts:33` / `:36`), `USE_MOCK_SERVICE = true`, and the
  write path fails loud via `serviceViewNotWired`. Its component / services / mocks /
  models stay so re-enabling is a small revert.

## Deferred

- **`@angular/animations`** — effectively **DEAD** (0 imports, 0 providers, 0
  `animations:` metadata, 0 `[@]` template triggers, incl. inline templates), a direct
  dependency (`^21.2.18`, `package.json:20`), **upstream-deprecated**, and only an
  *optional* peer of `@angular/platform-browser` (`@angular/material` is not installed,
  so nothing requires it). **Deferred, not removed** by this program — retained pending
  an owner decision, mirroring the `firebase-tools` posture. It is a clean one-line
  `package.json` removal whenever that decision lands.
- **Appendix-E environment-chain cleanup** — deferred; out of scope for this program
  and left for a dedicated pass.

## Asset removals

FE-3 (#603) removed **28 files totalling 5,692,493 bytes (~5.69 MB)**:

- 26 unreferenced Montserrat font files (`src/assets/fonts/Montserrat-*`, ~5.10 MB) —
  the app's typography is @fontsource variable fonts imported in `styles.css`.
- `src/assets/default-cover.jpg` (585,866 B) and `src/assets/placeholder.png`
  (5,229 B) — zero references.
- The committed `.firebase/hosting.*.cache` was untracked (`git rm --cached`);
  `.gitignore` already covered `.firebase/`, so no `.gitignore` change was needed.

No `angular.json` change was needed (assets are a blanket `src/assets` glob), and the
`build:prod` output was confirmed free of any reference to the removed assets.

## Re-audit triggers

Re-run this closure when any of these change: a new dependency is added (re-check the
Angular-22 peer surface and the `--legacy-peer-deps` reliance); the `@angular/animations`
or `firebase-tools` keep is decided (remove it and refresh this record); a `USE_MOCK_*`
flag flips to `false` (a mock dataset becomes deletable); the parked Tables Service View
is unparked (its mock + models go live); or the `tag-palette.ts` rule comment / the
inline-SVG project rule changes.

---

**Validity SHA:** `37da3098d3499db9b1831fe0ead7b5d08da33789` (`origin/main` at close).
