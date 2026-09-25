/**
 * The I/O the release contract needs, and nothing else: walking a tree as data,
 * reading git objects, calling the GitHub API through `gh`, and reading a public
 * identity over HTTPS. Kept apart from `release/cli.mjs` so the adapters can be
 * imported by a test without the command dispatcher running, and apart from the pure
 * modules so it is obvious which code touches the world.
 *
 * EVERY READ HERE REPORTS FAILURE AS DATA. A caller that gets `{ok: false}` or
 * `{state: 'unreadable'}` has to decide what that means; nothing here converts "I
 * could not find out" into "there is nothing there".
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, lstatSync, existsSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import { digestOfValue, sha256Hex, treeDigest } from './canonical.mjs';
import { EVIDENCE_DIR, inspectEvidenceBundle } from './dependency-evidence.mjs';
import { cacheControlIsNoStore } from './hosting.mjs';
import { validateManifest, validateProvenance } from './manifest.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;

// ── walking a tree as DATA ──────────────────────────────────────────────────────

export const SAFE_ENTRY = /^[A-Za-z0-9._][A-Za-z0-9._@+-]*$/;

/**
 * Walk a directory as DATA. Returns the regular files with their digests, and every
 * entry it refused, so a caller can report the refusal rather than silently skipping.
 * Symlinks, devices, sockets and unusual names are refused: an uploaded artifact is
 * untrusted input to the one job that holds the publishing credential.
 */
export function walkTree(root) {
  const entries = [];
  const unsafe = [];
  const visit = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = prefix ? posix.join(prefix, name) : name;
      if (!SAFE_ENTRY.test(name)) { unsafe.push(`unsafe name: ${rel}`); continue; }
      const st = lstatSync(full);
      if (st.isSymbolicLink()) { unsafe.push(`symbolic link: ${rel}`); continue; }
      if (st.isDirectory()) { visit(full, rel); continue; }
      if (!st.isFile()) { unsafe.push(`not a regular file: ${rel}`); continue; }
      entries.push({ path: rel, sha256: sha256Hex(readFileSync(full)), size: st.size });
    }
  };
  visit(root, '');
  return { entries, unsafe };
}

/**
 * Read every regular file under `root` into memory, keyed by its relative path, refusing
 * what walkTree refuses. For the SMALL bundles a promotion carries (dependency evidence,
 * an assessment) — never for a payload or a toolchain.
 */
export function readFilesUnder(root) {
  if (!existsSync(root) || !statSync(root).isDirectory()) return { files: new Map(), unsafe: [] };
  const walked = walkTree(root);
  const files = new Map(walked.entries.map((e) => [e.path, readFileSync(join(root, e.path))]));
  return { files, unsafe: walked.unsafe };
}

/**
 * Measure a downloaded candidate (`<root>/dist` + `<root>/provenance.json` +
 * `<root>/dependency-evidence/`). The observation carries the file list, the tree digest,
 * the inner manifest and its digest, the provenance's expected digests, and the
 * dependency evidence as inspected facts — all as data for the decision.
 *
 * The evidence bundle sits BESIDE dist/, never inside: it is not part of the hosted
 * payload, is not in the payload's tree digest, and is never staged for publication.
 */
export function observeCandidate(root, { artifactId = null } = {}) {
  const distDir = join(root, 'dist');
  const out = { present: false, artifactId, unsafeEntries: [], files: [] };
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    out.unsafeEntries.push('artifact carries no dist/ directory');
    return out;
  }
  for (const name of readdirSync(root)) {
    if (name !== 'dist' && name !== 'provenance.json' && name !== EVIDENCE_DIR) out.unsafeEntries.push(`unexpected artifact entry: ${name}`);
  }
  const walked = walkTree(distDir);
  out.present = true;
  out.unsafeEntries.push(...walked.unsafe);
  out.entryCount = walked.entries.length;
  out.files = walked.entries.map((e) => e.path);
  out.observedTreeDigest = walked.entries.length > 0 ? treeDigest(walked.entries) : null;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(distDir, 'release.json'), 'utf8'));
  } catch (error) {
    out.manifestValid = false;
    out.manifestProblems = [{ code: 'manifest.unreadable', detail: String(error.message) }];
  }
  if (manifest !== undefined) {
    const check = validateManifest(manifest);
    out.manifest = manifest;
    out.manifestDigest = digestOfValue(manifest);
    out.manifestValid = check.ok;
    out.manifestProblems = check.problems;
  }
  let provenance;
  try {
    provenance = JSON.parse(readFileSync(join(root, 'provenance.json'), 'utf8'));
  } catch (error) {
    out.provenanceValid = false;
    out.provenanceProblems = [{ code: 'provenance.unreadable', detail: String(error.message) }];
  }
  if (provenance !== undefined) {
    const check = validateProvenance(provenance, manifest);
    out.provenanceValid = check.ok;
    out.provenanceProblems = check.problems;
    out.expectedTreeDigest = provenance?.artifactTreeDigest;
    out.provenance = { schema: provenance?.schema ?? null, legacy: check.legacy === true };
  }
  // THE DEPENDENCY EVIDENCE, as facts. An old (/1) candidate carries none, and says so
  // through `provenance.legacy`; the decision refuses it by name.
  const bundle = readFilesUnder(join(root, EVIDENCE_DIR));
  const expected = out.provenance && !out.provenance.legacy && out.provenanceValid ? provenance.dependencyEvidence : null;
  const inspected = inspectEvidenceBundle(bundle.files, expected);
  out.dependencyEvidence = { ...inspected, unsafe: bundle.unsafe };
  if (inspected.state === 'present' && !expected && !out.provenance?.legacy) {
    out.dependencyEvidence.problems = [...inspected.problems, { code: 'evidence.not_bound', detail: 'the provenance binds no dependency evidence' }];
  }
  return out;
}

