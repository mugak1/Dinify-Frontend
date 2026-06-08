# Dinify Frontend — Claude Code Context

## Project Overview
Dinify is a QR-code-based digital ordering and restaurant management platform
built for Uganda and mobile-money-first markets. This repo contains three
portals — Restaurant Management Portal, Diner App, and Platform Admin —
plus a staff-facing Kitchen View board (route `/kitchen`).
Deployed to Firebase Hosting at dinify-uat.web.app.

## Tech Stack
- Angular 20 with mixed component pattern (see below)
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
- Phase 3 (Tables module): 🔄 In progress
  - Setup View (areas, tables): ✅ wired to real API (`USE_MOCK_SETUP = false`);
    blocked deletes (e.g. an area that still has tables) surface the backend
    message as a single toast (see error-handling note below)
  - Service View (reservations, waitlist, seated parties): still mock
    (`USE_MOCK_SERVICE = true`)
- Menu polish pass: ✅ Complete — canonical `discount_details` shape, native
  `preset_tags` arrays, paginated menusections/menuitems, allergens rewired
  onto the `tags` field as the dietary-tag source of truth
- Kitchen View (KDS board): ✅ Complete — Phase 1 (mock board UI) and Phase 3
  (live order data) both done. Separate top-level lazy module at
  `src/app/kitchen/` (route `/kitchen`, AuthGuard-protected).
  `KitchenOrderService.USE_MOCK_DATA = false`; HTTP polling + optimistic PATCH
  against real endpoints
- Other restaurant-mgt surfaces (payments, reviews + reviews-management,
  reports + report-detail, support, notifications, settings sub-pages) are
  scaffolded and routed — per-view data-wiring status varies
- The legacy Falcon Orders page has been removed — there is no Orders route,
  component, or sidebar entry in the restaurant portal. Live order/fulfilment
  flow lives in the Kitchen View (KDS board) at `/kitchen`

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

## Visual Reference
- The Lovable React prototype (mugak1/Dinify-Restaurant-Portal) is the
  canonical visual reference for ALL UI work
- Always check the prototype for layout, spacing, component behaviour,
  and visual design before writing any code

## Component Pattern — CRITICAL
The module uses a deliberate mixed pattern — follow it exactly:
- Older components (DashboardComponent, MenuComponent, SettingsComponent,
  ReportsComponent etc.) are NON-standalone — they go in `declarations`
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
sheet, switch, tabs, toast — plus the `tooltip` directive (`[appTooltip]`,
not a component), the `SafeArrayPipe`, and the `HighlightPipe`
(search-term highlighting).

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

## Angular Rules
- Always set `outputHashing: "all"` across ALL build configurations
- Never use lucide-angular in new code — use inline SVGs instead. (The
  legacy Platform Admin module `dinify-mgt` still imports it; do not
  extend that usage.)

## Styling Rules
- `overflow-hidden` on layout containers is intentional — matches the
  Lovable prototype. Do not remove it to fix visual clipping issues
- Collapse toggle elements must be inside a `relative` wrapper div

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
- Error toasts vs. the global banner: the HTTP error interceptor already
  queues failed-request messages on the global `MessageService` (a persistent
  app-level banner). When a component surfaces its own toast for that same
  error (e.g. a blocked delete in the Tables Setup View), call
  `this.message.clear()` first so the user sees one clean message, not two

## Mock Data Pattern
- DashboardService still uses a single `USE_MOCK_DATA = true` flag
- TablesService now splits the flag in two:
  - `USE_MOCK_SETUP = false` — Setup View (areas, tables) is real-wired
  - `USE_MOCK_SERVICE = true` — Service View (reservations, waitlist,
    seated parties) is still mock
- KitchenOrderService uses a single `USE_MOCK_DATA = false` flag — the
  Kitchen View is real-wired; the in-memory mock dataset stays dormant behind
  the flag as a design-review aid (flip to `true` locally)
- For any new module service, follow the same constant-flag pattern.
  Split flags by sub-domain when different views go live at different times
- Dashboard real endpoint: `api/v1/reports/restaurant/dashboard/`
- Tables real endpoints: reservations, waitlist, table-actions — all exist
  in the backend already and remain to be wired for the Service View
- Kitchen real endpoints: GET `kitchen/orders/active/` (polled), PATCH
  `kitchen/orders/{id}/fulfilment-status/` and `kitchen/orders/{id}/priority/`
- Only flip a mock flag to `false` when design is finalised and the
  backend endpoint is confirmed

## Known Issues & Deferred Work
- `ngx-intl-telephone-input` used across ~8 files (auth, dinify-mgt,
  _common) — do not add new usages
- localStorage to httpOnly cookie migration requires backend coordination
- Login 500 regression still outstanding — parked pending Apache log access
- Tables Service View still on mock data (`USE_MOCK_SERVICE = true`) — real
  reservations/waitlist endpoints exist but are not yet wired. Its write
  methods now fail loud in their non-mock branch (via `serviceViewNotWired`),
  so wire the real endpoints before flipping the flag. `mapApiTable` also does
  not yet map `raw.server_id` onto `RestaurantTable.serverId` (declared but
  unpopulated) — wire that alongside the Service View; the `server_id`
  contract may change by then

## Verification
Before raising any PR:
1. Run `npm run type-check` and confirm zero TypeScript errors
2. Run `npm run lint` and confirm clean
3. Run `npm run test:ci` for any module you touched
4. Run `npm run build:prod` and confirm zero errors
5. Confirm standalone components are in `imports`, not `declarations`

CI (`.github/workflows/ci.yml`) runs all four (`type-check`, `lint`,
`test:ci`, `build:prod`) on every PR to `main`. The UAT deploy workflow
(`deploy-uat.yml`) builds with `--configuration=uat` and pushes to the
`dinify-uat` Firebase Hosting target on every merge to `main`.

Build scripts `build:prod`, `build:uat`, and `build:staging` map to the
matching angular.json configurations. Unit tests run on Karma + Jasmine
(`npm run test:ci` uses ChromeHeadless).

## Available Slash Commands
- `/lovable-check` — audit a planned UI change against the Lovable
  prototype before writing code
- `/update-context` — re-audit the repo and refresh this file
