# Checkout journey (D02/D03) and induced loss (D04)

A **manual, repeatable real-browser** check of the one thing no unit suite can
observe: that the diner is shown the **server's** amount before agreeing to it,
that agreeing is something they **do** — through the application's own Place
order button — that the amount they agreed to is the one saved and sent to the
kitchen, and that an acknowledgement the server does not recognise is refused
rather than quietly accepted.

It is deliberately **NOT wired into CI**, and it prints that at the end of every
run. It needs a disposable PostgreSQL, a running Django and a running dev server,
and CI has none of those. It is a **pre-merge gate for changes to the checkout
pricing or confirmation path**, run by hand.

Two scripts share one fixture and one setup:

| | |
|---|---|
| `journey.mjs` | the CLEAN path — 42 checks, below |
| `recovery.mjs` | INDUCED LOSS — 35 checks, the D04 section near the bottom |

## What it asserts

| | |
|---|---|
| a QR scan reaches the menu | the capability channel is intact end to end |
| a paid modifier and an extra can be configured | the selection UI drives the real payload |
| the add button shows the configured line total | **extras scale with the parent quantity** (the D02 defect) |
| the basket holds ONE line for the configured dish | **one configuration is one line** (the D03 defect) |
| the operator raises the price mid-run | through the real `restaurant-setup/menuitems/` PUT, after the basket and before the review |
| the review sheet appears BEFORE anything is submitted | correct calculation is not agreement to an amount |
| **no submission has been issued at review time** | asserted on the network, and again on the saved `order_status` |
| the reviewed amount IS the server amount | read from the very response the page rendered, matched **inside the review panel** |
| **the review shows the CURRENT server price** | not the figure the browser cached before the reprice |
| **every quote amount is a canonical decimal string** | `quote_total` and all ten line keys and three extra keys, checked against `/^-?\d+\.\d{2}$/` — the wire contract, not a value that merely parses |
| **the visible total and line elements match EXACTLY** | located by `data-testid` and compared whole (`UGX 35,011.30`), never searched for as a substring of the panel |
| **the review shows the modifier instructions and the child quantity** | `Large`, `× 2` on the parent AND `× 2` on the extra — a diner confirming an amount must see what it is for |
| the quote carries each extra beneath its parent line | `line_total_with_extras`, composed in integer cents from `line_actual_cost` + the child's own amount |
| **the quoted lines reconcile to the payable, to the cent** | each child counted once, against a real server |
| **a NONZERO FRACTION survives extension and the wire** | the mid-run reprice to `12000.15` makes the line exactly `35000.30`; `15500.15 × 2` in doubles is `31000.299999999996` |
| **a sub-cent adjustment rounds ROUND_HALF_EVEN, once, per unit** | `1.005` → `1.00`; half-up gives `1.01` and the run fails by a cent. A SEPARATE control from the fraction above — that one proves extension, this one proves ties |
| the saved draft is CORRECTED-priced and named | `pricing_version` + `quote_ref` |
| an unrecognised `quote_ref` is refused | `quote_ref_stale` |
| an ABSENT `quote_ref` is refused | `quote_ref_required` — never treated as agreement |
| a refused submission leaves the basket intact | read from storage, not from the screen |
| **the real Place order button submits and is accepted** | the click, not a fetch |
| the submission echoes the reviewed quote reference | the app sends what it rendered |
| a definitive success navigates to the confirmation | `/diner/basket/order-complete` |
| the basket is cleared **only** after acceptance | it held both lines through the review and both refusals |
| the accepted order stores the agreed amount | read back over the diner channel, from the CANONICAL `quote_total` — not the legacy numeric field beside it |
| the saved order still reconciles across its own lines | and declares `quote_complete` |
| exactly ONE accepted order reaches the kitchen | read back as the authenticated fixture operator |
| the kitchen is told to cook what was configured | quantity 2, the nested extra AT quantity 2, and the `Large` modifier — read from the ticket's `modifiers` key, which is what `serializers_kitchen.py::_line` renames `modifiers_snapshot` to on the wire |
| the page raised no uncaught errors | a screen that throws on every render fails the run |

### What the first real run of this revision found (D04 Stage A)

**The strengthened revision above had never been executed.** PR #662 said so; it
was then run for the first time at `f426eba` / backend `d5d886e` and scored
**40/42**. The two failures were its own closing assertions:

```
FAIL  the accepted order stores the amount the diner agreed to  — saved=undefined
FAIL  the accepted order still reconciles across its own lines  — quote_complete=undefined
```

**That was a DISAGREEMENT ABOUT AVAILABLE FIELDS, not a wrong amount**, and the
distinction is worth keeping: `quote_total` / `quote_complete` were produced only
by `serialize_order_details`, which assembles the **initiate** response, while
this assertion reads `orders/journey/order-details/` — a different serializer
that had never carried either key. Nothing showed the stored payable was wrong,
and the saved amount was not changed to make the run green.

