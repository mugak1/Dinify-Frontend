/**
 * CI-SIGNAL A-2 AT PROMOTION: provenance relative to the candidate's own retained locks,
 * the clock read from GitHub once and re-read offline, and the publisher graph held to
 * today's rule.
 *
 * WHAT IS REAL: the release CLI (`stamp`, `observe`, `prepare-publisher`, `assess`) run as
 * processes from a fixture checkout, git, the dependency-audit code, `decide()` and the
 * inspections. WHAT IS A STAND-IN: the scanner's answer (fake-npm.mjs) and GitHub's
 * advisory answer (fake-github-advisories.mjs) — both SYNTHETIC, both at the process
 * boundary where the network's answer enters. Nothing here reaches the network.
 */

import { strict as assert } from 'node:assert';
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, test } from 'node:test';

import {
  ASSESSMENT_DOC, PASSING_OUTCOMES, RETAINED_ADVISORIES, assessmentExpiresAt, assessmentObligations, assessmentTimeReasons, inspectAssessment,
} from '../lib/dependency-evidence.mjs';
import { decide } from '../lib/decide.mjs';
import { readFilesUnder } from '../lib/io.mjs';
import { ADVISORIES_FILE } from '../../dependency-audit/lib/advisories.mjs';
import { buildCandidate, cli, commitAll, fixtureFrontend, git, tempDir, writeText } from './harness.mjs';
import { fixtureStore, installFakeNpm } from './fake-npm.mjs';
import { POLICY, baseline, codes } from './fixtures.mjs';

const DAY = 86_400_000;
const MINUTE = 60_000;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const dateOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const json = (text) => JSON.parse(text.slice(text.indexOf('{')));
const G_HELPER = 'GHSA-hhhh-eeee-llll';
const G_PUBLISHER = 'GHSA-pppp-uuuu-bbbb';
const G_SCANNER = 'GHSA-ssss-cccc-nnnn';
const HELPER_PATH = 'application:node_modules/tool/node_modules/helper';

/** A fixture checkout with TWO commits (so a certification can name a base), a recorded npm, and a candidate. */
async function world({ certificationAdvisories, githubAdvisories, auditBase = false } = {}) {
  const npm = installFakeNpm({ store: fixtureStore(POLICY.publisher.version) });
  const fixture = fixtureFrontend();
  const base = fixture.commit;
  writeText(fixture.dir, 'NOTES.md', 'a change that touches no dependency\n');
  const head = commitAll(fixture.dir, 'head');
  if (certificationAdvisories) npm.setAdvisories(certificationAdvisories);
  if (githubAdvisories) npm.setGitHubAdvisories(githubAdvisories);
  const startedAt = iso(Date.now() - 30 * MINUTE);
  const candidate = await buildCandidate({ repo: fixture.dir, commit: head, runId: 6200, startedAt, npm, auditBase: auditBase ? base : undefined });
  npm.setAdvisories({});
  npm.setGitHubAdvisories({});
  const certification = {
    present: true, runId: '6200', runAttempt: '1', runStartedAt: startedAt,
    artifacts: [{ id: 82001, name: candidate.name, expired: false, digest: candidate.digest, workflowRunId: 6200 }],
  };
  const certificationPath = join(tempDir('cert'), 'certification.json');
  writeFileSync(certificationPath, JSON.stringify(certification));
  return { npm, fixture, base, head, candidate, certificationPath };
}

async function prepare(w) {
  const dir = tempDir('tooling');
  const out = join(dir, 'tooling');
  const facts = join(dir, 'tooling.json');
  const r = await cli(['prepare-publisher', '--out', out, '--facts', facts], { root: w.fixture.dir, env: w.npm.env() });
  assert.equal(r.status, 0, r.stderr);
  return { out, facts };
}

async function assess(w, t) {
  const out = join(tempDir('assess'), 'assessment');
  const r = await cli([
    'assess', '--candidate', w.candidate.dir, '--tooling', t.out, '--tooling-facts', t.facts,
    '--certification', w.certificationPath, '--out', out, '--run-id', '9300', '--run-attempt', '1', '--now', iso(Date.now()),
  ], { root: w.fixture.dir, env: w.npm.env() });
  const doc = existsSync(join(out, ASSESSMENT_DOC)) ? JSON.parse(readFileSync(join(out, ASSESSMENT_DOC), 'utf8')) : null;
  return { r, out, doc };
}

