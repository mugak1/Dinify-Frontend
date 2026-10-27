# Served journeys: the accepted browser journeys against the stack that serves

The five browser journeys in `e2e/` are accepted evidence: `checkout-journey/journey.mjs` (43 checks), `recovery.mjs` (154), `equivalence.mjs` (21), `kitchen-board/kitchen.mjs` (55) and `billing-journey/billing.mjs` (56). Until now they ran only against a disposable PostgreSQL, a local Django and a development `ng serve`, on a fixture `seed.py` wrote through the Django shell. Their own READMEs say why that is not proof about what serves.

This directory runs the **same scripts, with every assertion unchanged**, against the stack that actually serves:

- the Firebase site **dinify-prod** (`https://dinify-prod.web.app`), published by `deploy-prod.yml` from `ng build --configuration=uat`;
- the UAT backend that build calls, `https://api-test.dinifyapp.com/uat`, which runs 11:00–23:00 Europe/London.

It works on **one dedicated test restaurant** and reaches it only through the real HTTP API. Nothing here touches a database, a shell or a management command.

The workflow `.github/workflows/uat-journeys.yml` runs it. The owner dispatches it on main; nothing triggers on it, and it deploys and gates nothing.

| file | what it does |
|---|---|
| `run.mjs` | The orchestrator. Records what serves and refuses a bundle that calls another API. Signs the operator in once, provisions, runs the probes, then runs each journey after a verified reset. Writes the evidence file. `run.mjs health-gate` is the workflow's first job. |
| `provision.mjs` | Builds the fixture the journeys read through the operator API, behind the interlock. It is idempotent: a second run creates nothing. `resetBetweenJourneys` puts the canonical state back, closes out the board through the kitchen's own commands, and reads the result back. |
| `probes.mjs` | The served regression probes for **D01** and **D07**, the two findings no journey replays. |
| `redact.mjs` | Redaction, plus the scan the workflow runs before uploading anything. |
| `lib.mjs` | Shared pieces: the interlock, masking, the canonical catalogue and the declared skips. `journeyTarget` is the one adapter each journey calls. |
| `tests/` | `served.test.mjs` (the harness, offline) and `workflow.test.mjs` (pins the workflow). Run with `node --test "e2e/served/tests/*.test.mjs"`. |

## What this evidence is, and is not

It is **legacy-grade serving evidence**. The run records, from public endpoints:

- the head SHAs of the latest successful `deploy-prod.yml` (Frontend) and `deploy-uat.yml` (Backend) runs;
- the backend's `/uat/api/v1/release/` and `/uat/api/v1/health/` answers;
- Admin's `/release.txt`;
- the served bundle's main script filename.

It is **not** the D08 B3 process-bound identity. That does not exist on the legacy deploy: the backend answers `state: unavailable, reason: not_started_by_release_launcher`.

## The owner's one-time setup

Only the owner does these.

1. **Create the test restaurant** on UAT and make sure the server reports `is_test: true`. Note its **id** and its **exact name**. **The restaurant must be `live`; see "An Admin-created restaurant cannot be used yet" below.**
2. **Give it a dedicated owner account** that nobody else uses. Give it a password, and clear any first-sign-in password prompt. The run refuses an account with `prompt_password_change` set, because it never changes a password. The username is the account's phone number in canonical form, `256XXXXXXXXX`. Do not use a staff account, or an account that owns a real restaurant. The account signs in with the development OTP `1234`, which works only while the UAT backend runs `ENV=dev`.
3. **Set two repository secrets** under Settings → Secrets and variables → Actions:
   - `UAT_JOURNEY_OPERATOR_USERNAME`: that phone number;
   - `UAT_JOURNEY_OPERATOR_PASSWORD`: its password.
4. **Set two repository variables:**
   - `UAT_JOURNEY_RESTAURANT_ID`: the restaurant's id, as a lowercase UUID;
   - `UAT_JOURNEY_RESTAURANT_NAME`: its exact name, compared character for character.
