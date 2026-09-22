# The release contract

**This file explains. `policy.json` and `lib/` enforce.** Nothing here is the gate:
if a rule matters, it is a field the committed policy states and `lib/decide.mjs`
reads, with a test in `tests/` that proves refusal. A statement that lives only in
prose is a statement nothing checks.

---

## What a release of this application is

```
(repository, commit, build configuration, dependency-lock digest,
 artifact tree digest, certifying run)
```

A commit SHA on its own is **not** a release. One commit produces different bytes
under different configurations, and the difference is not cosmetic: it decides which
API origin the bundle talks to. So the unit that is certified and the unit that is
published are the same tuple, and the publisher refuses anything whose tuple it
cannot establish.

## The two records, and why they are two

| | where | what it is |
|---|---|---|
| `dist/release.json` | ships inside the artifact, served at `/release.json` | the release's own identity — who built it, from what, for where |
| `provenance.json` | uploaded beside `dist/`, never shipped | binds that identity to the **artifact tree digest** and to the run that produced it |

An artifact cannot contain its own final hash. So the digest lives outside the
payload, and the hashed set is defined exactly: **every regular file under `dist/`**,
each entry length-prefixed and NUL-delimited so the encoding is injective whatever a
path contains. `release.json` *is* inside that set — which is only possible because
it does not contain the digest.

The digest is over the **tree**, not over an archive. A tar of the same files differs
by timestamp, ordering and compression level, so an archive digest would move without
the release moving and the gate would become noise.

## The pipeline

```
push to main
   └─ Certify (certify.yml)          no credential, read-only permissions
        type-check · lint · release gate · tenant-boundary gate · full suite
        build the production configuration      (the existing pre-merge contract)
        build the SHIPPING configuration ONCE   ← the candidate
        stamp dist/release.json + provenance.json
        upload  frontend-release-<sha>
   └─ Publish (publish.yml)
        gate     no credential. Re-resolves the certifying run by workflow PATH,
                 downloads the candidate AS DATA, measures it, reads the served
                 identity, and evaluates lib/decide.mjs.
        publish  the ONLY job that may hold FIREBASE_SERVICE_ACCOUNT. Two sparse
                 checkouts and the artifact — no npm ci, no build, no application
                 source. Re-verifies the digest of its OWN download, publishes with
                 a PINNED firebase-tools, then re-reads /release.json from the
                 public origin and fails if it does not name the published commit.
```

**Publication is disabled.** `FRONTEND_PUBLISH_ENABLED` is not set, so the final step
is skipped and the job reports the decision it would have acted on. `deploy-prod.yml`
is untouched and remains the live path. Enabling the variable and retiring
`deploy-prod.yml` is the cutover, and it is its own small reviewed change.

## Trust boundaries

- **The gate's code and policy come from the default branch**, never from the
  candidate. A candidate that supplied its own policy could relax its own gate.
- **The hosting configuration comes from the certified commit**, so the headers that
  would be applied are the ones reviewed at that commit — and it is checked for
  `predeploy` / `postdeploy` hooks, which are shell commands the publish tool
  executes. A trusted deploy tool may run in the credential-holding job; a hook
  specified by the thing being published may not.
- **The artifact is bound to the trusted run by being fetched with that run's id.**
  Only that run can have uploaded it. A digest recomputed over arbitrary bytes proves
  only that they hash to themselves, so the recomputation is compared against the
  digest in the provenance record retrieved from that run.
- **Actions are pinned to reviewed commits.** A tag can be repointed by its owner at
  any time. The version each SHA corresponds to is recorded beside it so an update is
  a small reviewable change.
- **`firebase-tools` is pinned too.** Left at the action's default it resolves
  `latest` at run time — an unpinned executable fetched from the network into the one
  job holding the service-account credential.

## Compatibility

### Peers are pinned, never "latest"

`policy.json → compatibleSet` names the backend and admin commits this frontend is
released beside, the capability levels that backend publishes, and the digest of the
D01 ceiling contract it enforces. An unchanged component is pinned explicitly; that is
what makes "the compatible set" a thing that exists rather than a thing recalled.

The policy pins the **peers** and describes this application by its **requirements**.
It cannot pin the frontend's own commit: a repository file cannot contain the SHA of
the commit that introduces it.

### The D01 ceiling contract

The request ceilings are the backend's. This repository holds a synchronized copy so
the basket can refuse an over-ceiling order before the round trip. Before this
contract, each side asserted its own copy against its own constants — and the backend's
cross-repository assertion skips whenever Dinify-Frontend is not checked out beside
it, which in CI is always. **Two independently checked copies are not parity.**

