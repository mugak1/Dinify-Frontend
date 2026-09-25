/**
 * THE DEPENDENCY HALF (D08 B2.2), THROUGH THE REAL COMMANDS.
 *
 * decide.test.mjs proves the RULES over synthetic facts. This suite proves the PRODUCERS
 * and READERS hand those rules the truth: `stamp` binds the certification evidence to the
 * exact candidate it stamps (and refuses when it cannot), `observe` re-derives it from the
 * bytes, `prepare-publisher` installs exactly the reviewed toolchain with scripts disabled,
 * `assess` queries the scanner NOW over the candidate's retained graph, and `publish`
 * refuses at the last boundary before it ever reads the credential.
 *
 * WHAT IS REAL: every command above, run as a process from a fixture checkout; git; the
 * dependency-audit snapshot, audit and evaluator. WHAT IS A STAND-IN: the package manager
 * — a recorded npm (fake-npm.mjs) that installs from a fixture store and answers `audit`
 * from an advisory table. Every test that puts an advisory, a failure or an unreadable
 * answer into that table says SYNTHETIC in its title: that table is the network seam, and
 * the only place a synthetic answer enters. The real scanner against the real advisory
 * database is recorded in release/README.md ("The fresh assessment, measured").
 */

import { strict as assert } from 'node:assert';
import {
  chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { before, describe, test } from 'node:test';

import { digestOf, digestOfValue, sha256Hex } from '../lib/canonical.mjs';
import {
  EVIDENCE_DIR, EVIDENCE_RECORD, RETAINED, assessmentTimeReasons, inspectAssessment,
} from '../lib/dependency-evidence.mjs';
import { readFilesUnder, walkTooling } from '../lib/io.mjs';
import { dependencyBoundaryReasons } from '../lib/preflight.mjs';
import { publishInvocation, readPublishResult } from '../lib/publisher.mjs';
import {
  ROOT, artifactDigest, buildCandidate, cli, commitAll, commitPreB22Release, fixtureFrontend, tempDir, writeText,
} from './harness.mjs';
import { applicationGraph, fixtureStore, installFakeNpm } from './fake-npm.mjs';
import { POLICY, admittedRecordFor, baseline, clone } from './fixtures.mjs';

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const MINUTE = 60_000;
const json = (text) => JSON.parse(text.slice(text.indexOf('{')));

/** A fixture checkout, a recorded npm, and a candidate certified from it. */
async function world({ files = {}, certificationAdvisories } = {}) {
  const npm = installFakeNpm({ store: fixtureStore(POLICY.publisher.version) });
  if (certificationAdvisories) npm.setAdvisories(certificationAdvisories);
  const fixture = fixtureFrontend({ files });
  const startedAt = iso(Date.now() - 30 * MINUTE);
  const candidate = await buildCandidate({ repo: fixture.dir, commit: fixture.commit, runId: 6100, startedAt, npm });
  npm.setAdvisories({});
  const certification = {
    present: true, runId: '6100', runAttempt: '1', runStartedAt: startedAt,
    artifacts: [{ id: 81001, name: candidate.name, expired: false, digest: candidate.digest, workflowRunId: 6100 }],
  };
  const certificationPath = join(tempDir('cert'), 'certification.json');
  writeFileSync(certificationPath, JSON.stringify(certification));
  return { npm, fixture, candidate, certification, certificationPath };
}

/** `prepare-publisher` from the fixture checkout: the toolchain dir and its facts. */
async function prepare(w, { root = w.fixture.dir } = {}) {
  const dir = tempDir('tooling');
  const out = join(dir, 'tooling');
  const facts = join(dir, 'tooling.json');
  const r = await cli(['prepare-publisher', '--out', out, '--facts', facts], { root, env: w.npm.env() });
  return { r, out, facts, value: existsSync(facts) ? JSON.parse(readFileSync(facts, 'utf8')) : null };
}

/** `assess` from the fixture checkout, over a COPY of the candidate (so its digest can be compared). */
async function assess(w, tooling, { candidateDir = w.candidate.dir, now = iso(Date.now()) } = {}) {
  const dir = tempDir('assess');
  const candidate = join(dir, 'candidate');
  cpSync(candidateDir, candidate, { recursive: true });
  const out = join(dir, 'assessment');
  const summary = join(dir, 'summary.md');
  writeFileSync(summary, '');
  const before = artifactDigest(candidate);
  const r = await cli([
    'assess', '--candidate', candidate, '--tooling', tooling.out, '--tooling-facts', tooling.facts,
    '--certification', w.certificationPath, '--out', out, '--run-id', '9200', '--run-attempt', '1', '--now', now,
    '--summary', summary,
  ], { root: w.fixture.dir, env: w.npm.env() });
  const doc = existsSync(join(out, 'assessment.json')) ? JSON.parse(readFileSync(join(out, 'assessment.json'), 'utf8')) : null;
  return { r, out, doc, candidate, before, after: artifactDigest(candidate), summary: readFileSync(summary, 'utf8'), replay: join(dir, 'assessment-replay') };
}

const observe = async (dir) => json((await cli(['observe', '--root', dir])).stdout);

// ── certification: the stamp binds, and refuses ─────────────────────────────────

describe('certification evidence — bound by the stamp to the exact candidate it stamps', () => {
  let w;
  before(async () => { w = await world(); });

  test('CONTROL: the evidence sits BESIDE dist/, is bound by provenance, and survives the gate\'s own inspection', async () => {
    const entries = readdirSync(w.candidate.dir).sort();
    assert.deepEqual(entries, ['dependency-evidence', 'dist', 'provenance.json']);
    const obs = await observe(w.candidate.dir);
    assert.equal(obs.provenance.legacy, false);
    assert.equal(obs.dependencyEvidence.state, 'present');
    assert.deepEqual(obs.dependencyEvidence.problems, []);
    const provenance = JSON.parse(readFileSync(join(w.candidate.dir, 'provenance.json'), 'utf8'));
    assert.equal(provenance.dependencyEvidence.recordDigest, obs.dependencyEvidence.recordDigest);
    assert.equal(provenance.dependencyEvidence.treeDigest, obs.dependencyEvidence.treeDigest);
    // The record binds THIS candidate: its tree, its manifest, its run.
    const record = obs.dependencyEvidence.record;
    assert.equal(record.candidate.artifactTreeDigest, obs.observedTreeDigest);
    assert.equal(record.candidate.manifestDigest, obs.manifestDigest);
    assert.equal(record.commit, w.fixture.commit);
    assert.deepEqual([record.certification.runId, record.certification.runAttempt], ['6100', '1']);
    // The raw scanner output re-reads as the decision certification made.
    assert.equal(obs.dependencyEvidence.audit.outcome, record.audit.outcome);
  });

  test('CONTRACT: NOTHING of the evidence or the tool inventories is in the hosted payload', () => {
    const hosted = walkTooling(join(w.candidate.dir, 'dist')).entries.map((e) => e.path);
    for (const path of hosted) {
      assert.ok(!/dependency-evidence|package-lock|package\.json|snapshot|collection|scanner-std|assessment|tooling/.test(path), `${path} is hosted`);
    }
  });

  test('CONTRACT: the record states what the installed-tree digest IS — paths and versions — and the scan\'s one timestamp for what it is', async () => {
    const record = (await observe(w.candidate.dir)).dependencyEvidence.record;
    assert.equal(record.inventory.observation, 'installed-tree-paths-and-versions');
    assert.ok(record.audit.invokedAt, 'the certification scan is recorded as INVOKED at a moment');
    assert.equal('finishedAt' in record.audit, false, 'no finish time is claimed the collection cannot support');
    assert.equal(record.inventory.locked, applicationGraph().lock.packages ? Object.keys(applicationGraph().lock.packages).length - 1 : null);
  });

  test('CONTRACT: two certifications of ONE SHA carry distinct evidence, and swapping it between them is refused', async () => {
    const twin = await buildCandidate({ repo: w.fixture.dir, commit: w.fixture.commit, runId: 6101, startedAt: iso(Date.now() - 20 * MINUTE), npm: w.npm, marker: ' twin' });
    const a = await observe(w.candidate.dir);
    const b = await observe(twin.dir);
    assert.notEqual(a.dependencyEvidence.recordDigest, b.dependencyEvidence.recordDigest);
    // FAULT INJECTION: the twin's evidence beside this candidate's dist/ and provenance.
    const swapped = tempDir('swapped');
    cpSync(w.candidate.dir, swapped, { recursive: true });
    rmSync(join(swapped, EVIDENCE_DIR), { recursive: true });
    cpSync(join(twin.dir, EVIDENCE_DIR), join(swapped, EVIDENCE_DIR), { recursive: true });
    const obs = await observe(swapped);
    assert.ok(obs.dependencyEvidence.problems.some((p) => p.code === 'evidence.record_not_bound'), JSON.stringify(obs.dependencyEvidence.problems));
  });

  test('CONTRACT: a zero-findings result WITHOUT its raw scanner output is refused (fault injection)', async () => {
    const dir = tempDir('no-raw');
    cpSync(w.candidate.dir, dir, { recursive: true });
    rmSync(join(dir, EVIDENCE_DIR, 'audit', 'application.scanner-stdout.txt'));
    const codes = (await observe(dir)).dependencyEvidence.problems.map((p) => p.code);
    assert.ok(codes.includes('evidence.file_missing'), codes.join(','));
  });

  test('CONTRACT: a self-consistent bundle whose raw answer contradicts its result is UNREPRODUCIBLE (fault injection)', async () => {
    // A stand-in for "a certifying run that wrote `within_policy` over a scan that said
    // otherwise": the raw output lists a HIGH runtime advisory, and every digest that
    // binds it — the collection, the record's file list, the record, the provenance — is
    // rewritten to agree. Only re-reading the raw answer can see the lie.
    const dir = tempDir('forged');
    cpSync(w.candidate.dir, dir, { recursive: true });
    const ed = join(dir, EVIDENCE_DIR);
    const stdoutPath = join(ed, 'audit', 'application.scanner-stdout.txt');
    const report = JSON.parse(readFileSync(stdoutPath, 'utf8'));
    report.vulnerabilities.shipped = {
      name: 'shipped', severity: 'high', isDirect: true, effects: [], range: '<3.0.0', nodes: ['node_modules/shipped'], fixAvailable: false,
      via: [{ source: 1, name: 'shipped', dependency: 'shipped', title: 't', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', severity: 'high', range: '<3.0.0' }],
    };
    report.metadata.vulnerabilities.high = 1;
    report.metadata.vulnerabilities.total = 1;
    const raw = `${JSON.stringify(report, null, 2)}\n`;
    writeFileSync(stdoutPath, raw);
    const collectionPath = join(ed, RETAINED.collection);
    const collection = JSON.parse(readFileSync(collectionPath, 'utf8'));
    collection.graphs.application.run.stdoutSha256 = sha256Hex(raw);
    collection.graphs.application.run.stdoutBytes = Buffer.byteLength(raw);
    writeFileSync(collectionPath, `${JSON.stringify(collection, null, 2)}\n`);
    const recordPath = join(ed, EVIDENCE_RECORD);
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    for (const f of record.files) {
      const bytes = readFileSync(join(ed, f.path));
      f.sha256 = sha256Hex(bytes);
      f.bytes = bytes.length;
    }
    const recordBytes = `${JSON.stringify(record, null, 2)}\n`;
    writeFileSync(recordPath, recordBytes);
    const provenancePath = join(dir, 'provenance.json');
    const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
    provenance.dependencyEvidence.recordDigest = digestOf(Buffer.from(recordBytes));
    provenance.dependencyEvidence.treeDigest = (await observe(dir)).dependencyEvidence.treeDigest;
    writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
    const obs = await observe(dir);
    const codes = obs.dependencyEvidence.problems.map((p) => p.code);
    assert.deepEqual(codes, ['evidence.unreproducible'], JSON.stringify(obs.dependencyEvidence.problems));
  });

  test('CONTRACT: a current candidate whose evidence directory is missing reads as ABSENT, not as legacy (fault injection)', async () => {
    const dir = tempDir('no-evidence');
    cpSync(w.candidate.dir, dir, { recursive: true });
    rmSync(join(dir, EVIDENCE_DIR), { recursive: true });
    const obs = await observe(dir);
    assert.equal(obs.provenance.legacy, false);
    assert.equal(obs.dependencyEvidence.state, 'absent');
  });
});

describe('certification evidence — what the stamp REFUSES to bind', () => {
  test('REGRESSION (the premise): a dependency input that changes DURING the build attaches no evidence — no candidate (fault injection)', async () => {
    const npm = installFakeNpm({ store: fixtureStore(POLICY.publisher.version) });
    const fixture = fixtureFrontend();
    const startedAt = iso(Date.now() - 30 * MINUTE);
    const cases = [
      ['an extraneous package installed', (work) => writeText(work, 'node_modules/sneaky/package.json', '{"name":"sneaky","version":"1.0.0"}\n')],
      ['an installed version rewritten', (work) => writeText(work, 'node_modules/shipped/package.json', '{"name":"shipped","version":"2.0.1"}\n')],
      ['a locked package removed', (work) => rmSync(join(work, 'node_modules/tool'), { recursive: true })],
    ];
    for (const [what, beforeStamp] of cases) {
      const r = await buildCandidate({ repo: fixture.dir, commit: fixture.commit, runId: 6200, startedAt, npm, beforeStamp, expectRefusal: true });
      assert.equal(r.refused, true, what);
      assert.match(r.stderr, /does not re-evaluate within policy/, what);
      assert.equal(r.evidenceWritten, false, `${what}: evidence was written`);
      assert.equal(r.provenanceWritten, false, `${what}: provenance was written`);
    }
  });

  test('CONTRACT (SYNTHETIC advisory): a certification audit that BLOCKS stops certification — nothing is built or stamped', async () => {
    const npm = installFakeNpm({ store: fixtureStore(POLICY.publisher.version) });
    npm.setAdvisories({ advisories: [{ name: 'shipped', versions: ['2.0.0'], severity: 'high', ghsa: 'GHSA-aaaa-bbbb-cccc' }] });
    const fixture = fixtureFrontend();
    await assert.rejects(
      buildCandidate({ repo: fixture.dir, commit: fixture.commit, runId: 6201, startedAt: iso(Date.now() - 30 * MINUTE), npm }),
      /certification step "audit" failed \(1\)/,
    );
  });

  test('CONTROL (SYNTHETIC advisory): a LOWER-SEVERITY tooling finding certifies, and stays visible in the evidence', async () => {
    const w = await world({ certificationAdvisories: { advisories: [{ name: 'helper', versions: ['3.1.0'], severity: 'moderate', ghsa: 'GHSA-dddd-eeee-ffff' }] } });
    const record = (await observe(w.candidate.dir)).dependencyEvidence.record;
    assert.equal(record.audit.outcome, 'within_policy');
    assert.equal(record.audit.counts.triageRequired, 1, 'the finding is counted, not dropped');
    assert.equal(record.audit.counts.findings, 1);
  });

  test('CONTRACT: an OLD candidate — stamped by the genuine pre-B2.2 stamp — carries legacy provenance and no evidence', async () => {
    const npm = installFakeNpm({ store: fixtureStore(POLICY.publisher.version) });
    const fixture = fixtureFrontend();
    const { legacy } = commitPreB22Release(fixture.dir);
    const old = await buildCandidate({ repo: fixture.dir, commit: legacy, runId: 6202, startedAt: iso(Date.now() - 30 * MINUTE), npm });
    assert.deepEqual(readdirSync(old.dir).sort(), ['dist', 'provenance.json']);
    const obs = await observe(old.dir);
    assert.equal(obs.provenance.schema, 'dinify.release.provenance/1');
    assert.equal(obs.provenance.legacy, true);
    assert.equal(obs.provenanceValid, true, 'an old record is READABLE — it is refused by name, not as garbage');
    assert.equal(obs.dependencyEvidence.state, 'absent');
  });
});

// ── the toolchain ───────────────────────────────────────────────────────────────

describe('prepare-publisher — the reviewed lock, installed by the pinned npm, scripts disabled, measured', () => {
  let w;
  let t;
  before(async () => { w = await world(); t = await prepare(w); });

  test('CONTROL: the toolchain is prepared and measured, and every lifecycle script stayed un-run', () => {
    assert.equal(t.r.status, 0, t.r.stderr);
    assert.deepEqual(t.value.problems, []);
    assert.equal(t.value.package, POLICY.publisher.package);
    assert.equal(t.value.version, POLICY.publisher.version);
    assert.equal(t.value.node, process.version);
    const walked = walkTooling(t.out);
    assert.deepEqual(walked.unsafe, []);
    assert.equal(walked.treeDigest, t.value.treeDigest);
    assert.equal(walked.entries.length, t.value.entryCount);
    const entry = walked.entries.find((e) => e.path === POLICY.publisher.entrypoint);
    assert.equal(entry.sha256, t.value.entrypoint.sha256);
    const lifecycle = w.npm.calls().filter((c) => c.lifecycle);
    assert.ok(lifecycle.some((c) => c.lifecycle === 'native-thing'), 'the fixture graph carries an install script');
    assert.ok(lifecycle.every((c) => c.ran === false), JSON.stringify(lifecycle));
    assert.equal(existsSync(join(t.out, 'node_modules/native-thing/INSTALL-SCRIPT-RAN')), false);
  });

  test('CONTRACT: the pinned npm is the one that installs it — never the npm on PATH — and it is told to ignore scripts', () => {
    const installs = w.npm.calls().filter((c) => c.args?.[0] === 'ci' && c.cwd === t.out);
    assert.equal(installs.length, 1);
    assert.ok(installs[0].args.includes('--ignore-scripts'));
    assert.ok(installs[0].args.includes('--no-audit'));
  });

  test('CONTRACT: npm\'s bin links are removed, so the tree the publisher receives holds no link at all', () => {
    assert.ok(t.value.removedLinks >= 1);
    const hasBin = (dir) => readdirSync(dir, { withFileTypes: true }).some((d) => d.name === '.bin' || (d.isDirectory() && hasBin(join(dir, d.name))));
    assert.equal(hasBin(join(t.out, 'node_modules')), false);
  });

  test('CONTRACT: npm\'s hidden lockfile is part of the measured tree', () => {
    assert.ok(walkTooling(t.out).entries.some((e) => e.path === 'node_modules/.package-lock.json'));
  });

  test('CONTRACT: a link, a special file or an unexpected top-level entry in a toolchain is unsafe', () => {
    const dir = tempDir('unsafe-tooling');
    cpSync(t.out, dir, { recursive: true });
    symlinkSync('/etc/passwd', join(dir, 'node_modules', 'firebase-tools', 'lib', 'evil.js'));
    writeFileSync(join(dir, 'postinstall.sh'), 'echo');
    const unsafe = walkTooling(dir).unsafe.join('\n');
    assert.match(unsafe, /evil\.js/);
    assert.match(unsafe, /postinstall\.sh/);
  });

  const variants = [
    ['a RANGE instead of the pin', 'tooling.manifest_mismatch', (m) => { m.dependencies[POLICY.publisher.package] = `^${POLICY.publisher.version}`; }],
    ['`latest`', 'tooling.manifest_mismatch', (m) => { m.dependencies[POLICY.publisher.package] = 'latest'; }],
    ['a SECOND tool beside the pinned one', 'tooling.manifest_mismatch', (m) => { m.dependencies['other-cli'] = '1.0.0'; }],
  ];
  for (const [what, code, mutate] of variants) {
    test(`CONTRACT: a reviewed manifest carrying ${what} is refused before anything is installed`, async () => {
      const fixture = fixtureFrontend();
      const path = join(fixture.dir, POLICY.publisher.root, 'package.json');
      const manifest = JSON.parse(readFileSync(path, 'utf8'));
      mutate(manifest);
      writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
      commitAll(fixture.dir, `the publisher manifest carries ${what}`);
      const r = await prepare({ ...w, fixture });
      assert.equal(r.r.status, 1);
      assert.ok(r.value.problems.some((p) => p.code === code), JSON.stringify(r.value.problems));
      assert.equal(existsSync(join(r.out, 'node_modules')), false, 'nothing was installed');
    });
  }

  test('CONTRACT: a reviewed lock at another version than the pin is refused', async () => {
    const fixture = fixtureFrontend();
    const path = join(fixture.dir, POLICY.publisher.root, 'package-lock.json');
    const lock = JSON.parse(readFileSync(path, 'utf8'));
    lock.packages[`node_modules/${POLICY.publisher.package}`].version = '15.0.0';
    writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
    commitAll(fixture.dir, 'the publisher lock moves');
    const r = await prepare({ ...w, fixture });
    assert.equal(r.r.status, 1);
    assert.ok(r.value.problems.some((p) => p.code === 'tooling.lock_mismatch'), JSON.stringify(r.value.problems));
  });

  test('CONTRACT: preparing under another Node than the pin is refused', async () => {
    const policy = JSON.parse(readFileSync(join(ROOT, 'release/policy.json'), 'utf8'));
    const fixture = fixtureFrontend({ policy });
    const path = join(fixture.dir, 'release/policy.json');
    const written = JSON.parse(readFileSync(path, 'utf8'));
    written.publisher.node = '24.0.0';
    writeFileSync(path, `${JSON.stringify(written, null, 2)}\n`);
    commitAll(fixture.dir, 'another Node pinned');
    const r = await prepare({ ...w, fixture });
    assert.equal(r.r.status, 1);
    assert.ok(r.value.problems.some((p) => p.code === 'tooling.runtime_mismatch'), JSON.stringify(r.value.problems));
  });
});

// ── the fresh assessment ────────────────────────────────────────────────────────

describe('assess — a real query, now, over the candidate\'s RETAINED graph, the pinned scanner and the toolchain', () => {
  let w;
  let t;
  before(async () => { w = await world(); t = await prepare(w); assert.equal(t.r.status, 0, t.r.stderr); });

  test('CONTROL: within policy, three graphs, the application graph the CERTIFIED one, and times that happened in order', async () => {
    const callsBefore = w.npm.calls().length;
    const start = iso(Math.floor(Date.now() / 1000) * 1000);
    const a = await assess(w, t, { now: start });
    assert.equal(a.r.status, 0, a.r.stderr);
    assert.equal(a.doc.outcome, 'within_policy');
    assert.deepEqual(Object.keys(a.doc.graphs), ['application', 'scanner', 'publisher']);
    const record = (await observe(w.candidate.dir)).dependencyEvidence.record;
    const app = a.doc.graphs.application;
    assert.equal(app.observation, 'certification-snapshot');
    assert.equal(app.digests.installedTreeSha256, record.inventory.installedTreeSha256);
    assert.equal(app.counts.locked, record.inventory.locked);
    assert.equal(a.doc.graphs.publisher.digests.lockfileSha256, t.value.lock.lockfileSha256);
    // Real clock readings, each its own, at the workflow clock's one-second resolution.
    assert.equal(a.doc.startedAt, start);
    const times = [a.doc.startedAt, ...Object.values(a.doc.graphs).flatMap((g) => [g.startedAt, g.finishedAt]), a.doc.finishedAt, a.doc.decidedAt];
    for (const x of times) assert.match(x, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.deepEqual([...times].sort(), times, 'every reading is at or after the one before it');
    assert.deepEqual(assessmentTimeReasons({ assessment: a.doc, policy: POLICY, now: iso(Date.now() + 1000) }), []);
    // It QUERIED: three `audit` invocations, and no install, no script, no build.
    const calls = w.npm.calls().slice(callsBefore);
    assert.deepEqual(calls.filter((c) => c.args).map((c) => c.args[0]), ['audit', 'audit', 'audit']);
    assert.equal(calls.filter((c) => c.lifecycle).length, 0);
    // The candidate's bytes were read, not changed.
    assert.equal(a.after, a.before);
    // The application graph was read from a replay of exactly the two retained files.
    assert.deepEqual(readdirSync(a.replay).sort(), ['package-lock.json', 'package.json']);
    assert.match(a.summary, /### Fresh dependency assessment/);
  });

  test('CONTRACT: the candidate\'s own scripts never run — the replay holds its manifest and lock and nothing is installed from them', async () => {
    const hooked = await world({ files: {} });
    // A candidate whose package.json carries an install script and whose lock marks one.
    const pkgPath = join(hooked.fixture.dir, 'package.json');
    const lockPath = join(hooked.fixture.dir, 'package-lock.json');
    const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'));
    manifest.scripts = { preinstall: 'touch CANDIDATE-HOOK-RAN', prepare: 'touch CANDIDATE-HOOK-RAN' };
    writeFileSync(pkgPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    lock.packages['node_modules/shipped'].hasInstallScript = true;
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const commit = commitAll(hooked.fixture.dir, 'a candidate with hooks');
    const candidate = await buildCandidate({ repo: hooked.fixture.dir, commit, runId: 6300, startedAt: iso(Date.now() - 30 * MINUTE), npm: hooked.npm });
    hooked.candidate = candidate;
    writeFileSync(hooked.certificationPath, JSON.stringify({
      present: true, runId: '6300', runAttempt: '1', artifacts: [{ id: 81002, name: candidate.name, expired: false, digest: candidate.digest, workflowRunId: 6300 }],
    }));
    const tooling = await prepare(hooked);
    const mark = hooked.npm.calls().length;
    const a = await assess(hooked, tooling, { candidateDir: candidate.dir });
    assert.equal(a.r.status, 0, a.r.stderr);
    const during = hooked.npm.calls().slice(mark);
    assert.ok(!during.some((c) => c.args?.[0] === 'ci'), 'nothing was installed during the assessment');
    assert.ok(!during.some((c) => c.lifecycle), 'no lifecycle script was even considered');
    assert.equal(existsSync(join(a.replay, 'node_modules')), false);
    assert.equal(existsSync(join(a.replay, 'CANDIDATE-HOOK-RAN')), false);
  });

  test('CONTRACT (SYNTHETIC advisory): a NEW advisory refuses UNCHANGED bytes — blocking, and the candidate is untouched', async () => {
    w.npm.setAdvisories({ advisories: [{ name: 'shipped', versions: ['2.0.0'], severity: 'high', ghsa: 'GHSA-aaaa-bbbb-cccc' }] });
    try {
      const a = await assess(w, t);
      assert.equal(a.r.status, 1, a.r.stderr);
      assert.equal(a.doc.outcome, 'blocking');
      assert.equal(a.after, a.before, 'the bytes are the certified ones; the answer about them changed');
    } finally { w.npm.setAdvisories({}); }
  });

  test('CONTRACT (SYNTHETIC advisory): a HIGH advisory in the PUBLISHER graph blocks — the credential-bearing toolchain is held to it', async () => {
    w.npm.setAdvisories({ advisories: [{ name: 'hosting-helper', versions: ['1.2.0'], severity: 'high', ghsa: 'GHSA-gggg-hhhh-iiii' }] });
    try {
      const a = await assess(w, t);
      assert.equal(a.r.status, 1);
      assert.equal(a.doc.outcome, 'blocking');
      assert.ok(a.doc.findings.some((f) => f.path.startsWith('publisher:')), JSON.stringify(a.doc.findings));
    } finally { w.npm.setAdvisories({}); }
  });

  test('CONTROL (SYNTHETIC advisory): a LOWER-SEVERITY publisher finding is visible and does not block — and no record is approved to hide it', async () => {
    w.npm.setAdvisories({ advisories: [{ name: 'hosting-helper', versions: ['1.2.0'], severity: 'moderate', ghsa: 'GHSA-jjjj-kkkk-llll' }] });
    try {
      const a = await assess(w, t);
      assert.equal(a.r.status, 0, a.r.stderr);
      assert.equal(a.doc.outcome, 'within_policy');
      assert.equal(a.doc.counts.triageRequired, 1);
      assert.deepEqual(a.doc.recordsApplied, []);
      assert.match(a.doc.headline, /triage/i);
    } finally { w.npm.setAdvisories({}); }
  });

  for (const [mode, graphPackage, why] of [
    ['network', 'shipped', 'the advisory service cannot be reached'],
    ['garbage', 'hosting-helper', 'the answer is not an audit report'],
  ]) {
    test(`CONTRACT (SYNTHETIC failure at the network seam): ${why} — INCOMPLETE, exit 2, never a pass`, async () => {
      w.npm.setAdvisories({ failures: [{ whenPackage: graphPackage, mode }] });
      try {
        const a = await assess(w, t);
        assert.equal(a.r.status, 2, a.r.stderr);
        assert.equal(a.doc.outcome, 'incomplete');
      } finally { w.npm.setAdvisories({}); }
    });
  }

  test('CONTRACT: the TRUSTED audit policy decides — an exception the candidate carries in its own retained policy is ignored', async () => {
    const a = await assess(w, t);
    assert.equal(a.doc.policy.sha256, sha256Hex(readFileSync(join(w.fixture.dir, 'dependency-audit/policy.json'))));
  });

  test('CONTRACT: a toolchain that changed after it was measured is not assessed as the prepared one', async () => {
    const changed = { ...t, out: tempDir('changed-tooling') };
    cpSync(t.out, changed.out, { recursive: true });
    writeFileSync(join(changed.out, 'node_modules/firebase-tools/lib/extra.js'), '// added after measurement\n');
    const a = await assess(w, changed);
    assert.equal(a.r.status, 2);
    assert.ok(a.doc.reasons.some((r) => r.code === 'tooling_changed'), JSON.stringify(a.doc.reasons));
  });

  test('CONTRACT: NOT PERFORMED — an old candidate, or no prepared toolchain, writes no assessment and exits 2', async () => {
    const fixture = w.fixture;
    const { legacy } = commitPreB22Release(fixture.dir);
    const old = await buildCandidate({ repo: fixture.dir, commit: legacy, runId: 6400, startedAt: iso(Date.now() - 30 * MINUTE), npm: w.npm });
    const notPerformed = await assess(w, t, { candidateDir: old.dir });
    assert.equal(notPerformed.r.status, 2);
    assert.match(notPerformed.r.stderr, /NOT PERFORMED/);
    assert.equal(existsSync(notPerformed.out), false, 'nothing was written that could be read as an assessment');
    const noTooling = { ...t, facts: join(tempDir('bad-tooling'), 'tooling.json') };
    writeFileSync(noTooling.facts, JSON.stringify({ ...t.value, problems: [{ code: 'tooling.install_failed', detail: 'x' }] }));
    const r = await assess(w, noTooling);
    assert.equal(r.r.status, 2);
    assert.match(r.r.stderr, /NOT PERFORMED/);
  });

  test('CONTRACT: the assessment directory is data the publisher re-derives — every raw output bound, nothing unexpected', async () => {
    const a = await assess(w, t);
    const files = readFilesUnder(a.out).files;
    const inspected = inspectAssessment(files);
    assert.deepEqual(inspected.problems, []);
    const extra = new Map(files);
    extra.set('notes.txt', Buffer.from('an unexpected file'));
    assert.ok(inspectAssessment(extra).problems.some((p) => p.code === 'assessment.unexpected_file'));
    const altered = new Map(files);
    altered.set('publisher.scanner-stdout.txt', Buffer.from('{}'));
    assert.ok(inspectAssessment(altered).problems.some((p) => p.code === 'assessment.raw_mismatch'));
  });
});

// ── the last boundary ───────────────────────────────────────────────────────────

describe('publish — the last boundary, before the credential is read', () => {
  test('CONTRACT: the invocation is the admitted entrypoint BY ABSOLUTE PATH, in the stage, with an environment built from nothing', () => {
    const record = admittedRecordFor();
    const inv = publishInvocation({
      policy: POLICY, record, toolingRoot: 'tooling', stage: 'stage', credentialPath: '/tmp/x/sa.json', home: '/tmp/x/home',
      baseEnv: {
        PATH: '/somewhere/else', NODE_OPTIONS: '--require /evil.js', GH_TOKEN: 't', GITHUB_TOKEN: 't', FIREBASE_TOKEN: 't',
        npm_config_registry: 'https://evil.invalid', FIREBASE_SERVICE_ACCOUNT: '{"secret":1}', HTTPS_PROXY: 'http://proxy:3128',
      },
    });
    assert.ok(inv.entrypoint.startsWith('/'), inv.entrypoint);
    assert.ok(inv.entrypoint.endsWith(`/tooling/${record.publisher.entrypoint.path}`));
    assert.ok(inv.cwd.startsWith('/') && inv.cwd.endsWith('/stage'));
    assert.deepEqual(inv.args, ['deploy', '--only', `hosting:${POLICY.hosting.target}`, '--project', POLICY.hosting.project, '--non-interactive', '--json']);
    assert.deepEqual(Object.keys(inv.env).sort(), ['CI', 'FIREBASE_DEPLOY_AGENT', 'GOOGLE_APPLICATION_CREDENTIALS', 'HOME', 'HTTPS_PROXY', 'NO_UPDATE_NOTIFIER', 'PATH']);
    assert.equal(inv.env.PATH, '/usr/bin:/bin');
    assert.equal(inv.env.GOOGLE_APPLICATION_CREDENTIALS, '/tmp/x/sa.json');
    assert.equal(inv.env.FIREBASE_DEPLOY_AGENT, POLICY.publisher.deployAgent);
  });

  const read = (status, stdout, extra = {}) => readPublishResult({ status, stdout, ...extra });
  const results = [
    ['exit 0 and status success', [0, '{"status":"success","result":{}}'], true, 'success'],
    ['noise from a dependency before the JSON answer', [0, 'Deprecation warning\n{"status":"success"}'], true, 'success'],
    ['exit 0 but status error', [0, '{"status":"error","error":"quota"}'], false, 'error'],
    ['status success but a non-zero exit', [1, '{"status":"success"}'], false, 'contradictory'],
    ['no JSON answer at all', [1, 'Error: something'], false, 'unreadable'],
    ['a JSON array', [0, '[1,2]'], false, 'unreadable'],
  ];
  for (const [what, [status, stdout], ok, state] of results) {
    test(`CONTRACT: ${what} → ${ok ? 'published' : 'NOT published'} (${state})`, () => {
      const r = read(status, stdout);
      assert.equal(r.ok, ok);
      assert.equal(r.state, state);
    });
  }
  test('CONTRACT: a killed or never-started tool is not a publication', () => {
    assert.deepEqual([read(null, '', { signal: 'SIGKILL' }).state, read(null, '', { error: 'ENOENT' }).state], ['killed', 'not-run']);
  });

  test('CONTRACT: the boundary re-checks toolchain, runtime and assessment with the SAME rule as the preflight, under its own name', () => {
    const input = baseline();
    const record = admittedRecordFor(input);
    const tooling = { treeDigest: record.publisher.treeDigest, entryCount: record.publisher.entryCount, unsafe: [], entrypointSha256: record.publisher.entrypoint.sha256, runtime: record.publisher.node };
    const at = (now, t = tooling, a = clone(input.dependencies.assessment)) => dependencyBoundaryReasons({ record, policy: POLICY, tooling: t, assessment: a, now, prefix: 'publisher' }).map((r) => r.code);
    assert.deepEqual(at('2026-09-22T12:10:00Z'), []);
    assert.deepEqual(at('2026-09-23T11:50:01Z'), ['publisher.assessment_stale']);
    assert.deepEqual(at('2026-09-22T12:10:00Z', { ...tooling, treeDigest: `sha256:${'0'.repeat(64)}` }), ['publisher.tooling_mismatch']);
    assert.deepEqual(at('2026-09-22T12:10:00Z', { ...tooling, runtime: 'v24.0.0' }), ['publisher.runtime_mismatch']);
    const other = clone(input.dependencies.assessment);
    other.digest = `sha256:${'0'.repeat(64)}`;
    assert.deepEqual(at('2026-09-22T12:10:00Z', tooling, other), ['publisher.assessment_mismatch']);
  });

  test('CONTRACT: `publish` refuses at the last boundary WITHOUT reading the credential or running anything', async () => {
    const fixture = fixtureFrontend();
    const dir = tempDir('publish');
    const input = baseline();
    const record = admittedRecordFor(input);
    const recordPath = join(dir, 'record.json');
    writeFileSync(recordPath, JSON.stringify(record));
    mkdirSync(join(dir, 'stage'), { recursive: true });
    writeFileSync(join(dir, 'stage', 'firebase.json'), '{}');
    const tooling = join(dir, 'tooling');
    mkdirSync(join(tooling, 'node_modules', 'firebase-tools', 'lib', 'bin'), { recursive: true });
    const marker = join(dir, 'TOOL-RAN');
    writeFileSync(join(tooling, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
    for (const f of ['package.json', 'package-lock.json']) writeFileSync(join(tooling, f), '{}');
    chmodSync(tooling, 0o755);
    const assessment = join(dir, 'assessment');
    mkdirSync(assessment);
    writeFileSync(join(assessment, 'assessment.json'), JSON.stringify(input.dependencies.assessment.doc));
    const r = await cli([
      'publish', '--record', recordPath, '--stage', join(dir, 'stage'), '--tooling', tooling, '--assessment', assessment,
      '--now', '2026-09-24T00:00:00Z', '--out', join(dir, 'publish.json'), '--temp-root', dir,
    ], { root: fixture.dir, env: { FIREBASE_SERVICE_ACCOUNT: '{"type":"service_account","simulated":true}' } });
    assert.equal(r.status, 1);
    const out = JSON.parse(readFileSync(join(dir, 'publish.json'), 'utf8'));
    assert.equal(out.ok, false);
    assert.equal(out.tool, null, 'the tool was never started');
    const codes = out.reasons.map((x) => x.code);
    for (const code of ['publisher.tooling_mismatch', 'publisher.assessment_mismatch', 'publisher.certification_stale']) assert.ok(codes.includes(code), codes.join(','));
    assert.equal(existsSync(marker), false, 'the entrypoint never ran');
    assert.deepEqual(readdirSync(dir).filter((n) => n.startsWith('dinify-publish-')), [], 'no credential directory was ever created');
  });
});

describe('fixture sanity', () => {
  test('the recorded npm answers `audit` over EXACTLY the lock graph, as npm reads it (coverage the reader checks)', async () => {
    const w = await world();
    const obs = await observe(w.candidate.dir);
    const raw = readFileSync(join(w.candidate.dir, EVIDENCE_DIR, 'audit', 'application.scanner-stdout.txt'), 'utf8');
    assert.equal(JSON.parse(raw).metadata.dependencies.total, obs.dependencyEvidence.record.inventory.locked);
    assert.equal(digestOfValue(null) !== null, true);
  });
});
