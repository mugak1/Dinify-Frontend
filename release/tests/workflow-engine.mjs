/**
 * A LOCAL, PRODUCTION-SHAPED RUNNER FOR .github/workflows/publish.yml.
 *
 * WHY. The pure suites prove the rules and the adapter suites prove each command reads
 * the world correctly. Neither proves the WORKFLOW: that the gate's outputs are the
 * inputs the publisher needs, that a refusal really leaves the credentialed step
 * unreachable, that the verifier the publisher runs is the one the gate ran, that the
 * step conditions mean what they say. Those live in YAML and expression semantics, and
 * the only way to test them without GitHub is to execute the YAML.
 *
 * WHAT IS REAL. The workflow file is this repository's own, parsed and executed step by
 * step. Every `run:` script runs in bash exactly as written, calling the real
 * `release/cli.mjs` from real git checkouts of a fixture repository. Expressions are
 * evaluated with GitHub's semantics as documented (implicit `success()`, loose
 * equality with numeric coercion, case-insensitive string comparison, null for a
 * missing property). HTTP reads go over real TLS to local origins.
 *
 * WHAT IS A STAND-IN, and exactly how far each goes:
 *   actions/checkout          git init + fetch from the fixture repository + (sparse)
 *                             checkout; persist-credentials writes the extraheader the
 *                             real action writes, so leaving it on is OBSERVABLE
 *   actions/setup-node        records the version; the runner already has Node 24
 *   actions/download-artifact name XOR artifact-ids, cross-run needs a token, an
 *                             expired upload fails, the bytes are re-digested and
 *                             compared with the listing (digest-mismatch: error), and
 *                             the v5+ layout for a single artifact / merge-multiple
 *   actions/upload-artifact   copies the named files into an evidence store
 *   FirebaseExtended/action-hosting-deploy
 *                             THE OBSERVABLE PUBLISHER. It resolves the destination
 *                             with firebase-tools' OWN functions (Command#applyRC,
 *                             hostingConfig, listFiles — the installed version, which
 *                             the oracle test records against the pinned one), lists
 *                             the upload with the tool's own ignore handling, and
 *                             "publishes" by serving exactly those files from a local
 *                             origin. It records the credential it received. It can be
 *                             told to fail, to fail after publishing, to drop a file,
 *                             or to publish something else — so the verification that
 *                             follows is tested against a publisher that misbehaves.
 *
 * WHAT IT IS NOT. Not GitHub: no queueing, no concurrency groups, no OIDC, no runner
 * images, no masking. The GitHub API is a RECORDED map (release/tests/harness.mjs). An
 * action it does not model is an ERROR, never a silent pass — a workflow edit that adds
 * one must extend this file deliberately.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { ROOT, artifactDigest, childEnv, git as fixtureGit, run, tempDir } from './harness.mjs';

const require = createRequire(join(ROOT, 'package.json'));

let yamlModule = null;
/** `yaml` is in this repository's tree through @angular/build, firebase-tools and tailwind. */
export function parseWorkflow(path) {
  if (!yamlModule) {
    try {
      yamlModule = require('yaml');
    } catch (error) {
      throw new Error(`the workflow simulation needs the \`yaml\` package from node_modules: ${error.message}`);
    }
  }
  return yamlModule.parse(readFileSync(path, 'utf8'));
}

// ── expressions ─────────────────────────────────────────────────────────────────

