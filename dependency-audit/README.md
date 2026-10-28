# dependency-audit

A required dependency audit (D08 B2.1): what was inspected, what the advisory data says
about it, and one policy decision — enforced inside the existing pull-request `validate`
check AND the merged-main `certify` job. The same policy runs in Dinify-Admin (this
directory, byte-identical except `policy.json`, this README and `tests/workflow.test.mjs`;
Admin carries the same `lib/retained.mjs`, scanner diagnostics included, and the same
`tests/retained.test.mjs`, see `release/README.md` → "Scanner diagnostics")
and in Dinify-Backend (`dependency_audit/`, the Python port). `conformance.json` is identical in all three, and each suite pins its
digest.

**A clean application test suite is not a dependency audit, and a scheduled audit that no
required check consumes is not a gate.** This directory puts the audit inside the
required check.

## What is inspected

| graph | what it is | how it is inventoried |
|---|---|---|
| `application` | the lock graph `npm ci` installed for this job | `package-lock.json` (the graph `npm audit` reads — measured: arborist `audit()` calls `loadVirtual()`), reconciled against a walk of `node_modules` |
| `scanner` | the pinned npm that performs the scan | `scanner/package-lock.json`, installed with `npm ci --ignore-scripts` into `scanner/node_modules` |

The inventory is **refused**, not scanned, if the installed tree is not the lock graph: a
locked package that is absent without an explanation, a different installed version, an
extraneous package, a lockfile that does not match `package.json`, a declared dependency
missing from the graph, or an empty graph. Locked-but-absent packages are explained the
way npm decides them: a platform (`os`/`cpu`/`libc`) mismatch, an `engines.node` range this
Node does not satisfy, or an optional subtree npm pruned because its only dependents were
themselves skipped. On Node 24.21.0 this repository's 1277 locked packages are 1143
installed plus 120 platform and 14 pruned-subtree absences — every one accounted for.

A package is **runtime** unless its lock entry is `dev` only, in which case it is
**tooling**. `devOptional` (a dev package that is also an optional dependency of a
non-dev one) is runtime, the stricter scope. A devDependency classification decides which
rule applies; it is not evidence that the package never executes or cannot affect the
artifact.

## The policy

| finding | decision |
|---|---|
| critical or high, any scope | **blocking** |
| high on tooling, INHERITED and inside its 7-day window (see "Dated obligations" below) | **deferred** — provenance from the base, the date from GitHub (A-2, below) |
| any severity on a runtime package | **blocking** |
| moderate / low / info on tooling | visible, **triage required** — counted, never reported as zero findings |
| anything the policy cannot evaluate (unknown severity on tooling, unknown scope below high) | **incomplete** |

Five outcomes, and the process exit status follows them:

| outcome | exit | meaning |
|---|---|---|
| `within_policy` | 0 | complete; nothing the policy blocks |
| `exceptions_only` | 0 | complete; passes ONLY because of approved, unexpired exception records — the headline says so |
| `obligations_pending` | 0 | complete; passes ONLY because an inherited high tooling finding is inside its dated window — the headline says so, with the date it starts to block |
| `blocking` | 1 | complete; a blocking finding, or a disposition record was refused |
| `incomplete` | 2 | no trustworthy result: scanner, network, parse, coverage, binding or provenance failure |

Precedence: `incomplete` > `blocking` > `obligations_pending` > `exceptions_only` >
`within_policy`.

### Dated obligations (CI-signal A-1): the evaluator half

Disposition records apply first, unchanged. Then a finding the policy would block, and
that no record covers, is **deferred** (class `deferred`, a `deadline`, counted under
`deferred`) only when ALL of these hold:

- its scope is `tooling` and its severity is `high` — **critical is never deferred**, and
  moderate, low and info stay triage;
- its optional `provenance` is exactly `"inherited"` (the advisory was already reportable
  for the base the change was made on, so the change did not introduce it);
- its optional `reportableSince` is a calendar date `YYYY-MM-DD`, by the same check records
  use, no later than the decision day;
- the decision is made before 00:00 UTC on the deadline, `reportableSince` +
  `HIGH_DEFERRAL_DAYS` (7). The window is a constant beside the rule in `lib/core.mjs`,
  not a `policy.json` value: changing it is a reviewed code change in all three
  repositories.

Anything not established blocks, exactly as before: a missing, `null`, malformed or
unknown provenance; a missing, `null`, malformed, impossible or future date; a deadline
already reached. It never falls back to deferral, and never to incomplete. The one
exception is a provenance or date of the wrong JSON type (a number, a boolean, a list, an
object): that is an adapter that could not fill in a finding, which the existing
malformed-finding rule answers — **incomplete**. `null` reads as absent, as the existing
rule already treats it for the required fields. Each deferred finding gets a
`deferred_finding` reason naming its deadline, and the headline names the earliest one.