/** One synthetic scanner advisory on `name`, and GitHub's record of it reviewed `daysAgo` days ago. */
function advise(w, { name = 'helper', version = '3.1.0', severity = 'high', ghsa = G_HELPER, daysAgo = 2 } = {}) {
  w.npm.setAdvisories({ advisories: [{ name, versions: [version], severity, ghsa }] });
  const reviewed = Date.now() - daysAgo * DAY;
  w.npm.setGitHubAdvisories({ [ghsa]: { reviewed: iso(reviewed), published: iso(reviewed - DAY) } });
  return dateOf(reviewed);
}
const reset = (w) => { w.npm.setAdvisories({}); w.npm.setGitHubAdvisories({}); };
const finding = (doc, path) => doc.findings.find((f) => f.path === path);

describe('the fresh assessment: provenance against the candidate\'s own retained locks, dates from GitHub', () => {
  let w;
  let t;
  before(async () => { w = await world(); t = await prepare(w); });

  test('CONTRACT (SYNTHETIC advisory): an inherited HIGH tooling finding inside its window PASSES the assessment — obligations_pending, exit 0', async () => {
    const since = advise(w, { daysAgo: 2 });
    try {
      const a = await assess(w, t);
      assert.equal(a.r.status, 0, a.r.stderr);
      assert.equal(a.doc.outcome, 'obligations_pending');
      assert.ok(PASSING_OUTCOMES.includes(a.doc.outcome));
      const f = finding(a.doc, HELPER_PATH);
      assert.equal(f.provenance, 'inherited', 'nothing can be introduced into fixed bytes');
      assert.equal(f.reportableSince, since);
      assert.equal(f.class, 'deferred');
      assert.equal(f.deadline, dateOf(Date.parse(`${since}T00:00:00Z`) + 7 * DAY));
      // The record is retained in the assessment and named by it; one request, unauthenticated.
      assert.ok(existsSync(join(a.out, ADVISORIES_FILE)));
      assert.equal(a.doc.advisories.file, ADVISORIES_FILE);
      assert.deepEqual(w.npm.githubRequests().slice(-1), [{ id: G_HELPER, authorized: false }]);
      // The privileged re-read, offline, from the retained files: clean.
      assert.deepEqual(inspectAssessment(readFilesUnder(a.out).files).problems, []);
      assert.deepEqual(assessmentObligations(a.doc), [{ advisory: G_HELPER, path: HELPER_PATH, deadline: f.deadline }]);
    } finally { reset(w); }
  });

  test('REGRESSION (SYNTHETIC advisory): the same inherited high PAST its deadline is refused — blocking, exit 1', async () => {
    advise(w, { daysAgo: 8 });
    try {
      const a = await assess(w, t);
      assert.equal(a.r.status, 1, a.r.stderr);
      assert.equal(a.doc.outcome, 'blocking');
      assert.equal(finding(a.doc, HELPER_PATH).provenance, 'inherited');
    } finally { reset(w); }
  });

  test('REGRESSION (SYNTHETIC advisory): an inherited CRITICAL is refused at once — blocking', async () => {
    advise(w, { severity: 'critical', daysAgo: 1 });
    try {
      const a = await assess(w, t);
      assert.equal(a.doc.outcome, 'blocking');
      assert.equal(finding(a.doc, HELPER_PATH).reportableSince !== undefined, true, 'dated, and still blocking: critical has no window');
    } finally { reset(w); }
  });

  test('REGRESSION (SYNTHETIC advisory): a GitHub answer that is not a record leaves NO date — the inherited high blocks', async () => {
    advise(w, { daysAgo: 2 });
    w.npm.setGitHubAdvisories({ [G_HELPER]: { status: 403, body: '{"message":"API rate limit exceeded"}' } });
    try {
      const a = await assess(w, t);
      assert.equal(a.doc.outcome, 'blocking');
      assert.equal('reportableSince' in finding(a.doc, HELPER_PATH), false);
    } finally { reset(w); }
  });

  test('CONTRACT (SYNTHETIC advisory): the SCANNER graph has provenance too — an unchanged bundled package\'s high inside its window → obligations_pending', async () => {
    const since = advise(w, { name: 'bundled', version: '1.0.0', ghsa: G_SCANNER, daysAgo: 2 });
    try {
      const a = await assess(w, t);
      assert.equal(a.r.status, 0, a.r.stderr);
      assert.equal(a.doc.outcome, 'obligations_pending', JSON.stringify(a.doc.reasons));
      const f = a.doc.findings.find((x) => x.path.startsWith('scanner:'));
      assert.ok(f, JSON.stringify(a.doc.findings));
      assert.equal(f.provenance, 'inherited', 'the trusted scanner lock still holds the candidate\'s retained entry');
      assert.equal(f.reportableSince, since);
      assert.deepEqual(inspectAssessment(readFilesUnder(a.out).files).problems, []);
    } finally { reset(w); }
  });

  test('CONTRACT (SYNTHETIC advisory): the PUBLISHER graph is NEVER given provenance — a high there blocks whatever GitHub says, and is never even asked about', async () => {
    advise(w, { name: 'hosting-helper', version: '1.2.0', ghsa: G_PUBLISHER, daysAgo: 1 });
    const asked = w.npm.githubRequests().length;
    try {
      const a = await assess(w, t);
      assert.equal(a.r.status, 1);
      assert.equal(a.doc.outcome, 'blocking');
      const f = a.doc.findings.find((x) => x.path.startsWith('publisher:'));
      assert.ok(f, JSON.stringify(a.doc.findings));
      assert.equal('provenance' in f, false);
      assert.equal('reportableSince' in f, false);
      assert.equal(w.npm.githubRequests().length, asked, 'no request was made for the publisher\'s advisory');
      assert.equal(existsSync(join(a.out, ADVISORIES_FILE)), false, 'nothing needed a date');
    } finally { reset(w); }
  });

  describe('the re-read refuses an assessment the retained record does not support', () => {
    let a;
    before(async () => { advise(w, { daysAgo: 2 }); try { a = await assess(w, t); } finally { reset(w); } });
    const forge = (mutate) => {
      const files = new Map(readFilesUnder(a.out).files);
      mutate(files);
      return inspectAssessment(files).problems.map((p) => p.code);
    };
    const editDoc = (files, change) => {
      const doc = JSON.parse(files.get(ASSESSMENT_DOC).toString('utf8'));
      change(doc);
      files.set(ASSESSMENT_DOC, Buffer.from(`${JSON.stringify(doc, null, 2)}\n`));
    };

    test('CONTROL: the assessment as written is clean', () => assert.deepEqual(forge(() => {}), []));
    test('REGRESSION: a TAMPERED advisories.json is refused', () => {
      assert.deepEqual(forge((files) => files.set(ADVISORIES_FILE, Buffer.from(files.get(ADVISORIES_FILE).toString('utf8').replace(/"status": 200/, '"status": 201')))), ['assessment.advisories_invalid']);
    });
    test('REGRESSION: an advisories.json the document does not name is an unexpected file', () => {
      assert.ok(forge((files) => editDoc(files, (d) => { delete d.advisories; })).includes('assessment.unexpected_file'));
    });
    test('REGRESSION: a date the record does not support is refused', () => {
      assert.ok(forge((files) => editDoc(files, (d) => { d.findings[0].reportableSince = '2099-01-01'; })).includes('assessment.date_unsupported'));
    });
    test('REGRESSION: a deadline later than the rule grants is refused', () => {
      assert.ok(forge((files) => editDoc(files, (d) => { d.findings[0].deadline = '2099-01-01'; })).includes('assessment.deferral_unsupported'));
    });
    test('REGRESSION: a PUBLISHER finding carrying provenance is refused, whatever it claims', () => {
      assert.ok(forge((files) => editDoc(files, (d) => {
        d.findings.push({ ...d.findings[0], path: 'publisher:node_modules/hosting-helper', package: 'hosting-helper', version: '1.2.0' });
        d.counts.deferred = 2;
        d.counts.findings += 1;
      })).includes('assessment.publisher_provenance'));
    });
  });
});

