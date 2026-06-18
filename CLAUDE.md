# Dinify Frontend — Claude Code Context

## Project Overview
Dinify is a QR-code-based digital ordering and restaurant management platform
built for Uganda and mobile-money-first markets. This repo contains three
portals — Restaurant Management Portal, Diner App, and Platform Admin —
plus a staff-facing Kitchen View board (route `/kitchen`).
Deployed to Firebase Hosting at dinify-prod.web.app.
A parallel `AGENTS.md` at the repo root carries Codex/other-agent instructions
that defer to this file — `CLAUDE.md` remains the authoritative project guide,
so keep it current when conventions change.

## Tech Stack
- Angular 20 with mixed component pattern (see below)
- Builds/serves/tests run on the esbuild-based `@angular/build` application
  builder (`@angular/build:application`, `:dev-server`, `:karma`) — migrated
  off the legacy webpack `@angular-devkit/build-angular` builder
- Tailwind CSS
- Firebase Hosting (auto-deploys on push to main via GitHub Actions)
- Repo: mugak1/Dinify-Frontend

## Current Implementation Status
- Phase 0 (Foundation): ✅ Complete
- Phase 1 (Menu module, all sub-phases 1a–1d): ✅ Complete
- Phase 2 (Dashboard): ✅ Complete — USE_MOCK_DATA still true in DashboardService
  (exception: the Popular Items card now pulls real menu data)
- Diner App menu redesign: ✅ Complete (sticky brand strip, scroll-aware nav
  pills, quick-add affordance, allergen-safety disclaimer banner)
- Dashboard responsiveness: ✅ Complete
- Phase 3 (Tables module): 🔄 MVP ships Setup View only (route `dining-tables`)
  - Setup View (areas, tables): ✅ wired to real API (`USE_MOCK_SETUP = false`);
    blocked deletes (e.g. an area that still has tables) surface the backend
    message as a single toast (see error-handling note below)
  - Service View (reservations, waitlist, seated parties): ⏸️ parked AND hidden
    from the UI — its component/services/mocks/models stay in the repo but are
    NOT rendered. `TablesComponent.activeView` is forced to `'setup'` (seed +
    validate honour only `'setup'`), so re-enabling the toggle later is a small
    revert. Service code still sits behind `USE_MOCK_SERVICE = true`
- Menu polish pass: ✅ Complete — canonical `discount_details` shape, native
  `preset_tags` arrays, paginated menusections/menuitems, allergens rewired
  onto the `tags` field as the dietary-tag source of truth
- Kitchen View (KDS board): ✅ Complete — Phase 1 (mock board UI) and Phase 3
  (live order data) both done. Separate top-level lazy module at
  `src/app/kitchen/` (route `/kitchen`, AuthGuard-protected).
  `KitchenOrderService.USE_MOCK_DATA = false`; HTTP polling + optimistic PATCH
  against real endpoints. Kitchen-only staff land here automatically on login:
  `LoginComponent.landingPathForMembership` routes a membership whose roles
  include `'kitchen'` but neither `'owner'` nor `'manager'` to `/kitchen`, and
  everyone else to `/rest-app` (an explicit `returnUrl` deep link still wins)
- Support: ✅ real-wired — the restaurant Support page (`support/`) reads/writes
  the `support/issues/` API; the Dinify-admin triage screen
  (`dinify-mgt/mgt-support`) is wired against `support/admin/issues/`.
  Status/category/impact badge styling + labels are shared from
  `src/app/_shared/support/`
- Settings: ✅ rebuilt as a grouped hub shell (route `settings`,
  `SettingsHubComponent`) with standalone, real-wired section pages —
  Restaurant identity & branding (`settings/restaurant`, `IdentityComponent`),
  Availability (`settings/availability`, `AvailabilityComponent` —
  `accepting_orders` toggle), Staff & roles (`settings/rest-users`,
  `RestUsersComponent` — finance role dropped), Tax & receipts
  (`settings/tax-receipts`, `TaxReceiptsComponent`), Billing (`settings/billing`,
  subscription-only — `BillingComponent` is the one section still in
  `declarations`, i.e. non-standalone), Account & security (`settings/account`,
  `AccountSecurityComponent`), and Preset tags (`settings/preset-tags`,
  `PresetTagsComponent`). Shared section chrome lives in `settings/components/`
  (`SectionPageComponent`, `SettingsIconComponent`); the old monolithic
  `SettingsComponent` is gone
