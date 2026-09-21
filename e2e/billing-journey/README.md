# Billing reads and the refused collector (D07 G1/G2)

A **manual, repeatable real-browser** check of the two things no unit suite can
observe: that an operator who signs in and opens the screens actually sees the
withheld figures and the stated answers, and that the collector the retired
billing dialog drove is **refused by a live server** rather than merely absent
from the new client.

It is deliberately **NOT wired into CI** and prints that at the end of every
run. It needs a disposable PostgreSQL, a running Django and a running dev
server, and CI has none of those.

`billing.mjs` — **42 checks**, five sections.

## What it asserts

| | |
|---|---|
| **the dashboard withholds every unvouched figure** | headline, chart, comparison and the Gross/Discounts/Net pills, in a real session against a real `dashboard-v2` |
| **Refunds survives** | it aggregates `order_status`, which is written; blanking it would hide a real measurement |
| **Paid and Open/Unpaid are withheld on Total Orders** | and the card is not hidden — total, Cancelled and Refunded are independent measurements |
| **the Tables card is wired at all** | four of its five history tiles are paid-gated and it was the one card the dashboard template never bound |
| **occupancy is NOT withheld** | live floor state, and the one Tables figure that is not a paid aggregate |
| a genuinely unconfigured restaurant says so | "No **current** subscription terms are recorded", and never "yet"/"never"/"ever" |
| ...and invents no price, plan, trial or tier | asserted on the rendered text, not on a getter |
| **a LEGACY BILLABLE row decides nothing** | `subscription_validity=True` + a future expiry + a `flat_fee` are proved present ON THE WIRE, and the screen still says no current terms, shows no "Active" and renders no billing date |
| canonical recorded terms render with their scale | `UGX 150,000.50` — a non-zero fraction, because a round number cannot show that the decimal survived |
| the history row shows the amount the serializer emits | not the `UGX 0` the retired `amount_out` read produced |
| **the retired collector is REFUSED by the live server** | issued through the running app's own `ApiService`, so it passes the REAL `AuthInterceptor` and `ErrorInterceptor` |
| **the refusal reaches the operator** | rather than being swallowed |
| **the old OTP-before-POST ordering is demonstrated** | with the challenge **intercepted by the harness** — no code is dispatched and no delivery is attempted |
| **the retired payment deep links resolve to no payment surface** | three URLs entered directly in the address bar |
| the page raised no uncaught errors | |

### The 501 is issued through the app, not around it

`page.evaluate` reaches the live `BillingComponent` through Angular's dev-mode
`window.ng` handle and reads its injected `ApiService` — TypeScript `private`
is erased at runtime, so the service is a plain property. That is what puts the
request through the real interceptor chain. **A `fetch` would prove what the
server answers and nothing about what the client does with it**, which is the
half this section exists for.

The server's answer, captured verbatim from the service in the same disposable
pairing:

```
{"status": 501,
 "reason": "subscription_collection_unavailable",
 "message": "In-app subscription payment collection is not available. This request did not create or send a payment request."}
rows before/after: 1 1
```

The row count is the substantive half: the fixture's one seeded history row is
all there is, before and after — including a call supplying both `msisdn` and
`otp`, which the service accepts and deliberately does not read.

### No challenge is ever sent

`users/auth/resend-otp/` is **fulfilled by the harness** and never reaches the
server. The limitation being demonstrated is an ORDERING — the retired panel
dispatched a verification code BEFORE a POST that could not succeed — and an
ordering can be shown without dispatching anything. `ENV=dev` would also stop
the SMS at the source; that is not relied on.

### Sign-ins are budgeted, and that is not tidiness

`auth_otp` is **5/min per IP**, so a run that signs in once per section trips a
real rate limit from a single loopback address. Sections 3 and 4 share one
owner and one session, and the dashboard checks ride section 1's — three
sign-ins in total. **Raising the throttle to make a run pass would be changing
the configuration under test**, so the harness fits inside it instead.
Consequence: **two runs inside one minute will be throttled.** Wait a minute
between runs.

### What it deliberately does NOT cover

- **It does not exercise a real pre-D07 client.** Section 3 replays the retired
  request from the current build; that shows the SERVER refuses it and the
  CURRENT interceptor chain surfaces the refusal. Whether the deployed older
  bundle renders that refusal well is not asserted, and is not claimed.
- **It asserts nothing about production or UAT data.** Everything here is a
  disposable local database seeded by `seed.py`.
- **It contacts no payment provider**, and there is none to contact.

## It discriminates, and that was measured

With the eleven production files reverted (`git stash push` on the cards, the
adapter, the model, the mock, the dashboard template and the billing
component/model/template) and everything else held constant, the same run
scores **28/42**.

**Eight of the fourteen failures are behavioural** — the withheld headline, the
chart, the comparison, the pills, the orders split, the Tables wiring, the
Tables tiles, and the copy check, whose captured text is the old sentence
verbatim: *"No subscription terms have been recorded for your restaurant yet."*

**Six are selector-dependent** and are recorded as such rather than counted as
regressions: `terms-absent`, `terms-amount` and `history-empty` are
`data-testid` hooks this change introduced, so a run against code that predates
them fails for want of the hook rather than for want of the behaviour. The
behavioural twin of each is asserted separately above.

## Running it

```bash
# 1. A disposable PostgreSQL, and a database for the journey.
#    (Never point this at UAT or production.)
export DATABASE_ENGINE=django.db.backends.postgresql
export DATABASE_NAME=dinify_billing_journey DATABASE_USER=... DATABASE_HOST=... DATABASE_PORT=...
export ENV=dev DINER_CAP_KEY=<any 32+ char disposable value>

# 2. Seed three restaurants — unconfigured, legacy-billable, recorded terms.
cd ../Dinify-Backend
python manage.py migrate --settings=dinify_backend.test_settings
python manage.py shell --settings=dinify_backend.test_settings \
  < ../Dinify-Frontend/e2e/billing-journey/seed.py | tail -1 > /tmp/billing-fixture.json

# 3. The API. ENV=dev is what fixes the operator's OTP at 1234 — which is why
#    this only ever runs against a disposable local database.
python manage.py runserver 127.0.0.1:8099 --settings=dinify_backend.test_settings --noreload &

# 4. The app, pointed at it. Temporarily set environment.ts's apiUrl to
#    http://127.0.0.1:8099 — do NOT commit that change.
cd ../Dinify-Frontend
npx ng serve --port 4299 --host 127.0.0.1 --configuration development &

# 5. `playwright` is NOT a dependency of this repo (it would be a production-tree
#    dependency for a manual script), so install it without touching the
#    manifests and point at a browser you already have:
#        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i --no-save playwright
#        export CHROMIUM_PATH=/path/to/chrome
node e2e/billing-journey/billing.mjs
```

`BILLING_WEB`, `BILLING_API`, `BILLING_FIXTURE` and `CHROMIUM_PATH` override the
defaults. Exit status is non-zero if any check fails.

**Re-seed before each run.** The journey writes nothing, so contamination is
milder here than in `checkout-journey`, but the seed is idempotent and costs
nothing.

Last run: **42/42**, and **28/42 with the production change reverted**.
Node 24.15.0 (`/opt/node24`), Playwright 1.63.0 (`npm i --no-save`, product
manifests unchanged), Chromium 141.0.7390.37 (pre-installed at
`/opt/pw-browsers/chromium-1194`, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` so
nothing was fetched), PostgreSQL 16, a disposable local database, and
**development** assets (`ng serve --configuration development`, not an
optimized build).
