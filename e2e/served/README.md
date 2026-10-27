# Served journeys: the accepted browser journeys against the stack that serves

The five browser journeys in `e2e/` are accepted evidence: `checkout-journey/journey.mjs` (43 checks), `recovery.mjs` (154), `equivalence.mjs` (21), `kitchen-board/kitchen.mjs` (55) and `billing-journey/billing.mjs` (56). Until now they ran only against a disposable PostgreSQL, a local Django and a development `ng serve`, on a fixture `seed.py` wrote through the Django shell. Their own READMEs say why that is not proof about what serves.

This directory runs the **same scripts, with every assertion unchanged**, against the stack that actually serves:

- the Firebase site **dinify-prod** (`https://dinify-prod.web.app`), published by `deploy-prod.yml` from `ng build --configuration=uat`;
- the UAT backend that build calls, `https://api-test.dinifyapp.com/uat`, which runs 11:00–23:00 Europe/London. A run must end by 22:40, 20 minutes before the stop, so the last start is 21:55.

It works on **one dedicated test restaurant** and reaches it only through the real HTTP API. Nothing here touches a database, a shell or a management command.

The workflow `.github/workflows/uat-journeys.yml` runs it. The owner dispatches it on main; nothing triggers on it, and it deploys and gates nothing.

| file | what it does |
|---|---|
| `run.mjs` | The orchestrator. Records what serves, fails the run if any of it could not be read, and refuses a bundle that calls another API. Signs the operator in once, provisions, runs the probes, then runs each journey after a verified reset, inside a 30-minute budget. Resets again on every exit path. Writes the hash file and the evidence file. `run.mjs health-gate` is the workflow's first job. |
| `provision.mjs` | Builds the fixture the journeys read through the operator API, behind the interlock. It is idempotent: a second run creates nothing. `resetBetweenJourneys` puts the canonical state back, closes out the board through the kitchen's own commands, and reads the result back. |
| `probes.mjs` | The served regression probes for **D01** and **D07**, the two findings no journey replays. They run the interlock themselves first. |
| `redact.mjs` | Redaction, plus the scan the workflow runs before uploading anything. The scan checks the evidence against the hashes of every secret the run knew. |
| `lib.mjs` | Shared pieces: the interlock, masking, the canonical catalogue and the declared skips. `journeyTarget` is the one adapter each journey calls. |
| `tests/` | `served.test.mjs` (the harness, offline), `hardening.test.mjs` (the follow-ups from the review of #770, offline) and `workflow.test.mjs` (pins the workflow). Run with `node --test "e2e/served/tests/*.test.mjs"`. |

## What this evidence is, and is not

It is **legacy-grade serving evidence**. The run records, from public endpoints:

- the head SHAs of the latest successful `deploy-prod.yml` (Frontend) and `deploy-uat.yml` (Backend) runs, read from the Actions API with the job's own token (`actions: read`). Unauthenticated, a hosted runner shares 60 requests an hour with every other job on its IP address;
- the backend's `/uat/api/v1/release/` and `/uat/api/v1/health/` answers;
- Admin's `/release.txt`;
- the served bundle's main script filename.

**All six are required.** If any is missing or malformed, the run records a problem naming it and the outcome is `failed`. Missing or malformed means a deploy head that is not a 40-character SHA, a release or health answer that is not a JSON object read with a 200, a `release.txt` that is not a SHA read with a 200, or no main script. The token is sent to `api.github.com` and nowhere else, and no journey is given it. Dinify-Backend is public (`release/README.md`, measured 2026-10-27), so the job token can read its runs as an authenticated reader. That is inferred, because no run has happened yet. If it cannot, the run says so and fails.

It is **not** the D08 B3 process-bound identity. That does not exist on the legacy deploy: the backend answers `state: unavailable, reason: not_started_by_release_launcher`.

## The owner's one-time setup

Only the owner does these.

1. **Create the test restaurant** on UAT and make sure the server reports `is_test: true`. Note its **id** and its **exact name**. **The restaurant must be `live`; see "An Admin-created restaurant cannot be used yet" below.**
2. **Give it a dedicated owner account** that nobody else uses. Give it a password, and clear any first-sign-in password prompt. The run refuses an account with `prompt_password_change` set, because it never changes a password. The username is the account's phone number in canonical form, `256XXXXXXXXX`. Do not use a staff account, or an account that owns a real restaurant. The account signs in with the development OTP `1234`, which works only while the UAT backend runs `ENV=dev`.
3. **Create the environment `uat-journeys`, deployable from `main` only.** In the repository, open Settings → Environments → New environment. Name it `uat-journeys` and click **Configure environment**. Under **Deployment branches and tags**, choose **Selected branches and tags**. Click **Add deployment branch or tag rule**, keep **Ref type** as **Branch**, enter **Name pattern** `main`, and click **Add rule**. Nothing else on that page needs setting.
4. **Put the two secrets in that environment**, not at repository level. On the same page, under **Environment secrets**, click **Add environment secret** for each:
   - `UAT_JOURNEY_OPERATOR_USERNAME`: that phone number;
   - `UAT_JOURNEY_OPERATOR_PASSWORD`: its password.
5. **Put the two variables in that environment**, not at repository level. Under **Environment variables**, click **Add environment variable** for each:
   - `UAT_JOURNEY_RESTAURANT_ID`: the restaurant's id, as a lowercase UUID;
   - `UAT_JOURNEY_RESTAURANT_NAME`: its exact name, compared character for character.

   Do not also create any of the four under Settings → Secrets and variables → Actions. A repository-level secret reaches every workflow on every branch, which is the exposure the environment exists to prevent.
6. **Dispatch "UAT journeys" on `main`**, between 11:00 and 21:55 London. After 21:55 the gate answers NOT RUN, because a run is given 45 minutes and must end by 22:40, 20 minutes before UAT stops at 23:00. A dispatch on any other branch runs that branch's copy of the workflow. If the copy names the environment, GitHub refuses the job before it starts, because the environment admits `main` only. If it does not, the job gets no secret, because none exists at repository level. A full local run took about 4 minutes (measured). Against UAT, expect roughly 10–20 minutes (inferred: the fixed pauses are doubled, and every request crosses the network). The run keeps to a 30-minute budget and the job's timeout is 45 minutes. GitHub lists each run as a deployment to `uat-journeys` on the repository's Environments page, because the job names the environment. Nothing is deployed.
7. **Review the run.** Download its single artifact, `uat-journeys-evidence-<run>-<attempt>`, and read `outcome` and `problems` first, then `serving` and `final_reset`. The independent reviewer reviews the first dispatched run before any schedule is added.

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

The probes run the same check themselves before their first request, and refuse a fixture that names another restaurant. Being called after provisioning is not relied on.

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
- **The last reset happens on every exit path.** Once a fixture exists, the orchestrator resets and verifies again in a `finally` block, whatever stopped the run: a refused token refresh, a board that would not clear, a journey stopped at its time limit, or UAT stopping mid-run. It is best effort and limited to 3 minutes. If the token refresh is refused, it uses the access token in hand. The interlock runs first, so it never writes to a restaurant the interlock refuses. The result is recorded as `final_reset`: whether it was attempted, and whether it succeeded or failed, with the reason.
- **No run is started that cannot finish.** The gate refuses a start with fewer than 45 minutes left before 22:40 London, and `run.mjs` refuses a served start with fewer than 30 minutes left, the run's own budget. The second check matters because re-running only the journeys job reuses the gate's earlier verdict. Inside the run, a journey gets at most 15 minutes and no more than what is left of the 30, less 3 minutes kept for the final reset. A journey is not started with under 3 minutes left; the run then fails and records which journeys did not run.
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

- The password and username come only from the two secrets in the `uat-journeys` environment. The runner masks them, and `run.mjs` masks them again with `::add-mask::` before anything else runs, together with the job's token.
- Every value minted at run time is announced with `::add-mask::` the moment it exists: the access and refresh tokens, each QR credential and each diner table session. So are its URL-encoded forms, once and twice, because a URL inside another one (a `returnUrl`) is encoded twice. A journey announces the sessions it mints itself. The orchestrator intercepts those lines, keeping stdout and stderr in separate line buffers so a partial mask line on one stream can never be completed by the other and printed. Every line a journey prints is redacted before it is echoed.
- Each journey's fixture file is written with mode 600 under `$RUNNER_TEMP`, deleted when that journey ends, and the directory is deleted again by the workflow's last step.
- **The evidence is valid JSON by construction.** Every key and string in it is redacted before it is serialised. Text-level redaction keeps a JSON key and replaces only its value. `tests/` parses redacted evidence.
- **One file is uploaded:** the redacted evidence JSON, and only after `redact.mjs scan` passes. The scan does not trust the redaction:
  - `run.mjs` writes a **hash file** beside the evidence. It holds the SHA-256 and the length of every secret the run knew: the credentials, the job's token, every token, QR credential and table session, and their encoded forms. It never holds the values, it is never uploaded, and the last step deletes it.
  - The scan hashes every window of the evidence of one of those lengths and fails on any match. It looks in the file as written, in each JSON string unescaped, and in each of those percent-decoded once and twice. It refuses evidence that is not valid JSON. Without a readable hash file it exits 2, and nothing is uploaded.
  - It also looks for the exact operator credentials, and for anything token-shaped the run may never have learned: JWTs, including a header and payload alone; Django-signed values, with raw or percent-encoded separators and a signature of any length; `Bearer`; the `X-Diner-*` headers; `?c=`, `&c=` and `#c=`, raw or encoded once or twice; secret-named JSON fields; and Ugandan phone numbers, both canonical (`256…`) and as written (`0700…`, `0 700 …`, `256 700 …`).
  - Any finding fails closed: the step goes red and nothing is uploaded.
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
| `kitchen.mjs` | "RUN IT ON A FRESH FIXTURE": daily ticket numbers and the 24h Completed feed; it picked `restaurant_roles[0]` | its own table from the pool, ticket locators narrowed by table label, the board closed out first, the membership selected by restaurant id with **no fallback** on a served run (`T.membership` refuses, right after the interlock and before any write); sign-in check **skipped by name** |
| `billing.mjs` | it flips `DashboardService.USE_MOCK_DATA` through Angular's dev-mode `window.ng`, which an optimized build does not expose (measured: `typeof window.ng === "undefined"`) | 12 checks **skipped by name** |
| `billing.mjs` | sections 2–4 need a second and a third restaurant: legacy billable columns no API writes, and canonical subscription terms written only on the Admin plane | 29 checks **skipped by name**. The server half of D07 is replayed on the wire by the `D07:` probe. |

Every skip is declared, with its reason, in `lib.mjs → SERVED_SKIPS`. A journey can skip only a declared label; anything else throws. The orchestrator fails a run whose skips differ from the declaration in either direction, or whose `pass + fail + skip` differs from the accepted count. A skip is never a pass.

## The probes write nothing but one draft

- **D01**: `POST /api/v2/orders/initiate/` through the diner capability channel, with quantity `0`, `-3`, `2.5`, `true` and `"3"`, and with a non-object body. Each must answer exactly 400. A bad quantity must name `items.0.quantity` with the backend's quantity sentence; the non-object body must carry the two-key invalid-request envelope. For each, `order-details/?intent=` must read back 404. A **positive control** first creates one valid draft and proves the same read-back finds it. That is the one write, a draft that never occupies a table or reaches the kitchen.
- **D07**: the retired subscription collector's own request must answer exactly **501**, with `reason: subscription_collection_unavailable` and the request-specific sentence. A missing and a foreign restaurant must answer 404 at the gate, so the 501 is not an endpoint that refuses everything. The restaurant's transaction listing, unfiltered by type or status, must hold the same number of rows before and after. That witness has no positive control, because no API creates a transaction row; that is the finding.

## The evidence file

`dinify.frontend.served-journeys/2`, written redacted with mode 600:

- `grade`: the legacy-grade statement above;
- `target`;
- `window`, on a served run: the London time at the start, the minutes left before 22:40, and the minutes required;
- `budget`: the run's time budget, in minutes;
- `tooling`: Node, Playwright and the Chromium version;
- `serving`: the deploy runs, the release and health answers, Admin's `release.txt`, the bundle's main script and its API origins, and `unread`, which says why a read failed. **Required:** `frontend_deploy.head_sha`, `backend_deploy.head_sha`, `backend_release`, `backend_health`, `admin_release.body` and `bundle.main_script`. A missing one is a problem, and the outcome is `failed`;
- `otp`: logins, issuances and refreshes;
- `orchestrator` and `probes`: each check;
- `provision`: what was created or closed out;
- `growth`;
- `journeys`: each one's pass, fail and skip counts against its accepted count, its time limit, every check by name, and every skip with its reason;
- `final_reset`: `attempted` (false only when no fixture was provisioned), `result` (`succeeded` or `failed`), and `closed_out` or the reason. A failed final reset is a problem;
- `outcome` and `problems`.

Not in the file: tokens, credentials, QR credentials, sessions and order contents.

## The workflow

There are two jobs.

**`health`** holds no secret and uses no environment. It asks `GET /uat/api/v1/health/` and reads the body, because that route answers 200 with `status: degraded` when the database is down. The window is read from the tz database Node carries, so BST and GMT both hold.

- Healthy, with at least 45 minutes left before 22:40 London (a start by 21:55): the journeys run.
- Healthy, but later than that: NOT RUN (`closing`). A run started then could not finish before UAT stops.
- Unreachable outside 11:00–23:00 London: the instance is stopped by design. NOT RUN.
- On a NOT RUN, the job succeeds with a summary and **the `journeys` job is skipped**. Actions has no neutral conclusion, and a skipped job is the nearest one.
- Unreachable inside the window: red.

**`journeys`** runs in the `uat-journeys` environment, which admits `main` only, and reads its secrets and variables from it. It runs these steps in order:

1. refuse any ref but main (kept as a second check; the environment's branch rule is the boundary);
2. the offline self-test;
3. install `playwright@1.56.1` with `--no-save` into `e2e/` only, then its Chromium only. `package.json` and the lockfile stay unchanged, and the step asserts it.
4. the run;
5. the redaction scan, with the run's hash file;
6. the upload of the one evidence file;
7. deletion of the fixture, hash and evidence files.

The timeouts fit together, and `tests/workflow.test.mjs` holds them consistent:

| what | limit |
|---|---|
| `health` job | 10 minutes |
| `journeys` job | 45 minutes: what the gate guarantees is left in the window |
| install step | 5 minutes |
| run step | 35 minutes, a backstop |
| the run's own budget | 30 minutes, final reset included |
| one journey | at most 15 minutes, and never more than what is left of the run less 3 |
| final reset | 3 minutes |

Before this, a journey could take 40 minutes and the job 90, so five journeys could need 200.

The workflow's permission is `contents: read`. The `journeys` job adds `actions: read`, for the deploy-run reads, and nothing else; there is no `id-token`. Every action is pinned by SHA.

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
JOURNEY_EVIDENCE=/tmp/served-evidence.json JOURNEY_SECRET_HASHES=/tmp/served-hashes.json \
node e2e/served/run.mjs
node e2e/served/redact.mjs scan /tmp/served-evidence.json --hashes /tmp/served-hashes.json
```

Without `JOURNEY_GITHUB_TOKEN`, the deploy runs are read unauthenticated. `run.mjs`'s own window check applies to a served target only, so a rehearsal against a loopback API can run at any hour.

A seeded local run of any single journey, with no `JOURNEY_RESTAURANT_*` set, behaves exactly as before. `journeyTarget` changes nothing there.