Two things were fixed, and neither was the assertion's standard:

1. **The read now publishes them** (D04/U1) — `quote`, `quote_total` and
   `quote_complete`, through the same `format_money` and the same
   `group_live_children` rule the initiate response uses, at no extra query.
2. **The harness was reading the wrong level.** It looked for `body.quote`,
   a key no response has ever carried, and `|| []` then summed that absence to
   zero — reporting a missing field as a reconciliation failure. It reads
   `body.data.quote` now and requires the array to be non-empty.

The `Math.round(Number(v) * 100)` oracles went at the same time. That expression
cannot be the oracle for an exactness claim — it is neither an exact decimal
parser (`Number('1.005') * 100` is `100.49999999999999`) nor the backend's
ROUND_HALF_EVEN rule — so `minor()` parses the canonical string with `BigInt` and
**throws** on anything that is not `-?\d+\.\d{2}` rather than coercing it. It is
deliberately test-local: an oracle that imported the production parser could not
detect the production parser being wrong.

### No `actual_cost` fallback here, deliberately

The client applies a bounded compatibility path when a CORRECTED response omits
`quote_total` — backend #314 shipped the itemised quote before that field
existed, and refusing it would block checkout for the width of a deploy. That
tolerance belongs to the CLIENT, against an OLDER server. **This journey runs
against the current backend and holds it to the current contract**, so it reads
`quote_total` directly: reading through the fallback would let a real wire
regression pass silently on the lossy numeric field.

One consequence: this run asserts `quote_complete`, which the backend publishes
only from R2 onward. Run it against a backend that carries that change.

### Two things it deliberately does NOT cover

1. **A refused submission through the real button.** Producing one needs the
   draft consumed out of band first, which also consumes the table — so the same
   run cannot then exercise the positive click. The app's behaviour on a refused
   click (inline `legacy_pricing_version` / `quote_ref_stale` recovery, basket
   retained, no navigation) is covered by
   `src/app/diner-app/basket/basket-body/basket-body.component.spec.ts`.
2. **Anything about payment.** There is no payment execution in either
   repository; the journey stops at acceptance, which is where the product does.

### Waiting

Every wait is a **locator or response condition**, never a fixed sleep — so a
slow machine makes the run slower rather than red, and a genuinely missing
element fails at its own assertion instead of at a later, confusing one.

## Running it

```bash
# 1. A disposable PostgreSQL, and a database for the journey.
#    (Never point this at UAT or production.)
export DATABASE_ENGINE=django.db.backends.postgresql
export DATABASE_NAME=dinify_journey DATABASE_USER=... DATABASE_HOST=... DATABASE_PORT=...

# 2. Seed ONE restaurant with a modifier + extras dish, a sub-cent rounding dish,
#    and the owner MEMBERSHIP the journey signs in as. Prints the fixture the
#    browser script reads, including the table's QR credential and the operator's
#    disposable credentials.
cd ../Dinify-Backend
python manage.py migrate --settings=dinify_backend.test_settings
python manage.py shell --settings=dinify_backend.test_settings \
  < ../Dinify-Frontend/e2e/checkout-journey/seed.py | tail -1 > /tmp/journey-fixture.json

# 3. The API. ENV=dev is what fixes the operator's OTP at 1234 — which is why
#    this only ever runs against a disposable local database.
python manage.py runserver 127.0.0.1:8099 --settings=dinify_backend.test_settings --noreload &

# 4. The app, pointed at it. Temporarily set environment.ts's apiUrl to
#    http://127.0.0.1:8099 — do NOT commit that change.
cd ../Dinify-Frontend
npx ng serve --port 4299 --host 127.0.0.1 --configuration development &

# 5. The journey. It takes no arguments: the price change now happens INSIDE the
#    run, so there is no second pass to configure. `playwright` is NOT a
#    dependency of this repo (it would be a production-tree dependency for a
#    manual script), so install it wherever you run from:
#        npm i --no-save playwright
#    and point CHROMIUM_PATH at a browser you already have.
node e2e/checkout-journey/journey.mjs
```

`JOURNEY_WEB`, `JOURNEY_API`, `JOURNEY_FIXTURE` and `CHROMIUM_PATH` override the
defaults. Exit status is non-zero if any check fails.

Last run: **42/42 (`journey.mjs`) and 47/47 (`recovery.mjs`)** against a
disposable local PostgreSQL 16.13 (its own cluster, never a shared instance), a
local Django on `test_settings` (Python 3.11) at the D06 COMPLETION revision, and
a **development** `ng serve` on Node 24.15.0 with Chromium 141
(`/opt/pw-browsers/chromium-1194`), driving the matching frontend.

