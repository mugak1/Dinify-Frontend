/**
 * A RECORDED npm FOR THE RELEASE TESTS — the analogue of the recorded `gh` in harness.mjs.
 *
 * WHY. The fresh assessment and the toolchain preparation run the REAL release CLI, which
 * runs `npm ci` (to install the pinned scanner) and then the pinned scanner's own
 * `npm-cli.js` (to install the publisher lock, and to `audit` three graphs). In a test
 * none of that may reach the network, and the ADVISORY ANSWER has to be controllable so
 * a new advisory, a network failure or an unreadable answer can be driven
 * deterministically. This file is that seam: a small npm that answers `ci` from a
 * recorded package store and `audit` from a recorded advisory table.
 *
 * WHERE SYNTHETIC ANSWERS ENTER, AND NOWHERE ELSE. The advisory table is the only place a
 * synthetic advisory is injected: it is what the advisory service would have answered,
 * delivered at the scanner's process boundary — the point where the network's answer
 * enters this system. Everything downstream (the report reader, the evaluator, the
 * decision, the record, the preflight, the publish command) is the real code reading it.
 * Tests that inject an answer say SYNTHETIC in their title. The REAL scanner against the
 * REAL advisory database is exercised separately (release/README.md, "The fresh
 * assessment, measured").
 *
 * WHAT IT MODELS, and exactly how far:
 *   ci      reads package-lock.json, refuses a root that disagrees with package.json (as
 *           npm ci does), and materialises every locked package under node_modules from
 *           the store: a package.json, plus any files the store holds for it. A lock
 *           entry marked hasInstallScript RECORDS whether its script would have run —
 *           it runs unless --ignore-scripts was passed — so a caller that forgot the flag
 *           is caught. Every invocation is logged with its argv.
 *   audit   reads package-lock.json (as `npm audit` reads the lockfile graph) and writes
 *           an `npm audit --json` report shaped as npm 11 writes one: vulnerabilities by
 *           name with nodes and via, counters by severity, the dependency total, and
 *           exit 1 when anything at or above `low` is listed. The table can also answer
 *           with an error body, an unreadable body, or a hang past the timeout.
 * It is NOT npm: no resolution, no cache, no integrity check (the lock is the input).
 *
 * The stub PUBLISHER (the store's firebase-tools entrypoint) is the observable publisher
 * the workflow simulation drives: it resolves the destination with firebase-tools' OWN
 * functions (from this repository's node_modules), lists the upload with the tool's own
 * ignore handling, copies exactly those files to a docroot, and reports the publication
 * to the simulation through $RUNNER_TEMP/sim-publisher/ — including the credential it
 * received, so a test can prove the credential reached this process and no other.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, tempDir } from './harness.mjs';

/** The npm stand-in, as source. It is ALSO the pinned scanner's npm-cli.js. */
export const FAKE_NPM_SOURCE = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const cwd = process.cwd();
const log = process.env.FAKE_NPM_LOG;
if (log) fs.appendFileSync(log, JSON.stringify({ args, cwd }) + '\\n');
const command = args.find((a) => !a.startsWith('-'));
const flag = (name) => args.includes(name);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const sortEntries = (o) => JSON.stringify(Object.entries(o || {}).sort());

