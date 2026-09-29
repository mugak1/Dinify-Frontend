#!/usr/bin/env node
/**
 * JOURNEY OBSERVE: the command around release/lib/journey-observation.mjs (D16 / D08 B4,
 * B2). All judgement is in that module and in B1's journey-peers.mjs; this file is the
 * I/O: arguments, bounded file reads, one private output file, and the process's own
 * `fetch` and credential. See release/JOURNEY_OBSERVATION.md for the contract.
 *
 *   node release/journey-observe.mjs collect --selection <file> --receipt <file>
 *        [--observations-out <file>]
 *   node release/journey-observe.mjs bytes --selection <file> --receipt <file>
 *        --observations <file> --archive <file> --record <file>
 *
 * EXIT STATUS. 0 bytes correspond (consumer checks deferred) · 3 metadata only · 1 refused
 * · 2 usage. No status means a verified or admitted candidate.
 *
 * WHAT IS DELIBERATELY NOT AN OPTION: the API host, a URL, a transport, an executable, a
 * clock, a policy file and a credential. The host is fixed in the module; the policy is the
 * one committed beside this file; a credential is read only from GH_TOKEN or GITHUB_TOKEN,
 * only in `collect`, and only ever sent to that host. Node's `fetch` honours proxy
 * variables only when the operator runs it with NODE_USE_ENV_PROXY=1.
 *
 * WHAT IS NEVER PRINTED: a credential, a response body, a provider message, raw exception
 * text, a local path. The raw API documents a collection read (author names and e-mail
 * addresses included) go only to `--observations-out`, which must be a NEW file in a
 * directory only this user can enter (mode 0700), and is created mode 0600. Removing it is
 * the operator's responsibility; this command never deletes a file it did not just create.
 *
 * `bytes` reads local files only: no network, no extraction and no execution of anything
 * it reads.
 *
 * HOW IT ENDS. Every outcome, usage and internal error included, unwinds to one place
 * (`emit`), which writes the JSON document and the stderr line and exits only once both
 * writes have completed. `process.exit()` with a write still queued drops the rest of it:
 * stdout to a pipe completes asynchronously when the reader is slower than the writer.
 */

import {
  closeSync, fstatSync, lstatSync, openSync, readSync, statSync, unlinkSync, writeSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OBSERVE_LIMITS, OUTCOMES, RESULT_SCHEMA, exitFor, observeBytes, observeMetadata } from './lib/journey-observation.mjs';
import { LIMITS as PEER_LIMITS } from './lib/journey-peers.mjs';

const POLICY_PATH = fileURLToPath(new URL('./policy.json', import.meta.url));

const MODES = Object.freeze({
  collect: Object.freeze({ required: ['selection', 'receipt'], optional: ['observations-out'] }),
  bytes: Object.freeze({ required: ['selection', 'receipt', 'observations', 'archive', 'record'], optional: [] }),
});

const INPUT_BOUNDS = Object.freeze({
  selection: 64 * 1024,
  receipt: PEER_LIMITS.maxReceiptBytes,
  policy: 1024 * 1024,
  observations: OBSERVE_LIMITS.maxSavedBytes,
  archive: PEER_LIMITS.maxArchiveBytes,
  record: PEER_LIMITS.maxRecordBytes,
});

const OPTION_RE = /^--[a-z][a-z-]{0,39}$/;

/** How the command ends: thrown, never returned, so no code after it can run. */
class Exit {
  constructor(document, line, code) {
    this.document = document;
    this.line = line;
    this.code = code;
  }
}

function usage(detail) {
  throw new Exit({
    schema: RESULT_SCHEMA,
    outcome: OUTCOMES.usage.outcome,
    reasons: [{ code: 'journey.observe.usage', detail }],
  }, `journey-observe: usage: ${detail}`, OUTCOMES.usage.exit);
}

function parse(argv) {
  const [mode, ...rest] = argv;
  if (!Object.hasOwn(MODES, mode)) usage('the first argument must be collect or bytes');
  const spec = MODES[mode];
  const known = [...spec.required, ...spec.optional];
  const args = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const name = typeof flag === 'string' && OPTION_RE.test(flag) ? flag.slice(2) : null;
    if (name === null || !known.includes(name)) usage(`unknown option ${name === null ? '<omitted>' : `--${name}`} for ${mode}`);
    if (Object.hasOwn(args, name)) usage(`--${name} was given twice`);
    const value = rest[i + 1];
    if (typeof value !== 'string' || value === '' || value.startsWith('--')) usage(`--${name} needs a value`);
    args[name] = value;
  }
  for (const name of spec.required) if (!Object.hasOwn(args, name)) usage(`${mode} needs --${name}`);
  return { mode, args };
}

/** Read a regular file of at most `max` bytes, exactly as it is. Never follows a link. */
function readRegular(path, max) {
  let info;
  try {
    info = lstatSync(path);
  } catch {
    return { problem: 'missing' };
  }
  if (!info.isFile()) return { problem: 'not-regular' };
  if (info.size > max) return { problem: 'too-large' };
  let fd;
  try {
    fd = openSync(path, 'r');
    const st = fstatSync(fd);
    if (!st.isFile() || st.size !== info.size || st.ino !== info.ino) return { problem: 'changed' };
    if (st.size > max) return { problem: 'too-large' };
    const bytes = new Uint8Array(st.size);
    let at = 0;
    while (at < bytes.length) {
      const n = readSync(fd, bytes, at, bytes.length - at, at);
      if (n === 0) return { problem: 'changed' };
      at += n;
    }
    // One more read must find the end: a file that grew while it was read is not the file
    // that was measured.
    if (readSync(fd, new Uint8Array(1), 0, 1, at) !== 0) return { problem: 'changed' };
    return { bytes };
  } catch {
    return { problem: 'unreadable' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const PROBLEM_WORDS = Object.freeze({
  missing: 'is absent', 'not-regular': 'is not a regular file', 'too-large': 'is larger than its bound',
  changed: 'changed while it was read', unreadable: 'could not be read', 'not-json': 'is not a JSON document',
});

function readJson(name, path) {
  const read = readRegular(path, INPUT_BOUNDS[name]);
  if (read.problem) return { reason: { code: 'journey.observe.input_unreadable', detail: `the ${name} file ${PROBLEM_WORDS[read.problem]}` } };
  try {
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.bytes)) };
  } catch {
    return { reason: { code: 'journey.observe.input_unreadable', detail: `the ${name} file ${PROBLEM_WORDS['not-json']}` } };
  }
}

