# The release contract

**This file explains. `policy.json` and `lib/` enforce.** Nothing here is the gate:
if a rule matters, it is a field the committed policy states and `lib/` reads, with a
test in `tests/` that proves refusal. A statement that lives only in prose is a
statement nothing checks.

**Publication on this path is disabled, and `deploy-prod.yml` is still the live
writer.** Read "What merging does" before merging anything under `release/`,
`.github/workflows/` or `angular.json`.

---

## What a release of this application is

A commit SHA on its own is **not** a release. One commit produces different bytes
under different configurations, and the difference decides which API origin the
bundle talks to. Two certifications of one commit are two candidates, too: they are
different builds with different manifests. So the unit that is certified, admitted and
published is one record (`lib/record.mjs`, `dinify.release.record/2`):

| identity | bound to |
|---|---|
| the target | repository, commit, the commit's source tree |
| the certification | workflow path, run id, **run attempt**, run start (the certification window counts from it) |
| the artifact | the upload's **artifact id** and the zip digest the API lists for it, the **manifest digest**, the **tree digest**, the entry count |
| the build | configuration, the dependency-lock digest and the environment the stamp read from the built bytes — bound through the manifest digest, which carries all three and which the publisher recomputes from its own download |
| the certification-time dependency evidence | the evidence record's digest, its bundle tree digest and entry count, the lock and manifest digests it retained, the installed-tree digest, the environment and the certifying run and attempt — bound by `provenance.json` (`dinify.release.provenance/2`) and re-derived by the gate from the candidate's own bytes |
| the fresh assessment | the assessment artifact's id and listed digest, the document digest and bundle tree digest, the evaluation run and attempt, the collection's **start and finish** and the decision moment, the outcome and counts, the trusted audit policy digest, the scanner identity, the applied records and the three graphs' digests |
| the publisher toolchain | package, version and exact Node; the reviewed lock's digest; the prepared tree's digest and entry count; the entrypoint's path and digest; the toolchain artifact's id and listed digest |
| the destination | the project, site, target and channel, and the digest of the **regenerated** hosting configuration |
| the peers | the approved receipt digests, and the Admin revision observed serving |
| the served state | what `/release.json` answered when the gate decided |
| the rules | the verifier revision and tree, and the policy digest |

The gate emits the record and its digest; the publisher refuses unless every identity
in it can be re-established from what the publisher itself holds and what the world
says at promotion time. Nothing here claims an artifact **was** substituted — GitHub
artifacts are immutable once uploaded — the record is what makes "the same unit"
checkable rather than assumed, across a re-run, an expired upload or a policy change.

## The artifact's records, and why the evidence is not in the payload

| | where | what it is |
|---|---|---|
| `dist/release.json` | ships inside the artifact, served at `/release.json` | the release's own identity — who built it, from what, for where |
| `provenance.json` | uploaded beside `dist/`, never shipped | binds that identity to the **artifact tree digest**, to the run that produced it and (`/2`) to the dependency evidence bundle below |
| `dependency-evidence/` | uploaded beside `dist/`, never shipped | the certification-time audit: the retained `package.json` + `package-lock.json`, the installed inventory, the pinned scanner's identity, the scanner's RAW output and the result — see "Dependencies" below |

**No audit evidence or tool inventory is in the hosted payload.** `dist/` is what the
public origin serves; what it was built from, what was installed and what the scanner
said are statements ABOUT the payload and ride beside it. The inner/outer design is
unchanged: `dist/release.json` carries no digest of itself, and `provenance.json`
carries the digests of both `dist/` and `dependency-evidence/`.

An artifact cannot contain its own final hash, so the digest lives outside the payload,
over **every regular file under `dist/`**, each entry length-prefixed and NUL-delimited
so the encoding is injective. The digest is over the **tree**, not an archive: a tar of
the same files differs by timestamp, ordering and compression level.

## The pipeline

```
push to main
 └─ Certify (certify.yml)        read-only, no secret, deploys nothing
      type-check · lint · release gate · tenant gate · full suite · production build
      build the SHIPPING configuration ONCE   ← the candidate
      npm ci · dependency-audit snapshot (proves node_modules IS the lock graph) ·
      dependency-audit audit (the pinned scanner, a real advisory query) — BEFORE the build
      stamp dist/release.json + provenance.json (asserting the built bytes), re-evaluating
      the audit evidence AFTER the build against the tree as it now stands, and writing
      dependency-evidence/ beside dist/ — refusing to stamp if any input moved
      upload  frontend-release-<run id>-<run attempt>   (dist/ + provenance.json + dependency-evidence/)
 └─ Publish (publish.yml)        on a successful Certify of main, or a manual dispatch
      gate     no credential. Checks out ITS OWN revision (github.sha) with full
               history, resolves the certifying run through the API by workflow PATH,
               downloads the candidate BY ARTIFACT ID with digest-mismatch: error,
               measures it as data, reads the certified commit from git (source,
               storage declaration, firebase.json AND .firebaserc), the served
               identity and the peers; PREPARES the publisher toolchain from the
               reviewed release/publisher lock (pinned npm, scripts disabled) and
               ASSESSES, now, the candidate's retained lock graph, the pinned scanner
               and that toolchain; retains both as their own artifacts; and evaluates
               lib/decide.mjs. Emits the decision and the admitted record. A REFUSE is asked one more question
               (lib/readiness.mjs): is it exactly the recorded, still-pending
               prerequisites of an automatic evaluation with publication disabled?
               Only that ends the gate green — the decision is still REFUSE.
      publish  starts only on decision == PROCEED AND allow == true — never on the
               gate job merely being green. The ONLY job that references
               FIREBASE_SERVICE_ACCOUNT, and only in the tool step. No npm ci, no build, no application source: the verifier
               PINNED to the gate's revision, main's release/ tree (to notice a policy
               that moved), the certified commit's two hosting files, and the admitted
               artifact by id. Inside one critical section it re-establishes the record
               (lib/preflight.mjs) — the fresh assessment and the toolchain included,
               from this job's OWN downloads — stages the payload beside a REGENERATED
               hosting pair, re-checks the assessment's age, every applied exception
               and the toolchain once more at the last boundary, and only then runs
               the ADMITTED toolchain's entrypoint by path (no npx, no action that
               fetches its own CLI), then fetches the identity AND every certified file
               back.
```

Every run ends in one outcome word (`lib/outcome.mjs`): `REFUSED`,
`PENDING_PREREQUISITES`, `SKIPPED_IDENTICAL`, `SKIPPED_STALE`, `PREFLIGHT_REFUSED`,
`WOULD_PUBLISH`, `PUBLICATION_FAILED`, `PUBLISHED_VERIFIED` or `PUBLISHED_DEGRADED`. The
four failing ones turn the run red; `PENDING_PREREQUISITES` is the one refusal that does
not, and why is the next section but one.
`RESTORED_AFTER_FAILURE` is never produced: nothing restores anything automatically.

## What merging does

A workflow that runs automatically after a merge has an operational effect, and "no
dispatch was run" is not a release-safety argument. So, stated plainly:

- **`certify.yml` runs on every push to `main`.** Read-only, no secret. It spends a
  runner, builds the shipping configuration and uploads a 30-day artifact. It deploys
  nothing.
- **`publish.yml` runs after every successful Certify.** Its gate evaluates everything
  and today **refuses** (see "The first publication" below) — `REFUSE`, `allow: false`,
  nothing admitted — and the publish job is skipped. Because that refusal is exactly the
  recorded, still-pending commissioning prerequisites of an automatic evaluation with
  publication disabled, the run now reports **a completed readiness evaluation**
  (`PENDING_PREREQUISITES`) rather than a failed release, and is not red. The run is
  titled *Readiness evaluation: automatic, …* and its gate job *Evaluate release
  readiness (non-publishing)*. **A green run here means the evaluation completed and
  every refusal was an expected wait. It does not mean anything was, or would be,
  published**, and its summary says so in those words. Anything else — an integrity
  failure, an unreadable origin or peer, an enabled release, a manual attempt, a crash,
  a changed policy list — stays red. Before this change the same refusal turned every
  merge's run red.
- **The certification and CI checks are unchanged**, including the required `validate`
  status; nothing here depends on the gate being green.
- **`deploy-prod.yml` still builds and publishes every merge to `main`**, with
  `npx ng build --configuration=uat` — the configuration `policy.json → build` names.
  **A change to that `angular.json` configuration therefore changes what the LIVE path
  builds, whatever this directory does.** `tests/workflow-drift.test.mjs` pins that the
  legacy workflow builds exactly that configuration, so the day it stops being true
  this disclosure is where it is noticed.

