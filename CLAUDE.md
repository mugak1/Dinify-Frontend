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
- A QUOTE HAS A LIFETIME, AND THE CLIENT NEVER DECIDES IT IS DEAD (D06): ✅ the
  server now enforces when a saved draft may still become an accepted order, and
  this client's whole job is to carry that honestly. Paired backend: `orders_app`
  D06 / `BREAKING_CHANGES.md` §16.
  **ONE VOCABULARY, IN ONE PLACE** — `_shared/order/quote-transition.ts`. The
  distinction it exists for is TRANSIENT vs TERMINAL, and it is not a nicety: a
  restaurant that paused or a table taken out of service leaves the quote ALIVE,
  so re-pricing there would throw away a perfectly good quote and ask the diner to
  agree to the same amount again while the kitchen is closed; an expired quote or
  a changed purchase has been RECORDED by the server as finished, so offering
  Retry is a dead end — the command has already been refused and can never be
  accepted. Before this the basket matched two codes by hand
  (`reason === 'legacy_pricing_version'`, `reason === 'quote_ref_stale'`) in a
  component that is MOUNTED TWICE on desktop, which is exactly how two mounts end
  up disagreeing about whether a quote is finished. **A fourth answer is
  `unknown`, and it is a real answer rather than a parse failure**: a newer server
  may add a reason, and guessing it transient loops a dead quote while guessing it
  terminal discards a live one. `retired` is READ from the closure the server
  recorded, never inferred from the disposition — `quote_unverifiable` needs a
  fresh quote and retires nothing.
  **THE STATE MOVE LIVES IN THE COORDINATOR** (`applyQuoteRefusal`), so both
  mounts make it identically: TERMINAL and REPRICE settle the issued command and
  **KEEP THE KEY** (the basket is unchanged, so it is still the same purchase, and
  a fresh key would turn one attempt into two orders), TRANSIENT and UNKNOWN move
  nothing. A failed durable settle downgrades to `unknown` rather than licensing a
  re-price on a record that still names an unsettled command.
  **THE CLIENT ASKS THE SERVER RATHER THAN DECIDING.** `order_details.quote_policy`
  publishes a DEADLINE, and it is ADVISORY: the server samples its clock after its
  locks and that decision is the one that counts, so concluding "expired" from this
  device's clock would be wrong on any skew. When the deadline has passed here,
  `confirmQuote` calls **`PUT orders/retire-quote/`** — which answers
  `quote_still_valid` (submit as the diner asked), `quote_closed` (re-price) or
  anything else (surface a Retry; a round trip that did not answer is not an
  answer, and must never become permission to submit). Attempting an acceptance to
  find out is the wrong alternative: when the quote is fine it SUCCEEDS, claiming a
  table and sending food to a kitchen in order to ask a question.
  **THE DEADLINE IS GATED ON `quote_protocol`, NOT ON THE OBJECT'S PRESENCE.** The
  level is the promise and the object is data; an absent level is 0, and 0 does NOT
  mean "quotes never expire here" — it means the server has not said. **It is a
  SEPARATE level from `checkout_protocol`, which stays 3 and is untouched**: one
  answers "can an uncertain checkout be retried and recovered", the other "may this
  quote still be accepted", and a client can want either without the other.
  **`quoteRetired` CHANGES WHAT IS SAID, NEVER WHAT IS DONE** — the re-price is
  identical for a terminal and a reprice refusal, and the notice is shown only when
  the server really retired the quote, because "your order can no longer be placed"
  is otherwise a claim nobody made. **AND IT IS READ, NOT INFERRED** (Codex P2 on
  PR #673, valid): both component sites set it from `refusal.disposition ===
  'terminal'`, which is a statement about the REASON, while the notice is a
  statement about the server having RECORDED a closure — and `readQuoteRefusal`
  keeps those apart on purpose (`retired: closure !== null`, absent AND unreadable
  alike). They agree on the paired backend, where all three terminal reasons carry
  `quote_closure`; the component must not be the thing that makes them agree, or a
  response that carried no closure would still have the diner told one was written.
  The two are settled from the SAME field on both paths — the submit failure and
  the `retire-quote` enquiry's error handler — and the third site, the enquiry's
  200 `quote_closed`, stays a literal `true` deliberately: there is no refusal
  object there, the SERVER stated the outcome, and the route claims that word only
  when it actually wrote or found a closure. It is cleared by a DELIBERATE Checkout press
  (`initiateOrder`) and not by `placeOrder`, which is the re-price itself and would
  erase the notice before the sheet meant to carry it had rendered.
  `ErrorInterceptor` forwards the structured body for `orders/retire-quote/` as it
  already does for `orders/submit/`, **and now for 409 as well as 400** — the
  already-accepted conflict is the one answer that must never be re-sent, and
  flattened to a sentence it would classify as `unknown`. The route is on the diner
  capability allowlist in `_security/diner-capability-contract.ts` (six routes now);
  that classifier fails CLOSED, so a missing entry does not degrade — the call goes
  out with no session and the backend answers it as an unauthenticated caller
- **A CLOSED QUOTE PRODUCES ONE NEW ATTEMPT, WITH A NEW KEY (D06/G3b).** The
  transition above settles the issued command and KEEPS the key on both a TERMINAL
  and a REPRICE refusal — right for one of them and a dead end for the other, and
  they arrive through the same branch. `quote_ref_stale` means the server re-read
  the order and only the reference moved, so the same purchase must reuse its key.
  A CLOSURE is different: the key is BOUND to the order the closure was written
  against, so the re-price `initiate`s under it, D04 REPLAYS the same retired
  draft, the review sheet renders a quote that can never be paid, submitting it is
  refused identically, and the diner loops with no in-app escape.
  **`CheckoutCoordinatorService.renewAfterClosure()` is the one primitive** that
  ends it: ONE new persisted attempt carrying the SAME `request` and `scope` (the
  basket has not changed — it is a new attempt at one purchase, not a new
  purchase) under a NEW key, linked by `CheckoutRecord.replaces`. It never
  reprices the old order and never deletes or contradicts the closure, which is a
  server fact this client cannot write. **EXACTLY ONE SUCCESSOR**: both mounts can
  hold the same refusal, so a caller may name the record it decided about and a
  call naming one that is no longer current answers `superseded` — which the
  component treats as SUCCESS, because another mount already did the thing it
  wanted. **IT IS REFUSED WHILE AN ACCEPTANCE IS OUTSTANDING** — a renewal
  abandons the key that is the only way to resolve an unsettled command, which is
  exactly how a diner ends up with two orders — and the durable write is verified
  before the key is returned, so a storage that silently drops it sends nothing.
  **THE RECORD VERSION DELIBERATELY DOES NOT MOVE for `replaces`.** Bumping would
  make every record this build writes `unsupported` to the previous one, and an
  `unsupported` record BLOCKS — a rollback mid-checkout would strand a diner with
  an order in flight, to protect a field that carries no guarantee (the
  one-successor rule is enforced by comparing the CURRENT record, never by reading
  `replaces`). An older build ignores the key and loses nothing it relied on.
  **THE SECOND SITE IS THE ONE WITHOUT A REFUSAL.** `initiate` can hand back a
  retired quote with no failure involved, because the key is bound to a purchase
  and a replay returns whatever order it was used for — retired since by a refusal
  whose response was lost, by the other mount, or by `retire-quote`. So the
  initiate handler reads the response itself through `readPublishedClosure`, which
  is **gated on `REQUIRED_CLOSURE_PROTOCOL` (2), a SEPARATE constant from
  `REQUIRED_QUOTE_PROTOCOL` (1)**: a level-1 backend enforces the lifetime and
  announces a closure only on the refusal, so an absent `quote_closure` on its
  read says NOTHING and must never be read as "not closed" — folding the two
  constants would also silently stop a level-1 server's deadline being consulted.
  That reader is gated while `readQuoteRefusal`'s closure is NOT, and the
  asymmetry is deliberate: a refusal is the direct answer to a command this client
  issued, a read is a projection whose availability is what the level states.
  The renewal there is **ONCE PER CHECKOUT EPISODE** (`renewedThisEpisode`, reset
  by the deliberate `initiateOrder()` press and NOT by `placeOrder`, which is the
  re-price itself) — a renewal that comes back closed again is a server
  contradicting itself, and looping would be a client-driven order storm. Pinned
  by `checkout-coordinator.renewal.spec.ts` (11) and
  `basket-body.quote-renewal.spec.ts` (13); removing either wiring site fails
  exactly 2, and ungating the closure reader fails the level control
- **THE ENQUIRY'S ANSWER IS VALIDATED AND CORRELATED, LIKE EVERY OTHER (D06/G4).**
  D04 made this standard for ACCEPTANCE answers — an answer is acted on only once
  it is shown to be about this key, this order and this scope, with the
  operation's identity FROZEN AT ISSUANCE rather than re-read when the reply
  lands. The D06 enquiry never joined it: `renewQuote` read `response.outcome`
  and acted, having checked nothing about what the answer was about — and
  `quote_still_valid` is the answer that leads to SUBMITTING an order. Four
  things changed, all of them the same things D04 closed on its own side.
  **`readQuoteAnswer` IS THE ONE READING**, and the correlation rule is
  CONTRADICTS, NOT CONFIRMS: an answer naming a DIFFERENT order or reference is
  refused, while one naming NEITHER is honoured, because that is an older server
  answering the request it was sent — refusing it would leave every pre-G4
  backend unable to complete a checkout whose deadline had passed, a worse
  failure than the one being guarded against. It reads the RESPONSE directly and
  not through `body()`, which finds a REFUSAL body and keys on a `reason` a
  successful enquiry does not carry; reading a 200 through it made every
  `quote_still_valid` unreadable.
  **IDENTITY IS FROZEN THROUGH THE SAME `CheckoutOwner`** every acceptance
  consumer uses, rather than a second mechanism beside it. The old guard was
  `issued !== this.attemptSeq` — a process-local counter that survives nothing,
  names no operation and restarts at 0 on every load, which is exactly the
  identity D04 replaced. A record LOST between the review and the confirmation is
  its own answer: there is nothing to bind to, so nothing is submitted AND the
  diner is told, because a silent return would leave the CTA spinning with
  nothing said.
  **THE RETIRED ANSWER RENEWS** (G3b's primitive) instead of re-pricing under the
  dead key — the most direct closure signal the client ever gets was the one site
  G3b had not reached. It would have self-healed at the initiate handler one
  wasted round trip later, which is not a reason to send a request whose answer
  is already known.
  **AND THE D06 LEVEL IS REMEMBERED** (`CheckoutRecord.quoteProtocol`, monotonic,
  noted by BOTH initiate consumers and by the enquiry) — kept apart from
  `protocol` because the two are separate promises that move independently. It is
  what makes a LATER response's silence about a closure readable as "not retired"
  rather than "this server has never said". Pinned by
  `basket-body.quote-answer.spec.ts` (13); each of the four halves fails exactly
  2 when reverted. **One pre-existing fixture was COMPLETED rather than the rule
  relaxed**: three `basket-body.quote-lifetime.spec.ts` cases opened the review
  sheet with NO reserved record, a state production cannot reach, and now reserve
  one unless the case deliberately established an outstanding command.
  **AND A DESTROYED INSTANCE GIVES THE FLIGHT BACK** (Codex P1 on PR #674, valid).
  G4's `mine()` guard returns on BOTH of the enquiry's callbacks once the routed
  instance is gone — correctly, since an answer must not place an order for a
  screen the diner has left — but nothing then released the claim `confirmQuote`
  took before issuing it. The flight is APP-WIDE and `placingOrder` is a getter
  over it, and every release site is a method on the instance that CLAIMED it, so
  a token still held at destruction is held FOREVER: the desktop sidebar (which
  lives beside the router outlet and is never destroyed) and every later basket
  instance keep a disabled Checkout button until the page is reloaded.
  `placeOrder` and `submitOrder` both discard through `releaseIfLatest`, which
  releases; the enquiry G4 added had no equivalent. **THE RELEASE BELONGS IN
  `ngOnDestroy`, NOT AT THE GUARD**, and the difference is load-bearing: a
  destroyed instance can have no NEWER operation, which is what makes an
  unconditional release safe, while at the guard the other way `mine()` goes
  false is that THIS instance moved the record on to a newer attempt — and
  `holdCheckout()` is idempotent per instance, so that attempt holds the SAME
  token and releasing there would free a LIVE flight, the exact hazard
  `releaseIfLatest` exists to avoid. **NO DUPLICATE PROTECTION IS DROPPED**: the
  flight is a UI single-flight, and what prevents a second order is the durable
  record and the idempotency key, both of which survive untouched — a surface
  pressing Checkout while an acceptance issued by the destroyed instance is
  genuinely in flight is answered `outstanding` by `reserveIntent` and told the
  checkout is still being confirmed, rather than facing a button that never comes
  back. Pinned by `basket-body.flight-release.spec.ts` (6); 4 fail on the head
  that carried the defect and the 2 that pass are the controls that must not
  change
- Checkout confirmation is the SERVER's quote (D02/D03): ✅ **the diner now confirms
  the amount the server saved, never one this browser computed.** The pre-pricing
  "are you sure?" dialog is GONE — it asked about a number the client produced, and
  placement then auto-submitted whenever nothing happened to be sold out, so the
  server's amount was never shown before the order was accepted. Every order now gets
  exactly ONE confirmation and it is always the server's: `initiateOrder()` prices,
  and the review sheet (`showQuoteSheet`) renders `data.quote` — one row per parent
  line with its extras nested — plus `order_details.actual_cost`. **This replaces a
  dialog rather than adding a second one.** `confirmQuote()` then submits
  `{order, quote_ref}`; the basket is never trimmed, and a rejected line is never
  re-POSTed. **THE REVIEW SHEET IS THE LOCK on the basket from confirm until submit
  resolves** — it stays up in a loading state, and `cancelQuote()` is inert while
  `placingOrder`. Closing it on confirm handed the live basket straight back (the
  quantity steppers carry no `placingOrder` binding and the CTA had been released
  when the sheet opened), so a slow submission let the diner edit the basket or start
  a second checkout, and the success handler then cleared the basket and navigated
  away with those edits. A DISCARDED attempt also gives the button back
  (`releaseIfLatest`) — but only when no newer attempt is in flight, since that one
  owns the loading state. Five things are load-bearing:
  - **A SERVER THAT NAMES NO QUOTE IS TOLERATED, AND THAT IS THE RELEASE ORDER.**
    `quote_ref` absent from the initiate response means a pre-D02 backend: the sheet
    still renders and still confirms the SERVER's `actual_cost` (only the itemised
    `data.quote` is missing, and the sheet says so), and submit OMITS the key rather
    than sending a null. This client ships BEFORE the paired backend — refusing an
    unnamed quote made every otherwise-successful checkout fail for the whole window,
    an outage produced by the change meant to make checkout truthful. It is not a
    weakening: the corrected backend always names a quote and its acceptance path
    REQUIRES one, so there is no client switch that can turn the guarantee off. It is
    TRANSITIONAL — removable once the corrected backend is deployed everywhere this
    client talks to — but removing it is its own deliberate change, never a tidy-up:
    deleting it re-creates the outage against any server that has not caught up
  - **THE REVIEWED TOTAL IS NEVER RECOMPUTED.** `reviewedTotal` reads the server's
    `actual_cost` verbatim. Where a client figure IS compared against a server one
    (`quoteDiffersFromBasket`), it goes through `_shared/utils/decimal-money.ts`:
    exact decimal parsing from the canonical string, integer comparison, **no
    epsilon** and never `Math.round(Number(v) * 100)` — that pair is neither an exact
    decimal parser (`Number('1.005') * 100` is `100.49999999999999`) nor the backend's
    ROUND_HALF_EVEN rule, and the usual "fix" for the disagreement it causes is an
    epsilon, which is a decision to stop noticing. `null` means CANNOT COMPARE and is
    never `0`
  - **A QUOTE IS BOUND TO THE BASKET AND THE TABLE IT WAS PRICED FOR.** Each attempt
    is stamped with `basketService.revision()` and the checkout context; a response
    that no longer matches BOTH is discarded — neither rendered nor submitted — and
    the draft it created is left alone, because this client cannot know the draft was
    not something else's. Editing the basket while the sheet is open marks the quote
    stale rather than silently submitting the older amount
  - **THE IDEMPOTENCY KEY IS NEVER RE-MINTED ON FAILURE.** Not on a lost response, a
    timeout, or a failed comparison — a new key turns one attempt into two orders,
    which is exactly what the key exists to prevent. There is ONE exception and it is
    narrow: `reviewUpdatedOrder()`, reached only after the server has authoritatively
    said the draft is LEGACY-priced and its acceptance path refuses it, so it can
    never be accepted and a fresh attempt cannot duplicate it
  - **LINE IDENTITY IS ID-ONLY AND ORDER-INDEPENDENT** (`lineIdentity` in
    `basket.service.ts`). `JSON.stringify` used to decide it, so identity depended on
    the order the diner tapped the choices in: "Cheese then Bacon" produced a
    different basket line from "Bacon then Cheese", the server merged the two into one
    row, and the basket, the confirmation and the kitchen ticket all disagreed about
    how many lines there were. Groups and choices are sorted, choices de-duplicated,
    and labels and prices are excluded — they are display values. `removeItem` matches
    the FULL variant (`itemId` + modifiers + extras); it ignored extras entirely
    before, so removing from a basket holding two variants of one dish removed
    whichever came first
  The D01 request ceilings are surfaced BEFORE the round trip via
  `_shared/order/checkout-limits.ts`, whose numbers are the BACKEND's — pinned against
  `checkout-limits.contract.json`, which the backend asserts from its own suite
  (`orders_app/tests_order_input.py`), so either side drifting fails its own tests
  rather than reaching a diner as an unexplained refusal. An over-ceiling line is
  MARKED IN PLACE and stays REDUCIBLE: a restored basket can legitimately hold a line
  above the submit ceiling (the server merges valid lines into one stored row above
  it), so it is never clamped or dropped. **EVERY published ceiling is CHECKED, and
  the whole-request total cannot stand in for the per-line ones** — 33 modifier
  groups, 65 choices in one group or 65 extras all sit far below the 2,048-entry
  aggregate and are still refused by the server, so counting only the total would
  publish three limits the preflight never applied.
  **`ErrorInterceptor` forwards an `orders/submit/` 400 carrying a `reason` as the
  STRUCTURED BODY**, exactly as it already does for the `orders/initiate/`
  ongoing-order block, and does not toast it — the basket branches on the machine code
  (`legacy_pricing_version` / `quote_ref_stale`) and renders the sentence inline at the
  checkout footer. Without that forward the interceptor flattens every failure to a
  string and the recoveries cannot fire; matching on the human sentence instead is
  exactly the brittleness the code exists to remove.
  **EXACT MONEY REACHES THE BASKET AND THE REVIEW, and the helpers are split on
  purpose.** `_shared/utils/decimal-money.ts` now carries TWO parsers and confusing
  them is the defect: `toMinorUnits` is EXACT and REFUSES more than two decimals — it
  is for a SERVER amount, where a third decimal means the wire is wrong — while
  `toMinorUnitsRounded` applies the backend's ROUND_HALF_EVEN to the digit STRING and
  is for a CATALOGUE COMPONENT, where `additionalCost: 1.005` is a legal stored value
  the server itself quantizes to `1.00`. Using the exact one there would make this
  client refuse a line the server prices perfectly well. `_shared/order/line-money.ts`
  is the ONE place a line is composed from its components (`lineUnitMinor` /
  `lineSubtotalMinor` / `basketTotalMinor`), and `null` PROPAGATES rather than
  becoming `0` at every step. The reviewed total prefers the server's canonical
  `quote_total` string over the legacy numeric `actual_cost`, and where it cannot be
  read the Place order button is REPLACED by an explicit `role="alert"` message —
  `quoteIsUnreadable` is a STATE, not an absence, discriminated by `pricing_version`
  so a pre-D02 server stays tolerated while a CORRECTED one that cannot produce a
  readable payable is an anomaly the diner is told about rather than asked to confirm.
  **THE `actual_cost` FALLBACK IS LEGACY-ONLY, and that is where the discrimination
  has to live** — in `reviewedTotalMinor`, not merely in `quoteIsUnreadable`'s later
  checks. It was unconditional until the Codex review of PR #660: a CORRECTED response
  with a missing or malformed `quote_total` but a parseable `actual_cost` beside it
  produced a non-null total, so `quoteIsUnreadable` stayed false and the diner
  confirmed a figure read from the lossy numeric field — the exact-money guarantee
  reverting silently in the one case it exists for (`float()` has already dropped
  digits from a large amount). The pre-existing refusal spec could not see it because
  its fixture left `actual_cost` undefined, so it never exercised a fallback at all;
  the spec beside it now supplies one, and a LEGACY-versioned companion proves the
  tolerance was narrowed rather than deleted.
  **BUT ABSENT AND UNREADABLE ARE DIFFERENT FACTS, and the first cut of that fix
  collapsed them — turning a truthfulness fix into a checkout outage for the width of
  a deploy.** `quote_total` landed in backend #315 while `pricing_version` (and
  CORRECTED on every new order) landed in #314, so a REAL DEPLOYABLE SERVER declares
  itself corrected and has never heard of the field. Refusing it blocked every
  checkout, which is precisely what the transitional tolerance three bullets above
  exists to prevent; it went live because BOTH specs written for the Codex fix pinned
  the NEW backend's shape, so nothing exercised the intermediate one. The rule is
  therefore: a CORRECTED response that SENT a `quote_total` it cannot express is
  BROKEN and refused (Codex's finding, intact), while one that sent NONE simply
  predates it and still reviews through `actual_cost`.
  **"SENT NONE" MEANS AN ABSENT PROPERTY — `undefined`, NEVER `null`** (a second
  Codex P1, also valid). The pre-field backend omits `quote_total` from the payload
  altogether, so absence is the ONLY shape an older server can produce; an explicit
  `null` can come from just one place, a CORRECTED server that sent the key and
  failed to express a value, which is exactly the broken promise the guard refuses.
  Strictness there costs NO availability — nothing deployed emits it, since the
  corrected serializer builds the key with `format_money`, which returns a canonical
  string or raises. Pinned from THREE sides, each by its own spec: the over-strict
  form fails the deploy-window spec, the `!== null` form fails the explicit-null
  spec, and the unconditional form fails both that and the original refusal spec —
  so no variant can return as a "simplification". The same distinction protects any
  documented rollback across those two backend commits.
  **THE WHOLE CORRECTED QUOTE IS VALIDATED, NOT JUST ITS TOTAL** (residual R1), and
  the rules live in ONE boundary, `_shared/order/quote-review.ts::reviewQuote`, which
  the sheet, `reviewedTotalMinor`, `quoteIsUnreadable` and `confirmQuote` all read
  through — memoised on the payload's identity, so the markup and the handler that
  places an order cannot reach different verdicts for the same response. Before it,
  the client checked that the payable could be READ and that each line it HAPPENED to
  receive carried a readable amount; it never required a corrected server to send any
  lines, and never asked whether the lines added up. Both gaps are silent and the
  second is the dangerous one — a payload asserting `quote_total: "25.00"` above lines
  totalling `"10.00"` rendered an itemised-looking review, reconciled nothing and
  submitted. What is now required of a CORRECTED payload: a non-empty `quote_ref`; an
  ARRAY `quote` within bounds DERIVED from the D01 request ceilings (the server merges
  identical configurations, so merging can only REDUCE counts — per-line QUANTITY is
  deliberately NOT bounded, a merged row may legitimately exceed the submit ceiling);
  a usable, UNIQUE row identity across parents and extras alike; whole non-negative
  quantities with `available ⇒ quantity ≥ 1`; every monetary key exact, and
  NON-NEGATIVE on payables and references while `unit_cost_of_options` stays
  LEGITIMATELY SIGNED ("no cheese, −500" is legal end to end); each child counted
  EXACTLY ONCE into its parent's `line_total_with_extras`; agreement with the
  response's own `no_available_items` / `no_unavailable_items`; and Σ of the parent
  aggregates equalling the payable, as integers, no epsilon. **THE THREE VERSION CASES
  ARE DIFFERENT SERVERS, NOT DEGREES OF STRICTNESS.** LEGACY (0 or absent) never
  promised an itemised quote, so none is required — the pre-D02 tolerance, unchanged.
  CORRECTED WITHOUT `quote_total` is backend #314, which shipped `pricing_version`,
  `quote_ref` AND `quote` in ONE COMMIT (`bd393de`) and only gained the canonical
  total in #315 — so its LINES are fully validated and only the total falls back to
  `actual_cost`. **A CORRECTED payload with missing LINES is therefore NOT the same
  fact as #314's missing total**: no deployed server has ever produced one.
  CORRECTED WITH `quote_total` is the current contract, and a total the server SENT
  but cannot express is refused with no fallback. The refusal REASON
  (`quoteRefusalReason`) is diagnostic only — the diner still sees one sentence,
  because a per-reason message would be an oracle over the response. A refused quote
  still RENDERS the server's own lines (never rebuilt, never filtered) beside the
  refusal, never calls submit, and leaves the basket and the idempotency key
  untouched. It also refuses an explicit `order_details.quote_complete === false` —
  the backend's own signal that a live row contributing to the payable belongs under
  no quoted line — while absence of that key says nothing.
  **THE BASKET'S OWN TOTAL NOW HAS AN EXPLICIT ESTIMATE STATE** (residual R3).
  `BasketService.calculateTotalAmount` fell straight back to the old
  `Σ totalPrice × quantity` double arithmetic when the exact helper returned `null`,
  and handed the result back as an ordinary total — a figure the client had just
  established it could not represent, displayed with the same confidence as one it
  could. `totalState(items)` now returns `{amount, exact}`; `calculateTotalAmount`
  delegates to it so the persisted `totalAmount` shape and every stored basket are
  unchanged (NO storage migration). When `exact` is false the basket still shows the
  SAME number — replacing it with `0` or a blank would each be worse — but the label
  reads "Estimated total" with a one-line note, and the CTA says "about UGX …".
  Checkout is deliberately NOT blocked: the server prices the order and the review
  sheet states the server's amount, which is the only figure a diner ever confirms.
  A LEGACY BASKET IS NOT AN INEXACT ONE — `line-money` parses the existing stored
  shapes (finite numbers, decimal strings) and reads an ABSENT optional adjustment
  whose established meaning is zero (`additionalCost`, an extra's `cost`) as zero
  rather than as malformed; `exact` goes false only for a component that genuinely
  cannot be represented.
  **AND THE DISPLAYED FIGURE COMES FROM THE SAME CALL AS THE LABEL** (Codex P2 on
  PR #662, valid). `totalAmount` read the PERSISTED `Basket().totalAmount` while
  `totalIsExact` recomputed from the items, so for a basket restored from storage
  and not yet edited the label described a DIFFERENT number from the one on screen —
  and since every total persisted before the exact helper landed is plain double
  arithmetic, that is the ordinary returning-diner case, not an exotic one: a stored
  `1002.0099999999999` whose items recompute to exactly `1002.00` rendered as
  `1,002.01` under the words "Total to pay". Both getters now read ONE memoised
  `totalState` call (keyed on the basket's identity and revision, the same pattern
  `review` uses), so the claim and the figure cannot disagree. **THE MENU'S BASKET
  PILL WENT WITH IT** — it read the same persisted value, and fixing only the basket
  screen would have made two screens show one basket two different numbers. **STILL
  NO STORAGE MIGRATION**: the persisted value is simply not what either screen
  reads, and the first mutation rewrites it through the same helper anyway.
  **The diner item-detail no longer applies the DEVICE CLOCK to an extra's discount**:
  `serverEffectiveExtraPrice` / `serverExtraDiscountIsLive` read the server-resolved
  `current_price` / `is_discount_active` the public serializer now publishes, and fall
  back to the LIST price — never to a locally-recomputed discount.
  **THE CHECKOUT NOW SURVIVES THE DINER RELOADING, AND ONE BASKET CANNOT CHECK OUT
  TWICE (D04/D).** `_services/checkout-coordinator.service.ts` is the ONE owner of an
  in-progress checkout, and it closes three gaps that no amount of server-side
  idempotency could reach.
  **THE IDEMPOTENCY KEY WAS AN IN-MEMORY FIELD ON `BasketService`**, so a page
  reload dropped it and the next attempt minted a NEW one — the server's entire
  guarantee bypassed by the single most likely thing a person does when a checkout
  appears stuck. It is now **PERSISTED BEFORE THE REQUEST IS SENT** (sessionStorage,
  not localStorage: a checkout belongs to the tab and the table session that started
  it). The ORDER of those two operations is the contract — minting a key and putting
  it in a body is a promise to treat the retry as the same attempt, and a promise
  held only in memory does not survive the thing it protects against. **AND IT IS SCOPED TO THE
  BASKET'S CONTENTS, NEVER TO `BasketService.revision()`** — a fresh key is DERIVED
  when the scope changes rather than pushed, so nothing has to remember to reset one,
  but WHICH scope is load-bearing and the first cut got it wrong (Codex P1 on PR
  #663, valid). `revision()` is a counter on a `providedIn: 'root'` service, so it
  restarts at 0 on every page load while the basket itself comes back from
  `persistedSignal` storage unchanged: the stored attempt therefore read as belonging
  to a different basket and a fresh key was minted anyway — the defect fully intact
  behind a mechanism that looked like it had fixed it. `BasketService.contentIdentity()`
  is the scope instead: the sorted `lineIdentity(item)x<quantity>` of every line, so
  it is a property of what the diner is buying and survives anything that does not
  change it. It reuses `lineIdentity` — already id-only, order-independent and
  de-duplicated to match the server — rather than a second opinion about what makes
  two baskets the same. `revision()` STAYS for its in-session uses (the quote
  staleness stamp), with a docstring now saying it is in-session only. A different
  TABLE mints a key too — the server refuses a key used elsewhere
  (`checkout_intent_unusable`), so reusing it would turn an ordinary table move into
  a checkout the diner cannot complete. An attempt record whose `basket` or `context`
  cannot be READ is never adopted: `attempt()` parses them through a `'\u0000'`
  sentinel that no real identity can equal, so a corrupt record mints a fresh key
  rather than matching one.
  **THERE WAS NO SINGLE FLIGHT.** `BasketBodyComponent` is mounted TWICE on desktop —
  the routed page and the sidebar beside the router outlet — and `placingOrder` was a
  field on EACH, so both could run a checkout at once. It is now a GETTER over the
  coordinator's one flight. The server refuses the second attempt either way, so this
  is not the last line of defence; a client that cannot tell it is already checking
  out shows two live buttons and can present no coherent outcome.
  **A LOST RESPONSE WAS UNRECOVERABLE IN THE UI.** `recover()` resolves the persisted
  key through the diner's own read (`order-details/?intent=`, scoped to the table
  session, so it can only ever surface an order at the diner's own table) and returns
  a DISCRIMINATED UNION. **`unknown` IS NOT `absent`, and that distinction is the
  whole thing**: an unreachable server is not evidence that nothing happened, and
  treating it as such is exactly how a recovery mechanism creates the duplicate it
  exists to prevent. So `accepted` announces itself and clears the finished basket,
  `draft` is left alone for the diner to review, and
  `unknown` changes NOTHING. (`absent` USED to drop the key. The D04 completion
  below stopped it — see "NOT FOUND IS NOT PROOF OF NON-EXECUTION" — so the record
  now survives every outcome except a recorded terminal one.) Recovery runs on the
  ROUTED page only — the sidebar is
  mounted on every diner screen and would issue the same read twice per load.
  **THAT DISTINCTION NEEDED A CARVE-OUT IN `ErrorInterceptor`, AND WITHOUT IT THE
  UNION COLLAPSED** (Codex P2 on PR #663, valid). The interceptor flattens every
  failure to `err.error?.message || err.statusText` — a STRING with no status — so
  the definitive 404 that means "no such order on this table" arrived as an
  unreadable object, `isNotFound()` was false, and every absence was classified
  `unknown`: the dead key retained forever and a toast about a background enquiry on
  every load. An `intent=` read now forwards the `HttpErrorResponse` UNTOUCHED and
  raises no toast, for two reasons the generic branch gets wrong — **the status IS
  the answer** on a read whose whole design is non-disclosing, and **nobody asked for
  it**, so reporting it as a failure blames the diner for something they did not do.
  Scoped to the `intent=` form; the ordinary `?order=` read keeps its string + toast
  behaviour exactly. The specs that pin it run the REAL `HttpClient`, interceptor and
  `ApiService` — the original suite stubbed `ApiService` and handed `recover()` a
  hand-built `{status: 404}`, which is the shape a raw `HttpErrorResponse` has and
  NOT the shape the deployed app produces, so it passed against the defect.
  **CLEANUP IS TARGETED AND ONLY EVER ON A DEFINITIVE OUTCOME.** `clearIntent()`
  removes ONE key and never clears storage, because the diner session capability
  lives in the same store and a blanket wipe would sign the diner out of their own
  table to tidy up a finished checkout. Never on a timeout, a lost response or an
  ambiguous failure — those are precisely when the key must survive. Both round trips
  are BOUNDED (30s): without a ceiling a dead-but-open connection leaves the CTA
  spinning for as long as the browser keeps the socket, and the diner's only escape
  was the reload that used to lose the key. A timeout is handled as any other lost
  response, because it never re-mints the key.
  **AND THE INTERRUPTED PATHS ARE CHECKED IN A REAL BROWSER TOO**:
  `e2e/checkout-journey/recovery.mjs` is the journey's sibling and induces the loss
  the clean run cannot — a reload mid-checkout, an acceptance that commits while the
  browser's view of the reply is destroyed (`route.fetch()` THEN `route.abort()`, so
  the SERVER really processes it), and a reload after that loss. 22 checks, manual
  like the journey. It found a defect in D04/D itself that no unit spec could see:
  the recovery notice first lived in the checkout footer, inside
  `@if (basketItems.length > 0)`, and an ACCEPTED recovery clears the basket — so the
  one outcome a diner most needs to hear was the one that hid the message. The
  existing component spec never calls `detectChanges()`, so it never runs `ngOnInit`
  and could not have caught it; `basket-body.recovery.spec.ts` now pins it.
  **ITS RELOAD SCENARIO COULD NOT FAIL UNTIL THE P1 FIX, AND THAT IS WORTH KNOWING
  BEFORE TRUSTING A GREEN RUN.** It reached the basket with `page.goto` and checked
  out at once, so the key was minted at `revision() === 0` on BOTH sides of the
  reload and the revision-scoped key produced two identical ones. It now clicks the
  quantity stepper once first — the counter is 1 before the reload and 0 after it
  while the contents are restored identical, which is the real diner's situation and
  the only version that discriminates. Verified by reintroducing the defect in the
  served app: **20/22**, the two failures showing two DIFFERENT drafts for one
  checkout. The matching unit spec needed the same treatment — its `BasketService`
  fake had `revision: () => 3`, a literal, and now models the process-local counter.
  A repeatable real-browser check of the whole path lives in `e2e/checkout-journey/`
  (NOT wired into CI — it needs a disposable PostgreSQL and two running servers). It
  **presses the app's own Place order button** rather than submitting by fetch
  (raw fetch is KEPT for the two negative reference cases, which the UI cannot
  produce), scopes its review assertions to the review PANEL, changes the dish price
  MID-RUN through the real operator API so the review is proved to show the CURRENT
  server price rather than the browser's cached one, asserts the basket is cleared
  ONLY after a definitive success, and reads the accepted order back off the kitchen
  board as an authenticated fixture operator. **Its money assertions are on CANONICAL
  DECIMAL STRINGS and on the EXACT visible elements** (`data-testid="quote-total"` /
  `quote-line-amount` / `quote-line-modifiers` / `quote-line-extra` on the review
  sheet, compared WHOLE) rather than on values passed through `Number` and searched
  for as a substring — `35011.3` and `'35011.30'` are the same number and only one is
  the contract. It carries **TWO independent monetary goldens**: a NONZERO FRACTION
  (the mid-run reprice to `12000.15` makes the line exactly `35000.30`, where
  `15500.15 × 2` in doubles is `31000.299999999996`) and the sub-cent ROUND_HALF_EVEN
  tie (`1.005 → 1.00`). It asserts the modifier INSTRUCTIONS and the CHILD quantity,
  not only the parent's, on both the review and the kitchen ticket, and that the
  quoted lines reconcile to the payable to the cent. It reads the kitchen ticket's
  modifier instructions from **`modifiers`**, the key `serializers_kitchen.py::_line`
  renames `modifiers_snapshot` to on the wire — reading the model field name made
  that assertion inspect `undefined` and fail every run (Codex P2 on PR #662, valid;
  corrected by source inspection, not by a journey run). **It deliberately does NOT
  read through the `actual_cost` compatibility fallback** — that tolerance is the client's,
  against an OLDER server, and reading through it here would let a current-backend
  wire regression pass silently on the lossy numeric field. Its README records what it
  found, what it deliberately does NOT cover, that it needs a backend carrying
  `quote_complete`, and that it is a manual run rather than a gate
- **THE CHECKOUT IS DURABLE, THE ANSWER IS VALIDATED, AND AN UNRESOLVED INTENT IS
  NEVER RETIRED (D04 completion).** D04/D got the SHAPE of all three right and left
  each of them unchecked. Four gaps, and the paired backend contract is PR #318
  (`checkout_protocol` 3, `data.checkout`).
  **THE DURABLE WRITE WAS NOT CHECKED, AND THE COMMENT SAYING SO WAS WRONG.**
  `write()` swallowed every storage failure and `intentKey()` returned the key
  regardless, under a comment calling the result "a WEAKER guarantee, not a
  failure". It was not weaker, it was ABSENT: the next call read nothing back,
  minted a SECOND key and sent it — a storage that refuses writes turned the
  idempotency mechanism into a duplicate generator, silently. `persist()` now
  CHECKS BY READ-BACK, because a try/catch cannot see the realistic case (a store
  that accepts `setItem`, throws nothing and returns nothing), and a failed
  required write means **THE MUTATION IS NOT SENT** — `reserveIntent` answers
  `storage-error`, `noteCommand` returns false and the acceptance is never issued.
  That is a deliberate availability trade: a checkout whose key cannot be written
  down is one whose retry can duplicate.
  **NOT FOUND IS NOT PROOF OF NON-EXECUTION.** `absent` used to call
  `clearIntent()`, so ONE momentary observation discarded the identity of a
  checkout whose outcome was still open. Even where a not-found IS proof — a
  supported server, a proven scope, no matching row — what it licenses is a
  SAME-KEY, SAME-REQUEST REPLAY, never a different key. Nothing retires an
  unresolved intent now; the record is dropped only on a recorded terminal outcome
  or on a draft the server has authoritatively refused (`reviewUpdatedOrder`).
  **There is deliberately NO cancel/abandon fence and no cleanup job** — adding one
  would be a way around this rule rather than a way of honouring it.
  **THE ISSUED COMMAND IS PROTECTED.** `intentKey()` overwrote the record whenever
  the basket or the table changed, with no regard for whether an acceptance had
  already been sent, so a diner editing their basket during an uncertain submit
  destroyed the only record of what was being recovered. `reserveIntent` now
  answers `outstanding` instead, and `retryOrder()` REPLAYS the recorded command
  (same order id, same reference, same key) rather than calling `placeOrder()`,
  which rebuilt the request from the live basket and re-ran `initiate` — a
  different question from the one whose answer was lost. The CTA follows: an
  unresolved checkout offers **Retry**, not Checkout.
  **THE ANSWER IS VALIDATED BEFORE IT IS ANNOUNCED.**
  `_shared/order/checkout-correlation.ts` is THE reading of the server's
  projection, shared by the coordinator's recovery and by the submit handler so
  the two cannot form different opinions about whether an order was accepted. It
  GATES ON THE STATED LEVEL (`checkout_protocol >= 3`; absent means 0 and promises
  nothing) and requires the answer to NAME this intent key, this order and this
  scope. **It never reconstructs a projection from the legacy keys beside it** —
  one assembled from `accepted` / `id` would carry exactly the conflation the
  projection exists to remove, wearing the shape that says it does not.
  **`accepted` IS TWO-VALUED AND ITS FALSE COVERS TWO OPPOSITE INSTRUCTIONS**, which
  is why the level gate matters. The backend concedes it: false means a genuine
  DRAFT and an order accepted BEFORE the evidence table existed, alike. At level 3
  `acceptance.state` separates them (`accepted` / `not_accepted` /
  `evidence_unavailable`, the last mapping to `accepted-unrecorded`).
  **ONLY TWO OF THE THREE ARE VERDICTS, AND THE CLIENT MUST NOT RESTATE THE THIRD
  AS ONE** (the same over-claim the backend carried, Codex P2 on backend #318).
  `evidence_unavailable` is the server saying it CANNOT DETERMINE whether the
  submission landed: two producers reach it — an acceptance predating the evidence
  table, and a DRAFT a kitchen write cancelled or advanced — and nothing on the row
  separates them. **THE ACTION AND THE CLAIM PART COMPANY HERE.** The action is
  identical to `accepted` and stays conservative — clear the basket, offer no second
  checkout — precisely BECAUSE the server does not know, since one producer really
  is an order in the kitchen. The SENTENCE is not: `accepted` says "it is with the
  kitchen", `accepted-unrecorded` says the order MAY already have been placed and
  points at staff, because telling a diner their cancelled draft is cooking leaves
  them waiting for food nobody is making. Pinned by a spec pair — one asserting the
  unrecorded notice omits the kitchen claim, one asserting the confirmed notice
  still states it plainly, so narrowing one cannot hedge the other.
  **A PROMISE IT COULD NOT KEEP IS REFUSED, NEVER DOWNGRADED** (Codex P1 on
  PR #664, valid). `readCorrelation` returns `null` both for a payload that
  carries no projection and for one whose projection cannot be READ, and all
  three call sites treated those the same: fall back to the legacy branch and
  trust `accepted: true` — clearing the basket having checked no key, no order
  and no scope, which is the exact unvalidated announcement the projection
  exists to prevent. **ABSENT AND UNREADABLE ARE DIFFERENT FACTS**, the same
  distinction this repo already draws for `quote_total`, and
  `correlationPromised` is the one predicate that separates them so the three
  sites cannot disagree. **IT READS TWO SIGNALS BECAUSE THE TWO SURFACES CARRY
  DIFFERENT ONES**: the order read publishes `checkout_protocol` at the top
  level beside `data.checkout`, so an advertised level ≥ 3 is a promise even
  with the projection missing entirely, while the submit reply carries the
  projection top-level beside `status`/`message`/`idempotent` and NO separate
  level field, so there the presence of a `checkout` key IS the promise. A
  non-object `checkout` counts as a promise too — sending the key at all
  claims the contract.
  BELOW level 3 the client falls back, and the
  fallback is resolved from ITS OWN RECORD rather than from the server: with no
  command issued for this key an unaccepted order can only be the draft that
  initiate created, so it is a `draft`; with a command outstanding the server
  cannot say whether it landed, so the outcome is `unsupported` and the diner is
  told the checkout is still being confirmed.
  **A DEFINITIVE DRAFT REPLAYS THE COMMAND, AND NOT DOING SO WAS A DEAD END**
  (Codex P1 on PR #664, valid — and the likeliest interruption of all). An
  acceptance that never reaches the server leaves behind the draft `initiate`
  already created, so recovery reads a level-3 `not_accepted` rather than a
  404. `replayIssuedCommand` no-opped on that, `checkoutBlocked` did not cover
  `draft` so the CTA said **Checkout**, `reserveIntent` refused every press as
  `outstanding`, and Retry came back to the same no-op: the diner could never
  submit that order again. `not_accepted` is PROOF OF NON-EXECUTION — the
  backend writes its evidence row in the SAME transaction as the transition, so
  "still initiated, no evidence" means the acceptance did not commit — and it
  is the STRONGER evidence of the two, since the server names the order rather
  than merely failing to find one. It therefore takes the `absent` path: the
  SAME command re-sent under the SAME key. Two consequences follow. `draft`
  BLOCKS only when a command is outstanding (a commandless draft is an ordinary
  reviewable order and Checkout must still work), and its notice splits the
  same way — "your order did not reach us, tap retry" rather than "please
  review it again", which would point at a button that is refused. **RECOVERY
  STILL NEVER AUTO-SUBMITS ON LOAD**: a reload may be how somebody abandons a
  checkout, so the resume path reports and the diner taps.
  **A DEFINITIVE REFUSAL IS SETTLED, NOT LEFT OUTSTANDING** (Codex P1 on PR
  #664, valid — and it arrived in the review BODY rather than as an inline
  thread, which is how it was missed on the first pass; read both). The
  `quote_ref_stale` branch promises a reprice and could not start one:
  `noteCommand` has already recorded the checkout as `accepting`, so
  `reserveIntent` answers `outstanding` and `placeOrder` refuses. The diner
  then loops — Checkout refused, Retry replaying a command the server has
  already refused (BEFORE the draft-replay fix above it merely no-opped, so
  that fix made this WORSE rather than better, which is worth knowing when
  reading the two together). **THE OUTSTANDING STATE IS FOR AN UNKNOWN
  OUTCOME, AND THIS ONE IS KNOWN**: the server re-read the order under its own
  lock and the reference does not match, so this command can never be accepted
  and there is nothing left to recover. `settleRefusedCommand()` clears the
  COMMAND and moves the stage to `refused` — a value the vocabulary already
  carried and nothing had ever written — **keeping the key**, because the
  basket is unchanged and this is the same purchase, so `sameCommand` hands
  that key straight back. That is what separates it from `clearIntent`, which
  forgets the intent entirely and stays reserved for a terminal outcome or the
  LEGACY draft `reviewUpdatedOrder` refuses. **IT IS NOT A WAY AROUND THE
  NOT-FOUND RULE** — it requires a refusal the server actually stated about
  this exact command, and must never be called on a timeout, a lost response
  or anything the client merely failed to observe. The settle is a REQUIRED
  durable write: if it fails nothing is sent, since repricing on top of a
  record still naming an unsettled command would leave one nobody resolves.
  **AND A FAILED DURABLE WRITE IS HONOURED AT THE END, NOT ONLY AT THE START**
  (Codex P1 on PR #664, valid). `recordOutcome` returns false when its
  read-back verification fails, and both success paths ignored it and called
  `clearIntent` regardless — so a store that silently drops writes loses the
  accepted outcome while the REMOVAL still succeeds, leaving a reload with no
  record at all and free to start a second checkout for an order already in the
  kitchen. That is the same defect this PR closed at the other end of the
  checkout, reopened at the last step. Cleanup is now conditional on the
  record: the order DID land, so success is still announced and the basket
  still cleared — withholding either would report a failure for something that
  succeeded — and only the FORGETTING is withheld, so a later reload recovers
  `accepted` and tidies up then. **This client is safe against a
  pre-D04, a level-1, a level-2 and a level-3 server, and the backend lands first.**
  **THE TERMINAL RESULT IS RECORDED BEFORE ANY CLEANUP** (`recordOutcome` then
  `clearIntent`), so a process that dies mid-teardown resumes announcing a completed
  order instead of re-enquiring about one in the kitchen. A delayed submit callback
  is guarded by the same attempt sequence `placeOrder` has always used — the
  acceptance path never was, so a slow submit landing after a re-price could clear a
  basket and navigate away on the strength of an older attempt.
  **THE RECORD IS VERSIONED AND ITS FIVE STORAGE STATES ARE DISTINGUISHED**
  (`none` / `unreadable` / `malformed` / `unsupported` / `record`). Collapsing any
  of them into "no record" is how an unresolved checkout gets retired by accident.
  A D04/D (#663) record is UPGRADED, never discarded — its key, scope, basket
  identity and (for a `submitting` record with an order id) its issued command
  carry forward, and nothing is manufactured where the old shape said nothing. A
  malformed or newer-format record BLOCKS rather than being overwritten, and is
  never deleted. **Known, deliberate dead-end:** a record this build cannot parse
  and cannot resolve leaves the diner told to check with staff, with no in-app
  discard. Only this app writes that key, so the realistic source is our own record
  — and an informed-discard affordance is its own decision, not something to smuggle
  in as a fence around the not-found rule.
  **AND THE BLANKET `sessionStorage.clear()` IS GONE.** `retainSessionThrough(() =>
  this.sessionStorage.clear())` called `clear()` on the RAW store, so it emptied
  EVERY key on the origin — prefixed or not, this app's or not — and then put two
  diner tokens back by hand. That is a restore list maintained against a wipe that
  keeps widening, and it was already wrong for the portal-embedded diner mount
  (`rest-app-ordering`), where an operator's own session keys sit in the same store.
  `resetDinerOrderContext()` removes exactly what a finished order makes stale
  (`upsellConfig`, `diner.menu.scrollY`) and KEEPS the diner's table, restaurant and
  capability tokens — which the wipe used to destroy and then partially rebuild, so
  "back to menu" needed a re-scan it now does not.
- **ACCEPTANCE IS EVIDENCE, ONE OWNER HOLDS THE UNCERTAINTY, AND AN UNREADABLE
  RECORD IS NOT PERMISSION TO REPLACE IT (D04 acceptance gates).** The D04
  completion above got the SHAPE of the correlated answer, the durable record and
  the three-state verdict right and left each of them unchecked AT ITS CONSUMER.
  No backend change: the contract is #318's, already deployed and unmodified.
  **GATE A — RESOURCE IDENTITY IS NOT ACCEPTANCE.** `correlationMatches()`
  answers one question — *is this answer ABOUT my command?*, i.e. key, order and
  scope — and BOTH submit surfaces used it as their SUCCESS decision, going
  straight to `recordOutcome({kind: 'accepted'})`. A projection can name this
  key, this order and this scope and still say the acceptance did NOT happen,
  or name a DIFFERENT `quote_ref` than the one the diner confirmed, or carry no
  reference and no moment at all. `acceptanceVerdict` is the second predicate and
  is deliberately a SEPARATE function rather than a stricter `correlationMatches`:
  identity is also what a RECOVERY asks, and there a null `outcome` is CORRECT —
  an observation is not the result of an attempt. On a MUTATION the same null is
  contradictory (the server performed an attempt and declined to say which) and is
  refused, which is what the `{mutation}` flag carries. A refused verdict records
  nothing, clears nothing, and leaves the key and the basket exactly as they were.
  **THE STATED LEVEL IS REMEMBERED, NOT RE-READ PER RESPONSE.**
  `correlationPromised` reads the PAYLOAD; `CheckoutRecord.protocol` records what
  this server already demonstrated for THIS attempt (`noteProtocol`, MONOTONIC —
  a capability does not un-demonstrate itself). So a submit reply carrying no
  projection, from a server whose initiate response said `checkout_protocol: 3`,
  is BROKEN rather than old: before this it fell to the legacy branch and cleared
  the basket having validated no key, no order and no scope. A genuinely
  pre-level-3 server promises nothing, is still tolerated, and that compatibility
  control is pinned beside the refusals — narrowing one must not silently widen
  the other.
  **GATE B — `evidence_unavailable` IS NOT AN ACCEPTANCE, AND WAS CLEANED UP LIKE
  ONE.** It shared the `accepted` branch, which clears the basket AND DELETES THE
  RECORD — so the one outcome that most needs a durable handle was the one that
  destroyed it, and the next reload started clean with permission to order again.
  Nothing is cleared now; `checkoutBlocked` is what refuses a second checkout, and
  clearing the basket was a SUBSTITUTE for blocking rather than a form of it. The
  ACTION stays conservative and the CLAIM stays narrow — the split the D04 bullet
  above already describes — and the two are now independent rather than one
  implying the other.
  **NOT FOUND AND DRAFT-OBSERVED ARE NOT PROOF OF NON-EXECUTION, IN THE WORDS
  TOO.** The draft notice said "your order did not reach us", which asserts
  non-execution from one instant's observation. It now says the order is
  UNCONFIRMED and that retry re-sends the same request under the same key, which
  is what actually happens. The rule was already honoured in the CODE; the
  sentence contradicted it.
  **AN ACCEPTANCE AND WHAT HAPPENED AFTERWARDS ARE SEPARATE FACTS.** The accepted
  notice said "it is with the kitchen" for every accepted recovery, a cancelled
  one included — leaving a diner waiting for food nobody is cooking — and a served
  one. `currentDisposition` reads the projection's `current` block, which the
  backend labels apart from `acceptance` precisely so the two need not be
  collapsed; with no current state to read it says what IS known and claims
  nothing more.
  **A DELAYED RECOVERY CARRIES IMMUTABLE OPERATION OWNERSHIP.** The resume path
  performed destructive cleanup without checking that the record and scope it
  captured were still current, so an answer held open across an edit or a table
  move cleared state it never owned. `recoveryOwner()` is captured BEFORE the
  request and compared on arrival — deliberately not a re-read of the current
  record, since comparing a response against whatever storage says now is what
  makes a stale answer look authoritative.
  **AND A RETRY IS NOT AN EDIT.** A reserved purchase whose INITIATE response was
  lost still holds the lines that were sent, so `CheckoutRecord.request.items`
  stores the D01-VALIDATED lines verbatim and `retryOrder()` re-sends THOSE under
  the SAME key. `placeOrder()` rebuilt the body from the LIVE basket, which after
  any edit asks the server a different question from the one whose answer was
  lost. The approved distinction survives: a deliberate edit followed by CHECKOUT
  still begins a new purchase, because that path still goes through `placeOrder`.
  **GATE C — PROTECTION FOLLOWS THE FACT THAT A COMMAND MAY HAVE BEEN ISSUED, NOT
  WHETHER ITS HANDLE SURVIVED.** `isOutstanding()` required `command !== null`,
  which lost the protection in the one case it was written for: `upgradeV1` turns
  a D04/D `submitting` record with no usable order id into `unresolved` with a
  null command — honestly, since nothing may be manufactured — and the record it
  had just produced then read as NOT outstanding, so a changed basket replaced it
  with a fresh key. The existing durability spec checked the upgrade's OUTPUT and
  stopped there, never following it into reservation, which is where the
  protection was actually lost. It is stage-based now, and `isProtected` adds the
  cases that are not outstanding but must still not be REPLACED: a `degraded`
  record (a present-but-unparseable command or outcome in `parseV2`), an
  `accepted` record with no outcome, and one written under a canonicalisation this
  build does not know. **MISSING HANDLES REDUCE THE ABILITY TO RECOVER; THEY NEVER
  ESTABLISH THAT NO OPERATION RAN.**
  **AND `persist()` VERIFIED ONLY KEY AND STAGE.** `noteCommand` moves a record
  from `accepting` to `accepting` when a previous attempt already set the stage,
  and `recordOutcome` writes an outcome onto a record whose key never changes — so
  the realistic failing store (accepts `setItem`, throws nothing, keeps the
  PREVIOUS value) satisfied both checks and reported success, and the caller then
  issued an acceptance it believed was written down. Read-back now compares a
  FINGERPRINT of everything a later recovery reads; `startedAt` is excluded
  deliberately, being written once and never re-asserted.
  **AND GATE C's WIDER `isOutstanding` REACHED GATE B's RETRY PATH — twice**
  (both Codex P2 on PR #665, both valid, both real regressions of this change).
  `replayIssuedCommand`'s draft/absent branch dereferenced `record.command!`
  under a comment asserting that a commandless record "cannot arrive here",
  which was TRUE only while `isOutstanding` required a non-null command — the
  very requirement Gate C removed so a record whose HANDLE was lost stays
  protected. Such a record now reaches it, and the result was
  `TypeError: Cannot read properties of null` thrown from inside an RxJS
  subscriber: an uncaught error that kills the page rather than preserving the
  checkout. **A synchronous `expect(...).not.toThrow()` CANNOT see it** — RxJS
  reports a subscriber error asynchronously, so the spec passes while the
  runner disconnects; the spec drains the queue inside `fakeAsync` instead,
  which is what turns a disconnect into an assertion. The recovery READ is
  still worth making there (it can resolve an `accepted` outcome properly);
  only the re-send is withheld, and the notice stops promising a retry that
  cannot fire. Separately, `retryOrder` classified a replayable initiation as
  "the record has items", so a record `reserveIntent` had just refused —
  degraded, `accepted` with no outcome, or an unknown canonicalisation — could
  issue a mutation through Retry, defeating the protection this change added.
  `isReplayableInitiation` is a POSITIVE classification instead, and excludes
  a record carrying a command on purpose: that one is resolved by replaying the
  COMMAND, never by re-initiating.
  Each gate has its own spec file and each was REPRODUCED against unmodified
  `607f635` before being fixed (7 / 10 / 6 real failures, the rest of each file
  passing as controls), then re-proved by reintroducing the defect one gate at a
  time. **The browser pair was re-run for this revision** — `journey.mjs` 42/42
  and `recovery.mjs` **28/28**, the latter being the enlarged harness the D04
  completion PR explicitly recorded as NOT re-run.
- **THE SAME TWO GATES, AT EVERY CONSUMER (D04 Stage B).** The acceptance
  predicate and the completion-ownership rule above were both correct and both
  reached only SOME of the code that needed them. No backend change; the
  contract is still #318's.
  **R1 — RECOVERY ASKED THE IDENTITY QUESTION, NOT THE ACCEPTANCE ONE.**
  `submitVerdict` learned the difference on PR #665; `CheckoutCoordinator.
  classify()` did not. It used `correlationMatches` alone and then switched on
  `acceptance.state`, so the STARTUP and RETRY consumers completed exactly what
  the submit gate refuses: an acceptance bound to a `quote_ref` the diner never
  confirmed, or one carrying no reference and no moment at all. It now reads
  through `acceptanceVerdict` with the issued command, and the mapping is
  total — `accepted` → accepted, `not-accepted` → draft, `indeterminate` →
  accepted-unrecorded, everything else → `uncorrelated`, which is unresolved
  and announces nothing. **`{mutation: false}` IS THE WHOLE DIFFERENCE AND IT
  IS NOT A RELAXATION**: a read is an OBSERVATION, so a null attempt `outcome`
  is correct there and contradictory on a mutation reply — pinned by a control,
  because the wrong fix here is to make recovery as strict as a submit and
  start refusing ordinary reads. The expected reference comes from the
  IMMUTABLE issued command and is ABSENT when this client issued none, which is
  how an authorized read still surfaces an acceptance made elsewhere (a copied
  tab) without requiring a missing reference to match itself.
  **AND THE PROMISE IS REMEMBERED, NOT RE-READ PER RESPONSE.**
  `correlationPromised` reads the PAYLOAD; the missing-projection fallback now
  also consults `pending.protocol`, the level this server already demonstrated
  for THIS attempt. A read carrying only the legacy `accepted: true`, from a
  server whose initiate declared level 3, is BROKEN rather than old. The
  genuinely pre-level-3 tolerance is unchanged and has its own control.
  **R2 — COMPLETION OWNERSHIP DID NOT INCLUDE THE CART.** `recoveryOwner()`
  captured key and scope; a CART EDIT changes neither, because an edit
  re-reserves nothing — so the guard passed and `finishAcceptedCheckout()`
  erased a basket the accepted purchase had never contained. The pre-existing
  "newer basket" spec changed the basket AND the table, so it proved the SCOPE
  check and said nothing about this.
  **TWO QUESTIONS, DELIBERATELY SEPARATE, AND THAT SPLIT IS THE DESIGN.**
  `CheckoutCoordinator.settles(owner)` asks whether an authoritative answer may
  still SETTLE the retained operation; `ownsPurchase(owner, identity)` asks
  whether that operation owns the cart on screen. A legitimate acceptance for
  an earlier purchase answers YES to the first and NO to the second: it is
  recorded, announced and retired, and the newer cart is left alone. Losing the
  acceptance would be as wrong as erasing the cart, so both are pinned.
  **THE OWNER IS IMMUTABLE AND CAPTURED BEFORE THE REQUEST** (`ownerOf`): key,
  scope, the issued `orderId`, and `purchase` — the basket CONTENT identity,
  which is DURABLE because it is a property of what the diner is buying.
  `revision()` is deliberately NOT in it: it restarts at 0 on every page load,
  and using it as durable intent identity is the exact defect Codex found on
  #663. Comparing against a re-read of whatever storage says on ARRIVAL is the
  other wrong answer — that is what makes a stale response look authoritative.
  **FIVE CONSUMERS NOW APPLY ONE RULE**, where three applied none: startup
  recovery, RETRY recovery (which had no guard at all), the cached-terminal
  resume branch (which called `finishAcceptedCheckout()` with no owner
  whatever), resend, and direct submit. On the last two the scope half was
  already caught by `submitVerdict` — a cart edit is invisible to that check
  and to `issued.seq` alike, which is why the control naming the table move
  passes on the reviewed revision and the cart-edit spec beside it does not.
  **A REPLAY IS ONLY EVER INTO THE SCOPE IT WAS PRICED FOR.**
  `isReplayableInitiation` classifies the RECORD and knows nothing about the
  table the diner is at now, so `retryOrder` compares `record.scope` against the
  live context BEFORE issuing anything. There is nothing lost by refusing:
  `reserveIntent` mints a fresh key for the new scope and `placeOrder` starts a
  clean purchase there.
  **AND A DESTROYED INSTANCE OWNS NOTHING.** Angular does not cancel an HTTP
  request when a component is destroyed, so a recovery opened by a routed
  instance the diner has navigated away from still lands — and used to run its
  own completion beside the live one's. `ngOnDestroy` sets a flag both
  ownership predicates read.
  Two fixtures were corrected rather than worked around, and both mattered:
  `basket-body.component.spec.ts` reserved with the literal `'spec-basket'`
  where `placeOrder` reserves with `basketService.contentIdentity()`, and the
  Gate B fake's `revision` was the literal `3` with a `clearBasket` that never
  cleared anything. A fake that cannot express a cart edit cannot test one.
  **AND THE LEVEL IS READ WHEN THE ANSWER LANDS, NOT WHEN THE READ WAS SENT**
  (Codex P1 on PR #666, valid). `recover()` snapshots `pending` BEFORE the
  request and startup recovery deliberately does NOT claim the checkout flight,
  so a diner can initiate against a level-3 node while an earlier read is still
  open: the snapshot then says 0 for a server that has since proved it can do
  better, and the legacy branch trusted `accepted: true` from exactly the case
  the memory exists to refuse — announcing an order and clearing the basket.
  `demonstratedProtocol` takes the MAX of the snapshot and the live record, and
  only for the SAME KEY. **THE SNAPSHOT'S IDENTITY HALF STAYS FROZEN, and that
  split is the whole point**: key, scope and the issued command must remain as
  captured, or a held answer starts being measured against whatever storage
  says now — which is precisely what makes a stale answer look authoritative.
  Only the CAPABILITY is read live, because it is monotonic; a record replaced
  by a different key describes a different operation and says nothing about
  this one.
  **The browser harness gained the interleaving no unit spec can produce** —
  `recovery.mjs` scenario 4, a real commit-then-drop acceptance followed by a
  real stepper click, now 35 checks. Verified by reintroducing the defect in
  the SERVED app: **33/35**, the two failures reading `lines=0`.
  **AND CART OWNERSHIP IS SCOPE *AND* CONTENTS — the two protections existed
  and never met (D04 closeout).** `ownsDisplayedCart` asked only whether the
  CONTENT identity matched; the scope comparison lived in `ownsRecovery`, and
  the CACHED-TERMINAL branch does not go through it — it calls
  `finishAcceptedCheckout(null, ownerOf(stored.record))` directly. So a
  settled receipt for table A cleared table B's basket whenever the two
  happened to hold the same dish in the same configuration, which on one
  restaurant's menu is an ordinary coincidence rather than a rare one. **No
  malformed response is involved**: an internally coherent old receipt beside
  an ordinary current cart is the whole counterexample. The condition went
  into the SHARED predicate rather than that one branch, because that is the
  common guard on every destructive cleanup here (startup recovery, Retry, the
  restored terminal record, resend, direct submit) and fixing the caller would
  leave the shared answer wrong for whichever consumer is added next. **IT
  NEEDS NO SERVER READ** — unequal scopes cannot share cart ownership whatever
  a response says — and **SETTLEMENT IS UNTOUCHED**: `settles` still admits the
  answer, the outcome is still recorded and the acceptance still announces
  itself, because losing a real acceptance would be as wrong as erasing a cart
  it never contained. The normal table-scan path still clears the basket on a
  table change; what this protects is a basket populated at the NEW table
  beside a retained receipt, after an earlier cleanup did not finish. The
  matrix is: clear only when scope AND contents both match. Pinned by two
  specs that hold the CONTENTS EQUAL so scope is the only discriminator (one
  moving the table, one the restaurant) — reverting the condition alone fails
  exactly those two out of 209.
  **AND THE SCOPE A MOUNTED COMPONENT REPORTS NOW FOLLOWS THE DINER** (Codex P2
  on PR #667, valid — a PRE-EXISTING gap the condition above does not reach
  rather than a regression of it). `BasketBodyComponent.table` / `.restaurant`
  were read ONCE, in the constructor, and are not `@Input`s. The desktop
  sidebar is mounted inside `@if (table)` on the diner shell, so an in-app
  rescan from table A to table B moves that value from truthy to truthy, the
  block never tears down, the constructor never re-runs — and the sidebar went
  on reporting table A. `DinerAppComponent.getTableDetails` updates its own
  field and session storage and propagates nothing to the child. Measured
  through the real component: `before='r1:tA' after='r1:tA' live='r1:tB'`.
  **IT IS NOT A REGRESSION OF THE SCOPE CONDITION, and the reason matters:**
  `reserveIntent` mints the record's scope from the SAME helper on the SAME
  instance, so both sides of that comparison were stale in the same direction
  (`recordScope='r1:tA' ctxNow='r1:tA' equal=true`) and the guard behaved
  exactly as the unguarded predicate had. **THAT ALSO RULES OUT THE NARROW
  FIX**: reading the scope live in `ownsDisplayedCart` ALONE would compare the
  new table against a record minted under the old one and refuse to clear a
  basket the operation genuinely owns — a stale-scope gap turned into a broken
  checkout, which is why a control pins that direction.
  **FIVE CONSUMERS READ THOSE TWO FIELDS, so the fix belongs on the FIELDS**:
  the header the diner reads (`Table {{ table?.number }}`), `editItem`'s link
  back to the menu, `checkoutContext()` — itself the reservation scope, the
  quote-staleness stamp, `ownsRecovery` and `ownsDisplayedCart` — and the table
  and socials carried to the confirmation screen. A sidebar that survived a
  rescan therefore also SHOWED the wrong table number and named the wrong table
  on the receipt; fixing only the authority half would have left those lying.
  The mechanism is the one the component ALREADY had: `StorageValue` emits on
  every `setItem`, `getTableDetails` writes both keys through that service, and
  the existing subscription now calls `refreshTableContext()` on an EXACT key
  match (`storageKeyIs`, prefix-tolerant — `includes()` is deliberately kept for
  the pre-existing `upsellConfig` test and deliberately NOT used for these two,
  which must not re-read because some future key merely contains the word).
  No `@Input`, no getter re-reading storage on every change-detection tick, and
  ONE source of truth — the store the shell writes — so reserve, stamp and guard
  cannot disagree. Pinned by 8 specs that change session storage UNDERNEATH a
  mounted instance rather than assigning `component.table`, which is exactly what
  hid this: 7 fail on `06a7559` and the 8th is the control that must not.
- **A LOST CLOSURE RESPONSE IS RECOVERABLE, AND ITS EVIDENCE IS VALIDATED
  (D06/C1-C3).** The three bullets above got the SHAPE of the closure right and
  left the one response D06 was built around losing with no consumer. No backend
  contract change: `quote_protocol` stays 2 and `checkout_protocol` stays 3.
  **C1 — THE DEAD END.** `CheckoutCoordinator.classify()` was the D04
  acceptance-only classifier: its `not-accepted` branch returned `draft` without
  ever looking at `quote_closure`. So the ordinary six-step interruption had no
  exit — a diner prices O1/Q1, presses Place order, the server COMMITS a closure
  and refuses, and the reply is LOST; the reload reads the order (still
  `initiated`, `not_accepted`, carrying the closure level 2 publishes for exactly
  this client) and `draft` is proof of non-execution, so `replayIssuedCommand`
  RE-SENDS the acceptance the server has permanently refused,
  `resendIssuedCommand` files every failure as `unknown`, the CTA offers Retry,
  and Retry comes back to the same place. **Reproduced through the real
  component, the real `ApiService`, the real `HttpClient` and the real
  `ErrorInterceptor` before anything was changed** —
  `basket-body.closure-recovery.spec.ts` ran **4 FAILED / 4 SUCCESS on
  `80de76a`**, the failures showing `recovered.kind === 'draft'`, a second
  `orders/submit/`, and a notice promising a retry the state cannot keep.
  There is now ONE validated `closed` outcome and every consumer reaches it: the
  startup read, the Retry read, the submit refusal, the RESEND refusal (which
  read every failure as unknown), the initiate replay, the retire enquiry, and
  cached restoration from the record. **ACCEPTANCE IS RESOLVED FIRST** — a
  closure beside an accepted order changes nothing, because a closure is about
  the QUOTE — so only a definitive `not-accepted` may become `closed`.
  **C2 — ONE EXPLICIT EVIDENCE CONTRACT.** `readClosureEvidence` answers
  `closure` / `absent` / `malformed`, validating a narrow reason vocabulary (the
  two strings the server's `CheckConstraint` guards), a reference, a real moment
  and a supported policy version, and refusing a closure that names a DIFFERENT
  quote than the command that was issued. `validateClosure` is SHARED with the
  STORED form, so a persisted closure is held to the standard the response it
  came from was — the first cut read the wire's snake_case keys off a camelCase
  record and silently returned `absent` for every closure it had just written,
  which the read-back verification caught. **A TERMINAL REASON WITH NO READABLE
  CLOSURE IS `unknown`**: every backend that can emit one attaches the row it
  wrote, so the word without the row is a broken promise, and it used to settle
  the issued command and mint a replacement key anyway. `renewAfterClosure`
  REQUIRES the evidence rather than trusting four call sites. **AN UNSUPPORTED
  POLICY VERSION IS STILL A CLOSURE** — retirement is version-independent and
  refusing it would strand a diner against a future backend; it forfeits only the
  policy-derived claim (`policySupported`). The enquiry reads the MONOTONIC
  remembered level at answer time (`establishedQuoteProtocol`), so an
  uncorrelated `quote_still_valid` from a server that demonstrated level 2 is
  refused as BROKEN rather than honoured as old — the G4 correlation and
  `QUOTE_PROTOCOL` 2 shipped in one backend change and deployed together — and
  the genuinely pre-level-2 tolerance is pinned beside it. **A still-valid answer
  continues only a review that is STILL CURRENT**: a review-only enquiry never
  becomes an acceptance.
  **C3 — ONE DELIBERATE SUCCESSOR.** The closure is persisted WITH the command
  settle in one write (`noteClosure`), so the routed page, the desktop sidebar
  (which never runs recovery) and the next reload read one established fact.
  `reviewUpdatedOrder` then mints ONE successor under a NEW key linked by
  `replaces`, carrying the same purchase. Repeated taps and a second mount share
  it (`superseded`); a storage failure sends nothing and never deletes the
  closure; a changed cart is preserved; a lost successor replays K2 with the
  ORIGINAL lines. `placeOrder` never prices under a key a closure was written
  against — that would replay the retired order and self-heal a wasted round
  trip later, which is not a reason to send a request whose answer is known — and
  `reviewUpdatedOrder` no longer `clearIntent()`s when NEITHER producer
  established anything, which was a reserved key forgotten on no evidence.
  **`CheckoutRecord.closure` DOES NOT MOVE THE RECORD VERSION**, for the reason
  `replaces` records: bumping makes every record this build writes `unsupported`
  to the previous one, and an `unsupported` record BLOCKS. An older build ignores
  the key, keeps the key and the settled command, and its own G3b initiate-handler
  check renews on the next re-price — one wasted round trip, not a dead end.
  **ORACLES CORRECTED RATHER THAN RELAXED, each with its discriminating control**:
  the two `quote-renewal` cases that expected a new key from a bare
  `quote_expired`, the `quote-answer` case that called an omitted correlation
  older-server compatibility while ignoring demonstrated level 2, and three
  `quote-lifetime` cases that asserted the re-price happened without evidence.
  Suite 2411 -> 2450. Browser: `recovery.mjs` gained **D06c** (the closure
  commits and the refusal is lost — the full O1 -> C1 -> review -> K2/O2 -> lost
  successor -> one accepted order sequence, both mounts reading the closure) and
  **D06d** (the acceptance never arrives, so nothing is retired and a Retry is
  offered), now **68/68**.
  **AND AN ANSWER MAY ONLY ACT ON THE OPERATION THAT ASKED FOR IT — THREE
  CONSUMERS, ONE RULE** (three Codex P2 on PR #675, all valid, each a rule this
  work had already established reaching only part of the code it governs; suite
  2450 -> 2464).
  **THE REVIEW IS BOUND TO THE ATTEMPT IT WAS PRICED UNDER.** `renewQuote`'s
  retired branch renewed `this.checkout.record()` — whatever storage held when
  the answer LANDED — which is the one input `renewAfterClosure`'s `superseded`
  check can never refuse, since it compares `replaced` against exactly that. So
  a mount holding a STALE sheet for O1/Q1 could take Q1's closure and abandon
  the live K2 successor the OTHER mount had already minted for it: a valid
  attempt at the same purchase, discarded on the strength of a closure about a
  different one. **`settles(owner)` CANNOT SEE IT**, and that is the subtle
  half — the owner is frozen when the ENQUIRY is issued, which is AFTER the
  renewal, so both it and the fresh read say K2 and agree. `reviewedQuote` now
  carries the `key` it was priced under, because **nothing else distinguishes
  two attempts at ONE purchase**: a renewal carries `request` and `scope` across
  unchanged — that is what makes it the same purchase — so the revision, the
  context and the scope are identical either side of it. The gate is ONE
  statement covering both branches that ACT (`still-valid` submits, `retired`
  abandons a key); `unreadable` is deliberately outside it, because it acts on
  nothing and a Retry is the right offer however stale the screen is. A NULL
  reviewed key discriminates nothing and is treated as such rather than as a
  refusal — it means no record was readable when the review was established,
  which `renewQuote` has already failed closed on by then.
  **THE RESEND GUARDED ON A COMPONENT COUNTER.** `issued.seq` moves when THIS
  instance starts something newer and never when another one does, and it does
  not exist at all once the instance is gone — so a resend outliving its
  component landed with its seq still matching and wrote to the SHARED record:
  the error path handed a refusal to `applyQuoteRefusal`, which settles a
  command and records a closure against whatever attempt is current by then,
  and the success path recorded an outcome and forgot the intent. `renewQuote`
  was given the immutable owner for exactly this reason on #674; the resend was
  left on the old mechanism. Both callbacks now clear `!this.destroyed &&
  settles(owner)`, AFTER releasing the flight so nothing is stranded. A NULL
  owner FAILS CLOSED rather than being permitted: with no operation to be the
  current one, an answer would be free to act on whatever record a DIFFERENT
  checkout had created by the time it landed.
  **AND A PARTIAL CORRELATION AUTHORIZED SUBMISSION.** At a demonstrated level 2
  `readQuoteAnswer` refused only when BOTH `order` and `quote_ref` were absent.
  `_correlate_quote_answer` stamps `order` unconditionally and echoes
  `quote_ref` whenever the caller named one — and this client always does,
  since `renewQuote` refuses to ask without a reference to ask about — so an
  answer carrying ONE of them is as broken as one carrying neither, on the
  branch that authorizes an order. **Naming the ORDER establishes nothing about
  WHICH QUOTE of it**, which is the entire question a lifetime enquiry asks: a
  quote is what expires, and the order outlives it. The genuinely pre-level-2
  tolerance is untouched and has its own control.
  Pinned by `basket-body.stale-answer.spec.ts` (14), which drives the real
  component through the real coordinator and storage; reverting the three fixes
  one at a time fails exactly 3 / 2 / 2 of them and never a control
- **CLOSURE EVIDENCE IS EXHAUSTIVE, AND A CLOSURE NAMES THE ATTEMPT IT WAS
  WRITTEN AGAINST (D06 E1/O1).** The bullet above got the shape of the evidence
  and the successor right and left both under-specified at their consumers. No
  backend contract change: `quote_protocol` stays 2, `checkout_protocol` stays 3,
  `QUOTE_POLICY_VERSION` stays 1, and **the record version deliberately does not
  move** — the predecessor rides INSIDE the existing `closure` key, for the reason
  `replaces` records (bumping makes every record this build writes `unsupported`
  to the previous one, and an `unsupported` record BLOCKS).
  **E1 — FOUR EXHAUSTIVE ANSWERS, NOT THREE PLUS A FLAG.** `ClosureEvidence` is
  `closure` / `unsupported` / `absent` / `malformed`, read through exactly two
  predicates: `usableClosure` (*may I act on this*) and `closureAsserted` (*did
  the server say anything at all under `quote_closure`*). `unsupported` is its own
  KIND because a closure written under a policy this build has never seen is a
  REAL closure (retirement is a fact the server recorded) and one this build may
  not ACT on — two different things, and a boolean beside a usable closure is
  exactly how the distinction gets dropped at the next consumer. **TWO #675
  SEMANTICS ARE REVERTED**: it accepted every positive policy version for renewal
  with `policySupported` demoted to copy, and it returned `accepted` before
  inspecting a contradictory closure beside it. The agreed supported-policy rule
  (policy 1) is restored and the inconsistent-result path is explicit again —
  `RecoveryOutcome.inconsistent` preserves the original attempt, announces no
  ordinary success, mints no successor and erases nothing, and no database repair
  is authorized or performed. **A malformed, unsupported or wrong-reference
  closure is never permission** to treat the quote as open, resend an acceptance,
  discard evidence or create another intent: the last usable attempt is KEPT and
  an actionable unresolved/manual-recovery state is shown, so **unknown is not
  permanent paralysis** — nothing is discarded, and a later valid authorized read
  resolves it. **THE LEVEL IS EVALUATED AT ANSWER TIME AND THE IDENTITY IS NOT**:
  `readPublishedClosure(orderDetails, expected?, demonstrated)` answers
  `malformed('level')` — never `absent` — when a server that has already
  demonstrated `REQUIRED_CLOSURE_PROTOCOL` for THIS attempt then says nothing, and
  `demonstratedQuoteProtocol` takes the max of the frozen snapshot and the live
  record ONLY for the same key. `quote_protocol` is never conflated with
  `checkout_protocol` and neither is inferred from `pricing_version`.
  **O1 — THE CLOSURE CARRIES ITS PREDECESSOR.** `noteClosure` persists
  `{closedAt, reason, quoteRef, policyVersion, predecessor: {key, orderId, scope,
  purchase}}` and settles the command in ONE verified write, reading the order id
  BEFORE `command` is cleared. `renewAfterClosure()` is **zero-argument** and
  reads that evidence, making a CONDITIONAL transition for THAT predecessor:
  create K2 once, return the already-established K2 (`superseded`, which the
  component treats as success), or refuse (`conflict`). **It can never treat a
  stale C1 plus a freshly loaded K2 record as permission to replace K2** — the
  comparison is against the predecessor the closure names, never against whatever
  `record()` happens to return — so stale UI is not the only protection, and two
  deliberately-new meals under different keys are never globally de-duplicated.
  It refuses on absent/unusable evidence, on an outstanding acceptance and on a
  failed durable write. **THE REVIEWED KEY IS CHECKED BEFORE EVERY COMMAND IS
  PERSISTED OR SENT** (`reviewedQuote.key` + `reviewedAttemptIsCurrent()` gating
  `submitOrder`), not only when an expired local deadline happens to trigger the
  extra enquiry, and **a NULL reviewed key is REFUSED, never trusted**. **ALL
  THREE AUTO-RENEW PATHS ARE NOW DELIBERATE** — `handleSubmitFailure`, the closed
  initiation replay in `placeOrder` and the retired answer in `renewQuote` each
  establish the closure and STOP; `reviewUpdatedOrder()` is the only caller of the
  renewal, and `renewedThisEpisode` is gone (an episode counter was a weaker
  statement of what the conditional transition now enforces exactly). The owner
  rule covers the direct-submit SUCCESS and ERROR handlers, **including the
  `quote_ref_stale` reprice refusal**, which carries no closure reference and so
  has nothing else to stop it matching the current record by accident. Both
  recovery `noteClosure()` returns are checked.
  **M8 IS WORTH KNOWING ABOUT.** Removing BOTH recovery write-checks failed
  NOTHING in 2497 specs — the rule was stated in code and in a comment and pinned
  by neither, which is the class of defect this whole programme is about. Three
  specs closed it (the Retry site, the STARTUP site driven through a second
  component over the same persisted record, and the control that must keep
  offering the review when the write DOES land). Pinned by
  `basket-body.evidence-gates.spec.ts` (18) plus extensions to the suites that
  already owned each behaviour; eight source mutations fail 7 / 2 / 1 / 4 / 2 / 2
  / 5 / 2 named subsets with every control holding, and `recovery.mjs` gains
  **D06e**, the lost *initiation* of a successor.
  **AND "STOP" HAS TO GIVE THE FLIGHT BACK — the defect this pass INTRODUCED,
  found in a browser.** Replacing the terminal branch's fall-through to
  `placeOrder()` with a `return` dropped the one thing that fall-through did for
  free: `placeOrder()` OWNS the app-wide checkout flight and releases it on every
  outcome. Nothing released it on the new path, so `placingOrder` (a getter over
  the coordinator's one flight) stayed true and **the very button that branch
  renders — *Review updated order* — came up `disabled` / `aria-busy` and stayed
  that way until a reload**. D06e timed out on it; NO unit spec could see it,
  because every spec asserted on the STATE behind the button rather than on
  whether it could be pressed. `releaseCheckout()` now runs at the top of that
  branch: the acceptance has RESOLVED, so there is nothing left to protect, and
  `releaseFlight` ignores a token that is no longer current, so a late release
  from a superseded attempt cannot free a live one.
  **AND THE EXHAUSTIVE RULE HAD TO REACH THE RECOVERY CONSUMER, AND BOTH
  ACCEPTED RETURNS** (two Codex P2 on PR #676, both valid, both the same shape
  as everything else here — a rule implemented at one consumer and not the
  next). `closedOr` promoted a draft verdict to `closed` for a VALID closure
  and handed back the `draft` fallback for every other kind — but `unsupported`
  and `malformed` (a wrong reference included) are NOT absence: the server
  recorded something under `quote_closure`, and `draft` is PROOF OF
  NON-EXECUTION, so `replayIssuedCommand` re-sent the acceptance for a quote
  that may already be retired, the server refused it identically, the refusal
  filed as `unknown`, and Retry returned there. That is E1's own rule —
  *a malformed or wrong-reference closure is never permission to treat the
  quote as open, resend an acceptance, discard evidence or create another
  intent* — reaching the submit-failure path and the renewal primitive but not
  the read. **`closure-unreadable` IS ITS OWN OUTCOME, KEPT APART FROM
  `inconsistent` DELIBERATELY**: that one is the server contradicting ITSELF
  (accepted AND closed), this one is a single coherent statement this build
  cannot read. The remedy is the same today — preserve the attempt, announce
  nothing, mint nothing, erase nothing, point at staff — and the causes are
  different, which is exactly when one word for two facts mis-diagnoses.
  Separately, the accepted-and-closed gate ran ONLY inside the level-3 branch,
  so the LEGACY `accepted === true` return announced the acceptance, cleared
  the basket and deleted the record on the same contradictory payload. **The
  two levels are independent by design** — `quote_protocol` says whether
  closures are published, `checkout_protocol` whether the correlated projection
  is — so a server publishing a level-2 closure while answering below level 3
  is exactly the shape that gate exists for, and a gate applied to one of two
  accepted returns is not a gate. **ONE PRE-EXISTING CONTROL WAS CORRECTED,
  NOT THE RULE RELAXED**: `CONTROL: a closure from a server that never promised
  to publish one` priced through an initiate declaring `quote_protocol: 2` and
  then read `quote_protocol: 1` — a DOWNGRADE, which E1b has called
  `malformed('level')` since it landed, so the control was passing on
  `closedOr`'s swallow rather than on the compatibility it names. It now
  states level 1 throughout, and the downgrade keeps its own regression beside
  it.
  **AND A BLOCK IS NOT A RENAMED MUTATION** (a further Codex P2, valid, and a
  defect that PREDATES this work). `checkoutBlocked` withholds Checkout — and
  the footer answers a block by rendering **Retry**
  (`@if (orderError || checkoutBlocked)`), so blocking these states did not
  remove the mutation, it renamed the button. For a record with NO issued
  command — the ordinary shape after a lost `retire-quote` reply, where nothing
  was ever accepted — `retryOrder()` skips `replayIssuedCommand`, classifies the
  record as a replayable initiation and re-sends `orders/initiate/` under a key
  that may be bound to an order the server has RETIRED; the reply carries the
  same unreadable closure, so the diner loops. That is exactly what
  `checkoutBlocked`'s own comment says it exists to prevent, reached through the
  other door — and `placeOrder` carries the guard while claiming to cover "every
  other entry — a direct `retryOrder`", which it does not, because the two
  replay exits return BEFORE reaching it. **IT IS NOT NEW**: `unusableClosure()`
  and `inconsistent` already blocked before this pass, which added a third state
  to the same group, so all three are fixed together. `closureUnresolved` reads
  the ONE definition (`unusableClosure()`) so it cannot drift from what blocks
  Checkout; `retryOrder` is guarded at the top, covering
  `replayIssuedCommand`, `replayInitiation` and `placeOrder` alike; and the
  footer renders a DISABLED control instead, the shape `tableHasOngoingOrder`
  already uses. **NO MUTATING ACTION AT ALL, rather than a non-mutating one**,
  because the notice beside it already names the remedy and it is a person —
  `UNRESOLVED_CLOSURE_MESSAGE` says to check with staff *before ordering the
  same items again*, which is precisely what a Retry there invites. The guard
  and the template are INDEPENDENT (defence in depth, the reasoning
  `checkoutBlocked`'s `closed` case already records): reverting them one at a
  time fails exactly 1 of 25 each. Pinned by
  `basket-body.closure-recovery.spec.ts` (25); reverting the three earlier fixes
  one at a time fails exactly 3, 1 and 1, every control holding — including the
  `unknown` control, which must keep its real Retry, since nothing was asserted
  about the quote there and re-sending is the right offer.
  Paired backend: `A1b` / `BREAKING_CHANGES.md` §16c; record:
  `D06_CONSUMER_GATES_CLOSURE.md`
- **A PRICING ANSWER OWNS ONE OPERATION, AND A FAILED CLOSURE WRITE IS NOT AN
  ORDINARY REVIEW (D06 I1/I2).** The two initiation consumers were the last
  callbacks in this checkout still guarded only by component-local state. No
  backend change: `quote_protocol` stays 2, `checkout_protocol` stays 3, and the
  record version deliberately does not move.
  **I1 — A COMPONENT-LOCAL GUARD IS NOT AN OPERATION GUARD.** `placeOrder` and
  `replayInitiation` each guarded on `{seq, revision, context}` and then wrote to
  the SHARED record. **None of those three moves when another mount advances the
  checkout**, and a destroyed instance keeps its own `activeAttempt` — so the
  ordinary interruption (price on the routed page, navigate away, finish on the
  sidebar) let a held initiation answer land over an acceptance issued since.
  `noteStage('reviewing')` then walked the record back from `accepting`, and
  because `isOutstanding` reads the STAGE, the issued command stopped being
  protected: the next changed purchase minted a fresh key and erased the only
  handle that unsettled acceptance could be recovered by.
  **THE IDENTITY IS CAPTURED BEFORE THE REQUEST AND THE TRANSITION IS
  CONDITIONAL** — `PricingOperation` (key, scope, purchase) frozen at issuance,
  read by `resolvePricedAnswer` / `notePricedReview` in the COORDINATOR, so both
  mounts decide identically and the check sits where the write does. **A KEY
  CHECK ALONE IS INSUFFICIENT**: the same key is exactly what a legitimate replay
  reuses, so the stage and the command are part of the question — an answer may
  act only on a record still in `pricing` / `reviewing` / `refused` (the last
  because the ordinary `quote_ref_stale` reprice leaves it there), carrying NO
  command and NO asserted closure. `settles(owner)` cannot stand in for it
  either: it short-circuits true at `orderId === null`, which is precisely the
  pricing stage. The gate runs BEFORE any shared write, quote assignment, stage
  write, cleanup or secondary request, and `isCurrent` gained `!this.destroyed`
  beside it. **The two handlers are ONE implementation** (`applyInitiationResult`),
  so the replay door cannot drift from the direct one, and `replayInitiation`
  still re-sends the stored request under the stored key.
  **AND THE SAME RULE REACHED THE DIRECT-SUBMIT CALLBACKS** — success had only
  `issued.seq`, and the error handler ran its credential and legacy branches
  before `applyQuoteRefusal` consulted its owner, so an older answer could
  invalidate a newly scanned session, mark another attempt legacy or navigate an
  unrelated screen. Both now clear `ownsIssuedAnswer` first.
  **I2 — BOTH DOORS INTERPRET THE CLOSURE, AND A FAILED WRITE IS ITS OWN
  RESULT.** `replayInitiation` bypassed closure consumption entirely, so a
  retired quote reached the review sheet purely because it came through Retry.
  And when `noteClosure` FAILED, the handler fell through to the ordinary sheet:
  the stage stayed `pricing`, the record carried no closure, and the diner was
  offered a confirmable review for a quote the response had just said was
  permanently closed. **A LOCAL STORAGE FAILURE IS NOT A REASON TO CONTRADICT
  THE SERVER**, and the two facts are reported separately —
  `RecoveryOutcome.closure-unrecorded` is a THIRD kind, deliberately apart from
  `closure-unreadable` (that one is a statement this build cannot read; this one
  is a statement it read perfectly well and could not write down). It mints no
  successor (there is no persisted closure to mint one from), keeps the key and
  the request, releases the owned flight, and a reload re-reads the order, finds
  the same published closure and writes it then. **THE DECISION AND THE TEMPLATE
  AGREE** rather than the message being the state: `closureUnresolvable()` is the
  one predicate `closureUnresolved` and `checkoutBlocked` both read, so the
  footer renders a disabled control and no mutating Retry — an error message
  alone is not shared state, and it is readable by ONE instance.
  **`noteStage` NOW HAS NO PRODUCTION CALLER** and says so at its declaration; it
  survives as spec fixture setup, and every answer-driven transition goes through
  a conditional one.
  Pinned by `basket-body.initiation-ownership.spec.ts` (17) and
  `basket-body.initiation-closure.spec.ts` (22), both driving TWO real component
  instances over one real coordinator, storage and HTTP stack; **5 and 15 of them
  fail on unmodified `d5dcd24`**. Suite 2514 -> 2553.
  **THE BROWSER SCENARIO DISCRIMINATES ONLY AGAINST ALL THREE HALVES, and that
  is worth knowing before trusting a green mutation run.** `recovery.mjs` gains
  **I1** (a real held initiation answer landing after a real committed
  acceptance, 88 -> 101 checks). Neutralising the component gate ALONE changes
  nothing, because `notePricedReview` re-asks in the coordinator; neutralising
  the destroyed check alone changes nothing, because the coordinator gate still
  refuses. Only main's full shape — destroyed check off, component gate off,
  `noteStage('reviewing')` unconditional — reproduces it, at which point the
  scenario reads `stage=reviewing`. The key-minting CONSEQUENCE is NOT observable
  there and the harness says so in its own comment: the acceptance really
  committed, so the table is occupied and the footer correctly offers no mutating
  CTA. That consequence is pinned deterministically by the unit spec instead
- **AN UNRESOLVED CLOSURE IS A FACT BOTH BASKET CONSUMERS READ (D06 I2-C).**
  I1/I2 put the right decision in the RECEIVING component and left it there. No
  backend change: `quote_protocol` stays 2, `checkout_protocol` stays 3, and the
  record version deliberately does not move — the observation is memory-backed,
  so there is nothing new in storage to version.
  **THE MECHANISM.** `applyInitiationResult` answers two closure situations by
  assigning `this.recovered`: `closure-unreadable` (the server asserted
  something under `quote_closure` this build may not act on) and
  `closure-unrecorded` (the closure is VALID and `noteClosure`'s verified write
  failed). Both are FIELDS ON ONE COMPONENT — `RecoveryOutcome` being declared
  in the coordinator module does not make one shared runtime state — and
  `closureUnresolvable()` read that field plus `unusableClosure()`, which reads
  the same field and the persisted closure. In both situations the shared record
  is still `K1 / pricing / command=null / outcome=null / closure=null`, which is
  honest and is ALSO exactly what an ordinary attempt waiting to be reviewed
  looks like. So the desktop sidebar — a second mount of this component, which
  never runs a recovery — read the same record, classified the initiation as
  replayable and **sent it again under a key that may be bound to an order the
  server has retired**. The first component stayed blocked; the second did not,
  and a component mounted after the hold was in the same position.
  **THE OBSERVATION MOVED TO THE COORDINATOR** (`ClosureHold`,
  `holdClosure`, `unresolvedClosure`), memory-backed and reactive — the right
  shape for a hold that must survive within ONE document while storage itself is
  the thing failing, since in the `unrecorded-closure` case a durable hold cannot
  be written down by definition. **It is NOT a substitute** for persisting an
  attempt before sending it, nor for the verified durable closure
  `renewAfterClosure` still requires before minting a successor, and it never
  turns an unusable assertion into a valid terminal fact — the evidence is
  carried verbatim in the existing `ClosureEvidence` vocabulary. **FOUR FACTS
  STAY APART**: a usable closure durably recorded (the existing working path), a
  usable server closure with incomplete local persistence, unusable or
  contradictory evidence, and genuine network uncertainty with no closure
  asserted at all — the last is NOT a hold, and a Retry there is the right offer.
  **IT NAMES THE ATTEMPT IT WAS MADE ABOUT**, captured before the request whose
  answer produced it (`PricingOperation` for an initiation answer, the recovery's
  own frozen `CheckoutOwner` for a read), never whatever record is current when
  an old answer lands. `unresolvedClosure()` is where that binding is enforced,
  and its five cases are each a decision: no record at all DOES NOT APPLY (there
  is no attempt to hold, and blocking a fresh one would strand the diner with
  nothing to recover from); a different key, scope or purchase DOES NOT APPLY
  (that is what stops a stale K1 hold blocking a legitimately established K2);
  the same attempt carrying a VALID DURABLE CLOSURE does not apply, because a
  newer verified fact outranks an older observation; the same attempt APPLIES;
  and unreadable storage APPLIES, fail-closed.
  **ENFORCED AT THE SHARED BOUNDARY, NOT ONLY IN THE FOOTER.** Four coordinator
  gates, so UI, ordinary initiation, initiation retry, direct acceptance,
  acceptance resend and renewal cannot disagree for one held attempt:
  `reserveIntent` answers a new `held` kind and refuses BOTH of its branches
  (the same-key continue would re-price under a key that may be retired; the
  mint would abandon the attempt the observation is about) — **a cart edit is
  explicitly not a way out**; `isReplayableInitiation` is false; `noteCommand`
  refuses, which is the structural gate every acceptance passes through, so a
  second mount holding a review opened BEFORE the hold is stopped even though
  its reviewed key still matches; and `renewAfterClosure` answers `unusable` or
  `storage-error` rather than `none`. **THAT LAST ONE CORRECTED A SHIPPED
  ORACLE**, recorded rather than relaxed: two #677 specs asserted `none`, and
  the consumer treats `none` as PROCEED (`renewAfterClosure`'s own docstring:
  "`reserveIntent` will mint a fresh key on its own"), so the old answer
  licensed a fresh key for a permanently retired quote and only a guard on the
  ONE instance that saw the answer stopped it.
  **RECOVERY STAYS USABLE, AND THAT IS WHAT THE HOLD IS FOR.** `recover()` is a
  GET and is deliberately outside every gate — reading cannot duplicate
  anything, and a hold whose only exit was a mutation would be a dead end. The
  documented exit is unchanged: storage recovers, the diner's own scoped read
  finds the SAME published closure, `noteClosure` succeeds, and only then does
  the explicit review action mint ONE successor. **A LOCAL RESULT YIELDS TO A
  SHARED RESOLUTION** (`staleLocalClosureResult`), which is the mirror of the
  defect above — one instance not knowing what the others do — and a mount whose
  own result is no longer supported by either the hold or the record stops
  reporting it. **The memory-backed hold does not survive a reload, and nothing
  claims it does**: after one, the routed mount's recovery re-establishes it
  from the server, which is the same path that resolves it.
  **THE #677 FIXTURES WERE CORRECTED, and their timing tests are unaffected.**
  Both spec files spelled `pricing_version: 'CORRECTED'` while the discriminator
  is the NUMERIC `PRICING_VERSION_CORRECTED` (1) compared with `===`, so their
  payloads took the LEGACY branch: the reference, the row identities, the
  per-line reconciliation, the availability counts and the order-level sum went
  unexercised, and the premise "an ordinarily confirmable quote" was true only of
  the pre-D02 contract. `corrected-quote.fixture.ts` is now the one source —
  importing the constant rather than restating it — with one parent (5,000) and
  one extra (1,000) reconciling exactly to a 6,000 payable, and each file
  asserts `reviewQuote(...).readable === true` and `.itemised === true` on the
  UNMODIFIED payload before injecting a fault. A genuinely legacy fixture
  (`legacyInitiate`) is kept and labelled as a different SERVER, not a weaker
  version of the same one. `reviewQuote` is untouched and no production version
  coercion was broadened.
  **AND THE RECOVERY DOOR HAD TO SHARE A VALID CLOSURE IT COULD NOT WRITE DOWN**
  (Codex P2 on PR #678, valid — the same defect class as the three doors this
  change already covers, at the fourth). `shareUnusableEvidence` gated on
  `closure-unreadable`, so the two recovery sinks answered a FAILED
  `noteClosure` by setting `{kind: 'unknown'}` on the ONE component that made
  the read, which is two mistakes in one line. **THE CLAIM WAS WRONG**:
  `unknown` means genuine network uncertainty, and here the server published a
  valid closure this build read perfectly well and failed to persist — exactly
  what `closure-unrecorded` names, so the word said the outcome was
  undetermined about a quote that is known retired. **AND THE SCOPE WAS
  WRONG**: the shared record is still `K1 / pricing / command=null /
  closure=null`, indistinguishable from an ordinary attempt waiting to be
  reviewed, so the sidebar — which never runs a recovery — went on classifying
  the initiation as replayable and could re-initiate under a key bound to a
  retired order, recreating the cross-mount dead end through the one door the
  first cut had not reached. `shareUnrecordedClosure` makes the SAME transition
  the initiation door makes, with the same two halves in the same order (the
  shared hold, then the local result), so the two cannot drift, and a NULL
  owner still binds nothing. **IT IS NOT A SUBSTITUTE FOR THE WRITE**:
  `renewAfterClosure` still requires the VERIFIED DURABLE closure before it
  mints anything, and the documented exit — a reload, the same published
  closure, a write that lands — is unchanged. **TWO SHIPPED ORACLES WERE
  CORRECTED, RECORDED RATHER THAN RELAXED**: the two O1 specs in
  `basket-body.closure-recovery.spec.ts` asserted that `unknown`, and now
  assert `closure-unrecorded` plus the hold, with every other assertion they
  make BYTE-IDENTICAL (no review, the command still outstanding, no successor)
  — their subject never changed, and removing either `noteClosure` check still
  fails both, which is the M8 gap they were written for.
  Pinned by `basket-body.shared-closure-hold.spec.ts` (38 specs driving TWO real
  component instances over one real coordinator, storage and HTTP stack, with B's
  OWN Retry, Checkout and confirmation methods exercised); **12 of the first 34
  fail on unmodified `d1a0abb`**, every failure because the second consumer acts
  or is uninformed, and the 9 that pass are the premises and the controls. The
  4 added for the Codex P2 fail **3 / 3 / 1 / 2** under four separate
  mutations — the whole fix reverted, the shared half dropped while the local
  result stands (which fails all three, because `staleLocalClosureResult` then
  reads an unsupported local result and the mount says nothing at all), the
  local result reverted while the hold stands, and the STARTUP sink alone
  reverted — with the persist control holding throughout.
  `recovery.mjs` gains **I2-C**, the first scenario to drive both mounts at a
  desktop width so the sidebar is genuinely visible and clickable
- Diner table-session capability (opaque QR): ✅ the anonymous diner journey now
  runs on a signed table-session capability (backend PR 7A) instead of a raw
  table UUID — a `DinerSessionService` (`_services/diner-session.service.ts`) owns
  the QR credential and the minted session token, and a `DinerSessionInterceptor`
  (`_helpers/diner-session.interceptor.ts`) attaches them only to an exact
  first-party route allowlist owned by `_security/diner-capability-contract.ts`;
  a denied credential drives a rescan panel on the diner shell. See Key Domain
  Concepts for the two-token model and its invariants
- The Revenue card SURFACES the server's mixed-pricing-convention notice (residual
  R4): ✅ `dashboard-v2` has published `revenue.pricing_conventions`
  (`{mixed, legacy_orders, corrected_orders, notice}`) since backend D02/C, and the
  frontend passed `revenue` straight into `RevenueCardComponent`, rendered gross,
  discounts, net and the chart from it, and never consumed the disclosure — so the
  one screen an operator reads those figures on was the one place the statement
  about them did not appear. D02 changed what two persisted columns MEAN (a
  CORRECTED order's `total_cost` includes paid modifier costs and its `savings` can
  never be negative; a LEGACY one's excluded them and could be), so a window
  spanning the deployment sums two measurements. **NOTHING IS REPRICED, EXCLUDED OR
  RECALCULATED** — this is a disclosure about COMPARABILITY, never about
  correctness, and the amount each diner paid is unaffected. The smallest possible
  consumer: an optional `PricingConventions` on `RevenueData`, an
  `adaptPricingConventions` that yields `undefined` for anything malformed or
  absent, and a `pricingNotice` GETTER on the card rendering a `role="note"` block
  immediately under the Gross/Discounts pills. Four things are load-bearing.
  **IT READS THE RESPONSE FOR THE WINDOW ACTUALLY DISPLAYED**, never a locally
  inferred deployment date — the server counts the orders on each side and decides.
  **ABSENCE IS NOT PROOF OF A UNIFORM CONVENTION**: an older response says nothing
  and renders nothing, and the card must not break on it. **NO NOTICE IS EVER
  MANUFACTURED** from the counts — only a non-empty sentence the server issued is
  shown. And because it is a getter over the `revenueData` INPUT, changing the
  period replaces the input and a stale notice disappears with it. The card is fed
  the PRIMARY window's response; the Dashboard's separate comparison-window call
  supplies only a baseline total and is never read here. Note the Dashboard's
  `USE_MOCK_DATA` is still `true` for core metrics and the mock does not model a
  convention split, so the notice is UNREACHABLE in the running app until that flag
  flips — inventing one in the mock would be inventing data
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
  **THE COMMAND CONTRACT CHANGED WITH D05, AND THE CLIENT NO LONGER GUESSES AN
  OUTCOME.** Every kitchen mutation now names an explicit ACTION (`advance` /
  `serve` / `correct` / `recall`, or the priority/cancel route) and a REQUIRED
  `if_revision` — the precondition captured from the ticket the operator acted
  on, and NEVER refreshed on a retry, which would turn a stale command into a
  newly authorised one. The optimistic-mutation/rollback engine is GONE: a
  command marks its ticket `pending`, and the SERVER decides. Success applies the
  server's own projection; a `409` keeps the card and attaches the machine
  `reason` plus authoritative state; a timeout or transport failure resolves to
  `unknown` — never a rollback, which would assert the server did not act. What
  that replaced was reachable and dishonest in four distinct ways: a failed serve
  or cancel did `[...tickets, ticket]`, so a poll that had re-added the ticket
  left TWO cards with one id; a cancel whose RESPONSE was lost (the server having
  applied it) put the cancelled ticket back on the board; a failed advance wrote
  a stale snapshot over newer server state; and a failure left no trace at all.
  TWO FENCES stop an old answer overwriting a newer one — a SCOPE generation
  (restaurant + operator session, which also clears the stores on a switch) and a
  per-read sequence. An UNREADABLE envelope no longer empties the board: it is a
  different fact from an empty one and says so.
  **ONE FRESHNESS RULE NOW COVERS EVERY RESPONSE PATH, THE ANSWER IS VALIDATED
  BEFORE IT IS BELIEVED, AND AN UNCERTAIN COMMAND IS ACTUALLY RECONCILED (K1–K3).**
  The paragraph above got the SHAPE of all three right and left each of them
  reaching only part of the code that needed it. No new backend contract beyond
  the one route named below.
  **K1 — THE FENCES WERE A FENCE WITH A GAP NEXT TO IT.** `applyFeed` ordered
  feeds against OTHER READS only and then `store.set(tickets)` unconditionally, so
  a read issued before a command and answered after it reinstated the pre-command
  row, revision included; a served or recalled ticket came back onto the board it
  had just left, because a feed replaced a whole store and the command path had
  moved the row to the OTHER one; and `syncScope()` ran only when a request
  STARTED, so a context change with no following read left the generation unmoved
  and an answer from the previous restaurant passed the check. There is now ONE
  monotonic clock (`opSeq`): a read takes a stamp when it STARTS, a command result
  takes one when it is APPLIED, and every ticket remembers the stamp of the write
  that last set it — so a read can only speak for tickets whose last write it
  could have seen, **in their FIELDS AND in their MEMBERSHIP**. That second half
  is the subtle one: a serve or recall MOVES a row between stores, so it is absent
  from the store being merged and the old copy was pushed back in as though it
  were new, leaving one id on Active and Completed at once. TOMBSTONES cover an id
  a command removed from both boards (a cancellation), forgotten once a newer read
  has settled the question. A PER-STORE WATERMARK on the same clock covers what a
  per-ticket stamp cannot express — a feed is a statement about a SET, so a read
  older than the newest one a store has applied may still correct a ticket it
  holds but may neither ADMIT one the newer read omitted, nor REMOVE one it never
  mentioned, nor RELOCATE one between the two stores; it also gates the protocol
  declaration, so a delayed older answer cannot flip a commandable board
  read-only. Scope is re-read when a request
  STARTS *and* when an answer LANDS, and the service now observes
  `AuthenticationService.user` so a PUBLISHED principal change invalidates the
  board with no read in between. **THE HONEST LIMIT IS STATED RATHER THAN
  IMPLIED**: a restaurant switch publishes nothing (`currentRestaurantRole` is
  read from `rest_role` on every access) and sign-out ends in a full page load, so
  there is no event for either — what is promised is that nothing ACTS on the
  stale context, because every entry point re-scopes and a command is refused
  outright, and the 3s poll catches the display up.
  **K2 — NOTHING EVER RESOLVED AN `unknown`.** `TicketOperation` kept a label and
  a revision but not the action, route, values or issuing context, so there was
  nothing to re-send even in principle; `applyFeed` never touched `_operations`,
  so a later read could show the command plainly landed while its warning sat
  there forever; `acknowledge()` DELETED an unknown outright, so OK silently meant
  "forget that the server may have acted"; `issue()` blocked only `pending`, so a
  fresh command at a refreshed revision quietly replaced an unanswered one — a
  different question asked as though it were the same; and a lost CANCELLATION was
  worst of all, because the order leaves both feeds, the card goes with it, and
  the notice rendered only inside a card. Now: the full command is RETAINED
  (`RetainedCommand` — route, values and the ORIGINAL `if_revision`, never
  refreshed on retry), an ordinary read settles what it can (the revision moving
  past the precondition is evidence; an UNCHANGED row is not), `reconcile(id)`
  asks `GET kitchen/orders/<id>/state/` for the case the feeds cannot answer,
  `retry(id)` re-sends the same command byte for byte, recovery is BOUNDED
  (`MAX_RECONCILE_ATTEMPTS`), and `acknowledge` clears only a SETTLED notice
  (`conflict` / `resolved`). **THE ONLY INFERENCE DRAWN IS FROM THE REVISION** —
  at or below the precondition means this command certainly did not land; beyond
  it means SOME command did, not necessarily this one — so a reconciled notice
  says what the order IS (`describeState`) and never "your cancellation went
  through". A read that fails, times out or 404s proves nothing and changes
  nothing. **THE CONSUMERS WERE HALF THE DEFECT**: the board now renders
  `unresolvedOperations()` whose ticket is DETACHED in its own strip, with Check
  and Try again, and the card offers recovery instead of a dismissal while the
  question is open and withholds its controls while the ANSWER is outstanding
  rather than merely while the request is in flight.
  **K3 — THE BOARD BELIEVED ANYTHING ROUGHLY SHAPED RIGHT.**
  `_shared`-style validation now lives in ONE place, `kitchen/services/kitchen-wire.ts`,
  read by the feed path, the success path, the conflict path and the
  reconciliation read. Before it: any array was a ticket list (`[null]` included);
  any finite number was a protocol level (`1.5` included); eligibility asked only
  `typeof revision === 'number'`, so `NaN`, `2.5` and `-1` became preconditions the
  server can never match; and `resolveSuccess` accepted any `data` carrying a
  numeric revision **without correlating `data.id`**, so a payload describing a
  DIFFERENT order was applied to the commanded ticket and its pending badge
  cleared — the board reporting a success the server never stated about that
  order. `readCommandSuccess` also refuses an error envelope delivered on a 2xx
  transport (a body carrying `reason`, or a `status` of 400 and up) and an unknown
  `outcome` word. **TWO FAILURES ARE KEPT APART because they call for opposite
  behaviour**: a server that declares NO protocol is an OLDER server — its feed is
  perfectly readable and the board simply may not command it — while one that
  claims the protocol and then sends something undefined is a CONTRACT ERROR, so
  the last valid board is retained, the operator is told, and no command is
  issued. It computes no business state: it checks that the server said something
  well-formed about the right order, never what the answer should have been.
  **AND THE DECLARATION IS A PROMISE ABOUT THE ROWS, NOT ONLY THE ROUTES** (Codex
  P2 on PR #669, valid). `isTicket` validated `fulfilment_revision` only when
  present, so a feed CLAIMING `kitchen_protocol: 1` was accepted with the field
  missing — the board then enabled itself on the declaration while `isCommandable`
  refused every single click, which is the worst outcome available: an operator
  presses Start and nothing happens, with no notice of any kind. `readFeed` now
  reads the declaration BEFORE the rows and requires the field from
  `REQUIRED_KITCHEN_PROTOCOL` up; an UNDECLARED feed keeps the pre-D05 tolerance
  exactly, and that control is pinned beside the refusal. The constant MOVED to
  `kitchen-wire.ts` and is re-exported from the service — the row rule has to read
  it, and two constants with one value is how a promise and the thing that checks
  it drift apart.
  **THREE MORE THINGS THE FIRST CUT LEFT ONE STEP SHORT** (the rest of that Codex
  round, all valid, each a case of the right rule reaching only part of what it
  governs):
  **THE PROTOCOL IS FENCED GLOBALLY, THE MEMBERSHIP PER STORE**, and conflating
  them was not a fence at all. A feed is a statement about one store's SET, so the
  watermark is per store; the declaration is a statement about the SERVER. Gating
  it on the per-store watermark meant a Completed read that STARTED before an
  Active read was still "the newest read" for its own store, so it republished a
  capability the Active read had already withdrawn — re-enabling commands from
  stale information during exactly the situation the gate exists for, a rollout or
  a mixed-version fleet. `protocolSeq` is one number on the one clock. The control
  — a genuinely later read still publishes — is pinned, because the wrong fix here
  is "whoever spoke first wins", which strands a board read-only after a rollout.
  **AN ANSWER THE BOARD DISCARDED CANNOT CLOSE THE QUESTION.** `mergeState` already
  refuses a projection older than the stored ticket, and `settleFromObservation`
  then called `settleAgainst` on that same projection anyway — so a poll landing
  first with revision 7 left the reconciliation read's revision 6 both REJECTED as
  state and ACCEPTED as evidence, free to clear an uncertainty or display a
  resolution contradicting the visible board. That is the defect this whole change
  is about, reappearing on the path added to fix it. `mergeState` now REPORTS
  whether it applied, and an overtaken observation leaves the question open for the
  next ordinary read to settle from state the board actually holds.
  **AND A FULFILMENT COMMAND IS SETTLED BY ITS OWN TARGET, never by "some forward
  state"** — the sharpest of the four. `matchesRequest` accepted `preparing` OR
  `ready` for an `advance`, but an ACTION does not identify a target: `advance`
  from `new` means `preparing` and from `preparing` means `ready`. So an advance
  to `ready` was "matched" by a ticket still sitting in `preparing`, and another
  device bumping the revision with an unrelated PRIORITY change — which moves the
  revision and nothing else — was enough to clear the operation and report a
  command that never landed as having succeeded. `RetainedCommand.target` records
  the exact state asked for (client-side only; the SERVER derives the edge from the
  action and the row it locks), and a command with no recorded target matches
  nothing, which is the safe direction. The revision moving is evidence that SOME
  command applied; it was never evidence that this one did, which is the rule
  `settleAgainst` states and this predicate quietly broke. `recallCompleted` now goes
  through the SAME eligibility check as every other command — it used to skip it
  entirely, which is why the 10-minute window existed only in a helper nothing
  on the Completed view called; the window is the SERVER's rule and the client
  check only spares a round trip. The board goes READ-ONLY unless the feed
  declares `kitchen_protocol` (`REQUIRED_KITCHEN_PROTOCOL`); it never falls back
  to the retired target-only form and never invents a revision. `ErrorInterceptor`
  forwards the raw `HttpErrorResponse` for the three order-command routes (matched
  on path SHAPE, not a substring) so the status, reason and projection survive —
  the kitchen READS and the stock toggle keep the string + toast behaviour.
  **BACKEND FIRST, THEN FRONTEND**, and the window between them is a write outage
  for the board — see backend `BREAKING_CHANGES.md` §15; there is deliberately no
  grace period. `e2e/kitchen-board/` is the manual two-device browser check.
  **AND THE SAME RULES NOW REACH THE WRITERS AND CALLBACKS THEY NEVER DID (R1–R3).**
  K1–K4 established the right policies; six consumers still went around them. No
  backend change: the contract is #320's, read-only and unmodified.
  **R1a — THE SERVER'S REVISION IS A FLOOR, BESIDE THE LOCAL ORDERING AND NOT
  INSTEAD OF IT.** `mergeFeed` ordered feeds by local request sequence alone, and
  LOCAL REQUEST ORDER IS NOT SERVER OBSERVATION ORDER: two reads are answered from
  snapshots the server took in whatever order it got to them, so a read that
  STARTED LATER can carry the OLDER state. No client clock can see that — by every
  local measure it is the newest thing the board has — and it walked a ticket
  backwards across the two boards at a revision the server had already left
  behind, and brought a CANCELLED order back from a snapshot taken before the
  cancel. `knownById` now holds the local stamp AND the highest server revision
  ever reported, as ONE entry because they must be evicted together, and it
  OUTLIVES THE TICKET — a cancelled order is in neither store, so reading the
  floor off the visible row lost it exactly when it was still needed. Neither
  fence replaces the other: the stamp answers *could this read have seen that
  write*, which is what an empty feed and new membership turn on; the revision
  answers *is this a state the server has already moved past*. A row must clear
  BOTH, and a row carrying no revision (a pre-D05 shape, reachable only on an
  UNDECLARED feed) is held back by neither, exactly as before. **EVICTION NEVER
  DROPS A FLOOR THAT IS STILL LOAD-BEARING** — board ids, operation ids and
  TOMBSTONED ids are all protected now (the tombstone map was already exactly the
  removed-order set; it simply was not consulted) — **and it runs AFTER the
  writer's stores are final, never from `noteWrite`**: the sweep decides liveness
  by READING the stores, and a write happens before the store it belongs to is
  installed, so a sweep at write time judged the row being admitted against the
  PRE-merge board and deleted the floor it had just created. Found by Codex on
  #670, reproduced (a ticket walked `ready`@5 → `new`@3) and pinned. The bound is
  STATED rather than implied: a settled order with no operation, on no board and past its
  tombstone is eventually forgotten, which takes hundreds of later orders, by
  which time nothing from before is outstanding (reads time out at 8s, commands at
  15s). A spec pins the protection and a second pins the limit, so neither reads
  as a promise the other contradicts.
  **R1b — AN AUTHORISED CONFLICT IS AUTHORITATIVE ABOUT MEMBERSHIP TOO.**
  `resolveFailure` merged with moves DISABLED, so a 409 reading `order_cancelled`
  repainted the card and left the cancelled order sitting on the active board —
  false membership used as the mechanism for displaying a message. The
  `allowMove` escape hatch is GONE, and the store is the ticket's ACTUAL one
  (`storeOf`), never the assumption that every conflict came from Active: a recall
  refused from Completed puts the ticket back where the server says it belongs.
  The notice follows the ticket rather than dying with it — `unresolvedOperations`
  now includes `conflict`, `syncDetached` is two-way, and the board's `isSettled`
  covers a conflict so the strip offers dismissal rather than a recovery of
  something already answered. **ABSENCE FROM A FEED IS STILL NEVER READ AS A
  CANCELLATION**, and a spec pins it.
  **R2a — EVERY MUTATION ENTRY CLEARS THE SAME GATE, REPLAY INCLUDED.** `retry()`
  walked past `canCommand()`, so a board that had gone read-only after a rollback
  could still put a command on the wire through Try again. The command is KEPT,
  not discarded — support may come back, and the retained copy is the only record
  of what was asked — and the ORIGINAL precondition is never refreshed.
  **R2b — A CONTEXT OWNER IS NOT AN OPERATION OWNER.** Callbacks read whichever
  `_operations[id]` existed on arrival. `OperationOwner` now carries an `opId`
  minted per REQUEST (issue, retry and reconcile alike) and captured before it,
  and every callback verifies context AND operation. The reachable protection is
  SINGLE FLIGHT, enforced in `reconcile()` and `retry()` themselves — both now
  require phase `unknown`, where `checking` used to be accepted — so one question
  at a time per order. The identity check is defence in depth and is labelled as
  such in the spec: today's production paths that retire a question also
  unsubscribe, so the interleaving is constructed rather than reached.
  **R2c — AN UNCHANGED OBSERVATION PROVES NOTHING.** `settleAgainst` claimed "This
  command did not reach the kitchen server" whenever the revision was at or below
  the precondition. The state read takes no lock and opens no transaction, so the
  command may have been received and be waiting behind the row lock the transition
  takes, or be mid-transaction and not yet visible, or have been lost. It now says
  what is true — no change is visible yet, we could not confirm it — and leaves the
  question open.
  **R3 — A RESULT IS READ AGAINST THE COMMAND THAT PRODUCED IT.**
  `readCommandResult` (`kitchen-wire.ts`) is the one decision, supplied with the
  retained command: `applied` must be EXACTLY the precondition plus one (every
  applied path goes through the server's single `_bump`, which increments once),
  `unchanged` is the priority-only no-write result AT the original revision (one
  producer, the priority-equality branch), and in both the state must show what was
  asked for. `stateSatisfies` is shared with `matchesRequest`, so the mutation and
  reconciliation paths cannot form different opinions about one command. A valid
  result is SELF-PROVING and resolves the operation even when the board has since
  learned a higher revision — deliberately the opposite of an OBSERVATION, whose
  revision is its only evidence. `readConflict` now keeps ABSENT state (a 403
  policy denial legitimately carries none) apart from PRESENT-BUT-INVALID, which it
  used to drop silently and report as a clean refusal; `readObservedState` refuses
  an error envelope delivered on a 2xx transport. **Two pre-existing fixtures were
  CORRECTED, not the rule relaxed**: both returned an applied revision the server
  has no path to (4 and 2 from a precondition of 0).
  `kitchen-consumers.spec.ts` drives all of it through the real `ApiService`,
  `HttpClient` and interceptor chain — `HttpTestingController` is what supplies the
  distinct start / observation / arrival barriers these interleavings need — and
  `e2e/kitchen-board/` scenario 8 is the browser sibling of scenario 5: there the
  read began EARLIER, here it begins LATER and the SERVER observed earlier.
  **AND TWO R1 CASES SURVIVED THAT ROUND (M1, M2).** No backend change; the
  contract is still #320's.
  **M1 — CANCELLED MEANS ABSENT FROM BOTH FEEDS.** `mergeState`'s terminal branch
  filtered `_tickets` and then, for a cancellation, wrote a tombstone under a
  comment reading "Gone from both boards". Nothing ever filtered `_completed`, so
  the comment did not describe the branch it sat in — and the ORDINARY two-device
  sequence puts the order there: a served ticket is recalled by one device, a
  manager cancels it, and the first device's stale recall is refused
  `order_cancelled` with the current projection. The row was PATCHED to cancelled
  and left on the Completed board, and `syncDetached` — which asks where the
  ticket IS — found it there and left the refusal attached to a card that should
  not exist. The decision now lives ONCE in `mergeState`, so a command result, an
  authorised conflict and a per-order observation cannot disagree about it: a
  terminal state that is not `served`-and-not-cancelled clears BOTH stores,
  keeps the floor and the tombstone, and the notice moves to the detached strip
  with its own reason intact. `paid`/`refunded` are untouched — only `served` and
  `cancelled` reach that branch at all — and the legitimate recall-to-ready move
  is unchanged. **`stateSatisfies` GAINED ONE GUARD WITH IT**: a cancelled order
  satisfies no command but a cancel. The server's cancel writes `order_status`
  and LEAVES THE FULFILMENT AXIS WHERE IT WAS, so an order cancelled at `ready`
  reports `ready` for ever after and a recall that asked for `ready` matched by
  coincidence — an operator whose ticket a manager cancelled underneath them was
  told their recall had landed, about an order on no board at all.
  **M2 — RETIRING PROTECTION MUST RETIRE THE RESPONSE IT PROTECTED AGAINST.**
  `evictKnown` drops a `knownById` entry once the id is on neither board, carries
  no operation and is past its tombstone; it never asked whether an OLDER read was
  still outstanding. ONE Completed response supplies both halves — it omits the
  cancelled id, which frees the tombstone, and the previously served tickets it
  carries are the eviction pressure — so this is NOT a claim about order volume,
  and at `MAX_KNOWN_ORDERS` exactly the entry a delayed Active read would have
  been refused by is the one released. `retirementCutoff` is the whole mechanism:
  every release calls `retire()`, and `applyFeed` refuses a read that STARTED
  before the boundary that release took — whole and early, so membership, fields,
  the protocol declaration and operation settlement all go together. **REFUSING IS THE
  HALF TO GIVE UP, not retaining**: `loadCompleted` is subscribed bare by the
  board with NO timeout, so "the oldest read in flight" is not a quantity this
  client can bound, while the board keeping what it has for one poll cycle costs
  three seconds. The watermark only moves forward and only on an actual release,
  so recovery never freezes — a read issued after a retirement always carries a
  newer stamp. **THE TOMBSTONE-FORGET RULE WAS LEFT EXACTLY AS IT WAS**, having
  been changed and then reverted: forgetting a tombstone releases nothing an
  older read needed (the order's stamp and floor still stand), it only makes the
  id eligible for eviction, and a mutation test showed removing it fails nothing.
  A change no test can fail does not ship in a bounded correction.
  `kitchen-membership-retention.spec.ts` drives both through the real HTTP chain
  and `e2e/kitchen-board/` scenario 9 is M1's browser case — a real recall and a
  real manager cancellation on one device, both of A's feeds frozen so no later
  poll can hide the defect, asserted on the card and the strip.
  **AND THE BOUNDARY IS THE RELEASE, NOT THE RECORD BEING RELEASED (M2b).** M2
  retired the released entry's own `stamp` — the moment it was last WRITTEN — on
  the reasoning that this named the reads it would have refused. It names half of
  them, because a `knownById` entry is TWO protections and only one of them is
  bounded by that stamp: the STAMP refuses a read that began before the write,
  while the REVISION FLOOR refuses any row the server has already moved past,
  **whenever the read carrying it began** — which is the entire reason R1 put the
  floor beside the stamp rather than replacing it. So the interval
  `entry write < held read's start < release` fell between the two: above the old
  cutoff, with the floor that would have refused it now gone. Reached by an
  ordinary two-device sequence — a Completed read observes a serve, another device
  recalls inside the window, and one later Completed response of historical
  service data both drops the order and supplies the eviction pressure — after
  which an Active read that started BEFORE all of it was admitted at a revision
  the server had left two commands ago. `retire()` now takes a FRESH stamp from
  the same clock at the actual release, so every read issued before it is below
  it whenever the thing it needed was recorded, and every read issued after is
  above it. **A FRESH STAMP, NOT THE LAST ISSUED NUMBER**: a feed's stamp is taken
  when its REQUEST STARTS, so a read begun after it can still be outstanding when
  it lands and triggers the sweep — and with `seq < cutoff` a cutoff set to "the
  last number issued" leaves exactly that read eligible. Pinned by its own spec,
  and by a mutation that fails only it. **BOTH RELEASE SITES GET THE SAME
  SEMANTICS** (entry eviction and tombstone-cap overflow) and neither fires on a
  sweep that releases nothing — a mutation retiring on every sweep fails the new
  no-op spec AND M2's own poll-in-flight control. Bounds, liveness classes and the
  tombstone-forget rule are untouched; the cost is that one already-outstanding
  feed may be discarded, and the next poll is the recovery.
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
- Owner claim (route `/owner-claim`): ✅ the restaurant-portal half of backend Phase-1
  Step 2F. A PUBLIC, standalone, lazy `OwnerClaimComponent` (`src/app/auth/owner-claim/`)
  that turns a raw claim code plus an OTP into a fully bootstrapped portal session:
  `POST users/owner-claim/challenge/` → `POST users/owner-claim/redeem/` →
  `GET users/user-profile/` → install → land on the claimed restaurant. The route sits
  ABOVE the portal parent and carries NEITHER `AuthGuard` (the claimant has no session)
  NOR `loginRedirectGuard` (an already-signed-in operator claiming a SECOND restaurant
  must reach the form, not be bounced to their existing landing); `owner-claim` is on
  `NON_BANNER_SHELL_ROOTS` because it renders the AuthShell, not the portal banner.
  Five things about it are load-bearing:
  - **THE CLAIM CODE IS A BEARER CREDENTIAL HELD ONLY IN COMPONENT MEMORY.** Never a
    query param, route param, fragment, localStorage, sessionStorage, cookie,
    navigation state, analytics payload or log — it rides `X-Owner-Claim-Token` and
    nothing else, matching the backend's single canonical extractor. A refresh loses
    it and the owner pastes it again; that is the accepted cost of there being NO
    delivery or claim-link architecture yet. Do not invent one, and do not fabricate
    an invitation URL
  - **ALL THREE CALLS BYPASS THE INTERCEPTORS**, via a `HttpBackend`-built client in
    `_services/owner-claim.service.ts`. Two distinct defects: `AuthInterceptor` would
    attach an ambient operator's Bearer token to endpoints the backend deliberately
    declares `authentication_classes = []`; and — the one that produces a WRONG ANSWER
    — it would overwrite the fresh redemption token on the bootstrap read, hydrating
    the PREVIOUS user's profile and installing their memberships as the claimant's.
    The bootstrap sets `Authorization` explicitly from the redemption result. A
    consequence is that `ErrorInterceptor` is bypassed too, so the service owns its own
    `HttpErrorResponse` translation (offline / rate_limited / refused / password /
    server / unauthorized / malformed) and the screen renders errors inline instead of
    as toasts. **Do NOT "fix" this by special-casing claim URLs in the global
    interceptors** — the raw client is what makes the claim independent of ambient state
  - **NOTHING IS PERSISTED UNTIL THE CANONICAL PROFILE ARRIVES.** Redemption returns
    `token + refresh + restaurant_id` and NO profile, while `AuthGuard` authorises off
    `profile.restaurant_roles` — so persisting the tokens alone would produce a browser
    that believes it is authenticated with no memberships, bounced off every guarded
    route while a valid session sat in storage. The redemption stays in memory until
    `GET users/user-profile/` succeeds, then ONE
    `AuthenticationService.installAuthenticatedSessionAndReload(session, membership,
    landingPath)` seats it (resetStorage → persist the complete `LoginResponse` →
    publish → persist `rest_role` → HARD navigate). That method mints nothing and is
    deliberately not a generic `setUser(any)`
  - **THE CLAIMED MEMBERSHIP IS SELECTED FROM THE CANONICAL PROFILE, NEVER BUILT.**
    `restaurant_id` from redemption is CONTEXT; `profile.restaurant_roles` is AUTHORITY.
    The matching entry is used as-is, carrying the backend's resolved `permissions` map
    that no client can compute. If the claimed restaurant is ABSENT from the profile the
    flow **FAILS CLOSED** — no session, no navigation, no `restaurant_roles[0]` fallback
    — and shows a recoverable error, because the claim result and the membership
    resolver disagreeing is a real anomaly that deserves to be seen
  - **REDEMPTION SUCCESS + BOOTSTRAP FAILURE IS ITS OWN STATE.** The claim has already
    COMMITTED server-side, so Retry re-runs the PROFILE READ ONLY — re-POSTing a
    consumed invitation would return the generic refusal and read as "your claim
    failed" about a claim that succeeded. The panel says the claim is complete and
    points at ordinary sign-in if the page is closed
  - **EVERY CLAIM REQUEST IS BOUND TO THE COMPONENT'S LIFETIME** (`takeUntil(destroy$)`
    on all four: challenge, resend, redeem, bootstrap). Angular does NOT cancel an HTTP
    request when a component is destroyed — only unsubscribing does — and clearing the
    fields in `ngOnDestroy` does not help, because `runBootstrap` closes over its
    `redemption` ARGUMENT rather than reading the field. An unbound profile response
    arriving after the user navigated away would still call `completeWith`: installing
    the claimed session, replacing whoever was signed in, and redirecting them off
    whatever page they had moved to. Redeem is worse — its `next` STARTS the bootstrap,
    so a dead component would issue a fresh request. All four are bound rather than only
    the bootstrap: they are one defect, not four
  - **THE SUCCESSFUL CLAIM ENDS IN A FULL PAGE LOAD, NEVER `router.navigateByUrl`**
    (OWNER-CLAIM-HARD-BOUNDARY-00). **Clearing storage does not replace an operator.**
    `resetStorage()` empties localStorage, but every `providedIn: 'root'` service is
    the SAME INSTANCE after a soft navigation, still holding the OUTGOING tenant's
    data in its subjects. `MenuService._rawSections$` / `_allItems$` are the worked
    example: they are BehaviorSubjects, so `sections$` keeps emitting the previous
    restaurant's menu from the principal switch until a replacement read for the new
    one SETTLES — and anything rendering off it in that window paints one tenant's
    data inside another tenant's session. Owner claim can begin while a DIFFERENT
    operator is signed in (the route is public, deliberately), so this is a
    cross-session confidentiality problem rather than a stale-cache annoyance. The
    hard navigation destroys the Angular injector and forces every root service to be
    reconstructed under the new principal — the same mechanism `revokeAndExit`
    already relies on for logout. **Do NOT substitute a hand-maintained list of root
    caches to clear**: that list drifts the moment another root service starts
    holding tenant data. The reload fires ONLY after a complete successful bootstrap
    and canonical membership selection; an invalid claim, a wrong OTP, a rejected
    password, a pending redemption, a failed bootstrap and a claimed restaurant
    missing from the profile all return earlier and leave the ambient session
    untouched. `hardRedirect` stays PROTECTED — reachable only through an operation
    that has already put storage in a consistent state, never as a public
    `hardRedirect(url)`. **It NAVIGATES BY `location.replace`, not `location.href`**:
    destroying the document achieves nothing if the browser can hand it straight
    back, and the back-forward cache restores a whole JS heap rather than
    re-executing the page. The pre-claim document is the one thing that must not
    come back — this service has already published the INCOMING principal there
    while every other root service still holds the OUTGOING tenant's data, which is
    precisely the hybrid the reload exists to destroy. `hardRedirect`'s `mode`
    argument carries this; **logout keeps the `'push'` default** (its outgoing
    document is internally consistent) and its history behaviour is unchanged
  - **THE BOOTSTRAP-FAILURE "Go to sign in" IS A BUTTON THROUGH `logout()`, NEVER A
    `routerLink` TO `/login`.** `/login` carries `loginRedirectGuard`, which forwards
    anyone holding a session AND a selected membership straight to their existing
    landing — and this panel deliberately PRESERVES an ambient operator's session, so a
    plain link would bounce the claimant to somebody else's dashboard on the very screen
    that promises "just sign in normally". `logout()` ends that session properly
    (server-side revoke, storage cleared, hard redirect), so the form renders and the
    guard has nothing to redirect; with no session open it is a no-op landing on
    `/login`. The stage-1 "Already set up? Sign in" link is deliberately left a plain
    `routerLink` — there, forwarding an already-signed-in operator to their landing is
    the guard doing its job
  Two smaller contracts worth keeping: `credential_setup_required` comes STRAIGHT from
  the challenge response and is never inferred (it decides whether `new_password` is
  sent, and the backend refuses an unwanted one rather than ignoring it); and "Send
  another code" re-calls the CLAIM challenge, never `users/auth/resend-otp/`, because
  the owner-claim OTP has its own purpose and redemption binds verification to it.
  The post-claim landing uses the SAME `firstAccessibleRoute(permissions, roles)` login
  uses — never a hard-coded `/dashboard` — and no restaurant selector is shown, since
  the claimant just told us which restaurant they mean. It deliberately does NOT divert
  to `lock-otp-exp` on `prompt_password_change`: that screen needs the user's OLD
  password, which a claim never collects. The generic backend refusal is rendered
  VERBATIM and never interpreted into "expired" / "wrong code" / "already claimed" —
  the backend collapses those on purpose, and attempt counters are never displayed
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
- `src/app/_shared/order/` (per-file imports, no barrel) — the D01 request ceilings
  (`checkout-limits.ts`), the backend-authored fixture they are pinned against
  (`checkout-limits.contract.json`), `line-money.ts` (the ONE place a basket line is
  composed from its components) and `quote-review.ts` — THE single reading of a
  server quote, shared by the review sheet and by `confirmQuote` (see the checkout
  bullet in Current Implementation Status for its rules and the three version cases).
  Reach for `reviewQuote` before adding any second opinion about whether a quote may
  be confirmed; it is a specific contract, deliberately not a generic schema
  framework. The numbers are the BACKEND's; both repositories
  assert their own constants against that file. Deliberately a static file rather than
  a runtime fetch: eight integers do not need a round trip, and a fetched limit would
  be unavailable exactly when the diner is offline and the basket most needs to behave
