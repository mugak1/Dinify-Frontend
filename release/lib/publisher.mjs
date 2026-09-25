/**
 * THE PUBLISHER INVOCATION — how the admitted toolchain is run, and how its answer is
 * read. It replaces FirebaseExtended/action-hosting-deploy in publish.yml (D08 B2.2).
 *
 * WHY THE ACTION WENT. It ran `npx firebase-tools@<version>`: a version string resolved
 * over the network at run time, in the one job holding the service-account credential,
 * with nothing binding the transitive graph that ran to any graph anybody reviewed or
 * scanned. Pinning its `firebaseToolsVersion` fixed the top package and nothing under it.
 *
 * WHAT IS REPRODUCED, from the pinned action's own source (v0 at 7c850a4 → 500ac62,
 * src/index.ts, src/deploy.ts, src/createGACFile.ts):
 *   - firebase.json must exist at the entry point, or nothing is attempted;
 *   - the service-account JSON goes to a temporary file named by
 *     GOOGLE_APPLICATION_CREDENTIALS, which is how the CLI authenticates;
 *   - `deploy --only hosting:<target> --project <project> --json`, with
 *     FIREBASE_DEPLOY_AGENT set;
 *   - the JSON answer is parsed, and `status: "error"` fails the step with its message.
 *
 * WHAT IS DELIBERATELY NOT REPRODUCED:
 *   - the automatic RETRY with --debug. A failed deploy is a mutation whose outcome may
 *     be partial; re-running it automatically is a second publication attempt nobody
 *     admitted. The failure is reported, and `verify-served` judges what the origin
 *     actually serves.
 *   - `npx`, `latest`, any download, and the ambient environment. The entrypoint is an
 *     absolute path inside the admitted toolchain, run by the exact Node the record
 *     names, with an environment built from nothing: no NODE_OPTIONS, no npm_*, no
 *     FIREBASE_TOKEN, no GitHub token, and a fresh HOME so no stored login, config or
 *     update check from the runner is read.
 *   - the credential file outliving the step: it is written 0600 inside a fresh 0700
 *     directory and removed whatever the tool does.
 *
 * Pure: building the argv and environment, and reading the answer. The CLI does the I/O.
 */

import { join, resolve } from 'node:path';

/** Environment variables a runner may legitimately need to reach Google (a proxy, a CA). */
const PASSTHROUGH = Object.freeze([
  'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'RUNNER_TEMP',
]);

/**
 * @param {object} input
 * @param {object} input.policy          the release policy (destination, deploy agent)
 * @param {object} input.record          the admitted record (entrypoint)
 * @param {string} input.toolingRoot     the admitted toolchain directory
 * @param {string} input.stage           the staged directory (regenerated config + payload)
 * @param {string} input.credentialPath  where the service-account JSON was written
 * @param {string} input.home            a fresh, empty HOME
 * @param {object} input.baseEnv         the step's environment, read only for PASSTHROUGH
 */
export function publishInvocation({ policy, record, toolingRoot, stage, credentialPath, home, baseEnv = {} }) {
  const env = {
    PATH: '/usr/bin:/bin',
    HOME: home,
    GOOGLE_APPLICATION_CREDENTIALS: credentialPath,
    FIREBASE_DEPLOY_AGENT: policy.publisher.deployAgent,
    NO_UPDATE_NOTIFIER: '1',
    CI: 'true',
  };
  for (const key of PASSTHROUGH) if (typeof baseEnv[key] === 'string' && baseEnv[key] !== '') env[key] = baseEnv[key];
  // ABSOLUTE, both: the tool runs with the staged directory as its working directory, so a
  // relative toolchain path would name a file under the stage, never the admitted one.
  return {
    entrypoint: join(resolve(toolingRoot), record.publisher.entrypoint.path),
    args: [
      'deploy',
      '--only', `hosting:${policy.hosting.target}`,
      '--project', policy.hosting.project,
      '--non-interactive',
      '--json',
    ],
    cwd: resolve(stage),
    env,
  };
}

/**
 * Read the tool's `--json` answer. The CLI prints one JSON document; anything before it
 * is noise from a dependency and is ignored only up to the last line that opens one.
 * Success needs BOTH a zero exit and `status: "success"` — either alone is not an answer.
 */
export function readPublishResult({ status, stdout, signal = null, error = null }) {
  if (error) return { ok: false, state: 'not-run', detail: String(error) };
  if (signal) return { ok: false, state: 'killed', detail: `the tool was killed by ${signal}` };
  const text = String(stdout ?? '').trim();
  let parsed = null;
  const candidates = [text];
  const lastOpen = text.lastIndexOf('\n{');
  if (lastOpen >= 0) candidates.push(text.slice(lastOpen + 1));
  for (const c of candidates) {
    try { parsed = JSON.parse(c); break; } catch { /* try the next */ }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, state: 'unreadable', detail: `exit ${String(status)}; the tool's answer is not a JSON result` };
  }
  if (parsed.status === 'success' && status === 0) return { ok: true, state: 'success', detail: 'the tool reported success' };
  if (parsed.status === 'error') return { ok: false, state: 'error', detail: String(parsed.error ?? 'the tool reported an error') };
  return { ok: false, state: 'contradictory', detail: `exit ${String(status)} with status ${JSON.stringify(parsed.status)}` };
}