const STATUS_FUNCTIONS = new Set(['success', 'failure', 'always', 'cancelled']);

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === "'") {
      let j = i + 1;
      let out = '';
      for (;;) {
        if (j >= src.length) throw new Error(`unterminated string in expression: ${src}`);
        if (src[j] === "'") {
          if (src[j + 1] === "'") { out += "'"; j += 2; continue; }
          break;
        }
        out += src[j];
        j += 1;
      }
      tokens.push({ t: 'str', v: out });
      i = j + 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) { tokens.push({ t: 'op', v: two }); i += 2; continue; }
    if ('!<>()[],.'.includes(c)) { tokens.push({ t: 'op', v: c }); i += 1; continue; }
    const num = /^(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(src.slice(i));
    if (num) { tokens.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(src.slice(i));
    if (id) { tokens.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    throw new Error(`unexpected character ${JSON.stringify(c)} in expression: ${src}`);
  }
  return tokens;
}

export function parseExpression(src) {
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const isOp = (v) => tokens[p]?.t === 'op' && tokens[p].v === v;
  const expect = (v) => {
    if (!isOp(v)) throw new Error(`expected ${v} in expression: ${src}`);
    p += 1;
  };
  const binary = (next, ops) => () => {
    let left = next();
    while (tokens[p]?.t === 'op' && ops.includes(tokens[p].v)) {
      const op = tokens[p].v;
      p += 1;
      left = { k: 'bin', op, l: left, r: next() };
    }
    return left;
  };
  const primary = () => {
    const t = peek();
    if (!t) throw new Error(`unexpected end of expression: ${src}`);
    if (t.t === 'str' || t.t === 'num') { p += 1; return { k: 'lit', v: t.v }; }
    if (isOp('(')) { p += 1; const e = or(); expect(')'); return e; }
    if (t.t === 'id') {
      p += 1;
      const lower = t.v.toLowerCase();
      if (lower === 'true') return { k: 'lit', v: true };
      if (lower === 'false') return { k: 'lit', v: false };
      if (lower === 'null') return { k: 'lit', v: null };
      if (isOp('(')) {
        p += 1;
        const args = [];
        if (!isOp(')')) {
          args.push(or());
          while (isOp(',')) { p += 1; args.push(or()); }
        }
        expect(')');
        return { k: 'call', name: lower, args };
      }
      return { k: 'ctx', name: t.v };
    }
    throw new Error(`unexpected token ${JSON.stringify(t.v)} in expression: ${src}`);
  };
  const postfix = () => {
    let e = primary();
    for (;;) {
      if (isOp('.')) {
        p += 1;
        const name = peek();
        if (name?.t !== 'id') throw new Error(`expected a property name in expression: ${src}`);
        p += 1;
        e = { k: 'prop', obj: e, name: name.v };
      } else if (isOp('[')) {
        p += 1;
        const idx = or();
        expect(']');
        e = { k: 'index', obj: e, idx };
      } else {
        return e;
      }
    }
  };
  const unary = () => {
    if (isOp('!')) { p += 1; return { k: 'not', e: unary() }; }
    return postfix();
  };
  const rel = binary(unary, ['<', '<=', '>', '>=']);
  const eq = binary(rel, ['==', '!=']);
  const and = binary(eq, ['&&']);
  const or = binary(and, ['||']);
  const ast = or();
  if (p !== tokens.length) throw new Error(`trailing tokens in expression: ${src}`);
  return ast;
}

function callsStatusFunction(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.k === 'call' && STATUS_FUNCTIONS.has(node.name)) return true;
  return Object.values(node).some((v) => (Array.isArray(v) ? v.some(callsStatusFunction) : callsStatusFunction(v)));
}

const truthy = (v) => !(v === null || v === undefined || v === false || v === 0 || v === '' || Number.isNaN(v));

function toNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    if (v.trim() === '') return 0;
    if (/^\s*-?(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*$/.test(v)) return Number(v);
    return Number.NaN;
  }
  return Number.NaN;
}

/** GitHub's loose equality: numeric coercion across types, case-insensitive strings. */
function looseEquals(a, b) {
  const na = a === undefined ? null : a;
  const nb = b === undefined ? null : b;
  if (typeof na === 'string' && typeof nb === 'string') return na.toLowerCase() === nb.toLowerCase();
  if (typeof na === typeof nb && na !== null && typeof na === 'object') return na === nb;
  if (na === null && nb === null) return true;
  if (typeof na === typeof nb && typeof na !== 'object') return na === nb;
  const x = toNumber(na);
  const y = toNumber(nb);
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  return x === y;
}

function compare(op, a, b) {
  let x = a;
  let y = b;
  if (typeof a === 'string' && typeof b === 'string') {
    x = a.toLowerCase();
    y = b.toLowerCase();
  } else {
    x = toNumber(a);
    y = toNumber(b);
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
  }
  if (op === '<') return x < y;
  if (op === '<=') return x <= y;
  if (op === '>') return x > y;
  return x >= y;
}

/** Property access is case-insensitive in GitHub expressions; a missing one is null. */
function property(obj, name) {
  if (obj === null || obj === undefined || typeof obj !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(obj, name)) return obj[name] ?? null;
  const key = Object.keys(obj).find((k) => k.toLowerCase() === String(name).toLowerCase());
  return key === undefined ? null : (obj[key] ?? null);
}

