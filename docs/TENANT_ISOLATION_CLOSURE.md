# Tenant-Isolation Closure — Frontend (TENANT-ISO-PR6B)

> **Engineering closure record, not a certification and not a penetration test.**
> It documents what the frontend tenant-boundary regression suite proves, at
> which commits, under which threat model — and what it does **not** prove. It is
> the counterpart to the backend record
> (`dinify_backend/tenancy/TENANT_ISOLATION_CLOSURE.md`, PR6A) and only asserts
> what the **frontend** can actually observe.

## Narrow closure statement

At the audited commits below, the anonymous-diner and selected-restaurant
frontend paths have **no known critical or high-severity tenant-isolation defect
under the tested threat model**. The capability transport, request-body
authority, selected-restaurant scope and QR lifecycle are exercised by
behavioral regression specs that run in CI.

We do **not** claim the whole app is perfectly secure, that every future feature
is automatically tenant-safe, that all OWASP categories were audited, or that
this suite replaces a penetration test. The **backend** is the authority on
server-side tenant scoping; the frontend cannot and does not prove backend
enforcement — it proves the client never *weakens* the boundary (no raw-UUID
authority, header-only bearer transport, no id smuggling in bodies, no diner/JWT
channel bleed, no empty-credential QR, no stale-credential stranding).

## Audited commits

| Repo | Commit (audit base) |
|---|---|
| mugak1/Dinify-Frontend | `662ee05708e18cd04726cc88a033b2f7e058e90c` |
| mugak1/Dinify-Backend | `fa3b94d0dd07134e4ff8f65cc4bc1dde0c213753` |

Linked PR: **PR6A** (backend). Neither PR auto-merges; there is no runtime
cross-repo import or pinned clone — the contract constants are asserted
independently on each side (see Cross-repo parity).

## Threat actors exercised

Unauthenticated diner (no capability); caller holding only a raw table UUID;
caller holding a QR credential; caller holding a table session; caller with a
tampered/expired/denied capability; a staff user with stale diner state; a
multi-membership staff user. The specs drive the real interceptors, the
`DinerSessionService` state machine, the pure QR-URL builder and the
`AuthenticationService` scope getter.

## Invariants (and the spec that proves each)

The consolidated cross-cutting matrix + parity lives in
`src/app/_security/tenant-isolation-closure.spec.ts`. The CI gate runs it
**alongside** the deep specs it builds on (it does not replace them).

| # | Invariant | Proving spec |
|---|---|---|
| F1 | The QR credential rides `X-Diner-Credential` on the scan only; the session rides `X-Diner-Session` on downstream diner calls only; both are header-only (never URL/body) | `_security/tenant-isolation-closure.spec.ts` §A/F; `_helpers/diner-session.interceptor.spec.ts` |
| F2 | The diner channel and the staff-JWT channel are mutually exclusive: a signed-in staff user rides JWT and gets no diner header even on a diner endpoint; an anonymous diner request gets no `Authorization` header despite stale diner state | `_security/tenant-isolation-closure.spec.ts` §A/F (both interceptors live) |
| F3 | The capability lives in sessionStorage + in-memory signals only — never localStorage, never the console; `expireSession` keeps the credential (silent re-mint), `invalidateCredential` sets `needsRescan`; `retainSessionThrough` survives a checkout storage clear | `_security/tenant-isolation-closure.spec.ts` §A/F; `_services/diner-session.service.spec.ts` |
| F4 | The `?c=` credential is captured once and scrubbed from the address bar; a raw table UUID is never authority | `diner-app.component.spec.ts` |
| F5 | The order-initiate body omits restaurant + table ids (scope derives from the session); submit/details/payment/review rely on the session channel; the UI route table id is never downstream authority; stale/unavailable reconciliation stays intact | `diner-app/basket/basket-body/basket-body.component.spec.ts` |
| F6 | The public menu request sends no `ignore-approval` on cold load or background revalidation; management preview does not use the anonymous endpoint as a bypass | `diner-app/menu/menu.component.spec.ts` |
| F7 | The QR URL requires a non-empty credential — an empty/blank credential yields `null`, so nothing can render/copy/download/open/print; the credential is URL-encoded, never raw | `_security/tenant-isolation-closure.spec.ts` §D (`getTableQRUrl`); `tables/components/qr-code-preview-modal/*.spec.ts` |
| F8 | Rotation is single-request-guarded (one confirm → one request; rapid clicks cannot double-rotate); success swaps in the server credential; failure preserves the old credential; the rotation response is strictly parsed (never locally fabricated); ordinary edits never emit rotation metadata; Generate-Missing never rotates active tables | `tables/components/tables-setup-view/*.spec.ts`; `tables/services/tables.service.spec.ts` |
| F9 | Post-login scope reads the login-SELECTED membership (`AuthenticationService.currentRestaurantRole`, backed by `rest_role`), never a silent `restaurant_roles[0]` fallback | `_security/tenant-isolation-closure.spec.ts` §E; `kitchen/services/kitchen-order.service.spec.ts`, `kitchen-stock.service.spec.ts`; `restaurant-mgt/menu/menu.component.spec.ts` |
| F10 | Cross-repo contract constants (header names, scan route, session-gated routes, 400 expiry + 404 denied messages, QR URL shape) match the backend | `_security/tenant-isolation-closure.spec.ts` §14 |

