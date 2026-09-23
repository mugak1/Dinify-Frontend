# Billing reads and the refused collector (D07 G1/G2)

A **manual, repeatable real-browser** check of the two things no unit suite can
observe: that an operator who signs in and opens the screens actually sees the
withheld figures and the stated answers, and that the collector the retired
billing dialog drove is **refused by a live server** rather than merely absent
from the new client.

It is deliberately **NOT wired into CI** and prints that at the end of every
run. It needs a disposable PostgreSQL, a running Django and a running dev
server, and CI has none of those.

`billing.mjs` — **56 checks**, five sections.

## What it asserts

| | |
|---|---|
| **the dashboard withholds every unvouched figure** | headline, chart, comparison and the Gross/Discounts/Net pills — **against a REAL `dashboard-v2` response, selected by a test-only runtime flip**, with the mock branch kept beside it as the control that proves it could not have supplied the evidence |
| **Refunds survives** | it aggregates `order_status`, which is written; blanking it would hide a real measurement |
| **Paid and Open/Unpaid are withheld on Total Orders** | and the card is not hidden — total, Cancelled and Refunded are independent measurements |
| **the Tables card is wired at all** | four of its five history tiles are paid-gated and it was the one card the dashboard template never bound |
| **occupancy is NOT withheld** | live floor state, and the one Tables figure that is not a paid aggregate |
| a genuinely unconfigured restaurant says so | "No **current** subscription terms are recorded", and never "yet"/"never"/"ever" |
| ...and invents no price, plan, trial or tier | asserted on the rendered text, not on a getter |
| **a LEGACY BILLABLE row decides nothing** | `subscription_validity=True` + a future expiry + a `flat_fee` are proved present ON THE WIRE, and the screen still says no current terms, shows no "Active" and renders no billing date |
| canonical recorded terms render with their scale | `UGX 150,000.50` — a non-zero fraction, because a round number cannot show that the decimal survived |
| the history row shows the amount the serializer emits | not the `UGX 0` the retired `amount_out` read produced |
| **the retired collector is REFUSED 501 by the live server** | the exact status, the exact machine reason and the exact sentence, **read off the wire before any interceptor**, with a 404 control that keeps it from being "the endpoint always says no" |
| **no financial row is created by any attempt** | asserted from the restaurant's own authorized listing, before and after |
| **the refusal reaches the operator** | and carries the SERVER's own sentence, not a generic one |
| **the old OTP-before-POST ordering is demonstrated** | with the challenge **intercepted by the harness** — no code is dispatched and no delivery is attempted |
| **the retired payment deep links resolve to no payment surface** | three URLs entered directly in the address bar |
| the page raised no uncaught errors | |

### The 501 is issued through the app AND observed on the wire

`page.evaluate` reaches the live `BillingComponent` through Angular's dev-mode
`window.ng` handle and reads its injected `ApiService` — TypeScript `private`
is erased at runtime, so the service is a plain property. That is what puts the
request through the real interceptor chain. **A `fetch` would prove what the
server answers and nothing about what the client does with it.**

**BUT THE CLIENT CANNOT SEE A STATUS, AND THAT WAS THE HOLE.** `ErrorInterceptor`
flattens an ordinary failure to `err.error?.message || err.statusText` — a
STRING — so `outcome === 'refused'`, which this harness used to assert, is
satisfied equally by 501, 404, 403, 401 and 500. It was passing on a **404**:
the probe sent `restaurant`, the endpoint reads `restaurant_id`, and
`can_manage_restaurant` fails closed on a missing one, so the request was
refused by the AUTHORIZATION GATE and never reached the collector at all.

Two things fix it, and both are in the committed script:

- **THE RETIRED REQUEST IS THE REAL ONE**, recovered verbatim from the commit
  before D07 removed it (`InitPayment()` + `Save()` at `1d3d091^`):
  `{transaction_type, transaction_platform, payment_mode, restaurant_id,
  msisdn, otp}`. **The endpoint was NOT relaxed to accept the wrong key** —
  that would be rescuing the harness by weakening the contract.
- **A SECOND, INDEPENDENT OBSERVER.** `page.on('response')` reads the status
  and raw body of the SAME real response before any interceptor touches it, and
  the assertions name an exact `501`, the exact machine reason
  `subscription_collection_unavailable` and the exact sentence. A 400, 401,
  403, 404, an arbitrary non-2xx, or a request that never answers each FAIL.

```
{"status": 501,
 "reason": "subscription_collection_unavailable",
 "message": "In-app subscription payment collection is not available. This request did not create or send a payment request."}
```

**THE 404 CONTROL IS WHAT KEEPS THAT HONEST.** The same retired shape is issued
twice more — once with no `restaurant_id`, once with a foreign one — and both
must answer **404**. Without it, a harness that drifted back to the wrong key
would score a passing "refusal" forever.