### A correction to #686

PR #686 described itself as changing nothing about what is deployed. It changed the
`uat` configuration in `angular.json` — adding `sourceMap: false`, `namedChunks: false`,
`aot: true`, `extractLicenses: true` and two budgets — and `deploy-prod.yml` builds that
configuration. "The deploy YAML is unchanged" was not evidence about the deployed
build. Measured afterwards, with three clean builds from `git archive` sharing one
`node_modules` (`package-lock.json` is identical at both commits):

| build | tree digest (34 files, no `release.json` — the legacy path does not stamp) |
|---|---|
| `f0ab3d0` (main before #686) | `sha256:3284ed657edd8d834de25142d19b819320ee630917806fc1ffe9eab729b849c8` |
| `3386724` (main after #686) | `sha256:3284ed657edd8d834de25142d19b819320ee630917806fc1ffe9eab729b849c8` |
| `3386724` again — determinism control | `sha256:3284ed657edd8d834de25142d19b819320ee630917806fc1ffe9eab729b849c8` |

The four added options restate the application builder's defaults, so the **bytes did
not change**. What did change is that the live build now **evaluates budgets**: the
initial bundle is 870.47 kB against the 500 kB `maximumWarning` (it prints and exits
zero), and an initial bundle above **4 MB** or any component stylesheet above **8 kB**
now **fails the live deploy**, where before #686 the `uat` configuration had no budget
and would have published it. That is a new failure mode on the live path, and it was
not disclosed.

**This change** was measured the same way: its working tree builds the `uat`
configuration to the same `sha256:3284ed65…49c8`, 34 files. It changes no
`angular.json`, `package.json` or lockfile, and the two files it adds under `src/app/`
— the storage declaration and a spec that reads it — are imported by nothing the
application bundles. A merge that lands after other commits on `main` should be
re-measured, not assumed.

## A readiness evaluation is not a failed release

Until the cutover, every merge's gate refuses, correctly, for reasons the policy itself
records as outstanding. Reported red, every merge adds another red run that means
"still waiting" — which is how the one red run that means "the candidate's bytes do not
match" gets ignored. `lib/readiness.mjs` separates the two **without touching the
decision**. It keeps three facts apart and merges none of them:

| fact | where it comes from | in the recorded wait |
|---|---|---|
| the evaluation completed correctly | `lib/readiness.mjs` | yes |
| the release decision | `lib/decide.mjs`, unchanged | `REFUSE`, `allow: false`, nothing admitted |
| publication performed | nothing on this path | no |

A refusal is the recorded wait only when **all** of these hold:

- the trigger is **automatic** and the mode **deploy**. A refused manual deploy or
  rollback is an attempt somebody made, and stays red;
- publication is **demonstrably disabled**: `FRONTEND_PUBLISH_ENABLED` unset or exactly
  `false`. `true` is an enabled release whose refusal is a failed release; any other
  value (`TRUE`, `1`, `yes`, ` false`…) is a misconfiguration, never "disabled"; a value
  the wrapper did not pass is *not read*, never "disabled";
- the decision was **fully produced** — readable, exactly decide's shape, `REFUSE`,
  `allow: false`, about this request;
- **every** reason is listed in `policy.json → publication.readiness.awaiting`, known to
  the closed registry in `lib/readiness.mjs`, and **standing in its context**: the
  policy still records it pending, and the evidence this run gathered looks the way that
  pending state says it should (the bootstrap reason only beside a no-identity answer —
  404, or the SPA at 200 — from the policy's own identity URL; the legacy reasons only
  while the trusted checkout shows the file; the backend-serving reason only while the
  policy declares no observation);
- **every listed condition that stands was actually refused** — a required check that
  disappeared is a defect, not good news — and **none is stale** (listed but recorded
  resolved).

There are no wildcards and no allowlist learned from the result being classified. After
the 2026-09-23 receipt approval `peers.capabilities_unpublished` is **not** a wait; if it
comes back it is red. The policy validator refuses a list naming anything outside the
registry, and `committed-policy.test.mjs` holds the list equal to what the committed
policy actually refuses — so **the change that resolves a prerequisite removes its entry
in the same reviewed change**, or the next evaluation is red (`readiness.expectation_stale`).

**How the workflow applies it.** The Decide step runs `decide` exactly as before; its
standalone exit status is still 1 on `REFUSE`, and its decision JSON, outputs and record
are written by it alone. Only when that status is **exactly 1** does the step ask
`cli.mjs readiness`, which reads the decision back from disk as data and exits 0 for the
recorded wait and 1 for everything else — so any other status (a crash, a usage error) is
passed through untranslated, and a decision it cannot read back is red. The Report step
then states `PENDING_PREREQUISITES` only when the readiness record is bound **by digest**
to the decision in the same file. The publish job keys on `decision == 'PROCEED' &&
allow == 'true'` and never on the gate being green; even if it started, the preflight
refuses any record not marked admitted. No `continue-on-error`, `|| true` or `always()`
was added to a privileged job.

**What it cannot say.** Nothing about the legacy deployment's health (its own runs
report that), nothing about whether the site is up, and nothing about whether this
candidate would publish once the prerequisites clear — only a later evaluation can.

**Left as it was, deliberately:** the publish job's own enablement step still reads any
value other than `true` as "not enabled" and reports `WOULD_PUBLISH` for an admitted
candidate. That is fail-safe (nothing publishes), unreachable while every candidate is
refused, and outside this change.

## Trust boundaries

- **The gate's code and policy are the default branch's, never the candidate's.** The
  gate checks out the exact revision its workflow file was taken from (`github.sha`),
  so the YAML and the code it calls cannot be two versions. `decide` has no flag to
  supply another policy.
- **The publisher runs the verifier the gate ran**, checked out at the record's
  revision. If `release/` on the default branch has moved since, it refuses
  (`preflight.policy_advanced`): a policy advance is an explicit restart, never a
  silent carry-on.
- **The candidate is fetched by artifact id from the certifying run's own listing**,
  in both jobs, with `digest-mismatch: error`, and the decision requires the id and
  digest to be the ones the run lists for this attempt. A re-run is a new attempt and a
  new certification (`preflight.attempt_changed`).
- **The publisher measures its own download** (`preflight.candidate_mismatch`) rather
  than trusting the gate's measurement.
- **The destination is resolved the way firebase-tools resolves it** — `firebase.json`
  AND `.firebaserc`, since `applyRC` follows a project alias — refused outside a narrow
  allow-list (hooks, `source`, unknown keys, an alias that moves the project, an ignore
  rule that would drop a certified file), then **regenerated** from the policy. The tool
  is handed the regenerated pair, never the certified files, and the pair's digest is
  part of the record (`lib/hosting.mjs`; the oracle test runs the installed
  firebase-tools' own resolution and records its version against the pinned one).
- **One credential reference.** `FIREBASE_SERVICE_ACCOUNT` appears once in
  `publish.yml`, in the `env` of the step *Publish to Firebase Hosting*, whose script
  never names it. The trusted `publish` command reads it only after its last-boundary
  checks pass, writes it to a `0600` file in a fresh `0700` directory, hands the tool
  that file's PATH (`GOOGLE_APPLICATION_CREDENTIALS`) in an environment built from
  nothing, and removes the directory whatever the tool does — so the value is never in
  the tool's environment, argv or output. (It replaced the Firebase action's `with:`
  input, which was an environment variable of that action's process too.) Every checkout
  in `publish.yml` and `certify.yml` sets `persist-credentials: false`; `publish.yml` has
  `permissions: {}` at the top and each job `contents: read` + `actions: read`. No
  expression is interpolated into a script in either file, or in `ci.yml`.
- **Actions are pinned by SHA, and the publisher is a REVIEWED GRAPH, not a version
  string.** `FirebaseExtended/action-hosting-deploy` is gone: it ran
  `npx firebase-tools@<version>`, resolving and installing a dependency graph over the
  network inside the job holding the credential, which nothing reviewed or scanned. The
  toolchain is now `release/publisher/package.json` + `package-lock.json` (one exact
  dependency, `firebase-tools` 15.31.0), installed by the gate — which holds no
  credential — and run by the publisher from that exact prepared tree. See
  "Dependencies" below.

These are pinned statically by `tests/workflow-drift.test.mjs` and executed by
`tests/workflow-simulation.test.mjs`.

## Dependencies: certification evidence, a fresh assessment, the admitted toolchain (D08 B2.2)

The guarantee, stated as the task stated it: **the exact frontend bytes considered for
promotion are associated with verifiable certification-time dependency evidence; a fresh
assessment of that same dependency inventory and of the actual publication toolchain must
be acceptable before publication authority is used.** Rebuilding the application,
scanning current `main`, updating a timestamp or independently resolving the publisher's
dependencies cannot substitute for any of those three.

### The evidence flow, and where the privilege is

```
certify.yml                    (no secret; contents: read)
  npm ci ─ snapshot ─ audit ────────────┐  the pinned scanner (npm 11.19.1, its own lock,
  ng build --configuration=uat          │  scripts disabled) — a REAL advisory query
  stamp ── re-evaluate after the build ─┘  refuses if any dependency input moved
     └─ artifact = dist/ + provenance.json (/2) + dependency-evidence/

publish.yml ─ gate             (no secret; contents: read, actions: read)
  download the candidate BY ID (digest-mismatch: error)
  prepare-publisher ── release/publisher lock ─► tooling/  (pinned npm, --ignore-scripts,
  assess ── candidate's RETAINED lock (scan-only replay)    measured: tree, entrypoint,
         ── the pinned scanner's graph                      installed inventory, Node)
         ── the prepared toolchain's graph
         └─► assessment/  (start, finish, raw output, trusted policy)
  upload tooling/ + assessment/ as THIS run's artifacts ──► ids + digests
  decide ── evidence + assessment + toolchain + everything else ─► admitted record /2

publish.yml ─ publish          (the ONLY job that references the secret)
  download candidate, toolchain, assessment BY THE RECORD'S IDS (digest-mismatch: error)
  preflight ── re-derive every digest from its own downloads; the assessment is this
               run's, inside its window, no applied exception lapsed; this Node
  Publish ──── LAST BOUNDARY: the same checks again with a clock read now
               └─ only then: read the credential ─► 0600 file ─► run the admitted
                  entrypoint by path, in the stage, built environment, no retry
  verify ───── fetch the identity and every certified file back
```

Nothing in the publish job resolves, downloads or installs a tool. Nothing in either job
runs the candidate's npm scripts, lifecycle hooks or build to assess its graph: the
assessment is a **scan-only replay** — a directory holding exactly the two files the
evidence binds (`package.json`, `package-lock.json`), which `npm audit` reads as the
lockfile graph, with nothing installed and no script run.

### What each half is, and is not

- **Certification evidence** (`dependency-evidence/record.json`,
  `dinify.release.dependency-evidence/1`) binds repository, commit and tree, build
  configuration, environment, workflow path, run and attempt, the manifest and lock
  digests, the installed inventory (including explained optional absences), the scanner
  and policy identity, the raw scanner outputs' digests and the candidate's `dist/` tree.
  The gate re-derives all of it from the candidate's own bytes, re-evaluates the RAW
  output under the policy the evidence names (so a self-consistent bundle whose result
  contradicts its raw answer is `dependency.evidence_unreproducible`), and refuses a
  result that is not `within_policy` or `exceptions_only`. **The installed-tree digest is
  over installed PATHS AND VERSIONS, not every byte** — the record says so in
  `inventory.observation`. The B2.1 collection records ONE moment as its start, finish
  and decision; the record calls it `audit.invokedAt` and does not pretend it is a span.
- **The fresh assessment** (`assessment.json`, `dinify.release.assessment/1`) is a real
  query, now, by the pinned scanner, credential-free, over three graphs: the candidate's
  retained application graph, the pinned scanner's own graph and the prepared publisher
  toolchain's graph. It records the collection's actual **start and finish** (one-second
  resolution, the workflow clock's) and the decision moment, the trusted audit policy's
  digest, the raw outputs, and the outcome — never an `auditPassed: true`. The trusted
  workflow supplies `now`. **Re-deciding old evidence with today's clock is not fresh**:
  the window is measured from when the collection STARTED.
- **The publisher toolchain** (`tooling.json`, `dinify.release.publisher-tooling/1`) is
  the reviewed lock, installed by the pinned npm with `--ignore-scripts --no-audit`,
  bin links removed, measured as data, and refused on any link, special file or
  unexpected top-level entry. The app's own `firebase-tools` devDependency certifies
  nothing about it. There is no `@latest`, no `npx`, no global `firebase` and no second
  tool: the reviewed manifest holds one exact dependency and the lock one resolved
  version with integrity.

### The freshness policy

| | limit | measured from | re-checked |
|---|---|---|---|
| certification | `freshness.certificationWindowHours` (24) | the certifying run's start | gate, preflight, last boundary |
| fresh assessment | `freshness.assessmentWindowHours` (24, the validator's maximum) | the collection's START | gate, preflight, last boundary |
| applied exception | the record's `expires` (lapses 00:00 UTC that day) | — | gate, preflight, last boundary |

The record's `expiresAt` is the earliest of the three; each is refused under its own
name, so a lapsed assessment is never reported as a stale certification.

### Who enforces what

| consumer | refuses |
|---|---|
| `stamp` (certify) | an audit that is not within policy after the build; any dependency input that moved between the audit and the stamp — the build's own output is re-inventoried, so no stale evidence is attached |
| `assess` (gate) | writes NOTHING and exits 2 — *not performed* — for an old candidate, unusable evidence or no prepared toolchain; exit 1 blocking, exit 2 incomplete |
| `decide` (gate) | `dependency.*`: evidence missing, unsupported (pre-B2.2), invalid, unreproducible, wrong commit/tree/lock/manifest/environment/configuration/run/attempt/candidate, not passing; assessment missing, invalid, not this run's, wrong candidate/graph/scanner/tooling, policy mismatch, out of order, stale, blocking, incomplete, unretained; toolchain missing, invalid, unreviewed, mismatched, unretained |
| `preflight` (publish) | `preflight.assessment_not_current`, `assessment_replaced`, `tooling_replaced`, `tooling_mismatch`, `runtime_mismatch`, `assessment_mismatch`, `assessment_stale`, `exception_expired` — from its OWN downloads and the run's listing now; a moved `release/` or `dependency-audit/` tree on main is `preflight.policy_advanced` |
| `publish` (last boundary) | `publisher.tooling_mismatch`, `runtime_mismatch`, `assessment_mismatch`, `assessment_stale`, `exception_expired`, `certification_stale` — **before** the credential is read; the outcome is then `PREFLIGHT_REFUSED`, never `PUBLICATION_FAILED`, because no tool ran |
| `readiness` | nothing here is ever a wait: every `dependency.*` code beside the recorded six stays red, and a policy listing one does not validate |

**A pass does not make an ineligible candidate promotable.** Every other rule — revocation,
ancestry, peers, storage, the served state, the prerequisites — still applies, and the
disabled path still stops before the publish job.

### Old candidates, re-certification and recovery (release notes)

- **A candidate stamped before this change is refused by name**, on every path —
  deploy, redeploy and rollback alike: `dependency.evidence_unsupported` (its
  `provenance.json` is `/1`) and `dependency.assessment_missing` (the assessment is *not
  performed*: there is no retained inventory to assess). Nothing is retrofitted and there
  is no "old artifact is safe" bypass. The remedy is to re-certify that commit — a new
  Certify run of it produces a new candidate with evidence. (Separately, every candidate
  older than the 24-hour certification window is still refused as
  `certification.stale`; this change does not relax that.)
- **Re-certification of the same SHA is a new candidate**: a new run, new evidence, a new
  record. Two certifications are distinguishable by run, attempt, manifest digest and
  evidence digest, and swapping evidence between them is refused.
- **The evidence is retained with the candidate**, in the same upload (30 days), never
  looked up as "the newest audit artifact". The fresh assessment and the toolchain are
  retained by the evaluation run (90 days and 1 day), named by run and attempt.
- **A refusal at the last boundary is recovered by a NEW run**, which prepares and
  assesses afresh: a manual dispatch of the same SHA, or the next certification. The old
  run is never re-read, and a re-run of the old attempt is a new attempt the preflight
  refuses. A new advisory can refuse unchanged bytes; when that happens the remedy is a
  dependency change and a new certification — never an exception approved to pass it.

### What the suites simulate

The advisory answers in the suites are **SYNTHETIC**, injected at ONE place: the recorded
npm (`tests/fake-npm.mjs`), i.e. the scanner's process boundary, where the network's
answer enters. Everything downstream is the real code. Tests that inject one say
SYNTHETIC in their title. The real scanner against the real advisory database is the
measurement below.

### The fresh assessment, measured

**Measured against the real advisory database** on 2026-09-25, credential-free, in a
disposable worktree of `488c3d7` (the mechanism commit; the documentation commit after
it changes no code), with the real registry, the pinned scanner (npm 11.19.1) and Node
24.21.0. The run and attempt ids are local stand-ins (`424242`/`424243`), not CI runs.

| step | result |
|---|---|
| `npm ci` → `audit:snapshot` | 1,274 locked, 1,140 installed; installed tree `b1869f07…5b85` |
| `audit:deps` (certification) | within policy, 3 moderate tooling findings REQUIRE TRIAGE: `@opentelemetry/core` GHSA-8988-4f7v-96qf, `csv-parse` GHSA-8cw4-87c7-c6xx, `stream-json` GHSA-528h-pc64-c93x |
| `ng build --configuration=uat` | byte-identical to `main`'s (`69953f5`) apart from the stamp's own `release.json` |
| `stamp` | `provenance/2`; `dist/` tree `ce97d756…21b4`, 35 files; evidence record `faa49482…a802`, bundle `162f897e…6978` (13 files); nothing about dependencies in `dist/` |
| `prepare-publisher` | `firebase-tools` 15.31.0 under v24.21.0; 672 locked, 671 installed (1 explained optional absence); 6 bin links removed; tree `f0f4fd22…6d39`, 20,272 files — the SAME digest an earlier preparation that day produced |
| `assess` | within policy, 5 findings, all moderate tooling, triage required: the application's 3 above; the scanner's 144 packages clean; the publisher's `@opentelemetry/core` GHSA-8988-4f7v-96qf and `uuid` 9.0.1 GHSA-w5hq-g745-h8pq (the application graph's `overrides` pin keeps that one out of the application graph, not out of the publisher's). Collected 16:21:12Z → 16:21:15Z; the candidate's artifact digest unchanged |

No record was approved for any of the five: they are visible as triage required, which
is what the policy says a lower-severity tooling finding is.

### Mutations: each B2.2 rule reverted alone

Eighteen source mutations, each reverting ONE rule, each run against every unit suite and
(where the rule reaches the workflow) the simulation's dependency scenarios, then
restored. Every one fails a named subset; the count is failing entries (tests and the
suites that roll them up).

| mutation | fails | first failing test |
|---|---|---|
| a legacy (`/1`) candidate accepted | 3 | an OLD candidate is unsupported — no retrofit, no bypass |
| the stamp skips the post-build re-evaluation | 1 | a dependency input that changes DURING the build attaches no evidence |
| no assessment window | 6 | an assessment older than the window |
| the toolchain installed without `--ignore-scripts` | 4 | every lifecycle script stayed un-run |
| the toolchain upload drops hidden files | 9 | the gate prepares and assesses with the trusted CLI, retains both as this run's artifacts |
| `toolingReasons` accepts anything | 12 | no toolchain was prepared |
| the assessment clock at millisecond resolution | 1 | within policy, three graphs … and times that happened in order |
| evidence run start compared with the API's `run_started_at` | 105 | an otherwise perfect candidate is refused, and exactly for the outstanding owner and peer facts |
| the preflight does not require THIS run's assessment | 2 | a re-run of the publish job alone carries an earlier attempt's assessment — a repeat re-assesses |
| the last boundary skips the dependency re-check | 4 | `publish` refuses at the last boundary without reading the credential |
| the last boundary skips the certification window | 1 | (the same, for `certification_stale`) |
| the evidence's raw output is not reproduced | 1 | a self-consistent bundle whose raw answer contradicts its result |
| the tool inherits the step environment | 6 | the invocation is the admitted entrypoint by absolute path, with an environment built from nothing |
| the outcome ignores a last-boundary refusal | 2 | the assessment ages out while the publisher waits |
| a blocking assessment accepted | 5 | a new advisory refuses unchanged bytes |
| the preflight does not compare the listed toolchain | 4 | the admitted toolchain upload is no longer listed |
| an exception's lapse is not checked | 4 | an applied exception that has lapsed |
| an assessment may name another candidate | 5 | an assessment of another commit |

The `evidence run start` row is the defect this change almost shipped: the stamp's own
clock reading is LATER than the API's run start, so comparing the two refuses every real
candidate — the harness stamps five minutes after the run starts precisely so that
mutation cannot pass.

### Known limits

- The dependency-audit record grammar admits only `application:` and `scanner:` paths, so
  a finding in the PUBLISHER graph cannot be excepted or triaged by a record: a
  high/critical there blocks until the lock changes, and lower severity stays visible as
  triage required. That is conservative, and deliberate for now.
- The toolchain's integrity is the reviewed lock plus npm's integrity check at install
  plus a measured tree; it is not a reproducible build of firebase-tools, and a passing
  scan is not proof of safety.
- Nothing here binds a fresh audit to Backend or Admin promotion, and `deploy-prod.yml` —
  still the live writer — consumes none of it.

## Compatibility

### Peers: selection evidence and serving evidence are different things

**Selection** — "is revision X of that peer one this candidate may be released beside?"
— is answered by a **receipt**: a JSON record produced from that peer's git at the
exact revision (`node release/cli.mjs peer-receipt`), committed under `release/peers/`
and pinned by digest in `compatibleSet`. Its contract values and capability levels are
**read from the peer's own export files** at that revision; nothing in the policy
restates them. A receipt proves what a revision's **source** says, and nothing about
what is deployed.

**Serving** — "which revision of that peer is live?" — is answered by an observation,
where a peer publishes one, and refused by name where it does not.

| peer | selection | serving |
|---|---|---|
| backend (`a6b25a6`) | **operator receipt**: the repository is private, so the receipt is produced by an operator from the backend's git and reviewed as a file. No backend credential is given to anything that runs repository code, and no public endpoint was added. | **unavailable** until the backend publishes a served-revision identity (B3). Refused as `peers.backend_serving_unverified`; an operator statement is not accepted as serving evidence. |
| admin (`eb54c92`) | **public-repository receipt**, re-derived at decision time through the API (tree and `deploy.yml` blob). Identity only: this application holds no Admin protocol, and the receipt's `assumptions` say why. | `https://admin.dinifyapp.com/release.txt`, required `no-store` and in the approved set. Re-read inside the publisher's critical section. |

**Cross-repository changes remain an ordered, manual sequence.** This gate is the only
path that consults `compatibleSet`; the backend's own deploy and `deploy-prod.yml` make
no compatibility decision. What this makes true is narrow: on THIS path, a candidate
paired with an unapproved or incompatible peer revision is refused. It does not make a
one-sided change unreleasable — the other side's own deploy can still ship it — so the
order is: merge the peer, produce a receipt from its git at the merged commit, approve
that receipt here in a reviewed pull request. Two consequences of the committed state:

- the approved backend revision is `a6b25a6` (the #338 merge). `366b7e4` (the #331
  merge, the first carrying `orders_app/contracts/published_capabilities.contract.json`)
  REPLACED `9448f55` (the #330 merge) on 2026-09-23, and was itself replaced by
  `a6b25a6` on 2026-09-24 — replaced rather than joined, because every approved backend
  is checked for compatibility and an export-less revision left in the list would refuse
  `peers.capabilities_unpublished` for ever. Both earlier receipts stay under `peers/`
  as history and are no longer approved; the committed-policy suite selects them
  deliberately as negative controls. **Approving a receipt is a statement about SOURCE**, and
  `peers.backend_serving_unverified` stands until B3 — a deployment log is not a
  served-revision identity;
- **every Admin promotion makes this path refuse** `peers.admin_serving_unapproved`
  until a receipt for the new Admin commit is approved. That is the ordered
  coordination made visible, and it is deliberate. It happened for real on
  2026-09-24: Admin #26 and #27 were deployed, and the frontend readiness run
  `36018365996` (on `c32f383`) refused `peers.admin_serving_unapproved` for `3521ebd`
  and was classified `not-a-waiting-state` — correctly. The remedy was a reviewed
  receipt refresh (below), **never** an entry in `publication.readiness.awaiting`. It
  happened again on 2026-09-25: Admin #28 and #29 were deployed, and readiness run
  `36146235129` (on `3a16e84`) refused the same way for `1993a08`, and on 2026-09-26
  readiness run `36247543634` (on `485e9e9`) refused the same way for `a7ef20c`. The
  approved Admin revision is now `a7ef20c` (the #31 merge, D08 B2.4, 2026-09-26),
  replacing `eb54c92`, which had replaced `1993a08`, `3521ebd` and `38df037` in turn,
  rather than joining them. An Admin rollback to any of those, or to `ad4a7f8` (the #28
  merge, deployed for about two and a half hours and never approved), is refused the
  same way until approved again (see the two 2026-09-26 sections).

### The D01 ceiling contract

The request ceilings are the backend's; this repository holds a synchronized copy so
the basket can refuse an over-ceiling order before the round trip. The tie is a digest
over the ceiling **values** in a canonical form Python and JavaScript produce byte for
byte (keys beginning `_` are excluded, so the copies may annotate themselves
differently). The candidate's digest is compared with every approved backend receipt's
digest — read from the backend's export at that revision — and refused on mismatch.

### Storage: set containment, on every promoting path

A promotion can strand a diner's checkout if the incoming bundle cannot read the record
the served bundle wrote. The rule is `lib/storage.mjs` over a **reviewed declaration**,
`src/app/_services/checkout-record.storage.json`: the exact `(version, semantics)`
pairs a build writes and reads, and **where the bytes are** — the store, the logical
key, the physical key the storage layer actually writes (`[dinify]diner.checkout.attempt`,
the root prefix included) and the byte encoding (`json-value-envelope`, i.e.
`JSON.stringify({value})`). The gate requires

```
served.reads ∪ {served.writes}  ⊆  candidate.reads
and  store, key, physicalKey, encoding  equal on both sides
```

as **set containment, never a numeric comparison**, on every path that promotes —
deploy, redeploy, rollback and bootstrap. A numerically larger version is not evidence
that its reader preserves an older issued command, and the same pairs at a different
physical key or in a different encoding are not compatible either: the reader finds
nothing, answers `none`, and mints a fresh key for a purchase whose command is still
outstanding. The declaration is kept honest two ways:

- a **digest tripwire** over the reader's source files *and the storage layer beneath
  it* (`storage.service.ts`, `session-storage.service.ts`, `storage.module.ts`): the
  stamp refuses a candidate whose declaration was not re-affirmed after any of them
  changed;
- a **Karma spec** that builds the coordinator from the application's real root
  configuration (`AppModule`, so the prefix is the one the app uses), seeds each
  declared pair as **raw bytes** at the declared physical key in the declared encoding
  — never through the service under test — and asserts it is recovered under the same
  key with its issued command intact. It also checks that a fresh checkout leaves its
  bytes exactly there.

`app.module.ts` is deliberately **not** in the tripwire. It changes for many reasons
unrelated to storage, and pinning it would make every one of them a storage review.
A change to the root prefix there is caught by the spec instead, and that was measured:
with the prefix changed, the tripwire passes and the spec fails 7 of 11.

### Eligibility is separate from ancestry

An ordinary revert leaves the reverted commit an ancestor of `main` for ever, so
ancestry cannot mean "a target anybody still wants". `policy.json → eligibility`
names revoked commits (never promoted, by any path) and a minimum safe target (the
floor below which nothing is promoted), applied on every promoting path.

## Rollback

A rollback is `mode=rollback` by manual dispatch, never automatic. It does **not** ask
Firebase to re-promote an old release: it **republishes the target's certified
artifact** through the same gate and publisher as any deploy. So what must still exist
is that artifact — listed, unexpired, inside the certification window — and the storage
rule above must admit it. An ordinary deploy may not move backward
(`rollback.implicit`).

The certification window is 24 hours (`freshness.certificationWindowHours`), so a
rollback to a candidate certified earlier needs that commit **re-certified**:
re-running its Certify run produces a new attempt and a new candidate, which the gate
treats as a different candidate. **That is a fresh build, not evidence that the old
payload was audited**, and the 24-hour age of a certification is not a dependency
audit either. Since B2.2 every promotion, a rollback included, also runs a FRESH
assessment of the target candidate's retained inventory (see "Dependencies"), and a
candidate stamped before B2.2 carries none and is refused by name. **The 24-hour
certification window was deliberately NOT relaxed by that change**: re-admitting an
older certified payload on the strength of a fresh rescan is now possible in principle,
and doing so is its own reviewed policy decision.

Firebase Hosting's own release retention is the owner's **fallback** when this path
cannot publish at all, and is a named prerequisite (below). This path does not depend
on it.

## Serving verification, and what it does not prove

After the tool returns, the publisher reads `/release.json` from `identityOrigin` and
fetches **every certified file** back, comparing bytes against the admitted record, on
the schedule `hosting.verification` states. The identity file alone proves nothing
about the other files: it is one file among the upload, and a marker is not evidence
that every hosted byte is the candidate's. Even the full fetch-back is bounded — one
fetch per file, from one vantage point, at one moment, through whatever caching sits in
front of the origin. It does not cover other origins or custom domains serving this
content (an owner inventory item), and it cannot see bytes served differently to other
clients. A tool that fails after going live is reported `PUBLISHED_DEGRADED`, not as a
clean failure.

**The identity must also be served `no-store`, and that is checked twice.** Every later
decision reads the served identity first and refuses a cacheable one
(`served.identity_cacheable`, in every mode, rollback included), so a publication that
leaves `/release.json` cacheable leaves this path unable to decide again — including the
rollback that would undo it.

- **Before publishing**, the gate resolves which header rules in the candidate's
  `firebase.json` apply to the identity path, the way Firebase's open-source hosting
  server does (normalised `source`, minimatch with default options, every matching rule
  applied in order). It refuses `hosting.identity_cacheable` when a matching rule's
  `Cache-Control` is not `no-store`, or when no rule sets one at all (the host default
  would then apply), and `hosting.identity_cache_unproven` when a rule uses a pattern it
  cannot decide (braces, classes, negation, most extglobs). The model is deliberately
  stricter than the tool: every matching value must be `no-store`, so rule order never
  decides the answer. `hosting-oracle.test.mjs` pins it against superstatic's own matcher
  and header middleware.
- **After publishing**, `PUBLISHED_VERIFIED` requires the served identity to carry
  `no-store`. Otherwise the outcome is `PUBLISHED_DEGRADED`, and the run summary shows the
  `Cache-Control` the origin actually sent. This is the only observation of the
  production CDN; the model above describes the configuration, not the edge.

## The first publication — every prerequisite is a named refusal

The committed policy refuses every candidate today, and the refusals are the list of
what enabling this path requires. `tests/committed-policy.test.mjs` pins the exact set
by running the real `decide` against the committed file:

| refusal | resolved by |
|---|---|
| `prerequisite.source_protection_unrecorded` | recording branch protection on `main` (required checks, no force-push), or disclosing its absence as a limitation, in `prerequisites.sourceProtection` |
| `prerequisite.retention_unverified` | establishing what Firebase Hosting retains for this site — the owner's fallback — in `prerequisites.retention` |
| `prerequisite.legacy_publisher_active` | the cutover change setting `prerequisites.singlePublisher` |
| `prerequisite.legacy_publisher_present` | the same change **deleting** `deploy-prod.yml` — this one is observed from the checkout, so the policy cannot claim it |
| `peers.backend_serving_unverified` | B3: the backend publishing a served-revision identity |
| `served.bootstrap_unauthorized` | an explicit, reviewed `bootstrap.authorized: true` with `servedBaseline` naming the live commit. That commit must carry a valid storage declaration, one that states where its bytes are (physical key and encoding) — i.e. be at or after the merge that introduced them. The live path publishes every merge, so by the time a bootstrap is authorized the live commit will be |

`peers.capabilities_unpublished` was the seventh until the 2026-09-23 follow-up approved
the receipt for backend `366b7e4`; it reappears — and is not an expected wait — if an
export-less backend is ever approved again.

`peers.backend_serving_unverified` has no owner action available today: it needs B3.
Until then this path cannot publish, and says so, rather than accepting an operator's
word for which backend is live.

### The cutover

**Setting `FRONTEND_PUBLISH_ENABLED` while `deploy-prod.yml` still exists is not a
cutover**: the site would have two independent writers, only one of them serialised or
gated. The cutover presupposes that every other refusal in the table is already
resolved — B3 included — and it is ONE reviewed change that deletes `deploy-prod.yml`,
records the prerequisites, **empties `publication.readiness.awaiting`** (each entry
leaves with the prerequisite it names; an entry left behind turns the evaluation red as
stale), and authorizes the bootstrap with `servedBaseline` naming the
last commit `deploy-prod.yml` actually published (read from its last run, and re-read
immediately before merging: a merge landing in between makes the named baseline wrong,
and nothing can verify it — that is why the bootstrap is an explicit owner statement).
Then, in order:

1. merge it with the variable unset — no workflow publishes that merge; the Publish run
   on it should read `WOULD_PUBLISH` (the dry run on the real world);
2. set `FRONTEND_PUBLISH_ENABLED=true`;
3. dispatch `mode=deploy` for that merge commit inside its certification window, and
   read the outcome: only `PUBLISHED_VERIFIED` is a completed cutover;
4. in a follow-up change, set `bootstrap.authorized` back to `false` once `/release.json`
   is served.

Between steps 1 and 3 nothing publishes merges to `main`; hold merges for that window.

## The shipping configuration

It is `uat`, and that is the honest name for it: it carries the UAT-targeted API
origin, the destination this stack has today. It is not "production" and nothing here
calls it that. It carries `production`'s optimisation, source-map, licence and budget
settings. The environment bakes Angular's `production` flag **false**, recorded in
every manifest as `environment.productionFlag` because it is true, not because it is
desirable. `release/cli.mjs stamp` asserts the approved origin is present in the
**built bytes** and the forbidden ones are absent.

## Tests, and what each kind proves

`npm run test:release` runs the CLI self-test, then 749 tests in about 100 seconds
(four cores; most of it is the workflow simulation). Each is labelled
**REGRESSION** (pins a finding reproduced before its fix: on `3386724` for the
baseline, on `ce6b892` for what review on #687 found), **CONTRACT** (a rule this
change introduces) or **CONTROL** (something that must not change).

| file | tests | what it proves |
|---|---|---|
| `decide.test.mjs` | 191 | the refusal matrix: one allowed baseline, each case breaking exactly one fact |
| `policy.test.mjs` | 53 | the policy is validated before anything is evaluated; every decision-bearing field |
| `publisher.test.mjs` | 91 | the admitted record, the critical section, the outcome vocabulary (a recorded wait is its own word and only a refusal can be one), a `no-store` identity required for `PUBLISHED_VERIFIED` |
| `hosting.test.mjs` | 43 | destination resolution, the allow-list, the ignore proof, regeneration, the identity's `Cache-Control` before publishing |
| `hosting-oracle.test.mjs` | 20 | the model against the installed firebase-tools' own functions, and the header model against superstatic's own matcher and middleware |
| `storage.test.mjs` | 43 | set containment, the declaration, where the bytes are, the tripwire |
| `peers.test.mjs` | 30 | receipts from real git, public verification, serving over real TLS |
| `manifest.test.mjs` | 50 | the stamp and the manifest schema |
| `contract.test.mjs` | 9 | the D01 digest across languages |
| `dependency-evidence.test.mjs` | 43 | B2.2 through the real CLI: the stamp binding and its refusals (a mid-build input change, a blocking certification audit, a genuine pre-B2.2 stamp), `prepare-publisher` (pinned npm, scripts disabled, measured, unsafe entries refused), `assess` (three graphs, scan-only replay, trusted policy, blocking/incomplete/not performed) and the `publish` last boundary |
| `readiness.test.mjs` | 56 | the recorded wait against every way a refusal can differ from it, and the real `readiness` and `outcome` commands through files |
| `workflow-simulation.test.mjs` | 63 | `publish.yml` EXECUTED: real scripts, real CLI, real git checkouts, local HTTPS origins and an observable stand-in publisher — including the non-publishing evaluation matrix, both outcome steps and the publisher/credential counts |
| `workflow-drift.test.mjs` | 27 | the three workflow files held to the policy, statically — the publish job keyed on the admitted decision, the readiness wrapper translating one status |
| `committed-policy.test.mjs` | 30 | the committed policy's exact refusal set, through the real `decide`; the approved receipts; the readiness list equal to that set; the 2026-09-24 refresh replayed against what CI observed, with every other fact held fixed |

**The simulation is production-shaped, not GitHub.** It parses and runs `publish.yml`
with GitHub's expression semantics; `actions/*` are stand-ins that behave as documented
(the upload stand-in applies v4+'s root rule and excludes hidden files unless told
otherwise), npm is a RECORDED npm (`tests/fake-npm.mjs`: `ci` from a package store,
`audit` from a synthetic advisory table — the network seam), and the admitted toolchain's
entrypoint is a stub publisher run by the REAL `publish` command. The stub resolves its
destination with firebase-tools' own functions and can be told to fail, fail after
publishing, drop a file or publish something else. It has no queueing, concurrency groups, OIDC, runner
images or masking; the GitHub API is a recorded map. An action it does not model is an
error, never a pass.

## Baseline, as reproduced on `3386724` before any change

```
R1.a  backend commit deleted from the policy                    -> PROCEED
R1.b  admin commit "not-a-sha"                                  -> PROCEED
R1.c  backend commit a nonsense string                          -> PROCEED
R1.d  backend repository foreign                                -> PROCEED
R1.e  decide() had no serving-evidence input for peers
R1.f  D01 compared against the policy literal                   -> refused only by editing the literal
R2.a  descendant deploy lowering served semantics 2 -> 1        -> PROCEED
R2.b  descendant deploy lowering record v3 -> v2                -> PROCEED
R2.c  explicit rollback 2 -> 1                                  -> refused (rollback path only)
R2.d  a revoked target had no representation                    -> PROCEED
R2.e  certify.yml passed no semanticsRevision; stamp defaulted it to 1
R3.a  served same SHA, different manifest, automatic            -> SKIP_IDENTICAL
R3.b  ordering relation decided on the SHA alone
R3.c  gate outputs: allow, decision, sha, run_id, artifact_name
R3.d  publisher verifier checked out at `main`
R3.e  publisher downloaded by name
R3.f  success = served commit equals the SHA
R3.g  publisher self-check on the admitted candidate            -> passes
R3.h  publisher self-check on a different self-consistent one   -> passes
R3.i  firebase.json ignore:["**/*.js"]                          -> no finding
R3.j  .firebaserc never read
R3.k  origin serving the SHA from another run's build           -> reported as success
```

Each is now refused or pinned by at least one test whose title carries its label.
R2.c is carried by a **CONTROL**, not a REGRESSION: it was the one case the old barrier
already refused, and it must stay refused now that the same rule covers every other
promoting path.

### Found in review on #687, reproduced on `ce6b892` before any change

```
C.a  firebase.json serving /release.json as public, max-age=300
       gate                                                     -> PROCEED
       publisher verification                                   -> PUBLISHED_VERIFIED
       the next redeploy, and the rollback that would undo it   -> refused, served.identity_cacheable
C.b  the storage layer changed where or how the record is written
     (JSON envelope, key format, root prefix), declaration untouched
       storage tripwire                                         -> silent (not in reviewedSources)
       storage contract spec                                    -> 9/9 pass (it seeded through
                                                                   the same service it tested)
       what a diner's reload then does                          -> read() answers none; a fresh
                                                                   key is minted while the served
                                                                   build's command is outstanding
```

Both are now refused, and each finding is carried by tests labelled
`REGRESSION (Codex P2 on #687)`:

- **C.a.** Checked before publishing (`hosting.identity_cacheable` /
  `hosting.identity_cache_unproven`) and after it (`PUBLISHED_VERIFIED` requires a
  `no-store` identity). Against the unmodified `lib/`, the publisher and simulation
  suites fail 8: the five new tests, plus three existing ones (two CONTROLs and a
  CONTRACT) whose expected shapes now include the cache facts. The new hosting tests
  import a function the unmodified `lib/` does not have, so they are pinned by mutation
  rather than by that baseline.
- **C.b.** The declaration names the physical key and the encoding, the gate refuses any
  change to either, and the tripwire covers the storage layer. The contract spec now
  seeds raw bytes through the real `AppModule`. Each of the three storage mutations fails
  it 7 of 11. The tripwire catches the envelope and key-format mutations. The prefix
  mutation lives in `app.module.ts`, which is deliberately not pinned (see "Storage"
  above), so only the spec catches it.

## What is deliberately left for later

- **B2 beyond this path.** B2.2 binds certification evidence and a fresh assessment to
  the FRONTEND candidate and its publisher toolchain. It does not bind anything to a
  Backend or Admin promotion (their deploys consume no such record), it does not audit
  the GitHub Actions or runner images the workflows use, it adds no self-test for the
  gates' own scanners, and it does not touch `deploy-prod.yml`, which remains the live
  writer and consumes none of it. The 24-hour certification window is unchanged.
- **B3** — a served-revision identity for the backend. Until it exists this path
  refuses `peers.backend_serving_unverified` and cannot publish.
- **B4** — anything beyond this path: the cutover itself, custom-domain inventory,
  QR URL continuity, and pinning `firebase-tools` on the legacy path, which still
  resolves `latest` inside the job holding the credential.

## Running it locally

```bash
npm run test:release
node release/cli.mjs self-test
node release/cli.mjs peer-receipt --peer admin --repository mugak1/Dinify-Admin \
     --commit <sha> --repo-dir <clone>           # prints the receipt and its digest
node release/cli.mjs storage-reviewed            # checks the storage tripwire; --write re-affirms
```

### Approving a backend receipt

The backend is private, so its receipt is an OPERATOR receipt: produced by the existing
producer from an authenticated local clone at the exact merged commit, never typed and
never fetched by anything that runs repository code.

```bash
node release/cli.mjs peer-receipt --peer backend --repository mugak1/Dinify-Backend \
     --commit <full merged sha> --repo-dir <backend clone> --write
```

Then re-derive it independently (a second clone, a second implementation) and compare
digests before pinning `receiptDigest` in `policy.json`. Replace the approved entry
rather than adding beside it unless both revisions are genuinely live candidates —
every approved backend is checked for compatibility.

The receipt approved on 2026-09-23 for `366b7e457cfffa700663fc10983b0420e8882313`
(the #331 merge): digest `sha256:ee8d855f1e738ff00b99d2c9ea9b1120feb1d0faad70d3510bf89da95e9f7d63`,
tree `f129fe74…`, D01 export blob `1cb6a6db…` (unchanged from `9448f55`, digest
`sha256:1441d038…`), capability export blob `cc916050…` publishing
`checkout_protocol 3, quote_protocol 2, kitchen_protocol 1, quote_policy_version 1`.
The same digest was re-derived by a Python implementation over a fresh clone from
origin, and the four levels match the backend's source constants at that commit.

### The 2026-09-24 refresh (compatible set `2026-09-24-pilot-4`)

*History: its Admin approval was superseded on 2026-09-25 (next section); its backend
approval, `a6b25a6`, still stands.*

Both peers moved after `2026-09-23-pilot-3` was approved. Each new receipt was produced
by `peer-receipt` from the exact merged commit and re-derived by an independent Python
implementation over a fresh clone from origin that hashes the commit, tree and blob
objects itself; the digests agree.

| peer | commit | tree | source blob(s) | receipt digest |
|---|---|---|---|---|
| admin | `3521ebd05e5623878d262152bde11734b9cbd4fc` (#27) | `8a84439c…` | `deploy.yml` `0e210bf9…` | `sha256:e58f7ff5fdd0deb0b21d3b78f8b7fd55f2b56781210f8027a2f640b343debfb1` |
| backend | `a6b25a619d572c8de68964ab9ca4b4c2ae9ebe0b` (#338) | `d6d1f838…` | D01 `1cb6a6db…`, capabilities `cc916050…` | `sha256:c1355f5059f24506e9637ad29c24e4782a71275bfa5a0b18a80ed07cc5d3b920` |

- **Admin `38df037..3521ebd` is NOT copy-only.** #26 moved the SHA-pinned
  `aws-actions/configure-aws-credentials` from v6.2.4 (`cbe3b39…`) to v6.3.0
  (`e125382…`, which is what the upstream `v6.3.0` tag names); v6.3.0 adds one
  optional `translate-env-variables` input defaulting to the previous behaviour. That
  file is the receipt-bearing blob (`c1a5e7c…` → `0e210bf…`), and GitHub's contents
  API reports the same blob at `3521ebd`. #27 changed test-restaurant wording,
  comments and specs only — no request shape, badge or authentication change.
- **Backend `366b7e4..a6b25a6` (#332–#338) moved neither export**: both blobs are
  byte-identical, `manage.py export_checkout_limits_contract --check` and
  `export_published_capabilities --check` both exit 0 at `a6b25a6`, and the source
  constants behind the four levels are untouched in the interval. No migration is in
  it. The refresh therefore changes NO decision reason (the committed-policy suite
  pins that); `peers.backend_serving_unverified` stands, because a receipt is a
  statement about source.
- **Before/after, every other fact held fixed** (committed-policy suite, replaying the
  serving fact run `36018365996` logged): the previous set refuses exactly the seven
  reasons that run printed, byte for byte, and is not a wait; the refreshed set refuses
  the six recorded prerequisites and is a completed, non-publishing wait —
  `REFUSE`, `allow: false`, nothing published.

### The 2026-09-25 refresh (compatible set `2026-09-25-pilot-5`)

*History: its Admin approval was superseded on 2026-09-26 (next section); its backend
approval, `a6b25a6`, still stands.*

Admin #28 (the dependency audit inside `validate`) and #29 (npm report completeness)
merged and were deployed automatically. `ad4a7f8` (#28) served from about 11:40Z to
14:15Z; no frontend readiness run read the identity in that window. `1993a08` (#29)
finished deploying at 14:15:22Z (Deploy Admin run `36146112119`), and the frontend
readiness run `36146235129` (job `108107989904`, on `3a16e84`) read it three seconds
later. It refused `peers.admin_serving_unapproved` beside the six prerequisites
(`not-a-waiting-state`, `published: false`, the publish job skipped): the gate working.
Only the Admin approval moves; the backend stays `a6b25a6`.

| peer | commit | tree | source blob(s) | receipt digest |
|---|---|---|---|---|
| admin | `1993a087b2f2a37cbce8cf97c5c55c55b804e8ca` (#29) | `2efbbc92…` | `deploy.yml` `0e210bf9…` (unchanged) | `sha256:96df2207aa3cf5fd94b3c10946a543d950f18dd1db9a844669ca97ebc81e5538` |

- **The receipt was produced by `peer-receipt` at the exact merged commit** and
  re-derived by an independent Python implementation over a fresh clone from origin,
  which hashes the commit, tree and blob objects itself. The digests agree, and the
  same implementation reproduces the `3521ebd` digest (`e58f7ff5…`) as a control.
  GitHub's contents API reports the same `deploy.yml` blob at `1993a08`. The API
  re-derivation `peer-facts` performs at decision time needs `gh`, which the
  environment that produced the receipt did not have; CI's runners do, and the gate
  repeats it on every run.
- **Admin `3521ebd..1993a08` did not touch the receipt-bearing file**: `deploy.yml`
  is byte-identical (`0e210bf`), so the receipt differs only in its commit and tree.
  #28 added the dependency audit to `ci.yml`, rewrote the scheduled `audit.yml`, added
  three `package.json` scripts and moved five dev-only lock entries within range
  (`fast-uri`, `js-yaml`, `hono`, `qs`, karma's `body-parser`); #29 changed only the
  audit's report reader, its tests and docs. Neither touched `src/`, `angular.json` or
  a `tsconfig`.
- **Before/after, every other fact held fixed** (committed-policy suite, replaying the
  serving fact run `36146235129` logged): the 2026-09-24 set reproduces that run's
  decision as a whole value. Its digest is the `decisionDigest` the run's readiness
  record carries (`sha256:03c51055…`), so reason order and every detail agree, not
  only the codes. The refreshed set removes exactly `peers.admin_serving_unapproved`
  and refuses the six recorded prerequisites as a completed, non-publishing wait —
  `REFUSE`, `allow: false`, nothing published.
- **Nothing else moved**: `publication.readiness.awaiting` is unchanged and gains no
  `peers.*` entry, no owner prerequisite or bootstrap setting changed, and publication
  stays disabled.

### The 2026-09-26 refresh (compatible set `2026-09-26-pilot-6`)

*History: its Admin approval was superseded the same day by `a7ef20c` (next section);
its backend approval, `a6b25a6`, still stands. The bullets below describe the state when
it was committed.*

Admin #30 (D08 B2.3, the mock-isolation gate's qualification) merged as `eb54c92` and
was deployed automatically: Deploy Admin run `36196825836` finished promoting it at
22:29:00Z on 2026-09-25. **No frontend readiness run observed it.** The last one,
`36166963507` on `4ce0183`, completed at 17:25:35Z that day, before the deployment, and
its green result says nothing about `eb54c92`. The before/after below is therefore a
CONSTRUCTED replay, not a record of any run. Only the Admin approval moves; the backend
stays `a6b25a6`.

| peer | commit | tree | source blob(s) | receipt digest |
|---|---|---|---|---|
| admin | `eb54c92c6706093f09847315d83b344e46180770` (#30) | `f0229090…` | `deploy.yml` `0e210bf9…` (unchanged) | `sha256:ced2198497e23ac4aaa13d7947aae127973abfaded5b18a122ead014a5dc07f6` |

- **Source verification.** `peer-receipt` produced the receipt from a fresh clone at
  the exact merged commit, which is an ancestor of Admin `main`. An independent Python
  implementation re-derived it over a second, bare clone: it hashes the commit, the
  trees on the path and the blob itself, and computes the canonical digest. The digests
  agree, and the same implementation reproduces the `1993a08` digest (`96df2207…`) as a
  control. GitHub's contents API reports the same `deploy.yml` blob at `eb54c92`. This
  verifies the SOURCE of the approved revision. It says nothing about which revision is
  serving; the gate reads that at decision time.
- **Admin `1993a08..eb54c92` is #30 alone** (`d2a0f93`, plus `43bce6b`, the
  replacement-edge correction from review). It did not touch the receipt-bearing
  `deploy.yml` (blob `0e210bf` unchanged). It rewrote the mock-isolation gate as a
  production module-graph walk with output coverage and a self-test, added its
  qualification suite as a `ci.yml` step, a `package.json` script and `verify.sh`
  lines, and changed ONE comment in `src/app/dev/dev-tools.ts`. It did not touch
  `angular.json`, a `tsconfig`, the lock file or any other `src/` file.
- **Before/after, every other fact held fixed** (committed-policy suite). With Admin
  serving `eb54c92`, the 2026-09-25 set refuses seven reasons, including
  `peers.admin_serving_unapproved`, and is not a wait. The refreshed set removes exactly
  that reason. It refuses the six recorded conditions as a completed, non-publishing
  wait: `REFUSE`, `allow: false`, nothing published. A blocking or incomplete dependency
  assessment still refuses beside it, and is never a wait.
- **The committed-state tests default to the OBSERVED Admin revision, `a7ef20c`**, not
  the approved one. That suite claims to model what the next real run meets, so its
  headline refusal is seven reasons and not a wait. The six-reason wait is asserted
  under an explicitly CONSTRUCTED "Admin serves the approved revision" state.
- **Admin has ALREADY moved past it.** Admin #31 (D08 B2.4) merged as `a7ef20c` and was
  deployed (Deploy Admin run `36245215836`, finished 13:28:29Z on 2026-09-26). A public
  read of `https://admin.dinifyapp.com/release.txt` at 13:30:53Z returned `a7ef20c…`
  with `Cache-Control: no-store`. #31 rewrites the receipt-bearing `deploy.yml` (blob
  `0e210bf` → `3644dcd`) and adds the Admin `release/` certification path. It is **not
  approved here**: it needs its own review, and a receipt produced from that final
  merged source. Until that lands, the next readiness run is expected to refuse
  `peers.admin_serving_unapproved` for `a7ef20c`. That is the gate working, not a defect
  in this refresh, and a test pins it.
- **Nothing else moved**: `publication.readiness.awaiting` is unchanged and gains no
  `peers.*` entry. No owner prerequisite, bootstrap setting, enablement, audit policy or
  B2.2 evidence mechanism changed, and publication stays disabled.

### The second 2026-09-26 refresh (compatible set `2026-09-26-pilot-7`)

Admin #31 (D08 B2.4, certified promotion) merged as `a7ef20c` and was deployed
automatically. Deploy Admin run `36245215836` finished promoting it at 13:28:29Z; that is
a deployment record, not an origin read. The frontend readiness run `36247543634` (job
`108419421080`, on `485e9e9`, the merge of the `pilot-6` refresh) then read the identity
and logged `a7ef20c` serving at 14:10:16Z. `pilot-6` did not approve it, so that run
refused `peers.admin_serving_unapproved` beside the six prerequisites
(`not-a-waiting-state`, `published: false`, the publish job skipped): the gate working.
Public reads of `https://admin.dinifyapp.com/release.txt` from the environment that
produced this refresh returned `a7ef20c…` with `Cache-Control: no-store` at 14:13:12Z and
14:20:29Z. Only the Admin approval moves; the backend stays `a6b25a6` (Backend `main` is
`80b86e1`, and the approval was deliberately not moved to the tip).

| peer | commit | tree | source blob(s) | receipt digest |
|---|---|---|---|---|
| admin | `a7ef20c452062e95f24ecec2a506d27882db587b` (#31) | `a9f98461…` | `deploy.yml` `3644dcdb…` (changed) | `sha256:c21ad7c5142e05dcd7020545a3f71ee3e92e612f7a4499d7002c25abb16381e2` |

- **Source verification.** `peer-receipt` produced the receipt from a fresh clone at the
  exact merged commit, which is Admin `main`; `eb54c92` is its ancestor. The independent
  Python re-derivation, run over a second, bare clone, hashes the commit, the trees on
  the path and the blob itself, and computes the canonical digest. The digests agree,
  and the same implementation reproduces both retained digests as controls: `eb54c92`
  (`ced21984…`) and `1993a08` (`96df2207…`). GitHub's contents API reports the same
  `deploy.yml` blob at `a7ef20c`. This verifies the SOURCE of the approved revision, not
  what is serving; the gate reads serving at decision time.
- **Admin `eb54c92..a7ef20c` is #31 alone** (`a3c1f96`, `7a37ca1`, `85dd5fe`, `51c346a`,
  `f43fa12` and the merge), 30 files. **It rewrites the receipt-bearing `deploy.yml`**
  (blob `0e210bf` → `3644dcd`, about 1,240 lines changed). The workflow now promotes a
  candidate that `ci.yml`'s `validate` job certified (`release:prebuild` / `freeze` /
  `certify`, uploaded as `admin-candidate-<run>-<attempt>`), after a fresh dependency
  assessment and a re-decision in the credential-holding job, into host directories named
  `<sha>-<tree>`. A labelled legacy rollback path covers releases that predate the
  contract. It also SHA-pins `ci.yml`'s actions, adds the Admin `release/` tree (with an
  Admin-only `release/policy.json` that names no Frontend or Backend revision), a
  retained-evidence reader under `dependency-audit/`, `package.json` scripts, a
  `.gitignore` entry and docs. It changes no `src/` file, `angular.json`, `tsconfig` or
  the lock file.
- **What this gate relies on is intact.** Admin is identity-only here: the receipt binds
  `deploy.yml`, and the gate reads `/release.txt`. At `a7ef20c` the certified payload
  still carries `release.txt` as exactly `<commit>\n`. The deploy job still asserts, from
  the public origin after every promotion, that it holds exactly the requested SHA and is
  served `no-store`. Its forward-only guard still reads that same file. The
  credential-holding job runs no `npm` and checks out only the workflow's own `release/`
  and `dependency-audit/` trees at `github.sha`. `ci.yml` and `deploy.yml` pin every
  action by SHA, and no workflow references a stored secret. So `policy.json`'s three
  Admin assumptions and the `public-identity` serving contract are unchanged. (One
  observation outside the receipt: the scheduled `audit.yml`, which #31 did not touch and
  nothing consumes, still names `actions/checkout@v7` and `actions/setup-node@v7` by tag.)
- **Before/after, every other fact held fixed** (committed-policy suite, replaying the
  serving fact run `36247543634` logged). The `pilot-6` set reproduces that run's decision
  as a whole value: its digest is the `decisionDigest` the run's readiness record carries
  (`sha256:6aecf748…`), so reason order and every detail agree, not only the codes. The
  refreshed set removes exactly `peers.admin_serving_unapproved`. Through the real
  `decide` command it refuses the six recorded conditions as a completed, non-publishing
  wait: `REFUSE`, `allow: false`, nothing published. A blocking or incomplete dependency
  assessment still refuses beside it and is never a wait, and every superseded Admin
  revision (`eb54c92`, `1993a08`, `3521ebd`, `38df037`, the never-approved `ad4a7f8`) is
  refused as unapproved, so an Admin rollback to any of them turns the next readiness run
  red until it is approved again.
- **The committed-state tests now default to an OBSERVED revision that is also the
  approved one**, so their headline result is the six-reason wait rather than a
  seven-reason refusal. The `pilot-6` block keeps selecting its own set from retained
  receipts, as the older blocks do.
- **Nothing else moved**: `publication.readiness.awaiting` is unchanged and gains no
  `peers.*` entry. No owner prerequisite, bootstrap setting, enablement, audit policy or
  B2.2 evidence mechanism changed, and publication stays disabled.
- **The next Admin deployment will turn the next readiness run red again** until its own
  receipt is reviewed and approved from its final merged source. That is the ordered,
  manual coordination working, not a defect.

`lib/decide.mjs`, `lib/preflight.mjs` and `lib/outcome.mjs` are pure — no clock, no
filesystem, no network — which is what lets the refusal matrix run from fixtures. The
adapter and simulation suites then prove the CLI feeds them what the world says.