- `src/app/_shared/utils/decimal-money.ts` — exact decimal money for the checkout
  comparison. Parses the digits of a canonical decimal string directly, compares as
  integers with NO epsilon, and returns `null` (never `0`) for anything it cannot
  represent exactly. Reach for it before comparing any client figure against a server
  amount; never `Math.round(Number(v) * 100)`
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
- **Every component MUST state `changeDetection` explicitly, as
  `ChangeDetectionStrategy.Eager`.** Angular 22 changed the compiled default:
  `changeDetection: decl.changeDetection ?? OnPush`, so a decorator that omits it
  is now OnPush. This app was written against eager change detection, so every
  component states it — behaviour preservation, not an endorsement.
  **`Eager` is the v22 name; `Default` is the same enum value (both `1`) but is
  `@deprecated` and "due to be removed"** — write `Eager`, and do not reintroduce
  `Default`. A component that omits the field silently gets OnPush and stops
  re-rendering on plain field mutation, which neither the compiler nor the type
  checker reports. **That is now lint-enforced**: a `no-restricted-syntax` selector
  in `eslint.config.js` fails any `@Component` whose metadata object has no
  `changeDetection` property, spec-local host components included (the official v22
  migration skipped four of those, which is why specs are in scope). Its `>
  Property` is load-bearing — an unscoped `:has(Property…)` would also be satisfied
  by a `changeDetection` key nested in an inner object and quietly stop catching the
  real case. angular-eslint v22's `prefer-on-push-component-change-detection` is
  turned OFF for the same decision's other half (same opt-out spirit as
  `prefer-standalone` / `prefer-inject`). Adopting OnPush properly is a separate,
  deliberate project: it needs a per-component audit of every async mutation, since
  an eager component updating from an HTTP/timer callback stops re-rendering under
  OnPush unless something marks it dirty