function readBytesInput(name, path) {
  const read = readRegular(path, INPUT_BOUNDS[name]);
  if (!read.problem) return { bytes: read.bytes };
  const code = read.problem === 'missing' ? 'bytes_input_missing'
    : read.problem === 'too-large' ? 'bytes_input_too_large'
      : read.problem === 'not-regular' ? 'bytes_input_not_regular' : 'bytes_input_unreadable';
  return { reason: { code: `journey.observe.${code}`, detail: `the ${name} file ${PROBLEM_WORDS[read.problem]}` } };
}

/** Reserve a NEW, private output file before anything is collected. */
function reserveOutput(path) {
  const target = resolve(path);
  let dir;
  try {
    dir = statSync(dirname(target));
  } catch {
    usage('the --observations-out directory does not exist');
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (!dir.isDirectory() || (dir.mode & 0o077) !== 0 || (uid !== null && dir.uid !== uid)) {
    usage('the --observations-out directory must be owned by this user and closed to everyone else (mode 0700)');
  }
  try {
    return { target, fd: openSync(target, 'wx', 0o600) };
  } catch {
    return usage('the --observations-out file must not exist yet');
  }
}

function writeAll(fd, text) {
  const bytes = Buffer.from(text, 'utf8');
  let at = 0;
  while (at < bytes.length) at += writeSync(fd, bytes, at, bytes.length - at);
}

function finish(result) {
  throw new Exit(result, `journey-observe: ${result.outcome}`, exitFor(result));
}

/**
 * THE ONE EXIT. The status is set first, so even a stream that never reports back ends
 * with the right one when the event loop drains. The process then exits only from the
 * stderr write's callback, which runs after the stdout write's has: nothing queued is
 * dropped, and no handle left open by the HTTP client can keep the command alive.
 */
function emit({ document, line, code }) {
  process.exitCode = code;
  const done = () => process.stderr.write(`${line}\n`, () => process.exit(code));
  if (document === null) done();
  else process.stdout.write(`${JSON.stringify(document, null, 2)}\n`, done);
}

function internalError(error) {
  const name = error?.name === 'Error' || typeof error?.name !== 'string' ? 'Error' : error.name.replace(/[^A-Za-z]/g, '').slice(0, 40);
  return new Exit(null, `journey-observe: internal error (${name})`, OUTCOMES.usage.exit);
}

function refused(mode, reasons) {
  return { schema: RESULT_SCHEMA, mode, outcome: OUTCOMES.refused.outcome, reasons };
}

async function collect(args) {
  const out = args['observations-out'] ? reserveOutput(args['observations-out']) : null;
  const release = () => {
    if (!out) return;
    closeSync(out.fd);
    unlinkSync(out.target);
  };
  const inputs = {};
  for (const name of ['selection', 'receipt']) {
    const r = readJson(name, args[name]);
    if (r.reason) { release(); finish(refused('metadata', [r.reason])); }
    inputs[name] = r.value;
  }
  const policy = readJson('policy', POLICY_PATH);
  if (policy.reason) { release(); finish(refused('metadata', [policy.reason])); }
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null;
  const { result, saved } = await observeMetadata({
    expected: inputs.selection, receipt: inputs.receipt, policy: policy.value, fetchImpl: globalThis.fetch, token,
  });
  if (out) {
    if (saved) {
      writeAll(out.fd, `${JSON.stringify(saved, null, 2)}\n`);
      closeSync(out.fd);
    } else {
      release();
    }
  }
  finish(result);
}

function bytes(args) {
  const inputs = {};
  for (const name of ['selection', 'receipt', 'observations']) {
    const r = readJson(name, args[name]);
    if (r.reason) finish(refused('bytes', [r.reason]));
    inputs[name] = r.value;
  }
  const policy = readJson('policy', POLICY_PATH);
  if (policy.reason) finish(refused('bytes', [policy.reason]));
  const local = {};
  const reasons = [];
  for (const name of ['archive', 'record']) {
    const r = readBytesInput(name, args[name]);
    if (r.reason) reasons.push(r.reason);
    else local[name] = r.bytes;
  }
  if (reasons.length > 0) finish(refused('bytes', reasons));
  finish(observeBytes({
    expected: inputs.selection,
    receipt: inputs.receipt,
    policy: policy.value,
    saved: inputs.observations,
    archive: local.archive,
    record: local.record,
    now: new Date().toISOString(),
  }));
}

let ending;
try {
  const { mode, args } = parse(process.argv.slice(2));
  if (mode === 'collect') await collect(args);
  else bytes(args);
  // Every mode ends by throwing its Exit; reaching here is itself a defect.
  ending = internalError(new Error('no outcome'));
} catch (error) {
  ending = error instanceof Exit ? error : internalError(error);
}
emit(ending);
