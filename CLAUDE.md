# Dinify Frontend — Claude Code Context

## Project Overview
Dinify is a QR-code-based digital ordering and restaurant management platform
built for Uganda and mobile-money-first markets. This repo contains three
portals: Restaurant Management Portal, Diner App, and Platform Admin.
Deployed to Firebase Hosting at dinify-uat.web.app.

## Tech Stack
- Angular 20 with mixed component pattern (see below)
- Tailwind CSS
- Firebase Hosting (auto-deploys on push to main via GitHub Actions)
- Repo: mugak1/dinify_frontend_handover

## Current Implementation Status
- Phase 0 (Foundation): ✅ Complete
- Phase 1 (Menu module, all sub-phases 1a–1d): ✅ Complete
- Phase 2 (Dashboard): ✅ Complete — USE_MOCK_DATA still true in DashboardService
- Diner App menu redesign: ✅ Complete
- Dashboard responsiveness: ✅ Complete
- Phase 3 (Tables module): 🔄 In progress — all 11 components built,
  TablesService uses USE_MOCK_DATA = true, real API wiring deferred

## Deployment Rules — CRITICAL
- Pushing to main triggers automatic Firebase deployment via GitHub Actions
- NEVER suggest manual deployment steps — the pipeline handles everything
- Each feature must be on its own branch → PR → merge
- Never stack work on unmerged branches

## Visual Reference
- The Lovable React prototype (mugak1/Dinify-Restaurant-Portal) is the
  canonical visual reference for ALL UI work
- Always check the prototype for layout, spacing, component behaviour,
  and visual design before writing any code

## Component Pattern — CRITICAL
The module uses a deliberate mixed pattern — follow it exactly:
- Older components (DashboardComponent, MenuComponent, SettingsComponent,
  OrdersComponent etc.) are NON-standalone — they go in `declarations`
- Newer components (SidebarComponent, TopNavComponent, TablesComponent,
  all shared UI components) are STANDALONE — they go in `imports`
- When creating a new component, make it standalone and add it to `imports`
- Never put a standalone component in `declarations` — Angular silently
  renders empty elements

## Shared UI Component Library
A shared component library lives in `src/app/_shared/ui/`:
badge, button, card, dialog, sheet, switch, tabs, toast, tooltip

Always use these existing components before creating new ones.
They are all standalone and go in the module `imports` array.

## Angular Rules
- Always set `outputHashing: "all"` across ALL build configurations
- Never use lucide-angular — use inline SVGs instead

## Styling Rules
- `overflow-hidden` on layout containers is intentional — matches the
  Lovable prototype. Do not remove it to fix visual clipping issues
- Collapse toggle elements must be inside a `relative` wrapper div

## Key Domain Concepts
- `MenuItem` has two independent boolean fields — NEVER conflate them:
  - `available`: controls whether the item appears on the menu at all
  - `in_stock`: controls whether the item can be ordered. False = "Sold out" badge
- These require separate UI controls and separate API calls

## Mock Data Pattern
- Both DashboardService and TablesService use `USE_MOCK_DATA = true`
- Use the same pattern for any new module service
- Dashboard real endpoint: `api/v1/reports/restaurant/dashboard/`
- Tables real endpoints: reservations, waitlist, table-actions — all exist
  in the backend already
- Only flip USE_MOCK_DATA to false when design is finalised and
  the backend endpoint is confirmed

## Known Issues & Deferred Work
- `ngx-intl-telephone-input` used in 5 templates — do not add new usages
- localStorage to httpOnly cookie migration requires backend coordination
- Login 500 regression still outstanding — parked pending Apache log access

## Verification
Before raising any PR:
1. Run `ng build` and confirm zero errors
2. Check for TypeScript errors
3. Confirm standalone components are in `imports`, not `declarations`