describe('promotion: one clock, at every boundary that reads the assessment', () => {
  const G = G_HELPER;
  const obligated = ({ deadline, severity = 'high', outcome = 'obligations_pending' }) => {
    const input = baseline();
    const doc = input.dependencies.assessment.doc;
    doc.findings = [{
      advisory: G, aliases: [], package: 'helper', version: '3.1.0', path: HELPER_PATH, scope: 'tooling', severity, title: '', url: '',
      provenance: 'inherited', reportableSince: '2026-09-18', class: outcome === 'obligations_pending' ? 'deferred' : 'blocking', disposition: 'open', coveredBy: null,
      ...(outcome === 'obligations_pending' ? { deadline } : {}),
    }];
    doc.counts = { ...doc.counts, findings: 1, ...(outcome === 'obligations_pending' ? { deferred: 1 } : { blocking: 1 }) };
    doc.outcome = outcome;
    doc.exitCode = outcome === 'obligations_pending' ? 0 : 1;
    return input;
  };

  test('CONTRACT: an inherited high inside its window PASSES promotion', () => {
    const r = decide(obligated({ deadline: '2026-09-25' }));
    assert.equal(r.decision, 'PROCEED', JSON.stringify(codes(r)));
  });

  test('REGRESSION: the same high from 00:00 UTC on its deadline is REFUSED — the deadline cannot be shipped around', () => {
    const r = decide(obligated({ deadline: '2026-09-22' }));
    assert.equal(r.decision, 'REFUSE');
    assert.ok(codes(r).includes('dependency.obligation_overdue'), JSON.stringify(codes(r)));
  });

  test('REGRESSION: a critical is REFUSED — an assessment that found one is blocking', () => {
    const r = decide(obligated({ severity: 'critical', outcome: 'blocking' }));
    assert.equal(r.decision, 'REFUSE');
    assert.ok(codes(r).includes('dependency.assessment_blocking'), JSON.stringify(codes(r)));
  });

  test('CONTRACT: an obligation that falls due inside the assessment window cuts the promotable window short — and the publisher\'s boundary refuses it then', () => {
    const doc = obligated({ deadline: '2026-09-23' }).dependencies.assessment.doc;
    assert.equal(assessmentExpiresAt({ assessment: doc, policy: POLICY }), '2026-09-23T00:00:00Z', 'not the 24-hour window end');
    assert.deepEqual(assessmentTimeReasons({ assessment: doc, policy: POLICY, now: '2026-09-22T23:59:59Z', prefix: 'preflight' }), []);
    assert.deepEqual(assessmentTimeReasons({ assessment: doc, policy: POLICY, now: '2026-09-23T00:00:00Z', prefix: 'preflight' }).map((r) => r.code), ['preflight.obligation_overdue']);
  });

  test('CONTROL: an assessment with no obligation keeps the window it always had', () => {
    const doc = baseline().dependencies.assessment.doc;
    assert.deepEqual(assessmentObligations(doc), []);
    assert.equal(assessmentExpiresAt({ assessment: doc, policy: POLICY }), '2026-09-23T11:50:00Z');
  });
});