- **HttpClient is pinned to the XHR backend.** Angular 22 flipped
  `provideHttpClient()`'s default from XHR to Fetch, so the v22 migration added
  `withXhr()` to the single call in `app.module.ts` (and to 32 spec TestBed setups).
  This preserves pre-22 behaviour; **adopting Fetch is a deliberate follow-up, not a
  default to drift into.** The audit for that follow-up, already done: no
  `withCredentials` anywhere, no direct `XMLHttpRequest` / `XhrFactory` /
  `HttpXhrBackend` reference, and the one genuinely Fetch-sensitive call —
  `ApiService.postFileWithProgress` (`reportProgress` + `observe: 'events'`, which
  Fetch cannot report for uploads) — **has no callers**. `UserChangePasswordOnLogin`
  also sets `reportProgress: true`, but with `observe: 'response'`, where the flag is
  inert. So the switch looks cheap; it still gets its own PR
- **`$safeNavigationMigration()` wrappers in templates are load-bearing — never bulk
  `sed` them away.** Pre-22 a template `?.` yielded `null` when the receiver was
  nullish; v22 yields `undefined`. The v22 migration wrapped the sites where that
  distinction reaches a null-sensitive sink, restoring `null`. There are **16, across
  7 templates** (`auth/register` 5, `settings/billing` 3, `_common/confirm-dialog` 3,
  `diner-app/payment-details` 2, then one each in `menu/section-form-dialog`,
  `menu/item-form-dialog`, `diner-app/menu`). They are deliberately narrow — in
  `confirm-dialog` only a ternary's consequent is wrapped, not its truthiness test,
  and in `payment-details` the `=== 'successful'` comparisons are left bare, since
  `null` and `undefined` are indistinguishable there. Unwrapping them is a
  site-by-site audit of what each sink does with `null` vs `undefined`, one PR of its
  own