function formatString(fmt, args) {
  return String(fmt).replace(/\{\{|\}\}|\{(\d+)\}/g, (m, n) => {
    if (m === '{{') return '{';
    if (m === '}}') return '}';
    return stringify(args[Number(n)]);
  });
}

export function stringify(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return JSON.stringify(v);
}

export function evaluate(ast, scope) {
  const ev = (n) => evaluate(n, scope);
  switch (ast.k) {
    case 'lit': return ast.v;
    case 'ctx': {
      const ctx = property(scope.contexts, ast.name);
      if (ctx === null && !Object.keys(scope.contexts).some((k) => k.toLowerCase() === ast.name.toLowerCase())) {
        throw new Error(`unknown context ${ast.name}`);
      }
      return ctx;
    }
    case 'prop': {
      if (ast.obj.k === 'ctx' && ast.obj.name.toLowerCase() === 'secrets') scope.onSecret?.(ast.name);
      return property(ev(ast.obj), ast.name);
    }
    case 'index': {
      const obj = ev(ast.obj);
      const idx = ev(ast.idx);
      if (Array.isArray(obj)) return obj[toNumber(idx)] ?? null;
      return property(obj, stringify(idx));
    }
    case 'not': return !truthy(ev(ast.e));
    case 'bin': {
      if (ast.op === '&&') { const l = ev(ast.l); return truthy(l) ? ev(ast.r) : l; }
      if (ast.op === '||') { const l = ev(ast.l); return truthy(l) ? l : ev(ast.r); }
      const l = ev(ast.l);
      const r = ev(ast.r);
      if (ast.op === '==') return looseEquals(l, r);
      if (ast.op === '!=') return !looseEquals(l, r);
      return compare(ast.op, l, r);
    }
    case 'call': {
      const args = ast.args.map(ev);
      switch (ast.name) {
        case 'success': return scope.status.success();
        case 'failure': return scope.status.failure();
        case 'always': return true;
        case 'cancelled': return false;
        case 'contains': {
          const [hay, needle] = args;
          if (Array.isArray(hay)) return hay.some((x) => looseEquals(x, needle));
          return stringify(hay).toLowerCase().includes(stringify(needle).toLowerCase());
        }
        case 'startswith': return stringify(args[0]).toLowerCase().startsWith(stringify(args[1]).toLowerCase());
        case 'endswith': return stringify(args[0]).toLowerCase().endsWith(stringify(args[1]).toLowerCase());
        case 'format': return formatString(args[0], args.slice(1));
        case 'join': return Array.isArray(args[0]) ? args[0].map(stringify).join(args.length > 1 ? stringify(args[1]) : ',') : stringify(args[0]);
        case 'tojson': return JSON.stringify(args[0] ?? null, null, 2);
        case 'fromjson': return JSON.parse(stringify(args[0]));
        default: throw new Error(`unsupported function ${ast.name}()`);
      }
    }
    default: throw new Error(`bad expression node ${ast.k}`);
  }
}

/** Evaluate an `if:` — with or without `${{ }}`, with the implicit `success()`. */
export function evaluateCondition(raw, scope) {
  if (raw === undefined || raw === null || raw === '') return truthy(scope.status.success());
  let text = String(raw).trim();
  const whole = /^\$\{\{([\s\S]*)\}\}$/.exec(text);
  if (whole && !whole[1].includes('${{')) text = whole[1];
  const ast = parseExpression(text);
  const effective = callsStatusFunction(ast) ? ast : { k: 'bin', op: '&&', l: { k: 'call', name: 'success', args: [] }, r: ast };
  return truthy(evaluate(effective, scope));
}

/** Replace every `${{ expr }}` in a string with its stringified value. */
export function interpolate(value, scope) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expr) => stringify(evaluate(parseExpression(expr), scope)));
}

// ── GITHUB_OUTPUT ───────────────────────────────────────────────────────────────