**RE-SEED BEFORE EVERY RUN.** The first attempt of that run scored 4 checks in
and failed on two of its own: the fixture dish was ALREADY at the mid-run reprice
target and a `pending` order was still holding the table, so the Checkout button
was correctly disabled and the reprice PUT correctly answered "no changes". Both
were LEFTOVER STATE from an earlier run of this harness against the same
database, not defects — the journey mutates its fixture by design. Drop and
recreate the database, migrate, re-seed.

**ONE ASSERTION IN `recovery.mjs` WAS INVERTED, DELIBERATELY (D06/G3b).** The
sold-out scenario required every idempotency key to be the SAME across the
re-price, on the reasoning that the basket has not changed so the purchase has
not changed. That holds for a `quote_ref_stale` reprice and is FATAL for a
closure: the key is bound to the order the closure was written against, so
re-pricing under it replays a retired draft the diner can never pay for. It now
requires a NEW key, and the old expectation is recorded beside it rather than
deleted — it was a real statement about the contract, and it is the statement
that moved.

**SCENARIO 4 IS NEW, AND IT IS THE ONE THIS HARNESS COULD NOT DO BEFORE.**
Scenario 3 reloads with the cart UNTOUCHED, so the accepted purchase is still
the one on screen and clearing it is right. Scenario 4 loses an acceptance the
server really committed and then EDITS THE CART through the real stepper — which
re-reserves nothing, so the intent key and the table are both unchanged. The
completion guard compared exactly those two, so a valid acceptance for the OLD
purchase erased a basket it had never contained. It asserts BOTH halves, because
either alone is satisfiable by being wrong in the other direction: the
acceptance is still announced, and the newer cart is still there.
**Verified by reintroducing the defect in the served app: 33/35**, the two
failures reading `lines=0` — the diner's edited basket gone. Its waits are on
the stored-quantity barrier and the recovery-notice locator, not a sleep.

**THE ENLARGED `recovery.mjs` HAS NOW BEEN MEASURED.** The six checks added with
the D04 correlated projection — the intent key, order and scope the answer
names, the three-state acceptance verdict, the original accepted reference, the
separately-labelled current state, and the protocol level — were carried here as
an explicit unmet gate through the D04 completion PR, which shipped with the
harness at 28 checks and the last measured count at 22. They need a backend
carrying `checkout_protocol` 3, and `fd190ddc` is the first main that does.

Three things about that line are deliberate. The counts are the ones a run
actually PRODUCED, never edited to match the harness — a revision of this file
once claimed 28/28 for a harness that had grown to 42, and the paragraph above
exists because of it. It records the **development** server, because that is what
was exercised: a successful `build:prod` is not a browser run and the two are
reported separately. And it names the backend SHA, because half of what these
checks assert is the server's projection.

**Re-running needs a fresh database or a freed table.** The run leaves a real
accepted order occupying table 1, and the next run's `initiate` is refused with
the ongoing-order block — which is correct behaviour, not a flake. **The seed is
IDEMPOTENT and reuses an existing restaurant**, so re-seeding does NOT free the
table; drop and recreate the database. That is not a hypothetical — it cost a
confusing half-hour during D04, where the symptom was a disabled Checkout button
and two unrelated-looking failures (`Add — UGX 35,000.3`, and a reprice returning
400) that were really one earlier run's leftovers. `recovery.mjs` frees the table
BETWEEN its own scenarios through the real kitchen API, but it still needs a clean
database to start from.

## Two things it found that the unit suites did not — and one it was not doing

1. **The initiate response never forwarded the `quote`.** The serializer built
   it and the response assembler dropped it, so every unit test passed while the
   review screen had nothing to render but the browser's own arithmetic — the
   exact defect the review exists to close. Now pinned by
   `orders_app/tests_order_quote.py`.
2. **The error interceptor flattened every failure to a string**, so the
   machine-readable `reason` on an acceptance refusal never reached the basket
   and the legacy-draft and stale-quote recoveries could not fire. Now pinned by
   `src/app/_helpers/error.interceptor.spec.ts`.

The third is not a finding but a gap in this file itself, recorded because it is
the reason the run was extended: **the positive path had never been clicked.**
Until this revision the journey submitted by `fetch`, so it proved the SERVER
accepts a quote and nothing at all about the button the diner uses, the payload
it builds, the navigation it triggers, or the basket clearing that must follow
only a definitive success. A journey that never presses the button is a server
test wearing a browser.

---

# `recovery.mjs` — INDUCED LOSS (D04)

The sibling script, and it tests what `journey.mjs` deliberately cannot: what
happens when the checkout does **not** go cleanly. Three scenarios, each of
which reproduced a real defect before D04.

