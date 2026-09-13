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
| **an ordinary read SETTLES the uncertain command it answered** | K2 — a warning nothing can clear is its own defect |
| **a feed captured BEFORE a serve does not put the ticket back** | K1 — the board is FROZEN while the check runs, so a fresh poll cannot repair the case under test |
| **and the ticket is on Completed exactly once, not on both boards** | one id in two authoritative places was the reachable shape of it |
| **a LOST CANCELLATION keeps an actionable warning after its card has gone** | K2 — the notice used to render only inside a card, so the command whose outcome matters most took its own warning off the screen |
| **the per-order state read answers for an order in NEITHER feed** | the one thing the two feeds cannot do, which is why the route exists |
| **the board issues NO per-order read on an ordinary poll** | reconciliation is on demand, never an N+1 sweep |
| **Check issues exactly one read, for THIS order, and settles it** | driven through the real strip control |
| neither board raised an uncaught error | |

### Every wait is a barrier, not a sleep

There is no `waitForTimeout` in the run. Each wait is anchored to an outcome — a
response, a DOM condition, or a request the app could only issue after handling
the previous one. A fixed delay fails in the direction that **hides** a defect:
a check that runs before the thing it checks for has happened reads the PREVIOUS
state and, on a slow machine, reads it as a pass.

The staleness scenario needed one more thing than a barrier. The board's poll
loop is serial — `pollOnce` schedules the next read only once the current one
settles — so releasing a held stale response immediately starts a FRESH poll
that repairs whatever the stale one did. `gateFeed` therefore **holds every
later poll**, and uses the next REQUEST as the positive barrier for a negative
assertion: it cannot be issued until the held response was fully handled.

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

Last run: **38/38**, against a disposable local PostgreSQL 16.13 (its own
cluster, never a shared instance), a local Django on `test_settings`, and a
**development** `ng serve` on Node 24.21.0 with Chromium 141
(`/opt/pw-browsers/chromium-1194`), driving the K1–K3 revision of the frontend
against the K4 revision of the backend.

**AND BOTH NEW SCENARIOS WERE PROVED TO DISCRIMINATE, IN THE SERVED APP.** A
green run means nothing until you have seen it go red for the right reason:

| defect reintroduced | result |
|---|---|
| `applyFeed` replaces the store unconditionally (pre-K1) | **37/38** — "a read captured before the serve does not put the ticket back" fails with `cards=1` |
| the board's detached-operation strip removed (pre-K2) | **35/38** — the lost cancellation's warning is gone, and the two recovery checks report themselves unreachable |

The first attempt at that verification is worth recording, because it produced a
FALSE GREEN twice. Neutralising the per-ticket membership rule alone still
passed — the per-store watermark independently blocks the same resurrection — and
neutralising it with `if (false && …)` broke type narrowing, so `ng serve`
printed "bundle generation failed" and the run silently exercised the PREVIOUS
bundle. **Check that the dev server actually rebuilt before believing a
reintroduction result.**

The board-clearing step is state-driven (it reads each ticket's current
`fulfilment_status` rather than replaying a fixed three commands), so a second
run against the same database no longer fails on a fixture artefact — but
re-seeding between runs is still the cleanest thing to do.

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
