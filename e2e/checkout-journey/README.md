# Checkout journey (D02/D03)

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

Last run: **28/28 checks passed** against a disposable local PostgreSQL, a local
Django on `test_settings`, and a development `ng serve`.

**Re-running needs a fresh database or a freed table.** The run leaves a real
accepted order occupying table 1, and the next run's `initiate` is refused with
the ongoing-order block — which is correct behaviour, not a flake.

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
