# Checkout journey (D02/D03)

A minimal, repeatable **real-browser** check of the one thing no unit suite can
observe: that the diner is shown the **server's** amount before agreeing to it,
that the amount they agreed to is the one saved, and that an acknowledgement the
server does not recognise is refused rather than quietly accepted.

It is deliberately NOT wired into CI. It needs a disposable PostgreSQL, a running
Django and a running dev server, and CI has none of those. It is a **pre-merge
gate for changes to the checkout pricing or confirmation path**, run by hand.

## What it asserts

| | |
|---|---|
| a QR scan reaches the menu | the capability channel is intact end to end |
| a paid modifier and an extra can be configured | the selection UI drives the real payload |
| the add button shows the configured line total | **extras scale with the parent quantity** (the D02 defect) |
| the basket holds ONE line | **one configuration is one line** (the D03 defect) |
| the review sheet appears BEFORE anything is submitted | correct calculation is not agreement to an amount |
| the reviewed amount IS the server amount | read from the very response the page rendered |
| the quote carries each extra beneath its parent line | `line_total_with_extras`, not a flattened sum |
| the saved draft is CORRECTED-priced and named | `pricing_version` + `quote_ref` |
| an unrecognised `quote_ref` is refused | `quote_ref_stale` |
| an ABSENT `quote_ref` is refused | `quote_ref_required` — never treated as agreement |
| the reviewed quote is accepted | the round trip completes |

Run it TWICE — once as-is, then again after changing the dish price — to prove
the review shows the CURRENT server price rather than anything the browser
cached. The expected line total is the script's first argument.

## Running it

```bash
# 1. A disposable PostgreSQL, and a database for the journey.
#    (Never point this at UAT or production.)
export DATABASE_ENGINE=django.db.backends.postgresql
export DATABASE_NAME=dinify_journey DATABASE_USER=... DATABASE_HOST=... DATABASE_PORT=...

# 2. Seed ONE restaurant with a modifier + extras dish. Prints the fixture the
#    browser script reads, including the table's QR credential.
cd ../Dinify-Backend
python manage.py migrate --settings=dinify_backend.test_settings
python manage.py shell --settings=dinify_backend.test_settings \
  < ../Dinify-Frontend/e2e/checkout-journey/seed.py | tail -1 > /tmp/journey-fixture.json

# 3. The API.
python manage.py runserver 127.0.0.1:8099 --settings=dinify_backend.test_settings --noreload &

# 4. The app, pointed at it. Temporarily set environment.ts's apiUrl to
#    http://127.0.0.1:8099 — do NOT commit that change.
cd ../Dinify-Frontend
npx ng serve --port 4299 --host 127.0.0.1 --configuration development &

# 5. The journey. 31000 is the expected line total for the seeded fixture.
node e2e/checkout-journey/journey.mjs 31000

# 6. The price-change pass: raise the dish price, free the table (the first
#    order now occupies it), and re-run with the new expected total.
```

`JOURNEY_WEB`, `JOURNEY_API`, `JOURNEY_FIXTURE` and `CHROMIUM_PATH` override the
defaults. Exit status is non-zero if any check fails.

## Two things it found that the unit suites did not

1. **The initiate response never forwarded the `quote`.** The serializer built
   it and the response assembler dropped it, so every unit test passed while the
   review screen had nothing to render but the browser's own arithmetic — the
   exact defect the review exists to close. Now pinned by
   `orders_app/tests_order_quote.py`.
2. **The error interceptor flattened every failure to a string**, so the
   machine-readable `reason` on an acceptance refusal never reached the basket
   and the legacy-draft and stale-quote recoveries could not fire. Now pinned by
   `src/app/_helpers/error.interceptor.spec.ts`.
