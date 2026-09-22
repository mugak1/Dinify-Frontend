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
published is one record (`lib/record.mjs`, `dinify.release.record/1`):

| identity | bound to |
|---|---|
| the target | repository, commit, the commit's source tree |
| the certification | workflow path, run id, **run attempt**, run start (the certification window counts from it) |
| the artifact | the upload's **artifact id** and the zip digest the API lists for it, the **manifest digest**, the **tree digest**, the entry count |
| the build | configuration, the dependency-lock digest and the environment the stamp read from the built bytes — bound through the manifest digest, which carries all three and which the publisher recomputes from its own download |
| the destination | the project, site, target and channel, and the digest of the **regenerated** hosting configuration |
| the peers | the approved receipt digests, and the Admin revision observed serving |
| the served state | what `/release.json` answered when the gate decided |
| the rules | the verifier revision and tree, and the policy digest |

The gate emits the record and its digest; the publisher refuses unless every identity
in it can be re-established from what the publisher itself holds and what the world
says at promotion time. Nothing here claims an artifact **was** substituted — GitHub
artifacts are immutable once uploaded — the record is what makes "the same unit"
checkable rather than assumed, across a re-run, an expired upload or a policy change.

## The two artifact records, and why they are two

| | where | what it is |
|---|---|---|
| `dist/release.json` | ships inside the artifact, served at `/release.json` | the release's own identity — who built it, from what, for where |
| `provenance.json` | uploaded beside `dist/`, never shipped | binds that identity to the **artifact tree digest** and to the run that produced it |

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
      stamp dist/release.json + provenance.json (asserting the built bytes)
      upload  frontend-release-<run id>-<run attempt>
 └─ Publish (publish.yml)        on a successful Certify of main, or a manual dispatch
      gate     no credential. Checks out ITS OWN revision (github.sha) with full
               history, resolves the certifying run through the API by workflow PATH,
               downloads the candidate BY ARTIFACT ID with digest-mismatch: error,
               measures it as data, reads the certified commit from git (source,
               storage declaration, firebase.json AND .firebaserc), the served
               identity and the peers, and evaluates lib/decide.mjs. Emits the
               decision and the admitted record.
      publish  the ONLY job that references FIREBASE_SERVICE_ACCOUNT, and only in the
               tool step. No npm ci, no build, no application source: the verifier
               PINNED to the gate's revision, main's release/ tree (to notice a policy
               that moved), the certified commit's two hosting files, and the admitted
               artifact by id. Inside one critical section it re-establishes the record
               (lib/preflight.mjs), stages the payload beside a REGENERATED hosting
               pair, publishes with a PINNED firebase-tools, then fetches the identity
               AND every certified file back.
```

Every run ends in one outcome word (`lib/outcome.mjs`): `REFUSED`, `SKIPPED_IDENTICAL`,
`SKIPPED_STALE`, `PREFLIGHT_REFUSED`, `WOULD_PUBLISH`, `PUBLICATION_FAILED`,
`PUBLISHED_VERIFIED` or `PUBLISHED_DEGRADED`. The four failing ones turn the run red.
`RESTORED_AFTER_FAILURE` is never produced: nothing restores anything automatically.

## What merging does

A workflow that runs automatically after a merge has an operational effect, and "no
dispatch was run" is not a release-safety argument. So, stated plainly:

- **`certify.yml` runs on every push to `main`.** Read-only, no secret. It spends a
  runner, builds the shipping configuration and uploads a 30-day artifact. It deploys
  nothing.
- **`publish.yml` runs after every successful Certify.** Its gate evaluates everything
  and today **refuses** (see "The first publication" below), so the gate job goes red
  on every merge and the publish job is skipped. The summary says why, groups the
  outstanding owner prerequisites under a heading that says they are expected, and
  names `deploy-prod.yml` as the live path. A red Publish run is this path saying it
  would not publish; it says nothing about the build being broken and changes nothing
  that is live.
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
  `publish.yml`, in the tool step's `with`; it never reaches a shell. Every checkout in
  `publish.yml` and `certify.yml` sets `persist-credentials: false`; `publish.yml` has
  `permissions: {}` at the top and each job `contents: read` + `actions: read`. No
  expression is interpolated into a script in either file, or in `ci.yml`.
- **Actions and `firebase-tools` are pinned.** A tag can be repointed; an unpinned
  `firebase-tools` resolves `latest` at run time inside the job holding the credential.

These are pinned statically by `tests/workflow-drift.test.mjs` and executed by
`tests/workflow-simulation.test.mjs`.

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
| backend (`9448f55`) | **operator receipt**: the repository is private, so the receipt is produced by an operator from the backend's git and reviewed as a file. No backend credential is given to anything that runs repository code, and no public endpoint was added. | **unavailable** until the backend publishes a served-revision identity (B3). Refused as `peers.backend_serving_unverified`; an operator statement is not accepted as serving evidence. |
| admin (`38df037`) | **public-repository receipt**, re-derived at decision time through the API (tree and `deploy.yml` blob). Identity only: this application holds no Admin protocol, and the receipt's `assumptions` say why. | `https://admin.dinifyapp.com/release.txt`, required `no-store` and in the approved set. Re-read inside the publisher's critical section. |

