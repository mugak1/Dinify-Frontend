# Dinify — As-Built Product Documentation

**What this document is.** An authoritative description of what Dinify actually does *as built*, reverse-engineered entirely from the source code of its two repositories in June 2026. It records what works, what is half-built, and what only looks finished. It deliberately contains **no** market analysis or recommendations.

**How to read the status badges.** Every feature is classified with one of five labels:

| Badge | Meaning |
|---|---|
| ✅ **Fully implemented & wired** | Working end-to-end: real UI calling real backend endpoints against the real database. |
| 🟡 **Partially built** | Some of it is real, but a meaningful piece is missing, mocked, or broken. |
| 🔵 **Stubbed / placeholder** | The screen or code file exists, but it does little or nothing. |
| ⏸️ **Parked (built but hidden)** | Substantial code exists but is deliberately switched off or hidden from users. |
| ⚰️ **Dead / unused** | Legacy code that nothing uses anymore. |

Claims in this document were verified directly against the code; file paths and API endpoint names are given so a developer can re-check any statement. Where the code could not answer a question, it is listed explicitly in sections 9 and 10 rather than guessed at.

---

## 1. Overview

### What Dinify is

Dinify is a **QR-code-based digital ordering and restaurant management platform** for Uganda and other mobile-money-first markets. The core idea as built: a restaurant sets up its menu and tables in a management portal, prints QR codes for each table, and diners who scan a code get the menu on their phone and can place an order straight to the kitchen — no app install, no account, no waiter needed to take the order. Kitchen staff work the orders on a live kitchen display board. Payment is designed to happen by mobile money or card (see section 4 for the honest state of that).

### The two repositories and how they relate

The split is a classic **frontend / backend** pair. They communicate exclusively over HTTPS REST APIs (JSON), with login-protected calls carrying a JWT bearer token.

| | **Dinify-Frontend** (`mugak1/Dinify-Frontend`) | **Dinify-Backend** (`mugak1/Dinify-Backend`) |
|---|---|---|
| What it is | A single Angular web application containing **all four user-facing surfaces** (see below) | A Django REST API containing **all business logic and data** |
| Who touches it | Diners, restaurant staff, restaurant owners, Dinify's own admins — everyone | No human directly; only the frontend (and payment gateways, in theory) |
| Where it runs | Firebase Hosting (UAT at `dinify-uat.web.app`) | AWS EC2 (Apache/mod_wsgi) with PostgreSQL on AWS RDS |
| Deploys | GitHub Actions on merge to `main` → Firebase | GitHub Actions on merge to `main` → pull, install, migrate, restart Apache |

The frontend is one app with **four surfaces**, selected by URL and login role:

