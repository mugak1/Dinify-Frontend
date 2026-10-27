/**
 * RUN THE ACCEPTED JOURNEYS AGAINST THE STACK THAT ACTUALLY SERVES.
 *
 * The orchestrator `.github/workflows/uat-journeys.yml` calls. In order:
 *
 *   1. state what serves — the latest successful deploy runs, the backend's
 *      release and health answers, Admin's release.txt, the bundle's main
 *      script — as LEGACY-GRADE serving evidence (not D08 B3's process identity),
 *      and fail the run if any of them could not be read;
 *   2. refuse unless the served BUNDLE is configured for the API under test, so
 *      a mismatched stack cannot pass;
 *   3. sign the operator in ONCE (password, then the development OTP), mask
 *      everything that comes back, and hand every journey an access token
 *      refreshed for it — so a full run issues ONE OTP;
 *   4. provision the fixture through the operator API, behind the interlock;
 *   5. replay D01 and D07 with the served probes;
 *   6. run each journey as a child process, its output redacted before it is
 *      echoed, after a VERIFIED reset (canonical catalogue, trading on, a clear
 *      board), inside the run's time budget;
 *   7. ALWAYS, on every exit path once a fixture exists, reset and verify again
 *      (best effort, recorded as `final_reset`);
 *   8. write the hash file and the evidence file. Nothing here uploads it: the
 *      workflow scans it with `redact.mjs scan` first and uploads only a clean file.
 *
 * Exit 0 only when every check passed, every skip was a DECLARED one, each
 * journey's PASS + FAIL + SKIP equals its accepted count, and every serving
 * identity field was read.
 *
 *   node e2e/served/run.mjs                 the run
 *   node e2e/served/run.mjs health-gate     the workflow's first step (writes GITHUB_OUTPUT)
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ACCEPTED_COUNTS, DEV_OTP, SERVED_SKIPS, isLoopback, knownSecrets, mask, request,
} from './lib.mjs';
import { kitchenTable, provision, resetBetweenJourneys } from './provision.mjs';
import { runProbes } from './probes.mjs';
import { redactText, redactValue, secretHashes } from './redact.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const E2E = dirname(HERE);

export const EVIDENCE_SCHEMA = 'dinify.frontend.served-journeys/2';
export const GRADE = 'LEGACY-GRADE SERVING EVIDENCE: deploy-run heads, release and health answers, and the bundle '
  + 'filename, read at run time. It is NOT the D08 B3 process-bound identity, which does not exist on the '
  + 'legacy deploy (the backend answers `not_started_by_release_launcher`).';

/** The journeys, in run order. Kitchen follows the checkout scripts so its first
 *  ticket number of the day is never 1–5 while theirs are on the board. */
export const JOURNEYS = Object.freeze([
  { name: 'journey', script: 'checkout-journey/journey.mjs', format: 'checkout', table: 'checkout' },
  { name: 'equivalence', script: 'checkout-journey/equivalence.mjs', format: 'checkout', table: 'checkout' },
  { name: 'recovery', script: 'checkout-journey/recovery.mjs', format: 'checkout', table: 'checkout' },
  { name: 'kitchen', script: 'kitchen-board/kitchen.mjs', format: 'checkout', table: 'kitchen' },
  { name: 'billing', script: 'billing-journey/billing.mjs', format: 'billing', table: null },
]);

// ── the UAT window ───────────────────────────────────────────────────────────

/**
 * The instance runs 11:00–23:00 Europe/London, read from the tz database Node
 * carries (so BST and GMT both hold). A run must END by `close` minus the same
 * 20-minute end margin Admin's and the Backend's window jobs keep, and the gate
 * will not start one with fewer than `minRunMinutes` left before that: the
 * journeys job's own timeout, so a run the gate starts can finish.
 */
export const WINDOW = Object.freeze({
  zone: 'Europe/London', open: 11, close: 23, endMarginMinutes: 20, minRunMinutes: 45,
});