**Byte for byte when nothing is deferred.** Until A-2 no adapter emitted `provenance` or
`reportableSince`, so no result carried the new outcome; since A-2 they are emitted only
for an audit given a base (next section). A result in which nothing was deferred is
byte-identical to the one the evaluator produced before the rule: `counts.deferred`, a
finding's `deadline` and the `deferred_finding` reason appear ONLY when a deferral
applied. That is load-bearing, because the release consumers re-decide retained results
and compare `counts` exactly; an always-present `deferred: 0` would make every result
certified before A-1 unreproducible. **The runtime self-test holds it too** (A-2
follow-up): `lib/self-test.mjs` compares each vector's deferred deadlines exactly and
refuses a result that carries `counts.deferred`, a `deadline` or the `deferred_finding`
reason when the vector deferred nothing, so a build whose unit suite was never run still
cannot pass the gate with an evaluator that emits `deferred: 0` or dates a deadline a day
late. `tests/core.test.mjs` pins the full result of each of the 41 vectors that predate
the rule, by digest; the same digests are pinned in Dinify-Backend's Python suite, because
the two evaluators already produced identical bytes.

The shared vectors are now 61 (the 41 before, plus 20 deferral vectors appended after
them), digest `6365e880c55153f5ce50ca144434cb42d5c937be48218445da36cefb8ffb9653`,
byte-identical in the three repositories. The release consumers' passing set accepts
`obligations_pending` and nothing else new.

### Provenance and the clock (CI-signal A-2): the adapters supply both inputs

A-1's rule needs two facts per finding. A-2 supplies them from evidence, and nothing else
can: there is no flag that sets a provenance or a date.

**Provenance is read from a base commit, through git.** `audit --base <commit>` reads
`package-lock.json` and `dependency-audit/scanner/package-lock.json` as that commit held
them (`git show`). A finding is `inherited` only when the base lock has an entry at the
SAME path with the same `version` and the same `integrity`. Anything else is `introduced`:
a path the base does not hold, a package that moved to another path, a changed version or
integrity. **A BUNDLED entry carries no `integrity` of its own** (it ships inside its
bundling package's tarball: all 143 bundled entries of the committed scanner lock's 144),
so for it a version match proves nothing — npm 12 could bundle a different file under the
same version. It is `inherited` only when the NEAREST ancestor that has an integrity (the
bundling package) is itself unchanged in the base, by path, version and integrity;
otherwise it is `introduced` (A-2 follow-up, `npm.mjs` `provenanceOf`). A base with no
lockfile for a graph makes every finding of that graph introduced. The base must be in the
clone and an ancestor of HEAD; otherwise it is recorded as `unavailable`, with the reason,
and treated as no base. **With no base** (an empty or all-zero `--base`, a push that
created a branch, a force push, the scheduled re-scan) findings carry no provenance and
nothing can be deferred, which is today's rule. The collection records the base commit and
each base lock's digest, and `evaluate` re-derives both from git: a base that no longer
reproduces is incomplete (`evidence_base_mismatch`).

**The date is GitHub's, asked once and retained.** After the scans `lib/advisories.mjs`
asks `GET https://api.github.com/advisories/{ghsa_id}` once per distinct GHSA id among the
findings a date could DEFER — an INHERITED, HIGH, TOOLING finding (`awaitsDate`) — from a
child process: 15 seconds per request, no redirects, and the token only when one is given
(`GH_TOKEN`, which the scanner never sees). A critical, a runtime finding, a lower
severity and an introduced finding are never asked about: a date changes nothing for them,
so they simply carry no date (the A-2 follow-up narrowed this; before it every finding
with a provenance was asked about). Dating is unchanged: a date the record holds is
applied to any finding with a provenance, so evidence retained before the narrowing
re-decides byte-identically. `reportableSince` is the UTC calendar date of
`github_reviewed_at`, else of `published_at`. Every answer (a record, a failure, a rate
limit, a timeout) is retained in `advisories.json`, each body with its own digest, and the
collection names the file's digest. **An answer that is not a record of THAT advisory with
a valid date gives no date, and the finding blocks**: an outage, a 403 or a 404 never
defers anything, and never makes the audit incomplete either. A tampered or missing
`advisories.json` is incomplete (`evidence_tampered`, `evidence_unreadable`).

**Re-deciding never asks.** `evaluate` and every release consumer read `advisories.json`
back and re-apply its dates. A result re-decided from its retained evidence at the same
instant is byte-identical; the deadline passing is the same evidence re-decided at a
later instant. Evidence without `advisories.json` (every result before A-2) carries no
provenance and re-decides exactly as before.