/**
 * A prepared TOOLCHAIN directory, as data. Wider name rules than walkTree (npm scopes
 * begin with `@`), and the same refusals: a symbolic link, a device, a socket, an unusual
 * name, and anything at the top level other than the manifest, the lockfile and
 * node_modules/ — so no .npmrc, hook or second entrypoint can ride along.
 */
export const TOOLING_ENTRY = /^[A-Za-z0-9._@][A-Za-z0-9._@+~-]*$/;
export const TOOLING_TOP_LEVEL = Object.freeze(['node_modules', 'package-lock.json', 'package.json']);

export function walkTooling(root) {
  const entries = [];
  const unsafe = [];
  if (!existsSync(root) || !statSync(root).isDirectory()) return { entries, unsafe: ['no toolchain directory'], treeDigest: null };
  for (const name of readdirSync(root)) if (!TOOLING_TOP_LEVEL.includes(name)) unsafe.push(`unexpected top-level entry: ${name}`);
  const visit = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = prefix ? posix.join(prefix, name) : name;
      if (!TOOLING_ENTRY.test(name)) { unsafe.push(`unsafe name: ${rel}`); continue; }
      const st = lstatSync(full);
      if (st.isSymbolicLink()) { unsafe.push(`symbolic link: ${rel}`); continue; }
      if (st.isDirectory()) { visit(full, rel); continue; }
      if (!st.isFile()) { unsafe.push(`not a regular file: ${rel}`); continue; }
      entries.push({ path: rel, sha256: sha256Hex(readFileSync(full)), size: st.size });
    }
  };
  visit(root, '');
  return { entries, unsafe, treeDigest: entries.length ? treeDigest(entries) : null };
}

// ── git ─────────────────────────────────────────────────────────────────────────

/** Run git in `cwd`. Throws, with git's own message, on a non-zero exit. */
export function git(cwd, args, { buffer = false } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: buffer ? 'buffer' : 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const err = buffer ? r.stderr.toString('utf8') : r.stderr;
    throw new Error(`git ${args.join(' ')}: ${String(err).trim() || `exit ${r.status}`}`);
  }
  return r.stdout;
}

export function gitSucceeds(cwd, args) {
  const r = spawnSync('git', args, { cwd, stdio: 'ignore' });
  return r.status === 0;
}

/** The bytes of `path` at `commit`, or null when it is not there. */
export function gitShow(cwd, commit, path) {
  if (!gitSucceeds(cwd, ['cat-file', '-e', `${commit}:${path}`])) return null;
  return git(cwd, ['show', `${commit}:${path}`], { buffer: true });
}

/**
 * How `target` relates to `from`, by ancestry — never by timestamp, because "which of
 * these commits is newer" is exactly the question ancestry answers and a clock does not.
 *   identical   the same commit
 *   descendant  target descends from `from` (moving forward)
 *   ancestor    target is an ancestor of `from` (moving backward)
 *   divergent   neither
 *   unknown     one of them is not in this clone
 */
export function relationOf(cwd, from, target) {
  if (!SHA_RE.test(String(from)) || !SHA_RE.test(String(target))) return 'unknown';
  if (from === target) return 'identical';
  const known = (sha) => gitSucceeds(cwd, ['cat-file', '-e', `${sha}^{commit}`]);
  if (!known(from) || !known(target)) return 'unknown';
  if (gitSucceeds(cwd, ['merge-base', '--is-ancestor', from, target])) return 'descendant';
  if (gitSucceeds(cwd, ['merge-base', '--is-ancestor', target, from])) return 'ancestor';
  return 'divergent';
}

// ── the GitHub API, through gh ──────────────────────────────────────────────────

/**
 * `gh api <path>`, parsed. Never throws: a failure comes back with the HTTP status
 * when gh reported one. No `--jq`, no `--paginate` and no shell pipe — the raw answer
 * is parsed here, so an exit status cannot be lost inside a pipeline and a truncated
 * page is visible to the caller (via `total_count`) rather than silently merged.
 */
export function ghApi(path) {
  const r = spawnSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', path], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) return { ok: false, status: null, detail: String(r.error.message) };
  if (r.status !== 0) {
    const m = /HTTP (\d{3})/.exec(String(r.stderr ?? ''));
    return { ok: false, status: m ? Number(m[1]) : null, detail: String(r.stderr ?? '').trim().slice(0, 300) };
  }
  try {
    return { ok: true, status: 200, json: JSON.parse(r.stdout) };
  } catch (error) {
    return { ok: false, status: null, detail: `unparseable response: ${error.message}` };
  }
}