**The seam is `route.fetch()` then `route.abort()`**, and the distinction is the
whole point: the backend really processes the request, and only the browser's
view of the reply is destroyed. Aborting *before* the fetch would test nothing,
because the server would never have seen it.

| scenario | what it proves |
|---|---|
| **1. the diner reloads mid-checkout** | the SAME idempotency key is sent afterwards, the server answers with the SAME draft, and exactly ONE order reaches the kitchen. The key used to live in an in-memory field on `BasketService`, so the reload dropped it and the next attempt minted a new one — the server's whole guarantee bypassed by the single most likely thing a person does when a checkout looks stuck. It **edits the basket on the page before checking out**, which is what makes the scenario able to fail at all — see *What this script found* |
| **2. the acceptance commits and the reply is lost** | the retry produces NO second accepted order, and the diner is **not** told `This order cannot be submitted.` — a failure reported for an operation that succeeded, with the kitchen already cooking it |
| **3. the tab is reloaded after a lost acceptance** | the key is in durable storage at the moment the connection dies; the reloaded page resolves it, **tells the diner the order was already placed**, clears the finished basket and forgets the attempt. The direct reads beside it pin the server half: an unknown key and a malformed one are the same non-disclosing 404, and the recovery read still requires a diner session |

### What this script found

**Scenario 1 could not fail, and that was the more serious finding.** It reached
the basket with `page.goto` and clicked Checkout immediately, so the key was
minted at `BasketService.revision() === 0` both before the reload and after it —
and a key scoped to the REVISION rather than to the basket's CONTENTS therefore
produced two identical keys and a green run against the exact defect the
scenario exists to catch (Codex P1 on PR #663). It now clicks the quantity
stepper once before checking out, which is what a diner does anyway and is the
only version of the scenario that discriminates: the counter is 1 before the
reload and 0 after it, while the contents come back identical. With the
revision-scoped key restored in the served app the run is **20/22**, and the two
failures show the real consequence — two DIFFERENT drafts for one checkout.

**An accepted recovery cleared the basket, which hid the notice.** The message
first lived in the checkout footer, which is inside `@if (basketItems.length >
0)` — so the one outcome a diner most needs to hear was the one that hid it: the
tab reloaded, the basket silently emptied, and they were told nothing. No unit
spec could see it, because the existing component spec never calls
`detectChanges()` and so never runs `ngOnInit`. It is now pinned by
`basket-body.recovery.spec.ts` (*"SHOWS the accepted notice even though the
basket is now empty"*) as well as by scenario 3 here.

### What it deliberately does NOT cover

- **A lost response on `initiate` rather than `submit`.** The recovery is the
  same shape (the same key retries), and scenario 1 already exercises it through
  the more demanding route — a reload, which destroys strictly more than a lost
  reply does.
- **Two tabs racing.** The coordinator's single flight is per-tab by design
  (`sessionStorage`), and the cross-tab case is the SERVER's guarantee, proved
  against real connections in
  `orders_app/tests_order_intent_concurrency.py`.
- **Anything about payment.** As with the journey: there is no payment execution
  in either repository.


## D06 — the world changes while the review sheet is open

`recovery.mjs` carries two more scenarios, and they are here rather than in a
unit spec because each one needs a REAL operator write landing between the
diner pricing an order and confirming it, and then the real server deciding.

**D06a — the restaurant pauses.** The owner's own settings PUT sets
`accepting_orders=false` while the sheet is up. The acceptance is refused,
nothing reaches the kitchen, and — the assertion that matters — **the diner's
checkout attempt SURVIVES**: a pause is TRANSIENT, so re-pricing there would
discard a perfectly good quote and ask the diner to agree to the same amount
again while the kitchen is closed. The owner resumes, the diner taps again, the
SAME idempotency key goes out, and exactly one order lands.

**D06b — the dish sells out.** The kitchen's own "86" panel takes the burger
off while the sheet is up. The acceptance is refused and the client re-prices
rather than offering a Retry that could never succeed. Then the dish comes
BACK, and the old quote stays dead — which is the whole reason the refusal is
recorded rather than merely returned: stock is not monotone, and without the
durable closure a queued acceptance for the old quote would execute the moment
the dish returned.

**NOT RUN AS PART OF ANY GATE**, like everything else in this directory: it
needs a disposable PostgreSQL, a running Django and a running dev server. Run
it the same way, against a FRESH database.

**These two scenarios have NOT been executed** — they were written alongside the
D06 change and are recorded here as a repeatable check, not as evidence. The
unit and integration suites that DID run are `orders_app/tests_quote_lifetime.py`
(64 tests, each guard mutation-proved), `restaurants_app/tests_admission_writers.py`
(9 tests, both writer fixes mutation-proved) and the frontend's
`_shared/order/quote-transition.spec.ts` plus
`basket-body.quote-lifetime.spec.ts`.