**What a run costs**: one request per distinct GHSA id on inherited high tooling findings in
the application and scanner graphs, and none without a base. Unauthenticated, GitHub allows
60 requests an hour per address; with the job token, 1,000 an hour per repository.

**The summary says why a high was not deferred**: `blocking (introduced: not in the base)`,
`blocking (inherited, reportable since <date>; its window has closed)`, or
`blocking (inherited; no reportable date)`. A deferred one reads
`deferred: inherited, blocks from <date>`.

**Where the base comes from in this repository.** `validate` (`ci.yml`) passes
`github.event.pull_request.base.sha || github.event.before`: the pull request's base on a
PR, the previous tip on a push to main. `certify` (`certify.yml`) passes
`github.event.before`. Both pass `github.token` as `GH_TOKEN`, and both grant it
`contents: read` and nothing else: `certify.yml` at the workflow, and `validate` at the
job since the A-2 follow-up (it used to take the repository's default grant). The weekly
`audit.yml` re-scan passes no base, so it decides by today's rule. **At promotion** the
fresh assessment (`release/cli.mjs assess`) gives the application and scanner graphs
provenance against the candidate's OWN retained locks (nothing can be introduced into
fixed bytes, so an unchanged package is inherited and a trusted scanner that moved since
certification makes what changed introduced). **Its dates are REUSED from the
certification** wherever the candidate's own retained `advisories.json` (digest-bound in
its evidence record) holds a date for the advisory; only an id it does not date is asked
about, and that question is asked WITH the job's token from a separate step that runs no
scanner, no package manager and no candidate code (A-2 follow-up; see
`release/README.md`). Every advisory nobody could date still blocks. **The publisher graph
is never given provenance**: a high there blocks whatever GitHub says, and is never asked
about. `decide` and the publish preflight re-read the retained `advisories.json` and never
ask; an obligation's deadline cuts the assessment's promotion window short. See
`release/README.md` → "CI-signal A-2".

**An incomplete audit fails the required check.** An empty report, truncated JSON, an error
body, a scanner that timed out or never ran, a count that is not the lock graph, an
exit status the body contradicts, or an inventory that moved since the snapshot is never
read as clean. npm uses exit 1 both for "vulnerabilities found" and for "the audit
failed", so the status is only accepted when the body agrees with it.

**Every vulnerability the report declares is accounted for, or the audit is incomplete.**
Being unable to interpret a reported vulnerability is not evidence that there is none.
The contract is the pinned scanner's own (npm 11.21.1, which bundles Arborist 9.9.3; the
files that produce the report are byte-identical to npm 11.19.1's — see
`release/README.md` → "The scanner moves to npm 11.21.1"): `vulnerabilities`
is an object keyed by package name, and each entry's `via` holds either an advisory
object (whose `name` and `dependency` are that package) or a STRING naming another entry
the package is vulnerable through. Arborist links every such name before it writes the
report, so a string cause is ordinary and never itself a finding — the finding is the
advisory it leads to, attributed to the advisory's own package, counted once per
(advisory, path). What the reader refuses as **incomplete** (exit 2, raw output and
diagnosis retained):

| shape | reason code |
|---|---|
| `vulnerabilities`, `metadata`, a counter block or an entry that is not the container npm writes (a list, `null`, a scalar); a `via`/`nodes` that is not a non-empty list; a `via` member that is neither a name nor an advisory object | `scanner_shape` |
| counters that do not add up to the entries, a severity distribution the entries do not have, an entry or advisory naming a different package, an entry less severe than its own advisory, an exit status the severity counters contradict | `scanner_inconsistent` |
| a string cause naming an entry the report does not list | `scanner_dangling_cause` |
| an entry no advisory is reachable from — including a cycle of string causes with nothing concrete in it | `scanner_ungrounded` |
| an entry declared more severe than any advisory it reaches | `scanner_unaccounted` |
| an entry on a runtime path whose reachable advisories are attributed to tooling only | `scanner_unattributed` |

A cycle is NOT refused for being a cycle — only when nothing in it reaches an advisory —
and the traversal is a bounded worklist, so a long or cyclic chain can neither hang nor
overflow the stack. An empty `vulnerabilities` object with zero counters is a legitimate
clean report. Optional fields npm omits stay optional; nothing here is a general schema.