const LONDON = new Intl.DateTimeFormat('en-GB', {
  timeZone: WINDOW.zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const clockParts = (date) => Object.fromEntries(LONDON.formatToParts(date).map((p) => [p.type, p.value]));

export function londonHour(date) { return Number(clockParts(date).hour); }

/** Minutes since midnight in London. */
export function londonMinutes(date) {
  const p = clockParts(date);
  return Number(p.hour) * 60 + Number(p.minute);
}

/** `HH:MM` in London, for messages and the evidence. */
export const londonTime = (date) => { const p = clockParts(date); return `${p.hour}:${p.minute}`; };

/**
 * Minutes left before the run must end today: `close` minus the end margin,
 * minus now. Negative from 22:40 to midnight. Before 11:00 it counts to the
 * coming 23:00, so a healthy instance started early still runs, as before.
 */
export function minutesBeforeClose(date) {
  return WINDOW.close * 60 - WINDOW.endMarginMinutes - londonMinutes(date);
}

/**
 * `run` when the backend answers healthy with enough of the window left;
 * `closing` when it is healthy but too late to finish (NOT RUN); otherwise
 * `outside-window` (NOT RUN — the instance is stopped by design, nothing is
 * wrong) or `down-in-window` (a failure). Pure, so the boundaries are unit-tested.
 */
export function classifyHealth({ healthy, at }) {
  const m = londonMinutes(at);
  if (!healthy) return m >= WINDOW.open * 60 && m < WINDOW.close * 60 ? 'down-in-window' : 'outside-window';
  return minutesBeforeClose(at) >= WINDOW.minRunMinutes ? 'run' : 'closing';
}

// ── the time budget ──────────────────────────────────────────────────────────

/**
 * In minutes. The orchestrated run, from its start to the end of its final
 * reset, has `runMinutes`; a journey gets at most `journeyMinutes`, and less
 * when less of the run is left; none starts with under `minJourneyMinutes`;
 * and `finalResetMinutes` is kept back for the final reset, which is also its
 * limit. The workflow's step and job timeouts are derived from these and
 * `tests/workflow.test.mjs` holds them consistent.
 */
export const BUDGET = Object.freeze({ runMinutes: 30, journeyMinutes: 15, minJourneyMinutes: 3, finalResetMinutes: 3 });
const MINUTE = 60_000;

async function probeHealth(api, attempts = 3) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const r = await request(api, '/api/v1/health/', { timeoutMs: 15000 });
      // The body decides: this route answers 200 with `status: degraded` when the database is down.
      if (r.status === 200 && r.body?.status === 'ok' && r.body?.database === 'connected') return true;
    } catch { /* unreachable */ }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 20000));
  }
  return false;
}

async function healthGate() {
  const api = requiredEnv('JOURNEY_API');
  const healthy = await probeHealth(api);
  const at = new Date();
  const time = londonTime(at);
  const verdict = classifyHealth({ healthy, at });
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `verdict=${verdict}\n`);
  const window = `${WINDOW.open}:00–${WINDOW.close}:00`;
  const latest = WINDOW.close * 60 - WINDOW.endMarginMinutes - WINDOW.minRunMinutes;
  const latestTime = `${String(Math.floor(latest / 60)).padStart(2, '0')}:${String(latest % 60).padStart(2, '0')}`;
  const lines = {
    run: 'UAT answered healthy; the journeys will run.',
    closing: `NOT RUN: UAT answered healthy, but it is ${time} in London. The instance stops at ${WINDOW.close}:00, `
      + `a run must end ${WINDOW.endMarginMinutes} minutes before that, and it is given ${WINDOW.minRunMinutes} minutes, `
      + `so the last start is ${latestTime}. Nothing was provisioned or executed.`,
    'outside-window': `NOT RUN: UAT did not answer, and it is ${time} in London — outside the instance's `
      + `${window} window. Nothing was provisioned or executed. Dispatch again inside the window.`,
    'down-in-window': `FAILED: UAT did not answer healthy at ${time} in London, inside its ${window} window.`,
  };
  console.log(lines[verdict]);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### UAT health\n\n${lines[verdict]}\n`);
  if (verdict === 'outside-window' || verdict === 'closing') console.log(`::notice title=UAT journeys not run::${lines[verdict]}`);
  process.exit(verdict === 'down-in-window' ? 1 : 0);
}