**Cross-repository changes remain an ordered, manual sequence.** This gate is the only
path that consults `compatibleSet`; the backend's own deploy and `deploy-prod.yml` make
no compatibility decision. What this makes true is narrow: on THIS path, a candidate
paired with an unapproved or incompatible peer revision is refused. It does not make a
one-sided change unreleasable — the other side's own deploy can still ship it — so the
order is: merge the peer, produce a receipt from its git at the merged commit, approve
that receipt here in a reviewed pull request. Two consequences of the committed state:

- the approved backend revision predates the capability export, so the gate refuses
  `peers.capabilities_unpublished` until a receipt for a backend commit carrying
  `orders_app/contracts/published_capabilities.contract.json` is approved;
- **every Admin promotion makes this path refuse** `peers.admin_serving_unapproved`
  until a receipt for the new Admin commit is approved. That is the ordered
  coordination made visible, and it is deliberate.

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
audit either: it is a conservative limit, kept until B2's candidate-inventory rescan
exists — which is what would let an already-certified payload be re-admitted without
rebuilding it.

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
| `peers.capabilities_unpublished` | approving a receipt for a backend commit carrying the capability export |
| `peers.backend_serving_unverified` | B3: the backend publishing a served-revision identity |
| `served.bootstrap_unauthorized` | an explicit, reviewed `bootstrap.authorized: true` with `servedBaseline` naming the live commit. That commit must carry the storage declaration, i.e. be at or after the commit that introduced it |

`peers.backend_serving_unverified` has no owner action available today: it needs B3.
Until then this path cannot publish, and says so, rather than accepting an operator's
word for which backend is live.

### The cutover

**Setting `FRONTEND_PUBLISH_ENABLED` while `deploy-prod.yml` still exists is not a
cutover**: the site would have two independent writers, only one of them serialised or
gated. The cutover presupposes that every other refusal in the table is already
resolved — B3 included — and it is ONE reviewed change that deletes `deploy-prod.yml`,
records the prerequisites, and authorizes the bootstrap with `servedBaseline` naming the
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

`npm run test:release` runs the CLI self-test, then 477 tests in about 25 seconds
(Node 24, four cores; most of it is the workflow simulation). Each is labelled
**REGRESSION** (pins a finding reproduced before its fix: on `3386724` for the
baseline, on `ce6b892` for what review on #687 found), **CONTRACT** (a rule this
change introduces) or **CONTROL** (something that must not change).

| file | tests | what it proves |
|---|---|---|
| `decide.test.mjs` | 125 | the refusal matrix: one allowed baseline, each case breaking exactly one fact |
| `policy.test.mjs` | 43 | the policy is validated before anything is evaluated; every decision-bearing field |
| `publisher.test.mjs` | 58 | the admitted record, the critical section, the outcome vocabulary, a `no-store` identity required for `PUBLISHED_VERIFIED` |
| `hosting.test.mjs` | 43 | destination resolution, the allow-list, the ignore proof, regeneration, the identity's `Cache-Control` before publishing |
| `hosting-oracle.test.mjs` | 20 | the model against the installed firebase-tools' own functions, and the header model against superstatic's own matcher and middleware |
| `storage.test.mjs` | 43 | set containment, the declaration, where the bytes are, the tripwire |
| `peers.test.mjs` | 30 | receipts from real git, public verification, serving over real TLS |
| `manifest.test.mjs` | 48 | the stamp and the manifest schema |
| `contract.test.mjs` | 9 | the D01 digest across languages |
| `workflow-simulation.test.mjs` | 31 | `publish.yml` EXECUTED: real scripts, real CLI, real git checkouts, local HTTPS origins and an observable stand-in publisher |
| `workflow-drift.test.mjs` | 22 | the three workflow files held to the policy, statically |
| `committed-policy.test.mjs` | 5 | the committed policy's exact refusal set, through the real `decide` |

**The simulation is production-shaped, not GitHub.** It parses and runs `publish.yml`
with GitHub's expression semantics; `actions/*` and the Firebase action are stand-ins
that behave as documented (the publisher one resolves its destination with
firebase-tools' own functions and can be told to fail, fail after publishing, drop a
file or publish something else). It has no queueing, concurrency groups, OIDC, runner
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

- **B2** — a candidate-inventory rescan (dependency audit over the certified payload).
  Until it exists the 24-hour window stays, and nothing here claims an audit.
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

`lib/decide.mjs`, `lib/preflight.mjs` and `lib/outcome.mjs` are pure — no clock, no
filesystem, no network — which is what lets the refusal matrix run from fixtures. The
adapter and simulation suites then prove the CLI feeds them what the world says.