export function parseOutputFile(text) {
  const out = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const heredoc = /^([^=<]+)<<(.+)$/.exec(line);
    if (heredoc) {
      const [, name, delimiter] = heredoc;
      const body = [];
      i += 1;
      while (i < lines.length && lines[i] !== delimiter) { body.push(lines[i]); i += 1; }
      if (i >= lines.length) throw new Error(`unterminated heredoc output ${name}`);
      out[name] = body.join('\n');
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) throw new Error(`malformed output line: ${line}`);
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

// ── triggers ────────────────────────────────────────────────────────────────────

/**
 * Would this workflow run for this event at all? `workflow_run` filters on the
 * triggering workflow's DISPLAY NAME, its activity type and its head branch — the
 * coarse pre-filter the gate then re-establishes through the API.
 */
export function triggers(workflow, event) {
  const on = workflow.on ?? {};
  if (event.name === 'workflow_run') {
    const spec = on.workflow_run;
    if (!spec) return { runs: false, why: 'no workflow_run trigger' };
    const wr = event.payload.workflow_run;
    if (!(spec.workflows ?? []).includes(wr.name)) return { runs: false, why: `workflow ${wr.name} not listed` };
    if (spec.types && !spec.types.includes(event.payload.action)) return { runs: false, why: `type ${event.payload.action}` };
    if (spec.branches && !spec.branches.includes(wr.head_branch)) return { runs: false, why: `branch ${wr.head_branch}` };
    return { runs: true };
  }
  if (event.name === 'workflow_dispatch') {
    const spec = on.workflow_dispatch;
    if (spec === undefined) return { runs: false, why: 'no workflow_dispatch trigger' };
    for (const [name, def] of Object.entries(spec?.inputs ?? {})) {
      const value = event.inputs?.[name] ?? def.default;
      if (def.required && (value === undefined || value === '')) return { runs: false, why: `input ${name} is required` };
      if (def.type === 'choice' && value !== undefined && !def.options.includes(value)) return { runs: false, why: `input ${name}=${value} is not an option` };
    }
    return { runs: true };
  }
  return { runs: false, why: `event ${event.name}` };
}

function dispatchInputs(workflow, event) {
  const out = {};
  for (const [name, def] of Object.entries(workflow.on?.workflow_dispatch?.inputs ?? {})) {
    out[name] = event.inputs?.[name] ?? def.default ?? '';
  }
  return out;
}

// ── the run ─────────────────────────────────────────────────────────────────────

const ACTION_REF = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([^\s]+)$/;

/**
 * @param {object} args
 * @param {string} args.workflowPath
 * @param {object} args.event   {name, ref, sha, runId, runAttempt, payload?, inputs?}
 * @param {object} args.world   see workflow-simulation.test.mjs
 * @param {object} [args.hooks] {betweenJobs: async ({after, jobs}) => {},
 *                               beforeStep: async ({job, step, workspace, world}) => {}}
 *   `beforeStep` is FAULT INJECTION: it runs before a step's condition is evaluated,
 *   with that job's workspace, so a scenario can corrupt what the step will read. A
 *   scenario using it says so in its title.
 */
export async function runWorkflow({ workflowPath, event, world, hooks = {} }) {
  const workflow = parseWorkflow(workflowPath);
  const trig = triggers(workflow, event);
  const result = { triggered: trig.runs, why: trig.why ?? null, jobs: {}, steps: [], secretAccess: [], log: world.log };
  if (!trig.runs) return result;

  const token = world.token;
  const github = {
    event_name: event.name,
    ref: event.ref,
    sha: event.sha,
    repository: world.repository,
    run_id: String(event.runId),
    run_attempt: String(event.runAttempt ?? 1),
    token,
    event: event.name === 'workflow_run' ? event.payload : { inputs: dispatchInputs(workflow, event) },
    workflow: workflow.name,
    server_url: 'https://github.com',
  };
  const inputs = event.name === 'workflow_dispatch' ? dispatchInputs(workflow, event) : {};
  const secrets = { GITHUB_TOKEN: token, ...(world.secrets ?? {}) };
  const vars = { ...(world.vars ?? {}) };

  const order = topologicalJobs(workflow.jobs);
  for (let jobIndex = 0; jobIndex < order.length; jobIndex += 1) {
    const jobName = order[jobIndex];
    const job = workflow.jobs[jobName];
    const needs = [].concat(job.needs ?? []);
    const needsContext = Object.fromEntries(needs.map((n) => [n, { result: result.jobs[n].result, outputs: result.jobs[n].outputs }]));
    const jobScope = {
      contexts: { github, inputs, vars, secrets, needs: needsContext, env: {}, runner: { os: 'Linux' } },
      status: {
        success: () => needs.every((n) => result.jobs[n].result === 'success'),
        failure: () => needs.some((n) => result.jobs[n].result === 'failure'),
      },
      onSecret: (name) => result.secretAccess.push({ job: jobName, step: '(job if)', name }),
    };
    world.log.push({ type: 'job', job: jobName });
    if (!evaluateCondition(job.if, jobScope)) {
      result.jobs[jobName] = { result: 'skipped', outputs: {}, steps: [], summary: '', permissions: job.permissions ?? workflow.permissions };
      continue;
    }
    result.jobs[jobName] = await runJob({ jobName, job, workflow, github, inputs, secrets, vars, needsContext, world, result, hooks });
    if (hooks.betweenJobs && jobIndex < order.length - 1) await hooks.betweenJobs({ after: jobName, jobs: result.jobs, world });
  }
  return result;
}

function topologicalJobs(jobs) {
  const order = [];
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const dep of [].concat(jobs[name].needs ?? [])) visit(dep);
    order.push(name);
  };
  for (const name of Object.keys(jobs)) visit(name);
  return order;
}

