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

### An off-hours Admin read says why it is red (2026-10-27)

The development server that Admin and the Backend share runs 11:00–23:00 Europe/London, on
the owner's AWS schedule. When readiness runs while it is off, Admin's `release.txt`
cannot be read and the decision refuses `peers.admin_serving_unreadable`. That is not a
waiting condition, so the run is red, correctly: nothing was observed. The red run did
not say why, so it read like an outage. The owner's decision of 26 October (CI-signal
design C, the variant that needs no new permission) is that readiness **stays red**, its
summary says that the schedule is the likely cause and how to recover, and **AWS is not
asked anything**.

`lib/off-hours.mjs` writes that explanation. It applies only to a `REFUSE` whose reasons
include `peers.admin_serving_unreadable`, and it reads the run's own decision time (the
`--now` the Decide step gives `decide`) on the London wall clock:

| decision time (London) | what is added |
|---|---|
| outside the window, or in its last 20 minutes | the note, first in the "Publication decision" section, and one `::warning::` annotation carrying the note's first line |
| inside the window | one short line: "The development server should be up now. Treat this as an outage and check Admin." No annotation |
| a time it cannot read | nothing |

Any other refusal gets nothing new. The note says that Admin's `release.txt` couldn't be
read, that the development server is *scheduled* off at that London time (window
11:00–23:00 London), so this is expected, and to re-run "Readiness evaluation" inside the
window ("Re-run all jobs" on this run, or a `workflow_dispatch`). It says "scheduled off",
never "the server is off": nothing here knows whether the instance is running.