// ── what serves ──────────────────────────────────────────────────────────────

/**
 * Every script the served index reaches, statically or by dynamic import, and
 * every `apiUrl:` literal in them. The environment object survives the
 * optimizer as `{production:!1,apiUrl:\`…\`,…}` (measured on `ng build
 * --configuration=uat`), so the literal is the configured origin.
 */
export async function bundleOrigins(web, fetchText = async (u) => (await fetch(u)).text()) {
  const index = await fetchText(`${web}/`);
  const scripts = [...index.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  const main = scripts.map((s) => s.split('/').pop()).find((s) => /^main-[A-Za-z0-9]+\.js$/.test(s)) ?? null;
  const queue = [...scripts.map((s) => s.replace(/^\.?\//, ''))];
  const seen = new Set();
  const origins = new Map();
  while (queue.length && seen.size < 400) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = await fetchText(`${web}/${file}`);
    for (const m of text.matchAll(/apiUrl\s*:\s*(?:`([^`$]*)`|"([^"]*)"|'([^']*)')/g)) {
      const value = m[1] ?? m[2] ?? m[3];
      origins.set(value, [...(origins.get(value) ?? []), file]);
    }
    for (const m of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)["'`]\.\/([A-Za-z0-9._-]+\.js)["'`]/g)) {
      if (!seen.has(m[1])) queue.push(m[1]);
    }
  }
  return { main, scripts: seen.size, origins: [...origins.entries()].map(([value, files]) => ({ value, files })) };
}

async function readJson(url, headers = {}) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'dinify-served-journeys', Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    try { return { status: r.status, body: JSON.parse(text) }; } catch { return { status: r.status, text: text.slice(0, 200) }; }
  } catch (e) { return { error: e.name }; }
}

/**
 * The newest successful run of `workflow` on main, read from the Actions API
 * WITH the job's token. Unauthenticated, a hosted runner shares 60 requests an
 * hour with every job on its IP and a 403 says nothing about what serves. The
 * token goes to api.github.com and nowhere else.
 */
async function latestDeploy(repo, workflow, githubToken) {
  const headers = githubToken
    ? { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    : {};
  const r = await readJson(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?branch=main&status=success&per_page=1`, headers);
  const run = r.body?.workflow_runs?.[0];
  if (!run) return { repo, workflow, error: r.error ?? `status ${r.status}` };
  return { repo, workflow, run_id: run.id, head_sha: run.head_sha, conclusion: run.conclusion, created_at: run.created_at, event: run.event };
}

/** A JSON body only when it was answered 200 with an object; otherwise null, and why in `unread`. */
async function readBody(url, unread, field) {
  const r = await readJson(url);
  if (r.status === 200 && r.body && typeof r.body === 'object' && !Array.isArray(r.body)) return r.body;
  unread[field] = r.error ?? `status ${r.status}`;
  return null;
}

export async function servingIdentity(cfg, bundle) {
  const admin = await (async () => {
    try {
      const r = await fetch(cfg.adminRelease, { signal: AbortSignal.timeout(20000) });
      return { status: r.status, body: (await r.text()).trim().slice(0, 80) };
    } catch (e) { return { error: e.name }; }
  })();
  const unread = {};
  return {
    note: 'Read at run time from public endpoints. The deploy runs say what each pipeline last published; '
      + 'the bundle filename and the backend answers say what answered this run.',
    frontend_deploy: await latestDeploy('mugak1/Dinify-Frontend', 'deploy-prod.yml', cfg.githubToken),
    backend_deploy: await latestDeploy('mugak1/Dinify-Backend', 'deploy-uat.yml', cfg.githubToken),
    backend_release: await readBody(`${cfg.api}/api/v1/release/`, unread, 'backend_release'),
    backend_health: await readBody(`${cfg.api}/api/v1/health/`, unread, 'backend_health'),
    admin_release: admin,
    bundle: { main_script: bundle.main, scripts_read: bundle.scripts, api_origins: bundle.origins.map((o) => o.value) },
    unread,
  };
}

const SHA = /^[0-9a-f]{40}$/;

/**
 * A missing identity field is a PROBLEM, so the run cannot pass without saying
 * what served it. Each must be present and well formed: both deploy heads and
 * Admin's release.txt are commit SHAs, the backend's release and health
 * answers are JSON objects read with a 200, and the bundle names its main script.
 */
export function servingProblems(serving) {
  const problems = [];
  const missing = (field, why) => problems.push(`serving: ${field} was not read${why ? ` (${why})` : ''}`);
  for (const key of ['frontend_deploy', 'backend_deploy']) {
    if (!SHA.test(serving?.[key]?.head_sha ?? '')) missing(`${key}.head_sha`, serving?.[key]?.error);
  }
  for (const key of ['backend_release', 'backend_health']) {
    const v = serving?.[key];
    if (!v || typeof v !== 'object' || Array.isArray(v)) missing(key, serving?.unread?.[key]);
  }
  const admin = serving?.admin_release;
  if (!(admin?.status === 200 && SHA.test(admin?.body ?? ''))) {
    missing('admin_release.body', admin?.error ?? (admin?.status === 200 ? 'not a commit SHA' : `status ${admin?.status}`));
  }
  if (typeof serving?.bundle?.main_script !== 'string' || !serving.bundle.main_script) missing('bundle.main_script');
  return problems;
}

// ── the operator session ─────────────────────────────────────────────────────

/** Sign in ONCE. Counts the OTPs this issues — `require_otp` means the server issued one. */
async function signIn(cfg, state) {
  const login = await request(cfg.api, '/api/v1/users/auth/login/', {
    method: 'POST', body: { username: cfg.username, password: cfg.password },
  });
  state.otp.logins += 1;
  if (login.status !== 200 || !login.body?.data) throw new RunError('login_refused', `login answered ${login.status}`);
  const data = login.body.data;
  let tokens = data;
  if (data.require_otp === true) {
    state.otp.issuances += 1;
    const verified = await request(cfg.api, '/api/v1/users/auth/verify-otp/', {
      method: 'POST', body: { user: data.user_id, otp: DEV_OTP },
    });
    if (verified.status !== 200 || verified.body?.data?.valid !== true || !verified.body?.data?.token) {
      throw new RunError('dev_otp_refused', 'the served backend did not accept the development OTP 1234. '
        + 'That code works only under ENV=dev; this harness never automates a real SMS code. Stop and report.');
    }
    tokens = verified.body.data;
  }
  mask(tokens.token); mask(tokens.refresh);
  if (data.prompt_password_change === true) {
    throw new RunError('password_change_pending', 'the operator account still has a pending password change; '
      + 'sign in once through the portal and complete it');
  }
  return {
    refresh: tokens.refresh,
    // The browser gets an ACCESS token and NO refresh token: only this process
    // rotates the refresh token, so no tab can blacklist it underneath the run.
    session: {
      require_otp: false, prompt_password_change: false, user_id: data.user_id,
      token: tokens.token, profile: data.profile,
    },
  };
}

/** A fresh access token for the next journey. Rotation: the old refresh is spent. */
async function refreshAccess(cfg, auth, state) {
  const r = await request(cfg.api, '/api/v1/users/auth/token/refresh/', { method: 'POST', body: { refresh: auth.refresh } });
  if (r.status !== 200 || !r.body?.access || !r.body?.refresh) throw new RunError('refresh_refused', `refresh answered ${r.status}`);
  mask(r.body.access); mask(r.body.refresh);
  auth.refresh = r.body.refresh;
  auth.session = { ...auth.session, token: r.body.access };
  state.otp.refreshes += 1;
}

// ── journeys as child processes ──────────────────────────────────────────────

const LINE = {
  checkout: /^(PASS|FAIL|SKIP) {2}(.*?)(?: {2}— (.*))?$/,
  billing: /^ {2}(ok|FAIL|SKIP) +(.*?)(?: {2}— (.*))?$/,
};

/** Parse one journey's stdout into checks. Pure. */
export function parseChecks(text, format) {
  const checks = [];
  for (const raw of text.split('\n')) {
    const m = LINE[format].exec(raw.replace(/\s+$/, ''));
    if (!m) continue;
    const status = { PASS: 'pass', ok: 'pass', FAIL: 'fail', SKIP: 'skip' }[m[1]];
    checks.push({ name: m[2], status, ...(m[3] && status !== 'pass' ? { detail: m[3].slice(0, 300) } : {}) });
  }
  return checks;
}

/**
 * Run one journey. Every line it prints is redacted before it is echoed or
 * kept; an `::add-mask::` line registers its value and is never echoed.
 *
 * ONE BUFFER PER STREAM. A line belongs to one stream. With one buffer shared
 * by stdout and stderr, a partial `::add-mask::` line on one could be completed
 * by the other's next chunk: the merged line no longer starts with the command,
 * so it was echoed, value and all, and the wrong value was registered.
 */
export function runChild(script, env, timeoutMs, { echo = (line) => console.log(line) } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const handle = (line) => {
      if (line.startsWith('::add-mask::')) {
        // The journey announced a value it just minted. Register it (which
        // re-issues the command to the runner under Actions); it is never
        // echoed as a log line and never reaches the evidence.
        mask(line.slice('::add-mask::'.length).trim());
        return;
      }
      const clean = redactText(line);
      out += `${clean}\n`;
      echo(`  | ${clean}`);
    };
    const reader = (stream) => {
      let pending = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        pending += chunk;
        let nl;
        while ((nl = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, nl);
          pending = pending.slice(nl + 1);
          handle(line);
        }
      });
      return () => { if (pending) { const rest = pending; pending = ''; handle(rest); } };
    };
    const flushOut = reader(child.stdout);
    const flushErr = reader(child.stderr);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      flushOut();
      flushErr();
      resolve({ code, signal, out });
    });
  });
}

/** Compare one journey's result with its accepted count and declared skips. */
export function judgeJourney(name, checks, exitCode) {
  const count = (s) => checks.filter((c) => c.status === s).length;
  const pass = count('pass'); const fail = count('fail'); const skip = count('skip');
  const problems = [];
  if (exitCode !== 0 && fail === 0) problems.push(`the journey exited ${exitCode} without a failed check (harness error or refusal)`);
  if (fail) problems.push(`${fail} check(s) failed`);
  if (pass + fail + skip !== ACCEPTED_COUNTS[name]) {
    problems.push(`${pass + fail + skip} checks reported, ${ACCEPTED_COUNTS[name]} accepted`);
  }
  const declared = (SERVED_SKIPS[name] ?? []).map((s) => s.name).sort();
  const skipped = checks.filter((c) => c.status === 'skip').map((c) => c.name).sort();
  if (JSON.stringify(declared) !== JSON.stringify(skipped)) {
    problems.push('the skips differ from the declared served-target skips');
  }
  return { pass, fail, skip, total: pass + fail + skip, accepted: ACCEPTED_COUNTS[name], problems };
}

// ── the run ──────────────────────────────────────────────────────────────────

class RunError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new RunError('config', `${name} is not set`);
  return v;
}

function config() {
  const cfg = {
    web: requiredEnv('JOURNEY_WEB').replace(/\/+$/, ''),
    api: requiredEnv('JOURNEY_API').replace(/\/+$/, ''),
    restaurantId: requiredEnv('JOURNEY_RESTAURANT_ID'),
    restaurantName: requiredEnv('JOURNEY_RESTAURANT_NAME'),
    username: requiredEnv('JOURNEY_OPERATOR_USERNAME'),
    password: requiredEnv('JOURNEY_OPERATOR_PASSWORD'),
    evidence: requiredEnv('JOURNEY_EVIDENCE'),
    hashes: requiredEnv('JOURNEY_SECRET_HASHES'),
    // The job's token, for the Actions API only. Absent on a local rehearsal.
    githubToken: process.env.JOURNEY_GITHUB_TOKEN || '',
    adminRelease: process.env.JOURNEY_ADMIN_RELEASE_URL || 'https://admin.dinifyapp.com/release.txt',
    only: (process.env.JOURNEY_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
  mask(cfg.username); mask(cfg.password); mask(cfg.githubToken);
  return cfg;
}

async function tooling() {
  const require = createRequire(join(E2E, 'package.json'));
  const pw = require('playwright');
  const executablePath = process.env.CHROMIUM_PATH || pw.chromium.executablePath();
  const browser = await pw.chromium.launch({ executablePath });
  const version = browser.version();
  await browser.close();
  return {
    node: process.version,
    playwright: require('playwright/package.json').version,
    chromium: version,
    chromium_path: executablePath,
  };
}

/** `promise`, or a rejection once `ms` has passed. */
function within(promise, ms, code, message) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new RunError(code, message)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/**
 * THE FINAL RESET, on every exit path once a fixture exists: a fresh access
 * token if one can be had (the one in hand otherwise), then the same verified
 * reset as between journeys — which runs the interlock first, so it never
 * writes to a restaurant the interlock refuses. Best effort and bounded by
 * `BUDGET.finalResetMinutes`; it never throws, and says what happened.
 */
export async function finalReset({ fixture, reset, refresh, limitMs = BUDGET.finalResetMinutes * MINUTE }) {
  if (!fixture) {
    return {
      attempted: false, result: null,
      detail: 'no fixture was provisioned, so no probe or journey ran and nothing paused trading or sold a dish out',
    };
  }
  try {
    const done = await within((async () => {
      try { await refresh(); } catch { /* best effort: try the access token in hand */ }
      return reset();
    })(), limitMs, 'final_reset_timeout', `the final reset did not finish within ${limitMs} ms`);
    return { attempted: true, result: 'succeeded', closed_out: done.closed_out };
  } catch (e) {
    return { attempted: true, result: 'failed', detail: redactText(`${e.code || e.name}: ${e.message}`).slice(0, 300) };
  }
}

/** The evidence as written: every key and string redacted, then serialised, so it is valid JSON. */
export const serializeEvidence = (evidence) => `${JSON.stringify(redactValue(evidence), null, 2)}\n`;

async function main() {
  const started = new Date();
  const state = { otp: { logins: 0, issuances: 0, refreshes: 0 } };
  const evidence = {
    schema: EVIDENCE_SCHEMA,
    grade: GRADE,
    started_at: started.toISOString(),
    budget: { ...BUDGET },
    otp: state.otp,
    orchestrator: [],
    probes: [],
    journeys: [],
    final_reset: null,
    outcome: 'failed',
    problems: [],
  };
  const note = (bucket) => (name, ok, detail = '') => {
    const status = ok ? 'pass' : 'fail';
    evidence[bucket].push({ name, status, ...(detail && !ok ? { detail: redactText(String(detail)).slice(0, 300) } : {}) });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${redactText(String(detail))}` : ''}`);
  };
  const orchestrator = note('orchestrator');
  const deadline = started.getTime() + BUDGET.runMinutes * MINUTE;
  // What a journey may still use: the run's budget less the final reset's share.
  const left = () => deadline - BUDGET.finalResetMinutes * MINUTE - Date.now();

  let cfg;
  let work;
  let auth;
  let fixture;
  let base;
  try {
    cfg = config();
    evidence.target = { kind: isLoopback(cfg.api) ? 'local-rehearsal' : 'served', web: cfg.web, api: cfg.api };

    // A run must be able to finish inside the UAT window. The gate checks this
    // first; it is checked again here because re-running only this job reuses
    // the gate's earlier verdict.
    if (evidence.target.kind === 'served') {
      const before = minutesBeforeClose(started);
      evidence.window = {
        zone: WINDOW.zone, london_time: londonTime(started), minutes_before_close: before,
        end_margin_minutes: WINDOW.endMarginMinutes, required_minutes: BUDGET.runMinutes,
      };
      if (before < BUDGET.runMinutes) {
        throw new RunError('window_closing', `it is ${londonTime(started)} in London: ${before} minute(s) are left before `
          + `${WINDOW.close}:00 less the ${WINDOW.endMarginMinutes}-minute margin, and a run is given ${BUDGET.runMinutes}`);
      }
    }

    work = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'served-journeys-'));
    evidence.tooling = await tooling();

    // 1–2. What serves, and the bundle/API match.
    const bundle = await bundleOrigins(cfg.web);
    evidence.serving = await servingIdentity(cfg, bundle);
    const missing = servingProblems(evidence.serving);
    orchestrator('every serving identity field was read', missing.length === 0, missing.join('; '));
    const origins = bundle.origins.map((o) => o.value);
    orchestrator('the served bundle is configured for the API under test, and for nothing else',
      origins.length === 1 && origins[0] === cfg.api,
      `main=${bundle.main} origins=${JSON.stringify(origins)} expected=${cfg.api}`);
    if (!(origins.length === 1 && origins[0] === cfg.api)) throw new RunError('bundle_mismatch', 'the served bundle does not call JOURNEY_API');

    // 3. One sign-in.
    auth = await signIn(cfg, state);
    orchestrator('the operator signs in with password and the development OTP', true);

    // 4. Provision, behind the interlock.
    base = { api: cfg.api, restaurantId: cfg.restaurantId, restaurantName: cfg.restaurantName };
    fixture = await provision({ ...base, token: auth.session.token });
    orchestrator('the interlock matched id, name and is_test, and the fixture was provisioned through the operator API', true);
    evidence.provision = fixture.report;

    // 5. The probes, which run the interlock again themselves.
    const probe = await runProbes({ ...base, token: auth.session.token, fixture, check: note('probes') });
    evidence.growth = { probe_drafts: probe.draftsCreated };

    // 6. The journeys, inside the run's budget.
    const outOfTime = (name) => new RunError('budget', `${name} was not started: ${Math.max(0, Math.floor(left() / MINUTE))} `
      + `minute(s) of the run's ${BUDGET.runMinutes} were left, and a journey is not started with under ${BUDGET.minJourneyMinutes}`);
    for (const j of JOURNEYS) {
      if (cfg.only.length && !cfg.only.includes(j.name)) continue;
      if (left() < BUDGET.minJourneyMinutes * MINUTE) throw outOfTime(j.name);
      console.log(`\n=== ${j.name} ===`);
      await refreshAccess(cfg, auth, state);
      const reset = await resetBetweenJourneys({ ...base, token: auth.session.token, fixture });
      const table = j.table === 'kitchen'
        ? await kitchenTable({ ...base, token: auth.session.token, fixture })
        : j.table === 'checkout' ? fixture.tables[901] : null;
      const timeoutMs = Math.min(BUDGET.journeyMinutes * MINUTE, left());
      if (timeoutMs < BUDGET.minJourneyMinutes * MINUTE) throw outOfTime(j.name);
      const file = join(work, `${j.name}.json`);
      const journeyFixture = j.format === 'billing'
        ? {
          target: 'served', restaurant: cfg.restaurantId, session: auth.session,
          restaurants: { unconfigured: { id: cfg.restaurantId, name: cfg.restaurantName, legacy_validity: fixture.billing.legacy_validity } },
        }
        : {
          target: 'served', restaurant: cfg.restaurantId,
          burger: fixture.burger, cheese: fixture.cheese, rounding: fixture.rounding,
          table: table.id, table_number: table.number, table_label: table.label, credential: table.credential,
          operator: { session: auth.session },
        };
      writeFileSync(file, JSON.stringify(journeyFixture), { mode: 0o600 });
      const env = {
        ...process.env,
        JOURNEY_FIXTURE: file, JOURNEY_WEB: cfg.web, JOURNEY_API: cfg.api,
        BILLING_FIXTURE: file, BILLING_WEB: cfg.web, BILLING_API: cfg.api,
        CHROMIUM_PATH: evidence.tooling.chromium_path,
        JOURNEY_MASK_PIPE: '1',
        // Billing reads the browser's local date; the server is on Kampala's (billing README).
        ...(j.name === 'billing' ? { TZ: 'Africa/Kampala' } : {}),
      };
      // A journey needs neither operator credential nor the GitHub token: it is handed the session.
      delete env.JOURNEY_OPERATOR_USERNAME;
      delete env.JOURNEY_OPERATOR_PASSWORD;
      delete env.JOURNEY_GITHUB_TOKEN;
      const res = await runChild(join(E2E, j.script), env, timeoutMs);
      rmSync(file, { force: true });
      const checks = parseChecks(res.out, j.format);
      const verdict = judgeJourney(j.name, checks, res.code);
      if (res.signal === 'SIGKILL') verdict.problems.push(`the journey was stopped after ${Math.round(timeoutMs / MINUTE)} minute(s)`);
      evidence.journeys.push({
        name: j.name, script: `e2e/${j.script}`, exit_code: res.code, signal: res.signal,
        timeout_minutes: Math.round(timeoutMs / MINUTE),
        table: table ? table.label : null, closed_out_before: reset.closed_out,
        ...verdict,
        checks,
        skips: checks.filter((c) => c.status === 'skip').map((c) => ({ name: c.name, reason: c.detail ?? '' })),
      });
    }
  } catch (e) {
    const message = redactText(`${e.code || e.name}: ${e.message}`);
    evidence.problems.push(message);
    orchestrator('the run completed', false, message);
  } finally {
    // 7. Leave it canonical whatever happened, and say so only if it reads back that way.
    evidence.final_reset = await finalReset({
      fixture,
      refresh: () => refreshAccess(cfg, auth, state),
      reset: () => resetBetweenJourneys({ ...base, token: auth.session.token, fixture }),
    });
    if (evidence.final_reset.attempted) {
      orchestrator('the catalogue is canonical, trading is on and the board is clear after the run',
        evidence.final_reset.result === 'succeeded',
        evidence.final_reset.result === 'succeeded' ? `closed out ${evidence.final_reset.closed_out}` : evidence.final_reset.detail);
    }
    if (work) rmSync(work, { recursive: true, force: true });
  }

  // Unconditional: a run that stopped before reading what serves has not said what served it either.
  evidence.problems.push(...servingProblems(evidence.serving));
  for (const j of evidence.journeys) for (const p of j.problems) evidence.problems.push(`${j.name}: ${p}`);
  for (const p of evidence.probes) if (p.status !== 'pass') evidence.problems.push(`probe failed: ${p.name}`);
  for (const o of evidence.orchestrator) if (o.status !== 'pass') evidence.problems.push(`orchestrator: ${o.name}`);
  const ran = cfg?.only?.length ? cfg.only.length : JOURNEYS.length;
  if (evidence.journeys.length !== ran) evidence.problems.push(`${evidence.journeys.length} of ${ran} journeys ran`);
  evidence.outcome = evidence.problems.length ? 'failed' : 'passed';
  evidence.finished_at = new Date().toISOString();

  // Read straight from the environment, so a run refused at configuration (a
  // secret the owner has not set yet) still leaves evidence saying so. The hash
  // file is written FIRST: the scan refuses evidence that has none beside it.
  const hashesPath = cfg?.hashes ?? process.env.JOURNEY_SECRET_HASHES;
  if (hashesPath) writeFileSync(hashesPath, `${JSON.stringify(secretHashes(knownSecrets()))}\n`, { mode: 0o600 });
  const evidencePath = cfg?.evidence ?? process.env.JOURNEY_EVIDENCE;
  if (evidencePath) writeFileSync(evidencePath, serializeEvidence(evidence), { mode: 0o600 });
  const table = evidence.journeys.map((j) => `| ${j.name} | ${j.pass} | ${j.fail} | ${j.skip} | ${j.total}/${j.accepted} |`).join('\n');
  const summary = `### Served journeys — ${evidence.outcome.toUpperCase()}\n\n${GRADE}\n\n`
    + `| journey | pass | fail | skip | reported/accepted |\n|---|---|---|---|---|\n${table}\n\n`
    + `OTP issuances this run: **${state.otp.issuances}** (logins ${state.otp.logins}, refreshes ${state.otp.refreshes}).\n\n`
    + `Final reset: ${evidence.final_reset.attempted ? `**${evidence.final_reset.result}**` : 'not attempted'}.\n\n`
    + (evidence.problems.length ? `Problems:\n${evidence.problems.map((p) => `- ${p}`).join('\n')}\n` : '');
  console.log(`\n${redactText(summary)}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, redactText(summary));
  process.exit(evidence.outcome === 'passed' ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const run = process.argv[2] === 'health-gate' ? healthGate : main;
  run().catch((e) => { console.error(redactText(`SERVED RUN ERROR: ${e.stack || e}`)); process.exit(2); });
}