async function runJob({ jobName, job, workflow, github, inputs, secrets, vars, needsContext, world, result, hooks = {} }) {
  const workspace = tempDir(`sim-${jobName}-ws`);
  const runnerTemp = tempDir(`sim-${jobName}-tmp`);
  const stepsContext = {};
  const trace = [];
  let jobFailed = false;
  let summary = '';
  const permissions = job.permissions ?? workflow.permissions ?? null;

  for (let index = 0; index < job.steps.length; index += 1) {
    const step = job.steps[index];
    const label = step.name ?? step.uses ?? `step ${index}`;
    const record = { job: jobName, index, name: label, id: step.id ?? null, uses: step.uses ?? null, secrets: [] };
    const scope = {
      contexts: { github, inputs, vars, secrets, needs: needsContext, steps: stepsContext, env: {}, runner: { os: 'Linux', temp: runnerTemp }, job: { status: jobFailed ? 'failure' : 'success' } },
      status: { success: () => !jobFailed, failure: () => jobFailed },
      onSecret: (name) => {
        record.secrets.push(name);
        result.secretAccess.push({ job: jobName, step: label, name });
      },
    };
    world.log.push({ type: 'step', job: jobName, step: label });
    if (hooks.beforeStep) await hooks.beforeStep({ job: jobName, step: label, workspace, world });
    let ran = evaluateCondition(step.if, scope);
    let outcome = 'skipped';
    let outputs = {};
    if (ran) {
      const env = {};
      for (const [k, v] of Object.entries(workflow.env ?? {})) env[k] = interpolate(String(v), scope);
      for (const [k, v] of Object.entries(job.env ?? {})) env[k] = interpolate(String(v), scope);
      for (const [k, v] of Object.entries(step.env ?? {})) env[k] = interpolate(String(v), scope);
      record.env = env;
      if (step.run !== undefined) {
        const r = await runScript({ step, scope, env, workspace, runnerTemp, github, world, index, jobName });
        outcome = r.status === 0 ? 'success' : 'failure';
        outputs = r.outputs;
        summary += r.summary;
        Object.assign(record, { status: r.status, stdout: r.stdout, stderr: r.stderr, script: r.script });
      } else if (step.uses !== undefined) {
        const m = ACTION_REF.exec(String(step.uses));
        if (!m) throw new Error(`step "${label}" uses an unparseable action reference ${step.uses}`);
        const [, action, ref] = m;
        record.action = action;
        record.pinned = /^[0-9a-f]{40}$/.test(ref);
        const withInputs = {};
        for (const [k, v] of Object.entries(step.with ?? {})) withInputs[k] = interpolate(String(v), scope);
        record.with = withInputs;
        const standIn = STAND_INS[action];
        if (!standIn) throw new Error(`the simulation does not model ${action}; extend release/tests/workflow-engine.mjs deliberately`);
        const r = await standIn({ inputs: withInputs, workspace, github, world, jobName, label });
        outcome = r.ok ? 'success' : 'failure';
        outputs = r.outputs ?? {};
        Object.assign(record, { detail: r.detail ?? null, observed: r.observed ?? null });
      } else {
        throw new Error(`step "${label}" has neither run nor uses`);
      }
    }
    const conclusion = outcome === 'failure' && truthyContinue(step['continue-on-error'], scope) ? 'success' : outcome;
    if (conclusion === 'failure') jobFailed = true;
    if (step.id) stepsContext[step.id] = { outputs, outcome, conclusion };
    Object.assign(record, { outcome, conclusion });
    trace.push(record);
    result.steps.push(record);
  }

  // Job outputs are evaluated at the end, against the steps as they finished.
  const outScope = {
    contexts: { github, inputs, vars, secrets, needs: needsContext, steps: stepsContext, env: {}, runner: { os: 'Linux' } },
    status: { success: () => !jobFailed, failure: () => jobFailed },
    onSecret: (name) => result.secretAccess.push({ job: jobName, step: '(job outputs)', name }),
  };
  const outputs = {};
  for (const [k, v] of Object.entries(job.outputs ?? {})) outputs[k] = interpolate(String(v), outScope);
  return { result: jobFailed ? 'failure' : 'success', outputs, steps: trace, summary, permissions, workspace };
}