**The window is written once**, as `DEV_SERVER_WINDOW` in `lib/off-hours.mjs`. It is a
copy, not the authority. It moves with the owner's AWS schedule and with the
`DEV_SERVER_WINDOW` and `DEV_SERVER_WINDOW_END_MARGIN_MINUTES` the two deploy workflows
carry (the `window` jobs of Admin #49 and Backend #371), so the three change together.
"Inside" is `[start, end − margin)` on the London minute: 11:00 is inside, 22:40 is the
first minute of the margin, and 23:00 is outside. That is the rule Admin `668b627`'s
`deploy.yml` states and applies (checked against its source). London time comes from the
IANA tz database that Node carries in ICU, so it is BST in summer and GMT in winter, never
a fixed offset. Both 2026 change days, 29 March and 25 October, are pinned with the start,
the margin and the end, including the cases a fixed offset would get wrong.

**Where it is rendered.** In `decide`'s summary, and the annotation on `decide`'s stderr,
because its stdout is `decision.json`. The runner turns a workflow command into an
annotation on either stream (actions/runner, `ScriptHandler.cs`, checked at `1ba885c`).
`publish.yml` is unchanged. No permission, secret, action or network call was added.

**What does not change: everything else.** The decision, its reasons, the readiness
classification, both exit statuses, the `decisionDigest` and every retained document are
byte-identical with the note removed. Two tests pin it, one at each level.
`off-hours-note.test.mjs` runs the Decide step's two commands against a copy of the gate's
code with the note removed, at three decision times. The workflow simulation runs
`publish.yml` twice in one world, the second time with the note removed in the gate's
workspace. Both also show that the runs differ in the note and the annotation and nowhere
else. For this change the same comparison was also measured against `e43c832`'s
unmodified CLI, and it matched byte for byte.

**What it cannot say.**

- Whether the server is running. The schedule is the likely cause, not an observation.
- When the read happened. The time is the *decision* time, a few minutes after the peers
  were read, because the toolchain is prepared and assessed in between. A read just before
  11:00 can therefore get the in-window line. So can a server still starting just after
  11:00, since the deploy jobs' window has no start margin either.
- Anything about a dispatched run. A `workflow_dispatch` is a manual attempt, so it stays
  red by design (`readiness.deliberate_attempt`); it still shows whether Admin can be read.
- Anything after 24 hours. "Re-run all jobs" re-evaluates the automatic run, but only
  within `certificationWindowHours` (24) of its Certify run. After that, the re-run is
  refused as `certification.stale`.

It changes `release/` (`cli.mjs`, the new `lib/off-hours.mjs`, tests and this file) and
not `publish.yml`, so it advances the verifier tree through `release/`. `policy.json`, the
awaiting list and every decision are unchanged.

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
  npm ci ─ snapshot ─ audit ────────────┐  the pinned scanner (npm 11.21.1, its own lock,
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
| dated obligation (A-2) | the deferred finding's `deadline` (blocks from 00:00 UTC that day) | GitHub's date for the advisory, retained | gate, preflight, last boundary |

The record's `expiresAt` is the earliest of the four; each is refused under its own
name (an overdue obligation is `<boundary>.obligation_overdue`), so a lapsed assessment is
never reported as a stale certification.

### Who enforces what

| consumer | refuses |
|---|---|
| `stamp` (certify) | an audit that is not within policy after the build; any dependency input that moved between the audit and the stamp — the build's own output is re-inventoried, so no stale evidence is attached |
| `assess` (gate) | writes NOTHING and exits 2 — *not performed* — for an old candidate, unusable evidence or no prepared toolchain; exit 1 blocking, exit 2 incomplete |
| `decide` (gate) | `dependency.*`: evidence missing, unsupported (pre-B2.2), invalid, unreproducible, wrong commit/tree/lock/manifest/environment/configuration/run/attempt/candidate, not passing; assessment missing, invalid, not this run's, wrong candidate/graph/scanner/tooling, policy mismatch, out of order, stale, blocking, incomplete, unretained; toolchain missing, invalid, unreviewed, mismatched, unretained |
| `preflight` (publish) | `preflight.assessment_not_current`, `assessment_replaced`, `tooling_replaced`, `tooling_mismatch`, `runtime_mismatch`, `assessment_mismatch`, `assessment_stale`, `exception_expired` — from its OWN downloads and the run's listing now; a moved `release/` or `dependency-audit/` tree on main is `preflight.policy_advanced` |
| `publish` (last boundary) | `publisher.tooling_mismatch`, `runtime_mismatch`, `assessment_mismatch`, `assessment_stale`, `exception_expired`, `certification_stale` — **before** the credential is read; the outcome is then `PREFLIGHT_REFUSED`, never `PUBLICATION_FAILED`, because no tool ran |
| `readiness` | nothing here is ever a wait: every `dependency.*` code beside the recorded wait stays red, and a policy listing one does not validate |

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

### CI-signal A-2: provenance and the clock at promotion

A-1 taught the shared evaluator to defer an INHERITED high tooling finding for seven days
from the day its advisory became reportable; A-2 supplies those two facts
(`dependency-audit/README.md` → "Provenance and the clock"). Here is what changes on the
release path, and what deliberately does not.

**Certification (`certify.yml`).** The audit runs with `--base` set to
`github.event.before`, the previous tip of main, and the job token as `GH_TOKEN`. The
workflow's permissions are unchanged (`contents: read`), and the advisory endpoint is
public. When the audit asked GitHub anything, `stamp` retains its `advisories.json` in the
candidate's evidence bundle (`dependency-evidence/audit/advisories.json`), named by the
retained collection's digest, and the gate re-derives the retained result with those
dates (`evidence.advisories_invalid` if the record does not reproduce). The provenance a
re-derivation can establish is against the candidate's OWN retained locks, and only for
the graphs the collection gave a base: inside fixed bytes everything is inherited, so a
re-derived certification reaches the same outcome and counts as the original.

**The fresh assessment (`publish.yml`, gate).** `assess` gives the APPLICATION and SCANNER
graphs provenance against the candidate's retained locks: the application lock is the
candidate's own, and the scanner graph is compared with the candidate's retained scanner
lock, so a trusted scanner that moved since certification makes what changed
`introduced`, which blocks. **The publisher graph is never given provenance**: a high
there blocks whatever GitHub says, it is never asked about, and an assessment that
claims otherwise is refused (`assessment.publisher_provenance`). The assessment asks
GitHub WITHOUT a token (the publish workflow gives this step none), so an unanswered or
rate-limited request leaves no date and the inherited high blocks. The answers are
retained beside the assessment as `advisories.json` and named by it.

**The re-decisions never ask.** `decide`, the preflight and the last boundary read the
assessment back through `inspectAssessment`, which re-reads the retained
`advisories.json` and refuses a date the record does not support
(`assessment.date_unsupported`), a deadline the rule does not grant or a deferral count
that does not add up (`assessment.deferral_unsupported`), and a tampered or unnamed
record (`assessment.advisories_invalid`, `assessment.unexpected_file`); any of those
reaches the decision as `dependency.assessment_invalid`. **One clock**: a deferred
finding's deadline is part of `expiresAt`, so it cuts the promotion window short exactly
as an applied exception's expiry does, and from 00:00 UTC on it every boundary refuses
`<boundary>.obligation_overdue`.

**Unchanged.** Critical, any runtime finding, an introduced tooling high and an inherited
high past its deadline all block, in CI and at promotion. Records apply first. A candidate
certified before A-2 carries no `advisories.json` and re-derives exactly as before. The
weekly `audit.yml` passes no base. `deploy-prod.yml`, still the live writer, consumes none
of this.

Pinned by `release/tests/obligations.test.mjs` (assessment inside the window, past the
deadline, critical, a 403, the scanner graph inherited, the publisher graph never asked,
the forged re-reads, `decide()` at each side of the deadline, a certification bundle
carrying an obligation) and by two executed `publish.yml` scenarios in
`workflow-simulation.test.mjs` (reviewed two days ago: published; eight days ago:
`dependency.assessment_blocking`).

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

### The publisher's `chokidar` override (2026-10-03)

Readiness runs `37137245529` (on `e553faf`) and `37205168076` (on `63d6166`) each
completed a fresh dependency assessment that was BLOCKING (`dependency.assessment_blocking`:
18 findings, 1 blocking, 5 under approved exception, 12 requiring triage). That is what
those CI runs establish. Their retained assessment bytes could not be inspected from the
environment that prepared this change. The blocking finding was identified by a LOCAL
REPRODUCTION of the same assessment, which reproduced the runs' headline exactly. It used
the trusted `prepare-publisher` command (pinned npm, lifecycle scripts disabled), the same
three graphs and the committed policy. The finding is `publisher:node_modules/braces`
3.0.3, GHSA-vfj7-8cjw-p6xm (high). That is a reproduction, not a reading of CI's retained
record.

- **Why not an exception.** The record grammar (Known limits, above) cannot name a
  publisher path. This change leaves that alone: it adds no publisher exception, widens no
  grammar, downgrades no finding and relaxes no gate. The five existing exceptions and
  their 2026-10-30 expiry are unchanged.
- **Why an override.** No fixed `braces` is published: the advisory covers `<=3.0.3`, and
  3.0.3 is the latest release. Every `firebase-tools` 15.x through 15.32.1 declares
  `chokidar ^3.6.0`. In this graph the only path to `braces` is
  `firebase-tools → chokidar 3.6.0 → braces`, and `chokidar` 4.0.3 does not depend on
  `braces`.
- **What changed.** `release/publisher/package.json` gains `"chokidar": "4.0.3"` in its
  `overrides`. In the lock, `chokidar` moves 3.6.0 → 4.0.3 and `readdirp` 3.6.0 → 4.1.2,
  and twelve entries are removed: `anymatch`, `binary-extensions`, `braces`,
  `fill-range`, `fsevents`, `glob-parent`, `is-binary-path`, `is-extglob`, `is-glob`,
  `is-number`, `picomatch` and `to-regex-range`. `firebase-tools` stays 15.31.0, and no
  other entry moves.
- **IT IS OUTSIDE FIREBASE'S DECLARED RANGE.** `firebase-tools` declares
  `chokidar ^3.6.0`, and 4.x dropped glob support. Compatibility is claimed only for
  Dinify's existing restricted static-hosting publisher: `deploy --only
  hosting:<target> --project <project> --non-interactive --json`, run with the
  configuration `lib/publisher.mjs` builds. **Emulator use with this toolchain is
  unsupported.**
  - Source trace in 15.31.0: `chokidar` is required only by the emulator modules
    (`emulator/{firestore,database,functions}Emulator.js`,
    `emulator/storage/rules/manager.js`). Nothing under `deploy/` calls it.
  - The deploy command's static require graph still reaches one of them
    (`commands/deploy.js → deploy/index.js → … → emulator/functionsEmulator.js`, which
    requires `chokidar` at top level). Treat `chokidar` as loaded when the publisher runs.
  - This is a source trace, not an execution.
  - Any change to the invocation, to the configuration it is handed or to the
    `firebase-tools` version requires this compatibility to be reassessed.
- **SUCCESSFUL AUTHENTICATED UPLOAD REMAINS UNVERIFIED.** What was verified when this
  change was prepared:
  - the exact lock delta;
  - the trusted `prepare-publisher`, with lifecycle scripts disabled;
  - a local fresh assessment of the three graphs, which answered `exceptions_only` (17
    findings, 0 blocking);
  - the release suite.

  None of it is evidence of a hosting upload. Pre-authentication behaviour would not be
  either.

  `firebase deploy --dry-run` is NOT a substitute: it skips upload and release but still
  runs preparation, which can create a hosting version. It neither proves upload
  compatibility nor is guaranteed to be read-only. Any real publication rehearsal is a
  separate, explicitly authorized task before activation, and nothing here performs one.
- **Removing it.** Remove the override only when the resulting native dependency graph
  (without it) is verified free of this blocker AND compatible with the supported
  invocation, for example a `firebase-tools` whose declared `chokidar` no longer pulls
  `braces`, or a fixed `braces`. Removing it is then a reviewed lock change like this one.
- **Changing the lock advances the verifier.** A run admitted under the previous lock is
  refused as `preflight.policy_advanced`, and readiness still has to complete a fresh
  assessment on its own.

### `@modelcontextprotocol/sdk` 1.31.0 in both graphs (2026-10-08)

CI run `37607215661` (job `112745524107`) failed `audit:deps` on GHSA-6qxp-vccf-f47h (high;
affected `>=1.12.0 <1.31.0`, patched 1.31.0): the root lock carried the SDK at 1.30.0
under `firebase-tools` 15.28.2. The publisher lock carried 1.30.1 under 15.31.0. Both
`firebase-tools` versions declare `^1.24.0`, so the fix is **lock-only**.

- **What changed.** In each lock exactly one entry moves, the SDK, to 1.31.0 (version,
  `resolved`, and the registry's own `integrity`). 1.31.0 declares the same dependency and
  peer ranges as 1.30.x, so nothing else in either closure moves. No manifest, override,
  `firebase-tools` version or audit record changed.
- **Applicability.** The advisory concerns the SDK's OAuth CLIENT (`authProvider`,
  `withOAuth()`, `auth()`, `fetchToken()`), and its consumer caveats (`expectedIssuer`,
  re-binding or clearing previously stored credentials) apply to code that uses it.
  `firebase-tools` 15.28.2 and 15.31.0 import only the SDK's SERVER modules
  (`server/index`, `server/stdio`, `server/sse`, `types`), and only when `argv[2]` is
  `mcp` or `experimental:mcp`. Nothing in either imports a `client/` module. Loading the
  supported deploy module graph from the prepared toolchain loads no SDK file at all. So
  no consumer authentication change applies to this use, and no credential was inspected,
  cleared or rotated. That is a source trace plus a module-loading probe, not an
  execution of a deploy.
- **What was verified locally** (Node 24.21.0, scanner npm 11.19.1, credential-free, run
  ids `424242`/`1` are local stand-ins, not CI provenance):
  - the trusted `prepare-publisher` (lifecycle scripts disabled): 660 locked, 660
    installed. The prepared tree differs from the previous lock's only in the SDK package;
  - `hosting-oracle.test.mjs` run against the PREPARED publisher tree instead of the root
    install, with outbound connections refused: 20/20;
  - a fresh `assess` of the three graphs: `exceptions_only`, 21 findings, 0 blocking, 5
    under the existing exceptions, 16 requiring triage (the publisher's one is
    `@opentelemetry/core`). The same assessment with the previous publisher lock is
    `blocking` on this advisory.
- **Not verified.** Successful authenticated upload, as before. No deploy or `--dry-run`
  was run.
- **Changing the lock advances the verifier**, exactly as for the `chokidar` override.

### `@modelcontextprotocol/sdk` 1.32.1 in the publisher graph (2026-10-23)

Readiness run `39847908896` (on `738d04b`) refused with `dependency.assessment_blocking`.
Its fresh assessment reported two HIGH advisories on
`publisher:node_modules/@modelcontextprotocol/sdk` 1.31.0 that no record covers:
GHSA-22jm-h49p-29qw (`>=1.24.0 <1.32.0`) and GHSA-46jr-4wx8-v453 (`>=1.3.0 <1.32.0`).
The same node also carried two moderate ones that end below 1.32.0, GHSA-6prh-2h8m-c8cw
and GHSA-rvq5-wwqv-78pq. The application lock had already moved to 1.32.1 on 2026-10-21,
and that repair left the publisher lock alone. A publisher-graph finding cannot be
covered by a record (Known limits), so the publisher lock itself has to move.

- **What changed.** In `release/publisher/package-lock.json` exactly one entry moves:
  the SDK goes to 1.32.1 (version, `resolved` and the registry's own `integrity`).
  `firebase-tools` 15.31.0 declares `^1.24.0`, so this is lock-only. The change was
  produced by the pinned scanner npm 11.19.1 under Node 24.21.0, with
  `npm update @modelcontextprotocol/sdk --package-lock-only --ignore-scripts`.
  - 1.32.1 declares the same dependency, peer and engine ranges as 1.31.0, so nothing
    else in the closure moves.
  - No manifest, override, `firebase-tools` version, root or scanner lock, or audit
    record changed.
  - 1.32.1 differs from 1.32.0 only in its `version` field and README, so the fixed code
    is the same.
- **Applicability.** `firebase-tools` 15.31.0 requires the SDK only from `lib/mcp/`,
  which is reached only when `argv[2]` is `mcp` or `experimental:mcp`. It uses
  `Server`, `StdioServerTransport`, `SSEServerTransport` and schema constants from
  `types.js`.
  - All of these are still exported by 1.32.1, and the exports map is unchanged.
  - It configures no task store, so the advisories' task-handling paths are not reached.
  - The supported invocation, `deploy --only hosting:<target>`, does not reach the SDK.
  - This is a source trace, not an execution.
- **What was verified locally.** Node 24.21.0, scanner npm 11.19.1, credential-free.
  Every graph was freshly installed with lifecycle scripts disabled; tests ran with
  outbound connections refused; registry access was limited to `registry.npmjs.org`.
  - **The trusted `prepare-publisher`:** 660 locked, 660 installed, 0 absent optional.
    The prepared tree differs from the previous lock's only in the SDK package and the
    two lockfile copies (104 files, none added or removed).
  - **Base-lock reproduction:** preparing the previous lock reproduced the publisher
    tree digest that readiness run recorded.
  - **`hosting-oracle.test.mjs` run against the PREPARED publisher tree:** 20/20, with
    firebase-tools 15.31.0 and superstatic 10.0.0 resolved inside it.
  - **A local three-graph assessment.** It composed the repository's `inventory`,
    `collect` and `evaluate`; it is not a promotion `assess`. Result: `exceptions_only`,
    25 findings, 0 blocking, 5 under the existing exceptions, and 20 requiring triage.
    The publisher's three are `@opentelemetry/core`, `hono` and `ip-address`. The SDK
    node has none.
  - **The same assessment with the previous publisher lock** is `blocking` on the two
    advisories above, reproducing the readiness refusal.
- **The oracle's version line, fixed in the same change.** Since B2.2 moved the pin from
  `hosting.firebaseToolsVersion` to `publisher.version`, the oracle's RECORD diagnostic
  had printed `publisher pin undefined`. It now reads `publisher.version` and asserts
  its shape, so a future move of the pin fails the test.
  - Against the prepared publisher tree it prints `installed firebase-tools 15.31.0;
    publisher pin 15.31.0`.
  - Against the root devDependency, as CI runs it, it reports the 15.28.2 / 15.31.0
    mismatch, which is real.
- **Not verified.** Successful authenticated upload, as before. No deploy or `--dry-run`
  was run.
- **Changing the lock advances the verifier**, exactly as for the `chokidar` override. A
  run admitted under the previous lock is refused as `preflight.policy_advanced`.
  Readiness still has to complete a fresh assessment of its own. A dependency assessment
  with no blocker does not clear the release prerequisites the policy still records as
  pending.

### Scanner diagnostics: the last observed npm events

Readiness run `36283185235` (job `108518857938`) went red because the fresh assessment's
APPLICATION scan reached the policy's `timeoutSeconds` (300) and was killed. What it kept
was an empty stdout, an empty stderr and a SIGTERM: npm writes its record of what it was
doing to a debug log, and nothing kept that log. **The cause of that run is unknown and
stays unknown.** This change does not diagnose it, does not fix it, and changes no
timeout, retry, cache, registry or classification. It makes the NEXT such run leave
evidence: a bounded, sanitized projection of the scanner's own log, per graph.

**How it is captured.** `collect()` (`dependency-audit/lib/retained.mjs`), when given a
`diagnostics` root, passes npm ONE extra flag, `--logs-dir=<directory>`; the scanner, its
version, the registry, every other argument, the timeout, the environment scrub and the
cache are exactly what they were. The directory is created fresh (`mkdtemp`) per
invocation under a root `assess` makes for itself in the OS temp directory, outside the
candidate, the replay, the scanner, the publisher tree and the output, and removed
however the run ends. It is ABSOLUTE on purpose: npm resolves `--logs-dir` against the
scan's own cwd, and the workflow passes `--out` relative. A root that is relative, a
link, missing, or inside or around anything scanned or uploaded is refused before npm is
given any flag at all.

**What is kept.** After the scan, exactly one regular file named as npm names its logs is
read — only its last 2 MiB, whatever its size — and re-rendered through an allowlist of
npm's event shapes into `<graph>.npm-diagnostics.txt` beside the raw outputs, at most
1 MiB, oldest events dropped first. It is not the raw log, and its first line says so
(`SANITIZED npm events, NOT a complete raw log`): argv, config, cwd, paths, stack traces,
credentials in URLs, query strings, unusual URL paths, markup and control characters do
not survive, and the file is printable ASCII by construction. Before writing, the
producer checks its own bytes against the format's grammar (below) and keeps nothing it
would not accept (`capture_failed`). `~/.npm/_logs` is never read, a log this invocation
did not ask for is never read, and nothing the invocation did not create is removed.

**What the record says.** Each graph gains an OPTIONAL `diagnostics` key:

- `{state: 'retained', file, sha256, bytes, truncated}` — the graph-bound file name,
  the digest and length of the bytes written, and whether anything was left out (the
  head of an over-window log, or events dropped to fit);
- `{state: 'unavailable', reason}` — one of `unsafe_location`, `setup_failed`, `no_log`,
  `multiple_logs`, `unsafe_entry`, `unreadable`, `write_failed`, `capture_failed`.

**It never changes a verdict.** A scan killed at the limit is `scanner_timeout` →
INCOMPLETE → exit 2 → readiness red with `allow: false`, whether the diagnostic was kept
or not; an unavailable diagnostic adds no problem and removes none. `continue-on-error`
and every workflow file are unchanged.

**The receiving side.** An assessment WITHOUT the key is one made before this change and
stays valid. PRESENT, `validateAssessment` holds it to its exact shape
(`assessment.bad_diagnostics`), and `inspectAssessment` requires the declared file to
exist (`assessment.diagnostics_missing`), to match its length and digest
(`assessment.diagnostics_mismatch`) and to be a diagnostic in the sanitized format
(`assessment.diagnostics_unsafe`); an undeclared file is still `assessment.unexpected_file`.
**Printable is not sanitized**: a raw npm line such as `9 verbose argv "--token=…"` is
printable ASCII too, and the first cut accepted it (Codex P2 on #709, valid). The format
is therefore checked line by line against ONE grammar, `checkDiagnosticProjection` in
`dependency-audit/lib/retained.mjs`: the five header lines exactly (the graph named must
be the descriptor's, and the stated counts must agree with the events), then only event
lines in exactly the shapes the renderer writes, every URL in `safeUrl`'s output form. The
truncation the bytes state must equal the descriptor's (`assessment.diagnostics_mismatch`).
It checks shape, not meaning: text that fits an allowed field (a registry host, a timing
name) is not detectable by a grammar; the producer fills those fields only from the
matching fields of npm's own event lines.
Bytes changed after admission are caught by the admitted identity the publisher already
compares — the document digest and the tree digest — as `publisher.assessment_mismatch`,
even when the descriptor is rewritten to match.

**How it is read.** For each graph whose scan did not complete, `assess` prints (job log
and summary, every line escaped) the **last observed npm events** and the requests the log
shows as STARTED with no logged completion before it ends: a packument fetch with neither
a completion nor a cache hit, and the bulk advisory POST with no completion. That wording
is the whole contract. npm logs a request's `http fetch` line when its response body ENDS
(`npm-registry-fetch`'s `check-response.js`; for an error status, when the status
arrives), not when it starts; several can be outstanding at once; a request can still be
waiting on a lock, a socket or a retry; and the last line in the file is not evidence of
which request, if any, stalled. Reading that source also corrected the reader: a bulk POST
whose completion IS logged is no longer listed as started-without-completion merely
because the log ends before the `audit report` line. Review on #709 found the other two
corrections in this section: the receiving grammar (above), and that the byte budget was
measured against a header stating `kept 0` while the written header states the real
counts — up to a few digits wider — so a cap landing in that gap discarded the whole
diagnostic as `capture_failed` instead of truncating it. The written bytes are now
re-measured and further oldest events dropped until they fit.

**Shared with Admin.** This extension was introduced here as frontend-only. Dinify-Admin
now carries the same `dependency-audit/lib/retained.mjs` and `tests/retained.test.mjs`
(mugak1/Dinify-Admin#36), wired into its own fresh assessment and receiving checks. The
module's three comments that said "frontend-only" were made repository-neutral in both
repositories, so the two files are byte-identical (`83df67e2…be37`, which Admin's tests
pin).

#### Measured: the real pinned scanner, locally

A bounded, credential-free probe on 2026-09-27 ran THIS `collect()` with the real npm
11.19.1 (`npm-cli.js` `8e5f6f34…ebe7`, installed from `dependency-audit/scanner`'s lock
`a5603833…6c72`) on Node v24.21.0 (the official linux-x64 tarball, its SHASUMS256 entry
`fd8e59d5…d2b6` verified) against a disposable stub registry on `127.0.0.1`: a two-package
retained replay (`alpha@1.0.0`, `beta@1.0.0`), the policy's minimum `timeoutSeconds` (30),
an environment of `PATH`, `HOME` (empty scratch) and `LANG` only — no proxy, no npmrc.
The argv was the gate's own, plus `--logs-dir=<absolute>`.

| stub behaviour | run | kept | read back |
|---|---|---|---|
| everything answered (CONTROL) | exit 1 (2 synthetic advisories), 0.4 s | retained, 1,071 B | nothing started without a completion |
| bulk POST answered, `GET /beta` never answered | SIGTERM at 30.0 s, `scanner_timeout` | retained, 981 B | `GET …/beta` started, no completion; the completed `GET …/alpha` is not listed |
| bulk POST never answered | SIGTERM at 30.0 s, `scanner_timeout` | retained, 679 B | the bulk POST started, no completion |

In all three the replay's two files were byte-identical before and after, npm wrote no
log under `HOME/.npm/_logs` (it still made its cache under `HOME/.npm`, as it always
does — the cache is not this change's), the owned log directory was gone afterwards, and
the kept bytes matched their descriptor and were printable ASCII.

**The probe found a defect the fixtures could not.** npm logs an object through
`util.inspect`, so a SMALL bulk request is ONE line (`silly audit bulk request { alpha:
[ '1.0.0' ], … }`) and an empty report is `{}`. The first cut recognised only the
multi-line opening `{`, and the POST-stall probe therefore kept no bulk-request event at
all. The allowlist now accepts all three shapes (never their contents), a regression test
pins the real lines, and the table above is the re-run.

**What the probe does not show.** It is a loopback stub, not `registry.npmjs.org`: no TLS,
no proxy, no DNS, no real advisory data, a two-package graph where the real application
graph is ~1,274 packages, one run per mode, and a stall made by never answering. npm's own
`fetch-timeout` (5 minutes) and retry path were not reached, because the 30-second limit
fired first; production's limit is 300 seconds. It shows that the flag produces a usable
kept diagnostic when the scanner is killed at these two points — not what happened in run
`36283185235`.

#### Mutations

Each rule reverted alone on the final code, run against the suites that own it, then
restored byte for byte (digest checked). The count is failing tests.

| mutation | fails |
|---|---|
| retention disabled (every scan `unavailable`) | 23 `retained`, 20 `dependency-evidence`, the workflow CONTROL |
| receiving integrity bypassed (a declared file accepted unchecked) | 14 `dependency-evidence` (missing, length, digest, grammar, truncation); the after-admission case still refuses, through the admitted identity |
| the receiver back to header-and-printable only (the Codex finding) | 10 `dependency-evidence` (every grammar regression and the truncation contradiction) |
| the producer writes without checking its own bytes | none — defence in depth: it can only refuse what a renderer defect produced, and the row below is that case |
| unmatched lines kept raw | 8 `retained`: the producer's check refuses its own output (`capture_failed`), so nothing raw is written and every scenario expecting a kept diagnostic fails |
| the written header not re-measured (the Claude review finding) | 1 `retained` (the cap sweep) |
| a kept diagnostic softens a timeout | 1 `retained`, 3 `dependency-evidence` (the CLI hang, its summary, the recovery control), the workflow's real hang |
| a relative root accepted | 1 `retained` |
| the one-line bulk request and `{}` report not recognised (the probe's defect) | 1 `retained` (the real line shapes) |
| a logged bulk POST completion not clearing its marker | 1 `retained` |

### The scanner moves to npm 11.21.1 (2026-10-23)

`dependency-audit/scanner` now pins npm **11.21.1** (published 2026-10-15; a minor release
in the 11 line with the same `engines`), and `policy.json → scanner.version` moves with it.
Four of the five exception records, all due to lapse at 00:00 UTC on 2026-10-30, were on
the SCANNER graph, and a bundled dependency cannot be replaced through the scanner lock or
`overrides`. So the only route was an official npm release whose distributed tarball
bundles fixed copies. 11.19.1, 11.20.0 and 11.21.0 do not; 11.21.1 is the first that does.
12.x is a major and was not considered.

**What was checked, against the tarball and not the registry's declarations.** The
tarball's sha512 and sha1 match the packument, both registry signatures verify, and every
`inBundle` entry in the new lock matches the version extracted from the tarball. The lock
was produced by the pinned scanner with scripts disabled
(`npm install npm@11.21.1 --save-exact --ignore-scripts`). Its diff is the `npm` entry and
the twelve bundled versions that moved: `@npmcli/arborist` 9.9.1 → 9.9.3,
`@npmcli/config` 10.12.0 → 10.14.0, five `libnpm*`, `ip-address` 10.5.0 → 10.7.2,
`postcss-selector-parser` 7.1.4 → 7.1.6, and the three below. Arborist's
`audit-report.js` and `vuln.js` and npm's `lib/commands/audit.js` are byte-identical between
the two releases, so the report shape `npm.mjs` reads is unchanged.

| record | bundled in 11.21.1 | disposition |
|---|---|---|
| `scanner-undici-GHSA-rfgv-xxqx-mfg5` | `undici` 6.29.0 (patched 6.28.1) | removed — fixed: the handshake now guards an absent requested-protocol list |
| `scanner-brace-expansion-GHSA-qhr7-859c-m2p7` | `brace-expansion` 5.0.12 (patched 5.0.11) | removed — fixed: nesting depth is bounded (`EXPANSION_MAX_DEPTH`) |
| `scanner-brace-expansion-GHSA-6j4f-fj2g-mc7p` | `brace-expansion` 5.0.12 (patched 5.0.10) | removed — fixed: `parseCommaParts` is iterative |
| `scanner-http-cache-semantics-GHSA-ch52-4w7c-c8xp` | `http-cache-semantics` 4.3.0 | removed as STALE, **not remediated** (below) |
| `application-braces-GHSA-vfj7-8cjw-p6xm` | n/a (application graph) | removed as STALE, **not remediated**: the advisory was WITHDRAWN on 2026-10-23 (below) |

**`http-cache-semantics` 4.3.0 is outside the advisory's recorded range, and it is not a
fix.** GHSA-ch52-4w7c-c8xp is recorded as `<=4.2.0` with no patched version. The max-stale
handling it describes (`satisfiesWithoutRevalidation`, `maxAge`, `storable`, the
constructor) is byte-identical between 4.2.0 and 4.3.0, which changes only Vary matching and
exposes the response status. The upstream maintainer closed the report as not a
vulnerability and the advisory is disputed. The scanner no longer reports the finding, so the
record matches nothing and the evaluator would refuse it; it cannot stay. The applicability
accepted on 2026-10-03 still holds, because npm builds its cache policies with
`shared: false`. If the advisory range is later widened to cover 4.3.0, the scanner graph
blocks again with no record.

**`braces`: no compatible fix existed, and then the advisory was withdrawn.** The
advisory listed no patched version and 3.0.3 is still the latest release. karma 6.4.4 (the
latest, a direct dependency on braces), micromatch 4.0.8 (the latest) and chokidar 3.6.0
(the latest 3.x, under tailwindcss 3.4.19 and firebase-tools) all still require braces 3.
So the record was first kept, due to lapse at 00:00 UTC on 2026-10-30. **GitHub withdrew
GHSA-vfj7-8cjw-p6xm the same day**, stating that it is "not a practically exploitable
vulnerability", and npm's bulk advisory endpoint stopped returning it: it was still
reported for `braces` 3.0.3 at about 13:00Z and was gone by 15:20Z. The only `braces`
advisory npm now returns is GHSA-grv7-fg5c-xmjg (`<3.0.3`), which 3.0.3 is outside. The
record then matched nothing, the evaluator refused it as stale, and the audit was
**blocking**. So it is removed too, in its own commit. That is not a remediation:
`braces` 3.0.3 is unchanged. If the advisory is reinstated, the audit blocks again with no
record. The refusal is not confined to this change. `main` (`a40d169`, scanned at 15:23Z
from its own locks) is blocking on the same stale record, while its four scanner records
still apply under npm 11.19.1. The publisher lock's `chokidar` 4.0.3 override was
introduced to remove this `braces` finding from the publisher graph. Whether it is still
needed is a publisher decision, and nothing here changes it.

**Measured locally on 2026-10-23** (Node 24.21.0, credential-free, a network namespace
whose only route out allowed `registry.npmjs.org`), through the unchanged `lib/audit.mjs`:
- Before the withdrawal, on `0a30d72`: **exceptions only**. There were 10 findings: 1
  under the braces exception and 9 lower-severity tooling findings requiring triage (eight
  application, plus `ip-address` 10.7.2 GHSA-rxp7-6hxx-x8q5 in the scanner graph), and
  nothing blocking, refused or unresolved.
- After it, on `2d6130c`'s tree with the braces record removed (the tree later committed as
  `08a0a7f`, the first commit whose policy has no records): **within policy**, with the
  same 9 tooling findings requiring triage and nothing blocking, excepted, refused or
  unresolved.

The scanner graph went from 13 findings (four high, all excepted) to that one moderate. The
application graph is unchanged: its lock, manifest and installed-tree digests are those of
the 738d04b certification snapshot.

**Consequences.**
- `dependency-audit/` is part of the trusted verifier, so a run admitted under the previous
  scanner or policy is refused as `preflight.policy_advanced`.
- `prepare-publisher` installs the publisher lock with the scanner's npm, so the prepared
  publisher tree is now produced by npm 11.21.1. That tree has not been re-prepared or
  re-assessed by this change.
- Two test pins moved with it, in their own owner-approved commit (`87e4bf9`). The
  release suite's fixture scanner (`release/tests/fake-npm.mjs`, `FIXTURE_SCANNER_VERSION`)
  now reads 11.21.1; with the old value every fixture assessment was refused as
  `scanner_pin`. The committed-policy CONTRACT in `dependency-audit/tests/audit.test.mjs`
  now expects an empty record set, and pins the five former subjects as open and blocking
  if any is reported again. The publisher toolchain's `braces` still blocks and still
  cannot be given a record. Measured offline on `87e4bf9`, with the same Node and
  containment: `test:audit` 194/194 and `test:release` 1399/1399. A fresh audit of that
  commit was within policy, with the same 9 tooling findings requiring triage.

No exception was added or extended, no record remains, no evaluator rule moved, and the
application and publisher locks are untouched. A clean or exceptions-only audit is not
readiness and authorizes no publication.

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
| backend (`0513adb`) | **operator receipt**: the repository is private, so the receipt is produced by an operator from the backend's git and reviewed as a file. No backend credential is given to anything that runs repository code, and no public endpoint was added. | **unavailable** until a verified loaded-runtime identity of the backend is available (B3): its source now carries an identity endpoint and a staged installer, but neither serves yet. Refused as `peers.backend_serving_unverified`; an operator statement is not accepted as serving evidence. |
| admin (`a42a056`) | **public-repository receipt**, re-derived at decision time through the API (tree and `deploy.yml` blob). Identity only: this application holds no Admin protocol, and the receipt's `assumptions` say why. | `https://admin.dinifyapp.com/release.txt`, required `no-store` and in the approved set. Re-read inside the publisher's critical section. |

**Cross-repository changes remain an ordered, manual sequence.** This gate is the only
path that consults `compatibleSet`; the backend's own deploy and `deploy-prod.yml` make
no compatibility decision. What this makes true is narrow: on THIS path, a candidate
paired with an unapproved or incompatible peer revision is refused. It does not make a
one-sided change unreleasable — the other side's own deploy can still ship it — so the
order is: merge the peer, produce a receipt from its git at the merged commit, approve
that receipt here in a reviewed pull request. Two consequences of the committed state:

- the approved backend revision is `0513adb` (the #350 merge), which REPLACED `a6b25a6`
  (the #338 merge) on 2026-09-28. `366b7e4` (the #331 merge, the first carrying
  `orders_app/contracts/published_capabilities.contract.json`) REPLACED `9448f55` (the
  #330 merge) on 2026-09-23, and was itself replaced by `a6b25a6` on 2026-09-24. Each
  was replaced rather than joined, because every approved backend is checked for
  compatibility and an export-less revision left in the list would refuse
  `peers.capabilities_unpublished` for ever. The three earlier receipts stay under
  `peers/` as history and are no longer approved; the committed-policy suite selects them
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
  `36146235129` (on `3a16e84`) refused the same way for `1993a08`; on 2026-09-26
  readiness run `36247543634` (on `485e9e9`) refused the same way for `a7ef20c`, and
  readiness run `36273728448` (on `44c4fc3`) for `9ec02fe`. On 2026-09-27 readiness runs
  `36337180856`, `36338571396` and `36339569844` refused the same way for `3170e8f`, and
  run `36342248520` (on `ba8e4eb`) for `9cf8c83`. On 2026-10-01 readiness run
  `36881809186` (on `1527c6b`) refused the same way for `042e803`, and runs
  `36919953847` (on `229c0b1`) and `36936713667` (on `73ec2d8`) for `89d2cf1`. On
  2026-10-09 readiness run `37864171285` (on `aa0b958`) refused the same way for
  `1fa89cb`, and on 2026-10-13 run `38386816091` (on `386c432`) did again. On
  2026-10-15 readiness run `38763144686` (on `5015b33`) refused the same way for
  `033c49a`, and on 2026-10-24 run `40128009591` (on `a0786ca`) for `a42a056`. The
  approved Admin revision is now `a42a056` (the #48 merge, approved 2026-10-25), replacing
  `033c49a`, which had replaced `1fa89cb`, which had replaced `89d2cf1`, which had replaced `94001b7`, which had replaced `9cf8c83`, `9ec02fe`, `abdacda`, `a7ef20c`, `eb54c92`,
  `1993a08`, `3521ebd` and `38df037` in turn, rather than joining them. An Admin rollback
  to any of those, or to `ad4a7f8` (the #28 merge), `3170e8f` (the #35 merge), `8b7895b`
  (the #37 merge), `042e803` (the #40 merge), `15eac1b` (the #42 merge) or `85947ca`
  (the #43 merge), all deployed and never approved, is refused the same way until
  approved again (see the four 2026-09-26 sections and the 2026-09-27, 2026-09-28,
  2026-10-03, 2026-10-13, 2026-10-15 and 2026-10-25 ones). The #44 PR head `9337f55`
  carries the same tree as `033c49a` and is a different commit, and the #48 PR head
  `da64573` likewise carries `a42a056`'s tree: neither is approved, and nor are the
  intermediate merges `e864c82` (#45), `ed6430d` (#46) and `c88a75b` (#47).

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
cannot publish at all. It was a named prerequisite until R-1 recorded it verified on
2026-10-15 (below, "Firebase retention (R-1)"), which is a statement about one observed
setting, not proof that a recovery would succeed. This path does not depend on it.

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
| ~~`prerequisite.retention_unverified`~~ | **resolved by R-1 (2026-10-15)**: `prerequisites.retention.status` is `verified` and the entry left `publication.readiness.awaiting` in the same change. The rule is unchanged, so an `unverified` status is still refused. See "Firebase retention (R-1)" below for what "verified" does and does not mean |
| `prerequisite.legacy_publisher_active` | the cutover change setting `prerequisites.singlePublisher` |
| `prerequisite.legacy_publisher_present` | the same change **deleting** `deploy-prod.yml` — this one is observed from the checkout, so the policy cannot claim it |
| `peers.backend_serving_unverified` | B3: a verified loaded-runtime identity of the backend |
| `served.bootstrap_unauthorized` | an explicit, reviewed `bootstrap.authorized: true` with `servedBaseline` naming the live commit. That commit must carry a valid storage declaration, one that states where its bytes are (physical key and encoding) — i.e. be at or after the merge that introduced them. The live path publishes every merge, so by the time a bootstrap is authorized the live commit will be |

### What has been observed about source protection (SP-1)

`prerequisites.sourceProtection.observation` records how `main` was protected when it
was read on 2026-10-15, and what that reading cannot establish. **The status stays
`unrecorded`**, so `prerequisite.source_protection_unrecorded` stands and the awaiting
list is unchanged: moving the status to `recorded` or `limitation-disclosed` is the
owner's reviewed decision, and this record is the evidence that decision would read.
`decide` reads only `status`; a test holds the decision byte-identical with and without
the observation under identical peer facts. That test is a **synthetic** invariant over
the fixture candidate; it says nothing about what a real readiness run will meet.

What was read, with read-only REST GETs from an integration token (no push, force-push,
deletion or merge probe was attempted):

- **One repository ruleset**, `main protection` (id `15107355`), enforcement `active`,
  targeting `refs/heads/main` only: `non_fast_forward` (no force-push), `deletion`, a
  required status check `validate` from GitHub Actions in strict mode, a pull request
  with **zero** required approving reviews, and an advisory Copilot review.
- **Classic branch protection is not enabled**; its endpoint answered 403 to the
  reading token.
- **Limitations, recorded beside the rules:** a single read that the gate does not
  repeat; configured rather than demonstrated enforcement; bypass actors reported empty
  to a non-admin identity, which does not establish there are none; `certify.yml` and
  readiness are not merge preconditions; no independent human review is required; other
  branches are unprotected.

The response digests in the record are of the bodies actually received and depend on
the reading identity. A re-read replaces the date and every digest together, or drops
the digests; the validator refuses a digest that is not in `sha256:` form and a date that
is not a real calendar day (`2026-13-01`, `2026-00-01` and `2026-02-29` are each one
named problem, `policy.bad_source_protection_observation`, never an exception).

### Firebase retention (R-1)

Since 2026-10-15 `prerequisites.retention.status` is `verified`, and
`prerequisite.retention_unverified` left `publication.readiness.awaiting` in the same
change. **"Verified" means one narrow thing here**: the owner-reported, read-only
observation below was reviewed and accepted as sufficient for this prerequisite. It does
not mean retention is unlimited, it is not a guarantee about future retention, and it does
not prove that a rollback or recovery would succeed. A rollback on this path still does not
depend on it, because it republishes the target's certified artifact.

What was observed:

- **Target.** Project `dinify-dev`, site `dinify-prod`, channel `live`, read with
  `sites.channels.get` (`GET …/v1beta1/sites/dinify-prod/channels/live`). The returned
  channel name was `sites/dinify-prod/channels/live`, matching the request.
- **`retainedReleaseCount`** was present, a JSON integer, exactly **`2147483647`**. It is
  preserved as returned, not clamped and not replaced by a documented default. Firebase's
  published Channel schema gives this field a range of 1–100, and what a larger returned
  value means is unresolved. **It is not read here as "unlimited"** or as any other
  sentinel.
- **Current release** `sites/dinify-prod/channels/live/releases/1792085434503000`,
  released `2026-10-15T17:30:34.503Z`, serving version
  `sites/dinify-prod/versions/08e3899b86390bea`.
- **History.** A `sites.channels.releases.list` request with a page size of 5 returned five
  releases: the current one and four previous ones, all dated 2026-10-15 (14:47Z to
  17:30Z). Their versions were reported FINALIZED, with none reported DELETED or EXPIRED on
  the inspected page. A further page existed and was not read, so nothing is said about
  older releases.
- **Corroboration.** A separate read-only lookup from the owner's own local Claude Code
  session, through the Firebase plugin, was relayed as a summary: the same
  `retainedReleaseCount` and the same current release. It corroborates the owner-relayed
  evidence. Its raw execution was not independently reviewed.

How it was obtained, and its limits:

- **Owner-executed, not reviewer-executed.** The owner ran both reads in their own Google
  Cloud Shell, with their own account, and pasted the output into the reviewing session,
  which transcribed it and itself made no Firebase request. The plugin result arrived as a
  summary. None of it is independent reviewer execution.
- **No numeric HTTP status and no exact execution time were captured.** The requests used
  `curl -s` without printing the status. The bodies were a channel resource and a release
  list, not error objects. The owner ran the channel read between about 18:50Z and 19:00Z
  on 2026-10-15. The reviewing session received the channel response at about 19:00:06Z,
  the history list at about 19:03:40Z and the plugin summary at about 19:28:09Z.
- **An earlier "still unknown" was superseded, not contradicted.** The reviewing session
  first found no usable access route and sent no request, so the value was unknown at that
  point. The owner's read then observed it. The owner's first attempt, made before they
  signed in, was rejected 401 `CREDENTIALS_MISSING`. That is a missing-credential
  rejection, not a permission finding.
- **The quota header proves nothing about ownership.** The request carried
  `x-goog-user-project: dinify-dev`, which selects the quota project.
- **No payload was verified and no rollback was attempted.** A version reported FINALIZED
  is not evidence that it is the right recovery target, or that restoring it would work.
- **One dated observation.** The gate does not re-read it, and the setting can change
  without this file changing.
- **Not committed:** the raw report, account identities, authentication history and
  credentials. The decision reads `status` alone; the `_note` beside it points here.

What R-1 does not do: it does not close D08, authorize the bootstrap or the cutover, set
`FRONTEND_PUBLISH_ENABLED`, activate the staged publisher or move any other prerequisite.
The compatible set stays `2026-10-15-pilot-15`, and the receipts, source protection, backend
serving, single-publisher, bootstrap, enablement, dependency and freshness settings are
unchanged. With other facts unchanged, the committed decision is still `REFUSE`,
`allow: false`, for exactly five reasons, and an automatic evaluation with publication
disabled is still the recorded non-publishing wait (`published: false`):

- `peers.backend_serving_unverified`
- `prerequisite.source_protection_unrecorded`
- `prerequisite.legacy_publisher_active`
- `prerequisite.legacy_publisher_present`
- `served.bootstrap_unauthorized`

Its decision digest over the fixture inputs is `sha256:8ecab1b2…` (`R1_WAIT_DIGEST_SYNTHETIC`
in `committed-policy.test.mjs`). That is **synthetic** until a readiness run records it, and
a real run reaches it only if its fresh assessment and peer reads succeed and every other
fact is unchanged. Every earlier set, pilot-15 before R-1 included, is replayed under a
test-local pre-retention snapshot (`preRetentionPolicy()`: status `unverified`, the
original six-entry list). So every decision digest CI recorded still reproduces byte for
byte, the six-reason `sha256:79ff3fea…` among them.

The committed-policy suite went from 87 to **95** tests, readiness from 56 to **58** and
the workflow simulation from 66 to **67** (release suite 1388 → 1399). Against the
unmodified policy, 6 of the 8 new committed-policy tests fail and its 2 controls pass.
Two disposable policy mutations were each caught: putting the retention entry back while
the status stays `verified` fails 53 tests across the three files, and restoring
`unverified` while keeping the five-entry list fails 29.

`peers.capabilities_unpublished` was the seventh until the 2026-09-23 follow-up approved
the receipt for backend `366b7e4`; it reappears — and is not an expected wait — if an
export-less backend is ever approved again.

`peers.backend_serving_unverified` has no owner action available today: it needs B3.
Until then this path cannot publish, and says so, rather than accepting an operator's
word for which backend is live.

### The 2026-10-27 source-protection record

On 2026-10-27 the owner decided to record source protection. `prerequisites.sourceProtection.status`
moved from `unrecorded` to `recorded`, and `prerequisite.source_protection_unrecorded` left
`publication.readiness.awaiting` in the same change, as the procedure above requires. The
observation was re-read first and refreshed, and its limitations were kept.

**This section supersedes four statements elsewhere in this file, which this change leaves
unedited:**

- the table row above, which lists `prerequisite.source_protection_unrecorded` as outstanding;
- "The status stays `unrecorded`" under SP-1;
- the five-reason committed decision described under R-1;
- "the repository is private" / "The backend is private" in the peer table and in "Approving a
  backend receipt".

**What was observed** (measured, 2026-10-27 between 12:28:40Z and 12:28:41Z):

- **The reads.** Read-only REST GETs of `/repos/mugak1/Dinify-Frontend/rulesets`,
  `/rulesets/15107355`, `/rules/branches/main`, `/branches/main` and
  `/branches/main/protection`. No write, push, force-push, merge or enforcement probe was
  attempted.
- **The reading identity.** The reader sent no token of its own. The session's egress proxy
  authenticated the requests with an integration credential: the responses reported
  `X-RateLimit-Limit: 15000`, empty `X-OAuth-Scopes`, and `current_user_can_bypass: "never"`.
  It was **not** an anonymous read.
- **The same two bodies.** `GET …/rulesets/15107355` hashed to `sha256:5c9fbd71…d250` and
  `GET …/rules/branches/main` to `sha256:56cdcfdb…6dff`. Both are **byte-identical** to the
  2026-10-15 digests, so `observedOn` moved and the two digests were replaced with the same
  values.
- **The ruleset.** `main protection` (`15107355`), `active`, `refs/heads/main` only,
  `updated_at` `2026-06-08T18:38:14.709+01:00` (unchanged). Its rules are unchanged:
  - `non_fast_forward` and `deletion`;
  - required check `validate` (integration 15368), strict;
  - a pull request with 0 required approvals;
  - Copilot review on push;
  - bypass actors reported empty.
- **Two parameters newly transcribed.** `required_reviewers: []` and
  `require_extra_approval_for_unattributed_changes: true` are now in the record. The
  2026-10-15 body carried both too, since its digest is identical; that record did not
  transcribe them. So it is a transcription gap, not a field GitHub newly reports (that
  inference, made before this re-read, is not supported). What the second parameter requires,
  and its effect beside 0 required approvals, were not established; a limitation says so.
- **Classic branch protection.** Not enabled. `/branches/main/protection` answered 404
  "Branch not protected", where the 2026-10-15 identity got 403. `/rules/branches/main`
  attributes every rule to `15107355`.

**What "recorded" means, and does not mean.** It means the owner reviewed this observation and
accepted it as the record of how `main` is protected: CONFIGURED AS GITHUB REPORTED IT. It does
not mean enforcement was demonstrated: no push, force-push, deletion or failed merge was
attempted. It is not re-read by the gate, and the owner can change the ruleset at any time
without this file changing. All eight limitations in the observation still apply. Among them:

- the empty bypass list is not established for an owner-visible identity;
- no approving review is required, so an author can merge their own pull request once
  `validate` passes;
- `certify.yml` and readiness are not merge preconditions;
- other branches are unprotected.

**The other two repositories** (measured the same day; they are not part of this record, which
is about the Frontend's certified branch, and the gate reads nothing about them):

- Dinify-Backend has ruleset `15107238` `main protection`: active on `refs/heads/main`,
  required check `test` (strict), a pull request with 0 approvals, `non_fast_forward`,
  `deletion`. It was created 2026-04-15 and updated 2026-06-08.
- Dinify-Admin has ruleset `21088287` `main protection`: active on the default branch,
  required check `validate` (strict), a pull request with 0 approvals. It was created
  2026-08-20.

Neither was created after 2026-10-15, by their own timestamps.

**Backend visibility.** Dinify-Backend is public (measured: `private: false`), and the owner
confirmed on 2026-10-27 that this was deliberate. The backend peer's `_receiptVerification`
note said the repository was private, and it is corrected. Its `receiptVerification` value stays
`operator`: receipts are still produced by an operator from the backend's git and reviewed as a
file. Re-deriving them from the public API at decision time is a possible later change; it is
not made here, because it would change the gate's behaviour.

**The decision.** With other facts unchanged, the committed decision is still `REFUSE`,
`allow: false`, now for exactly four reasons, and an automatic evaluation with publication
disabled is still the recorded non-publishing wait (`PENDING_PREREQUISITES`, `published: false`):

- `peers.backend_serving_unverified`
- `prerequisite.legacy_publisher_active`
- `prerequisite.legacy_publisher_present`
- `served.bootstrap_unauthorized`

It was constructed with the real `decide`, `readiness` and `outcome` commands. The inputs were:

- the committed policy;
- REAL peer facts from `peer-facts`, run on 2026-10-27: Admin `668b627` verified by public
  re-derivation and served `no-store`;
- a served state DERIVED from the committed `firebase.json` rewrite, because this
  environment's egress refuses `dinify-prod.web.app`;
- the FIXTURE candidate and passing assessment the committed-policy suite uses.

Its decision digest is `sha256:01536d3a…5972` (`SP_WAIT_DIGEST_SYNTHETIC` in
`committed-policy.test.mjs`). It is **synthetic** until a readiness run records it, and a real
run reaches it only if its fresh assessment and peer reads succeed and every other fact is
unchanged. The same inputs under the previous policy give the five-reason
`sha256:8ecab1b2…7677` that `history.json` already holds for R-1.

**`history.json` is not part of this change.** The record moved the owner state under the
unchanged set id `2026-10-26-pilot-17`. Its row in the history still lists only `R-1`.
`committed-policy.test.mjs` therefore models the record test-locally, the way R-1 was modelled
before the history became data:

- every owner state the file records predates the record, so a replay restores `unrecorded`;
- the last row gains a test-local state after R-1, carrying the synthetic four-reason
  decision;
- every decision digest the history records still reproduces byte for byte;
- a test pins that the file does not yet carry the record.

When `history.json` next changes, the record belongs there as an owner state of its own, and
the overlay should go. Until then, a refresh row appended under `R-1` alone replays as before
the record, and the contract that the last row IS the committed policy fails loudly instead of
silently.

**Tests.** The release suite went from 1444 to **1457**: eleven tests in a new committed-policy
block, plus the generic replay and owner-state-transition tests the overlay adds for the last
row. Tests that pinned the five-reason committed state now pin four, or ask about the R-1 state
explicitly. Seven disposable mutations were each caught across the committed-policy, readiness
and policy suites (274 tests):

| mutation | failures |
|---|---|
| status back to `unrecorded` | 26 |
| the entry reinserted | 45 |
| the previous `policy.json` | 23 |
| the old backend note | 1 |
| the new limitation dropped | 1 |
| `receiptVerification` set to `public-repository` | 83 |
| the overlay removed | 61 |

**What it does not do.** It does not close D08, authorize the bootstrap or the cutover, set
`FRONTEND_PUBLISH_ENABLED`, or move any other prerequisite. The compatible set and its id, the
receipts, `history.json`, retention, backend serving, single-publisher and bootstrap are
unchanged. It changes no ruleset or repository setting.

It does change `release/`, so like any policy change it **advances the verifier tree**: a run
whose gate evaluated the previous policy is refused at the publisher as
`preflight.policy_advanced`, and the merge's own readiness run evaluates the new one.

**The record is now in `history.json`** (a follow-up the same day, which removes the overlay).
`source-protection-recorded` is an owner state of its own: R-1's overrides, with the status
`recorded` and the one wait removed. It follows R-1 in `2026-10-26-pilot-17`'s `ownerStates`.
A state's overrides are applied over the committed policy, so `before-R-1` and `R-1` now state
`unrecorded` themselves, which the overlay used to add for them; their replays are
byte-identical. Two readiness runs recorded what were computed waits. Both digests were read
from the runs' own readiness records (the Decide step's job log), and both equal the computed
values, so each entry moved to `recorded` with its run:

- run `40497635180` on `7cf5b45`, under R-1: `sha256:8ecab1b2…7677`, previously `constructed`;
- run `40510386279` on `532f68e`, under the record: `sha256:01536d3a…5972`, previously
  `synthetic`.

The test that pinned the record's absence now pins its presence, and the record's block reads
the row the record landed in rather than the last row. So **the next refresh is the three-file
procedure again** ("Refreshing the compatible set", below). `policy.json` and `release/lib/`
are unchanged, so no decision moves. The verifier tree advances, through `history.json`, the
committed-policy test and this file.

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

`npm run test:release` runs the CLI self-test, then 807 tests in about 110 seconds
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
| `dependency-evidence.test.mjs` | 80 | B2.2 through the real CLI: the stamp binding and its refusals (a mid-build input change, a blocking certification audit, a genuine pre-B2.2 stamp), `prepare-publisher` (pinned npm, scripts disabled, measured, unsafe entries refused), `assess` (three graphs, scan-only replay, trusted policy, blocking/incomplete/not performed) and the `publish` last boundary; the scanner diagnostics as evidence (a relative `--out`, every single-fact refusal, bytes changed after admission) and a real 30-second hang through the CLI |
| `readiness.test.mjs` | 56 | the recorded wait against every way a refusal can differ from it, and the real `readiness` and `outcome` commands through files |
| `workflow-simulation.test.mjs` | 66 | `publish.yml` EXECUTED: real scripts, real CLI, real git checkouts, local HTTPS origins and an observable stand-in publisher — including the non-publishing evaluation matrix, both outcome steps and the publisher/credential counts, an assessment with and without scanner diagnostics, and a real 30-second application hang |
| `workflow-drift.test.mjs` | 27 | the three workflow files held to the policy, statically — the publish job keyed on the admitted decision, the readiness wrapper translating one status |
| `committed-policy.test.mjs` | 134 | the committed policy's exact refusal set, through the real `decide`; the approved receipts; the readiness list equal to that set; every compatible set in `peers/history.json` replayed through the rule (each pinned decision digest, each refresh's before/after with every other fact held fixed, every unapproved Admin revision refused) and the last row equal to the committed policy |

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
- **B3** — a verified loaded-runtime identity for the backend. Until it exists this path
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

### Refreshing the compatible set: a receipt, the policy, one history row

Since 2026-10-26 the compatible-set history is DATA. `peers/history.json` has one row per
compatible set, from `pilot-2` (the first that approved a revision). Each row records what
the set approved, the facts of each receipt it approved first, the backend serving note
and owner-prerequisite state its decisions printed, what its refresh moved and removed, the
revisions reviewed with it but never approved, and every decision pinned under it. Each
decision carries its digest and its evidence: `recorded` (a readiness run bound it),
`constructed` or `synthetic` (computed from the rule). `committed-policy.test.mjs`
generates its tests from the rows: it replays every pinned decision, compares each refresh
before and after with every other fact held fixed, refuses every Admin revision a set does
not approve under that set's id, and requires the last row to equal the committed policy.
The per-refresh sections below were written when each set was a hand-written block of that
file; the blocks they mention are rows now.

A refresh changes three files and needs no test edit:

1. **The receipt.** `peer-receipt --write` at the exact merged commit (as above for the
   backend; `--peer admin --repository mugak1/Dinify-Admin` for Admin), re-derived
   independently before its digest is pinned.
2. **`policy.json`.** The next `compatibleSet.id`, the approval REPLACED (commit, receipt
   path, `receiptDigest`), never joined, and `_approvedHistory` extended.
3. **One row in `peers/history.json`**, appended last:
   - `approved` (both peers), and `receipts` with the new revision's digest, tree and
     sources exactly as its file states them;
   - `backendServingReason` and `ownerStates` (the previous row's, unless they moved);
   - `moved` and `removes` (normally `["peers.admin_serving_unapproved"]`), and
     `notApproved` (the PR head, with its tree, and any intermediate merges);
   - `refused`: the decision the readiness run gave under the previous set. Record the
     Admin revision it saw serving, the `unexpected` reasons, the run's `decisionDigest`
     from its readiness record, `evidence: "recorded"` and the run id. If the run's fresh
     assessment did not pass, record it under `assessments` and name it in the decision;
   - `decisions`: this set's wait under each owner state, plus one decision for each
     assessment named in `refused`. The wait names no Admin commit, so its digest is
     normally the previous row's;
   - `adminServingObserved`: the revision the next run is expected to meet, and how it was
     observed.

Then review the Admin interval: what moved, the receipt-bearing `deploy.yml` blob, whether
the merge's tree equals the PR head's, and `id-token` in any new workflow. Record that
review in its own section below and in `_approvedHistory`, and run `npm run test:release`.
To pin a constructed digest, run the suite: the failing replay prints the digest the rule
computes. **A recorded digest is never replaced by a computed one.** If a recorded digest
does not reproduce, that is a finding to report, not a value to update.
`journey-observation.test.mjs` reads the approved set, both approved revisions and the
backend each one replaced from the history's last row, so it moves with a refresh and needs
no edit either (since 2026-10-26).

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
approval, `a6b25a6`, stood until 2026-09-28 (`0513adb`, `pilot-12`).*

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
approval, `a6b25a6`, stood until 2026-09-28 (`0513adb`, `pilot-12`).*

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
its backend approval, `a6b25a6`, stood until 2026-09-28 (`0513adb`, `pilot-12`). The bullets below describe the state when
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

*History: its Admin approval was superseded the same day by `abdacda` (next section);
its backend approval, `a6b25a6`, stood until 2026-09-28 (`0513adb`, `pilot-12`). The bullets below describe the state when
it was committed.*

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

### The third 2026-09-26 refresh (compatible set `2026-09-26-pilot-8`)

*History: its Admin approval was superseded the same day by `9ec02fe` (next section);
its backend approval, `a6b25a6`, stood until 2026-09-28 (`0513adb`, `pilot-12`). The bullets below describe the state when
it was committed. After it merged, two readiness runs did observe `abdacda`: `36270515216`
(on `9a11385`, its own merge) and `36272139246` (on `349e97b`, the #706 merge). Each
retained a `peers.json` stating Admin serving `abdacda`, verified and `no-store`, and each
completed as the six-reason wait (`awaiting-prerequisites`, `published: false`,
`decisionDigest` `sha256:604dcb5e…`). The "no frontend readiness run has observed it"
below was true when written and is not true now.*

Admin #32 merged as `abdacda` at 18:59:38Z (parent `a7ef20c`, implementation head
`7156067`) and was deployed automatically: the Admin `validate` run `36264479698` and
Deploy Admin run `36264601950` (finished 19:02:54Z) both concluded `success`. Those are
GitHub run conclusions, not origin reads. A public read of
`https://admin.dinifyapp.com/release.txt` from the environment that produced this
refresh returned `abdacda…` with `Cache-Control: no-store` at 20:20:27Z, and the real
`peer-facts` command read the same. **No frontend readiness run has observed it.** The
last one, `36249940983` on `9d30ccb`, finished at 14:52:29Z, before #32 merged; its green
result was about `a7ef20c` and says nothing about `abdacda`. So the before/after below
is a CONSTRUCTED replay, not a record of any run, and no later red run is claimed. Only
the Admin approval moves; the backend stays `a6b25a6` (Backend `main` is `9a6a7e8`, and
the approval was deliberately not moved to the tip).

| peer | commit | tree | source blob(s) | receipt digest |
|---|---|---|---|---|
| admin | `abdacda44d8a8f4694880e1e3435743615a27a20` (#32) | `f063b6da…` | `deploy.yml` `3644dcdb…` (unchanged) | `sha256:18b256ce34bf5adef1143fd84450221187920de682f1ba1a7cd1ed8a3fb1e142` |

- **Source verification.** `peer-receipt` produced the receipt from a fresh clone at the
  exact merged commit, which is Admin `main`; `a7ef20c` is its first parent. The
  independent Python re-derivation, over a second, bare clone, computes the commit's
  tree, the `deploy.yml` blob and the canonical digest; the digests agree, and the same
  implementation reproduces the retained `a7ef20c` (`c21ad7c5…`) and `eb54c92`
  (`ced21984…`) digests as controls. The existing public verification path —
  `peer-facts`, whose GitHub API reads were served here by an unauthenticated stand-in
  for the `gh` binary this environment lacks — answered `verified` for `abdacda` (tree
  and `deploy.yml` blob). This verifies the SOURCE of the approved revision, not what is
  serving; the gate reads serving at decision time.
- **Admin `a7ef20c..abdacda` is #32 alone** (`7156067` and the merge), and it changes
  exactly two files: `CLAUDE.md` and `release/README.md`. It records #31's first live
  certified forward promotion and names the live paths that have still not run
  (certified rollback, reuse of an installed directory, the `AUTO-SKIP-*` decisions, the
  host refusing a lapsed deadline or a payload mismatch, the DEGRADED outcome, a legacy
  rollback under the B2.4 procedure). No application source, dependency, lock file,
  verifier, workflow or Angular configuration changed, and the receipt-bearing
  `deploy.yml` is byte-identical (blob `3644dcd`), so the receipt differs from
  `a7ef20c`'s only in its commit and tree.
- **What this gate relies on is unchanged.** At `abdacda`, `deploy.yml` still asserts
  from the public origin after every promotion that `/release.txt` holds exactly the
  requested SHA and is served `no-store`, and its forward-only guard reads the same file.
  `policy.json`'s three Admin assumptions and the `public-identity` serving contract are
  unchanged.
- **Before/after, every other fact held fixed** (committed-policy suite). With Admin
  serving `abdacda`, the `pilot-7` set refuses seven reasons, including
  `peers.admin_serving_unapproved`, and is not a wait. The refreshed set removes exactly
  that reason. Through the real `decide` command it refuses the six recorded conditions
  as a completed, non-publishing wait: `REFUSE`, `allow: false`, nothing published. A
  blocking or incomplete dependency assessment still refuses beside it and is never a
  wait, broken Admin evidence (a malformed, mismatched or wrong-revision receipt, an
  unavailable or disagreeing public re-derivation, an unreadable or cacheable served
  identity) still refuses and is never a wait, and every superseded Admin revision
  (`a7ef20c`, `eb54c92`, `1993a08`, `3521ebd`, `38df037`, the never-approved `ad4a7f8`)
  and any later unknown one is refused as unapproved. The `pilot-7` block now selects its
  own set from retained receipts, as the older blocks do.
- **Nothing else moved**: `publication.readiness.awaiting` is unchanged and gains no
  `peers.*` or `dependency.*` entry. No owner prerequisite, bootstrap setting,
  enablement, audit policy, B2.2 evidence mechanism or backend selection changed, and
  publication stays disabled.
- **The next Admin deployment will turn the next readiness run red again** until its own
  receipt is reviewed and approved from its final merged source.

### The fourth 2026-09-26 refresh (compatible set `2026-09-26-pilot-9`)

*History: its Admin approval was superseded on 2026-09-27 by `9cf8c83` (next section);
its backend approval, `a6b25a6`, stood until 2026-09-28 (`0513adb`, `pilot-12`). The bullets below describe the state when
it was committed.*

Admin #33 merged as `5dab122` at 21:24:12Z and #34 as `9ec02fe` at 21:35:44Z (parents
`5dab122` and `d88d32e`), and `9ec02fe` was deployed automatically: Deploy Admin run
`36273633936` finished promoting it at 21:40:17Z. That is a deployment record, not an
origin read. The frontend readiness run `36273728448` (job `108492367222`, on `44c4fc3`,
the #707 merge) then read the identity and logged `9ec02fe` serving. `pilot-8` did not
approve it, so that run refused `peers.admin_serving_unapproved` beside the six
prerequisites (`not-a-waiting-state`, `published: false`, the publish job skipped): the
gate working, OBSERVED rather than constructed. Public reads of
`https://admin.dinifyapp.com/release.txt` from the environment that produced this
refresh returned `9ec02fe…` with `Cache-Control: no-store` at 23:58:21Z and 23:59:14Z,
the second through the real `peer-facts` command. Only the Admin approval moves; the
backend stays `a6b25a6` (Backend `main` is `7e16d4b`, and the approval was deliberately
not moved to the tip).

| peer | commit | tree | source blob(s) | receipt digest |
|---|---|---|---|---|
| admin | `9ec02fed9b6ab061879d838511214e907b7269ed` (#33/#34) | `7f27fdd3…` | `deploy.yml` `2618d1ee…` (changed, comment only) | `sha256:f396dc77139cc1a6dc2247f8ed40c4ec07fd86532e881c50b0575c33bf37cce7` |

- **Source verification.** `peer-receipt` produced the receipt from a fresh clone at the
  exact merged commit, which is Admin `main`; `abdacda` is its ancestor. The independent
  Python re-derivation, over a second, bare clone, computes the commit's tree, the
  `deploy.yml` blob and the canonical digest; the digests agree, and the same
  implementation reproduces the retained `abdacda` (`18b256ce…`) and `a7ef20c`
  (`c21ad7c5…`) digests as controls. The existing public verification path —
  `peer-facts`, through the same unauthenticated stand-in for the `gh` binary — answered
  `verified` for `9ec02fe` (tree and `deploy.yml` blob). The blob was re-derived at the
  commit, not copied from the `abdacda` receipt. This verifies the SOURCE of the approved
  revision, not what is serving; the gate reads serving at decision time.
- **Admin `abdacda..9ec02fe` is #33 and #34** (`3017e4d`, `923f671`, `5dab122`,
  `df284de`, `d88d32e` and the merge), eight files. It adds two workflows:
  - `claude.yml`, run on a human `@claude` mention in an issue, a comment or a review,
    with `contents: write`, `pull-requests: write`, `issues: write` and
    `actions: read`;
  - `claude-code-review.yml`, run when a same-repository, human-authored pull request
    is opened or marked ready, with `contents: read`, `pull-requests: write` and
    `issues: read`.

  **Neither grants `id-token`.** Both pin `actions/checkout` and
  `anthropics/claude-code-action` by SHA, pass `github.token`, and read the one stored
  secret, `CLAUDE_CODE_OAUTH_TOKEN`. The interval also vendors a review plugin under
  `.claude/review-marketplace/` and updates `CLAUDE.md`. According to the review
  workflow's own comment, the action replaces `.claude/` with the base branch's copy
  before installing plugins; that is the workflow's statement, not something verified
  here, and it does not cover a pull request that edits the workflow itself. **The receipt-bearing `deploy.yml` changed by a header
  COMMENT only** (blob `3644dcd` → `2618d1e`): the sentence that said no workflow
  references `secrets.` now scopes that to the deploy, CI and audit workflows and names
  the Claude secret. No step, job, permission, trigger or pin in `deploy.yml` moved, and
  its `deploy` job is still the only job in the repository granted `id-token: write`. No
  `src/` file, `package.json`, lock file, `release/`, `dependency-audit/`, `scripts/`,
  `ci.yml` or `audit.yml` changed. This is a review of what this gate relies on, not a
  security certification of the Claude integration.
- **What this gate relies on is unchanged.** At `9ec02fe`, `deploy.yml` still promotes
  only a certified candidate. It still asserts from the public origin after every
  promotion that `/release.txt` holds exactly the requested SHA and is served
  `no-store`, and its forward-only guard reads the same file. Deployment stays OIDC-only,
  with no stored deploy credential, and Admin remains its own origin. `policy.json`'s
  three Admin assumptions and the `public-identity` serving contract are unchanged.
  (Still outside the receipt: the scheduled `audit.yml` names `actions/checkout@v7` and
  `actions/setup-node@v7` by tag.)
- **Before/after, every other fact held fixed** (committed-policy suite, replaying the
  serving fact run `36273728448` logged). The `pilot-8` set reproduces that run's decision
  as a whole value: its digest is the `decisionDigest` the run's readiness record carries
  (`sha256:f945b541…`). The refreshed set removes exactly `peers.admin_serving_unapproved`.
  Through the real `decide` command it refuses the six recorded conditions as a
  completed, non-publishing wait: `REFUSE`, `allow: false`, nothing published. Its
  decision digests to `sha256:604dcb5e…`, the very decision runs `36270515216` and
  `36272139246` recorded as the wait under `pilot-8`, so the refresh restores that
  decision rather than producing a new or wider one. The following still refuse, and none
  of them is a wait:
  - a blocking or incomplete dependency assessment;
  - broken Admin evidence: an edited tree or blob, the pre-#33 blob, a wrong-revision
    receipt, the `abdacda` or `a7ef20c` receipt relabelled as the approved one, a missing
    or unreadable receipt, an unpinned digest, a disagreeing or unavailable public
    re-derivation, and an unreadable or cacheable served identity;
  - every superseded Admin revision (`abdacda`, `a7ef20c`, `eb54c92`, `1993a08`,
    `3521ebd`, `38df037`, the never-approved `ad4a7f8`) and any later unknown one,
    refused as unapproved.

  The `pilot-8` block now selects its own set from retained receipts, as the older
  blocks do.
- **Nothing else moved**: `publication.readiness.awaiting` is unchanged and gains no
  `peers.*` or `dependency.*` entry. No owner prerequisite, bootstrap setting,
  enablement, audit policy, B2.2 evidence mechanism or backend selection changed, and
  publication stays disabled.
- **The next Admin deployment will turn the next readiness run red again** until its own
  receipt is reviewed and approved from its final merged source.

### The 2026-09-27 refresh (compatible set `2026-09-27-pilot-10`)

*History: its Admin approval was superseded on 2026-09-28 by `94001b7` (next section);
its backend approval, `a6b25a6`, stood until 2026-09-28 (`0513adb`, `pilot-12`). After it merged, readiness run
`36345382850` (job `108693388435`, on `e414547`) completed as the six-reason,
non-publishing wait under it (`decisionDigest` `sha256:604dcb5e…`). The bullets below
describe the state when it was committed.*

Admin #35 merged as `3170e8f` at 16:45:17Z and Deploy Admin run `36334555985` promoted it
by 16:48:57Z. Readiness runs `36337180856` (job `108670149634`, on `e7a3473`),
`36338571396` (job `108674040280`, on `bb50491`) and `36339569844` (job `108676874582`, on
`0c388a1`) each read it serving and refused `peers.admin_serving_unapproved` under
`pilot-9`. All three bound `decisionDigest` `sha256:1ce0b730…`. Admin #36 then merged as
`9cf8c83` at 18:43:54Z (parents `3170e8f` and `dc4cfc5`), and Deploy Admin run
`36341891148` promoted it by 18:47:45Z. Both are deployment records, not origin reads.
Readiness run `36342248520` (job `108684478594`, on `ba8e4eb`, the #713 merge) then read
the identity and logged `9cf8c83` serving. It refused the same way
(`not-a-waiting-state`, `published: false`, the publish job skipped), with
`decisionDigest` `sha256:3afaa292…`. Public reads of
`https://admin.dinifyapp.com/release.txt` from the environment that produced this
refresh returned `9cf8c83…` with `Cache-Control: no-store` at 2026-09-27T18:58Z, the
second through the real `peer-facts` command. Only the Admin approval moves. The backend
stays `a6b25a6`, and `3170e8f` is not approved.

| peer | commit | tree | source blob(s) | receipt digest |
|---|---|---|---|---|
| admin | `9cf8c83b99c8cc8d44649aad2a6e8d7ee92f6bd8` (#35/#36) | `85b0173b…` | `deploy.yml` `2618d1ee…` (unchanged) | `sha256:05b8c83badc5ada15c5b5f4cfcc41b8bed6e7ff2c5834c3cd60fcd9bb7460ac8` |

- **Source verification.** `peer-receipt` produced the receipt from a fresh clone at the
  exact merged commit, which is Admin `main`; `9ec02fe` is its ancestor. The independent
  Python re-derivation, over a second, bare clone, computes the commit's tree, the
  `deploy.yml` blob and the canonical digest. The digests agree, and the same
  implementation reproduces the retained `9ec02fe` (`f396dc77…`) and `abdacda`
  (`18b256ce…`) digests as controls. The existing public verification path, `peer-facts`
  through an unauthenticated stand-in for the `gh` binary, answered `verified` for
  `9cf8c83` (tree and `deploy.yml` blob). This verifies the SOURCE of the approved
  revision, not what is serving; the gate reads serving at decision time.
- **Admin `9ec02fe..9cf8c83` is #35 and #36** (`ac551ec`, `3170e8f`, `dc4cfc5` and the
  merge), nine files:
  - #35 corrected Admin's docs, which had claimed its `dependency-audit/lib/retained.mjs`
    was identical to Frontend's (`CLAUDE.md`, `dependency-audit/README.md`,
    `release/README.md`, `release/tests/workflow.test.mjs`).
  - #36 ported Frontend #709's bounded, sanitized npm diagnostics into Admin's fresh
    dependency assessment: `dependency-audit/lib/retained.mjs` (now byte-identical to
    this repository's copy after #714), `release/lib/assessment.mjs`, `release/cli.mjs`,
    their tests and docs.

  **The diagnostics are evidence only.** A scan that times out stays incomplete; no
  verdict, retry or timeout changed. **The receipt-bearing `deploy.yml` is
  byte-identical** (`2618d1e`), so the executable deployment procedure is unchanged. The
  trusted verifier that `deploy.yml` checks out from `release/` now also checks a
  declared diagnostic file against its digest, and still refuses an undeclared file. No
  `src/` file, `package.json`, lock file, `ci.yml`, `audit.yml` or Angular configuration
  changed. This is a review of what this gate relies on, not an audit of the diagnostics.
- **What this gate relies on is unchanged.** At `9cf8c83`, `deploy.yml` still promotes
  only a certified candidate, and still asserts from the public origin after every
  promotion that `/release.txt` holds exactly the requested SHA and is served `no-store`.
  Its forward-only guard reads the same file. `policy.json`'s Admin assumptions and the
  `public-identity` serving contract are unchanged.
- **Before/after, every other fact held fixed** (committed-policy suite, replaying the
  serving facts the runs logged):
  - the `pilot-9` set reproduces run `36342248520`'s decision as a whole value (digest
    `sha256:3afaa292…`), and also the `3170e8f` decision the three earlier runs recorded
    (`sha256:1ce0b730…`);
  - the refreshed set removes exactly `peers.admin_serving_unapproved`;
  - through the real `decide` command it refuses the six recorded conditions as a
    completed, non-publishing wait: `REFUSE`, `allow: false`, nothing published. Its
    decision digests to `sha256:604dcb5e…`, the wait CI recorded under `pilot-8`,
    because the six-reason decision names no Admin commit.

  The following still refuse, and none of them is a wait:
  - a blocking or incomplete dependency assessment;
  - broken Admin evidence: an edited tree or blob, the pre-#33 blob, a wrong-revision
    receipt, the `9ec02fe` or `abdacda` receipt relabelled as the approved one, a missing
    or unreadable receipt, an unpinned digest, a disagreeing or unavailable public
    re-derivation, and an unreadable or cacheable served identity;
  - every superseded Admin revision (`9ec02fe`, `abdacda`, `a7ef20c`, `eb54c92`,
    `1993a08`, `3521ebd`, `38df037`), the never-approved `3170e8f` and `ad4a7f8`, and any
    later unknown one, refused as unapproved.

  The `pilot-9` block now selects its own set from retained receipts, as the older
  blocks do. The committed-policy suite went from 48 to **52** tests, and 14 of them
  fail with `main`'s `pilot-9` policy put back.
- **Nothing else moved**: `publication.readiness.awaiting` is unchanged and gains no
  `peers.*` or `dependency.*` entry. No owner prerequisite, bootstrap setting,
  enablement, audit policy or backend selection changed, and publication stays disabled.
- **The next Admin deployment will turn the next readiness run red again** until its own
  receipt is reviewed and approved from its final merged source.

### The 2026-09-28 refresh (compatible set `2026-09-28-pilot-11`)

*History: its backend approval, `a6b25a6`, was superseded the same day by `0513adb`
(next section); its Admin approval, `94001b7`, stood until 2026-10-03 (`pilot-13`). The bullets below describe
the state when it was committed.*

Admin #37 (D10 B2: bind each admin command to the session that issued it) merged as
`8b7895b`, and Deploy Admin run `36354242328` promoted it (22:08–22:09Z on 2026-09-27).
Admin #38 (the correction: post-verify lifecycle recovery, re-admission after capability
withdrawal, and typed not-run, outage and claim handling) merged as `94001b7` at 23:45:52Z
(parents `8b7895b` and `a2fa81e`). Admin CI run `36359784403` passed on that push, and
Deploy Admin run `36359914333` promoted `94001b7` over `8b7895b`. Its public verification
logged `/release.txt` as `94001b7…` (`no-store`) at 23:49:29Z and 16/16 admitted files
served byte for byte at 23:49:32Z. Those are Admin's own deployment records.
**No frontend readiness run observed `8b7895b` or `94001b7`**: the last one,
`36345382850`, ran at 19:43Z, before both deployments. So there is no red run to replay,
and the before/after comparison below uses CONSTRUCTED serving evidence. The environment
that produced this refresh made no live read of either origin. #37 and #38 were reviewed
together as delivered by #38; `8b7895b` is not approved. Only the Admin approval moves,
and the backend stays `a6b25a6`.

| peer | commit | tree | source blob(s) | receipt digest |
|---|---|---|---|---|
| admin | `94001b7dc1a64df5296b2502bcc26f4f2543d77d` (#37/#38) | `dc905761…` | `deploy.yml` `2618d1ee…` (unchanged) | `sha256:d499e466c92f0b80b822ad39d05870aacca139d5a1592d10390bbba3a545b5b5` |

- **Source verification.** `peer-receipt` produced the receipt from an isolated clone
  pinned to the exact merged commit, which is Admin `main`. The same run reproduced the
  retained `9cf8c83` receipt byte for byte as a positive control. The independent Python
  re-derivation, over a second, bare clone, recomputes the tree, the `deploy.yml` blob
  (from the blob's own bytes) and the canonical digest. The digests agree, and the same
  implementation reproduces the retained `9cf8c83` (`05b8c83b…`) and `9ec02fe`
  (`f396dc77…`) digests as controls. GitHub's commit and contents API report the same
  tree and blob. The live-serving half of `peer-facts` was **not** run. This verifies
  the SOURCE of the approved revision and says nothing about runtime trust or what is
  serving; the gate reads serving at decision time.
- **The approval is the merge, not the implementation head.** #38's final head `a2fa81e`
  carries the identical tree (`dc90576`), but the gate approves commits, so a receipt
  about `a2fa81e`, or `a2fa81e` serving, is refused. `8b7895b` has a different tree
  (`56d5d83`).
- **Admin `9cf8c83..94001b7` is #37 and #38**: 29 files, 28 under `src/app/` plus
  `CLAUDE.md`. They add command-owner binding (the `X-Admin-Command-Owner` header, the
  lifecycle generation, session-boundary handling, named sign-out and resume
  revalidation) and #38's recovery corrections. **The receipt-bearing `deploy.yml` is
  byte-identical** (`2618d1e`). No `release/`, `dependency-audit/`, `package.json`, lock
  file, `ci.yml`, `audit.yml` or Angular configuration changed, so the executable
  deployment procedure, the dependency inputs and the served identity this gate reads are
  unchanged. This is a review of what this gate relies on, not a security certification
  of the D10 implementation.
- **What this approval does not establish.** It is a statement about source. It does not
  show that the deployed backend enforces the command-owner header; that negative
  capability check is still an owner-gated operational gap. Backend enforcement has to
  stay in place through any Admin rollback, and a pre-D10 Admin bundle sends no owner
  header, so it is exposed again under the headerless compatibility contract. It
  authorizes no B3 cutover, and `peers.backend_serving_unverified` stands.
- **Before/after, every other fact held fixed** (committed-policy suite, constructed
  serving of `94001b7`):
  - the `pilot-10` set refuses it as `peers.admin_serving_unapproved`, the same seven
    reasons run `36342248520` logged for `9cf8c83`, and it is not a wait;
  - the refreshed set removes exactly that reason;
  - through the real `decide` command it refuses the six recorded conditions as a
    completed, non-publishing wait: `REFUSE`, `allow: false`, nothing published. Its
    decision digests to `sha256:604dcb5e…`, the wait CI has recorded since `pilot-8`,
    because the six-reason decision names no Admin commit.

  The following still refuse, and none of them is a wait:
  - a blocking or incomplete dependency assessment;
  - broken Admin evidence: an edited tree (including the `#37` tree) or blob, a receipt
    about `8b7895b` or `a2fa81e`, the `9cf8c83` receipt relabelled as the approved one, a
    missing or unreadable receipt, an unpinned digest (including the previous pin left in
    place), a disagreeing or unavailable public re-derivation, and an unreadable or
    cacheable served identity;
  - every superseded Admin revision (`9cf8c83`, `9ec02fe`, `abdacda`, `a7ef20c`,
    `eb54c92`, `1993a08`, `3521ebd`, `38df037`), the never-approved `8b7895b`, `3170e8f`
    and `ad4a7f8`, `a2fa81e`, and any later unknown one, refused as unapproved.

  The `pilot-10` block now selects its own set from retained receipts, as the older
  blocks do. The committed-policy suite went from 52 to **55** tests, and 14 of them
  fail with `main`'s `pilot-10` policy put back.
- **Nothing else moved**: `publication.readiness.awaiting` is unchanged and gains no
  `peers.*` or `dependency.*` entry. No owner prerequisite, bootstrap setting,
  enablement, eligibility, publisher configuration, audit policy, serving contract or
  backend selection changed, and publication stays disabled.
- **The next Admin deployment will turn the next readiness run red again** until its own
  receipt is reviewed and approved from its final merged source.

### The 2026-09-28 backend refresh (compatible set `2026-09-28-pilot-12`)

Backend #339–#350 merged after `a6b25a6` was approved, and `0513adb` (the #350 merge) is
Backend `main`. This refresh selects it as the approved backend SOURCE revision. Only the
backend approval, its serving note and the set id move; Admin `94001b7` is unchanged. No
frontend readiness run had evaluated `pilot-12` when it was committed.

| peer | commit | tree | source blob(s) | receipt digest |
|---|---|---|---|---|
| backend | `0513adb441828d62faadc1c67799c5432868c33a` (#350) | `d263ada8…` | D01 `1cb6a6db…`, capabilities `cc916050…` (both unchanged) | `sha256:78795d4ddc8f3b6351260a6cd4c00bc313998958ef4cec0a86b33522d1581558` |

- **Source verification.** `peer-receipt --write` produced the receipt from a private
  clone pinned to the exact merged commit; the file is byte-identical to what it printed.
  An independent Python re-derivation over a second, bare clone recomputes the tree, both
  export blob ids from the blobs' own bytes, the D01 digest and the receipt digest. The
  digests agree, and the same implementation reproduces `a6b25a6`'s `c1355f50…` as a
  control. GitHub's commit and contents API report the same tree and both blobs. The
  receipt carries blob ids and exported contract values only; no backend source entered
  this repository.
- **Backend `a6b25a6..0513adb` (#339–#350) moved neither export.** Both blobs are
  byte-identical, so the D01 digest (`sha256:1441d038…`) and the four published levels
  (`checkout_protocol 3`, `quote_protocol 2`, `kitchen_protocol 1`,
  `quote_policy_version 1`) are unchanged. This is a source selection following accepted
  merges; matching exported contracts is not proof of every cross-application behaviour.
- **Replaced, not joined.** The `a6b25a6`, `366b7e4` and `9448f55` receipts stay under
  `peers/` as history. Every committed-policy block for an earlier set now replays
  against that set's own snapshot (`HISTORICAL_SETS`: its backend and the serving note its
  decisions printed), so every decision digest CI recorded still reproduces byte for byte.
- **The serving note is corrected, and serving is still unavailable.** The note said the
  backend "publishes no served-revision identity". Its source now carries a release
  identity endpoint and a staged installer, but the installer is not active, the legacy
  `deploy-uat.yml` still serves, and by that source a process the legacy deploy starts
  answers the endpoint as unavailable. What is missing is a *verified loaded-runtime
  identity*. `observation` stays `unavailable`, the refusal stays
  `peers.backend_serving_unverified`, and an operator statement is still not accepted as
  serving evidence. The readiness description of that code (`lib/readiness.mjs`) says
  the same.
- **Before/after, every other fact held fixed** (committed-policy suite, CONSTRUCTED):
  `pilot-11` → `pilot-12` changes no reason code, and the backend swap alone changes no
  byte of the decision. The corrected note is the detail of
  `peers.backend_serving_unverified`, so the six-reason wait's decision digest moves from
  `sha256:604dcb5e…` to `sha256:79ff3fea…`. Through the real `decide` command it is still
  a completed, non-publishing wait: `REFUSE`, `allow: false`, nothing published. No run
  had recorded `79ff3fea…` when this was committed; the next readiness run with Admin
  still serving `94001b7` was expected to, and did: run `36741006888` (on `5bd99b3`,
  2026-09-30) recorded exactly `79ff3fea…` as `awaiting-prerequisites`.

  The following still refuse, and none of them is a wait: the approved backend receipt
  edited without re-approval, an unpinned or wrong digest, the replaced `a6b25a6` and
  every earlier backend, an operator statement of which backend is serving, and an Admin
  revision `pilot-12` does not approve. The committed-policy suite went from 55 to
  **64** tests, and 11 of them fail with `main`'s `pilot-11` policy put back.
- **Also in this change: `journey-observe.mjs`.** It collects GitHub metadata for an
  approved peer selection and, offline, hands local candidate bytes to the B1 journey
  selector (`lib/journey-peers.mjs`); `JOURNEY_OBSERVATION.md` is its contract. It is not
  a serving observation, nothing calls it yet, and this gate does not consult it.
- **Nothing else moved**: `publication.readiness.awaiting` is unchanged and gains no
  `peers.*` or `dependency.*` entry. No owner prerequisite, bootstrap setting,
  enablement, eligibility, publisher configuration, audit policy, Admin approval or
  serving observation changed, and publication stays disabled.

### The 2026-10-03 Admin refresh (compatible set `2026-10-03-pilot-13`)

*History: its Admin approval, `89d2cf1`, stood until 2026-10-13 (`pilot-14`, next
section). The bullets below describe the state when it was committed.*

Admin #40 merged as `042e803` and #39 as `89d2cf1` on 2026-10-01, and Admin deployed
both (Deploy Admin runs `36881603916` and `36882599969`, the second a certified forward
promotion verifying 16/16 admitted files from the public origin). Readiness run
`36881809186` (on `1527c6b`) refused `peers.admin_serving_unapproved` for `042e803`, and
runs `36919953847` (on `229c0b1`) and `36936713667` (on `73ec2d8`) for `89d2cf1` — each
`not-a-waiting-state`, publisher skipped, and that its ONE unexpected reason. This
refresh approves `89d2cf1`. Only the Admin approval and the set id move; backend `0513adb`
and its serving note are `pilot-12`'s.

| peer | commit | tree | source blob | receipt digest |
|---|---|---|---|---|
| admin | `89d2cf1a9ce8d44ec4d0fcad9865df96053b3bc6` (#40/#39) | `b85bbcc8…` | `deploy.yml` `2618d1ee…` (unchanged) | `sha256:0905b63556e9d4e487e8c4a2b0e79207c03ef6214ce1361bf31a5528f8e857d6` |

- **Source verification.** `peer-receipt --write` produced the receipt from a bare clone
  of the public repository at the exact merged commit; an independent Python
  re-derivation over the same clone recomputes the tree, the `deploy.yml` blob and the
  digest, and reproduces `94001b7`'s `d499e466…` and `9cf8c83`'s `05b8c83b…` as controls.
- **Admin `94001b7..89d2cf1` is #40 and #39**: `package.json` and `package-lock.json`
  (runtime `@angular/*` 21.2.20 → 21.2.24 within the patch line; the 21.2.x CLI/build
  tooling to 21.2.24; in-range dev-tooling bumps of `brace-expansion`, `engine.io` and
  `undici`), `dependency-audit/` (three scanner-bundled exceptions Frontend already
  carries; a string `os`/`cpu`/`libc` constraint read the way npm reads it) and
  `CLAUDE.md`. No `src/`, `angular.json`, `release/`, CI or audit workflow changed, and
  `deploy.yml` is byte-identical, so the identity this gate reads is unchanged: the exact
  commit at `/release.txt`, served `no-store`. The Angular patch bump does change the
  served bytes; this gate assumes no Admin protocol and pins none.
- **Replayed, not constructed.** The `pilot-12` set with Admin serving `89d2cf1`
  reproduces the decision runs `36919953847` and `36936713667` bound
  (`sha256:b1b57046…`) byte for byte, and with `042e803` the decision run `36881809186`
  bound (`sha256:bd8a5733…`). With every other fact held fixed the refresh removes
  `peers.admin_serving_unapproved` and nothing else, leaving the six-reason wait
  `sha256:79ff3fea…` that run `36741006888` recorded under `pilot-12`. That is a replay
  over fixture inputs. A real run reaches the same wait only if its fresh assessment
  and peer reads succeed, every other fact is unchanged and publication stays disabled.
- **What it does not resolve.** Readiness runs `37137245529` (on `e553faf`) and
  `37205168076` (on `63d6166`) also observed `89d2cf1`. Each of them completed a fresh
  dependency assessment that was BLOCKING (`dependency.assessment_blocking`: 18
  findings, 1 blocking). Those two CI runs establish the blocking assessment and the
  Admin mismatch, and nothing more. Their retained assessment bytes could not be
  inspected from the environment that prepared this refresh. The specific publisher
  advisory, `braces` 3.0.3 (GHSA-vfj7-8cjw-p6xm), was identified by a LOCAL REPRODUCTION
  of the assessment, not by reading CI's retained record. **This receipt change alone
  does not resolve the dependency refusal**, and no `dependency.*` code is ever a wait.
- **Replaced, not joined.** The `94001b7` receipt stays under `peers/` as history.
  `042e803` was deployed and never approved. The committed-policy suite went from 64 to
  **70** tests, and 15 of them fail with `main`'s `pilot-12` policy put back.

### The 2026-10-13 Admin refresh (compatible set `2026-10-13-pilot-14`)

*History: its Admin approval, `1fa89cb`, stood until 2026-10-15 (`pilot-15`, next
section). The bullets below describe the state when it was committed.*

Admin #42 merged as `15eac1b`, #43 as `85947ca` and #41 as `1fa89cb`, and Admin deployed
all three (Deploy Admin runs `37657619805`, `37660784886` and `37662260854`; the last
promoted `1fa89cb`, read `/release.txt` back as that exact commit `no-store`, and matched
16/16 admitted files from the public origin). Readiness runs `37864171285` (on
`aa0b958`, 2026-10-09) and `38386816091` (on `386c432`, 2026-10-13) read `1fa89cb`
serving and refused `peers.admin_serving_unapproved` under `pilot-13` —
`not-a-waiting-state`, publisher skipped. This refresh approves `1fa89cb`. Only the
Admin approval and the set id move; backend `0513adb` and its serving note are
`pilot-12`'s.

| peer | commit | tree | source blob | receipt digest |
|---|---|---|---|---|
| admin | `1fa89cb3897ca0cb48c38ed7c36a11cd4283a899` (#42/#43/#41) | `dc980891…` | `deploy.yml` `2618d1ee…` (unchanged) | `sha256:49bb690ec565e869e8011178f17ec7c6244091733822c7a3144117f8e13fe6e1` |

- **Source verification.** The unchanged `peer-receipt --write` produced the receipt from
  a clone of the public repository holding the exact merged commit. An independent
  Python re-derivation recomputes the commit's tree, the `deploy.yml` blob and the
  canonical digest, and agrees with the reviewer's expected digest; `89d2cf1`'s
  `0905b635…` and `94001b7`'s `d499e466…` reproduce as controls.
- **Admin `89d2cf1..1fa89cb` is #42, #43 and #41, and it is NOT tooling-only.** #42
  changed `package.json`, `package-lock.json`, `dependency-audit/` (three owner-approved
  tooling exceptions added, the existing three retained) and `CLAUDE.md`. Its lock moves
  include the RUNTIME `@angular/*` 21.2.24 → 21.2.25 patch (`common`, `compiler`, `core`,
  `forms`, `platform-browser`, `router`) as well as dev tooling (`@angular/build` and
  `@angular/cli` 21.2.26, `@modelcontextprotocol/sdk` 1.31.0, `piscina`, `proxy-addr`,
  `source-map-js`). #43 changed `src/app/features/restaurants.page.ts` and its spec: the
  Lifecycle select now reflects the URL's filter on a direct load. #41 moved the SHA-pinned
  `anthropics/claude-code-action` from v1.0.235 to v1.0.241 in `claude.yml` and
  `claude-code-review.yml`. `deploy.yml` is byte-identical and Admin's `release/`,
  `src/app/core` and `angular.json` are unchanged, so the identity this gate reads is
  unchanged: the exact commit at `/release.txt`, served `no-store`. The served bytes do
  change; this gate assumes no Admin protocol and pins none.
- **Replayed, not constructed.** The `pilot-13` set with Admin serving `1fa89cb`
  reproduces the decision both runs bound (`sha256:f957895f…`) byte for byte. With every
  other fact held fixed the refresh removes `peers.admin_serving_unapproved` and nothing
  else, leaving the six-reason wait `sha256:79ff3fea…`. That is a replay over fixture
  inputs. A real run reaches the same wait only if its fresh assessment and peer reads
  succeed, every other fact is unchanged and publication stays disabled.
- **Dated observations, not admission authority.** Run `38386816091`'s fresh assessment
  passed (0 blocking, 5 exceptions, 16 triage), and Admin's own audit of run
  `38273752381` (2026-10-12) reported 19 findings, 0 blocking, 6 exceptions and 13
  triage. Neither is carried forward: every promotion assesses afresh, and a blocking or
  incomplete assessment stays a hard, non-waiting refusal beside this receipt.
- **What it does not resolve.** The six commissioning conditions stand
  (`peers.backend_serving_unverified`, the four `prerequisite.*` reasons and
  `served.bootstrap_unauthorized`). This approval activates no publisher, establishes
  no backend runtime identity and enables no publication.
- **Replaced, not joined.** The `89d2cf1` receipt stays under `peers/` as history.
  `15eac1b` and `85947ca` were deployed and never approved, and no readiness run
  observed either. `journey-observation.test.mjs` names the approved set and Admin
  revision and was updated with it. The committed-policy suite went from 70 to **77**
  tests, and 16 of them fail with `main`'s `pilot-13` policy put back (2 of 78 in the
  journey-observation suite).

### The 2026-10-15 Admin refresh (compatible set `2026-10-15-pilot-15`)

*History: its Admin approval, `033c49a`, stood until 2026-10-25 (`pilot-16`, next
section). The bullets below describe the state when it was committed.*

Admin #44 (Dependabot) merged as `033c49a` on 2026-10-15. Admin CI run `38641814562`
(the PR head `9337f55`) and run `38751640463` (the push to `main`) succeeded, and Deploy
Admin run `38752134201` promoted `033c49a` over `1fa89cb` as a certified forward move:
candidate artifact `11981447732` selected by id and digest, a fresh assessment passing
with approved exceptions (19 findings, 6 excepted, 13 requiring triage), the host
verifying payload tree `sha256:d5f21cc9…`, and the public origin serving `/release.txt`
as exactly `033c49a`, `no-store`, with 16/16 admitted files matched byte for byte.
Readiness run `38763144686` (on `5015b33`) read `033c49a` serving and refused
`peers.admin_serving_unapproved` under `pilot-14` — `not-a-waiting-state`, publisher
skipped, decisionDigest `sha256:b100feda…`. This refresh approves `033c49a`. Only the
Admin approval and the set id move; backend `0513adb` and its serving note are
`pilot-12`'s, and nothing is added to `publication.readiness.awaiting`.

| peer | commit | tree | source blob | receipt digest |
|---|---|---|---|---|
| admin | `033c49aed85d2c94ea97115237a4e4e6b5cf1cf4` (#44) | `a15befd9…` | `deploy.yml` `94f7d41d…` (**changed**) | `sha256:524ff8271e52f860b72ca4863689d58d22496b5a560ced0939e3d33b5a72fc17` |

- **Source verification.** The unchanged `peer-receipt --write` produced the receipt from
  a clone of the public repository checked out at the exact merged commit, and the same
  command reproduced the committed `1fa89cb` receipt byte for byte from that clone. An
  independent Python re-derivation over a separate bare clone recomputes the tree, the
  `deploy.yml` blob and the canonical digest and agrees; `1fa89cb`'s `49bb690e…` and
  `89d2cf1`'s `0905b635…` reproduce as controls. GitHub's contents API reports the same
  `deploy.yml` blob at the commit.
- **Admin `1fa89cb..033c49a` is #44 alone, and it is workflow-only.** Only `uses:` lines
  moved, in `audit.yml`, `ci.yml`, `deploy.yml`, `claude.yml` and
  `claude-code-review.yml`: `actions/setup-node` v7.0.0 → v7.1.0,
  `actions/upload-artifact` v7.0.1 → v7.0.2, `actions/download-artifact` v8.0.1 → v8.0.2
  and `anthropics/claude-code-action` v1.0.241 → v1.0.248. Every new SHA was checked
  against its upstream tag (the claude-code-action tag is annotated and dereferences to
  the pin). The merge's tree equals the PR head's, so the merged source is the reviewed
  source. **The receipt-bearing `deploy.yml` changes** (blob `2618d1e` → `94f7d41`), in
  six `uses:` lines and nothing else: the `prepare`/`deploy` job split, `prepare`'s
  absent `id-token`, `deploy`'s `id-token: write`, the trusted-verifier checkout, the
  digest-enforced downloads, the privileged re-decision, the host verification and the
  exact-commit `no-store` `/release.txt` assertion are unchanged. `claude.yml` and
  `claude-code-review.yml` still hold no `id-token`. `audit.yml` still names
  `actions/checkout` and `actions/setup-node` by tag (setup-node now `@v7.1.0`); that is
  a pre-existing gap in a scheduled re-scan nothing consumes, recorded and unchanged in
  kind. This review used existing evidence only; it is not a security certification of
  the bumped actions.
- **Replayed, not constructed.** The `pilot-14` set with Admin serving `033c49a`
  reproduces the decision run `38763144686` bound (`sha256:b100feda…`) byte for byte.
  With every other fact held fixed the refresh removes `peers.admin_serving_unapproved`
  and nothing else, leaving the six-reason wait `sha256:79ff3fea…` with `allow: false`
  and `published: false`. That is a replay over fixture inputs. A real run reaches the
  same wait only if its fresh assessment and peer reads succeed, every other fact is
  unchanged and publication stays disabled.
- **Dated observations, not admission authority.** Run `38763144686`'s fresh assessment
  completed (21 findings, 5 excepted, 16 requiring triage). It is not carried forward:
  every evaluation assesses afresh, and a blocking or incomplete assessment stays a hard,
  non-waiting refusal beside this receipt.
- **What it does not resolve.** The six commissioning conditions stand. This approval
  activates no publisher, establishes no backend runtime identity and enables no
  publication. A later Admin head is not implicitly approved: the next Admin deployment
  turns the next readiness run red again until its own receipt is reviewed.
- **Replaced, not joined.** The `1fa89cb` receipt stays under `peers/` as history, and
  the `pilot-14` block of `committed-policy.test.mjs` is now bound to its own snapshot.
  The committed-policy suite went from 77 to **83** tests, and 17 of them fail with
  `main`'s `pilot-14` policy put back. `journey-observation.test.mjs` names the approved
  set and Admin revision and was updated with it (three lines, under a bounded
  reservation; 2 of its tests fail with `main`'s policy put back).

### The 2026-10-25 Admin refresh (compatible set `2026-10-25-pilot-16`)

Admin merged #45 as `e864c82`, #46 as `ed6430d`, #47 as `c88a75b` and #48 as `a42a056`.
Deploy Admin run `40123508062` promoted `a42a056` on 2026-10-24 (as reported by the
reviewer; this change did not re-read that run). A public read of `/release.txt` returned
`a42a056`, `no-store`, at 2026-10-25T12:17:50Z. Readiness run `40128009591` (on
`a0786ca`, 2026-10-24) read `a42a056` serving and refused `peers.admin_serving_unapproved`
under `pilot-15`. Its result was `not-a-waiting-state`, the publisher was skipped and the
run bound decisionDigest `sha256:207e2c41…`. The same run also refused
`dependency.assessment_blocking`. This refresh approves `a42a056`. Only the Admin approval
and the set id move. Backend `0513adb` and its serving note are `pilot-12`'s, and nothing
is added to `publication.readiness.awaiting`.

| peer | commit | tree | source blob | receipt digest |
|---|---|---|---|---|
| admin | `a42a0564b7d3351ea907a31093f9be016c7ab03d` (#45/#46/#47/#48) | `7f7fb5fa…` | `deploy.yml` `94f7d41d…` (unchanged) | `sha256:6302bf9a88c74839a81d94cb3fd8d98b6f2b84cc5aacf49d18c9eeaea0c0e144` |

- **Source verification.** The unchanged `peer-receipt --write` produced the receipt from
  a clone of the public repository, at the exact merged commit. The same command
  reproduced the committed `033c49a` receipt byte for byte from that clone. An independent
  Python re-derivation used a separate bare clone. It recomputed each git object's hash,
  then the commit's tree, the `deploy.yml` blob and the canonical digest, and it agrees.
  `033c49a`'s `524ff827…` and `1fa89cb`'s `49bb690e…` reproduce as controls. GitHub's
  contents API was **not** consulted: this environment cannot reach it for Admin.
- **Admin `033c49a..a42a056` is #45, #46, #47 and #48.**
  - **#45 (Dependabot)** moved the SHA-pinned `anthropics/claude-code-action` from
    v1.0.248 (`1d6de8c`) to v1.0.253 (`5eb090f`), in `claude.yml` and
    `claude-code-review.yml`. The v1.0.253 tag is annotated and dereferences to the pin.
    Its second commit, `6e403c3`, made dev-tooling lock updates:
    `@angular/build` and `@angular/cli` 21.2.28, `@modelcontextprotocol/sdk` 1.32.1,
    `express` 5.3.0, `body-parser` 2.4.0, `hono` 4.13.13, `zod` 4.6.6 and `vite` 7.3.7,
    among others.
  - **#46** moved Admin's audit scanner from npm 11.19.1 to 11.21.1. It removed five
    exception records and re-recorded the owner-approved application
    `http-cache-semantics` exception, which now expires on 2026-12-31. It also documented
    the change in `dependency-audit/README.md` and, as prose only, in `release/README.md`.
  - **#47** made lock-only updates of `ip-address` and `postcss-selector-parser`.
  - **#48** made lock-only updates of karma's `body-parser`, node-gyp's `undici` and
    `fast-uri`. It also recorded two owner-approved `undici` GHSA-xjj6-f33q-929c tooling
    exceptions (application and scanner graphs), which expire on 2026-11-30.

  Every application lock move in the range is a dev entry. No `package.json`,
  `angular.json` or `src/` file changed, and each merge's tree equals its PR head's tree.
  The receipt-bearing `deploy.yml` is byte-identical (`94f7d41`), so the identity this gate
  reads is unchanged: the exact commit at `/release.txt`, served `no-store`.
  `claude.yml` and `claude-code-review.yml` still grant no `id-token`. Admin's
  `dependency-audit/` tree is part of its trusted verifier and moved as described. This
  review is about source, not a security certification of the bumped action or of the
  approved exceptions.
- **Replayed, not constructed.** Replaying the `pilot-15` set after R-1, with Admin serving
  `a42a056` and a blocking fresh assessment whose headline is the CI log's, reproduces the
  decision run `40128009591` bound (`sha256:207e2c41…`) byte for byte, all seven reasons.
  With every other fact held fixed, the refresh removes `peers.admin_serving_unapproved`
  and nothing else. Six reasons remain: the five standing ones and
  `dependency.assessment_blocking`. That decision (`sha256:f1d14934…`) is **constructed**,
  since no run has recorded it. It is still `allow: false` and still not a wait. With a
  passing assessment instead, the same refresh leaves the five-reason wait
  `sha256:8ecab1b2…`, which is still synthetic. Both are replays over fixture inputs.
- **What it does not resolve.**
  - **The blocking assessment.** Run `40128009591`'s fresh assessment reported 15
    findings, 2 blocking, 1 excepted and 12 requiring triage. That is a fact about the
    graphs it assessed and not about Admin, and this receipt does not touch it. It clears
    only once a later run's fresh assessment stops blocking. Every `dependency.*` reason
    stays a hard, non-waiting refusal.
  - **The five standing reasons:** `peers.backend_serving_unverified`, the three
    `prerequisite.*` reasons and `served.bootstrap_unauthorized`.
  - **Everything else.** This approval activates no publisher, establishes no backend
    runtime identity and enables no publication. A later Admin head is not implicitly
    approved: the next Admin deployment turns the next readiness run red again until its
    own receipt is reviewed.
- **Lane H's Admin selection is superseded.** `033c49a` was the Admin consumer selected
  for Lane H's `pilot-15` packet. Lane H stays parked, and its frozen build and artifacts
  are not touched by this change. Its `pilot-15` Admin selection no longer matches the
  approved set, so any resumption needs a new selection against `pilot-16`.
  `journey-observe` refuses a selection that the committed set does not approve
  (`journey.observe.selection_not_approved`).
- **Replaced, not joined.** The `033c49a` receipt stays under `peers/` as history, and the
  `pilot-15` block of `committed-policy.test.mjs` is now bound to its own snapshot, on
  both sides of R-1. The committed-policy suite went from 95 to **101** tests, and 22 of
  them fail with `main`'s `pilot-15` policy put back. `journey-observation.test.mjs` names
  the approved set and Admin revision, so it was updated with it (three lines; 2 of its 78
  tests fail with `main`'s policy put back). The release suite runs **1405** tests on Node
  24.15.0, which is 1399 on `main` by subtraction.

### The 2026-10-26 Admin refresh (compatible set `2026-10-26-pilot-17`)

The first refresh under the data-driven procedure above: a receipt, `policy.json` and one
history row, with no test edit. Admin merged #49 as `668b627`. Deploy Admin run
`40383293859` promoted it (as reported by the reviewer; this change did not re-read that
run). A public read of `/release.txt` returned `668b627`, `no-store`, at
2026-10-26T22:16:11Z. This refresh approves `668b627`. Only the Admin approval and the set
id move. Backend `0513adb` and its serving note are `pilot-12`'s, the owner state is R-1,
and nothing is added to `publication.readiness.awaiting`.

| peer | commit | tree | source blob | receipt digest |
|---|---|---|---|---|
| admin | `668b62788db5d0d45f81150dad69c2c1802485aa` (#49) | `8dfdc647…` | `deploy.yml` `a71f5d5f…` (was `94f7d41d…`) | `sha256:aadd295eaa7455f84cc8ce96104125af1fa520d63a238071018bf46ae1d37b49` |

- **Source verification.** The unchanged `peer-receipt --write` produced the receipt from
  a clone of the public repository, at the exact merged commit. The same command
  reproduced the committed `a42a056` receipt byte for byte from that clone. An independent
  Python re-derivation used a separate bare clone. It recomputed each git object's hash,
  then the commit's tree, the `deploy.yml` blob and the canonical digest, and it agrees.
  `a42a056`'s `6302bf9a…` and `033c49a`'s `524ff827…` reproduce as controls.
- **Admin `a42a056..668b627` is #49 alone** (one first-parent merge). The merge's tree
  equals the PR head `44108ad`'s (`8dfdc647…`), so the merged source is the reviewed
  source. It changed two files: the receipt-bearing `.github/workflows/deploy.yml`
  (+254/−1) and `release/tests/workflow.test.mjs` (+172). No other workflow and nothing in
  Admin's `release/lib/`, `release/cli.mjs` or `dependency-audit/` changed.
- **What `deploy.yml` gains: a first job, `window`** (l.178–417 at `668b627`). It probes
  `https://admin.dinifyapp.com/release.txt` and decides PROCEED (the origin answered, at
  any time), DEFER (silent outside 11:00–23:00 Europe/London, less a 20-minute end margin)
  or FAIL (silent inside the window, or anything it cannot establish). A deferred run
  cancels itself so that it concludes grey, and fails red if the cancellation does not
  land. Its self-test covers both 2026 daylight-saving changes. What this gate relies on
  was checked line by line:
  - `window` holds exactly `permissions: actions: write` (l.189–190), the permission it
    needs to cancel its own run. It has no `id-token`, no `secrets.` reference, no
    checkout and no `uses:` step: only workflow shell with `curl`, `date` and the
    preinstalled `gh`, authenticated by the job's `github.token`. Its `if:` is the same
    event gate as `prepare`'s.
  - `prepare` now `needs: window` (l.419) and still holds only `contents: read` and
    `actions: read` (l.440).
  - `deploy` now `needs: [window, prepare]` (l.818) and is still the only job in the
    repository holding `id-token: write` (l.822–823). Every deploying job therefore waits
    for `window`.
  - Outside the `window` block and those two `needs:` lines, `deploy.yml` is byte-identical
    to `a42a056`'s. The forward-only ordering guard (l.1124) still runs before OIDC
    (l.1224), and the trusted-verifier checkout, digest-enforced downloads, the privileged
    re-decision, the host verification and the exact-commit `no-store` `/release.txt`
    assertion are unchanged. So is the identity this gate reads.
  - `claude.yml` and `claude-code-review.yml` are unchanged and still grant no `id-token`.

  Admin CI run `40382878784` and Deploy Admin run `40383293859` succeeded, the window job
  deciding PROCEED in-window (as reported by the reviewer). **The DEFER path has not run
  live.** This review is about source, not a security certification of the window job.
- **Constructed, not recorded.** No Frontend readiness run observed `668b627` under
  `pilot-16`. The last, `40380608540` (on `8a9bf45`), completed at 18:46Z, before the
  Admin deployment, while `a42a056` served. It recorded the five-reason wait
  `sha256:8ecab1b2…`, which the `pilot-16` row carries as `synthetic`: that digest has now
  been bound by a real run, and the row is left as it is because a refresh edits no other
  row. The `pilot-16` refusal of a served `668b627` is therefore computed from the rule,
  with a passing assessment: `sha256:08361139…`, all six reasons. With every other fact
  held fixed, the refresh removes `peers.admin_serving_unapproved` and nothing else, and
  returns the five-reason wait `sha256:8ecab1b2…` (constructed under this set; no run has
  recorded it under `pilot-17`).
- **What it does not resolve.** The five standing reasons
  (`peers.backend_serving_unverified`, the three `prerequisite.*` reasons and
  `served.bootstrap_unauthorized`) stand. This approval activates no publisher,
  establishes no backend runtime identity and enables no publication. A later Admin head
  is not implicitly approved: the next Admin deployment turns the next readiness run red
  again until its own receipt is reviewed. Readiness reads Admin's `/release.txt`, which
  answers only inside the server's window, so a merge's readiness run needs that window
  too.
- **Replaced, not joined.** The `a42a056` receipt stays under `peers/` as history. The
  committed-policy and journey-observation suites run **218** tests together (212 on
  `main`): the six added are the ones the new row generates. The release suite runs
  **1444** tests on Node 24.22.1, which is 1438 on `main` by subtraction.

### The 2026-10-27 Admin refresh (compatible set `2026-10-27-pilot-18`)

Admin merged #50 as `13a0e54`. Admin CI run `40552675432` succeeded on it, and Deploy
Admin run `40553113097` promoted it: its `window`, `prepare` and `deploy` jobs all
succeeded, including the step that asserts the public origin serves the admitted release.
Those conclusions were read through the API; the logs were not read. A public read of
`/release.txt` returned `13a0e54`, `no-store`, at 2026-10-27T17:52:00Z. This refresh
approves `13a0e54`. Only the Admin approval and the set id move. Backend `0513adb` and its
serving note are `pilot-12`'s, the owner state is `source-protection-recorded`, and nothing
is added to `publication.readiness.awaiting`.

| peer | commit | tree | source blob | receipt digest |
|---|---|---|---|---|
| admin | `13a0e54ca4d8c0e1f66fcde7121a7ed2d7654816` (#50) | `f792ece4…` | `deploy.yml` `a71f5d5f…` (unchanged) | `sha256:b5e1127b0ad7230c8c6e6966221886650d18e2b14c43d435a6a83ad3ab4ad8b1` |

- **Source verification.** The unchanged `peer-receipt --write` produced the receipt from
  a fresh clone of the public repository, at the exact merged commit. The same command
  reproduced the committed `668b627` receipt byte for byte from that clone. An independent
  Python re-derivation used a separate bare clone. It recomputed each git object's hash,
  walked the commit's tree to the `deploy.yml` blob and computed the canonical digest, and
  it agrees. `668b627`'s `aadd295e…` and `a42a056`'s `6302bf9a…` reproduce as controls.
- **Admin `668b627..13a0e54` is #50 alone** (one first-parent merge). The merge's tree
  equals the PR head `d1443f7`'s (`f792ece4…`), so the merged source is the reviewed
  source. #50 is CI-signal A-1: the shared dependency-audit evaluator learns dated
  obligations, inert until A-2. It changed seven files:
  - `CLAUDE.md`;
  - `dependency-audit/README.md`, `conformance.json`, `lib/core.mjs` and
    `tests/core.test.mjs`. The evaluator gains a fifth outcome, `obligations_pending`
    (exit 0). Only an unexcepted tooling-high finding carrying `provenance` and
    `reportableSince` can reach it, and no Admin adapter supplies either yet;
  - `release/lib/certification.mjs` and `release/tests/certification.test.mjs`. Its
    `PASSING`, which `assessment.mjs` imports, accepts the new word.

  Both trees are part of Admin's trusted verifier, so its `release/` and
  `dependency-audit/` trees moved as described. **`.github/` is byte-identical.** The
  receipt-bearing `deploy.yml` is unchanged (`a71f5d5`), so the executable deployment
  procedure and the identity this gate reads (the exact commit at `/release.txt`, served
  `no-store`) are unchanged. `deploy` is still the only job holding `id-token: write`, and
  `claude.yml` and `claude-code-review.yml` are unchanged. No `package.json`, lock,
  `angular.json` or `src/` file changed.
- **Not an independent review.** #50 was written in the same session that prepared this
  refresh, so this review is not independent of its authorship. Codex's review of #50
  reported no findings, and the Claude Code review check succeeded without posting a
  comment. This is a statement about source, not a security
  certification of the evaluator change.
- **Constructed, not recorded.** No Frontend readiness run observed `13a0e54` under
  `pilot-17`. The last, `40551933129` (on `8c07cde`), read the peers at 17:35Z, before the
  Admin deployment. It completed as the four-reason wait `sha256:01536d3a…`, which `pilot-17`'s
  row already carries as recorded. The `pilot-17` refusal of a served `13a0e54` is
  therefore computed from the rule, with a passing assessment: `sha256:53979e76…`, five
  reasons. With every other fact held fixed, the refresh removes
  `peers.admin_serving_unapproved` and nothing else, and returns the four-reason wait
  `sha256:01536d3a…`. The wait names no Admin commit, so its digest is unchanged, and no
  run has recorded it under `pilot-18`.
- **What it does not resolve.** The four standing reasons
  (`peers.backend_serving_unverified`, the two `prerequisite.legacy_publisher_*` reasons
  and `served.bootstrap_unauthorized`) stand. This approval activates no publisher,
  establishes no backend runtime identity and enables no publication. A later Admin head
  is not implicitly approved: the next Admin deployment turns the next readiness run red
  again until its own receipt is reviewed.
- **Replaced, not joined.** The `668b627` receipt stays under `peers/` as history. The
  committed-policy and journey-observation suites run **237** tests together (231 on
  `main`): the six added are the ones the new row generates, and 20 of them fail with
  `main`'s `pilot-17` policy put back. The release suite runs **1493** tests on Node
  24.22.1, against 1487 on `main` (both measured).

`lib/decide.mjs`, `lib/preflight.mjs` and `lib/outcome.mjs` are pure — no clock, no
filesystem, no network — which is what lets the refusal matrix run from fixtures. The
adapter and simulation suites then prove the CLI feeds them what the world says.
