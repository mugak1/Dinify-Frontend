# Dinify Frontend — Claude Code Context

## Project Overview
Dinify is a QR-code-based digital ordering and restaurant management platform
built for Uganda and mobile-money-first markets. This repo contains two
portals — Restaurant Management Portal and Diner App — plus a staff-facing
Kitchen View board (route `/kitchen`). The Platform Admin surface LEFT this repo
in PR-6: Dinify admin functionality now lives only at `admin.dinifyapp.com`
(separate origin, platform-staff accounts, TOTP, opaque cookie sessions), and
this application contains no code path that can authenticate an administrator.
Deployed to Firebase Hosting at dinify-prod.web.app.
A parallel `AGENTS.md` at the repo root carries Codex/other-agent instructions
that defer to this file — `CLAUDE.md` remains the authoritative project guide,
so keep it current when conventions change.

## Tech Stack
- Angular 22 with mixed component pattern (see below), on TypeScript 6.0 and
  Node 24. Angular 22's engines are `^22.22.3 || ^24.15.0 || >=26.0.0`, so all
  three workflows pin Node 24 — Node 20 cannot run it at all
- Builds/serves/tests run on the esbuild-based `@angular/build` application
  builder (`@angular/build:application`, `:dev-server`, `:karma`) — migrated
  off the legacy webpack `@angular-devkit/build-angular` builder
- Tailwind CSS
- Firebase Hosting (auto-deploys on push to main via GitHub Actions)
- Repo: mugak1/Dinify-Frontend

## Current Implementation Status
- Phase 0 (Foundation): ✅ Complete
- Portal URL hoist: ✅ the restaurant portal moved from `/rest-app/*` to the URL
  ROOT (`/dashboard`, `/menu`, `/dining-tables`, `/reviews`, `/reports`,
  `/support`, `/settings`, `/account`, `/notifications`). The portal parent is
  an empty-path route declared SECOND-TO-LAST in `app-routing.module.ts` — any
  NEW root-level route MUST be declared above it or the portal's internal
  wildcard swallows it (pinned by the ordering ratchet in
  `app-routing.module.spec.ts`). Legacy `/rest-app/*` URLs redirect via
  `_helpers/legacy-rest-app-redirect.ts` (bare `/rest-app` → `/dashboard`;
  otherwise the leading `rest-app` segment is stripped, preserving query params
  + fragment, one history entry — a mid-URL `rest-app` segment is never
  touched). `MODULE_ROUTES`/`NO_MODULE_ROUTE` are prefix-free; the error
  interceptor's banner-shell check is an inverted first-segment deny-list
  (`NON_BANNER_SHELL_ROOTS` in `error.interceptor.ts`); the diner embed flag is
  DECLARED ON THE ROUTE — `DINER_MOUNT_EMBEDDED` data on each DinerAppModule
  mount, resolved via `resolveDinerMountEmbedded` (`diner-app/diner-mount.ts`,
  walking up the snapshot chain since `paramsInheritanceStrategy` stays at the
  default `'emptyOnly'`; no-flag defaults to standalone) — never sniffed from
  `router.url`, which is stale mid-navigation. There are now TWO diner mounts —
  the standalone `/diner` shell and the portal child `rest-app-ordering`; the
  third (the admin embed) went with the admin plane in PR-6
- Phase 1 (Menu module, all sub-phases 1a–1d): ✅ Complete
- Phase 2 (Dashboard): ✅ Complete — `USE_MOCK_DATA` still true in DashboardService
  for the core metrics, but TWO cards are real-wired exceptions: the Popular Items
  card overlays real menu-item identities onto the (still-mock) metrics, and the
  Reviews card pulls live data via `reviews/summary/` behind its own
  `USE_MOCK_REVIEWS = false` flag. The date range comes from the shared
  `TimeframeService` (see the timeframe bullet below) and the picker sits in the page
  header's `app-page-header` `[actions]` slot — NOT in `layout/top-nav`, which no
  longer carries any timeframe control. Polling is CONDITIONAL: `timer(0, 30_000)`
  runs only while the selected range includes today; a closed range fetches once,
  since a finished period's numbers cannot change. Manual refresh (`refresh$`) works
  for any range. The Reviews chain still polls unconditionally — `reviews/summary/`
  takes no date range, so the selected window says nothing about it
- Diner App menu redesign: ✅ Complete (sticky brand strip, scroll-aware nav
  pills, quick-add affordance, allergen-safety disclaimer banner)
- Diner discount/price UI: ✅ Complete — every diner price surface (item-detail,
  menu card, featured carousel, basket) now renders through the shared
  presentational trio (`app-price-display` / `app-discount-badge` /
  `app-savings-indicator`, see Shared UI Component Library) fed from the canonical
  server-truth `discount_details`, replacing the per-surface hand-rolled
  strikethrough / badge markup
- Diner table-session capability (opaque QR): ✅ the anonymous diner journey now
  runs on a signed table-session capability (backend PR 7A) instead of a raw
  table UUID — a `DinerSessionService` (`_services/diner-session.service.ts`) owns
  the QR credential and the minted session token, and a `DinerSessionInterceptor`
  (`_helpers/diner-session.interceptor.ts`) attaches them only to an exact
  first-party route allowlist owned by `_security/diner-capability-contract.ts`;
  a denied credential drives a rescan panel on the diner shell. See Key Domain
  Concepts for the two-token model and its invariants
