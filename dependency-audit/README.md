# dependency-audit

A required dependency audit (D08 B2.1): what was inspected, what the advisory data says
about it, and one policy decision — enforced inside the existing pull-request `validate`
check AND the merged-main `certify` job. The same policy runs in Dinify-Admin (this
directory, byte-identical except `policy.json`, this README and `tests/workflow.test.mjs`)
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
| any severity on a runtime package | **blocking** |
| moderate / low / info on tooling | visible, **triage required** — counted, never reported as zero findings |
| anything the policy cannot evaluate (unknown severity on tooling, unknown scope below high) | **incomplete** |

Four outcomes, and the process exit status follows them:

| outcome | exit | meaning |
|---|---|---|
| `within_policy` | 0 | complete; nothing the policy blocks |
| `exceptions_only` | 0 | complete; passes ONLY because of approved, unexpired exception records — the headline says so |
| `blocking` | 1 | complete; a blocking finding, or a disposition record was refused |
| `incomplete` | 2 | no trustworthy result: scanner, network, parse, coverage, binding or provenance failure |

**An incomplete audit fails the required check.** An empty report, truncated JSON, an error
body, a scanner that timed out or never ran, a count that is not the lock graph, an
exit status the body contradicts, or an inventory that moved since the snapshot is never
read as clean. npm uses exit 1 both for "vulnerabilities found" and for "the audit
failed", so the status is only accepted when the body agrees with it.

**Every vulnerability the report declares is accounted for, or the audit is incomplete.**
Being unable to interpret a reported vulnerability is not evidence that there is none.
The contract is the pinned scanner's own (npm 11.19.1, Arborist 9.9.1): `vulnerabilities`
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

## Exceptions and triage records

`policy.json → records` is empty, and **nothing in this change approves anything.** A record
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

## What this does not cover

Stated so none of it is inferred:

- **The live deploy consumes NO validation result, this audit included.**
  `deploy-prod.yml` runs on every push to main, re-installs, builds and publishes,
  whatever `validate` or `certify` concluded. Until the reviewed cutover deletes it, this
  audit enforces what is VALIDATED and CERTIFIED, not what is live. A test pins that
  disclosure.
- **Publisher tooling is not bound to any lockfile, so it is not certified here.**
  `publish.yml` runs `firebase-tools` 15.30.2 and `deploy-prod.yml` runs
  `firebase-tools@latest`, each resolved at run time by the hosting action with no
  lockfile; the application lockfile's `firebase-tools` devDependency (and its
  `overrides`) is a different graph that happens to share a name. A one-off scan of
  15.30.2 as it resolved on 2026-09-24 (673 packages) found 7 moderate findings and no
  high/critical — including `uuid` GHSA-w5hq-g745-h8pq, which the application graph's
  `overrides` pin keeps out of the application graph but not out of the publisher's. That
  scan describes that day's resolution, not what a publication installs. Binding the
  publisher graph and re-auditing an unchanged retained candidate before promotion are the
  next B2 delivery, as is the 24-hour promotion freshness window.
- **Not audited here:** the GitHub Actions used by the workflows (the hosting action's
  bundled code included), the runner image's tooling, and anything on a host.
- **Branch protection is not changed.** "The audit is wired into `validate`" and "GitHub
  settings prevent bypassing `validate`" are separate facts; this change establishes only
  the first.