**The invocation is hardened because narrowing is invisible.** Measured on main
(`1d22826`, npm 11.19.1): with an inherited `NODE_ENV=production`, `npm audit --json`
reported **zero** vulnerable packages where it otherwise reports seven, while
`metadata.dependencies.total` counted all 1,277 packages either way. So
the scanner runs with every dependency type `--include`d, `--package-lock=true`, the
public registry named explicitly, and `NODE_ENV`, `NODE_OPTIONS` and every `npm_*`
variable removed from its environment.
The job's token and the runner's five file-command paths (`GITHUB_ENV`, `GITHUB_PATH`,
`GITHUB_OUTPUT`, `GITHUB_STEP_SUMMARY`, `GITHUB_STATE`) are withheld from it too. That is not a
boundary, since a process on the same runner can still find those files; the boundary is that
the scanner is the pinned, integrity-checked npm, run with scripts disabled.
The audit level is pinned too (`--audit-level=low`, npm's own default): it moves only the
exit code, never the JSON body, but npm reads it from any npmrc the environment scrub
cannot reach, and the exit-status check above assumes it. Measured with the pinned npm, an
`audit-level=none` in `~/.npmrc` made a five-moderate report exit 0; a command-line value
outranks every npmrc, so the invocation and the check cannot disagree.

## Exceptions and triage records

**One record is approved today**: the 2026-10-24 TOOLING exception for the scanner's
bundled `undici` 6.29.0 (GHSA-xjj6-f33q-929c), which expires on 2026-11-30 (see "2026-10-24,
the scanner graph" below). `records` was empty from 2026-10-23 until then. Nothing is
triaged, and lower-severity tooling findings are still reported and still require triage.

Five exception records, all TOOLING scope, existed before then. Three were approved
2026-09-30 for the SCANNER graph's bundled `undici` and `brace-expansion`, and two on
2026-10-03 for the scanner-bundled `http-cache-semantics` and the APPLICATION graph's
development-tooling `braces` 3.0.3. All five were removed on 2026-10-23, and the removals
are not all fixes:

| record | removed | label |
|---|---|---|
| `undici` GHSA-rfgv-xxqx-mfg5 (scanner) | 2026-10-23, `ce024dd` | REMEDIATED: npm 11.21.1 bundles `undici` 6.29.0, above the fix boundary |
| `brace-expansion` GHSA-qhr7-859c-m2p7 (scanner) | 2026-10-23, `ce024dd` | REMEDIATED: npm 11.21.1 bundles `brace-expansion` 5.0.12, above the fix boundary |
| `brace-expansion` GHSA-6j4f-fj2g-mc7p (scanner) | 2026-10-23, `ce024dd` | REMEDIATED: as above |
| `http-cache-semantics` GHSA-ch52-4w7c-c8xp (scanner) | 2026-10-23, `5404ec9` | STALE, NOT a remediation: the bundled copy is now 4.3.0, outside the advisory's recorded range, but the code behind the vulnerability is unchanged |
| `braces` GHSA-vfj7-8cjw-p6xm (application) | 2026-10-23, `08a0a7f` | STALE, NOT a remediation: GitHub withdrew the advisory on 2026-10-23; `braces` 3.0.3 is unchanged |

The two stale removals carry residual risk, not a fix: if either advisory is reinstated or
its range widened, the audit blocks again with no record. `release/README.md` → "The
scanner moves to npm 11.21.1" has the evidence for each.

**`braces` is no longer reported in any graph**, because the advisory was withdrawn;
`braces` 3.0.3 is still installed in the application graph. A publisher-graph finding
still cannot be excepted by a record (paths admit only `application:` and `scanner:`), so
a blocking-class finding there (high, critical or runtime) blocks until that lock changes,
while a lower-severity one stays visible as requiring triage. The publisher lock's `chokidar` override,
added to remove `braces` from that graph, is a publisher decision and is unchanged. No
runtime finding was ever excepted.

**A record comes out in the same change that fixes or removes its affected dependency**, or
once its advisory no longer reports it — from then on it matches nothing, and the audit
refuses a stale record rather than ignoring it.

A record
is refused — and the audit is `blocking` — unless it names the advisory (and aliases),
the exact package, the exact version, the exact graph paths and the scope; carries
applicability evidence and a reason; names an owner; links the mugak1 pull request or issue
that approved it, with who and when; and expires within 90 days of that approval. Wildcards,
ranges, an extra path that matches no current finding, a record that matches nothing
(stale), a mismatched version or scope, a triage record on a blocking finding, an
exception on a triage finding, duplicate ids and unknown fields (an `approved: true` flag,
say) are all refused. A record is valid through the day before `expires`.

**Which advisories are the same is the scanner's statement, never the record's.** A record
names a finding through the finding's own identifier or an alias the scanner reported for
it, and every alias the record lists must be one the scanner reports for that finding. An
alias it does not corroborate refuses the record — otherwise a record for one advisory
could list a second as its "alias" and except both on one approval.

`kind: "exception"` covers a blocking finding; `kind: "triage"` records the decision on a
lower-severity tooling finding. Neither is self-approving: the schema can check that
provenance is *stated*, not that the linked review exists — that is the reviewer's job.

## How it runs

```
npm ci
npm run audit:snapshot   # offline — right after install, before any repository code
…                        # every existing gate, plus `npm run test:audit` (offline matrix)
npm run audit:deps       # NETWORK — self-test, then the bound scan and the decision
```

Both `validate` (ci.yml) and `certify` (certify.yml) run exactly that sequence — the
release suite's CONTROL test already holds the two jobs to identical `npm ci` / `npm run`
commands in identical order, so the audit cannot drift out of one of them. In `certify`
the scan runs BEFORE the candidate is built, stamped or uploaded: a blocking or incomplete
audit leaves no candidate, and `publish.yml` only ever follows a successful Certify run.

`audit:deps` refuses to scan anything but the snapshotted inventory, installs the pinned
scanner, scans both graphs, re-checks the inventory before and after each scan, and writes
`evidence/`: `snapshot.json`, `collection.json` (bindings, argv, exit statuses, digests),
`result.json` (the decision), and each graph's complete raw stdout and stderr. CI uploads
it as the artifact `dependency-audit-<run>-<attempt>` whether the job passed or not — a
different name from the candidate, which the publisher selects by its exact name.
`node dependency-audit/cli.mjs evaluate` re-decides retained evidence offline, and refuses
evidence recorded for another revision, lockfile or environment, or raw output that is not
the bytes that were recorded.

`./scripts/verify.sh` runs the same sequence; the network step is labelled as such and a
failed scan fails the run.

## The state at delivery

`main` (1d22826) audits **within policy with 15 lower-severity tooling findings that
REQUIRE TRIAGE** — seven advisories (`@opentelemetry/core`, `body-parser`, `csv-parse`,
`qs` ×3, `stream-json`), every one moderate or low and every one on a dev-only path
through `firebase-tools`, `exegesis` or `karma`. None blocks.

This change corrects the lock entries that have an in-range fix, with `npm update
body-parser qs express --package-lock-only --before=2026-09-20` (no `package.json`
edit, no override, no `--force`, no package added): the nested `body-parser` under
`firebase-tools`, `karma` and `exegesis` 1.20.4 → 1.20.8, `firebase-tools`'s nested
`express` 4.22.1 → 4.22.3, and the three nested `qs` 6.14.2 copies that the fixed
`body-parser` range lets dedupe away. Both built configurations are byte-identical to
main's. **The delivered head audits within policy with 3 findings requiring triage**,
and none of them has a fix this change may take:

| advisory | package | why it stays |
|---|---|---|
| GHSA-8988-4f7v-96qf | `@opentelemetry/core` 1.30.1 | fixed in ≥2.8.0; every `@google-cloud/pubsub` 5.x pins `^1.30.1`, and the first on `^2.8.0` is 6.0.1 — a major, excluded by `firebase-tools`' `^5.2.0` |
| GHSA-8cw4-87c7-c6xx | `csv-parse` 5.6.0 | fixed in ≥7.0.2; `firebase-tools` ≤15.30.2 pins `^5.0.4` |
| GHSA-528h-pc64-c93x | `stream-json` 1.9.1 | affects ≤3.4.0; `firebase-tools` ≤15.30.2 pins `^1.7.3` |

`firebase-tools` 15.31.0 moves the last two to `^7.0.2` / `^3.6.0` and is inside the
`^15.22.0` range, but it was published 2026-09-23T23:26Z — after the `--before` cutoff and
less than a day before this change, the same rule that stopped Admin's `hono` at 4.13.8.
None is triaged, because no triage record is approved by this change.

**The publisher graph (D08 B2.2), measured 2026-09-25.** The reviewed `release/publisher`
lock (`firebase-tools` 15.31.0, 672 packages) audits within policy with 2 moderate
findings requiring triage — `@opentelemetry/core` GHSA-8988-4f7v-96qf and `uuid` 9.0.1
GHSA-w5hq-g745-h8pq. 15.31.0 already carries the fixed `csv-parse` and `stream-json`
ranges. Nothing is triaged or excepted, and a record could not cover them anyway (record
paths admit only `application:` and `scanner:`).

**Re-measured 2026-10-01, after the `uuid` override.** `release/publisher/package.json`
now carries the same scoped override the application graph has (`gaxios` → `uuid`
11.1.1), so that graph's only `uuid` 9.0.1, which `gaxios` 6.7.1 asks for as `^9.0.1`, is
11.1.1. The lockfile diff is that one entry. The graph now audits within policy with ONE
moderate finding requiring triage, `@opentelemetry/core` GHSA-8988-4f7v-96qf, which still
has no fix this graph can take (see the table above). `gaxios` uses `uuid` only for
`v4()` as a multipart boundary; a request built with 11.1.1 in the prepared toolchain was
checked against a local server, and `prepare-publisher` still installs 672 locked packages
with no problems.

**2026-10-23: `zod` blocks, and three lock-only updates clear it.** GHSA-mrhx-c7xc-m3w5
(`zod`, high, fixed in 4.6.6) reached the advisory feed this day. `main` (`cb6d8cb`) locks
`zod` 4.6.5, and `@angular/forms` 22.2.1 depends on `zod` `^4.0.10` without being `dev`, so
the finding is runtime. Measured at 21:56Z, `main` audits **BLOCKING: 10 findings, 1
blocking, 9 requiring triage**. `@angular/cli` 22.2.2 pins `zod` to exactly 4.6.5, and 22.2.3
pins 4.6.6, inside the declared `~22.2.0`. Three updates, each `npm update <names>
--package-lock-only --ignore-scripts --before=2026-10-22` with npm 11.21.1, in this order:

- `ip-address` 10.7.2 → 10.7.4, `fast-uri` 3.1.7 → 3.1.9 and `postcss-selector-parser`
  6.1.4 → 6.1.5. 6.1.5 is the upstream 6.x backport of the GHSA-rj75-hqrm-r3gf fix, but the
  advisory data still lists it as affected, so that finding stays.
- `firebase-tools` 15.28.2 → 15.34.1, inside `^15.22.0`. This brings `csv-parse` 7.0.3 and
  `stream-json` 3.7.0, clears their four advisories, and removes 21 lock entries. The root
  `overrides.basic-ftp` now matches nothing.
- `@angular/cli`, `@schematics/angular` and `@angular-devkit/schematics` 22.2.2 → 22.2.3, with
  their nested `@angular-devkit/core` and `architect`. `zod` becomes 4.6.6. The root
  `@angular/build`, `@angular-devkit/core` and `@angular-devkit/architect` stay at 22.2.0 /
  0.2202.0.

The lock goes from 1289 to 1268 packages: 15 versions change, 21 entries go and none are
added. There is no `package.json` edit, no override and no `--force`. **The head audits within
policy with 3 findings requiring triage**: `@opentelemetry/core` 1.30.1 (the table above),
`postcss-selector-parser` 6.1.5, and the scanner's bundled `ip-address` 10.7.2, which no npm
release yet bundles fixed. No triage or exception record was added. The `uat` and
`production` builds are byte-identical to `main`'s, file by file. That change left the
publisher lock, and its `zod` 4.6.5, as it was; the next entry updates it.

**2026-10-23, the publisher graph: `zod` and `body-parser` block it, and a lock-only update
clears both.** Measured on `main` (`cdb82b8`) at 22:38Z with the pinned npm 11.21.1, the
reviewed `release/publisher` lock (660 entries) audits **BLOCKING: 6 findings, 3 blocking,
3 requiring triage**. The blocking ones are `zod` 4.6.5 (GHSA-mrhx-c7xc-m3w5, high, through
`firebase-tools` 15.31.0 and `@modelcontextprotocol/sdk`) and `body-parser` 1.20.8 and 2.3.0
(GHSA-27r3-jxmh-p828, high, through `firebase-tools`' `express` 4 and the SDK's `express`
5). The triage ones are `hono` 4.13.9 (GHSA-5r4p-p66f-jhc7), `ip-address` 10.7.2
(GHSA-rxp7-6hxx-x8q5) and `@opentelemetry/core` 1.30.1. Two updates, each `npm update
<names> --package-lock-only --ignore-scripts` with npm 11.21.1, in this order:

- `hono`, `ip-address` and `zod`, with `--before=2026-10-22`: `hono` 4.13.9 → 4.13.13,
  `ip-address` 10.7.2 → 10.7.4 and `zod` 4.6.5 → 4.6.7.
- `body-parser`, with `--before=2026-10-23`, because its fixes were published 2026-10-22
  (1.20.9 at 11:38Z, 2.4.0 at 11:39Z): `body-parser` 1.20.8 → 1.20.9, the SDK's nested
  `body-parser` 2.3.0 → 2.4.0, and `qs` 6.16.0 → 6.16.1, which 2.4.0 requires.

Six entries change and none are added or removed. There is no `package.json` edit, no
override and no `--force`, and `firebase-tools` stays at 15.31.0. **The head audits within
policy with 1 finding requiring triage**, `@opentelemetry/core` 1.30.1, which still has no fix
this graph can take (the table above).

**2026-10-23, the application graph: `body-parser` blocks it, and a lock-only update clears
it.** The same GHSA-27r3-jxmh-p828 reaches the application graph through four
development-tooling copies: `body-parser` 1.20.8 under `exegesis`, `firebase-tools` and
`karma`, and 2.3.0 at the top level. Measured on `main` (`cdb82b8`) at 22:31Z, `audit:deps`
is **BLOCKING: 7 findings, 4 blocking** (the four copies), so `validate` fails on every pull
request. One update, `npm update body-parser --package-lock-only --ignore-scripts
--before=2026-10-23` with npm 11.21.1: the three nested copies 1.20.8 → 1.20.9, the top-level
copy 2.3.0 → 2.4.0, `iconv-lite` 0.7.2 → 0.7.3, and a nested `qs` 6.16.1 under the top-level
`body-parser`, which 2.4.0 requires (the top-level `qs` stays 6.16.0). The lock goes from 1268
to 1269 packages: one entry is added and none removed, there is no `package.json` edit, and
every changed entry is dev-only. **The head audits within policy with 3 findings requiring
triage**: `@opentelemetry/core` 1.30.1, `postcss-selector-parser` 6.1.5 and the scanner's
bundled `ip-address` 10.7.2, as before the advisory appeared. `test:ci` passes 3420/3420, and
the `uat` and `production` builds are byte-identical to `main`'s, file by file.

**2026-10-24, the scanner graph: `undici` blocks it, no fix exists, and one exception
record covers it until 2026-11-30.** GitHub published GHSA-xjj6-f33q-929c (`undici`, high;
fixed in 6.29.1, 7.30.1 and 8.12.2) at 22:14Z on 2026-10-23. The pinned scanner, npm
11.21.1, bundles `undici` 6.29.0 (`inBundle` in `scanner/package-lock.json`), and a bundled
dependency cannot be replaced by a lockfile or an override. Measured on `main` (`5e83da1`)
at 19:31Z on Node 24.22.1, `audit:deps` is **BLOCKING: 5 findings, 1 blocking, 4 requiring
triage**, so `validate` fails on every pull request and `certify` builds no candidate. The
application graph is not affected: #759 moved its copies to 8.12.3 and 6.29.1.

No scanner change can clear it. Measured from the published tarballs, npm 11.21.1 (the
latest 11.x) and npm 12.2.1 (the `latest` tag, which supports Node 24) both bundle `undici`
6.29.0, and no later npm exists. The record `scanner-undici-GHSA-xjj6-f33q-929c` excepts
exactly that advisory (alias `npm:1243114`, as this repository's scan reports it), that
version and the path `scanner:node_modules/npm/node_modules/undici`, in TOOLING scope. Admin
carries the same record (mugak1/Dinify-Admin#48) with the same expiry.

Its applicability was measured here, on Node 24, not taken from Admin's Node 20 run. The
only requirer of `undici` in the bundle is `node-gyp/lib/download.js` (node-gyp 12.4.0). A
preload that records every module file resolved through `Module._resolveFilename` and
`module.registerHooks` was run with the scanner's exact argv, cwd and scrubbed environment,
against both graphs. Neither audit resolved any file under `node_modules/undici`, and both
returned complete reports. Neither resolved `node-gyp/lib/download.js`; they resolved
`node-gyp/bin/node-gyp.js` only through `require.resolve`, for npm's `node-gyp` config
default, which runs none of its code. Positive controls under the same probe (requiring
`download.js`, and requiring `undici` from the bundle) each recorded 95 `undici` files.
The accepted residual risk is that the scanner loads `undici` on a path those runs did not
take.

**The head audits passing only with approved exceptions: 5 findings, 1 under approved
exception, 4 requiring triage** (`@opentelemetry/core` 1.30.1, `postcss-selector-parser`
6.1.5, and the scanner's `ip-address` 10.7.2 and `undici` GHSA-4qv8-2p9j-2685, which the
record does not cover). No triage record was added.

The record lapses at 00:00 UTC on 2026-11-30 and is not extended automatically; from then
the scanner graph blocks again. Remove it in the same change that moves the scanner to an
npm that bundles `undici` 6.29.1 or later. If none exists by then, renewing it is a separate
reviewed change, together with Admin's.

**2026-10-25, the publisher graph: `undici` blocks it, and a lock-only update clears it.**
The same GHSA-xjj6-f33q-929c reaches the reviewed `release/publisher` lock through two
copies: `undici` 6.29.0, which `firebase-tools` 15.31.0 requires as `^6.19.0`, and
`node-gyp`'s nested `undici` 8.11.2, required as `^8.4.1`. The previous publisher update
(#760) merged before the advisory reached the npm feed. Readiness runs `40128009591` (on
`a0786ca`) and `40194952415` (on `c673b83`) each refused with
`dependency.assessment_blocking`. A record cannot cover a publisher finding. Measured on
`main` (`c673b83`) at 12:58Z on Node 24.21.0 with the pinned npm 11.21.1, the lock (660
entries) audits **BLOCKING: 10 findings, 2 blocking, 8 requiring triage**. The blocking
findings are GHSA-xjj6-f33q-929c on both `undici` copies. The triage findings are `undici`
GHSA-4qv8-2p9j-2685 (both copies) and GHSA-f72v-6w45-q472 (the nested copy), four `fast-uri`
3.1.8 advisories (GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr, GHSA-xhq7-xmqj-769h,
GHSA-333x-w4r6-6crp), and `@opentelemetry/core` 1.30.1. One update, `npm update undici
fast-uri --package-lock-only --ignore-scripts --before=2026-10-22` with npm 11.21.1 on Node
24.21.0, makes these changes:

- `undici` 6.29.0 → 6.29.1, published 2026-10-15.
- `node-gyp`'s `undici` 8.11.2 → 8.12.3, published 2026-10-19.
- `fast-uri` 3.1.8 → 3.1.9, published 2026-10-19, the version the application lock already
  uses.

Three entries change and none are added or removed. There is no `package.json` edit, no
override and no `--force`, and `firebase-tools` stays at 15.31.0. **The head audits within
policy with 1 finding requiring triage**, `@opentelemetry/core` 1.30.1, which still has no
fix this graph can take (the table above).

## What consumes this evidence (D08 B2.2)

The release path uses this directory three ways, and changes none of its rules:

- **`certify` retains it WITH the candidate.** After the build, `release/cli.mjs stamp`
  re-evaluates `evidence/` against the tree as it then stands (`reevaluate`) and refuses
  to stamp if any dependency input moved; it then copies the retained `package.json`,
  `package-lock.json`, snapshot, collection, result and raw outputs into
  `dependency-evidence/` beside `dist/`, bound by `provenance.json`. The artifact
  `dependency-audit-<run>-<attempt>` is still uploaded, but nothing selects it: "the
  newest audit artifact" is not a binding.
- **The gate re-derives it.** The raw outputs are re-read and re-evaluated under the
  policy the evidence names; a result the raw answer does not reproduce is refused.
- **The gate queries again.** `release/cli.mjs assess` runs `lib/retained.mjs` — written
  here for B2.2, copied byte for byte by Admin's B2.4, and since extended to keep a
  sanitized, bounded projection of the scanner's own debug log per graph (#709, carried
  into Admin by mugak1/Dinify-Admin#36; `release/README.md` → "Scanner diagnostics"); it composes the SHARED, unchanged
  `npm.mjs` reader, hardened scanner
  environment and `core.mjs` evaluator, so `conformance.json` and the shared files stay
  byte-identical with Admin and Backend — over a scan-only replay of the retained two
  files, over the scanner's own graph and over the prepared publisher toolchain, with the
  same pinned scanner and `--audit-level=low`, and decides under the TRUSTED checkout's
  `policy.json` — never the candidate's retained copy.

Two limits worth knowing. **Record paths admit only `application:` and `scanner:`**, so a
PUBLISHER-graph finding cannot be excepted or triaged by a record: high/critical there
blocks until the lock changes, and lower severity stays visible. And the B2.1 collection
records one moment as its start, finish and decision; the certification evidence calls it
`invokedAt`, while the fresh assessment records a real start and finish.

## What this does not cover

Stated so none of it is inferred:

- **The live deploy consumes NO validation result, this audit included.**
  `deploy-prod.yml` runs on every push to main, re-installs, builds and publishes,
  whatever `validate` or `certify` concluded. Until the reviewed cutover deletes it, this
  audit enforces what is VALIDATED and CERTIFIED, not what is live. A test pins that
  disclosure.
- **The publisher toolchain is bound and assessed by the release path, not by this
  audit's `validate`/`certify` run** (D08 B2.2). `publish.yml` no longer runs the hosting
  action: its toolchain is the reviewed `release/publisher` lock (`firebase-tools`
  15.31.0), installed in the gate by this directory's pinned npm with scripts disabled,
  assessed there as a third graph under THIS policy, and run by the publisher from that
  exact prepared tree — see `release/README.md` → "Dependencies". `deploy-prod.yml` still
  runs `firebase-tools@latest`, resolved at run time with no lockfile, and nothing here
  or there audits it.
- **Not audited here:** the GitHub Actions used by the workflows (the hosting action's
  bundled code included), the runner image's tooling, and anything on a host.
- **Branch protection is not changed.** "The audit is wired into `validate`" and "GitHub
  settings prevent bypassing `validate`" are separate facts; this change establishes only
  the first.