if (command === 'ci') {
  const lock = readJson(path.join(cwd, 'package-lock.json'));
  const manifest = readJson(path.join(cwd, 'package.json'));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (sortEntries(lock.packages[''][field]) !== sortEntries(manifest[field])) {
      process.stderr.write('npm error code EUSAGE\\nnpm error \`npm ci\` can only install packages when your package.json and package-lock.json are in sync.\\n');
      process.exit(1);
    }
  }
  const store = process.env.FAKE_REGISTRY ? readJson(process.env.FAKE_REGISTRY) : {};
  fs.rmSync(path.join(cwd, 'node_modules'), { recursive: true, force: true });
  for (const [p, entry] of Object.entries(lock.packages)) {
    if (p === '' || entry.link) continue;
    const name = entry.name || p.slice(p.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const dir = path.join(cwd, p);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: entry.version }) + '\\n');
    const files = (store[name + '@' + entry.version] || {}).files || {};
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    }
    if (entry.bin) {
      const bin = path.join(cwd, path.dirname(p), '.bin');
      fs.mkdirSync(bin, { recursive: true });
      for (const [b, target] of Object.entries(entry.bin)) {
        try { fs.symlinkSync(path.relative(bin, path.join(dir, target)), path.join(bin, b)); } catch (e) { /* exists */ }
      }
    }
    if (entry.hasInstallScript) {
      const ran = !flag('--ignore-scripts');
      if (log) fs.appendFileSync(log, JSON.stringify({ lifecycle: name, ran }) + '\\n');
      if (ran) fs.writeFileSync(path.join(dir, 'INSTALL-SCRIPT-RAN'), 'a lifecycle script executed\\n');
    }
  }
  // npm writes the hidden lockfile too; an upload that drops hidden files loses it.
  fs.mkdirSync(path.join(cwd, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'node_modules', '.package-lock.json'), JSON.stringify({ name: lock.name, lockfileVersion: 3, packages: Object.fromEntries(Object.entries(lock.packages).filter(([p]) => p)) }) + '\\n');
  process.stdout.write('added ' + (Object.keys(lock.packages).length - 1) + ' packages\\n');
  process.exit(0);
}

if (command === 'audit') {
  const lock = readJson(path.join(cwd, 'package-lock.json'));
  const table = process.env.FAKE_ADVISORIES && fs.existsSync(process.env.FAKE_ADVISORIES) ? readJson(process.env.FAKE_ADVISORIES) : { advisories: [] };
  const names = new Set(Object.entries(lock.packages).filter(([p]) => p).map(([p, e]) => e.name || p.slice(p.lastIndexOf('node_modules/') + 13)));
  const failure = (table.failures || []).find((f) => names.has(f.whenPackage));
  if (failure && failure.mode === 'network') {
    process.stdout.write(JSON.stringify({ message: 'request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org', error: { code: 'ENOTFOUND', summary: '', detail: '' } }) + '\\n');
    process.exit(1);
  }
  if (failure && failure.mode === 'garbage') { process.stdout.write('<html>502 Bad Gateway</html>\\n'); process.exit(1); }
  if (failure && failure.mode === 'hang') { setTimeout(() => {}, 1e9); return; }
  const vulnerabilities = {};
  const counted = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  let source = 5000;
  for (const adv of table.advisories || []) {
    const nodes = Object.entries(lock.packages)
      .filter(([p, e]) => p && (e.name || p.slice(p.lastIndexOf('node_modules/') + 13)) === adv.name && adv.versions.includes(e.version))
      .map(([p]) => p);
    if (!nodes.length) continue;
    source += 1;
    const via = { source, name: adv.name, dependency: adv.name, title: adv.title || (adv.name + ' advisory'),
      url: 'https://github.com/advisories/' + adv.ghsa, severity: adv.severity, cwe: [], cvss: {}, range: adv.range || '*' };
    const prior = vulnerabilities[adv.name];
    if (prior) { prior.via.push(via); continue; }
    vulnerabilities[adv.name] = { name: adv.name, severity: adv.severity, isDirect: false, via: [via], effects: [], range: adv.range || '*', nodes, fixAvailable: false };
  }
  const rank = ['info', 'low', 'moderate', 'high', 'critical'];
  for (const v of Object.values(vulnerabilities)) {
    v.severity = v.via.map((x) => x.severity).sort((a, b) => rank.indexOf(a) - rank.indexOf(b)).at(-1);
    counted[v.severity] += 1;
  }
  const total = Object.keys(lock.packages).length - 1;
  const report = { auditReportVersion: 2, vulnerabilities,
    metadata: { vulnerabilities: { ...counted, total: Object.keys(vulnerabilities).length },
      dependencies: { prod: total, dev: 0, optional: 0, peer: 0, peerOptional: 0, total } } };
  process.stdout.write(JSON.stringify(report, null, 2) + '\\n');
  process.exit(Object.values(vulnerabilities).some((v) => rank.indexOf(v.severity) >= 1) ? 1 : 0);
}