describe('certification evidence that carries an obligation survives inspection — and is re-read offline', () => {
  let w;
  before(async () => {
    const reviewed = Date.now() - 2 * DAY;
    w = await world({
      auditBase: true,
      certificationAdvisories: { advisories: [{ name: 'helper', versions: ['3.1.0'], severity: 'high', ghsa: G_HELPER }] },
      githubAdvisories: { [G_HELPER]: { reviewed: iso(reviewed) } },
    });
  });
  const observe = async (dir) => json((await cli(['observe', '--root', dir])).stdout);

  test('CONTRACT: a certification audited against its base defers the inherited high, and the stamp retains the advisory record with it', async () => {
    const record = JSON.parse(readFileSync(join(w.candidate.dir, 'dependency-evidence/record.json'), 'utf8'));
    assert.equal(record.audit.outcome, 'obligations_pending');
    assert.equal(record.audit.counts.deferred, 1);
    assert.ok(record.files.some((f) => f.path === RETAINED_ADVISORIES), 'the advisory record travels with the raw output');
    const collection = JSON.parse(readFileSync(join(w.candidate.dir, 'dependency-evidence/audit/collection.json'), 'utf8'));
    assert.equal(collection.base.commit, w.base);
    assert.equal(git(w.fixture.dir, ['rev-parse', `${w.head}^`]).trim(), w.base, 'the base is the parent commit');
    const obs = await observe(w.candidate.dir);
    assert.deepEqual(obs.dependencyEvidence.problems, []);
    assert.equal(obs.dependencyEvidence.audit.outcome, 'obligations_pending', 'reproduced from the raw output, the retained lock and the retained record');
  });

  test('REGRESSION: the same evidence with its advisory record altered is refused', async () => {
    const copy = tempDir('altered');
    cpSync(w.candidate.dir, copy, { recursive: true });
    const path = join(copy, 'dependency-evidence', RETAINED_ADVISORIES);
    writeFileSync(path, readFileSync(path, 'utf8').replace('"authenticated": false', '"authenticated": true'));
    const obs = await observe(copy);
    assert.ok(obs.dependencyEvidence.problems.some((p) => p.code === 'evidence.file_altered'), JSON.stringify(obs.dependencyEvidence.problems));
  });
});