**AND THE ROW COUNT IS NOW AN ASSERTION, NOT AN OBSERVATION.** This document
used to record `rows before/after: 1 1` from a manual look. The harness reads
the restaurant's own authorized `transactions-listing` before the probe and
again after all three attempts, and fails if the count moved.

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

- **It does not exercise a real pre-D07 client, and section 4 is not an
  old-bundle pairing.** Sections 3 and 4 replay the two retired REQUESTS,
  recovered verbatim and re-issued in their original order **from the current
  build**. That shows the SERVER refuses the collection and that the CURRENT
  interceptor chain surfaces the refusal. The retired dialog, its MSISDN
  lookup and its form state are deleted and nothing here runs them; whether the
  deployed older bundle renders that refusal well is not asserted and is not
  claimed.
- **The dashboard section proves the REAL branch only because it selects it.**
  `DashboardService.USE_MOCK_DATA` is still `true` in the committed build. The
  mock declares a MEASURING server (`MOCK_PAYMENT_TRACKING_ENABLED`), so the
  mock phase renders every dummy figure and NO withheld hook, and the control
  asserts exactly that. The harness flips the static at runtime through
  `window.ng`, undoes it before the section ends, and keeps the mock phase as
  an explicit control. **No production flag
  is changed, no test endpoint is added and no build configuration is
  introduced.**
- **It asserts nothing about production or UAT data.** Everything here is a
  disposable local database seeded by `seed.py`.
- **It contacts no payment provider**, and there is none to contact.

## It discriminates, and that was measured

Three measurements, each taken by reverting one thing and holding everything
else constant.

**THE WRONG REQUEST KEY — 51/56.** Sending `restaurant` instead of
`restaurant_id`, which is what the committed harness used to do, fails **five**
checks and every one of them prints `404`:

```
FAIL THE SERVER ANSWERED 501 — observed on the wire, before any interceptor — observed=[404]
FAIL ...carrying the machine reason a client branches on — {"status":404,"message":"Not found"}
FAIL ...and the sentence that is about THIS REQUEST and nothing else — "Not found"
FAIL the ErrorInterceptor surfaces the SERVER’s own sentence, not a generic one — "Not found"
FAIL the collection attempt is refused 501 ON THE WIRE ... {"status":404, ...}
```

**`the client reports it as a refusal rather than a success` STILL PASSES** in
that run. That is the old assertion, and it is the proof that it never
discriminated.

**THE MOCK DASHBOARD BRANCH — 54/56.** Neutralising the runtime flip so the
section stays on mock data fails exactly the two real-data checks:

```
FAIL an AUTHORIZED dashboard-v2 request really reached the server — []
FAIL the SERVER declares that settlement is not measured — undefined
```

That figure was measured when the mock declared `false` and rendered the same
withheld hooks the real server does, which is why their presence alone was not
evidence then. The mock now declares a measuring server and renders none, so
the phase-A control asserts their ABSENCE. Neutralising the flip should
therefore also fail every withheld-hook check in phase B. That is REASONED and
has not been re-measured, and this document does not restate 54/56 as current.

**THE G1/G2 PRODUCTION REVERT — 28/42, AND THAT FIGURE IS NOT RESTATED HERE.**
It was measured against the **42-check** harness at the revision that
introduced it (eleven production files stashed: the cards, the adapter, the
model, the mock, the dashboard template and the billing
component/model/template). Eight of the fourteen failures were behavioural and
six were selector-dependent, both recorded at the time. It has **not** been
re-measured against the 56-check harness, and this document does not claim it
has: the two measurements above are the ones this revision is responsible for.

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
#    manifests and point at a browser you already have.
#    PIN THE VERSION: `npm i --no-save playwright` resolves to whatever is
#    latest that day, which is not a repeatable run.
#        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i --no-save playwright@1.56.1
#        export CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
node e2e/billing-journey/billing.mjs
```

`BILLING_WEB`, `BILLING_API`, `BILLING_FIXTURE` and `CHROMIUM_PATH` override the
defaults. Exit status is non-zero if any check fails.

**Re-seed before each run.** The journey writes nothing, so contamination is
milder here than in `checkout-journey`, but the seed is idempotent and costs
nothing.

Last run: **56/56**, on a FRESH disposable database, with **51/56** under the
wrong-request-key mutation and **54/56** under the mock-dashboard mutation (see
the measurements above).

Node 24.15.0 (`/opt/node24`), **Playwright 1.56.1** (`npm i --no-save
playwright@1.56.1` — a PIN, and the product manifests are unchanged, verified
with `git status` on `package.json` and `package-lock.json`), Chromium
pre-installed at `/opt/pw-browsers/chromium-1194`
(`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, so nothing was fetched), PostgreSQL 16 on
a disposable cluster, and **development** assets (`ng serve --configuration
development`, not an optimized build). `src/environments/environment.ts` was
pointed at `http://127.0.0.1:8099` for the run and **that change is not
committed**.