- Dashboard responsiveness: ✅ Complete
- Phase 3 (Tables module): 🔄 MVP ships Setup View only (route `dining-tables`)
  - Setup View (areas, tables): ✅ wired to real API (`USE_MOCK_SETUP = false`);
    blocked deletes (e.g. an area that still has tables) surface the backend
    message as a single toast (see error-handling note below)
  - Secure single-table QR lifecycle: ✅ the Setup View activates AND rotates a
    table's QR. Activation (`has_qr=true`, via the ordinary table update) revokes
    nothing; ROTATION (`restaurant-setup/table-actions/regenerate-qr/`, one table
    at a time) bumps the backend generation, revoking every outstanding credential
    + live session for that table. Rotation is single-request-guarded (one confirm
    → one request; rapid clicks can't double-rotate), sends only `{ table_id }`,
    strictly parses the server-signed response into `QrRotationResult`
    (`id`/`qr_version`/`qr_regenerated_at`/`qr_credential`) and only then swaps in
    the new credential — a failed rotation leaves local state untouched. The
    printed QR encodes the opaque, signed `RestaurantTable.qrCredential` (backend
    PR 7A), never the table UUID; the QR-preview modal renders/copies/downloads/
    prints ONLY with a non-empty credential
  - Service View (reservations, waitlist, seated parties): ⏸️ parked AND hidden
    from the UI — its component/services/mocks/models stay in the repo but are
    NOT rendered. `TablesComponent.activeView` is forced to `'setup'` (seed +
    validate honour only `'setup'`), so re-enabling the toggle later is a small
    revert. Service code still sits behind `USE_MOCK_SERVICE = true`
- Menu polish pass: ✅ Complete — canonical `discount_details` shape, native
  `preset_tags` arrays, paginated menusections/menuitems, allergens rewired
  onto the `tags` field as the dietary-tag source of truth
- Menu modifiers & extras: ✅ Complete — menu items carry modifier groups
  (`MenuItem.options: ItemModifiers` = `{hasModifiers, groups: ModifierGroup[]}`)
  and linked add-on extras (`has_extras` + `extras: MenuItemExtraRef[]`).
  Operators edit them in the item form via two standalone tabs
  (`ItemModifiersTabComponent`, `ItemExtrasTabComponent` inside the standalone
  `ItemFormDialogComponent`); diners customise an item on the diner-app
  `menu-item-detail` screen before it hits the basket, and the restaurant-portal
  preview drawer (`PreviewMenuDrawerComponent`) mirrors the live diner UI. Both
  the diner browse card and the preview drawer now render through one shared
  `MenuDishCardComponent` (the single source of truth for the dish card).
  Real-wired through the existing menu endpoints (`restaurant-setup/menuitems/`);
  no dedicated mock flag (see Key Domain Concepts for the payload shape)
- Kitchen View (KDS board): ✅ Complete — Phase 1 (mock board UI) and Phase 3
  (live order data) both done. Separate top-level lazy module at
  `src/app/kitchen/` (route `/kitchen`, AuthGuard-protected).
  `KitchenOrderService.USE_MOCK_DATA = false`; HTTP polling + optimistic PATCH
  against real endpoints. The kitchen services (`KitchenOrderService`,
  `KitchenStockService`) scope to the **login-selected** membership
  (`AuthenticationService.currentRestaurantRole`, backed by `rest_role`), NOT
  `restaurant_roles[0]` — a user with ≥2 memberships gets the board (and the
  void-gate) for the restaurant they actually picked at login. Kitchen-only
  staff land here automatically on login:
  `LoginComponent.landingPathForMembership` routes a membership whose roles
  include `'kitchen'` but neither `'owner'` nor `'manager'` to `/kitchen`, and
  everyone else to their first accessible module (Dashboard first). The post-login
  redirect ALWAYS lands on this computed module — it no longer honors a `returnUrl`
  deep link, and neither the `AuthGuard` nor the inactivity logout captures one, so
  re-authenticating (manual sign-out OR the 15-min idle timeout) never resumes the
  last-visited module. The `/login` route itself carries `loginRedirectGuard`
  (`_helpers/login-redirect.guard.ts`): an already-authenticated user hitting
  `/login` — or the bare domain, which redirects there — is forwarded to this same
  landing via a `replaceUrl` redirect instead of being shown the form; with no
  resolvable landing (no selected membership) the form still renders. The guard has
  NO administrator branch — PR-6 removed it along with the admin plane.
  The restaurant portal sidebar now ALSO surfaces a
  **Kitchen** entry (route `/kitchen`, gated on the `kitchen` module —
  owner/manager/kitchen see it, `restaurant_staff` does not), so back-office
  staff reach the board from portal nav, not only via the login auto-redirect.
  Both logout paths (`logout()` and `logoutDueToInactivity()`) now revoke the
  refresh token server-side before clearing state — a shared `revokeAndExit()`
  POSTs the refresh to `users/auth/logout/` (via `rawHttp` to dodge the error
  interceptor's 401→`logout()` recursion, Bearer access token attached explicitly)
  so sign-out actually blacklists the token and ends the server session; a 2s
  timeout backstops the redirect if the revoke stalls, and a missing refresh token
  skips the POST (PR #597)
- Support: ✅ real-wired — the restaurant Support page (`support/`) reads/writes
  the `support/issues/` API. The Dinify-admin triage screen was deleted with the
  admin plane in PR-6; `support/admin/issues/` is now an admin-portal concern.
  Status/category/impact badge styling + labels live in `src/app/_shared/support/`
- Settings: ✅ rebuilt as a grouped hub shell (route `settings`,
  `SettingsHubComponent`) with standalone, real-wired section pages —
  Restaurant identity & branding (`settings/restaurant`, `IdentityComponent`),
  Availability (`settings/availability`, `AvailabilityComponent` —
  `accepting_orders` toggle), Team / Members (`settings/team/members`,
  `RestUsersComponent` rehomed under a `TeamShellComponent` master–detail hub at
  route `settings/team` — sub-nav gated on `nav.length > 1`, now revealed by the
  owner-only **Roles & access** grid (`settings/team/roles`, `RolesAccessComponent`)
  appended alongside Members (it inherits the team-parent RBAC guard, so it is
  owner-only by composition — no child guard); a role×module grid that reads/PUTs
  `RolePermissionsService` (the owner row is locked from the response's `editable`
  flag, never the role name); the role picker is aligned to the four backend roles
  (Owner/Manager/Chef/Staff; Staff emits `restaurant_staff`, finance + waiter
  retired) and a brand-new employee's one-time temp password is surfaced on a
  persistent, non-dismissable `StaffCredentialDialogComponent`), Tax & receipts
  (`settings/tax-receipts`, `TaxReceiptsComponent`), Billing (`settings/billing`,
  subscription-only — `BillingComponent` is the one section still in
  `declarations`, i.e. non-standalone), Account & security (`settings/account`,
  `AccountSecurityComponent`), and Preset tags (`settings/preset-tags`,
  `PresetTagsComponent`). Shared section chrome lives in `settings/components/`
  (`SectionPageComponent`, `SettingsIconComponent`); the old monolithic
  `SettingsComponent` is gone. The form-owning section pages (Restaurant identity,
  Availability, Tax & receipts, Account & security) implement `HasUnsavedChanges`
  and are protected by the shared route-level `unsavedChangesGuard`
  (`_helpers/unsaved-changes.guard.ts`, a `CanDeactivate` guard that prompts before
  navigating away with unsaved edits)
- My account page: ✅ a standalone, read-only personal profile page (route
  `account` → `AccountComponent`, title "My account") showing the signed-in
  user's Name / Email / Phone / Role / Restaurant plus a Sign-out button. It is
  DISTINCT from `settings/account` (`AccountSecurityComponent`, the
  security/password section). It is NOT module-guarded (any signed-in member
  reaches it), is opened from the account chip pinned to the bottom of the
  `SidebarComponent`, and is the `/account` landing fallback for a
  member with no accessible modules (the "No modules assigned" case). The
  shared `app-dn-avatar` (initials-in-a-circle) renders the user glyph here and
  in the sidebar chip
- Reviews: ✅ real-wired — a standalone Overview (route `reviews`,
  `ReviewsOverviewComponent`: summary line, needs-attention block, dimension
  breakdown, rating-trend chart) plus a Feed (route `reviews/feed`,
  `ReviewsFeedComponent`: list with critical/resolution/rating filters, a
  needs-attention queue, resolve/reopen with an optional resolution note, and
  deep-linking to a flagged review). Both read/write the `reviews/` API through a
  dedicated `ReviewsService` (no mock flag) with a `reviews-adapter` parsing
  layer; diners leave a review on the diner-app order-complete screen (POST
  `reviews/submit/`, gated on a real backend order id), optionally attaching
  one-tap quick-feedback chips (canonical key→label set in `_shared/reviews/`)
  that surface read-only on the operator Feed. The old monolithic
  reviews-management surface has been removed
- Reports: ✅ a master–detail shell (route `reports`, `ReportsShellComponent`)
  with a persistent date-range bar sitting above the
  `<router-outlet>` and four standalone child reports — Sales (`reports/sales`,
  the default), Menu performance (`reports/menu`), Transactions
  (`reports/transactions`), and Diners (`reports/diners`). Each report carries a
  shared CSV / XLSX / Print export bar (XLSX via the dynamically-imported
  `write-excel-file` dep; Print via a generated print sheet). Still mock-first:
  `ReportsService.USE_MOCK_DATA = true`, mirroring DashboardService, with a
  dormant `reports-adapter` parsing layer (mirrors `reviews-adapter`) over
  scaffolded real endpoints. The old monolithic `report-detail` surface is gone.
  Reports is NOT chart-free: the Sales report renders a revenue-trend LINE chart
  (`revenue-trend-card`) and a KPI rail of inline sparklines (`stat-sparkline` /
  `ReportSparklineComponent`, via `sales-kpi-rail`) on the SAME shared house
  ng2-charts / chart.js stack Dashboard uses (`provideCharts(withDefaultRegisterables())`
  registered in `RestaurantMgtModule`). The other report visualisations — Sales'
  orders-by-hour & revenue-weekday, Menu top-items, Transactions status-breakdown,
  Diners composition — are hand-rolled CSS `[style.width.%]` / `[style.height.%]`
  bars, NOT ng2-charts
- Shared timeframe core, URL-as-truth (TIMEFRAME-01A / 01B): ✅ Reports AND Dashboard
  are URL-DRIVEN and share ONE timeframe. The range model + the bucket/comparison
  engine + the state that owns them live in `src/app/_shared/timeframe/` (see Shared
  Libraries). `TimeframeService` is registered on BOTH the `reports` and `dashboard`
  ROUTES (`providers: [TimeframeService, {provide: TIMEFRAME_CONFIG, …}]`),
  deliberately NOT `providedIn:'root'` — it must only exist where a timeframe exists,
  and route providers give a shell + its children one shared instance. A third host is
  the same move again: a route registration, never a switch to root. The query string
  (`?from&to&preset`, matching the API layer's param names) is the SOURCE OF TRUTH;
  localStorage is demoted to a "last used" SEED, keyed per HOST and per restaurant.
  `TIMEFRAME_CONFIG` (`_shared/timeframe/timeframe-config.ts`) carries each host's
  `seedKey` + `defaultPreset`: Reports → `reports.dateRange:{id|global}` (the pre-01B
  key VERBATIM, so persisted seeds survived) landing on `this-month`; Dashboard →
  `dashboard.timeframe:{id|global}` landing on `today`. The two seeds are INDEPENDENT
  ON PURPOSE — Dashboard asks "how are we doing now", Reports asks "what happened over
  this period", so a Dashboard opening on last month because you did month-end
  reporting yesterday is wrong. The token's root-factory default is a NEUTRAL key
  (`timeframe.dateRange`), not Reports', so a host that forgets to register a config
  cannot silently share the Reports memo; it exists so the service stays constructible
  in a TestBed with no route. `defaultPreset` excludes `'custom'` by type.
  Entry order: valid URL params win (seed refreshed,
  URL untouched) → else a usable seed (adopted, published to the URL) → else the host's
  `defaultPreset`. A hand-edited URL never throws — it falls through to the seed and
  the URL is corrected. `preset` is carried explicitly, never re-derived from the
  dates, because it drives comparison semantics. Every write uses
  `replaceUrl: true` + `queryParamsHandling: 'merge'` — REPLACE not push, so that
  01C's period arrows can't bury the previous page under twenty history entries
  (deliberate and reversible; the arrows have since LANDED and depend on it).
  The entry URL correction is deferred one microtask past
  route activation; navigating synchronously would re-enter the router mid-cycle.
  `ReportsService.dateRange$` is GONE — read `TimeframeService.range$`, write
  `set()`.
  Period-stepping arrows (01C): ✅ the shared picker now renders `[◀] [▶] [date ▾]`, so
  BOTH hosts page the window by one period — a day steps a day, a Mon–Sun week a week,
  a calendar month a whole month respecting month lengths. The shape is derived from
  the DATES (`classifyRangeShape`, see Shared Libraries), never from `preset`.
  Selectable comparison basis, URL-backed (02A): ✅ **what a range is measured AGAINST is
  now a user SELECTION, not a consequence of the preset.** `TimeframeService` gained
  `comparison$` / `comparisonValue` / `setComparison()` beside `range$` / `set()`, and the
  picker cluster is now `[◀] [▶] [date ▾] [comparison ▾]`. The option set depends on the
  range's SHAPE (`comparisonOptionsFor`, see Shared Libraries), so the menu re-shapes as
  the range does — on BOTH hosts as of 02B. **`ReportsService.compareEnabled$` is DELETED**
  — "off" is just the `'none'` entry in the basis menu, and a separate boolean would have
  been a second answer to one question. `comparisonRange` / `comparisonRangeLabel` are
  deleted too, replaced by the single `resolveComparison`. URL params `cmp` and (02D) `cmpFrom`,
  both parsed inside `parseTimeframeParams`
  (one parser) and **OMITTED whenever the selection is the current shape's default**, so
  ordinary URLs stay as clean as they were; an unknown or shape-invalid value falls back
  and corrects the URL by REPLACE. Seeded per host under `<seedKey>.cmp:<restaurantId>`,
  so Dashboard and Reports keep independent memories exactly as they do for the range.
  On a range change the selection is re-evaluated — offered by the new shape → KEPT;
  not offered → that shape's default; `'none'` → stays `'none'` — so it survives BOTH an
  arrow step and a calendar Apply, and is never silently wiped. Every consuming surface
  **skips the comparison request entirely when the basis is `'none'`** (before 02A all four
  report tabs fetched it unconditionally).
  Dashboard adoption (02B): ✅ the Dashboard honours the selected basis too, and
  `TimeframePickerComponent`'s `showComparison` scaffolding is GONE — both hosts render the
  full `[◀] [▶] [date ▾] [comparison ▾]` cluster. It gets its baseline from a **second
  `dashboard-v2` call** for the comparison window, reading that response's `totals`; it no
  longer reads `previous_totals` at all. Two consequences worth knowing:
  **`previous_totals` and the deprecated `period` param now have NO frontend caller**,
  which unblocks their backend removal — and as of DASH-DROP-PREVIOUS-00 the frontend no
  longer TYPES them either: `previous_totals` / `previous_total` are gone from
  `RevenueData` / `OrdersData`, out of `dashboard-adapter`, and out of the mock. **That
  two-repo removal is now COMPLETE**: backend DASH-REMOVE-LEGACY-00 deleted both fields and
  the deprecated `period` parameter, and `timeframe-engine.ts`'s `previousEqualLengthPeriod`
  docstring — which used to claim parity with the server-side computation being deleted — was
  updated in step, so it now records that the mirrored formula has no backend counterpart left
  and that its long-hand arithmetic is kept deliberately rather than pending a tidy-up.
  Removals go FRONTEND-FIRST for the same
  reason additions go backend-first — the wire may stop carrying a field the client still
  declares non-optional, never the reverse. Note the frontend was already TOLERANT of the
  field vanishing (`adaptRevenueTotals` zero-fills a falsy argument), so the ordering
  prevents a silently-fabricated zero behind a non-optional type, not a crash; and the
  second call lives in its OWN subscription
  with no timer, because the 30s poll sits inside `fetchTicks` and anything in that chain
  re-fires per tick — a comparison window is always in the past, so it is fetched once per
  window change (arrow step, calendar Apply, option change) and never on a tick. The
  Dashboard classifies AND resolves from `effectiveRange`, not the raw range, so the
  baseline spans the same length the primary request measured.
  **THE COMPARISON WINDOW SPANS THE WINDOW THAT SURFACE'S PRIMARY WAS FETCHED OVER**
  (REPORTS-COMPARISON-00, closing the Reports half). The rule is same-window-as-primary,
  NOT "use `effectiveRange`" — stated the second way it gets mis-applied the next time
  someone tidies the four report tabs into agreement. **Sales** fetches its primary over
  `effectiveRange`, so it now classifies and resolves from there too (it resolved from the
  raw range before, setting a ~900-day-longer baseline beside a clamped primary above the
  annual cap); **Menu / Transactions / Diners** fetch their primaries UNCAPPED and therefore
  satisfy the invariant with the RAW range — switching them for symmetry would break it, and
  a spec on each pins that. Reachable only via a hand-crafted over-cap URL, so no visible
  change. Sales also carries the Dashboard's `isComparisonOfferedFor(shape, basis) ?
  basis : defaultComparisonFor(shape)` guard, because resolving from `effectiveRange` while
  the shared picker still builds its menu from the raw range is exactly the gap that guard
  exists to close.
  Shared layer on the fetched window (TIMEFRAME-TIDY-00): ✅ **every site that classifies a
  user-supplied range now classifies `resolveTimeframe(range).effectiveRange`** — the picker's
  `comparisonOptions` and the service's `carryComparison` / `resolveComparisonFor` / `writeUrl`.
  The last two MOVE TOGETHER by necessity: `writeUrl` omits `cmp` at the shape's default and
  `resolveComparisonFor` re-derives that default on re-entry, so splitting their windows lets
  them disagree about whether an OMITTED `cmp` meant the default. `hostDefault()` is the ONE
  site deliberately left raw — a preset's widest span is `this-year` (≤365d), so it can never
  clamp; it carries a comment saying so. Sales' consumer-side guard is KEPT as redundant
  defence — a guard that became redundant is not one that was wrong.
  **The behavioural delta is EMPTY, provably, not merely small**, and knowing why saves the
  next reader the afternoon it costs to rediscover: `matchingShapes` bounds every non-`custom`
  shape structurally (day 0, week 6, month 30, year 365 — a `year` requires
  `to === endOfYear(from)`, so no multi-year `year` exists), while the clamp branch is gated
  by the ladder's `month` rung at 731 days and only then by the 1850-day cap. No shape can
  reach the clamp, so above it the raw range and the window it clamps to are BOTH `custom`.
  Consequence for testing: the obvious spec — lower the cap under a whole calendar year so
  `year` clamps to `custom` — CANNOT WORK, because 364 days returns unclamped at the 731 rung
  whatever the cap says. The discriminating specs therefore run the other direction, a
  `custom` range clamping INTO a real shape (1460 days ending 2025-12-31, cap lowered to 364
  → exactly 2025-01-01…2025-12-31, a whole `year`), and they are the only thing that fails if
  the four sites are reverted.
  Weekday vs calendar-date pairing (02C): ✅ **at month level, HOW the two chart series are
  paired is a user choice**, separate from which window they are drawn from — a restaurant's
  Saturday does not resemble its Tuesday, so pairing July against June by calendar date sets
  Tue 7 Jul beside Sun 7 Jun and reads as a collapse that never happened. The month menu
  carries `prev-month-by-day` / `prev-month-by-date` and `prev-year-by-day` /
  `dates-last-year` — two pairs each sharing a window and differing only in `pairingFor`.
  Pairing is offered at month shapes ONLY (a day is one point; a Mon–Sun week against a
  Mon–Sun week is already weekday-aligned by position; a year buckets monthly) and applies
  only to the `day` bucket. The alignment lives in `alignComparisonSeries`
  (`reports/sales/sales-view.ts`) and reaches exactly one surface, `revenue-trend-card` —
  no other card takes a comparison SERIES. Its offset is read from each series' own first
  `key`, NOT from the window bounds — since densification the two coincide (a dense series
  opens on its window's first bucket), so this is no longer a choice between two answers; the
  data-derived form is kept because it needs no window threaded through the card and stays
  correct if ever handed a sparse series directly. The **month default is now
  `prev-month-by-day`**, i.e. weekday pairing. The Dashboard is unaffected: it renders no
  comparison series, only a headline, a badge and a caption, so pairing has nothing to act on
  there.
  Series densification: ✅ **every Sales series is now zero-filled to the window it was fetched
  over**, which is what removed 02C's internal-gap limitation. `normalizeSeries`
  (`reports/sales/sales-view.ts`) takes a REQUIRED third `window` argument — the primary series
  fills to `tf.effectiveRange` (never the raw range: the over-cap clamp moves `from`, and filling
  to the raw range fabricates buckets that were never requested), the comparison series to
  `p.cmp`. **`p.cmp`'s NULLNESS is load-bearing** — `cmpRows` is empty both when the basis is
  `'none'` (no request was ever made) and when a real window had no trade, and only the window
  argument tells them apart; `null` means DO NOT densify, which is the only escape hatch. The
  `hour` bucket is exempt (already dense by contract on both paths, and its key is `'0'…'23'`
  with no date to enumerate). A bucket outside the window is DROPPED — the window defines the
  series. Two knock-ons worth knowing: `points.length` used to mean "buckets that traded" purely
  because the series was sparse, so every site reading it that way now goes through the explicit
  `tradingBuckets` predicate (the trend card's "Daily avg" divisor and its empty-state gate) —
  the axis changed, no displayed number did; and the **AOV sparkline emits `null`, not `0`, for a
  zero-order bucket**, because with no orders there is nothing to average and a 0 would draw a
  steady-ticket restaurant as violently volatile (Orders and Discounts keep zeros — those are
  true). **The matching Dashboard gap is now CLOSED FROM THE SERVER, not here** (backend
  BUCKETS-ZEROFILL-00): `dashboard-adapter.ts`'s `adaptRevenueSeries` still does not densify,
  but `dashboard-v2` now returns BOTH its series (`revenue`, `orders`) dense over the requested
  window, so there is nothing left for the adapter to fill. This was carried as a flip-time
  hazard until the backend change landed; it is no longer one. What survives is a DEPENDENCY
  worth naming — the Dashboard's density is the producer's guarantee, whereas Sales owns its own
  via `normalizeSeries`. If that server guarantee is ever narrowed, the Dashboard gap reopens
  and the adapter (whose keys are ISO datetimes, not `yyyy-MM-dd`, and which would need the
  window threaded in) is where it would have to be closed
  A user-placed comparison window (02D): ✅ **`'custom'` lets the operator put the comparison
  window where they like**, instead of choosing from bases the primary range derives — the
  "compare this month against the month we ran the promotion" question, which is about position,
  not duration. Offered by EVERY shape and always LAST in the menu (last is load-bearing:
  `defaultComparisonFor` reads index 1, so appending it moves no shape's default; offered
  everywhere is what makes a placed window survive a shape change untouched).
  **THE WINDOW IS EQUAL LENGTH, and only its START is state** — anywhere: the URL (`cmpFrom`),
  the seed (`<seedKey>.cmpFrom:<restaurantId>`) and the service all carry one date. The end is
  derived in `resolveComparison` on every read, from the primary's inclusive length. That is not
  a restriction wearing a disguise: a percentage between a 2-day total and a 10-day total measures
  duration rather than performance, 02C's pairing offset indexes two parallel arrays, and the axis
  has to keep representing the selected range. It is also what makes stepping work — an arrow step
  across a 31 → 30 month boundary re-derives the end and leaves the start alone, with no guard and
  nothing to silently rewrite. `resolveComparison` gained a fourth `customFrom` argument (all five
  callers pass `undefined` for `now`); an absent or invalid start yields `null`, the exact path
  `'none'` takes, so no consumer needs a branch for "chosen but not yet placed".
  **`maxCustomComparisonStart` is THE bound, and it is ONE bound, not two.** The window is
  `[s, s + L − 1]`; non-overlap needs `s + L − 1 < range.from` and not-future needs
  `s + L − 1 ≤ today`, and since `presetToRange` clamps every range to `≤ today`, the first
  STRICTLY IMPLIES the second. So the calendar takes a single `max` and needs no per-date
  predicate — do not re-add an overlap check beside it believing `max` only covers the future rule.
  A start past the bound is DROPPED, never clamped. `RangeCalendarComponent` gained `mode`
  (`'range'` | `'single'`) and `max` (defaulting to `today`), so the range path is unchanged —
  all 8 of its pre-existing specs pass untouched. The picker's `comparisonChange` now emits
  `{option, customFrom?}` and `setComparison(option, customFrom?)` commits both in ONE write:
  two writes would expose a frame where the basis reads `custom` against a stale window and every
  consumer pipeline would fetch it. `'Custom period'` is the one menu entry that does NOT commit
  on pick — it opens a staged single-date panel (`ComparisonStartPanelComponent`) and commits on
  Apply; the trigger then shows `Custom period · 4–30 Jun`, dates for this basis ONLY (every other
  basis's name already determines its window; this is the only one whose window silently
  re-derives on a step). `'custom'` is excluded from BOTH engine invariants — from the
  distinctness sweep because a user-supplied window matching another basis is the user's own
  choice, and from the non-overlap sweep because it cannot be swept deterministically; a targeted
  spec asserts non-overlap for every start the calendar allows and overlap for the first it blocks
  `tables-card`'s `trend-indicator` tiles are deliberately
  OUTSIDE the comparison basis — they compare `turns_today` / `avg_ticket_today` against
  their `*_yesterday` server fields, which are anchored to yesterday rather than derived
  from the selected range.
  **The Dashboard's coarse `'day'|'week'|'month'|'ytd'` enum is DELETED** (01B), along
  with `DashboardService.dateRange$` / `isDashboardActive$` and the component's
  `computeDateRange()`. The two-timeframe-systems state is over. The picker moved to
  `_shared/timeframe/picker/` as `TimeframePickerComponent` /
  `app-timeframe-picker` (renamed off `report-date-range` — it serves two hosts now);
  `date-range-panel`, `range-calendar` and `range-label` moved with it and keep their
  names. The barrel exports the PICKER ONLY — the panel and calendar carry non-obvious
  contracts and stay internal. **Inside `_shared/timeframe/` (picker included) import
  siblings by DIRECT PATH, never the barrel** — the barrel re-exports the picker, so a
  barrel import from inside is a cycle that does not fail the build and instead
  surfaces as an `undefined` at module-init.
  Known characteristic, pre-existing since 01A and true of BOTH hosts: Angular caches
  a route's EnvironmentInjector against the route CONFIG, so returning to a timeframe
  host REUSES the service — `resolveOnEntry` runs once per app load. The in-memory
  range survives a Dashboard → Menu → Dashboard round trip (picker and data stay
  correct) but the URL is not re-published, so it reads bare. Pinned by
  `restaurant-mgt/timeframe-host-isolation.spec.ts`.
  `presetToRange` now CLAMPS the in-progress presets (`this-week` / `this-month` /
  `this-year`) to end at TODAY — a range never extends into the future, so the
  landing range is month-to-date. `today`/`yesterday`/`last-*`/`custom` are unchanged.
  Consequence to know: on the opening day(s) of a period the clamped span is ≤1 day,
  so the engine's ladder buckets it by HOUR (on a Monday, "This week" renders the
  hour-of-day view — the same treatment `today` gets)
- Payments: removed — the standalone restaurant Payments module (its real
  transactions listing plus the dead Falcon wallet UI: Disburse Funds,
  DinifyAccount balance) has been deleted. There is no `payments` route or
  sidebar entry; the `reports/restaurant/transactions-listing/` data now backs
  the Reports module's Transactions report instead
- Notifications: scaffolded and routed (route `notifications`,
  `RestNotificationsComponent`) — per-view data-wiring status varies
- Offline/connectivity UX: ✅ a `ConnectivityService` (`navigator.onLine`) drives a
  persistent `OfflineBannerComponent` in the restaurant portal shell (its only
  host now that the admin plane has left) and an `OfflineStripComponent` in the
  diner app. The HTTP error interceptor surfaces request failures as toasts via
  `ToastService` (the legacy
  `MessageService` banner is retired) and suppresses its global 'no network' toast
  where a banner already shows (see error-handling note below)
- Legal pages: standalone components in `src/app/legal/` (privacy-policy,
  terms-and-conditions, cookie-policy), lazy-loaded as public routes
  `/privacy`, `/terms`, `/cookies` via `loadComponent` in `app-routing.module.ts`
- The legacy Falcon Orders page has been removed — there is no Orders route,
  component, or sidebar entry in the restaurant portal. Live order/fulfilment
  flow lives in the Kitchen View (KDS board) at `/kitchen`. The diner app's
  parked OrdersComponent (another dead Falcon payment screen) has likewise been
  removed
- Tenant-isolation closure (frontend regression gate): ✅ a focused
  `src/app/_security/` layer pins the client-side tenant-boundary invariants.
  `diner-capability-contract.ts` is the single source of truth for the diner
  capability header names + the EXACT first-party route allowlist and its pure
  `classifyDinerCapabilityRequest` classifier (imported by the
  `DinerSessionInterceptor`); `tenant-isolation-closure.spec.ts` is a
  cross-cutting matrix — header-only capability transport, diner/JWT channel
  exclusivity, no raw-UUID authority, no id-in-body, QR-credential non-emptiness,
  single-guarded QR rotation, login-selected restaurant scope, and cross-repo
  contract parity with the backend. It runs in CI (and `scripts/verify.sh`) as a
  dedicated fail-fast `npm run test:tenant-boundary` gate BEFORE the full suite.
  The engineering closure record is `docs/TENANT_ISOLATION_CLOSURE.md`
  (counterpart to the backend PR6A record) — refresh it when the diner capability
  transport, the `?c=` capture, the QR URL/rotation flow, the order-request
  builders, the selected-restaurant scoping, or the cross-repo contract constants
  change
- Platform-role vocabulary — REMOVED (Closure PR 1, frontend half): ✅ nothing in this
  app derives authority from the account-level `profile.roles` array any more. Four
  production sites did: the `/kitchen` route's `data.roles`, the
  `KITCHEN_ROUTE_TOP_LEVEL_ROLES` mirror in `login-redirect.guard.ts`, a
  `canChangeBillingDate` getter revealing a Cash payment option, and the two first-time
  menu-approval buttons. **`AuthGuard`'s `hasTopLevelRole` branch went with them** — it
  was the mechanism by which a `data.roles` string granted route access, so `data.roles`
  now feeds ONLY the `restaurant_staff` membership bridge. Consequence to know: an
  account whose `profile.roles` carries a matching string but holds ZERO active
  memberships no longer passes `AuthGuard`. That is the intended tightening — a
  deactivated employee should not reach the portal shell. Route authority is
  `data.restaurant_roles` (checked against every membership) plus that bridge; nothing
  else. `/kitchen` carries NO `data.roles` at all, and
  `restaurant_roles:['owner','manager','kitchen']` is what admits — the guard's
  `if (roles || restaurant_roles)` still fires on the truthy array, so it stays gated.
  Held by a standing source gate, `scripts/check-platform-roles.mjs` (FE-AUTH-00) —
  see the Verification section
- Dead-code closure (frontend audit program): ✅ the dependency-hygiene +
  dead-code-removal program is closed and recorded in `docs/DEAD_CODE_CLOSURE.md`
  (the sibling of `TENANT_ISOLATION_CLOSURE.md`). It records what was removed AND
  what was deliberately KEPT — the `_security/` layer and tenant-boundary specs,
  the dormant `USE_MOCK` seams (product state, not oversights), the parked Tables
  Service View, the Tailwind tokens, and `ConfirmDialogComponent`. Read the
  "deliberate keeps" list before deleting anything that merely looks unused, and
  refresh the record when those keeps change

## Deployment Rules — CRITICAL
- Pushing to main triggers automatic Firebase deployment via GitHub Actions
- NEVER suggest manual deployment steps — the pipeline handles everything
- Each feature must be on its own branch → PR → merge
- Never stack work on unmerged branches

## Branch Selection — CRITICAL
- When the task text (the prompt provided for the task) names a specific
  branch, ALWAYS develop on and push to THAT branch — the branch named in the
  task text is authoritative and takes precedence over the session-designated
  branch
- Do NOT default to the session-designated branch (the auto-generated
  `claude/...` branch injected into the session/environment setup) when the
  task text names a different branch
- The session-designated branch is only the fallback for when the task text
  does not name a branch at all

## Branch Base — CRITICAL (never branch off a stale `main`)
- Before creating a feature branch, ALWAYS `git fetch origin main` first, then cut
  the branch from `origin/main` (e.g. `git checkout -b <new-branch> origin/main`).
  NEVER branch from the local `main` ref: in a freshly-cloned web container it can
  be stale (behind the real remote), silently basing your work on outdated code —
  this is how PR #395 was first cut from a 59-commit-old `main`.
- A `SessionStart` hook (`.claude/hooks/session-start.sh`, registered in
  `.claude/settings.json`) auto-runs `git fetch origin main` (and installs node deps)
  each web session — but still branch explicitly from the fetched `origin/main`, not
  local `main`.
- If you discover mid-task that the base was stale, `git rebase origin/main` and
  re-run verification before pushing.

## Component Pattern — CRITICAL
The module uses a deliberate mixed pattern — follow it exactly:
- Older components (DashboardComponent, MenuComponent, SupportComponent,
  BillingComponent, RestNotificationsComponent) are NON-standalone — they go in
  `declarations` (that is the current full `RestaurantMgtModule.declarations`
  set; the old ReportsComponent/ReviewsComponent have been replaced by
  standalone components)
- Newer components (SidebarComponent, TopNavComponent, TablesComponent,
  all shared UI components) are STANDALONE — they go in `imports`
- When creating a new component, make it standalone and add it to `imports`
- Never put a standalone component in `declarations`. The AOT production
  build (`npm run build:prod`) already guards this: it fails with error
  **NG6008** ("Component … is standalone, and cannot be declared in an
  NgModule. Did you mean to import it instead?"), and CI runs `build:prod`
  on every PR. Note `npm run type-check` does NOT catch it (plain `tsc`
  doesn't run the Angular compiler), so the prod build is the real gate.
  (Verified 2026-06; supersedes the earlier "silently renders an empty
  element" note, which does not hold for the AOT prod build — so no
  separate lint/CI guard is needed.)
- A lazy feature module may host a STANDALONE root component resolved
  directly by the router with an empty (or absent) `declarations` array —
  see `KitchenModule`/`BoardComponent` (mirrors the diner-app pattern)
- The portal SHELL itself (`RestaurantMgtComponent`) is now STANDALONE too — it
  is referenced by the root route in `app-routing.module.ts` and declares its own
  `imports` (`SidebarComponent`, `TopNavComponent`, `OfflineBannerComponent`,
  `RouterOutlet`), so it is NOT in any module's `declarations`. Only the five
  older feature components above remain non-standalone

## Shared UI Component Library
A shared component library lives in `src/app/_shared/ui/`:
allergen-disclaimer, avatar (`app-dn-avatar`, initials-in-a-circle), badge,
button (`app-dn-button`), card, dialog, discount-badge, extras-selector,
featured-carousel, menu-dish-card, modifier-groups-selector,
no-baseline-chip (`app-no-baseline-chip`), offline-banner,
page-header (`app-page-header`), price-display, savings-indicator,
segmented (`app-dn-segmented`), sheet, switch (`app-dn-switch`; supports a
`disabled` input for locked toggles, e.g. the Roles & access owner row), toast —
plus the `tooltip` directive (`[appTooltip]`, not a component), the
`SafeArrayPipe`, and the `HighlightPipe` (search-term highlighting). The
`toast/` folder also exports the injectable `ToastService` (the app-wide toast
queue), re-exported from the barrel.

`app-no-baseline-chip` is THE empty state for a trend badge with no usable
baseline — the neutral grey "New" pill, rendered by BOTH hosts since
REPORTS-COMPARISON-00 (the Dashboard badges and the Reports `delta-chip`, which
inlined a duplicate copy until then). Pair it with `percentChange` (see
`_shared/utils/` below): when that returns `null` the badge is REPLACED by this
chip, never merely hidden, and any comparison caption must stay visible BESIDE
it rather than nested inside the badge (nesting is what made the caption vanish
with the badge in the first place). ONE EXCEPTION, deliberate: the Reports
`delta-chip` renders NOTHING on a NEGATIVE baseline rather than this pill,
because "New" claims there is no history and the restaurant did trade — it just
netted below zero. The Dashboard badges still show "New" there. Both agree there
is no number; they differ only on what to draw in its place.

`app-dn-segmented` is the single shared segmented / tab control — it REPLACED
the deleted `dn-tabs` component (do not reintroduce a `tabs` component). It runs
in two modes: `mode="value"` (the default — emits the picked value; used for
in-page toggles like the dashboard card sort switches and the item-form tabs)
and `mode="router"` (each segment is a `routerLink`, for route-driven rails like
the Reports shell). In router mode it takes an optional `queryParamsHandling` —
UNBOUND MEANS ANGULAR'S DEFAULT, WHICH DROPS QUERY PARAMS on every segment click.
Any rail whose siblings share URL state must pass `'merge'` (the Reports shell does,
so the timeframe survives a tab switch); it fails silently otherwise, which is why
`reports-timeframe-navigation.spec.ts` pins it. `app-page-header` is the shared
portal page-title block (its
Gabarito heading comes from the `app-restaurant-mgt h1` selector, plus an
optional subtitle and a right-aligned actions slot) — reuse it for portal page
titles instead of hand-rolling an `<h1>`. All portal buttons/CTAs are unified on
`app-dn-button` (selector `app-dn-button, button[app-dn-button]`).

The diner price surfaces share a presentational trio (all in `_shared/ui/`,
re-exported from the barrel): `app-price-display` (bold brand-red effective price
beside a struck grey original; sizes sm→lg, optional `+` prefix for add-ons),
`app-discount-badge` ("X% off" green pill — `frosted` hero / `solid` overlay
variants, optional `· Save UGX Y` suffix), and `app-savings-indicator`
("Save UGX X" pill / "Total savings" banner). All three are pure (numbers in,
formatted via the shared `formatUGX`; no item objects, discount-gate or fetch
logic) and back item-detail, the menu card, the featured carousel and the basket
from the canonical server-truth `discount_details`. Reuse them before
hand-rolling any price / discount / savings markup.

The menu / item-customisation surfaces share three more presentational
components (all in `_shared/ui/`, re-exported from the barrel):
`app-menu-dish-card` (the single source of truth for BOTH the diner browse card
and the restaurant-portal preview drawer — takes pre-resolved
name/price/discount/tags and emits one `(cardClick)`), `app-modifier-groups-selector`
(the single/multi modifier-choice UI) and `app-extras-selector` (the "Add Extras"
checkbox list). Like the price trio they are pure — the host owns all selection
state, validation and inline-error text and feeds `selected`/`errors` in. Reuse
them on both the diner item-detail and the preview drawer so the two surfaces
never drift.

Re-exports live in `src/app/_shared/ui/index.ts` — but the barrel does NOT
re-export `FeaturedCarouselComponent`, the tooltip directive, or
`HighlightPipe`; import those from their own file paths. Always use these
existing components before creating new ones. They are all standalone and
go in the module `imports` array.

Five more reuse-first libraries sit alongside `ui/` — check them before
writing new tag, price/menu or date-range logic:
- `src/app/_shared/timeframe/` (barrel `index.ts` — THE only import path FOR OUTSIDE
  CONSUMERS; there is deliberately no re-export shim left in `reports/`) — the shared
  timeframe core, relocated out of Reports in TIMEFRAME-01A and adopted by Dashboard
  in 01B:
  - the range model (`timeframe-range.ts`): `ReportPreset`, `ReportDateRange`,
    `REPORT_PRESETS`, `presetToRange` (clamps in-progress presets to today),
    `defaultRange` (month-to-date), `isValidReportDateRange` (shape only — used as the
    localStorage seed validator), `isFutureDated` (the separate recency rule),
    `rangeIncludesToday` (the two-sided "is this range still OPEN?" predicate that gates
    the Dashboard's polling), and
    `parseTimeframeParams` (the fail-soft URL-param parser: real-date round-trip check,
    `from <= to`, neither bound future, unknown `preset` → `'custom'`, unknown `cmp` →
    absent, never throws — it is THE one place an untrusted timeframe URL is made safe,
    so a new param joins it rather than getting a parser of its own)
  - the comparison vocabulary (`comparison-option.ts`, 02A; pairing added in 02C):
    `ComparisonOption` (`none` / `prev-period` / `prev-day` / `prev-week` /
    `prev-month-by-day` / `prev-month-by-date` / `prev-year` / `prev-year-by-day` /
    `dates-last-year`), `COMPARISON_OPTIONS`, `SeriesPairing` + `pairingFor`, and
    THE ONE LABEL SOURCE —
    `comparisonOptionLabel` (menu) + `comparisonCaption` (delta-chip), over a single
    table. It replaced FIVE vocabularies: four byte-identical per-tab `COMPARISON_LABELS`
    maps and the engine's `comparisonRangeLabel`. **Zero imports, deliberately** — the
    range model must validate `cmp` but can never import the engine (the engine imports
    it), so the vocabulary lives in a leaf module and the graph stays a DAG
  - the engine (`timeframe-engine.ts`): `resolveTimeframe` (the span ladder
    hour→day→**week**→month→year + the over-cap clamp), `resolveComparison`,
    `comparisonOptionsFor`, `defaultComparisonFor`, `isComparisonOfferedFor`,
    `previousEqualLengthPeriod`, `SALES_TRENDS_CAP_DAYS`,
    `HOURLY_MAX_DAYS`, `BUCKET_TO_CATEGORY`, `ReportBucketUnit`, `SalesTrendsCategory`.
    **LADDER THRESHOLDS ARE A SEPARATE MAP FROM THE BACKEND CAPS** (LADDER-WEEK-00), and
    which one you touch matters. `SALES_TRENDS_CAP_DAYS` mirrors what the SERVER ACCEPTS
    and drives the over-cap clamp; the module-private `LADDER_MAX_DAYS`
    (hour 1 / day 31 / **week 92** / month 731) is where the FRONTEND changes bucket for
    LEGIBILITY, and it is what `resolveTimeframe` reads. Until the weekly rung landed one
    map served as both, which worked only because each cap happened to be a sensible
    switch point — an accident, not a design. `weekly` is where it ran out: its cap is
    **371 days**, set deliberately generous to bound query cost, so reading it as a
    threshold would render every range up to a year as 53 weekly points and leave `month`
    unreachable below that. 92 (≈ a quarter, ~13 points) is a legibility judgement.
    `year` has no threshold entry — it is the last rung, so its boundary IS the annual cap,
    and the clamp still targets that cap and nothing else. A new bucket needs an entry in
    `LADDER_MAX_DAYS`; a new server limit needs one in `SALES_TRENDS_CAP_DAYS`.
    Consequence worth knowing: 32–92 day ranges now render ~9–13 weekly points instead of
    two or three monthly ones, and `this-year` between roughly 1 Feb and 2 Apr is the one
    PRESET the change moves (every other affected range is `custom`). The weekly bucket is
    **Monday-anchored on both sides**, keyed as the Monday's `yyyy-MM-dd` — the same key
    FORMAT as `day`, so every label carries a `w/c` prefix (`w/c 20 Jul`) to stay
    distinguishable from a single day's takings. `bucketKeysIn` (`sales/sales-view.ts`)
    enumerates it via `eachWeekOfInterval(…, {weekStartsOn: 1})` and **must enumerate from
    the Monday CONTAINING `from`, not from `from`** — a window opening mid-week has a first
    bucket keyed up to six days BEFORE it, so pre-advancing `start` leaves every returned
    key unmatched and densifies the whole chart to zero with no error. That is also why the
    `normalizeSeries` docstring no longer claims an out-of-window bucket "cannot occur".
    `week` falls to INDEX pairing in `alignComparisonSeries` and that is correct, not
    incidental: both series are Monday-anchored, so index *i* is the *i*-th Monday in each
    — do not extend the `bucketUnit === 'day'` guard to cover it.
    `resolveComparison` is **THE ONE comparison-window resolver** — the preset-keyed
    `comparisonRange` / `comparisonRangeLabel` pair it replaced is gone; do not add a
    second entry point. Its option sets key off SHAPE: day → prev-day/prev-week/
    prev-year/dates-last-year; week* → prev-week/prev-year/dates-last-year; **month* →
    prev-month-by-day/prev-month-by-date/prev-year-by-day/dates-last-year** (02C);
    year* → prev-year only; custom → prev-period.
    Each shape's default is its first non-`none` entry (never `none` — Reports has always
    shown a comparison). No set holds two entries resolving to the same window AND pairing
    it the same way — 02C **loosened that invariant from "window" to "(window, pairing)"**,
    because the month sets now carry two pairs sharing a window on purpose. Three rules
    worth knowing: **month-to-date
    compares PARTIAL-TO-PARTIAL** (1–26 Jul → 1–26 Jun, clamped into a shorter prior
    month; a complete month still compares to the complete prior one) — changed in 02A
    because a 26-day total against a complete 30-day month always read as a collapse for
    arithmetic rather than trading reasons; **`prev-year` is weekday-aligned (364
    days) below MONTH level but CALENDAR-aligned from month level up** (year shapes in 02A,
    month shapes in 02C) — a 364-day shift straddles a month boundary, giving July a window
    that mixes July and August takings, and on a year it overlaps the range itself; and
    **`prev-year` and `prev-year-by-day` are DIFFERENT WINDOWS, not two spellings of one** —
    the bare 364-day shift below month level, the same calendar month at month level. That
    is the most confusable pair in the vocabulary and it is spelled out at the declaration.
    **`resolveComparison` and `previousEqualLengthPeriod` are NOT interchangeable** —
    the first answers "what did the USER choose", the second mirrors the
    `dashboard-v2` backend formula exactly (`prev_from = from − ((to−from)+1d)`,
    `prev_to = from − 1d`) and is what the Dashboard cards must use. Mixing them
    produces a frontend delta measured against a different window than the backend
    total it is compared to — a wrong number with no error attached. Change
    `previousEqualLengthPeriod` in lockstep with the backend, never alone. The
    dependency runs ONE way: `resolveComparison`'s `prev-period` delegates to it (that
    helper is the only home of equal-length arithmetic), never the reverse.
    The engine ALSO owns period stepping (01C): `classifyRangeShape` →
    `RangeShape` (`day`/`week`/`week-to-date`/`month`/`month-to-date`/`year`/
    `year-to-date`/`custom`) and `stepRange(range, ±1, now)`, plus
    `nextEqualLengthPeriod` — the exact, spec-pinned INVERSE of
    `previousEqualLengthPeriod`. Those two are the ONLY place equal-length stepping
    arithmetic lives; do not re-derive an offset anywhere else (the reference model
    this was built from offsets `from` by the INCLUSIVE length, so its window grows a
    day on every click, in both directions — pinned absent). Shape comes from the
    DATES, never the preset: two steps back from `this-month` reads `custom` while the
    range is still a real calendar month, and equal-length stepping would then be wrong
    the moment month lengths differ. The ONE scoped exception is a genuine tie — on the
    1st of a period, `today` and `this-month` produce byte-identical dates — where
    `preset` picks the period level; that requires `to === today`, so it cannot
    propagate into a backward-stepped range. `stepRange` steps into the past as the
    COMPLETE natural period (month-to-date back → all of last month) and clamps the END
    (never the start, never a collapse to "Today") going forward. **The comparison
    vocabulary keys off `classifyRangeShape`, not `preset`** (02A, shipped)
  - `TIMEFRAME_CONFIG` + `TimeframeConfig` — the per-host `seedKey` / `defaultPreset`
    (see the timeframe bullet in Current Implementation Status)
  - `TimeframeService` — the URL-backed state. ROUTE-scoped, not root. Registering it
    (with a config) on a new route is how a third surface adopts it
  - `picker/` — `TimeframePickerComponent` (`app-timeframe-picker`), the shared
    timeframe control, plus its internal `date-range-panel` / `range-calendar` /
    `range-label`. Only the picker is barrel-exported. It owns NO committed state
    (`value`/`comparison` in, `valueChange`/`comparisonChange` out), which is what lets
    one component serve both hosts.
    Since 01C it renders a control cluster — `[◀] [▶] [date button ▾]` — where the
    arrows step by `stepRange` and the forward one carries a real `disabled` at the
    present. They commit through the SAME `valueChange` as the staged picker (no second
    `@Output`), which is why both hosts inherited them with no host-side change.
    02A appended a `[comparison ▾]` dropdown (a second CDK overlay with its own
    `panelClass`; listbox a11y + Arrow/Home/End/Escape). That one DOES carry a second
    `@Output`, and it is not a reversal of the note above: an arrow emits a new RANGE,
    which `valueChange` already expresses, whereas a basis is separate state. 02B deleted
    the `showComparison` flag that briefly gated it — both hosts render the full cluster,
    and a flag true at every call site is dead config.
    **ALL THREE overlays this control opens — the calendar, the comparison menu and 02D's
    custom-start calendar — share ONE position ladder**, a module-level factory called once
    into a single field, and the specs pin REFERENCE IDENTITY between the three call sites
    (a deep-equal but separately-built array fails). That is not fussiness: the three
    previously hand-maintained their own copies, had already drifted apart on `withPush`,
    and the identity assertion is what stops the next positioning change from fixing one
    overlay and missing the others. Positions run **end-aligned first**, then the
    start-aligned pair. End-first is load-bearing for the Dashboard, whose cluster sits in
    the right-aligned page-header actions slot where a start-aligned 618px calendar
    overflowed the frame at every viewport width (the trigger is pinned to the content
    column's right edge, so widening the window moves the panel with it). The start-aligned
    pair is a REAL fallback, not decoration — Reports puts the control at the LEFT of its
    date bar, where CDK falls through to it and that host's placement is unchanged. Push is
    on as the backstop; flexible dimensions stay OFF, since a two-month calendar that
    reflows to fit is worse than one that repositions.
    **WHICH of the three gets a sheet host below the breakpoint is a DELIBERATE
    asymmetry, and both halves are recorded here so the next tidy-up does not "fix" it**
    (PICKER-SHEET-A11Y-00). The two CALENDARS — the range panel, and since this change the
    custom-period panel — mount inside `<app-dn-sheet side="bottom">` in the template below
    1024px and in a CDK Overlay above it, chosen in `open()` / `openCustomStart()` off the
    one shared `isDesktop`. The `variant` input is **STYLING ONLY**: `variant="sheet"` tells
    the panel to DROP `cdkTrapFocus` / `role="dialog"` / `aria-modal` / its `aria-label`
    because a host supplies them, so passing it without a sheet — which is what 02D did at
    every width — silently strips the dialog semantics rather than restyling anything.
    (Escape and backdrop dismissal still worked there; they came off the OverlayRef. What
    was missing was the trap, the role and the accessible name.) The custom-period sheet's
    `@if` carries the open flag as well as `!isDesktop`, because projected content is
    instantiated eagerly and a single long-lived panel would keep a cancelled staged start
    across opens, where the desktop portal is fresh each time. The COMPARISON MENU stays an
    anchored overlay at EVERY width, by the same 02A decision that created it: five short
    items, single-select, applying immediately — a menu, not a dialog, so it gets
    `role="listbox"` + roving tabindex and no sheet. A spec pins each half.
    Known gap, NOT closed by that change: neither range-calendar path restores focus to the
    trigger explicitly — both rely on `CdkTrapFocus.ngOnDestroy` doing it — whereas the
    comparison menu and the custom-period panel both call `cmpTriggerEl.focus()` on close.
    A code comment on `closeComparison` has named this since 02A; it is a separate follow-up
  The identifiers keep their `Report*` prefixes ON PURPOSE — they were named to avoid
  colliding with the dashboard's coarse enum. That enum is now gone (01B), so a rename
  is finally possible, but it is a wide mechanical diff and has not been done.
  Reports-specific types (`ReportKey`, `ReportGranularity`, row / column / summary
  types) stayed behind in `reports/models/reports.models.ts`
- `src/app/_shared/tags/` (barrel `index.ts`) — the dietary-tag system:
  `TagColour`/`TagIcon`/`TagCategory`, `TAG_COLOUR_PALETTE`, `TAG_ICONS`,
  `TAG_CATEGORIES`, `TagPillComponent`, `TagOverflowPillComponent`,
  `MenuItemTagSelectorComponent`, plus `filterMenuItems` and truncation helpers
- `src/app/_shared/utils/` (per-file imports, no barrel) — `cn`, `formatUGX`,
  price/discount helpers (`getCurrentPrice`, `isDiscountActive`,
  `calculateSavings`, `getDiscountBadgeText`), `searchMenuItems` /
  `applyMenuSort`, and `percentChange` — the ONE period-over-period delta
  predicate. It returns `null` whenever the baseline cannot support a percentage
  (`0`, `null`/`undefined`, non-finite, or NEGATIVE), because a badge that says
  "0.0% ▲" for a restaurant that went from no trade to UGX 2M is a false
  statement, and a negative denominator sign-flips a recovery into a red
  decline. Its docstring carries BOTH the qualifying rule for which components
  must route through it (divides by a baseline it holds → in scope; renders a
  percentage the SERVER computed → report, don't fix; direction-only arrow → leave
  alone; percentage of a capacity → not a delta) AND a census of every baseline
  predicate in the repo. **It is now the ONLY baseline predicate app-wide**
  (REPORTS-COMPARISON-00): the Reports `delta-chip` held a fourth with no
  negative gate — rendering a sign-flipped chip where the Dashboard suppressed —
  and now delegates here like `revenue-card`, `total-orders-card` and
  `trend-indicator`. A new site that divides by a baseline it holds joins the
  census rather than starting a fifth answer. `delta-chip` keeps ONE local
  predicate, `baselineIsNegative`, which asks only WHY the result is null (to
  split the "New" pill from rendering nothing) and never WHETHER
- `src/app/_shared/support/` (barrel `index.ts`) — support-issue display
  metadata: `STATUS_META`/`CATEGORY_LABEL`/`IMPACT_LABEL` maps, the matching
  `statusMeta`/`categoryLabel`/`impactLabel` helpers, and
  `CATEGORY_OPTIONS`/`IMPACT_OPTIONS`. Its only consumer since the admin plane
  left is the restaurant Support page — still reuse it before hand-rolling status
  badges or category labels
- `src/app/_shared/reviews/` (per-file imports, no barrel) — the diner
  quick-feedback chip taxonomy: `ReviewTagChip`, the canonical `REVIEW_TAG_CHIPS`
  set, and the `reviewTagLabel` key→label helper (unknown keys are humanized so
  a never-before-seen key still renders a clean badge). Chips are persisted as
  stable keys; the diner order-complete screen renders the tappable chip set and
  the operator Reviews feed renders the stored keys back as read-only labels.
  Distinct from the dietary-tag system in `_shared/tags/` — do not conflate the
  two taxonomies

## Angular Rules
- Always set `outputHashing: "all"` across ALL build configurations
- Never use lucide-angular — use inline SVGs instead. The dependency was
  REMOVED in PR-6 along with its only importer (the deleted `dinify-mgt`
  module); do not reintroduce it. `ngx-currency` went the same way.
- chart.js + ng2-charts is the ONE charting stack. The apexcharts / ng-apexcharts
  stack and the `_common/common-chart` wrapper it fed were retired in the
  dead-code pass — do not reintroduce either, and do not add a second charting
  dependency for a new surface
- QR rendering uses the raw `qrcode` package, now a DIRECT dependency. The
  `angularx-qrcode` Angular wrapper was removed (it was imported but its
  `<qrcode>` selector rendered nowhere), which also cleared one of the two
  Angular 22 upgrade blockers (`lucide-angular` was the other, removed in PR-6).
  Both are gone and **the Angular 22 upgrade has since LANDED** — do not
  reintroduce either
- **Every component MUST state `changeDetection` explicitly.** Angular 22 changed
  the compiled default: `changeDetection: decl.changeDetection ?? OnPush`, so a
  decorator that omits it is now OnPush, NOT Default. This app was written against
  Default, so the upgrade pinned `ChangeDetectionStrategy.Default` on all 150
  components (plus 8 spec-local host components) that had omitted it — that is
  behaviour preservation, not an endorsement. A NEW component that omits the field
  silently gets OnPush and will not re-render on plain field mutation, which no
  compiler or lint error reports. angular-eslint v22's
  `prefer-on-push-component-change-detection` is turned OFF in `eslint.config.js`
  for exactly this reason (same opt-out spirit as `prefer-standalone` /
  `prefer-inject`). Adopting OnPush properly is a separate, deliberate project:
  it needs a per-component audit of every async mutation, since a `Default`
  component updating from an HTTP/timer callback stops re-rendering under OnPush
  unless something marks it dirty
- Templates use Angular's built-in control flow (`@if` / `@for` / `@switch`) —
  the Angular 21 upgrade ran the control-flow migration across the app's
  templates (a handful of legacy `*ngIf`/`*ngFor` holdouts remain). Prefer the
  built-in blocks in any new or edited template; do not reach back for the
  structural directives

## Styling Rules
- `overflow-hidden` on layout containers is intentional — it is part of the
  intended layout design. Do not remove it to fix visual clipping issues
- Collapse toggle elements must be inside a `relative` wrapper div
- Typography — three variable fonts are imported in `src/styles.css`, each
  with a distinct role. Plus Jakarta Sans is the default body (`font-sans`);
  the `font-display` Tailwind utility maps to Bricolage Grotesque (used by the
  diner app, Kitchen board, login, and the shared featured-carousel). The
  restaurant portal layers a Gabarito display tier on top via a raw CSS rule —
  `app-restaurant-mgt h1/h2/h3` and `app-animated-number` (dashboard metric
  numbers) render in Gabarito, applied BY SELECTOR, not via `font-display`. In
  restaurant-portal UI let that selector own heading fonts rather than reaching
  for `font-display`/`font-*` overrides
- Colour tokens (reworked in the visual-hierarchy PR 1): `--primary` IS the brand
  red #FF2C32 — the same value as the `d-red` literal, so the two channels can no
  longer drift — with `--primary-hover` (= `d-red-hover` #E61C22) exposed as
  `bg-primary-hover` etc. `--destructive` is a deliberately DISTINCT darker red:
  destructive/danger UI must use it (never `bg-primary`/`bg-d-red`), and
  `--secondary` (94%) is now a lighter tier than `--muted` (88%) — don't collapse
  them back. Contrast rule: white on brand red is only ~3.7:1, so brand red may
  only sit behind LARGE/BOLD CTA text; small white-on-red text must pair with
  `--destructive` or `--primary-hover` (both ≥4.5:1 with white)
- Corner radius flows from ONE token: `--radius` in `src/styles.css`, raised from
  `0.5rem` to `0.875rem` so the shared button/input corner reads soft on tall
  filled controls. `rounded-sm`/`rounded-md`/`rounded-lg` are all `calc()`ed off
  it and move together (8.25 / 10.25 / 12.25px at the 14px root) — `rounded-md` is
  the shared corner for `app-dn-button` AND ~88 hand-rolled inputs, which is
  exactly why they must not be tuned apart. Two consequences: prefer the SCALING
  radii on any new portal control (bare `rounded` is a stock 3.5px that does NOT
  track the token, and was swept off the Settings/Team/Billing form controls for
  that reason), and mind that `rounded-lg` (12.25px) now EXCEEDS the stock
  `rounded-xl` (10.5px) — a `rounded-lg` child inside a `rounded-xl` shell reads
  as rounder than its container. Deliberately left on stock radii: `rounded-full`
  chips/avatars/badges, skeleton bars, small icon hit areas and checkboxes
- Semantic type + radius tokens exist in `tailwind.config.js` — `text-page-title`,
  `text-section-title`, `text-card-title`, `text-body`, `text-caption`,
  `text-micro` (11px hard floor), and `rounded-card` (20px, the diner dish-card
  corner). They are px-fixed because the 14px root shrinks rem sizes ~12.5%
  (the origin of the old half-pixel `text-[18.5px]`-style hacks). Do NOT add new
  arbitrary `text-[..px]` / `rounded-[..px]` values — pick a token, or extend the
  scale deliberately

## Key Domain Concepts
- `MenuItem` has two independent boolean fields — NEVER conflate them:
  - `available`: controls whether the item appears on the menu at all
  - `in_stock`: controls whether the item can be ordered. False = "Sold out" badge
- These require separate UI controls and separate API calls
- Dietary tags live on `MenuItem.tags` (allergens were rewired onto this
  field) — `tags` is the UI source of truth for the dietary/allergen pills. The
  serializer shape still carries a legacy `allergens: string[]` field (mapped
  through by `menu.service`), but it does NOT drive any dietary-tag UI — always
  build tag pills off `tags`, never `allergens`
- Menu items carry modifier groups + add-on extras (the diner customises an item
  with these before it hits the basket):
  - `MenuItem.options` is an `ItemModifiers` OBJECT
    (`{hasModifiers, groups: ModifierGroup[]}`) on the model — it is
    JSON-stringified ONLY in the save payload, never on the model. Normalise the
    raw payload with `parseModifierGroups()` (in `_common/utils/modifier-utils.ts`:
    drops unavailable choices, coerces `single`→max 1, derives `required` from
    `minSelections > 0`) before rendering the selectors
  - Extras are themselves MenuItems flagged `is_extra = true`; an item links its
    applicable extras via `extras_applicable` (sent JSON-stringified) bounded by
    `extras_min_selections` / `extras_max_selections`, and reads them back as the
    hydrated `MenuItem.extras: MenuItemExtraRef[]`
  - The shared selectors (`app-modifier-groups-selector` / `app-extras-selector`)
    are pure — the host owns selection state + validation; `selectionConstraintPhrase()`
    (same utils file) gives both surfaces identical "Select N" / "Select up to N"
    wording. Validation is client-side on BOTH the operator item form and the
    diner item-detail; the server validates shape but does not block
- `discount_details` has a single canonical shape — do NOT introduce
  `raw_*` mirrors of its fields
- `preset_tags` is sent to the backend as a native array, never a
  JSON-stringified array
- To clear a nullable field on PATCH, send `null` directly. The
  `clear_<field>` sentinel pattern was removed; `ApiService.postPatch`
  now preserves `null` end-to-end
- Kitchen tickets (`KitchenTicket`) move through `FulfilmentStatus`:
  `new → preparing → ready → served`. Advances must be legal (no jumps);
  `recall` steps back within a recall window; `priority` is an independent
  flag. Mutations are optimistic and revert on a failed PATCH
- Error toasts & offline UX: the HTTP error interceptor surfaces failed-request
  messages as toasts via the global `ToastService` (the old `MessageService`
  persistent banner has been retired). When a component surfaces its own toast for
  that same error (e.g. a blocked delete in the Tables Setup View), call
  `this.toast.clear()` first so the user sees one clean message, not two. It also
  toasts a 429 as a warning. Network-offline (status 0) is owned per-surface
  instead of by a global toast: a `ConnectivityService` (`navigator.onLine`) drives
  the back-office `OfflineBannerComponent` and the diner `OfflineStripComponent`,
  and the interceptor suppresses its global 'no network' toast on those surfaces
  (it still fires for login/auth and for a server-down-while-online status 0)
- Diner table-session capability (opaque QR, backend PR 7A) — the anonymous diner
  journey is gated by two opaque, signed tokens owned by `DinerSessionService`
  (`_services/diner-session.service.ts`):
  - the **QR credential** — long-lived, read once from the scanned URL
    (`?c=<credential>`); it is the ONLY thing that starts a session (a raw table
    UUID no longer does)
  - the **table session** — short-lived (6h backend TTL), minted at the protected
    `orders/journey/table-scan/` exchange
  `DinerSessionInterceptor` (`_helpers/diner-session.interceptor.ts`) is the ONLY
  place the capability is transmitted, and it matches each header against an EXACT
  first-party route allowlist — NOT substring/prefix inference. The allowlist,
  header names and the pure `classifyDinerCapabilityRequest` classifier are the
  single source of truth in `_security/diner-capability-contract.ts` (method-exact,
  version-pinned pathname, request origin checked against `environment.apiUrl`,
  fail-closed on any mismatch): `X-Diner-Credential` rides ONLY the GET
  `orders/journey/table-scan/` scan; `X-Diner-Session` rides ONLY GET
  `orders/journey/order-details/`, GET `orders/journey/payment-details/`, POST
  `orders/initiate/`, PUT `orders/submit/`, and POST `reviews/submit/`. The public
  `orders/journey/show-menu/` read, an unknown journey endpoint, a wrong method,
  an external origin that merely contains a route substring, and a route embedded
  only in a query param all receive NEITHER header. It is a channel COMPLETELY
  SEPARATE from staff auth — it attaches nothing when a staff user is signed in,
  so diner capability state never bleeds into a JWT request (and vice versa).
  Both tokens live in sessionStorage + in-memory signals and are NEVER
  logged, URL-embedded, or placed in a body/analytics payload. Recovery: a
  session TTL lapse (400 with the fixed expiry message) re-mints silently from the
  retained credential; a denied credential (404 `Not found.`) sets `needsRescan`
  and the diner shell shows a rescan panel. Persist the tokens across a checkout
  `sessionStorage.clear()` with `DinerSessionService.retainSessionThrough()` so
  the follow-up review submission / back-to-menu re-scan keeps its session

## Mock Data Pattern
- DashboardService now splits its mock flag in two (like TablesService). Both are
  `static` on the class (not module `const`s), mirroring `ReportsService`, so the
  contract specs can flip them and exercise the real branch — without that seam there
  is no way to assert what actually reaches the API:
  - `USE_MOCK_DATA = true` — core dashboard metrics are still mock
  - `USE_MOCK_REVIEWS = false` — the Reviews card is real-wired to `reviews/summary/`
    (its in-memory mock stays dormant behind the flag as a design-review aid)
  The dashboard mock walks the SAME range→bucket ladder as the live path
  (`generateDates(from, to, bucket)` enumerates the real range; it no longer re-derives
  a window from `new Date()`). It computes NO comparison of its own — DASH-DROP-PREVIOUS-00
  deleted the `previousEqualLengthPeriod` walks that fed `previous_totals` /
  `previous_total`, so a mock generator now only ever describes the window it was handed.
  That is not a gap: `USE_MOCK_DATA` gates a single `getDashboardData`, so mock mode takes
  the SAME second-call path the live surface does (§TIMEFRAME-02B) and the comparison
  baseline is a second generator call over the selected window
- **EVERY Dashboard mock card derives from the shared `dailyRevenue` basis**, so the closed
  weekday is coherent across the WHOLE screen rather than on the two cards that happened to
  read it. **The rule for the next generator added to `dashboard-mock-data.ts`: read the
  basis. Do not synthesise your own figures, and do not scale by a day count** — a closed
  day is a calendar day that traded nothing, so `rangeDays`-style scaling overstates every
  window containing one. Summing the basis handles that by construction, which is why the
  file needs no trading-day helper. Until DASH-MOCK-COHERENCE-00 two cards broke this:
  `getMockPaymentMethods(from, to)` multiplied three fixed per-day constants by a CALENDAR-day
  count (never seeing `restaurantId`, so every restaurant reported identical payments), and
  `getMockPopularItems()` took NO ARGUMENTS at all — byte-identical for "Today", "Last year"
  and a period with no trade. A closed Monday therefore read UGX 0 revenue and 0 orders
  beside UGX 3.6M settled and 8.17M of popular-item revenue. Both now take
  `(restaurantId, from, to)`. Two consequences worth knowing:
  **Payment Methods' "Total settled" is `Σ net`**, allocated across the methods by largest
  remainder, so it EQUALS the Revenue card's headline (`revenue-card` renders `totals.net`)
  to the shilling by construction — a diner pays the discounted price and a refund is money
  given back, so both belong out of what was settled; `tx_count` splits the window's actual
  ORDER count, never a day count. And **Popular Items returns an EMPTY LIST for a window
  with no takings**, not five rows of zero — that is what the backend's group-by would
  produce, and it is what drives the card's existing "No item data available" state instead
  of a ranking table of `0.0%`. Its five rows are the TOP five of a wider menu, so they are
  bounded by `TOP_ITEMS_REVENUE_SHARE` (0.6) of the window's net — the one free parameter in
  either generator. Shares are preserved by passing the ORIGINAL hardcoded figures as
  allocation WEIGHTS, and item `qty` derives from the exact unit prices the old fixture
  already encoded (25K/10K/20K/20K/5K), so ranking and both `%` columns are unchanged and
  the change is invisible on an ordinary trading day.
  **`PaymentMethodData` carries NO `change_pct`** (TIMEFRAME-TIDY-00). It was removed rather
  than repaired, the same treatment `previous_totals` got and for the same reason: there was
  no producer. The backend never sent it, `dashboard-adapter` manufactured a literal `0`
  (never reading the payload), the mock invented `12.5 / -3.2 / 28.1`, and no template,
  getter or spec consumed any of it — the "backend follow-up" it was carried under since
  DASH-MOCK-COHERENCE-00 pointed at nothing. When a payment-methods trend is genuinely
  wanted it gets built against a baseline that can be ABSENT, which is precisely what the
  old shape could not express: `0` and "no data" were indistinguishable. `tx_count` STAYS —
  it reaches no pixel either, but it is pinned by a real cross-card invariant
  (`Σ tx_count === orders.total`), which makes it unrendered-but-pinned rather than dead
- Still OUTSIDE the basis, deliberately: `getMockTablesData` and `getMockKdsData` (capacity
  and kitchen load are not revenue-derived) and the reviews mock
- TablesService now splits the flag in two:
  - `USE_MOCK_SETUP = false` — Setup View (areas, tables) is real-wired
  - `USE_MOCK_SERVICE = true` — Service View (reservations, waitlist,
    seated parties) is still mock
- KitchenOrderService uses a single `USE_MOCK_DATA = false` flag — the
  Kitchen View is real-wired; the in-memory mock dataset stays dormant behind
  the flag as a design-review aid (flip to `true` locally)
- The Settings section services in `src/app/_services/` are all real-wired
  (`USE_MOCK_DATA = false`): `restaurant-identity`, `restaurant-availability`,
  `restaurant-tax-receipts`, and `role-permissions` (the owner-only Roles & access
  grid — GET/PUT `restaurant-setup/role-permissions/` (note the `restaurant-setup/`
  prefix — the un-prefixed path 404s, fixed in f753877); GET parses via the
  defensive `parseGrid`, PUT sends `{restaurant, role, modules}`; dormant mock
  behind the flag, mirroring `restaurant-identity`). Staff
  & roles, Billing, and Account & security call `ApiService` directly (no mock flag)
- `RestaurantTagService` (`_services/restaurant-tag.service.ts`, backs Settings ›
  Preset tags) fully wires the `restaurant-setup/restaurant-tags/` catalog:
  `list`/`create` (GET/POST the list route), `update` PATCHes the DETAIL route
  `restaurant-tags/<id>/` (id in the PATH, not the body — the list route serves
  GET/POST only, so the old PUT-to-list 405'd on every edit/filterable-toggle;
  fixed PR #597), `delete`, `countItemsUsing` (GET `<id>/usage-count/`) and
  `reorder` (POST `reorder/` with `{order:[{id,display_order}]}`) — the last two
  backed by backend PR #245
- ReportsService uses a single `USE_MOCK_DATA = true` flag (mock-first),
  mirroring DashboardService — all four reports render mock data while a dormant
  `reports-adapter` parsing layer + scaffolded real endpoints wait behind the
  flag. The flag is a `static` on `ReportsService` (not a module `const`) so the
  contract specs can flip it to exercise the real branch. The slug+param and
  response-shape contracts are now PINNED by `reports.service.spec.ts` +
  `reports-adapter.spec.ts` against the backend-derived contract — but they are
  UNVERIFIED against a LIVE API (see the flip-time gate below)
- Dashboard and Reports mock data derive revenue from a SHARED per-(restaurant,day)
  basis in `src/app/_shared/mock/` (`daily-revenue.ts`, `hour-of-day.ts`, both
  spec-pinned) so the two surfaces stay numerically consistent — reuse it rather than
  re-deriving mock revenue in a new surface
- **The mock models NO CLOSURES — every calendar day trades** (MOCK-NO-CLOSURES-00). This is
  a DELIBERATE TEMPORARY STATE, reversible by ONE CONSTANT: `CLOSED_WEEKDAY` in
  `_shared/mock/daily-revenue.ts` is `number | null` and currently `null`; setting it back to
  a weekday index (`1` = Mon) restores closures wholesale. The guard, the zero-row shape and
  every consumer's sparse handling are INTACT — do not delete them to tidy up, or the next
  person needing a sparse fixture in the running app has to write it again.
  Why it is off: the Dashboard defaults to **Today**, so one day in seven its opening screen
  read zero revenue, zero orders, "No settled payments in this period" and "No item data
  available" — every figure correct, the whole screen useless, including in front of a
  prospective restaurant. Design work needs every date populated.
  **Why closures existed, which is what a future reader needs in order to decide whether to
  turn them back on:** the backend's period aggregation is a plain group-by, so a day with no
  orders used to yield NO BUCKET. A mock that emits
  every calendar day is DENSER than the thing it stands in for, and that density hid the Sales
  x-axis and comparison-pairing sparsity bugs through three consecutive PRs in that area. We
  are back in that condition. **That rationale has since WEAKENED, though it has not vanished**
  — backend BUCKETS-ZEROFILL-00 now zero-fills `sales-trends` and both `dashboard-v2` series
  onto the requested window, so the live surfaces the mock stands in for are themselves dense
  and the mock is no longer denser than its subject on those paths. A sparse fixture is still
  the honest way to exercise the FE's own densification, which is defence against the server
  guarantee narrowing rather than against today's wire.
  The mitigation is that it is no longer the only line of defence —
  the sparse-input specs for `normalizeSeries` and `alignComparisonSeries` build their own
  fixtures and never touched the mock — but end-to-end visibility in the RUNNING APP is gone.
  **The next change to densification, comparison pairing or the bucket ladder should flip the
  constant back to `1` for its verification pass.**
  Consequences of the current state: `dailyRevenue`'s one-row-per-inclusive-calendar-day
  contract is unchanged; `getMockSalesAggregate` still DROPS zero-order rows (mirroring the
  group-by) but that filter is now a NO-OP, since no in-range row is ever zero; mock totals are
  back up ~10%; the "pick a TRADING date" rule for a spec hard-coding a single day no longer
  applies; and **the only remaining no-trade window is an INVERTED range** (`dailyRevenue`
  returns `[]` for one by contract) — which is what the zero-window empty-state specs in
  `dashboard/` are driven by
- For any new module service, follow the same constant-flag pattern.
  Split flags by sub-domain when different views go live at different times
- Dashboard real endpoints: `reports/restaurant/dashboard-v2/` (core metrics, gated by
  `USE_MOCK_DATA`) and `reviews/summary/` (Reviews card, already live behind
  `USE_MOCK_REVIEWS = false`) — both parsed through `dashboard-adapter`.
  dashboard-v2 takes `restaurant` + `from` + `to` + **`bucket`**
  (`hour|day|week|month|year`, from `resolveTimeframe`; `week` accepted since backend
  DASH-WEEK-00, matching the ladder's weekly rung — see LADDER-WEEK-00). The legacy
  `period` parameter — keyed on the old UI selection rather than on a granularity — has
  not been sent by any caller since 01B, and the backend has since DELETED it along with
  its `TRUNC_MAP` (DASH-REMOVE-LEGACY-00); `bucket` is now REQUIRED, and an absent or
  whitespace-only value is a 400 exactly like an unknown one. The backend
  resolves `bucket` FAIL-CLOSED: an unrecognised value is a 400 naming the accepted
  set, not a silent fallback to hourly, so the vocabulary has to match exactly.
  Its series are DENSE — one row per bucket in the requested window, empty ones zeroed
  (BUCKETS-ZEROFILL-00)
- Tables real endpoints: Setup View is real-wired to the `restaurant-setup/`
  areas + tables endpoints plus the QR lifecycle — activation via the ordinary
  table update (`has_qr=true`) and secure rotation via
  `restaurant-setup/table-actions/regenerate-qr/` (one `{ table_id }` per call,
  server-signed response). The Service-View endpoints (reservations, waitlist,
  seated-party/table actions) exist in the backend already and remain to be wired
- Kitchen real endpoints: GET `kitchen/orders/active/` (polled), PATCH
  `kitchen/orders/{id}/fulfilment-status/` and `kitchen/orders/{id}/priority/`
- Reviews real endpoints: GET `reviews/analytics/` (Overview) and `reviews/`
  (paginated Feed via `ApiService.loadAllPages`), PATCH
  `reviews/{id}/resolution/` (resolve/reopen + optional note), POST
  `reviews/submit/` (diner capture). `ReviewsService` has no mock flag — it
  calls `ApiService` directly through a `reviews-adapter` layer
- Reports real endpoints (scaffolded, dormant behind `USE_MOCK_DATA = true`):
  GET `reports/restaurant/sales-trends/` (params `category`=daily|**weekly**|
  monthly|quarterly|annual + `result`=table — the FE's "aggregate" is the backend's
  trends table; there is NO `sales-aggregate` slug. `weekly` is emitted by
  `BUCKET_TO_CATEGORY` since LADDER-WEEK-00 and has always been in the backend's
  `TREND_PERIODS`; its series, like the others, is now zero-filled server-side),
  `…/menu-summary/` (param
  `grouping`), `…/transactions-summary/`, `…/diners-summary/`; paginated (via
  `ApiService.loadAllPages`) `…/sales-listing/`, `…/transactions-listing/`,
  `…/diners-listing/`. Backend wraps menu-summary in `data:{grouping,rows}` and
  emits sales-trends order counts as `count`, diners-summary as
  `average_spend_per_identified_diner`/`most_active_diner` — the adapter reads
  these exact keys (pinned by `reports-adapter.spec.ts`). Backend
  `transaction_type` is the `order_*` vocab (`order_payment`/`order_refund`/
  `order_charge`/`subscription`); the adapter's `txnType` strips the `order_`
  prefix to the FE `payment`/`refund`/`charge`/`subscription` tokens (else a
  refund mislabels as 'Payment')
- KNOWN GAP (follow-up, not a flip blocker): backend `payment_mode` vocab is
  `cash`/`momo`/`card`, but the FE `PaymentMode` union is
  `MTN MoMo`/`Airtel MoMo`/`Cash`. The adapter passes the raw token through and
  the "Method" column renders it as plain text, so it degrades gracefully — but
  the values don't match. A proper fix needs a product call (backend can't
  distinguish MTN vs Airtel — it stores only `momo`) plus a model + mock-data
  rework; deferred to its own change
- Only flip a mock flag to `false` when design is finalised and the
  backend endpoint is confirmed
- ReportsService flip-time gate — the four report contracts are pinned by the
  specs above but UNVERIFIED against a live API (no real restaurant with orders
  exists yet). Before flipping `ReportsService.USE_MOCK_DATA` to `false`: (1) run
  the contract specs (`npm run test:ci`) and confirm green; (2) re-verify ALL
  FOUR reports (Sales, Menu, Transactions, Diners) end-to-end against the live
  backend — slug, params AND response shape — since the mock returns
  frontend-shaped data and masks any drift until flip; (3) resolve the
  `payment_mode` vocab gap above
- Dashboard flip-time gate — **the sparse-series hazard this entry used to carry is CLOSED**.
  It warned that flipping `DashboardService.USE_MOCK_DATA` to `false` would activate a
  densification gap in `dashboard-adapter`'s `adaptRevenueSeries`, because the backend emitted
  no bucket for a period with no orders. Backend BUCKETS-ZEROFILL-00 now zero-fills both
  `dashboard-v2` series onto the requested window, so the series arrives dense and the adapter
  has nothing to fill. Left standing as the one thing to CHECK rather than fix at flip time:
  the adapter still does not densify, so confirm the server-side fill is present on the
  deployed backend before flipping — this repo's verification cannot see it

## Known Issues & Deferred Work
- EVERY SPEC IN `reports/sales/sales-report.component.spec.ts` PINS ITS RANGE, AND
  THE FIRST ONE HAD TO BE MADE TO (found and fixed 2026-08-10 — do not un-pin it).
  That spec ran on the Reports host default, `this-month`, and asserted
  `showWeekday`. But `presetToRange` CLAMPS an in-progress preset to today, so the
  window was only as long as the month was old: `weekdayEligible` needs
  `inclusiveDays >= WEEKDAY_MIN_DAYS` (14), and the assertion therefore failed on
  days 1–13 of EVERY month and passed from the 14th — **on `main` as much as on a
  branch**, with the rest of the suite green (1657/1658). It now pins a complete
  calendar month, which is what its assertions always described. Two things worth
  keeping straight if this shape recurs: the clamp is CORRECT and deliberate (a
  range must never extend into the future) and `WEEKDAY_MIN_DAYS` is a real display
  rule (a weekday cycle drawn from under two weeks is noise) — so the fix is always
  to pin the range, never to relax either of those. And a lone
  `SalesReportComponent` failure with the rest of the suite passing is worth
  checking the DATE on before hunting a regression. **The claim that every spec in
  that file pins its range only became TRUE in the Angular 22 upgrade** — six did
  not, and three of those (the error-state spec and two comparison-basis specs)
  were failing on `main` on the 1st/2nd of any month, because the clamped default
  is then a ≤1-day window and `LADDER_MAX_DAYS.hour` is 1, so the component takes
  the HOURLY branch and `getSalesAggregate` is never called. All six now pin
- `tsconfig.json` uses `paths` (`src/*`), NOT `baseUrl`. TypeScript 6 deprecates
  `baseUrl` (it errors, and goes away in TS 7) but ~319 imports here are written
  `src/app/...`, so the resolution moved to an equivalent `paths` mapping rather
  than being silenced with `ignoreDeprecations`. `downlevelIteration` was dropped
  for the same reason — it only affects targets below ES2015 and this app is ES2022
- `ngx-intl-telephone-input` was REMOVED (PRs 2a–2c) and replaced by the
  in-repo standalone `<app-dinify-phone-input>`
  (`src/app/shared/dinify-phone-input` — Uganda-only static `+256` + local
  flag). Its orphaned peer `awesome-phonenumber` was dropped with it. Do not
  reintroduce either: the stale Angular `^14` peer and the remote
  `raw.githubusercontent` flag-sprite hotlink (a CSP/licence exposure) were the
  whole reason for the swap. Consumer contract (settled after the swap): the
  component DISPLAYS the national number only (the static `+256` overlay is the
  sole country code shown, so an autofilled/pasted `+256`/`256`/trunk-`0` value
  never double-prefixes) but always EMITS the canonical `dialCode + national`
  MSISDN (plus-/space-free, e.g. `256755116061`) via BOTH `(valueChange).phoneNumber`
  and its `ControlValueAccessor` (`formControlName`) value. Consume the emitted
  value directly as the login/lookup key; never prepend `+256` or a trunk `0`
  yourself
- localStorage to httpOnly cookie migration requires backend coordination
- Tables Service View is parked AND hidden from the UI (MVP ships Setup View
  only); `TablesComponent.activeView` is forced to `'setup'`. It still sits on
  mock data (`USE_MOCK_SERVICE = true`) — real reservations/waitlist endpoints
  exist but are not yet wired. Its write methods fail loud in their non-mock
  branch (via `serviceViewNotWired`), so wire the real endpoints before flipping
  the flag. `mapApiTable` also does not yet map `raw.server_id` onto
  `RestaurantTable.serverId` (declared but unpopulated) — wire that alongside
  the Service View; the `server_id` contract may change by then

## Verification
Before raising any PR:
1. Run `npm run type-check` and confirm zero TypeScript errors
2. Run `npm run lint` and confirm clean
3. Run `npm run test:tenant-boundary` (the fail-fast boundary gate) and confirm
   green — especially if you touched the diner capability, QR lifecycle,
   selected-restaurant scoping, or the `_security/` contract. It is COMPOUND: it
   runs `scripts/check-platform-roles.mjs --self-test`, then the real scan, then
   the spec set. The script is the frontend counterpart to the backend's
   `ambient_authority.py` — it fails on any `dinify_admin` /
   `dinify_account_manager` literal, or on ANY RUNTIME READ of `profile.roles`,
   across `src/**/*.{ts,html}`. That second rule was WIDENED (FE-AUTH-01): it used
   to require a membership-test suffix (`profile.roles.includes/some/indexOf`),
   which an alias defeated (`const r = user.profile.roles;` then test `r`). It now
   matches property, bracket (`profile['roles']`) and destructured
   (`const {roles} = user.profile`) reads with no suffix at all — a simpler rule
   and a strictly stronger guarantee, since Closure PR 1 left no legitimate
   production read to carve out. **The matcher is COMMENT-AWARE** for that rule
   only, and it has to be: four production files carry tombstone comments naming
   `profile.roles`, and allowlisting them would blind the gate inside
   `auth.guard.ts` — the file that enforces route authority — because `ALLOWLIST`
   is file+name scoped. The literal rule still runs on the raw line, deliberately:
   it asks "does this string appear at all", the access rule asks "does this code
   run". It is a NODE script, not a spec, deliberately: a source scanner cannot run
   in Karma here — headless Chrome on the esbuild `@angular/build:karma` builder has
   no `fs`, no `require.context` (webpack-only; the repo migrated off webpack), no
   raw-loader and no `preprocessors` hook, and `tsconfig.spec.json` compiles only
   specs + `.d.ts`. Two of the removed sites lived in HTML templates, which no
   browser-side spec can read as text. Its `ALLOWLIST` is EMPTY and permanent —
   restaurant roles come from `currentRestaurantRole` / `restaurant_roles`, never
   from `profile.roles` — and it needs no per-file exemption: the `Profile.roles`
   TYPE DECLARATION reads `roles: string[]` and spec fixtures build nested literals
   (`profile: { … roles: [] … }`), so neither spells the banned pair. What it still
   cannot see is a two-step alias through the profile OBJECT
   (`const p = user.profile; p.roles`) or a value fetched under another name — it is
   a source scanner, not semantic analysis, and its docstring says so.
   `_security/platform-role-ratchet.spec.ts` is the
   object-graph half, asserting the live `routes` export stays clean
4. Run `npm run test:ci` for any module you touched
5. Run `npm run build:prod` and confirm zero errors
6. Confirm standalone components are in `imports`, not `declarations`

A convenience runner `scripts/verify.sh` runs all five checks in CI order —
type-check → lint → tenant-isolation closure gate (`npm run test:tenant-boundary`)
→ test:ci → build:prod — continuing past failures so you see every problem at once,
exiting non-zero if any fail. It is a manual pre-PR gate — run it and paste the
output into the PR; it is intentionally NOT wired as a hook.

CI (`.github/workflows/ci.yml`) runs all five steps on every PR to `main`:
`type-check`, `lint`, the tenant-isolation closure gate
(`npm run test:tenant-boundary` — a focused, fail-fast tenant-boundary spec set
that runs BEFORE the full suite so a broken diner/restaurant boundary fails
early), `test:ci`, and `build:prod`. The production deploy workflow
(`deploy-prod.yml`) builds with `--configuration=uat` (intentionally still the
uat build config for now — the prod backend API doesn't exist yet) and pushes to
the `dinify-prod` Firebase Hosting target on every merge to `main`. A third
workflow (`audit.yml`, "Dependency Audit") runs `npm audit --audit-level=high`
weekly (Mondays 06:30 UTC) and on manual dispatch — it is NOT a PR check and
never blocks a merge; it just fires a notification if a high/critical advisory
reappears. package.json keeps a small `overrides` block (`lodash-es`, gaxios's
`uuid`, `@grpc/grpc-js`) to hold the audit-zero baseline — don't strip it
wholesale. Only gaxios's `uuid` raises a version BEYOND its dependent's declared
range (gaxios asks for `^9.0.1`, the override forces `11.1.1`); `lodash-es` and
`@grpc/grpc-js` sit inside their dependents' ranges (`ng2-charts` wants
`^4.17.15`, `google-gax` wants `^1.12.6`) and act as floors. **The `esbuild`
entry is GONE** — its documented exit condition was met, and the Angular 22
upgrade turned it from a no-op into a hazard: `@angular/build` 22.1.6 pins
`esbuild` 0.28.2, which the `0.28.1` override would have DOWNGRADED. That is the
standing lesson — re-check this block whenever `@angular/build` moves. All three
workflows
install with `npm ci --legacy-peer-deps` — use the same flag locally, since a
plain `npm ci`/`npm install` can trip over peer-dependency conflicts.

Lint runs on ESLint 10 + angular-eslint 22 through `eslint.config.js` (FLAT
config). The former `.eslintrc.json` is gone and cannot come back: the v22 scoped
plugin exports only `rules`, so the shared configs must come from the
`angular-eslint` / `typescript-eslint` umbrella packages. `@angular-eslint/builder`
stays a direct devDependency because `angular.json` names
`@angular-eslint/builder:lint` directly.

Build scripts `build:prod`, `build:uat`, and `build:staging` map to the
matching angular.json configurations, all built by the esbuild
`@angular/build:application` builder. Unit tests run on Karma + Jasmine via the
`@angular/build:karma` builder (`npm run test:ci` uses ChromeHeadless).

## Available Slash Commands
- `/update-context` — re-audit the repo and refresh this file