1. **Diner App** (`/diner/...`) — public, no login. What a customer sees after scanning a table QR code.
2. **Restaurant Management Portal** (the URL root — `/dashboard`, `/menu`, …; legacy `/rest-app/*` URLs redirect) — login required (owner/manager). Menu, tables, dashboard, payments, settings, support.
3. **Kitchen View / KDS** (`/kitchen`) — login required (kitchen/owner/manager). The live order board. Kitchen-only staff are routed here automatically at login.
4. **Platform Admin Portal** (`/mgt-app/...`) — login required (Dinify's own `dinify_admin` role). Onboard/manage restaurants, triage support, platform dashboard.

There is **no public marketing/landing page**: the root URL redirects straight to `/login`. The only public pages besides the diner app are the legal pages (`/privacy`, `/terms`, `/cookies`) and the auth screens (`/login`, `/register`, `/forgot-password`).

### Tech stack

| Layer | Technology |
|---|---|
| Frontend | Angular 20, Tailwind CSS, esbuild-based `@angular/build` toolchain, Karma/Jasmine tests; `angularx-qrcode` for client-side QR generation |
| Backend | Python 3.10, Django 5.2 LTS, Django REST Framework 3.17, SimpleJWT (rotating refresh tokens) |
| Primary database | PostgreSQL 15 on AWS RDS (all core data) |
| Secondary store | MongoDB Atlas — used **only** for fire-and-forget archival copies, action logs, and payment-gateway response logs; **currently unreachable from the EC2 server**, so these writes silently fail |
| Hosting | Frontend: Firebase Hosting. Backend: AWS EC2 (35.177.46.58), Apache/mod_wsgi |
| Payments | Yo Uganda (mobile money + SMS), DPO/3G DirectPay (card); Flutterwave and Pesapal code exists but is unwired — detailed in section 4 |
| Media storage | Local disk on the EC2 server (Django `MEDIA_ROOT`); images auto-resized on upload (Pillow). No S3/CDN |
| CI/CD | GitHub Actions in both repos (type-check/lint/test/build on the frontend; Django checks, migration guard, money-field guard, full test suite on Postgres 15 on the backend) |
| Timezone / currency | Server timezone `Africa/Nairobi` (EAT); currency is **UGX hardcoded** throughout |

API environments configured in the frontend: `api-dev.dinifyapp.com` (dev), `api-test.dinifyapp.com/uat` (UAT), `api.dinifyapp.com` (prod). All API routes live under `api/v1/` (plus `api/v2/orders/` for the newer order-creation endpoint).

---

## 2. Module & feature inventory

### 2.1 Menu module — ✅ Fully implemented & wired

The most complete module in the product. In the portal (`/menu`, backed by `api/v1/restaurant-setup/menusections|menuitems/`):

- Sections with drag-to-reorder, optional banner images, and **availability scheduling** (e.g. "Breakfast: Mon–Fri 07:00–11:00" — scheduled sections are filtered out of the diner menu outside their window).
- Items with: price, image (auto-optimised to 800px), description, calories, and two **independent** switches — `available` (is it on the menu at all?) and `in_stock` (can it be ordered right now? off = "Sold out" badge).
- **Discounts** with a canonical shape: percentage or fixed amount, restricted by date range, time window, and recurring weekdays; applied automatically at order time.
- **Modifiers**: grouped choices (e.g. "Size — required, pick one"), each choice with an optional extra cost, with min/max selection rules.
- **Extras**: add-on items attachable to a parent item, with min/max selection limits.
- **Dietary/allergen tags**: a per-restaurant tag catalog (14 system presets seeded per restaurant — Vegetarian, Vegan, Halal, Contains Nuts, Spicy, etc., each with colour and icon) applied to items; diners can filter the menu by them.
- A diner-side **preview drawer**, bulk stock toggling, search, and a per-restaurant sort mode (manual / A–Z / price).
- A one-time **"first-time menu approval"** step exists (`restaurant-setup/manager-actions/`): the restaurant's own owner/manager confirms the first menu batch before it goes live. This is restaurant-side self-approval — there is **no Dinify-admin menu-review step** in the code, and the decision field defaults to `'approve'`.

### 2.2 Upsell — ✅ Fully implemented & wired

A per-restaurant "You might also like" carousel. The owner configures it in the Menu page's Upsells tab (enable/disable, title, max items 2–6, hide-if-out-of-stock, hide-if-already-in-basket, pick and reorder items; `api/v1/restaurant-setup/upsell-config/`). The diner app renders it in the menu and basket and filters it live as the basket changes. Tapping an upsell item adds it directly (no modifier flow).

### 2.3 Tables module — split status

- **Setup View** (`/dining-tables`) — ✅ **Fully wired.** Dining areas (indoor/outdoor, smoking, accessibility), tables (number, display name, capacity, shape, status), a drag-and-drop **floor plan** (positions stored as `floor_x/y/width/height`), and **QR codes**: the portal generates QR images *in the browser* (`angularx-qrcode`) encoding the diner URL for each table, with a preview modal and a printable QR sheet (`tables/utils/qr-print-sheet.ts`). The backend stores only QR metadata (`has_qr`, `qr_mode`, `qr_regenerated_at`) — it does not generate images. Deleting is guarded: an area with tables, or a table with an unsettled order, is refused with the reason shown (HTTP 409 + `deletion_blockers()` on the models).
- **Service View** (reservations, waitlist, seated parties) — ⏸️ **Parked and hidden.** A full UI exists in the repo but is forcibly hidden (`TablesComponent.activeView` is hardwired to `'setup'`) and runs on mock data (`USE_MOCK_SERVICE = true`). Meanwhile the **backend is complete**: `Reservation` and `WaitlistEntry` models with full endpoints (`restaurant-setup/reservations/`, `waitlist/`), plus `table-actions/` endpoints (seat, clear, transfer, update-status, update-floor-plan). **Nothing in the shipped UI calls the reservation/waitlist/table-action endpoints** — they are backend-only orphans today.

### 2.4 Kitchen View / KDS — ✅ Fully implemented & wired

A real kitchen display system at `/kitchen` (`src/app/kitchen/`, backend `api/v1/kitchen/` in `orders_app/endpoints_kitchen.py`):

- Polls `kitchen/orders/active/` every 3 seconds (backing off to 5s/10s on failures, recovering automatically), showing ticket cards with table number, items + modifiers, elapsed age, status, and priority flag.
- Status lifecycle **new → preparing → ready → served**, enforced server-side as a strict one-step state machine. **Recall** steps backwards: served→ready within a 10-minute window (server-enforced), ready→preparing anytime.
- **Priority** flag toggle; **cancel/void** with reason — kitchen staff can void a `new` order freely, but once it's `preparing`/`ready` only an owner/manager can (a deliberate "goodwill gate"); `served` orders can't be cancelled without recalling first.
- **86 board**: kitchen can mark menu items sold-out / back in stock (`kitchen/menu-items/{id}/stock/`).
- All mutations are optimistic in the UI and revert if the server rejects them. Kitchen writes only the fulfilment fields — it can never touch payment state (enforced by partial saves in the backend).
- Staff whose only role is `kitchen` land here automatically on login.

### 2.5 Diner App (customer-facing ordering) — ✅ Fully wired through order placement; payment leg broken (section 4)

Public, anonymous (no login, no account). Covered step-by-step in section 3. Includes menu browsing with search/dietary-tag filtering, item detail with modifiers and extras, a basket, upsell, an allergen disclaimer banner, idempotent order submission, and an order-confirmation screen. **What it does not include:** any reachable payment screen (the screen exists but nothing links to it), any order-progress tracking, and any review-submission UI.

### 2.6 Dashboard (restaurant portal) — 🟡 Partially built (still on mock data)

`/dashboard` shows revenue, orders, tables, KDS-attention, reviews and payment-method cards with date-range pills and auto-refresh — but `DashboardService.USE_MOCK_DATA = true`, so **almost everything displayed is fake demo data** (exception: the Popular Items card pulls real menu data). The real backend endpoint exists and computes genuine aggregates from the orders table (`api/v1/reports/restaurant/dashboard/` and `dashboard-v2/`, `reports_app/controllers/restaurant/dashboard.py` — real SQL aggregations, not placeholders). Two caveats once it's switched on: (a) "gross sales" counts **paid** orders only, and since almost no order ever reaches `paid` (section 4), revenue would read ≈ zero; (b) report reads are not visibly tenant-scoped the way restaurant-setup reads are.

### 2.7 Reports / analytics ("Eatlytics") — backend 🟡, portal UI 🔵

- The name **"Eatlytics" appears nowhere in either repository** (verified by full-text search). If it is a brand you use for analytics, it has not made it into the code.
- **Backend**: a fairly rich report endpoint family exists and computes real aggregates: `api/v1/reports/restaurant/<name>/` with `dashboard`, `dashboard-v2`, `dashboard-reviews`, `sales-summary/listing/trends`, `diners-summary/listing/trends`, `menu-summary`, `transactions-summary/listing`; plus `api/v1/reports/dinify/...` for platform-level numbers.
- **Portal UI**: the Reports page (`/reports`) and Report Detail page are **empty components** — routed, but render nothing meaningful. The only report endpoint the portal actually consumes today is `transactions-listing` (used by the Payments and Billing pages).

### 2.8 Payments & billing surfaces — 🟡 (full detail in section 4)

- **Diner payment screen** (`/diner/orders` + `/diner/payment-details/:id`): complete mobile-money/card/tip/OTP form, correctly wired to the real backend endpoint — but **orphaned**: no button or link anywhere in the diner journey navigates to it.
- **Restaurant Payments page** (`/payments`): shows account info and a real daily transaction listing; the "Disburse Now" (cash-out) dialog exists but its save handler is **empty** — the button does nothing.
- **Billing page** (`/settings/billing`): ✅ real-wired — shows the restaurant's billing method (per-order surcharge vs monthly/yearly subscription fee), validity/expiry, subscription transaction history, and a working "Pay Now" that initiates a subscription payment via mobile money (`finances/transactions/`, `transaction_type='subscription'`).
- **Platform Admin Payments page** (`/mgt-app/payments`): same shape as the restaurant one; same incomplete disbursement form.

### 2.9 Reviews — 🟡 read side real, write side has no UI

- Portal Reviews page (`/reviews`): ✅ real — rating summary, distribution, paginated review list with date filters (`restaurant-setup/orderreviews/`).
- Backend accepts diner ratings/reviews per order or per item (`POST api/v1/orders/review/`, no login needed) and lets staff block abusive reviews (`block-review`).
- **But no diner-facing screen ever asks for a review**, so in practice no reviews can be created through the product. A second portal page, Reviews Management (`/reviews-management`), is 🔵 a scaffold.

### 2.10 Support — ✅ Fully implemented & wired

Two-sided ticketing. Restaurant side (`/support`): create and track issues with category (orders/KDS, menu, tables/QR, payments, reports, account, bug, other), impact level, and contact preferences; sequential references like `SUP-000123`. Dinify side (`/mgt-app/support`): platform-wide triage — filter, assign, set status (open → in progress → resolved → closed), keep internal notes (never shown to the restaurant) and a restaurant-visible resolution summary. Backend: `support_app`, `api/v1/support/issues/` and `support/admin/issues/`, properly tenant-scoped. (It supersedes a legacy `crm_app.ServiceTicket` — see 2.16.)

### 2.11 Notifications — backend ✅ exists, frontend 🔵 placeholder

The backend has a working notifications endpoint (`api/v1/notifications/`: list by user, mark-as-read). Both notifications pages (restaurant portal and admin portal) are **static scaffolds that make no API calls**. Nothing in the codebase visibly *creates* notifications for order/payment events either. Net effect: no user ever sees a notification.

### 2.12 Settings — ✅ mostly wired

Restaurant profile (name, location, logo, toggles such as "require order prepayments" — note: stored but **not enforced**, see section 4), branding (colours/logo, four-key `branding_configuration`), staff/user management, preset-tags management, and the Billing page above. Writes go through the backend's "Secretary" pattern: only fields whitelisted in `EDIT_INFORMATION` are editable; everything else is silently ignored.

### 2.13 Platform Admin portal (`/mgt-app`) — mixed

- **Restaurants screen** — ✅ real-wired and the heart of onboarding: list/filter restaurants, register a new restaurant (`restaurant-setup/admin-register-restaurant/`, including owner phone lookup + OTP), activate/deactivate, and **drill into any restaurant's own management portal** (the admin portal nests the entire restaurant portal under `/mgt-app/restaurants/rest-app/:id`).
- **Dashboard** — 🟡 mostly hardcoded demo numbers ("Cafe Javas", fixed charts); it does call the real `reports/dinify/dashboard/` endpoint but largely displays static data.
- **Support triage** — ✅ real (see 2.10). **Payments** — 🟡 (see 2.8). **Reports, Notifications** — 🔵 scaffolds.

### 2.14 Auth & identity — ✅ Fully implemented & wired

- **Staff/owners**: phone number + password login, then a 4-digit **OTP by SMS** (Yo Uganda; in dev mode the OTP is hardcoded `1234`). JWTs from SimpleJWT with 30-min access tokens and 7-day rotating, blacklist-on-logout refresh tokens. Tokens are stored in browser `localStorage` (an httpOnly-cookie migration is a known TODO). Self-service registration and forgot-password flows exist.
- **Roles**: platform roles `dinify_admin`, `dinify_account_manager`; per-restaurant roles `owner`, `manager`, `kitchen`, `waiter`, `finance` (via a `RestaurantEmployee` record per user per restaurant). Login routes kitchen-only staff to `/kitchen`, admins to `/mgt-app`, everyone else to the portal root (first accessible module, e.g. `/dashboard`); users with several restaurants get a picker.
- **Diners are anonymous** — no account, no login. The scanned table is their identity. (The order model *can* link a registered customer, but nothing in the diner flow creates or uses one; a phone number only enters the picture at payment time, for the mobile-money OTP.)
- **Tenant isolation**: backend reads are scoped to the caller's restaurants (`get_readable_restaurant_ids` / `can_read_restaurant`); cross-tenant requests return 404 so they don't even confirm existence.

### 2.15 Legal pages — ✅

Standalone public Privacy Policy, Terms & Conditions, and Cookie Policy pages.

### 2.16 Dead / legacy code (⚰️)

- `crm_app.ServiceTicket` — superseded by the Support module, though its endpoint is *still mounted* at `api/v1/crm/service-tickets/`.
- The old `KitchenTicket`/`KitchenTicketItem` KDS models — formally retired (migration `0030_retire_kitchen_tickets`); the KDS now reads orders directly.
- Legacy single-modifier fields on order items (`option`, `option_choice`, `options` flat list) — replaced by grouped `selected_modifiers`.
- `MenuItem.allergens` JSON — replaced by the tag system.
- The portal's old "Orders" page — removed entirely; live order handling is the KDS.
- Pesapal integration — an `authenticate()` method and nothing else, called by nothing.

---

## 3. End-to-end operational flows

Each step is labelled **[Customer]** (diner-facing), **[Staff]** (restaurant-facing), **[Admin]** (Dinify-facing), or **[Backend]** (no human surface).

### Flow A — Getting a restaurant live

1. **[Admin]** A Dinify admin registers the restaurant in the admin portal (name, owner phone, etc.) — `restaurant-setup/admin-register-restaurant/`. (A public `/register` self-signup also exists for creating user accounts.)
2. **[Staff]** The owner logs in (phone + password + SMS OTP) and lands in the restaurant portal.
3. **[Staff]** Builds the menu: sections, items, prices, photos, tags, modifiers, extras, discounts, upsell carousel.
4. **[Staff]** Confirms the first-time menu approval (one-time self-approval step) — the menu is now publicly visible.
5. **[Staff]** Creates dining areas and tables, arranges the floor plan, and prints the QR sheet generated in the browser. Each QR encodes `https://<frontend-host>/diner/h/<table-uuid>`.

### Flow B — A diner orders (the core loop; ✅ real end-to-end)

1. **[Customer]** Scans the table QR → lands on `/diner/h/<table-id>`. The app calls `orders/journey/table-scan/` (public). The backend validates the table (must exist, be enabled/active, not out-of-service; reserved tables are politely refused) and returns restaurant branding, table info, and any current open order on that table.
2. **[Customer]** Browses the menu (`orders/journey/show-menu/`, public): featured carousel, sections (schedule-filtered), search, dietary-tag filter, sold-out badges, discount badges, allergen disclaimer.
3. **[Customer]** Taps an item → detail page → picks required/optional modifiers and extras → adds to basket. Basket supports quantity edits and re-editing an item's choices. The upsell carousel appears in menu and basket.
4. **[Customer]** Confirms the order. The app calls `POST api/v2/orders/initiate/` with the items, table, and a client-generated idempotency key (so a double-tap or retry can't create duplicates). The backend atomically: checks the table doesn't already have an ongoing order, allocates a race-safe per-day order number, prices every line (applying any active discounts), snapshots item names/modifier labels/allergen tags onto the order lines (so later menu edits can't alter history), and flags anything that has gone unavailable.
5. **[Customer]** If some items were unavailable, a reconciliation sheet shows what was dropped and the revised total; the diner confirms. Then `PUT api/v1/orders/submit/` moves the order from `initiated` to `pending`. If the table already had an open order, the app currently treats that as success (a temporary shim, explicitly marked in code).
6. **[Customer]** Sees the "Order placed" screen: *"Your order has been sent to the kitchen. Someone will bring it to your table shortly."* — and that is the **end of the shipped diner journey**. The screen is deliberately payment-neutral; the only button is "Back to menu". There is no order tracking, no payment prompt, no review prompt, no SMS.

### Flow C — The kitchen works the order (✅ real end-to-end)

1. **[Staff — kitchen]** The KDS board (polling every 3s) shows the new ticket: table, items, modifiers, age, allergen tags.
2. **[Staff — kitchen]** Taps through **new → preparing → ready → served**; can recall within the rules; can flag priority; can 86 sold-out items; can void (`new` freely; `preparing`/`ready` requires a manager/owner; cancellation reasons are recorded).
3. **[Backend]** When fulfilment hits `served`, the table is considered free for the *next* order (occupancy is fulfilment-based). Payment state is untouched throughout — the kitchen cannot mark anything paid.
4. **Gap:** nothing notifies the diner at any of these transitions, and there is no waiter/runner surface — `served` is pressed in the kitchen.

### Flow D — Payment (🟡 broken as an end-to-end loop — see section 4)

As designed: **[Customer]** opens a payment screen, pays by mobile money (enters phone, gets an SMS OTP if new, approves the MoMo prompt) or card (redirect to gateway), optionally adds a tip; the backend records the gateway confirmation and marks the order paid.
As built: the payment screen exists and the backend initiation works, **but no link leads the diner to the screen, and no mechanism exists for the confirmation leg**, so orders effectively never become `paid` inside the system. Cash has no recording UI at all. Whatever happens at the table today, it happens **outside the product**.

### Flow E — Table lifecycle during service

What ships: occupancy is implicit (a table with an unserved order refuses a second order; scanning an occupied table resumes its session). The richer lifecycle — seat/clear/transfer actions, reservation seating, waitlist — is **fully built in the backend and parked in the frontend** (section 2.3). The shipped Tables page is configuration only.

### Flow F — Support

1. **[Staff]** Owner/manager files an issue from the portal with category and impact.
2. **[Admin]** Dinify staff triage in the admin portal: assign, progress the status, write a resolution summary (restaurant-visible) and internal notes (not visible).
3. **[Staff]** The restaurant sees status and resolution on their Support page. (No email/SMS notification of updates — they must look.)

### Flow G — Dinify gets paid (platform monetization)

1. **[Backend]** Each restaurant carries a billing configuration: `per_order` (a surcharge percentage with min/cap, plus `flat_fee`) or a `monthly`/`yearly` subscription fee.
2. **[Staff]** The Billing page shows method, validity and expiry, and for subscription restaurants offers **Pay Now** → initiates a real mobile-money subscription payment (`finances/transactions/`, `transaction_type='subscription'`).
3. **Gaps:** the per-order surcharge is **never added to order pricing** at order time (the fields exist and appear in the platform dashboard, but no code applies them to an order), and the subscription payment suffers the same missing-confirmation problem as all payments. So as built, neither revenue stream closes automatically.

---

## 4. Payment & mobile money (the detailed, honest picture)

This is the area where the gap between "looks built" and "works end-to-end" is largest. The summary up front:

> **Orders can be placed, cooked, and served entirely inside Dinify. Payment can be *initiated* against real gateways. But as built, there is no automated way for any payment to be *confirmed*, so `payment_status` effectively never becomes `paid` without manual server intervention.**

### 4.1 Pre-pay vs post-pay

The design intends to support both: tables and restaurants have `prepayment_required` / `require_order_prepayments` flags (editable in the portal as "Allow Prepayment"), and the flag is copied onto every order. **But it is enforced nowhere** — the order-submission code contains only a comment where the prepayment check should be (`orders_app/controllers/manage_order.py`). As built, every order flows to the kitchen unpaid: the system is effectively **post-pay** (or more precisely, pay-is-detached).

### 4.2 What a payment initiation actually does — ✅ real

`POST api/v1/finances/initiate-order-payment/` (public; `finance_app/endpoints/order_payments.py` → `OrderPaymentTransaction.initiate()` in `finance_app/controllers/tx_order_payment.py`):

1. Validates the order and amount; supports `payment_form` of `full` or `split` (partial amounts toward one order, with the running balance tracked on the order).
2. Requires an **SMS OTP** for mobile-money payers whose phone isn't already registered, and for all `manual_payment` (cash/cheque/bank) entries — OTPs are 4-digit, SHA-256-hashed, 5-minute expiry, sent via Yo Uganda SMS in a fire-and-forget thread (hardcoded `1234` in dev).
3. Creates a `DinifyTransaction` row (status `initiated`) tied to the order and the restaurant's `DinifyAccount` wallet.
4. Calls the gateway — these are **real HTTP integrations, not mocks**:
   - **Mobile money — Yo Uganda** (`payment_integrations_app/controllers/yo_integrations.py`): an XML `acdepositfunds` collection request that triggers the MoMo approval prompt on the payer's phone. ⚠️ The URL in code is Yo's **sandbox** (`https://sandbox.yo.co.ug/...`), not production. The call is fire-and-forget; Yo's response is logged to MongoDB (which is unreachable — so even that log is lost).
   - **Card — DPO / 3G DirectPay** (`controllers/dpo.py`): creates a payment token against DPO's **production** API and returns a redirect URL; the diner's browser is sent to DPO's hosted card page. A `verify_token` status-check method exists.
   - **Flutterwave** (`controllers/flutterwave.py`): a mobile-money charge implementation (with MTN/Airtel network detection) is written, but **nothing calls it** — the live payment flows use only Yo and DPO (verified: `tx_order_payment.py`, `tx_subscription.py` and `tx_disbursement.py` import only `YoIntegration`/`DpoIntegration`). 🔵 unwired.
   - **Pesapal**: 🔵 authenticate-only stub, called by nothing.
5. Tips: a tip amount can ride along; on successful processing it spawns a child `tip` transaction credited toward the order's waiter.

### 4.3 The missing leg: confirmation, callbacks, reconciliation — ❌ the broken chain

For a payment to complete, something must hear back from the gateway and run `OrderPaymentTransaction.process()`, which is the **only** code that updates wallet balances and sets `Order.payment_status = 'paid'` (when the remaining balance ≤ UGX 1). As built:

- **There are no webhook/callback HTTP endpoints at all.** `payment_integrations_app` has no URLs; nothing in `dinify_backend/urls.py` can receive a gateway notification.
- The intended substitute is a set of **management commands run by hand on the server**: `check_yo_transactions` / `check_dpo_transactions` (poll gateway status), `process_aggregator_responses` (work through gateway responses stored in MongoDB), and `process_transactions` (finalize confirmed transactions by calling `process()`).
- **No scheduler exists** — no Celery, no cron, nothing in the deploy pipeline runs these. The backend's own `BACKGROUND_TASKS.md` confirms this and additionally documents that **`check_dpo_transactions` crashes on a datetime import bug** and **`check_yo_transactions` has a broken ORM filter that likely matches zero records**.
- Several steps also depend on **MongoDB, which is unreachable** from the server — gateway responses are never stored, so `process_aggregator_responses` would find nothing even if run.

Net result: a diner could approve a MoMo prompt and be charged by the gateway, and Dinify's database would still show the order as `pending` forever, unless someone SSH'd into the server and ran commands manually (and even then, only the paths that don't depend on MongoDB or the buggy commands would work).

### 4.4 The orphaned diner payment UI

The diner app contains a complete payment experience — `/diner/orders` (choose momo/card, phone entry with OTP for new numbers, tip selector at 10/15/20%/custom, amount auto-filled from the open order) and `/diner/payment-details/:id` (transaction status display, fetched once, no polling). It correctly calls the real backend endpoint. **But it is unreachable**: no button, link, or redirect anywhere in the diner journey navigates to it (verified by searching the diner app for any navigation to that route), and the order-complete screen is explicitly written to be payment-neutral. A diner could only reach it by typing the URL.

### 4.5 Cash and "manual" payments

The backend supports `manual_payment` (cash/cheque/bank-transfer) entries — they're created already `confirmed` (skipping the gateway), but still need the never-run `process_transactions` command to actually mark the order paid. **No staff-facing UI exists to record a cash payment or "mark as paid"** — the portal Payments page is read-only and the KDS deliberately can't touch payment state.

### 4.6 Wallets, disbursements, refunds, and Dinify revenue

- Every restaurant (and tipped waiter) gets a `DinifyAccount` with per-method balances (momo/card/cash: actual, available, cumulative in/out/charges/refunds/disbursements). Balances are only ever updated by `process()` — so in practice they sit at zero.
- **Disbursement (cash-out)** is exposed in the API (`POST finances/transactions/` with `transaction_type='disbursement'` → Yo MoMo payout or bank record) — but the frontend's "Disburse Now" dialog has an **empty save handler**, so no one can trigger it from the UI. 🟡
- **Refunds**: a refund controller exists, and the transactions endpoint *accepts* `transaction_type='order_refund'` — but then has **no handler branch for it** (the request falls through unanswered). Effectively not implemented. 🔵
- **Dinify's cut**: surcharge percentage/min/cap and flat-fee fields exist per restaurant, the transaction model has `revenue_collected` plumbing, and the platform dashboard reports cumulative surcharge — but no code adds a surcharge to an order's price at creation. Subscription billing initiation is real (section 3, Flow G) but completion hits the same §4.3 wall.

### 4.7 Money handling quality

All monetary fields are `DecimalField` (a CI guard fails the build if a money `FloatField` ever appears in a model). Currency is UGX everywhere, amounts rounded to whole shillings for the gateways. There is **no tax and no service-charge** calculation anywhere — order totals are item prices + modifier costs − discounts, nothing else.

---

## 5. Data model

### 5.1 The key entities and how they relate

```
User ──< RestaurantEmployee >── Restaurant ──< DiningArea ──< Table
 │            (roles per             │                          │
 │             restaurant)           ├──< MenuSection ──< MenuItem ──< MenuItemTag >── RestaurantTag
 │                                   ├──< RestaurantTag (per-restaurant catalog)
 │                                   ├──1 UpsellConfig ──< UpsellItem → MenuItem
 │                                   ├──< Reservation / WaitlistEntry      (backend-only today)
 │                                   ├──< SupportIssue
 │                                   ├──1 DinifyAccount (wallet)──< DinifyTransaction >── Order
 │                                   └──< Order ──< OrderItem → MenuItem
 └── (optional Order.customer — unused by the anonymous diner flow)
```

Notable relationship rules:

- `Order.table` is `on_delete=PROTECT`: order/financial history can never be silently destroyed by deleting a table. Areas can't be deleted while they contain tables; tables can't be deleted while they have unsettled orders ("unsettled" is payment-aware: anything not paid/cancelled/refunded).
- `OrderItem` rows carry **snapshots** (item name, human-readable modifier labels, allergen tags, unit prices at order time) so the kitchen and history are immune to later menu edits. Extras are child `OrderItem`s linked by `parent_item`.
- `DinifyTransaction` links a payment attempt to an order, an account, a gateway (`yo`/`dpo`), a mode (`cash`/`momo`/`card`/`ova`/`bank` — the last two unused), and optionally a `parent_transaction` (tips, refunds).
- Per-restaurant **daily order numbers** come from a row-locked `RestaurantDailyOrderCounter` (race-safe), alongside a unique `(restaurant, client_order_id)` idempotency constraint.
- Soft-deletes everywhere (`deleted` flags) rather than hard row deletion.

### 5.2 The three status axes on an Order (the most important design idea)

An order carries **three independent status fields**, deliberately owned by different actors:

| Axis | Values | Written by |
|---|---|---|
| `fulfilment_status` | `new → preparing → ready → served` (+ recall) | Kitchen (KDS) only |
| `payment_status` | `pending → paid` / `failed` | Finance code only (i.e. `process()` — see §4.3) |
| `order_status` | `initiated → pending → preparing → served → paid` / `cancelled` / `refunded` | Order flow + finance; kitchen may set only `cancelled` |

Kitchen endpoints save with explicit `update_fields` so they can never clobber payment data, and vice versa. Table occupancy uses the *fulfilment* axis (table frees when served); table deletion-safety uses the *payment* axis (table deletable only when settled). This separation is consistently enforced and is real, working code.

### 5.3 State flow through a typical service (as built)

1. Diner submits → Order(`initiated`/`pending` payment/`new` fulfilment) + snapshot OrderItems; totals computed (`total_cost`, `discounted_cost`, `actual_cost`, `balance_payable = actual_cost`).
2. Submit → `order_status='pending'`. Kitchen advances `fulfilment_status` to `served` (timestamps, audit fields, optional priority along the way).
3. *Intended*: payment initiation creates a `DinifyTransaction(initiated)`; gateway confirmation flips it to `success`, wallet balances update, `total_paid` accrues, and at balance ≤ 1 the order becomes `paid` (and `order_status='paid'` if already served), spawning any tip transaction.
4. *Actual*: step 3 stops at `initiated` (§4.3). Orders accumulate as served-but-pending; the table stays open for new orders (occupancy is fulfilment-based) but would block its own deletion (payment-based).

---

## 6. Integrations & external dependencies

| Integration | Used for | Status |
|---|---|---|
| **Yo Uganda — Payments** | Mobile-money collection (and disbursement code) | ✅ real XML API calls, ⚠️ **sandbox URL** in code; fire-and-forget; no callback handling (§4.3) |
| **Yo Uganda — SMS** | Login & payment OTPs | ✅ wired (always in a background thread); ⚠️ known DNS-resolution problems from the production server |
| **DPO / 3G DirectPay** | Card payments (hosted redirect page) | ✅ real token-creation against the production API; verify-token exists; no webhook |
| **Flutterwave** | Alternate mobile-money charge (MTN/Airtel detection) | 🔵 charge code written but never called from any flow |
| **Pesapal** | (intended payments) | 🔵 authenticate-only stub, never called |
| **MongoDB Atlas** | Archival copies of records, action logs, gateway response logs | 🟡 all writes are try/except + background-thread so the app survives, but the cluster is **unreachable from EC2** — effectively no audit trail |
| **SMTP email** | OTP delivery in dev/test environments | ✅ configured |
| **Firebase Hosting** | Frontend hosting + deploy pipeline | ✅ |
| **GitHub Actions** | CI and auto-deploy in both repos | ✅ |
| **AWS (EC2 + RDS)** | Backend compute + PostgreSQL | ✅ |
| Media/images | Local disk on EC2, Pillow auto-resize | ✅ (no S3/CDN) |

No other third-party services (no push notifications, no analytics SDKs, no error-tracking like Sentry, no task queue) are integrated.

---

## 7. Customer-facing vs staff-facing surface map

### What a **customer (diner)** can ever touch

- The QR-scan menu (`/diner/h/<table>`): browse, search, filter by dietary tags, see prices/discounts/sold-out states and the allergen disclaimer.
- Item detail with modifiers and extras; the basket with upsell; the unavailable-items reconciliation sheet.
- Order submission and the "Order placed" confirmation screen.
- *(Technically present but unreachable: the payment form and payment-status pages.)*
- The legal pages.
- **That's all.** No account, no login, no order tracking, no payment prompt, no receipts, no review form, no order history.

### What **restaurant staff** touch

| Role | Surfaces |
|---|---|
| **Owner / Manager** | Full portal: Dashboard (mock data), Menu + Upsell, Tables Setup + QR printing, Reviews (read), Payments (read), Billing (incl. subscription Pay Now), Settings (profile/branding/users/tags), Support; plus the KDS, including its manager-gated actions (void in-progress orders, priority) |
| **Kitchen** | The KDS board only (auto-landing on login): advance/recall tickets, priority, void new orders, 86 items |
| **Waiter / Finance** | Roles exist in the data model; **no surface in the shipped UI is specific to them** (a waiter is referenced only as the tip recipient) |

### What **Dinify (platform) staff** touch

Admin portal: restaurant onboarding and status management, drill-into any restaurant's portal, support triage, platform dashboard (mostly hardcoded), payments page (read), report/notification scaffolds.

### Who operates what in the core loop

Order **entry is customer-only** (there is no staff order-entry screen of any kind). Order **fulfilment is kitchen-only**. **Payment is operated by nobody** today (§4). Menu, tables, and configuration are owner/manager work.

---

## 8. Implementation status & gaps — consolidated honest view

### The five headline gaps

1. **No payment ever completes inside the system.** Initiation is real; confirmation has no webhooks, no scheduler, broken/manual reconciliation commands, a MongoDB dependency that's down, and a diner payment UI that nothing links to. (§4)
2. **The diner journey ends at "order placed."** No order tracking, no notification (SMS infrastructure exists but no order events trigger it), no payment prompt, no review prompt.
3. **There is no staff order entry.** A waiter cannot key in an order; `server_assisted` exists only as a value in the data model. If a customer won't scan the QR, the product has no path for that order.
4. **Analytics are not usable yet.** The portal Reports page is empty, the Dashboard runs on mock data, and the (real) backend revenue metrics would read ~zero because they count `paid` orders. "Eatlytics" does not exist in the code.
5. **The Tables Service layer (reservations, waitlist, seat/clear/transfer) is built in the backend and parked in the frontend** — invisible to users.

### Full status table

| Area | Status | One-line truth |
|---|---|---|
| Menu (sections, items, pricing, discounts, modifiers, extras, tags, images, ordering) | ✅ | Complete both sides |
| Upsell | ✅ | Complete both sides |
| Diner ordering (QR → menu → basket → order) | ✅ | Complete; anonymous; idempotent |
| Kitchen KDS | ✅ | Complete; strict state machine; well-engineered |
| Tables — Setup + QR printing | ✅ | Complete (QR images made in the browser) |
| Tables — Service View / reservations / waitlist / table actions | ⏸️ backend ✅ / frontend hidden | Backend-only orphan |
| Auth, roles, tenant isolation | ✅ | Solid; tokens in localStorage (known TODO) |
| Support (both sides) | ✅ | Complete |
| Settings (profile, branding, users, tags) | ✅ | Complete |
| Billing (subscription display + Pay Now) | 🟡 | Initiation real; completion blocked by §4.3 |
| Payment initiation (momo/card/tips/split/OTP) | ✅ | Real gateway calls (Yo URL is sandbox) |
| Payment confirmation / reconciliation | ❌ | No webhooks; unscheduled, partly buggy manual commands |
| Diner payment UI | 🟡 | Built but orphaned (unreachable) |
| Cash recording / mark-as-paid | ❌ | No UI, no completing path |
| Disbursements (cash-out) | 🟡 | API real; UI save button empty |
| Refunds | 🔵 | Accepted by validation, no handler |
| Dinify per-order surcharge | 🔵 | Fields exist; never applied to prices |
| Portal Dashboard | 🟡 | Mock data on; real endpoint ready behind flag |
| Reports backend | 🟡 | Real aggregations; revenue ≈ 0 until payments close; scoping unverified |
| Reports / Notifications / Reviews-management pages (portal) | 🔵 | Empty scaffolds |
| Notifications backend | 🟡 | Endpoint works; nothing creates or displays notifications |
| Reviews | 🟡 | Staff can read; diners have no way to write |
| Platform admin — restaurants/onboarding | ✅ | Real, including nested drill-in |
| Platform admin — dashboard | 🟡 | Mostly hardcoded numbers |
| Flutterwave | 🔵 | Code written, never invoked |
| Pesapal | 🔵 | Stub |
| MongoDB archival / action logs | 🟡 | Code fine, cluster unreachable → silent no-op |
| crm_app, KitchenTicket models, legacy option/allergen fields | ⚰️ | Dead/superseded |

---

## 9. Usage assumptions to confirm (only you can answer these)

The code cannot reveal real-world operations. Please confirm or correct:

1. **Is QR self-ordering actually used in live restaurants today**, or do staff place orders on the customer's behalf (e.g. by scanning the table QR on a staff phone)? The code has no staff order entry, so any staff-taken order must be going through the diner app or outside the system.
2. **How is payment collected today in practice?** Given §4, we assume cash/MoMo is handled person-to-person outside Dinify and nothing is recorded in the system. Is that right? Has any real MoMo or card payment ever been completed through Dinify?
3. **Yo Uganda account status**: the code points at Yo's *sandbox*. Do you have production Yo credentials/URL anywhere (e.g. only in the server's environment file)? Same question for DPO and Flutterwave — which gateway is the intended primary?
4. **Are printed QR sheets actually deployed on tables** at any pilot restaurant?
5. **Which environment is "live"?** The visible deploy target is UAT (`dinify-uat.web.app`, `api-test.dinifyapp.com`). Is anything running against `api.dinifyapp.com` production with real restaurants?
6. **How are diners told their food is ready** (if at all) — purely by a server bringing it, as the order-complete copy implies?
7. **Do any restaurants pay Dinify today** (subscription or surcharge), and if so, how is that money actually collected/tracked given the gaps above?
8. **Who runs the platform admin portal day-to-day**, and is restaurant onboarding always done by Dinify staff (vs self-serve)?
9. **The "waiter" and "finance" roles** exist in the data model with no screens — are these planned, or leftovers?
10. **Tips**: the tip flow credits a waiter account — but the diner flow never assigns a waiter to an order. Is tipping expected to be used, and how would the tip reach a person?

## 10. Open questions & ambiguities (what the code left unclear)

1. **Yo sandbox vs production** — hardcoded sandbox URL (with credentials from environment variables); unclear whether this is intentional UAT configuration or an oversight that would also ship to production.
2. **`qr_mode` (`menu_only` / `order_pay` / `order_only`)** is stored per table but **never enforced in the diner app** — every scanned table gets the full ordering experience regardless.
3. **Report metric definitions** are not reconciled with finance: e.g. "gross sales" sums `total_cost` of paid orders (pre-discount?) rather than `actual_cost`; diner counts treat every anonymous order as `customer=None`, so "new/repeat diners" can't mean much with the current anonymous flow.
4. **Report endpoint tenant-scoping**: restaurant-setup reads are rigorously scoped; the reports endpoints' scoping was not evident in the reviewed code — worth a security review before exposing real data.
5. **The order-submit "existing order" shim**: when a table already has an open order, the diner app treats the rejection as success (marked in code as temporary pending an orders module). Adding to an existing order exists in the API (`v2 add-items`) but the diner UI doesn't use it.
6. **`ova` and `bank` payment modes** and the `pending_revenue_acknowledgement` processing status exist as choices with no implementing flow.
7. **`order_status` vs `fulfilment_status` overlap** (`preparing`, `served` exist on both axes): the kitchen axis is clearly authoritative for operations; several v1 endpoints (`orders/prepare/`, etc.) still write the legacy axis and appear to predate the KDS — likely v1 leftovers, but they remain callable.
8. **Notification creation**: a read/mark-read endpoint exists, but no code path that *generates* notifications was found; the intended producer is unclear.
9. **The login-500 regression** referenced in repo docs is marked resolved (June 2026), but token storage in `localStorage` and the 403-forces-logout interceptor behaviour remain known sharp edges.
10. **Multi-restaurant users**: supported in auth (restaurant picker at login), but several flows assume a single active restaurant per session; behaviour for a user who is, say, owner of one restaurant and kitchen staff of another is untested territory in the code.

---

*Compiled June 2026 from `mugak1/Dinify-Frontend` and `mugak1/Dinify-Backend` source code only — no runtime systems, server configuration, or production data were inspected.*