## CI command (the closure gate)

`npm run test:tenant-boundary` runs the `_security` closure spec plus the deep
specs above, in `ChromeHeadlessNoSandbox`. It is wired as a named, fail-fast step
**before** the full `test:ci` in both `scripts/verify.sh` and
`.github/workflows/ci.yml` (`type-check` → `lint` → **Tenant-isolation closure
gate** → full `test:ci` → `build:prod`). It does not duplicate the full suite.

## Request-body authority rule

Anonymous diner requests derive their restaurant + table **entirely from the
`X-Diner-Session` header** the backend issued. The client never places restaurant
or table ids in an order-initiate/submit body as authority, and the UI route's
`:table` segment (and the QR URL's `:table` path hint) is a display aid only —
the backend derives the table from the signed credential/session.

## Selected-restaurant rule

Every post-login, restaurant-scoped surface reads
`AuthenticationService.currentRestaurantRole` (backed by `rest_role`, the
membership picked at login). `restaurant_roles[0]` remains **only** the
single-membership auto-select convenience in `login.component.ts` (guarded by
`length === 1`) — it is never used as post-login authorization/scope, so it is
NOT globally banned.

## QR lifecycle

Activate (`has_qr=true`) and rotate (`regenerate-qr`) are separate operations.
Rotation bumps the backend generation, revoking every outstanding credential and
live session for that table; the client sends only `{ table_id }` (the backend
resolves the restaurant server-side), strictly parses the signed response
(`id`/`qr_version`/`qr_regenerated_at`/`qr_credential`), and only then swaps in
the new credential. A failed rotation leaves local state untouched (no false
revocation, no stranding on a dead credential). Ordinary table edits never emit
`qr_regenerated_at` or alter the generation.

## Residual risks / assurance limits

- Proves the **tested threat model**, not the absence of all defects; not a
  penetration test; not a whole-app guarantee.
- The frontend cannot prove **backend** tenant enforcement — that is the backend
  closure record's job. This suite proves the client never weakens the boundary.
- DOM-disclosure coverage (the QR credential never rendered in text/aria/tooltip/
  data attributes) rests on the QR-preview component spec; the closure spec adds
  the service/console/localStorage-level disclosure proof.
- `localStorage`→httpOnly-cookie migration for the staff session is deferred
  (needs backend coordination); the diner capability already avoids localStorage.

## Re-audit triggers

Re-run this audit when any of these change: the diner capability transport
(`DinerSessionService`, `DinerSessionInterceptor`, header names, storage channel);
the `?c=` capture/scrub in the diner shell; the QR URL builder or the rotation
flow (`qr-print-sheet`, `tables.service` rotation, the setup-view rotation
guard); the order-request builders (basket-body); the public menu fetch; the
`AuthInterceptor` / selected-restaurant scoping; or the cross-repo contract
constants.

## UAT adversarial smoke (dedicated UAT fixtures — no real customer data)

Mirrors the backend record §13 from the client: scan a valid A table QR → session
issues + menu loads; raw-UUID / query-string credential+session → denied; with an
A session attempt B order/payment/review → denied; rotate A's QR → old credential
fails, old session fails, new credential works, B unaffected; rapid double
rotation → one effect; ordinary table edit with `qr_version`/`qr_regenerated_at`
→ ignored; empty-credential table → no QR renders/copies/prints; switch
membership → later requests use the newly selected restaurant.