- **An Angular major is `ng update`, never a version bump.** A bump alone —
  Dependabot's or ours — installs the new framework without running its migrations,
  and the migrations that matter are RUNTIME behaviour changes that type-check, lint
  and `build:prod` all pass straight through (v22's Fetch default and the `?.`
  null→undefined change were both invisible to all five gates). **A Dependabot PR
  crossing an Angular major is closed and replaced by an `ng update` PR.** If a
  manual bump has already landed, run the migrations after the fact:
  `ng update <pkg> --migrate-only --from=<old> --to=<new>` (needs `--allow-dirty`
  after the first, and must be run for `@angular/cli`, `@angular/core` AND
  `@angular/cdk` — each ships its own set). PR #648 is the worked example: it bumped
  manually, went green, and still needed eight core migrations afterwards
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
- Kitchen real endpoints: GET `kitchen/orders/active/` + `kitchen/orders/completed/`
  (polled), PUT `kitchen/orders/{id}/fulfilment-status/`,
  `kitchen/orders/{id}/priority/` and `kitchen/orders/{id}/cancel/` (each naming an
  explicit action and a REQUIRED `if_revision`), and GET
  `kitchen/orders/{id}/state/` — the per-order OBSERVATION that settles an
  uncertain command. That last one is the ONLY thing the two feeds cannot replace:
  a cancellation removes the order from both of them, so "it is not on the board"
  is not an answer about whether the command ran. It is issued ON DEMAND from a
  `reconcile(id)` / Check tap, never as a sweep — a spec pins that an ordinary poll
  reads no per-order state at all
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
  for the same reason — it only affects targets below ES2015 and this app is ES2022.
  Separately, `tsconfig.app.json` and `tsconfig.spec.json` (NOT `tsconfig.json`) each
  carry an `angularCompilerOptions.extendedDiagnostics.checks` block suppressing
  `nullishCoalescingNotNullable` and `optionalChainNotNullable`, written by the v22
  migration: both would otherwise fire spuriously on the `$safeNavigationMigration()`
  wrappers. Consequence worth knowing — `optionalChainNotNullable` IS NG8107, so the
  three warnings `menu.component.html` used to print on every build are now silent by
  configuration rather than by being fixed
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
workflows install with a plain `npm ci` — **no `--legacy-peer-deps`** (DEPS-HYGIENE-01).
The flag was needed while the Angular 21 tree had peer conflicts; the v22 tree
resolves strictly, so it now only HIDES future ones. That matters concretely: a
partial Dependabot major bump (exactly what #635 was) installs cleanly under the
flag and fails later at runtime, instead of failing fast at install. Dinify-Admin
already installs strictly, so this also removes Frontend as the org outlier. Use a
plain `npm ci` locally too — if it ever raises ERESOLVE, that is the signal, not
something to flag away.

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