5. **Dispatch "UAT journeys" on `main`**, inside 11:00–23:00 London. A full local run took about 4 minutes (measured). Against UAT, expect roughly 10–20 minutes (inferred: the fixed pauses are doubled, and every request crosses the network). The job's timeout is 90 minutes.
6. **Review the run.** Download its single artifact, `uat-journeys-evidence-<run>-<attempt>`, and read `outcome` and `problems` first. The independent reviewer reviews the first dispatched run before any schedule is added.

### An Admin-created restaurant cannot be used yet

An Admin-created restaurant (`POST admin/v1/restaurants/`, `is_test` required) starts in the lifecycle state `onboarding`. Diners cannot order there: the order path answers "not open yet", and the menu renders read-only. Moving it to `live` is refused while `check_go_live_readiness` fails closed with `readiness_not_configured`, and the backend deliberately offers no override.

The checkout, recovery, equivalence and kitchen journeys need a diner to place real orders. So `provision.mjs` refuses such a restaurant with `not_live` before it writes anything, and says why.

Until that changes, the restaurant must be one that is already `live` and is classified `is_test`, for example a dedicated non-customer restaurant classified with the backend's audited `manage.py mark_restaurant_test`. That is an owner decision, and an owner action on the host.

### Why the test-restaurant flag matters

Every order a test restaurant takes is flagged `is_test` at admission, by the server. Dinify's own portfolio and financial figures are meant to leave it out.

The restaurant's own reports and dashboards still count those orders. That is deliberate (backend `TEST-RESTAURANT-PARITY-00`), because a test restaurant exists to prove that everything a live one does works.

## The interlock

`provision.mjs`, the probes and every journey refuse to act unless all three of these hold:

- the restaurant's **id** equals `JOURNEY_RESTAURANT_ID`;
- its **name** equals `JOURNEY_RESTAURANT_NAME`;
- the server reports **`is_test === true`**.

The three facts are read from `GET /api/v1/restaurant-setup/details/?record=restaurants&id=<id>`. That is the owner's settings read of the canonical row (`SerializerGetRestaurantDetail`, all fields), and it exposes `is_test`. A soft-deleted restaurant, a 404 and a string `"true"` are all refusals.

Each journey runs the same check itself, through `journeyTarget(F).guard()`, before it reads or writes anything else. A journey pointed at a non-local API without a fixture written by this provisioner refuses outright. A served fixture that names another restaurant also refuses outright.

On top of the interlock, provisioning requires two more facts:

- the restaurant is `live`;
- the operator holds an owner or manager membership of it.

## The runs never depend on each other

- **The catalogue is reset and verified.** Every catalogue change a journey makes is restored in that journey's own `finally` block (`restoreCanonical`), even when the journey fails. Before each journey, and once more after the last, the orchestrator writes the canonical state again and **reads it back**:
  - the three dishes: price, options, extras, discount, stock and availability;
  - trading switched on;
  - an empty kitchen board.

  It refuses to continue if any of it disagrees.
- **The board is closed out.** Any submitted order still on the Active board is advanced, then served, through the kitchen's own commands with their `if_revision` preconditions. A served order leaves the board.
- **Each kitchen run gets its own table.** The checkout journeys order at table **901** ("E2E checkout"). The kitchen journey takes the first of seven tables, **911–917** ("E2E kitchen 1…7"), with no ticket on either the Active or the Completed board. Its ticket assertions are narrowed to that table's label. That keeps an earlier run's ticket from satisfying them, even when the Completed feed's 24-hour window still shows it, or a new EAT day restarts the daily ticket numbers. If all seven tables have a ticket inside the window, the run refuses (`kitchen_pool_exhausted`) rather than share one.
- **Every created object is found by name or number first.** Ambiguity is refused, never resolved by picking one.

### Growth is bounded

Measured locally on two consecutive runs.