process.stderr.write('fake npm: unsupported command ' + JSON.stringify(args) + '\\n');
process.exit(2);
`;

/**
 * THE STUB PUBLISHER — the admitted toolchain's entrypoint in the simulation. It is run
 * by the REAL `publish` command, by path, with the REAL built environment, so what it
 * reports (argv, cwd, the credential file's content, the environment it received) is
 * what the production command would hand firebase-tools.
 */
export function stubPublisherSource() {
  return `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = ${JSON.stringify(ROOT)};
const temp = process.env.RUNNER_TEMP;
const dir = path.join(temp || '/nonexistent', 'sim-publisher');
const say = (o, code) => { process.stdout.write(JSON.stringify(o, null, 2)); process.exit(code); };
if (!temp || !fs.existsSync(dir)) say({ status: 'error', error: 'the simulation did not prepare a publisher channel' }, 1);
const mode = fs.existsSync(path.join(dir, 'mode.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'mode.json'), 'utf8')) : { mode: 'ok' };
const argv = process.argv.slice(2);
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
let received = '';
try { received = fs.readFileSync(credentialPath, 'utf8'); } catch (e) { received = ''; }
let credentialMode = null;
try { credentialMode = (fs.statSync(credentialPath).mode & 0o777).toString(8); } catch (e) { credentialMode = null; }
const report = { argv, cwd: process.cwd(), entrypoint: __filename, received, credentialPath, credentialMode, envKeys: Object.keys(process.env).sort(), node: process.version, deployAgent: process.env.FIREBASE_DEPLOY_AGENT };
const write = (extra) => fs.writeFileSync(path.join(dir, 'request-' + Date.now() + '-' + process.pid + '.json'), JSON.stringify({ ...report, ...extra }));
if (mode.mode === 'fail-before') { write({ published: null }); say({ status: 'error', error: 'simulated tool failure before any upload' }, 1); }
process.noDeprecation = true;
const FT = path.join(ROOT, 'node_modules/firebase-tools/lib');
const { Command } = require(path.join(FT, 'command.js'));
const { hostingConfig } = require(path.join(FT, 'hosting/config.js'));
const { listFiles } = require(path.join(FT, 'listFiles.js'));
const i = (name) => argv[argv.indexOf(name) + 1];
(async () => {
  const cwd = process.cwd();
  const config = JSON.parse(fs.readFileSync(path.join(cwd, 'firebase.json'), 'utf8'));
  const only = i('--only');
  const options = { cwd, projectRoot: cwd, project: i('--project'), only };
  await new Command('deploy').applyRC(options);
  const entries = hostingConfig({ ...options, config: { src: config, projectDir: cwd } });
  if (entries.length !== 1) { write({ published: null }); say({ status: 'error', error: entries.length + ' hosting entries selected' }, 1); }
  const entry = entries[0];
  const publicDir = path.join(cwd, entry.public);
  let files = listFiles(publicDir, entry.ignore || []).sort();
  let sourceDir = publicDir;
  if (mode.mode === 'partial') files = files.filter((f) => !f.endsWith('.css'));
  if (mode.mode === 'wrong-candidate') { sourceDir = mode.substitute; files = listFiles(sourceDir, entry.ignore || []).sort(); }
  const docroot = fs.mkdtempSync(path.join(temp, 'sim-published-'));
  for (const rel of files) {
    fs.mkdirSync(path.dirname(path.join(docroot, rel)), { recursive: true });
    fs.copyFileSync(path.join(sourceDir, rel), path.join(docroot, rel));
  }
  write({ published: { project: options.project, site: entry.site, only, files, docroot, config } });
  if (mode.mode === 'fail-after') say({ status: 'error', error: 'simulated tool failure AFTER the release went live' }, 1);
  say({ status: 'success', result: { hosting: entry.site } }, 0);
})().catch((e) => { write({ published: null, error: String(e && e.message) }); say({ status: 'error', error: String(e && e.message) }, 1); });
`;
}

/**
 * A recorded npm on PATH, with its package store and advisory table.
 * @returns {{bin, env, calls, setAdvisories, store}}
 */
export function installFakeNpm({ store = {} } = {}) {
  const dir = tempDir('npm');
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const registry = join(dir, 'registry.json');
  const advisories = join(dir, 'advisories.json');
  const log = join(dir, 'calls.jsonl');
  writeFileSync(join(bin, 'npm'), FAKE_NPM_SOURCE);
  chmodSync(join(bin, 'npm'), 0o755);
  writeFileSync(registry, JSON.stringify(store));
  writeFileSync(advisories, JSON.stringify({ advisories: [] }));
  writeFileSync(log, '');
  return {
    bin,
    env: () => ({ PATH: `${bin}:${process.env.PATH}`, FAKE_REGISTRY: registry, FAKE_ADVISORIES: advisories, FAKE_NPM_LOG: log }),
    /** SYNTHETIC advisories (and failures), answered by the next `audit`. */
    setAdvisories(table) { writeFileSync(advisories, JSON.stringify({ advisories: [], ...table })); },
    calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    setStore(next) { writeFileSync(registry, JSON.stringify(next)); },
  };
}

// ── the fixture graphs ─────────────────────────────────────────────────────────

export const FIXTURE_SCANNER_VERSION = '11.19.1';

const lockOf = (name, deps, packages) => ({
  name, version: '0.0.0', lockfileVersion: 3, requires: true,
  packages: { '': { name, version: '0.0.0', dependencies: deps }, ...packages },
});

/** The application graph a fixture frontend certifies: small, and real in shape. */
export function applicationGraph() {
  const manifest = { name: 'release-fixture', version: '0.0.0', private: true, dependencies: { shipped: '^2.0.0' }, devDependencies: { tool: '^1.0.0' } };
  const lock = {
    name: 'release-fixture', version: '0.0.0', lockfileVersion: 3, requires: true,
    packages: {
      '': { name: 'release-fixture', version: '0.0.0', dependencies: manifest.dependencies, devDependencies: manifest.devDependencies },
      'node_modules/shipped': { version: '2.0.0', resolved: 'https://registry.npmjs.org/shipped/-/shipped-2.0.0.tgz', integrity: 'sha512-AAAA' },
      'node_modules/tool': { version: '1.0.0', dev: true, resolved: 'https://registry.npmjs.org/tool/-/tool-1.0.0.tgz', integrity: 'sha512-BBBB', dependencies: { helper: '^3.0.0' } },
      'node_modules/tool/node_modules/helper': { version: '3.1.0', dev: true, integrity: 'sha512-CCCC' },
    },
  };
  return { manifest, lock };
}

export function scannerGraph() {
  const manifest = { name: 'scanner', version: '0.0.0', private: true, dependencies: { npm: FIXTURE_SCANNER_VERSION } };
  const lock = lockOf('scanner', manifest.dependencies, {
    'node_modules/npm': { version: FIXTURE_SCANNER_VERSION, integrity: 'sha512-EEEE', dependencies: { bundled: '1.0.0' } },
    'node_modules/npm/node_modules/bundled': { version: '1.0.0', inBundle: true },
  });
  return { manifest, lock };
}

/** The publisher graph: the pinned tool, one dependency, and one package with an install script. */
export function publisherGraph(version) {
  const manifest = { name: 'dinify-frontend-publisher', version: '0.0.0', private: true, dependencies: { 'firebase-tools': version } };
  const lock = lockOf('dinify-frontend-publisher', manifest.dependencies, {
    'node_modules/firebase-tools': { version, integrity: 'sha512-FFFF', bin: { firebase: 'lib/bin/firebase.js' }, dependencies: { 'hosting-helper': '^1.0.0', 'native-thing': '^1.0.0' } },
    'node_modules/hosting-helper': { version: '1.2.0', integrity: 'sha512-GGGG' },
    'node_modules/native-thing': { version: '1.0.0', integrity: 'sha512-HHHH', hasInstallScript: true },
  });
  return { manifest, lock };
}

/** The store the fake npm installs from: the scanner IS the fake npm, the tool IS the stub publisher. */
export function fixtureStore(publisherVersion) {
  return {
    [`npm@${FIXTURE_SCANNER_VERSION}`]: { files: { 'bin/npm-cli.js': FAKE_NPM_SOURCE } },
    [`firebase-tools@${publisherVersion}`]: { files: { 'lib/bin/firebase.js': stubPublisherSource() } },
  };
}
