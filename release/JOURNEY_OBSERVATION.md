# Journey observation (D16 / D08 B4, B2)

`release/journey-observe.mjs` collects the evidence the journey peer selector
(`release/lib/journey-peers.mjs`, B1) judges, and hands it bytes the operator already
holds. All judgement lives in B1 and in `release/lib/journey-observation.mjs`; the command
is the I/O around them.

It answers one question: **does this evidence establish this expected peer selection, and
at which level?** It does not download, extract, install, reconstruct, verify, admit or
deploy anything. Nothing calls it yet: no workflow, gate or journey consumes its answer.

## The two modes

| mode | reads | asks B1 for | the best it can say |
|---|---|---|---|
| `collect` | GitHub's API, by GET, along fixed read routes | `require: 'metadata'`, by name | `metadata-only` (exit 3) |
| `bytes` | local files only | `require: 'bytes'` | `bytes-correspond-consumer-checks-deferred` (exit 0) |

```
node release/journey-observe.mjs collect --selection <file> --receipt <file> [--observations-out <file>]
node release/journey-observe.mjs bytes   --selection <file> --receipt <file> --observations <file> --archive <file> --record <file>
```

### Exit status and outcome

| exit | `outcome` | meaning |
|---|---|---|
| 0 | `bytes-correspond-consumer-checks-deferred` | B1 hashed the supplied archive, which equals the provider-listed digest, and read the supplied record, whose claims agree with the selection. Every check B1 lists under `deferred` is still the peer consumer's to make. |
| 3 | `metadata-only` | The listing, the run, the attempt's jobs, the commit and the approved receipt agree with the selection. No byte of the candidate was observed. |
| 1 | `refused` | Named reasons: `journey.observe.*` from this layer, `journey.peers.*` passed through from B1 unchanged. |
| 2 | `usage` | The command line or the output destination is unusable. Nothing was requested. |

**No exit status means a verified or admitted candidate.** A result never carries
`verified`, `admitted` or `consumerPassed`, and `descriptorDigest` (B1's
`peerDescriptorDigest`) is non-null only for a bytes-level answer.

stdout is one JSON document (`dinify.journey.peer-observation-result/1`). stderr is one
fixed line, `journey-observe: <outcome>`.

## The expected selection

The selection file is B1's `dinify.journey.peer-selection/1`, stated by the operator:

```json
{
  "schema": "dinify.journey.peer-selection/1",
  "peer": "backend",
  "repository": "mugak1/Dinify-Backend",
  "source": { "commit": "<40-hex approved commit>", "tree": "<40-hex tree>" },
  "receipt": { "commit": "<same commit>", "digest": "sha256:<approved receipt digest>" },
  "producer": { "workflowPath": ".github/workflows/ci.yml", "event": "push", "ref": "refs/heads/main" },
  "run": { "id": "<decimal run id>", "attempt": "<decimal attempt>" },
  "requiredJobs": ["suite (3.12.3)", "reconstruct", "test"]
}
```

Nothing completes or corrects it:

- A selection B1's `checkSelection` does not accept, including one with a malformed nested
  value such as `"source": null`, is refused as `selection_invalid` (exit 1) before any
  request. The refusal echoes nothing about that selection: `peer`, `source`, `run` and
  `receipt` are `null`, so a value that made it malformed is never printed.

- The committed `release/policy.json` must approve **exactly** this commit and receipt
  digest, and the supplied `--receipt` file must hash to that digest. Otherwise the answer
  is `selection_not_approved` or `receipt_not_approved`, before any request, naming the
  selection that needs review.
- A run now at a later attempt is B1's `attempt_superseded`. The collector never reads the
  newer attempt on the selection's behalf, never picks another run, and never reruns
  anything to manufacture an artifact.

## Where `collect` goes, and what bounds it

- **Host.** `https://api.github.com` only, fixed in the module. It is not an option.
- **Routes.** Every path is built from a selection B1's `checkSelection` accepted. The
  repository and workflow file come from B1's reviewed peer format, never from the
  selection text or from any URL an answer carries. `ROUTE_RE` admits exactly six shapes:
  - the workflow file;
  - the run;
  - one attempt;
  - that attempt's jobs page;
  - the run's artifacts page;
  - a commit.

  Download, log and content routes are refused.
- **Requests.** Only GET, with redirects refused (`redirect: 'error'`: Node's `fetch`
  rejects a redirect, reported as `transport_failed`; a client that surfaces the status
  instead gets `redirect_refused`). The budget is at
  most 25 requests: 4 fixed reads, two reads of the run, and up to 10 pages of each
  listing.
- **Time.** Each request has 20 s. The whole collection has 120 s.
- **Size.** Each answer is capped at 4 MiB, read as a bounded stream.
- **Credential.** Read from `GH_TOKEN`, else `GITHUB_TOKEN`, in `collect` only, and
  attached only to the API host. With neither set, no `Authorization` header is sent:
  enough for public metadata, or behind an authenticating egress proxy. The result's
  `collection.credentialAttached` says which applied. The command provisions nothing.