/** A run object, as the decision reads it. */
export function runFacts(run) {
  return {
    present: true,
    id: run.id,
    repository: run.repository?.full_name,
    headRepository: run.head_repository?.full_name,
    workflowPath: run.path,
    event: run.event,
    headBranch: run.head_branch,
    headSha: run.head_sha,
    status: run.status,
    conclusion: run.conclusion,
    runId: String(run.id),
    runAttempt: String(run.run_attempt),
    runStartedAt: run.run_started_at,
  };
}

/** An artifact listing entry, as the decision reads it. */
export function artifactFacts(a) {
  return {
    id: a.id,
    name: a.name,
    expired: a.expired,
    digest: a.digest ?? null,
    sizeInBytes: a.size_in_bytes,
    workflowRunId: a.workflow_run?.id ?? null,
    headSha: a.workflow_run?.head_sha ?? null,
  };
}

// ── public identities over HTTPS ─────────────────────────────────────────────────

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { redirect: 'manual', signal: controller.signal, cache: 'no-store' });
    const text = await response.text();
    return { ok: true, status: response.status, text, cacheControl: response.headers.get('cache-control') };
  } catch (error) {
    return { ok: false, detail: String(error?.cause?.code ?? error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The frontend's served identity (`/release.json`), classified.
 *   known       a valid manifest; carries its digest
 *   absent      nothing has published one (404, or the SPA's HTML rewrite)
 *   unreadable  anything else, with a detail — fail closed, never "absent"
 */
export async function readServedIdentity(origin, path, { timeoutMs = 15000 } = {}) {
  const url = `${origin}${path}`;
  const out = { state: 'unreadable', url };
  const r = await fetchText(url, timeoutMs);
  if (!r.ok) {
    out.detail = r.detail;
    return out;
  }
  out.status = r.status;
  out.cacheControl = r.cacheControl;
  out.cacheControlNoStore = cacheControlIsNoStore(r.cacheControl ?? '');
  if (r.status === 404) {
    out.state = 'absent';
  } else if (r.status === 200) {
    try {
      const manifest = JSON.parse(r.text);
      const check = validateManifest(manifest);
      if (check.ok) {
        out.state = 'known';
        out.manifest = manifest;
        out.manifestDigest = digestOfValue(manifest);
        out.servedCommit = manifest.commit;
      } else {
        out.detail = `served identity invalid: ${check.problems.map((p) => p.code).join(',')}`;
      }
    } catch {
      // Firebase rewrites an unmatched path to index.html, so a genuinely absent
      // identity file answers 200 with HTML. Anything else unparseable is unreadable.
      if (r.text.trimStart().startsWith('<')) out.state = 'absent';
      else out.detail = 'served identity is neither JSON nor the SPA document';
    }
  } else {
    out.detail = `unexpected status ${r.status}`;
  }
  return out;
}

/**
 * A peer's public identity: a plain-text file holding exactly one full commit SHA,
 * served `no-store` (Admin's `release.txt`).
 */
export async function readPublicCommitIdentity(origin, path, { timeoutMs = 15000 } = {}) {
  const url = `${origin}${path}`;
  const r = await fetchText(url, timeoutMs);
  if (!r.ok) return { state: 'unreadable', url, detail: r.detail };
  const noStore = cacheControlIsNoStore(r.cacheControl ?? '');
  const body = r.text.trim();
  if (r.status !== 200) return { state: 'unreadable', url, detail: `status ${r.status}`, noStore, cacheControl: r.cacheControl };
  if (!SHA_RE.test(body)) return { state: 'unreadable', url, detail: 'body is not exactly one full commit SHA', noStore, cacheControl: r.cacheControl };
  return { state: 'known', url, commit: body, noStore, cacheControl: r.cacheControl };
}

/**
 * Fetch every certified file back from the origin and compare its bytes. Bounded
 * concurrency; each result is recorded, never summarised away.
 */
export async function fetchBackFiles(origin, entries, { timeoutMs = 15000, concurrency = 8 } = {}) {
  const mismatched = [];
  const unreachable = [];
  let checked = 0;
  let index = 0;
  const worker = async () => {
    while (index < entries.length) {
      const entry = entries[index];
      index += 1;
      const url = `${origin}/${entry.path.split('/').map(encodeURIComponent).join('/')}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, { redirect: 'manual', signal: controller.signal, cache: 'no-store' });
        const bytes = Buffer.from(await response.arrayBuffer());
        checked += 1;
        if (response.status !== 200) unreachable.push(`${entry.path}: status ${response.status}`);
        else if (sha256Hex(bytes) !== entry.sha256) mismatched.push(entry.path);
      } catch (error) {
        checked += 1;
        unreachable.push(`${entry.path}: ${String(error?.cause?.code ?? error?.message ?? error)}`);
      } finally {
        clearTimeout(timer);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length || 1) }, worker));
  return { checked, mismatched: mismatched.sort(), unreachable: unreachable.sort() };
}