function truthyContinue(value, scope) {
  if (value === undefined) return false;
  if (typeof value === 'boolean') return value;
  return truthy(interpolate(String(value), scope)) && interpolate(String(value), scope) !== 'false';
}

async function runScript({ step, scope, env, workspace, runnerTemp, github, world, index, jobName }) {
  const script = interpolate(String(step.run), scope);
  const file = join(runnerTemp, `step-${index}.sh`);
  const output = join(runnerTemp, `output-${index}`);
  const summaryFile = join(runnerTemp, `summary-${index}`);
  writeFileSync(file, script);
  writeFileSync(output, '');
  writeFileSync(summaryFile, '');
  const cwd = step['working-directory'] ? join(workspace, interpolate(String(step['working-directory']), scope)) : workspace;
  const base = childEnv(world.gh.env());
  base.PATH = `${world.gh.bin}:${dirname(process.execPath)}:${process.env.PATH}`;
  const fullEnv = {
    ...base,
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    GITHUB_WORKSPACE: workspace,
    RUNNER_TEMP: runnerTemp,
    GITHUB_OUTPUT: output,
    GITHUB_STEP_SUMMARY: summaryFile,
    GITHUB_REPOSITORY: github.repository,
    GITHUB_RUN_ID: github.run_id,
    GITHUB_RUN_ATTEMPT: github.run_attempt,
    GITHUB_SHA: github.sha,
    GITHUB_REF: github.ref,
    GITHUB_EVENT_NAME: github.event_name,
    GITHUB_JOB: jobName,
    ...env,
  };
  // `bash -e {0}` is what a `run:` step with no explicit shell gets on Linux.
  const r = await run('bash', ['-e', file], { cwd, env: fullEnv });
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    script,
    outputs: parseOutputFile(readFileSync(output, 'utf8')),
    summary: readFileSync(summaryFile, 'utf8'),
  };
}

// ── stand-ins ───────────────────────────────────────────────────────────────────