- **Proxy.** Node's `fetch` honours proxy variables only when the operator runs it with
  `NODE_USE_ENV_PROXY=1`.

**Every page, or a refusal.** Page size is 100 and at most 10 pages are read. Each of the
following is refused:

| condition | refusal |
|---|---|
| pages disagree about their total | `pagination_inconsistent` |
| a page holds fewer entries than the total implies | `pagination_truncated` |
| a page holds more entries than the total implies | `pagination_inconsistent` |
| an entry id repeats across pages (a repeated page) | `pagination_repeated` |
| a total needs more than 10 pages | `pagination_unbounded` (after the first page) |
| an answer that is not a listing | `response_malformed` |

**Not an atomic snapshot.** Each document is a separate GET. The run is read first and
last. If its `run_attempt`, `status`, `conclusion`, `head_sha` or `updated_at` differ
between the two reads, the collection is refused as `run_changed_during_collection`, and
collecting again is the operator's decision.

**Stable is not enough.** When the current run and the selected attempt both name the
selected attempt, they are two reads of one attempt. They must then agree on `id`,
`run_attempt`, `head_sha`, `status`, `conclusion`, `workflow_id`, `event`, `head_branch`,
`path` and both repository names, or the collection is refused as
`run_contradicts_attempt`, in either direction, and nothing is saved. B1 reads only the
current run's id and attempt, which is why this layer checks the rest. A current run at a
later attempt is not compared: that is B1's `attempt_superseded`. The same check runs
again when `bytes` reads saved observations back.

That bounds what can change unnoticed. It does not make the reads one transaction: an
artifact expiring between its listing and a later download is the downloader's problem
to detect.

**Transport failures are named and sanitized:**

- `unauthorized`
- `forbidden`
- `rate_limited` (429, or 403 with `x-ratelimit-remaining: 0`)
- `not_found`
- `redirect_refused`
- `http_status`
- `timeout`
- `deadline_exceeded`
- `transport_failed`
- `response_malformed`
- `response_too_large`

No response body, provider message, raw exception text, credential or local path reaches
stdout, stderr or a reason. Every detail is a fixed sentence plus values that matched a
strict shape.

## Private output

`--observations-out` receives the raw API documents exactly as answered, which is what a
later `bytes` run is bound to. They include commit author names and e-mail addresses, so:

- the file must be **new**: an existing file is refused and never touched;
- its directory must be owned by the user and closed to everyone else (mode `0700`);
- it is created mode `0600`;
- it is written only after a complete collection. A collection that failed removes the
  file it reserved.

**Removing it is the operator's responsibility.** The command never deletes a file it did
not just create.

The saved envelope is `dinify.journey.peer-observations/1`. It is bound to the selection
by `selectionDigest`, and carries exactly the workflow, the run, the current run, the job
pages, the artifact pages and the commit.

## `bytes`: offline

- Reads the committed policy and exactly five regular files, each bounded: the selection,
  the receipt, the saved observations, the archive (at most 512 MiB) and the record (at
  most 1 MiB).
- A symbolic link, a directory, an absent file, an oversized file and a file that changes
  while it is read are each refused by name (`bytes_input_*`).
- **No metadata fall back.** A missing archive or record is `bytes_input_missing`; B1 is
  never asked a weaker question.
- Saved observations for another selection are `observations_foreign`. Saved observations
  carrying an archive, a record or a receipt of their own are `observations_invalid`.
  Bytes come only from local files, and the receipt only from the approved file.
- No network, no extraction, no execution. The archive is hashed, never opened.
- **What B1's `deferred` list names stays deferred, word for word.** A record supplied
  beside an archive is not shown to be inside it. The archive's membership is not checked.
  Nothing is reconstructed.

## Tests

`release/tests/journey-observation.test.mjs` drives the module through an injected fake
transport. `release/tests/journey-observe-cli.test.mjs` runs the real command as a
subprocess. The command takes no transport option, so the fake enters as a `node --import`
preload the test writes. That preload trips on, and records, any subprocess, socket or
HTTP client use, and a control shows it catches a real one.

Every network fixture is synthetic. CI contacts no GitHub and needs no credential.

## The backend selection this slice made (pilot-12)

`release/policy.json` now approves backend `0513adb`, replacing `a6b25a6`.

- **What it is:** a SOURCE selection following the accepted #339–#350 merges.
- **How the receipt was made:** produced by the existing `peer-receipt` command from a
  private clone pinned to the merge. It was re-derived independently.
- **What it states:** both export files are byte-identical to `a6b25a6`'s, so the D01
  values and the four capability levels are unchanged.
- **What it does not prove:** matching exported contracts is not proof of every
  cross-application behaviour.
- **Serving is still `unavailable`.** An identity endpoint and a staged installer exist in
  the backend's source, but no verified loaded-runtime identity under the intended release
  does.