What closes it is a digest over the ceiling **values**, in a canonical form Python and
JavaScript produce byte for byte:

```
python3 -c 'import json;print(json.dumps(values, sort_keys=True, separators=(",",":")))'
node    -p  'require("./release/lib/canonical.mjs")'   // canonicalJson(values)
```

Keys beginning `_` are provenance notes for a human reader and are excluded, so the
two repositories may annotate their copies differently and still agree. A ceiling
changed on one side and not the other cannot be released, whichever side moved.

### The storage rollback barrier

A rollback is a client downgrade, and an older bundle's reader meets records a newer
one wrote. For the checkout record that is not a cosmetic problem: the pre-v2 reader
rejects any record whose `phase` is unset, a v2 record has `stage`, so the old reader
reads `null`, **mints a fresh idempotency key, and the server's duplicate-order
guarantee is bypassed at the moment of the rollback.**

So the manifest records two numbers and the gate compares both:

| field | moves when |
|---|---|
| `checkoutRecordVersion` | the persisted record's SHAPE changes (`CHECKOUT_RECORD_VERSION`) |
| `semanticsRevision` | a policy or protocol transition changed what a record MEANS without moving the version |

The second exists because D06 changed the meaning of stored checkout state several
times without touching the version. **Equality of `CHECKOUT_RECORD_VERSION` alone is
not sufficient**, and treating it as sufficient is the failure this field prevents.

A rollback that would lower either number is **refused**, not warned about and not
offered behind an acknowledgement checkbox. Moving *forward* across a storage version
is not blocked: a newer bundle upgrades an older record deliberately.

## What the gate cannot currently establish

These are recorded as unknowns rather than assumed, and each refuses rather than
proceeds:

- **Firebase Hosting release retention for this site.** A rollback target must still
  exist where it would be promoted from. This repository cannot establish that from
  source, so `served.targetRetained` is reported as `unknown` and a rollback is
  refused. Establishing retention — and writing the rollback runbook — is an owner
  action. Note the pinned `firebase-tools` has no `hosting:rollback` command; the
  supported path is the console or the REST API, and it needs confirming before a
  rollback is authorized.
- **The served identity, before anything has published one.** Nothing has ever served
  `/release.json`, so the first publication has nothing to order itself against. That
  is an **explicitly authorized bootstrap** (`policy.json → bootstrap.authorized`),
  not a permanent hole: while it is false, a candidate that cannot be placed in order
  is refused. The same change that sets it should plan to set it back.
- **Which custom domains are mapped to this site.** `identityOrigin` is the canonical
  Firebase site origin for the deploy target. That is not a claim that it is the only
  origin serving this content, and a printed diner QR URL is a long-lived artifact
  whose origin and path continuity must be planned rather than assumed. Nothing here
  redirects, reroutes or reprints anything.

## The shipping configuration

It is `uat`, and that is the honest name for it. It carries the UAT-targeted API
origin, which is the destination this stack has today; Stage B deliberately does not
change any destination. It is not "production" and nothing here calls it that.

What changed is that it now carries the same optimisation, source-map, licence and
**budget** settings as `production`, so the artifact that ships is held to the same
bar as the one CI has always built. The 500 kB initial-bundle entry is a
`maximumWarning`: it prints and exits zero. It was not raised to make anything green.

The environment it bakes sets Angular's `production` flag **false**. That is recorded
in every manifest as `environment.productionFlag` because it is true, not because it
is desirable — the diagnostic behaviour that follows from it should be a written-down
fact rather than a discovery. Changing it is a separate decision about destinations
and isolation, not a tidy-up.

`release/cli.mjs stamp` asserts the approved origin is present in the **built bytes**
and that the forbidden ones are absent. A file replacement that silently did not apply
produces an artifact that passes every source-level check and points at the wrong API;
that assertion is the only thing that can see it.

## Running it locally

```bash
npm run test:release        # the CLI self-test, then the refusal matrix
node release/cli.mjs self-test
node release/cli.mjs stamp --dist dist --commit <sha> --now <iso> ...
node release/cli.mjs observe --root <downloaded artifact>
node release/cli.mjs serve-state
```

`lib/decide.mjs` is pure — no clock, no filesystem, no network — which is what lets
the whole refusal matrix be executed from fixtures with no GitHub and no Firebase.
Every case in `tests/decide.test.mjs` breaks exactly one fact about one allowed
baseline, and the positive controls assert that the same baseline is allowed, so a
gate that refused everything could not pass the suite either.