const bool = (v, dflt) => (v === undefined || v === '' ? dflt : String(v).toLowerCase() === 'true');
const lines = (v) => String(v ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

async function checkoutStandIn({ inputs, workspace, github, world }) {
  const repository = inputs.repository || github.repository;
  const source = world.repositories[repository];
  if (!source) return { ok: false, detail: `no fixture repository for ${repository}` };
  const dest = inputs.path ? join(workspace, inputs.path) : workspace;
  mkdirSync(dest, { recursive: true });
  const depth = inputs['fetch-depth'] === undefined || inputs['fetch-depth'] === '' ? 1 : Number(inputs['fetch-depth']);
  const ref = inputs.ref || github.sha;
  const g = (args) => fixtureGit(dest, args);
  try {
    g(['init', '-q']);
    g(['remote', 'add', 'origin', `file://${source}`]);
    const sparse = lines(inputs['sparse-checkout']);
    if (sparse.length > 0) {
      const cone = bool(inputs['sparse-checkout-cone-mode'], true);
      g(['sparse-checkout', 'set', cone ? '--cone' : '--no-cone', ...sparse]);
    }
    const isSha = /^[0-9a-f]{40}$/.test(ref);
    if (depth === 0) {
      g(['fetch', '-q', '--no-tags', 'origin', '+refs/heads/*:refs/remotes/origin/*']);
      if (isSha) g(['fetch', '-q', '--no-tags', 'origin', ref]);
      g(['checkout', '-q', '--detach', isSha ? ref : `origin/${ref.replace(/^refs\/heads\//, '')}`]);
    } else {
      g(['fetch', '-q', '--no-tags', `--depth=${depth}`, 'origin', isSha ? ref : `+refs/heads/${ref.replace(/^refs\/heads\//, '')}:refs/remotes/origin/${ref.replace(/^refs\/heads\//, '')}`]);
      g(['checkout', '-q', '--detach', isSha ? ref : `origin/${ref.replace(/^refs\/heads\//, '')}`]);
    }
    const persist = bool(inputs['persist-credentials'], true);
    if (persist) {
      // What actions/checkout writes when persist-credentials is left on: the token,
      // in the checkout's own git config, readable by every later step.
      const basic = Buffer.from(`x-access-token:${github.token}`).toString('base64');
      g(['config', '--local', 'http.https://github.com/.extraheader', `AUTHORIZATION: basic ${basic}`]);
    }
    return {
      ok: true,
      observed: { repository, ref, path: inputs.path ?? '', head: g(['rev-parse', 'HEAD']), sparse, depth, persistCredentials: persist },
    };
  } catch (error) {
    return { ok: false, detail: String(error.message) };
  }
}

async function setupNodeStandIn({ inputs }) {
  return { ok: String(inputs['node-version']) === '24', observed: { nodeVersion: inputs['node-version'] }, detail: 'the runner already has Node 24' };
}

async function downloadStandIn({ inputs, workspace, github, world }) {
  const name = inputs.name || '';
  const ids = lines(String(inputs['artifact-ids'] ?? '').replace(/,/g, '\n'));
  if (name && ids.length) return { ok: false, detail: "Inputs 'name' and 'artifact-ids' cannot be used together" };
  const runId = inputs['run-id'] || github.run_id;
  if (inputs['run-id'] && !inputs['github-token']) return { ok: false, detail: 'a cross-run download needs github-token' };
  const listing = world.artifacts.entries.filter((e) => e.runId === String(runId));
  let selected;
  if (ids.length) {
    selected = ids.map((id) => listing.find((e) => String(e.id) === id));
    if (selected.some((e) => !e)) return { ok: false, detail: `Artifact(s) not found: ${ids.join(',')}` };
  } else if (name) {
    selected = listing.filter((e) => e.name === name);
    if (selected.length === 0) return { ok: false, detail: `Artifact not found: ${name}` };
  } else {
    selected = listing;
  }
  const dest = inputs.path ? join(workspace, inputs.path) : workspace;
  const single = Boolean(name) || ids.length === 1;
  const merge = bool(inputs['merge-multiple'], false);
  const onMismatch = (inputs['digest-mismatch'] || 'error').toLowerCase();
  const observed = [];
  for (const entry of selected) {
    if (entry.expired) return { ok: false, detail: `Artifact ${entry.id} has expired` };
    const actual = artifactDigest(entry.dir);
    const matches = actual === entry.digest;
    observed.push({ id: entry.id, name: entry.name, listed: entry.digest, actual, matches });
    if (!matches && onMismatch === 'error') return { ok: false, detail: `Digest mismatch for ${entry.name}`, observed };
    const into = single || merge ? dest : join(dest, entry.name);
    mkdirSync(into, { recursive: true });
    cpSync(entry.dir, into, { recursive: true });
  }
  return { ok: true, observed };
}

async function uploadStandIn({ inputs, workspace, world }) {
  const stored = [];
  const missing = [];
  const dir = join(world.evidence, inputs.name);
  mkdirSync(dir, { recursive: true });
  for (const rel of lines(inputs.path)) {
    const from = join(workspace, rel);
    if (existsSync(from)) {
      cpSync(from, join(dir, rel), { recursive: true });
      stored.push(rel);
    } else {
      missing.push(rel);
    }
  }
  if (missing.length && inputs['if-no-files-found'] === 'error') return { ok: false, detail: `missing ${missing.join(', ')}` };
  return { ok: true, observed: { name: inputs.name, stored, missing } };
}

/**
 * THE OBSERVABLE PUBLISHER. Resolves the destination and the upload list with
 * firebase-tools' own functions, then serves exactly those files from the site's
 * local origin. `world.publisher.mode` makes it misbehave on purpose: `fail-before`,
 * `fail-after`, `partial`, `wrong-candidate`, and `identity-cacheable` (the origin
 * serves /release.json cacheable whatever configuration it was given).
 */
async function hostingDeployStandIn({ inputs, workspace, world }) {
  const received = inputs.firebaseServiceAccount ?? '';
  world.publisher.calls.push({ received, inputs: { ...inputs, firebaseServiceAccount: received ? '<redacted>' : '' } });
  if (!received) return { ok: false, detail: 'Input required and not supplied: firebaseServiceAccount' };
  const mode = world.publisher.mode ?? 'ok';
  if (mode === 'fail-before') return { ok: false, detail: 'simulated tool failure before any upload' };

  process.noDeprecation = true;
  const FT = join(ROOT, 'node_modules/firebase-tools/lib');
  const { Command } = require(join(FT, 'command.js'));
  const { hostingConfig } = require(join(FT, 'hosting/config.js'));
  const { listFiles } = require(join(FT, 'listFiles.js'));

  const cwd = join(workspace, inputs.entryPoint || '.');
  let config;
  try {
    config = JSON.parse(readFileSync(join(cwd, 'firebase.json'), 'utf8'));
  } catch (error) {
    return { ok: false, detail: `no firebase.json at the entry point: ${error.message}` };
  }
  const options = { cwd, projectRoot: cwd, project: inputs.projectId, only: `hosting:${inputs.target}` };
  try {
    await new Command('deploy').applyRC(options);
  } catch (error) {
    return { ok: false, detail: `firebase-tools refused the project: ${error.message}` };
  }
  let entries;
  try {
    entries = hostingConfig({ ...options, config: { src: config, projectDir: cwd } });
  } catch (error) {
    return { ok: false, detail: `firebase-tools refused the hosting config: ${error.message}` };
  }
  if (entries.length !== 1) return { ok: false, detail: `${entries.length} hosting entries selected` };
  const entry = entries[0];
  const publicDir = join(cwd, entry.public);
  let files = listFiles(publicDir, entry.ignore ?? []).sort();
  const destination = { project: options.project, site: entry.site, channel: inputs.channelId, toolsVersion: inputs.firebaseToolsVersion };
  const site = options.project === world.hosting.project ? world.hosting.sites[entry.site] : null;
  let sourceDir = publicDir;
  if (mode === 'partial') files = files.filter((f) => !f.endsWith('.css'));
  if (mode === 'wrong-candidate') {
    sourceDir = world.publisher.substitute;
    files = listFiles(sourceDir, entry.ignore ?? []).sort();
  }
  const docroot = tempDir('sim-published');
  for (const rel of files) {
    mkdirSync(dirname(join(docroot, rel)), { recursive: true });
    cpSync(join(sourceDir, rel), join(docroot, rel));
  }
  world.publisher.published.push({ ...destination, files, docroot });
  // FAULT INJECTION, labelled: an origin that does not apply the configuration it was
  // handed to the identity file. The gate cannot prevent that — only observe it.
  const served = mode === 'identity-cacheable' ? identityServedCacheable(config) : config;
  if (site) site.serveSite(docroot, served);
  if (mode === 'fail-after') return { ok: false, detail: 'simulated tool failure AFTER the release went live', observed: destination };
  return { ok: true, observed: { ...destination, files: files.length } };
}

function identityServedCacheable(config) {
  const copy = JSON.parse(JSON.stringify(config));
  const entry = Array.isArray(copy.hosting) ? copy.hosting[0] : copy.hosting;
  entry.headers = (entry.headers ?? []).map((rule) => (rule.source === '/release.json'
    ? { ...rule, headers: [{ key: 'Cache-Control', value: 'public, max-age=300' }] } : rule));
  return copy;
}

const STAND_INS = {
  'actions/checkout': checkoutStandIn,
  'actions/setup-node': setupNodeStandIn,
  'actions/download-artifact': downloadStandIn,
  'actions/upload-artifact': uploadStandIn,
  'FirebaseExtended/action-hosting-deploy': hostingDeployStandIn,
};

export const MODELLED_ACTIONS = Object.freeze(Object.keys(STAND_INS));

/** Remove a published site's served files — "nothing has ever been published". */
export function clearSite(site) {
  site.serveSite(null);
}

export function readJsonIn(dir, rel) {
  return JSON.parse(readFileSync(join(dir, rel), 'utf8'));
}

export { rmSync };