- Reviews: ✅ real-wired — a standalone Overview (route `reviews`,
  `ReviewsOverviewComponent`: summary line, needs-attention block, dimension
  breakdown, rating-trend chart) plus a Feed (route `reviews/feed`,
  `ReviewsFeedComponent`: list with critical/resolution/rating filters, a
  needs-attention queue, resolve/reopen with an optional resolution note, and
  deep-linking to a flagged review). Both read/write the `reviews/` API through a
  dedicated `ReviewsService` (no mock flag) with a `reviews-adapter` parsing
  layer; diners leave a review on the diner-app order-complete screen (POST
  `reviews/submit/`, gated on a real backend order id). The old monolithic
  reviews-management surface has been removed
- Payments: a real transactions listing only (route `payments`,
  `reports/restaurant/transactions-listing/`); its dead Falcon wallet UI
  (Disburse Funds, DinifyAccount balance) has been removed
- Other restaurant-mgt surfaces (reports + report-detail, notifications) are
  scaffolded and routed — per-view data-wiring status varies
- Offline/connectivity UX: ✅ a `ConnectivityService` (`navigator.onLine`) drives a
  persistent `OfflineBannerComponent` in the back-office shells (restaurant +
  Dinify admin) and an `OfflineStripComponent` in the diner app. The HTTP error
  interceptor surfaces request failures as toasts via `ToastService` (the legacy
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

## Visual Reference
- The Lovable React prototype (mugak1/Dinify-Restaurant-Portal) is the
  canonical visual reference for ALL UI work
- Always check the prototype for layout, spacing, component behaviour,
  and visual design before writing any code

## Component Pattern — CRITICAL
The module uses a deliberate mixed pattern — follow it exactly:
- Older components (DashboardComponent, MenuComponent, ReportsComponent,
  ReviewsComponent etc.) are NON-standalone — they go in `declarations`
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

## Shared UI Component Library
A shared component library lives in `src/app/_shared/ui/`:
allergen-disclaimer, badge, button, card, dialog, featured-carousel,
offline-banner, sheet, switch, tabs, toast — plus the `tooltip` directive
(`[appTooltip]`, not a component), the `SafeArrayPipe`, and the `HighlightPipe`
(search-term highlighting). The `toast/` folder also exports the injectable
`ToastService` (the app-wide toast queue), re-exported from the barrel.

Re-exports live in `src/app/_shared/ui/index.ts` — but the barrel does NOT
re-export `FeaturedCarouselComponent`, the tooltip directive, or
`HighlightPipe`; import those from their own file paths. Always use these
existing components before creating new ones. They are all standalone and
go in the module `imports` array.

Two more reuse-first libraries sit alongside `ui/` — check them before
writing new tag or price/menu logic:
- `src/app/_shared/tags/` (barrel `index.ts`) — the dietary-tag system:
  `TagColour`/`TagIcon`/`TagCategory`, `TAG_COLOUR_PALETTE`, `TAG_ICONS`,
  `TAG_CATEGORIES`, `TagPillComponent`, `TagOverflowPillComponent`,
  `MenuItemTagSelectorComponent`, plus `filterMenuItems` and truncation helpers
- `src/app/_shared/utils/` (per-file imports, no barrel) — `cn`, `formatUGX`,
  price/discount helpers (`getCurrentPrice`, `isDiscountActive`,
  `calculateSavings`, `getDiscountBadgeText`), and `searchMenuItems` /
  `applyMenuSort`
- `src/app/_shared/support/` (barrel `index.ts`) — support-issue display
  metadata: `STATUS_META`/`CATEGORY_LABEL`/`IMPACT_LABEL` maps, the matching
  `statusMeta`/`categoryLabel`/`impactLabel` helpers, and
  `CATEGORY_OPTIONS`/`IMPACT_OPTIONS`. Shared by the restaurant Support page and
  the Dinify-admin triage screen — reuse before hand-rolling status badges or
  category labels

## Angular Rules
- Always set `outputHashing: "all"` across ALL build configurations
- Never use lucide-angular in new code — use inline SVGs instead. (The
  legacy Platform Admin module `dinify-mgt` still imports it; do not
  extend that usage.)

## Styling Rules
- `overflow-hidden` on layout containers is intentional — matches the
  Lovable prototype. Do not remove it to fix visual clipping issues
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

## Key Domain Concepts
- `MenuItem` has two independent boolean fields — NEVER conflate them:
  - `available`: controls whether the item appears on the menu at all
  - `in_stock`: controls whether the item can be ordered. False = "Sold out" badge
- These require separate UI controls and separate API calls
- Dietary tags live on `MenuItem.tags` (allergens were rewired onto this
  field). There is no separate `allergens` array on the model
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

## Mock Data Pattern
- DashboardService still uses a single `USE_MOCK_DATA = true` flag
- TablesService now splits the flag in two:
  - `USE_MOCK_SETUP = false` — Setup View (areas, tables) is real-wired
  - `USE_MOCK_SERVICE = true` — Service View (reservations, waitlist,
    seated parties) is still mock
- KitchenOrderService uses a single `USE_MOCK_DATA = false` flag — the
  Kitchen View is real-wired; the in-memory mock dataset stays dormant behind
  the flag as a design-review aid (flip to `true` locally)
- The Settings section services in `src/app/_services/` are all real-wired
  (`USE_MOCK_DATA = false`): `restaurant-identity`, `restaurant-availability`,
  and `restaurant-tax-receipts`. Staff & roles, Billing, and Account & security
  call `ApiService` directly (no mock flag)
- For any new module service, follow the same constant-flag pattern.
  Split flags by sub-domain when different views go live at different times
- Dashboard real endpoint: `api/v1/reports/restaurant/dashboard/`
- Tables real endpoints: reservations, waitlist, table-actions — all exist
  in the backend already and remain to be wired for the Service View
- Kitchen real endpoints: GET `kitchen/orders/active/` (polled), PATCH
  `kitchen/orders/{id}/fulfilment-status/` and `kitchen/orders/{id}/priority/`
- Reviews real endpoints: GET `reviews/analytics/` (Overview) and `reviews/`
  (paginated Feed via `ApiService.loadAllPages`), PATCH
  `reviews/{id}/resolution/` (resolve/reopen + optional note), POST
  `reviews/submit/` (diner capture). `ReviewsService` has no mock flag — it
  calls `ApiService` directly through a `reviews-adapter` layer
- Only flip a mock flag to `false` when design is finalised and the
  backend endpoint is confirmed

## Known Issues & Deferred Work
- `ngx-intl-telephone-input` used across ~8 files (auth, dinify-mgt,
  _common) — do not add new usages
- localStorage to httpOnly cookie migration requires backend coordination
- Login 500 regression still outstanding — parked pending Apache log access
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
3. Run `npm run test:ci` for any module you touched
4. Run `npm run build:prod` and confirm zero errors
5. Confirm standalone components are in `imports`, not `declarations`

A convenience runner `scripts/verify.sh` runs all four checks in CI order
(continuing past failures so you see every problem at once, exiting non-zero if
any fail). It is a manual pre-PR gate — run it and paste the output into the PR;
it is intentionally NOT wired as a hook.

CI (`.github/workflows/ci.yml`) runs all four (`type-check`, `lint`,
`test:ci`, `build:prod`) on every PR to `main`. The production deploy workflow
(`deploy-prod.yml`) builds with `--configuration=uat` (intentionally still the
uat build config for now — the prod backend API doesn't exist yet) and pushes to
the `dinify-prod` Firebase Hosting target on every merge to `main`. A third
workflow (`audit.yml`, "Dependency Audit") runs `npm audit --audit-level=high`
weekly (Mondays 06:30 UTC) and on manual dispatch — it is NOT a PR check and
never blocks a merge; it just fires a notification if a high/critical advisory
reappears. package.json keeps a small `overrides` block (`lodash-es`, gaxios's
`uuid`, `@grpc/grpc-js`, `esbuild`) to hold the audit-zero baseline — don't
strip it; the `esbuild` pin (0.28.1) can be dropped once `@angular/build` ships
on esbuild ≥0.28.1. All three workflows
install with `npm ci --legacy-peer-deps` — use the same flag locally, since a
plain `npm ci`/`npm install` can trip over peer-dependency conflicts.

Build scripts `build:prod`, `build:uat`, and `build:staging` map to the
matching angular.json configurations, all built by the esbuild
`@angular/build:application` builder. Unit tests run on Karma + Jasmine via the
`@angular/build:karma` builder (`npm run test:ci` uses ChromeHeadless).

## Available Slash Commands
- `/lovable-check` — audit a planned UI change against the Lovable
  prototype before writing code
- `/update-context` — re-audit the repo and refresh this file