- **Catalogue, dining area and tables:** a fixed set of one section ("Mains"), three dishes ("Signature Burger", its "Extra Cheese" extra and "Rounding Test"), one dining area ("E2E Journeys") and eight tables. It is created once and reused. The second run created nothing.
- **Orders:** each full run adds **27 orders** (measured on two runs: 11 drafts, 14 served, 2 cancelled), all on the test restaurant and all flagged `is_test`. One of the drafts is the D01 probe's positive control. No API deletes an order, so they accumulate linearly in the number of runs. Every run ends with an empty Active board, and the Completed feed shows only 24 hours.
- **Kitchen tables:** a kitchen run needs a pool table with no ticket on either board. Each run leaves tickets on the Completed board for 24 hours, so the pool of seven allows **seven runs in any 24 hours**. In an eighth, the orchestrator stops at the kitchen journey with `kitchen_pool_exhausted`, before that journey writes anything, and the run fails; it never shares a table.
- **OTP:** one issuance per run (measured in the backend's `otp_issuances` table). D11's coming enforcement (3 per account per 15 minutes, 10 per day) therefore allows up to 3 runs per 15 minutes and 10 per day; the kitchen pool's seven per 24 hours binds first.

## Secrets stay secret

Both repositories are public, so an Actions log is public.

- The password and username come only from the two Actions secrets. The runner masks them, and `run.mjs` masks them again with `::add-mask::` before anything else runs.
- Every value minted at run time is announced with `::add-mask::` the moment it exists: the access and refresh tokens, each QR credential and each diner table session. A journey announces the sessions it mints itself. The orchestrator intercepts those lines, and every line a journey prints is redacted before it is echoed.
- Each journey's fixture file is written with mode 600 under `$RUNNER_TEMP`, deleted when that journey ends, and the directory is deleted again by the workflow's last step.
- **One file is uploaded:** the redacted evidence JSON, and only after `redact.mjs scan` finds nothing token-shaped in it. The scan looks for JWTs, Django-signed values, `Bearer`, the `X-Diner-*` headers, `?c=` parameters, secret-named JSON fields, Ugandan MSISDNs and the exact operator credentials. A finding fails closed: the step goes red and nothing is uploaded.
- No Playwright trace, HAR, video or screenshot is recorded or uploaded. `tests/` pins that for the workflow and for every script.

## Per journey: what a served run breaks, and what was done

| journey | what a served run breaks | what was done |
|---|---|---|
| all | the fixture came from `seed.py` through the Django shell | `provision.mjs` builds it through the operator API, behind the interlock |
| all | each journey signed in itself: up to five OTP issuances per run | one sign-in per run in `run.mjs`. Each journey is handed a refreshed access token. Browser sessions get no refresh token, so one rotation cannot invalidate another. |
| all | fixed `waitForTimeout` pauses tuned for a local stack | `T.pace(ms)` multiplies them by `JOURNEY_WAIT_SCALE` (2 in the workflow). It never shortens one, so a negative check gets stricter and a positive one more patient. |
| all | `CHROMIUM_PATH` defaulted to a sandbox path | the orchestrator passes Playwright 1.56.1's own Chromium |
| `journey.mjs` | its "operator can sign in" check is about its own login | **skipped by name**; the sign-in is the orchestrator's own check |
| `journey.mjs` | it reprices the burger mid-run; a second pass on the same data failed two checks | `restoreCanonical` in `finally`, plus the verified reset |
| `equivalence.mjs` | same sign-in check; it relabels a choice and moves two prices | **skipped by name**; restored in `finally`, as each scenario already did |
| `recovery.mjs` | it mints diner sessions; it pauses trading and sells a dish out mid-run | each session is masked the moment it exists; trading and stock are restored in `finally`; no skips |
| `kitchen.mjs` | "RUN IT ON A FRESH FIXTURE": daily ticket numbers and the 24h Completed feed; it picked `restaurant_roles[0]` | its own table from the pool, ticket locators narrowed by table label, the board closed out first, the membership selected by restaurant id; sign-in check **skipped by name** |
| `billing.mjs` | it flips `DashboardService.USE_MOCK_DATA` through Angular's dev-mode `window.ng`, which an optimized build does not expose (measured: `typeof window.ng === "undefined"`) | 12 checks **skipped by name** |
| `billing.mjs` | sections 2–4 need a second and a third restaurant: legacy billable columns no API writes, and canonical subscription terms written only on the Admin plane | 29 checks **skipped by name**. The server half of D07 is replayed on the wire by the `D07:` probe. |

Every skip is declared, with its reason, in `lib.mjs → SERVED_SKIPS`. A journey can skip only a declared label; anything else throws. The orchestrator fails a run whose skips differ from the declaration in either direction, or whose `pass + fail + skip` differs from the accepted count. A skip is never a pass.

## The probes write nothing but one draft

- **D01**: `POST /api/v2/orders/initiate/` through the diner capability channel, with quantity `0`, `-3`, `2.5`, `true` and `"3"`, and with a non-object body. Each must answer exactly 400. A bad quantity must name `items.0.quantity` with the backend's quantity sentence; the non-object body must carry the two-key invalid-request envelope. For each, `order-details/?intent=` must read back 404. A **positive control** first creates one valid draft and proves the same read-back finds it. That is the one write, a draft that never occupies a table or reaches the kitchen.
- **D07**: the retired subscription collector's own request must answer exactly **501**, with `reason: subscription_collection_unavailable` and the request-specific sentence. A missing and a foreign restaurant must answer 404 at the gate, so the 501 is not an endpoint that refuses everything. The restaurant's transaction listing, unfiltered by type or status, must hold the same number of rows before and after. That witness has no positive control, because no API creates a transaction row; that is the finding.

## The evidence file

`dinify.frontend.served-journeys/1`, written redacted with mode 600:

- `grade`: the legacy-grade statement above;
- `target`;
- `tooling`: Node, Playwright and the Chromium version;
- `serving`: the deploy runs, the release and health answers, Admin's `release.txt`, the bundle's main script and its API origins;
- `otp`: logins, issuances and refreshes;
- `orchestrator` and `probes`: each check;
- `provision`: what was created or closed out;
- `growth`;
- `journeys`: each one's pass, fail and skip counts against its accepted count, every check by name, and every skip with its reason;
- `outcome` and `problems`.

Not in the file: tokens, credentials, QR credentials, sessions and order contents.

## The workflow

There are two jobs.

**`health`** holds no secret. It asks `GET /uat/api/v1/health/` and reads the body, because that route answers 200 with `status: degraded` when the database is down.

- Healthy: the journeys run.
- Unreachable outside 11:00–23:00 London: the instance is stopped by design. The job succeeds with a NOT RUN summary, and **the `journeys` job is skipped**. Actions has no neutral conclusion, and a skipped job is the nearest one.
- Unreachable inside the window: red.

**`journeys`** runs these steps in order:

1. refuse any ref but main;
2. the offline self-test;
3. install `playwright@1.56.1` with `--no-save` into `e2e/` only, then its Chromium only. `package.json` and the lockfile stay unchanged, and the step asserts it.
4. the run;
5. the redaction scan;
6. the upload of the one evidence file;
7. deletion of the fixture and evidence files.

Permissions are `contents: read` and nothing else. Every action is pinned by SHA.

## A local rehearsal

The same run works against a local stack. This is how this directory was verified.

1. A disposable PostgreSQL.
2. Backend `main` under `ENV=dev`.
3. An optimized `ng build --configuration=uat`, with its one `apiUrl` literal pointed at the local backend, served statically with `firebase.json`'s SPA rewrite.
4. A live, `is_test` restaurant and its owner, created by hand in that throwaway database. That stands in for the owner's step 1; no provisioning step uses the shell.

```bash
JOURNEY_WEB=http://127.0.0.1:4299 JOURNEY_API=http://127.0.0.1:8099 \
JOURNEY_RESTAURANT_ID=<uuid> JOURNEY_RESTAURANT_NAME='<name>' \
JOURNEY_OPERATOR_USERNAME=<256…> JOURNEY_OPERATOR_PASSWORD=<pw> \
JOURNEY_EVIDENCE=/tmp/served-evidence.json \
node e2e/served/run.mjs
node e2e/served/redact.mjs scan /tmp/served-evidence.json
```

A seeded local run of any single journey, with no `JOURNEY_RESTAURANT_*` set, behaves exactly as before. `journeyTarget` changes nothing there.
