# Kitchen board, two staff devices (D05)

A **manual, repeatable real-browser** check of the one thing no unit suite can
observe: that two operators looking at the same ticket, pressing the real
buttons, cannot both act on it — and that the one who loses is **told what the
ticket actually is**, rather than shown a card that silently rolled back.

It is deliberately **NOT wired into CI**, and it prints that at the end of every
run. It needs a disposable PostgreSQL, a running Django and a running dev
server, and CI has none of those. It is a **pre-merge gate for changes to the
kitchen command or reconciliation path**, run by hand.

It reuses the checkout journey's fixture, seed and helper style on purpose. It is
not a new end-to-end platform.

## What it asserts

| | |
|---|---|
| a real diner order reaches the board | placed through the anonymous journey, not inserted |
| the feed declares `kitchen_protocol` | a client that cannot see it goes read-only rather than guessing |
| the ticket carries `fulfilment_revision` and `order_status` | the two facts a command and a reconciliation need |
| **two devices press Start; both send the SAME precondition** | which is the real two-device situation, not a contrived one |
| **exactly ONE command applies** | asserted on the SAVED revision (`1`), not on the screen |
| **the loser sees a CONFLICT with the server's machine reason** | located by `data-testid`, read as `data-phase` / `data-reason` |
| **and still shows the ticket** | it is not removed, which is what made a refusal and a lost answer look alike |
| **a committed command whose response is DROPPED reports UNKNOWN** | `route.fetch()` then `route.abort()`, so the server really processes it |
| **and never claims it failed or was undone** | asserted on the message text |
| the server really did apply it | which is exactly why a rollback would have lied |
| the board reconciles on the next poll | read as the primary control's label |
| a stale recall is refused with a reason **and** current state | the projection a client reconciles against |
| **the retired target-only form is refused, not reinterpreted** | `400 kitchen_action_required` |
| **an omitted precondition is refused** | `400 kitchen_precondition_required` — there is no grace period |
| neither board raised an uncaught error | |

## Running it

Identical to `../checkout-journey/README.md` — same disposable PostgreSQL, same
`seed.py`, same Django and `ng serve`, same environment variables
(`JOURNEY_WEB`, `JOURNEY_API`, `JOURNEY_FIXTURE`, `CHROMIUM_PATH`):

```bash
node e2e/kitchen-board/kitchen.mjs
```

**RUN IT ON A FRESH FIXTURE.** The three harnesses share one seed, and
`journey.mjs` REPRICES the fixture dish mid-run, so running it twice against the
same database fails two of its own checks on the second pass — a fixture
artefact, not a defect. Re-seed between runs.

Last run: **24/24**, alongside **42/42** (`journey.mjs`) and **35/35**
(`recovery.mjs`), each on its own fresh seed, against a disposable local
PostgreSQL 16.13 (its own cluster on port 55432, never a shared instance), a
local Django on `test_settings` (Python 3.11.15), and a **development**
`ng serve` on Node 24.21.0 with Chromium 141 (`/opt/pw-browsers/chromium-1194`).

## What it deliberately does NOT cover

- **It does not prove database serialization.** That is
  `orders_app/tests_kitchen_concurrency.py`, which observes a real backend
  waiting on a lock from a third connection. Two browsers cannot demonstrate a
  row lock; they demonstrate what an operator is TOLD when one bites.
- **It does not cover the recall age boundary.** Ageing a completion past ten
  minutes is not something a manual browser run can do without either waiting or
  writing to the database, and both would make the check worse. The boundary —
  just inside, exactly at, just beyond, and expiring during a lock wait — is
  covered server-side in `orders_app/tests_kitchen_transition.py`.
- **It does not cover two DIFFERENT operators.** Both contexts sign in as the
  fixture owner, because the seed provisions one operator. The permission split
  (ordinary kitchen vs manage-level escalation, re-evaluated under the lock) is
  covered server-side with real distinct principals.
